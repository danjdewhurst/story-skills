#!/usr/bin/env node
// Builds standalone `story` executables with `bun build --compile`, so
// writers without Node can run the CLI. Each target is archived as the
// release assets name it (story-skills_<version>_<os>_<arch>.tar.gz, or .zip
// for Windows), and a checksums file lists the SHA-256 of each archive. The
// executables run the same source as `bin/story.js`, so `story --version`
// matches package.json.
//
// Usage:
//   node scripts/build-binaries.js [--target <os>-<arch> ...] [--host] [--smoke] [--out <dir>]
//
// With no --target it builds every target, cross-compiling from this
// machine; --host builds only the machine's own target. --smoke runs the
// host target's executable before archiving it: `--version` must print the
// package version, and `validate` must pass on an example project. Archives land in
// dist/binaries/ unless --out says otherwise. Needs bun and tar; the
// Windows zip is written with the CLI's own zip writer.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeZip } from "../src/packaging.js";
import { repoRoot } from "./bun-pin.js";

export const PACKAGE_NAME = "story-skills";

// Release targets: the name used in archive names and the Bun target. The
// x64 targets use Bun's baseline builds, which run on CPUs without AVX2; the
// default x64 builds crash there with "Illegal instruction".
export const TARGETS = [
  { name: "darwin-arm64", os: "darwin", arch: "arm64", bun: "bun-darwin-arm64" },
  { name: "darwin-x64", os: "darwin", arch: "x64", bun: "bun-darwin-x64-baseline" },
  { name: "linux-x64", os: "linux", arch: "x64", bun: "bun-linux-x64-baseline" },
  { name: "linux-arm64", os: "linux", arch: "arm64", bun: "bun-linux-arm64" },
  { name: "windows-x64", os: "windows", arch: "x64", bun: "bun-windows-x64-baseline" }
];

export function executableName(target) {
  return target.os === "windows" ? "story.exe" : "story";
}

export function archiveName(version, target) {
  return `${PACKAGE_NAME}_${version}_${target.os}_${target.arch}.${target.os === "windows" ? "zip" : "tar.gz"}`;
}

export function checksumsName(version) {
  return `${PACKAGE_NAME}_${version}_checksums.txt`;
}

// `sha256sum` format, sorted by file name, so `sha256sum -c` checks it.
export function checksumsText(entries) {
  return [...entries]
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((entry) => `${entry.sha256}  ${entry.file}\n`)
    .join("");
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// The target this machine runs, or null for a platform with no release.
export function hostTarget(platform = process.platform, arch = process.arch) {
  const osName = { darwin: "darwin", linux: "linux", win32: "windows" }[platform];
  return TARGETS.find((target) => target.os === osName && target.arch === arch) ?? null;
}

export function parseArgs(argv, platform = process.platform, arch = process.arch) {
  const options = { targets: [], host: false, smoke: false, out: path.join(repoRoot, "dist", "binaries") };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      const name = argv[++index];
      const target = TARGETS.find((entry) => entry.name === name);
      if (!target) {
        throw new Error(`unknown target ${name ?? "(none)"}; known: ${TARGETS.map((entry) => entry.name).join(", ")}`);
      }
      options.targets.push(target);
    } else if (arg === "--host") {
      options.host = true;
    } else if (arg === "--smoke") {
      options.smoke = true;
    } else if (arg === "--out") {
      if (argv[index + 1] === undefined) {
        throw new Error("--out needs a folder");
      }
      options.out = path.resolve(argv[++index]);
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (options.host) {
    const host = hostTarget(platform, arch);
    if (host === null) {
      throw new Error(`no release target for ${platform}-${arch}`);
    }
    options.targets.push(host);
  }
  if (options.targets.length === 0) {
    options.targets = [...TARGETS];
  }
  // A smoke test runs the binary, so it needs this machine's own target;
  // a CI matrix entry on the wrong runner must fail, not pass untested.
  if (options.smoke && !options.targets.includes(hostTarget(platform, arch))) {
    throw new Error(`--smoke runs the binary here, so it needs this machine's target (${hostTarget(platform, arch)?.name ?? `${platform}-${arch}, which has no release`}) among the targets`);
  }
  return options;
}

function run(command, args, cwd, spawn = spawnSync) {
  const result = spawn(command, args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error?.message ?? (result.stderr || result.stdout)}`);
  }
}

// Runs a compiled executable the way a user would: it must report the
// package version and validate an example project.
export function smokeTest(executable, version, spawn = spawnSync) {
  const versionRun = spawn(executable, ["--version"], { encoding: "utf8" });
  if (versionRun.error || versionRun.status !== 0 || versionRun.stdout.trim() !== version) {
    throw new Error(`${executable} --version printed ${JSON.stringify(versionRun.stdout ?? "")} (exit ${versionRun.status}), expected ${version}${versionRun.error ? `: ${versionRun.error.message}` : ""}`);
  }
  const example = path.join(repoRoot, "examples", "the-last-ember");
  const validateRun = spawn(executable, ["validate", example], { encoding: "utf8" });
  if (validateRun.error || validateRun.status !== 0) {
    throw new Error(`${executable} validate ${example} failed (exit ${validateRun.status}): ${validateRun.stderr || validateRun.error?.message}`);
  }
}

// Compiles and archives one target, and returns its archive's name and hash.
// `spawn` stands in for child_process.spawnSync, so tests can build without
// compiling anything.
export function buildTarget(target, version, out, { smoke = false, spawn = spawnSync, log = console.log } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `story-binary-${target.name}-`));
  try {
    const executable = executableName(target);
    run("bun", ["build", "./bin/story.js", "--compile", `--target=${target.bun}`, `--outfile=${path.join(work, executable)}`], repoRoot, spawn);
    if (smoke && target === hostTarget()) {
      smokeTest(path.join(work, executable), version, spawn);
      log(`Smoke-tested ${target.name}: --version ${version}, validate passed`);
    }
    const archive = path.join(out, archiveName(version, target));
    fs.rmSync(archive, { force: true });
    if (target.os === "windows") {
      writeZip(archive, [{ name: executable, content: fs.readFileSync(path.join(work, executable)) }]);
    } else {
      run("tar", ["-czf", archive, executable], work, spawn);
    }
    return { file: path.basename(archive), sha256: sha256File(archive) };
  } finally {
    // Windows can hold a just-run executable open for a moment.
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

export function main(argv, { spawn = spawnSync, log = console.log } = {}) {
  const options = parseArgs(argv);
  const version = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
  fs.mkdirSync(options.out, { recursive: true });
  const entries = options.targets.map((target) => {
    const entry = buildTarget(target, version, options.out, { smoke: options.smoke, spawn, log });
    log(`Built ${entry.file}`);
    return entry;
  });
  const checksums = path.join(options.out, checksumsName(version));
  fs.writeFileSync(checksums, checksumsText(entries));
  log(`Wrote ${checksums}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`build-binaries: ${error.message}`);
    process.exit(1);
  }
}

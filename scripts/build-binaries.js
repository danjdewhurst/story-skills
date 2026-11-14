#!/usr/bin/env node
// Builds standalone `story` executables with `bun build --compile`, so
// writers without Node can run the CLI. Each target is archived as the
// release assets name it (story-skills_<version>_<os>_<arch>.tar.gz, with
// _musl before the extension for the musl Linux builds, or .zip for
// Windows), and a checksums file lists the SHA-256 of each archive. The
// executables run the same source as `bin/story.js`, so `story --version`
// matches package.json.
//
// Usage:
//   node scripts/build-binaries.js [--target <name> ...] [--host] [--smoke] [--out <dir>]
//
// <name> is a TARGETS name, such as darwin-arm64 or linux-x64-musl.
//
// With no --target it builds every target, cross-compiling from this
// machine; --host builds only the machine's own target. --smoke runs the
// host target's executable before archiving it: `--version` must print the
// package version, `--help` must print the usage, and `validate` must pass on
// an example project. On Linux, --smoke also runs the musl target of the
// machine's architecture when it is among the targets, in an Alpine container
// (Docker); with neither --target nor --host, it is. Archives land in
// dist/binaries/ unless --out says otherwise. Needs bun and tar; the
// Windows zip is written with the CLI's own zip writer, then read back with
// node:zlib to check it.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";
import { crc32, writeZip } from "../src/packaging.js";
import { repoRoot } from "./bun-pin.js";

export const PACKAGE_NAME = "story-skills";

// Release targets: the name used in archive names and the Bun target. The
// x64 targets use Bun's baseline builds, which run on CPUs without AVX2; the
// default x64 builds crash there with "Illegal instruction". The plain Linux
// builds need glibc; the musl builds are for Alpine and other musl systems,
// and need its libstdc++ package (`apk add libstdc++`).
export const TARGETS = [
  { name: "darwin-arm64", os: "darwin", arch: "arm64", bun: "bun-darwin-arm64" },
  { name: "darwin-x64", os: "darwin", arch: "x64", bun: "bun-darwin-x64-baseline" },
  { name: "linux-x64", os: "linux", arch: "x64", bun: "bun-linux-x64-baseline" },
  { name: "linux-arm64", os: "linux", arch: "arm64", bun: "bun-linux-arm64" },
  { name: "linux-x64-musl", os: "linux", arch: "x64", libc: "musl", bun: "bun-linux-x64-musl-baseline" },
  { name: "linux-arm64-musl", os: "linux", arch: "arm64", libc: "musl", bun: "bun-linux-arm64-musl" },
  { name: "windows-x64", os: "windows", arch: "x64", bun: "bun-windows-x64-baseline" }
];

// The Alpine image the musl smoke test runs in, pinned by the digest of its
// multi-arch index so x64 and arm64 hosts pull the same release.
export const ALPINE_IMAGE = "alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf";

export function executableName(target) {
  return target.os === "windows" ? "story.exe" : "story";
}

export function archiveName(version, target) {
  const libc = target.libc ? `_${target.libc}` : "";
  return `${PACKAGE_NAME}_${version}_${target.os}_${target.arch}${libc}.${target.os === "windows" ? "zip" : "tar.gz"}`;
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
// On Linux it is the glibc build.
export function hostTarget(platform = process.platform, arch = process.arch) {
  const osName = { darwin: "darwin", linux: "linux", win32: "windows" }[platform];
  return TARGETS.find((target) => target.os === osName && target.arch === arch && !target.libc) ?? null;
}

// How --smoke runs `target` on this machine: "host" runs it directly,
// "alpine" runs a musl build in an Alpine container on a Linux machine of
// the same architecture, and null means it cannot run here.
export function smokeRunner(target, platform = process.platform, arch = process.arch) {
  if (target === hostTarget(platform, arch)) {
    return "host";
  }
  if (target.libc === "musl" && platform === "linux" && target.arch === arch) {
    return "alpine";
  }
  return null;
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
  // A smoke test runs the binary, so it needs a target this machine can
  // run; a CI matrix entry on the wrong runner must fail, not pass untested.
  if (options.smoke && !options.targets.some((target) => smokeRunner(target, platform, arch) !== null)) {
    const runnable = TARGETS.filter((target) => smokeRunner(target, platform, arch) !== null).map((target) => target.name);
    throw new Error(`--smoke runs the binary here, so it needs this machine's target (${runnable.length > 0 ? runnable.join(" or ") : `${platform}-${arch}, which has no release`}) among the targets`);
  }
  return options;
}

function run(command, args, cwd, spawn = spawnSync) {
  const result = spawn(command, args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error?.message ?? (result.stderr || result.stdout)}`);
  }
}

// A compiled Bun executable reads bunfig.toml and .env from the folder it
// runs in unless told not to. The docs recommend the binary for story
// projects you did not write, so a project's bunfig.toml preload must not
// run and its .env must not reach the process.
export const COMPILE_SAFETY_FLAGS = ["--no-compile-autoload-bunfig", "--no-compile-autoload-dotenv"];

// Runs a compiled executable the way a user would: it must report the
// package version, print the usage, and validate an example project. It then
// runs the executable in a folder whose bunfig.toml names a preload script,
// which must not run.
export function smokeTest(executable, version, spawn = spawnSync) {
  const versionRun = spawn(executable, ["--version"], { encoding: "utf8" });
  if (versionRun.error || versionRun.status !== 0 || versionRun.stdout.trim() !== version) {
    throw new Error(`${executable} --version printed ${JSON.stringify(versionRun.stdout ?? "")} (exit ${versionRun.status}), expected ${version}${versionRun.error ? `: ${versionRun.error.message}` : ""}${versionRun.stderr ? `: ${versionRun.stderr.trim()}` : ""}`);
  }
  const example = path.join(repoRoot, "examples", "the-last-ember");
  const validateRun = spawn(executable, ["validate", example], { encoding: "utf8" });
  if (validateRun.error || validateRun.status !== 0) {
    throw new Error(`${executable} validate ${example} failed (exit ${validateRun.status}): ${validateRun.stderr || validateRun.error?.message}`);
  }
  const helpRun = spawn(executable, ["--help"], { encoding: "utf8" });
  if (helpRun.error || helpRun.status !== 0 || !String(helpRun.stdout ?? "").startsWith("Usage: story ")) {
    throw new Error(`${executable} --help did not print the usage (exit ${helpRun.status}): ${helpRun.stderr || helpRun.error?.message || JSON.stringify(helpRun.stdout ?? "")}`);
  }
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "story-autoload-"));
  try {
    const marker = path.join(folder, "preload-ran");
    fs.writeFileSync(path.join(folder, "bunfig.toml"), 'preload = ["./preload.js"]\n');
    fs.writeFileSync(path.join(folder, "preload.js"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`);
    const autoloadRun = spawn(executable, ["--version"], { cwd: folder, encoding: "utf8" });
    if (autoloadRun.error || autoloadRun.status !== 0) {
      throw new Error(`${executable} --version in a folder with a bunfig.toml failed (exit ${autoloadRun.status}): ${autoloadRun.stderr || autoloadRun.error?.message}`);
    }
    if (fs.existsSync(marker)) {
      throw new Error(`${executable} ran the preload script that bunfig.toml in its working folder names`);
    }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

// Installs libstdc++, retrying once after a mirror error, then runs the
// executable ($0) with its arguments.
export const ALPINE_SMOKE_SCRIPT = 'install() { apk add --no-cache --quiet libstdc++ > /dev/null; }; { install || { sleep 5 && install; }; } && exec "$0" "$@"';

// Stands in for `spawn` to run a musl executable in an Alpine container, so
// smokeTest's checks run there unchanged. The executable's folder and every
// absolute path among the arguments are mounted read-only at the same path,
// and the working folder read-write. The container installs libstdc++, which
// the musl builds need, as a user of the binary on Alpine must.
export function alpineSpawn(target, spawn = spawnSync) {
  const platform = `linux/${target.arch === "x64" ? "amd64" : target.arch}`;
  return (executable, args, options = {}) => {
    const readOnly = [path.dirname(executable), ...args.filter((arg) => path.isAbsolute(arg))];
    const bind = (folder) => `type=bind,source=${folder},target=${folder}`;
    const mounts = [...new Set(readOnly)].flatMap((folder) => ["--mount", `${bind(folder)},readonly`]);
    const workdir = options.cwd ? ["--mount", bind(options.cwd), "--workdir", options.cwd] : [];
    return spawn(
      "docker",
      ["run", "--rm", "--platform", platform, ...mounts, ...workdir, ALPINE_IMAGE, "sh", "-c", ALPINE_SMOKE_SCRIPT, executable, ...args],
      { encoding: "utf8" }
    );
  };
}

// Reads back a one-entry zip from the zip writer before it is published.
// The writer's deflate is the CLI's own, so the entry must inflate, with
// node:zlib, to exactly `content`, under `name` and with its CRC.
export function verifyZip(archive, name, content) {
  const zip = fs.readFileSync(archive);
  const nameLength = zip.readUInt16LE(26);
  const start = 30 + nameLength + zip.readUInt16LE(28);
  const body = zip.subarray(start, start + zip.readUInt32LE(18));
  const unpacked = zip.readUInt16LE(8) === 8 ? inflateRawSync(body) : body;
  if (zip.readUInt32LE(0) !== 0x04034b50 || zip.toString("utf8", 30, 30 + nameLength) !== name || zip.readUInt32LE(14) !== crc32(content) || !unpacked.equals(content)) {
    throw new Error(`${archive} does not unpack to ${name}`);
  }
}

// Compiles and archives one target, and returns its archive's name and hash.
// `spawn` stands in for child_process.spawnSync, so tests can build without
// compiling anything.
// `platform` and `arch` stand in for this machine's, so tests can reach each
// smoke runner.
export function buildTarget(target, version, out, { smoke = false, spawn = spawnSync, log = console.log, platform = process.platform, arch = process.arch } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `story-binary-${target.name}-`));
  try {
    const executable = executableName(target);
    run("bun", ["build", "./bin/story.js", "--compile", ...COMPILE_SAFETY_FLAGS, `--target=${target.bun}`, `--outfile=${path.join(work, executable)}`], repoRoot, spawn);
    const runner = smoke ? smokeRunner(target, platform, arch) : null;
    if (runner === "host") {
      smokeTest(path.join(work, executable), version, spawn);
      log(`Smoke-tested ${target.name}: --version ${version}, validate and --help passed`);
    } else if (runner === "alpine") {
      smokeTest(path.join(work, executable), version, alpineSpawn(target, spawn));
      log(`Smoke-tested ${target.name} in ${ALPINE_IMAGE}: --version ${version}, validate and --help passed`);
    }
    const archive = path.join(out, archiveName(version, target));
    fs.rmSync(archive, { force: true });
    if (target.os === "windows") {
      const content = fs.readFileSync(path.join(work, executable));
      writeZip(archive, [{ name: executable, content }]);
      verifyZip(archive, executable, content);
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

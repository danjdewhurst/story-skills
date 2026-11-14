import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ALPINE_IMAGE, ALPINE_SMOKE_SCRIPT, COMPILE_SAFETY_FLAGS, TARGETS, alpineSpawn, archiveName, buildTarget, checksumsName, checksumsText, executableName, hostTarget, parseArgs, sha256File, smokeRunner, smokeTest, verifyZip } from "../scripts/build-binaries.js";
import { formula, parseChecksums } from "../scripts/homebrew-formula.js";
import { writeZip } from "../src/packaging.js";
import { VERSION } from "../src/version.js";
import { makeTempDir } from "./helpers.js";

const repoRoot = path.resolve(import.meta.dir, "..");
const readRepo = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const HASH = (digit) => String(digit).repeat(64);
// Bytes deflate cannot shrink, the same on every run.
const noise = (blocks) => Buffer.concat(Array.from({ length: blocks }, (_, index) => crypto.createHash("sha256").update(String(index)).digest()));

describe("standalone binaries (#296)", () => {
  test("every release target has an archive name the formula and release share", () => {
    expect(TARGETS.map((target) => target.name)).toEqual(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "linux-x64-musl", "linux-arm64-musl", "windows-x64"]);
    expect(TARGETS.map((target) => archiveName("1.2.3", target))).toEqual([
      "story-skills_1.2.3_darwin_arm64.tar.gz",
      "story-skills_1.2.3_darwin_x64.tar.gz",
      "story-skills_1.2.3_linux_x64.tar.gz",
      "story-skills_1.2.3_linux_arm64.tar.gz",
      "story-skills_1.2.3_linux_x64_musl.tar.gz",
      "story-skills_1.2.3_linux_arm64_musl.tar.gz",
      "story-skills_1.2.3_windows_x64.zip"
    ]);
    // The workflows find a target's archive by its name with - as _.
    for (const target of TARGETS) {
      expect(archiveName("1.2.3", target)).toStartWith(`story-skills_1.2.3_${target.name.replaceAll("-", "_")}.`);
    }
    expect(TARGETS.map(executableName)).toEqual(["story", "story", "story", "story", "story", "story", "story.exe"]);
    expect(checksumsName("1.2.3")).toBe("story-skills_1.2.3_checksums.txt");
  });

  test("the checksums file is sha256sum format, sorted, and reads back", () => {
    const text = checksumsText([{ file: "b.zip", sha256: HASH(2) }, { file: "a.tar.gz", sha256: HASH(1) }]);
    expect(text).toBe(`${HASH(1)}  a.tar.gz\n${HASH(2)}  b.zip\n`);
    expect(parseChecksums(text)).toEqual({ "a.tar.gz": HASH(1), "b.zip": HASH(2) });
    const file = path.join(makeTempDir(), "x");
    fs.writeFileSync(file, "abc");
    expect(sha256File(file)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("arguments pick targets, the host, and refuse a smoke test the host cannot run", () => {
    expect(parseArgs([]).targets).toEqual(TARGETS);
    expect(parseArgs(["--target", "linux-arm64"]).targets.map((target) => target.name)).toEqual(["linux-arm64"]);
    expect(parseArgs(["--host"], "win32", "x64").targets.map((target) => target.name)).toEqual(["windows-x64"]);
    expect(parseArgs(["--target", "darwin-arm64", "--smoke"], "darwin", "arm64").smoke).toBe(true);
    expect(() => parseArgs(["--target", "darwin-x64", "--smoke"], "darwin", "arm64")).toThrow("--smoke runs the binary here, so it needs this machine's target (darwin-arm64)");
    expect(() => parseArgs(["--target", "sparc"])).toThrow("unknown target sparc");
    expect(() => parseArgs(["--host"], "freebsd", "x64")).toThrow("no release target for freebsd-x64");
    expect(() => parseArgs(["--out"])).toThrow("--out needs a folder");
    expect(hostTarget("linux", "arm64").name).toBe("linux-arm64");
    expect(hostTarget("linux", "x64").name).toBe("linux-x64");
  });

  test("musl builds use Bun's musl targets and smoke-test in Alpine on a Linux machine of their architecture (#893)", () => {
    const named = (name) => TARGETS.find((target) => target.name === name);
    expect(named("linux-x64-musl").bun).toBe("bun-linux-x64-musl-baseline");
    expect(named("linux-arm64-musl").bun).toBe("bun-linux-arm64-musl");
    expect(smokeRunner(named("linux-x64"), "linux", "x64")).toBe("host");
    expect(smokeRunner(named("linux-x64-musl"), "linux", "x64")).toBe("alpine");
    expect(smokeRunner(named("linux-arm64-musl"), "linux", "x64")).toBeNull();
    expect(smokeRunner(named("linux-arm64-musl"), "linux", "arm64")).toBe("alpine");
    expect(smokeRunner(named("linux-x64-musl"), "darwin", "x64")).toBeNull();
    expect(parseArgs(["--target", "linux-x64-musl", "--smoke"], "linux", "x64").smoke).toBe(true);
    expect(() => parseArgs(["--target", "linux-arm64-musl", "--smoke"], "linux", "x64")).toThrow("needs this machine's target (linux-x64 or linux-x64-musl)");
    expect(() => parseArgs(["--target", "linux-x64-musl", "--smoke"], "darwin", "arm64")).toThrow("needs this machine's target (darwin-arm64)");
    expect(ALPINE_IMAGE).toMatch(/^alpine:\d+\.\d+@sha256:[0-9a-f]{64}$/);
  });

  test("a musl build smoke-tests in Alpine, and a target the machine cannot run is not smoke-tested", () => {
    const build = (name, platform, arch) => {
      const calls = [];
      const spawn = (command, args, options) => {
        calls.push({ command, args });
        if (command === "tar") {
          fs.writeFileSync(path.join(options.cwd, args[1].split(path.sep).pop()), "");
          fs.writeFileSync(args[1], "archive");
        }
        const stdout = args.includes("--help") ? "Usage: story <command> [options]\n" : `${VERSION}\n`;
        return { status: 0, stdout, stderr: "" };
      };
      const log = [];
      buildTarget(TARGETS.find((target) => target.name === name), VERSION, makeTempDir(), { smoke: true, spawn, log: (line) => log.push(line), platform, arch });
      return { calls, log };
    };
    const musl = build("linux-arm64-musl", "linux", "arm64");
    const runs = musl.calls.filter((call) => call.command === "docker");
    expect(runs.map((call) => call.args.slice(call.args.indexOf(ALPINE_IMAGE) + 5))).toEqual([["--version"], ["validate", path.join(repoRoot, "examples", "the-last-ember")], ["--help"], ["--version"]]);
    expect(musl.calls.some((call) => call.command.endsWith("story"))).toBe(false);
    expect(musl.log).toEqual([`Smoke-tested linux-arm64-musl in ${ALPINE_IMAGE}: --version ${VERSION}, validate and --help passed`]);
    const elsewhere = build("linux-arm64-musl", "linux", "x64");
    expect(elsewhere.calls.map((call) => call.command)).toEqual(["bun", "tar"]);
    expect(elsewhere.log).toEqual([]);
  });

  test("the Alpine runner mounts the executable, the arguments' paths, and the working folder", () => {
    const calls = [];
    const spawn = (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: "", stderr: "" };
    };
    const run = alpineSpawn(TARGETS.find((target) => target.name === "linux-arm64-musl"), spawn);
    run("/work/story", ["validate", "/repo/examples/x"]);
    run("/work/story", ["--version"], { cwd: "/tmp/folder" });
    expect(calls[0].command).toBe("docker");
    expect(calls[0].args).toEqual([
      "run", "--rm", "--platform", "linux/arm64",
      "--mount", "type=bind,source=/work,target=/work,readonly", "--mount", "type=bind,source=/repo/examples/x,target=/repo/examples/x,readonly",
      ALPINE_IMAGE, "sh", "-c", ALPINE_SMOKE_SCRIPT, "/work/story", "validate", "/repo/examples/x"
    ]);
    expect(calls[1].args).toEqual([
      "run", "--rm", "--platform", "linux/arm64",
      "--mount", "type=bind,source=/work,target=/work,readonly", "--mount", "type=bind,source=/tmp/folder,target=/tmp/folder", "--workdir", "/tmp/folder",
      ALPINE_IMAGE, "sh", "-c", ALPINE_SMOKE_SCRIPT, "/work/story", "--version"
    ]);
    alpineSpawn(TARGETS.find((target) => target.name === "linux-x64-musl"), spawn)("/w/story", []);
    expect(calls[2].args.slice(0, 4)).toEqual(["run", "--rm", "--platform", "linux/amd64"]);
    expect(ALPINE_SMOKE_SCRIPT).toContain("apk add --no-cache --quiet libstdc++");
    expect(ALPINE_SMOKE_SCRIPT).toEndWith('exec "$0" "$@"');
  });

  test("the smoke test checks the version, a validate run, and the usage", () => {
    const ok = (stdout) => (command, args) => ({ status: 0, stdout: args[0] === "--help" ? "Usage: story <command> [options]\n" : stdout, stderr: "" });
    expect(() => smokeTest("story", VERSION, ok(`${VERSION}\n`))).not.toThrow();
    expect(() => smokeTest("story", VERSION, ok("0.0.1\n"))).toThrow(`--version printed "0.0.1\\n" (exit 0), expected ${VERSION}`);
    // A loader error, such as a missing libstdc++, is in the message.
    expect(() => smokeTest("story", VERSION, () => ({ status: 127, stdout: "", stderr: "Error loading shared library libstdc++.so.6\n" }))).toThrow("(exit 127), expected " + VERSION + ": Error loading shared library libstdc++.so.6");
    let calls = 0;
    const failingValidate = () => (calls++ === 0 ? { status: 0, stdout: `${VERSION}\n` } : { status: 1, stdout: "", stderr: "boom" });
    expect(() => smokeTest("story", VERSION, failingValidate)).toThrow("validate");
    const noUsage = (command, args) => ({ status: 0, stdout: args[0] === "--help" ? "" : `${VERSION}\n`, stderr: "" });
    expect(() => smokeTest("story", VERSION, noUsage)).toThrow("--help did not print the usage");
  });

  test("the binary is compiled without bunfig.toml or .env autoload, and the smoke test checks it", () => {
    const calls = [];
    const spawn = (command, args, options) => {
      calls.push({ command, args });
      if (command === "tar") {
        fs.writeFileSync(path.join(options.cwd, args[1].split(path.sep).pop()), "");
        fs.writeFileSync(args[1], "archive");
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const out = makeTempDir();
    buildTarget(TARGETS.find((target) => target.name === "linux-x64"), VERSION, out, { spawn });
    const compile = calls.find((call) => call.command === "bun");
    expect(COMPILE_SAFETY_FLAGS).toEqual(["--no-compile-autoload-bunfig", "--no-compile-autoload-dotenv"]);
    for (const flag of COMPILE_SAFETY_FLAGS) {
      expect(compile.args).toContain(flag);
    }

    // A binary that runs the working folder's preload fails the smoke test.
    const preloading = (command, args, options) => {
      if (options.cwd && fs.existsSync(path.join(options.cwd, "bunfig.toml"))) {
        const script = fs.readFileSync(path.join(options.cwd, "preload.js"), "utf8");
        const marker = JSON.parse(script.match(/writeFileSync\((".*?"),/)[1]);
        fs.writeFileSync(marker, "ran");
      }
      return { status: 0, stdout: args[0] === "--help" ? "Usage: story <command>\n" : `${VERSION}\n`, stderr: "" };
    };
    expect(() => smokeTest("story", VERSION, preloading)).toThrow("ran the preload script");
  });

  test("the Windows zip is read back and must unpack to the executable (#589)", () => {
    const dir = makeTempDir();
    const archive = path.join(dir, "story.zip");
    // Compressible, so the entry is deflated, with an incompressible tail.
    const executable = Buffer.concat([Buffer.from("MZ story executable ".repeat(4000)), noise(128)]);
    writeZip(archive, [{ name: "story.exe", content: executable }]);
    expect(fs.readFileSync(archive).readUInt16LE(8)).toBe(8);
    expect(() => verifyZip(archive, "story.exe", executable)).not.toThrow();
    expect(() => verifyZip(archive, "story", executable)).toThrow(`${archive} does not unpack to story`);
    expect(() => verifyZip(archive, "story.exe", Buffer.from("other"))).toThrow("does not unpack to story.exe");

    // A wrong byte in the deflated data fails to inflate or unpacks to
    // something else.
    const zip = fs.readFileSync(archive);
    zip[100] ^= 0xff;
    fs.writeFileSync(archive, zip);
    expect(() => verifyZip(archive, "story.exe", executable)).toThrow(`${archive} does not unpack to story.exe`);

    // A stored entry is compared as it is.
    const random = noise(64);
    writeZip(archive, [{ name: "story.exe", content: random }]);
    expect(fs.readFileSync(archive).readUInt16LE(8)).toBe(0);
    expect(() => verifyZip(archive, "story.exe", random)).not.toThrow();
  });

  test("the formula installs story from the release for each macOS and Linux target, and tests its version", () => {
    const sums = Object.fromEntries(TARGETS.map((target, index) => [archiveName("1.2.3", target), HASH(index + 1)]));
    const ruby = formula("1.2.3", sums);
    expect(ruby).toContain("class StorySkills < Formula");
    expect(ruby).toContain('version "1.2.3"');
    for (const [index, target] of TARGETS.entries()) {
      if (target.os === "windows" || target.libc === "musl") {
        expect(ruby).not.toContain(archiveName("1.2.3", target));
        continue;
      }
      expect(ruby).toContain(`url "https://github.com/danjdewhurst/story-skills/releases/download/v1.2.3/${archiveName("1.2.3", target)}"\n      sha256 "${HASH(index + 1)}"`);
    }
    expect(ruby).toContain('bin.install "story"');
    expect(ruby).toContain('assert_equal "1.2.3", shell_output("#{bin}/story --version").strip');
    expect(() => formula("1.2.3", {})).toThrow("no entry for story-skills_1.2.3_darwin_arm64.tar.gz");
    expect(() => formula("v1.2.3", sums)).toThrow("version must be X.Y.Z");
  });

  test("SECURITY.md names the archive extensions the release writes (#680)", () => {
    // The extension follows the architecture: .tar.gz, or .zip for Windows.
    const extensionOf = (name) => name.slice(name.indexOf(".", name.lastIndexOf("_")));
    const security = readRepo("SECURITY.md");
    const windows = archiveName("1.2.3", TARGETS.find((target) => target.os === "windows"));
    const unix = archiveName("1.2.3", TARGETS.find((target) => target.os === "linux"));
    expect(extensionOf(windows)).toBe(".zip");
    expect(security).toContain(`\`${extensionOf(windows)}\``);
    expect(security).toContain(extensionOf(unix));
  });

  test("CI and the publish workflow build and smoke-test each target on its own OS", () => {
    for (const file of [".github/workflows/ci.yml", ".github/workflows/publish.yml"]) {
      const workflow = readRepo(file);
      for (const [target, runner] of [["darwin-arm64", "macos-latest"], ["darwin-x64", "macos-15-intel"], ["linux-x64", "ubuntu-latest"], ["linux-arm64", "ubuntu-24.04-arm"], ["linux-x64-musl", "ubuntu-latest"], ["linux-arm64-musl", "ubuntu-24.04-arm"], ["windows-x64", "windows-latest"]]) {
        expect(workflow).toContain(`- { target: ${target}, runner: ${runner} }`);
      }
      expect(workflow).toContain('bun scripts/build-binaries.js --target "${{ matrix.target }}" --smoke');
    }
    const publish = readRepo(".github/workflows/publish.yml");
    expect(publish).toContain('gh release upload "$TAG" dist/binaries/* --repo "$GITHUB_REPOSITORY" --clobber');
    expect(publish).toContain("sha256sum story-skills_");
    // The tap update is skipped, successfully, without its token.
    expect(publish).toContain("TAP_KEY: ${{ secrets.HOMEBREW_TAP_DEPLOY_KEY }}");
    expect(publish).toContain("StrictHostKeyChecking=yes");
    expect(publish).toContain("if: steps.token.outputs.present == 'true'");
    expect(publish).toContain('node scripts/homebrew-formula.js "$version"');
  });
});

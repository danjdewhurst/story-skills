import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TARGETS, archiveName, checksumsName, checksumsText, executableName, hostTarget, parseArgs, sha256File, smokeTest, verifyZip } from "../scripts/build-binaries.js";
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
    expect(TARGETS.map((target) => target.name)).toEqual(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"]);
    expect(TARGETS.map((target) => archiveName("1.2.3", target))).toEqual([
      "story-skills_1.2.3_darwin_arm64.tar.gz",
      "story-skills_1.2.3_darwin_x64.tar.gz",
      "story-skills_1.2.3_linux_x64.tar.gz",
      "story-skills_1.2.3_linux_arm64.tar.gz",
      "story-skills_1.2.3_windows_x64.zip"
    ]);
    expect(TARGETS.map(executableName)).toEqual(["story", "story", "story", "story", "story.exe"]);
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
  });

  test("the smoke test checks the version and a validate run", () => {
    const ok = (stdout) => () => ({ status: 0, stdout, stderr: "" });
    expect(() => smokeTest("story", VERSION, ok(`${VERSION}\n`))).not.toThrow();
    expect(() => smokeTest("story", VERSION, ok("0.0.1\n"))).toThrow(`--version printed "0.0.1\\n" (exit 0), expected ${VERSION}`);
    let calls = 0;
    const failingValidate = () => (calls++ === 0 ? { status: 0, stdout: `${VERSION}\n` } : { status: 1, stdout: "", stderr: "boom" });
    expect(() => smokeTest("story", VERSION, failingValidate)).toThrow("validate");
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
      if (target.os === "windows") {
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
      for (const [target, runner] of [["darwin-arm64", "macos-latest"], ["darwin-x64", "macos-15-intel"], ["linux-x64", "ubuntu-latest"], ["linux-arm64", "ubuntu-24.04-arm"], ["windows-x64", "windows-latest"]]) {
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

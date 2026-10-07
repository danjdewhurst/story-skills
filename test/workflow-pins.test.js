import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { VERSION } from "../src/version.js";
import { cliUpdateHint, compareVersions, parseVersion } from "../src/workflows.js";
import { makeTempDir, memoryIo } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// A repository (marked by a .git folder) with a story project in book/.
function newRepo() {
  const repo = makeTempDir();
  fs.mkdirSync(path.join(repo, ".git"));
  expect(invoke(repo, ["init", "Pinned", "--dir", "book"]).code).toBe(0);
  return { repo, root: path.join(repo, "book") };
}

function writeWorkflow(dir, name, text) {
  const workflows = path.join(dir, ".github", "workflows");
  fs.mkdirSync(workflows, { recursive: true });
  fs.writeFileSync(path.join(workflows, name), text);
}

const [major, minor, patch] = VERSION.split(".").map(Number);
const older = patch > 0 ? `${major}.${minor}.${patch - 1}` : minor > 0 ? `${major}.${minor - 1}.0` : "0.0.0";
const newer = `${major}.${minor}.${patch + 1}`;

function pinLines(out) {
  return out.split("\n").filter((line) => line.includes("workflow"));
}

describe("story doctor workflow pins", () => {
  test("notes a STORY_VERSION older than the CLI, in the repository root above the project", () => {
    const { repo, root } = newRepo();
    writeWorkflow(repo, "story-checks.yml", `env:\n  STORY_DIR: "book"\n  STORY_VERSION: "${older}"\n  # STORY_VERSION: "0.1.0"\n`);
    const result = invoke(repo, ["doctor", "book"]);
    expect(result.code).toBe(0);
    expect(pinLines(result.out)).toEqual([
      `- [P3] Update workflow CLI version: .github/workflows/story-checks.yml:3 installs story-skills ${older}, older than this CLI (${VERSION}); after story check passes locally, change the line to STORY_VERSION: "${VERSION}".`
    ]);
    // Paths are shown from where doctor runs.
    expect(invoke(root, ["doctor"]).out).toContain("../.github/workflows/story-checks.yml:3 installs");
  });

  test("is quiet for a current pin, a commented pin, or no workflows", () => {
    const { repo, root } = newRepo();
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([]);
    writeWorkflow(repo, "a.yml", `env:\n  STORY_VERSION: "${VERSION}"\n`);
    writeWorkflow(root, "b.yaml", `env:\n  STORY_VERSION: '${VERSION}+ci.7'\n  # STORY_VERSION: "${newer}"\n`);
    writeWorkflow(root, "notes.txt", `STORY_VERSION: "0.1.0"\n`);
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([]);
  });

  test("notes a STORY_VERSION newer than the CLI, with how to update this CLI (#536)", () => {
    const { repo, root } = newRepo();
    writeWorkflow(repo, "story-checks.yml", `env:\n  STORY_VERSION: "v${newer}+ci.7"\n`);
    const hint = cliUpdateHint(newer);
    // The suite runs from a clone of this repository.
    expect(hint).toBe(`update the clone in ${path.resolve(import.meta.dir, "..").replace(/\\/g, "/")} with git pull`);
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([
      `- [P3] Update local CLI version: ../.github/workflows/story-checks.yml:2 installs story-skills ${newer}, newer than this CLI (${VERSION}), so CI can report findings that story check here does not; ${hint}.`
    ]);
  });

  test("orders a prerelease before its release and skips a pin that is not one exact release (#536)", () => {
    const { root } = newRepo();
    writeWorkflow(root, "a.yml", `env:\n  STORY_VERSION: "${VERSION}-rc.1"\n`);
    writeWorkflow(root, "b.yml", `env:\n  STORY_VERSION: "${newer}-rc.1"\n`);
    for (const [index, value] of ["latest", `^${VERSION}`, `${major}.${minor}`, `${newer}junk`, `${newer}.1`, ""].entries()) {
      writeWorkflow(root, `skip-${index}.yml`, `env:\n  STORY_VERSION: "${value}"\n`);
    }
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([
      `- [P3] Update workflow CLI version: .github/workflows/a.yml:2 installs story-skills ${VERSION}-rc.1, older than this CLI (${VERSION}); after story check passes locally, change the line to STORY_VERSION: "${VERSION}".`,
      `- [P3] Update local CLI version: .github/workflows/b.yml:2 installs story-skills ${newer}-rc.1, newer than this CLI (${VERSION}), so CI can report findings that story check here does not; ${cliUpdateHint(`${newer}-rc.1`)}.`
    ]);
  });

  test("compares versions in semver order, ignoring build metadata", () => {
    const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.2.0", "2.0.0"];
    const shuffled = [...ordered].reverse().map(parseVersion);
    expect(shuffled.sort(compareVersions).map((version) => version.text)).toEqual(ordered);
    expect(compareVersions(parseVersion("1.0.0+a"), parseVersion("v1.0.0+b"))).toBe(0);
    expect(compareVersions(parseVersion("1.0.0-rc.1"), parseVersion("1.0.0-rc.1"))).toBe(0);
    expect(parseVersion("v1.2.3-rc.1+build.4")).toEqual({ numbers: [1, 2, 3], pre: ["rc", "1"], text: "1.2.3-rc.1" });
    expect(parseVersion("1.2.3+build.4").text).toBe("1.2.3");
    for (const value of ["latest", "1.2", "1.2.3.4", "1.2.3-", "1.2.3-rc..1", "1.2.3 ", "x1.2.3", ""]) {
      expect(parseVersion(value)).toBeNull();
    }
  });

  test("names the update command for how the CLI was installed (#536)", () => {
    const missing = path.join(makeTempDir(), "missing");
    const at = (file, execPath = missing) => cliUpdateHint("9.1.0", file, execPath);
    expect(at("/$bunfs/root/story", "/home/linuxbrew/.linuxbrew/Cellar/story-skills/9.0.0/bin/story")).toBe("update it with brew upgrade story-skills");
    expect(at("B:\\~BUN\\root\\story.exe", "C:\\Users\\a\\story.exe")).toBe("download the 9.1.0 binary for your system from https://github.com/danjdewhurst/story-skills/releases/tag/v9.1.0");
    expect(at("/home/a/.npm/_npx/3f99/node_modules/story-skills/src/workflows.js")).toBe("run that release with npx story-skills@9.1.0");
    expect(at("C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\3f99\\node_modules\\story-skills\\src\\workflows.js")).toBe("run that release with npx story-skills@9.1.0");
    expect(at("/tmp/bunx-1000-story-skills@latest/node_modules/story-skills/src/workflows.js")).toBe("run that release with bunx story-skills@9.1.0");
    expect(at("/home/a/.bun/install/global/node_modules/story-skills/src/workflows.js")).toBe("update it with bun add -g story-skills@9.1.0");
    const npmPrefix = path.join(makeTempDir(), "lib").replace(/\\/g, "/");
    expect(at(`${npmPrefix}/node_modules/story-skills/src/workflows.js`)).toBe("update it with npm install -g story-skills@9.1.0");
    const book = makeTempDir();
    fs.writeFileSync(path.join(book, "package.json"), "{}\n");
    const dependency = book.replace(/\\/g, "/");
    expect(at(`${dependency}/node_modules/story-skills/src/workflows.js`)).toBe(`update the story-skills dependency in ${dependency}/package.json to 9.1.0`);
    expect(at("/home/a/.local/share/pnpm/global/5/node_modules/.pnpm/story-skills@9.0.0/node_modules/story-skills/src/workflows.js")).toBe("update it to 9.1.0 (see Update or pin the CLI in docs/getting-started.md)");
    expect(at("/home/a/.claude/plugins/cache/story-skills/story-skills/9.0.0/skills/story-maintenance/scripts/story.js")).toBe("update the Story Skills plugin or skills, which carry this bundled CLI (see Update the skills in docs/getting-started.md)");
    const clone = makeTempDir();
    expect(at(`${clone.replace(/\\/g, "/")}/src/workflows.js`)).toBe("update it to 9.1.0 (see Update or pin the CLI in docs/getting-started.md)");
    fs.writeFileSync(path.join(clone, ".git"), "gitdir: elsewhere\n");
    expect(at(`${clone.replace(/\\/g, "/")}/src/workflows.js`)).toBe(`update the clone in ${clone.replace(/\\/g, "/")} with git pull`);
  });

  test.skipIf(process.platform === "win32")("follows a symlinked binary into Homebrew's Cellar (#536)", () => {
    const prefix = makeTempDir();
    const real = path.join(prefix, "Cellar", "story-skills", "9.0.0", "bin", "story");
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, "");
    fs.mkdirSync(path.join(prefix, "bin"));
    fs.symlinkSync(real, path.join(prefix, "bin", "story"));
    expect(cliUpdateHint("9.1.0", "/$bunfs/root/story", path.join(prefix, "bin", "story"))).toBe("update it with brew upgrade story-skills");
    // A binary unpacked by hand, even behind a symlink, is not Homebrew's.
    const unpacked = path.join(prefix, "downloads", "story");
    fs.mkdirSync(path.dirname(unpacked));
    fs.writeFileSync(unpacked, "");
    fs.symlinkSync(unpacked, path.join(prefix, "bin", "linked"));
    expect(cliUpdateHint("9.1.0", "/$bunfs/root/story", path.join(prefix, "bin", "linked"))).toContain("download the 9.1.0 binary");
  });

  test("reads the project's own workflows outside a git repository and skips an unreadable file", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Loose", "--dir", "book"]).code).toBe(0);
    const root = path.join(cwd, "book");
    writeWorkflow(root, "story-checks.yml", `env:\n  STORY_VERSION: "${older}"\n`);
    fs.mkdirSync(path.join(root, ".github", "workflows", "folder.yml"));
    const lines = pinLines(invoke(root, ["doctor"]).out);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(".github/workflows/story-checks.yml:2 installs");
  });

  test.skipIf(process.platform === "win32")("skips a workflow that is a symlink or a FIFO rather than reading it (#548)", () => {
    const { repo, root } = newRepo();
    const outside = path.join(makeTempDir(), "pinned.yml");
    fs.writeFileSync(outside, `env:\n  STORY_VERSION: "${older}"\n`);
    writeWorkflow(repo, "story-checks.yml", `env:\n  STORY_VERSION: "${VERSION}"\n`);
    fs.symlinkSync(outside, path.join(repo, ".github", "workflows", "linked.yml"));
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([]);
    // /dev/zero, or a FIFO (where mkfifo exists), would hold doctor
    // forever if it were read. In a child, so a read that never ends fails
    // the test rather than stalling the suite.
    fs.symlinkSync("/dev/zero", path.join(repo, ".github", "workflows", "zero.yml"));
    spawnSync("mkfifo", [path.join(repo, ".github", "workflows", "pipe.yml")]);
    const result = spawnSync(process.execPath, [path.join(import.meta.dir, "..", "bin", "story.js"), "doctor", root], { encoding: "utf8", timeout: 20000 });
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(pinLines(result.stdout)).toEqual([]);
  });

  test("flags a legacy STORY_REF, keeping a newer release than the CLI", () => {
    const { root } = newRepo();
    writeWorkflow(root, "review-copy.yml", `env:\n  STORY_REF: "v0.13.0"\n`);
    writeWorkflow(root, "story-checks.yml", `env:\n  STORY_REF: v${newer}\n`);
    const lines = pinLines(invoke(root, ["doctor"]).out);
    expect(lines).toEqual([
      `- [P3] Rename workflow STORY_REF: .github/workflows/review-copy.yml:2 sets the legacy STORY_REF; change the line to STORY_VERSION: "${VERSION}" and copy the install step from the current template (see Upgrading the workflows in docs/automation.md).`,
      `- [P3] Rename workflow STORY_REF: .github/workflows/story-checks.yml:2 sets the legacy STORY_REF; change the line to STORY_VERSION: "${newer}" and copy the install step from the current template (see Upgrading the workflows in docs/automation.md).`
    ]);
  });

  test("suggests STORY_PACKAGE for a legacy STORY_REF that names a branch or commit", () => {
    const { root } = newRepo();
    writeWorkflow(root, "story-checks.yml", `env:\n  STORY_REF: "main"\n`);
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([
      `- [P3] Rename workflow STORY_REF: .github/workflows/story-checks.yml:2 sets the legacy STORY_REF to main; replace the line with STORY_PACKAGE: "github:danjdewhurst/story-skills#main" and copy the install step from the current template (see Upgrading the workflows in docs/automation.md).`
    ]);
  });

  test("skips an older or newer STORY_VERSION that an active STORY_PACKAGE overrides", () => {
    const { root } = newRepo();
    writeWorkflow(root, "a.yml", `env:\n  STORY_VERSION: "${older}"\n  STORY_PACKAGE: "github:danjdewhurst/story-skills#main"\n`);
    writeWorkflow(root, "a2.yml", `env:\n  STORY_VERSION: "${newer}"\n  STORY_PACKAGE: "github:danjdewhurst/story-skills#main"\n`);
    writeWorkflow(root, "b.yml", `env:\n  STORY_VERSION: "${older}"\n  # STORY_PACKAGE: "github:danjdewhurst/story-skills#main"\n`);
    const lines = pinLines(invoke(root, ["doctor"]).out);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(".github/workflows/b.yml:2 installs");
  });

  test("drops the healthy action when a workflow needs upgrading", () => {
    const { root } = newRepo();
    expect(invoke(root, ["doctor"]).out).toContain("Project is mechanically healthy");
    writeWorkflow(root, "story-checks.yml", `env:\n  STORY_VERSION: "${older}"\n`);
    const out = invoke(root, ["doctor"]).out;
    expect(out).not.toContain("Project is mechanically healthy");
    expect(out).toContain("Update workflow CLI version");
  });

  test("appears in doctor --fix and --json, but not in next or report", () => {
    const { root } = newRepo();
    writeWorkflow(root, "story-checks.yml", `env:\n  STORY_VERSION: "${older}"\n`);
    writeWorkflow(root, "review-copy.yml", `env:\n  STORY_VERSION: "${newer}"\n`);
    expect(invoke(root, ["doctor", "--fix", "--dry-run"]).out).toContain("Update workflow CLI version");
    expect(invoke(root, ["doctor", "--fix", "--dry-run"]).out).toContain("Update local CLI version");
    const json = JSON.parse(invoke(root, ["doctor", "--json"]).out);
    expect(json.data.actions.filter((item) => item.title === "Update workflow CLI version")).toHaveLength(1);
    expect(json.data.actions.filter((item) => item.title === "Update local CLI version")).toEqual([
      { priority: "P3", title: "Update local CLI version", detail: `.github/workflows/review-copy.yml:2 installs story-skills ${newer}, newer than this CLI (${VERSION}), so CI can report findings that story check here does not; ${cliUpdateHint(newer)}.` }
    ]);
    expect(json.data.actions.map((item) => item.title)).not.toContain("Project is mechanically healthy");
    expect(invoke(root, ["next"]).out).not.toContain("workflow");
    expect(invoke(root, ["report"]).out).not.toContain("workflow");
  });
});

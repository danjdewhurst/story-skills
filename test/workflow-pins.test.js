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
const newest = `${major}.${minor + 1}.0`;

function pinLines(out) {
  return out.split("\n").filter((line) => line.includes("workflow"));
}

// The update command in the newer-pin note when `script` runs doctor.
function spawnHint(script, root) {
  const result = spawnSync(process.execPath, [script, "doctor", root], { encoding: "utf8", timeout: 20000 });
  expect(result.status).toBe(0);
  const lines = pinLines(result.stdout);
  expect(lines).toHaveLength(1);
  return lines[0].replace(/^.* story check here does not; /, "").replace(/\.$/, "");
}

// A copy of the CLI's bin/ and src/ at `dir`, as an install lays it out.
function copyCli(dir) {
  const repoDir = path.resolve(import.meta.dir, "..");
  for (const name of ["bin", "src"]) {
    fs.cpSync(path.join(repoDir, name), path.join(dir, name), { recursive: true });
  }
  fs.copyFileSync(path.join(repoDir, "package.json"), path.join(dir, "package.json"));
  return path.join(dir, "bin", "story.js");
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
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([
      `- [P3] Update local CLI version: ../.github/workflows/story-checks.yml:2 installs story-skills ${newer}, newer than this CLI (${VERSION}), so CI can report findings that story check here does not; ${cliUpdateHint(newer)}.`
    ]);
  });

  test("gives one note for every newer pin, naming the newest release (#536)", () => {
    const { repo, root } = newRepo();
    writeWorkflow(repo, "a.yml", `env:\n  STORY_VERSION: "${newer}"\n`);
    writeWorkflow(root, "b.yml", `env:\n  STORY_VERSION: "${newer}"\n`);
    writeWorkflow(root, "c.yml", `env:\n  STORY_VERSION: "${newer}"\n`);
    const tail = `newer than this CLI (${VERSION}), so CI can report findings that story check here does not;`;
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([
      `- [P3] Update local CLI version: .github/workflows/b.yml:2, .github/workflows/c.yml:2 and ../.github/workflows/a.yml:2 install story-skills ${newer}, ${tail} ${cliUpdateHint(newer)}.`
    ]);
    writeWorkflow(root, "c.yml", `env:\n  STORY_VERSION: "${newest}"\n`);
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([
      `- [P3] Update local CLI version: .github/workflows/b.yml:2 (${newer}), .github/workflows/c.yml:2 (${newest}) and ../.github/workflows/a.yml:2 (${newer}) install story-skills releases ${tail} ${cliUpdateHint(newest)}.`
    ]);
  });

  test("orders a prerelease before its release and skips a pin that is not one exact release (#536)", () => {
    const { root } = newRepo();
    writeWorkflow(root, "a.yml", `env:\n  STORY_VERSION: "${VERSION}-rc.1"\n`);
    writeWorkflow(root, "b.yml", `env:\n  STORY_VERSION: "${newer}-rc.1"\n`);
    const skipped = ["latest", `^${VERSION}`, `${major}.${minor}`, `${newer}junk`, `${newer}.1`, "", `${major}.0${minor + 1}.0`, `${newer}-01`, `${major}.${minor}.9007199254740993`, `${newer}-${"a".repeat(65)}`];
    for (const [index, value] of skipped.entries()) {
      writeWorkflow(root, `skip-${index}.yml`, `env:\n  STORY_VERSION: "${value}"\n`);
    }
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([
      `- [P3] Update workflow CLI version: .github/workflows/a.yml:2 installs story-skills ${VERSION}-rc.1, older than this CLI (${VERSION}); after story check passes locally, change the line to STORY_VERSION: "${VERSION}".`,
      `- [P3] Update local CLI version: .github/workflows/b.yml:2 installs story-skills ${newer}-rc.1, newer than this CLI (${VERSION}), so CI can report findings that story check here does not; ${cliUpdateHint(`${newer}-rc.1`)}.`
    ]);
  });

  test("compares versions in semver order, ignoring build metadata", () => {
    const ordered = ["1.0.0-0", "1.0.0-2", "1.0.0-10", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.2.0", "2.0.0"];
    const parsed = ordered.map(parseVersion);
    for (const [i, left] of parsed.entries()) {
      for (const [j, right] of parsed.entries()) {
        expect([ordered[i], ordered[j], Math.sign(compareVersions(left, right))]).toEqual([ordered[i], ordered[j], Math.sign(i - j)]);
      }
    }
    expect(compareVersions(parseVersion("1.0.0+a"), parseVersion("v1.0.0+b"))).toBe(0);
    expect(parseVersion("v1.2.3-rc.1+build.4")).toEqual({ numbers: [1, 2, 3], pre: ["rc", "1"], text: "1.2.3-rc.1" });
    expect(parseVersion("1.2.3+build.4").text).toBe("1.2.3");
    for (const value of ["1.2.3-0a", `1.2.3-${"a".repeat(64)}`, `1.2.3+${"a".repeat(64)}`, "9007199254740991.0.0"]) {
      expect(parseVersion(value)).not.toBeNull();
    }
    const invalid = ["latest", "1.2", "1.2.3.4", "1.2.3-", "1.2.3-rc..1", "1.2.3 ", "x1.2.3", "", "01.2.3", "1.02.3", "1.2.03", "1.2.3-01", "9007199254740992.0.0", "1.2.3-9007199254740992", `1.2.3-${"a".repeat(65)}`, `1.2.3+${"a".repeat(65)}`];
    for (const value of invalid) {
      expect([value, parseVersion(value)]).toEqual([value, null]);
    }
  });

  test("names the update command for how the CLI was installed (#536)", () => {
    const missing = path.join(makeTempDir(), "missing");
    const at = (file, execPath = missing) => cliUpdateHint("9.1.0", file, execPath);
    const slash = (file) => file.replace(/\\/g, "/");
    const docs = "update it to 9.1.0 (see Update or pin the CLI in docs/getting-started.md)";
    expect(at("/$bunfs/root/story", "/home/linuxbrew/.linuxbrew/Cellar/story-skills/9.0.0/bin/story")).toBe("update it with brew upgrade story-skills");
    expect(at("B:\\~BUN\\root\\story.exe", "C:\\Users\\a\\story.exe")).toBe("download the 9.1.0 binary for your system from https://github.com/danjdewhurst/story-skills/releases/tag/v9.1.0");
    // npx and bunx would read the project's .npmrc or bunfig.toml, so their
    // users get the global install.
    expect(at("/home/a/.npm/_npx/3f99/node_modules/story-skills/src/workflows.js")).toBe("install that release with npm install -g story-skills@9.1.0");
    expect(at("C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\3f99\\node_modules\\story-skills\\src\\workflows.js")).toBe("install that release with npm install -g story-skills@9.1.0");
    expect(at("/tmp/bunx-1000-story-skills@latest/node_modules/story-skills/src/workflows.js")).toBe("install that release with bun add -g story-skills@9.1.0");
    expect(at("/home/a/.bun/install/global/node_modules/story-skills/src/workflows.js")).toBe("update it with bun add -g story-skills@9.1.0");
    const base = makeTempDir();
    expect(at(`${slash(base)}/lib/node_modules/story-skills/src/workflows.js`)).toBe("update it with npm install -g story-skills@9.1.0");
    expect(at("C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\story-skills\\src\\workflows.js")).toBe("update it with npm install -g story-skills@9.1.0");
    expect(at("C:\\nvm4w\\nodejs\\node_modules\\story-skills\\src\\workflows.js")).toBe("update it with npm install -g story-skills@9.1.0");
    expect(at(`${slash(base)}/elsewhere/node_modules/story-skills/src/workflows.js`)).toBe(docs);
    fs.writeFileSync(path.join(base, "package.json"), "{}\n");
    expect(at(`${slash(base)}/node_modules/story-skills/src/workflows.js`)).toBe(`update the story-skills dependency in ${slash(base)}/package.json to 9.1.0`);
    // Another package's dependency, pnpm's store, and a Yarn Plug'n'Play zip.
    expect(at(`${slash(base)}/node_modules/foo/node_modules/story-skills/src/workflows.js`)).toBe(docs);
    expect(at("/home/a/.local/share/pnpm/global/5/node_modules/.pnpm/story-skills@9.0.0/node_modules/story-skills/src/workflows.js")).toBe(docs);
    expect(at(`${slash(base)}/.yarn/cache/story-skills-npm-9.0.0-1a2b.zip/node_modules/story-skills/src/workflows.js`)).toBe(docs);
    expect(at("/home/a/.claude/plugins/cache/story-skills/story-skills/9.0.0/skills/story-maintenance/scripts/story.js")).toBe("update the Story Skills plugin or skills, which carry this bundled CLI (see Update the skills in docs/getting-started.md)");
  });

  test("tells a clone on a branch to pull and one on a release tag to check out the new tag (#536)", () => {
    const clone = makeTempDir();
    const at = () => cliUpdateHint("9.1.0", `${clone.replace(/\\/g, "/")}/src/workflows.js`);
    expect(at()).toBe("update it to 9.1.0 (see Update or pin the CLI in docs/getting-started.md)");
    fs.mkdirSync(path.join(clone, ".git"));
    fs.writeFileSync(path.join(clone, ".git", "HEAD"), "ref: refs/heads/main\n");
    expect(at()).toBe(`update the clone in ${clone.replace(/\\/g, "/")} with git pull`);
    fs.writeFileSync(path.join(clone, ".git", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
    expect(at()).toBe(`update the clone in ${clone.replace(/\\/g, "/")} with git fetch --tags and git checkout v9.1.0`);
    // A linked worktree's .git file names its git folder.
    fs.renameSync(path.join(clone, ".git"), path.join(clone, "worktree-git"));
    fs.writeFileSync(path.join(clone, ".git"), "gitdir: worktree-git\n");
    expect(at()).toContain("git checkout v9.1.0");
    fs.writeFileSync(path.join(clone, ".git"), "not a gitdir line\n");
    expect(at()).toBe("update it to 9.1.0 (see Update or pin the CLI in docs/getting-started.md)");
  });

  test("names the update command from where the running CLI's code is (#536)", () => {
    const { root } = newRepo();
    writeWorkflow(root, "story-checks.yml", `env:\n  STORY_VERSION: "${newer}"\n`);
    const repoDir = path.resolve(import.meta.dir, "..");
    expect(spawnHint(path.join(repoDir, "skills", "story-maintenance", "scripts", "story.js"), root)).toBe("update the Story Skills plugin or skills, which carry this bundled CLI (see Update the skills in docs/getting-started.md)");
    // bin/story.js runs the same src/workflows.js as this test.
    expect(spawnHint(path.join(repoDir, "bin", "story.js"), root)).toBe(cliUpdateHint(newer));
  });

  // The runtime reports a module's real path, which on Windows can differ
  // from a temporary folder's 8.3 short name.
  test.skipIf(process.platform === "win32")("names the update command for a copy of the CLI where each install puts it (#536)", () => {
    const { root } = newRepo();
    writeWorkflow(root, "story-checks.yml", `env:\n  STORY_VERSION: "${newer}"\n`);
    const base = fs.realpathSync(makeTempDir());
    const novel = path.join(base, "novel");
    fs.mkdirSync(novel);
    fs.writeFileSync(path.join(novel, "package.json"), "{}\n");
    expect(spawnHint(copyCli(path.join(novel, "node_modules", "story-skills")), root)).toBe(`update the story-skills dependency in ${novel}/package.json to ${newer}`);
    expect(spawnHint(copyCli(path.join(base, "lib", "node_modules", "story-skills")), root)).toBe(`update it with npm install -g story-skills@${newer}`);
    const clone = path.join(base, "story-skills");
    const script = copyCli(clone);
    expect(spawnHint(script, root)).toBe(`update it to ${newer} (see Update or pin the CLI in docs/getting-started.md)`);
    fs.mkdirSync(path.join(clone, ".git"));
    fs.writeFileSync(path.join(clone, ".git", "HEAD"), "ref: refs/heads/main\n");
    expect(spawnHint(script, root)).toBe(`update the clone in ${clone} with git pull`);
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

  test("keeps a STORY_REF prerelease, and shows a STORY_REF that is not one release only when it looks like a ref (#536)", () => {
    const { root } = newRepo();
    writeWorkflow(root, "a.yml", `env:\n  STORY_REF: "v${newer}-rc.1"\n`);
    writeWorkflow(root, "b.yml", `env:\n  STORY_REF: "v${newer}junk"\n`);
    writeWorkflow(root, "c.yml", `env:\n  STORY_REF: "0.22"\n`);
    writeWorkflow(root, "d.yml", `env:\n  STORY_REF: "${"x".repeat(101)}"\n`);
    writeWorkflow(root, "e.yml", `env:\n  STORY_REF: "ref\u001b[2J"\n`);
    writeWorkflow(root, "f.yml", `env:\n  STORY_REF: ""\n`);
    const copy = "and copy the install step from the current template (see Upgrading the workflows in docs/automation.md).";
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([
      `- [P3] Rename workflow STORY_REF: .github/workflows/a.yml:2 sets the legacy STORY_REF; change the line to STORY_VERSION: "${newer}-rc.1" ${copy}`,
      `- [P3] Rename workflow STORY_REF: .github/workflows/b.yml:2 sets the legacy STORY_REF to v${newer}junk; replace the line with STORY_PACKAGE: "github:danjdewhurst/story-skills#v${newer}junk" ${copy}`,
      `- [P3] Rename workflow STORY_REF: .github/workflows/c.yml:2 sets the legacy STORY_REF to 0.22; replace the line with STORY_PACKAGE: "github:danjdewhurst/story-skills#0.22" ${copy}`,
      `- [P3] Rename workflow STORY_REF: .github/workflows/d.yml:2 sets the legacy STORY_REF to a value that is not a release; replace the line with STORY_PACKAGE: "github:danjdewhurst/story-skills#<ref>" ${copy}`,
      `- [P3] Rename workflow STORY_REF: .github/workflows/e.yml:2 sets the legacy STORY_REF to a value that is not a release; replace the line with STORY_PACKAGE: "github:danjdewhurst/story-skills#<ref>" ${copy}`,
      `- [P3] Rename workflow STORY_REF: .github/workflows/f.yml:2 sets the legacy STORY_REF to an empty value; replace the line with STORY_PACKAGE: "github:danjdewhurst/story-skills#<ref>" ${copy}`
    ]);
  });

  test("counts only a non-empty STORY_PACKAGE, set for the pin's own workflow, job, or step (#536)", () => {
    const { root } = newRepo();
    writeWorkflow(root, "empty.yml", `env:\n  STORY_VERSION: "${newer}"\n  STORY_PACKAGE: ""\n`);
    const jobs = [
      "env:",
      `  STORY_VERSION: "${older}"`,
      "jobs:",
      "  a:",
      "    env:",
      '      STORY_PACKAGE: "github:danjdewhurst/story-skills#main"',
      "    steps:",
      "      - name: Install",
      "        env:",
      `          STORY_VERSION: "${older}"`,
      "  b:",
      "    steps:",
      "      - name: Install",
      "        env:",
      `          STORY_VERSION: "${older}"`,
      "        run: |",
      "          npm install --global \"${STORY_PACKAGE:-story-skills@$STORY_VERSION}\"",
      "",
      "      # A later step's override does not reach the step above.",
      "      - env:",
      '          STORY_PACKAGE: "github:danjdewhurst/story-skills#main"',
      `          STORY_VERSION: "${older}"`,
      "        run: story check .",
      ""
    ];
    writeWorkflow(root, "jobs.yml", jobs.join("\n"));
    // The workflow's own pin and job b's first step are not overridden; job
    // a's step and job b's second step are.
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([
      `- [P3] Update workflow CLI version: .github/workflows/jobs.yml:2 installs story-skills ${older}, older than this CLI (${VERSION}); after story check passes locally, change the line to STORY_VERSION: "${VERSION}".`,
      `- [P3] Update workflow CLI version: .github/workflows/jobs.yml:15 installs story-skills ${older}, older than this CLI (${VERSION}); after story check passes locally, change the line to STORY_VERSION: "${VERSION}".`,
      `- [P3] Update local CLI version: .github/workflows/empty.yml:2 installs story-skills ${newer}, newer than this CLI (${VERSION}), so CI can report findings that story check here does not; ${cliUpdateHint(newer)}.`
    ]);
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

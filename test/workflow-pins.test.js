import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { VERSION } from "../src/version.js";
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

  test("is quiet for a current or newer pin, a commented pin, or no workflows", () => {
    const { repo, root } = newRepo();
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([]);
    writeWorkflow(repo, "a.yml", `env:\n  STORY_VERSION: "${VERSION}"\n`);
    writeWorkflow(root, "b.yaml", `env:\n  STORY_VERSION: '${newer}'\n  # STORY_VERSION: "0.1.0"\n`);
    writeWorkflow(root, "notes.txt", `STORY_VERSION: "0.1.0"\n`);
    expect(pinLines(invoke(root, ["doctor"]).out)).toEqual([]);
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

  test("skips an older STORY_VERSION that an active STORY_PACKAGE overrides", () => {
    const { root } = newRepo();
    writeWorkflow(root, "a.yml", `env:\n  STORY_VERSION: "${older}"\n  STORY_PACKAGE: "github:danjdewhurst/story-skills#main"\n`);
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
    expect(invoke(root, ["doctor", "--fix", "--dry-run"]).out).toContain("Update workflow CLI version");
    const json = JSON.parse(invoke(root, ["doctor", "--json"]).out);
    expect(json.data.actions.filter((item) => item.title === "Update workflow CLI version")).toHaveLength(1);
    expect(invoke(root, ["next"]).out).not.toContain("workflow");
    expect(invoke(root, ["report"]).out).not.toContain("workflow");
  });
});

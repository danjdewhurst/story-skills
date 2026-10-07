import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { createStoryProject, migrateProject, projectActions, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages } from "./helpers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(repoRoot, "examples");

function newProject(title = "Bugs") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function copyExample(name) {
  const target = path.join(makeTempDir(), name);
  fs.cpSync(path.join(examplesRoot, name), target, { recursive: true });
  return target;
}

function editFile(file, edit) {
  fs.writeFileSync(file, edit(fs.readFileSync(file, "utf8")), "utf8");
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("#57 migrate creates plot/timeline.md", () => {
  test("a project missing the timeline validates after one migrate", () => {
    const root = copyExample("the-unraveled-thread");
    fs.rmSync(path.join(root, "plot", "timeline.md"));
    expect(messages(validateProject(root).errors)).toContain("Missing required path: plot/timeline.md (story migrate adds missing registries)");
    const result = migrateProject(root);
    expect(result.changed).toContain(path.join(root, "plot", "timeline.md"));
    expect(parseFrontmatter(fs.readFileSync(path.join(root, "plot", "timeline.md"), "utf8")).data.type).toBe("timeline");
    expect(messages(validateProject(root).errors).filter((error) => error.startsWith("Missing required path"))).toEqual([]);
  });
});

describe("#75 migrate on a broken or newer story.md", () => {
  test("an unparseable story.md is reported by name", () => {
    const root = newProject();
    editFile(path.join(root, "story.md"), (text) => text.replace("---\n", "---\ntitle: dup\n"));
    expect(() => migrateProject(root)).toThrow("Cannot migrate: fix this file first (story validate reports it):\n- story.md: Duplicate frontmatter key: title");
  });

  test("a newer schema-version is refused, not downgraded", () => {
    const root = newProject();
    const storyPath = path.join(root, "story.md");
    editFile(storyPath, (text) => text.replace("schema-version: 2", "schema-version: 3"));
    const before = fs.readFileSync(storyPath, "utf8");
    expect(() => migrateProject(root)).toThrow("story.md uses schema-version 3, newer than this CLI (2); upgrade story-skills");
    expect(fs.readFileSync(storyPath, "utf8")).toBe(before);
    expect(messages(validateProject(root).errors)).toContain("story.md uses schema-version 3, newer than this CLI (2); upgrade story-skills");
  });

  test("an older schema-version is still upgraded", () => {
    const root = newProject();
    editFile(path.join(root, "story.md"), (text) => text.replace("schema-version: 2", "schema-version: 1"));
    migrateProject(root);
    expect(fs.readFileSync(path.join(root, "story.md"), "utf8")).toContain("schema-version: 2\n");
  });
});

describe("project structure", () => {
  test("migrate restores every folder init creates when it upgrades an older schema", () => {
    const root = sweepProject();
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace("schema-version: 2", "schema-version: 1"));
    for (const dir of ["worldbuilding/locations", "worldbuilding/systems", "plot/arcs"]) {
      fs.rmSync(path.join(root, dir), { recursive: true });
    }
    migrateProject(root);
    for (const dir of ["worldbuilding/locations", "worldbuilding/systems", "plot/arcs"]) {
      expect(fs.existsSync(path.join(root, dir))).toBe(true);
    }
  });

  test("migrate leaves a current project's missing empty folders alone, as doctor --fix does", () => {
    // A git clone of a project has none of the empty folders init made.
    const root = sweepProject();
    for (const dir of ["worldbuilding/locations", "worldbuilding/systems", "plot/arcs", "glossary/terms"]) {
      fs.rmSync(path.join(root, dir), { recursive: true });
    }
    expect(invoke(root, ["migrate", "--dry-run"]).out).toBe("Dry run: story migrate would make no changes; nothing was written\n");
    expect(invoke(root, ["doctor", "--fix", "--dry-run"]).out).toContain("- No safe repairs needed\n");
    expect(invoke(root, ["migrate"]).out).toBe("Project already uses the current schema\n");
    expect(fs.existsSync(path.join(root, "plot", "arcs"))).toBe(false);
  });
});

describe("sweep fixes", () => {
  test("a missing registry points to story migrate, and abandoned stories get no draft suggestion", () => {
    const root = sweepProject();
    fs.rmSync(path.join(root, "continuity", "clues"), { recursive: true });
    expect(messages(validateProject(root).errors)).toContain("Missing required path: continuity/clues/_index.md (story migrate adds missing registries)");
    migrateProject(root);
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/status: \w+/, "status: abandoned"));
    expect(projectActions(root).actions.map((item) => item.title).join("\n")).not.toContain("Draft chapter");
  });
});

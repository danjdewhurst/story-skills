import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../src/frontmatter.js";
import { createStoryProject, migrateProject, validateProject } from "../src/story.js";
import { makeTempDir, messages } from "./helpers.js";

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

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createEntity, createStoryProject, reindexProject, renameEntity, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages } from "./helpers.js";

function newProject(title = "Bugs") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function editFile(file, edit) {
  fs.writeFileSync(file, edit(fs.readFileSync(file, "utf8")), "utf8");
}

const EXAMPLES = path.join(import.meta.dir, "..", "examples");

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function copyExample(name) {
  const root = path.join(makeTempDir(), name);
  fs.cpSync(path.join(EXAMPLES, name), root, { recursive: true });
  return root;
}

function initProject() {
  const cwd = makeTempDir();
  expect(invoke(cwd, ["init", "Safety", "--dir", "p"]).code).toBe(0);
  return path.join(cwd, "p");
}

describe("#65 reindex keeps registry frontmatter it does not own", () => {
  test("unknown keys and comments survive reindex, add, and CRLF registries", () => {
    const root = newProject();
    const index = path.join(root, "characters", "_index.md");
    editFile(index, (text) => text.replace(/^story: .*$/m, "$&\n# owner: dan\ncustom: keep"));
    reindexProject(root);
    createEntity(root, { kind: "character", name: "Mara" });
    const text = fs.readFileSync(index, "utf8");
    expect(text).toContain("# owner: dan\ncustom: keep\n");
    expect(text).toContain("[mara](mara.md)");
    expect(reindexProject(root).changed).toEqual([]);

    const chapters = path.join(root, "chapters", "_index.md");
    editFile(chapters, (text) => text.replace("story: bugs", "story: stale\nextra: 1").replace(/\n/g, "\r\n"));
    reindexProject(root);
    const crlf = fs.readFileSync(chapters, "utf8");
    expect(crlf).toContain("type: chapter-registry\r\nstory: bugs\r\nextra: 1\r\n---\r\n");
    expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");
  });
});

describe("retitled story", () => {
  test("validate points at story reindex, which clears the stale story ids", () => {
    const root = createStoryProject({ cwd: makeTempDir(), title: "Gull" }).root;
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^title: .*$/m, 'title: "The Keeper of Gull Rock"'));

    const before = validateProject(root);
    expect(before.ok).toBe(false);
    expect(messages(before.errors)).toContain(
      "characters/_index.md story must be the-keeper-of-gull-rock (run story reindex after changing the story.md title)"
    );
    expect(messages(before.errors).join("\n")).toContain("continuity/state.md story must be the-keeper-of-gull-rock (run story reindex");

    reindexProject(root);
    expect(validateProject(root).ok).toBe(true);
  });
});

describe("damaged registries point at reindex (#199)", () => {
  test("validate and rename name story reindex for an emptied registry", () => {
    const root = copyExample("harbor-of-second-light");
    fs.writeFileSync(path.join(root, "characters", "_index.md"), "");
    expect(messages(validateProject(root).errors)).toContain(`${"characters/_index.md"}: is missing YAML frontmatter (it is a registry: run story reindex to rebuild it)`);
    expect(() => renameEntity(root, { kind: "character", id: "ilya-venn", name: "Zed Q" }))
      .toThrow(`${"characters/_index.md"} is missing YAML frontmatter (it is a registry: run story reindex to rebuild it); nothing was changed`);
    expect(invoke(root, ["reindex"]).code).toBe(0);
    expect(validateProject(root).ok).toBe(true);
  });

  test("a note outside the registries gets no reindex hint", () => {
    const root = initProject();
    createEntity(root, { kind: "character", name: "Bo" });
    fs.writeFileSync(path.join(root, "characters", "bo.md"), "# Bo\n");
    expect(() => renameEntity(root, { kind: "character", id: "bo", name: "Bob" })).toThrow(/^(?![\s\S]*reindex)/);
  });
});

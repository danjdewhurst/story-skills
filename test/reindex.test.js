import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { computeWordCounts, createEntity, createStoryProject, reindexProject, renameEntity, validateProject } from "../src/story.js";
import { CHMOD_IGNORED, makeTempDir, memoryIo, messages } from "./helpers.js";

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

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

function appendProse(root, file, prose) {
  fs.appendFileSync(path.join(root, file), `\n${prose}\n`);
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

describe("a refused write lists the files it changed (#722)", () => {
  test.skipIf(CHMOD_IGNORED)("reindex --json lists the registry it rewrote before a read-only one refused the run", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "scene", name: "Opening", chapter: "chapter-01" });
    const chapterIndex = path.join(root, "chapters", "_index.md");
    const sceneIndex = path.join(root, "scenes", "_index.md");
    editFile(chapterIndex, (text) => text.replace("| One |", "| Stale |"));
    editFile(sceneIndex, (text) => text.replace("Opening", "Stale"));
    fs.chmodSync(sceneIndex, 0o444);
    try {
      const result = invoke(root, ["reindex", "--json"]);
      expect(result.code).toBe(4);
      expect(JSON.parse(result.out).writes).toEqual([chapterIndex]);
      expect(fs.readFileSync(chapterIndex, "utf8")).not.toContain("Stale");
    } finally {
      fs.chmodSync(sceneIndex, 0o644);
    }
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

describe("registries", () => {
  test("reindex keeps hand-written sections", () => {
    const root = sweepProject();
    const index = path.join(root, "characters", "_index.md");
    fs.appendFileSync(index, "\n## My Notes\n\nKeep this.\n");
    createEntity(root, { kind: "character", name: "Mara" });
    const text = fs.readFileSync(index, "utf8");
    expect(text).toContain("## My Notes\n\nKeep this.");
    expect(text).toContain("[mara](mara.md)");
    expect(reindexProject(root).changed).toEqual([]);
  });

  test("reindex keeps CRLF registries CRLF", () => {
    const root = sweepProject();
    const index = path.join(root, "characters", "_index.md");
    fs.writeFileSync(index, fs.readFileSync(index, "utf8").replace(/\n/g, "\r\n"));
    createEntity(root, { kind: "character", name: "Mara" });
    const text = fs.readFileSync(index, "utf8");
    expect(text).toContain("[mara](mara.md)");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });
});

describe("sweep fixes", () => {
  test("the chapter total heading never piles up across word-count changes", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const index = path.join(root, "chapters", "_index.md");
    for (const words of ["one two three", "four", "five six"]) {
      appendProse(root, "chapters/chapter-01.md", words);
      computeWordCounts(root, { write: true });
    }
    const text = fs.readFileSync(index, "utf8");
    expect(text.match(/## Total Word Count/g)).toHaveLength(1);
    expect(text).toContain("## Total Word Count: 6");
  });

  test("reindex repairs stale total headings left by 0.10.0", () => {
    const root = sweepProject();
    const index = path.join(root, "chapters", "_index.md");
    fs.appendFileSync(index, "\n## Total Word Count: 4\n\n## Total Word Count: 3\n\n## Notes\n\nKeep.\n");
    reindexProject(root);
    const text = fs.readFileSync(index, "utf8");
    expect(text.match(/## Total Word Count/g)).toHaveLength(1);
    expect(text).toContain("## Notes\n\nKeep.");
  });

  test("a custom section above the title does not duplicate the title", () => {
    const root = sweepProject();
    const index = path.join(root, "characters", "_index.md");
    fs.writeFileSync(index, fs.readFileSync(index, "utf8").replace("# Characters", "## Preface\n\npre text\n\n# Characters"));
    reindexProject(root);
    const text = fs.readFileSync(index, "utf8");
    expect(text.match(/^# Characters$/gm)).toHaveLength(1);
    expect(text).toContain("## Preface\n\npre text");
  });

  test("a second section named like a generated one is kept", () => {
    const root = sweepProject();
    const index = path.join(root, "characters", "_index.md");
    fs.appendFileSync(index, "\n## Registry\n\nMy own registry notes.\n");
    reindexProject(root);
    expect(fs.readFileSync(index, "utf8")).toContain("My own registry notes.");
    expect(reindexProject(root).changed).toEqual([]);
  });

  test("reindex keeps hand-written sections headed like generated ones with a number", () => {
    const root = sweepProject();
    const index = path.join(root, "characters", "_index.md");
    fs.appendFileSync(index, "\n## Registry: 2\n\nMy registry notes from March.\n\n## Notes\n\n```\n## Family Trees\n```\n\nAfter the fence.\n");
    reindexProject(root);
    const text = fs.readFileSync(index, "utf8");
    expect(text).toContain("## Registry: 2\n\nMy registry notes from March.");
    expect(text).toContain("## Notes\n\n```\n## Family Trees\n```\n\nAfter the fence.");
    expect(reindexProject(root).changed).toEqual([]);
  });

  test("an unclosed fence in a registry section does not duplicate headings", () => {
    const root = sweepProject();
    const index = path.join(root, "characters", "_index.md");
    fs.writeFileSync(index, fs.readFileSync(index, "utf8").replace("## Relationship Map", "## My Notes\n\n```\nunclosed fence\n\n## Relationship Map"));
    reindexProject(root);
    expect(fs.readFileSync(index, "utf8").match(/^## Relationship Map$/gm)).toHaveLength(1);
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { importManuscript } from "../src/import.js";
import { createStoryProject, validateLinks, validateProject } from "../src/story.js";
import { UNDO_LOG } from "../src/files.js";
import { makeTempDir, memoryIo, treeSnapshot, writeMarkdown } from "./helpers.js";

// story collect (#885): a collection's story.md `stories` names its story
// projects, and collect rewrites the collection's chapters from them.

function project(parent, dir, title, storyFields = "") {
  const created = createStoryProject({ cwd: parent, title, dir, force: false });
  const storyPath = path.join(created.root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(`title: ${title}\n`, `title: ${title}\n${storyFields}`), "utf8");
  return created.root;
}

function chapter(root, number, title, body, fields = "") {
  writeMarkdown(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), `number: ${number}\nstatus: draft\ntitle: ${title}${fields}`, `# Chapter ${number}: ${title}\n\n## Chapter Text\n\n${body}\n`);
}

function setStories(root, stories) {
  const storyPath = path.join(root, "story.md");
  const text = fs.readFileSync(storyPath, "utf8").replace(/^stories:\n(?: {2}- .*\n)*/m, "");
  const list = stories.length === 0 ? "stories: []\n" : `stories:\n${stories.map((entry) => `  - ${entry}\n`).join("")}`;
  fs.writeFileSync(storyPath, text.replace(/^title: (.*)\n/m, (line) => `${line}${list}`), "utf8");
}

// Two stories beside a collection that names them: Low Tide by the
// collection's own author, Salt by another writer in two chapters.
function shelf() {
  const parent = makeTempDir();
  const lowTide = project(parent, "low-tide", "Low Tide", "author: Ada Writer\n");
  chapter(lowTide, 1, "Low Tide", "The tide went out. <!-- check tide tables -->");
  const salt = project(parent, "salt", "Salt", "author: Ben Other\n");
  chapter(salt, 1, "Morning", "Ruth raked the salt.");
  chapter(salt, 2, "Evening", "The pans were dry.");
  const collection = project(parent, "collection", "Salt and Lantern", "author: Ada Writer\n");
  setStories(collection, ["../low-tide", "../salt"]);
  return { parent, lowTide, salt, collection };
}

function run(root, ...args) {
  const io = memoryIo(root);
  const code = runCli(["collect", ...args], io);
  return { code, out: io.output(), err: io.error() };
}

function readChapter(root, number) {
  return fs.readFileSync(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), "utf8");
}

function chapterFiles(root) {
  return fs.readdirSync(path.join(root, "chapters")).filter((name) => name !== "_index.md").sort();
}

describe("story collect (#885)", () => {
  test("writes each story as one chapter, as import makes one from the story's chapter file", () => {
    const { parent, collection } = shelf();
    const result = run(collection);
    expect(result.code).toBe(0);
    expect(result.out).toBe('Collected 2 stories:\n- ../low-tide: chapter-01 "Low Tide" (added)\n- ../salt: chapter-02 "Salt" (added)\n');
    expect(chapterFiles(collection)).toEqual(["chapter-01.md", "chapter-02.md"]);

    const first = parseFrontmatter(readChapter(collection, 1));
    // The collection's own author is credited once, on its title page.
    expect(first.data.author).toBeUndefined();
    expect(first.data["collected-from"]).toBe("../low-tide");
    expect(first.data["collected-hash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(first.data["word-count"]).toBe(4);
    expect(first.body.trimStart()).toBe("# Chapter 1: Low Tide\n\n## Chapter Text\n\nThe tide went out. <!-- check tide tables -->\n");

    const second = parseFrontmatter(readChapter(collection, 2));
    expect(second.data.title).toBe("Salt");
    expect(second.data.author).toBe("Ben Other");
    expect(second.body).toContain("Ruth raked the salt.\n\n* * *\n\nThe pans were dry.\n");

    // The same as importing the story's chapter file by hand, less the
    // collect fields.
    const folder = path.join(parent, "by-hand");
    fs.mkdirSync(folder);
    fs.copyFileSync(path.join(parent, "low-tide", "chapters", "chapter-01.md"), path.join(folder, "01-low-tide.md"));
    const imported = importManuscript({ source: folder, title: "By Hand", cwd: parent, dir: "imported" });
    const byHand = parseFrontmatter(fs.readFileSync(path.join(imported.root, "chapters", "chapter-01.md"), "utf8"));
    const { "collected-from": from, "collected-hash": hash, ...collectedData } = first.data;
    expect(collectedData).toEqual(byHand.data);
    expect(first.body).toBe(byHand.body);

    expect(fs.readFileSync(path.join(collection, "chapters", "_index.md"), "utf8")).toContain("| 2 | Salt |");
    expect(validateProject(collection).errors).toEqual([]);
    expect(validateLinks(collection).errors).toEqual([]);
  });

  test("reports which stories changed since the last run", () => {
    const { salt, collection } = shelf();
    run(collection);
    expect(run(collection).out).toBe('Collected 2 stories: no story changed since the last run\n- ../low-tide: chapter-01 "Low Tide" (unchanged)\n- ../salt: chapter-02 "Salt" (unchanged)\n');
    chapter(salt, 2, "Evening", "The pans were dry at last.");
    const result = run(collection, "--json");
    const json = JSON.parse(result.out);
    expect(json.ok).toBe(true);
    expect(json.data.stories.map((story) => [story.path, story.status])).toEqual([["../low-tide", "unchanged"], ["../salt", "changed"]]);
    expect(json.data.changes.map((change) => change.path)).toEqual(["chapters/_index.md", "chapters/chapter-02.md"]);
    expect(readChapter(collection, 2)).toContain("The pans were dry at last.");
  });

  test("--dry-run lists the changes and writes nothing", () => {
    const { collection } = shelf();
    const before = treeSnapshot(collection);
    const result = run(collection, "--dry-run");
    expect(result.code).toBe(0);
    expect(result.out).toContain('- ../salt: chapter-02 "Salt" (added)\n');
    expect(result.out).toContain("create  chapters/chapter-01.md\ncreate  chapters/chapter-02.md\n");
    expect(result.out).toContain("Dry run: story collect would make 3 changes; nothing was written\n");
    expect(treeSnapshot(collection)).toEqual(before);
  });

  test("keeps a chapter written by hand, and fills the other numbers in list order", () => {
    const { collection } = shelf();
    chapter(collection, 2, "Interlude", "A page between the stories.");
    const handWritten = readChapter(collection, 2);
    expect(run(collection).code).toBe(0);
    expect(chapterFiles(collection)).toEqual(["chapter-01.md", "chapter-02.md", "chapter-03.md"]);
    expect(readChapter(collection, 2)).toBe(handWritten);
    expect(parseFrontmatter(readChapter(collection, 3)).data["collected-from"]).toBe("../salt");
  });

  test("warns about a hand-written chapter that has a story's title", () => {
    const { collection } = shelf();
    chapter(collection, 1, "Low Tide", "An old copy.");
    const result = run(collection);
    expect(result.code).toBe(0);
    expect(result.err).toContain("chapters/chapter-01.md has the title of story ../low-tide but no collected-from, so story collect left it and wrote the story as chapter-02");
    expect(result.err).toContain("[collect-hand-written-copy]");
  });

  test("moves a story with the list and removes the chapter of a story taken out", () => {
    const { collection } = shelf();
    run(collection);
    setStories(collection, ["../salt"]);
    const result = run(collection);
    expect(result.code).toBe(0);
    expect(result.out).toBe('Collected 1 story:\n- ../salt: chapter-01 "Salt" (unchanged; moved from chapter-02)\n- ../low-tide: removed, as it is no longer in story.md stories (was chapter-01)\n');
    expect(chapterFiles(collection)).toEqual(["chapter-01.md"]);
    expect(parseFrontmatter(readChapter(collection, 1)).data.title).toBe("Salt");
    setStories(collection, []);
    expect(run(collection).code).toBe(0);
    expect(chapterFiles(collection)).toEqual([]);
  });

  test("keeps the fields of a collected chapter it does not own", () => {
    const { collection } = shelf();
    run(collection);
    const file = path.join(collection, "chapters", "chapter-01.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: draft", "status: final"), "utf8");
    setStories(collection, ["../salt", "../low-tide"]);
    expect(run(collection).code).toBe(0);
    expect(parseFrontmatter(readChapter(collection, 2)).data).toMatchObject({ title: "Low Tide", number: 2, status: "final" });
  });

  test("refuses to replace an edit made in the collection, unless --force", () => {
    const { collection } = shelf();
    run(collection);
    const file = path.join(collection, "chapters", "chapter-02.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Ruth raked", "Ruth swept"), "utf8");
    const before = treeSnapshot(collection);
    const refused = run(collection);
    expect(refused.code).toBe(4);
    expect(refused.err).toContain("chapters/chapter-02.md was changed in the collection since story collect wrote it");
    expect(treeSnapshot(collection)).toEqual(before);
    const forced = run(collection, "--force");
    expect(forced.code).toBe(0);
    expect(forced.out).toContain('- ../salt: chapter-02 "Salt" (unchanged; replaced the edit made in the collection)');
    expect(readChapter(collection, 2)).toContain("Ruth raked the salt.");
  });

  test("a missing story project is an error, and nothing is written", () => {
    const { collection } = shelf();
    setStories(collection, ["../low-tide", "../lantern"]);
    const before = treeSnapshot(collection);
    const result = run(collection);
    expect(result.code).toBe(3);
    expect(result.err).toContain("story.md stories ../lantern is not a story project: missing story.md");
    expect(treeSnapshot(collection)).toEqual(before);
    expect(validateLinks(collection).errors.map((error) => error.code)).toEqual(["collection-story-not-project"]);
  });

  test("story.md without stories is an error", () => {
    const parent = makeTempDir();
    const root = project(parent, "book", "Book");
    const result = run(root);
    expect(result.code).toBe(3);
    expect(result.err).toContain("story.md has no stories list");
  });

  test("checks the stories list stays beside the collection", () => {
    const { parent, collection } = shelf();
    const outside = makeTempDir();
    project(outside, "far", "Far");
    fs.symlinkSync(path.join(outside, "far"), path.join(parent, "linked"));
    setStories(collection, ["../low-tide", "../low-tide/", ".", "chapters", "/tmp/story", "..\\salt", `${path.relative(collection, outside)}/far`, "../linked"]);
    const codes = validateLinks(collection).errors.map((error) => error.code);
    expect(codes).toEqual([
      "collection-story-duplicate",
      "collection-story-self",
      "collection-story-self",
      "collection-story-outside",
      "collection-story-backslash",
      "collection-story-outside",
      "collection-story-outside"
    ]);
    const storyPath = path.join(collection, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^stories:\n(?: {2}- .*\n)*/m, "stories: ../salt\n"), "utf8");
    expect(validateProject(collection).errors.map((error) => error.code)).toContain("field-not-list");
  });

  test("a story with no chapters is an error", () => {
    const { parent, collection } = shelf();
    project(parent, "lantern", "Lantern");
    setStories(collection, ["../lantern"]);
    const result = run(collection);
    expect(result.code).toBe(3);
    expect(result.err).toContain("story ../lantern has no chapters yet");
  });

  test("leaves no undo log after a run", () => {
    const { collection } = shelf();
    expect(run(collection).code).toBe(0);
    expect(fs.existsSync(path.join(collection, UNDO_LOG))).toBe(false);
  });
});

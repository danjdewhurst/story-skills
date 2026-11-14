import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { importManuscript } from "../src/import.js";
import { createStoryProject, validateLinks, validateProject } from "../src/story.js";
import { UNDO_LOG } from "../src/files.js";
import { LOCK_FILE } from "../src/lock.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { SYMLINKS_SUPPORTED, makeTempDir, memoryIo, treeSnapshot, writeMarkdown } from "./helpers.js";

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
    chapter(collection, 1, "LOW TIDE", "An old copy.");
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

  test("checks the stories list names sibling story projects", () => {
    const { parent, collection } = shelf();
    fs.mkdirSync(path.join(parent, "drafts"));
    project(path.join(parent, "drafts"), "deep", "Deep");
    fs.writeFileSync(path.join(parent, "notes.md"), "Notes.\n", "utf8");
    fs.mkdirSync(path.join(parent, "empty"));
    setStories(collection, ["../low-tide", "../low-tide/", ".", "chapters", "/tmp/story", "..\\salt", "../drafts/deep", "../notes.md", "../empty", "../missing"]);
    const codes = validateLinks(collection).errors.map((error) => error.code);
    expect(codes).toEqual([
      "collection-story-duplicate",
      "collection-story-self",
      "collection-story-self",
      "collection-story-outside",
      "collection-story-backslash",
      "collection-story-outside",
      "collection-story-not-project",
      "collection-story-not-project",
      "collection-story-not-project"
    ]);
    const storyPath = path.join(collection, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^stories:\n(?: {2}- .*\n)*/m, "stories: ../salt\n"), "utf8");
    expect(validateProject(collection).errors.map((error) => error.code)).toContain("field-not-list");
  });

  test("a NUL or a line break in a stories entry is a finding, not a crash", () => {
    const { collection } = shelf();
    setStories(collection, ['"../a\u0000b"', '"../a\\nb"']);
    const links = validateLinks(collection);
    expect(links.errors.map((error) => error.code)).toEqual(["collection-story-not-project", "collection-story-not-project"]);
    expect(links.errors[1].message).toContain("story.md stories ../a\\u000ab holds a control character");
    expect(run(collection).code).toBe(3);
  });

  test("an unreadable story.md and too many stories are findings", () => {
    const { lowTide, collection } = shelf();
    fs.writeFileSync(path.join(lowTide, "story.md"), "---\ntitle: A\ntitle: B\n---\n", "utf8");
    setStories(collection, ["../low-tide"]);
    expect(validateLinks(collection).errors.map((error) => error.code)).toEqual(["collection-story-unreadable"]);
    setStories(collection, Array.from({ length: 501 }, (_, index) => `../story-${index}`));
    expect(validateLinks(collection).errors.map((error) => error.code)).toEqual(["collection-too-many-stories"]);
  });

  test.skipIf(!SYMLINKS_SUPPORTED)("a symlinked story folder that leads out of the parent folder is outside", () => {
    const { parent, collection } = shelf();
    const outside = makeTempDir();
    project(outside, "far", "Far");
    fs.symlinkSync(path.join(outside, "far"), path.join(parent, "linked"), "dir");
    setStories(collection, ["../linked", `${path.relative(collection, outside).split(path.sep).join("/")}/far`]);
    expect(validateLinks(collection).errors.map((error) => error.code)).toEqual(["collection-story-outside", "collection-story-outside"]);
  });

  test("a story with no chapters is an error", () => {
    const { parent, collection } = shelf();
    project(parent, "lantern", "Lantern");
    setStories(collection, ["../lantern"]);
    const result = run(collection);
    expect(result.code).toBe(3);
    expect(result.err).toContain("story ../lantern has no chapters yet");
  });

  test("a second run with nothing changed writes nothing, also for a story by another writer", () => {
    const { collection } = shelf();
    run(collection);
    const before = treeSnapshot(collection);
    const json = JSON.parse(run(collection, "--json").out);
    expect(json.data.changes).toEqual([]);
    expect(treeSnapshot(collection)).toEqual(before);
    expect(run(collection).out).toStartWith("Collected 2 stories: no story changed since the last run\n");
  });

  test("keeps a collected chapter's frontmatter text, comments and all", () => {
    const { salt, collection } = shelf();
    run(collection);
    const file = path.join(collection, "chapters", "chapter-02.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: draft", "status: final # checked").replace('pov: ""', "pov: ruth").replace("characters: []", "characters: [ruth]"), "utf8");
    chapter(salt, 2, "Evening", "The pans were dry at last.");
    expect(run(collection).code).toBe(0);
    const text = readChapter(collection, 2);
    expect(text).toContain("pov: ruth\n");
    expect(text).toContain("characters: [ruth]\n");
    expect(text).toContain("status: final # checked\n");
    expect(text).toContain("The pans were dry at last.");
    expect(parseFrontmatter(text).data.author).toBe("Ben Other");
  });

  test("refuses to drop text added above ## Chapter Text in a collected chapter", () => {
    const { collection } = shelf();
    run(collection);
    const file = path.join(collection, "chapters", "chapter-01.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("## Chapter Text", "## Outline\n\n- Editor note: keep\n\n## Chapter Text"), "utf8");
    const result = run(collection);
    expect(result.code).toBe(4);
    expect(result.err).toContain("chapters/chapter-01.md was changed in the collection");
  });

  test("refuses to drop an edited chapter of a story taken out of the list; --force saves a snapshot first", () => {
    const { collection } = shelf();
    run(collection);
    const file = path.join(collection, "chapters", "chapter-01.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("The tide went out.", "The tide went far out."), "utf8");
    setStories(collection, ["../salt"]);
    const before = treeSnapshot(collection);
    expect(run(collection).code).toBe(4);
    expect(treeSnapshot(collection)).toEqual(before);
    const json = JSON.parse(run(collection, "--force", "--json").out);
    expect(json.ok).toBe(true);
    expect(json.data.removed).toEqual([{ path: "../low-tide", chapter: "chapter-01", file: "chapters/chapter-01.md", replacedEdit: true }]);
    expect(json.data.stories[0]).toMatchObject({ path: "../salt", chapter: "chapter-01", from: "chapter-02", status: "unchanged", replacedEdit: false });
    expect(json.data.snapshot).toEqual({ id: "before-collect-1", dir: ".snapshots/before-collect-1", restore: "story snapshot --restore before-collect-1" });
    expect(fs.readFileSync(path.join(collection, ".snapshots", "before-collect-1", "chapters", "chapter-01.md"), "utf8")).toContain("The tide went far out.");
    expect(validateAgainstSchema(json, JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8")))).toEqual([]);
  });

  test("a story whose folder is renamed keeps its chapter and the fields set on it", () => {
    const { parent, collection } = shelf();
    run(collection);
    const file = path.join(collection, "chapters", "chapter-02.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: draft", "status: final"), "utf8");
    fs.renameSync(path.join(parent, "salt"), path.join(parent, "salt-works"));
    setStories(collection, ["../low-tide", "../salt-works"]);
    const json = JSON.parse(run(collection, "--json").out);
    expect(json.data.stories[1]).toMatchObject({ path: "../salt-works", status: "unchanged", from: null });
    expect(json.data.removed).toEqual([]);
    expect(parseFrontmatter(readChapter(collection, 2)).data).toMatchObject({ status: "final", "collected-from": "../salt-works" });
  });

  test("refuses to move or remove a collected chapter that scenes or other records name", () => {
    const { collection } = shelf();
    run(collection);
    writeMarkdown(path.join(collection, "characters", "ruth.md"), "id: ruth\nname: Ruth\nrole: supporting\nstatus: deceased\ndied-in: chapter-02", "# Ruth\n");
    writeMarkdown(path.join(collection, "scenes", "chapter-01-scene-01.md"), "title: The Flats\nchapter: chapter-01\nscene: 1\nstatus: draft", "# The Flats\n");
    setStories(collection, ["../salt", "../low-tide"]);
    const before = treeSnapshot(collection);
    const result = run(collection);
    expect(result.code).toBe(4);
    expect(result.err).toContain("- chapter-02 (story ../salt) would move to chapter-01, but characters/ruth.md names it");
    expect(result.err).toContain("- chapter-01 (story ../low-tide) would move to chapter-02, but scenes/chapter-01-scene-01.md names it");
    expect(treeSnapshot(collection)).toEqual(before);
  });

  test("a story project with a stopped change, or a chapter that does not parse, is refused", () => {
    const { lowTide, collection } = shelf();
    fs.writeFileSync(path.join(lowTide, UNDO_LOG), `${JSON.stringify({ command: "story collect", started: "2026-11-14T00:00:00Z" })}\n`, { mode: 0o600 });
    const stopped = run(collection);
    expect(stopped.code).toBe(4);
    expect(stopped.err).toContain("story collect stopped part way in story ../low-tide");
    fs.rmSync(path.join(lowTide, UNDO_LOG));
    fs.writeFileSync(path.join(lowTide, "chapters", "chapter-01.md"), "---\ntitle: One\ntitle: Again\n---\nText.\n", "utf8");
    const broken = run(collection);
    expect(broken.code).toBe(3);
    expect(broken.err).toContain("story ../low-tide");
    expect(chapterFiles(collection)).toEqual([]);
  });

  test("refuses a hand-written chapter file in the way of a story's number", () => {
    const { collection } = shelf();
    writeMarkdown(path.join(collection, "chapters", "chapter-01.md"), "number: 7\nstatus: draft\ntitle: Odd", "## Chapter Text\n\nOdd.\n");
    const before = treeSnapshot(collection);
    const result = run(collection);
    expect(result.code).toBe(4);
    expect(result.err).toContain("chapters/chapter-01.md is in the way of story ../low-tide");
    expect(treeSnapshot(collection)).toEqual(before);
  });

  test("a second chapter collected from the same story is removed", () => {
    const { collection } = shelf();
    run(collection);
    fs.copyFileSync(path.join(collection, "chapters", "chapter-02.md"), path.join(collection, "chapters", "chapter-03.md"));
    const file = path.join(collection, "chapters", "chapter-03.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("number: 2", "number: 3").replace("# Chapter 2: Salt", "# Chapter 3: Salt"), "utf8");
    const json = JSON.parse(run(collection, "--json").out);
    expect(json.data.removed.map((entry) => entry.chapter)).toEqual(["chapter-03"]);
    expect(chapterFiles(collection)).toEqual(["chapter-01.md", "chapter-02.md"]);
  });

  test("credits a story's authors list, and counts characters in a book that does", () => {
    const { parent, collection } = shelf();
    const pair = project(parent, "pair", "Pair", "authors:\n  - Dee Writer\n  - Eve Poet\n");
    chapter(pair, 1, "Pair", "两个人。");
    setStories(collection, ["../pair"]);
    const storyPath = path.join(collection, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("title: Salt and Lantern\n", "title: Salt and Lantern\ncount-unit: characters\n"), "utf8");
    expect(run(collection).code).toBe(0);
    const data = parseFrontmatter(readChapter(collection, 1)).data;
    expect(data.author).toEqual(["Dee Writer", "Eve Poet"]);
    expect(data["character-count"]).toBe(4);
  });

  test("numbered: false on a collected chapter is not an edit, and a CRLF chapter is left as it is", () => {
    const { collection } = shelf();
    run(collection);
    const first = path.join(collection, "chapters", "chapter-01.md");
    fs.writeFileSync(first, fs.readFileSync(first, "utf8").replace("number: 1\n", "number: 1\nnumbered: false\n").replace("# Chapter 1: Low Tide", "# Low Tide"), "utf8");
    const second = path.join(collection, "chapters", "chapter-02.md");
    fs.writeFileSync(second, fs.readFileSync(second, "utf8").replace(/\n/g, "\r\n"), "utf8");
    const before = treeSnapshot(collection);
    const json = JSON.parse(run(collection, "--json").out);
    expect(json.ok).toBe(true);
    expect(json.data.changes).toEqual([]);
    expect(treeSnapshot(collection)).toEqual(before);
  });

  test("--force names the restore command with the collection's path from where collect ran", () => {
    const { parent, collection } = shelf();
    run(collection);
    const file = path.join(collection, "chapters", "chapter-01.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("The tide went out.", "The tide went far out."), "utf8");
    const io = memoryIo(parent);
    expect(runCli(["collect", "collection", "--force"], io)).toBe(0);
    expect(io.output()).toContain("Saved the collection as snapshot before-collect-1 before replacing the edits; story snapshot --restore before-collect-1 --path collection puts it back\n");
  });

  test("story links passes a project with no stories list", () => {
    const parent = makeTempDir();
    const root = project(parent, "book", "Book");
    expect(validateLinks(root).errors).toEqual([]);
  });

  test("a stories value that is not a list of folders is refused", () => {
    const { collection } = shelf();
    const storyPath = path.join(collection, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^stories:\n(?: {2}- .*\n)*/m, "stories: ../salt\n"), "utf8");
    const result = run(collection);
    expect(result.code).toBe(3);
    expect(result.err).toContain("story.md stories must be a list of story project folders");
  });

  test("--force --dry-run names the snapshot the real run would save, after the ones already saved, and writes nothing", () => {
    const { collection } = shelf();
    run(collection);
    const file = path.join(collection, "chapters", "chapter-01.md");
    const edit = (text) => fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/The tide went[^.]*\./, text), "utf8");
    edit("The tide went far out.");
    expect(run(collection, "--force").code).toBe(0);
    edit("The tide went out at last.");
    const before = treeSnapshot(collection);
    const json = JSON.parse(run(collection, "--force", "--dry-run", "--json").out);
    expect(json.ok).toBe(true);
    expect(json.data.snapshot.id).toBe("before-collect-2");
    expect(json.data.changes.map((change) => change.path)).toContain("chapters/chapter-01.md");
    expect(treeSnapshot(collection)).toEqual(before);
  });

  test("a story project another command holds the lock of is refused", () => {
    const { lowTide, collection } = shelf();
    fs.writeFileSync(path.join(lowTide, LOCK_FILE), `${process.pid}\nhost\n`);
    const before = treeSnapshot(collection);
    const result = run(collection);
    expect(result.code).toBe(4);
    expect(result.err).toContain("another story command is changing story ../low-tide");
    expect(treeSnapshot(collection)).toEqual(before);
  });

  test("leaves no undo log after a run", () => {
    const { collection } = shelf();
    expect(run(collection).code).toBe(0);
    expect(fs.existsSync(path.join(collection, UNDO_LOG))).toBe(false);
  });
});

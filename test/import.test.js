import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { compareImportNames, extractNameCandidates, importManuscript } from "../src/import.js";
import { lstatIfExists } from "../src/files.js";
import { LOCK_FILE } from "../src/lock.js";
import { createStoryProject, exportManuscript, scanProject, validateProject } from "../src/story.js";
import { CHMOD_IGNORED, otherLivePid, makeTempDir, memoryIo, messages, SYMLINKS_SUPPORTED, treeDiff, treeSnapshot, whileWriting, expectLinearGrowth } from "./helpers.js";

const PROSE = [
  "Mara Quill walked The Long Pier at dawn. The gulls followed Mara Quill past the locked door,",
  "and Mara Quill did not look back along The Long Pier. She asked Harrow for the key, but he said, I think not.",
  "Old Harrow laughed on The Long Pier, so they paid Harrow in salt and told Harrow nothing more.",
  "It was over. And Then he ran."
].join(" ");

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function importText(text, { name = "m.md", ...options } = {}) {
  const cwd = makeTempDir();
  fs.writeFileSync(path.join(cwd, name), text);
  const result = importManuscript({ source: name, title: "Imported", cwd, ...options });
  return { cwd, result, chapters: scanProject(result.root).chapters };
}

function chapterFile(root, number) {
  return fs.readFileSync(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), "utf8");
}

function chapterText(root, number) {
  return chapterFile(root, number).split("## Chapter Text\n")[1];
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("manuscript import", () => {
  test("imports a manuscript file split on chapter headings", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), [
      "---",
      "title: Old Export",
      "---",
      "# The Lost Coast",
      "",
      "A short preface paragraph.",
      "",
      "## Chapter 1: The Door",
      "",
      PROSE,
      "",
      "## Chapter 2 — Smoke",
      "",
      "Smoke rolled in over the harbor wall.",
      "",
      "### Chapter IV: Storm",
      "",
      "The storm arrived without a bell."
    ].join("\n"), "utf8");

    const result = importManuscript({ source: "book.md", title: "The Lost Coast", cwd });

    expect(result.storyId).toBe("the-lost-coast");
    expect(result.chapters).toBe(4);
    expect(result.words).toBeGreaterThan(60);

    const project = scanProject(result.root);
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(["Opening", "The Door", "Smoke", "Storm"]);
    expect(project.chapters.map((chapter) => chapter.number)).toEqual([1, 2, 3, 4]);
    expect(project.chapters[1].declaredWordCount).toBe(project.chapters[1].wordCount);
    expect(fs.readFileSync(path.join(result.root, "chapters", "_index.md"), "utf8")).toContain("chapter-04");
    expect(validateProject(result.root).ok).toBe(true);

    const names = result.candidates.map((candidate) => candidate.name);
    expect(result.candidates).toContainEqual({ name: "Mara Quill", count: 3 });
    expect(result.candidates).toContainEqual({ name: "Long Pier", count: 3 });
    expect(result.candidates).toContainEqual({ name: "Harrow", count: 3 });
    expect(names).not.toContain("I");
    expect(names).not.toContain("Old Harrow");
  });

  test("imports a directory of chapter files", () => {
    const cwd = makeTempDir();
    const source = path.join(cwd, "drafts");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "01-the-door.md"), "# The Door\n\nThe door would not open.", "utf8");
    fs.writeFileSync(path.join(source, "02-smoke.txt"), "Smoke rolled in without a heading.", "utf8");
    fs.writeFileSync(path.join(source, "notes.json"), "{}", "utf8");

    const result = importManuscript({ source: "drafts", title: "Door And Smoke", cwd, dir: "imported" });

    expect(result.root).toBe(path.join(cwd, "imported"));
    expect(result.chapters).toBe(2);
    const project = scanProject(result.root);
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(["The Door", "02 Smoke"]);
  });

  test("rejects missing sources and empty content", () => {
    const cwd = makeTempDir();
    expect(() => importManuscript({ cwd, title: "X" })).toThrow("An import source file or directory is required");
    expect(() => importManuscript({ cwd, source: "missing.md", title: "X" })).toThrow("Import source not found");

    const emptyDir = path.join(cwd, "empty");
    fs.mkdirSync(emptyDir);
    expect(() => importManuscript({ cwd, source: "empty", title: "X" })).toThrow("No markdown or text files found");

    fs.writeFileSync(path.join(cwd, "blank.md"), "---\ntitle: Blank\n---\n", "utf8");
    expect(() => importManuscript({ cwd, source: "blank.md", title: "X" })).toThrow("No chapter content found in import source");
  });

  test("extracts candidates deterministically", () => {
    expect(extractNameCandidates("plain prose with no names at all")).toEqual([]);
    const repeated = "He met Vex Marrow today. She trusted Vex Marrow once. They feared Vex Marrow forever.";
    expect(extractNameCandidates(repeated)).toEqual([{ name: "Vex Marrow", count: 3 }]);
  });

  test("offers the name next to a word that is never a name, but not the word (#586)", () => {
    const prose = [
      "Nobody saw Mara. Nobody heard Mara. Nobody told Mara.",
      "Everything changed. Everything broke. Everything burned.",
      "What Harrow wanted. What Harrow feared. What Harrow knew."
    ].join(" ");
    expect(extractNameCandidates(prose)).toEqual([{ name: "Harrow", count: 3 }, { name: "Mara", count: 3 }]);
  });

  test("breaks candidate count ties by name", () => {
    const tied = [
      "He saw Zephyr, then Anvil, then Marrow.",
      "She saw Zephyr, then Anvil, then Marrow.",
      "They saw Zephyr, then Anvil, then Marrow."
    ].join(" ");
    expect(extractNameCandidates(tied)).toEqual([
      { name: "Anvil", count: 3 },
      { name: "Marrow", count: 3 },
      { name: "Zephyr", count: 3 }
    ]);
  });

  test("preserves pre-H1 preamble in single-chapter imports", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "story.md"), [
      "A quiet preface paragraph.",
      "",
      "# The Real Title",
      "",
      "The chapter body goes here."
    ].join("\n"), "utf8");

    const result = importManuscript({ source: "story.md", title: "Preamble Story", cwd });

    expect(result.chapters).toBe(1);
    const project = scanProject(result.root);
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(["The Real Title"]);
    const body = fs.readFileSync(path.join(result.root, "chapters", "chapter-01.md"), "utf8");
    expect(body).toContain("A quiet preface paragraph.");
    expect(body).toContain("The chapter body goes here.");
  });

  test("does not treat Chapterhouse or Chapters headings as chapter splits", () => {
    const houseCwd = makeTempDir();
    fs.writeFileSync(path.join(houseCwd, "house.md"), [
      "# Chapterhouse",
      "",
      "Body about the house."
    ].join("\n"), "utf8");

    const house = importManuscript({ source: "house.md", title: "House Story", cwd: houseCwd, dir: "house" });
    expect(house.chapters).toBe(1);
    expect(scanProject(house.root).chapters.map((chapter) => chapter.title)).toEqual(["Chapterhouse"]);

    const overviewCwd = makeTempDir();
    fs.writeFileSync(path.join(overviewCwd, "overview.md"), [
      "# Chapters Overview",
      "",
      "Overview body."
    ].join("\n"), "utf8");

    const overview = importManuscript({ source: "overview.md", title: "Overview Story", cwd: overviewCwd });
    expect(overview.chapters).toBe(1);
    expect(scanProject(overview.root).chapters.map((chapter) => chapter.title)).toEqual(["Chapters Overview"]);
  });

  test("keeps title initials after Chapter instead of parsing them as numerals", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), [
      "## Chapter Cover",
      "",
      "Cover body.",
      "",
      "## Chapter Introduction",
      "",
      "Intro body."
    ].join("\n"), "utf8");

    const result = importManuscript({ source: "book.md", title: "Cover Story", cwd });

    expect(result.chapters).toBe(2);
    expect(scanProject(result.root).chapters.map((chapter) => chapter.title)).toEqual(["Cover", "Introduction"]);
  });

  test("keeps a leading scene break and roman-numeral title words", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), [
      "---",
      "Alpha still stands.",
      "---",
      "",
      "## Chapter I Am Legend",
      "",
      "Alpha body.",
      "",
      "## Chapter II: The Door",
      "",
      "Door body."
    ].join("\n"), "utf8");

    const result = importManuscript({ source: "book.md", title: "Breaks", cwd });
    expect(scanProject(result.root).chapters.map((chapter) => chapter.title)).toEqual(["Opening", "I Am Legend", "The Door"]);
    const opening = fs.readFileSync(path.join(result.root, "chapters", "chapter-01.md"), "utf8");
    expect(opening).toContain("Alpha still stands.");
  });

  test("orders numbered chapter files numerically and drops leftovers on force", () => {
    const cwd = makeTempDir();
    const source = path.join(cwd, "drafts");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "chapter-1.md"), "# One\n\nOne.", "utf8");
    fs.writeFileSync(path.join(source, "chapter-2.md"), "# Two\n\nTwo.", "utf8");
    fs.writeFileSync(path.join(source, "chapter-10.md"), "# Ten\n\nTen.", "utf8");

    const first = importManuscript({ source: "drafts", title: "Numbers", cwd, dir: "numbers" });
    expect(scanProject(first.root).chapters.map((chapter) => chapter.title)).toEqual(["One", "Two", "Ten"]);

    fs.writeFileSync(path.join(source, "chapter-1.md"), "# Only\n\nOnly.", "utf8");
    fs.rmSync(path.join(source, "chapter-2.md"));
    fs.rmSync(path.join(source, "chapter-10.md"));
    const second = importManuscript({ source: "drafts", title: "Numbers", cwd, dir: "numbers", force: true });
    expect(scanProject(second.root).chapters.map((chapter) => chapter.title)).toEqual(["Only"]);
    expect(fs.existsSync(path.join(second.root, "chapters", "chapter-02.md"))).toBe(false);
  });

  test.skipIf(!SYMLINKS_SUPPORTED)("force import refuses a symlinked destination instead of deleting its chapters", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "novel.md"), "# Chapter 1\n\nHello there.", "utf8");
    fs.mkdirSync(path.join(cwd, "real", "chapters"), { recursive: true });
    const kept = path.join(cwd, "real", "chapters", "chapter-09.md");
    fs.writeFileSync(kept, "keep", "utf8");
    fs.symlinkSync(path.join(cwd, "real"), path.join(cwd, "linked"), "dir");

    expect(() => importManuscript({ source: "novel.md", title: "Linked", cwd, dir: "linked", force: true })).toThrow("symlinked project directory");
    expect(fs.readFileSync(kept, "utf8")).toBe("keep");
  });

  test("sorts unnumbered front matter first and other unnumbered files last", () => {
    const names = ["epilogue.md", "chapter-2.md", "prologue.md", "chapter-1.md", "afterword.md"];
    expect(names.sort(compareImportNames)).toEqual(["prologue.md", "chapter-1.md", "chapter-2.md", "afterword.md", "epilogue.md"]);
  });

  test("uses standalone roman numerals as chapter numbers, not titles", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), [
      "## Chapter IV",
      "",
      "The first.",
      "",
      "## Chapter V The Storm",
      "",
      "The second.",
      "",
      "## Chapter Civil War",
      "",
      "The third."
    ].join("\n"), "utf8");

    const result = importManuscript({ source: "book.md", title: "Romans", cwd });

    expect(scanProject(result.root).chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "The Storm", "Civil War"]);
  });

  test("strips frontmatter the strict parser rejects but keeps a leading scene break", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "pandoc.md"), [
      "---",
      "title: Pandoc Export",
      "author:",
      "  name: Someone",
      "  - odd: shape",
      "---",
      "# Pandoc",
      "",
      "Prose after metadata."
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(cwd, "break.md"), [
      "---",
      "The ship left at dawn.",
      "---",
      "",
      "Nobody waved."
    ].join("\n"), "utf8");

    const pandoc = importManuscript({ source: "pandoc.md", title: "Pandoc", cwd, dir: "pandoc" });
    const pandocChapter = fs.readFileSync(path.join(pandoc.root, "chapters", "chapter-01.md"), "utf8");
    expect(pandocChapter).not.toContain("Someone");
    expect(pandocChapter).toContain("Prose after metadata.");

    const brk = importManuscript({ source: "break.md", title: "Break", cwd, dir: "break" });
    expect(fs.readFileSync(path.join(brk.root, "chapters", "chapter-01.md"), "utf8")).toContain("The ship left at dawn.");
  });

  test("sorts chapter filenames by each number group and then by name", () => {
    expect(compareImportNames("a-1.md", "a-1-2.md")).toBe(-1);
    expect(compareImportNames("a-1-2.md", "a-1.md")).toBe(1);
    expect(compareImportNames("a-1.md", "b-1.md")).toBe(-1);
    expect(compareImportNames("b-1.md", "a-1.md")).toBe(1);
    expect(compareImportNames("a-1.md", "a-1.md")).toBe(0);
    expect(compareImportNames("chapter-2.md", "chapter-10.md")).toBeLessThan(0);
  });

  test("gives a bare numbered heading a plain Chapter N title and heading", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "one.md"), "# Chapter 1\n\nOne.\n\n# Chapter 2: The Road\n\nTwo.\n", "utf8");

    const result = importManuscript({ source: "one.md", title: "S1", cwd, dir: "s1" });

    const first = fs.readFileSync(path.join(result.root, "chapters", "chapter-01.md"), "utf8");
    const second = fs.readFileSync(path.join(result.root, "chapters", "chapter-02.md"), "utf8");
    expect(first).toContain("title: Chapter 1\n");
    expect(first).toContain("\n# Chapter 1\n");
    expect(first).not.toContain("Chapter 1: Chapter 1");
    expect(second).toContain("\n# Chapter 2: The Road\n");
    expect(messages(validateProject(result.root).errors)).toEqual([]);

    const { outFile } = exportManuscript(result.root);
    const manuscript = fs.readFileSync(outFile, "utf8");
    expect(manuscript).toContain("\n# Chapter 1\n");
    expect(manuscript).toContain("\n# Chapter 2: The Road\n");
  });

  test("gives a bare numbered heading in a one-chapter file a plain Chapter N title", () => {
    const cwd = makeTempDir();
    const source = path.join(cwd, "manuscript");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "01-opening.md"), "# Chapter 1\n\nOne.\n", "utf8");
    fs.writeFileSync(path.join(source, "02-onward.md"), "# Chapter Two: Onward\n\nTwo.\n", "utf8");

    const result = importManuscript({ source: "manuscript", title: "S2", cwd, dir: "s2" });

    const first = fs.readFileSync(path.join(result.root, "chapters", "chapter-01.md"), "utf8");
    expect(first).toContain("title: Chapter 1\n");
    expect(first).toContain("\n# Chapter 1\n");
    expect(scanProject(result.root).chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Onward"]);
  });
});

describe("import source hardening", () => {
  test.skipIf(!SYMLINKS_SUPPORTED)("rejects symlinked import sources", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "real.md"), "## Chapter 1: Real\n\nReal body.\n", "utf8");
    fs.symlinkSync(path.join(cwd, "real.md"), path.join(cwd, "linked.md"));
    expect(() => importManuscript({ source: "linked.md", title: "Linked", cwd })).toThrow("symlinked source");

    const dir = path.join(cwd, "drafts");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.md"), "Body text here.\n", "utf8");
    fs.symlinkSync(path.join(dir, "a.md"), path.join(dir, "b.md"));
    expect(() => importManuscript({ source: "drafts", title: "Linked Dir", cwd })).toThrow("symlinked source");
  });

  test.skipIf(!SYMLINKS_SUPPORTED)("skips directory symlinks instead of aborting the import", () => {
    const cwd = makeTempDir();
    const dir = path.join(cwd, "drafts");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.md"), "## Chapter 1: Real\n\nReal body.\n", "utf8");
    const realSub = path.join(cwd, "real-sub");
    fs.mkdirSync(realSub);
    fs.writeFileSync(path.join(realSub, "z.md"), "Hidden body.\n", "utf8");
    fs.symlinkSync(realSub, path.join(dir, "sub"));
    fs.symlinkSync(path.join(dir, "missing.md"), path.join(dir, "dead.md"));
    const result = importManuscript({ source: "drafts", title: "Skipped Link", cwd });
    expect(result.chapters).toBe(1);
    expect(scanProject(result.root).chapters.map((chapter) => chapter.title)).toEqual(["Real"]);
  });

  test("rejects oversized import files", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "huge.md"), "x".repeat(6 * 1024 * 1024), "utf8");
    expect(() => importManuscript({ source: "huge.md", title: "Huge", cwd })).toThrow("oversized");
  });

  test("caps the number of import files", () => {
    const cwd = makeTempDir();
    const dir = path.join(cwd, "many");
    fs.mkdirSync(dir);
    for (let index = 0; index < 501; index += 1) {
      fs.writeFileSync(path.join(dir, "file-" + index + ".md"), "Body " + index + ".\n", "utf8");
    }
    expect(() => importManuscript({ source: "many", title: "Many", cwd })).toThrow("Too many import files");
  });
});

describe("import ordering, encoding, and headings", () => {
  test("orders directory files numerically, not by plain string sort", () => {
    const cwd = makeTempDir();
    const source = path.join(cwd, "drafts");
    fs.mkdirSync(source);
    for (const number of [1, 2, 10, 11]) {
      fs.writeFileSync(path.join(source, `chapter-${number}.md`), `Part ${number} prose.`, "utf8");
    }

    const result = importManuscript({ source: "drafts", title: "Parts", cwd, dir: "out" });

    expect(scanProject(result.root).chapters.map((chapter) => chapter.title)).toEqual([
      "Chapter 1", "Chapter 2", "Chapter 10", "Chapter 11"
    ]);
  });

  test("strips a UTF-8 BOM before removing source frontmatter", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "m.md"), "\uFEFF---\nauthor: x\n---\n# Chapter 1: Dawn\n\nMorning came.\n", "utf8");

    const result = importManuscript({ source: "m.md", title: "Bom", cwd });

    expect(result.chapters).toBe(1);
    const chapters = scanProject(result.root).chapters;
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Dawn"]);
    expect(fs.readFileSync(path.join(result.root, "chapters", "chapter-01.md"), "utf8")).not.toContain("author: x");
  });

  test("keeps title words made of Roman-numeral letters", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), [
      "## Chapter Civil War", "", "One.", "",
      "## Chapter Ill Omens", "", "Two.", "",
      "## Chapter Vivid Dreams", "", "Three.", "",
      "## Chapter IV: Dawn", "", "Four."
    ].join("\n"), "utf8");
    const result = importManuscript({ source: "book.md", title: "Numerals", cwd });
    expect(scanProject(result.root).chapters.map((chapter) => chapter.title)).toEqual(["Civil War", "Ill Omens", "Vivid Dreams", "Dawn"]);
  });
});

// #541: import --force replaces chapters, so the refusal says so, and the
// whole import holds the project lock.
describe("import --force into an existing project", () => {
  function invoke(cwd, argv) {
    const io = memoryIo(cwd);
    const code = runCli(argv, io);
    return { code, out: io.output(), err: io.error() };
  }

  function importedTwice() {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "draft.md"), "# Chapter 1: One\n\nOne two three.\n\n# Chapter 2: Two\n\nFour five six.\n", "utf8");
    fs.writeFileSync(path.join(cwd, "redraft.md"), "# Chapter 1: Only\n\nOnly this.\n", "utf8");
    expect(invoke(cwd, ["import", "draft.md", "--title", "Twice", "--dir", "twice"]).code).toBe(0);
    return { cwd, root: path.join(cwd, "twice") };
  }

  const savedLockWait = process.env.STORY_LOCK_WAIT_MS;
  function withNoLockWait(run) {
    process.env.STORY_LOCK_WAIT_MS = "0";
    try {
      return run();
    } finally {
      if (savedLockWait === undefined) {
        delete process.env.STORY_LOCK_WAIT_MS;
      } else {
        process.env.STORY_LOCK_WAIT_MS = savedLockWait;
      }
    }
  }

  function holdLock(root) {
    // A live command holds the lock.
    const lock = `${otherLivePid()}\n${os.hostname()}\n${new Date().toISOString()}\n`;
    fs.writeFileSync(path.join(root, LOCK_FILE), lock);
    return lock;
  }

  test("the refusal says --force replaces the chapters, unlike init's", () => {
    const { cwd, root } = importedTwice();
    const refused = invoke(cwd, ["import", "redraft.md", "--title", "Twice", "--dir", "twice"]);
    expect(refused.code).toBe(4);
    expect(refused.err).toContain(`${root} already exists. Use --force to import into it: --force saves the project as snapshot before-import-<n>, then deletes every chapters/chapter-NN.md and writes the imported chapters in their place, adds missing starter files, keeps story.md and the other files, and reindexes. story snapshot --restore before-import-<n> puts the old chapters back.`);
    expect(refused.err).not.toContain("never overwritten");
    const init = invoke(cwd, ["init", "Twice", "--dir", "twice"]);
    expect(init.code).toBe(4);
    expect(init.err).toContain(`${root} already exists. Use --force to add missing starter files; existing files are never overwritten.`);
  });

  test("a held lock refuses it before it reads the project or changes anything", () => {
    const { cwd, root } = importedTwice();
    fs.rmSync(path.join(root, ".gitignore"));
    holdLock(root);
    const before = treeSnapshot(root);
    const result = withNoLockWait(() => invoke(cwd, ["import", "redraft.md", "--title", "Twice", "--dir", "twice", "--force"]));
    expect(result.code).toBe(4);
    expect(result.err).toContain("is modifying this project; nothing was changed");
    expect(treeSnapshot(root)).toEqual(before);
    // The lock comes before the manuscript is split with the project's
    // settings, so even a manuscript with no chapters waits for it.
    fs.writeFileSync(path.join(cwd, "empty.md"), "\n", "utf8");
    const early = withNoLockWait(() => invoke(cwd, ["import", "empty.md", "--title", "Twice", "--dir", "twice", "--force"]));
    expect(early.code).toBe(4);
    expect(early.err).toContain("is modifying this project; nothing was changed");
    expect(treeSnapshot(root)).toEqual(before);
  });

  test("a folder without story.md is locked too, so two imports into it cannot interleave (#601)", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "draft.md"), "# Chapter 1: One\n\nOne two three.\n", "utf8");
    const root = path.join(cwd, "folder");
    fs.mkdirSync(root);
    const lock = holdLock(root);
    const argv = ["import", "draft.md", "--title", "Folder", "--dir", "folder", "--force"];
    const held = withNoLockWait(() => invoke(cwd, argv));
    expect(held.code).toBe(4);
    expect(held.err).toContain("is modifying this project; nothing was changed");
    expect(fs.readdirSync(root)).toEqual([LOCK_FILE]);
    expect(fs.readFileSync(path.join(root, LOCK_FILE), "utf8")).toBe(lock);
    fs.rmSync(path.join(root, LOCK_FILE));
    expect(invoke(cwd, argv).code).toBe(0);
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8")).toContain("One two three.");
    expect(fs.existsSync(path.join(root, LOCK_FILE))).toBe(false);
  });

  test.skipIf(process.platform === "win32")("a symlinked target is refused without taking the lock through the link", () => {
    const { cwd, root } = importedTwice();
    const lock = holdLock(root);
    fs.symlinkSync(root, path.join(cwd, "linked"), "dir");
    const before = treeSnapshot(root);
    const result = withNoLockWait(() => invoke(cwd, ["import", "redraft.md", "--title", "Twice", "--dir", "linked", "--force"]));
    expect(result.code).toBe(4);
    expect(result.err).toContain("Refusing to use symlinked project directory");
    expect(result.err).not.toContain("is modifying this project");
    expect(treeSnapshot(root)).toEqual(before);
    expect(fs.readFileSync(path.join(root, LOCK_FILE), "utf8")).toBe(lock);
  });

  test("a dry run lists exactly what the real run does, without waiting for the lock", () => {
    const { cwd, root } = importedTwice();
    holdLock(root);
    const locked = treeSnapshot(root);
    const argv = ["import", "redraft.md", "--title", "Twice", "--dir", "twice", "--force"];
    const preview = withNoLockWait(() => invoke(cwd, [...argv, "--dry-run"]));
    expect(preview.code).toBe(0);
    expect(treeSnapshot(root)).toEqual(locked);
    const lines = preview.out.trimEnd().split("\n");
    expect(lines[0]).toBe("Importing would first save the project in snapshot before-import-1 (.snapshots/before-import-1/); story snapshot --restore before-import-1 --path twice would undo it");
    expect(lines.at(-1)).toBe("Dry run: story import would make 32 changes; nothing was written");
    const listed = lines.slice(1, -1).map((line) => ({ action: line.slice(0, 7).trim(), path: line.slice(8) }));

    fs.rmSync(path.join(root, LOCK_FILE));
    const before = treeSnapshot(root);
    const real = invoke(cwd, argv);
    expect(real.code).toBe(0);
    expect(listed).toEqual(treeDiff(before, treeSnapshot(root)));
    expect(listed.filter((change) => !change.path.startsWith(".snapshots"))).toEqual([
      { action: "update", path: "chapters/_index.md" },
      { action: "update", path: "chapters/chapter-01.md" },
      { action: "delete", path: "chapters/chapter-02.md" }
    ]);
    expect(listed.slice(0, 3)).toEqual([
      { action: "mkdir", path: ".snapshots" },
      { action: "create", path: ".snapshots/.gitignore" },
      { action: "mkdir", path: ".snapshots/before-import-1" }
    ]);
    expect(listed).toContainEqual({ action: "create", path: ".snapshots/before-import-1/chapters/chapter-02.md" });
    expect(preview.err).toBe(real.err);
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8")).toContain("Only this.");
    expect(fs.existsSync(path.join(root, LOCK_FILE))).toBe(false);
  });

  // #600: the chapters --force deletes are kept in a snapshot first.
  const REDRAFT = ["import", "redraft.md", "--title", "Twice", "--dir", "twice", "--force"];

  // The changes a --dry-run lists, as treeDiff gives them.
  function listedChanges(out) {
    return out.split("\n").filter((line) => /^(create|update|delete|mkdir) /.test(line)).map((line) => ({ action: line.slice(0, 7).trim(), path: line.slice(8) }));
  }

  test("first saves the project as snapshot before-import-<n>, which puts the old chapters back", () => {
    const { cwd, root } = importedTwice();
    const chapters = path.join(root, "chapters");
    const old = treeSnapshot(chapters);
    const result = invoke(cwd, REDRAFT);
    expect(result.code).toBe(0);
    expect(result.out).toStartWith(`Saved the project in snapshot before-import-1 (.snapshots/before-import-1/) before replacing its chapters\nImported 1 chapter (2 words) into ${root}\nUndo it: story snapshot --restore before-import-1 --path twice\n`);
    const saved = path.join(root, ".snapshots", "before-import-1");
    expect(treeSnapshot(path.join(saved, "chapters"))).toEqual(old);
    expect(JSON.parse(fs.readFileSync(path.join(saved, "snapshot.json"), "utf8"))).toMatchObject({ name: "before-import-1", id: "before-import-1", chapters: 2, words: 6 });
    expect(fs.readFileSync(path.join(root, ".snapshots", ".gitignore"), "utf8")).toEndWith("\n*\n");
    expect(fs.readFileSync(path.join(chapters, "chapter-01.md"), "utf8")).toContain("Only this.");

    const restored = invoke(cwd, ["snapshot", "--restore", "before-import-1", "--path", "twice"]);
    expect(restored.code).toBe(0);
    expect(treeSnapshot(chapters)).toEqual(old);
  });

  test("numbers the snapshot past the highest taken, and its dry run lists what the real run does", () => {
    const { root } = importedTwice();
    for (const name of ["before-import-2", "before-import-09", "before-import-x", "before-import-99999999999999999999999", "draft-5"]) {
      fs.mkdirSync(path.join(root, ".snapshots", name), { recursive: true });
    }
    fs.writeFileSync(path.join(root, ".snapshots", ".gitignore"), "*\n");
    const argv = ["import", "../redraft.md", "--title", "Twice", "--dir", ".", "--force"];
    const preview = invoke(root, [...argv, "--dry-run"]);
    expect(preview.code).toBe(0);
    expect(preview.out).toStartWith("Importing would first save the project in snapshot before-import-3 (.snapshots/before-import-3/); story snapshot --restore before-import-3 would undo it\n");
    const before = treeSnapshot(root);
    const real = invoke(root, argv);
    expect(real.code).toBe(0);
    expect(real.out).toStartWith("Saved the project in snapshot before-import-3 (.snapshots/before-import-3/) before replacing its chapters\n");
    expect(real.out).toContain("\nUndo it: story snapshot --restore before-import-3\n");
    const listed = listedChanges(preview.out);
    expect(listed).toEqual(treeDiff(before, treeSnapshot(root)));
    expect(listed).toContainEqual({ action: "create", path: ".snapshots/before-import-3/snapshot.json" });
    // The folder was there already, so it gets no .gitignore.
    expect(listed.filter((change) => !change.path.startsWith(".snapshots/before-import-3/") && change.path.startsWith(".snapshots"))).toEqual([{ action: "mkdir", path: ".snapshots/before-import-3" }]);
  });

  test("saves a folder without story.md once the starter files make it a project", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "redraft.md"), "# Chapter 1: Only\n\nOnly this.\n", "utf8");
    const old = "# Old\n\nOld words here.\n";
    const root = path.join(cwd, "loose");
    fs.mkdirSync(path.join(root, "chapters"), { recursive: true });
    fs.writeFileSync(path.join(root, "chapters", "chapter-01.md"), old, "utf8");
    const result = invoke(cwd, ["import", "redraft.md", "--title", "Loose", "--dir", "loose", "--force"]);
    expect(result.code).toBe(0);
    expect(result.out).toStartWith("Saved the project in snapshot before-import-1 (.snapshots/before-import-1/) before replacing its chapters\n");
    const saved = path.join(root, ".snapshots", "before-import-1");
    expect(fs.readFileSync(path.join(saved, "chapters", "chapter-01.md"), "utf8")).toBe(old);
    expect(fs.existsSync(path.join(saved, "story.md"))).toBe(true);
    expect(invoke(cwd, ["snapshot", "--restore", "before-import-1", "--path", "loose"]).code).toBe(0);
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8")).toBe(old);
  });

  test("quotes a project path the restore command needs quoted", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "draft.md"), "# Chapter 1: One\n\nOne two three.\n", "utf8");
    fs.writeFileSync(path.join(cwd, "redraft.md"), "# Chapter 1: Only\n\nOnly this.\n", "utf8");
    expect(invoke(cwd, ["import", "draft.md", "--title", "Spaced", "--dir", "my book/b"]).code).toBe(0);
    const result = invoke(cwd, ["import", "redraft.md", "--title", "Spaced", "--dir", "my book/b", "--force"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("\nUndo it: story snapshot --restore before-import-1 --path 'my book/b'\n");
    expect(invoke(cwd, ["snapshot", "--restore", "before-import-1", "--path", "my book/b"]).code).toBe(0);
    expect(fs.readFileSync(path.join(cwd, "my book", "b", "chapters", "chapter-01.md"), "utf8")).toContain("One two three.");
  });

  // Imports --force into an empty project whose .snapshots/ folder has `mode`.
  const forceIntoEmptyProject = (mode) => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "draft.md"), "# Chapter 1: One\n\nOne two three.\n", "utf8");
    expect(invoke(cwd, ["init", "Empty", "--dir", "empty"]).code).toBe(0);
    const snapshots = path.join(cwd, "empty", ".snapshots");
    fs.mkdirSync(snapshots);
    fs.chmodSync(snapshots, mode);
    try {
      const argv = ["import", "draft.md", "--title", "Empty", "--dir", "empty"];
      const refused = invoke(cwd, [...argv, "--dry-run"]);
      expect(refused.code).toBe(4);
      expect(refused.err).toContain("already exists. Use --force to import into it");
      const preview = invoke(cwd, [...argv, "--force", "--dry-run"]);
      expect(preview.code).toBe(0);
      expect(preview.out).not.toContain("snapshot");
      const result = invoke(cwd, [...argv, "--force"]);
      expect(result.code).toBe(0);
      expect(result.out).not.toContain("snapshot");
    } finally {
      fs.chmodSync(snapshots, 0o755);
    }
    expect(fs.readdirSync(snapshots)).toEqual([]);
  };

  test("takes no snapshot when there is no chapter to replace", () => {
    forceIntoEmptyProject(0o755);
  });

  // Only an import that takes a snapshot reads .snapshots/, so this needs a
  // folder that no one can read. Root and Windows ignore chmod.
  test.skipIf(CHMOD_IGNORED)("reads no unreadable .snapshots/ when there is no chapter to replace", () => {
    forceIntoEmptyProject(0o000);
  });

  const UNKEEPABLE_ENTRIES = [
    ["chapter-03.MD", (file) => fs.writeFileSync(file, "# Shouting\n"), "does not end in lower-case .md", false],
    ["chapter-03.md", (file) => fs.mkdirSync(file), "is a folder", false],
    ["chapter-03.md", (file) => fs.symlinkSync(path.join(path.dirname(file), "chapter-01.md"), file), "is a symlink", true]
  ];
  for (const [name, make, problem, needsSymlinks] of UNKEEPABLE_ENTRIES) {
    test.skipIf(needsSymlinks && !SYMLINKS_SUPPORTED)(`refuses a chapter entry the snapshot cannot keep, before changing anything: chapters/${name} ${problem}`, () => {
      const { cwd, root } = importedTwice();
      make(path.join(root, "chapters", name));
      const before = treeSnapshot(root);
      for (const argv of [[...REDRAFT, "--dry-run"], REDRAFT]) {
        const result = invoke(cwd, argv);
        expect(result.code).toBe(4);
        expect(result.err).toContain(`Cannot import: chapters/${name} ${problem}, so the snapshot import --force takes before replacing the chapters cannot keep it, and --force would delete it. Rename, move, or delete it, then import again. Nothing was changed`);
      }
      expect(treeSnapshot(root)).toEqual(before);
    });
  }

  test("refuses a chapters entry that is a symlink or not a folder, before changing anything (#721)", () => {
    const entries = [
      ["is a symlink", (chapters, root) => fs.symlinkSync(path.join(root, "manuscript"), chapters, "dir")],
      ["is not a folder", (chapters) => fs.writeFileSync(chapters, "not a folder\n", "utf8")]
    ];
    for (const [problem, make] of entries) {
      const { cwd, root } = importedTwice();
      fs.mkdirSync(path.join(root, "manuscript"));
      fs.writeFileSync(path.join(root, "manuscript", "chapter-01.md"), "---\ntitle: Old\nnumber: 1\nstatus: draft\n---\n\n# Chapter 1: Old\n\n## Chapter Text\n\nOld prose.\n", "utf8");
      fs.rmSync(path.join(root, "chapters"), { recursive: true });
      try {
        make(path.join(root, "chapters"), root);
      } catch {
        console.warn("Skipping a chapters symlink: symlinks unavailable.");
        continue;
      }
      const before = treeSnapshot(root);
      const result = invoke(cwd, REDRAFT);
      expect(result.code).toBe(4);
      expect(result.err).toContain(`Cannot import: chapters ${problem}, so --force cannot save its chapters in a snapshot before replacing them.`);
      expect(result.err).toContain("Nothing was changed");
      expect(treeSnapshot(root)).toEqual(before);
    }
  });

  test("a snapshot it cannot save stops it before anything changes, in a dry run as in the real run", () => {
    const outside = makeTempDir();
    fs.mkdirSync(path.join(outside, "before-import-5"));
    const cases = [
      [(root) => fs.writeFileSync(path.join(root, "chapters", "chapter-03.md"), Buffer.from([0xff, 0xfe, 0x41])), 3, "chapter-03.md is not valid UTF-8 (byte 0xff at offset 0): re-save it as UTF-8. "],
      // A file or a symlink at .snapshots is refused before anything is
      // looked up through it, on every system. The symlink is not read for
      // numbering either.
      [(root) => fs.writeFileSync(path.join(root, ".snapshots"), ""), 3, (root) => `Project path is not a directory: ${path.join(root, ".snapshots")}. `],
      [(root) => fs.symlinkSync(outside, path.join(root, ".snapshots"), "junction"), 3, (root) => `Refusing to use symlinked project directory: ${path.join(root, ".snapshots")}. `]
    ];
    if (!CHMOD_IGNORED) {
      cases.push([(root) => {
        fs.mkdirSync(path.join(root, ".snapshots"));
        fs.chmodSync(path.join(root, ".snapshots"), 0o555);
      }, 4, "Cannot create the folder twice/.snapshots/before-import-1: permission denied. "]);
    }
    for (const [setup, code, reason] of cases) {
      const { cwd, root } = importedTwice();
      setup(root);
      const before = treeSnapshot(root);
      const preview = invoke(cwd, [...REDRAFT, "--dry-run"]);
      const real = invoke(cwd, REDRAFT);
      expect(real.code).toBe(code);
      expect(real.err).toContain(typeof reason === "function" ? reason(root) : reason);
      expect(real.err).toContain("The import stopped before deleting any chapter: it could not save the project as snapshot before-import-1 first");
      expect(preview.code).toBe(code);
      expect(preview.err).toBe(real.err);
      expect(treeSnapshot(root)).toEqual(before);
      expect(fs.readdirSync(outside)).toEqual(["before-import-5"]);
      if (lstatIfExists(path.join(root, ".snapshots"))?.isDirectory()) {
        fs.chmodSync(path.join(root, ".snapshots"), 0o755);
      }
    }
  });

  test("a failure after the snapshot names it and the command that puts the project back", () => {
    const { cwd, root } = importedTwice();
    const chapter = path.join(root, "chapters", "chapter-02.md");
    const saved = `${fs.readFileSync(chapter, "utf8")}\nSaved meanwhile.\n`;
    // Saved as the snapshot writes its manifest, after it copied the chapter.
    const spy = whileWriting(path.join(root, ".snapshots", "before-import-1", "snapshot.json"), () => fs.writeFileSync(chapter, saved));
    let result;
    try {
      result = invoke(cwd, REDRAFT);
    } finally {
      spy.mockRestore();
    }
    expect(result.code).toBe(4);
    expect(result.err).toContain("chapters/chapter-02.md changed on disk while story was deleting it, so it was left as it is. Snapshot before-import-1 holds the project as it was before this import: story snapshot --restore before-import-1 --path twice puts it back\n");
    expect(fs.readFileSync(chapter, "utf8")).toBe(saved);
    expect(fs.readFileSync(path.join(root, ".snapshots", "before-import-1", "chapters", "chapter-01.md"), "utf8")).toContain("One two three.");
  });

  test("counts a chapter that does not parse in the snapshot as unparsed", () => {
    const { cwd, root } = importedTwice();
    fs.writeFileSync(path.join(root, "chapters", "chapter-03.md"), "---\ntitle: [oops\n---\nBroken.\n", "utf8");
    expect(invoke(cwd, REDRAFT).code).toBe(0);
    const saved = path.join(root, ".snapshots", "before-import-1");
    expect(fs.readFileSync(path.join(saved, "chapters", "chapter-03.md"), "utf8")).toContain("Broken.");
    expect(JSON.parse(fs.readFileSync(path.join(saved, "snapshot.json"), "utf8"))).toMatchObject({ chapters: 2, words: 6, unparsed: 1 });
    expect(invoke(cwd, ["snapshot", "--list", "--path", "twice"]).out).toContain("- before-import-1: ");
    expect(invoke(cwd, ["snapshot", "--list", "--path", "twice"]).out).toContain(", 2 chapters, 6 words, 1 file that did not parse, not counted\n");
  });
});

// #519: a chapter's author comes through import: from a Story Skills
// chapter's frontmatter always, and with --bylines from each chapter's
// by-line or its file's frontmatter.
describe("import chapter authors", () => {
  function importFolder(files, argv = []) {
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(cwd, "stories"));
    for (const [name, text] of Object.entries(files)) {
      fs.writeFileSync(path.join(cwd, "stories", name), text, "utf8");
    }
    const io = memoryIo(cwd);
    expect(runCli(["import", "stories", "--title", "Salt and Lantern", "--dir", "book", ...argv], io)).toBe(0);
    const root = path.join(cwd, "book");
    return { cwd, root, chapters: scanProject(root).chapters };
  }

  const prose = (root, number) => fs.readFileSync(path.join(root, "chapters", `chapter-0${number}.md`), "utf8").split("## Chapter Text\n")[1].trim();
  const authors = (chapters) => chapters.map((entry) => entry.frontmatter.author);
  const storySkillsChapter = (title, author, text = "The tide went out.") => `---\ntitle: ${title}\nnumber: 1\n${author}\nstatus: draft\n---\n\n# Chapter 1: ${title}\n\n## Chapter Text\n\n${text}\n`;

  test("a Story Skills chapter file keeps its author without --bylines", () => {
    const { root, chapters } = importFolder({
      "01-low-tide.md": storySkillsChapter("Low Tide", "author: Ben Other"),
      "02-salt.md": storySkillsChapter("Salt", "author:\n  - Ada Writer\n  - Cara Third"),
      "03-lantern.md": storySkillsChapter("Lantern", "pov: \"\"", "By Ben Other\n\nThe lamp was lit.")
    });
    expect(authors(chapters)).toEqual(["Ben Other", ["Ada Writer", "Cara Third"], undefined]);
    expect(prose(root, 3)).toBe("By Ben Other\n\nThe lamp was lit.");
    expect(messages(validateProject(root).errors)).toEqual([]);
  });

  test("with --bylines, a Story Skills chapter without an author reads its by-line", () => {
    const { root, chapters } = importFolder({
      "01-low-tide.md": storySkillsChapter("Low Tide", "author: Ben Other", "By Ada Writer\n\nThe tide went out."),
      "02-lantern.md": storySkillsChapter("Lantern", "pov: \"\"", "By Ben Other\n\nThe lamp was lit.")
    }, ["--bylines"]);
    expect(authors(chapters)).toEqual(["Ben Other", "Ben Other"]);
    expect(prose(root, 1)).toBe("By Ada Writer\n\nThe tide went out.");
    expect(prose(root, 2)).toBe("The lamp was lit.");
  });

  test("an imported author is kept on one line, so it cannot add a heading to an export", () => {
    const injected = "author: \"Ada\\n\\n## Chapter 9\\n\\nInjected\"";
    const { cwd, root, chapters } = importFolder({ "01-low-tide.md": storySkillsChapter("Low Tide", injected) });
    expect(chapters[0].frontmatter.author).toBe("Ada ## Chapter 9 Injected");
    const again = importManuscript({ source: exportManuscript(root).outFile, title: "Again", cwd, dir: "again", bylines: true });
    expect(again.chapters).toBe(1);
    const plain = importFolder({ "01-low-tide.md": `---\n${injected}\n---\n# Low Tide\n\nThe tide went out.\n` }, ["--bylines"]);
    expect(plain.chapters[0].frontmatter.author).toBe("Ada ## Chapter 9 Injected");
  });

  test("without --bylines, a by-line and frontmatter author stay as they were", () => {
    const { root, chapters } = importFolder({
      "01-low-tide.md": "# Low Tide\n\nBy Ben Other\n\nThe tide went out.\n",
      "02-salt.md": "---\nauthor: Ada Writer\n---\n# Salt\n\nSalt dried on the rail.\n"
    });
    expect(authors(chapters)).toEqual([undefined, undefined]);
    expect(prose(root, 1)).toBe("By Ben Other\n\nThe tide went out.");
  });

  test("--bylines reads each chapter's by-line, takes it out of the prose, and falls back to frontmatter", () => {
    const { root, chapters } = importFolder({
      "01-low-tide.md": "# Low Tide\n\nBy Ben Other\n\nThe tide went out.\n",
      "02-salt.md": "# Salt\n\n*by Ada Writer*\n\nSalt dried on the rail.\n",
      "03-smoke.txt": "    BY: Cara Third\n\nSmoke rose.\n",
      "04-wake.md": "---\nauthor: Dev Fourth\n---\n# Wake\n\nThe wake spread.\n",
      "05-gull.md": "---\nauthor: Dev Fourth\n---\n# Gull\n\nby _Eli Fifth_\n\nA gull cried.\n",
      "06-close.md": "# Close\n\nBy Ben Other\nThe line runs on.\n",
      "07-pandoc.md": "---\ntitle: Pandoc\nauthor:\n  name: Someone\n  - odd: shape\n---\n# Pandoc\n\nProse after metadata.\n"
    }, ["--bylines"]);
    expect(authors(chapters)).toEqual(["Ben Other", "Ada Writer", "Cara Third", "Dev Fourth", "Eli Fifth", undefined, undefined]);
    expect([1, 2, 3, 5].map((number) => prose(root, number))).toEqual(["The tide went out.", "Salt dried on the rail.", "Smoke rose.", "A gull cried."]);
    expect(prose(root, 6)).toBe("By Ben Other\nThe line runs on.");
    // The by-line is not prose, so it does not count toward the length.
    expect(chapters[0].frontmatter["word-count"]).toBe(4);
    expect(messages(validateProject(root).errors)).toEqual([]);
  });

  test("--bylines reads names with initials, particles, apostrophes, and hyphens", () => {
    const names = ["J. R. R. Tolkien", "Martin Luther King Jr.", "Ludwig van Beethoven", "Ursula K. Le Guin", "Anna-Maria O’Brien", "Gabriel García Márquez"];
    const files = Object.fromEntries(names.map((name, index) => [`0${index + 1}.md`, `# Story ${index + 1}\n\nBy ${name}\n\nIt began.\n`]));
    expect(authors(importFolder(files, ["--bylines"]).chapters)).toEqual(names);
  });

  // When unsure, a line stays prose: a missed by-line is set by hand, but
  // deleted prose is lost.
  test.each([
    ["By Christmas he was at sea."],
    ["By God, it was me."],
    ["By Monday the toll had reached 40."],
    ["By Friday, Ma said, \"we leave.\""],
    ["By Monday he was out."],
    ["By God"],
    ["By Monday Morning"],
    ["By Ada Writer."],
    ["*by [TODO x]*"],
    ["By [TODO: author to supply]"],
    ["Von Osten her.", "de"],
    ["Von Weitem", "de"]
  ])("--bylines leaves %p in the prose", (line, language = "en") => {
    const { root, chapters } = importFolder({ "01-sea.md": `# Sea\n\n${line}\n\nThe sea was calm.\n` }, ["--bylines", "--language", language]);
    expect(chapters[0].frontmatter.author).toBeUndefined();
    expect(prose(root, 1)).toBe(`${line}\n\nThe sea was calm.`);
  });

  test("--bylines credits a file's chapters from the by-line under its title, and only from there", () => {
    const { chapters } = importFolder({
      "lighthouse.md": "# The Lighthouse\n\nBy Ben Other\n\n## Chapter 1: Dusk\n\nThe lamp was lit.\n\n## Chapter 2: Dawn\n\nBy Ada Writer\n\nThe lamp went out.\n",
      "tide.md": "# Chapter 1: Ebb\n\nBy Ben Other\n\n# Chapter 2: Flow\n\nThe tide came in.\n"
    }, ["--bylines"]);
    // A chapter whose prose is only its by-line is kept, and credits no other.
    expect(chapters.map((entry) => [entry.title, entry.frontmatter.author])).toEqual([["Dusk", "Ben Other"], ["Dawn", "Ada Writer"], ["Ebb", "Ben Other"], ["Flow", undefined]]);
  });

  test("--bylines reads a by-line under a plain-text title", () => {
    const { root, chapters } = importFolder({
      "01-lighthouse.txt": "THE LIGHTHOUSE\n\nBy Ben Other\n\nChapter 1\n\nThe lamp was lit.\n\nChapter 2\n\nThe lamp went out.\n",
      "02-tide.txt": "By Ada Writer\n\nChapter 1\n\nThe tide turned.\n",
      "03-smoke.txt": "SMOKE\n\nBy Cara Third\n\nSmoke rose.\n"
    }, ["--bylines"]);
    expect(chapters.map((entry) => [entry.title, entry.frontmatter.author])).toEqual([["Chapter 1", "Ben Other"], ["Chapter 2", "Ben Other"], ["Chapter 3", "Ada Writer"], ["03 Smoke", "Cara Third"]]);
    expect(prose(root, 1)).toBe("The lamp was lit.");
    expect(prose(root, 4)).toBe("SMOKE\n\nSmoke rose.");
  });

  test("--bylines reads back an export: several authors, and a story with no text yet", () => {
    const cwd = makeTempDir();
    const io = memoryIo(cwd);
    expect(runCli(["init", "Lamps", "--dir", "lamps"], io)).toBe(0);
    for (const title of ["Salt", "Lamp", "Wake"]) {
      expect(runCli(["add", "chapter", title, "--path", "lamps"], io)).toBe(0);
    }
    const chapterPath = (number) => path.join(cwd, "lamps", "chapters", `chapter-0${number}.md`);
    const edit = (number, change) => fs.writeFileSync(chapterPath(number), change(fs.readFileSync(chapterPath(number), "utf8")));
    edit(1, (text) => text.replace("title: Salt\n", "title: Salt\nauthor: Ben Other\n"));
    edit(2, (text) => `${text.replace("title: Lamp\n", "title: Lamp\nauthor:\n  - Ada Writer\n  - Ben Other\n")}The lamp was lit.\n`);
    edit(3, (text) => `${text}The wake spread.\n`);

    const exported = exportManuscript(path.join(cwd, "lamps"));
    expect(fs.readFileSync(exported.outFile, "utf8")).toContain("*by Ada Writer and Ben Other*\n\nThe lamp was lit.");
    const again = importManuscript({ source: exported.outFile, title: "Again", cwd, dir: "again", bylines: true });
    const chapters = scanProject(again.root).chapters;
    expect(chapters.map((entry) => [entry.title, entry.frontmatter.author])).toEqual([["Salt", "Ben Other"], ["Lamp", ["Ada Writer", "Ben Other"]], ["Wake", undefined]]);
    expect(prose(again.root, 1)).toBe("");
    expect(prose(again.root, 2)).toBe("The lamp was lit.");
    expect(messages(validateProject(again.root).errors)).toEqual([]);
  });

  test("--bylines reads the byline label of the project it imports into", () => {
    const cwd = makeTempDir();
    const io = memoryIo(cwd);
    expect(runCli(["init", "Lamps", "--dir", "lamps"], io)).toBe(0);
    const story = path.join(cwd, "lamps", "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace("---\n", "---\nlabels:\n  - byline: \"a story by {names}\"\n  - and: \"{a} & {b}\"\n"));
    fs.writeFileSync(path.join(cwd, "draft.md"), "# Chapter 1: Salt\n\n*a story by Ada Writer & Ben Other*\n\nSalt dried.\n");
    expect(runCli(["import", "draft.md", "--title", "Lamps", "--dir", "lamps", "--force", "--bylines"], io)).toBe(0);
    expect(scanProject(path.join(cwd, "lamps")).chapters[0].frontmatter.author).toEqual(["Ada Writer", "Ben Other"]);
    expect(prose(path.join(cwd, "lamps"), 1)).toBe("Salt dried.");
    // A new project has the language's own labels, so the line is prose.
    const fresh = importManuscript({ source: "draft.md", title: "Fresh", cwd, dir: "fresh", bylines: true });
    expect(prose(fresh.root, 1)).toStartWith("*a story by Ada Writer & Ben Other*");
  });

  test("--bylines reads the by-word of the manuscript's language, and none where a byline is the name alone", () => {
    const french = importFolder({ "01-sel.md": "# Sel\n\npar Ada Writer et Ben Other\n\nLe sel séchait.\n", "02-nuit.md": "# Nuit\n\nPar la fenêtre, la nuit.\n" }, ["--bylines", "--language", "fr"]);
    expect(authors(french.chapters)).toEqual([["Ada Writer", "Ben Other"], undefined]);
    const japanese = importFolder({ "01-umi.md": "# 海\n\nby Ada Writer\n\n海は静かだった。\n" }, ["--bylines", "--language", "ja"]);
    expect(japanese.chapters[0].frontmatter.author).toBeUndefined();
    expect(prose(japanese.root, 1)).toStartWith("by Ada Writer");
    // A Hindi byline is the name alone too (#539), so a लेखक: line stays prose.
    const hindi = importFolder({ "01-hawa.md": "# हवा\n\nलेखक: Asha Rao\n\nहवा चली।\n" }, ["--bylines", "--language", "hi"]);
    expect(hindi.chapters[0].frontmatter.author).toBeUndefined();
    expect(prose(hindi.root, 1)).toStartWith("लेखक: Asha Rao");
  });
});

describe("import --force on an existing project (#153)", () => {
  test("import --force warns that the title was kept and old references may dangle", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Old Title", "--dir", "book"]);
    fs.writeFileSync(path.join(cwd, "one.md"), "## Chapter 1\n\nOnly one.\n");

    const run = invoke(cwd, ["import", "one.md", "--title", "New Title", "--dir", "book", "--force"]);

    expect(run.code).toBe(0);
    expect(run.err).toContain("so --title was not applied");
    expect(run.err).toContain("Run story links");
    expect(run.err).not.toContain("--synopsis");
  });
});

describe("import performance (#92)", () => {
  test("a long line of spaced hyphens imports in linear time", () => {
    // Only the import is timed: each source is written beforehand, and each
    // run imports it into a new folder.
    let runs = 0;
    const source = (n) => {
      const cwd = makeTempDir();
      fs.writeFileSync(path.join(cwd, "m.md"), `# Chapter 1\n\nHello.\n\n${" -".repeat(n / 2)}x\n`);
      return cwd;
    };
    const result = expectLinearGrowth((cwd) => importManuscript({ source: "m.md", title: "Imported", cwd, dir: `book-${runs += 1}` }), source, 96000);
    expect(scanProject(result.root).chapters).toHaveLength(1);
  });
});

describe("import word counts (#124)", () => {
  test("words inside HTML comments are not counted", () => {
    const { result, chapters } = importText("# Chapter 1: One\n\nShe walked.\n\n<!-- note to self: fix this later please -->\n\nHe ran.\n");
    expect(result.words).toBe(4);
    expect(chapters[0].declaredWordCount).toBe(4);
    expect(messages(validateProject(result.root).warnings).filter((warning) => warning.includes("declares"))).toEqual([]);
  });
});

describe("lone # scene breaks (#143)", () => {
  test("a lone # in a one-chapter file stays a scene break", () => {
    const { result, chapters } = importText("First paragraph of the story.\n\n#\n\nSecond scene opens here with many words.\n\nThird paragraph.\n", { name: "d.md" });
    expect(chapters[0].title).toBe("D");
    const text = chapterText(result.root, 1);
    expect(text).toContain("#\n\nSecond scene opens here with many words.");
    expect(chapters[0].declaredWordCount).toBe(14);
  });

  test("a lone # before the first chapter heading keeps the paragraph after it", () => {
    const { result } = importText("#\n\nA dedication paragraph that should survive.\n\n## Chapter 1\n\nBody text.\n");
    expect(chapterText(result.root, 1)).toContain("A dedication paragraph that should survive.");
  });
});

describe("headings in comments and code (#144)", () => {
  test("a chapter heading inside a comment or code fence does not split", () => {
    const { result, chapters } = importText("## Chapter 1: Start\n\nText.\n\n<!--\nOutline:\n## Chapter 2: Planned\nsomething\n-->\n\nMore of chapter one.\n\n```\n## Chapter 9: in code\n```\n\nStill chapter one.\n");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Start"]);
    expect(chapterText(result.root, 1)).toContain("## Chapter 9: in code");
    expect(messages(validateProject(result.root).warnings).join("\n")).not.toContain("never closes");
  });
});

describe("leading scene break with colons (#145)", () => {
  test("dialogue with colons after a leading --- is kept", () => {
    const { result } = importText("---\n\nShe said: go now.\nHe answered: never, not while the tide is high.\n\n---\n\nThe rest of the story.\n");
    expect(chapterText(result.root, 1)).toContain("She said: go now.");
  });

  test("a note after a leading --- and a blank line is kept", () => {
    const { result } = importText("---\n\nNote: the first scene opens at dawn.\n\n---\n\nThe rest.\n");
    expect(chapterText(result.root, 1)).toContain("Note: the first scene opens at dawn.");
  });

  test("real frontmatter is still removed", () => {
    const { result } = importText("---\ntitle: Old\nauthor:\n  name: Someone\n---\n# Chapter 1\n\nBody.\n");
    expect(chapterText(result.root, 1)).not.toContain("Someone");
  });
});

describe("byte-order mark (#146)", () => {
  test("the first chapter heading is found after a BOM", () => {
    const { chapters, result } = importText("﻿## Chapter 1: One\n\nAlpha text.\n\n## Chapter 2: Two\n\nBeta text.\n");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["One", "Two"]);
    expect(chapterText(result.root, 1)).not.toContain("## Chapter 1");
  });

  test("a single chapter titled on line 1 after a BOM", () => {
    const { chapters } = importText("﻿# The Only Chapter\n\nText.\n");
    expect(chapters[0].title).toBe("The Only Chapter");
  });
});

describe("setext headings (#147)", () => {
  test("setext chapter headings split and a setext book title is dropped", () => {
    const { chapters, result } = importText("The Book\n========\n\nChapter One\n-----------\n\nAlpha text here.\n\nChapter Two\n-----------\n\nBeta text here.\n");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(chapterText(result.root, 1).trim()).toBe("Alpha text here.");
  });
});

describe("heading titles (#148)", () => {
  test("closing hashes, decimal numbers, and hundreds are consumed", () => {
    const { chapters } = importText("## Chapter 2: Closing Hashes ##\n\nb\n\n## Chapter 12.5: Half\n\nf\n\n## Chapter One Hundred\n\no\n\n## Chapter One Hundred and Five: Late\n\np\n");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Closing Hashes", "Half", "Chapter 3", "Late"]);
  });
});

describe("entity candidates (#149)", () => {
  test("finds accented, curly-apostrophe, hyphenated, and Mc names and skips weekdays", () => {
    const paragraph = "“Where?” asked Élodie Durand. On Monday they left. Élodie laughed. O’Brien nodded; O’Brien always nodded. The King’s Road was shut. I told Anna-Maria to wait. Anna-Maria waited. McAllister argued. Then Élodie smiled, and Sarah ran.\n\n";
    const names = extractNameCandidates(paragraph.repeat(3)).map((candidate) => candidate.name);
    for (const name of ["Élodie", "Élodie Durand", "O’Brien", "King’s Road", "Anna-Maria", "McAllister", "Sarah"]) {
      expect(names).toContain(name);
    }
    for (const name of ["Monday", "Anna", "King", "Road"]) {
      expect(names).not.toContain(name);
    }
  });

  test("a possessive counts toward the name", () => {
    const names = extractNameCandidates("She met Élodie. She took Élodie’s coat. She saw Élodie’s hat.").map((candidate) => candidate.name);
    expect(names).toEqual(["Élodie"]);
  });
});

describe("non-text sources (#150)", () => {
  test("a zip file such as .docx is refused", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.docx"), Buffer.from("PK\x03\x04garbage", "latin1"));
    expect(() => importManuscript({ source: "book.docx", title: "Docx", cwd })).toThrow("zip archive");
    expect(fs.existsSync(path.join(cwd, "docx"))).toBe(false);
  });

  test("a binary file is refused", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "b.md"), Buffer.from([0x23, 0x20, 0x41, 0x00, 0x01]));
    expect(() => importManuscript({ source: "b.md", title: "Bin", cwd })).toThrow("not UTF-8 text");
  });

  test("Windows-1252 text is refused rather than corrupted", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "win.txt"), Buffer.from("Chapter 1\r\n\r\n\x93Hello,\x94 she said. Caf\xe9\r\n", "latin1"));
    expect(() => importManuscript({ source: "win.txt", title: "Win", cwd })).toThrow("not valid UTF-8");
  });
});

describe("comment-only preamble (#151)", () => {
  test("re-importing an export keeps the chapter count", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "src.md"), "## Chapter 1: A\n\nAlpha text.\n\n## Chapter 2: B\n\nBeta text.\n");
    const first = importManuscript({ source: "src.md", title: "Round Trip", cwd, dir: "one" });
    const { outFile } = exportManuscript(first.root);

    const again = importManuscript({ source: outFile, title: "Round Trip", cwd, dir: "two" });

    expect(again.chapters).toBe(2);
    expect(scanProject(again.root).chapters.map((chapter) => chapter.title)).toEqual(["A", "B"]);
    expect(chapterText(again.root, 1)).not.toContain("Generated by");
  });

  test("other comments before the first chapter move into it", () => {
    const { chapters, result } = importText("<!-- draft two -->\n\n## Chapter 1: A\n\nAlpha.\n");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["A"]);
    expect(chapterText(result.root, 1)).toContain("<!-- draft two -->\n\nAlpha.");
  });
});

describe("part headings (#152)", () => {
  test("each part heading opens the chapter after it", () => {
    const { result, chapters } = importText("# Part One: Land\n\n## Chapter 1\n\nAlpha.\n\n# Part Two: Sea\n\n## Chapter 2\n\nBeta.\n");
    expect(chapters).toHaveLength(2);
    expect(chapterText(result.root, 1).trim()).toBe("# Part One: Land\n\nAlpha.");
    expect(chapterText(result.root, 2).trim()).toBe("# Part Two: Sea\n\nBeta.");
  });

  test("a book title before a part heading is still dropped", () => {
    const { result } = importText("# The Book\n\n# Part One\n\n## Chapter 1\n\nAlpha.\n");
    expect(chapterText(result.root, 1).trim()).toBe("# Part One\n\nAlpha.");
  });
});

describe("directory import skips droppings (#177)", () => {
  test("hidden, AppleDouble, and Word lock files are not chapters", () => {
    const cwd = makeTempDir();
    const dir = path.join(cwd, "dj");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "chapter-1.md"), "# Chapter 1\n\nReal.\n");
    fs.writeFileSync(path.join(dir, "chapter-2.md"), "# Chapter 2\n\nTwo.\n");
    fs.writeFileSync(path.join(dir, "~$apter-1.md"), "lock junk\n");
    fs.writeFileSync(path.join(dir, ".chapter-1.md"), "# Chapter 1\n\nOld hidden copy.\n");
    fs.writeFileSync(path.join(dir, "._chapter-1.md"), Buffer.from([0, 5, 22, 7, 0, 2]));

    const result = importManuscript({ source: "dj", title: "J", cwd, dir: "dji" });

    expect(result.chapters).toBe(2);
    expect(chapterText(result.root, 1).trim()).toBe("Real.");
    expect(chapterText(result.root, 2).trim()).toBe("Two.");
  });
});

describe("import --force parse check (#178)", () => {
  test("a project file that does not parse stops import before any chapter changes", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Ff", "--dir", "ff"]);
    invoke(cwd, ["add", "chapter", "A", "--path", "ff"]);
    invoke(cwd, ["add", "chapter", "B", "--number", "100", "--path", "ff"]);
    fs.writeFileSync(path.join(cwd, "ff", "chapters", "notes.md"), "my notes\n");
    fs.writeFileSync(path.join(cwd, "one.md"), "# Chapter 1\n\nOnly one.\n");
    const before = chapterFile(path.join(cwd, "ff"), 1);

    expect(() => importManuscript({ source: "one.md", title: "T", cwd, dir: "ff", force: true })).toThrow("chapters/notes.md");

    expect(fs.existsSync(path.join(cwd, "ff", "chapters", "chapter-100.md"))).toBe(true);
    expect(chapterFile(path.join(cwd, "ff"), 1)).toBe(before);
  });

  test("broken chapter files that import replaces do not block it", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Gg", "--dir", "gg"]);
    fs.writeFileSync(path.join(cwd, "gg", "chapters", "chapter-01.md"), "no frontmatter\n");
    fs.writeFileSync(path.join(cwd, "one.md"), "# Chapter 1\n\nOnly one.\n");

    const result = importManuscript({ source: "one.md", title: "Gg", cwd, dir: "gg", force: true });

    expect(result.chapters).toBe(1);
    expect(messages(validateProject(result.root).errors)).toEqual([]);
  });
});

describe("dash conversion (#183)", () => {
  test("www. URLs, email addresses, and HTML attributes keep their hyphens", () => {
    const { result } = importText("# Chapter 1\n\nVisit www.example.com/a--b and a--b@mail.com and <span class=\"x--y\">t</span>. It was--oh.\n");
    expect(chapterText(result.root, 1).trim()).toBe("Visit www.example.com/a--b and a--b@mail.com and <span class=\"x--y\">t</span>. It was–oh.");
  });
});

describe("Story Skills chapter files (#185)", () => {
  test("a chapter file in Story Skills layout imports as one chapter with its prose", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Re", "--dir", "re"]);
    invoke(cwd, ["add", "chapter", "One", "--path", "re"]);
    invoke(cwd, ["add", "chapter", "Two", "--path", "re"]);
    fs.appendFileSync(path.join(cwd, "re", "chapters", "chapter-01.md"), "Prose of one.\n");
    fs.appendFileSync(path.join(cwd, "re", "chapters", "chapter-02.md"), "Prose of two.\n");
    fs.mkdirSync(path.join(cwd, "src"));
    for (const name of ["chapter-01.md", "chapter-02.md"]) {
      fs.copyFileSync(path.join(cwd, "re", "chapters", name), path.join(cwd, "src", name));
    }

    const result = importManuscript({ source: "src", title: "Re", cwd, dir: "out" });

    expect(scanProject(result.root).chapters.map((chapter) => chapter.title)).toEqual(["One", "Two"]);
    expect(chapterText(result.root, 1).trim()).toBe("Prose of one.");
  });
});

describe("frontmatter without a chapter number (#718)", () => {
  test("a manuscript with frontmatter and a Chapter Text heading keeps its chapter headings and preface", () => {
    const { result, chapters } = importText("---\ntitle: The Book\nauthor: Ada\n---\n\nPreface text before the heading.\n\n## Chapter Text\n\n# Chapter 1: Arrival\n\nShip came in.\n\n# Chapter 2: Departure\n\nShip left.\n", { name: "book.md" });
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Opening", "Arrival", "Departure"]);
    expect(chapterFile(result.root, 1)).toContain("Preface text before the heading.");
  });

  test("a chapter file with Story Skills keys but no number is read as a chapter, not split as markdown", () => {
    const { result, chapters } = importText("---\ntitle: Arrival\nstatus: draft\n---\n\n## Outline\n\n1. Opening beat\n2. Turn\n\n---\n\n## Chapter Text\n\nShip came in.\n", { name: "chapter-01.md" });
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Arrival"]);
    expect(chapterText(result.root, 1).trim()).toBe("Ship came in.");
    expect(result.warnings).toEqual([]);
  });

  test("control characters in a reported line are shown as escapes, not sent to the terminal", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "chapter-01.md"), "---\ntitle: Arrival\nnumber: 1\nstatus: draft\n---\n\n\x1b]0;SPOOF\x07A note.\n\n## Chapter Text\n\nShip came in.\n", "utf8");
    const result = importManuscript({ source: "chapter-01.md", title: "Notes", cwd, dir: "out" });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("(first \"\\u001b]0;SPOOF\\u0007A note.\" at line 7)");
    expect(result.warnings[0].message).not.toMatch(/[\u0000-\u001f\u007f]/u);
  });

  test("a note above the outline is still reported as unused", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "chapter-01.md"), "---\ntitle: Arrival\nnumber: 1\nstatus: outline\n---\n\nA note to self.\n\n## Outline\n\n1. Opening beat\n\n---\n\n## Chapter Text\n\nShip came in.\n", "utf8");
    const result = importManuscript({ source: "chapter-01.md", title: "Notes", cwd, dir: "out" });
    expect(result.warnings.map((warning) => warning.code)).toEqual(["unused-chapter-text"]);
    expect(result.warnings[0].message).toContain("1 line above ## Chapter Text was not imported (first \"A note to self.\" at line 7)");
  });

  test("the outline story add chapter writes above Chapter Text prints no warning", () => {
    const { result, chapters } = importText("---\ntitle: Arrival\nnumber: 1\nstatus: outline\n---\n\n# Chapter 1: Arrival\n\n## Outline\n\n1. Opening beat\n2. Escalation\n3. Turn or decision\n\n---\n\n## Chapter Text\n\nShip came in.\n", { name: "chapter-01.md" });
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Arrival"]);
    expect(chapterText(result.root, 1).trim()).toBe("Ship came in.");
    expect(result.warnings).toEqual([]);
  });

  test("a chapter file with text above its Chapter Text heading warns about the text it does not use", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "chapter-01.md"), "---\ntitle: Arrival\nnumber: 1\nstatus: draft\n---\n\n# Chapter 1: Arrival\n\nA note to self.\n\n## Chapter Text\n\nShip came in.\n", "utf8");
    const result = importManuscript({ source: "chapter-01.md", title: "Notes", cwd, dir: "out" });
    expect(result.warnings.map((warning) => warning.code)).toEqual(["unused-chapter-text"]);
    expect(result.warnings[0].message).toBe("chapter-01.md: 1 line above ## Chapter Text was not imported (first \"A note to self.\" at line 9): a chapter file's prose is only the text under ## Chapter Text. Keep any other text below that heading");
    expect(chapterText(result.root, 1).trim()).toBe("Ship came in.");
  });

  test("another top-level heading above Chapter Text is reported, and the chapter's own heading is not", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "chapter-01.md"), "---\ntitle: Arrival\nnumber: 1\nstatus: draft\n---\n\n# Chapter 1: Arrival\n\n# Extra heading\n\n## Chapter Text\n\nShip came in.\n", "utf8");
    const result = importManuscript({ source: "chapter-01.md", title: "Notes", cwd, dir: "out" });
    expect(result.warnings.map((warning) => warning.code)).toEqual(["unused-chapter-text"]);
    expect(result.warnings[0].message).toContain("1 line above ## Chapter Text was not imported (first \"# Extra heading\" at line 9)");
    expect(chapterFile(result.root, 1)).not.toContain("Extra heading");
  });

  test("a chapter file whose only text above the heading is its title prints no warning", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "chapter-01.md"), "---\ntitle: Arrival\nnumber: 1\nstatus: draft\n---\n\n# Chapter 1: Arrival\n\n## Chapter Text\n\nShip came in.\n", "utf8");
    const result = importManuscript({ source: "chapter-01.md", title: "Notes", cwd, dir: "out" });
    expect(result.warnings).toEqual([]);
  });
});

describe("chapter title whitespace (#719)", () => {
  test("a multi-line title in a chapter file stays on one line of the chapter heading", () => {
    const { result, chapters } = importText("---\ntitle: |\n  The Long\n  Night\nnumber: 1\nstatus: draft\n---\n\n## Chapter Text\n\nProse here.\n", { name: "chapter-01.md" });
    expect(chapters.map((chapter) => chapter.title)).toEqual(["The Long Night"]);
    expect(chapterFile(result.root, 1)).toContain("\n# Chapter 1: The Long Night\n\n## Chapter Text\n");
  });
});

describe("CR line endings (#201)", () => {
  test("a CR-only source splits into chapters", () => {
    const { result, chapters } = importText("# Chapter 1: A\r\rShe ran.\r\r# Chapter 2: B\r\rHe hid.\r");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["A", "B"]);
    expect(chapterFile(result.root, 1)).not.toContain("\r");
  });
});

describe("#187 import warns about chapter lines it did not split on", () => {
  test("plain chapter lines in a file with a markdown chapter heading", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "mix.md"), "# Prologue\n\nBefore it all.\n\nChapter 1\n\nFirst text.\n\nChapter 2\n\nSecond text.\n\nChapter 3\n\nThird text.\n");
    const result = invoke(cwd, ["import", "mix.md", "--title", "Mix"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("warning: mix.md: 3 plain-text chapter lines were not used to split chapters (first \"Chapter 1\" at line 5): the file has markdown chapter headings");
  });

  test("chapter lines not followed by a blank line, counted from the top of the file", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "t.txt"), "Chapter 1\nIt was dark.\n\nChapter 2\nMorning came.\n");
    const result = invoke(cwd, ["import", "t.txt", "--title", "Tx"]);
    expect(result.err).toContain("2 plain-text chapter lines were not used to split chapters (first \"Chapter 1\" at line 1): a chapter line splits only when it stands alone between blank lines");
  });

  test("a clean split prints no warning", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "ok.txt"), "Chapter 1\n\nIt was dark.\n\nChapter 2\n\nMorning came.\n");
    const result = invoke(cwd, ["import", "ok.txt", "--title", "Ok"]);
    expect(result.out).toContain("Imported 2 chapters");
    expect(result.err).not.toContain("warning:");
  });
});

describe("import edge cases", () => {
  test("a document with a Chapter Text heading but no frontmatter is split as plain markdown", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), "# Chapter 1: Arrival\n\nOutline notes.\n\n## Chapter Text\n\nThe ship came in at dawn.\n", "utf8");
    const result = importManuscript({ source: "book.md", title: "No Frontmatter", cwd });
    const [first] = scanProject(result.root).chapters;
    expect(first.title).toBe("Arrival");
    // Not read as a Story Skills chapter, so the outline stays in the prose.
    expect(fs.readFileSync(first.file, "utf8")).toContain("Outline notes.");
  });

  test("a list item over a dash line is not a setext chapter heading", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), [
      "# Chapter 1: Lists",
      "",
      "Before the list.",
      "",
      "- Chapter Two",
      "---",
      "",
      "After the list."
    ].join("\n"), "utf8");
    const result = importManuscript({ source: "book.md", title: "List Book", cwd });
    expect(result.chapters).toBe(1);
    expect(scanProject(result.root).chapters.map((chapter) => chapter.title)).toEqual(["Lists"]);
  });
});

describe("import", () => {
  function importText(text, name = "draft.txt") {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, name), text);
    const result = importManuscript({ source: name, title: "Imported", cwd, dir: "out" });
    return { result, project: scanProject(result.root) };
  }

  test("splits plain-text chapter lines", () => {
    const { result, project } = importText("The Book\n\nChapter 1\n\nHello there.\n\nCHAPTER TWO: Arrival\n\nChapter and verse were quoted.\n\nEpilogue\n\nAfter.\n");
    expect(result.chapters).toBe(3);
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Arrival", "Epilogue"]);
  });

  test("prologue and epilogue headings are chapters and spelled-out numbers leave titles", () => {
    const { project } = importText("# Book\n\n## Prologue\n\nBefore.\n\n## Chapter One: Arrival\n\nA.\n\n## Chapter Twenty-One\n\nB.\n\n## Epilogue\n\nAfter.\n", "draft.md");
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(["Prologue", "Arrival", "Chapter 3", "Epilogue"]);
  });
});

describe("sweep fixes", () => {
  test("plain-text import leaves sentences that start like headings alone", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "draft.txt"), "Chapter 1\n\nIt began.\n\nChapter 12 was the worst.\n\nEpilogue of his life, he thought, was near.\n\nChapter Nine Lives of a Cat\n\nCHAPTER TWO: Arrival\n\nNext.\n\nEpilogue\n\nEnd.\n");
    const result = importManuscript({ source: "draft.txt", title: "Imported", cwd, dir: "out" });
    const project = scanProject(result.root);
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Arrival", "Epilogue"]);
    expect(fs.readFileSync(project.chapters[0].file, "utf8")).toContain("Chapter 12 was the worst.");
  });

  test("import cleans Pandoc and Scrivener conventions", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "pandoc.md"), "# Chapter 1: Arrival {#arrival .unnumbered}\n\nShe walked on --- faster now -- then stopped.\n\n---\n\nAfter the break `a--b`.\n");
    const md = scanProject(importManuscript({ source: "pandoc.md", title: "P", cwd, dir: "p" }).root);
    expect(md.chapters[0].title).toBe("Arrival");
    const prose = fs.readFileSync(md.chapters[0].file, "utf8");
    expect(prose).toContain("She walked on — faster now – then stopped.");
    expect(prose).toContain("\n---\n");
    expect(prose).toContain("`a--b`");
    fs.writeFileSync(path.join(cwd, "scriv.txt"), "Chapter 1:\n\n\tFirst paragraph.\n\n\tSecond paragraph.\n\nPrologue:\n\nEarlier.\n");
    const txt = scanProject(importManuscript({ source: "scriv.txt", title: "S", cwd, dir: "s" }).root);
    expect(txt.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Prologue"]);
    expect(fs.readFileSync(txt.chapters[0].file, "utf8")).toContain("\nSecond paragraph.");
  });

  test("import leaves comments and fenced code alone when converting dashes", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "notes.md"), "# Chapter 1: One\n\nText <!-- a -- note --> more -- then.\n\n```\nx -- y\n```\n");
    const project = scanProject(importManuscript({ source: "notes.md", title: "N", cwd, dir: "n" }).root);
    const prose = fs.readFileSync(project.chapters[0].file, "utf8");
    expect(prose).toContain("Text <!-- a -- note --> more – then.");
    expect(prose).toContain("x -- y");
  });

  test("import dash conversion leaves URLs, tables, indented code, and unclosed comments", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "src.md"), [
      "# Chapter 1: One",
      "",
      "See [the site](https://example.com/a--b) and https://x.org/--flag now -- then.",
      "",
      "| a | b |",
      "|---|---|",
      "",
      "    indented -- code",
      "",
      "End -- here <!-- note -- unclosed"
    ].join("\n"));
    const project = scanProject(importManuscript({ source: "src.md", title: "S", cwd, dir: "s" }).root);
    const text = fs.readFileSync(project.chapters[0].file, "utf8");
    expect(text).toContain("(https://example.com/a--b)");
    expect(text).toContain("https://x.org/--flag now – then.");
    expect(text).toContain("|---|---|");
    expect(text).toContain("    indented -- code");
    expect(text).toContain("End – here <!-- note -- unclosed");
  });

  test("import converts dashes in list continuations and leaves mailto addresses", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "list.md"), "# Chapter 1: One\n\n- Item one\n\n    Continued -- still prose.\n\nWrite to mailto:someone--x@example.com today.\n");
    const project = scanProject(importManuscript({ source: "list.md", title: "L", cwd, dir: "l" }).root);
    const text = fs.readFileSync(project.chapters[0].file, "utf8");
    expect(text).toContain("    Continued – still prose.");
    expect(text).toContain("mailto:someone--x@example.com");
  });

  test("import refuses a folder that is already a story project", () => {
    const root = sweepProject();
    expect(() => importManuscript({ source: root, title: "Again", cwd: path.dirname(root), dir: "again" })).toThrow("is already a story project");
  });
});

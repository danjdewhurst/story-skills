import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { compareImportNames, extractNameCandidates, importManuscript } from "../src/import.js";
import { scanProject, validateProject } from "../src/story.js";
import { makeTempDir } from "./helpers.js";

const PROSE = [
  "Mara Quill walked The Long Pier at dawn. The gulls followed Mara Quill past the locked door,",
  "and Mara Quill did not look back along The Long Pier. She asked Harrow for the key, but he said, I think not.",
  "Old Harrow laughed on The Long Pier, so they paid Harrow in salt and told Harrow nothing more.",
  "It was over. And Then he ran."
].join(" ");

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

  test("sorts chapter filenames by each number group and then by name", () => {
    expect(compareImportNames("a-1.md", "a-1-2.md")).toBe(-1);
    expect(compareImportNames("a-1-2.md", "a-1.md")).toBe(1);
    expect(compareImportNames("a-1.md", "b-1.md")).toBe(-1);
    expect(compareImportNames("b-1.md", "a-1.md")).toBe(1);
    expect(compareImportNames("a-1.md", "a-1.md")).toBe(0);
    expect(compareImportNames("chapter-2.md", "chapter-10.md")).toBeLessThan(0);
  });
});

describe("import source hardening", () => {
  test("rejects symlinked import sources", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "real.md"), "## Chapter 1: Real\n\nReal body.\n", "utf8");
    const link = path.join(cwd, "linked.md");
    try {
      fs.symlinkSync(path.join(cwd, "real.md"), link);
    } catch {
      console.warn("Skipping symlink import test: symlinks unavailable.");
      return;
    }
    expect(() => importManuscript({ source: "linked.md", title: "Linked", cwd })).toThrow("symlinked source");

    const dir = path.join(cwd, "drafts");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.md"), "Body text here.\n", "utf8");
    fs.symlinkSync(path.join(dir, "a.md"), path.join(dir, "b.md"));
    expect(() => importManuscript({ source: "drafts", title: "Linked Dir", cwd })).toThrow("symlinked source");
  });

  test("skips directory symlinks instead of aborting the import", () => {
    const cwd = makeTempDir();
    const dir = path.join(cwd, "drafts");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.md"), "## Chapter 1: Real\n\nReal body.\n", "utf8");
    const realSub = path.join(cwd, "real-sub");
    fs.mkdirSync(realSub);
    fs.writeFileSync(path.join(realSub, "z.md"), "Hidden body.\n", "utf8");
    try {
      fs.symlinkSync(realSub, path.join(dir, "sub"));
    } catch {
      console.warn("Skipping directory-symlink import test: symlinks unavailable.");
      return;
    }
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

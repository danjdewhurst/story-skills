import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { extractNameCandidates, importManuscript } from "../src/import.js";
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
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { importManuscript } from "../src/import.js";
import {
  createStoryProject,
  scanProject
} from "../src/story.js";
import { makeTempDir } from "./helpers.js";

function newProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

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

describe("round two", () => {
  test("plain-text import leaves sentences that start like headings alone", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "draft.txt"), "Chapter 1\n\nIt began.\n\nChapter 12 was the worst.\n\nEpilogue of his life, he thought, was near.\n\nChapter Nine Lives of a Cat\n\nCHAPTER TWO: Arrival\n\nNext.\n\nEpilogue\n\nEnd.\n");
    const result = importManuscript({ source: "draft.txt", title: "Imported", cwd, dir: "out" });
    const project = scanProject(result.root);
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Arrival", "Epilogue"]);
    expect(fs.readFileSync(project.chapters[0].file, "utf8")).toContain("Chapter 12 was the worst.");
  });
});

describe("round three", () => {
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
});

describe("round four", () => {
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
});

describe("round five", () => {
  test("import converts dashes in list continuations and leaves mailto addresses", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "list.md"), "# Chapter 1: One\n\n- Item one\n\n    Continued -- still prose.\n\nWrite to mailto:someone--x@example.com today.\n");
    const project = scanProject(importManuscript({ source: "list.md", title: "L", cwd, dir: "l" }).root);
    const text = fs.readFileSync(project.chapters[0].file, "utf8");
    expect(text).toContain("    Continued – still prose.");
    expect(text).toContain("mailto:someone--x@example.com");
  });
});

describe("round seven", () => {
  test("import refuses a folder that is already a story project", () => {
    const root = newProject();
    expect(() => importManuscript({ source: root, title: "Again", cwd: path.dirname(root), dir: "again" })).toThrow("is already a story project");
  });
});

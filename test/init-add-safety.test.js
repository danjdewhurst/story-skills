import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { importManuscript } from "../src/import.js";
import { buildSeries } from "../src/series.js";
import { buildBook, createEntity, createStoryProject, scanProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, readArchiveText, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function frontmatter(file) {
  return parseFrontmatter(fs.readFileSync(file, "utf8"), file).data;
}

function setFrontmatterLine(file, pattern, replacement) {
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.replace(pattern, replacement), "utf8");
}

describe("init", () => {
  test("a title with no kebab-case form takes its story id from --dir", () => {
    const cwd = makeTempDir();
    expect(() => createStoryProject({ cwd, title: "東京物語" })).toThrow("Cannot derive a story id");
    expect(fs.readdirSync(cwd)).toEqual([]);
    const result = invoke(cwd, ["init", "東京物語", "--dir", "tk"]);
    expect(result.code).toBe(0);
    const created = scanProject(path.join(cwd, "tk"));
    expect(created.storyId).toBe("tk");
    expect(created.title).toBe("東京物語");
    expect(validateProject(path.join(cwd, "tk")).errors).toEqual([]);
  });

  test("--force adds missing starter files and never overwrites existing ones", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Kept Work" });
    const statePath = path.join(root, "continuity", "state.md");
    const storyPath = path.join(root, "story.md");
    const timelinePath = path.join(root, "plot", "timeline.md");
    const characterIndexPath = path.join(root, "characters", "_index.md");
    fs.appendFileSync(statePath, "\nUser continuity notes.\n");
    fs.appendFileSync(storyPath, "\nUser synopsis notes.\n");
    fs.appendFileSync(timelinePath, "\nUser timeline.\n");
    fs.appendFileSync(characterIndexPath, "\nUser relationship map.\n");
    const before = [statePath, storyPath, timelinePath, characterIndexPath].map((file) => fs.readFileSync(file, "utf8"));
    fs.rmSync(path.join(root, "glossary", "_index.md"));

    const retry = invoke(cwd, ["init", "Kept Work"]);
    expect(retry.code).toBe(1);
    expect(retry.err).toContain("never overwritten");

    expect(invoke(cwd, ["init", "Kept Work", "--force"]).code).toBe(0);
    const after = [statePath, storyPath, timelinePath, characterIndexPath].map((file) => fs.readFileSync(file, "utf8"));
    expect(after).toEqual(before);
    expect(fs.existsSync(path.join(root, "glossary", "_index.md"))).toBe(true);
  });

  test("--force against an existing book does not add series backlinks it did not write", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Book One", bookNumber: 1 });
    createStoryProject({ cwd, title: "Loose" });
    expect(invoke(cwd, ["init", "Loose", "--follows", "book-one", "--force"]).code).toBe(0);
    expect(frontmatter(path.join(cwd, "book-one", "story.md")).precedes).toBeUndefined();
    expect(frontmatter(path.join(cwd, "loose", "story.md")).follows).toBeUndefined();
  });

  test("an inherited book-number skips numbers already used in the series", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Book One", series: "saga", bookNumber: 1 });
    createStoryProject({ cwd, title: "Book Two", follows: ["book-one"] });
    expect(frontmatter(path.join(cwd, "book-two", "story.md"))["book-number"]).toBe(2);
    createStoryProject({ cwd, title: "Book Zero", precedes: ["book-one"] });
    expect(frontmatter(path.join(cwd, "book-zero", "story.md"))["book-number"]).toBe(3);
    expect(buildSeries(path.join(cwd, "book-one"), scanProject).ok).toBe(true);
  });

  test("an inherited book-number counts numbered books beyond an unnumbered direct link", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Book One", series: "saga", bookNumber: 1 });
    createStoryProject({ cwd, title: "Book Two", follows: ["book-one"] });
    setFrontmatterLine(path.join(cwd, "book-two", "story.md"), /^book-number: 2\n/m, "");
    expect(frontmatter(path.join(cwd, "book-two", "story.md"))["book-number"]).toBeUndefined();
    createStoryProject({ cwd, title: "Book Three", follows: ["book-two"] });
    expect(frontmatter(path.join(cwd, "book-three", "story.md"))["book-number"]).toBe(2);
  });

  test("series reports duplicate book-number values", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Book One", series: "saga", bookNumber: 1 });
    createStoryProject({ cwd, title: "Book Two", follows: ["book-one"], bookNumber: 1 });
    const report = buildSeries(path.join(cwd, "book-one"), scanProject);
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toContain("share book-number 1");
  });
});

describe("add", () => {
  test("rejects unsupported faction, artifact, arc, and scene status", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Enum Checks" });
    expect(() => createEntity(root, { kind: "faction", name: "Bogus Guild", status: "nonsense" })).toThrow("Unsupported faction status");
    expect(() => createEntity(root, { kind: "artifact", name: "Bogus Blade", status: "nonsense" })).toThrow("Unsupported artifact status");
    expect(() => createEntity(root, { kind: "arc", name: "Bogus Arc", status: "wat" })).toThrow("Unsupported arc status");
    expect(() => createEntity(root, { kind: "scene", name: "Bogus Scene", status: "wat" })).toThrow("Unsupported scene status");
    createEntity(root, { kind: "faction", name: "Real Guild", status: "hidden" });
    expect(validateProject(root).ok).toBe(true);
  });

  test("promise and clue default to planted status when --planted is given", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Planted Defaults" });
    expect(invoke(cwd, ["add", "chapter", "One", "--number", "1", "--path", root]).code).toBe(0);
    expect(invoke(cwd, ["add", "promise", "The warning", "--planted", "chapter-01", "--path", root]).code).toBe(0);
    expect(invoke(cwd, ["add", "clue", "The torn page", "--planted", "chapter-01", "--payoff", "chapter-03", "--path", root]).code).toBe(0);
    expect(invoke(cwd, ["add", "promise", "Unplanted", "--path", root]).code).toBe(0);
    expect(invoke(cwd, ["add", "clue", "Overridden", "--planted", "chapter-01", "--status", "planned", "--path", root]).code).toBe(0);
    expect(frontmatter(path.join(root, "continuity", "promises", "the-warning.md")).status).toBe("planted");
    expect(frontmatter(path.join(root, "continuity", "clues", "the-torn-page.md")).status).toBe("planted");
    expect(frontmatter(path.join(root, "continuity", "promises", "unplanted.md")).status).toBe("planned");
    expect(frontmatter(path.join(root, "continuity", "clues", "overridden.md")).status).toBe("planned");
    // Planted in a chapter not written yet is still a plan.
    expect(invoke(cwd, ["add", "promise", "Later", "--planted", "chapter-05", "--path", root]).code).toBe(0);
    expect(frontmatter(path.join(root, "continuity", "promises", "later.md")).status).toBe("planned");
  });
});

describe("build paragraphs", () => {
  test("whitespace-only blank lines and CRLF separate paragraphs", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Paragraphs" });
    const chapterPath = path.join(root, "chapters", "chapter-01.md");
    writeMarkdown(chapterPath, `
title: One
number: 1
status: draft
word-count: 0
`, "## Chapter Text\n\nFirst line.\n  \t\nSecond line.\n \n* * *\n\nThird line.");
    let epub = readArchiveText(buildBook(root, { format: "epub" }).outFile);
    expect(epub).toContain("<p>First line.</p>");
    expect(epub).toContain("<p>Second line.</p>");
    expect(epub).toContain("<p>* * *</p>");

    fs.writeFileSync(chapterPath, fs.readFileSync(chapterPath, "utf8").replace(/\n/g, "\r\n"), "utf8");
    epub = readArchiveText(buildBook(root, { format: "epub" }).outFile);
    expect(epub).toContain("<p>First line.</p>");
    expect(epub).toContain("<p>Second line.</p>");
    expect(epub).toContain("<p>Third line.</p>");
  });
});

describe("write containment", () => {
  test("does not create directories through a symlink that leaves the root", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Contained" });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: One
number: 1
status: draft
word-count: 0
`, "## Chapter Text\n\nText.");
    const outside = makeTempDir();
    fs.symlinkSync(outside, path.join(root, "dist"));
    expect(() => buildBook(root, { format: "epub", out: "dist/a/b/x.epub" })).toThrow("outside root");
    expect(fs.existsSync(path.join(outside, "a"))).toBe(false);
  });
});

describe("forced init containment", () => {
  test("refuses a preserved starter file behind a symlinked directory", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Linked Chapters" });
    const outside = makeTempDir();
    fs.copyFileSync(path.join(root, "chapters", "_index.md"), path.join(outside, "_index.md"));
    fs.rmSync(path.join(root, "chapters"), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, "chapters"), "dir");
    fs.writeFileSync(path.join(cwd, "m.md"), "# Chapter 1\n\nText.\n", "utf8");
    expect(() => importManuscript({ source: "m.md", title: "Linked Chapters", cwd, force: true })).toThrow("outside root");
    expect(fs.readdirSync(outside)).toEqual(["_index.md"]);
  });
});

describe("read containment", () => {
  test("reports continuity state read through a symlinked directory outside the root", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Read Contained" });
    const outside = makeTempDir();
    fs.copyFileSync(path.join(root, "continuity", "state.md"), path.join(outside, "state.md"));
    fs.rmSync(path.join(root, "continuity"), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, "continuity"), "dir");
    expect(scanProject(root).fileErrors.join("\n")).toContain("continuity/state.md: Refusing to access project path outside root");
  });

  test("refuses writes through a dangling symlinked directory", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Dangling" });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: One
number: 1
status: draft
word-count: 0
`, "## Chapter Text\n\nText.");
    fs.symlinkSync(path.join(cwd, "missing-target"), path.join(root, "dist"));
    expect(() => buildBook(root, { format: "epub", out: "dist/a/x.epub" })).toThrow("outside root");
    expect(fs.existsSync(path.join(cwd, "missing-target"))).toBe(false);
  });
});

describe("validation minimums", () => {
  test("rejects negative target-words, word-count, and current-chapter", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Minimums" });
    setFrontmatterLine(path.join(root, "story.md"), /^title:/m, "target-words: 0\ntitle:");
    setFrontmatterLine(path.join(root, "continuity", "state.md"), /^current-chapter: 0$/m, "current-chapter: -1");
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: One
number: 1
status: draft
word-count: -4
`, "## Chapter Text\n\nText.");
    const errors = validateProject(root).errors.join("\n");
    expect(errors).toContain("target-words must be at least 1");
    expect(errors).toContain("current-chapter must be at least 0");
    expect(errors).toContain("word-count must be at least 0");
  });
});

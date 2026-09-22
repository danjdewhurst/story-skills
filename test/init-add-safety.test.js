import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { importManuscript } from "../src/import.js";
import { buildSeries } from "../src/series.js";
import { buildBook, createEntity, createStoryProject, scanProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

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

describe("series book numbers", () => {
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

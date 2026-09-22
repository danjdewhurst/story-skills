import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, replaceFrontmatter } from "../src/frontmatter.js";
import { withSeriesBacklink } from "../src/series.js";
import { createStoryProject } from "../src/story.js";
import { makeTempDir } from "./helpers.js";

describe("withSeriesBacklink string fields", () => {
  test("keeps an existing path when a string field becomes a list", () => {
    const cwd = makeTempDir();
    const one = createStoryProject({ title: "Book One", cwd }).root;
    const three = createStoryProject({ title: "Book Three", cwd }).root;
    const storyPath = path.join(one, "story.md");
    const markdown = fs.readFileSync(storyPath, "utf8");
    const { data } = parseFrontmatter(markdown, storyPath);
    fs.writeFileSync(
      storyPath,
      replaceFrontmatter(markdown, { ...data, precedes: "../book-two" }),
      "utf8"
    );
    const updated = withSeriesBacklink(one, "precedes", three);
    expect(parseFrontmatter(updated).data.precedes).toEqual(["../book-two", "../book-three"]);
  });
});

describe("frontmatter rewrites keep unrelated text", () => {
  test("a series backlink keeps comments and body spacing in the linked book", () => {
    const cwd = makeTempDir();
    const one = createStoryProject({ title: "Book One", cwd }).root;
    const storyPath = path.join(one, "story.md");
    const original = fs.readFileSync(storyPath, "utf8").replace("---\n", "---\n# genre chosen after long debate\n");
    fs.writeFileSync(storyPath, original, "utf8");
    createStoryProject({ title: "Book Zero", cwd, precedes: ["book-one"] });
    const updated = fs.readFileSync(storyPath, "utf8");
    expect(updated).toContain("# genre chosen after long debate\n");
    expect(updated.slice(updated.indexOf("\n---\n"))).toBe(original.slice(original.indexOf("\n---\n")));
    expect(updated).toContain("follows:\n  - ../book-zero\n");
  });
});

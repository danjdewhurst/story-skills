import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, replaceFrontmatter } from "../src/frontmatter.js";
import { withSeriesBacklink } from "../src/series.js";
import { createStoryProject } from "../src/story.js";
import { makeTempDir } from "./helpers.js";

describe("withSeriesBacklink string fields", () => {
  test("replaces a scalar field with a list holding the new link", () => {
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
    expect(parseFrontmatter(updated).data.precedes).toEqual(["../book-three"]);
  });
});

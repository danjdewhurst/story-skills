import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, replaceFrontmatter } from "../src/frontmatter.js";
import { withSeriesBacklink } from "../src/series.js";
import { createEntity, createStoryProject, renameEntity } from "../src/story.js";
import { makeTempDir } from "./helpers.js";

describe("withSeriesBacklink string fields", () => {
  test("keeps an existing scalar link and adds the new link as a list", () => {
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
    fs.writeFileSync(storyPath, updated, "utf8");
    expect(withSeriesBacklink(one, "precedes", path.join(cwd, "book-two"))).toBeNull();
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

  test("repeated renames do not add blank lines to referencing files", () => {
    const root = createStoryProject({ title: "Rename Spacing", cwd: makeTempDir() }).root;
    createEntity(root, { kind: "character", name: "Lord Maren" });
    createEntity(root, { kind: "artifact", name: "Crown", owner: "lord-maren" });
    const crownPath = path.join(root, "worldbuilding", "artifacts", "crown.md");
    const bodyOf = (text) => text.slice(text.indexOf("\n---\n") + 5);
    const body = bodyOf(fs.readFileSync(crownPath, "utf8"));
    renameEntity(root, { kind: "character", id: "lord-maren", name: "Maren Two" });
    renameEntity(root, { kind: "character", id: "maren-two", name: "Maren Three" });
    const after = fs.readFileSync(crownPath, "utf8");
    expect(after).toContain("owner: maren-three");
    expect(bodyOf(after)).toBe(body);
  });
});

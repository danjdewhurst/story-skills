import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, messages } from "./helpers.js";

function newProject(title = "Analysis", cwd = makeTempDir()) {
  return createStoryProject({ cwd, title }).root;
}

describe("rounding and plurals elsewhere (#216)", () => {
  test("validate says a chapter has no word-count instead of declaring 0", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, "chapters", "chapter-01.md"), "---\ntitle: One\nnumber: 1\nstatus: draft\n---\n## Chapter Text\n\nOne two three.\n", "utf8");
    expect(messages(validateProject(root).warnings)).toContain("chapters/chapter-01.md has no word-count (contains 3)");
  });
});

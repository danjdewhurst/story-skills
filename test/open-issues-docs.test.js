import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createStoryProject, reindexProject, validateProject } from "../src/story.js";
import { makeTempDir } from "./helpers.js";

describe("retitled story", () => {
  test("validate points at story reindex, which clears the stale story ids", () => {
    const root = createStoryProject({ cwd: makeTempDir(), title: "Gull" }).root;
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^title: .*$/m, 'title: "The Keeper of Gull Rock"'));

    const before = validateProject(root);
    expect(before.ok).toBe(false);
    expect(before.errors).toContain(
      "characters/_index.md story must be the-keeper-of-gull-rock (run story reindex after changing the story.md title)"
    );
    expect(before.errors.join("\n")).toContain("continuity/state.md story must be the-keeper-of-gull-rock (run story reindex");

    reindexProject(root);
    expect(validateProject(root).ok).toBe(true);
  });
});

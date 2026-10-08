import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// A new character file starts from this template. `died-in` applies only to a
// deceased character, so its line stays commented out. An active
// `died-in: {chapter-NN}` line makes a living character's file fail
// `story check` with "Flow mappings are not supported".

const templatePath = path.join(import.meta.dir, "..", "skills", "character-management", "references", "character-template.md");

describe("character template", () => {
  test("died-in stays commented out in the frontmatter", () => {
    const block = fs.readFileSync(templatePath, "utf8").match(/```yaml\n---\n([\s\S]*?)\n---\n```/)?.[1];
    expect(block).toBeString();
    const lines = block.split("\n");
    expect(lines.filter((line) => /^\s*died-in\s*:/.test(line))).toEqual([]);
    expect(lines.filter((line) => /^#\s*died-in\s*:/.test(line))).toHaveLength(1);
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { formatRuntime } from "../src/narration.js";
import { buildBook, createEntity, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

function project() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Siorsa", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", "schema-version: 2\nauthor: Ada Writer\ncopyright: © 2026 Ada Writer\n"), "utf8");
  writeMarkdown(path.join(root, "characters", "siorsa.md"), "name: Siorsa\nrole: protagonist\nstatus: alive\npronunciation: SHUR-sha", "# Siorsa\n");
  writeMarkdown(path.join(root, "characters", "gone.md"), "name: Gone\nrole: minor\nstatus: cut\npronunciation: GON", "# Gone\n");
  writeMarkdown(path.join(root, "worldbuilding", "locations", "dun-eideann.md"), "name: Dùn Èideann\ntype: city\npronunciation: doon AY-jun", "# Dun\n");
  writeMarkdown(path.join(root, "worldbuilding", "factions", "the-ceilidh.md"), "name: The Ceilidh | Band\ntype: guild\nstatus: active\npronunciation: KAY-lee", "# C\n");
  writeMarkdown(path.join(root, "worldbuilding", "artifacts", "quaich.md"), "name: Quaich\ntype: object\nstatus: active\npronunciation: QUAYKH", "# Q\n");
  writeMarkdown(path.join(root, "glossary", "terms", "sgian.md"), "term: Sgian\ncategory: term\npronunciation: SKEE-an", "# S\n");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Arrival\nnumber: 1\nstatus: draft", `## Chapter Text\n\nShe *ran*.\n\n* * *\n\n${"word ".repeat(310)}\n`);
  createEntity(root, { kind: "matter", name: "Dedication" });
  fs.appendFileSync(path.join(root, "matter", "dedication.md"), "\nFor Morag.\n");
  createEntity(root, { kind: "matter", name: "Historical Note", placement: "back" });
  fs.appendFileSync(path.join(root, "matter", "historical-note.md"), "\nThe clans are invented.\n");
  return root;
}

describe("narration build", () => {
  test("writes the pronunciation guide, credits, runtimes, and pauses", () => {
    const root = project();
    const result = buildBook(root, { format: "narration" });
    expect(result.outFile).toBe(path.join(root, "dist", "siorsa.narration.md"));
    const text = fs.readFileSync(result.outFile, "utf8");

    expect(text).toContain("# Siorsa: Narration Script\n\nEstimated finished runtime: 0h 02m at 155 words per minute (318 words).");
    expect(text).toContain([
      "| Name | Say it | Kind |",
      "| --- | --- | --- |",
      "| Dùn Èideann | doon AY-jun | location |",
      "| Quaich | QUAYKH | artifact |",
      "| Sgian | SKEE-an | term |",
      "| Siorsa | SHUR-sha | character |",
      "| The Ceilidh \\| Band | KAY-lee | faction |"
    ].join("\n"));
    expect(text).not.toContain("GON");
    expect(text).toContain("## Opening Credits\n\nSiorsa. Written by Ada Writer. Narrated by [narrator].");
    expect(text).toContain("## Dedication\n\n[under 1 min]\n\nFor Morag.");
    expect(text).toContain("## Chapter 1: Arrival\n\n[about 2 min]\n\nShe *ran*.\n\n[pause]\n\nword word");
    expect(text).not.toContain("All rights reserved");
    expect(text).toContain("## Historical Note\n\n[under 1 min]\n\nThe clans are invented.\n\n## Closing Credits");
    expect(text.trimEnd().endsWith("You have been listening to Siorsa, written by Ada Writer, narrated by [narrator].")).toBe(true);
    expect(validateProject(root).errors).toEqual([]);
  });

  test("says how to add pronunciations when there are none, and validate checks their type", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Plain", force: false });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nHi.\n");
    const text = fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8");
    expect(text).toContain("No pronunciations recorded.");
    expect(text).toContain("## Opening Credits\n\nPlain. Narrated by [narrator].");
    expect(text).toContain("You have been listening to Plain, narrated by [narrator].");

    writeMarkdown(path.join(root, "glossary", "terms", "odd.md"), "term: Odd\ncategory: term\npronunciation:\n  - one\n  - two", "# Odd\n");
    expect(validateProject(root).errors).toContain("glossary/terms/odd.md frontmatter field pronunciation must be text");
  });

  test("formatRuntime rounds to minutes", () => {
    expect(formatRuntime(0)).toBe("0h 00m");
    expect(formatRuntime(155 * 61)).toBe("1h 01m");
  });
});

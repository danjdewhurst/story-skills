import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { buildBook, createEntity, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

function project(fields) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Sheet Book", series: "tides", bookNumber: 2, form: "novella" });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\n${fields}\n`), "utf8");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: final", `## Chapter Text\n\n${"word ".repeat(600)}\n`);
  return root;
}

describe("metadata build", () => {
  test("lists every retailer field and ticks what is ready", () => {
    const root = project(`authors:
  - Ada Writer
  - Ben | Other
isbn: 9780306406157
publisher: Lamplight
publication-date: 2026-10-01
description: A town of lamps.
keywords:
  - lighthouse
  - storm
subjects:
  - FIC022000
cover-alt: A lamp
ai-disclosure: No AI was used.`);
    const result = buildBook(root, { format: "metadata" });
    expect(result.outFile).toBe(path.join(root, "dist", "sheet-book.metadata.md"));
    const text = fs.readFileSync(result.outFile, "utf8");
    expect(text).toContain("| Series | tides, book 2 |");
    expect(text).toContain("| Author(s) | Ada Writer; Ben \\| Other |");
    expect(text).toContain("| ISBN | 9780306406157 |");
    expect(text).toContain("| Genre | fiction / general |");
    expect(text).toContain("| Form | novella |");
    expect(text).toContain("| Word count | 600 |");
    expect(text).toContain("| Estimated print pages | 3 at 5.5x8.5, 2 at 6x9 |");
    expect(text).toContain("| Description | 16 characters (limit 4000) |");
    expect(text).toContain("| Keywords | 2 of 7: lighthouse; storm |");
    expect(text).toContain("| Cover | (missing) |");
    expect(text).toContain("## Description\n\nA town of lamps.");
    expect(text).toContain("- [x] ISBN for this edition");
    expect(text).toContain("- [ ] Copyright line (`copyright`) or copyright matter page");
    expect(text).toContain("- [ ] Cover image (`cover`)");
    expect(text).toContain("- [ ] Story status is complete");
    expect(validateProject(root).errors).toEqual([]);
  });

  test("a copyright matter page counts, and an empty story.md lists everything missing", () => {
    const root = project("status-note: none");
    createEntity(root, { kind: "matter", name: "Copyright Page" });
    fs.appendFileSync(path.join(root, "matter", "copyright-page.md"), "\n© Me\n");
    const text = fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8");
    expect(text).toContain("| ISBN | (missing) |");
    expect(text).toContain("## Description\n\n(missing)");
    expect(text).toContain("- [x] Copyright line (`copyright`) or copyright matter page");
    expect(text).toContain("- [ ] Author named");
  });

  test("an unquoted ISBN-10 that lost its leading zero asks to be quoted", () => {
    const root = project("isbn: 0306406152");
    expect(validateProject(root).errors).toContain("story.md isbn 306406152 is not a valid ISBN-13 or ISBN-10 (check the digits and checksum; quote it so leading zeros survive)");
  });
});

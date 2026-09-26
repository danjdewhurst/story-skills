import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { buildBook, createStoryProject } from "../src/story.js";
import { makeTempDir, readArchiveText, writeMarkdown } from "./helpers.js";

function shunnProject() {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title: "Shunn Story", force: false });
  const root = created.root;

  const storyPath = path.join(root, "story.md");
  const raw = fs.readFileSync(storyPath, "utf8");
  fs.writeFileSync(storyPath, raw.replace("title: Shunn Story\n", "title: Shunn Story\nauthor: Test Author\ncontact:\n  - Jane Doe\n  - jane@example.com\n"), "utf8");

  const bodies = [
    "Alpha **beta** gamma.\n\nDelta *epsilon*.",
    "Zeta eta theta iota.\n\nKappa lambda."
  ];
  bodies.forEach((body, index) => {
    const number = index + 1;
    writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 0
`, `## Chapter Text\n\n${body}\n`);
  });
  return { root, cwd };
}

describe("shunn docx assertions on decoded text", () => {
  test("docx --shunn embeds Shunn manuscript XML formatting", () => {
    const { root } = shunnProject();
    const { outFile } = buildBook(root, { format: "docx", shunn: true });
    const text = readArchiveText(outFile);

    expect(text).toContain("Courier New");
    expect(text).toContain(`<w:sz w:val="24"/>`);
    expect(text).toContain(`<w:spacing w:line="480" w:lineRule="auto"/>`);
    expect(text).toContain(`<w:br w:type="page"/>`);
    expect(text).toContain("Approximately 11 words");
    expect(text).toContain("<w:b/>");
    expect(text).toContain("<w:i/>");
  });
});

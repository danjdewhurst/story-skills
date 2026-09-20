import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { buildBook, createStoryProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

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

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

describe("shunn manuscript format", () => {
  test("writes markdown to the default .shunn.md dist path", () => {
    const { root } = shunnProject();
    const result = buildBook(root, { format: "shunn" });

    expect(result.format).toBe("shunn");
    expect(result.chapters).toBe(2);
    expect(result.outFile).toBe(path.join(root, "dist", "shunn-story.shunn.md"));
    expect(fs.existsSync(result.outFile)).toBe(true);
  });

  test("renders the title page with author, word count, and contact", () => {
    const { root } = shunnProject();
    const { outFile } = buildBook(root, { format: "shunn" });
    const text = fs.readFileSync(outFile, "utf8");

    expect(text).toContain("Shunn Story\nby\nTest Author");
    expect(text).toContain("Approximately 11 words");
    expect(text).toContain("Jane Doe\njane@example.com");
  });

  test("puts a literal form feed before each chapter heading", () => {
    const { root } = shunnProject();
    const { outFile } = buildBook(root, { format: "shunn" });
    const text = fs.readFileSync(outFile, "utf8");

    expect(text).toContain("\f\n# Chapter 1: Chapter 1");
    expect(text).toContain("\f\n# Chapter 2: Chapter 2");
  });

  test("separates prose paragraphs with blank lines", () => {
    const { root } = shunnProject();
    const { outFile } = buildBook(root, { format: "shunn" });
    const text = fs.readFileSync(outFile, "utf8");

    expect(text).toContain("Alpha **beta** gamma.\n\nDelta *epsilon*.");
    expect(text).toContain("Zeta eta theta iota.\n\nKappa lambda.");
  });

  test("markdown output is deterministic", () => {
    const { root } = shunnProject();
    const first = buildBook(root, { format: "shunn", out: "dist/a.shunn.md" });
    const second = buildBook(root, { format: "shunn", out: "dist/b.shunn.md" });

    expect(fs.readFileSync(first.outFile, "utf8")).toBe(fs.readFileSync(second.outFile, "utf8"));
  });

  test("docx --shunn embeds Shunn manuscript XML formatting", () => {
    const { root } = shunnProject();
    const { outFile } = buildBook(root, { format: "docx", shunn: true });
    const bytes = fs.readFileSync(outFile);

    expect(bytes.includes("Courier New")).toBe(true);
    expect(bytes.includes(`<w:sz w:val="24"/>`)).toBe(true);
    expect(bytes.includes(`<w:spacing w:line="480" w:lineRule="auto"/>`)).toBe(true);
    expect(bytes.includes(`<w:br w:type="page"/>`)).toBe(true);
    expect(bytes.includes("Approximately 11 words")).toBe(true);
    expect(bytes.includes("<w:b/>")).toBe(true);
    expect(bytes.includes("<w:i/>")).toBe(true);
  });

  test("docx --shunn output is byte-identical under SOURCE_DATE_EPOCH", () => {
    const { root } = shunnProject();
    const previous = process.env.SOURCE_DATE_EPOCH;
    process.env.SOURCE_DATE_EPOCH = "1234567890";
    try {
      const first = buildBook(root, { format: "docx", shunn: true, out: "dist/a.docx" });
      const second = buildBook(root, { format: "docx", shunn: true, out: "dist/b.docx" });
      expect(fs.readFileSync(first.outFile).equals(fs.readFileSync(second.outFile))).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.SOURCE_DATE_EPOCH;
      } else {
        process.env.SOURCE_DATE_EPOCH = previous;
      }
    }
  });

  test("cli builds shunn markdown and shunn docx", () => {
    const { root, cwd } = shunnProject();

    const markdown = invoke(cwd, ["build", root, "--format", "shunn"]);
    expect(markdown.code).toBe(0);
    expect(markdown.out).toContain(`Built 2 chapters as shunn to ${path.join(root, "dist", "shunn-story.shunn.md")}`);

    const docx = invoke(cwd, ["build", root, "--format", "docx", "--shunn"]);
    expect(docx.code).toBe(0);
    expect(docx.out).toContain("shunn-story.docx");
    const bytes = fs.readFileSync(path.join(root, "dist", "shunn-story.docx"));
    expect(bytes.includes(`<w:br w:type="page"/>`)).toBe(true);
  });

  test("cli rejects unknown build formats", () => {
    const { root, cwd } = shunnProject();
    const result = invoke(cwd, ["build", root, "--format", "nope"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Unsupported build format: nope");
  });
});

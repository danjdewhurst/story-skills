import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { buildBook, createStoryProject } from "../src/story.js";
import { makeTempDir, memoryIo, readArchiveText, writeMarkdown } from "./helpers.js";

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

function storyWithFields(title = "Open Builds", storyFields = "") {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title, force: false });
  const storyPath = path.join(created.root, "story.md");
  if (storyFields !== "") {
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(`title: ${title}\n`, `title: ${title}\n${storyFields}`), "utf8");
  }
  return { root: created.root, cwd };
}

function writeChapterFile(root, number, frontmatter, body) {
  writeMarkdown(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), `
number: ${number}
${/^status:/m.test(frontmatter) ? "" : "status: draft"}
${frontmatter}
`, `## Chapter Text\n\n${body}\n`);
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

    expect(text).toContain("\f\n# Chapter 1\n");
    expect(text).toContain("\f\n# Chapter 2\n");
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
    const text = readArchiveText(outFile);

    expect(text).toContain("Courier New");
    expect(text).toContain(`<w:sz w:val="24"/>`);
    expect(text).toContain(`<w:spacing w:line="480" w:lineRule="auto"/>`);
    expect(text).toContain(`<w:br w:type="page"/>`);
    expect(text).toContain("Approximately 11 words");
    expect(text).toContain("<w:b/>");
    expect(text).toContain("<w:i/>");
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
    expect(docx.out).toContain(`Built 2 chapters as docx to ${path.join(root, "dist", "shunn-story.shunn.docx")}`);
    const text = readArchiveText(path.join(root, "dist", "shunn-story.shunn.docx"));
    expect(text).toContain(`<w:br w:type="page"/>`);
  });

  test("docx and docx --shunn write separate default files", () => {
    const { root } = shunnProject();

    const shunn = buildBook(root, { format: "docx", shunn: true }).outFile;
    const plain = buildBook(root, { format: "docx" }).outFile;
    expect(path.relative(root, shunn)).toBe(path.join("dist", "shunn-story.shunn.docx"));
    expect(path.relative(root, plain)).toBe(path.join("dist", "shunn-story.docx"));
    expect(readArchiveText(shunn)).toContain("Courier New");
    expect(readArchiveText(plain)).not.toContain("Courier New");
  });

  test("cli rejects unknown build formats", () => {
    const { root, cwd } = shunnProject();
    const result = invoke(cwd, ["build", root, "--format", "nope"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("Unsupported build format: nope");
  });
});

describe("Shunn short-story layout (#135)", () => {
  test("short-story and flash forms join chapters with a centred # and no headings or page breaks", () => {
    const { root } = storyWithFields("Gull", "form: short-story\n");
    writeChapterFile(root, 1, "title: Part 1", "Text one.\n\n* * *\n\nAfter the break.");
    writeChapterFile(root, 2, "title: Part 2", "Text two.");
    writeChapterFile(root, 3, "title: Part 3", "");

    const docx = readArchiveText(buildBook(root, { format: "docx", shunn: true }).outFile);
    expect(docx).not.toContain('w:type="page"');
    expect(docx).not.toContain("Part 1");
    expect(docx.match(/<w:t xml:space="preserve">#<\/w:t>/g)).toHaveLength(2);

    const shunn = fs.readFileSync(buildBook(root, { format: "shunn" }).outFile, "utf8");
    expect(shunn).not.toContain("\f");
    expect(shunn).not.toContain("Part 1");
    expect(shunn).toContain("Text one.\n\n#\n\nAfter the break.\n\n#\n\nText two.\n");
    expect(shunn.trimEnd().endsWith("Text two.")).toBe(true);
  });

  test("a novel keeps chapter headings on new pages", () => {
    const { root } = storyWithFields("Long", "form: novel\n");
    writeChapterFile(root, 1, "title: Part 1", "Text one.");
    const shunn = fs.readFileSync(buildBook(root, { format: "shunn" }).outFile, "utf8");
    expect(shunn).toContain("\f\n# Chapter 1: Part 1");
  });
});

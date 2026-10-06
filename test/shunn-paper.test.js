import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { buildBook, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages, readArchiveEntries, writeMarkdown } from "./helpers.js";

const LETTER = '<w:pgSz w:w="12240" w:h="15840"/>';
const A4 = '<w:pgSz w:w="11906" w:h="16838"/>';
const MARGINS = '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';

function book(extra = "") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Lamp" });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\nauthor: Ada\n${extra}`), "utf8");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "\nFirst.\n");
  return root;
}

function documentXml(outFile) {
  return readArchiveEntries(outFile).find((entry) => entry.name === "word/document.xml").content.toString("utf8");
}

function invoke(root, argv) {
  const io = memoryIo(root);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

describe("--paper for the Shunn builds", () => {
  test("the Shunn DOCX is US Letter with 1in margins by default, and A4 with --paper a4", () => {
    const root = book();
    const letter = documentXml(buildBook(root, { format: "docx", shunn: true }).outFile);
    expect(letter).toContain(`<w:sectPr>${LETTER}${MARGINS}</w:sectPr></w:body>`);

    const a4 = documentXml(buildBook(root, { format: "docx", shunn: true, paper: " A4 ", out: "dist/a4.docx" }).outFile);
    expect(a4).toContain(`<w:sectPr>${A4}${MARGINS}</w:sectPr></w:body>`);

    // The plain DOCX keeps Word's own page.
    expect(documentXml(buildBook(root, { format: "docx" }).outFile)).toContain("<w:sectPr/></w:body>");
  });

  test("the page size comes before a right-to-left section's bidi, as the schema orders them", () => {
    const xml = documentXml(buildBook(book("language: ar\n"), { format: "docx", shunn: true, paper: "a4" }).outFile);
    expect(xml).toContain(`<w:sectPr>${A4}${MARGINS}<w:bidi/></w:sectPr></w:body>`);
  });

  test("--paper is an error outside the Shunn PDF and DOCX, and an unknown paper is rejected", () => {
    const root = book();
    const outside = "--paper applies only to --format shunn --pdf and --format docx --shunn (use --trim for --format print)";
    for (const args of [["--format", "print"], ["--format", "shunn"], ["--format", "docx"], ["--format", "epub"]]) {
      const result = invoke(root, ["build", root, ...args, "--paper", "a4"]);
      expect(result.code).toBe(2);
      expect(result.err).toContain(outside);
    }
    const unknown = invoke(root, ["build", root, "--format", "docx", "--shunn", "--paper", "a5"]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("Unsupported paper: a5. Supported papers: letter, a4");
  });

  test("a story.md default paper applies to the Shunn DOCX and waits out every other build", () => {
    const root = book("cli-defaults:\n  - command: build\n    paper: a4\n");
    const shunn = invoke(root, ["build", root, "--format", "docx", "--shunn"]);
    expect(shunn.err).toBe("");
    expect(shunn.code).toBe(0);
    expect(documentXml(path.join(root, "dist", "lamp.shunn.docx"))).toContain(A4);

    const epub = invoke(root, ["build", root, "--format", "epub"]);
    expect(epub.err).toBe("");
    expect(epub.code).toBe(0);

    const flag = invoke(root, ["build", root, "--format", "docx", "--shunn", "--paper", "letter", "--out", "dist/letter.docx"]);
    expect(flag.code).toBe(0);
    expect(documentXml(path.join(root, "dist", "letter.docx"))).toContain(LETTER);
  });

  test("validate rejects a default paper it cannot set", () => {
    const root = book("cli-defaults:\n  - command: build\n    paper: a3\n");
    expect(messages(validateProject(root).errors)).toContain("story.md cli-defaults[0] paper must be letter or a4");
  });
});

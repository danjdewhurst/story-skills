import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { buildBook, createStoryProject } from "../src/story.js";
import { makeTempDir, readArchiveEntries, readArchiveText, writeMarkdown } from "./helpers.js";

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

const HEADER_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
const LETTER = `<w:pgSz w:w="12240" w:h="15840"/>`;
const MARGINS = `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>`;

// A one-chapter book, with `fields` in place of the title line in story.md.
function lampProject(fields) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Lamp", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("title: Lamp\n", fields), "utf8");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "\nFirst.\n");
  return root;
}

// Each part of a built DOCX by name, as text.
function docxParts(root, options = {}) {
  const { outFile } = buildBook(root, { format: "docx", ...options });
  return Object.fromEntries(readArchiveEntries(outFile).map((entry) => [entry.name, entry.content.toString("utf8")]));
}

// The header part the section's `type` header reference points at, followed
// through word/_rels/document.xml.rels.
function headerPart(parts, type) {
  const id = new RegExp(`<w:headerReference w:type="${type}" r:id="([^"]+)"/>`).exec(parts["word/document.xml"])?.[1];
  const target = new RegExp(`<Relationship Id="${id}" Type="${HEADER_TYPE}" Target="([^"]+)"/>`).exec(parts["word/_rels/document.xml.rels"])?.[1];
  return parts[`word/${target}`];
}

// The running head's text, before its page number.
function headText(header) {
  return [...header.matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g)].map((match) => match[1]).join("");
}

describe("the Shunn DOCX running head (#525)", () => {
  test("every page but the title page has the author, title, and page number", () => {
    const parts = docxParts(shunnProject().root, { shunn: true });
    const names = Object.keys(parts);
    expect(names).toContain("word/header1.xml");
    expect(names).toContain("word/header2.xml");

    // Each header part has its content type and a relationship of its own.
    for (const name of ["header1.xml", "header2.xml"]) {
      expect(parts["[Content_Types].xml"]).toContain(`<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`);
    }
    const rels = parts["word/_rels/document.xml.rels"];
    expect(rels).toContain(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
    expect(rels).toContain(`<Relationship Id="rId2" Type="${HEADER_TYPE}" Target="header1.xml"/>`);
    expect(rels).toContain(`<Relationship Id="rId3" Type="${HEADER_TYPE}" Target="header2.xml"/>`);

    // The section references both, in the schema's order, and titlePg sets
    // the first page apart.
    const document = parts["word/document.xml"];
    expect(document).toContain(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`);
    expect(document).toContain(`<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:headerReference w:type="first" r:id="rId3"/>${LETTER}${MARGINS}<w:titlePg/></w:sectPr></w:body>`);

    const head = headerPart(parts, "default");
    expect(head).toStartWith(`<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p>`);
    expect(headText(head)).toBe("Test Author / Shunn Story / ");
    expect(head).toContain(`<w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="right"/></w:pPr>`);
    expect(head).toContain(`<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/></w:rPr>`);
    // The page number is a PAGE field, after the text.
    expect(head).toMatch(/Shunn Story \/ <\/w:t><\/w:r><w:r><w:rPr>.*?<\/w:rPr><w:fldChar w:fldCharType="begin"\/><\/w:r><w:r><w:rPr>.*?<\/w:rPr><w:instrText xml:space="preserve"> PAGE <\/w:instrText><\/w:r><w:r><w:rPr>.*?<\/w:rPr><w:fldChar w:fldCharType="separate"\/><\/w:r><w:r><w:rPr>.*?<\/w:rPr><w:fldChar w:fldCharType="end"\/><\/w:r><\/w:p><\/w:hdr>$/);

    // The title page's header is empty.
    const first = headerPart(parts, "first");
    expect(first).toStartWith(`<?xml version="1.0" encoding="UTF-8"?><w:hdr`);
    expect(first).toContain("<w:p>");
    expect(first).not.toContain("<w:r>");
  });

  test("the head names the editor without an author, and the title alone without either, as the PDF's does", () => {
    expect(headText(headerPart(docxParts(lampProject("title: Lamp\neditor: Cara Editor\n"), { shunn: true }), "default"))).toBe("Cara Editor / Lamp / ");
    expect(headText(headerPart(docxParts(lampProject("title: Lamp\nauthors:\n  - Ada Writer\n  - Ben Other\n"), { shunn: true }), "default"))).toBe("Ada Writer and Ben Other / Lamp / ");
    expect(headText(headerPart(docxParts(lampProject("title: Lamp\n"), { shunn: true }), "default"))).toBe("Lamp / ");
  });

  test("the head stays on one line and escapes its text", () => {
    const parts = docxParts(lampProject(`title: "Salt & <Pepper>\\nRoads"\nauthor: Ada\n`), { shunn: true });
    expect(headText(headerPart(parts, "default"))).toBe("Ada / Salt &amp; &lt;Pepper&gt; Roads / ");
  });

  test("a right-to-left book's head runs right to left", () => {
    const parts = docxParts(lampProject("title: Lamp\nauthor: Ada\nlanguage: ar\n"), { shunn: true });
    const head = headerPart(parts, "default");
    expect(head).toContain(`<w:pPr><w:bidi/><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="right"/></w:pPr>`);
    expect(head).toContain(`<w:sz w:val="24"/><w:rtl/></w:rPr><w:t xml:space="preserve">Ada / Lamp / </w:t>`);
    expect(parts["word/document.xml"]).toContain(`<w:titlePg/><w:bidi/></w:sectPr></w:body>`);
  });

  test("the plain DOCX has no header", () => {
    const parts = docxParts(lampProject("title: Lamp\nauthor: Ada\n"));
    expect(Object.keys(parts).filter((name) => name.includes("header"))).toEqual([]);
    expect(parts["[Content_Types].xml"]).not.toContain("header");
    expect(parts["word/_rels/document.xml.rels"]).not.toContain("header");
    expect(parts["word/document.xml"]).toContain(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`);
    expect(parts["word/document.xml"]).toContain("<w:sectPr/></w:body>");
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { languagePack } from "../src/languages/index.js";
import { shunnHeadParts, shunnHtml } from "../src/packaging.js";
import { buildBook, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages, readArchiveEntries, readArchiveText, writeMarkdown } from "./helpers.js";

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
function lampProject(fields, chapterFields = "") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Lamp", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("title: Lamp\n", fields), "utf8");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `title: One\nnumber: 1\nstatus: draft${chapterFields}`, "\nFirst.\n");
  return root;
}

// Each part of a built DOCX by name, as text.
function docxParts(root, options = {}) {
  const { outFile } = buildBook(root, { format: "docx", ...options });
  return Object.fromEntries(readArchiveEntries(outFile).map((entry) => [entry.name, entry.content.toString("utf8")]));
}

// The header part the section's `type` header reference points at, followed
// through word/_rels/document.xml.rels, comparing the relationship's
// attributes as text.
function headerPart(parts, type) {
  const id = new RegExp(`<w:headerReference w:type="${type}" r:id="(rId\\d+)"/>`).exec(parts["word/document.xml"])?.[1];
  const relationship = [...parts["word/_rels/document.xml.rels"].matchAll(/<Relationship Id="([^"]*)" Type="([^"]*)" Target="([^"]*)"\/>/g)]
    .find(([, relationshipId, relationshipType]) => relationshipId === id && relationshipType === HEADER_TYPE);
  return relationship === undefined ? undefined : parts[`word/${relationship[3]}`];
}

// The running head's text, before its page number.
function headText(header) {
  return [...header.matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g)].map((match) => match[1]).join("");
}

// The Shunn DOCX's running head text for a book with these story.md fields.
function docxHead(fields, options = {}) {
  return headText(headerPart(docxParts(lampProject(fields), { shunn: true, ...options }), "default"));
}

// Courier columns a head takes, counting a Chinese, Japanese, or Korean
// character, which a fallback font sets about twice as wide, as two.
function columns(text) {
  return [...text].reduce((sum, char) => sum + (/\p{M}/u.test(char) ? 0 : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uff60]/u.test(char) ? 2 : 1), 0);
}

// The head as the DOCX and the PDF print it, with the widest page number
// a manuscript reaches.
function fullHead(meta) {
  return `${shunnHeadParts(meta).map((part) => `${part} / `).join("")}9999`;
}

function invoke(root, argv) {
  const io = memoryIo(root);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

describe("the Shunn DOCX running head (#525)", () => {
  test("every page but the title page has the surname, short title, and page number", () => {
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
    expect(headText(head)).toBe("Author / Shunn Story / ");
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

  test("a relationship of another type is not taken for the header", () => {
    const parts = docxParts(shunnProject().root, { shunn: true });
    const wrongType = parts["word/_rels/document.xml.rels"].replace(`Id="rId2" Type="${HEADER_TYPE}"`, `Id="rId2" Type="${HEADER_TYPE.replace(/\./g, "x")}"`);
    expect(headerPart({ ...parts, "word/_rels/document.xml.rels": wrongType }, "default")).toBeUndefined();
  });

  test("the surname is the first author's or editor's last name, past a suffix", () => {
    expect(docxHead("title: Lamp\neditor: Cara Editor\n")).toBe("Editor / Lamp / ");
    expect(docxHead("title: Lamp\nauthors:\n  - Ada Writer\n  - Ben Other\n")).toBe("Writer / Lamp / ");
    expect(docxHead("title: Lamp\n")).toBe("Lamp / ");
    const surname = (lead) => shunnHeadParts({ lead, title: "Lamp" })[0];
    expect(surname("Martin Luther King, Jr.")).toBe("King");
    expect(surname("Sam Jones Sr")).toBe("Jones");
    expect(surname("John Smith III")).toBe("Smith");
    expect(surname("Ann Lee iv.")).toBe("Lee");
    expect(surname("Banksy")).toBe("Banksy");
    expect(surname("Jr.")).toBe("Jr.");
    expect(surname("\u6751\u4e0a\u6625\u6a39")).toBe("\u6751\u4e0a\u6625\u6a39");
  });

  test("only the part of a name before a comma counts", () => {
    const surname = (lead) => shunnHeadParts({ lead, title: "Lamp" })[0];
    expect(surname("Mary Smith, PhD")).toBe("Smith");
    expect(surname("Mary Smith, M.D.")).toBe("Smith");
    expect(surname("Smith, John")).toBe("Smith");
    expect(surname("Smith, Jr.")).toBe("Smith");
    expect(surname(", Smith")).toBe("Smith");
    // A degree or title without the comma is passed over too.
    expect(surname("Mary Smith PhD")).toBe("Smith");
    expect(surname("Mary Smith Ph.D.")).toBe("Smith");
    expect(surname("Mary Smith MD")).toBe("Smith");
    expect(surname("John Smith Esq.")).toBe("Smith");
  });

  test("a book in a language that puts the family name first takes the first word", () => {
    // The example's author is written as the family name, a space, then the
    // given name.
    const cwd = makeTempDir();
    const root = path.join(cwd, "kirimi-eki-no-wasuremono");
    fs.cpSync(path.join(import.meta.dir, "..", "examples", "kirimi-eki-no-wasuremono"), root, { recursive: true });
    expect(fs.readFileSync(path.join(root, "story.md"), "utf8")).toContain("author: \u6d45\u91ce \u5343\u5c0b\nlanguage: ja\n");
    const head = headText(headerPart(docxParts(root, { shunn: true }), "default"));
    expect(head).toBe("\u6d45\u91ce / \u9727\u898b\u99c5\u306e\u5fd8\u308c\u3082\u306e / ");

    const surname = (lead, language) => shunnHeadParts({ lead, title: "Lamp", pack: languagePack(language) })[0];
    expect(surname("Szab\u00f3 Magda", "hu")).toBe("Szab\u00f3");
    expect(surname("\uae40 \ubbfc\uc218", "ko")).toBe("\uae40");
    expect(surname("\u738b \u5c0f\u660e", "zh-Hant")).toBe("\u738b");
    expect(surname("Wong Kar Wai", "yue")).toBe("Wong");
    expect(surname("Asano Chihiro", "ja-Latn")).toBe("Asano");
    // Other languages keep the last word.
    expect(surname("Magda Szab\u00f3", "de")).toBe("Szab\u00f3");
    expect(surname("Ada Writer", "en")).toBe("Writer");
  });

  test("the short title is the title before a subtitle, cut at a word to fit", () => {
    const title = (text) => shunnHeadParts({ lead: "", title: text })[0];
    expect(title("Lamp: A Story of Light")).toBe("Lamp");
    expect(title("Lamp \u2014 A Story")).toBe("Lamp");
    expect(title("Lamp\u2014A Story")).toBe("Lamp");
    expect(title("\u30e9\u30f3\u30d7\uff1a\u5149")).toBe("\u30e9\u30f3\u30d7");
    expect(title("Lamp\u00a0: une histoire")).toBe("Lamp");
    expect(title("Re:Zero")).toBe("Re:Zero");
    expect(title("\u2014And Then")).toBe("\u2014And Then");
    expect(title("The Long Cold Night, the Short Day")).toBe("The Long Cold Night, the Short");
    expect(title("The Long, Cold, Endless Nights, Again")).toBe("The Long, Cold, Endless");
    expect(title("The Long and Cold Night-Time-Wanderers")).toBe("The Long and Cold Night-Time");
    expect(title("Supercalifragilisticexpialidociousness")).toBe("Supercalifragilisticexpialidoc");
    expect(title("A title of exactly thirty char")).toBe("A title of exactly thirty char");
  });

  test("a cut drops the joining word or mark it leaves at the end", () => {
    const title = (text, labels) => shunnHeadParts({ lead: "", title: text, labels })[0];
    expect(title("The Extraordinarily Long and Winding Road Home")).toBe("The Extraordinarily Long");
    expect(title("The Extraordinarily Long AND Winding Road Home")).toBe("The Extraordinarily Long");
    expect(title("The Extraordinarily Long & Winding Road Home")).toBe("The Extraordinarily Long");
    expect(title("The Extraordinarily Long / Winding Road Home")).toBe("The Extraordinarily Long");
    expect(title("The Extraordinarily Long and & Winding Road")).toBe("The Extraordinarily Long");
    // The book's own `and`, from its language or a label of its own.
    const german = languagePack("de").labels;
    expect(title("Die au\u00dferordentlich lange und gewundene Stra\u00dfe", german)).toBe("Die au\u00dferordentlich lange");
    expect(title("La route extraordinairement et longue", { and: "{a} et {b}" })).toBe("La route extraordinairement");
    // The head carries the label through a build.
    expect(docxHead("title: Die au\u00dferordentlich lange und gewundene Stra\u00dfe\nauthor: Ada\nlanguage: de\n")).toBe("Ada / Die au\u00dferordentlich lange / ");
    // A word that only ends in a joiner stays.
    expect(title("The Extraordinarily Long Grand Winding Road")).toBe("The Extraordinarily Long Grand");
  });

  test("story.md surname and short-title set the head, and validate wants them as text", () => {
    expect(docxHead("title: The Left Hand of Darkness\nauthor: Ursula K. Le Guin\nsurname: Le Guin\nshort-title: Left Hand\n")).toBe("Le Guin / Left Hand / ");
    // A set surname wins over the editor too.
    expect(docxHead("title: Lamp\neditor: Cara Editor\nsurname: Editor & Other\n")).toBe("Editor &amp; Other / Lamp / ");
    // A surname or short title set by hand is used whole, however long.
    expect(docxHead("title: Lamp\nauthor: Ada\nsurname: Kowalczyk & Henderson-Smythe\nshort-title: A Very Long Short Title That Goes On and On\n"))
      .toBe("Kowalczyk &amp; Henderson-Smythe / A Very Long Short Title That Goes On and On / ");
    expect(shunnHeadParts({ lead: "Ada", surname: "Le\nGuin", shortTitle: " Left\tHand ", title: "Lamp" })).toEqual(["Le Guin", "Left Hand"]);
    const root = lampProject("title: Lamp\nsurname: 12\nshort-title:\n  - Lamp\n");
    expect(messages(validateProject(root).errors)).toEqual(expect.arrayContaining([
      "story.md frontmatter field surname must be text",
      "story.md frontmatter field short-title must be text"
    ]));
  });

  test("a head the build works out never wraps, however long the name and title", () => {
    const long = "Wolfeschlegelsteinhausenbergerdorff Ruthersfordington-Smythe";
    // A4 is the narrower page: 62 Courier columns between its margins.
    for (const meta of [
      { lead: long, title: `${long} and the ${long}` },
      { lead: `${long}${long}`, title: `${long}${long}` },
      { lead: "\u6751\u4e0a\u6625\u6a39\u6751\u4e0a\u6625\u6a39\u6751\u4e0a\u6625\u6a39", title: "\u8272\u5f69\u3092\u6301\u305f\u306a\u3044\u591a\u5d0e\u3064\u304f\u308b\u3068\u3001\u5f7c\u306e\u5de1\u793c\u306e\u5e74\u3068\u5f7c\u306e\u5de1\u793c\u306e\u5e74" },
      { lead: "\uae40\ubbfc\uc218\uae40\ubbfc\uc218\uae40\ubbfc\uc218\uae40\ubbfc\uc218", title: "\ud55c\uad6d\uc5b4 \uc81c\ubaa9\uc774 \uc544\uc8fc \uae38\uace0 \uae38\uace0 \ub610 \uae38\uc5b4\uc11c \ub05d\uc774 \uc5c6\ub2e4" }
    ]) {
      expect(columns(fullHead(meta))).toBeLessThanOrEqual(62);
    }
    const head = docxHead(`title: ${long} and the ${long}\nauthor: ${long}\n`, { paper: "a4" });
    expect(head).toBe("Ruthersfordington / Wolfeschlegelsteinhausenberger / ");
    expect(head.length + "9999".length).toBeLessThanOrEqual(62);
  });

  test("each line break or control character in a part is one space", () => {
    for (const mark of ["\n", "\r", "\r\n", "\f", "\v", "\t", "\u0085", "\u2028", "\u2029", "\ue001", " \n "]) {
      expect(shunnHeadParts({ lead: `Ada${mark}Writer`, title: `Salt${mark}Roads` })).toEqual(["Writer", "Salt Roads"]);
    }
    // In the DOCX, a raw line break, a <w:br/>, or a deleted character
    // would each break the head's line or join its words.
    const parts = docxParts(lampProject(`title: "Salt\\rRoads\\fto\\u000bthe\\u2028Sea\\uE001Again"\nauthor: Ada\n`), { shunn: true });
    const head = headerPart(parts, "default");
    expect(headText(head)).toBe("Ada / Salt Roads to the Sea Again / ");
    expect(head).not.toMatch(/[\r\n\f\v\u2028\ue001]|<w:br\/>/);
  });

  test("the head escapes its text", () => {
    expect(docxHead(`title: "Salt & <Pepper>"\nauthor: Ada\n`)).toBe("Ada / Salt &amp; &lt;Pepper&gt; / ");
  });

  test("a right-to-left book's head runs right to left, every run with it", () => {
    const parts = docxParts(lampProject("title: Lamp\nauthor: Ada\nlanguage: ar\n"), { shunn: true });
    const head = headerPart(parts, "default");
    expect(head).toContain(`<w:pPr><w:bidi/><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="right"/></w:pPr>`);
    const runs = [...head.matchAll(/<w:r>(.*?)<\/w:r>/g)].map((match) => match[1]);
    // The text, then the PAGE field's begin, instruction, separator, and end.
    expect(runs.length).toBe(5);
    for (const run of runs) {
      expect(run).toContain(`<w:sz w:val="24"/><w:rtl/></w:rPr>`);
    }
    expect(runs[2]).toContain(`<w:instrText xml:space="preserve"> PAGE </w:instrText>`);
    expect(parts["word/document.xml"]).toContain(`<w:titlePg/><w:bidi/></w:sectPr></w:body>`);
  });

  test("the DOCX and the PDF set the same head on the same side", () => {
    // In a bidi paragraph, Word and LibreOffice read jc="right" as the end
    // of the line: the left.
    const docxSide = (head) => (head.includes("<w:bidi/>") ? "left" : "right");
    const pdfSide = (html) => /@page \{ [^@]*@top-(left|right) \{ content: /.exec(html)[1];
    // A Japanese book takes the family name first, so its surname is Ada.
    for (const [language, side, surname] of [["en", "right", "Writer"], ["ar", "left", "Writer"], ["he", "left", "Writer"], ["ja", "right", "Ada"]]) {
      const head = headerPart(docxParts(lampProject(`title: Lamp: A Story\nauthor: Ada Writer\nlanguage: ${language}\n`), { shunn: true }), "default");
      const pack = languagePack(language);
      const html = shunnHtml({ meta: { language }, chapters: [{ heading: "One", byline: "", body: "First." }] }, {
        title: "Lamp: A Story", author: "Ada Writer", lead: "Ada Writer", editors: "", labels: pack.labels, contact: [], words: 1, pack, shortForm: false
      });
      expect(docxSide(head)).toBe(side);
      expect(pdfSide(html)).toBe(side);
      expect(html).toContain(`@page :first { @top-${side} { content: none; } }`);
      expect(html).toContain(`@top-${side} { content: "${surname} / " "Lamp / " counter(page);`);
      expect(headText(head)).toBe(`${surname} / Lamp / `);
    }
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

describe("build --anonymous for a market that reads blind", () => {
  const fields = "title: Lamp\nauthor: Ada Writer\nsurname: Writer\neditor: Cara Editor\ncontact:\n  - Ada Writer\n  - ada@example.com\n";

  test("the Shunn DOCX and markdown leave every name out, the head included", () => {
    const root = lampProject(fields, "\nauthor: Ben Other");
    const named = docxParts(root, { shunn: true });
    expect(named["word/document.xml"]).toContain("Ada Writer");
    expect(named["word/document.xml"]).toContain("by Ben Other");

    const parts = docxParts(root, { shunn: true, anonymous: true, out: "dist/blind.docx" });
    const text = Object.values(parts).join("\n");
    for (const name of ["Ada", "Writer", "Cara", "Editor", "Ben", "Other", "ada@example.com"]) {
      expect(text).not.toContain(name);
    }
    expect(headText(headerPart(parts, "default"))).toBe("Lamp / ");
    expect(parts["word/document.xml"]).toContain("Approximately 1 word");

    const { outFile } = buildBook(root, { format: "shunn", anonymous: true });
    const markdown = fs.readFileSync(outFile, "utf8");
    expect(markdown.startsWith("Lamp\n\nApproximately 1 word")).toBe(true);
    for (const name of ["Ada", "Writer", "Cara", "Ben"]) {
      expect(markdown).not.toContain(name);
    }
  });

  test("--anonymous is an error outside the Shunn builds and cannot be a default", () => {
    const root = lampProject(fields);
    for (const args of [["--format", "docx"], ["--format", "epub"], ["--format", "html"]]) {
      const result = invoke(root, ["build", root, ...args, "--anonymous"]);
      expect(result.code).toBe(2);
      expect(result.err).toContain("--anonymous applies only to --format shunn and --format docx --shunn");
    }
    const shunn = invoke(root, ["build", root, "--format", "docx", "--shunn", "--anonymous"]);
    expect(shunn.err).toBe("");
    expect(shunn.code).toBe(0);

    const defaulted = lampProject(`${fields}cli-defaults:\n  - command: build\n    anonymous: true\n`);
    expect(messages(validateProject(defaulted).errors)).toContain("story.md cli-defaults[0] sets anonymous, which belongs to one run: pass --anonymous on the command line");
  });
});

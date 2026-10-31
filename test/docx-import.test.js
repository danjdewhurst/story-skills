import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { runCli } from "../src/cli.js";
import { spawnSync } from "node:child_process";
import { docxMarkdown, MAX_DOCX_PART_BYTES } from "../src/docx.js";
import { scanComments } from "../src/markdown.js";
import { crc32, writeZip } from "../src/packaging.js";
import { expectLinearGrowth, makeTempDir, memoryIo, NODE_ON_PATH } from "./helpers.js";

const repoRoot = path.join(import.meta.dir, "..");
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

// Styles as a localised Word writes them: the ids are not English, and the
// names are what mark a heading, a quote, or an emphasis style.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Titel"><w:name w:val="Title"/><w:basedOn w:val="Standard"/><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/><w:basedOn w:val="Standard"/><w:rPr><w:b/><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ChapterHead"><w:name w:val="Chapter Head"/><w:basedOn w:val="Standard"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Zitat"><w:name w:val="Quote"/><w:basedOn w:val="Standard"/></w:style>
<w:style w:type="character" w:styleId="Hervorhebung"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>
</w:styles>`;

function documentXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

function paragraph(runs, properties = "") {
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${runs}</w:p>`;
}

function run(text, properties = "") {
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function docxFile(file, body, { styles = STYLES, entries = [] } = {}) {
  writeZip(file, [
    { name: "[Content_Types].xml", content: "<Types/>" },
    { name: "word/document.xml", content: documentXml(body) },
    ...(styles === null ? [] : [{ name: "word/styles.xml", content: styles }]),
    ...entries
  ]);
  return file;
}

function docxBytes(body, options) {
  const file = docxFile(path.join(makeTempDir(), "draft.docx"), body, options);
  return fs.readFileSync(file);
}

function chapterText(file) {
  const text = fs.readFileSync(file, "utf8");
  return text.slice(text.indexOf("## Chapter Text") + "## Chapter Text".length).trim();
}

function importCli(cwd, ...argv) {
  const io = memoryIo(cwd);
  const code = runCli(["import", ...argv], io);
  return { code, out: io.output(), err: io.error() };
}

describe("docxMarkdown", () => {
  test("writes headings, emphasis, quotes, breaks, and scene breaks as markdown", () => {
    const body = [
      paragraph(run("The Salt Road"), '<w:pStyle w:val="Titel"/>'),
      paragraph(run("Chapter 1: Low Tide"), '<w:pStyle w:val="berschrift1"/>'),
      paragraph(`<w:r><w:tab/><w:t>She said </w:t></w:r>${run("never ", "<w:i/>")}${run("again", '<w:rStyle w:val="Hervorhebung"/>')}${run(", and meant ")}${run("it", "<w:b/>")}${run(".")}`),
      paragraph(run("Plain", '<w:rStyle w:val="Hervorhebung"/><w:i w:val="0"/>')),
      paragraph(""),
      paragraph(run("* * *")),
      paragraph(run("#"), '<w:jc w:val="center"/>'),
      paragraph(`<w:r><w:t>Roses are red,</w:t><w:br/><w:t>salt is white.</w:t></w:r>`),
      paragraph(run("An ember given is a fire kept."), '<w:pStyle w:val="Zitat"/>'),
      paragraph(`${run("Before the break.")}<w:r><w:br w:type="page"/></w:r>${run("After it.")}`),
      paragraph(run("Chapter 2"), '<w:pStyle w:val="ChapterHead"/>'),
      paragraph(run("Part Two"), '<w:outlineLvl w:val="0"/>'),
      paragraph(run("Fish &amp; chips &#x2014; <none> &#8220;quoted&#8221;".replace("<none>", "&lt;b&gt;"))),
      paragraph(run("# not a heading")),
      paragraph(run("1. not a list")),
      paragraph(run("- not a list either")),
      paragraph(run("> not a quote")),
      paragraph(run("===")),
      paragraph(run("snake_case and *stars* and [brackets] and a back\\slash")),
      paragraph(`<w:r><w:t>co­op</w:t><w:noBreakHyphen/><w:t>era</w:t></w:r>`)
    ].join("");
    const { text, notes } = docxMarkdown(docxBytes(body));
    expect(notes).toEqual([]);
    expect(text).toBe([
      "# The Salt Road",
      "# Chapter 1: Low Tide",
      "She said *never again*, and meant **it**.",
      "Plain",
      "* * *",
      "***",
      "Roses are red,\\\nsalt is white.",
      "> An ember given is a fire kept.",
      "Before the break.",
      "After it.",
      "## Chapter 2",
      "# Part Two",
      "Fish & chips — \\<b> “quoted”",
      "\\# not a heading",
      "1\\. not a list",
      "\\- not a list either",
      "\\> not a quote",
      "\\===",
      "snake\\_case and \\*stars\\* and \\[brackets\\] and a back\\\\slash",
      "coop‑era"
    ].join("\n\n") + "\n");
  });

  test("keeps spaces outside emphasis markers and gives each line of an emphasised run its own", () => {
    const body = paragraph(`${run("A")}${run(" bold ", "<w:b/><w:i/>")}${run("word.")}`)
      + paragraph(`<w:r><w:rPr><w:i/></w:rPr><w:t>one</w:t><w:br/><w:t>two</w:t></w:r>`);
    expect(docxMarkdown(docxBytes(body)).text).toBe("A ***bold*** word.\n\n*one*\\\n*two*\n");
  });

  test("reads tracked changes as accepted and names what it leaves out", () => {
    const body = [
      paragraph(`${run("Kept ")}<w:ins w:id="1"><w:r><w:t>added</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>removed</w:delText></w:r></w:del>${run(".")}`),
      paragraph(`<w:commentRangeStart w:id="0"/>${run("Commented")}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>`),
      paragraph(`${run("Noted")}<w:r><w:footnoteReference w:id="1"/></w:r>`),
      paragraph(`${run("Pictured")}<w:r><w:drawing><wp:inline><a:t>alt</a:t></wp:inline></w:drawing></w:r>`),
      paragraph(`<w:r><mc:AlternateContent><mc:Choice><w:drawing><w:txbxContent>${paragraph(run("Boxed"))}</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>${paragraph(run("Boxed again"))}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>${run("Around the box")}`),
      `<w:tbl><w:tr><w:tc>${paragraph(run("Cell"))}</w:tc></w:tr></w:tbl>`,
      paragraph(`${run("Reformatted", "<w:i/><w:rPrChange><w:rPr><w:b/></w:rPr></w:rPrChange>")}`),
      paragraph(`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("7")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`)
    ].join("");
    const { text, notes } = docxMarkdown(docxBytes(body));
    expect(text).toBe(["Kept added.", "Commented", "Noted", "Pictured", "Around the box", "Cell", "*Reformatted*", "7"].join("\n\n") + "\n");
    expect(notes.map((note) => note.code).sort()).toEqual(["comments", "footnotes", "images", "tables", "text-boxes", "tracked-changes"]);
  });

  test("reads a document with no styles part", () => {
    expect(docxMarkdown(docxBytes(paragraph(run("Only text.")), { styles: null })).text).toBe("Only text.\n");
  });

  test("refuses files that are not a readable Word document", () => {
    expect(() => docxMarkdown(Buffer.from("not a zip at all, just some text"))).toThrow("it is not a readable zip file");
    const dir = makeTempDir();
    const noDocument = path.join(dir, "no-document.docx");
    writeZip(noDocument, [{ name: "word/styles.xml", content: STYLES }]);
    expect(() => docxMarkdown(fs.readFileSync(noDocument))).toThrow("it has no word/document.xml");
    expect(() => docxMarkdown(docxBytes(`<!DOCTYPE w [<!ENTITY a "aaaa">]>${paragraph(run("&a;"))}`))).toThrow("document type declaration");
  });

  test("refuses an encrypted, damaged, oversized, or unknown-method entry", () => {
    const good = docxBytes(paragraph(run("Text.")));
    const central = good.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const document = (() => {
      // The central entry for word/document.xml.
      let position = good.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      while (good.toString("utf8", position + 46, position + 46 + good.readUInt16LE(position + 28)) !== "word/document.xml") {
        position += 46 + good.readUInt16LE(position + 28) + good.readUInt16LE(position + 30) + good.readUInt16LE(position + 32);
      }
      return position;
    })();
    expect(central).toBeGreaterThan(0);
    const changed = (edit) => {
      const copy = Buffer.from(good);
      edit(copy);
      return copy;
    };
    expect(() => docxMarkdown(changed((bytes) => bytes.writeUInt16LE(1, document + 8)))).toThrow("password-protected");
    expect(() => docxMarkdown(changed((bytes) => bytes.writeUInt32LE(bytes.readUInt32LE(document + 16) ^ 1, document + 16)))).toThrow("is damaged");
    expect(() => docxMarkdown(changed((bytes) => bytes.writeUInt32LE(MAX_DOCX_PART_BYTES + 1, document + 24)))).toThrow("byte limit");
    expect(() => docxMarkdown(changed((bytes) => bytes.writeUInt16LE(12, document + 10)))).toThrow("compression method 12");
  });

  test("stops a part that inflates past its declared size", () => {
    // A small deflate stream of zeros that claims to inflate to 10 bytes.
    const content = Buffer.alloc(1024 * 1024);
    const deflated = zlib.deflateRawSync(content);
    const name = Buffer.from("word/document.xml");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(content), 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(10, 22);
    local.writeUInt16LE(name.length, 26);
    const centralEntry = Buffer.alloc(46);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(8, 10);
    centralEntry.writeUInt32LE(crc32(content), 16);
    centralEntry.writeUInt32LE(deflated.length, 20);
    centralEntry.writeUInt32LE(10, 24);
    centralEntry.writeUInt16LE(name.length, 28);
    const centralStart = local.length + name.length + deflated.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(centralEntry.length + name.length, 12);
    end.writeUInt32LE(centralStart, 16);
    const zip = Buffer.concat([local, name, deflated, centralEntry, name, end]);
    expect(() => docxMarkdown(zip)).toThrow("is damaged");
  });
});

// A zip written by hand, so a test can break one field: each entry is
// stored (method 0) unless it gives its own method and data.
function rawZip(entries, { count, directorySize, directoryOffset, centralSignature = 0x02014b50 } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.from(entry.content ?? "");
    const data = entry.data ?? content;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(entry.localSignature ?? 0x04034b50, 0);
    local.writeUInt16LE(entry.method ?? 0, 8);
    local.writeUInt32LE(crc32(content), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(centralSignature, 0);
    central.writeUInt16LE(entry.method ?? 0, 10);
    central.writeUInt32LE(crc32(content), 16);
    central.writeUInt32LE(entry.compressedSize ?? data.length, 20);
    central.writeUInt32LE(entry.size ?? content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count ?? entries.length, 8);
  end.writeUInt16LE(count ?? entries.length, 10);
  end.writeUInt32LE(directorySize ?? directory.length, 12);
  end.writeUInt32LE(directoryOffset ?? offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe("docxMarkdown on hand-made zips", () => {
  const document = (body) => ({ name: "word/document.xml", content: documentXml(body) });

  test("reads a stored entry, a byte-order mark, CDATA, and text after the last tag", () => {
    const xml = `\ufeff<w:document ${W}><w:body><w:p><w:r><w:t><![CDATA[Fish & <chips>]]></w:t></w:r></w:p><!-- a comment --><?pi?></w:body></w:document>trailing`;
    expect(docxMarkdown(rawZip([{ name: "word/document.xml", content: xml }])).text).toBe("Fish & \\<chips>\n");
  });

  test("refuses a part cut short or with tags that do not match", () => {
    const before = `<w:document ${W}><w:body><w:p><w:r><w:t>Before</w:t></w:r></w:p>`;
    for (const xml of [`${before}<!-- never closed`, `${before}</w:body>`, `${before}</w:r></w:body></w:document>`]) {
      expect(() => docxMarkdown(rawZip([{ name: "word/document.xml", content: xml }]))).toThrow("its XML is damaged");
    }
  });

  test("refuses a part that is not valid UTF-8", () => {
    const xml = Buffer.concat([Buffer.from(`<w:document ${W}><w:body><w:p><w:r><w:t>caf`), Buffer.from([0xe9]), Buffer.from("</w:t></w:r></w:p></w:body></w:document>")]);
    expect(() => docxMarkdown(rawZip([{ name: "word/document.xml", content: xml }]))).toThrow("word/document.xml is not valid UTF-8 text");
  });

  test("notes a deleted paragraph mark as a tracked change", () => {
    const zip = rawZip([document(paragraph(run("Text."), '<w:rPr><w:del w:id="1"/></w:rPr>'))]);
    expect(docxMarkdown(zip).notes.map((note) => note.code)).toEqual(["tracked-changes"]);
  });

  test("refuses damaged XML", () => {
    expect(() => docxMarkdown(rawZip([{ name: "word/document.xml", content: "<w:document><w:body>< broken</w:body></w:document>" }]))).toThrow("its XML is damaged");
  });

  test("refuses each kind of damaged zip", () => {
    const good = document(paragraph(run("Text.")));
    const cases = [
      [rawZip([good], { count: 0xffff }), "ZIP64"],
      [rawZip([good], { count: 10001 }), "entry limit"],
      [rawZip([good], { directorySize: 1000 }), "zip directory is damaged"],
      [rawZip([good], { centralSignature: 0x01020304 }), "zip directory is damaged"],
      [rawZip([{ ...good, size: 0xffffffff }]), "ZIP64"],
      [rawZip([{ ...good, localSignature: 0x01020304 }]), "is damaged"],
      [rawZip([{ ...good, compressedSize: 100000 }]), "cut short"],
      [rawZip([{ ...good, method: 8, data: Buffer.from([0xff, 0xff, 0xff, 0xff]) }]), "cannot be inflated"]
    ];
    for (const [zip, message] of cases) {
      expect(() => docxMarkdown(zip)).toThrow(message);
    }
  });
});

describe("story import of a .docx", () => {
  test("a built DOCX imports back to the same chapter prose", () => {
    for (const example of ["the-left-luggage-office", "the-gull-rock-light"]) {
      const dir = makeTempDir();
      const docx = path.join(dir, "book.docx");
      expect(runCli(["build", path.join(repoRoot, "examples", example), "--format", "docx", "--out", docx], memoryIo(dir))).toBe(0);
      expect(importCli(dir, "book.docx", "--title", "Round Trip", "--dir", "book").code).toBe(0);
      const chapters = fs.readdirSync(path.join(repoRoot, "examples", example, "chapters")).filter((name) => /^chapter-\d+\.md$/.test(name)).sort();
      expect(fs.readdirSync(path.join(dir, "book", "chapters")).filter((name) => /^chapter-\d+\.md$/.test(name)).sort()).toEqual(chapters);
      for (const name of chapters) {
        const original = scanComments(chapterText(path.join(repoRoot, "examples", example, "chapters", name))).text.replace(/\s+/g, " ").trim();
        expect({ example, name, text: chapterText(path.join(dir, "book", "chapters", name)).replace(/\s+/g, " ") }).toEqual({ example, name, text: original });
      }
    }
  });

  test("warns about what a document left out, naming the manuscript", () => {
    const dir = makeTempDir();
    docxFile(path.join(dir, "draft.docx"), paragraph(run("Chapter 1"), '<w:pStyle w:val="berschrift1"/>') + paragraph(`${run("Text")}<w:r><w:footnoteReference w:id="1"/></w:r>`));
    const text = importCli(dir, "draft.docx", "--title", "Notes", "--dir", "notes");
    expect(text.code).toBe(0);
    expect(text.err).toContain("warning: draft.docx: it has footnotes or endnotes, which the import leaves out [docx-content-left-out]");
    const json = importCli(dir, "draft.docx", "--title", "Notes", "--dir", "notes-json", "--json");
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out).diagnostics).toEqual([expect.objectContaining({ code: "docx-content-left-out", severity: "warning", file: null, source: path.join(dir, "draft.docx") })]);
  });

  test("a folder imports its Word documents with its markdown, skipping Word lock files", () => {
    const dir = makeTempDir();
    const source = path.join(dir, "drafts");
    fs.mkdirSync(source);
    docxFile(path.join(source, "01-arrival.docx"), paragraph(run("Chapter 1: Arrival"), '<w:pStyle w:val="berschrift1"/>') + paragraph(run("She came by the night train.")));
    fs.writeFileSync(path.join(source, "02-departure.md"), "# Chapter 2: Departure\n\nShe left by the morning one.\n");
    fs.writeFileSync(path.join(source, "~$01-arrival.docx"), "lock");
    expect(importCli(dir, "drafts", "--title", "Trains", "--dir", "trains").code).toBe(0);
    expect(chapterText(path.join(dir, "trains", "chapters", "chapter-01.md"))).toBe("She came by the night train.");
    expect(chapterText(path.join(dir, "trains", "chapters", "chapter-02.md"))).toBe("She left by the morning one.");
  });

  test("a .docx that is not a Word document is a usage error that names the file", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "draft.docx"), "plain text saved with the wrong extension");
    const result = importCli(dir, "draft.docx", "--title", "Wrong", "--dir", "wrong");
    expect(result.code).toBe(2);
    expect(result.err).toContain(`Cannot import ${path.join(dir, "draft.docx")}: it is not a readable zip file`);
    expect(fs.existsSync(path.join(dir, "wrong"))).toBe(false);
  });

  test("a zip under another extension is still refused as text", () => {
    const dir = makeTempDir();
    docxFile(path.join(dir, "draft.txt"), paragraph(run("Text.")));
    const result = importCli(dir, "draft.txt", "--title", "Zip", "--dir", "zip");
    expect(result.code).toBe(2);
    expect(result.err).toContain("story import reads a Word document only from a file whose name ends in .docx");
  });
});

describe("docxMarkdown after review", () => {
  const chapterLine = (text) => (/^Chapter \d+$/.test(text) ? { bare: true } : /^Chapter \d+: /.test(text) ? { bare: false } : null);
  const markdown = (body, options) => docxMarkdown(docxBytes(body, options), { chapterLine });

  test("turns a chapter line in a plain paragraph, bold or not, into a heading", () => {
    const body = paragraph(run("Chapter 1: Ticket", "<w:b/>"), '<w:jc w:val="center"/>')
      + paragraph(run("Chapter 2"))
      + paragraph(`<w:r><w:t>Chapter 3</w:t><w:br/><w:t>The Arrival</w:t></w:r>`)
      + paragraph(`<w:r><w:t>Chapter 4: Late</w:t><w:br/><w:t>Too late</w:t></w:r>`)
      + paragraph(run("Chapter 5 was the worst.", "<w:b/>"));
    expect(markdown(body).text).toBe(["# Chapter 1: Ticket", "# Chapter 2", "# Chapter 3: The Arrival", "Chapter 4: Late\\\nToo late", "**Chapter 5 was the worst.**"].join("\n\n") + "\n");
  });

  test("leaves out a table of contents, a placeholder, hidden text, and ruby readings", () => {
    const tocStyles = STYLES.replace("</w:styles>", '<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="berschrift1"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style></w:styles>');
    const body = [
      `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr><w:sdtContent>${paragraph(run("Contents"), '<w:pStyle w:val="TOCHeading"/>')}${paragraph(run("Chapter 1: Arrival 1"))}</w:sdtContent></w:sdt>`,
      paragraph(run("Contents"), '<w:pStyle w:val="TOCHeading"/>'),
      paragraph(`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \o "1-3" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("Chapter 1: Arrival")}<w:r><w:tab/></w:r>${run("1")}`),
      paragraph(`${run("Chapter 2: Departure")}<w:r><w:tab/></w:r>${run("9")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`),
      paragraph(`<w:fldSimple w:instr=" INDEX "><w:r><w:t>Index entry</w:t></w:r></w:fldSimple>${run("Kept")}`),
      paragraph(`<w:sdt><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent>${run("Click here to enter text.")}</w:sdtContent></w:sdt>${run("Visible")}${run(" secret", "<w:vanish/>")}`),
      paragraph(`<w:r><w:ruby><w:rubyPr/><w:rt><w:r><w:t>かんじ</w:t></w:r></w:rt><w:rubyBase><w:r><w:t>漢字</w:t></w:r></w:rubyBase></w:ruby></w:r>${run("を読む")}`),
      paragraph(run("Body text"), '<w:pStyle w:val="berschrift1"/><w:outlineLvl w:val="9"/>')
    ].join("");
    const { text, notes } = markdown(body, { styles: tocStyles });
    // The TOC Heading and the demoted paragraph keep their style's bold and
    // italic, as body text in that style would.
    expect(text).toBe(["***Contents***", "Kept", "Visible", "漢字を読む", "***Body text***"].join("\n\n") + "\n");
    expect(notes.map((note) => note.code)).toEqual(["ruby"]);
  });

  test("notes list numbering, and insert-only and moved tracked changes", () => {
    const body = paragraph(run("First item"), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')
      + paragraph(`<w:ins w:id="1"><w:r><w:t>Inserted</w:t></w:r></w:ins>`)
      + paragraph(`<w:moveFrom w:id="2"><w:r><w:t>Moved away</w:t></w:r></w:moveFrom>`)
      + paragraph(`<w:moveTo w:id="3"><w:r><w:t>Moved here</w:t></w:r></w:moveTo>`);
    const { text, notes } = markdown(body);
    expect(text).toBe(["First item", "Inserted", "Moved here"].join("\n\n") + "\n");
    expect(notes.map((note) => note.code).sort()).toEqual(["numbering", "tracked-changes"]);
  });

  test("keeps only the chosen copy of alternate content", () => {
    const body = paragraph(`<mc:AlternateContent><mc:Choice Requires="w14">${run("Chosen")}</mc:Choice><mc:Fallback>${run("Fallback")}</mc:Fallback></mc:AlternateContent>`);
    expect(markdown(body).text).toBe("Chosen\n");
  });

  test("cleans the document's text so it cannot add markdown lines", () => {
    const body = paragraph(run("First.&#13;# Chapter 2&#10;---&#0;end\u0007"))
      + paragraph(run("A &constructor; &toString; B"))
      + paragraph(run("She wrote &lt;!-- not a comment --&gt; and `code`."));
    expect(markdown(body).text).toBe(["First. # Chapter 2 ---end", "A &constructor; &toString; B", "She wrote \\<\\!-- not a comment --> and \\`code\\`."].join("\n\n") + "\n");
  });

  test("keeps a no-break space at the edge of an emphasised run outside its markers", () => {
    const body = paragraph(`${run("Quoi")}${run(" ?", "")}${run("Oui ", "<w:i/>")}${run("»")}`);
    expect(markdown(body).text).toBe("Quoi ?*Oui* »\n");
  });

  test("refuses two zip entries with one name", () => {
    const zip = rawZip([{ name: "word/document.xml", content: documentXml(paragraph(run("One"))) }, { name: "word/document.xml", content: documentXml(paragraph(run("Two"))) }]);
    expect(() => docxMarkdown(zip)).toThrow("two zip entries named word/document.xml");
  });

  test("stops a part that inflates past the part limit", () => {
    const content = Buffer.alloc(MAX_DOCX_PART_BYTES + 1024);
    const zip = rawZip([{ name: "word/document.xml", content: Buffer.alloc(0), method: 8, data: zlib.deflateRawSync(content), size: 10 }]);
    expect(() => docxMarkdown(zip)).toThrow("inflates past");
  });

  test("resolves a long chain of styles in linear time", () => {
    const make = (size) => {
      const chain = Array.from({ length: size }, (_, index) => `<w:style w:type="paragraph" w:styleId="s${index}"><w:name w:val="Style ${index}"/>${index + 1 < size ? `<w:basedOn w:val="s${index + 1}"/>` : ""}</w:style>`).join("");
      const body = Array.from({ length: size }, () => paragraph(run("Text"), '<w:pStyle w:val="s0"/>')).join("");
      return docxBytes(body, { styles: `<w:styles ${W}>${chain}</w:styles>` });
    };
    expectLinearGrowth((bytes) => docxMarkdown(bytes).text.length, make, 4000);
  });
});

describe("story import of a .docx after review", () => {
  test("splits the CLI's own Shunn DOCX back into its chapters", () => {
    const dir = makeTempDir();
    const example = path.join(repoRoot, "examples", "the-left-luggage-office");
    expect(runCli(["build", example, "--format", "docx", "--shunn", "--out", path.join(dir, "shunn.docx")], memoryIo(dir))).toBe(0);
    expect(importCli(dir, "shunn.docx", "--title", "Shunn", "--dir", "book").code).toBe(0);
    const titles = fs.readdirSync(path.join(dir, "book", "chapters")).filter((name) => /^chapter-\d+\.md$/.test(name)).sort()
      .map((name) => fs.readFileSync(path.join(dir, "book", "chapters", name), "utf8").match(/^title: (.*)$/m)[1]);
    expect(titles).toEqual(["Opening", "Ticket 4471", "The Other Half", "Closing Time"].map((title, index) => (index === 0 ? title : expect.any(String))));
    expect(titles.length).toBe(4);
  });

  test("refuses a .docx over the file limit, and imports a large one with images", () => {
    const dir = makeTempDir();
    const big = path.join(dir, "big.docx");
    fs.writeFileSync(big, "");
    fs.truncateSync(big, 64 * 1024 * 1024 + 1);
    const refused = importCli(dir, "big.docx", "--title", "Big", "--dir", "big");
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("exceeds the 67108864 byte limit");
    docxFile(path.join(dir, "pictures.docx"), paragraph(run("Chapter 1")) + paragraph(run("A picture follows.")), { entries: [{ name: "word/media/image1.png", content: Buffer.alloc(6 * 1024 * 1024, 7), stored: true }] });
    expect(fs.statSync(path.join(dir, "pictures.docx")).size).toBeGreaterThan(5 * 1024 * 1024);
    expect(importCli(dir, "pictures.docx", "--title", "Pictures", "--dir", "pictures").code).toBe(0);
  });

  test("refuses a document whose text is over the text file limit as markdown", () => {
    const dir = makeTempDir();
    const words = "word ".repeat(1200000);
    docxFile(path.join(dir, "long.docx"), paragraph(run(words)));
    const result = importCli(dir, "long.docx", "--title", "Long", "--dir", "long");
    expect(result.code).toBe(2);
    expect(result.err).toContain("over the 5242880 byte limit; split it into several documents");
  });

  test("splits on a Prologue paragraph and on a bare chapter line with its title on the next line", () => {
    const dir = makeTempDir();
    docxFile(path.join(dir, "draft.docx"), paragraph(run("Prologue", "<w:b/>")) + paragraph(run("Before it all.")) + paragraph(`<w:r><w:t>Chapter 1</w:t><w:br/><w:t>The Arrival</w:t></w:r>`) + paragraph(run("She came by train.")) + paragraph(run("Epilogue: After")) + paragraph(run("Later.")));
    expect(importCli(dir, "draft.docx", "--title", "Split", "--dir", "split").code).toBe(0);
    const chapters = fs.readdirSync(path.join(dir, "split", "chapters")).filter((name) => /^chapter-\d+\.md$/.test(name)).sort();
    const titles = chapters.map((name) => fs.readFileSync(path.join(dir, "split", "chapters", name), "utf8").match(/^title: (.*)$/m)[1]);
    // A section heading keeps its whole text as its title, as in any manuscript.
    expect(titles).toEqual(["Prologue", "The Arrival", '"Epilogue: After"']);
    expect(chapterText(path.join(dir, "split", "chapters", chapters[1]))).toBe("She came by train.");
  });

  test.skipIf(!NODE_ON_PATH)("the Node fallback imports a .docx as Bun does", () => {
    const dir = makeTempDir();
    docxFile(path.join(dir, "draft.docx"), paragraph(run("Chapter 1: Arrival", "<w:b/>")) + paragraph(`${run("She came by the ")}${run("night", "<w:i/>")}${run(" train.")}`));
    const fallback = path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js");
    const result = spawnSync("node", [fallback, "import", "draft.docx", "--title", "Trains", "--dir", "node"], { cwd: dir, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(importCli(dir, "draft.docx", "--title", "Trains", "--dir", "bun").code).toBe(0);
    const chapter = (folder) => fs.readFileSync(path.join(dir, folder, "chapters", "chapter-01.md"), "utf8");
    expect(chapter("node")).toBe(chapter("bun"));
    expect(chapterText(path.join(dir, "node", "chapters", "chapter-01.md"))).toBe("She came by the *night* train.");
  });
});

describe("docxMarkdown after the bot review", () => {
  test("reads a paragraph with no style in the default paragraph style", () => {
    const styles = `<w:styles ${W}><w:style w:type="character" w:default="1" w:styleId="Char"><w:name w:val="Default Paragraph Font"/></w:style><w:style w:type="paragraph" w:default="1" w:styleId="Verse"><w:name w:val="Normal"/><w:rPr><w:i/></w:rPr></w:style></w:styles>`;
    expect(docxMarkdown(docxBytes(paragraph(run("Sung")) + paragraph(run("Said", '<w:i w:val="0"/>')), { styles })).text).toBe("*Sung*\n\nSaid\n");
  });

  test("joins a paragraph whose mark is a tracked deletion to the next", () => {
    const body = paragraph(run("The first half"), '<w:rPr><w:del w:id="1" w:author="Ed"/></w:rPr>') + paragraph(run(" and the second.")) + paragraph(run("Last, joined to nothing"), '<w:rPr><w:del w:id="2" w:author="Ed"/></w:rPr>');
    const { text, notes } = docxMarkdown(docxBytes(body));
    expect(text).toBe("The first half and the second.\n\nLast, joined to nothing\n");
    expect(notes.map((note) => note.code)).toEqual(["tracked-changes"]);
  });

  test("keeps backslashed markers as prose, not a scene break", () => {
    expect(docxMarkdown(docxBytes(paragraph(run("\\* \\* \\*")))).text).toBe("\\\\\\* \\\\\\* \\\\\\*\n");
  });
});

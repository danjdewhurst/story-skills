import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { runCli } from "../src/cli.js";
import { docxMarkdown, MAX_DOCX_PART_BYTES } from "../src/docx.js";
import { crc32, writeZip } from "../src/packaging.js";
import { makeTempDir, memoryIo } from "./helpers.js";

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

  test("ends quietly at an unclosed comment", () => {
    const xml = `<w:document ${W}><w:body><w:p><w:r><w:t>Before</w:t></w:r></w:p><!-- never closed`;
    expect(docxMarkdown(rawZip([{ name: "word/document.xml", content: xml }])).text).toBe("Before\n");
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
        const original = chapterText(path.join(repoRoot, "examples", example, "chapters", name)).replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();
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
    expect(result.err).toContain("story import reads a Word document saved as a .docx file");
  });
});

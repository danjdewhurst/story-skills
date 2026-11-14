import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runCli } from "../src/cli.js";
import { MAX_ODT_TEXT_BYTES, odtMarkdown } from "../src/odt.js";
import { writeZip } from "../src/packaging.js";
import { declaredZip, makeTempDir, memoryIo, NODE_ON_PATH } from "./helpers.js";

const repoRoot = path.join(import.meta.dir, "..");
const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"'
].join(" ");

// Named styles as LibreOffice writes them: a space in a name is _20_, and
// the display name is what marks a heading or a quote.
const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS}><office:styles>
<style:style style:name="Standard" style:family="paragraph"/>
<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard"/>
<style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Heading"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Heading"/>
<style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard"/>
<style:style style:name="Verse" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="Emphasis" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="Strong_20_Emphasis" style:display-name="Strong Emphasis" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Loop" style:family="paragraph" style:parent-style-name="Loop"/>
<style:style style:name="Plain_20_Bold" style:family="paragraph" style:parent-style-name="Heading_20_2" style:default-outline-level=""/>
</office:styles></office:document-styles>`;

const AUTOMATIC = `<office:automatic-styles>
<style:style style:name="T1" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="T2" style:family="text"><style:text-properties fo:font-weight="700"/></style:style>
<style:style style:name="T3" style:family="text"><style:text-properties fo:font-style="normal"/></style:style>
<style:style style:name="T4" style:family="text"><style:text-properties text:display="none"/></style:style>
<style:style style:name="P1" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="P2" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties text:display="none"/></style:style>
<style:style style:name="P3" style:family="paragraph" style:parent-style-name="Standard" style:default-outline-level="2"/>
</office:automatic-styles>`;

function contentXml(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${NS} office:version="1.3">${AUTOMATIC}<office:body><office:text><text:sequence-decls><text:sequence-decl text:display-outline-level="0" text:name="Figure"/></text:sequence-decls>${body}</office:text></office:body></office:document-content>`;
}

function p(text, style = "Standard") {
  return `<text:p text:style-name="${style}">${text}</text:p>`;
}

function odtEntries(body, { styles = STYLES, mimetype = "application/vnd.oasis.opendocument.text", manifest = null, entries = [] } = {}) {
  return [
    ...(mimetype === null ? [] : [{ name: "mimetype", content: mimetype, stored: true }]),
    { name: "content.xml", content: contentXml(body) },
    ...(styles === null ? [] : [{ name: "styles.xml", content: styles }]),
    ...(manifest === null ? [] : [{ name: "META-INF/manifest.xml", content: manifest }]),
    ...entries
  ];
}

function odtFile(file, body, options) {
  writeZip(file, odtEntries(body, options));
  return file;
}

function odtBytes(body, options) {
  return fs.readFileSync(odtFile(path.join(makeTempDir(), "draft.odt"), body, options));
}

function markdown(body, options) {
  return odtMarkdown(odtBytes(body, options), { chapterLine: (text) => (/^chapter \d+$/i.test(text) ? { bare: true } : /^chapter \d+:/i.test(text) ? { bare: false } : null) });
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

describe("odtMarkdown", () => {
  test("writes headings, emphasis, quotes, breaks, and scene breaks as markdown", () => {
    const body = [
      p("The Salt Road", "Title"),
      '<text:h text:style-name="Heading_20_2" text:outline-level="1">Chapter 1: Low <text:span text:style-name="T1">Tide</text:span></text:h>',
      p('She said <text:span text:style-name="T1">never</text:span><text:s/><text:span text:style-name="Emphasis">again</text:span>, and meant <text:span text:style-name="T2">it</text:span>.'),
      p('<text:span text:style-name="Strong_20_Emphasis">Bold <text:span text:style-name="T1">and both</text:span></text:span> then <text:span text:style-name="T1"><text:span text:style-name="T3">plain</text:span></text:span>.'),
      p("* * *"),
      p("Roses are red,<text:line-break/>salt is white."),
      p("An ember given is a fire kept.", "Quotations"),
      p("Sung", "Verse"),
      p('Said <text:span text:style-name="T3">plainly</text:span>', "Verse"),
      p("A bold paragraph.", "P1"),
      p("A part heading", "Heading_20_2"),
      "<text:h>Untitled level</text:h>",
      p("Fish &amp; chips — &lt;b&gt; *stars* and #tag"),
      p("#"),
      p("Chapter 2"),
      p("<text:tab/>Indented\twith a typed tab"),
      p("Looped style.", "Loop"),
      p("Not a heading.", "Plain_20_Bold"),
      '<text:p text:style-name="Standard"/>'
    ].join("\n");
    const { text, notes } = markdown(body);
    expect(text).toBe([
      "# The Salt Road",
      "# Chapter 1: Low Tide",
      "She said *never* *again*, and meant **it**.",
      "**Bold** ***and both*** then plain.",
      "* * *",
      "Roses are red,\\\nsalt is white.",
      "> An ember given is a fire kept.",
      "*Sung*",
      "*Said* plainly",
      "**A bold paragraph.**",
      "## A part heading",
      "# Untitled level",
      "Fish & chips — \\<b> \\*stars\\* and #tag",
      "***",
      "# Chapter 2",
      "Indented with a typed tab",
      "Looped style.",
      "**Not a heading.**"
    ].join("\n\n") + "\n");
    expect(notes).toEqual([]);
  });

  test("reads tracked changes as accepted and names what it leaves out", () => {
    const body = [
      '<text:tracked-changes><text:changed-region text:id="c1"><text:deletion><office:change-info/><text:p>Deleted words.</text:p></text:deletion></text:changed-region></text:tracked-changes>',
      p('Kept<text:change text:change-id="c1"/> and <text:change-start text:change-id="c2"/>inserted<text:change-end text:change-id="c2"/>.'),
      p('Text<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>The note.</text:p></text:note-body></text:note>.'),
      p('Before<office:annotation><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Ed</dc:creator><text:p>A comment.</text:p></office:annotation> after.'),
      p('<draw:frame draw:name="Box"><draw:text-box><text:p>Boxed text.</text:p></draw:text-box></draw:frame>After the box.'),
      p('<draw:frame draw:name="Picture"><draw:image/></draw:frame>After the picture.'),
      "<table:table><table:table-row><table:table-cell><text:p>Cell one</text:p></table:table-cell><table:table-cell><text:p>Cell two</text:p></table:table-cell></table:table-row></table:table>",
      '<text:list><text:list-item><text:p>Listed</text:p></text:list-item></text:list>',
      '<text:h text:outline-level="1"><text:number>1.</text:number>Numbered</text:h>',
      p("<text:ruby><text:ruby-base>漢</text:ruby-base><text:ruby-text>かん</text:ruby-text></text:ruby>字"),
      '<text:table-of-content><text:index-body><text:p>Contents line</text:p></text:index-body></text:table-of-content>',
      p('Shown <text:span text:style-name="T4">hidden</text:span>words.'),
      '<text:section text:name="S" text:display="none"><text:p>Hidden section.</text:p></text:section>',
      '<text:section text:name="V"><text:p>Visible section.</text:p></text:section>'
    ].join("");
    const { text, notes } = markdown(body);
    expect(text).toBe([
      "Kept and inserted.",
      "Text.",
      "Before after.",
      "After the box.",
      "After the picture.",
      "Cell one",
      "Cell two",
      "Listed",
      "# Numbered",
      "漢字",
      "Shown words.",
      "Visible section."
    ].join("\n\n") + "\n");
    expect(notes.map((note) => note.code).sort()).toEqual(["comments", "footnotes", "images", "numbering", "ruby", "tables", "text-boxes", "tracked-changes"]);
  });

  test("reads hidden paragraphs and sections, outline levels, and a paragraph inside a paragraph", () => {
    const body = [
      p("Hidden by its style.", "P2"),
      p("A level 2 heading by its style's outline level.", "P3"),
      p('Hidden by its condition.<text:hidden-paragraph text:condition="ooow:1" text:is-hidden="true"/>'),
      p('Shown, its condition false.<text:hidden-paragraph text:condition="ooow:0" text:is-hidden="false"/>'),
      '<text:section text:name="C" text:display="condition" text:condition="ooow:1" text:is-hidden="true"><text:p>Hidden section.</text:p></text:section>',
      '<text:section text:name="D" text:display="condition" text:condition="ooow:0" text:is-hidden="false"><text:p>Shown section.</text:p></text:section>',
      '<text:p>Outer <text:p>inner <text:p/>text</text:p> end.</text:p>'
    ].join("");
    expect(markdown(body).text).toBe(["## A level 2 heading by its style's outline level.", "Shown, its condition false.", "Shown section.", "Outer inner text end."].join("\n\n") + "\n");
  });

  test("notes headings that chapter numbering numbers", () => {
    const outline = (format) => STYLES.replace("</office:styles>", `</office:styles><office:automatic-styles/><text:outline-style style:name="Outline"><text:outline-level-style text:level="1" style:num-format="${format}" style:num-prefix="Chapter "><style:list-level-properties/></text:outline-level-style><text:outline-level-style text:level="2" style:num-format=""/></text:outline-style>`);
    const body = '<text:h text:outline-level="1">The Arrival</text:h>' + p("Text.");
    expect(markdown(body, { styles: outline("1") }).notes.map((note) => note.code)).toEqual(["numbering"]);
    expect(markdown(body, { styles: outline("") }).notes).toEqual([]);
    expect(markdown('<text:h text:outline-level="2">Unnumbered</text:h>', { styles: outline("1") }).notes).toEqual([]);
    expect(markdown('<text:h text:outline-level="1" text:is-list-header="true">A list header</text:h><text:h>Level 1 by default</text:h>', { styles: outline("1") }).notes.map((note) => note.code)).toEqual(["numbering"]);
    expect(markdown('<text:h text:outline-level="1" text:is-list-header="true">A list header</text:h>', { styles: outline("1") }).notes).toEqual([]);
    // The note follows the outline level itself, not the markdown heading
    // level it is capped to.
    const deep = STYLES.replace("</office:styles>", '</office:styles><text:outline-style style:name="Outline"><text:outline-level-style text:level="8" style:num-format="1"/></text:outline-style>');
    expect(markdown('<text:h text:outline-level="6">Six</text:h>', { styles: deep }).notes).toEqual([]);
    expect(markdown('<text:h text:outline-level="8">Eight</text:h>', { styles: deep }).notes.map((note) => note.code)).toEqual(["numbering"]);
  });

  test("stops once the markdown passes its limit, and once its parts pass theirs", () => {
    const body = p("First paragraph.") + p("Second.");
    // The whole text is 26 bytes.
    expect(odtMarkdown(odtBytes(body), { maxTextBytes: 26 }).text).toBe("First paragraph.\n\nSecond.\n");
    expect(() => odtMarkdown(odtBytes(body), { maxTextBytes: 25 })).toThrow("its text comes to more than the 25 byte limit as markdown");
    // Each part says it is 32 MB unpacked, at the part limit, but with the
    // mimetype they come to more than the limit for the whole file, so
    // neither is inflated.
    const declared = 32 * 1024 * 1024;
    const zip = declaredZip([{ name: "mimetype", content: Buffer.from("application/vnd.oasis.opendocument.text") }, { name: "content.xml", content: Buffer.from(contentXml(body)), size: declared }, { name: "styles.xml", content: Buffer.from(STYLES), size: declared }]);
    expect(declared * 2).toBe(MAX_ODT_TEXT_BYTES);
    expect(() => odtMarkdown(zip)).toThrow(`its parts come to more than the ${MAX_ODT_TEXT_BYTES} byte limit unpacked`);
  });

  test("reads a document with no styles part and no mimetype", () => {
    expect(markdown(p("Only text."), { styles: null, mimetype: null }).text).toBe("Only text.\n");
  });

  test("refuses a file that is not a readable OpenDocument text", () => {
    expect(() => odtMarkdown(Buffer.from("not a zip at all"))).toThrow("it is not a readable zip file, so it is not a .odt; save it again from your word processor");
    expect(() => markdown(p("Text."), { mimetype: "application/vnd.oasis.opendocument.spreadsheet" })).toThrow("its media type is application/vnd.oasis.opendocument.spreadsheet, so it is not an OpenDocument text");
    expect(() => markdown(p("Text."), { mimetype: "x".repeat(300) })).toThrow("its media type is 300 bytes long, so it is not an OpenDocument text");
    // An entry whose size is the ZIP64 mark is refused as ZIP64, not by a size limit.
    expect(() => odtMarkdown(declaredZip([{ name: "mimetype", content: Buffer.from("application/vnd.oasis.opendocument.text"), size: 0xffffffff }]))).toThrow("it is a ZIP64 archive, which story does not read; save it again from your word processor");
    const noContent = path.join(makeTempDir(), "draft.odt");
    writeZip(noContent, [{ name: "mimetype", content: "application/vnd.oasis.opendocument.text" }]);
    expect(() => odtMarkdown(fs.readFileSync(noContent))).toThrow("it has no content.xml, so it is not an OpenDocument text");
    const doctype = path.join(makeTempDir(), "draft.odt");
    writeZip(doctype, [{ name: "content.xml", content: `<!DOCTYPE x [<!ENTITY a "aaaa">]><office:document-content ${NS}/>` }]);
    expect(() => odtMarkdown(fs.readFileSync(doctype))).toThrow("content.xml has a document type declaration, which an OpenDocument text never has");
  });

  test("refuses a password-protected document", () => {
    const manifest = `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"><manifest:encryption-data manifest:checksum-type="SHA1/1K"><manifest:algorithm manifest:algorithm-name="Blowfish CFB"/></manifest:encryption-data></manifest:file-entry></manifest:manifest>`;
    expect(() => markdown(p("Text."), { manifest })).toThrow("it is password-protected; remove the password in your word processor and save it again");
    // OpenOffice.org named the manifest's DTD, which declares nothing.
    const plain = manifest.replace(/<manifest:encryption-data[^]*<\/manifest:encryption-data>/, "");
    const doctype = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE manifest:manifest PUBLIC "-//OpenOffice.org//DTD Manifest 1.0//EN" "Manifest.dtd">\n';
    expect(markdown(p("Text."), { manifest: doctype + plain }).text).toBe("Text.\n");
    // A whole encrypted package has no content.xml beside it.
    const wholePackage = `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="encrypted-package" manifest:media-type=""><manifest:encryption-data/></manifest:file-entry></manifest:manifest>`;
    const file = path.join(makeTempDir(), "locked.odt");
    writeZip(file, [{ name: "mimetype", content: "application/vnd.oasis.opendocument.text", stored: true }, { name: "META-INF/manifest.xml", content: wholePackage }, { name: "encrypted-package", content: Buffer.alloc(64, 1) }]);
    expect(() => odtMarkdown(fs.readFileSync(file))).toThrow("it is password-protected");
  });
});

describe("story import of an .odt", () => {
  test("splits on chapter headings and warns about what it left out", () => {
    const dir = makeTempDir();
    odtFile(path.join(dir, "draft.odt"), [
      '<text:h text:outline-level="1">Chapter 1: Arrival</text:h>',
      p('She came by the <text:span text:style-name="T1">night</text:span> train.'),
      p("Chapter 2"),
      p('She left.<text:note text:note-class="footnote"><text:note-body><text:p>Note.</text:p></text:note-body></text:note>')
    ].join(""));
    const text = importCli(dir, "draft.odt", "--title", "Trains", "--dir", "trains");
    expect(text.code).toBe(0);
    expect(chapterText(path.join(dir, "trains", "chapters", "chapter-01.md"))).toBe("She came by the *night* train.");
    expect(chapterText(path.join(dir, "trains", "chapters", "chapter-02.md"))).toBe("She left.");
    expect(text.err).toContain("warning: draft.odt: it has footnotes or endnotes, which the import leaves out [import-content-left-out]");
  });

  test("a folder imports its OpenDocument files with its markdown", () => {
    const dir = makeTempDir();
    const source = path.join(dir, "drafts");
    fs.mkdirSync(source);
    odtFile(path.join(source, "01-arrival.odt"), '<text:h text:outline-level="1">Chapter 1: Arrival</text:h>' + p("She came by the night train."));
    fs.writeFileSync(path.join(source, "02-departure.md"), "# Chapter 2: Departure\n\nShe left by the morning one.\n");
    expect(importCli(dir, "drafts", "--title", "Trains", "--dir", "trains").code).toBe(0);
    expect(chapterText(path.join(dir, "trains", "chapters", "chapter-01.md"))).toBe("She came by the night train.");
    expect(chapterText(path.join(dir, "trains", "chapters", "chapter-02.md"))).toBe("She left by the morning one.");
  });

  test("an .odt that is not an OpenDocument text is a usage error, and an .odt under another extension is refused as text", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "draft.odt"), "plain text saved with the wrong extension");
    const wrong = importCli(dir, "draft.odt", "--title", "Wrong", "--dir", "wrong");
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain(`Cannot import ${path.join(dir, "draft.odt")}: it is not a readable zip file, so it is not a .odt`);
    odtFile(path.join(dir, "draft.txt"), p("Text."));
    const zip = importCli(dir, "draft.txt", "--title", "Zip", "--dir", "zip");
    expect(zip.code).toBe(2);
    expect(zip.err).toContain("story import reads a Word document, an OpenDocument text, or an EPUB only from a file whose name ends in .docx, .odt, or .epub");
  });

  test.skipIf(!NODE_ON_PATH)("the Node fallback imports an .odt as Bun does", () => {
    const dir = makeTempDir();
    odtFile(path.join(dir, "draft.odt"), '<text:h text:outline-level="1">Chapter 1: Arrival</text:h>' + p('She came by the <text:span text:style-name="T1">night</text:span> train.'));
    const fallback = path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js");
    const result = spawnSync("node", [fallback, "import", "draft.odt", "--title", "Trains", "--dir", "node"], { cwd: dir, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(importCli(dir, "draft.odt", "--title", "Trains", "--dir", "bun").code).toBe(0);
    const chapter = (folder) => fs.readFileSync(path.join(dir, folder, "chapters", "chapter-01.md"), "utf8");
    expect(chapter("node")).toBe(chapter("bun"));
  });
});

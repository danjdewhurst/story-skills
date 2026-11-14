import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runCli } from "../src/cli.js";
import { archivePath, epubMarkdown, MAX_EPUB_TEXT_BYTES } from "../src/epub.js";
import { scanComments } from "../src/markdown.js";
import { writeZip } from "../src/packaging.js";
import { declaredZip, makeTempDir, memoryIo, NODE_ON_PATH } from "./helpers.js";

const repoRoot = path.join(import.meta.dir, "..");
const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

// An XHTML document as an EPUB 3 writes one; `doctype` replaces its
// document type declaration.
function xhtml(body, { doctype = "<!DOCTYPE html>", head = "<title>T</title>" } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${doctype}\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head>${head}</head><body>${body}</body></html>`;
}

// The package document for `documents`, each { id, href, mediaType,
// properties, linear }, in spine order unless `spine` gives the order.
function packageXml(documents, { spine = documents.map((document) => document.id), manifest = documents } = {}) {
  const items = manifest.map((document) => `<item id="${document.id}" href="${document.href}" media-type="${document.mediaType ?? "application/xhtml+xml"}"${document.properties ? ` properties="${document.properties}"` : ""}/>`).join("");
  const refs = spine.map((id) => {
    const document = documents.find((entry) => entry.id === id);
    return `<itemref idref="${id}"${document?.linear === false ? ' linear="no"' : ""}/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest>${items}</manifest><spine>${refs}</spine></package>`;
}

// An EPUB of `bodies`, one XHTML document each, in reading order.
function epubEntries(bodies, { container = CONTAINER, opf, entries = [] } = {}) {
  const documents = bodies.map((body, index) => ({ id: `d${index + 1}`, href: `text/d${index + 1}.xhtml`, body }));
  return [
    { name: "mimetype", content: "application/epub+zip", stored: true },
    { name: "META-INF/container.xml", content: container },
    { name: "OEBPS/content.opf", content: opf ?? packageXml(documents) },
    ...documents.map((document) => ({ name: `OEBPS/${document.href}`, content: typeof document.body === "string" && document.body.startsWith("<?xml") ? document.body : xhtml(document.body) })),
    ...entries
  ];
}

function epubFile(file, bodies, options) {
  writeZip(file, epubEntries(bodies, options));
  return file;
}

function epubBytes(bodies, options) {
  return fs.readFileSync(epubFile(path.join(makeTempDir(), "book.epub"), bodies, options));
}

function markdown(bodies, options) {
  return epubMarkdown(epubBytes(bodies, options), { chapterLine: (text) => (/^chapter \d+$/i.test(text) ? { bare: true } : /^chapter \d+:/i.test(text) ? { bare: false } : null) });
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

describe("epubMarkdown", () => {
  test("writes headings, emphasis, quotes, breaks, and scene breaks as markdown", () => {
    const body = [
      "<h1>Chapter 1: <em>Low</em> Tide</h1>",
      "<p>She said <em>never</em> <i>again</i>, and <strong>meant</strong> <b>it</b>.</p>",
      '<p><span style="font-style: italic">Styled</span> and <span style="font-weight:700">heavy</span>, <em style="font-style: normal">plain</em>.</p>',
      "<hr/>",
      '<p class="scene-break">⁂</p>',
      "<p>Roses are red,<br/>salt is white.</p>",
      "<blockquote><p>An ember given is a fire kept.</p></blockquote>",
      "<h2>A Section</h2>",
      "<p>Fish &amp; chips &mdash; &lt;b&gt; &ldquo;quoted&rdquo;&nbsp;now &#x2014; *stars* and _under_.</p>",
      "<div>Loose text in a div.<p>A paragraph inside it.</p>And after.</div>",
      "<p>Chapter 2</p>",
      "<pre>one\ntwo</pre>",
      "<pre>\nif (ready) {\n    go(\"now\",  later);\n\treturn;\n}  </pre>",
      "<pre>  <em>Lead</em> word<br/>  after</pre>"
    ].join("\n");
    const { text, notes } = markdown([body]);
    expect(text).toBe([
      "# Chapter 1: Low Tide",
      "She said *never* *again*, and **meant** **it**.",
      "*Styled* and **heavy**, plain.",
      "* * *",
      "* * *",
      "Roses are red,\\\nsalt is white.",
      "> An ember given is a fire kept.",
      "## A Section",
      "Fish & chips — \\<b> “quoted” now — \\*stars\\* and \\_under\\_.",
      "Loose text in a div.",
      "A paragraph inside it.",
      "And after.",
      "# Chapter 2",
      "one\\\ntwo",
      "if (ready) {\\\n\u00a0\u00a0\u00a0\u00a0go(\"now\", \u00a0later);\\\n\u00a0\u00a0\u00a0\u00a0return;\\\n}",
      "\u00a0\u00a0*Lead* word\\\n\u00a0\u00a0after"
    ].join("\n\n") + "\n");
    expect(notes).toEqual([]);
  });

  test("reads the spine in order, each document once, and leaves out the navigation document", () => {
    const documents = [
      { id: "nav", href: "nav.xhtml", properties: "nav" },
      { id: "one", href: "text/one.xhtml" },
      { id: "two", href: "text/two%20b.xhtml" },
      { id: "aside", href: "text/aside.xhtml", linear: false },
      { id: "plate", href: "images/plate.svg", mediaType: "image/svg+xml" }
    ];
    const opf = packageXml(documents, { spine: ["nav", "two", "one", "two", "aside", "plate"] });
    const bytes = fs.readFileSync((() => {
      const file = path.join(makeTempDir(), "book.epub");
      writeZip(file, [
        { name: "META-INF/container.xml", content: CONTAINER },
        { name: "OEBPS/content.opf", content: opf },
        { name: "OEBPS/nav.xhtml", content: xhtml('<nav epub:type="toc"><ol><li>Contents</li></ol></nav>') },
        { name: "OEBPS/text/one.xhtml", content: xhtml("<p>First in the manifest.</p>") },
        { name: "OEBPS/text/two b.xhtml", content: xhtml("<p>First in the spine.</p>") },
        { name: "OEBPS/text/aside.xhtml", content: xhtml("<p>Outside the reading order.</p>") },
        { name: "OEBPS/images/plate.svg", content: "<svg/>" }
      ]);
      return file;
    })());
    const { text, notes } = epubMarkdown(bytes);
    expect(text).toBe("First in the spine.\n\nFirst in the manifest.\n");
    expect(notes.map((note) => note.code)).toEqual(["non-linear", "images"]);
  });

  test("leaves out what is not prose, and names what it leaves out", () => {
    const body = [
      '<p>Text<a epub:type="noteref" href="#n1">1</a> and <a href="#x">a link</a>.</p>',
      '<aside epub:type="footnote" id="n1"><p>The note.</p></aside>',
      '<p><img src="a.png" alt="A picture"/>After the picture.</p>',
      "<svg><text>Drawn text</text></svg>",
      "<table><tr><td>Cell one</td><td>Cell two</td></tr></table>",
      "<p><ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>字</p>",
      '<p hidden="hidden">Hidden.</p><p style="display: none">Not shown.</p>',
      "<script>var x = 1;</script><style>p { color: red; }</style>",
      '<p>Kept <del>cut</del>words.<span epub:type="pagebreak" role="doc-pagebreak" title="12">12</span></p>'
    ].join("");
    const { text, notes } = markdown([body]);
    expect(text).toBe(["Text and a link.", "After the picture.", "Cell one", "Cell two", "漢字", "Kept words."].join("\n\n") + "\n");
    expect(notes.map((note) => note.code).sort()).toEqual(["footnotes", "images", "ruby", "tables"]);
  });

  test("ends a paragraph at a block it leaves out, and names an image inside one", () => {
    const body = [
      '<div>Before<p hidden="">Hidden</p>After</div>',
      '<div>Text<aside epub:type="footnote"><p>The note.<img src="n.png" alt=""/></p></aside>More</div>',
      '<p>a<span style="display:none !important">HIDDEN</span>b</p>',
      "<ol><li>First</li><li>Second</li></ol>"
    ].join("");
    const { text, notes } = markdown([body]);
    expect(text).toBe(["Before", "After", "Text", "More", "ab", "First", "Second"].join("\n\n") + "\n");
    expect(notes.map((note) => note.code).sort()).toEqual(["footnotes", "images", "lists"]);
  });

  test("leaves out a contents page, whether the guide names it or its paragraphs are all links", () => {
    const toc = '<h1>Contents</h1><ol><li><a href="d2.xhtml">Chapter 1</a></li><li><a href="d3.xhtml#top">Chapter 2</a></li></ol>';
    const chapters = ['<h1>Chapter 1</h1><p>First <a href="#n">prose</a>.</p>', "<h1>Chapter 2</h1><p>Second prose.</p>"];
    const expected = "# Chapter 1\n\nFirst prose.\n\n# Chapter 2\n\nSecond prose.\n";
    const found = markdown([toc, ...chapters]);
    expect(found).toEqual({ text: expected, notes: [{ code: "contents", message: "it has a table of contents in its reading order, which the import leaves out" }] });
    const documents = [1, 2, 3].map((index) => ({ id: `d${index}`, href: `text/d${index}.xhtml` }));
    const guide = packageXml(documents).replace("</package>", '<guide><reference type="toc" title="Contents" href="text/d1.xhtml"/><reference type="text" href="text/d2.xhtml"/><reference type="toc" href="../../outside.xhtml"/></guide></package>');
    expect(markdown(["<p>Not linked, but named by the guide.</p>", ...chapters], { opf: guide }).text).toBe(expected);
    // A guide reference to a place inside a document leaves the document in.
    const inside = packageXml(documents).replace("</package>", '<guide><reference type="toc" href="text/d1.xhtml#toc"/></guide></package>');
    expect(markdown(["<p>Front matter and contents.</p>", ...chapters], { opf: inside }).text).toBe(`Front matter and contents.\n\n${expected}`);
    // One paragraph of links is not a contents page, and links that lead
    // out of the book, or nowhere in it, are not contents entries.
    expect(markdown(['<p>See <a href="d2.xhtml">the next part</a>.</p><p><a href="d2.xhtml">Onward</a></p>', "<p>Next.</p>"]).text).toBe("See the next part.\n\nOnward\n\nNext.\n");
    expect(markdown(['<p><a href="https://example.com/news">Sign up</a></p><p><a href="mailto:me@example.com">Write</a></p><p><a href="gone.xhtml">Gone</a></p>']).text).toBe("Sign up\n\nWrite\n\nGone\n");
    // A part heading on a contents page stays, to open the chapter after it.
    const divider = epubBytes(['<h1>Part One</h1><p><a href="d2.xhtml">Chapter 1</a></p><p><a href="d3.xhtml">Chapter 2</a></p>', ...chapters]);
    expect(epubMarkdown(divider, { partHeading: (text) => /^part /i.test(text) }).text).toBe(`# Part One\n\n${expected}`);
  });

  test("reads an EPUB 2 document: an XHTML 1.1 doctype, HTML entities, and prefixed package elements", () => {
    const doctype = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';
    const opf = `<?xml version="1.0"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0"><opf:manifest><opf:item id="c" href="text/d1.xhtml" media-type="application/xhtml+xml"/></opf:manifest><opf:spine toc="ncx"><opf:itemref idref="c"/></opf:spine></opf:package>`;
    const { text } = markdown([xhtml("<p>It&rsquo;s caf&eacute; &hellip; &frac12; A&minus;B &rarr; &alpha;&Omega; &there4; &unknown;</p>", { doctype })], { opf });
    expect(text).toBe("It’s café … ½ A−B → αΩ ∴ &unknown;\n");
  });

  test("refuses a file that is not a readable EPUB", () => {
    expect(() => epubMarkdown(Buffer.from("not a zip at all"))).toThrow("it is not a readable zip file, so it is not a .epub; export it again from the program that made it");
    const cases = [
      [{ container: "<container><rootfiles/></container>" }, "names no package document"],
      [{ container: CONTAINER.replace("OEBPS/content.opf", "OEBPS/missing.opf") }, "names the package OEBPS/missing.opf, which is not in the file"],
      [{ container: CONTAINER.replace("OEBPS/content.opf", "../content.opf") }, "which is not a path inside the file"],
      [{ opf: packageXml([{ id: "d1", href: "text/d1.xhtml" }], { spine: ["d9"] }) }, "its spine names the item d9, which its manifest does not list"],
      [{ opf: packageXml([{ id: "d1", href: "text/d9.xhtml" }]) }, "its manifest lists OEBPS/text/d9.xhtml, which is not in the file"],
      [{ opf: packageXml([{ id: "d1", href: "text/d1.xhtml" }], { spine: [] }) }, "its package has no spine"]
    ];
    for (const [options, message] of cases) {
      expect(() => markdown(["<p>Text.</p>"], options)).toThrow(message);
    }
    const otherRoot = CONTAINER.replace("<rootfile ", '<rootfile full-path="other.pdf" media-type="application/pdf"/><rootfile ');
    expect(markdown(["<p>Text.</p>"], { container: otherRoot }).text).toBe("Text.\n");
    // A long value from the file is cut in the message, never inside a
    // surrogate pair.
    const long = (idref) => packageXml([{ id: "d1", href: "text/d1.xhtml" }], { spine: [idref] });
    expect(() => markdown(["<p>Text.</p>"], { opf: long(`${"a".repeat(199)}😀${"b".repeat(50)}`) })).toThrow(`its spine names the item ${"a".repeat(199)}…, which its manifest does not list`);
    expect(() => markdown(["<p>Text.</p>"], { opf: long("c".repeat(250)) })).toThrow(`its spine names the item ${"c".repeat(200)}…, which its manifest does not list`);
    const noContainer = path.join(makeTempDir(), "book.epub");
    writeZip(noContainer, [{ name: "mimetype", content: "application/epub+zip" }]);
    expect(() => epubMarkdown(fs.readFileSync(noContainer))).toThrow("it has no META-INF/container.xml, so it is not an EPUB");
  });

  test("never reads a path outside the archive or a URL", () => {
    for (const href of ["../../secret.xhtml", "/etc/passwd", "http://example.com/a.xhtml", "file:///etc/passwd", "text\\d1.xhtml", "%2E%2E/%2E%2E/x.xhtml", "../../100%.xhtml", "/100%.xhtml", "http://example.com/100%.xhtml"]) {
      const opf = packageXml([{ id: "d1", href }]);
      expect(() => markdown(["<p>Text.</p>"], { opf, entries: [{ name: "secret.xhtml", content: xhtml("<p>Secret.</p>") }] })).toThrow("which is not a path inside the file");
    }
    expect(archivePath("OEBPS/", "text/../text/./d1.xhtml#start")).toBe("OEBPS/text/d1.xhtml");
    expect(archivePath("OEBPS/", "../d1.xhtml")).toBe("d1.xhtml");
    expect(archivePath("", "../d1.xhtml")).toBe(null);
  });

  test("reads an href with a % that is not an escape as written", () => {
    expect(archivePath("OEBPS/", "text/100%.xhtml#top")).toBe("OEBPS/text/100%.xhtml");
    expect(archivePath("OEBPS/", "text/%E0%A4%A.xhtml")).toBe("OEBPS/text/%E0%A4%A.xhtml");
    const opf = packageXml([{ id: "d1", href: "text/100%.xhtml" }, { id: "d2", href: "text/half%20way.xhtml" }]);
    const book = markdown([], { opf, entries: [{ name: "OEBPS/text/100%.xhtml", content: xhtml('<p>All of it. <a href="half%20way.xhtml">On</a></p>') }, { name: "OEBPS/text/half way.xhtml", content: xhtml("<p>Half way.</p>") }] });
    expect(book.text).toBe("All of it. On\n\nHalf way.\n");
  });

  test("refuses a document locked with DRM, and reads one whose fonts alone are obfuscated", () => {
    const encryption = (uri) => `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`;
    expect(() => markdown(["<p>Text.</p>"], { entries: [{ name: "META-INF/encryption.xml", content: encryption("OEBPS/text/d1.xhtml") }] })).toThrow("it is locked with DRM (META-INF/encryption.xml encrypts OEBPS/text/d1.xhtml)");
    expect(markdown(["<p>Text.</p>"], { entries: [{ name: "META-INF/encryption.xml", content: encryption("OEBPS/fonts/a.otf") }] }).text).toBe("Text.\n");
    expect(() => markdown(["<p>Text.</p>"], { entries: [{ name: "META-INF/encryption.xml", content: encryption("OEBPS/content%2Eopf") }] })).toThrow("encrypts OEBPS/content.opf");
    expect(() => markdown(["<p>Text.</p>"], { entries: [{ name: "META-INF/encryption.xml", content: encryption("http://example.com/x") + encryption("OEBPS/text/d1.xhtml") }] })).toThrow("encrypts OEBPS/text/d1.xhtml");
  });

  test("refuses a document type declaration that declares entities, and damaged XHTML", () => {
    expect(() => markdown([xhtml("<p>&a;</p>", { doctype: '<!DOCTYPE html [<!ENTITY a "aaaa">]>' })])).toThrow("has a document type declaration with declarations of its own");
    expect(() => markdown([xhtml("<p>Open<br></p>")])).toThrow("its XML is damaged");
    expect(() => markdown([xhtml("<p>Text.</p>", { doctype: "<!DOCTYPE html>\n<!DOCTYPE html>" })])).toThrow("its XML is damaged in OEBPS/text/d1.xhtml");
    expect(() => markdown([xhtml("<p>Text.</p>", { doctype: '<!DOCTYPE x SYSTEM "a>b" [ <!-- c --> ]>' })])).toThrow("has a document type declaration with declarations of its own");
    expect(markdown([xhtml("<p>Text.</p>", { doctype: "<?pi x?><!-- <!DOCTYPE note [ -->\n<!DOCTYPE html SYSTEM 'about:legacy-compat'>" })]).text).toBe("Text.\n");
    // A prolog that never ends, or a declaration that never closes, is damage.
    for (const doctype of ["<!-- never closed", "<?pi never closed", "<!DOCTYPE html"]) {
      expect(() => markdown([`<?xml version="1.0"?>${doctype}`])).toThrow("its XML is damaged");
    }
    expect(markdown([xhtml("<p>Text.</p>", { doctype: "<!-- made by hand -->\n<!doctype html>" })]).text).toBe("Text.\n");
  });

  test("refuses a spine whose parts come to more than its limit before it inflates any", () => {
    // Each document says it is 30 MB unpacked, under the part limit, but
    // holds a few bytes: the limit is checked against the directory, so
    // none is ever inflated, or found to be damaged.
    const declared = 30 * 1024 * 1024;
    const parts = [1, 2, 3].map((index) => ({ name: `OEBPS/text/d${index}.xhtml`, content: Buffer.from(xhtml(`<p>Part ${index}.</p>`)), size: declared }));
    const opf = packageXml(parts.map((_, index) => ({ id: `d${index + 1}`, href: `text/d${index + 1}.xhtml` })));
    expect(declared * parts.length).toBeGreaterThan(MAX_EPUB_TEXT_BYTES);
    const zip = declaredZip([{ name: "META-INF/container.xml", content: Buffer.from(CONTAINER) }, { name: "OEBPS/content.opf", content: Buffer.from(opf) }, ...parts]);
    expect(() => epubMarkdown(zip)).toThrow(`its parts come to more than the ${MAX_EPUB_TEXT_BYTES} byte limit unpacked`);
    // The same file with honest sizes reads.
    const honest = declaredZip([{ name: "META-INF/container.xml", content: Buffer.from(CONTAINER) }, { name: "OEBPS/content.opf", content: Buffer.from(opf) }, ...parts.map(({ size, ...part }) => part)]);
    expect(epubMarkdown(honest).text).toBe("Part 1.\n\nPart 2.\n\nPart 3.\n");
  });

  test("counts the package and the container toward the limit too", () => {
    // The spine alone fits; with a 20 MB package it does not.
    const declared = 15 * 1024 * 1024;
    const parts = [1, 2, 3].map((index) => ({ name: `OEBPS/text/d${index}.xhtml`, content: Buffer.from(xhtml(`<p>Part ${index}.</p>`)), size: declared }));
    const opf = packageXml(parts.map((_, index) => ({ id: `d${index + 1}`, href: `text/d${index + 1}.xhtml` }))).replace("<metadata/>", `<metadata/><!--${"x".repeat(20 * 1024 * 1024)}-->`);
    expect(declared * parts.length).toBeLessThan(MAX_EPUB_TEXT_BYTES);
    const zip = declaredZip([{ name: "META-INF/container.xml", content: Buffer.from(CONTAINER) }, { name: "OEBPS/content.opf", content: Buffer.from(opf) }, ...parts]);
    expect(() => epubMarkdown(zip)).toThrow(`its parts come to more than the ${MAX_EPUB_TEXT_BYTES} byte limit unpacked`);
    // A part that says it is larger than the whole limit is refused before
    // it is inflated.
    const container = declaredZip([{ name: "META-INF/container.xml", content: Buffer.from(CONTAINER), size: MAX_EPUB_TEXT_BYTES + 1 }]);
    expect(() => epubMarkdown(container)).toThrow(`its parts come to more than the ${MAX_EPUB_TEXT_BYTES} byte limit unpacked`);
  });

  test("stops once the markdown passes its limit, and names a damaged document", () => {
    const bodies = ["<p>One short paragraph.</p>", "<p>Another.</p><hr/><p>And more.</p>"];
    expect(markdown(bodies).text).toBe("One short paragraph.\n\nAnother.\n\n* * *\n\nAnd more.\n");
    // The whole text is 49 bytes.
    expect(epubMarkdown(epubBytes(bodies), { maxTextBytes: 49 }).text).toBe("One short paragraph.\n\nAnother.\n\n* * *\n\nAnd more.\n");
    expect(() => epubMarkdown(epubBytes(bodies), { maxTextBytes: 48 })).toThrow("its text comes to more than the 48 byte limit as markdown");
    expect(() => markdown(["<p>Fine.</p>", "<p>Open<br></p>"])).toThrow("its XML is damaged in OEBPS/text/d2.xhtml");
  });
});

describe("story import of an .epub", () => {
  test("a built EPUB imports back to the same chapter prose", () => {
    for (const example of ["the-left-luggage-office", "the-gull-rock-light"]) {
      const dir = makeTempDir();
      const epub = path.join(dir, "book.epub");
      expect(runCli(["build", path.join(repoRoot, "examples", example), "--format", "epub", "--out", epub], memoryIo(dir))).toBe(0);
      expect(importCli(dir, "book.epub", "--title", "Round Trip", "--dir", "book").code).toBe(0);
      const chapters = fs.readdirSync(path.join(repoRoot, "examples", example, "chapters")).filter((name) => /^chapter-\d+\.md$/.test(name)).sort();
      expect(fs.readdirSync(path.join(dir, "book", "chapters")).filter((name) => /^chapter-\d+\.md$/.test(name)).sort()).toEqual(chapters);
      for (const name of chapters) {
        const original = scanComments(chapterText(path.join(repoRoot, "examples", example, "chapters", name))).text.replace(/\s+/g, " ").trim();
        expect({ example, name, text: chapterText(path.join(dir, "book", "chapters", name)).replace(/\s+/g, " ") }).toEqual({ example, name, text: original });
      }
    }
  });

  test("splits on chapter headings across documents and warns about what it left out", () => {
    const dir = makeTempDir();
    epubFile(path.join(dir, "book.epub"), ["<h1>Chapter 1: Arrival</h1><p>She came by the <em>night</em> train.</p>", '<h1>Chapter 2: Departure</h1><p>She left.<img src="x.png" alt=""/></p>']);
    const text = importCli(dir, "book.epub", "--title", "Trains", "--dir", "trains");
    expect(text.code).toBe(0);
    expect(chapterText(path.join(dir, "trains", "chapters", "chapter-01.md"))).toBe("She came by the *night* train.");
    expect(chapterText(path.join(dir, "trains", "chapters", "chapter-02.md"))).toBe("She left.");
    expect(text.err).toContain("warning: book.epub: it has images, which the import leaves out [import-content-left-out]");
    const json = importCli(dir, "book.epub", "--title", "Trains", "--dir", "trains-json", "--json");
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out).diagnostics).toEqual([expect.objectContaining({ code: "import-content-left-out", severity: "warning", file: null, source: path.join(dir, "book.epub") })]);
  });

  test("a folder imports its EPUB files with its markdown", () => {
    const dir = makeTempDir();
    const source = path.join(dir, "drafts");
    fs.mkdirSync(source);
    epubFile(path.join(source, "01-arrival.epub"), ["<h1>Chapter 1: Arrival</h1><p>She came by the night train.</p>"]);
    fs.writeFileSync(path.join(source, "02-departure.md"), "# Chapter 2: Departure\n\nShe left by the morning one.\n");
    expect(importCli(dir, "drafts", "--title", "Trains", "--dir", "trains").code).toBe(0);
    expect(chapterText(path.join(dir, "trains", "chapters", "chapter-01.md"))).toBe("She came by the night train.");
    expect(chapterText(path.join(dir, "trains", "chapters", "chapter-02.md"))).toBe("She left by the morning one.");
  });

  test("an .epub that is not an EPUB is a usage error that names the file", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "book.epub"), "plain text saved with the wrong extension");
    const result = importCli(dir, "book.epub", "--title", "Wrong", "--dir", "wrong");
    expect(result.code).toBe(2);
    expect(result.err).toContain(`Cannot import ${path.join(dir, "book.epub")}: it is not a readable zip file, so it is not a .epub`);
    expect(fs.existsSync(path.join(dir, "wrong"))).toBe(false);
  });

  test("refuses an .epub over the file limit", () => {
    const dir = makeTempDir();
    const big = path.join(dir, "big.EPUB");
    fs.writeFileSync(big, "");
    fs.truncateSync(big, 64 * 1024 * 1024 + 1);
    const refused = importCli(dir, "big.EPUB", "--title", "Big", "--dir", "big");
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("exceeds the 67108864 byte limit");
  });

  test.skipIf(!NODE_ON_PATH)("the Node fallback imports an .epub as Bun does", () => {
    const dir = makeTempDir();
    epubFile(path.join(dir, "book.epub"), ["<h1>Chapter 1: Arrival</h1><p>She came by the <em>night</em> train.</p>"]);
    const fallback = path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js");
    const result = spawnSync("node", [fallback, "import", "book.epub", "--title", "Trains", "--dir", "node"], { cwd: dir, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(importCli(dir, "book.epub", "--title", "Trains", "--dir", "bun").code).toBe(0);
    const chapter = (folder) => fs.readFileSync(path.join(dir, folder, "chapters", "chapter-01.md"), "utf8");
    expect(chapter("node")).toBe(chapter("bun"));
  });
});

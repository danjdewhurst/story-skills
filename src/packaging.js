// The book package writers: EPUB, DOCX (Word and Shunn manuscript), the HTML
// review and print parts, and the ZIP container they share. Everything here
// takes a manuscript built by story.js and knows nothing about scanning a
// project.
import { Buffer } from "node:buffer";
import fs from "node:fs";
import { writeFile } from "./files.js";
import { escapeHtml } from "./html.js";
import { chapterHeading, isSceneBreak, wordCount } from "./markdown.js";
import { publishingMeta } from "./publishing.js";

function epubModifiedTimestamp() {
  // Deterministic builds: identical sources must produce byte-identical
  // output. Honor SOURCE_DATE_EPOCH when set (seconds since epoch, per the
  // reproducible-builds spec); otherwise fall back to a stable default
  // instead of the current time so local builds are deterministic too.
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (raw !== undefined && raw !== "") {
    // Only whole seconds that give a four-digit year are used; anything else
    // (a fraction, 1e20) falls back to the default like a non-number does.
    const date = /^\d+$/.test(raw.trim()) ? new Date(Number(raw.trim()) * 1000) : null;
    if (date !== null && !Number.isNaN(date.getTime()) && date.getUTCFullYear() <= 9999) {
      return date.toISOString().replace(/\.\d{3}Z$/, "Z");
    }
  }
  return "2000-01-01T00:00:00Z";
}

export function writeEpub(outFile, storyId, manuscript, writeOptions = {}) {
  const meta = manuscript.meta ?? publishingMeta({});
  const lang = xmlEscape(meta.language);
  const documents = [];
  const pushMatter = (placement) => (entry) => documents.push({
    id: `${placement}-${entry.id}`,
    label: entry.title,
    content: matterXhtml(entry, placement, lang)
  });
  manuscript.front.forEach(pushMatter("front"));
  // Duplicate chapter numbers are refused up front in manuscriptParts, so ids
  // here are unique by construction. Matter ids carry a front- or back-
  // prefix, so they cannot collide with chapter-NN.
  for (const chapter of manuscript.chapters) {
    documents.push({
      id: `chapter-${String(chapter.number).padStart(2, "0")}`,
      label: chapterHeading(chapter.number, chapter.title),
      content: chapterXhtml(chapter, lang),
      bodymatter: true
    });
  }
  manuscript.back.forEach(pushMatter("back"));

  const coverEntries = [];
  const coverItems = [];
  const coverMeta = [];
  const coverSpine = [];
  if (manuscript.cover) {
    const href = `images/cover.${manuscript.cover.extension}`;
    const alt = meta.coverAlt === "" ? `Cover of ${manuscript.title}` : meta.coverAlt;
    coverEntries.push(
      { name: `OEBPS/${href}`, content: fs.readFileSync(manuscript.cover.filePath) },
      { name: "OEBPS/cover.xhtml", content: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><title>${xmlEscape(manuscript.title)}</title></head><body epub:type="cover"><img src="${href}" alt="${xmlEscape(alt)}"/></body></html>` }
    );
    coverItems.push(`<item id="cover-image" href="${href}" media-type="${manuscript.cover.mediaType}" properties="cover-image"/>`, `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    coverMeta.push(`<meta name="cover" content="cover-image"/>`);
    coverSpine.push(`<itemref idref="cover"/>`);
  }

  const creator = meta.authors.map((name) => `<dc:creator>${xmlEscape(name)}</dc:creator>`).join("");
  const identifier = meta.isbn === "" ? xmlEscape(storyId) : `urn:isbn:${meta.isbn}`;
  const optional = [
    meta.publisher === "" ? "" : `<dc:publisher>${xmlEscape(meta.publisher)}</dc:publisher>`,
    meta.publicationDate === "" ? "" : `<dc:date>${xmlEscape(meta.publicationDate)}</dc:date>`,
    meta.description === "" ? "" : `<dc:description>${xmlEscape(meta.description)}</dc:description>`,
    ...meta.subjects.map((subject) => `<dc:subject>${xmlEscape(subject)}</dc:subject>`),
    meta.copyright === "" ? "" : `<dc:rights>${xmlEscape(meta.copyright)}</dc:rights>`
  ].join("");
  const accessibility = epubAccessibilityMeta(Boolean(manuscript.cover));
  const items = documents.map((doc) => `<item id="${doc.id}" href="${doc.id}.xhtml" media-type="application/xhtml+xml"/>`);
  const spine = documents.map((doc) => `<itemref idref="${doc.id}"/>`);
  const modified = epubModifiedTimestamp();
  writeZip(outFile, [
    { name: "mimetype", content: "application/epub+zip" },
    { name: "META-INF/container.xml", content: `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: "OEBPS/content.opf", content: `<?xml version="1.0" encoding="UTF-8"?><package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${xmlEscape(manuscript.title)}</dc:title>${creator}<dc:language>${lang}</dc:language>${optional}<meta property="dcterms:modified">${modified}</meta>${accessibility}${coverMeta.join("")}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${coverItems.join("")}${items.join("")}</manifest><spine>${coverSpine.join("")}${spine.join("")}</spine></package>` },
    { name: "OEBPS/nav.xhtml", content: navXhtml(manuscript.title, documents, lang) },
    ...coverEntries,
    ...documents.map((doc) => ({ name: `OEBPS/${doc.id}.xhtml`, content: doc.content }))
  ], writeOptions);
}

function navXhtml(title, documents, lang = "en") {
  const links = documents.map((doc) => `<li><a href="${doc.id}.xhtml">${xmlEscape(doc.label)}</a></li>`);
  const start = documents.find((doc) => doc.bodymatter);
  // The nav document is not in the spine, so landmarks point only at spine
  // documents (EPUBCheck RSC-011); reading systems find the toc themselves.
  const landmarks = start ? `<nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="bodymatter" href="${start.id}.xhtml">Start of Content</a></li></ol></nav>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><title>${xmlEscape(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${links.join("")}</ol></nav>${landmarks}</body></html>`;
}

// EPUB Accessibility 1.1 discovery metadata for a text-only book with a
// table of contents and a single reading order.
function epubAccessibilityMeta(hasCover) {
  const features = ["tableOfContents", "readingOrder", "structuralNavigation", ...(hasCover ? ["alternativeText"] : [])];
  const summary = hasCover
    ? "Text book with a described cover image, a navigable table of contents, headings for each chapter, and a single logical reading order."
    : "Text-only book with a navigable table of contents, headings for each chapter, and a single logical reading order.";
  return [
    `<meta property="schema:accessMode">textual</meta>`,
    ...(hasCover ? [`<meta property="schema:accessMode">visual</meta>`] : []),
    `<meta property="schema:accessModeSufficient">textual</meta>`,
    ...features.map((feature) => `<meta property="schema:accessibilityFeature">${feature}</meta>`),
    `<meta property="schema:accessibilityHazard">none</meta>`,
    `<meta property="schema:accessibilitySummary">${summary}</meta>`
  ].join("");
}

function xhtmlParagraphs(body) {
  const paragraphs = [];
  for (const paragraph of markdownParagraphs(body)) {
    const runs = inlineRuns(paragraph).map((run) => runMarkup(run, xmlEscape));
    paragraphs.push(`<p>${runs.join("")}</p>`);
  }
  return paragraphs.join("");
}

function xhtmlDocument(title, lang, bodyType, content) {
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><title>${xmlEscape(title)}</title></head><body epub:type="${bodyType}">${content}</body></html>`;
}

function chapterXhtml(chapter, lang = "en") {
  return xhtmlDocument(chapter.title, lang, "bodymatter chapter", `<h1>${xmlEscape(chapterHeading(chapter.number, chapter.title))}</h1>${xhtmlParagraphs(chapter.body)}`);
}

function matterXhtml(entry, placement = "front", lang = "en") {
  const heading = entry.heading ? `<h1>${xmlEscape(entry.title)}</h1>` : "";
  const bodyType = entry.copyright ? `${placement}matter copyright-page` : `${placement}matter`;
  return xhtmlDocument(entry.title, lang, bodyType, `${heading}${xhtmlParagraphs(entry.body)}`);
}

// The manuscript as HTML parts for the review and print builds. Paragraph
// anchors are keyed by chapter number (ch03) or matter id (front-dedication),
// so they stay stable while other chapters change.
export function htmlBook(manuscript) {
  const paragraphs = (body) => markdownParagraphs(body).map((paragraph) => (paragraph === "* * *"
    ? null
    : inlineRuns(paragraph).map((run) => runMarkup(run, escapeHtml)).join("")));
  const matter = (placement) => (entry) => ({
    key: `${placement}-${entry.id}`,
    kind: entry.copyright ? `${placement} copyright-page` : placement,
    copyright: Boolean(entry.copyright),
    placement,
    title: entry.title,
    heading: entry.heading,
    paragraphs: paragraphs(entry.body)
  });
  const parts = [
    ...manuscript.front.map(matter("front")),
    ...manuscript.chapters.map((chapter) => ({
      key: `ch${String(chapter.number).padStart(2, "0")}`,
      kind: "chapter",
      placement: "body",
      title: chapterHeading(chapter.number, chapter.title),
      heading: true,
      paragraphs: paragraphs(chapter.body)
    })),
    ...manuscript.back.map(matter("back"))
  ];
  return {
    title: manuscript.title,
    authors: manuscript.meta.authors,
    language: manuscript.meta.language,
    words: manuscript.chapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0),
    parts
  };
}

export function writeDocx(outFile, manuscript, writeOptions = {}) {
  const bodyParts = [paragraphXml(manuscript.title, "Title")];
  const pushSection = (heading, body) => {
    if (heading !== null) {
      bodyParts.push(paragraphXml(heading, "Heading1"));
    }
    for (const paragraph of markdownParagraphs(body)) {
      bodyParts.push(paragraphXml(paragraph, "", inlineRuns(paragraph)));
    }
  };
  const pushMatter = (entry) => pushSection(entry.heading ? entry.title : null, entry.body);
  manuscript.front.forEach(pushMatter);
  for (const chapter of manuscript.chapters) {
    pushSection(chapterHeading(chapter.number, chapter.title), chapter.body);
  }
  manuscript.back.forEach(pushMatter);

  writeZip(outFile, docxPackageEntries(bodyParts.join("")), writeOptions);
}

function docxPackageEntries(body) {
  return [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/styles.xml", content: `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="480" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>` },
    { name: "word/document.xml", content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>` }
  ];
}

// Shunn manuscript format: Courier New 12pt, double spacing, page break
// before each chapter heading, and a title page with contact and word count.
const SHUNN_RUN_FONTS = `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/>`;
const SHUNN_PARAGRAPH_SPACING = `<w:spacing w:line="480" w:lineRule="auto"/>`;

function shunnRunXml(text, decoration) {
  return `<w:r><w:rPr>${SHUNN_RUN_FONTS}${decoration}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function shunnTextRunXml(run) {
  return shunnRunXml(run.text, `${run.strong ? "<w:b/>" : ""}${run.em ? "<w:i/>" : ""}`);
}

function shunnParagraphXml(runXml, centered) {
  const alignment = centered ? `<w:jc w:val="center"/>` : "";
  return `<w:p><w:pPr>${SHUNN_PARAGRAPH_SPACING}${alignment}</w:pPr>${runXml}</w:p>`;
}

function shunnChapterHeadingXml(text) {
  return `<w:p><w:pPr>${SHUNN_PARAGRAPH_SPACING}</w:pPr><w:r><w:br w:type="page"/></w:r>${shunnRunXml(text, "<w:b/>")}</w:p>`;
}

function shunnTitlePageXml(meta) {
  const lines = [
    shunnParagraphXml(shunnRunXml(meta.title, "<w:b/>"), true),
    shunnParagraphXml(shunnRunXml("by", ""), true)
  ];
  if (meta.author) {
    lines.push(shunnParagraphXml(shunnRunXml(meta.author, ""), true));
  }
  lines.push(shunnParagraphXml(shunnRunXml(`Approximately ${meta.words} words`, ""), true));
  for (const contactLine of meta.contact) {
    lines.push(shunnParagraphXml(shunnRunXml(String(contactLine), ""), true));
  }
  return lines;
}

export function writeShunnDocx(outFile, manuscript, meta, writeOptions = {}) {
  const paragraphs = [...shunnTitlePageXml(meta)];
  for (const chapter of manuscript.chapters) {
    paragraphs.push(shunnChapterHeadingXml(chapterHeading(chapter.number, chapter.title)));
    for (const paragraph of markdownParagraphs(chapter.body)) {
      paragraphs.push(shunnParagraphXml(inlineRuns(paragraph).map(shunnTextRunXml).join(""), false));
    }
  }

  writeZip(outFile, docxPackageEntries(paragraphs.join("")), writeOptions);
}

export function writeShunnMarkdown(outFile, manuscript, meta, writeOptions = {}) {
  const lines = [meta.title, "by"];
  if (meta.author) {
    lines.push(meta.author);
  }
  lines.push("", `Approximately ${meta.words} words`, "");
  for (const contactLine of meta.contact) {
    lines.push(String(contactLine));
  }
  for (const chapter of manuscript.chapters) {
    lines.push("\f", `# ${chapterHeading(chapter.number, chapter.title)}`, "");
    for (const paragraph of markdownParagraphs(chapter.body)) {
      lines.push(paragraph, "");
    }
  }

  writeFile(outFile, `${lines.join("\n").trimEnd()}\n`, writeOptions);
}

function paragraphXml(text, style = "", runs = [{ text }]) {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  const runXml = runs.map((run) => {
    const decoration = `${run.strong ? "<w:b/>" : ""}${run.em ? "<w:i/>" : ""}`;
    const runStyle = decoration === "" ? "" : `<w:rPr>${decoration}</w:rPr>`;
    return `<w:r>${runStyle}<w:t xml:space="preserve">${xmlEscape(run.text)}</w:t></w:r>`;
  });
  return `<w:p>${styleXml}${runXml.join("")}</w:p>`;
}

// Markdown emphasis: **bold** / __bold__, *italic* / _italic_, and both
// nested (***both***, *a **b** c*), following the CommonMark delimiter rules:
// a run opens when it is left-flanking and closes when right-flanking, an
// underscore inside a word is literal, and a backslash escapes punctuation.
// Returns runs of { text, strong, em }.
function inlineRuns(text) {
  const nodes = [];
  let buffer = "";
  const isSpace = (char) => char === undefined || /\s/u.test(char);
  const isPunct = (char) => char !== undefined && /[\p{P}\p{S}]/u.test(char);
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (char === "\\" && /[!-/:-@[-`{-~]/.test(text[index + 1] ?? "")) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }
    if (char !== "*" && char !== "_") {
      buffer += char;
      index += 1;
      continue;
    }
    let end = index;
    while (text[end] === char) {
      end += 1;
    }
    if (buffer !== "") {
      nodes.push({ text: buffer });
      buffer = "";
    }
    const before = text[index - 1];
    const after = text[end];
    const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
    const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
    nodes.push({
      delimiter: char,
      count: end - index,
      original: end - index,
      open: char === "*" ? left : left && (!right || isPunct(before)),
      close: char === "*" ? right : right && (!left || isPunct(after)),
      strong: 0,
      em: 0
    });
    index = end;
  }
  if (buffer !== "") {
    nodes.push({ text: buffer });
  }

  // The CommonMark delimiter stack: openers wait on `stack`; a closer pairs
  // with the nearest usable opener and drops every delimiter between them.
  // `bottom` remembers, per kind of closer, how far down a search already
  // failed, so unmatched delimiters are not rescanned. Emphasis depth is
  // recorded as +1/-1 marks and summed once, so each pair costs O(1).
  const stack = [];
  const bottom = new Map();
  const depth = { strong: new Array(nodes.length + 1).fill(0), em: new Array(nodes.length + 1).fill(0) };
  for (const [closeIndex, closer] of nodes.entries()) {
    if (!closer.delimiter) {
      continue;
    }
    const key = `${closer.delimiter}${closer.open ? 1 : 0}${closer.original % 3}`;
    while (closer.close && closer.count > 0) {
      const floor = bottom.get(key) ?? 0;
      let position = stack.length - 1;
      while (position >= floor && !canPairEmphasis(nodes[stack[position]], closer)) {
        position -= 1;
      }
      if (position < floor) {
        bottom.set(key, stack.length);
        break;
      }
      const openIndex = stack[position];
      const opener = nodes[openIndex];
      const used = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
      opener.count -= used;
      closer.count -= used;
      const marks = depth[used === 2 ? "strong" : "em"];
      marks[openIndex + 1] += 1;
      marks[closeIndex] -= 1;
      // Delimiters between the pair can no longer pair outward.
      stack.length = opener.count > 0 ? position + 1 : position;
      for (const [other, value] of bottom) {
        if (value > stack.length) {
          bottom.set(other, stack.length);
        }
      }
    }
    if (closer.open && closer.count > 0) {
      stack.push(closeIndex);
    }
  }
  let strongDepth = 0;
  let emDepth = 0;
  for (const [index, node] of nodes.entries()) {
    strongDepth += depth.strong[index];
    emDepth += depth.em[index];
    node.strong = strongDepth;
    node.em = emDepth;
  }

  const runs = [];
  for (const node of nodes) {
    const value = node.delimiter ? node.delimiter.repeat(node.count) : node.text;
    if (value === "") {
      continue;
    }
    const strong = (node.strong ?? 0) > 0;
    const em = (node.em ?? 0) > 0;
    const previous = runs[runs.length - 1];
    if (previous && previous.strong === strong && previous.em === em) {
      previous.text += value;
    } else {
      runs.push({ text: value, strong, em });
    }
  }
  return runs;
}

// Openers on the stack can open and have characters left, so only the
// delimiter and CommonMark's rule of three decide: in *foo**bar* the **
// cannot close the *.
function canPairEmphasis(opener, closer) {
  const both = opener.close || closer.open;
  const ruleOfThree = both && (opener.original + closer.original) % 3 === 0 && !(opener.original % 3 === 0 && closer.original % 3 === 0);
  return opener.delimiter === closer.delimiter && !ruleOfThree;
}

// HTML or XHTML markup for one run; `escape` is the matching text escaper.
function runMarkup(run, escape) {
  let markup = escape(run.text);
  if (run.em) {
    markup = `<em>${markup}</em>`;
  }
  if (run.strong) {
    markup = `<strong>${markup}</strong>`;
  }
  return markup;
}

// A thematic break: three or more of the same marker, optionally spaced.
function markdownParagraphs(markdown) {
  const paragraphs = [];
  // Normalize CRLF and treat whitespace-only lines as blank, matching
  // CommonMark paragraph breaks.
  for (const paragraph of markdown
    .replace(/\r\n?/g, "\n")
    // A backslash at a line end is a hard line break; the lines join.
    .replace(/\\\n/g, "\n")
    .replace(/^#+[ \t]+/gm, "")
    // Blockquote markers flatten like headings, so a quoted epigraph or
    // letter reads as text rather than a literal ">".
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .split(/\n[ \t]*\n\s*/)) {
    const trimmed = paragraph.replace(/\s+/g, " ").trim();
    if (trimmed) {
      paragraphs.push(isSceneBreak(trimmed) ? "* * *" : trimmed);
    }
  }
  return paragraphs;
}

// Every entry is stamped 1980-01-01 00:00, the earliest valid MS-DOS date
// (day and month are 1-based, so an all-zero field is invalid), which keeps
// builds byte-identical.
const ZIP_DOS_DATE = (0 << 9) | (1 << 5) | 1;

function writeZip(outFile, entries, writeOptions = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const crc = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(ZIP_DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(ZIP_DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + content.length;
  }

  let centralSize = 0;
  for (const part of centralParts) {
    centralSize += part.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  writeFile(outFile, Buffer.concat(localParts.concat(centralParts, end)), writeOptions);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = [];
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE.push(value >>> 0);
}

// XML 1.0 forbids most C0 control characters, U+FFFE, U+FFFF, and unpaired
// surrogates even when escaped, so they are dropped.
const XML_INVALID_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function xmlEscape(value) {
  return String(value)
    .replace(XML_INVALID_CHARACTERS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

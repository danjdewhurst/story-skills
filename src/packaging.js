// The book package writers: EPUB, DOCX (Word and Shunn manuscript), the HTML
// review and print parts, and the ZIP container they share. Everything here
// takes a manuscript built by story.js and knows nothing about scanning a
// project.
import { Buffer } from "node:buffer";
import fs from "node:fs";
import { deflateRawSync } from "node:zlib";
import { writeFile } from "./files.js";
import { escapeHtml, withBlockquotes } from "./html.js";
import { languagePack } from "./languages/index.js";
import { formatNumber } from "./languages/locale.js";
import { flattenHeadings, isSceneBreak, plainLinks, withoutFenceMarkers, wordCount } from "./markdown.js";
import { publishingMeta, textDirection } from "./publishing.js";

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
  // Reading systems do not infer direction from the language, so an RTL
  // book says so on every document root and in the spine.
  const rtl = textDirection(meta.language) === "rtl";
  const root = `xml:lang="${lang}" lang="${lang}"${rtl ? ` dir="rtl"` : ""}`;
  const documents = [];
  const pushMatter = (placement) => (entry) => documents.push({
    id: `${placement}-${entry.id}`,
    label: entry.title,
    content: matterXhtml(entry, placement, root)
  });
  manuscript.front.forEach(pushMatter("front"));
  // Duplicate chapter numbers are refused up front in manuscriptParts, so ids
  // here are unique by construction. Matter ids carry a front- or back-
  // prefix, so they cannot collide with chapter-NN.
  for (const chapter of manuscript.chapters) {
    documents.push({
      id: `chapter-${String(chapter.number).padStart(2, "0")}`,
      label: chapter.heading,
      content: chapterXhtml(chapter, root),
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
      { name: "OEBPS/cover.xhtml", content: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" ${root}><head><title>${xmlEscape(manuscript.title)}</title></head><body epub:type="cover"><img src="${href}" alt="${xmlEscape(alt)}"/></body></html>` }
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
    // OCF requires mimetype first and uncompressed so the media type sits at
    // a fixed offset in the archive.
    { name: "mimetype", content: "application/epub+zip", stored: true },
    { name: "META-INF/container.xml", content: `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: "OEBPS/content.opf", content: `<?xml version="1.0" encoding="UTF-8"?><package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${xmlEscape(manuscript.title)}</dc:title>${creator}<dc:language>${lang}</dc:language>${optional}<meta property="dcterms:modified">${modified}</meta>${accessibility}${coverMeta.join("")}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${coverItems.join("")}${items.join("")}</manifest><spine${rtl ? ` page-progression-direction="rtl"` : ""}>${coverSpine.join("")}${spine.join("")}</spine></package>` },
    { name: "OEBPS/nav.xhtml", content: navXhtml(manuscript.title, documents, root, meta.contentsLabel) },
    ...coverEntries,
    ...documents.map((doc) => ({ name: `OEBPS/${doc.id}.xhtml`, content: doc.content }))
  ], writeOptions);
}

// `root` is the html element's language (and direction) attributes.
function navXhtml(title, documents, root, contentsLabel = "Contents") {
  const links = documents.map((doc) => `<li><a href="${doc.id}.xhtml">${xmlEscape(doc.label)}</a></li>`);
  const start = documents.find((doc) => doc.bodymatter);
  // The nav document is not in the spine, so landmarks point only at spine
  // documents (EPUBCheck RSC-011); reading systems find the toc themselves.
  const landmarks = start ? `<nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="bodymatter" href="${start.id}.xhtml">Start of Content</a></li></ol></nav>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" ${root}><head><title>${xmlEscape(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>${xmlEscape(contentsLabel)}</h1><ol>${links.join("")}</ol></nav>${landmarks}</body></html>`;
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
  return withBlockquotes(markdownParagraphs(body).map((paragraph) => ({
    quote: Boolean(paragraph.quote),
    markup: paragraph.sceneBreak ? "<p>* * *</p>" : `<p>${inlineRuns(paragraph.text).map((run) => runMarkup(run, xmlEscape, "<br/>")).join("")}</p>`
  }))).join("");
}

function xhtmlDocument(title, root, bodyType, content) {
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" ${root}><head><title>${xmlEscape(title)}</title></head><body epub:type="${bodyType}">${content}</body></html>`;
}

function chapterXhtml(chapter, root) {
  const heading = chapter.heading;
  // XHTML needs a non-blank <title>; an untitled chapter uses its heading.
  const title = String(chapter.title ?? "").trim() || heading;
  return xhtmlDocument(title, root, "bodymatter chapter", `<h1>${xmlEscape(heading)}</h1>${xhtmlParagraphs(chapter.body)}`);
}

function matterXhtml(entry, placement, root) {
  const heading = entry.heading ? `<h1>${xmlEscape(entry.title)}</h1>` : "";
  const bodyType = entry.copyright ? `${placement}matter copyright-page` : `${placement}matter`;
  return xhtmlDocument(entry.title, root, bodyType, `${heading}${xhtmlParagraphs(entry.body)}`);
}

// The manuscript as HTML parts for the review and print builds. Paragraph
// anchors are keyed by the printed chapter number (ch03), an unnumbered
// chapter's title (prologue), or matter id (front-dedication), so they stay
// stable while other chapters change.
export function htmlBook(manuscript) {
  const paragraphs = (body) => markdownParagraphs(body).map((paragraph) => {
    if (paragraph.sceneBreak) {
      return null;
    }
    const runs = inlineRuns(paragraph.text);
    return {
      html: runs.map((run) => runMarkup(run, escapeHtml, "<br>")).join(""),
      // Plain text, one line, for matching labels and quoting in note links.
      text: runs.map((run) => run.text).join("").split(LINE_BREAK).join(" ").replace(/\s+/g, " ").trim(),
      quote: paragraph.quote
    };
  });
  const matter = (placement) => (entry) => ({
    key: `${placement}-${entry.id}`,
    kind: entry.copyright ? `${placement} copyright-page` : placement,
    copyright: Boolean(entry.copyright),
    placement,
    title: entry.title,
    heading: entry.heading,
    words: wordCount(entry.body),
    paragraphs: paragraphs(entry.body)
  });
  const parts = [
    ...manuscript.front.map(matter("front")),
    ...manuscript.chapters.map((chapter) => ({
      key: chapter.key,
      kind: "chapter",
      placement: "body",
      title: chapter.heading,
      heading: true,
      words: wordCount(chapter.body),
      paragraphs: paragraphs(chapter.body)
    })),
    ...manuscript.back.map(matter("back"))
  ];
  return {
    title: manuscript.title,
    authors: manuscript.meta.authors,
    language: manuscript.meta.language,
    contentsLabel: manuscript.meta.contentsLabel,
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
      bodyParts.push(paragraph.sceneBreak
        ? paragraphXml("* * *", "SceneBreak")
        : paragraphXml(paragraph.text, paragraph.quote ? "Quote" : "", inlineRuns(paragraph.text)));
    }
  };
  const pushMatter = (entry) => pushSection(entry.heading ? entry.title : null, entry.body);
  manuscript.front.forEach(pushMatter);
  for (const chapter of manuscript.chapters) {
    pushSection(chapter.heading, chapter.body);
  }
  manuscript.back.forEach(pushMatter);

  writeZip(outFile, docxPackageEntries(bodyParts.join("")), writeOptions);
}

function docxPackageEntries(body) {
  return [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/styles.xml", content: DOCX_STYLES },
    { name: "word/document.xml", content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>` }
  ];
}

// Body text is 12pt Times New Roman at 1.5 spacing with a half-inch
// first-line indent, so paragraph breaks show without blank lines; titles,
// headings, and scene breaks cancel the indent.
const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
  + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
  + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="720"/></w:pPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="480" w:after="240"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="120" w:after="120"/><w:ind w:left="720" w:right="720" w:firstLine="0"/></w:pPr></w:style>`
  + `<w:style w:type="paragraph" w:customStyle="1" w:styleId="SceneBreak"><w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr></w:style>`
  + `</w:styles>`;

// Shunn manuscript format: Courier New 12pt, double spacing, page break
// before each chapter heading, and a title page with contact and word count.
const SHUNN_RUN_FONTS = `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/>`;
const SHUNN_PARAGRAPH_SPACING = `<w:spacing w:line="480" w:lineRule="auto"/>`;

function shunnRunXml(text, decoration) {
  return `<w:r><w:rPr>${SHUNN_RUN_FONTS}${decoration}</w:rPr>${docxTextXml(text)}</w:r>`;
}

function shunnTextRunXml(run) {
  return shunnRunXml(run.text, `${run.strong ? "<w:b/>" : ""}${run.em ? "<w:i/>" : ""}`);
}

// Body paragraphs indent their first line half an inch; centred lines
// (title page, scene breaks) do not, and a quotation is indented as a block.
function shunnParagraphXml(runXml, centered, quote = false) {
  const layout = centered
    ? `<w:ind w:firstLine="0"/><w:jc w:val="center"/>`
    : quote ? `<w:ind w:left="720" w:right="720" w:firstLine="0"/>` : `<w:ind w:firstLine="720"/>`;
  return `<w:p><w:pPr>${SHUNN_PARAGRAPH_SPACING}${layout}</w:pPr>${runXml}</w:p>`;
}

function shunnChapterHeadingXml(text) {
  return `<w:p><w:pPr>${SHUNN_PARAGRAPH_SPACING}<w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:r><w:br w:type="page"/></w:r>${shunnRunXml(text, "<w:b/>")}</w:p>`;
}

// Shunn word counts are rounded: exact under 1,000 words, to the nearest
// 100 below novel length (40,000), and to the nearest 1,000 above it, and
// written as the story's language writes numbers (12.300 in German).
export function shunnWordCount(words, pack = languagePack()) {
  const step = words < 1000 ? 1 : words < 40000 ? 100 : 1000;
  const rounded = Math.round(words / step) * step;
  return formatNumber(rounded, pack);
}

function shunnTitlePageXml(meta) {
  const lines = [shunnParagraphXml(shunnRunXml(meta.title, "<w:b/>"), true)];
  // The byline is left out, "by" and all, when there is no author.
  if (meta.author) {
    lines.push(shunnParagraphXml(shunnRunXml("by", ""), true), shunnParagraphXml(shunnRunXml(meta.author, ""), true));
  }
  lines.push(shunnParagraphXml(shunnRunXml(`Approximately ${shunnWordCount(meta.words, meta.pack)} words`, ""), true));
  for (const contactLine of meta.contact) {
    lines.push(shunnParagraphXml(shunnRunXml(String(contactLine), ""), true));
  }
  return lines;
}

// A novel starts each chapter on a new page under its heading. A short story
// or flash piece (`meta.shortForm`) runs on from the title block with no
// headings or page breaks, its chapters joined as sections, and every
// section or scene break is a centred `#`, as Shunn's short-story format
// sets it.
export function writeShunnDocx(outFile, manuscript, meta, writeOptions = {}) {
  const paragraphs = [...shunnTitlePageXml(meta)];
  const sceneBreak = meta.shortForm ? "#" : "* * *";
  const hash = shunnParagraphXml(shunnRunXml("#", ""), true);
  if (meta.shortForm) {
    paragraphs.push(shunnParagraphXml("", true));
  }
  let sections = 0;
  for (const chapter of manuscript.chapters) {
    const body = markdownParagraphs(chapter.body);
    if (!meta.shortForm) {
      paragraphs.push(shunnChapterHeadingXml(chapter.heading));
    } else if (body.length === 0) {
      continue;
    } else if (sections++ > 0) {
      paragraphs.push(hash);
    }
    for (const paragraph of body) {
      paragraphs.push(paragraph.sceneBreak
        ? shunnParagraphXml(shunnRunXml(sceneBreak, ""), true)
        : shunnParagraphXml(inlineRuns(paragraph.text).map(shunnTextRunXml).join(""), false, paragraph.quote));
    }
  }

  writeZip(outFile, docxPackageEntries(paragraphs.join("")), writeOptions);
}

export function writeShunnMarkdown(outFile, manuscript, meta, writeOptions = {}) {
  const lines = [meta.title];
  if (meta.author) {
    lines.push("by", meta.author);
  }
  lines.push("", `Approximately ${shunnWordCount(meta.words, meta.pack)} words`, "");
  for (const contactLine of meta.contact) {
    lines.push(String(contactLine));
  }
  const sceneBreak = meta.shortForm ? "#" : "* * *";
  if (meta.shortForm) {
    lines.push("");
  }
  let sections = 0;
  for (const chapter of manuscript.chapters) {
    const body = markdownParagraphs(chapter.body);
    if (!meta.shortForm) {
      lines.push("\f", `# ${chapter.heading}`, "");
    } else if (body.length === 0) {
      continue;
    } else if (sections++ > 0) {
      lines.push("#", "");
    }
    for (const paragraph of body) {
      if (paragraph.sceneBreak) {
        lines.push(sceneBreak, "");
        continue;
      }
      // Hard breaks stay backslash breaks; a quote keeps its markers.
      const prefix = paragraph.quote ? "> " : "";
      lines.push(`${prefix}${paragraph.text.split(LINE_BREAK).join(`\\\n${prefix}`)}`, "");
    }
  }

  writeFile(outFile, `${lines.join("\n").trimEnd()}\n`, writeOptions);
}

// The text elements of a DOCX run, with a <w:br/> for each hard break.
function docxTextXml(text) {
  return String(text).split(LINE_BREAK).map((part) => `<w:t xml:space="preserve">${xmlEscape(part)}</w:t>`).join("<w:br/>");
}

function paragraphXml(text, style = "", runs = [{ text }]) {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  const runXml = runs.map((run) => {
    const decoration = `${run.strong ? "<w:b/>" : ""}${run.em ? "<w:i/>" : ""}`;
    const runStyle = decoration === "" ? "" : `<w:rPr>${decoration}</w:rPr>`;
    return `<w:r>${runStyle}${docxTextXml(run.text)}</w:r>`;
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
  const unclosedTicks = new Set();
  let buffer = "";
  const isSpace = (char) => char === undefined || char === LINE_BREAK || /\s/u.test(char);
  const isPunct = (char) => char !== undefined && /[\p{P}\p{S}]/u.test(char);
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (char === "\\" && /[!-/:-@[-`{-~]/.test(text[index + 1] ?? "")) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }
    if (char === "`") {
      // A code span is literal: no emphasis inside, and no backticks shown.
      let run = 0;
      while (text[index + run] === "`") {
        run += 1;
      }
      // A run length that found no closer once never finds one later.
      const end = unclosedTicks.has(run) ? -1 : codeSpanEnd(text, index, run);
      if (end === -1) {
        unclosedTicks.add(run);
        buffer += "`".repeat(run);
        index += run;
      } else {
        const code = text.slice(index + run, end - run);
        buffer += /^ .*[^ ].* $/.test(code) ? code.slice(1, -1) : code;
        index = end;
      }
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

// The end of the code span opened by the backtick run at `start`, closed
// by a run of the same length, or -1 when none closes it.
function codeSpanEnd(text, start, length) {
  let next = text.indexOf("`", start + length);
  while (next !== -1) {
    let end = next;
    while (text[end] === "`") {
      end += 1;
    }
    if (end - next === length) {
      return end;
    }
    next = text.indexOf("`", end);
  }
  return -1;
}

// Openers on the stack can open and have characters left, so only the
// delimiter and CommonMark's rule of three decide: in *foo**bar* the **
// cannot close the *.
function canPairEmphasis(opener, closer) {
  const both = opener.close || closer.open;
  const ruleOfThree = both && (opener.original + closer.original) % 3 === 0 && !(opener.original % 3 === 0 && closer.original % 3 === 0);
  return opener.delimiter === closer.delimiter && !ruleOfThree;
}

// HTML or XHTML markup for one run; `escape` is the matching text escaper
// and `lineBreak` the matching break element.
function runMarkup(run, escape, lineBreak) {
  let markup = escape(run.text).split(LINE_BREAK).join(lineBreak);
  if (run.em) {
    markup = `<em>${markup}</em>`;
  }
  if (run.strong) {
    markup = `<strong>${markup}</strong>`;
  }
  return markup;
}

// A hard line break inside a paragraph (a backslash or two spaces at a line
// end), carried through inlineRuns as one character and written as each
// format's break: <br> in HTML, <br/> in EPUB, <w:br/> in DOCX. Verse,
// lyrics, and letter sign-offs keep their lines.
const LINE_BREAK = "\uE001";

// The body as paragraphs: { sceneBreak: true } for a thematic break (three
// or more of the same marker, optionally spaced), otherwise { text, quote }
// where `text` is inline markdown on one line, with LINE_BREAK for each hard
// break, and `quote` marks a blockquote paragraph (an epigraph, a letter).
// Whitespace-only lines are blank, as in CommonMark. Fence lines go and the
// code stays; links print as their text and images are left out, as word
// counts treat them.
function markdownParagraphs(markdown) {
  const paragraphs = [];
  let lines = [];
  let quote = false;
  const flush = () => {
    if (lines.length === 0) {
      return;
    }
    const joined = lines.map((line, index) => {
      if (index === lines.length - 1) {
        return line;
      }
      if (/\\$/.test(line)) {
        return `${line.slice(0, -1)}${LINE_BREAK}`;
      }
      return / {2,}$/.test(line) ? `${line}${LINE_BREAK}` : `${line} `;
    }).join("");
    const text = joined
      .replace(/\s+/g, " ")
      .replace(new RegExp(` *${LINE_BREAK} *`, "g"), LINE_BREAK)
      .replace(new RegExp(`^${LINE_BREAK}+|${LINE_BREAK}+$`, "g"), "")
      .trim();
    // The last line is never blank (a blank line flushes), so text is never
    // empty here.
    lines = [];
    paragraphs.push(!text.includes(LINE_BREAK) && isSceneBreak(text) ? { sceneBreak: true } : { text, quote });
  };
  const source = flattenHeadings(plainLinks(withoutFenceMarkers(markdown.replace(/\r\n?/g, "\n"))));
  for (const rawLine of source.split("\n")) {
    // Blockquote markers (nested ones too) come off; the paragraph is
    // marked as quoted instead.
    const marker = /^(?:[ \t]*>[ \t]?)+/.exec(rawLine);
    const line = marker ? rawLine.slice(marker[0].length) : rawLine;
    if (line.trim() === "") {
      flush();
      continue;
    }
    // A quote interrupts a plain paragraph; an unmarked line after a quoted
    // one continues the quote, as CommonMark's lazy continuation does.
    if (lines.length > 0 && marker && !quote) {
      flush();
    }
    if (lines.length === 0) {
      quote = Boolean(marker);
    }
    lines.push(line);
  }
  flush();
  return paragraphs;
}

// Every entry is stamped 1980-01-01 00:00, the earliest valid MS-DOS date
// (day and month are 1-based, so an all-zero field is invalid), which keeps
// builds byte-identical.
const ZIP_DOS_DATE = (0 << 9) | (1 << 5) | 1;

// General-purpose bit 11 declares the entry name as UTF-8. Names are always
// written as UTF-8, and a clear bit 11 means IBM Code Page 437 (APPNOTE
// 4.4.4), so a strict reader would misdecode any non-ASCII name without it.
const ZIP_UTF8_NAME_FLAG = 0x0800;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;
// The level is pinned rather than left at zlib's default so the deflate
// stream, and therefore the whole archive, stays byte-identical between runs
// and Node versions.
const ZIP_DEFLATE_LEVEL = 9;

export function writeZip(outFile, entries, writeOptions = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const crc = crc32(content);
    // Entries marked stored must not be compressed (the EPUB mimetype).
    // Everything else deflates, except where deflating would not shrink it,
    // as with already-compressed cover images.
    const deflated = entry.stored ? null : deflateRawSync(content, { level: ZIP_DEFLATE_LEVEL });
    const compressed = deflated !== null && deflated.length < content.length;
    const body = compressed ? deflated : content;
    const method = compressed ? ZIP_DEFLATED : ZIP_STORED;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_NAME_FLAG, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(ZIP_DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(body.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, body);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_NAME_FLAG, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(ZIP_DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(body.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + body.length;
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

// Reads an EPUB as markdown for story import. The package's spine gives
// the reading order, and each XHTML document in it becomes markdown in
// turn: headings, italic and bold, block quotes, line breaks, and scene
// breaks. The import then splits the text into chapters as it splits a
// markdown file. Anything the import cannot carry over (images, footnotes,
// tables, ruby readings, documents outside the reading order) is named in a
// note, so the writer knows what to check.
//
// An EPUB is a zip of XML parts, read through archive.js under its size
// limits. Its contents are untrusted: every part the import reads counts
// toward one limit, each path the package names is resolved inside the
// archive (a path that climbs out of it, or a URL, is refused), and nothing
// outside the archive is ever read. A document locked with DRM is refused.
import { ArchiveError, HTML_ENTITIES, partReader, shown, xmlTokens, zipEntries } from "./archive.js";
import { LINE_BREAK, blockBytes, checkMarkdownSize, markdownBlocks, paragraphBlocks, proseText } from "./rich-text.js";

export const EPUB = Object.freeze({
  extension: ".epub",
  kind: "an EPUB",
  again: "export it again from the program that made it",
  unlock: "export a copy without a password from the program that made it"
});

const CONTAINER_PART = "META-INF/container.xml";
const ENCRYPTION_PART = "META-INF/encryption.xml";
const XHTML = "application/xhtml+xml";

// Every part one import reads, inflated, comes to no more than this: a
// novel's text is a few megabytes, and the limit bounds the work a file of
// many small parts can ask for.
export const MAX_EPUB_TEXT_BYTES = 64 * 1024 * 1024;

const NOTE_MESSAGES = {
  images: "it has images, which the import leaves out",
  footnotes: "it has footnotes or endnotes, which the import leaves out",
  tables: "it has tables, whose cells the import reads as plain paragraphs",
  ruby: "it has ruby (furigana) readings, which the import leaves out, keeping the base text",
  lists: "it has lists, whose bullets and numbers the import leaves out",
  contents: "it has a table of contents in its reading order, which the import leaves out",
  "non-linear": "it has documents outside its reading order (linear=\"no\"), which the import leaves out",
  "other-documents": "its reading order has documents that are not XHTML, which the import leaves out"
};

// Converts the bytes of an .epub to { text, notes }, as docxMarkdown does
// for a .docx. `maxTextBytes` stops the conversion once the markdown would
// be larger, and `partHeading` tells a part heading ("Part Two"), which a
// contents page keeps, from any other. Throws an ArchiveError when the file
// is not a readable EPUB.
export function epubMarkdown(bytes, { chapterLine = () => null, partHeading = () => false, maxTextBytes = Infinity } = {}) {
  const entries = zipEntries(bytes, EPUB);
  const parts = partReader(bytes, EPUB, MAX_EPUB_TEXT_BYTES);
  const read = (entry) => parts.read(entry, { doctype: true });

  const container = entries.get(CONTAINER_PART);
  if (container === undefined) {
    throw new ArchiveError(`it has no ${CONTAINER_PART}, so it is not an EPUB`);
  }
  const packagePath = rootfilePath(read(container));
  const packageEntry = entries.get(packagePath);
  if (packageEntry === undefined) {
    throw new ArchiveError(`its ${CONTAINER_PART} names the package ${shown(packagePath)}, which is not in the file`);
  }
  const encrypted = entries.has(ENCRYPTION_PART) ? encryptedPaths(read(entries.get(ENCRYPTION_PART))) : new Set();
  const refuseLocked = (part) => {
    if (encrypted.has(part)) {
      throw new ArchiveError(`it is locked with DRM (${ENCRYPTION_PART} encrypts ${shown(part)}), which story cannot read; import the manuscript the book was made from instead`);
    }
  };
  refuseLocked(packagePath);

  const notes = new Set();
  const spine = spineParts(read(packageEntry), packagePath, entries, notes);
  // The whole spine is measured before any of it is inflated, so a file
  // over the limit costs no more than its directory.
  parts.reserve(spine.map((part) => entries.get(part)));
  const blocks = markdownBlocks(maxTextBytes);
  const documents = new Set(spine);
  for (const part of spine) {
    refuseLocked(part);
    const xml = read(entries.get(part));
    // A link counts when it leads to another document of the spine.
    const folder = part.slice(0, part.lastIndexOf("/") + 1);
    const leadsToDocument = (href) => documents.has(archivePath(folder, href));
    // Each paragraph's blocks, and the notes, wait until the document is
    // known not to be a contents page; what waits is held to the limit too.
    const waiting = [];
    const own = new Set();
    let paragraphs = 0;
    let linked = 0;
    let keptBytes = 0;
    let linkedBytes = 0;
    try {
      xhtmlParagraphs(xml, own, leadsToDocument, (paragraph) => {
        // A paragraph that is all link text, such as a contents entry.
        const text = paragraph.runs.filter((run) => run.text.trim() !== "");
        const allLinks = text.length > 0 && text.every((run) => run.link);
        if (paragraph.level === 0 || allLinks) {
          paragraphs += 1;
          linked += allLinks ? 1 : 0;
        }
        const found = paragraphBlocks(paragraph.runs, paragraph.level, paragraph.quote, chapterLine, { preformatted: paragraph.runs.every((run) => run.pre) });
        const bytes = found.reduce((total, block) => total + blockBytes(block), 0);
        keptBytes += allLinks ? 0 : bytes;
        linkedBytes += allLinks ? bytes : 0;
        checkMarkdownSize(Math.max(blocks.size() + keptBytes, linkedBytes), maxTextBytes);
        const part = paragraph.level > 0 && partHeading(paragraph.runs.map((run) => run.text).join("").replace(/\s+/g, " ").trim());
        waiting.push({ found, part });
      });
    } catch (error) {
      if (error instanceof ArchiveError && error.message === "its XML is damaged") {
        throw new ArchiveError(`its XML is damaged in ${shown(part)}`);
      }
      throw error;
    }
    // A contents page that the package does not mark as one: a document
    // whose paragraphs are all links to other documents. Only a part
    // heading stays, since it opens the chapter after it.
    const contents = linked >= 2 && linked === paragraphs;
    for (const { found, part } of waiting) {
      if (!contents || part) {
        found.forEach((block) => blocks.push(block));
      }
    }
    for (const code of contents ? ["contents"] : own) {
      notes.add(code);
    }
  }
  return {
    text: blocks.text(),
    notes: [...notes].map((code) => ({ code, message: NOTE_MESSAGES[code] }))
  };
}

// An element's name without its namespace prefix: an EPUB 2 package may
// write `opf:item`.
function localName(name) {
  return name.slice(name.lastIndexOf(":") + 1);
}

// The package document's path, from the container's first rootfile.
function rootfilePath(xml) {
  for (const token of xmlTokens(xml, HTML_ENTITIES)) {
    if (token.type === "end" || token.type === "text" || localName(token.name) !== "rootfile") {
      continue;
    }
    const mediaType = token.attributes["media-type"];
    if (mediaType !== undefined && mediaType !== "application/oebps-package+xml") {
      continue;
    }
    const fullPath = token.attributes["full-path"] ?? "";
    const resolved = archivePath("", fullPath);
    if (resolved === null) {
      throw new ArchiveError(`its ${CONTAINER_PART} names the package ${shown(fullPath)}, which is not a path inside the file`);
    }
    return resolved;
  }
  throw new ArchiveError(`its ${CONTAINER_PART} names no package document, so it is not an EPUB`);
}

// A path the EPUB names, as the name of a zip entry, or null when it is not
// one inside the archive: a URL, an absolute path, a backslash, or `..`
// that climbs above the archive's root. `base` is the folder the path is
// relative to, ending in `/` (or "" for the root). A fragment or query is
// dropped, and percent escapes are decoded. An href with a `%` that is not
// an escape, such as `100%.xhtml`, as some ebook tools write one, is read
// as written, and goes through the same checks.
export function archivePath(base, href) {
  const bare = href.replace(/[?#][^]*$/, "");
  let decoded;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    decoded = bare;
  }
  if (decoded === "" || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith("/") || decoded.includes("\\")) {
    return null;
  }
  const parts = [];
  for (const segment of `${base}${decoded}`.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (parts.length === 0) {
        return null;
      }
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.length === 0 ? null : parts.join("/");
}

// The parts META-INF/encryption.xml says are encrypted. Its URIs are
// relative to the archive's root.
function encryptedPaths(xml) {
  const paths = new Set();
  for (const token of xmlTokens(xml, HTML_ENTITIES)) {
    if ((token.type === "start" || token.type === "empty") && localName(token.name) === "CipherReference") {
      const resolved = archivePath("", token.attributes.URI ?? "");
      if (resolved !== null) {
        paths.add(resolved);
      }
    }
  }
  return paths;
}

// The XHTML parts of the spine, in reading order, each once. The navigation
// document and the contents page the guide names are left out, and so is a
// document marked linear="no", which is outside the reading order; anything
// else that is not XHTML is left out with a note.
function spineParts(xml, packagePath, entries, notes) {
  const base = packagePath.includes("/") ? packagePath.slice(0, packagePath.lastIndexOf("/") + 1) : "";
  const items = new Map();
  const spine = [];
  // The contents page an EPUB 2 package's guide names.
  const contents = new Set();
  let section = null;
  for (const token of xmlTokens(xml, HTML_ENTITIES)) {
    if (token.type === "text") {
      continue;
    }
    const name = localName(token.name);
    if (name === "manifest" || name === "spine" || name === "guide") {
      section = token.type === "start" ? name : token.type === "end" ? null : section;
      continue;
    }
    if (token.type === "end") {
      continue;
    }
    const { attributes } = token;
    if (section === "manifest" && name === "item" && attributes.id !== undefined && !items.has(attributes.id)) {
      items.set(attributes.id, { href: attributes.href ?? "", mediaType: (attributes["media-type"] ?? "").trim().toLowerCase(), properties: (attributes.properties ?? "").split(/\s+/) });
    } else if (section === "spine" && name === "itemref") {
      spine.push({ idref: attributes.idref ?? "", linear: (attributes.linear ?? "yes").trim() !== "no" });
    } else if (section === "guide" && name === "reference" && (attributes.type ?? "").trim().toLowerCase() === "toc" && !(attributes.href ?? "").includes("#")) {
      // A reference to a place inside a document (#toc) may share that
      // document with chapters, so only a whole document is left out.
      const part = archivePath(base, attributes.href ?? "");
      if (part !== null) {
        contents.add(part);
      }
    }
  }
  if (spine.length === 0) {
    throw new ArchiveError("its package has no spine, so it has no reading order to import");
  }
  const parts = [];
  const seen = new Set();
  for (const { idref, linear } of spine) {
    const item = items.get(idref);
    if (item === undefined) {
      throw new ArchiveError(`its spine names the item ${shown(idref)}, which its manifest does not list`);
    }
    if (item.properties.includes("nav")) {
      continue;
    }
    if (!linear) {
      notes.add("non-linear");
      continue;
    }
    if (item.mediaType !== XHTML) {
      notes.add(item.mediaType.startsWith("image/") ? "images" : "other-documents");
      continue;
    }
    const part = archivePath(base, item.href);
    if (part === null) {
      throw new ArchiveError(`its manifest lists ${shown(item.href)}, which is not a path inside the file`);
    }
    if (!entries.has(part)) {
      throw new ArchiveError(`its manifest lists ${shown(part)}, which is not in the file`);
    }
    if (contents.has(part)) {
      notes.add("contents");
    } else if (!seen.has(part)) {
      seen.add(part);
      parts.push(part);
    }
  }
  return parts;
}

// Elements whose content is never prose: the head, scripts and styles,
// pictures and media, ruby readings, deleted text, and navigation (a table
// of contents or landmarks). The value is the note the import gives, or
// null.
const SKIPPED = new Map([
  ["head", null],
  ["script", null],
  ["style", null],
  ["template", null],
  ["noscript", null],
  ["nav", null],
  ["del", null],
  ["rp", null],
  ["rt", "ruby"],
  ["svg", "images"],
  ["object", "images"],
  ["iframe", "images"],
  ["video", "images"],
  ["audio", "images"],
  ["canvas", "images"],
  ["picture", "images"]
]);

// Elements that hold or start a paragraph of their own. Any other element
// is inline, so its text joins the paragraph around it.
const BLOCKS = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "center", "dd", "details", "div", "dl", "dt",
  "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "li", "main", "ol",
  "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul"
]);

const ITALIC = new Set(["em", "i", "cite", "dfn"]);
const BOLD = new Set(["strong", "b"]);
const NOTE_TYPES = /(?:^|\s)(?:doc-)?(?:footnotes?|endnotes?|rearnotes?)(?:\s|$)/;
const NOTE_REFERENCE = /(?:^|\s)(?:doc-)?noteref(?:\s|$)/;
const NAVIGATION_TYPES = /(?:^|\s)(?:doc-)?(?:toc|landmarks|page-list|pagebreak)(?:\s|$)/;

// The note an element's attributes call for when its content is not prose,
// or undefined when it is prose: a footnote or its marker, a navigation
// list, a print page number, or hidden text.
function skippedFor(name, attributes) {
  if (SKIPPED.has(name)) {
    return SKIPPED.get(name);
  }
  const types = `${attributes["epub:type"] ?? ""} ${attributes.role ?? ""}`;
  if (NOTE_TYPES.test(types) || (name === "a" && NOTE_REFERENCE.test(types))) {
    return "footnotes";
  }
  if (NAVIGATION_TYPES.test(types) || attributes.hidden !== undefined || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!\s*important\s*)?(?:;|$)/i.test(attributes.style ?? "")) {
    return null;
  }
  return undefined;
}

// An inline style's italic and bold: true, false, or null when it says
// nothing.
function styleEmphasis(style) {
  const fontStyle = /(?:^|;)\s*font-style\s*:\s*([a-z]+)/i.exec(style)?.[1].toLowerCase();
  const fontWeight = /(?:^|;)\s*font-weight\s*:\s*([a-z0-9]+)/i.exec(style)?.[1].toLowerCase();
  return {
    italic: fontStyle === undefined ? null : fontStyle === "italic" || fontStyle === "oblique",
    bold: fontWeight === undefined ? null : fontWeight === "bold" || fontWeight === "bolder" || (/^\d+$/.test(fontWeight) && Number(fontWeight) >= 600)
  };
}

// The spaces of preformatted text that the writer would otherwise
// collapse, as no-break spaces, which markdown and the builds keep: those
// that indent a line (when `text` starts one), and each after the first in
// a run. A tab is four spaces.
function preformattedSpaces(text, startsLine) {
  const spaced = text.replace(/\t/g, "    ");
  const indented = startsLine ? spaced.replace(/^ +/, (spaces) => "\u00a0".repeat(spaces.length)) : spaced;
  return indented.replace(/ {2,}/g, (spaces) => ` ${"\u00a0".repeat(spaces.length - 1)}`);
}

// Hands each paragraph of one XHTML document to `emit` as { runs, level,
// quote }, with runs of { text, italic, bold, link }, where link marks text
// inside a link whose href `leadsToDocument` accepts. Text is read only
// inside the body.
function xhtmlParagraphs(xml, notes, leadsToDocument, emit) {
  // One frame per open element: the italic, bold, heading level, quote,
  // and preformatting the element's text gets.
  const frames = [{ italic: false, bold: false, level: 0, quote: false, pre: false, body: false, link: false }];
  let paragraph = null;
  let skipping = 0;
  const flush = () => {
    if (paragraph !== null && paragraph.runs.some((run) => run.text.trim() !== "")) {
      emit(paragraph);
    }
    paragraph = null;
  };
  const add = (text) => {
    const frame = frames.at(-1);
    if (!frame.body) {
      return;
    }
    if (paragraph === null) {
      paragraph = { runs: [], level: frame.level, quote: frame.quote };
    }
    // A heading's own bold or italic is its style, not emphasis.
    paragraph.runs.push({ text, italic: frame.level === 0 && frame.italic, bold: frame.level === 0 && frame.bold, link: frame.link, pre: frame.pre });
  };

  for (const token of xmlTokens(xml, HTML_ENTITIES)) {
    if (skipping > 0) {
      if (token.type === "start") {
        skipping += 1;
      } else if (token.type === "end") {
        skipping -= 1;
      } else if (token.type === "empty" && (localName(token.name) === "img" || localName(token.name) === "image")) {
        notes.add("images");
      }
      continue;
    }
    if (token.type === "text") {
      const frame = frames.at(-1);
      // Preformatted text starts a line at the start of its paragraph or
      // after a line break, and after each line end of its own.
      const startsLine = paragraph === null || paragraph.runs.at(-1).text.endsWith(LINE_BREAK);
      add(frame.pre ? token.text.split(/\r\n?|\n/).map((line, index) => preformattedSpaces(proseText(line), index > 0 || startsLine)).join(LINE_BREAK) : proseText(token.text.replace(/\t/g, " ")));
      continue;
    }
    const name = localName(token.name).toLowerCase();
    if (token.type === "end") {
      if (BLOCKS.has(name)) {
        flush();
      }
      frames.pop();
      continue;
    }
    const { attributes } = token;
    const skipped = skippedFor(name, attributes);
    if (skipped !== undefined) {
      // A block left out still ends the paragraph before it.
      if (BLOCKS.has(name) || name === "nav") {
        flush();
      }
      if (skipped !== null) {
        notes.add(skipped);
      }
      if (token.type === "start") {
        skipping = 1;
      }
      continue;
    }
    if (name === "img" || name === "image") {
      notes.add("images");
    }
    if (name === "table") {
      notes.add("tables");
    }
    if (name === "ol" || name === "ul") {
      notes.add("lists");
    }
    if (BLOCKS.has(name) || name === "hr") {
      flush();
    }
    if (name === "br") {
      add(LINE_BREAK);
    }
    // A thematic break, or a paragraph a story build marks as a scene
    // break, is a scene break, whatever marker it shows.
    const sceneBreak = name === "hr" || (name === "p" && /(?:^|\s)scene-break(?:\s|$)/.test(attributes.class ?? ""));
    if (sceneBreak && frames.at(-1).body) {
      emit({ runs: [{ text: "* * *", italic: false, bold: false, link: false }], level: 0, quote: false });
    }
    if (token.type === "empty") {
      continue;
    }
    const parent = frames.at(-1);
    const emphasis = styleEmphasis(attributes.style ?? "");
    const heading = /^h([1-6])$/.exec(name);
    frames.push({
      italic: emphasis.italic ?? (ITALIC.has(name) || parent.italic),
      bold: emphasis.bold ?? (BOLD.has(name) || parent.bold),
      level: heading === null ? parent.level : Number(heading[1]),
      quote: parent.quote || name === "blockquote",
      pre: parent.pre || name === "pre",
      body: parent.body || name === "body",
      link: parent.link || (name === "a" && leadsToDocument(attributes.href ?? ""))
    });
    if (sceneBreak) {
      // The marker's own text is not prose.
      skipping = 1;
      frames.pop();
    }
  }
  flush();
}

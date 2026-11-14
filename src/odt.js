// Reads an OpenDocument text (.odt), as LibreOffice, OpenOffice, and
// Google Docs save one, as markdown for story import: paragraphs, headings
// from heading paragraphs or heading styles, italic and bold, block quotes,
// line breaks, and scene breaks, as docx.js reads a Word document. Anything
// the import cannot carry over (comments, footnotes, images, text boxes,
// tables, tracked changes, list numbering, ruby readings) is named in a
// note, so the writer knows what to check.
//
// An .odt is a zip of XML parts. Only content.xml, styles.xml, and the
// manifest that says whether the text is encrypted are read, each under a
// size limit, through archive.js, which refuses a document type
// declaration, so no entity is ever expanded.
import { ArchiveError, printable, xmlText, xmlTokens, zipEntries } from "./archive.js";
import { LINE_BREAK, paragraphBlocks, proseText } from "./rich-text.js";

export const ODT = Object.freeze({
  extension: ".odt",
  kind: "an OpenDocument text",
  again: "save it again from your word processor",
  unlock: "remove the password in your word processor and save it again"
});

const CONTENT_PART = "content.xml";
const STYLES_PART = "styles.xml";
const MANIFEST_PART = "META-INF/manifest.xml";
const MIMETYPE_PART = "mimetype";
const TEXT_MIMETYPE = /^application\/vnd\.oasis\.opendocument\.text(?:-template|-master)?$/;
// A style based on a style based on ... is followed this far.
const MAX_STYLE_DEPTH = 64;

const NOTE_MESSAGES = {
  "tracked-changes": "it has tracked changes; the import keeps the text as if every change were accepted",
  comments: "it has comments, which the import leaves out",
  footnotes: "it has footnotes or endnotes, which the import leaves out",
  images: "it has images or drawings, which the import leaves out",
  "text-boxes": "it has text boxes, whose text the import leaves out",
  tables: "it has tables, whose cells the import reads as plain paragraphs",
  numbering: "it has lists or numbered headings, whose bullets and numbers the import leaves out, so a chapter number made that way is lost",
  ruby: "it has ruby (furigana) readings, which the import leaves out, keeping the base text"
};

// Converts the bytes of an .odt to { text, notes }, as docxMarkdown does
// for a .docx. Throws an ArchiveError when the file is not a readable
// OpenDocument text.
export function odtMarkdown(bytes, { chapterLine = () => null } = {}) {
  const entries = zipEntries(bytes, ODT);
  if (entries.has(MIMETYPE_PART)) {
    const mimetype = xmlText(bytes, entries.get(MIMETYPE_PART), ODT).trim();
    if (!TEXT_MIMETYPE.test(mimetype)) {
      throw new ArchiveError(`its media type is ${printable(mimetype)}, so it is not an OpenDocument text`);
    }
  }
  const content = entries.get(CONTENT_PART);
  if (content === undefined) {
    throw new ArchiveError(`it has no ${CONTENT_PART}, so it is not an OpenDocument text`);
  }
  // An encrypted .odt keeps its zip entries plain and lists each encrypted
  // part in the manifest.
  if (entries.has(MANIFEST_PART) && encryptedParts(xmlText(bytes, entries.get(MANIFEST_PART), ODT)).has(CONTENT_PART)) {
    throw new ArchiveError(`it is password-protected; ${ODT.unlock}`);
  }
  const contentXml = xmlText(bytes, content, ODT);
  const styles = readStyles([...(entries.has(STYLES_PART) ? [xmlText(bytes, entries.get(STYLES_PART), ODT)] : []), contentXml]);
  return documentMarkdown(contentXml, styles, chapterLine);
}

// The parts the manifest gives encryption data for.
function encryptedParts(xml) {
  const parts = new Set();
  let entry = null;
  for (const token of xmlTokens(xml)) {
    if (token.name === "manifest:file-entry") {
      entry = token.type === "start" ? token.attributes["manifest:full-path"] ?? null : null;
    } else if (entry !== null && token.type !== "end" && token.name === "manifest:encryption-data") {
      parts.add(entry);
    }
  }
  return parts;
}

const EMPTY_STYLE = { level: 0, quote: false, italic: null, bold: null, hidden: null };

// A style's default outline level: null when it sets none, 0 when it sets
// an empty one, and otherwise the level, from 1.
function outlineAttribute(value) {
  if (value === undefined) {
    return null;
  }
  const level = Number.parseInt(value, 10);
  return Number.isInteger(level) && level >= 1 ? level : 0;
}

// The paragraph and text styles of styles.xml and of content.xml's own
// automatic styles, as { paragraph, text } functions from a style name to
// its resolved { level, quote, italic, bold, hidden }: its heading level
// (from a `Heading N` name, the `Title` style, or a default outline level),
// whether it is a quote, and whether it sets italic, bold, or hidden text,
// each from the style or the nearest style it is based on. A later part's
// style of the same name wins, so content.xml goes last.
function readStyles(parts) {
  const styles = new Map();
  for (const xml of parts) {
    let style = null;
    for (const token of xmlTokens(xml)) {
      if (token.type === "text") {
        continue;
      }
      if (token.name === "style:style") {
        if (token.type === "end") {
          style = null;
          continue;
        }
        const { attributes } = token;
        const family = attributes["style:family"];
        style = family === "paragraph" || family === "text"
          ? {
            name: attributes["style:display-name"] ?? attributes["style:name"] ?? "",
            // An empty outline level says the style is not a heading,
            // whatever its parent is.
            outline: outlineAttribute(attributes["style:default-outline-level"]),
            parent: attributes["style:parent-style-name"] ?? null,
            italic: null,
            bold: null,
            hidden: null
          }
          : null;
        if (style !== null && attributes["style:name"] !== undefined) {
          styles.set(`${family}:${attributes["style:name"]}`, style);
        }
        if (token.type === "empty") {
          style = null;
        }
        continue;
      }
      if (style !== null && token.type !== "end" && token.name === "style:text-properties") {
        const { attributes } = token;
        const fontStyle = attributes["fo:font-style"];
        const fontWeight = attributes["fo:font-weight"];
        if (fontStyle !== undefined) {
          style.italic = fontStyle === "italic" || fontStyle === "oblique";
        }
        if (fontWeight !== undefined) {
          style.bold = fontWeight === "bold" || (/^\d+$/.test(fontWeight) && Number(fontWeight) >= 600);
        }
        if (attributes["text:display"] !== undefined) {
          style.hidden = attributes["text:display"] === "none";
        }
      }
    }
  }

  const resolved = new Map();
  const resolve = (family, name, depth) => {
    const key = `${family}:${name}`;
    if (resolved.has(key)) {
      return resolved.get(key);
    }
    const style = styles.get(key);
    if (style === undefined || depth > MAX_STYLE_DEPTH) {
      return EMPTY_STYLE;
    }
    // A style that is its own parent, directly or not, stops there.
    resolved.set(key, EMPTY_STYLE);
    const base = style.parent === null ? EMPTY_STYLE : resolve(family, style.parent, depth + 1);
    // A name with spaces is stored with each space as _20_.
    const label = style.name.replace(/_20_/g, " ").trim().toLowerCase();
    const heading = label.match(/^heading (\d+)$/);
    let level = base.level;
    if (label === "title") {
      level = 1;
    } else if (heading !== null) {
      level = Math.min(Number(heading[1]), 6);
    } else if (style.outline !== null) {
      level = Math.min(style.outline, 6);
    }
    const result = {
      level,
      quote: base.quote || /^(?:quotations|quote|intense quote|block text|block quote|blockquote)$/.test(label),
      italic: style.italic ?? base.italic,
      bold: style.bold ?? base.bold,
      hidden: style.hidden ?? base.hidden
    };
    resolved.set(key, result);
    return result;
  };
  return {
    paragraph: (name) => (name === null ? EMPTY_STYLE : resolve("paragraph", name, 0)),
    text: (name) => (name === null ? EMPTY_STYLE : resolve("text", name, 0))
  };
}

// Elements whose content is never prose: the deleted text of tracked
// changes, footnotes, comments, drawings and their text boxes, generated
// indexes, hidden text, a heading's generated number, ruby readings, and
// declarations. The value is the note the import gives, or null.
const SKIPPED = new Map([
  ["text:tracked-changes", "tracked-changes"],
  ["text:note", "footnotes"],
  ["office:annotation", "comments"],
  ["draw:frame", "images"],
  ["draw:a", "images"],
  ["draw:g", "images"],
  ["draw:custom-shape", "images"],
  ["draw:rect", "images"],
  ["draw:ellipse", "images"],
  ["draw:line", "images"],
  ["draw:polygon", "images"],
  ["draw:path", "images"],
  ["draw:image", "images"],
  ["draw:text-box", "text-boxes"],
  ["text:ruby-text", "ruby"],
  ["text:number", "numbering"],
  ["text:table-of-content", null],
  ["text:alphabetical-index", null],
  ["text:illustration-index", null],
  ["text:table-index", null],
  ["text:object-index", null],
  ["text:user-index", null],
  ["text:bibliography", null],
  ["text:hidden-text", null],
  ["text:sequence-decls", null],
  ["text:variable-decls", null],
  ["text:user-field-decls", null],
  ["office:forms", null]
]);

// Walks content.xml's office:text and writes each paragraph as markdown
// blocks.
function documentMarkdown(xml, styles, chapterLine) {
  const notes = new Set();
  const blocks = [];
  let inText = false;
  let skipping = null;
  let paragraph = null;
  let nested = 0;
  // The text styles of the open spans, innermost last.
  const spans = [];

  const finish = () => {
    const style = styles.paragraph(paragraph.style);
    const level = paragraph.heading === null ? style.level : paragraph.heading;
    const runs = paragraph.runs.filter((run) => (run.hidden ?? style.hidden) !== true).map((run) => ({
      text: run.text,
      // A heading's own bold or italic is its style, not emphasis.
      italic: level === 0 && (run.italic ?? style.italic) === true,
      bold: level === 0 && (run.bold ?? style.bold) === true
    }));
    blocks.push(...paragraphBlocks(runs, level, style.quote, chapterLine));
    paragraph = null;
  };
  const add = (text) => {
    // The innermost span that says decides.
    const pick = (key) => {
      for (let index = spans.length - 1; index >= 0; index -= 1) {
        const value = styles.text(spans[index])[key];
        if (value !== null) {
          return value;
        }
      }
      return null;
    };
    paragraph.runs.push({ text, italic: pick("italic"), bold: pick("bold"), hidden: pick("hidden") });
  };

  for (const token of xmlTokens(xml)) {
    const { type, name, attributes } = token;
    if (skipping !== null) {
      // A text box sits inside the frame that holds it.
      if (name === "draw:text-box") {
        notes.add("text-boxes");
      }
      if (type === "start") {
        skipping += 1;
      } else if (type === "end") {
        skipping -= 1;
        if (skipping === 0) {
          skipping = null;
        }
      }
      continue;
    }
    if (name === "office:text") {
      inText = type === "start";
      continue;
    }
    if (!inText) {
      continue;
    }
    if (type === "text") {
      if (paragraph !== null) {
        // White space in the text collapses; text:s and text:tab are the
        // document's own spaces and tabs.
        add(proseText(token.text.replace(/[\t\r\n]/g, " ")));
      }
      continue;
    }
    if (type !== "end" && SKIPPED.has(name)) {
      const note = SKIPPED.get(name);
      if (note !== null) {
        notes.add(note);
      }
      if (type === "start") {
        skipping = 1;
      }
      continue;
    }
    if (type !== "end" && name === "text:section" && attributes["text:display"] === "none") {
      if (type === "start") {
        skipping = 1;
      }
      continue;
    }
    if (name === "text:change" || name === "text:change-start") {
      notes.add("tracked-changes");
      continue;
    }
    if (name === "text:list" && type === "start") {
      notes.add("numbering");
      continue;
    }
    if (name === "table:table" && type === "start") {
      notes.add("tables");
      continue;
    }
    if (name === "text:p" || name === "text:h") {
      if (type === "end") {
        if (nested > 0) {
          nested -= 1;
        } else if (paragraph !== null) {
          finish();
        }
        continue;
      }
      if (paragraph !== null) {
        // A paragraph inside a paragraph is only ever inside content the
        // walk skips, but if one comes, its text joins the outer one.
        nested += type === "start" ? 1 : 0;
        continue;
      }
      const outline = Number.parseInt(attributes["text:outline-level"] ?? "", 10);
      paragraph = {
        style: attributes["text:style-name"] ?? null,
        // A heading without an outline level is a level 1 heading.
        heading: name === "text:h" ? (Number.isInteger(outline) && outline >= 1 ? Math.min(outline, 6) : 1) : null,
        runs: []
      };
      if (type === "empty") {
        finish();
      }
      continue;
    }
    if (paragraph === null) {
      continue;
    }
    if (name === "text:span") {
      if (type === "start") {
        spans.push(attributes["text:style-name"] ?? null);
      } else if (type === "end") {
        spans.pop();
      }
      continue;
    }
    if (type === "end") {
      continue;
    }
    if (name === "text:s") {
      add(" ");
    } else if (name === "text:tab") {
      add("\t");
    } else if (name === "text:line-break") {
      add(LINE_BREAK);
    }
  }

  const text = blocks.join("\n\n");
  return {
    text: text === "" ? "" : `${text}\n`,
    notes: [...notes].map((code) => ({ code, message: NOTE_MESSAGES[code] }))
  };
}

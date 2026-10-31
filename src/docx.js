// Reads a Word document (.docx) as markdown for story import: paragraphs,
// headings from heading styles or outline levels, italic and bold, block
// quotes, hard line breaks, and scene breaks. Anything the import cannot
// carry over (comments, footnotes, text boxes, images, tables, tracked
// changes, list numbering, ruby readings) is named in a note, so the writer
// knows what to check.
//
// A .docx is a zip of XML parts. Only word/document.xml and
// word/styles.xml are read, each under a size limit, and node:zlib inflates
// them: decompression gives the same bytes on every runtime, unlike the
// compression deflate.js replaces. The XML is read with a small scanner
// that refuses a document type declaration, so no entity is ever expanded.
import zlib from "node:zlib";
import { crc32 } from "./packaging.js";

// A part bigger than this inflated is refused: a novel's document.xml is a
// few megabytes, and the limit bounds the memory one conversion takes.
export const MAX_DOCX_PART_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10000;
// A style based on a style based on ... is followed this far.
const MAX_STYLE_DEPTH = 64;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_MARK = 0xffffffff;

const DOCUMENT_PART = "word/document.xml";
const STYLES_PART = "word/styles.xml";

// The error for a file that is not a readable Word document. Its message
// is the reason, for the caller to show after the file name.
export class DocxError extends Error {
  constructor(message) {
    super(message);
    this.name = "DocxError";
  }
}

// Converts the bytes of a .docx to { text, notes }: markdown text, and the
// notes about what was left out, each { code, message }. `chapterLine`
// tells a paragraph that is a chapter line ("Chapter 3", "Prologue") from
// prose: it returns null, or { bare } where bare is true when the line has
// no title of its own. Throws a DocxError when the file is not a readable
// .docx.
export function docxMarkdown(bytes, { chapterLine = () => null } = {}) {
  const entries = zipEntries(bytes);
  const document = entries.get(DOCUMENT_PART);
  if (document === undefined) {
    throw new DocxError(`it has no ${DOCUMENT_PART}, so it is not a Word document`);
  }
  const styles = entries.has(STYLES_PART) ? readStyles(xmlText(bytes, entries.get(STYLES_PART))) : { paragraph: () => EMPTY_STYLE, character: () => EMPTY_STYLE };
  return documentMarkdown(xmlText(bytes, document), styles, chapterLine);
}

// The zip's central directory, as a map from entry name to the entry's
// method, sizes, CRC, and local header offset.
function zipEntries(bytes) {
  const end = findEndOfCentralDirectory(bytes);
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const offset = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || size === ZIP64_MARK || offset === ZIP64_MARK) {
    throw new DocxError("it is a ZIP64 archive, which import does not read; save it again from Word");
  }
  if (count > MAX_ZIP_ENTRIES) {
    throw new DocxError(`it has ${count} zip entries, over the ${MAX_ZIP_ENTRIES} entry limit`);
  }
  if (offset + size > end) {
    throw new DocxError("its zip directory is damaged");
  }
  const entries = new Map();
  let position = offset;
  for (let index = 0; index < count; index += 1) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== CENTRAL_SIGNATURE) {
      throw new DocxError("its zip directory is damaged");
    }
    const flags = bytes.readUInt16LE(position + 8);
    const nameLength = bytes.readUInt16LE(position + 28);
    const extraLength = bytes.readUInt16LE(position + 30);
    const commentLength = bytes.readUInt16LE(position + 32);
    const name = bytes.toString("utf8", position + 46, position + 46 + nameLength);
    // Two entries with one name could show one text in Word and import
    // another.
    if (entries.has(name)) {
      throw new DocxError(`it has two zip entries named ${name}`);
    }
    entries.set(name, {
      name,
      encrypted: (flags & 1) === 1,
      method: bytes.readUInt16LE(position + 10),
      crc: bytes.readUInt32LE(position + 16),
      compressedSize: bytes.readUInt32LE(position + 20),
      size: bytes.readUInt32LE(position + 24),
      localOffset: bytes.readUInt32LE(position + 42)
    });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// The end of central directory record is the last 22 bytes, unless the
// zip has a comment of up to 65,535 bytes after it.
function findEndOfCentralDirectory(bytes) {
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let position = bytes.length - 22; position >= lowest; position -= 1) {
    if (bytes.readUInt32LE(position) === EOCD_SIGNATURE) {
      return position;
    }
  }
  throw new DocxError("it is not a readable zip file, so it is not a .docx; save it again from Word, or export it to markdown");
}

// One entry's bytes, inflated and checked against its size and CRC, read
// as UTF-8 XML.
function xmlText(bytes, entry) {
  if (entry.encrypted) {
    throw new DocxError("it is password-protected; remove the password in Word and save it again");
  }
  if (entry.size === ZIP64_MARK || entry.compressedSize === ZIP64_MARK) {
    throw new DocxError("it is a ZIP64 archive, which import does not read; save it again from Word");
  }
  if (entry.size > MAX_DOCX_PART_BYTES) {
    throw new DocxError(`${entry.name} is ${entry.size} bytes, over the ${MAX_DOCX_PART_BYTES} byte limit`);
  }
  const local = entry.localOffset;
  if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== LOCAL_SIGNATURE) {
    throw new DocxError(`its zip entry ${entry.name} is damaged`);
  }
  const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) {
    throw new DocxError(`its zip entry ${entry.name} is cut short`);
  }
  let content;
  if (entry.method === 0) {
    content = data;
  } else if (entry.method === 8) {
    try {
      content = zlib.inflateRawSync(data, { maxOutputLength: MAX_DOCX_PART_BYTES });
    } catch {
      throw new DocxError(`its zip entry ${entry.name} cannot be inflated, or inflates past the ${MAX_DOCX_PART_BYTES} byte limit`);
    }
  } else {
    throw new DocxError(`its zip entry ${entry.name} uses compression method ${entry.method}, which import does not read`);
  }
  if (content.length !== entry.size || crc32(content) !== entry.crc) {
    throw new DocxError(`its zip entry ${entry.name} is damaged`);
  }
  let text;
  try {
    text = UTF8.decode(content);
  } catch {
    throw new DocxError(`${entry.name} is not valid UTF-8 text`);
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  if (/<!DOCTYPE/i.test(text)) {
    throw new DocxError(`${entry.name} has a document type declaration, which a Word document never has`);
  }
  return text;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// XML tokens: start, end, and empty tags with their attributes, and the
// text between them. Comments, processing instructions, and CDATA are
// skipped. The tag pattern is sticky and its attribute values cannot
// overlap, so a scan stays linear. A comment, processing instruction, or
// CDATA section that never ends, an end tag that does not match the open
// element, or an element left open is damage, so a cut-short part is never
// read as a shorter document.
const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function* xmlTokens(text) {
  const open = [];
  for (const token of rawTokens(text)) {
    if (token.type === "start") {
      open.push(token.name);
    } else if (token.type === "end" && open.pop() !== token.name) {
      throw new DocxError("its XML is damaged");
    }
    yield token;
  }
  if (open.length > 0) {
    throw new DocxError("its XML is damaged");
  }
}

function* rawTokens(text) {
  let position = 0;
  while (position < text.length) {
    const open = text.indexOf("<", position);
    if (open === -1) {
      yield { type: "text", text: decodeEntities(text.slice(position)) };
      return;
    }
    if (open > position) {
      yield { type: "text", text: decodeEntities(text.slice(position, open)) };
    }
    const skip = [["<!--", "-->"], ["<?", "?>"], ["<![CDATA[", "]]>"]].find(([start]) => text.startsWith(start, open));
    if (skip !== undefined) {
      const close = text.indexOf(skip[1], open + skip[0].length);
      if (close === -1) {
        throw new DocxError("its XML is damaged");
      }
      if (skip[0] === "<![CDATA[") {
        yield { type: "text", text: text.slice(open + 9, close) };
      }
      position = close + skip[1].length;
      continue;
    }
    TAG.lastIndex = open;
    const match = TAG.exec(text);
    if (match === null) {
      throw new DocxError("its XML is damaged");
    }
    const attributes = {};
    for (const attribute of match[3].matchAll(ATTRIBUTE)) {
      attributes[attribute[1]] = decodeEntities(attribute[2] ?? attribute[3]);
    }
    yield { type: match[1] ? "end" : match[4] ? "empty" : "start", name: match[2], attributes };
    position = TAG.lastIndex;
  }
}

const ENTITIES = new Map([["lt", "<"], ["gt", ">"], ["amp", "&"], ["quot", "\""], ["apos", "'"]]);

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES.get(name) ?? whole;
  });
}

// Prose text from a `w:t`: control characters other than a tab are
// dropped, a line break or carriage return is a space, as XML and Word
// read them, and the private-use marks this module uses for breaks are
// dropped, so text can never add a markdown line of its own.
function proseText(text) {
  return text.replace(/[\r\n]/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

// A Word on/off property (`<w:i/>`, `<w:i w:val="0"/>`) is on unless its
// value says off.
function isOn(attributes) {
  const value = attributes["w:val"];
  return value === undefined || !["0", "false", "off", "none"].includes(value);
}

const EMPTY_STYLE = { level: 0, quote: false, italic: null, bold: null };

// The paragraph and character styles, as { paragraph, character }
// functions from a style id to the style's resolved { level, quote,
// italic, bold }: its heading level (from
// a `heading N` name, the `Title` style, or an outline level, where level 9
// is body text), whether it is a quote, and whether it sets italic or bold,
// each from the style or the nearest style it is based on. Each style is
// resolved once, so a long chain of styles costs no more than its length.
function readStyles(xml) {
  const styles = new Map();
  let defaultParagraph = null;
  let style = null;
  let inRunProperties = false;
  for (const token of xmlTokens(xml)) {
    if (token.type === "start" && token.name === "w:style") {
      style = { id: token.attributes["w:styleId"], name: "", outline: null, italic: null, bold: null, basedOn: null };
      if (token.attributes["w:type"] === "paragraph" && isOn({ "w:val": token.attributes["w:default"] ?? "0" }) && defaultParagraph === null) {
        defaultParagraph = style.id ?? null;
      }
      continue;
    }
    if (style === null) {
      continue;
    }
    if (token.type === "end" && token.name === "w:style") {
      if (style.id !== undefined) {
        styles.set(style.id, style);
      }
      style = null;
      continue;
    }
    if (token.name === "w:rPr") {
      inRunProperties = token.type === "start";
      continue;
    }
    if (token.type === "end") {
      continue;
    }
    const value = token.attributes["w:val"];
    if (token.name === "w:name") {
      style.name = value ?? "";
    } else if (token.name === "w:basedOn") {
      style.basedOn = value ?? null;
    } else if (token.name === "w:outlineLvl" && !inRunProperties) {
      style.outline = Number.parseInt(value, 10);
    } else if (token.name === "w:i" && inRunProperties) {
      style.italic = isOn(token.attributes);
    } else if (token.name === "w:b" && inRunProperties) {
      style.bold = isOn(token.attributes);
    }
  }

  const resolved = new Map();
  const resolve = (id, depth) => {
    if (resolved.has(id)) {
      return resolved.get(id);
    }
    const style = styles.get(id);
    if (style === undefined || depth > MAX_STYLE_DEPTH) {
      return EMPTY_STYLE;
    }
    // A style that is its own base, directly or not, stops there.
    resolved.set(id, EMPTY_STYLE);
    const base = resolve(style.basedOn, depth + 1);
    const name = style.name.trim().toLowerCase();
    const heading = name.match(/^heading (\d)$/);
    let level = base.level;
    if (name === "title") {
      level = 1;
    } else if (heading !== null) {
      level = Math.min(Number(heading[1]), 6);
    } else if (Number.isInteger(style.outline) && style.outline >= 0 && style.outline <= 9) {
      level = outlineLevel(style.outline);
    }
    const result = {
      level,
      quote: base.quote || /^(?:quote|intense quote|block text|block quote|blockquote)$/.test(name),
      italic: style.italic ?? base.italic,
      bold: style.bold ?? base.bold
    };
    resolved.set(id, result);
    return result;
  };
  // A paragraph with no style of its own is in the default paragraph style.
  return {
    paragraph: (id) => resolve(id ?? defaultParagraph, 0),
    character: (id) => (id === null ? EMPTY_STYLE : resolve(id, 0))
  };
}

// The markdown heading level of a Word outline level: 0 to 8 are heading
// levels 1 to 9 (markdown stops at 6), and 9 is body text.
function outlineLevel(outline) {
  return outline === 9 ? 0 : Math.min(outline + 1, 6);
}

// Elements whose content is never prose: deleted text and moved-away text
// in tracked changes, the old formatting of a tracked format change, the
// fallback copy of alternate content, ruby readings, and drawings,
// pictures, and text boxes. The value is the note the import gives, or
// null.
const SKIPPED = new Map([
  ["w:del", "tracked-changes"],
  ["w:moveFrom", "tracked-changes"],
  ["w:rPrChange", null],
  ["w:pPrChange", null],
  ["w:sectPrChange", null],
  ["w:tblPrChange", null],
  ["mc:Fallback", null],
  ["w:rt", "ruby"],
  ["w:drawing", "images"],
  ["w:pict", "images"],
  ["w:object", "images"],
  ["w:txbxContent", "text-boxes"]
]);

const NOTE_MESSAGES = {
  "tracked-changes": "it has tracked changes; the import keeps the text as if every change were accepted",
  comments: "it has comments, which the import leaves out",
  footnotes: "it has footnotes or endnotes, which the import leaves out",
  images: "it has images or drawings, which the import leaves out",
  "text-boxes": "it has text boxes, whose text the import leaves out",
  tables: "it has tables, whose cells the import reads as plain paragraphs",
  numbering: "it numbers paragraphs or headings with Word's list numbering, which the import leaves out, so a chapter number made that way is lost",
  ruby: "it has ruby (furigana) readings, which the import leaves out, keeping the base text"
};

// A field whose result is generated, not prose: a table of contents or an
// index.
const GENERATED_FIELD = /^\s*(?:TOC|INDEX)\b/i;

// Walks document.xml and writes each paragraph as a markdown block.
function documentMarkdown(xml, styles, chapterLine) {
  const notes = new Set();
  const blocks = [];
  let skipping = null;
  let depth = 0;
  let paragraph = null;
  let run = null;
  let inParagraphProperties = false;
  let inRunProperties = false;
  let inText = false;
  let inInstruction = false;
  // Complex fields (`w:fldChar` begin, separate, end) can span paragraphs;
  // content controls (`w:sdt`) can nest. Text inside a generated field's
  // result, a table-of-contents control, or a control showing its
  // placeholder is left out.
  const fields = [];
  const controls = [];
  // The runs of a paragraph whose mark is a tracked deletion: accepting it
  // joins them to the next paragraph.
  let joined = null;
  const hidden = () => fields.some((field) => field.result && GENERATED_FIELD.test(field.instruction)) || controls.some((control) => control.skip);

  for (const token of xmlTokens(xml)) {
    if (skipping !== null) {
      // A text box sits inside the drawing or picture that holds it.
      if (token.name === "w:txbxContent" && SKIPPED.get(skipping) === "images") {
        notes.add("text-boxes");
      }
      if (token.name === skipping) {
        depth += token.type === "start" ? 1 : token.type === "end" ? -1 : 0;
        if (depth === 0) {
          skipping = null;
        }
      }
      continue;
    }
    const { type, name, attributes } = token;
    if (type === "start" && SKIPPED.has(name)) {
      const note = SKIPPED.get(name);
      if (note !== null) {
        notes.add(note);
      }
      skipping = name;
      depth = 1;
      continue;
    }
    if (type === "text") {
      if (inInstruction && fields.length > 0) {
        fields.at(-1).instruction += token.text;
      } else if (inText && run !== null && !run.hidden && !hidden()) {
        run.text += proseText(token.text);
      }
      continue;
    }
    if (name === "w:instrText") {
      inInstruction = type === "start";
      continue;
    }
    if (name === "w:fldChar" && type !== "end") {
      const kind = attributes["w:fldCharType"];
      if (kind === "begin") {
        fields.push({ instruction: "", result: false });
      } else if (kind === "separate" && fields.length > 0) {
        fields.at(-1).result = true;
      } else if (kind === "end") {
        fields.pop();
      }
      continue;
    }
    if (name === "w:fldSimple" && type === "start" && GENERATED_FIELD.test(attributes["w:instr"] ?? "")) {
      skipping = name;
      depth = 1;
      continue;
    }
    if (name === "w:sdt") {
      if (type === "start") {
        controls.push({ skip: false });
      } else if (type === "end") {
        controls.pop();
      }
      continue;
    }
    if (controls.length > 0 && type !== "end" && ((name === "w:docPartGallery" && /table of contents/i.test(attributes["w:val"] ?? "")) || name === "w:showingPlcHdr")) {
      controls.at(-1).skip = true;
      continue;
    }
    if (type === "empty" && SKIPPED.get(name) === "tracked-changes") {
      // A deleted paragraph mark (`<w:del/>` in the paragraph's run
      // properties) is a tracked change too, and joins the paragraph to the
      // next.
      notes.add("tracked-changes");
      if (paragraph !== null && inParagraphProperties && inRunProperties && name === "w:del") {
        paragraph.markDeleted = true;
      }
      continue;
    }
    if (name === "w:ins" || name === "w:moveTo") {
      notes.add("tracked-changes");
      continue;
    }
    if (name === "w:commentRangeStart" || name === "w:commentReference") {
      notes.add("comments");
      continue;
    }
    if (name === "w:footnoteReference" || name === "w:endnoteReference") {
      notes.add("footnotes");
      continue;
    }
    if (name === "w:tbl" && type === "start") {
      notes.add("tables");
      continue;
    }
    if (name === "w:p") {
      if (type === "start") {
        paragraph = { style: null, outline: null, runs: joined ?? [], markDeleted: false };
        joined = null;
      } else if (type === "end" && paragraph !== null) {
        if (paragraph.markDeleted) {
          joined = paragraph.runs;
        } else {
          for (const block of paragraphBlocks(paragraph, styles, chapterLine)) {
            blocks.push(block);
          }
        }
        paragraph = null;
      }
      continue;
    }
    if (paragraph === null) {
      continue;
    }
    if (name === "w:pPr") {
      inParagraphProperties = type === "start";
      continue;
    }
    if (name === "w:rPr") {
      inRunProperties = type === "start";
      continue;
    }
    if (inParagraphProperties && !inRunProperties && type !== "end") {
      if (name === "w:pStyle") {
        paragraph.style = attributes["w:val"] ?? null;
      } else if (name === "w:outlineLvl") {
        paragraph.outline = Number.parseInt(attributes["w:val"], 10);
      } else if (name === "w:numPr") {
        notes.add("numbering");
      }
      continue;
    }
    if (name === "w:r") {
      if (type === "start") {
        run = { text: "", italic: null, bold: null, style: null, hidden: false };
      } else if (run !== null) {
        paragraph.runs.push(run);
        run = null;
      }
      continue;
    }
    if (run === null) {
      continue;
    }
    if (inRunProperties) {
      if (type === "end") {
        continue;
      }
      if (name === "w:i") {
        run.italic = isOn(attributes);
      } else if (name === "w:b") {
        run.bold = isOn(attributes);
      } else if (name === "w:rStyle") {
        run.style = attributes["w:val"] ?? null;
      } else if (name === "w:vanish") {
        run.hidden = isOn(attributes);
      }
      continue;
    }
    if (name === "w:t") {
      inText = type === "start";
    } else if (type !== "end" && !run.hidden && !hidden()) {
      if (name === "w:tab" || name === "w:ptab") {
        run.text += "\t";
      } else if (name === "w:br" || name === "w:cr") {
        const kind = attributes["w:type"];
        run.text += kind === "page" || kind === "column" ? PARAGRAPH_BREAK : LINE_BREAK;
      } else if (name === "w:noBreakHyphen") {
        run.text += "‑";
      }
    }
  }

  if (joined !== null) {
    for (const block of paragraphBlocks({ style: null, outline: null, runs: joined }, styles, chapterLine)) {
      blocks.push(block);
    }
  }
  const text = blocks.join("\n\n");
  return {
    text: text === "" ? "" : `${text}\n`,
    notes: [...notes].map((code) => ({ code, message: NOTE_MESSAGES[code] }))
  };
}

// Private-use marks for a hard line break and a page break inside a
// paragraph, replaced when the paragraph is written. proseText drops them
// from the document's own text.
const LINE_BREAK = "";
const PARAGRAPH_BREAK = "";

// One Word paragraph as markdown blocks: a page break inside it splits it.
function paragraphBlocks(paragraph, styles, chapterLine) {
  const style = styles.paragraph(paragraph.style);
  const level = Number.isInteger(paragraph.outline) && paragraph.outline >= 0 && paragraph.outline <= 9
    ? outlineLevel(paragraph.outline)
    : style.level;
  const quote = level === 0 && style.quote;
  const runs = paragraph.runs.map((run) => ({
    text: run.text.replace(/­/g, ""),
    // A heading's own bold or italic is its style, not emphasis.
    italic: level === 0 && (run.italic ?? styles.character(run.style).italic ?? style.italic) === true,
    bold: level === 0 && (run.bold ?? styles.character(run.style).bold ?? style.bold) === true
  }));
  const pieces = [[]];
  for (const run of runs) {
    const parts = run.text.split(PARAGRAPH_BREAK);
    parts.forEach((part, index) => {
      if (index > 0) {
        pieces.push([]);
      }
      pieces.at(-1).push({ ...run, text: part });
    });
  }
  return pieces.map((piece) => blockMarkdown(piece, level, quote, chapterLine)).filter((block) => block !== "");
}

function blockMarkdown(runs, level, quote, chapterLine) {
  const plain = runs.map((run) => run.text).join("").replace(/[\t ]+/g, " ").trim();
  const lines = plain.split(LINE_BREAK).map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length === 0) {
    return "";
  }
  // A scene break keeps its own markers, unless it is a lone `#`, which
  // markdown would read as an empty heading. Text with backslashes, such as
  // `\* \* \*`, is prose, escaped as written.
  if (level === 0 && /^([*_~-])( ?\1){2,}$/.test(plain)) {
    return plain;
  }
  if (level === 0 && plain === "#") {
    return "***";
  }
  if (level === 0) {
    // A chapter line in a plain paragraph, bold or not, is a chapter
    // heading, as is a bare one ("Chapter 1") with its title on the next
    // line of the same paragraph.
    const heading = lines.length === 1 && chapterLine(lines[0]) !== null
      ? lines[0]
      : lines.length === 2 && chapterLine(lines[0])?.bare === true ? `${lines[0]}: ${lines[1]}` : null;
    if (heading !== null) {
      return `# ${escapeInline(heading)}`;
    }
  }
  if (level > 0) {
    return `${"#".repeat(level)} ${escapeInline(lines.join(" ").replace(/[ \t]+/g, " "))}`;
  }
  const text = inlineMarkdown(runs).split(LINE_BREAK).map((line) => line.trim()).filter((line, index, all) => line !== "" || (index > 0 && index < all.length - 1)).join("\\\n");
  const block = escapeBlockStart(text);
  return quote ? block.split("\n").map((line) => `> ${line}`).join("\n") : block;
}

// The runs as markdown inline text: runs with the same emphasis merge, and
// white space at the edges of an emphasised run (a no-break space too)
// moves outside its markers, so `*word *` never appears.
function inlineMarkdown(runs) {
  const merged = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last !== undefined && last.italic === run.italic && last.bold === run.bold) {
      last.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged.map((run) => {
    const text = run.text.replace(/[\t ]+/g, " ");
    const marker = (run.bold ? "**" : "") + (run.italic ? "*" : "");
    const lead = text.match(/^\s*/)[0];
    const trail = lead.length === text.length ? "" : text.match(/\s*$/)[0];
    const body = text.slice(lead.length, text.length - trail.length).replaceAll(` ${LINE_BREAK}`, LINE_BREAK).replaceAll(`${LINE_BREAK} `, LINE_BREAK);
    if (marker === "" || body.replaceAll(LINE_BREAK, "") === "") {
      return escapeInline(text);
    }
    // Emphasis cannot span a hard line break, so each line gets its own.
    const marked = escapeInline(body).split(LINE_BREAK).map((line) => (line === "" ? line : `${marker}${line}${[...marker].reverse().join("")}`)).join(LINE_BREAK);
    return `${lead}${marked}${trail}`;
  }).join("");
}

// Characters that would read as markdown markup in prose are escaped. An
// escaped `<!` also escapes its `!`, so `<!--` in the prose is never read
// as the start of an HTML comment.
function escapeInline(text) {
  return text.replace(/[\\`*_[\]<]/g, "\\$&").replace(/\\<!/g, "\\<\\!");
}

// A line that would start a heading, list, block quote, or code block is
// escaped at its start.
function escapeBlockStart(text) {
  return text.split("\n").map((line) => line
    .replace(/^(#{1,6})(?=\s|$)/, "\\$1")
    .replace(/^>/, "\\>")
    .replace(/^([-+])(?=\s)/, "\\$1")
    .replace(/^(\d+)([.)])(?=\s)/, "$1\\$2")
    .replace(/^(=+|-+)$/, (marks) => `\\${marks}`)).join("\n");
}

// Reads a Word document (.docx) as markdown for story import: paragraphs,
// headings from heading styles or outline levels, italic and bold, block
// quotes, hard line breaks, and scene breaks. Anything the import cannot
// carry over (comments, footnotes, text boxes, images, tables, tracked
// changes, list numbering, ruby readings) is named in a note, so the writer
// knows what to check.
//
// A .docx is a zip of XML parts. Only word/document.xml and
// word/styles.xml are read, each under a size limit, through archive.js,
// which refuses a document type declaration, so no entity is ever
// expanded. rich-text.js writes the paragraphs as markdown.
import { ArchiveError, MAX_PART_BYTES, WORD, xmlText, xmlTokens, zipEntries } from "./archive.js";
import { LINE_BREAK, PARAGRAPH_BREAK, paragraphBlocks, proseText } from "./rich-text.js";

// story notes, story apply, and their tests read Word documents through
// these names.
export { ArchiveError as DocxError, printable, xmlText, xmlTokens, zipEntries } from "./archive.js";
export { HARD_BREAK, paragraphMarkdown, proseText } from "./rich-text.js";
export const MAX_DOCX_PART_BYTES = MAX_PART_BYTES;
// A style based on a style based on ... is followed this far.
const MAX_STYLE_DEPTH = 64;

export const DOCUMENT_PART = "word/document.xml";
export const STYLES_PART = "word/styles.xml";

// Converts the bytes of a .docx to { text, notes }: markdown text, and the
// notes about what was left out, each { code, message }. `chapterLine`
// tells a paragraph that is a chapter line ("Chapter 3", "Prologue") from
// prose: it returns null, or { bare } where bare is true when the line has
// no title of its own. Throws a DocxError when the file is not a readable
// .docx.
export function docxMarkdown(bytes, { chapterLine = () => null } = {}) {
  const entries = zipEntries(bytes, WORD);
  const document = entries.get(DOCUMENT_PART);
  if (document === undefined) {
    throw new ArchiveError(`it has no ${DOCUMENT_PART}, so it is not a Word document`);
  }
  const styles = entries.has(STYLES_PART) ? readStyles(xmlText(bytes, entries.get(STYLES_PART))) : { paragraph: () => EMPTY_STYLE, character: () => EMPTY_STYLE };
  return documentMarkdown(xmlText(bytes, document), styles, chapterLine);
}

// A Word on/off property (`<w:i/>`, `<w:i w:val="0"/>`) is on unless its
// value says off.
export function isOn(attributes) {
  const value = attributes["w:val"];
  return value === undefined || !["0", "false", "off", "none"].includes(value);
}

export const EMPTY_STYLE = { level: 0, quote: false, italic: null, bold: null, hidden: null };

// The paragraph and character styles, as { paragraph, character }
// functions from a style id to the style's resolved { level, quote,
// italic, bold, hidden }: its heading level (from
// a `heading N` name, the `Title` style, or an outline level, where level 9
// is body text), whether it is a quote, and whether it sets italic, bold, or
// hidden text (`w:vanish` or `w:specVanish`, not `w:webHidden`, which hides
// text only in Web Layout view; story notes and story apply read the last),
// each from the style or the nearest style it is based on. Each style is
// resolved once, so a long chain of styles costs no more than its length.
export function readStyles(xml) {
  const styles = new Map();
  let defaultParagraph = null;
  let style = null;
  let inRunProperties = false;
  for (const token of xmlTokens(xml)) {
    if (token.type === "start" && token.name === "w:style") {
      style = { id: token.attributes["w:styleId"], name: "", outline: null, italic: null, bold: null, hidden: null, basedOn: null };
      if (token.attributes["w:type"] === "paragraph" && isOn({ "w:val": token.attributes["w:default"] ?? "0" }) && defaultParagraph === null) {
        defaultParagraph = style.id ?? null;
      }
      continue;
    }
    // Text between the tags, such as the line breaks of a pretty-printed
    // styles.xml, is not a property.
    if (style === null || token.type === "text") {
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
    } else if ((token.name === "w:vanish" || token.name === "w:specVanish") && inRunProperties) {
      style.hidden = style.hidden === true || isOn(token.attributes);
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
      bold: style.bold ?? base.bold,
      hidden: style.hidden ?? base.hidden
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
export function outlineLevel(outline) {
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
          for (const block of wordParagraphBlocks(paragraph, styles, chapterLine)) {
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
    for (const block of wordParagraphBlocks({ style: null, outline: null, runs: joined }, styles, chapterLine)) {
      blocks.push(block);
    }
  }
  const text = blocks.join("\n\n");
  return {
    text: text === "" ? "" : `${text}\n`,
    notes: [...notes].map((code) => ({ code, message: NOTE_MESSAGES[code] }))
  };
}

// One Word paragraph as markdown blocks: a page break inside it splits it.
function wordParagraphBlocks(paragraph, styles, chapterLine) {
  const style = styles.paragraph(paragraph.style);
  const level = Number.isInteger(paragraph.outline) && paragraph.outline >= 0 && paragraph.outline <= 9
    ? outlineLevel(paragraph.outline)
    : style.level;
  const runs = paragraph.runs.map((run) => ({
    text: run.text,
    // A heading's own bold or italic is its style, not emphasis.
    italic: level === 0 && (run.italic ?? styles.character(run.style).italic ?? style.italic) === true,
    bold: level === 0 && (run.bold ?? styles.character(run.style).bold ?? style.bold) === true
  }));
  return paragraphBlocks(runs, level, style.quote, chapterLine);
}

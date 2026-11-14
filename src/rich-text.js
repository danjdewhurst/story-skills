// Writes the paragraphs read from a Word document, an OpenDocument text,
// or an EPUB as markdown blocks for story import: headings, italic and
// bold, block quotes, hard line breaks, and scene breaks, with any
// character that markdown would read as markup escaped. Each reader turns
// its own markup into runs of { text, italic, bold } and hands them here,
// so the three formats import alike.
import { isSceneBreakLine } from "./markdown.js";
import { ArchiveError } from "./archive.js";

// Prose text from a document: control characters other than a tab are
// dropped, a line break or carriage return is a space, as XML and Word
// read them, and the private-use marks this module uses for breaks are
// dropped, so text can never add a markdown line of its own.
export function proseText(text) {
  return text.replace(/[\r\n]/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f\uE010\uE011]/g, "");
}

// Private-use marks for a hard line break and a page break inside a
// paragraph, replaced when the paragraph is written. proseText drops them
// from the document's own text.
export const LINE_BREAK = "\uE010";
export const PARAGRAPH_BREAK = "\uE011";

// One paragraph of body text as markdown, as the import writes it: `runs`
// are { text, italic, bold }, with HARD_BREAK for each line break, and
// `quote` makes it a block quote. story apply writes an editor's paragraph
// into a chapter with this. A run of scene-break markers comes back as
// written, so the caller decides what a scene break is.
export function paragraphMarkdown(runs, { quote = false, verse = false } = {}) {
  return blockMarkdown(runs.map((run) => ({ text: run.text.replace(/\u00ad/g, ""), italic: run.italic === true, bold: run.bold === true })), 0, quote, () => null, verse);
}

// The mark paragraphMarkdown reads as a line break inside a paragraph.
export const HARD_BREAK = LINE_BREAK;

// One paragraph as markdown blocks: `runs` are { text, italic, bold },
// with LINE_BREAK for a line break and PARAGRAPH_BREAK for a page break,
// which splits it. `level` is its heading level (0 for body text), and
// `quote` makes body text a block quote. `chapterLine` tells a chapter
// line ("Chapter 3", "Prologue") from prose: it returns null, or { bare }
// where bare is true when the line has no title of its own. A
// `preformatted` paragraph keeps the no-break spaces that open or end its
// lines, so an indented line keeps its indent.
export function paragraphBlocks(runs, level, quote, chapterLine, { preformatted = false } = {}) {
  const pieces = [[]];
  for (const run of runs) {
    const parts = run.text.replace(/\u00ad/g, "").split(PARAGRAPH_BREAK);
    parts.forEach((part, index) => {
      if (index > 0) {
        pieces.push([]);
      }
      pieces.at(-1).push({ ...run, text: part });
    });
  }
  return pieces.map((piece) => blockMarkdown(piece, level, quote && level === 0, chapterLine, false, preformatted)).filter((block) => block !== "");
}

// The bytes a block adds to the markdown: its own, and the blank line
// that parts it from the next.
export function blockBytes(block) {
  return Buffer.byteLength(block, "utf8") + 2;
}

// The error for markdown over `maxBytes`. Blocks of `size` (the sum of
// their blockBytes) come to size - 1 bytes of text, with its last line end.
export function checkMarkdownSize(size, maxBytes) {
  if (size > maxBytes + 1) {
    throw new ArchiveError(`its text comes to more than the ${maxBytes} byte limit as markdown; split it into several documents and import the folder`);
  }
}

// Markdown blocks as a reader writes them, held to `maxBytes` as markdown,
// so a file of tiny parts that make little text each cannot hold more in
// memory than the import would take.
export function markdownBlocks(maxBytes = Infinity) {
  const blocks = [];
  let size = 0;
  return {
    push(block) {
      checkMarkdownSize(size + blockBytes(block), maxBytes);
      size += blockBytes(block);
      blocks.push(block);
    },
    size() {
      return size;
    },
    text() {
      const text = blocks.join("\n\n");
      return text === "" ? "" : `${text}\n`;
    }
  };
}

// In a `verse` chapter (see isVerseChapter) every line break is kept, so a
// hard break needs no backslash, unless a blank line inside the paragraph
// would end it, or a line shaped like a scene break (`***`), which only a
// backslash at a line end keeps in the paragraph.
function blockMarkdown(runs, level, quote, chapterLine, verse = false, preformatted = false) {
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
  // A preformatted line keeps the no-break spaces that indent it (the
  // reader turns every space that opens a line into one), and loses only
  // the white space that ends it, which shows nothing.
  const trim = preformatted ? (line) => line.trimEnd() : (line) => line.trim();
  const kept = inlineMarkdown(runs).split(LINE_BREAK).map(trim).filter((line, index, all) => line !== "" || (index > 0 && index < all.length - 1));
  const plainBreaks = verse && !kept.some((line) => line === "" || isSceneBreakLine(line));
  const text = kept.join(plainBreaks ? "\n" : "\\\n");
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

import { isKebabId } from "./scan.js";

// Positions in a document's text, as the language server reads them: lines
// and columns count from 0, and a column counts UTF-16 code units, as LSP
// does by default and as a JavaScript string indexes its text.

export function textLines(text) {
  return text.split(/\r?\n/);
}

// The line of the `---` that closes the frontmatter, or -1 when the text
// opens with none (or never closes it): keys sit on the lines between.
export function frontmatterEnd(lines) {
  if (lines[0].replace(/^\uFEFF/, "").trim() !== "---") {
    return -1;
  }
  return lines.findIndex((line, index) => index > 0 && line.trim() === "---");
}

// A frontmatter line that sets a key, as a top-level entry (`pov: sera`) or
// a mapping list item (`  - character: sera`): its indent, and the key.
const KEY_LINE = /^(\s*)(-\s+)?([A-Za-z0-9_-]+):(?=\s|$)/;
const LIST_ITEM = /^(\s*)-(?:\s|$)/;
const WORD_CHARACTER = /[\p{L}\p{N}_-]/u;

// The key the value at `character` of frontmatter line `line` belongs to:
// the key on that line when the position is after its colon, else, for a
// plain list item, the key the list sits under. null anywhere else, the key
// names themselves included.
export function keyAt(lines, line, character) {
  const current = lines[line];
  const match = KEY_LINE.exec(current);
  if (match !== null) {
    return character > match[0].length - 1 ? match[3] : null;
  }
  const item = LIST_ITEM.exec(current);
  if (item === null) {
    return null;
  }
  const indent = item[1].length;
  for (let index = line - 1; index > 0; index -= 1) {
    const parent = KEY_LINE.exec(lines[index]);
    if (parent !== null && parent[2] === undefined && parent[1].length <= indent) {
      return parent[3];
    }
  }
  return null;
}

// The entity id under `character` on `lineText`: the run of letters,
// digits, `_`, and `-` around it, when that run is a kebab-case id. A link
// target such as `../characters/sera-voss.md` gives `sera-voss`.
export function idAt(lineText, character) {
  let start = character;
  while (start > 0 && WORD_CHARACTER.test(lineText[start - 1])) {
    start -= 1;
  }
  let end = character;
  while (end < lineText.length && WORD_CHARACTER.test(lineText[end])) {
    end += 1;
  }
  const text = lineText.slice(start, end);
  return isKebabId(text) ? { text, start, end } : null;
}

// The columns at which `token` stands alone on `lineText`: not part of a
// longer run of letters, digits, `_`, or `-`.
export function tokenColumns(lineText, token) {
  const columns = [];
  for (let column = lineText.indexOf(token); column !== -1; column = lineText.indexOf(token, column + 1)) {
    const before = lineText[column - 1];
    const after = lineText[column + token.length];
    if (!(before !== undefined && WORD_CHARACTER.test(before)) && !(after !== undefined && WORD_CHARACTER.test(after))) {
      columns.push(column);
    }
  }
  return columns;
}

// The key a frontmatter line sets, or null: `characters` for `characters:`
// and for `  - character: sera` alike.
export function lineKey(lineText) {
  return KEY_LINE.exec(lineText)?.[3] ?? null;
}

// The range of a whole line, from its first character that is not a space.
export function lineRange(lines, line) {
  const index = Math.min(Math.max(line, 0), lines.length - 1);
  const text = lines[index];
  return range(index, text.length - text.trimStart().length, index, text.length);
}

export function range(startLine, startCharacter, endLine = startLine, endCharacter = startCharacter) {
  return { start: { line: startLine, character: startCharacter }, end: { line: endLine, character: endCharacter } };
}

// The range that covers all of `text`, for an edit that replaces it.
export function wholeTextRange(text) {
  const lines = text.split("\n");
  return range(0, 0, lines.length - 1, lines[lines.length - 1].length);
}

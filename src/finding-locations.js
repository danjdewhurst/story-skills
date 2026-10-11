import { frontmatterEnd, lineKey, lineRange, range, textLines, tokenColumns } from "./lsp-text.js";

// Where in its file a finding points, for an editor to underline. Findings
// name a file, not a position, so the place is read from the message: the
// line a parse error gives, else the first thing the message names that the
// file holds, in the message's order. An id, path, or date (a word with a
// `-`, `/`, `.`, or a digit beside letters) is where it is written, in the
// frontmatter before the body; a plain word counts only as a frontmatter
// key, so prose in a message cannot land on prose in the file. A field path
// such as `knowledge-state[2]` is that list item, or the first thing the
// rest of the message names inside it. With none of these, the finding is
// about the file and points at its first line.

const LINE_NUMBER = /\(line (\d+)\)/;
// A path may open with `./` or `../` and hold backslashes, as the link a
// link-backslash error names does (`..\characters\sera.md`).
const MESSAGE_TOKEN = /(?:\.{1,2}[\\/])*[\p{L}\p{N}][\p{L}\p{N}_./\\-]*(?:\[\d+\])?/gu;
const FIELD_PATH = /^([A-Za-z0-9_-]+)\[(\d+)\]$/;
const SPECIFIC = /[-\d/.\\]/;
const NUMBER = /^\d+$/;
const LIST_ITEM = /^(\s*)-(?:\s|$)/;
// A command a message suggests (`run story reindex`, `story wordcount
// --write`), which names no place in the file.
const COMMAND_HINT = /\bstory [a-z-]+(?: --[a-z-]+)*/g;

export function findingRange(text, finding) {
  const lines = textLines(text);
  const message = findingMessage(finding);
  const line = LINE_NUMBER.exec(message);
  if (line !== null) {
    return lineRange(lines, Number(line[1]) - 1);
  }
  const end = frontmatterEnd(lines);
  const frontmatter = [...lines.keys()].filter((index) => index > 0 && index < end);
  const body = [...lines.keys()].filter((index) => !frontmatter.includes(index));
  const tokens = [...message.replace(COMMAND_HINT, " ").matchAll(MESSAGE_TOKEN)].map(([word]) => word.replace(/[./\\-]+$/, ""));
  for (const [index, token] of tokens.entries()) {
    const fieldPath = FIELD_PATH.exec(token);
    if (fieldPath !== null) {
      const item = listItem(lines, frontmatter, fieldPath[1], Number(fieldPath[2]));
      if (item !== null) {
        return tokens.slice(index + 1).map((later) => findIn(lines, item, later)).find((found) => found !== null) ?? lineRange(lines, item[0]);
      }
    } else {
      const found = findIn(lines, frontmatter, token) ?? (isSpecific(token) ? findIn(lines, body, token) : null);
      if (found !== null) {
        return found;
      }
    }
  }
  return lineRange(lines, 0);
}

// The message without the file label it opens with (`chapters/chapter-04.md
// lists ...`, `story.md: Unclosed ...`), since the editor shows the file.
export function findingMessage(finding) {
  const { message, file } = finding;
  if (file === null || !message.startsWith(file)) {
    return message;
  }
  const rest = message.slice(file.length).replace(/^:?\s+/, "");
  return rest === "" ? message : rest;
}

function isSpecific(token) {
  return SPECIFIC.test(token) && !NUMBER.test(token);
}

// The first of `indexes` (line numbers) where `token` is written: as a word
// standing alone, for a specific token, or as the key a line sets.
function findIn(lines, indexes, token) {
  for (const index of indexes) {
    const lineText = lines[index];
    if (isSpecific(token)) {
      const [column] = tokenColumns(lineText, token);
      if (column !== undefined) {
        return range(index, column, index, column + token.length);
      }
    } else if (lineKey(lineText) === token) {
      const column = lineText.indexOf(token);
      return range(index, column, index, column + token.length);
    }
  }
  return null;
}

// The lines of item `item` (from 0) of the list under top-level key `key`,
// or null when the frontmatter has no such item.
function listItem(lines, frontmatter, key, item) {
  const keyIndex = frontmatter.find((index) => !/^\s/.test(lines[index]) && lineKey(lines[index]) === key);
  if (keyIndex === undefined) {
    return null;
  }
  const items = [];
  let indent = null;
  for (const index of frontmatter.filter((line) => line > keyIndex)) {
    const match = LIST_ITEM.exec(lines[index]);
    // An unindented line that is not an item is the next key.
    if (match === null && /^\S/.test(lines[index])) {
      break;
    }
    indent ??= match?.[1].length ?? null;
    if (match !== null && match[1].length === indent) {
      items.push([index]);
    } else if (items.length > 0) {
      items[items.length - 1].push(index);
    }
  }
  return items[item] ?? null;
}

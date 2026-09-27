import { projectError } from "./exit-codes.js";

// The closing delimiter is a line holding only `---` (and trailing spaces), so
// `----` or `--- # end` never closes the block. The YAML source may be empty.
export const FRONTMATTER_PATTERN = /^(?:\uFEFF)?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

const OPENING_PATTERN = /^(?:\uFEFF)?---[ \t]*\r?\n/;

export function parseFrontmatter(markdown, filePath = "markdown") {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) {
    if (OPENING_PATTERN.test(markdown)) {
      throw projectError(`${filePath} has unclosed YAML frontmatter: add a line holding only --- after the last field`);
    }
    throw projectError(`${filePath} is missing YAML frontmatter`);
  }

  const raw = match[1] ?? "";
  return {
    data: parseYaml(raw),
    body: markdown.slice(match[0].length),
    raw
  };
}

export function stringifyFrontmatter(data) {
  const lines = ["---"];

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }

      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(...stringifyItem(key, item));
      }
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }

  // One blank line between the closing delimiter and the body. Two empty
  // strings are required: join places separators between elements, so the
  // last empty string does not add a trailing newline of its own.
  lines.push("---", "", "");
  return lines.join("\n");
}

// Rewrites only the frontmatter entries whose values changed. Unchanged
// entries, comment lines, blank lines, and list items that are still present
// keep their original text, so a rewrite does not reformat numbers or drop
// comments. The body after the closing delimiter is preserved byte for byte
// unless bodyOverride replaces it.
export function replaceFrontmatter(markdown, data, bodyOverride) {
  const match = FRONTMATTER_PARTS_PATTERN.exec(markdown);
  if (!match) {
    throw new Error("Cannot replace missing YAML frontmatter");
  }

  const [whole, opening, raw = "", separator, closingLine] = match;
  const eol = opening.endsWith("\r\n") ? "\r\n" : "\n";
  const closing = `${separator ?? eol}${closingLine}`;
  // Source lines keep a trailing "\r" when they end in CRLF, so untouched
  // lines keep their own line ending in a file that mixes LF and CRLF. The
  // last line's ending belongs to the closing delimiter; carry it over too.
  const crlfClose = closing.startsWith("\r");
  const { data: original, blocks } = parseYamlBlocks(raw !== "" && crlfClose ? `${raw}\r` : raw);
  const generatedEnd = eol === "\r\n" ? "\r" : "";
  const lines = [];
  const written = new Set();

  for (const block of blocks) {
    if (block.key === undefined) {
      lines.push(block.line);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(data, block.key)) {
      continue;
    }
    written.add(block.key);
    const value = data[block.key];
    if (isDeepEqual(original[block.key], value)) {
      lines.push(...block.lines);
    } else {
      lines.push(...stringifyEntry(block.key, value, block.items, generatedEnd));
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (!written.has(key)) {
      lines.push(...stringifyEntry(key, value, [], generatedEnd));
    }
  }

  const rest = bodyOverride === undefined ? markdown.slice(whole.length) : String(bodyOverride);
  if (lines.length === 0) {
    return `${opening}${separator ?? ""}${closingLine}${rest}`;
  }
  let body = lines.join("\n");
  if (crlfClose && body.endsWith("\r")) {
    body = body.slice(0, -1);
  }
  return `${opening}${body}${closing}${rest}`;
}

// Same shape as FRONTMATTER_PATTERN, split into the opening delimiter line,
// the YAML source, the newline before the closing delimiter, and the closing
// delimiter line.
const FRONTMATTER_PARTS_PATTERN = /^((?:\uFEFF)?---[ \t]*\r?\n)(?:([\s\S]*?)(\r?\n))?(---[ \t]*(?:\r?\n|$))/;

// Newly written lines end with lineEnd ("\r" in a CRLF file) before the "\n"
// join; reused source lines keep the ending they already have.
function stringifyEntry(key, value, originalItems = [], lineEnd = "") {
  if (!Array.isArray(value)) {
    return [`${key}: ${formatScalar(value)}${lineEnd}`];
  }
  if (value.length === 0) {
    return [`${key}: []${lineEnd}`];
  }

  const lines = [`${key}:${lineEnd}`];
  // Original items keyed by value, each key a queue in file order, so every
  // item keeps its original formatting in one pass over long lists.
  const unused = new Map();
  for (const candidate of originalItems) {
    const itemKey = valueKey(candidate.value);
    if (!unused.has(itemKey)) {
      unused.set(itemKey, { items: [], next: 0 });
    }
    unused.get(itemKey).items.push(candidate);
  }
  const reused = new Set();
  const matches = value.map((item) => {
    const queue = unused.get(valueKey(item));
    const reuse = queue?.items[queue.next];
    if (reuse && isDeepEqual(reuse.value, item)) {
      queue.next += 1;
      reused.add(reuse);
      return reuse;
    }
    return null;
  });
  value.forEach((item, index) => {
    if (matches[index]) {
      lines.push(...matches[index].lines);
      return;
    }
    // A changed mapping item (a rename touched one of its keys) keeps the
    // original text of every key whose value did not change, so `code: 0451`
    // is not rewritten as 451.
    const original = isPlainObject(item) ? originalItems.find((candidate) => !reused.has(candidate)
      && isPlainObject(candidate.value) && sameKeys(candidate.value, item) && candidate.lines.length === Object.keys(item).length) : undefined;
    const fresh = stringifyItem(key, item).map((line) => `${line}${lineEnd}`);
    if (!original) {
      lines.push(...fresh);
      return;
    }
    reused.add(original);
    Object.keys(item).forEach((childKey, childIndex) => {
      lines.push(isDeepEqual(original.value[childKey], item[childKey]) ? original.lines[childIndex] : fresh[childIndex]);
    });
  });
  return lines;
}

function sameKeys(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((childKey, index) => childKey === rightKeys[index]);
}

function stringifyItem(key, item) {
  if (!isPlainObject(item)) {
    return [`  - ${formatScalar(item)}`];
  }
  const entries = Object.entries(item);
  if (entries.length === 0) {
    throw new Error('Cannot stringify empty mapping in ' + key);
  }
  const [firstKey, firstValue] = entries[0];
  const lines = [`  - ${firstKey}: ${formatScalar(firstValue)}`];
  for (const [childKey, childValue] of entries.slice(1)) {
    lines.push(`    ${childKey}: ${formatScalar(childValue)}`);
  }
  return lines;
}

// A lookup key for a parsed value; isDeepEqual confirms each match.
function valueKey(value) {
  return JSON.stringify(value) ?? String(value);
}

function isDeepEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((entry, index) => isDeepEqual(entry, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && isDeepEqual(left[key], right[key]));
  }
  return false;
}

function parseYaml(source) {
  return parseYamlBlocks(source).data;
}

// Parses the supported YAML subset and records the source lines behind each
// top-level entry and list item, so replaceFrontmatter can keep them verbatim.
function parseYamlBlocks(source) {
  // rawLines keep a trailing "\r" from CRLF endings for verbatim rewrites;
  // lines drop it for parsing.
  const rawLines = source === "" ? [] : source.split("\n");
  const lines = rawLines.map((line) => line.replace(/\r$/, ""));
  const data = Object.create(null);
  const blocks = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      blocks.push({ line: rawLines[index] });
      index += 1;
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!pair) {
      throw projectError(`Unsupported frontmatter line: ${line}`);
    }

    const [, key, rest = ""] = pair;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      throw projectError(`Duplicate frontmatter key: ${key}`);
    }
    if (rest !== "") {
      data[key] = parseScalar(rest);
      blocks.push({ key, lines: [rawLines[index]], items: [] });
      index += 1;
      continue;
    }

    const parsed = parseArray(lines, index + 1);
    if (parsed.nextIndex === index + 1) {
      data[key] = "";
      blocks.push({ key, lines: [rawLines[index]], items: [] });
      index += 1;
      continue;
    }

    data[key] = parsed.items;
    blocks.push({
      key,
      lines: rawLines.slice(index, parsed.nextIndex),
      items: parsed.items.map((item, itemIndex) => ({
        value: toPlainObject(item),
        lines: rawLines.slice(parsed.starts[itemIndex], parsed.starts[itemIndex + 1] ?? parsed.nextIndex)
      }))
    });
    index = parsed.nextIndex;
  }

  return { data: toPlainObject(data), blocks };
}

function toPlainObject(value) {
  if (Array.isArray(value)) {
    return value.map(toPlainObject);
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "__proto__") {
        Object.defineProperty(out, key, {
          value: toPlainObject(entry),
          enumerable: true,
          configurable: true,
          writable: true
        });
      } else {
        out[key] = toPlainObject(entry);
      }
    }
    return out;
  }
  return value;
}

function parseArray(lines, startIndex) {
  const items = [];
  const starts = [];
  let index = startIndex;

  while (index < lines.length) {
    const itemMatch = /^  -(?:\s+(.*))?$/.exec(lines[index]);
    if (!itemMatch) {
      break;
    }

    starts.push(index);
    const itemText = itemMatch[1] ?? "";
    const objectMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(itemText);
    if (!objectMatch) {
      items.push(parseScalar(itemText));
      index += 1;
      continue;
    }

    const item = Object.create(null);
    item[objectMatch[1]] = parseScalar(objectMatch[2]);
    index += 1;

    while (index < lines.length) {
      const childMatch = /^    ([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[index]);
      if (!childMatch) {
        break;
      }

      if (Object.prototype.hasOwnProperty.call(item, childMatch[1])) {
        throw projectError(`Duplicate frontmatter key: ${childMatch[1]}`);
      }
      item[childMatch[1]] = parseScalar(childMatch[2]);
      index += 1;
    }

    items.push(item);
  }

  return { items, starts, nextIndex: index };
}

function parseScalar(value) {
  const trimmed = value.trim();

  if (trimmed === "[]") {
    return [];
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return Number.parseFloat(trimmed);
  }

  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    // formatScalar writes JSON strings, so unescape them; hand-written values
    // that are not valid JSON keep the historical quote-stripping behavior.
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function formatScalar(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    throw new Error("Cannot stringify a nested non-empty list");
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (needsQuotes(text)) {
    return JSON.stringify(text);
  }

  return text;
}

// A plain (unquoted) value must read back as the same string in any YAML
// parser, not only this one: quote values that YAML would read as a boolean,
// null, or number, or that start with a YAML indicator character. Bare dates
// stay unquoted: date fields are meant to read as dates.
function needsQuotes(text) {
  return text === ""
    || /^\s|\s$/.test(text)
    || /[:#"'\u0000-\u001f\u007f]/.test(text)
    || /^[-?,[\]{}&*!|>%@`]/.test(text)
    || /^(true|false|null|yes|no|on|off|~)$/i.test(text)
    || /^[-+]?(\d[\d_]*(\.[\d_]*)?|\.\d[\d_]*)([eE][-+]?\d+)?$/.test(text)
    || /^[-+]?0[xob][0-9a-f_]+$/i.test(text)
    || /^[-+]?\.(inf|nan)$/i.test(text);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const FRONTMATTER_BLOCK_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
// A YAML line: blank, a comment, a list item, an indented continuation, or a
// key with no spaces in it ("She said: go now." is prose, not a key).
const YAML_LINE_PATTERN = /^(?:\s*$|\s*#|\s*-\s|\s*-$|\s+\S|(?:[A-Za-z0-9_][A-Za-z0-9_.-]*|"[^"\n]*"|'[^'\n]*')[ \t]*:(?:\s|$))/;

// Removes leading YAML frontmatter, including YAML the strict parser rejects,
// such as nested maps from Pandoc or Obsidian. A leading `---` scene break is
// kept: a block that opens with a blank line, or has a line that is not YAML
// (a key with spaces, a sentence), is prose.
export function withoutLeadingFrontmatter(text) {
  const match = FRONTMATTER_BLOCK_PATTERN.exec(text);
  if (!match) {
    return text;
  }
  const lines = match[1].split(/\r?\n/);
  if (lines[0].trim() === "" || !lines.every((line) => YAML_LINE_PATTERN.test(line))) {
    return text;
  }
  return text.slice(match[0].length);
}

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
      lines.push(...stringifyEntry(block.key, value, block.items, generatedEnd, block.indent));
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
// join; reused source lines keep the ending they already have. New list items
// take the original list's indent, so they line up with the items they join.
function stringifyEntry(key, value, originalItems = [], lineEnd = "", indent = "  ") {
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
    // is not rewritten as 451. Only an item written one key per line, with
    // its keys where new lines put them, can mix old and new lines.
    const original = isPlainObject(item) ? originalItems.find((candidate) => !reused.has(candidate)
      && isPlainObject(candidate.value) && sameKeys(candidate.value, item) && candidate.lines.length === Object.keys(item).length
      && candidate.childIndent === indent.length + 2) : undefined;
    const fresh = stringifyItem(key, item, indent).map((line) => `${line}${lineEnd}`);
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

function stringifyItem(key, item, indent = "  ") {
  if (!isPlainObject(item)) {
    return [`${indent}- ${formatScalar(item)}`];
  }
  const entries = Object.entries(item);
  if (entries.length === 0) {
    throw new Error('Cannot stringify empty mapping in ' + key);
  }
  const [firstKey, firstValue] = entries[0];
  const lines = [`${indent}- ${firstKey}: ${formatScalar(firstValue)}`];
  for (const [childKey, childValue] of entries.slice(1)) {
    lines.push(`${indent}  ${childKey}: ${formatScalar(childValue)}`);
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

const KEY_PATTERN = /^([A-Za-z0-9_-]+):(.*)$/;
// A list item's first key needs a space after its colon, so `- https://x`
// stays a string, as in YAML.
const ITEM_KEY_PATTERN = /^([A-Za-z0-9_-]+):(\s.*)?$/;
const LIST_ITEM_PATTERN = /^( *)-(\s.*)?$/;
// `|` or `>`, then an optional chomping indicator and indentation digit in
// either order.
const BLOCK_HEADER_PATTERN = /^([|>])(?:([-+])([1-9])?|([1-9])([-+])?)?$/;

// Parses the supported YAML subset and records the source lines behind each
// top-level entry and list item, so replaceFrontmatter can keep them verbatim.
// firstLine is the file line number of the source's first line, for errors.
function parseYamlBlocks(source, firstLine = 2) {
  // rawLines keep a trailing "\r" from CRLF endings for verbatim rewrites;
  // lines drop it for parsing.
  const rawLines = source === "" ? [] : source.split("\n");
  const lines = rawLines.map((line) => line.replace(/\r$/, ""));
  const data = Object.create(null);
  const blocks = [];

  // Every parse error names the file line and says how to write it instead.
  const fail = (index, hint, problem = `Unsupported frontmatter line: ${lines[index].trim()}`) => {
    throw projectError(`${problem} (line ${index + firstLine}). ${hint}`);
  };

  const nextContent = (index) => {
    let next = index;
    while (next < lines.length && isBlankOrComment(lines[next])) {
      next += 1;
    }
    return next;
  };

  // The value after a key's colon or a list item's dash: a scalar, a flow
  // list, a block scalar header, or nothing.
  const inlineValue = (text, index) => {
    const value = withoutComment(text);
    if (value === "") {
      return { empty: true };
    }
    const first = value[0];
    if (first === "|" || first === ">") {
      const header = BLOCK_HEADER_PATTERN.exec(value);
      if (!header) {
        fail(index, `Quote a value that starts with ${first}, such as epigraph: "${first} text", or put ${first} alone after the colon and the text on indented lines below`);
      }
      return { header };
    }
    // `[TODO: author to supply]` is the publishing skill's placeholder, not
    // a list.
    if (first === "[" && !/^\[TODO\b/i.test(value)) {
      return { value: parseFlowList(value, index) };
    }
    if (first === "{") {
      fail(index, "Flow mappings are not supported. Quote the value, such as type: \"{family}\", or write a list of key: value items, such as relationships: then   - character: sera-voss on the next line");
    }
    if (first === "&" || first === "*" || first === "!") {
      fail(index, `Anchors, aliases, and tags are not supported. Quote the value, such as note: ${JSON.stringify(value)}`);
    }
    return { value: parseScalar(value) };
  };

  const parseFlowList = (value, index) => {
    if (!value.endsWith("]")) {
      fail(index, "Close the list with ], such as characters: [sera-voss, kael-voss], or quote a value that starts with [, such as note: \"[sic] text\"");
    }
    const end = value.length - 1;
    const items = [];
    let at = 1;
    for (;;) {
      while (at < end && /\s/.test(value[at])) {
        at += 1;
      }
      if (at >= end) {
        break;
      }
      let item;
      if (value[at] === '"' || value[at] === "'") {
        const close = quoteEnd(value, at);
        if (close < 0 || close >= end) {
          fail(index, "Close each quoted entry, such as characters: [\"Sera Voss\", kael-voss]");
        }
        item = value.slice(at, close + 1);
        at = close + 1;
        while (at < end && /\s/.test(value[at])) {
          at += 1;
        }
        if (at < end && value[at] !== ",") {
          fail(index, "Separate list entries with commas, such as characters: [\"Sera Voss\", kael-voss]");
        }
      } else {
        let stop = at;
        while (stop < end && value[stop] !== ",") {
          stop += 1;
        }
        item = value.slice(at, stop).trim();
        at = stop;
        if (item === "") {
          fail(index, "Remove the empty entry between two commas, such as characters: [sera-voss, kael-voss]");
        }
        if (/[[\]{}]/.test(item)) {
          fail(index, "Lists inside lists are not supported. Quote an entry that holds brackets or braces, such as tags: [\"[draft]\", final]");
        }
        if (/:(\s|$)/.test(item)) {
          fail(index, "Flow mappings are not supported. Quote an entry that holds a colon, such as tags: [\"note: draft\"]");
        }
      }
      items.push(parseScalar(item));
      if (value[at] === ",") {
        at += 1;
      }
    }
    return items;
  };

  // A `|` (literal) or `>` (folded) block scalar whose header is on line
  // index; its text is every following line indented past parentIndent.
  // end is the line after the last line of text, so trailing blank lines stay
  // between entries.
  const blockScalar = (header, index, parentIndent) => {
    const [, style, chompBefore, digitAfter, digitBefore, chompAfter] = header;
    const chomp = chompBefore ?? chompAfter ?? "";
    const digit = digitAfter ?? digitBefore;
    let blockIndent = digit ? parentIndent + Number(digit) : null;
    const text = [];
    let end = index + 1;
    let scan = index + 1;
    for (; scan < lines.length; scan += 1) {
      const line = lines[scan];
      if (line.trim() === "") {
        text.push("");
        continue;
      }
      const indent = /^ */.exec(line)[0].length;
      if (indent <= parentIndent) {
        break;
      }
      if (blockIndent === null) {
        blockIndent = indent;
      }
      if (indent < blockIndent) {
        fail(scan, "Indent every line of a block scalar at least as far as its first line");
      }
      text.push(line.slice(blockIndent));
      end = scan + 1;
    }
    const body = text.slice(0, end - index - 1);
    if (!body.some((line) => line !== "")) {
      return { value: "", end };
    }
    const joined = style === "|" ? body.join("\n") : foldLines(body);
    const trailing = chomp === "-" ? "" : chomp === "+" ? "\n".repeat(1 + text.length - body.length) : "\n";
    return { value: joined + trailing, end };
  };

  // A key's value starting on line index; returns the line after it.
  const readValue = (target, key, text, index, indent) => {
    const parsed = inlineValue(text, index);
    if (parsed.header) {
      const block = blockScalar(parsed.header, index, indent);
      target[key] = block.value;
      return block.end;
    }
    target[key] = parsed.empty ? "" : parsed.value;
    return index + 1;
  };

  // The hint for a line inside a list that is indented past its items.
  const nestedHint = (line) => {
    const text = line.trim();
    if (/^-(\s|$)/.test(text)) {
      return "Lists inside lists are not supported. Give each entry its own item, such as   - sera-voss, or write a flow list, such as   - [sera-voss, kael-voss]";
    }
    if (/^[A-Za-z0-9_-]+:(\s|$)/.test(text)) {
      return "Line up every key of a list item under its first key, such as   - character: sera-voss then     type: sibling. Deeper nesting is not supported";
    }
    return "Write a value that runs over several lines as a block scalar, such as   - | then the text on lines indented past the dash";
  };

  const parseList = (start, indent) => {
    const items = [];
    const starts = [];
    const childIndents = [];
    let index = start;
    while (index < lines.length) {
      if (isBlankOrComment(lines[index])) {
        // A blank or comment line belongs to the list when another item of
        // the same list follows it.
        const next = nextContent(index);
        const following = next < lines.length ? LIST_ITEM_PATTERN.exec(lines[next]) : null;
        if (following && following[1].length === indent) {
          index = next;
          continue;
        }
        break;
      }
      const match = LIST_ITEM_PATTERN.exec(lines[index]);
      if (!match || match[1].length !== indent) {
        if (/^ */.exec(lines[index])[0].length > indent) {
          fail(index, nestedHint(lines[index]));
        }
        break;
      }

      starts.push(index);
      const rest = match[2] ?? "";
      const itemText = rest.trimStart();
      const childIndent = indent + 1 + rest.length - itemText.length;
      childIndents.push(childIndent);
      const objectMatch = ITEM_KEY_PATTERN.exec(itemText);
      if (!objectMatch) {
        if (/^-(\s|$)/.test(itemText)) {
          fail(index, nestedHint(itemText));
        }
        const holder = Object.create(null);
        index = readValue(holder, "item", rest, index, indent);
        items.push(holder.item);
        continue;
      }

      const item = Object.create(null);
      index = readValue(item, objectMatch[1], objectMatch[2] ?? "", index, childIndent);
      const childPattern = new RegExp(`^ {${childIndent}}([A-Za-z0-9_-]+):(.*)$`);
      while (index < lines.length) {
        const next = nextContent(index);
        const child = next < lines.length ? childPattern.exec(lines[next]) : null;
        if (!child) {
          break;
        }
        index = next;
        if (Object.prototype.hasOwnProperty.call(item, child[1])) {
          fail(index, "Remove or rename one of the two keys in this list item", `Duplicate frontmatter key: ${child[1]}`);
        }
        index = readValue(item, child[1], child[2], index, childIndent);
      }
      items.push(item);
    }
    return { items, starts, childIndents, nextIndex: index };
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (isBlankOrComment(line)) {
      blocks.push({ line: rawLines[index] });
      index += 1;
      continue;
    }

    const pair = KEY_PATTERN.exec(line);
    if (!pair) {
      fail(index, topLevelHint(line));
    }

    const [, key, after] = pair;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      fail(index, "Remove or rename one of the two entries", `Duplicate frontmatter key: ${key}`);
    }
    const parsed = inlineValue(after, index);
    if (parsed.header) {
      const block = blockScalar(parsed.header, index, 0);
      data[key] = block.value;
      blocks.push({ key, lines: rawLines.slice(index, block.end), items: [] });
      index = block.end;
      continue;
    }
    if (!parsed.empty) {
      data[key] = parsed.value;
      blocks.push({ key, lines: [rawLines[index]], items: [] });
      index += 1;
      continue;
    }

    // An empty value opens a block list when list items follow, indented or
    // not; otherwise it is an empty string.
    const next = nextContent(index + 1);
    const first = next < lines.length ? LIST_ITEM_PATTERN.exec(lines[next]) : null;
    if (!first) {
      data[key] = "";
      blocks.push({ key, lines: [rawLines[index]], items: [] });
      index += 1;
      continue;
    }

    const indent = first[1].length;
    const list = parseList(next, indent);
    data[key] = list.items;
    blocks.push({
      key,
      lines: rawLines.slice(index, list.nextIndex),
      indent: " ".repeat(indent),
      items: list.items.map((item, itemIndex) => ({
        value: toPlainObject(item),
        childIndent: list.childIndents[itemIndex],
        lines: rawLines.slice(list.starts[itemIndex], list.starts[itemIndex + 1] ?? list.nextIndex)
      }))
    });
    index = list.nextIndex;
  }

  return { data: toPlainObject(data), blocks };
}

function isBlankOrComment(line) {
  const text = line.trimStart();
  return text === "" || text.startsWith("#");
}

function topLevelHint(line) {
  const text = line.trim();
  if (/^\s/.test(line)) {
    if (/^-(\s|$)/.test(text)) {
      return "Indent every item of a list the same amount, directly under its key, such as themes: then   - loyalty";
    }
    if (/^[A-Za-z0-9_-]+:(\s|$)/.test(text)) {
      return "Nested fields are not supported. Write a list of key: value items, such as relationships: then   - character: sera-voss";
    }
    return "Write a value that runs over several lines as a block scalar, such as summary: | then the text on indented lines";
  }
  if (/^-(\s|$)/.test(text)) {
    return "Put list items under a key, such as characters: then - sera-voss";
  }
  return "Write each field as key: value, with a key of letters, digits, - and _, such as title: The Bell";
}

// The value text without a trailing comment. A comment starts at a `#` with
// whitespace before it; a `#` inside quotes or a quoted flow list entry, or
// straight after other text (`#1`, `C#`), is part of the value.
function withoutComment(text) {
  const value = text.trimStart();
  let close = -1;
  if (value[0] === '"' || value[0] === "'") {
    close = quoteEnd(value, 0);
  } else if (value[0] === "[") {
    close = flowListEnd(value);
  }
  if (close >= 0 && /^(?:\s+#.*|\s*)$/.test(value.slice(close + 1))) {
    return value.slice(0, close + 1);
  }
  const comment = /\s#/.exec(text);
  return (comment ? text.slice(0, comment.index) : text).trim();
}

// The index of the quote that closes the one at start, or -1. Double quotes
// take backslash escapes; single quotes escape themselves as ''.
function quoteEnd(text, start) {
  const quote = text[start];
  for (let at = start + 1; at < text.length; at += 1) {
    if (quote === '"' && text[at] === "\\") {
      at += 1;
    } else if (text[at] === quote) {
      if (quote === "'" && text[at + 1] === "'") {
        at += 1;
      } else {
        return at;
      }
    }
  }
  return -1;
}

// The index of the `]` that closes a flow list, skipping quoted entries, or -1.
function flowListEnd(text) {
  let entryStart = true;
  for (let at = 1; at < text.length; at += 1) {
    const char = text[at];
    if (char === "]") {
      return at;
    }
    if (char === ",") {
      entryStart = true;
      continue;
    }
    if (/\s/.test(char)) {
      continue;
    }
    if (entryStart && (char === '"' || char === "'")) {
      at = quoteEnd(text, at);
      if (at < 0) {
        return -1;
      }
    }
    entryStart = false;
  }
  return -1;
}

// Folds the lines of a `>` block scalar as YAML does: a single line break
// between two lines of text becomes a space, each blank line becomes a line
// break, and lines indented past the block keep their breaks.
function foldLines(lines) {
  let out = "";
  let previous = null;
  let blanks = 0;
  for (const line of lines) {
    if (line === "") {
      blanks += 1;
      continue;
    }
    const indented = /^\s/.test(line);
    if (previous === null) {
      out += "\n".repeat(blanks);
    } else if (previous === "text" && !indented) {
      out += blanks === 0 ? " " : "\n".repeat(blanks);
    } else {
      out += "\n".repeat(blanks + 1);
    }
    out += line;
    previous = indented ? "indented" : "text";
    blanks = 0;
  }
  return out;
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

function parseScalar(value) {
  const trimmed = value.trim();

  // A null is read as an empty value, like a key with nothing after it.
  if (/^(?:~|null|Null|NULL)$/.test(trimmed)) {
    return "";
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
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  return trimmed;
}

function formatScalar(value) {
  // A list inside a list item is written as a flow list.
  if (Array.isArray(value)) {
    return `[${value.map(formatFlowEntry).join(", ")}]`;
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

function formatFlowEntry(value) {
  if (Array.isArray(value) || isPlainObject(value)) {
    throw new Error("Cannot stringify a list or mapping inside a nested list");
  }
  const text = formatScalar(value);
  // An empty entry is dropped by the parser, and a comma or bracket would
  // split or end the list.
  return text === "" || (typeof value === "string" && /[,[\]{}]/.test(text) && !text.startsWith('"')) ? JSON.stringify(String(value ?? "")) : text;
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

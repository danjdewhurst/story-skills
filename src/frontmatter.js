import { projectError } from "./exit-codes.js";

// The closing delimiter is a line holding only `---` (and trailing spaces), so
// `----` or `--- # end` never closes the block. The YAML source may be empty.
export const FRONTMATTER_PATTERN = /^(?:\uFEFF)?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

const OPENING_PATTERN = /^(?:\uFEFF)?---[ \t]*\r?\n/;

export function parseFrontmatter(markdown, filePath = "markdown") {
  const match = FRONTMATTER_PARTS_PATTERN.exec(markdown);
  if (!match) {
    if (OPENING_PATTERN.test(markdown)) {
      throw projectError(`${filePath} has unclosed YAML frontmatter: add a line holding only --- after the last field`);
    }
    throw projectError(`${filePath} is missing YAML frontmatter`);
  }

  const [whole, , raw = "", separator] = match;
  return {
    data: parseYamlBlocks(yamlSource(raw, separator)).data,
    body: markdown.slice(whole.length),
    raw
  };
}

// The text a top-level scalar was written as, such as True or 007, or
// undefined, so a message can show the value as the file spells it.
export function scalarText(data, key) {
  return data?.[SCALAR_TEXT]?.[key];
}

const SCALAR_TEXT = Symbol("scalarText");

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
  // lines keep their own line ending in a file that mixes LF and CRLF.
  const crlfClose = closing.startsWith("\r");
  const { data: original, blocks } = parseYamlBlocks(yamlSource(raw, separator));
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
      lines.push(...stringifyEntry(block.key, value, block, generatedEnd));
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (!written.has(key)) {
      lines.push(...stringifyEntry(key, value, undefined, generatedEnd));
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

// The YAML source as parseYamlBlocks reads it. The last line's ending belongs
// to the closing delimiter, so a CRLF there gives the line its "\r" back, as
// every other CRLF line has; a carriage return left before it is then stray.
function yamlSource(raw, separator) {
  return raw !== "" && separator === "\r\n" ? `${raw}\r` : raw;
}

// Newly written lines end with lineEnd ("\r" in a CRLF file) before the "\n"
// join; reused source lines keep the ending they already have. original is
// the entry's parsed block: its list items, the indent they share, the blank
// and comment lines before its first item, the trailing comment on its key
// line, and for a flow list its entries. New items take that indent, so they
// line up with the items they join, and the blank and comment lines inside
// the list stay where they were. A flow list of scalars stays a flow list.
function stringifyEntry(key, value, original = {}, lineEnd = "") {
  if (!Array.isArray(value) || value.length === 0 || (original.flow && !value.some(isNested))) {
    return [`${key}: ${inlineText(value, original)}${lineEnd}`];
  }

  const originalItems = original.items ?? [];
  const indent = original.indent ?? "  ";
  const lines = [`${key}:${original.comment ?? ""}${lineEnd}`, ...(original.leading ?? [])];
  // Every item still in the list keeps its original formatting.
  const take = unusedByValue(originalItems);
  const reused = new Set();
  const matches = value.map((item) => {
    const reuse = take(item);
    if (reuse) {
      reused.add(reuse);
    }
    return reuse;
  });
  value.forEach((item, index) => {
    if (matches[index]) {
      lines.push(...matches[index].before, ...matches[index].lines);
      return;
    }
    // A changed mapping item (a rename touched one of its keys) keeps the
    // original text of every key whose value did not change, so `code: 0451`
    // is not rewritten as 451, and the trailing comment of every key that
    // did. Only an item whose keys sit where new lines put them can mix old
    // and new lines.
    const partial = isPlainObject(item) ? originalItems.find((candidate) => !reused.has(candidate)
      && isPlainObject(candidate.value) && sameKeys(candidate.value, item)
      && candidate.childIndent === indent.length + 2) : undefined;
    if (partial) {
      reused.add(partial);
      lines.push(...partial.before);
      const fresh = stringifyItem(key, item, indent, partial);
      Object.keys(item).forEach((childKey, childIndex) => {
        const source = partial.keyLines[childIndex];
        lines.push(...source.before);
        lines.push(...(isDeepEqual(partial.value[childKey], item[childKey]) ? source.lines : [`${fresh[childIndex]}${lineEnd}`]));
      });
      return;
    }
    // A replaced item keeps the comment lines above the item it replaces,
    // and its trailing comments.
    const positional = originalItems[index];
    let replaced;
    if (positional && !reused.has(positional)) {
      reused.add(positional);
      lines.push(...positional.before);
      replaced = positional;
    }
    lines.push(...stringifyItem(key, item, indent, replaced).map((line) => `${line}${lineEnd}`));
  });
  return lines;
}

// A changed value written on one line, keeping the trailing comment of the
// line it replaces and, for a flow list, the text of each entry still in it.
function inlineText(value, source = {}) {
  const text = source.flow && Array.isArray(value) ? flowText(value, source.flow) : formatScalar(value);
  return `${text}${source.comment ?? ""}`;
}

function flowText(value, entries) {
  const take = unusedByValue(entries);
  return flowList(value, (item) => take(item)?.text ?? formatFlowEntry(item));
}

// A flow list of value's entries, each written by textOf. A list whose first
// entry starts with the word TODO would read as the `[TODO ...]` placeholder
// text, so that entry is quoted.
function flowList(value, textOf) {
  const texts = value.map(textOf);
  if (/^TODO\b/i.test(texts[0] ?? "")) {
    texts[0] = quote(String(value[0]));
  }
  return `[${texts.join(", ")}]`;
}

// Takes, for each value asked for, the next unused entry ({ value }) equal to
// it in file order, or undefined. Entries are queued by value, so a long list
// is matched in one pass.
function unusedByValue(entries) {
  const queues = new Map();
  for (const entry of entries) {
    const entryKey = valueKey(entry.value);
    if (!queues.has(entryKey)) {
      queues.set(entryKey, { entries: [], next: 0 });
    }
    queues.get(entryKey).entries.push(entry);
  }
  return (value) => {
    const queue = queues.get(valueKey(value));
    const entry = queue?.entries[queue.next];
    if (entry && isDeepEqual(entry.value, value)) {
      queue.next += 1;
      return entry;
    }
    return undefined;
  };
}

function isNested(value) {
  return Array.isArray(value) || isPlainObject(value);
}

function sameKeys(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((childKey, index) => childKey === rightKeys[index]);
}

// original is the parsed item this one replaces, if any: a scalar item keeps
// a scalar item's trailing comment, and each key of a mapping item keeps the
// comment of the same key. A comment whose key is gone is dropped.
function stringifyItem(key, item, indent = "  ", original = {}) {
  if (!isPlainObject(item)) {
    return [`${indent}- ${inlineText(item, original.keyLines ? undefined : original)}`];
  }
  const entries = Object.entries(item);
  if (entries.length === 0) {
    throw new Error('Cannot stringify empty mapping in ' + key);
  }
  const keyed = new Map((original.keyLines ?? []).map((source) => [source.key, source]));
  return entries.map(([childKey, childValue], index) => `${indent}${index === 0 ? "- " : "  "}${childKey}: ${inlineText(childValue, keyed.get(childKey))}`);
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

// Values match [^\r], not `.`: YAML 1.2 reads U+2028 and U+2029 as ordinary
// characters, and a line holds no carriage return by the time it is matched.
// Only a space or tab separates, as in YAML; JavaScript's \s and trim() also
// take U+2028, U+2029, no-break spaces, and a byte order mark, which are text.
const KEY_PATTERN = /^([A-Za-z0-9_-]+):([^\r]*)$/;
// A list item's first key needs a space after its colon, so `- https://x`
// stays a string, as in YAML.
const ITEM_KEY_PATTERN = /^([A-Za-z0-9_-]+):([ \t][^\r]*)?$/;
const LIST_ITEM_PATTERN = /^( *)-([ \t][^\r]*)?$/;
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
  const texts = Object.create(null);
  const blocks = [];

  // Every parse error names the file line and says how to write it instead.
  const fail = (index, hint, problem = `Unsupported frontmatter line: ${lines[index].trim()}`) => {
    throw projectError(`${problem} (line ${index + firstLine}). ${hint}`);
  };

  // YAML reads a carriage return with no line feed after it as a line break,
  // which would split the line it sits in.
  const strayReturn = lines.findIndex((line) => line.includes("\r"));
  if (strayReturn >= 0) {
    fail(strayReturn, 'Remove it, or write it as \\r inside a double-quoted value, such as note: "a\\rb"', "Unsupported line break: a carriage return with no line feed after it");
  }

  const nextContent = (index) => {
    let next = index;
    while (next < lines.length && isBlankOrComment(lines[next])) {
      next += 1;
    }
    return next;
  };

  // The value after a key's colon or a list item's dash: a scalar, a flow
  // list, a block scalar header, or nothing. comment is the line's trailing
  // comment, and flow a non-empty flow list's entries, for rewrites.
  const inlineValue = (text, index) => {
    const { value, comment } = splitComment(text);
    if (value === "") {
      return { empty: true, comment };
    }
    const first = value[0];
    if (first === "|" || first === ">") {
      const header = BLOCK_HEADER_PATTERN.exec(value);
      if (!header) {
        fail(index, `Quote a value that starts with ${first}, such as epigraph: "${first} text", or put ${first} alone after the colon and the text on indented lines below`);
      }
      return { header, comment };
    }
    // `[TODO: author to supply]` is the publishing skill's placeholder, not
    // a list.
    if (first === "[" && !/^\[TODO\b/i.test(value)) {
      const entries = parseFlowList(value, index);
      // An empty `[]` has no style to keep: items added to it make a block list.
      return { value: entries.map((entry) => entry.value), flow: entries.length > 0 ? entries : undefined, comment };
    }
    if (first === "{") {
      fail(index, "Flow mappings are not supported. Quote the value, such as type: \"{family}\", or write a list of key: value items, such as relationships: then   - character: sera-voss on the next line");
    }
    if (first === "&" || first === "*" || first === "!") {
      fail(index, `Anchors, aliases, and tags are not supported. Quote the value, such as note: ${JSON.stringify(value)}`);
    }
    return { value: parseScalar(value), text: value, comment };
  };

  const parseFlowList = (value, index) => {
    if (!value.endsWith("]")) {
      fail(index, "Close the list with ], such as characters: [sera-voss, kael-voss], or quote a value that starts with [, such as note: \"[sic] text\"");
    }
    const end = value.length - 1;
    const items = [];
    let at = 1;
    for (;;) {
      while (at < end && isSpace(value[at])) {
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
        while (at < end && isSpace(value[at])) {
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
        item = trimSpaces(value.slice(at, stop));
        at = stop;
        if (item === "") {
          fail(index, "Remove the empty entry between two commas, such as characters: [sera-voss, kael-voss]");
        }
        if (/[[\]{}]/.test(item)) {
          fail(index, "Lists inside lists are not supported. Quote an entry that holds brackets or braces, such as tags: [\"[draft]\", final]");
        }
        if (/:([ \t]|$)/.test(item)) {
          fail(index, "Flow mappings are not supported. Quote an entry that holds a colon, such as tags: [\"note: draft\"]");
        }
        if (/^[&*!]/.test(item)) {
          fail(index, `Anchors, aliases, and tags are not supported. Quote the entry, such as tags: [${JSON.stringify(item)}]`);
        }
      }
      items.push({ value: parseScalar(item), text: item });
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
    if (body.length === 0) {
      // Only blank lines: keep chomping keeps one line break for each.
      return { value: chomp === "+" ? "\n".repeat(text.length) : "", end };
    }
    const joined = style === "|" ? body.join("\n") : foldLines(body);
    const trailing = chomp === "-" ? "" : chomp === "+" ? "\n".repeat(1 + text.length - body.length) : "\n";
    return { value: joined + trailing, end };
  };

  // A key's value starting on line index; returns the line after it, and the
  // first line's trailing comment and flow list entries.
  const readValue = (target, key, text, index, indent) => {
    const parsed = inlineValue(text, index);
    const source = { end: index + 1, comment: parsed.comment, flow: parsed.flow };
    if (parsed.header) {
      const block = blockScalar(parsed.header, index, indent);
      target[key] = block.value;
      source.end = block.end;
    } else {
      target[key] = parsed.empty ? "" : parsed.value;
    }
    return source;
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

  // A block list whose first line (an item, or a blank or comment line
  // before one) is start. Each item records the blank and comment lines
  // before it, its own lines, and for a mapping, each key's lines.
  const parseList = (start, indent) => {
    const items = [];
    const sources = [];
    let index = start;
    let gap = start;
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

      const itemStart = index;
      const before = rawLines.slice(gap, itemStart);
      const rest = match[2] ?? "";
      const itemText = trimSpaces(rest);
      const childIndent = indent + 1 + rest.length - itemText.length;
      const objectMatch = ITEM_KEY_PATTERN.exec(itemText);
      if (!objectMatch) {
        if (/^-([ \t]|$)/.test(itemText)) {
          fail(index, nestedHint(itemText));
        }
        const holder = Object.create(null);
        const { end, comment, flow } = readValue(holder, "item", rest, index, indent);
        index = end;
        items.push(holder.item);
        sources.push({ before, lines: rawLines.slice(itemStart, index), childIndent, comment, flow });
        gap = index;
        continue;
      }

      const item = Object.create(null);
      const { end, comment, flow } = readValue(item, objectMatch[1], objectMatch[2] ?? "", index, childIndent);
      index = end;
      const keyLines = [{ key: objectMatch[1], before: [], lines: rawLines.slice(itemStart, index), comment, flow }];
      const childPattern = new RegExp(`^ {${childIndent}}([A-Za-z0-9_-]+):([^\\r]*)$`);
      while (index < lines.length) {
        const next = nextContent(index);
        const child = next < lines.length ? childPattern.exec(lines[next]) : null;
        if (!child) {
          break;
        }
        if (Object.prototype.hasOwnProperty.call(item, child[1])) {
          fail(next, "Remove or rename one of the two keys in this list item", `Duplicate frontmatter key: ${child[1]}`);
        }
        const keyGap = index;
        const source = readValue(item, child[1], child[2], next, childIndent);
        index = source.end;
        keyLines.push({ key: child[1], before: rawLines.slice(keyGap, next), lines: rawLines.slice(next, index), comment: source.comment, flow: source.flow });
      }
      items.push(item);
      sources.push({ before, lines: rawLines.slice(itemStart, index), childIndent, keyLines });
      gap = index;
    }
    return { items, sources, nextIndex: index };
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
    const { comment } = parsed;
    if (parsed.header) {
      const block = blockScalar(parsed.header, index, 0);
      data[key] = block.value;
      blocks.push({ key, lines: rawLines.slice(index, block.end), items: [], comment });
      index = block.end;
      continue;
    }
    if (!parsed.empty) {
      data[key] = parsed.value;
      if (parsed.text !== undefined) {
        texts[key] = parsed.text;
      }
      blocks.push({ key, lines: [rawLines[index]], items: [], comment, flow: parsed.flow });
      index += 1;
      continue;
    }

    // An empty value opens a block list when list items follow, indented or
    // not; otherwise it is an empty string.
    const next = nextContent(index + 1);
    const first = next < lines.length ? LIST_ITEM_PATTERN.exec(lines[next]) : null;
    if (!first) {
      data[key] = "";
      blocks.push({ key, lines: [rawLines[index]], items: [], comment });
      index += 1;
      continue;
    }

    const list = parseList(index + 1, first[1].length);
    data[key] = list.items;
    // The lines between the key and its first item belong to the list, not
    // to whichever item comes first.
    const leading = list.sources[0].before;
    list.sources[0].before = [];
    blocks.push({
      key,
      lines: rawLines.slice(index, list.nextIndex),
      indent: first[1],
      leading,
      comment,
      items: list.items.map((item, itemIndex) => ({ value: toPlainObject(item), ...list.sources[itemIndex] }))
    });
    index = list.nextIndex;
  }

  // Not enumerable, so the data compares and serializes as before.
  const plain = toPlainObject(data);
  Object.defineProperty(plain, SCALAR_TEXT, { value: texts });
  return { data: plain, blocks };
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

// The value text, and its trailing comment with the spaces before it (or ""),
// so a rewrite can keep the comment. A comment starts at a `#` with a space
// or tab before it; a `#` inside quotes or a quoted flow list entry, or
// straight after other text (`#1`, `C#`, or a no-break space), is part of
// the value.
function splitComment(text) {
  const value = trimSpaces(text);
  let close = -1;
  if (value[0] === '"' || value[0] === "'") {
    close = quoteEnd(value, 0);
  } else if (value[0] === "[") {
    close = flowListEnd(value);
  }
  const rest = value.slice(close + 1);
  if (close >= 0 && (rest === "" || /^[ \t]+#/.test(rest))) {
    return { value: value.slice(0, close + 1), comment: rest };
  }
  const hash = /[ \t]#/.exec(text);
  if (!hash) {
    return { value, comment: "" };
  }
  // The comment takes every space and tab before its #, found by stepping
  // back once, so a long run of spaces costs linear time.
  let start = hash.index;
  while (start > 0 && isSpace(text[start - 1])) {
    start -= 1;
  }
  return { value: trimSpaces(text.slice(0, start)), comment: text.slice(start) };
}

function isSpace(char) {
  return char === " " || char === "\t";
}

function trimSpaces(text) {
  let start = 0;
  let end = text.length;
  while (start < end && isSpace(text[start])) {
    start += 1;
  }
  while (end > start && isSpace(text[end - 1])) {
    end -= 1;
  }
  return text.slice(start, end);
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
    // A comment hides the rest of the line, closing bracket included.
    if (char === "#" && isSpace(text[at - 1])) {
      return -1;
    }
    if (char === ",") {
      entryStart = true;
      continue;
    }
    if (isSpace(char)) {
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
    const indented = isSpace(line[0]);
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
  const trimmed = trimSpaces(value);

  // A null is read as an empty value, like a key with nothing after it.
  if (/^(?:~|null|Null|NULL)$/.test(trimmed)) {
    return "";
  }

  // The three spellings YAML 1.2's core schema reads as booleans. `yes`, `no`,
  // `on`, and `off` are YAML 1.1 booleans and stay text.
  if (/^(?:true|True|TRUE)$/.test(trimmed)) {
    return true;
  }

  if (/^(?:false|False|FALSE)$/.test(trimmed)) {
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
    return flowList(value, formatFlowEntry);
  }

  if (typeof value === "number") {
    return formatNumber(value);
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (needsQuotes(text)) {
    return quote(text);
  }

  return text;
}

// A number in plain decimal notation, which the parser reads back as the
// same number: String() writes 1e21 as 1e+21, which reads as text, so it is
// written 1000000000000000000000, and 1.5e-7 as 0.00000015.
function formatNumber(value) {
  const match = /^(-?)(\d)(?:\.(\d+))?e([-+]\d+)$/.exec(String(value));
  if (!match) {
    return String(value);
  }
  const [, sign, lead, rest = "", exponent] = match;
  const digits = `${lead}${rest}`;
  const shift = Number(exponent);
  // String() uses an exponent only from 1e21 up and below 1e-6, so the
  // decimal point moves past the last digit or before the first.
  return shift > 0
    ? `${sign}${digits}${"0".repeat(shift + 1 - digits.length)}`
    : `${sign}0.${"0".repeat(-shift - 1)}${digits}`;
}

// Characters JSON.stringify leaves raw that YAML does not allow unescaped
// (DEL, C1 controls, a byte order mark, noncharacters) or that a YAML 1.1
// parser and JavaScript's `.` read as a line break (U+0085, U+2028, U+2029).
// JSON.stringify already escapes the C0 controls, carriage return included.
const UNESCAPED_PATTERN = /[\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/g;

// A double-quoted string that this parser and other YAML parsers read back
// as the same text, on one line.
function quote(text) {
  return JSON.stringify(text).replace(UNESCAPED_PATTERN, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function formatFlowEntry(value) {
  if (Array.isArray(value) || isPlainObject(value)) {
    throw new Error("Cannot stringify a list or mapping inside a nested list");
  }
  const text = formatScalar(value);
  // An empty entry is dropped by the parser, and a comma or bracket would
  // split or end the list.
  return text === "" || (typeof value === "string" && /[,[\]{}]/.test(text) && !text.startsWith('"')) ? quote(String(value ?? "")) : text;
}

// A plain (unquoted) value must read back as the same string in any YAML
// parser, not only this one: quote values that YAML would read as a boolean,
// null, or number, that start with a YAML indicator character, or that hold
// a character quote() escapes. Bare dates stay unquoted: date fields are
// meant to read as dates.
function needsQuotes(text) {
  return text === ""
    || /^\s|\s$/.test(text)
    || /[:#"'\u0000-\u001f]/.test(text)
    || text.search(UNESCAPED_PATTERN) >= 0
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

export const FRONTMATTER_PATTERN = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export function parseFrontmatter(markdown, filePath = "markdown") {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) {
    throw new Error(`${filePath} is missing YAML frontmatter`);
  }

  return {
    data: parseYaml(match[1]),
    body: markdown.slice(match[0].length),
    raw: match[1]
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

  const [whole, opening, raw, closing] = match;
  const eol = opening.endsWith("\r\n") ? "\r\n" : "\n";
  const { data: original, blocks } = parseYamlBlocks(raw);
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
      lines.push(...stringifyEntry(block.key, value, block.items));
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (!written.has(key)) {
      lines.push(...stringifyEntry(key, value));
    }
  }

  const body = lines.length > 0 ? `${lines.join(eol)}` : "";
  const rest = bodyOverride === undefined ? markdown.slice(whole.length) : String(bodyOverride);
  return `${opening}${body}${closing}${rest}`;
}

// Same shape as FRONTMATTER_PATTERN, split into the opening delimiter line,
// the YAML source, and the closing delimiter (with its surrounding newlines).
const FRONTMATTER_PARTS_PATTERN = /^((?:\uFEFF)?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n)?)/;

function stringifyEntry(key, value, originalItems = []) {
  if (!Array.isArray(value)) {
    return [`${key}: ${formatScalar(value)}`];
  }
  if (value.length === 0) {
    return [`${key}: []`];
  }

  const lines = [`${key}:`];
  const unused = originalItems.slice();
  for (const item of value) {
    const reuse = unused.findIndex((candidate) => isDeepEqual(candidate.value, item));
    if (reuse !== -1) {
      lines.push(...unused[reuse].lines);
      unused.splice(reuse, 1);
    } else {
      lines.push(...stringifyItem(key, item));
    }
  }
  return lines;
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
  const lines = source === "" ? [] : source.split(/\r?\n/);
  const data = Object.create(null);
  const blocks = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      blocks.push({ line });
      index += 1;
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!pair) {
      throw new Error(`Unsupported frontmatter line: ${line}`);
    }

    const [, key, rest = ""] = pair;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      throw new Error(`Duplicate frontmatter key: ${key}`);
    }
    if (rest !== "") {
      data[key] = parseScalar(rest);
      blocks.push({ key, lines: [line], items: [] });
      index += 1;
      continue;
    }

    const parsed = parseArray(lines, index + 1);
    if (parsed.nextIndex === index + 1) {
      data[key] = "";
      blocks.push({ key, lines: [line], items: [] });
      index += 1;
      continue;
    }

    data[key] = parsed.items;
    blocks.push({
      key,
      lines: lines.slice(index, parsed.nextIndex),
      items: parsed.items.map((item, itemIndex) => ({
        value: toPlainObject(item),
        lines: lines.slice(parsed.starts[itemIndex], parsed.starts[itemIndex + 1] ?? parsed.nextIndex)
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
        throw new Error(`Duplicate frontmatter key: ${childMatch[1]}`);
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
  if (text === '' || text === '[]' || /^(true|false|null|-?\d+(\.\d+)?)$/.test(text) || /^\s|\s$/.test(text) || /[:#\n"']/.test(text)) {
    return JSON.stringify(text);
  }

  return text;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

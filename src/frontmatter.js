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

export function stringifyFrontmatter(data, decorations = null) {
  const lines = ["---"];
  const notesFor = decorations?.byKey ?? new Map();

  for (const [key, value] of Object.entries(data)) {
    const notes = notesFor.get(key);
    if (notes) {
      lines.push(...notes);
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }

      lines.push(`${key}:`);
      for (const item of value) {
        if (isPlainObject(item)) {
          const entries = Object.entries(item);
          if (entries.length === 0) {
            throw new Error('Cannot stringify empty mapping in ' + key);
          }
          const [firstKey, firstValue] = entries[0];
          lines.push(`  - ${firstKey}: ${formatScalar(firstValue)}`);
          for (const [childKey, childValue] of entries.slice(1)) {
            lines.push(`    ${childKey}: ${formatScalar(childValue)}`);
          }
        } else {
          lines.push(`  - ${formatScalar(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }

  if (decorations?.trailing?.length) {
    lines.push(...decorations.trailing);
  }

  // One blank line between the closing delimiter and the body. Two empty
  // strings are required: join places separators between elements, so the
  // last empty string does not add a trailing newline of its own.
  lines.push("---", "", "");
  return lines.join("\n");
}

export function replaceFrontmatter(markdown, data, bodyOverride) {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) {
    throw new Error("Cannot replace missing YAML frontmatter");
  }

  const rawBody = bodyOverride === undefined ? markdown.slice(match[0].length) : bodyOverride;
  const body = String(rawBody).replace(/^(?:\r?\n)+/, "");
  return `${stringifyFrontmatter(data, frontmatterDecorations(match[1]))}${body}`;
}

// Full-line comments and blank lines are not data. Attach the ones that
// precede a top-level key to that key so a rewrite can put them back.
function frontmatterDecorations(raw) {
  const byKey = new Map();
  let pending = [];
  for (const line of raw.split(/\r?\n/)) {
    const comment = line.trimStart().startsWith("#");
    const blank = line.trim() === "" && !line.startsWith(" ") && !line.startsWith("\t");
    if (comment || blank) {
      pending.push(line);
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):/.exec(line);
    if (!pair) {
      continue;
    }
    byKey.set(pair[1], pending);
    pending = [];
  }
  return { byKey, trailing: pending };
}

function parseYaml(source) {
  const lines = source.split(/\r?\n/);
  const data = Object.create(null);

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
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
      index += 1;
      continue;
    }

    const parsed = parseArray(lines, index + 1);
    if (parsed.nextIndex === index + 1) {
      data[key] = "";
      index += 1;
      continue;
    }

    data[key] = parsed.items;
    index = parsed.nextIndex;
  }

  return toPlainObject(data);
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
  let index = startIndex;

  while (index < lines.length) {
    const itemMatch = /^  -(?:\s+(.*))?$/.exec(lines[index]);
    if (!itemMatch) {
      break;
    }

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

  return { items, nextIndex: index };
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

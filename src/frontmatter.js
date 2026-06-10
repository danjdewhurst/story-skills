const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

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
        if (isPlainObject(item)) {
          const entries = Object.entries(item);
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

  lines.push("---", "", "");
  return lines.join("\n");
}

export function replaceFrontmatter(markdown, data) {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) {
    throw new Error("Cannot replace missing YAML frontmatter");
  }

  return `${stringifyFrontmatter(data)}${markdown.slice(match[0].length)}`;
}

function parseYaml(source) {
  const lines = source.split(/\r?\n/);
  const data = {};

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

  return data;
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

    const item = {
      [objectMatch[1]]: parseScalar(objectMatch[2])
    };
    index += 1;

    while (index < lines.length) {
      const childMatch = /^    ([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[index]);
      if (!childMatch) {
        break;
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

  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return Number.parseFloat(trimmed);
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function formatScalar(value) {
  if (typeof value === "number") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (text === "" || text === "[]" || /^\s|\s$/.test(text) || /[:#\n"']/.test(text)) {
    return JSON.stringify(text);
  }

  return text;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// story list: the files of one entity kind whose frontmatter matches every
// --where filter, so agents and CI scripts can pick files without parsing
// YAML themselves. A view only: it reads the scan and writes nothing.

import path from "node:path";
import { usageError } from "./exit-codes.js";
import { FRONTMATTER_KEYS, nearMissKeys } from "./frontmatter-keys.js";
import { suggestion } from "./options.js";

// Each kind `list` takes: its plural name (the canonical one), its singular,
// the scan collection it reads, its schema definition in FRONTMATTER_KEYS,
// and the field it shows as the title.
export const LIST_KINDS = [
  { kind: "chapters", singular: "chapter", collection: "chapters", schema: "chapter", title: "title" },
  { kind: "scenes", singular: "scene", collection: "scenes", schema: "scene", title: "title" },
  { kind: "characters", singular: "character", collection: "characters", schema: "character", title: "name" },
  { kind: "locations", singular: "location", collection: "locations", schema: "location", title: "name" },
  { kind: "systems", singular: "system", collection: "systems", schema: "system", title: "name" },
  { kind: "factions", singular: "faction", collection: "factions", schema: "faction", title: "name" },
  { kind: "artifacts", singular: "artifact", collection: "artifacts", schema: "artifact", title: "name" },
  { kind: "arcs", singular: "arc", collection: "arcs", schema: "arc", title: "name" },
  { kind: "questions", singular: "question", collection: "questions", schema: "question", title: "title" },
  { kind: "promises", singular: "promise", collection: "promises", schema: "promise", title: "title" },
  { kind: "clues", singular: "clue", collection: "clues", schema: "clue", title: "title" },
  { kind: "terms", singular: "term", collection: "glossaryTerms", schema: "term", title: "term" },
  { kind: "research", singular: "research", collection: "research", schema: "research", title: "title" },
  { kind: "matter", singular: "matter", collection: "matter", schema: "matter", title: "title" }
];

const KIND_NAMES = LIST_KINDS.map((entry) => entry.kind);

// The kind entry for a plural or singular name.
export function listKind(name) {
  if (typeof name !== "string" || name.trim() === "") {
    throw usageError(`Usage: story list <kind> [--where <filter>]... [--path <project>]; kinds: ${KIND_NAMES.join(", ")}`);
  }
  const text = name.trim().toLowerCase();
  const entry = LIST_KINDS.find((candidate) => candidate.kind === text || candidate.singular === text);
  if (!entry) {
    throw usageError(`Unknown kind "${name}" for story list (kinds: ${KIND_NAMES.join(", ")})${suggestion(text, KIND_NAMES)}`);
  }
  return entry;
}

// One --where filter: `key=value` (equal, or a list that contains it),
// `key!=value` (the opposite), `key` (set and not empty), or `!key` (unset
// or empty).
export function parseWhere(text) {
  const filter = String(text).trim();
  const comparison = /^([^=!]+?)\s*(!=|=)\s*(.*)$/.exec(filter);
  if (comparison) {
    const [, key, operator, value] = comparison;
    if (value === "") {
      throw usageError(`--where ${filter} needs a value after ${operator}; use --where ${key} for a key that is set, or --where '!${key}' for one that is not`, "where");
    }
    return { key, op: operator === "=" ? "eq" : "ne", value };
  }
  const presence = /^(!?)([^=!\s]+)$/.exec(filter);
  if (presence) {
    return { key: presence[2], op: presence[1] === "!" ? "absent" : "present", value: null };
  }
  throw usageError(`Cannot read --where ${filter}: expected key=value, key!=value, key, or !key`, "where");
}

// The matching entities of `kind`, in scan order (chapters by number, scenes
// by chapter and scene, matter by order, the rest by file name), each with
// its id, file, title, and the frontmatter values of the filtered keys.
export function buildList(project, kindName, whereValues = []) {
  const entry = listKind(kindName);
  const filters = [whereValues].flat().filter((value) => value !== undefined && value !== true).map(parseWhere);
  const entities = project[entry.collection];
  // A file that fails to parse is missing from the scan, so any list would
  // be partial and a key only it sets would look like a typo: list nothing,
  // and let the caller report the parse errors.
  if ((project.fileErrors ?? []).length > 0) {
    return { kind: entry.kind, where: filters, total: entities.length, items: [] };
  }

  // A key the schema defines, or one any file of this kind sets, is a real
  // filter; anything else is most likely a typo.
  const known = [...FRONTMATTER_KEYS[entry.schema]];
  for (const entity of entities) {
    for (const key of Object.keys(entity.frontmatter ?? {})) {
      if (!known.includes(key)) {
        known.push(key);
      }
    }
  }
  for (const filter of filters) {
    if (!known.includes(filter.key)) {
      const near = nearMissKeys(filter.key, known);
      const hint = near.length > 0 ? `; did you mean ${near.map((key) => `"${key}"`).join(" or ")}?` : "";
      throw usageError(`Unknown key "${filter.key}" for ${entry.kind}: no ${entry.singular} file sets it and the schema does not define it${hint}`, "where");
    }
  }

  const keys = [...new Set(filters.map((filter) => filter.key))];
  const items = entities
    .filter((entity) => filters.every((filter) => matches(entity.frontmatter ?? {}, filter)))
    .map((entity) => ({
      id: entity.id,
      file: path.relative(project.root, entity.file).split(path.sep).join("/"),
      title: String(entity[entry.title]),
      fields: Object.fromEntries(keys.map((key) => [key, entity.frontmatter?.[key] ?? null]))
    }));
  return { kind: entry.kind, where: filters, total: entities.length, items };
}

function matches(frontmatter, filter) {
  const value = frontmatter[filter.key];
  switch (filter.op) {
    case "present":
      return isSet(value);
    case "absent":
      return !isSet(value);
    case "eq":
      return contains(value, filter.value);
    default:
      return !contains(value, filter.value);
  }
}

function isSet(value) {
  return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
}

// A scalar equal to `wanted`, or a list with an item equal to it. Numbers
// and booleans compare as their text, so `number=3` and `sequel=true` work.
function contains(value, wanted) {
  return (Array.isArray(value) ? value : [value]).some((item) => isScalar(item) && String(item).trim() === wanted);
}

function isScalar(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

// One line per match: id, title, and file in padded columns, then each
// filtered key's value.
export function formatList(report) {
  if (report.items.length === 0) {
    return "";
  }
  const rows = report.items.map((item) => ({ ...item, title: oneLine(item.title) }));
  const idWidth = Math.max(...rows.map((item) => item.id.length));
  const titleWidth = Math.max(...rows.map((item) => item.title.length));
  return rows.map((item) => {
    const fields = Object.entries(item.fields)
      .filter(([, value]) => isSet(value))
      .map(([key, value]) => `${key}=${formatValue(value)}`);
    return [item.id.padEnd(idWidth), item.title.padEnd(titleWidth), item.file, ...fields].join("  ").trimEnd();
  }).join("\n") + "\n";
}

// A list joins with commas.
function formatValue(value) {
  const text = (item) => (isScalar(item) ? String(item) : JSON.stringify(item));
  return oneLine(Array.isArray(value) ? value.map(text).join(",") : text(value));
}

// A multi-line title or value folds onto one line, so each match stays one
// line.
function oneLine(text) {
  return text.trim().replace(/\s*\n\s*/g, " ");
}

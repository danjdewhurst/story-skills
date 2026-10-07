// story list: the files of one entity kind whose frontmatter matches every
// --where filter, so agents and CI scripts can pick files without parsing
// YAML themselves. A view only: it reads the scan and writes nothing.
//
// story.md `queries` saves a kind and its filters under a name, which
// `story list --query <name>` runs:
//
//   queries:
//     - name: mara-drafts
//       kind: chapters
//       where: [status=draft, pov=mara-quill]

import path from "node:path";
import { projectError, usageError } from "./exit-codes.js";
import { err, warn } from "./findings.js";
import { FRONTMATTER_KEYS, nearMissKeys } from "./frontmatter-keys.js";
import { suggestion } from "./options.js";
import { oneLine } from "./unicode.js";

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

// The kind a saved query may name: a plural or singular name, written as
// the schema spells it.
const QUERY_KINDS = new Set(LIST_KINDS.flatMap((entry) => [entry.kind, entry.singular]));

// The keys a saved query takes.
const QUERY_KEYS = ["name", "kind", "where"];

// A query name, spelled as schemas/story.schema.json spells an id.
const KEBAB_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// The line breaks JavaScript's `.` does not match: a comparison's value is
// one line.
const LINE_BREAK = /[\n\r\u2028\u2029]/;

// Characters JSON.stringify leaves raw that could still act on a terminal or
// a CI log, or make the text read as other text: DEL and the C1 controls
// (U+009B starts an escape sequence on some terminals), the line and
// paragraph separators, and the bidirectional marks and controls.
const UNSAFE_IN_MESSAGE = /[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

// The kind entry for a plural or singular name.
export function listKind(name) {
  if (typeof name !== "string" || name.trim() === "") {
    throw usageError(`Usage: story list <kind> [--where <filter>]... or story list --query <name> [--where <filter>]... [--path <project>]; kinds: ${KIND_NAMES.join(", ")}`);
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
  const filter = readWhere(text);
  if (filter.problem === "value") {
    throw usageError(`--where ${filter.text} needs a value after ${filter.operator}; use --where ${filter.key} for a key that is set, or --where '!${filter.key}' for one that is not`, "where");
  }
  if (filter.problem === "shape") {
    throw usageError(`Cannot read --where ${filter.text}: expected key=value, key!=value, key, or !key`, "where");
  }
  return filter;
}

// A filter, or what is wrong with it: `problem` is "value" for a comparison
// with nothing after its operator and "shape" for text of no filter's form.
// A comparison's key runs to the first = or !, which must start the
// operator; its value is the rest, on one line. The text is read with
// indexOf-style scans rather than one regular expression, which backtracked
// in quadratic time on a long run of spaces in story.md.
function readWhere(text) {
  const filter = String(text).trim();
  const at = filter.search(/[=!]/);
  if (at > 0 && (filter[at] === "=" || filter[at + 1] === "=")) {
    const operator = filter[at] === "=" ? "=" : "!=";
    const key = filter.slice(0, at).trimEnd();
    const value = filter.slice(at + operator.length).trimStart();
    if (value === "") {
      return { problem: "value", text: filter, key, operator };
    }
    if (!LINE_BREAK.test(value)) {
      return { key, op: operator === "=" ? "eq" : "ne", value };
    }
  }
  const absent = filter.startsWith("!");
  const key = absent ? filter.slice(1) : filter;
  if (key !== "" && !/[=!\s]/.test(key)) {
    return { key, op: absent ? "absent" : "present", value: null };
  }
  return { problem: "shape", text: filter };
}

// The matching entities of `kind`, in scan order (chapters by number, scenes
// by chapter and scene, matter by order, the rest by file name), each with
// its id, file, title, and the frontmatter values of the filtered keys.
// With a saved query, its kind is the one listed and its filters come
// before the --where ones; a kind given as well must be the query's. A
// query's filter on a key the kind does not have is a warning, as story
// validate reports it, and matches as an unset key; a --where one is a
// usage error.
export function buildList(project, kindName, whereValues = [], queryName = undefined) {
  const query = queryName === undefined ? null : savedQuery(project, queryName);
  const entry = query === null ? listKind(kindName) : queryKind(query.item, kindName);
  const saved = (query?.item.where ?? []).map(parseWhere);
  const given = [whereValues].flat().filter((value) => value !== undefined && value !== true).map(parseWhere);
  const filters = [...saved, ...given];
  const entities = project[entry.collection];
  const queryField = query === null ? null : String(queryName).trim();
  const warnings = query?.warnings ?? [];
  // A file that fails to parse is missing from the scan, so any list would
  // be partial and a key only it sets would look like a typo: list nothing,
  // and let the caller report the parse errors.
  if ((project.fileErrors ?? []).length > 0) {
    return { kind: entry.kind, query: queryField, where: filters, total: entities.length, items: [], warnings };
  }

  const known = knownKeys(project, entry);
  for (const filter of given) {
    if (!known.has(filter.key)) {
      throw usageError(`Unknown key "${filter.key}" for ${entry.kind}: no ${entry.singular} file sets it and the schema does not define it${keyHint(filter.key, [...known])}`, "where");
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
  return { kind: entry.kind, query: queryField, where: filters, total: entities.length, items, warnings };
}

// A key the schema defines, or one any file of this kind sets, is a real
// filter; anything else is most likely a typo. A Set, in that order, so a
// kind with many files and keys is read once.
function knownKeys(project, entry) {
  const known = new Set(FRONTMATTER_KEYS[entry.schema]);
  for (const entity of project[entry.collection]) {
    for (const key of Object.keys(entity.frontmatter ?? {})) {
      known.add(key);
    }
  }
  return known;
}

// "; did you mean ..." for the `candidates` `key` most likely misspells.
function keyHint(key, candidates) {
  const near = nearMissKeys(key, candidates);
  return near.length > 0 ? `; did you mean ${near.map((candidate) => `"${candidate}"`).join(" or ")}?` : "";
}

// `value` quoted for a message, with every character that could act on a
// terminal or a CI log escaped: JSON.stringify escapes the C0 controls (so
// an ESC or a line break that would start a GitHub workflow command), and
// UNSAFE_IN_MESSAGE the rest.
function quoted(value) {
  return JSON.stringify(value).replace(UNSAFE_IN_MESSAGE, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

// A query name as messages show it: a kebab-case one as written, anything
// else quoted.
function shownName(name) {
  return typeof name === "string" && KEBAB_NAME.test(name) ? name : quoted(name);
}

// A query's name as text: an unquoted `name: 2025` parses as a number, and
// --query 2025 should still find it, to report that it needs quotes.
function nameText(name) {
  return typeof name === "number" || typeof name === "boolean" ? String(name) : name;
}

// The story.md query named `name` and its warnings, refused as story
// validate reports it: a name no query has is a usage error, and a
// story.md that does not parse or a query with errors leaves the project
// unusable for it.
function savedQuery(project, name) {
  const wanted = String(name).trim();
  if (wanted === "") {
    throw usageError("--query needs the name of a story.md query");
  }
  if (project.story.unreadable) {
    throw projectError(`story.md cannot be parsed; fix it before running story list --query ${quoted(wanted)}`);
  }
  const raw = project.story.data.queries;
  if (raw !== undefined && !Array.isArray(raw)) {
    throw projectError(`story.md frontmatter field queries must be a list; fix it before running story list --query ${quoted(wanted)}`);
  }
  const entries = (raw ?? []).map((item, index) => ({ item, index })).filter(({ item }) => isMapping(item));
  const named = entries.filter(({ item }) => nameText(item.name) === wanted);
  if (named.length === 0) {
    const names = [...new Set(entries.map(({ item }) => nameText(item.name)).filter((candidate) => typeof candidate === "string" && candidate !== ""))];
    throw usageError(names.length === 0
      ? `Unknown query ${quoted(wanted)}: story.md has no queries`
      : `Unknown query ${quoted(wanted)} (story.md queries: ${names.map(shownName).join(", ")})${suggestion(wanted, names)}`);
  }
  if (named.length > 1) {
    throw projectError(`Fix story.md query ${shownName(wanted)} before running it: story.md lists query ${shownName(wanted)} more than once`);
  }
  const { item, index } = named[0];
  const problems = queryProblems(project, item, index, (entry) => knownKeys(project, entry));
  if (problems.errors.length > 0) {
    throw projectError(`Fix story.md query ${shownName(wanted)} before running it: ${problems.errors.map((finding) => finding.message).join("; ")}`);
  }
  return { item, warnings: problems.warnings };
}

// The kind entry of a checked saved query. A kind given on the command line
// as well must name the same kind, in either form.
function queryKind(query, kindName) {
  const entry = listKind(query.kind);
  if (kindName !== undefined && listKind(kindName) !== entry) {
    throw usageError(`Query ${query.name} lists ${entry.kind}, not ${listKind(kindName).kind}: drop the kind, or give ${entry.kind}`);
  }
  return entry;
}

// The problems with story.md `queries`, as story validate reports them: a
// field that is not a list of mappings, a name used twice, and each query's
// own errors and warnings (see queryProblems). Each kind's keys are read
// once, however many queries list it.
export function queryFindings(project) {
  const errors = [];
  const warnings = [];
  const raw = project.story.data.queries;
  if (raw === undefined) {
    return { errors, warnings };
  }
  if (!Array.isArray(raw)) {
    errors.push(err("field-not-list", "story.md frontmatter field queries must be a list", "story.md"));
    return { errors, warnings };
  }
  const keysByKind = new Map();
  const knownFor = (entry) => {
    if (!keysByKind.has(entry)) {
      keysByKind.set(entry, knownKeys(project, entry));
    }
    return keysByKind.get(entry);
  };
  const seen = new Set();
  raw.forEach((item, index) => {
    if (!isMapping(item)) {
      errors.push(err("field-invalid-items", "story.md frontmatter field queries must contain mappings, such as - name: mara-drafts", "story.md"));
      return;
    }
    const problems = queryProblems(project, item, index, knownFor);
    errors.push(...problems.errors);
    warnings.push(...problems.warnings);
    if (typeof item.name === "string" && seen.has(item.name)) {
      errors.push(err("duplicate-query", `story.md lists query ${shownName(item.name)} more than once`, "story.md"));
    }
    seen.add(item.name);
  });
  return { errors, warnings };
}

// The problems with one saved query, which story validate reports and
// story list --query reports too. Errors, which stop --query: a missing,
// unquoted-number, or non-kebab-case name, a missing or unknown kind, a
// where that is not a list of filters or is empty, a filter --where could
// not read, and any other key. A warning: a filter on a key the kind neither
// defines nor any of its files sets, which may be a typo or a key no file
// sets yet (checked only while every file parses, as buildList checks it).
// `knownFor` gives a kind's known keys.
function queryProblems(project, item, index, knownFor) {
  const errors = [];
  const warnings = [];
  const label = typeof item.name === "string" && KEBAB_NAME.test(item.name) ? `story.md query ${item.name}` : `story.md queries[${index}]`;
  const extra = Object.keys(item).filter((key) => !QUERY_KEYS.includes(key));
  if (extra.length > 0) {
    errors.push(err("invalid-query", `${label} has ${extra.join(", ")}: a query takes only name, kind, and where`, "story.md"));
  }
  if (item.name === undefined) {
    errors.push(err("missing-field", `${label} is missing name`, "story.md"));
  } else if (typeof item.name === "number" || typeof item.name === "boolean") {
    errors.push(err("field-not-text", `${label} name ${String(item.name)} is not text: quote it, such as name: "${String(item.name)}"`, "story.md"));
  } else if (typeof item.name !== "string" || !KEBAB_NAME.test(item.name)) {
    errors.push(err("id-not-kebab", `${label} name ${quoted(item.name)} must be kebab-case, such as mara-drafts`, "story.md"));
  }

  let entry = null;
  if (item.kind === undefined) {
    errors.push(err("missing-field", `${label} is missing kind`, "story.md"));
  } else if (QUERY_KINDS.has(item.kind)) {
    entry = listKind(item.kind);
  } else {
    const near = typeof item.kind === "string" ? suggestion(item.kind, KIND_NAMES) : "";
    errors.push(err("invalid-query", `${label} kind ${quoted(item.kind)} is not a kind story list takes (${KIND_NAMES.join(", ")}, or the singular)${near}`, "story.md"));
  }

  if (item.where === undefined) {
    errors.push(err("missing-field", `${label} is missing where`, "story.md"));
    return { errors, warnings };
  }
  if (Array.isArray(item.where) && item.where.length === 0) {
    errors.push(err("invalid-query", `${label} where needs at least one filter, such as where: [status=draft]`, "story.md"));
    return { errors, warnings };
  }
  if (!Array.isArray(item.where) || !item.where.every((filter) => typeof filter === "string")) {
    errors.push(err("invalid-query", `${label} where must be a list of filters, such as where: [status=draft, pov=mara-quill]`, "story.md"));
    return { errors, warnings };
  }
  const filters = [];
  for (const text of item.where) {
    const filter = readWhere(text);
    if (filter.problem === "value") {
      errors.push(err("invalid-query", `${label} where filter ${quoted(filter.text)} needs a value after ${filter.operator}; write ${quoted(filter.key)} for a key that is set, or ${quoted(`!${filter.key}`)} for one that is not`, "story.md"));
    } else if (filter.problem === "shape") {
      errors.push(err("invalid-query", `${label} cannot read where filter ${quoted(filter.text)}: expected key=value, key!=value, key, or "!key"`, "story.md"));
    } else {
      filters.push(filter);
    }
  }
  if (entry !== null && (project.fileErrors ?? []).length === 0) {
    const known = knownFor(entry);
    // The guess looks only among the schema's keys: a story.md can hold many
    // queries and a file many custom keys, and comparing every pair would
    // take minutes.
    for (const filter of filters.filter((candidate) => !known.has(candidate.key))) {
      warnings.push(warn("query-unknown-key", `${label} filters on ${quoted(filter.key)}, which no ${entry.singular} file sets and the schema does not define, so it matches as unset${keyHint(filter.key, FRONTMATTER_KEYS[entry.schema])}`, "story.md"));
    }
  }
  return { errors, warnings };
}

// The story.md queries with a filter that compares a reference key with
// `id` (key=id or key!=id), where `isReferenceKey` says whether a key can
// name the entity: the filters rename, move, and merge point at a new id,
// and remove reports. Each entry gives the query's index, the query, and
// the positions of those filters in its where.
export function queryFiltersNaming(queries, isReferenceKey, id) {
  if (!Array.isArray(queries)) {
    return [];
  }
  const found = [];
  queries.forEach((item, index) => {
    if (!isMapping(item) || !Array.isArray(item.where)) {
      return;
    }
    const positions = [];
    item.where.forEach((text, position) => {
      const filter = typeof text === "string" ? readWhere(text) : {};
      if (filter.value === id && isReferenceKey(filter.key)) {
        positions.push(position);
      }
    });
    if (positions.length > 0) {
      found.push({ index, item, positions });
    }
  });
  return found;
}

// A filter queryFiltersNaming found, comparing with `newId` instead, with
// the rest of its text as written.
export function retargetFilter(text, newId) {
  const end = text.trimEnd().length;
  return `${text.slice(0, end - readWhere(text).value.length)}${newId}${text.slice(end)}`;
}

// A filter queryFiltersNaming found, as remove's warning shows it.
export function shownFilter(text) {
  const filter = readWhere(text);
  return `${filter.key}${filter.op === "eq" ? "=" : "!="}${filter.value}`;
}

// A query from queryFiltersNaming, named as messages name it.
export function shownQuery({ item, index }) {
  return typeof item.name === "string" && KEBAB_NAME.test(item.name) ? item.name : `queries[${index}]`;
}

function isMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
// A value written over several lines compares on one, as the list prints
// it and story grid shows a beat, so `beat=Break into Two` finds a block
// scalar.
function contains(value, wanted) {
  return (Array.isArray(value) ? value : [value]).some((item) => isScalar(item) && oneLine(item) === wanted);
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
  // A multi-line title or value folds onto one line, so each match stays
  // one line.
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

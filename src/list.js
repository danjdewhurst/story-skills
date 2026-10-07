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
import { err } from "./findings.js";
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
function readWhere(text) {
  const filter = String(text).trim();
  const comparison = /^([^=!]+?)\s*(!=|=)\s*(.*)$/.exec(filter);
  if (comparison) {
    const [, key, operator, value] = comparison;
    if (value === "") {
      return { problem: "value", text: filter, key, operator };
    }
    return { key, op: operator === "=" ? "eq" : "ne", value };
  }
  const presence = /^(!?)([^=!\s]+)$/.exec(filter);
  if (presence) {
    return { key: presence[2], op: presence[1] === "!" ? "absent" : "present", value: null };
  }
  return { problem: "shape", text: filter };
}

// The matching entities of `kind`, in scan order (chapters by number, scenes
// by chapter and scene, matter by order, the rest by file name), each with
// its id, file, title, and the frontmatter values of the filtered keys.
// With a saved query, its kind is the one listed and its filters come
// before the --where ones; a kind given as well must be the query's.
export function buildList(project, kindName, whereValues = [], queryName = undefined) {
  const query = queryName === undefined ? null : savedQuery(project, queryName);
  const entry = query === null ? listKind(kindName) : queryKind(query, kindName);
  const given = [whereValues].flat().filter((value) => value !== undefined && value !== true);
  const filters = [...(query?.where ?? []), ...given].map(parseWhere);
  const entities = project[entry.collection];
  const queryField = query?.name ?? null;
  // A file that fails to parse is missing from the scan, so any list would
  // be partial and a key only it sets would look like a typo: list nothing,
  // and let the caller report the parse errors.
  if ((project.fileErrors ?? []).length > 0) {
    return { kind: entry.kind, query: queryField, where: filters, total: entities.length, items: [] };
  }

  const known = knownKeys(project, entry);
  for (const filter of filters) {
    if (!known.includes(filter.key)) {
      throw usageError(`Unknown key "${filter.key}" for ${entry.kind}: no ${entry.singular} file sets it and the schema does not define it${keyHint(filter.key, known)}`, "where");
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
  return { kind: entry.kind, query: queryField, where: filters, total: entities.length, items };
}

// A key the schema defines, or one any file of this kind sets, is a real
// filter; anything else is most likely a typo.
function knownKeys(project, entry) {
  const known = [...FRONTMATTER_KEYS[entry.schema]];
  for (const entity of project[entry.collection]) {
    for (const key of Object.keys(entity.frontmatter ?? {})) {
      if (!known.includes(key)) {
        known.push(key);
      }
    }
  }
  return known;
}

function keyHint(key, known) {
  const near = nearMissKeys(key, known);
  return near.length > 0 ? `; did you mean ${near.map((candidate) => `"${candidate}"`).join(" or ")}?` : "";
}

// The story.md query named `name`, refused as story validate reports it: a
// name no query has is a usage error, and a story.md that does not parse or
// a query with problems leaves the project unusable for it.
function savedQuery(project, name) {
  const wanted = String(name).trim();
  if (wanted === "") {
    throw usageError("--query needs the name of a story.md query");
  }
  if (project.story.unreadable) {
    throw projectError(`story.md cannot be parsed; fix it before running story list --query ${wanted}`);
  }
  const raw = project.story.data.queries;
  if (raw !== undefined && !Array.isArray(raw)) {
    throw projectError(`story.md frontmatter field queries must be a list; fix it before running story list --query ${wanted}`);
  }
  const entries = (raw ?? []).map((item, index) => ({ item, index })).filter(({ item }) => isMapping(item));
  const named = entries.filter(({ item }) => item.name === wanted);
  if (named.length === 0) {
    const names = [...new Set(entries.map(({ item }) => item.name).filter((candidate) => typeof candidate === "string" && candidate !== ""))];
    throw usageError(names.length === 0
      ? `Unknown query "${wanted}": story.md has no queries`
      : `Unknown query "${wanted}" (story.md queries: ${names.join(", ")})${suggestion(wanted, names)}`);
  }
  const problems = named.length > 1
    ? [`story.md lists query ${wanted} more than once`]
    : queryProblems(project, named[0].item, named[0].index).map((finding) => finding.message);
  if (problems.length > 0) {
    throw projectError(`Fix story.md query ${wanted} before running it: ${problems.join("; ")}`);
  }
  return named[0].item;
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

// The problems with story.md `queries`, as findings for story validate: a
// field that is not a list of mappings, a name used twice, and each query's
// own problems (see queryProblems).
export function queryFindings(project) {
  const raw = project.story.data.queries;
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [err("field-not-list", "story.md frontmatter field queries must be a list", "story.md")];
  }
  const findings = [];
  const seen = new Set();
  raw.forEach((item, index) => {
    if (!isMapping(item)) {
      findings.push(err("field-invalid-items", "story.md frontmatter field queries must contain mappings, such as - name: mara-drafts", "story.md"));
      return;
    }
    findings.push(...queryProblems(project, item, index));
    if (typeof item.name === "string" && seen.has(item.name)) {
      findings.push(err("duplicate-query", `story.md lists query ${item.name} more than once`, "story.md"));
    }
    seen.add(item.name);
  });
  return findings;
}

// The problems with one saved query, which story validate reports and
// story list --query refuses to run: a missing or non-kebab-case name, a
// missing or unknown kind, a where that is not a list of filters, a filter
// --where could not read, a key the kind does not have (checked only while
// every file parses, as buildList checks it), and any other key.
function queryProblems(project, item, index) {
  const findings = [];
  const label = typeof item.name === "string" && KEBAB_NAME.test(item.name) ? `story.md query ${item.name}` : `story.md queries[${index}]`;
  const extra = Object.keys(item).filter((key) => !QUERY_KEYS.includes(key));
  if (extra.length > 0) {
    findings.push(err("invalid-query", `${label} has ${extra.join(", ")}: a query takes only name, kind, and where`, "story.md"));
  }
  if (item.name === undefined) {
    findings.push(err("missing-field", `${label} is missing name`, "story.md"));
  } else if (typeof item.name !== "string" || !KEBAB_NAME.test(item.name)) {
    findings.push(err("id-not-kebab", `${label} name ${JSON.stringify(item.name)} must be kebab-case, such as mara-drafts`, "story.md"));
  }

  let entry = null;
  if (item.kind === undefined) {
    findings.push(err("missing-field", `${label} is missing kind`, "story.md"));
  } else if (QUERY_KINDS.has(item.kind)) {
    entry = listKind(item.kind);
  } else {
    const near = typeof item.kind === "string" ? suggestion(item.kind, KIND_NAMES) : "";
    findings.push(err("invalid-query", `${label} kind ${JSON.stringify(item.kind)} is not a kind story list takes (${KIND_NAMES.join(", ")}, or the singular)${near}`, "story.md"));
  }

  if (item.where === undefined) {
    findings.push(err("missing-field", `${label} is missing where`, "story.md"));
    return findings;
  }
  if (!Array.isArray(item.where) || item.where.length === 0 || !item.where.every((filter) => typeof filter === "string")) {
    findings.push(err("invalid-query", `${label} where must be a list of one or more filters, such as where: [status=draft, pov=mara-quill]`, "story.md"));
    return findings;
  }
  const filters = [];
  for (const text of item.where) {
    const filter = readWhere(text);
    if (filter.problem === "value") {
      findings.push(err("invalid-query", `${label} where filter ${JSON.stringify(filter.text)} needs a value after ${filter.operator}; write ${filter.key} for a key that is set, or "!${filter.key}" for one that is not`, "story.md"));
    } else if (filter.problem === "shape") {
      findings.push(err("invalid-query", `${label} cannot read where filter ${JSON.stringify(filter.text)}: expected key=value, key!=value, key, or "!key"`, "story.md"));
    } else {
      filters.push(filter);
    }
  }
  if (entry !== null && (project.fileErrors ?? []).length === 0) {
    const known = knownKeys(project, entry);
    for (const filter of filters.filter((candidate) => !known.includes(candidate.key))) {
      findings.push(err("invalid-query", `${label} filters on ${filter.key}, which no ${entry.singular} file sets and the schema does not define${keyHint(filter.key, known)}`, "story.md"));
    }
  }
  return findings;
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

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";
import { validateProject } from "../src/story.js";
import { SCHEMA_PATH, buildSchemaDocument, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir } from "./helpers.js";

// story validate and schemas/story.schema.json check the same frontmatter,
// and have drifted apart before (#132). This test writes a valid project
// holding one of every entity, then, many times over, rewrites one field of
// one file with a generated value: a valid value from the examples, an enum
// value, a boundary number, a wrong type, an odd YAML scalar (0451, yes, ~,
// [TODO]), a list, or a list of mappings with one key changed; or it removes
// a required key or adds an unknown one. Each time, validate must reject the
// file exactly when the schema rejects that entity.
//
// A fixed seed runs in `bun run test`. To search further:
//   STORY_PROPERTY_RUNS=20000 STORY_PROPERTY_SEED=7 bun test test/validate-schema-property.test.js
// (the time limit grows with the run count).
// STORY_PROPERTY_SEED=random picks a seed and prints it, and
// STORY_PROPERTY_REPORT=<file> writes the disagreements found as JSON.

const repoRoot = path.resolve(import.meta.dir, "..");
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
const RUNS = Number(process.env.STORY_PROPERTY_RUNS ?? 800);
const SEED = process.env.STORY_PROPERTY_SEED === "random"
  ? Math.floor(Math.random() * 2 ** 31)
  : Number(process.env.STORY_PROPERTY_SEED ?? 20260928);

// Rules one side checks that the other cannot express, and deliberate
// differences. Each names the kind and field mutated and the side that
// rejected; `match`, when set, must match that side's first reason, so an
// exception cannot hide a different disagreement on the same field.
const EXCEPTIONS = [
  { kind: "chapter", field: "number", side: "validate", match: /^filename-number-mismatch/, reason: "the number must match the chapter's file name, which the schema never sees" },
  { kind: "scene", field: "chapter", side: "validate", match: /^filename-number-mismatch/, reason: "the chapter must match the scene's file name" },
  { kind: "scene", field: "scene", side: "validate", match: /^filename-number-mismatch/, reason: "the scene number must match the scene's file name" },
  { kind: "story", field: "isbn", side: "validate", match: /^invalid-isbn/, reason: "an ISBN's check digit is arithmetic, not a pattern" },
  { kind: "story", field: "cover", side: "validate", match: /^invalid-cover: story\.md cover .* (?:does not exist|is not a file|must be inside the project)$/, reason: "the cover file must exist on disk" },
  { kind: "story", field: "deadline", side: "validate", match: /real YYYY-MM-DD calendar day/, reason: "a date must be a real calendar day (no 2024-13-45), which a pattern cannot check" },
  { kind: "story", field: "publication-date", side: "validate", match: /real YYYY-MM-DD calendar day/, reason: "as for deadline" },
  { kind: "chapter", field: "date", side: "validate", match: /real YYYY-MM-DD calendar day/, reason: "as for deadline; the schema allows any text, since continuity only warns about a date not shaped YYYY-MM-DD" },
  { kind: "scene", field: "date", side: "validate", match: /real YYYY-MM-DD calendar day/, reason: "as for chapter date" },
  { kind: "story", field: "publication-date", side: "schema", match: /does not match/, reason: "validate reads a blank value or a [TODO] placeholder in a publishing field as not set yet, and warns (todo-placeholder); the schema describes finished values" },
  { kind: "story", field: "language", side: "schema", match: /does not match/, reason: "as for publication-date" },
  { kind: "story", field: "subjects", side: "schema", match: /does not match/, reason: "as for publication-date: a [TODO] subject is a todo-placeholder warning" },
  { kind: "story", field: "calendar", side: "validate", match: /^invalid-calendar: story\.md calendar (?:entry \d+ (?:must name exactly one of month, era, or weekdays|first-weekday must be one of the weekdays|repeats weekdays|weekdays needs at least one name)|needs at least one month entry|era .+ (?:counts backward, but only the first era may|needs years)|.+ appears more than once)/, reason: "a calendar entry must be exactly one kind, with months, unique names, and eras in a readable order, which needs counting and comparing across entries" },
  { kind: "story", field: "cli-defaults", side: "validate", match: /^invalid-cli-config/, reason: "a cli-defaults entry's other keys are flags, checked against the command and option registries" },
  { kind: "story", field: "severity", side: "validate", match: /^invalid-cli-config/, reason: "an unknown key in a severity entry is rejected, and the schema checker has no additionalProperties" },
  { kind: "character", field: "progressions", side: "validate", reason: "a progression's value is checked by the rules of the field it changes (a status enum), which depend on the entity kind" },
  { kind: "location", field: "progressions", side: "validate", reason: "as for character progressions" },
  { kind: "faction", field: "progressions", side: "validate", reason: "as for character progressions" },
  { kind: "exemptions", field: "exemptions", side: "validate", reason: "an exemption's code must carry the chapter or file it names, and a pattern or file must match the project, which depend on the finding codes and the project's files" },
  // validate reads an unquoted number in a list entry as the text or id it
  // spells, so all-digit ids work (#169); the schema asks for the quotes.
  ...[["character", "progressions"], ["location", "progressions"], ["faction", "progressions"], ["location", "routes"], ["state", "character-state"], ["state", "object-state"], ["state", "knowledge-state"]]
    .map(([kind, field]) => ({ kind, field, side: "schema", match: /: expected string, got (?:integer|number|boolean)$/, reason: "validate reads an unquoted number or other scalar in a list entry as the text or id it spells (#169)" })),
  // Ids in list entries are references: links reports one that names no
  // entity (which covers one that is not kebab-case), validate only that
  // each is a single value.
  ...[["character", "progressions"], ["location", "progressions"], ["faction", "progressions"], ["location", "routes"], ["state", "character-state"], ["state", "object-state"], ["state", "knowledge-state"]]
    .map(([kind, field]) => ({ kind, field, side: "schema", match: /does not match \^\[a-z0-9\]\+/, reason: "an id in a list entry is a reference, which links checks against the project" })),
  { kind: "research", field: "used-in", side: "schema", match: /does not match/, reason: "used-in names chapters, which links checks against the project; validate checks only that each is text" }
];

const deref = (node) => (node?.$ref ? deref(node.$ref.slice(2).split("/").reduce((at, key) => at[key], schema)) : node ?? {});

// kind, file, the schema path its errors start with, and its schema. The
// state file's schema is the part of `continuity` built from it.
function kinds() {
  const state = { properties: Object.fromEntries(["current-chapter", "character-state", "object-state", "knowledge-state"].map((key) => [key, schema.properties.continuity.properties[key]])) };
  return [
    ["story", "story.md", "$.story", schema.properties.story],
    ["styleSheet", "style-sheet.md", "$.styleSheet", deref(schema.properties.styleSheet)],
    ["character", "characters/mara-quill.md", "$.characters[mara-quill]", schema.$defs.character],
    ["location", "worldbuilding/locations/the-mill.md", "$.worldbuilding.locations[the-mill]", schema.$defs.location],
    ["system", "worldbuilding/systems/tide-magic.md", "$.worldbuilding.systems[tide-magic]", schema.$defs.system],
    ["faction", "worldbuilding/factions/the-board.md", "$.worldbuilding.factions[the-board]", schema.$defs.faction],
    ["artifact", "worldbuilding/artifacts/brass-key.md", "$.worldbuilding.artifacts[brass-key]", schema.$defs.artifact],
    ["arc", "plot/arcs/the-key.md", "$.plot.arcs[the-key]", schema.$defs.arc],
    ["chapter", "chapters/chapter-01.md", "$.chapters[chapter-01]", schema.$defs.chapter],
    ["scene", "scenes/chapter-01-scene-01.md", "$.scenes[chapter-01-scene-01]", schema.$defs.scene],
    ["question", "continuity/questions/who-left-it.md", "$.continuity.questions[who-left-it]", schema.$defs.question],
    ["promise", "continuity/promises/the-chest.md", "$.continuity.promises[the-chest]", schema.$defs.promise],
    ["clue", "continuity/clues/muddy-boots.md", "$.continuity.clues[muddy-boots]", schema.$defs.clue],
    ["term", "glossary/terms/skerry.md", "$.glossary[skerry]", schema.$defs.term],
    ["matter", "matter/dedication.md", "$.matter[dedication]", schema.$defs.matter],
    ["research", "research/lighthouses.md", "$.research[lighthouses]", schema.$defs.research],
    ["state", "continuity/state.md", "$.continuity.", state],
    ["progress", "progress.md", "$.progressLog", deref(schema.properties.progressLog)],
    ["exemptions", "continuity/exemptions.md", "$.continuity.exemptions", { properties: { exemptions: schema.properties.continuity.properties.exemptions } }]
  ];
}

// A valid project with one of every entity, a progress log, and an
// exemptions log.
function baseProject() {
  const cwd = makeTempDir();
  const io = { cwd, stdout: { write() {} }, stderr: { write() {} } };
  const run = (...args) => {
    const code = runCli(args, io);
    if (code !== 0) {
      throw new Error(`story ${args.join(" ")} exited ${code}`);
    }
  };
  run("init", "Property Book", "--dir", "book");
  const root = path.join(cwd, "book");
  io.cwd = root;
  for (const args of [
    ["character", "Mara Quill", "--role", "protagonist"],
    ["location", "The Mill", "--type", "building"],
    ["system", "Tide Magic", "--type", "magic"],
    ["faction", "The Board", "--type", "guild"],
    ["artifact", "Brass Key", "--type", "object"],
    ["arc", "The Key", "--type", "main", "--character", "mara-quill"],
    ["chapter", "Opening", "--pov", "mara-quill"],
    ["scene", "Arrival", "--chapter", "chapter-01", "--pov", "mara-quill"],
    ["question", "Who Left It"],
    ["promise", "The Chest"],
    ["clue", "Muddy Boots"],
    ["term", "Skerry"],
    ["matter", "Dedication"],
    ["research", "Lighthouses"]
  ]) {
    run("add", ...args);
  }
  run("progress", "--log", "--date", "2026-09-01");
  fs.writeFileSync(path.join(root, "continuity", "exemptions.md"), `${stringifyFrontmatter({
    type: "exemption-log",
    exemptions: [{ code: "clock-backward", chapter: "chapter-01", reason: "A flashback opens the book." }]
  })}# Exemptions\n`);
  return root;
}

// Values from the example projects, per field name: realistic valid values,
// including lists of mappings (routes, progressions, choices).
function exampleValues() {
  const values = {};
  const examples = path.join(repoRoot, "examples");
  for (const file of fs.readdirSync(examples, { recursive: true })) {
    if (!String(file).endsWith(".md")) {
      continue;
    }
    let data;
    try {
      data = parseFrontmatter(fs.readFileSync(path.join(examples, file), "utf8")).data;
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(data)) {
      (values[key] ??= []).push(value);
    }
  }
  return values;
}

// mulberry32: a small seeded generator, so a failure can be replayed.
function generator(seed) {
  let state = seed | 0;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { random, pick: (list) => list[Math.floor(random() * list.length)] };
}

// Raw YAML scalars, as a writer might type them: strings, numbers, odd
// scalars other YAML tools read as numbers, booleans, or null, empty and
// blank values, placeholders, and values with the shape of an id, chapter,
// date, or time.
const SCALARS = [
  "text", "Mara Quill", "\"quoted\"", "''", "\"\"", "\"  \"", "[TODO: fill in]",
  "0", "1", "-1", "3", "2.5", "-2.5", "100000", "0451", "1e3", ".5",
  "yes", "no", "true", "false", "~", "null", "[]",
  "mara-quill", "chapter-01", "chapter-99", "2024-01-05", "2024-13-45", "08:30", "25:61", "dawn"
];

function enumValues(property) {
  const resolved = deref(property);
  const values = [...(resolved.enum ?? []), ...(resolved.const !== undefined ? [resolved.const] : []), ...(deref(resolved.items).enum ?? [])];
  return values.map(String);
}

function yamlLines(key, value) {
  return stringifyFrontmatter({ [key]: value }).split("\n").slice(1, -3);
}

function generate(rng, key, property, examples) {
  const roll = rng.random();
  const known = examples[key];
  if (roll < 0.25 && known) {
    return { lines: yamlLines(key, rng.pick(known)), how: "example value" };
  }
  const enums = enumValues(property);
  if (roll < 0.35 && enums.length > 0) {
    return { lines: [`${key}: ${rng.pick(enums)}`], how: "enum value" };
  }
  if (roll < 0.7) {
    return { lines: [`${key}: ${rng.pick(SCALARS)}`], how: "scalar" };
  }
  if (roll < 0.85) {
    const items = Array.from({ length: 1 + Math.floor(rng.random() * 3) }, () => `  - ${rng.pick([...SCALARS.filter((value) => value !== "[]"), ...enums])}`);
    return { lines: [`${key}:`, ...items], how: "list" };
  }
  // A list of mappings: an example's first item with one key changed,
  // removed, or added.
  const base = known ? rng.pick(known) : null;
  if (Array.isArray(base) && base.length > 0 && base[0] !== null && typeof base[0] === "object") {
    const item = { ...base[0] };
    const subKey = rng.random() < 0.2 ? "unknown-key" : rng.pick(Object.keys(item));
    if (subKey !== "unknown-key" && rng.random() < 0.2) {
      delete item[subKey];
    } else {
      item[subKey] = "@RAW@";
    }
    const value = rng.pick(SCALARS);
    return { lines: yamlLines(key, [item]).map((line) => line.replace(/"?@RAW@"?/, value)), how: "list of mappings" };
  }
  return { lines: [`${key}:`, `  - name: ${rng.pick(SCALARS)}`], how: "list of mappings" };
}

// The file with `key` replaced by `lines`, or removed when lines is null.
function withField(text, key, lines) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const kept = [];
  const source = match[1].split("\n");
  for (let index = 0; index < source.length; index += 1) {
    if (source[index].startsWith(`${key}:`)) {
      while (index + 1 < source.length && /^ {2}/.test(source[index + 1])) {
        index += 1;
      }
      continue;
    }
    kept.push(source[index]);
  }
  if (lines !== null) {
    kept.push(...lines);
  }
  return `---\n${kept.join("\n")}\n---\n${text.slice(match[0].length)}`;
}

function explained(kind, field, side, reasons) {
  return EXCEPTIONS.some((entry) => entry.kind === kind && entry.field === field && entry.side === side
    && (entry.match === undefined || reasons.every((reason) => entry.match.test(reason))));
}

describe("story validate and schemas/story.schema.json agree (#295)", () => {
  test("on the base project, and on every example", () => {
    const root = baseProject();
    expect(validateProject(root).errors).toEqual([]);
    expect(validateAgainstSchema(buildSchemaDocument(root), schema)).toEqual([]);
  });

  // Each run takes a few milliseconds (more on slower CI runners), so a deep
  // search needs more time.
  test(`on ${RUNS} generated documents (seed ${SEED})`, () => {
    if (process.env.STORY_PROPERTY_SEED === "random") {
      console.log(`validate-schema property seed: ${SEED}`);
    }
    const root = baseProject();
    const examples = exampleValues();
    const rng = generator(SEED);
    const table = kinds();
    const pristine = Object.fromEntries(table.map(([, file]) => [file, fs.readFileSync(path.join(root, file), "utf8")]));
    const disagreements = [];
    const checked = new Set();

    for (let run = 0; run < RUNS; run += 1) {
      const [kind, file, prefix, definition] = rng.pick(table);
      const fields = Object.keys(definition.properties ?? {});
      const required = definition.required ?? [];
      const mode = rng.random();
      let field;
      let lines;
      let how;
      if (mode < 0.1 && required.length > 0) {
        field = rng.pick(required);
        lines = null;
        how = "removed";
      } else if (mode < 0.15 && kind !== "state" && kind !== "exemptions") {
        // The state file's other keys are not part of the schema document.
        field = rng.pick(["unknown-key", "Title", "notes"]);
        ({ lines, how } = generate(rng, field, {}, examples));
        how = `unknown key, ${how}`;
      } else {
        field = rng.pick(fields);
        ({ lines, how } = generate(rng, field, definition.properties[field], examples));
      }
      const text = withField(pristine[file], field, lines);
      fs.writeFileSync(path.join(root, file), text);
      try {
        // A file that does not parse is an error for both, and not a
        // question of rules.
        parseFrontmatter(text);
      } catch {
        fs.writeFileSync(path.join(root, file), pristine[file]);
        continue;
      }
      const validateErrors = validateProject(root).errors.filter((error) => error.file === file);
      const schemaErrors = validateAgainstSchema(buildSchemaDocument(root), schema)
        .filter((error) => (kind === "state" ? /^\$\.continuity\.(?:current-chapter|character-state|object-state|knowledge-state)\b/.test(error) : error.startsWith(prefix)));
      fs.writeFileSync(path.join(root, file), pristine[file]);
      checked.add(kind);

      const validateRejects = validateErrors.length > 0;
      const schemaRejects = schemaErrors.length > 0;
      if (validateRejects === schemaRejects) {
        continue;
      }
      const side = validateRejects ? "validate" : "schema";
      const reasons = validateRejects ? validateErrors.map((error) => `${error.code}: ${error.message}`) : schemaErrors;
      if (explained(kind, field, side, reasons)) {
        continue;
      }
      disagreements.push({
        kind,
        field,
        how,
        yaml: lines === null ? "(removed)" : lines.join("\n"),
        rejectedBy: side,
        reasons
      });
    }

    expect(checked.size).toBe(table.length);
    // One example per kind, field, and side is enough to act on.
    const unique = [...new Map(disagreements.map((entry) => [`${entry.kind}.${entry.field}.${entry.rejectedBy}`, entry])).values()];
    if (process.env.STORY_PROPERTY_REPORT) {
      fs.writeFileSync(process.env.STORY_PROPERTY_REPORT, `${JSON.stringify(unique, null, 2)}\n`);
    }
    expect(unique).toEqual([]);
  }, Math.max(5000, RUNS * 50));

  test("every exception still describes a real difference", () => {
    // An exception names a kind and a field the test mutates, so a renamed
    // field cannot leave a stale exception behind.
    const table = kinds();
    for (const exception of EXCEPTIONS) {
      const entry = table.find(([kind]) => kind === exception.kind);
      expect(entry, exception.kind).toBeDefined();
      expect(Object.keys(entry[3].properties ?? {}), `${exception.kind}.${exception.field}`).toContain(exception.field);
      expect(exception.reason.length).toBeGreaterThan(10);
    }
  });

  describe("the validate rules this test brought in line with the schema", () => {
    // Each rewrite puts one field into the base project and returns the
    // messages validate reports for that file.
    function errorsWith(file, key, lines) {
      const root = baseProject();
      const target = path.join(root, file);
      fs.writeFileSync(target, withField(fs.readFileSync(target, "utf8"), key, lines));
      return validateProject(root).errors.filter((error) => error.file === file).map((error) => error.message);
    }

    test("free-text fields take text, not a list", () => {
      expect(errorsWith("characters/mara-quill.md", "lie", ["lie:", "  - one", "  - two"])).toEqual(["characters/mara-quill.md frontmatter field lie must be text, not a list"]);
      expect(errorsWith("story.md", "premise", ["premise:", "  - a"])).toEqual(["story.md frontmatter field premise must be text, not a list"]);
    });

    test("a character's arc-type is change-positive, change-negative, or flat", () => {
      expect(errorsWith("characters/mara-quill.md", "arc-type", ["arc-type: sideways"])).toEqual(["characters/mara-quill.md frontmatter field arc-type has unsupported value sideways"]);
      expect(errorsWith("characters/mara-quill.md", "arc-type", ["arc-type: flat"])).toEqual([]);
    });

    test("population is a whole number or text", () => {
      const message = "worldbuilding/locations/the-mill.md frontmatter field population must be a whole number or text, such as 300 or \"about 300\"";
      expect(errorsWith("worldbuilding/locations/the-mill.md", "population", ["population: 2.5"])).toEqual([message]);
      expect(errorsWith("worldbuilding/locations/the-mill.md", "population", ["population: true"])).toEqual([message]);
      expect(errorsWith("worldbuilding/locations/the-mill.md", "population", ["population: 300"])).toEqual([]);
      expect(errorsWith("worldbuilding/locations/the-mill.md", "population", ["population: about 300"])).toEqual([]);
    });

    test("story.md lists hold non-empty text, and mice-threads is a list", () => {
      for (const field of ["themes", "contact", "authors", "keywords"]) {
        expect(errorsWith("story.md", field, [`${field}:`, "  - \"\""])).toEqual([`story.md frontmatter field ${field} must contain only non-empty strings`]);
      }
      expect(errorsWith("story.md", "contact", ["contact: me@example.com"])).toEqual(["story.md frontmatter field contact must be a list"]);
      expect(errorsWith("plot/arcs/the-key.md", "mice-threads", ["mice-threads: event"])).toEqual(["plot/arcs/the-key.md frontmatter field mice-threads must be a list"]);
    });

    test("a state entry's documented keys hold one value, not a list", () => {
      expect(errorsWith("continuity/state.md", "character-state", ["character-state:", "  - character: mara-quill", "    emotional: []"])).toEqual(["continuity/state.md character-state[0] emotional must be a single value, not a list"]);
      // An undocumented key stays free-form, as the schema leaves it.
      expect(errorsWith("continuity/state.md", "character-state", ["character-state:", "  - character: mara-quill", "    mood-notes: []"])).toEqual([]);
    });
  });
});

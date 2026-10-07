import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseClockDate } from "../src/continuity.js";
import { SCHEMA_PATH, buildSchemaDocument, checkProjectSchema, validateAgainstSchema } from "../scripts/check-schema.js";
import { calendarDayPattern, generatedPatterns, main as writeSchemaPatterns, withGeneratedPatterns } from "../scripts/schema-patterns.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
const examplesRoot = path.resolve(import.meta.dir, "..", "examples");

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  expect(io.error()).toBe("");
  expect(code).toBe(0);
}

describe("story.schema.json", () => {
  test("every example project matches the schema", () => {
    for (const name of fs.readdirSync(examplesRoot).sort()) {
      if (fs.existsSync(path.join(examplesRoot, name, "story.md"))) {
        expect(checkProjectSchema(path.join(examplesRoot, name)), name).toEqual([]);
      }
    }
  });

  test("projects scaffolded by init and add match the schema", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Schema Check", "--dir", "book", "--genre", "fantasy"]);
    const root = path.join(cwd, "book");
    const adds = [
      ["chapter", "Opening", "--number", "1"],
      ["scene", "Arrival", "--chapter", "chapter-01"],
      ["character", "Ada Reed"],
      ["location", "Old Mill"],
      ["system", "Tide Magic"],
      ["faction", "Night Guild"],
      ["artifact", "Brass Key"],
      ["arc", "Main Line"],
      ["question", "Who Lit It", "--introduced", "chapter-01"],
      ["promise", "The Letter", "--planted", "chapter-01"],
      ["clue", "Ash Print", "--planted", "chapter-01"],
      ["term", "Tideglass"]
    ];
    for (const [kind, name, ...options] of adds) {
      invoke(cwd, ["add", kind, name, "--path", root, ...options]);
    }

    const document = buildSchemaDocument(root);
    expect(document.worldbuilding.artifacts.map((artifact) => artifact.id)).toEqual(["brass-key"]);
    expect(document.glossary.map((term) => term.id)).toEqual(["tideglass"]);
    expect(validateAgainstSchema(document, schema)).toEqual([]);
  });

  test("reports schema violations with entity paths", () => {
    const root = makeTempDir();
    writeMarkdown(path.join(root, "story.md"), `
title: Broken
schema-version: 1
genre: fantasy
status: drafting
themes: []
pov: third-limited
tense: past
`);
    writeMarkdown(path.join(root, "characters", "ada-reed.md"), `
name: Ada Reed
role: sidekick
`);
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: One
number: 0
status: draft
`);
    writeMarkdown(path.join(root, "continuity", "exemptions.md"), `
exemptions:
  - pattern: abc
    reason: short
`);

    expect(checkProjectSchema(root)).toEqual([
      "$.story.schema-version: expected 2, got 1",
      "$.characters[ada-reed]: missing required status",
      "$.characters[ada-reed].role: \"sidekick\" is not one of protagonist, antagonist, supporting, minor, narrator, deuteragonist",
      "$.chapters[chapter-01].number: 0 is below the minimum 1",
      "$.continuity.exemptions[0].pattern: shorter than 4 characters"
    ]);
  });

  test("checks types, patterns, and number types", () => {
    const local = {
      type: "object",
      properties: {
        id: { type: "string", pattern: "^[a-z]+$" },
        hours: { type: "number" },
        tags: { type: "array", items: { type: "string" } }
      }
    };
    expect(validateAgainstSchema({ id: "ok", hours: 2, tags: ["a"] }, local)).toEqual([]);
    expect(validateAgainstSchema({ id: "Bad", hours: "2", tags: [null] }, local)).toEqual([
      "$.id: \"Bad\" does not match ^[a-z]+$",
      "$.hours: expected number, got string",
      "$.tags[0]: expected string, got null"
    ]);
    expect(validateAgainstSchema([], local)).toEqual(["$: expected object, got array"]);
  });

  test("refuses schema keywords it cannot enforce, even where no data reaches", () => {
    expect(() => validateAgainstSchema({}, { additionalProperties: false })).toThrow("Unsupported schema keyword additionalProperties");
    expect(() => validateAgainstSchema({}, { $ref: "other.json#/x" })).toThrow("Unsupported $ref");
    expect(() => validateAgainstSchema({}, { $ref: "#/$defs/missing" })).toThrow("Unsupported $ref");
    const absentProperty = { type: "object", properties: { author: { type: "string", maxLength: 5 } } };
    expect(() => validateAgainstSchema({}, absentProperty)).toThrow("Unsupported schema keyword maxLength at #/properties/author");
    const emptyArray = { type: "array", items: { $ref: "#/$defs/entry" }, $defs: { entry: { type: "object", uniqueItems: true } } };
    expect(() => validateAgainstSchema([], emptyArray)).toThrow("Unsupported schema keyword uniqueItems at #/$defs/entry");
  });

  test("reads the boolean schemas true and false", () => {
    expect(validateAgainstSchema(1, true)).toEqual([]);
    expect(validateAgainstSchema(1, false)).toEqual(["$: not allowed"]);
    const local = { type: "object", properties: { calendar: false, notes: true } };
    expect(validateAgainstSchema({ notes: [1] }, local)).toEqual([]);
    expect(validateAgainstSchema({ calendar: [] }, local)).toEqual(["$.calendar: not allowed"]);
    // false in an if is the usual way to say a key is absent.
    const conditional = { if: { properties: { calendar: false } }, then: { required: ["date"] } };
    expect(validateAgainstSchema({}, conditional)).toEqual(["$: missing required date"]);
    expect(validateAgainstSchema({ calendar: [] }, conditional)).toEqual([]);
  });

  test("applies keywords beside $ref", () => {
    const local = {
      type: "object",
      properties: { id: { $ref: "#/$defs/id", minLength: 4 } },
      $defs: { id: { type: "string", pattern: "^[a-z]+$" } }
    };
    expect(validateAgainstSchema({ id: "abcd" }, local)).toEqual([]);
    expect(validateAgainstSchema({ id: "AB" }, local)).toEqual([
      "$.id: \"AB\" does not match ^[a-z]+$",
      "$.id: shorter than 4 characters"
    ]);
  });

  test("ids come from filenames, not frontmatter", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Ids", "--dir", "book"]);
    const root = path.join(cwd, "book");
    writeMarkdown(path.join(root, "characters", "Bad_Name.md"), `
id: good-name
name: Bad Name
role: minor
status: alive
`);
    expect(buildSchemaDocument(root).characters.map((character) => character.id)).toEqual(["Bad_Name"]);
    expect(checkProjectSchema(root)).toEqual([
      "$.characters[Bad_Name].id: \"Bad_Name\" does not match ^[a-z0-9]+(?:-[a-z0-9]+)*$"
    ]);
  });

  // story validate reads these as not set yet and only warns (#467).
  test("publishing fields accept a [TODO] placeholder, as validate does", () => {
    const fields = schema.properties.story.properties;
    const accepts = (property, value) => validateAgainstSchema(value, property, schema).length === 0;
    for (const value of ["[TODO]", "[todo: pick one]", "  [TODO: date]"]) {
      expect(accepts(fields.language, value), value).toBe(true);
      expect(accepts(fields["publication-date"], value), value).toBe(true);
      expect(accepts(fields.subjects, [value]), value).toBe(true);
    }
    expect(accepts(fields["publication-date"], "  ")).toBe(true);
    expect(accepts(fields.language, " en-GB ")).toBe(true);
    expect(accepts(fields.subjects, [" FIC022000 "])).toBe(true);
    expect(accepts(fields.language, "english")).toBe(false);
    expect(accepts(fields.language, "")).toBe(false);
    expect(accepts(fields["publication-date"], "TODO")).toBe(false);
    expect(accepts(fields["publication-date"], "[TODOS]")).toBe(false);
    expect(accepts(fields.subjects, ["fiction"])).toBe(false);
  });

  // Without a language the book is English, which validate rejects for
  // both (#467). Which set languages qualify is left to validate.
  test("writing-mode vertical and chapter-numerals native need a language", () => {
    const story = schema.properties.story;
    const base = { title: "T", "schema-version": 2, genre: "fantasy", status: "drafting", themes: [], pov: "first", tense: "past" };
    const errors = (extra) => validateAgainstSchema({ ...base, ...extra }, story, schema);
    expect(errors({})).toEqual([]);
    expect(errors({ "writing-mode": "vertical" })).toEqual(["$: missing required language"]);
    expect(errors({ "chapter-numerals": "native" })).toEqual(["$: missing required language"]);
    expect(errors({ "writing-mode": "vertical", language: "ja" })).toEqual([]);
    expect(errors({ "chapter-numerals": "native", language: "ar" })).toEqual([]);
    expect(errors({ "writing-mode": "horizontal", "chapter-numerals": "western" })).toEqual([]);
  });

  // validate checks that a date is a real day (#530); the schema's pattern
  // is generated from the same check.
  test("the date pattern accepts exactly the days validate does", () => {
    const day = new RegExp(`^${calendarDayPattern()}$`, "u");
    const pad = (number, width) => String(number).padStart(width, "0");
    const disagreements = [];
    const compare = (text) => {
      if (day.test(text) !== (parseClockDate(text) !== undefined)) {
        disagreements.push(text);
      }
    };
    for (const year of [0, 1, 4, 100, 400, 1900, 2000, 2023, 2024, 2100, 9996, 9999]) {
      for (let month = 0; month <= 13; month += 1) {
        for (let date = 0; date <= 32; date += 1) {
          compare(`${pad(year, 4)}-${pad(month, 2)}-${pad(date, 2)}`);
        }
      }
    }
    for (let year = 0; year <= 9999; year += 1) {
      compare(`${pad(year, 4)}-02-29`);
    }
    expect(disagreements).toEqual([]);
  });

  test("the date fields take a real day", () => {
    const fields = schema.properties.story.properties;
    const accepts = (property, value) => validateAgainstSchema(value, property, schema).length === 0;
    const chapter = schema.$defs.chapter.properties;
    const session = schema.$defs.progressLog.properties.sessions.items.properties;
    for (const property of [fields.deadline, fields["release-start"], fields["publication-date"], chapter["release-date"], session.date]) {
      expect(accepts(property, "2024-02-29")).toBe(true);
      expect(accepts(property, " 2000-02-29 ")).toBe(true);
      for (const value of ["2023-02-29", "1900-02-29", "2024-13-45", "2024-04-31", "2024-00-10", "24-02-29", "soon"]) {
        expect(accepts(property, value), value).toBe(false);
      }
    }
    // Only publication-date may be blank or a placeholder.
    expect(accepts(fields["publication-date"], "")).toBe(true);
    expect(accepts(fields.deadline, "")).toBe(false);
  });

  // Without a calendar, validate reads a chapter or scene date shaped
  // YYYY-MM-DD as a real day; with one, as a day of that calendar.
  test("chapter and scene dates shaped YYYY-MM-DD are real days unless story.md has a calendar", () => {
    const story = { title: "T", "schema-version": 2, genre: "fantasy", status: "drafting", themes: [], pov: "first", tense: "past" };
    const errors = (date, extra = {}) => validateAgainstSchema({
      story: { ...story, ...extra },
      characters: [],
      worldbuilding: {},
      plot: {},
      chapters: [{ id: "chapter-01", title: "One", number: 1, status: "draft", date }],
      scenes: [{ id: "chapter-01-scene-01", title: "One", chapter: "chapter-01", scene: 1, status: "draft", date }],
      continuity: {},
      glossary: []
    }, schema);
    for (const date of ["2024-02-29", " 2024-02-29 ", "", "the night of the fire", "3 Thaw 301 AE", "2024-13"]) {
      expect(errors(date), date).toEqual([]);
    }
    expect(errors("2023-02-29")).toEqual([
      `$.chapters[chapter-01].date: "2023-02-29" does not match ${schema.$defs.realDateOrText.pattern}`,
      `$.scenes[chapter-01-scene-01].date: "2023-02-29" does not match ${schema.$defs.realDateOrText.pattern}`
    ]);
    expect(errors("2024-13-45", { calendar: [{ month: "Thaw", days: 50 }] })).toEqual([]);
  });

  test("the generated patterns are up to date (run node scripts/schema-patterns.js)", () => {
    for (const [pointer, pattern] of Object.entries(generatedPatterns())) {
      expect(pointer.split("/").slice(1).reduce((node, key) => node[key], schema), pointer).toBe(pattern);
    }
    expect(withGeneratedPatterns(fs.readFileSync(SCHEMA_PATH, "utf8"))).toBe(fs.readFileSync(SCHEMA_PATH, "utf8"));
  });

  test("scripts/schema-patterns.js writes the patterns in place and keeps the layout", () => {
    const file = path.join(makeTempDir(), "story.schema.json");
    const text = fs.readFileSync(SCHEMA_PATH, "utf8");
    const current = schema.$defs.realDate.pattern;
    fs.writeFileSync(file, text.replace(JSON.stringify(current), JSON.stringify("^stale$")));
    const log = [];
    writeSchemaPatterns(file, (line) => log.push(line));
    expect(fs.readFileSync(file, "utf8")).toBe(text);
    writeSchemaPatterns(file, (line) => log.push(line));
    expect(log).toEqual([`Wrote the generated patterns into ${file}`, "The generated schema patterns are up to date"]);
    expect(() => withGeneratedPatterns(text.replace(/"pattern": "[^"]*",\s*"\$comment": "Generated by scripts\/schema-patterns.js from parseClockDate/, `"$comment": "Generated by scripts/schema-patterns.js from parseClockDate`))).toThrow("The schema has no pattern at /$defs/realDate/pattern");
    const twice = text.replace(JSON.stringify(schema.$defs.realDateOrText.pattern), JSON.stringify(current));
    expect(() => withGeneratedPatterns(twice)).toThrow("The pattern at /$defs/realDate/pattern must appear once in the schema");
  });
});

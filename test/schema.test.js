import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseClockDate } from "../src/continuity.js";
import { GRANDFATHERED, PACKS } from "../src/languages/index.js";
import { validateChapterNumerals } from "../src/numerals.js";
import { validateWritingMode } from "../src/typesetting.js";
import { SCHEMA_PATH, buildSchemaDocument, checkProjectSchema, validateAgainstSchema } from "../scripts/check-schema.js";
import { calendarDayPattern, generatedPatterns, main as writeSchemaPatterns, tableCodes, withGeneratedPatterns } from "../scripts/schema-patterns.js";
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

  test("checks a maximum", () => {
    const local = { type: "object", properties: { hours: { type: "integer", minimum: 1, maximum: 100 } } };
    expect(validateAgainstSchema({ hours: 100 }, local)).toEqual([]);
    expect(validateAgainstSchema({ hours: 101 }, local)).toEqual(["$.hours: 101 is above the maximum 100"]);
    expect(validateAgainstSchema({ hours: 0 }, local)).toEqual(["$.hours: 0 is below the minimum 1"]);
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
    // Wherever a subschema can stand: items, if, then, allOf, and a $ref.
    expect(validateAgainstSchema([1, 2], { items: false })).toEqual(["$[0]: not allowed", "$[1]: not allowed"]);
    expect(validateAgainstSchema([], { items: false })).toEqual([]);
    expect(validateAgainstSchema([1], { items: true })).toEqual([]);
    expect(validateAgainstSchema({ calendar: [] }, { if: { required: ["calendar"] }, then: false })).toEqual(["$: not allowed"]);
    expect(validateAgainstSchema({}, { if: { required: ["calendar"] }, then: false })).toEqual([]);
    expect(validateAgainstSchema({}, { if: false, then: { required: ["date"] } })).toEqual([]);
    expect(validateAgainstSchema({}, { if: true, then: { required: ["date"] } })).toEqual(["$: missing required date"]);
    expect(validateAgainstSchema(1, { allOf: [true, false] })).toEqual(["$: not allowed"]);
    expect(validateAgainstSchema(1, { $ref: "#/$defs/never", $defs: { never: false } })).toEqual(["$: not allowed"]);
    expect(validateAgainstSchema(1, { $ref: "#/$defs/always", $defs: { always: true } })).toEqual([]);
    expect(() => validateAgainstSchema({}, { if: false })).toThrow("Schema if without then at #");
    expect(() => validateAgainstSchema({}, { then: false })).toThrow("Schema then without if at #");
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
  // both (#467).
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

  // validate refuses writing-mode vertical for a language set horizontally
  // (#529), and chapter-numerals native for one that prints 0-9, and so
  // does the schema, with patterns generated from the same tables.
  test("writing-mode vertical and chapter-numerals native take only a language that has them", () => {
    const story = schema.properties.story;
    const base = { title: "T", "schema-version": 2, genre: "fantasy", status: "drafting", themes: [], pov: "first", tense: "past" };
    const accepts = (extra, language) => validateAgainstSchema({ ...base, ...extra, language }, story, schema).length === 0;
    const vertical = { "writing-mode": "vertical" };
    for (const language of ["ja", " KO ", "zh-Hant-TW", "yue", "zh-yue", "jpn", "en-Hani", "ja-JP-x-latn", "zh-min-nan"]) {
      expect(accepts(vertical, language), language).toBe(true);
    }
    for (const language of ["en", "fr-CA", "ar", "ja-Latn", "zh-Latn-pinyin", "mn-Mong", "ja-kok", "[TODO: pick one]"]) {
      expect(accepts(vertical, language), language).toBe(false);
    }
    const native = { "chapter-numerals": "native" };
    for (const language of ["ar", "fa-IR", "hi", "th", "ja", "zh-TW", "az-IR", "uz-AF", "az-Arab", "prs", "zh-yue", "ko-abc-Hani", "mn-Mong", " NQO ", "urd", "pus", "snd", "uig"]) {
      expect(accepts(native, language), language).toBe(true);
    }
    for (const language of ["en", "ko", "ko-Hani", "kor-Hani", "he", "ru", "az", "az-Latn-IR", "ar-Latn", "ar-syr", "[TODO]"]) {
      expect(accepts(native, language), language).toBe(false);
    }
  });

  // Each language rule with the check validate runs for it.
  const LANGUAGE_RULES = [
    ["writing-mode vertical", 0, (language) => {
      const errors = [];
      validateWritingMode({ "writing-mode": "vertical", language }, errors);
      return errors.length === 0;
    }],
    ["chapter-numerals native", 1, (language) => {
      const errors = [];
      validateChapterNumerals({ "chapter-numerals": "native", language }, errors);
      return errors.length === 0;
    }]
  ];
  const isTag = (value) => /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(value);
  // The tags in `tags` (and `forms` of each) where the schema's pattern for
  // a rule and validate disagree, and how many validate accepts.
  function compareLanguages(at, validates, tags, forms = (tag) => [tag]) {
    const pattern = new RegExp(schema.properties.story.allOf[at].then.properties.language.pattern, "u");
    const disagreements = [];
    let accepted = 0;
    for (const language of tags.filter(isTag).flatMap(forms)) {
      const valid = validates(language);
      accepted += valid ? 1 : 0;
      if (pattern.test(language) !== valid) {
        disagreements.push(language);
      }
    }
    return { disagreements, accepted };
  }

  // Tags built from every code, script, and region the tables name, with
  // an extlang, a variant, private use, and extensions, and without an
  // extlang also in upper case and with spaces around them.
  test("the language patterns accept exactly the tags validate does", () => {
    const codes = [...tableCodes(), "qaa", "xyz"];
    const extlangs = codes.filter((code) => code.length === 3);
    const scripts = ["Hans", "hant", "Jpan", "kore", "Hang", "Hira", "Kana", "Bopo", "Hani", "Latn", "Cyrl", "Mong", "Arab", "Deva", "Beng", "Thai", "Nkoo", "Hebr", "Abcd"];
    const tags = new Set([...Object.keys(GRANDFATHERED), ...PACKS.keys()]);
    for (const code of codes) {
      for (const tail of ["", "-JP", "-tw", "-CN", "-IR", "-af", "-419", "-hepburn", "-x-hani", "-u-nu-latn", "-1994"]) {
        tags.add(`${code}${tail}`);
      }
      for (const script of scripts) {
        tags.add(`${code}-${script}`);
        tags.add(`${code}-${script}-TW`);
      }
      for (const extlang of extlangs) {
        for (const tail of ["", "-HK", "-IR", "-Latn", "-Hant", "-hepburn"]) {
          tags.add(`${code}-${extlang}${tail}`);
        }
      }
    }
    const forms = (tag) => (tag.split("-")[1]?.length === 3 ? [tag] : [tag, tag.toUpperCase(), ` ${tag}\t`]);
    for (const [name, at, validates] of LANGUAGE_RULES) {
      const { disagreements, accepted } = compareLanguages(at, validates, [...tags], forms);
      expect(disagreements, name).toEqual([]);
      expect(accepted, name).toBeGreaterThan(1000);
    }
  });

  // The same, without the generator's list of codes: every two- and
  // three-letter code, alone and with a region, an extlang, or a script.
  test("the language patterns agree with validate on every two- and three-letter code", () => {
    const letters = [..."abcdefghijklmnopqrstuvwxyz"];
    const codes = letters.flatMap((first) => letters.flatMap((second) => [`${first}${second}`, ...letters.map((third) => `${first}${second}${third}`)]));
    const forms = (code) => [code, `${code}-TW`, `${code}-IR`, `${code}-yue`, `${code}-prs-AF`, `${code}-Hani`];
    for (const [name, at, validates] of LANGUAGE_RULES) {
      const { disagreements, accepted } = compareLanguages(at, validates, codes, forms);
      expect(disagreements, name).toEqual([]);
      expect(accepted, name).toBeGreaterThan(10000);
    }
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

  // Editors check frontmatter against the schema with backtracking regex
  // engines, where two quantifiers that can match the same text, such as
  // \s*(?:day)?\s*, take quadratic time on a long value that fails. So each
  // generated pattern must do about 8 times the work on input 8 times as
  // long; quadratic work would be about 64 times. Each run is repeated
  // until it takes long enough to time, and the best of three counts.
  test("the generated patterns take linear time on long input that fails", () => {
    const time = (regex, text, repeat) => {
      let best = Infinity;
      for (let round = 0; round < 3; round += 1) {
        const start = performance.now();
        for (let index = 0; index < repeat; index += 1) {
          regex.test(text);
        }
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    const inputs = [
      (n) => `${" ".repeat(n)}x`,
      (n) => `2024-02-29${" ".repeat(n)}x`,
      (n) => `${" ".repeat(n)}2024-02-29${" ".repeat(n)}x`,
      (n) => `${"\t ".repeat(n)}[TODO`,
      (n) => `ja${"-a".repeat(n)}!`,
      (n) => `zh-yue${"-abcdefgh".repeat(n)} !`,
      (n) => `${"a".repeat(n)}`,
      (n) => `${"0".repeat(n)}-`,
      (n) => `${"-".repeat(n)}`
    ];
    const slow = [];
    for (const [pointer, source] of Object.entries(generatedPatterns())) {
      const regex = new RegExp(source, "u");
      for (const [index, input] of inputs.entries()) {
        const short = input(500);
        let repeat = 1;
        while (time(regex, short, repeat) < 1 && repeat < 1 << 14) {
          repeat *= 2;
        }
        const ratio = time(regex, input(4000), repeat) / time(regex, short, repeat);
        if (ratio > 24) {
          slow.push(`${pointer} input ${index}: ${ratio.toFixed(1)} times the work`);
        }
      }
    }
    expect(slow).toEqual([]);
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

describe("review fixes", () => {
  test("the schema rejects zero-hour routes and accepts numeric isbns", () => {
    const schema = {
      type: "object",
      properties: { hours: { type: "number", exclusiveMinimum: 0 }, isbn: { type: ["string", "integer"] } }
    };
    expect(validateAgainstSchema({ hours: 0, isbn: 9780306406157 }, schema)).toEqual(["$.hours: 0 must be greater than 0"]);
    expect(validateAgainstSchema({ hours: 0.5, isbn: "978" }, schema)).toEqual([]);
    expect(validateAgainstSchema({ isbn: true }, schema)).toEqual(["$.isbn: expected string or integer, got boolean"]);
  });
});

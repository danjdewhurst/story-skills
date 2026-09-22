import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { SCHEMA_PATH, buildSchemaDocument, checkProjectSchema, validateAgainstSchema } from "../scripts/check-schema.js";
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
});

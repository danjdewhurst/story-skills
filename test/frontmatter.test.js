import { describe, expect, test } from "bun:test";
import { parseFrontmatter, replaceFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";

describe("frontmatter utilities", () => {
  test("parses scalars, arrays, object arrays, numbers, floats, comments, and quoted text", () => {
    const parsed = parseFrontmatter(`---
# ignored
name: "Sera Voss"
age: 28
rating: 4.5
aliases:
  - "The Lost Heir"
relationships:
  - character: kael-voss
    type: sibling
empty: []
---
Body`);

    expect(parsed.data).toEqual({
      name: "Sera Voss",
      age: 28,
      rating: 4.5,
      aliases: ["The Lost Heir"],
      relationships: [{ character: "kael-voss", type: "sibling" }],
      empty: []
    });
    expect(parsed.body).toBe("Body");
    expect(parsed.raw).toContain("name:");
  });

  test("parses bare keys with no value as empty strings", () => {
    const parsed = parseFrontmatter(`---
introduced:
aliases: []
resolved:
---
Body`);

    expect(parsed.data).toEqual({ introduced: "", aliases: [], resolved: "" });
  });

  test("round-trips scalars containing quotes and numeric-looking strings", () => {
    const original = {
      title: 'He said "run" and left',
      note: "with: colon",
      year: "1984",
      count: 7
    };

    const parsed = parseFrontmatter(`${stringifyFrontmatter(original)}Body`);
    expect(parsed.data).toEqual(original);

    const again = parseFrontmatter(`${stringifyFrontmatter(parsed.data)}Body`);
    expect(again.data).toEqual(original);
  });

  test("strips quotes from hand-written values that are not valid JSON", () => {
    const parsed = parseFrontmatter(`---
bad: "a\\qb"
single: 'The Lost Heir'
tiny: "
---
Body`);

    expect(parsed.data).toEqual({ bad: "a\\qb", single: "The Lost Heir", tiny: '"' });
  });

  test("stringifies and replaces frontmatter", () => {
    const yaml = stringifyFrontmatter({
      title: "The Last Ember",
      number: 1,
      tags: ["ember-bearer"],
      relationships: [{ character: "kael-voss", type: "sibling" }],
      empty: [],
      blank: null
    });

    expect(yaml).toContain("title: The Last Ember");
    expect(yaml).toContain("number: 1");
    expect(yaml).toContain("empty: []");
    expect(yaml).toContain("blank: ");

    const replaced = replaceFrontmatter("---\ntitle: Old\n---\nBody", { title: "New" });
    expect(replaced).toBe("---\ntitle: New\n---\n\nBody");
  });

  test("rejects missing or unsupported frontmatter", () => {
    expect(() => parseFrontmatter("Body", "body.md")).toThrow("body.md is missing YAML frontmatter");
    expect(() => parseFrontmatter("---\n  nope\n---\n")).toThrow("Unsupported frontmatter line");
    expect(() => replaceFrontmatter("Body", { title: "Nope" })).toThrow("Cannot replace missing YAML frontmatter");
  });

  test("rejects duplicate top-level keys instead of overwriting", () => {
    expect(() => parseFrontmatter("---\ntitle: A\ntitle: B\n---\nBody")).toThrow(
      "Duplicate frontmatter key: title"
    );
    expect(() => parseFrontmatter("---\ntags:\n  - a\ntags:\n  - b\n---\nBody")).toThrow(
      "Duplicate frontmatter key: tags"
    );
    expect(() => parseFrontmatter("---\ntitle: A\ntitle:\n  - b\n---\nBody")).toThrow(
      "Duplicate frontmatter key: title"
    );
  });

  test("rejects duplicate keys inside list objects", () => {
    expect(() =>
      parseFrontmatter("---\nrelationships:\n  - character: a\n    character: b\n---\nBody")
    ).toThrow("Duplicate frontmatter key: character");
  });

  test("tolerates a UTF-8 BOM before the opening delimiter", () => {
    const parsed = parseFrontmatter("\uFEFF---\ntitle: BOM\n---\nBody");

    expect(parsed.data).toEqual({ title: "BOM" });
    expect(parsed.body).toBe("Body");
  });

  test("tolerates trailing spaces and tabs after frontmatter delimiters", () => {
    const parsed = parseFrontmatter("---   \ntitle: Spaced\n---\t \nBody");

    expect(parsed.data).toEqual({ title: "Spaced" });
    expect(parsed.body).toBe("Body");
  });

  test("parses literal true and false as booleans", () => {
    const parsed = parseFrontmatter("---\nsignificance-delayed: false\nsequel: true\n---\nBody");

    expect(parsed.data).toEqual({ "significance-delayed": false, sequel: true });
  });

  test("round-trips booleans through stringify", () => {
    const parsed = parseFrontmatter(stringifyFrontmatter({ "significance-delayed": false, sequel: true }));

    expect(parsed.data).toEqual({ "significance-delayed": false, sequel: true });
  });
});

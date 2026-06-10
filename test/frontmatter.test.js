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
});

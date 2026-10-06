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
    expect(replaced).toBe("---\ntitle: New\n---\nBody");
  });

  test("keeps comments and stays byte-stable across repeated rewrites", () => {
    const original = "---\n# keep me\ntitle: Old\n\nstatus: draft\n# tail\n---\n\nBody\n";
    const once = replaceFrontmatter(original, { title: "New", status: "draft" });
    const twice = replaceFrontmatter(once, { title: "New", status: "draft" });

    expect(once).toBe("---\n# keep me\ntitle: New\n\nstatus: draft\n# tail\n---\n\nBody\n");
    expect(twice).toBe(once);
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

  test("quotes strings that would parse as booleans, null, or numbers", () => {
    const yaml = stringifyFrontmatter({ a: "true", b: "false", c: "null", d: "1984", e: "-3.5", f: "plain" });
    expect(yaml).toContain('a: "true"');
    expect(yaml).toContain('b: "false"');
    expect(yaml).toContain('c: "null"');
    expect(yaml).toContain('d: "1984"');
    expect(yaml).toContain('e: "-3.5"');

    const parsed = parseFrontmatter(yaml + "Body");
    expect(parsed.data.a).toBe("true");
    expect(parsed.data.b).toBe("false");
    expect(parsed.data.c).toBe("null");
    expect(parsed.data.d).toBe("1984");
    expect(parsed.data.e).toBe("-3.5");
    expect(parsed.data.f).toBe("plain");
  });

  test("rejects empty mappings instead of crashing on entries[0]", () => {
    expect(() => stringifyFrontmatter({ tags: [{}] })).toThrow("Cannot stringify empty mapping in tags");
  });

  test("parses __proto__ keys as own data without polluting prototypes", () => {
    const parsed = parseFrontmatter("---\n__proto__: polluted\ntitle: x\n---\nBody");
    expect(Object.prototype.hasOwnProperty.call(parsed.data, "__proto__")).toBe(true);
    expect(parsed.data["__proto__"]).toBe("polluted");
    expect({}.polluted).toBeUndefined();

    const nested = parseFrontmatter("---\nrel:\n  - character: a\n    __proto__: x\n---\nBody");
    expect(nested.data.rel[0]["__proto__"]).toBe("x");
    expect({}.x).toBeUndefined();
  });

  test("replaceFrontmatter is idempotent and keeps body spacing exactly", () => {
    let markdown = "---\ntitle: X\ncount: 1\n---\n\n\n# X\n\nBody\n";
    for (let index = 0; index < 3; index += 1) {
      const { data } = parseFrontmatter(markdown);
      markdown = replaceFrontmatter(markdown, { ...data, count: data.count + 1 });
    }
    expect(markdown).toBe("---\ntitle: X\ncount: 4\n---\n\n\n# X\n\nBody\n");
    expect(replaceFrontmatter("---\ntitle: X\n---", { title: "Y" })).toBe("---\ntitle: Y\n---");
    expect(replaceFrontmatter("---\r\ntitle: X\r\n---\r\nBody", { title: "X", n: 2 })).toBe("---\r\ntitle: X\r\nn: 2\r\n---\r\nBody");
  });

  test("replaceFrontmatter keeps comments, unchanged formatting, and nested empty lists", () => {
    const markdown = [
      "---",
      "# TODO: pick POV",
      "version: 1.10",
      "title: 'Quoted Title'",
      "big: 12345678901234567890",
      "",
      "items:",
      "  - id: a",
      "    tags: []",
      "  - []",
      "  - id: b",
      "    weight: 2.50",
      "word-count: 10",
      "# trailing note",
      "---",
      "Body"
    ].join("\n");
    const { data } = parseFrontmatter(markdown);
    const next = replaceFrontmatter(markdown, {
      ...data,
      items: data.items.concat({ id: "c", tags: [] }),
      "word-count": 20
    });
    expect(next).toBe([
      "---",
      "# TODO: pick POV",
      "version: 1.10",
      "title: 'Quoted Title'",
      "big: 12345678901234567890",
      "",
      "items:",
      "  - id: a",
      "    tags: []",
      "  - []",
      "  - id: b",
      "    weight: 2.50",
      "  - id: c",
      "    tags: []",
      "word-count: 20",
      "# trailing note",
      "---",
      "Body"
    ].join("\n"));
    expect(parseFrontmatter(next).data.items[3]).toEqual({ id: "c", tags: [] });

    const removed = replaceFrontmatter(markdown, { ...data, items: [data.items[2]], version: undefined });
    expect(removed).toContain("items:\n  - id: b\n    weight: 2.50\n");
    expect(removed).toContain("version: \n");
    const { version, ...withoutVersion } = data;
    expect(replaceFrontmatter(markdown, withoutVersion)).not.toContain("version");
  });

  test("stringifies nested lists as flow lists and rejects deeper nesting", () => {
    const yaml = stringifyFrontmatter({ items: [{ id: "a", tags: [] }, []] });
    expect(yaml).toContain("    tags: []\n  - []\n");
    expect(parseFrontmatter(`${yaml}Body`).data.items).toEqual([{ id: "a", tags: [] }, []]);

    const nested = { items: [{ id: "a", tags: ["x", "a, b", "#1", "", "[draft]", 3, true] }, ["y"]] };
    const written = stringifyFrontmatter(nested);
    expect(written).toContain('    tags: [x, "a, b", "#1", "", "[draft]", 3, true]\n  - [y]\n');
    expect(parseFrontmatter(`${written}Body`).data).toEqual(nested);
    expect(() => stringifyFrontmatter({ items: [{ id: "a", tags: [["x"]] }] })).toThrow("inside a nested list");
  });

  test("parses flow lists, with quotes, trailing commas, and comments", () => {
    const parsed = parseFrontmatter(`---
characters: [sera-voss, kael-voss]
quoted: ["Sera, the heir", 'it''s', "# not a comment"] # a comment
spaced: [ a ,b, ]
empty: [ ]
numbers: [1, 2.5, true, ~]
todo: [TODO: author to supply]
---
Body`);

    expect(parsed.data).toEqual({
      characters: ["sera-voss", "kael-voss"],
      quoted: ["Sera, the heir", "it's", "# not a comment"],
      spaced: ["a", "b"],
      empty: [],
      numbers: [1, 2.5, true, ""],
      todo: "[TODO: author to supply]"
    });
  });

  test("parses list items at column 0 and blank or comment lines between items", () => {
    const parsed = parseFrontmatter(`---
themes:
- loyalty
- grief # strongest in act two
relationships:
-   character: kael-voss
    type: sibling

# the rival
-   character: mara
    type: rival
locations:

  - harbour

  # later
  - keep
title: The Bell
---
Body`);

    expect(parsed.data).toEqual({
      themes: ["loyalty", "grief"],
      relationships: [{ character: "kael-voss", type: "sibling" }, { character: "mara", type: "rival" }],
      locations: ["harbour", "keep"],
      title: "The Bell"
    });
  });

  test("parses literal and folded block scalars with chomping indicators", () => {
    const parsed = parseFrontmatter(`---
literal: |
  First line
    indented # kept

  Last line
folded: >
  One
  sentence.

  New paragraph.
strip: |-
  no newline
keep: >+
  kept

next: plain
items:
  - note: |
      inside an item
    type: x
  - >-
    folded item
blank: |

poem: >
  Lines

    kept as written
  then folded
  together
---
Body`);

    expect(parsed.data).toEqual({
      literal: "First line\n  indented # kept\n\nLast line\n",
      folded: "One sentence.\nNew paragraph.\n",
      strip: "no newline",
      keep: "kept\n\n",
      next: "plain",
      items: [{ note: "inside an item\n", type: "x" }, "folded item"],
      blank: "",
      poem: "Lines\n\n  kept as written\nthen folded together\n"
    });
  });

  test("reads null and ~ as empty values", () => {
    const parsed = parseFrontmatter("---\npov: ~\nlocation: null\nquoted: \"~\"\n---\nBody");

    expect(parsed.data).toEqual({ pov: "", location: "", quoted: "~" });
  });

  test("strips inline comments after whitespace but keeps other # characters", () => {
    const parsed = parseFrontmatter(`---
title: The Bell # draft title
number: 3 # renumber later
hashtag: Issue#4
key:#raw
double: "Ash # Ember" # note
single: 'Ash # Ember'
tags:
  - "#1" # first
  - C#
empty: # nothing yet
---
Body`);

    expect(parsed.data).toEqual({
      title: "The Bell",
      number: 3,
      hashtag: "Issue#4",
      key: "#raw",
      double: "Ash # Ember",
      single: "Ash # Ember",
      tags: ["#1", "C#"],
      empty: ""
    });
  });

  test("reads a list item URL as a string, not a mapping", () => {
    expect(parseFrontmatter("---\nsources:\n  - https://example.com/tides\n---\nBody").data.sources).toEqual(["https://example.com/tides"]);
  });

  test("rejects unsupported YAML with the line number and a corrected example", () => {
    const failure = (yaml) => {
      try {
        parseFrontmatter(`---\n${yaml}\n---\nBody`, "story.md");
      } catch (error) {
        return error.message;
      }
      return null;
    };

    expect(failure("title: A\nmeta:\n  author: me")).toBe("Unsupported frontmatter line: author: me (line 4). Nested fields are not supported. Write a list of key: value items, such as relationships: then   - character: sera-voss");
    expect(failure("title: A\n- stray")).toContain("Unsupported frontmatter line: - stray (line 3). Put list items under a key, such as characters: then - sera-voss");
    expect(failure("my title: A")).toContain("(line 2). Write each field as key: value");
    expect(failure("summary: one\n  two")).toContain("(line 3). Write a value that runs over several lines as a block scalar");
    expect(failure("tags:\n  - a\n    - b")).toContain("(line 4). Lists inside lists are not supported");
    expect(failure("rel:\n  - character: a\n     type: b")).toContain("(line 4). Line up every key of a list item under its first key");
    expect(failure("tags: [a, [b]]")).toContain("(line 2). Lists inside lists are not supported");
    expect(failure("tags: [a, b")).toContain("(line 2). Close the list with ]");
    expect(failure("note: [sic] text")).toContain("quote a value that starts with [");
    expect(failure("tags: [a,, b]")).toContain("Remove the empty entry");
    expect(failure("tags: [a: b]")).toContain("Flow mappings are not supported");
    expect(failure("type: {family|guild}")).toContain("(line 2). Flow mappings are not supported. Quote the value");
    expect(failure("epigraph: > quoted")).toContain('Quote a value that starts with >, such as epigraph: "> text"');
    expect(failure("note: *bold*")).toContain('Anchors, aliases, and tags are not supported. Quote the value, such as note: "*bold*"');
    expect(failure("summary: |\n    deep\n  shallow")).toContain("(line 4). Indent every line of a block scalar");
    expect(failure("tags: [\"a, b]")).toContain("(line 2). Close each quoted entry");
    expect(failure("tags: [\"a\"  x, b]")).toContain("(line 2). Separate list entries with commas");
    expect(failure("tags:\n  - - a")).toContain("(line 3). Lists inside lists are not supported");
    expect(failure("tags:\n  - one\n    two")).toContain("(line 4). Write a value that runs over several lines as a block scalar, such as   - |");
    expect(failure("title: A\ntitle: B")).toBe("Duplicate frontmatter key: title (line 3). Remove or rename one of the two entries");
  });

  test("rewrites keep new syntax verbatim and write changed values deterministically", () => {
    const markdown = [
      "---",
      "title: The Bell # draft",
      "pov: ~",
      "summary: >",
      "  Folded",
      "  text.",
      "",
      "characters: [sera-voss, kael-voss]",
      "themes:",
      "- loyalty",
      "- grief",
      "relationships:",
      "- character: kael-voss",
      "  type: sibling",
      "status: draft",
      "---",
      "Body"
    ].join("\n");
    const { data } = parseFrontmatter(markdown);
    expect(replaceFrontmatter(markdown, data)).toBe(markdown);

    const next = replaceFrontmatter(markdown, {
      ...data,
      characters: [...data.characters, "mara"],
      themes: [...data.themes, "home"],
      relationships: [{ ...data.relationships[0], type: "rival" }],
      status: "revised"
    });
    expect(next).toBe([
      "---",
      "title: The Bell # draft",
      "pov: ~",
      "summary: >",
      "  Folded",
      "  text.",
      "",
      "characters:",
      "  - sera-voss",
      "  - kael-voss",
      "  - mara",
      "themes:",
      "- loyalty",
      "- grief",
      "- home",
      "relationships:",
      "- character: kael-voss",
      "  type: rival",
      "status: revised",
      "---",
      "Body"
    ].join("\n"));
    expect(replaceFrontmatter(next, parseFrontmatter(next).data)).toBe(next);

    const summary = replaceFrontmatter(markdown, { ...data, summary: "Line one\nLine two" });
    expect(summary).toContain('summary: "Line one\\nLine two"\n\ncharacters:');
    expect(parseFrontmatter(summary).data.summary).toBe("Line one\nLine two");
  });

  test("does not mix original and new key lines in a list item indented its own way", () => {
    const markdown = "---\nrel:\n-   character: a\n    type: b\n---\nBody";
    const next = replaceFrontmatter(markdown, { rel: [{ character: "a", type: "c" }] });

    expect(next).toBe("---\nrel:\n- character: a\n  type: c\n---\nBody");
    expect(parseFrontmatter(next).data.rel).toEqual([{ character: "a", type: "c" }]);
  });
});

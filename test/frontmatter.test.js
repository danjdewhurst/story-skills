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

kept-blank: |+


folded-blank: >+

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
      "kept-blank": "\n\n",
      "folded-blank": "\n",
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
    expect(failure("tags: [ok, *shared]")).toContain('(line 2). Anchors, aliases, and tags are not supported. Quote the entry, such as tags: ["*shared"]');
    expect(failure("tags: [&a foo]")).toContain("Anchors, aliases, and tags are not supported");
    expect(failure("tags: [!tag x]")).toContain("Anchors, aliases, and tags are not supported");
    expect(failure("tags: [alpha, beta # comment]")).toContain("(line 2). Close the list with ]");
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
      "characters: [sera-voss, kael-voss, mara]",
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

  test("keeps blank and comment lines inside a list when items change", () => {
    const markdown = [
      "---",
      "characters:",
      "  # the leads",
      "  - sera-voss",
      "",
      "  # the brother",
      "  - kael-voss",
      "relationships:",
      "  - character: kael-voss",
      "    # why they fight",
      "    type: sibling",
      "    note: |",
      "      Old",
      "      grudge",
      "",
      "  # the rival",
      "  - character: mara",
      "    type: rival",
      "---",
      "Body"
    ].join("\n");
    const { data } = parseFrontmatter(markdown);
    const renamed = (id) => (id === "kael-voss" ? "kael-storm" : id);
    const next = replaceFrontmatter(markdown, {
      characters: data.characters.map(renamed),
      relationships: data.relationships.map((entry) => ({ ...entry, character: renamed(entry.character) }))
    });

    expect(next).toBe([
      "---",
      "characters:",
      "  # the leads",
      "  - sera-voss",
      "",
      "  # the brother",
      "  - kael-storm",
      "relationships:",
      "  - character: kael-storm",
      "    # why they fight",
      "    type: sibling",
      "    note: |",
      "      Old",
      "      grudge",
      "",
      "  # the rival",
      "  - character: mara",
      "    type: rival",
      "---",
      "Body"
    ].join("\n"));
    expect(replaceFrontmatter(next, parseFrontmatter(next).data)).toBe(next);

    const dropped = replaceFrontmatter(markdown, { ...data, characters: ["kael-voss"] });
    expect(dropped).toContain("characters:\n  # the leads\n\n  # the brother\n  - kael-voss\nrelationships:");
  });

  test("does not mix original and new key lines in a list item indented its own way", () => {
    const markdown = "---\nrel:\n-   character: a\n    type: b\n---\nBody";
    const next = replaceFrontmatter(markdown, { rel: [{ character: "a", type: "c" }] });

    expect(next).toBe("---\nrel:\n- character: a\n  type: c\n---\nBody");
    expect(parseFrontmatter(next).data.rel).toEqual([{ character: "a", type: "c" }]);
  });
  test("writes line separators, DEL, C1 controls, and a byte order mark as escapes that read back", () => {
    const data = {
      name: "Sera\u2028Voss",
      note: "one\u2029two",
      next: "a\u0085b",
      del: "x\u007fy",
      c1: "\u0080\u009f",
      bom: "\ufeffmark",
      cr: "a\rb",
      tags: ["Sera\u2028Voss", "plain"],
      items: [{ id: "a", tags: ["b\u2029c", "d"] }]
    };
    const yaml = stringifyFrontmatter(data);
    expect(yaml).toContain('name: "Sera\\u2028Voss"\n');
    expect(yaml).toContain('note: "one\\u2029two"\n');
    expect(yaml).toContain('next: "a\\u0085b"\n');
    expect(yaml).toContain('del: "x\\u007fy"\n');
    expect(yaml).toContain('c1: "\\u0080\\u009f"\n');
    expect(yaml).toContain('bom: "\\ufeffmark"\n');
    expect(yaml).toContain('cr: "a\\rb"\n');
    expect(yaml).toContain('  - "Sera\\u2028Voss"\n');
    expect(yaml).toContain('    tags: ["b\\u2029c", d]\n');
    expect(yaml).not.toMatch(/[\r\u007f-\u009f\u2028\u2029\ufeff]/);
    expect(parseFrontmatter(`${yaml}Body`).data).toEqual(data);

    const replaced = replaceFrontmatter("---\nname: Sera\n---\nBody", { name: "Sera\u2028Voss" });
    expect(replaced).toBe('---\nname: "Sera\\u2028Voss"\n---\nBody');
    expect(parseFrontmatter(replaced).data.name).toBe("Sera\u2028Voss");
  });

  test("reads U+2028 and U+2029 in a hand-written value as text and rejects a lone carriage return", () => {
    const parsed = parseFrontmatter("---\nname: Sera\u2028Voss # lead\ntags:\n  - one\u2029two\nrel:\n  - character: a\u2028b\n    type: c\u2029d\n---\nBody");
    expect(parsed.data).toEqual({ name: "Sera\u2028Voss", tags: ["one\u2029two"], rel: [{ character: "a\u2028b", type: "c\u2029d" }] });

    for (const yaml of ["name: Sera\rVoss", "# a\rcomment", "tags:\n  - a\rb", "summary: |\n  a\rb"]) {
      expect(() => parseFrontmatter(`---\n${yaml}\n---\nBody`, "story.md")).toThrow("Unsupported line break: a carriage return with no line feed after it (line ");
    }
    expect(() => parseFrontmatter("---\r\ntitle: A\r\nname: B\rC\r\n---\r\nBody")).toThrow('a carriage return with no line feed after it (line 3). Remove it, or write it as \\r inside a double-quoted value, such as note: "a\\rb"');
  });

  test("reads the YAML 1.2 core spellings of true and false as booleans", () => {
    const parsed = parseFrontmatter("---\na: True\nb: TRUE\nc: False\nd: FALSE\ne: tRUE\nf: yes\ng: Off\nlist: [True, FALSE]\nitems:\n  - True\n  - id: x\n    flag: False\n---\nBody");

    expect(parsed.data).toEqual({ a: true, b: true, c: false, d: false, e: "tRUE", f: "yes", g: "Off", list: [true, false], items: [true, { id: "x", flag: false }] });
    expect(stringifyFrontmatter({ a: "True", b: "FALSE", c: "tRUE" })).toBe('---\na: "True"\nb: "FALSE"\nc: "tRUE"\n---\n\n');
  });

  test("writes numbers in plain decimal so they read back as numbers, and keeps 1e21 as written", () => {
    const numbers = { big: 1e21, bigger: -1.2345e25, small: 1.5e-7, tiny: -5e-324, max: Number.MAX_VALUE, list: [1e21], items: [{ n: 2e-7, tags: [3e22] }] };
    const yaml = stringifyFrontmatter(numbers);
    expect(yaml).toContain("big: 1000000000000000000000\n");
    expect(yaml).toContain("bigger: -12345000000000000000000000\n");
    expect(yaml).toContain("small: 0.00000015\n");
    expect(yaml).toContain("  - n: 0.0000002\n    tags: [30000000000000000000000]\n");
    expect(yaml).not.toContain("e+");
    expect(parseFrontmatter(`${yaml}Body`).data).toEqual(numbers);

    const markdown = "---\nfloat: 1e21\nhuge: 1000000000000000000000\ntags: [1e21, 1.10, 'Sera', old]\nlist:\n  - 1e21\n  - old\nword-count: 5\n---\nBody";
    const { data } = parseFrontmatter(markdown);
    expect(data).toEqual({ float: "1e21", huge: 1e21, tags: ["1e21", 1.1, "Sera", "old"], list: ["1e21", "old"], "word-count": 5 });
    const renamed = (item) => (item === "old" ? "new" : item);
    expect(replaceFrontmatter(markdown, { ...data, tags: data.tags.map(renamed), list: data.list.map(renamed), "word-count": 6 }))
      .toBe("---\nfloat: 1e21\nhuge: 1000000000000000000000\ntags: [1e21, 1.10, 'Sera', new]\nlist:\n  - 1e21\n  - new\nword-count: 6\n---\nBody");
    expect(replaceFrontmatter(markdown, { ...data, huge: data.huge + 1e6 })).toContain("huge: 1000000000000001000000\n");
  });

  test("keeps trailing comments and flow lists when values change", () => {
    const markdown = [
      "---",
      "characters: [sera-voss, kael-voss]  # cast",
      "word-count: 5 # stale",
      "pov: \"kael-voss\"\t# narrator",
      "themes: # core",
      "  - loyalty",
      "allies:",
      "  - kael-voss # brother",
      "  - mara",
      "relationships:",
      "  - character: kael-voss # sibling",
      "    type: sibling # since birth",
      "summary: > # short",
      "  Old text.",
      "places: []",
      "---",
      "Body"
    ].join("\n");
    const { data } = parseFrontmatter(markdown);
    const renamed = (id) => (id === "kael-voss" ? "kael-storm" : id);
    const next = replaceFrontmatter(markdown, {
      ...data,
      characters: data.characters.map(renamed),
      "word-count": 7,
      pov: renamed(data.pov),
      themes: [...data.themes, "grief"],
      allies: data.allies.map(renamed),
      relationships: data.relationships.map((entry) => ({ character: renamed(entry.character), type: "rival" })),
      summary: "New text.",
      places: ["harbour"]
    });

    expect(next).toBe([
      "---",
      "characters: [sera-voss, kael-storm]  # cast",
      "word-count: 7 # stale",
      "pov: kael-storm\t# narrator",
      "themes: # core",
      "  - loyalty",
      "  - grief",
      "allies:",
      "  - kael-storm # brother",
      "  - mara",
      "relationships:",
      "  - character: kael-storm # sibling",
      "    type: rival # since birth",
      "summary: New text. # short",
      "places:",
      "  - harbour",
      "---",
      "Body"
    ].join("\n"));
    expect(replaceFrontmatter(next, parseFrontmatter(next).data)).toBe(next);

    const flow = "---\ntags: ['Sera', 1.10, \"a, b\"] # mixed\n---\nBody";
    expect(replaceFrontmatter(flow, { tags: ["Sera", 1.1, "a, b", "new"] })).toBe("---\ntags: ['Sera', 1.10, \"a, b\", new] # mixed\n---\nBody");
    expect(replaceFrontmatter(flow, { tags: [] })).toBe("---\ntags: [] # mixed\n---\nBody");
    expect(replaceFrontmatter(flow, { tags: ["Sera", { id: "x" }] })).toBe("---\ntags: # mixed\n  - Sera\n  - id: x\n---\nBody");
    expect(replaceFrontmatter("---\r\nn: 1 # one\r\n---\r\nBody", { n: 2 })).toBe("---\r\nn: 2 # one\r\n---\r\nBody");
  });
});

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

// The package has no YAML dependency to compare with, so this checks the
// writer against the parser instead: every generated value the CLI writes
// must read back as itself, and a rewrite must keep the comments, flow lists,
// and unchanged text of the document it edits. A fixed seed runs in
// `bun run test`; STORY_PROPERTY_RUNS and STORY_PROPERTY_SEED (or `random`,
// which prints the seed) search further.
describe("frontmatter round trip property", () => {
  const RUNS = Number(process.env.STORY_PROPERTY_RUNS ?? 1500);
  const SEED = process.env.STORY_PROPERTY_SEED === "random"
    ? Math.floor(Math.random() * 2 ** 31)
    : Number(process.env.STORY_PROPERTY_SEED ?? 20261006);

  // Pieces of text that have tripped the writer or the parser: YAML
  // indicators, quotes, comment and flow markers, line breaks and line
  // separators, control characters, other scripts, and words YAML reads as
  // booleans, nulls, numbers, or dates.
  const PIECES = ["a", "Sera", "voss", " ", "  ", "\t", ":", ": ", "#", " #", "\"", "'", "''", "\\", ",", "[", "]", "{", "}", "-", "- ", "|", ">", "&", "*", "!", "%", "@", "`", "~", "?", "\n", "\r", "\r\n", "\u2028", "\u2029", "\u0085", "\u007f", "\u0080", "\u009f", "\u00a0", "\ufeff", "\u0000", "\u001b", "é", "東京", "🔥", "true", "True", "FALSE", "null", "Null", "yes", "off", "0", "007", "1.10", "1e21", "-3.5", ".inf", "0x1F", "2026-09-24", "[TODO", "---"];
  const NUMBERS = [0, 1, -7, 3.5, 0.1, 12345678901234567890, Number.MAX_SAFE_INTEGER, 1e21, -1.2345e25, 1.5e-7, 5e-324, Number.MAX_VALUE];
  const KEYS = ["title", "name", "tags", "word-count", "a_b", "x1", "7", "TRUE", "pov", "characters", "summary", "z"];

  const text = (rng) => Array.from({ length: Math.floor(rng.random() * 5) }, () => rng.pick(PIECES)).join("");
  const number = (rng) => {
    const roll = rng.random();
    // `|| 0` turns -0, which reads back as 0, into 0.
    const value = roll < 0.4 ? rng.pick(NUMBERS) : (rng.random() - 0.5) * 10 ** (Math.floor(rng.random() * 60) - 30);
    return (roll > 0.7 ? Math.round(value) : value) || 0;
  };
  const scalar = (rng) => {
    const roll = rng.random();
    return roll < 0.6 ? text(rng) : roll < 0.85 ? number(rng) : rng.random() < 0.5;
  };
  const scalars = (rng, max) => Array.from({ length: Math.floor(rng.random() * (max + 1)) }, () => scalar(rng));
  const mapping = (rng) => {
    const keys = [...new Set(Array.from({ length: 1 + Math.floor(rng.random() * 3) }, () => rng.pick(KEYS)))];
    return Object.fromEntries(keys.map((key) => [key, rng.random() < 0.8 ? scalar(rng) : scalars(rng, 3)]));
  };
  const value = (rng) => {
    const roll = rng.random();
    if (roll < 0.55) {
      return scalar(rng);
    }
    if (roll < 0.8) {
      return scalars(rng, 4);
    }
    return Array.from({ length: 1 + Math.floor(rng.random() * 3) }, () => {
      const kind = rng.random();
      return kind < 0.4 ? scalar(rng) : kind < 0.8 ? mapping(rng) : scalars(rng, 3);
    });
  };
  const document = (rng) => Object.fromEntries([...new Set(Array.from({ length: 1 + Math.floor(rng.random() * 6) }, () => rng.pick(KEYS)))].map((key) => [key, value(rng)]));

  // A changed copy: entries kept, replaced, removed, or with one list item
  // renamed, added, or dropped, and sometimes a new entry.
  const edit = (rng, data) => {
    const next = {};
    for (const [key, current] of Object.entries(data)) {
      const roll = rng.random();
      if (roll < 0.45) {
        next[key] = current;
      } else if (roll < 0.6) {
        next[key] = value(rng);
      } else if (roll < 0.7) {
        continue;
      } else if (Array.isArray(current) && current.length > 0) {
        const items = [...current];
        const at = Math.floor(rng.random() * items.length);
        const change = rng.random();
        if (change < 0.5) {
          items[at] = scalar(rng);
        } else if (change < 0.75) {
          items.push(scalar(rng));
        } else {
          items.splice(at, 1);
        }
        next[key] = items;
      } else {
        next[key] = scalar(rng);
      }
    }
    if (rng.random() < 0.3) {
      next[rng.pick(KEYS)] = value(rng);
    }
    return next;
  };

  const isScalarList = (entry) => Array.isArray(entry) && entry.length > 0 && entry.every((item) => item === null || typeof item !== "object");
  // A flow list as the writer formats the entries of a nested list.
  const flowList = (items) => stringifyFrontmatter({ x: [items] }).split("\n")[2].slice("  - ".length);

  test(`stringified values read back as themselves (seed ${SEED}, ${RUNS} runs)`, () => {
    if (process.env.STORY_PROPERTY_SEED === "random") {
      console.log(`frontmatter property seed: ${SEED}`);
    }
    const rng = generator(SEED);
    for (let run = 0; run < RUNS; run += 1) {
      const data = document(rng);
      const yaml = stringifyFrontmatter(data);
      try {
        expect(yaml).not.toMatch(/[\r\u007f-\u009f\u2028\u2029\ufeff]/);
        expect(parseFrontmatter(`${yaml}Body`).data).toEqual(data);
      } catch (error) {
        throw new Error(`run ${run} (seed ${SEED}) wrote ${JSON.stringify(yaml)}: ${error.message}`);
      }
    }
  });

  test(`rewrites read back as the new values and keep comments, flow lists, and unchanged text (seed ${SEED}, ${RUNS} runs)`, () => {
    const rng = generator(SEED + 1);
    for (let run = 0; run < RUNS; run += 1) {
      const original = document(rng);
      const blocks = {};
      const commented = new Set();
      const flowKeys = new Set();
      for (const [key, entry] of Object.entries(original)) {
        let lines = stringifyFrontmatter({ [key]: entry }).split("\n").slice(1, -3);
        if (isScalarList(entry) && rng.random() < 0.5) {
          lines = [`${key}: ${flowList(entry)}`];
          flowKeys.add(key);
        }
        if (rng.random() < 0.5) {
          lines[0] += `  # c-${key}`;
          commented.add(key);
        }
        blocks[key] = lines.join("\n");
      }
      const markdown = `---\n${Object.values(blocks).join("\n")}\n---\nBody`;
      const data = edit(rng, original);
      try {
        expect(parseFrontmatter(markdown).data).toEqual(original);
        const next = replaceFrontmatter(markdown, data);
        expect(parseFrontmatter(next).data).toEqual(data);
        expect(replaceFrontmatter(next, data)).toBe(next);
        for (const key of Object.keys(data)) {
          if (!Object.hasOwn(original, key)) {
            continue;
          }
          if (Bun.deepEquals(original[key], data[key], true)) {
            expect(next).toContain(`\n${blocks[key]}\n`);
          }
          if (commented.has(key)) {
            expect(next).toContain(`  # c-${key}\n`);
          }
          if (flowKeys.has(key) && isScalarList(data[key])) {
            expect(next).toContain(`\n${key}: [`);
          }
        }
      } catch (error) {
        throw new Error(`run ${run} (seed ${SEED}) rewrote ${JSON.stringify(markdown)} with ${JSON.stringify(data)}: ${error.message}`);
      }
    }
  });
});

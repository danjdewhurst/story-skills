import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { LIST_KINDS, parseWhere, queryFindings } from "../src/list.js";
import { createStoryProject, scanProject, validateProject } from "../src/story.js";
import { RESULT_SCHEMA_PATH, SCHEMA_PATH, checkProjectSchema, validateAgainstSchema } from "../scripts/check-schema.js";
import { expectLinearGrowthFresh, makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const storySchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function writeChapter(root, number, frontmatter = "") {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Chapter ${number}\nnumber: ${number}\n${frontmatter}`, "## Chapter Text\n\nWords.\n");
}

function writeCharacter(root, id, frontmatter) {
  writeMarkdown(path.join(root, "characters", `${id}.md`), `name: ${id}\n${frontmatter}`, `# ${id}\n`);
}

// Adds frontmatter lines to the end of story.md's frontmatter.
function configure(root, yaml) {
  const file = path.join(root, "story.md");
  const text = fs.readFileSync(file, "utf8");
  const end = text.indexOf("\n---\n", 4);
  fs.writeFileSync(file, `${text.slice(0, end)}\n${yaml.trim()}${text.slice(end)}`, "utf8");
}

const QUERIES = [
  "queries:",
  "  - name: ilse-drafts",
  "    kind: chapters",
  "    where: [status=draft, pov=ilse]",
  "  - name: no-hook",
  "    kind: chapter",
  "    where: [\"!hook\"]",
  "  - name: leads",
  "    kind: characters",
  "    where: [role=protagonist]"
].join("\n");

function sampleProject() {
  const { root } = createStoryProject({ cwd: makeTempDir(), title: "Saved Queries", force: false });
  // Written out of order, and chapter-10 after chapter-09, to check book order.
  writeChapter(root, 10, "status: draft\npov: ilse\ncharacters:\n  - ilse\n  - mara\nhook: cliffhanger\nmy-flag: true");
  writeChapter(root, 2, "status: draft\npov: mara\ncharacters:\n  - mara");
  writeChapter(root, 9, "status: final\npov: ilse\ncharacters:\n  - ilse");
  writeChapter(root, 1, "status: draft\npov: ilse\ncharacters:\n  - ilse\n  - mara\nhook: question");
  writeCharacter(root, "ilse", "role: protagonist\nstatus: alive");
  writeCharacter(root, "mara", "role: antagonist\nstatus: alive");
  return root;
}

describe("story list", () => {
  test("lists every file of a kind in book order, with a count on stderr", () => {
    const root = sampleProject();
    const { code, out, err } = invoke(root, ["list", "chapters"]);
    expect(code).toBe(0);
    expect(out).toBe([
      "chapter-01  Chapter 1   chapters/chapter-01.md",
      "chapter-02  Chapter 2   chapters/chapter-02.md",
      "chapter-09  Chapter 9   chapters/chapter-09.md",
      "chapter-10  Chapter 10  chapters/chapter-10.md",
      ""
    ].join("\n"));
    expect(err).toBe("4 of 4 chapters matched\n");
  });

  test("ANDs every --where, matching lists by membership, and prints the filtered values", () => {
    const root = sampleProject();
    const { code, out, err } = invoke(root, ["list", "chapter", "--where", "status=draft", "--where", "characters=mara", "--where=pov!=mara"]);
    expect(code).toBe(0);
    expect(out).toBe([
      "chapter-01  Chapter 1   chapters/chapter-01.md  status=draft  characters=ilse,mara  pov=ilse",
      "chapter-10  Chapter 10  chapters/chapter-10.md  status=draft  characters=ilse,mara  pov=ilse",
      ""
    ].join("\n"));
    expect(err).toBe("2 of 4 chapters matched\n");
  });

  test("key tests presence and !key absence; numbers, booleans, and custom keys compare as text", () => {
    const root = sampleProject();
    const ids = (argv) => invoke(root, argv).out.split("\n").filter(Boolean).map((line) => line.split(" ")[0]);
    expect(ids(["list", "chapters", "--where", "hook"])).toEqual(["chapter-01", "chapter-10"]);
    expect(ids(["list", "chapters", "--where", "!hook"])).toEqual(["chapter-02", "chapter-09"]);
    expect(ids(["list", "chapters", "--where", "number=9"])).toEqual(["chapter-09"]);
    expect(ids(["list", "chapters", "--where", "my-flag=true"])).toEqual(["chapter-10"]);
    // != also matches a file that leaves the key unset.
    expect(ids(["list", "chapters", "--where", "hook!=question"])).toEqual(["chapter-02", "chapter-09", "chapter-10"]);
  });

  test("an empty list is unset, so !key finds risky research notes with no reviewer", () => {
    // The publishing skill's checks before publication rely on this.
    const root = sampleProject();
    const note = (id, frontmatter) => writeMarkdown(path.join(root, "research", `${id}.md`), `title: ${id}\nstatus: open\n${frontmatter}`, `# ${id}\n`);
    note("tides", "risk:\n  - safety\nreviewed-by: []");
    note("bells", "risk:\n  - legal\nreviewed-by:\n  - Ann Reader");
    note("ferries", "risk:\n  - safety");
    note("weather", "reviewed-by: []");
    const ids = (argv) => invoke(root, argv).out.split("\n").filter(Boolean).map((line) => line.split(" ")[0]);
    expect(ids(["list", "research", "--where", "risk", "--where", "!reviewed-by"])).toEqual(["ferries", "tides"]);
    expect(ids(["list", "research", "--where", "reviewed-by"])).toEqual(["bells"]);
    expect(ids(["list", "research", "--where", "!risk"])).toEqual(["weather"]);
  });

  test("no match prints nothing and exits 0", () => {
    const root = sampleProject();
    const { code, out, err } = invoke(root, ["list", "characters", "--where", "role=mentor"]);
    expect(code).toBe(0);
    expect(out).toBe("");
    expect(err).toBe("0 of 2 characters matched\n");
  });

  test("an unknown kind or key is a usage error with the nearest name", () => {
    const root = sampleProject();
    let result = invoke(root, ["list", "chapterz"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("did you mean chapters?");
    result = invoke(root, ["list", "chapters", "--where", "stauts=draft"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('Unknown key "stauts" for chapters');
    expect(result.err).toContain('did you mean "status"?');
    // A key another kind defines is still unknown here, with no guess.
    result = invoke(root, ["list", "characters", "--where", "pov=ilse"]);
    expect(result.code).toBe(2);
    expect(result.err).not.toContain("did you mean");
    for (const filter of ["status=", "=draft", "a b"]) {
      expect(invoke(root, ["list", "chapters", "--where", filter]).code).toBe(2);
    }
  });

  test("a file that fails to parse stops the list", () => {
    const root = sampleProject();
    fs.writeFileSync(path.join(root, "chapters", "chapter-03.md"), "---\ntitle: [unclosed\n---\n", "utf8");
    const { code, out, err } = invoke(root, ["list", "chapters"]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("chapters/chapter-03.md");
    // A key only the broken file sets is not reported as a typo, and --json
    // lists nothing rather than a partial set.
    expect(invoke(root, ["list", "chapters", "--where", "only-in-broken"]).code).toBe(1);
    const json = JSON.parse(invoke(root, ["list", "chapters", "--json"]).out);
    expect(json.ok).toBe(false);
    expect(json.data.items).toEqual([]);
    expect(validateAgainstSchema(json, schema)).toEqual([]);
  });

  test("a multi-line title or value stays on one line", () => {
    const root = sampleProject();
    writeMarkdown(path.join(root, "chapters", "chapter-03.md"), "title: |\n  Two\n  Lines\nnumber: 3\nhook: |\n  a\n  b", "## Chapter Text\n\nWords.\n");
    const { out } = invoke(root, ["list", "chapters", "--where", "number=3", "--where", "hook"]);
    expect(out).toBe("chapter-03  Two Lines  chapters/chapter-03.md  number=3  hook=a b\n");
  });

  test("--where compares a multi-line value on one line, as story grid shows a beat (#531)", () => {
    const root = sampleProject();
    writeChapter(root, 3, "beat: |\n  Break into\n    Two\n");
    writeChapter(root, 4, "beat: Break into Two");
    const { code, out } = invoke(root, ["list", "chapters", "--where", "beat=Break into Two"]);
    expect(code).toBe(0);
    expect(out).toBe([
      "chapter-03  Chapter 3  chapters/chapter-03.md  beat=Break into Two",
      "chapter-04  Chapter 4  chapters/chapter-04.md  beat=Break into Two",
      ""
    ].join("\n"));
    expect(invoke(root, ["list", "chapters", "--where", "beat!=Break into Two", "--where", "beat"]).out).toBe("");
  });

  test("--json gives the filters and each match's fields, and matches the result schema", () => {
    const root = sampleProject();
    const { code, out, err } = invoke(root, ["list", "chapters", "--where", "pov=ilse", "--where", "!hook", "--json"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    const envelope = JSON.parse(out);
    expect(validateAgainstSchema(envelope, schema)).toEqual([]);
    expect(envelope.data).toEqual({
      kind: "chapters",
      query: null,
      where: [{ key: "pov", op: "eq", value: "ilse" }, { key: "hook", op: "absent", value: null }],
      total: 4,
      items: [{ id: "chapter-09", file: "chapters/chapter-09.md", title: "Chapter 9", fields: { pov: "ilse", hook: null } }]
    });
  });
});

describe("story list --query (#532)", () => {
  test("runs a story.md query: its kind and every filter", () => {
    const root = sampleProject();
    configure(root, QUERIES);
    const { code, out, err } = invoke(root, ["list", "--query", "ilse-drafts"]);
    expect(code).toBe(0);
    expect(out).toBe([
      "chapter-01  Chapter 1   chapters/chapter-01.md  status=draft  pov=ilse",
      "chapter-10  Chapter 10  chapters/chapter-10.md  status=draft  pov=ilse",
      ""
    ].join("\n"));
    expect(err).toBe("2 of 4 chapters matched\n");
    // A singular kind and a quoted !key filter work as on the command line.
    expect(invoke(root, ["list", "--query", "no-hook"]).out.split("\n").filter(Boolean).map((line) => line.split(" ")[0])).toEqual(["chapter-02", "chapter-09"]);
  });

  test("--where adds filters after the query's, and every one must match", () => {
    const root = sampleProject();
    configure(root, QUERIES);
    const { code, out } = invoke(root, ["list", "--query", "ilse-drafts", "--where", "hook=cliffhanger"]);
    expect(code).toBe(0);
    expect(out).toBe("chapter-10  Chapter 10  chapters/chapter-10.md  status=draft  pov=ilse  hook=cliffhanger\n");
  });

  test("a query on a name every object inherits, such as constructor, matches only files that set it (#734)", () => {
    const root = sampleProject();
    configure(root, "queries:\n  - name: inherited\n    kind: chapters\n    where: [constructor]\n  - name: not-inherited\n    kind: chapters\n    where: [\"!constructor\"]");
    const inherited = JSON.parse(invoke(root, ["list", "--query", "inherited", "--json"]).out);
    expect(inherited.data.items).toEqual([]);
    // Not a field, so the query warns that it matches as unset, as for any unknown key.
    expect(inherited.diagnostics).toMatchObject([{ severity: "warning", code: "query-unknown-key", file: "story.md" }]);
    expect(inherited.diagnostics[0].message).toContain('filters on "constructor"');
    const unset = JSON.parse(invoke(root, ["list", "--query", "not-inherited", "--json"]).out).data;
    expect(unset.items.map((item) => item.id)).toEqual(["chapter-01", "chapter-02", "chapter-09", "chapter-10"]);
    expect(unset.items[0].fields).toEqual({ constructor: null });
  });

  test("a kind given as well must be the query's, in either form", () => {
    const root = sampleProject();
    configure(root, QUERIES);
    expect(invoke(root, ["list", "chapters", "--query", "ilse-drafts"]).code).toBe(0);
    expect(invoke(root, ["list", "chapter", "--query", "ilse-drafts"]).code).toBe(0);
    const other = invoke(root, ["list", "scenes", "--query", "ilse-drafts"]);
    expect(other.code).toBe(2);
    expect(other.err).toBe("Query ilse-drafts lists chapters, not scenes: drop the kind, or give chapters\n");
    const unknown = invoke(root, ["list", "chapterz", "--query", "ilse-drafts"]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('Unknown kind "chapterz"');
  });

  test("--json names the query and lists its filters first, matching the result schema", () => {
    const root = sampleProject();
    configure(root, QUERIES);
    const { code, out, err } = invoke(root, ["list", "--query", "leads", "--where", "status", "--json"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    const envelope = JSON.parse(out);
    expect(validateAgainstSchema(envelope, schema)).toEqual([]);
    expect(envelope.data).toEqual({
      kind: "characters",
      query: "leads",
      where: [{ key: "role", op: "eq", value: "protagonist" }, { key: "status", op: "present", value: null }],
      total: 2,
      items: [{ id: "ilse", file: "characters/ilse.md", title: "ilse", fields: { role: "protagonist", status: "alive" } }]
    });
  });

  test("an unknown or empty query name is a usage error with the nearest name", () => {
    const root = sampleProject();
    let result = invoke(root, ["list", "--query", "ilse-drafts"]);
    expect(result.code).toBe(2);
    expect(result.err).toBe('Unknown query "ilse-drafts": story.md has no queries\n');
    configure(root, QUERIES);
    result = invoke(root, ["list", "--query", "ilse-draft"]);
    expect(result.code).toBe(2);
    expect(result.err).toBe('Unknown query "ilse-draft" (story.md queries: ilse-drafts, no-hook, leads); did you mean ilse-drafts?\n');
    result = invoke(root, ["list", "--query="]);
    expect(result.code).toBe(2);
    expect(result.err).toBe("--query needs the name of a story.md query\n");
    result = invoke(root, ["list", "--query", "nope", "--json"]);
    expect(result.code).toBe(2);
    const json = JSON.parse(result.out);
    expect(validateAgainstSchema(json, schema)).toEqual([]);
    expect(json.ok).toBe(false);
    expect(json.diagnostics.map((entry) => entry.code)).toEqual(["usage-error"]);
  });

  test("a query with errors does not run (exit 3), also with --json", () => {
    const root = sampleProject();
    configure(root, [
      "queries:",
      "  - name: unreadable",
      "    kind: chapters",
      "    where: [a b]",
      "  - name: twice",
      "    kind: chapters",
      "    where: [hook]",
      "  - name: twice",
      "    kind: scenes",
      "    where: [pov]",
      "  - name: 2025",
      "    kind: chapters",
      "    where: [hook]"
    ].join("\n"));
    let result = invoke(root, ["list", "--query", "unreadable"]);
    expect(result.code).toBe(3);
    expect(result.out).toBe("");
    expect(result.err).toBe('Fix story.md query unreadable before running it: story.md query unreadable cannot read where filter "a b": expected key=value, key!=value, key, or "!key"\n');
    result = invoke(root, ["list", "--query", "twice"]);
    expect(result.code).toBe(3);
    expect(result.err).toBe("Fix story.md query twice before running it: story.md lists query twice more than once\n");
    // An unquoted number is found by its text, and told to take quotes.
    result = invoke(root, ["list", "--query", "2025"]);
    expect(result.code).toBe(3);
    expect(result.err).toBe('Fix story.md query 2025 before running it: story.md queries[3] name 2025 is not text: quote it, such as name: "2025"\n');
    result = invoke(root, ["list", "--query", "unreadable", "--json"]);
    expect(result.code).toBe(3);
    const json = JSON.parse(result.out);
    expect(validateAgainstSchema(json, schema)).toEqual([]);
    expect(json.ok).toBe(false);
    expect(json.diagnostics.map((entry) => entry.code)).toEqual(["unusable-project"]);
  });

  test("a filter on a key no file of the kind sets is a warning, and the query still runs", () => {
    const root = sampleProject();
    configure(root, "queries:\n  - name: typo\n    kind: chapters\n    where: [stauts=draft]");
    const warning = 'story.md query typo filters on "stauts", which no chapter file sets and the schema does not define, so it matches as unset; did you mean "status"?';
    let result = invoke(root, ["list", "--query", "typo"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
    expect(result.err).toBe(`0 of 4 chapters matched\nwarning: ${warning} [query-unknown-key]\n`);
    result = invoke(root, ["list", "--query", "typo", "--json"]);
    expect(result.code).toBe(0);
    const json = JSON.parse(result.out);
    expect(validateAgainstSchema(json, schema)).toEqual([]);
    expect(json.diagnostics).toMatchObject([{ severity: "warning", code: "query-unknown-key", message: warning, file: "story.md" }]);
    // A severity entry promotes it, as for any warning.
    configure(root, "severity:\n  - warning: query-unknown-key\n    level: error");
    result = invoke(root, ["list", "--query", "typo"]);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain(`error: ${warning} [query-unknown-key]`);
  });

  test("a story.md that does not parse, or queries that is not a list, stops --query", () => {
    const root = sampleProject();
    configure(root, "queries: ilse-drafts");
    let result = invoke(root, ["list", "--query", "ilse-drafts"]);
    expect(result.code).toBe(3);
    expect(result.err).toBe('story.md frontmatter field queries must be a list; fix it before running story list --query "ilse-drafts"\n');
    fs.writeFileSync(path.join(root, "story.md"), "---\ntitle: [unclosed\n---\n", "utf8");
    result = invoke(root, ["list", "--query", "ilse-drafts"]);
    expect(result.code).toBe(3);
    expect(result.err).toBe('story.md cannot be parsed; fix it before running story list --query "ilse-drafts"\n');
  });

  test("another file that fails to parse lists nothing, as without --query", () => {
    const root = sampleProject();
    configure(root, QUERIES);
    fs.writeFileSync(path.join(root, "chapters", "chapter-03.md"), "---\ntitle: [unclosed\n---\n", "utf8");
    const { code, out } = invoke(root, ["list", "--query", "ilse-drafts", "--json"]);
    expect(code).toBe(1);
    const envelope = JSON.parse(out);
    expect(validateAgainstSchema(envelope, schema)).toEqual([]);
    expect(envelope.data).toMatchObject({ kind: "chapters", query: "ilse-drafts", items: [] });
  });

  test("story.md text in a message is quoted, so it cannot drive a terminal or a CI log", () => {
    const root = sampleProject();
    const esc = String.fromCharCode(27);
    // OSC 52 sets the clipboard; U+009B, the one-byte CSI, starts an escape
    // sequence on some terminals and is one JSON.stringify leaves raw.
    const name = `x${esc}]52;c;cHduZWQ=${String.fromCharCode(7)}${String.fromCharCode(0x9b)}2J`;
    const quote = (text) => JSON.stringify(text).replace(/[\x7f-\x9f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
    const filter = `k${esc}[2J\n::error::injected=1`;
    configure(root, `queries:\n  - name: ${JSON.stringify(name)}\n    kind: chapters\n    where: [${JSON.stringify(filter)}]\n  - name: odd-key\n    kind: chapters\n    where: [${JSON.stringify(filter)}]`);
    const unsafe = (text) => /[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(text) || text.split("\n").some((line) => line.startsWith("::"));
    const report = validateProject(root);
    expect(messages([...report.errors, ...report.warnings]).filter((message) => /queries|query/.test(message))).toEqual([
      `story.md queries[0] name ${quote(name)} must be kebab-case, such as mara-drafts`,
      `story.md queries[0] filters on ${JSON.stringify(filter.slice(0, -2))}, which no chapter file sets and the schema does not define, so it matches as unset`,
      `story.md query odd-key filters on ${JSON.stringify(filter.slice(0, -2))}, which no chapter file sets and the schema does not define, so it matches as unset`
    ]);
    for (const argv of [["validate"], ["list", "--query", "nope"], ["list", "--query", name], ["list", "--query", "odd-key"]]) {
      const { err } = invoke(root, argv);
      expect(unsafe(err)).toBe(false);
    }
  });
});

describe("story list reads a filter in linear time", () => {
  const pattern = new RegExp(storySchema.properties.story.properties.queries.items.properties.where.items.pattern, "u");
  const accepts = (text) => {
    try {
      parseWhere(text);
      return true;
    } catch {
      return false;
    }
  };

  // The forms that made the earlier regular expressions backtrack in
  // quadratic time: a long run of spaces inside a key or a value, and a value
  // that breaks a line at its end. Each took minutes at this length.
  test("on long runs of spaces, by --where and by the schema's where pattern", () => {
    const n = 200000;
    for (const text of ["a" + " ".repeat(n) + "x", "a=b" + " ".repeat(n) + "\nc", "a=" + "b ".repeat(n) + "\nc", "a" + " =".repeat(n) + "\n"]) {
      const start = performance.now();
      accepts(text);
      pattern.test(text);
      // A backstop, not a ratio. Bun's regex engine is about a hundred times
      // slower on the pattern above about 100,000 characters than below it,
      // so a ratio between a short and a long input would not show growth.
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });

  test("checks every query's keys once per kind", () => {
    // A project with `count` queries, and 40 * count keys that every query
    // reads. Both grow with count: a query that rebuilt the keys each time
    // would cost count * 40 * count in all, which the ratio shows.
    const scannedWith = (count) => {
      const root = sampleProject();
      const keys = Array.from({ length: 40 * count }, (_, index) => `custom-${index}: x`).join("\n");
      writeMarkdown(path.join(root, "chapters", "chapter-03.md"), `title: Wide\nnumber: 3\n${keys}`, "## Chapter Text\n\nWords.\n");
      configure(root, ["queries:", ...Array.from({ length: count }, (_, index) => `  - name: q-${index}\n    kind: chapters\n    where: [custom-${index}=x, missing-${index}]`)].join("\n"));
      return scanProject(root);
    };
    const found = queryFindings(scannedWith(500));
    expect(found.errors).toEqual([]);
    expect(found.warnings).toHaveLength(500);
    // With the keys read once per kind, the time is linear in count, so 500
    // queries take about four times as long as 125.
    expectLinearGrowthFresh((count) => {
      const project = scannedWith(count);
      const start = performance.now();
      queryFindings(project);
      return performance.now() - start;
    }, 500);
  });
});

describe("story validate checks story.md queries (#532)", () => {
  const queryWarnings = (report) => messages(report.warnings.filter((warning) => warning.code === "query-unknown-key"));
  // The errors validate reports, and whether schemas/story.schema.json
  // rejects the same story.md.
  const check = (yaml) => {
    const root = sampleProject();
    configure(root, yaml);
    return { errors: validateProject(root).errors.map((error) => `${error.code}: ${error.message}`), schemaRejects: checkProjectSchema(root).length > 0 };
  };

  test("valid queries pass validate and the schema", () => {
    const root = sampleProject();
    configure(root, `${QUERIES}\n  - name: custom-flag\n    kind: chapters\n    where: ["my-flag = true", "hook!=question"]\n  - name: "2025"\n    kind: scenes\n    where: [pov]`);
    const report = validateProject(root);
    expect(messages(report.errors)).toEqual([]);
    expect(queryWarnings(report)).toEqual([]);
    expect(checkProjectSchema(root)).toEqual([]);
  });

  const kinds = "(chapters, scenes, characters, locations, systems, factions, artifacts, arcs, questions, promises, clues, terms, research, matter, or the singular)";
  // The last column says whether the schema rejects it too: it cannot see
  // another key in an entry, an empty where, or a repeated name.
  const cases = [
    ["queries: drafts", "field-not-list: story.md frontmatter field queries must be a list", true],
    ["queries:\n  - drafts", "field-invalid-items: story.md frontmatter field queries must contain mappings, such as - name: mara-drafts", true],
    ["queries:\n  - kind: chapters\n    where: [hook]", "missing-field: story.md queries[0] is missing name", true],
    ["queries:\n  - name: Ilse Drafts\n    kind: chapters\n    where: [hook]", "id-not-kebab: story.md queries[0] name \"Ilse Drafts\" must be kebab-case, such as mara-drafts", true],
    ["queries:\n  - name: 2025\n    kind: chapters\n    where: [hook]", "field-not-text: story.md queries[0] name 2025 is not text: quote it, such as name: \"2025\"", true],
    ["queries:\n  - name: drafts\n    where: [hook]", "missing-field: story.md query drafts is missing kind", true],
    ["queries:\n  - name: drafts\n    kind: chapterz\n    where: [hook]", `invalid-query: story.md query drafts kind "chapterz" is not a kind story list takes ${kinds}; did you mean chapters?`, true],
    ["queries:\n  - name: drafts\n    kind: Chapters\n    where: [hook]", `invalid-query: story.md query drafts kind "Chapters" is not a kind story list takes ${kinds}; did you mean chapters?`, true],
    ["queries:\n  - name: drafts\n    kind: 3\n    where: [hook]", `invalid-query: story.md query drafts kind 3 is not a kind story list takes ${kinds}`, true],
    ["queries:\n  - name: drafts\n    kind: chapters", "missing-field: story.md query drafts is missing where", true],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: status=draft", "invalid-query: story.md query drafts where must be a list of filters, such as where: [status=draft, pov=mara-quill]", true],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: [3]", "invalid-query: story.md query drafts where must be a list of filters, such as where: [status=draft, pov=mara-quill]", true],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: [\"status=\"]", "invalid-query: story.md query drafts where filter \"status=\" needs a value after =; write \"status\" for a key that is set, or \"!status\" for one that is not", true],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: [a b]", "invalid-query: story.md query drafts cannot read where filter \"a b\": expected key=value, key!=value, key, or \"!key\"", true],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: [\"!=x\"]", "invalid-query: story.md query drafts cannot read where filter \"!=x\": expected key=value, key!=value, key, or \"!key\"", true],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: []", "invalid-query: story.md query drafts where needs at least one filter, such as where: [status=draft]", false],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: [hook]\n    filter: [pov=ilse]", "invalid-query: story.md query drafts has filter: a query takes only name, kind, and where", false],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: [hook]\n  - name: drafts\n    kind: scenes\n    where: [pov]", "duplicate-query: story.md lists query drafts more than once", false]
  ];
  for (const [yaml, finding, schemaRejects] of cases) {
    test(finding, () => {
      expect(check(yaml)).toEqual({ errors: [finding], schemaRejects });
    });
  }

  test("a key no file of the kind sets is a warning, so editing another file cannot fail story check", () => {
    const root = sampleProject();
    configure(root, "queries:\n  - name: flagged\n    kind: chapters\n    where: [my-flag=true]");
    expect(queryWarnings(validateProject(root))).toEqual([]);
    // chapter-10 is the only chapter that sets my-flag.
    writeChapter(root, 10, "status: draft\npov: ilse");
    const report = validateProject(root);
    expect(report.errors).toEqual([]);
    expect(queryWarnings(report)).toEqual([
      'story.md query flagged filters on "my-flag", which no chapter file sets and the schema does not define, so it matches as unset'
    ]);
    expect(invoke(root, ["check"]).code).toBe(0);
  });

  test("a key check waits for every file to parse, as story list does", () => {
    const root = sampleProject();
    configure(root, "queries:\n  - name: broken\n    kind: chapters\n    where: [only-in-broken]");
    fs.writeFileSync(path.join(root, "chapters", "chapter-03.md"), "---\ntitle: [unclosed\n---\n", "utf8");
    const report = validateProject(root);
    expect(report.errors.map((error) => error.code)).toEqual(["unreadable-file"]);
    expect(queryWarnings(report)).toEqual([]);
  });

  test("the schema's kinds are the ones story list takes", () => {
    const kinds = storySchema.properties.story.properties.queries.items.properties.kind.enum;
    expect(kinds).toEqual([...new Set(LIST_KINDS.flatMap((entry) => [entry.kind, entry.singular]))]);
  });

  test("the schema's where pattern accepts exactly the filters --where reads", () => {
    const pattern = new RegExp(storySchema.properties.story.properties.queries.items.properties.where.items.pattern, "u");
    const accepts = (text) => {
      try {
        parseWhere(text);
        return true;
      } catch {
        return false;
      }
    };
    const accepted = ["status=draft", " pov = ilse ", "hook!=question", "!hook", "hook", "my key=a b", "a=b=c", "a==b", "a=!b", "a=\nb", "a=b \n"];
    const rejected = ["", "  ", "status=", "status = ", "=draft", "!=x", "a b", "!", "!!a", "a!b", "a!", "a=b\nc", "a!b=c", "!a b"];
    expect(accepted.filter((text) => !accepts(text) || !pattern.test(text))).toEqual([]);
    expect(rejected.filter((text) => accepts(text) || pattern.test(text))).toEqual([]);
    // Every short string over the characters that matter, from a fixed seed.
    let state = 532;
    const random = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const alphabet = ["a", "b", "=", "!", " ", "\t", "\n", "\r", "-", "é"];
    const disagreements = [];
    for (let run = 0; run < 20000; run += 1) {
      const text = Array.from({ length: Math.floor(random() * 8) }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
      if (accepts(text) !== pattern.test(text)) {
        disagreements.push(text);
      }
    }
    expect(disagreements).toEqual([]);
  });
});

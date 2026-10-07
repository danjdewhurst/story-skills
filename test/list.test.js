import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { LIST_KINDS } from "../src/list.js";
import { createStoryProject, validateProject } from "../src/story.js";
import { RESULT_SCHEMA_PATH, SCHEMA_PATH, checkProjectSchema, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

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

  test("a kind given as well must be the query's, in either form", () => {
    const root = sampleProject();
    configure(root, QUERIES);
    expect(invoke(root, ["list", "chapters", "--query", "ilse-drafts"]).code).toBe(0);
    expect(invoke(root, ["list", "chapter", "--query", "ilse-drafts"]).code).toBe(0);
    const other = invoke(root, ["list", "scenes", "--query", "ilse-drafts"]);
    expect(other.code).toBe(2);
    expect(other.err).toBe("Query ilse-drafts lists chapters, not scenes: drop the kind, or give chapters\n");
    expect(invoke(root, ["list", "chapterz", "--query", "ilse-drafts"]).err).toContain('Unknown kind "chapterz"');
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
    const json = JSON.parse(invoke(root, ["list", "--query", "nope", "--json"]).out);
    expect(json.ok).toBe(false);
    expect(json.diagnostics[0].code).toBe("usage-error");
  });

  test("a query story validate rejects does not run (exit 3)", () => {
    const root = sampleProject();
    configure(root, "queries:\n  - name: typo\n    kind: chapters\n    where: [stauts=draft]\n  - name: twice\n    kind: chapters\n    where: [hook]\n  - name: twice\n    kind: scenes\n    where: [pov]");
    let result = invoke(root, ["list", "--query", "typo"]);
    expect(result.code).toBe(3);
    expect(result.out).toBe("");
    expect(result.err).toBe('Fix story.md query typo before running it: story.md query typo filters on stauts, which no chapter file sets and the schema does not define; did you mean "status"?\n');
    result = invoke(root, ["list", "--query", "twice"]);
    expect(result.code).toBe(3);
    expect(result.err).toBe("Fix story.md query twice before running it: story.md lists query twice more than once\n");
  });

  test("a story.md that does not parse, or queries that is not a list, stops --query", () => {
    const root = sampleProject();
    configure(root, "queries: ilse-drafts");
    let result = invoke(root, ["list", "--query", "ilse-drafts"]);
    expect(result.code).toBe(3);
    expect(result.err).toBe("story.md frontmatter field queries must be a list; fix it before running story list --query ilse-drafts\n");
    fs.writeFileSync(path.join(root, "story.md"), "---\ntitle: [unclosed\n---\n", "utf8");
    result = invoke(root, ["list", "--query", "ilse-drafts"]);
    expect(result.code).toBe(3);
    expect(result.err).toBe("story.md cannot be parsed; fix it before running story list --query ilse-drafts\n");
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
});

describe("story validate checks story.md queries (#532)", () => {
  const errorsWith = (yaml) => {
    const root = sampleProject();
    configure(root, yaml);
    return validateProject(root).errors.map((error) => `${error.code}: ${error.message}`);
  };

  test("valid queries pass validate and the schema", () => {
    const root = sampleProject();
    configure(root, `${QUERIES}\n  - name: custom-flag\n    kind: chapters\n    where: ["my-flag = true", "hook!=question"]`);
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(checkProjectSchema(root)).toEqual([]);
  });

  const cases = [
    ["queries: drafts", "field-not-list: story.md frontmatter field queries must be a list"],
    ["queries:\n  - drafts", "field-invalid-items: story.md frontmatter field queries must contain mappings, such as - name: mara-drafts"],
    ["queries:\n  - kind: chapters\n    where: [hook]", "missing-field: story.md queries[0] is missing name"],
    ["queries:\n  - name: Ilse Drafts\n    kind: chapters\n    where: [hook]", "id-not-kebab: story.md queries[0] name \"Ilse Drafts\" must be kebab-case, such as mara-drafts"],
    ["queries:\n  - name: drafts\n    where: [hook]", "missing-field: story.md query drafts is missing kind"],
    ["queries:\n  - name: drafts\n    kind: chapterz\n    where: [hook]", "invalid-query: story.md query drafts kind \"chapterz\" is not a kind story list takes (chapters, scenes, characters, locations, systems, factions, artifacts, arcs, questions, promises, clues, terms, research, matter, or the singular); did you mean chapters?"],
    ["queries:\n  - name: drafts\n    kind: Chapters\n    where: [hook]", "invalid-query: story.md query drafts kind \"Chapters\" is not a kind story list takes (chapters, scenes, characters, locations, systems, factions, artifacts, arcs, questions, promises, clues, terms, research, matter, or the singular); did you mean chapters?"],
    ["queries:\n  - name: drafts\n    kind: 3\n    where: [hook]", "invalid-query: story.md query drafts kind 3 is not a kind story list takes (chapters, scenes, characters, locations, systems, factions, artifacts, arcs, questions, promises, clues, terms, research, matter, or the singular)"],
    ["queries:\n  - name: drafts\n    kind: chapters", "missing-field: story.md query drafts is missing where"],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: status=draft", "invalid-query: story.md query drafts where must be a list of one or more filters, such as where: [status=draft, pov=mara-quill]"],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: []", "invalid-query: story.md query drafts where must be a list of one or more filters, such as where: [status=draft, pov=mara-quill]"],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: [3]", "invalid-query: story.md query drafts where must be a list of one or more filters, such as where: [status=draft, pov=mara-quill]"],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: [\"status=\"]", "invalid-query: story.md query drafts where filter \"status=\" needs a value after =; write status for a key that is set, or \"!status\" for one that is not"],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: [a b]", "invalid-query: story.md query drafts cannot read where filter \"a b\": expected key=value, key!=value, key, or \"!key\""],
    ["queries:\n  - name: drafts\n    kind: characters\n    where: [pov=ilse]", "invalid-query: story.md query drafts filters on pov, which no character file sets and the schema does not define"],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: [hook]\n    filter: [pov=ilse]", "invalid-query: story.md query drafts has filter: a query takes only name, kind, and where"],
    ["queries:\n  - name: drafts\n    kind: chapters\n    where: [hook]\n  - name: drafts\n    kind: scenes\n    where: [pov]", "duplicate-query: story.md lists query drafts more than once"]
  ];
  for (const [yaml, finding] of cases) {
    test(finding, () => {
      expect(errorsWith(yaml)).toEqual([finding]);
    });
  }

  test("a key check waits for every file to parse, as story list does", () => {
    const root = sampleProject();
    configure(root, "queries:\n  - name: broken\n    kind: chapters\n    where: [only-in-broken]");
    fs.writeFileSync(path.join(root, "chapters", "chapter-03.md"), "---\ntitle: [unclosed\n---\n", "utf8");
    expect(validateProject(root).errors.map((error) => error.code)).toEqual(["unreadable-file"]);
  });

  test("the schema's kinds are the ones story list takes", () => {
    const kinds = storySchema.properties.story.properties.queries.items.properties.kind.enum;
    expect(kinds).toEqual([...new Set(LIST_KINDS.flatMap((entry) => [entry.kind, entry.singular]))]);
  });
});

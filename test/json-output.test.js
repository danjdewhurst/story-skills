import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { API_VERSION, diagnostic, diagnosticsFrom, resultData, writeJsonResult } from "../src/json.js";
import { createStoryProject } from "../src/story.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const examplesRoot = path.resolve(import.meta.dir, "..", "examples");
const examples = fs.readdirSync(examplesRoot).sort().filter((name) => fs.existsSync(path.join(examplesRoot, name, "story.md")));
const PATH_COMMANDS = ["validate", "links", "continuity", "series", "next", "doctor", "report", "timeline", "prose", "voices", "pacing", "clues", "progress"];

// `stdin`, when given, stands in for text piped to `story <command> -`.
function invoke(cwd, argv, stdin) {
  const io = memoryIo(cwd);
  if (stdin !== undefined) {
    io.readStdin = () => Buffer.from(stdin);
  }
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// Runs a --json command and checks the contract every result keeps: one
// JSON object on stdout, nothing on stderr, the schema, and ok matching the
// exit code.
function invokeJson(cwd, argv, stdin) {
  const result = invoke(cwd, argv, stdin);
  expect(result.err).toBe("");
  const envelope = JSON.parse(result.out);
  expect(validateAgainstSchema(envelope, schema)).toEqual([]);
  expect(envelope.apiVersion).toBe(API_VERSION);
  expect(envelope.ok).toBe(result.code === 0);
  return { ...result, envelope };
}

function brokenProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Broken Json", force: false });
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: Opening
number: 1
status: draft
word-count: 0
characters:
  - nobody-here
`, "## Chapter Text\n\nShe felt the cold. She felt it again.\n");
  return root;
}

describe("--json result envelope", () => {
  test("every --json command on every example matches the result schema", () => {
    for (const name of examples) {
      const root = path.join(examplesRoot, name);
      for (const command of PATH_COMMANDS) {
        const { envelope } = invokeJson(root, [command, "--json"]);
        expect(envelope.command).toBe(command);
        expect(envelope.writes).toEqual([]);
      }
    }
  });

  test("a failing check reports ok false, exits 1, and lists diagnostics with their file and check", () => {
    const root = brokenProject();
    const { code, envelope } = invokeJson(root, ["links", "--json"]);
    expect(code).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.data.errors).toBeGreaterThan(0);
    const missing = envelope.diagnostics.find((entry) => entry.message.includes("nobody-here"));
    expect(missing).toMatchObject({ severity: "error", file: path.join("chapters", "chapter-01.md"), code: "links" });
    // The text output prints the same findings, so the two stay in step.
    expect(invoke(root, ["links"]).err).toContain(`error: ${missing.message}`);
  });

  test("report, next, and doctor exit 0 and code each finding by the check that raised it", () => {
    const root = brokenProject();
    for (const command of ["report", "next", "doctor"]) {
      const { code, envelope } = invokeJson(root, [command, "--json"]);
      expect(code).toBe(0);
      expect(envelope.data.checks.links).toMatchObject({ ok: false });
      expect(envelope.data.checks.links.errors).toBeGreaterThan(0);
      expect(envelope.diagnostics.some((entry) => entry.code === "links" && entry.severity === "error")).toBe(true);
      expect(envelope.data.validation).toBeUndefined();
    }
    const { envelope } = invokeJson(root, ["report", "--json"]);
    // Unset story.md fields print as null rather than vanishing.
    expect(envelope.data.series).toBeNull();
    expect(envelope.data.actions.length).toBeGreaterThan(0);
  });

  test("report lists a parse error once, though every check reports it", () => {
    const root = brokenProject();
    fs.writeFileSync(path.join(root, "chapters", "chapter-02.md"), "No frontmatter here.\n", "utf8");
    const { envelope } = invokeJson(root, ["report", "--json"]);
    const parseErrors = envelope.diagnostics.filter((entry) => entry.message.includes("missing YAML frontmatter"));
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0].code).toBe("validate");
    const keys = envelope.diagnostics.map((entry) => `${entry.severity} ${entry.message}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(envelope.data.checks.links.errors).toBeGreaterThan(0);
  });

  test("dismissed continuity findings carry their exemption", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Dismissed Json", force: false });
    writeMarkdown(path.join(root, "characters", "edran-vale.md"), "name: Edran Vale\nrole: supporting\nstatus: deceased\ndied-in: chapter-01", "# Edran\n");
    for (const number of [1, 2]) {
      writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Chapter ${number}\nnumber: ${number}\ncharacters:\n  - edran-vale\nstatus: draft\nword-count: 0`, "## Chapter Text\n\nWords.\n");
    }
    writeMarkdown(path.join(root, "continuity", "exemptions.md"), 'type: exemption-log\nstory: dismissed-json\nexemptions:\n  - pattern: "edran-vale"\n    reason: "Ghost scene"', "# Exemptions\n");
    const { code, envelope } = invokeJson(root, ["continuity", "--json"]);
    expect(code).toBe(0);
    expect(envelope.data.dismissed).toBeGreaterThan(0);
    const dismissed = envelope.diagnostics.find((entry) => entry.severity === "dismissed");
    expect(dismissed).toMatchObject({ code: "continuity", exemption: "Ghost scene" });
  });

  test("knowledge --json lists the entries, and a missing --at is a JSON usage error", () => {
    const root = path.join(examplesRoot, "the-last-ember");
    const { envelope } = invokeJson(root, ["knowledge", "sera-voss", "--at", "chapter-01", "--json"]);
    expect(envelope.data).toMatchObject({ character: "sera-voss", at: "chapter-01" });
    expect(Array.isArray(envelope.data.entries)).toBe(true);

    const usage = invokeJson(root, ["knowledge", "sera-voss", "--json"]);
    expect(usage.code).toBe(2);
    expect(usage.envelope.data).toBeNull();
    expect(usage.envelope.diagnostics).toEqual([{ severity: "error", file: null, message: expect.stringContaining("Usage: story knowledge"), code: "knowledge" }]);
  });

  test("a failure after --json (unknown character, missing project) is a JSON result", () => {
    const root = path.join(examplesRoot, "the-last-ember");
    const unknown = invokeJson(root, ["knowledge", "nobody", "--at", "chapter-01", "--json"]);
    expect(unknown.code).toBe(2);
    expect(unknown.envelope.diagnostics[0].message).toBe("Unknown character nobody");

    const missing = invokeJson(makeTempDir(), ["validate", "--json"]);
    expect(missing.envelope).toMatchObject({ command: "validate", ok: false });
  });

  test("--json before the command still reports failures as JSON", () => {
    const root = path.join(examplesRoot, "the-last-ember");
    const missing = invokeJson(makeTempDir(), ["--json", "validate"]);
    expect(missing.envelope).toMatchObject({ command: "validate", ok: false, data: null });

    const afterPath = invokeJson(root, ["--path", root, "--json", "knowledge", "sera-voss"]);
    expect(afterPath.envelope.command).toBe("knowledge");
    expect(afterPath.envelope.diagnostics[0].message).toContain("Usage: story knowledge");

    const parseError = invokeJson(root, ["--json", "prose", "--jsn"]);
    expect(parseError.envelope.command).toBe("prose");
    expect(parseError.envelope.diagnostics[0].message).toContain("Unknown option --jsn");

    const extra = invokeJson(root, ["--json", "--", "validate", ".", "extra"]);
    expect(extra.envelope.diagnostics[0].message).toContain("Unexpected argument");

    const success = invokeJson(root, ["--json", "clues"]);
    expect(success.envelope).toMatchObject({ command: "clues", ok: true });
  });

  test("an option with no command is not mistaken for one", () => {
    const result = invoke(makeTempDir(), ["--json"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Usage: story <command>");
  });

  test("usage and parse errors are JSON results when --json is on", () => {
    const root = path.join(examplesRoot, "the-last-ember");
    const extra = invokeJson(root, ["validate", ".", "extra", "--json"]);
    expect(extra.code).toBe(2);
    expect(extra.envelope.diagnostics[0].message).toContain("Unexpected argument");

    const unknownOption = invokeJson(root, ["prose", "--jsn", "--json=yes"]);
    expect(unknownOption.envelope.diagnostics[0].message).toContain("Unknown option --jsn");

    const badValue = invokeJson(root, ["pacing", "--json=maybe"]);
    expect(badValue.envelope.diagnostics[0].message).toContain('Unknown value "maybe" for --json');
  });

  test("knowledge without --at prints its usage as text without --json", () => {
    const result = invoke(path.join(examplesRoot, "the-last-ember"), ["knowledge", "sera-voss"]);
    expect(result.code).toBe(2);
    expect(result.err).toBe("Usage: story knowledge <character-id> --at <chapter-id> [--path <project>]\n");
  });

  test("--json false, --json=off, and options after -- keep the text output", () => {
    const root = path.join(examplesRoot, "the-last-ember");
    for (const argv of [["validate", "--json", "false"], ["validate", "--json=off"], ["validate", "--json", "--json=no"]]) {
      const result = invoke(root, argv);
      expect(result.code).toBe(0);
      expect(result.out).toBe("");
      expect(result.err).toContain("Project is valid");
    }
    const afterDashes = invoke(root, ["validate", "--", "--json"]);
    expect(afterDashes.out).toBe("");
    expect(afterDashes.err).toContain("is not a story project");
  });

  test("--json on a command without JSON output is refused", () => {
    const result = invoke(makeTempDir(), ["wordcount", "--json"]);
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toBe("--json does not apply to story wordcount\n");
  });

  test("progress --log --json reports the file it wrote", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Logged Json", force: false });
    const { envelope } = invokeJson(root, ["progress", "--log", "--date", "2026-01-02", "--json"]);
    const file = path.join(root, "progress.md");
    expect(envelope.writes).toEqual([file]);
    expect(envelope.data.logged).toEqual({ file, date: "2026-01-02", words: 0 });
    expect(fs.existsSync(file)).toBe(true);
  });

  test("prose --json with similar names and style-sheet spellings matches the schema", () => {
    const root = brokenProject();
    writeMarkdown(path.join(root, "characters", "mara-dole.md"), "name: Mara Dole\nrole: protagonist\nstatus: alive", "# Mara\n");
    writeMarkdown(path.join(root, "characters", "mary-vance.md"), "name: Mary Vance\nrole: supporting\nstatus: alive", "# Mary\n");
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\nstory: broken-json\npreferred:\n  - use: grey\n    avoid: gray", "# Style\n");
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Opening\nnumber: 1\nstatus: draft\nword-count: 0", "## Chapter Text\n\nThe gray sky fell. The gray sky fell. The gray sky fell.\n");
    const { envelope } = invokeJson(root, ["prose", "--json"]);
    expect(envelope.data.similarNames.map((pair) => pair.map((entry) => entry.id))).toEqual([["mara-dole", "mary-vance"]]);
    expect(envelope.data.chapters[0].analysis.variants).toEqual([{ use: "grey", avoid: "gray", source: "style sheet", count: 3 }]);
    expect(envelope.data.phrases.length).toBeGreaterThan(0);
  });

  test("prose - and voices - take --json, labelling the passage stdin", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Piped Json", force: false });
    writeMarkdown(path.join(root, "characters", "mara-quill.md"), "name: Mara Quill\nrole: supporting\nstatus: alive\nvoice-avoid:\n  - okay", "# Mara\n");
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\npreferred:\n  - use: grey\n    avoid: gray", "# Style Sheet\n");
    const passage = "She felt the gray door give. \"Okay, come in,\" Mara said.\n";

    const prose = invokeJson(cwd, ["prose", "-", "--path", root, "--json"], passage);
    expect(prose.code).toBe(0);
    expect(prose.envelope.data.chapters.map((chapter) => chapter.file)).toEqual(["stdin"]);
    expect(prose.envelope.data.chapters[0].analysis.filterWords).toEqual([{ word: "felt", count: 1 }]);
    expect(prose.envelope.data.chapters[0].analysis.phraseSentences).toBeUndefined();
    expect(prose.envelope.diagnostics.length).toBeGreaterThan(0);
    expect(prose.envelope.diagnostics.every((entry) => entry.file === "stdin")).toBe(true);

    const voices = invokeJson(cwd, ["voices", "-", "--json", "--path", root], passage);
    expect(voices.envelope.data.profiles.map((profile) => profile.id)).toEqual(["mara-quill"]);
    const avoided = voices.envelope.diagnostics.find((entry) => entry.message.includes("okay"));
    expect(avoided).toMatchObject({ severity: "warning", file: "stdin", code: "voices" });
    expect(avoided.message).toContain("stdin");

    // Without a project, prose still lints the passage.
    expect(invokeJson(makeTempDir(), ["--json", "prose", "-"], passage).envelope.ok).toBe(true);
  });

  test("a stdin error under --json is the JSON error result", () => {
    for (const command of ["prose", "voices"]) {
      const { code, envelope } = invokeJson(makeTempDir(), [command, "-", "--json"], "");
      expect(code).toBe(2);
      expect(envelope).toMatchObject({ command, ok: false, data: null });
      expect(envelope.diagnostics).toHaveLength(1);
      expect(envelope.diagnostics[0].severity).toBe("error");
    }
  });

  test("prose --json leaves out each chapter's tokenized sentences", () => {
    const { envelope } = invokeJson(brokenProject(), ["prose", "--json"]);
    expect(envelope.data.chapters[0].analysis.filterWords).toEqual([{ word: "felt", count: 2 }]);
    expect(envelope.data.chapters[0].analysis.phraseSentences).toBeUndefined();
  });

  test("help lists --json for the commands that take it", () => {
    expect(invoke(makeTempDir(), ["--help"]).out).toContain("--json");
    expect(invoke(makeTempDir(), ["validate", "--help"]).out).toContain("--json");
    expect(invoke(makeTempDir(), ["init", "--help"]).out).not.toContain("--json");
  });
});

describe("json helpers", () => {
  test("exit codes follow ok: 0 when it is true, else the failure's code", () => {
    const io = memoryIo(makeTempDir());
    expect(writeJsonResult(io, { command: "validate", ok: true, exitCode: 3 })).toBe(0);
    expect(writeJsonResult(io, { command: "validate", ok: false })).toBe(1);
    expect(writeJsonResult(io, { command: "validate", ok: false, exitCode: 4 })).toBe(4);
  });

  test("diagnostics name the leading project file, or null", () => {
    expect(diagnostic("warning", "story.md: bad yaml", "validate").file).toBe("story.md");
    expect(diagnostic("warning", "continuity/state.md knowledge-state[0] is missing knows", "validate").file).toBe("continuity/state.md");
    expect(diagnostic("error", "Chapter numbering starts at 2, not 1", "validate").file).toBeNull();
    expect(diagnostic("error", "plot/outline.yml", "validate").file).toBe("plot/outline.yml");
  });

  test("diagnosticsFrom and resultData split a result", () => {
    const result = { ok: false, errors: ["a.md broke"], warnings: ["b"], extra: 1 };
    expect(diagnosticsFrom(result, "x")).toEqual([
      { severity: "error", file: "a.md", message: "a.md broke", code: "x" },
      { severity: "warning", file: null, message: "b", code: "x" }
    ]);
    expect(diagnosticsFrom({}, "x")).toEqual([]);
    expect(resultData(result)).toEqual({ extra: 1 });
  });
});

describe("result.schema.json", () => {
  test("rejects data that does not match its command", () => {
    const envelope = { apiVersion: API_VERSION, command: "pacing", ok: true, data: { rows: "no" }, diagnostics: [], writes: [] };
    const errors = validateAgainstSchema(envelope, schema);
    expect(errors).toContain("$.data: missing required medianWords");
    expect(errors).toContain("$.data.rows: expected array, got string");
  });

  test("data must be an object or null", () => {
    for (const data of ["text", [], 3]) {
      const envelope = { apiVersion: API_VERSION, command: "timeline", ok: true, data, diagnostics: [], writes: [] };
      expect(validateAgainstSchema(envelope, schema).length).toBeGreaterThan(0);
    }
  });

  test("an if without a then, or a then without an if, is refused", () => {
    expect(() => validateAgainstSchema(1, { if: { type: "integer" } })).toThrow("Schema if without then at #");
    expect(() => validateAgainstSchema(1, { allOf: [{ then: { type: "integer" } }] })).toThrow("Schema then without if at #/allOf/0");
  });

  test("a result without data must not be ok", () => {
    const envelope = { apiVersion: API_VERSION, command: "validate", ok: true, data: null, diagnostics: [], writes: [] };
    expect(validateAgainstSchema(envelope, schema)).toEqual(["$.ok: expected false, got true"]);
  });
});

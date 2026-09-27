import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { API_VERSION, diagnostic, diagnosticsFrom, exitCodeFor, resultData } from "../src/json.js";
import { createStoryProject } from "../src/story.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const examplesRoot = path.resolve(import.meta.dir, "..", "examples");
const examples = fs.readdirSync(examplesRoot).sort().filter((name) => fs.existsSync(path.join(examplesRoot, name, "story.md")));
const PATH_COMMANDS = ["validate", "links", "continuity", "series", "next", "doctor", "report", "timeline", "prose", "voices", "pacing", "clues", "progress"];

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// Runs a --json command and checks the contract every result keeps: one
// JSON object on stdout, nothing on stderr, the schema, and ok matching the
// exit code.
function invokeJson(cwd, argv) {
  const result = invoke(cwd, argv);
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
    expect(usage.code).toBe(1);
    expect(usage.envelope.data).toBeNull();
    expect(usage.envelope.diagnostics).toEqual([{ severity: "error", file: null, message: expect.stringContaining("Usage: story knowledge"), code: "knowledge" }]);
  });

  test("a failure after --json (unknown character, missing project) is a JSON result", () => {
    const root = path.join(examplesRoot, "the-last-ember");
    const unknown = invokeJson(root, ["knowledge", "nobody", "--at", "chapter-01", "--json"]);
    expect(unknown.code).toBe(1);
    expect(unknown.envelope.diagnostics[0].message).toBe("Unknown character nobody");

    const missing = invokeJson(makeTempDir(), ["validate", "--json"]);
    expect(missing.envelope).toMatchObject({ command: "validate", ok: false });
  });

  test("usage and parse errors are JSON results when --json is on", () => {
    const root = path.join(examplesRoot, "the-last-ember");
    const extra = invokeJson(root, ["validate", ".", "extra", "--json"]);
    expect(extra.code).toBe(1);
    expect(extra.envelope.diagnostics[0].message).toContain("Unexpected argument");

    const unknownOption = invokeJson(root, ["prose", "--jsn", "--json=yes"]);
    expect(unknownOption.envelope.diagnostics[0].message).toContain("Unknown option --jsn");

    const badValue = invokeJson(root, ["pacing", "--json=maybe"]);
    expect(badValue.envelope.diagnostics[0].message).toContain('Unknown value "maybe" for --json');
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
    expect(result.code).toBe(1);
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
  test("exit codes follow ok", () => {
    expect(exitCodeFor(true)).toBe(0);
    expect(exitCodeFor(false)).toBe(1);
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

  test("a result without data must not be ok", () => {
    const envelope = { apiVersion: API_VERSION, command: "validate", ok: true, data: null, diagnostics: [], writes: [] };
    expect(validateAgainstSchema(envelope, schema)).toEqual(["$.ok: expected false, got true"]);
  });
});

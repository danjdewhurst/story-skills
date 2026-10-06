import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { err, warn } from "../src/findings.js";
import { createStoryProject, uniqueCheckFindings } from "../src/story.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const examplesRoot = path.resolve(import.meta.dir, "..", "examples");
const examples = fs.readdirSync(examplesRoot).sort().filter((name) => fs.existsSync(path.join(examplesRoot, name, "story.md")));

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function invokeJson(cwd, argv) {
  const result = invoke(cwd, argv);
  expect(result.err).toBe("");
  const envelope = JSON.parse(result.out);
  expect(validateAgainstSchema(envelope, schema)).toEqual([]);
  expect(envelope.ok).toBe(result.code === 0);
  return { ...result, envelope };
}

// A project with one chapter, made as story add makes it: `fields` sets
// chapter frontmatter fields, written as YAML.
function project(fields = {}) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Check Run", force: false });
  expect(invoke(root, ["add", "chapter", "Opening"]).code).toBe(0);
  const chapter = path.join(root, "chapters", "chapter-01.md");
  let text = fs.readFileSync(chapter, "utf8");
  for (const [key, value] of Object.entries(fields)) {
    text = text.replace(new RegExp(`^${key}: .*$`, "m"), `${key}: ${value}`);
  }
  fs.writeFileSync(chapter, text, "utf8");
  return root;
}

// The finding lines of a text run (error:, warning:, and dismissed:).
function findingLines(text) {
  return text.split("\n").filter((line) => /^(error|warning|dismissed): /.test(line));
}

describe("story check", () => {
  test("passes a clean project and reports a warning without failing", () => {
    const root = project();
    const { code, err: stderr, out } = invoke(root, ["check"]);
    expect(code).toBe(0);
    expect(out).toBe("");
    expect(stderr).toBe("Checks passed: 0 errors, 1 warnings, 0 dismissed\nwarning: chapters/chapter-01.md has no machine-readable scene records [no-scene-records]\n");
  });

  test("fails on a reference only links catches, which validate passes", () => {
    const root = project({ pov: "nobody-here" });
    expect(invoke(root, ["validate"]).code).toBe(0);
    const { code, err: stderr } = invoke(root, ["check"]);
    expect(code).toBe(1);
    expect(stderr).toStartWith("Checks failed: 1 errors,");
    expect(stderr).toContain("error: chapters/chapter-01.md references missing POV character nobody-here\n");
    // continuity's warning about the same chapter is a different problem, so it stays.
    expect(stderr).toContain("[pov-not-in-cast]");
  });

  test("reports every finding of validate, links, and continuity, in that order", () => {
    for (const name of examples) {
      const root = path.join(examplesRoot, name);
      const separate = ["validate", "links", "continuity"].map((command) => invoke(root, [command]));
      const check = invoke(root, ["check"]);
      const expected = new Set(separate.flatMap((run) => findingLines(run.err)));
      expect(new Set(findingLines(check.err))).toEqual(expected);
      expect(check.code).toBe(separate.some((run) => run.code === 1) ? 1 : 0);
    }
  });

  test("an impossible date is the validate error, not also the continuity warning", () => {
    const root = project({ date: "2024-13-45" });
    expect(invoke(root, ["continuity"]).err).toContain("[malformed-date]");
    const { code, err: stderr } = invoke(root, ["check"]);
    expect(code).toBe(1);
    expect(stderr).toContain("error: chapters/chapter-01.md date must be a real YYYY-MM-DD calendar day, got 2024-13-45\n");
    expect(stderr).not.toContain("malformed-date");

    const { envelope } = invokeJson(root, ["check", "--json"]);
    expect(envelope.diagnostics.filter((entry) => entry.code === "invalid-date")).toEqual([
      expect.objectContaining({ severity: "error", check: "validate", file: "chapters/chapter-01.md" })
    ]);
    expect(envelope.diagnostics.some((entry) => entry.code === "malformed-date")).toBe(false);
    // data.checks is each check as its own command reports it.
    expect(envelope.data.checks.continuity.warnings).toBe(envelope.diagnostics.filter((entry) => entry.check === "continuity").length + 1);

    // report, next, and doctor --json list it once too.
    const report = invokeJson(root, ["report", "--json"]).envelope;
    expect(report.diagnostics.some((entry) => entry.code === "malformed-date")).toBe(false);
  });

  test("a malformed date that is not shaped like a day stays a continuity warning", () => {
    const root = project({ date: "midsummer" });
    const { code, err: stderr } = invoke(root, ["check"]);
    expect(code).toBe(0);
    expect(stderr).toContain("[malformed-date]");
  });

  test("lists a file that fails to parse once, under validate", () => {
    const root = project();
    fs.writeFileSync(path.join(root, "chapters", "chapter-02.md"), "No frontmatter here.\n", "utf8");
    const { code, envelope } = invokeJson(root, ["check", "--json"]);
    expect(code).toBe(1);
    const parseErrors = envelope.diagnostics.filter((entry) => entry.code === "unreadable-file");
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0].check).toBe("validate");
    expect(envelope.data.errors).toBe(envelope.diagnostics.filter((entry) => entry.severity === "error").length);
    expect(envelope.data.checks.links.errors).toBeGreaterThan(0);
  });

  test("--strict reports each warning as an error and fails", () => {
    const root = project();
    const { code, err: stderr } = invoke(root, ["check", "--strict"]);
    expect(code).toBe(1);
    expect(stderr).toBe("Checks failed: 1 errors, 0 warnings, 0 dismissed\nerror: chapters/chapter-01.md has no machine-readable scene records [no-scene-records]\n");

    const { envelope } = invokeJson(root, ["check", "--strict", "--json"]);
    expect(envelope.ok).toBe(false);
    expect(envelope.data).toMatchObject({ errors: 1, warnings: 0, dismissed: 0, strict: true });
    expect(envelope.data.checks.validate).toEqual({ ok: true, errors: 0, warnings: 1, dismissed: 0 });
    expect(envelope.diagnostics[0]).toMatchObject({ severity: "error", code: "no-scene-records", check: "validate" });
  });

  test("--strict leaves a warning story.md severity turned off dismissed", () => {
    const root = project();
    const storyFile = path.join(root, "story.md");
    fs.writeFileSync(storyFile, fs.readFileSync(storyFile, "utf8").replace(/^---\n/, "---\nseverity:\n  - warning: no-scene-records\n    level: off\n"), "utf8");
    const { code, err: stderr } = invoke(root, ["check", "--strict"]);
    expect(code).toBe(0);
    expect(stderr).toStartWith("Checks passed: 0 errors, 0 warnings, 1 dismissed\n");
  });

  test("story.md severity promotes a warning, and cli-defaults can set --strict", () => {
    const root = project();
    const storyFile = path.join(root, "story.md");
    const original = fs.readFileSync(storyFile, "utf8");
    fs.writeFileSync(storyFile, original.replace(/^---\n/, "---\nseverity:\n  - warning: no-scene-records\n    level: error\n"), "utf8");
    expect(invoke(root, ["check"]).code).toBe(1);
    fs.writeFileSync(storyFile, original.replace(/^---\n/, "---\ncli-defaults:\n  - command: check\n    strict: true\n"), "utf8");
    expect(invoke(root, ["check"]).code).toBe(1);
    expect(invoke(root, ["check", "--strict=false"]).code).toBe(0);
  });

  test("still runs while story.md severity is invalid, and reports it", () => {
    const root = project();
    const storyFile = path.join(root, "story.md");
    fs.writeFileSync(storyFile, fs.readFileSync(storyFile, "utf8").replace(/^---\n/, "---\nseverity:\n  - warning: not-a-code\n    level: error\n"), "utf8");
    expect(invoke(root, ["links"]).code).toBe(3);
    const { code, err: stderr } = invoke(root, ["check"]);
    expect(code).toBe(1);
    expect(stderr).toContain("not-a-code");
  });

  test("continuity exemptions dismiss findings as story continuity does", () => {
    const { root } = createStoryProject({ cwd: makeTempDir(), title: "Check Run", force: false });
    writeMarkdown(path.join(root, "characters", "edran-vale.md"), "name: Edran Vale\nrole: supporting\nstatus: deceased\ndied-in: chapter-01", "# Edran\n");
    for (const number of [1, 2]) {
      writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Chapter ${number}\nnumber: ${number}\ncharacters:\n  - edran-vale\nstatus: draft\nword-count: 0`, "## Chapter Text\n\nWords.\n");
    }
    expect(invoke(root, ["check"]).err).toContain("error: chapters/chapter-02.md lists edran-vale");
    writeMarkdown(path.join(root, "continuity", "exemptions.md"), 'type: exemption-log\nstory: check-run\nexemptions:\n  - pattern: "edran-vale"\n    reason: "Ghost scene"', "# Exemptions\n");
    const { envelope } = invokeJson(root, ["check", "--json"]);
    expect(envelope.diagnostics.find((entry) => entry.severity === "dismissed")).toMatchObject({ code: "posthumous-appearance", check: "continuity", exemption: "Ghost scene" });
    expect(envelope.diagnostics.some((entry) => entry.code === "posthumous-appearance" && entry.severity === "error")).toBe(false);
  });

  test("refuses a stray argument and reports a missing project", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["check", "a", "b"]).code).toBe(2);
    expect(invoke(cwd, ["check"]).code).toBe(3);
    const { code, envelope } = invokeJson(cwd, ["check", "--json"]);
    expect(code).toBe(3);
    expect(envelope.diagnostics[0]).toMatchObject({ code: "unusable-project", check: "check" });
  });
});

describe("uniqueCheckFindings", () => {
  test("keeps a repeated finding under its first check and drops a superseded one", () => {
    const parse = err("unreadable-file", "a.md is missing YAML frontmatter", "a.md");
    const checks = uniqueCheckFindings({
      validate: { ok: false, errors: [parse, err("invalid-date", "b.md date must be a real day", "b.md")], warnings: [] },
      links: { ok: false, errors: [parse], warnings: [], extra: 1 },
      continuity: {
        ok: true,
        errors: [],
        warnings: [warn("malformed-date", "Chapter 2 has malformed date", "b.md"), warn("malformed-date", "Chapter 3 has malformed date", "c.md")],
        dismissed: [{ finding: warn("malformed-date", "Chapter 2 has malformed date", "b.md"), reason: "x" }]
      }
    });
    expect(checks.validate.errors).toHaveLength(2);
    expect(checks.links).toEqual({ ok: false, errors: [], warnings: [], dismissed: [], extra: 1 });
    expect(checks.continuity.warnings.map((finding) => finding.file)).toEqual(["c.md"]);
    expect(checks.continuity.dismissed).toEqual([]);
  });
});

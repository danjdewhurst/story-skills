import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { checkContinuity } from "../src/continuity.js";
import { usableChecks } from "../src/custom-checks.js";
import { createStoryProject, projectCheck, scanProject, validateProject } from "../src/story.js";
import { RESULT_SCHEMA_PATH, checkProjectSchema, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const resultSchema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function writeChapter(root, number, frontmatter = "") {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Chapter ${number}\nnumber: ${number}\n${frontmatter}`, "## Chapter Text\n\nWords.\n");
}

// Adds frontmatter lines to the end of story.md's frontmatter.
function configure(root, yaml) {
  const file = path.join(root, "story.md");
  const text = fs.readFileSync(file, "utf8");
  const end = text.indexOf("\n---\n", 4);
  fs.writeFileSync(file, `${text.slice(0, end)}\n${yaml.trim()}${text.slice(end)}`, "utf8");
}

function writeExemptions(root, entries) {
  writeMarkdown(path.join(root, "continuity", "exemptions.md"), `type: exemption-log\nstory: project-checks\nexemptions:\n${entries}`, "# Exemptions\n");
}

const CHECKS = [
  "checks:",
  "  - id: chapter-needs-hook",
  "    kind: chapter",
  "    where: [status=draft, \"!hook\"]",
  "    level: warning",
  "    message: has no hook",
  "  - id: ilse-pov",
  "    kind: chapters",
  "    where: [pov=ilse]",
  "    level: error",
  "    message: is told by Ilse"
].join("\n");

function sampleProject(yaml = CHECKS) {
  const { root } = createStoryProject({ cwd: makeTempDir(), title: "Project Checks", force: false });
  writeChapter(root, 1, "status: draft\npov: ilse\nhook: question");
  writeChapter(root, 2, "status: draft\npov: mara");
  writeChapter(root, 3, "status: final\npov: mara");
  writeChapter(root, 4, "status: draft\npov: ilse");
  configure(root, yaml);
  return root;
}

const custom = (findings) => findings.filter((finding) => finding.code.startsWith("custom-"));
const codes = (findings, prefix) => findings.filter((finding) => finding.code.startsWith(prefix)).map((finding) => `${finding.code}: ${finding.message}`);

describe("story.md checks (#891)", () => {
  test("continuity reports each matching file under custom-<id>, at the check's level, in scan order", () => {
    const root = sampleProject();
    const result = checkContinuity(scanProject(root));
    expect(custom(result.warnings)).toEqual([
      { code: "custom-chapter-needs-hook", message: "chapters/chapter-02.md has no hook", file: "chapters/chapter-02.md", chapter: null },
      { code: "custom-chapter-needs-hook", message: "chapters/chapter-04.md has no hook", file: "chapters/chapter-04.md", chapter: null }
    ]);
    expect(custom(result.errors)).toEqual([
      { code: "custom-ilse-pov", message: "chapters/chapter-01.md is told by Ilse", file: "chapters/chapter-01.md", chapter: null },
      { code: "custom-ilse-pov", message: "chapters/chapter-04.md is told by Ilse", file: "chapters/chapter-04.md", chapter: null }
    ]);
    expect(result.ok).toBe(false);
  });

  test("a check matches the files story list matches with the same filters", () => {
    const root = sampleProject();
    const listed = JSON.parse(invoke(root, ["list", "chapter", "--where", "status=draft", "--where", "!hook", "--json"]).out).data.items.map((item) => item.file);
    const reported = custom(checkContinuity(scanProject(root)).warnings).map((finding) => finding.file);
    expect(reported).toEqual(listed);
  });

  test("story check prints the code at either level, fails on an error check, and passes --json through the result schema", () => {
    const root = sampleProject();
    const text = invoke(root, ["check"]);
    expect(text.code).toBe(1);
    expect(text.err).toContain("error: chapters/chapter-01.md is told by Ilse [custom-ilse-pov]\n");
    expect(text.err).toContain("warning: chapters/chapter-02.md has no hook [custom-chapter-needs-hook]\n");

    const json = JSON.parse(invoke(root, ["check", "--json"]).out);
    expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
    expect(json.diagnostics.filter((entry) => entry.code.startsWith("custom-")).map((entry) => [entry.severity, entry.code, entry.file, entry.check])).toEqual([
      ["error", "custom-ilse-pov", "chapters/chapter-01.md", "continuity"],
      ["error", "custom-ilse-pov", "chapters/chapter-04.md", "continuity"],
      ["warning", "custom-chapter-needs-hook", "chapters/chapter-02.md", "continuity"],
      ["warning", "custom-chapter-needs-hook", "chapters/chapter-04.md", "continuity"]
    ]);
  });

  test("a warning check passes story check and fails it under --strict", () => {
    const root = sampleProject(CHECKS.split("\n").slice(0, 6).join("\n"));
    const plain = projectCheck(root);
    expect(custom(plain.warnings)).toHaveLength(2);
    expect(custom(plain.errors)).toEqual([]);
    const strict = projectCheck(root, { strict: true });
    expect(custom(strict.errors)).toHaveLength(2);
    expect(strict.ok).toBe(false);
  });

  test("severity promotes or turns off a warning check's code", () => {
    const promoted = sampleProject(`${CHECKS}\nseverity:\n  - warning: custom-chapter-needs-hook\n    level: error`);
    const loud = invoke(promoted, ["continuity"]);
    expect(loud.code).toBe(1);
    expect(loud.err).toContain("error: chapters/chapter-02.md has no hook [custom-chapter-needs-hook]\n");

    const silenced = sampleProject(`${CHECKS}\nseverity:\n  - warning: custom-chapter-needs-hook\n    level: off`);
    const quiet = invoke(silenced, ["continuity"]);
    expect(quiet.err).toContain("dismissed: chapters/chapter-02.md has no hook (severity custom-chapter-needs-hook is off in story.md)\n");
    expect(quiet.err).not.toContain("[custom-chapter-needs-hook]");
  });

  test("severity refuses a custom code with no check, or whose check reports an error", () => {
    const missing = sampleProject(`${CHECKS}\nseverity:\n  - warning: custom-chapter-needs-hok\n    level: error`);
    expect(codes(validateProject(missing).errors, "invalid-cli-config")).toEqual([
      "invalid-cli-config: story.md severity[0] names custom-chapter-needs-hok, but story.md checks has no check chapter-needs-hok; did you mean custom-chapter-needs-hook?"
    ]);
    expect(invoke(missing, ["check"]).code).toBe(3);

    const error = sampleProject(`${CHECKS}\nseverity:\n  - warning: custom-ilse-pov\n    level: off`);
    expect(codes(validateProject(error).errors, "invalid-cli-config")).toEqual([
      "invalid-cli-config: story.md severity[0] names custom-ilse-pov, whose check reports an error: severity changes only warnings, so set the check's level instead"
    ]);
  });

  test("an exemption dismisses one finding of a check, error or warning", () => {
    const root = sampleProject();
    writeExemptions(root, [
      "  - code: custom-ilse-pov",
      "    file: chapters/chapter-01.md",
      "    reason: The prologue is Ilse's.",
      "  - code: custom-chapter-needs-hook",
      "    file: chapters/chapter-04.md",
      "    reason: The quiet chapter."
    ].join("\n"));
    expect(codes(validateProject(root).errors, "exemption")).toEqual([]);
    const result = projectCheck(root);
    expect(custom(result.errors).map((finding) => finding.file)).toEqual(["chapters/chapter-04.md"]);
    expect(custom(result.warnings).map((finding) => finding.file)).toEqual(["chapters/chapter-02.md"]);
    expect(result.dismissed.map((entry) => [entry.finding.code, entry.finding.file, entry.reason])).toEqual([
      ["custom-ilse-pov", "chapters/chapter-01.md", "The prologue is Ilse's."],
      ["custom-chapter-needs-hook", "chapters/chapter-04.md", "The quiet chapter."]
    ]);
  });

  test("validate refuses an exemption naming a check story.md does not define, or a check's code alone", () => {
    const root = sampleProject();
    writeExemptions(root, [
      "  - code: custom-no-such-check",
      "    file: chapters/chapter-01.md",
      "    reason: Typo.",
      "  - code: custom-ilse-pov",
      "    reason: Every one."
    ].join("\n"));
    expect(codes(validateProject(root).errors, "exemption")).toEqual([
      "exemption-unknown-code: continuity/exemptions.md exemptions[0] code custom-no-such-check names no check in story.md checks",
      "exemption-too-broad: continuity/exemptions.md exemptions[1] sets only code, which would dismiss every custom-ilse-pov finding: add file, chapter, or pattern to narrow it"
    ]);
  });

  test("validate reports each problem with the list, and continuity skips the broken entries without failing", () => {
    const root = sampleProject([
      "checks:",
      "  - id: Bad Id",
      "    kind: chapterz",
      "    where: [\"=x\", \"pov=\"]",
      "    level: info",
      "    message: \"  \"",
      "    extra: 1",
      "  - kind: chapter",
      "    where: []",
      "  - id: 2025",
      "    kind: chapter",
      "    where: pov=ilse",
      "    level: warning",
      "    message: x",
      "  - just text",
      "  - id: twice",
      "    kind: chapter",
      "    where: [pov=ilse]",
      "    level: warning",
      "    message: first",
      "  - id: twice",
      "    kind: chapter",
      "    where: [pov=mara]",
      "    level: warning",
      "    message: second",
      "  - id: typo",
      "    kind: chapter",
      "    where: [stauts=draft]",
      "    level: warning",
      "    message: never matches"
    ].join("\n"));
    const report = validateProject(root);
    const listed = [...report.errors, ...report.warnings].filter((finding) => finding.file === "story.md" && /check/.test(finding.message)).map((finding) => `${finding.code}: ${finding.message}`);
    expect(listed).toEqual([
      "invalid-check: story.md checks[0] has extra: a check takes only id, kind, where, level, and message",
      "id-not-kebab: story.md checks[0] id \"Bad Id\" must be kebab-case, such as chapter-needs-hook",
      "invalid-check: story.md checks[0] kind \"chapterz\" is not a kind story list takes (chapters, scenes, characters, locations, systems, factions, artifacts, arcs, questions, promises, clues, terms, research, matter, or the singular); did you mean chapters?",
      "invalid-check: story.md checks[0] cannot read where filter \"=x\": expected key=value, key!=value, key, or \"!key\"",
      "invalid-check: story.md checks[0] where filter \"pov=\" needs a value after =; write \"pov\" for a key that is set, or \"!pov\" for one that is not",
      "invalid-check: story.md checks[0] level \"info\" must be error or warning",
      "invalid-check: story.md checks[0] message must be text, such as message: has no hook",
      "missing-field: story.md checks[1] is missing id",
      "invalid-check: story.md checks[1] where needs at least one filter, such as where: [status=draft]",
      "missing-field: story.md checks[1] is missing level",
      "missing-field: story.md checks[1] is missing message",
      "field-not-text: story.md checks[2] id 2025 is not text: quote it, such as id: \"2025\"",
      "invalid-check: story.md checks[2] where must be a list of filters, such as where: [status=draft, pov=mara-quill]",
      "field-invalid-items: story.md frontmatter field checks must contain mappings, such as - id: chapter-needs-hook",
      "duplicate-check: story.md lists check twice more than once",
      "check-unknown-key: story.md check typo filters on \"stauts\", which no chapter file sets and the schema does not define, so it matches as unset; did you mean \"status\"?"
    ]);
    expect(checkProjectSchema(root).some((problem) => problem.includes(".checks"))).toBe(true);

    const project = scanProject(root);
    expect(usableChecks(project).map((check) => [check.id, check.message])).toEqual([["twice", "first"], ["typo", "never matches"]]);
    expect(custom(checkContinuity(project).warnings).map((finding) => finding.message)).toEqual(["chapters/chapter-01.md first", "chapters/chapter-04.md first"]);
  });

  test("a checks field that is not a list is one error, and continuity runs no checks", () => {
    const root = sampleProject("checks: chapter-needs-hook");
    expect(codes(validateProject(root).errors, "field-not-list")).toEqual(["field-not-list: story.md frontmatter field checks must be a list"]);
    expect(custom(checkContinuity(scanProject(root)).warnings)).toEqual([]);
  });

  test("valid checks pass validate and the schema", () => {
    const root = sampleProject(`${CHECKS}\nseverity:\n  - warning: custom-chapter-needs-hook\n    level: error`);
    writeExemptions(root, "  - code: custom-ilse-pov\n    file: chapters/chapter-01.md\n    reason: Fine.");
    expect(validateProject(root).errors.filter((finding) => /check|severity|exemption/.test(finding.message))).toEqual([]);
    expect(checkProjectSchema(root).filter((problem) => /checks|severity|exemptions/.test(problem))).toEqual([]);
  });
});

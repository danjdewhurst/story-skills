import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { checkContinuity } from "../src/continuity.js";
import { dismissByExemptions, exemptionFile, exemptionMatches, parseExemptions, readExemptionLog } from "../src/exemptions.js";
import { warn } from "../src/findings.js";
import { createStoryProject, moveEntity, removeEntity, renameEntity, scanProject, validateProject } from "../src/story.js";
import { checkProjectSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// Two drafted chapters told by ann, who is in neither cast (pov-not-in-cast
// twice, each with its chapter), with a TODO marker in each (todo-markers
// twice, from validate, which also warns no-scene-records twice).
function povProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Keys", force: false });
  writeMarkdown(path.join(root, "characters", "ann.md"), "name: Ann\nrole: protagonist\nstatus: alive", "# Ann\n");
  for (const number of [1, 2]) {
    writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
pov: ann
characters: []
status: draft
word-count: 0
`, "## Chapter Text\n\nWords [TODO: fix] here.\n");
  }
  const state = path.join(root, "continuity", "state.md");
  fs.writeFileSync(state, fs.readFileSync(state, "utf8").replace("current-chapter: 0", "current-chapter: 2"), "utf8");
  expect(invoke(cwd, ["reindex", root]).code).toBe(0);
  expect(invoke(cwd, ["wordcount", root, "--write"]).code).toBe(0);
  return { root, cwd };
}

function writeLog(root, entries) {
  writeMarkdown(path.join(root, "continuity", "exemptions.md"), `type: exemption-log\nstory: keys\nexemptions:\n${entries}`, "# Exemptions\n");
}

function configure(root, yaml) {
  const file = path.join(root, "story.md");
  const text = fs.readFileSync(file, "utf8");
  const end = text.indexOf("\n---\n", 4);
  fs.writeFileSync(file, `${text.slice(0, end)}\n${yaml.trim()}${text.slice(end)}`, "utf8");
}

const CH1 = "chapters/chapter-01.md";
const CH2 = "chapters/chapter-02.md";

describe("exemption keys (#284)", () => {
  test("continuity findings carry their chapter", () => {
    const { root } = povProject();
    const result = checkContinuity(scanProject(root));
    expect(result.warnings.map(({ code, file, chapter }) => ({ code, file, chapter }))).toEqual([
      { code: "pov-not-in-cast", file: CH1, chapter: "chapter-01" },
      { code: "pov-not-in-cast", file: CH2, chapter: "chapter-02" }
    ]);
  });

  test("code with file dismisses that finding only, and code with chapter the other", () => {
    const { root } = povProject();
    writeLog(root, "  - code: pov-not-in-cast\n    file: chapters/chapter-01.md\n    reason: Ann narrates from outside");
    let result = checkContinuity(scanProject(root));
    expect(result.warnings.map((finding) => finding.file)).toEqual([CH2]);
    expect(result.dismissed).toEqual([{ finding: expect.objectContaining({ file: CH1 }), reason: "Ann narrates from outside", index: 0 }]);

    writeLog(root, "  - code: pov-not-in-cast\n    chapter: chapter-02\n    reason: Ann narrates from outside");
    result = checkContinuity(scanProject(root));
    expect(result.warnings.map((finding) => finding.file)).toEqual([CH1]);
  });

  test("every key an entry sets must match", () => {
    const { root } = povProject();
    writeLog(root, [
      "  - code: pov-scene-mismatch\n    file: chapters/chapter-01.md\n    reason: wrong code",
      "  - code: pov-not-in-cast\n    pattern: \"not in the text\"\n    reason: wrong text",
      "  - code: pov-not-in-cast\n    chapter: chapter-09\n    reason: wrong chapter",
      "  - file: chapters/chapter-01.md\n    chapter: chapter-02\n    reason: file and chapter disagree"
    ].join("\n"));
    expect(checkContinuity(scanProject(root)).dismissed).toEqual([]);

    writeLog(root, "  - code: pov-not-in-cast\n    pattern: \"POV character ann\"\n    file: chapters/chapter-02.md\n    chapter: chapter-02\n    reason: all four");
    expect(checkContinuity(scanProject(root)).dismissed.map((entry) => entry.finding.file)).toEqual([CH2]);
  });

  test("a file key matches either separator and a leading ./", () => {
    const { root } = povProject();
    writeLog(root, "  - code: pov-not-in-cast\n    file: \".\\\\chapters\\\\chapter-01.md\"\n    reason: Windows-style path");
    expect(validateProject(root).errors).toEqual([]);
    expect(checkContinuity(scanProject(root)).dismissed.map((entry) => entry.finding.file)).toEqual([CH1]);
    expect(exemptionFile("./chapters/./chapter-01.md")).toBe("chapters/chapter-01.md");
    expect(exemptionFile("chapters/")).toBe("chapters");
    for (const outside of ["a\0b.md", "/etc/passwd", "C:\\story\\a.md", "../other/story.md", "a/../../b.md", ".", "./"]) {
      expect(exemptionFile(outside)).toBeNull();
    }
  });

  test("a chapter key never matches a finding that carries no chapter", () => {
    const finding = warn("promise-unpaid", "continuity/promises/p.md was planted in chapter-01", "continuity/promises/p.md");
    expect(exemptionMatches({ chapter: "chapter-01" }, finding)).toBe(false);
    expect(exemptionMatches({ file: "continuity/promises/p.md" }, finding)).toBe(true);
    expect(exemptionMatches({ file: "a.md" }, warn("chapter-numbering-start", "Chapter numbering starts at 2, not 1"))).toBe(false);
  });

  test("a pattern-only entry still applies only in story continuity", () => {
    const { root, cwd } = povProject();
    writeLog(root, "  - pattern: \"TODO marker\"\n    reason: Drafting notes stay for now");
    const validate = invoke(cwd, ["validate", root]);
    expect(validate.err).toContain("0 dismissed");
    expect(validate.err).toContain("[todo-markers]");
  });

  test("an entry with a code dismisses that warning in other commands, in text and --json", () => {
    const { root, cwd } = povProject();
    writeLog(root, "  - pattern: \"POV character ann\"\n    reason: text only\n  - code: todo-markers\n    file: chapters/chapter-01.md\n    reason: Kept until the copyedit");
    const text = invoke(cwd, ["validate", root]);
    expect(text.code).toBe(0);
    expect(text.err).toContain("3 warnings, 1 dismissed");
    expect(text.err).toMatch(/dismissed: chapters.chapter-01\.md has 1 \[TODO marker.*\(exemption: Kept until the copyedit\)\n/);

    const json = JSON.parse(invoke(cwd, ["validate", root, "--json"]).out);
    const dismissed = json.diagnostics.find((entry) => entry.severity === "dismissed");
    expect(dismissed).toMatchObject({ code: "todo-markers", file: CH1, chapter: null, exemption: "Kept until the copyedit", exemptionIndex: 1 });
    expect(json.diagnostics.filter((entry) => entry.code === "todo-markers" && entry.severity === "warning").map((entry) => entry.file)).toEqual([CH2]);

    const report = JSON.parse(invoke(cwd, ["report", root, "--json"]).out);
    expect(report.data.checks.validate).toMatchObject({ warnings: 3, dismissed: 1 });
    expect(report.data.checks.continuity).toMatchObject({ warnings: 0, dismissed: 2 });
  });

  test("an exemption applies before severity", () => {
    const { root, cwd } = povProject();
    writeLog(root, "  - code: todo-markers\n    file: chapters/chapter-01.md\n    reason: Kept until the copyedit");
    configure(root, "severity:\n  - warning: todo-markers\n    level: error");
    let result = invoke(cwd, ["validate", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("1 errors, 2 warnings, 1 dismissed");
    expect(result.err).toContain("(exemption: Kept until the copyedit)");

    fs.writeFileSync(path.join(root, "story.md"), fs.readFileSync(path.join(root, "story.md"), "utf8").replace("level: error", "level: off"), "utf8");
    result = invoke(cwd, ["validate", root]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("(exemption: Kept until the copyedit)");
    expect(result.err).toContain("(severity todo-markers is off in story.md)");
  });

  test("validate still applies exemptions while story.md severity is invalid", () => {
    const { root, cwd } = povProject();
    writeLog(root, "  - code: todo-markers\n    file: chapters/chapter-01.md\n    reason: Kept until the copyedit");
    configure(root, "severity:\n  - warning: todo-marker\n    level: error");
    const result = invoke(cwd, ["validate", root]);
    expect(result.err).toContain("1 dismissed");
    expect(result.err).toContain("names unknown warning todo-marker");
  });

  test("warnings printed after a command's output are exempted too", () => {
    const { root, cwd } = povProject();
    writeLog(root, "  - code: unknown-reference\n    pattern: nobody\n    reason: Nobody arrives in book two");
    const result = invoke(cwd, ["add", "chapter", "Three", "--character", "nobody", "--path", root]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("dismissed: ");
    expect(result.err).toContain("(exemption: Nobody arrives in book two)");
  });

  test("dismissByExemptions keeps errors unless asked, and leaves a result it cannot change alone", () => {
    const error = warn("posthumous-appearance", "a.md lists ann", "a.md", "chapter-02");
    const result = { ok: false, errors: [error], warnings: [] };
    const exemptions = [{ index: 0, code: "posthumous-appearance", file: "a.md", reason: "Ghost" }];
    expect(dismissByExemptions(result, exemptions, { errors: false })).toBe(result);
    expect(dismissByExemptions(result, [], { errors: true })).toBe(result);
    expect(dismissByExemptions(result, exemptions, { errors: true })).toEqual({ ok: true, errors: [], warnings: [], dismissed: [{ finding: error, reason: "Ghost", index: 0 }] });
  });

  test("an entry validate rejects never takes effect, and indexes count every entry", () => {
    expect(parseExemptions("nope")).toEqual([]);
    expect(parseExemptions([
      { code: "pov-not-in-cast", file: "/abs.md", reason: "bad file" },
      "not a mapping",
      { code: "pov-not-in-cast", chapter: "chapter-01", reason: " spaced " }
    ])).toEqual([{ index: 2, code: "pov-not-in-cast", chapter: "chapter-01", reason: "spaced" }]);
    expect(readExemptionLog(makeTempDir())).toEqual([]);
  });

  test("validate checks each key", () => {
    const { root } = povProject();
    writeLog(root, [
      "  - code: pov-not-in-cats\n    file: chapters/chapter-01.md\n    reason: typo",
      "  - code: missing-field\n    file: chapters/chapter-01.md\n    reason: a validate error",
      "  - code: kept-story-options\n    file: story.md\n    reason: an init warning",
      "  - code: 12\n    file: chapters/chapter-01.md\n    reason: not text",
      "  - code: pov-not-in-cast\n    file: ../elsewhere/chapter-01.md\n    reason: outside",
      "  - code: pov-not-in-cast\n    file: \"  \"\n    reason: blank file",
      "  - code: pov-not-in-cast\n    chapter: Chapter 1\n    reason: not an id",
      "  - code: todo-markers\n    reason: every TODO",
      "  - code: posthumous-appearance\n    reason: every ghost",
      "  - reason: matches nothing"
    ].join("\n"));
    const label = "continuity/exemptions.md exemptions";
    expect(messages(validateProject(root).errors)).toEqual([
      `${label}[0] code pov-not-in-cats is not a finding code; did you mean pov-not-in-cast?`,
      `${label}[1] code missing-field cannot be exempted: it is an error outside story continuity, which means the project is broken: only continuity errors and warnings can be exempted`,
      `${label}[2] code kept-story-options cannot be exempted: story init or story import reports it before there is an exemption log to read`,
      `${label}[3] code must be a finding code, such as clock-backward`,
      `${label}[4] file ../elsewhere/chapter-01.md must be a path inside the project, relative to story.md, such as chapters/chapter-03.md`,
      `${label}[5] file must be a project file path, such as chapters/chapter-03.md`,
      `${label}[6] chapter must be a kebab-case chapter id, such as chapter-03, got "Chapter 1"`,
      `${label}[7] sets only code, which would dismiss every todo-markers finding: add file, chapter, or pattern to narrow it, or set severity todo-markers to off in story.md`,
      `${label}[8] sets only code, which would dismiss every posthumous-appearance finding: add file, chapter, or pattern to narrow it`,
      `${label}[9] sets none of pattern, code, file, chapter: set at least one to say which findings it dismisses`
    ]);
    expect(validateProject(root).errors.map((error) => error.code)).toEqual([
      "exemption-unknown-code", "exemption-code-not-dismissible", "exemption-code-not-dismissible", "field-not-text",
      "exemption-file-not-relative", "field-not-text", "id-not-kebab", "exemption-too-broad", "exemption-too-broad", "missing-field"
    ]);
  });

  test("a key one typo away from a known key stops the entry, so it cannot widen it", () => {
    const { root } = povProject();
    writeLog(root, [
      "  - code: pov-not-in-cast\n    file: chapters/chapter-01.md\n    patern: ann\n    reason: typo in pattern",
      "  - code: pov-not-in-cast\n    chapterr: chapter-02\n    reason: typo in chapter"
    ].join("\n"));
    const label = "continuity/exemptions.md exemptions";
    expect(validateProject(root).errors.map((error) => [error.code, error.message])).toEqual([
      ["exemption-misspelled-key", `${label}[0] has patern; did you mean pattern?`],
      ["exemption-misspelled-key", `${label}[1] has chapterr; did you mean chapter?`],
      ["exemption-too-broad", `${label}[1] sets only code, which would dismiss every pov-not-in-cast finding: add file, chapter, or pattern to narrow it, or set severity pov-not-in-cast to off in story.md`]
    ]);
    const result = checkContinuity(scanProject(root));
    expect(result.dismissed).toEqual([]);
    expect(result.warnings.map((finding) => finding.file)).toEqual([CH1, CH2]);
  });

  test("a key that is not an exemption key stops the entry, so it cannot widen it", () => {
    const { root } = povProject();
    writeLog(root, [
      "  - pattern: \"POV character ann\"\n    file_path: chapters/chapter-01.md\n    reason: wrong key name",
      "  - pattern: \"POV character ann\"\n    scene: scene-01\n    reason: scene is not an entry key",
      "  - pattern: \"POV character ann\"\n    cde: pov-not-in-cast\n    reason: short typo",
      "  - pattern: \"POV character ann\"\n    mode: chapter\n    reason: a chapter key"
    ].join("\n"));
    const label = "continuity/exemptions.md exemptions";
    const unknown = (index, key) => ["exemption-unknown-key", `${label}[${index}] has ${key}, which is not an exemption key: use pattern, code, file, chapter, reason`];
    expect(validateProject(root).errors.map((error) => [error.code, error.message])).toEqual([
      unknown(0, "file_path"),
      unknown(1, "scene"),
      unknown(2, "cde"),
      unknown(3, "mode")
    ]);
    const result = checkContinuity(scanProject(root));
    expect(result.dismissed).toEqual([]);
    expect(result.warnings.map((finding) => finding.file)).toEqual([CH1, CH2]);
  });

  test("an exemption cannot dismiss an unreadable file, by code or by pattern", () => {
    const { root } = povProject();
    const chapter = path.join(root, CH2);
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("title: Chapter 2", "title: [unclosed"), "utf8");
    const unreadable = (result) => result.errors.filter((error) => error.code === "unreadable-file").map((error) => error.file);
    expect(unreadable(checkContinuity(scanProject(root)))).toEqual([CH2]);

    writeLog(root, "  - code: unreadable-file\n    file: chapters/chapter-02.md\n    reason: broken on purpose");
    expect(validateProject(root).errors.map((error) => error.code)).toContain("exemption-code-not-dismissible");
    let result = checkContinuity(scanProject(root));
    expect(unreadable(result)).toEqual([CH2]);
    expect(result.dismissed).toEqual([]);

    writeLog(root, "  - file: chapters/chapter-02.md\n    pattern: unclosed\n    reason: broken on purpose");
    result = checkContinuity(scanProject(root));
    expect(unreadable(result)).toEqual([CH2]);
    expect(result.dismissed).toEqual([]);
  });

  test("validate warns about a file or chapter that names nothing", () => {
    const { root } = povProject();
    writeLog(root, "  - code: pov-not-in-cast\n    file: chapters/chapter-09.md\n    reason: gone\n  - code: pov-not-in-cast\n    chapter: chapter-09\n    reason: gone\n  - code: pov-not-in-cast\n    file: chapters/\n    reason: a folder");
    const result = validateProject(root);
    expect(result.errors).toEqual([]);
    const label = "continuity/exemptions.md exemptions";
    expect(result.warnings.filter((warning) => warning.file === "continuity/exemptions.md").map((warning) => [warning.code, warning.message])).toEqual([
      ["stale-exemption", `${label}[0] file chapters/chapter-09.md is not a file in the project, so the entry matches nothing`],
      ["stale-exemption", `${label}[1] chapter chapter-09 is not a chapter in chapters/, so the entry matches nothing`],
      ["stale-exemption", `${label}[2] file chapters/ is not a file in the project, so the entry matches nothing`]
    ]);
  });

  test("a misspelled key, a file or chapter with no code or pattern, and a chapter a code never carries stop an entry", () => {
    const { root } = povProject();
    writeLog(root, [
      "  - Code: pov-not-in-cast\n    file: chapters/chapter-01.md\n    reason: capital C",
      "  - code: pov-not-in-cast\n    files: chapters/chapter-01.md\n    chapter: chapter-01\n    reason: plural",
      "  - file: chapters/chapter-01.md\n    reason: file alone",
      "  - chapter: chapter-01\n    reason: chapter alone",
      "  - file: chapters/chapter-01.md\n    chapter: chapter-01\n    reason: both",
      "  - code: promise-unpaid\n    file: chapters/chapter-01.md\n    chapter: chapter-01\n    reason: never carried",
      "  - pattern: \"POV character ann\"\n    file: chapters/chapter-02.md\n    reason: a pattern narrows a file"
    ].join("\n"));
    const label = "continuity/exemptions.md exemptions";
    expect(messages(validateProject(root).errors)).toEqual([
      `${label}[0] has Code; did you mean code?`,
      `${label}[0] sets file without code or pattern, which would dismiss every finding about it: add the finding's code`,
      `${label}[1] has files; did you mean file?`,
      `${label}[2] sets file without code or pattern, which would dismiss every finding about it: add the finding's code`,
      `${label}[3] sets chapter without code or pattern, which would dismiss every finding about it: add the finding's code`,
      `${label}[4] sets file and chapter without code or pattern, which would dismiss every finding about it: add the finding's code`,
      `${label}[5] sets chapter, but promise-unpaid findings carry no chapter, so it would never match: use file instead`
    ]);
    expect(checkContinuity(scanProject(root)).dismissed.map((entry) => [entry.index, entry.finding.file])).toEqual([[6, CH2]]);
  });

  test("a file key follows only the renamed entity's own file, and a moved scene takes its chapter", () => {
    const { root } = povProject();
    writeMarkdown(path.join(root, "worldbuilding", "locations", "ann.md"), "name: Ann\ntype: town", "# Ann\n");
    writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), "title: S\nchapter: chapter-01\nscene: 1\npov: ann\ncharacters: []\nstatus: draft\nstate-changes: []", "# S\n");
    writeLog(root, "  - code: pov-not-in-cast\n    file: worldbuilding/locations/ann.md\n    reason: the town\n  - code: pov-not-in-cast\n    file: scenes/chapter-01-scene-01.md\n    chapter: chapter-01\n    reason: the scene");
    const log = path.join(root, "continuity", "exemptions.md");
    renameEntity(root, { kind: "character", id: "ann", name: "Anna" });
    expect(fs.readFileSync(log, "utf8")).toContain("file: worldbuilding/locations/ann.md");
    moveEntity(root, { kind: "scene", id: "chapter-01-scene-01", chapter: "chapter-02" });
    const text = fs.readFileSync(log, "utf8");
    expect(text).toContain("file: scenes/chapter-02-scene-01.md\n    chapter: chapter-02");
  });

  test("rename and move carry file and chapter keys, and remove warns about them", () => {
    const { root } = povProject();
    writeLog(root, "  - code: pov-not-in-cast\n    file: chapters/chapter-01.md\n    reason: by file\n  - code: pov-not-in-cast\n    chapter: chapter-02\n    reason: by chapter\n  - code: deceased-in-cast\n    file: characters/ann.md\n    pattern: lists ann\n    reason: by character");
    const log = path.join(root, "continuity", "exemptions.md");
    moveEntity(root, { kind: "chapter", id: "chapter-02", number: 3 });
    expect(fs.readFileSync(log, "utf8")).toContain("chapter: chapter-03");
    renameEntity(root, { kind: "character", id: "ann", name: "Anna" });
    const text = fs.readFileSync(log, "utf8");
    expect(text).toContain("file: characters/anna.md");
    expect(text).toContain("pattern: lists anna");
    expect(checkContinuity(scanProject(root)).dismissed).toHaveLength(2);

    const removed = removeEntity(root, { kind: "chapter", id: "chapter-01" });
    expect(removed.warnings.find((warning) => warning.code === "stale-exemption").message)
      .toBe("continuity/exemptions.md has an entry naming chapter-01 (exemptions[0]), which no longer matches anything: file \"chapters/chapter-01.md\". Delete or update it");
    const character = removeEntity(root, { kind: "character", id: "anna" });
    expect(character.warnings.find((warning) => warning.code === "stale-exemption").message)
      .toBe("continuity/exemptions.md has an entry naming anna (exemptions[2]), which no longer matches anything: pattern \"lists anna\", file \"characters/anna.md\". Delete or update it");
  });

  test("the schema checks the keys as validate does", () => {
    const schema = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "..", "schemas", "story.schema.json"), "utf8")).$defs.exemption.properties;
    const filePattern = new RegExp(schema.file.pattern, "u");
    for (const file of ["a\0b.md", "chapters/chapter-01.md", "./chapters/chapter-01.md", "chapters\\chapter-01.md", "a/./b.md", "chapters/", "/etc/passwd", "\\server\\x.md", "C:/x.md", "../x.md", "a/../b.md", "a/..", ".", "./", "  "]) {
      expect({ file, schema: filePattern.test(file) }).toEqual({ file, schema: file.trim() !== "" && exemptionFile(file) !== null });
    }

    const { root } = povProject();
    writeLog(root, "  - code: pov-not-in-cast\n    file: chapters/chapter-01.md\n    chapter: chapter-01\n    reason: fine\n  - code: missing-field\n    file: /abs.md\n    chapter: Chapter 1\n    reason: bad");
    expect(checkProjectSchema(root).filter((problem) => problem.includes("exemptions"))).toEqual([
      "$.continuity.exemptions[1].code: \"missing-field\" is not one of " + schema.code.enum.join(", "),
      `$.continuity.exemptions[1].file: "/abs.md" does not match ${schema.file.pattern}`,
      `$.continuity.exemptions[1].chapter: "Chapter 1" does not match ^[a-z0-9]+(?:-[a-z0-9]+)*$`
    ]);
  });
});

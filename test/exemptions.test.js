import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { checkContinuity } from "../src/continuity.js";
import { checkProjectContinuity, createEntity, createStoryProject, moveEntity, renameEntity, scanProject, validateProject } from "../src/story.js";
import { runCli } from "../src/cli.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

function exemptionProject() {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title: "Exemptions", force: false });
  const root = created.root;

  writeMarkdown(path.join(root, "characters", "edran-vale.md"), `
name: Edran Vale
role: supporting
status: deceased
died-in: chapter-01
`, "# Edran\n");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: Chapter 1
number: 1
characters:
  - edran-vale
status: draft
word-count: 0
`, "## Chapter Text\n\nWords here.\n");
  writeMarkdown(path.join(root, "chapters", "chapter-02.md"), `
title: Chapter 2
number: 2
characters:
  - edran-vale
status: draft
word-count: 0
`, "## Chapter Text\n\nMore words here.\n");

  const statePath = path.join(root, "continuity", "state.md");
  fs.writeFileSync(statePath, fs.readFileSync(statePath, "utf8").replace("current-chapter: 0", "current-chapter: 2"), "utf8");
  return { root, cwd };
}

function writeExemptions(root, entries) {
  const lines = ["type: exemption-log", "story: exemptions", "exemptions:"];
  for (const entry of entries) {
    lines.push(`  - pattern: "${entry.pattern}"`, `    reason: "${entry.reason}"`);
  }
  writeMarkdown(path.join(root, "continuity", "exemptions.md"), `\n${lines.join("\n")}\n`, "# Exemptions\n");
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function newProject(title = "Bugs") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function editFile(file, edit) {
  fs.writeFileSync(file, edit(fs.readFileSync(file, "utf8")), "utf8");
}

function posthumousProject() {
  const root = newProject();
  for (const name of ["Ann", "Joann"]) {
    createEntity(root, { kind: "character", name });
  }
  // An outline died-in is planned, not in force, so the death chapter is drafted
  // before a later cast can be posthumous.
  for (const number of [1, 2, 3]) {
    createEntity(root, { kind: "chapter", name: `C${number}`, number, status: "draft" });
  }
  for (const id of ["ann", "joann"]) {
    editFile(path.join(root, "characters", `${id}.md`), (text) => text.replace("status: alive", "status: deceased\ndied-in: chapter-01"));
  }
  editFile(path.join(root, "chapters", "chapter-03.md"), (text) => text.replace("characters: []", "characters:\n  - ann\n  - joann"));
  return root;
}

function writeExemptionLog(root, entries) {
  writeMarkdown(path.join(root, "continuity", "exemptions.md"), `type: exemption-log\nexemptions:\n${entries}`);
}

function initProject() {
  const cwd = makeTempDir();
  expect(invoke(cwd, ["init", "Safety", "--dir", "p"]).code).toBe(0);
  return path.join(cwd, "p");
}

describe("continuity exemptions", () => {
  test("dismisses matching errors and keeps ok true when nothing remains", () => {
    const { root } = exemptionProject();
    const before = checkContinuity(scanProject(root));
    expect(before.ok).toBe(false);
    expect(before.errors).toHaveLength(1);

    writeExemptions(root, [{ pattern: "edran-vale", reason: "Flashback approved by editor" }]);
    const after = checkContinuity(scanProject(root));
    expect(after.ok).toBe(true);
    expect(messages(after.errors)).toEqual([]);
    expect(after.dismissed).toEqual([
      { finding: before.errors[0], reason: "Flashback approved by editor", index: 0 }
    ]);
  });

  test("dismisses warnings by substring match", () => {
    const { root } = exemptionProject();
    for (const number of [3, 4]) {
      writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 0
`, "## Chapter Text\n\nWords here.\n");
    }
    const statePath = path.join(root, "continuity", "state.md");
    fs.writeFileSync(statePath, fs.readFileSync(statePath, "utf8").replace("current-chapter: 2", "current-chapter: 4"), "utf8");
    writeMarkdown(path.join(root, "continuity", "promises", "late-promise.md"), `
title: Late Promise
status: planted
planted: chapter-01
`, "# Late\n");
    const before = checkContinuity(scanProject(root));
    expect(before.warnings.length).toBeGreaterThan(0);

    writeExemptions(root, [{ pattern: "no payoff yet", reason: "Payoff lands in the sequel" }]);
    const after = checkContinuity(scanProject(root));
    expect(messages(after.warnings)).toEqual([]);
    expect(after.dismissed).toHaveLength(before.warnings.length);
    for (const entry of after.dismissed) {
      expect(entry.reason).toBe("Payoff lands in the sequel");
    }
  });

  test("keeps non-matching findings and reports ok false", () => {
    const { root } = exemptionProject();
    writeExemptions(root, [{ pattern: "something-else-entirely", reason: "Not applicable" }]);
    const result = checkContinuity(scanProject(root));
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.dismissed).toEqual([]);
  });

  test("whitespace-only exemption patterns cannot dismiss findings", () => {
    const { root } = exemptionProject();
    const before = checkContinuity(scanProject(root));
    expect(before.ok).toBe(false);

    writeExemptions(root, [{ pattern: "   ", reason: "Blanket exemption" }]);
    const after = checkContinuity(scanProject(root));
    expect(after.ok).toBe(false);
    expect(messages(after.errors)).toEqual(messages(before.errors));
    expect(after.dismissed).toEqual([]);
  });

  test("validate rejects blanket exemption patterns shorter than 4 characters", () => {
    const { root } = exemptionProject();
    writeExemptions(root, [{ pattern: "ch", reason: "Too generic" }]);
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain("continuity/exemptions.md exemptions[0] pattern must be at least 4 characters to avoid blanket exemptions");

    writeExemptions(root, [{ pattern: "edran", reason: "Specific enough" }]);
    expect(messages(validateProject(root).errors)).toEqual([]);
  });

  test("cli exits 0 when only dismissed errors remain and prints dismissed lines", () => {
    const { root, cwd } = exemptionProject();
    writeExemptions(root, [{ pattern: "edran-vale", reason: "Flashback approved by editor" }]);
    const result = invoke(cwd, ["continuity", root]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("Continuity is consistent: 0 errors, 0 warnings, 1 dismissed");
    expect(result.err).toContain("dismissed: ");
    expect(result.err).toContain("(exemption: Flashback approved by editor)");
  });

  test("cli still fails when an error is not dismissed", () => {
    const { root, cwd } = exemptionProject();
    writeExemptions(root, [{ pattern: "something-else-entirely", reason: "Not applicable" }]);
    const result = invoke(cwd, ["continuity", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Continuity check failed: 1 errors, 0 warnings, 0 dismissed");
  });

  test("cli ignores sub-minimum exemption patterns at runtime", () => {
    const { root, cwd } = exemptionProject();
    writeExemptions(root, [{ pattern: "ed", reason: "Too short to take effect" }]);
    const result = invoke(cwd, ["continuity", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Continuity check failed: 1 errors, 0 warnings, 0 dismissed");
    expect(result.err).not.toContain("dismissed: ");
    expect(messages(validateProject(root).errors).join("\n")).toContain("at least 4 characters");
  });

  test("cli prints dismissed lines to stderr even when errors remain", () => {
    const { root, cwd } = exemptionProject();
    for (const number of [3, 4]) {
      writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 0
`, "## Chapter Text\n\nWords here.\n");
    }
    const statePath = path.join(root, "continuity", "state.md");
    fs.writeFileSync(statePath, fs.readFileSync(statePath, "utf8").replace("current-chapter: 2", "current-chapter: 4"), "utf8");
    writeMarkdown(path.join(root, "continuity", "promises", "late-promise.md"), `
title: Late Promise
status: planted
planted: chapter-01
`, "# Late\n");

    const before = checkContinuity(scanProject(root));
    expect(before.errors).toHaveLength(1);
    expect(before.warnings.length).toBeGreaterThan(0);

    writeExemptions(root, [{ pattern: "no payoff yet", reason: "Payoff lands in the sequel" }]);
    const result = invoke(cwd, ["continuity", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Continuity check failed: 1 errors, 0 warnings, 1 dismissed");
    expect(result.err).toContain("dismissed: ");
    expect(result.err).toContain("(exemption: Payoff lands in the sequel)");
  });

  test("missing exemptions file changes nothing", () => {
    const { root } = exemptionProject();
    const result = checkContinuity(scanProject(root));
    expect(result.dismissed).toEqual([]);
    expect(result.ok).toBe(false);
  });

  test("malformed exemptions file is ignored by continuity", () => {
    const { root } = exemptionProject();
    fs.writeFileSync(path.join(root, "continuity", "exemptions.md"), "not: [valid\n", "utf8");
    const result = checkContinuity(scanProject(root));
    expect(result.ok).toBe(false);
    expect(result.dismissed).toEqual([]);
  });

  test("validate rejects invalid exemption logs", () => {
    const { root } = exemptionProject();

    writeMarkdown(path.join(root, "continuity", "exemptions.md"), `
type: wrong-type
exemptions:
  - pattern: "x"
    reason: "y"
`, "# Bad\n");
    expect(messages(validateProject(root).errors)).toContain("continuity/exemptions.md type must be exemption-log");

    writeMarkdown(path.join(root, "continuity", "exemptions.md"), `
type: exemption-log
`, "# Bad\n");
    expect(messages(validateProject(root).errors)).toContain("continuity/exemptions.md is missing frontmatter field exemptions");

    writeMarkdown(path.join(root, "continuity", "exemptions.md"), `
type: exemption-log
exemptions: nope
`, "# Bad\n");
    expect(messages(validateProject(root).errors)).toContain("continuity/exemptions.md frontmatter field exemptions must be a list");

    writeMarkdown(path.join(root, "continuity", "exemptions.md"), `
type: exemption-log
exemptions:
  - pattern: ""
    reason: ""
  - just-a-string
`, "# Bad\n");
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain("continuity/exemptions.md exemptions[0] is missing a non-empty pattern");
    expect(errors).toContain("continuity/exemptions.md exemptions[0] is missing a non-empty reason");
    expect(errors).toContain("continuity/exemptions.md exemptions[1] must be a mapping");
  });

  test("validate rejects entries with a missing pattern or a missing reason", () => {
    const { root } = exemptionProject();
    writeMarkdown(path.join(root, "continuity", "exemptions.md"), `
type: exemption-log
exemptions:
  - reason: "Has a reason but no pattern"
  - pattern: "has-a-pattern-but-no-reason"
`, "# Bad\n");
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain("continuity/exemptions.md exemptions[0] sets none of pattern, code, file, chapter: set at least one to say which findings it dismisses");
    expect(errors).toContain("continuity/exemptions.md exemptions[1] is missing a non-empty reason");
  });

  test("validate accepts a well-formed exemption log", () => {
    const { root } = exemptionProject();
    writeExemptions(root, [{ pattern: "edran-vale", reason: "Flashback approved by editor" }]);
    const result = validateProject(root);
    expect(messages(result.errors)).toEqual([]);
  });

  test("validate passes when no exemption log exists", () => {
    const { root } = exemptionProject();
    const result = validateProject(root);
    expect(messages(result.errors)).toEqual([]);
  });

  test("validate reports unreadable exemption logs without crashing", () => {
    const { root } = exemptionProject();
    fs.writeFileSync(path.join(root, "continuity", "exemptions.md"), "not: [valid\n", "utf8");
    const result = validateProject(root);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(messages(result.errors)[0]).toContain("continuity/exemptions.md");
  });
});

describe("#162 exemptions", () => {
  test("a leading space in a pattern is kept as a word boundary", () => {
    const root = posthumousProject();
    writeExemptionLog(root, '  - pattern: " ann, who died in chapter-01"\n    reason: "Ann is a ghost"');
    const result = checkProjectContinuity(root);
    expect(result.dismissed.map((entry) => entry.finding.message)).toEqual([expect.stringContaining("lists ann, who died")]);
    expect(messages(result.errors)).toContain("chapters/chapter-03.md lists joann, who died in chapter-01; move posthumous appearances to mentions");
  });

  test("an entry without a reason dismisses nothing", () => {
    const root = posthumousProject();
    writeExemptionLog(root, '  - pattern: "chapter-03.md lists ann"');
    expect(checkProjectContinuity(root).dismissed).toEqual([]);
    expect(messages(validateProject(root).errors)).toContain("continuity/exemptions.md exemptions[0] is missing a non-empty reason");
  });

  test("a refused exemptions file or state file is named by its project path", () => {
    const root = posthumousProject();
    fs.mkdirSync(path.join(root, "continuity", "exemptions.md"));
    const result = checkProjectContinuity(root);
    const refusal = messages(result.errors).find((error) => error.startsWith("continuity/exemptions.md:"));
    expect(refusal).toBe("continuity/exemptions.md: Refusing to read: not a regular file");

    const statePath = path.join(root, "continuity", "state.md");
    const outside = path.join(makeTempDir(), "state.md");
    fs.renameSync(statePath, outside);
    fs.symlinkSync(outside, statePath);
    const errors = messages(validateProject(root).errors).join("\n");
    expect(errors).toContain("continuity/state.md");
    expect(errors).not.toContain(root);
  });
});

describe("exemption patterns follow rename and move (#104)", () => {
  test("a renumbered chapter keeps its dismissal, and a renamed character's id follows", () => {
    const root = initProject();
    createEntity(root, { kind: "character", name: "Ann" });
    createEntity(root, { kind: "character", name: "Bo" });
    createEntity(root, { kind: "chapter", name: "One", pov: "ann" });
    createEntity(root, { kind: "scene", name: "S", pov: "bo" });
    createEntity(root, { kind: "chapter", name: "Two", pov: "ann", mention: "bo" });
    createEntity(root, { kind: "scene", name: "T", chapter: "chapter-02", character: "bo" });
    const exemptions = path.join(root, "continuity", "exemptions.md");
    fs.writeFileSync(exemptions, "---\ntype: exemption-log\nstory: safety\nexemptions:\n  - pattern: \"chapters/chapter-01.md has POV ann\"\n    reason: \"Bo narrates the prologue on purpose\"\n---\n");
    expect(invoke(root, ["continuity"]).err).toContain("dismissed: chapters/chapter-01.md has POV ann");

    moveEntity(root, { kind: "chapter", id: "chapter-02", number: 3 });
    moveEntity(root, { kind: "chapter", id: "chapter-01", number: 2 });
    moveEntity(root, { kind: "chapter", id: "chapter-03", number: 1 });
    let continuity = invoke(root, ["continuity"]);
    expect(continuity.err).toContain("dismissed: chapters/chapter-02.md has POV ann");
    expect(continuity.err).not.toContain("warning:");

    renameEntity(root, { kind: "character", id: "ann", name: "Anna" });
    expect(fs.readFileSync(exemptions, "utf8")).toContain("chapters/chapter-02.md has POV anna");
    expect(fs.readFileSync(exemptions, "utf8")).toContain("Bo narrates the prologue on purpose");
    continuity = invoke(root, ["continuity"]);
    expect(continuity.err).toContain("dismissed: chapters/chapter-02.md has POV anna");
    expect(continuity.err).not.toContain("warning:");
  });

  test("a moved scene's id follows in patterns", () => {
    const root = initProject();
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "chapter", name: "Two" });
    createEntity(root, { kind: "scene", name: "S", chapter: "chapter-01" });
    const exemptions = path.join(root, "continuity", "exemptions.md");
    fs.writeFileSync(exemptions, "---\ntype: exemption-log\nstory: safety\nexemptions:\n  - pattern: \"scenes/chapter-01-scene-01.md is fine\"\n    reason: \"Checked\"\n---\n");
    moveEntity(root, { kind: "scene", id: "chapter-01-scene-01", chapter: "chapter-02" });
    expect(fs.readFileSync(exemptions, "utf8")).toContain("scenes/chapter-02-scene-01.md is fine");
  });
});

describe("exemption files rename cannot follow", () => {
  function projectWithExemptions(text) {
    const root = initProject();
    createEntity(root, { kind: "character", name: "Ann" });
    fs.writeFileSync(path.join(root, "continuity", "exemptions.md"), text);
    return root;
  }

  test("an exemptions file without a list is left alone", () => {
    const text = "---\ntype: exemption-log\nexemptions: none\n---\n";
    const root = projectWithExemptions(text);
    renameEntity(root, { kind: "character", id: "ann", name: "Anna" });
    expect(fs.readFileSync(path.join(root, "continuity", "exemptions.md"), "utf8")).toBe(text);
  });

  test("entries that are not mappings are kept as they are", () => {
    const root = projectWithExemptions("---\ntype: exemption-log\nstory: safety\nexemptions:\n  - loose note\n  - pattern: \"POV ann here\"\n    reason: \"Fine\"\n---\n");
    renameEntity(root, { kind: "character", id: "ann", name: "Anna" });
    const text = fs.readFileSync(path.join(root, "continuity", "exemptions.md"), "utf8");
    expect(text).toContain("loose note");
    expect(text).toContain("POV anna here");
  });
});

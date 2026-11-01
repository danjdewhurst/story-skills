import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { UNDO_LOG } from "../src/files.js";
import { LOCK_FILE } from "../src/lock.js";
import { EXIT_CODES } from "../src/exit-codes.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, treeSnapshot } from "./helpers.js";

const RESULT_SCHEMA = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

const examples = path.join(import.meta.dir, "..", "examples");

// A copy of an example book, which story impact may only read.
function exampleCopy(name) {
  const root = path.join(makeTempDir(), name);
  fs.cpSync(path.join(examples, name), root, { recursive: true });
  return root;
}

function invoke(root, argv) {
  const io = memoryIo(root);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// A --json run: one envelope that matches the result schema, ok exactly
// when the exit code is 0, and nothing on stderr.
function invokeJson(root, argv) {
  const result = invoke(root, [...argv, "--json"]);
  expect(result.err).toBe("");
  const envelope = JSON.parse(result.out);
  expect(validateAgainstSchema(envelope, RESULT_SCHEMA)).toEqual([]);
  expect(envelope.ok).toBe(result.code === EXIT_CODES.ok);
  return { code: result.code, envelope };
}

function setFrontmatter(file, key, value) {
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`), "utf8");
}

describe("story impact", () => {
  test("die lists the posthumous appearances the death adds, exits 1, and writes nothing", () => {
    const root = exampleCopy("bo-and-the-missing-moon");
    const before = treeSnapshot(root);
    const result = invoke(root, ["impact", "die", "old-pike", "chapter-02"]);
    expect(result.code).toBe(EXIT_CODES.findings);
    expect(result.err).toBe("");
    expect(result.out).toContain("Impact of die old-pike chapter-02 (tested on a copy; nothing was written)");
    expect(result.out).toContain("  update  characters/old-pike.md\n");
    expect(result.out).toContain("  error: [continuity] chapters/chapter-06.md lists old-pike, who died in chapter-02; move posthumous appearances to mentions\n");
    expect(result.out).toContain("Adds 4 errors; clears nothing. Before: 0 errors, 0 warnings. After: 4 errors, 0 warnings\n");
    expect(treeSnapshot(root)).toEqual(before);
  });

  test("a change that adds nothing exits 0 and lists what it clears", () => {
    const root = exampleCopy("the-unraveled-thread");
    const result = invoke(root, ["impact", "remove", "character", "edran-vale"]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.out).toContain("Clears:\n  error: [continuity] chapters/chapter-04.md lists edran-vale, who died in chapter-02; move posthumous appearances to mentions\n");
    expect(result.out).not.toContain("Adds:\n");
    expect(result.out).toContain("Adds nothing; clears 1 error.");
    expect(fs.existsSync(path.join(root, "characters", "edran-vale.md"))).toBe(true);
  });

  test("--strict fails on the warnings the change adds", () => {
    const root = exampleCopy("the-fall-of-the-citadel");
    const plain = invoke(root, ["impact", "die", "lord-maren", "chapter-01"]);
    expect(plain.code).toBe(EXIT_CODES.ok);
    expect(plain.out).toContain("  warning: [continuity] continuity/state.md character-state[1] tracks lord-maren, who died in chapter-01; remove the entry once they are dead [state-tracks-dead-character]\n");
    expect(invoke(root, ["impact", "die", "lord-maren", "chapter-01", "--strict"]).code).toBe(EXIT_CODES.findings);
    const { envelope: json } = invokeJson(root, ["impact", "die", "lord-maren", "chapter-01", "--strict"]);
    expect(json).toMatchObject({ ok: false, data: { strict: true, added: { errors: 0, warnings: 1 } } });
    expect(json.diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "state-tracks-dead-character", check: "continuity" })]);
  });

  test("--json gives the changes, the counts, the cleared findings, and the added ones as diagnostics", () => {
    const root = exampleCopy("bo-and-the-missing-moon");
    const { code, envelope } = invokeJson(root, ["impact", "die", "old-pike", "chapter-02"]);
    expect(code).toBe(EXIT_CODES.findings);
    expect(envelope).toMatchObject({ command: "impact", ok: false, writes: [] });
    expect(envelope.data).toMatchObject({
      change: "die",
      args: ["old-pike", "chapter-02"],
      result: { kind: "character", id: "old-pike", chapter: "chapter-02", file: "characters/old-pike.md" },
      strict: false,
      added: { errors: 4, warnings: 0 },
      cleared: [],
      before: { errors: 0, warnings: 0, dismissed: 0 },
      after: { errors: 4, warnings: 0, dismissed: 0 }
    });
    expect(envelope.data.changes).toEqual([{ action: "update", path: "characters/_index.md" }, { action: "update", path: "characters/old-pike.md" }]);
    expect(envelope.diagnostics).toHaveLength(4);
    expect(envelope.diagnostics[0]).toEqual({
      severity: "error",
      file: "chapters/chapter-06.md",
      chapter: "chapter-06",
      message: "chapters/chapter-06.md lists old-pike, who died in chapter-02; move posthumous appearances to mentions",
      code: "posthumous-appearance",
      check: "continuity"
    });

    const { envelope: cleared } = invokeJson(exampleCopy("the-unraveled-thread"), ["impact", "remove", "character", "edran-vale"]);
    expect(cleared.ok).toBe(true);
    expect(cleared.data.cleared).toEqual([expect.objectContaining({ severity: "error", code: "posthumous-appearance", check: "continuity", file: "chapters/chapter-04.md" })]);

    const { envelope: warning } = invokeJson(exampleCopy("the-unraveled-thread"), ["impact", "remove", "promise", "the-sealed-letter"]);
    expect(warning.data.cleared).toEqual([expect.objectContaining({ severity: "warning", code: "promise-unpaid", check: "continuity" })]);
  });

  test("it reads the change's arguments and flags as the command does, and refuses what it refuses", () => {
    const root = exampleCopy("bo-and-the-missing-moon");
    const before = treeSnapshot(root);
    const cases = [
      ["move", "chapter", "chapter-02", "--number", "3"],
      ["move", "chapter", "chapter-99", "--number", "30"],
      ["remove", "character", "nobody"],
      ["split", "chapter-02"],
      ["merge", "chapter-02"]
    ];
    for (const argv of cases) {
      const command = invoke(root, [...argv, "--dry-run"]);
      const impact = invoke(root, ["impact", ...argv]);
      expect({ argv, code: impact.code, err: impact.err }).toEqual({ argv, code: command.code, err: command.err });
      expect(impact.code).not.toBe(EXIT_CODES.ok);
    }
    expect(treeSnapshot(root)).toEqual(before);
  });

  test("a flag or argument the change does not read is a usage error, as is an unknown change", () => {
    const root = exampleCopy("bo-and-the-missing-moon");
    const cases = [
      [["impact"], "impact requires a change to test"],
      [["impact", "add", "character", "Tobin"], "story impact cannot test add: it tests rename, remove, move, split, merge, or die"],
      [["impact", "move", "chapter", "chapter-02", "--number", "30", "--at", "1"], "--at does not apply to story impact move"],
      [["impact", "remove", "character", "bo", "--dry-run"], "--dry-run does not apply to story impact"],
      [["impact", "remove", "character", "bo", "extra"], "Unexpected argument for story impact remove <kind> <id>: extra"],
      [["impact", "die"], "impact die requires a character id and a chapter id"],
      [["impact", "die", "old-pike"], "impact die requires a chapter id"],
      [["impact", "die", "nobody", "chapter-02"], "character nobody does not exist"],
      [["impact", "die", "old-pike", "chapter-99"], "chapter chapter-99 does not exist"]
    ];
    for (const [argv, message] of cases) {
      const result = invoke(root, argv);
      expect({ argv, code: result.code }).toEqual({ argv, code: EXIT_CODES.usage });
      expect(result.err).toContain(message);
    }
  });

  test("the flags impact reads are its own and every flag of the changes it tests", () => {
    const impact = COMMANDS.find((command) => command.name === "impact");
    const tested = ["rename", "remove", "move", "split", "merge"].flatMap((name) => COMMANDS.find((command) => command.name === name).options);
    const expected = new Set(["strict", "json", ...tested.filter((name) => name !== "dry-run")]);
    expect([...impact.options].sort()).toEqual([...expected].sort());
  });

  test("it neither takes nor waits for the project lock, and leaves no undo log", () => {
    const root = exampleCopy("bo-and-the-missing-moon");
    const lock = `${process.pid}\nhost\n`;
    fs.writeFileSync(path.join(root, LOCK_FILE), lock);
    const saved = process.env.STORY_LOCK_WAIT_MS;
    process.env.STORY_LOCK_WAIT_MS = "0";
    try {
      const result = invoke(root, ["impact", "merge", "chapter-01", "chapter-02"]);
      expect(result.err).toBe("");
      expect(result.code).toBe(EXIT_CODES.ok);
    } finally {
      if (saved === undefined) {
        delete process.env.STORY_LOCK_WAIT_MS;
      } else {
        process.env.STORY_LOCK_WAIT_MS = saved;
      }
    }
    expect(fs.readFileSync(path.join(root, LOCK_FILE), "utf8")).toBe(lock);
    expect(fs.existsSync(path.join(root, UNDO_LOG))).toBe(false);
  });

  test("it refuses while a change stopped part way is in the project", () => {
    const root = exampleCopy("bo-and-the-missing-moon");
    fs.writeFileSync(path.join(root, UNDO_LOG), `${JSON.stringify({ command: "story split chapter-02 --at 1" })}\n`);
    const result = invoke(root, ["impact", "die", "old-pike", "chapter-02"]);
    expect(result.code).toBe(EXIT_CODES.refused);
    expect(result.err).toContain("so story impact would build on a change made only in part; nothing was changed");
  });

  test("die in an outline chapter keeps the status and warns that the death is planned", () => {
    const root = exampleCopy("bo-and-the-missing-moon");
    setFrontmatter(path.join(root, "chapters", "chapter-05.md"), "status", "outline");
    const { envelope } = invokeJson(root, ["impact", "die", "old-pike", "chapter-05"]);
    expect(envelope.diagnostics).toContainEqual(expect.objectContaining({ severity: "warning", code: "planned-death", check: "die", file: "chapters/chapter-05.md" }));
    expect(envelope.diagnostics.filter((entry) => entry.code === "posthumous-appearance")).toEqual([]);
    expect(envelope.data.changes).toContainEqual({ action: "update", path: "characters/old-pike.md" });
    expect(fs.readFileSync(path.join(root, "characters", "old-pike.md"), "utf8")).not.toContain("died-in: chapter-05");

    const text = invoke(root, ["impact", "die", "old-pike", "chapter-05"]);
    expect(text.code).toBe(EXIT_CODES.ok);
    expect(text.out).toContain("The change warns:\n  warning: chapters/chapter-05.md is an outline chapter, so continuity treats a death there as planned and checks no later cast against it until the chapter is drafted [planned-death]\n");
    // --strict fails on the change's own warnings, as on those it adds.
    expect(invoke(root, ["impact", "die", "old-pike", "chapter-05", "--strict"]).code).toBe(EXIT_CODES.findings);

    // A story.md severity entry that promotes the change's own warning fails
    // the run, as it fails the command the change comes from.
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^---\n/, "---\nseverity:\n  - warning: planned-death\n    level: error\n"), "utf8");
    const promoted = invoke(root, ["impact", "die", "old-pike", "chapter-05"]);
    expect(promoted.code).toBe(EXIT_CODES.findings);
    expect(promoted.out).toContain("The change warns:\n  error: chapters/chapter-05.md is an outline chapter");
  });

  test("a finding the change only gives new ids is carried over, not added and cleared", () => {
    // The Unraveled Thread lists edran-vale in chapter 4 after his death in
    // chapter 2: a rename keeps that error under the new id.
    const renamed = invokeJson(exampleCopy("the-unraveled-thread"), ["impact", "rename", "character", "edran-vale", "Edran", "Valemont"]);
    expect(renamed.code).toBe(EXIT_CODES.ok);
    expect(renamed.envelope.data).toMatchObject({ added: { errors: 0, warnings: 0 }, cleared: [] });
    expect(renamed.envelope.data.carried).toEqual([expect.objectContaining({ code: "posthumous-appearance", message: "chapters/chapter-04.md lists edran-valemont, who died in chapter-02; move posthumous appearances to mentions" })]);

    // A merge renumbers chapter 4 to 3, so the same error names chapter 3.
    const root = exampleCopy("the-unraveled-thread");
    const merged = invoke(root, ["impact", "merge", "chapter-01", "chapter-02"]);
    expect(merged.code).toBe(EXIT_CODES.ok);
    expect(merged.out).not.toContain("Adds:\n");
    expect(merged.out).toContain("carries over 3 errors and 1 warning under new ids");

    // Another character in the same cast after death is a new error: same
    // code and file, another message.
    const second = invokeJson(root, ["impact", "die", "jonas-reed", "chapter-02"]);
    expect(second.envelope.diagnostics.filter((entry) => entry.file === "chapters/chapter-04.md" && entry.code === "posthumous-appearance").map((entry) => entry.message)).toEqual(["chapters/chapter-04.md lists jonas-reed, who died in chapter-02; move posthumous appearances to mentions"]);
  });

  test("findings that read the same once ids are set aside are each carried over once", () => {
    // Old Pike, dead in chapter 2, is listed in chapters 6 and 7 and their
    // scenes. Merging chapter 2 into chapter 1 renumbers all four and moves
    // the death to chapter 1, so no finding keeps its text, and the two
    // chapter errors (and the two scene errors) read the same with the
    // chapter ids set aside.
    const root = exampleCopy("bo-and-the-missing-moon");
    const pike = path.join(root, "characters", "old-pike.md");
    fs.writeFileSync(pike, fs.readFileSync(pike, "utf8").replace("status: alive\n", "status: deceased\ndied-in: chapter-02\n"), "utf8");
    const merged = invokeJson(root, ["impact", "merge", "chapter-01", "chapter-02"]);
    expect(merged.envelope.data).toMatchObject({ added: { errors: 0, warnings: 0 }, cleared: [] });
    expect(merged.envelope.data.carried.map((entry) => entry.file).sort()).toEqual(["chapters/chapter-05.md", "chapters/chapter-06.md", "scenes/chapter-05-scene-01.md", "scenes/chapter-06-scene-01.md"]);
  });

  test("the flags the change reads reach it: split --at --title, move scene --chapter, rename --id --prose", () => {
    const root = exampleCopy("bo-and-the-missing-moon");
    const before = treeSnapshot(root);
    const chapter = path.join(root, "chapters", "chapter-02.md");
    fs.appendFileSync(chapter, "\nThe moon was gone.\n\n* * *\n\nBo went looking.\n", "utf8");
    const split = invokeJson(root, ["impact", "split", "chapter-02", "--at", "1", "--title", "The Search"]);
    expect(split.envelope.data.result).toMatchObject({ id: "chapter-02", newId: "chapter-03", title: "The Search" });
    fs.writeFileSync(chapter, Buffer.from(before["chapters/chapter-02.md"], "base64"));

    const moved = invokeJson(root, ["impact", "move", "scene", "chapter-02-scene-01", "--chapter", "chapter-09"]);
    expect(moved.envelope.data.result).toMatchObject({ kind: "scene", oldId: "chapter-02-scene-01", id: "chapter-09-scene-02" });
    expect(moved.envelope.data.changes).toContainEqual({ action: "delete", path: "scenes/chapter-02-scene-01.md" });

    const renamed = invokeJson(root, ["impact", "rename", "character", "old-pike", "Pike", "--id", "the-pike", "--prose"]);
    expect(renamed.envelope.data.result).toMatchObject({ kind: "character", oldId: "old-pike", id: "the-pike" });
    expect(renamed.envelope.data.result.prose.edits.length).toBeGreaterThan(0);
    expect(treeSnapshot(root)).toEqual(before);
  });

  test("the checks read story.md severity and the exemptions as the change leaves them", () => {
    // A severity entry that promotes a check warning makes it an added error.
    const promoted = exampleCopy("the-fall-of-the-citadel");
    const story = path.join(promoted, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^---\n/, "---\nseverity:\n  - warning: state-tracks-dead-character\n    level: error\n"), "utf8");
    const result = invokeJson(promoted, ["impact", "die", "lord-maren", "chapter-01"]);
    expect(result.code).toBe(EXIT_CODES.findings);
    expect(result.envelope.data.added).toEqual({ errors: 1, warnings: 0 });

    // An exempted finding stays dismissed after a merge renumbers its
    // chapter, since merge rewrites the exemption to follow it.
    const root = exampleCopy("bo-and-the-missing-moon");
    const chapter = path.join(root, "chapters", "chapter-05.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("word-count: 24", "word-count: 99"), "utf8");
    fs.writeFileSync(path.join(root, "continuity", "exemptions.md"), "---\nexemptions:\n  - code: stale-word-count\n    file: chapters/chapter-05.md\n    reason: Counted by hand.\n---\n", "utf8");
    const merged = invokeJson(root, ["impact", "merge", "chapter-01", "chapter-02", "--strict"]);
    expect(merged.code).toBe(EXIT_CODES.ok);
    expect(merged.envelope.data.added).toEqual({ errors: 0, warnings: 0 });
    expect(merged.envelope.data.after.dismissed).toBe(1);
  });

  test("a project path among the new name's words is refused with the impact command named", () => {
    const root = exampleCopy("bo-and-the-missing-moon");
    const result = invoke(root, ["impact", "rename", "character", "old-pike", "Pike", "."]);
    expect(result.code).toBe(EXIT_CODES.usage);
    expect(result.err).toContain('"." looks like a project path: story impact rename takes the project as --path .');
  });

  test("die after a revival is a second death; at or before it, the first death moves", () => {
    const root = exampleCopy("bo-and-the-missing-moon");
    const pike = path.join(root, "characters", "old-pike.md");
    fs.writeFileSync(pike, fs.readFileSync(pike, "utf8").replace("status: alive\n", "status: alive\ndied-in: chapter-02\nrevived-in: chapter-04\n"), "utf8");
    const second = invokeJson(root, ["impact", "die", "old-pike", "chapter-05"]);
    expect(second.envelope.data.added).toEqual({ errors: 0, warnings: 4 });
    expect(second.envelope.diagnostics.map((entry) => entry.code)).toEqual(Array(4).fill("progression-deceased-in-cast"));
    const moved = invokeJson(root, ["impact", "die", "old-pike", "chapter-03"]);
    expect(moved.envelope.data.added).toEqual({ errors: 0, warnings: 0 });
    expect(moved.envelope.data.changes).toContainEqual({ action: "update", path: "characters/old-pike.md" });
  });

  test("the header names the flags of the change, so two options can be told apart", () => {
    const root = exampleCopy("bo-and-the-missing-moon");
    for (const chapter of ["chapter-05", "chapter-09"]) {
      expect(invoke(root, ["impact", "move", "scene", "chapter-02-scene-01", "--chapter", chapter]).out).toStartWith(`Impact of move scene chapter-02-scene-01 --chapter ${chapter} (tested on a copy; nothing was written)\n`);
    }
  });

  test("die of a character already dead in that chapter changes nothing", () => {
    const root = exampleCopy("the-unraveled-thread");
    const result = invoke(root, ["impact", "die", "edran-vale", "chapter-02"]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.out).toContain("The change would make no changes\n");
    expect(result.out).toContain("Adds nothing; clears nothing.");
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { UNDO_LOG } from "../src/files.js";
import { LOCK_FILE } from "../src/lock.js";
import { EXIT_CODES } from "../src/exit-codes.js";
import { makeTempDir, memoryIo, treeSnapshot } from "./helpers.js";

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
    const json = JSON.parse(invoke(root, ["impact", "die", "lord-maren", "chapter-01", "--strict", "--json"]).out);
    expect(json).toMatchObject({ ok: false, data: { strict: true, added: { errors: 0, warnings: 1 } } });
    expect(json.diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "state-tracks-dead-character", check: "continuity" })]);
  });

  test("--json gives the changes, the counts, the cleared findings, and the added ones as diagnostics", () => {
    const root = exampleCopy("bo-and-the-missing-moon");
    const result = invoke(root, ["impact", "die", "old-pike", "chapter-02", "--json"]);
    expect(result.code).toBe(EXIT_CODES.findings);
    expect(result.err).toBe("");
    const envelope = JSON.parse(result.out);
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

    const cleared = JSON.parse(invoke(exampleCopy("the-unraveled-thread"), ["impact", "remove", "character", "edran-vale", "--json"]).out);
    expect(cleared.ok).toBe(true);
    expect(cleared.data.cleared).toEqual([expect.objectContaining({ severity: "error", code: "posthumous-appearance", check: "continuity", file: "chapters/chapter-04.md" })]);

    const warning = JSON.parse(invoke(exampleCopy("the-unraveled-thread"), ["impact", "remove", "promise", "the-sealed-letter", "--json"]).out);
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
    const result = invoke(root, ["impact", "die", "old-pike", "chapter-05", "--json"]);
    const envelope = JSON.parse(result.out);
    expect(envelope.diagnostics).toContainEqual(expect.objectContaining({ severity: "warning", code: "planned-death", check: "die", file: "chapters/chapter-05.md" }));
    expect(envelope.diagnostics.filter((entry) => entry.code === "posthumous-appearance")).toEqual([]);
    expect(envelope.data.changes).toContainEqual({ action: "update", path: "characters/old-pike.md" });
    expect(fs.readFileSync(path.join(root, "characters", "old-pike.md"), "utf8")).not.toContain("died-in: chapter-05");

    const text = invoke(root, ["impact", "die", "old-pike", "chapter-05"]);
    expect(text.code).toBe(EXIT_CODES.ok);
    expect(text.out).toContain("The change warns:\n  warning: chapters/chapter-05.md is an outline chapter, so continuity treats a death there as planned and checks no later cast against it until the chapter is drafted [planned-death]\n");

    // A story.md severity entry that promotes the change's own warning fails
    // the run, as it fails the command the change comes from.
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^---\n/, "---\nseverity:\n  - warning: planned-death\n    level: error\n"), "utf8");
    const promoted = invoke(root, ["impact", "die", "old-pike", "chapter-05"]);
    expect(promoted.code).toBe(EXIT_CODES.findings);
    expect(promoted.out).toContain("The change warns:\n  error: chapters/chapter-05.md is an outline chapter");
  });

  test("die of a character already dead in that chapter changes nothing", () => {
    const root = exampleCopy("the-unraveled-thread");
    const result = invoke(root, ["impact", "die", "edran-vale", "chapter-02"]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.out).toContain("The change would make no changes\n");
    expect(result.out).toContain("Adds nothing; clears nothing.");
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { TEMPORARY_FILE_PATTERN, UNDO_LOG, contentHash, removeFile, withUndoLog, writeFile } from "../src/files.js";
import { interruptedChange, undoInterruptedChange } from "../src/undo.js";
import { createEntity, createStoryProject, mergeChapters, moveEntity, removeEntity, renameEntity, splitChapter, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// Every file under `root` with its text, hidden files included.
function snapshot(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files[path.relative(root, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(root);
  return files;
}

function copy(root) {
  const target = path.join(makeTempDir(), path.basename(root));
  fs.cpSync(root, target, { recursive: true });
  return target;
}

function setProse(root, id, text) {
  const file = path.join(root, "chapters", `${id}.md`);
  const markdown = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, `${markdown.slice(0, markdown.indexOf("## Chapter Text"))}## Chapter Text\n\n${text}`, "utf8");
}

// Three chapters with a character in each, two scenes in chapter 2 with a
// scene break between their text, and a clue planted in chapter 2 and paid
// off in chapter 3, so each command changes several files.
function book() {
  const root = createStoryProject({ cwd: makeTempDir(), title: "Undo Book" }).root;
  createEntity(root, { kind: "character", name: "Mara Quill" });
  for (const name of ["One", "Two", "Three"]) {
    createEntity(root, { kind: "chapter", name, status: "draft", characters: ["mara-quill"] });
  }
  setProse(root, "chapter-01", "Mara woke.\n");
  setProse(root, "chapter-02", "Mara walked to the quay.\n\n* * *\n\nThe boat was late.\n");
  setProse(root, "chapter-03", "The ferry crossed.\n");
  createEntity(root, { kind: "scene", name: "The Quay", chapter: "chapter-02", characters: ["mara-quill"] });
  createEntity(root, { kind: "scene", name: "The Boat", chapter: "chapter-02", characters: ["mara-quill"] });
  createEntity(root, { kind: "clue", name: "The Ticket", planted: "chapter-02", payoff: "chapter-03", status: "paid-off", characters: ["mara-quill"] });
  expect(runCli(["wordcount", "--write", "--path", root], memoryIo(root))).toBe(0);
  return root;
}

// Each command that keeps an undo log, as the API runs it and as typed.
const COMMANDS = {
  split: { run: (root) => splitChapter(root, { id: "chapter-02", at: "1" }), argv: ["split", "chapter-02", "--at", "1"], name: "story split chapter-02" },
  merge: { run: (root) => mergeChapters(root, { id: "chapter-01", next: "chapter-02" }), argv: ["merge", "chapter-01", "chapter-02"], name: "story merge chapter-01 chapter-02" },
  move: { run: (root) => moveEntity(root, { kind: "chapter", id: "chapter-02", number: "5" }), argv: ["move", "chapter", "chapter-02", "--number", "5"], name: "story move chapter chapter-02" },
  rename: { run: (root) => renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Tide" }), argv: ["rename", "character", "mara-quill", "Mara Tide"], name: "story rename character mara-quill" },
  remove: { run: (root) => removeEntity(root, { kind: "character", id: "mara-quill" }), argv: ["remove", "character", "mara-quill"], name: "story remove character mara-quill" }
};

// Runs `run` and stops it, as a kill would, at its `at`th change to a file
// in `root`: a rename into place or a delete. Returns how many changes it
// reached; with `at` 0 it runs to the end. Every change must find its line
// in the undo log on disk already, naming the file and what it is about to
// hold.
function stoppedAt(root, at, run) {
  const { renameSync, rmSync } = fs;
  const log = path.join(root, UNDO_LOG);
  let count = 0;
  const change = (file, after) => {
    const name = path.basename(String(file));
    if (!String(file).startsWith(root) || name === UNDO_LOG || TEMPORARY_FILE_PATTERN.test(name)) {
      return;
    }
    const last = JSON.parse(fs.readFileSync(log, "utf8").trimEnd().split("\n").at(-1));
    expect(last).toMatchObject({ path: path.relative(root, String(file)).split(path.sep).join("/"), after });
    count += 1;
    if (count === at) {
      throw new Error("killed");
    }
  };
  fs.renameSync = (from, to) => {
    change(to, contentHash(fs.readFileSync(from)));
    return renameSync(from, to);
  };
  fs.rmSync = (file, options) => {
    if (fs.existsSync(file)) {
      change(file, null);
    }
    return rmSync(file, options);
  };
  try {
    run();
  } catch (error) {
    if (!error.message.endsWith("killed")) {
      throw error;
    }
  } finally {
    fs.renameSync = renameSync;
    fs.rmSync = rmSync;
  }
  return count;
}

describe("undo logs (#604)", () => {
  for (const [command, { run, name }] of Object.entries(COMMANDS)) {
    // Split and merge, several steps each, are stopped at every change; the
    // others at the first, the second, a middle, and the last.
    test(`${command} stopped at any change is put back whole`, () => {
      const fixture = book();
      const original = snapshot(fixture);
      const clean = copy(fixture);
      const total = stoppedAt(clean, 0, () => run(clean));
      expect(total).toBeGreaterThan(2);
      expect(fs.existsSync(path.join(clean, UNDO_LOG))).toBe(false);
      const points = command === "split" || command === "merge" ? Array.from({ length: total }, (_, index) => index + 1) : [1, 2, Math.ceil(total / 2), total];
      for (const at of points) {
        const root = copy(fixture);
        stoppedAt(root, at, () => run(root));
        // Stopped at its first change, nothing was changed and no log is
        // left.
        if (at > 1) {
          expect(interruptedChange(root)).toEqual({ command: name });
          expect(undoInterruptedChange(root).command).toBe(name);
        }
        expect(snapshot(root)).toEqual(original);
      }
    });
  }

  test("a rerun puts the change back first and says so, and its dry run previews that", () => {
    const fixture = book();
    const clean = copy(fixture);
    expect(invoke(clean, COMMANDS.split.argv).code).toBe(0);
    const root = copy(fixture);
    stoppedAt(root, 5, () => COMMANDS.split.run(root));
    const stopped = snapshot(root);
    const files = undoInterruptedChange(copy(root)).files;

    const preview = invoke(root, [...COMMANDS.split.argv, "--dry-run"]);
    expect(preview.code).toBe(0);
    expect(preview.err).toStartWith(`note: story split chapter-02 stopped part way, so this would first put back the ${files.length} files it had changed\nwarning: `);
    expect(preview.out).toContain(`delete  ${UNDO_LOG}\n`);
    const json = invoke(root, [...COMMANDS.split.argv, "--dry-run", "--json"]);
    expect(JSON.parse(json.out).data.undone).toEqual({ command: "story split chapter-02", files });
    expect(snapshot(root)).toEqual(stopped);

    const rerun = invoke(root, COMMANDS.split.argv);
    expect(rerun.code).toBe(0);
    expect(rerun.err).toStartWith(`note: story split chapter-02 stopped part way, so this first put back the ${files.length} files it had changed\nwarning: `);
    expect(rerun.out).toStartWith("Split chapter chapter-02: the rest is chapter-03");
    expect(snapshot(root)).toEqual(snapshot(clean));
  });

  test("a command that fails after putting a change back says it put it back", () => {
    const root = book();
    const original = snapshot(root);
    stoppedAt(root, 5, () => COMMANDS.split.run(root));
    const files = undoInterruptedChange(copy(root)).files;
    expect(invoke(root, ["rename", "character", "no-such-person", "Sera"])).toEqual({
      code: 2,
      out: "",
      err: `character no-such-person does not exist. story split chapter-02 had stopped part way, so the ${files.length} files it changed were put back first\n`
    });
    expect(snapshot(root)).toEqual(original);
  });

  test("while the log is there, validate reports it, other write commands are refused, and doctor --fix puts the change back", () => {
    const root = book();
    const original = snapshot(root);
    stoppedAt(root, 4, () => COMMANDS.merge.run(root));
    expect(validateProject(root).errors.filter((finding) => finding.code === "interrupted-change")).toEqual([{
      code: "interrupted-change",
      message: `story merge chapter-01 chapter-02 stopped part way, and ${UNDO_LOG} holds what it changed: run story doctor --fix to put those files back, or run that command again, which puts them back and then makes its change`,
      file: UNDO_LOG,
      chapter: null
    }]);
    expect(invoke(root, ["check"]).code).toBe(1);

    const stopped = snapshot(root);
    const refusal = `story merge chapter-01 chapter-02 stopped part way, and ${UNDO_LOG} holds what it changed, so story reindex would build on a change made only in part; nothing was changed. Run story doctor --fix to put those files back first, or run that command again, which puts them back and then makes its change\n`;
    expect(invoke(root, ["reindex"])).toEqual({ code: 4, out: "", err: refusal });
    expect(invoke(root, ["reindex", "--dry-run"])).toEqual({ code: 4, out: "", err: refusal });
    expect(invoke(root, ["add", "character", "Ilse"]).code).toBe(4);
    // Reading commands still run.
    expect(invoke(root, ["doctor"]).out).toContain("Fix validation errors");
    expect(snapshot(root)).toEqual(stopped);

    const preview = invoke(root, ["doctor", "--fix", "--dry-run"]);
    expect(preview.out).toMatch(/^Repairs \(dry run; nothing was written\):\n- Put back an interrupted change \(interrupted-change\): \d+ changes\n/);
    expect(preview.out).toContain(`  delete  ${UNDO_LOG}\n`);
    expect(snapshot(root)).toEqual(stopped);

    const fixed = invoke(root, ["doctor", "--fix", "--json"]);
    expect(fixed.code).toBe(0);
    const { repairs, stopped: why } = JSON.parse(fixed.out).data.fix;
    expect(why).toBeNull();
    expect(repairs.map((repair) => [repair.command, repair.codes])).toEqual([["undo", ["interrupted-change"]]]);
    expect(snapshot(root)).toEqual(original);
    expect(invoke(root, ["reindex"]).code).toBe(0);
  });

  test("doctor --fix chooses its other repairs from the project the undo puts back", () => {
    const root = book();
    stoppedAt(root, 4, () => COMMANDS.merge.run(root));
    // Added by hand, so no registry lists it.
    writeMarkdown(path.join(root, "characters", "ilse.md"), "name: Ilse\nrole: supporting\nstatus: alive", "# Ilse\n");
    const fixed = invoke(root, ["doctor", "--fix", "--json"]);
    expect(JSON.parse(fixed.out).data.fix.repairs.map((repair) => [repair.command, repair.codes])).toEqual([["undo", ["interrupted-change"]], ["reindex", ["stale-registry"]]]);
    expect(fs.readFileSync(path.join(root, "characters", "_index.md"), "utf8")).toContain("(ilse.md)");
    expect(fs.existsSync(path.join(root, "chapters", "chapter-02.md"))).toBe(true);
  });

  test("a file edited since the change stopped is never overwritten, and deleting the log keeps the project as it is", () => {
    const root = book();
    stoppedAt(root, 5, () => COMMANDS.split.run(root));
    const log = path.join(root, UNDO_LOG);
    const lines = fs.readFileSync(log, "utf8").trimEnd().split("\n").slice(1).map((line) => JSON.parse(line));
    const edited = lines.find((line) => typeof line.before === "string").path;
    fs.appendFileSync(path.join(root, edited), "Edited since.\n");
    const before = snapshot(root);
    const refusal = `Cannot put back what story split chapter-02 changed before it stopped part way: ${edited} has changed since, and putting it back would lose that change, so nothing was changed. Undo that change and run this again, or delete ${UNDO_LOG} to keep the project as it is, then check it with story validate and story links`;
    expect(() => undoInterruptedChange(root)).toThrow(refusal);
    expect(snapshot(root)).toEqual(before);
    expect(invoke(root, COMMANDS.split.argv)).toEqual({ code: 3, out: "", err: `${refusal}\n` });
    const fixed = invoke(root, ["doctor", "--fix"]);
    expect(fixed.code).toBe(1);
    expect(fixed.out).toContain(`- Stopped: ${refusal}\n`);
    expect(snapshot(root)).toEqual(before);

    // A folder in the place of a file the log names is a change too.
    const created = lines.find((line) => line.before === null && fs.existsSync(path.join(root, line.path))).path;
    fs.rmSync(path.join(root, created));
    fs.mkdirSync(path.join(root, created));
    expect(() => undoInterruptedChange(root)).toThrow(`${edited}, ${created} have changed since, and putting them back would lose that change`);
    fs.rmdirSync(path.join(root, created));

    fs.rmSync(log);
    expect(interruptedChange(root)).toBeNull();
    expect(undoInterruptedChange(root)).toBeNull();
    expect(validateProject(root).errors.map((finding) => finding.code)).not.toContain("interrupted-change");
  });

  test("a put-back stopped part way is finished by running it again", () => {
    const fixture = book();
    const original = snapshot(fixture);
    const root = copy(fixture);
    stoppedAt(root, 8, () => COMMANDS.split.run(root));
    // The put-back's own writes keep no log, so it is stopped by hand.
    const { renameSync } = fs;
    let renames = 0;
    fs.renameSync = (from, to) => {
      renames += 1;
      if (renames === 2) {
        throw new Error("killed");
      }
      return renameSync(from, to);
    };
    try {
      expect(() => undoInterruptedChange(root)).toThrow("killed");
    } finally {
      fs.renameSync = renameSync;
    }
    expect(interruptedChange(root)).toEqual({ command: "story split chapter-02" });
    undoInterruptedChange(root);
    expect(snapshot(root)).toEqual(original);
  });

  test("a log story cannot read, or that names a file no command of its own writes, puts nothing back", () => {
    const root = book();
    const original = snapshot(root);
    const log = path.join(root, UNDO_LOG);
    const header = JSON.stringify({ command: "story split chapter-02", started: "2026-10-07T09:00:00.000Z" });
    const chapter = "chapters/chapter-01.md";
    const unreadable = [
      "{",
      "[]",
      JSON.stringify({ path: ".git/config", after: null, before: "[core]\n" }),
      JSON.stringify({ path: "../outside.md", after: null, before: "x\n" }),
      JSON.stringify({ path: "/etc/outside.md", after: null, before: "x\n" }),
      JSON.stringify({ path: "chapters\\..\\..\\outside.md", after: null, before: "x\n" }),
      JSON.stringify({ path: "dist/cover.png", after: null, before: "x\n" }),
      JSON.stringify({ path: ".snapshots/a/story.md", after: null, before: "x\n" }),
      JSON.stringify({ path: chapter, after: "not a hash", before: null }),
      JSON.stringify({ path: chapter, after: null }),
      JSON.stringify({ path: chapter, after: null, before: 7 })
    ];
    for (const line of unreadable) {
      fs.writeFileSync(log, `${header}\n${line}\n`);
      expect(() => undoInterruptedChange(root)).toThrow(`${UNDO_LOG} is not an undo log story can read (line 2), so nothing was changed. Delete it, then check the project with story validate and story links`);
    }
    // The rename marker is a file a rename writes.
    fs.writeFileSync(log, `${header}\n${JSON.stringify({ path: ".story-rename.tmp", after: null, before: null })}\n`);
    expect(undoInterruptedChange(root)).toEqual({ command: "story split chapter-02", files: [] });
    expect(snapshot(root)).toEqual(original);

    // A last line a crash cut short is left out: its change waited for it.
    fs.writeFileSync(log, `${header}\n${JSON.stringify({ path: chapter, after: null, before: "x\n" })}\n{"path":"chap`);
    expect(() => undoInterruptedChange(root)).toThrow(`Cannot put back what story split chapter-02 changed before it stopped part way: ${chapter} has changed since`);
    fs.writeFileSync(log, `${header}\n{"path":"chap`);
    expect(undoInterruptedChange(root)).toEqual({ command: "story split chapter-02", files: [] });
    expect(fs.existsSync(log)).toBe(false);

    // A log killed as it was made, or with a first line that is not one,
    // still counts, under no command's name.
    for (const text of ["", "garbage\n"]) {
      fs.writeFileSync(log, text);
      expect(interruptedChange(root)).toEqual({ command: "a story command" });
      expect(undoInterruptedChange(root)).toEqual({ command: "a story command", files: [] });
    }
    // Control characters in the name never reach the terminal.
    fs.writeFileSync(log, `${JSON.stringify({ command: "story split \u001b[2Jx" })}\n`);
    expect(interruptedChange(root)).toEqual({ command: "story split  [2Jx" });
    fs.rmSync(log);
    expect(snapshot(root)).toEqual(original);

    // A path to a file, not a project folder, has no log.
    const file = path.join(root, "story.md");
    expect(interruptedChange(file)).toBeNull();
    expect(undoInterruptedChange(file)).toBeNull();
  });
});

describe("withUndoLog (#604)", () => {
  test("logs each change before it is made, and keeps the log only for a run that stopped after one", () => {
    const root = makeTempDir();
    const notes = path.join(root, "notes.md");
    const log = path.join(root, UNDO_LOG);
    fs.writeFileSync(notes, "first\n");

    // Finished, or stopped before its first change: no log.
    withUndoLog(root, "story test", () => writeFile(notes, "second\n", { root }));
    expect(fs.existsSync(log)).toBe(false);
    expect(() => withUndoLog(root, "story test", () => {
      throw new Error("refused");
    })).toThrow("refused");
    expect(fs.existsSync(log)).toBe(false);
    // Only files a log can put back are changed, and only those in the
    // project are logged.
    expect(() => withUndoLog(root, "story test", () => writeFile(path.join(root, "cover.png"), "x", { root }))).toThrow("cover.png is not a file the undo log of story test can put back");
    expect(fs.readdirSync(root).sort()).toEqual(["notes.md"]);
    const outside = path.join(makeTempDir(), "outside.txt");
    withUndoLog(root, "story test", () => writeFile(outside, "x\n"));
    expect(fs.existsSync(log)).toBe(false);
    // A first change that fails leaves no log either.
    const { renameSync } = fs;
    fs.renameSync = () => {
      throw Object.assign(new Error("EIO"), { code: "EIO" });
    };
    try {
      expect(() => withUndoLog(root, "story test", () => writeFile(notes, "third\n", { root }))).toThrow(`Cannot write to ${notes}: EIO`);
    } finally {
      fs.renameSync = renameSync;
    }
    expect(fs.existsSync(log)).toBe(false);

    // Stopped after a change: the log stays, with an inner call's changes.
    const made = path.join(root, "made.md");
    expect(() => withUndoLog(root, "story test", () => {
      writeFile(notes, "third\n", { root });
      withUndoLog(root, "story inner", () => {
        writeFile(made, "made\n", { root });
        removeFile(notes);
      });
      throw new Error("disk full");
    })).toThrow("disk full");
    const lines = fs.readFileSync(log, "utf8").split("\n");
    expect(JSON.parse(lines[0])).toEqual({ command: "story test", started: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
    expect(lines.slice(1).map((line) => (line === "" ? line : JSON.parse(line)))).toEqual([
      { path: "notes.md", after: contentHash("third\n"), before: "second\n" },
      { path: "made.md", after: contentHash("made\n"), before: null },
      { path: "notes.md", after: null },
      ""
    ]);
    if (process.platform !== "win32") {
      // It holds the text of the files it names, so only its owner reads it.
      expect(fs.statSync(log).mode & 0o777).toBe(0o600);
    }
    expect(undoInterruptedChange(root)).toEqual({ command: "story test", files: ["notes.md", "made.md"] });
    expect(fs.readdirSync(root).sort()).toEqual(["notes.md"]);
    expect(fs.readFileSync(notes, "utf8")).toBe("second\n");
  });
});

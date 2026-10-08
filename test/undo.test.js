import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCli } from "../src/cli.js";
import { MAX_READ_BYTES, MAX_UNDO_LINE_BYTES, TEMPORARY_FILE_PATTERN, UNDO_LOG, contentHash, removeFile, withUndoLog, writeFile } from "../src/files.js";
import { LOCK_FILE } from "../src/lock.js";
import { interruptedChange, undoInterruptedChange } from "../src/undo.js";
import { createEntity, createStoryProject, mergeChapters, moveEntity, removeEntity, renameEntity, splitChapter, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, otherLivePid, whileWriting, writeMarkdown } from "./helpers.js";

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
// scene break between their text, a clue planted in chapter 2 and paid off
// in chapter 3, and story.md queries that name the character and a
// chapter, so each command changes several files.
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
  const story = path.join(root, "story.md");
  const text = fs.readFileSync(story, "utf8");
  const end = text.indexOf("\n---\n", 4);
  const queries = ["queries:", "  - name: with-mara", "    kind: chapters", "    where: [characters=mara-quill]", "  - name: quay", "    kind: scenes", "    where: [chapter=chapter-02]"];
  fs.writeFileSync(story, `${text.slice(0, end)}\n${queries.join("\n")}${text.slice(end)}`, "utf8");
  expect(runCli(["wordcount", "--write", "--path", root], memoryIo(root))).toBe(0);
  return root;
}

// book() with a fourth chapter, made branching: chapter 1 leads to chapter
// 2 or chapter 4, so a split of chapter 2 adds a choice to it and a split
// or merge rewrites the choice into chapter 4.
function branching() {
  const root = book();
  createEntity(root, { kind: "chapter", name: "Four", status: "draft", characters: ["mara-quill"] });
  setProse(root, "chapter-04", "They landed.\n");
  const file = path.join(root, "chapters", "chapter-01.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\nstatus: /, "\nchoices:\n  - text: Take the ferry\n    to: chapter-02\n  - text: Walk the coast\n    to: chapter-04\nstatus: "), "utf8");
  expect(runCli(["wordcount", "--write", "--path", root], memoryIo(root))).toBe(0);
  return root;
}

// Each command that keeps an undo log, as the API runs it, as typed, and as
// its log names it.
const COMMANDS = {
  split: { run: (root) => splitChapter(root, { id: "chapter-02", at: "1" }), argv: ["split", "chapter-02", "--at", "1"], name: "story split chapter-02 --at 1" },
  merge: { run: (root) => mergeChapters(root, { id: "chapter-01", next: "chapter-02" }), argv: ["merge", "chapter-01", "chapter-02"], name: "story merge chapter-01 chapter-02" },
  move: { run: (root) => moveEntity(root, { kind: "chapter", id: "chapter-02", number: "5" }), argv: ["move", "chapter", "chapter-02", "--number", "5"], name: "story move chapter chapter-02 --number 5" },
  rename: { run: (root) => renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Tide" }), argv: ["rename", "character", "mara-quill", "Mara Tide"], name: "story rename character mara-quill 'Mara Tide'" },
  remove: { run: (root) => removeEntity(root, { kind: "character", id: "mara-quill" }), argv: ["remove", "character", "mara-quill"], name: "story remove character mara-quill" },
  "split in a branching book": { run: (root) => splitChapter(root, { id: "chapter-02", at: "1" }), name: "story split chapter-02 --at 1", fixture: branching },
  "merge in a branching book": { run: (root) => mergeChapters(root, { id: "chapter-02", next: "chapter-03" }), name: "story merge chapter-02 chapter-03", fixture: branching }
};

const POSIX = process.platform !== "win32";

// Runs `run` and stops it, as a kill would, at its `at`th change to a file
// in `root`: a rename into place or a delete. Returns how many changes it
// reached; with `at` 0 it runs to the end. Every change must find its line
// in the undo log, naming the file and what it is about to hold, written
// and flushed to disk, and the log's own name flushed to its folder; the
// folder is flushed again once the finished run deletes the log.
function stoppedAt(root, at, run) {
  const real = { openSync: fs.openSync, writeFileSync: fs.writeFileSync, fsyncSync: fs.fsyncSync, renameSync: fs.renameSync, rmSync: fs.rmSync };
  const log = path.join(root, UNDO_LOG);
  const folders = new Map();
  let logDescriptor = null;
  let unflushed = false;
  let named = false;
  let deleted = null;
  let count = 0;
  const change = (file, after) => {
    const name = path.basename(String(file));
    if (!String(file).startsWith(root) || name === UNDO_LOG || TEMPORARY_FILE_PATTERN.test(name)) {
      return;
    }
    const last = JSON.parse(fs.readFileSync(log, "utf8").trimEnd().split("\n").at(-1));
    expect(last).toMatchObject({ path: path.relative(root, String(file)).split(path.sep).join("/"), after });
    expect({ unflushed, named }).toEqual({ unflushed: false, named: POSIX });
    count += 1;
    if (count === at) {
      throw new Error("killed");
    }
  };
  fs.openSync = (file, ...rest) => {
    const descriptor = real.openSync(file, ...rest);
    folders.set(descriptor, fs.statSync(file).isDirectory() ? path.resolve(String(file)) : null);
    if (String(file) === log) {
      logDescriptor = descriptor;
    } else if (descriptor === logDescriptor) {
      // The log was closed, and its number given to this.
      logDescriptor = null;
    }
    return descriptor;
  };
  fs.writeFileSync = (target, ...rest) => {
    if (target === logDescriptor) {
      unflushed = true;
    }
    return real.writeFileSync(target, ...rest);
  };
  fs.fsyncSync = (descriptor) => {
    const result = real.fsyncSync(descriptor);
    if (descriptor === logDescriptor) {
      unflushed = false;
    } else if (folders.get(descriptor) === root) {
      named ||= logDescriptor !== null;
      deleted = deleted === false ? true : deleted;
    }
    return result;
  };
  fs.renameSync = (from, to) => {
    change(to, contentHash(fs.readFileSync(from)));
    return real.renameSync(from, to);
  };
  fs.rmSync = (file, options) => {
    if (String(file) === log) {
      deleted = false;
    } else if (fs.existsSync(file)) {
      change(file, null);
    }
    return real.rmSync(file, options);
  };
  try {
    run();
  } catch (error) {
    if (!error.message.endsWith("killed")) {
      throw error;
    }
  } finally {
    Object.assign(fs, real);
  }
  if (at === 0) {
    expect(deleted).toBe(POSIX);
  }
  return count;
}

// The project's files without the temporary files a killed write leaves.
function withoutTemporary(files) {
  return Object.fromEntries(Object.entries(files).filter(([file]) => !TEMPORARY_FILE_PATTERN.test(path.posix.basename(file))));
}

describe("undo logs (#604)", () => {
  for (const [command, { run, name, fixture: make = book }] of Object.entries(COMMANDS)) {
    // Split and merge, several steps each, are stopped at every change; the
    // others at the first, the second, a middle, and the last.
    test(`${command} stopped at any change is put back whole`, () => {
      const fixture = make();
      const original = snapshot(fixture);
      const clean = copy(fixture);
      const total = stoppedAt(clean, 0, () => run(clean));
      expect(total).toBeGreaterThan(2);
      expect(fs.existsSync(path.join(clean, UNDO_LOG))).toBe(false);
      // The run changed the files that name what it changed: the saved
      // queries, which name the character and chapter 2, and a branching
      // book's choices.
      const changed = Object.entries(snapshot(clean)).filter(([file, text]) => original[file] !== text).map(([file]) => file);
      if (["rename", "move", "merge"].includes(command)) {
        expect(changed).toContain("story.md");
      }
      if (make === branching) {
        expect(changed).toContain("chapters/chapter-01.md");
      }
      const points = /^(split|merge)/.test(command) ? Array.from({ length: total }, (_, index) => index + 1) : [1, 2, Math.ceil(total / 2), total];
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

  test.skipIf(!POSIX)("a command killed for real leaves a log that puts the project back, even one killed before its first change was made", () => {
    const fixture = book();
    const original = snapshot(fixture);
    for (const at of [1, 3]) {
      const root = copy(fixture);
      // In a child, which kills itself just before its `at`th change, after
      // that change's line is in the log.
      const script = `
        const fs = (await import("node:fs")).default;
        const { splitChapter } = await import(${JSON.stringify(pathToFileURL(path.join(import.meta.dir, "..", "src", "story.js")).href)});
        const root = ${JSON.stringify(root)};
        let changes = 0;
        const change = (file) => {
          if (String(file).startsWith(root) && (changes += 1) === ${at}) {
            process.kill(process.pid, "SIGKILL");
          }
        };
        const { renameSync, rmSync } = fs;
        fs.renameSync = (from, to) => {
          change(to);
          return renameSync(from, to);
        };
        fs.rmSync = (file, options) => {
          if (fs.existsSync(file)) {
            change(file);
          }
          return rmSync(file, options);
        };
        splitChapter(root, { id: "chapter-02", at: "1" });
      `;
      const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 30000 });
      expect(result.signal).toBe("SIGKILL");
      const lines = fs.readFileSync(path.join(root, UNDO_LOG), "utf8").trimEnd().split("\n");
      expect(lines.length).toBe(at + 1);
      expect(interruptedChange(root)).toEqual({ command: COMMANDS.split.name });
      expect(undoInterruptedChange(root).files.length > 0).toBe(at > 1);
      expect(withoutTemporary(snapshot(root))).toEqual(original);
    }
  });

  test("a log whose one change was never made puts nothing back", () => {
    const root = book();
    const original = snapshot(root);
    const chapter = "chapters/chapter-02.md";
    const text = fs.readFileSync(path.join(root, chapter), "utf8");
    fs.writeFileSync(path.join(root, UNDO_LOG), `${JSON.stringify({ command: COMMANDS.split.name })}\n${JSON.stringify({ path: chapter, after: contentHash("never written\n"), before: text, mode: 0o644 })}\n`);
    expect(validateProject(root).errors.map((finding) => finding.code)).toContain("interrupted-change");
    expect(undoInterruptedChange(root)).toEqual({ command: COMMANDS.split.name, files: [] });
    expect(snapshot(root)).toEqual(original);
  });

  test("the same command run again puts the change back first and says so, and its dry run previews that", () => {
    const fixture = book();
    const clean = copy(fixture);
    expect(invoke(clean, COMMANDS.split.argv).code).toBe(0);
    const root = copy(fixture);
    stoppedAt(root, 5, () => COMMANDS.split.run(root));
    const stopped = snapshot(root);
    const files = undoInterruptedChange(copy(root)).files;

    const preview = invoke(root, [...COMMANDS.split.argv, "--dry-run"]);
    expect(preview.code).toBe(0);
    expect(preview.err).toStartWith(`note: story split chapter-02 --at 1 stopped part way, so this would first put back the ${files.length} files it had changed\nwarning: `);
    // The log is the command's own bookkeeping, not a change it lists.
    expect(preview.out).not.toContain(UNDO_LOG);
    const json = JSON.parse(invoke(root, [...COMMANDS.split.argv, "--dry-run", "--json"]).out).data;
    expect(json.undone).toEqual({ command: COMMANDS.split.name, files });
    expect(json.changes.map((change) => change.path)).not.toContain(UNDO_LOG);
    expect(snapshot(root)).toEqual(stopped);

    const rerun = invoke(root, COMMANDS.split.argv);
    expect(rerun.code).toBe(0);
    expect(rerun.err).toStartWith(`note: story split chapter-02 --at 1 stopped part way, so this first put back the ${files.length} files it had changed\nwarning: `);
    expect(rerun.out).toStartWith("Split chapter chapter-02: the rest is chapter-03");
    expect(snapshot(root)).toEqual(snapshot(clean));
  });

  test("the log of another command, or of the same one with other arguments, is refused rather than put back", () => {
    const root = book();
    stoppedAt(root, 5, () => COMMANDS.split.run(root));
    const stopped = snapshot(root);
    const refusal = (command) => `${COMMANDS.split.name} stopped part way, and ${UNDO_LOG} holds what it changed, so ${command} would build on a change made only in part; nothing was changed. Run story doctor --fix to put those files back first, or run ${COMMANDS.split.name} again to finish it`;
    // Putting the split back first would make this remove a different
    // chapter from the one the writer named.
    expect(invoke(root, ["remove", "chapter", "chapter-03"])).toEqual({ code: 4, out: "", err: `${refusal("story remove chapter chapter-03")}\n` });
    expect(invoke(root, ["split", "chapter-02", "--at", "2", "--dry-run"])).toEqual({ code: 4, out: "", err: `${refusal("story split chapter-02 --at 2")}\n` });
    expect(invoke(root, ["rename", "character", "mara-quill", "Mara Tide", "--prose", "--id", "tide"]).err).toBe(`${refusal("story rename character mara-quill 'Mara Tide' --id tide --prose")}\n`);
    expect(invoke(root, ["move", "scene", "chapter-02-scene-01", "--chapter", "chapter-01", "--scene", "2"]).err).toBe(`${refusal("story move scene chapter-02-scene-01 --chapter chapter-01 --scene 2")}\n`);
    expect(() => mergeChapters(root, { id: "chapter-01", next: "chapter-02" })).toThrow(refusal("story merge chapter-01 chapter-02"));
    expect(snapshot(root)).toEqual(stopped);
  });

  test("a rerun that fails after it put the change back says so", () => {
    const fixture = book();
    const original = snapshot(fixture);
    const root = copy(fixture);
    stoppedAt(root, 5, () => COMMANDS.split.run(root));
    const { renameSync } = fs;
    let renames = 0;
    fs.renameSync = (from, to) => {
      renames += 1;
      return renameSync(from, to);
    };
    let files;
    try {
      files = undoInterruptedChange(copy(root)).files;
    } finally {
      fs.renameSync = renameSync;
    }
    // The rerun's first rename after the put-back fails.
    const putBack = renames;
    renames = 0;
    fs.renameSync = (from, to) => {
      renames += 1;
      if (renames > putBack) {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      }
      return renameSync(from, to);
    };
    let error = null;
    try {
      COMMANDS.split.run(root);
    } catch (caught) {
      error = caught;
    } finally {
      fs.renameSync = renameSync;
    }
    expect(error.message).toEndWith(": EIO");
    expect(error.hint).toBe(`${COMMANDS.split.name} had stopped part way, so the ${files.length} files it changed were put back first`);
    expect(snapshot(root)).toEqual(original);
  });

  test("while the log is there, validate reports it, other write commands are refused, and doctor --fix puts the change back", () => {
    const root = book();
    expect(invoke(root, ["snapshot", "First"]).code).toBe(0);
    const original = snapshot(root);
    stoppedAt(root, 4, () => COMMANDS.merge.run(root));
    expect(validateProject(root).errors.filter((finding) => finding.code === "interrupted-change")).toEqual([{
      code: "interrupted-change",
      message: `${COMMANDS.merge.name} stopped part way, and ${UNDO_LOG} holds what it changed: run story doctor --fix to put those files back, or run ${COMMANDS.merge.name} again to finish it`,
      file: UNDO_LOG,
      chapter: null
    }]);
    expect(invoke(root, ["check"]).code).toBe(1);

    const stopped = snapshot(root);
    const refusal = (command) => `${COMMANDS.merge.name} stopped part way, and ${UNDO_LOG} holds what it changed, so story ${command} would build on a change made only in part; nothing was changed. Run story doctor --fix to put those files back first, or run ${COMMANDS.merge.name} again to finish it\n`;
    expect(invoke(root, ["reindex"])).toEqual({ code: 4, out: "", err: refusal("reindex") });
    expect(invoke(root, ["reindex", "--dry-run"])).toEqual({ code: 4, out: "", err: refusal("reindex") });
    expect(invoke(root, ["add", "character", "Ilse"]).code).toBe(4);
    // A command that writes only with a flag is refused with it.
    expect(invoke(root, ["wordcount", "--write"])).toEqual({ code: 4, out: "", err: refusal("wordcount") });
    expect(invoke(root, ["snapshot", "--restore", "first"])).toEqual({ code: 4, out: "", err: refusal("snapshot") });
    // init --force and import --force into the folder are refused too.
    const parent = path.dirname(root);
    const folder = path.basename(root);
    expect(invoke(parent, ["init", "Undo Book", "--dir", folder, "--force"])).toEqual({ code: 4, out: "", err: refusal("init --force") });
    const manuscript = path.join(makeTempDir(), "draft.md");
    fs.writeFileSync(manuscript, "# Undo Book\n\n## Chapter 1\n\nNew words.\n");
    expect(invoke(parent, ["import", manuscript, "--title", "Undo Book", "--dir", folder, "--force"])).toEqual({ code: 4, out: "", err: refusal("import --force") });
    // Reading commands still run.
    expect(invoke(root, ["wordcount"]).code).toBe(0);
    expect(invoke(root, ["doctor"]).out).toContain("Fix validation errors");
    expect(snapshot(root)).toEqual(stopped);

    const preview = invoke(root, ["doctor", "--fix", "--dry-run"]);
    expect(preview.out).toMatch(/^Repairs \(dry run; nothing was written\):\n- Put back an interrupted change \(interrupted-change\): \d+ changes\n/);
    expect(preview.out).not.toContain(UNDO_LOG);
    expect(snapshot(root)).toEqual(stopped);

    const fixed = invoke(root, ["doctor", "--fix", "--json"]);
    expect(fixed.code).toBe(0);
    const { repairs, stopped: why } = JSON.parse(fixed.out).data.fix;
    expect(why).toBeNull();
    expect(repairs.map((repair) => [repair.command, repair.codes])).toEqual([["undo", ["interrupted-change"]]]);
    expect(repairs[0].changes.map((change) => change.path)).not.toContain(UNDO_LOG);
    expect(snapshot(root)).toEqual(original);
    expect(invoke(root, ["reindex"]).code).toBe(0);
  });

  test("export, build, synopsis, and diagram --out are refused while the log is there, a --dry-run too, and write nothing (#723)", () => {
    const root = book();
    stoppedAt(root, 4, () => COMMANDS.merge.run(root));
    const stopped = snapshot(root);
    const refusal = (command) => `${COMMANDS.merge.name} stopped part way, and ${UNDO_LOG} holds what it changed, so story ${command} would build on a change made only in part; nothing was changed. Run story doctor --fix to put those files back first, or run ${COMMANDS.merge.name} again to finish it\n`;
    expect(invoke(root, ["export"])).toEqual({ code: 4, out: "", err: refusal("export") });
    expect(invoke(root, ["export", "--dry-run"])).toEqual({ code: 4, out: "", err: refusal("export") });
    expect(invoke(root, ["build"])).toEqual({ code: 4, out: "", err: refusal("build") });
    expect(invoke(root, ["build", "--dry-run"])).toEqual({ code: 4, out: "", err: refusal("build") });
    expect(invoke(root, ["synopsis"])).toEqual({ code: 4, out: "", err: refusal("synopsis") });
    expect(invoke(root, ["diagram", "arcs", "--out", "arcs.mmd"])).toEqual({ code: 4, out: "", err: refusal("diagram") });
    expect(invoke(root, ["diagram", "arcs", "--out", "arcs.mmd", "--dry-run"])).toEqual({ code: 4, out: "", err: refusal("diagram") });
    expect(snapshot(root)).toEqual(stopped);
  });

  test.skipIf(!POSIX)("a link at the log's path refuses nothing, and is left as it is (#723)", () => {
    const root = book();
    const outside = path.join(makeTempDir(), "outside.md");
    fs.writeFileSync(outside, "outside\n");
    fs.symlinkSync(outside, path.join(root, UNDO_LOG));
    expect(invoke(root, ["export"]).code).toBe(0);
    expect(invoke(root, ["build", "--dry-run"]).code).toBe(0);
    expect(fs.readFileSync(outside, "utf8")).toBe("outside\n");
    expect(fs.lstatSync(path.join(root, UNDO_LOG)).isSymbolicLink()).toBe(true);
  });

  test("the log of a command still running is its own: it is not reported, refused, or put back", () => {
    const root = book();
    stoppedAt(root, 4, () => COMMANDS.merge.run(root));
    const lock = path.join(root, LOCK_FILE);
    fs.writeFileSync(lock, `${otherLivePid()}\n${os.hostname()}\n${new Date().toISOString()}\n`);
    const stopped = snapshot(root);
    expect(interruptedChange(root)).toBeNull();
    expect(validateProject(root).errors.map((finding) => finding.code)).not.toContain("interrupted-change");
    expect(invoke(root, ["reindex", "--dry-run"]).code).toBe(0);
    const preview = invoke(root, ["doctor", "--fix", "--dry-run"]);
    expect(preview.out).not.toContain("Put back an interrupted change");
    expect(invoke(root, [...COMMANDS.merge.argv, "--dry-run"]).err).not.toContain("note:");
    expect(snapshot(root)).toEqual(stopped);
    // Once that command has gone, the log is one it left.
    fs.rmSync(lock);
    expect(interruptedChange(root)).toEqual({ command: COMMANDS.merge.name });
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
    const refusal = `Cannot put back what ${COMMANDS.split.name} changed before it stopped part way: ${edited} has changed since, or is reached through a folder outside the project, and putting it back would lose that change, so nothing was changed. Undo that change and run this again, or delete ${UNDO_LOG} to keep the project as it is, then check it with story validate and story links`;
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
    expect(() => undoInterruptedChange(root)).toThrow(`${edited}, ${created} have changed since, or are reached through a folder outside the project, and putting them back would lose that change`);
    fs.rmdirSync(path.join(root, created));

    fs.rmSync(log);
    expect(interruptedChange(root)).toBeNull();
    expect(undoInterruptedChange(root)).toBeNull();
    expect(validateProject(root).errors.map((finding) => finding.code)).not.toContain("interrupted-change");
  });

  test("a file saved while the change is put back is left as saved, and running it again finishes once that save is undone", () => {
    const fixture = book();
    const original = snapshot(fixture);
    const root = copy(fixture);
    stoppedAt(root, 8, () => COMMANDS.split.run(root));
    const probe = copy(root);
    const files = undoInterruptedChange(probe).files;
    // The first file written back, and one put back after it.
    const first = files.find((file) => fs.existsSync(path.join(probe, file)));
    const later = files[files.indexOf(first) + 1];
    const target = path.join(root, later);
    const held = fs.readFileSync(target, "utf8");
    const spy = whileWriting(path.join(root, first), () => fs.appendFileSync(target, "Saved meanwhile.\n"));
    try {
      expect(() => undoInterruptedChange(root)).toThrow(`${later} changed on disk while story was putting back what ${COMMANDS.split.name} changed, so it was left as it is. Run this again to finish`);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(target, "utf8")).toBe(`${held}Saved meanwhile.\n`);
    expect(interruptedChange(root)).toEqual({ command: COMMANDS.split.name });
    fs.writeFileSync(target, held);
    undoInterruptedChange(root);
    expect(snapshot(root)).toEqual(original);
  });

  test.skipIf(!POSIX)("a file the change deleted comes back with its own permissions", () => {
    const fixture = book();
    const file = path.join(fixture, "characters", "mara-quill.md");
    fs.chmodSync(file, 0o600);
    const original = snapshot(fixture);
    const clean = copy(fixture);
    const total = stoppedAt(clean, 0, () => COMMANDS.rename.run(clean));
    const root = copy(fixture);
    stoppedAt(root, total, () => COMMANDS.rename.run(root));
    expect(fs.existsSync(path.join(root, "characters", "mara-quill.md"))).toBe(false);
    undoInterruptedChange(root);
    expect(snapshot(root)).toEqual(original);
    expect(fs.statSync(path.join(root, "characters", "mara-quill.md")).mode & 0o777).toBe(0o600);
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
    expect(interruptedChange(root)).toEqual({ command: COMMANDS.split.name });
    undoInterruptedChange(root);
    expect(snapshot(root)).toEqual(original);
  });

  test.skipIf(!POSIX)("a file the log names through a folder that leads outside the project is never read or changed", () => {
    const root = book();
    const outside = makeTempDir();
    fs.writeFileSync(path.join(outside, "secret.md"), "a guess\n");
    fs.symlinkSync(outside, path.join(root, "ext"));
    const original = snapshot(outside);
    for (const before of ["a guess\n", "another guess\n", null]) {
      fs.writeFileSync(path.join(root, UNDO_LOG), `${JSON.stringify({ command: COMMANDS.split.name })}\n${JSON.stringify({ path: "ext/secret.md", after: null, before })}\n`);
      // The same refusal whatever the file outside holds.
      expect(() => undoInterruptedChange(root)).toThrow("ext/secret.md has changed since, or is reached through a folder outside the project");
    }
    expect(snapshot(outside)).toEqual(original);
  });

  test("a log story cannot read, or that names a file no command of its own writes, puts nothing back", () => {
    const root = book();
    const original = snapshot(root);
    const log = path.join(root, UNDO_LOG);
    const header = JSON.stringify({ command: COMMANDS.split.name, started: "2026-10-07T09:00:00.000Z" });
    const chapter = "chapters/chapter-01.md";
    const text = fs.readFileSync(path.join(root, chapter), "utf8");
    const unreadable = [
      "{",
      "[]",
      JSON.stringify({ path: ".git/config", after: null, before: "[core]\n" }),
      JSON.stringify({ path: "../outside.md", after: null, before: "x\n" }),
      JSON.stringify({ path: "/etc/outside.md", after: null, before: "x\n" }),
      JSON.stringify({ path: "chapters\\..\\..\\outside.md", after: null, before: "x\n" }),
      JSON.stringify({ path: "dist/cover.png", after: null, before: "x\n" }),
      JSON.stringify({ path: ".snapshots/a/story.md", after: null, before: "x\n" }),
      JSON.stringify({ path: "chapters/bell\u0007.md", after: null, before: "x\n" }),
      JSON.stringify({ path: "chapters/‮dnm.md", after: null, before: "x\n" }),
      JSON.stringify({ path: chapter, after: "not a hash", before: null }),
      JSON.stringify({ path: chapter, after: null }),
      JSON.stringify({ path: chapter, after: null, before: 7 }),
      JSON.stringify({ path: chapter, after: null, before: text, mode: 0o4755 }),
      // Longer than any file story reads, so not a file story logged.
      JSON.stringify({ path: chapter, after: null, before: "x".repeat(MAX_READ_BYTES + 1) })
    ];
    for (const line of unreadable) {
      fs.writeFileSync(log, `${header}\n${line}\n`);
      expect(() => undoInterruptedChange(root)).toThrow(`${UNDO_LOG} is not an undo log story can read (line 2), so nothing was changed. Delete it, then check the project with story validate and story links`);
    }
    // The rename marker is a file a rename writes.
    fs.writeFileSync(log, `${header}\n${JSON.stringify({ path: ".story-rename.tmp", after: null, before: null })}\n`);
    expect(undoInterruptedChange(root)).toEqual({ command: COMMANDS.split.name, files: [] });
    expect(snapshot(root)).toEqual(original);

    // A last line a crash cut short is left out: its change waited for it,
    // even when the cut falls inside a character.
    const entry = JSON.stringify({ path: chapter, after: null, before: text });
    fs.writeFileSync(log, Buffer.concat([Buffer.from(`${header}\n${entry}\n{"path":"chapters/caf`), Buffer.from("é").subarray(0, 1)]));
    expect(undoInterruptedChange(root)).toEqual({ command: COMMANDS.split.name, files: [] });
    fs.writeFileSync(log, `${header}\n${JSON.stringify({ path: chapter, after: null, before: "x\n" })}\n{"path":"chap`);
    expect(() => undoInterruptedChange(root)).toThrow(`Cannot put back what ${COMMANDS.split.name} changed before it stopped part way: ${chapter} has changed since`);
    fs.writeFileSync(log, `${header}\n{"path":"chap`);
    expect(undoInterruptedChange(root)).toEqual({ command: COMMANDS.split.name, files: [] });
    expect(fs.existsSync(log)).toBe(false);

    // A log killed as it was made, or with a first line that is not one,
    // still counts, under no command's name.
    for (const content of ["", "garbage\n"]) {
      fs.writeFileSync(log, content);
      expect(interruptedChange(root)).toEqual({ command: "a story command" });
      expect(undoInterruptedChange(root)).toEqual({ command: "a story command", files: [] });
    }
    // Control characters and marks that reorder text never reach the
    // terminal.
    fs.writeFileSync(log, `${JSON.stringify({ command: "story split \u001b[2Jx‮" })}\n`);
    expect(interruptedChange(root)).toEqual({ command: "story split  [2Jx " });
    fs.rmSync(log);
    expect(snapshot(root)).toEqual(original);

    // A path to a file, not a project folder, has no log.
    const file = path.join(root, "story.md");
    expect(interruptedChange(file)).toBeNull();
    expect(undoInterruptedChange(file)).toBeNull();
  });

  test("a line longer than any line story logs is refused, by the command and its dry run alike", () => {
    const root = book();
    const original = snapshot(root);
    const log = path.join(root, UNDO_LOG);
    fs.writeFileSync(log, `${JSON.stringify({ command: COMMANDS.split.name })}\n${"x".repeat(MAX_UNDO_LINE_BYTES + 1)}\n`);
    const refusal = `${UNDO_LOG} is not an undo log story can read (line 2), so nothing was changed. Delete it, then check the project with story validate and story links\n`;
    expect(invoke(root, [...COMMANDS.split.argv, "--dry-run"])).toEqual({ code: 3, out: "", err: refusal });
    expect(invoke(root, COMMANDS.split.argv)).toEqual({ code: 3, out: "", err: refusal });
    fs.rmSync(log);
    expect(snapshot(root)).toEqual(original);
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
      { path: "notes.md", after: contentHash("third\n"), before: "second\n", mode: fs.statSync(made).mode & 0o777 },
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

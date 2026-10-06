import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { recordChanges, removeFile, writeFile } from "../src/files.js";
import { LOCK_FILE } from "../src/lock.js";
import { previewChanges } from "../src/preview.js";
import { createEntity } from "../src/story.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const examplesRoot = path.resolve(import.meta.dir, "..", "examples");

function copyExample(name) {
  const root = path.join(makeTempDir(), name);
  fs.cpSync(path.join(examplesRoot, name), root, { recursive: true });
  return root;
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function invokeJson(cwd, argv) {
  const result = invoke(cwd, argv);
  const envelope = JSON.parse(result.out);
  expect(validateAgainstSchema(envelope, schema)).toEqual([]);
  return { ...result, envelope };
}

// Every file's bytes and every folder, keyed by path relative to root.
function snapshot(root) {
  const entries = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const key = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        entries[`${key}/`] = "dir";
        walk(full);
      } else if (entry.isSymbolicLink()) {
        entries[key] = `link ${fs.readlinkSync(full)}`;
      } else {
        try {
          entries[key] = fs.readFileSync(full).toString("base64");
        } catch {
          entries[key] = `unreadable ${fs.statSync(full).mode}`;
        }
      }
    }
  };
  walk(root);
  return entries;
}

// The changes between two snapshots, as recordChanges reports them.
function diff(before, after) {
  const changes = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const isDir = key.endsWith("/");
    const file = isDir ? key.slice(0, -1) : key;
    if (!(key in before)) {
      changes.push({ action: isDir ? "mkdir" : "create", path: file });
    } else if (!(key in after)) {
      changes.push({ action: "delete", path: file });
    } else if (before[key] !== after[key]) {
      changes.push({ action: "update", path: file });
    }
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// Commands run on a copy of the-unraveled-thread. `prepare` edits the copy
// first, so the command has something to do.
const CASES = [
  { argv: ["rename", "character", "edran-vale", "Edran Vane"] },
  { argv: ["remove", "character", "jonas-reed"] },
  { argv: ["move", "chapter", "chapter-01", "--number", "9"] },
  { argv: ["move", "scene", "chapter-01-scene-01", "--chapter", "chapter-02"] },
  { argv: ["add", "character", "Mira Holt", "--location", "the-weavers-loft"] },
  {
    argv: ["reindex"],
    prepare: (root) => fs.writeFileSync(path.join(root, "characters", "_index.md"), "---\ntype: character-index\n---\n# Characters\n")
  },
  {
    argv: ["migrate"],
    prepare: (root) => {
      fs.rmSync(path.join(root, "glossary"), { recursive: true, force: true });
      fs.rmSync(path.join(root, "continuity", "clues", "_index.md"));
    }
  },
  {
    argv: ["wordcount", "--write"],
    prepare: (root) => {
      const file = path.join(root, "chapters", "chapter-01.md");
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/word-count: \d+/, "word-count: 1"));
    }
  }
];

describe("--dry-run", () => {
  for (const { argv, prepare } of CASES) {
    test(`story ${argv.join(" ")} --dry-run changes nothing and lists what the real run then does`, () => {
      const root = copyExample("the-unraveled-thread");
      prepare?.(root);
      const before = snapshot(root);

      const preview = invokeJson(root, [...argv, "--dry-run", "--json"]);
      expect(snapshot(root)).toEqual(before);
      expect(preview.code).toBe(0);
      expect(preview.envelope.data.dryRun).toBe(true);
      expect(preview.envelope.writes).toEqual([]);
      expect(preview.envelope.data.changes.length).toBeGreaterThan(0);

      const real = invokeJson(root, [...argv, "--json"]);
      expect(real.code).toBe(0);
      const after = snapshot(root);
      expect(real.envelope.data.changes).toEqual(diff(before, after));
      expect(preview.envelope.data).toEqual({ ...real.envelope.data, dryRun: true });
      expect(preview.envelope.diagnostics).toEqual(real.envelope.diagnostics);
      expect(real.envelope.writes).toEqual(real.envelope.data.changes
        .filter((change) => change.action === "create" || change.action === "update")
        .map((change) => path.join(root, change.path)));
    });
  }

  test("the text output lists each change and says nothing was written", () => {
    const root = copyExample("the-unraveled-thread");
    const before = snapshot(root);
    const { code, out } = invoke(root, ["rename", "character", "edran-vale", "Edran Vane", "--dry-run"]);
    expect(code).toBe(0);
    expect(out).toContain("delete  characters/edran-vale.md\n");
    expect(out).toContain("create  characters/edran-vane.md\n");
    expect(out).toContain("update  characters/_index.md\n");
    expect(out).toMatch(/Dry run: story rename would make \d+ changes; nothing was written\n$/);
    expect(snapshot(root)).toEqual(before);

    expect(invoke(root, ["reindex", "--dry-run"]).out).toBe("Dry run: story reindex would make no changes; nothing was written\n");
  });

  test("a dry run neither takes nor waits for the project lock", () => {
    const root = copyExample("the-unraveled-thread");
    // A live command (this process) holds the lock.
    const lock = `${process.pid}\n${os.hostname()}\n${new Date().toISOString()}\n`;
    fs.writeFileSync(path.join(root, LOCK_FILE), lock);
    const previous = process.env.STORY_LOCK_WAIT_MS;
    process.env.STORY_LOCK_WAIT_MS = "0";
    try {
      expect(invoke(root, ["rename", "character", "edran-vale", "Edran Vane"]).code).toBe(4);
      const preview = invoke(root, ["rename", "character", "edran-vale", "Edran Vane", "--dry-run"]);
      expect(preview.code).toBe(0);
      expect(preview.out).toContain("create  characters/edran-vane.md");
      expect(preview.out).not.toContain(LOCK_FILE);
    } finally {
      if (previous === undefined) {
        delete process.env.STORY_LOCK_WAIT_MS;
      } else {
        process.env.STORY_LOCK_WAIT_MS = previous;
      }
    }
    expect(fs.readFileSync(path.join(root, LOCK_FILE), "utf8")).toBe(lock);
    expect(fs.existsSync(path.join(root, "characters", "edran-vale.md"))).toBe(true);
  });

  test("a refused dry run names the project's files, exits as the real run would, and leaves no scratch copy", () => {
    const root = copyExample("the-unraveled-thread");
    const scratch = makeTempDir();
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = scratch;
    try {
      const taken = invoke(root, ["rename", "character", "edran-vale", "Jonas Reed", "--dry-run"]);
      expect(taken.code).toBe(4);
      expect(taken.err).toContain("character jonas-reed already exists");
      const missing = invoke(root, ["remove", "character", "nobody", "--dry-run"]);
      expect(missing.code).toBe(2);
      if (process.getuid?.() !== 0) {
        fs.chmodSync(path.join(root, "characters", "_index.md"), 0o444);
        const readOnly = invoke(root, ["rename", "character", "edran-vale", "Edran Vane", "--dry-run"]);
        expect(readOnly.code).toBe(4);
        expect(readOnly.err).toContain("characters/_index.md (permission denied)");
        expect(readOnly.err).not.toContain("story-dry-run");
      }
      expect(fs.readdirSync(scratch)).toEqual([]);
    } finally {
      if (previous === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = previous;
      }
    }
  });

  test("results name project paths, not the scratch copy", () => {
    const root = copyExample("the-unraveled-thread");
    const { result, changes } = previewChanges(root, (copy) => createEntity(copy, { kind: "character", name: "Ada Quill" }));
    expect(result.file).toBe(path.join(root, "characters", "ada-quill.md"));
    expect(result.changed.every((file) => file.startsWith(root))).toBe(true);
    expect(changes).toContainEqual({ action: "create", path: "characters/ada-quill.md" });
    expect(fs.existsSync(path.join(root, "characters", "ada-quill.md"))).toBe(false);
  });

  test("recordChanges drops a file created and deleted in one run and nests", () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, "kept.md"), "old");
    const { changes, result } = recordChanges(root, () => recordChanges(root, () => {
      writeAndRemove(root);
      return "done";
    }).changes);
    expect(result).toEqual(changes);
    expect(changes).toEqual([
      { action: "mkdir", path: "notes" },
      { action: "create", path: "notes/new.md" },
      { action: "delete", path: "kept.md" }
    ].sort((a, b) => (a.path < b.path ? -1 : 1)));
  });

  test("a dry run meets what the real run meets: unreadable and oversized notes, other projects, assets, and unwritable folders", () => {
    if (process.getuid?.() === 0) {
      return;
    }
    const root = copyExample("the-unraveled-thread");
    const notes = path.join(root, "notes");
    fs.mkdirSync(notes);
    // Over the scan limit: a real rename skips it by size, unread.
    fs.writeFileSync(path.join(notes, "huge.md"), "");
    fs.truncateSync(path.join(notes, "huge.md"), 6 * 1024 * 1024);
    fs.chmodSync(path.join(notes, "huge.md"), 0o000);
    fs.writeFileSync(path.join(root, "cover.png"), "");
    fs.truncateSync(path.join(root, "cover.png"), 20 * 1024 * 1024);
    // Another project, which no command walks into, with a folder no one
    // can read.
    writeMarkdown(path.join(root, "sequel", "story.md"), "title: Sequel");
    fs.mkdirSync(path.join(root, "sequel", "locked"));
    fs.chmodSync(path.join(root, "sequel", "locked"), 0o000);
    try {
      const argv = ["rename", "character", "edran-vale", "Edran Vane", "--json"];
      const before = snapshot(path.join(root, "chapters"));
      const preview = invokeJson(root, [...argv, "--dry-run"]);
      expect(preview.code).toBe(0);
      expect(snapshot(path.join(root, "chapters"))).toEqual(before);
      const real = invokeJson(root, argv);
      expect(real.code).toBe(0);
      expect(preview.envelope.data).toEqual({ ...real.envelope.data, dryRun: true });

      fs.chmodSync(path.join(root, "characters"), 0o555);
      const refusedPreview = invoke(root, ["rename", "character", "edran-vane", "Edran Vale", "--dry-run"]);
      const refused = invoke(root, ["rename", "character", "edran-vane", "Edran Vale"]);
      expect(refused.code).toBe(4);
      expect(refusedPreview.code).toBe(4);
      expect(refusedPreview.err).toBe(refused.err);
    } finally {
      fs.chmodSync(path.join(root, "characters"), 0o755);
      fs.chmodSync(path.join(root, "sequel", "locked"), 0o755);
      fs.chmodSync(path.join(notes, "huge.md"), 0o644);
    }
  });

  test("a dry run in a series book sees its linked books, as the real run does, and writes none of them", () => {
    const parent = makeTempDir();
    for (const name of ["the-last-ember", "the-fall-of-the-citadel", "the-unraveled-thread"]) {
      fs.cpSync(path.join(examplesRoot, name), path.join(parent, name), { recursive: true });
    }
    const root = path.join(parent, "the-last-ember");
    const sibling = path.join(parent, "the-fall-of-the-citadel");
    const siblingBefore = snapshot(sibling);

    const fixPreview = invokeJson(root, ["doctor", "--fix", "--dry-run", "--json"]);
    const fixReal = invokeJson(root, ["doctor", "--fix", "--json"]);
    expect(fixPreview.code).toBe(fixReal.code);
    expect(fixPreview.envelope.data.links).toEqual(fixReal.envelope.data.links);
    expect(fixPreview.envelope.data.validation).toEqual(fixReal.envelope.data.validation);
    expect(fixPreview.envelope.diagnostics).toEqual(fixReal.envelope.diagnostics);

    // kael-voss is also defined in the linked book, so both runs warn.
    const argv = ["rename", "character", "kael-voss", "Kael Vane", "--json"];
    const renamePreview = invokeJson(root, [...argv, "--dry-run"]);
    const renameReal = invokeJson(root, argv);
    expect(renamePreview.code).toBe(renameReal.code);
    expect(renameReal.envelope.diagnostics.map((entry) => entry.code)).toContain("linked-book-id");
    expect(renamePreview.envelope.diagnostics).toEqual(renameReal.envelope.diagnostics);
    expect(renamePreview.envelope.data).toEqual({ ...renameReal.envelope.data, dryRun: true });
    expect(snapshot(sibling)).toEqual(siblingBefore);

    // Only linked books are copied beside the project; the copies are
    // scratch files, so a write to one leaves the real book alone.
    const { result } = previewChanges(root, (copy) => {
      fs.writeFileSync(path.join(path.dirname(copy), "the-fall-of-the-citadel", "story.md"), "changed");
      return fs.readdirSync(path.dirname(copy)).sort();
    });
    expect(result).toEqual(["the-fall-of-the-citadel", "the-last-ember"]);
    expect(snapshot(sibling)).toEqual(siblingBefore);
  });

  test("a dry run copies only sibling books, keeps a symlinked sibling a symlink, and skips missing or unparsable ones", () => {
    const parent = makeTempDir();
    for (const name of ["the-last-ember", "the-fall-of-the-citadel"]) {
      fs.cpSync(path.join(examplesRoot, name), path.join(parent, name), { recursive: true });
    }
    const root = path.join(parent, "the-last-ember");
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace("  - ../the-fall-of-the-citadel\n",
      "  - ../alias\n  - ../broken\n  - ../missing\n  - ../dangling\n  - ../../elsewhere\n"));
    fs.symlinkSync("the-fall-of-the-citadel", path.join(parent, "alias"));
    fs.symlinkSync("nowhere", path.join(parent, "dangling"));
    fs.mkdirSync(path.join(parent, "broken"));
    fs.writeFileSync(path.join(parent, "broken", "story.md"), "---\ntitle: [\n---\n");

    const { result } = previewChanges(root, (copy) => {
      const scratch = path.dirname(copy);
      return { books: fs.readdirSync(scratch).sort(), alias: fs.readlinkSync(path.join(scratch, "alias")) };
    });
    expect(result).toEqual({ books: ["alias", "broken", "the-fall-of-the-citadel", "the-last-ember"], alias: "the-fall-of-the-citadel" });

    const preview = invokeJson(root, ["doctor", "--fix", "--dry-run", "--json"]);
    const real = invokeJson(root, ["doctor", "--fix", "--json"]);
    expect(preview.code).toBe(real.code);
    expect(preview.envelope.data.links).toEqual(real.envelope.data.links);
  });

  test("wordcount --dry-run needs --write, and story.md cannot default it", () => {
    const root = copyExample("the-unraveled-thread");
    const usage = invoke(root, ["wordcount", "--dry-run"]);
    expect(usage.code).toBe(2);
    expect(usage.err).toContain("--dry-run previews wordcount --write");

    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^---\n/, "---\ncli-defaults:\n  - command: reindex\n    dry-run: true\n"));
    const refused = invoke(root, ["validate"]);
    expect(refused.err).toContain("sets dry-run, which would stop the command changing anything");
  });

  test("a dry run copies symlinks and read-only folders without touching the project", () => {
    if (process.getuid?.() === 0) {
      return;
    }
    const root = copyExample("the-unraveled-thread");
    const notes = path.join(root, "notes");
    writeMarkdown(path.join(notes, "frozen", "note.md"), "type: note", "edran-vale\n");
    fs.symlinkSync(path.join(root, "characters", "edran-vale.md"), path.join(notes, "absolute-link.md"));
    fs.symlinkSync("../characters/edran-vale.md", path.join(notes, "relative-link.md"));
    fs.symlinkSync(path.join(makeTempDir(), "missing.md"), path.join(notes, "dangling-link.md"));
    fs.writeFileSync(path.join(notes, "secret.txt"), "private");
    fs.chmodSync(path.join(notes, "secret.txt"), 0o000);
    fs.chmodSync(path.join(notes, "frozen"), 0o555);
    const scratch = makeTempDir();
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = scratch;
    try {
      const before = snapshot(root);
      const preview = invoke(root, ["remove", "character", "nessa-thorn", "--dry-run"]);
      expect(preview.code).toBe(0);
      expect(snapshot(root)).toEqual(before);
      expect(fs.readdirSync(scratch)).toEqual([]);

      // In the copy, an absolute link into the project points into the copy;
      // other links are copied as they are, and an unreadable file stays so.
      const { result } = previewChanges(root, (copy) => ({
        absolute: fs.readlinkSync(path.join(copy, "notes", "absolute-link.md")).startsWith(`${copy}${path.sep}`),
        relative: fs.readlinkSync(path.join(copy, "notes", "relative-link.md")),
        dangling: fs.existsSync(path.join(copy, "notes", "dangling-link.md")),
        secret: (fs.statSync(path.join(copy, "notes", "secret.txt")).mode & 0o777).toString(8)
      }));
      expect(result).toEqual({ absolute: true, relative: "../characters/edran-vale.md", dangling: false, secret: "0" });

      let thrown;
      try {
        previewChanges(root, () => {
          throw "not an error object";
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe("not an error object");
      expect(fs.readdirSync(scratch)).toEqual([]);
    } finally {
      fs.chmodSync(path.join(root, "notes", "frozen"), 0o755);
      if (previous === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = previous;
      }
    }
  });
});


// writeFile and removeFile are the helpers every write command uses.
function writeAndRemove(root) {
  writeFile(path.join(root, "notes", "new.md"), "new", { root });
  writeFile(path.join(root, "notes", "gone.md"), "gone", { root });
  removeFile(path.join(root, "notes", "gone.md"));
  removeFile(path.join(root, "kept.md"));
}


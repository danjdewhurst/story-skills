import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { recordChanges, removeFile, writeFile } from "../src/files.js";
import { LOCK_FILE } from "../src/lock.js";
import { previewChanges } from "../src/preview.js";
import { createEntity } from "../src/story.js";
import { MAX_SERIES_BOOKS } from "../src/series.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { CHMOD_IGNORED, otherLivePid, makeTempDir, memoryIo, treeDiff as diff, treeSnapshot as snapshot, writeMarkdown } from "./helpers.js";

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

// Commands run on a copy of the-unraveled-thread. `prepare` edits the copy
// first, so the command has something to do.
const CASES = [
  { argv: ["rename", "character", "edran-vale", "Edran Vane"] },
  { argv: ["rename", "character", "edran-vale", "Edran Vane", "--prose"] },
  { argv: ["remove", "character", "jonas-reed"] },
  { argv: ["move", "chapter", "chapter-01", "--number", "9"] },
  { argv: ["move", "scene", "chapter-01-scene-01", "--chapter", "chapter-02"] },
  {
    argv: ["split", "chapter-02", "--at", "The constable came at dusk."],
    // The example's state learns something in chapter-05, which has no file:
    // split refuses to renumber chapter-04 onto it, so it names chapter-04.
    prepare: (root) => {
      fs.appendFileSync(path.join(root, "chapters", "chapter-02.md"), "\n\n* * *\n\nThe constable came at dusk.\n");
      const state = path.join(root, "continuity", "state.md");
      fs.writeFileSync(state, fs.readFileSync(state, "utf8").replace("learned-in: chapter-05", "learned-in: chapter-04"));
    }
  },
  { argv: ["merge", "chapter-02", "chapter-03"] },
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

  test("a split refused under --dry-run exits 4 with no preview and writes nothing", () => {
    // The example's state learns something in chapter-05, which has no file.
    const root = copyExample("the-unraveled-thread");
    fs.appendFileSync(path.join(root, "chapters", "chapter-02.md"), "\n\n* * *\n\nThe constable came at dusk.\n");
    const before = snapshot(root);
    const text = invoke(root, ["split", "chapter-02", "--at", "1", "--dry-run"]);
    expect(text.code).toBe(4);
    expect(text.out).toBe("");
    expect(text.err).toContain("continuity/state.md names chapter-05, which has no file yet, and this split would renumber chapter-04 to chapter-05");
    const json = invokeJson(root, ["split", "chapter-02", "--at", "1", "--dry-run", "--json"]);
    expect(json.code).toBe(4);
    expect(json.envelope).toMatchObject({ ok: false, data: null, writes: [] });
    expect(json.envelope.diagnostics.map((entry) => entry.code)).toEqual(["write-refused"]);
    expect(snapshot(root)).toEqual(before);
  });

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

  // On a schema-version 1 copy: reindex fills the clue ledger migrate has
  // just created, and glossary/terms is made with its parent folder. With
  // nothing missing, the one change is story.md.
  for (const [missing, changes] of [[null, "1 change"], ["continuity/clues/_index.md", "2 changes"], ["glossary", "4 changes"]]) {
    test(`story migrate prints the count its dry run gives, with ${missing ?? "nothing"} missing`, () => {
      const root = copyExample("the-unraveled-thread");
      const story = path.join(root, "story.md");
      fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace("schema-version: 2", "schema-version: 1"));
      if (missing !== null) {
        fs.rmSync(path.join(root, missing), { recursive: true });
      }
      expect(invoke(root, ["migrate", "--dry-run"]).out).toEndWith(`Dry run: story migrate would make ${changes}; nothing was written\n`);
      expect(invoke(root, ["migrate"]).out).toBe(`Migrated project to current schema: ${changes}\n`);
    });
  }

  test("a dry run neither takes nor waits for the project lock", () => {
    const root = copyExample("the-unraveled-thread");
    // A live command holds the lock.
    const lock = `${otherLivePid()}\n${os.hostname()}\n${new Date().toISOString()}\n`;
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
      if (!CHMOD_IGNORED) {
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
    if (CHMOD_IGNORED) {
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

  test("a dry run checks the cover's first bytes as the real run does, and copies no other file's bytes", () => {
    const root = copyExample("the-unraveled-thread");
    const storyPath = path.join(root, "story.md");
    const story = fs.readFileSync(storyPath, "utf8");
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
    // A PNG, a WebP (its type is in bytes 8 to 11), a review copy saved over
    // the cover, and a cover this user cannot read.
    const covers = [
      ["cover.png", Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), null],
      ["cover.webp", webp, null],
      ["cover.png", Buffer.from("<!DOCTYPE html>\n"), "story.md cover cover.png does not hold a PNG image: its first bytes are not the PNG signature"],
      ...(CHMOD_IGNORED ? [] : [["cover.png", Buffer.from("89504e470d0a1a0a", "hex"), "story.md cover cover.png: Cannot read: permission denied"]])
    ];
    for (const [name, bytes, error] of covers) {
      fs.writeFileSync(storyPath, story.replace("schema-version: 2\n", `schema-version: 2\ncover: ${name}\n`));
      fs.rmSync(path.join(root, name), { force: true });
      fs.writeFileSync(path.join(root, name), bytes);
      if (error?.includes("permission denied")) {
        fs.chmodSync(path.join(root, name), 0o000);
      }
      try {
        const preview = invokeJson(root, ["doctor", "--fix", "--dry-run", "--json"]);
        const real = invokeJson(root, ["doctor", "--fix", "--json"]);
        expect(real.envelope.diagnostics.filter((finding) => finding.code === "invalid-cover").map((finding) => finding.message)).toEqual(error === null ? [] : [error]);
        expect(preview.envelope.data.checks).toEqual(real.envelope.data.checks);
        expect(preview.envelope.diagnostics).toEqual(real.envelope.diagnostics);
      } finally {
        fs.chmodSync(path.join(root, name), 0o644);
      }
    }
    // Only the cover keeps its first bytes in the scratch copy.
    fs.writeFileSync(storyPath, story.replace("schema-version: 2\n", "schema-version: 2\ncover: cover.webp\n"));
    fs.writeFileSync(path.join(root, ".env"), "API_KEY=secret\n");
    fs.writeFileSync(path.join(root, "notes.txt"), "private notes\n");
    const copied = previewChanges(root, (copyRoot) => ["cover.webp", ".env", "notes.txt"].map((file) => fs.readFileSync(path.join(copyRoot, file)).toString("hex"))).result;
    expect(copied).toEqual([
      Buffer.concat([webp.subarray(0, 12), Buffer.alloc(webp.length - 12)]).toString("hex"),
      Buffer.alloc(15).toString("hex"),
      Buffer.alloc(14).toString("hex")
    ]);
  });

  test("a dry run of import onto a FIFO answers as the real run, without reading it", () => {
    if (process.platform === "win32") {
      return;
    }
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "draft.md"), "# Chapter 1\n\nText.\n");
    expect(spawnSync("mkfifo", [path.join(cwd, "pipe")]).status).toBe(0);
    const argv = ["import", "draft.md", "--title", "Piped", "--dir", "pipe", "--force"];
    const real = invoke(cwd, argv);
    const preview = invoke(cwd, [...argv, "--dry-run"]);
    expect(real.code).not.toBe(0);
    expect([preview.code, preview.err]).toEqual([real.code, real.err]);
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
    expect(fixPreview.code).toBe(0);
    expect(fixPreview.code).toBe(fixReal.code);
    expect(fixPreview.envelope.data.checks).toEqual(fixReal.envelope.data.checks);
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

  test("a dry run finds linked books through symlinks and outside the parent folder as the real run does", () => {
    const parent = makeTempDir();
    for (const name of ["the-last-ember", "the-fall-of-the-citadel"]) {
      fs.cpSync(path.join(examplesRoot, name), path.join(parent, name), { recursive: true });
    }
    const root = path.join(parent, "the-last-ember");
    const far = path.join(makeTempDir(), "far-book");
    writeMarkdown(path.join(far, "story.md"), "title: Far Book\nseries: the-ember-cycle");
    const story = path.join(root, "story.md");
    const links = ["../alias", "../far-alias", path.relative(root, far), "../broken", "../missing", "../dangling", "../../.."];
    fs.writeFileSync(story, fs.readFileSync(story, "utf8")
      .replace("  - ../the-fall-of-the-citadel\n", links.map((link) => `  - ${link}\n`).join("")));
    fs.symlinkSync("the-fall-of-the-citadel", path.join(parent, "alias"));
    fs.symlinkSync(far, path.join(parent, "far-alias"));
    fs.symlinkSync("nowhere", path.join(parent, "dangling"));
    writeMarkdown(path.join(parent, "broken", "story.md"), "title: [");
    const sibling = path.join(parent, "the-fall-of-the-citadel");
    const siblingBefore = snapshot(sibling);
    const farBefore = snapshot(far);

    const doctor = (cwd) => {
      const preview = invokeJson(cwd, ["doctor", "--fix", "--dry-run", "--json"]);
      const real = invokeJson(cwd, ["doctor", "--fix", "--json"]);
      expect(preview.code).toBe(real.code);
      expect(preview.envelope.data.checks).toEqual(real.envelope.data.checks);
      expect(preview.envelope.diagnostics).toEqual(real.envelope.diagnostics);
      return real.envelope.diagnostics.map((entry) => entry.code);
    };
    const codes = doctor(root);
    expect(codes).toContain("series-link-not-sibling");
    expect(codes).toContain("series-link-not-project");
    expect(snapshot(far)).toEqual(farBefore);

    // The project opened through a symlink: the linked book's backlink to
    // the real folder name still finds it.
    fs.writeFileSync(story, fs.readFileSync(path.join(examplesRoot, "the-last-ember", "story.md")));
    fs.symlinkSync("the-last-ember", path.join(parent, "ember-alias"));
    expect(doctor(path.join(parent, "ember-alias"))).not.toContain("series-missing-backlink");
    expect(snapshot(sibling)).toEqual(siblingBefore);
  });

  test("a dry run reports links outside the project, into linked books, and inside it as the real run does", () => {
    const parent = makeTempDir();
    for (const name of ["the-last-ember", "the-fall-of-the-citadel"]) {
      fs.cpSync(path.join(examplesRoot, name), path.join(parent, name), { recursive: true });
    }
    const root = path.join(parent, "the-last-ember");
    const sibling = path.join(parent, "the-fall-of-the-citadel");
    fs.writeFileSync(path.join(parent, "notes.md"), "# Notes\n");
    fs.mkdirSync(path.join(parent, "folder.md"));
    writeMarkdown(path.join(parent, "drafts", "old", "chapter-one.md"), "title: Old");
    // Files of the linked book that a dry run does not copy: build output,
    // and a project nested inside it.
    fs.mkdirSync(path.join(sibling, "dist"));
    fs.writeFileSync(path.join(sibling, "dist", "recap.md"), "# Recap\n");
    writeMarkdown(path.join(sibling, "spin-off", "story.md"), "title: Spin Off");
    fs.writeFileSync(path.join(sibling, "spin-off", "notes.md"), "# Notes\n");
    fs.symlinkSync(path.join(parent, "notes.md"), path.join(parent, "notes-link.md"));
    fs.symlinkSync(path.join(parent, "nowhere.md"), path.join(parent, "dangling.md"));
    // In-project symlinks that lead outside it, to a file and a folder.
    fs.symlinkSync(path.join("..", "..", "notes.md"), path.join(root, "plot", "outside.md"));
    fs.symlinkSync(path.join("..", "drafts"), path.join(root, "drafts"), "dir");
    fs.symlinkSync("loop.md", path.join(parent, "loop.md"));
    const links = [
      "../../notes.md",
      "../../gone.md",
      "../../folder.md",
      "../../notes-link.md",
      "../../drafts/old/chapter-one.md",
      "../../drafts/new/chapter-two.md",
      "../../the-fall-of-the-citadel/characters/king-aldric.md",
      "../../the-fall-of-the-citadel/characters/nobody.md",
      "../../the-fall-of-the-citadel/dist/recap.md",
      "../../the-fall-of-the-citadel/spin-off/notes.md",
      "../characters/sera-voss.md",
      "../characters/nobody.md",
      "../../dangling.md",
      "outside.md",
      "../drafts/old/chapter-one.md",
      "../../loop.md",
      `${"../".repeat(64)}notes.md`
    ];
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), `\n${links.map((link, index) => `[link ${index}](${link})`).join("\n")}\n`);
    fs.appendFileSync(path.join(root, "matter", "epigraph.md"), "\n[notes](../../notes.md)\n");
    const arc = `plot/arcs/${fs.readdirSync(path.join(root, "plot", "arcs")).find((name) => name !== "_index.md")}`;
    fs.appendFileSync(path.join(root, arc), "\n[notes](../../../notes.md)\n");
    // A read-only linked book: the stand-in for its dist/ is made anyway.
    // An unreadable matter page is reported, and its links are not.
    const unreadable = path.join(root, "matter", "credits.md");
    writeMarkdown(unreadable, "title: Credits\nplacement: back", "[notes](../../notes.md)\n");
    if (!CHMOD_IGNORED) {
      fs.chmodSync(sibling, 0o555);
      fs.chmodSync(unreadable, 0o000);
    }

    const parity = (argv) => {
      const preview = invokeJson(root, [...argv, "--dry-run", "--json"]);
      const real = invokeJson(root, [...argv, "--json"]);
      expect(preview.code).toBe(real.code);
      expect(preview.envelope.diagnostics).toEqual(real.envelope.diagnostics);
      return real.envelope.diagnostics;
    };
    const findings = parity(["doctor", "--fix"])
      .filter((entry) => /link/.test(entry.code) && entry.file !== "matter/credits.md")
      .map((entry) => `${entry.code} ${entry.message}`);
    const outside = (file, link) => `link-outside-project ${file} links to ${link} which resolves outside the project`;
    const missing = (link) => `broken-link plot/timeline.md links to missing file ${link}`;
    expect(findings.sort()).toEqual([
      outside("plot/timeline.md", links[0]),
      missing(links[1]),
      outside("plot/timeline.md", links[2]),
      outside("plot/timeline.md", links[3]),
      outside("plot/timeline.md", links[4]),
      missing(links[5]),
      missing(links[7]),
      missing(links[11]),
      missing(links[12]),
      outside("plot/timeline.md", links[13]),
      outside("plot/timeline.md", links[14]),
      outside(arc, "../../../notes.md"),
      missing(links[15]),
      missing(links[16]),
      outside("matter/epigraph.md", "../../notes.md")
    ].sort());
    parity(["rename", "character", "sera-voss", "Sera Vane"]);
    fs.chmodSync(sibling, 0o755);
    // The preview made nothing beside the project.
    expect(fs.readdirSync(parent).sort()).toEqual(["dangling.md", "drafts", "folder.md", "loop.md", "notes-link.md", "notes.md", "the-fall-of-the-citadel", "the-last-ember"]);
  });

  test("a dry run copies no more linked books than the series book limit", () => {
    const parent = makeTempDir();
    for (let index = 0; index < MAX_SERIES_BOOKS + 3; index += 1) {
      writeMarkdown(path.join(parent, `book-${index}`, "story.md"), `title: Book ${index}\nprecedes: ../book-${index + 1}`);
    }
    const { result } = previewChanges(path.join(parent, "book-0"), (copy) => fs.readdirSync(path.dirname(copy)).length);
    expect(result).toBe(MAX_SERIES_BOOKS + 1);
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
    if (CHMOD_IGNORED) {
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


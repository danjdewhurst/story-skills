import { describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { LOCK_FILE } from "../src/lock.js";
import { createEntity, createStoryProject } from "../src/story.js";
import { listSnapshots, nextSnapshotId, planRestore, restoreSnapshot, snapshotId, snapshotProject } from "../src/snapshots.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { CHMOD_IGNORED, git, makeTempDir, memoryIo, treeSnapshot, whileWriting, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

// Whether the temp folder's file system ignores letter case, as macOS and
// Windows do by default: the tests that rename a file only in case run on
// those CI jobs.
const IGNORES_CASE = (() => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "probe.md"), "");
  return fs.existsSync(path.join(dir, "PROBE.MD"));
})();

// Renames a file or folder to another letter case through a third name,
// since some file systems that ignore case (vfat on Linux) keep the old
// spelling on a rename straight to the new one.
function renameCase(from, to) {
  fs.renameSync(from, `${to}.renaming`);
  fs.renameSync(`${to}.renaming`, to);
}

// The device and inode a lookup of `file` finds, or null.
function identity(file) {
  const stats = fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });
  return stats === undefined ? null : `${stats.dev}:${stats.ino}`;
}

// A file identity as a folder that ignores letter case gives it, on any file
// system: each part of `file` below `root` is found in its folder in any
// case. Injected into a restore, it stands in for macOS or Windows.
function caseless(root) {
  return (file) => {
    let found = root;
    for (const part of path.relative(root, file).split(path.sep)) {
      const names = fs.lstatSync(found, { throwIfNoEntry: false })?.isDirectory() ? fs.readdirSync(found) : [];
      const name = names.includes(part) ? part : names.find((entry) => entry.toLowerCase() === part.toLowerCase());
      if (name === undefined) {
        return null;
      }
      found = path.join(found, name);
    }
    return identity(found);
  };
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function writeChapter(root, number, body) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft`, `## Chapter Text\n\n${body}\n`);
}

function project() {
  const cwd = makeTempDir();
  const root = path.join(cwd, "book");
  createStoryProject({ cwd, title: "Snapshot Story", dir: root });
  createEntity(root, { kind: "character", name: "Ada Quill" });
  writeChapter(root, 1, "First paragraph.\n\nSecond paragraph.");
  writeChapter(root, 2, "Cut me later.");
  invoke(cwd, ["reindex", root]);
  invoke(cwd, ["wordcount", root, "--write"]);
  return { cwd, root };
}

// The --json result, checked against the result schema.
function json(result) {
  const envelope = JSON.parse(result.out);
  expect(validateAgainstSchema(envelope, schema)).toEqual([]);
  return envelope;
}

describe("story snapshot", () => {
  test("copies the project's markdown to .snapshots/<id>/ with a manifest", () => {
    const { cwd, root } = project();
    fs.mkdirSync(path.join(root, "dist"));
    fs.writeFileSync(path.join(root, "dist", "book.md"), "built\n");
    const result = invoke(cwd, ["snapshot", "Before Line Edit", "--path", root]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("Saved snapshot before-line-edit in .snapshots/before-line-edit/ (2 chapters, 7 words; 16 files)\nCompare with it later: story compare --snapshot before-line-edit\n");
    const dir = path.join(root, ".snapshots", "before-line-edit");
    expect(fs.readFileSync(path.join(dir, "chapters", "chapter-01.md"), "utf8")).toBe(fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8"));
    expect(fs.existsSync(path.join(dir, "story.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "characters", "ada-quill.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "dist"))).toBe(false);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "snapshot.json"), "utf8"));
    expect(manifest).toMatchObject({ name: "Before Line Edit", id: "before-line-edit", chapters: 2, words: 7, files: 16 });
    expect(Number.isNaN(Date.parse(manifest.created))).toBe(false);
  });

  test("refuses to overwrite a snapshot without --force, and --force replaces it whole", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["snapshot", "draft", "--path", root]).code).toBe(0);
    const refused = invoke(cwd, ["snapshot", "Draft", "--path", root]);
    expect(refused.code).toBe(4);
    expect(refused.err).toContain("Snapshot draft already exists in .snapshots/draft: choose another name, or add --force to replace it");

    fs.rmSync(path.join(root, "chapters", "chapter-02.md"));
    invoke(cwd, ["reindex", root]);
    const preview = invoke(cwd, ["snapshot", "draft", "--force", "--dry-run", "--path", root]);
    expect(preview.code).toBe(0);
    expect(preview.out).toContain("delete  .snapshots/draft/chapters/chapter-02.md\n");
    expect(preview.out).toContain("update  .snapshots/draft/chapters/chapter-01.md\n");
    expect(fs.existsSync(path.join(root, ".snapshots", "draft", "chapters", "chapter-02.md"))).toBe(true);

    const replaced = invoke(cwd, ["snapshot", "draft", "--force", "--path", root]);
    expect(replaced.code).toBe(0);
    expect(replaced.out).toStartWith("Replaced snapshot draft");
    expect(fs.existsSync(path.join(root, ".snapshots", "draft", "chapters", "chapter-02.md"))).toBe(false);
  });

  test("--dry-run writes nothing and refuses a taken name as the real run does", () => {
    const { cwd, root } = project();
    const preview = invoke(cwd, ["snapshot", "one", "--dry-run", "--json", "--path", root]);
    expect(preview.code).toBe(0);
    const data = json(preview).data;
    expect(data.dryRun).toBe(true);
    expect(data.changes).toContainEqual({ action: "create", path: ".snapshots/one/snapshot.json" });
    expect(fs.existsSync(path.join(root, ".snapshots"))).toBe(false);

    invoke(cwd, ["snapshot", "one", "--path", root]);
    expect(invoke(cwd, ["snapshot", "one", "--dry-run", "--path", root]).code).toBe(4);
  });

  test("--list shows every snapshot, oldest first, as text and JSON", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["snapshot", "--list", "--path", root]).out).toBe("No snapshots yet: story snapshot <name> takes one\n");
    snapshotProject(root, { name: "Second Draft", now: new Date("2026-02-01T09:30:00Z") });
    snapshotProject(root, { name: "first", now: new Date("2026-01-01T08:00:00Z") });
    const listed = invoke(cwd, ["snapshot", "--list", "--path", root]);
    expect(listed.code).toBe(0);
    expect(listed.out).toBe("Snapshots: 2\n\n- first: 2026-01-01 08:00 UTC, 2 chapters, 7 words\n- second-draft (Second Draft): 2026-02-01 09:30 UTC, 2 chapters, 7 words\n");
    const data = json(invoke(cwd, ["snapshot", "--list", "--json", "--path", root])).data;
    expect(data.snapshots.map((snapshot) => snapshot.id)).toEqual(["first", "second-draft"]);
    // A folder without a manifest is listed by name.
    fs.mkdirSync(path.join(root, ".snapshots", "by-hand"));
    expect(listSnapshots(root).snapshots.at(-1)).toEqual({ name: "by-hand", id: "by-hand", created: null, chapters: null, words: null });
  });

  test("a project counted in characters records its characters too, and --force drops emptied folders", () => {
    const { cwd, root } = project();
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^---\n/, "---\ncount-unit: characters\n"), "utf8");
    writeMarkdown(path.join(root, "notes", "deep", "idea.md"), "title: Idea");
    const taken = json(invoke(cwd, ["snapshot", "chars", "--json", "--path", root])).data;
    expect(taken.characters).toBeGreaterThan(0);
    fs.rmSync(path.join(root, "notes"), { recursive: true });
    const replaced = invoke(cwd, ["snapshot", "chars", "--force", "--path", root]);
    expect(replaced.out).toContain(` characters; `);
    expect(fs.existsSync(path.join(root, ".snapshots", "chars", "notes"))).toBe(false);
    expect(listSnapshots(root).snapshots[0].characters).toBe(taken.characters);
  });

  test("a failed --force leaves the old snapshot as it was, and a failed first snapshot leaves nothing", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["snapshot", "draft", "--path", root]).code).toBe(0);
    const dir = path.join(root, ".snapshots", "draft");
    const manifest = fs.readFileSync(path.join(dir, "snapshot.json"), "utf8");
    fs.rmSync(path.join(root, "chapters", "chapter-02.md"));
    invoke(cwd, ["reindex", root]);
    writeChapter(root, 1, "Rewritten.");
    // Sorted after chapters/, so the copy fails part way through.
    fs.mkdirSync(path.join(root, "notes"));
    fs.writeFileSync(path.join(root, "notes", "latin1.md"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    const failed = invoke(cwd, ["snapshot", "draft", "--force", "--path", root]);
    expect(failed.code).toBe(3);
    expect(failed.err).toContain("is not valid UTF-8");
    expect(fs.readFileSync(path.join(dir, "snapshot.json"), "utf8")).toBe(manifest);
    expect(fs.existsSync(path.join(dir, "chapters", "chapter-02.md"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "chapters", "chapter-01.md"), "utf8")).toContain("First paragraph.");
    expect(fs.readdirSync(path.join(root, ".snapshots")).sort()).toEqual([".gitignore", "draft"]);

    expect(invoke(cwd, ["snapshot", "fresh", "--path", root]).code).toBe(3);
    expect(fs.readdirSync(path.join(root, ".snapshots")).sort()).toEqual([".gitignore", "draft"]);
  });

  test("keeps each file's permissions, and keeps .snapshots/ out of git unless its .gitignore is deleted", () => {
    const { cwd, root } = project();
    const notes = path.join(root, "research", "private.md");
    writeMarkdown(notes, "title: Private");
    fs.appendFileSync(path.join(root, ".gitignore"), "research/private.md\n");
    const chapter = path.join(root, "chapters", "chapter-01.md");
    if (!CHMOD_IGNORED) {
      fs.chmodSync(notes, 0o600);
      fs.chmodSync(chapter, 0o640);
      fs.chmodSync(path.join(root, "chapters", "chapter-02.md"), 0o444);
    }
    expect(invoke(cwd, ["snapshot", "draft", "--path", root]).code).toBe(0);
    const dir = path.join(root, ".snapshots", "draft");
    if (!CHMOD_IGNORED) {
      expect(fs.statSync(path.join(dir, "research", "private.md")).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.join(dir, "chapters", "chapter-01.md")).mode & 0o777).toBe(0o640);
      // Read-only for everyone, but its owner can replace it.
      expect(fs.statSync(path.join(dir, "chapters", "chapter-02.md")).mode & 0o777).toBe(0o644);
      fs.chmodSync(notes, 0o640);
      expect(invoke(cwd, ["snapshot", "draft", "--force", "--path", root]).code).toBe(0);
      expect(fs.statSync(path.join(dir, "research", "private.md")).mode & 0o777).toBe(0o640);
    }
    const ignore = path.join(root, ".snapshots", ".gitignore");
    expect(fs.readFileSync(ignore, "utf8")).toBe("# Snapshots copy every markdown file, including ones git ignores, so git\n# ignores them. Delete this file to commit your snapshots.\n*\n");
    git(root, "init", "-q");
    git(root, "add", "-A", "--", ".");
    const tracked = git(root, "ls-files");
    expect(tracked).toContain("chapters/chapter-01.md");
    expect(tracked).not.toContain("private.md");
    expect(tracked).not.toContain(".snapshots");
    // A .snapshots/ that is already there is left as the writer keeps it.
    fs.rmSync(ignore);
    expect(invoke(cwd, ["snapshot", "second", "--path", root]).code).toBe(0);
    expect(fs.existsSync(ignore)).toBe(false);
  });

  test("numbers a command's own snapshot past the highest taken, reading only a real .snapshots/", () => {
    const { root } = project();
    const folder = path.join(root, ".snapshots");
    expect(nextSnapshotId(root, "before-import-")).toBe("before-import-1");
    // 15 digits count; a longer number is passed over, but not its name.
    for (const name of ["before-import-2", "before-import-09", "before-import-x", "before-import-999999999999999", "before-import-1000000000000000", "before-import-99999999999999999999999", "before-restore-a-7"]) {
      fs.mkdirSync(path.join(folder, name), { recursive: true });
    }
    expect(nextSnapshotId(root, "before-import-")).toBe("before-import-1000000000000001");
    expect(nextSnapshotId(root, "before-restore-a-")).toBe("before-restore-a-8");
    const outside = makeTempDir();
    fs.mkdirSync(path.join(outside, "before-import-5"));
    fs.rmSync(folder, { recursive: true });
    fs.symlinkSync(outside, folder, "junction");
    expect(nextSnapshotId(root, "before-import-")).toBe("before-import-1");
    fs.rmSync(folder);
    fs.writeFileSync(folder, "");
    expect(nextSnapshotId(root, "before-import-")).toBe("before-import-1");
  });

  test("a name in a script with no folder spelling needs --id, and compare finds it by name or id", () => {
    const { cwd, root } = project();
    const refused = invoke(cwd, ["snapshot", "初稿 v2", "--path", root]);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("Snapshot name 初稿 v2 has letters a folder name cannot spell (初稿): add --id <kebab-id>");
    expect(invoke(cwd, ["snapshot", "初稿", "--id", "Bad Id", "--path", root]).err).toContain("Snapshot --id must be kebab-case");
    expect(invoke(cwd, ["snapshot", "初稿 v2", "--id", "first-draft", "--path", root]).code).toBe(0);
    expect(listSnapshots(root).snapshots[0]).toMatchObject({ name: "初稿 v2", id: "first-draft" });
    // Cyrillic is transliterated, and the Ukrainian apostrophe is dropped.
    expect(snapshotId("Мʼята")).toBe("myata");
    expect(invoke(cwd, ["compare", root, "--snapshot", "初稿 v2"]).out).toContain("Compared with snapshot first-draft\n");
    expect(invoke(cwd, ["compare", root, "--snapshot", "first-draft"]).code).toBe(0);
    expect(invoke(cwd, ["compare", root, "--snapshot", "改稿"]).err).toContain("No snapshot named 改稿: story snapshot --list shows them: first-draft");
    expect(invoke(cwd, ["snapshot", "--list", "--id", "x", "--path", root]).err).toContain("--id does not apply to story snapshot --list");
  });

  test("rejects a missing or unusable name and misplaced flags", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["snapshot", "--path", root]).code).toBe(2);
    expect(invoke(cwd, ["snapshot", " ", "--path", root]).err).toContain("story snapshot needs a name");
    expect(() => snapshotId("!!!")).toThrow("has no letters or digits");
    expect(invoke(cwd, ["snapshot", "x", "--list", "--path", root]).err).toContain("--list takes no name");
    expect(invoke(cwd, ["snapshot", "--list", "--force", "--path", root]).err).toContain("--force does not apply to story snapshot --list");
  });
});

describe("a project with snapshots", () => {
  test("checks, registries, word counts, and builds ignore .snapshots/", () => {
    const { cwd, root } = project();
    const before = {
      check: invoke(cwd, ["check", root, "--json"]),
      wordcount: json(invoke(cwd, ["wordcount", root, "--json"])).data,
      export: invoke(cwd, ["export", root, "--out", "dist/before.md"])
    };
    expect(json(before.check).ok).toBe(true);
    snapshotProject(root, { name: "draft" });
    // A snapshot of a later draft holds a chapter the project lacks.
    writeChapter(path.join(root, ".snapshots", "draft"), 3, "Only in the snapshot.");

    const check = json(invoke(cwd, ["check", root, "--json"]));
    expect(check.ok).toBe(true);
    expect(check.diagnostics).toEqual(json(before.check).diagnostics);
    expect(json(invoke(cwd, ["wordcount", root, "--json"])).data).toEqual(before.wordcount);
    const reindex = json(invoke(cwd, ["reindex", root, "--json"]));
    expect(reindex.data.changes).toEqual([]);
    invoke(cwd, ["export", root, "--out", "dist/after.md"]);
    expect(fs.readFileSync(path.join(root, "dist", "after.md"), "utf8")).toBe(fs.readFileSync(path.join(root, "dist", "before.md"), "utf8"));
    // Taking a snapshot never copies an earlier snapshot.
    snapshotProject(root, { name: "later" });
    expect(fs.existsSync(path.join(root, ".snapshots", "later", ".snapshots"))).toBe(false);
  });
});

describe("story compare --snapshot", () => {
  test("compares with a saved snapshot by name", () => {
    const { cwd, root } = project();
    invoke(cwd, ["snapshot", "Draft One", "--path", root]);
    writeChapter(root, 1, "First paragraph.\n\nSecond paragraph, revised and longer.");
    const result = invoke(cwd, ["compare", root, "--snapshot", "draft one"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Compared with snapshot draft-one\n");
    expect(result.out).toContain("- chapter-01 Chapter 1: 4 -> 7 words (+3), 50% of paragraphs unchanged");
    const mapped = invoke(cwd, ["compare", root, "--snapshot", "draft-one", "--anchor", "ch01-p1"]);
    expect(mapped.out).toContain("ch01-p1 -> ch01-p1 (text unchanged)");
  });

  test("names the snapshots there are when one is missing, and needs exactly one source", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["compare", root, "--snapshot", "nope"]).err).toContain("No snapshot named nope: this project has none yet");
    invoke(cwd, ["snapshot", "kept", "--path", root]);
    const missing = invoke(cwd, ["compare", root, "--snapshot", "nope"]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("story snapshot --list shows them: kept");
    expect(invoke(cwd, ["compare", root, "--snapshot", "kept", "--ref", "HEAD"]).err).toContain("exactly one of --ref <git-ref>, --against <project-path>, or --snapshot <name>");
  });

  test("--ref stays a git ref when a snapshot has the same name", () => {
    const { cwd, root } = project();
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "one");
    git(root, "tag", "draft");
    writeChapter(root, 2, "Cut me later, then grow.");
    invoke(cwd, ["snapshot", "draft", "--path", root]);
    writeChapter(root, 2, "Cut me later, then grow again.");
    expect(invoke(cwd, ["compare", root, "--ref", "draft"]).out).toContain("chapter-02 Chapter 2: 3 -> 6 words");
    expect(invoke(cwd, ["compare", root, "--snapshot", "draft"]).out).toContain("chapter-02 Chapter 2: 5 -> 6 words");
  });
});

describe("story snapshot --force", () => {
  test("leaves the snapshot it would replace untouched when the project lock cannot be made (#601)", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["snapshot", "First", "--path", root]).code).toBe(0);
    const folder = path.join(root, ".snapshots", "first");
    const inode = fs.statSync(folder).ino;
    const lockPath = path.join(root, LOCK_FILE);
    const open = fs.openSync;
    const spy = spyOn(fs, "openSync").mockImplementation((file, flags, ...rest) => {
      if (file === lockPath && flags === "wx") {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return open(file, flags, ...rest);
    });
    let result;
    try {
      result = invoke(cwd, ["snapshot", "First", "--force", "--path", root]);
    } finally {
      spy.mockRestore();
    }
    expect(result.code).toBe(4);
    expect(result.err).toContain(`Cannot create the project lock ${LOCK_FILE} (permission denied)`);
    // Not copied aside and put back: the same folder, and no backup left.
    expect(fs.statSync(folder).ino).toBe(inode);
    expect(fs.readdirSync(path.join(root, ".snapshots")).sort()).toEqual([".gitignore", "first"]);
  });
});

describe("story snapshot --restore", () => {
  // The project changed after "Draft One": chapter 1 rewritten, chapter 2
  // deleted, chapter 3 and a note added, plus files a restore never touches.
  function revised() {
    const { cwd, root } = project();
    invoke(cwd, ["snapshot", "Draft One", "--path", root]);
    writeChapter(root, 1, "Rewritten opening.");
    fs.rmSync(path.join(root, "chapters", "chapter-02.md"));
    writeChapter(root, 3, "A new ending.");
    writeMarkdown(path.join(root, "notes", "idea.md"), "title: Idea");
    invoke(cwd, ["reindex", root]);
    fs.mkdirSync(path.join(root, "dist"));
    fs.writeFileSync(path.join(root, "dist", "book.md"), "built\n");
    fs.writeFileSync(path.join(root, "cover.png"), "not markdown\n");
    writeMarkdown(path.join(root, "spinoff", "story.md"), "title: Spinoff");
    return { cwd, root };
  }

  test("saves the project first, writes the snapshot back, and deletes markdown files it lacks", () => {
    const { cwd, root } = revised();
    const result = invoke(cwd, ["snapshot", "--restore", "draft one", "--path", root]);
    expect(result.code).toBe(0);
    expect(result.out).toStartWith("Saved the project as it was in snapshot before-restore-draft-one-1 (.snapshots/before-restore-draft-one-1/)\nRestored snapshot draft-one: 2 updated, 1 created, 2 deleted (not in the snapshot), 1 folder removed (left empty)\n");
    expect(result.out).toContain("  update  chapters/chapter-01.md\n");
    expect(result.out).toContain("  create  chapters/chapter-02.md\n");
    expect(result.out).toContain("  delete  chapters/chapter-03.md\n");
    expect(result.out).toContain("  delete  notes/idea.md\n  rmdir   notes\n");
    expect(result.out).toEndWith("Undo it: story snapshot --restore before-restore-draft-one-1\n");
    const snapshot = path.join(root, ".snapshots", "draft-one");
    for (const file of ["chapters/chapter-01.md", "chapters/chapter-02.md", "chapters/_index.md", "story.md"]) {
      expect(fs.readFileSync(path.join(root, file), "utf8")).toBe(fs.readFileSync(path.join(snapshot, file), "utf8"));
    }
    expect(fs.existsSync(path.join(root, "chapters", "chapter-03.md"))).toBe(false);
    // The folder the restore emptied goes too (#524).
    expect(fs.existsSync(path.join(root, "notes"))).toBe(false);
    // Never touched: builds, assets, nested projects, and the snapshots.
    expect(fs.readFileSync(path.join(root, "dist", "book.md"), "utf8")).toBe("built\n");
    expect(fs.existsSync(path.join(root, "cover.png"))).toBe(true);
    expect(fs.existsSync(path.join(root, "spinoff", "story.md"))).toBe(true);
    expect(fs.existsSync(path.join(snapshot, "chapters", "chapter-03.md"))).toBe(false);
    const safety = path.join(root, ".snapshots", "before-restore-draft-one-1");
    expect(fs.readFileSync(path.join(safety, "chapters", "chapter-03.md"), "utf8")).toContain("A new ending.");
    expect(fs.existsSync(path.join(safety, "spinoff"))).toBe(false);
    expect(json(invoke(cwd, ["check", root, "--json"])).ok).toBe(true);

    // Nothing differs now, so no safety snapshot is taken.
    expect(invoke(cwd, ["snapshot", "--restore", "draft-one", "--path", root]).out).toBe("The project already matches snapshot draft-one: nothing to restore\n");
    expect(json(invoke(cwd, ["snapshot", "--restore", "draft-one", "--json", "--path", root])).data).toMatchObject({ safety: null, changes: [] });
    // The safety snapshot undoes the restore.
    const undo = invoke(cwd, ["snapshot", "--restore", "before-restore-draft-one-1", "--path", root]);
    expect(undo.code).toBe(0);
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-03.md"), "utf8")).toContain("A new ending.");
    expect(fs.existsSync(path.join(root, "chapters", "chapter-02.md"))).toBe(false);
    // A second restore of the same snapshot numbers its safety copy on.
    expect(invoke(cwd, ["snapshot", "--restore", "draft-one", "--path", root]).out).toStartWith("Saved the project as it was in snapshot before-restore-draft-one-2 ");
  });

  test("--dry-run lists the same changes as the real run and writes nothing", () => {
    const { cwd, root } = revised();
    const before = fs.readdirSync(path.join(root, ".snapshots"));
    const preview = invoke(cwd, ["snapshot", "--restore", "draft-one", "--dry-run", "--json", "--path", root]);
    expect(preview.code).toBe(0);
    const planned = json(preview).data;
    expect(planned.dryRun).toBe(true);
    expect(planned.changes).toContainEqual({ action: "delete", path: "chapters/chapter-03.md" });
    expect(planned.changes).toContainEqual({ action: "create", path: ".snapshots/before-restore-draft-one-1/snapshot.json" });
    // A removed folder is listed after the files it held.
    const position = (action, file) => planned.changes.findIndex((change) => change.action === action && change.path === file);
    expect(position("rmdir", "notes")).toBe(position("delete", "notes/idea.md") + 1);
    expect(fs.readdirSync(path.join(root, ".snapshots"))).toEqual(before);
    expect(fs.existsSync(path.join(root, "chapters", "chapter-03.md"))).toBe(true);
    const text = invoke(cwd, ["snapshot", "--restore", "draft-one", "--dry-run", "--path", root]);
    expect(text.out).toStartWith("Restoring snapshot draft-one would first save the project as snapshot before-restore-draft-one-1; it would delete 2 markdown files the snapshot does not have, and 1 folder they leave empty\n");
    expect(text.out).toContain("delete  notes/idea.md\nrmdir   notes\nDry run: ");
    expect(fs.existsSync(path.join(root, "notes"))).toBe(true);

    const real = json(invoke(cwd, ["snapshot", "--restore", "draft-one", "--json", "--path", root]));
    expect(real.data.changes).toEqual(planned.changes);
    expect(real.data).toMatchObject({ restored: { name: "Draft One", id: "draft-one" }, safety: { id: "before-restore-draft-one-1" }, deleted: ["chapters/chapter-03.md", "notes/idea.md"], removedFolders: ["notes"] });
  });

  test("--dry-run goes on past a manifest --list cannot read, as the real run does (#548)", () => {
    const { cwd, root } = revised();
    // Over the 5 MiB read limit, so --list names the snapshot by its folder.
    fs.writeFileSync(path.join(root, ".snapshots", "draft-one", "snapshot.json"), " ".repeat(5 * 1024 * 1024 + 1));
    expect(listSnapshots(root).snapshots.map((snapshot) => snapshot.id)).toEqual(["draft-one"]);
    const preview = json(invoke(cwd, ["snapshot", "--restore", "draft-one", "--dry-run", "--json", "--path", root]));
    expect(preview.data.restored).toEqual({ name: "draft-one", id: "draft-one" });
    const real = json(invoke(cwd, ["snapshot", "--restore", "draft-one", "--json", "--path", root]));
    expect(real.data.changes).toEqual(preview.data.changes);
  });

  test("a restore that fails part way names the safety snapshot", () => {
    const { cwd, root } = revised();
    // A folder where the snapshot has chapter 2, so writing it fails after
    // chapter 1 and its registry are restored.
    fs.mkdirSync(path.join(root, "chapters", "chapter-02.md"));
    const failed = invoke(cwd, ["snapshot", "--restore", "draft-one", "--path", root]);
    expect(failed.code).toBe(4);
    expect(failed.err).toContain("Restoring snapshot draft-one stopped: ");
    expect(failed.err).toContain("The project is part restored (");
    expect(failed.err).toContain("Snapshot before-restore-draft-one-1 holds the project as it was before: story snapshot --restore before-restore-draft-one-1 puts it back");
    expect(fs.readFileSync(path.join(root, ".snapshots", "before-restore-draft-one-1", "chapters", "chapter-01.md"), "utf8")).toContain("Rewritten opening.");
  });

  test("never replaces or deletes a file saved after the restore read it (#547)", () => {
    for (const name of ["chapter-01.md", "chapter-03.md"]) {
      const { cwd, root } = revised();
      // Chapter 1 is written back first; chapter 3 is deleted after it.
      const file = path.join(root, "chapters", name);
      const saved = `${fs.readFileSync(file, "utf8")}\nSaved meanwhile.\n`;
      const spy = whileWriting(path.join(root, "chapters", "chapter-01.md"), () => fs.writeFileSync(file, saved));
      let result;
      try {
        result = invoke(cwd, ["snapshot", "--restore", "draft-one", "--path", root]);
      } finally {
        spy.mockRestore();
      }
      expect(result.code).toBe(4);
      expect(result.err).toContain(`Restoring snapshot draft-one stopped: chapters/${name} changed on disk while story was ${name === "chapter-01.md" ? "updating" : "deleting"} it, so it was left as it is`);
      expect(fs.readFileSync(file, "utf8")).toBe(saved);
    }
  });

  test("refuses a missing or incomplete snapshot, and misplaced flags, before changing anything", () => {
    const { cwd, root } = revised();
    expect(invoke(cwd, ["snapshot", "--restore", "nope", "--path", root]).err).toContain("No snapshot named nope: story snapshot --list shows them: draft-one");
    expect(invoke(cwd, ["snapshot", "x", "--restore", "draft-one", "--path", root]).err).toContain("takes the snapshot's name as its value");
    expect(invoke(cwd, ["snapshot", "--restore", "draft-one", "--force", "--path", root]).err).toContain("--force does not apply to story snapshot --restore");
    fs.mkdirSync(path.join(root, ".snapshots", "by-hand", "chapters"), { recursive: true });
    const incomplete = invoke(cwd, ["snapshot", "--restore", "by-hand", "--path", root]);
    expect(incomplete.code).toBe(4);
    expect(incomplete.err).toContain("Cannot restore snapshot by-hand: .snapshots/by-hand has no story.md");
    expect(fs.readdirSync(path.join(root, ".snapshots")).sort()).toEqual([".gitignore", "by-hand", "draft-one"]);
    expect(fs.existsSync(path.join(root, "chapters", "chapter-03.md"))).toBe(true);

    // A folder the snapshot writes into that is now a project of its own.
    writeMarkdown(path.join(root, ".snapshots", "draft-one", "spinoff", "notes.md"), "title: Notes");
    const nested = invoke(cwd, ["snapshot", "--restore", "draft-one", "--path", root]);
    expect(nested.code).toBe(4);
    expect(nested.err).toContain("spinoff/notes.md would be written into spinoff/, which is now a story project of its own. Nothing was changed");
    // The preview copy has no nested projects, so it checks the real one.
    expect(invoke(cwd, ["snapshot", "--restore", "draft-one", "--dry-run", "--path", root]).err).toContain("which is now a story project of its own");
    expect(fs.readdirSync(path.join(root, ".snapshots")).sort()).toEqual([".gitignore", "by-hand", "draft-one"]);
  });

  test("refuses to write through a symlinked folder, such as one into another snapshot", () => {
    const { cwd, root } = project();
    invoke(cwd, ["snapshot", "draft", "--path", root]);
    invoke(cwd, ["snapshot", "other", "--path", root]);
    writeMarkdown(path.join(root, ".snapshots", "draft", "notes", "idea.md"), "title: Idea");
    fs.symlinkSync(path.join(root, ".snapshots", "other"), path.join(root, "notes"), "junction");
    const refused = invoke(cwd, ["snapshot", "--restore", "draft", "--path", root]);
    expect(refused.code).toBe(4);
    expect(refused.err).toContain("Cannot restore snapshot draft: notes/ is a symlink, and notes/idea.md would be written through it. Nothing was changed");
    expect(fs.existsSync(path.join(root, ".snapshots", "other", "idea.md"))).toBe(false);
    expect(fs.readdirSync(path.join(root, ".snapshots")).sort()).toEqual([".gitignore", "draft", "other"]);
  });

  test("refuses a .snapshots that is a symlink or a file before changing anything", () => {
    const outside = makeTempDir();
    writeMarkdown(path.join(outside, "draft", "story.md"), "title: Elsewhere");
    for (const [make, message] of [
      [(folder) => fs.symlinkSync(outside, folder, "junction"), "Refusing to use symlinked project directory"],
      [(folder) => fs.writeFileSync(folder, ""), "Project path is not a directory"]
    ]) {
      const { cwd, root } = project();
      make(path.join(root, ".snapshots"));
      const before = treeSnapshot(root);
      for (const argv of [["snapshot", "--restore", "draft", "--dry-run", "--path", root], ["snapshot", "--restore", "draft", "--path", root]]) {
        const refused = invoke(cwd, argv);
        expect(refused.code).toBe(3);
        expect(refused.err).toContain(message);
      }
      expect(treeSnapshot(root)).toEqual(before);
      expect(fs.readdirSync(outside)).toEqual(["draft"]);
    }
  });

  test("--dry-run skips another snapshot's symlinked manifest, as --list does", () => {
    const { cwd, root } = revised();
    fs.mkdirSync(path.join(root, ".snapshots", "odd"));
    fs.symlinkSync(path.join(makeTempDir(), "missing.json"), path.join(root, ".snapshots", "odd", "snapshot.json"));
    const preview = invoke(cwd, ["snapshot", "--restore", "draft-one", "--dry-run", "--path", root]);
    expect(preview.code).toBe(0);
    expect(preview.out).toContain("delete  chapters/chapter-03.md\n");
  });

  test("restores over a chapter that no longer parses, keeping it in the safety snapshot", () => {
    const { cwd, root } = project();
    invoke(cwd, ["snapshot", "good", "--path", root]);
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, "---\ntitle: [broken\n---\n\nText.\n");
    expect(invoke(cwd, ["snapshot", "broken", "--path", root]).code).toBe(3);
    const restored = invoke(cwd, ["snapshot", "--restore", "good", "--path", root]);
    expect(restored.code).toBe(0);
    expect(fs.readFileSync(chapter, "utf8")).toContain("First paragraph.");
    expect(fs.readFileSync(path.join(root, ".snapshots", "before-restore-good-1", "chapters", "chapter-01.md"), "utf8")).toContain("title: [broken");

    // Its undo puts the broken chapter back, and leaves the reindex for later.
    const undo = invoke(cwd, ["snapshot", "--restore", "before-restore-good-1", "--path", root]);
    expect(undo.code).toBe(0);
    expect(undo.out).toContain("Registries not rebuilt: some restored files do not parse. Fix them (story validate lists them), then run story reindex\n");
    expect(fs.readFileSync(chapter, "utf8")).toContain("title: [broken");
    expect(json(invoke(cwd, ["snapshot", "--restore", "good", "--json", "--path", root])).data.reindexed).toBe(true);
  });

  test("--dry-run says when the project already matches", () => {
    const { cwd, root } = project();
    invoke(cwd, ["snapshot", "same", "--path", root]);
    expect(invoke(cwd, ["snapshot", "--restore", "same", "--dry-run", "--path", root]).out).toBe("The project already matches snapshot same: nothing to restore\nDry run: story snapshot would make no changes; nothing was written\n");
  });

  test("removes only the folders it empties, never one already empty, one that holds more, or one init makes (#524)", () => {
    const { cwd, root } = project();
    fs.mkdirSync(path.join(root, "drafts"));
    invoke(cwd, ["snapshot", "base", "--path", root]);
    // Emptied, with the folder that holds it, and a shallower one that sorts
    // later: deepest first.
    writeMarkdown(path.join(root, "scraps", "deep", "ships.md"), "title: Ships");
    writeMarkdown(path.join(root, "zeta", "last.md"), "title: Last");
    // Each of these still holds something the restore never touches: an
    // empty folder, a hidden folder (one level down, too), a nested
    // project, dist/, an image.
    const keepers = {
      notes: ["old"],
      extras: [".obsidian"],
      "lore/deep": [".obsidian"],
      side: ["spin"],
      misc: ["dist"],
      art: []
    };
    for (const [folder, [inside]] of Object.entries(keepers)) {
      writeMarkdown(path.join(root, ...folder.split("/"), "page.md"), "title: Page");
      if (inside !== undefined) {
        fs.mkdirSync(path.join(root, ...folder.split("/"), inside));
      }
    }
    writeMarkdown(path.join(root, "side", "spin", "story.md"), "title: Spin");
    fs.writeFileSync(path.join(root, "misc", "dist", "book.md"), "built\n");
    fs.writeFileSync(path.join(root, "art", "cover.png"), "not markdown\n");
    // A folder init makes stays, though the restore empties it.
    createEntity(root, { kind: "location", name: "Harbour" });
    invoke(cwd, ["reindex", root]);

    const preview = json(invoke(cwd, ["snapshot", "--restore", "base", "--dry-run", "--json", "--path", root])).data;
    expect(preview.removedFolders).toEqual(["scraps/deep", "scraps", "zeta"]);
    expect(preview.changes.filter((change) => change.action === "rmdir").map((change) => change.path)).toEqual(["scraps/deep", "scraps", "zeta"]);
    const real = json(invoke(cwd, ["snapshot", "--restore", "base", "--json", "--path", root])).data;
    expect(real.changes).toEqual(preview.changes);
    expect(real.removedFolders).toEqual(["scraps/deep", "scraps", "zeta"]);
    expect(real.deleted).toContain("worldbuilding/locations/harbour.md");
    expect(real.deleted).toContain("lore/deep/page.md");
    expect(fs.existsSync(path.join(root, "scraps"))).toBe(false);
    for (const folder of ["drafts", "notes/old", "extras/.obsidian", "lore/deep/.obsidian", "side/spin/story.md", "misc/dist/book.md", "art/cover.png", "worldbuilding/locations"]) {
      expect(fs.existsSync(path.join(root, ...folder.split("/")))).toBe(true);
    }
    expect(fs.readdirSync(path.join(root, "worldbuilding", "locations"))).toEqual([]);
    expect(json(invoke(cwd, ["check", root, "--json"])).ok).toBe(true);

    // Undone, the safety snapshot puts the files, and so their folders, back.
    const undo = invoke(cwd, ["snapshot", "--restore", "before-restore-base-1", "--path", root]);
    expect(undo.out).toContain("  create  scraps/deep/ships.md\n");
    expect(undo.out).not.toContain("rmdir");
  });

  test.skipIf(CHMOD_IGNORED)("a folder it cannot remove is a warning, and the restore still finishes (#524)", () => {
    const { cwd, root } = project();
    invoke(cwd, ["snapshot", "base", "--path", root]);
    writeMarkdown(path.join(root, "scraps", "deep", "ships.md"), "title: Ships");
    // scraps/ cannot lose its subfolder, though deep/ can lose its file.
    fs.chmodSync(path.join(root, "scraps"), 0o555);
    try {
      const preview = invoke(cwd, ["snapshot", "--restore", "base", "--dry-run", "--json", "--path", root]);
      const real = invoke(cwd, ["snapshot", "--restore", "base", "--json", "--path", root]);
      expect(real.code).toBe(0);
      const data = json(real).data;
      expect(data).toMatchObject({ deleted: ["scraps/deep/ships.md"], removedFolders: [], reindexed: true });
      expect(data.changes).toEqual(json(preview).data.changes);
      expect(json(real).diagnostics).toEqual([expect.objectContaining({ code: "folder-not-removed", file: "scraps/deep" })]);
      expect(fs.readdirSync(path.join(root, "scraps", "deep"))).toEqual([]);
    } finally {
      fs.chmodSync(path.join(root, "scraps"), 0o755);
    }
    const text = invoke(cwd, ["snapshot", "--restore", "before-restore-base-1", "--path", root]);
    expect(text.code).toBe(0);
  });

  test("checks a folder again before it removes it, and leaves a symlink in its place alone (#524)", () => {
    const { cwd, root } = project();
    invoke(cwd, ["snapshot", "base", "--path", root]);
    writeMarkdown(path.join(root, "notes", "idea.md"), "title: Idea");
    // As if notes/ had been swapped for a link to a folder outside the
    // project after the restore was planned.
    const outside = path.join(makeTempDir(), "elsewhere");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, "linked"), "junction");
    const plan = { ...planRestore(root, "base"), folders: ["linked"] };
    const result = restoreSnapshot(root, { name: "base", plan });
    expect(result.deleted).toEqual(["notes/idea.md"]);
    expect(result.removedFolders).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["folder-not-removed"]);
    expect(result.warnings[0].message).toStartWith("Could not remove linked/, which the restore left empty (");
    expect(fs.existsSync(outside)).toBe(true);
  });

  test("where a folder ignores case, restores a file the project spells another way, and never deletes it (#581)", () => {
    const { root } = project();
    writeMarkdown(path.join(root, "notes", "Notes.md"), "title: Notes", "As in the snapshot.\n");
    snapshotProject(root, { name: "base" });
    // Renamed in case and edited; chapters/ renamed in case, with a chapter
    // to create in it; an init folder renamed in case, with a file to
    // delete. The identity is injected, so this runs on every file system.
    fs.rmSync(path.join(root, "notes", "Notes.md"));
    writeMarkdown(path.join(root, "notes", "notes.md"), "title: Notes", "Edited since.\n");
    renameCase(path.join(root, "chapters"), path.join(root, "Chapters"));
    fs.rmSync(path.join(root, "Chapters", "chapter-02.md"));
    renameCase(path.join(root, "worldbuilding", "locations"), path.join(root, "worldbuilding", "Locations"));
    writeMarkdown(path.join(root, "worldbuilding", "Locations", "harbour.md"), "title: Harbour");

    const options = { name: "base", identity: caseless(root) };
    const plan = planRestore(root, "base", options);
    expect(plan.writes.map((write) => [write.path, write.created])).toEqual([["Chapters/chapter-02.md", true], ["notes/notes.md", false]]);
    expect(plan.deletes.map((file) => file.path)).toEqual(["worldbuilding/Locations/harbour.md"]);
    expect(plan.folders).toEqual([]);
    const result = restoreSnapshot(root, options);
    expect(result).toMatchObject({ updated: ["notes/notes.md"], created: ["Chapters/chapter-02.md"], deleted: ["worldbuilding/Locations/harbour.md"], removedFolders: [] });
    expect(fs.readFileSync(path.join(root, "notes", "notes.md"), "utf8")).toContain("As in the snapshot.");
    expect(fs.readFileSync(path.join(root, "Chapters", "chapter-02.md"), "utf8")).toContain("Cut me later.");
    expect(fs.existsSync(path.join(root, "worldbuilding", "Locations"))).toBe(true);
  });

  test("refuses, before any change, a snapshot file it cannot match to one project file (#581)", () => {
    const { root } = project();
    writeMarkdown(path.join(root, "notes", "Notes.md"), "title: Notes");
    snapshotProject(root, { name: "base" });
    fs.rmSync(path.join(root, "notes", "Notes.md"));
    writeMarkdown(path.join(root, "notes", "a.md"), "title: A");
    writeMarkdown(path.join(root, "notes", "b.md"), "title: B");
    // A file system that gives every note one identity (no inode numbers),
    // and one that finds Notes.md but lists no name that is the same file.
    const blurred = (file) => (path.basename(path.dirname(file)) === "notes" ? "one" : identity(file));
    expect(() => restoreSnapshot(root, { name: "base", identity: blurred })).toThrow("Cannot restore snapshot base: the project finds notes/Notes.md under another spelling, but cannot tell which of its files that is (a.md, b.md). Nothing was changed");
    const ghost = (file) => (path.basename(file) === "Notes.md" ? "ghost" : identity(file));
    expect(() => restoreSnapshot(root, { name: "base", identity: ghost })).toThrow("cannot tell which of its files that is. Nothing was changed");
    expect(fs.readdirSync(path.join(root, ".snapshots")).sort()).toEqual([".gitignore", "base"]);
  });

  test.skipIf(IGNORES_CASE)("refuses a snapshot whose two spellings are one file in the project (#581)", () => {
    const { root } = project();
    writeMarkdown(path.join(root, "notes", "notes.md"), "title: Notes");
    snapshotProject(root, { name: "base" });
    writeMarkdown(path.join(root, ".snapshots", "base", "notes", "Notes.md"), "title: Other Notes");
    expect(() => restoreSnapshot(root, { name: "base", identity: caseless(root) })).toThrow("Cannot restore snapshot base: its notes/Notes.md and notes/notes.md are one file in this project (notes/notes.md), whose folder does not tell the two spellings apart. Nothing was changed");
    // Where the folder tells them apart, both are restored.
    expect(restoreSnapshot(root, { name: "base" }).created).toEqual(["notes/Notes.md"]);
  });

  test.skipIf(!IGNORES_CASE)("on a file system that ignores case, keeps a file or folder renamed only in case (#581)", () => {
    const { cwd, root } = project();
    writeMarkdown(path.join(root, "notes", "Notes.md"), "title: Notes", "As in the snapshot.\n");
    invoke(cwd, ["snapshot", "base", "--path", root]);
    renameCase(path.join(root, "notes", "Notes.md"), path.join(root, "notes", "notes.md"));
    fs.writeFileSync(path.join(root, "notes", "notes.md"), "---\ntitle: Notes\n---\nEdited since.\n");
    renameCase(path.join(root, "chapters"), path.join(root, "Chapters"));
    fs.rmSync(path.join(root, "Chapters", "chapter-02.md"));
    renameCase(path.join(root, "worldbuilding", "locations"), path.join(root, "worldbuilding", "Locations"));
    writeMarkdown(path.join(root, "worldbuilding", "Locations", "harbour.md"), "title: Harbour");

    const preview = json(invoke(cwd, ["snapshot", "--restore", "base", "--dry-run", "--json", "--path", root])).data;
    const real = json(invoke(cwd, ["snapshot", "--restore", "base", "--json", "--path", root]));
    expect(real.data).toMatchObject({ updated: ["notes/notes.md"], created: ["Chapters/chapter-02.md"], deleted: ["worldbuilding/Locations/harbour.md"], removedFolders: [] });
    expect(real.data.changes).toEqual(preview.changes);
    expect(fs.readdirSync(path.join(root, "notes"))).toEqual(["notes.md"]);
    expect(fs.readFileSync(path.join(root, "notes", "Notes.md"), "utf8")).toContain("As in the snapshot.");
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-02.md"), "utf8")).toContain("Cut me later.");
    expect(fs.existsSync(path.join(root, "worldbuilding", "Locations"))).toBe(true);

    // The same text under another case: nothing to restore, and nothing lost.
    renameCase(path.join(root, "notes", "notes.md"), path.join(root, "notes", "NOTES.md"));
    expect(invoke(cwd, ["snapshot", "--restore", "base", "--path", root]).out).toBe("The project already matches snapshot base: nothing to restore\n");
    expect(fs.readdirSync(path.join(root, "notes"))).toEqual(["NOTES.md"]);
  });
});

describe("story similarity --snapshot", () => {
  test("compares the chapters with a saved snapshot, found by name or id", () => {
    const { cwd, root } = project();
    writeChapter(root, 1, "The lighthouse keeper climbed the stairs every night before the storm came in.");
    invoke(cwd, ["snapshot", "Draft One", "--path", root]);
    writeChapter(root, 1, "Years later, the lighthouse keeper climbed the stairs every night before the storm came in, alone.");
    const result = invoke(cwd, ["similarity", root, "--snapshot", "Draft One"]);
    expect(result.code).toBe(0);
    expect(result.out).toStartWith("Similarity against snapshot draft-one: ");
    expect(result.err).toContain("with .snapshots/draft-one/chapters/chapter-01.md (ch01-p1)");
    const data = json(invoke(cwd, ["similarity", root, "--snapshot", "draft-one", "--json"])).data;
    expect(data.label).toBe("snapshot draft-one");
    expect(data.passages[0]).toMatchObject({ file: "chapters/chapter-01.md", words: 13 });
    expect(invoke(cwd, ["similarity", root, "--snapshot", "draft-one", "--against", "x"]).err).toContain("one of --against <file|folder|git-ref> or --snapshot <name>, not both");
    expect(invoke(cwd, ["similarity", root, "--snapshot", "nope"]).err).toContain("No snapshot named nope");
    // A snapshot folder without story.md is not read as loose text.
    writeMarkdown(path.join(root, ".snapshots", "by-hand", "notes.md"), "title: Notes", "The lighthouse keeper climbed the stairs every night before the storm came in.");
    const loose = invoke(cwd, ["similarity", root, "--snapshot", "by-hand"]);
    expect(loose.code).toBe(3);
    expect(loose.err).toContain("Cannot check similarity with snapshot by-hand: .snapshots/by-hand has no story.md");

    // --snapshot on the command line drops a cli-defaults --against.
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^---\n/, "---\ncli-defaults:\n  - command: similarity\n    against: ../missing.txt\n"));
    expect(invoke(cwd, ["similarity", root, "--snapshot", "draft-one"]).out).toStartWith("Similarity against snapshot draft-one: ");
  });
});

import { describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { isGitDirectoryName, isInsideGitDirectory, readTextFile } from "../src/files.js";
import {
  computeWordCounts,
  createEntity,
  createStoryProject,
  moveEntity,
  renameEntity,
  scanProject,
  validateLinks,
  validateProject,
  writeFile
} from "../src/story.js";
import { CHMOD_IGNORED, makeTempDir, memoryIo, messages } from "./helpers.js";

const BIN = path.join(import.meta.dir, "..", "bin", "story.js");

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function newProject(title = "Safety") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function listDir(root, dir) {
  return fs.readdirSync(path.join(root, dir)).sort();
}

// Makes fs.rmSync throw for the first path matching `pattern`, standing in
// for a process killed (or a delete refused) at that point.
function failingRemove(pattern, run) {
  const original = fs.rmSync;
  let failed = false;
  fs.rmSync = (target, ...rest) => {
    if (!failed && pattern.test(String(target))) {
      failed = true;
      throw Object.assign(new Error(`EBUSY: resource busy or locked, rm '${target}'`), { code: "EBUSY", syscall: "rm", path: target });
    }
    return original(target, ...rest);
  };
  try {
    expect(run).toThrow("EBUSY");
  } finally {
    fs.rmSync = original;
  }
}

function readOnly(file, run) {
  fs.chmodSync(file, 0o444);
  try {
    expect(run).toThrow();
  } finally {
    fs.chmodSync(file, 0o644);
  }
}

describe("atomic writes (#190, #197)", () => {
  test("a write that fails partway leaves the chapter whole and names it", () => {
    if (process.platform === "win32") {
      return;
    }
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.appendFileSync(chapter, `\n${"The tide came in over the harbour wall. ".repeat(200)}\n`);
    const before = fs.readFileSync(chapter, "utf8");
    expect(before.length).toBeGreaterThan(4096);
    // ulimit -f 4 makes any write past 4 KiB fail with EFBIG, as a full disk would.
    const result = spawnSync("bash", ["-c", `trap '' XFSZ; ulimit -f 4; "${process.execPath}" "${BIN}" wordcount --write`], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(4);
    expect(result.stderr).toContain(`Cannot write to ${"chapters/chapter-01.md"}: the file is too large`);
    expect(fs.readFileSync(chapter, "utf8")).toBe(before);
    expect(listDir(root, "chapters")).toEqual(["_index.md", "chapter-01.md"]);
  });

  test("writeFile replaces through a temporary file named after the target", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "chapter.md");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o640);
    const renames = [];
    const original = fs.renameSync;
    fs.renameSync = (from, to) => {
      renames.push([path.basename(from), path.basename(to)]);
      return original(from, to);
    };
    try {
      writeFile(target, "new");
    } finally {
      fs.renameSync = original;
    }
    expect(renames).toHaveLength(1);
    expect(renames[0][0]).toMatch(/^\.chapter\.md\.story-[0-9a-f]{16}\.tmp$/);
    expect(renames[0][1]).toBe("chapter.md");
    expect(fs.readFileSync(target, "utf8")).toBe("new");
    if (!CHMOD_IGNORED) {
      expect(fs.statSync(target).mode & 0o777).toBe(0o640);
    }
    expect(fs.readdirSync(dir)).toEqual(["chapter.md"]);
  });

  test("each write gets a new random temporary name", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "chapter.md");
    const names = [];
    const original = fs.renameSync;
    fs.renameSync = (from, to) => {
      names.push(path.basename(from));
      return original(from, to);
    };
    try {
      writeFile(target, "one");
      writeFile(target, "two");
    } finally {
      fs.renameSync = original;
    }
    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
    for (const name of names) {
      const suffix = /^\.chapter\.md\.story-(.+)\.tmp$/.exec(name)?.[1];
      expect(suffix).toMatch(/^[0-9a-f]{16}$/);
      expect(suffix).not.toBe(String(process.pid));
    }
  });

  test("a long name in two-byte characters keeps its temporary name within 255 bytes", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), "\nThe ember woke.\n");
    // 253 bytes: a name the file system accepts, too long to keep whole in
    // the temporary name.
    const name = `${"é".repeat(125)}.md`;
    const temporary = [];
    const original = fs.renameSync;
    fs.renameSync = (from, to) => {
      temporary.push(path.basename(from));
      return original(from, to);
    };
    let result;
    try {
      result = invoke(root, ["export", "--out", `dist/${name}`]);
    } finally {
      fs.renameSync = original;
    }
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(fs.lstatSync(path.join(root, "dist", name)).isFile()).toBe(true);
    expect(temporary).toHaveLength(1);
    // 113 whole characters (226 bytes); a 114th would pass the limit.
    expect(temporary[0]).toMatch(new RegExp(`^\\.${"é".repeat(113)}\\.story-[0-9a-f]{16}\\.tmp$`));
    expect(Buffer.byteLength(temporary[0], "utf8")).toBeLessThanOrEqual(255);
  });

  test("a rewrite keeps a mode the umask would have narrowed", () => {
    if (CHMOD_IGNORED) {
      return;
    }
    const dir = makeTempDir();
    const target = path.join(dir, "chapter.md");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o666);
    writeFile(target, "new");
    expect(fs.readFileSync(target, "utf8")).toBe("new");
    expect(fs.statSync(target).mode & 0o777).toBe(0o666);
  });

  // Windows makes symlinks only with extra privileges.
  test.skipIf(process.platform === "win32")("a symlink at the old process-id temporary name is never written through", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const outside = path.join(makeTempDir(), "outside.txt");
    fs.writeFileSync(outside, "untouched\n");
    fs.chmodSync(outside, 0o600);
    const planted = path.join(root, "chapters", `.chapter-01.md.story-${process.pid}.tmp`);
    fs.symlinkSync(outside, planted);
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.appendFileSync(chapter, "\nThe ember woke.\n");

    expect(invoke(root, ["wordcount", "--write"]).code).toBe(0);
    expect(fs.readFileSync(outside, "utf8")).toBe("untouched\n");
    if (!CHMOD_IGNORED) {
      expect(fs.statSync(outside).mode & 0o777).toBe(0o600);
    }
    expect(fs.lstatSync(chapter).isFile()).toBe(true);
    expect(read(root, "chapters/chapter-01.md")).toContain("word-count: 3");
    // Not this write's file, so it is left where it is.
    expect(fs.lstatSync(planted).isSymbolicLink()).toBe(true);
  });

  test.skipIf(process.platform === "win32")("a symlink at the very name a write picks is refused, not written through or removed", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "chapter.md");
    fs.writeFileSync(target, "old");
    const outside = path.join(makeTempDir(), "outside.txt");
    fs.writeFileSync(outside, "untouched");
    const bytes = Buffer.from("0123456789abcdef", "hex");
    const planted = path.join(dir, `.chapter.md.story-${bytes.toString("hex")}.tmp`);
    fs.symlinkSync(outside, planted);
    const spy = spyOn(crypto, "randomBytes").mockImplementation(() => bytes);
    try {
      expect(() => writeFile(target, "new")).toThrow(`Cannot write to ${target}: EEXIST`);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(outside, "utf8")).toBe("untouched");
    expect(fs.readFileSync(target, "utf8")).toBe("old");
    expect(fs.lstatSync(planted).isSymbolicLink()).toBe(true);
  });

  test.skipIf(process.platform === "win32")("a dry run never writes through a symlink the project holds at a temporary name", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), "\nThe ember woke.\n");
    const outside = path.join(makeTempDir(), "outside.txt");
    fs.writeFileSync(outside, "untouched\n");
    fs.symlinkSync(outside, path.join(root, "chapters", `.chapter-01.md.story-${process.pid}.tmp`));
    const bytes = Buffer.from("fedcba9876543210", "hex");
    fs.symlinkSync(outside, path.join(root, "chapters", `.chapter-01.md.story-${bytes.toString("hex")}.tmp`));

    // The copy holds both links; a write there picks a fresh name.
    const preview = invoke(root, ["wordcount", "--write", "--dry-run"]);
    expect(preview.code).toBe(0);
    expect(preview.out).toMatch(/^update +chapters\/chapter-01\.md$/m);
    expect(fs.readFileSync(outside, "utf8")).toBe("untouched\n");

    // Even when the copy's write picks the very name a link holds.
    const spy = spyOn(crypto, "randomBytes").mockImplementation(() => bytes);
    let refused;
    try {
      refused = invoke(root, ["wordcount", "--write", "--dry-run"]);
    } finally {
      spy.mockRestore();
    }
    expect(refused.code).toBe(4);
    expect(refused.err).toContain(`${path.join("chapters", "chapter-01.md")}: EEXIST`);
    expect(fs.readFileSync(outside, "utf8")).toBe("untouched\n");
    expect(read(root, "chapters/chapter-01.md")).not.toContain("word-count: 3");
  });

  test("a read-only file stays refused", () => {
    if (CHMOD_IGNORED) {
      return;
    }
    const dir = makeTempDir();
    const target = path.join(dir, "chapter.md");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o444);
    expect(() => writeFile(target, "new")).toThrow("EACCES");
    expect(fs.readFileSync(target, "utf8")).toBe("old");
    expect(fs.readdirSync(dir)).toEqual(["chapter.md"]);
  });

  test("validate reports a temporary file left by an interrupted write", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.writeFileSync(path.join(root, "chapters", ".chapter-01.md.story-4242.tmp"), "partial");
    fs.writeFileSync(path.join(root, "chapters", ".story-687110.tmp"), "partial");
    fs.writeFileSync(path.join(root, ".story.md.story-9f2c41d07a3b6e85.tmp"), "partial");
    const warnings = messages(validateProject(root).warnings);
    expect(warnings).toContain(`${".story.md.story-9f2c41d07a3b6e85.tmp"} was left by an interrupted write to ${"story.md"}; delete it once the files beside it look right`);
    expect(warnings).toContain(`${"chapters/.chapter-01.md.story-4242.tmp"} was left by an interrupted write to ${"chapters/chapter-01.md"}; delete it once the files beside it look right`);
    expect(warnings).toContain(`${"chapters/.story-687110.tmp"} was left by an interrupted write; delete it once the files beside it look right`);
  });
});

describe("invalid UTF-8 (#195)", () => {
  test("validate reports the file and write commands leave its bytes alone", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.appendFileSync(chapter, Buffer.from([0x0a, 0x93, 0x43, 0x61, 0x66, 0xe9, 0x94, 0x0a]));
    const bytes = fs.readFileSync(chapter);
    const offset = bytes.indexOf(0x93);
    const validation = invoke(root, ["validate"]);
    expect(validation.code).toBe(1);
    expect(validation.out + validation.err).toContain(`${"chapters/chapter-01.md"}: is not valid UTF-8 (byte 0x93 at offset ${offset}): re-save it as UTF-8`);
    expect(() => computeWordCounts(root, { write: true })).toThrow("is not valid UTF-8");
    expect(() => createEntity(root, { kind: "character", name: "Mara" })).toThrow("is not valid UTF-8");
    expect(fs.readFileSync(chapter).equals(bytes)).toBe(true);
  });

  test("valid UTF-8, a byte order mark, and a literal replacement character still read", () => {
    const file = path.join(makeTempDir(), "note.md");
    fs.writeFileSync(file, "﻿Café £5 �");
    expect(readTextFile(file)).toBe("﻿Café £5 �");
    fs.writeFileSync(file, Buffer.concat([Buffer.from("ok � "), Buffer.from([0xa3])]));
    expect(() => readTextFile(file)).toThrow("is not valid UTF-8 (byte 0xa3 at offset 7)");
  });
});

describe("unreadable files name their path once (#383)", () => {
  test("validate names a non-UTF-8, oversized, unreadable, or symlinked file once", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    createEntity(root, { kind: "character", name: "Mara" });
    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), Buffer.from([0xff]));
    fs.appendFileSync(path.join(root, "characters", "_index.md"), Buffer.from([0xff]));
    fs.writeFileSync(path.join(root, "chapters", "chapter-02.md"), "a".repeat(5 * 1024 * 1024 + 1));
    fs.symlinkSync(path.join(root, "story.md"), path.join(root, "continuity", "exemptions.md"));
    if (!CHMOD_IGNORED) {
      fs.chmodSync(path.join(root, "characters", "mara.md"), 0o000);
    }
    const errors = messages(validateProject(root).errors);
    for (const error of errors) {
      const [label] = error.split(": ");
      expect(error.slice(label.length)).not.toContain(label);
      expect(error).not.toContain(root);
    }
    expect(errors).toContain(`${"chapters/chapter-01.md"}: is not valid UTF-8 (byte 0xff at offset ${fs.statSync(path.join(root, "chapters", "chapter-01.md")).size - 1}): re-save it as UTF-8`);
    expect(errors).toContain(`${"chapters/chapter-02.md"}: Refusing to read oversized file: ${5 * 1024 * 1024 + 1} bytes exceeds the ${5 * 1024 * 1024} byte limit`);
    expect(errors).toContain(`${"continuity/exemptions.md"}: Refusing to read through symlink`);
    expect(errors.filter((error) => error.startsWith(`${"characters/_index.md"}: is not valid UTF-8`))).toHaveLength(1);
    if (!CHMOD_IGNORED) {
      expect(errors).toContain(`${"characters/mara.md"}: Cannot read: permission denied`);
    }
  });

  test("an unreadable optional registry or timeline is reported once", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), Buffer.from([0xff]));
    fs.mkdirSync(path.join(root, "matter"));
    fs.writeFileSync(path.join(root, "matter", "_index.md"), Buffer.from([0x2d, 0xff]));
    fs.mkdirSync(path.join(root, "research"));
    fs.symlinkSync(path.join(root, "story.md"), path.join(root, "research", "_index.md"));
    const once = (errors, label) => errors.filter((error) => error.startsWith(`${label}: `));
    const errors = messages(validateProject(root).errors);
    expect(once(errors, "plot/timeline.md")).toHaveLength(1);
    expect(once(errors, "matter/_index.md")).toEqual([`${"matter/_index.md"}: is not valid UTF-8 (byte 0xff at offset 1): re-save it as UTF-8 (it is a registry: run story reindex to rebuild it)`]);
    expect(once(errors, "research/_index.md")).toEqual([`${"research/_index.md"}: Refusing to read through symlink (it is a registry: run story reindex to rebuild it)`]);
    expect(once(messages(validateLinks(root).errors), "plot/timeline.md")).toHaveLength(1);
  });
});

describe("interrupted rename (#181, #192)", () => {
  test("renaming a missing id onto an existing name is refused", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Bo" });
    createEntity(root, { kind: "chapter", name: "Two", mention: "ghost" });
    const chapter = read(root, "chapters/chapter-01.md");
    const result = invoke(root, ["rename", "character", "ghost", "Bo"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("character ghost does not exist");
    expect(read(root, "chapters/chapter-01.md")).toBe(chapter);
  });

  test("a rename killed before deleting the old file can be rerun", () => {
    const root = newProject();
    createEntity(root, { kind: "location", name: "Port" });
    createEntity(root, { kind: "character", name: "Ilya Venn", location: "port" });
    createEntity(root, { kind: "chapter", name: "One", character: "ilya-venn" });
    failingRemove(/ilya-venn\.md$/, () => renameEntity(root, { kind: "character", id: "ilya-venn", name: "Zed Quill" }));
    expect(listDir(root, "characters")).toEqual(["_index.md", "ilya-venn.md", "zed-quill.md"]);
    const rerun = invoke(root, ["rename", "character", "ilya-venn", "Zed Quill"]);
    expect(rerun.err).toBe("");
    expect(rerun.code).toBe(0);
    expect(listDir(root, "characters")).toEqual(["_index.md", "zed-quill.md"]);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });
});

describe("interrupted move (#191, #193, #194)", () => {
  function book() {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "character", name: "Edran" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: "mara" });
    createEntity(root, { kind: "chapter", name: "Two", number: 2, character: "mara" });
    createEntity(root, { kind: "chapter", name: "Three", number: 3, character: "mara" });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-01", character: "mara" });
    createEntity(root, { kind: "scene", name: "Mill", chapter: "chapter-02", character: "mara" });
    createEntity(root, { kind: "scene", name: "Extra", chapter: "chapter-02", character: "edran" });
    return root;
  }

  test("move chapter deletes its scenes before the chapter, so a rerun finishes", () => {
    const root = book();
    failingRemove(/chapters[\\/]chapter-01\.md$/, () => moveEntity(root, { kind: "chapter", id: "chapter-01", number: 5 }));
    // The old scene is already gone; the chapter is still there to rerun.
    expect(listDir(root, "scenes")).not.toContain("chapter-01-scene-01.md");
    expect(listDir(root, "chapters")).toContain("chapter-01.md");
    expect(moveEntity(root, { kind: "chapter", id: "chapter-01", number: 5 }).id).toBe("chapter-05");
    expect(listDir(root, "chapters")).toEqual(["_index.md", "chapter-02.md", "chapter-03.md", "chapter-05.md"]);
    expect(listDir(root, "scenes")).toEqual(["_index.md", "chapter-02-scene-01.md", "chapter-02-scene-02.md", "chapter-05-scene-01.md"]);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });

  test("move scene adds the cast before deleting the old scene, so a rerun finishes", () => {
    if (CHMOD_IGNORED) {
      return;
    }
    const root = book();
    readOnly(path.join(root, "chapters", "chapter-03.md"), () => moveEntity(root, { kind: "scene", id: "chapter-02-scene-02", chapter: "chapter-03" }));
    expect(moveEntity(root, { kind: "scene", id: "chapter-02-scene-02", chapter: "chapter-03" }).id).toBe("chapter-03-scene-01");
    expect(listDir(root, "scenes")).toEqual(["_index.md", "chapter-01-scene-01.md", "chapter-02-scene-01.md", "chapter-03-scene-01.md"]);
    expect(scanProject(root).chapters.find((chapter) => chapter.id === "chapter-03").characters).toContain("edran");
  });

  test("rerunning move scene without --scene reuses the number the interrupted run took", () => {
    const root = book();
    failingRemove(/chapter-02-scene-02\.md$/, () => moveEntity(root, { kind: "scene", id: "chapter-02-scene-02", chapter: "chapter-01" }));
    expect(listDir(root, "scenes")).toContain("chapter-01-scene-02.md");
    const rerun = invoke(root, ["move", "scene", "chapter-02-scene-02", "--chapter", "chapter-01"]);
    expect(rerun.out).toContain("to chapter-01-scene-02");
    expect(listDir(root, "scenes")).toEqual(["_index.md", "chapter-01-scene-01.md", "chapter-01-scene-02.md", "chapter-02-scene-01.md"]);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });

  test("a move onto an identical placeholder is refused", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "TBD", number: 2 });
    createEntity(root, { kind: "chapter", name: "TBD", number: 5 });
    expect(() => moveEntity(root, { kind: "chapter", id: "chapter-02", number: 5 })).toThrow("chapter-05 already exists: move it first");
    createEntity(root, { kind: "scene", name: "Beat", chapter: "chapter-05" });
    createEntity(root, { kind: "scene", name: "Beat", chapter: "chapter-05" });
    expect(() => moveEntity(root, { kind: "scene", id: "chapter-05-scene-01", scene: 2 })).toThrow("chapter-05-scene-02 already exists");
    expect(listDir(root, "chapters")).toEqual(["_index.md", "chapter-02.md", "chapter-05.md"]);
    expect(listDir(root, "scenes")).toEqual(["_index.md", "chapter-05-scene-01.md", "chapter-05-scene-02.md"]);
  });
});

describe("interrupted add (#202)", () => {
  test("rerunning an add whose backlink step failed finishes it", () => {
    if (CHMOD_IGNORED) {
      return;
    }
    const root = newProject();
    createEntity(root, { kind: "location", name: "Port Kestrel" });
    const location = path.join(root, "worldbuilding", "locations", "port-kestrel.md");
    readOnly(location, () => createEntity(root, { kind: "character", name: "Nia Holt", location: "port-kestrel" }));
    expect(fs.existsSync(path.join(root, "characters", "nia-holt.md"))).toBe(true);
    const rerun = invoke(root, ["add", "character", "Nia Holt", "--location", "port-kestrel"]);
    expect(rerun.out).toContain("Finished an interrupted add of character nia-holt");
    expect(messages(validateLinks(root).errors)).toEqual([]);
    // A finished add is listed in the registry, so adding it again is refused.
    expect(() => createEntity(root, { kind: "character", name: "Nia Holt", location: "port-kestrel" })).toThrow("already exists");
  });

  test("rerunning an unnumbered scene add does not create a second copy", () => {
    if (CHMOD_IGNORED) {
      return;
    }
    const root = newProject();
    createEntity(root, { kind: "character", name: "Nessa" });
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "scene", name: "Opening", chapter: "chapter-01" });
    readOnly(path.join(root, "chapters", "chapter-01.md"), () => createEntity(root, { kind: "scene", name: "Extra Beat", chapter: "chapter-01", character: "nessa" }));
    expect(createEntity(root, { kind: "scene", name: "Extra Beat", chapter: "chapter-01", character: "nessa" })).toMatchObject({ id: "chapter-01-scene-02", resumed: true });
    expect(listDir(root, "scenes")).toEqual(["_index.md", "chapter-01-scene-01.md", "chapter-01-scene-02.md"]);
    expect(scanProject(root).chapters[0].characters).toContain("nessa");
    // Once finished, the same add is a new scene again.
    expect(createEntity(root, { kind: "scene", name: "Extra Beat", chapter: "chapter-01", character: "nessa" }).id).toBe("chapter-01-scene-03");
  });
});

describe("generated output and new projects stay out of .git", () => {
  // A story repository whose project is the repository root, as the
  // draft-next-chapter workflow checks one out.
  function gitProject(cwd = makeTempDir()) {
    const root = createStoryProject({ cwd, title: "Git Kept" }).root;
    createEntity(root, { kind: "chapter", name: "Opening" });
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "config"), "[core]\n\tbare = false\n");
    return root;
  }

  test("--out inside .git is refused for every command that writes one, dry run or not, relative or absolute", () => {
    const root = gitProject();
    const absolute = (file) => path.join(root, ".git", file);
    for (const [command, file, ...rest] of [
      ["export", "config"],
      ["build", "hooks/book.html", "--format", "html"],
      ["build", "codex", "--format", "codex"],
      ["synopsis", "synopsis.md"],
      ["diagram", "relationships.mmd"]
    ]) {
      const head = command === "diagram" ? ["diagram", "relationships", "--path", "."] : [command, "."];
      for (const out of [`.git/${file}`, absolute(file)]) {
        for (const dryRun of [[], ["--dry-run"]]) {
          const argv = [...head, ...rest, "--out", out, ...dryRun];
          const result = invoke(root, argv);
          expect(result.code, argv.join(" ")).toBe(4);
          expect(result.err).toContain("it is inside a .git folder. Choose a path outside .git");
        }
      }
    }
    expect(read(root, ".git/config")).toBe("[core]\n\tbare = false\n");
    expect(listDir(root, ".git")).toEqual(["config"]);
    // Output elsewhere is unaffected.
    expect(invoke(root, ["export", ".", "--out", "dist/book.md"]).code).toBe(0);
  });

  test("a .git folder is found in any case and through a symlinked folder", () => {
    const root = gitProject();
    fs.symlinkSync(path.join(root, ".git"), path.join(root, "lnk"), "junction");
    for (const out of [".GIT/config", "lnk/config", "sub/.git/x.md", "../.git/config"]) {
      expect(isInsideGitDirectory(path.join(root, out), root), out).toBe(true);
    }
    expect(invoke(root, ["export", ".", "--out", "lnk/config"]).code).toBe(4);
    for (const out of ["dist/book.md", ".github/book.md", "dist/.gitignore", "dist/repo.git/book.md"]) {
      expect(isInsideGitDirectory(path.join(root, out), root), out).toBe(false);
    }
  });

  test(".git., .git and GIT~1 name the .git folder on Windows only", () => {
    for (const name of [".git", ".GIT", ".git.", ".git ", ".git. ", "GIT~1", "git~2"]) {
      expect(isGitDirectoryName(name, "win32"), name).toBe(true);
    }
    expect(isGitDirectoryName(".git", "linux")).toBe(true);
    expect(isGitDirectoryName(".Git", "darwin")).toBe(true);
    for (const name of [".git.", ".git ", "GIT~1"]) {
      expect(isGitDirectoryName(name, "linux"), name).toBe(false);
    }
    for (const name of [".github", ".gitignore", "repo.git", "git"]) {
      expect(isGitDirectoryName(name, "win32"), name).toBe(false);
    }
  });

  test("a book that itself sits under a folder named .git still builds to its own dist/", () => {
    for (const parent of [[".git", "wt"], ["GIT~1"]]) {
      const cwd = path.join(makeTempDir(), ...parent);
      fs.mkdirSync(cwd, { recursive: true });
      const root = gitProject(cwd);
      expect(invoke(root, ["build", ".", "--format", "markdown"]).code, parent.join("/")).toBe(0);
      expect(listDir(root, "dist")).toEqual(["git-kept.md"]);
      // Its own .git is still refused.
      expect(invoke(root, ["export", ".", "--out", ".git/config"]).code).toBe(4);
      // A new book made from inside that folder is fine too.
      expect(invoke(cwd, ["init", "Sibling Book"]).code).toBe(0);
    }
  });

  test("init and import refuse a project folder inside .git, dry run or not", () => {
    const root = gitProject();
    const manuscript = path.join(makeTempDir(), "book.md");
    fs.writeFileSync(manuscript, "# Chapter 1\n\nThe tide came in.\n");
    for (const argv of [["init", "Inner", "--dir", ".git/inner"], ["import", manuscript, "--title", "Inner", "--dir", ".git/inner"]]) {
      for (const dryRun of [[], ["--dry-run"]]) {
        const result = invoke(root, [...argv, ...dryRun]);
        expect(result.code, [...argv, ...dryRun].join(" ")).toBe(4);
        expect(result.err).toContain("Refusing to create a story project inside a .git folder");
      }
    }
    expect(listDir(root, ".git")).toEqual(["config"]);
  });
});

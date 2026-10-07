import { describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { fileSystemName, isGitDirectoryName, isInsideGitDirectory, isShortNameOf, readTextFile } from "../src/files.js";
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

// The reason a write gives when its temporary file's name is taken.
function takenName(name) {
  return `something is already at the name of its temporary file (${name}, in the same folder), so it was left as it is. Run the command again`;
}

// Runs `run` with fs[method] throwing `code` for paths matching `pattern`.
function failing(method, pattern, code, run) {
  const original = fs[method];
  fs[method] = (target, ...rest) => {
    if (pattern.test(String(target))) {
      throw Object.assign(new Error(`${code}: stubbed, ${method} '${target}'`), { code, syscall: method, path: target });
    }
    return original(target, ...rest);
  };
  try {
    return run();
  } finally {
    fs[method] = original;
  }
}

function thrown(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
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
    let error;
    try {
      error = thrown(() => writeFile(target, "new"));
    } finally {
      spy.mockRestore();
    }
    expect(error.message).toBe(`Cannot write to ${target}: ${takenName(path.basename(planted))}`);
    expect(error).toMatchObject({ code: "EEXIST", path: target, syscall: "write", reason: takenName(path.basename(planted)) });
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
    expect(refused.err).toBe(`Cannot write to ${"chapters/chapter-01.md"}: ${takenName(`.chapter-01.md.story-${bytes.toString("hex")}.tmp`)}\n`);
    expect(fs.readFileSync(outside, "utf8")).toBe("untouched\n");
    expect(read(root, "chapters/chapter-01.md")).not.toContain("word-count: 3");
  });

  // Windows has no FIFOs.
  const plantings = [
    ["a file", (planted) => fs.writeFileSync(planted, "someone else's")],
    ["a folder", (planted) => fs.mkdirSync(planted)],
    ...(process.platform === "win32" ? [] : [["a FIFO", (planted) => expect(spawnSync("mkfifo", [planted]).status).toBe(0)]])
  ];

  test.each(plantings)("%s at the name a write picks gets a plain refusal, and a rerun writes (#602)", (_kind, plant) => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), "\nThe ember woke.\n");
    const chapter = read(root, "chapters/chapter-01.md");
    const registry = read(root, "chapters/_index.md");
    const bytes = Buffer.from("00112233aabbccdd", "hex");
    const planted = path.join(root, "chapters", `.chapter-01.md.story-${bytes.toString("hex")}.tmp`);
    plant(planted);
    const before = fs.lstatSync(planted);
    // From the folder above the book, so the path names the book too.
    const parent = path.dirname(root);
    const book = path.basename(root);
    const spy = spyOn(crypto, "randomBytes").mockImplementation(() => bytes);
    let refused;
    try {
      refused = invoke(parent, ["wordcount", book, "--write"]);
    } finally {
      spy.mockRestore();
    }
    expect(refused.code).toBe(4);
    expect(refused.err).toBe(`Cannot write to ${book}/chapters/chapter-01.md: ${takenName(path.basename(planted))}\n`);
    expect(read(root, "chapters/chapter-01.md")).toBe(chapter);
    expect(read(root, "chapters/_index.md")).toBe(registry);
    // Not this write's, so it is neither written nor removed.
    const after = fs.lstatSync(planted);
    expect([after.ino, after.mode, after.size]).toEqual([before.ino, before.mode, before.size]);

    // A rerun picks another name.
    expect(invoke(parent, ["wordcount", book, "--write"]).code).toBe(0);
    expect(read(root, "chapters/chapter-01.md")).toContain("word-count: 3");
  });

  test("a folder at the name is refused alike when the open fails with another code, as on Windows (#602)", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "chapter.md");
    fs.writeFileSync(target, "old");
    const bytes = Buffer.from("8899aabbccddeeff", "hex");
    const planted = path.join(dir, `.chapter.md.story-${bytes.toString("hex")}.tmp`);
    fs.mkdirSync(planted);
    const spy = spyOn(crypto, "randomBytes").mockImplementation(() => bytes);
    let error;
    try {
      error = failing("openSync", /\.story-[0-9a-f]+\.tmp$/, "EPERM", () => thrown(() => writeFile(target, "new")));
    } finally {
      spy.mockRestore();
    }
    expect(error.message).toBe(`Cannot write to ${target}: ${takenName(path.basename(planted))}`);
    expect(error).toMatchObject({ code: "EEXIST", path: target, syscall: "write" });
    expect(fs.readFileSync(target, "utf8")).toBe("old");
    expect(fs.lstatSync(planted).isDirectory()).toBe(true);
  });

  test("only a taken temporary name gets that reason (#602)", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "chapter.md");
    fs.writeFileSync(target, "old");
    // The open fails with nothing at the name.
    const open = failing("openSync", /\.story-[0-9a-f]+\.tmp$/, "EACCES", () => thrown(() => writeFile(target, "new")));
    expect(open.message).toBe(`Cannot write to ${target}: EACCES`);
    expect(open).toMatchObject({ code: "EACCES", path: target, syscall: "write" });
    expect(open.reason).toBeUndefined();
    // EEXIST after this write made its temporary file is not about the name,
    // and the file it made is removed.
    const rename = failing("renameSync", /\.story-[0-9a-f]+\.tmp$/, "EEXIST", () => thrown(() => writeFile(target, "new")));
    expect(rename.message).toBe(`Cannot write to ${target}: EEXIST`);
    expect(rename).toMatchObject({ code: "EEXIST", path: target, syscall: "write" });
    expect(rename.reason).toBeUndefined();
    expect(fs.readFileSync(target, "utf8")).toBe("old");
    expect(fs.readdirSync(dir)).toEqual(["chapter.md"]);
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

  test("validate reports a folder at a temporary file's name as one story never makes (#602)", () => {
    const root = newProject();
    fs.mkdirSync(path.join(root, "chapters", ".chapter-01.md.story-4242.tmp"));
    fs.mkdirSync(path.join(root, ".story-687110.tmp"));
    const found = validateProject(root).warnings.filter((warning) => warning.code === "interrupted-write");
    expect(found.map((warning) => warning.message)).toEqual([
      ".story-687110.tmp has the name of a story temporary file but is a folder, which story never makes; it may hold files, so check them before you delete it",
      "chapters/.chapter-01.md.story-4242.tmp has the name of a story temporary file but is a folder, which story never makes; it may hold files, so check them before you delete it"
    ]);
  });

  // Windows makes symlinks only with extra privileges, and has no FIFOs.
  test.skipIf(process.platform === "win32")("validate reports a symlink or FIFO at a temporary file's name without following it (#602)", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const outsideDir = makeTempDir();
    const outsideFile = path.join(outsideDir, "outside.txt");
    fs.writeFileSync(outsideFile, "untouched\n");
    // A link to a regular file is still a link, not an interrupted write's file.
    fs.symlinkSync(outsideFile, path.join(root, "chapters", ".chapter-01.md.story-0123456789abcdef.tmp"));
    fs.symlinkSync(outsideDir, path.join(root, ".story.md.story-4242.tmp"));
    fs.symlinkSync(path.join(outsideDir, "missing"), path.join(root, "chapters", ".story-687110.tmp"));
    expect(spawnSync("mkfifo", [path.join(root, "chapters", ".chapter-01.md.story-fedcba9876543210.tmp")]).status).toBe(0);

    const found = validateProject(root).warnings.filter((warning) => warning.code === "interrupted-write");
    expect(found.map((warning) => [warning.file, warning.message])).toEqual([
      [".story.md.story-4242.tmp", ".story.md.story-4242.tmp has the name of a story temporary file but is a symlink, which story never makes; delete the link itself, not what it points to"],
      ["chapters/.chapter-01.md.story-0123456789abcdef.tmp", "chapters/.chapter-01.md.story-0123456789abcdef.tmp has the name of a story temporary file but is a symlink, which story never makes; delete the link itself, not what it points to"],
      ["chapters/.chapter-01.md.story-fedcba9876543210.tmp", "chapters/.chapter-01.md.story-fedcba9876543210.tmp has the name of a story temporary file but is not a regular file, which story never makes; delete it"],
      ["chapters/.story-687110.tmp", "chapters/.story-687110.tmp has the name of a story temporary file but is a symlink, which story never makes; delete the link itself, not what it points to"]
    ]);
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("untouched\n");
    expect(fs.readdirSync(outsideDir)).toEqual(["outside.txt"]);
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
    // It puts back what the killed run changed, then renames (#604).
    expect(rerun.err).toMatch(/^note: story rename character ilya-venn stopped part way, so this first put back the \d+ files it had changed\n$/);
    expect(rerun.code).toBe(0);
    expect(listDir(root, "characters")).toEqual(["_index.md", "zed-quill.md"]);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });
});

describe("interrupted move (#191, #193, #194)", () => {
  // Runs `check` on the project a move stopped part way, and on a copy
  // without its undo log, as a move by an older story left it. A rerun
  // finishes the move either way: with the log it puts back what the
  // stopped run changed and moves again (#604), and without one it finishes
  // where the run stopped.
  function withAndWithoutLog(root, check) {
    const copy = path.join(makeTempDir(), "copy");
    fs.cpSync(root, copy, { recursive: true });
    fs.rmSync(path.join(copy, ".story-undo.tmp"));
    check(root);
    check(copy);
  }

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
    withAndWithoutLog(root, (project) => {
      expect(moveEntity(project, { kind: "chapter", id: "chapter-01", number: 5 }).id).toBe("chapter-05");
      expect(listDir(project, "chapters")).toEqual(["_index.md", "chapter-02.md", "chapter-03.md", "chapter-05.md"]);
      expect(listDir(project, "scenes")).toEqual(["_index.md", "chapter-02-scene-01.md", "chapter-02-scene-02.md", "chapter-05-scene-01.md"]);
      expect(messages(validateLinks(project).errors)).toEqual([]);
    });
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
    withAndWithoutLog(root, (project) => {
      const rerun = invoke(project, ["move", "scene", "chapter-02-scene-02", "--chapter", "chapter-01"]);
      expect(rerun.out).toContain("to chapter-01-scene-02");
      expect(listDir(project, "scenes")).toEqual(["_index.md", "chapter-01-scene-01.md", "chapter-01-scene-02.md", "chapter-02-scene-01.md"]);
      expect(messages(validateLinks(project).errors)).toEqual([]);
    });
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

  test("the names NTFS, vfat and HFS+ read as .git count as .git on every system (#603)", () => {
    // Linux reaches each of these disks too (WSL's /mnt/c, a USB stick, an
    // hfsplus mount), so every rule applies everywhere.
    for (const name of [
      ".git", ".GIT", ".git.", ".git ", ".git. ", "GIT~1", "git~2", "GIT~1.",
      ".git::$INDEX_ALLOCATION", ".GIT:$I30:$INDEX_ALLOCATION", ".git:notes", ".git. ::$INDEX_ALLOCATION", "GIT~1::$INDEX_ALLOCATION",
      ".g\u200Cit", "\uFEFF.git", ".GI\u200ET", ".git\u200D", ".\u202Eg\u206Ait", ".git\u200B."
    ]) {
      expect(isGitDirectoryName(name), JSON.stringify(name)).toBe(true);
    }
    for (const name of [
      ".github", ".gitignore", "repo.git", "git", "git~", ".git~1",
      ".github:x", ".gitignore::$DATA", "repo.git:x", "x:.git", "git:x",
      ".g\u200Cithub", "repo\u200C.git", ".gi\u200Bt\u00ADignore"
    ]) {
      expect(isGitDirectoryName(name), JSON.stringify(name)).toBe(false);
    }
    expect(fileSystemName("Story.MD::$DATA")).toBe("story.md");
    // NTFS short names: six letters, `~N`, and three of the extension.
    for (const [name, longName] of [["git~1", ".git"], ["git~12", ".git"], ["chapte~1", "chapters"], ["worldb~3", "worldbuilding"], ["style-~1.md", "style-sheet.md"], ["story~1.md", "story.md"]]) {
      expect(isShortNameOf(name, longName), `${name} ${longName}`).toBe(true);
    }
    for (const [name, longName] of [["gi~1", ".git"], ["chap~1", "chapters"], ["chapter~1", "chapters"], ["chapte~1.md", "chapters"], ["style-~1", "style-sheet.md"], ["ch1a2b~1", "chapters"], ["chapte~", "chapters"], ["chapters", "chapters"]]) {
      expect(isShortNameOf(name, longName), `${name} ${longName}`).toBe(false);
    }
    expect(fileSystemName("Chap\u200Cters. ")).toBe("chapters");
  });

  test("a name a file system reads its own way is refused before anything resolves it (#603)", () => {
    const root = gitProject();
    // As on Windows, where `story.md::$DATA` is story.md's text: the path
    // exists, but its real path may be refused outright.
    const stream = (target) => String(target).includes("::$");
    const existsSync = fs.existsSync;
    const realpath = fs.realpathSync.native;
    const exists = spyOn(fs, "existsSync").mockImplementation((target) => stream(target) || existsSync(target));
    const resolve = spyOn(fs.realpathSync, "native").mockImplementation((target, ...rest) => {
      if (stream(target)) {
        throw Object.assign(new Error(`EINVAL: invalid argument, realpath '${target}'`), { code: "EINVAL" });
      }
      return realpath(target, ...rest);
    });
    try {
      expect(isInsideGitDirectory(path.join(root, ".git::$INDEX_ALLOCATION", "config"), root)).toBe(true);
      for (const [out, message] of [
        [".git::$INDEX_ALLOCATION/config", "it is inside a .git folder"],
        ["story.md::$DATA", "it is project source"],
        ["chapters::$INDEX_ALLOCATION/chapter-01.md", "it is project source"]
      ]) {
        const result = invoke(root, ["export", ".", "--out", out]);
        expect(result.code, out).toBe(4);
        expect(result.err, out).toContain(message);
      }
      expect(resolve.mock.calls.filter(([target]) => stream(target))).toEqual([]);
    } finally {
      exists.mockRestore();
      resolve.mockRestore();
    }
  });

  test("--out, init and import refuse every name a disk reads as .git, relative or absolute, dry run or not (#603)", () => {
    const root = gitProject();
    const manuscript = path.join(makeTempDir(), "book.md");
    fs.writeFileSync(manuscript, "# Chapter 1\n\nThe tide came in.\n");
    const tree = () => fs.readdirSync(root, { recursive: true }).map(String).sort();
    const before = tree();
    const outside = "it is inside a .git folder. Choose a path outside .git";
    const nested = "Refusing to create a story project inside a .git folder";
    for (const name of [".git::$INDEX_ALLOCATION", ".git:$I30:$INDEX_ALLOCATION", "GIT~1::$INDEX_ALLOCATION", "GIT~1", ".git.", ".g\u200Cit", "\uFEFF.git", ".GI\u200ET"]) {
      for (const at of [(file) => `${name}/${file}`, (file) => path.join(root, name, file)]) {
        for (const dryRun of [[], ["--dry-run"]]) {
          for (const [argv, message] of [
            [["export", ".", "--out", at("config")], outside],
            [["build", ".", "--format", "html", "--out", at("config")], outside],
            [["init", "Inner", "--dir", at("inner")], nested],
            [["import", manuscript, "--title", "Inner", "--dir", at("inner")], nested]
          ]) {
            const label = JSON.stringify([...argv, ...dryRun]);
            const result = invoke(root, [...argv, ...dryRun]);
            expect(result.code, label).toBe(4);
            expect(result.err, label).toContain(message);
          }
        }
      }
    }
    expect(read(root, ".git/config")).toBe("[core]\n\tbare = false\n");
    expect(listDir(root, ".git")).toEqual(["config"]);
    expect(tree()).toEqual(before);
  });

  test("--out names project source under the names NTFS, vfat and HFS+ read as it, short names included (#603)", () => {
    const root = gitProject();
    // Hand-edited notes under names that HFS+ or NTFS reads as feedback/
    // and submission/.
    for (const folder of ["feedback\u200B", "SUBMIS~1"]) {
      fs.mkdirSync(path.join(root, folder));
      fs.writeFileSync(path.join(root, folder, "notes.md"), "Keep.\n");
    }
    const tree = () => fs.readdirSync(root, { recursive: true }).map(String).sort();
    const before = tree();
    for (const out of ["story.md::$DATA", "Story.md.", "style-sheet.md ", "progress.md:x", "STYLE-~1.MD", "CHAPTE~1/x.md", "worldb~1/x.md", "chapters::$INDEX_ALLOCATION/chapter-01.md", "chap\u200Cters/x.md", "Chapters./x.md", "\uFEFFplot/s.md"]) {
      for (const at of [out, path.join(root, out)]) {
        const result = invoke(root, ["export", ".", "--out", at]);
        expect(result.code, JSON.stringify(at)).toBe(4);
        expect(result.err, JSON.stringify(at)).toContain("it is project source");
      }
    }
    for (const kept of ["feedback\u200B/notes.md", "SUBMIS~1/notes.md"]) {
      const result = invoke(root, ["export", ".", "--out", kept]);
      expect(result.code, kept).toBe(4);
      expect(result.err, kept).toContain("may hold hand-written work");
      expect(read(root, kept)).toBe("Keep.\n");
    }
    expect(tree()).toEqual(before);
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

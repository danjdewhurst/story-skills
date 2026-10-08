import { describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCli } from "../src/cli.js";
import {
  MAX_READ_BYTES,
  forEachLine,
  readFileBytes,
  readFilePrefix,
  readTextFile,
  removeDirectory,
  removeFile,
  syncFolder,
  writeFile,
  fileSystemName,
  isGitDirectoryName,
  isInsideGitDirectory,
  isShortNameOf
} from "../src/files.js";
import { computeWordCounts, createEntity, createStoryProject, exportManuscript, validateLinks, validateProject } from "../src/story.js";
import { CHMOD_IGNORED, makeTempDir, memoryIo, messages } from "./helpers.js";

const SRC = path.join(import.meta.dir, "..", "src");

// Windows has no O_NOFOLLOW and no FIFOs, so the checks a file swapped in
// after the lstat would meet there are the lstat's own.
const POSIX = process.platform !== "win32";

const MKFIFO = POSIX && spawnSync("mkfifo", ["--help"]).error === undefined;

// Runs `run` while lstat reports `file` as the regular file `standIn`, as it
// was when a command checked it, before something swapped it out.
function checkedAsFile(file, standIn, run) {
  const lstat = fs.lstatSync;
  const spy = spyOn(fs, "lstatSync").mockImplementation((target, ...rest) => lstat(target === file ? standIn : target, ...rest));
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

const BIN = path.join(import.meta.dir, "..", "bin", "story.js");

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function safetyProject(title = "Safety") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function readProjectFile(root, file) {
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

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

function appendProse(root, file, prose) {
  fs.appendFileSync(path.join(root, file), `\n${prose}\n`);
}

describe("bounded reads (#548)", () => {
  test.skipIf(!POSIX)("a symlink swapped in after the check is refused, not followed", () => {
    const dir = makeTempDir();
    const outside = path.join(makeTempDir(), "secret.md");
    fs.writeFileSync(outside, "secret\n");
    const link = path.join(dir, "chapter.md");
    fs.symlinkSync(outside, link);
    expect(() => checkedAsFile(link, outside, () => readTextFile(link))).toThrow(`${link}: Refusing to read through symlink`);
  });

  test.skipIf(!fs.existsSync("/dev/null"))("a device swapped in after the check is refused, not read", () => {
    const standIn = path.join(makeTempDir(), "plain.md");
    fs.writeFileSync(standIn, "plain\n");
    expect(() => checkedAsFile("/dev/null", standIn, () => readTextFile("/dev/null"))).toThrow("/dev/null: Refusing to read: not a regular file");
  });

  test.skipIf(!MKFIFO)("a FIFO swapped in after the check is refused without waiting for a writer", () => {
    const dir = makeTempDir();
    const standIn = path.join(dir, "plain.md");
    fs.writeFileSync(standIn, "plain\n");
    const fifo = path.join(dir, "chapter.md");
    expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
    // In a child, so an open that waits for a writer fails the test rather
    // than stalling the suite.
    const script = `
      const fs = (await import("node:fs")).default;
      const { readTextFile } = await import(${JSON.stringify(pathToFileURL(path.join(SRC, "files.js")).href)});
      const lstat = fs.lstatSync;
      fs.lstatSync = (target, ...rest) => {
        if (target !== ${JSON.stringify(fifo)}) {
          return lstat(target, ...rest);
        }
        console.log("checked as a file");
        return lstat(${JSON.stringify(standIn)}, ...rest);
      };
      try {
        readTextFile(${JSON.stringify(fifo)});
      } catch (error) {
        console.log(error.message);
      }
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 20000 });
    expect(result.signal).toBeNull();
    // The marker shows the check passed, so the open is what refused it.
    expect(result.stdout.trim().split("\n")).toEqual(["checked as a file", `${fifo}: Refusing to read: not a regular file`]);
  });

  test("a file that grew past the cap after the check is refused, and one at the cap is read", () => {
    const dir = makeTempDir();
    const small = path.join(dir, "small.md");
    fs.writeFileSync(small, "0123456789");
    expect(readFileBytes(small, 10).toString()).toBe("0123456789");
    const grown = path.join(dir, "grown.md");
    fs.writeFileSync(grown, "x".repeat(100));
    expect(() => checkedAsFile(grown, small, () => readFileBytes(grown, 10))).toThrow(`${grown}: Refusing to read oversized file: it grew past the 10 byte limit while story was reading it`);
  });

  test.skipIf(!fs.existsSync("/proc/self/status"))("a file whose size the system does not report is read to its end, within the cap", () => {
    // /proc files report a size of 0, so the first buffer holds one byte and
    // the rest arrives in later chunks.
    expect(fs.lstatSync("/proc/self/status").size).toBe(0);
    const text = readTextFile("/proc/self/status");
    expect(text.startsWith("Name:")).toBe(true);
    expect(text.length).toBeGreaterThan(100);
    // The cap holds for those later chunks too.
    expect(() => readFileBytes("/proc/self/status", 50)).toThrow("/proc/self/status: Refusing to read oversized file: it grew past the 50 byte limit while story was reading it");
  });

  test("readFilePrefix reads only the start of a file of any size, and refuses what readFileBytes refuses", () => {
    const dir = makeTempDir();
    const page = path.join(dir, "page.html");
    fs.writeFileSync(page, `<head>${" ".repeat(MAX_READ_BYTES)}</head>`);
    expect(readFilePrefix(page, 6).toString()).toBe("<head>");
    const short = path.join(dir, "short.html");
    fs.writeFileSync(short, "<p>");
    expect(readFilePrefix(short, 4096).toString()).toBe("<p>");
    expect(() => readFilePrefix(dir, 10)).toThrow(`${dir}: Refusing to read: not a regular file`);
  });

  test.skipIf(!POSIX)("writeFile does not follow a symlink swapped in for a file it read", () => {
    const root = makeTempDir();
    const file = path.join(root, "notes.md");
    fs.writeFileSync(file, "first\n");
    // A file outside the project with the text the command read.
    const outside = path.join(makeTempDir(), "notes.md");
    fs.writeFileSync(outside, "first\n");
    const fsync = fs.fsyncSync;
    const spy = spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      fs.rmSync(file);
      fs.symlinkSync(outside, file);
      return fsync(descriptor);
    });
    try {
      expect(() => writeFile(file, "rewritten\n", { root, unchangedFrom: "first\n" })).toThrow("notes.md changed on disk while story was updating it");
    } finally {
      spy.mockRestore();
    }
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(outside, "utf8")).toBe("first\n");
    expect(fs.readdirSync(root).filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  test.skipIf(!POSIX)("writeFile refuses when a folder on the way is swapped for a symlink out of the project mid-write", () => {
    const root = makeTempDir();
    const folder = path.join(root, "notes");
    fs.mkdirSync(folder);
    const outside = makeTempDir();
    // The folder is swapped after the checks, just before the temporary
    // file is made, so the temporary file lands outside.
    const open = fs.openSync;
    const spy = spyOn(fs, "openSync").mockImplementation((file, flags, ...rest) => {
      if (flags === "wx" && path.dirname(file) === folder) {
        fs.renameSync(folder, `${folder}-moved`);
        fs.symlinkSync(outside, folder);
      }
      return open(file, flags, ...rest);
    });
    try {
      expect(() => writeFile(path.join(folder, "idea.md"), "idea\n", { root })).toThrow("Refusing to write notes/idea.md: a folder on its path was replaced while story was writing it and now leads outside the project");
    } finally {
      spy.mockRestore();
    }
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

// Runs `run` and returns the changes it made and the folders it flushed, in
// order: ["mkdir", folder], ["rename", target], ["rm", file], ["rmdir",
// folder], or ["flush", folder] for an fsync of a descriptor opened on a
// folder.
function changesAndFlushes(run) {
  const real = { openSync: fs.openSync, fsyncSync: fs.fsyncSync, mkdirSync: fs.mkdirSync, renameSync: fs.renameSync, rmSync: fs.rmSync, rmdirSync: fs.rmdirSync };
  const events = [];
  const folders = new Map();
  const spies = [
    spyOn(fs, "openSync").mockImplementation((file, ...rest) => {
      const descriptor = real.openSync(file, ...rest);
      folders.set(descriptor, fs.statSync(file).isDirectory() ? file : null);
      return descriptor;
    }),
    spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      if (folders.get(descriptor)) {
        events.push(["flush", folders.get(descriptor)]);
      }
      return real.fsyncSync(descriptor);
    }),
    spyOn(fs, "mkdirSync").mockImplementation((folder, ...rest) => {
      events.push(["mkdir", folder]);
      return real.mkdirSync(folder, ...rest);
    }),
    spyOn(fs, "renameSync").mockImplementation((from, to) => {
      events.push(["rename", to]);
      return real.renameSync(from, to);
    }),
    spyOn(fs, "rmSync").mockImplementation((file, ...rest) => {
      events.push(["rm", file]);
      return real.rmSync(file, ...rest);
    }),
    spyOn(fs, "rmdirSync").mockImplementation((folder, ...rest) => {
      events.push(["rmdir", folder]);
      return real.rmdirSync(folder, ...rest);
    })
  ];
  try {
    run();
  } finally {
    for (const spy of spies) {
      spy.mockRestore();
    }
  }
  return events;
}

describe("folder flushes (#604)", () => {
  test.skipIf(!POSIX)("a write, a delete, and a new folder flush the folder they change, after the change", () => {
    const root = makeTempDir();
    const notes = path.join(root, "notes");
    const file = path.join(notes, "idea.md");
    expect(changesAndFlushes(() => writeFile(file, "idea\n", { root }))).toEqual([["mkdir", notes], ["flush", root], ["rename", file], ["flush", notes]]);
    expect(changesAndFlushes(() => writeFile(file, "idea, revised\n", { root }))).toEqual([["rename", file], ["flush", notes]]);
    expect(changesAndFlushes(() => removeFile(file))).toEqual([["rm", file], ["flush", notes]]);
    // Nothing to delete, so nothing to flush.
    expect(changesAndFlushes(() => removeFile(file, { force: true }))).toEqual([["rm", file]]);
    expect(changesAndFlushes(() => removeDirectory(notes))).toEqual([["rmdir", notes], ["flush", root]]);
  });

  test("syncFolder skips Windows, which cannot open a folder, and leaves a folder it cannot open or flush as it is", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "notes.md");
    fs.writeFileSync(file, "notes\n");
    const open = spyOn(fs, "openSync");
    const flush = spyOn(fs, "fsyncSync");
    try {
      syncFolder(dir, "win32");
      expect(open).not.toHaveBeenCalled();
      // A missing folder, and a file, which O_DIRECTORY refuses to open, so
      // it is never flushed.
      expect(() => syncFolder(path.join(dir, "missing"))).not.toThrow();
      expect(() => syncFolder(file)).not.toThrow();
      expect(flush).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      flush.mockRestore();
    }
  });

  // Only where syncFolder opens a folder: Windows returns before it does.
  test.skipIf(!POSIX)("a folder flush that fails still closes the folder", () => {
    const dir = makeTempDir();
    // Too many open files, or a file system that cannot flush a folder.
    let opened = null;
    const realOpen = fs.openSync;
    const spies = [
      spyOn(fs, "openSync").mockImplementation((...args) => {
        opened = realOpen(...args);
        return opened;
      }),
      spyOn(fs, "fsyncSync").mockImplementation(() => {
        throw Object.assign(new Error("EMFILE"), { code: "EMFILE" });
      }),
      spyOn(fs, "closeSync")
    ];
    try {
      expect(() => syncFolder(dir)).not.toThrow();
      expect(spies[2]).toHaveBeenCalledWith(opened);
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });

  test.skipIf(!MKFIFO)("syncFolder never waits on a FIFO put in a folder's place", () => {
    const fifo = path.join(makeTempDir(), "chapters");
    expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
    // In a child, so an open that waits for a writer fails the test rather
    // than stalling the suite.
    const script = `
      const { syncFolder } = await import(${JSON.stringify(pathToFileURL(path.join(SRC, "files.js")).href)});
      syncFolder(${JSON.stringify(fifo)});
      console.log("returned");
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 20000 });
    expect(result.signal).toBeNull();
    expect(result.stdout.trim()).toBe("returned");
  });

  test("forEachLine reads whole lines a chunk at a time, leaves out an unfinished end, and refuses a line over its limit", () => {
    const file = path.join(makeTempDir(), "log.tmp");
    // Longer than one chunk, so it spans two reads.
    const long = "y".repeat(70 * 1024);
    fs.writeFileSync(file, `a\n${long}\n\nb\nunfinished`);
    const lines = [];
    forEachLine(file, 100 * 1024, (line, number) => lines.push([number, line.toString()]));
    expect(lines).toEqual([[1, "a"], [2, long], [3, ""], [4, "b"]]);
    expect(() => forEachLine(file, 1000, () => {})).toThrow(expect.objectContaining({ longLine: 2, message: `${file}: line 2 is longer than 1000 bytes` }));
    // An unfinished end over the limit is refused too, as the line it starts.
    fs.writeFileSync(file, "z".repeat(2000));
    expect(() => forEachLine(file, 1000, () => {})).toThrow(expect.objectContaining({ longLine: 1 }));
  });
});

// Every read of a file a project (or a cloned repository) controls goes
// through readFileBytes, readTextFile, or readFilePrefix in src/files.js,
// which refuse a symlink, a FIFO, a device, and an oversized file. A raw
// read elsewhere can hang a command on a FIFO or /dev/zero, or read a file
// outside the project. The entries below are the only lines in src/ that
// may name a raw read, files.js included, each with the reason, sorted by
// file and then by line.
const ALLOWED_RAW_READS = [
  // The guarded reads themselves: the open in openRegularFile, and the
  // bounded reads of readFilePrefix and readAtMost.
  ["files.js", "read = fs.readSync(descriptor, buffer, filled, length - filled, null);"],
  // forEachLine reads through openRegularFile, a chunk at a time.
  ["files.js", "while ((read = fs.readSync(descriptor, chunk, 0, chunk.length, null)) > 0) {"],
  ["files.js", "descriptor = fs.openSync(filePath, SAFE_READ_FLAGS);"],
  ["files.js", "read = fs.readSync(descriptor, buffer, filled, buffer.length - filled, null);"],
  // syncFolder opens a folder only to flush it, never reading it, and
  // O_DIRECTORY refuses anything else at the name.
  ["files.js", "descriptor = fs.openSync(directory, FOLDER_FLAGS);"],
  // writeWholeFile's temporary file: "wx" makes a new file and never opens
  // one already at the name, symlink or not.
  ["files.js", 'const descriptor = fs.openSync(temporary, "wx", mode);'],
  // An undo log is made the same way, and only appended to.
  ["files.js", 'log.descriptor = fs.openSync(path.join(log.root, UNDO_LOG), "ax", 0o600);'],
  // Creates the lock the same way. lock.js reads the lock through files.js.
  ["lock.js", 'const descriptor = fs.openSync(lockPath, "wx", 0o644);'],
  // The PDF engine's log and the PDF it wrote, in a folder this run made
  // with mkdtemp, which nothing in the project can reach.
  ["pdf.js", 'const log = fs.openSync(logFile, "w");'],
  ["pdf.js", 'const detail = lastLines(fs.readFileSync(logFile, "utf8"));'],
  ["pdf.js", "const pdf = fs.existsSync(output) ? fs.readFileSync(output) : null;"],
  // Standard input, not a file: read in chunks under its own size cap.
  ["stdin.js", "export function readStdin(command, { fd = 0, isatty = tty.isatty, readSync = fs.readSync, maxBytes = MAX_STDIN_BYTES } = {}) {"],
  ["stdin.js", "read = readSync(fd, buffer, 0, buffer.length, null);"]
];

// The fs functions that open or read a file's contents, matched by name
// wherever they appear (fs.readFileSync, a destructured readFileSync, or
// fs["readFileSync"]), and fs.open, fs.read, and fs.promises, whose names
// are too common to match alone, after fs. or fs[ across line breaks.
// fs.cpSync is not one: it copies a symlink as a link and refuses a FIFO.
const RAW_READ = /\b(?:readFileSync|readFile|openSync|readSync|readvSync|readv|copyFileSync|copyFile|createReadStream|openAsBlob)\b|\bfs\s*(?:\.|\[\s*["'`])\s*(?:open|read|promises)\b/g;

// Any way of naming the fs module: an import, a dynamic import, require.
const FS_MODULE = /["'`](?:node:)?fs(?:\/promises)?["'`]/g;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : entry.name.endsWith(".js") ? [full] : [];
  });
}

// The trimmed text of each line on which `pattern` matches `source`, in
// order, once per line. Two identical lines are two entries, since each is a
// line of its own; a line that matches twice is still one. Whole-line
// comments are blanked first, keeping the line numbers.
function matchingLines(source, pattern) {
  const lines = source.split("\n").map((line) => (line.trim().startsWith("//") ? "" : line));
  const code = lines.join("\n");
  const numbers = new Set();
  for (const match of code.matchAll(pattern)) {
    numbers.add(code.slice(0, match.index).split("\n").length - 1);
  }
  return [...numbers].map((index) => lines[index].trim());
}

describe("raw reads (#548)", () => {
  test("src/ reads files only through the guarded reads in src/files.js, apart from the listed exceptions", () => {
    const found = [];
    for (const file of sourceFiles(SRC).sort()) {
      const name = path.relative(SRC, file).split(path.sep).join("/");
      const source = fs.readFileSync(file, "utf8");
      // Every module reaches fs through its default import, so the names
      // above are all the ways it can read.
      for (const line of matchingLines(source, FS_MODULE)) {
        expect({ name, line }).toEqual({ name, line: 'import fs from "node:fs";' });
      }
      found.push(...matchingLines(source, RAW_READ).map((line) => [name, line]));
    }
    expect(found).toEqual(ALLOWED_RAW_READS);
  });

  test("the scan finds a raw read however it is written", () => {
    const cases = [
      "const { readFileSync } = fs;",
      'const text = fs["readFileSync"](file);',
      "const text = fs\n  .readFileSync(file);",
      "fs.read(descriptor, buffer, 0, 1, null, done);",
      "const descriptor = fs [ 'open' ](file);",
      "await fs.promises.readFile(file);",
      "fs.copyFileSync(from, to);"
    ];
    for (const source of cases) {
      expect({ source, found: matchingLines(source, RAW_READ).length }).toEqual({ source, found: 1 });
    }
    for (const source of ["import { readFileSync } from 'node:fs';", 'const { open } = await import("node:fs/promises");', 'const fs = require("fs");']) {
      expect({ source, found: matchingLines(source, FS_MODULE).length }).toEqual({ source, found: 1 });
    }
    // Comments, and names that only start like one, are not reads.
    expect(matchingLines("// fs.readFileSync(0)\nfs.readdirSync(dir);\nfs.readlinkSync(link);\nproject.promises;", RAW_READ)).toEqual([]);
  });

  test("the scan counts two identical reads as two, so an allowed line cannot hide a second read (#749)", () => {
    const read = 'const text = fs.readFileSync(file, "utf8");';
    expect(matchingLines(`${read}\n${read}`, RAW_READ)).toEqual([read, read]);
  });
});

describe("atomic writes (#190, #197)", () => {
  test("a write that fails partway leaves the chapter whole and names it", () => {
    if (process.platform === "win32") {
      return;
    }
    const root = safetyProject();
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
    const root = safetyProject();
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
    const root = safetyProject();
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
    expect(readProjectFile(root, "chapters/chapter-01.md")).toContain("word-count: 3");
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
    const root = safetyProject();
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
    expect(readProjectFile(root, "chapters/chapter-01.md")).not.toContain("word-count: 3");
  });

  // Windows has no FIFOs.
  const plantings = [
    ["a file", (planted) => fs.writeFileSync(planted, "someone else's")],
    ["a folder", (planted) => fs.mkdirSync(planted)],
    ...(process.platform === "win32" ? [] : [["a FIFO", (planted) => expect(spawnSync("mkfifo", [planted]).status).toBe(0)]])
  ];

  test.each(plantings)("%s at the name a write picks gets a plain refusal, and a rerun writes (#602)", (_kind, plant) => {
    const root = safetyProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), "\nThe ember woke.\n");
    const chapter = readProjectFile(root, "chapters/chapter-01.md");
    const registry = readProjectFile(root, "chapters/_index.md");
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
    expect(readProjectFile(root, "chapters/chapter-01.md")).toBe(chapter);
    expect(readProjectFile(root, "chapters/_index.md")).toBe(registry);
    // Not this write's, so it is neither written nor removed.
    const after = fs.lstatSync(planted);
    expect([after.ino, after.mode, after.size]).toEqual([before.ino, before.mode, before.size]);

    // A rerun picks another name.
    expect(invoke(parent, ["wordcount", book, "--write"]).code).toBe(0);
    expect(readProjectFile(root, "chapters/chapter-01.md")).toContain("word-count: 3");
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
    const root = safetyProject();
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
    const root = safetyProject();
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
    const root = safetyProject();
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
    const root = safetyProject();
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
    expect(readProjectFile(root, ".git/config")).toBe("[core]\n\tbare = false\n");
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
    expect(readProjectFile(root, ".git/config")).toBe("[core]\n\tbare = false\n");
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
      expect(readProjectFile(root, kept)).toBe("Keep.\n");
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

describe("sweep fixes", () => {
  test("symlinked exemptions, timeline, and linked story files are never followed", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const outside = path.join(makeTempDir(), "outside.md");
    fs.writeFileSync(outside, "---\nexemptions:\n  - pattern: secret-pattern\n    reason: outside file\n---\n");
    fs.symlinkSync(outside, path.join(root, "continuity", "exemptions.md"));
    fs.rmSync(path.join(root, "plot", "timeline.md"));
    fs.symlinkSync("/dev/zero", path.join(root, "plot", "timeline.md"));
    // In a child, so a read that never ends fails the test rather than
    // stalling the suite. The child times its own calls, so the 5 s bound
    // covers the work and not the child's start-up.
    const script = `
      const story = await import(${JSON.stringify(pathToFileURL(path.join(SRC, "story.js")).href)});
      const root = process.argv[1];
      const started = performance.now();
      const total = story.computeWordCounts(root).total;
      const linksOk = story.validateLinks(root).ok;
      const errors = story.validateProject(root).errors.map((finding) => finding.message);
      console.log(JSON.stringify({ total, linksOk, errors, elapsed: performance.now() - started }));
    `;
    const result = spawnSync(process.execPath, ["-e", script, root], { encoding: "utf8", timeout: 20000 });
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    const outcome = JSON.parse(result.stdout);
    expect(outcome.total).toBe(0);
    expect(outcome.linksOk).toBe(false);
    expect(outcome.errors.join("\n")).toContain("through symlink");
    expect(outcome.elapsed).toBeLessThan(5000);
  });

  test("--out through a hard link replaces the link instead of the chapter", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    const before = fs.readFileSync(chapter, "utf8");
    const link = path.join(makeTempDir(), "hard.md");
    fs.linkSync(chapter, link);
    exportManuscript(root, { out: link });
    expect(fs.readFileSync(chapter, "utf8")).toBe(before);
    expect(fs.readFileSync(link, "utf8")).toContain("Generated by story export");
  });

  test("a failed write leaves no temporary file behind", async () => {
    const { writeFile } = await import("../src/story.js");
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, "target"));
    fs.writeFileSync(path.join(dir, "target", "keep.md"), "x");
    expect(() => writeFile(path.join(dir, "target"), "text")).toThrow();
    expect(fs.readdirSync(dir)).toEqual(["target"]);
  });

  test("writes keep file permissions and refuse read-only files", () => {
    if (CHMOD_IGNORED) {
      return;
    }
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "Some words here.");
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.chmodSync(chapter, 0o444);
    expect(() => computeWordCounts(root, { write: true })).toThrow("EACCES");
    fs.chmodSync(chapter, 0o600);
    computeWordCounts(root, { write: true });
    expect(fs.statSync(chapter).mode & 0o777).toBe(0o600);
  });

  test("a hard-linked target is replaced with its permissions kept", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const outDir = makeTempDir();
    const target = path.join(outDir, "book.md");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o640);
    fs.linkSync(target, path.join(outDir, "other.md"));
    exportManuscript(root, { out: target });
    if (!CHMOD_IGNORED) {
      expect(fs.statSync(target).mode & 0o777).toBe(0o640);
    }
    expect(fs.readFileSync(path.join(outDir, "other.md"), "utf8")).toBe("old");
    expect(fs.readdirSync(outDir).sort()).toEqual(["book.md", "other.md"]);
  });

  test("a failed hard-link replacement leaves no temporary file", async () => {
    if (CHMOD_IGNORED) {
      return;
    }
    const { writeFile } = await import("../src/story.js");
    const dir = makeTempDir();
    const target = path.join(dir, "book.md");
    fs.writeFileSync(target, "old");
    fs.linkSync(target, path.join(makeTempDir(), "elsewhere.md"));
    fs.chmodSync(dir, 0o555);
    try {
      expect(() => writeFile(target, "new")).toThrow();
      expect(fs.readdirSync(dir)).toEqual(["book.md"]);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  test("a failed hard-link replacement names the target", async () => {
    if (CHMOD_IGNORED) {
      return;
    }
    const { writeFile } = await import("../src/story.js");
    const dir = makeTempDir();
    const target = path.join(dir, "book.md");
    fs.writeFileSync(target, "old");
    fs.linkSync(target, path.join(makeTempDir(), "elsewhere.md"));
    fs.chmodSync(dir, 0o555);
    try {
      expect(() => writeFile(target, "new")).toThrow(`Cannot replace hard-linked ${target}: EACCES`);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });
});

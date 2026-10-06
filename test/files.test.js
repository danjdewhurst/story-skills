import { describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MAX_READ_BYTES, readFileBytes, readFilePrefix, readTextFile, writeFile } from "../src/files.js";
import { makeTempDir } from "./helpers.js";

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
  ["files.js", "descriptor = fs.openSync(filePath, SAFE_READ_FLAGS);"],
  ["files.js", "read = fs.readSync(descriptor, buffer, filled, buffer.length - filled, null);"],
  // writeWholeFile's temporary file: "wx" makes a new file and never opens
  // one already at the name, symlink or not.
  ["files.js", 'const descriptor = fs.openSync(temporary, "wx", mode);'],
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

// The trimmed lines on which `pattern` matches `source`, once each, in
// order. Whole-line comments are blanked first, keeping the line numbers.
function matchingLines(source, pattern) {
  const lines = source.split("\n").map((line) => (line.trim().startsWith("//") ? "" : line));
  const code = lines.join("\n");
  const found = new Set();
  for (const match of code.matchAll(pattern)) {
    found.add(lines[code.slice(0, match.index).split("\n").length - 1].trim());
  }
  return [...found];
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
});

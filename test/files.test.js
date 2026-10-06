import { describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFileBytes, readTextFile, writeFile } from "../src/files.js";
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
      fs.lstatSync = (target, ...rest) => lstat(target === ${JSON.stringify(fifo)} ? ${JSON.stringify(standIn)} : target, ...rest);
      try {
        readTextFile(${JSON.stringify(fifo)});
      } catch (error) {
        console.log(error.message);
      }
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 20000 });
    expect(result.signal).toBeNull();
    expect(result.stdout.trim()).toBe(`${fifo}: Refusing to read: not a regular file`);
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

  test.skipIf(!fs.existsSync("/proc/self/status"))("a file whose size the system does not report is read to its end", () => {
    // /proc files report a size of 0, so the read cannot size its buffer.
    expect(fs.lstatSync("/proc/self/status").size).toBe(0);
    const text = readTextFile("/proc/self/status");
    expect(text.startsWith("Name:")).toBe(true);
    expect(text.length).toBeGreaterThan(100);
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
});

// Every read of a file a project (or a cloned repository) controls goes
// through readFileBytes or readTextFile in src/files.js, which refuse a
// symlink, a FIFO, a device, and an oversized file. A raw read elsewhere can
// hang a command on a FIFO or /dev/zero, or read a file outside the project.
// The entries below are the reads that never touch such a file, each with
// the reason, sorted by file.
const ALLOWED_RAW_READS = [
  // Creates the lock: "wx" makes a new file and never opens one already at
  // the name, symlink or not. lock.js reads the lock through files.js.
  ["lock.js", 'const descriptor = fs.openSync(lockPath, "wx", 0o644);'],
  // The PDF engine's log and the PDF it wrote, in a folder this run made
  // with mkdtemp, which nothing in the project can reach.
  ["pdf.js", 'const log = fs.openSync(logFile, "w");'],
  ["pdf.js", 'const detail = lastLines(fs.readFileSync(logFile, "utf8"));'],
  ["pdf.js", "const pdf = fs.existsSync(output) ? fs.readFileSync(output) : null;"],
  // Standard input, not a file: read in chunks under its own size cap.
  ["stdin.js", "export function readStdin(command, { fd = 0, isatty = tty.isatty, readSync = fs.readSync, maxBytes = MAX_STDIN_BYTES } = {}) {"]
];

// fs calls that open or read a file's contents. fs.cpSync is not one: it
// copies a symlink as a link and refuses a FIFO.
const RAW_READ = /\bfs\.(?:readFileSync|readFile|openSync|open|readSync|read|readvSync|readv|copyFileSync|copyFile|createReadStream|promises)\b/;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : entry.name.endsWith(".js") ? [full] : [];
  });
}

describe("raw reads (#548)", () => {
  test("src/ reads files only through src/files.js, apart from the listed exceptions", () => {
    const found = [];
    for (const file of sourceFiles(SRC).sort()) {
      const name = path.relative(SRC, file).split(path.sep).join("/");
      if (name === "files.js") {
        continue;
      }
      for (const line of fs.readFileSync(file, "utf8").split("\n").map((text) => text.trim())) {
        if (line.startsWith("//")) {
          continue;
        }
        // Every module reaches fs through its default import, so a named
        // import or fs/promises could hide a read from the pattern.
        if (/from "(?:node:)?fs(?:\/promises)?"/.test(line)) {
          expect({ name, line }).toEqual({ name, line: 'import fs from "node:fs";' });
        }
        if (RAW_READ.test(line)) {
          found.push([name, line]);
        }
      }
    }
    expect(found).toEqual(ALLOWED_RAW_READS);
  });
});

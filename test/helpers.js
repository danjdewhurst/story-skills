import { expect, spyOn } from "bun:test";
import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { TEMPORARY_FILE_PATTERN } from "../src/files.js";

const tempDirs = [];

// Whether chmod cannot take access away: root reads and writes anything,
// and Windows has no POSIX modes (chmod only sets a file's read-only flag,
// and is ignored on folders). Tests that make a file or folder unreadable or
// unwritable skip when it is true.
export const CHMOD_IGNORED = process.getuid?.() === 0 || process.platform === "win32";

// The script of the sleeper otherLivePid starts. Each second it checks that
// the process whose pid is its first argument, the one that started it, is
// still there, and exits once it is gone: bun test runs no exit handlers,
// so nothing else ends it when the run ends. EPERM means a process has the
// pid but this user may not signal it, as in src/lock.js. It exits after 30
// minutes whatever happens, in case another process takes the pid.
export const SLEEPER_SCRIPT = `const parent = Number(process.argv[1]);
setTimeout(() => process.exit(), 30 * 60 * 1000);
setInterval(() => {
  try {
    process.kill(parent, 0);
  } catch (error) {
    if (error.code !== "EPERM") {
      process.exit();
    }
  }
}, 1000);`;

// The pid of a live process other than this one, standing in for another
// story command that holds a project lock. It is a child that sleeps until
// the test run ends (the runner's parent is no use: in a container where
// bun is pid 1 it has pid 0), started on first use.
let sleeper = null;
export function otherLivePid() {
  if (sleeper === null) {
    sleeper = spawn(process.execPath, ["-e", SLEEPER_SCRIPT, String(process.pid)], { stdio: "ignore" });
    sleeper.unref();
    process.on("exit", () => sleeper.kill());
  }
  return sleeper.pid;
}

// Whether `pid` is a running process. Where /proc lists processes (Linux),
// a zombie, a process that has exited but that its parent has not reaped,
// does not count, though process.kill(pid, 0) still finds it.
const PROC = fs.existsSync("/proc/self/stat");
export function processRunning(pid) {
  if (PROC) {
    let stat;
    try {
      stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    } catch {
      return false;
    }
    // The state follows the command name, which is in parentheses.
    const state = stat.slice(stat.lastIndexOf(")") + 2)[0];
    return state !== "Z" && state !== "X";
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// Runs `save` once, when a story command opens the temporary file it
// writes `target` through: after the command has read the project, just
// before it replaces the target. A test saves a file there as an editor
// would while the command runs. Call mockRestore() on the returned spy.
export function whileWriting(target, save) {
  const open = fs.openSync;
  let pending = true;
  return spyOn(fs, "openSync").mockImplementation((file, ...rest) => {
    if (pending && typeof file === "string" && path.dirname(file) === path.dirname(target)
      && TEMPORARY_FILE_PATTERN.exec(path.basename(file))?.[1] === path.basename(target)) {
      pending = false;
      save();
    }
    return open(file, ...rest);
  });
}

// Removes every temp dir made so far. test/setup.js runs it after each test,
// so repeated runs do not fill the disk.
export function removeTempDirs() {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function makeTempDir(prefix = "story-skills-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// Windows' node and npm, for driving the default runners of
// scripts/check-package.js and scripts/release.js the way they run there:
// `host` names a node.exe that is this runtime under that name, and an
// npm-cli.js that records its arguments (read them with `calls()`) and
// prints `output`.
export function fakeWindowsNpm(output = "") {
  const dir = makeTempDir("story-fake-npm-");
  const node = path.join(dir, "node.exe");
  try {
    fs.symlinkSync(process.execPath, node);
  } catch {
    fs.copyFileSync(process.execPath, node); // Windows makes symlinks only with extra privileges.
  }
  const cli = path.join(dir, "npm-cli.js");
  const log = path.join(dir, "calls.jsonl");
  fs.writeFileSync(
    cli,
    `require("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");\nprocess.stdout.write(${JSON.stringify(output)});\n`
  );
  return {
    host: { platform: "win32", execPath: node, env: { npm_execpath: cli } },
    node,
    cli,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [])
  };
}

export function memoryIo(cwd) {
  const out = [];
  const err = [];
  return {
    cwd,
    stdout: {
      write(value) {
        out.push(String(value));
      }
    },
    stderr: {
      write(value) {
        err.push(String(value));
      }
    },
    output() {
      return out.join("");
    },
    error() {
      return err.join("");
    }
  };
}

let emptyFile;

// An empty file for git to read as its global config, excludes, and
// attributes. It sits in a temp dir, so it is made again once removeTempDirs
// has deleted it.
function emptyGitFile() {
  if (emptyFile === undefined || !fs.existsSync(emptyFile)) {
    emptyFile = path.join(makeTempDir("story-skills-git-"), "empty");
    fs.writeFileSync(emptyFile, "");
  }
  return emptyFile;
}

// An environment for git that reads nothing from the developer's machine
// (#561). GIT_CONFIG_GLOBAL and GIT_CONFIG_NOSYSTEM drop the global and system
// config, so commit signing, hooks, or a pinentry prompt set there cannot fail
// or stall a test, and core.excludesFile and core.attributesFile replace
// ~/.config/git/ignore and attributes, which git reads even then. No GIT_*
// variable, such as GIT_DIR from a hook, gets through. The settings go in
// GIT_CONFIG_COUNT variables, so they also reach the git that a script or the
// CLI runs. An override set to undefined leaves that variable out.
export function gitEnv(overrides = {}) {
  const empty = emptyGitFile();
  const settings = [
    ["user.name", "Test"],
    ["user.email", "test@example.com"],
    ["init.defaultBranch", "main"],
    ["commit.gpgsign", "false"],
    ["tag.gpgsign", "false"],
    ["core.excludesFile", empty],
    ["core.attributesFile", empty]
  ];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  settings.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return { ...env, GIT_CONFIG_COUNT: String(settings.length), GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: "1", ...overrides };
}

// Runs git in cwd with gitEnv() and returns its stdout.
export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: gitEnv() });
}

export function writeMarkdown(filePath, frontmatter, body = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---\n${frontmatter.trim()}\n---\n${body}`, "utf8");
}

const ZIP_END_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

// Minimal reader for the epub and docx archives story build writes: walks the
// central directory and inflates every entry, so tests can assert on decoded
// content instead of raw archive bytes. Entries are stamped with a fixed date
// and carry no extra fields or comments, so no zip64 handling is needed.
export function readArchiveEntries(file) {
  const buffer = fs.readFileSync(file);
  const end = buffer.lastIndexOf(ZIP_END_SIGNATURE);
  if (end === -1) {
    throw new Error(`Not a zip archive: ${file}`);
  }
  const count = buffer.readUInt16LE(end + 10);
  const entries = [];
  let cursor = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const stored = buffer.subarray(dataStart, dataStart + compressedSize);
    const content = method === 0 ? Buffer.from(stored) : inflateRawSync(stored);
    if (content.length !== size) {
      throw new Error(`Size mismatch for ${name} in ${file}`);
    }
    entries.push({ name, flags, method, size, compressedSize, content });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// The entry names and decoded text of every entry, for build assertions that
// only need a fragment to appear somewhere in the package.
export function readArchiveText(file) {
  return readArchiveEntries(file)
    .map((entry) => `${entry.name}\n${entry.content.toString("utf8")}\n`)
    .join("");
}

// The text of each finding in a result's errors or warnings.
export function messages(findings) {
  return findings.map((finding) => finding.message);
}

// Every file's bytes and every folder, keyed by path relative to root.
export function treeSnapshot(root) {
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
export function treeDiff(before, after) {
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

// The fastest of a few runs of `task`, in milliseconds, so one stall on a
// busy runner does not decide a timing test.
function fastestTime(task) {
  let best = Infinity;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = performance.now();
    task();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

// Asserts that `run` takes about linear time in the length of its input,
// with no wall-clock limit: one input of `length` characters is timed
// against `pieces` inputs of length / pieces characters each, the same
// total. A linear scan takes about as long either way; a quadratic one
// takes `pieces` times as long on the long input, and one that grows as
// n^1.5 the square root of `pieces` times as long, so it needs 256 pieces.
// `make(n)` builds an input of about n characters. The slack covers timer
// noise when both are quick.
export function expectLinearTime(run, make, { length = 32000, pieces = 16 } = {}) {
  const short = make(length / pieces);
  const long = make(length);
  const shortTime = fastestTime(() => {
    for (let piece = 0; piece < pieces; piece += 1) {
      run(short);
    }
  });
  const longTime = fastestTime(() => run(long));
  expect(longTime).toBeLessThan(4 * shortTime + 25);
}

// Asserts that `run` takes about linear time in the size of its input when
// each run also has a fixed cost, such as making or reading a project,
// which expectLinearTime would pay once for each of its short inputs: the
// run on make(size) is timed against the run on make(size / 4), each the
// fastest of a few runs taken in turn, so a busy spell slows both. A linear
// scan takes at most four times as long, and less with the fixed cost; a
// quadratic one takes sixteen times as long once the scan outweighs that
// cost. Returns what `run` gave on the larger input.
export function expectLinearGrowth(run, make, size) {
  const small = make(size / 4);
  const large = make(size);
  let smallTime = Infinity;
  let largeTime = Infinity;
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let started = performance.now();
    run(small);
    smallTime = Math.min(smallTime, performance.now() - started);
    started = performance.now();
    result = run(large);
    largeTime = Math.min(largeTime, performance.now() - started);
  }
  expect(largeTime).toBeLessThan(8 * smallTime + 25);
  return result;
}

// Asserts that `run` takes about as long on `input` as on `control`, an
// input of the same length that it passes over at once, again with no
// wall-clock limit. A scan that is linear but does up to a thousand steps
// at each character of `input` takes hundreds of times as long on it.
export function expectComparableTime(run, input, control) {
  const controlTime = fastestTime(() => run(control));
  const inputTime = fastestTime(() => run(input));
  expect(inputTime).toBeLessThan(4 * controlTime + 25);
}

// About n characters of backtick runs of every length from 1 up, each
// followed by a letter, so no run closes another: a scan that reads ahead
// for a closer from each run reads n^1.5 characters in all.
export function backtickRuns(n) {
  let text = "";
  for (let length = 1; text.length < n; length += 1) {
    text += `${"`".repeat(length)}a`;
  }
  return text;
}

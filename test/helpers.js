import { expect, spyOn } from "bun:test";
import { Buffer } from "node:buffer";
import { execFileSync, spawn, spawnSync } from "node:child_process";
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

// Whether a read-only file can still be written. Root writes one anyway, but
// Windows enforces the read-only flag, so a test of a read-only file runs there.
export const READONLY_IGNORED = process.getuid?.() === 0;

// The longest a linear-time check lets its largest run take, in milliseconds.
// The ratio does the checking; this backstop only stops a run that never ends,
// so it leaves room for a loaded CI runner.
const HANG_LIMIT_MS = 20000;

// Whether a `node` command is on PATH. Tests that run the Node build look it
// up there, because process.execPath is Bun under `bun test`. Tests that need
// it skip when it is false.
export const NODE_ON_PATH = spawnSync("node", ["--version"]).status === 0;

// Whether an `unzip` command is on PATH. Tests that read archives with it skip
// when it is false.
export const UNZIP_ON_PATH = spawnSync("unzip", ["-v"]).status === 0;

// Whether this user can make a symlink to a file and to a folder. Windows
// needs developer mode or administrator rights to make one. Tests that make
// symlinks skip when it is false.
export const SYMLINKS_SUPPORTED = (() => {
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-skills-links-"));
    fs.mkdirSync(path.join(dir, "target"));
    fs.symlinkSync(path.join(dir, "target"), path.join(dir, "folder"), "dir");
    fs.symlinkSync(path.join(dir, "target", "file.md"), path.join(dir, "file.md"));
    return true;
  } catch {
    return false;
  } finally {
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
})();

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
          // The bytes cannot be read, so the stats stand in for them. An atomic
          // write changes the inode, and a rewrite that keeps the size changes
          // the modification and change times once the clock has moved on.
          const stats = fs.statSync(full);
          entries[key] = `unreadable ${stats.mode} ${stats.size} ${stats.ino} ${stats.mtimeMs} ${stats.ctimeMs}`;
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
// The long run may take up to eight times the pieces: a loaded runner
// slows one of the two more than the other, and the bound still fails
// a quadratic run. The long run must also take less than HANG_LIMIT_MS, a
// backstop for a run that never ends. `make(n)` builds an input of about n
// characters. The slack covers timer noise when both are quick.
export function expectLinearTime(run, make, { length = 32000, pieces = 16 } = {}) {
  const short = make(length / pieces);
  const long = make(length);
  const shortTime = fastestTime(() => {
    for (let piece = 0; piece < pieces; piece += 1) {
      run(short);
    }
  });
  const longTime = fastestTime(() => run(long));
  expect(longTime).toBeLessThan(8 * shortTime + 25);
  expect(longTime).toBeLessThan(HANG_LIMIT_MS);
}

// Asserts that `run` takes about linear time in the size of its input when
// each run also has a fixed cost, such as making a project, which
// expectLinearTime would pay once for each of its short inputs. The runs on
// make(size) and make(size / 4) are timed less the run on make(0), the fixed
// cost, each the fastest of a few runs taken in turn, so a busy spell slows
// all three. A linear scan then takes at most four times as long on the
// larger input, and a quadratic one sixteen times. The larger run must also
// take less than `limit` milliseconds in all, far above its usual time:
// JavaScriptCore gives up on a regex that backtracks too much after a fixed
// amount of work, whatever the length, so such a regex takes as long on
// both inputs and only a limit shows it. Returns what `run` gave on the
// larger input.
export function expectLinearGrowth(run, make, size, { limit = 2000 } = {}) {
  const inputs = [make(0), make(size / 4), make(size)];
  const best = [Infinity, Infinity, Infinity];
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    inputs.forEach((input, index) => {
      const started = performance.now();
      const value = run(input);
      best[index] = Math.min(best[index], performance.now() - started);
      if (index === 2) {
        result = value;
      }
    });
  }
  const [fixed, small, large] = best;
  expect(large).toBeLessThan(limit);
  expect(large - fixed).toBeLessThan(8 * Math.max(small - fixed, 0) + 25);
  return result;
}

// Asserts that an operation takes about linear time in its size, for work
// that changes its input, so each run needs a fresh one. `timeRun(size)`
// builds the input of that size, times one run on it, and returns the time in
// milliseconds; building the input must stay outside the timing. As in
// expectLinearGrowth, `timeRun(0)` gives the fixed cost, such as making a
// project. The fixed cost and the runs on size / 4 and on size are each the
// fastest of three taken in turn, and the fixed cost is taken away from the
// two larger runs. A linear run takes about four times as long on the larger
// input, and a quadratic one sixteen times. The bound is eight times, so a
// loaded runner does not fail a linear run, and a quadratic one still fails.
// The larger run must also take less than `limit` milliseconds, as a backstop
// for a run that never ends.
export function expectLinearGrowthFresh(timeRun, size, { limit = HANG_LIMIT_MS } = {}) {
  let fixed = Infinity;
  let small = Infinity;
  let large = Infinity;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    fixed = Math.min(fixed, timeRun(0));
    small = Math.min(small, timeRun(size / 4));
    large = Math.min(large, timeRun(size));
  }
  expect(large).toBeLessThan(limit);
  expect(large - fixed).toBeLessThan(8 * Math.max(small - fixed, 0) + 25);
}

// Asserts that `run` takes about as long on `input` as on `control`, an
// input of the same length that it passes over at once, again with no
// wall-clock limit beyond HANG_LIMIT_MS. A scan that is linear but does up to
// a thousand steps at each character of `input` takes hundreds of times as
// long on it.
export function expectComparableTime(run, input, control) {
  const controlTime = fastestTime(() => run(control));
  const inputTime = fastestTime(() => run(input));
  expect(inputTime).toBeLessThan(4 * controlTime + 25);
  expect(inputTime).toBeLessThan(HANG_LIMIT_MS);
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

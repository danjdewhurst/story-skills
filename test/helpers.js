import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const tempDirs = [];

// Whether chmod cannot take access away: root reads and writes anything,
// and Windows has no POSIX modes (chmod only sets a file's read-only flag,
// and is ignored on folders). Tests that make a file or folder unreadable or
// unwritable skip when it is true.
export const CHMOD_IGNORED = process.getuid?.() === 0 || process.platform === "win32";

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

// Settings for every git a test runs. gitEnv() passes them as GIT_CONFIG_COUNT
// variables, so they also reach the git that a script or the CLI runs.
const GIT_SETTINGS = [
  ["user.name", "Test"],
  ["user.email", "test@example.com"],
  ["init.defaultBranch", "main"],
  ["commit.gpgsign", "false"],
  ["tag.gpgsign", "false"]
];

// An environment for git that reads nothing from the developer's machine: no
// global or system config, so commit signing, hooks, or a pinentry prompt set
// there cannot fail or stall a test (#561), and no GIT_* variable, such as
// GIT_DIR from a hook or GIT_CONFIG_PARAMETERS. An override set to undefined
// leaves that variable out.
export function gitEnv(overrides = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  GIT_SETTINGS.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return { ...env, GIT_CONFIG_COUNT: String(GIT_SETTINGS.length), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...overrides };
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

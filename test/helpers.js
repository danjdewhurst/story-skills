import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const tempDirs = [];

// Removes every temp dir made so far. test/setup.js runs it after the whole
// test run, so repeated runs do not fill the disk.
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

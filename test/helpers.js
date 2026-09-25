import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

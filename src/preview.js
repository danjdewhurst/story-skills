import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPathInside, recordChanges } from "./files.js";
import { LOCK_FILE, TAKEOVER_FILE } from "./lock.js";
import { requireStoryFile } from "./scan.js";

// --dry-run: a write command runs unchanged on a scratch copy of the
// project, and the writes, renames, and deletes it records there (see
// recordChanges) are the preview. The preview is the real run, so it cannot
// drift from it, and the project itself is only read: no file is written,
// and its lock is not taken, so a preview never waits on a running command.

// Folders a write command never reads: version control, installed
// packages, builds, and other hidden folders.
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist"]);

// The copy each running preview made, so a check that reads outside the
// project (a linked book in a series) can resolve paths from the real one.
const previews = new Map();

// Runs `run(copyRoot)` on a copy of the project at `root` and returns
// { result, changes }: the command's result with every path into the copy
// pointing back at the project, and the changes it made, relative to the
// project root. An error is rethrown the same way, so it names project
// files.
export function previewChanges(root, run) {
  const projectRoot = path.resolve(root);
  requireStoryFile(projectRoot);
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "story-dry-run-")));
  const copyRoot = path.join(scratch, path.basename(projectRoot) || "project");
  const toProject = (value) => mapPaths(value, copyRoot, projectRoot);
  try {
    copyProject(projectRoot, copyRoot, { realSource: realPath(projectRoot), copyRoot });
    previews.set(copyRoot, projectRoot);
    const { result, changes } = recordChanges(copyRoot, () => run(copyRoot));
    return { result: toProject(result), changes };
  } catch (error) {
    throw toProjectError(error, copyRoot, projectRoot);
  } finally {
    previews.delete(copyRoot);
    removeScratch(scratch);
  }
}

// The project a path belongs to: the real project when `root` is the copy
// a preview is running on, else `root` itself.
export function sourceRoot(root) {
  return previews.get(path.resolve(root)) ?? root;
}

function copyProject(source, target, roots) {
  fs.mkdirSync(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && !SKIPPED_DIRECTORIES.has(entry.name)) {
        copyProject(from, to, roots);
      }
    } else if (entry.isSymbolicLink()) {
      fs.symlinkSync(linkTarget(fs.readlinkSync(from), roots), to);
    } else if (entry.isFile() && entry.name !== LOCK_FILE && entry.name !== TAKEOVER_FILE) {
      copyFile(from, to);
    }
    // A FIFO, socket, or device is never read by a command, so it is not
    // copied (reading a FIFO would block).
  }
  // Copied last, so a read-only folder still received its files.
  fs.chmodSync(target, fs.statSync(source).mode & 0o7777);
}

// A file this user cannot read is copied as an empty file with the same
// permissions, so the command meets the same refusal in the copy.
function copyFile(from, to) {
  if (readable(from)) {
    fs.copyFileSync(from, to);
  } else {
    fs.writeFileSync(to, "");
  }
  fs.chmodSync(to, fs.statSync(from).mode & 0o7777);
}

function readable(file) {
  try {
    fs.accessSync(file, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

// An absolute symlink into the project points at the same file in the copy,
// so the command treats it as it would in the project.
function linkTarget(target, { realSource, copyRoot }) {
  if (!path.isAbsolute(target)) {
    return target;
  }
  const real = realPath(target);
  return isPathInside(realSource, real) ? path.join(copyRoot, path.relative(realSource, real)) : target;
}

// A folder copied read-only must be made writable again to delete it.
function removeScratch(scratch) {
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    makeWritable(scratch);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function makeWritable(directory) {
  try {
    fs.chmodSync(directory, 0o700);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        makeWritable(path.join(directory, entry.name));
      }
    }
  } catch {
    // Left for the system to clean up with the rest of the temp folder.
  }
}

function mapPaths(value, from, to) {
  if (typeof value === "string") {
    return value.split(from).join(to);
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapPaths(item, from, to));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapPaths(item, from, to)]));
  }
  return value;
}

function toProjectError(error, from, to) {
  if (!error || typeof error !== "object") {
    return error;
  }
  for (const key of ["message", "hint", "path"]) {
    if (typeof error[key] === "string") {
      error[key] = mapPaths(error[key], from, to);
    }
  }
  return error;
}

function realPath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

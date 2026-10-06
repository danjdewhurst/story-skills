import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_READ_BYTES, isPathInside, recordChanges } from "./files.js";
import { LOCK_FILE, TAKEOVER_FILE } from "./lock.js";
import { MAX_SCAN_DEPTH, SKIPPED_SCAN_DIRECTORIES, requireStoryFile } from "./scan.js";
import { readBookFrontmatter, seriesLinks } from "./series.js";

// --dry-run: a write command runs unchanged on a scratch copy of the
// project, and the writes, renames, and deletes it records there (see
// recordChanges) are the preview. The preview is the real run, so it cannot
// drift from it, and the project itself is only read: no file is written,
// and its lock is not taken, so a preview never waits on a running command.
//
// The copy sits in a scratch folder that stands in for the project's parent
// folder, beside copies of the books it is linked to in a series, so links
// such as `follows: ../book-one` resolve in the copy as they do in the
// project.

// Runs `run(copyRoot)` on a copy of the project at `root` and returns
// { result, changes }: the command's result with every path into the copy
// pointing back at the project, and the changes it made, relative to the
// project root. An error is rethrown the same way, so it names project
// files.
export function previewChanges(root, run) {
  const projectRoot = path.resolve(root);
  requireStoryFile(projectRoot);
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "story-dry-run-")));
  const name = path.basename(projectRoot);
  const copyRoot = path.join(scratch, name || "project");
  // Every path into the scratch folder maps to the same path beside the
  // project, so a finding about a linked book names the real book too.
  const [from, to] = name ? [scratch, path.dirname(projectRoot)] : [copyRoot, projectRoot];
  try {
    copyProject(projectRoot, copyRoot, { realSource: realPath(projectRoot), copyRoot });
    if (name) {
      copyLinkedBooks(projectRoot, scratch);
    }
    const { result, changes } = recordChanges(copyRoot, () => run(copyRoot));
    return { result: mapPaths(result, from, to), changes };
  } catch (error) {
    throw toProjectError(error, from, to);
  } finally {
    removeScratch(scratch);
  }
}

// Copies the books the project is linked to through follows/precedes, and
// the books those are linked to, into `scratch` under their folder names.
// Like `story series`, only sibling folders are followed: a link elsewhere
// is reported as an error by the real run and finds no book in the preview.
// A sibling that is a symlink to another sibling stays a symlink to that
// book's copy; one that leads out of the parent folder is not copied. The
// copies are scratch files, so no write reaches a linked book.
function copyLinkedBooks(projectRoot, scratch) {
  const parent = path.dirname(projectRoot);
  const realParent = realPath(parent);
  const queue = [projectRoot];
  const seen = new Set([path.basename(projectRoot)]);
  const visit = (name) => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    const source = path.join(parent, name);
    const target = path.join(scratch, name);
    const stat = fs.lstatSync(source, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) {
      // realPath returns a dangling link unchanged.
      const real = realPath(source);
      if (real !== source && path.dirname(real) === realParent) {
        fs.symlinkSync(path.basename(real), target);
        visit(path.basename(real));
      }
      return;
    }
    if (stat?.isDirectory() && fs.existsSync(path.join(source, "story.md"))) {
      copyProject(source, target, { realSource: realPath(source), copyRoot: target });
      queue.push(source);
    }
  };
  while (queue.length > 0) {
    const book = queue.shift();
    let data;
    try {
      data = readBookFrontmatter(book);
    } catch {
      continue;
    }
    for (const link of ["follows", "precedes"].flatMap((field) => seriesLinks(book, data ?? {}, field))) {
      if (path.dirname(link) === parent) {
        visit(path.basename(link));
      }
    }
  }
}

// Copies the folders a write command can read, as markdownFiles walks them:
// not dist/, node_modules/, hidden folders, a subfolder that is another
// project, or folders deeper than the scan limit.
function copyProject(source, target, roots, depth = 0) {
  fs.mkdirSync(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && !SKIPPED_SCAN_DIRECTORIES.has(entry.name) && depth < MAX_SCAN_DEPTH && !fs.existsSync(path.join(from, "story.md"))) {
        copyProject(from, to, roots, depth + 1);
      }
    } else if (entry.isSymbolicLink()) {
      fs.symlinkSync(linkTarget(fs.readlinkSync(from), roots), to);
    } else if (entry.isFile() && entry.name !== LOCK_FILE && entry.name !== TAKEOVER_FILE) {
      copyFile(from, to);
    }
    // A FIFO, socket, or device is never read by a command, so it is not
    // copied (reading a FIFO would block).
  }
  // Set last, so a read-only folder still received its files.
  fs.chmodSync(target, copyMode(source, true));
}

// Write commands read the text of markdown files only, and no file over
// the read limit; of any other file (a cover image) they check at most the
// size. So only readable markdown is copied whole. Every other file is a
// sparse file of the same size, which takes no disk space, and an
// unreadable file stays unreadable.
function copyFile(from, to) {
  const { size } = fs.statSync(from);
  if (from.endsWith(".md") && size <= MAX_READ_BYTES && allowed(from, fs.constants.R_OK)) {
    fs.copyFileSync(from, to);
  } else {
    fs.writeFileSync(to, "");
    fs.truncateSync(to, size);
  }
  fs.chmodSync(to, copyMode(from, false));
}

// The copy belongs to this user, so its permissions are set to give this
// user the access the original gives: a file owned by someone else, or on
// a read-only mount, is refused in the copy as it would be in the project.
function copyMode(source, directory) {
  let mode = fs.statSync(source).mode & 0o7777;
  const access = [[fs.constants.R_OK, 0o444, 0o400], [fs.constants.W_OK, 0o222, 0o200]];
  if (directory) {
    access.push([fs.constants.X_OK, 0o111, 0o100]);
  }
  for (const [check, all, owner] of access) {
    mode = allowed(source, check) ? mode | owner : mode & ~all;
  }
  return mode;
}

function allowed(file, check) {
  try {
    fs.accessSync(file, check);
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

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { EXIT_CODES, aboutFlags, projectError, refusedError, withExitCode } from "./exit-codes.js";

export const MAX_READ_BYTES = 5 * 1024 * 1024;

// Reads a project text file. A symlink, a device, a FIFO, or a file over
// the size cap is refused, so a cloned project cannot point a read at
// /dev/zero or at a file outside itself. Every refusal starts with the
// path, so a caller that labels the file can drop it rather than repeat it.
export function readTextFile(filePath) {
  return decodeUtf8(readFileBytes(filePath), filePath);
}

// Reads a project file's bytes, refused as readTextFile refuses it.
// `maxBytes` is the size cap: a cover image takes a larger one.
export function readFileBytes(filePath, maxBytes = MAX_READ_BYTES) {
  return readFileAndStats(filePath, maxBytes).bytes;
}

// The flags every read opens a file with. The checks before the open look
// at the name, so a file swapped at that name afterwards (by a process
// writing to the project while a command runs) could still redirect the
// read: O_NOFOLLOW refuses a symlink put there, and O_NONBLOCK keeps a FIFO
// put there from holding the open until a writer comes. Both apply to the
// file's own name only: a folder above it swapped for a symlink is not
// caught here (scan checks each folder's real path before it reads), and
// Windows has neither flag, nor FIFOs, so there the checks before the open
// stand alone.
const SAFE_READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);

const READ_CHUNK_BYTES = 64 * 1024;

// The bytes of a regular file and its stats, taken through the descriptor
// the bytes are read from (the lock reads its modification time this way).
// Every file story reads from a project, or from beside one, comes through
// here or readFilePrefix: test/files.test.js fails on a raw read anywhere
// else in src/.
export function readFileAndStats(filePath, maxBytes = MAX_READ_BYTES) {
  const { descriptor, stats } = openRegularFile(filePath, maxBytes);
  try {
    return { bytes: readAtMost(descriptor, filePath, stats.size, maxBytes), stats };
  } finally {
    fs.closeSync(descriptor);
  }
}

// The first `length` bytes of a regular file (fewer if it is shorter),
// refused as readFileBytes refuses a symlink, a device, or a FIFO, but
// with no size cap, since the rest is never read.
export function readFilePrefix(filePath, length) {
  const { descriptor } = openRegularFile(filePath, Infinity);
  try {
    const buffer = Buffer.allocUnsafe(length);
    let filled = 0;
    let read;
    do {
      read = fs.readSync(descriptor, buffer, filled, length - filled, null);
      filled += read;
    } while (read > 0 && filled < length);
    return buffer.subarray(0, filled);
  } finally {
    fs.closeSync(descriptor);
  }
}

// Calls visit(line, number) with each line of a regular file that ends in a
// line feed, as its bytes without the line feed (valid only during the
// call), numbered from 1. The file is read a chunk at a time, so no more
// than one line is held at once, however long the file. What follows the
// last line feed is not a line. A line longer than `maxLineBytes` is
// refused with an error whose `longLine` is its number.
export function forEachLine(filePath, maxLineBytes, visit) {
  const { descriptor } = openRegularFile(filePath, Infinity);
  try {
    const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let parts = [];
    let size = 0;
    let number = 0;
    const add = (bytes) => {
      size += bytes.length;
      if (size > maxLineBytes) {
        throw Object.assign(projectError(`${filePath}: line ${number + 1} is longer than ${maxLineBytes} bytes`), { longLine: number + 1 });
      }
    };
    let read;
    while ((read = fs.readSync(descriptor, chunk, 0, chunk.length, null)) > 0) {
      const data = chunk.subarray(0, read);
      let start = 0;
      for (let end = data.indexOf(0x0a); end !== -1; end = data.indexOf(0x0a, start)) {
        const piece = data.subarray(start, end);
        add(piece);
        number += 1;
        visit(parts.length === 0 ? piece : Buffer.concat([...parts, piece]), number);
        parts = [];
        size = 0;
        start = end + 1;
      }
      add(data.subarray(start));
      parts.push(Buffer.from(data.subarray(start)));
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

// Opens a regular file of at most `maxBytes` for reading, checking it by
// name and then again through the open descriptor.
function openRegularFile(filePath, maxBytes) {
  const named = fs.lstatSync(filePath);
  if (named.isSymbolicLink()) {
    throw symlinkReadRefusal(filePath);
  }
  if (!named.isFile()) {
    throw notRegularFileRefusal(filePath);
  }
  if (named.size > maxBytes) {
    throw projectError(`${filePath}: Refusing to read oversized file: ${named.size} bytes exceeds the ${maxBytes} byte limit`);
  }
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, SAFE_READ_FLAGS);
  } catch (error) {
    // ELOOP (EMLINK on FreeBSD): a symlink took the file's place.
    throw error.code === "ELOOP" || error.code === "EMLINK" ? symlinkReadRefusal(filePath) : error;
  }
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile()) {
      throw notRegularFileRefusal(filePath);
    }
    return { descriptor, stats };
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

// Reads to the end of the file, but never more than `maxBytes`, so a file
// that grew past the cap after it was checked is refused rather than read
// whole. The size the file reported (0 for a /proc file) sizes only the
// first buffer, with a byte to spare to find the end.
function readAtMost(descriptor, filePath, size, maxBytes) {
  const chunks = [];
  let total = 0;
  let buffer = Buffer.allocUnsafe(Math.min(size, maxBytes) + 1);
  let filled = 0;
  let read;
  do {
    if (filled === buffer.length) {
      chunks.push(buffer);
      buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      filled = 0;
    }
    read = fs.readSync(descriptor, buffer, filled, buffer.length - filled, null);
    filled += read;
    total += read;
    if (total > maxBytes) {
      throw projectError(`${filePath}: Refusing to read oversized file: it grew past the ${maxBytes} byte limit while story was reading it`);
    }
  } while (read > 0);
  chunks.push(buffer.subarray(0, filled));
  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
}

function symlinkReadRefusal(filePath) {
  return projectError(`${filePath}: Refusing to read through symlink`);
}

function notRegularFileRefusal(filePath) {
  return projectError(`${filePath}: Refusing to read: not a regular file`);
}

// Plain words for the file-system error codes a command can hit.
export const FILE_ERROR_REASONS = {
  EACCES: "permission denied",
  EPERM: "permission denied",
  ENOENT: "no such file or folder",
  EISDIR: "it is a folder, not a file",
  ENOTDIR: "a part of the path is not a folder",
  EROFS: "the file system is read-only",
  ENOSPC: "no space left on the device",
  ENAMETOOLONG: "the name is too long",
  EDQUOT: "the disk quota is exceeded",
  EFBIG: "the file is too large",
  EIO: "an input/output error",
  EBUSY: "the file is in use"
};

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Decodes strictly: a file saved in another encoding (Windows-1252, say) is
// refused rather than read with U+FFFD in place of its bytes, so a command
// that rewrites it cannot destroy the original characters.
export function decodeUtf8(buffer, filePath) {
  try {
    return UTF8.decode(buffer);
  } catch {
    const offset = invalidUtf8Offset(buffer);
    const byte = buffer[offset].toString(16).padStart(2, "0");
    throw projectError(`${filePath} is not valid UTF-8 (byte 0x${byte} at offset ${offset}): re-save it as UTF-8`);
  }
}

// The first offset whose byte does not start or continue a valid sequence.
// Every character before it decoded cleanly, so the lossy decoding lines up
// with the bytes up to the first replacement character that was not in the
// file.
function invalidUtf8Offset(buffer) {
  let offset = 0;
  for (const character of buffer.toString("utf8")) {
    if (character === "\uFFFD" && !(buffer[offset] === 0xef && buffer[offset + 1] === 0xbf && buffer[offset + 2] === 0xbd)) {
      break;
    }
    offset += Buffer.byteLength(character, "utf8");
  }
  return Math.max(0, Math.min(offset, buffer.length - 1));
}

// Writes a file whole or not at all: the contents go to a temporary file
// beside the target, which is flushed to disk and then renamed over it, and
// then the folder is flushed (see syncFolder). A
// failed write (a full disk) or a killed process leaves the old file intact
// rather than truncated. An existing file keeps its permissions, a read-only
// one stays refused, and a hard link (to a chapter, say) is replaced rather
// than written through. With `unchangedFrom`, the write is refused when the
// file no longer holds that text (an editor saved it after the command read
// it), so the save is not overwritten. Any failure, a refusal or the file
// system's, exits as a refused write. `mode` sets the file's permissions
// in place of the default or the existing file's (a snapshot copy keeps
// its source's, and a file an undo puts back its own).
export function writeFile(filePath, contents, options = {}) {
  const existed = lstatIfExists(path.resolve(filePath)) !== null;
  assertWriteAllowed(filePath);
  try {
    if (planning > 0) {
      planWrite(filePath, options);
    } else {
      writeWholeFile(filePath, contents, options);
    }
  } catch (error) {
    // `flags` names the option that chose the file (--out), for the hint
    // runCli adds when a story.md default set it.
    throw aboutFlags(withExitCode(error, EXIT_CODES.refused), options.flags);
  }
  record(filePath, existed, "write");
}

// Deletes a project file, recording it like a write. `force` ignores a file
// that is already gone, as fs.rmSync does. With `unchangedFrom`, the delete
// is refused when the file no longer holds that text (an editor saved it
// after the command read it), so the save is not lost; `root` names the
// file in that message by its project path.
export function removeFile(filePath, options = {}) {
  const target = path.resolve(filePath);
  const existed = lstatIfExists(target) !== null;
  assertWriteAllowed(target);
  if (options.unchangedFrom !== undefined && currentText(target) !== options.unchangedFrom) {
    throw Object.assign(new Error(`${options.root ? projectPath(path.resolve(options.root), target) : target} changed on disk while story was deleting it, so it was left as it is`), { changedOnDisk: true, exitCode: EXIT_CODES.refused });
  }
  if (planning > 0) {
    // As fs.rmSync would: a missing file without force is an error, and a
    // file can be deleted only from a folder this user can write to.
    if (!existed && !options.force) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${filePath}'`), { code: "ENOENT", path: filePath, syscall: "lstat" });
    }
    if (existed) {
      fs.accessSync(path.dirname(path.resolve(filePath)), fs.constants.W_OK);
    }
  } else {
    if (existed) {
      logUndo(target, null);
    }
    fs.rmSync(filePath, { force: Boolean(options.force) });
    if (existed) {
      afterChange(target);
    }
  }
  if (existed) {
    record(filePath, true, "delete");
  }
}

// Deletes an empty folder, recording it like a deleted file (a stale codex
// folder a build emptied), or with `action: "rmdir"` as a folder removed (one
// a snapshot restore emptied). Planned, it checks only that the folder's
// parent is writable, since the files that would empty it are still there.
export function removeDirectory(directory, { action = "delete" } = {}) {
  assertWriteAllowed(directory);
  if (planning > 0) {
    fs.accessSync(path.dirname(path.resolve(directory)), fs.constants.W_OK);
  } else {
    fs.rmdirSync(directory);
    syncFolder(path.dirname(path.resolve(directory)));
  }
  record(directory, true, action);
}

// Opens a folder to flush it. O_DIRECTORY refuses anything else, so a FIFO
// put in the folder's place is never waited on.
const FOLDER_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0);

// Flushes a folder's list of names to disk after a file was renamed into
// it, deleted from it, or made in it. A file's own flush covers its
// contents, not its name, so without this a power loss could undo some of a
// command's renames and keep later ones. Windows cannot open a folder, so
// there it is skipped, as it is on a file system that refuses to flush one
// (some network file systems): the change itself is already made.
export function syncFolder(directory, platform = process.platform) {
  if (platform === "win32") {
    return;
  }
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, FOLDER_FLAGS);
    fs.fsyncSync(descriptor);
  } catch {
    // Left as the file system keeps it.
  } finally {
    if (descriptor !== null) {
      fs.closeSync(descriptor);
    }
  }
}

// Projects whose lock could not be made (see withProjectLock): a write
// inside one is refused with the message given, rather than made while
// another command could be writing too. A command that finds nothing to
// change still succeeds.
const refusals = [];

export function refuseWrites(root, message, run) {
  const refusal = { root: path.resolve(root), message };
  refusals.push(refusal);
  try {
    return run();
  } finally {
    refusals.splice(refusals.indexOf(refusal), 1);
  }
}

// A planned write changes nothing, so only a real one is refused. A
// command whose first change is not made through writeFile or removeFile
// (a snapshot's backup) checks first.
export function assertWriteAllowed(target) {
  const refusal = planning > 0 ? undefined : refusals.find((entry) => isPathInside(entry.root, path.resolve(target)));
  if (refusal) {
    throw refusedError(refusal.message);
  }
}

// Every file a write command creates, rewrites, or deletes goes through
// writeFile, removeFile, or makeDirectories, which report it to the
// journals open here. recordChanges opens one, so a command's --json result
// and its --dry-run preview (see preview.js) list what it did from the same
// calls that did it, and the two cannot drift apart.
const journals = [];

function record(target, existed, action) {
  const key = path.resolve(target);
  for (const journal of journals) {
    const entry = journal.get(key);
    if (entry) {
      entry.action = action;
    } else {
      journal.set(key, { existed, action });
    }
  }
}

// Runs `run` and returns its result with the changes it made: { action,
// path } entries sorted by path, where action is create, update, delete,
// mkdir (a folder made), or rmdir (a folder removed, listed after what it
// held) and path is relative to `root` with / separators. A file created and
// then deleted by the same run is left out. Calls nest: an inner call's
// changes are recorded in the outer one too. A run that fails partway may
// have changed files already, so the error it throws carries those changes
// as error.changes (an outer call's, made last, win), for a command to
// report.
export function recordChanges(root, run) {
  const journal = new Map();
  journals.push(journal);
  let result;
  try {
    result = run();
  } catch (error) {
    if (error !== null && typeof error === "object") {
      error.changes = summarizeJournal(root, journal);
    }
    throw error;
  } finally {
    journals.splice(journals.indexOf(journal), 1);
  }
  return { result, changes: summarizeJournal(root, journal) };
}

// Like recordChanges, but nothing is written: writeFile, removeFile, and
// makeDirectories run their checks (a path outside the project, a symlink,
// a file or folder this user cannot write to) and record the change they
// would make without making it. A --dry-run of a command that only writes
// files it never reads back, such as a build or a new project, is planned
// this way; one that reads back what it wrote runs on a copy instead (see
// preview.js).
export function planChanges(root, run) {
  planning += 1;
  try {
    return recordChanges(root, run);
  } finally {
    planning -= 1;
  }
}

// True inside planChanges, so a command can skip work whose only product is
// the file it would write (rendering a PDF, say).
export function isPlanning() {
  return planning > 0;
}

let planning = 0;

function summarizeJournal(root, journal) {
  const base = path.resolve(root);
  const changes = [];
  for (const [file, { existed, action }] of journal) {
    const kind = action === "mkdir" ? "mkdir"
      : action === "delete" || action === "rmdir" ? (existed ? action : null)
        : existed ? "update" : "create";
    if (kind !== null) {
      // The root itself, a new project's folder, is ".".
      changes.push({ action: kind, path: path.relative(base, file).split(path.sep).join("/") || "." });
    }
  }
  // "\uffff" sorts after every name, so a removed folder follows its files.
  const key = (change) => (change.action === "rmdir" ? `${change.path}/\uffff` : change.path);
  return changes.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

function writeWholeFile(filePath, contents, options) {
  const target = prepareWriteTarget(filePath, options.root);
  const existing = lstatIfExists(target);
  if (existing) {
    fs.accessSync(target, fs.constants.W_OK);
  }
  const mode = options.mode ?? (existing ? existing.mode & 0o777 : 0o666);
  const temporary = temporaryPath(target);
  let created = false;
  try {
    // "wx" makes a new file or fails: whatever is already at the name, a
    // symlink included, is never opened, so the write cannot land anywhere
    // but the new file. Its mode is set through the descriptor for the
    // same reason.
    const descriptor = fs.openSync(temporary, "wx", mode);
    created = true;
    try {
      fs.writeFileSync(descriptor, contents, "utf8");
      if (existing || options.mode !== undefined) {
        fs.fchmodSync(descriptor, mode);
      }
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (options.unchangedFrom !== undefined && currentText(target) !== options.unchangedFrom) {
      throw Object.assign(new Error(`${options.root ? projectPath(path.resolve(options.root), target) : target} changed on disk while story was updating it, so it was left as it is. Run the command again`), { changedOnDisk: true });
    }
    // The folders on the way were checked before the temporary file was
    // made, and are checked again just before the rename, so one swapped for
    // a symlink meanwhile cannot carry the file outside the project. A swap
    // after this check can still land: Node has no openat to hold a folder
    // open while writing into it.
    if (options.root) {
      try {
        assertSafeProjectParent(target, options.root);
      } catch {
        throw Object.assign(new Error(`Refusing to write ${projectPath(path.resolve(options.root), target)}: a folder on its path was replaced while story was writing it and now leads outside the project, so nothing was written there. Run the command again`), { changedOnDisk: true });
      }
    }
    logUndo(target, contents);
    fs.renameSync(temporary, target);
    afterChange(target);
  } catch (error) {
    // Only a file this write made is removed.
    if (created) {
      fs.rmSync(temporary, { force: true });
    }
    if (error.changedOnDisk) {
      throw error;
    }
    // Name the file the user asked for, not the temporary one.
    const action = existing?.nlink > 1 ? "replace hard-linked" : "write to";
    // Something was already at the random name: EEXIST, or on Windows
    // another code for a folder there. FILE_ERROR_REASONS has no EEXIST,
    // since makeDirectories' messages keep the code, so the reason travels
    // with the error; a rerun picks a new name.
    if (!created && (error.code === "EEXIST" || lstatIfExists(temporary) !== null)) {
      const reason = `something is already at the name of its temporary file (${path.basename(temporary)}, in the same folder), so it was left as it is. Run the command again`;
      throw Object.assign(new Error(`Cannot ${action} ${target}: ${reason}`), { code: "EEXIST", path: target, syscall: "write", reason });
    }
    throw Object.assign(new Error(`Cannot ${action} ${target}: ${error.code ?? error.message}`), { code: error.code, path: target, syscall: "write" });
  }
}

// writeWholeFile's checks, without the write: the target is inside the
// root and not a symlink or a folder, an existing file is writable and
// unchanged, and the folder the temporary file goes in (or, for a new
// folder, its nearest existing ancestor) is writable. A refusal names the
// target as writeWholeFile's does.
function planWrite(filePath, options) {
  const target = prepareWriteTarget(filePath, options.root);
  const existing = lstatIfExists(target);
  if (existing) {
    fs.accessSync(target, fs.constants.W_OK);
  }
  try {
    fs.accessSync(nearestExistingAncestor(path.dirname(target)).ancestor, fs.constants.W_OK);
    // Renaming the temporary file over a folder fails.
    if (existing?.isDirectory()) {
      throw Object.assign(new Error("EISDIR"), { code: "EISDIR" });
    }
  } catch (error) {
    const action = existing?.nlink > 1 ? "replace hard-linked" : "write to";
    throw Object.assign(new Error(`Cannot ${action} ${target}: ${error.code ?? error.message}`), { code: error.code, path: target, syscall: "write" });
  }
  if (options.unchangedFrom !== undefined && currentText(target) !== options.unchangedFrom) {
    throw new Error(`${options.root ? projectPath(path.resolve(options.root), target) : target} changed on disk while story was updating it, so it was left as it is. Run the command again`);
  }
}

// The file's text now, or null when it is gone or unreadable. It is read
// as the command read it, so a symlink, FIFO, or oversized file swapped in
// since counts as a change rather than being followed or read whole.
export function currentText(target) {
  try {
    return readTextFile(target);
  } catch {
    return null;
  }
}

// `.chapter-01.md.story-9f2c41d07a3b6e85.tmp`: hidden, never scanned as
// markdown, and named after its target so validate can say what an
// interrupted write left behind. The suffix is random, so nothing can be
// put at the name before the write makes it; older versions used the
// process id, which the pattern still matches.
export const TEMPORARY_FILE_PATTERN = /^\.(.+)\.story-[0-9a-f]+\.tmp$/;

// At the project root while a rename that moves a file runs: written before
// its first change and deleted after its reindex, it names the rename, so a
// rerun can tell a rename killed after deleting its old file from an id that
// never existed. Hidden, never scanned, and in the starter .gitignore as a
// `.story-*.tmp` file.
export const RENAME_MARKER = ".story-rename.tmp";

// At the project root while split, merge, move, rename, or remove changes
// the project (see withUndoLog): what each file held before the command
// changed it, so a run stopped part way can be put back (see undo.js).
// Hidden, never scanned, and in the starter .gitignore as a `.story-*.tmp`
// file.
export const UNDO_LOG = ".story-undo.tmp";

// The longest line an undo log can hold: a file's text is at most
// MAX_READ_BYTES, JSON writes a byte as at most six (`\u0000`), and the
// path, hash, and mode fit in the rest. The log is read a line at a time
// under this limit (forEachLine), so every log story writes can be read
// back, and a planted one cannot make a command hold more.
export const MAX_UNDO_LINE_BYTES = 6 * MAX_READ_BYTES + 64 * 1024;

// Control characters, and the marks that reorder text on screen, which a
// path an undo log names may not hold and a name it prints is shown
// without, so a planted log cannot drive the terminal or disguise a path.
export const UNSAFE_TEXT = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

// The files an undo log may name, by their path from the project root:
// markdown a scan reads (no part of the path starts with a dot) and the
// rename marker. Those are all a command that keeps one changes, so a log
// naming anything else, such as .git/config, was not written by story and
// is never put back.
export function isUndoablePath(relative) {
  return relative === RENAME_MARKER
    || (relative.endsWith(".md") && !relative.includes("\\") && !UNSAFE_TEXT.test(relative)
      && relative.split("/").every((part) => part !== "" && !part.startsWith(".")));
}

// Deletes the project's undo log and flushes its folder. It is the
// command's own bookkeeping, like the lock, so it is not a change the
// command lists.
export function deleteUndoLog(root) {
  const file = path.join(path.resolve(root), UNDO_LOG);
  assertWriteAllowed(file);
  fs.rmSync(file, { force: true });
  syncFolder(path.dirname(file));
}

// The SHA-256 of a file's contents, as an undo log records what a file was
// about to hold.
export function contentHash(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

// The undo log open in this process, or null.
let undoLog = null;

// Runs `run`, a command that changes several files, with an undo log for the
// project at `root`. Before writeFile or removeFile changes a file in the
// project, a line is added to UNDO_LOG with the file's path, a hash of what
// it is about to hold (null when it is deleted), and, the first time, the
// text it held (null when it did not exist) and its permissions, and the
// line is flushed to disk before the change is made. The log is made at the
// first change, so a command that stops before one leaves none, and is
// deleted once `run` returns. When `run` throws after a change, or the
// process is killed or the power fails, the log stays, so the changes can
// be put back (undoInterruptedChange). `command` names the run, as typed,
// such as `story split chapter-03 --at 2`. A call inside another adds to
// the outer log.
export function withUndoLog(root, command, run) {
  if (undoLog !== null) {
    return run();
  }
  const log = { root: path.resolve(root), command, descriptor: null, seen: new Set(), changed: false };
  undoLog = log;
  let finished = false;
  try {
    const result = run();
    finished = true;
    return result;
  } finally {
    undoLog = null;
    if (log.descriptor !== null) {
      fs.closeSync(log.descriptor);
      if (finished || !log.changed) {
        deleteUndoLog(log.root);
      }
    }
  }
}

// Adds the line for a change to `target` (`after` is what it is about to
// hold, or null when it is deleted) to the open undo log, making the log
// headed by its command at the first change, and flushes it to disk.
function logUndo(target, after) {
  const log = undoLog;
  if (log === null || !isPathInside(log.root, target)) {
    return;
  }
  const relative = projectPath(log.root, target);
  if (!isUndoablePath(relative)) {
    throw new Error(`${relative} is not a file the undo log of ${log.command} can put back`);
  }
  const entry = { path: relative, after: after === null ? null : contentHash(after) };
  if (!log.seen.has(relative)) {
    // The text it held, and its permissions, so a file the command deletes
    // comes back as it was.
    const stats = lstatIfExists(target);
    entry.before = stats?.isFile() ? readTextFile(target) : null;
    if (entry.before !== null) {
      entry.mode = stats.mode & 0o777;
    }
  }
  let line = `${JSON.stringify(entry)}\n`;
  const made = log.descriptor === null;
  if (made) {
    // Only this user can read it: it holds the text of the files it names.
    log.descriptor = fs.openSync(path.join(log.root, UNDO_LOG), "ax", 0o600);
    line = `${JSON.stringify({ command: log.command, started: new Date().toISOString() })}\n${line}`;
  }
  fs.writeFileSync(log.descriptor, line, "utf8");
  fs.fsyncSync(log.descriptor);
  if (made) {
    syncFolder(log.root);
  }
  log.seen.add(relative);
}

// After a file was written or deleted: flushes its folder, and marks the
// open undo log as having a change to put back.
function afterChange(target) {
  syncFolder(path.dirname(target));
  if (undoLog !== null) {
    undoLog.changed = true;
  }
}

// The most of the target's name the temporary name keeps, in UTF-8 bytes:
// with the leading dot, `.story-`, the 16-character suffix, and `.tmp`, it
// stays within the 255-byte name limit of common file systems.
const TEMPORARY_NAME_BYTES = 255 - ".".length - ".story-".length - 16 - ".tmp".length;

function temporaryPath(target) {
  // Cut by bytes, a whole character at a time, so a long name in a script
  // of two- to four-byte characters still fits and stays valid text.
  let name = "";
  let bytes = 0;
  for (const character of path.basename(target)) {
    bytes += Buffer.byteLength(character, "utf8");
    if (bytes > TEMPORARY_NAME_BYTES) {
      break;
    }
    name += character;
  }
  return path.join(path.dirname(target), `.${name}.story-${crypto.randomBytes(8).toString("hex")}.tmp`);
}

function prepareWriteTarget(filePath, root) {
  const target = path.resolve(filePath);
  if (root) {
    assertLexicallyInsideRoot(target, root);
    // A planned new project (init --dry-run) has no folder to resolve yet;
    // every folder under it is new, so the lexical check is the whole check.
    if (planning === 0 || lstatIfExists(path.resolve(root)) !== null) {
      assertExistingAncestorInsideRoot(path.dirname(target), root);
    }
  }

  makeDirectories(path.dirname(target));

  // A planned folder is not made, so the existing ancestor checked above
  // stands in for it.
  if (root && lstatIfExists(path.dirname(target)) !== null) {
    assertSafeProjectParent(target, root);
  }

  rejectSymlinkTarget(target, "write");
  return target;
}

export function assertSafeProjectPath(filePath, root) {
  const target = path.resolve(filePath);
  assertLexicallyInsideRoot(target, root);
  assertSafeProjectParent(target, root);
  rejectSymlinkTarget(target, "read");
}

export function assertSafeProjectDirectory(directory, root) {
  const target = path.resolve(directory);
  assertLexicallyInsideRoot(target, root);
  const stats = lstatIfExists(target);

  if (stats) {
    if (stats.isSymbolicLink()) {
      throw projectError(`Refusing to use symlinked project directory: ${target}`);
    }

    if (!stats.isDirectory()) {
      throw projectError(`Project path is not a directory: ${target}`);
    }
  }

  const rootReal = fs.realpathSync(path.resolve(root));
  const directoryReal = fs.realpathSync(target);
  if (!isPathInside(rootReal, directoryReal)) {
    throw projectError(`Refusing to use project directory outside root: ${target}`);
  }
}

function assertSafeProjectParent(filePath, root) {
  const rootReal = fs.realpathSync(path.resolve(root));
  const parentReal = fs.realpathSync(path.dirname(path.resolve(filePath)));
  if (!isPathInside(rootReal, parentReal)) {
    throw projectError(`Refusing to access project path outside root: ${filePath}`);
  }
}

// Resolves the nearest existing ancestor of a path that may not exist yet and
// confirms it stays inside the root, so a symlinked intermediate directory
// cannot make makeDirectories create directories outside the project.
export function assertExistingAncestorInsideRoot(target, root) {
  const { ancestor: current } = nearestExistingAncestor(target);
  let rootReal;
  let currentReal;
  try {
    rootReal = fs.realpathSync(path.resolve(root));
    currentReal = fs.realpathSync(current);
  } catch {
    throw projectError(`Refusing to access project path outside root: ${target}`);
  }
  if (!isPathInside(rootReal, currentReal)) {
    throw projectError(`Refusing to access project path outside root: ${target}`);
  }
}

// The nearest ancestor of a path (or the path itself) that exists, and the
// names below it that do not, top first. `exists` defaults to lstat, so a
// symlink counts as existing whether or not it resolves. The walk stops at
// the filesystem root, which always exists.
export function nearestExistingAncestor(target, exists = lstatIfExists) {
  const missing = [];
  let current = path.resolve(target);
  while (!exists(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    missing.unshift(path.basename(current));
    current = parent;
  }
  return { ancestor: current, missing };
}

// Creates a directory and any missing parents, one level at a time. Node's
// recursive mkdir reads ENOENT as "the parent is missing", so where a file
// system answers ENOENT for a directory it will not create (procfs does, for
// /proc/anything), it creates the existing parent and retries the child
// forever. Here the first directory that cannot be created stops the walk
// with an error naming it. A directory another process created in the
// meantime counts as created, but a symlink raced into its place does not,
// so the walk cannot continue outside the folder it checked. Callers run
// their root-confinement checks before calling this.
export function makeDirectories(directory) {
  const { ancestor, missing } = nearestExistingAncestor(directory);
  // The existing ancestor may be a symlink to a folder (`--out link/book.md`).
  if (missing.length === 0 && fs.statSync(ancestor, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw directoryError(ancestor, "ENOTDIR");
  }
  if (planning > 0) {
    // mkdir needs a folder this user can write to (a dangling symlink in
    // the way fails here too, as ENOENT).
    if (missing.length > 0) {
      // Windows finds no entry below a file, rather than ENOTDIR, so a
      // file in the way is checked through its would-be child, which fails
      // as mkdir there would.
      const blocked = fs.statSync(ancestor, { throwIfNoEntry: false })?.isFile() === true;
      try {
        fs.accessSync(blocked ? path.join(ancestor, missing[0]) : ancestor, fs.constants.W_OK);
      } catch (error) {
        throw directoryError(path.join(ancestor, missing[0]), error.code ?? error.message);
      }
    }
    let planned = ancestor;
    for (const name of missing) {
      planned = path.join(planned, name);
      record(planned, false, "mkdir");
    }
    return;
  }
  if (missing.length > 0) {
    assertWriteAllowed(path.join(ancestor, missing[0]));
  }
  let current = ancestor;
  for (const name of missing) {
    current = path.join(current, name);
    try {
      fs.mkdirSync(current);
      syncFolder(path.dirname(current));
      record(current, false, "mkdir");
    } catch (error) {
      if (error.code !== "EEXIST" || lstatIfExists(current)?.isDirectory() !== true) {
        throw directoryError(current, error.code ?? error.message);
      }
    }
  }
}

function directoryError(directory, code) {
  return Object.assign(new Error(`Cannot create directory ${directory}: ${code}`), { code, path: directory, syscall: "mkdir", exitCode: EXIT_CODES.refused });
}

export function assertLexicallyInsideRoot(filePath, root) {
  const rootPath = path.resolve(root);
  const target = path.resolve(filePath);
  if (!isPathInside(rootPath, target)) {
    throw projectError(`Refusing to access path outside project root: ${target}`);
  }
}

function rejectSymlinkTarget(filePath, action) {
  if (lstatIfExists(filePath)?.isSymbolicLink()) {
    throw projectError(`${filePath}: Refusing to ${action} through symlink`);
  }
}

export function lstatIfExists(filePath) {
  return fs.lstatSync(filePath, { throwIfNoEntry: false }) ?? null;
}

// A project path as story shows it in messages, --json output, and the
// files it writes: forward slashes on every system, so output and
// exemption entries are the same on Windows as elsewhere. `sep` is the
// separator the path was built with (path.win32.sep in tests).
export function portablePath(filePath, sep = path.sep) {
  return typeof filePath !== "string" || sep === "/" ? filePath : filePath.split(sep).join("/");
}

// `file` relative to `root`, as a portable path. `paths` is node:path, or
// path.win32 / path.posix in tests.
export function projectPath(root, file, paths = path) {
  return portablePath(paths.relative(root, file), paths.sep);
}

export function isPathInside(root, target) {
  const relativePath = path.relative(root, target);
  return !path.isAbsolute(relativePath) && (relativePath === "" || !relativePath.split(path.sep).includes(".."));
}

// Characters HFS+ leaves out of a name when it looks one up (zero-width
// joiners, direction marks, the byte order mark), with the rest of
// Unicode's default-ignorable code points.
const IGNORABLE_CHARACTERS = /\p{Default_Ignorable_Code_Point}/gu;

// A file or folder name as a file system may look it up, in lower case.
// NTFS reads what follows a colon as a stream (`.git::$INDEX_ALLOCATION` is
// the folder itself, `story.md::$DATA` the file's text) and drops trailing
// dots and spaces, as vfat and exFAT do; HFS+ leaves out ignorable
// characters (`.g\u200Cit` is `.git`). Linux reaches all of these disks too
// (WSL's /mnt/c, a USB stick, an hfsplus mount) and its real path keeps the
// name as typed, so the guards that compare names use this on every system,
// as git's core.protectNTFS does.
export function fileSystemName(name) {
  return name.split(":")[0].replace(IGNORABLE_CHARACTERS, "").replace(/[. ]+$/, "").toLowerCase();
}

// NTFS also gives a long name a short one, unless the volume turns that
// off: its first six letters without dots or spaces, `~` and a number, and
// its extension cut to three letters (`GIT~1` for .git, `CHAPTE~1` for
// chapters, `STYLE-~1.MD` for style-sheet.md). Both names are as
// fileSystemName gives them. The hashed form NTFS falls back to once four
// names start alike (`CH1A2B~1`) is not matched.
export function isShortNameOf(name, longName) {
  const match = /^([^~.]{1,6})~\d+(?:\.([^.]{1,3}))?$/.exec(name);
  const dot = longName.lastIndexOf(".");
  const base = (dot > 0 ? longName.slice(0, dot) : longName).replace(/[. ]/g, "");
  const extension = dot > 0 ? longName.slice(dot + 1, dot + 4) : "";
  return match !== null && match[1] === base.slice(0, 6) && (match[2] ?? "") === extension;
}

// A folder name git reads as its own folder: `.git` in any letter case or
// under any name above, or its short name `GIT~1`.
export function isGitDirectoryName(name) {
  const lookedUp = fileSystemName(name);
  return lookedUp === ".git" || isShortNameOf(lookedUp, ".git");
}

// A git folder on the way from `base` (the project, or the folder a new
// project is made from) to `target`, as typed or behind a symlinked folder
// (`lnk -> .git`). No story command writes a repository's own files, and a
// generated file such as `--out .git/config` would replace git's settings.
// Only the names below the folder the two paths share count, so a book that
// itself sits under a folder named .git still writes its own dist/. The path
// as typed is checked first, so a name the file system reads its own way
// (`.git::$INDEX_ALLOCATION`) is refused before the file system sees it.
export function isInsideGitDirectory(target, base) {
  const resolved = path.resolve(target);
  const from = path.resolve(base);
  if (hasGitDirectoryBelow(from, resolved)) {
    return true;
  }
  const { ancestor, missing } = nearestExistingAncestor(resolved, fs.existsSync);
  return hasGitDirectoryBelow(fs.realpathSync.native(from), path.join(fs.realpathSync.native(ancestor), ...missing));
}

function hasGitDirectoryBelow(start, end) {
  return path.relative(start, end).split(path.sep).some((name) => name !== ".." && isGitDirectoryName(name));
}

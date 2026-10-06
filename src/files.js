import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { EXIT_CODES, projectError, withExitCode } from "./exit-codes.js";

export const MAX_READ_BYTES = 5 * 1024 * 1024;

// Reads a project text file. A symlink, a device, a FIFO, or a file over
// the size cap is refused, so a cloned project cannot point a read at
// /dev/zero or at a file outside itself. Every refusal starts with the
// path, so a caller that labels the file can drop it rather than repeat it.
export function readTextFile(filePath) {
  const stats = fs.lstatSync(filePath);
  if (stats.isSymbolicLink()) {
    throw projectError(`${filePath}: Refusing to read through symlink`);
  }
  if (!stats.isFile()) {
    throw projectError(`${filePath}: Refusing to read: not a regular file`);
  }
  if (stats.size > MAX_READ_BYTES) {
    throw projectError(`${filePath}: Refusing to read oversized file: ${stats.size} bytes exceeds the ${MAX_READ_BYTES} byte limit`);
  }
  return decodeUtf8(fs.readFileSync(filePath), filePath);
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
// beside the target, which is flushed to disk and then renamed over it. A
// failed write (a full disk) or a killed process leaves the old file intact
// rather than truncated. An existing file keeps its permissions, a read-only
// one stays refused, and a hard link (to a chapter, say) is replaced rather
// than written through. With `unchangedFrom`, the write is refused when the
// file no longer holds that text (an editor saved it after the command read
// it), so the save is not overwritten. Any failure, a refusal or the file
// system's, exits as a refused write.
export function writeFile(filePath, contents, options = {}) {
  const existed = lstatIfExists(path.resolve(filePath)) !== null;
  try {
    if (planning > 0) {
      planWrite(filePath, options);
    } else {
      writeWholeFile(filePath, contents, options);
    }
  } catch (error) {
    throw withExitCode(error, EXIT_CODES.refused);
  }
  record(filePath, existed, "write");
}

// Deletes a project file, recording it like a write. `force` ignores a file
// that is already gone, as fs.rmSync does.
export function removeFile(filePath, options = {}) {
  const existed = lstatIfExists(path.resolve(filePath)) !== null;
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
    fs.rmSync(filePath, { force: Boolean(options.force) });
  }
  if (existed) {
    record(filePath, true, "delete");
  }
}

// Deletes an empty folder, recording it like a deleted file (a stale codex
// folder a build emptied). Planned, it checks only that the folder's parent
// is writable, since the files that would empty it are still there.
export function removeDirectory(directory) {
  if (planning > 0) {
    fs.accessSync(path.dirname(path.resolve(directory)), fs.constants.W_OK);
  } else {
    fs.rmdirSync(directory);
  }
  record(directory, true, "delete");
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
// path } entries sorted by path, where action is create, update, delete, or
// mkdir (a folder made) and path is relative to `root` with / separators.
// A file created and then deleted by the same run is left out. Calls nest:
// an inner call's changes are recorded in the outer one too.
export function recordChanges(root, run) {
  const journal = new Map();
  journals.push(journal);
  let result;
  try {
    result = run();
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
      : action === "delete" ? (existed ? "delete" : null)
        : existed ? "update" : "create";
    if (kind !== null) {
      // The root itself, a new project's folder, is ".".
      changes.push({ action: kind, path: path.relative(base, file).split(path.sep).join("/") || "." });
    }
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function writeWholeFile(filePath, contents, options) {
  const target = prepareWriteTarget(filePath, options.root);
  const existing = lstatIfExists(target);
  if (existing) {
    fs.accessSync(target, fs.constants.W_OK);
  }
  const mode = existing ? existing.mode & 0o777 : 0o666;
  const temporary = temporaryPath(target);
  try {
    const descriptor = fs.openSync(temporary, "w", mode);
    try {
      fs.writeFileSync(descriptor, contents, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (existing) {
      fs.chmodSync(temporary, mode);
    }
    if (options.unchangedFrom !== undefined && currentText(target) !== options.unchangedFrom) {
      fs.rmSync(temporary, { force: true });
      throw Object.assign(new Error(`${options.root ? projectPath(path.resolve(options.root), target) : target} changed on disk while story was updating it, so it was left as it is. Run the command again`), { changedOnDisk: true });
    }
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (error.changedOnDisk) {
      throw error;
    }
    // Name the file the user asked for, not the temporary one.
    const action = existing?.nlink > 1 ? "replace hard-linked" : "write to";
    throw Object.assign(new Error(`Cannot ${action} ${target}: ${error.code ?? error.message}`), { code: error.code, path: target, syscall: "write" });
  }
}

// writeWholeFile's checks, without the write: the target is inside the
// root and not a symlink, an existing file is writable and unchanged, and
// the folder the temporary file goes in (or, for a new folder, its nearest
// existing ancestor) is writable, with no folder in the temporary file's
// place. A refusal names the target as writeWholeFile's does.
function planWrite(filePath, options) {
  const target = prepareWriteTarget(filePath, options.root);
  const existing = lstatIfExists(target);
  if (existing) {
    fs.accessSync(target, fs.constants.W_OK);
  }
  try {
    fs.accessSync(nearestExistingAncestor(path.dirname(target)).ancestor, fs.constants.W_OK);
    // Opening the temporary file, or renaming it over a folder, fails.
    if (lstatIfExists(temporaryPath(target))?.isDirectory() || existing?.isDirectory()) {
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

// The file's text now, or null when it is gone or unreadable.
function currentText(target) {
  try {
    return fs.readFileSync(target, "utf8");
  } catch {
    return null;
  }
}

// `.chapter-01.md.story-1234.tmp`: hidden, never scanned as markdown, and
// named after its target so validate can say what an interrupted write
// left behind.
export const TEMPORARY_FILE_PATTERN = /^\.(.+)\.story-\d+\.tmp$/;

function temporaryPath(target) {
  const name = path.basename(target).slice(0, 200);
  return path.join(path.dirname(target), `.${name}.story-${process.pid}.tmp`);
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
  let current = ancestor;
  for (const name of missing) {
    current = path.join(current, name);
    try {
      fs.mkdirSync(current);
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

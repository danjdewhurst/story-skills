import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";

export const MAX_READ_BYTES = 5 * 1024 * 1024;

// Reads a project text file. A symlink, a device, a FIFO, or a file over
// the size cap is refused, so a cloned project cannot point a read at
// /dev/zero or at a file outside itself.
export function readTextFile(filePath) {
  const stats = fs.lstatSync(filePath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to read through symlink: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Refusing to read ${filePath}: not a regular file`);
  }
  if (stats.size > MAX_READ_BYTES) {
    throw new Error(`Refusing to read oversized file ${filePath}: ${stats.size} bytes exceeds the ${MAX_READ_BYTES} byte limit`);
  }
  return decodeUtf8(fs.readFileSync(filePath), filePath);
}

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
    throw new Error(`${filePath} is not valid UTF-8 (byte 0x${byte} at offset ${offset}): re-save it as UTF-8`);
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
// than written through.
export function writeFile(filePath, contents, options = {}) {
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
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    // Name the file the user asked for, not the temporary one.
    const action = existing?.nlink > 1 ? "replace hard-linked" : "write to";
    throw Object.assign(new Error(`Cannot ${action} ${target}: ${error.code ?? error.message}`), { code: error.code, path: target, syscall: "write" });
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
    assertExistingAncestorInsideRoot(path.dirname(target), root);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (root) {
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
      throw new Error(`Refusing to use symlinked project directory: ${target}`);
    }

    if (!stats.isDirectory()) {
      throw new Error(`Project path is not a directory: ${target}`);
    }
  }

  const rootReal = fs.realpathSync(path.resolve(root));
  const directoryReal = fs.realpathSync(target);
  if (!isPathInside(rootReal, directoryReal)) {
    throw new Error(`Refusing to use project directory outside root: ${target}`);
  }
}

function assertSafeProjectParent(filePath, root) {
  const rootReal = fs.realpathSync(path.resolve(root));
  const parentReal = fs.realpathSync(path.dirname(path.resolve(filePath)));
  if (!isPathInside(rootReal, parentReal)) {
    throw new Error(`Refusing to access project path outside root: ${filePath}`);
  }
}

// Resolves the nearest existing ancestor of a path that may not exist yet and
// confirms it stays inside the root, so a symlinked intermediate directory
// cannot make a recursive mkdir create directories outside the project.
export function assertExistingAncestorInsideRoot(target, root) {
  let current = path.resolve(target);
  while (!lstatIfExists(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  let rootReal;
  let currentReal;
  try {
    rootReal = fs.realpathSync(path.resolve(root));
    currentReal = fs.realpathSync(current);
  } catch {
    throw new Error(`Refusing to access project path outside root: ${target}`);
  }
  if (!isPathInside(rootReal, currentReal)) {
    throw new Error(`Refusing to access project path outside root: ${target}`);
  }
}

export function assertLexicallyInsideRoot(filePath, root) {
  const rootPath = path.resolve(root);
  const target = path.resolve(filePath);
  if (!isPathInside(rootPath, target)) {
    throw new Error(`Refusing to access path outside project root: ${target}`);
  }
}

function rejectSymlinkTarget(filePath, action) {
  if (lstatIfExists(filePath)?.isSymbolicLink()) {
    throw new Error(`Refusing to ${action} through symlink: ${filePath}`);
  }
}

export function lstatIfExists(filePath) {
  return fs.lstatSync(filePath, { throwIfNoEntry: false }) ?? null;
}

export function isPathInside(root, target) {
  const relativePath = path.relative(root, target);
  return !path.isAbsolute(relativePath) && (relativePath === "" || !relativePath.split(path.sep).includes(".."));
}

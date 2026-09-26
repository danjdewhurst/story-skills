import fs from "node:fs";
import path from "node:path";

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
  return fs.readFileSync(filePath, "utf8");
}

export function writeFile(filePath, contents, options = {}) {
  const target = prepareWriteTarget(filePath, options.root);
  const existing = lstatIfExists(target);
  if (!existing || existing.nlink <= 1) {
    // In place, so the file keeps its permissions and a read-only file
    // stays refused.
    fs.writeFileSync(target, contents, "utf8");
    return;
  }
  // A hard link (to a chapter, say) is replaced with a new file rather than
  // written through, keeping the old file's permissions.
  fs.accessSync(target, fs.constants.W_OK);
  const temporary = path.join(path.dirname(target), `.story-${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporary, contents, { encoding: "utf8", mode: existing.mode & 0o777 });
    fs.chmodSync(temporary, existing.mode & 0o777);
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    // Name the file the user asked for, not the temporary one.
    throw Object.assign(new Error(`Cannot replace hard-linked ${target}: ${error.code ?? error.message}`), { code: error.code, path: target, syscall: "rename" });
  }
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

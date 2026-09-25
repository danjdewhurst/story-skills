import fs from "node:fs";

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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_READ_BYTES, isPathInside, lstatIfExists, nearestExistingAncestor, readFileBytes, readTextFile, recordChanges } from "./files.js";
import { usageError } from "./exit-codes.js";
import { LOCK_FILE, TAKEOVER_FILE } from "./lock.js";
import { MATTER_DIR, MAX_SCAN_DEPTH, MAX_SCAN_FILES, SKIPPED_SCAN_DIRECTORIES, extractMarkdownLinkTargets, requireStoryFile } from "./scan.js";
import { MAX_SERIES_BOOKS, readBookFrontmatter, seriesLinks } from "./series.js";

// --dry-run: a write command runs unchanged on a scratch copy of the
// project, and the writes, renames, and deletes it records there (see
// recordChanges) are the preview. The preview is the real run, so it cannot
// drift from it, and the project itself is only read: no file is written,
// and its lock is not taken, so a preview never waits on a running command.
//
// The scratch folder stands in for the filesystem root: the copy sits at the
// project's own absolute path inside it, beside copies of the books it is
// linked to in a series, so a link such as `follows: ../book-one` resolves in
// the copy as it does in the project.

// Runs `run(copyRoot)` on a copy of the project at `root` and returns
// { result, changes }: the command's result with every path into the copy
// pointing back at the project, and the changes it made, relative to the
// project root. An error is rethrown the same way, so it names project
// files.
export function previewChanges(root, run) {
  const projectRoot = path.resolve(root);
  requireStoryFile(projectRoot);
  return inScratch(projectRoot, run, (copyRoot, mirror, atRoot) => {
    fs.mkdirSync(path.dirname(copyRoot), { recursive: true });
    copyProject(projectRoot, copyRoot, { realSource: realPath(projectRoot), copyRoot });
    if (!atRoot) {
      copyLinkedBooks(projectRoot, mirror);
    }
  });
}

// previewChanges for a command that makes a project, story import: `root`
// is the folder the project would be made in, which may not exist yet, or
// may be a project or other folder that --force fills. Whatever is there is
// copied as previewChanges copies a project, and the story.md of each
// folder above it too, so the check that refuses a project inside another
// project answers as in the real run. Of a folder that does not exist, only
// its nearest existing ancestor is made in the copy, with that ancestor's
// access, so the run makes (and lists) the same missing folders, or is
// refused the same way.
export function previewNewProject(root, run) {
  const target = path.resolve(root);
  if (target === path.parse(target).root) {
    throw usageError(`--dry-run cannot preview a project made at ${target}`);
  }
  return inScratch(target, run, (copyRoot, mirror) => {
    const stats = lstatIfExists(target);
    const ancestor = stats ? path.dirname(target) : nearestExistingAncestor(target).ancestor;
    // A dangling symlink in the way stays one, so making a folder through
    // it fails in the copy too.
    const isFolder = fs.statSync(ancestor, { throwIfNoEntry: false })?.isDirectory() === true;
    fs.mkdirSync(isFolder ? mirror(ancestor) : path.dirname(mirror(ancestor)), { recursive: true });
    if (!isFolder) {
      fs.symlinkSync(path.join(path.dirname(mirror(ancestor)), ".story-dry-run-link"), mirror(ancestor));
    }
    for (let folder = path.dirname(target); ; folder = path.dirname(folder)) {
      const story = path.join(folder, "story.md");
      // A symlinked story.md does not make a project, so it is not copied.
      if (lstatIfExists(story)?.isFile()) {
        fs.mkdirSync(mirror(folder), { recursive: true });
        copyFile(story, mirror(story));
      }
      if (path.dirname(folder) === folder) {
        break;
      }
    }
    if (stats?.isSymbolicLink()) {
      // A symlinked project folder is refused; the copy is a link to
      // nowhere, so nothing can be written through it.
      fs.symlinkSync(path.join(path.dirname(copyRoot), ".story-dry-run-link"), copyRoot);
    } else if (stats?.isDirectory()) {
      copyProject(target, copyRoot, { realSource: realPath(target), copyRoot });
    } else if (stats) {
      copyFile(target, copyRoot);
    }
    if (isFolder) {
      fs.chmodSync(mirror(ancestor), copyMode(ancestor, true));
    }
  });
}

// Runs `run(copyRoot)` in a scratch folder that stands in for the
// filesystem root, after `prepare(copyRoot, mirror, atRoot)` copies into it
// what the command reads (and makes the folders above copyRoot), and
// removes the folder afterwards.
function inScratch(target, run, prepare) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "story-dry-run-")));
  const fsRoot = path.parse(target).root;
  const atRoot = target === fsRoot;
  // A path's place in the scratch folder. A Windows drive or share becomes
  // the first folder: C:\book is scratch\C\book.
  const mirror = (file) => {
    const drive = path.parse(file).root;
    return path.join(scratch, drive.replace(/[:\\/]/g, ""), file.slice(drive.length));
  };
  const copyRoot = atRoot ? path.join(scratch, "project") : mirror(target);
  // Every path into the scratch folder maps back to the path it copies, so a
  // finding about a linked book names the real book too.
  const [from, to] = atRoot ? [copyRoot, target] : [mirror(fsRoot), fsRoot.replace(/[\\/]+$/, "")];
  try {
    prepare(copyRoot, mirror, atRoot);
    if (!atRoot) {
      // The real path a scratch path mirrors; null for another drive's.
      const realOf = (file) => (isPathInside(from, file) ? to + file.slice(from.length) : null);
      copyLinkTargets(copyRoot, scratch, mirror, realOf);
    }
    const { result, changes } = recordChanges(copyRoot, () => run(copyRoot));
    return { result: mapPaths(result, from, to), changes };
  } catch (error) {
    throw toProjectError(error, from, to);
  } finally {
    removeScratch(scratch);
  }
}

// Copies the books the project links to through follows/precedes, and those
// its sibling books link to, each to its own path in the scratch folder
// (mirror), since series checks and links read them there. A book is copied
// once, at its real path; a link that reaches it through a symlink stays a
// symlink to that copy, so checks that compare real paths (is it the same
// book, is it a sibling) answer as they do in the project. The copies are
// scratch files, so no write reaches a linked book, and copying stops at
// the series book limit, as `story series` does.
function copyLinkedBooks(projectRoot, mirror) {
  const parent = path.dirname(projectRoot);
  const realParent = realPath(parent);
  // A real path in the parent folder is named through the parent as the
  // project names it (on macOS /var links to /private/var), so a sibling's
  // copy shares the parent folder of the project's copy.
  const home = (real) => (isPathInside(realParent, real) ? path.join(parent, path.relative(realParent, real)) : real);
  const alias = (link, book) => {
    if (link !== book && !fs.existsSync(mirror(link))) {
      fs.mkdirSync(path.dirname(mirror(link)), { recursive: true });
      fs.symlinkSync(mirror(book), mirror(link));
    }
  };
  const projectReal = realPath(projectRoot);
  // Each book copied, by real path, and the path its copy mirrors.
  const copies = new Map([[projectReal, projectRoot]]);
  alias(home(projectReal), projectRoot);
  const queued = new Set([projectReal]);
  const queue = [projectRoot];
  while (queue.length > 0) {
    const book = queue.shift();
    let data;
    try {
      data = readBookFrontmatter(book);
    } catch {
      continue;
    }
    for (const link of ["follows", "precedes"].flatMap((field) => seriesLinks(book, data ?? {}, field))) {
      const real = realPath(link);
      if (!copies.has(real)) {
        const target = mirror(home(real));
        // fs.existsSync(target): a folder the copies already sit in, such as
        // the parent folder.
        if (copies.size > MAX_SERIES_BOOKS || !fs.existsSync(path.join(real, "story.md")) || fs.existsSync(target)) {
          continue;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        copyProject(real, target, { realSource: real, copyRoot: target });
        copies.set(real, home(real));
      }
      alias(link, copies.get(real));
      // Like `story series`, only sibling books' links are followed.
      if (path.dirname(link) === parent && !queued.has(real)) {
        queued.add(real);
        queue.push(link);
      }
    }
  }
}

// The most symlinks followed to stage one link target, as the system's own
// limit on a path stops a loop.
const MAX_LINK_HOPS = 40;

// A markdown link to a file outside the project is an error in its own
// right (link-outside-project), and one into a linked book is accepted when
// the file is there, so validate asks whether each target exists. Each part
// of a target's path that the scratch folder lacks outside the copy, but
// that exists in fact, is made there: an empty file or folder (only its
// being there is checked), or a symlink like the real one. Symlinks already
// in the copy are followed, so an in-project link that leads outside the
// project is staged too. The dry run then reports each link as the real run
// does rather than as a broken link.
function copyLinkTargets(copyRoot, scratch, mirror, realOf) {
  if (!lstatIfExists(copyRoot)?.isDirectory()) {
    return;
  }
  const context = { copyRoot, scratch, mirror, realOf };
  for (const file of linkSources(copyRoot)) {
    // A file validate refuses to read has no links it checks: a symlink, a
    // folder, text that is not UTF-8, or an oversized file (a blank sparse
    // copy here).
    let body;
    try {
      body = readTextFile(file);
    } catch {
      continue;
    }
    for (const target of extractMarkdownLinkTargets(body)) {
      // An absolute target names the real file already.
      if (path.isAbsolute(target) || !path.basename(target).endsWith(".md")) {
        continue;
      }
      try {
        stageLinkTarget(path.resolve(path.dirname(file), target), context, 0);
      } catch {
        // A file where a folder would go: the link is reported as missing,
        // as in the real run.
      }
    }
  }
}

// The files whose markdown links validate checks (see checkBodyLinkTarget
// in validate.js): the timeline, the arcs, and the matter pages.
function linkSources(copyRoot) {
  const files = [path.join(copyRoot, "plot", "timeline.md")];
  for (const folder of [path.join("plot", "arcs"), MATTER_DIR]) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(copyRoot, folder), { withFileTypes: true });
    } catch {
      continue;
    }
    files.push(...entries.filter((entry) => entry.name.endsWith(".md")).slice(0, MAX_SCAN_FILES).map((entry) => path.join(copyRoot, folder, entry.name)));
  }
  return files;
}

// Walks `file` from the scratch root as the system would, following
// symlinks, and makes each missing part outside the copy that exists in
// fact. Inside the copy, a missing part was left out on purpose (dist/, a
// nested project), and a link to it is broken in the real run too. Returns
// the path reached, or null where the walk stops: something missing, a
// symlink out of the scratch folder (to the real file, which the command
// reads directly), or too many symlinks.
function stageLinkTarget(file, context, hops) {
  const { copyRoot, scratch } = context;
  if (!isPathInside(scratch, file) || file === scratch) {
    return null;
  }
  const parts = path.relative(scratch, file).split(path.sep);
  let current = scratch;
  for (const [index, part] of parts.entries()) {
    const next = path.join(current, part);
    let stats = lstatIfExists(next);
    if (!stats) {
      if (isPathInside(copyRoot, next) || !makeStandIn(next, context, index === parts.length - 1)) {
        return null;
      }
      stats = fs.lstatSync(next);
    }
    if (stats.isSymbolicLink()) {
      if (hops >= MAX_LINK_HOPS) {
        return null;
      }
      current = stageLinkTarget(path.resolve(path.dirname(next), fs.readlinkSync(next)), context, hops + 1);
      if (current === null) {
        return null;
      }
    } else {
      current = next;
    }
  }
  return current;
}

// Makes `copy` stand in for the real path it mirrors, and returns whether
// that path exists. A folder that is a project in fact gets an empty
// story.md, so a scan of a linked book still skips it as another project.
function makeStandIn(copy, { mirror, realOf }, last) {
  const real = realOf(copy);
  const stats = real === null ? null : lstatIfExists(real);
  if (!stats || !(stats.isSymbolicLink() || stats.isDirectory() || (last && stats.isFile()))) {
    return false;
  }
  // A copied folder may be read-only, as its book is; the stand-in is
  // scratch, so it is made all the same.
  withWritable(path.dirname(copy), () => {
    if (stats.isSymbolicLink()) {
      const text = fs.readlinkSync(real);
      fs.symlinkSync(path.isAbsolute(text) ? mirror(text) : text, copy, isFolder(real) ? "dir" : "file");
    } else if (stats.isDirectory()) {
      fs.mkdirSync(copy);
      if (lstatIfExists(path.join(real, "story.md"))) {
        fs.writeFileSync(path.join(copy, "story.md"), "");
      }
    } else {
      fs.writeFileSync(copy, "");
    }
  });
  return true;
}

// Whether `target` leads to a folder; false for a dangling or looping link.
function isFolder(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function withWritable(folder, make) {
  const mode = fs.statSync(folder).mode & 0o7777;
  if ((mode & 0o300) === 0o300) {
    make();
    return;
  }
  fs.chmodSync(folder, mode | 0o300);
  try {
    make();
  } finally {
    fs.chmodSync(folder, mode);
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
      // Typed as its target is: on Windows a folder link made before its
      // target exists would otherwise be a file link, and unusable.
      fs.symlinkSync(linkTarget(fs.readlinkSync(from), roots), to, isFolder(from) ? "dir" : "file");
    } else if (entry.isFile() && entry.name !== LOCK_FILE && entry.name !== TAKEOVER_FILE) {
      copyFile(from, to);
    }
    // A FIFO, socket, or device is never read by a command, so it is not
    // copied (reading a FIFO would block).
  }
  // Set last, so a read-only folder still received its files.
  fs.chmodSync(target, copyMode(source, true));
}

// Write commands read the text of markdown files only (and import the
// .gitignore it keeps), and no file over the read limit; of any other file
// (a cover image) they check at most the size. So only readable markdown is copied whole. Every other file is a
// sparse file of the same size, which takes no disk space, and an
// unreadable file stays unreadable. The copy is read as a command reads
// it, so a file swapped for a FIFO or a symlink since the folder was
// listed is refused rather than followed or waited on.
function copyFile(from, to) {
  const { size } = fs.statSync(from);
  if ((from.endsWith(".md") || path.basename(from) === ".gitignore") && size <= MAX_READ_BYTES && allowed(from, fs.constants.R_OK)) {
    fs.writeFileSync(to, readFileBytes(from));
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

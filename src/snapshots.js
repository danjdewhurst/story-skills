import fs from "node:fs";
import path from "node:path";
import { assertSafeProjectDirectory, lstatIfExists, readTextFile, removeFile, writeFile } from "./files.js";
import { withProjectLock } from "./lock.js";
import { kebabCase } from "./markdown.js";
import { formatNumber } from "./compare.js";
import { refusedError, usageError } from "./exit-codes.js";
import { assertProjectParses, markdownFiles, requireStoryFile, scanProject } from "./scan.js";

// Named snapshots: `story snapshot <name>` copies the project's markdown to
// .snapshots/<name>/, so a writer without git can keep a draft and compare
// with it later (`story compare --snapshot <name>`). Every scan skips
// dot-folders, so a snapshot is never read as part of the project.
export const SNAPSHOTS_DIR = ".snapshots";
export const SNAPSHOT_MANIFEST = "snapshot.json";

const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// The folder name for a snapshot: `id` when given, else the kebab-case form
// of the name ("Before the line edit" is before-the-line-edit). A name with
// a letter no folder name can spell (Chinese, Arabic, Hebrew, and the other
// scripts kebabCase drops) needs `id`, so "初稿 v2" and "改稿 v2" never
// share the folder v2.
export function snapshotId(name, id) {
  if (id !== undefined) {
    const explicit = String(id).trim();
    if (!KEBAB_ID.test(explicit)) {
      throw usageError(`Snapshot --id must be kebab-case, such as first-draft: got ${explicit}`);
    }
    return explicit;
  }
  const text = String(name ?? "").trim();
  if (text === "") {
    throw usageError("story snapshot needs a name, such as story snapshot \"before line edit\"");
  }
  const unspelled = [...text].filter((character) => /[\p{L}\p{N}]/u.test(character) && character !== "\u02bc" && kebabCase(character) === "");
  const derived = kebabCase(text);
  if (unspelled.length > 0 || derived === "") {
    const reason = unspelled.length > 0 ? `has letters a folder name cannot spell (${unspelled.slice(0, 3).join("")})` : "has no letters or digits to name its folder";
    throw usageError(`Snapshot name ${text} ${reason}: add --id <kebab-id>, such as --id first-draft`);
  }
  return derived;
}

// Saves every markdown file a scan reads (the files `markdownFiles` walks:
// not dist/, node_modules/, dot-folders, or nested projects) to
// .snapshots/<id>/ under the same paths, with a snapshot.json manifest. An
// existing snapshot is refused unless `force`, which replaces it whole.
export function snapshotProject(root, options = {}) {
  return withProjectLock(root, () => snapshotProjectUnlocked(root, options));
}

function snapshotProjectUnlocked(root, options) {
  const id = snapshotId(options.name, options.id);
  const project = scanProject(root);
  // A chapter that fails to parse would be missing from the word count, and
  // from a later comparison.
  assertProjectParses(project, "take a snapshot");
  const projectRoot = project.root;
  const target = path.join(projectRoot, SNAPSHOTS_DIR, id);
  const existing = lstatIfExists(target);
  if (existing && !options.force) {
    throw refusedError(`Snapshot ${id} already exists in ${SNAPSHOTS_DIR}/${id}: choose another name, or add --force to replace it`);
  }
  const previous = existing ? snapshotFiles(target, projectRoot) : [];
  // The snapshot being replaced is kept aside until the new one is whole,
  // so a failed write (a full disk, an unreadable file) leaves it as it was.
  const backup = existing ? path.join(projectRoot, SNAPSHOTS_DIR, `.${id}.story-${process.pid}.backup`) : null;
  if (backup !== null) {
    fs.rmSync(backup, { recursive: true, force: true });
    fs.cpSync(target, backup, { recursive: true });
  }
  try {
    const manifest = writeSnapshot(project, target, id, options, previous);
    return { ...manifest, dir: `${SNAPSHOTS_DIR}/${id}`, replaced: existing !== null, warnings: [] };
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    if (backup !== null) {
      fs.renameSync(backup, target);
    }
    throw error;
  } finally {
    if (backup !== null) {
      fs.rmSync(backup, { recursive: true, force: true });
    }
  }
}

function writeSnapshot(project, target, id, options, previous) {
  const projectRoot = project.root;
  const files = markdownFiles(projectRoot);
  const written = new Set();
  for (const file of files) {
    const copy = path.join(target, path.relative(projectRoot, file));
    writeFile(copy, readTextFile(file), { root: projectRoot });
    written.add(copy);
  }
  const characters = project.unit?.name === "characters";
  const manifest = {
    name: String(options.name).trim(),
    id,
    created: (options.now ?? new Date()).toISOString(),
    chapters: project.chapters.length,
    words: project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    ...(characters ? { characters: project.chapters.reduce((sum, chapter) => sum + chapter.count, 0) } : {}),
    files: files.length
  };
  const manifestPath = path.join(target, SNAPSHOT_MANIFEST);
  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { root: projectRoot });
  written.add(manifestPath);

  // A replaced snapshot keeps nothing from the old one.
  for (const file of previous) {
    if (!written.has(file)) {
      removeFile(file);
    }
  }
  removeEmptyFolders(target);
  return manifest;
}

// The files under an existing snapshot folder, which must be a real folder
// inside the project.
function snapshotFiles(directory, root) {
  assertSafeProjectDirectory(path.dirname(directory), root);
  assertSafeProjectDirectory(directory, root);
  const files = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files.push(full);
      }
    }
  };
  walk(directory);
  return files;
}

function removeEmptyFolders(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const full = path.join(folder, entry.name);
      removeEmptyFolders(full);
      if (fs.readdirSync(full).length === 0) {
        fs.rmdirSync(full);
      }
    }
  }
}

// The project's snapshots, oldest first, each as its manifest says. A
// folder without a readable manifest is still listed, by its folder name.
export function listSnapshots(root) {
  const projectRoot = path.resolve(root);
  requireStoryFile(projectRoot);
  const folder = path.join(projectRoot, SNAPSHOTS_DIR);
  const warnings = [];
  if (lstatIfExists(folder) === null) {
    return { ok: true, errors: [], warnings, snapshots: [] };
  }
  assertSafeProjectDirectory(folder, projectRoot);
  const snapshots = fs.readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const blank = { name: entry.name, id: entry.name, created: null, chapters: null, words: null };
      try {
        const manifest = JSON.parse(readTextFile(path.join(folder, entry.name, SNAPSHOT_MANIFEST)));
        return {
          ...blank,
          ...(typeof manifest.name === "string" ? { name: manifest.name } : {}),
          ...(typeof manifest.created === "string" ? { created: manifest.created } : {}),
          ...(Number.isInteger(manifest.chapters) ? { chapters: manifest.chapters } : {}),
          ...(Number.isInteger(manifest.words) ? { words: manifest.words } : {}),
          ...(Number.isInteger(manifest.characters) ? { characters: manifest.characters } : {})
        };
      } catch {
        return blank;
      }
    })
    .sort(bySnapshotAge);
  return { ok: true, errors: [], warnings, snapshots };
}

// Oldest first by the manifest's ISO time, a snapshot with none last, then
// by id, compared by code unit so the order is the same in every locale.
function bySnapshotAge(a, b) {
  const order = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
  if ((a.created === null) !== (b.created === null)) {
    return a.created === null ? 1 : -1;
  }
  return order(a.created ?? "", b.created ?? "") || order(a.id, b.id);
}

// The folder of an existing snapshot, for compare --snapshot: `value` is
// its name as given when it was taken, its id, or a name with that id.
export function existingSnapshot(root, value) {
  const projectRoot = path.resolve(root);
  const text = String(value).trim();
  const { snapshots } = listSnapshots(projectRoot);
  let derived = null;
  try {
    derived = snapshotId(text);
  } catch {
    // A name only an exact match finds.
  }
  const found = snapshots.find((snapshot) => snapshot.name === text)
    ?? snapshots.find((snapshot) => snapshot.id === text || snapshot.id === derived);
  if (found === undefined) {
    const list = snapshots.length === 0 ? "this project has none yet (story snapshot <name> takes one)" : `story snapshot --list shows them: ${snapshots.map((snapshot) => snapshot.id).join(", ")}`;
    throw usageError(`No snapshot named ${text}: ${list}`);
  }
  const directory = path.join(projectRoot, SNAPSHOTS_DIR, found.id);
  assertSafeProjectDirectory(directory, projectRoot);
  return { directory, id: found.id };
}

export function formatSnapshot(result) {
  const counts = [`${result.chapters} ${result.chapters === 1 ? "chapter" : "chapters"}`, `${formatNumber(result.words)} words`];
  if (result.characters !== undefined) {
    counts.push(`${formatNumber(result.characters)} characters`);
  }
  return `${result.replaced ? "Replaced" : "Saved"} snapshot ${result.id} in ${result.dir}/ (${counts.join(", ")}; ${result.files} ${result.files === 1 ? "file" : "files"})\nCompare with it later: story compare --snapshot ${result.id}\n`;
}

export function formatSnapshotList(report) {
  if (report.snapshots.length === 0) {
    return "No snapshots yet: story snapshot <name> takes one\n";
  }
  const lines = report.snapshots.map((snapshot) => {
    const when = snapshot.created === null ? "unknown date" : `${snapshot.created.slice(0, 16).replace("T", " ")} UTC`;
    const words = snapshot.words === null ? "? words" : `${formatNumber(snapshot.words)} words`;
    const chapters = snapshot.chapters === null ? "? chapters" : `${snapshot.chapters} ${snapshot.chapters === 1 ? "chapter" : "chapters"}`;
    const label = snapshot.name === snapshot.id ? snapshot.id : `${snapshot.id} (${snapshot.name})`;
    return `- ${label}: ${when}, ${chapters}, ${words}`;
  });
  return `Snapshots: ${report.snapshots.length}\n\n${lines.join("\n")}\n`;
}

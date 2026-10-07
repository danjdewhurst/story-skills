import fs from "node:fs";
import path from "node:path";
import { assertSafeProjectDirectory, assertWriteAllowed, currentText, lstatIfExists, projectPath, readTextFile, removeDirectory, removeFile, writeFile } from "./files.js";
import { kebabCase } from "./markdown.js";
import { formatNumber } from "./compare.js";
import { plural } from "./plural.js";
import { EXIT_CODES, exitCodeFor, refusedError, usageError } from "./exit-codes.js";
import { warn } from "./findings.js";
import { reindexProject } from "./mutate.js";
import { PROJECT_DIRECTORIES, assertProjectParses, markdownFiles, requireStoryFile, scanProject } from "./scan.js";

// Named snapshots: `story snapshot <name>` copies the project's markdown to
// .snapshots/<name>/, so a writer without git can keep a draft and compare
// with it later (`story compare --snapshot <name>`). Every scan skips
// dot-folders, so a snapshot is never read as part of the project.
export const SNAPSHOTS_DIR = ".snapshots";
export const SNAPSHOT_MANIFEST = "snapshot.json";

// Written into .snapshots/ when a snapshot makes the folder: a snapshot
// copies every markdown file, including ones the project's .gitignore keeps
// out of git, so the copies stay out too unless the writer deletes it.
export const SNAPSHOTS_GITIGNORE = ".gitignore";
const SNAPSHOTS_GITIGNORE_TEXT = "# Snapshots copy every markdown file, including ones git ignores, so git\n# ignores them. Delete this file to commit your snapshots.\n*\n";

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

// <prefix><n> for a snapshot a command takes to keep the project as it was
// (before-restore-<id>-<n>, before-import-<n>): one more than the highest n
// a snapshot with that prefix has, so each run keeps its own and later ones
// number higher. A number of more than 15 digits, too long to add one to
// exactly, counts for nothing, and a name already taken is passed over.
// Only a real .snapshots/ folder is read; a symlink or a file there is
// refused when the snapshot is written.
export function nextSnapshotId(root, prefix) {
  const folder = path.join(path.resolve(root), SNAPSHOTS_DIR);
  const taken = new Set(lstatIfExists(folder)?.isDirectory() ? fs.readdirSync(folder) : []);
  let next = 1;
  for (const name of taken) {
    const rest = name.startsWith(prefix) ? name.slice(prefix.length) : "";
    if (/^[1-9]\d{0,14}$/.test(rest)) {
      next = Math.max(next, Number(rest) + 1);
    }
  }
  while (taken.has(`${prefix}${next}`)) {
    next += 1;
  }
  return `${prefix}${next}`;
}

// Saves every markdown file a scan reads (the files `markdownFiles` walks:
// not dist/, node_modules/, dot-folders, or nested projects) to
// .snapshots/<id>/ under the same paths, with a snapshot.json manifest. An
// existing snapshot is refused unless `force`, which replaces it whole.
export function snapshotProject(root, options = {}) {
  const id = snapshotId(options.name, options.id);
  const project = scanProject(root);
  // A chapter that fails to parse would be missing from the word count, and
  // from a later comparison. The safety copy a restore takes first keeps
  // the project in whatever state it is: its counts leave out a file that
  // does not parse, but every markdown file is copied.
  if (!options.unparsed) {
    assertProjectParses(project, "take a snapshot");
  }
  const projectRoot = project.root;
  // A .snapshots that is a symlink or a file is refused, as --list and
  // --restore refuse it, before anything is looked up through it: Windows
  // finds no file under a file where other systems fail the lookup.
  const folder = path.join(projectRoot, SNAPSHOTS_DIR);
  const madeFolder = lstatIfExists(folder) === null;
  if (!madeFolder) {
    assertSafeProjectDirectory(folder, projectRoot);
  }
  const target = path.join(folder, id);
  const existing = lstatIfExists(target);
  if (existing && !options.force) {
    throw refusedError(`Snapshot ${id} already exists in ${SNAPSHOTS_DIR}/${id}: choose another name, or add --force to replace it`);
  }
  // The backup and the rollback below are not made through writeFile, so a
  // project whose lock could not be made is refused before them.
  assertWriteAllowed(target);
  const previous = existing ? snapshotFiles(target, projectRoot) : [];
  // The snapshot being replaced is kept aside until the new one is whole,
  // so a failed write (a full disk, an unreadable file) leaves it as it was.
  const backup = existing ? path.join(projectRoot, SNAPSHOTS_DIR, `.${id}.story-${process.pid}.backup`) : null;
  if (backup !== null) {
    fs.rmSync(backup, { recursive: true, force: true });
    fs.cpSync(target, backup, { recursive: true });
  }
  try {
    if (madeFolder) {
      writeFile(path.join(folder, SNAPSHOTS_GITIGNORE), SNAPSHOTS_GITIGNORE_TEXT, { root: projectRoot });
    }
    const manifest = writeSnapshot(project, target, id, options, previous);
    return { ...manifest, dir: `${SNAPSHOTS_DIR}/${id}`, replaced: existing !== null, warnings: [] };
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    if (backup !== null) {
      fs.renameSync(backup, target);
    }
    // A .snapshots/ folder this snapshot made goes too, unless something
    // else is in it now.
    if (madeFolder) {
      fs.rmSync(path.join(folder, SNAPSHOTS_GITIGNORE), { force: true });
      try {
        fs.rmdirSync(folder);
      } catch {
        // Not empty, or already gone.
      }
    }
    throw error;
  } finally {
    if (backup !== null) {
      fs.rmSync(backup, { recursive: true, force: true });
    }
  }
}

// Each copy keeps its source's permissions, with read and write for its
// owner, so a file only its owner may read stays that way. The counts leave
// out a file that does not parse (one a safety snapshot keeps); `unparsed`
// says how many there are.
function writeSnapshot(project, target, id, options, previous) {
  const projectRoot = project.root;
  const files = markdownFiles(projectRoot);
  const written = new Set();
  for (const file of files) {
    const copy = path.join(target, path.relative(projectRoot, file));
    writeFile(copy, readTextFile(file), { root: projectRoot, mode: (fs.statSync(file).mode & 0o777) | 0o600 });
    written.add(copy);
  }
  const copied = new Set(files.map((file) => projectPath(projectRoot, file)));
  const unparsed = new Set((project.fileErrors ?? []).map((error) => String(error.file).replace(/\\/g, "/")).filter((file) => copied.has(file))).size;
  const characters = project.unit?.name === "characters";
  const manifest = {
    name: String(options.name).trim(),
    id,
    created: (options.now ?? new Date()).toISOString(),
    chapters: project.chapters.length,
    words: project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    ...(characters ? { characters: project.chapters.reduce((sum, chapter) => sum + chapter.count, 0) } : {}),
    files: files.length,
    ...(unparsed > 0 ? { unparsed } : {})
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
          ...(Number.isInteger(manifest.characters) ? { characters: manifest.characters } : {}),
          ...(Number.isInteger(manifest.unparsed) ? { unparsed: manifest.unparsed } : {})
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

// story snapshot --restore <name>: puts the project's markdown back as the
// snapshot holds it. Every markdown file in the snapshot is written back
// (one that is already the same is left alone), and every markdown file a
// scan reads that the snapshot lacks is deleted, with each folder that
// leaves empty. Those are the files a snapshot copies, so dist/,
// .snapshots/ and other dot-folders, nested projects, and files that are
// not markdown are never touched. Before any change the project as it is is
// saved as snapshot before-restore-<id>-<n>, so the restore can itself be
// undone, and a restore that fails part way names it. The registries are
// rebuilt afterwards when every restored file parses. What changes is
// planRestore's plan: `plan` passes one already read (a --dry-run reads it
// from the project and runs it on its copy), and `identity` stands in for
// fileIdentity in tests.
export function restoreSnapshot(root, options = {}) {
  const projectRoot = path.resolve(root);
  requireStoryFile(projectRoot);
  const { directory, id } = existingSnapshot(projectRoot, options.name);
  const manifest = listSnapshots(projectRoot).snapshots.find((snapshot) => snapshot.id === id);
  const plan = options.plan ?? planRestore(projectRoot, options.name, options);
  // A safety snapshot keeps a chapter that did not parse, so a snapshot
  // with one is still restored, and its undo works; only the reindex,
  // which needs every file to parse, is left for after the fix.
  let parses = true;
  try {
    assertProjectParses(scanProject(directory), "rebuild the registries");
  } catch {
    parses = false;
  }

  const restored = { name: manifest?.name ?? id, id };
  if (plan.writes.length === 0 && plan.deletes.length === 0) {
    return { restored, safety: null, created: [], updated: [], deleted: [], removedFolders: [], reindexed: false, warnings: [] };
  }

  const safetyId = nextSafetyId(projectRoot, id);
  const safety = snapshotProject(projectRoot, { name: safetyId, id: safetyId, now: options.now, unparsed: true });
  const at = (relative) => path.join(projectRoot, ...relative.split("/"));
  const done = { created: [], updated: [], deleted: [], removedFolders: [] };
  const warnings = [];
  try {
    for (const write of plan.writes) {
      writeFile(at(write.path), write.text, { root: projectRoot, unchangedFrom: write.original });
      done[write.created ? "created" : "updated"].push(write.path);
    }
    for (const file of plan.deletes) {
      removeFile(at(file.path), { root: projectRoot, unchangedFrom: file.original });
      done.deleted.push(file.path);
    }
    done.removedFolders = removeEmptiedFolders(projectRoot, plan.folders, warnings);
    if (parses) {
      reindexProject(projectRoot);
    }
  } catch (error) {
    const changed = done.created.length + done.updated.length + done.deleted.length;
    const state = changed === 0 ? "no file was restored" : `the project is part restored (${changed} of ${plan.writes.length + plan.deletes.length} files changed)`;
    const code = exitCodeFor(error);
    throw Object.assign(new Error(`Restoring snapshot ${id} stopped: ${error.message}\n${state[0].toUpperCase()}${state.slice(1)}. Snapshot ${safetyId} holds the project as it was before: story snapshot --restore ${safetyId} puts it back`), {
      exitCode: code === EXIT_CODES.findings ? EXIT_CODES.refused : code
    });
  }
  return { restored, safety: { id: safety.id, dir: safety.dir }, ...done, reindexed: parses, warnings };
}

// What restoring snapshot `name` changes, read from the project without
// changing anything: { writes: [{ path, text, created, original }],
// deletes: [{ path, original }], folders }, every path relative to the
// project and spelled as the project spells it, and `original` the text
// the change replaces (null for none), so one saved meanwhile is refused.
// Each snapshot file goes to the project file its path reaches, which a
// folder that ignores letter case (macOS and Windows by default, a
// casefold folder on Linux) finds under another spelling: the snapshot's
// Notes.md is then the project's notes.md, and its chapters/ the project's
// Chapters/. That file is written under the project's spelling and never
// deleted as one the snapshot lacks (#581). A refusal comes before
// anything changes.
export function planRestore(root, name, { identity = fileIdentity } = {}) {
  const projectRoot = path.resolve(root);
  const { id, saved } = restoreSources(projectRoot, name);
  const spell = projectSpelling(projectRoot, identity, id);
  const writes = [];
  const reached = new Map();
  for (const [relative, source] of saved) {
    const spelled = spell(relative);
    if (reached.has(spelled)) {
      throw refusedError(`Cannot restore snapshot ${id}: its ${reached.get(spelled)} and ${relative} are one file in this project (${spelled}), whose folder does not tell the two spellings apart. Nothing was changed`);
    }
    reached.set(spelled, relative);
    const target = path.join(projectRoot, ...spelled.split("/"));
    const text = readTextFile(source);
    const existing = lstatIfExists(target);
    // A file that cannot be read as text (swapped for a symlink or a FIFO
    // since the check, say) is written rather than followed or read whole.
    const current = existing?.isFile() ? currentText(target) : null;
    if (current === text) {
      continue;
    }
    // The text read here is the one replaced, so an edit saved meanwhile
    // stops the restore rather than being lost.
    writes.push({ path: spelled, text, created: existing === null, original: current });
  }
  const deletes = markdownFiles(projectRoot)
    .map((file) => projectPath(projectRoot, file))
    .filter((file) => !reached.has(file))
    .map((file) => ({ path: file, original: readTextFile(path.join(projectRoot, ...file.split("/"))) }));
  return { writes, deletes, folders: emptiedFolders(projectRoot, deletes.map((file) => file.path), writes, identity) };
}

// What a lookup of `file` finds, as its device and inode, or null for
// nothing. Two names with the same identity are one file: a folder that
// ignores letter case finds notes.md as Notes.md too.
function fileIdentity(file) {
  const stats = fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });
  return stats === undefined ? null : `${stats.dev}:${stats.ino}`;
}

// Spells a snapshot path as the project does. A part its folder lists as
// written is kept; otherwise, when a lookup of it finds something there,
// it becomes the listed name that is the same file. No rule for folding
// letters is assumed (Unicode case, normalization, a case-sensitive folder
// inside a case-insensitive volume): each folder answers for itself. A
// part with nothing there yet, and every part after it, is kept as written.
function projectSpelling(projectRoot, identity, id) {
  const listings = new Map();
  const identities = new Map();
  const listing = (folder) => {
    if (!listings.has(folder)) {
      listings.set(folder, lstatIfExists(folder)?.isDirectory() ? fs.readdirSync(folder).sort() : null);
    }
    return listings.get(folder);
  };
  const identityOf = (file) => {
    if (!identities.has(file)) {
      identities.set(file, identity(file));
    }
    return identities.get(file);
  };
  return (relative) => {
    const parts = relative.split("/");
    let folder = projectRoot;
    for (let index = 0; index < parts.length; index += 1) {
      const names = listing(folder);
      if (names === null) {
        break;
      }
      if (!names.includes(parts[index])) {
        const found = identityOf(path.join(folder, parts[index]));
        if (found === null) {
          break;
        }
        const same = names.filter((name) => identityOf(path.join(folder, name)) === found);
        if (same.length !== 1) {
          throw refusedError(`Cannot restore snapshot ${id}: the project finds ${relative} under another spelling, but cannot tell which of its files that is${same.length > 1 ? ` (${same.join(", ")})` : ""}. Nothing was changed`);
        }
        parts[index] = same[0];
      }
      folder = path.join(folder, parts[index]);
    }
    return parts.join("/");
  };
}

// The folders init makes, and the folders above them: a restore that
// empties one keeps it, as a new project has it.
const PROJECT_FOLDERS = [...new Set(PROJECT_DIRECTORIES.flatMap(foldersOf).concat(PROJECT_DIRECTORIES))];

// The folders above a project path: a/b/c.md is in a and a/b.
function foldersOf(relative) {
  const parts = relative.split("/").slice(0, -1);
  return parts.map((_, depth) => parts.slice(0, depth + 1).join("/"));
}

// The folders a restore's deletes leave empty, deepest first: each folder
// above a deleted file whose every entry is a deleted file or a folder
// emptied too, and that no write puts a file in. The listing is the
// project's own, so a hidden folder or a nested project, which a --dry-run
// copy leaves out, keeps its folder in the preview too. A folder init makes
// stays, under any spelling that reaches it.
function emptiedFolders(projectRoot, deletes, writes, identity) {
  const at = (relative) => path.join(projectRoot, ...relative.split("/"));
  const deleted = new Set(deletes);
  const receiving = new Set(writes.flatMap((write) => foldersOf(write.path)));
  const kept = new Set(PROJECT_FOLDERS.map((folder) => identity(at(folder))).filter((found) => found !== null));
  const emptied = new Set();
  const depth = (folder) => folder.split("/").length;
  const candidates = [...new Set(deletes.flatMap(foldersOf))].sort((a, b) => depth(b) - depth(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const folder of candidates) {
    if (receiving.has(folder) || kept.has(identity(at(folder)))) {
      continue;
    }
    if (fs.readdirSync(at(folder)).every((name) => deleted.has(`${folder}/${name}`) || emptied.has(`${folder}/${name}`))) {
      emptied.add(folder);
    }
  }
  return [...emptied];
}

// Removes the folders the plan found the deletes would empty, deepest first,
// and returns those it removed. Each is checked again first, as a write
// checks its folder, so one swapped for a symlink stays, as does one
// something was saved into meanwhile. One that cannot be removed (no
// permission, or in use on Windows) is a warning, not a failure: every
// file is already restored.
function removeEmptiedFolders(projectRoot, folders, warnings) {
  const removed = [];
  for (const folder of folders) {
    const full = path.join(projectRoot, ...folder.split("/"));
    try {
      assertSafeProjectDirectory(full, projectRoot);
      if (fs.readdirSync(full).length === 0) {
        removeDirectory(full, { action: "rmdir" });
        removed.push(folder);
      }
    } catch (error) {
      warnings.push(warn("folder-not-removed", `Could not remove ${folder}/, which the restore left empty (${error.code ?? error.message}): delete it yourself if you do not need it`, folder));
    }
  }
  return removed;
}

// The snapshot's id and the markdown files a restore writes back, by their
// path in the snapshot, after checking the project can take each one: the
// snapshot must hold story.md, and no folder on the way to a file may be a
// symlink or a project of its own now. planRestore runs it on the real
// project, so a --dry-run refuses these too, though its copy leaves nested
// projects out.
function restoreSources(projectRoot, name) {
  const { directory, id } = existingSnapshot(projectRoot, name);
  if (lstatIfExists(path.join(directory, "story.md"))?.isFile() !== true) {
    throw refusedError(`Cannot restore snapshot ${id}: ${SNAPSHOTS_DIR}/${id} has no story.md, so it is not a whole project. Nothing was changed`);
  }
  const saved = new Map(markdownFiles(directory).map((file) => [projectPath(directory, file), file]));
  const checked = new Set();
  for (const relative of saved.keys()) {
    for (const folder of foldersOf(relative)) {
      if (checked.has(folder)) {
        continue;
      }
      checked.add(folder);
      const full = path.join(projectRoot, ...folder.split("/"));
      const stats = lstatIfExists(full);
      if (stats?.isSymbolicLink()) {
        throw refusedError(`Cannot restore snapshot ${id}: ${folder}/ is a symlink, and ${relative} would be written through it. Nothing was changed`);
      }
      if (stats !== null && fs.existsSync(path.join(full, "story.md"))) {
        throw refusedError(`Cannot restore snapshot ${id}: ${relative} would be written into ${folder}/, which is now a story project of its own. Nothing was changed`);
      }
    }
  }
  return { id, saved };
}

// before-restore-<id>-<n>: one more than the highest n a safety snapshot of
// this id has, so each restore keeps its own and later ones number higher.
function nextSafetyId(projectRoot, id) {
  return nextSnapshotId(projectRoot, `before-restore-${id}-`);
}

export function formatRestore(result) {
  if (result.safety === null) {
    return `The project already matches snapshot ${result.restored.id}: nothing to restore\n`;
  }
  const lines = [
    `Saved the project as it was in snapshot ${result.safety.id} (${result.safety.dir}/)`,
    `Restored snapshot ${result.restored.id}: ${result.updated.length} updated, ${result.created.length} created, ${result.deleted.length} deleted (not in the snapshot)${result.removedFolders.length === 0 ? "" : `, ${plural(result.removedFolders.length, "folder")} removed (left empty)`}`,
    ...result.updated.map((file) => `  update  ${file}`),
    ...result.created.map((file) => `  create  ${file}`),
    ...result.deleted.map((file) => `  delete  ${file}`),
    ...result.removedFolders.map((folder) => `  rmdir   ${folder}`),
    ...(result.reindexed ? [] : ["Registries not rebuilt: some restored files do not parse. Fix them (story validate lists them), then run story reindex"]),
    `Undo it: story snapshot --restore ${result.safety.id}`
  ];
  return `${lines.join("\n")}\n`;
}

// What a --dry-run restore says above its list of changes.
export function formatRestorePreview(result) {
  if (result.safety === null) {
    return `The project already matches snapshot ${result.restored.id}: nothing to restore\n`;
  }
  const deleted = result.deleted.length === 0 ? "" : `; it would delete ${result.deleted.length === 1 ? "1 markdown file" : `${result.deleted.length} markdown files`} the snapshot does not have${result.removedFolders.length === 0 ? "" : `, and ${plural(result.removedFolders.length, "folder")} they leave empty`}`;
  return `Restoring snapshot ${result.restored.id} would first save the project as snapshot ${result.safety.id}${deleted}\n`;
}

export function formatSnapshot(result) {
  const counts = [`${result.chapters} ${result.chapters === 1 ? "chapter" : "chapters"}`, `${formatNumber(result.words)} words`];
  if (result.characters !== undefined) {
    counts.push(`${formatNumber(result.characters)} characters`);
  }
  return `${result.replaced ? "Replaced" : "Saved"} snapshot ${result.id} in ${result.dir}/ (${counts.join(", ")}; ${result.files} ${result.files === 1 ? "file" : "files"}${unparsedNote(result)})\nCompare with it later: story compare --snapshot ${result.id}\n`;
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
    return `- ${label}: ${when}, ${chapters}, ${words}${unparsedNote(snapshot)}`;
  });
  return `Snapshots: ${report.snapshots.length}\n\n${lines.join("\n")}\n`;
}

// The files a snapshot holds that did not parse, so its counts leave out.
function unparsedNote(snapshot) {
  const count = snapshot.unparsed ?? 0;
  return count === 0 ? "" : `, ${count === 1 ? "1 file that did not parse, not counted" : `${count} files that did not parse, not counted`}`;
}

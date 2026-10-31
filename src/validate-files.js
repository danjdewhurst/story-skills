// File checks for story validate: reading a file's frontmatter, files the
// project model ignores, and style-sheet samples.
import fs from "node:fs";
import path from "node:path";
import { FRONTMATTER_KEYS } from "./frontmatter-keys.js";
import { isPathInside, lstatIfExists, portablePath, TEMPORARY_FILE_PATTERN } from "./files.js";
import { PROGRESS_FILE } from "./progress.js";
import { canonicalPath } from "./series.js";
import { err, warn } from "./findings.js";
import {
  STYLE_SHEET_FILE,
  REGISTRY_HINT,
  SKIPPED_SCAN_DIRECTORIES,
  markdownFiles,
  MAX_SCAN_DEPTH,
  readMarkdown,
  fileErrorMessage,
  ENTITY_SCAN_DIRS
} from "./scan.js";
import { hasMessage, warnNearMissKeys } from "./validate-fields.js";

// Why a style-sheet samples entry cannot be used, as a warning, or null.
// validate and prose share it, so both say the same thing.
// Callers refuse an absolute path first, each in its own words.
export function sampleProblem(project, sample) {
  const target = path.resolve(project.root, sample);
  if (lstatIfExists(target) === null) {
    return warn("style-sample-missing", `${STYLE_SHEET_FILE} samples entry ${sample} names no file or folder in reach of the project`, STYLE_SHEET_FILE);
  }
  const real = canonicalPath(target);
  const self = canonicalPath(project.root);
  const chapters = path.join(self, "chapters");
  // A chapter file the author approved, named on its own, is a sample, and
  // prose leaves it out of the comparison. The project or a folder of its
  // chapters is not: every chapter would be compared with itself. A path
  // that cannot be stat'd (a symlink loop, say) is left to prose's read,
  // which reports it as style-sample-unreadable.
  const folder = (file) => {
    try {
      return fs.statSync(file).isDirectory();
    } catch {
      return false;
    }
  };
  if (real === self || real === chapters || (isPathInside(chapters, real) && folder(real))) {
    return warn("style-sample-own-chapters", `${STYLE_SHEET_FILE} samples entry ${sample} names this project's chapters as a whole, which are what the samples are compared with: list the approved chapter files one by one, or an earlier book`, STYLE_SHEET_FILE);
  }
  return null;
}

// A samples entry that names the same file or folder as an earlier one
// (`./chapters/chapter-01.md` after `chapters/chapter-01.md`), as a warning,
// or null. `seen` maps the real path of each entry so far to the entry as
// written. A path that cannot be resolved (a dangling symlink or a symlink
// loop) is never a duplicate: prose reports each spelling of it unreadable.
// validate and prose share it, so both say the same thing.
export function sampleDuplicate(project, sample, seen) {
  const real = resolvedSample(path.resolve(project.root, sample));
  if (real === null) {
    return null;
  }
  const first = seen.get(real);
  if (first === undefined) {
    seen.set(real, sample);
    return null;
  }
  const repeat = sample === first ? "is already listed" : `names the same file or folder as ${first}`;
  return warn("style-sample-duplicate", `${STYLE_SHEET_FILE} samples entry ${sample} ${repeat}, so story prose leaves it out: remove one of them`, STYLE_SHEET_FILE);
}

// A sample file or folder as one path however it is spelled, for telling
// whether two names are one file: `./` and repeated slashes resolve away,
// symlinks are followed, and the native real path takes the case the disk
// stores, so on a case-insensitive disk `Chapters/Chapter-01.md` is
// `chapters/chapter-01.md`. A path that cannot be resolved falls back to
// canonicalPath.
export function samplePath(file) {
  return resolvedSample(file) ?? canonicalPath(file);
}

// The native real path of `file`, or null when it cannot be resolved.
function resolvedSample(file) {
  try {
    return fs.realpathSync.native(file);
  } catch {
    return null;
  }
}

export function readRegistryValidationData(file, root, label, errors) {
  const count = errors.length;
  const data = readValidationData(file, root, label, errors);
  if (data === null && errors.length > count) {
    const last = errors[errors.length - 1];
    errors[errors.length - 1] = { ...last, message: `${last.message}${REGISTRY_HINT}` };
  }
  return data;
}

export function readValidationData(file, root, label, errors) {
  try {
    return readMarkdown(file, root).data;
  } catch (error) {
    const message = fileErrorMessage(label, error);
    if (!hasMessage(errors, message)) {
      errors.push(err("unreadable-file", message, label));
    }
    return null;
  }
}

// An entity file's frontmatter, with a warning for each key that looks like a
// misspelling of one its kind defines.
export function readEntityData(file, root, label, errors, warnings, kind) {
  const data = readValidationData(file, root, label, errors);
  if (data) {
    // An entity's id comes from its file name, so a frontmatter id is never read (#694).
    if (Object.hasOwn(data, "id")) {
      warnings.push(warn("frontmatter-id", `${label} has an id field, which is ignored: the file name sets the id, so remove the id line`, label));
    }
    warnNearMissKeys(data, FRONTMATTER_KEYS[kind], label, warnings);
  }
  return data;
}

export function entityFileNames(root, relativeDir) {
  const directory = path.join(root, relativeDir);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory).filter((name) => name.endsWith(".md") && !name.startsWith(".") && name !== "_index.md").sort().map((name) => path.posix.join(relativeDir, name));
}

export function collectStrayFileWarnings(project, warnings) {
  const root = project.root;
  // The root was already proven readable by the scan, so this cannot fail.
  const topEntries = fs.readdirSync(root, { withFileTypes: true });
  const strayTop = [];
  for (const entry of topEntries) {
    if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".") && entry.name !== "story.md" && entry.name !== STYLE_SHEET_FILE && entry.name !== PROGRESS_FILE) {
      strayTop.push(entry.name);
    }
  }
  strayTop.sort();
  for (const name of strayTop) {
    warnings.push(warn("stray-file", `${name} is not part of the story project model and is ignored`, name));
  }

  const nested = [];
  for (const relativeDir of ENTITY_SCAN_DIRS) {
    const directory = path.join(root, relativeDir);
    if (!fs.existsSync(directory)) {
      continue;
    }
    for (const file of markdownFiles(directory)) {
      const relativePath = path.relative(directory, file);
      if (relativePath.includes(path.sep) || path.dirname(relativePath) !== ".") {
        nested.push(portablePath(path.join(relativeDir, relativePath)));
      }
    }
  }
  nested.sort();
  for (const nestedPath of nested) {
    warnings.push(warn("nested-file", `${nestedPath} is nested inside an entity directory and is ignored`, nestedPath));
  }

  // The scan never reads through a symlink, so a linked chapter would drop
  // out of registries, counts, and builds without a word.
  for (const relativeDir of ENTITY_SCAN_DIRS) {
    const directory = path.join(root, relativeDir);
    if (!lstatIfExists(directory)?.isDirectory()) {
      continue;
    }
    const linked = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isSymbolicLink() && entry.name.endsWith(".md") && !entry.name.startsWith(".") && entry.name !== "_index.md")
      .map((entry) => path.posix.join(relativeDir, entry.name))
      .sort();
    for (const linkPath of linked) {
      warnings.push(warn("symlinked-file", `${linkPath} is a symlink and is ignored: replace it with the file itself`, linkPath));
    }
  }

  const leftovers = temporaryFiles(root)
    .map(([file, kind]) => [portablePath(file), kind])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [leftover, kind] of leftovers) {
    if (kind) {
      // Under the same code as a leftover: writeFile only makes new files at
      // fresh random names, so an entry put here cannot redirect a write and
      // needs the same clearing up. `level: off` still lists it as dismissed.
      warnings.push(warn("interrupted-write", `${leftover} has the name of a story temporary file but is ${kind}`, leftover));
      continue;
    }
    const name = TEMPORARY_FILE_PATTERN.exec(path.posix.basename(leftover))?.[1];
    const target = name ? ` to ${path.posix.join(path.posix.dirname(leftover), name)}` : "";
    warnings.push(warn("interrupted-write", `${leftover} was left by an interrupted write${target}; delete it once the files beside it look right`, leftover));
  }
}

// Every entry at a temporary file's name, as [path, kind]: kind is null for
// a regular file, which writeFile leaves when a process is killed before its
// rename, and otherwise says what else is there (a symlink or folder put at
// the name, say) and how to clear it. `.story-<pid>.tmp` is the older name
// without the target.
function temporaryFiles(root, depth = 0, relativeDir = "") {
  const found = [];
  for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (TEMPORARY_FILE_PATTERN.test(entry.name) || /^\.story-\d+\.tmp$/.test(entry.name)) {
      found.push([relativePath, entryKind(entry)]);
    } else if (entry.isDirectory() && !SKIPPED_SCAN_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
      if (depth < MAX_SCAN_DEPTH) {
        found.push(...temporaryFiles(root, depth + 1, relativePath));
      }
    }
  }
  return found;
}

// What a temporary file's name holds when it is not a regular file, and
// how to clear it. The type comes from the entry itself, so a symlink is
// never followed.
function entryKind(entry) {
  if (entry.isFile()) {
    return null;
  }
  if (entry.isSymbolicLink()) {
    // Deleting through it (`rm -r name/`) would empty the folder it names.
    return "a symlink, which story never makes; delete the link itself, not what it points to";
  }
  return entry.isDirectory()
    ? "a folder, which story never makes; it may hold files, so check them before you delete it"
    : "not a regular file, which story never makes; delete it";
}

export function validateOptionalRegistry(project, directory, expectedType, errors) {
  const indexPath = path.join(project.root, directory, "_index.md");
  if (fs.existsSync(indexPath)) {
    const label = path.posix.join(directory, "_index.md");
    const data = readRegistryValidationData(indexPath, project.root, label, errors);
    if (data && data.type !== expectedType) {
      errors.push(err("wrong-type", `${label} type must be ${expectedType}`, label));
    }
  }
}

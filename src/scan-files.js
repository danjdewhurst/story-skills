// Reading project files: story.md lookup, the scan's size, count, and depth
// limits, markdown file discovery, safe reads, and the project-relative
// labels on read errors.
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import {
  assertSafeProjectPath,
  FILE_ERROR_REASONS,
  portablePath,
  projectPath,
  readTextFile
} from "./files.js";
import { projectError } from "./exit-codes.js";

// Folders that never hold project prose: build output, installed packages
// (a local story-skills install ships its own examples), and dot-folders.
export const SKIPPED_SCAN_DIRECTORIES = new Set(["dist", "node_modules"]);

// Markdown files a rename or remove may rewrite. Folders deeper than the
// scan limit are skipped rather than fatal, so an unrelated deep notes tree
// cannot block the command.
export function markdownFiles(root, { maxFiles = MAX_SCAN_FILES } = {}, depth = 0, collected = null) {
  const files = collected ?? [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory() && !SKIPPED_SCAN_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
      // A subfolder with its own story.md is another project: never rewrite it.
      if (depth < MAX_SCAN_DEPTH && !fs.existsSync(path.join(fullPath, "story.md"))) {
        markdownFiles(fullPath, { maxFiles }, depth + 1, files);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
      files.push(fullPath);
      if (files.length > maxFiles) {
        throw projectError(`Too many markdown files in the project: the scan exceeds the ${MAX_SCAN_FILES} file limit`);
      }
    }
  }
  if (depth === 0) {
    files.sort();
  }
  return files;
}

export const MAX_SCAN_FILE_BYTES = 5 * 1024 * 1024;

export const MAX_SCAN_FILES = 5000;

export const MAX_SCAN_DEPTH = 10;

// Commands never search parent folders for story.md (see
// docs/project-format.md), but a run from inside a project, such as its
// chapters/ folder, gets a hint naming the nearest project root above it.
function parentProjectHint(projectRoot) {
  let current = path.dirname(projectRoot);
  while (!fs.existsSync(path.join(current, "story.md"))) {
    if (path.dirname(current) === current) {
      return "";
    }
    current = path.dirname(current);
  }
  const relative = path.relative(process.cwd(), current) || ".";
  const shown = relative.length < current.length ? relative : current;
  return ` (the project root looks like ${shown}; pass that path instead)`;
}

export function requireStoryFile(projectRoot) {
  const storyPath = path.join(projectRoot, "story.md");
  if (!fs.existsSync(storyPath)) {
    // Tab completion often lands on story.md itself; name the folder instead.
    if (fs.statSync(projectRoot, { throwIfNoEntry: false })?.isFile()) {
      throw projectError(`${projectRoot} is a file; pass the folder that contains it`);
    }
    const hint = path.basename(projectRoot).startsWith("-") ? `; ${path.basename(projectRoot)} is not an option (run story help)` : parentProjectHint(projectRoot);
    throw projectError(`${projectRoot} is not a story project: missing story.md${hint}`);
  }
  return storyPath;
}

export function readMarkdown(filePath, root) {
  let rawMarkdown;
  try {
    if (root) {
      assertSafeProjectPath(filePath, root);
    }
    rawMarkdown = readTextFile(filePath);
  } catch (error) {
    throw root ? relativePathError(error, filePath, root) : error;
  }
  try {
    return { ...parseFrontmatter(rawMarkdown, filePath), rawMarkdown };
  } catch (error) {
    // Callers label the file with its project-relative path, so drop the
    // absolute one the parser puts in front.
    throw projectError(error.message.startsWith(`${filePath} `) ? error.message.slice(filePath.length + 1) : error.message);
  }
}

// A refusal to read a project file (a symlink, a directory) names the file by
// its path inside the project, so CI logs do not show home directories. A
// file-system error (permission denied) is put in plain words after the path
// rather than Node's "EACCES: ..., open '<path>'".
export function relativePathError(error, filePath, root) {
  const relativePath = projectPath(root, filePath);
  const reason = typeof error.code === "string" && error.path === filePath ? FILE_ERROR_REASONS[error.code] : undefined;
  if (reason) {
    return projectError(`${relativePath}: Cannot read: ${reason}`);
  }
  return projectError(error.message.split(filePath).join(relativePath).split(path.resolve(root, filePath)).join(relativePath));
}

// Labels a scan error with the file's project-relative path, once: a message
// that already starts with that path (a read refusal, a non-UTF-8 file) drops
// it rather than print it twice.
export function fileErrorMessage(rawLabel, error) {
  const label = portablePath(rawLabel);
  for (const prefix of [`${label}: `, `${label} `]) {
    if (error.message.startsWith(prefix)) {
      return `${label}: ${error.message.slice(prefix.length)}`;
    }
  }
  return `${label}: ${error.message}`;
}

export function safeRead(filePath, root) {
  if (!fs.existsSync(filePath)) {
    return "";
  }

  if (root) {
    assertSafeProjectPath(filePath, root);
  }
  return readTextFile(filePath);
}

export function relative(project, file) {
  return projectPath(project.root, file);
}

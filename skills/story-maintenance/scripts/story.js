#!/usr/bin/env node

// src/cli.js
import path14 from "node:path";

// src/commands.js
import fs9 from "node:fs";
import path13 from "node:path";

// src/clues.js
import path from "node:path";

// src/findings.js
function err(code, message, file = null, chapter = null) {
  return { code, message, file, chapter };
}
function warn(code, message, file = null, chapter = null) {
  return { code, message, file, chapter };
}
var FINDING_CODES = {
  "unreadable-file": "error",
  "missing-required-path": "error",
  "windows-reserved-name": "warning",
  "stray-file": "warning",
  "nested-file": "warning",
  "symlinked-file": "warning",
  "interrupted-write": "warning",
  "stale-registry": "warning",
  "stale-word-count": "warning",
  "todo-markers": "warning",
  "unclosed-comment": "warning",
  "no-scene-records": "warning",
  "empty-chapter": "warning",
  "missing-field": "error",
  "field-not-scalar": "error",
  "field-not-list": "error",
  "field-invalid-items": "error",
  "field-not-integer": "error",
  "field-not-number": "error",
  "field-not-boolean": "error",
  "field-not-text": "error",
  "field-below-minimum": "error",
  "unsupported-value": "error",
  "id-not-kebab": "error",
  "near-miss-key": "warning",
  "wrong-type": "error",
  "story-id-mismatch": "error",
  "entry-not-mapping": "error",
  "schema-too-new": "error",
  "schema-version-mismatch": "error",
  "invalid-book-number": "error",
  "invalid-ifid": "error",
  "invalid-cover": "error",
  "invalid-date": "error",
  "invalid-cli-config": "error",
  "invalid-filename": "error",
  "filename-number-mismatch": "error",
  "duplicate-chapter-number": "error",
  "duplicate-scene-number": "error",
  "unnumbered-without-title": "error",
  "invalid-choice": "error",
  "invalid-route-hours": "error",
  "duplicate-route": "warning",
  "deceased-without-died-in": "warning",
  "progression-fixed-field": "error",
  "progression-list-field": "error",
  "progression-duplicate": "error",
  "progression-out-of-order": "error",
  "duplicate-pass": "error",
  "exemption-pattern-too-short": "error",
  "exemption-unknown-code": "error",
  "exemption-code-not-dismissible": "error",
  "exemption-file-not-relative": "error",
  "exemption-too-broad": "error",
  "exemption-misspelled-key": "error",
  "exemption-chapter-not-carried": "error",
  "style-use-equals-avoid": "error",
  "style-sample-missing": "warning",
  "style-sample-own-chapters": "warning",
  "duplicate-session-date": "error",
  "research-no-sources": "warning",
  "research-unsettled": "warning",
  "research-unreviewed": "warning",
  "empty-matter": "warning",
  "permission-pending": "warning",
  "permission-no-rights-holder": "warning",
  "backslash-path": "warning",
  "form-length-range": "warning",
  "invalid-language": "error",
  "invalid-isbn": "error",
  "invalid-subject": "error",
  "too-many-keywords": "warning",
  "todo-placeholder": "warning",
  "author-and-authors": "warning",
  "missing-reference": "error",
  "missing-backlink": "error",
  "backlink-type-mismatch": "error",
  "legacy-backlink-type": "warning",
  "route-to-self": "error",
  "broken-link": "error",
  "link-backslash": "error",
  "link-not-kebab": "error",
  "link-outside-project": "error",
  "unreachable-chapter": "warning",
  "series-link-backslash": "error",
  "series-link-self": "error",
  "series-link-unreadable": "error",
  "series-link-not-project": "error",
  "series-link-not-sibling": "error",
  "series-missing-backlink": "error",
  "series-link-other-series": "error",
  "revived-without-death": "error",
  "died-in-missing-chapter": "error",
  "revived-in-missing-chapter": "error",
  "revival-before-death": "error",
  "death-status-mismatch": "error",
  "revival-status-mismatch": "error",
  "posthumous-appearance": "error",
  "deceased-in-cast": "warning",
  "progression-deceased-in-cast": "warning",
  "progression-death-conflict": "warning",
  "pov-not-in-cast": "warning",
  "pov-scene-mismatch": "warning",
  "scene-cast-not-in-chapter": "warning",
  "scene-location-not-in-chapter": "warning",
  "cut-character-in-cast": "warning",
  "cut-character-in-arc": "warning",
  "cut-character-relationship": "warning",
  "chapter-numbering-start": "warning",
  "chapter-numbering-gap": "warning",
  "promise-payoff-before-plant": "error",
  "promise-payoff-missing": "error",
  "promise-plant-missing": "error",
  "promise-stale-planned": "warning",
  "promise-payoff-passed": "warning",
  "promise-unpaid": "warning",
  "question-resolved-before-introduced": "error",
  "question-resolution-missing": "error",
  "question-open-but-resolved": "error",
  "clue-payoff-before-plant": "error",
  "clue-payoff-missing": "error",
  "clue-plant-missing": "error",
  "clue-stale-planned": "warning",
  "clue-payoff-passed": "warning",
  "clue-unpaid": "warning",
  "complete-with-open-promise": "error",
  "complete-with-open-question": "error",
  "complete-with-open-clue": "error",
  "current-chapter-ahead": "error",
  "current-chapter-behind": "warning",
  "state-missing-character": "error",
  "state-missing-location": "error",
  "state-missing-artifact": "error",
  "state-missing-owner": "error",
  "state-missing-chapter": "error",
  "state-missing-knows": "error",
  "state-fact-not-kebab": "error",
  "state-duplicate-fact": "error",
  "state-duplicate-character": "warning",
  "state-duplicate-artifact": "warning",
  "state-status-conflict": "warning",
  "posthumous-learning": "error",
  "deceased-learning": "warning",
  "progression-deceased-learning": "warning",
  "learner-not-in-cast": "warning",
  "knowledge-not-recorded": "warning",
  "state-tracks-dead-character": "warning",
  "state-location-drift": "warning",
  "object-not-recorded": "warning",
  "state-object-drift": "warning",
  "gone-artifact-used": "error",
  "gone-artifact-mentioned": "error",
  "malformed-date": "warning",
  "malformed-time": "warning",
  "negative-travel-hours": "warning",
  "travel-hours-undated": "warning",
  "clock-backward": "warning",
  "travel-too-fast": "error",
  "route-same-time": "error",
  "route-too-fast": "error",
  "series-link-outside": "error",
  "series-too-many-books": "error",
  "series-conflict": "error",
  "series-id-missing": "warning",
  "series-title-mismatch": "warning",
  "series-cycle": "error",
  "duplicate-book-number": "error",
  "canon-name-mismatch": "warning",
  "canon-pronunciation-mismatch": "warning",
  "canon-death-status": "error",
  "canon-posthumous-appearance": "error",
  "canon-posthumous-learning": "error",
  "canon-destroyed-status": "warning",
  "canon-destroyed-artifact-used": "error",
  "canon-fact-relearned": "error",
  "prose-filter-words": "warning",
  "prose-adverbs": "warning",
  "prose-bookisms": "warning",
  "prose-avoided-spelling": "warning",
  "prose-uniform-sentences": "warning",
  "prose-similar-names": "warning",
  "prose-baseline-sentences": "warning",
  "prose-baseline-paragraphs": "warning",
  "prose-baseline-dialogue": "warning",
  "prose-baseline-filter-words": "warning",
  "prose-baseline-adverbs": "warning",
  "prose-baseline-small": "warning",
  "style-sample-unreadable": "warning",
  "pacing-no-hook": "warning",
  "pacing-no-sequel": "warning",
  "pacing-easy-wins": "warning",
  "pacing-resolution-run": "warning",
  "pacing-long-chapter": "warning",
  "pacing-short-chapter": "warning",
  "clue-unplanted": "warning",
  "clue-late-plant": "warning",
  "clue-no-characters": "warning",
  "clue-herring-unresolved": "warning",
  "clue-none-delayed": "warning",
  "voice-avoid": "warning",
  "voice-words-unused": "warning",
  "voice-sound-alike": "warning",
  "name-clash": "error",
  "name-look-alike": "warning",
  "name-shared-initial": "warning",
  "context-file-skipped": "warning",
  "story-missing-at-ref": "warning",
  "similarity-shared-passage": "warning",
  "similarity-no-reference-text": "warning",
  "derived-ifid": "warning",
  "scene-outside-book": "warning",
  "scene-no-location": "warning",
  "scene-unknown-location": "warning",
  "chapter-no-scenes": "warning",
  "scene-no-setting": "warning",
  "unknown-reference": "warning",
  "adopted-references": "warning",
  "linked-book-id": "warning",
  "choices-dropped": "warning",
  "leftover-references": "warning",
  "stale-exemption": "warning",
  "kept-story-options": "warning",
  "unsplit-chapter-lines": "warning",
  "usage-error": "error",
  "unusable-project": "error",
  "write-refused": "error",
  "command-failed": "error"
};
function codesAt(level) {
  return Object.keys(FINDING_CODES).filter((code) => FINDING_CODES[code] === level);
}
var PROJECTLESS_CODES = ["kept-story-options", "unsplit-chapter-lines"];
function severityCodes() {
  return codesAt("warning").filter((code) => !PROJECTLESS_CODES.includes(code));
}
var CONTINUITY_ERROR_CODES = [
  "unreadable-file",
  "entry-not-mapping",
  "revived-without-death",
  "died-in-missing-chapter",
  "revived-in-missing-chapter",
  "revival-before-death",
  "death-status-mismatch",
  "revival-status-mismatch",
  "posthumous-appearance",
  "promise-payoff-before-plant",
  "promise-payoff-missing",
  "promise-plant-missing",
  "question-resolved-before-introduced",
  "question-resolution-missing",
  "question-open-but-resolved",
  "clue-payoff-before-plant",
  "clue-payoff-missing",
  "clue-plant-missing",
  "complete-with-open-promise",
  "complete-with-open-question",
  "complete-with-open-clue",
  "current-chapter-ahead",
  "state-missing-character",
  "state-missing-location",
  "state-missing-artifact",
  "state-missing-owner",
  "state-missing-chapter",
  "state-missing-knows",
  "state-fact-not-kebab",
  "state-duplicate-fact",
  "posthumous-learning",
  "gone-artifact-used",
  "gone-artifact-mentioned",
  "travel-too-fast",
  "route-same-time",
  "route-too-fast"
];
function exemptionCodes() {
  return [...severityCodes(), ...CONTINUITY_ERROR_CODES];
}
var CHAPTER_CODES = [
  "posthumous-appearance",
  "deceased-in-cast",
  "progression-deceased-in-cast",
  "progression-death-conflict",
  "pov-not-in-cast",
  "pov-scene-mismatch",
  "scene-cast-not-in-chapter",
  "scene-location-not-in-chapter",
  "cut-character-in-cast",
  "posthumous-learning",
  "deceased-learning",
  "progression-deceased-learning",
  "learner-not-in-cast",
  "knowledge-not-recorded",
  "state-tracks-dead-character",
  "state-location-drift",
  "object-not-recorded",
  "state-object-drift",
  "gone-artifact-used",
  "gone-artifact-mentioned",
  "malformed-date",
  "malformed-time",
  "negative-travel-hours",
  "travel-hours-undated",
  "clock-backward",
  "travel-too-fast",
  "route-same-time",
  "route-too-fast"
];

// src/clues.js
var LIVE_STATUSES = new Set(["planned", "planted", "paid-off"]);
function buildClueMatrix(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const position = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  const warnings = [];
  const rows = [];
  const clues = [...project.clues].sort((left, right) => {
    const leftPlant = position.get(left.planted) ?? Infinity;
    const rightPlant = position.get(right.planted) ?? Infinity;
    return leftPlant - rightPlant || left.id.localeCompare(right.id, "en");
  });
  for (const clue of clues) {
    const label = `clue ${clue.id}`;
    const file = path.relative(project.root, clue.file);
    const plantAt = position.get(clue.planted);
    const payoffAt = position.get(clue.payoff);
    rows.push({
      id: clue.id,
      title: clue.title,
      status: clue.status,
      redHerring: clue.redHerring,
      significanceDelayed: clue.significanceDelayed,
      cells: chapters.map((chapter, index) => cell(index === plantAt, index === payoffAt))
    });
    if (!LIVE_STATUSES.has(clue.status)) {
      continue;
    }
    if (clue.payoff !== "" && clue.planted === "") {
      warnings.push(warn("clue-unplanted", `${label} is revealed in ${clue.payoff} but never planted: readers cannot play fair`, file));
    }
    if (plantAt !== undefined && payoffAt !== undefined && payoffAt - plantAt >= 0 && payoffAt - plantAt < 2) {
      const where = payoffAt === plantAt ? "the same chapter as" : "the chapter before";
      warnings.push(warn("clue-late-plant", `${label} is planted in ${where} its reveal (${clue.planted} -> ${clue.payoff}): late plant gives readers no time to notice it`, file));
    }
    if (clue.characters.length === 0) {
      warnings.push(warn("clue-no-characters", `${label} lists no characters: record who could notice it`, file));
    }
    if (clue.redHerring && clue.payoff === "") {
      warnings.push(warn("clue-herring-unresolved", `${label} is a red herring with no payoff: record the chapter that debunks it`, file));
    }
  }
  const live = project.clues.filter((clue) => LIVE_STATUSES.has(clue.status));
  const genuine = live.filter((clue) => !clue.redHerring);
  if (genuine.length >= 3 && !genuine.some((clue) => clue.significanceDelayed)) {
    warnings.push(warn("clue-none-delayed", "no clue is significance-delayed: every clue announces its meaning when planted"));
  }
  return {
    chapters: chapters.map((chapter) => ({ id: chapter.id, number: chapter.number })),
    rows,
    totals: {
      clues: live.length,
      redHerrings: live.filter((clue) => clue.redHerring).length,
      planted: live.filter((clue) => clue.status !== "planned" && position.has(clue.planted)).length,
      revealed: live.filter((clue) => clue.status === "paid-off" && position.has(clue.payoff)).length
    },
    warnings
  };
}
function cell(planted, revealed) {
  if (planted && revealed) {
    return "x";
  }
  if (planted) {
    return "P";
  }
  if (revealed) {
    return "R";
  }
  return ".";
}
function formatClueMatrix(matrix) {
  const { totals } = matrix;
  const herrings = `${totals.redHerrings} red herring${totals.redHerrings === 1 ? "" : "s"}`;
  const lines = [`Clues: ${totals.clues} live (${herrings}), ${totals.planted} planted, ${totals.revealed} revealed`];
  if (matrix.rows.length === 0) {
    lines.push("", '- None: add clues with story add clue "Name" --planted chapter-02 --payoff chapter-09');
    return `${lines.join(`
`)}
`;
  }
  const width = Math.max(...matrix.rows.map((row) => row.id.length + (row.redHerring ? 2 : 0)), 4);
  const cellWidth = Math.max(2, ...matrix.chapters.map((chapter) => String(chapter.number).length)) + 1;
  const header = matrix.chapters.map((chapter) => String(chapter.number).padStart(cellWidth)).join("");
  lines.push("", `${"Clue".padEnd(width)} ${header}`);
  for (const row of matrix.rows) {
    const name = row.redHerring ? `${row.id} ~` : row.id;
    const flags = [row.status];
    if (row.significanceDelayed) {
      flags.push("delayed");
    }
    lines.push(`${name.padEnd(width)} ${row.cells.map((value) => value.padStart(cellWidth)).join("")}  ${flags.join(", ")}`);
  }
  lines.push("", "P planted, R revealed, x both, ~ red herring");
  return `${lines.join(`
`)}
`;
}

// src/context.js
import path5 from "node:path";

// src/continuity.js
import path4 from "node:path";

// src/exemptions.js
import path3 from "node:path";

// src/files.js
import fs from "node:fs";
import path2 from "node:path";
import { Buffer } from "node:buffer";

// src/exit-codes.js
var EXIT_CODES = Object.freeze({
  ok: 0,
  findings: 1,
  usage: 2,
  project: 3,
  refused: 4
});
function withCode(message, exitCode) {
  return Object.assign(new Error(message), { exitCode });
}
function usageError(message) {
  return withCode(message, EXIT_CODES.usage);
}
function projectError(message) {
  return withCode(message, EXIT_CODES.project);
}
function refusedError(message) {
  return withCode(message, EXIT_CODES.refused);
}
function withExitCode(error, exitCode) {
  if (error !== null && typeof error === "object") {
    error.exitCode = exitCode;
  }
  return error;
}
function withDefaultExitCode(error, exitCode) {
  if (error !== null && typeof error === "object" && !Number.isInteger(error.exitCode)) {
    error.exitCode = exitCode;
  }
  return error;
}
var WRITE_SYSCALLS = new Set(["write", "rename", "mkdir", "mkdtemp", "unlink", "rmdir", "copyfile", "rm", "access", "chmod", "fsync"]);
var WRITE_ERROR_CODES = new Set(["EROFS", "ENOSPC", "EDQUOT", "EFBIG"]);
function exitCodeFor(error) {
  if (Number.isInteger(error?.exitCode)) {
    return error.exitCode;
  }
  if (typeof error?.code === "string" && /^E[A-Z]+$/.test(error.code)) {
    return WRITE_SYSCALLS.has(error.syscall) || WRITE_ERROR_CODES.has(error.code) ? EXIT_CODES.refused : EXIT_CODES.project;
  }
  return EXIT_CODES.findings;
}

// src/files.js
var MAX_READ_BYTES = 5 * 1024 * 1024;
function readTextFile(filePath) {
  const stats = fs.lstatSync(filePath);
  if (stats.isSymbolicLink()) {
    throw projectError(`Refusing to read through symlink: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw projectError(`Refusing to read ${filePath}: not a regular file`);
  }
  if (stats.size > MAX_READ_BYTES) {
    throw projectError(`Refusing to read oversized file ${filePath}: ${stats.size} bytes exceeds the ${MAX_READ_BYTES} byte limit`);
  }
  return decodeUtf8(fs.readFileSync(filePath), filePath);
}
var UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function decodeUtf8(buffer, filePath) {
  try {
    return UTF8.decode(buffer);
  } catch {
    const offset = invalidUtf8Offset(buffer);
    const byte = buffer[offset].toString(16).padStart(2, "0");
    throw projectError(`${filePath} is not valid UTF-8 (byte 0x${byte} at offset ${offset}): re-save it as UTF-8`);
  }
}
function invalidUtf8Offset(buffer) {
  let offset = 0;
  for (const character of buffer.toString("utf8")) {
    if (character === "�" && !(buffer[offset] === 239 && buffer[offset + 1] === 191 && buffer[offset + 2] === 189)) {
      break;
    }
    offset += Buffer.byteLength(character, "utf8");
  }
  return Math.max(0, Math.min(offset, buffer.length - 1));
}
function writeFile(filePath, contents, options = {}) {
  try {
    writeWholeFile(filePath, contents, options);
  } catch (error) {
    throw withExitCode(error, EXIT_CODES.refused);
  }
}
function writeWholeFile(filePath, contents, options) {
  const target = prepareWriteTarget(filePath, options.root);
  const existing = lstatIfExists(target);
  if (existing) {
    fs.accessSync(target, fs.constants.W_OK);
  }
  const mode = existing ? existing.mode & 511 : 438;
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
      throw Object.assign(new Error(`${options.root ? path2.relative(path2.resolve(options.root), target) : target} changed on disk while story was updating it, so it was left as it is. Run the command again`), { changedOnDisk: true });
    }
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (error.changedOnDisk) {
      throw error;
    }
    const action = existing?.nlink > 1 ? "replace hard-linked" : "write to";
    throw Object.assign(new Error(`Cannot ${action} ${target}: ${error.code ?? error.message}`), { code: error.code, path: target, syscall: "write" });
  }
}
function currentText(target) {
  try {
    return fs.readFileSync(target, "utf8");
  } catch {
    return null;
  }
}
var TEMPORARY_FILE_PATTERN = /^\.(.+)\.story-\d+\.tmp$/;
function temporaryPath(target) {
  const name = path2.basename(target).slice(0, 200);
  return path2.join(path2.dirname(target), `.${name}.story-${process.pid}.tmp`);
}
function prepareWriteTarget(filePath, root) {
  const target = path2.resolve(filePath);
  if (root) {
    assertLexicallyInsideRoot(target, root);
    assertExistingAncestorInsideRoot(path2.dirname(target), root);
  }
  makeDirectories(path2.dirname(target));
  if (root) {
    assertSafeProjectParent(target, root);
  }
  rejectSymlinkTarget(target, "write");
  return target;
}
function assertSafeProjectPath(filePath, root) {
  const target = path2.resolve(filePath);
  assertLexicallyInsideRoot(target, root);
  assertSafeProjectParent(target, root);
  rejectSymlinkTarget(target, "read");
}
function assertSafeProjectDirectory(directory, root) {
  const target = path2.resolve(directory);
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
  const rootReal = fs.realpathSync(path2.resolve(root));
  const directoryReal = fs.realpathSync(target);
  if (!isPathInside(rootReal, directoryReal)) {
    throw projectError(`Refusing to use project directory outside root: ${target}`);
  }
}
function assertSafeProjectParent(filePath, root) {
  const rootReal = fs.realpathSync(path2.resolve(root));
  const parentReal = fs.realpathSync(path2.dirname(path2.resolve(filePath)));
  if (!isPathInside(rootReal, parentReal)) {
    throw projectError(`Refusing to access project path outside root: ${filePath}`);
  }
}
function assertExistingAncestorInsideRoot(target, root) {
  const { ancestor: current } = nearestExistingAncestor(target);
  let rootReal;
  let currentReal;
  try {
    rootReal = fs.realpathSync(path2.resolve(root));
    currentReal = fs.realpathSync(current);
  } catch {
    throw projectError(`Refusing to access project path outside root: ${target}`);
  }
  if (!isPathInside(rootReal, currentReal)) {
    throw projectError(`Refusing to access project path outside root: ${target}`);
  }
}
function nearestExistingAncestor(target, exists = lstatIfExists) {
  const missing = [];
  let current = path2.resolve(target);
  while (!exists(current)) {
    const parent = path2.dirname(current);
    if (parent === current) {
      break;
    }
    missing.unshift(path2.basename(current));
    current = parent;
  }
  return { ancestor: current, missing };
}
function makeDirectories(directory) {
  const { ancestor, missing } = nearestExistingAncestor(directory);
  if (missing.length === 0 && fs.statSync(ancestor, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw directoryError(ancestor, "ENOTDIR");
  }
  let current = ancestor;
  for (const name of missing) {
    current = path2.join(current, name);
    try {
      fs.mkdirSync(current);
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
function assertLexicallyInsideRoot(filePath, root) {
  const rootPath = path2.resolve(root);
  const target = path2.resolve(filePath);
  if (!isPathInside(rootPath, target)) {
    throw projectError(`Refusing to access path outside project root: ${target}`);
  }
}
function rejectSymlinkTarget(filePath, action) {
  if (lstatIfExists(filePath)?.isSymbolicLink()) {
    throw projectError(`Refusing to ${action} through symlink: ${filePath}`);
  }
}
function lstatIfExists(filePath) {
  return fs.lstatSync(filePath, { throwIfNoEntry: false }) ?? null;
}
function isPathInside(root, target) {
  const relativePath = path2.relative(root, target);
  return !path2.isAbsolute(relativePath) && (relativePath === "" || !relativePath.split(path2.sep).includes(".."));
}

// src/frontmatter.js
var FRONTMATTER_PATTERN = /^(?:\uFEFF)?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
var OPENING_PATTERN = /^(?:\uFEFF)?---[ \t]*\r?\n/;
function parseFrontmatter(markdown, filePath = "markdown") {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) {
    if (OPENING_PATTERN.test(markdown)) {
      throw projectError(`${filePath} has unclosed YAML frontmatter: add a line holding only --- after the last field`);
    }
    throw projectError(`${filePath} is missing YAML frontmatter`);
  }
  const raw = match[1] ?? "";
  return {
    data: parseYaml(raw),
    body: markdown.slice(match[0].length),
    raw
  };
}
function stringifyFrontmatter(data) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(...stringifyItem(key, item));
      }
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }
  lines.push("---", "", "");
  return lines.join(`
`);
}
function replaceFrontmatter(markdown, data, bodyOverride) {
  const match = FRONTMATTER_PARTS_PATTERN.exec(markdown);
  if (!match) {
    throw new Error("Cannot replace missing YAML frontmatter");
  }
  const [whole, opening, raw = "", separator, closingLine] = match;
  const eol = opening.endsWith(`\r
`) ? `\r
` : `
`;
  const closing = `${separator ?? eol}${closingLine}`;
  const crlfClose = closing.startsWith("\r");
  const { data: original, blocks } = parseYamlBlocks(raw !== "" && crlfClose ? `${raw}\r` : raw);
  const generatedEnd = eol === `\r
` ? "\r" : "";
  const lines = [];
  const written = new Set;
  for (const block of blocks) {
    if (block.key === undefined) {
      lines.push(block.line);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(data, block.key)) {
      continue;
    }
    written.add(block.key);
    const value = data[block.key];
    if (isDeepEqual(original[block.key], value)) {
      lines.push(...block.lines);
    } else {
      lines.push(...stringifyEntry(block.key, value, block.items, generatedEnd));
    }
  }
  for (const [key, value] of Object.entries(data)) {
    if (!written.has(key)) {
      lines.push(...stringifyEntry(key, value, [], generatedEnd));
    }
  }
  const rest = bodyOverride === undefined ? markdown.slice(whole.length) : String(bodyOverride);
  if (lines.length === 0) {
    return `${opening}${separator ?? ""}${closingLine}${rest}`;
  }
  let body = lines.join(`
`);
  if (crlfClose && body.endsWith("\r")) {
    body = body.slice(0, -1);
  }
  return `${opening}${body}${closing}${rest}`;
}
var FRONTMATTER_PARTS_PATTERN = /^((?:\uFEFF)?---[ \t]*\r?\n)(?:([\s\S]*?)(\r?\n))?(---[ \t]*(?:\r?\n|$))/;
function stringifyEntry(key, value, originalItems = [], lineEnd = "") {
  if (!Array.isArray(value)) {
    return [`${key}: ${formatScalar(value)}${lineEnd}`];
  }
  if (value.length === 0) {
    return [`${key}: []${lineEnd}`];
  }
  const lines = [`${key}:${lineEnd}`];
  const unused = new Map;
  for (const candidate of originalItems) {
    const itemKey = valueKey(candidate.value);
    if (!unused.has(itemKey)) {
      unused.set(itemKey, { items: [], next: 0 });
    }
    unused.get(itemKey).items.push(candidate);
  }
  const reused = new Set;
  const matches = value.map((item) => {
    const queue = unused.get(valueKey(item));
    const reuse = queue?.items[queue.next];
    if (reuse && isDeepEqual(reuse.value, item)) {
      queue.next += 1;
      reused.add(reuse);
      return reuse;
    }
    return null;
  });
  value.forEach((item, index) => {
    if (matches[index]) {
      lines.push(...matches[index].lines);
      return;
    }
    const original = isPlainObject(item) ? originalItems.find((candidate) => !reused.has(candidate) && isPlainObject(candidate.value) && sameKeys(candidate.value, item) && candidate.lines.length === Object.keys(item).length) : undefined;
    const fresh = stringifyItem(key, item).map((line) => `${line}${lineEnd}`);
    if (!original) {
      lines.push(...fresh);
      return;
    }
    reused.add(original);
    Object.keys(item).forEach((childKey, childIndex) => {
      lines.push(isDeepEqual(original.value[childKey], item[childKey]) ? original.lines[childIndex] : fresh[childIndex]);
    });
  });
  return lines;
}
function sameKeys(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((childKey, index) => childKey === rightKeys[index]);
}
function stringifyItem(key, item) {
  if (!isPlainObject(item)) {
    return [`  - ${formatScalar(item)}`];
  }
  const entries = Object.entries(item);
  if (entries.length === 0) {
    throw new Error("Cannot stringify empty mapping in " + key);
  }
  const [firstKey, firstValue] = entries[0];
  const lines = [`  - ${firstKey}: ${formatScalar(firstValue)}`];
  for (const [childKey, childValue] of entries.slice(1)) {
    lines.push(`    ${childKey}: ${formatScalar(childValue)}`);
  }
  return lines;
}
function valueKey(value) {
  return JSON.stringify(value) ?? String(value);
}
function isDeepEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((entry, index) => isDeepEqual(entry, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && isDeepEqual(left[key], right[key]));
  }
  return false;
}
function parseYaml(source) {
  return parseYamlBlocks(source).data;
}
function parseYamlBlocks(source) {
  const rawLines = source === "" ? [] : source.split(`
`);
  const lines = rawLines.map((line) => line.replace(/\r$/, ""));
  const data = Object.create(null);
  const blocks = [];
  for (let index = 0;index < lines.length; ) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      blocks.push({ line: rawLines[index] });
      index += 1;
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!pair) {
      throw projectError(`Unsupported frontmatter line: ${line}`);
    }
    const [, key, rest = ""] = pair;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      throw projectError(`Duplicate frontmatter key: ${key}`);
    }
    if (rest !== "") {
      data[key] = parseScalar(rest);
      blocks.push({ key, lines: [rawLines[index]], items: [] });
      index += 1;
      continue;
    }
    const parsed = parseArray(lines, index + 1);
    if (parsed.nextIndex === index + 1) {
      data[key] = "";
      blocks.push({ key, lines: [rawLines[index]], items: [] });
      index += 1;
      continue;
    }
    data[key] = parsed.items;
    blocks.push({
      key,
      lines: rawLines.slice(index, parsed.nextIndex),
      items: parsed.items.map((item, itemIndex) => ({
        value: toPlainObject(item),
        lines: rawLines.slice(parsed.starts[itemIndex], parsed.starts[itemIndex + 1] ?? parsed.nextIndex)
      }))
    });
    index = parsed.nextIndex;
  }
  return { data: toPlainObject(data), blocks };
}
function toPlainObject(value) {
  if (Array.isArray(value)) {
    return value.map(toPlainObject);
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "__proto__") {
        Object.defineProperty(out, key, {
          value: toPlainObject(entry),
          enumerable: true,
          configurable: true,
          writable: true
        });
      } else {
        out[key] = toPlainObject(entry);
      }
    }
    return out;
  }
  return value;
}
function parseArray(lines, startIndex) {
  const items = [];
  const starts = [];
  let index = startIndex;
  while (index < lines.length) {
    const itemMatch = /^  -(?:\s+(.*))?$/.exec(lines[index]);
    if (!itemMatch) {
      break;
    }
    starts.push(index);
    const itemText = itemMatch[1] ?? "";
    const objectMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(itemText);
    if (!objectMatch) {
      items.push(parseScalar(itemText));
      index += 1;
      continue;
    }
    const item = Object.create(null);
    item[objectMatch[1]] = parseScalar(objectMatch[2]);
    index += 1;
    while (index < lines.length) {
      const childMatch = /^    ([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[index]);
      if (!childMatch) {
        break;
      }
      if (Object.prototype.hasOwnProperty.call(item, childMatch[1])) {
        throw projectError(`Duplicate frontmatter key: ${childMatch[1]}`);
      }
      item[childMatch[1]] = parseScalar(childMatch[2]);
      index += 1;
    }
    items.push(item);
  }
  return { items, starts, nextIndex: index };
}
function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "[]") {
    return [];
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return Number.parseFloat(trimmed);
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
function formatScalar(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    throw new Error("Cannot stringify a nested non-empty list");
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (needsQuotes(text)) {
    return JSON.stringify(text);
  }
  return text;
}
function needsQuotes(text) {
  return text === "" || /^\s|\s$/.test(text) || /[:#"'\u0000-\u001f\u007f]/.test(text) || /^[-?,[\]{}&*!|>%@`]/.test(text) || /^(true|false|null|yes|no|on|off|~)$/i.test(text) || /^[-+]?(\d[\d_]*(\.[\d_]*)?|\.\d[\d_]*)([eE][-+]?\d+)?$/.test(text) || /^[-+]?0[xob][0-9a-f_]+$/i.test(text) || /^[-+]?\.(inf|nan)$/i.test(text);
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
var FRONTMATTER_BLOCK_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
var YAML_LINE_PATTERN = /^(?:\s*$|\s*#|\s*-\s|\s*-$|\s+\S|(?:[A-Za-z0-9_][A-Za-z0-9_.-]*|"[^"\n]*"|'[^'\n]*')[ \t]*:(?:\s|$))/;
function withoutLeadingFrontmatter(text) {
  const match = FRONTMATTER_BLOCK_PATTERN.exec(text);
  if (!match) {
    return text;
  }
  const lines = match[1].split(/\r?\n/);
  if (lines[0].trim() === "" || !lines.every((line) => YAML_LINE_PATTERN.test(line))) {
    return text;
  }
  return text.slice(match[0].length);
}

// src/markdown.js
var LATIN_FOLDS = {
  "Æ": "AE",
  "æ": "ae",
  "Ø": "O",
  "ø": "o",
  "Ł": "L",
  "ł": "l",
  "ß": "ss",
  "ẞ": "SS",
  "Đ": "D",
  "đ": "d",
  "Ð": "D",
  "ð": "d",
  "Þ": "Th",
  "þ": "th",
  "Œ": "OE",
  "œ": "oe",
  "Ħ": "H",
  "ħ": "h",
  "Ŧ": "T",
  "ŧ": "t",
  "Ŋ": "Ng",
  "ŋ": "ng",
  "ı": "i",
  "ĸ": "k"
};
var LATIN_FOLD_PATTERN = new RegExp(`[${Object.keys(LATIN_FOLDS).join("")}]`, "g");
function foldLatin(value) {
  return String(value).replace(LATIN_FOLD_PATTERN, (letter) => LATIN_FOLDS[letter]).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}
var CYRILLIC = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  є: "ye",
  і: "i",
  ї: "yi",
  ґ: "g",
  ў: "u",
  ђ: "dj",
  ј: "j",
  љ: "lj",
  њ: "nj",
  ћ: "c",
  џ: "dz",
  ѓ: "gj",
  ќ: "kj",
  ѕ: "dz"
};
var GREEK_DIGRAPHS = { αυ: "av", ευ: "ev", ηυ: "iv", ου: "ou", γγ: "ng", γξ: "nx", γχ: "nch" };
var GREEK = {
  α: "a",
  β: "v",
  γ: "g",
  δ: "d",
  ε: "e",
  ζ: "z",
  η: "i",
  θ: "th",
  ι: "i",
  κ: "k",
  λ: "l",
  μ: "m",
  ν: "n",
  ξ: "x",
  ο: "o",
  π: "p",
  ρ: "r",
  σ: "s",
  ς: "s",
  τ: "t",
  υ: "y",
  φ: "f",
  χ: "ch",
  ψ: "ps",
  ω: "o",
  ϊ: "i",
  ϋ: "y"
};
var TRANSLITERATIONS = { ...GREEK_DIGRAPHS, ...CYRILLIC, ...GREEK };
var TRANSLITERATION_PATTERN = new RegExp(`${Object.keys(GREEK_DIGRAPHS).join("|")}|[${Object.keys(CYRILLIC).join("")}${Object.keys(GREEK).join("")}]`, "g");
function transliterate(value) {
  return String(value).toLowerCase().normalize("NFD").replace(/([Ͱ-Ͽ])([̀-ͯ]+)/g, (_, letter, marks) => letter + (marks.includes("̈") ? "̈" : "")).normalize("NFC").replace(TRANSLITERATION_PATTERN, (letters) => TRANSLITERATIONS[letters]);
}
function kebabCase(value, { transliterate: scripts = true } = {}) {
  return foldLatin(scripts ? transliterate(value) : value).replace(/['\u2018\u2019]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function titleCaseSlug(slug) {
  return String(slug).split("-").filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}
function chapterHeading(number, title, word = "Chapter") {
  const text = String(title ?? "").trim();
  const name = String(word ?? "").trim() || "Chapter";
  const label = name.includes("{n}") ? name.replace(/\{n\}/g, String(number)) : `${name} ${number}`;
  return text === "" || text.toLowerCase() === label.toLowerCase() ? label : `${label}: ${text}`;
}
var WORD_CHARS = "\\p{L}\\p{M}\\p{N}\\u200C\\u200D\\u00AD";
var URL_PLACEHOLDER = "";
var WORD_PATTERN = new RegExp(`${URL_PLACEHOLDER}|[\\p{L}\\p{N}][${WORD_CHARS}]*(?:(?:['’‐‑-]|(?<=\\p{N})[.,:](?=\\p{N}))[\\p{L}\\p{N}][${WORD_CHARS}]*)*`, "gu");
var CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30FC]/gu;
var URL_OR_EMAIL = /(?<![a-z0-9+.-])(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>()[\]`]*[^\s<>()[\]`.,;:!?'"\u2019\u201d*_~]|(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}][\p{L}\p{N}._%+-]*@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu;
function plainLinks(text) {
  return String(text).replace(/!\[[^\]]{0,1000}\]\([^)]{0,1000}\)/g, "").replace(/\[([^\]]{0,1000})\]\([^)]{0,1000}\)/g, "$1");
}
function flattenHeadings(text) {
  return String(text).replace(/^(#+)(?:[ \t]+([^\n]*))?$/gm, (line, hashes, content) => {
    const heading = String(content ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim();
    if (heading !== "") {
      return heading;
    }
    return hashes === "#" ? "#" : "";
  });
}
function splitWords(markdown) {
  const urls = [];
  const normalized = plainLinks(withoutFenceMarkers(String(markdown).replace(/\uE000/g, " "))).replace(URL_OR_EMAIL, (match) => {
    urls.push(match);
    return ` ${URL_PLACEHOLDER} `;
  }).replace(/\\([!-/:-@[-`{-~])/g, "$1").replace(/[#>*_~|`]/g, " ").replace(/(?<!\p{N}):|:(?!\p{N})/gu, " ").replace(CJK_CHARACTER, " $& ");
  let next = 0;
  return (normalized.match(WORD_PATTERN) ?? []).map((word) => word === URL_PLACEHOLDER ? urls[next++] : word);
}
function isSceneBreak(paragraph) {
  const text = String(paragraph).replace(/\\([*_~-])/g, "$1").trim();
  return text === "#" || /^([*_~-])( ?\1){2,}$/.test(text);
}
function wordCount(markdown) {
  return splitWords(markdown).length;
}
function chapterProse(markdownBody, commentReplacement = "") {
  return scanComments(proseSection(markdownBody), commentReplacement).text;
}
function hasUnclosedComment(prose) {
  return scanComments(String(prose)).unclosed;
}
function countTodoMarkers(prose) {
  return (String(prose).match(/\[TODO\b/gi) ?? []).length;
}
function scanComments(text, replacement = "") {
  const source = String(text);
  const { ranges, unclosed } = scanMarkup(source);
  let result = "";
  let position = 0;
  for (const range of ranges) {
    if (range.kind === "comment") {
      result += source.slice(position, range.start) + replacement;
      position = range.end;
    }
  }
  return { text: result + source.slice(position), unclosed };
}
function maskMarkup(text) {
  const source = String(text);
  let result = "";
  let position = 0;
  for (const range of scanMarkup(source).ranges) {
    result += source.slice(position, range.start) + source.slice(range.start, range.end).replace(/[^\r\n]/g, " ");
    position = range.end;
  }
  return result + source.slice(position);
}
function scanMarkup(text) {
  const ranges = [];
  let unclosed = false;
  let fenceLimit = Infinity;
  let nextOpen = -2;
  let position = 0;
  while (position < text.length) {
    const newline = text.indexOf(`
`, position);
    const lineEnd = newline === -1 ? text.length : newline;
    if (position === 0 || text[position - 1] === `
`) {
      const marker = /^ {0,3}(`{3,})/.exec(text.slice(position, lineEnd));
      if (marker && marker[1].length < fenceLimit) {
        const end = fenceEnd(text, lineEnd, marker[1].length);
        if (end === -1) {
          fenceLimit = marker[1].length;
        } else {
          ranges.push({ kind: "fence", start: position, end });
          position = end;
          continue;
        }
      }
    }
    if (nextOpen !== -1 && nextOpen < position) {
      nextOpen = text.indexOf("<!--", position);
    }
    const open = nextOpen !== -1 && nextOpen < lineEnd ? nextOpen : -1;
    const tick = text.indexOf("`", position);
    if (tick !== -1 && tick < lineEnd && (open === -1 || tick < open)) {
      position = codeSpanEnd(text, tick, lineEnd);
      continue;
    }
    if (open === -1) {
      position = lineEnd + 1;
      continue;
    }
    const close = text.indexOf("-->", open + 4);
    if (close === -1) {
      unclosed = true;
      nextOpen = -1;
      position = open + 4;
      continue;
    }
    ranges.push({ kind: "comment", start: open, end: close + 3 });
    position = close + 3;
  }
  return { ranges, unclosed };
}
function fenceEnd(text, openerEnd, length) {
  for (let lineStart = openerEnd + 1;lineStart < text.length; ) {
    const next = text.indexOf(`
`, lineStart);
    const lineEnd = next === -1 ? text.length : next;
    const line = text.slice(lineStart, lineEnd);
    const marker = /^ {0,3}(`{3,})/.exec(line);
    if (marker && marker[1].length >= length && line.trim() === marker[1]) {
      return Math.min(lineEnd + 1, text.length);
    }
    lineStart = lineEnd + 1;
  }
  return -1;
}
function codeSpanEnd(text, tick, lineEnd) {
  let runEnd = tick;
  while (text[runEnd] === "`") {
    runEnd += 1;
  }
  const length = runEnd - tick;
  let search = runEnd;
  while (search < lineEnd) {
    const start = text.indexOf("`", search);
    if (start === -1 || start >= lineEnd) {
      break;
    }
    let end = start;
    while (text[end] === "`") {
      end += 1;
    }
    if (end - start === length) {
      return end;
    }
    search = end;
  }
  return runEnd;
}
function fencedLineIndexes(lines) {
  const fenced = new Set;
  for (const [start, end] of closedFences(lines)) {
    for (let inside = start;inside <= end; inside += 1) {
      fenced.add(inside);
    }
  }
  return fenced;
}
function closedFences(lines) {
  const fences = [];
  let open = null;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,})/.exec(line);
    if (!marker) {
      continue;
    }
    if (open === null) {
      open = { index, fence: marker[1] };
    } else if (marker[1].length >= open.fence.length && line.trim() === marker[1]) {
      fences.push([open.index, index]);
      open = null;
    }
  }
  return fences;
}
function withoutFenceMarkers(text) {
  const lines = String(text).split(/(?<=\n)/);
  const markers = new Set(closedFences(lines.map((line) => line.replace(/\r?\n$/, ""))).flat());
  return lines.map((line, index) => markers.has(index) ? `
` : line).join("");
}
function withoutFencedCode(text) {
  return splitFences(text).map((part) => part.fenced ? " " : part.text).join("");
}
function splitFences(text) {
  const lines = text.split(/(?<=\n)/);
  const fenced = fencedLineIndexes(lines.map((line) => line.replace(/\r?\n$/, "")));
  const parts = [];
  for (const [index, line] of lines.entries()) {
    const isFenced = fenced.has(index);
    const last = parts[parts.length - 1];
    if (last && last.fenced === isFenced) {
      last.text += line;
    } else {
      parts.push({ fenced: isFenced, text: line });
    }
  }
  return parts;
}
function sectionHeadingPattern(heading) {
  return new RegExp(`^ {0,3}##[ \\t]+${escapeRegExp(heading)}(?:[ \\t]+#+)?[ \\t]*\\r?$`, "im");
}
var NEXT_SECTION = /^ {0,3}##(?:[ \t]|\r?$)/m;
function proseSection(markdownBody) {
  const masked = maskMarkup(markdownBody);
  const chapterTextMatch = sectionHeadingPattern("Chapter Text").exec(masked);
  if (chapterTextMatch) {
    return markdownBody.slice(chapterTextMatch.index + chapterTextMatch[0].length);
  }
  const outlineMatch = sectionHeadingPattern("Outline").exec(masked);
  if (!outlineMatch) {
    return markdownBody.slice(leadingHeadingLength(masked));
  }
  const start = outlineMatch.index + outlineMatch[0].length;
  return markdownBody.slice(outlineDivider(masked, start) ?? start);
}
function outlineDivider(masked, start) {
  const lines = masked.slice(start).split(`
`);
  let offset = start + lines[0].length + 1;
  let previous = "blank";
  for (const line of lines.slice(1)) {
    const lineStart = offset;
    offset += line.length + 1;
    const text = line.replace(/\r$/, "");
    if (text.trim() === "") {
      previous = "blank";
    } else if (text.trim() === "---") {
      return lineStart + line.length;
    } else if (/^\s*(?:[-*+]|\d+[.)])(?:[ \t]|$)/.test(text) || /^ {0,3}#{2,}(?:[ \t]|$)/.test(text) || /^[ \t]+\S/.test(text)) {
      previous = "outline";
    } else if (previous !== "outline") {
      return null;
    }
  }
  return null;
}
function extractSection(markdown, heading) {
  const masked = maskMarkup(markdown);
  const match = sectionHeadingPattern(heading).exec(masked);
  if (!match) {
    return "";
  }
  const start = match.index + match[0].length;
  const next = NEXT_SECTION.exec(masked.slice(start));
  const rest = markdown.slice(start);
  return (next ? rest.slice(0, next.index) : rest).trim();
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function leadingHeadingLength(masked) {
  const match = /^(?:[ \t]*\r?\n)*(?:[ \t]{0,3}#(?!#)[ \t]+[^\r\n]*|[ \t]{0,3}\S[^\r\n]*\r?\n[ \t]{0,3}=+[ \t]*)(?:\r?\n|$)/.exec(masked);
  return match ? match[0].length : 0;
}

// src/names.js
var MAJOR_ROLES = new Set(["protagonist", "antagonist", "deuteragonist", "narrator"]);
var TITLE_WORDS = new Set([
  "the",
  "a",
  "an",
  "lord",
  "lady",
  "sir",
  "dame",
  "dr",
  "doctor",
  "mr",
  "mrs",
  "ms",
  "miss",
  "master",
  "mistress",
  "captain",
  "capt",
  "king",
  "queen",
  "prince",
  "princess",
  "duke",
  "duchess",
  "count",
  "countess",
  "baron",
  "baroness",
  "father",
  "mother",
  "sister",
  "brother",
  "uncle",
  "aunt",
  "councillor",
  "councilor",
  "general",
  "colonel",
  "major",
  "sergeant",
  "lieutenant",
  "commander",
  "professor",
  "prof",
  "saint",
  "st",
  "old",
  "young",
  "little"
]);
function givenName(name) {
  const words = splitWords(String(name));
  const index = words.findIndex((word) => !TITLE_WORDS.has(word.toLowerCase().replace(/[.’']/g, "")));
  return index === -1 ? "" : words[index];
}
function existingNames(project) {
  const names = [];
  const add = (kind, id, name, role = "", given = false, full = name) => {
    if (typeof name === "string" && name.trim() !== "") {
      names.push({ kind, id, name: name.trim(), full: String(full).trim(), role, given });
    }
  };
  for (const character of project.characters) {
    if (character.status === "cut") {
      continue;
    }
    const first = givenName(character.name);
    const single = first !== "" && first === String(character.name).trim();
    add("character", character.id, String(character.name), character.role, single);
    if (first !== "" && !single) {
      add("character", character.id, first, character.role, true, character.name);
    }
    for (const alias of character.aliases ?? []) {
      add("character", character.id, alias, character.role);
    }
  }
  for (const [kind, list] of [["location", project.locations], ["faction", project.factions], ["artifact", project.artifacts], ["system", project.systems]]) {
    for (const entity of list) {
      add(kind, entity.id, String(entity.name));
    }
  }
  for (const term of project.glossaryTerms) {
    add("term", term.id, String(term.term));
    for (const alias of term.aliases ?? []) {
      add("term", term.id, alias);
    }
  }
  return names;
}
function checkNames(candidates, names) {
  const errors = [];
  const warnings = [];
  const results = [];
  for (const raw of candidates) {
    const candidate = String(raw).trim();
    if (candidate === "") {
      continue;
    }
    const key = normalize(candidate);
    const first = normalize(givenName(candidate));
    const clashes = [];
    const lookalikes = [];
    const initials = [];
    const seen = new Set;
    for (const entry of names) {
      const tag = `${entry.kind} ${entry.id}`;
      const existing = normalize(entry.name);
      if (existing === key || entry.given && existing === first) {
        if (!seen.has(`clash ${tag}`)) {
          clashes.push(entry);
          seen.add(`clash ${tag}`);
        }
        continue;
      }
      const alike = entry.given ? looksAlike(first, existing) : !existing.includes(" ") && !key.includes(" ") && looksAlike(key, existing);
      if (alike && !seen.has(`like ${tag}`)) {
        lookalikes.push(entry);
        seen.add(`like ${tag}`);
      } else if (entry.given && MAJOR_ROLES.has(entry.role) && first !== "" && first[0] === existing[0] && !seen.has(`initial ${entry.id}`)) {
        initials.push(entry);
        seen.add(`initial ${entry.id}`);
      }
    }
    for (const entry of clashes) {
      errors.push(err("name-clash", `"${candidate}" clashes with ${entry.kind} ${entry.id} (${entry.name})`));
    }
    for (const entry of lookalikes) {
      if (!clashes.some((clash) => clash.kind === entry.kind && clash.id === entry.id)) {
        warnings.push(warn("name-look-alike", `"${candidate}" looks like ${entry.kind} ${entry.id} (${entry.full})`));
      }
    }
    for (const entry of initials) {
      if (!clashes.concat(lookalikes).some((other) => other.kind === "character" && other.id === entry.id)) {
        warnings.push(warn("name-shared-initial", `"${candidate}" shares an initial with ${entry.role} ${entry.id} (${entry.full})`));
      }
    }
    results.push({ name: candidate, clashes: clashes.length, lookalikes: lookalikes.length, initials: initials.length });
  }
  return { results, errors, warnings };
}
function looksAlike(left, right) {
  if (left.length < 3 || right.length < 3) {
    return false;
  }
  if (left.slice(0, 4) === right.slice(0, 4) && Math.min(left.length, right.length) >= 4) {
    return true;
  }
  const limit = Math.min(left.length, right.length) >= 5 ? 2 : 1;
  return left[0] === right[0] && editDistance(left, right) <= limit;
}
function normalize(value) {
  return foldLatin(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function formatNames(report) {
  const lines = [];
  for (const result of report.results) {
    const status = result.clashes > 0 ? "taken" : result.lookalikes + result.initials > 0 ? "check" : "clear";
    lines.push(`${result.name}: ${status}`);
  }
  return `${lines.join(`
`)}
`;
}

// src/sentences.js
var TITLE_ABBREVIATIONS = /(?:^|[\s(“"‘'])(?:Dr|Mr|Mrs|Ms|St|Mt|Jr|Sr|Prof|Capt|Gen|Col|Lt|Sgt|Rev|Fr|e\.g|i\.e|(?:[A-Za-z]\.)*[A-Za-z])$/;
var CONTEXT_ABBREVIATIONS = /(?:^|[\s(“"‘'])(?:No|vs|etc|a\.m|p\.m)$/;
var CALENDAR_WORD = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)(?![\p{L}\p{N}])/u;
var SENTENCE_END = /[.!?…]+["”’')\]*_]*(?= |$)|[。！？]+[」』）”’"')\]*_]*/g;
var CONTEXT_WINDOW = 64;
var SENTENCE_START = /^["'“‘(\[*_]*[\p{Lu}\p{N}]/u;
function splitSentences(text, { capitalStart = true } = {}) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (normalized === "") {
    return [];
  }
  const sentences = [];
  let start = 0;
  for (const match of normalized.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    if (/^[。！？]/.test(match[0])) {
      sentences.push(normalized.slice(start, end).trim());
      start = end;
      continue;
    }
    const next = normalized.slice(end + 1, end + 1 + CONTEXT_WINDOW);
    if (capitalStart && next !== "" && !SENTENCE_START.test(next)) {
      continue;
    }
    const from = Math.max(start, match.index - CONTEXT_WINDOW);
    const before = `${from > start ? "x" : ""}${normalized.slice(from, match.index)}`;
    const abbreviation = match[0] === "." && (CONTEXT_ABBREVIATIONS.test(before) ? /^[\p{Ll}\p{N}]/u.test(next) || CALENDAR_WORD.test(next) : TITLE_ABBREVIATIONS.test(before));
    const stammer = /^(?:…|\.\.\.)/.test(match[0]) && isStammer(before, next);
    if (abbreviation || stammer) {
      continue;
    }
    sentences.push(normalized.slice(start, end).trim());
    start = end;
  }
  const tail = normalized.slice(start).trim();
  if (tail !== "") {
    sentences.push(/[.!?…。！？]["”’')\]」』）]*$/.test(tail) ? tail : `${tail}.`);
  }
  return sentences.filter((sentence) => sentence !== "");
}
function isStammer(before, next) {
  const last = /([\p{L}\p{N}'’]+)$/u.exec(before);
  const first = /^["'“‘(\[*_]*([\p{L}\p{N}'’]+)/u.exec(next);
  return Boolean(last && first) && last[1].toLowerCase() === first[1].toLowerCase();
}

// src/plural.js
function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
function roundedShares(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return values.map(() => 0);
  }
  const exact = values.map((value) => value * 100 / total);
  const shares = exact.map(Math.floor);
  let left = 100 - shares.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) {
      break;
    }
    shares[index] += 1;
    left -= 1;
  }
  return shares;
}

// src/voices.js
var SPEECH_VERBS = [
  "said",
  "says",
  "asked",
  "asks",
  "replied",
  "replies",
  "answered",
  "answers",
  "whispered",
  "whispers",
  "shouted",
  "shouts",
  "called",
  "calls",
  "muttered",
  "mutters",
  "murmured",
  "murmurs",
  "cried",
  "cries",
  "yelled",
  "yells",
  "added",
  "adds",
  "told",
  "tells",
  "snapped",
  "snaps",
  "admitted",
  "admits",
  "insisted",
  "insists",
  "demanded",
  "demands",
  "continued",
  "continues",
  "began",
  "begins",
  "went on",
  "goes on"
];
var CONTRACTION_PATTERN = /[\p{L}](?:n['’]t|['’](?:re|ll|ve|m|d))\b|(?<![\p{L}\p{N}])(?:it|that|let|what|there|here|where|who|he|she|how|when|why)['’]s(?![\p{L}\p{N}])/giu;
var STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "have",
  "what",
  "from",
  "they",
  "there",
  "their",
  "them",
  "then",
  "than",
  "were",
  "would",
  "could",
  "should",
  "your",
  "yours",
  "just",
  "know",
  "been",
  "will",
  "when",
  "where",
  "which",
  "about",
  "into",
  "some",
  "because",
  "want",
  "like",
  "only",
  "here",
  "does",
  "didn't",
  "don't",
  "it's",
  "can't",
  "won't",
  "i'm",
  "you're",
  "we're",
  "that's",
  "there's",
  "what's",
  "going",
  "come",
  "back",
  "over",
  "tell",
  "said",
  "more",
  "very",
  "also"
]);
var VOICE_THRESHOLDS = {
  minLines: 5,
  sentenceLength: 1.5,
  contractions: 1.5,
  questions: 0.1,
  exclamations: 0.1
};
function buildVoices(project, chapters) {
  const speakers = speakerPatterns(project.characters);
  const lines = new Map(project.characters.map((character) => [character.id, []]));
  let unattributed = 0;
  for (const chapter of chapters) {
    let pending = [];
    let chainSpeaker = null;
    const credit = (speaker, texts) => {
      if (speaker === null) {
        unattributed += texts.length;
      } else {
        lines.get(speaker).push(...texts.map((text) => ({ chapter: chapter.id, text })));
      }
    };
    for (const paragraph of chapter.paragraphs) {
      const continues = (pending.length > 0 || chainSpeaker !== null) && OPENS_WITH_QUOTE.test(paragraph);
      if (!continues) {
        credit(null, pending);
        pending = [];
        chainSpeaker = null;
      }
      const quotes = quotedSpans(paragraph);
      const open = splitOpenSpeech(paragraph).open;
      if (open !== null) {
        quotes.push(open);
      }
      if (quotes.length === 0) {
        continue;
      }
      const speaker = attribute(paragraph, speakers) ?? chainSpeaker;
      if (open !== null && speaker === null) {
        pending.push(...quotes);
        continue;
      }
      credit(speaker, [...pending, ...quotes]);
      pending = [];
      chainSpeaker = open === null ? null : speaker;
    }
    credit(null, pending);
  }
  const profiles = project.characters.map((character) => profile(character, lines.get(character.id))).filter((entry) => entry.lines > 0);
  signatureWords(profiles);
  const warnings = [];
  for (const character of project.characters) {
    const said = lines.get(character.id);
    for (const phrase of stringList(character.voiceAvoid)) {
      const pattern = phrasePattern(phrase);
      const chaptersUsing = [...new Set(said.filter((line) => pattern.test(line.text)).map((line) => line.chapter))];
      if (chaptersUsing.length > 0) {
        warnings.push(warn("voice-avoid", `${character.id} says "${phrase}", which is in their voice-avoid list (${chaptersUsing.join(", ")})`));
      }
    }
    if (said.length >= VOICE_THRESHOLDS.minLines) {
      for (const phrase of stringList(character.voiceWords)) {
        const pattern = phrasePattern(phrase);
        if (!said.some((line) => pattern.test(line.text))) {
          warnings.push(warn("voice-words-unused", `${character.id} does not say "${phrase}" from their voice-words list in ${said.length} attributed lines of dialogue`));
        }
      }
    }
  }
  const eligible = profiles.filter((entry) => entry.lines >= VOICE_THRESHOLDS.minLines);
  for (let left = 0;left < eligible.length; left += 1) {
    for (let right = left + 1;right < eligible.length; right += 1) {
      if (similarVoices(eligible[left], eligible[right])) {
        warnings.push(warn("voice-sound-alike", `${eligible[left].id} and ${eligible[right].id} may sound alike: similar sentence length, contractions, questions, and exclamations`));
      }
    }
  }
  return {
    profiles: profiles.sort((left, right) => right.words - left.words || left.id.localeCompare(right.id, "en")),
    unattributed,
    warnings
  };
}
var PRONOUNS = "he|she|they|i|we";
var VERB_ALTERNATION = SPEECH_VERBS.map((verb) => verb.replace(/ /g, "\\s+")).join("|");
var PRONOUN_TAG_SOURCE = `(?:(?:${PRONOUNS})\\s+(?:${VERB_ALTERNATION})|(?:${VERB_ALTERNATION})\\s+(?:${PRONOUNS}))(?![\\p{L}\\p{N}])`;
var TAG_AFTER_QUOTE = new RegExp(`^[\\s,.;:!?…()—–-]*${PRONOUN_TAG_SOURCE}`, "iu");
var TAG_BEFORE_QUOTE = new RegExp(`(?<![\\p{L}\\p{N}])${PRONOUN_TAG_SOURCE}[\\s,:…()—–-]*$`, "iu");
var TAG_WINDOW = 40;
function hasPronounTag(paragraph) {
  return quoteMatches(paragraph).some((match) => TAG_AFTER_QUOTE.test(paragraph.slice(match.end, match.end + TAG_WINDOW)) || TAG_BEFORE_QUOTE.test(paragraph.slice(Math.max(0, match.start - TAG_WINDOW), match.start)));
}
function speakerPatterns(characters) {
  const verbs = SPEECH_VERBS.flatMap((verb) => [verb, `${verb[0].toUpperCase()}${verb.slice(1)}`]).map((verb) => verb.replace(/ /g, "\\s+")).join("|");
  return characters.filter((character) => character.status !== "cut").map((character) => {
    const names = new Set;
    const full = String(character.name ?? "").trim();
    if (full !== "") {
      names.add(full);
      const first = givenName(full);
      if (first.length >= 2) {
        names.add(first);
      }
    }
    for (const alias of stringList(character.aliases)) {
      names.add(alias);
    }
    const alternatives = [...names].sort((left, right) => right.length - left.length).map(escape).join("|");
    if (alternatives === "") {
      return null;
    }
    const keys = new Set([...names].map((entry) => entry.split(NON_WORD)[0]));
    return {
      id: character.id,
      keys,
      name: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "u"),
      subject: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})\\s+(?:${verbs})(?![\\p{L}\\p{N}])`, "u"),
      inverted: new RegExp(`(?<![\\p{L}\\p{N}])(?:${verbs})\\s+(?:${alternatives})(?![\\p{L}\\p{N}])`, "u")
    };
  }).filter(Boolean);
}
var NON_WORD = /[^\p{L}\p{N}]+/u;
var OPENS_WITH_QUOTE = /^["“‘']/;
function attribute(paragraph, allSpeakers) {
  const narration = `${splitOpenSpeech(paragraph).narration} `;
  const words = new Set(narration.split(NON_WORD));
  const speakers = allSpeakers.filter((speaker) => [...speaker.keys].some((key) => key === "" || words.has(key)));
  for (const form of ["subject", "inverted"]) {
    const tagged = speakers.filter((speaker) => speaker[form].test(narration));
    if (tagged.length === 1) {
      return tagged[0].id;
    }
    if (tagged.length > 1) {
      return null;
    }
  }
  if (hasPronounTag(paragraph)) {
    return null;
  }
  const named = speakers.filter((speaker) => speaker.name.test(narration));
  return named.length === 1 ? named[0].id : null;
}
var LETTER = /[\p{L}\p{N}]/u;
var ELISION = /^(?:em|tis|twas|cause|cos|til|till|bout|round|n|nuff)(?![\p{L}\p{N}])/iu;
var DASH_OPEN = /^[—―]\s*/;
var DASH_TAG = new RegExp(`,\\s+(?:(?:${VERB_ALTERNATION})\\s+\\p{Lu}|(?:${PRONOUNS})\\s+(?:${VERB_ALTERNATION})(?![\\p{L}\\p{N}])|\\p{Lu}[\\p{L}'’-]*(?:\\s+\\p{Lu}[\\p{L}'’-]*){0,2}\\s+(?:${VERB_ALTERNATION})(?![\\p{L}\\p{N}]))`, "u");
function quoteMatches(paragraph) {
  const matches = [];
  const next = { "”": -1, '"': -1 };
  const find = (key, from) => {
    if (next[key] !== Infinity && next[key] < from) {
      const found = paragraph.indexOf(key, from);
      next[key] = found === -1 ? Infinity : found;
    }
    return next[key];
  };
  const singles = singleQuoteMarks(paragraph);
  let index = 0;
  const dash = DASH_OPEN.exec(paragraph);
  if (dash) {
    const body = paragraph.slice(dash[0].length);
    const tag = DASH_TAG.exec(body);
    const closing = /\s[—―]/.exec(body);
    const stop = Math.min(tag ? tag.index : Infinity, closing ? closing.index + 1 : Infinity);
    const close = stop === Infinity ? paragraph.length : dash[0].length + stop;
    matches.push({ start: 0, end: Math.min(close + 1, paragraph.length), text: paragraph.slice(dash[0].length, close) });
    index = close + 1;
  }
  while (index < paragraph.length) {
    const char = paragraph[index];
    let close = Infinity;
    if (char === "“") {
      close = find("”", index + 1);
    } else if (char === '"') {
      close = find('"', index + 1);
    } else if (char === "‘" || char === "'") {
      close = singleClose(singles[char], index);
    }
    if (close === Infinity) {
      index += 1;
      continue;
    }
    matches.push({ start: index, end: close + 1, text: paragraph.slice(index + 1, close) });
    index = close + 1;
  }
  return matches;
}
function singleQuoteMarks(paragraph) {
  const marks = { "‘": { open: [], close: [] }, "'": { open: [], close: [] } };
  for (let index = 0;index < paragraph.length; index += 1) {
    const char = paragraph[index];
    const before = paragraph[index - 1] ?? "";
    const after = paragraph[index + 1] ?? "";
    if (char === "‘" && !LETTER.test(before)) {
      marks["‘"].open.push(index);
    } else if (char === "’" && !LETTER.test(after)) {
      marks["‘"].close.push(index);
    } else if (char === "'") {
      if (!LETTER.test(before) && LETTER.test(after) && !ELISION.test(paragraph.slice(index + 1))) {
        marks["'"].open.push(index);
      } else if (!LETTER.test(after) && before !== "" && !/\s/.test(before)) {
        marks["'"].close.push(index);
      }
    }
  }
  for (const key of Object.keys(marks)) {
    marks[key].opens = new Set(marks[key].open);
    marks[key].paragraph = paragraph;
  }
  return marks;
}
function singleClose(marks, index) {
  if (!marks.opens.has(index)) {
    return Infinity;
  }
  const nextOpen = firstAfter(marks.open, index);
  let position = firstIndexAfter(marks.close, index);
  if (position === -1 || marks.close[position] > nextOpen) {
    return Infinity;
  }
  while (position + 1 < marks.close.length && marks.close[position + 1] < nextOpen && looksPossessive(marks.paragraph, marks.close[position])) {
    position += 1;
  }
  return marks.close[position];
}
function looksPossessive(paragraph, index) {
  return /[sS]/.test(paragraph[index - 1] ?? "") && /^\s+\p{Ll}/u.test(paragraph.slice(index + 1, index + 4));
}
function firstIndexAfter(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = low + high >> 1;
    if (sorted[middle] <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low < sorted.length ? low : -1;
}
function firstAfter(sorted, value) {
  const position = firstIndexAfter(sorted, value);
  return position === -1 ? Infinity : sorted[position];
}
function replaceQuotes(paragraph) {
  let result = "";
  let position = 0;
  for (const match of quoteMatches(paragraph)) {
    result += `${paragraph.slice(position, match.start)} `;
    position = match.end;
  }
  return result + paragraph.slice(position);
}
function quotedSpans(paragraph) {
  return quoteMatches(paragraph).map((match) => match.text.trim()).filter((text) => text !== "");
}
function splitOpenSpeech(paragraph) {
  const text = replaceQuotes(paragraph);
  const cuts = [];
  const curly = text.indexOf("“", text.lastIndexOf("”") + 1);
  if (curly !== -1) {
    cuts.push(curly);
  }
  const straight = text.indexOf('"');
  if (straight !== -1) {
    cuts.push(straight);
  }
  const lastSingleClose = text.lastIndexOf("’");
  const single = /(?<![\p{L}\p{N}])‘/u.exec(text.slice(lastSingleClose + 1));
  if (single) {
    cuts.push(lastSingleClose + 1 + single.index);
  }
  if (/^'[\p{L}\p{N}]/u.test(text) && !ELISION.test(text.slice(1))) {
    cuts.push(0);
  }
  if (cuts.length === 0) {
    return { narration: text, open: null };
  }
  const cut = Math.min(...cuts);
  const open = text.slice(cut + 1).trim();
  return { narration: text.slice(0, cut), open: open === "" ? null : open };
}
function narrationOnly(paragraph) {
  return splitOpenSpeech(paragraph).narration;
}
function profile(character, said) {
  const text = said.map((line) => line.text).join(" ");
  const words = splitWords(text);
  const sentences = said.flatMap((line) => splitSentences(line.text).filter((sentence) => splitWords(sentence).length > 0));
  const questions = sentences.filter((sentence) => /\?["'”’)]*$/.test(sentence.trim())).length;
  const exclamations = sentences.filter((sentence) => /!["'”’)]*$/.test(sentence.trim())).length;
  return {
    id: character.id,
    lines: said.length,
    words: words.length,
    sentenceLength: sentences.length === 0 ? 0 : words.length / sentences.length,
    contractions: words.length === 0 ? 0 : (text.match(CONTRACTION_PATTERN) ?? []).length * 100 / words.length,
    questions: sentences.length === 0 ? 0 : questions / sentences.length,
    exclamations: sentences.length === 0 ? 0 : exclamations / sentences.length,
    counts: wordCounts(words),
    signature: []
  };
}
function wordCounts(words) {
  const counts = new Map;
  for (const raw of words) {
    const word = raw.toLowerCase().replace(/’/g, "'");
    if (word.length >= 4 && !STOPWORDS.has(word) && !/^\d+$/.test(word)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return counts;
}
function signatureWords(profiles) {
  const totals = new Map;
  let allWords = 0;
  for (const entry of profiles) {
    allWords += entry.words;
    for (const [word, count] of entry.counts) {
      totals.set(word, (totals.get(word) ?? 0) + count);
    }
  }
  for (const entry of profiles) {
    const otherWords = allWords - entry.words;
    const scored = [];
    for (const [word, count] of entry.counts) {
      if (count < 2) {
        continue;
      }
      const own = count / entry.words;
      const others = otherWords === 0 ? 0 : (totals.get(word) - count) / otherWords;
      if (own > others * 2) {
        scored.push({ word, count, score: own - others });
      }
    }
    entry.signature = scored.sort((left, right) => right.score - left.score || right.count - left.count || left.word.localeCompare(right.word, "en")).slice(0, 5).map((item) => item.word);
    delete entry.counts;
  }
}
function similarVoices(left, right) {
  const limits = VOICE_THRESHOLDS;
  const close = (a, b, limit) => Math.abs(a - b) < limit - 0.000000001;
  return close(left.sentenceLength, right.sentenceLength, limits.sentenceLength) && close(left.contractions, right.contractions, limits.contractions) && close(left.questions, right.questions, limits.questions) && close(left.exclamations, right.exclamations, limits.exclamations);
}
function phrasePattern(phrase) {
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escape(String(phrase).trim()).replace(/['’]/g, "['’]")}(?![\\p{L}\\p{M}\\p{N}])`, "iu");
}
function escape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function stringList(value) {
  return (Array.isArray(value) ? value : []).filter((item) => typeof item === "string" && item.trim() !== "");
}
function formatVoices(report) {
  const lines = [`Voices: ${plural(report.profiles.length, "speaking character")}, ${plural(report.unattributed, "unattributed line")}`];
  if (report.profiles.length === 0) {
    lines.push("", `- None: tag dialogue with a character's name and a speech verb ("...," Mara said)`);
    return `${lines.join(`
`)}
`;
  }
  for (const entry of report.profiles) {
    lines.push("", `${entry.id}: ${plural(entry.lines, "line")}, ${plural(entry.words, "word")}`, `  Sentence length ${entry.sentenceLength.toFixed(1)}, contractions ${entry.contractions.toFixed(1)} per 100 words, questions ${Math.round(entry.questions * 100)}%, exclamations ${Math.round(entry.exclamations * 100)}%`, `  Signature words: ${entry.signature.join(", ") || "none yet"}`);
  }
  return `${lines.join(`
`)}
`;
}

// src/prose.js
var FILTER_WORDS = [
  "felt",
  "saw",
  "heard",
  "noticed",
  "realized",
  "realised",
  "wondered",
  "seemed",
  "watched",
  "knew",
  "decided",
  "thought",
  "sensed"
];
var SAID_BOOKISMS = [
  "barked",
  "bellowed",
  "breathed",
  "chuckled",
  "cooed",
  "declared",
  "exclaimed",
  "gasped",
  "grinned",
  "groaned",
  "growled",
  "grunted",
  "hissed",
  "inquired",
  "interjected",
  "intoned",
  "laughed",
  "opined",
  "purred",
  "queried",
  "quipped",
  "retorted",
  "shrieked",
  "sighed",
  "smiled",
  "smirked",
  "snapped",
  "snarled",
  "sneered",
  "spat",
  "stated"
];
var PLAIN_TAGS = ["said", "asked", "says", "asks"];
var NOT_ADVERBS = new Set([
  "ally",
  "anomaly",
  "apply",
  "assembly",
  "belly",
  "bully",
  "burly",
  "butterfly",
  "chilly",
  "comply",
  "costly",
  "curly",
  "daily",
  "deadly",
  "dolly",
  "dragonfly",
  "early",
  "elderly",
  "family",
  "fly",
  "folly",
  "friendly",
  "ghastly",
  "ghostly",
  "gully",
  "holly",
  "holy",
  "homely",
  "hourly",
  "imply",
  "italy",
  "jelly",
  "jolly",
  "july",
  "lily",
  "likely",
  "lively",
  "lonely",
  "lovely",
  "melancholy",
  "monopoly",
  "monthly",
  "multiply",
  "oily",
  "only",
  "orderly",
  "prickly",
  "rally",
  "rely",
  "reply",
  "sickly",
  "silly",
  "sly",
  "smelly",
  "stately",
  "supply",
  "surly",
  "tally",
  "ugly",
  "unlikely",
  "weekly",
  "wobbly",
  "woolly",
  "yearly"
]);
var ECHO_STOPWORDS = new Set([
  "about",
  "above",
  "after",
  "again",
  "against",
  "along",
  "always",
  "among",
  "another",
  "around",
  "because",
  "before",
  "behind",
  "being",
  "below",
  "between",
  "could",
  "couldn't",
  "didn't",
  "doesn't",
  "don't",
  "every",
  "first",
  "hadn't",
  "haven't",
  "isn't",
  "might",
  "never",
  "other",
  "right",
  "should",
  "since",
  "something",
  "still",
  "their",
  "there",
  "these",
  "thing",
  "things",
  "those",
  "though",
  "three",
  "through",
  "until",
  "wasn't",
  "where",
  "which",
  "while",
  "without",
  "would",
  "wouldn't",
  "you're",
  "they're",
  "we're"
]);
var PHRASE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "not",
  "of",
  "on",
  "or",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "then",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "with",
  "you"
]);
var DIALECT_PAIRS = [
  ["armour", "armor"],
  ["armoured", "armored"],
  ["centre", "center"],
  ["centres", "centers"],
  ["centred", "centered"],
  ["colour", "color"],
  ["colours", "colors"],
  ["coloured", "colored"],
  ["colourful", "colorful"],
  ["defence", "defense"],
  ["defences", "defenses"],
  ["favour", "favor"],
  ["favours", "favors"],
  ["favoured", "favored"],
  ["favourite", "favorite"],
  ["grey", "gray"],
  ["greying", "graying"],
  ["harbour", "harbor"],
  ["harbours", "harbors"],
  ["honour", "honor"],
  ["honours", "honors"],
  ["honoured", "honored"],
  ["honourable", "honorable"],
  ["jewellery", "jewelry"],
  ["labour", "labor"],
  ["mould", "mold"],
  ["mouldy", "moldy"],
  ["neighbour", "neighbor"],
  ["neighbours", "neighbors"],
  ["odour", "odor"],
  ["offence", "offense"],
  ["plough", "plow"],
  ["rumour", "rumor"],
  ["rumours", "rumors"],
  ["sceptic", "skeptic"],
  ["sceptical", "skeptical"],
  ["smoulder", "smolder"],
  ["smouldering", "smoldering"],
  ["theatre", "theater"],
  ["towards", "toward"],
  ["travelled", "traveled"],
  ["travelling", "traveling"],
  ["traveller", "traveler"],
  ["cancelled", "canceled"],
  ["vapour", "vapor"],
  ["whisky", "whiskey"]
];
var PROSE_THRESHOLDS = {
  filterPerThousand: 10,
  adverbsPerThousand: 12,
  minRateWords: 300,
  maxBookisms: 2,
  echoWindow: 30,
  echoMinLength: 5,
  uniformMinSentences: 20,
  uniformSpread: 5,
  phraseLength: 4,
  phraseMinCount: 3,
  phraseLimit: 10
};
function proseThresholds(options = {}) {
  const thresholds = { ...PROSE_THRESHOLDS };
  for (const [flag, key, whole] of [["max-filter-words", "filterPerThousand", false], ["max-adverbs", "adverbsPerThousand", false], ["max-bookisms", "maxBookisms", true]]) {
    const raw = options[flag];
    if (raw === undefined) {
      continue;
    }
    const text = String(raw).trim();
    if (!(whole ? /^\d+$/ : /^\d+(?:\.\d+)?$/).test(text) || !Number.isFinite(Number(text))) {
      throw usageError(`--${flag} must be ${whole ? "a whole number" : "a number"} 0 or more, such as ${PROSE_THRESHOLDS[key]}`);
    }
    thresholds[key] = Number(text);
  }
  return thresholds;
}
function proseRules(styleData, names) {
  const data = styleData ?? {};
  const allow = new Set(stringList2(data["allow-words"]).map(normalizeWord));
  const variants = [];
  for (const entry of Array.isArray(data.preferred) ? data.preferred : []) {
    if (entry && typeof entry.use === "string" && typeof entry.avoid === "string" && entry.use.trim() !== "" && entry.avoid.trim() !== "" && normalizeWord(entry.use.trim()) !== normalizeWord(entry.avoid.trim())) {
      variants.push({ use: entry.use.trim(), avoid: entry.avoid.trim(), source: "style sheet" });
    }
  }
  const dialect = typeof data.dialect === "string" ? data.dialect : "unspecified";
  if (dialect === "british" || dialect === "american") {
    const claimed = new Set(variants.flatMap((variant) => [normalizeWord(variant.use), normalizeWord(variant.avoid)]).concat([...allow]));
    for (const [british, american] of DIALECT_PAIRS) {
      const [use, avoid] = dialect === "british" ? [british, american] : [american, british];
      if (!claimed.has(use) && !claimed.has(avoid)) {
        variants.push({ use, avoid, source: `${dialect} dialect` });
      }
    }
  }
  const nameTokens = new Set;
  for (const name of names) {
    for (const token of splitWords(String(name))) {
      nameTokens.add(nameKey(token));
    }
  }
  return {
    allow,
    variants: variants.map((variant) => ({ ...variant, pattern: phrasePattern2(variant.avoid) })),
    watch: stringList2(data["watch-words"]).map((word) => ({ word, pattern: phrasePattern2(word) })),
    filterWords: new Set(FILTER_WORDS.filter((word) => !allow.has(word))),
    bookisms: new Set(SAID_BOOKISMS.filter((word) => !allow.has(word))),
    nameTokens
  };
}
function analyzeChapter(prose, rules) {
  const paragraphs = proseParagraphs(prose);
  const text = paragraphs.join(`

`);
  const words = splitWords(text);
  const narration = splitWords(paragraphs.map(narrationOnly).join(`

`));
  const sentenceList = paragraphs.flatMap((paragraph) => splitSentences(paragraph));
  const sentences = sentenceList.map((sentence) => splitWords(sentence).length).filter((count) => count > 0);
  const filterWords = countMatching(narration, (word) => rules.filterWords.has(word));
  const adverbs = countMatching(narration, (word) => isAdverb(word, rules));
  const tags = dialogueTags(paragraphs, rules);
  return {
    words: words.length,
    narrationWords: narration.length,
    paragraphs: paragraphs.length,
    sentences: sentenceStats(sentences),
    filterWords,
    adverbs,
    plainTags: tags.plain,
    bookisms: tags.bookisms,
    echoes: echoes(words, rules),
    watch: rules.watch.map(({ word, pattern }) => ({ word, count: countPattern(text, pattern) })).filter((entry) => entry.count > 0),
    variants: rules.variants.map(({ use, avoid, source, pattern }) => ({ use, avoid, source, count: countVariant(text, pattern, rules) })).filter((entry) => entry.count > 0),
    phraseSentences: sentenceList.map((sentence) => splitWords(sentence).map(normalizeWord))
  };
}
function chapterFindings(label, analysis, thresholds = PROSE_THRESHOLDS, { baseline = false } = {}) {
  const findings = [];
  for (const variant of analysis.variants) {
    findings.push(warn("prose-avoided-spelling", `${label} uses "${variant.avoid}" ${times(variant.count)}; ${variant.source} prefers "${variant.use}"`, label));
  }
  const rated = analysis.narrationWords >= thresholds.minRateWords;
  const filterRate = perThousand(total(analysis.filterWords), analysis.narrationWords);
  if (!baseline && rated && filterRate > thresholds.filterPerThousand) {
    findings.push(warn("prose-filter-words", `${label} has ${formatAgainst(filterRate, thresholds.filterPerThousand, "over")} filter words per 1,000 narration words (over ${thresholds.filterPerThousand}): ${formatCounts(analysis.filterWords, 5)}`, label));
  }
  const adverbRate = perThousand(total(analysis.adverbs), analysis.narrationWords);
  if (!baseline && rated && adverbRate > thresholds.adverbsPerThousand) {
    findings.push(warn("prose-adverbs", `${label} has ${formatAgainst(adverbRate, thresholds.adverbsPerThousand, "over")} -ly adverbs per 1,000 narration words (over ${thresholds.adverbsPerThousand}): ${formatCounts(analysis.adverbs, 5)}`, label));
  }
  const bookisms = total(analysis.bookisms);
  if (bookisms > thresholds.maxBookisms) {
    findings.push(warn("prose-bookisms", `${label} has ${bookisms} said-bookism dialogue tags: ${formatCounts(analysis.bookisms, 5)}`, label));
  }
  const stats = analysis.sentences;
  if (stats.count >= thresholds.uniformMinSentences && stats.spread < thresholds.uniformSpread) {
    findings.push(warn("prose-uniform-sentences", `${label} sentence lengths are uniform (spread ${formatAgainst(stats.spread, thresholds.uniformSpread, "under")} words over ${stats.count} sentences); vary the rhythm`, label));
  }
  return findings;
}
var BASELINE_TOLERANCES = {
  minSampleWords: 2000,
  minSentences: 10,
  sentenceLength: 0.3,
  paragraphLength: 0.5,
  dialogueShare: 20,
  rateFloor: 3,
  rateShare: 0.5,
  signatureWords: 20,
  signatureMinCount: 3
};
function baselineProfile(samples) {
  const analyses = samples.map((sample) => sample.analysis);
  const sum = (pick) => analyses.reduce((total, analysis) => total + pick(analysis), 0);
  const words = sum((analysis) => analysis.words);
  const narrationWords = sum((analysis) => analysis.narrationWords);
  const lengths = samples.flatMap((sample) => sample.sentenceLengths);
  const counts = new Map;
  for (const sample of samples) {
    for (const word of sample.contentWords) {
      increment(counts, word);
    }
  }
  return {
    samples: samples.map((sample) => sample.file),
    words,
    narrationWords,
    sentences: sentenceStats(lengths),
    paragraphMean: sum((analysis) => analysis.paragraphs) === 0 ? 0 : words / sum((analysis) => analysis.paragraphs),
    dialogueShare: words === 0 ? 0 : (words - narrationWords) * 100 / words,
    filterPerThousand: perThousand(sum((analysis) => total(analysis.filterWords)), narrationWords),
    adverbsPerThousand: perThousand(sum((analysis) => total(analysis.adverbs)), narrationWords),
    signatureWords: sortCounts(counts).filter((entry) => entry.count >= BASELINE_TOLERANCES.signatureMinCount).slice(0, BASELINE_TOLERANCES.signatureWords).map((entry) => entry.word),
    usable: narrationWords >= BASELINE_TOLERANCES.minSampleWords
  };
}
function contentWords(prose, rules) {
  return splitWords(proseParagraphs(prose).join(`

`)).map(normalizeWord).filter((word) => word.length >= 4 && !ECHO_STOPWORDS.has(word) && !PHRASE_STOPWORDS.has(word) && !isName(word, rules) && !/^\p{N}+$/u.test(word));
}
function sentenceLengths(prose) {
  return proseParagraphs(prose).flatMap((paragraph) => splitSentences(paragraph)).map((sentence) => splitWords(sentence).length).filter((count) => count > 0);
}
function baselineFigures(analysis, profile, chapterWords) {
  const used = new Set(chapterWords);
  return {
    sentenceMean: analysis.sentences.mean,
    paragraphMean: analysis.paragraphs === 0 ? 0 : analysis.words / analysis.paragraphs,
    dialogueShare: analysis.words === 0 ? 0 : (analysis.words - analysis.narrationWords) * 100 / analysis.words,
    filterPerThousand: perThousand(total(analysis.filterWords), analysis.narrationWords),
    adverbsPerThousand: perThousand(total(analysis.adverbs), analysis.narrationWords),
    signatureWordsUsed: profile.signatureWords.filter((word) => used.has(word)).length
  };
}
function baselineFindings(label, analysis, figures, profile, tolerances = BASELINE_TOLERANCES) {
  const findings = [];
  if (!profile.usable || analysis.words < PROSE_THRESHOLDS.minRateWords) {
    return findings;
  }
  const rated = analysis.narrationWords >= PROSE_THRESHOLDS.minRateWords;
  const relative = (value, base, share) => base > 0 && Math.abs(value - base) > base * share;
  const direction = (value, base, more, fewer) => value > base ? more : fewer;
  if (analysis.sentences.count >= tolerances.minSentences && relative(figures.sentenceMean, profile.sentences.mean, tolerances.sentenceLength)) {
    findings.push(warn("prose-baseline-sentences", `${label} sentences average ${formatRate(figures.sentenceMean)} words, ${direction(figures.sentenceMean, profile.sentences.mean, "longer", "shorter")} than your samples' ${formatRate(profile.sentences.mean)} (tolerance ${tolerances.sentenceLength * 100}%)`, label));
  }
  if (relative(figures.paragraphMean, profile.paragraphMean, tolerances.paragraphLength)) {
    findings.push(warn("prose-baseline-paragraphs", `${label} paragraphs average ${formatRate(figures.paragraphMean)} words, ${direction(figures.paragraphMean, profile.paragraphMean, "longer", "shorter")} than your samples' ${formatRate(profile.paragraphMean)} (tolerance ${tolerances.paragraphLength * 100}%)`, label));
  }
  if (Math.abs(figures.dialogueShare - profile.dialogueShare) > tolerances.dialogueShare) {
    findings.push(warn("prose-baseline-dialogue", `${label} is ${formatRate(figures.dialogueShare)}% dialogue, ${direction(figures.dialogueShare, profile.dialogueShare, "more", "less")} than your samples' ${formatRate(profile.dialogueShare)}% (tolerance ${tolerances.dialogueShare} points)`, label));
  }
  const rateDrift = (name, field) => {
    const allowed = Math.max(tolerances.rateFloor, profile[field] * tolerances.rateShare);
    return Math.abs(figures[field] - profile[field]) > allowed ? `${label} has ${formatRate(figures[field])} ${name} per 1,000 narration words, ${direction(figures[field], profile[field], "more", "fewer")} than your samples' ${formatRate(profile[field])} (tolerance ${formatRate(allowed)})` : null;
  };
  const filterDrift = rated ? rateDrift("filter words", "filterPerThousand") : null;
  if (filterDrift !== null) {
    findings.push(warn("prose-baseline-filter-words", filterDrift, label));
  }
  const adverbDrift = rated ? rateDrift("-ly adverbs", "adverbsPerThousand") : null;
  if (adverbDrift !== null) {
    findings.push(warn("prose-baseline-adverbs", adverbDrift, label));
  }
  return findings;
}
function repeatedPhrases(analyses, thresholds = PROSE_THRESHOLDS) {
  const counts = new Map;
  const size = thresholds.phraseLength;
  for (const analysis of analyses) {
    for (const sentence of analysis.phraseSentences) {
      for (let index = 0;index + size <= sentence.length; index += 1) {
        const gram = sentence.slice(index, index + size);
        if (gram.every((word) => PHRASE_STOPWORDS.has(word))) {
          continue;
        }
        const key = gram.join(" ");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const repeated = new Map([...counts].filter(([, count]) => count >= thresholds.phraseMinCount));
  return sortCounts(repeated).slice(0, thresholds.phraseLimit).map((entry) => ({ phrase: entry.word, count: entry.count }));
}
function similarNames(characters) {
  const firsts = characters.map((character) => ({ id: character.id, name: String(character.name), first: givenName(character.name).toLowerCase() })).filter((entry) => entry.first.length >= 3).sort((left, right) => left.id.localeCompare(right.id, "en"));
  const pairs = [];
  for (let left = 0;left < firsts.length; left += 1) {
    for (let right = left + 1;right < firsts.length; right += 1) {
      const a = firsts[left].first;
      const b = firsts[right].first;
      const limit = Math.min(a.length, b.length) >= 5 ? 2 : 1;
      if (a === b || a.slice(0, 3) === b.slice(0, 3) || editDistance(a, b) <= limit) {
        pairs.push([firsts[left], firsts[right]]);
      }
    }
  }
  return pairs;
}
function formatProseReport(report) {
  const chapterCount = `${report.chapters.length} ${report.chapters.length === 1 ? "chapter" : "chapters"}`;
  const lines = [`Prose report: ${report.passage ? "passage from stdin" : chapterCount}, ${report.words} words`];
  if (!report.styleSheet) {
    lines.push("No style-sheet.md: spelling and watch-word checks are off");
  }
  const profile = report.baseline;
  if (profile) {
    const stats = profile.sentences;
    lines.push(`Baseline from ${profile.samples.length} ${profile.samples.length === 1 ? "sample" : "samples"} (${profile.words} words): sentences ${formatRate(stats.mean)} words (spread ${formatRate(stats.spread)}), paragraphs ${formatRate(profile.paragraphMean)} words, ${formatRate(profile.dialogueShare)}% dialogue, ${formatRate(profile.filterPerThousand)} filter words and ${formatRate(profile.adverbsPerThousand)} -ly adverbs per 1k narration words`);
    lines.push(profile.usable ? `  Signature words: ${profile.signatureWords.join(", ") || "none"}` : `  Too few sample words to compare with (${profile.narrationWords} of ${BASELINE_TOLERANCES.minSampleWords} narration words): the fixed limits apply`);
  }
  for (const chapter of report.chapters) {
    const analysis = chapter.analysis;
    const stats = analysis.sentences;
    lines.push("", `${chapter.file}: ${chapter.title} (${analysis.words} words)`);
    lines.push(`  Sentences: ${stats.count}, average ${formatRate(stats.mean)} words, longest ${stats.longest}, spread ${formatRate(stats.spread)}`);
    lines.push(`  Filter words: ${formatRate(perThousand(total(analysis.filterWords), analysis.narrationWords))} per 1k narration words${countSuffix(analysis.filterWords)}`);
    lines.push(`  -ly adverbs: ${formatRate(perThousand(total(analysis.adverbs), analysis.narrationWords))} per 1k narration words${countSuffix(analysis.adverbs)}`);
    lines.push(`  Dialogue tags: ${formatCounts(analysis.plainTags, 4) || "none plain"}; said-bookisms: ${formatCounts(analysis.bookisms, 5) || "none"}`);
    if (chapter.baseline && profile.usable) {
      const figures = chapter.baseline;
      lines.push(`  Against the baseline: paragraphs ${formatRate(figures.paragraphMean)} words, ${formatRate(figures.dialogueShare)}% dialogue, signature words ${figures.signatureWordsUsed} of ${profile.signatureWords.length}`);
    }
    lines.push(`  Echoes within ${PROSE_THRESHOLDS.echoWindow} words: ${formatCounts(analysis.echoes, 5) || "none"}`);
    if (analysis.watch.length > 0) {
      lines.push(`  Watch words: ${analysis.watch.map((entry) => `${entry.word} ${entry.count}`).join(", ")}`);
    }
    if (analysis.variants.length > 0) {
      lines.push(`  Spelling: ${analysis.variants.map((entry) => `${entry.avoid} ${entry.count} (use ${entry.use})`).join(", ")}`);
    }
  }
  lines.push("", report.passage ? "Passage:" : "Manuscript:");
  lines.push(`  Repeated ${PROSE_THRESHOLDS.phraseLength}-word phrases: ${report.phrases.map((entry) => `"${entry.phrase}" ${entry.count}`).join(", ") || "none"}`);
  if (!report.passage) {
    lines.push(`  Similar character names: ${report.similarNames.map(([a, b]) => `${a.name} / ${b.name}`).join(", ") || "none"}`);
  }
  return `${lines.join(`
`)}
`;
}
function proseParagraphs(prose) {
  return withoutFenceMarkers(scanComments(String(prose), " ").text).split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.split(/\r?\n/).filter((line) => !/^\s{0,3}#/.test(line)).join(" ")).map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter((paragraph) => paragraph !== "" && !/^([*_-])( ?\1){2,}$/.test(paragraph));
}
var BEAT_PRONOUNS = new Set(["he", "she", "they", "i", "we", "it", "you"]);
function dialogueTags(paragraphs, rules) {
  const plain = new Map;
  const bookisms = new Map;
  for (const paragraph of paragraphs) {
    for (const match of quoteMatches(paragraph)) {
      const after = splitWords(paragraph.slice(match.end, match.end + 200).split(/[.!?;:“"]/)[0]).slice(0, 3);
      const tag = tagKind(match.text, after[0] ?? "");
      if (tag === "none") {
        continue;
      }
      for (const raw of after) {
        const word = raw.toLowerCase();
        if (PLAIN_TAGS.includes(word)) {
          increment(plain, word);
          break;
        }
        if (tag === "any" && rules.bookisms.has(word)) {
          increment(bookisms, word);
          break;
        }
      }
    }
  }
  return { plain: sortCounts(plain), bookisms: sortCounts(bookisms) };
}
function tagKind(quoted, nextWord) {
  const end = quoted.trim().replace(/["'”’)\]*_]+$/, "").slice(-1);
  if (end === ".") {
    return "none";
  }
  if (/[?!…—–-]/.test(end) && /^\p{Lu}/u.test(nextWord)) {
    return BEAT_PRONOUNS.has(nextWord.toLowerCase()) ? "none" : "plain";
  }
  return "any";
}
function isAdverb(word, rules) {
  return word.length > 4 && word.endsWith("ly") && !NOT_ADVERBS.has(word) && !rules.allow.has(word) && !isName(word, rules);
}
function isName(word, rules) {
  return rules.nameTokens.has(word) || rules.nameTokens.has(nameKey(word));
}
function normalizeWord(word) {
  return String(word).toLowerCase().replace(/’/g, "'");
}
function nameKey(word) {
  return normalizeWord(word).replace(/'s$/, "");
}
function countVariant(text, pattern, rules) {
  let count = 0;
  for (const match of text.matchAll(pattern)) {
    const first = splitWords(match[0])[0] ?? "";
    if (/^\p{Lu}/u.test(first) && isName(first, rules)) {
      continue;
    }
    count += 1;
  }
  return count;
}
function echoes(words, rules) {
  const lastSeen = new Map;
  const counts = new Map;
  words.forEach((raw, index) => {
    const word = normalizeWord(raw);
    if (word.length < PROSE_THRESHOLDS.echoMinLength || ECHO_STOPWORDS.has(word) || isName(word, rules) || rules.allow.has(word) || /^\p{N}+$/u.test(word)) {
      return;
    }
    if (lastSeen.has(word) && index - lastSeen.get(word) <= PROSE_THRESHOLDS.echoWindow) {
      increment(counts, word);
    }
    lastSeen.set(word, index);
  });
  return sortCounts(counts);
}
function sentenceStats(lengths) {
  if (lengths.length === 0) {
    return { count: 0, mean: 0, longest: 0, spread: 0 };
  }
  const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
  return { count: lengths.length, mean, longest: Math.max(...lengths), spread: Math.sqrt(variance) };
}
function countMatching(words, predicate) {
  const counts = new Map;
  for (const raw of words) {
    const word = normalizeWord(raw);
    if (predicate(word)) {
      increment(counts, word);
    }
  }
  return sortCounts(counts);
}
function phrasePattern2(phrase) {
  const body = phrase.trim().split(/\s+/).map((word) => escapeRegExp(word).replace(/['’]/g, "['’]")).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${body}(?![\\p{L}\\p{M}\\p{N}])`, "giu");
}
function countPattern(text, pattern) {
  return (text.match(pattern) ?? []).length;
}
function formatAgainst(value, threshold, side) {
  for (let places = 1;places < 6; places += 1) {
    const shown = Number(value.toFixed(places));
    if (side === "over" ? shown > threshold : shown < threshold) {
      return value.toFixed(places);
    }
  }
  return String(value);
}
function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1;i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1;j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}
function increment(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
var COLLATOR = new Intl.Collator("en");
function sortCounts(counts) {
  return [...counts.entries()].map(([word, count]) => ({ word, count })).sort((left, right) => right.count - left.count || COLLATOR.compare(left.word, right.word));
}
function stringList2(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
}
function total(counts) {
  return counts.reduce((sum, entry) => sum + entry.count, 0);
}
function perThousand(count, words) {
  return words === 0 ? 0 : count * 1000 / words;
}
function formatRate(value) {
  return value.toFixed(1);
}
function formatCounts(counts, limit) {
  return counts.slice(0, limit).map((entry) => `${entry.word} ${entry.count}`).join(", ");
}
function countSuffix(counts) {
  return counts.length === 0 ? "" : ` (${formatCounts(counts, 5)})`;
}
function times(count) {
  return count === 1 ? "once" : `${count} times`;
}

// src/options.js
var OPTIONS = [
  { name: "title", value: "<name>", help: ["Story title for import"] },
  { name: "dir", value: "<path>", help: ["Target directory for init or import"] },
  { name: "genre", value: "<name>", help: ["Story genre for init or import"] },
  { name: "sub-genre", value: "<name>", help: ["Story sub-genre for init or import"] },
  { name: "setting-era", value: "<name>", help: ["Setting era for init or import"] },
  { name: "theme", value: "<name>", repeatable: true, help: ["Theme for init, import, or add arc; repeatable"] },
  { name: "themes", value: "<a,b>", repeatable: true, aliasOf: "theme", help: ["Comma-separated themes for init, import, or add arc"] },
  { name: "pov", value: "<style|id>", help: ["POV style for init or import; POV character id", "for add chapter/scene (also added to characters)"] },
  { name: "tense", value: "<tense>", help: ["Narrative tense for init or import"] },
  { name: "form", value: "<form>", help: ["Story form for init (novel, novella, novelette,", "short-story, flash, serial, picture-book,", "chapter-book); sets a default target-words"] },
  { name: "synopsis", value: "<text>", help: ["Starter synopsis for init or import"] },
  { name: "series", value: "<id>", help: ["Series id for init"] },
  { name: "book-number", value: "<n>", help: ["Publication order for init"] },
  { name: "follows", value: "<path>", repeatable: true, help: ["Init a sequel set after this story project;", "repeatable"] },
  { name: "precedes", value: "<path>", repeatable: true, help: ["Init a prequel set before this story project;", "repeatable"] },
  {
    name: "force",
    help: [
      "Let init/import use an existing directory: add",
      "missing starter files, never overwrite existing",
      "ones; import also replaces every chapter-NN.md file"
    ]
  },
  { name: "write", help: ["Update chapter word-count frontmatter"] },
  { name: "log", help: ["Record today's word count in progress.md"] },
  { name: "ref", value: "<git-ref>", help: ["Earlier draft as a git branch, tag, or commit", "for compare"] },
  { name: "against", value: "<path>", help: ["Earlier draft as another project folder for", "compare; text to check for similarity (a file,", "folder, or git ref)"] },
  { name: "anchor", value: "<label>", repeatable: true, help: ["Review-copy paragraph label (ch03-p12) to find", "in the current text for compare; repeatable"] },
  { name: "path", value: "<path>", help: ["Project root for every command except init and", "import"] },
  { name: "out", value: "<file>", help: ["Output path for export/build/synopsis/diagram"] },
  { name: "format", value: "<name>", help: ["Output format for build (markdown, epub, docx,", "shunn, html, print, narration, metadata,", "fountain, twee, ink)"] },
  { name: "trim", value: "<size>", help: ["Trim size for build --format print (5x8,", "5.25x8, 5.5x8.5, 6x9, a5; default 5.5x8.5)"] },
  { name: "stamp", value: "<label>", help: ["Build label printed in build --format html (a", "date, commit, or review round)"] },
  { name: "note-url", value: "<url>", help: ["Note form linked, prefilled, from every label in", "build --format html (a GitHub new-issue link)"] },
  { name: "shunn", help: ["Apply Shunn manuscript formatting (with --format", "docx)"] },
  { name: "at", value: "<chapter-id>", help: ["Chapter id for knowledge: what the character knew", "and how their progressions had changed them"] },
  { name: "budget", value: "<tokens>", help: ["Token budget for context (default 6000)"] },
  { name: "scenes", value: "<n>", help: ["Earlier scenes to summarise for context", "(default 5)"] },
  { name: "init", help: ["Add the default revision passes for passes"] },
  { name: "start", value: "<pass>", help: ["Mark a revision pass in progress for passes"] },
  { name: "done", value: "<pass>", help: ["Mark a revision pass done for passes"] },
  { name: "max-filter-words", value: "<n>", help: ["Warn above n filter words per 1,000 narration", "words for prose (default 10)"] },
  { name: "max-adverbs", value: "<n>", help: ["Warn above n -ly adverbs per 1,000 narration", "words for prose (default 12)"] },
  { name: "baseline", help: ["Compare prose with style-sheet.md samples of your", "own writing (on when samples are listed; --baseline", "false turns it off)"] },
  { name: "max-bookisms", value: "<n>", help: ["Warn above n said-bookism tags in a chapter for", "prose (default 2)"] },
  { name: "min-words", value: "<n>", help: ["Shortest shared run of words similarity reports", "(default 8, at least 5)"] },
  { name: "pages", value: "<n>", help: ["Synopsis length for synopsis (1 or 3)"] },
  { name: "actionable", help: ["Include next actions in report"] },
  { name: "json", help: ["Print one JSON result object (apiVersion,", "command, ok, data, diagnostics, writes) instead", "of text, for the check and analysis commands"] },
  { name: "id", value: "<kebab-id>", help: ["Explicit id for add or rename, for a name with", "no ASCII letters or digits"] },
  { name: "number", value: "<n>", help: ["Chapter number for add chapter or move chapter"] },
  { name: "chapter", value: "<id>", help: ["Chapter id for add scene or move scene"] },
  { name: "scene", value: "<n>", help: ["Scene number for add scene or move scene"] },
  { name: "type", value: "<name>", help: ["Entity type for add"] },
  { name: "role", value: "<name>", help: ["Character role for add character"] },
  { name: "status", value: "<name>", help: ["Entity status for add"] },
  { name: "mode", value: "<name>", help: ["Mode for add chapter (e.g. discovered)"] },
  { name: "date", value: "<date>", help: ["Story date (YYYY-MM-DD) for add chapter/scene;", "the session date for progress (default today)"] },
  { name: "time", value: "<time>", help: ["Story time (HH:MM or dawn, morning, midday,", "afternoon, evening, night) for add chapter/scene"] },
  { name: "travel-hours", value: "<n>", help: ["Travel hours for add scene"] },
  { name: "dilemma", value: "<text>", help: ["Dilemma for add scene sequel unit"] },
  { name: "sequel", help: ["Mark scene as sequel unit for add scene"] },
  { name: "outcome", value: "<name>", help: ["Scene outcome for add scene (yes, no, yes-but,", "no-and)"] },
  { name: "hook", value: "<name>", help: ["Chapter-ending hook for add chapter (cliffhanger,", "question, revelation, reversal, decision,", "emotional, resolution)"] },
  { name: "location", value: "<id>", repeatable: true, help: ["Location reference for add"] },
  { name: "locations", value: "<ids>", repeatable: true, aliasOf: "location" },
  { name: "character", value: "<id>", repeatable: true, help: ["Character reference for add; repeatable"] },
  { name: "characters", value: "<ids>", repeatable: true, aliasOf: "character" },
  { name: "mention", value: "<id>", repeatable: true, help: ["Mentioned character for add chapter/scene;", "repeatable"] },
  { name: "mentions", value: "<ids>", repeatable: true, aliasOf: "mention" },
  { name: "member", value: "<id>", repeatable: true, help: ["Faction member reference for add faction; repeatable"] },
  { name: "members", value: "<ids>", repeatable: true, aliasOf: "member" },
  { name: "owner", value: "<id>", help: ["Owner reference for add artifact"] },
  { name: "arc", value: "<id>", repeatable: true, help: ["Arc reference for add (arc theme for add", "character); repeatable"] },
  { name: "arcs", value: "<ids>", repeatable: true, aliasOf: "arc" },
  { name: "introduced", value: "<id>", help: ["Chapter id for add question"] },
  { name: "resolved", value: "<id>", help: ["Chapter id for add question"] },
  { name: "planted", value: "<id>", help: ["Chapter id for add promise/clue"] },
  { name: "payoff", value: "<id>", help: ["Chapter id for add promise/clue"] },
  { name: "significance-delayed", help: ["Significance is delayed for add clue"] },
  { name: "red-herring", help: ["Mark add clue as a red herring"] },
  { name: "category", value: "<name>", help: ["Category for add term"] },
  { name: "alias", value: "<name>", repeatable: true, help: ["Alias for add term; repeatable"] },
  { name: "aliases", value: "<names>", repeatable: true, aliasOf: "alias" },
  { name: "region", value: "<name>", help: ["Region for add location"] },
  { name: "population", value: "<name>", help: ["Population for add location"] },
  { name: "controlled-by", value: "<id>", help: ["Controlling faction for add location"] },
  { name: "prevalence", value: "<name>", help: ["Prevalence for add system"] },
  { name: "acts", value: "<a,b>", repeatable: true, help: ["Comma-separated acts for add arc; repeatable"] },
  { name: "act", value: "<name>", repeatable: true, aliasOf: "acts" },
  { name: "placement", value: "<front|back>", help: ["Placement for add matter (default front)"] },
  { name: "order", value: "<n>", help: ["Order within its placement for add matter"] },
  { name: "heading", help: ["Print the page title for add matter; --heading", "false for a dedication or epigraph"] },
  { name: "source", value: "<text>", repeatable: true, help: ["Source for add research; repeatable"] },
  { name: "sources", value: "<texts>", repeatable: true, aliasOf: "source" },
  { name: "used-in", value: "<chapter-id>", repeatable: true, help: ["Chapter that relies on add research; repeatable"] },
  { name: "accuracy", value: "<level>", help: ["Accuracy for add research (must-be-accurate,", "blended, invented)"] },
  { name: "confidence", value: "<level>", help: ["Confidence for add research (high, medium, low)"] },
  { name: "method", value: "<name>", help: ["Research method for add research (fact, interview,", "site-visit, expert-review, reading)"] },
  { name: "risk", value: "<name>", repeatable: true, help: ["Risk area for add research (legal, medical,", "weapons, safety, cultural, defamation,", "technical); repeatable"] }
];
var BOOLEAN_OPTIONS = new Set(OPTIONS.filter((option) => option.value === undefined).map((option) => option.name));
var VALUE_OPTIONS = new Set(OPTIONS.filter((option) => option.value !== undefined).map((option) => option.name));
var REPEATABLE_OPTIONS = new Set(OPTIONS.filter((option) => option.repeatable).map((option) => option.name));
function takesValue(name) {
  return VALUE_OPTIONS.has(name);
}
var OPTION_COLUMN = 28;
function formatOptionsHelp(names = null) {
  const rows = OPTIONS.filter((option) => option.help && (names === null || names.includes(option.name))).map((option) => ({ flag: `--${option.name}${option.value ? ` ${option.value}` : ""}`, help: option.help })).concat([
    { flag: "-h, --help", help: ["Show this help"] },
    { flag: "-v, --version", help: ["Show the story CLI version"] }
  ]);
  const lines = [];
  for (const row of rows) {
    const head = `  ${row.flag}`;
    const [first, ...rest] = row.help;
    lines.push(head.length < OPTION_COLUMN ? `${head.padEnd(OPTION_COLUMN)}${first}` : `${head}  ${first}`);
    for (const line of rest) {
      lines.push(`${" ".repeat(OPTION_COLUMN)}${line}`);
    }
  }
  return lines;
}
function isKnownOptionToken(token) {
  if (token === "-h" || token === "-v") {
    return true;
  }
  if (!token.startsWith("--")) {
    return false;
  }
  const equalIndex = token.indexOf("=");
  const key = token.slice(2, equalIndex === -1 ? undefined : equalIndex);
  return key === "help" || key === "version" || BOOLEAN_OPTIONS.has(key) || VALUE_OPTIONS.has(key);
}
function addOption(options, key, value) {
  const stored = BOOLEAN_OPTIONS.has(key) ? normalizeBooleanValue(key, value) : value;
  if (options[key] === undefined || !REPEATABLE_OPTIONS.has(key)) {
    options[key] = stored;
  } else {
    options[key] = Array.isArray(options[key]) ? options[key].concat(stored) : [options[key], stored];
  }
}
function normalizeBooleanValue(key, value) {
  if (typeof value !== "string") {
    return Boolean(value);
  }
  const lower = value.trim().toLowerCase();
  if (lower === "false" || lower === "0" || lower === "no" || lower === "off") {
    return false;
  }
  if (lower === "true" || lower === "1" || lower === "yes" || lower === "on") {
    return true;
  }
  throw usageError(`Unknown value "${value}" for --${key}: expected true or false`);
}
function suggestion(input, candidates, prefix = "") {
  const scored = candidates.map((candidate) => ({ candidate, distance: editDistance(input.toLowerCase(), candidate) }));
  const best = Math.min(...scored.map((entry) => entry.distance));
  if (best > Math.max(1, Math.floor(input.length / 3))) {
    return "";
  }
  const names = scored.filter((entry) => entry.distance === best).slice(0, 3).map((entry) => `${prefix}${entry.candidate}`);
  return `; did you mean ${names.join(" or ")}?`;
}
function isTruthy(value) {
  const current = Array.isArray(value) ? value[value.length - 1] : value;
  if (typeof current === "string") {
    const lower = current.trim().toLowerCase();
    if (lower === "false" || lower === "0" || lower === "no" || lower === "off" || lower === "") {
      return false;
    }
    return true;
  }
  return Boolean(current);
}
function optionFamily(name) {
  const canonical = OPTIONS.find((option) => option.name === name)?.aliasOf ?? name;
  return [canonical, ...OPTIONS.filter((option) => option.aliasOf === canonical).map((option) => option.name)];
}
function isBooleanLiteralToken(token) {
  return typeof token === "string" && /^(true|false|0|1|yes|no|on|off)$/i.test(token);
}
function parseArgs(argv, suggestFrom = OPTIONS.map((option) => option.name)) {
  const positionals = [];
  const options = {};
  for (let index = 0;index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      options.version = true;
      continue;
    }
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equalIndex = arg.indexOf("=");
    const key = arg.slice(2, equalIndex === -1 ? undefined : equalIndex);
    const inlineValue = equalIndex === -1 ? undefined : arg.slice(equalIndex + 1);
    if ((key === "help" || key === "version") && inlineValue !== undefined) {
      if (normalizeBooleanValue(key, inlineValue)) {
        options[key] = true;
      }
      continue;
    }
    if (BOOLEAN_OPTIONS.has(key)) {
      if (inlineValue !== undefined) {
        addOption(options, key, inlineValue);
        continue;
      }
      const nextToken = argv[index + 1];
      if (isBooleanLiteralToken(nextToken)) {
        addOption(options, key, nextToken);
        index += 1;
        continue;
      }
      addOption(options, key, true);
      continue;
    }
    if (VALUE_OPTIONS.has(key)) {
      if (inlineValue !== undefined) {
        addOption(options, key, inlineValue);
        continue;
      }
      const nextValue = argv[index + 1];
      if (nextValue === undefined || isKnownOptionToken(nextValue) || nextValue.startsWith("--")) {
        throw usageError(`Missing value for --${key}: expected a value`);
      }
      addOption(options, key, nextValue);
      index += 1;
      continue;
    }
    throw usageError(`Unknown option --${key}${suggestion(key, suggestFrom, "--")}`);
  }
  return { positionals, options };
}

// src/exemptions.js
var EXEMPTIONS_FILE = path3.join("continuity", "exemptions.md");
var MATCH_KEYS = ["pattern", "code", "file", "chapter"];
var MIN_PATTERN_LENGTH = 4;
function portable(text) {
  return text.replace(/\\/g, "/");
}
function exemptionFile(value) {
  const text = portable(value);
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text) || text.split("/").includes("..") || text.includes("\x00")) {
    return null;
  }
  const normalized = path3.posix.normalize(text).replace(/\/$/, "");
  return normalized === "." ? null : normalized;
}
function exemptionProblems(entry, label = "exemption") {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return [err("entry-not-mapping", `${label} must be a mapping`, EXEMPTIONS_FILE)];
  }
  const problems = [];
  for (const key of Object.keys(entry)) {
    const intended = [...MATCH_KEYS, "reason"].find((known) => {
      const normalized = key.trim().toLowerCase().replace(/[\s_]+/g, "-");
      return key !== known && (normalized === known || normalized === `${known}s`);
    });
    if (intended !== undefined) {
      problems.push(err("exemption-misspelled-key", `${label} has ${key}; did you mean ${intended}?`, EXEMPTIONS_FILE));
    }
  }
  if (MATCH_KEYS.every((key) => entry[key] === undefined)) {
    problems.push(err("missing-field", `${label} sets none of ${MATCH_KEYS.join(", ")}: set at least one to say which findings it dismisses`, EXEMPTIONS_FILE));
  }
  if (entry.pattern !== undefined) {
    if (typeof entry.pattern !== "string" || entry.pattern.trim() === "") {
      problems.push(err("missing-field", `${label} is missing a non-empty pattern`, EXEMPTIONS_FILE));
    } else if (entry.pattern.trim().length < MIN_PATTERN_LENGTH) {
      problems.push(err("exemption-pattern-too-short", `${label} pattern must be at least ${MIN_PATTERN_LENGTH} characters to avoid blanket exemptions`, EXEMPTIONS_FILE));
    }
  }
  const codeProblem = entry.code === undefined ? null : codeError(entry.code, label);
  if (codeProblem) {
    problems.push(codeProblem);
  }
  if (entry.file !== undefined) {
    if (typeof entry.file !== "string" || entry.file.trim() === "") {
      problems.push(err("field-not-text", `${label} file must be a project file path, such as chapters/chapter-03.md`, EXEMPTIONS_FILE));
    } else if (exemptionFile(entry.file) === null) {
      problems.push(err("exemption-file-not-relative", `${label} file ${entry.file} must be a path inside the project, relative to story.md, such as chapters/chapter-03.md`, EXEMPTIONS_FILE));
    }
  }
  if (entry.chapter !== undefined && !isChapterId(entry.chapter)) {
    problems.push(err("id-not-kebab", `${label} chapter must be a kebab-case chapter id, such as chapter-03, got ${JSON.stringify(entry.chapter)}`, EXEMPTIONS_FILE));
  } else if (entry.chapter !== undefined && codeProblem === null && entry.code !== undefined && !CHAPTER_CODES.includes(entry.code)) {
    problems.push(err("exemption-chapter-not-carried", `${label} sets chapter, but ${entry.code} findings carry no chapter, so it would never match: use file instead`, EXEMPTIONS_FILE));
  }
  const narrowed = ["pattern", "file", "chapter"].some((key) => entry[key] !== undefined);
  if (entry.code !== undefined && codeProblem === null && !narrowed) {
    const severity = FINDING_CODES[entry.code] === "warning" ? `, or set severity ${entry.code} to off in story.md` : "";
    problems.push(err("exemption-too-broad", `${label} sets only code, which would dismiss every ${entry.code} finding: add file, chapter, or pattern to narrow it${severity}`, EXEMPTIONS_FILE));
  } else if (entry.code === undefined && entry.pattern === undefined && narrowed) {
    problems.push(err("exemption-too-broad", `${label} sets ${entry.file === undefined ? "chapter" : entry.chapter === undefined ? "file" : "file and chapter"} without code or pattern, which would dismiss every finding about it: add the finding's code`, EXEMPTIONS_FILE));
  }
  if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
    problems.push(err("missing-field", `${label} is missing a non-empty reason`, EXEMPTIONS_FILE));
  }
  return problems;
}
function isChapterId(value) {
  return typeof value === "string" && value !== "" && kebabCase(value) === value;
}
function codeError(code, label) {
  if (typeof code !== "string" || code.trim() === "") {
    return err("field-not-text", `${label} code must be a finding code, such as clock-backward`, EXEMPTIONS_FILE);
  }
  if (!Object.hasOwn(FINDING_CODES, code)) {
    return err("exemption-unknown-code", `${label} code ${code} is not a finding code${suggestion(code, Object.keys(FINDING_CODES))}`, EXEMPTIONS_FILE);
  }
  if (!exemptionCodes().includes(code)) {
    const why = PROJECTLESS_CODES.includes(code) ? "story init or story import reports it before there is an exemption log to read" : "it is an error outside story continuity, which means the project is broken: only continuity errors and warnings can be exempted";
    return err("exemption-code-not-dismissible", `${label} code ${code} cannot be exempted: ${why}`, EXEMPTIONS_FILE);
  }
  return null;
}
function parseExemptions(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const exemptions = [];
  entries.forEach((entry, index) => {
    if (exemptionProblems(entry).length > 0) {
      return;
    }
    const exemption = { index, reason: entry.reason.trim() };
    if (entry.pattern !== undefined) {
      exemption.pattern = entry.pattern;
    }
    if (entry.code !== undefined) {
      exemption.code = entry.code;
    }
    if (entry.file !== undefined) {
      exemption.file = exemptionFile(entry.file);
    }
    if (entry.chapter !== undefined) {
      exemption.chapter = entry.chapter;
    }
    exemptions.push(exemption);
  });
  return exemptions;
}
function readExemptionLog(root) {
  try {
    return parseExemptions(parseFrontmatter(readTextFile(path3.join(root, EXEMPTIONS_FILE))).data.exemptions);
  } catch {
    return [];
  }
}
function exemptionMatches(exemption, finding) {
  return (exemption.pattern === undefined || portable(finding.message).includes(portable(exemption.pattern))) && (exemption.code === undefined || finding.code === exemption.code) && (exemption.file === undefined || typeof finding.file === "string" && portable(finding.file) === exemption.file) && (exemption.chapter === undefined || finding.chapter === exemption.chapter);
}
function dismissByExemptions(result, exemptions, { errors: withErrors }) {
  if (exemptions.length === 0) {
    return result;
  }
  const dismissed = [...result.dismissed ?? []];
  const keep = (findings) => findings.filter((finding) => {
    const match = exemptions.find((exemption) => exemptionMatches(exemption, finding));
    if (match) {
      dismissed.push({ finding, reason: match.reason, index: match.index });
    }
    return !match;
  });
  const errors = withErrors ? keep(result.errors) : result.errors;
  const warnings = keep(result.warnings);
  if (dismissed.length === (result.dismissed ?? []).length) {
    return result;
  }
  return { ...result, ok: withErrors ? errors.length === 0 : result.ok, errors, warnings, dismissed };
}

// src/progressions.js
var PROGRESSION_KINDS = ["character", "location", "faction"];
var RESERVED_FIELDS = new Set(["progressions", "id", "died-in", "revived-in"]);
function progressionEntry(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const from = idText(item.from);
  const field = typeof item.field === "string" ? item.field : "";
  if (from === "" || field === "" || item.value === undefined || item.value === null) {
    return null;
  }
  return { from, field, value: item.value };
}
function setOwn(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
function chapterPosition(chronology, id) {
  if (chronology.numbers.has(id)) {
    return chronology.numbers.get(id);
  }
  const match = /^chapter-(\d+)$/.exec(id);
  return match && Number(match[1]) > 0 ? Number(match[1]) : Number.NaN;
}
function happensAfter(chronology, later, earlier) {
  if (chronology.numbers.has(later) && chronology.numbers.has(earlier)) {
    return chronology.after(later, earlier);
  }
  return chapterPosition(chronology, later) > chapterPosition(chronology, earlier);
}
function sortProgressions(list, chronology) {
  const known = [];
  const unknown = [];
  for (const item of list) {
    const from = item && typeof item === "object" && !Array.isArray(item) ? idText(item.from) : "";
    (Number.isNaN(chapterPosition(chronology, from)) ? unknown : known).push({ item, from });
  }
  known.sort((left, right) => happensAfter(chronology, left.from, right.from) ? 1 : happensAfter(chronology, right.from, left.from) ? -1 : 0);
  return [...known, ...unknown].map((entry) => entry.item);
}
function entityStateAt(data, atChapterId, chronology) {
  if (Number.isNaN(chapterPosition(chronology, atChapterId))) {
    throw usageError(`Unknown chapter ${atChapterId}`);
  }
  const state = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (key !== "progressions") {
      setOwn(state, key, value);
    }
  }
  const entries = (Array.isArray(data?.progressions) ? data.progressions : []).map(progressionEntry).filter((entry) => entry !== null && !Number.isNaN(chapterPosition(chronology, entry.from)) && !happensAfter(chronology, entry.from, atChapterId));
  entries.sort((left, right) => happensAfter(chronology, left.from, right.from) ? 1 : happensAfter(chronology, right.from, left.from) ? -1 : 0);
  const changes = [];
  for (const entry of entries) {
    changes.push({ field: entry.field, value: entry.value, from: entry.from, previous: Object.hasOwn(state, entry.field) ? state[entry.field] : undefined });
    setOwn(state, entry.field, entry.value);
  }
  return { state, changes };
}
function validateProgressions(data, label, rules, chronology, errors) {
  if (data.progressions === undefined) {
    return;
  }
  if (!Array.isArray(data.progressions)) {
    errors.push(err("field-not-list", `${label} frontmatter field progressions must be a list`, label));
    return;
  }
  const seen = new Map;
  let latest = null;
  for (const [index, item] of data.progressions.entries()) {
    const entryLabel = `${label} progressions[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(err("entry-not-mapping", `${entryLabel} must be a mapping with from, field, and value`, label));
      continue;
    }
    const from = idText(item.from);
    if (from === "") {
      errors.push(err("missing-field", `${entryLabel} is missing from (the chapter the change takes effect)`, label));
    }
    const field = item.field;
    let fieldOk = false;
    if (typeof field !== "string" || field.trim() === "") {
      errors.push(err("missing-field", `${entryLabel} is missing field`, label));
    } else if (field !== kebabCase(field)) {
      errors.push(err("id-not-kebab", `${entryLabel} field ${field} must be kebab-case`, label));
    } else if (RESERVED_FIELDS.has(field)) {
      errors.push(err("progression-fixed-field", `${entryLabel} cannot change ${field}${field === "died-in" || field === "revived-in" ? "; set it on the character and story continuity reads it by chapter" : ""}`, label));
    } else if (rules.lists.has(field)) {
      errors.push(err("progression-list-field", `${entryLabel} cannot change ${field}, which is a list; a progression holds a single value`, label));
    } else {
      fieldOk = true;
    }
    const value = item.value;
    if (value === undefined || value === null) {
      errors.push(err("missing-field", `${entryLabel} is missing value`, label));
    } else if (typeof value === "object") {
      errors.push(err("field-not-scalar", `${entryLabel} value must be a single value, not a list or mapping`, label));
    } else if (fieldOk && rules.enums.has(field) && !rules.enums.get(field).has(value)) {
      errors.push(err("unsupported-value", `${entryLabel} ${field} has unsupported value ${value}`, label));
    }
    if (from !== "" && fieldOk) {
      const key = `${from}\x00${field}`;
      if (seen.has(key)) {
        errors.push(err("progression-duplicate", `${entryLabel} repeats ${field} from ${from} (progressions[${seen.get(key)}])`, label));
      } else {
        seen.set(key, index);
      }
    }
    if (Number.isNaN(chapterPosition(chronology, from))) {
      continue;
    }
    if (latest && happensAfter(chronology, latest.from, from)) {
      errors.push(err("progression-out-of-order", `${entryLabel} from ${from} comes before progressions[${latest.index}] from ${latest.from} in the story; list progressions in story order`, label));
      continue;
    }
    latest = { from, index };
  }
}
function formatStateChanges(changes, atChapterId) {
  if (changes.length === 0) {
    return "";
  }
  const lines = [`State at ${atChapterId}:`];
  for (const change of changes) {
    const previous = change.previous === undefined ? "" : `, was ${change.previous}`;
    lines.push(`- ${change.field}: ${change.value === "" ? "(cleared)" : change.value} (from ${change.from}${previous})`);
  }
  return `${lines.join(`
`)}
`;
}

// src/deaths.js
var STATUS_PROGRESSIONS = new WeakMap;
function statusProgressions(character) {
  if (!STATUS_PROGRESSIONS.has(character)) {
    const list = Array.isArray(character.frontmatter.progressions) ? character.frontmatter.progressions : [];
    STATUS_PROGRESSIONS.set(character, list.map((item, index) => ({ index, entry: progressionEntry(item) })).filter(({ entry }) => entry !== null && entry.field === "status").map(({ index, entry }) => ({ index, from: entry.from, value: String(entry.value) })));
  }
  return STATUS_PROGRESSIONS.get(character);
}
function progressionStatusAt(character, chapterId, chronology) {
  let status = String(character.status);
  let from = "";
  let deadFrom = "";
  if (chronology.numbers.has(chapterId) && statusProgressions(character).length > 0) {
    for (const change of entityStateAt(character.frontmatter, chapterId, chronology).changes) {
      if (change.field !== "status") {
        continue;
      }
      const value = String(change.value);
      if (value === "deceased" && status !== "deceased") {
        deadFrom = change.from;
      }
      status = value;
      from = change.from;
    }
  }
  return { status, from, deadFrom };
}
function progressionDeathAt(character, chapterId, chronology) {
  const from = progressionDeathFrom(character, chapterId, chronology);
  if (from === null || from !== "" && !happensAfter(chronology, chapterId, from)) {
    return null;
  }
  return { from };
}
function progressionDeathFrom(character, chapterId, chronology) {
  const { status, deadFrom } = progressionStatusAt(character, chapterId, chronology);
  if (status !== "deceased" || character.diedIn && deadFrom === "") {
    return null;
  }
  if (character.diedIn && (character.revivedIn === "" || !happensAfter(chronology, deadFrom, character.revivedIn))) {
    return null;
  }
  return deadFrom;
}
function characterLifeline(character, chronology) {
  const status = String(character.status ?? "");
  const chapters = storyOrder(chronology);
  if (chapters.length === 0 || character.diedIn && !chronology.numbers.has(character.diedIn)) {
    const dead = status === "deceased";
    return { deadAtStart: dead, deadAtEnd: dead, events: [] };
  }
  const leadIn = status === "deceased" && Boolean(character.diedIn) && statusProgressions(character).some(({ from, value }) => value !== "deceased" && happensAfter(chronology, character.diedIn, from));
  const deadAtStart = status === "deceased" && (!character.diedIn || leadIn);
  if (!character.diedIn && statusProgressions(character).length === 0) {
    return { deadAtStart, deadAtEnd: deadAtStart, events: [] };
  }
  const window = deathWindow(character, chronology);
  const events = [];
  let dead = deadAtStart;
  for (const chapter of chapters) {
    const byDiedIn = window !== null && (chapter === window.died || window.deadIn(chapter));
    const beforeDeath = leadIn && happensAfter(chronology, window.died, chapter) && progressionStatusAt(character, chapter, chronology).status === "deceased";
    const now = byDiedIn || beforeDeath || progressionDeathFrom(character, chapter, chronology) !== null;
    if (!now && dead && chapter !== window?.revived && progressionStatusAt(character, chapter, chronology).from === "") {
      continue;
    }
    if (now !== dead) {
      events.push(now ? { type: "death", chapter, source: chapter === window?.died ? "died-in" : "progression" } : { type: "revival", chapter, source: chapter === window?.revived ? "revived-in" : "progression" });
      dead = now;
    }
  }
  return { deadAtStart, deadAtEnd: dead, events };
}
function revivedBy(lifeline, chapterId, chronology) {
  return chronology.numbers.has(chapterId) && lifeline.events.some((event) => event.type === "revival" && !happensAfter(chronology, event.chapter, chapterId));
}
function storyOrder(chronology) {
  return [...chronology.numbers.keys()].sort((left, right) => chronology.numbers.get(left) - chronology.numbers.get(right) || (left < right ? -1 : left > right ? 1 : 0)).sort((left, right) => chronology.after(left, right) ? 1 : chronology.after(right, left) ? -1 : 0);
}

// src/continuity.js
var CHEKHOV_CHAPTER_GAP = 3;
function checkContinuity(project) {
  const errors = [];
  const warnings = [];
  for (const scanError of project.fileErrors ?? []) {
    errors.push(scanError);
  }
  const context = {
    chapterNumbers: new Map(project.chapters.map((chapter) => [chapter.id, chapter.number])),
    characters: new Map(project.characters.map((character) => [character.id, character])),
    locations: new Set(project.locations.map((location) => location.id)),
    artifacts: new Map(project.artifacts.map((artifact) => [artifact.id, artifact])),
    factions: new Set(project.factions.map((faction) => faction.id)),
    latestChapter: project.chapters.filter((chapter) => chapter.status !== "outline").reduce((max, chapter) => Math.max(max, chapter.number), 0),
    highestChapter: project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0),
    chapterNumberList: project.chapters.map((chapter) => chapter.number),
    draftedChapters: new Set(project.chapters.filter((chapter) => chapter.status !== "outline").map((chapter) => chapter.id)),
    chronology: chapterChronology(project)
  };
  checkCharacterDeaths(project, context, errors, warnings);
  checkChapterCasts(project, warnings);
  checkSceneCasts(project, warnings);
  checkCutCharacters(project, warnings);
  checkChapterSequence(project, warnings);
  checkPromises(project, context, errors, warnings);
  checkQuestions(project, context, errors);
  checkClues(project, context, errors, warnings);
  checkStoryCompletion(project, errors);
  checkContinuityState(project, context, errors, warnings);
  checkSceneLearning(project, context, errors, warnings);
  checkStateAgainstStory(project, context, warnings);
  checkPropCustody(project, context, errors);
  checkClock(project, errors, warnings);
  return withExemptions(project, { ok: errors.length === 0, errors, warnings });
}
function withExemptions(project, result) {
  return dismissByExemptions({ ...result, dismissed: [] }, project.exemptions ?? [], { errors: true });
}
function checkCharacterDeaths(project, context, errors, warnings) {
  for (const character of project.characters) {
    const label = relative(project, character.file);
    if (character.revivedIn && !character.diedIn) {
      errors.push(err("revived-without-death", `${label} has revived-in ${character.revivedIn} but no died-in; set died-in or remove revived-in`, label));
    }
    if (!character.diedIn) {
      checkStatusAppearances(project, character, context.chronology, warnings);
      continue;
    }
    const deathNumber = context.chapterNumbers.get(character.diedIn);
    if (deathNumber === undefined) {
      errors.push(err("died-in-missing-chapter", `${label} died-in references missing chapter ${character.diedIn}`, label));
      continue;
    }
    if (character.revivedIn) {
      if (!context.chapterNumbers.has(character.revivedIn)) {
        errors.push(err("revived-in-missing-chapter", `${label} revived-in references missing chapter ${character.revivedIn}`, label));
        continue;
      }
      if (!context.chronology.after(character.revivedIn, character.diedIn)) {
        errors.push(err("revival-before-death", `${label} is revived in ${character.revivedIn}, not after dying in ${character.diedIn}`, label));
        continue;
      }
    }
    const deathWritten = !context.chronology.outline.has(character.diedIn);
    const revivalWritten = character.revivedIn !== "" && !context.chronology.outline.has(character.revivedIn);
    if (deathWritten && !revivalWritten && character.status !== "deceased") {
      errors.push(err("death-status-mismatch", `${label} has died-in ${character.diedIn} but status ${character.status || "unset"}; set status: deceased`, label));
    }
    if (revivalWritten && character.status === "deceased") {
      errors.push(err("revival-status-mismatch", `${label} has revived-in ${character.revivedIn} but status deceased; set status: alive`, label));
    }
    checkProgressionDeath(character, label, context.chronology, warnings);
    checkStatusAppearances(project, character, context.chronology, warnings);
    const window = deathWindow(character, context.chronology);
    for (const chapter of project.chapters) {
      if (window.deadIn(chapter.id) && castIncludes(chapter, character.id)) {
        errors.push(err("posthumous-appearance", `${relative(project, chapter.file)} lists ${character.id}, who died in ${character.diedIn}; move posthumous appearances to mentions`, relative(project, chapter.file), chapter.id));
      }
    }
    for (const scene of project.scenes) {
      if (window.deadIn(scene.chapter) && castIncludes(scene, character.id)) {
        errors.push(err("posthumous-appearance", `${relative(project, scene.file)} lists ${character.id}, who died in ${character.diedIn}; move posthumous appearances to mentions`, relative(project, scene.file), chapterOf(scene)));
      }
    }
  }
}
function checkStatusAppearances(project, character, chronology, warnings) {
  if (statusProgressions(character).length === 0 && character.status !== "deceased") {
    return;
  }
  for (const entry of [...project.chapters, ...project.scenes]) {
    if (!castIncludes(entry, character.id)) {
      continue;
    }
    const chapterId = entry.chapter ?? entry.id;
    const death = progressionDeathAt(character, chapterId, chronology);
    const entryLabel = relative(project, entry.file);
    if (death?.from === "") {
      warnings.push(warn("deceased-in-cast", `${entryLabel} lists ${character.id}, who died before the story (deceased with no died-in); move appearances to mentions`, entryLabel, chapterOf(entry)));
    } else if (death) {
      warnings.push(warn("progression-deceased-in-cast", `${entryLabel} lists ${character.id}, whose progressions make them deceased from ${death.from}; move appearances after the death to mentions`, entryLabel, chapterOf(entry)));
    }
  }
}
function progressionIndex(character, from) {
  return statusProgressions(character).filter((entry) => entry.from === from).pop().index;
}
function checkProgressionDeath(character, label, chronology, warnings) {
  const died = character.diedIn;
  const revived = character.revivedIn;
  const atDeath = progressionStatusAt(character, died, chronology);
  if (atDeath.status !== "deceased" && atDeath.from !== "") {
    warnings.push(warn("progression-death-conflict", `${label} progressions[${progressionIndex(character, atDeath.from)}] leaves ${character.id} ${atDeath.status} when they die in ${died}; add a status progression to deceased from ${died}`, label, died));
  }
  for (const { index, from, value } of statusProgressions(character)) {
    if (value !== "deceased" && happensAfter(chronology, from, died) && (revived === "" || happensAfter(chronology, revived, from))) {
      const fix = revived === "" ? `set revived-in: ${from} if they come back` : `move it to ${revived}, when they are revived`;
      warnings.push(warn("progression-death-conflict", `${label} progressions[${index}] sets status ${value} from ${from}, while ${character.id} is dead after dying in ${died}; ${fix}`, label, from));
    }
  }
  if (revived === "") {
    return;
  }
  const atRevival = progressionStatusAt(character, revived, chronology);
  if (atRevival.status === "deceased" && atRevival.from !== "") {
    warnings.push(warn("progression-death-conflict", `${label} progressions[${progressionIndex(character, atRevival.from)}] makes ${character.id} deceased from ${atRevival.from}, which still holds when they are revived in ${revived}; add a status progression from ${revived}`, label, revived));
  }
}
function checkChapterCasts(project, warnings) {
  for (const chapter of project.chapters) {
    if (chapter.pov && !chapter.characters.includes(chapter.pov) && !chapter.mentions.includes(chapter.pov)) {
      warnings.push(warn("pov-not-in-cast", `${relative(project, chapter.file)} POV character ${chapter.pov} is not listed in characters`, relative(project, chapter.file), chapter.id));
    }
    const scenePovs = [...new Set(project.scenes.filter((scene) => scene.chapter === chapter.id && scene.pov).map((scene) => scene.pov))];
    if (chapter.pov && scenePovs.length > 0 && !scenePovs.includes(chapter.pov)) {
      warnings.push(warn("pov-scene-mismatch", `${relative(project, chapter.file)} has POV ${chapter.pov} but its scenes are told by ${scenePovs.join(", ")}`, relative(project, chapter.file), chapter.id));
    }
  }
}
function checkSceneCasts(project, warnings) {
  const chapters = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
  for (const scene of project.scenes) {
    const label = relative(project, scene.file);
    if (scene.pov && !scene.characters.includes(scene.pov) && !scene.mentions.includes(scene.pov)) {
      warnings.push(warn("pov-not-in-cast", `${label} POV character ${scene.pov} is not listed in characters`, label, chapterOf(scene)));
    }
    const chapter = chapters.get(scene.chapter);
    if (!chapter) {
      continue;
    }
    for (const characterId of scene.characters) {
      if (!chapter.characters.includes(characterId) && !chapter.mentions.includes(characterId)) {
        warnings.push(warn("scene-cast-not-in-chapter", `${label} lists ${characterId} but ${relative(project, chapter.file)} does not list them in characters or mentions`, label, chapterOf(scene)));
      }
    }
    if (scene.location && !chapter.locations.includes(scene.location)) {
      warnings.push(warn("scene-location-not-in-chapter", `${label} is set in ${scene.location} but ${relative(project, chapter.file)} does not list that location`, label, chapterOf(scene)));
    }
  }
}
function checkCutCharacters(project, warnings) {
  const cut = new Set(project.characters.filter((character) => character.status === "cut").map((character) => character.id));
  if (cut.size === 0) {
    return;
  }
  for (const entry of [...project.chapters, ...project.scenes]) {
    const listed = [...new Set([idText(entry.pov), ...entry.characters.map(idText)])].filter((id) => cut.has(id));
    for (const id of listed) {
      warnings.push(warn("cut-character-in-cast", `${relative(project, entry.file)} lists ${id}, who has status: cut; drop them from pov and characters`, relative(project, entry.file), chapterOf(entry)));
    }
  }
  for (const arc of project.arcs) {
    for (const id of new Set(arc.characters.map(idText))) {
      if (cut.has(id)) {
        warnings.push(warn("cut-character-in-arc", `${relative(project, arc.file)} lists ${id}, who has status: cut; drop them from characters`, relative(project, arc.file)));
      }
    }
  }
  for (const character of project.characters) {
    for (const relationship of character.relationships) {
      if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
        continue;
      }
      const target = idText(relationship.character);
      if (target === "" || cut.has(target) === cut.has(character.id)) {
        continue;
      }
      const who = cut.has(target) ? target : character.id;
      warnings.push(warn("cut-character-relationship", `${relative(project, character.file)} has a relationship with ${target}, but ${who} has status: cut; drop the relationship on both sides`, relative(project, character.file)));
    }
  }
}
function checkChapterSequence(project, warnings) {
  const numbers = project.chapters.map((chapter) => chapter.number).filter((number) => Number.isInteger(number) && number > 0).sort((left, right) => left - right);
  if (numbers.length > 0 && numbers[0] > 1) {
    warnings.push(warn("chapter-numbering-start", `Chapter numbering starts at ${numbers[0]}, not 1`));
  }
  for (let index = 1;index < numbers.length; index += 1) {
    if (numbers[index] > numbers[index - 1] + 1) {
      warnings.push(warn("chapter-numbering-gap", `Chapter numbering skips from ${numbers[index - 1]} to ${numbers[index]}`));
    }
  }
}
function checkPromises(project, context, errors, warnings) {
  for (const promise of project.promises) {
    if (promise.status === "abandoned") {
      continue;
    }
    const label = relative(project, promise.file);
    const plantedNumber = context.chapterNumbers.get(promise.planted);
    if (scheduledOutOfOrder(context, promise.planted, promise.payoff)) {
      errors.push(err("promise-payoff-before-plant", `${label} pays off in ${promise.payoff} before it is planted in ${promise.planted}`, label));
    }
    if (promise.status === "paid-off" && !promise.payoff) {
      errors.push(err("promise-payoff-missing", `${label} is paid-off but has no payoff chapter`, label));
    }
    if (promise.status === "planted" && !promise.planted) {
      errors.push(err("promise-plant-missing", `${label} is planted but has no planted chapter`, label));
    }
    const stale = stalePlannedWarning(label, promise, context);
    if (stale) {
      warnings.push(warn("promise-stale-planned", stale, label));
    }
    const chekhov = chekhovWarning(label, promise.planted, plantedNumber, promise.payoff, referencedChapterNumber(context.chapterNumbers, promise.payoff), context);
    if (promise.status === "planted" && chekhov) {
      warnings.push(warn(chekhov.passed ? "promise-payoff-passed" : "promise-unpaid", chekhov.message, label));
    }
  }
}
function checkQuestions(project, context, errors) {
  for (const question of project.questions) {
    if (question.status === "abandoned") {
      continue;
    }
    const label = relative(project, question.file);
    if (scheduledOutOfOrder(context, question.introduced, question.resolved)) {
      errors.push(err("question-resolved-before-introduced", `${label} resolves in ${question.resolved} before it is introduced in ${question.introduced}`, label));
    }
    if ((question.status === "answered" || question.status === "resolved") && !question.resolved) {
      errors.push(err("question-resolution-missing", `${label} is ${question.status} but has no resolved chapter`, label));
    }
    if (question.status === "open" && question.resolved) {
      errors.push(err("question-open-but-resolved", `${label} records resolved chapter ${question.resolved} but status is still open`, label));
    }
  }
}
function checkStoryCompletion(project, errors) {
  if (project.story.data.status !== "complete") {
    return;
  }
  for (const promise of project.promises) {
    if (promise.status === "planned" || promise.status === "planted") {
      errors.push(err("complete-with-open-promise", `story.md is complete but ${relative(project, promise.file)} is still ${promise.status}`, "story.md"));
    }
  }
  for (const question of project.questions) {
    if (question.status === "open") {
      errors.push(err("complete-with-open-question", `story.md is complete but ${relative(project, question.file)} is still open`, "story.md"));
    }
  }
  for (const clue of project.clues) {
    if (clue.status === "planned" || clue.status === "planted") {
      errors.push(err("complete-with-open-clue", `story.md is complete but ${relative(project, clue.file)} is still ${clue.status}`, "story.md"));
    }
  }
}
function checkClues(project, context, errors, warnings) {
  for (const clue of project.clues) {
    if (clue.status === "abandoned") {
      continue;
    }
    const label = relative(project, clue.file);
    const plantedNumber = context.chapterNumbers.get(clue.planted);
    if (scheduledOutOfOrder(context, clue.planted, clue.payoff)) {
      errors.push(err("clue-payoff-before-plant", `${label} pays off in ${clue.payoff} before it is planted in ${clue.planted}`, label));
    }
    if (clue.status === "paid-off" && !clue.payoff) {
      errors.push(err("clue-payoff-missing", `${label} has status paid-off but no payoff chapter recorded`, label));
    }
    if (clue.status === "planted" && !clue.planted) {
      errors.push(err("clue-plant-missing", `${label} is planted but no plant chapter recorded`, label));
    }
    const stale = stalePlannedWarning(label, clue, context);
    if (stale) {
      warnings.push(warn("clue-stale-planned", stale, label));
    }
    const chekhov = chekhovWarning(label, clue.planted, plantedNumber, clue.payoff, referencedChapterNumber(context.chapterNumbers, clue.payoff), context);
    if (clue.status === "planted" && chekhov) {
      warnings.push(warn(chekhov.passed ? "clue-payoff-passed" : "clue-unpaid", chekhov.message, label));
    }
  }
}
function stalePlannedWarning(label, entry, context) {
  if (entry.status !== "planned" || !entry.planted || !context.draftedChapters.has(entry.planted)) {
    return "";
  }
  return `${label} records planted chapter ${entry.planted} but status is still planned`;
}
function scheduledOutOfOrder(context, first, second) {
  const firstNumber = referencedChapterNumber(context.chapterNumbers, first);
  const secondNumber = referencedChapterNumber(context.chapterNumbers, second);
  return firstNumber !== undefined && secondNumber !== undefined && secondNumber < firstNumber;
}
function referencedChapterNumber(chapterNumbers, id) {
  if (typeof id !== "string" || id === "") {
    return;
  }
  if (chapterNumbers.has(id)) {
    return chapterNumbers.get(id);
  }
  const match = /^chapter-(\d+)$/.exec(id);
  return match ? Number.parseInt(match[1], 10) : undefined;
}
function chekhovWarning(label, planted, plantedNumber, payoff, payoffNumber, context) {
  if (plantedNumber === undefined) {
    return null;
  }
  const latestChapter = context.latestChapter;
  const since = context.chapterNumberList.filter((number) => number > plantedNumber && number <= latestChapter).length;
  if (payoff && payoffNumber !== undefined) {
    const drafted = context.chapterNumbers.has(payoff) ? context.draftedChapters.has(payoff) : payoffNumber <= latestChapter;
    return drafted ? { passed: true, message: `${label} payoff chapter ${payoff} has passed and status is still planted` } : null;
  }
  if (since < CHEKHOV_CHAPTER_GAP) {
    return null;
  }
  return { passed: false, message: `${label} was planted in ${planted}, ${since} chapters ago, and has no payoff yet` };
}
function checkContinuityState(project, context, errors, warnings) {
  if (!project.continuity) {
    return;
  }
  const label = path4.join("continuity", "state.md");
  const data = project.continuity.data;
  const currentChapter = data["current-chapter"];
  if (Number.isInteger(currentChapter)) {
    if (currentChapter > context.highestChapter) {
      errors.push(err("current-chapter-ahead", `${label} current-chapter ${currentChapter} is ahead of the latest chapter ${context.highestChapter}`, label));
    } else if (currentChapter < context.latestChapter) {
      warnings.push(warn("current-chapter-behind", `${label} current-chapter ${currentChapter} is behind the latest chapter ${context.latestChapter}; update continuity state after drafting`, label));
    }
  }
  const seenCharacters = new Map;
  for (const [index, entry] of stateEntries(data["character-state"]).entries()) {
    const entryLabel = `${label} character-state[${index}]`;
    if (!requireMapping(entry, entryLabel, label, errors)) {
      continue;
    }
    const character = idText(entry.character);
    if (!character || !context.characters.has(character)) {
      errors.push(err("state-missing-character", `${entryLabel} references missing character ${character || "(unset)"}`, label));
    }
    if (character) {
      if (seenCharacters.has(character)) {
        warnings.push(warn("state-duplicate-character", `${entryLabel} repeats character ${character} from character-state[${seenCharacters.get(character)}]; keep one entry per character`, label));
      } else {
        seenCharacters.set(character, index);
      }
    }
    const location = idText(entry.location);
    if (location && !context.locations.has(location)) {
      errors.push(err("state-missing-location", `${entryLabel} references missing location ${location}`, label));
    }
  }
  const knownFacts = new Map;
  for (const [index, entry] of stateEntries(data["knowledge-state"]).entries()) {
    const entryLabel = `${label} knowledge-state[${index}]`;
    if (!requireMapping(entry, entryLabel, label, errors)) {
      continue;
    }
    const character = idText(entry.character);
    if (entry.fact !== undefined) {
      const fact = String(entry.fact);
      if (!isKebabId(fact)) {
        errors.push(err("state-fact-not-kebab", `${entryLabel} fact ${fact || "(empty)"} must be a kebab-case id`, label));
      } else if (character) {
        const key = `${character}\x00${fact}`;
        if (knownFacts.has(key)) {
          errors.push(err("state-duplicate-fact", `${entryLabel} repeats fact ${fact} for ${character} from knowledge-state[${knownFacts.get(key)}]`, label));
        } else {
          knownFacts.set(key, index);
        }
      }
    }
    if (!character || !context.characters.has(character)) {
      errors.push(err("state-missing-character", `${entryLabel} references missing character ${character || "(unset)"}`, label));
    }
    if (!entry.knows) {
      errors.push(err("state-missing-knows", `${entryLabel} is missing knows`, label));
    }
    const learnedIn = idText(entry["learned-in"]);
    if (learnedIn && !context.chapterNumbers.has(learnedIn)) {
      errors.push(err("state-missing-chapter", `${entryLabel} references missing chapter ${learnedIn}`, label));
    }
    checkPosthumousLearning(context.characters.get(character), learnedIn, entryLabel, label, context, errors, warnings);
  }
  const seenArtifacts = new Map;
  for (const [index, entry] of stateEntries(data["object-state"]).entries()) {
    const entryLabel = `${label} object-state[${index}]`;
    if (!requireMapping(entry, entryLabel, label, errors)) {
      continue;
    }
    const artifactId = idText(entry.artifact);
    const artifact = context.artifacts.get(artifactId);
    if (!artifactId || !artifact) {
      errors.push(err("state-missing-artifact", `${entryLabel} references missing artifact ${artifactId || "(unset)"}`, label));
    }
    const since = idText(entry.since);
    if (artifactId) {
      const key = `${artifactId}\x00${since}`;
      if (seenArtifacts.has(key)) {
        warnings.push(warn("state-duplicate-artifact", `${entryLabel} repeats artifact ${artifactId} from object-state[${seenArtifacts.get(key)}]; keep one entry per artifact${since ? ` per since chapter` : ""}`, label));
      } else {
        seenArtifacts.set(key, index);
      }
    }
    const owner = idText(entry.owner);
    if (owner && !context.characters.has(owner) && !context.factions.has(owner)) {
      errors.push(err("state-missing-owner", `${entryLabel} references missing owner ${owner}`, label));
    }
    const location = idText(entry.location);
    if (location && !context.locations.has(location)) {
      errors.push(err("state-missing-location", `${entryLabel} references missing location ${location}`, label));
    }
    if (since && !context.chapterNumbers.has(since)) {
      errors.push(err("state-missing-chapter", `${entryLabel} references missing since chapter ${since}`, label));
    }
    if (entry.status && artifact && artifact.status && entry.status !== artifact.status && latestObjectEntry(data, artifactId, context) === entry) {
      warnings.push(warn("state-status-conflict", `${entryLabel} status ${entry.status} conflicts with ${relative(project, artifact.file)} status ${artifact.status}`, label));
    }
  }
}
function checkPosthumousLearning(character, learnedIn, entryLabel, file, context, errors, warnings) {
  if (!character || !context.chapterNumbers.has(learnedIn)) {
    return;
  }
  const death = progressionDeathAt(character, learnedIn, context.chronology);
  if (death?.from === "") {
    warnings.push(warn("deceased-learning", `${entryLabel} has ${character.id} learn something in ${learnedIn}, but ${character.id} died before the story (deceased with no died-in)`, file, learnedIn));
  } else if (death) {
    warnings.push(warn("progression-deceased-learning", `${entryLabel} has ${character.id} learn something in ${learnedIn}, but their progressions make them deceased from ${death.from}`, file, learnedIn));
  }
  if (!character.diedIn) {
    return;
  }
  const window = deathWindow(character, context.chronology);
  if (window && window.deadIn(learnedIn)) {
    errors.push(err("posthumous-learning", `${entryLabel} has ${character.id} learn something in ${learnedIn}, after they died in ${character.diedIn}`, file, learnedIn));
  }
}
function checkSceneLearning(project, context, errors, warnings) {
  for (const scene of project.scenes) {
    for (const change of scene.stateChanges) {
      if (!change || typeof change !== "object" || Array.isArray(change) || change.knowledge === undefined) {
        continue;
      }
      const character = context.characters.get(idText(change.character));
      checkPosthumousLearning(character, scene.chapter, `${relative(project, scene.file)} state-change`, relative(project, scene.file), context, errors, warnings);
    }
  }
}
function checkStateAgainstStory(project, context, warnings) {
  if (!project.continuity) {
    return;
  }
  const label = path4.join("continuity", "state.md");
  const data = project.continuity.data;
  const { chronology } = context;
  const currentChapter = Number.isInteger(data["current-chapter"]) ? data["current-chapter"] : -Infinity;
  const tracked = (chapterId) => (context.chapterNumbers.get(chapterId) ?? Infinity) <= currentChapter;
  const windows = new Map;
  for (const character of project.characters) {
    const window = character.diedIn && !chronology.outline.has(character.diedIn) ? deathWindow(character, chronology) : null;
    if (window) {
      windows.set(character.id, window);
    }
  }
  const chaptersById = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
  const scenesOf = (chapterId) => project.scenes.filter((scene) => scene.chapter === chapterId).sort((left, right) => left.scene - right.scene || left.id.localeCompare(right.id, "en"));
  const inCast = (record, characterId) => record.characters.includes(characterId) || record.pov === characterId;
  const knowledge = [];
  for (const [index, entry] of stateEntries(data["knowledge-state"]).entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const character = idText(entry.character);
    const learnedIn = idText(entry["learned-in"]);
    knowledge.push({ index, character, learnedIn, fact: entry.fact === undefined ? "" : String(entry.fact), knows: normalizeKnowledge(entry.knows) });
    if (!character || !chaptersById.has(learnedIn)) {
      continue;
    }
    const entryLabel = `${label} knowledge-state[${index}]`;
    const chapter = chaptersById.get(learnedIn);
    if (chapter.status !== "outline" && !inCast(chapter, character) && !scenesOf(learnedIn).some((scene) => inCast(scene, character))) {
      warnings.push(warn("learner-not-in-cast", `${entryLabel} has ${character} learn something in ${learnedIn}, which does not list ${character} in characters or pov`, label, learnedIn));
    }
  }
  const unmatched = [];
  const used = new Set;
  for (const { unit: scene, isChapter } of readingUnits(project)) {
    if (isChapter || !tracked(scene.chapter)) {
      continue;
    }
    for (const change of scene.stateChanges) {
      if (!change || typeof change !== "object" || Array.isArray(change) || change.knowledge === undefined) {
        continue;
      }
      const character = idText(change.character);
      if (!character) {
        continue;
      }
      const known = knowledge.filter((entry) => entry.character === character && (entry.learnedIn === "" || context.chapterNumbers.has(entry.learnedIn) && !chronology.after(entry.learnedIn, scene.chapter)));
      const fact = change.fact === undefined ? "" : String(change.fact);
      const text = normalizeKnowledge(change.knowledge);
      const matches = known.filter((entry) => fact !== "" && entry.fact === fact || text !== "" && entry.knows === text);
      if (matches.length > 0) {
        matches.forEach((entry) => used.add(entry.index));
        continue;
      }
      unmatched.push({ scene, change, character, known });
    }
  }
  for (const { scene, change, character, known } of unmatched) {
    const pair = known.find((entry) => entry.learnedIn === scene.chapter && !used.has(entry.index));
    if (pair) {
      used.add(pair.index);
      continue;
    }
    warnings.push(warn("knowledge-not-recorded", `${relative(project, scene.file)} state-changes record ${character} learning "${String(change.knowledge).trim()}" but ${label} has no knowledge-state entry for it learned by ${scene.chapter}`, relative(project, scene.file), chapterOf(scene)));
  }
  const current = project.chapters.find((chapter) => chapter.number === currentChapter);
  for (const [index, entry] of stateEntries(data["character-state"]).entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const character = idText(entry.character);
    const entryLabel = `${label} character-state[${index}]`;
    const window = windows.get(character);
    if (window && current && (current.id === window.died || window.deadIn(current.id))) {
      warnings.push(warn("state-tracks-dead-character", `${entryLabel} tracks ${character}, who died in ${window.died}; remove the entry once they are dead`, label, current.id));
      continue;
    }
    const deadFrom = context.characters.has(character) && current ? progressionDeathFrom(context.characters.get(character), current.id, chronology) : null;
    if (deadFrom && !chronology.outline.has(deadFrom) && chronology.numbers.has(deadFrom)) {
      warnings.push(warn("state-tracks-dead-character", `${entryLabel} tracks ${character}, whose progressions make them deceased from ${deadFrom}; remove the entry once they are dead`, label, current.id));
      continue;
    }
    const location = idText(entry.location);
    if (!current || !location) {
      continue;
    }
    const last = scenesOf(current.id).filter((scene) => inCast(scene, character) && scene.location).pop();
    if (last && last.location !== location && !current.locations.includes(location)) {
      warnings.push(warn("state-location-drift", `${entryLabel} puts ${character} at ${location}, but their last scene in ${current.id}, ${relative(project, last.file)}, is at ${last.location} and the chapter does not list ${location}`, label, current.id));
    }
  }
  const lastSet = new Map;
  for (const { unit: scene, isChapter } of readingUnits(project)) {
    if (isChapter || !tracked(scene.chapter)) {
      continue;
    }
    for (const change of scene.stateChanges) {
      if (!change || typeof change !== "object" || Array.isArray(change)) {
        continue;
      }
      const artifact = idText(change.target);
      for (const field of ["owner", "location"]) {
        if (artifact && context.artifacts.has(artifact) && idText(change[field]) !== "") {
          lastSet.set(`${artifact}\x00${field}`, { artifact, field, value: idText(change[field]), scene });
        }
      }
    }
  }
  for (const { artifact, field, value, scene } of lastSet.values()) {
    const entry = latestObjectEntry(data, artifact, context);
    if (!entry) {
      warnings.push(warn("object-not-recorded", `${relative(project, scene.file)} state-changes set ${artifact} ${field} ${value} but ${label} has no object-state entry for ${artifact}`, relative(project, scene.file), chapterOf(scene)));
      continue;
    }
    const since = idText(entry.since);
    const newer = since !== "" && context.chapterNumbers.has(since) && chronology.after(since, scene.chapter);
    const stated = idText(entry[field]);
    if (!newer && stated !== value) {
      const index = stateEntries(data["object-state"]).indexOf(entry);
      warnings.push(warn("state-object-drift", `${label} object-state[${index}] gives ${artifact} ${field} ${stated || "(unset)"}, but ${relative(project, scene.file)} state-changes last set it to ${value}`, label, chapterOf(scene)));
    }
  }
}
function normalizeKnowledge(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, "") : "";
}
function latestObjectEntry(data, artifactId, context) {
  let latest = null;
  let latestSince = "";
  for (const entry of stateEntries(data["object-state"])) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || idText(entry.artifact) !== artifactId) {
      continue;
    }
    const since = context.chapterNumbers.has(idText(entry.since)) ? idText(entry.since) : "";
    if (latest === null || compareSince(since, latestSince, context) >= 0) {
      latest = entry;
      latestSince = since;
    }
  }
  return latest;
}
function compareSince(left, right, context) {
  if (left === "" || right === "") {
    return (left === "" ? 0 : 1) - (right === "" ? 0 : 1);
  }
  const { after } = context.chronology;
  return after(left, right) ? 1 : after(right, left) ? -1 : 0;
}
function idText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}
function castIncludes(record, characterId) {
  return record.characters.includes(characterId) || record.pov === characterId && !record.mentions.includes(characterId);
}
function stateEntries(value) {
  return Array.isArray(value) ? value : [];
}
function isKebabId(value) {
  return value !== "" && value === kebabCase(value);
}
function requireMapping(entry, entryLabel, file, errors) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(err("entry-not-mapping", `${entryLabel} must be a mapping`, file));
    return false;
  }
  return true;
}
function relative(project, file) {
  return path4.relative(project.root, file);
}
function chapterOf(record) {
  const id = record.chapter !== undefined ? idText(record.chapter) : record.id;
  return id === "" ? null : id;
}
function checkPropCustody(project, context, errors) {
  const { after } = context.chronology;
  for (const { artifact, since, beforeStory, until } of goneWindows(project, context)) {
    const inWindow = (chapterId) => context.chapterNumbers.has(chapterId) && (beforeStory || after(chapterId, since)) && (until === "" || after(until, chapterId));
    for (const scene of project.scenes) {
      if (!inWindow(scene.chapter)) {
        continue;
      }
      const sceneLabel = relative(project, scene.file);
      if (scene.stateChanges.some((change) => stateChangeTargets(change, artifact))) {
        errors.push(err("gone-artifact-used", `${sceneLabel} uses ${artifact}, destroyed/lost ${beforeStory ? "before the story" : `since ${since}`}`, sceneLabel, chapterOf(scene)));
      }
      if (!beforeStory && scene.mentions.includes(artifact)) {
        errors.push(err("gone-artifact-mentioned", `${sceneLabel} mentions ${artifact}, destroyed/lost since ${since}`, sceneLabel, chapterOf(scene)));
      }
    }
    for (const chapter of project.chapters) {
      if (beforeStory || !inWindow(chapter.id)) {
        continue;
      }
      if (chapter.mentions.includes(artifact)) {
        errors.push(err("gone-artifact-mentioned", `${relative(project, chapter.file)} mentions ${artifact}, destroyed/lost since ${since}`, relative(project, chapter.file), chapter.id));
      }
    }
  }
}
function goneWindows(project, context) {
  const histories = new Map;
  for (const entry of project.continuity ? stateEntries(project.continuity.data["object-state"]) : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const artifact = idText(entry.artifact);
    const since = idText(entry.since);
    if (artifact === "" || since !== "" && !context.chapterNumbers.has(since)) {
      continue;
    }
    const status = String(entry.status ?? "").trim().toLowerCase();
    const list = histories.get(artifact) ?? [];
    list.push({ since, destroyed: status === "destroyed", gone: status === "destroyed" || status === "lost" });
    histories.set(artifact, list);
  }
  const windows = [];
  for (const [artifact, history] of histories) {
    history.sort((left, right) => compareSince(left.since, right.since, context));
    let open = null;
    for (const entry of history) {
      if (entry.gone && open === null) {
        open = { artifact, since: entry.since, beforeStory: entry.since === "", until: "", destroyed: entry.destroyed };
        windows.push(open);
      } else if (entry.gone) {
        open.destroyed ||= entry.destroyed;
      } else if (open !== null && !open.destroyed && compareSince(entry.since, open.since, context) > 0) {
        open.until = entry.since;
        open = null;
      }
    }
  }
  return windows;
}
function stateChangeTargets(change, artifact) {
  if (!change || typeof change !== "object" || Array.isArray(change)) {
    return false;
  }
  return idText(change.target) === artifact;
}
var TIME_RANKS = new Map([
  ["dawn", 300],
  ["morning", 420],
  ["midday", 720],
  ["afternoon", 900],
  ["evening", 1140],
  ["night", 1380]
]);
function checkClock(project, errors, warnings) {
  for (const scene of project.scenes) {
    const label = relative(project, scene.file);
    if (scene.date !== "" && !parseClockDate(scene.date)) {
      warnings.push(warn("malformed-date", `${label} has malformed date "${scene.date}"`, label, chapterOf(scene)));
    }
    if (scene.time !== "" && parseClockTime(scene.time) === undefined) {
      warnings.push(warn("malformed-time", `${label} has malformed time "${scene.time}"`, label, chapterOf(scene)));
    }
    if (scene.travelHours < 0) {
      warnings.push(warn("negative-travel-hours", `${label} has negative travel-hours ${scene.travelHours}`, label, chapterOf(scene)));
    }
    if (scene.date === "" && scene.travelHours > 0) {
      warnings.push(warn("travel-hours-undated", `${label} has travel-hours but no date, so the clock check skips it`, label, chapterOf(scene)));
    }
  }
  for (const chapter of project.chapters) {
    if (chapter.date !== "" && !parseClockDate(chapter.date)) {
      warnings.push(warn("malformed-date", `Chapter ${chapter.number} has malformed date "${chapter.date}"`, relative(project, chapter.file), chapter.id));
    }
    if (chapter.time !== "" && parseClockTime(chapter.time) === undefined) {
      warnings.push(warn("malformed-time", `Chapter ${chapter.number} has malformed time "${chapter.time}"`, relative(project, chapter.file), chapter.id));
    }
  }
  const strands = new Map;
  for (const { unit, chapter, isChapter } of readingUnits(project)) {
    const strand = String(chapter.strand ?? "");
    if (!strands.has(strand)) {
      strands.set(strand, []);
    }
    const stamps = strands.get(strand);
    const parsed = unit.date === "" ? undefined : parseClockDate(unit.date);
    if (!parsed) {
      continue;
    }
    const minutes = parseClockTime(unit.time);
    stamps.push({
      label: isChapter ? `Chapter ${unit.number}` : relative(project, unit.file),
      file: relative(project, unit.file),
      chapter: chapter.id || null,
      isChapter,
      date: parsed.text,
      time: minutes === undefined ? "" : unit.time.trim(),
      days: parsed.days,
      minutes,
      ...sceneWindow(parsed.days, unit.time),
      travelHours: isChapter ? 0 : unit.travelHours,
      flashback: !isChapter && unit.flashbackTo !== ""
    });
  }
  for (const stamps of strands.values()) {
    checkClockOrder(stamps, errors, warnings);
  }
  checkRouteTravel(project, errors);
}
function readingUnits(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const scenesByChapter = new Map;
  for (const scene of project.scenes) {
    const list = scenesByChapter.get(scene.chapter) ?? [];
    list.push(scene);
    scenesByChapter.set(scene.chapter, list);
  }
  const groups = chapters.map((chapter) => ({ chapter, orphan: false }));
  const known = new Set(chapters.map((chapter) => chapter.id));
  for (const chapterId of scenesByChapter.keys()) {
    if (!known.has(chapterId)) {
      const match = /^chapter-(\d+)$/.exec(chapterId);
      const number = match ? Number.parseInt(match[1], 10) : Infinity;
      groups.push({ chapter: { id: chapterId, number, title: chapterId, pov: "", locations: [] }, orphan: true });
    }
  }
  groups.sort((left, right) => left.chapter.number - right.chapter.number || 0 || Number(left.orphan) - Number(right.orphan) || left.chapter.id.localeCompare(right.chapter.id, "en"));
  const units = [];
  for (const { chapter, orphan } of groups) {
    const scenes = (scenesByChapter.get(chapter.id) ?? []).sort((left, right) => left.scene - right.scene || left.id.localeCompare(right.id, "en"));
    if (scenes.length === 0) {
      units.push({ unit: chapter, chapter, isChapter: true, orphan });
    }
    for (const scene of scenes) {
      units.push({ unit: scene, chapter, isChapter: false, orphan });
    }
  }
  return units;
}
function checkClockOrder(stamps, errors, warnings) {
  let reference = null;
  let preceding = null;
  let candidate = null;
  for (const current of stamps) {
    if (reference === null) {
      reference = current;
      continue;
    }
    if (!runsBackward(current, reference)) {
      checkTravelHours(current, reference, errors);
      const next = advanceClock(reference, current);
      if (next !== reference) {
        preceding = reference;
        reference = next;
      }
      candidate = null;
      continue;
    }
    if (candidate && !current.flashback && !runsBackward(current, candidate) && (preceding === null || !runsBackward(candidate, preceding))) {
      checkTravelHours(current, candidate, errors);
      preceding = candidate;
      reference = advanceClock(candidate, current);
      candidate = null;
      continue;
    }
    warnings.push(backwardFinding(current, reference));
    if (!current.flashback) {
      candidate = current;
    }
  }
}
function runsBackward(current, reference) {
  return current.latest < reference.earliest;
}
function advanceClock(reference, current) {
  return current.earliest <= reference.earliest ? reference : current;
}
function backwardFinding(current, reference) {
  if (!current.isChapter) {
    return warn("clock-backward", `${current.label} timestamp runs backward`, current.file, current.chapter);
  }
  const sameDay = current.days === reference.days;
  const when = (stamp) => sameDay && stamp.time ? `${stamp.date} ${stamp.time}` : stamp.date;
  return warn("clock-backward", `${current.label} date ${when(current)} is earlier than ${reference.label} date ${when(reference)}`, current.file, current.chapter);
}
function checkTravelHours(current, reference, errors) {
  if (!(current.travelHours > 0) || current.minutes === undefined || reference.minutes === undefined) {
    return;
  }
  const elapsedHours = (current.latest - reference.earliest) / 60;
  if (elapsedHours < current.travelHours - 0.000000001) {
    const gap = current.exact && reference.exact ? `only ${formatHours(elapsedHours, Math.floor)}` : `at most ${formatHours(elapsedHours, Math.floor)}`;
    errors.push(err("travel-too-fast", `${current.label} allows ${gap} for travel of ${current.travelHours}h`, current.file, current.chapter));
  }
}
var TIME_RANGES = new Map([
  ["dawn", [240, 419]],
  ["morning", [300, 719]],
  ["midday", [660, 839]],
  ["afternoon", [720, 1079]],
  ["evening", [1020, 1319]],
  ["night", [1200, 1439]]
]);
function sceneWindow(days, time) {
  const text = String(time ?? "").trim().toLowerCase();
  const named = TIME_RANGES.get(text);
  const exact = named === undefined ? parseClockTime(text) : undefined;
  const [from, to] = named ?? (exact === undefined ? [0, 1439] : [exact, exact]);
  return { earliest: days * 1440 + from, latest: days * 1440 + to, exact: exact !== undefined };
}
function checkRouteTravel(project, errors) {
  const graph = routeGraph(project.locations);
  const chapterPov = new Map(project.chapters.map((chapter) => [chapter.id, idText(chapter.pov)]));
  const sightings = new Map;
  for (const scene of project.scenes) {
    const parsed = parseClockDate(scene.date);
    if (!parsed || scene.location === "") {
      continue;
    }
    const window = sceneWindow(parsed.days, scene.time);
    const present = new Set(scene.characters.map(idText).filter((id) => id !== ""));
    const pov = idText(scene.pov) || chapterPov.get(scene.chapter) || "";
    if (pov !== "") {
      present.add(pov);
    }
    for (const characterId of present) {
      const list = sightings.get(characterId) ?? [];
      list.push({ scene, label: relative(project, scene.file), ...window });
      sightings.set(characterId, list);
    }
  }
  const routesFrom = new Map;
  const distance = (from, to) => {
    if (!routesFrom.has(from)) {
      routesFrom.set(from, shortestRoutesFrom(graph, from));
    }
    return routesFrom.get(from).get(to);
  };
  let longestRoute = 0;
  for (const edges of graph.values()) {
    for (const hours of edges.values()) {
      longestRoute += hours;
    }
  }
  for (const [characterId, list] of [...sightings.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    list.sort((left, right) => left.earliest - right.earliest || left.latest - right.latest || left.label.localeCompare(right.label, "en"));
    for (let index = 1;index < list.length; index += 1) {
      const current = list[index];
      for (let back = index - 1;back >= 0; back -= 1) {
        const previous = list[back];
        const forwardGap = (current.latest - previous.earliest) / 60;
        if (forwardGap > 0 && forwardGap >= longestRoute) {
          break;
        }
        const from = previous.scene.location;
        const to = current.scene.location;
        if (from === to) {
          continue;
        }
        const elapsed = Math.max(forwardGap, (previous.latest - current.earliest) / 60);
        const needed = graph.has(from) && graph.has(to) ? distance(from, to) : undefined;
        if (needed === undefined && elapsed === 0 && previous.exact && current.exact) {
          errors.push(err("route-same-time", `${current.label} puts ${characterId} at ${to} at the same time as ${previous.label} at ${from}`, current.label, chapterOf(current.scene)));
          break;
        }
        if (needed !== undefined && elapsed < needed - 0.000000001) {
          const gap = previous.exact && current.exact ? formatHours(elapsed, Math.floor) : `at most ${formatHours(elapsed, Math.floor)}`;
          errors.push(err("route-too-fast", `${current.label} puts ${characterId} at ${to} ${gap} after ${previous.label} at ${from}, but the fastest route takes ${formatHours(needed, Math.ceil)}`, current.label, chapterOf(current.scene)));
          break;
        }
      }
    }
  }
}
function usableRoutes(locations) {
  const known = new Set(locations.map((location) => location.id));
  const fastest = new Map;
  for (const location of locations) {
    for (const route of location.routes ?? []) {
      if (!route || typeof route !== "object" || Array.isArray(route)) {
        continue;
      }
      const to = idText(route.to);
      if (!known.has(to) || to === location.id || typeof route.hours !== "number" || !Number.isFinite(route.hours) || route.hours <= 0) {
        continue;
      }
      const key = `${location.id}>${to}`;
      if (!fastest.has(key) || fastest.get(key).hours > route.hours) {
        fastest.set(key, { from: location.id, to, hours: route.hours, mode: typeof route.mode === "string" ? route.mode : "" });
      }
    }
  }
  return [...fastest.values()];
}
function routeGraph(locations) {
  const graph = new Map;
  const addEdge = (from, to, hours) => {
    if (!graph.has(from)) {
      graph.set(from, new Map);
    }
    const edges = graph.get(from);
    if (!edges.has(to) || edges.get(to) > hours) {
      edges.set(to, hours);
    }
  };
  const routes = usableRoutes(locations);
  const declared = new Set(routes.map((route) => `${route.from}>${route.to}`));
  for (const { from, to, hours } of routes) {
    addEdge(from, to, hours);
    if (!declared.has(`${to}>${from}`)) {
      addEdge(to, from, hours);
    }
  }
  return graph;
}
function shortestRoutesFrom(graph, from) {
  const distances = new Map([[from, 0]]);
  const heap = [[0, from]];
  const push = (entry) => {
    heap.push(entry);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = index - 1 >> 1;
      if (heap[parent][0] <= heap[index][0]) {
        break;
      }
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let index = 0;
      for (;; ) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < heap.length && heap[left][0] < heap[smallest][0]) {
          smallest = left;
        }
        if (right < heap.length && heap[right][0] < heap[smallest][0]) {
          smallest = right;
        }
        if (smallest === index) {
          break;
        }
        [heap[smallest], heap[index]] = [heap[index], heap[smallest]];
        index = smallest;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [best, current] = pop();
    if (best > distances.get(current)) {
      continue;
    }
    for (const [next, hours] of graph.get(current) ?? []) {
      if (!distances.has(next) || best + hours < distances.get(next)) {
        distances.set(next, best + hours);
        push([best + hours, next]);
      }
    }
  }
  return distances;
}
function formatHours(hours, round = Math.round) {
  return `${round(Math.round(hours * 1e6) / 1e5) / 10}h`;
}
function storyDateError(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "";
  }
  if (!parseClockDate(String(value))) {
    return `date must be a real YYYY-MM-DD calendar day, got ${value}`;
  }
  return "";
}
function storyTimeError(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "";
  }
  if (parseClockTime(String(value)) === undefined) {
    return `time must be HH:MM or a named part of day (dawn, morning, midday, afternoon, evening, night), got ${value}`;
  }
  return "";
}
function parseClockDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year, month - 1, day);
  const days = date.getTime() / 86400000;
  const roundtrip = new Date(days * 86400000);
  if (roundtrip.getUTCFullYear() !== year || roundtrip.getUTCMonth() !== month - 1 || roundtrip.getUTCDate() !== day) {
    return;
  }
  return { text: value.trim(), days };
}
function parseClockTime(value) {
  const text = value.trim().toLowerCase();
  if (text === "") {
    return;
  }
  const named = TIME_RANKS.get(text);
  if (named !== undefined) {
    return named;
  }
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) {
    return;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return;
  }
  return hours * 60 + minutes;
}

// src/chronology.js
function chapterChronology(project) {
  const numbers = new Map(project.chapters.map((chapter) => [chapter.id, chapter.number]));
  const days = new Map;
  for (const chapter of project.chapters) {
    const parsed = parseClockDate(String(chapter.date ?? ""));
    if (parsed) {
      days.set(chapter.id, parsed.days);
    }
  }
  const sceneDays = new Map;
  for (const scene of project.scenes) {
    const parsed = parseClockDate(String(scene.date ?? ""));
    if (parsed && numbers.has(scene.chapter) && !days.has(scene.chapter)) {
      sceneDays.set(scene.chapter, Math.min(sceneDays.get(scene.chapter) ?? Infinity, parsed.days));
    }
  }
  for (const [id, value] of sceneDays) {
    days.set(id, value);
  }
  const outline = new Set(project.chapters.filter((chapter) => chapter.status === "outline").map((chapter) => chapter.id));
  return { ...chronologyFrom(numbers, days), outline };
}
function chronologyFrom(numbers, days) {
  const after = (later, earlier) => {
    const laterDays = days.get(later);
    const earlierDays = days.get(earlier);
    if (laterDays !== undefined && earlierDays !== undefined && laterDays !== earlierDays) {
      return laterDays > earlierDays;
    }
    return numbers.get(later) > numbers.get(earlier);
  };
  return { numbers, days, after };
}
function renumberedChronology(chronology, oldId, newId, number) {
  const numbers = new Map(chronology.numbers);
  const days = new Map(chronology.days);
  numbers.delete(oldId);
  numbers.set(newId, number);
  if (days.has(oldId)) {
    days.set(newId, days.get(oldId));
    days.delete(oldId);
  }
  return chronologyFrom(numbers, days);
}
function deathWindow(character, chronology) {
  const died = character.diedIn;
  if (!died || !chronology.numbers.has(died)) {
    return null;
  }
  const revived = character.revivedIn && chronology.numbers.has(character.revivedIn) ? character.revivedIn : "";
  return {
    died,
    revived,
    deadIn(chapterId) {
      if (!chronology.numbers.has(chapterId) || !chronology.after(chapterId, died)) {
        return false;
      }
      return revived === "" || chronology.after(revived, chapterId);
    }
  };
}

// src/context.js
var DEFAULT_CONTEXT_BUDGET = 6000;
var DEFAULT_CONTEXT_SCENES = 5;
function estimateTokens(text) {
  const words = String(text).split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 4 / 3);
}
var STORY_SECTIONS = ["Tone & Style", "Setting", "Central Conflict"];
var CARD_SECTIONS = ["Appearance", "Personality & Traits", "Motivations & Goals", "Voice & Speech Patterns"];
var THREAD_SECTIONS = { promise: "Setup", clue: "Clue", question: "Question" };
var PLACEHOLDERS = new Set([
  "Add notes on the story's voice, texture, and emotional register.",
  "Add physical details that matter on the page.",
  "Add behavior, temperament, habits, and contradictions.",
  "External want, internal need, and the conflict between them.",
  "Add 2-3 example lines.",
  "What this scene changes.",
  "What is promised to the reader.",
  "What the reader sees and why it matters.",
  "What the reader or continuity tracker needs answered.",
  `1. Opening beat
2. Escalation
3. Turn or decision`,
  "The book's house decisions, kept the way a copyeditor keeps them. Read this before drafting or revising prose. `story prose` enforces the lists in the frontmatter: `dialect` (british, american, or unspecified) flags the other dialect's common spellings, each `preferred` entry flags its `avoid` form, `watch-words` are counted in every chapter, and `allow-words` silences a built-in filter word or adverb. Add a `samples` list of your own prose (`../book-one`, approved chapters) and `story prose` compares each chapter with it instead of fixed limits.",
  "The book's house decisions, kept the way a copyeditor keeps them. Read this before drafting or revising prose. `story prose` enforces the lists in the frontmatter: `dialect` (british, american, or unspecified) flags the other dialect's common spellings, each `preferred` entry flags its `avoid` form, `watch-words` are counted in every chapter, and `allow-words` silences a built-in filter word or adverb.",
  "Narrative distance, sentence rhythm, register, and what this prose never does. Quote two or three sentences that sound exactly right.",
  "Record one `preferred` entry per variant (`use: grey`, `avoid: gray`) and note usage rules here.",
  "Titles, ranks, institutions, invented terms, and deities. Invented terms also belong in the glossary.",
  "Spelled-out or numerals, and how in-world dates and times are written.",
  "Quote marks, dash style, ellipses, italics for thought or foreign words, and the default dialogue tags.",
  "One entry per POV character or major speaker: vocabulary, sentence length, verbal tics, and words they never use.",
  "Why each `watch-words` entry is there."
]);
function section(body, heading) {
  const text = extractSection(body, heading);
  return PLACEHOLDERS.has(text) ? "" : text;
}
function list(values) {
  return values.map((value) => String(value)).filter(Boolean).join(", ");
}
function field(label, value) {
  const text = Array.isArray(value) ? list(value) : String(value ?? "").trim();
  return text === "" ? null : `- ${label}: ${text}`;
}
function lines(...parts) {
  return parts.filter((part) => part !== null).join(`
`);
}
function subsection(heading, text) {
  return text === "" ? null : `
#### ${heading}

${demote(text)}`;
}
function styleRules(body) {
  return body.replace(/^\s*#[ \t][^\n]*\n/, "").split(/^(?=##[ \t])/m).map((part) => {
    const heading = /^##[ \t]+([^\n]*)\n?/.exec(part);
    const text = (heading ? part.slice(heading[0].length) : part).trim();
    if (text === "" || PLACEHOLDERS.has(text)) {
      return null;
    }
    return heading ? `#### ${heading[1].trim()}

${demote(text)}` : demote(text);
  }).filter((part) => part !== null).join(`

`);
}
function demote(text) {
  return text.replace(/^(#{1,4})(?=[ \t])/gm, "##$1");
}
function indented(text) {
  return text === "" ? null : text.split(`
`).map((line) => `  ${line}`.trimEnd()).join(`
`);
}
function item(id, label, source, text) {
  return { id, label, source, text, tokens: estimateTokens(text) };
}
function resolveTarget(project, targetId) {
  const chapter = project.chapters.find((entry) => entry.id === targetId);
  if (chapter) {
    return { kind: "chapter", id: chapter.id, chapter, scene: null };
  }
  const scene = project.scenes.find((entry) => entry.id === targetId);
  if (!scene) {
    throw usageError(`Unknown chapter or scene ${targetId}`);
  }
  const owner = project.chapters.find((entry) => entry.id === scene.chapter);
  if (!owner) {
    throw projectError(`Scene ${targetId} belongs to unknown chapter ${scene.chapter}`);
  }
  return { kind: "scene", id: scene.id, chapter: owner, scene };
}
function entityStateAtTarget(frontmatter, chronology, chapterId) {
  const targetNumber = chronology.numbers.get(chapterId);
  const readBy = (from) => {
    const id = idText(from);
    const number = chronology.numbers.has(id) ? chronology.numbers.get(id) : Number(/^chapter-(\d+)$/.exec(id)?.[1]);
    return number <= targetNumber;
  };
  const data = frontmatter ?? {};
  const progressions = asList(data.progressions).filter((entry) => isMapping(entry) && readBy(entry.from));
  return entityStateAt({ ...data, progressions }, chapterId, chronology);
}
function characterStateAt(character, chronology, chapterId) {
  const { state, changes } = entityStateAtTarget(character.frontmatter, chronology, chapterId);
  return { status: statusAt(character, state, changes, chronology, chapterId), state, changes };
}
function statusAt(character, state, changes, chronology, chapterId) {
  const died = String(character.diedIn ?? "");
  const status = String(state.status ?? character.status ?? "");
  if (died === "") {
    return status === "deceased" && !changes.some((change) => change.field === "status") ? "" : status;
  }
  if (died === chapterId) {
    return "dies in this chapter";
  }
  const readBy = (id) => chronology.numbers.has(id) && chronology.numbers.get(id) <= chronology.numbers.get(chapterId);
  const deadIn = (revivedIn) => {
    const window = deathWindow({ ...character, revivedIn }, chronology);
    return window !== null && window.deadIn(chapterId);
  };
  const revivedIn = String(character.revivedIn ?? "");
  const deadNow = deadIn(readBy(revivedIn) ? revivedIn : "");
  if (revivedIn !== "" && !readBy(revivedIn) && deadNow !== deadIn(revivedIn)) {
    return "";
  }
  if (!readBy(died)) {
    return deadNow ? "" : "alive";
  }
  return deadNow ? `deceased (died in ${died})` : "alive";
}
function changeLines(changes, chapterId) {
  return changes.map((change) => `- From ${change.from === chapterId ? "this chapter" : change.from}: ${change.field} ${change.value}`);
}
function listOf(value) {
  return Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
}
function buildContext(project, targetId, readBody, options = {}) {
  const budget = options.budget ?? DEFAULT_CONTEXT_BUDGET;
  const sceneLimit = options.scenes ?? DEFAULT_CONTEXT_SCENES;
  const target = resolveTarget(project, targetId);
  const chronology = chapterChronology(project);
  const targetNumber = target.chapter.number;
  const upToTarget = (chapterId) => chronology.numbers.has(chapterId) && chronology.numbers.get(chapterId) <= targetNumber;
  const characters = new Map(project.characters.map((character) => [character.id, character]));
  const nameOf = (id) => characters.has(id) ? `${characters.get(id).name} (${id})` : id;
  const unit = target.scene ?? target.chapter;
  const pov = idText(unit.pov) || idText(target.chapter.pov);
  const cast = [...new Set([pov, ...unit.characters.map(idText)].filter(Boolean))];
  const relative = (file) => path5.relative(project.root, file);
  const statePath = path5.join("continuity", "state.md");
  const sections = [];
  const chapterBody = readBody(target.chapter.file);
  const chapterScenes = project.scenes.filter((scene) => scene.chapter === target.chapter.id);
  const targetLines = [
    `### ${target.kind === "scene" ? `Scene ${target.scene.scene} of ` : ""}Chapter ${targetNumber}: ${target.chapter.title}`,
    field("Scene", target.scene ? target.scene.title : ""),
    field("POV", pov === "" ? "" : nameOf(pov)),
    field("On the page", cast.map(nameOf)),
    field("Mentioned", unit.mentions.map(idText).map(nameOf)),
    field("Locations", target.scene ? [idText(target.scene.location)] : target.chapter.locations.map(idText)),
    field("Arcs advanced", unit.arcsAdvanced),
    field("Date", [unit.date, unit.time].filter(Boolean).join(" ")),
    field("Outcome", target.scene ? target.scene.outcome : ""),
    field("Hook", target.chapter.hook),
    field("Target words", target.chapter.targetWords || "")
  ];
  const outline = extractSection(chapterBody, "Outline").split(/^[ \t]*(?:-{3,}|\*{3,})[ \t]*$/m)[0].trim();
  if (outline !== "" && !PLACEHOLDERS.has(outline)) {
    targetLines.push("", "Chapter outline:", "", outline);
  }
  if (target.scene) {
    const purpose = section(readBody(target.scene.file), "Purpose");
    if (purpose !== "") {
      targetLines.push("", "Scene purpose:", "", purpose);
    }
  } else if (chapterScenes.length > 0) {
    targetLines.push("", "Scenes planned:", "", ...chapterScenes.map((scene) => `${scene.scene}. ${scene.title}${scene.outcome ? ` (outcome: ${scene.outcome})` : ""}`));
  }
  sections.push({ id: "target", title: "Target", items: [item(`target:${target.id}`, "Target", [target.chapter, target.scene].filter(Boolean).map((entry) => relative(entry.file)).join(", "), lines(...targetLines))] });
  const essentials = [];
  const story = project.story.data;
  const storyText = lines(`### ${project.title}`, field("Genre", [story.genre, story["sub-genre"]].filter(Boolean).join(" / ")), field("Setting era", story["setting-era"]), field("POV", story.pov), field("Tense", story.tense), field("Form", story.form), field("Themes", Array.isArray(story.themes) ? story.themes : [story.themes].filter(Boolean)), field("Premise", story.premise), ...STORY_SECTIONS.map((heading) => subsection(heading, section(project.story.body ?? "", heading))));
  essentials.push(item("story", "story.md essentials", "story.md", storyText));
  if (project.styleSheet) {
    const data = project.styleSheet.data;
    const preferred = (Array.isArray(data.preferred) ? data.preferred : []).filter((entry) => isMapping(entry) && typeof entry.use === "string" && typeof entry.avoid === "string").map((entry) => `${entry.use} (not ${entry.avoid})`);
    const body = styleRules(project.styleSheet.body);
    essentials.push(item("style-sheet", "Style sheet", relative(project.styleSheet.file), lines("### Style sheet", field("Dialect", data.dialect), field("Preferred", preferred), field("Watch words", Array.isArray(data["watch-words"]) ? data["watch-words"] : []), body === "" ? null : `
${body}`)));
  }
  sections.push({ id: "essentials", title: "Story essentials", items: essentials });
  const povItems = [];
  if (pov !== "") {
    const known = [];
    for (const entry of project.continuity ? asList(project.continuity.data["knowledge-state"]) : []) {
      if (!isMapping(entry) || idText(entry.character) !== pov || String(entry.knows ?? "").trim() === "") {
        continue;
      }
      const learnedIn = idText(entry["learned-in"]);
      if (learnedIn === "") {
        known.push(`- ${entry.knows} (before the story)`);
      } else if (upToTarget(learnedIn) && !chronology.after(learnedIn, target.chapter.id)) {
        known.push(`- ${entry.knows} (learned in ${learnedIn !== target.chapter.id ? learnedIn : target.scene ? "this chapter, possibly in a later scene" : "this chapter"})`);
      }
    }
    if (known.length > 0) {
      povItems.push(item(`knowledge:${pov}`, `What ${nameOf(pov)} knows`, statePath, lines(`### What ${nameOf(pov)} knows`, ...known)));
    }
    const state = [];
    const stateSources = new Set;
    const currentChapter = project.continuity ? Number(project.continuity.data["current-chapter"]) : NaN;
    if (Number.isInteger(currentChapter) && currentChapter < targetNumber) {
      for (const entry of asList(project.continuity.data["character-state"])) {
        if (isMapping(entry) && idText(entry.character) === pov) {
          state.push(`- As of chapter ${currentChapter}: ${describeMapping(entry, ["character"])}`);
          stateSources.add(statePath);
        }
      }
    }
    for (const scene of earlierScenes(project, target, upToTarget)) {
      for (const change of scene.stateChanges) {
        if (isMapping(change) && (idText(change.character) === pov || idText(change.owner) === pov)) {
          state.push(`- ${scene.chapter} scene ${scene.scene}: ${describeMapping(change, ["character"])}`);
          stateSources.add(relative(scene.file));
        }
      }
    }
    const povCharacter = characters.get(pov);
    if (povCharacter) {
      const { changes } = characterStateAt(povCharacter, chronology, target.chapter.id);
      if (changes.length > 0) {
        state.push(...changeLines(changes, target.chapter.id));
        stateSources.add(relative(povCharacter.file));
      }
    }
    if (state.length > 0) {
      povItems.push(item(`state:${pov}`, `${nameOf(pov)}'s state`, [...stateSources].join(", "), lines(`### ${nameOf(pov)}'s state`, ...state)));
    }
  }
  sections.push({ id: "pov", title: "POV knowledge and state", items: povItems });
  const cards = [];
  for (const id of cast) {
    const character = characters.get(id);
    if (!character) {
      continue;
    }
    const body = readBody(character.file);
    const state = characterStateAt(character, chronology, target.chapter.id);
    const changes = id === pov ? [] : changeLines(state.changes, target.chapter.id);
    cards.push(item(`character:${id}`, `Card: ${character.name}`, relative(character.file), lines(`### ${character.name}${id === pov ? " (POV)" : ""}`, field("Id", id), field("Role", state.state.role ?? character.role), field("Status", state.status), field("Aliases", listOf(state.state.aliases)), field("Voice words", listOf(state.state["voice-words"])), field("Voice avoid", listOf(state.state["voice-avoid"])), ...changes, ...CARD_SECTIONS.map((heading) => subsection(heading, section(body, heading))))));
  }
  sections.push({ id: "characters", title: "Characters on the page", items: cards });
  const places = [];
  const locationIds = target.scene ? [idText(target.scene.location)] : target.chapter.locations.map(idText);
  for (const location of project.locations.filter((entry) => locationIds.includes(entry.id))) {
    const { state, changes } = entityStateAtTarget(location.frontmatter, chronology, target.chapter.id);
    places.push(item(`location:${location.id}`, `Location: ${location.name}`, relative(location.file), lines(`### ${state.name ?? location.name}`, field("Id", location.id), field("Type", state.type), field("Region", state.region), field("Status", state.status), field("Controlled by", state["controlled-by"]), ...changeLines(changes, target.chapter.id))));
  }
  sections.push({ id: "locations", title: "Where it happens", items: places });
  const threads = [];
  const kinds = [
    ["promise", project.promises, "planted", "payoff"],
    ["clue", project.clues, "planted", "payoff"],
    ["question", project.questions, "introduced", "resolved"]
  ];
  for (const [kind, entries, startField, endField] of kinds) {
    for (const entry of entries) {
      const start = idText(entry[startField]);
      const end = idText(entry[endField]);
      if (["abandoned", "dropped"].includes(entry.status) || !upToTarget(start)) {
        continue;
      }
      if (end !== "" && upToTarget(end) && end !== target.chapter.id) {
        continue;
      }
      const notes = [kind];
      notes.push(start === target.chapter.id ? `${startField === "planted" ? "plant" : "raise"} in this chapter` : `${startField} in ${start}`);
      if (end === target.chapter.id) {
        notes.push(kind === "question" ? "answer in this chapter" : "pay off in this chapter");
      }
      if (entry.redHerring) {
        notes.push("red herring");
      }
      const text = section(readBody(entry.file), THREAD_SECTIONS[kind]);
      threads.push(item(`${kind}:${entry.id}`, `${kind[0].toUpperCase()}${kind.slice(1)}: ${entry.title}`, relative(entry.file), lines(`- **${entry.title}** (${notes.join("; ")})`, indented(text))));
    }
  }
  sections.push({ id: "threads", title: "Open promises, clues, and questions", items: threads });
  const before = earlierScenes(project, target, upToTarget);
  const previous = before.slice(Math.max(0, before.length - sceneLimit)).reverse().map((scene) => {
    const purpose = section(readBody(scene.file), "Purpose");
    const facts = [scene.pov ? `POV ${idText(scene.pov)}` : "", scene.location ? `at ${idText(scene.location)}` : "", scene.outcome ? `outcome ${scene.outcome}` : ""].filter(Boolean).join(", ");
    return item(`scene:${scene.id}`, `Scene: ${scene.title}`, relative(scene.file), lines(`- **${scene.chapter} scene ${scene.scene}: ${scene.title}**${facts === "" ? "" : ` (${facts})`}`, indented(purpose)));
  });
  sections.push({ id: "scenes", title: "Previous scenes", items: previous });
  let used = 0;
  const omitted = [];
  for (const entry of sections) {
    for (const candidate of entry.items) {
      candidate.included = used + candidate.tokens <= budget;
      if (candidate.included) {
        used += candidate.tokens;
      } else {
        omitted.push({ id: candidate.id, label: candidate.label, source: candidate.source, tokens: candidate.tokens });
      }
    }
  }
  previous.reverse();
  const warnings = (project.fileErrors ?? []).map((error) => warn("context-file-skipped", error.message, error.file));
  return {
    target: { kind: target.kind, id: target.id, chapter: target.chapter.id, number: targetNumber, title: target.chapter.title },
    budget,
    estimatedTokens: used,
    sections,
    omitted,
    warnings
  };
}
function earlierScenes(project, target, upToTarget) {
  return project.scenes.filter((scene) => {
    if (scene.chapter === target.chapter.id) {
      return target.scene !== null && scene.scene < target.scene.scene;
    }
    return upToTarget(scene.chapter);
  });
}
function asList(value) {
  return Array.isArray(value) ? value : [];
}
function isMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function describeMapping(entry, skip) {
  return Object.entries(entry).filter(([key, value]) => !skip.includes(key) && String(value ?? "").trim() !== "").map(([key, value]) => `${key} ${value}`).join("; ");
}
function formatContext(context) {
  const { target } = context;
  const out = [
    `# Drafting context: ${target.id}`,
    "",
    `Chapter ${target.number}: ${target.title}. About ${context.estimatedTokens} of ${context.budget} tokens`,
    "(estimated at 4 tokens per 3 words). Nothing from later chapters is included."
  ];
  for (const entry of context.sections) {
    const included = entry.items.filter((candidate) => candidate.included);
    if (included.length === 0) {
      continue;
    }
    out.push("", `## ${entry.title}`, "");
    const bullet = included[0].text.startsWith("- ");
    out.push(included.map((candidate) => candidate.text).join(bullet ? `
` : `

`));
  }
  if (context.omitted.length > 0) {
    out.push("", "## Left out to fit the budget", "", "Read these files directly if you need them:", "");
    for (const entry of context.omitted) {
      out.push(`- ${entry.label}: ${entry.source} (about ${entry.tokens} tokens)`);
    }
  }
  return `${out.join(`
`)}
`;
}

// src/series.js
import fs2 from "node:fs";
import path6 from "node:path";
var SERIES_LINK_INVERSES = [["follows", "precedes"], ["precedes", "follows"]];
var MAX_SERIES_BOOKS = 100;
var SHARED_CANON = [
  ["characters", "Characters", "name"],
  ["locations", "Locations", "name"],
  ["systems", "Systems", "name"],
  ["factions", "Factions", "name"],
  ["artifacts", "Artifacts", "name"],
  ["glossaryTerms", "Glossary terms", "term"]
];
function isBookNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function seriesDisplayName(data) {
  const title = data?.["series-title"];
  return typeof title === "string" && title.trim() !== "" ? title.trim() : seriesId(data);
}
function seriesLinkPath(fromRoot, toRoot) {
  return path6.relative(fromRoot, toRoot).split(path6.sep).join("/");
}
function seriesLinks(root, data, field) {
  const raw = data[field];
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return values.filter((value) => typeof value === "string" && value.trim() !== "").map((value) => path6.resolve(root, value));
}
function seriesId(data) {
  const value = data?.series;
  if (value === undefined || value === null) {
    return;
  }
  return String(value).trim() === "" ? undefined : value;
}
function areSiblingBooks(left, right) {
  return path6.dirname(canonicalPath(left)) === path6.dirname(canonicalPath(right));
}
function linksInclude(links, root) {
  const key = canonicalPath(root);
  return links.some((link) => link === root || canonicalPath(link) === key);
}
function readBookFrontmatter(root) {
  const storyPath = path6.join(root, "story.md");
  if (!fs2.existsSync(storyPath)) {
    return null;
  }
  return parseFrontmatter(readTextFile(storyPath), storyPath).data;
}
function validateSeriesLinks(root, data, errors) {
  for (const [field, inverse] of SERIES_LINK_INVERSES) {
    const raw = Array.isArray(data[field]) ? data[field] : [data[field]];
    const backslashed = raw.filter((value) => typeof value === "string" && value.includes("\\"));
    for (const value of backslashed) {
      errors.push(err("series-link-backslash", `story.md ${field} ${value} uses a backslash; write ${value.replace(/\\/g, "/")} so the link works on every system`, "story.md"));
    }
    for (const target of seriesLinks(root, { [field]: raw.filter((value) => !backslashed.includes(value)) }, field)) {
      const label = `story.md ${field} ${seriesLinkPath(root, target)}`;
      if (target === root || canonicalPath(target) === canonicalPath(root)) {
        errors.push(err("series-link-self", `${label} points at this book`, "story.md"));
        continue;
      }
      let other;
      try {
        other = readBookFrontmatter(target);
      } catch (error) {
        errors.push(err("series-link-unreadable", `${label}: ${error.message}`, "story.md"));
        continue;
      }
      if (!other) {
        errors.push(err("series-link-not-project", `${label} is not a story project: missing story.md`, "story.md"));
        continue;
      }
      if (!areSiblingBooks(root, target)) {
        errors.push(err("series-link-not-sibling", `${label} is not in the same parent folder as this book; story series only follows links between sibling book folders`, "story.md"));
      }
      if (!linksInclude(seriesLinks(target, other, inverse), root)) {
        errors.push(err("series-missing-backlink", `${label} is missing backlink: add ${seriesLinkPath(target, root)} to its ${inverse}`, "story.md"));
      }
      const ownSeries = seriesId(data);
      const otherSeries = seriesId(other);
      if (ownSeries !== undefined && otherSeries !== undefined && ownSeries !== otherSeries) {
        errors.push(err("series-link-other-series", `${label} belongs to series ${otherSeries}, not ${ownSeries}`, "story.md"));
      }
    }
  }
}
function withSeriesBacklink(targetRoot, field, linkedRoot, newSeriesId) {
  const storyPath = path6.join(targetRoot, "story.md");
  const markdown = readTextFile(storyPath);
  const { data } = parseFrontmatter(markdown, storyPath);
  const current = data[field];
  const existing = Array.isArray(current) ? current : typeof current === "string" && current.trim() !== "" ? [current] : [];
  const linked = linksInclude(seriesLinks(targetRoot, { [field]: existing }, field), linkedRoot);
  const addSeries = seriesId(data) === undefined && newSeriesId !== undefined;
  if (linked && !addSeries) {
    return null;
  }
  return replaceFrontmatter(markdown, {
    ...data,
    ...addSeries ? { series: newSeriesId } : {},
    ...linked ? {} : { [field]: existing.concat(seriesLinkPath(targetRoot, linkedRoot)) }
  });
}
function buildSeries(startRoot, scan) {
  const errors = [];
  const warnings = [];
  const books = discoverBooks(startRoot, scan, errors).books;
  if (books.length === 0) {
    return {
      root: startRoot,
      series: null,
      books: [],
      ordered: false,
      shared: [],
      ok: false,
      errors,
      warnings
    };
  }
  const seriesIds = [...new Set(books.map((book) => book.series).filter((series) => series !== undefined))].sort();
  if (seriesIds.length > 1) {
    errors.push(err("series-conflict", `Linked books belong to different series: ${seriesIds.join(", ")}`));
  }
  const unnamed = books.filter((book) => book.series === undefined);
  if (seriesIds.length === 1 && unnamed.length > 0) {
    warnings.push(warn("series-id-missing", `Linked books ${unnamed.map((book) => book.title).join(", ")} set no series id; add series: ${seriesIds[0]}`));
  }
  for (const book of books.filter((candidate) => candidate.invalidBookNumber)) {
    errors.push(err("invalid-book-number", `${book.label}: story.md book-number ${JSON.stringify(book.project.story.data["book-number"])} is not a number 0 or more; the book is listed as unnumbered`, path6.join(book.label, "story.md")));
  }
  const seriesTitles = [...new Set(books.map((book) => book.seriesTitle).filter((title) => title !== undefined))].sort();
  if (seriesTitles.length > 1) {
    warnings.push(warn("series-title-mismatch", `Linked books set different series-title values: ${seriesTitles.map((title) => `"${title}"`).join(", ")}; keep the series name identical everywhere`));
  }
  checkDuplicateBookNumbers(books, errors);
  const chronology = chronologicalOrder(books, errors);
  if (chronology) {
    checkSharedCanon(chronology, errors, warnings);
  }
  return {
    root: startRoot,
    series: books[0]?.series ?? seriesIds[0] ?? null,
    seriesTitle: books[0]?.seriesTitle ?? seriesTitles[0] ?? null,
    books: (chronology ? chronology.order : books).map((book) => ({
      title: book.title,
      label: book.label,
      bookNumber: book.bookNumber,
      status: book.status
    })),
    ordered: Boolean(chronology),
    shared: sharedCanon(books),
    ok: errors.length === 0,
    errors,
    warnings
  };
}
function formatSeriesReport(report) {
  const lines = [
    `# Series: ${report.seriesTitle ?? report.series ?? "Unnamed series"}`,
    "",
    report.ordered ? "Chronological order:" : "Books (unordered):"
  ];
  report.books.forEach((book, index) => {
    const details = [book.bookNumber === null ? "unnumbered" : `book ${book.bookNumber}`, book.status || "no status"];
    lines.push(`${index + 1}. ${book.title} (${details.join(", ")}) - ${book.label}`);
  });
  lines.push("", "Shared canon:");
  if (report.shared.length === 0) {
    lines.push("- None");
  }
  for (const entry of report.shared) {
    lines.push(`- ${entry.label}: ${entry.ids.join(", ")}`);
  }
  return `${lines.join(`
`)}

`;
}
function canonicalPath(target) {
  const resolved = path6.resolve(target);
  const tail = [];
  let current = resolved;
  while (current !== path6.dirname(current)) {
    try {
      const real = fs2.realpathSync(current);
      return tail.length === 0 ? real : path6.join(real, ...tail.reverse());
    } catch {
      tail.push(path6.basename(current));
      current = path6.dirname(current);
    }
  }
  try {
    return path6.join(fs2.realpathSync(current), ...tail.reverse());
  } catch {
    return path6.join(current, ...tail.reverse());
  }
}
function discoverBooks(startRoot, scan, errors) {
  const startResolved = path6.resolve(startRoot);
  const scopeRoot = path6.dirname(startResolved);
  const scopeReal = canonicalPath(scopeRoot);
  const visited = new Map;
  const queue = [startResolved];
  while (queue.length > 0) {
    const root = queue.shift();
    const resolved = path6.resolve(root);
    const effective = canonicalPath(resolved);
    if (visited.has(effective)) {
      continue;
    }
    if (visited.size >= MAX_SERIES_BOOKS) {
      errors.push(err("series-too-many-books", "Series links exceed the " + MAX_SERIES_BOOKS + " book limit; refusing to traverse further"));
      break;
    }
    const label = seriesLinkPath(startRoot, root) || ".";
    if (path6.dirname(resolved) !== scopeRoot || path6.dirname(effective) !== scopeReal) {
      const outside = !isPathInside2(scopeRoot, resolved) || !isPathInside2(scopeReal, effective);
      errors.push(outside ? err("series-link-outside", label + " points outside the series directory " + scopeRoot + "; refusing to follow") : err("series-link-not-sibling", label + " is not a sibling folder in the series directory " + scopeRoot + "; keep series books side by side, refusing to follow"));
      visited.set(effective, null);
      continue;
    }
    if (!fs2.existsSync(path6.join(root, "story.md"))) {
      errors.push(err("series-link-not-project", `${label} is not a story project: missing story.md`));
      visited.set(effective, null);
      continue;
    }
    let project;
    try {
      project = scan(root);
    } catch (error) {
      errors.push(err("series-link-unreadable", `${label}: ${error.message}`));
      visited.set(effective, null);
      continue;
    }
    for (const scanError of project.fileErrors ?? []) {
      errors.push({ ...scanError, message: `${label}: ${scanError.message}`, file: path6.join(label, scanError.file) });
    }
    if (project.story?.unreadable) {
      visited.set(effective, null);
      continue;
    }
    const data = project.story.data;
    const book = {
      root,
      key: effective,
      label,
      project,
      title: String(data.title ?? path6.basename(root)),
      series: seriesId(data),
      status: data.status,
      bookNumber: isBookNumber(data["book-number"]) ? data["book-number"] : null,
      invalidBookNumber: data["book-number"] !== undefined && !isBookNumber(data["book-number"]),
      seriesTitle: typeof data["series-title"] === "string" && data["series-title"].trim() !== "" ? data["series-title"].trim() : undefined,
      follows: seriesLinks(root, data, "follows"),
      precedes: seriesLinks(root, data, "precedes")
    };
    visited.set(effective, book);
    for (const next of book.follows.concat(book.precedes)) {
      queue.push(next);
    }
  }
  const books = [...visited.values()].filter(Boolean);
  return { books, complete: books.length === visited.size };
}
function discoverSeriesBooks(startRoot, scan) {
  const errors = [];
  const { books, complete } = discoverBooks(startRoot, scan, errors);
  return { books, complete, errors };
}
function isPathInside2(root, target) {
  const relativePath = path6.relative(root, target);
  return !path6.isAbsolute(relativePath) && (relativePath === "" || !relativePath.split(path6.sep).includes(".."));
}
function chronologicalOrder(books, errors) {
  const byKey = new Map(books.map((book) => [book.key, book]));
  const later = new Map(books.map((book) => [book.key, new Set]));
  for (const book of books) {
    for (const earlier of book.follows.map(canonicalPath)) {
      if (byKey.has(earlier) && earlier !== book.key) {
        later.get(earlier).add(book.key);
      }
    }
    for (const next of book.precedes.map(canonicalPath)) {
      if (byKey.has(next) && next !== book.key) {
        later.get(book.key).add(next);
      }
    }
  }
  const indegree = new Map(books.map((book) => [book.key, 0]));
  for (const targets of later.values()) {
    for (const target of targets) {
      indegree.set(target, indegree.get(target) + 1);
    }
  }
  const order = [];
  const ready = books.filter((book) => indegree.get(book.key) === 0);
  while (ready.length > 0) {
    ready.sort(compareBooks);
    const book = ready.shift();
    order.push(book);
    for (const target of later.get(book.key)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) {
        ready.push(byKey.get(target));
      }
    }
  }
  if (order.length < books.length) {
    const cycle = books.filter((book) => !order.includes(book)).map((book) => book.title);
    errors.push(err("series-cycle", `Series chronology has a cycle between ${cycle.join(", ")}; check follows and precedes`));
    return null;
  }
  return { order, later };
}
function checkDuplicateBookNumbers(books, errors) {
  const byNumber = new Map;
  for (const book of books) {
    if (book.bookNumber !== null) {
      byNumber.set(book.bookNumber, (byNumber.get(book.bookNumber) ?? []).concat(book.label));
    }
  }
  for (const [number, labels] of [...byNumber].sort((left, right) => left[0] - right[0])) {
    if (labels.length > 1) {
      errors.push(err("duplicate-book-number", `Books ${labels.join(", ")} share book-number ${number}; book-number is publication order and must be unique`));
    }
  }
}
function compareBooks(left, right) {
  return (left.bookNumber ?? Infinity) - (right.bookNumber ?? Infinity) || left.title.localeCompare(right.title, "en") || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}
function checkSharedCanon({ order, later }, errors, warnings) {
  const reachable = new Map(order.map((book) => [book.key, collectLater(book.key, later, new Set)]));
  for (const book of order) {
    const earlierBooks = order.filter((candidate) => reachable.get(candidate.key).has(book.key));
    checkCanonNames(book, earlierBooks, warnings);
    checkCanonDeaths(book, earlierBooks, errors);
    checkDestroyedArtifacts(book, earlierBooks, errors, warnings);
    checkKnownFacts(book, earlierBooks, errors);
  }
}
function collectLater(root, later, seen) {
  for (const next of later.get(root)) {
    if (!seen.has(next)) {
      seen.add(next);
      collectLater(next, later, seen);
    }
  }
  return seen;
}
function checkCanonNames(book, earlierBooks, warnings) {
  for (const [key, , field] of SHARED_CANON) {
    const canon = new Map;
    for (const earlier of earlierBooks) {
      for (const entity of earlier.project[key]) {
        canon.set(entity.id, { book: earlier, entity });
      }
    }
    for (const entity of book.project[key]) {
      const match = canon.get(entity.id);
      if (match && canonText(entity[field]) !== canonText(match.entity[field])) {
        warnings.push(warn("canon-name-mismatch", `${bookFile(book, entity.file)} ${field} "${entity[field]}" differs from "${match.entity[field]}" in ${bookFile(match.book, match.entity.file)}`, bookFile(book, entity.file)));
      }
      const said = pronunciationText(entity.pronunciation);
      const saidBefore = pronunciationText(match?.entity.pronunciation);
      if (said !== "" && saidBefore !== "" && said !== saidBefore) {
        warnings.push(warn("canon-pronunciation-mismatch", `${bookFile(book, entity.file)} pronunciation "${said}" differs from "${saidBefore}" in ${bookFile(match.book, match.entity.file)}`, bookFile(book, entity.file)));
      }
    }
  }
}
function pronunciationText(value) {
  return typeof value === "string" ? value.trim().normalize("NFC") : "";
}
function canonText(value) {
  return typeof value === "string" ? value.normalize("NFC") : value;
}
function checkCanonDeaths(book, earlierBooks, errors) {
  const deaths = deathsBefore(earlierBooks);
  const { chronology, lifelines } = bookLifelines(book);
  const deadAt = (id, chapterId) => deaths.has(id) && !(lifelines.has(id) && revivedBy(lifelines.get(id), chapterId, chronology));
  for (const character of book.project.characters) {
    const death = deaths.get(character.id);
    if (!death) {
      continue;
    }
    if (character.status !== "deceased") {
      errors.push(err("canon-death-status", `${bookFile(book, character.file)} has status ${character.status || "unset"}, but ${character.id} is deceased in earlier book ${death.title}; set status: deceased`, bookFile(book, character.file)));
    }
  }
  for (const record of book.project.chapters.concat(book.project.scenes)) {
    const chapterId = record.chapter ?? record.id;
    for (const [id, death] of deaths) {
      if ((record.characters.includes(id) || record.pov === id && !record.mentions.includes(id)) && deadAt(id, chapterId)) {
        errors.push(err("canon-posthumous-appearance", `${bookFile(book, record.file)} lists ${id}, who died in earlier book ${death.title}; move appearances to mentions`, bookFile(book, record.file)));
      }
    }
  }
  for (const entry of knowledgeEntries(book)) {
    const death = deaths.get(entry.character);
    if (death && entry.learnedIn && deadAt(entry.character, entry.learnedIn)) {
      errors.push(err("canon-posthumous-learning", `${bookFile(book, entry.file)} knowledge-state[${entry.index}] has ${entry.character} learn something in ${entry.learnedIn}, but ${entry.character} died in earlier book ${death.title}; drop learned-in or the entry`, bookFile(book, entry.file)));
    }
  }
}
function deathsBefore(earlierBooks) {
  const deaths = new Map;
  for (const earlier of earlierBooks) {
    const { lifelines } = bookLifelines(earlier);
    for (const character of earlier.project.characters) {
      const lifeline = lifelines.get(character.id);
      if (lifeline.deadAtEnd && (lifeline.events.length > 0 || !deaths.has(character.id))) {
        deaths.set(character.id, earlier);
      } else if (!lifeline.deadAtEnd && lifeline.events.some((event) => event.type === "revival")) {
        deaths.delete(character.id);
      }
    }
  }
  return deaths;
}
var LIFELINES = new WeakMap;
function bookLifelines(book) {
  if (!LIFELINES.has(book.project)) {
    const chronology = chapterChronology(book.project);
    const lifelines = new Map(book.project.characters.map((character) => [character.id, characterLifeline(character, chronology)]));
    LIFELINES.set(book.project, { chronology, lifelines });
  }
  return LIFELINES.get(book.project);
}
function checkDestroyedArtifacts(book, earlierBooks, errors, warnings) {
  const destroyed = firstMatching(earlierBooks, "artifacts", (artifact) => artifact.status === "destroyed");
  for (const artifact of book.project.artifacts) {
    const earlier = destroyed.get(artifact.id);
    if (earlier && artifact.status !== "destroyed") {
      warnings.push(warn("canon-destroyed-status", `${bookFile(book, artifact.file)} has status ${artifact.status || "unset"}, but ${artifact.id} was destroyed in earlier book ${earlier.title}`, bookFile(book, artifact.file)));
    }
  }
  for (const scene of book.project.scenes) {
    for (const [id, earlier] of destroyed) {
      if (scene.stateChanges.some((change) => change && typeof change === "object" && String(change.target ?? "") === id)) {
        errors.push(err("canon-destroyed-artifact-used", `${bookFile(book, scene.file)} uses ${id}, which was destroyed in earlier book ${earlier.title}; account for its return or remove the state change`, bookFile(book, scene.file)));
      }
    }
  }
}
function checkKnownFacts(book, earlierBooks, errors) {
  const known = new Map;
  for (const earlier of earlierBooks) {
    for (const entry of knowledgeFacts(earlier)) {
      if (!known.has(entry.key)) {
        known.set(entry.key, { book: earlier, entry });
      }
    }
  }
  for (const entry of knowledgeFacts(book)) {
    const prior = known.get(entry.key);
    if (prior && entry.learnedIn) {
      errors.push(err("canon-fact-relearned", `${bookFile(book, entry.file)} knowledge-state[${entry.index}] has ${entry.character} learn ${entry.fact} in ${entry.learnedIn}, but they already know it in earlier book ${prior.book.title} (${bookFile(prior.book, prior.entry.file)} knowledge-state[${prior.entry.index}])`, bookFile(book, entry.file)));
    }
  }
}
function knowledgeEntries(book) {
  const continuity = book.project.continuity;
  const entries = continuity && Array.isArray(continuity.data["knowledge-state"]) ? continuity.data["knowledge-state"] : [];
  const file = path6.join(book.root, "continuity", "state.md");
  return entries.flatMap((entry, index) => entry && typeof entry === "object" && typeof entry.character === "string" ? [{ index, file, character: entry.character, learnedIn: entry["learned-in"] ? String(entry["learned-in"]) : "" }] : []);
}
function knowledgeFacts(book) {
  const continuity = book.project.continuity;
  const entries = continuity && Array.isArray(continuity.data["knowledge-state"]) ? continuity.data["knowledge-state"] : [];
  const file = path6.join(book.root, "continuity", "state.md");
  const facts = [];
  entries.forEach((entry, index) => {
    const fact = entry && typeof entry === "object" ? String(entry.fact ?? "") : "";
    if (fact !== "" && typeof entry.character === "string") {
      facts.push({
        index,
        file,
        character: entry.character,
        fact,
        key: `${entry.character}\x00${fact}`,
        learnedIn: entry["learned-in"] ? String(entry["learned-in"]) : ""
      });
    }
  });
  return facts;
}
function firstMatching(books, key, predicate) {
  const matches = new Map;
  for (const book of books) {
    for (const entity of book.project[key]) {
      if (!matches.has(entity.id) && predicate(entity)) {
        matches.set(entity.id, book);
      }
    }
  }
  return matches;
}
function sharedCanon(books) {
  const shared = [];
  for (const [key, label] of SHARED_CANON) {
    const counts = new Map;
    for (const book of books) {
      for (const entity of book.project[key]) {
        counts.set(entity.id, (counts.get(entity.id) ?? 0) + 1);
      }
    }
    const ids = [...counts].filter(([, count]) => count > 1).map(([id]) => id).sort();
    if (ids.length > 0) {
      shared.push({ label, ids });
    }
  }
  const factBooks = new Map;
  for (const book of books) {
    for (const entry of knowledgeFacts(book)) {
      factBooks.set(entry.fact, (factBooks.get(entry.fact) ?? new Set).add(book.root));
    }
  }
  const facts = [...factBooks].filter(([, roots]) => roots.size > 1).map(([fact]) => fact).sort();
  if (facts.length > 0) {
    shared.push({ label: "Facts", ids: facts });
  }
  return shared;
}
function bookFile(book, file) {
  return path6.join(book.label, path6.relative(book.root, file));
}

// src/publishing.js
var MAX_KEYWORDS = 7;
var BISAC_PATTERN = /^[A-Z]{3}\d{6}$/;
var LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
var SCALAR_FIELDS = ["author", "language", "isbn", "publisher", "publication-date", "description", "copyright", "cover-alt", "ai-disclosure", "chapter-label", "contents-label"];
function isPlaceholder(value) {
  return typeof value === "string" && /^\[TODO\b/i.test(value.trim());
}
var RTL_LANGUAGES = new Set(["ar", "arc", "ckb", "dv", "fa", "he", "iw", "ji", "ks", "ku", "ps", "sd", "syr", "ug", "ur", "yi"]);
var RTL_SCRIPTS = new Set(["adlm", "arab", "hebr", "mand", "nkoo", "rohg", "samr", "syrc", "thaa"]);
function textDirection(language) {
  const [primary, ...subtags] = String(language ?? "").trim().toLowerCase().split("-");
  const script = subtags.find((subtag) => /^[a-z]{4}$/.test(subtag));
  if (script !== undefined) {
    return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  }
  return RTL_LANGUAGES.has(primary) ? "rtl" : "ltr";
}
function publishingMeta(data) {
  const text = (field) => typeof data[field] === "string" && !isPlaceholder(data[field]) ? data[field].trim() : "";
  const list = (field) => Array.isArray(data[field]) ? data[field].filter((item) => typeof item === "string" && item.trim() !== "" && !isPlaceholder(item)).map((item) => item.trim()) : [];
  const authors = list("authors");
  const author = text("author");
  return {
    authors: authors.length > 0 ? authors : author === "" ? [] : [author],
    language: text("language") || "en",
    isbn: normalizeIsbn(typeof data.isbn === "number" ? String(data.isbn) : text("isbn")),
    publisher: text("publisher"),
    publicationDate: text("publication-date"),
    description: text("description"),
    keywords: list("keywords"),
    subjects: list("subjects"),
    copyright: text("copyright"),
    coverAlt: text("cover-alt"),
    aiDisclosure: text("ai-disclosure"),
    chapterLabel: text("chapter-label") || "Chapter",
    contentsLabel: text("contents-label") || "Contents"
  };
}
function validatePublishing(data, errors, warnings) {
  for (const field of SCALAR_FIELDS) {
    if (data[field] !== undefined && typeof data[field] !== "string" && !(field === "isbn" && typeof data[field] === "number")) {
      errors.push(err("field-not-text", `story.md frontmatter field ${field} must be text`, "story.md"));
    }
  }
  for (const field of ["keywords", "subjects", "authors"]) {
    if (data[field] !== undefined && (!Array.isArray(data[field]) || data[field].some((item) => typeof item !== "string"))) {
      errors.push(err("field-not-list", `story.md frontmatter field ${field} must be a list of text`, "story.md"));
    }
  }
  if (typeof data.language === "string" && !isPlaceholder(data.language) && !LANGUAGE_PATTERN.test(data.language.trim())) {
    errors.push(err("invalid-language", `story.md language ${data.language} must be a BCP 47 tag such as en, en-GB, or fr`, "story.md"));
  }
  const isbn = typeof data.isbn === "number" ? String(data.isbn) : data.isbn;
  if (typeof isbn === "string" && isbn.trim() !== "" && !isPlaceholder(isbn) && normalizeIsbn(isbn) === "") {
    const hint = typeof data.isbn === "number" ? "; quote it so leading zeros survive" : "";
    errors.push(err("invalid-isbn", `story.md isbn ${isbn} is not a valid ISBN-13 or ISBN-10 (check the digits and checksum${hint})`, "story.md"));
  }
  if (typeof data["publication-date"] === "string" && !isPlaceholder(data["publication-date"])) {
    const dateError = storyDateError(data["publication-date"]);
    if (dateError !== "") {
      errors.push(err("invalid-date", `story.md publication-date ${dateError}`, "story.md"));
    }
  }
  if (Array.isArray(data.subjects)) {
    for (const subject of data.subjects) {
      if (typeof subject === "string" && !isPlaceholder(subject) && !BISAC_PATTERN.test(subject.trim())) {
        errors.push(err("invalid-subject", `story.md subject ${subject} must be a BISAC code such as FIC022000`, "story.md"));
      }
    }
  }
  if (Array.isArray(data.keywords) && data.keywords.length > MAX_KEYWORDS) {
    warnings.push(warn("too-many-keywords", `story.md lists ${data.keywords.length} keywords; most retailers accept ${MAX_KEYWORDS}`, "story.md"));
  }
  for (const field of [...SCALAR_FIELDS, "authors", "keywords", "subjects"]) {
    const values = Array.isArray(data[field]) ? data[field] : [data[field]];
    if (values.some(isPlaceholder)) {
      warnings.push(warn("todo-placeholder", `story.md ${field} is still a [TODO] placeholder; builds leave it out`, "story.md"));
    }
  }
  if (data.author !== undefined && data.authors !== undefined) {
    warnings.push(warn("author-and-authors", "story.md sets both author and authors; builds use authors", "story.md"));
  }
}
function normalizeIsbn(value) {
  const compact = String(value ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (/^97[89]\d{10}$/.test(compact)) {
    const sum = [...compact.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
    return (10 - sum % 10) % 10 === Number(compact[12]) ? compact : "";
  }
  if (/^\d{9}[\dX]$/.test(compact)) {
    const sum = [...compact].reduce((total, char, index) => total + (char === "X" ? 10 : Number(char)) * (10 - index), 0);
    return sum % 11 === 0 ? compact : "";
  }
  return "";
}
function copyrightPage(meta) {
  const lines = [meta.copyright, "", "All rights reserved."];
  if (meta.publisher !== "") {
    lines.push("", `Published by ${meta.publisher}`);
  }
  if (meta.isbn !== "") {
    lines.push("", `ISBN ${meta.isbn}`);
  }
  if (meta.aiDisclosure !== "") {
    lines.push("", meta.aiDisclosure);
  }
  return lines.join(`
`);
}
var DESCRIPTION_LIMIT = 4000;
function metadataSheet(input) {
  const { title, data, meta, words, pages } = input;
  const seriesName = seriesDisplayName(data);
  const series = typeof seriesName === "string" ? `${seriesName}${isBookNumber(data["book-number"]) ? `, book ${data["book-number"]}` : ""}` : "";
  const rows = [
    ["Title", title],
    ["Series", series],
    ["Author(s)", meta.authors.join("; ")],
    ["ISBN", meta.isbn],
    ["Publisher", meta.publisher],
    ["Publication date", meta.publicationDate],
    ["Language", meta.language],
    ["Genre", [data.genre, data["sub-genre"]].filter((value) => typeof value === "string" && value !== "").join(" / ")],
    ["Form", typeof data.form === "string" ? data.form : ""],
    ["Word count", String(words)],
    ["Estimated print pages", Object.entries(pages).map(([trim, count]) => `${count} at ${trim}`).join(", ")],
    ["Description", meta.description === "" ? "" : `${meta.description.length} characters (limit ${DESCRIPTION_LIMIT})`],
    ["Keywords", meta.keywords.length === 0 ? "" : `${meta.keywords.length} of ${MAX_KEYWORDS}: ${meta.keywords.join("; ")}`],
    ["BISAC subjects", meta.subjects.join("; ")],
    ["Copyright", meta.copyright],
    ["Cover", typeof data.cover === "string" ? data.cover : ""],
    ["Cover alt text", meta.coverAlt],
    ["AI disclosure", meta.aiDisclosure]
  ];
  const checks = [
    ["Author named (`author` or `authors`)", meta.authors.length > 0],
    ["ISBN for this edition (`isbn`), or a retailer-assigned identifier", meta.isbn !== ""],
    ["Publisher or imprint (`publisher`)", meta.publisher !== ""],
    ["Publication date (`publication-date`)", meta.publicationDate !== ""],
    [`Description under ${DESCRIPTION_LIMIT} characters (\`description\`)`, meta.description !== "" && meta.description.length <= DESCRIPTION_LIMIT],
    [`Keywords, up to ${MAX_KEYWORDS} (\`keywords\`)`, meta.keywords.length > 0 && meta.keywords.length <= MAX_KEYWORDS],
    ["BISAC subjects (`subjects`)", meta.subjects.length > 0],
    ["Copyright line (`copyright`) or copyright matter page", meta.copyright !== "" || input.hasCopyrightPage],
    ["Cover image (`cover`)", Boolean(input.coverReady)],
    ["Cover alt text (`cover-alt`)", meta.coverAlt !== ""],
    ["AI-use statement decided (`ai-disclosure`)", meta.aiDisclosure !== ""],
    [`Permissions cleared for quoted matter (\`permission\`${(input.pendingPermissions ?? []).length > 0 ? `; pending: ${input.pendingPermissions.join(", ")}` : ""})`, (input.pendingPermissions ?? []).length === 0],
    [`No \`[TODO\` markers in chapter prose${(input.todoChapters ?? []).length > 0 ? ` (found in: ${input.todoChapters.join(", ")})` : ""}`, (input.todoChapters ?? []).length === 0],
    ["Story status is complete", data.status === "complete"]
  ];
  return [
    `# ${title}: Retailer Metadata`,
    "",
    "Generated from story.md. Retailer limits change; check each retailer's current requirements before upload.",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...rows.map(([field, value]) => `| ${field} | ${value === "" ? "(missing)" : tableCell(value)} |`),
    "",
    "## Description",
    "",
    meta.description === "" ? "(missing)" : meta.description,
    "",
    "## Readiness",
    "",
    ...checks.map(([label, ok]) => `- [${ok ? "x" : " "}] ${label}`),
    ""
  ].join(`
`);
}
function tableCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// src/html.js
var TRIM_SIZES = new Map([
  ["5x8", { width: "5in", height: "8in", wordsPerPage: 230 }],
  ["5.25x8", { width: "5.25in", height: "8in", wordsPerPage: 250 }],
  ["5.5x8.5", { width: "5.5in", height: "8.5in", wordsPerPage: 275 }],
  ["6x9", { width: "6in", height: "9in", wordsPerPage: 300 }],
  ["a5", { width: "148mm", height: "210mm", wordsPerPage: 270 }]
]);
var DEFAULT_TRIM = "5.5x8.5";
function labelledParagraphs(part) {
  let count = 0;
  return part.paragraphs.map((paragraph) => {
    if (paragraph === null) {
      return null;
    }
    count += 1;
    return { label: `${part.key}-p${count}`, paragraph };
  });
}
function paragraphLabels(book) {
  return book.parts.flatMap((part) => labelledParagraphs(part).filter((entry) => entry !== null).map((entry) => ({ label: entry.label, key: part.key, text: entry.paragraph.text })));
}
function openingWords(text, count = 6) {
  const words = String(text).split(/\s+/).filter((word) => word !== "");
  return words.length > count ? `${words.slice(0, count).join(" ")}…` : words.join(" ");
}
function noteHref(noteUrl, label, stamp, text) {
  const params = [["title", `[${label}] `], ["anchor", label]];
  if (stamp !== "") {
    params.push(["build", stamp]);
  }
  params.push(["quote", openingWords(text)]);
  const query = params.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("&");
  const hash = noteUrl.indexOf("#");
  const base = hash === -1 ? noteUrl : noteUrl.slice(0, hash);
  const fragment = hash === -1 ? "" : noteUrl.slice(hash);
  return `${base}${base.includes("?") ? "&" : "?"}${query}${fragment}`;
}
function reviewHtml(book, { stamp = "", noteUrl = "" } = {}) {
  const contents = book.contentsLabel ?? "Contents";
  const rtl = textDirection(book.language) === "rtl";
  const toc = [];
  const sections = [];
  for (const part of book.parts) {
    const sectionId = part.kind === "chapter" ? part.key : `matter-${part.key}`;
    toc.push(`<li><a href="#${sectionId}">${escapeHtml(part.title)}</a></li>`);
    const body = [];
    for (const entry of labelledParagraphs(part)) {
      if (entry === null) {
        body.push({ quote: false, markup: `<hr class="scene-break" aria-label="Scene break">` });
        continue;
      }
      const { label: anchor, paragraph } = entry;
      const note = noteUrl === "" ? "" : `<a class="note-link" href="${escapeHtml(noteHref(noteUrl, anchor, stamp, paragraph.text))}" title="Write a note on ${anchor}" target="_blank" rel="noopener">Note</a>`;
      body.push({ quote: paragraph.quote, markup: `<p id="${anchor}"><a class="anchor" href="#${anchor}" title="Link to ${anchor}">${anchor}</a>${note}${paragraph.html}</p>` });
    }
    const heading = part.heading ? `<h2>${escapeHtml(part.title)}</h2>` : `<h2 class="visually-hidden">${escapeHtml(part.title)}</h2>`;
    sections.push(`<section id="${sectionId}" class="${part.kind}">${heading}
${withBlockquotes(body).join(`
`)}
</section>`);
  }
  const byline = book.authors.length === 0 ? "" : `<p class="byline">${escapeHtml(book.authors.join(" and "))}</p>`;
  return `<!DOCTYPE html>
${htmlRoot(book.language)}
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(book.title)}: review copy</title>
<style>
:root { --bg: #fdfcf8; --fg: #1d1b16; --muted: #6b665c; --rule: #ddd6c8; --accent: #7c3aed; }
@media (prefers-color-scheme: dark) { :root { --bg: #16150f; --fg: #ece8dd; --muted: #a39e92; --rule: #3a372f; --accent: #b794f4; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 1.1rem/1.65 Georgia, "Iowan Old Style", "Palatino Linotype", serif; }
main { max-width: 38rem; margin: 0 auto; padding: 2rem 1rem 6rem; }
header h1 { font-size: 2rem; line-height: 1.2; margin: 2rem 0 0.25rem; }
.byline, .note { color: var(--muted); margin: 0 0 1rem; }
.note { font: 0.9rem/1.5 system-ui, sans-serif; border-left: 3px solid var(--accent); padding-left: 0.75rem; }
nav ol { padding-left: 1.25rem; }
nav a, .anchor { color: var(--accent); }
section { border-top: 1px solid var(--rule); margin-top: 3rem; padding-top: 1rem; }
h2 { font-size: 1.4rem; margin: 1rem 0 1.5rem; }
p { position: relative; margin: 0 0 1rem; }
.anchor { position: absolute; left: -5.5rem; width: 5rem; text-align: right; font: 0.7rem/2.2 system-ui, sans-serif; text-decoration: none; opacity: 0.35; }
p:hover .anchor, p:target .anchor, .anchor:focus { opacity: 1; }
p:target { background: color-mix(in srgb, var(--accent) 12%, transparent); }
blockquote { margin: 0 0 1rem; margin-inline-start: 1.5rem; }
.scene-break { border: 0; text-align: center; margin: 2rem 0; }
.scene-break::after { content: "* * *"; color: var(--muted); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 52rem) { .anchor { position: static; display: block; width: auto; text-align: left; line-height: 1.4; opacity: 0.6; } }
${noteUrl === "" ? "" : `.note-link { position: absolute; left: -5.5rem; top: 1.5rem; width: 5rem; text-align: right; font: 0.7rem/1.4 system-ui, sans-serif; color: var(--accent); text-decoration: none; opacity: 0.35; }
p:hover .note-link, p:target .note-link, .note-link:focus { opacity: 1; }
@media (max-width: 52rem) { .note-link { position: static; display: block; width: fit-content; margin-top: -1.4em; margin-inline-start: auto; opacity: 0.6; } }
`}${rtl ? `[dir="rtl"] .note { border-left: 0; padding-left: 0; border-right: 3px solid var(--accent); padding-right: 0.75rem; }
[dir="rtl"] nav ol { padding-left: 0; padding-right: 1.25rem; }
[dir="rtl"] .anchor { left: auto; right: -5.5rem; text-align: left; }
@media (max-width: 52rem) { [dir="rtl"] .anchor { text-align: right; } }
${noteUrl === "" ? "" : `[dir="rtl"] .note-link { left: auto; right: -5.5rem; text-align: left; }
`}` : ""}</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(book.title)}</h1>
${byline}
<p class="note">Review copy${stamp === "" ? "" : `, build <code>${escapeHtml(stamp)}</code>`}. Every paragraph has a label such as <code>ch03-p12</code> (chapter 3, paragraph 12). Quote the label${stamp === "" ? "" : " and the build"} with each note, with the paragraph's first few words, so the author can find the exact spot after the text changes.${noteUrl === "" ? "" : " The Note link beside each label opens a note with these filled in."}</p>
</header>
<nav aria-label="${escapeHtml(contents)}"><h2>${escapeHtml(contents)}</h2><ol>
${toc.join(`
`)}
</ol></nav>
${sections.join(`
`)}
</main>
</body>
</html>
`;
}
function printHtml(book, trimName = DEFAULT_TRIM) {
  const trim = TRIM_SIZES.get(trimName);
  if (!trim) {
    throw usageError(`Unsupported trim size: ${trimName}. Supported sizes: ${[...TRIM_SIZES.keys()].join(", ")}`);
  }
  const pages = estimateBookPages(book, trimName);
  const inside = insideMargin(pages);
  const author = book.authors.join(" and ");
  const rtl = textDirection(book.language) === "rtl";
  const recto = rtl ? "left" : "right";
  const verso = rtl ? "right" : "left";
  const toc = [];
  const sections = [];
  for (const part of book.parts) {
    const paragraphs = [];
    let first = true;
    for (const paragraph of part.paragraphs) {
      if (paragraph === null) {
        paragraphs.push({ quote: false, markup: `<p class="scene-break" aria-label="Scene break">*&#8195;*&#8195;*</p>` });
        first = true;
        continue;
      }
      paragraphs.push({ quote: paragraph.quote, markup: first ? `<p class="first">${paragraph.html}</p>` : `<p>${paragraph.html}</p>` });
      first = false;
    }
    if (part.kind === "chapter") {
      toc.push(`<li><a href="#${part.key}">${escapeHtml(part.title)}</a></li>`);
    }
    const heading = part.heading ? `<h1>${escapeHtml(part.title)}</h1>` : part.placement === "back" ? `<div class="running-head" aria-hidden="true"></div>` : "";
    sections.push(`<section id="${part.key}" class="${part.kind}">${heading}
${withBlockquotes(paragraphs).join(`
`)}
</section>`);
  }
  const copyrightIndex = book.parts.findIndex((part) => part.copyright && part.placement === "front");
  const beforeToc = copyrightIndex === -1 ? [] : [sections[copyrightIndex]];
  const afterToc = sections.filter((_, index) => index !== copyrightIndex);
  return `<!DOCTYPE html>
${htmlRoot(book.language)}
<head>
<meta charset="utf-8">
<title>${escapeHtml(book.title)}</title>
<!-- Print interior for ${trimName} trim (${trim.width} x ${trim.height}), about ${pages} pages.
     Render to PDF with a CSS paged-media engine, for example:
       npx pagedjs-cli book.print.html -o book.pdf
       weasyprint book.print.html book.pdf
       prince book.print.html -o book.pdf
     Check the printer's current specs for margins, bleed, and fonts before upload. -->
<style>
@page { size: ${trim.width} ${trim.height}; margin: 0.75in 0.5in 0.75in ${inside}; }
@page :left { margin-left: 0.5in; margin-right: ${inside}; }
@page :${verso} {
  @top-center { content: "${cssString(author || book.title)}"; font: italic 9pt Georgia, serif; } }
@page :${recto} {
  @top-center { content: string(chapter-title, first-except); font: italic 9pt Georgia, serif; } }
@page chapter { @bottom-center { content: counter(page); font: 9pt Georgia, serif; } }
@page :blank { @top-center { content: none; } @bottom-center { content: none; } }
@page front { @top-center { content: none; } @bottom-center { content: none; } }
html { font: 11pt/1.4 Georgia, "Iowan Old Style", "Palatino Linotype", serif; }
body { margin: 0; hyphens: auto; }
.title-page, .toc, section.front { page: front; break-before: ${recto}; }
section.front.copyright-page { break-before: page; font-size: 9pt; }
.title-page { text-align: center; padding-top: 30%; }
.title-page h1 { font-size: 26pt; font-weight: normal; margin: 0 0 1em; }
.title-page .author { font-size: 14pt; font-variant: small-caps; letter-spacing: 0.05em; }
.toc h1 { font-size: 14pt; font-weight: normal; text-align: center; font-variant: small-caps; }
.toc ol { list-style: none; padding: 0; }
.toc a { color: inherit; text-decoration: none; }
.toc a::after { content: " " target-counter(attr(href), page); float: ${rtl ? "left" : "right"}; }
section.chapter, section.back { page: chapter; break-before: ${recto}; }
section.chapter > h1, section.back > h1, section.back > .running-head { string-set: chapter-title content(text); }
.running-head { height: 0; margin: 0; }
h1 { font-size: 16pt; font-weight: normal; text-align: center; margin: 1.5in 0 0.5in; break-after: avoid; }
p { margin: 0; text-indent: 1.5em; text-align: justify; widows: 2; orphans: 2; }
p.first, p.scene-break + p { text-indent: 0; }
/* A raised initial: floated drop caps render inconsistently across engines. */
section.chapter > h1 + p.first::first-letter { font-size: 2.4em; line-height: 1; }
p.scene-break { text-align: center; text-indent: 0; margin: 0.8em 0; break-after: avoid; }
blockquote { margin: 0.8em 1.5em; }
blockquote p { text-indent: 0; text-align: start; }
section.front p, section.back p { text-indent: 0; margin-bottom: 0.6em; text-align: ${rtl ? "right" : "left"}; }
section.front:not(.copyright-page) p { text-align: center; }
@media screen { body { max-width: ${trim.width}; margin: 2rem auto; padding: 0 1rem; } section { margin-top: 3rem; } }
</style>
</head>
<body>
<section class="title-page"><h1>${escapeHtml(book.title)}</h1>${author === "" ? "" : `<p class="author">${escapeHtml(author)}</p>`}</section>
${beforeToc.join(`
`)}
<nav class="toc"><h1>${escapeHtml(book.contentsLabel ?? "Contents")}</h1><ol>
${toc.join(`
`)}
</ol></nav>
${afterToc.join(`
`)}
</body>
</html>
`;
}
function htmlRoot(language) {
  const dir = textDirection(language) === "rtl" ? ` dir="rtl"` : "";
  return `<html lang="${escapeHtml(language)}"${dir}>`;
}
var OPENING_SINK_PAGES = 0.3;
var CONTENTS_ENTRIES_PER_PAGE = 25;
function estimateBookPages(book, trimName = DEFAULT_TRIM) {
  const trim = TRIM_SIZES.get(trimName) ?? TRIM_SIZES.get(DEFAULT_TRIM);
  const chapters = book.parts.filter((part) => part.kind === "chapter").length;
  let pages = 2 + Math.max(1, Math.ceil(chapters / CONTENTS_ENTRIES_PER_PAGE)) + 0.5;
  for (const part of book.parts.filter((entry) => !(entry.copyright && entry.placement === "front"))) {
    const sink = part.heading ? OPENING_SINK_PAGES : 0;
    pages += Math.max(1, Math.ceil((part.words ?? 0) / trim.wordsPerPage + sink)) + 0.5;
  }
  return Math.ceil(pages);
}
function insideMargin(pages) {
  if (pages <= 150) {
    return "0.625in";
  }
  if (pages <= 300) {
    return "0.75in";
  }
  if (pages <= 500) {
    return "0.875in";
  }
  return "1in";
}
function withBlockquotes(items) {
  const out = [];
  let open = false;
  for (const item of items) {
    if (item.quote && !open) {
      out.push("<blockquote>");
    } else if (!item.quote && open) {
      out.push("</blockquote>");
    }
    open = item.quote;
    out.push(item.markup);
  }
  if (open) {
    out.push("</blockquote>");
  }
  return out;
}
function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function cssString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/</g, "\\3C ").replace(/>/g, "\\3E ").replace(/&/g, "\\26 ").replace(/[\r\n]+/g, " ");
}

// src/progress.js
var PROGRESS_FILE = "progress.md";
var PACE_SESSIONS = 7;
var PROJECTION_HORIZON_DAYS = 100 * 366;
function withSession(sessions, date, words) {
  let found = false;
  const kept = (Array.isArray(sessions) ? sessions : []).map((session) => {
    if (!found && session && typeof session === "object" && sessionDate(session) === date) {
      found = true;
      return { ...session, words };
    }
    return session;
  });
  if (!found) {
    kept.push({ date, words });
  }
  return kept.sort((left, right) => sessionDate(left).localeCompare(sessionDate(right), "en"));
}
function sessionDate(session) {
  return String(session?.date ?? "").trim();
}
function cleanSessions(value) {
  const sessions = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (entry && typeof entry === "object" && parseClockDate(sessionDate(entry)) && Number.isInteger(entry.words) && entry.words >= 0) {
      sessions.push({ date: sessionDate(entry), words: entry.words });
    }
  }
  return sessions.sort((left, right) => left.date.localeCompare(right.date, "en"));
}
function computeProgress({ words, target, deadline, today, chapters, sessions }) {
  const todayDays = parseClockDate(today).days;
  const result = {
    words,
    target: target ?? null,
    percent: target ? words * 100 / target : null,
    remaining: target ? Math.max(0, target - words) : null,
    deadline: null,
    chapters: chapters.filter((chapter) => chapter.target > 0).map((chapter) => ({ ...chapter, percent: chapter.words * 100 / chapter.target })),
    sessions: sessions.length,
    lastSession: null,
    pace: null,
    projected: null
  };
  const deadlineDate = deadline ? parseClockDate(deadline) : undefined;
  if (deadlineDate) {
    const daysLeft = deadlineDate.days - todayDays;
    result.deadline = {
      date: deadlineDate.text,
      daysLeft,
      perDay: result.remaining !== null && daysLeft >= 0 ? Math.ceil(result.remaining / Math.max(daysLeft, 1)) : null
    };
  }
  if (sessions.length > 0) {
    const last = sessions[sessions.length - 1];
    result.lastSession = { date: last.date, words: last.words, since: words - last.words };
    const recent = sessions.slice(-PACE_SESSIONS);
    const span = parseClockDate(recent[recent.length - 1].date).days - parseClockDate(recent[0].date).days;
    if (recent.length > 1 && span > 0) {
      result.pace = (recent[recent.length - 1].words - recent[0].words) / span;
      const daysNeeded = Math.ceil(result.remaining / result.pace);
      if (result.remaining > 0 && Math.round(result.pace) > 0 && daysNeeded <= PROJECTION_HORIZON_DAYS) {
        result.projected = formatDate(todayDays + daysNeeded);
      }
    }
  }
  return result;
}
function formatProgress(progress) {
  const lines = [];
  if (progress.target === null) {
    lines.push(`Progress: ${formatNumber(progress.words)} words (no target-words in story.md)`);
  } else {
    lines.push(`Progress: ${formatNumber(progress.words)} of ${formatNumber(progress.target)} words (${formatPercent(progress.percent, 1)}%)`);
    lines.push(`Remaining: ${plural2(progress.remaining, "word", formatNumber)}`);
  }
  if (progress.deadline) {
    const { date, daysLeft, perDay } = progress.deadline;
    if (daysLeft < 0) {
      lines.push(`Deadline: ${date} passed ${plural2(-daysLeft, "day")} ago`);
    } else if (perDay === null) {
      lines.push(`Deadline: ${date} (${daysLeft === 0 ? "today" : `${plural2(daysLeft, "day")} left`})`);
    } else if (daysLeft === 0) {
      lines.push(`Deadline: ${date} (today): ${plural2(perDay, "word", formatNumber)} needed`);
    } else {
      lines.push(`Deadline: ${date} (${plural2(daysLeft, "day")} left): ${formatNumber(perDay)} words a day needed`);
    }
  }
  if (progress.lastSession) {
    const { date, since } = progress.lastSession;
    lines.push(`Sessions: ${progress.sessions} logged; last ${date} (${since >= 0 ? "+" : ""}${formatNumber(since)} words since)`);
  } else {
    lines.push("Sessions: none logged (run story progress --log after a writing session)");
  }
  if (progress.pace !== null) {
    lines.push(`Pace: ${formatNumber(Math.round(progress.pace))} words a day over the last ${Math.min(progress.sessions, PACE_SESSIONS)} sessions`);
  }
  if (progress.projected) {
    lines.push(`Projected finish at this pace: ${progress.projected}`);
  }
  if (progress.chapters.length > 0) {
    lines.push("", "Chapter targets:");
    for (const chapter of progress.chapters) {
      lines.push(`- ${chapter.id}: ${formatNumber(chapter.words)} of ${formatNumber(chapter.target)} words (${formatPercent(chapter.percent, 0)}%)`);
    }
  }
  return `${lines.join(`
`)}
`;
}
function localDate(now = new Date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function formatDate(days) {
  return new Date(days * 86400000).toISOString().slice(0, 10);
}
function plural2(count, noun, format = String) {
  return `${format(count)} ${noun}${count === 1 ? "" : "s"}`;
}
function formatPercent(percent, places) {
  const scale = 10 ** places;
  let value = Math.round(percent * scale) / scale;
  if (value >= 100 && percent < 100) {
    value = Math.floor(percent * scale) / scale;
  }
  return value.toFixed(places);
}
function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// src/compare.js
var MOVED_SHARE = 0.5;
function compareChapters(previous, current) {
  const pairs = pairChapters(previous, current);
  const pairedOld = new Set(pairs.map(([old]) => old));
  const pairedNew = new Set(pairs.map(([, now]) => now));
  const chapters = [
    ...pairs.map(([old, now]) => {
      const entry = {
        id: now.id,
        title: now.title,
        status: sameParagraphs(old.paragraphs, now.paragraphs) ? "unchanged" : "changed",
        before: old.words,
        after: now.words,
        unchanged: unchangedShare(old.paragraphs, now.paragraphs)
      };
      return old.id === now.id ? entry : { ...entry, movedFrom: old.id };
    }),
    ...current.filter((now) => !pairedNew.has(now)).map((now) => ({ id: now.id, title: now.title, status: "added", before: 0, after: now.words, unchanged: 0 })),
    ...previous.filter((old) => !pairedOld.has(old)).map((old) => ({ id: old.id, title: old.title, status: "removed", before: old.words, after: 0, unchanged: 0 }))
  ].sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }) || (left.status === "removed") - (right.status === "removed"));
  const total = (list) => list.reduce((sum, chapter) => sum + chapter.words, 0);
  return {
    chapters,
    beforeChapters: previous.length,
    afterChapters: current.length,
    beforeWords: total(previous),
    afterWords: total(current)
  };
}
function proseParagraphs2(prose) {
  return withoutFencedCode(String(prose)).split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter((paragraph) => paragraph !== "" && !isSceneBreak(paragraph));
}
function pairChapters(previous, current) {
  const candidates = [];
  for (const old of previous) {
    for (const now of current) {
      const sameId = old.id === now.id;
      const score = old.paragraphs.length === 0 || now.paragraphs.length === 0 ? 0 : keptParagraphs(old.paragraphs, now.paragraphs) / Math.max(old.paragraphs.length, now.paragraphs.length);
      if (score >= MOVED_SHARE) {
        candidates.push({ old, now, score, sameId });
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score || right.sameId - left.sameId);
  const pairs = [];
  const usedOld = new Set;
  const usedNew = new Set;
  const take = (old, now) => {
    pairs.push([old, now]);
    usedOld.add(old);
    usedNew.add(now);
  };
  for (const { old, now } of candidates) {
    if (!usedOld.has(old) && !usedNew.has(now)) {
      take(old, now);
    }
  }
  const byId = new Map(previous.filter((old) => !usedOld.has(old)).map((old) => [old.id, old]));
  for (const now of current) {
    const old = byId.get(now.id);
    if (!usedNew.has(now) && old) {
      take(old, now);
    }
  }
  return pairs;
}
function sameParagraphs(left, right) {
  return left.length === right.length && left.every((paragraph, index) => paragraph === right[index]);
}
function unchangedShare(oldParagraphs, newParagraphs) {
  if (newParagraphs.length === 0) {
    return oldParagraphs.length === 0 ? 1 : 0;
  }
  return keptParagraphs(oldParagraphs, newParagraphs) / newParagraphs.length;
}
function keptParagraphs(oldParagraphs, newParagraphs) {
  const remaining = new Map;
  for (const paragraph of oldParagraphs) {
    remaining.set(paragraph, (remaining.get(paragraph) ?? 0) + 1);
  }
  let kept = 0;
  for (const paragraph of newParagraphs) {
    const count = remaining.get(paragraph) ?? 0;
    if (count > 0) {
      kept += 1;
      remaining.set(paragraph, count - 1);
    }
  }
  return kept;
}
function formatComparison(comparison, label) {
  const added = comparison.chapters.filter((chapter) => chapter.status === "added").length;
  const removed = comparison.chapters.filter((chapter) => chapter.status === "removed").length;
  const moved = comparison.chapters.filter((chapter) => chapter.movedFrom).length;
  const lines = [
    `Compared with ${label}`,
    `Chapters: ${comparison.beforeChapters} then, ${comparison.afterChapters} now (${added} added, ${removed} removed${moved > 0 ? `, ${moved} moved` : ""})`,
    `Words: ${formatNumber2(comparison.beforeWords)} then, ${formatNumber2(comparison.afterWords)} now (${signed(comparison.afterWords - comparison.beforeWords)})`,
    ""
  ];
  if (comparison.chapters.length === 0) {
    lines.push("- No chapters in either version");
  }
  for (const chapter of comparison.chapters) {
    const name = `${chapter.id} ${chapter.title}${chapter.movedFrom ? ` (moved from ${chapter.movedFrom})` : ""}`;
    if (chapter.status === "added") {
      lines.push(`- ${name}: added (${formatNumber2(chapter.after)} words)`);
    } else if (chapter.status === "removed") {
      lines.push(`- ${name}: removed (was ${formatNumber2(chapter.before)} words)`);
    } else if (chapter.status === "unchanged") {
      lines.push(`- ${name}: unchanged (${formatNumber2(chapter.after)} words)`);
    } else {
      lines.push(`- ${name}: ${formatNumber2(chapter.before)} -> ${formatNumber2(chapter.after)} words (${signed(chapter.after - chapter.before)}), ${formatPercent(chapter.unchanged * 100, 0)}% of paragraphs unchanged`);
    }
  }
  return `${lines.join(`
`)}
`;
}
var SIMILAR_SHARE = 0.5;
function mapLabels(previous, current, labels) {
  const oldByLabel = new Map(previous.map((entry, index) => [entry.label, { ...entry, index }]));
  const words = current.map((entry) => wordBag(entry.text));
  const exact = exactPairs(previous, current);
  const reserved = new Set(exact.values());
  return labels.map((label) => {
    const old = oldByLabel.get(label);
    if (!old) {
      return { label, status: "unknown" };
    }
    if (exact.has(old.index)) {
      return { label, status: "unchanged", to: current[exact.get(old.index)].label, similarity: 1 };
    }
    const closer = (left, right) => (right.key === old.key) - (left.key === old.key) || Math.abs(left.index - old.index) - Math.abs(right.index - old.index);
    const bag = wordBag(old.text);
    const best = current.map((entry, index) => ({ ...entry, index, similarity: dice(bag, words[index]) })).filter((entry) => !reserved.has(entry.index) && entry.similarity >= SIMILAR_SHARE).sort((left, right) => right.similarity - left.similarity || closer(left, right))[0];
    if (best) {
      return { label, status: "edited", to: best.label, similarity: best.similarity };
    }
    return { label, status: "not-found", excerpt: openingWords(old.text) };
  });
}
function exactPairs(previous, current) {
  const byText = new Map;
  current.forEach((entry, index) => {
    const text = normalise(entry.text);
    byText.set(text, (byText.get(text) ?? []).concat(index));
  });
  const pairs = [];
  previous.forEach((entry, oldIndex) => {
    for (const newIndex of byText.get(normalise(entry.text)) ?? []) {
      pairs.push({ oldIndex, newIndex, sameKey: current[newIndex].key === entry.key, distance: Math.abs(newIndex - oldIndex) });
    }
  });
  pairs.sort((left, right) => right.sameKey - left.sameKey || left.distance - right.distance || left.oldIndex - right.oldIndex);
  const matched = new Map;
  const taken = new Set;
  for (const { oldIndex, newIndex } of pairs) {
    if (!matched.has(oldIndex) && !taken.has(newIndex)) {
      matched.set(oldIndex, newIndex);
      taken.add(newIndex);
    }
  }
  return matched;
}
function normalise(text) {
  return String(text).replace(/\s+/g, " ").trim();
}
function wordBag(text) {
  const bag = new Map;
  for (const word of String(text).toLowerCase().match(/[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu) ?? []) {
    bag.set(word, (bag.get(word) ?? 0) + 1);
  }
  return bag;
}
function dice(left, right) {
  let shared = 0;
  let total = 0;
  for (const [word, count] of left) {
    shared += Math.min(count, right.get(word) ?? 0);
    total += count;
  }
  for (const count of right.values()) {
    total += count;
  }
  return total === 0 ? 0 : 2 * shared / total;
}
function formatLabelMapping(mapping, label) {
  const lines = mapping.map((entry) => {
    if (entry.status === "unknown") {
      return `${entry.label}: no such label in ${label}`;
    }
    if (entry.status === "not-found") {
      return `${entry.label}: not found in the current text ("${entry.excerpt}")`;
    }
    if (entry.status === "unchanged") {
      return `${entry.label} -> ${entry.to} (text unchanged)`;
    }
    return `${entry.label} -> ${entry.to} (edited, ${Math.min(99, Math.round(entry.similarity * 100))}% similar)`;
  });
  return `${lines.join(`
`)}
`;
}
function signed(value) {
  return `${value > 0 ? "+" : value < 0 ? "-" : "±"}${formatNumber2(Math.abs(value))}`;
}
function formatNumber2(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// src/config.js
import fs3 from "node:fs";
import path7 from "node:path";

// src/similarity.js
var SIMILARITY_DEFAULTS = { minWords: 8 };
var MIN_SHINGLE = 5;
var MAX_PLACES = 1000;
var QUOTE_WORDS = 24;
var CJK = "\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}";
var WORD_CHAR = `(?:(?![${CJK}])[\\p{L}\\p{N}\\p{M}])`;
var WORD_PATTERN2 = new RegExp(`[${CJK}]|${WORD_CHAR}+(?:['’ʼ]${WORD_CHAR}+)*`, "gu");
function similarityOptions(options = {}) {
  const settings = { ...SIMILARITY_DEFAULTS };
  const raw = options["min-words"];
  if (raw !== undefined) {
    const text = String(raw).trim();
    if (!/^\d+$/.test(text) || Number(text) < MIN_SHINGLE || !Number.isSafeInteger(Number(text))) {
      throw usageError(`--min-words must be a whole number ${MIN_SHINGLE} or more, such as ${SIMILARITY_DEFAULTS.minWords}`);
    }
    settings.minWords = Number(text);
  }
  return settings;
}
function tokenizeDocument(paragraphs) {
  const words = [];
  paragraphs.forEach((paragraph, index) => {
    for (const match of paragraph.text.normalize("NFC").matchAll(WORD_PATTERN2)) {
      words.push({
        word: match[0].toLowerCase().replace(/[’ʼ]/g, "'"),
        paragraph: index,
        start: match.index,
        end: match.index + match[0].length
      });
    }
  });
  return words;
}
function shingleKey(words, at, size) {
  let key = words[at].word;
  for (let offset = 1;offset < size; offset += 1) {
    key += ` ${words[at + offset].word}`;
  }
  return key;
}
function indexReference(references, size) {
  const index = new Map;
  references.forEach((reference, doc) => {
    const words = reference.words;
    for (let at = 0;at + size <= words.length; at += 1) {
      const key = shingleKey(words, at, size);
      const places = index.get(key);
      if (places === undefined) {
        index.set(key, [[doc, at]]);
      } else {
        places.push([doc, at]);
      }
    }
  });
  return index;
}
function runLength(source, from, target, at) {
  let length = 0;
  while (from + length < source.length && at + length < target.length && source[from + length].word === target[at + length].word) {
    length += 1;
  }
  return length;
}
function alignments(source, doc, index, references, minWords) {
  const words = source.words;
  const found = [];
  let reach = 0;
  for (let at = 0;at + minWords <= words.length; at += 1) {
    const places = index.get(shingleKey(words, at, minWords));
    if (places === undefined) {
      continue;
    }
    for (const [refDoc, refAt] of places.length > MAX_PLACES ? places.slice(0, MAX_PLACES) : places) {
      const target = references[refDoc].words;
      if (at > 0 && refAt > 0 && words[at - 1].word === target[refAt - 1].word) {
        continue;
      }
      if (at + Math.min(words.length - at, target.length - refAt) <= reach) {
        continue;
      }
      const length = runLength(words, at, target, refAt);
      found.push({ doc, at, refDoc, refAt, length });
      reach = Math.max(reach, at + length);
    }
  }
  return found;
}
function sharedRuns(sources, references, minWords) {
  const index = indexReference(references, minWords);
  const runs = [];
  sources.forEach((source, doc) => {
    const found = alignments(source, doc, index, references, minWords).sort((a, b) => b.length - a.length || a.at - b.at || a.refDoc - b.refDoc || a.refAt - b.refAt);
    const taken = new Uint8Array(source.words.length);
    for (const alignment of found) {
      let from = alignment.at;
      const end = alignment.at + alignment.length;
      while (from < end) {
        while (from < end && taken[from] === 1) {
          from += 1;
        }
        let to = from;
        while (to < end && taken[to] === 0) {
          to += 1;
        }
        if (to - from >= minWords) {
          taken.fill(1, from, to);
          runs.push({ doc, at: from, refDoc: alignment.refDoc, refAt: alignment.refAt + (from - alignment.at), length: to - from });
        }
        from = to;
      }
    }
  });
  return runs.sort((a, b) => a.doc - b.doc || a.at - b.at);
}
function describe(document, from, length) {
  const words = document.words.slice(from, from + length);
  const first = words[0];
  const last = words[words.length - 1];
  const labels = document.paragraphs.slice(first.paragraph, last.paragraph + 1).map((paragraph) => paragraph.label);
  const pieces = [];
  for (let paragraph = first.paragraph;paragraph <= last.paragraph; paragraph += 1) {
    const text = document.paragraphs[paragraph].text.normalize("NFC");
    const start = paragraph === first.paragraph ? first.start : 0;
    const end = paragraph === last.paragraph ? last.end : text.length;
    pieces.push(text.slice(start, end).replace(/\s+/g, " ").trim());
  }
  return {
    from: labels[0],
    to: labels[labels.length - 1],
    text: pieces.join(" / ")
  };
}
function count(value, noun) {
  return `${formatNumber2(value)} ${value === 1 ? noun : `${noun}s`}`;
}
function place(location) {
  return location.from === location.to ? location.from : `${location.from} to ${location.to}`;
}
function quote(text) {
  const words = text.split(" ");
  return words.length > QUOTE_WORDS ? `${words.slice(0, QUOTE_WORDS).join(" ")}…` : text;
}
function compareSimilarity(chapters, references, { minWords, label }) {
  const sources = chapters.map((chapter) => ({ ...chapter, words: tokenizeDocument(chapter.paragraphs) }));
  const targets = references.map((reference) => ({ ...reference, words: tokenizeDocument(reference.paragraphs) }));
  const runs = sharedRuns(sources, targets, minWords);
  const passages = runs.map((run) => {
    const source = sources[run.doc];
    const target = targets[run.refDoc];
    const here = describe(source, run.at, run.length);
    const there = describe(target, run.refAt, run.length);
    return {
      file: source.file,
      from: here.from,
      to: here.to,
      words: run.length,
      text: here.text,
      reference: { file: target.file, from: there.from, to: there.to, text: there.text }
    };
  });
  const warnings = passages.map((passage) => warn("similarity-shared-passage", `${passage.file} (${place(passage)}) shares ${count(passage.words, "word")} with ${passage.reference.file} (${place(passage.reference)}): "${quote(passage.text)}"`, passage.file));
  const summary = sources.map((source) => {
    const own = passages.filter((passage) => passage.file === source.file);
    return {
      file: source.file,
      title: source.title ?? "",
      words: source.words.length,
      sharedWords: own.reduce((sum, passage) => sum + passage.words, 0),
      passages: own.length
    };
  });
  return {
    ok: true,
    errors: [],
    warnings,
    label,
    minWords,
    reference: {
      files: targets.length,
      words: targets.reduce((sum, target) => sum + target.words.length, 0)
    },
    words: summary.reduce((sum, chapter) => sum + chapter.words, 0),
    sharedWords: summary.reduce((sum, chapter) => sum + chapter.sharedWords, 0),
    chapters: summary,
    passages
  };
}
function percent(part, whole) {
  if (whole === 0 || part === 0) {
    return "0%";
  }
  const tenths = Math.max(1, Math.floor(part / whole * 1000));
  return `${(tenths / 10).toFixed(tenths % 10 === 0 ? 0 : 1)}%`;
}
function formatSimilarity(report) {
  const lines = [
    `Similarity against ${report.label}: ${count(report.reference.words, "word")} in ${count(report.reference.files, "file")}, runs of ${report.minWords} or more shared words`,
    ""
  ];
  for (const chapter of report.chapters) {
    const passages = chapter.passages === 0 ? "no shared passages" : `${count(chapter.passages, "shared passage")}, ${count(chapter.sharedWords, "word")} (${percent(chapter.sharedWords, chapter.words)})`;
    lines.push(`- ${chapter.file}: ${passages}`);
  }
  lines.push("", `Total: ${formatNumber2(report.sharedWords)} of ${count(report.words, "word")} shared (${percent(report.sharedWords, report.words)})`);
  lines.push("Shared text is a place to look, not proof of copying: check each passage in context.");
  return `${lines.join(`
`)}
`;
}

// src/config.js
var SEVERITY_LEVELS = ["error", "warning", "off"];
var TARGETED_COMMANDS = new Set(["knowledge", "add", "rename", "move", "remove"]);
var TARGETED_FLAGS = { passes: ["start", "done"], progress: ["date"] };
var LINKED_FLAGS = {
  build: [["format", "shunn", "trim", "stamp", "note-url"]],
  compare: [["ref", "against"]]
};
var EMPTY_CONFIG = Object.freeze({ defaults: {}, severity: {}, exemptions: [], errors: [] });
function readCliConfig(root) {
  let data;
  try {
    data = parseFrontmatter(fs3.readFileSync(path7.join(root, "story.md"), "utf8")).data;
  } catch {
    return EMPTY_CONFIG;
  }
  return { ...parseCliConfig(data), exemptions: readExemptionLog(root) };
}
function validateCliConfig(data, errors) {
  errors.push(...parseCliConfig(data).errors.map((message) => err("invalid-cli-config", message, "story.md")));
}
function parseCliConfig(data) {
  const errors = [];
  const defaults = parseDefaults(data["cli-defaults"], errors);
  const severity = parseSeverity(data.severity, errors);
  return { defaults, severity, errors };
}
function parseDefaults(raw, errors) {
  const defaults = {};
  for (const [index, item] of listItems(raw, "cli-defaults", errors)) {
    const label = `story.md cli-defaults[${index}]`;
    if (typeof item.command !== "string" || item.command.trim() === "") {
      errors.push(`${label} must name a command`);
      continue;
    }
    const name = item.command.trim();
    const command = COMMANDS.find((entry) => entry.name === name);
    if (command === undefined) {
      errors.push(`${label} names unknown command ${name}${suggestion(name, COMMANDS.map((entry) => entry.name))}`);
      continue;
    }
    if (command.project === "none") {
      errors.push(`${label} names ${name}, which creates a project and cannot take defaults from one`);
      continue;
    }
    if (TARGETED_COMMANDS.has(name)) {
      errors.push(`${label} names ${name}, which acts on one named entity and cannot take defaults`);
      continue;
    }
    if (Object.hasOwn(defaults, name)) {
      errors.push(`${label} repeats command ${name}: put all its defaults in one entry`);
      continue;
    }
    defaults[name] = parseCommandDefaults(command, item, label, errors);
    const thresholds = { prose: proseThresholds, similarity: similarityOptions }[name];
    if (thresholds !== undefined) {
      try {
        thresholds(defaults[name]);
      } catch (error) {
        errors.push(`${label}: ${error.message}`);
      }
    }
  }
  return defaults;
}
function parseCommandDefaults(command, item, label, errors) {
  const accepted = command.options ?? [];
  const values = {};
  for (const [key, value] of Object.entries(item)) {
    if (key === "command") {
      continue;
    }
    const option = OPTIONS.find((entry) => entry.name === key);
    if (key === "json") {
      errors.push(`${label} sets json, which changes the output a script reads: pass --json on the command line`);
    } else if (key === "path") {
      errors.push(`${label} sets path: the project is the folder story.md is in`);
    } else if (!accepted.includes(key)) {
      errors.push(`${label} sets ${key}, which story ${command.name} does not accept${suggestion(key, accepted)}`);
    } else if ((TARGETED_FLAGS[command.name] ?? []).includes(key)) {
      errors.push(`${label} sets ${key}, which names one target and cannot be a default`);
    } else if (option.value === undefined) {
      try {
        values[key] = normalizeBooleanValue(key, typeof value === "boolean" ? value : String(value));
      } catch {
        errors.push(`${label} ${key} must be true or false`);
      }
    } else if (typeof value === "string" && value.trim() !== "" || typeof value === "number") {
      values[key] = String(value);
    } else {
      errors.push(`${label} ${key} needs a value, such as ${key}: ${option.value.replace(/^<|>$/g, "")}`);
    }
  }
  return values;
}
function parseSeverity(raw, errors) {
  const severity = {};
  const codes = severityCodes();
  for (const [index, item] of listItems(raw, "severity", errors)) {
    const label = `story.md severity[${index}]`;
    const extra = Object.keys(item).filter((key) => key !== "warning" && key !== "level");
    if (extra.length > 0) {
      errors.push(`${label} has ${extra.join(", ")}: an entry takes only warning and level`);
    }
    const code = typeof item.warning === "string" ? item.warning.trim() : "";
    if (code === "") {
      errors.push(`${label} must name a warning`);
      continue;
    }
    if (FINDING_CODES[code] === "error") {
      errors.push(`${label} names ${code}, which is an error: severity changes only warnings`);
      continue;
    }
    if (PROJECTLESS_CODES.includes(code)) {
      errors.push(`${label} names ${code}, which story init or story import reports before there is a story.md to read: severity cannot change it`);
      continue;
    }
    if (!codes.includes(code)) {
      errors.push(`${label} names unknown warning ${code}${suggestion(code, codes)}`);
      continue;
    }
    if (!SEVERITY_LEVELS.includes(item.level)) {
      errors.push(`${label} level must be one of ${SEVERITY_LEVELS.join(", ")}`);
      continue;
    }
    if (Object.hasOwn(severity, code)) {
      errors.push(`${label} repeats warning ${code}`);
      continue;
    }
    severity[code] = item.level;
  }
  return severity;
}
function listItems(raw, field, errors) {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push(`story.md frontmatter field ${field} must be a list`);
    return [];
  }
  const items = [];
  raw.forEach((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`story.md ${field}[${index}] must be a mapping, such as - ${field === "severity" ? "warning: todo-markers" : "command: prose"}`);
    } else {
      items.push([index, item]);
    }
  });
  return items;
}
function applyDefaults(config, commandName, options) {
  const filled = [];
  const given = (name) => optionFamily(name).some((member) => options[member] !== undefined);
  for (const [key, value] of Object.entries(config.defaults[commandName] ?? {})) {
    const group = (LINKED_FLAGS[commandName] ?? []).find((flags) => flags.includes(key)) ?? [key];
    if (!group.some(given)) {
      options[key] = value;
      filled.push(key);
    }
  }
  return filled;
}
var NO_OVERRIDES = Object.freeze({ severity: [], exemptions: [] });
function findingOverrides(config) {
  return {
    severity: Object.entries(config.severity),
    exemptions: (config.exemptions ?? []).filter((exemption) => exemption.code !== undefined)
  };
}
function applySeverity(result, overrides = NO_OVERRIDES) {
  const exempted = dismissByExemptions(result, overrides.exemptions, { errors: false });
  if (overrides.severity.length === 0) {
    return exempted;
  }
  const levels = new Map(overrides.severity);
  const errors = [...exempted.errors];
  const warnings = [];
  const dismissed = [...exempted.dismissed ?? []];
  for (const warning of exempted.warnings) {
    const code = warning.code;
    const level = levels.get(code) ?? "warning";
    if (level === "warning") {
      warnings.push(warning);
    } else if (level === "error") {
      errors.push(warning);
    } else {
      const note = `severity ${code} is off in story.md`;
      dismissed.push({ finding: warning, reason: note, note });
    }
  }
  const promoted = errors.length > exempted.errors.length;
  return { ...exempted, ok: exempted.ok && !promoted, errors, warnings, dismissed };
}

// src/import.js
import { Buffer as Buffer4 } from "node:buffer";
import fs8 from "node:fs";
import path12 from "node:path";

// src/stdin.js
import { Buffer as Buffer2 } from "node:buffer";
import fs4 from "node:fs";
import tty from "node:tty";
var STDIN_ARG = "-";
var MAX_STDIN_BYTES = 5 * 1024 * 1024;
var CHUNK_BYTES = 64 * 1024;
var RETRY_MS = 10;
function readStdin(command, { fd = 0, isatty = tty.isatty, readSync = fs4.readSync, maxBytes = MAX_STDIN_BYTES } = {}) {
  if (isatty(fd)) {
    throw usageError(`story ${command} - reads from stdin, but stdin is a terminal: pipe the text in, such as story ${command} - < draft.md`);
  }
  const chunks = [];
  const buffer = Buffer2.alloc(CHUNK_BYTES);
  let total = 0;
  for (;; ) {
    let read;
    try {
      read = readSync(fd, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error.code === "EAGAIN") {
        pause(RETRY_MS);
        continue;
      }
      if (error.code === "EOF") {
        break;
      }
      if (error.code === "EBADF") {
        throw usageError(`story ${command} - reads from stdin, but stdin is closed: pipe the text in, such as story ${command} - < draft.md`);
      }
      throw usageError(`Cannot read stdin: ${error.message}`);
    }
    if (read === 0) {
      break;
    }
    total += read;
    if (total > maxBytes) {
      throw usageError(`Refusing to read more than ${maxBytes} bytes from stdin`);
    }
    chunks.push(Buffer2.from(buffer.subarray(0, read)));
  }
  return Buffer2.concat(chunks);
}
function stdinText(command, bytes) {
  const text = decodeUtf82(bytes, "Cannot read stdin", "Pipe UTF-8 plain text or markdown instead");
  if (text.trim() === "") {
    throw usageError(`story ${command} - read nothing from stdin: pipe the text in, such as story ${command} - < draft.md`);
  }
  return text;
}
function decodeUtf82(bytes, subject, advice) {
  if (bytes.length >= 4 && bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4) {
    throw usageError(`${subject}: it is a zip archive (such as a .docx or .odt file). Save or export it as markdown or plain text first`);
  }
  if (bytes.includes(0)) {
    throw usageError(`${subject}: it is a binary or UTF-16 file, not UTF-8 text. ${advice}`);
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw usageError(`${subject}: it is not valid UTF-8 text. ${advice}`);
  }
  return text.replace(/^\uFEFF/, "");
}
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// src/story.js
import { execFileSync } from "node:child_process";
import fs7 from "node:fs";
import os2 from "node:os";
import path11 from "node:path";

// src/lock.js
import fs5 from "node:fs";
import os from "node:os";
import path8 from "node:path";
var LOCK_FILE = ".story.lock";
var DEFAULT_WAIT_MS = 1e4;
var POLL_MS = 50;
var held = new Map;
function withProjectLock(root, run) {
  const projectRoot = path8.resolve(root);
  const key = realPath(projectRoot);
  if (held.has(key)) {
    held.set(key, held.get(key) + 1);
    try {
      return run();
    } finally {
      held.set(key, held.get(key) - 1);
    }
  }
  const lockPath = path8.join(projectRoot, LOCK_FILE);
  if (!fs5.existsSync(path8.join(projectRoot, "story.md")) || !acquire(lockPath)) {
    return run();
  }
  held.set(key, 1);
  try {
    return run();
  } finally {
    held.delete(key);
    fs5.rmSync(lockPath, { force: true });
  }
}
function acquire(lockPath) {
  const deadline = Date.now() + lockWaitMs();
  let removedStale = false;
  let created;
  while ((created = tryCreate(lockPath)) === null) {
    const owner = readOwner(lockPath);
    if (owner && !owner.alive && !removedStale) {
      if (readOwner(lockPath)?.text === owner.text) {
        fs5.rmSync(lockPath, { force: true });
      }
      removedStale = true;
      continue;
    }
    if (Date.now() >= deadline) {
      const who = owner?.pid ? `another story command (process ${owner.pid}${owner.host && owner.host !== os.hostname() ? ` on ${owner.host}` : ""})` : "another story command";
      throw refusedError(`${who} is modifying this project; nothing was changed. Run write commands one at a time. If no story command is running, delete ${LOCK_FILE} in the project folder and try again`);
    }
    sleep(Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
  }
  return created;
}
function tryCreate(lockPath) {
  try {
    const descriptor = fs5.openSync(lockPath, "wx", 420);
    try {
      fs5.writeFileSync(descriptor, `${process.pid}
${os.hostname()}
${new Date().toISOString()}
`, "utf8");
    } finally {
      fs5.closeSync(descriptor);
    }
    return true;
  } catch (error) {
    return error.code === "EEXIST" ? null : false;
  }
}
function readOwner(lockPath) {
  let text;
  try {
    text = fs5.readFileSync(lockPath, "utf8");
  } catch {
    return null;
  }
  const [pidText, host] = text.split(`
`);
  const pid = Number.parseInt(pidText, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { text, pid: null, host: null, alive: true };
  }
  return { text, pid, host, alive: host && host !== os.hostname() || processAlive(pid) };
}
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function lockWaitMs() {
  const value = Number.parseInt(process.env.STORY_LOCK_WAIT_MS ?? "", 10);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_WAIT_MS;
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function realPath(target) {
  try {
    return fs5.realpathSync(target);
  } catch {
    return target;
  }
}

// src/timeline.js
import path9 from "node:path";
function buildTimeline(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const entries = readingUnits(project).map((unit, reading) => timelineEntry(project, unit, reading));
  const dated = orderByStoryTime(entries.filter((entry) => entry.days !== undefined));
  markToldLate(dated);
  return {
    chronology: dated,
    undated: entries.filter((entry) => entry.days === undefined),
    pov: povBalance(chapters),
    presence: characterPresence(project, chapters, chapterById)
  };
}
function orderByStoryTime(dated) {
  const days = new Map;
  for (const entry of dated) {
    const list = days.get(entry.days) ?? [];
    list.push(entry);
    days.set(entry.days, list);
  }
  const ordered = [];
  for (const day of [...days.keys()].sort((left, right) => left - right)) {
    const list = days.get(day);
    const timed = list.filter((entry) => entry.minutes !== undefined).sort((left, right) => left.minutes - right.minutes || left.reading - right.reading);
    const following = new Map;
    const opening = [];
    for (const entry of list.filter((item) => item.minutes === undefined)) {
      let before = null;
      for (const candidate of timed) {
        if (candidate.reading < entry.reading && (before === null || candidate.reading > before.reading)) {
          before = candidate;
        }
      }
      if (before === null) {
        opening.push(entry);
      } else {
        following.set(before, [...following.get(before) ?? [], entry]);
      }
    }
    ordered.push(...opening);
    for (const entry of timed) {
      ordered.push(entry, ...following.get(entry) ?? []);
    }
  }
  return ordered;
}
function markToldLate(dated) {
  let earliestLaterDay = Infinity;
  let index = dated.length;
  while (index > 0) {
    let start = index - 1;
    while (start > 0 && dated[start - 1].days === dated[index - 1].days) {
      start -= 1;
    }
    const day = dated.slice(start, index);
    const timed = day.filter((entry) => entry.minutes !== undefined).sort((left, right) => right.minutes - left.minutes);
    let earliestLaterTime = Infinity;
    let group = [];
    let groupMinutes;
    const flush = () => {
      for (const entry of group) {
        earliestLaterTime = Math.min(earliestLaterTime, entry.reading);
      }
      group = [];
    };
    const laterTime = new Map;
    for (const entry of timed) {
      if (entry.minutes !== groupMinutes) {
        flush();
        groupMinutes = entry.minutes;
      }
      laterTime.set(entry, earliestLaterTime);
      group.push(entry);
    }
    for (const entry of day) {
      entry.toldLate = entry.reading > earliestLaterDay || entry.reading > (laterTime.get(entry) ?? Infinity);
    }
    for (const entry of day) {
      earliestLaterDay = Math.min(earliestLaterDay, entry.reading);
    }
    index = start;
  }
}
function timelineEntry(project, { unit, chapter, isChapter, orphan }, reading) {
  const parsedDate = parseClockDate(unit.date || "");
  const time = unit.time;
  const minutes = parseClockTime(time || "");
  return {
    id: unit.id,
    file: path9.relative(project.root, unit.file),
    title: unit.title,
    chapterNumber: Number.isFinite(chapter.number) ? chapter.number : chapter.id,
    orphanOf: orphan ? chapter.id : "",
    pov: unit.pov || chapter.pov || "",
    location: isChapter ? chapter.locations[0] ?? "" : unit.location,
    date: parsedDate?.text ?? "",
    time: minutes === undefined ? "" : time.trim(),
    days: parsedDate?.days,
    minutes,
    flashbackTo: isChapter ? "" : unit.flashbackTo,
    reading
  };
}
function povBalance(chapters) {
  const totals = new Map;
  let words = 0;
  for (const chapter of chapters) {
    const key = chapter.pov || "unspecified";
    const entry = totals.get(key) ?? { pov: key, chapters: 0, words: 0 };
    entry.chapters += 1;
    entry.words += chapter.wordCount;
    words += chapter.wordCount;
    totals.set(key, entry);
  }
  return [...totals.values()].map((entry) => ({ ...entry, share: words === 0 ? 0 : entry.words * 100 / words })).sort((left, right) => right.words - left.words || right.chapters - left.chapters || left.pov.localeCompare(right.pov, "en"));
}
function characterPresence(project, chapters, chapterById) {
  const present = new Map(project.characters.map((character) => [character.id, new Set]));
  const mark = (characterId, chapterId) => {
    if (present.has(characterId) && chapterById.has(chapterId)) {
      present.get(characterId).add(chapterId);
    }
  };
  for (const chapter of chapters) {
    [...chapter.characters, chapter.pov].forEach((characterId) => mark(characterId, chapter.id));
  }
  for (const scene of project.scenes) {
    [...scene.characters, scene.pov].forEach((characterId) => mark(characterId, scene.chapter));
  }
  const positions = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  return project.characters.map((character) => {
    const seen = [...present.get(character.id)].map((id) => positions.get(id)).sort((left, right) => left - right);
    let longestGap = 0;
    let gapAfter = null;
    for (let index = 1;index < seen.length; index += 1) {
      const gap = seen[index] - seen[index - 1] - 1;
      if (gap > longestGap) {
        longestGap = gap;
        gapAfter = chapters[seen[index - 1]].number;
      }
    }
    const trailing = seen.length === 0 ? 0 : chapters.length - 1 - seen[seen.length - 1];
    const written = (chapterId) => chapterById.has(chapterId ?? "") && chapterById.get(chapterId).status !== "outline";
    const died = written(character.diedIn) && !written(character.revivedIn) ? chapterById.get(character.diedIn).number : null;
    return {
      id: character.id,
      chapters: seen.length,
      first: seen.length === 0 ? null : chapters[seen[0]].number,
      last: seen.length === 0 ? null : chapters[seen[seen.length - 1]].number,
      longestGap,
      gapAfter,
      trailing,
      died
    };
  }).sort((left, right) => right.chapters - left.chapters || left.id.localeCompare(right.id, "en"));
}
function formatTimeline(timeline, totalChapters) {
  const lines = [`Timeline: ${timeline.chronology.length} dated, ${timeline.undated.length} undated`];
  lines.push("", "Chronology (story order):");
  if (timeline.chronology.length === 0) {
    lines.push("- None: add date (YYYY-MM-DD) and time to scenes or chapters to order them");
  }
  for (const entry of timeline.chronology) {
    const when = [entry.date, entry.time].filter(Boolean).join(" ");
    const notes = [];
    if (entry.toldLate) {
      notes.push(`told in chapter ${entry.chapterNumber}, after later events`);
    }
    if (entry.flashbackTo) {
      notes.push(`flashback to ${entry.flashbackTo}`);
    }
    if (entry.orphanOf) {
      notes.push(`no chapter file for ${entry.orphanOf}`);
    }
    lines.push(`- ${when}  ${entry.id}: ${entry.title}${describe2(entry)}${notes.length === 0 ? "" : ` [${notes.join("; ")}]`}`);
  }
  if (timeline.undated.length > 0) {
    lines.push("", "Undated (reading order):");
    for (const entry of timeline.undated) {
      const orphan = entry.orphanOf ? ` [no chapter file for ${entry.orphanOf}]` : "";
      lines.push(`- ${entry.id}: ${entry.title}${describe2(entry)}${orphan}`);
    }
  }
  lines.push("", "POV balance:");
  if (timeline.pov.length === 0) {
    lines.push("- None");
  }
  const shares = roundedShares(timeline.pov.map((entry) => entry.words));
  for (const [index, entry] of timeline.pov.entries()) {
    lines.push(`- ${entry.pov}: ${plural3(entry.chapters, "chapter")}, ${formatNumber3(entry.words)} words (${shares[index]}%)`);
  }
  lines.push("", "Character presence:");
  if (timeline.presence.length === 0) {
    lines.push("- None");
  }
  for (const entry of timeline.presence) {
    if (entry.chapters === 0) {
      lines.push(`- ${entry.id}: not present in any chapter`);
      continue;
    }
    const span = entry.first === entry.last ? `chapter ${entry.first}` : `chapters ${entry.first}-${entry.last}`;
    const details = [`${entry.chapters} of ${totalChapters} chapters`, span];
    if (entry.longestGap > 0) {
      details.push(`longest absence ${plural3(entry.longestGap, "chapter")} after chapter ${entry.gapAfter}`);
    }
    if (entry.died !== null && entry.died !== undefined) {
      details.push(`died in chapter ${entry.died}`);
    } else if (entry.trailing > 0) {
      details.push(`absent from the last ${plural3(entry.trailing, "chapter")}`);
    }
    lines.push(`- ${entry.id}: ${details.join(", ")}`);
  }
  return `${lines.join(`
`)}
`;
}
function describe2(entry) {
  const parts = [];
  if (entry.pov) {
    parts.push(`POV ${entry.pov}`);
  }
  if (entry.location) {
    parts.push(`at ${entry.location}`);
  }
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}
function plural3(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function formatNumber3(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// src/diagram.js
var DIAGRAM_KINDS = ["relationships", "locations", "timeline", "clues", "arcs"];
var FAMILY_TYPES = new Set([
  "parent",
  "child",
  "sibling",
  "spouse",
  "partner",
  "grandparent",
  "grandchild",
  "aunt",
  "uncle",
  "niece",
  "nephew",
  "cousin"
]);
var ELDER_TYPES = new Set(["parent", "grandparent", "aunt", "uncle"]);
var YOUNGER_TYPES = new Set(["child", "grandchild", "niece", "nephew"]);
function buildDiagram(project, kind) {
  switch (kind) {
    case "relationships":
      return relationshipDiagram(project);
    case "locations":
      return locationDiagram(project);
    case "timeline":
      return timelineDiagram(project);
    case "clues":
      return clueDiagram(project);
    case "arcs":
      return arcDiagram(project);
    default:
      throw usageError(`Unknown diagram kind: ${kind ?? "(none)"}. Supported kinds: ${DIAGRAM_KINDS.join(", ")}`);
  }
}
function relationshipDiagram(project) {
  const characters = [...project.characters].sort(byId);
  const known = new Set(characters.map((character) => character.id));
  const lines = ["flowchart LR"];
  for (const character of characters) {
    lines.push(`  ${nodeId(character.id)}["${label(character.name)}"]`);
  }
  const drawn = new Set;
  for (const character of characters) {
    for (const relationship of character.relationships) {
      if (!relationship || typeof relationship !== "object" || typeof relationship.character !== "string") {
        continue;
      }
      const other = relationship.character;
      const type = String(relationship.type ?? "");
      if (!known.has(other) || YOUNGER_TYPES.has(type)) {
        continue;
      }
      const pair = [character.id, other].sort().join(" ");
      if (!ELDER_TYPES.has(type) && drawn.has(pair)) {
        continue;
      }
      drawn.add(pair);
      const from = nodeId(character.id);
      const to = nodeId(other);
      if (ELDER_TYPES.has(type)) {
        lines.push(`  ${from} ==>${edgeLabel(type)} ${to}`);
      } else if (FAMILY_TYPES.has(type)) {
        lines.push(`  ${from} ===${edgeLabel(type)} ${to}`);
      } else {
        lines.push(`  ${from} -.-${edgeLabel(type || "related")} ${to}`);
      }
    }
  }
  const chronology = chapterChronology(project);
  const lifelines = characters.map((character) => ({ id: nodeId(character.id), lifeline: characterLifeline(character, chronology) }));
  const deceased = lifelines.filter(({ lifeline }) => lifeline.deadAtEnd).map(({ id }) => id);
  const revived = lifelines.filter(({ lifeline }) => !lifeline.deadAtEnd && lifeline.events.some((event) => event.type === "revival")).map(({ id }) => id);
  if (deceased.length > 0) {
    lines.push("  classDef deceased stroke-dasharray: 4 4,color:#888", `  class ${deceased.join(",")} deceased`);
  }
  if (revived.length > 0) {
    lines.push("  classDef revived stroke-width:3px", `  class ${revived.join(",")} revived`);
  }
  return `${lines.join(`
`)}
`;
}
function locationDiagram(project) {
  const locations = [...project.locations].sort(byId);
  const known = new Set(locations.map((location) => location.id));
  const lines = ["flowchart LR"];
  for (const location of locations) {
    const region = location.region ? `<br/>${label(location.region)}` : "";
    lines.push(`  ${nodeId(location.id)}["${label(location.name)}${region}"]`);
  }
  const routes = usableRoutes(locations).filter((route) => known.has(route.from));
  const declared = new Set(routes.map((route) => `${route.from}>${route.to}`));
  for (const route of routes) {
    const text = edgeLabel([`${route.hours}h`, route.mode].filter(Boolean).join(" "));
    if (declared.has(`${route.to}>${route.from}`)) {
      lines.push(`  ${nodeId(route.from)} -->${text} ${nodeId(route.to)}`);
    } else {
      lines.push(`  ${nodeId(route.from)} ---${text} ${nodeId(route.to)}`);
    }
  }
  return `${lines.join(`
`)}
`;
}
function timelineDiagram(project) {
  const { chronology } = buildTimeline(project);
  const lines = ["timeline", `  title ${timelineText(project.title ?? "Timeline")}`];
  let section = null;
  for (const entry of chronology) {
    if (entry.date !== section) {
      section = entry.date;
      lines.push(`  section ${entry.date}`);
    }
    const when = entry.time || "day";
    const note = entry.toldLate ? ` (told in chapter ${entry.chapterNumber})` : "";
    const title = String(entry.title ?? "").trim() || entry.id;
    lines.push(`    ${timelineText(when)} : ${timelineText(`${title}${note}`)}`);
  }
  return `${lines.join(`
`)}
`;
}
function clueDiagram(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || byId(left, right));
  const known = new Set(chapters.map((chapter) => chapter.id));
  const lines = ["flowchart LR"];
  for (const chapter of chapters) {
    lines.push(`  ${nodeId(chapter.id)}["${chapter.number}. ${label(chapter.title)}"]`);
  }
  for (let index = 1;index < chapters.length; index += 1) {
    lines.push(`  ${nodeId(chapters[index - 1].id)} ~~~ ${nodeId(chapters[index].id)}`);
  }
  let unrevealed = false;
  for (const clue of [...project.clues].sort(byId)) {
    if (!known.has(clue.planted) || clue.status === "dropped" || clue.status === "abandoned") {
      continue;
    }
    const arrow = clue.redHerring ? "-.->" : "-->";
    const title = String(clue.title ?? "").trim() || clue.id;
    const text = edgeLabel(clue.redHerring ? `${title} (red herring)` : title);
    if (known.has(clue.payoff)) {
      lines.push(`  ${nodeId(clue.planted)} ${arrow}${text} ${nodeId(clue.payoff)}`);
    } else {
      unrevealed = true;
      lines.push(`  ${nodeId(clue.planted)} ${arrow}${text} unrevealed(("not yet revealed"))`);
    }
  }
  if (unrevealed) {
    lines.push("  classDef open stroke-dasharray: 4 4", "  class unrevealed open");
  }
  return `${lines.join(`
`)}
`;
}
function arcDiagram(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || byId(left, right));
  const arcs = [...project.arcs].sort(byId);
  const knownArcs = new Set(arcs.map((arc) => arc.id));
  const lines = ["flowchart LR"];
  for (const arc of arcs) {
    lines.push(`  ${arcNodeId(arc.id)}(["${label(arc.name)}"])`);
  }
  for (const chapter of chapters) {
    lines.push(`  ${nodeId(chapter.id)}["${chapter.number}. ${label(chapter.title)}"]`);
  }
  for (const chapter of chapters) {
    const advanced = new Set(chapter.arcsAdvanced);
    for (const scene of project.scenes) {
      if (scene.chapter === chapter.id) {
        scene.arcsAdvanced.forEach((arcId) => advanced.add(arcId));
      }
    }
    for (const arcId of [...advanced].filter((id) => knownArcs.has(id)).sort()) {
      lines.push(`  ${arcNodeId(arcId)} --> ${nodeId(chapter.id)}`);
    }
  }
  return `${lines.join(`
`)}
`;
}
function byId(left, right) {
  return left.id.localeCompare(right.id, "en");
}
var MERMAID_KEYWORDS = new Set(["end", "graph", "flowchart", "subgraph", "direction", "style", "class", "classdef", "click", "linkstyle", "default"]);
function nodeId(id) {
  const safe = String(id).replace(/[^A-Za-z0-9]/g, "_");
  return MERMAID_KEYWORDS.has(safe.toLowerCase()) ? `${safe}_node` : safe;
}
function arcNodeId(id) {
  return `arc__${String(id).replace(/[^A-Za-z0-9]/g, "_")}`;
}
function label(text) {
  return String(text).replace(/&/g, "&amp;").replace(/"/g, "#quot;").replace(/\|/g, "#124;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\s+/g, " ").trim();
}
function edgeLabel(text) {
  return `|"${label(text)}"|`;
}
function timelineText(text) {
  return String(text).replace(/:/g, "∶").replace(/\s+/g, " ").trim();
}

// src/forms.js
var STORY_FORMS = new Map([
  ["flash", { min: 1, max: 1500, target: 1000 }],
  ["short-story", { min: 1000, max: 7500, target: 5000 }],
  ["novelette", { min: 7500, max: 17500, target: 12000 }],
  ["novella", { min: 17500, max: 40000, target: 30000 }],
  ["novel", { min: 40000, max: 200000, target: 80000 }],
  ["serial", { min: null, max: null, target: null }],
  ["picture-book", { min: 1, max: 1000, target: 500 }],
  ["chapter-book", { min: 4000, max: 15000, target: 1e4 }]
]);
function formRangeWarning(form, words, label) {
  const range = STORY_FORMS.get(form);
  if (!range || range.min === null || !Number.isInteger(words) || words <= 0) {
    return "";
  }
  if (words < range.min || words > range.max) {
    return `${label} ${words} is outside the usual ${form} range of ${range.min}-${range.max} words`;
  }
  return "";
}

// src/narration.js
var NARRATION_WORDS_PER_MINUTE = 155;
function narrationScript(manuscript, guide) {
  const authors = manuscript.meta.authors.join(" and ");
  const sections = [
    ...manuscript.front.filter((entry) => !entry.copyright).map((entry) => ({ title: entry.title, body: entry.body })),
    ...manuscript.chapters.map((chapter) => ({ title: chapter.heading, body: chapter.body })),
    ...manuscript.back.map((entry) => ({ title: entry.title, body: entry.body }))
  ].map((section) => ({ ...section, words: wordCount(section.body) }));
  const totalWords = sections.reduce((sum, section) => sum + section.words, 0);
  const lines = [
    `# ${manuscript.title}: Narration Script`,
    "",
    `Estimated finished runtime: ${formatRuntime(totalWords)} at ${NARRATION_WORDS_PER_MINUTE} words per minute (${totalWords} words). Narration pace varies; time a sample chapter and rescale.`,
    "",
    "## Pronunciation Guide",
    ""
  ];
  if (guide.length === 0) {
    lines.push("No pronunciations recorded. Add `pronunciation:` to character, location, system, faction, artifact, and glossary term files.");
  } else {
    lines.push("| Name | Say it | Kind |", "| --- | --- | --- |");
    for (const entry of guide) {
      lines.push(`| ${cell2(entry.name)} | ${cell2(entry.pronunciation)} | ${entry.kind} |`);
    }
  }
  lines.push("", "## Opening Credits", "", `${manuscript.title}${/[.!?…]["”’')\]]*$/.test(manuscript.title) ? "" : "."}${authors === "" ? "" : ` Written by ${authors}.`} Narrated by [narrator].`);
  let wordsSoFar = 0;
  for (const section of sections) {
    const before = Math.round(wordsSoFar / NARRATION_WORDS_PER_MINUTE);
    wordsSoFar += section.words;
    const minutes = Math.round(wordsSoFar / NARRATION_WORDS_PER_MINUTE) - before;
    lines.push("", `## ${section.title}`, "", `[${minutes < 1 ? "under 1 min" : `about ${minutes} min`}]`, "", narrationBody(section.body));
  }
  lines.push("", "## Closing Credits", "", `The end. You have been listening to ${manuscript.title}${authors === "" ? "" : `, written by ${authors}`}, narrated by [narrator].`, "");
  return lines.join(`
`);
}
function pronunciationGuide(project) {
  const guide = [];
  const add = (kind, name, pronunciation) => {
    if (typeof pronunciation === "string" && pronunciation.trim() !== "") {
      guide.push({ kind, name: String(name), pronunciation: pronunciation.trim() });
    }
  };
  project.characters.filter((character) => character.status !== "cut").forEach((character) => add("character", character.name, character.pronunciation));
  project.locations.forEach((location) => add("location", location.name, location.pronunciation));
  project.systems.forEach((system) => add("system", system.name, system.pronunciation));
  project.factions.forEach((faction) => add("faction", faction.name, faction.pronunciation));
  project.artifacts.forEach((artifact) => add("artifact", artifact.name, artifact.pronunciation));
  project.glossaryTerms.forEach((term) => add("term", term.term, term.pronunciation));
  return guide.sort((left, right) => left.name.localeCompare(right.name, "en") || left.kind.localeCompare(right.kind, "en"));
}
function narrationBody(body) {
  return flattenHeadings(plainLinks(String(body).replace(/\r\n?/g, `
`))).replace(/\\\n/g, `
`).split(/\n[ \t]*\n\s*/).map((paragraph) => paragraph.trim()).filter(Boolean).map((paragraph) => isSceneBreak(paragraph) ? "[pause]" : paragraph).join(`

`);
}
function formatRuntime(words) {
  const minutes = Math.round(words / NARRATION_WORDS_PER_MINUTE);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
function cell2(value) {
  return String(value).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

// src/fountain.js
var SCENE_SETTINGS = new Map([
  ["interior", "INT."],
  ["exterior", "EXT."],
  ["both", "INT./EXT."]
]);
var NAMED_TIMES = new Map([
  ["dawn", "DAWN"],
  ["morning", "MORNING"],
  ["midday", "DAY"],
  ["afternoon", "DAY"],
  ["evening", "EVENING"],
  ["night", "NIGHT"]
]);
var FORM_NOUNS = {
  flash: "story",
  "short-story": "short story",
  novelette: "novelette",
  novella: "novella",
  novel: "novel",
  serial: "serial",
  "picture-book": "picture book",
  "chapter-book": "book"
};
function fountainScript(input) {
  const lines = [`Title: ${inline(input.title)}`];
  const authors = input.authors.map(inline).filter(Boolean).join(" and ");
  if (authors !== "") {
    lines.push("Credit: Written by", `Author: ${authors}`);
  }
  const noun = FORM_NOUNS[input.form] ?? "book";
  lines.push(`Source: Based on the ${noun}${authors === "" ? "" : ` by ${authors}`}`, "");
  lines.push("[[Scene skeleton built by story build from the scene records. Notes and synopses are not printed. Draft the action and dialogue under each heading, and merge, cut, or reorder scenes as the adaptation needs.]]");
  for (const chapter of input.chapters) {
    lines.push("", `## ${sectionText(chapter.heading)}`);
    if (chapter.scenes.length === 0) {
      lines.push("", `[[No scene records for ${inline(chapter.id)}: add them to outline this chapter.]]`);
    }
    for (const scene of chapter.scenes) {
      lines.push("", sceneHeading(scene), "", `= ${inline(scene.title)}`, "");
      const notes = [`Source: ${inline(scene.id)}`];
      if (scene.cast.length > 0) {
        notes.push(`Characters: ${scene.cast.map((name) => inline(name).toUpperCase()).join(", ")}`);
      }
      const when = [scene.date, scene.time].map(inline).filter(Boolean).join(" ");
      if (when !== "") {
        notes.push(`Story time: ${when}`);
      }
      if (inline(scene.flashbackTo) !== "") {
        notes.push(`Flashback to: ${inline(scene.flashbackTo)}`);
      }
      if (inline(scene.dilemma) !== "") {
        notes.push(`Dilemma: ${inline(scene.dilemma)}`);
      }
      if (inline(scene.outcome) !== "") {
        notes.push(`Outcome: ${inline(scene.outcome)}`);
      }
      notes.push(...scene.notes.map(inline));
      lines.push(...notes.map((note) => `[[${note.replace(/\]$/, "] ")}]]`));
    }
  }
  return `${lines.join(`
`)}
`;
}
function sceneHeading(scene) {
  const place = inline(scene.locationName).toUpperCase() || "LOCATION TBD";
  const time = timeOfDay(scene.time);
  const text = `${place}${time === "" ? "" : ` - ${time}`}`.replace(/[\s#]+$/, "") || "LOCATION TBD";
  const prefix = SCENE_SETTINGS.get(scene.setting);
  if (prefix !== undefined) {
    return `${prefix} ${text}`;
  }
  const forced = text.replace(/^[^\p{L}\p{N}]+/u, "");
  return `.${forced === "" ? "LOCATION TBD" : forced}`;
}
function timeOfDay(value) {
  const text = inline(value);
  const named = NAMED_TIMES.get(text.toLowerCase());
  if (named !== undefined) {
    return named;
  }
  const minutes = parseClockTime(text);
  if (minutes !== undefined) {
    return minutes >= 6 * 60 && minutes < 18 * 60 ? "DAY" : "NIGHT";
  }
  return text.toUpperCase();
}
function inline(value) {
  return String(value ?? "").replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ").trim().replace(/[\\*_]/g, "\\$&").replace(/\[(?=\[)/g, "[ ").replace(/\](?=\])/g, "] ");
}
function sectionText(value) {
  return inline(value).replace(/^#+\s*/, "") || "Untitled";
}

// src/ink.js
var INK_RESERVED = new Set(["true", "false", "not", "else", "return", "temp", "function"]);
function inkKnotName(id) {
  const name = id.replace(/-/g, "_");
  return /^[0-9]/.test(name) || INK_RESERVED.has(name) ? `_${name}` : name;
}
function inkInline(text) {
  return text.replace(/[\\{}|#[\]~]|-(?=>)|<(?=[>-])/g, "\\$&").replace(/\/(?=[/*])/g, "/\\");
}
function inkLine(line) {
  const text = inkInline(line.trim());
  return /^[*+\-=]|^(?:INCLUDE|VAR|CONST|LIST|EXTERNAL|TODO)\b/.test(text) ? `\\${text}` : text;
}
var HARD_BREAK = /(?: {2,}|(?:^|[^\\])(?:\\\\)*\\)$/;
function inkProse(body) {
  const out = [];
  for (const paragraph of body.split(/\r?\n[ \t]*(?:\r?\n[ \t]*)*\r?\n/)) {
    const lines = paragraph.split(/\r?\n/);
    let current = [];
    lines.forEach((line, index) => {
      const last = index === lines.length - 1;
      const broken = !last && HARD_BREAK.test(line);
      current.push((broken ? line.replace(/\\$/, "") : line).trim());
      if (broken || last) {
        out.push(inkLine(current.join(" ")));
        current = [];
      }
    });
    out.push("");
  }
  return out;
}
function inkTag(name, value) {
  return `# ${name}: ${inkInline(value.replace(/\s+/g, " ").trim())}`;
}
function inkSource(story) {
  const lines = [inkTag("title", story.title)];
  if (story.author.trim() !== "") {
    lines.push(inkTag("author", story.author));
  }
  lines.push(inkTag("ifid", story.ifid.toUpperCase()), "", `-> ${inkKnotName(story.passages[0].name)}`, "");
  story.passages.forEach((passage, position) => {
    lines.push(`=== ${inkKnotName(passage.name)} ===`);
    if (passage.body !== "") {
      lines.push(...inkProse(passage.body));
    }
    if (!story.branching) {
      const next = story.passages[position + 1];
      lines.push(`-> ${next ? inkKnotName(next.name) : "END"}`);
    } else if (passage.links.length === 0) {
      lines.push("-> END");
    } else {
      for (const link of passage.links) {
        lines.push(`+ [${inkInline(link.text)}] -> ${inkKnotName(link.to)}`);
      }
    }
    lines.push("");
  });
  return `${lines.join(`
`).trimEnd()}
`;
}

// src/twee.js
import crypto from "node:crypto";
var TWEE_LINK_UNSAFE = /[[\]|\r\n]|->|<-|<$/;
var UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isIfid(value) {
  return typeof value === "string" && UUID_V4.test(value);
}
function derivedIfid(storyId) {
  const hex = crypto.createHash("sha256").update(`story-skills-ifid:${storyId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = (Number.parseInt(hex[16], 16) & 3 | 8).toString(16);
  const text = hex.join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`.toUpperCase();
}
function passageText(text) {
  return text.replace(/^::/gm, "\\::");
}
function tweeSource(story) {
  const data = JSON.stringify({ ifid: story.ifid.toUpperCase(), start: story.start }, null, 2);
  const lines = [":: StoryTitle", passageText(story.title), "", ":: StoryData", data, ""];
  for (const passage of story.passages) {
    lines.push(`:: ${passage.name}`);
    if (passage.body !== "") {
      lines.push(passageText(passage.body));
    }
    if (passage.body !== "" && passage.links.length > 0) {
      lines.push("");
    }
    for (const link of passage.links) {
      lines.push(`[[${link.text}->${link.to}]]`);
    }
    lines.push("");
  }
  return `${lines.join(`
`).trimEnd()}
`;
}

// src/packaging.js
import { Buffer as Buffer3 } from "node:buffer";
import fs6 from "node:fs";
import { deflateRawSync } from "node:zlib";
function epubModifiedTimestamp() {
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (raw !== undefined && raw !== "") {
    const date = /^\d+$/.test(raw.trim()) ? new Date(Number(raw.trim()) * 1000) : null;
    if (date !== null && !Number.isNaN(date.getTime()) && date.getUTCFullYear() <= 9999) {
      return date.toISOString().replace(/\.\d{3}Z$/, "Z");
    }
  }
  return "2000-01-01T00:00:00Z";
}
function writeEpub(outFile, storyId, manuscript, writeOptions = {}) {
  const meta = manuscript.meta ?? publishingMeta({});
  const lang = xmlEscape(meta.language);
  const rtl = textDirection(meta.language) === "rtl";
  const root = `xml:lang="${lang}" lang="${lang}"${rtl ? ` dir="rtl"` : ""}`;
  const documents = [];
  const pushMatter = (placement) => (entry) => documents.push({
    id: `${placement}-${entry.id}`,
    label: entry.title,
    content: matterXhtml(entry, placement, root)
  });
  manuscript.front.forEach(pushMatter("front"));
  for (const chapter of manuscript.chapters) {
    documents.push({
      id: `chapter-${String(chapter.number).padStart(2, "0")}`,
      label: chapter.heading,
      content: chapterXhtml(chapter, root),
      bodymatter: true
    });
  }
  manuscript.back.forEach(pushMatter("back"));
  const coverEntries = [];
  const coverItems = [];
  const coverMeta = [];
  const coverSpine = [];
  if (manuscript.cover) {
    const href = `images/cover.${manuscript.cover.extension}`;
    const alt = meta.coverAlt === "" ? `Cover of ${manuscript.title}` : meta.coverAlt;
    coverEntries.push({ name: `OEBPS/${href}`, content: fs6.readFileSync(manuscript.cover.filePath) }, { name: "OEBPS/cover.xhtml", content: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" ${root}><head><title>${xmlEscape(manuscript.title)}</title></head><body epub:type="cover"><img src="${href}" alt="${xmlEscape(alt)}"/></body></html>` });
    coverItems.push(`<item id="cover-image" href="${href}" media-type="${manuscript.cover.mediaType}" properties="cover-image"/>`, `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    coverMeta.push(`<meta name="cover" content="cover-image"/>`);
    coverSpine.push(`<itemref idref="cover"/>`);
  }
  const creator = meta.authors.map((name) => `<dc:creator>${xmlEscape(name)}</dc:creator>`).join("");
  const identifier = meta.isbn === "" ? xmlEscape(storyId) : `urn:isbn:${meta.isbn}`;
  const optional = [
    meta.publisher === "" ? "" : `<dc:publisher>${xmlEscape(meta.publisher)}</dc:publisher>`,
    meta.publicationDate === "" ? "" : `<dc:date>${xmlEscape(meta.publicationDate)}</dc:date>`,
    meta.description === "" ? "" : `<dc:description>${xmlEscape(meta.description)}</dc:description>`,
    ...meta.subjects.map((subject) => `<dc:subject>${xmlEscape(subject)}</dc:subject>`),
    meta.copyright === "" ? "" : `<dc:rights>${xmlEscape(meta.copyright)}</dc:rights>`
  ].join("");
  const accessibility = epubAccessibilityMeta(Boolean(manuscript.cover));
  const items = documents.map((doc) => `<item id="${doc.id}" href="${doc.id}.xhtml" media-type="application/xhtml+xml"/>`);
  const spine = documents.map((doc) => `<itemref idref="${doc.id}"/>`);
  const modified = epubModifiedTimestamp();
  writeZip(outFile, [
    { name: "mimetype", content: "application/epub+zip", stored: true },
    { name: "META-INF/container.xml", content: `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: "OEBPS/content.opf", content: `<?xml version="1.0" encoding="UTF-8"?><package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${xmlEscape(manuscript.title)}</dc:title>${creator}<dc:language>${lang}</dc:language>${optional}<meta property="dcterms:modified">${modified}</meta>${accessibility}${coverMeta.join("")}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${coverItems.join("")}${items.join("")}</manifest><spine${rtl ? ` page-progression-direction="rtl"` : ""}>${coverSpine.join("")}${spine.join("")}</spine></package>` },
    { name: "OEBPS/nav.xhtml", content: navXhtml(manuscript.title, documents, root, meta.contentsLabel) },
    ...coverEntries,
    ...documents.map((doc) => ({ name: `OEBPS/${doc.id}.xhtml`, content: doc.content }))
  ], writeOptions);
}
function navXhtml(title, documents, root, contentsLabel = "Contents") {
  const links = documents.map((doc) => `<li><a href="${doc.id}.xhtml">${xmlEscape(doc.label)}</a></li>`);
  const start = documents.find((doc) => doc.bodymatter);
  const landmarks = start ? `<nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="bodymatter" href="${start.id}.xhtml">Start of Content</a></li></ol></nav>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" ${root}><head><title>${xmlEscape(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>${xmlEscape(contentsLabel)}</h1><ol>${links.join("")}</ol></nav>${landmarks}</body></html>`;
}
function epubAccessibilityMeta(hasCover) {
  const features = ["tableOfContents", "readingOrder", "structuralNavigation", ...hasCover ? ["alternativeText"] : []];
  const summary = hasCover ? "Text book with a described cover image, a navigable table of contents, headings for each chapter, and a single logical reading order." : "Text-only book with a navigable table of contents, headings for each chapter, and a single logical reading order.";
  return [
    `<meta property="schema:accessMode">textual</meta>`,
    ...hasCover ? [`<meta property="schema:accessMode">visual</meta>`] : [],
    `<meta property="schema:accessModeSufficient">textual</meta>`,
    ...features.map((feature) => `<meta property="schema:accessibilityFeature">${feature}</meta>`),
    `<meta property="schema:accessibilityHazard">none</meta>`,
    `<meta property="schema:accessibilitySummary">${summary}</meta>`
  ].join("");
}
function xhtmlParagraphs(body) {
  return withBlockquotes(markdownParagraphs(body).map((paragraph) => ({
    quote: Boolean(paragraph.quote),
    markup: paragraph.sceneBreak ? "<p>* * *</p>" : `<p>${inlineRuns(paragraph.text).map((run) => runMarkup(run, xmlEscape, "<br/>")).join("")}</p>`
  }))).join("");
}
function xhtmlDocument(title, root, bodyType, content) {
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" ${root}><head><title>${xmlEscape(title)}</title></head><body epub:type="${bodyType}">${content}</body></html>`;
}
function chapterXhtml(chapter, root) {
  const heading = chapter.heading;
  const title = String(chapter.title ?? "").trim() || heading;
  return xhtmlDocument(title, root, "bodymatter chapter", `<h1>${xmlEscape(heading)}</h1>${xhtmlParagraphs(chapter.body)}`);
}
function matterXhtml(entry, placement, root) {
  const heading = entry.heading ? `<h1>${xmlEscape(entry.title)}</h1>` : "";
  const bodyType = entry.copyright ? `${placement}matter copyright-page` : `${placement}matter`;
  return xhtmlDocument(entry.title, root, bodyType, `${heading}${xhtmlParagraphs(entry.body)}`);
}
function htmlBook(manuscript) {
  const paragraphs = (body) => markdownParagraphs(body).map((paragraph) => {
    if (paragraph.sceneBreak) {
      return null;
    }
    const runs = inlineRuns(paragraph.text);
    return {
      html: runs.map((run) => runMarkup(run, escapeHtml, "<br>")).join(""),
      text: runs.map((run) => run.text).join("").split(LINE_BREAK).join(" ").replace(/\s+/g, " ").trim(),
      quote: paragraph.quote
    };
  });
  const matter = (placement) => (entry) => ({
    key: `${placement}-${entry.id}`,
    kind: entry.copyright ? `${placement} copyright-page` : placement,
    copyright: Boolean(entry.copyright),
    placement,
    title: entry.title,
    heading: entry.heading,
    words: wordCount(entry.body),
    paragraphs: paragraphs(entry.body)
  });
  const parts = [
    ...manuscript.front.map(matter("front")),
    ...manuscript.chapters.map((chapter) => ({
      key: chapter.key,
      kind: "chapter",
      placement: "body",
      title: chapter.heading,
      heading: true,
      words: wordCount(chapter.body),
      paragraphs: paragraphs(chapter.body)
    })),
    ...manuscript.back.map(matter("back"))
  ];
  return {
    title: manuscript.title,
    authors: manuscript.meta.authors,
    language: manuscript.meta.language,
    contentsLabel: manuscript.meta.contentsLabel,
    words: manuscript.chapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0),
    parts
  };
}
function writeDocx(outFile, manuscript, writeOptions = {}) {
  const bodyParts = [paragraphXml(manuscript.title, "Title")];
  const pushSection = (heading, body) => {
    if (heading !== null) {
      bodyParts.push(paragraphXml(heading, "Heading1"));
    }
    for (const paragraph of markdownParagraphs(body)) {
      bodyParts.push(paragraph.sceneBreak ? paragraphXml("* * *", "SceneBreak") : paragraphXml(paragraph.text, paragraph.quote ? "Quote" : "", inlineRuns(paragraph.text)));
    }
  };
  const pushMatter = (entry) => pushSection(entry.heading ? entry.title : null, entry.body);
  manuscript.front.forEach(pushMatter);
  for (const chapter of manuscript.chapters) {
    pushSection(chapter.heading, chapter.body);
  }
  manuscript.back.forEach(pushMatter);
  writeZip(outFile, docxPackageEntries(bodyParts.join("")), writeOptions);
}
function docxPackageEntries(body) {
  return [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/styles.xml", content: DOCX_STYLES },
    { name: "word/document.xml", content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>` }
  ];
}
var DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="720"/></w:pPr></w:style>` + `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>` + `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="480" w:after="240"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>` + `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="120" w:after="120"/><w:ind w:left="720" w:right="720" w:firstLine="0"/></w:pPr></w:style>` + `<w:style w:type="paragraph" w:customStyle="1" w:styleId="SceneBreak"><w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr></w:style>` + `</w:styles>`;
var SHUNN_RUN_FONTS = `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/>`;
var SHUNN_PARAGRAPH_SPACING = `<w:spacing w:line="480" w:lineRule="auto"/>`;
function shunnRunXml(text, decoration) {
  return `<w:r><w:rPr>${SHUNN_RUN_FONTS}${decoration}</w:rPr>${docxTextXml(text)}</w:r>`;
}
function shunnTextRunXml(run) {
  return shunnRunXml(run.text, `${run.strong ? "<w:b/>" : ""}${run.em ? "<w:i/>" : ""}`);
}
function shunnParagraphXml(runXml, centered, quote = false) {
  const layout = centered ? `<w:ind w:firstLine="0"/><w:jc w:val="center"/>` : quote ? `<w:ind w:left="720" w:right="720" w:firstLine="0"/>` : `<w:ind w:firstLine="720"/>`;
  return `<w:p><w:pPr>${SHUNN_PARAGRAPH_SPACING}${layout}</w:pPr>${runXml}</w:p>`;
}
function shunnChapterHeadingXml(text) {
  return `<w:p><w:pPr>${SHUNN_PARAGRAPH_SPACING}<w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:r><w:br w:type="page"/></w:r>${shunnRunXml(text, "<w:b/>")}</w:p>`;
}
function shunnWordCount(words) {
  const step = words < 1000 ? 1 : words < 40000 ? 100 : 1000;
  const rounded = Math.round(words / step) * step;
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function shunnTitlePageXml(meta) {
  const lines = [shunnParagraphXml(shunnRunXml(meta.title, "<w:b/>"), true)];
  if (meta.author) {
    lines.push(shunnParagraphXml(shunnRunXml("by", ""), true), shunnParagraphXml(shunnRunXml(meta.author, ""), true));
  }
  lines.push(shunnParagraphXml(shunnRunXml(`Approximately ${shunnWordCount(meta.words)} words`, ""), true));
  for (const contactLine of meta.contact) {
    lines.push(shunnParagraphXml(shunnRunXml(String(contactLine), ""), true));
  }
  return lines;
}
function writeShunnDocx(outFile, manuscript, meta, writeOptions = {}) {
  const paragraphs = [...shunnTitlePageXml(meta)];
  const sceneBreak = meta.shortForm ? "#" : "* * *";
  const hash = shunnParagraphXml(shunnRunXml("#", ""), true);
  if (meta.shortForm) {
    paragraphs.push(shunnParagraphXml("", true));
  }
  let sections = 0;
  for (const chapter of manuscript.chapters) {
    const body = markdownParagraphs(chapter.body);
    if (!meta.shortForm) {
      paragraphs.push(shunnChapterHeadingXml(chapter.heading));
    } else if (body.length === 0) {
      continue;
    } else if (sections++ > 0) {
      paragraphs.push(hash);
    }
    for (const paragraph of body) {
      paragraphs.push(paragraph.sceneBreak ? shunnParagraphXml(shunnRunXml(sceneBreak, ""), true) : shunnParagraphXml(inlineRuns(paragraph.text).map(shunnTextRunXml).join(""), false, paragraph.quote));
    }
  }
  writeZip(outFile, docxPackageEntries(paragraphs.join("")), writeOptions);
}
function writeShunnMarkdown(outFile, manuscript, meta, writeOptions = {}) {
  const lines = [meta.title];
  if (meta.author) {
    lines.push("by", meta.author);
  }
  lines.push("", `Approximately ${shunnWordCount(meta.words)} words`, "");
  for (const contactLine of meta.contact) {
    lines.push(String(contactLine));
  }
  const sceneBreak = meta.shortForm ? "#" : "* * *";
  if (meta.shortForm) {
    lines.push("");
  }
  let sections = 0;
  for (const chapter of manuscript.chapters) {
    const body = markdownParagraphs(chapter.body);
    if (!meta.shortForm) {
      lines.push("\f", `# ${chapter.heading}`, "");
    } else if (body.length === 0) {
      continue;
    } else if (sections++ > 0) {
      lines.push("#", "");
    }
    for (const paragraph of body) {
      if (paragraph.sceneBreak) {
        lines.push(sceneBreak, "");
        continue;
      }
      const prefix = paragraph.quote ? "> " : "";
      lines.push(`${prefix}${paragraph.text.split(LINE_BREAK).join(`\\
${prefix}`)}`, "");
    }
  }
  writeFile(outFile, `${lines.join(`
`).trimEnd()}
`, writeOptions);
}
function docxTextXml(text) {
  return String(text).split(LINE_BREAK).map((part) => `<w:t xml:space="preserve">${xmlEscape(part)}</w:t>`).join("<w:br/>");
}
function paragraphXml(text, style = "", runs = [{ text }]) {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  const runXml = runs.map((run) => {
    const decoration = `${run.strong ? "<w:b/>" : ""}${run.em ? "<w:i/>" : ""}`;
    const runStyle = decoration === "" ? "" : `<w:rPr>${decoration}</w:rPr>`;
    return `<w:r>${runStyle}${docxTextXml(run.text)}</w:r>`;
  });
  return `<w:p>${styleXml}${runXml.join("")}</w:p>`;
}
function inlineRuns(text) {
  const nodes = [];
  const unclosedTicks = new Set;
  let buffer = "";
  const isSpace = (char) => char === undefined || char === LINE_BREAK || /\s/u.test(char);
  const isPunct = (char) => char !== undefined && /[\p{P}\p{S}]/u.test(char);
  for (let index = 0;index < text.length; ) {
    const char = text[index];
    if (char === "\\" && /[!-/:-@[-`{-~]/.test(text[index + 1] ?? "")) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }
    if (char === "`") {
      let run = 0;
      while (text[index + run] === "`") {
        run += 1;
      }
      const end = unclosedTicks.has(run) ? -1 : codeSpanEnd2(text, index, run);
      if (end === -1) {
        unclosedTicks.add(run);
        buffer += "`".repeat(run);
        index += run;
      } else {
        const code = text.slice(index + run, end - run);
        buffer += /^ .*[^ ].* $/.test(code) ? code.slice(1, -1) : code;
        index = end;
      }
      continue;
    }
    if (char !== "*" && char !== "_") {
      buffer += char;
      index += 1;
      continue;
    }
    let end = index;
    while (text[end] === char) {
      end += 1;
    }
    if (buffer !== "") {
      nodes.push({ text: buffer });
      buffer = "";
    }
    const before = text[index - 1];
    const after = text[end];
    const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
    const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
    nodes.push({
      delimiter: char,
      count: end - index,
      original: end - index,
      open: char === "*" ? left : left && (!right || isPunct(before)),
      close: char === "*" ? right : right && (!left || isPunct(after)),
      strong: 0,
      em: 0
    });
    index = end;
  }
  if (buffer !== "") {
    nodes.push({ text: buffer });
  }
  const stack = [];
  const bottom = new Map;
  const depth = { strong: new Array(nodes.length + 1).fill(0), em: new Array(nodes.length + 1).fill(0) };
  for (const [closeIndex, closer] of nodes.entries()) {
    if (!closer.delimiter) {
      continue;
    }
    const key = `${closer.delimiter}${closer.open ? 1 : 0}${closer.original % 3}`;
    while (closer.close && closer.count > 0) {
      const floor = bottom.get(key) ?? 0;
      let position = stack.length - 1;
      while (position >= floor && !canPairEmphasis(nodes[stack[position]], closer)) {
        position -= 1;
      }
      if (position < floor) {
        bottom.set(key, stack.length);
        break;
      }
      const openIndex = stack[position];
      const opener = nodes[openIndex];
      const used = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
      opener.count -= used;
      closer.count -= used;
      const marks = depth[used === 2 ? "strong" : "em"];
      marks[openIndex + 1] += 1;
      marks[closeIndex] -= 1;
      stack.length = opener.count > 0 ? position + 1 : position;
      for (const [other, value] of bottom) {
        if (value > stack.length) {
          bottom.set(other, stack.length);
        }
      }
    }
    if (closer.open && closer.count > 0) {
      stack.push(closeIndex);
    }
  }
  let strongDepth = 0;
  let emDepth = 0;
  for (const [index, node] of nodes.entries()) {
    strongDepth += depth.strong[index];
    emDepth += depth.em[index];
    node.strong = strongDepth;
    node.em = emDepth;
  }
  const runs = [];
  for (const node of nodes) {
    const value = node.delimiter ? node.delimiter.repeat(node.count) : node.text;
    if (value === "") {
      continue;
    }
    const strong = (node.strong ?? 0) > 0;
    const em = (node.em ?? 0) > 0;
    const previous = runs[runs.length - 1];
    if (previous && previous.strong === strong && previous.em === em) {
      previous.text += value;
    } else {
      runs.push({ text: value, strong, em });
    }
  }
  return runs;
}
function codeSpanEnd2(text, start, length) {
  let next = text.indexOf("`", start + length);
  while (next !== -1) {
    let end = next;
    while (text[end] === "`") {
      end += 1;
    }
    if (end - next === length) {
      return end;
    }
    next = text.indexOf("`", end);
  }
  return -1;
}
function canPairEmphasis(opener, closer) {
  const both = opener.close || closer.open;
  const ruleOfThree = both && (opener.original + closer.original) % 3 === 0 && !(opener.original % 3 === 0 && closer.original % 3 === 0);
  return opener.delimiter === closer.delimiter && !ruleOfThree;
}
function runMarkup(run, escape, lineBreak) {
  let markup = escape(run.text).split(LINE_BREAK).join(lineBreak);
  if (run.em) {
    markup = `<em>${markup}</em>`;
  }
  if (run.strong) {
    markup = `<strong>${markup}</strong>`;
  }
  return markup;
}
var LINE_BREAK = "";
function markdownParagraphs(markdown) {
  const paragraphs = [];
  let lines = [];
  let quote = false;
  const flush = () => {
    if (lines.length === 0) {
      return;
    }
    const joined = lines.map((line, index) => {
      if (index === lines.length - 1) {
        return line;
      }
      if (/\\$/.test(line)) {
        return `${line.slice(0, -1)}${LINE_BREAK}`;
      }
      return / {2,}$/.test(line) ? `${line}${LINE_BREAK}` : `${line} `;
    }).join("");
    const text = joined.replace(/\s+/g, " ").replace(new RegExp(` *${LINE_BREAK} *`, "g"), LINE_BREAK).replace(new RegExp(`^${LINE_BREAK}+|${LINE_BREAK}+$`, "g"), "").trim();
    lines = [];
    paragraphs.push(!text.includes(LINE_BREAK) && isSceneBreak(text) ? { sceneBreak: true } : { text, quote });
  };
  const source = flattenHeadings(plainLinks(withoutFenceMarkers(markdown.replace(/\r\n?/g, `
`))));
  for (const rawLine of source.split(`
`)) {
    const marker = /^(?:[ \t]*>[ \t]?)+/.exec(rawLine);
    const line = marker ? rawLine.slice(marker[0].length) : rawLine;
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (lines.length > 0 && marker && !quote) {
      flush();
    }
    if (lines.length === 0) {
      quote = Boolean(marker);
    }
    lines.push(line);
  }
  flush();
  return paragraphs;
}
var ZIP_DOS_DATE = 0 << 9 | 1 << 5 | 1;
var ZIP_UTF8_NAME_FLAG = 2048;
var ZIP_STORED = 0;
var ZIP_DEFLATED = 8;
var ZIP_DEFLATE_LEVEL = 9;
function writeZip(outFile, entries, writeOptions = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer3.from(entry.name, "utf8");
    const content = Buffer3.isBuffer(entry.content) ? entry.content : Buffer3.from(entry.content, "utf8");
    const crc = crc32(content);
    const deflated = entry.stored ? null : deflateRawSync(content, { level: ZIP_DEFLATE_LEVEL });
    const compressed = deflated !== null && deflated.length < content.length;
    const body = compressed ? deflated : content;
    const method = compressed ? ZIP_DEFLATED : ZIP_STORED;
    const localHeader = Buffer3.alloc(30);
    localHeader.writeUInt32LE(67324752, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_NAME_FLAG, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(ZIP_DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(body.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, body);
    const centralHeader = Buffer3.alloc(46);
    centralHeader.writeUInt32LE(33639248, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_NAME_FLAG, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(ZIP_DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(body.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + body.length;
  }
  let centralSize = 0;
  for (const part of centralParts) {
    centralSize += part.length;
  }
  const end = Buffer3.alloc(22);
  end.writeUInt32LE(101010256, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  writeFile(outFile, Buffer3.concat(localParts.concat(centralParts, end)), writeOptions);
}
function crc32(buffer) {
  let crc = 4294967295;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}
var CRC_TABLE = [];
for (let index = 0;index < 256; index += 1) {
  let value = index;
  for (let bit = 0;bit < 8; bit += 1) {
    value = value & 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
  }
  CRC_TABLE.push(value >>> 0);
}
var XML_INVALID_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function xmlEscape(value) {
  return String(value).replace(XML_INVALID_CHARACTERS, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// src/passes.js
var PASS_STATUSES = new Set(["pending", "in-progress", "done"]);
var DEFAULT_PASSES = [
  { pass: "structure", focus: "Order of events, act turns, scenes that do not change anything", checks: ["story timeline", "story pacing", "story diagram arcs"] },
  { pass: "character", focus: "Wants, arcs, motivation, and who knows what when", checks: ["story voices", "story knowledge <id> --at <chapter>", "story diagram relationships"] },
  { pass: "theme", focus: "Premise, counter-premise, motifs, and the lie/truth arc", checks: ["story report"] },
  { pass: "continuity", focus: "Deaths, props, travel, promises, clues, and backlinks", checks: ["story continuity", "story clues", "story links"] },
  { pass: "pacing", focus: "Scene outcomes, sequels, chapter hooks, and chapter lengths", checks: ["story pacing"] },
  { pass: "line", focus: "Sentence-level clarity, rhythm, and distinct voices", checks: ["story prose", "story voices"] },
  { pass: "copyedit", focus: "Spelling, usage, and consistency against the style sheet", checks: ["story prose"] },
  { pass: "proof", focus: "Typos and layout in the built book", checks: ["story build --format print", "story build --format html"] }
];
var PATH_FLAG_CHECKS = new Set(["diagram", "knowledge"]);
function passChecks(entry, where = ".") {
  return entry.checks.map((check) => {
    if (where === ".") {
      return check;
    }
    const [story, name, ...rest] = check.split(" ");
    if (PATH_FLAG_CHECKS.has(name)) {
      return `${check} --path ${where}`;
    }
    return [story, name, where, ...rest].join(" ");
  });
}
var DEFAULTS = new Map(DEFAULT_PASSES.map((entry) => [entry.pass, entry]));
function readPasses(storyData) {
  const raw = storyData["revision-passes"];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.pass === "string").map((entry) => ({ pass: entry.pass, status: typeof entry.status === "string" ? entry.status : "pending" }));
}
function validatePasses(data, label, errors) {
  const raw = data["revision-passes"];
  if (raw === undefined) {
    return;
  }
  if (!Array.isArray(raw)) {
    errors.push(err("field-not-list", `${label} frontmatter field revision-passes must be a list`, label));
    return;
  }
  const seen = new Set;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(err("field-invalid-items", `${label} frontmatter field revision-passes must contain objects`, label));
      continue;
    }
    if (typeof entry.pass !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.pass)) {
      errors.push(err("id-not-kebab", `${label} revision pass ${entry.pass ?? "(missing)"} must be a kebab-case name`, label));
      continue;
    }
    if (seen.has(entry.pass)) {
      errors.push(err("duplicate-pass", `${label} lists revision pass ${entry.pass} more than once`, label));
    }
    seen.add(entry.pass);
    if (entry.status !== undefined && !PASS_STATUSES.has(entry.status)) {
      errors.push(err("unsupported-value", `${label} revision pass ${entry.pass} has unsupported status ${entry.status}`, label));
    }
  }
}
function updatePasses(passes, change) {
  const next = passes.map((entry) => ({ ...entry }));
  if (change.init) {
    for (const entry of DEFAULT_PASSES) {
      if (!next.some((existing) => existing.pass === entry.pass)) {
        next.push({ pass: entry.pass, status: "pending" });
      }
    }
  }
  for (const [name, status] of [[change.start, "in-progress"], [change.done, "done"]]) {
    if (name === undefined) {
      continue;
    }
    if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw usageError(`Revision pass names must be kebab-case, got ${name}`);
    }
    const existing = next.find((entry) => entry.pass === name);
    if (existing) {
      existing.status = status;
    } else {
      next.push({ pass: name, status });
    }
  }
  return next;
}
function addedPassNotes(before, after) {
  const known = new Set(before.map((entry) => entry.pass));
  return after.filter((entry) => !known.has(entry.pass) && !DEFAULTS.has(entry.pass)).map((entry) => {
    const closest = DEFAULT_PASSES.find((candidate) => editDistance(candidate.pass, entry.pass) <= 2);
    return `Added custom pass ${entry.pass}, which is not in the default ladder${closest ? `; did you mean ${closest.pass}?` : ""}`;
  });
}
function nextPass(passes) {
  return passes.find((entry) => entry.status === "in-progress") ?? passes.find((entry) => entry.status !== "done") ?? null;
}
function formatPasses(passes, command = "story passes") {
  const lines = [];
  if (passes.length === 0) {
    lines.push(`Revision passes: none recorded. Run ${command} --init to add the default ladder:`, "");
    for (const entry of DEFAULT_PASSES) {
      lines.push(`- ${entry.pass}: ${entry.focus} (${entry.checks.join(", ")})`);
    }
    return `${lines.join(`
`)}
`;
  }
  const done = passes.filter((entry) => entry.status === "done").length;
  lines.push(`Revision passes: ${done} of ${passes.length} done`, "");
  for (const entry of passes) {
    const mark = entry.status === "done" ? "[x]" : entry.status === "in-progress" ? "[~]" : "[ ]";
    const known = DEFAULTS.get(entry.pass);
    const detail = known ? ` - ${known.focus} (${known.checks.join(", ")})` : "";
    lines.push(`${mark} ${entry.pass}${detail}`);
  }
  const upcoming = nextPass(passes);
  lines.push("", upcoming === null ? "All passes done." : `Next: ${upcoming.pass}${upcoming.status === "in-progress" ? " (in progress)" : ""}; mark it with ${command} --done ${upcoming.pass}`);
  return `${lines.join(`
`)}
`;
}

// src/pacing.js
import path10 from "node:path";
var SCENE_OUTCOMES = new Set(["yes", "no", "yes-but", "no-and"]);
var CHAPTER_HOOKS = new Set(["cliffhanger", "question", "revelation", "reversal", "decision", "emotional", "resolution"]);
var DRAFTED_STATUSES = new Set(["draft", "revised", "final", "complete"]);
var EASY_WIN_RUN = 3;
var NO_SEQUEL_RUN = 4;
var RESOLUTION_RUN = 3;
function buildPacing(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const files = new Map(chapters.map((chapter) => [chapter.id, project.root === undefined ? null : path10.relative(project.root, chapter.file)]));
  const warnings = [];
  const rows = [];
  const units = [];
  for (const chapter of chapters) {
    const scenes = project.scenes.filter((scene) => scene.chapter === chapter.id).sort((left, right) => left.scene - right.scene || left.id.localeCompare(right.id, "en"));
    const outcomes = { yes: 0, no: 0, "yes-but": 0, "no-and": 0 };
    for (const scene of scenes) {
      if (!scene.sequel && SCENE_OUTCOMES.has(scene.outcome)) {
        outcomes[scene.outcome] += 1;
      }
      units.push(scene);
    }
    rows.push({
      id: chapter.id,
      number: chapter.number,
      words: chapter.wordCount,
      scenes: scenes.filter((scene) => !scene.sequel).length,
      sequels: scenes.filter((scene) => scene.sequel).length,
      outcomes,
      hook: chapter.hook,
      status: chapter.status
    });
    if (chapter.hook === "" && DRAFTED_STATUSES.has(chapter.status)) {
      warnings.push(warn("pacing-no-hook", `${chapter.id} has no hook: record how the chapter ending pulls the reader on`, files.get(chapter.id)));
    }
  }
  let easyWins = [];
  let withoutSequel = [];
  for (const unit of units) {
    if (unit.sequel) {
      flushRun(withoutSequel, NO_SEQUEL_RUN, warnings, (run) => warn("pacing-no-sequel", `${run.length} scene units in a row with no sequel (${span(run)}): give the POV character room to react and decide`));
      withoutSequel = [];
      continue;
    }
    withoutSequel.push(unit);
    if (unit.outcome === "yes") {
      easyWins.push(unit);
    } else {
      flushRun(easyWins, EASY_WIN_RUN, warnings, (run) => warn("pacing-easy-wins", `${run.length} scenes in a row end in an outright yes (${span(run)}): raise the cost with yes-but or no-and`));
      easyWins = [];
    }
  }
  flushRun(easyWins, EASY_WIN_RUN, warnings, (run) => warn("pacing-easy-wins", `${run.length} scenes in a row end in an outright yes (${span(run)}): raise the cost with yes-but or no-and`));
  flushRun(withoutSequel, NO_SEQUEL_RUN, warnings, (run) => warn("pacing-no-sequel", `${run.length} scene units in a row with no sequel (${span(run)}): give the POV character room to react and decide`));
  let resolutions = [];
  for (const row of rows) {
    if (row.hook === "resolution") {
      resolutions.push(row);
    } else {
      flushRun(resolutions, RESOLUTION_RUN, warnings, (run) => warn("pacing-resolution-run", `${run.length} chapters in a row end on resolution (${span(run)}): readers can put the book down`));
      resolutions = [];
    }
  }
  flushRun(resolutions, RESOLUTION_RUN, warnings, (run) => warn("pacing-resolution-run", `${run.length} chapters in a row end on resolution (${span(run)}): readers can put the book down`));
  const written = rows.filter((row) => row.words > 0);
  const median = medianOf(written.map((row) => row.words));
  if (written.length >= 3) {
    for (const row of written) {
      if (row.words > median * 2) {
        warnings.push(warn("pacing-long-chapter", `${row.id} runs ${row.words} words, over twice the median chapter (${formatMedian(median)}): consider splitting it`, files.get(row.id)));
      } else if (row.words < median / 2) {
        warnings.push(warn("pacing-short-chapter", `${row.id} runs ${row.words} words, under half the median chapter (${formatMedian(median)}): check it earns its place`, files.get(row.id)));
      }
    }
  }
  const recorded = units.filter((unit) => !unit.sequel && SCENE_OUTCOMES.has(unit.outcome));
  return {
    rows,
    medianWords: formatMedian(median),
    totals: {
      scenes: units.filter((unit) => !unit.sequel).length,
      sequels: units.filter((unit) => unit.sequel).length,
      outcomesRecorded: recorded.length,
      setbacks: recorded.filter((unit) => unit.outcome !== "yes").length,
      hooks: rows.filter((row) => row.hook !== "").length
    },
    warnings
  };
}
function flushRun(run, minimum, warnings, message) {
  if (run.length >= minimum) {
    warnings.push(message(run));
  }
}
function span(run) {
  const first = run[0].id;
  const last = run[run.length - 1].id;
  return first === last ? first : `${first} to ${last}`;
}
function formatMedian(median) {
  return Math.round(median);
}
function medianOf(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function formatPacing(pacing) {
  const { totals } = pacing;
  const setbackShare = totals.outcomesRecorded === 0 ? "no outcomes recorded" : `${Math.round(totals.setbacks * 100 / totals.outcomesRecorded)}% of recorded outcomes are setbacks or complications`;
  const lines = [
    `Pacing: ${plural(totals.scenes, "scene")}, ${plural(totals.sequels, "sequel")}, ${totals.hooks} of ${plural(pacing.rows.length, "chapter")} with hooks`,
    `Outcomes: ${setbackShare}`,
    `Median chapter: ${pacing.medianWords} words`,
    ""
  ];
  if (pacing.rows.length === 0) {
    lines.push("- None: add chapters with story add chapter");
    return `${lines.join(`
`)}
`;
  }
  const outcomesOf = (row) => `${row.outcomes.yes}/${row.outcomes.no}/${row.outcomes["yes-but"]}/${row.outcomes["no-and"]}`;
  const columns = [
    { title: "Ch", value: (row) => String(row.number) },
    { title: "Words", value: (row) => String(row.words) },
    { title: "Scenes", value: (row) => String(row.scenes) },
    { title: "Sequels", value: (row) => String(row.sequels) },
    { title: "Outcomes (yes/no/yes-but/no-and)", value: outcomesOf, left: true }
  ].map((column) => ({ ...column, width: Math.max(column.title.length, ...pacing.rows.map((row) => column.value(row).length)) }));
  const cellText = (column, text) => column.left ? text.padEnd(column.width) : text.padStart(column.width);
  lines.push(`${columns.map((column) => column.title.padEnd(column.width)).join("  ")}  Hook`);
  for (const row of pacing.rows) {
    lines.push(`${columns.map((column) => cellText(column, column.value(row))).join("  ")}  ${row.hook || "-"}`);
  }
  return `${lines.join(`
`)}
`;
}

// src/story.js
var STORY_SCHEMA_VERSION = 2;
var REQUIRED_PATHS = [
  "story.md",
  "characters/_index.md",
  "worldbuilding/_index.md",
  "plot/_index.md",
  "plot/timeline.md",
  "chapters/_index.md",
  "scenes/_index.md",
  "continuity/state.md",
  "continuity/questions/_index.md",
  "continuity/promises/_index.md",
  "continuity/clues/_index.md",
  "glossary/_index.md"
];
var PROJECT_DIRECTORIES = [
  "characters",
  path11.join("worldbuilding", "locations"),
  path11.join("worldbuilding", "systems"),
  path11.join("worldbuilding", "factions"),
  path11.join("worldbuilding", "artifacts"),
  path11.join("plot", "arcs"),
  "chapters",
  "scenes",
  path11.join("continuity", "questions"),
  path11.join("continuity", "promises"),
  path11.join("continuity", "clues"),
  path11.join("glossary", "terms")
];
var INDEX_SCHEMAS = [
  [path11.join("characters", "_index.md"), "character-registry"],
  [path11.join("worldbuilding", "_index.md"), "world-registry"],
  [path11.join("plot", "_index.md"), "plot-registry"],
  [path11.join("plot", "timeline.md"), "timeline"],
  [path11.join("chapters", "_index.md"), "chapter-registry"],
  [path11.join("scenes", "_index.md"), "scene-registry"],
  [path11.join("continuity", "questions", "_index.md"), "question-registry"],
  [path11.join("continuity", "promises", "_index.md"), "promise-registry"],
  [path11.join("continuity", "clues", "_index.md"), "clue-registry"],
  [path11.join("glossary", "_index.md"), "glossary-registry"]
];
var STORY_STATUSES = new Set(["planning", "drafting", "in-progress", "revising", "complete", "abandoned"]);
var STORY_TENSES = new Set(["past", "present", "future", "mixed"]);
var CHARACTER_ROLES = new Set(["protagonist", "antagonist", "supporting", "minor", "narrator", "deuteragonist"]);
var CHARACTER_STATUSES = new Set(["alive", "deceased", "unknown", "missing", "cut"]);
var ARC_TYPES = new Set(["main", "subplot", "character", "thematic"]);
var ARC_STATUSES = new Set(["planned", "in-progress", "resolved"]);
var CHAPTER_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);
var CHARACTER_ARC_TYPES = new Set(["change-positive", "change-negative", "flat"]);
var DRAFT_MODES = new Set(["discovered", "outlined"]);
var SCENE_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);
var FACTION_TYPES = new Set(["family", "guild", "government", "military", "religion", "company", "community", "criminal", "other"]);
var FACTION_STATUSES = new Set(["active", "hidden", "declining", "defeated", "disbanded", "unknown"]);
var ARTIFACT_TYPES = new Set(["object", "weapon", "document", "technology", "relic", "symbol", "resource", "other"]);
var ARTIFACT_STATUSES = new Set(["active", "lost", "destroyed", "hidden", "transferred", "unknown"]);
var QUESTION_STATUSES = new Set(["open", "answered", "resolved", "dropped", "abandoned"]);
var PROMISE_STATUSES = new Set(["planned", "planted", "paid-off", "dropped", "abandoned"]);
var CLUE_STATUSES = new Set(["planned", "planted", "paid-off", "dropped", "abandoned"]);
var TERM_CATEGORIES = new Set(["person", "place", "faction", "artifact", "concept", "term", "other"]);
var STYLE_DIALECTS = new Set(["british", "american", "unspecified"]);
var STYLE_SHEET_FILE = "style-sheet.md";
var MATTER_PLACEMENTS = new Set(["front", "back"]);
var MATTER_PERMISSIONS = new Set(["not-needed", "pending", "granted", "public-domain"]);
var MATTER_DIR = "matter";
var RESEARCH_STATUSES = new Set(["open", "verified", "disputed"]);
var RESEARCH_ACCURACY = new Set(["must-be-accurate", "blended", "invented"]);
var RESEARCH_CONFIDENCE = new Set(["high", "medium", "low"]);
var RESEARCH_METHODS = new Set(["fact", "interview", "site-visit", "expert-review", "reading"]);
var RESEARCH_RISKS = new Set(["legal", "medical", "weapons", "safety", "cultural", "defamation", "technical"]);
var RESEARCH_DIR = "research";
var SETTLED_CHAPTER_STATUSES = new Set(["final", "complete"]);
var WRITTEN_CHAPTER_STATUSES = new Set(["revised", "final", "complete"]);
var COVER_MEDIA_TYPES = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};
var RELATIONSHIP_INVERSES = new Map([
  ["parent", ["child"]],
  ["child", ["parent"]],
  ["grandparent", ["grandchild"]],
  ["grandchild", ["grandparent"]],
  ["uncle", ["nephew", "niece"]],
  ["aunt", ["nephew", "niece"]],
  ["nephew", ["uncle", "aunt"]],
  ["niece", ["uncle", "aunt"]],
  ["mentor", ["student"]],
  ["student", ["mentor"]],
  ["employer", ["subordinate"]],
  ["subordinate", ["employer"]],
  ["former-supervisor", ["former-subordinate"]],
  ["former-subordinate", ["former-supervisor"]]
]);
var LEGACY_RELATIONSHIP_PAIRS = new Set([
  "former-supervisor>former-supervisor",
  "adversary>antagonist"
]);
var SYMMETRIC_RELATIONSHIPS = new Set([
  "sibling",
  "spouse",
  "partner",
  "friend",
  "ally",
  "rival",
  "enemy",
  "adversary",
  "cousin",
  "in-law",
  "colleague",
  "foil",
  "confidant",
  "love-interest"
]);
function createStoryProject(options) {
  const title = String(options.title ?? "").trim();
  if (!title) {
    throw usageError("A story title is required");
  }
  const cwd = options.cwd ?? process.cwd();
  const titleId = kebabCase(title);
  if (!titleId && options.dir === undefined) {
    throw usageError('Cannot derive a story id from title "' + title + '": pass --dir with an ASCII folder name, or use a title containing ASCII letters or digits');
  }
  const root = path11.resolve(cwd, options.dir ?? titleId);
  const existingStory = existingStoryData(root);
  const storyId = deriveStoryId(existingStory ? existingStory.title : title, root);
  assertPortableId(storyId, "story");
  assertPortableFolderName(path11.basename(root));
  if (!storyId) {
    throw usageError('Cannot derive a story id from title "' + title + '" or folder "' + path11.basename(root) + '": use an ASCII folder name with --dir');
  }
  if (lstatIfExists(root)?.isSymbolicLink()) {
    throw refusedError(`Refusing to use symlinked project directory: ${root}`);
  }
  if (fs7.existsSync(root) && !options.force) {
    throw refusedError(`${root} already exists. Use --force to add missing starter files; existing files are never overwritten.`);
  }
  const enclosing = enclosingStoryProject(root);
  if (enclosing) {
    throw refusedError(`Cannot create a story project inside another story project (${enclosing}); run init from the folder that contains it, or pass --dir ../<folder>`);
  }
  const ignoredOptions = existingStory ? unappliedStoryOptions(existingStory, title, options) : [];
  for (const option of ["tense", "pov", "genre"]) {
    if (options[option] !== undefined && String(options[option]).trim() === "") {
      throw usageError(`--${option} cannot be empty: leave it out to use the default`);
    }
  }
  if (options.tense !== undefined && !STORY_TENSES.has(options.tense)) {
    throw usageError(`Unsupported tense "${options.tense}": expected one of ${[...STORY_TENSES].join(", ")}`);
  }
  if (options.form !== undefined && !STORY_FORMS.has(options.form)) {
    throw usageError(`Unsupported form "${options.form}": expected one of ${[...STORY_FORMS.keys()].join(", ")}`);
  }
  const series = resolveSeriesOptions(root, cwd, options);
  const inherited = series.linked[0]?.data ?? {};
  const backlinks = planSeriesBacklinks(root, series);
  const themes = normalizeList(options.themes, ["change"]);
  options.beforeWrite?.(root, existingStory !== null);
  for (const directory of PROJECT_DIRECTORIES) {
    makeDirectories(path11.join(root, directory));
  }
  const storyWritten = writeStarterFile(path11.join(root, "story.md"), storyBible({
    title,
    storyId,
    series: series.series,
    bookNumber: series.bookNumber,
    follows: series.follows,
    precedes: series.precedes,
    genre: options.genre ?? inherited.genre ?? "fiction",
    subGenre: options.subGenre ?? inherited["sub-genre"] ?? "general",
    settingEra: options.settingEra ?? "unspecified",
    themes,
    pov: options.pov ?? inherited.pov ?? "third-person-limited",
    tense: options.tense ?? inherited.tense ?? "past",
    form: options.form,
    inherited: inheritedStoryFields(inherited),
    synopsis: options.synopsis ?? options.defaultSynopsis ?? "Add a 2-3 sentence synopsis here."
  }), { root });
  writeStarterFile(path11.join(root, "characters", "_index.md"), characterIndex(storyId, [], "", ""), { root });
  writeStarterFile(path11.join(root, "worldbuilding", "_index.md"), worldIndex(storyId, [], [], [], [], ""), { root });
  writeStarterFile(path11.join(root, "plot", "_index.md"), plotIndex(storyId, "three-act", [], "", ""), { root });
  writeStarterFile(path11.join(root, "plot", "timeline.md"), timeline(storyId), { root });
  writeStarterFile(path11.join(root, "chapters", "_index.md"), chapterIndex(storyId, []), { root });
  writeStarterFile(path11.join(root, "scenes", "_index.md"), sceneIndex(storyId, []), { root });
  writeStarterFile(path11.join(root, "continuity", "state.md"), continuityState(storyId), { root });
  writeStarterFile(path11.join(root, "continuity", "questions", "_index.md"), questionIndex(storyId, []), { root });
  writeStarterFile(path11.join(root, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), { root });
  writeStarterFile(path11.join(root, "continuity", "clues", "_index.md"), clueIndex(storyId, []), { root });
  writeStarterFile(path11.join(root, "glossary", "_index.md"), glossaryIndex(storyId, []), { root });
  writeStarterFile(path11.join(root, STYLE_SHEET_FILE), styleSheet(), { root });
  const gitignore = writeStarterGitignore(root);
  const linkedBooks = [];
  const existingLinks = storyWritten ? null : existingSeriesLinks(root);
  for (const { book, updated } of backlinks) {
    if (existingLinks && !linksInclude(existingLinks[book.field], book.root)) {
      continue;
    }
    writeFile(path11.join(book.root, "story.md"), updated, { root: book.root });
    linkedBooks.push(book.root);
  }
  return {
    root,
    storyId,
    linkedBooks,
    keptStory: existingStory !== null,
    ignoredOptions,
    gitignore,
    files: REQUIRED_PATHS.filter((entry) => entry.endsWith(".md"))
  };
}
var STARTER_GITIGNORE = `# Build output: story build and story export regenerate it from the markdown
dist/

# Left behind when a story command is interrupted
.story.lock
.*.story-*.tmp
.story-*.tmp

# OS and editor files
.DS_Store
Thumbs.db
*.swp
*.swo
*~
`;
function writeStarterGitignore(root) {
  const filePath = path11.join(root, ".gitignore");
  const existing = lstatIfExists(filePath);
  if (!existing) {
    writeFile(filePath, STARTER_GITIGNORE, { root });
    return "created";
  }
  if (!existing.isFile()) {
    return "kept";
  }
  let text;
  try {
    text = readTextFile(filePath);
  } catch {
    return "kept";
  }
  let ignoresDist = false;
  for (const line of text.split(/\r?\n/).map((entry) => entry.trim())) {
    if (/^(?:\*\*\/|\/)?dist(?:\/(?:\*{1,2})?)?$/.test(line)) {
      ignoresDist = true;
    } else if (/^!(?:\*\*\/|\/)?dist(?:\/|$)/.test(line)) {
      ignoresDist = false;
    }
  }
  return ignoresDist ? "kept" : "missing-dist";
}
function inheritedStoryFields(data) {
  const fields = {};
  const text = (value) => typeof value === "string" && value.trim() !== "";
  if (text(data["series-title"])) {
    fields["series-title"] = data["series-title"];
  }
  if (text(data.author)) {
    fields.author = data.author;
  }
  if (Array.isArray(data.authors) && data.authors.length > 0 && data.authors.every(text)) {
    fields.authors = data.authors;
  }
  if (text(data.language)) {
    fields.language = data.language;
  }
  return fields;
}
function existingStoryData(root) {
  if (!lstatIfExists(path11.join(root, "story.md"))) {
    return null;
  }
  try {
    return readBookFrontmatter(root) ?? {};
  } catch {
    return {};
  }
}
function unappliedStoryOptions(existing, title, options) {
  const ignored = [];
  const existingTitle = typeof existing.title === "string" || typeof existing.title === "number" ? String(existing.title).trim() : "";
  if (existingTitle !== "" && existingTitle !== title) {
    ignored.push("title");
  }
  const flags = [
    ["genre", "--genre"],
    ["subGenre", "--sub-genre"],
    ["settingEra", "--setting-era"],
    ["themes", "--themes"],
    ["pov", "--pov"],
    ["tense", "--tense"],
    ["form", "--form"],
    ["synopsis", "--synopsis"],
    ["series", "--series"],
    ["bookNumber", "--book-number"],
    ["follows", "--follows"],
    ["precedes", "--precedes"]
  ];
  for (const [key, flag] of flags) {
    const value = options[key];
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) {
      ignored.push(flag);
    }
  }
  return ignored;
}
function writeStarterFile(filePath, contents, options) {
  if (lstatIfExists(filePath)) {
    assertSafeProjectPath(filePath, options.root);
    return false;
  }
  writeFile(filePath, contents, options);
  return true;
}
function resolveSeriesOptions(root, cwd, options) {
  const linked = [];
  const rootKey = canonicalPath(root);
  for (const [field, inverse] of [["follows", "precedes"], ["precedes", "follows"]]) {
    for (const value of asArray(options[field]).filter((item) => typeof item === "string" && item.trim() !== "")) {
      const bookRoot = path11.resolve(cwd, value);
      const key = canonicalPath(bookRoot);
      if (bookRoot === root || key === rootKey) {
        throw usageError(`--${field} ${value} points at the new story itself`);
      }
      const earlier = linked.find((book) => book.key === key);
      if (earlier) {
        if (earlier.field === field) {
          continue;
        }
        throw usageError(`--${earlier.field} ${earlier.value} and --${field} ${value} name the same book; a book cannot be both earlier and later`);
      }
      let data;
      try {
        data = readBookFrontmatter(bookRoot);
      } catch (error) {
        throw projectError(`--${field} ${value}: ${path11.join(value, "story.md")}: ${error.message}`);
      }
      if (!data) {
        throw projectError(`--${field} ${value} is not a story project: missing story.md`);
      }
      if (!areSiblingBooks(bookRoot, root)) {
        throw usageError(`--${field} ${value} is not in the same parent folder as the new book; story series only follows links between sibling book folders, so create the book beside it`);
      }
      linked.push({ field, inverse, value, key, root: bookRoot, data });
    }
  }
  const linkedSeries = [...new Set(linked.map((book) => seriesId(book.data)).filter((value) => value !== undefined))];
  if (options.series !== undefined) {
    const conflict = linked.find((book) => seriesId(book.data) !== undefined && seriesId(book.data) !== options.series);
    if (conflict) {
      throw usageError(`--series ${options.series} conflicts with --${conflict.field} ${conflict.value}, which belongs to series ${seriesId(conflict.data)}`);
    }
  } else if (linkedSeries.length > 1) {
    throw usageError(`Linked books belong to different series: ${linkedSeries.sort().join(", ")}`);
  }
  const series = options.series ?? linkedSeries[0];
  if (series !== undefined && !isKebabId2(String(series))) {
    throw usageError(`Series id must be kebab-case: ${series}`);
  }
  let bookNumber;
  if (options.bookNumber !== undefined) {
    bookNumber = requireBookNumber(options.bookNumber);
    if (linked.length > 0) {
      const taken = seriesBookNumbers(linked).find((entry) => entry.bookNumber === bookNumber && canonicalPath(entry.root) !== rootKey);
      if (taken) {
        throw usageError(`Book number ${bookNumber} is already used by ${seriesLinkPath(cwd, taken.root) || "."}; book-number is publication order and must be unique in the series`);
      }
    }
  } else if (linked.length > 0) {
    const entries = seriesBookNumbers(linked, true);
    const all = linked.map((book) => book.data["book-number"]).concat(entries.map((entry) => entry.bookNumber)).filter(isBookNumber);
    bookNumber = all.length > 0 ? Math.floor(Math.max(...all)) + 1 : undefined;
  }
  const linkPaths = (field) => linked.filter((book) => book.field === field).map((book) => seriesLinkPath(root, book.root));
  return { linked, series, bookNumber, follows: linkPaths("follows"), precedes: linkPaths("precedes") };
}
function seriesBookNumbers(linked, requireComplete = false) {
  const entries = [];
  for (const book of linked) {
    const { books, complete, errors } = discoverSeriesBooks(book.root, scanProject);
    if (requireComplete && !complete) {
      throw projectError(`Cannot compute the next book-number: part of the series linked from --${book.field} ${book.value} could not be read (${errors[0].message}); fix it or pass --book-number`);
    }
    for (const entry of books) {
      if (isBookNumber(entry.bookNumber)) {
        entries.push({ bookNumber: entry.bookNumber, root: entry.root });
      }
    }
  }
  return entries;
}
function planSeriesBacklinks(root, series) {
  const planned = [];
  for (const book of series.linked) {
    const storyPath = path11.join(book.root, "story.md");
    const updated = withSeriesBacklink(book.root, book.inverse, root, series.series);
    if (updated === null) {
      continue;
    }
    try {
      fs7.accessSync(storyPath, fs7.constants.W_OK);
    } catch {
      throw refusedError(`Cannot add the series backlink to ${storyPath}: the file is not writable; nothing was created`);
    }
    planned.push({ book, updated });
  }
  return planned;
}
function existingSeriesLinks(root) {
  let data = {};
  try {
    data = readBookFrontmatter(root) ?? {};
  } catch {
    data = {};
  }
  return { follows: seriesLinks(root, data, "follows"), precedes: seriesLinks(root, data, "precedes") };
}
function enclosingStoryProject(root) {
  let current = path11.dirname(path11.resolve(root));
  let previous = null;
  while (current !== previous) {
    const storyPath = path11.join(current, "story.md");
    let isProject = false;
    try {
      isProject = fs7.statSync(storyPath).isFile() && /^﻿?---\r?\n/.test(readTextFile(storyPath).slice(0, 8));
    } catch {
      isProject = false;
    }
    if (isProject) {
      return current;
    }
    previous = current;
    current = path11.dirname(current);
  }
  return null;
}
function deriveStoryId(title, root) {
  return kebabCase(String(title ?? ""), { transliterate: false }) || kebabCase(path11.basename(root));
}
function storyIdMismatch(label, project) {
  return err("story-id-mismatch", `${label} story must be ${project.storyId} (run story reindex after changing the story.md title)`, label);
}
function scanProject(root) {
  const projectRoot = path11.resolve(root);
  const scanErrors = [];
  const storyPath = requireStoryFile(projectRoot);
  let story;
  try {
    story = readMarkdown(storyPath, projectRoot);
  } catch (error) {
    scanErrors.push(err("unreadable-file", `story.md: ${error.message}`, "story.md"));
    story = { data: { title: path11.basename(projectRoot) }, body: "", rawMarkdown: "", unreadable: true };
  }
  const storyId = deriveStoryId(story.data.title, projectRoot);
  const titleText = typeof story.data.title === "string" || typeof story.data.title === "number" ? String(story.data.title).trim() : "";
  let continuity = null;
  const continuityPath = path11.join(projectRoot, "continuity", "state.md");
  if (fs7.existsSync(continuityPath)) {
    try {
      continuity = readMarkdown(continuityPath, projectRoot);
    } catch (error) {
      scanErrors.push(err("unreadable-file", `${path11.join("continuity", "state.md")}: ${error.message}`, path11.join("continuity", "state.md")));
      continuity = null;
    }
  }
  const project = {
    root: projectRoot,
    story,
    storyId,
    title: titleText || path11.basename(projectRoot),
    fileErrors: scanErrors,
    characters: readEntityFiles(projectRoot, "characters", (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      role: data.role ?? "",
      status: data.status ?? "",
      arc: String(data.arc ?? ""),
      diedIn: String(data["died-in"] ?? ""),
      revivedIn: String(data["revived-in"] ?? ""),
      relationships: asArray(data.relationships),
      locations: asArray(data.locations),
      aliases: asArray(data.aliases),
      voiceWords: asArray(data["voice-words"]),
      voiceAvoid: asArray(data["voice-avoid"]),
      pronunciation: data.pronunciation
    }), scanErrors),
    locations: readEntityFiles(projectRoot, path11.join("worldbuilding", "locations"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      region: data.region ?? "",
      notableCharacters: asArray(data["notable-characters"]),
      routes: asArray(data.routes),
      setting: typeof data.setting === "string" ? data.setting : "",
      pronunciation: data.pronunciation
    }), scanErrors),
    systems: readEntityFiles(projectRoot, path11.join("worldbuilding", "systems"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      pronunciation: data.pronunciation
    }), scanErrors),
    factions: readEntityFiles(projectRoot, path11.join("worldbuilding", "factions"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      members: asArray(data.members),
      locations: asArray(data.locations),
      pronunciation: data.pronunciation
    }), scanErrors),
    artifacts: readEntityFiles(projectRoot, path11.join("worldbuilding", "artifacts"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      owner: data.owner ?? "",
      location: data.location ?? "",
      pronunciation: data.pronunciation
    }), scanErrors),
    arcs: readEntityFiles(projectRoot, path11.join("plot", "arcs"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      characters: asArray(data.characters),
      themes: asArray(data.themes)
    }), scanErrors),
    chapters: readEntityFiles(projectRoot, "chapters", (id, file, data, markdown) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      number: chapterNumber(data.number, file),
      numberValid: data.number === undefined || isPositiveIntegerValue(data.number),
      pov: scanId(data.pov),
      status: data.status ?? "",
      characters: asIdArray(data.characters),
      mentions: asIdArray(data.mentions),
      locations: asIdArray(data.locations),
      arcsAdvanced: asArray(data["arcs-advanced"]),
      declaredWordCount: data["word-count"] === undefined ? 0 : Number.isInteger(data["word-count"]) ? data["word-count"] : null,
      wordCountMissing: data["word-count"] === undefined,
      targetWords: Number.isInteger(data["target-words"]) && data["target-words"] > 0 ? data["target-words"] : 0,
      wordCount: wordCount(chapterProse(markdown.body)),
      unclosedComment: hasUnclosedComment(chapterProse(markdown.body)),
      todoMarkers: countTodoMarkers(chapterProse(markdown.body)),
      date: String(data.date ?? ""),
      time: String(data.time ?? ""),
      mode: String(data.mode ?? ""),
      strand: String(data.strand ?? ""),
      hasPostHocNotes: hasPostHocNotes(markdown.body),
      hook: typeof data.hook === "string" ? data.hook : "",
      choices: data.choices
    }), scanErrors).sort((left, right) => left.number - right.number || left.file.localeCompare(right.file, "en")),
    scenes: readEntityFiles(projectRoot, "scenes", (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      chapter: String(data.chapter ?? sceneChapterFromFile(file) ?? ""),
      scene: Number(data.scene ?? sceneNumberFromFile(file) ?? 0),
      pov: scanId(data.pov),
      location: scanId(data.location),
      status: data.status ?? "",
      characters: asIdArray(data.characters),
      mentions: asIdArray(data.mentions),
      arcsAdvanced: asArray(data["arcs-advanced"]),
      stateChanges: asArray(data["state-changes"]),
      date: String(data.date ?? ""),
      time: String(data.time ?? ""),
      travelHours: typeof data["travel-hours"] === "number" ? data["travel-hours"] : 0,
      sequel: typeof data.sequel === "boolean" ? data.sequel : false,
      outcome: typeof data.outcome === "string" ? data.outcome : "",
      dilemma: String(data.dilemma ?? ""),
      flashbackTo: String(data["flashback-to"] ?? ""),
      setting: typeof data.setting === "string" ? data.setting : ""
    }), scanErrors),
    questions: readEntityFiles(projectRoot, path11.join("continuity", "questions"), (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      introduced: String(data.introduced ?? ""),
      resolved: String(data.resolved ?? ""),
      characters: asArray(data.characters)
    }), scanErrors),
    promises: readEntityFiles(projectRoot, path11.join("continuity", "promises"), (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      planted: String(data.planted ?? ""),
      payoff: String(data.payoff ?? ""),
      arcs: asArray(data.arcs),
      characters: asArray(data.characters)
    }), scanErrors),
    clues: readEntityFiles(projectRoot, path11.join("continuity", "clues"), (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      planted: String(data.planted ?? ""),
      payoff: String(data.payoff ?? ""),
      significanceDelayed: data["significance-delayed"] === true,
      redHerring: data["red-herring"] === true,
      characters: asArray(data.characters),
      arcs: asArray(data.arcs)
    }), scanErrors),
    glossaryTerms: readEntityFiles(projectRoot, path11.join("glossary", "terms"), (id, file, data) => ({
      id,
      file,
      term: data.term ?? titleCaseSlug(id),
      category: data.category ?? "",
      aliases: asArray(data.aliases),
      pronunciation: data.pronunciation
    }), scanErrors),
    research: readEntityFiles(projectRoot, RESEARCH_DIR, (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      sources: asArray(data.sources),
      usedIn: asArray(data["used-in"]),
      accuracy: typeof data.accuracy === "string" ? data.accuracy : "",
      risk: asArray(data.risk),
      reviewedBy: asArray(data["reviewed-by"])
    }), scanErrors),
    matter: readEntityFiles(projectRoot, MATTER_DIR, (id, file, data, markdown) => ({
      id,
      file,
      title: String(data.title ?? titleCaseSlug(id)),
      placement: String(data.placement ?? ""),
      order: Number.isInteger(data.order) ? data.order : 0,
      heading: data.heading !== false,
      permission: typeof data.permission === "string" ? data.permission : "",
      empty: chapterProse(markdown.body).trim() === ""
    }), scanErrors).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, "en")),
    exemptions: readExemptions(projectRoot, scanErrors),
    styleSheet: readStyleSheet(projectRoot, scanErrors),
    progressLog: readOptionalRootFile(projectRoot, PROGRESS_FILE, scanErrors),
    continuity
  };
  sortScenesByChapter(project);
  return project;
}
function sortScenesByChapter(project) {
  const numbers = new Map(project.chapters.map((chapter) => [chapter.id, chapter.number]));
  const chapterOrder = (id) => {
    const number = numbers.get(id);
    if (Number.isFinite(number)) {
      return number;
    }
    const match = /-(\d+)$/.exec(id);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
  };
  project.scenes.sort((left, right) => {
    const leftOrder = chapterOrder(left.chapter);
    const rightOrder = chapterOrder(right.chapter);
    return (leftOrder === rightOrder ? 0 : leftOrder < rightOrder ? -1 : 1) || left.chapter.localeCompare(right.chapter, "en") || left.scene - right.scene || left.file.localeCompare(right.file, "en");
  });
}
function validateProject(root) {
  return validateProjectOf(scanProject(root));
}
function validateProjectOf(project) {
  const errors = [];
  const warnings = [];
  const projectRoot = project.root;
  for (const requiredPath of REQUIRED_PATHS) {
    if (!fs7.existsSync(path11.join(projectRoot, requiredPath))) {
      errors.push(err("missing-required-path", `Missing required path: ${requiredPath} (story migrate adds missing registries)`));
    }
  }
  for (const scanError of project.fileErrors ?? []) {
    errors.push(scanError);
  }
  validateStoryFrontmatter(project, errors);
  validateIndexFrontmatter(project, errors);
  validateCharacters(project, errors, warnings);
  validateLocations(project, errors, warnings);
  validateSystems(project, errors);
  validateFactions(project, errors);
  validateArtifacts(project, errors);
  validateArcs(project, errors);
  validateChapters(project, errors, warnings);
  validateScenes(project, errors);
  validateContinuityState(project, errors, warnings);
  validateQuestions(project, errors);
  validatePromises(project, errors);
  validateClues(project, errors);
  validateExemptions(project, errors, warnings);
  validateGlossaryTerms(project, errors);
  validateStyleSheet(project, errors, warnings);
  validateMatter(project, errors, warnings);
  validateResearch(project, errors, warnings);
  validateProgressLog(project, errors);
  validateFormRange(project, warnings);
  validatePublishing(project.story.data, errors, warnings);
  validatePronunciations(project, errors);
  validateTextFields(project, errors);
  validatePortablePaths(project, warnings);
  collectStrayFileWarnings(project, warnings);
  for (const file of ENTITY_SCAN_DIRS.flatMap((dir) => entityFileNames(projectRoot, dir))) {
    if (WINDOWS_RESERVED_ID.test(path11.basename(file, ".md").toLowerCase())) {
      warnings.push(warn("windows-reserved-name", `${file} uses a file name Windows reserves, so the project cannot be checked out on Windows; rename the entity`, file));
    }
  }
  const linksFor = (items, prefix = "") => items.map((item) => [`](${prefix}${path11.basename(item.file)})`, path11.relative(projectRoot, item.file)]);
  const indexChecks = [
    [path11.join("characters", "_index.md"), linksFor(project.characters)],
    [path11.join("worldbuilding", "_index.md"), linksFor(project.locations, "locations/").concat(linksFor(project.systems, "systems/")).concat(linksFor(project.factions, "factions/")).concat(linksFor(project.artifacts, "artifacts/"))],
    [path11.join("plot", "_index.md"), linksFor(project.arcs, "arcs/")],
    [path11.join("chapters", "_index.md"), linksFor(project.chapters)],
    [path11.join("scenes", "_index.md"), linksFor(project.scenes)],
    [path11.join("continuity", "questions", "_index.md"), linksFor(project.questions)],
    [path11.join("continuity", "promises", "_index.md"), linksFor(project.promises)],
    [path11.join("continuity", "clues", "_index.md"), linksFor(project.clues)],
    [path11.join("glossary", "_index.md"), linksFor(project.glossaryTerms, "terms/")],
    ...fs7.existsSync(path11.join(projectRoot, MATTER_DIR, "_index.md")) ? [[path11.join(MATTER_DIR, "_index.md"), linksFor(project.matter)]] : [],
    ...fs7.existsSync(path11.join(projectRoot, RESEARCH_DIR, "_index.md")) ? [[path11.join(RESEARCH_DIR, "_index.md"), linksFor(project.research)]] : []
  ];
  for (const [indexPath, links] of indexChecks) {
    let markdown;
    try {
      markdown = safeRead(path11.join(projectRoot, indexPath), projectRoot);
    } catch (error) {
      errors.push(err("unreadable-file", `${indexPath}: ${error.message}`, indexPath));
      continue;
    }
    for (const [link, file] of links) {
      if (!markdown.includes(link)) {
        warnings.push(warn("stale-registry", `${indexPath} does not list ${file}; run story reindex`, indexPath));
      }
    }
  }
  for (const chapter of project.chapters) {
    const file = path11.relative(projectRoot, chapter.file);
    if (chapter.declaredWordCount !== null && chapter.declaredWordCount !== chapter.wordCount) {
      warnings.push(warn("stale-word-count", chapter.wordCountMissing ? `${file} has no word-count (contains ${chapter.wordCount})` : `${file} declares ${plural(chapter.declaredWordCount, "word")} but contains ${chapter.wordCount}`, file));
    }
    if (chapter.todoMarkers > 0) {
      warnings.push(warn("todo-markers", `${file} has ${plural(chapter.todoMarkers, "[TODO marker")} in its prose, which every build prints: resolve ${chapter.todoMarkers === 1 ? "it" : "them"} or move ${chapter.todoMarkers === 1 ? "it" : "them"} into an HTML comment`, file));
    }
    if (chapter.unclosedComment) {
      warnings.push(warn("unclosed-comment", `${file} opens an HTML comment (<!--) that never closes, so the text after it shows in builds and word counts`, file));
    }
    if (!project.scenes.some((scene) => scene.chapter === chapter.id)) {
      warnings.push(warn("no-scene-records", `${file} has no machine-readable scene records`, file));
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
function validateLinks(root) {
  return validateLinksOf(scanProject(root));
}
function validateLinksOf(project) {
  const errors = [];
  const warnings = [];
  for (const scanError of project.fileErrors ?? []) {
    errors.push(scanError);
  }
  const characters = new Map(project.characters.map((item) => [item.id, item]));
  const locations = new Map(project.locations.map((item) => [item.id, item]));
  const chapters = new Map(project.chapters.map((item) => [item.id, item]));
  const arcs = new Map(project.arcs.map((item) => [item.id, item]));
  const factions = new Map(project.factions.map((item) => [item.id, item]));
  const hasCharacter = (id) => characters.has(id);
  const hasLocation = (id) => locations.has(id);
  const hasChapter = (id) => chapters.has(id);
  const existingNumbers = new Set(project.chapters.map((chapter) => chapter.number));
  const hasScheduledChapter = (id) => {
    if (chapters.has(id)) {
      return true;
    }
    const match = /^chapter-(\d+)$/.exec(id);
    const number = match ? Number.parseInt(match[1], 10) : 0;
    return number > 0 && !existingNumbers.has(number) && id === canonicalChapterId(number);
  };
  const hasArc = (id) => arcs.has(id);
  const artifactIds = new Set(project.artifacts.map((item) => item.id));
  const hasMention = (id) => characters.has(id) || artifactIds.has(id);
  for (const character of project.characters) {
    const label = relative2(project, character.file);
    for (const relationship of character.relationships) {
      if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
        continue;
      }
      const target = relationship.character;
      if (typeof target !== "string" || target === "") {
        continue;
      }
      if (target !== kebabCase(target)) {
        errors.push(err("id-not-kebab", `${label} relationship character ${target} must be kebab-case`, label));
        continue;
      }
      if (!characters.has(target)) {
        errors.push(err("missing-reference", `${label} references missing character ${target}`, label));
      } else {
        const backlinks = [];
        for (const entry of characters.get(target).relationships) {
          if (entry && typeof entry === "object" && !Array.isArray(entry) && entry.character === character.id) {
            backlinks.push(entry);
          }
        }
        if (backlinks.length === 0) {
          errors.push(err("missing-backlink", `${label} relationship to ${target} is missing backlink`, label));
        } else {
          const expectedTypes = inverseRelationshipTypes(relationship.type);
          let matched = expectedTypes.length === 0;
          const types = [];
          for (const entry of backlinks) {
            if (entry.type) {
              types.push(entry.type);
            }
            if (expectedTypes.includes(entry.type)) {
              matched = true;
            }
          }
          const legacy = !matched && types.some((type) => LEGACY_RELATIONSHIP_PAIRS.has(`${relationship.type}>${type}`));
          if (legacy) {
            warnings.push(warn("legacy-backlink-type", `${label} relationship ${relationship.type} to ${target} has backlink ${types.join(", ")}, a pairing from before story-skills 0.10.0; change the backlink to ${expectedTypes.join(" or ")}`, label));
          } else if (!matched) {
            errors.push(err("backlink-type-mismatch", `${label} relationship ${relationship.type} to ${target} expects backlink type ${expectedTypes.join(" or ")}, got ${types.join(", ") || "none"}`, label));
          }
        }
      }
    }
    for (const locationId of character.locations) {
      checkIdReference(errors, label, locationId, "location", hasLocation);
      if (typeof locationId === "string" && locationId !== "" && locationId === kebabCase(locationId) && locations.has(locationId) && !locations.get(locationId).notableCharacters.includes(character.id)) {
        errors.push(err("missing-backlink", `${label} location ${locationId} is missing notable-character backlink`, label));
      }
    }
    if (character.diedIn) {
      checkIdReference(errors, label, character.diedIn, "chapter", hasChapter);
    }
    if (character.revivedIn) {
      checkIdReference(errors, label, character.revivedIn, "chapter", hasChapter);
    }
  }
  for (const entity of [...project.characters, ...project.locations, ...project.factions]) {
    for (const [index, item] of asArray(entity.frontmatter.progressions).entries()) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        checkIdReference(errors, `${relative2(project, entity.file)} progressions[${index}]`, idText(item.from), "chapter", hasScheduledChapter, relative2(project, entity.file));
      }
    }
  }
  for (const location of project.locations) {
    const label = relative2(project, location.file);
    for (const route of location.routes) {
      const to = route && typeof route === "object" && !Array.isArray(route) ? idText(route.to) : "";
      if (to === "") {
        continue;
      }
      if (to === location.id) {
        errors.push(err("route-to-self", `${label} route points at itself`, label));
        continue;
      }
      checkIdReference(errors, `${label} route`, to, "location", hasLocation, label);
    }
    for (const characterId of location.notableCharacters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
      if (typeof characterId === "string" && characterId !== "" && characterId === kebabCase(characterId) && characters.has(characterId) && !characters.get(characterId).locations.includes(location.id)) {
        errors.push(err("missing-backlink", `${label} notable character ${characterId} is missing location backlink`, label));
      }
    }
  }
  for (const arc of project.arcs) {
    const label = relative2(project, arc.file);
    for (const characterId of arc.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }
  for (const chapter of project.chapters) {
    const label = relative2(project, chapter.file);
    if (chapter.pov) {
      const povText = String(chapter.pov);
      if (povText !== kebabCase(povText)) {
        errors.push(err("id-not-kebab", `${label} references POV character ${povText} which must be kebab-case`, label));
      } else if (!characters.has(chapter.pov)) {
        errors.push(err("missing-reference", `${label} references missing POV character ${chapter.pov}`, label));
      }
    }
    for (const characterId of chapter.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
    for (const mentionId of chapter.mentions) {
      checkIdReference(errors, label, mentionId, "character or artifact", hasMention);
    }
    for (const locationId of chapter.locations) {
      checkIdReference(errors, label, locationId, "location", hasLocation);
    }
    for (const arcId of chapter.arcsAdvanced) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
  }
  for (const faction of project.factions) {
    const label = relative2(project, faction.file);
    for (const characterId of faction.members) {
      checkIdReference(errors, label, characterId, "member", hasCharacter);
    }
    for (const locationId of faction.locations) {
      checkIdReference(errors, label, locationId, "location", hasLocation);
    }
  }
  for (const artifact of project.artifacts) {
    const label = relative2(project, artifact.file);
    if (artifact.owner) {
      const ownerText = String(artifact.owner);
      if (ownerText !== kebabCase(ownerText)) {
        errors.push(err("id-not-kebab", `${label} references owner ${ownerText} which must be kebab-case`, label));
      } else if (!characters.has(artifact.owner) && !factions.has(artifact.owner)) {
        errors.push(err("missing-reference", `${label} references missing owner ${artifact.owner}`, label));
      }
    }
    if (artifact.location) {
      checkIdReference(errors, label, artifact.location, "location", hasLocation);
    }
  }
  for (const scene of project.scenes) {
    const label = relative2(project, scene.file);
    if (scene.chapter) {
      const chapterText = String(scene.chapter);
      if (chapterText !== kebabCase(chapterText)) {
        errors.push(err("id-not-kebab", `${label} references chapter ${chapterText} which must be kebab-case`, label));
      } else if (!chapters.has(scene.chapter)) {
        errors.push(err("missing-reference", `${label} references missing chapter ${scene.chapter}`, label));
      }
    }
    if (scene.pov) {
      const povText = String(scene.pov);
      if (povText !== kebabCase(povText)) {
        errors.push(err("id-not-kebab", `${label} references POV character ${povText} which must be kebab-case`, label));
      } else if (!characters.has(scene.pov)) {
        errors.push(err("missing-reference", `${label} references missing POV character ${scene.pov}`, label));
      }
    }
    if (scene.location) {
      checkIdReference(errors, label, scene.location, "location", hasLocation);
    }
    for (const characterId of scene.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
    for (const mentionId of scene.mentions) {
      checkIdReference(errors, label, mentionId, "character or artifact", hasMention);
    }
    for (const arcId of scene.arcsAdvanced) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
  }
  for (const note of project.research) {
    const label = relative2(project, note.file);
    for (const chapterId of note.usedIn) {
      checkIdReference(errors, label, chapterId, "chapter", hasScheduledChapter);
    }
  }
  for (const question of project.questions) {
    const label = relative2(project, question.file);
    checkIdReference(errors, label, question.introduced, "chapter", question.status === "open" ? hasScheduledChapter : hasChapter);
    checkIdReference(errors, label, question.resolved, "chapter", hasChapter);
    for (const characterId of question.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }
  for (const promise of project.promises) {
    const label = relative2(project, promise.file);
    checkIdReference(errors, label, promise.planted, "chapter", promise.status === "planned" ? hasScheduledChapter : hasChapter);
    checkIdReference(errors, label, promise.payoff, "chapter", promise.status === "paid-off" ? hasChapter : hasScheduledChapter);
    for (const arcId of promise.arcs) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
    for (const characterId of promise.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }
  for (const clue of project.clues) {
    const label = relative2(project, clue.file);
    checkIdReference(errors, label, clue.planted, "chapter", clue.status === "planned" ? hasScheduledChapter : hasChapter);
    checkIdReference(errors, label, clue.payoff, "chapter", clue.status === "paid-off" ? hasChapter : hasScheduledChapter);
    for (const arcId of clue.arcs) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
    for (const characterId of clue.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }
  const branches = branchGraph(project);
  errors.push(...branches.missing.filter((choice) => !hasScheduledChapter(choice.to)).map((choice) => choice.finding));
  warnings.push(...branches.warnings);
  validateTimelineAndArcBodyRefs(project, chapters, errors, hasScheduledChapter);
  validateMatterBodyLinks(project, errors);
  validateSeriesLinks(project.root, project.story.data, errors);
  return { ok: errors.length === 0, errors, warnings };
}
function validateTimelineAndArcBodyRefs(project, chapters, errors, hasScheduledChapter) {
  const chapterIds = new Set(chapters.keys());
  const sceneIds = new Set(project.scenes.map((scene) => scene.id));
  const checkTokens = (label, body, hasChapterToken = (token) => chapterIds.has(token)) => {
    for (const token of extractChapterIdTokens(body)) {
      if (!hasChapterToken(token)) {
        errors.push(err("missing-reference", `${label} references missing chapter ${token}`, label));
      }
    }
    for (const token of extractSceneIdTokens(body)) {
      if (!sceneIds.has(token)) {
        errors.push(err("missing-reference", `${label} references missing scene ${token}`, label));
      }
    }
  };
  const timelinePath = path11.join(project.root, "plot", "timeline.md");
  if (fs7.existsSync(timelinePath)) {
    try {
      const raw = readTextFile(timelinePath);
      const body = parseFrontmatter(raw, timelinePath).body ?? raw;
      checkTokens(path11.join("plot", "timeline.md"), body);
      for (const target of extractMarkdownLinkTargets(body)) {
        checkBodyLinkTarget(project, path11.join("plot", "timeline.md"), target, errors);
      }
    } catch (error) {
      const message = `${path11.join("plot", "timeline.md")}: ${error.message}`;
      if (!hasMessage(errors, message)) {
        errors.push(err("unreadable-file", message, path11.join("plot", "timeline.md")));
      }
    }
  }
  for (const arc of project.arcs) {
    const label = relative2(project, arc.file);
    let body = "";
    try {
      body = readMarkdown(arc.file, project.root).body ?? "";
    } catch (error) {
      const message = label + ": " + error.message;
      if (!hasMessage(errors, message)) {
        errors.push(err("unreadable-file", message, label));
      }
      continue;
    }
    checkTokens(label, body, hasScheduledChapter);
    for (const target of extractMarkdownLinkTargets(body)) {
      checkBodyLinkTarget(project, label, target, errors);
    }
  }
}
function validateMatterBodyLinks(project, errors) {
  for (const matter of project.matter) {
    const label = relative2(project, matter.file);
    let body = "";
    try {
      body = readMarkdown(matter.file, project.root).body ?? "";
    } catch (error) {
      const message = `${label}: ${error.message}`;
      if (!hasMessage(errors, message)) {
        errors.push(err("unreadable-file", message, label));
      }
      continue;
    }
    for (const target of extractMarkdownLinkTargets(body)) {
      checkBodyLinkTarget(project, label, target, errors);
    }
  }
}
function checkBodyLinkTarget(project, label, target, errors) {
  const cleaned = String(target).trim();
  if (!cleaned || /^(https?:|mailto:|#)/i.test(cleaned)) {
    return;
  }
  const pathOnly = cleaned.split("#")[0].split("?")[0];
  if (pathOnly.includes("\\") && /\.md$/i.test(pathOnly)) {
    errors.push(err("link-backslash", `${label} links to ${cleaned} with a backslash; write ${portableSlashes(cleaned)} so the link works on every system`, label));
    return;
  }
  const base = path11.basename(pathOnly);
  if (!base.endsWith(".md")) {
    return;
  }
  const id = base.slice(0, -3);
  if (!id || id === "_index" || id.includes("*")) {
    return;
  }
  if (id !== kebabCase(id)) {
    errors.push(err("link-not-kebab", `${label} links to ${cleaned} which must be kebab-case`, label));
    return;
  }
  const resolved = path11.resolve(path11.dirname(path11.join(project.root, label)), pathOnly);
  if (!isPathInside(path11.resolve(project.root), resolved)) {
    const linkedBook = ["follows", "precedes"].flatMap((field) => seriesLinks(project.root, project.story.data, field)).find((bookRoot) => isPathInside(bookRoot, resolved));
    if (linkedBook && fs7.existsSync(resolved) && fs7.statSync(resolved).isFile() && isPathInside(canonicalPath(linkedBook), canonicalPath(resolved))) {
      return;
    }
    errors.push(linkedBook || !fs7.existsSync(resolved) ? err("broken-link", `${label} links to missing file ${cleaned}`, label) : err("link-outside-project", `${label} links to ${cleaned} which resolves outside the project`, label));
    return;
  }
  if (!fs7.existsSync(resolved) || !fs7.statSync(resolved).isFile()) {
    errors.push(err("broken-link", `${label} links to missing file ${cleaned}`, label));
    return;
  }
  if (!isPathInside(fs7.realpathSync(project.root), fs7.realpathSync(resolved))) {
    errors.push(err("link-outside-project", `${label} links to ${cleaned} which resolves outside the project`, label));
    return;
  }
  const known = new Set;
  for (const collection of [
    project.characters,
    project.locations,
    project.systems,
    project.factions,
    project.artifacts,
    project.arcs,
    project.chapters,
    project.scenes,
    project.questions,
    project.promises,
    project.clues,
    project.glossaryTerms,
    project.research,
    project.matter
  ]) {
    for (const item of collection) {
      known.add(item.id);
    }
  }
  if (!known.has(id)) {
    errors.push(err("broken-link", `${label} links to missing file ${cleaned}`, label));
  }
}
function checkProjectContinuity(root) {
  return checkContinuity(scanProject(root));
}
function knowledgeAtChapter(root, characterId, atChapterId, project = scanProject(root)) {
  const characters = new Map(project.characters.map((character) => [character.id, character]));
  if (!characters.has(characterId)) {
    const parseError = project.fileErrors.find((error) => error.file === path11.join("characters", `${characterId}.md`));
    throw parseError ? projectError(parseError.message) : usageError(`Unknown character ${characterId}`);
  }
  const chapterError = project.fileErrors.find((error) => error.file.startsWith(`chapters${path11.sep}`));
  if (chapterError) {
    throw projectError(chapterError.message);
  }
  const chronology = chapterChronology(project);
  const chapterNumbers = chronology.numbers;
  if (!chapterNumbers.has(atChapterId)) {
    throw usageError(`Unknown chapter ${atChapterId}`);
  }
  const stateError = project.fileErrors.find((error) => error.file === path11.join("continuity", "state.md"));
  if (stateError) {
    throw projectError(stateError.message);
  }
  const entries = [];
  const knowledge = project.continuity ? asArray(project.continuity.data["knowledge-state"]) : [];
  for (const [index, entry] of knowledge.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry) || idText(entry.character) !== characterId) {
      continue;
    }
    if (entry.knows === undefined || entry.knows === null || String(entry.knows).trim() === "") {
      throw projectError(`${path11.join("continuity", "state.md")} knowledge-state[${index}] is missing knows`);
    }
    const learnedIn = idText(entry["learned-in"]);
    if (learnedIn === "") {
      entries.push({ knows: String(entry.knows ?? ""), learnedIn: "" });
      continue;
    }
    if (chapterNumbers.has(learnedIn) && !chronology.after(learnedIn, atChapterId)) {
      entries.push({ knows: String(entry.knows ?? ""), learnedIn });
    }
  }
  return entries;
}
function entityStateAtChapter(root, kind, id, atChapterId, project = scanProject(root)) {
  const entityKind = normalizeKind(kind);
  if (!PROGRESSION_KINDS.includes(entityKind)) {
    throw usageError(`Only ${PROGRESSION_KINDS.join(", ")} records carry progressions, not ${entityKind}`);
  }
  const collection = { character: project.characters, location: project.locations, faction: project.factions }[entityKind];
  const entity = collection.find((entry) => entry.id === id);
  if (!entity) {
    const entityFile = path11.join(entityConfig(entityKind).dir, `${id}.md`);
    const parseError = project.fileErrors.find((error) => error.file === entityFile);
    throw parseError ? projectError(parseError.message) : usageError(`Unknown ${entityKind} ${id}`);
  }
  const chapterError = project.fileErrors.find((error) => error.file.startsWith(`chapters${path11.sep}`));
  if (chapterError) {
    throw projectError(chapterError.message);
  }
  return entityStateAt(entity.frontmatter, atChapterId, chapterChronology(project));
}
function draftingContext(root, targetId, options = {}) {
  const budget = options.budget === undefined ? DEFAULT_CONTEXT_BUDGET : requirePositiveInteger(options.budget, "Budget");
  const scenes = options.scenes === undefined ? DEFAULT_CONTEXT_SCENES : parseDecimalInteger(options.scenes);
  if (scenes === null) {
    throw usageError(`Scenes must be 0 or a positive integer, got ${options.scenes}`);
  }
  const project = scanProject(root);
  const blocking = project.fileErrors.find((error) => error.file.startsWith(`chapters${path11.sep}`) || error.file === path11.join("continuity", "state.md") || error.file === path11.join("scenes", `${targetId}.md`));
  if (blocking) {
    throw projectError(blocking.message);
  }
  return buildContext(project, targetId, (file) => readMarkdown(file, project.root).body, { budget, scenes });
}
function seriesReport(root) {
  const projectRoot = path11.resolve(root);
  requireStoryFile(projectRoot);
  return buildSeries(fs7.realpathSync(projectRoot), scanProject);
}
function projectChecks(project, overrides) {
  return {
    validation: applySeverity(validateProjectOf(project), overrides),
    links: applySeverity(validateLinksOf(project), overrides),
    continuity: applySeverity(checkContinuity(project), overrides)
  };
}
function projectReport(root, options = {}) {
  const project = scanProject(root);
  const { validation, links, continuity } = projectChecks(project, options.overrides);
  const totalWords = project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  return {
    root: project.root,
    title: project.title,
    storyId: project.storyId,
    schemaVersion: project.story.data["schema-version"],
    series: project.story.data.series,
    bookNumber: project.story.data["book-number"],
    genre: project.story.data.genre,
    subGenre: project.story.data["sub-genre"],
    form: typeof project.story.data.form === "string" ? project.story.data.form : "",
    status: project.story.data.status,
    pov: project.story.data.pov,
    tense: project.story.data.tense,
    targetWords: Number.isInteger(project.story.data["target-words"]) ? project.story.data["target-words"] : null,
    counts: {
      characters: project.characters.length,
      locations: project.locations.length,
      systems: project.systems.length,
      factions: project.factions.length,
      artifacts: project.artifacts.length,
      arcs: project.arcs.length,
      chapters: project.chapters.length,
      scenes: project.scenes.length,
      questions: project.questions.length,
      promises: project.promises.length,
      clues: project.clues.length,
      glossaryTerms: project.glossaryTerms.length,
      research: project.research.length,
      words: totalWords
    },
    chapters: project.chapters.map((chapter) => ({
      number: chapter.number,
      title: chapter.title,
      status: chapter.status,
      pov: chapter.pov,
      wordCount: chapter.wordCount
    })),
    arcs: project.arcs.map((arc) => ({
      name: arc.name,
      type: arc.type,
      status: arc.status,
      characters: arc.characters.length
    })),
    validation,
    links,
    continuity,
    actions: buildProjectActions(project, validation, links, continuity, options.displayPath)
  };
}
function formatProjectReport(report, options = {}) {
  const lines = [
    `# ${report.title}`,
    "",
    `Story ID: ${report.storyId}`,
    `Schema version: ${report.schemaVersion ?? "unset"}`,
    ...report.series === undefined ? [] : [`Series: ${report.series}${report.bookNumber === undefined ? "" : ` (book ${report.bookNumber})`}`],
    `Status: ${report.status ?? "unset"}`,
    `Genre: ${[report.genre, report.subGenre].filter(Boolean).join(" / ") || "unset"}`,
    ...report.form ? [`Form: ${report.form}`] : [],
    `POV/Tense: ${report.pov ?? "unset"} / ${report.tense ?? "unset"}`,
    "",
    "Inventory:",
    `- Characters: ${report.counts.characters}`,
    `- Locations: ${report.counts.locations}`,
    `- Systems: ${report.counts.systems}`,
    `- Factions: ${report.counts.factions}`,
    `- Artifacts: ${report.counts.artifacts}`,
    `- Arcs: ${report.counts.arcs}`,
    `- Chapters: ${report.counts.chapters}`,
    `- Scenes: ${report.counts.scenes}`,
    `- Questions: ${report.counts.questions}`,
    `- Promises: ${report.counts.promises}`,
    `- Clues: ${report.counts.clues}`,
    `- Glossary terms: ${report.counts.glossaryTerms}`,
    ...report.counts.research === 0 ? [] : [`- Research notes: ${report.counts.research}`],
    `- Total words: ${report.counts.words}`,
    ...report.targetWords > 0 ? [`- Target words: ${report.targetWords} (${formatPercent(report.counts.words * 100 / report.targetWords, 0)}%)`] : [],
    "",
    "Chapters:"
  ];
  if (report.chapters.length === 0) {
    lines.push("- None");
  } else {
    for (const chapter of report.chapters) {
      lines.push(`- ${chapter.number}. ${chapter.title} (${chapter.status}, ${chapter.wordCount} words, POV: ${chapter.pov || "unspecified"})`);
    }
  }
  lines.push("", "Arcs:");
  if (report.arcs.length === 0) {
    lines.push("- None");
  } else {
    for (const arc of report.arcs) {
      lines.push(`- ${arc.name} (${arc.type}, ${arc.status}, ${arc.characters} characters)`);
    }
  }
  lines.push("", "Checks:", `- Validate: ${formatCheck(report.validation)}`, `- Links: ${formatCheck(report.links)}`, `- Continuity: ${formatCheck(report.continuity)}`);
  if (options.actionable) {
    lines.push("", "Next Actions:");
    appendActionLines(lines, report.actions);
  }
  return `${lines.join(`
`)}
`;
}
function projectActions(root, options = {}) {
  const project = scanProject(root);
  const { validation, links, continuity } = projectChecks(project, options.overrides);
  return {
    root: project.root,
    title: project.title,
    storyId: project.storyId,
    actions: buildProjectActions(project, validation, links, continuity, options.displayPath),
    validation,
    links,
    continuity
  };
}
function formatActionReport(report) {
  const lines = [
    `# Next Writing Actions: ${report.title}`,
    "",
    `Checks: validate ${formatCheck(report.validation)}, links ${formatCheck(report.links)}, continuity ${formatCheck(report.continuity)}`,
    "",
    "Actions:"
  ];
  appendActionLines(lines, report.actions);
  return `${lines.join(`
`)}
`;
}
function formatDoctorReport(report) {
  const lines = [
    `# Story Doctor: ${report.title}`,
    "",
    `Root: ${report.root}`,
    "",
    "Checks:",
    `- Validate: ${formatCheck(report.validation)}`,
    `- Links: ${formatCheck(report.links)}`,
    `- Continuity: ${formatCheck(report.continuity)}`,
    "",
    "Actions:"
  ];
  appendActionLines(lines, report.actions);
  return `${lines.join(`
`)}
`;
}
function reindexProject(root) {
  return withProjectLock(root, () => reindexProjectUnlocked(root));
}
function reindexProjectUnlocked(root) {
  const project = scanProject(root);
  assertProjectParses(project, "reindex");
  const changed = [];
  const at = (...parts) => path11.join(project.root, ...parts);
  const existingPlot = readRegistrySource(at("plot", "_index.md"), project.root);
  let plotStructure = "three-act";
  if (fs7.existsSync(at("plot", "_index.md"))) {
    plotStructure = parseFrontmatter(existingPlot, "plot/_index.md").data.structure ?? "three-act";
  }
  writeRegistry(at("characters", "_index.md"), (existing) => characterIndex(project.storyId, project.characters, extractSection(existing, "Relationship Map"), extractSection(existing, "Family Trees")), changed, project.root);
  writeRegistry(at("worldbuilding", "_index.md"), (existing) => worldIndex(project.storyId, project.locations, project.systems, project.factions, project.artifacts, extractSection(existing, "World Overview")), changed, project.root);
  writeRegistry(at("plot", "_index.md"), (existing) => plotIndex(project.storyId, plotStructure, project.arcs, extractSection(existing, "Story Structure"), extractSection(existing, "Theme Tracking")), changed, project.root);
  writeRegistry(at("chapters", "_index.md"), () => chapterIndex(project.storyId, project.chapters), changed, project.root);
  writeRegistry(at("scenes", "_index.md"), () => sceneIndex(project.storyId, project.scenes), changed, project.root);
  writeRegistry(at("continuity", "questions", "_index.md"), () => questionIndex(project.storyId, project.questions), changed, project.root);
  writeRegistry(at("continuity", "promises", "_index.md"), () => promiseIndex(project.storyId, project.promises), changed, project.root);
  writeRegistry(at("continuity", "clues", "_index.md"), () => clueIndex(project.storyId, project.clues), changed, project.root);
  writeRegistry(at("glossary", "_index.md"), () => glossaryIndex(project.storyId, project.glossaryTerms), changed, project.root);
  if (fs7.existsSync(at(MATTER_DIR))) {
    writeRegistry(at(MATTER_DIR, "_index.md"), () => matterIndex(project.storyId, project.matter), changed, project.root);
  }
  if (fs7.existsSync(at(RESEARCH_DIR))) {
    writeRegistry(at(RESEARCH_DIR, "_index.md"), () => researchIndex(project.storyId, project.research), changed, project.root);
  }
  refreshStoryField(at("plot", "timeline.md"), project.storyId, changed, project.root);
  refreshStoryField(at("continuity", "state.md"), project.storyId, changed, project.root);
  return { changed };
}
function assertProjectParses(project, action, ignore = () => false) {
  const ignored = [STYLE_SHEET_FILE, PROGRESS_FILE, path11.join("continuity", "exemptions.md")];
  const errors = (project.fileErrors ?? []).filter((error) => !ignored.includes(error.file) && !ignore(error));
  if (errors.length > 0) {
    throw projectError(`Cannot ${action}: fix ${errors.length === 1 ? "this file first (story validate reports it)" : "these files first (story validate reports them)"}:
${errors.map((error) => `- ${error.message}`).join(`
`)}`);
  }
}
function readRegistrySource(filePath, root) {
  return safeRead(filePath, root).replace(/\r\n/g, `
`);
}
function writeRegistry(filePath, build, changed, root) {
  const raw = safeRead(filePath, root);
  const existing = raw.replace(/\r\n/g, `
`);
  const generated = build(existing);
  const custom = customSections(existing, generated);
  let contents = custom.length === 0 ? generated : `${generated.replace(/\n*$/, `
`)}
${custom.join(`

`)}
`;
  contents = keepRegistryFrontmatter(existing, contents);
  writeChanged(filePath, raw.includes(`\r
`) ? contents.replace(/\n/g, `\r
`) : contents, changed, root);
}
function keepRegistryFrontmatter(existing, contents) {
  let current;
  let next;
  try {
    current = parseFrontmatter(existing).data;
    next = parseFrontmatter(contents);
  } catch {
    return contents;
  }
  return replaceFrontmatter(existing, { ...current, ...next.data }, next.body);
}
function customSections(existing, generated) {
  const valuePattern = /:\s*\d[\d,]*$/;
  const valueHeadings = new Set;
  const unclaimed = new Map;
  for (const heading of markdownHeadings(generated).filter((entry) => entry.level === 2)) {
    const hasValue = valuePattern.test(heading.text);
    const key = hasValue ? heading.text.replace(valuePattern, "") : heading.text;
    if (hasValue) {
      valueHeadings.add(key);
    }
    unclaimed.set(key, (unclaimed.get(key) ?? 0) + 1);
  }
  const body = existing.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = body.split(`
`);
  const headings = markdownHeadings(body);
  const sections = [];
  for (const [index, heading] of headings.entries()) {
    if (heading.level !== 2) {
      continue;
    }
    const stripped = heading.text.replace(valuePattern, "");
    const key = valueHeadings.has(stripped) ? stripped : heading.text;
    const claimed = (unclaimed.get(key) ?? 0) > 0;
    if (claimed) {
      unclaimed.set(key, unclaimed.get(key) - 1);
    }
    const stale = key !== heading.text;
    if (!claimed && !stale) {
      const end = index + 1 < headings.length ? headings[index + 1].line : lines.length;
      sections.push(lines.slice(heading.line, end).join(`
`).trim());
    }
  }
  return sections;
}
function markdownHeadings(markdown) {
  const lines = markdown.split(`
`);
  const fenced = fencedLineIndexes(lines);
  const headings = [];
  for (const [line, text] of lines.entries()) {
    const heading = fenced.has(line) ? null : /^(#{1,2}) +(.+?)[ \t]*$/.exec(text);
    if (heading) {
      headings.push({ level: heading[1].length, text: heading[2], line });
    }
  }
  return headings;
}
function refreshStoryField(filePath, storyId, changed, root) {
  if (!fs7.existsSync(filePath)) {
    return;
  }
  let raw;
  try {
    raw = readTextFile(filePath);
  } catch {
    return;
  }
  let parsed;
  try {
    parsed = parseFrontmatter(raw, filePath);
  } catch {
    return;
  }
  if (parsed.data.story === storyId) {
    return;
  }
  writeChanged(filePath, replaceFrontmatter(raw, {
    ...parsed.data,
    story: storyId
  }), changed, root);
}
function computeWordCounts(root, options = {}) {
  return options.write ? withProjectLock(root, () => computeWordCountsUnlocked(root, options)) : computeWordCountsUnlocked(root, options);
}
function computeWordCountsUnlocked(root, options = {}) {
  const project = scanProject(root);
  assertProjectParses(project, "count words");
  const chapters = [];
  for (const chapter of project.chapters) {
    chapters.push({
      number: chapter.number,
      title: chapter.title,
      file: path11.relative(project.root, chapter.file),
      wordCount: chapter.wordCount
    });
    if (options.write && chapter.declaredWordCount !== chapter.wordCount) {
      const markdown = readMarkdown(chapter.file, project.root);
      writeFile(chapter.file, replaceFrontmatter(markdown.rawMarkdown, {
        ...markdown.data,
        "word-count": wordCount(chapterProse(markdown.body))
      }), { root: project.root, unchangedFrom: markdown.rawMarkdown });
    }
  }
  if (options.write) {
    reindexProject(project.root);
  }
  return {
    chapters,
    total: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  };
}
function compareProject(root, options = {}) {
  const hasRef = typeof options.ref === "string" && options.ref !== "";
  const hasAgainst = typeof options.against === "string" && options.against !== "";
  if (hasRef === hasAgainst) {
    throw usageError("compare needs exactly one of --ref <git-ref> or --against <project-path>");
  }
  const project = scanProject(root);
  assertProjectParses(project, "compare");
  const anchors = [].concat(options.anchors ?? []);
  if (anchors.length > 0) {
    return mapProjectLabels(project, anchors, { hasRef, ...options });
  }
  const current = project.chapters.map((chapter) => comparableChapter(chapter.id, readMarkdown(chapter.file, project.root)));
  const warnings = [];
  let previous;
  let label;
  if (hasRef) {
    previous = chaptersAtGitRef(project.root, options.ref, warnings);
    label = `git ref ${options.ref}`;
  } else {
    const otherRoot = path11.resolve(options.cwd ?? process.cwd(), options.against);
    const other = scanProject(otherRoot);
    if (other.fileErrors.length > 0) {
      throw projectError(`Cannot read ${otherRoot}: ${other.fileErrors[0].message}`);
    }
    previous = other.chapters.map((chapter) => comparableChapter(chapter.id, readMarkdown(chapter.file, other.root)));
    label = otherRoot;
  }
  return {
    ok: project.fileErrors.length === 0,
    errors: [...project.fileErrors],
    warnings,
    label,
    ...compareChapters(previous, current)
  };
}
function normaliseAnchor(value) {
  const anchor = String(value).trim().replace(/^#/, "").toLowerCase();
  if (anchor === "") {
    throw usageError("--anchor needs a paragraph label from the review copy, such as ch03-p12");
  }
  return anchor;
}
function mapProjectLabels(project, anchors, options) {
  const labels = anchors.map(normaliseAnchor);
  const current = paragraphLabels(htmlBook(manuscriptParts(project, "map labels")));
  let previous;
  let label;
  if (options.hasRef) {
    label = `git ref ${options.ref}`;
    previous = withProjectAtGitRef(project.root, options.ref, (oldRoot) => labelsIn(oldRoot, label));
  } else {
    label = path11.resolve(options.cwd ?? process.cwd(), options.against);
    previous = labelsIn(label, label);
  }
  return { ok: true, errors: [], warnings: [], label, anchors: mapLabels(previous, current, labels) };
}
function labelsIn(root, label) {
  if (!fs7.existsSync(path11.join(root, "story.md"))) {
    throw projectError(`No story project (story.md) in ${label}`);
  }
  const project = scanProject(root);
  return paragraphLabels(htmlBook(manuscriptParts(project, `read labels from ${label}`)));
}
function withProjectAtGitRef(root, ref, read, flag = "compare --ref") {
  const { git } = gitAtRef(root, ref, flag);
  const blobs = git(["ls-tree", "-r", "-z", ref, "--", "."]).split("\x00").filter((record) => record !== "").map((record) => {
    const tab = record.indexOf("\t");
    const [mode, type, hash] = record.slice(0, tab).split(" ");
    return { mode, type, hash, name: record.slice(tab + 1) };
  }).filter((entry) => entry.type === "blob" && entry.mode.startsWith("100") && entry.name.endsWith(".md"));
  const contents = catBlobs(root, blobs.map((entry) => entry.hash));
  const dir = fs7.mkdtempSync(path11.join(os2.tmpdir(), "story-compare-"));
  try {
    blobs.forEach((entry, index) => {
      const target = path11.join(dir, ...entry.name.split("/"));
      if (/[\\:]/.test(entry.name) || !isPathInside(dir, target)) {
        return;
      }
      makeDirectories(path11.dirname(target));
      fs7.writeFileSync(target, contents[index]);
    });
    return read(dir);
  } finally {
    fs7.rmSync(dir, { recursive: true, force: true });
  }
}
function catBlobs(root, hashes) {
  const output = execFileSync("git", ["-C", root, "cat-file", "--batch"], { input: `${hashes.join(`
`)}
`, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  const contents = [];
  let cursor = 0;
  for (let index = 0;index < hashes.length; index += 1) {
    const headerEnd = output.indexOf(10, cursor);
    const size = Number(output.toString("utf8", cursor, headerEnd).split(" ")[2]);
    contents.push(output.subarray(headerEnd + 1, headerEnd + 1 + size));
    cursor = headerEnd + 1 + size + 1;
  }
  return contents;
}
function gitFailure(error, flag) {
  if (error && error.code === "ENOENT") {
    return `${flag} needs git, which was not found on PATH`;
  }
  const stderr = String(error?.stderr ?? "").trim();
  if (stderr === "" || /not a git repository/i.test(stderr)) {
    return `${flag} needs the project inside a git repository`;
  }
  return `${flag} could not run git: ${stderr.split(/\r?\n/)[0]}`;
}
function comparableChapter(id, markdown) {
  const prose = chapterProse(markdown.body);
  return {
    id,
    title: String(markdown.data.title ?? titleCaseSlug(id)),
    words: wordCount(prose),
    paragraphs: proseParagraphs2(prose)
  };
}
var UNSAFE_GIT_REF = /^-|[\u0000-\u001f\u007f:]/u;
function gitAtRef(root, ref, flag = "compare --ref") {
  if (UNSAFE_GIT_REF.test(ref)) {
    throw usageError(`Unsupported git ref: ${ref}`);
  }
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  let prefix;
  try {
    prefix = git(["rev-parse", "--show-prefix"]).trim();
  } catch (error) {
    throw projectError(gitFailure(error, flag));
  }
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    throw usageError(`Unknown git ref: ${ref}`);
  }
  if (prefix !== "") {
    try {
      git(["rev-parse", "--verify", "--quiet", `${ref}:${prefix.replace(/\/$/, "")}`]);
    } catch {
      throw projectError(`${prefix} does not exist at git ref ${ref}`);
    }
  }
  return { git, prefix };
}
function chaptersAtGitRef(root, ref, warnings) {
  const { git, prefix } = gitAtRef(root, ref);
  if (git(["ls-tree", "--name-only", ref, "--", "story.md"]).trim() === "") {
    warnings.push(warn("story-missing-at-ref", `story.md does not exist at git ref ${ref}: the project may not have existed then`, "story.md"));
  }
  const names = git(["ls-tree", "--name-only", ref, "--", "chapters/"]).split(`
`).map((name) => path11.posix.basename(name.trim())).filter((name) => CHAPTER_FILENAME_PATTERN.test(name)).sort();
  return names.map((name) => {
    const id = path11.basename(name, ".md");
    const raw = git(["show", `${ref}:${prefix}chapters/${name}`]);
    try {
      return comparableChapter(id, parseFrontmatter(raw, name));
    } catch {
      return comparableChapter(id, { data: {}, body: raw });
    }
  });
}
function similarityReport(root, options = {}) {
  const against = typeof options.against === "string" ? options.against.trim() : "";
  if (against === "") {
    throw usageError("similarity needs --against <file|folder|git-ref>: the text to compare the chapters with");
  }
  const { minWords } = similarityOptions(options);
  const project = scanProject(root);
  assertProjectParses(project, "check similarity");
  const chapters = labelledChapters(project, (file) => relative2(project, file));
  const cwd = options.cwd ?? process.cwd();
  const target = path11.resolve(options.againstFromProject ? project.root : cwd, against);
  const warnings = [];
  let references;
  let label;
  if (lstatIfExists(target) !== null) {
    const real = canonicalPath(target);
    const self = canonicalPath(project.root);
    if (real === self) {
      throw usageError(`similarity --against ${against} is this project: point it at other text, or at a git ref for an earlier draft`);
    }
    label = against;
    const own = new Set(project.chapters.map((chapter) => canonicalPath(chapter.file)));
    references = referenceDocuments(real, (file) => displayPath(cwd, target, real, file), self).filter((reference) => !own.has(canonicalPath(reference.path)));
  } else {
    label = `git ref ${against}`;
    try {
      references = withProjectAtGitRef(project.root, against, (oldRoot) => {
        if (!fs7.existsSync(path11.join(oldRoot, "story.md"))) {
          throw projectError(`No story project (story.md) at git ref ${against}`);
        }
        const old = scanProject(oldRoot);
        assertProjectParses(old, `read chapters at git ref ${against}`);
        return labelledChapters(old, (file) => `${against}:${path11.relative(oldRoot, file).split(path11.sep).join("/")}`);
      }, "similarity --against");
    } catch (error) {
      const reason = error.exitCode === EXIT_CODES.usage ? "no git ref has that name" : /needs the project inside a git repository/.test(error.message) ? "the project is not in a git repository, so it cannot be a git ref" : /not found on PATH/.test(error.message) ? "git was not found on PATH to read it as a git ref" : null;
      if (reason !== null) {
        throw usageError(`similarity --against ${against} is not a file or folder, and ${reason}`);
      }
      throw error;
    }
  }
  const report = compareSimilarity(chapters, references, { minWords, label });
  if (report.reference.words === 0) {
    warnings.push(warn("similarity-no-reference-text", `${label} has no text to compare with: check --against names the files you meant`));
  }
  return { ...report, warnings: [...warnings, ...report.warnings] };
}
function displayPath(cwd, typed, real, file) {
  const inside = path11.relative(real, file);
  const shown = path11.relative(cwd, inside === "" ? typed : path11.join(typed, inside));
  return shown.split(path11.sep).join("/") || path11.basename(file);
}
function labelledChapters(project, fileName) {
  if (project.chapters.length === 0) {
    return [];
  }
  let book;
  try {
    book = bookChapters(project, "check similarity");
  } catch {
    return project.chapters.map((chapter) => ({
      ...textDocument(chapter.file, fileName(chapter.file), chapterProse(readMarkdown(chapter.file, project.root).body)),
      title: chapter.title ?? ""
    }));
  }
  const { meta, chapters } = book;
  const html = htmlBook({ title: project.title, meta, front: [], chapters, back: [] });
  return html.parts.map((part, index) => ({
    file: fileName(project.chapters[index].file),
    path: project.chapters[index].file,
    title: chapters[index].title,
    paragraphs: labelledParagraphs(part).filter((entry) => entry !== null).map((entry) => ({ label: entry.label, text: entry.paragraph.text }))
  }));
}
var REFERENCE_TEXT_FILE = /\.(?:md|markdown|txt)$/i;
function referenceDocuments(target, display, self) {
  if (!fs7.statSync(target).isDirectory()) {
    return [textDocument(target, display(target))];
  }
  const documents = [];
  for (const entry of referenceEntries(target, self)) {
    if (entry.project) {
      const other = scanProject(entry.path);
      assertProjectParses(other, `read chapters in ${display(entry.path)}`);
      documents.push(...labelledChapters(other, display));
    } else {
      documents.push(textDocument(entry.path, display(entry.path)));
    }
  }
  return documents;
}
function referenceEntries(dir, self, depth = 0, collected = []) {
  if (fs7.existsSync(path11.join(dir, "story.md"))) {
    if (canonicalPath(dir) !== self) {
      collected.push({ project: true, path: dir });
    }
    return collected;
  }
  const entries = fs7.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIPPED_SCAN_DIRECTORIES.has(entry.name) || entry.name === "_index.md") {
      continue;
    }
    const fullPath = path11.join(dir, entry.name);
    if (entry.isDirectory() && depth < MAX_SCAN_DEPTH) {
      referenceEntries(fullPath, self, depth + 1, collected);
    } else if (entry.isFile() && REFERENCE_TEXT_FILE.test(entry.name)) {
      collected.push({ project: false, path: fullPath });
      if (collected.length > MAX_SCAN_FILES) {
        throw projectError(`Too many text files in ${dir}: the reference exceeds the ${MAX_SCAN_FILES} file limit`);
      }
    }
  }
  return collected;
}
function textDocument(file, name, prose = null) {
  let text = prose ?? readTextFile(file).replace(/^﻿/, "");
  text = text.replace(/\r\n?/g, `
`);
  if (prose === null && /\.(?:md|markdown)$/i.test(file)) {
    text = chapterProse(withoutLeadingFrontmatter(text));
  }
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter((paragraph) => paragraph !== "").map((paragraph, index) => ({ label: `p${index + 1}`, text: paragraph }));
  return { file: name, path: file, paragraphs };
}
function projectProgress(root, options = {}) {
  const today = options.date === undefined ? localDate() : String(options.date).trim();
  const dateError = storyDateError(today);
  if (dateError !== "" || today.trim() === "") {
    throw usageError(`progress --date ${dateError || "must be a YYYY-MM-DD date"}`);
  }
  let project = scanProject(root);
  const words = project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  let logged = null;
  if (options.log) {
    assertProjectParses(project, "log progress");
    if (project.fileErrors.some((error) => error.file === PROGRESS_FILE)) {
      throw projectError(`Cannot log progress: ${PROGRESS_FILE} does not parse`);
    }
    const logErrors = [];
    validateProgressLog(project, logErrors);
    if (logErrors.length > 0) {
      throw projectError(`Cannot log progress until ${PROGRESS_FILE} is fixed: ${logErrors.map((error) => error.message).join("; ")}`);
    }
    const filePath = path11.join(project.root, PROGRESS_FILE);
    const existing = project.progressLog;
    const sessions = withSession(asArray(existing?.data.sessions), today, words);
    const contents = existing === null ? progressLogFile(sessions) : replaceFrontmatter(existing.rawMarkdown, { ...existing.data, sessions });
    writeFile(filePath, contents, { root: project.root });
    logged = { file: filePath, date: today, words };
    project = scanProject(root);
  }
  const data = project.story.data;
  const errors = [...project.fileErrors];
  if (data["target-words"] !== undefined) {
    requireInteger(data, "target-words", "story.md", errors, 1);
  }
  validateDeadline(data, errors);
  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    logged,
    ...computeProgress({
      words,
      target: Number.isInteger(data["target-words"]) && data["target-words"] > 0 ? data["target-words"] : null,
      deadline: typeof data.deadline === "string" ? data.deadline : null,
      today,
      chapters: project.chapters.map((chapter) => ({ id: chapter.id, words: chapter.wordCount, target: chapter.targetWords })),
      sessions: cleanSessions(project.progressLog?.data.sessions)
    })
  };
}
function progressLogFile(sessions) {
  return `${stringifyFrontmatter({ type: "progress-log", sessions })}# Progress Log

\`story progress --log\` records the manuscript word count for the day in the frontmatter above. Set \`target-words\` and \`deadline\` in \`story.md\`, and \`target-words\` on chapters, to measure against them.
`;
}
function storyTimeline(root) {
  const project = scanProject(root);
  return {
    ok: project.fileErrors.length === 0,
    errors: [...project.fileErrors],
    warnings: [],
    totalChapters: project.chapters.length,
    ...buildTimeline(project)
  };
}
function clueReport(root) {
  const project = scanProject(root);
  const matrix = buildClueMatrix(project);
  return { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], ...matrix };
}
function diagramProject(root, options = {}) {
  const project = scanProject(root);
  const text = buildDiagram(project, options.kind);
  const result = { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], warnings: [], text };
  if (options.out === undefined || !result.ok) {
    return result;
  }
  const output = resolveOutputPath(project, options.out, "");
  writeFile(output.outFile, text, output.writeOptions);
  return { ...result, outFile: output.outFile };
}
function projectPasses(root, change = {}) {
  const project = scanProject(root);
  const storyPath = path11.join(project.root, "story.md");
  const passes = readPasses(project.story.data);
  const wantsChange = Boolean(change.init) || change.start !== undefined || change.done !== undefined;
  if (!wantsChange) {
    return { passes, changed: false };
  }
  if (project.fileErrors.some((error) => error.file === "story.md")) {
    throw projectError("story.md cannot be parsed; fix it before recording revision passes");
  }
  const passErrors = [];
  validatePasses(project.story.data, "story.md", passErrors);
  if (passErrors.length > 0) {
    throw projectError(`Fix revision-passes in story.md before changing it: ${passErrors.map((error) => error.message).join("; ")}`);
  }
  const current = asArray(project.story.data["revision-passes"]);
  const next = updatePasses(current, change);
  const notes = addedPassNotes(readPasses({ "revision-passes": current }), readPasses({ "revision-passes": next }));
  const raw = safeRead(storyPath, project.root);
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  if (changed) {
    writeFile(storyPath, replaceFrontmatter(raw, { ...parseFrontmatter(raw, storyPath).data, "revision-passes": next }), { root: project.root });
  }
  return { passes: readPasses({ "revision-passes": next }), changed, notes };
}
function namesReport(root, candidates) {
  const list = asArray(candidates).map((name) => String(name).trim()).filter(Boolean);
  if (list.length === 0) {
    throw usageError("Usage: story names <name...> [--path <project>]");
  }
  const project = scanProject(root);
  const result = checkNames(list, existingNames(project));
  const errors = [...project.fileErrors, ...result.errors];
  return { ok: errors.length === 0, errors, warnings: result.warnings, results: result.results };
}
function voicesReport(root, options = {}) {
  const project = scanProject(root);
  const chapters = options.passage === undefined ? project.chapters.map((chapter) => ({
    id: chapter.id,
    paragraphs: proseParagraphs2(chapterProse(readMarkdown(chapter.file, project.root).body, " "))
  })) : [{ id: PASSAGE_LABEL, paragraphs: proseParagraphs2(passageProse(options.passage)) }];
  const errors = options.passage === undefined ? [...project.fileErrors] : passageErrors(project);
  return { ok: errors.length === 0, errors, ...buildVoices(project, chapters) };
}
function pacingReport(root) {
  const project = scanProject(root);
  return { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], ...buildPacing(project) };
}
var PASSAGE_LABEL = "stdin";
function passageProse(text) {
  return chapterProse(withoutLeadingFrontmatter(String(text).replace(/\r\n?/g, `
`)), " ");
}
function passageErrors(project) {
  return project.fileErrors.filter((error) => !/^(?:chapters|scenes)[\\/]/.test(error.file));
}
function proseReport(root, options = {}) {
  const thresholds = proseThresholds(options);
  if (options.passage !== undefined) {
    return prosePassageReport(root, options.passage, thresholds, options);
  }
  const project = scanProject(root);
  const errors = [...project.fileErrors];
  const warnings = [];
  const names = [...project.characters.map((character) => character.name), ...existingNames(project).map((entry) => entry.name)];
  const rules = proseRules(project.styleSheet?.data, names);
  const profile = proseBaseline(project, rules, options, warnings);
  const chapters = [];
  for (const chapter of project.chapters) {
    const label = relative2(project, chapter.file);
    const prose = chapterProse(readMarkdown(chapter.file, project.root).body, " ");
    chapters.push(lintProse(label, chapter.title, prose, rules, thresholds, profile, warnings));
  }
  const phrases = repeatedPhrases(chapters.map((chapter) => chapter.analysis));
  const similar = similarNames(project.characters);
  for (const [left, right] of similar) {
    warnings.push(warn("prose-similar-names", `characters ${left.id} and ${right.id} have similar first names (${left.name} / ${right.name})`));
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    styleSheet: project.styleSheet !== null,
    words: chapters.reduce((sum, chapter) => sum + chapter.analysis.words, 0),
    chapters,
    phrases,
    similarNames: similar,
    thresholds: thresholdSummary(thresholds),
    baseline: profile
  };
}
function lintProse(label, title, prose, rules, thresholds, profile, warnings) {
  const analysis = analyzeChapter(prose, rules);
  const compared = profile !== null && profile.usable;
  warnings.push(...chapterFindings(label, analysis, thresholds, { baseline: compared }));
  if (profile === null) {
    return { file: label, title, analysis };
  }
  const figures = baselineFigures(analysis, profile, contentWords(prose, rules));
  warnings.push(...baselineFindings(label, analysis, figures, profile));
  return { file: label, title, analysis, baseline: figures };
}
function proseBaseline(project, rules, options, warnings) {
  const listed = asArray(project?.styleSheet?.data?.samples).filter((entry) => typeof entry === "string" && entry.trim() !== "");
  const wanted = options.baseline === undefined ? listed.length > 0 : isTruthy(options.baseline);
  if (!wanted) {
    return null;
  }
  if (listed.length === 0) {
    throw usageError(`prose --baseline needs samples in ${STYLE_SHEET_FILE}: list files or folders of your own prose, such as samples: [../book-one]`);
  }
  const samples = [];
  const self = canonicalPath(project.root);
  const own = new Set(project.chapters.map((chapter) => canonicalPath(chapter.file)));
  for (const entry of listed) {
    const sample = entry.trim();
    if (path11.isAbsolute(sample) || /^[A-Za-z]:/.test(sample)) {
      warnings.push(warn("style-sample-missing", `${STYLE_SHEET_FILE} samples entry ${sample} must be a path relative to the project folder, such as ../book-one, so it is left out`, STYLE_SHEET_FILE));
      continue;
    }
    const problem = sampleProblem(project, sample);
    if (problem !== null) {
      warnings.push(problem);
      continue;
    }
    const target = path11.resolve(project.root, sample);
    const real = canonicalPath(target);
    let documents;
    try {
      documents = referenceDocuments(real, (file) => displayPath(project.root, target, real, file), self).filter((document) => !own.has(canonicalPath(document.path)));
    } catch (error) {
      warnings.push(warn("style-sample-unreadable", `${STYLE_SHEET_FILE} samples entry ${sample} cannot be read, so it is left out: ${error.message}`, STYLE_SHEET_FILE));
      continue;
    }
    for (const document of documents) {
      const prose = document.paragraphs.map((paragraph) => paragraph.text).join(`

`);
      samples.push({ file: document.file, analysis: analyzeChapter(prose, rules), sentenceLengths: sentenceLengths(prose), contentWords: contentWords(prose, rules) });
    }
  }
  const profile = baselineProfile(samples);
  if (!profile.usable) {
    warnings.push(warn("prose-baseline-small", `${STYLE_SHEET_FILE} samples hold ${profile.narrationWords} narration words, too few to compare with (at least 2000): the fixed filter-word and adverb limits apply instead`, STYLE_SHEET_FILE));
  }
  return profile;
}
function sampleProblem(project, sample) {
  const target = path11.resolve(project.root, sample);
  if (lstatIfExists(target) === null) {
    return warn("style-sample-missing", `${STYLE_SHEET_FILE} samples entry ${sample} names no file or folder in reach of the project`, STYLE_SHEET_FILE);
  }
  const real = canonicalPath(target);
  const self = canonicalPath(project.root);
  const chapters = path11.join(self, "chapters");
  if (real === self || real === chapters || isPathInside(chapters, real)) {
    return warn("style-sample-own-chapters", `${STYLE_SHEET_FILE} samples entry ${sample} names this project's own chapters, which are what the samples are compared with: list an earlier book or approved drafts kept elsewhere`, STYLE_SHEET_FILE);
  }
  return null;
}
function thresholdSummary(thresholds) {
  return { maxFilterWords: thresholds.filterPerThousand, maxAdverbs: thresholds.adverbsPerThousand, maxBookisms: thresholds.maxBookisms };
}
function prosePassageReport(root, passage, thresholds, options = {}) {
  const project = root === null ? null : scanProject(root);
  const errors = project === null ? [] : passageErrors(project);
  const names = project === null ? [] : [...project.characters.map((character) => character.name), ...existingNames(project).map((entry) => entry.name)];
  const rules = proseRules(project?.styleSheet?.data, names);
  const warnings = [];
  const profile = project === null ? null : proseBaseline(project, rules, options, warnings);
  const chapter = lintProse(PASSAGE_LABEL, "passage", passageProse(passage), rules, thresholds, profile, warnings);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    passage: true,
    styleSheet: Boolean(project?.styleSheet),
    words: chapter.analysis.words,
    chapters: [chapter],
    phrases: repeatedPhrases([chapter.analysis]),
    similarNames: [],
    thresholds: thresholdSummary(thresholds),
    baseline: profile
  };
}
function exportManuscript(root, options = {}) {
  const project = scanProject(root);
  const manuscript = manuscriptParts(project, options.generatedBy === undefined ? "export" : "build");
  const output = resolveOutputPath(project, options.out, path11.join("dist", "manuscript.md"), options.enforceRoot);
  const generatedBy = options.generatedBy ?? "story export";
  const lines = [`# ${manuscript.title}`, "", `<!-- Generated by ${generatedBy}. -->`, ""];
  const pushMatter = (entry) => {
    if (entry.heading) {
      lines.push(`# ${entry.title}`, "");
    }
    lines.push(entry.body, "");
  };
  manuscript.front.forEach(pushMatter);
  for (const chapter of manuscript.chapters) {
    lines.push(`# ${chapter.heading}`, "", chapter.body, "");
  }
  manuscript.back.forEach(pushMatter);
  writeFile(output.outFile, `${lines.join(`
`).trimEnd()}
`, output.writeOptions);
  return { outFile: output.outFile, chapters: project.chapters.length, warnings: manuscript.warnings };
}
function buildBook(root, options = {}) {
  const format = normalizeBuildFormat(options.format ?? "markdown");
  if (options.trim !== undefined && format !== "print") {
    throw usageError("--trim applies only to --format print");
  }
  const trim = options.trim === undefined ? DEFAULT_TRIM : String(options.trim).trim().toLowerCase();
  if (!TRIM_SIZES.has(trim)) {
    throw usageError(`Unsupported trim size: ${options.trim}. Supported sizes: ${[...TRIM_SIZES.keys()].join(", ")}`);
  }
  if (options.stamp !== undefined && format !== "html") {
    throw usageError("--stamp applies only to --format html");
  }
  const stamp = options.stamp === undefined ? "" : String(options.stamp).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (options.stamp !== undefined && stamp === "") {
    throw usageError("--stamp needs a label, such as a date, commit, or round name");
  }
  if (options.noteUrl !== undefined && format !== "html") {
    throw usageError("--note-url applies only to --format html");
  }
  const noteUrl = options.noteUrl === undefined ? "" : String(options.noteUrl).replace(/[\u0000-\u0020\u007f]+/g, "");
  if (options.noteUrl !== undefined && !/^https?:\/\/[^/?#]/i.test(noteUrl)) {
    throw usageError("--note-url needs an http or https address, such as a GitHub new-issue link");
  }
  if (options.shunn && format !== "docx") {
    throw usageError("--shunn applies only to --format docx (use --format shunn for a Shunn markdown manuscript)");
  }
  const project = scanProject(root);
  const extension = BUILD_EXTENSIONS[format];
  const output = resolveOutputPath(project, options.out, path11.join("dist", `${fileStem(project.storyId)}.${extension}`));
  if (format === "markdown") {
    const result = exportManuscript(project.root, {
      out: output.outFile,
      generatedBy: "story build",
      enforceRoot: output.enforceRoot
    });
    return { ...result, format };
  }
  if (format === "fountain") {
    const screenplay = screenplayOutline(project, bookChapters(project));
    writeFile(output.outFile, fountainScript(screenplay), output.writeOptions);
    return { outFile: output.outFile, chapters: project.chapters.length, format, warnings: screenplay.warnings };
  }
  const manuscript = manuscriptParts(project);
  if (format === "metadata") {
    const book = htmlBook(manuscript);
    const words = manuscript.chapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0);
    writeFile(output.outFile, metadataSheet({
      title: manuscript.title,
      data: project.story.data,
      meta: manuscript.meta,
      words,
      pages: { "5.5x8.5": estimateBookPages(book, "5.5x8.5"), "6x9": estimateBookPages(book, "6x9") },
      hasCopyrightPage: manuscript.front.concat(manuscript.back).some((entry) => entry.copyright),
      coverReady: coverIsReady(project),
      pendingPermissions: project.matter.filter((entry) => entry.permission === "pending").map((entry) => entry.id),
      todoChapters: project.chapters.filter((chapter) => chapter.todoMarkers > 0).map((chapter) => chapter.id)
    }), output.writeOptions);
  } else if (format === "twee" || format === "ink") {
    const { branches, ifid } = interactiveStory(project, manuscript, format);
    const passages = branches.passages.map((passage, position) => ({ name: passage.chapter.id, body: manuscript.chapters[position].body, links: passage.links }));
    writeFile(output.outFile, format === "twee" ? tweeSource({ title: manuscript.title, ifid, start: passages[0].name, passages }) : inkSource({ title: manuscript.title, author: manuscript.author, ifid, branching: branches.branching, passages }), output.writeOptions);
    manuscript.warnings.push(...branches.warnings);
  } else if (format === "narration") {
    writeFile(output.outFile, narrationScript(manuscript, pronunciationGuide(project)), output.writeOptions);
  } else if (format === "html" || format === "print") {
    const book = htmlBook(manuscript);
    const text = format === "html" ? reviewHtml(book, { stamp, noteUrl }) : printHtml(book, trim);
    writeFile(output.outFile, text, output.writeOptions);
  } else if (format === "shunn") {
    writeShunnMarkdown(output.outFile, manuscript, shunnMeta(project), output.writeOptions);
  } else if (format === "epub") {
    const cover = project.story.data.cover === undefined ? null : coverImage(project);
    writeEpub(output.outFile, project.storyId, { ...manuscript, cover }, output.writeOptions);
  } else if (options.shunn) {
    writeShunnDocx(output.outFile, manuscript, shunnMeta(project), output.writeOptions);
  } else {
    writeDocx(output.outFile, manuscript, output.writeOptions);
  }
  return { outFile: output.outFile, chapters: manuscript.chapters.length, format, warnings: manuscript.warnings };
}
function interactiveStory(project, manuscript, format) {
  const branches = branchGraph(project);
  const pinned = project.story.data.ifid;
  const node = format === "twee" ? "a passage" : "a knot";
  const problems = [
    ...project.chapters.filter((chapter) => !isKebabId2(chapter.id)).map((chapter) => `${relative2(project, chapter.file)}: chapter file names must be kebab-case to name ${node}`),
    ...branches.problems.map((problem) => problem.message),
    ...branches.missing.map((choice) => choice.finding.message),
    ...pinned === undefined || isIfid(pinned) ? [] : ["story.md ifid must be a version 4 UUID, such as 3F2C9A61-7B1D-4E8A-9C3B-2A6D5E4F1B07"]
  ];
  if (problems.length > 0) {
    throw projectError(`Cannot build ${format} until these are fixed:
${problems.join(`
`)}`);
  }
  const ifid = pinned ?? derivedIfid(project.storyId);
  if (pinned === undefined) {
    manuscript.warnings.push(warn("derived-ifid", `story.md has no ifid, so the build derived ${ifid} from the story id; add ifid: ${ifid} to story.md to keep it if the title changes`, "story.md"));
  }
  return { branches, ifid };
}
function screenplayOutline(project, book) {
  const warnings = [];
  const locations = new Map(project.locations.map((location) => [location.id, location]));
  const characters = new Map(project.characters.map((character) => [character.id, character]));
  const bookChapters = new Set(project.chapters.map((chapter) => chapter.id));
  const unset = new Set;
  const noScenes = [];
  const chronology = chapterChronology(project);
  for (const scene of project.scenes) {
    if (!bookChapters.has(scene.chapter)) {
      warnings.push(warn("scene-outside-book", `${relative2(project, scene.file)} names chapter ${scene.chapter || "(none)"}, which is not in the book, and is left out of the screenplay`, relative2(project, scene.file)));
    }
  }
  const chapters = project.chapters.map((chapter, index) => {
    const scenes = project.scenes.filter((scene) => scene.chapter === chapter.id).sort((left, right) => left.scene - right.scene || left.file.localeCompare(right.file, "en")).map((scene) => {
      const location = locations.get(scene.location);
      const place = location === undefined ? {} : entityStateAt(location.frontmatter, chapter.id, chronology).state;
      const setting = scene.setting || (typeof place.setting === "string" ? place.setting : "");
      const notes = [];
      if (scene.location === "") {
        notes.push("No location on the scene record: set location for the heading.");
        warnings.push(warn("scene-no-location", `${relative2(project, scene.file)} has no location; its screenplay heading reads LOCATION TBD`, relative2(project, scene.file)));
      } else if (location === undefined) {
        notes.push(`No location record for ${scene.location}: fix the scene's location or add the location.`);
        warnings.push(warn("scene-unknown-location", `${relative2(project, scene.file)} names location ${scene.location}, which has no record; run story links`, relative2(project, scene.file)));
      }
      if (scene.location !== "" && !SCENE_SETTINGS.has(setting)) {
        notes.push(`No setting: add setting (interior, exterior, or both) to ${location ? `${relative2(project, location.file)} or the scene` : "the scene"} for INT. or EXT.`);
        if (location !== undefined) {
          unset.add(scene.location);
        }
      }
      const cast = [];
      for (const id of [scene.mentions.includes(scene.pov) ? "" : scene.pov, ...scene.characters]) {
        const name = id === "" ? "" : String(characters.get(id)?.name ?? titleCaseSlug(id));
        if (name !== "" && !cast.includes(name)) {
          cast.push(name);
        }
      }
      return {
        id: scene.id,
        title: String(scene.title),
        locationName: scene.location === "" ? "" : String(place.name ?? titleCaseSlug(scene.location)),
        setting,
        date: scene.date,
        time: scene.time || chapter.time,
        cast,
        dilemma: scene.dilemma,
        outcome: scene.outcome,
        flashbackTo: scene.flashbackTo,
        notes
      };
    });
    if (scenes.length === 0) {
      noScenes.push(chapter.id);
    }
    return { id: chapter.id, heading: book.chapters[index].heading, scenes };
  });
  if (noScenes.length > 0) {
    warnings.push(warn("chapter-no-scenes", `No scene records for ${noScenes.join(", ")}: the screenplay has no headings for ${noScenes.length === 1 ? "that chapter" : "those chapters"}`));
  }
  if (unset.size > 0) {
    warnings.push(warn("scene-no-setting", `No setting (interior, exterior, or both) for ${[...unset].sort().join(", ")}: their scene headings are forced without INT. or EXT.`));
  }
  return {
    title: project.title,
    authors: book.meta.authors,
    form: typeof project.story.data.form === "string" ? project.story.data.form : "",
    chapters,
    warnings
  };
}
function synopsisBook(root, options = {}) {
  const pages = options.pages === undefined ? 1 : parseDecimalInteger(options.pages);
  if (pages !== 1 && pages !== 3) {
    throw usageError(`Unsupported synopsis length: ${options.pages}. Supported pages: 1, 3`);
  }
  const project = scanProject(root);
  assertProjectParses(project, "build a synopsis");
  const budget = pages === 1 ? 500 : 1500;
  const title = project.title;
  const premise = synopsisPremise(project);
  const detail = pages === 1 ? { setup: 2, rising: 2, climax: 1, resolution: 1 } : { setup: 4, rising: 8, climax: 2, resolution: 2 };
  let text = renderSynopsis(title, premise, project, 0, detail);
  if (wordCount(text) > budget) {
    text = renderSynopsis(title, premise, project, 1, detail);
  }
  if (wordCount(text) > budget) {
    text = renderSynopsis(title, premise, project, 2, detail);
  }
  if (wordCount(text) > budget) {
    text = truncateWords(text, budget);
  }
  if (options.out === undefined) {
    return { text };
  }
  const output = resolveOutputPath(project, options.out, path11.join("dist", `${fileStem(project.storyId)}.synopsis.md`));
  writeFile(output.outFile, text, output.writeOptions);
  return { text, outFile: output.outFile };
}
var SCAFFOLD_SENTENCES = new Set([
  "Add a 2-3 sentence synopsis here.",
  "Replace with a 2-3 sentence synopsis.",
  "Initial state and inciting pressure.",
  "First escalation.",
  "Second escalation.",
  "Reversal or complication.",
  "Decision point or highest tension.",
  "What changes because of this arc."
]);
function synopsisPremise(project) {
  const sentences = synopsisSentences(extractSection(project.story.body, "Synopsis")).filter((sentence) => !/^Imported from .+\.$/.test(sentence));
  return sentences.length > 0 ? sentences[0] : "No logline recorded.";
}
function synopsisSentences(section) {
  const text = scanComments(String(section), " ").text.split(/\r?\n/).map((line) => {
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (!item) {
      return line;
    }
    const content = item[1].trim();
    return /[.!?]$/.test(content) ? content : `${content}.`;
  }).join(`
`);
  return splitSentences(text, { capitalStart: false }).filter((sentence) => !SCAFFOLD_SENTENCES.has(sentence));
}
function takeSentences(text, count) {
  return synopsisSentences(text).slice(0, count);
}
function renderSynopsis(title, premise, project, level, detail) {
  const lines = [`# Synopsis: ${title}`, "", `Logline: ${premise}`, ""];
  for (const arc of project.arcs) {
    const markdown = readMarkdown(arc.file, project.root);
    lines.push(`## ${arc.name}`, "");
    const setup = takeSentences(extractSection(markdown.body, "Setup"), detail.setup);
    if (setup.length > 0) {
      lines.push(setup.join(" "), "");
    }
    if (level === 0) {
      const rising = takeSentences(extractSection(markdown.body, "Rising Action"), detail.rising);
      if (rising.length > 0) {
        lines.push(rising.join(" "), "");
      }
    }
    const climax = takeSentences(extractSection(markdown.body, "Climax"), detail.climax);
    const resolution = level < 2 ? takeSentences(extractSection(markdown.body, "Resolution"), detail.resolution) : [];
    const chain = climax.concat(resolution);
    if (chain.length > 0) {
      lines.push(`Because ${lowercaseCommonStart(chain.join(" "))}`, "");
    }
  }
  return `${lines.join(`
`).trimEnd()}
`;
}
var COMMON_OPENERS = new Set([
  "a",
  "an",
  "the",
  "he",
  "she",
  "they",
  "it",
  "we",
  "you",
  "his",
  "her",
  "their",
  "its",
  "our",
  "my",
  "your",
  "this",
  "that",
  "these",
  "those",
  "when",
  "after",
  "before",
  "once",
  "in",
  "at",
  "on",
  "with",
  "without",
  "by",
  "as",
  "if",
  "even",
  "every",
  "all",
  "both",
  "no",
  "none",
  "only",
  "then",
  "there",
  "here",
  "one",
  "each"
]);
function lowercaseCommonStart(text) {
  const first = /^[A-Za-z]+(?=\s)/.exec(text)?.[0] ?? "";
  return COMMON_OPENERS.has(first.toLowerCase()) ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
}
function truncateWords(text, budget) {
  const kept = [];
  let used = 0;
  for (const line of text.trimEnd().split(`
`)) {
    const words = wordCount(line);
    if (used + words <= budget) {
      kept.push(line);
      used += words;
      continue;
    }
    const tokens = [];
    for (const token of line.split(/\s+/).filter((part) => part !== "")) {
      const tokenWords = wordCount(token);
      if (used + tokenWords > budget) {
        break;
      }
      tokens.push(token);
      used += tokenWords;
    }
    if (tokens.length > 0 && !/^#/.test(line)) {
      kept.push(tokens.join(" "));
    }
    break;
  }
  return `${kept.join(`
`).replace(/(?:\n(?:#[^\n]*)?[ \t]*)+$/, "")}…
`;
}
function shunnMeta(project) {
  const data = project.story.data;
  return {
    title: project.title,
    author: publishingMeta(data).authors.join(" and "),
    contact: asArray(data.contact),
    words: project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    shortForm: data.form === "short-story" || data.form === "flash"
  };
}
function migrateProject(root) {
  return withProjectLock(root, () => migrateProjectUnlocked(root));
}
function migrateProjectUnlocked(root) {
  const projectRoot = path11.resolve(root);
  const storyPath = requireStoryFile(projectRoot);
  assertProjectParses(scanProject(projectRoot), "migrate");
  const story = readMarkdown(storyPath, projectRoot);
  const newerVersion = newerSchemaVersion(story.data["schema-version"]);
  if (newerVersion !== null) {
    throw projectError(newerSchemaMessage(newerVersion));
  }
  const storyId = deriveStoryId(story.data.title, projectRoot);
  const changed = [];
  for (const directory of PROJECT_DIRECTORIES) {
    ensureDirectory(path11.join(projectRoot, directory), changed, projectRoot);
  }
  ensureFile(path11.join(projectRoot, "plot", "timeline.md"), timeline(storyId), changed, projectRoot);
  ensureFile(path11.join(projectRoot, "scenes", "_index.md"), sceneIndex(storyId, []), changed, projectRoot);
  ensureFile(path11.join(projectRoot, "continuity", "state.md"), continuityState(storyId), changed, projectRoot);
  ensureFile(path11.join(projectRoot, "continuity", "questions", "_index.md"), questionIndex(storyId, []), changed, projectRoot);
  ensureFile(path11.join(projectRoot, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), changed, projectRoot);
  ensureFile(path11.join(projectRoot, "continuity", "clues", "_index.md"), clueIndex(storyId, []), changed, projectRoot);
  ensureFile(path11.join(projectRoot, "glossary", "_index.md"), glossaryIndex(storyId, []), changed, projectRoot);
  if (story.data["schema-version"] !== STORY_SCHEMA_VERSION) {
    writeFile(storyPath, replaceFrontmatter(story.rawMarkdown, {
      ...story.data,
      "schema-version": STORY_SCHEMA_VERSION
    }), { root: projectRoot });
    changed.push(storyPath);
  }
  const reindexed = reindexProject(projectRoot);
  return { root: projectRoot, changed: changed.concat(reindexed.changed) };
}
function newerSchemaVersion(value) {
  const version = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof version === "number" && Number.isFinite(version) && version > STORY_SCHEMA_VERSION ? version : null;
}
function newerSchemaMessage(version) {
  return `story.md uses schema-version ${version}, newer than this CLI (${STORY_SCHEMA_VERSION}); upgrade story-skills`;
}
var ENTITY_ENUM_OPTIONS = {
  character: [["role", CHARACTER_ROLES], ["status", CHARACTER_STATUSES]],
  faction: [["type", FACTION_TYPES], ["status", FACTION_STATUSES]],
  artifact: [["type", ARTIFACT_TYPES], ["status", ARTIFACT_STATUSES]],
  arc: [["type", ARC_TYPES], ["status", ARC_STATUSES]],
  chapter: [["status", CHAPTER_STATUSES], ["hook", CHAPTER_HOOKS], ["mode", DRAFT_MODES]],
  scene: [["status", SCENE_STATUSES], ["outcome", SCENE_OUTCOMES]],
  question: [["status", QUESTION_STATUSES]],
  promise: [["status", PROMISE_STATUSES]],
  clue: [["status", CLUE_STATUSES]],
  term: [["category", TERM_CATEGORIES]],
  matter: [["placement", MATTER_PLACEMENTS]],
  research: [["status", RESEARCH_STATUSES], ["accuracy", RESEARCH_ACCURACY], ["confidence", RESEARCH_CONFIDENCE], ["method", RESEARCH_METHODS]]
};
function requireEntityEnumOptions(kind, options) {
  for (const [field, allowed] of ENTITY_ENUM_OPTIONS[kind] ?? []) {
    const value = options[field];
    if (value !== undefined && !allowed.has(String(value))) {
      throw usageError(`Unsupported ${kind} ${field} "${value}": expected one of ${[...allowed].join(", ")}`);
    }
  }
}
var REFERENCE_OPTIONS = ["chapter", "planted", "payoff", "introduced", "resolved", "used-in", "location", "locations", "character", "characters", "mention", "mentions", "member", "members", "owner", "arc", "arcs", "controlled-by"];
var REFERENCE_EXAMPLES = {
  chapter: "chapter-01",
  planted: "chapter-01",
  payoff: "chapter-01",
  introduced: "chapter-01",
  resolved: "chapter-01",
  "used-in": "chapter-01",
  location: "port-kestrel",
  locations: "port-kestrel",
  arc: "the-long-road",
  arcs: "the-long-road",
  "controlled-by": "harbor-council",
  owner: "mara-quill or harbor-council"
};
function assertReferenceOptions(kind, options) {
  for (const option of REFERENCE_OPTIONS) {
    if (kind === "character" && (option === "arc" || option === "arcs")) {
      continue;
    }
    for (const value of normalizeList(options[option], [])) {
      if (!isKebabId2(value)) {
        throw usageError(`--${option} "${value}" must be a kebab-case id (such as ${REFERENCE_EXAMPLES[option] ?? "mara-quill"})`);
      }
    }
  }
  if ((kind === "chapter" || kind === "scene") && options.pov !== undefined && String(options.pov).trim() !== "" && !isKebabId2(String(options.pov).trim())) {
    throw usageError(`--pov "${options.pov}" must be a character id (such as mara-quill)`);
  }
}
var SCALAR_REFERENCE_OPTIONS = {
  scene: ["chapter", "location", "pov"],
  chapter: ["pov"],
  artifact: ["owner", "location"],
  location: ["controlled-by"],
  promise: ["planted", "payoff"],
  clue: ["planted", "payoff"],
  question: ["introduced", "resolved"]
};
function normalizeScalarOptions(kind, options) {
  const next = { ...options };
  for (const option of SCALAR_REFERENCE_OPTIONS[kind] ?? []) {
    if (options[option] === undefined || options[option] === true) {
      continue;
    }
    const values = normalizeList(options[option], []);
    if (values.length > 1) {
      throw usageError(`--${option} takes one id for ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind}, got ${values.join(", ")}`);
    }
    next[option] = values[0] ?? "";
  }
  return next;
}
function kindsSharingFields(kind) {
  const shared = new Map;
  for (const [field, kinds] of Object.entries(REFERENCE_FIELD_KINDS)) {
    if (!kinds.includes(kind)) {
      continue;
    }
    for (const other of kinds) {
      if (other !== kind) {
        shared.set(other, (shared.get(other) ?? []).concat(field));
      }
    }
  }
  return shared;
}
function assertUnambiguousId(root, kind, id) {
  for (const [other, fields] of kindsSharingFields(kind)) {
    if (fs7.existsSync(path11.join(root, entityConfig(other).dir, `${id}.md`))) {
      throw usageError(`${id} is already a ${other} id, and ${fields.join(" and ")} references could not tell the ${kind} from the ${other}. Choose another name, or pass --id`);
    }
  }
}
var CHAPTER_REFERENCE_OPTIONS = ["chapter", "planted", "payoff", "introduced", "resolved", "used-in"];
function assertChapterReferences(project, options) {
  const byNumber = new Map(project.chapters.map((chapter) => [chapter.number, chapter.id]));
  for (const option of CHAPTER_REFERENCE_OPTIONS) {
    for (const value of normalizeList(options[option], [])) {
      const match = /^chapter-(\d+)$/.exec(value);
      if (!match || project.chapters.some((chapter) => chapter.id === value)) {
        continue;
      }
      const number = Number.parseInt(match[1], 10);
      if (number === 0) {
        throw usageError(`--${option} ${value}: chapter numbers start at 1`);
      }
      if (byNumber.has(number)) {
        throw usageError(`--${option} ${value}: did you mean ${byNumber.get(number)}?`);
      }
      if (value !== canonicalChapterId(number)) {
        throw usageError(`--${option} ${value}: did you mean ${canonicalChapterId(number)}?`);
      }
    }
  }
}
function canonicalChapterId(number) {
  return `chapter-${String(number).padStart(2, "0")}`;
}
function assertStatusChapters(project, kind, options) {
  const written = (value) => project.chapters.some((chapter) => chapter.id === String(value ?? "").trim());
  const given = (value) => String(value ?? "").trim() !== "";
  const status = String(options.status ?? "");
  const refuse = (option, value, reason) => {
    throw usageError(`--${option} ${String(value).trim()} is not written yet: ${reason}`);
  };
  if (kind === "promise" || kind === "clue") {
    if ((status === "planted" || status === "paid-off") && given(options.planted) && !written(options.planted)) {
      refuse("planted", options.planted, `a ${status} ${kind} needs its planted chapter. Leave --status unset to record it as planned`);
    }
    if (status === "paid-off" && given(options.payoff) && !written(options.payoff)) {
      refuse("payoff", options.payoff, `a paid-off ${kind} needs its payoff chapter. Use --status planted until the payoff is drafted`);
    }
  }
  if (kind === "question") {
    if (given(options.resolved) && !written(options.resolved)) {
      refuse("resolved", options.resolved, "a question's resolved chapter must exist. Add --resolved once the answer is drafted");
    }
    if (status !== "" && status !== "open" && given(options.introduced) && !written(options.introduced)) {
      refuse("introduced", options.introduced, `a ${status} question needs its introduced chapter`);
    }
  }
}
function createEntity(root, options) {
  return withProjectLock(root, () => createEntityUnlocked(root, options));
}
function createEntityUnlocked(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "add");
  const kind = normalizeKind(options.kind);
  requireEntityEnumOptions(kind, options);
  assertReferenceOptions(kind, options);
  assertChapterReferences(project, options);
  options = normalizeScalarOptions(kind, options);
  if ((kind === "location" || kind === "system") && options.type !== undefined && String(options.type).trim() === "") {
    throw usageError(`--type cannot be empty: leave it out to use "other"`);
  }
  if ((kind === "promise" || kind === "clue") && options.status === undefined && options.planted !== undefined && !project.chapters.some((chapter) => chapter.id === String(options.planted).trim())) {
    options = { ...options, status: "planned" };
  }
  assertStatusChapters(project, kind, options);
  const name = String(options.name ?? "").trim();
  if (!name) {
    throw usageError(`A ${kind} name is required`);
  }
  requireSingleLineName(name, kind);
  let entity = buildEntity(project, kind, name, options);
  assertPortableId(entity.id, kind);
  assertUnambiguousId(project.root, kind, entity.id);
  const interrupted = (candidate) => fs7.existsSync(candidate.file) && readTextFile(candidate.file) === candidate.markdown && !registryLists(project.root, kind, candidate.file);
  const numberOption = { chapter: "number", scene: "scene" }[kind];
  let resumed = false;
  if (numberOption && options[numberOption] === undefined) {
    const taken = kind === "chapter" ? project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0) : nextSceneNumber(project, entity.id.replace(/-scene-\d+$/, "")) - 1;
    if (taken >= 1) {
      const earlier = buildEntity(project, kind, name, { ...options, [numberOption]: taken });
      if (interrupted(earlier)) {
        entity = earlier;
        resumed = true;
      }
    }
  }
  if (!resumed && fs7.existsSync(entity.file)) {
    if (!interrupted(entity)) {
      throw refusedError(`${relative2(project, entity.file)} already exists`);
    }
    resumed = true;
  }
  if (!resumed) {
    writeFile(entity.file, entity.markdown, { root: project.root });
  }
  const data = readMarkdown(entity.file, project.root).data;
  applyEntityBacklinks(project.root, kind, entity.id, data);
  const reindexed = reindexProject(project.root);
  return { kind, id: entity.id, file: entity.file, changed: [entity.file].concat(reindexed.changed), resumed, warnings: missingReferenceWarnings(project.root, kind, data) };
}
var BACKLINKED_FIELDS = { character: ["locations"], location: ["notable-characters"], scene: ["location", "characters"] };
function missingReferenceWarnings(root, kind, data) {
  const warnings = [];
  for (const [key, value] of Object.entries(data)) {
    if (!Object.hasOwn(REFERENCE_FIELD_KINDS, key) || kind === "character" && key === "arc") {
      continue;
    }
    const kinds = REFERENCE_FIELD_KINDS[key].filter((other) => other !== "chapter");
    if (kinds.length === 0) {
      continue;
    }
    for (const item of asArray(value)) {
      const id = typeof item === "string" ? item.trim() : "";
      if (!isKebabId2(id) || kinds.some((other) => fs7.existsSync(path11.join(root, entityConfig(other).dir, `${id}.md`)))) {
        continue;
      }
      const backlink = BACKLINKED_FIELDS[kind]?.includes(key) ? ", so no backlink was written" : "";
      warnings.push(warn("unknown-reference", `${kinds.join(" or ")} ${id} (${key}) does not exist${backlink}; story links reports it until you add it`));
    }
  }
  return warnings;
}
function registryLists(root, kind, file) {
  const dir = entityConfig(kind).dir;
  const registry = [dir, path11.dirname(dir)].map((entry) => path11.join(entry, "_index.md")).find((entry) => REGISTRY_FILES.has(entry));
  const registryPath = registry && path11.join(root, registry);
  if (!registryPath || !fs7.existsSync(registryPath)) {
    return false;
  }
  const link = path11.relative(path11.dirname(registryPath), file).split(path11.sep).join("/");
  return safeRead(registryPath, root).includes(`](${link})`);
}
function renameEntity(root, options) {
  return withProjectLock(root, () => renameEntityUnlocked(root, options));
}
function renameEntityUnlocked(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "rename");
  const kind = normalizeKind(options.kind);
  const oldId = String(options.id ?? "").trim();
  const name = String(options.name ?? "").trim();
  if (!oldId || !name) {
    throw usageError("rename requires an entity id and a new name");
  }
  requireSingleLineName(name, kind);
  const requestedId = requestedEntityId(kind, options.newId);
  const config = entityConfig(kind);
  const oldFile = path11.join(project.root, config.dir, `${oldId}.md`);
  requireKebabId(oldId, `${kind} id`);
  assertSafeProjectPath(oldFile, project.root);
  const newId = kind === "chapter" || kind === "scene" ? oldId : requestedId ?? kebabCase(name);
  if (!isKebabId2(newId)) {
    throw usageError(undeducibleIdMessage(kind, name));
  }
  assertPortableId(newId, kind);
  const newFile = path11.join(project.root, config.dir, `${newId}.md`);
  assertSafeProjectPath(newFile, project.root);
  if (!fs7.existsSync(oldFile)) {
    if (newFile !== oldFile && fs7.existsSync(newFile) && readMarkdown(newFile, project.root).data[config.titleField] === name && replaceEntityReferences(project.root, kind, oldId, newId, new Map).size === 0) {
      const reindexed = reindexProject(project.root);
      return { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed), resumed: true };
    }
    throw usageError(`${kind} ${oldId} does not exist`);
  }
  let warnings = [];
  const markdown = readMarkdown(oldFile, project.root);
  const data = { ...markdown.data, [config.titleField]: name };
  const retitled = retitleHeading(replaceFrontmatter(markdown.rawMarkdown, data), markdown.data[config.titleField], name);
  if (newFile === oldFile) {
    writeFile(oldFile, retitled, { root: project.root, unchangedFrom: markdown.rawMarkdown });
  } else {
    const plan = replaceEntityReferences(project.root, kind, oldId, newId, new Map([[oldFile, retitled]]));
    followExemptionPatterns(project.root, plan, kind, oldId, newId);
    const renamedContents = plan.get(oldFile);
    plan.delete(oldFile);
    const interrupted = fs7.existsSync(newFile) && plan.size === 0 && readTextFile(newFile) === renamedContents;
    if (fs7.existsSync(newFile) && !interrupted) {
      throw refusedError(`${kind} ${newId} already exists`);
    }
    if (!interrupted) {
      assertUnambiguousId(project.root, kind, newId);
      warnings = adoptedReferenceWarnings(project.root, kind, newId, oldFile, "rename");
    }
    assertWritable(project.root, [...plan.keys(), oldFile], interrupted ? [] : [newFile]);
    commitWrites(() => {
      writeReferencePlan(project.root, plan);
      if (!interrupted) {
        writeFile(newFile, renamedContents, { root: project.root });
      }
      fs7.rmSync(oldFile);
    });
  }
  if (newFile !== oldFile) {
    warnings = warnings.concat(linkedBookIdWarnings(project, kind, oldId, newId));
  }
  const reindexed = reindexProject(project.root);
  return { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed), warnings };
}
var SERIES_CANON_COLLECTIONS = {
  character: "characters",
  location: "locations",
  system: "systems",
  faction: "factions",
  artifact: "artifacts",
  term: "glossaryTerms"
};
function linkedBookIdWarnings(project, kind, oldId, newId) {
  const collection = SERIES_CANON_COLLECTIONS[kind];
  const data = project.story.data ?? {};
  if (!collection || seriesLinks(project.root, data, "follows").length === 0 && seriesLinks(project.root, data, "precedes").length === 0) {
    return [];
  }
  const own = canonicalPath(project.root);
  const { books } = discoverSeriesBooks(project.root, scanProject);
  return books.filter((book) => book.key !== own && book.project[collection].some((entity) => entity.id === oldId)).map((book) => warn("linked-book-id", `${kind} ${oldId} is also defined in linked book ${book.title} (${seriesLinkPath(project.root, book.root)}); story series matches shared canon by id, so rename it there to ${newId} too, or keep the old id`));
}
function retitleHeading(markdown, oldName, newName) {
  const oldText = String(oldName ?? "").trim();
  const match = FRONTMATTER_PATTERN.exec(markdown);
  const header = match ? match[0] : "";
  const body = markdown.slice(header.length);
  const heading = new RegExp(`^(#[ \\t]+(?:Chapter \\d+:[ \\t]+)?)${escapeRegExp(oldText)}([ \\t]*)(?=\\r?$)`, "m");
  return `${header}${body.replace(heading, (whole, prefix, trailing) => `${prefix}${newName}${trailing}`)}`;
}
function removeEntity(root, options) {
  return withProjectLock(root, () => removeEntityUnlocked(root, options));
}
function removeEntityUnlocked(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "remove");
  const kind = normalizeKind(options.kind);
  const id = String(options.id ?? "").trim();
  if (!id) {
    throw usageError("remove requires an entity id");
  }
  const config = entityConfig(kind);
  const file = path11.join(project.root, config.dir, `${id}.md`);
  requireKebabId(id, `${kind} id`);
  assertSafeProjectPath(file, project.root);
  const alreadyGone = !fs7.existsSync(file);
  if (alreadyGone && removeEntityReferences(project.root, kind, id, new Map).size === 0) {
    throw usageError(`${kind} ${id} does not exist`);
  }
  if (kind === "chapter") {
    const scenes = project.scenes.filter((scene) => scene.chapter === id);
    if (scenes.length > 0) {
      throw refusedError(`chapter ${id} still has scenes: ${scenes.map((scene) => scene.id).join(", ")}. Remove them first with story remove scene <id>`);
    }
  }
  if (kind === "chapter") {
    const context = { ...entityReferenceContext(project.root, "chapter", id), isReferenceKey: (key) => BEFORE_STORY_FIELDS.includes(key) };
    const named = [...planReferenceRewrites(project.root, context, new Map([[file, null]]), idRenamer(id, `${id}-removed`), (body) => body).keys()];
    if (named.length > 0) {
      throw refusedError(`chapter ${id} is still named by ${BEFORE_STORY_FIELDS.join(", ")}, or a progression's from in ${named.map((entry) => path11.relative(project.root, entry)).join(", ")}; an empty value there means before the story, and a progression needs the chapter it starts in, so point them at another chapter first`);
    }
  }
  const choosers = kind === "chapter" ? project.chapters.filter((chapter) => chapter.id !== id && chapterChoices(chapter, "").choices.some((choice) => choice.to === id)).map((chapter) => relative2(project, chapter.file)) : [];
  const wasBranching = choosers.length > 0 && branchGraph(project).branching;
  const plan = removeEntityReferences(project.root, kind, id, new Map([[file, null]]));
  assertWritable(project.root, [...plan.keys(), file]);
  commitWrites(() => {
    writeReferencePlan(project.root, plan);
    fs7.rmSync(file, { force: true });
  });
  const reindexed = reindexProject(project.root);
  const warnings = leftoverReferenceWarnings(project.root, kind, id);
  if (choosers.length > 0) {
    warnings.push(warn("choices-dropped", branchGraph(scanProject(project.root)).branching || !wasBranching ? `${choosers.join(", ")} had choices leading to ${id}, which remove dropped; a chapter left with no choices is an ending, so check where ${choosers.length === 1 ? "it leads" : "they lead"} now` : `${choosers.join(", ")} had the last choices in the book, leading to ${id}, which remove dropped; with no choices left the book is linear again and each chapter continues to the next, so add choices back to keep it branching`, choosers.length === 1 ? choosers[0] : null));
  }
  return { kind, id, file, alreadyGone, changed: [file].concat(reindexed.changed), warnings };
}
function leftoverReferenceWarnings(root, kind, id) {
  const warnings = [];
  const context = entityReferenceContext(root, kind, id);
  const probe = `${id}-leftover-probe`;
  const numbered = kind === "chapter" || kind === "scene";
  let files = [];
  try {
    files = [...planReferenceRewrites(root, context, new Map, (value) => value, (body, file) => {
      const relinked = renameLinkTargets(root, file, body, context, probe);
      return numbered ? renameIdTokens(root, file, relinked, id, probe) : relinked;
    }).keys()].map((file) => path11.relative(root, file)).sort();
  } catch {}
  if (files.length > 0) {
    warnings.push(warn("leftover-references", `${files.join(", ")} still ${files.length === 1 ? "mentions" : "mention"} ${kind} ${id} in ${numbered ? "links or ids" : "links"} in the text, which remove does not change: edit ${files.length === 1 ? "it" : "them"}, then run story links`, files.length === 1 ? files[0] : null));
  }
  const stale = exemptionEntries(root).map(({ entry, index }) => {
    const followed = followExemptionEntry(entry, kind, id, probe);
    return { index, keys: EXEMPTION_TEXT_KEYS.filter((key) => followed[key] !== entry[key]).map((key) => `${key} ${JSON.stringify(entry[key])}`) };
  }).filter(({ keys }) => keys.length > 0);
  if (stale.length > 0) {
    const values = stale.flatMap(({ keys }) => keys);
    warnings.push(warn("stale-exemption", `continuity/exemptions.md has ${stale.length === 1 ? "an entry" : `${stale.length} entries`} naming ${id} (${stale.map(({ index }) => `exemptions[${index}]`).join(", ")}), which ${stale.length === 1 ? "no longer matches" : "no longer match"} anything: ${values.join(", ")}. Delete or update ${stale.length === 1 ? "it" : "them"}`, EXEMPTIONS_FILE));
  }
  return warnings;
}
var EXEMPTION_TEXT_KEYS = ["pattern", "file", "chapter"];
function exemptionEntries(root) {
  const filePath = path11.join(root, EXEMPTIONS_FILE);
  try {
    const entries = readMarkdown(filePath, root).data.exemptions;
    return Array.isArray(entries) ? entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry && typeof entry === "object" && !Array.isArray(entry)) : [];
  } catch {
    return [];
  }
}
function followExemptionEntry(entry, kind, oldId, newId) {
  const renamed = { ...entry };
  if (typeof entry.pattern === "string") {
    renamed.pattern = renameIdText(entry.pattern, oldId, newId);
  }
  const file = typeof entry.file === "string" ? exemptionFile(entry.file) : null;
  const dir = entityConfig(kind).dir.replace(/\\/g, "/");
  const ownScene = kind === "chapter" && file !== null && new RegExp(`^scenes/${escapeRegExp(oldId)}-scene-\\d+\\.md$`).test(file);
  if (file !== null && (file === `${dir}/${oldId}.md` || ownScene)) {
    renamed.file = renameIdText(file, oldId, newId);
  }
  const sceneChapter = (id) => /^(.+)-scene-\d+$/.exec(id)?.[1];
  if (kind === "scene" && renamed.file !== entry.file && entry.chapter === sceneChapter(oldId) && sceneChapter(newId) !== undefined) {
    renamed.chapter = sceneChapter(newId);
  }
  return renamed;
}
function followExemptionPatterns(root, plan, kind, oldId, newId) {
  const filePath = path11.join(root, EXEMPTIONS_FILE);
  if (!plan.has(filePath) && !lstatIfExists(filePath)) {
    return;
  }
  const text = plan.get(filePath) ?? readTextFile(filePath);
  const data = parseFrontmatter(text, filePath).data;
  if (!Array.isArray(data.exemptions)) {
    return;
  }
  let changed = false;
  const exemptions = data.exemptions.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }
    const renamed = followExemptionEntry(entry, kind, oldId, newId);
    changed ||= EXEMPTION_TEXT_KEYS.some((key) => renamed[key] !== entry[key]);
    return renamed;
  });
  if (changed) {
    if (!plan.has(filePath)) {
      plan.originals?.set(filePath, text);
    }
    plan.set(filePath, replaceFrontmatter(text, { ...data, exemptions }));
  }
}
function moveEntity(root, options) {
  return withProjectLock(root, () => moveEntityUnlocked(root, options));
}
function moveEntityUnlocked(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "move");
  const kind = normalizeMoveKind(options.kind);
  const id = String(options.id ?? "").trim();
  if (!id) {
    throw usageError("move requires a chapter or scene id");
  }
  requireKebabId(id, `${kind} id`);
  return kind === "chapter" ? moveChapter(project, id, options) : moveScene(project, id, options);
}
var KIND_PLURALS = {
  character: "characters",
  location: "locations",
  system: "systems",
  faction: "factions",
  artifact: "artifacts",
  arc: "arcs",
  question: "questions",
  promise: "promises",
  clue: "clues",
  term: "glossary terms",
  matter: "matter pages",
  research: "research notes"
};
function normalizeMoveKind(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "") {
    throw usageError("An entity kind is required: expected one of chapter, scene");
  }
  if (!Object.hasOwn(KIND_ALIASES, text)) {
    throw usageError(`Unsupported entity kind: ${value}: expected one of chapter, scene`);
  }
  const kind = KIND_ALIASES[text];
  if (kind !== "chapter" && kind !== "scene") {
    throw usageError(`story move works on chapters and scenes, not ${KIND_PLURALS[kind]}; use story rename to change other ids`);
  }
  return kind;
}
function moveChapter(project, oldId, options) {
  const chapter = project.chapters.find((entry) => entry.id === oldId);
  if (!chapter) {
    throw usageError(`chapter ${oldId} does not exist`);
  }
  if (options.number === undefined) {
    throw usageError("move chapter requires --number <n>");
  }
  const number = requirePositiveInteger(options.number, "chapter number");
  const newId = `chapter-${String(number).padStart(2, "0")}`;
  const newFile = path11.join(project.root, "chapters", `${newId}.md`);
  if (newId === oldId) {
    throw usageError(`${oldId} is already chapter ${number}`);
  }
  const taken = project.chapters.find((entry) => entry.number === number && entry.id !== oldId);
  const markdown = readMarkdown(chapter.file, project.root);
  const renumbered = replaceFrontmatter(markdown.rawMarkdown, { ...markdown.data, number }).replace(/^(#[ \t]+Chapter[ \t]+)\d+(?=[ \t]*(?::|$))/m, `$1${number}`);
  const scenes = project.scenes.filter((scene) => scene.chapter === oldId);
  const sceneMoves = scenes.map((scene) => ({
    oldFile: scene.file,
    newFile: path11.join(project.root, "scenes", `${newId}-scene-${String(scene.scene).padStart(2, "0")}.md`)
  }));
  const context = entityReferenceContext(project.root, "chapter", oldId);
  const sceneContexts = scenes.map((scene) => ({ context: entityReferenceContext(project.root, "scene", scene.id), newId: `${newId}-scene-${String(scene.scene).padStart(2, "0")}` }));
  const plan = planReferenceRewrites(project.root, context, new Map([[chapter.file, renumbered]]), idRenamer(oldId, newId), (body, file) => renameIdTokens(project.root, file, sceneContexts.reduce((text, entry) => renameLinkTargets(project.root, file, text, entry.context, entry.newId), renameLinkTargets(project.root, file, body, context, newId)), oldId, newId));
  const statePath = path11.join(project.root, "continuity", "state.md");
  if (fs7.existsSync(statePath)) {
    const stateText = plan.get(statePath) ?? readTextFile(statePath);
    const stateData = parseFrontmatter(stateText, statePath).data;
    if (stateData["current-chapter"] === chapter.number) {
      if (!plan.has(statePath)) {
        plan.originals.set(statePath, stateText);
      }
      plan.set(statePath, replaceFrontmatter(stateText, { ...stateData, "current-chapter": number }));
    }
  }
  followExemptionPatterns(project.root, plan, "chapter", oldId, newId);
  reorderProgressions(project, plan, renumberedChronology(chapterChronology(project), oldId, newId, number));
  const moves = [{ oldFile: chapter.file, newFile }, ...sceneMoves];
  if (taken && !interruptedMove(plan, moves)) {
    throw refusedError(`${newId} already exists: move it first. To make room, renumber from the highest chapter down`);
  }
  const warnings = taken ? [] : adoptedReferenceWarnings(project.root, "chapter", newId, chapter.file, "move");
  commitMoves(project.root, plan, moves);
  const reindexed = reindexProject(project.root);
  return { kind: "chapter", oldId, id: newId, file: newFile, moved: moves.length, changed: moves.map((move) => move.newFile).concat(reindexed.changed), warnings };
}
function reorderProgressions(project, plan, chronology) {
  const dirs = PROGRESSION_KINDS.map((kind) => entityConfig(kind).dir);
  for (const [file, text] of plan) {
    if (!dirs.includes(path11.relative(project.root, path11.dirname(file)))) {
      continue;
    }
    const data = parseFrontmatter(text, file).data;
    if (!Array.isArray(data.progressions)) {
      continue;
    }
    const sorted = sortProgressions(data.progressions, chronology);
    if (sorted.some((item, index) => item !== data.progressions[index])) {
      plan.set(file, replaceFrontmatter(text, { ...data, progressions: sorted }));
    }
  }
}
function moveScene(project, oldId, options) {
  const scene = project.scenes.find((entry) => entry.id === oldId);
  if (!scene) {
    throw usageError(`scene ${oldId} does not exist`);
  }
  if (options.chapter === undefined && options.scene === undefined) {
    throw usageError("move scene requires --chapter <id>, --scene <n>, or both");
  }
  const chapterId = String(options.chapter ?? scene.chapter).trim();
  requireKebabId(chapterId, "chapter id");
  if (!project.chapters.some((entry) => entry.id === chapterId)) {
    throw usageError(`chapter ${chapterId} does not exist`);
  }
  const markdown = readMarkdown(scene.file, project.root);
  const context = entityReferenceContext(project.root, "scene", oldId);
  const planMove = (number) => {
    const newId = `${chapterId}-scene-${String(number).padStart(2, "0")}`;
    const moved = replaceFrontmatter(markdown.rawMarkdown, { ...markdown.data, chapter: chapterId, scene: number });
    const plan = planReferenceRewrites(project.root, context, new Map([[scene.file, moved]]), idRenamer(oldId, newId), (body, file) => renameIdTokens(project.root, file, renameLinkTargets(project.root, file, body, context, newId), oldId, newId));
    followExemptionPatterns(project.root, plan, "scene", oldId, newId);
    return { number, newId, plan, moves: [{ oldFile: scene.file, newFile: path11.join(project.root, "scenes", `${newId}.md`) }] };
  };
  let target;
  if (options.scene === undefined) {
    target = project.scenes.filter((entry) => entry.chapter === chapterId && entry.id !== oldId && entry.title === scene.title).map((entry) => planMove(entry.scene)).find((candidate) => interruptedMove(candidate.plan, candidate.moves));
  }
  target ??= planMove(options.scene !== undefined ? requirePositiveInteger(options.scene, "scene number") : chapterId === scene.chapter ? scene.scene : nextSceneNumber(project, chapterId));
  const { number, newId, plan, moves } = target;
  const newFile = moves[0].newFile;
  if (newId === oldId) {
    throw usageError(`${oldId} is already scene ${number} of ${chapterId}`);
  }
  if (project.scenes.some((entry) => entry.id === newId) && !interruptedMove(plan, moves)) {
    throw refusedError(`${newId} already exists: move it first`);
  }
  const warnings = project.scenes.some((entry) => entry.id === newId) ? [] : adoptedReferenceWarnings(project.root, "scene", newId, scene.file, "move");
  commitMoves(project.root, plan, moves, () => applyEntityBacklinks(project.root, "scene", newId, readMarkdown(newFile, project.root).data), [path11.join(project.root, "chapters", `${chapterId}.md`)]);
  const reindexed = reindexProject(project.root);
  return { kind: "scene", oldId, id: newId, file: newFile, moved: 1, changed: [newFile].concat(reindexed.changed), warnings };
}
var BEFORE_STORY_FIELDS = ["died-in", "since", "learned-in"];
function adoptedReferenceWarnings(root, kind, id, excludedFile, action) {
  const context = entityReferenceContext(root, kind, id);
  const probe = `${id}-adopted-probe`;
  const numbered = kind === "chapter" || kind === "scene";
  const plan = planReferenceRewrites(root, context, new Map([[excludedFile, null]]), idRenamer(id, probe), (body, file) => {
    const relinked = renameLinkTargets(root, file, body, context, probe);
    return numbered ? renameIdTokens(root, file, relinked, id, probe) : relinked;
  });
  if (plan.size === 0) {
    return [];
  }
  const files = [...plan.keys()].map((file) => path11.relative(root, file)).sort();
  return [warn("adopted-references", `${id} was already referenced before this ${action}, and those references now point at the ${action === "move" ? "moved" : "renamed"} ${kind}: ${files.join(", ")}. Check them`)];
}
function idRenamer(oldId, newId) {
  return (value) => value === oldId ? newId : value;
}
function renameIdTokens(root, file, body, oldId, newId) {
  const relativePath = path11.relative(root, file);
  if (relativePath !== path11.join("plot", "timeline.md") && relativePath !== path11.join("plot", "_index.md") && path11.dirname(relativePath) !== path11.join("plot", "arcs")) {
    return body;
  }
  return mapOutsideLinks(body, (text) => renameIdText(text, oldId, newId));
}
function renameIdText(text, oldId, newId) {
  return text.replace(new RegExp(`(?<![\\w-])${escapeRegExp(oldId)}-scene-(\\d+)(?![\\w-])`, "g"), `${newId}-scene-$1`).replace(new RegExp(`(?<![\\w-])${escapeRegExp(oldId)}(?![\\w-])`, "g"), newId);
}
var LINK_OR_URL_PATTERN = /(\]\([^)\n]*\)|<[a-z][a-z0-9+.-]*:[^>\s]*>|\b[a-z][a-z0-9+.-]*:\/\/[^\s<>)\]]*)/gi;
function mapOutsideLinks(body, transform) {
  return body.split(LINK_OR_URL_PATTERN).map((part, index) => index % 2 === 1 ? part : transform(part)).join("");
}
function commitMoves(root, plan, moves, beforeDelete = () => {}, alsoChanged = []) {
  const contents = moves.map((move) => plan.get(move.oldFile) ?? readTextFile(move.oldFile));
  const interrupted = interruptedMove(plan, moves);
  moves.forEach((move) => {
    if (fs7.existsSync(move.newFile) && !interrupted) {
      throw refusedError(`${path11.relative(root, move.newFile)} already exists; nothing was changed`);
    }
  });
  for (const move of moves) {
    plan.delete(move.oldFile);
  }
  assertWritable(root, [...plan.keys(), ...moves.map((move) => move.oldFile), ...alsoChanged], moves.map((move) => move.newFile));
  commitWrites(() => {
    writeReferencePlan(root, plan);
    moves.forEach((move, index) => writeFile(move.newFile, contents[index], { root }));
    beforeDelete();
    for (const move of [...moves].reverse()) {
      fs7.rmSync(move.oldFile);
    }
  });
}
function interruptedMove(plan, moves) {
  const moving = new Set(moves.map((move) => move.oldFile));
  if ([...plan.keys()].some((file) => !moving.has(file))) {
    return false;
  }
  return moves.every((move) => !fs7.existsSync(move.newFile) || readTextFile(move.newFile) === (plan.get(move.oldFile) ?? readTextFile(move.oldFile)));
}
function storyBible(options) {
  const data = {
    title: options.title,
    "schema-version": STORY_SCHEMA_VERSION
  };
  if (options.series !== undefined) {
    data.series = options.series;
  }
  if (options.inherited?.["series-title"] !== undefined) {
    data["series-title"] = options.inherited["series-title"];
  }
  if (options.bookNumber !== undefined) {
    data["book-number"] = options.bookNumber;
  }
  Object.assign(data, {
    genre: options.genre,
    "sub-genre": options.subGenre,
    "setting-era": options.settingEra,
    status: "planning",
    themes: options.themes,
    pov: options.pov,
    tense: options.tense
  });
  for (const field of ["author", "authors", "language"]) {
    if (options.inherited?.[field] !== undefined) {
      data[field] = options.inherited[field];
    }
  }
  if (options.form !== undefined) {
    data.form = options.form;
    const target = STORY_FORMS.get(options.form).target;
    if (target !== null) {
      data["target-words"] = target;
    }
  }
  for (const field of ["follows", "precedes"]) {
    if (options[field].length > 0) {
      data[field] = options[field];
    }
  }
  return `${stringifyFrontmatter(data)}# ${options.title}

## Synopsis

${options.synopsis}

## Tone & Style

Add notes on the story's voice, texture, and emotional register.

## Notes

`;
}
function cell3(value) {
  return String(value ?? "").replace(/\r?\n|\r/g, " ").replace(/\|/g, "\\|");
}
function characterIndex(storyId, characters, relationshipMap, familyTrees) {
  const rows = characters.length === 0 ? ["| *No characters yet* | | | |"] : characters.map((character) => `| ${cell3(character.name)} | ${cell3(character.role)} | ${cell3(character.status)} | [${character.id}](${character.id}.md) |`);
  return `${stringifyFrontmatter({ type: "character-registry", story: storyId })}# Characters

## Registry

| Name | Role | Status | File |
|------|------|--------|------|
${rows.join(`
`)}

## Relationship Map

${relationshipMap || "*No relationships defined yet.*"}

## Family Trees

${familyTrees || "*No family trees defined yet.*"}
`;
}
function worldIndex(storyId, locations, systems, factions, artifacts, overview) {
  const locationRows = locations.length === 0 ? ["| *No locations yet* | | | |"] : locations.map((location) => `| ${cell3(location.name)} | ${cell3(titleCaseSlug(location.type))} | ${cell3(location.region)} | [${location.id}](locations/${location.id}.md) |`);
  const systemRows = systems.length === 0 ? ["| *No systems yet* | | |"] : systems.map((system) => `| ${cell3(system.name)} | ${cell3(titleCaseSlug(system.type))} | [${system.id}](systems/${system.id}.md) |`);
  const factionRows = factions.length === 0 ? ["| *No factions yet* | | | |"] : factions.map((faction) => `| ${cell3(faction.name)} | ${cell3(titleCaseSlug(faction.type))} | ${cell3(faction.status)} | [${faction.id}](factions/${faction.id}.md) |`);
  const artifactRows = artifacts.length === 0 ? ["| *No artifacts yet* | | | |"] : artifacts.map((artifact) => `| ${cell3(artifact.name)} | ${cell3(titleCaseSlug(artifact.type))} | ${cell3(artifact.status)} | [${artifact.id}](artifacts/${artifact.id}.md) |`);
  return `${stringifyFrontmatter({ type: "world-registry", story: storyId })}# Worldbuilding

## World Overview

${overview || "*Describe the world at a high level here.*"}

## Locations

| Name | Type | Region | File |
|------|------|--------|------|
${locationRows.join(`
`)}

## Systems

| Name | Type | File |
|------|------|------|
${systemRows.join(`
`)}

## Factions

| Name | Type | Status | File |
|------|------|--------|------|
${factionRows.join(`
`)}

## Artifacts

| Name | Type | Status | File |
|------|------|--------|------|
${artifactRows.join(`
`)}
`;
}
function plotIndex(storyId, structure, arcs, storyStructure, themeTracking) {
  const arcRows = arcs.length === 0 ? ["| *No arcs yet* | | | |"] : arcs.map((arc) => `| ${cell3(arc.name)} | ${cell3(arc.type)} | ${cell3(arc.status)} | [${arc.id}](arcs/${arc.id}.md) |`);
  return `${stringifyFrontmatter({ type: "plot-registry", story: storyId, structure })}# Plot Structure

## Story Structure

${storyStructure || "**Model:** Three-Act Structure (adjust as needed)"}

## Arcs

| Name | Type | Status | File |
|------|------|--------|------|
${arcRows.join(`
`)}

## Theme Tracking

${themeTracking || `| Theme | Arcs | Chapters |
|-------|------|----------|
| *No themes tracked yet* | | |`}
`;
}
function chapterIndex(storyId, chapters) {
  const rows = chapters.length === 0 ? ["| *No chapters yet* | | | | | |"] : chapters.map((chapter) => `| ${cell3(chapter.number)} | ${cell3(chapter.title)} | ${cell3(chapter.pov)} | ${cell3(chapter.status)} | ${cell3(chapter.wordCount)} | [${chapter.id}](${path11.basename(chapter.file)}) |`);
  const total = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  return `${stringifyFrontmatter({ type: "chapter-registry", story: storyId })}# Chapters

## Registry

| # | Title | POV | Status | Word Count | File |
|---|-------|-----|--------|------------|------|
${rows.join(`
`)}

## Total Word Count: ${total}
`;
}
function timeline(storyId) {
  return `${stringifyFrontmatter({ type: "timeline", story: storyId })}# Story Timeline

| When | Event | Arc | Chapter |
|------|-------|-----|---------|
| *No events yet* | | | |
`;
}
function sceneIndex(storyId, scenes) {
  const rows = scenes.length === 0 ? ["| *No scenes yet* | | | | | |"] : scenes.map((scene) => `| ${cell3(scene.chapter)} | ${cell3(scene.scene)} | ${cell3(scene.title)} | ${cell3(scene.pov)} | ${cell3(scene.status)} | [${scene.id}](${scene.id}.md) |`);
  return `${stringifyFrontmatter({ type: "scene-registry", story: storyId })}# Scenes

## Registry

| Chapter | Scene | Title | POV | Status | File |
|---------|-------|-------|-----|--------|------|
${rows.join(`
`)}
`;
}
function continuityState(storyId) {
  return `${stringifyFrontmatter({
    type: "continuity-state",
    story: storyId,
    "current-chapter": 0,
    "character-state": [],
    "object-state": [],
    "knowledge-state": []
  })}# Continuity State

## Current Story State

Track facts that must carry forward between chapters. The CLI reads the
\`character-state\`, \`object-state\`, and \`knowledge-state\` lists in the
frontmatter above; the tables below are optional notes it does not read.

## Character State

| Character | Location | Physical State | Emotional State | Knowledge |
|-----------|----------|----------------|-----------------|-----------|
| *No state entries yet* | | | | |

## Object State

| Artifact | Owner | Location | Status |
|----------|-------|----------|--------|
| *No object state entries yet* | | | |

## Knowledge State

| Character | Knows | Learned In |
|-----------|-------|------------|
| *No knowledge entries yet* | | |
`;
}
function questionIndex(storyId, questions) {
  const rows = questions.length === 0 ? ["| *No questions yet* | | | |"] : questions.map((question) => `| ${cell3(question.title)} | ${cell3(question.status)} | ${cell3(question.introduced)} | [${question.id}](${question.id}.md) |`);
  return `${stringifyFrontmatter({ type: "question-registry", story: storyId })}# Continuity Questions

## Registry

| Question | Status | Introduced | File |
|----------|--------|------------|------|
${rows.join(`
`)}
`;
}
function promiseIndex(storyId, promises) {
  const rows = promises.length === 0 ? ["| *No promises yet* | | | |"] : promises.map((promise) => `| ${cell3(promise.title)} | ${cell3(promise.status)} | ${cell3(promise.planted)} | [${promise.id}](${promise.id}.md) |`);
  return `${stringifyFrontmatter({ type: "promise-registry", story: storyId })}# Promises And Payoffs

## Registry

| Promise | Status | Planted | File |
|---------|--------|---------|------|
${rows.join(`
`)}
`;
}
function clueIndex(storyId, clues) {
  const rows = clues.length === 0 ? ["| *No clues yet* | | | |"] : clues.map((clue) => `| ${cell3(clue.title)} | ${cell3(clue.status)} | ${cell3(clue.planted)} | [${clue.id}](${clue.id}.md) |`);
  return `${stringifyFrontmatter({ type: "clue-registry", story: storyId })}# Clue Ledger

## Registry

| Clue | Status | Planted | File |
|------|--------|---------|------|
${rows.join(`
`)}
`;
}
function glossaryIndex(storyId, terms) {
  const rows = terms.length === 0 ? ["| *No terms yet* | | |"] : terms.map((term) => `| ${cell3(term.term)} | ${cell3(term.category)} | [${term.id}](terms/${term.id}.md) |`);
  return `${stringifyFrontmatter({ type: "glossary-registry", story: storyId })}# Glossary

## Registry

| Term | Category | File |
|------|----------|------|
${rows.join(`
`)}
`;
}
function matterIndex(storyId, pages) {
  const rows = pages.length === 0 ? ["| *No matter pages yet* | | | |"] : pages.map((page) => `| ${cell3(page.title)} | ${cell3(page.placement)} | ${cell3(page.order)} | [${page.id}](${page.id}.md) |`);
  return `${stringifyFrontmatter({ type: "matter-registry", story: storyId })}# Front And Back Matter

## Registry

| Title | Placement | Order | File |
|-------|-----------|-------|------|
${rows.join(`
`)}
`;
}
function researchIndex(storyId, notes) {
  const rows = notes.length === 0 ? ["| *No research notes yet* | | | |"] : notes.map((note) => `| ${cell3(note.title)} | ${cell3(note.status)} | ${cell3(note.usedIn.join(", "))} | [${note.id}](${note.id}.md) |`);
  return `${stringifyFrontmatter({ type: "research-registry", story: storyId })}# Research

## Registry

| Title | Status | Used In | File |
|-------|--------|---------|------|
${rows.join(`
`)}
`;
}
function styleSheet() {
  return `${stringifyFrontmatter({
    type: "style-sheet",
    dialect: "unspecified",
    preferred: [],
    "watch-words": [],
    "allow-words": []
  })}# Style Sheet

The book's house decisions, kept the way a copyeditor keeps them. Read this before drafting or revising prose. \`story prose\` enforces the lists in the frontmatter: \`dialect\` (british, american, or unspecified) flags the other dialect's common spellings, each \`preferred\` entry flags its \`avoid\` form, \`watch-words\` are counted in every chapter, and \`allow-words\` silences a built-in filter word or adverb. Add a \`samples\` list of your own prose (\`../book-one\`, approved chapters) and \`story prose\` compares each chapter with it instead of fixed limits.

## Voice

Narrative distance, sentence rhythm, register, and what this prose never does. Quote two or three sentences that sound exactly right.

## Spelling And Usage

Record one \`preferred\` entry per variant (\`use: grey\`, \`avoid: gray\`) and note usage rules here.

## Capitalisation

Titles, ranks, institutions, invented terms, and deities. Invented terms also belong in the glossary.

## Hyphenation And Compounds

## Numbers, Dates, And Time

Spelled-out or numerals, and how in-world dates and times are written.

## Dialogue And Punctuation

Quote marks, dash style, ellipses, italics for thought or foreign words, and the default dialogue tags.

## Character Voices

One entry per POV character or major speaker: vocabulary, sentence length, verbal tics, and words they never use.

## Watch List

Why each \`watch-words\` entry is there.
`;
}
function buildProjectActions(project, validation, links, continuity, displayPath = ".") {
  const where = shellWord(displayPath);
  const passesCommand = where === "." ? "story passes" : `story passes ${where}`;
  const actions = [];
  if (validation.errors.length > 0) {
    actions.push(action("P0", "Fix validation errors", `Run story validate ${where} and repair ${validation.errors.length} schema or registry errors.`));
  }
  if (links.errors.length > 0) {
    actions.push(action("P0", "Fix broken references", `Run story links ${where} and repair ${links.errors.length} missing references or backlinks.`));
  }
  if (continuity.errors.length > 0) {
    actions.push(action("P0", "Fix continuity contradictions", `Run story continuity ${where} and repair ${continuity.errors.length} deterministic continuity errors.`));
  }
  const otherWarnings = validation.warnings.filter((warning) => warning.code !== "stale-word-count" && warning.code !== "no-scene-records");
  if (otherWarnings.length > 0) {
    actions.push(action("P1", "Review validation warnings", `Run story validate ${where} and review ${otherWarnings.length} warning${otherWarnings.length === 1 ? "" : "s"}.`));
  }
  if (continuity.warnings.length > 0) {
    actions.push(action("P1", "Review continuity warnings", `Run story continuity ${where} and review ${plural(continuity.warnings.length, "continuity warning")}.`));
  }
  const staleChapters = [];
  const chaptersWithoutScenes = [];
  const overridden = (code) => new Set([...validation.errors, ...(validation.dismissed ?? []).map((entry) => entry.finding)].filter((finding) => finding.code === code).map((finding) => finding.file));
  const wordCountOverridden = overridden("stale-word-count");
  const scenesOverridden = overridden("no-scene-records");
  let nextNumber = 1;
  for (const chapter of project.chapters) {
    const file = relative2(project, chapter.file);
    if (chapter.declaredWordCount !== chapter.wordCount && !wordCountOverridden.has(file)) {
      staleChapters.push(chapter);
    }
    let hasScene = false;
    for (const scene of project.scenes) {
      if (scene.chapter === chapter.id) {
        hasScene = true;
      }
    }
    if (!hasScene && !scenesOverridden.has(file)) {
      chaptersWithoutScenes.push(chapter);
    }
    if (Number.isInteger(chapter.number) && chapter.number > 0) {
      nextNumber = Math.max(nextNumber, chapter.number + 1);
    }
  }
  if (staleChapters.length > 0) {
    actions.push(action("P1", "Refresh word counts", `Run story wordcount ${where} --write for ${plural(staleChapters.length, "chapter")} with stale counts.`));
  }
  if (chaptersWithoutScenes.length > 0) {
    actions.push(action("P1", "Add scene records", `Create machine-readable scene files for ${chaptersWithoutScenes.length} chapters so continuity has durable state.`));
  }
  const projectDiscovered = project.story.data["draft-mode"] === "discovered";
  const unreconciled = project.chapters.filter((chapter) => !chapter.hasPostHocNotes && (chapter.mode === "discovered" || projectDiscovered && chapter.mode === "" && chapter.wordCount > 0));
  if (unreconciled.length > 0) {
    actions.push(action("P1", "Reconcile discovered chapters", `Run the discovery-drafting reconcile loop and add ## Chapter Notes (post-hoc) for ${unreconciled.map((chapter) => chapter.id).join(", ")}.`));
  }
  const openQuestions = [];
  for (const question of project.questions) {
    if (question.status === "open") {
      openQuestions.push(question);
    }
  }
  if (openQuestions.length > 0) {
    actions.push(action("P2", "Track open questions", openQuestions.length === 1 ? "1 mystery or continuity question is still open." : `${openQuestions.length} mysteries or continuity questions are still open.`));
  }
  const pendingPromises = [];
  for (const promise of project.promises) {
    if (promise.status === "planned" || promise.status === "planted") {
      pendingPromises.push(promise);
    }
  }
  if (pendingPromises.length > 0) {
    actions.push(action("P2", "Review promises and payoffs", pendingPromises.length === 1 ? "1 setup/payoff promise needs planting or a payoff decision." : `${pendingPromises.length} setup/payoff promises need planting or payoff decisions.`));
  }
  const openClues = [];
  for (const clue of project.clues) {
    if (clue.status === "planned" || clue.status === "planted") {
      openClues.push(clue);
    }
  }
  if (openClues.length > 0) {
    actions.push(action("P2", "Review open clues", `${openClues.length} clues are still planned or planted.`));
  }
  if (project.story.data.status === "revising") {
    const passes = readPasses(project.story.data);
    const upcoming = nextPass(passes);
    if (passes.length === 0) {
      actions.push(action("P1", "Plan revision passes", `Run ${passesCommand} --init to record the structure-to-proof pass ladder, then work one pass at a time.`));
    } else if (upcoming !== null) {
      const known = DEFAULT_PASSES.find((entry) => entry.pass === upcoming.pass);
      const checks = known ? ` Run ${passChecks(known, where).join(", ")}.` : "";
      actions.push(action("P1", `Revision pass: ${upcoming.pass}`, `${known ? `${known.focus}.` : "Work through this pass."}${checks} Mark it with ${passesCommand} --done ${upcoming.pass}.`));
    }
  }
  const activeArcNames = [];
  for (const arc of project.arcs) {
    if (arc.status !== "resolved" && activeArcNames.length < 3) {
      activeArcNames.push(arc.name);
    }
  }
  const nextLabel = activeArcNames.length > 0 ? `advance ${activeArcNames.join(", ")}` : "establish the next story beat";
  const maintenanceCount = actions.length;
  const storyStatus = project.story.data.status;
  const drafting = !["revising", "complete", "abandoned"].includes(storyStatus) && !(project.arcs.length > 0 && project.arcs.every((arc) => arc.status === "resolved"));
  const undrafted = project.chapters.find((chapter) => chapter.wordCount === 0 && Number.isInteger(chapter.number) && chapter.number > 0);
  if (drafting && undrafted) {
    actions.push(action("P2", `Draft chapter ${undrafted.number}`, `${path11.relative(project.root, undrafted.file)} has no prose yet${undrafted.status === "" ? "" : ` (status ${undrafted.status})`}: draft it under ## Chapter Text to ${nextLabel}, then run story wordcount ${where} --write.`));
  } else if (drafting) {
    actions.push(action("P2", `Draft chapter ${nextNumber}`, `Use story add chapter "Chapter ${nextNumber}" --number ${nextNumber}${where === "." ? "" : ` --path ${where}`}, then outline scenes to ${nextLabel}.`));
  }
  if (project.characters.length === 0) {
    actions.push(action("P2", "Create first character", `Use story add character "Name" --role protagonist${where === "." ? "" : ` --path ${where}`} before drafting prose.`));
  }
  actions.sort((left, right) => left.priority.localeCompare(right.priority, "en"));
  if (maintenanceCount === 0 && validation.ok && links.ok && continuity.ok && continuity.warnings.length === 0 && staleChapters.length === 0 && chaptersWithoutScenes.length === 0) {
    actions.push(action("P3", "Project is mechanically healthy", "No deterministic maintenance issues are blocking the next writing pass."));
  }
  return actions;
}
function shellWord(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./~:@%+=,-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
}
function action(priority, title, detail) {
  return { priority, title, detail };
}
function appendActionLines(lines, actions) {
  if (actions.length === 0) {
    lines.push("- No actions found");
    return;
  }
  for (const item of actions) {
    lines.push(`- [${item.priority}] ${item.title}: ${item.detail}`);
  }
}
function requireSingleLineName(name, kind) {
  if (/[\r\n]/.test(name)) {
    throw usageError(`A ${kind} name must be a single line`);
  }
}
function buildEntity(project, kind, name, options) {
  const requestedId = requestedEntityId(kind, options.id);
  if (kind === "chapter") {
    const number = options.number === undefined ? project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0) + 1 : requirePositiveInteger(options.number, "chapter number");
    const id = `chapter-${String(number).padStart(2, "0")}`;
    return entityResult(project, kind, id, chapterFile(name, number, options));
  }
  if (kind === "scene") {
    if (options.chapter === undefined && project.chapters.length === 0) {
      throw usageError("No chapters yet: add one with story add chapter before adding a scene");
    }
    const chapter = String(options.chapter ?? project.chapters.at(-1).id).trim();
    requireKebabId(chapter, "chapter id");
    if (!project.chapters.some((entry) => entry.id === chapter)) {
      throw usageError(`chapter ${chapter} does not exist: add it with story add chapter, or pass --chapter with an existing chapter id`);
    }
    const scene = options.scene === undefined ? nextSceneNumber(project, chapter) : requirePositiveInteger(options.scene, "scene number");
    const id = `${chapter}-scene-${String(scene).padStart(2, "0")}`;
    return entityResult(project, kind, id, sceneFile(name, chapter, scene, options));
  }
  const id = requestedId ?? kebabCase(name);
  if (!id) {
    throw usageError(undeducibleIdMessage(kind, name));
  }
  switch (kind) {
    case "character":
      return entityResult(project, kind, id, characterFile(name, options));
    case "location":
      return entityResult(project, kind, id, locationFile(name, options));
    case "system":
      return entityResult(project, kind, id, systemFile(name, options));
    case "faction":
      return entityResult(project, kind, id, factionFile(name, options));
    case "artifact":
      return entityResult(project, kind, id, artifactFile(name, options));
    case "arc":
      return entityResult(project, kind, id, arcFile(name, options));
    case "question":
      return entityResult(project, kind, id, questionFile(name, options));
    case "promise":
      return entityResult(project, kind, id, promiseFile(name, options));
    case "clue":
      return entityResult(project, kind, id, clueFile(name, options));
    case "term":
      return entityResult(project, kind, id, termFile(name, options));
    case "matter":
      return entityResult(project, kind, id, matterFile(project, name, options));
    case "research":
      return entityResult(project, kind, id, researchFile(name, options));
  }
}
function entityResult(project, kind, id, markdown) {
  const config = entityConfig(kind);
  return { id, markdown, file: path11.join(project.root, config.dir, `${id}.md`) };
}
function entityConfig(kind) {
  const configs = {
    character: { dir: "characters", titleField: "name" },
    location: { dir: path11.join("worldbuilding", "locations"), titleField: "name" },
    system: { dir: path11.join("worldbuilding", "systems"), titleField: "name" },
    faction: { dir: path11.join("worldbuilding", "factions"), titleField: "name" },
    artifact: { dir: path11.join("worldbuilding", "artifacts"), titleField: "name" },
    arc: { dir: path11.join("plot", "arcs"), titleField: "name" },
    chapter: { dir: "chapters", titleField: "title" },
    scene: { dir: "scenes", titleField: "title" },
    question: { dir: path11.join("continuity", "questions"), titleField: "title" },
    promise: { dir: path11.join("continuity", "promises"), titleField: "title" },
    clue: { dir: path11.join("continuity", "clues"), titleField: "title" },
    term: { dir: path11.join("glossary", "terms"), titleField: "term" },
    matter: { dir: MATTER_DIR, titleField: "title" },
    research: { dir: RESEARCH_DIR, titleField: "title" }
  };
  return configs[kind];
}
var KIND_ALIASES = {
  character: "character",
  characters: "character",
  location: "location",
  locations: "location",
  system: "system",
  systems: "system",
  faction: "faction",
  factions: "faction",
  artifact: "artifact",
  artifacts: "artifact",
  arc: "arc",
  arcs: "arc",
  chapter: "chapter",
  chapters: "chapter",
  scene: "scene",
  scenes: "scene",
  question: "question",
  questions: "question",
  promise: "promise",
  promises: "promise",
  clue: "clue",
  clues: "clue",
  term: "term",
  terms: "term",
  "glossary-term": "term",
  "glossary-terms": "term",
  glossary: "term",
  matter: "matter",
  research: "research",
  "research-note": "research",
  "research-notes": "research"
};
function normalizeKind(kind) {
  const normalized = String(kind ?? "").trim().toLowerCase();
  const expected = [...new Set(Object.values(KIND_ALIASES))].join(", ");
  if (normalized === "") {
    throw usageError(`An entity kind is required: expected one of ${expected}`);
  }
  if (!Object.hasOwn(KIND_ALIASES, normalized)) {
    throw usageError(`Unsupported entity kind: ${kind}: expected one of ${expected}`);
  }
  return KIND_ALIASES[normalized];
}
var WINDOWS_RESERVED_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
function assertPortableFolderName(name) {
  if (WINDOWS_RESERVED_ID.test(name.split(".")[0].trim().toLowerCase())) {
    throw usageError(`Cannot use folder ${name}: Windows reserves that name. Choose another --dir`);
  }
  if (/[. ]$/.test(name)) {
    throw usageError(`Cannot use folder "${name}": Windows does not allow a folder name ending in a dot or space. Choose another --dir`);
  }
  if (/[<>:"|?*\x00-\x1f]/.test(name)) {
    throw usageError(`Cannot use folder "${name}": Windows does not allow < > : " | ? * or control characters in folder names. Choose another --dir`);
  }
}
function assertPortableId(id, kind) {
  if (WINDOWS_RESERVED_ID.test(id)) {
    const file = kind === "story" ? id : `${id}.md`;
    throw usageError(`Cannot use ${kind} id ${id}: Windows reserves the file name ${file}. Choose a longer name, such as "${id} ${kind}"`);
  }
}
function requireKebabId(id, label) {
  if (!isKebabId2(id)) {
    throw usageError(`${label} must be a kebab-case id, got "${id}"`);
  }
}
function requestedEntityId(kind, value) {
  const id = String(value ?? "").trim();
  if (id === "") {
    return;
  }
  if (kind === "chapter" || kind === "scene") {
    throw usageError(`--id does not apply to a ${kind}: a ${kind} id comes from its number. Use --number for a chapter, or --chapter and --scene for a scene`);
  }
  requireKebabId(id, `${kind} id`);
  return id;
}
function undeducibleIdMessage(kind, name) {
  return `Cannot derive a kebab-case id from ${kind} name "${name}": pass --id with a kebab-case id, or use a name containing ASCII letters or digits`;
}
function parseDecimalInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}
function requireBookNumber(value) {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  const number = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  if (!isBookNumber(number)) {
    throw usageError(`Book number must be 0 or a positive number, such as 2, 0 for a prequel, or 1.5 for a novella; got ${value}`);
  }
  return number;
}
function requirePositiveInteger(value, label) {
  const number = parseDecimalInteger(value);
  if (number === null || number <= 0) {
    throw usageError(`${label} must be a positive integer, got ${value}`);
  }
  return number;
}
function isKebabId2(value) {
  const text = String(value ?? "").trim();
  return text !== "" && text === kebabCase(text);
}
function characterFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    role: options.role ?? "supporting",
    status: options.status ?? "alive",
    aliases: [],
    relationships: [],
    locations: listOption(options, "locations", "location"),
    tags: [],
    arc: options.arc ?? ""
  })}# ${name}

## Appearance

Add physical details that matter on the page.

## Personality & Traits

Add behavior, temperament, habits, and contradictions.

## Backstory

Add only story-relevant history.

## Motivations & Goals

External want, internal need, and the conflict between them.

## Voice & Speech Patterns

Add 2-3 example lines.

## Character Arc

- **Starting state:**
- **Key turning points:**
- **Ending state:**

## Timeline

| When | Event | Relevance |
|------|-------|-----------|
| | | |
`;
}
function locationFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "other",
    region: options.region ?? "",
    population: options.population ?? "",
    "controlled-by": options["controlled-by"] ?? "",
    "notable-characters": listOption(options, "characters", "character"),
    tags: [],
    status: options.status ?? "unknown"
  })}# ${name}

## Description

Add sensory details and first impressions.

## History

Add relevant history.

## Culture & Customs

Add social norms, rituals, or local patterns.

## Notable Features

Add landmarks or practical story elements.

## Current State

Add what is true at the current story moment.
`;
}
function systemFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "other",
    prevalence: options.prevalence ?? "uncommon"
  })}# ${name}

## Overview

Summarize the system and why it matters.

## Rules & Limitations

Define costs, limits, and exceptions.

## History

Add origin and changes over time.

## Practitioners

Add users, institutions, or gatekeepers.

## Impact on Society

Add consequences for daily life and conflict.
`;
}
function factionFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "other",
    status: options.status ?? "active",
    members: listOption(options, "members", "member", "characters", "character"),
    locations: listOption(options, "locations", "location"),
    tags: []
  })}# ${name}

## Purpose

What the faction wants and why it exists.

## Power Base

Resources, influence, territory, leverage, or rituals.

## Members

Important members and their roles.

## Conflicts

Internal and external pressures.
`;
}
function artifactFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "object",
    status: options.status ?? "active",
    owner: options.owner ?? "",
    location: options.location ?? "",
    tags: []
  })}# ${name}

## Description

What it is and how readers recognize it.

## Function

What it can do, cannot do, costs, and constraints.

## History

Where it came from and why it matters.

## Current State

Who has it, where it is, and what changed recently.
`;
}
function arcFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "subplot",
    status: options.status ?? "planned",
    characters: listOption(options, "characters", "character"),
    themes: listOption(options, "themes", "theme"),
    acts: listOption(options, "acts", "act")
  })}# ${name}

## Setup

Initial state and inciting pressure.

## Rising Action

1. First escalation
2. Second escalation
3. Reversal or complication

## Climax

Decision point or highest tension.

## Resolution

What changes because of this arc.

## Plot Points

| # | Plot Point | Act | Chapter | Status | Notes |
|---|------------|-----|---------|--------|-------|
| 1 | | | | planned | |

## Foreshadowing

| Planted | Payoff | Chapter Planted | Chapter Payoff | Status |
|---------|--------|-----------------|----------------|--------|
| | | | | planned |
`;
}
function chapterFile(title, number, options) {
  const dateError = storyDateError(options.date);
  if (dateError) {
    throw usageError(dateError);
  }
  const timeError = storyTimeError(options.time);
  if (timeError) {
    throw usageError(timeError);
  }
  return `${stringifyFrontmatter({
    title,
    number,
    pov: options.pov ?? "",
    locations: listOption(options, "locations", "location"),
    characters: castWithPov(options),
    mentions: listOption(options, "mentions", "mention"),
    "arcs-advanced": listOption(options, "arcs", "arc"),
    status: options.status ?? "outline",
    mode: options.mode ?? "",
    date: options.date ?? "",
    time: options.time ?? "",
    ...options.hook === undefined ? {} : { hook: options.hook },
    "word-count": 0
  })}# ${chapterHeading(number, title)}

## Outline

1. Opening beat
2. Escalation
3. Turn or decision

---

## Chapter Text

`;
}
function sceneFile(title, chapter, scene, options) {
  const dateError = storyDateError(options.date);
  if (dateError) {
    throw usageError(dateError);
  }
  const timeError = storyTimeError(options.time);
  if (timeError) {
    throw usageError(timeError);
  }
  const travelHoursOption = options["travel-hours"];
  let travelHours;
  if (travelHoursOption !== undefined && travelHoursOption !== "") {
    travelHours = Number(travelHoursOption);
    if (!Number.isFinite(travelHours)) {
      throw usageError(`travel-hours must be a number, got ${travelHoursOption}`);
    }
    if (travelHours < 0) {
      throw usageError(`travel-hours must be zero or positive, got ${travelHoursOption}`);
    }
  }
  const frontmatter = {
    title,
    chapter,
    scene,
    pov: options.pov ?? "",
    location: options.location ?? "",
    characters: castWithPov(options),
    mentions: listOption(options, "mentions", "mention"),
    "arcs-advanced": listOption(options, "arcs", "arc"),
    status: options.status ?? "outline",
    date: options.date ?? "",
    time: options.time ?? "",
    sequel: options.sequel ?? false,
    ...options.outcome === undefined ? {} : { outcome: options.outcome },
    dilemma: options.dilemma ?? "",
    "state-changes": []
  };
  if (travelHours !== undefined) {
    frontmatter["travel-hours"] = travelHours;
  }
  return `${stringifyFrontmatter(frontmatter)}# ${title}

## Purpose

What this scene changes.

## Continuity Notes

Character state, object state, knowledge changes, and timeline facts.
`;
}
function castWithPov(options) {
  const characters = listOption(options, "characters", "character");
  const pov = String(options.pov ?? "").trim();
  return pov === "" || characters.includes(pov) ? characters : [pov, ...characters];
}
function questionFile(title, options) {
  const resolved = String(options.resolved ?? "").trim();
  if (resolved !== "" && options.status === "open") {
    throw usageError("A question with --resolved cannot have status open: use --status answered or resolved");
  }
  return `${stringifyFrontmatter({
    title,
    status: options.status ?? (resolved === "" ? "open" : "answered"),
    introduced: options.introduced ?? "",
    resolved: options.resolved ?? "",
    characters: listOption(options, "characters", "character")
  })}# ${title}

## Question

What the reader or continuity tracker needs answered.

## Evidence

Known clues, constraints, and contradictions.

## Resolution Plan

How and when this should resolve.
`;
}
function promiseFile(title, options) {
  return `${stringifyFrontmatter({
    title,
    status: options.status ?? plantedDefaultStatus(options),
    planted: options.planted ?? "",
    payoff: options.payoff ?? "",
    arcs: listOption(options, "arcs", "arc"),
    characters: listOption(options, "characters", "character")
  })}# ${title}

## Setup

What is promised to the reader.

## Payoff

How the story should answer the setup.

## Tracking Notes

Keep planted and payoff chapters current.
`;
}
function plantedDefaultStatus(options) {
  return String(options.planted ?? "").trim() !== "" ? "planted" : "planned";
}
function clueFile(title, options) {
  return `${stringifyFrontmatter({
    title,
    status: options.status ?? plantedDefaultStatus(options),
    planted: options.planted ?? "",
    payoff: options.payoff ?? "",
    "significance-delayed": options["significance-delayed"] ?? false,
    ...options["red-herring"] ? { "red-herring": true } : {},
    characters: listOption(options, "characters", "character"),
    arcs: listOption(options, "arcs", "arc")
  })}# ${title}

## Clue

What the reader sees and why it matters.

## Planting Plan

How and when to plant it.

## Payoff Plan

How the payoff lands.

## Tracking Notes

Keep planted and payoff chapters current.
`;
}
function termFile(term, options) {
  return `${stringifyFrontmatter({
    term,
    category: options.category ?? "term",
    aliases: listOption(options, "aliases", "alias")
  })}# ${term}

## Definition

Define the term in story context.

## Usage Notes

How agents should use this term consistently.
`;
}
function researchFile(title, options) {
  return `${stringifyFrontmatter({
    title,
    status: options.status ?? "open",
    sources: [...new Set(asArray(options.sources).concat(asArray(options.source)).map((source) => String(source).trim()).filter(Boolean))],
    "used-in": listOption(options, "used-in"),
    ...researchOptionalFields(options)
  })}# ${title}

## Question

What the story needs to get right.

## Findings

The facts, with the source for each.

## Story Use

How the chapters use these facts, and what was changed on purpose.
`;
}
function researchOptionalFields(options) {
  const fields = {};
  for (const key of ["accuracy", "confidence", "method"]) {
    if (options[key] !== undefined) {
      fields[key] = String(options[key]);
    }
  }
  const risks = listOption(options, "risk");
  for (const risk of risks) {
    if (!RESEARCH_RISKS.has(risk)) {
      throw usageError(`Unsupported risk "${risk}": expected one of ${[...RESEARCH_RISKS].join(", ")}`);
    }
  }
  if (risks.length > 0) {
    fields.risk = risks;
  }
  return fields;
}
function matterFile(project, title, options) {
  const placement = String(options.placement ?? "front");
  let order;
  if (options.order === undefined) {
    order = project.matter.filter((matter) => matter.placement === placement).reduce((max, matter) => Math.max(max, matter.order), 0) + 1;
  } else {
    order = parseDecimalInteger(options.order);
    if (order === null) {
      throw usageError(`matter order must be a non-negative integer, got ${options.order}`);
    }
  }
  const heading = options.heading === undefined ? true : isTruthy(options.heading);
  return `${stringifyFrontmatter({ title, placement, order, heading })}# ${title}

`;
}
function nextSceneNumber(project, chapter) {
  return project.scenes.filter((scene) => scene.chapter === chapter).reduce((max, scene) => Math.max(max, scene.scene), 0) + 1;
}
function ensureDirectory(directory, changed, root) {
  if (!fs7.existsSync(directory)) {
    assertLexicallyInsideRoot(directory, root);
    assertExistingAncestorInsideRoot(directory, root);
    makeDirectories(directory);
    assertSafeProjectDirectory(directory, root);
    changed.push(directory);
    return;
  }
  assertSafeProjectDirectory(directory, root);
}
function ensureFile(filePath, contents, changed, root) {
  if (!fs7.existsSync(filePath)) {
    writeFile(filePath, contents, { root });
    changed.push(filePath);
    return;
  }
  assertSafeProjectPath(filePath, root);
}
var REFERENCE_FIELD_KINDS = {
  arc: ["arc"],
  arcs: ["arc"],
  "arcs-advanced": ["arc"],
  artifact: ["artifact"],
  chapter: ["chapter"],
  character: ["character"],
  characters: ["character"],
  "controlled-by": ["faction", "character"],
  "died-in": ["chapter"],
  "revived-in": ["chapter"],
  introduced: ["chapter"],
  "learned-in": ["chapter"],
  "used-in": ["chapter"],
  location: ["location"],
  locations: ["location"],
  members: ["character"],
  mentions: ["character", "artifact"],
  "notable-characters": ["character"],
  owner: ["character", "faction"],
  payoff: ["chapter"],
  planted: ["chapter"],
  pov: ["character"],
  resolved: ["chapter"],
  since: ["chapter"],
  target: ["artifact"]
};
var ENTRY_IDENTITY_FIELDS = {
  relationships: "character",
  "character-state": "character",
  "knowledge-state": "character",
  "object-state": "artifact",
  progressions: "from",
  routes: "to",
  choices: "to"
};
var NESTED_TO_KINDS = { routes: "location", choices: "chapter" };
function entityReferenceContext(root, kind, id) {
  const otherExists = new Map;
  const existsAs = (other) => {
    if (!otherExists.has(other)) {
      otherExists.set(other, fs7.existsSync(path11.join(root, entityConfig(other).dir, `${id}.md`)));
    }
    return otherExists.get(other);
  };
  return {
    id,
    kind,
    entityFile: path11.resolve(root, entityConfig(kind).dir, `${id}.md`),
    isReferenceKey: (key, listKey = null) => {
      if (key === "to") {
        return listKey !== null && Object.hasOwn(NESTED_TO_KINDS, listKey) && NESTED_TO_KINDS[listKey] === kind;
      }
      const kinds = Object.hasOwn(REFERENCE_FIELD_KINDS, key) ? REFERENCE_FIELD_KINDS[key] : [];
      return kinds.includes(kind) && !kinds.some((other) => other !== kind && existsAs(other));
    }
  };
}
function resolveLinkTarget(root, file, target) {
  const cleaned = String(target).trim().split(/\s+/)[0].replace(/^<|>$/g, "").split("#")[0].split("?")[0];
  if (cleaned === "" || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(cleaned)) {
    return null;
  }
  let decoded = cleaned;
  try {
    decoded = decodeURIComponent(cleaned);
  } catch {
    decoded = cleaned;
  }
  return decoded.startsWith("/") ? path11.resolve(root, `.${decoded}`) : path11.resolve(path11.dirname(file), decoded);
}
var LINK_DEFINITION_PATTERN = /^( {0,3}\[)([^\]\n]+)\]:[ \t]*(<[^>\n]*>|[^\s]+)/gm;
function renameLinkTargets(root, file, body, context, newId) {
  const retarget = (target) => target.replace(new RegExp(`(^|/|<)${escapeRegExp(context.id)}\\.md(?=$|[#?>\\s])`), `$1${newId}.md`);
  return body.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, (match, text, target) => {
    if (resolveLinkTarget(root, file, target) !== context.entityFile) {
      return match;
    }
    const nextText = text === context.id ? newId : text;
    return `[${nextText}](${retarget(target)})`;
  }).replace(LINK_DEFINITION_PATTERN, (match, open, label, target) => {
    if (resolveLinkTarget(root, file, target) !== context.entityFile) {
      return match;
    }
    return `${match.slice(0, match.length - target.length)}${retarget(target)}`;
  });
}
function replaceEntityReferences(root, kind, oldId, newId, overrides) {
  const context = entityReferenceContext(root, kind, oldId);
  return planReferenceRewrites(root, context, overrides, (value) => idText(value) === oldId ? newId : value, (body, file) => renameLinkTargets(root, file, body, context, newId));
}
function removeEntityReferences(root, kind, id, overrides) {
  const context = entityReferenceContext(root, kind, id);
  return planReferenceRewrites(root, context, overrides, (value) => idText(value) === id ? null : value, (body) => body);
}
function planReferenceRewrites(root, context, overrides, transform, transformBody) {
  const plan = new Map;
  plan.originals = new Map;
  const storyFile = path11.join(root, "story.md");
  let otherFiles = 0;
  for (const file of markdownFiles(root, { maxFiles: Infinity })) {
    const override = overrides?.has(file) ? overrides.get(file) : undefined;
    if (override === null) {
      continue;
    }
    const sourceFile = isProjectSourceFile(root, file);
    let text = override;
    if (text === undefined) {
      assertSafeProjectPath(file, root);
      if (!sourceFile) {
        otherFiles += 1;
        if (otherFiles > MAX_SCAN_FILES || fs7.lstatSync(file).size > MAX_SCAN_FILE_BYTES) {
          continue;
        }
      }
      text = readTextFile(file);
      plan.originals.set(file, text);
    }
    const match = FRONTMATTER_PATTERN.exec(text);
    if (!match && sourceFile) {
      throw projectError(`${path11.relative(root, file)} is missing YAML frontmatter${registryHint(root, file)}; nothing was changed`);
    }
    let header = "";
    let body = text;
    if (match) {
      header = match[0];
      body = text.slice(match[0].length);
      if (file !== storyFile) {
        let data = null;
        try {
          data = parseFrontmatter(text, file).data;
        } catch (error) {
          if (sourceFile) {
            throw projectError(`${path11.relative(root, file)}: ${error.message}${registryHint(root, file)}; nothing was changed`);
          }
        }
        if (data !== null) {
          let nextData = transformReferences(data, transform, context);
          if (context.kind === "chapter") {
            nextData = reconcileChapterStatuses(data, nextData);
          }
          if (JSON.stringify(nextData) !== JSON.stringify(data)) {
            header = replaceFrontmatter(header, nextData);
          }
        }
      }
    }
    const next = `${header}${transformBody(body, file)}`;
    if (next !== text || override !== undefined) {
      plan.set(file, next);
    }
  }
  return plan;
}
var FRONTMATTER_FILES = new Set([
  path11.join("plot", "timeline.md"),
  path11.join("continuity", "state.md"),
  path11.join("continuity", "exemptions.md")
]);
var REGISTRY_FILES = new Set([
  ...INDEX_SCHEMAS.map(([relativePath]) => relativePath),
  path11.join(MATTER_DIR, "_index.md"),
  path11.join(RESEARCH_DIR, "_index.md")
]);
function registryHint(root, file) {
  return REGISTRY_FILES.has(path11.relative(root, file)) ? REGISTRY_HINT : "";
}
var REGISTRY_HINT = " (it is a registry: run story reindex to rebuild it)";
function isProjectSourceFile(root, file) {
  const relativePath = path11.relative(root, file);
  return SOURCE_ROOT_FILES.has(relativePath) || FRONTMATTER_FILES.has(relativePath) || REGISTRY_FILES.has(relativePath) || ENTITY_SCAN_DIRS.includes(path11.dirname(relativePath));
}
function reconcileChapterStatuses(before, after) {
  const next = { ...after };
  if (before.planted && !next.planted && (next.status === "planted" || next.status === "paid-off")) {
    next.status = "planned";
  }
  if (before.payoff && !next.payoff && next.status === "paid-off") {
    next.status = "planted";
  }
  if (before.resolved && !next.resolved && (next.status === "answered" || next.status === "resolved")) {
    next.status = "open";
  }
  return next;
}
function writeReferencePlan(root, plan) {
  for (const [file, contents] of plan) {
    writeFile(file, contents, { root, unchangedFrom: plan.originals?.get(file) });
  }
}
var UNWRITABLE_REASONS = { EACCES: "permission denied", EPERM: "permission denied", EROFS: "the file system is read-only" };
function assertWritable(root, changed, created = []) {
  const problems = new Map;
  const check = (target, label) => {
    try {
      fs7.accessSync(target, fs7.constants.W_OK);
    } catch (error) {
      if (!problems.has(label)) {
        problems.set(label, UNWRITABLE_REASONS[error.code] ?? error.code ?? error.message);
      }
    }
  };
  const folder = (file) => {
    const directory = path11.dirname(file);
    const shown = path11.relative(root, directory);
    if (fs7.existsSync(directory)) {
      check(directory, shown === "" ? "the project folder" : `${shown}/`);
    }
  };
  for (const file of changed) {
    if (fs7.existsSync(file)) {
      check(file, path11.relative(root, file));
    }
    folder(file);
  }
  for (const file of created) {
    folder(file);
  }
  if (problems.size > 0) {
    const list = [...problems].map(([label, reason]) => `${label} (${reason})`).join(", ");
    throw refusedError(`Cannot write to ${list}; nothing was changed. Fix ${problems.size === 1 ? "it" : "them"} and run the command again`);
  }
}
function commitWrites(write) {
  try {
    return write();
  } catch (error) {
    throw Object.assign(error, { hint: "Some files were already updated: fix the problem and run the same command again to finish" });
  }
}
function transformReferences(data, transform, context, identityKey = null, listKey = null) {
  const next = {};
  const set = (key, value) => Object.defineProperty(next, key, { value, enumerable: true, configurable: true, writable: true });
  const progression = identityKey === "from";
  const isReference = (key) => (progression && key === "value" ? typeof data.field === "string" && context.isReferenceKey(data.field) : context.isReferenceKey(key, listKey)) || key === "from" && progression && context.kind === "chapter";
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      const items = [];
      const childIdentity = Object.hasOwn(ENTRY_IDENTITY_FIELDS, key) ? ENTRY_IDENTITY_FIELDS[key] : null;
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const mapped = transformReferences(item, transform, context, childIdentity, key);
          if (mapped !== null) {
            items.push(mapped);
          }
        } else if (isReference(key)) {
          const mapped = transform(item);
          if (mapped !== null) {
            items.push(mapped);
          }
        } else {
          items.push(item);
        }
      }
      set(key, items);
      continue;
    }
    if (isReference(key)) {
      const mapped = transform(value);
      if (mapped === null) {
        if (identityKey !== null && key === identityKey) {
          return null;
        }
        set(key, "");
        continue;
      }
      set(key, mapped);
      continue;
    }
    set(key, value);
  }
  return next;
}
function applyEntityBacklinks(root, kind, id, data) {
  if (kind === "location") {
    for (const characterId of asArray(data["notable-characters"])) {
      if (isKebabId2(characterId)) {
        addFrontmatterListValue(root, path11.join("characters", `${characterId}.md`), "locations", id);
      }
    }
  }
  if (kind === "scene" && isKebabId2(data.chapter)) {
    const chapterFile = path11.join("chapters", `${data.chapter}.md`);
    const exists = (dir, id) => fs7.existsSync(path11.join(root, dir, `${id}.md`));
    if (isKebabId2(data.location) && exists(path11.join("worldbuilding", "locations"), data.location)) {
      addFrontmatterListValue(root, chapterFile, "locations", data.location);
    }
    const chapterPath = path11.join(root, chapterFile);
    const mentions = fs7.existsSync(chapterPath) ? asArray(readMarkdown(chapterPath, root).data.mentions) : [];
    for (const characterId of asArray(data.characters)) {
      if (isKebabId2(characterId) && exists("characters", characterId) && !mentions.includes(characterId)) {
        addFrontmatterListValue(root, chapterFile, "characters", characterId);
      }
    }
  }
  if (kind === "character") {
    for (const locationId of asArray(data.locations)) {
      if (isKebabId2(locationId)) {
        addFrontmatterListValue(root, path11.join("worldbuilding", "locations", `${locationId}.md`), "notable-characters", id);
      }
    }
  }
}
function addFrontmatterListValue(root, relativePath, field, value) {
  const filePath = path11.join(root, relativePath);
  if (!fs7.existsSync(filePath) || !value) {
    return;
  }
  assertSafeProjectPath(filePath, root);
  const markdown = readMarkdown(filePath, root);
  const list = asArray(markdown.data[field]);
  if (!list.includes(value)) {
    writeFile(filePath, replaceFrontmatter(markdown.rawMarkdown, {
      ...markdown.data,
      [field]: list.concat(value)
    }), { root });
  }
}
var SKIPPED_SCAN_DIRECTORIES = new Set(["dist", "node_modules"]);
function markdownFiles(root, { maxFiles = MAX_SCAN_FILES } = {}, depth = 0, collected = null) {
  const files = collected ?? [];
  for (const entry of fs7.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path11.join(root, entry.name);
    if (entry.isDirectory() && !SKIPPED_SCAN_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
      if (depth < MAX_SCAN_DEPTH && !fs7.existsSync(path11.join(fullPath, "story.md"))) {
        markdownFiles(fullPath, { maxFiles }, depth + 1, files);
      }
    } else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".")) {
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
function bookChapters(project, action = "build") {
  assertProjectParses(project, action);
  if (project.chapters.length === 0) {
    throw projectError("No chapters found to export");
  }
  for (const chapter of project.chapters) {
    if (!chapter.numberValid || chapter.number <= 0) {
      throw projectError(`${relative2(project, chapter.file)}: chapter number must be a positive integer to build`);
    }
  }
  const seenNumbers = new Set;
  for (const chapter of project.chapters) {
    if (seenNumbers.has(chapter.number)) {
      throw projectError(`Duplicate chapter number ${chapter.number}: refusing to build with colliding EPUB ids`);
    }
    seenNumbers.add(chapter.number);
  }
  const meta = publishingMeta(project.story.data);
  const chapters = [];
  const warnings = [];
  let unnumberedSoFar = 0;
  const keys = new Set;
  for (const chapter of project.chapters) {
    const markdown = readMarkdown(chapter.file, project.root);
    const rawTitle = markdown.data.title;
    const title = rawTitle === undefined || rawTitle === null ? "" : String(rawTitle).trim();
    const numbered = markdown.data.numbered !== false;
    if (!numbered && title === "") {
      throw projectError(`${relative2(project, chapter.file)}: an unnumbered chapter needs a title to build`);
    }
    unnumberedSoFar += numbered ? 0 : 1;
    const displayNumber = numbered ? chapter.number - unnumberedSoFar : null;
    const entry = {
      number: chapter.number,
      title,
      numbered,
      displayNumber,
      heading: numbered ? chapterHeading(displayNumber, title, meta.chapterLabel) : title,
      body: chapterProse(markdown.body).replace(/\r\n?/g, `
`).trim()
    };
    chapters.push({ ...entry, key: chapterKey(entry, keys) });
    if (wordCount(entry.body) === 0) {
      warnings.push(warn("empty-chapter", `${relative2(project, chapter.file)} has no prose yet and is built as a heading-only page`, relative2(project, chapter.file)));
    }
  }
  return { meta, chapters, warnings };
}
function manuscriptParts(project, action = "build") {
  const { meta, chapters, warnings } = bookChapters(project, action);
  for (const entry of project.matter) {
    if (!isKebabId2(entry.id)) {
      throw projectError(`${relative2(project, entry.file)}: matter file names must be kebab-case to build`);
    }
  }
  const matter = (placement) => project.matter.filter((entry) => entry.placement === placement && !entry.empty).map((entry) => ({
    id: entry.id,
    title: entry.title,
    heading: entry.heading,
    copyright: isCopyrightMatter(entry),
    body: chapterProse(readMarkdown(entry.file, project.root).body).replace(/\r\n?/g, `
`).trim()
  }));
  const front = matter("front");
  const back = matter("back");
  const hasCopyrightPage = [...front, ...back].some((entry) => entry.copyright);
  if (meta.copyright !== "" && !hasCopyrightPage) {
    front.unshift({ id: "copyright", title: "Copyright", heading: false, copyright: true, body: copyrightPage(meta) });
  }
  return {
    title: project.title,
    author: meta.authors.join(" and "),
    meta,
    front,
    chapters,
    back,
    warnings
  };
}
function chapterChoices(chapter, label) {
  const choices = [];
  const problems = [];
  if (chapter.choices === undefined) {
    return { choices, problems };
  }
  if (!Array.isArray(chapter.choices)) {
    problems.push(err("field-not-list", `${label} frontmatter field choices must be a list of { text, to } entries`, label));
    return { choices, problems };
  }
  chapter.choices.forEach((choice, index) => {
    const at = `${label} choices[${index}]`;
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
      problems.push(err("invalid-choice", `${at} must have text and to, such as { text: Follow the light, to: chapter-02 }`, label));
      return;
    }
    const text = typeof choice.text === "string" ? choice.text.trim() : "";
    const to = typeof choice.to === "string" ? choice.to : "";
    const before = problems.length;
    if (text === "") {
      problems.push(err("invalid-choice", `${at} needs text: the words the reader picks, quoted if they look like a number`, label));
    } else if (TWEE_LINK_UNSAFE.test(text)) {
      problems.push(err("invalid-choice", `${at} text cannot contain [, ], |, ->, <-, or a line break, or end in <, which Twine reads as link syntax`, label));
    }
    if (to.trim() === "") {
      problems.push(err("invalid-choice", `${at} needs to: the id of the chapter it leads to, such as chapter-02`, label));
    } else if (to !== kebabCase(to)) {
      problems.push(err("id-not-kebab", `${at} to ${to} must be a kebab-case chapter id`, label));
    }
    if (problems.length === before) {
      choices.push({ text, to, index });
    }
  });
  return { choices, problems };
}
function branchGraph(project) {
  const ids = new Set(project.chapters.map((chapter) => chapter.id));
  const parsed = project.chapters.map((chapter) => {
    const label = relative2(project, chapter.file);
    return { chapter, label, ...chapterChoices(chapter, label) };
  });
  const branching = parsed.some((entry) => entry.choices.length > 0);
  const problems = parsed.flatMap((entry) => entry.problems);
  const missing = [];
  const warnings = [];
  const passages = parsed.map((entry, position) => {
    if (!branching) {
      const next = project.chapters[position + 1];
      return { chapter: entry.chapter, links: next ? [{ text: "Continue", to: next.id }] : [] };
    }
    for (const choice of entry.choices) {
      if (!ids.has(choice.to)) {
        missing.push({ to: choice.to, finding: err("missing-reference", `${entry.label} choices[${choice.index}] references missing chapter ${choice.to}`, entry.label) });
      }
    }
    return { chapter: entry.chapter, links: entry.choices.filter((choice) => ids.has(choice.to)).map(({ text, to }) => ({ text, to })) };
  });
  if (branching) {
    const byId = new Map(passages.map((passage) => [passage.chapter.id, passage]));
    const start = passages[0].chapter.id;
    const reached = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      for (const link of byId.get(queue.shift()).links) {
        if (!reached.has(link.to)) {
          reached.add(link.to);
          queue.push(link.to);
        }
      }
    }
    for (const passage of passages) {
      if (!reached.has(passage.chapter.id)) {
        warnings.push(warn("unreachable-chapter", `${relative2(project, passage.chapter.file)} cannot be reached: no choice path from ${start} leads to it`, relative2(project, passage.chapter.file)));
      }
    }
  }
  return { branching, passages, problems, missing, warnings };
}
function chapterKey(chapter, keys) {
  if (chapter.numbered) {
    return `ch${String(chapter.displayNumber).padStart(2, "0")}`;
  }
  let key = kebabCase(chapter.title, { transliterate: false });
  if (key === "" || keys.has(key) || /^(?:ch\d+$|front-|back-|matter-|unnumbered-)/.test(key)) {
    key = `unnumbered-${String(chapter.number).padStart(2, "0")}`;
  }
  keys.add(key);
  return key;
}
function isCopyrightMatter(entry) {
  return entry.id === "copyright" || /copyright/i.test(entry.title);
}
var MAX_SCAN_FILE_BYTES = 5 * 1024 * 1024;
var MAX_SCAN_FILES = 5000;
var MAX_SCAN_DEPTH = 10;
var MAX_COVER_BYTES = 50 * 1024 * 1024;
function assertFileSizeWithinLimit(filePath, limit = MAX_SCAN_FILE_BYTES) {
  const size = fs7.statSync(filePath).size;
  if (size > limit) {
    throw projectError("Refusing to read oversized file " + filePath + ": " + size + " bytes exceeds the " + limit + " byte limit");
  }
}
function readEntityFiles(root, relativeDir, mapEntity, scanErrors) {
  const directory = path11.join(root, relativeDir);
  if (!fs7.existsSync(directory)) {
    return [];
  }
  assertSafeProjectDirectory(directory, root);
  const entities = [];
  const files = fs7.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".") && entry.name !== "_index.md").map((entry) => entry.name).sort();
  if (files.length > MAX_SCAN_FILES) {
    throw projectError("Too many files in " + relativeDir + ": " + files.length + " exceeds the " + MAX_SCAN_FILES + " file limit");
  }
  for (const file of files) {
    const fullPath = path11.join(directory, file);
    const label = path11.join(relativeDir, file);
    try {
      const markdown = readMarkdown(fullPath, root);
      const entity = mapEntity(path11.basename(file, ".md"), fullPath, markdown.data, markdown);
      Object.defineProperty(entity, "frontmatter", { value: markdown.data, enumerable: false });
      entities.push(entity);
    } catch (error) {
      const message = error.message.startsWith(`${fullPath} `) ? error.message.slice(fullPath.length + 1) : error.message;
      scanErrors.push(err("unreadable-file", `${label}: ${message}`, label));
    }
  }
  return entities;
}
function hasPostHocNotes(body) {
  const chapterText = /^## Chapter Text\s*$/im.exec(body);
  return chapterText !== null && /^## Chapter Notes \(post-hoc\)\s*$/m.test(body.slice(0, chapterText.index));
}
function parentProjectHint(projectRoot) {
  let current = path11.dirname(projectRoot);
  while (!fs7.existsSync(path11.join(current, "story.md"))) {
    if (path11.dirname(current) === current) {
      return "";
    }
    current = path11.dirname(current);
  }
  const relative = path11.relative(process.cwd(), current) || ".";
  const shown = relative.length < current.length ? relative : current;
  return ` (the project root looks like ${shown}; pass that path instead)`;
}
function requireStoryFile(projectRoot) {
  const storyPath = path11.join(projectRoot, "story.md");
  if (!fs7.existsSync(storyPath)) {
    if (fs7.statSync(projectRoot, { throwIfNoEntry: false })?.isFile()) {
      throw projectError(`${projectRoot} is a file; pass the folder that contains it`);
    }
    const hint = path11.basename(projectRoot).startsWith("-") ? `; ${path11.basename(projectRoot)} is not an option (run story help)` : parentProjectHint(projectRoot);
    throw projectError(`${projectRoot} is not a story project: missing story.md${hint}`);
  }
  return storyPath;
}
function readExemptions(root, scanErrors) {
  const exemptionsPath = path11.join(root, "continuity", "exemptions.md");
  if (!lstatIfExists(exemptionsPath)) {
    return [];
  }
  let raw;
  try {
    raw = readTextFile(exemptionsPath);
  } catch (error) {
    scanErrors.push(err("unreadable-file", `${path11.join("continuity", "exemptions.md")}: ${relativePathError(error, exemptionsPath, root).message}`, path11.join("continuity", "exemptions.md")));
    return [];
  }
  let data;
  try {
    data = parseFrontmatter(raw, exemptionsPath).data;
  } catch {
    return [];
  }
  return parseExemptions(data.exemptions);
}
function readOptionalRootFile(root, name, scanErrors) {
  const filePath = path11.join(root, name);
  if (!lstatIfExists(filePath)) {
    return null;
  }
  try {
    const markdown = readMarkdown(filePath, root);
    return { file: filePath, data: markdown.data, rawMarkdown: markdown.rawMarkdown };
  } catch (error) {
    scanErrors.push(err("unreadable-file", `${name}: ${error.message}`, name));
    return null;
  }
}
function readStyleSheet(root, scanErrors) {
  const filePath = path11.join(root, STYLE_SHEET_FILE);
  if (!lstatIfExists(filePath)) {
    return null;
  }
  try {
    const markdown = readMarkdown(filePath, root);
    return { file: filePath, data: markdown.data, body: markdown.body };
  } catch (error) {
    scanErrors.push(err("unreadable-file", `${STYLE_SHEET_FILE}: ${error.message}`, STYLE_SHEET_FILE));
    return null;
  }
}
function readMarkdown(filePath, root) {
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
    throw projectError(error.message.startsWith(`${filePath} `) ? error.message.slice(filePath.length + 1) : error.message);
  }
}
function relativePathError(error, filePath, root) {
  const relativePath = path11.relative(root, filePath);
  return projectError(error.message.split(filePath).join(relativePath).split(path11.resolve(root, relativePath)).join(relativePath));
}
function writeChanged(filePath, contents, changed, root) {
  if (safeRead(filePath, root) !== contents) {
    writeFile(filePath, contents, { root });
    changed.push(filePath);
  }
}
function safeRead(filePath, root) {
  if (!fs7.existsSync(filePath)) {
    return "";
  }
  if (root) {
    assertSafeProjectPath(filePath, root);
  }
  return readTextFile(filePath);
}
function readRegistryValidationData(file, root, label, errors) {
  const count = errors.length;
  const data = readValidationData(file, root, label, errors);
  if (data === null && errors.length > count) {
    const last = errors[errors.length - 1];
    errors[errors.length - 1] = { ...last, message: `${last.message}${REGISTRY_HINT}` };
  }
  return data;
}
function readValidationData(file, root, label, errors) {
  try {
    return readMarkdown(file, root).data;
  } catch (error) {
    const message = `${label}: ${error.message}`;
    if (!hasMessage(errors, message)) {
      errors.push(err("unreadable-file", message, label));
    }
    return null;
  }
}
function hasMessage(findings, message) {
  return findings.some((finding) => finding.message === message);
}
var ENTITY_SCAN_DIRS = [
  "characters",
  "chapters",
  "scenes",
  path11.join("worldbuilding", "locations"),
  path11.join("worldbuilding", "systems"),
  path11.join("worldbuilding", "factions"),
  path11.join("worldbuilding", "artifacts"),
  path11.join("plot", "arcs"),
  path11.join("continuity", "questions"),
  path11.join("continuity", "promises"),
  path11.join("continuity", "clues"),
  path11.join("glossary", "terms"),
  MATTER_DIR,
  RESEARCH_DIR
];
function entityFileNames(root, relativeDir) {
  const directory = path11.join(root, relativeDir);
  if (!fs7.existsSync(directory)) {
    return [];
  }
  return fs7.readdirSync(directory).filter((name) => name.endsWith(".md") && !name.startsWith(".") && name !== "_index.md").sort().map((name) => path11.join(relativeDir, name));
}
function collectStrayFileWarnings(project, warnings) {
  const root = project.root;
  const topEntries = fs7.readdirSync(root, { withFileTypes: true });
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
    const directory = path11.join(root, relativeDir);
    if (!fs7.existsSync(directory)) {
      continue;
    }
    for (const file of markdownFiles(directory)) {
      const relativePath = path11.relative(directory, file);
      if (relativePath.includes(path11.sep) || path11.dirname(relativePath) !== ".") {
        nested.push(path11.join(relativeDir, relativePath));
      }
    }
  }
  nested.sort();
  for (const nestedPath of nested) {
    warnings.push(warn("nested-file", `${nestedPath} is nested inside an entity directory and is ignored`, nestedPath));
  }
  for (const relativeDir of ENTITY_SCAN_DIRS) {
    const directory = path11.join(root, relativeDir);
    if (!lstatIfExists(directory)?.isDirectory()) {
      continue;
    }
    const linked = fs7.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isSymbolicLink() && entry.name.endsWith(".md") && !entry.name.startsWith(".") && entry.name !== "_index.md").map((entry) => path11.join(relativeDir, entry.name)).sort();
    for (const linkPath of linked) {
      warnings.push(warn("symlinked-file", `${linkPath} is a symlink and is ignored: replace it with the file itself`, linkPath));
    }
  }
  for (const leftover of temporaryFiles(root).sort()) {
    const name = TEMPORARY_FILE_PATTERN.exec(path11.basename(leftover))?.[1];
    const target = name ? ` to ${path11.join(path11.dirname(leftover), name)}` : "";
    warnings.push(warn("interrupted-write", `${leftover} was left by an interrupted write${target}; delete it once the files beside it look right`, leftover));
  }
}
function temporaryFiles(root, depth = 0, relativeDir = "") {
  const found = [];
  for (const entry of fs7.readdirSync(path11.join(root, relativeDir), { withFileTypes: true })) {
    const relativePath = path11.join(relativeDir, entry.name);
    if (entry.isDirectory() && !SKIPPED_SCAN_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
      if (depth < MAX_SCAN_DEPTH) {
        found.push(...temporaryFiles(root, depth + 1, relativePath));
      }
    } else if (entry.isFile() && (TEMPORARY_FILE_PATTERN.test(entry.name) || /^\.story-\d+\.tmp$/.test(entry.name))) {
      found.push(relativePath);
    }
  }
  return found;
}
function checkIdReference(errors, label, value, kind, exists, file = label) {
  const text = String(value ?? "");
  if (text === "") {
    return;
  }
  if (text !== kebabCase(text)) {
    errors.push(err("id-not-kebab", `${label} references ${kind} ${text} which must be kebab-case`, file));
    return;
  }
  if (!exists(text)) {
    errors.push(err("missing-reference", `${label} references missing ${kind} ${text}`, file));
  }
}
function extractChapterIdTokens(body) {
  return idTokensOutsideLinks(body, /(?<![\w-])chapter-\d+(?![\w-])/g);
}
function extractSceneIdTokens(body) {
  return idTokensOutsideLinks(body, /(?<![\w-])chapter-\d+-scene-\d+(?![\w-])/g);
}
function idTokensOutsideLinks(body, pattern) {
  const found = [];
  mapOutsideLinks(body, (text) => {
    found.push(...text.match(pattern) ?? []);
    return text;
  });
  return found;
}
function extractMarkdownLinkTargets(body) {
  const targets = [];
  const pattern = /\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const inner = match[1].trim();
    const bracketed = /^<([^>]*)>/.exec(inner);
    const target = (bracketed ? bracketed[1] : inner.replace(/\s+(?:"[^"]*"|'[^']*')$/, "")).trim();
    if (target && !/^(https?:|mailto:|#)/i.test(target)) {
      targets.push(target.split("#")[0].split("?")[0]);
    }
  }
  for (const definition of body.matchAll(LINK_DEFINITION_PATTERN)) {
    const target = definition[3].replace(/^<|>$/g, "").trim();
    if (target && !/^(https?:|mailto:|#)/i.test(target)) {
      targets.push(target.split("#")[0].split("?")[0]);
    }
  }
  return targets;
}
function fileStem(storyId) {
  if (storyId.length <= 100) {
    return storyId;
  }
  const cut = storyId.slice(0, 100);
  return cut.slice(0, cut.lastIndexOf("-") > 0 ? cut.lastIndexOf("-") : 100);
}
var SOURCE_ROOT_FILES = new Set(["story.md", STYLE_SHEET_FILE, PROGRESS_FILE]);
var SOURCE_DIRECTORIES = ["characters", "chapters", "scenes", "worldbuilding", "plot", "continuity", "glossary", MATTER_DIR, RESEARCH_DIR];
var HAND_EDITED_DIRECTORIES = ["feedback", "submission", "publishing", "adaptations"];
function assertNotProjectSource(project, outFile) {
  const realRoot = fs7.realpathSync.native(project.root);
  const realTarget = realPathThroughAncestors(outFile);
  const candidates = [[project.root, outFile], [realRoot, realTarget], [realRoot.toLowerCase(), realTarget.toLowerCase()]];
  for (const [root, target] of candidates) {
    const relativePath = path11.relative(root, target);
    if (relativePath === "" || relativePath.startsWith("..") || path11.isAbsolute(relativePath)) {
      continue;
    }
    const lower = relativePath.toLowerCase();
    const [first] = lower.split(path11.sep);
    if (SOURCE_ROOT_FILES.has(lower) || SOURCE_DIRECTORIES.includes(first)) {
      throw refusedError(`Refusing to write generated output to ${path11.relative(project.root, outFile)}: it is project source. Use a path such as dist/ instead`);
    }
    if (HAND_EDITED_DIRECTORIES.includes(first) && relativePath.includes(path11.sep) && lstatIfExists(outFile) !== null) {
      throw refusedError(`Refusing to overwrite ${path11.relative(project.root, outFile)}: files in ${HAND_EDITED_DIRECTORIES.map((dir) => `${dir}/`).join(", ")} may hold hand-written work. Delete it first to regenerate it, or use a path such as dist/ instead`);
    }
  }
}
function realPathThroughAncestors(target) {
  const { ancestor, missing } = nearestExistingAncestor(target, fs7.existsSync);
  return path11.join(fs7.realpathSync.native(ancestor), ...missing);
}
function resolveOutputPath(project, out, defaultRelativePath, enforceRoot) {
  const rawOut = out ?? defaultRelativePath;
  if (String(rawOut).trim() === "") {
    throw usageError("--out needs a file path");
  }
  const outFile = path11.resolve(project.root, rawOut);
  const shouldEnforceRoot = enforceRoot ?? !path11.isAbsolute(String(rawOut));
  let stats;
  try {
    assertNotProjectSource(project, outFile);
    stats = lstatIfExists(outFile);
  } catch (error) {
    throw withDefaultExitCode(error, EXIT_CODES.refused);
  }
  const isDist = outFile === path11.join(project.root, "dist");
  if (stats?.isDirectory() || /[\\/]$/.test(String(rawOut)) || isDist && !stats) {
    throw usageError(`--out ${rawOut} is a directory: give a file path`);
  }
  if (isDist) {
    throw usageError(`--out ${rawOut} is reserved for the build folder: give a file path such as dist/book.md`);
  }
  return {
    outFile,
    enforceRoot: shouldEnforceRoot,
    writeOptions: shouldEnforceRoot ? { root: project.root } : {}
  };
}
function scanId(value) {
  return typeof value === "number" || typeof value === "boolean" ? String(value) : value ?? "";
}
function asIdArray(value) {
  return asArray(value).map((item) => typeof item === "number" || typeof item === "boolean" ? String(item) : item);
}
function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [value];
}
function listOption(options, ...names) {
  const list = [];
  for (const name of names) {
    for (const value of normalizeList(options[name], [])) {
      if (!list.includes(value)) {
        list.push(value);
      }
    }
  }
  return list;
}
function normalizeList(value, fallback) {
  const values = value === undefined || value === true ? [] : Array.isArray(value) ? value : [value];
  const list = [];
  for (const valueItem of values) {
    for (const part of String(valueItem).split(",")) {
      const trimmed = part.trim();
      if (trimmed) {
        list.push(trimmed);
      }
    }
  }
  return list.length > 0 ? list : fallback;
}
var BUILD_EXTENSIONS = {
  markdown: "md",
  epub: "epub",
  docx: "docx",
  shunn: "shunn.md",
  html: "html",
  print: "print.html",
  narration: "narration.md",
  metadata: "metadata.md",
  fountain: "fountain",
  twee: "twee",
  ink: "ink"
};
function normalizeBuildFormat(value) {
  const format = String(value).trim().toLowerCase();
  if (format === "markdown" || format === "md") {
    return "markdown";
  }
  if (Object.prototype.hasOwnProperty.call(BUILD_EXTENSIONS, format)) {
    return format;
  }
  throw usageError(`Unsupported build format: ${value === "" ? "(empty)" : value}. Supported formats: ${Object.keys(BUILD_EXTENSIONS).join(", ")}`);
}
function storyIdIsFallback(project) {
  return Boolean(project.story.unreadable) || kebabCase(String(project.story.data.title ?? ""), { transliterate: false }) === "";
}
var TEXT_FIELDS = {
  characters: ["pronunciation", "name", "died-in", "revived-in", "arc", "lie", "truth", "ghost-wound"],
  locations: ["pronunciation", "name", "type", "region", "controlled-by", "status"],
  systems: ["pronunciation", "name", "type", "prevalence"],
  factions: ["pronunciation", "name"],
  artifacts: ["pronunciation", "name", "owner", "location"],
  arcs: ["name"],
  chapters: ["title", "pov", "mode", "date", "time", "episode-question", "time-skip", "strand"],
  scenes: ["title", "chapter", "pov", "location", "date", "time", "dilemma", "flashback-to"],
  questions: ["title", "introduced", "resolved"],
  promises: ["title", "planted", "payoff"],
  clues: ["title", "planted", "payoff"],
  glossaryTerms: ["pronunciation", "term"],
  research: ["title"],
  matter: ["title", "rights-holder", "credit"]
};
var STORY_TEXT_FIELDS = ["title", "series", "series-title", "genre", "sub-genre", "setting-era", "pov", "premise", "counter-premise", "author", "season-goal", "language", "publisher", "publication-date", "description", "copyright", "cover-alt", "ai-disclosure", "draft-mode", "cover", "deadline"];
function validateTextFields(project, errors) {
  const check = (label, data, fields) => {
    for (const field of fields) {
      const value = data?.[field];
      if (typeof value === "number" || typeof value === "boolean") {
        errors.push(err("field-not-text", `${label} frontmatter field ${field} must be text: quote it as ${field}: "${value}"`, label));
      } else if (Array.isArray(value) && !errors.some((error) => error.file === label && error.message.includes(` ${field} `))) {
        errors.push(err("field-not-text", `${label} frontmatter field ${field} must be text, not a list`, label));
      }
    }
  };
  if (!project.story.unreadable) {
    check("story.md", project.story.data, STORY_TEXT_FIELDS);
  }
  for (const [collection, fields] of Object.entries(TEXT_FIELDS)) {
    for (const entity of project[collection] ?? []) {
      check(relative2(project, entity.file), entity.frontmatter, fields);
    }
  }
}
function validateStoryFrontmatter(project, errors) {
  if (project.story.unreadable) {
    return;
  }
  const data = project.story.data;
  requireFields(data, ["title", "schema-version", "genre", "status", "themes", "pov", "tense"], "story.md", errors);
  requireScalar(data, "title", "story.md", errors);
  requireScalar(data, "genre", "story.md", errors);
  requireScalar(data, "status", "story.md", errors);
  validateStringArray(data, "themes", "story.md", errors);
  validateStringArray(data, "contact", "story.md", errors);
  validateStringArray(data, "authors", "story.md", errors);
  validateStringArray(data, "keywords", "story.md", errors);
  requireScalar(data, "pov", "story.md", errors);
  requireScalar(data, "tense", "story.md", errors);
  validateEnum(data, "status", STORY_STATUSES, "story.md", errors);
  validateEnum(data, "tense", STORY_TENSES, "story.md", errors);
  requireScalar(data, "series", "story.md", errors);
  if (data.series !== undefined && !isKebabId2(data.series)) {
    errors.push(err("id-not-kebab", "story.md series must be a kebab-case id", "story.md"));
  }
  if (data["book-number"] !== undefined && !isBookNumber(data["book-number"])) {
    errors.push(err("invalid-book-number", "story.md book-number must be a number 0 or more, such as 2, 0 for a prequel, or 1.5 for a novella", "story.md"));
  }
  validateStringArray(data, "follows", "story.md", errors);
  validateStringArray(data, "precedes", "story.md", errors);
  if (data["season-goal"] !== undefined) {
    requireScalar(data, "season-goal", "story.md", errors);
  }
  if (data["target-words"] !== undefined) {
    requireInteger(data, "target-words", "story.md", errors, 1);
  }
  validateEnum(data, "form", STORY_FORMS, "story.md", errors);
  if (data["draft-mode"] !== undefined) {
    requireScalar(data, "draft-mode", "story.md", errors);
    validateEnum(data, "draft-mode", DRAFT_MODES, "story.md", errors);
  }
  validateCover(project, errors);
  validatePasses(data, "story.md", errors);
  validateCliConfig(data, errors);
  validateDeadline(data, errors);
  if (data.ifid !== undefined && !isIfid(data.ifid)) {
    errors.push(err("invalid-ifid", "story.md ifid must be a version 4 UUID, such as 3F2C9A61-7B1D-4E8A-9C3B-2A6D5E4F1B07", "story.md"));
  }
  if (newerSchemaVersion(data["schema-version"]) !== null) {
    errors.push(err("schema-too-new", newerSchemaMessage(newerSchemaVersion(data["schema-version"])), "story.md"));
  } else if (data["schema-version"] !== undefined && data["schema-version"] !== STORY_SCHEMA_VERSION) {
    errors.push(err("schema-version-mismatch", `story.md schema-version must be ${STORY_SCHEMA_VERSION}`, "story.md"));
  }
}
function validatePortablePaths(project, warnings) {
  if (project.story.unreadable) {
    return;
  }
  const data = project.story.data;
  for (const field of ["follows", "precedes", "cover"]) {
    const values = Array.isArray(data[field]) ? data[field] : [data[field]];
    for (const value of values.filter((item) => typeof item === "string" && item.includes("\\"))) {
      warnings.push(warn("backslash-path", `story.md ${field} ${value} uses a backslash; write ${portableSlashes(value)} so the path works on every system`, "story.md"));
    }
  }
}
function portableSlashes(value) {
  return String(value).replace(/\\/g, "/");
}
function validatePronunciations(project, errors) {
  const entities = [project.characters, project.locations, project.systems, project.factions, project.artifacts, project.glossaryTerms].flat();
  for (const entity of entities) {
    if (entity.pronunciation !== undefined && typeof entity.pronunciation !== "string") {
      errors.push(err("field-not-text", `${relative2(project, entity.file)} frontmatter field pronunciation must be text`, relative2(project, entity.file)));
    }
  }
}
function validateFormRange(project, warnings) {
  const data = project.story.data;
  const targetWarning = formRangeWarning(data.form, data["target-words"], "story.md target-words");
  if (targetWarning !== "") {
    warnings.push(warn("form-length-range", targetWarning, "story.md"));
  }
  if (data.status === "complete") {
    const words = project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
    const wordsWarning = formRangeWarning(data.form, words, "Manuscript length");
    if (wordsWarning !== "") {
      warnings.push(warn("form-length-range", wordsWarning));
    }
  }
}
function validateIndexFrontmatter(project, errors) {
  for (const [relativePath, expectedType] of INDEX_SCHEMAS) {
    const label = relativePath;
    if (!fs7.existsSync(path11.join(project.root, relativePath))) {
      continue;
    }
    const data = readRegistryValidationData(path11.join(project.root, relativePath), project.root, label, errors);
    if (!data) {
      continue;
    }
    requireFields(data, ["type", "story"], label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "story", label, errors);
    if (data.type !== undefined && data.type !== expectedType) {
      errors.push(err("wrong-type", `${label} type must be ${expectedType}`, label));
    }
    if (data.story !== undefined && data.story !== project.storyId && !storyIdIsFallback(project)) {
      errors.push(storyIdMismatch(label, project));
    }
    if (relativePath === path11.join("plot", "_index.md")) {
      requireFields(data, ["structure"], label, errors);
      requireScalar(data, "structure", label, errors);
    }
  }
}
var PROGRESSION_RULES = {
  character: {
    lists: new Set(["aliases", "relationships", "locations", "tags", "voice-words", "voice-avoid"]),
    enums: new Map([["role", CHARACTER_ROLES], ["status", CHARACTER_STATUSES]])
  },
  location: {
    lists: new Set(["notable-characters", "tags", "routes"]),
    enums: new Map([["setting", SCENE_SETTINGS]])
  },
  faction: {
    lists: new Set(["members", "locations", "tags"]),
    enums: new Map([["type", FACTION_TYPES], ["status", FACTION_STATUSES]])
  }
};
function validateCharacters(project, errors, warnings) {
  const chronology = chapterChronology(project);
  for (const character of project.characters) {
    const label = relative2(project, character.file);
    const data = readValidationData(character.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(character.id, label, errors);
    requireFields(data, ["name", "role", "status"], label, errors);
    validateEnum(data, "arc-type", CHARACTER_ARC_TYPES, label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "role", label, errors);
    requireScalar(data, "status", label, errors);
    validateEnum(data, "role", CHARACTER_ROLES, label, errors);
    validateEnum(data, "status", CHARACTER_STATUSES, label, errors);
    if (data["died-in"] !== undefined) {
      requireScalar(data, "died-in", label, errors);
    }
    if (data["revived-in"] !== undefined) {
      requireScalar(data, "revived-in", label, errors);
    }
    if (data.arc !== undefined) {
      requireScalar(data, "arc", label, errors);
    }
    validateStringArray(data, "aliases", label, errors);
    validateStringArray(data, "locations", label, errors);
    validateStringArray(data, "tags", label, errors);
    validateStringArray(data, "voice-words", label, errors);
    validateStringArray(data, "voice-avoid", label, errors);
    validateRelationships(data, label, errors);
    warnNearMissKeys(data, ["died-in", "revived-in"], label, warnings);
    validateProgressions(data, label, PROGRESSION_RULES.character, chronology, errors);
    for (const [index, item] of asArray(data.progressions).entries()) {
      if (item && typeof item === "object" && item.field === "status" && item.value === "deceased" && idText(item.from) !== character.diedIn) {
        warnings.push(warn("deceased-without-died-in", `${label} progressions[${index}] makes ${character.id} deceased from ${idText(item.from) || "?"}; set died-in: ${idText(item.from) || "<chapter>"} too so story continuity treats appearances after the death as errors`, label));
      }
    }
  }
}
function validateLocations(project, errors, warnings) {
  const chronology = chapterChronology(project);
  for (const location of project.locations) {
    const label = relative2(project, location.file);
    const data = readValidationData(location.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    requireScalar(data, "population", label, errors);
    if (typeof data.population === "boolean" || typeof data.population === "number" && !Number.isInteger(data.population)) {
      errors.push(err("field-not-integer", `${label} frontmatter field population must be a whole number or text, such as 300 or "about 300"`, label));
    }
    validateEntityId(location.id, label, errors);
    requireFields(data, ["name", "type"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    validateStringArray(data, "notable-characters", label, errors);
    validateStringArray(data, "tags", label, errors);
    validateObjectArray(data, "routes", label, errors);
    validateEnum(data, "setting", SCENE_SETTINGS, label, errors);
    const destinations = new Set;
    for (const route of Array.isArray(data.routes) ? data.routes : []) {
      if (!route || typeof route !== "object" || Array.isArray(route)) {
        continue;
      }
      const to = idText(route.to);
      if (to === "") {
        errors.push(err("missing-field", `${label} route is missing to`, label));
      } else if (destinations.has(to)) {
        warnings.push(warn("duplicate-route", `${label} lists more than one route to ${to}; the travel check and story diagram use only the fastest`, label));
      } else {
        destinations.add(to);
      }
      if (typeof route.hours !== "number" || !Number.isFinite(route.hours) || route.hours <= 0) {
        errors.push(err("invalid-route-hours", `${label} route to ${route.to ?? "?"} hours must be a positive number`, label));
      }
      requireScalar(route, "mode", `${label} route to ${route.to ?? "?"}`, errors, label);
    }
    validateProgressions(data, label, PROGRESSION_RULES.location, chronology, errors);
  }
}
function validateSystems(project, errors) {
  for (const system of project.systems) {
    const label = relative2(project, system.file);
    const data = readValidationData(system.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(system.id, label, errors);
    requireFields(data, ["name", "type"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    if (data.prevalence !== undefined) {
      requireScalar(data, "prevalence", label, errors);
    }
  }
}
function validateFactions(project, errors) {
  const chronology = chapterChronology(project);
  for (const faction of project.factions) {
    const label = relative2(project, faction.file);
    const data = readValidationData(faction.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(faction.id, label, errors);
    requireFields(data, ["name", "type", "status"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "status", label, errors);
    validateEnum(data, "type", FACTION_TYPES, label, errors);
    validateEnum(data, "status", FACTION_STATUSES, label, errors);
    validateStringArray(data, "members", label, errors);
    validateStringArray(data, "locations", label, errors);
    validateStringArray(data, "tags", label, errors);
    validateProgressions(data, label, PROGRESSION_RULES.faction, chronology, errors);
  }
}
function validateArtifacts(project, errors) {
  for (const artifact of project.artifacts) {
    const label = relative2(project, artifact.file);
    const data = readValidationData(artifact.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(artifact.id, label, errors);
    requireFields(data, ["name", "type", "status"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "status", label, errors);
    requireScalar(data, "owner", label, errors);
    requireScalar(data, "location", label, errors);
    validateEnum(data, "type", ARTIFACT_TYPES, label, errors);
    validateEnum(data, "status", ARTIFACT_STATUSES, label, errors);
    validateStringArray(data, "tags", label, errors);
  }
}
function validateArcs(project, errors) {
  for (const arc of project.arcs) {
    const label = relative2(project, arc.file);
    const data = readValidationData(arc.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateStringArray(data, "mice-threads", label, errors);
    validateEntityId(arc.id, label, errors);
    requireFields(data, ["name", "type", "status"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "status", label, errors);
    validateEnum(data, "type", ARC_TYPES, label, errors);
    validateEnum(data, "status", ARC_STATUSES, label, errors);
    validateStringArray(data, "characters", label, errors);
    validateStringArray(data, "themes", label, errors);
    validateStringArray(data, "acts", label, errors);
  }
}
function validateChapters(project, errors, warnings) {
  const seenNumbers = new Map;
  for (const chapter of project.chapters) {
    const label = relative2(project, chapter.file);
    const data = readValidationData(chapter.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    const filenameNumber = chapterNumberFromFile(chapter.file);
    validateEntityId(chapter.id, label, errors);
    requireFields(data, ["title", "number", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "status", label, errors);
    requireInteger(data, "number", label, errors);
    validateEnum(data, "status", CHAPTER_STATUSES, label, errors);
    validateStringArray(data, "locations", label, errors);
    validateStringArray(data, "characters", label, errors);
    validateStringArray(data, "mentions", label, errors);
    validateStringArray(data, "arcs-advanced", label, errors);
    if (data.pov !== undefined) {
      requireScalar(data, "pov", label, errors);
    }
    if (data["word-count"] !== undefined) {
      requireInteger(data, "word-count", label, errors, 0);
    }
    if (data["target-words"] !== undefined) {
      requireInteger(data, "target-words", label, errors, 1);
    }
    if (data.date !== undefined) {
      requireScalar(data, "date", label, errors);
    }
    if (data.time !== undefined) {
      requireScalar(data, "time", label, errors);
    }
    if (data.mode !== undefined) {
      requireScalar(data, "mode", label, errors);
      if (data.mode !== "" && data.mode !== null) {
        validateEnum(data, "mode", DRAFT_MODES, label, errors);
      }
    }
    if (data["episode-question"] !== undefined) {
      requireScalar(data, "episode-question", label, errors);
    }
    if (data["time-skip"] !== undefined) {
      requireScalar(data, "time-skip", label, errors);
    }
    validateEnum(data, "hook", CHAPTER_HOOKS, label, errors);
    errors.push(...chapterChoices(chapter, label).problems);
    if (data.numbered !== undefined && typeof data.numbered !== "boolean") {
      errors.push(err("field-not-boolean", `${label} numbered must be true or false`, label));
    } else if (data.numbered === false && (typeof data.title !== "string" || data.title.trim() === "")) {
      errors.push(err("unnumbered-without-title", `${label} is unnumbered (numbered: false), so it needs a title to print as its heading`, label));
    }
    if (chapter.wordCount === 0 && (project.story.data.status === "complete" || WRITTEN_CHAPTER_STATUSES.has(chapter.status))) {
      warnings.push(warn("empty-chapter", `${label} has no prose yet, so export and build print it as a heading-only page`, label));
    }
    if (filenameNumber === 0) {
      errors.push(err("invalid-filename", `${label} filename must match chapter-{NN}.md`, label));
    } else if (Number.isInteger(data.number) && data.number !== filenameNumber) {
      errors.push(err("filename-number-mismatch", `${label} number must match filename chapter number ${filenameNumber}`, label));
    }
    if (Number.isInteger(data.number)) {
      if (data.number <= 0) {
        errors.push(err("field-below-minimum", `${label} number must be greater than 0`, label));
      }
      const existing = seenNumbers.get(data.number);
      if (existing) {
        errors.push(err("duplicate-chapter-number", `${label} duplicates chapter number ${data.number} from ${existing}`, label));
      } else {
        seenNumbers.set(data.number, label);
      }
    }
  }
}
function validateScenes(project, errors) {
  const seenKeys = new Map;
  for (const scene of project.scenes) {
    const label = relative2(project, scene.file);
    const data = readValidationData(scene.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(scene.id, label, errors);
    requireFields(data, ["title", "chapter", "scene", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "chapter", label, errors);
    requireScalar(data, "status", label, errors);
    requireInteger(data, "scene", label, errors);
    validateEnum(data, "status", SCENE_STATUSES, label, errors);
    validateStringArray(data, "characters", label, errors);
    validateStringArray(data, "mentions", label, errors);
    validateStringArray(data, "arcs-advanced", label, errors);
    validateObjectArray(data, "state-changes", label, errors);
    if (data.pov !== undefined) {
      requireScalar(data, "pov", label, errors);
    }
    if (data.location !== undefined) {
      requireScalar(data, "location", label, errors);
    }
    if (data.date !== undefined) {
      requireScalar(data, "date", label, errors);
    }
    if (data.time !== undefined) {
      requireScalar(data, "time", label, errors);
    }
    if (data.dilemma !== undefined) {
      requireScalar(data, "dilemma", label, errors);
    }
    if (data["travel-hours"] !== undefined && typeof data["travel-hours"] !== "number") {
      errors.push(err("field-not-number", `${label} frontmatter field travel-hours must be a number`, label));
    }
    if (data.sequel !== undefined && typeof data.sequel !== "boolean") {
      errors.push(err("field-not-boolean", `${label} frontmatter field sequel must be a boolean`, label));
    }
    validateEnum(data, "outcome", SCENE_OUTCOMES, label, errors);
    validateEnum(data, "setting", SCENE_SETTINGS, label, errors);
    if (data["flashback-to"] !== undefined) {
      requireScalar(data, "flashback-to", label, errors);
    }
    if (Number.isInteger(data.scene) && data.scene <= 0) {
      errors.push(err("field-below-minimum", `${label} scene must be greater than 0`, label));
    }
    const filenameMatch = SCENE_FILENAME_PATTERN.exec(path11.basename(scene.file));
    if (!filenameMatch) {
      errors.push(err("invalid-filename", `${label} filename must match {chapter}-scene-{NN}.md`, label));
    } else {
      const [, filenameChapter, filenameSceneText] = filenameMatch;
      const filenameScene = Number.parseInt(filenameSceneText, 10);
      if (typeof data.chapter === "string" && data.chapter !== "" && data.chapter !== filenameChapter) {
        errors.push(err("filename-number-mismatch", `${label} chapter must match filename chapter ${filenameChapter}`, label));
      }
      if (Number.isInteger(data.scene) && data.scene !== filenameScene) {
        errors.push(err("filename-number-mismatch", `${label} scene must match filename scene number ${filenameScene}`, label));
      }
    }
    if (typeof data.chapter === "string" && data.chapter !== "" && Number.isInteger(data.scene)) {
      const key = `${data.chapter}::${data.scene}`;
      const existing = seenKeys.get(key);
      if (existing) {
        errors.push(err("duplicate-scene-number", `${label} duplicates scene ${data.scene} of ${data.chapter} from ${existing}`, label));
      } else {
        seenKeys.set(key, label);
      }
    }
  }
}
var STATE_ENTRY_KEYS = {
  "character-state": ["character", "location", "physical", "emotional", "knowledge"],
  "object-state": ["artifact", "owner", "location", "status", "since"],
  "knowledge-state": ["character", "knows", "learned-in", "fact"]
};
function validateContinuityState(project, errors, warnings) {
  const label = path11.join("continuity", "state.md");
  if (!project.continuity) {
    return;
  }
  const data = project.continuity.data;
  requireFields(data, ["type", "story", "current-chapter"], label, errors);
  requireScalar(data, "type", label, errors);
  requireScalar(data, "story", label, errors);
  requireInteger(data, "current-chapter", label, errors, 0);
  validateObjectArray(data, "character-state", label, errors);
  validateObjectArray(data, "object-state", label, errors);
  validateObjectArray(data, "knowledge-state", label, errors);
  for (const [list, keys] of Object.entries(STATE_ENTRY_KEYS)) {
    for (const [index, entry] of (Array.isArray(data[list]) ? data[list] : []).entries()) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      warnNearMissKeys(entry, keys, `${label} ${list}[${index}]`, warnings, label);
      for (const [key, value] of Object.entries(entry)) {
        if (keys.includes(key) && Array.isArray(value)) {
          errors.push(err("field-not-scalar", `${label} ${list}[${index}] ${key} must be a single value, not a list`, label));
        }
      }
      if (list === "object-state" && entry.status !== undefined && !ARTIFACT_STATUSES.has(entry.status)) {
        errors.push(err("unsupported-value", `${label} ${list}[${index}] status must be one of ${[...ARTIFACT_STATUSES].join(", ")}, got ${entry.status}`, label));
      }
    }
  }
  if (data.type !== undefined && data.type !== "continuity-state") {
    errors.push(err("wrong-type", `${label} type must be continuity-state`, label));
  }
  if (data.story !== undefined && data.story !== project.storyId && !storyIdIsFallback(project)) {
    errors.push(storyIdMismatch(label, project));
  }
}
function validateQuestions(project, errors) {
  for (const question of project.questions) {
    const label = relative2(project, question.file);
    const data = readValidationData(question.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(question.id, label, errors);
    requireFields(data, ["title", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "status", label, errors);
    requireScalar(data, "introduced", label, errors);
    requireScalar(data, "resolved", label, errors);
    validateEnum(data, "status", QUESTION_STATUSES, label, errors);
    validateStringArray(data, "characters", label, errors);
  }
}
function validatePromises(project, errors) {
  for (const promise of project.promises) {
    const label = relative2(project, promise.file);
    const data = readValidationData(promise.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(promise.id, label, errors);
    requireFields(data, ["title", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "status", label, errors);
    requireScalar(data, "planted", label, errors);
    requireScalar(data, "payoff", label, errors);
    validateEnum(data, "status", PROMISE_STATUSES, label, errors);
    validateStringArray(data, "arcs", label, errors);
    validateStringArray(data, "characters", label, errors);
  }
}
function validateClues(project, errors) {
  for (const clue of project.clues) {
    const label = relative2(project, clue.file);
    const data = readValidationData(clue.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(clue.id, label, errors);
    requireFields(data, ["title", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "status", label, errors);
    requireScalar(data, "planted", label, errors);
    requireScalar(data, "payoff", label, errors);
    validateEnum(data, "status", CLUE_STATUSES, label, errors);
    validateStringArray(data, "arcs", label, errors);
    validateStringArray(data, "characters", label, errors);
    for (const field of ["significance-delayed", "red-herring"]) {
      if (data[field] !== undefined && typeof data[field] !== "boolean") {
        errors.push(err("field-not-boolean", `${label} frontmatter field ${field} must be a boolean`, label));
      }
    }
  }
}
function validateExemptions(project, errors, warnings) {
  const exemptionsPath = path11.join(project.root, EXEMPTIONS_FILE);
  if (!fs7.existsSync(exemptionsPath)) {
    return;
  }
  const label = EXEMPTIONS_FILE;
  const data = readValidationData(exemptionsPath, project.root, label, errors);
  if (!data) {
    return;
  }
  if (data.type !== "exemption-log") {
    errors.push(err("wrong-type", `${label} type must be exemption-log`, label));
  }
  const entries = data.exemptions;
  if (entries === undefined) {
    errors.push(err("missing-field", `${label} is missing frontmatter field exemptions`, label));
    return;
  }
  if (!Array.isArray(entries)) {
    errors.push(err("field-not-list", `${label} frontmatter field exemptions must be a list`, label));
    return;
  }
  const chapters = new Set(project.chapters.map((chapter) => chapter.id));
  for (const [index, entry] of entries.entries()) {
    const entryLabel = `${label} exemptions[${index}]`;
    errors.push(...exemptionProblems(entry, entryLabel));
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const file = typeof entry.file === "string" ? exemptionFile(entry.file) : null;
    if (file !== null && !lstatIfExists(path11.join(project.root, file))?.isFile()) {
      warnings.push(warn("stale-exemption", `${entryLabel} file ${entry.file} is not a file in the project, so the entry matches nothing`, label));
    }
    if (isChapterId(entry.chapter) && !chapters.has(entry.chapter)) {
      warnings.push(warn("stale-exemption", `${entryLabel} chapter ${entry.chapter} is not a chapter in chapters/, so the entry matches nothing`, label));
    }
  }
}
function validateGlossaryTerms(project, errors) {
  for (const term of project.glossaryTerms) {
    const label = relative2(project, term.file);
    const data = readValidationData(term.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(term.id, label, errors);
    requireFields(data, ["term", "category"], label, errors);
    requireScalar(data, "term", label, errors);
    requireScalar(data, "category", label, errors);
    validateEnum(data, "category", TERM_CATEGORIES, label, errors);
    validateStringArray(data, "aliases", label, errors);
  }
}
function validateStyleSheet(project, errors, warnings) {
  if (project.styleSheet === null) {
    return;
  }
  const data = project.styleSheet.data;
  const label = STYLE_SHEET_FILE;
  if (data.type !== "style-sheet") {
    errors.push(err("wrong-type", `${label} type must be style-sheet`, label));
  }
  requireScalar(data, "dialect", label, errors);
  validateEnum(data, "dialect", STYLE_DIALECTS, label, errors);
  validateObjectArray(data, "preferred", label, errors);
  asArray(data.preferred).forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }
    const entryLabel = `${label} preferred[${index}]`;
    for (const field of ["use", "avoid"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        errors.push(err("missing-field", `${entryLabel} requires a non-empty ${field}`, label));
      }
    }
    if (typeof entry.use === "string" && typeof entry.avoid === "string" && entry.use.trim().toLowerCase() === entry.avoid.trim().toLowerCase()) {
      errors.push(err("style-use-equals-avoid", `${entryLabel} use and avoid must differ`, label));
    }
  });
  validateStringArray(data, "watch-words", label, errors);
  validateStringArray(data, "allow-words", label, errors);
  validateStringArray(data, "samples", label, errors);
  for (const entry of asArray(data.samples)) {
    if (typeof entry !== "string" || entry.trim() === "") {
      continue;
    }
    const sample = entry.trim();
    if (path11.isAbsolute(sample) || /^[A-Za-z]:/.test(sample)) {
      errors.push(err("field-invalid-items", `${label} samples entry ${sample} must be a path relative to the project folder, such as ../book-one`, label));
    } else {
      const problem = sampleProblem(project, sample);
      if (problem !== null) {
        warnings.push(problem);
      }
    }
  }
}
function validateDeadline(data, errors) {
  if (data.deadline !== undefined) {
    const deadlineError = typeof data.deadline === "string" && data.deadline.trim() !== "" ? storyDateError(data.deadline) : "must be a YYYY-MM-DD date";
    if (deadlineError !== "") {
      errors.push(err("invalid-date", `story.md deadline ${deadlineError}`, "story.md"));
    }
  }
}
function validateProgressLog(project, errors) {
  if (project.progressLog === null) {
    return;
  }
  const data = project.progressLog.data;
  if (data.type !== "progress-log") {
    errors.push(err("wrong-type", `${PROGRESS_FILE} type must be progress-log`, PROGRESS_FILE));
  }
  validateObjectArray(data, "sessions", PROGRESS_FILE, errors);
  const seen = new Set;
  asArray(data.sessions).forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }
    const label = `${PROGRESS_FILE} sessions[${index}]`;
    const dateError = storyDateError(entry.date);
    if (entry.date === undefined || dateError !== "") {
      errors.push(err("invalid-date", `${label} ${dateError || "requires a date"}`, PROGRESS_FILE));
    } else if (seen.has(String(entry.date).trim())) {
      errors.push(err("duplicate-session-date", `${label} repeats date ${String(entry.date).trim()}`, PROGRESS_FILE));
    } else {
      seen.add(String(entry.date).trim());
    }
    if (!Number.isInteger(entry.words) || entry.words < 0) {
      errors.push(err("field-not-integer", `${label} words must be a non-negative integer`, PROGRESS_FILE));
    }
  });
}
function validateOptionalRegistry(project, directory, expectedType, errors) {
  const indexPath = path11.join(project.root, directory, "_index.md");
  if (fs7.existsSync(indexPath)) {
    const label = path11.join(directory, "_index.md");
    const data = readRegistryValidationData(indexPath, project.root, label, errors);
    if (data && data.type !== expectedType) {
      errors.push(err("wrong-type", `${label} type must be ${expectedType}`, label));
    }
  }
}
function validateResearch(project, errors, warnings) {
  validateOptionalRegistry(project, RESEARCH_DIR, "research-registry", errors);
  const chapterStatus = new Map(project.chapters.map((chapter) => [chapter.id, chapter.status]));
  for (const note of project.research) {
    const label = relative2(project, note.file);
    const data = readValidationData(note.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(note.id, label, errors);
    requireFields(data, ["title", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    validateEnum(data, "status", RESEARCH_STATUSES, label, errors);
    validateStringArray(data, "sources", label, errors);
    validateStringArray(data, "used-in", label, errors);
    validateEnum(data, "accuracy", RESEARCH_ACCURACY, label, errors);
    validateEnum(data, "confidence", RESEARCH_CONFIDENCE, label, errors);
    validateEnum(data, "method", RESEARCH_METHODS, label, errors);
    validateStringArray(data, "risk", label, errors);
    validateStringArray(data, "reviewed-by", label, errors);
    for (const risk of Array.isArray(data.risk) ? data.risk : []) {
      if (typeof risk === "string" && !RESEARCH_RISKS.has(risk)) {
        errors.push(err("unsupported-value", `${label} risk has unsupported value ${risk}`, label));
      }
    }
    const invented = note.accuracy === "invented";
    if (!invented && note.status === "verified" && note.sources.length === 0) {
      warnings.push(warn("research-no-sources", `${label} is verified but lists no sources`, label));
    }
    const settled = note.usedIn.filter((chapterId) => SETTLED_CHAPTER_STATUSES.has(chapterStatus.get(chapterId)));
    if (!invented && (note.status === "open" || note.status === "disputed")) {
      for (const chapterId of settled) {
        warnings.push(warn("research-unsettled", `${label} is ${note.status} but ${chapterId} relies on it and is ${chapterStatus.get(chapterId)}`, label));
      }
    }
    if (note.risk.length > 0 && note.reviewedBy.length === 0 && settled.length > 0) {
      warnings.push(warn("research-unreviewed", `${label} carries ${note.risk.join(", ")} risk but has no reviewed-by, and ${settled.join(", ")} relies on it`, label));
    }
  }
}
function validateMatter(project, errors, warnings) {
  validateOptionalRegistry(project, MATTER_DIR, "matter-registry", errors);
  for (const matter of project.matter) {
    const label = relative2(project, matter.file);
    if (matter.empty) {
      warnings.push(warn("empty-matter", `${label} has no text and is left out of export and build`, label));
    }
    const data = readValidationData(matter.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(matter.id, label, errors);
    requireFields(data, ["title", "placement"], label, errors);
    requireScalar(data, "title", label, errors);
    validateEnum(data, "placement", MATTER_PLACEMENTS, label, errors);
    if (data.order !== undefined) {
      requireInteger(data, "order", label, errors, 0);
    }
    if (data.heading !== undefined && typeof data.heading !== "boolean") {
      errors.push(err("field-not-boolean", `${label} heading must be true or false`, label));
    }
    validateEnum(data, "permission", MATTER_PERMISSIONS, label, errors);
    requireScalar(data, "rights-holder", label, errors);
    requireScalar(data, "credit", label, errors);
    if (data.permission === "pending" && project.story.data.status === "complete") {
      warnings.push(warn("permission-pending", `${label} permission is still pending and the story is complete`, label));
    }
    if (data.permission === "granted" && (typeof data["rights-holder"] !== "string" || data["rights-holder"].trim() === "")) {
      warnings.push(warn("permission-no-rights-holder", `${label} permission is granted but no rights-holder is recorded`, label));
    }
  }
}
function validateCover(project, errors) {
  const cover = project.story.data.cover;
  if (cover === undefined) {
    return;
  }
  if (typeof cover !== "string" || cover.trim() === "") {
    errors.push(err("invalid-cover", "story.md cover must be a path to an image file", "story.md"));
    return;
  }
  try {
    coverImage(project);
  } catch (error) {
    errors.push(err("invalid-cover", error.message, "story.md"));
  }
}
function coverIsReady(project) {
  if (project.story.data.cover === undefined) {
    return false;
  }
  try {
    coverImage(project);
    return true;
  } catch {
    return false;
  }
}
function coverImage(project) {
  const cover = String(project.story.data.cover).trim();
  const mediaType = COVER_MEDIA_TYPES[path11.extname(cover).toLowerCase()];
  if (mediaType === undefined) {
    throw projectError(`story.md cover ${cover} must be a ${Object.keys(COVER_MEDIA_TYPES).join(", ")} image`);
  }
  const filePath = path11.resolve(project.root, cover);
  if (!isPathInside(project.root, filePath)) {
    throw projectError(`story.md cover ${cover} must be inside the project`);
  }
  const stats = lstatIfExists(filePath);
  if (!stats) {
    throw projectError(`story.md cover ${cover} does not exist`);
  }
  assertSafeProjectPath(filePath, project.root);
  if (!stats.isFile()) {
    throw projectError(`story.md cover ${cover} is not a file`);
  }
  assertFileSizeWithinLimit(filePath, MAX_COVER_BYTES);
  return { filePath, mediaType, extension: mediaType === "image/jpeg" ? "jpg" : path11.extname(cover).slice(1).toLowerCase() };
}
function validateEntityId(id, label, errors) {
  if (id !== kebabCase(id)) {
    errors.push(err("id-not-kebab", `${label} filename id must be kebab-case`, label));
  }
}
function requireScalar(data, field, label, errors, file = label) {
  if (data[field] !== undefined && (Array.isArray(data[field]) || typeof data[field] === "object")) {
    errors.push(err("field-not-scalar", `${label} frontmatter field ${field} must be a scalar`, file));
  }
}
function requireInteger(data, field, label, errors, minimum) {
  if (data[field] === undefined) {
    return;
  }
  if (!Number.isInteger(data[field])) {
    errors.push(err("field-not-integer", `${label} frontmatter field ${field} must be an integer`, label));
  } else if (minimum !== undefined && data[field] < minimum) {
    errors.push(err("field-below-minimum", `${label} frontmatter field ${field} must be at least ${minimum}`, label));
  }
}
function validateStringArray(data, field, label, errors) {
  if (data[field] === undefined) {
    return;
  }
  if (!Array.isArray(data[field])) {
    errors.push(err("field-not-list", `${label} frontmatter field ${field} must be a list`, label));
    return;
  }
  for (const item of data[field]) {
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(err("field-invalid-items", `${label} frontmatter field ${field} must contain only non-empty strings`, label));
    }
  }
}
var PREFIX_KEYS = new Set(["since", "learned-in", "died-in"]);
function warnNearMissKeys(data, keys, label, warnings, file = label) {
  for (const key of Object.keys(data)) {
    if (keys.includes(key)) {
      continue;
    }
    const normalized = key.trim().toLowerCase().replace(/[\s_]+/g, "-");
    const intended = keys.find((known) => normalized === known || PREFIX_KEYS.has(known) && normalized.startsWith(`${known}-`) || normalized === known.replace(/-/g, ""));
    if (intended !== undefined && !Object.hasOwn(data, intended)) {
      warnings.push(warn("near-miss-key", `${label} has ${key}; did you mean ${intended}?`, file));
    }
  }
}
function validateObjectArray(data, field, label, errors) {
  if (data[field] === undefined) {
    return;
  }
  if (!Array.isArray(data[field])) {
    errors.push(err("field-not-list", `${label} frontmatter field ${field} must be a list`, label));
    return;
  }
  for (const item of data[field]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(err("field-invalid-items", `${label} frontmatter field ${field} must contain objects`, label));
    }
  }
}
function validateRelationships(data, label, errors) {
  if (data.relationships === undefined) {
    return;
  }
  if (!Array.isArray(data.relationships)) {
    errors.push(err("field-not-list", `${label} frontmatter field relationships must be a list`, label));
    return;
  }
  for (const relationship of data.relationships) {
    if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
      errors.push(err("field-invalid-items", `${label} frontmatter field relationships must contain objects`, label));
      continue;
    }
    if (typeof relationship.character !== "string" || relationship.character.trim() === "") {
      errors.push(err("missing-field", `${label} relationship is missing character`, label));
    } else if (relationship.character !== kebabCase(relationship.character)) {
      errors.push(err("id-not-kebab", `${label} relationship character ${relationship.character} must be kebab-case`, label));
    }
    if (typeof relationship.type !== "string" || relationship.type.trim() === "") {
      errors.push(err("missing-field", `${label} relationship to ${relationship.character ?? "unknown"} is missing type`, label));
    }
  }
}
function validateEnum(data, field, allowed, label, errors) {
  if (Array.isArray(data[field])) {
    const scalar = `${label} frontmatter field ${field} must be a scalar`;
    if (!hasMessage(errors, scalar)) {
      errors.push(err("field-not-scalar", `${label} frontmatter field ${field} must be a single value, not a list`, label));
    }
  } else if (data[field] !== undefined && !allowed.has(data[field])) {
    errors.push(err("unsupported-value", `${label} frontmatter field ${field} has unsupported value ${data[field]}`, label));
  }
}
function inverseRelationshipTypes(type) {
  if (RELATIONSHIP_INVERSES.has(type)) {
    return RELATIONSHIP_INVERSES.get(type);
  }
  return SYMMETRIC_RELATIONSHIPS.has(type) ? [type] : [];
}
function formatCheck(result) {
  const status = result.ok ? "ok" : "failed";
  return `${status} (${result.errors.length} errors, ${result.warnings.length} warnings)`;
}
function requireFields(data, fields, label, errors) {
  for (const field of fields) {
    if (data[field] === undefined || typeof data[field] === "string" && data[field].trim() === "") {
      errors.push(err("missing-field", `${label} is missing frontmatter field ${field}`, label));
    }
  }
}
var CHAPTER_FILENAME_PATTERN = /^chapter-(\d+)\.md$/;
var SCENE_FILENAME_PATTERN = /^(.+)-scene-(\d+)\.md$/;
function isPositiveIntegerValue(value) {
  const number = Number(value);
  return value !== "" && value !== null && typeof value !== "boolean" && Number.isInteger(number) && number > 0;
}
function chapterNumber(value, file) {
  return value !== undefined && isPositiveIntegerValue(value) ? Number(value) : chapterNumberFromFile(file);
}
function chapterNumberFromFile(file) {
  const match = CHAPTER_FILENAME_PATTERN.exec(path11.basename(file));
  return match ? Number.parseInt(match[1], 10) : 0;
}
function sceneNumberFromFile(file) {
  const match = SCENE_FILENAME_PATTERN.exec(path11.basename(file));
  return match ? Number.parseInt(match[2], 10) : 0;
}
function sceneChapterFromFile(file) {
  const match = SCENE_FILENAME_PATTERN.exec(path11.basename(file));
  return match ? match[1] : "";
}
function relative2(project, file) {
  return path11.relative(project.root, file);
}

// src/import.js
var ROMAN_NUMERAL = "(?!i\\s+\\S)(?=[ivxlc])c{0,3}(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})";
var UNIT_WORDS = "one|two|three|four|five|six|seven|eight|nine";
var TENS_WORDS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
var BELOW_HUNDRED = `(?:(?:${TENS_WORDS})(?:[-\\s](?:${UNIT_WORDS}))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|${UNIT_WORDS})`;
var WORD_NUMERAL = `(?:(?:${UNIT_WORDS})[-\\s]hundred(?:(?:[-\\s]and)?[-\\s]${BELOW_HUNDRED})?|${BELOW_HUNDRED})`;
var CHAPTER_NUMBER = `(?:\\d+(?:\\.\\d+)?|${WORD_NUMERAL}|${ROMAN_NUMERAL})(?=[\\s:.\\-–—]|$)`;
var CHAPTER_HEADING_PATTERN = new RegExp(`^chapter(?![A-Za-z])\\s*(?:${CHAPTER_NUMBER})?\\s*[:.\\-–—]*\\s*(.*)$`, "i");
var PLAIN_CHAPTER_PATTERN = new RegExp(`^chapter\\s+${CHAPTER_NUMBER}\\s*(?:[:.\\-–—]+\\s*(.*))?$`, "i");
var SECTION_HEADING_PATTERN = /^(?:prologue|epilogue|interlude|afterword)(?![A-Za-z])/i;
var PLAIN_SECTION_PATTERN = /^(?:prologue|epilogue|interlude|afterword)\s*(?:[:.\-–—]+.*)?$/i;
var PLAIN_LINE_MAX_LENGTH = 80;
var PART_HEADING = /^part(?![A-Za-z])/i;
var GENERATED_MARKER = /<!--\s*Generated by story (?:export|build)\.\s*-->/g;
var FRONT_MATTER_NAMES = /^(?:prologue|preface|foreword|introduction|prelude)\b/i;
var CANDIDATE_THRESHOLD = 3;
var CANDIDATE_LIMIT = 25;
var CANDIDATE_STOPWORDS = new Set([
  "A",
  "An",
  "And",
  "At",
  "But",
  "By",
  "Dr",
  "For",
  "He",
  "Her",
  "His",
  "I",
  "If",
  "In",
  "It",
  "Its",
  "Mr",
  "Mrs",
  "Ms",
  "No",
  "Not",
  "Of",
  "On",
  "Or",
  "She",
  "That",
  "The",
  "Then",
  "They",
  "Their",
  "This",
  "To",
  "We",
  "When",
  "While",
  "With",
  "Yes",
  "You",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
]);
var MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
var MAX_IMPORT_FILES = 500;
function rejectSymlinkedSource(filePath) {
  if (fs8.lstatSync(filePath).isSymbolicLink()) {
    throw usageError("Refusing to import symlinked source: " + filePath);
  }
}
function assertImportFileSize(filePath) {
  const size = fs8.statSync(filePath).size;
  if (size > MAX_IMPORT_FILE_BYTES) {
    throw usageError("Refusing to import oversized file " + filePath + ": " + size + " bytes exceeds the " + MAX_IMPORT_FILE_BYTES + " byte limit");
  }
}
function importManuscript(options) {
  const rawSource = String(options.source ?? "").trim();
  if (!rawSource) {
    throw usageError("An import source file or directory is required");
  }
  const cwd = options.cwd ?? process.cwd();
  const fromStdin = rawSource === STDIN_ARG;
  const source = fromStdin ? null : path12.resolve(cwd, rawSource);
  if (!fromStdin && !fs8.existsSync(source)) {
    throw usageError(`Import source not found: ${source}`);
  }
  if (!fromStdin && fs8.statSync(source).isDirectory() && fs8.existsSync(path12.join(source, "story.md"))) {
    throw usageError(`${rawSource} is already a story project (it has story.md); import reads manuscript files, so point it at the draft instead`);
  }
  const warnings = [];
  const documents = fromStdin ? [{ name: "stdin", text: options.readStdin(), untitled: true }] : readImportSource(source);
  const chapters = splitChapters(documents, warnings);
  if (chapters.length === 0) {
    throw usageError("No chapter content found in import source");
  }
  let totalWords = 0;
  const chapterFiles = chapters.map((chapter, index) => {
    const number = index + 1;
    const words = wordCount(scanComments(chapter.prose).text);
    totalWords += words;
    const title = chapter.title || `Chapter ${number}`;
    const name = `chapter-${String(number).padStart(2, "0")}.md`;
    const text = chapterMarkdown(title, number, words, chapter.prose, chapter.unnumbered);
    const bytes = Buffer4.byteLength(text, "utf8");
    if (bytes > MAX_READ_BYTES) {
      throw usageError(`Cannot import: ${name} would be ${bytes} bytes, over the ${MAX_READ_BYTES} byte limit story reads. Split the manuscript with chapter headings first`);
    }
    return { name, text };
  });
  const created = createStoryProject({
    title: options.title,
    cwd,
    dir: options.dir,
    genre: options.genre,
    subGenre: options.subGenre,
    settingEra: options.settingEra,
    themes: options.themes,
    pov: options.pov,
    tense: options.tense,
    synopsis: options.synopsis,
    defaultSynopsis: `Imported from ${fromStdin ? "stdin" : path12.basename(source)}. Replace with a 2-3 sentence synopsis.`,
    force: options.force,
    beforeWrite(root, hasStory) {
      if (!hasStory) {
        return;
      }
      let project;
      try {
        project = scanProject(root);
      } catch {
        return;
      }
      assertProjectParses(project, "import", (error) => /^chapters[\\/]chapter-\d+\.md$/i.test(error.file));
    }
  });
  const chaptersDir = path12.join(created.root, "chapters");
  for (const name of fs8.readdirSync(chaptersDir)) {
    if (!/^chapter-\d+\.md$/i.test(name)) {
      continue;
    }
    fs8.unlinkSync(path12.join(chaptersDir, name));
  }
  for (const chapter of chapterFiles) {
    writeFile(path12.join(chaptersDir, chapter.name), chapter.text, { root: created.root });
  }
  reindexProject(created.root);
  return {
    root: created.root,
    storyId: created.storyId,
    keptStory: created.keptStory,
    ignoredOptions: created.ignoredOptions,
    chapters: chapters.length,
    words: totalWords,
    warnings,
    gitignore: created.gitignore,
    candidates: extractNameCandidates(chapters.map((chapter) => chapter.prose).join(`

`))
  };
}
var NAME_WORD = "(?:(?:Ma?c|[OD]['’])(?=\\p{Lu}))?\\p{Lu}\\p{Ll}+(?:['’]\\p{Ll}+)?(?:-\\p{Lu}\\p{Ll}+)*";
var NAME_RUN_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}'’-])${NAME_WORD}(?:\\s+${NAME_WORD})+(?![\\p{L}\\p{N}])`, "gu");
var NAME_SINGLE_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}'’-])(?<!${NAME_WORD}\\s+)${NAME_WORD}(?![\\p{L}\\p{N}])(?!\\s+${NAME_WORD})`, "gu");
var MID_SENTENCE = /\p{Ll}[,;:]?\s$/u;
var DISTINCTIVE_NAME = /^\p{Lu}.*\p{Lu}/u;
function extractNameCandidates(prose) {
  const counts = new Map;
  for (const match of prose.matchAll(NAME_RUN_PATTERN)) {
    const words = match[0].replace(/\s+/g, " ").split(" ");
    while (words.length > 0 && CANDIDATE_STOPWORDS.has(words[0])) {
      words.shift();
    }
    if (words.length > 0) {
      addCandidate(counts, withoutPossessive(words.join(" ")));
    }
  }
  for (const match of prose.matchAll(NAME_SINGLE_PATTERN)) {
    const name = withoutPossessive(match[0]);
    if (CANDIDATE_STOPWORDS.has(name)) {
      continue;
    }
    if (DISTINCTIVE_NAME.test(name) || MID_SENTENCE.test(prose.slice(Math.max(0, match.index - 3), match.index))) {
      addCandidate(counts, name);
    }
  }
  return [...counts.entries()].filter(([, count]) => count >= CANDIDATE_THRESHOLD).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en")).slice(0, CANDIDATE_LIMIT).map(([name, count]) => ({ name, count }));
}
function withoutPossessive(name) {
  return name.replace(/['’]s$/, "");
}
function addCandidate(counts, name) {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}
function readSourceText(filePath) {
  return decodeUtf82(fs8.readFileSync(filePath), `Cannot import ${filePath}`, "Save it as UTF-8 plain text or markdown first");
}
function readImportSource(source) {
  try {
    return readSourceDocuments(source);
  } catch (error) {
    throw withDefaultExitCode(error, EXIT_CODES.usage);
  }
}
function readSourceDocuments(source) {
  rejectSymlinkedSource(source);
  if (fs8.statSync(source).isFile()) {
    assertImportFileSize(source);
    return [{ name: path12.basename(source), text: readSourceText(source) }];
  }
  const names = [];
  for (const entry of fs8.readdirSync(source, { withFileTypes: true })) {
    const fullPath = path12.join(source, entry.name);
    if (fs8.lstatSync(fullPath).isSymbolicLink()) {
      let targetIsDocument = false;
      try {
        targetIsDocument = fs8.statSync(fullPath).isFile();
      } catch {
        targetIsDocument = false;
      }
      if (targetIsDocument && /\.(md|markdown|txt)$/i.test(entry.name)) {
        rejectSymlinkedSource(fullPath);
      }
      continue;
    }
    if (entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name) && !/^(?:\.|~\$)/.test(entry.name)) {
      names.push(entry.name);
    }
  }
  names.sort(compareImportNames);
  if (names.length > MAX_IMPORT_FILES) {
    throw usageError("Too many import files in " + source + ": " + names.length + " exceeds the " + MAX_IMPORT_FILES + " file limit");
  }
  const documents = names.map((name) => {
    const fullPath = path12.join(source, name);
    assertImportFileSize(fullPath);
    return { name, text: readSourceText(fullPath) };
  });
  if (documents.length === 0) {
    throw usageError(`No markdown or text files found in ${source}`);
  }
  return documents;
}
function importNameRank(name, nums) {
  if (nums.length > 0) {
    return 1;
  }
  return FRONT_MATTER_NAMES.test(name) ? 0 : 2;
}
function compareImportNames(left, right) {
  const leftNums = [...left.matchAll(/\d+/g)].map((match) => Number(match[0]));
  const rightNums = [...right.matchAll(/\d+/g)].map((match) => Number(match[0]));
  const rankDiff = importNameRank(left, leftNums) - importNameRank(right, rightNums);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  const length = Math.max(leftNums.length, rightNums.length);
  for (let index = 0;index < length; index += 1) {
    const leftNum = leftNums[index];
    const rightNum = rightNums[index];
    if (leftNum === undefined) {
      return -1;
    }
    if (rightNum === undefined) {
      return 1;
    }
    if (leftNum !== rightNum) {
      return leftNum - rightNum;
    }
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
function splitChapters(documents, warnings = []) {
  const chapters = [];
  for (const document of documents) {
    const source = document.text.replace(/\r\n?/g, `
`);
    const own = storySkillsChapter(source);
    if (own) {
      chapters.push(own);
      continue;
    }
    const body = withoutLeadingFrontmatter(source);
    const offset = source.slice(0, source.length - body.length).split(`
`).length - 1;
    const text = normalizeSource(body, document.name);
    const { sections, unused, markdown } = splitByChapterHeadings(text);
    if (unused.length > 0) {
      const count = unused.length === 1 ? "1 plain-text chapter line was" : `${unused.length} plain-text chapter lines were`;
      const why = markdown ? "the file has markdown chapter headings, which take precedence, so make these headings too (## Chapter 1)" : "a chapter line splits only when it stands alone between blank lines, so add a blank line after each";
      warnings.push(warn("unsplit-chapter-lines", `${document.name}: ${count} not used to split chapters (first "${unused[0].text}" at line ${unused[0].index + 1 + offset}): ${why}. See "How chapters are split" in docs/manuscripts.md`, document.name));
    }
    if (sections.length > 0) {
      chapters.push(...sections);
    } else {
      chapters.push(singleChapter(text, document));
    }
  }
  return chapters.filter((chapter) => chapter.prose !== "");
}
function storySkillsChapter(text) {
  const heading = /^## Chapter Text[ \t]*$/m.exec(text);
  if (!heading) {
    return null;
  }
  let data;
  try {
    data = parseFrontmatter(text).data;
  } catch {
    return null;
  }
  const title = typeof data.title === "string" || typeof data.title === "number" ? String(data.title).trim() : "";
  return { title, prose: text.slice(heading.index + heading[0].length).trim(), unnumbered: data.numbered === false };
}
function normalizeSource(text, name) {
  if (/\.te?xt$/i.test(name)) {
    return text.replace(/^[ \t]+/gm, "");
  }
  return splitFences(text).map((part) => part.fenced ? part.text : protectComments(part.text, (prose) => {
    let inList = false;
    return prose.split(`
`).map((line) => {
      const indented = /^(?: {4}|\t)/.test(line);
      if (!indented && line.trim() !== "") {
        inList = /^\s{0,3}(?:[-*+]|\d+[.)])\s/.test(line);
      }
      const keep = /^\s*(?:-\s*){3,}$/.test(line) || isTableSeparator(line) || indented && !inList;
      return keep ? line : convertDashes(line);
    }).join(`
`);
  })).join("");
}
function isTableSeparator(line) {
  return line.includes("|") && line.includes("-") && /^[\s:|-]*$/.test(line);
}
var PROTECTED_SPAN = new RegExp(`(${[
  "`[^`]*`",
  "\\]\\([^)\\s]*\\)",
  "<[a-z][a-z0-9+.-]*:[^>\\s]*>",
  "<\\/?[a-z][a-z0-9-]*(?:\\s[^<>]*)?\\/?>",
  "(?<![a-z0-9+.-])(?:[a-z][a-z0-9+.-]*:\\/\\/|mailto:)\\S+",
  "(?<![\\w.-])www\\.\\S+",
  "(?<![\\w.+-])[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+"
].map((pattern) => `(?:${pattern})`).join("|")})`, "i");
function convertDashes(line) {
  return line.split(PROTECTED_SPAN).map((piece, index) => index % 2 === 1 ? piece : piece.replace(/(^|[^-])---(?!-)/g, "$1—").replace(/(^|[^-])--(?!-)/g, "$1–")).join("");
}
function protectComments(text, change) {
  let result = "";
  let position = 0;
  while (position < text.length) {
    const open = text.indexOf("<!--", position);
    if (open === -1) {
      return result + change(text.slice(position));
    }
    const close = text.indexOf("-->", open + 4);
    if (close === -1) {
      return result + change(text.slice(position, open)) + text.slice(open);
    }
    result += change(text.slice(position, open)) + text.slice(open, close + 3);
    position = close + 3;
  }
  return result;
}
function splitByChapterHeadings(text) {
  const lines = text.split(`
`);
  const hidden = hiddenLineIndexes(lines);
  const underlines = new Set;
  const markdownTitles = lines.map((line, index) => {
    if (hidden.has(index) || underlines.has(index)) {
      return null;
    }
    const setext = setextHeadingText(lines, index, hidden);
    const heading = setext ?? atxHeadingText(line);
    const title = heading === null ? null : chapterTitle(heading, CHAPTER_HEADING_PATTERN);
    if (title !== null && setext !== null) {
      underlines.add(index + 1);
    }
    return title;
  });
  const markdown = markdownTitles.some((title) => title !== null);
  const titles = markdown ? markdownTitles : lines.map((line, index) => hidden.has(index) ? null : plainChapterTitle(lines, index));
  const unused = unusedChapterLines(lines, hidden, titles, underlines);
  const sections = [];
  let current = null;
  const preamble = [];
  for (const [index, line] of lines.entries()) {
    const title = titles[index];
    if (title !== null) {
      const part = takePartHeading(current ? current.lines : preamble);
      if (current) {
        sections.push(finishChapter(current));
      }
      current = { title, lines: part, unnumbered: unnumberedHeading(lines, index, hidden, markdown) };
    } else if (markdown && underlines.has(index)) {
      continue;
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (!current) {
    return { sections: [], unused, markdown };
  }
  sections.push(finishChapter(current));
  const opening = stripTitleHeading(preamble.join(`
`)).trim();
  const plainTitleOnly = markdown ? false : !opening.includes(`
`) && opening.length <= PLAIN_LINE_MAX_LENGTH;
  if (opening !== "" && scanComments(opening).text.trim() === "") {
    const notes = opening.replace(GENERATED_MARKER, "").trim();
    if (notes !== "") {
      sections[0].prose = `${notes}

${sections[0].prose}`.trim();
    }
  } else if (opening !== "" && !plainTitleOnly) {
    sections.unshift({ title: "Opening", prose: opening });
  }
  return { sections, unused, markdown };
}
function unusedChapterLines(lines, hidden, titles, underlines) {
  const unused = [];
  for (const [index, line] of lines.entries()) {
    const text = line.trim();
    if (titles[index] !== null || hidden.has(index) || underlines.has(index) || text.length > PLAIN_LINE_MAX_LENGTH) {
      continue;
    }
    if (PLAIN_CHAPTER_PATTERN.test(text)) {
      unused.push({ index, text });
    }
  }
  return unused;
}
function takePartHeading(lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") {
    end -= 1;
  }
  const heading = end > 0 ? atxHeadingText(lines[end - 1]) : null;
  if (heading === null || !PART_HEADING.test(heading)) {
    return [];
  }
  return lines.splice(end - 1).slice(0, 1);
}
function hiddenLineIndexes(lines) {
  const hidden = fencedLineIndexes(lines);
  let inComment = false;
  for (const [index, line] of lines.entries()) {
    if (hidden.has(index)) {
      continue;
    }
    if (inComment) {
      hidden.add(index);
    }
    const text = line.replace(/`[^`]*`/g, "");
    let position = 0;
    for (;; ) {
      const next = text.indexOf(inComment ? "-->" : "<!--", position);
      if (next === -1) {
        break;
      }
      position = next + (inComment ? 3 : 4);
      inComment = !inComment;
    }
  }
  return hidden;
}
function atxHeadingText(line) {
  const heading = /^#{1,6}[ \t]+(\S.*)$/.exec(line);
  return heading ? cleanHeadingText(heading[1]) : null;
}
function setextHeadingText(lines, index, hidden, underline = /^ {0,3}(?:=+|-+)[ \t]*$/) {
  const text = lines[index];
  const next = lines[index + 1];
  if (next === undefined || hidden.has(index + 1) || !underline.test(next) || text.trim() === "") {
    return null;
  }
  if (index > 0 && lines[index - 1].trim() !== "") {
    return null;
  }
  if (/^(?: {4}|\t)|^\s*(?:[-*+>#]|\d+[.)])(?:\s|$)/.test(text) || /^\s*(?:[-=*_]\s*)+$/.test(text)) {
    return null;
  }
  return cleanHeadingText(text);
}
function cleanHeadingText(text) {
  return text.replace(/\s*\{[#.-][^{}]*\}\s*$/, "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "").replace(/\s*\{[#.-][^{}]*\}\s*$/, "").trim();
}
function plainChapterTitle(lines, index) {
  const text = lines[index].trim();
  const alone = (lines[index - 1] ?? "").trim() === "" && (lines[index + 1] ?? "").trim() === "";
  if (!alone || text === "" || text.length > PLAIN_LINE_MAX_LENGTH) {
    return null;
  }
  return chapterTitle(text, PLAIN_CHAPTER_PATTERN, PLAIN_SECTION_PATTERN);
}
function chapterTitle(text, pattern, sectionPattern = SECTION_HEADING_PATTERN) {
  if (sectionPattern.test(text)) {
    return text.replace(/[\s:.\-–—]+$/, "");
  }
  const match = pattern.exec(text);
  return match ? (match[1] ?? "").trim() : null;
}
function finishChapter(section) {
  return { title: section.title, prose: section.lines.join(`
`).trim(), unnumbered: Boolean(section.unnumbered) };
}
function unnumberedHeading(lines, index, hidden, markdown) {
  const line = lines[index];
  if (markdown && /\{[^{}]*(?:\.unnumbered|(?:^|[{\s])-(?=[\s}]))[^{}]*\}[\s#]*$/.test(line)) {
    return true;
  }
  const text = markdown ? setextHeadingText(lines, index, hidden) ?? atxHeadingText(line) : line.trim();
  return SECTION_HEADING_PATTERN.test(text ?? "");
}
function singleChapter(text, document) {
  const lines = text.split(`
`);
  const hidden = hiddenLineIndexes(lines);
  const index = lines.findIndex((line, lineIndex) => !hidden.has(lineIndex) && /^#[ \t]+\S/.test(line));
  if (index !== -1) {
    const before = lines.slice(0, index).join(`
`).trim();
    const after = lines.slice(index + 1).join(`
`).trim();
    return {
      title: atxHeadingText(lines[index]),
      prose: [before, after].filter((part) => part !== "").join(`

`)
    };
  }
  return {
    title: document.untitled ? "" : titleCaseSlug(path12.basename(document.name, path12.extname(document.name))),
    prose: text.trim()
  };
}
function stripTitleHeading(text) {
  const lines = text.split(`
`);
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first === -1) {
    return text;
  }
  const atx = atxHeadingText(lines[first].trimStart());
  if (atx !== null && /^\s*#[ \t]/.test(lines[first])) {
    return PART_HEADING.test(atx) ? text : lines.slice(first + 1).join(`
`);
  }
  if (setextHeadingText(lines, first, new Set, /^ {0,3}=+[ \t]*$/) !== null) {
    return lines.slice(first + 2).join(`
`);
  }
  return text;
}
function chapterMarkdown(title, number, words, prose, unnumbered = false) {
  return `${stringifyFrontmatter({
    title,
    number,
    ...unnumbered ? { numbered: false } : {},
    pov: "",
    locations: [],
    characters: [],
    "arcs-advanced": [],
    status: "draft",
    "word-count": words
  })}# ${unnumbered ? title : chapterHeading(number, title)}

## Chapter Text

${prose}
`;
}

// src/json.js
var API_VERSION = "story/v2";
function wantsJson(parsed) {
  return isTruthy(parsed.options.json);
}
function writeJsonResult(io, { command, ok, exitCode = EXIT_CODES.findings, data = null, diagnostics = [], writes = [] }) {
  const envelope = { apiVersion: API_VERSION, command, ok: Boolean(ok), data, diagnostics, writes };
  io.stdout.write(`${JSON.stringify(envelope, (key, value) => value === undefined ? null : value, 2)}
`);
  return envelope.ok ? EXIT_CODES.ok : exitCode;
}
function diagnosticsFrom(result, check) {
  return [
    ...(result.errors ?? []).map((finding) => diagnostic("error", finding, check)),
    ...(result.warnings ?? []).map((finding) => diagnostic("warning", finding, check)),
    ...(result.dismissed ?? []).map((entry) => ({ ...diagnostic("dismissed", entry.finding, check), exemption: entry.reason, exemptionIndex: entry.index ?? null }))
  ];
}
function diagnostic(severity, finding, check) {
  return { severity, file: finding.file, chapter: finding.chapter ?? null, message: finding.message, code: finding.code, check };
}
function failureDiagnostic(message, exitCode, check) {
  return diagnostic("error", failure(message, exitCode), check);
}
function failure(message, exitCode) {
  switch (exitCode) {
    case EXIT_CODES.usage:
      return err("usage-error", message);
    case EXIT_CODES.project:
      return err("unusable-project", message);
    case EXIT_CODES.refused:
      return err("write-refused", message);
    default:
      return err("command-failed", message);
  }
}
function resultData(result) {
  const { ok, errors, warnings, dismissed, ...data } = result;
  return data;
}

// src/commands.js
var STDIN_LABEL = "stdin";
var ADD_OPTIONS = [
  "id",
  "number",
  "chapter",
  "scene",
  "type",
  "role",
  "status",
  "mode",
  "date",
  "time",
  "travel-hours",
  "dilemma",
  "sequel",
  "outcome",
  "hook",
  "location",
  "locations",
  "character",
  "characters",
  "mention",
  "mentions",
  "member",
  "members",
  "owner",
  "arc",
  "arcs",
  "introduced",
  "resolved",
  "planted",
  "payoff",
  "significance-delayed",
  "red-herring",
  "category",
  "alias",
  "aliases",
  "region",
  "population",
  "controlled-by",
  "prevalence",
  "acts",
  "act",
  "placement",
  "order",
  "heading",
  "source",
  "sources",
  "used-in",
  "accuracy",
  "confidence",
  "method",
  "risk",
  "theme",
  "themes",
  "pov"
];
var COMMANDS = [
  {
    name: "init",
    usage: "init <title>",
    summary: ["Scaffold a story project"],
    project: "none",
    args: Infinity,
    options: ["dir", "genre", "sub-genre", "setting-era", "theme", "themes", "pov", "tense", "form", "synopsis", "series", "book-number", "follows", "precedes", "force"],
    run({ parsed, io, cwd }) {
      const result = createStoryProject({
        title: parsed.positionals.slice(1).join(" "),
        cwd,
        dir: parsed.options.dir,
        genre: parsed.options.genre,
        subGenre: parsed.options["sub-genre"],
        settingEra: parsed.options["setting-era"],
        themes: collectThemes(parsed.options),
        pov: parsed.options.pov,
        tense: parsed.options.tense,
        form: parsed.options.form,
        synopsis: parsed.options.synopsis,
        series: parsed.options.series,
        bookNumber: parsed.options["book-number"],
        follows: parsed.options.follows,
        precedes: parsed.options.precedes,
        force: isTruthy(parsed.options.force)
      });
      io.stdout.write(`${result.keptStory ? "Updated" : "Created"} story project: ${result.root}
`);
      reportKeptStory(io, result, "the title");
      reportGitignore(io, result);
      for (const linkedBook of result.linkedBooks) {
        io.stdout.write(`Updated series links in ${path13.join(linkedBook, "story.md")}
`);
      }
      return 0;
    }
  },
  {
    name: "import",
    usage: "import <source|->",
    summary: ["Split an existing manuscript into a new story project;", "- reads the manuscript from stdin"],
    project: "none",
    args: 1,
    options: ["title", "dir", "genre", "sub-genre", "setting-era", "theme", "themes", "pov", "tense", "synopsis", "force"],
    run({ parsed, io, cwd }) {
      const result = importManuscript({
        source: parsed.positionals[1],
        readStdin: () => pipedText(io, "import"),
        title: parsed.options.title,
        cwd,
        dir: parsed.options.dir,
        genre: parsed.options.genre,
        subGenre: parsed.options["sub-genre"],
        settingEra: parsed.options["setting-era"],
        themes: collectThemes(parsed.options),
        pov: parsed.options.pov,
        tense: parsed.options.tense,
        synopsis: parsed.options.synopsis,
        force: isTruthy(parsed.options.force)
      });
      io.stdout.write(`Imported ${result.chapters} ${result.chapters === 1 ? "chapter" : "chapters"} (${result.words} ${result.words === 1 ? "word" : "words"}) into ${result.root}
`);
      reportKeptStory(io, result, "--title");
      reportGitignore(io, result);
      for (const warning of result.warnings) {
        io.stderr.write(`warning: ${findingLine(warning)}
`);
      }
      if (result.keptStory) {
        io.stderr.write(`note: the old chapter files were replaced, so scenes, bible entries, and continuity files may point at chapters that are gone or changed. Run story links to find them.
`);
      }
      if (result.candidates.length > 0) {
        io.stdout.write(`Entity candidates (review, then create with story add):
`);
        for (const candidate of result.candidates) {
          io.stdout.write(`- ${candidate.name} (${candidate.count} mentions)
`);
        }
      }
      return 0;
    }
  },
  {
    name: "validate",
    usage: "validate [path]",
    summary: ["Check project structure, frontmatter, and registries"],
    project: "positional",
    options: ["json"],
    run: ({ parsed, io, root, overrides }) => reportCheck(parsed, io, "validate", applySeverity(validateProject(root()), overrides), "Project is valid", "Project validation failed")
  },
  {
    name: "reindex",
    usage: "reindex [path]",
    summary: ["Rebuild registry tables from markdown files"],
    project: "positional",
    run({ io, root }) {
      const result = reindexProject(root());
      io.stdout.write(result.changed.length === 0 ? `Registries already up to date
` : `Updated ${result.changed.length} registries
`);
      return 0;
    }
  },
  {
    name: "wordcount",
    usage: "wordcount [path]",
    summary: ["Count chapter prose words"],
    project: "positional",
    options: ["write"],
    run({ parsed, io, root }) {
      const result = computeWordCounts(root(), { write: isTruthy(parsed.options.write) });
      for (const chapter of result.chapters) {
        io.stdout.write(`${chapter.file}: ${chapter.wordCount}
`);
      }
      io.stdout.write(`Total: ${result.total}
`);
      return 0;
    }
  },
  {
    name: "links",
    usage: "links [path]",
    summary: ["Check cross-reference targets and backlinks"],
    project: "positional",
    options: ["json"],
    run: ({ parsed, io, root, overrides }) => reportCheck(parsed, io, "links", applySeverity(validateLinks(root()), overrides), "Links are valid", "Link check failed")
  },
  {
    name: "continuity",
    usage: "continuity [path]",
    summary: [
      "Check deterministic continuity contracts: deaths,",
      "casts and cut characters, promises, questions,",
      "clues, prop custody, clock and travel time,",
      "location routes, and durable state.",
      "Findings matching continuity/exemptions.md are",
      "reported as dismissed"
    ],
    project: "positional",
    options: ["json"],
    run: ({ parsed, io, root, overrides }) => reportCheck(parsed, io, "continuity", applySeverity(checkProjectContinuity(root()), overrides), "Continuity is consistent", "Continuity check failed")
  },
  {
    name: "knowledge",
    usage: "knowledge <id>",
    summary: [
      "List what a character knew at a chapter, and the",
      "changes its progressions made by then; requires --at"
    ],
    project: "flag",
    args: 1,
    options: ["at", "json"],
    run({ parsed, io, root }) {
      const characterId = parsed.positionals[1];
      const atChapterId = parsed.options.at;
      if (!characterId || typeof atChapterId !== "string") {
        throw usageError("Usage: story knowledge <character-id> --at <chapter-id> [--path <project>]");
      }
      const projectRoot = root();
      const project = scanProject(projectRoot);
      const entries = knowledgeAtChapter(projectRoot, characterId, atChapterId, project);
      const { state, changes } = entityStateAtChapter(projectRoot, "character", characterId, atChapterId, project);
      if (wantsJson(parsed)) {
        return writeJsonResult(io, { command: "knowledge", ok: true, data: { character: characterId, at: atChapterId, entries, state, changes } });
      }
      if (entries.length === 0) {
        io.stdout.write(`No recorded knowledge for ${characterId} at ${atChapterId}
`);
      }
      for (const entry of entries) {
        const source = entry.learnedIn === "" ? "pre-existing knowledge" : `learned in ${entry.learnedIn}`;
        io.stdout.write(`- ${entry.knows} (${source})
`);
      }
      io.stdout.write(formatStateChanges(changes, atChapterId));
      return 0;
    }
  },
  {
    name: "context",
    usage: "context <id>",
    summary: [
      "Pack drafting context for a chapter or scene within",
      "a token budget, with nothing from later chapters"
    ],
    project: "flag",
    args: 1,
    options: ["budget", "scenes", "json"],
    run({ parsed, io, root, overrides }) {
      const targetId = parsed.positionals[1];
      if (!targetId) {
        throw usageError("Usage: story context <chapter-or-scene-id> [--budget <tokens>] [--scenes <n>] [--path <project>]");
      }
      const context = draftingContext(root(), targetId, { budget: parsed.options.budget, scenes: parsed.options.scenes });
      const checked = checkedWarnings(context.warnings, overrides);
      if (wantsJson(parsed)) {
        const skipped = [...checked.errors, ...checked.warnings].map((finding) => finding.message);
        return writeJsonResult(io, { command: "context", ok: checked.ok, data: { ...context, warnings: skipped }, diagnostics: diagnosticsFrom(checked, "context") });
      }
      io.stdout.write(formatContext(context));
      return writeFindings(io, checked);
    }
  },
  {
    name: "compare",
    usage: "compare [path]",
    summary: [
      "Compare chapters with an earlier draft: word changes,",
      "added and removed chapters, and unchanged paragraphs;",
      "requires --ref or --against; --anchor maps old",
      "review-copy labels to the current paragraphs"
    ],
    project: "positional",
    options: ["ref", "against", "anchor"],
    run({ parsed, io, cwd, root, overrides }) {
      const comparison = applySeverity(compareProject(root(), { ref: parsed.options.ref, against: parsed.options.against, anchors: parsed.options.anchor, cwd }), overrides);
      io.stdout.write(comparison.anchors ? formatLabelMapping(comparison.anchors, comparison.label) : formatComparison(comparison, comparison.label));
      return reportResult(io, comparison, "Comparison complete", "Comparison failed");
    }
  },
  {
    name: "similarity",
    usage: "similarity [path]",
    summary: [
      "Find passages of chapter prose that share a run of",
      "words with other text (--against a file, folder, or",
      "git ref); advisory, never proof of copying"
    ],
    project: "positional",
    options: ["against", "min-words", "json"],
    run({ parsed, io, cwd, root, overrides, defaulted }) {
      const report = applySeverity(similarityReport(root(), { ...parsed.options, cwd, againstFromProject: defaulted.has("against") }), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "similarity", report);
      }
      io.stdout.write(formatSimilarity(report));
      return reportResult(io, report, "Similarity check complete", "Similarity check failed");
    }
  },
  {
    name: "progress",
    usage: "progress [path]",
    summary: [
      "Show words against target-words, deadline, chapter",
      "targets, and logged sessions; --log records today"
    ],
    project: "positional",
    options: ["log", "date", "json"],
    run({ parsed, io, root, overrides }) {
      const progress = applySeverity(projectProgress(root(), { log: isTruthy(parsed.options.log), date: parsed.options.date }), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "progress", progress, { writes: progress.logged ? [progress.logged.file] : [] });
      }
      if (progress.logged) {
        io.stdout.write(`Logged ${progress.logged.words} words for ${progress.logged.date} in ${progress.logged.file}
`);
      }
      io.stdout.write(formatProgress(progress));
      return reportResult(io, progress, "Progress checked", "Progress check failed");
    }
  },
  {
    name: "timeline",
    usage: "timeline [path]",
    summary: [
      "Show scenes in story-time order (marking scenes told",
      "out of order), POV balance, and character presence"
    ],
    project: "positional",
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const timeline = applySeverity(storyTimeline(root()), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "timeline", timeline);
      }
      io.stdout.write(formatTimeline(timeline, timeline.totalChapters));
      return reportResult(io, timeline, "Timeline built", "Timeline failed");
    }
  },
  {
    name: "prose",
    usage: "prose [path|-]",
    summary: [
      "Lint chapter prose: filter words, adverbs, dialogue",
      "tags, echoes, rhythm, repeated phrases, similar",
      "names, and style-sheet.md spellings and watch words;",
      "- lints a passage from stdin"
    ],
    project: "positional",
    options: ["json", "max-filter-words", "max-adverbs", "max-bookisms", "baseline"],
    run({ parsed, io, cwd, root, overrides }) {
      const report = applySeverity(parsed.positionals[1] === STDIN_ARG ? proseReport(passageRoot(parsed, cwd, false), { ...parsed.options, passage: pipedText(io, "prose") }) : proseReport(root(), parsed.options), overrides);
      if (wantsJson(parsed)) {
        const chapters = report.chapters.map(({ analysis: { phraseSentences, ...analysis }, ...chapter }) => ({ ...chapter, analysis }));
        return reportJson(io, "prose", { ...report, chapters }, { passage: parsed.positionals[1] === STDIN_ARG });
      }
      io.stdout.write(formatProseReport(report));
      return reportResult(io, report, "Prose check complete", "Prose check failed");
    }
  },
  {
    name: "diagram",
    usage: "diagram <kind>",
    summary: [
      "Print Mermaid source for relationships (family",
      "tree), locations (route map), timeline, clues, or",
      "arcs; --out writes it to a file"
    ],
    project: "flag",
    args: 1,
    options: ["out"],
    run({ parsed, io, root }) {
      const result = diagramProject(root(), { kind: parsed.positionals[1], out: parsed.options.out });
      if (result.ok) {
        io.stdout.write(result.outFile === undefined ? result.text : `Wrote ${parsed.positionals[1]} diagram to ${result.outFile}
`);
        return 0;
      }
      return reportResult(io, result, "Diagram built", "Diagram failed");
    }
  },
  {
    name: "names",
    usage: "names <name...>",
    summary: [
      "Check candidate names against characters, places,",
      "factions, artifacts, systems, and glossary terms:",
      "clashes are errors, look-alikes are warnings"
    ],
    project: "flag",
    args: Infinity,
    run({ parsed, io, cwd, root, overrides }) {
      const report = applySeverity(namesReport(root(), nameWords(parsed, 1, cwd, "names")), overrides);
      io.stdout.write(formatNames(report));
      return reportResult(io, report, "Names checked", "Name check failed");
    }
  },
  {
    name: "pacing",
    usage: "pacing [path]",
    summary: [
      "Show words, scenes, sequels, scene outcomes, and",
      "chapter hooks per chapter; flag easy-win runs,",
      "missing sequels, and length outliers"
    ],
    project: "positional",
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const report = applySeverity(pacingReport(root()), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "pacing", report);
      }
      io.stdout.write(formatPacing(report));
      return reportResult(io, report, "Pacing check complete", "Pacing check failed");
    }
  },
  {
    name: "clues",
    usage: "clues [path]",
    summary: [
      "Show the clue plant/reveal grid by chapter and flag",
      "fair-play problems: late plants, unplanted reveals,",
      "and red herrings never debunked"
    ],
    project: "positional",
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const report = applySeverity(clueReport(root()), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "clues", report);
      }
      io.stdout.write(formatClueMatrix(report));
      return reportResult(io, report, "Clue check complete", "Clue check failed");
    }
  },
  {
    name: "voices",
    usage: "voices [path|-]",
    summary: [
      "Fingerprint each character's tagged dialogue and flag",
      "voice-avoid words, unused voice-words, and",
      "characters who sound alike; - checks a passage",
      "from stdin"
    ],
    project: "positional",
    options: ["json"],
    run({ parsed, io, cwd, root, overrides }) {
      const report = applySeverity(parsed.positionals[1] === STDIN_ARG ? voicesReport(passageRoot(parsed, cwd, true), { passage: pipedText(io, "voices") }) : voicesReport(root()), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "voices", report, { passage: parsed.positionals[1] === STDIN_ARG });
      }
      io.stdout.write(formatVoices(report));
      return reportResult(io, report, "Voice check complete", "Voice check failed");
    }
  },
  {
    name: "series",
    usage: "series [path]",
    summary: ["Order linked prequels and sequels and check shared", "canon across books"],
    project: "positional",
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const report = applySeverity(seriesReport(root()), overrides);
      if (wantsJson(parsed)) {
        return reportJson(io, "series", report);
      }
      io.stdout.write(formatSeriesReport(report));
      return reportResult(io, report, "Series is consistent", "Series check failed");
    }
  },
  {
    name: "passes",
    usage: "passes [path]",
    summary: [
      "Show the named revision passes in story.md;",
      "--init adds the default ladder, --start and --done",
      "mark a pass"
    ],
    project: "positional",
    options: ["init", "start", "done"],
    run({ parsed, io, root }) {
      const result = projectPasses(root(), {
        init: isTruthy(parsed.options.init),
        start: parsed.options.start,
        done: parsed.options.done
      });
      for (const note of result.notes ?? []) {
        io.stderr.write(`note: ${note}
`);
      }
      if (result.changed) {
        io.stdout.write(`Updated revision-passes in story.md
`);
      }
      const where = shellWord(displayPath2(parsed));
      io.stdout.write(formatPasses(result.passes, where === "." ? "story passes" : `story passes ${where}`));
      return 0;
    }
  },
  {
    name: "report",
    usage: "report [path]",
    summary: ["Summarize project inventory, progress, and checks"],
    project: "positional",
    options: ["actionable", "json"],
    run({ parsed, io, root, overrides }) {
      const report = projectReport(root(), { displayPath: displayPath2(parsed), overrides });
      if (wantsJson(parsed)) {
        return reportProjectJson(io, "report", report);
      }
      io.stdout.write(formatProjectReport(report, { actionable: isTruthy(parsed.options.actionable) }));
      return 0;
    }
  },
  {
    name: "next",
    usage: "next [path]",
    summary: ["Recommend the next writing and maintenance actions"],
    project: "positional",
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const report = projectActions(root(), { displayPath: displayPath2(parsed), overrides });
      if (wantsJson(parsed)) {
        return reportProjectJson(io, "next", report);
      }
      io.stdout.write(formatActionReport(report));
      return 0;
    }
  },
  {
    name: "doctor",
    usage: "doctor [path]",
    summary: ["Show health checks plus actionable repair steps"],
    project: "positional",
    options: ["json"],
    run({ parsed, io, root, overrides }) {
      const report = projectActions(root(), { displayPath: displayPath2(parsed), overrides });
      if (wantsJson(parsed)) {
        return reportProjectJson(io, "doctor", report);
      }
      io.stdout.write(formatDoctorReport(report));
      return 0;
    }
  },
  {
    name: "migrate",
    usage: "migrate [path]",
    summary: ["Upgrade a project to the current schema"],
    project: "positional",
    run({ io, root }) {
      const result = migrateProject(root());
      io.stdout.write(result.changed.length === 0 ? `Project already uses the current schema
` : `Migrated project to current schema: ${result.changed.length} changes
`);
      return 0;
    }
  },
  {
    name: "add",
    usage: "add <kind> <name>",
    summary: ["Create an entity file and reindex registries"],
    project: "flag",
    args: Infinity,
    options: ADD_OPTIONS,
    run({ parsed, io, cwd, root, overrides }) {
      const result = createEntity(root(), {
        ...parsed.options,
        kind: parsed.positionals[1],
        name: nameWords(parsed, 2, cwd, "add").join(" ")
      });
      io.stdout.write(`${result.resumed ? "Finished an interrupted add of" : "Created"} ${result.kind} ${result.id}: ${result.file}
`);
      return writeFindings(io, checkedWarnings(result.warnings, overrides));
    }
  },
  {
    name: "rename",
    usage: "rename <kind> <id> <name>",
    summary: ["Rename an entity and update id references"],
    project: "flag",
    args: Infinity,
    options: ["id"],
    run({ parsed, io, cwd, root, overrides }) {
      const result = renameEntity(root(), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2],
        newId: parsed.options.id,
        name: nameWords(parsed, 3, cwd, "rename").join(" ")
      });
      io.stdout.write(`${result.resumed ? "Finished an interrupted rename of" : "Renamed"} ${result.kind} ${result.oldId} to ${result.id}: ${result.file}
`);
      return writeFindings(io, checkedWarnings(result.warnings, overrides));
    }
  },
  {
    name: "remove",
    usage: "remove <kind> <id>",
    summary: ["Remove an entity and scrub id references"],
    project: "flag",
    args: 2,
    run({ parsed, io, root, overrides }) {
      const result = removeEntity(root(), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2]
      });
      io.stdout.write(result.alreadyGone ? `Removed references to ${result.kind} ${result.id}: its file was already gone
` : `Removed ${result.kind} ${result.id}: ${result.file}
`);
      return writeFindings(io, checkedWarnings(result.warnings, overrides));
    }
  },
  {
    name: "move",
    usage: "move <kind> <id>",
    summary: [
      "Renumber a chapter (--number) or move a scene",
      "(--chapter, --scene): renames files and rewrites",
      "references"
    ],
    project: "flag",
    args: 2,
    options: ["number", "chapter", "scene"],
    run({ parsed, io, root, overrides }) {
      const result = moveEntity(root(), {
        kind: parsed.positionals[1],
        id: parsed.positionals[2],
        number: parsed.options.number,
        chapter: parsed.options.chapter,
        scene: parsed.options.scene
      });
      io.stdout.write(`Moved ${result.kind} ${result.oldId} to ${result.id}: ${result.file}${result.moved > 1 ? ` (with ${result.moved - 1} ${result.moved === 2 ? "scene" : "scenes"})` : ""}
`);
      return writeFindings(io, checkedWarnings(result.warnings, overrides));
    }
  },
  {
    name: "export",
    usage: "export [path]",
    summary: ["Combine front matter, chapters, and back matter into a", "manuscript markdown file"],
    project: "positional",
    options: ["out"],
    run({ parsed, io, root, overrides }) {
      const result = exportManuscript(root(), { out: parsed.options.out });
      io.stdout.write(`Exported ${result.chapters} chapters to ${result.outFile}
`);
      return writeFindings(io, checkedWarnings(result.warnings, overrides));
    }
  },
  {
    name: "build",
    usage: "build [path]",
    summary: [
      "Build a disposable book artifact in dist/: markdown,",
      "epub, docx, shunn, html (review copy with paragraph",
      "anchors), print (paged-media interior),",
      "narration (audiobook script), metadata (retailer",
      "sheet), fountain (screenplay scene skeleton),",
      "twee (Twine story from chapter choices), or ink",
      "(ink story from chapter choices)"
    ],
    project: "positional",
    options: ["out", "format", "shunn", "trim", "stamp", "note-url"],
    run({ parsed, io, root, overrides }) {
      const result = buildBook(root(), {
        out: parsed.options.out,
        format: parsed.options.format,
        shunn: isTruthy(parsed.options.shunn),
        trim: parsed.options.trim,
        stamp: parsed.options.stamp,
        noteUrl: parsed.options["note-url"]
      });
      io.stdout.write(`Built ${result.chapters} chapters as ${result.format} to ${result.outFile}
`);
      return writeFindings(io, checkedWarnings(result.warnings, overrides));
    }
  },
  {
    name: "synopsis",
    usage: "synopsis [path]",
    summary: ["Build a deterministic 1- or 3-page synopsis from arcs"],
    project: "positional",
    options: ["pages", "out"],
    run({ parsed, io, root }) {
      const result = synopsisBook(root(), { pages: parsed.options.pages, out: parsed.options.out });
      if (result.outFile === undefined) {
        io.stdout.write(result.text);
      } else {
        io.stdout.write(`Wrote synopsis to ${result.outFile}
`);
      }
      return 0;
    }
  }
];
function nameWords(parsed, from, cwd, command) {
  const words = parsed.positionals.slice(from);
  for (const word of words) {
    if (word === "." || word === ".." || /[\\/]/.test(word) && fs9.existsSync(path13.join(path13.resolve(cwd, word), "story.md"))) {
      throw usageError(`"${word}" looks like a project path: story ${command} takes the project as --path ${word}`);
    }
  }
  return words;
}
function pipedText(io, command) {
  return stdinText(command, io.readStdin ? io.readStdin() : readStdin(command));
}
function passageRoot(parsed, cwd, required) {
  if (parsed.options.path !== undefined) {
    return path13.resolve(cwd, parsed.options.path);
  }
  return required || fs9.existsSync(path13.join(cwd, "story.md")) ? path13.resolve(cwd) : null;
}
function checkedWarnings(warnings = [], overrides) {
  return applySeverity({ ok: true, errors: [], warnings }, overrides);
}
function writeFindings(io, result) {
  printFindings(io, result);
  return result.ok ? EXIT_CODES.ok : EXIT_CODES.findings;
}
function displayPath2(parsed) {
  const flag = parsed.options.path;
  return parsed.positionals[1] ?? (Array.isArray(flag) ? flag[flag.length - 1] : flag) ?? ".";
}
function reportKeptStory(io, result, titleLabel) {
  if (!result.keptStory || result.ignoredOptions.length === 0) {
    return;
  }
  const names = result.ignoredOptions.map((name) => name === "title" ? titleLabel : name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  io.stderr.write(`warning: ${findingLine(warn("kept-story-options", `story.md already exists and was kept, so ${list} ${names.length === 1 ? "was" : "were"} not applied. Edit story.md to change ${names.length === 1 ? "it" : "them"}.`, "story.md"))}
`);
}
function reportGitignore(io, result) {
  if (result.gitignore === "missing-dist") {
    io.stderr.write(`note: .gitignore was kept and does not ignore dist/, so builds would be committed. Add a dist/ line to keep them out.
`);
  }
}
function collectThemes(options) {
  return [].concat(options.theme ?? []).concat(options.themes ?? []).filter((value) => value !== undefined && value !== true);
}
function reportCheck(parsed, io, command, result, successMessage, failureMessage) {
  if (wantsJson(parsed)) {
    return writeJsonResult(io, {
      command,
      ok: result.ok,
      data: checkCounts(result),
      diagnostics: diagnosticsFrom(result, command)
    });
  }
  return reportResult(io, result, successMessage, failureMessage);
}
function reportJson(io, command, result, { writes = [], passage = false } = {}) {
  const diagnostics = diagnosticsFrom(result, command).map((entry) => passage && entry.file === null ? { ...entry, file: STDIN_LABEL } : entry);
  return writeJsonResult(io, { command, ok: result.ok, data: resultData(result), diagnostics, writes });
}
function checkCounts(result) {
  return { errors: result.errors.length, warnings: result.warnings.length, dismissed: (result.dismissed ?? []).length };
}
function reportProjectJson(io, command, report) {
  const { validation, links, continuity, ...rest } = report;
  const checks = { validate: validation, links, continuity };
  const seen = new Set;
  const diagnostics = Object.entries(checks).flatMap(([name, check]) => diagnosticsFrom(check, name)).filter((entry) => {
    const key = `${entry.severity}
${entry.message}`;
    return !seen.has(key) && seen.add(key);
  });
  return writeJsonResult(io, {
    command,
    ok: true,
    data: { ...rest, checks: Object.fromEntries(Object.entries(checks).map(([name, check]) => [name, { ok: check.ok, ...checkCounts(check) }])) },
    diagnostics
  });
}
function reportResult(io, result, successMessage, failureMessage) {
  const dismissed = result.dismissed ?? [];
  io.stderr.write(`${result.ok ? successMessage : failureMessage}: ${result.errors.length} errors, ${result.warnings.length} warnings, ${dismissed.length} dismissed
`);
  printFindings(io, result);
  return result.ok ? EXIT_CODES.ok : EXIT_CODES.findings;
}
function printFindings(io, result) {
  for (const error of result.errors) {
    io.stderr.write(`error: ${findingLine(error)}
`);
  }
  for (const warning of result.warnings) {
    io.stderr.write(`warning: ${findingLine(warning)}
`);
  }
  for (const entry of result.dismissed ?? []) {
    io.stderr.write(`dismissed: ${entry.finding.message} (${entry.note ?? `exemption: ${entry.reason}`})
`);
  }
}
function findingLine(finding) {
  return FINDING_CODES[finding.code] === "warning" ? `${finding.message} [${finding.code}]` : finding.message;
}

// src/version.js
var VERSION = "0.18.0";

// src/cli.js
var COMMANDS_BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));
var COMMAND_COLUMN = 21;
var HELP = [
  "Usage: story <command> [options]",
  "",
  "Commands:",
  ...formatCommandsHelp(),
  "",
  "Options:",
  ...formatOptionsHelp(),
  "",
  "Values beginning with a dash may also use the --option=value form.",
  ""
].join(`
`);
function formatCommandHelp(command) {
  const options = [...command.options ?? [], ...command.project === "none" ? [] : ["path"]];
  return [
    `Usage: story ${command.usage}${options.length > 0 ? " [options]" : ""}`,
    "",
    command.summary.join(" "),
    "",
    "Options:",
    ...formatOptionsHelp(options),
    ""
  ].join(`
`);
}
function formatCommandsHelp() {
  const lines = [];
  for (const command of COMMANDS) {
    const head = `  ${command.usage}`;
    const [first, ...rest] = command.summary;
    if (head.length < COMMAND_COLUMN - 1) {
      lines.push(`${head.padEnd(COMMAND_COLUMN)}${first}`);
    } else {
      lines.push(head, `${" ".repeat(COMMAND_COLUMN)}${first}`);
    }
    for (const line of rest) {
      lines.push(`${" ".repeat(COMMAND_COLUMN)}${line}`);
    }
  }
  return lines;
}
var CONFIG_REPAIR_COMMANDS = new Set(["validate", "report", "next", "doctor"]);
function runCli(argv, io) {
  let configured = [];
  const jsonCommand = COMMANDS_BY_NAME.get(commandWord(argv));
  const failJson = jsonCommand?.options?.includes("json") && jsonRequested(argv) ? (message, exitCode) => writeJsonResult(io, { command: jsonCommand.name, ok: false, exitCode, diagnostics: [failureDiagnostic(message, exitCode, jsonCommand.name)] }) : null;
  try {
    const named = COMMANDS_BY_NAME.get(argv[0]);
    const parsed = parseArgs(argv, named ? [...named.options ?? [], ...named.project === "none" ? [] : ["path"]] : undefined);
    const cwd = io.cwd ?? process.cwd();
    const name = parsed.positionals[0];
    if (parsed.options.version) {
      io.stdout.write(`${VERSION}
`);
      return EXIT_CODES.ok;
    }
    const topic = name === "help" ? parsed.positionals[1] : parsed.options.help ? name : undefined;
    const helpTopic = topic === "help" ? undefined : topic;
    if (helpTopic !== undefined && COMMANDS_BY_NAME.has(helpTopic)) {
      io.stdout.write(formatCommandHelp(COMMANDS_BY_NAME.get(helpTopic)));
      return EXIT_CODES.ok;
    }
    if (name === "help" && helpTopic !== undefined) {
      io.stderr.write(`Unknown command: ${helpTopic}${suggestion(helpTopic, [...COMMANDS_BY_NAME.keys()])}
Run story --help to list commands.
`);
      return EXIT_CODES.usage;
    }
    if (!name || name === "help" || parsed.options.help) {
      io.stdout.write(HELP);
      return EXIT_CODES.ok;
    }
    const command = COMMANDS_BY_NAME.get(name);
    if (!command) {
      io.stderr.write(`Unknown command: ${name}${suggestion(name, [...COMMANDS_BY_NAME.keys()])}
Run story --help to list commands.
`);
      return EXIT_CODES.usage;
    }
    if (command.project === "none" && parsed.options.path !== undefined) {
      io.stderr.write(`${name} uses --dir for the target directory. --path is the project root for other commands.
`);
      return EXIT_CODES.usage;
    }
    const misuse = commandUsageError(command, parsed);
    if (misuse) {
      if (failJson) {
        return failJson(misuse, EXIT_CODES.usage);
      }
      io.stderr.write(`${misuse}
`);
      return EXIT_CODES.usage;
    }
    const root = () => resolveRoot(cwd, parsed, name);
    const config = command.project === "none" ? null : projectConfig(command, configRoot(cwd, parsed, root));
    configured = config === null ? [] : applyDefaults(config, name, parsed.options).map((key) => [key, parsed.options[key]]);
    const overrides = config === null ? NO_OVERRIDES : findingOverrides(config);
    return command.run({ parsed, io, cwd, root, overrides, defaulted: new Set(configured.map(([key]) => key)) });
  } catch (error) {
    const message = `${describeError(error, io.cwd ?? process.cwd())}${configuredHint(error, configured)}`;
    const exitCode = exitCodeFor(error);
    if (failJson) {
      return failJson(message, exitCode);
    }
    io.stderr.write(`${message}
`);
    return exitCode;
  }
}
function configRoot(cwd, parsed, root) {
  return parsed.positionals[1] === "-" ? path14.resolve(cwd, lastOptionValue(parsed.options.path) ?? ".") : root();
}
function projectConfig(command, root) {
  const config = readCliConfig(root);
  if (config.errors.length === 0) {
    return config;
  }
  if (CONFIG_REPAIR_COMMANDS.has(command.name)) {
    return { defaults: {}, severity: {}, exemptions: config.exemptions, errors: config.errors };
  }
  throw projectError(`Fix cli-defaults or severity in story.md before running story ${command.name} (story validate lists every problem): ${config.errors.join("; ")}`);
}
function configuredHint(error, configured) {
  const message = String(error?.message);
  const named = configured.filter(([key, value]) => message.includes(`--${key}`) || typeof value === "string" && message.includes(value));
  return named.length === 0 ? "" : ` (story.md cli-defaults set ${named.map(([key, value]) => value === true ? `--${key}` : `--${key} ${value}`).join(", ")})`;
}
function commandWord(argv) {
  for (let index = 0;index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      return argv[index + 1];
    }
    if (!arg.startsWith("-")) {
      return arg;
    }
    if (arg.startsWith("--") && !arg.includes("=") && takesValue(arg.slice(2))) {
      index += 1;
    }
  }
  return;
}
function jsonRequested(argv) {
  let requested = false;
  for (let index = 0;index < argv.length && argv[index] !== "--"; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      const next = argv[index + 1];
      requested = isBooleanLiteralToken(next) ? isTruthy(next) : true;
    } else if (arg.startsWith("--json=")) {
      requested = isTruthy(arg.slice("--json=".length)) || !isBooleanLiteralToken(arg.slice("--json=".length).trim());
    }
  }
  return requested;
}
function handleOutputError(error, proc) {
  if (error?.code === "EPIPE") {
    proc.exit(proc.exitCode ?? 0);
    return;
  }
  const reason = FILE_ERROR_REASONS[error?.code];
  const message = error?.syscall === "write" && reason ? `Cannot write output: ${reason}` : error?.stack ?? String(error);
  try {
    proc.stderr.write(`${message}
`);
  } catch {}
  proc.exit(1);
}
var FILE_ERROR_REASONS = {
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
var FILE_ERROR_ACTIONS = { open: "open", scandir: "list", stat: "check", statx: "check", lstat: "check", rename: "replace", mkdir: "create the folder", unlink: "delete", rmdir: "delete", copyfile: "copy", access: "write to", write: "write to", rm: "delete" };
function describeError(error, cwd) {
  const hint = typeof error.hint === "string" ? `. ${error.hint}` : "";
  const reason = FILE_ERROR_REASONS[error.code];
  if (!reason || typeof error.path !== "string") {
    return `${error.message}${hint}`;
  }
  const relativePath = path14.relative(cwd, error.path);
  const shown = relativePath !== "" && !relativePath.startsWith("..") && !path14.isAbsolute(relativePath) ? relativePath : error.path;
  return `Cannot ${FILE_ERROR_ACTIONS[error.syscall] ?? "use"} ${shown}: ${reason}${hint}`;
}
function commandUsageError(command, parsed) {
  const maxArgs = command.args ?? (command.project === "positional" ? 1 : 0);
  const extra = parsed.positionals.slice(1 + maxArgs);
  if (extra.length > 0) {
    const plural = extra.length === 1 ? "" : "s";
    return `Unexpected argument${plural} for story ${command.usage}: ${extra.join(" ")}`;
  }
  const allowed = new Set(command.options ?? []);
  if (command.project !== "none") {
    allowed.add("path");
  }
  for (const key of Object.keys(parsed.options)) {
    if (key !== "help" && key !== "version" && !allowed.has(key)) {
      return `--${key} does not apply to story ${command.name}`;
    }
  }
  return null;
}
function lastOptionValue(value) {
  return Array.isArray(value) ? value[value.length - 1] : value;
}
function resolveRoot(cwd, parsed, name) {
  const flagPath = lastOptionValue(parsed.options.path);
  if (COMMANDS_BY_NAME.get(name)?.project !== "positional") {
    return path14.resolve(cwd, flagPath ?? ".");
  }
  const positionalPath = parsed.positionals[1];
  if (positionalPath !== undefined && flagPath !== undefined) {
    const resolvedPositional = path14.resolve(cwd, positionalPath);
    const resolvedFlag = path14.resolve(cwd, flagPath);
    if (resolvedPositional !== resolvedFlag) {
      throw usageError(`Conflicting project paths: ${positionalPath} and --path ${flagPath}. Use either a positional path or --path, not both.`);
    }
    return resolvedFlag;
  }
  return path14.resolve(cwd, flagPath ?? positionalPath ?? ".");
}

// bin/story.js
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error) => handleOutputError(error, process));
}
process.on("uncaughtException", (error) => handleOutputError(error, process));
process.exitCode = runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr
});

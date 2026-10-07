import { Buffer } from "node:buffer";
import path from "node:path";
import {
  MAX_READ_BYTES,
  MAX_UNDO_LINE_BYTES,
  UNDO_LOG,
  UNSAFE_TEXT,
  assertExistingAncestorInsideRoot,
  assertLexicallyInsideRoot,
  assertSafeProjectPath,
  contentHash,
  currentText,
  decodeUtf8,
  deleteUndoLog,
  forEachLine,
  isUndoablePath,
  lstatIfExists,
  readFileBytes,
  readFilePrefix,
  removeFile,
  writeFile
} from "./files.js";
import { lockedByAnother } from "./lock.js";
import { projectError, refusedError } from "./exit-codes.js";

// Putting back a split, merge, move, rename, or remove that stopped part
// way, from the undo log it leaves (see withUndoLog in files.js). The same
// command run again does it before it starts, and so does `story doctor
// --fix`; every other command that changes the project is refused while
// the log is there, so nothing builds on a half-made change or changes a
// file the log would put back.

// The first line, which names the command, fits in this.
const HEADER_BYTES = 4096;

// The state of a file that does not exist, beside the hashes of the ones
// that do.
const ABSENT = "absent";

// The command whose undo log the project holds, as { command }, or null
// when it holds none, or when the command that keeps the log is still
// running (it holds the project lock). Only the first line is read; a log
// too damaged to name its command still counts.
export function interruptedChange(root) {
  const projectRoot = path.resolve(root);
  const file = path.join(projectRoot, UNDO_LOG);
  if (!logExists(file) || lockedByAnother(projectRoot)) {
    return null;
  }
  let header = null;
  try {
    header = JSON.parse(readFilePrefix(file, HEADER_BYTES).toString("utf8").split("\n")[0]);
  } catch {
    // Named as "a story command".
  }
  return { command: commandName(header) };
}

// Refuses `command` (as typed, such as story reindex) while the project
// holds the undo log of another, unless that is `command` itself, which
// puts it back first.
export function assertNoInterruptedChange(root, command) {
  const interrupted = interruptedChange(root);
  if (interrupted !== null && interrupted.command !== command) {
    throw refusedError(`${interrupted.command} stopped part way, and ${UNDO_LOG} holds what it changed, so ${command} would build on a change made only in part; nothing was changed. Run story doctor --fix to put those files back first, or run ${interrupted.command} again to finish it`);
  }
}

// A command name as an undo log keeps and prints it: without control
// characters or marks that reorder text, so a log from a cloned project
// cannot drive the terminal.
export function safeCommandName(text) {
  return text.replace(new RegExp(UNSAFE_TEXT.source, "gu"), " ");
}

// Puts back every file the log names as it was before the command changed
// it (deleting one it made), deletes the log, and returns { command, files
// }, the files it changed, relative to the root; null when there is no
// log. The log is read twice, a line at a time: first for the states the
// command left each file in, then for the text to put back. When a file
// holds something else (an edit saved since), or is reached through a
// folder outside the project, nothing is changed, so that edit is not lost;
// one saved while the files are put back stops it there, and running it
// again finishes it.
export function undoInterruptedChange(root) {
  const projectRoot = path.resolve(root);
  const logFile = path.join(projectRoot, UNDO_LOG);
  if (!logExists(logFile)) {
    return null;
  }
  const states = new Map();
  const command = readUndoLog(logFile, (entry, first) => {
    if (first) {
      states.set(entry.path, new Set([stateOf(entry.before), stateOf(entry.after, true)]));
    } else {
      states.get(entry.path).add(stateOf(entry.after, true));
    }
  });
  const checked = new Map([...states.keys()].map((relative) => [relative, currentState(projectRoot, relative)]));
  const edited = [...states].filter(([relative, known]) => !known.has(checked.get(relative))).map(([relative]) => relative);
  if (edited.length > 0) {
    const [it, changed] = edited.length === 1 ? ["it", "has changed since, or is reached"] : ["them", "have changed since, or are reached"];
    throw projectError(`Cannot put back what ${command} changed before it stopped part way: ${edited.join(", ")} ${changed} through a folder outside the project, and putting ${it} back would lose that change, so nothing was changed. Undo that change and run this again, or delete ${UNDO_LOG} to keep the project as it is, then check it with story validate and story links`);
  }
  const restored = [];
  readUndoLog(logFile, (entry, first) => {
    const state = checked.get(entry.path);
    if (!first || state === stateOf(entry.before)) {
      return;
    }
    const target = path.join(projectRoot, ...entry.path.split("/"));
    // What it held when it was checked, so a save since is not lost.
    const unchangedFrom = state === ABSENT ? null : currentText(target);
    if (unchangedFrom === null ? state !== ABSENT : contentHash(unchangedFrom) !== state) {
      throw refusedError(`${entry.path} changed on disk while story was putting back what ${command} changed, so it was left as it is. Run this again to finish`);
    }
    if (entry.before === null) {
      assertSafeProjectPath(target, projectRoot);
      removeFile(target, { root: projectRoot, unchangedFrom });
    } else {
      writeFile(target, entry.before, { root: projectRoot, unchangedFrom, mode: entry.mode });
    }
    restored.push(entry.path);
  });
  deleteUndoLog(projectRoot);
  return { command, files: restored };
}

// Whether anything is at the log's name. A project path that is not a
// folder has nothing there, and the command says what is wrong with it.
function logExists(file) {
  try {
    return lstatIfExists(file) !== null;
  } catch {
    return false;
  }
}

// Calls visit(entry, first) for each change the log records, as { path,
// after, before, mode }, with `first` true on a file's first change, which
// alone has `before` and `mode`, and returns the command its first line
// names. A line counts only when it ends: a change waits for its line to
// reach the disk, so the change of a line a crash cut short was never made.
// A line that is not one story writes, or one too long, stops the read.
function readUndoLog(logFile, visit) {
  const seen = new Set();
  let command = commandName(null);
  try {
    forEachLine(logFile, MAX_UNDO_LINE_BYTES, (bytes, number) => {
      const entry = parsedLine(bytes);
      if (number === 1) {
        command = commandName(entry);
        return;
      }
      const first = !seen.has(entry?.path);
      if (!isUndoEntry(entry, first)) {
        throw unreadableLog(number);
      }
      seen.add(entry.path);
      visit(entry, first);
    });
  } catch (error) {
    throw error.longLine === undefined ? error : unreadableLog(error.longLine);
  }
  return command;
}

function unreadableLog(number) {
  return projectError(`${UNDO_LOG} is not an undo log story can read (line ${number}), so nothing was changed. Delete it, then check the project with story validate and story links`);
}

function parsedLine(bytes) {
  try {
    return JSON.parse(decodeUtf8(bytes, UNDO_LOG));
  } catch {
    return null;
  }
}

// A line for one change: a path the log may name, the hash of what the
// file was about to hold or null, and, on the file's first line, the text
// it held (no longer than a file story reads) or null, with the file's
// permissions when it held text.
function isUndoEntry(entry, first) {
  return entry !== null && typeof entry === "object" && typeof entry.path === "string" && isUndoablePath(entry.path)
    && (entry.after === null || /^[0-9a-f]{64}$/.test(entry.after))
    && (!first || entry.before === null || (typeof entry.before === "string" && Buffer.byteLength(entry.before) <= MAX_READ_BYTES))
    && (entry.mode === undefined || (Number.isInteger(entry.mode) && entry.mode >= 0 && entry.mode <= 0o777));
}

// A state as the log records it: ABSENT for null, else the hash of the
// text, or, with `hashed`, the hash itself.
function stateOf(value, hashed = false) {
  return value === null ? ABSENT : hashed ? value : contentHash(value);
}

// What a project file holds now: ABSENT, the hash of its bytes, or null for
// what a log never records (a symlink, a folder, a file too large to read,
// a file in its folder's place) and for a file reached through a folder
// outside the project, which is never read.
function currentState(projectRoot, relative) {
  const target = path.join(projectRoot, ...relative.split("/"));
  try {
    assertLexicallyInsideRoot(target, projectRoot);
    assertExistingAncestorInsideRoot(path.dirname(target), projectRoot);
    return lstatIfExists(target) === null ? ABSENT : contentHash(readFileBytes(target));
  } catch {
    return null;
  }
}

// The command a log's first line names, as safeCommandName shows it.
function commandName(header) {
  return typeof header?.command === "string" ? safeCommandName(header.command) : "a story command";
}

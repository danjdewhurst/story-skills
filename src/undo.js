import path from "node:path";
import { MAX_READ_BYTES, UNDO_LOG, assertSafeProjectPath, contentHash, decodeUtf8, isUndoablePath, lstatIfExists, readFileBytes, readFilePrefix, removeFile, writeFile } from "./files.js";
import { projectError, refusedError } from "./exit-codes.js";

// Putting back a split, merge, move, rename, or remove that stopped part
// way, from the undo log it leaves (see withUndoLog in files.js). The next
// run of any of those commands does it before it starts, and so does
// `story doctor --fix`; every other command that changes the project is
// refused while the log is there, so nothing builds on a half-made change
// or changes a file the log would put back.

// The most of an undo log that is read: it holds the text of every file
// the command changed, each read under MAX_READ_BYTES.
export const MAX_UNDO_LOG_BYTES = 64 * MAX_READ_BYTES;

// The first line, which names the command, fits in this.
const HEADER_BYTES = 4096;

// The state of a file that does not exist, beside the hashes of the ones
// that do.
const ABSENT = "absent";

// The command whose undo log the project holds, as { command }, or null
// when it holds none. Only the first line is read; a log too damaged to
// name its command still counts.
export function interruptedChange(root) {
  const file = path.join(path.resolve(root), UNDO_LOG);
  if (!logExists(file)) {
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

// Refuses `command`, a write command that does not put back an interrupted
// change itself, while the project holds an undo log.
export function assertNoInterruptedChange(root, command) {
  const interrupted = interruptedChange(root);
  if (interrupted !== null) {
    throw refusedError(`${interrupted.command} stopped part way, and ${UNDO_LOG} holds what it changed, so story ${command} would build on a change made only in part; nothing was changed. Run story doctor --fix to put those files back first, or run that command again, which puts them back and then makes its change`);
  }
}

// Puts back every file the log names as it was before the command changed
// it (deleting one it made), deletes the log, and returns { command, files
// }, the files it changed, relative to the root; null when there is no
// log. When a file holds something the command never left in it (an edit
// saved since), nothing is changed, so that edit is not lost.
export function undoInterruptedChange(root) {
  const projectRoot = path.resolve(root);
  const logFile = path.join(projectRoot, UNDO_LOG);
  if (!logExists(logFile)) {
    return null;
  }
  const { command, files } = readUndoLog(logFile);
  const at = (relative) => path.join(projectRoot, ...relative.split("/"));
  const edited = [...files].filter(([relative, { states }]) => !states.has(currentState(at(relative)))).map(([relative]) => relative);
  if (edited.length > 0) {
    const [it, has] = edited.length === 1 ? ["it", "has"] : ["them", "have"];
    throw projectError(`Cannot put back what ${command} changed before it stopped part way: ${edited.join(", ")} ${has} changed since, and putting ${it} back would lose that change, so nothing was changed. Undo that change and run this again, or delete ${UNDO_LOG} to keep the project as it is, then check it with story validate and story links`);
  }
  const restored = [];
  for (const [relative, { before }] of files) {
    const target = at(relative);
    if (currentState(target) === stateOf(before)) {
      continue;
    }
    if (before === null) {
      assertSafeProjectPath(target, projectRoot);
      removeFile(target);
    } else {
      writeFile(target, before, { root: projectRoot });
    }
    restored.push(relative);
  }
  removeFile(logFile);
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

// The log's command and, for each file in the order the command first
// changed it, { before, states }: its text before (null when it did not
// exist) and each state the command left it in (ABSENT or a hash), the one
// before included. A line counts only when it ends: a change waits for its
// line to reach the disk, so the change of a line a crash cut short was
// never made.
function readUndoLog(logFile) {
  const lines = decodeUtf8(readFileBytes(logFile, MAX_UNDO_LOG_BYTES), logFile).split("\n").slice(0, -1);
  const files = new Map();
  lines.slice(1).forEach((line, index) => {
    const entry = parsedLine(line);
    const file = files.get(entry?.path);
    if (!isUndoEntry(entry, file === undefined)) {
      throw projectError(`${UNDO_LOG} is not an undo log story can read (line ${index + 2}), so nothing was changed. Delete it, then check the project with story validate and story links`);
    }
    if (file === undefined) {
      files.set(entry.path, { before: entry.before, states: new Set([stateOf(entry.before), stateOf(entry.after, true)]) });
    } else {
      file.states.add(stateOf(entry.after, true));
    }
  });
  return { command: commandName(lines.length > 0 ? parsedLine(lines[0]) : null), files };
}

function parsedLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// A line for one change: a path the log may name, the hash of what the
// file was about to hold or null, and, on the file's first line, the text
// it held or null.
function isUndoEntry(entry, first) {
  return entry !== null && typeof entry === "object" && typeof entry.path === "string" && isUndoablePath(entry.path)
    && (entry.after === null || /^[0-9a-f]{64}$/.test(entry.after))
    && (!first || entry.before === null || typeof entry.before === "string");
}

// A state as the log records it: ABSENT for null, else the hash of the
// text, or, with `hashed`, the hash itself.
function stateOf(value, hashed = false) {
  return value === null ? ABSENT : hashed ? value : contentHash(value);
}

// What a file holds now: ABSENT, the hash of its bytes, or null for what a
// log never records (a symlink, a folder, a file too large to read, or a
// file in its folder's place).
function currentState(target) {
  try {
    return lstatIfExists(target) === null ? ABSENT : contentHash(readFileBytes(target));
  } catch {
    return null;
  }
}

// The command a log's first line names, without control characters, so a
// log from a cloned project cannot move the terminal's cursor.
function commandName(header) {
  return typeof header?.command === "string" ? header.command.replace(/\p{Cc}/gu, " ") : "a story command";
}

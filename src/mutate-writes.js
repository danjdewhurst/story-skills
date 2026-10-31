// Write primitives the mutation commands share: the undo-log wrapper, moves
// committed file by file, and the checks and writes for planned changes.
import fs from "node:fs";
import path from "node:path";
import {
  assertExistingAncestorInsideRoot,
  assertLexicallyInsideRoot,
  assertSafeProjectDirectory,
  assertSafeProjectPath,
  makeDirectories,
  projectPath,
  readTextFile,
  recordChanges,
  removeFile,
  withUndoLog,
  writeFile
} from "./files.js";
import { refusedError } from "./exit-codes.js";
import { shellWord } from "./report.js";
import { assertNoInterruptedChange, safeCommandName, undoInterruptedChange } from "./undo.js";

// Runs a split, merge, move, rename, or remove under an undo log (see
// withUndoLog). When the same command, with the same arguments, stopped
// part way and left its log, what it changed is put back first, which the
// result reports as `undone` ({ command, files }), or, when the command
// then fails, its error's hint; the log of any other command is refused,
// since putting it back would change what this one was asked to do (a
// remove of the chapter a stopped split made). `words` are the command's
// arguments and flags, which name it as typed: ["split", "chapter-03",
// "--at", "2"] is story split chapter-03 --at 2.
export function withUndo(root, words, run) {
  const command = safeCommandName(["story", ...words.filter((word) => word !== undefined).map((word) => shellWord(String(word).trim()))].join(" "));
  assertNoInterruptedChange(root, command);
  const undone = undoInterruptedChange(root);
  try {
    const result = withUndoLog(root, command, run);
    return undone === null ? result : { ...result, undone };
  } catch (error) {
    if (undone !== null) {
      const note = `${undone.command} had stopped part way, so the ${undone.files.length} ${undone.files.length === 1 ? "file" : "files"} it changed were put back first`;
      error.hint = typeof error.hint === "string" ? `${error.hint}. ${note}` : note;
    }
    throw error;
  }
}

// A flag and its value as withUndo names a command, or nothing when the
// flag was not given.
export function flag(name, value) {
  return value === undefined ? [] : [`--${name}`, value];
}

// Writes every rewritten reference, then each moved file at its new path,
// then deletes the old paths. A file already at a new path is refused unless
// it is byte for byte what this move writes there: then an earlier run was
// interrupted after writing it, and this run finishes the job. The text of
// each moving file is the one the plan read (plan.originals), so an edit
// saved since is never lost with the old path.
export function commitMoves(root, plan, moves, beforeDelete = () => {}, alsoChanged = []) {
  const originals = moves.map((move) => plan.originals?.get(move.oldFile) ?? readTextFile(move.oldFile));
  const contents = moves.map((move, index) => plan.get(move.oldFile) ?? originals[index]);
  const interrupted = interruptedMove(plan, moves);
  const present = moves.map((move) => fs.existsSync(move.newFile));
  moves.forEach((move, index) => {
    if (present[index] && !interrupted) {
      throw refusedError(`${projectPath(root, move.newFile)} already exists; nothing was changed`);
    }
  });
  for (const move of moves) {
    plan.delete(move.oldFile);
  }
  assertWritable(root, [...plan.keys(), ...moves.map((move) => move.oldFile), ...alsoChanged], moves.map((move) => move.newFile));
  commitWrites(() => {
    writeReferencePlan(root, plan);
    // A file an interrupted run wrote already holds these contents.
    moves.forEach((move, index) => writeFile(move.newFile, contents[index], { root, unchangedFrom: present[index] ? contents[index] : null }));
    beforeDelete();
    // A chapter's scenes go before the chapter, so a rerun still finds the
    // chapter and its remaining scenes.
    for (const index of [...moves.keys()].reverse()) {
      removeMovedFile(root, { ...moves[index], original: originals[index], written: contents[index] });
    }
  });
}

// Deletes the old file of a renamed or moved entity, unless it changed on
// disk after the command read it: then the copy just written at the new
// path is deleted instead, so the change is kept and a rerun moves the file
// with it.
export function removeMovedFile(root, { oldFile, original, newFile, written }) {
  try {
    removeFile(oldFile, { root, unchangedFrom: original });
  } catch (error) {
    if (error.changedOnDisk) {
      removeFile(newFile, { root, unchangedFrom: written });
      error.message = `${error.message}, and the copy written at ${projectPath(root, newFile)} was removed`;
      error.hint = "Run the same command again to finish with the change";
    }
    throw error;
  }
}

// An earlier run of this move was killed after writing the new files when
// every file already at a new path is byte for byte what this move writes
// there, and nothing but the moving files still names the old ids: the
// references, registries included, were rewritten first. Two placeholder
// chapters that happen to match still differ there, as the registry lists
// the old one.
export function interruptedMove(plan, moves) {
  const moving = new Set(moves.map((move) => move.oldFile));
  if ([...plan.keys()].some((file) => !moving.has(file))) {
    return false;
  }
  return moves.every((move) => !fs.existsSync(move.newFile)
    || readTextFile(move.newFile) === (plan.get(move.oldFile) ?? readTextFile(move.oldFile)));
}

export function ensureDirectory(directory, changed, root) {
  if (!fs.existsSync(directory)) {
    assertLexicallyInsideRoot(directory, root);
    assertExistingAncestorInsideRoot(directory, root);
    makeDirectories(directory);
    assertSafeProjectDirectory(directory, root);
    changed.push(directory);
    return;
  }

  assertSafeProjectDirectory(directory, root);
}

export function ensureFile(filePath, contents, changed, root) {
  if (!fs.existsSync(filePath)) {
    writeFile(filePath, contents, { root, unchangedFrom: null });
    changed.push(filePath);
    return;
  }

  assertSafeProjectPath(filePath, root);
}

export function writeReferencePlan(root, plan) {
  for (const [file, contents] of plan) {
    writeFile(file, contents, { root, unchangedFrom: plan.originals?.get(file) });
  }
}

// Puts back every file writeReferencePlan rewrote, each only while it still
// holds what was written.
export function undoReferencePlan(root, plan) {
  for (const [file, contents] of plan) {
    writeFile(file, plan.originals.get(file), { root, unchangedFrom: contents });
  }
}

const UNWRITABLE_REASONS = { EACCES: "permission denied", EPERM: "permission denied", EROFS: "the file system is read-only" };

// Before a rename, remove, or move writes anything, checks that every file it
// will rewrite or delete, and every folder it writes into, can be written, so
// a read-only file stops the command with the project unchanged instead of
// half renamed. `changed` lists files rewritten or deleted, `created` new
// files. Writes replace files through a temporary file in the same folder,
// so the folder must be writable too.
export function assertWritable(root, changed, created = []) {
  const problems = new Map();
  const check = (target, label) => {
    try {
      fs.accessSync(target, fs.constants.W_OK);
    } catch (error) {
      if (!problems.has(label)) {
        problems.set(label, UNWRITABLE_REASONS[error.code] ?? error.code ?? error.message);
      }
    }
  };
  // A folder that does not exist yet is made by the write itself.
  const folder = (file) => {
    const directory = path.dirname(file);
    const shown = projectPath(root, directory);
    if (fs.existsSync(directory)) {
      check(directory, shown === "" ? "the project folder" : `${shown}/`);
    }
  };
  for (const file of changed) {
    if (fs.existsSync(file)) {
      check(file, projectPath(root, file));
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

// Runs the writes of a rename, remove, or move. The preflight catches
// unwritable files, but a write can still fail partway (a full disk, a file
// an editor saved meanwhile): then some references already name the new id,
// so the error says to rerun, which finishes the job. A failure before any
// write (a project whose lock could not be made) changed nothing, and an
// error that already says what to do next keeps its hint.
export function commitWrites(write) {
  const { result: error, changes } = recordChanges(process.cwd(), () => {
    try {
      write();
      return null;
    } catch (caught) {
      return caught;
    }
  });
  if (error !== null) {
    if (changes.length > 0 && error.hint === undefined) {
      error.hint = "Some files were already updated: fix the problem and run the same command again to finish";
    }
    throw error;
  }
}

// Writes `contents` when they differ from `original`, the text they were
// made from (null for a file that did not exist), and only while the file
// still holds it, so a registry saved meanwhile keeps the save.
export function writeChanged(filePath, contents, original, changed, root) {
  if (original !== contents) {
    writeFile(filePath, contents, { root, unchangedFrom: original });
    changed.push(filePath);
  }
}

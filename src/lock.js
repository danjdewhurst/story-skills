import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refusedError } from "./exit-codes.js";

// The lock a write command holds on its project, so two commands (two agent
// sessions, or an editor hook running reindex while the user runs rename)
// cannot plan from the same snapshot and overwrite each other's rewrites.
export const LOCK_FILE = ".story.lock";

// How long a command waits for another one to finish before refusing.
// STORY_LOCK_WAIT_MS overrides it (0 refuses at once).
const DEFAULT_WAIT_MS = 10000;
const POLL_MS = 50;

// A lock from another host (a container, a cloud agent, or a share) cannot
// be checked by pid. One older than this is taken over. Ten minutes is
// longer than a rename or reindex, so a command still running elsewhere is
// not stolen by a second agent. Both the time written in the lock and the
// file's modification time must be this old, so a host whose clock runs
// behind ours does not make its fresh lock look stale.
export const FOREIGN_LOCK_STALE_MS = 10 * 60 * 1000;

// Projects this process already holds, so a command that calls another
// locked one (add reindexes) does not wait on itself.
const held = new Map();

export function withProjectLock(root, run) {
  const projectRoot = path.resolve(root);
  const key = realPath(projectRoot);
  if (held.has(key)) {
    held.set(key, held.get(key) + 1);
    try {
      return run();
    } finally {
      held.set(key, held.get(key) - 1);
    }
  }
  const lockPath = path.join(projectRoot, LOCK_FILE);
  // A folder that is not a project, or one this user cannot write to, gets
  // its own error from the command (or needs no write at all).
  if (!fs.existsSync(path.join(projectRoot, "story.md")) || !acquire(lockPath)) {
    return run();
  }
  held.set(key, 1);
  try {
    return run();
  } finally {
    held.delete(key);
    fs.rmSync(lockPath, { force: true });
  }
}

// Returns true once the lock file is created, false when the folder cannot
// take one. Throws when another live command keeps it past the wait.
function acquire(lockPath) {
  const deadline = Date.now() + lockWaitMs();
  let removedStale = false;
  let created;
  while ((created = tryCreate(lockPath)) === null) {
    const owner = readOwner(lockPath);
    if (owner && !owner.alive && !removedStale) {
      // A command killed before it could remove its lock. Another command
      // may have replaced it meanwhile, so only the same stale lock goes.
      removeStale(lockPath, owner.text);
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

// Moves the lock aside before deleting it, so a lock another command took
// between our check and the removal is seen and put back rather than
// deleted. Several agents can find the same stale lock at once.
function removeStale(lockPath, staleText) {
  const aside = `${lockPath}.${process.pid}.stale`;
  try {
    fs.renameSync(lockPath, aside);
  } catch {
    return;
  }
  let text = null;
  try {
    text = fs.readFileSync(aside, "utf8");
  } catch {
    // Unreadable once moved: put it back, as for a lock we did not check.
  }
  if (text !== staleText) {
    try {
      // link, unlike rename, never replaces a lock created meanwhile.
      fs.linkSync(aside, lockPath);
    } catch {
      // A newer lock is already in place, or links are not supported.
    }
  }
  fs.rmSync(aside, { force: true });
}

// true when this call created the lock, null when one already exists, false
// when the folder cannot take one.
function tryCreate(lockPath) {
  try {
    const descriptor = fs.openSync(lockPath, "wx", 0o644);
    try {
      fs.writeFileSync(descriptor, `${process.pid}\n${os.hostname()}\n${new Date().toISOString()}\n`, "utf8");
    } finally {
      fs.closeSync(descriptor);
    }
    return true;
  } catch (error) {
    return error.code === "EEXIST" ? null : false;
  }
}

function readOwner(lockPath) {
  let text;
  try {
    text = fs.readFileSync(lockPath, "utf8");
  } catch {
    return null;
  }
  const [pidText, host, writtenAt] = text.split("\n");
  const pid = Number.parseInt(pidText, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    // Being written right now, or damaged: treat a damaged one as live, so
    // the wait ends with the hint to delete it.
    return { text, pid: null, host: null, alive: true };
  }
  // A lock from another host cannot be checked by pid. One older than the
  // bound is stale; a fresh one, or one with no timestamp, stays, so the
  // wait ends with the hint to delete it.
  const foreign = host && host !== os.hostname();
  return { text, pid, host, alive: foreign ? !foreignLockStale(lockPath, writtenAt) : processAlive(pid) };
}

function foreignLockStale(lockPath, writtenAt) {
  const written = Date.parse(writtenAt);
  if (!Number.isFinite(written)) {
    return false;
  }
  // Gone since it was read: not stale, and the next try creates a new one.
  const modified = fs.statSync(lockPath, { throwIfNoEntry: false })?.mtimeMs ?? Date.now();
  return Date.now() - Math.max(written, modified) > FOREIGN_LOCK_STALE_MS;
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
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

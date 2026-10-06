import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refusedError } from "./exit-codes.js";
import { readFileAndStats } from "./files.js";

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

// A stale lock is removed only while holding this second lock, so two
// commands that find the same stale lock cannot both remove it: the second
// would delete the lock the first has just taken. It is held for one read
// and one delete, so one older than this was left by a killed command. The
// name matches the `.story-*.tmp` line in a new project's .gitignore.
export const TAKEOVER_FILE = ".story-takeover.tmp";
const TAKEOVER_STALE_MS = 2000;

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
  const ours = fs.existsSync(path.join(projectRoot, "story.md")) && acquire(lockPath);
  if (!ours) {
    return run();
  }
  held.set(key, 1);
  try {
    return run();
  } finally {
    held.delete(key);
    // Only our own lock goes: one another command took over meanwhile stays.
    if (readOwner(lockPath)?.text === ours) {
      fs.rmSync(lockPath, { force: true });
    }
  }
}

// Returns the text of the lock once this call creates it, false when the
// folder cannot take one. Throws when another live command keeps it past
// the wait.
function acquire(lockPath) {
  const deadline = Date.now() + lockWaitMs();
  let removedStale = false;
  let created;
  while ((created = tryCreate(lockPath)) === null) {
    const owner = readOwner(lockPath);
    if (owner && !owner.alive && !removedStale && removeStale(lockPath, owner.text)) {
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

// A command killed before it could remove its lock. Another command may
// have replaced it meanwhile, so only the same stale lock goes, checked and
// deleted while holding the takeover lock. Returns false when another
// command holds that, so the caller waits and looks again.
function removeStale(lockPath, staleText) {
  const guard = path.join(path.dirname(lockPath), TAKEOVER_FILE);
  let created = tryCreate(guard);
  if (created === null && Date.now() - modifiedAt(guard) > TAKEOVER_STALE_MS) {
    fs.rmSync(guard, { force: true });
    created = tryCreate(guard);
  }
  if (!created) {
    return false;
  }
  try {
    if (readOwner(lockPath)?.text === staleText) {
      fs.rmSync(lockPath, { force: true });
    }
  } finally {
    fs.rmSync(guard, { force: true });
  }
  return true;
}

// The text written when this call created the lock, null when one already
// exists, false when the folder cannot take one.
function tryCreate(lockPath) {
  try {
    const descriptor = fs.openSync(lockPath, "wx", 0o644);
    const text = `${process.pid}\n${os.hostname()}\n${new Date().toISOString()}\n`;
    try {
      fs.writeFileSync(descriptor, text, "utf8");
    } finally {
      fs.closeSync(descriptor);
    }
    return text;
  } catch (error) {
    return error.code === "EEXIST" ? null : false;
  }
}

// A lock holds a pid, a host name, and a time, so one larger than this was
// not written by story.
const MAX_LOCK_BYTES = 4096;

// The command holding the lock, or null when there is no lock or it cannot
// be read. A lock that is a symlink, a FIFO, or oversized is refused rather
// than followed or read whole (a cloned project can link it to /dev/zero),
// so it counts as held and the wait ends with the hint to delete it.
function readOwner(lockPath) {
  let text;
  let modified;
  try {
    const { bytes, stats } = readFileAndStats(lockPath, MAX_LOCK_BYTES);
    text = bytes.toString("utf8");
    modified = stats.mtimeMs;
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
  return { text, pid, host, alive: foreign ? !foreignLockStale(Date.parse(writtenAt), modified) : processAlive(pid) };
}

function foreignLockStale(written, modified) {
  return Number.isFinite(written) && Date.now() - Math.max(written, modified) > FOREIGN_LOCK_STALE_MS;
}

// A file that cannot be checked counts as just written.
function modifiedAt(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return Date.now();
  }
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

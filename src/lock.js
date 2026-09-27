import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The lock a write command holds on its project, so two commands (two agent
// sessions, or an editor hook running reindex while the user runs rename)
// cannot plan from the same snapshot and overwrite each other's rewrites.
export const LOCK_FILE = ".story.lock";

// How long a command waits for another one to finish before refusing.
// STORY_LOCK_WAIT_MS overrides it (0 refuses at once).
const DEFAULT_WAIT_MS = 10000;
const POLL_MS = 50;

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
      if (readOwner(lockPath)?.text === owner.text) {
        fs.rmSync(lockPath, { force: true });
      }
      removedStale = true;
      continue;
    }
    if (Date.now() >= deadline) {
      const who = owner?.pid ? `another story command (process ${owner.pid}${owner.host && owner.host !== os.hostname() ? ` on ${owner.host}` : ""})` : "another story command";
      throw new Error(`${who} is modifying this project; nothing was changed. Run write commands one at a time. If no story command is running, delete ${LOCK_FILE} in the project folder and try again`);
    }
    sleep(Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
  }
  return created;
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
  const [pidText, host] = text.split("\n");
  const pid = Number.parseInt(pidText, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    // Being written right now, or damaged: treat a damaged one as live, so
    // the wait ends with the hint to delete it.
    return { text, pid: null, host: null, alive: true };
  }
  // A lock from another machine (a shared folder) cannot be checked.
  return { text, pid, host, alive: (host && host !== os.hostname()) || processAlive(pid) };
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

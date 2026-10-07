import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refusedError } from "./exit-codes.js";
import { FILE_ERROR_REASONS, isPlanning, readFileAndStats, readTextFile, refuseWrites } from "./files.js";

// The lock a write command holds on its project, so two commands (two agent
// sessions, or an editor hook running reindex while the user runs rename)
// cannot plan from the same snapshot and overwrite each other's rewrites.
export const LOCK_FILE = ".story.lock";

// How long a command waits for another one to finish before refusing.
// STORY_LOCK_WAIT_MS overrides it (0 refuses at once).
const DEFAULT_WAIT_MS = 10000;
const POLL_MS = 50;

// A lock that cannot be created for any reason but one already being there
// is tried again for this long before the command gives up on it: on
// Windows, a lock another command has just deleted refuses a new one while
// a virus scanner still has it open.
const CREATE_RETRY_MS = 200;

// A lock from another host (a container, a cloud agent, or a share), or
// from another pid namespace on this one, cannot be checked by pid. One
// older than this is taken over. Ten minutes is longer than a rename or
// reindex, so a command still running elsewhere is not stolen by a second
// agent. Both the time written in the lock and the
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

// Projects this process already holds, so a lock taken inside another on
// the same project (import --force fills its folder as init --force does)
// does not wait on itself.
const held = new Map();

// Runs `run` holding the project's lock. A folder that is not a project
// needs none: the command refuses it, or writes nothing. With `folder`, an
// existing folder is locked whether or not it holds story.md yet, since
// init --force and import --force fill one. A planned --dry-run writes
// nothing, so it takes no lock.
export function withProjectLock(root, run, options = {}) {
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
  const lockable = options.folder ? isDirectory(projectRoot) : fs.existsSync(path.join(projectRoot, "story.md"));
  if (!lockable || isPlanning()) {
    return run();
  }
  const ours = acquire(lockPath);
  if (typeof ours !== "string") {
    // The lock cannot be made (a folder this user cannot write to, a
    // read-only file system), so nothing keeps another command out. The
    // command still runs, as one that finds nothing to change needs no
    // lock, but its first write is refused.
    const reason = FILE_ERROR_REASONS[ours.code] ?? ours.code ?? ours.message;
    return refuseWrites(projectRoot, `Cannot create the project lock ${LOCK_FILE} (${reason}), which keeps two story commands from changing the project at once; nothing was changed. Make the project folder writable and try again`, run);
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

// Whether another story command that is still running holds the project's
// lock (one this process holds does not count), so a file it keeps while it
// runs, such as its undo log, is in use rather than left by a command that
// stopped.
export function lockedByAnother(root) {
  const projectRoot = path.resolve(root);
  return !held.has(realPath(projectRoot)) && readOwner(path.join(projectRoot, LOCK_FILE))?.alive === true;
}

// Returns the text of the lock once this call creates it, or the error
// when the folder cannot take one. Throws when another live command keeps
// it past the wait.
function acquire(lockPath) {
  const deadline = Date.now() + lockWaitMs();
  // From the first failure, so a command that waited for another one's
  // lock still retries when that lock is being deleted.
  let retryUntil = null;
  let removedStale = false;
  let created;
  while (typeof (created = tryCreate(lockPath)) !== "string") {
    if (created !== null) {
      retryUntil ??= Date.now() + CREATE_RETRY_MS;
      if (Date.now() >= retryUntil) {
        return created;
      }
      sleep(POLL_MS);
      continue;
    }
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

// Runs `run` holding the locks of several projects, each { root, folder }
// as withProjectLock takes them, in the order of their real paths, so two
// commands that need the same two locks cannot each take one and wait for
// the other.
export function withProjectLocks(locks, run) {
  const order = (lock) => realPath(path.resolve(lock.root));
  return [...locks]
    .sort((left, right) => (order(left) < order(right) ? -1 : order(left) > order(right) ? 1 : 0))
    .reduceRight((inner, lock) => () => withProjectLock(lock.root, inner, lock), run)();
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
  if (typeof created !== "string") {
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
// exists, or the error when the folder cannot take one.
function tryCreate(lockPath) {
  try {
    const descriptor = fs.openSync(lockPath, "wx", 0o644);
    const identity = ownIdentity();
    const text = `${process.pid}\n${os.hostname()}\n${new Date().toISOString()}\n${identity === null ? "" : `${identity}\n`}`;
    try {
      fs.writeFileSync(descriptor, text, "utf8");
    } finally {
      fs.closeSync(descriptor);
    }
    return text;
  } catch (error) {
    return error.code === "EEXIST" ? null : error;
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
  const [pidText, host, writtenAt, identity] = text.split("\n");
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
  return { text, pid, host, alive: foreign ? !foreignLockStale(Date.parse(writtenAt), modified) : sameHostAlive(pid, identity, Date.parse(writtenAt), modified) };
}

// Whether the command that wrote a lock on this host still runs. A lock
// from an earlier boot is stale. One from another pid namespace (a
// container sharing this host name and the project folder) cannot be
// checked by pid, so it goes by age, as a lock from another host does. A
// lock with this process's own pid is held by this process (another
// thread) when it records this process's start time, and stale when it
// records another: that process had this pid in this namespace, so it has
// ended, as a container's story command, always the same pid, does when it
// is killed. Another pid is held only while it runs with the start time the
// lock records: the system may have given the pid to a new process since,
// which has a different start time. Without a record to compare, an own-pid
// lock goes by age, and another pid by whether it runs.
function sameHostAlive(pid, recorded, written, modified) {
  const own = ownIdentity();
  const comparable = own !== null && IDENTITY_PATTERN.test(recorded ?? "");
  const [boot, namespace, started] = comparable ? recorded.split(" ") : [];
  const [ownBoot, ownNamespace, ownStarted] = comparable ? own.split(" ") : [];
  if (comparable && boot !== ownBoot) {
    return false;
  }
  if (comparable && namespace !== ownNamespace) {
    return !foreignLockStale(written, modified);
  }
  if (pid !== process.pid) {
    if (!processAlive(pid)) {
      return false;
    }
    // Where /proc does not say (no start time to read), the pid's running
    // is all there is to go by.
    const current = comparable ? processStartTime(pid) : null;
    return current === null || current === started;
  }
  return comparable ? started === ownStarted : !foreignLockStale(written, modified);
}

// The boot, the pid namespace, and the start time (clock ticks since boot)
// of this process, read from /proc, as a lock records them: together they
// tell this process from any other on the machine. Null where /proc does
// not give them (macOS, Windows), and the lock then records none.
const IDENTITY_PATTERN = /^[0-9a-f-]+ pid:\[\d+\] \d+$/;

export function processIdentity(proc = "/proc") {
  try {
    const started = startTimeField(readTextFile(path.join(proc, "self", "stat")));
    const boot = readTextFile(path.join(proc, "sys", "kernel", "random", "boot_id")).trim();
    const identity = `${boot} ${fs.readlinkSync(path.join(proc, "self", "ns", "pid"))} ${started}`;
    return IDENTITY_PATTERN.test(identity) ? identity : null;
  } catch {
    return null;
  }
}

// The start time of a running process on this host, read as processIdentity
// reads this process's, or null where /proc does not give it.
export function processStartTime(pid, proc = "/proc") {
  try {
    return startTimeField(readTextFile(path.join(proc, String(pid), "stat"))) ?? null;
  } catch {
    return null;
  }
}

// The start time of a /proc/<pid>/stat line. The command name in
// parentheses may hold spaces; the start time is the 22nd field, the 20th
// after it.
function startTimeField(stat) {
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
}

let identityRead;
function ownIdentity() {
  if (identityRead === undefined) {
    identityRead = processIdentity();
  }
  return identityRead;
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

function isDirectory(target) {
  return fs.statSync(target, { throwIfNoEntry: false })?.isDirectory() === true;
}

function realPath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

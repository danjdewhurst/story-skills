import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { writeFile } from "../src/files.js";
import { FOREIGN_LOCK_STALE_MS, LOCK_FILE, processIdentity, processStartTime, TAKEOVER_FILE, withProjectLock, withProjectLocks } from "../src/lock.js";
import { createEntity, renameEntity, validateLinks } from "../src/story.js";
import { CHMOD_IGNORED, makeTempDir, memoryIo, messages, otherLivePid } from "./helpers.js";

const EXAMPLES = path.join(import.meta.dir, "..", "examples");

// Preloaded into a rename, this writes a file named for the process into the
// folder in STORY_TEST_SIGNALS just before the rename tries to create the
// project lock, so a test can see that the rename has reached the lock.
const LOCK_SIGNAL_PRELOAD = `import fs from "node:fs";
import path from "node:path";
const open = fs.openSync;
fs.openSync = (file, flags, ...rest) => {
  if (flags === "wx" && path.basename(String(file)) === ${JSON.stringify(LOCK_FILE)}) {
    fs.writeFileSync(path.join(process.env.STORY_TEST_SIGNALS, String(process.pid)), "");
  }
  return open(file, flags, ...rest);
};
`;

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function copyExample(name) {
  const root = path.join(makeTempDir(), name);
  fs.cpSync(path.join(EXAMPLES, name), root, { recursive: true });
  return root;
}

function newProject() {
  const cwd = makeTempDir();
  expect(invoke(cwd, ["init", "Safety", "--dir", "p"]).code).toBe(0);
  return path.join(cwd, "p");
}

function snapshot(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files[path.relative(root, full)] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(root);
  return files;
}

// story add as the CLI runs it, holding the project lock.
function addLocked(root, name) {
  return withProjectLock(root, () => createEntity(root, { kind: "character", name }));
}

const savedWait = process.env.STORY_LOCK_WAIT_MS;
afterEach(() => {
  if (savedWait === undefined) {
    delete process.env.STORY_LOCK_WAIT_MS;
  } else {
    process.env.STORY_LOCK_WAIT_MS = savedWait;
  }
});

describe("project lock (#196)", () => {
  test("a write command refuses while another live command holds the lock, and changes nothing", () => {
    const root = copyExample("harbor-of-second-light");
    fs.writeFileSync(path.join(root, LOCK_FILE), `${otherLivePid()}\n${os.hostname()}\n`);
    process.env.STORY_LOCK_WAIT_MS = "0";
    const before = snapshot(root);
    const result = invoke(root, ["rename", "character", "ilya-venn", "Zed Quill"]);
    expect(result.code).toBe(4);
    expect(result.err).toContain(`another story command (process ${otherLivePid()}) is modifying this project; nothing was changed`);
    expect(result.err).toContain(`delete ${LOCK_FILE}`);
    expect(snapshot(root)).toEqual(before);
    // Read-only commands never take the lock.
    expect(invoke(root, ["links"]).code).toBe(0);
  });

  test("a lock left by a dead process is taken over, and removed afterwards", () => {
    const root = copyExample("harbor-of-second-light");
    const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]).pid;
    fs.writeFileSync(path.join(root, LOCK_FILE), `${dead}\n${os.hostname()}\n`);
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(invoke(root, ["rename", "character", "ilya-venn", "Zed Quill"]).code).toBe(0);
    expect(fs.existsSync(path.join(root, LOCK_FILE))).toBe(false);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });

  test("nested locks in one process do not wait on themselves, and the lock is released on failure", () => {
    const root = newProject();
    process.env.STORY_LOCK_WAIT_MS = "0";
    const inner = withProjectLock(root, () => withProjectLock(root, () => {
      expect(fs.existsSync(path.join(root, LOCK_FILE))).toBe(true);
      return createEntity(root, { kind: "character", name: "Bo" });
    }));
    expect(inner.id).toBe("bo");
    expect(fs.existsSync(path.join(root, LOCK_FILE))).toBe(false);
    expect(() => withProjectLock(root, () => renameEntity(root, { kind: "character", id: "nobody", name: "X" }))).toThrow("does not exist");
    expect(fs.existsSync(path.join(root, LOCK_FILE))).toBe(false);
  });

  test("two renames started together both finish without breaking references", async () => {
    const root = copyExample("harbor-of-second-light");
    const bin = path.join(import.meta.dir, "..", "bin", "story.js");
    // A live command holds the project lock, so both renames start while it
    // is held and must wait for it. Each rename writes a signal just before
    // it first tries the lock, so the lock is released only after both have
    // tried it. Without the lock they would not overlap at all, and the test
    // would pass anyway.
    const scratch = makeTempDir();
    const preload = path.join(scratch, "signal-lock.mjs");
    const signals = path.join(scratch, "signals");
    fs.writeFileSync(preload, LOCK_SIGNAL_PRELOAD);
    fs.mkdirSync(signals);
    const lockPath = path.join(root, LOCK_FILE);
    fs.writeFileSync(lockPath, `${otherLivePid()}\n${os.hostname()}\n${new Date().toISOString()}\n`);
    const exited = [];
    const runs = [["theo-quill", "Theo Brand"], ["ilya-venn", "Ilya Stone"]].map(([id, name]) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--preload", preload, bin, "rename", "character", id, name, "--path", root], {
        env: { ...process.env, STORY_LOCK_WAIT_MS: "20000", STORY_TEST_SIGNALS: signals },
        stdio: "ignore"
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        exited.push(code);
        resolve(code);
      });
    }));
    // Wait, for at most 15 seconds, until both renames have tried the held
    // lock. Neither has finished, since the lock is still held.
    const deadline = Date.now() + 15000;
    while (fs.readdirSync(signals).length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(fs.readdirSync(signals)).toHaveLength(2);
    expect(exited).toEqual([]);
    expect(fs.existsSync(path.join(root, "characters", "theo-quill.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "characters", "ilya-venn.md"))).toBe(true);
    // Released, the two race for the lock, and the second waits for the first.
    fs.rmSync(lockPath);
    expect(await Promise.all(runs)).toEqual([0, 0]);
    expect(fs.readdirSync(path.join(root, "characters")).sort()).toEqual(["_index.md", "ilya-stone.md", "mara-quill.md", "theo-brand.md"]);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  }, 30000);

  test("writeFile refuses to overwrite a file saved since it was read", () => {
    const root = newProject();
    const file = path.join(root, "notes.md");
    fs.writeFileSync(file, "first\n");
    expect(() => writeFile(file, "rewritten\n", { root, unchangedFrom: "older\n" })).toThrow("notes.md changed on disk while story was updating it, so it was left as it is");
    expect(fs.readFileSync(file, "utf8")).toBe("first\n");
    expect(fs.readdirSync(root).filter((name) => name.includes(".tmp"))).toEqual([]);
    writeFile(file, "rewritten\n", { root, unchangedFrom: "first\n" });
    expect(fs.readFileSync(file, "utf8")).toBe("rewritten\n");
  });
});

describe("lock edge cases", () => {
  test("a folder that is not a project, or does not exist, runs without a lock", () => {
    const dir = makeTempDir();
    expect(withProjectLock(dir, () => fs.existsSync(path.join(dir, LOCK_FILE)))).toBe(false);
    expect(withProjectLock(path.join(dir, "missing"), () => "ran")).toBe("ran");
  });

  test("with folder, an existing folder without story.md is locked too", () => {
    const dir = makeTempDir();
    expect(withProjectLock(dir, () => fs.existsSync(path.join(dir, LOCK_FILE)), { folder: true })).toBe(true);
    expect(fs.existsSync(path.join(dir, LOCK_FILE))).toBe(false);
    expect(withProjectLock(path.join(dir, "missing"), () => "ran", { folder: true })).toBe("ran");
  });

  // A lock this process's pid wrote: the fourth line, when /proc gives it,
  // records the boot, the pid namespace, and the start time.
  const IDENTITY = processIdentity();
  const [BOOT, NAMESPACE, STARTED] = (IDENTITY ?? "").split(" ");
  function ownPidLock(root, identity, age = 0) {
    const lockPath = path.join(root, LOCK_FILE);
    const written = new Date(Date.now() - age);
    fs.writeFileSync(lockPath, `${process.pid}\n${os.hostname()}\n${written.toISOString()}\n${identity === null ? "" : `${identity}\n`}`);
    fs.utimesSync(lockPath, written, written);
    process.env.STORY_LOCK_WAIT_MS = "0";
    return lockPath;
  }

  test.skipIf(IDENTITY === null)("a lock with this pid and another start time in this pid namespace was left by an earlier process, and is taken over (#547)", () => {
    // A container's story command often gets the same pid every run, so a
    // killed run's lock carries the pid of the next one.
    const root = newProject();
    const lockPath = ownPidLock(root, `${BOOT} ${NAMESPACE} ${Number(STARTED) - 1}`);
    const result = invoke(root, ["add", "character", "Bo"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test.skipIf(IDENTITY === null)("a lock that records this very process is held by it, as by another thread", () => {
    const root = newProject();
    ownPidLock(root, IDENTITY);
    expect(() => addLocked(root, "Bo")).toThrow(`another story command (process ${process.pid}) is modifying this project`);
  });

  test.skipIf(IDENTITY === null)("a lock from another pid namespace on this host goes by age, whatever its pid", () => {
    // Another container with this host name and the project folder, where
    // story is pid 1 too: its pid says nothing about it here.
    const root = newProject();
    const other = `${BOOT} pid:[1] 7`;
    ownPidLock(root, other);
    expect(() => addLocked(root, "Bo")).toThrow(`another story command (process ${process.pid}) is modifying this project`);
    const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]).pid;
    fs.writeFileSync(path.join(root, LOCK_FILE), `${dead}\n${os.hostname()}\n${new Date().toISOString()}\n${other}\n`);
    expect(() => addLocked(root, "Bo")).toThrow(`another story command (process ${dead}) is modifying this project`);
    const lockPath = ownPidLock(root, other, FOREIGN_LOCK_STALE_MS + 1000);
    expect(addLocked(root, "Bo").id).toBe("bo");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test.skipIf(IDENTITY === null)("a lock from an earlier boot is stale, even when its pid is alive now", () => {
    const root = newProject();
    const lockPath = path.join(root, LOCK_FILE);
    fs.writeFileSync(lockPath, `${otherLivePid()}\n${os.hostname()}\n${new Date().toISOString()}\n00000000-0000-0000-0000-000000000000 ${NAMESPACE} ${STARTED}\n`);
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(addLocked(root, "Bo").id).toBe("bo");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  // The start time (clock ticks since boot) of a running process on Linux,
  // read as a lock records it.
  function startTimeOf(pid) {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  }

  test.skipIf(IDENTITY === null)("a lock whose pid is alive but was reused by another process goes by its start time (#732)", () => {
    // The sleeper is alive, yet the lock records a start time it did not
    // have: the pid went to another process after the lock's owner ended.
    const root = newProject();
    const live = otherLivePid();
    const lockPath = path.join(root, LOCK_FILE);
    const recorded = Number(startTimeOf(live)) + 1000;
    fs.writeFileSync(lockPath, `${live}\n${os.hostname()}\n${new Date().toISOString()}\n${BOOT} ${NAMESPACE} ${recorded}\n`);
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(addLocked(root, "Bo").id).toBe("bo");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test.skipIf(IDENTITY === null)("a lock whose pid is alive with the start time it recorded is still held (#732)", () => {
    const root = newProject();
    const live = otherLivePid();
    const lockPath = path.join(root, LOCK_FILE);
    fs.writeFileSync(lockPath, `${live}\n${os.hostname()}\n${new Date().toISOString()}\n${BOOT} ${NAMESPACE} ${startTimeOf(live)}\n`);
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(() => addLocked(root, "Bo")).toThrow(`another story command (process ${live}) is modifying this project`);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  test.skipIf(IDENTITY === null)("a lock whose live pid has no readable start time is still held (#732)", () => {
    // /proc does not give the start time of the live pid (a hidepid mount),
    // so the pid's running is all there is to go by, and the lock stays held
    // rather than being taken over while its owner may still write.
    const root = newProject();
    const live = otherLivePid();
    const lockPath = path.join(root, LOCK_FILE);
    fs.writeFileSync(lockPath, `${live}\n${os.hostname()}\n${new Date().toISOString()}\n${BOOT} ${NAMESPACE} ${startTimeOf(live)}\n`);
    process.env.STORY_LOCK_WAIT_MS = "0";
    const open = fs.openSync;
    const spy = spyOn(fs, "openSync").mockImplementation((file, ...rest) => {
      if (file === `/proc/${live}/stat`) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return open(file, ...rest);
    });
    try {
      expect(() => addLocked(root, "Bo")).toThrow(`another story command (process ${live}) is modifying this project`);
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  test("a lock with this pid and no record of the process goes by age", () => {
    // Written by an older story, or where /proc gives no record.
    const root = newProject();
    ownPidLock(root, null);
    expect(() => addLocked(root, "Bo")).toThrow(`another story command (process ${process.pid}) is modifying this project`);
    const lockPath = ownPidLock(root, null, FOREIGN_LOCK_STALE_MS + 1000);
    expect(addLocked(root, "Bo").id).toBe("bo");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("a lock records this process's identity where /proc gives one", () => {
    const lockPath = path.join(newProject(), LOCK_FILE);
    const lines = withProjectLock(path.dirname(lockPath), () => fs.readFileSync(lockPath, "utf8")).split("\n");
    expect(lines.slice(0, 2)).toEqual([String(process.pid), os.hostname()]);
    expect(lines.slice(3)).toEqual(IDENTITY === null ? [""] : [IDENTITY, ""]);
  });

  test.skipIf(process.platform === "win32")("processIdentity reads the boot, the pid namespace, and the start time", () => {
    const proc = makeTempDir();
    fs.mkdirSync(path.join(proc, "self", "ns"), { recursive: true });
    fs.mkdirSync(path.join(proc, "sys", "kernel", "random"), { recursive: true });
    fs.writeFileSync(path.join(proc, "sys", "kernel", "random", "boot_id"), "0f2e-41\n");
    fs.symlinkSync("pid:[4026531836]", path.join(proc, "self", "ns", "pid"));
    // A command name with a space and a parenthesis in it.
    const fields = Array.from({ length: 50 }, (_, index) => String(index + 3));
    fs.writeFileSync(path.join(proc, "self", "stat"), `42 (story (x) y) ${fields.join(" ")}\n`);
    expect(processIdentity(proc)).toBe("0f2e-41 pid:[4026531836] 22");
    fs.writeFileSync(path.join(proc, "self", "stat"), "42 (story) S\n");
    expect(processIdentity(proc)).toBeNull();
    expect(processIdentity(path.join(proc, "missing"))).toBeNull();
  });

  test.skipIf(process.platform === "win32")("processStartTime reads another process's start time, or null where /proc does not give it", () => {
    const proc = makeTempDir();
    fs.mkdirSync(path.join(proc, "4242"));
    const fields = Array.from({ length: 50 }, (_, index) => String(index + 3));
    fs.writeFileSync(path.join(proc, "4242", "stat"), `4242 (story (x) y) ${fields.join(" ")}\n`);
    expect(processStartTime(4242, proc)).toBe("22");
    expect(processStartTime(4243, proc)).toBeNull();
    fs.writeFileSync(path.join(proc, "4242", "stat"), "4242 (story) S\n");
    expect(processStartTime(4242, proc)).toBeNull();
  });

  test("locks on several projects are taken in the order of their real paths", () => {
    const one = newProject();
    const two = newProject();
    const order = [one, two].sort((left, right) => (fs.realpathSync(left) < fs.realpathSync(right) ? -1 : 1));
    const taken = [];
    const open = fs.openSync;
    const spy = spyOn(fs, "openSync").mockImplementation((file, flags, ...rest) => {
      if (flags === "wx" && path.basename(file) === LOCK_FILE) {
        taken.push(path.dirname(file));
      }
      return open(file, flags, ...rest);
    });
    try {
      expect(withProjectLocks([{ root: order[1] }, { root: order[0] }, { root: order[1] }], () => "ran")).toBe("ran");
    } finally {
      spy.mockRestore();
    }
    expect(taken).toEqual(order);
  });

  test("a lock that cannot be created refuses the first write, and a run with nothing to write still succeeds (#601)", () => {
    const root = newProject();
    const lockPath = path.join(root, LOCK_FILE);
    const open = fs.openSync;
    const spy = spyOn(fs, "openSync").mockImplementation((file, ...rest) => {
      if (file === lockPath) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return open(file, ...rest);
    });
    fs.writeFileSync(path.join(root, "..", "draft.md"), "# Chapter 1\n\nText.\n");
    const runs = {};
    let before;
    try {
      // reindex finds the registries up to date and writes nothing.
      runs.reindex = invoke(root, ["reindex"]);
      // add writes a new file, import --force first deletes the chapters,
      // and migrate first makes a missing folder: each is refused.
      fs.rmSync(path.join(root, "glossary"), { recursive: true });
      before = snapshot(root);
      runs.add = invoke(root, ["add", "character", "Bo"]);
      runs.import = invoke(path.join(root, ".."), ["import", "draft.md", "--title", "Safety", "--dir", "p", "--force"]);
      runs.migrate = invoke(root, ["migrate"]);
    } finally {
      spy.mockRestore();
    }
    expect(runs.reindex.code).toBe(0);
    expect(runs.reindex.out).toBe("Registries already up to date\n");
    for (const name of ["add", "import", "migrate"]) {
      expect(runs[name].code).toBe(4);
      expect(runs[name].err).toBe(`Cannot create the project lock ${LOCK_FILE} (permission denied), which keeps two story commands from changing the project at once; nothing was changed. Make the project folder writable and try again\n`);
    }
    expect(snapshot(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, "glossary"))).toBe(false);
  });

  test("a lock that cannot be created for a moment, as on Windows just after another command deleted it, is tried again", () => {
    const root = newProject();
    const lockPath = path.join(root, LOCK_FILE);
    const open = fs.openSync;
    let refusals = 1;
    const spy = spyOn(fs, "openSync").mockImplementation((file, ...rest) => {
      if (file === lockPath && refusals > 0) {
        refusals -= 1;
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      }
      return open(file, ...rest);
    });
    let result;
    try {
      result = invoke(root, ["add", "character", "Bo"]);
    } finally {
      spy.mockRestore();
    }
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(fs.existsSync(path.join(root, "characters", "bo.md"))).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("the retry starts at the first failure, so a command that waited for a lock still retries when it is being deleted", () => {
    const root = newProject();
    const lockPath = path.join(root, LOCK_FILE);
    fs.writeFileSync(lockPath, `${otherLivePid()}\n${os.hostname()}\n${new Date().toISOString()}\n`);
    process.env.STORY_LOCK_WAIT_MS = "2000";
    const started = Date.now();
    const open = fs.openSync;
    let refused = false;
    const spy = spyOn(fs, "openSync").mockImplementation((file, flags, ...rest) => {
      // Past the first 200 ms, the other command deletes its lock, which
      // refuses a new one for a moment.
      if (file === lockPath && flags === "wx" && !refused && Date.now() - started > 400) {
        refused = true;
        fs.rmSync(lockPath);
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      }
      return open(file, flags, ...rest);
    });
    let result;
    try {
      result = invoke(root, ["add", "character", "Bo"]);
    } finally {
      spy.mockRestore();
    }
    expect(refused).toBe(true);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("a delete that is the command's first write is refused too when the lock cannot be created", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Bo" });
    const lockPath = path.join(root, LOCK_FILE);
    const open = fs.openSync;
    const spy = spyOn(fs, "openSync").mockImplementation((file, flags, ...rest) => {
      if (file === lockPath && flags === "wx") {
        throw Object.assign(new Error("EROFS"), { code: "EROFS" });
      }
      return open(file, flags, ...rest);
    });
    const before = snapshot(root);
    let result;
    try {
      // Nothing names bo, so deleting its file is the first write.
      result = invoke(root, ["remove", "character", "bo"]);
    } finally {
      spy.mockRestore();
    }
    expect(result.code).toBe(4);
    expect(result.err).toBe(`Cannot create the project lock ${LOCK_FILE} (the file system is read-only), which keeps two story commands from changing the project at once; nothing was changed. Make the project folder writable and try again\n`);
    expect(snapshot(root)).toEqual(before);
  });

  test.skipIf(CHMOD_IGNORED)("a project folder the user cannot write to refuses a write, though its subfolders take one (#601)", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.appendFileSync(chapter, "\nNew words here.\n");
    const text = fs.readFileSync(chapter, "utf8");
    fs.chmodSync(root, 0o555);
    try {
      expect(withProjectLock(root, () => "ran")).toBe("ran");
      expect(invoke(root, ["wordcount"]).code).toBe(0);
      const result = invoke(root, ["wordcount", "--write"]);
      expect(result.code).toBe(4);
      expect(result.err).toContain(`Cannot create the project lock ${LOCK_FILE} (permission denied)`);
    } finally {
      fs.chmodSync(root, 0o755);
    }
    expect(fs.readFileSync(chapter, "utf8")).toBe(text);
  });

  test("the command waits for the lock before refusing, and a damaged lock counts as held", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, LOCK_FILE), "garbage\n");
    process.env.STORY_LOCK_WAIT_MS = "60";
    const started = Date.now();
    expect(() => addLocked(root, "Bo")).toThrow("another story command is modifying this project; nothing was changed");
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(fs.existsSync(path.join(root, "characters", "bo.md"))).toBe(false);
  });

  test("an unreadable lock counts as held", () => {
    const root = newProject();
    fs.mkdirSync(path.join(root, LOCK_FILE));
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(() => addLocked(root, "Bo")).toThrow("another story command is modifying this project");
  });

  test.skipIf(process.platform === "win32")("a symlinked lock counts as held rather than being followed (#548)", () => {
    const root = newProject();
    // Followed, this would read as a dead process's lock and be taken over.
    const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]).pid;
    const outside = path.join(makeTempDir(), "lock");
    fs.writeFileSync(outside, `${dead}\n${os.hostname()}\n${new Date().toISOString()}\n`);
    fs.symlinkSync(outside, path.join(root, LOCK_FILE));
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(() => addLocked(root, "Bo")).toThrow("another story command is modifying this project");
    expect(fs.lstatSync(path.join(root, LOCK_FILE)).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(root, "characters", "bo.md"))).toBe(false);
  });

  test.skipIf(process.platform === "win32")("a lock linked to /dev/zero refuses the write rather than hanging it (#548)", () => {
    const root = newProject();
    fs.symlinkSync("/dev/zero", path.join(root, LOCK_FILE));
    // In a child, so a read that never ends fails the test rather than
    // stalling the suite.
    const result = spawnSync(process.execPath, [path.join(import.meta.dir, "..", "bin", "story.js"), "add", "character", "Bo", "--path", root, "--json"], {
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, STORY_LOCK_WAIT_MS: "0" }
    });
    expect(result.signal).toBeNull();
    expect(result.status).toBe(4);
    expect(JSON.parse(result.stdout).diagnostics).toEqual([expect.objectContaining({ code: "write-refused", message: expect.stringContaining("another story command is modifying this project") })]);
  });

  test("a lock from another machine with no timestamp is not taken over", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, LOCK_FILE), "1\nsome-other-host\n");
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(() => addLocked(root, "Bo")).toThrow("another story command (process 1 on some-other-host) is modifying this project");
  });

  test("a fresh lock from another machine is left for the user to delete (#349)", () => {
    const root = newProject();
    // Dead here, so a pid check on this machine would take the lock. The
    // timestamp is what keeps a live command on another host.
    const dead = 2147483647;
    const written = new Date().toISOString();
    fs.writeFileSync(path.join(root, LOCK_FILE), `${dead}\nsome-other-host\n${written}\n`);
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(() => addLocked(root, "Bo")).toThrow(`another story command (process ${dead} on some-other-host) is modifying this project; nothing was changed. Run write commands one at a time. If no story command is running, delete ${LOCK_FILE}`);
    expect(fs.existsSync(path.join(root, "characters", "bo.md"))).toBe(false);
    expect(fs.readFileSync(path.join(root, LOCK_FILE), "utf8")).toBe(`${dead}\nsome-other-host\n${written}\n`);
  });

  test("a stale lock from another machine is taken over (#349)", () => {
    const root = newProject();
    // This process is alive. The other hostname and the old timestamp are
    // what make the lock stale.
    const written = new Date(Date.now() - FOREIGN_LOCK_STALE_MS - 1000).toISOString();
    const lockPath = path.join(root, LOCK_FILE);
    fs.writeFileSync(lockPath, `${process.pid}\nsome-other-host\n${written}\n`);
    fs.utimesSync(lockPath, new Date(written), new Date(written));
    process.env.STORY_LOCK_WAIT_MS = "0";
    addLocked(root, "Bo");
    expect(fs.existsSync(path.join(root, "characters", "bo.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, LOCK_FILE))).toBe(false);
  });

  test("a foreign lock with an old timestamp but a fresh file is not taken over", () => {
    // The other host's clock runs behind ours, so its fresh lock carries an
    // old timestamp. The file's modification time shows it is new.
    const root = newProject();
    const written = new Date(Date.now() - FOREIGN_LOCK_STALE_MS - 1000).toISOString();
    fs.writeFileSync(path.join(root, LOCK_FILE), `${process.pid}\nsome-other-host\n${written}\n`);
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(() => addLocked(root, "Bo")).toThrow(`another story command (process ${process.pid} on some-other-host) is modifying this project`);
    expect(fs.existsSync(path.join(root, LOCK_FILE))).toBe(true);
  });

  test("a lock another command takes before the stale one is removed is kept", () => {
    const root = newProject();
    const lockPath = path.join(root, LOCK_FILE);
    const guard = path.join(root, TAKEOVER_FILE);
    fs.writeFileSync(lockPath, "2147483647\n" + os.hostname() + "\n");
    // Another agent found the same stale lock, removed it, and took its own
    // just before this command took the takeover lock.
    const live = `${otherLivePid()}\n${os.hostname()}\n${new Date().toISOString()}\n`;
    const open = fs.openSync;
    const spy = spyOn(fs, "openSync").mockImplementation((file, ...rest) => {
      if (file === guard) {
        fs.writeFileSync(lockPath, live);
      }
      return open(file, ...rest);
    });
    process.env.STORY_LOCK_WAIT_MS = "0";
    try {
      expect(() => addLocked(root, "Bo")).toThrow(`another story command (process ${otherLivePid()}) is modifying this project`);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(lockPath, "utf8")).toBe(live);
    expect(fs.existsSync(guard)).toBe(false);
    expect(fs.existsSync(path.join(root, "characters", "bo.md"))).toBe(false);
  });

  test("a stale lock another command is taking over is left to it", () => {
    const root = newProject();
    const lockPath = path.join(root, LOCK_FILE);
    const guard = path.join(root, TAKEOVER_FILE);
    fs.writeFileSync(lockPath, "2147483647\n" + os.hostname() + "\n");
    fs.writeFileSync(guard, "1\nsome-other-host\n");
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(() => addLocked(root, "Bo")).toThrow("another story command (process 2147483647) is modifying this project");
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.existsSync(guard)).toBe(true);
  });

  test("a takeover lock that cannot be checked is left in place", () => {
    const root = newProject();
    const lockPath = path.join(root, LOCK_FILE);
    const guard = path.join(root, TAKEOVER_FILE);
    fs.writeFileSync(lockPath, "2147483647\n" + os.hostname() + "\n");
    fs.writeFileSync(guard, "1\nsome-other-host\n");
    fs.utimesSync(guard, new Date(0), new Date(0));
    const stat = fs.statSync;
    const spy = spyOn(fs, "statSync").mockImplementation((file, ...rest) => {
      if (file === guard) {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      }
      return stat(file, ...rest);
    });
    process.env.STORY_LOCK_WAIT_MS = "0";
    try {
      expect(() => addLocked(root, "Bo")).toThrow("another story command (process 2147483647) is modifying this project");
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(guard)).toBe(true);
  });

  test("a takeover lock left by a killed command is cleared, and the stale lock taken over", () => {
    const root = newProject();
    const lockPath = path.join(root, LOCK_FILE);
    const guard = path.join(root, TAKEOVER_FILE);
    fs.writeFileSync(lockPath, "2147483647\n" + os.hostname() + "\n");
    fs.writeFileSync(guard, "2147483647\n" + os.hostname() + "\n");
    const old = new Date(Date.now() - 60 * 1000);
    fs.utimesSync(guard, old, old);
    process.env.STORY_LOCK_WAIT_MS = "0";
    addLocked(root, "Bo");
    expect(fs.existsSync(path.join(root, "characters", "bo.md"))).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(guard)).toBe(false);
  });

  test("a command whose lock was taken over leaves the new owner's lock", () => {
    const root = newProject();
    const lockPath = path.join(root, LOCK_FILE);
    const other = `1\nsome-other-host\n${new Date().toISOString()}\n`;
    withProjectLock(root, () => {
      fs.writeFileSync(lockPath, other);
    });
    expect(fs.readFileSync(lockPath, "utf8")).toBe(other);
  });

  test("writeFile refuses when the file it read has been deleted", () => {
    const root = newProject();
    expect(() => writeFile(path.join(root, "gone.md"), "x\n", { root, unchangedFrom: "was here\n" })).toThrow("gone.md changed on disk");
    expect(fs.existsSync(path.join(root, "gone.md"))).toBe(false);
  });
});

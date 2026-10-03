import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { writeFile } from "../src/files.js";
import { FOREIGN_LOCK_STALE_MS, LOCK_FILE, TAKEOVER_FILE, withProjectLock } from "../src/lock.js";
import {
  createEntity,
  moveEntity,
  removeEntity,
  renameEntity,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, memoryIo, messages } from "./helpers.js";

const EXAMPLES = path.join(import.meta.dir, "..", "examples");
const isRoot = process.getuid?.() === 0;

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
    // This test process is alive, so its pid stands in for another command.
    fs.writeFileSync(path.join(root, LOCK_FILE), `${process.pid}\n${os.hostname()}\n`);
    process.env.STORY_LOCK_WAIT_MS = "0";
    const before = snapshot(root);
    const result = invoke(root, ["rename", "character", "ilya-venn", "Zed Quill"]);
    expect(result.code).toBe(4);
    expect(result.err).toContain(`another story command (process ${process.pid}) is modifying this project; nothing was changed`);
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

  test("nested write commands in one process do not wait on themselves, and the lock is released on failure", () => {
    const root = newProject();
    process.env.STORY_LOCK_WAIT_MS = "0";
    // add reindexes inside its own lock.
    createEntity(root, { kind: "character", name: "Ann" });
    const inner = withProjectLock(root, () => {
      expect(fs.existsSync(path.join(root, LOCK_FILE))).toBe(true);
      return createEntity(root, { kind: "character", name: "Bo" });
    });
    expect(inner.id).toBe("bo");
    expect(() => renameEntity(root, { kind: "character", id: "nobody", name: "X" })).toThrow("does not exist");
    expect(fs.existsSync(path.join(root, LOCK_FILE))).toBe(false);
  });

  test("two renames started together both finish without breaking references", () => {
    const root = copyExample("harbor-of-second-light");
    const bin = path.join(import.meta.dir, "..", "bin", "story.js");
    const script = `
      const { spawn } = require("node:child_process");
      const run = (args) => new Promise((resolve) => spawn(process.execPath, [${JSON.stringify(bin)}, ...args, "--path", ${JSON.stringify(root)}]).on("exit", resolve));
      Promise.all([run(["rename", "character", "theo-quill", "Theo Brand"]), run(["rename", "character", "ilya-venn", "Ilya Stone"])])
        .then((codes) => { console.log(codes.join(",")); });
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    expect(result.stdout.trim()).toBe("0,0");
    expect(fs.readdirSync(path.join(root, "characters")).sort()).toEqual(["_index.md", "ilya-stone.md", "mara-quill.md", "theo-brand.md"]);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });

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

describe("write preflight (#198)", () => {
  test.skipIf(isRoot)("rename refuses before any write when a file it must rewrite is read-only", () => {
    const root = copyExample("harbor-of-second-light");
    const arc = path.join(root, "plot", "arcs", "the-drowned-witness.md");
    fs.chmodSync(arc, 0o444);
    const before = snapshot(root);
    const result = invoke(root, ["rename", "character", "ilya-venn", "Zed Quill"]);
    expect(result.code).toBe(4);
    expect(result.err).toBe(`Cannot write to ${path.join("plot", "arcs", "the-drowned-witness.md")} (permission denied); nothing was changed. Fix it and run the command again\n`);
    expect(snapshot(root)).toEqual(before);
    fs.chmodSync(arc, 0o644);
    expect(invoke(root, ["rename", "character", "ilya-venn", "Zed Quill"]).code).toBe(0);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });

  test.skipIf(isRoot)("move and remove check the folders they write into", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "scene", name: "Opening", chapter: "chapter-01" });
    const scenes = path.join(root, "scenes");
    fs.chmodSync(scenes, 0o555);
    try {
      expect(() => moveEntity(root, { kind: "chapter", id: "chapter-01", number: 2 })).toThrow("Cannot write to scenes/ (permission denied); nothing was changed");
      expect(fs.existsSync(path.join(root, "chapters", "chapter-01.md"))).toBe(true);
      expect(() => removeEntity(root, { kind: "scene", id: "chapter-01-scene-01" })).toThrow("scenes/ (permission denied); nothing was changed");
    } finally {
      fs.chmodSync(scenes, 0o755);
    }
  });

  test("a write that fails partway says the same command finishes the job", () => {
    const root = copyExample("harbor-of-second-light");
    const original = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (String(to).endsWith("the-drowned-witness.md")) {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      }
      return original(from, to);
    };
    let result;
    try {
      result = invoke(root, ["rename", "character", "ilya-venn", "Zed Quill"]);
    } finally {
      fs.renameSync = original;
    }
    expect(result.code).toBe(4);
    expect(result.err).toContain("an input/output error. Some files were already updated: fix the problem and run the same command again to finish");
    expect(invoke(root, ["rename", "character", "ilya-venn", "Zed Quill"]).code).toBe(0);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });
});

describe("remove (#206, #103)", () => {
  test("remove scrubs references to an entity whose file is already gone", () => {
    const root = copyExample("the-unraveled-thread");
    fs.rmSync(path.join(root, "characters", "edran-vale.md"));
    expect(validateLinks(root).ok).toBe(false);
    const result = invoke(root, ["remove", "character", "edran-vale"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("Removed references to character edran-vale: its file was already gone\n");
    expect(messages(validateLinks(root).errors)).toEqual([]);
    // Nothing left: the id is now simply unknown.
    expect(invoke(root, ["remove", "character", "edran-vale"]).err).toBe("character edran-vale does not exist\n");
  });

  test("remove lists body references and exemption patterns it leaves behind", () => {
    const root = newProject();
    for (const argv of [["chapter", "One"], ["chapter", "Two"], ["arc", "Main"], ["character", "Bo"]]) {
      createEntity(root, { kind: argv[0], name: argv[1] });
    }
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), "\n| Day 1 | x | main | chapter-02 |\n");
    fs.appendFileSync(path.join(root, "plot", "arcs", "main.md"), "\nBeat: chapter-02. With [Bo](../../characters/bo.md).\n");
    fs.appendFileSync(path.join(root, "characters", "_index.md"), "\n## Notes\n\n- [Bo](bo.md)\n");
    fs.writeFileSync(path.join(root, "continuity", "exemptions.md"), "---\ntype: exemption-log\nstory: safety\nexemptions:\n  - pattern: \"chapters/chapter-02.md has POV bo\"\n    reason: \"On purpose\"\n---\n");

    const chapter = invoke(root, ["remove", "chapter", "chapter-02"]);
    expect(chapter.code).toBe(0);
    expect(chapter.err).toContain(`warning: ${path.join("plot", "arcs", "main.md")}, ${path.join("plot", "timeline.md")} still mention chapter chapter-02 in links or ids in the text, which remove does not change: edit them, then run story links`);
    expect(chapter.err).toContain(`warning: continuity/exemptions.md has an entry naming chapter-02 (exemptions[0]), which no longer matches anything: pattern "chapters/chapter-02.md has POV bo". Delete or update it`);

    const character = invoke(root, ["remove", "character", "bo"]);
    expect(character.code).toBe(0);
    expect(character.err).toContain(`warning: ${path.join("characters", "_index.md")}, ${path.join("plot", "arcs", "main.md")} still mention character bo in links in the text`);
  });

  test("a clean remove prints no warnings", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Bo" });
    const result = invoke(root, ["remove", "character", "bo"]);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
  });
});

describe("add warns about references to missing entities (#186)", () => {
  test("each unknown id is named, with the skipped backlink", () => {
    const root = newProject();
    createEntity(root, { kind: "location", name: "Gull Harbour" });
    const character = invoke(root, ["add", "character", "Ilse", "--location", "gul-harbour", "--arc", "redemption"]);
    expect(character.code).toBe(0);
    expect(character.err).toBe("warning: location gul-harbour (locations) does not exist, so no backlink was written; story links reports it until you add it [unknown-reference]\n");
    expect(invoke(root, ["add", "location", "X", "--character", "ghost-id"]).err).toContain("character ghost-id (notable-characters) does not exist, so no backlink was written");
    expect(invoke(root, ["add", "faction", "F", "--member", "ghost"]).err).toContain("character ghost (members) does not exist; story links reports it");
    expect(invoke(root, ["add", "artifact", "A", "--owner", "ghost"]).err).toContain("character or faction ghost (owner) does not exist");
    // Existing ids and future chapters are quiet.
    expect(invoke(root, ["add", "character", "Ann", "--location", "gull-harbour"]).err).toBe("");
    expect(invoke(root, ["add", "promise", "Oath", "--planted", "chapter-09"]).err).toBe("");
  });
});

describe("exemption patterns follow rename and move (#104)", () => {
  test("a renumbered chapter keeps its dismissal, and a renamed character's id follows", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Ann" });
    createEntity(root, { kind: "character", name: "Bo" });
    createEntity(root, { kind: "chapter", name: "One", pov: "ann" });
    createEntity(root, { kind: "scene", name: "S", pov: "bo" });
    createEntity(root, { kind: "chapter", name: "Two", pov: "ann", mention: "bo" });
    createEntity(root, { kind: "scene", name: "T", chapter: "chapter-02", character: "bo" });
    const exemptions = path.join(root, "continuity", "exemptions.md");
    fs.writeFileSync(exemptions, "---\ntype: exemption-log\nstory: safety\nexemptions:\n  - pattern: \"chapters/chapter-01.md has POV ann\"\n    reason: \"Bo narrates the prologue on purpose\"\n---\n");
    expect(invoke(root, ["continuity"]).err).toContain("dismissed: chapters/chapter-01.md has POV ann");

    moveEntity(root, { kind: "chapter", id: "chapter-02", number: 3 });
    moveEntity(root, { kind: "chapter", id: "chapter-01", number: 2 });
    moveEntity(root, { kind: "chapter", id: "chapter-03", number: 1 });
    let continuity = invoke(root, ["continuity"]);
    expect(continuity.err).toContain("dismissed: chapters/chapter-02.md has POV ann");
    expect(continuity.err).not.toContain("warning:");

    renameEntity(root, { kind: "character", id: "ann", name: "Anna" });
    expect(fs.readFileSync(exemptions, "utf8")).toContain("chapters/chapter-02.md has POV anna");
    expect(fs.readFileSync(exemptions, "utf8")).toContain("Bo narrates the prologue on purpose");
    continuity = invoke(root, ["continuity"]);
    expect(continuity.err).toContain("dismissed: chapters/chapter-02.md has POV anna");
    expect(continuity.err).not.toContain("warning:");
  });

  test("a moved scene's id follows in patterns", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "chapter", name: "Two" });
    createEntity(root, { kind: "scene", name: "S", chapter: "chapter-01" });
    const exemptions = path.join(root, "continuity", "exemptions.md");
    fs.writeFileSync(exemptions, "---\ntype: exemption-log\nstory: safety\nexemptions:\n  - pattern: \"scenes/chapter-01-scene-01.md is fine\"\n    reason: \"Checked\"\n---\n");
    moveEntity(root, { kind: "scene", id: "chapter-01-scene-01", chapter: "chapter-02" });
    expect(fs.readFileSync(exemptions, "utf8")).toContain("scenes/chapter-02-scene-01.md is fine");
  });
});

describe("damaged registries point at reindex (#199)", () => {
  test("validate and rename name story reindex for an emptied registry", () => {
    const root = copyExample("harbor-of-second-light");
    fs.writeFileSync(path.join(root, "characters", "_index.md"), "");
    expect(messages(validateProject(root).errors)).toContain(`${path.join("characters", "_index.md")}: is missing YAML frontmatter (it is a registry: run story reindex to rebuild it)`);
    expect(() => renameEntity(root, { kind: "character", id: "ilya-venn", name: "Zed Q" }))
      .toThrow(`${path.join("characters", "_index.md")} is missing YAML frontmatter (it is a registry: run story reindex to rebuild it); nothing was changed`);
    expect(invoke(root, ["reindex"]).code).toBe(0);
    expect(validateProject(root).ok).toBe(true);
  });

  test("a note outside the registries gets no reindex hint", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Bo" });
    fs.writeFileSync(path.join(root, "characters", "bo.md"), "# Bo\n");
    expect(() => renameEntity(root, { kind: "character", id: "bo", name: "Bob" })).toThrow(/^(?![\s\S]*reindex)/);
  });
});

describe("symlinked entity files (#63)", () => {
  test("validate warns about a symlinked chapter the scan skips", () => {
    const root = copyExample("the-last-ember");
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.renameSync(chapter, path.join(root, "..", "c1.md"));
    fs.symlinkSync(path.join("..", "..", "c1.md"), chapter);
    const result = invoke(root, ["validate"]);
    expect(result.err).toContain(`warning: ${path.join("chapters", "chapter-01.md")} is a symlink and is ignored: replace it with the file itself`);
  });
});

describe("lock edge cases", () => {
  test("a folder that is not a project, or does not exist, runs without a lock", () => {
    const dir = makeTempDir();
    expect(withProjectLock(dir, () => fs.existsSync(path.join(dir, LOCK_FILE)))).toBe(false);
    expect(withProjectLock(path.join(dir, "missing"), () => "ran")).toBe("ran");
  });

  test.skipIf(isRoot)("a project folder the user cannot write to runs without a lock", () => {
    const root = newProject();
    fs.chmodSync(root, 0o555);
    try {
      expect(withProjectLock(root, () => "ran")).toBe("ran");
    } finally {
      fs.chmodSync(root, 0o755);
    }
  });

  test("the command waits for the lock before refusing, and a damaged lock counts as held", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, LOCK_FILE), "garbage\n");
    process.env.STORY_LOCK_WAIT_MS = "60";
    const started = Date.now();
    expect(() => createEntity(root, { kind: "character", name: "Bo" })).toThrow("another story command is modifying this project; nothing was changed");
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(fs.existsSync(path.join(root, "characters", "bo.md"))).toBe(false);
  });

  test("an unreadable lock counts as held", () => {
    const root = newProject();
    fs.mkdirSync(path.join(root, LOCK_FILE));
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(() => createEntity(root, { kind: "character", name: "Bo" })).toThrow("another story command is modifying this project");
  });

  test("a lock from another machine with no timestamp is not taken over", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, LOCK_FILE), "1\nsome-other-host\n");
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(() => createEntity(root, { kind: "character", name: "Bo" })).toThrow("another story command (process 1 on some-other-host) is modifying this project");
  });

  test("a fresh lock from another machine is left for the user to delete (#349)", () => {
    const root = newProject();
    // Dead here, so a pid check on this machine would take the lock. The
    // timestamp is what keeps a live command on another host.
    const dead = 2147483647;
    const written = new Date().toISOString();
    fs.writeFileSync(path.join(root, LOCK_FILE), `${dead}\nsome-other-host\n${written}\n`);
    process.env.STORY_LOCK_WAIT_MS = "0";
    expect(() => createEntity(root, { kind: "character", name: "Bo" })).toThrow(`another story command (process ${dead} on some-other-host) is modifying this project; nothing was changed. Run write commands one at a time. If no story command is running, delete ${LOCK_FILE}`);
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
    createEntity(root, { kind: "character", name: "Bo" });
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
    expect(() => createEntity(root, { kind: "character", name: "Bo" })).toThrow(`another story command (process ${process.pid} on some-other-host) is modifying this project`);
    expect(fs.existsSync(path.join(root, LOCK_FILE))).toBe(true);
  });

  test("a lock another command takes before the stale one is removed is kept", () => {
    const root = newProject();
    const lockPath = path.join(root, LOCK_FILE);
    const guard = path.join(root, TAKEOVER_FILE);
    fs.writeFileSync(lockPath, "2147483647\n" + os.hostname() + "\n");
    // Another agent found the same stale lock, removed it, and took its own
    // just before this command took the takeover lock.
    const live = `${process.pid}\n${os.hostname()}\n${new Date().toISOString()}\n`;
    const open = fs.openSync;
    const spy = spyOn(fs, "openSync").mockImplementation((file, ...rest) => {
      if (file === guard) {
        fs.writeFileSync(lockPath, live);
      }
      return open(file, ...rest);
    });
    process.env.STORY_LOCK_WAIT_MS = "0";
    try {
      expect(() => createEntity(root, { kind: "character", name: "Bo" })).toThrow(`another story command (process ${process.pid}) is modifying this project`);
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
    expect(() => createEntity(root, { kind: "character", name: "Bo" })).toThrow("another story command (process 2147483647) is modifying this project");
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
      expect(() => createEntity(root, { kind: "character", name: "Bo" })).toThrow("another story command (process 2147483647) is modifying this project");
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
    createEntity(root, { kind: "character", name: "Bo" });
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

describe("exemption files rename cannot follow", () => {
  function projectWithExemptions(text) {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Ann" });
    fs.writeFileSync(path.join(root, "continuity", "exemptions.md"), text);
    return root;
  }

  test("an exemptions file without a list is left alone", () => {
    const text = "---\ntype: exemption-log\nexemptions: none\n---\n";
    const root = projectWithExemptions(text);
    renameEntity(root, { kind: "character", id: "ann", name: "Anna" });
    expect(fs.readFileSync(path.join(root, "continuity", "exemptions.md"), "utf8")).toBe(text);
  });

  test("entries that are not mappings are kept as they are", () => {
    const root = projectWithExemptions("---\ntype: exemption-log\nstory: safety\nexemptions:\n  - loose note\n  - pattern: \"POV ann here\"\n    reason: \"Fine\"\n---\n");
    renameEntity(root, { kind: "character", id: "ann", name: "Anna" });
    const text = fs.readFileSync(path.join(root, "continuity", "exemptions.md"), "utf8");
    expect(text).toContain("loose note");
    expect(text).toContain("POV anna here");
  });
});

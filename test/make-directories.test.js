import { describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { makeDirectories, nearestExistingAncestor, writeFile } from "../src/files.js";
import { createStoryProject } from "../src/story.js";
import { makeTempDir, memoryIo } from "./helpers.js";

const repoRoot = path.join(import.meta.dir, "..");
const BIN = path.join(repoRoot, "bin", "story.js");
const EXAMPLE = path.join(repoRoot, "examples", "the-last-ember");
const hasProc = fs.existsSync("/proc/self");

// Runs the CLI in a child process with a timeout, so a regression to an
// endless mkdir loop fails the test instead of hanging the run.
function runStory(args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: repoRoot, encoding: "utf8", timeout: 20000 });
}

function fsError(code) {
  return Object.assign(new Error(`${code}: stubbed`), { code });
}

// Replaces fs.mkdirSync for one call of `run`, restoring it afterwards.
function withMkdir(implementation, run) {
  const spy = spyOn(fs, "mkdirSync").mockImplementation(implementation);
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

describe("issue #279: creating output folders", () => {
  test.skipIf(!hasProc)("build --out under /proc exits 4 instead of hanging", () => {
    const result = runStory(["build", EXAMPLE, "--out", "/proc/story-279/x.md"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(4);
    expect(result.stderr).toContain("/proc/story-279");
  });

  test.skipIf(!hasProc)("init --dir under /proc exits 4 instead of hanging", () => {
    const result = runStory(["init", "--dir", "/proc/story-279", "Proc"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(4);
    expect(result.stderr).toContain("/proc/story-279");
  });

  test("a folder the file system will not create stops at that folder with a refused write", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "a", "b", "out.md");
    let error;
    withMkdir(() => {
      throw fsError("ENOENT");
    }, () => {
      try {
        writeFile(target, "text");
      } catch (caught) {
        error = caught;
      }
    });
    expect(error.message).toBe(`Cannot create directory ${path.join(dir, "a")}: ENOENT`);
    expect(error).toMatchObject({ code: "ENOENT", path: path.join(dir, "a"), syscall: "mkdir", exitCode: 4 });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("the CLI reports the folder it could not create and exits 4", () => {
    const root = createStoryProject({ cwd: makeTempDir(), title: "Stubbed" }).root;
    expect(runCli(["add", "chapter", "Opening"], memoryIo(root))).toBe(0);
    const io = memoryIo(root);
    const code = withMkdir(() => {
      throw fsError("ENOENT");
    }, () => runCli(["build", "--format", "markdown", "--out", "dist/deep/book.md"], io));
    expect(code).toBe(4);
    expect(io.error()).toContain(`Cannot create the folder dist: no such file or folder`);
  });

  test("a folder another process creates first counts as created", () => {
    const dir = makeTempDir();
    const real = fs.mkdirSync;
    withMkdir((directory) => {
      real(directory);
      throw fsError("EEXIST");
    }, () => writeFile(path.join(dir, "a", "b", "out.md"), "text"));
    expect(fs.readFileSync(path.join(dir, "a", "b", "out.md"), "utf8")).toBe("text");
  });

  test("a file another process creates in the folder's place is refused", () => {
    const dir = makeTempDir();
    withMkdir((directory) => {
      fs.writeFileSync(directory, "");
      throw fsError("EEXIST");
    }, () => {
      expect(() => makeDirectories(path.join(dir, "a", "b"))).toThrow(`Cannot create directory ${path.join(dir, "a")}: EEXIST`);
    });
  });

  test("a symlink another process creates in the folder's place is not followed", () => {
    const dir = makeTempDir();
    const elsewhere = makeTempDir();
    withMkdir((directory) => {
      fs.symlinkSync(elsewhere, directory);
      throw fsError("EEXIST");
    }, () => {
      expect(() => makeDirectories(path.join(dir, "a", "b"))).toThrow(`Cannot create directory ${path.join(dir, "a")}: EEXIST`);
    });
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  test("an error without a code is reported by its message", () => {
    const dir = makeTempDir();
    withMkdir(() => {
      throw new Error("strange failure");
    }, () => {
      expect(() => makeDirectories(path.join(dir, "a"))).toThrow(`Cannot create directory ${path.join(dir, "a")}: strange failure`);
    });
  });

  test("a file where the folder should be is refused", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "taken"), "");
    expect(() => makeDirectories(path.join(dir, "taken"))).toThrow(`Cannot create directory ${path.join(dir, "taken")}: ENOTDIR`);
    // Windows reports a file in the middle of the path as ENOENT.
    expect(() => writeFile(path.join(dir, "taken", "sub", "out.md"), "text")).toThrow(process.platform === "win32" ? "ENOENT" : "ENOTDIR");
  });

  test("an existing folder, or a symlink to one, needs nothing created", () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, "real"));
    fs.symlinkSync(path.join(dir, "real"), path.join(dir, "link"));
    const listing = fs.readdirSync(dir).sort();
    const mkdir = spyOn(fs, "mkdirSync").mockImplementation(() => {
      throw fsError("EACCES");
    });
    try {
      makeDirectories(dir);
      makeDirectories(path.join(dir, "link"));
      // Checked before the restore, which clears the spy's calls.
      expect(mkdir).not.toHaveBeenCalled();
    } finally {
      mkdir.mockRestore();
    }
    expect(fs.readdirSync(dir).sort()).toEqual(listing);
  });

  test("nearestExistingAncestor splits a path at its nearest existing ancestor", () => {
    const dir = makeTempDir();
    expect(nearestExistingAncestor(path.join(dir, "a", "b"))).toEqual({ ancestor: dir, missing: ["a", "b"] });
    expect(nearestExistingAncestor(dir)).toEqual({ ancestor: dir, missing: [] });
    expect(nearestExistingAncestor(path.parse(dir).root)).toEqual({ ancestor: path.parse(dir).root, missing: [] });
  });
});

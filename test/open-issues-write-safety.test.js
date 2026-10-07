import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import {
  createEntity,
  moveEntity,
  removeEntity,
  validateLinks
} from "../src/story.js";
import { CHMOD_IGNORED, makeTempDir, memoryIo, messages } from "./helpers.js";

const EXAMPLES = path.join(import.meta.dir, "..", "examples");

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

describe("write preflight (#198)", () => {
  test.skipIf(CHMOD_IGNORED)("rename refuses before any write when a file it must rewrite is read-only", () => {
    const root = copyExample("harbor-of-second-light");
    const arc = path.join(root, "plot", "arcs", "the-drowned-witness.md");
    fs.chmodSync(arc, 0o444);
    const before = snapshot(root);
    const result = invoke(root, ["rename", "character", "ilya-venn", "Zed Quill"]);
    expect(result.code).toBe(4);
    expect(result.err).toBe(`Cannot write to ${"plot/arcs/the-drowned-witness.md"} (permission denied); nothing was changed. Fix it and run the command again\n`);
    expect(snapshot(root)).toEqual(before);
    fs.chmodSync(arc, 0o644);
    expect(invoke(root, ["rename", "character", "ilya-venn", "Zed Quill"]).code).toBe(0);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });

  test.skipIf(CHMOD_IGNORED)("move and remove check the folders they write into", () => {
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
    expect(chapter.err).toContain(`warning: ${"plot/arcs/main.md"}, ${"plot/timeline.md"} still mention chapter chapter-02 in links or ids in the text, which remove does not change: edit them, then run story links`);
    expect(chapter.err).toContain(`warning: continuity/exemptions.md has an entry naming chapter-02 (exemptions[0]), which no longer matches anything: pattern "chapters/chapter-02.md has POV bo". Delete or update it`);

    const character = invoke(root, ["remove", "character", "bo"]);
    expect(character.code).toBe(0);
    expect(character.err).toContain(`warning: ${"characters/_index.md"}, ${"plot/arcs/main.md"} still mention character bo in links in the text`);
  });

  test("a clean remove prints no warnings", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Bo" });
    const result = invoke(root, ["remove", "character", "bo"]);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
  });
});

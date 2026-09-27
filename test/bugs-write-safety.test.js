import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { readTextFile } from "../src/files.js";
import {
  computeWordCounts,
  createEntity,
  createStoryProject,
  moveEntity,
  renameEntity,
  scanProject,
  validateLinks,
  validateProject,
  writeFile
} from "../src/story.js";
import { makeTempDir, memoryIo } from "./helpers.js";

const BIN = path.join(import.meta.dir, "..", "bin", "story.js");
const isRoot = process.getuid?.() === 0;

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function newProject(title = "Safety") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function listDir(root, dir) {
  return fs.readdirSync(path.join(root, dir)).sort();
}

// Makes fs.rmSync throw for the first path matching `pattern`, standing in
// for a process killed (or a delete refused) at that point.
function failingRemove(pattern, run) {
  const original = fs.rmSync;
  let failed = false;
  fs.rmSync = (target, ...rest) => {
    if (!failed && pattern.test(String(target))) {
      failed = true;
      throw Object.assign(new Error(`EBUSY: resource busy or locked, rm '${target}'`), { code: "EBUSY", syscall: "rm", path: target });
    }
    return original(target, ...rest);
  };
  try {
    expect(run).toThrow("EBUSY");
  } finally {
    fs.rmSync = original;
  }
}

function readOnly(file, run) {
  fs.chmodSync(file, 0o444);
  try {
    expect(run).toThrow();
  } finally {
    fs.chmodSync(file, 0o644);
  }
}

describe("atomic writes (#190, #197)", () => {
  test("a write that fails partway leaves the chapter whole and names it", () => {
    if (process.platform === "win32") {
      return;
    }
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.appendFileSync(chapter, `\n${"The tide came in over the harbour wall. ".repeat(200)}\n`);
    const before = fs.readFileSync(chapter, "utf8");
    expect(before.length).toBeGreaterThan(4096);
    // ulimit -f 4 makes any write past 4 KiB fail with EFBIG, as a full disk would.
    const result = spawnSync("bash", ["-c", `trap '' XFSZ; ulimit -f 4; "${process.execPath}" "${BIN}" wordcount --write`], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(4);
    expect(result.stderr).toContain(`Cannot write to ${path.join("chapters", "chapter-01.md")}: the file is too large`);
    expect(fs.readFileSync(chapter, "utf8")).toBe(before);
    expect(listDir(root, "chapters")).toEqual(["_index.md", "chapter-01.md"]);
  });

  test("writeFile replaces through a temporary file named after the target", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "chapter.md");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o640);
    const renames = [];
    const original = fs.renameSync;
    fs.renameSync = (from, to) => {
      renames.push([path.basename(from), path.basename(to)]);
      return original(from, to);
    };
    try {
      writeFile(target, "new");
    } finally {
      fs.renameSync = original;
    }
    expect(renames).toEqual([[`.chapter.md.story-${process.pid}.tmp`, "chapter.md"]]);
    expect(fs.readFileSync(target, "utf8")).toBe("new");
    expect(fs.statSync(target).mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(dir)).toEqual(["chapter.md"]);
  });

  test("a read-only file stays refused", () => {
    if (isRoot) {
      return;
    }
    const dir = makeTempDir();
    const target = path.join(dir, "chapter.md");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o444);
    expect(() => writeFile(target, "new")).toThrow("EACCES");
    expect(fs.readFileSync(target, "utf8")).toBe("old");
    expect(fs.readdirSync(dir)).toEqual(["chapter.md"]);
  });

  test("validate reports a temporary file left by an interrupted write", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.writeFileSync(path.join(root, "chapters", ".chapter-01.md.story-4242.tmp"), "partial");
    fs.writeFileSync(path.join(root, "chapters", ".story-687110.tmp"), "partial");
    const { warnings } = validateProject(root);
    expect(warnings).toContain(`${path.join("chapters", ".chapter-01.md.story-4242.tmp")} was left by an interrupted write to ${path.join("chapters", "chapter-01.md")}; delete it once the files beside it look right`);
    expect(warnings).toContain(`${path.join("chapters", ".story-687110.tmp")} was left by an interrupted write; delete it once the files beside it look right`);
  });
});

describe("invalid UTF-8 (#195)", () => {
  test("validate reports the file and write commands leave its bytes alone", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.appendFileSync(chapter, Buffer.from([0x0a, 0x93, 0x43, 0x61, 0x66, 0xe9, 0x94, 0x0a]));
    const bytes = fs.readFileSync(chapter);
    const offset = bytes.indexOf(0x93);
    const validation = invoke(root, ["validate"]);
    expect(validation.code).toBe(1);
    expect(validation.out + validation.err).toContain(`is not valid UTF-8 (byte 0x93 at offset ${offset}): re-save it as UTF-8`);
    expect(() => computeWordCounts(root, { write: true })).toThrow("is not valid UTF-8");
    expect(() => createEntity(root, { kind: "character", name: "Mara" })).toThrow("is not valid UTF-8");
    expect(fs.readFileSync(chapter).equals(bytes)).toBe(true);
  });

  test("valid UTF-8, a byte order mark, and a literal replacement character still read", () => {
    const file = path.join(makeTempDir(), "note.md");
    fs.writeFileSync(file, "﻿Café £5 �");
    expect(readTextFile(file)).toBe("﻿Café £5 �");
    fs.writeFileSync(file, Buffer.concat([Buffer.from("ok � "), Buffer.from([0xa3])]));
    expect(() => readTextFile(file)).toThrow("is not valid UTF-8 (byte 0xa3 at offset 7)");
  });
});

describe("interrupted rename (#181, #192)", () => {
  test("renaming a missing id onto an existing name is refused", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Bo" });
    createEntity(root, { kind: "chapter", name: "Two", mention: "ghost" });
    const chapter = read(root, "chapters/chapter-01.md");
    const result = invoke(root, ["rename", "character", "ghost", "Bo"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("character ghost does not exist");
    expect(read(root, "chapters/chapter-01.md")).toBe(chapter);
  });

  test("a rename killed before deleting the old file can be rerun", () => {
    const root = newProject();
    createEntity(root, { kind: "location", name: "Port" });
    createEntity(root, { kind: "character", name: "Ilya Venn", location: "port" });
    createEntity(root, { kind: "chapter", name: "One", character: "ilya-venn" });
    failingRemove(/ilya-venn\.md$/, () => renameEntity(root, { kind: "character", id: "ilya-venn", name: "Zed Quill" }));
    expect(listDir(root, "characters")).toEqual(["_index.md", "ilya-venn.md", "zed-quill.md"]);
    const rerun = invoke(root, ["rename", "character", "ilya-venn", "Zed Quill"]);
    expect(rerun.err).toBe("");
    expect(rerun.code).toBe(0);
    expect(listDir(root, "characters")).toEqual(["_index.md", "zed-quill.md"]);
    expect(validateLinks(root).errors).toEqual([]);
  });
});

describe("interrupted move (#191, #193, #194)", () => {
  function book() {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "character", name: "Edran" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: "mara" });
    createEntity(root, { kind: "chapter", name: "Two", number: 2, character: "mara" });
    createEntity(root, { kind: "chapter", name: "Three", number: 3, character: "mara" });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-01", character: "mara" });
    createEntity(root, { kind: "scene", name: "Mill", chapter: "chapter-02", character: "mara" });
    createEntity(root, { kind: "scene", name: "Extra", chapter: "chapter-02", character: "edran" });
    return root;
  }

  test("move chapter deletes its scenes before the chapter, so a rerun finishes", () => {
    const root = book();
    failingRemove(/chapters[\\/]chapter-01\.md$/, () => moveEntity(root, { kind: "chapter", id: "chapter-01", number: 5 }));
    // The old scene is already gone; the chapter is still there to rerun.
    expect(listDir(root, "scenes")).not.toContain("chapter-01-scene-01.md");
    expect(listDir(root, "chapters")).toContain("chapter-01.md");
    expect(moveEntity(root, { kind: "chapter", id: "chapter-01", number: 5 }).id).toBe("chapter-05");
    expect(listDir(root, "chapters")).toEqual(["_index.md", "chapter-02.md", "chapter-03.md", "chapter-05.md"]);
    expect(listDir(root, "scenes")).toEqual(["_index.md", "chapter-02-scene-01.md", "chapter-02-scene-02.md", "chapter-05-scene-01.md"]);
    expect(validateLinks(root).errors).toEqual([]);
  });

  test("move scene adds the cast before deleting the old scene, so a rerun finishes", () => {
    if (isRoot) {
      return;
    }
    const root = book();
    readOnly(path.join(root, "chapters", "chapter-03.md"), () => moveEntity(root, { kind: "scene", id: "chapter-02-scene-02", chapter: "chapter-03" }));
    expect(moveEntity(root, { kind: "scene", id: "chapter-02-scene-02", chapter: "chapter-03" }).id).toBe("chapter-03-scene-01");
    expect(listDir(root, "scenes")).toEqual(["_index.md", "chapter-01-scene-01.md", "chapter-02-scene-01.md", "chapter-03-scene-01.md"]);
    expect(scanProject(root).chapters.find((chapter) => chapter.id === "chapter-03").characters).toContain("edran");
  });

  test("rerunning move scene without --scene reuses the number the interrupted run took", () => {
    const root = book();
    failingRemove(/chapter-02-scene-02\.md$/, () => moveEntity(root, { kind: "scene", id: "chapter-02-scene-02", chapter: "chapter-01" }));
    expect(listDir(root, "scenes")).toContain("chapter-01-scene-02.md");
    const rerun = invoke(root, ["move", "scene", "chapter-02-scene-02", "--chapter", "chapter-01"]);
    expect(rerun.out).toContain("to chapter-01-scene-02");
    expect(listDir(root, "scenes")).toEqual(["_index.md", "chapter-01-scene-01.md", "chapter-01-scene-02.md", "chapter-02-scene-01.md"]);
    expect(validateLinks(root).errors).toEqual([]);
  });

  test("a move onto an identical placeholder is refused", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "TBD", number: 2 });
    createEntity(root, { kind: "chapter", name: "TBD", number: 5 });
    expect(() => moveEntity(root, { kind: "chapter", id: "chapter-02", number: 5 })).toThrow("chapter-05 already exists: move it first");
    createEntity(root, { kind: "scene", name: "Beat", chapter: "chapter-05" });
    createEntity(root, { kind: "scene", name: "Beat", chapter: "chapter-05" });
    expect(() => moveEntity(root, { kind: "scene", id: "chapter-05-scene-01", scene: 2 })).toThrow("chapter-05-scene-02 already exists");
    expect(listDir(root, "chapters")).toEqual(["_index.md", "chapter-02.md", "chapter-05.md"]);
    expect(listDir(root, "scenes")).toEqual(["_index.md", "chapter-05-scene-01.md", "chapter-05-scene-02.md"]);
  });
});

describe("interrupted add (#202)", () => {
  test("rerunning an add whose backlink step failed finishes it", () => {
    if (isRoot) {
      return;
    }
    const root = newProject();
    createEntity(root, { kind: "location", name: "Port Kestrel" });
    const location = path.join(root, "worldbuilding", "locations", "port-kestrel.md");
    readOnly(location, () => createEntity(root, { kind: "character", name: "Nia Holt", location: "port-kestrel" }));
    expect(fs.existsSync(path.join(root, "characters", "nia-holt.md"))).toBe(true);
    const rerun = invoke(root, ["add", "character", "Nia Holt", "--location", "port-kestrel"]);
    expect(rerun.out).toContain("Finished an interrupted add of character nia-holt");
    expect(validateLinks(root).errors).toEqual([]);
    // A finished add is listed in the registry, so adding it again is refused.
    expect(() => createEntity(root, { kind: "character", name: "Nia Holt", location: "port-kestrel" })).toThrow("already exists");
  });

  test("rerunning an unnumbered scene add does not create a second copy", () => {
    if (isRoot) {
      return;
    }
    const root = newProject();
    createEntity(root, { kind: "character", name: "Nessa" });
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "scene", name: "Opening", chapter: "chapter-01" });
    readOnly(path.join(root, "chapters", "chapter-01.md"), () => createEntity(root, { kind: "scene", name: "Extra Beat", chapter: "chapter-01", character: "nessa" }));
    expect(createEntity(root, { kind: "scene", name: "Extra Beat", chapter: "chapter-01", character: "nessa" })).toMatchObject({ id: "chapter-01-scene-02", resumed: true });
    expect(listDir(root, "scenes")).toEqual(["_index.md", "chapter-01-scene-01.md", "chapter-01-scene-02.md"]);
    expect(scanProject(root).chapters[0].characters).toContain("nessa");
    // Once finished, the same add is a new scene again.
    expect(createEntity(root, { kind: "scene", name: "Extra Beat", chapter: "chapter-01", character: "nessa" }).id).toBe("chapter-01-scene-03");
  });
});

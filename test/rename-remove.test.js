import { describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { UNDO_LOG } from "../src/files.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import {
  checkProjectContinuity,
  createEntity,
  createStoryProject,
  mergeChapters,
  moveEntity,
  reindexProject,
  removeEntity,
  renameEntity,
  scanProject,
  validateLinks,
  validateProject
} from "../src/story.js";
import { CHMOD_IGNORED, expectLinearGrowthFresh, makeTempDir, memoryIo, messages, whileWriting, writeMarkdown } from "./helpers.js";

function project(title) {
  return createStoryProject({ cwd: makeTempDir(), title, force: false }).root;
}

function read(root, ...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
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

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function newProject(title = "Refs") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function edit(root, relativePath, from, to) {
  const file = path.join(root, relativePath);
  const text = fs.readFileSync(file, "utf8");
  expect(text).toContain(from);
  fs.writeFileSync(file, text.replace(from, to));
}

function gapProject(title = "Gap Story") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function writeBaseChapter(root, number, fields = "", status = "draft") {
  writeMarkdown(path.join(root, "chapters", `chapter-${pad(number)}.md`), `
title: C${number}
number: ${number}
status: ${status}
${fields}
`, "## Chapter Text\n\nSome prose here.\n");
}

function writeState(root, lists, currentChapter = 5) {
  writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: base
current-chapter: ${currentChapter}
${lists}
`, "# Continuity State\n");
}

// Rewrites a character's status and adds frontmatter lines such as died-in.
function setCharacter(root, id, status, extra = "") {
  const file = path.join(root, "characters", `${id}.md`);
  const text = fs.readFileSync(file, "utf8").replace(/^(died-in|revived-in): .*\n/gm, "").replace(/^status: .*$/m, `status: ${status}${extra ? `\n${extra}` : ""}`);
  fs.writeFileSync(file, text, "utf8");
}

// Characters ann and bob, locations alpha..delta, artifact ring, and
// `chapters` drafted chapters with no fields.
function baseProject(chapters = 5) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Base", force: false });
  for (const name of ["Ann", "Bob"]) {
    createEntity(root, { kind: "character", name });
  }
  for (const name of ["Alpha", "Beta", "Gamma", "Delta"]) {
    createEntity(root, { kind: "location", name });
  }
  createEntity(root, { kind: "artifact", name: "Ring" });
  for (let number = 1; number <= chapters; number += 1) {
    writeBaseChapter(root, number);
  }
  writeState(root, "character-state: []\nobject-state: []\nknowledge-state: []", chapters);
  return root;
}

const EXAMPLES = path.join(import.meta.dir, "..", "examples");

function copyExample(name) {
  const root = path.join(makeTempDir(), name);
  fs.cpSync(path.join(EXAMPLES, name), root, { recursive: true });
  return root;
}

function initProject() {
  const cwd = makeTempDir();
  expect(invoke(cwd, ["init", "Safety", "--dir", "p"]).code).toBe(0);
  return path.join(cwd, "p");
}

function reviewProject(fields = "") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Fixes", force: false });
  if (fields !== "") {
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\n${fields}\n`), "utf8");
  }
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nWords.\n");
  return { root, cwd };
}

function safetyProject(title = "Safety") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function readProjectFile(root, file) {
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

function readOnly(file, run, message) {
  fs.chmodSync(file, 0o444);
  try {
    expect(run).toThrow(message);
  } finally {
    fs.chmodSync(file, 0o644);
  }
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("rename and remove reference rewriting", () => {
  test("rename rejects names that produce an empty id (findings 0, 12)", () => {
    const root = project("Empty Id");
    createEntity(root, { kind: "character", name: "Lord Maren" });
    createEntity(root, { kind: "artifact", name: "Crown", owner: "lord-maren" });
    const before = snapshot(root);

    expect(() => renameEntity(root, { kind: "character", id: "lord-maren", name: "???" })).toThrow("Cannot derive a kebab-case id");

    expect(snapshot(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, "characters", ".md"))).toBe(false);
  });

  test("scene rename keeps the {chapter}-scene-NN id and only updates the title (finding 3)", () => {
    const root = project("Scene Rename");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "scene", name: "Beat", chapter: "chapter-01", scene: 1 });

    const renamed = renameEntity(root, { kind: "scene", id: "chapter-01-scene-01", name: "The Arrival" });

    expect(renamed.id).toBe("chapter-01-scene-01");
    expect(fs.existsSync(path.join(root, "scenes", "the-arrival.md"))).toBe(false);
    expect(read(root, "scenes", "chapter-01-scene-01.md")).toContain("title: The Arrival");
  });

  test("a rename to the same name and id leaves the entity and chapter files unwritten (#726)", () => {
    const root = project("Same Name");
    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const entity = path.join(root, "characters", "mara-quill.md");
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.appendFileSync(chapter, "\nMara Quill waited.\n", "utf8");
    const old = new Date("2020-01-01T00:00:00Z");
    fs.utimesSync(entity, old, old);
    fs.utimesSync(chapter, old, old);
    // The rename reindexes, so the registries are current before the snapshot.
    reindexProject(root);
    const before = snapshot(root);

    renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Quill", prose: true });

    expect(fs.statSync(entity).mtimeMs).toBe(old.getTime());
    expect(fs.statSync(chapter).mtimeMs).toBe(old.getTime());
    expect(snapshot(root)).toEqual(before);
  });

  test("remove only clears fields that point at the removed kind (findings 1, 8)", () => {
    const root = project("Kind Remove");
    createEntity(root, { kind: "faction", name: "Marens Guard" });
    createEntity(root, { kind: "artifact", name: "Guard Seal", owner: "marens-guard" });
    createEntity(root, { kind: "location", name: "Marens Guard" });
    createEntity(root, { kind: "location", name: "Ashen Citadel" });
    createEntity(root, { kind: "character", name: "Lord Maren", location: "ashen-citadel" });
    createEntity(root, { kind: "term", name: "Ashen Citadel" });

    removeEntity(root, { kind: "location", id: "marens-guard" });
    expect(read(root, "worldbuilding", "artifacts", "guard-seal.md")).toContain("owner: marens-guard");

    removeEntity(root, { kind: "term", id: "ashen-citadel" });
    expect(read(root, "characters", "lord-maren.md")).toContain("locations:\n  - ashen-citadel");
  });

  test("rename rewrites fields and body links only for the renamed kind (findings 1, 8)", () => {
    const root = project("Kind Rename");
    createEntity(root, { kind: "faction", name: "Marens Guard" });
    createEntity(root, { kind: "location", name: "Marens Guard" });
    createEntity(root, { kind: "artifact", name: "Guard Seal", owner: "marens-guard", location: "marens-guard" });
    const sealPath = path.join(root, "worldbuilding", "artifacts", "guard-seal.md");
    fs.appendFileSync(sealPath, "[marens-guard](../factions/marens-guard.md) and [marens-guard](../locations/marens-guard.md)\n", "utf8");

    renameEntity(root, { kind: "location", id: "marens-guard", name: "Guard Keep" });

    const seal = fs.readFileSync(sealPath, "utf8");
    expect(seal).toContain("owner: marens-guard");
    expect(seal).toContain("location: guard-keep");
    expect(seal).toContain("[marens-guard](../factions/marens-guard.md) and [guard-keep](../locations/guard-keep.md)");
  });

  test("owner references are left alone when a character and faction share the id", () => {
    const root = project("Ambiguous Owner");
    createEntity(root, { kind: "faction", name: "Vale" });
    // add refuses the shared id (#176), but a hand-made project may have one.
    expect(() => createEntity(root, { kind: "character", name: "Vale" })).toThrow("vale is already a faction id");
    writeMarkdown(path.join(root, "characters", "vale.md"), "name: Vale\nrole: supporting\nstatus: alive", "\n# Vale\n");
    createEntity(root, { kind: "artifact", name: "Ring", owner: "vale" });

    createEntity(root, { kind: "location", name: "Keep", "controlled-by": "vale" });

    const result = renameEntity(root, { kind: "character", id: "vale", name: "Vale Two" });

    expect(read(root, "worldbuilding", "artifacts", "ring.md")).toContain("owner: vale");
    expect(read(root, "worldbuilding", "locations", "keep.md")).toContain("controlled-by: vale");
    // ...but not silently, and each file lists the fields it uses (#579).
    expect(result.warnings).toEqual([{
      code: "ambiguous-references",
      message: "references to vale in worldbuilding/artifacts/ring.md (owner), worldbuilding/locations/keep.md (controlled-by) could mean the character or faction vale, and rename left them alone, so they now name the faction: change any that meant the character to vale-two",
      file: null,
      chapter: null
    }]);
  });

  test("remove clears nested fields but keeps continuity entries unless the entry is about the removed entity (findings 2, 7)", () => {
    const root = project("Nested Remove");
    createEntity(root, { kind: "location", name: "Port" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "character", name: "Ilya" });
    createEntity(root, { kind: "artifact", name: "Lantern" });
    writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
character-state:
  - character: mara
    location: port
    physical: wounded shoulder
  - character: ilya
    location: port
    physical: unharmed
object-state:
  - artifact: lantern
    owner: mara
    location: port
    status: hidden
knowledge-state:
  - character: mara
    knows: the archive was active
    learned-in: chapter-01
`, "# Continuity State\n");

    removeEntity(root, { kind: "location", id: "port" });
    let state = read(root, "continuity", "state.md");
    expect(state).toContain("  - character: mara\n    location: \"\"\n    physical: wounded shoulder");
    expect(state).toContain("  - artifact: lantern\n    owner: mara\n    location: \"\"");

    // learned-in: "" would mean "before the story", so the remove is refused (#163).
    expect(() => removeEntity(root, { kind: "chapter", id: "chapter-01" })).toThrow("still named by");
    state = read(root, "continuity", "state.md");
    expect(state).toContain("knows: the archive was active");

    removeEntity(root, { kind: "character", id: "mara" });
    state = read(root, "continuity", "state.md");
    expect(state).not.toContain("character: mara");
    expect(state).not.toContain("wounded shoulder");
    expect(state).toContain("character: ilya");
    expect(state).toContain("  - artifact: lantern\n    owner: \"\"");
    expect(state).toContain("knowledge-state: []");

    removeEntity(root, { kind: "artifact", id: "lantern" });
    expect(read(root, "continuity", "state.md")).toContain("object-state: []");
  });

  test("rename and remove skip the frontmatter of a note outside the project model they cannot parse (finding 10, #62)", () => {
    const root = project("Parse Abort");
    createEntity(root, { kind: "character", name: "Lord Maren" });
    createEntity(root, { kind: "location", name: "Citadel", character: "lord-maren" });
    createEntity(root, { kind: "artifact", name: "Crown", owner: "lord-maren" });
    fs.mkdirSync(path.join(root, "notes"));
    fs.writeFileSync(path.join(root, "notes", "aaa.md"), "---\nmeta:\n  nested: yes\n---\n", "utf8");
    const note = read(root, "notes", "aaa.md");

    renameEntity(root, { kind: "character", id: "lord-maren", name: "Maren Two" });
    removeEntity(root, { kind: "character", id: "maren-two" });
    expect(read(root, "notes", "aaa.md")).toBe(note);
  });

  test("rename rewrites links in markdown files without frontmatter (finding 14)", () => {
    const root = project("No Frontmatter Links");
    createEntity(root, { kind: "character", name: "Lord Maren" });
    fs.mkdirSync(path.join(root, "notes"));
    const planPath = path.join(root, "notes", "plan.md");
    fs.writeFileSync(planPath, "# Plan\n\nSee [Maren](../characters/lord-maren.md) and [lord-maren](/characters/lord-maren.md#bio).\n[web](https://example.com/lord-maren.md) [top](#lord-maren) [bad](%E0%A4%A.md)\n", "utf8");

    renameEntity(root, { kind: "character", id: "lord-maren", name: "Maren Two" });

    expect(fs.readFileSync(planPath, "utf8")).toBe("# Plan\n\nSee [Maren](../characters/maren-two.md) and [maren-two](/characters/maren-two.md#bio).\n[web](https://example.com/lord-maren.md) [top](#lord-maren) [bad](%E0%A4%A.md)\n");
  });
});

// An editor saves a file after the command read it: the command must not
// delete or replace the save (#547).
describe("edits saved while rename, remove, or move runs", () => {
  // Runs `command` while `save` replaces `file` at the moment `written` is
  // written, and returns the error the command threw.
  function withSave(written, file, command) {
    const saved = `${fs.readFileSync(file, "utf8")}\nSaved meanwhile.\n`;
    const spy = whileWriting(written, () => fs.writeFileSync(file, saved));
    try {
      command();
    } catch (error) {
      return { error, saved };
    } finally {
      spy.mockRestore();
    }
    throw new Error("the command did not stop");
  }

  test("rename keeps the old file when it is saved meanwhile, and a rerun takes the save along", () => {
    const root = project("Saved Rename");
    createEntity(root, { kind: "character", name: "Ann" });
    const oldFile = path.join(root, "characters", "ann.md");
    const newFile = path.join(root, "characters", "anna.md");
    const { error, saved } = withSave(newFile, oldFile, () => renameEntity(root, { kind: "character", id: "ann", name: "Anna" }));
    expect(error.message).toBe("characters/ann.md changed on disk while story was deleting it, so it was left as it is, and the copy written at characters/anna.md was removed");
    expect(error.hint).toBe("Run the same command again to finish with the change");
    expect(error.exitCode).toBe(4);
    expect(fs.readFileSync(oldFile, "utf8")).toBe(saved);
    // The copy made from the text before the save is gone.
    expect(fs.existsSync(newFile)).toBe(false);
    renameEntity(root, { kind: "character", id: "ann", name: "Anna" });
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(read(root, "characters", "anna.md")).toContain("Saved meanwhile.");
  });

  test("remove keeps the entity file when it is saved meanwhile", () => {
    const root = project("Saved Remove");
    createEntity(root, { kind: "faction", name: "Guard" });
    createEntity(root, { kind: "artifact", name: "Seal", owner: "guard" });
    const file = path.join(root, "worldbuilding", "factions", "guard.md");
    const { error, saved } = withSave(path.join(root, "worldbuilding", "artifacts", "seal.md"), file, () => removeEntity(root, { kind: "faction", id: "guard" }));
    expect(error.message).toBe("worldbuilding/factions/guard.md changed on disk while story was deleting it, so it was left as it is");
    expect(error.hint).toBe("Some files were already updated: fix the problem and run the same command again to finish");
    expect(fs.readFileSync(file, "utf8")).toBe(saved);
    removeEntity(root, { kind: "faction", id: "guard" });
    expect(fs.existsSync(file)).toBe(false);
  });

  test("move keeps the chapter when it is saved meanwhile, and a rerun takes the save along", () => {
    const root = project("Saved Move");
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "scene", name: "Opening", chapter: "chapter-01" });
    const oldFile = path.join(root, "chapters", "chapter-01.md");
    const newFile = path.join(root, "chapters", "chapter-03.md");
    const { error, saved } = withSave(newFile, oldFile, () => moveEntity(root, { kind: "chapter", id: "chapter-01", number: "3" }));
    expect(error.message).toBe("chapters/chapter-01.md changed on disk while story was deleting it, so it was left as it is, and the copy written at chapters/chapter-03.md was removed");
    expect(error.hint).toBe("Run the same command again to finish with the change");
    expect(fs.readFileSync(oldFile, "utf8")).toBe(saved);
    expect(fs.existsSync(newFile)).toBe(false);
    moveEntity(root, { kind: "chapter", id: "chapter-01", number: "3" });
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(read(root, "chapters", "chapter-03.md")).toContain("Saved meanwhile.");
    expect(fs.readdirSync(path.join(root, "scenes")).sort()).toEqual(["_index.md", "chapter-03-scene-01.md"]);
  });

  test("move keeps a save made while it planned, after it read the chapter", () => {
    const root = project("Planned Move");
    createEntity(root, { kind: "chapter", name: "One" });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    const saved = `${read(root, "chapters", "chapter-01.md")}\nSaved meanwhile.\n`;
    // The scan reads the chapter, then move reads it for its frontmatter;
    // the save lands as the reference plan reads its first other file.
    const open = fs.openSync;
    let reads = 0;
    let pending = true;
    const spy = spyOn(fs, "openSync").mockImplementation((file, flags, ...rest) => {
      if (flags !== "wx" && file === chapter) {
        reads += 1;
      } else if (flags !== "wx" && reads === 2 && pending && String(file).endsWith(".md")) {
        pending = false;
        fs.writeFileSync(chapter, saved);
      }
      return open(file, flags, ...rest);
    });
    try {
      expect(() => moveEntity(root, { kind: "chapter", id: "chapter-01", number: "2" })).toThrow("chapters/chapter-01.md changed on disk while story was deleting it, so it was left as it is");
    } finally {
      spy.mockRestore();
    }
    expect(pending).toBe(false);
    expect(fs.readFileSync(chapter, "utf8")).toBe(saved);
    expect(fs.existsSync(path.join(root, "chapters", "chapter-02.md"))).toBe(false);
  });

  test("move never replaces a file made at the new path meanwhile", () => {
    const root = project("Taken Move");
    createEntity(root, { kind: "chapter", name: "One" });
    const newFile = path.join(root, "chapters", "chapter-02.md");
    const spy = whileWriting(newFile, () => fs.writeFileSync(newFile, "Mine.\n"));
    try {
      expect(() => moveEntity(root, { kind: "chapter", id: "chapter-01", number: "2" })).toThrow("chapters/chapter-02.md changed on disk while story was updating it, so it was left as it is");
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(newFile, "utf8")).toBe("Mine.\n");
    expect(fs.existsSync(path.join(root, "chapters", "chapter-01.md"))).toBe(true);
  });
});

describe("interrupted renames and ids two kinds share (#579)", () => {
  const MARKER = ".story-rename.tmp";

  // Runs a rename that is killed once it has deleted the old file, at the
  // first write to `target` (a registry the reindex rewrites) or, for the
  // marker, at its delete. Its undo log has a rerun put the rename back and
  // make it again (#604), so the project keeps a copy with the log, which
  // is returned, and loses the log itself, as a story from before the log
  // left it: then the marker resumes the rename.
  function killedAfterDelete(oldFile, target, run) {
    const { renameSync, rmSync } = fs;
    const kill = (file) => {
      if (!fs.existsSync(oldFile) && path.resolve(String(file)) === target) {
        throw new Error("killed");
      }
    };
    fs.renameSync = (from, to) => {
      kill(to);
      return renameSync(from, to);
    };
    fs.rmSync = (file, options) => {
      kill(file);
      return rmSync(file, options);
    };
    try {
      expect(run).toThrow("killed");
    } finally {
      fs.renameSync = renameSync;
      fs.rmSync = rmSync;
    }
    const root = path.resolve(oldFile, "..", "..");
    const logged = path.join(makeTempDir(), "logged");
    fs.cpSync(root, logged, { recursive: true });
    fs.rmSync(path.join(root, UNDO_LOG));
    return logged;
  }

  test("rename refuses an id that never existed, though an entity has the new name", () => {
    const root = project("No Such Person");
    // Indexed as Sera, then renamed by hand, so its registry row is stale.
    writeMarkdown(path.join(root, "characters", "sera-voss.md"), "name: Sera\nrole: supporting\nstatus: alive", "# Sera\n");
    reindexProject(root);
    const file = path.join(root, "characters", "sera-voss.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("name: Sera", "name: Sera Voss"));
    const before = snapshot(root);
    const rename = () => renameEntity(root, { kind: "character", id: "no-such-person", name: "Sera Voss" });
    expect(rename).toThrow("character no-such-person does not exist");
    // A marker for another rename, or one that does not parse, is no evidence.
    fs.writeFileSync(path.join(root, MARKER), JSON.stringify({ kind: "character", id: "someone-else", newId: "sera-voss", name: "Sera Voss" }));
    expect(rename).toThrow("character no-such-person does not exist");
    fs.writeFileSync(path.join(root, MARKER), "{");
    expect(rename).toThrow("character no-such-person does not exist");
    fs.rmSync(path.join(root, MARKER));
    expect(snapshot(root)).toEqual(before);
  });

  test("a rename killed at any write after deleting the old file is finished by a rerun, once", () => {
    for (const target of [["characters", "_index.md"], ["chapters", "_index.md"], [MARKER]]) {
      const root = project("Stopped Rename");
      createEntity(root, { kind: "character", name: "Mara Quill" });
      createEntity(root, { kind: "chapter", name: "One", number: 1, character: "mara-quill", pov: "mara-quill" });
      const rename = (at = root) => renameEntity(at, { kind: "character", id: "mara-quill", name: "Mara Tide" });
      const logged = killedAfterDelete(path.join(root, "characters", "mara-quill.md"), path.join(root, ...target), rename);
      expect(fs.existsSync(path.join(root, MARKER))).toBe(true);

      for (const [at, finished] of [[root, { resumed: true }], [logged, { undone: { command: "story rename character mara-quill 'Mara Tide'" } }]]) {
        expect(rename(at)).toMatchObject({ id: "mara-tide", ...finished, warnings: [] });
        expect(read(at, "characters", "_index.md")).toContain("| Mara Tide | supporting | alive | [mara-tide](mara-tide.md) |");
        expect(read(at, "chapters", "_index.md")).toContain("| 1 | One | mara-tide |");
        expect(fs.existsSync(path.join(at, MARKER))).toBe(false);
        expect(fs.existsSync(path.join(at, UNDO_LOG))).toBe(false);
        // Finished, so a rerun is refused.
        expect(() => rename(at)).toThrow("character mara-quill does not exist");
      }
    }
  });

  test("an id-only rename and a rename of a file no reindex listed resume too", () => {
    const root = project("Id Only");
    createEntity(root, { kind: "character", name: "Mara Quill" });
    // The name does not change, so the reindex has nothing to rewrite.
    const idOnly = (at = root) => renameEntity(at, { kind: "character", id: "mara-quill", name: "Mara Quill", newId: "mara" });
    const idOnlyLogged = killedAfterDelete(path.join(root, "characters", "mara-quill.md"), path.join(root, MARKER), idOnly);
    expect(idOnly()).toMatchObject({ id: "mara", resumed: true });
    expect(idOnly).toThrow("character mara-quill does not exist");
    expect(idOnly(idOnlyLogged)).toMatchObject({ id: "mara", undone: { command: "story rename character mara-quill 'Mara Quill' --id mara" } });
    expect(() => idOnly(idOnlyLogged)).toThrow("character mara-quill does not exist");

    writeMarkdown(path.join(root, "characters", "ilse.md"), "name: Ilse\nrole: supporting\nstatus: alive", "# Ilse\n");
    const unlisted = (at = root) => renameEntity(at, { kind: "character", id: "ilse", name: "Ilse Varrow" });
    const unlistedLogged = killedAfterDelete(path.join(root, "characters", "ilse.md"), path.join(root, "characters", "_index.md"), unlisted);
    expect(read(root, "characters", "_index.md")).not.toContain("ilse");
    expect(unlisted()).toMatchObject({ id: "ilse-varrow", resumed: true });
    expect(unlisted(unlistedLogged)).toMatchObject({ id: "ilse-varrow", undone: { command: "story rename character ilse 'Ilse Varrow'" } });
    for (const at of [root, unlistedLogged]) {
      expect(read(at, "characters", "_index.md")).toContain("| Ilse Varrow | supporting | alive | [ilse-varrow](ilse-varrow.md) |");
    }
  });

  test("rename and remove say which mentions they left on an id a character and an artifact share", () => {
    const root = project("Shared Mentions");
    const handMade = () => writeMarkdown(path.join(root, "characters", "blackened-crown.md"), "name: Blackened Crown\nrole: supporting\nstatus: alive", "# Blackened Crown\n");
    const left = (action, fix) => `references to blackened-crown in chapters/chapter-01.md (mentions) could mean the character or artifact blackened-crown, and ${action} left them alone, so they now name the artifact: ${fix}`;
    createEntity(root, { kind: "artifact", name: "Blackened Crown" });
    handMade();
    // Nothing references the shared id yet, so there is nothing to warn about.
    expect(renameEntity(root, { kind: "character", id: "blackened-crown", name: "Crown Knight" }).warnings).toEqual([]);

    handMade();
    createEntity(root, { kind: "chapter", name: "One", number: 1, mention: "blackened-crown" });
    const renamed = renameEntity(root, { kind: "character", id: "blackened-crown", name: "Black Knight" });
    expect(read(root, "chapters", "chapter-01.md")).toContain("mentions:\n  - blackened-crown\n");
    expect(renamed.warnings).toEqual([{
      code: "ambiguous-references",
      message: left("rename", "change any that meant the character to black-knight"),
      file: "chapters/chapter-01.md",
      chapter: null
    }]);

    // A resumed rename gives the warning the killed run never printed, as
    // does one its undo log puts back and makes again.
    handMade();
    const rename = (at = root) => renameEntity(at, { kind: "character", id: "blackened-crown", name: "Dark Knight" });
    const logged = killedAfterDelete(path.join(root, "characters", "blackened-crown.md"), path.join(root, MARKER), rename);
    const warning = { code: "ambiguous-references", message: left("rename", "change any that meant the character to dark-knight") };
    expect(rename()).toMatchObject({ resumed: true, warnings: [warning] });
    expect(rename(logged)).toMatchObject({ undone: { command: "story rename character blackened-crown 'Dark Knight'" }, warnings: [warning] });

    handMade();
    const removed = removeEntity(root, { kind: "character", id: "blackened-crown" });
    expect(read(root, "chapters", "chapter-01.md")).toContain("mentions:\n  - blackened-crown\n");
    expect(removed.warnings.filter((finding) => finding.code === "ambiguous-references").map((finding) => finding.message)).toEqual([
      left("remove", "delete any that meant the character")
    ]);
  });

  test("an unquoted number id counts as the same id", () => {
    const root = project("Number Ids");
    writeMarkdown(path.join(root, "worldbuilding", "factions", "1984.md"), "name: \"1984\"\ntype: political\nstatus: active", "# 1984\n");
    writeMarkdown(path.join(root, "characters", "1984.md"), "name: \"1984\"\nrole: supporting\nstatus: alive", "# 1984\n");
    writeMarkdown(path.join(root, "worldbuilding", "artifacts", "ring.md"), "name: Ring\ntype: other\nstatus: intact\nowner: 1984", "# Ring\n");
    reindexProject(root);

    const result = renameEntity(root, { kind: "character", id: "1984", name: "Orwell" });
    expect(read(root, "worldbuilding", "artifacts", "ring.md")).toContain("owner: 1984");
    expect(result.warnings.map((finding) => finding.message)).toEqual([
      "references to 1984 in worldbuilding/artifacts/ring.md (owner) could mean the character or faction 1984, and rename left them alone, so they now name the faction: change any that meant the character to orwell"
    ]);
  });
});

describe("saved story.md queries follow rename, move, and merge, and remove reports them (#532)", () => {
  function withQueries(root, lines) {
    const file = path.join(root, "story.md");
    const text = fs.readFileSync(file, "utf8");
    const end = text.indexOf("\n---\n", 4);
    fs.writeFileSync(file, `${text.slice(0, end)}\n${["queries:", ...lines].join("\n")}${text.slice(end)}`, "utf8");
  }
  const where = (root) => parseFrontmatter(read(root, "story.md")).data.queries.map((query) => query.where);

  test("rename points each filter that names the old id at the new one, and leaves the rest as written", () => {
    const root = project("Query Rename");
    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "character", name: "Ilse Marrow" });
    withQueries(root, [
      "  - name: mara-drafts",
      "    kind: chapters",
      "    where: [status=draft, \" pov = mara-quill \", characters!=mara-quill, mara-quill, title=mara-quill]",
      "  - name: ilse",
      "    kind: scenes",
      "    where: [pov=ilse-marrow]",
      "  - name: unfinished",
      "    kind: scenes"
    ]);
    renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Vale" });
    expect(where(root)).toEqual([
      ["status=draft", " pov = mara-vale ", "characters!=mara-vale", "mara-quill", "title=mara-quill"],
      ["pov=ilse-marrow"],
      undefined
    ]);
    expect(validateProject(root).errors.map((error) => error.message)).toEqual(["story.md query unfinished is missing where"]);
  });

  test("move and merge point chapter filters at the chapter's new id", () => {
    const root = project("Query Move");
    for (const number of [1, 2, 3]) {
      createEntity(root, { kind: "chapter", name: `Chapter ${number}`, number });
    }
    withQueries(root, ["  - name: opening", "    kind: scenes", "    where: [chapter=chapter-01]", "  - name: middle", "    kind: scenes", "    where: [chapter=chapter-03]"]);
    moveEntity(root, { kind: "chapter", id: "chapter-01", number: 4 });
    expect(where(root)).toEqual([["chapter=chapter-04"], ["chapter=chapter-03"]]);
    mergeChapters(root, { id: "chapter-03", next: "chapter-04" });
    expect(where(root)).toEqual([["chapter=chapter-03"], ["chapter=chapter-03"]]);
  });

  test("remove leaves the filters that name the removed id and lists them (stale-query)", () => {
    const root = project("Query Remove");
    createEntity(root, { kind: "character", name: "Mara Quill" });
    withQueries(root, [
      "  - name: mara-drafts",
      "    kind: chapters",
      "    where: [status=draft, pov=mara-quill]",
      "  - name: without-mara",
      "    kind: scenes",
      "    where: [\"characters != mara-quill\", pov=mara-quill]",
      "  - name: unrelated",
      "    kind: scenes",
      "    where: [pov]"
    ]);
    const before = read(root, "story.md");
    const removed = removeEntity(root, { kind: "character", id: "mara-quill" });
    expect(read(root, "story.md")).toBe(before);
    expect(removed.warnings.filter((warning) => warning.code === "stale-query").map((warning) => [warning.message, warning.file])).toEqual([[
      "story.md queries mara-drafts (pov=mara-quill), without-mara (characters!=mara-quill, pov=mara-quill) still filter on character mara-quill, which remove does not change: update or delete those filters",
      "story.md"
    ]]);
  });
});

describe("reference handling in add, rename, remove, and move", () => {
  test("#62 unmanaged notes with unsupported YAML, oversized, or past the file cap do not block rename or move", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Kael Voss" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.mkdirSync(path.join(root, "notes"));
    fs.writeFileSync(path.join(root, "notes", "ideas.md"), "---\ntags:\n- idea\n---\n\nSee [Kael](../characters/kael-voss.md).\n");
    fs.writeFileSync(path.join(root, "notes", "dump.md"), `# Dump\n\n${"lorem ipsum ".repeat(500000)}`);

    renameEntity(root, { kind: "character", id: "kael-voss", name: "Kael Storm" });
    expect(read(root, "notes", "ideas.md")).toBe("---\ntags:\n- idea\n---\n\nSee [Kael](../characters/kael-storm.md).\n");
    expect(moveEntity(root, { kind: "chapter", id: "chapter-01", number: 2 }).id).toBe("chapter-02");

    // A broken entity file still aborts with nothing changed.
    writeMarkdown(path.join(root, "worldbuilding", "artifacts", "odd.md"), "name: Odd\nmeta:\n  nested: yes");
    expect(() => renameEntity(root, { kind: "character", id: "kael-storm", name: "Kael Three" })).toThrow("Cannot rename: fix this file first (story validate reports it):\n- worldbuilding/artifacts/odd.md: Unsupported frontmatter line: nested: yes (line 4)");
    expect(fs.existsSync(path.join(root, "characters", "kael-storm.md"))).toBe(true);
  });

  test("#67 move chapter and rename warn when the new id is already referenced", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "chapter", name: "Two" });
    createEntity(root, { kind: "promise", name: "Gun", planted: "chapter-01", payoff: "chapter-05" });
    const moved = invoke(root, ["move", "chapter", "chapter-02", "--number", "5"]);
    expect(moved.code).toBe(0);
    expect(moved.err).toContain("warning: chapter-05 was already referenced before this move, and those references now point at the moved chapter: continuity/promises/gun.md");
    // A move onto an unreferenced number says nothing.
    expect(invoke(root, ["move", "chapter", "chapter-05", "--number", "3"]).err).toBe("");

    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "chapter", name: "Four", character: "mara", mention: "bo" });
    const renamed = invoke(root, ["rename", "character", "mara", "Bo"]);
    expect(renamed.code).toBe(0);
    expect(renamed.err).toContain("warning: bo was already referenced before this rename, and those references now point at the renamed character: chapters/chapter-04.md");

    createEntity(root, { kind: "scene", name: "A", chapter: "chapter-01" });
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), "\n- chapter-03-scene-01 left over\n");
    expect(messages(moveEntity(root, { kind: "scene", id: "chapter-01-scene-01", chapter: "chapter-03" }).warnings).join("\n")).toContain("plot/timeline.md");
  });

  test("#69 rename and remove artifact follow state-changes target", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "artifact", name: "Moon Blade" });
    createEntity(root, { kind: "scene", name: "Use", chapter: "chapter-01" });
    edit(root, "scenes/chapter-01-scene-01.md", "state-changes: []", "state-changes:\n  - target: moon-blade\n    change: swung again");
    renameEntity(root, { kind: "artifact", id: "moon-blade", name: "Sun Blade" });
    expect(read(root, "scenes", "chapter-01-scene-01.md")).toContain("  - target: sun-blade\n    change: swung again");
    removeEntity(root, { kind: "artifact", id: "sun-blade" });
    expect(read(root, "scenes", "chapter-01-scene-01.md")).toContain("  - target: \"\"\n    change: swung again");
  });

  test("#86 a __proto__ key survives a rename and unrelated files are untouched", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Kael" });
    createEntity(root, { kind: "character", name: "Sera" });
    edit(root, "characters/sera.md", "status: alive", "status: alive\n__proto__: keep-me");
    const sera = read(root, "characters", "sera.md");
    renameEntity(root, { kind: "character", id: "kael", name: "Kael Storm" });
    expect(read(root, "characters", "sera.md")).toBe(sera);
  });

  test("#88 add, rename, and names refuse a trailing project path", () => {
    const root = newProject();
    const added = invoke(root, ["add", "character", "Ann", "Bee", "."]);
    expect(added.code).toBe(2);
    expect(added.err).toContain('"." looks like a project path: story add takes the project as --path .');
    expect(fs.existsSync(path.join(root, "characters", "ann-bee.md"))).toBe(false);
    expect(invoke(root, ["names", "Zora", "."]).err).toContain("story names takes the project as --path");
    expect(invoke(path.dirname(root), ["add", "character", "Ann", `./${path.basename(root)}`]).err).toContain("looks like a project path");
    expect(invoke(root, ["add", "character", "AC/DC"]).code).toBe(0);
  });

  test("#97 move names only chapter and scene and pluralises refusals", () => {
    const root = newProject();
    expect(() => moveEntity(root, { kind: "", id: "x" })).toThrow("An entity kind is required: expected one of chapter, scene");
    expect(() => moveEntity(root, { kind: "villain", id: "x" })).toThrow("Unsupported entity kind: villain: expected one of chapter, scene");
    expect(() => moveEntity(root, { kind: "research", id: "x" })).toThrow("not research notes;");
    expect(() => moveEntity(root, { kind: "matter", id: "x" })).toThrow("not matter pages;");
    expect(() => moveEntity(root, { kind: "characters", id: "x" })).toThrow("not characters;");
  });

  test("#101 rename and move rewrite reference-style link definitions, and links checks them", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "character", name: "Bo" });
    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), "\nMeet [Bo][bo-link].\n\n[bo-link]: ../characters/bo.md\n");
    renameEntity(root, { kind: "character", id: "bo", name: "Bob Ray" });
    expect(read(root, "chapters", "chapter-01.md")).toContain("[bo-link]: ../characters/bob-ray.md\n");

    fs.appendFileSync(path.join(root, "plot", "timeline.md"), "\n[gone]: ../characters/ghost.md\n");
    expect(messages(validateLinks(root).errors)).toContain("plot/timeline.md links to missing file ../characters/ghost.md");
  });

  test("#127 move rewrites chapter ids in the plot/_index.md theme tracking table", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "C1" });
    createEntity(root, { kind: "chapter", name: "C2" });
    edit(root, "plot/_index.md", "| *No themes tracked yet* | | |", "| change | main | chapter-02 |");
    moveEntity(root, { kind: "chapter", id: "chapter-02", number: 3 });
    expect(read(root, "plot", "_index.md")).toContain("| change | main | chapter-03 |");
  });

  test("#163 remove chapter refuses while died-in, since, or learned-in names it", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "chapter", name: "Two" });
    createEntity(root, { kind: "character", name: "Bob" });
    edit(root, "characters/bob.md", "status: alive", "status: deceased\ndied-in: chapter-02");
    expect(() => removeEntity(root, { kind: "chapter", id: "chapter-02" })).toThrow("chapter chapter-02 is still named by died-in, since, learned-in, or a progression's from in characters/bob.md");
    expect(read(root, "characters", "bob.md")).toContain("died-in: chapter-02");
    edit(root, "characters/bob.md", "died-in: chapter-02", "died-in: chapter-01");
    removeEntity(root, { kind: "chapter", id: "chapter-02" });
    expect(fs.existsSync(path.join(root, "chapters", "chapter-02.md"))).toBe(false);
  });

  test("#167 rename keeps the original text of untouched keys in a changed list item", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Ann" });
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "scene", name: "S", chapter: "chapter-01" });
    edit(root, "scenes/chapter-01-scene-01.md", "state-changes: []", "state-changes:\n  - character: ann\n    knowledge: the safe code\n    code: 0451\n    price: 1.50\n    tone: 'calm'\n  - target: ring\n    code: 0451");
    renameEntity(root, { kind: "character", id: "ann", name: "Anna" });
    expect(read(root, "scenes", "chapter-01-scene-01.md")).toContain("state-changes:\n  - character: anna\n    knowledge: the safe code\n    code: 0451\n    price: 1.50\n    tone: 'calm'\n  - target: ring\n    code: 0451\n");
  });

  test("#176 add and rename refuse an id another kind uses in a shared reference field", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Raven" });
    createEntity(root, { kind: "faction", name: "Night Watch" });
    createEntity(root, { kind: "artifact", name: "Key", owner: "night-watch" });
    expect(() => renameEntity(root, { kind: "faction", id: "night-watch", name: "Raven" })).toThrow("raven is already a character id, and controlled-by and owner references could not tell the faction from the character");
    expect(() => createEntity(root, { kind: "faction", name: "Raven" })).toThrow("raven is already a character id");
    expect(() => createEntity(root, { kind: "artifact", name: "Raven" })).toThrow("mentions references");
    // Kinds that share no field may share an id.
    createEntity(root, { kind: "location", name: "Raven" });
    expect(read(root, "worldbuilding", "artifacts", "key.md")).toContain("owner: night-watch");
  });

  test("#179 move scene --chapter with its own chapter is a no-op", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    for (const name of ["a", "b", "c"]) {
      createEntity(root, { kind: "scene", name, chapter: "chapter-01" });
    }
    expect(() => moveEntity(root, { kind: "scene", id: "chapter-01-scene-01", chapter: "chapter-01" })).toThrow("chapter-01-scene-01 is already scene 1 of chapter-01");
    expect(scanProject(root).scenes.map((scene) => scene.id)).toEqual(["chapter-01-scene-01", "chapter-01-scene-02", "chapter-01-scene-03"]);
  });

  test("#182 links and move tokenise chapter and scene ids alike", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "A" });
    createEntity(root, { kind: "scene", name: "x", chapter: "chapter-01" });
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), "- chapter-01-draft notes\n- chapter-01-scene-01b alt take\n- pre-chapter-01 backstory\n- chapter-01-scene-01 happens\n");
    expect(messages(validateLinks(root).errors)).toEqual([]);
    moveEntity(root, { kind: "chapter", id: "chapter-01", number: 2 });
    expect(read(root, "plot", "timeline.md")).toContain("- chapter-02-scene-01 happens\n");
    expect(messages(validateLinks(root).errors)).toEqual([]);
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), "- chapter-02-scene-09 happens\n");
    expect(messages(validateLinks(root).errors)).toEqual(["plot/timeline.md references missing scene chapter-02-scene-09"]);
    expect(messages(checkProjectContinuity(root).errors)).toEqual([]);
  });
});

describe("add, rename, and scan limits", () => {
  test("rename refuses when a project file's frontmatter does not parse", () => {
    const root = gapProject();
    createEntity(root, { kind: "character", name: "Mara Quill" });
    fs.writeFileSync(path.join(root, "continuity", "exemptions.md"), "---\nnot yaml\n---\n", "utf8");
    expect(() => renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Vell" })).toThrow(/continuity[\\/]exemptions\.md: .*; nothing was changed/);
  });
});

test("moving a chapter rewrites revived-in", () => {
  const root = baseProject(3);
  setCharacter(root, "ann", "alive", "died-in: chapter-01\nrevived-in: chapter-03");
  moveEntity(root, { kind: "chapter", id: "chapter-03", number: 4 });
  expect(fs.readFileSync(path.join(root, "characters", "ann.md"), "utf8")).toContain("revived-in: chapter-04");
});

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
    const root = initProject();
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

  test.skipIf(CHMOD_IGNORED)("wordcount --write refuses before it rewrites any chapter when one it must rewrite is read-only (#724)", () => {
    const root = baseProject(3);
    const third = path.join(root, "chapters", "chapter-03.md");
    fs.chmodSync(third, 0o444);
    const before = snapshot(root);
    try {
      const result = invoke(root, ["wordcount", "--write"]);
      expect(result.code).toBe(4);
      expect(snapshot(root)).toEqual(before);
      expect(result.err).toBe("Cannot write to chapters/chapter-03.md (permission denied); nothing was changed. Fix it and run the command again\n");
    } finally {
      fs.chmodSync(third, 0o644);
    }
    expect(invoke(root, ["wordcount", "--write"]).code).toBe(0);
  });

  test.skipIf(CHMOD_IGNORED)("wordcount --write refuses before it rewrites any chapter when a registry its reindex rewrites is read-only (#724)", () => {
    const root = baseProject(2);
    const registry = path.join(root, "characters", "_index.md");
    fs.writeFileSync(registry, fs.readFileSync(registry, "utf8").replaceAll("Ann", "Stale"));
    fs.chmodSync(registry, 0o444);
    const before = snapshot(root);
    try {
      const result = invoke(root, ["wordcount", "--write"]);
      expect(result.code).toBe(4);
      expect(snapshot(root)).toEqual(before);
      expect(result.err).toBe("Cannot write to characters/_index.md: permission denied\n");
    } finally {
      fs.chmodSync(registry, 0o644);
    }
    expect(invoke(root, ["wordcount", "--write"]).code).toBe(0);
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
    const root = initProject();
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
    const root = initProject();
    createEntity(root, { kind: "character", name: "Bo" });
    const result = invoke(root, ["remove", "character", "bo"]);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
  });
});

describe("review fixes", () => {
  test("rename leaves a `to` key outside routes alone", () => {
    const { root } = reviewProject();
    createEntity(root, { kind: "location", name: "Yonder" });
    writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), "title: S\nchapter: chapter-01\nscene: 1\nstatus: draft\nstate-changes:\n  - character: mara\n    to: yonder", "# S\n");
    renameEntity(root, { kind: "location", id: "yonder", name: "Far Yonder" });
    expect(fs.readFileSync(path.join(root, "scenes", "chapter-01-scene-01.md"), "utf8")).toContain("    to: yonder");
  });
});

describe("interrupted rename (#181, #192)", () => {
  test("renaming a missing id onto an existing name is refused", () => {
    const root = safetyProject();
    createEntity(root, { kind: "character", name: "Bo" });
    createEntity(root, { kind: "chapter", name: "Two", mention: "ghost" });
    const chapter = readProjectFile(root, "chapters/chapter-01.md");
    const result = invoke(root, ["rename", "character", "ghost", "Bo"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("character ghost does not exist");
    expect(readProjectFile(root, "chapters/chapter-01.md")).toBe(chapter);
  });

  test("a rename killed before deleting the old file can be rerun", () => {
    const root = safetyProject();
    createEntity(root, { kind: "location", name: "Port" });
    createEntity(root, { kind: "character", name: "Ilya Venn", location: "port" });
    createEntity(root, { kind: "chapter", name: "One", character: "ilya-venn" });
    failingRemove(/ilya-venn\.md$/, () => renameEntity(root, { kind: "character", id: "ilya-venn", name: "Zed Quill" }));
    expect(listDir(root, "characters")).toEqual(["_index.md", "ilya-venn.md", "zed-quill.md"]);
    const rerun = invoke(root, ["rename", "character", "ilya-venn", "Zed Quill"]);
    // It puts back what the killed run changed, then renames (#604).
    expect(rerun.err).toMatch(/^note: story rename character ilya-venn 'Zed Quill' stopped part way, so this first put back the \d+ files it had changed\n$/);
    expect(rerun.code).toBe(0);
    expect(listDir(root, "characters")).toEqual(["_index.md", "zed-quill.md"]);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });
});

describe("interrupted move (#191, #193, #194)", () => {
  // Runs `check` on the project a move stopped part way, and on a copy
  // without its undo log, as a move by an older story left it. A rerun
  // finishes the move either way: with the log it puts back what the
  // stopped run changed and moves again (#604), and without one it finishes
  // where the run stopped.
  function withAndWithoutLog(root, check) {
    const copy = path.join(makeTempDir(), "copy");
    fs.cpSync(root, copy, { recursive: true });
    fs.rmSync(path.join(copy, ".story-undo.tmp"));
    check(root);
    check(copy);
  }

  function book() {
    const root = safetyProject();
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
    withAndWithoutLog(root, (project) => {
      expect(moveEntity(project, { kind: "chapter", id: "chapter-01", number: 5 }).id).toBe("chapter-05");
      expect(listDir(project, "chapters")).toEqual(["_index.md", "chapter-02.md", "chapter-03.md", "chapter-05.md"]);
      expect(listDir(project, "scenes")).toEqual(["_index.md", "chapter-02-scene-01.md", "chapter-02-scene-02.md", "chapter-05-scene-01.md"]);
      expect(messages(validateLinks(project).errors)).toEqual([]);
    });
  });

  test.skipIf(CHMOD_IGNORED)("move scene adds the cast before deleting the old scene, so a rerun finishes", () => {
    const root = book();
    readOnly(path.join(root, "chapters", "chapter-03.md"), () => moveEntity(root, { kind: "scene", id: "chapter-02-scene-02", chapter: "chapter-03" }), "Cannot write to chapters/chapter-03.md (permission denied)");
    expect(moveEntity(root, { kind: "scene", id: "chapter-02-scene-02", chapter: "chapter-03" }).id).toBe("chapter-03-scene-01");
    expect(listDir(root, "scenes")).toEqual(["_index.md", "chapter-01-scene-01.md", "chapter-02-scene-01.md", "chapter-03-scene-01.md"]);
    expect(scanProject(root).chapters.find((chapter) => chapter.id === "chapter-03").characters).toContain("edran");
  });

  test("rerunning move scene without --scene reuses the number the interrupted run took", () => {
    const root = book();
    failingRemove(/chapter-02-scene-02\.md$/, () => moveEntity(root, { kind: "scene", id: "chapter-02-scene-02", chapter: "chapter-01" }));
    expect(listDir(root, "scenes")).toContain("chapter-01-scene-02.md");
    withAndWithoutLog(root, (project) => {
      const rerun = invoke(project, ["move", "scene", "chapter-02-scene-02", "--chapter", "chapter-01"]);
      expect(rerun.out).toContain("to chapter-01-scene-02");
      expect(listDir(project, "scenes")).toEqual(["_index.md", "chapter-01-scene-01.md", "chapter-01-scene-02.md", "chapter-02-scene-01.md"]);
      expect(messages(validateLinks(project).errors)).toEqual([]);
    });
  });

  test("a move onto an identical placeholder is refused", () => {
    const root = safetyProject();
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

describe("entity commands", () => {
  test("remove chapter refuses while scenes point at it and walks back statuses", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-01" });
    createEntity(root, { kind: "clue", name: "Bell", planted: "chapter-01" });
    createEntity(root, { kind: "promise", name: "Oath", planted: "chapter-01", payoff: "chapter-01", status: "paid-off" });
    createEntity(root, { kind: "promise", name: "Debt", planted: "chapter-02", payoff: "chapter-01", status: "paid-off" });
    createEntity(root, { kind: "question", name: "Who", introduced: "chapter-02", resolved: "chapter-01" });
    expect(() => removeEntity(root, { kind: "chapter", id: "chapter-01" })).toThrow("chapter chapter-01 still has scenes: chapter-01-scene-01");
    removeEntity(root, { kind: "scene", id: "chapter-01-scene-01" });
    removeEntity(root, { kind: "chapter", id: "chapter-01" });
    const project = scanProject(root);
    expect(project.clues[0].status).toBe("planned");
    expect(project.promises.map((promise) => [promise.id, promise.status])).toEqual([["debt", "planted"], ["oath", "planned"]]);
    expect(project.questions[0].status).toBe("open");
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(messages(checkProjectContinuity(root).errors)).toEqual([]);
  });

  test("rename updates the entity heading", () => {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "chapter", name: "Arrival", number: 3 });
    renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Venn" });
    renameEntity(root, { kind: "chapter", id: "chapter-03", name: "Departure" });
    expect(fs.readFileSync(path.join(root, "characters", "mara-venn.md"), "utf8")).toContain("\n# Mara Venn\n");
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-03.md"), "utf8")).toContain("\n# Chapter 3: Departure\n");
  });
});

describe("move", () => {
  function book() {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: "mara" });
    createEntity(root, { kind: "chapter", name: "Two", number: 2, character: "mara" });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-02", character: "mara" });
    createEntity(root, { kind: "clue", name: "Ring", planted: "chapter-01", payoff: "chapter-02" });
    createEntity(root, { kind: "question", name: "Who", introduced: "chapter-01", resolved: "chapter-02" });
    const character = path.join(root, "characters", "mara.md");
    fs.writeFileSync(character, fs.readFileSync(character, "utf8").replace("status: alive", "status: deceased\ndied-in: chapter-02"));
    const state = path.join(root, "continuity", "state.md");
    fs.writeFileSync(state, fs.readFileSync(state, "utf8").replace("current-chapter: 0", "current-chapter: 2").replace("knowledge-state: []", "knowledge-state:\n  - character: mara\n    knows: The ring is fake\n    learned-in: chapter-02"));
    fs.writeFileSync(path.join(root, "plot", "timeline.md"), `${fs.readFileSync(path.join(root, "plot", "timeline.md"), "utf8")}\n- chapter-02: the dock (chapter-02-scene-01)\n`);
    return root;
  }

  test("move chapter renumbers files and every reference", () => {
    const root = book();
    const result = invoke(path.dirname(root), ["move", "chapter", "chapter-02", "--number", "3", "--path", root]);
    expect(result.out).toContain("Moved chapter chapter-02 to chapter-03");
    expect(result.out).toContain("(with 1 scene)");
    const project = scanProject(root);
    expect(project.chapters.map((chapter) => [chapter.id, chapter.number])).toEqual([["chapter-01", 1], ["chapter-03", 3]]);
    expect(project.scenes.map((scene) => [scene.id, scene.chapter])).toEqual([["chapter-03-scene-01", "chapter-03"]]);
    expect(project.clues[0].payoff).toBe("chapter-03");
    expect(project.questions[0].resolved).toBe("chapter-03");
    expect(project.characters[0].diedIn).toBe("chapter-03");
    const stateData = project.continuity.data;
    expect(stateData["current-chapter"]).toBe(3);
    expect(stateData["knowledge-state"][0]["learned-in"]).toBe("chapter-03");
    expect(fs.readFileSync(path.join(root, "plot", "timeline.md"), "utf8")).toContain("- chapter-03: the dock (chapter-03-scene-01)");
    expect(fs.readFileSync(project.chapters[1].file, "utf8")).toContain("# Chapter 3: Two");
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });

  test("move chapter refuses a taken number and names the fix", () => {
    const root = book();
    expect(() => moveEntity(root, { kind: "chapter", id: "chapter-01", number: 2 })).toThrow("chapter-02 already exists: move it first. To make room, renumber from the highest chapter down");
    expect(() => moveEntity(root, { kind: "chapter", id: "chapter-01" })).toThrow("move chapter requires --number <n>");
    expect(() => moveEntity(root, { kind: "chapter", id: "chapter-09", number: 4 })).toThrow("chapter chapter-09 does not exist");
    expect(() => moveEntity(root, { kind: "chapter", id: "chapter-01", number: 1 })).toThrow("chapter-01 is already chapter 1");
    expect(() => moveEntity(root, { kind: "character", id: "mara", number: 1 })).toThrow("story move works on chapters and scenes");
  });

  test("move scene changes chapter and number and updates the chapter cast", () => {
    const root = book();
    moveEntity(root, { kind: "scene", id: "chapter-02-scene-01", chapter: "chapter-01" });
    let project = scanProject(root);
    expect(project.scenes.map((scene) => [scene.id, scene.chapter, scene.scene])).toEqual([["chapter-01-scene-01", "chapter-01", 1]]);
    expect(fs.readFileSync(path.join(root, "plot", "timeline.md"), "utf8")).toContain("(chapter-01-scene-01)");
    moveEntity(root, { kind: "scene", id: "chapter-01-scene-01", scene: 4 });
    project = scanProject(root);
    expect(project.scenes[0].id).toBe("chapter-01-scene-04");
    expect(messages(validateLinks(root).errors)).toEqual([]);
    expect(() => moveEntity(root, { kind: "scene", id: "chapter-01-scene-04" })).toThrow("move scene requires --chapter <id>, --scene <n>, or both");
    expect(() => moveEntity(root, { kind: "scene", id: "chapter-01-scene-04", chapter: "chapter-07" })).toThrow("chapter chapter-07 does not exist");
    expect(() => moveEntity(root, { kind: "scene", id: "chapter-01-scene-04", scene: 4 })).toThrow("is already scene 4");
    expect(() => moveEntity(root, { kind: "scene", id: "nope-scene-01", scene: 1 })).toThrow("scene nope-scene-01 does not exist");
    createEntity(root, { kind: "scene", name: "Other", chapter: "chapter-01", scene: 5 });
    expect(() => moveEntity(root, { kind: "scene", id: "chapter-01-scene-04", scene: 5 })).toThrow("chapter-01-scene-05 already exists");
  });

  test("move chapter refuses when a scene file is in the way", () => {
    const root = book();
    writeMarkdown(path.join(root, "scenes", "chapter-05-scene-01.md"), "title: Stray\nchapter: chapter-05\nscene: 1\nstatus: draft");
    expect(() => moveEntity(root, { kind: "chapter", id: "chapter-02", number: 5 })).toThrow("scenes/chapter-05-scene-01.md already exists; nothing was changed");
    expect(fs.existsSync(path.join(root, "chapters", "chapter-02.md"))).toBe(true);
  });

  test("move chapter follows links to its scene files and a colonless heading", () => {
    const root = book();
    const character = path.join(root, "characters", "mara.md");
    fs.appendFileSync(character, "\nSee [the dock](../scenes/chapter-02-scene-01.md).\n");
    const chapter = path.join(root, "chapters", "chapter-02.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("# Chapter 2: Two", "# Chapter 2"));
    moveEntity(root, { kind: "chapter", id: "chapter-02", number: 3 });
    expect(fs.readFileSync(character, "utf8")).toContain("(../scenes/chapter-03-scene-01.md)");
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-03.md"), "utf8")).toContain("\n# Chapter 3\n");
  });

  test("move chapter renumbers only the body's first heading, never the frontmatter, and a CRLF heading with no colon (#578)", () => {
    const root = book();
    const chapter = path.join(root, "chapters", "chapter-02.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8")
      .replace("title: Two\n", "title: Two\n# Chapter 2: was the prologue\n")
      .replace("# Chapter 2: Two\n", "<!--\n# Chapter 2: an old heading\n-->\n# Chapter 2: Two\n")
      .replace("## Chapter Text\n", "## Chapter Text\n\n# Chapter 2: a heading in the text\n"));
    moveEntity(root, { kind: "chapter", id: "chapter-02", number: 3 });
    const moved = path.join(root, "chapters", "chapter-03.md");
    const text = fs.readFileSync(moved, "utf8");
    expect(text).toContain("\ntitle: Two\n# Chapter 2: was the prologue\n");
    expect(text).toContain("\n<!--\n# Chapter 2: an old heading\n-->\n# Chapter 3: Two\n");
    expect(text).toContain("\n# Chapter 2: a heading in the text\n");

    fs.writeFileSync(moved, text.replace("# Chapter 3: Two", "# Chapter 3").replace(/\r?\n/g, "\r\n"));
    moveEntity(root, { kind: "chapter", id: "chapter-03", number: 4 });
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-04.md"), "utf8")).toContain("\r\n# Chapter 4\r\n");

    // The first `# Chapter N` heading counts, after other headings and a
    // fenced one.
    const fourth = path.join(root, "chapters", "chapter-04.md");
    fs.writeFileSync(fourth, fs.readFileSync(fourth, "utf8").replace("\r\n# Chapter 4\r\n", "\r\n## Epigraph\r\n\r\n> The sea keeps nothing.\r\n\r\n```\r\n# Chapter 4: in a fence\r\n```\r\n\r\n# Chapter 4: Two\r\n"));
    moveEntity(root, { kind: "chapter", id: "chapter-04", number: 6 });
    const sixth = fs.readFileSync(path.join(root, "chapters", "chapter-06.md"), "utf8");
    expect(sixth).toContain("\r\n```\r\n# Chapter 4: in a fence\r\n```\r\n\r\n# Chapter 6: Two\r\n");

    // A body with no heading at all moves unchanged.
    const bare = path.join(root, "chapters", "chapter-01.md");
    const body = "\nJust prose.\n";
    fs.writeFileSync(bare, fs.readFileSync(bare, "utf8").replace(/\n---\n[\s\S]*$/, `\n---\n${body}`));
    moveEntity(root, { kind: "chapter", id: "chapter-01", number: 2 });
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-02.md"), "utf8")).toEndWith(`\n---\n${body}`);
  });

  test("an interrupted move can be rerun to finish", () => {
    const root = book();
    moveEntity(root, { kind: "chapter", id: "chapter-02", number: 3 });
    // Recreate the state of a run killed after writing the new files but
    // before deleting the old ones.
    const project = scanProject(root);
    const snapshot = new Map([...project.chapters, ...project.scenes].map((entry) => [entry.file, fs.readFileSync(entry.file, "utf8")]));
    moveEntity(root, { kind: "chapter", id: "chapter-03", number: 2 });
    for (const [file, text] of snapshot) {
      fs.writeFileSync(file, text);
    }
    expect(moveEntity(root, { kind: "chapter", id: "chapter-03", number: 2 }).id).toBe("chapter-02");
    expect(scanProject(root).chapters.map((entry) => entry.id)).toEqual(["chapter-01", "chapter-02"]);
  });

  test("move requires an id", () => {
    const root = book();
    expect(() => moveEntity(root, { kind: "chapter", id: "" })).toThrow("move requires a chapter or scene id");
  });
});

describe("sweep fixes", () => {
  test("rename rewrites a long list in linear time", () => {
    // Each run renames a project with `count` mentions of the character.
    const timeRename = (count) => {
      const root = sweepProject();
      createEntity(root, { kind: "character", name: "Mara" });
      createEntity(root, { kind: "chapter", name: "One", number: 1 });
      const chapter = path.join(root, "chapters", "chapter-01.md");
      // With no mentions the chapter keeps its empty list, which is the fixed cost.
      if (count > 0) {
        const mentions = Array.from({ length: count }, () => "  - mara").join("\n");
        fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("mentions: []", `mentions:\n${mentions}`));
      }
      const started = performance.now();
      renameEntity(root, { kind: "character", id: "mara", name: "Mara Quill" });
      const elapsed = performance.now() - started;
      expect(scanProject(root).chapters[0].mentions.every((id) => id === "mara-quill")).toBe(true);
      return elapsed;
    };
    expectLinearGrowthFresh(timeRename, 30000, { limit: 3000 });
  });

  test("rename and remove leave node_modules alone", () => {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara Quill" });
    const vendored = path.join(root, "node_modules", "story-skills", "examples", "x", "characters");
    fs.mkdirSync(vendored, { recursive: true });
    const vendoredFile = path.join(vendored, "theo.md");
    fs.writeFileSync(vendoredFile, "---\nname: Theo\nrelationships:\n  - character: mara-quill\n    type: sibling\n---\n");
    renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Tide" });
    removeEntity(root, { kind: "character", id: "mara-tide" });
    expect(fs.readFileSync(vendoredFile, "utf8")).toContain("character: mara-quill");
  });

  test("skill notes without frontmatter do not block rename or remove", () => {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara" });
    fs.writeFileSync(path.join(root, "continuity", "motifs.md"), "# Motifs\n\n| Motif | Chapters |\n|---|---|\n| salt | 1 |\n");
    fs.writeFileSync(path.join(root, "continuity", "theme-audit.md"), "# Theme audit\n\nMara carries the lie.\n");
    expect(renameEntity(root, { kind: "character", id: "mara", name: "Mara Quill" }).id).toBe("mara-quill");
    expect(removeEntity(root, { kind: "character", id: "mara-quill" }).id).toBe("mara-quill");
  });

  test("a plain _index.md outside the registries does not block rename", () => {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara" });
    fs.mkdirSync(path.join(root, "notes"));
    fs.writeFileSync(path.join(root, "notes", "_index.md"), "# Notes\n");
    expect(renameEntity(root, { kind: "character", id: "mara", name: "Mara Quill" }).id).toBe("mara-quill");
  });

  test("an interrupted rename can be rerun to finish", () => {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: "mara-quill" });
    createEntity(root, { kind: "chapter", name: "Two", number: 2, character: "mara-quill" });
    // A kill while references are rewritten leaves the entity file in place
    // (it moves last), with some references already on the new id...
    const one = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(one, fs.readFileSync(one, "utf8").replace("mara-quill", "mara-tide"));
    // ...so a rerun finishes the job.
    expect(renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Tide" }).id).toBe("mara-tide");
    expect(messages(validateLinks(root).errors)).toEqual([]);
    // Killed after the old file was deleted, the rename left its marker; a
    // rerun resumes rather than failing with "does not exist" (#579).
    const marker = path.join(root, ".story-rename.tmp");
    const { rmSync } = fs;
    fs.rmSync = (file, options) => {
      if (path.resolve(String(file)) === marker) {
        throw new Error("killed");
      }
      return rmSync(file, options);
    };
    try {
      expect(() => renameEntity(root, { kind: "character", id: "mara-tide", name: "Mara Quill" })).toThrow("killed");
    } finally {
      fs.rmSync = rmSync;
    }
    // Its undo log has a rerun put the rename back and make it again
    // (#604); without one, as a story from before the log left it, the
    // marker resumes it.
    const logged = path.join(makeTempDir(), "logged");
    fs.cpSync(root, logged, { recursive: true });
    const withLog = invoke(path.dirname(logged), ["rename", "character", "mara-tide", "Mara Quill", "--path", logged]);
    expect(withLog).toMatchObject({ code: 0, err: expect.stringMatching(/^note: story rename character mara-tide 'Mara Quill' stopped part way, so this first put back the \d+ files it had changed\n$/) });
    expect(withLog.out).toStartWith("Renamed character mara-tide to mara-quill");
    expect(fs.existsSync(path.join(logged, ".story-rename.tmp"))).toBe(false);
    fs.rmSync(path.join(root, ".story-undo.tmp"));
    const rerun = ["rename", "character", "mara-tide", "Mara Quill", "--path", root];
    // The preview's copy of the project holds the marker too.
    expect(invoke(path.dirname(root), [...rerun, "--dry-run"])).toEqual({ code: 0, out: "delete  .story-rename.tmp\nDry run: story rename would make 1 change; nothing was written\n", err: "" });
    expect(fs.existsSync(marker)).toBe(true);
    const resumed = invoke(path.dirname(root), rerun);
    expect(resumed.out).toContain("Finished an interrupted rename of character mara-tide to mara-quill");
    expect(resumed).toMatchObject({ code: 0, err: "" });
    // Once finished, a rerun has no marker left and is refused.
    expect(invoke(path.dirname(root), rerun)).toMatchObject({ code: 2, err: expect.stringContaining("character mara-tide does not exist") });
    // Renaming onto another entity with the same name is still refused.
    createEntity(root, { kind: "character", name: "Other" });
    createEntity(root, { kind: "character", name: "Other Two" });
    expect(() => renameEntity(root, { kind: "character", id: "other-two", name: "Other" })).toThrow("character other already exists");
  });

  test("remove rewrites references before deleting the file", () => {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: "mara" });
    removeEntity(root, { kind: "character", id: "mara" });
    expect(scanProject(root).chapters[0].characters).toEqual([]);
  });

  test("removing a chapter reopens a resolved question", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    createEntity(root, { kind: "question", name: "Who", introduced: "chapter-01", resolved: "chapter-02", status: "resolved" });
    removeEntity(root, { kind: "chapter", id: "chapter-02" });
    expect(scanProject(root).questions[0].status).toBe("open");
  });
});

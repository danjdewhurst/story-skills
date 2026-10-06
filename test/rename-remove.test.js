import { describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createEntity, createStoryProject, moveEntity, removeEntity, renameEntity } from "../src/story.js";
import { makeTempDir, whileWriting, writeMarkdown } from "./helpers.js";

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

    const result = renameEntity(root, { kind: "character", id: "vale", name: "Vale Two" });

    expect(read(root, "worldbuilding", "artifacts", "ring.md")).toContain("owner: vale");
    // ...but not silently (#579).
    expect(result.warnings).toEqual([{
      code: "ambiguous-references",
      message: "controlled-by and owner references to vale in worldbuilding/artifacts/ring.md could mean the character or faction vale, and rename left them alone, so they now name the faction: change any that meant the character to vale-two",
      file: "worldbuilding/artifacts/ring.md",
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
  // Runs a rename that is killed once it has deleted the old file, at the
  // first registry write of its reindex.
  function killedBeforeReindex(oldFile, run) {
    const original = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (!fs.existsSync(oldFile) && path.basename(String(to)) === "_index.md") {
        throw new Error("killed before the reindex");
      }
      return original(from, to);
    };
    try {
      expect(run).toThrow("killed before the reindex");
    } finally {
      fs.renameSync = original;
    }
  }

  test("rename refuses an id that never existed, though an entity has the new name", () => {
    const root = project("No Such Person");
    createEntity(root, { kind: "character", name: "Sera Voss" });
    const before = snapshot(root);
    expect(() => renameEntity(root, { kind: "character", id: "no-such-person", name: "Sera Voss" })).toThrow("character no-such-person does not exist");
    fs.rmSync(path.join(root, "characters", "_index.md"));
    expect(() => renameEntity(root, { kind: "character", id: "no-such-person", name: "Sera Voss" })).toThrow("character no-such-person does not exist");
    fs.writeFileSync(path.join(root, "characters", "_index.md"), before[path.join("characters", "_index.md")]);
    expect(snapshot(root)).toEqual(before);
  });

  test("a rename killed after deleting the old file is finished by a rerun, once", () => {
    const root = project("Stopped Rename");
    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: "mara-quill" });
    killedBeforeReindex(path.join(root, "characters", "mara-quill.md"), () => renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Tide" }));
    expect(read(root, "characters", "_index.md")).toContain("| Mara Quill | supporting | alive | [mara-tide](mara-tide.md) |");

    expect(renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Tide" })).toMatchObject({ id: "mara-tide", resumed: true, warnings: [] });
    expect(read(root, "characters", "_index.md")).toContain("| Mara Tide | supporting | alive | [mara-tide](mara-tide.md) |");
    // Finished, the rename leaves no evidence, so a rerun is refused.
    expect(() => renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Tide" })).toThrow("character mara-quill does not exist");
  });

  test("rename and remove say which mentions they left on an id a character and an artifact share", () => {
    const root = project("Shared Mentions");
    const handMade = () => writeMarkdown(path.join(root, "characters", "blackened-crown.md"), "name: Blackened Crown\nrole: supporting\nstatus: alive", "# Blackened Crown\n");
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
      message: "mentions references to blackened-crown in chapters/chapter-01.md could mean the character or artifact blackened-crown, and rename left them alone, so they now name the artifact: change any that meant the character to black-knight",
      file: "chapters/chapter-01.md",
      chapter: null
    }]);

    handMade();
    const removed = removeEntity(root, { kind: "character", id: "blackened-crown" });
    expect(read(root, "chapters", "chapter-01.md")).toContain("mentions:\n  - blackened-crown\n");
    expect(removed.warnings.filter((finding) => finding.code === "ambiguous-references").map((finding) => finding.message)).toEqual([
      "mentions references to blackened-crown in chapters/chapter-01.md could mean the character or artifact blackened-crown, and remove left them alone, so they now name the artifact: delete any that meant the character"
    ]);
  });
});

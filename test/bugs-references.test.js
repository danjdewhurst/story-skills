import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { checkProjectContinuity, createEntity, createStoryProject, moveEntity, removeEntity, renameEntity, scanProject, validateLinks, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function newProject(title = "Refs") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function read(root, ...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

function edit(root, relativePath, from, to) {
  const file = path.join(root, relativePath);
  const text = fs.readFileSync(file, "utf8");
  expect(text).toContain(from);
  fs.writeFileSync(file, text.replace(from, to));
}

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
    expect(() => renameEntity(root, { kind: "character", id: "kael-storm", name: "Kael Three" })).toThrow();
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

  test("#68 add refuses a resolved or status chapter that is not written yet", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    expect(() => createEntity(root, { kind: "question", name: "Who", introduced: "chapter-01", resolved: "chapter-05" })).toThrow("--resolved chapter-05 is not written yet");
    expect(() => createEntity(root, { kind: "question", name: "Why", introduced: "chapter-04", status: "dropped" })).toThrow("--introduced chapter-04 is not written yet");
    expect(() => createEntity(root, { kind: "promise", name: "P", planted: "chapter-01", payoff: "chapter-05", status: "paid-off" })).toThrow("--payoff chapter-05 is not written yet");
    expect(() => createEntity(root, { kind: "clue", name: "C", planted: "chapter-05", status: "planted" })).toThrow("--planted chapter-05 is not written yet");
    expect(fs.readdirSync(path.join(root, "continuity", "questions"))).toEqual(["_index.md"]);
    createEntity(root, { kind: "question", name: "When", introduced: "chapter-01", resolved: "chapter-01" });
    createEntity(root, { kind: "promise", name: "Q", planted: "chapter-01", payoff: "chapter-05" });
    expect(messages(validateLinks(root).errors)).toEqual([]);
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

  test("#100 add refuses several ids for one-id fields and merges singular and plural flags", () => {
    const root = newProject();
    createEntity(root, { kind: "location", name: "Port Kestrel" });
    createEntity(root, { kind: "location", name: "Salt Market" });
    createEntity(root, { kind: "chapter", name: "One" });
    expect(() => createEntity(root, { kind: "scene", name: "Docks", chapter: "chapter-01", location: ["port-kestrel", "salt-market"] })).toThrow("--location takes one id for a scene, got port-kestrel, salt-market");
    expect(() => createEntity(root, { kind: "artifact", name: "Key", location: ["port-kestrel", "salt-market"] })).toThrow("--location takes one id for an artifact");
    expect(() => createEntity(root, { kind: "location", name: "Keep", "controlled-by": ["ann", "bo"] })).toThrow("--controlled-by takes one id");
    // A singular flag keeps a comma, so a comma list is not an id.
    expect(() => createEntity(root, { kind: "artifact", name: "Key", location: "port-kestrel,salt-market" })).toThrow('--location "port-kestrel,salt-market" must be a kebab-case id');
    createEntity(root, { kind: "scene", name: "Docks", chapter: "chapter-01", location: ["port-kestrel"] });
    expect(read(root, "scenes", "chapter-01-scene-01.md")).toContain("location: port-kestrel\n");

    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "character", name: "Ivo Pell" });
    createEntity(root, { kind: "chapter", name: "Mix", character: ["ivo-pell", "ivo-pell"], characters: "mara-quill", location: ["port-kestrel", "port-kestrel"] });
    const chapter = scanProject(root).chapters.find((entry) => entry.id === "chapter-02");
    expect(chapter.characters).toEqual(["mara-quill", "ivo-pell"]);
    expect(chapter.locations).toEqual(["port-kestrel"]);
    createEntity(root, { kind: "research", name: "R", risk: ["legal", "legal"], "used-in": ["chapter-01", "chapter-01"] });
    expect(read(root, "research", "r.md")).toContain("used-in:\n  - chapter-01\n");
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(messages(validateLinks(root).errors)).toEqual([]);
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

  test("#175 add refuses unpadded scheduled chapter ids, and links reports them", () => {
    const root = newProject();
    expect(() => createEntity(root, { kind: "clue", name: "Ledger", planted: "chapter-1" })).toThrow("--planted chapter-1: did you mean chapter-01?");
    expect(() => createEntity(root, { kind: "research", name: "R", "used-in": "chapter-003" })).toThrow("did you mean chapter-03?");
    createEntity(root, { kind: "promise", name: "P", payoff: "chapter-03" });
    edit(root, "continuity/promises/p.md", "payoff: chapter-03", "payoff: chapter-3");
    expect(messages(validateLinks(root).errors)).toContain("continuity/promises/p.md references missing chapter chapter-3");
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

  test("#180 init and add refuse empty tense, pov, genre, and type", () => {
    const cwd = makeTempDir();
    for (const option of ["tense", "pov", "genre"]) {
      expect(() => createStoryProject({ cwd, title: "T", dir: option, [option]: "" })).toThrow(`--${option} cannot be empty`);
      expect(fs.existsSync(path.join(cwd, option))).toBe(false);
    }
    const root = newProject();
    expect(() => createEntity(root, { kind: "location", name: "L", type: "" })).toThrow("--type cannot be empty");
    expect(() => createEntity(root, { kind: "system", name: "S", type: " " })).toThrow("--type cannot be empty");
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

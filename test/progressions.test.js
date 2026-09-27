import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { chapterChronology } from "../src/chronology.js";
import { entityStateAt, formatStateChanges, sortProgressions, validateProgressions } from "../src/progressions.js";
import {
  createStoryProject,
  entityStateAtChapter,
  moveEntity,
  removeEntity,
  renameEntity,
  scanProject,
  validateLinks,
  validateProject
} from "../src/story.js";
import { checkProjectSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function writeChapter(root, number, extra = "") {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 2
${extra}`, "## Chapter Text\n\nWords here.\n");
}

function progressionProject({ maraProgressions, extraMara = "" } = {}) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Tides", force: false });
  for (let number = 1; number <= 4; number += 1) {
    writeChapter(root, number);
  }
  writeMarkdown(path.join(root, "characters", "mara-finn.md"), `
name: Mara Finn
role: protagonist
status: alive
${extraMara}progressions:
${maraProgressions ?? `  - from: chapter-02
    field: status
    value: missing
  - from: chapter-03
    field: role
    value: antagonist
  - from: chapter-03
    field: arc
    value: the-drowning`}
`, "# Mara\n");
  writeMarkdown(path.join(root, "plot", "arcs", "the-drowning.md"), `
name: The Drowning
type: main
status: planned
`, "# The Drowning\n");
  writeMarkdown(path.join(root, "worldbuilding", "locations", "old-mill.md"), `
name: Old Mill
type: building
status: working
progressions:
  - from: chapter-02
    field: status
    value: burned
  - from: chapter-02
    field: controlled-by
    value: river-guild
`, "# Old Mill\n");
  writeMarkdown(path.join(root, "worldbuilding", "factions", "river-guild.md"), `
name: River Guild
type: guild
status: active
progressions:
  - from: chapter-04
    field: status
    value: disbanded
`, "# River Guild\n");
  runCli(["reindex", root], memoryIo(cwd));
  return { root, cwd };
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

const read = (root, ...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

describe("entityStateAt", () => {
  const chronology = { numbers: new Map([["chapter-01", 1], ["chapter-02", 2], ["chapter-03", 3]]), after: (later, earlier) => chronology.numbers.get(later) > chronology.numbers.get(earlier) };
  const data = {
    name: "Mara",
    status: "alive",
    progressions: [
      { from: "chapter-02", field: "status", value: "missing" },
      { from: "chapter-03", field: "status", value: "found" },
      { from: "chapter-05", field: "status", value: "crowned" },
      { from: "chapter-02", field: "limp", value: true },
      { from: "nowhere", field: "status", value: "lost" },
      { from: "chapter-02", field: "empty" },
      "not an entry"
    ]
  };

  test("returns the opening state before any change", () => {
    const { state, changes } = entityStateAt(data, "chapter-01", chronology);
    expect(state).toEqual({ name: "Mara", status: "alive" });
    expect(changes).toEqual([]);
  });

  test("applies changes from the target chapter and earlier, in story order", () => {
    const { state, changes } = entityStateAt(data, "chapter-03", chronology);
    expect(state).toEqual({ name: "Mara", status: "found", limp: true });
    expect(changes).toEqual([
      { field: "status", value: "missing", from: "chapter-02", previous: "alive" },
      { field: "limp", value: true, from: "chapter-02", previous: undefined },
      { field: "status", value: "found", from: "chapter-03", previous: "missing" }
    ]);
  });

  test("orders a planned chapter by its number and accepts one as the target", () => {
    expect(entityStateAt(data, "chapter-04", chronology).state.status).toBe("found");
    expect(entityStateAt(data, "chapter-05", chronology).state.status).toBe("crowned");
  });

  test("sorts entries listed out of order", () => {
    const shuffled = { status: "alive", progressions: [...data.progressions].reverse() };
    expect(entityStateAt(shuffled, "chapter-03", chronology).state.status).toBe("found");
  });

  test("uses story time for dated chapters", () => {
    const dated = { numbers: chronology.numbers, after: (later, earlier) => ({ "chapter-01": 3, "chapter-02": 1, "chapter-03": 2 })[later] > ({ "chapter-01": 3, "chapter-02": 1, "chapter-03": 2 })[earlier] };
    // chapter-01 is a flash-forward: both changes have happened by then.
    expect(entityStateAt(data, "chapter-01", dated).state.status).toBe("found");
  });

  test("keeps a __proto__ field as data", () => {
    const { state } = entityStateAt({ progressions: [{ from: "chapter-01", field: "__proto__", value: "x" }] }, "chapter-01", chronology);
    expect(Object.hasOwn(state, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
  });

  test("handles missing data and rejects an unknown chapter", () => {
    expect(entityStateAt(undefined, "chapter-01", chronology)).toEqual({ state: {}, changes: [] });
    expect(() => entityStateAt(data, "prologue", chronology)).toThrow("Unknown chapter prologue");
  });

  test("formats applied changes", () => {
    expect(formatStateChanges([], "chapter-01")).toBe("");
    expect(formatStateChanges([{ field: "title", value: "", from: "chapter-02", previous: "Lady" }], "chapter-02")).toBe("State at chapter-02:\n- title: (cleared) (from chapter-02, was Lady)\n");
    expect(formatStateChanges(entityStateAt(data, "chapter-02", chronology).changes, "chapter-02")).toBe(
      "State at chapter-02:\n- status: missing (from chapter-02, was alive)\n- limp: true (from chapter-02)\n"
    );
  });
});

describe("validateProgressions", () => {
  const chronology = { numbers: new Map([["chapter-01", 1], ["chapter-02", 2], ["chapter-03", 3]]), after: (later, earlier) => chronology.numbers.get(later) > chronology.numbers.get(earlier) };
  const rules = { lists: new Set(["tags"]), enums: new Map([["status", new Set(["alive", "missing"])]]) };
  const check = (progressions) => {
    const errors = [];
    validateProgressions({ progressions }, "characters/mara.md", rules, chronology, errors);
    return errors;
  };

  test("accepts well-formed entries, including planned chapters and scalar values", () => {
    expect(check([
      { from: "chapter-01", field: "status", value: "missing" },
      { from: "chapter-02", field: "age", value: 12 },
      { from: "chapter-09", field: "sworn", value: true },
      { from: "chapter-09", field: "title", value: "" }
    ])).toEqual([]);
    expect(check(undefined)).toEqual([]);
  });

  test("reports shapes, fields, and values", () => {
    expect(check("chapter-02")).toEqual(["characters/mara.md frontmatter field progressions must be a list"]);
    expect(check([
      "status",
      { field: "status", value: "missing" },
      { from: "chapter-01", value: "x" },
      { from: "chapter-01", field: "Hair Colour", value: "grey" },
      { from: "chapter-01", field: "progressions", value: "x" },
      { from: "chapter-01", field: "died-in", value: "chapter-02" },
      { from: "chapter-01", field: "tags", value: "x" },
      { from: "chapter-01", field: "hair", value: null },
      { from: "chapter-01", field: "scar", value: ["jaw"] },
      { from: "chapter-01", field: "status", value: "dead" }
    ])).toEqual([
      "characters/mara.md progressions[0] must be a mapping with from, field, and value",
      "characters/mara.md progressions[1] is missing from (the chapter the change takes effect)",
      "characters/mara.md progressions[2] is missing field",
      "characters/mara.md progressions[3] field Hair Colour must be kebab-case",
      "characters/mara.md progressions[4] cannot change progressions",
      "characters/mara.md progressions[5] cannot change died-in; set it on the character and story continuity reads it by chapter",
      "characters/mara.md progressions[6] cannot change tags, which is a list; a progression holds a single value",
      "characters/mara.md progressions[7] is missing value",
      "characters/mara.md progressions[8] value must be a single value, not a list or mapping",
      "characters/mara.md progressions[9] status has unsupported value dead"
    ]);
  });

  test("reports repeats and entries out of story order", () => {
    expect(check([
      { from: "chapter-03", field: "status", value: "missing" },
      { from: "chapter-01", field: "hair", value: "grey" },
      { from: "chapter-03", field: "status", value: "alive" },
      { from: "chapter-02", field: "hair", value: "white" },
      { from: "chapter-04", field: "hair", value: "gone" },
      { from: "typo", field: "hair", value: "gone" }
    ])).toEqual([
      "characters/mara.md progressions[1] from chapter-01 comes before progressions[0] from chapter-03 in the story; list progressions in story order",
      "characters/mara.md progressions[2] repeats status from chapter-03 (progressions[0])",
      "characters/mara.md progressions[3] from chapter-02 comes before progressions[2] from chapter-03 in the story; list progressions in story order"
    ]);
  });
});

describe("progressions in a project", () => {
  test("a valid project passes validate, links, and the schema", () => {
    const { root } = progressionProject();
    expect(validateProject(root).errors).toEqual([]);
    expect(validateLinks(root).errors).toEqual([]);
    expect(checkProjectSchema(root)).toEqual([]);
  });

  test("the schema rejects a malformed entry", () => {
    const { root } = progressionProject({ maraProgressions: `  - from: chapter-02
    field: Status` });
    expect(checkProjectSchema(root)).toEqual([
      "$.characters[mara-finn].progressions[0]: missing required value",
      "$.characters[mara-finn].progressions[0].field: \"Status\" does not match ^[a-z0-9]+(?:-[a-z0-9]+)*$"
    ]);
  });

  test("validate reports bad entries in characters, locations, and factions", () => {
    const { root } = progressionProject({ maraProgressions: `  - from: chapter-03
    field: status
    value: missing
  - from: chapter-01
    field: aliases
    value: Mags` });
    writeMarkdown(path.join(root, "worldbuilding", "locations", "old-mill.md"), `
name: Old Mill
type: building
progressions:
  - from: chapter-02
    field: routes
    value: none
`, "# Old Mill\n");
    writeMarkdown(path.join(root, "worldbuilding", "factions", "river-guild.md"), `
name: River Guild
type: guild
status: active
progressions:
  - from: chapter-04
    field: status
    value: scattered
`, "# River Guild\n");
    expect(validateProject(root).errors).toEqual([
      "characters/mara-finn.md progressions[1] cannot change aliases, which is a list; a progression holds a single value",
      "characters/mara-finn.md progressions[1] from chapter-01 comes before progressions[0] from chapter-03 in the story; list progressions in story order",
      "worldbuilding/locations/old-mill.md progressions[0] cannot change routes, which is a list; a progression holds a single value",
      "worldbuilding/factions/river-guild.md progressions[0] status has unsupported value scattered"
    ]);
  });

  test("validate warns when a progression kills a character without died-in", () => {
    const deceased = `  - from: chapter-03
    field: status
    value: deceased`;
    const { root } = progressionProject({ maraProgressions: deceased });
    expect(validateProject(root).warnings).toContain("characters/mara-finn.md progressions[0] makes mara-finn deceased from chapter-03; set died-in: chapter-03 too so story continuity checks appearances after the death");
    const recorded = progressionProject({ maraProgressions: deceased, extraMara: "died-in: chapter-03\n" });
    expect(validateProject(recorded.root).warnings.filter((warning) => warning.includes("progressions"))).toEqual([]);
  });

  test("links reports unknown chapters and allows planned ones", () => {
    const { root } = progressionProject({ maraProgressions: `  - from: chapter-02
    field: status
    value: missing
  - from: chapter-2
    field: hair
    value: grey
  - from: Chapter-Five
    field: scar
    value: jaw
  - from: prologue
    field: limp
    value: true
  - from: chapter-20
    field: title
    value: queen` });
    expect(validateLinks(root).errors).toEqual([
      "characters/mara-finn.md progressions[1] references missing chapter chapter-2",
      "characters/mara-finn.md progressions[2] references chapter Chapter-Five which must be kebab-case",
      "characters/mara-finn.md progressions[3] references missing chapter prologue"
    ]);
  });

  test("entityStateAtChapter resolves each kind at a chapter", () => {
    const { root } = progressionProject();
    expect(entityStateAtChapter(root, "character", "mara-finn", "chapter-01").changes).toEqual([]);
    expect(entityStateAtChapter(root, "characters", "mara-finn", "chapter-03").state).toMatchObject({ status: "missing", role: "antagonist", arc: "the-drowning" });
    expect(entityStateAtChapter(root, "location", "old-mill", "chapter-02").state).toMatchObject({ status: "burned", "controlled-by": "river-guild" });
    expect(entityStateAtChapter(root, "faction", "river-guild", "chapter-03").state.status).toBe("active");
    expect(entityStateAtChapter(root, "faction", "river-guild", "chapter-04").state.status).toBe("disbanded");
  });

  test("entityStateAtChapter matches entityStateAt on a scanned project", () => {
    const { root } = progressionProject();
    const project = scanProject(root);
    const mara = project.characters.find((character) => character.id === "mara-finn");
    expect(entityStateAt(mara.frontmatter, "chapter-02", chapterChronology(project))).toEqual(entityStateAtChapter(root, "character", "mara-finn", "chapter-02"));
  });

  test("entityStateAtChapter refuses other kinds, unknown ids, and unreadable files", () => {
    const { root } = progressionProject();
    expect(() => entityStateAtChapter(root, "artifact", "lamp", "chapter-01")).toThrow("Only character, location, faction records carry progressions, not artifact");
    expect(() => entityStateAtChapter(root, "character", "nobody", "chapter-01")).toThrow("Unknown character nobody");
    expect(() => entityStateAtChapter(root, "character", "mara-finn", "prologue")).toThrow("Unknown chapter prologue");
    fs.writeFileSync(path.join(root, "worldbuilding", "factions", "river-guild.md"), "no frontmatter\n");
    expect(() => entityStateAtChapter(root, "faction", "river-guild", "chapter-01")).toThrow(`${path.join("worldbuilding", "factions", "river-guild.md")}: `);
    fs.writeFileSync(path.join(root, "chapters", "chapter-04.md"), "no frontmatter\n");
    expect(() => entityStateAtChapter(root, "character", "mara-finn", "chapter-01")).toThrow(`${path.join("chapters", "chapter-04.md")}: `);
  });

  test("story knowledge --at prints the character's state changes", () => {
    const { root, cwd } = progressionProject();
    const early = invoke(cwd, ["knowledge", "mara-finn", "--at", "chapter-01", "--path", root]);
    expect(early).toEqual({ code: 0, out: "No recorded knowledge for mara-finn at chapter-01\n", err: "" });
    const later = invoke(cwd, ["knowledge", "mara-finn", "--at", "chapter-03", "--path", root]);
    expect(later.code).toBe(0);
    expect(later.out).toBe([
      "No recorded knowledge for mara-finn at chapter-03",
      "State at chapter-03:",
      "- status: missing (from chapter-02, was alive)",
      "- role: antagonist (from chapter-03, was protagonist)",
      "- arc: the-drowning (from chapter-03)",
      ""
    ].join("\n"));
  });
});

describe("progressions follow reference rewrites", () => {
  test("move chapter rewrites progression chapters", () => {
    const { root } = progressionProject();
    moveEntity(root, { kind: "chapter", id: "chapter-04", number: 7 });
    expect(read(root, "worldbuilding", "factions", "river-guild.md")).toContain("  - from: chapter-07\n    field: status\n    value: disbanded\n");
    expect(read(root, "characters", "mara-finn.md")).toContain("  - from: chapter-02\n    field: status\n");
    expect(validateLinks(root).errors).toEqual([]);
    expect(validateProject(root).errors).toEqual([]);
  });

  test("move chapter puts progressions back in story order", () => {
    const { root } = progressionProject();
    moveEntity(root, { kind: "chapter", id: "chapter-02", number: 5 });
    const mara = read(root, "characters", "mara-finn.md");
    expect(mara.indexOf("from: chapter-03")).toBeLessThan(mara.indexOf("from: chapter-05"));
    expect(mara).toContain("  - from: chapter-05\n    field: status\n    value: missing\n");
    expect(validateProject(root).errors).toEqual([]);
    expect(entityStateAtChapter(root, "character", "mara-finn", "chapter-03").state.status).toBe("alive");
  });

  test("move chapter keeps a dated chapter's place in story time", () => {
    const { root } = progressionProject();
    // chapter-02 is a flash-forward dated after chapter-03, so moving it to
    // number 1 does not move it before chapter-03 in the story.
    writeChapter(root, 2, "date: 1901-05-01\n");
    writeChapter(root, 3, "date: 1900-05-01\n");
    writeMarkdown(path.join(root, "characters", "mara-finn.md"), `
name: Mara Finn
role: protagonist
status: alive
progressions:
  - from: chapter-03
    field: role
    value: antagonist
  - from: chapter-02
    field: status
    value: missing
`, "# Mara\n");
    moveEntity(root, { kind: "chapter", id: "chapter-01", number: 9 });
    moveEntity(root, { kind: "chapter", id: "chapter-02", number: 1 });
    const mara = read(root, "characters", "mara-finn.md");
    expect(mara.indexOf("from: chapter-03")).toBeLessThan(mara.indexOf("from: chapter-01"));
    expect(validateProject(root).errors.filter((error) => error.includes("progressions"))).toEqual([]);
  });

  test("sortProgressions orders by story time and keeps unknown chapters last", () => {
    const chronology = { numbers: new Map([["chapter-01", 1], ["chapter-02", 2]]), after: (later, earlier) => chronology.numbers.get(later) > chronology.numbers.get(earlier) };
    const list = [{ from: "typo" }, { from: "chapter-02", field: "a" }, "junk", { from: "chapter-01" }, { from: "chapter-02", field: "b" }];
    expect(sortProgressions(list, chronology)).toEqual([{ from: "chapter-01" }, { from: "chapter-02", field: "a" }, { from: "chapter-02", field: "b" }, { from: "typo" }, "junk"]);
  });

  test("move chapter warns when a planned progression now names the moved chapter", () => {
    const { root } = progressionProject({ maraProgressions: `  - from: chapter-09
    field: title
    value: queen` });
    const result = moveEntity(root, { kind: "chapter", id: "chapter-04", number: 9 });
    expect(result.warnings).toEqual(["chapter-09 was already referenced before this move, and those references now point at the moved chapter: characters/mara-finn.md. Check them"]);
  });

  test("remove chapter refuses while a progression starts there", () => {
    const { root } = progressionProject();
    expect(() => removeEntity(root, { kind: "chapter", id: "chapter-04" })).toThrow(
      "chapter chapter-04 is still named by died-in, since, learned-in, or a progression's from in worldbuilding/factions/river-guild.md; an empty value there means before the story, and a progression needs the chapter it starts in, so point them at another chapter first"
    );
    expect(fs.existsSync(path.join(root, "chapters", "chapter-04.md"))).toBe(true);
  });

  test("rename rewrites an id held in a progression value", () => {
    const { root } = progressionProject();
    renameEntity(root, { kind: "faction", id: "river-guild", name: "Tide Guild" });
    renameEntity(root, { kind: "arc", id: "the-drowning", name: "The Undertow" });
    expect(read(root, "worldbuilding", "locations", "old-mill.md")).toContain("    field: controlled-by\n    value: tide-guild\n");
    expect(read(root, "characters", "mara-finn.md")).toContain("    field: arc\n    value: the-undertow\n");
    // A value that only looks like the id is left alone when its field is not a reference.
    expect(read(root, "characters", "mara-finn.md")).toContain("    field: status\n    value: missing\n");
  });

  test("remove clears a progression value that named the removed entity", () => {
    const { root } = progressionProject();
    removeEntity(root, { kind: "faction", id: "river-guild" });
    const mill = read(root, "worldbuilding", "locations", "old-mill.md");
    expect(mill).toContain("  - from: chapter-02\n    field: controlled-by\n    value: \"\"\n");
    expect(mill).toContain("  - from: chapter-02\n    field: status\n    value: burned\n");
    expect(validateProject(root).errors).toEqual([]);
    expect(entityStateAtChapter(root, "location", "old-mill", "chapter-02").state["controlled-by"]).toBe("");
  });
});

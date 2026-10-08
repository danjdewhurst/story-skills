import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { checkContinuity, normalizeKnowledge, QUESTION_CHAPTER_GAP } from "../src/continuity.js";
import {
  checkProjectContinuity,
  createEntity,
  createStoryProject,
  formatActionReport,
  knowledgeAtChapter,
  projectActions,
  reindexProject,
  renameEntity,
  scanProject,
  storyTimeline,
  validateLinks,
  validateProject
} from "../src/story.js";
import { formatTimeline } from "../src/timeline.js";
import { expectLinearTime, makeTempDir, writeMarkdown, messages, memoryIo } from "./helpers.js";

function writeChapter(root, number, frontmatter) {
  writeMarkdown(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), `
title: Chapter ${number}
number: ${number}
${frontmatter.trim()}
status: draft
word-count: 0
`, `# Chapter ${number}\n\n## Chapter Text\n\nWords.\n`);
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

function writeBaseScene(root, chapter, scene, fields = "") {
  writeMarkdown(path.join(root, "scenes", `chapter-${pad(chapter)}-scene-${pad(scene)}.md`), `
title: Scene ${chapter}.${scene}
chapter: chapter-${pad(chapter)}
scene: ${scene}
status: draft
${fields}
`, "# Scene\n");
}

function writeState(root, lists, currentChapter = 5) {
  writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: base
current-chapter: ${currentChapter}
${lists}
`, "# Continuity State\n");
}

function addRoutes(root, location, routes) {
  const file = path.join(root, "worldbuilding", "locations", `${location}.md`);
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.replace(/^---\n/, `---\nroutes:\n${routes.trim().split("\n").map((line) => `  ${line}`).join("\n")}\n`), "utf8");
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

function continuity(root) {
  return checkContinuity(scanProject(root));
}

function newProject(title = "Bugs") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

const EXAMPLES = path.resolve(import.meta.dir, "..", "examples");

// Rewrites a character's status and adds frontmatter lines such as died-in.
function setCharacter(root, id, status, extra = "") {
  const file = path.join(root, "characters", `${id}.md`);
  const text = fs.readFileSync(file, "utf8").replace(/^(died-in|revived-in): .*\n/gm, "").replace(/^status: .*$/m, `status: ${status}${extra ? `\n${extra}` : ""}`);
  fs.writeFileSync(file, text, "utf8");
}

function findings(result) {
  return [...result.errors, ...result.warnings];
}

function setStatus(file, status) {
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^status: .*$/m, `status: ${status}`), "utf8");
}

// Characters ann and bob, locations alpha..delta, and drafted chapters
// that cast both of them.
function castProject(chapters = 5) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Base", force: false });
  for (const name of ["Ann", "Bob"]) {
    createEntity(root, { kind: "character", name });
  }
  for (const name of ["Alpha", "Beta", "Gamma", "Delta"]) {
    createEntity(root, { kind: "location", name });
  }
  for (let number = 1; number <= chapters; number += 1) {
    writeBaseChapter(root, number, "characters:\n  - ann\n  - bob");
  }
  writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: base
current-chapter: ${chapters}
`, "# Continuity State\n");
  return root;
}

function sighting(location, time = "\"10:00\"") {
  return `date: 2024-05-01\ntime: ${time}\nlocation: ${location}\ncharacters:\n  - ann`;
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("continuity checks", () => {
  test("flags dead characters, cast mismatches, and numbering gaps", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Deaths", force: false });
    const root = created.root;

    writeMarkdown(path.join(root, "characters", "edran-vale.md"), `
name: Edran Vale
role: supporting
status: deceased
died-in: chapter-01
`, "# Edran\n");
    writeMarkdown(path.join(root, "characters", "liv-marsh.md"), `
name: Liv Marsh
role: supporting
status: alive
died-in: chapter-01
`, "# Liv\n");
    writeMarkdown(path.join(root, "characters", "ghost-orin.md"), `
name: Ghost Orin
role: minor
status: deceased
died-in: chapter-09
`, "# Orin\n");
    writeMarkdown(path.join(root, "characters", "mara-finn.md"), `
name: Mara Finn
role: protagonist
status: alive
`, "# Mara\n");
    writeMarkdown(path.join(root, "characters", "old-tomas.md"), `
name: Old Tomas
role: minor
status: alive
`, "# Tomas\n");
    writeMarkdown(path.join(root, "characters", "stray-soul.md"), `
name: Stray Soul
role: minor
status: alive
`, "# Stray\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "old-mill.md"), `
name: Old Mill
type: building
`, "# Mill\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "elsewhere-lane.md"), `
name: Elsewhere Lane
type: street
`, "# Lane\n");

    writeChapter(root, 1, `
pov: mara-finn
locations:
  - old-mill
characters:
  - edran-vale
  - liv-marsh
  - mara-finn
`);
    writeChapter(root, 2, `
pov: mara-finn
locations:
  - old-mill
characters:
  - edran-vale
`);
    writeChapter(root, 3, `
pov: edran-vale
locations: []
characters: []
mentions:
  - edran-vale
  - old-tomas
  - nobody-here
`);
    writeChapter(root, 5, `
pov: mara-finn
locations: []
characters:
  - mara-finn
`);

    writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), `
title: Opening
chapter: chapter-01
scene: 1
pov: mara-finn
location: old-mill
characters:
  - edran-vale
status: draft
state-changes: []
`, "# Opening\n");
    writeMarkdown(path.join(root, "scenes", "chapter-02-scene-01.md"), `
title: Aftermath
chapter: chapter-02
scene: 1
pov: edran-vale
location: elsewhere-lane
characters:
  - edran-vale
status: draft
state-changes: []
`, "# Aftermath\n");
    writeMarkdown(path.join(root, "scenes", "chapter-03-scene-01.md"), `
title: Memorial
chapter: chapter-03
scene: 1
pov: ""
location: ""
characters:
  - old-tomas
status: draft
state-changes: []
`, "# Memorial\n");
    writeMarkdown(path.join(root, "scenes", "chapter-05-scene-01.md"), `
title: Stray
chapter: chapter-05
scene: 1
pov: ""
location: old-mill
characters:
  - stray-soul
status: draft
state-changes: []
`, "# Stray\n");
    writeMarkdown(path.join(root, "scenes", "chapter-77-scene-01.md"), `
title: Orphan
chapter: chapter-77
scene: 1
pov: ""
location: ""
characters: []
mentions:
  - nobody-scene
status: draft
state-changes: []
`, "# Orphan\n");

    writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: deaths
current-chapter: 0
`, "# Continuity State\n");

    const result = checkContinuity(scanProject(root));
    const errors = messages(result.errors).join("\n");
    const warnings = messages(result.warnings).join("\n");

    expect(result.ok).toBe(false);
    expect(errors).toContain("characters/liv-marsh.md has died-in chapter-01 but status alive; set status: deceased");
    expect(errors).toContain("characters/ghost-orin.md died-in references missing chapter chapter-09");
    expect(errors).toContain("chapters/chapter-02.md lists edran-vale, who died in chapter-01");
    // Chapter 3 lists its dead POV in mentions: a posthumous narrator (#172).
    expect(errors).not.toContain("chapters/chapter-03.md lists edran-vale");
    expect(errors).toContain("scenes/chapter-02-scene-01.md lists edran-vale, who died in chapter-01");
    expect(warnings).not.toContain("chapters/chapter-03.md POV character edran-vale is not listed in characters");
    expect(warnings).toContain("scenes/chapter-01-scene-01.md POV character mara-finn is not listed in characters");
    expect(warnings).toContain("scenes/chapter-05-scene-01.md lists stray-soul but chapters/chapter-05.md does not list them in characters or mentions");
    expect(warnings).toContain("scenes/chapter-02-scene-01.md is set in elsewhere-lane but chapters/chapter-02.md does not list that location");
    expect(warnings).toContain("Chapter numbering skips from 3 to 5");
    expect(warnings).toContain("continuity/state.md current-chapter 0 is behind the latest chapter 5");
    expect(warnings).not.toContain("chapter-03-scene-01.md lists old-tomas");

    expect(checkProjectContinuity(root).ok).toBe(false);
    expect(messages(validateProject(root).errors).join("\n")).not.toContain("died-in");

    const links = messages(validateLinks(root).errors).join("\n");
    expect(links).toContain("chapters/chapter-03.md references missing character or artifact nobody-here");
    expect(links).toContain("scenes/chapter-77-scene-01.md references missing character or artifact nobody-scene");
  });

  test("flags promise, question, completion, and durable state contradictions", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Promises", force: false });
    const root = created.root;
    fs.writeFileSync(
      path.join(root, "story.md"),
      fs.readFileSync(path.join(root, "story.md"), "utf8").replace("status: planning", "status: complete"),
      "utf8"
    );

    for (const number of [1, 2, 3, 4]) {
      writeChapter(root, number, "pov: \"\"\nlocations: []\ncharacters: []");
    }
    writeMarkdown(path.join(root, "characters", "kira-snow.md"), `
name: Kira Snow
role: protagonist
status: alive
`, "# Kira\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "salt-row.md"), `
name: Salt Row
type: street
`, "# Salt Row\n");
    writeMarkdown(path.join(root, "worldbuilding", "factions", "tide-guild.md"), `
name: Tide Guild
type: guild
status: active
`, "# Guild\n");
    writeMarkdown(path.join(root, "worldbuilding", "artifacts", "silver-key.md"), `
name: Silver Key
type: object
status: hidden
`, "# Key\n");

    writeMarkdown(path.join(root, "continuity", "promises", "long-fuse.md"), `
title: Long Fuse
status: planted
planted: chapter-01
payoff: ""
`, "# Long Fuse\n");
    writeMarkdown(path.join(root, "continuity", "promises", "backwards-payoff.md"), `
title: Backwards Payoff
status: paid-off
planted: chapter-03
payoff: chapter-02
`, "# Backwards\n");
    writeMarkdown(path.join(root, "continuity", "promises", "missing-payoff.md"), `
title: Missing Payoff
status: paid-off
planted: ""
payoff: ""
`, "# Missing\n");
    writeMarkdown(path.join(root, "continuity", "promises", "unrooted-plant.md"), `
title: Unrooted Plant
status: planted
planted: ""
payoff: ""
`, "# Unrooted\n");
    writeMarkdown(path.join(root, "continuity", "promises", "early-record.md"), `
title: Early Record
status: planned
planted: chapter-02
payoff: ""
`, "# Early\n");

    writeMarkdown(path.join(root, "continuity", "questions", "reversed.md"), `
title: Reversed
status: resolved
introduced: chapter-03
resolved: chapter-02
`, "# Reversed\n");
    writeMarkdown(path.join(root, "continuity", "questions", "unanchored.md"), `
title: Unanchored
status: answered
introduced: chapter-01
resolved: ""
`, "# Unanchored\n");
    writeMarkdown(path.join(root, "continuity", "questions", "lingering.md"), `
title: Lingering
status: open
introduced: chapter-01
resolved: chapter-02
`, "# Lingering\n");

    writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: promises
current-chapter: 7
character-state:
  - loose-note
  - character: missing-person
  - character: kira-snow
    location: nowhere-bay
  - character: kira-snow
    location: salt-row
knowledge-state:
  - character: ""
    knows: a secret
  - character: kira-snow
    knows: ""
  - character: kira-snow
    knows: the key is real
    learned-in: chapter-09
object-state:
  - artifact: ghost-item
  - artifact: silver-key
    owner: nobody-known
  - artifact: silver-key
    owner: tide-guild
    location: nowhere-bay
  - artifact: silver-key
    owner: kira-snow
    location: salt-row
    status: active
`, "# Continuity State\n");

    const result = checkContinuity(scanProject(root));
    const errors = messages(result.errors).join("\n");
    const warnings = messages(result.warnings).join("\n");

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(20);
    expect(result.warnings).toHaveLength(6);
    expect(errors).toContain("continuity/promises/backwards-payoff.md pays off in chapter-02 before it is planted in chapter-03");
    expect(errors).toContain("continuity/promises/missing-payoff.md is paid-off but has no payoff chapter");
    expect(errors).toContain("continuity/promises/unrooted-plant.md is planted but has no planted chapter");
    expect(errors).toContain("continuity/questions/reversed.md resolves in chapter-02 before it is introduced in chapter-03");
    expect(errors).toContain("continuity/questions/unanchored.md is answered but has no resolved chapter");
    expect(errors).toContain("continuity/questions/lingering.md records resolved chapter chapter-02 but status is still open");
    expect(errors).toContain("story.md is complete but continuity/promises/long-fuse.md is still planted");
    expect(errors).toContain("story.md is complete but continuity/promises/early-record.md is still planned");
    expect(errors).toContain("story.md is complete but continuity/questions/lingering.md is still open");
    expect(errors).toContain("continuity/state.md current-chapter 7 is ahead of the latest chapter 4");
    expect(errors).toContain("continuity/state.md character-state[0] must be a mapping");
    expect(errors).toContain("continuity/state.md character-state[1] references missing character missing-person");
    expect(errors).toContain("continuity/state.md character-state[2] references missing location nowhere-bay");
    expect(errors).toContain("continuity/state.md knowledge-state[0] references missing character (unset)");
    expect(errors).toContain("continuity/state.md knowledge-state[1] is missing knows");
    expect(errors).toContain("continuity/state.md knowledge-state[2] references missing chapter chapter-09");
    expect(errors).toContain("continuity/state.md object-state[0] references missing artifact ghost-item");
    expect(errors).toContain("continuity/state.md object-state[1] references missing owner nobody-known");
    expect(errors).toContain("continuity/state.md object-state[2] references missing location nowhere-bay");
    expect(warnings).toContain("continuity/promises/long-fuse.md was planted in chapter-01, 3 chapters ago, and has no payoff yet");
    expect(warnings).toContain("continuity/promises/early-record.md records planted chapter chapter-02 but status is still planned");
    expect(warnings).toContain("continuity/state.md object-state[3] status active conflicts with worldbuilding/artifacts/silver-key.md status hidden");

    const actionReport = formatActionReport(projectActions(root));
    expect(actionReport).toContain("Fix continuity contradictions");
    expect(actionReport).toContain("Review continuity warnings");
  });

  test("passes clean projects and skips missing continuity state", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Clean", force: false });

    const clean = checkContinuity(scanProject(created.root));
    expect(clean).toEqual({ ok: true, errors: [], warnings: [], dismissed: [] });

    writeMarkdown(path.join(created.root, "characters", "lone-scribe.md"), `
name: Lone Scribe
role: protagonist
status: alive
`, "# Scribe\n");
    // A hand-written file is missing from the registry until reindex, and
    // that validate warning is an action of its own.
    expect(formatActionReport(projectActions(created.root))).toContain("Review validation warnings");
    reindexProject(created.root);
    expect(formatActionReport(projectActions(created.root))).toContain("Project is mechanically healthy");

    fs.rmSync(path.join(created.root, "continuity", "state.md"));
    expect(checkContinuity(scanProject(created.root)).ok).toBe(true);
  });

  test("warns when a scene location is missing from a chapter with no locations", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Empty Locations", force: false });
    const root = created.root;

    writeMarkdown(path.join(root, "worldbuilding", "locations", "old-mill.md"), `
name: Old Mill
type: building
`, "# Mill\n");
    writeChapter(root, 1, 'pov: ""\nlocations: []\ncharacters: []');
    writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), `
title: Opening
chapter: chapter-01
scene: 1
pov: ""
location: old-mill
characters: []
status: draft
state-changes: []
`, "# Opening\n");

    const result = checkContinuity(scanProject(root));
    expect(messages(result.warnings).join("\n")).toContain("scenes/chapter-01-scene-01.md is set in old-mill but chapters/chapter-01.md does not list that location");
  });

  test("checks knowledge fact ids are kebab-case and unique per character", () => {
    const cwd = makeTempDir();
    const root = createStoryProject({ cwd, title: "Facts" }).root;
    for (const id of ["ana-roe", "ben-roe"]) {
      writeMarkdown(path.join(root, "characters", `${id}.md`), `name: ${id}\nrole: supporting\nstatus: alive`, "# Character\n");
    }
    writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: facts
current-chapter: 0
character-state: []
object-state: []
knowledge-state:
  - character: ana-roe
    knows: the mill was burned
    fact: mill-was-burned
  - character: ben-roe
    knows: the mill was burned
    fact: mill-was-burned
  - character: ana-roe
    knows: the mill was burned, again
    fact: mill-was-burned
  - character: ana-roe
    knows: something vague
    fact: Not Kebab
  - character: ana-roe
    knows: an empty id
    fact: ""
  - character: ben-roe
    knows: a numbered secret
    fact: 42
  - character: ben-roe
    knows: no id at all
`, "# State\n");

    expect(messages(checkProjectContinuity(root).errors)).toEqual([
      "continuity/state.md knowledge-state[2] repeats fact mill-was-burned for ana-roe from knowledge-state[0]",
      "continuity/state.md knowledge-state[3] fact Not Kebab must be a kebab-case id",
      "continuity/state.md knowledge-state[4] fact (empty) must be a kebab-case id"
    ]);
  });

  test("knowledge text drops its closing stops in linear time", () => {
    expect(normalizeKnowledge("  The Key  Is Lost...!! ")).toBe("the key is lost");
    expect(normalizeKnowledge("Wait... the key is lost")).toBe("wait... the key is lost");
    expectLinearTime(normalizeKnowledge, (n) => `${".".repeat(n)}x`);
  });
});

describe("timeline and the clock", () => {
  test("travel-hours errors print rounded hours (#80)", () => {
    const root = baseProject(1);
    writeBaseScene(root, 1, 1, "date: 2024-01-01\ntime: \"10:00\"");
    writeBaseScene(root, 1, 2, "date: 2024-01-01\ntime: \"10:20\"\ntravel-hours: 1");
    expect(messages(continuity(root).errors)).toEqual(["scenes/chapter-01-scene-02.md allows only 0.3h for travel of 1h"]);
  });

  test("an untimed scene does not become the reference point (#154)", () => {
    const root = baseProject(2);
    writeBaseScene(root, 1, 1, "date: 2024-05-01\ntime: \"20:00\"");
    writeBaseScene(root, 2, 1, "date: 2024-05-01");
    writeBaseScene(root, 2, 2, "date: 2024-05-01\ntime: \"08:00\"");
    expect(messages(continuity(root).warnings)).toEqual(["scenes/chapter-02-scene-02.md timestamp runs backward"]);
  });

  test("a flashback does not become the reference point (#154)", () => {
    const root = baseProject(5);
    writeBaseScene(root, 1, 1, "date: 2024-05-01\ntime: \"10:00\"");
    writeBaseScene(root, 2, 1, "date: 2020-01-01\ntime: \"09:00\"\nflashback-to: the war");
    writeBaseScene(root, 3, 1, "date: 2024-05-01\ntime: \"11:00\"\ntravel-hours: 30");
    writeBaseScene(root, 4, 1, "date: 2024-04-15\ntime: \"11:00\"");
    writeBaseScene(root, 4, 2, "date: 2020-01-02\nflashback-to: the war again");
    writeBaseScene(root, 5, 1, "date: 2024-04-20\ntime: \"11:00\"");
    const result = continuity(root);
    expect(messages(result.errors)).toEqual(["scenes/chapter-03-scene-01.md allows only 1h for travel of 30h"]);
    expect(messages(result.warnings).sort()).toEqual([
      "scenes/chapter-02-scene-01.md timestamp runs backward",
      "scenes/chapter-04-scene-01.md timestamp runs backward",
      "scenes/chapter-04-scene-02.md timestamp runs backward",
      "scenes/chapter-05-scene-01.md timestamp runs backward"
    ]);
  });

  test("a dated flashback scene does not date its undated chapter (#699)", () => {
    const root = castProject(3);
    writeBaseChapter(root, 1, "characters:\n  - ann\n  - bob\ndate: 2024-05-01");
    writeBaseChapter(root, 2, "characters:\n  - ann\n  - bob\ndate: 2024-05-02");
    setCharacter(root, "ann", "deceased", "died-in: chapter-02");
    writeBaseScene(root, 3, 1, "date: 2001-01-01\nflashback-to: the night of the fire");
    expect(messages(continuity(root).errors)).toEqual(["chapters/chapter-03.md lists ann, who died in chapter-02; move posthumous appearances to mentions"]);
  });

  test("a promise or clue planted in a chapter with no file still gets the payoff gap warning (#701)", () => {
    const root = baseProject(5);
    fs.rmSync(path.join(root, "chapters", "chapter-02.md"));
    writeMarkdown(path.join(root, "continuity", "promises", "the-lantern.md"), "title: The lantern\nstatus: planted\nplanted: chapter-02", "# The lantern\n");
    writeMarkdown(path.join(root, "continuity", "clues", "the-lamp.md"), "title: The lamp\nstatus: planted\nplanted: chapter-02", "# The lamp\n");
    expect(messages(continuity(root).warnings).filter((message) => message.includes("has no payoff yet")).sort()).toEqual([
      "continuity/clues/the-lamp.md was planted in chapter-02, 3 chapters ago, and has no payoff yet",
      "continuity/promises/the-lantern.md was planted in chapter-02, 3 chapters ago, and has no payoff yet"
    ]);
  });

  test("a flash-forward prologue gives one warning and later chapters are still checked (#156)", () => {
    const root = baseProject(5);
    writeBaseChapter(root, 1, "date: 2034-01-01");
    writeBaseChapter(root, 2, "date: 2024-05-02");
    writeBaseChapter(root, 3, "date: 2024-05-03");
    writeBaseChapter(root, 4, "date: 2024-05-01");
    writeBaseChapter(root, 5, "date: 2024-05-05");
    expect(messages(continuity(root).warnings)).toEqual([
      "Chapter 2 date 2024-05-02 is earlier than Chapter 1 date 2034-01-01",
      "Chapter 4 date 2024-05-01 is earlier than Chapter 3 date 2024-05-03"
    ]);
    writeMarkdown(path.join(root, "continuity", "exemptions.md"), `
type: exemption-log
exemptions:
  - pattern: "than Chapter 1 date 2034-01-01"
    reason: "Chapter 1 is a flash-forward prologue"
`);
    const exempted = continuity(root);
    expect(messages(exempted.warnings)).toEqual(["Chapter 4 date 2024-05-01 is earlier than Chapter 3 date 2024-05-03"]);
    expect(exempted.dismissed).toHaveLength(1);
  });

  test("malformed times are reported on undated scenes and chapters, and undated travel-hours warns (#159)", () => {
    const root = baseProject(2);
    writeBaseScene(root, 1, 1, "time: \"25:99\"");
    writeBaseScene(root, 1, 2, "date: 2024-05-01\ntime: \"10:00\"");
    writeBaseScene(root, 1, 3, "time: \"11:00\"\ntravel-hours: 50");
    writeBaseChapter(root, 2, "time: teatime");
    const warnings = messages(continuity(root).warnings);
    expect(warnings).toContain("scenes/chapter-01-scene-01.md has malformed time \"25:99\"");
    expect(warnings).toContain("Chapter 2 has malformed time \"teatime\"");
    expect(warnings).toContain("scenes/chapter-01-scene-03.md has travel-hours but no date, so the clock check skips it");
  });

  test("an undated scene with travel-hours 0 gets no travel-hours warning", () => {
    const root = baseProject(2);
    writeBaseScene(root, 1, 1, "travel-hours: 0");
    const warnings = messages(continuity(root).warnings);
    expect(warnings.filter((message) => message.includes("travel-hours"))).toEqual([]);
  });
});

describe("setup ordering and Chekhov gaps", () => {
  test("a setup planted after its payoff is flagged when the planted chapter is unwritten (#82)", () => {
    const root = baseProject(3);
    writeMarkdown(path.join(root, "continuity", "promises", "gun.md"), `
title: Gun
status: planned
planted: chapter-12
payoff: chapter-03
`, "# Gun\n");
    writeMarkdown(path.join(root, "continuity", "clues", "knife.md"), `
title: Knife
status: planned
planted: chapter-09
payoff: chapter-02
`, "# Knife\n");
    const errors = messages(continuity(root).errors);
    expect(errors).toContain("continuity/promises/gun.md pays off in chapter-03 before it is planted in chapter-12");
    expect(errors).toContain("continuity/clues/knife.md pays off in chapter-02 before it is planted in chapter-09");
  });

  test("the unpaid-setup gap counts chapter positions, not numbers (#85)", () => {
    const root = baseProject(2);
    writeBaseChapter(root, 10);
    writeMarkdown(path.join(root, "continuity", "promises", "p.md"), `
title: P
status: planted
planted: chapter-02
payoff: ""
`, "# P\n");
    writeState(root, "", 10);
    expect(messages(continuity(root).warnings).join("\n")).not.toContain("chapters ago");

    writeBaseChapter(root, 3);
    writeBaseChapter(root, 4);
    writeMarkdown(path.join(root, "continuity", "promises", "p.md"), `
title: P
status: planted
planted: chapter-01
payoff: ""
`, "# P\n");
    expect(messages(continuity(root).warnings)).toContain("continuity/promises/p.md was planted in chapter-01, 4 chapters ago, and has no payoff yet");
  });
});

describe("unanswered questions (#347)", () => {
  function writeQuestion(root, id, fields) {
    writeMarkdown(path.join(root, "continuity", "questions", `${id}.md`), `
title: ${id}
${fields}
`, `# ${id}\n`);
  }

  function setStoryStatus(root, status) {
    const file = path.join(root, "story.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^status: .*$/m, `status: ${status}`), "utf8");
  }

  test("an open question warns after the wide gap and stays a warning", () => {
    const root = baseProject(QUESTION_CHAPTER_GAP);
    writeQuestion(root, "who-kept-the-key", `
status: open
introduced: chapter-01
resolved: ""
`);
    expect(continuity(root)).toMatchObject({ ok: true, errors: [], warnings: [] });

    writeBaseChapter(root, QUESTION_CHAPTER_GAP + 1);
    writeState(root, "character-state: []\nobject-state: []\nknowledge-state: []", QUESTION_CHAPTER_GAP + 1);
    const result = continuity(root);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([{
      code: "question-unanswered",
      message: `continuity/questions/who-kept-the-key.md was introduced in chapter-01, ${QUESTION_CHAPTER_GAP} chapters ago, and has no resolution yet`,
      file: "continuity/questions/who-kept-the-key.md",
      chapter: null
    }]);
  });

  test("outline chapters ahead and numbering gaps do not age a question", () => {
    const root = baseProject(2);
    writeQuestion(root, "who-kept-the-key", `
status: open
introduced: chapter-01
resolved: ""
`);
    writeBaseChapter(root, 30, "", "outline");
    expect(messages(continuity(root).warnings).join("\n")).not.toContain("has no resolution yet");

    writeBaseChapter(root, 40);
    expect(messages(continuity(root).warnings).join("\n")).not.toContain("has no resolution yet");
  });

  test("a question introduced in an outline chapter does not age until that chapter is drafted", () => {
    const root = baseProject(QUESTION_CHAPTER_GAP + 1);
    writeBaseChapter(root, 1, "", "outline");
    writeQuestion(root, "who-kept-the-key", `
status: open
introduced: chapter-01
resolved: ""
`);
    expect(messages(continuity(root).warnings).join("\n")).not.toContain("has no resolution yet");

    writeBaseChapter(root, 1);
    expect(messages(continuity(root).warnings)).toContain(
      `continuity/questions/who-kept-the-key.md was introduced in chapter-01, ${QUESTION_CHAPTER_GAP} chapters ago, and has no resolution yet`
    );
  });

  test("a resolved, dropped, abandoned, or unintroduced question does not warn", () => {
    const root = baseProject(QUESTION_CHAPTER_GAP + 1);
    writeQuestion(root, "answered", `
status: answered
introduced: chapter-01
resolved: chapter-02
`);
    writeQuestion(root, "dropped", `
status: dropped
introduced: chapter-01
resolved: ""
`);
    writeQuestion(root, "abandoned", `
status: abandoned
introduced: chapter-01
resolved: ""
`);
    writeQuestion(root, "unplaced", `
status: open
introduced: ""
resolved: ""
`);
    writeQuestion(root, "scheduled", `
status: open
introduced: chapter-99
resolved: ""
`);
    expect(messages(continuity(root).warnings).join("\n")).not.toContain("has no resolution yet");
    expect(messages(continuity(root).errors)).toEqual([]);
  });

  test("an open question that already names a resolved chapter stays an error, with no gap warning", () => {
    const root = baseProject(QUESTION_CHAPTER_GAP + 1);
    writeQuestion(root, "lingering", `
status: open
introduced: chapter-01
resolved: chapter-02
`);
    const result = continuity(root);
    expect(result.ok).toBe(false);
    expect(messages(result.errors)).toEqual([
      "continuity/questions/lingering.md records resolved chapter chapter-02 but status is still open"
    ]);
    expect(messages(result.warnings).join("\n")).not.toContain("has no resolution yet");
  });

  test("a deliberate hold is exempted the way an unpaid promise is", () => {
    const root = baseProject(QUESTION_CHAPTER_GAP + 1);
    writeQuestion(root, "who-kept-the-key", `
status: open
introduced: chapter-01
resolved: ""
`);
    writeQuestion(root, "where-is-the-boat", `
status: open
introduced: chapter-01
resolved: ""
`);
    writeMarkdown(path.join(root, "continuity", "exemptions.md"), `
type: exemption-log
story: base
exemptions:
  - code: question-unanswered
    file: continuity/questions/who-kept-the-key.md
    reason: Pays off in book two
`, "# Exemptions\n");
    const result = continuity(root);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((finding) => finding.file)).toEqual(["continuity/questions/where-is-the-boat.md"]);
    expect(result.dismissed).toEqual([{
      finding: expect.objectContaining({ code: "question-unanswered", file: "continuity/questions/who-kept-the-key.md" }),
      reason: "Pays off in book two",
      index: 0
    }]);
  });

  test("completing the book is an error whether or not the gap has passed", () => {
    const short = baseProject(3);
    writeQuestion(short, "who-kept-the-key", `
status: open
introduced: chapter-01
resolved: ""
`);
    setStoryStatus(short, "complete");
    const early = continuity(short);
    expect(early.ok).toBe(false);
    expect(messages(early.errors)).toEqual([
      "story.md is complete but continuity/questions/who-kept-the-key.md is still open"
    ]);
    expect(messages(early.warnings).join("\n")).not.toContain("has no resolution yet");

    const root = baseProject(QUESTION_CHAPTER_GAP + 1);
    writeQuestion(root, "who-kept-the-key", `
status: open
introduced: chapter-01
resolved: ""
`);
    setStoryStatus(root, "complete");
    const done = continuity(root);
    expect(done.ok).toBe(false);
    expect(messages(done.errors)).toEqual([
      "story.md is complete but continuity/questions/who-kept-the-key.md is still open"
    ]);
    expect(messages(done.warnings)).toEqual([
      `continuity/questions/who-kept-the-key.md was introduced in chapter-01, ${QUESTION_CHAPTER_GAP} chapters ago, and has no resolution yet`
    ]);
  });
});

describe("continuity state", () => {
  test("repeated character and artifact entries warn, and custody reports once (#157)", () => {
    const root = baseProject(5);
    writeState(root, `
character-state:
  - character: ann
    location: alpha
  - character: ann
    location: beta
object-state:
  - artifact: ring
    status: lost
    since: chapter-03
  - artifact: ring
    status: destroyed
    since: chapter-03
`);
    writeBaseScene(root, 5, 1, "state-changes:\n  - target: ring\n    change: used again");
    const result = continuity(root);
    expect(messages(result.warnings)).toContain("continuity/state.md character-state[1] repeats character ann from character-state[0]; keep one entry per character");
    expect(messages(result.warnings)).toContain("continuity/state.md object-state[1] repeats artifact ring from object-state[0]; keep one entry per artifact per since chapter");
    expect(messages(result.errors).filter((error) => error.includes("uses ring"))).toEqual([
      "scenes/chapter-05-scene-01.md uses ring, destroyed/lost since chapter-03"
    ]);
  });

  test("validate checks object-state status and near-miss keys; custody ignores status case (#158)", () => {
    const root = baseProject(5);
    const ring = path.join(root, "worldbuilding", "artifacts", "ring.md");
    fs.writeFileSync(ring, fs.readFileSync(ring, "utf8").replace(/^status: .*$/m, "status: destroyed"), "utf8");
    writeState(root, `
object-state:
  - artifact: ring
    status: Destroyed
    since: chapter-02
  - artifact: ring
    status: active
    since: chapter-99
knowledge-state:
  - character: ann
    knows: the vault code
    learned_in: chapter-04
`);
    const bob = path.join(root, "characters", "bob.md");
    fs.writeFileSync(bob, fs.readFileSync(bob, "utf8").replace(/^status: .*$/m, "status: deceased\ndied_in: chapter-04"), "utf8");
    writeBaseScene(root, 5, 1, "state-changes:\n  - target: ring\n    change: used again");

    const validation = validateProject(root);
    expect(messages(validation.errors)).toContain("continuity/state.md object-state[0] status must be one of active, lost, destroyed, hidden, transferred, unknown, got Destroyed");
    expect(messages(validation.warnings)).toContain("continuity/state.md knowledge-state[0] has learned_in; did you mean learned-in?");
    expect(messages(validation.warnings)).toContain("characters/bob.md has died_in; did you mean died-in?");

    const result = continuity(root);
    expect(messages(result.errors)).toContain("scenes/chapter-05-scene-01.md uses ring, destroyed/lost since chapter-02");
    expect(messages(result.errors)).toContain("continuity/state.md object-state[1] references missing since chapter chapter-99");
  });

  test("a repeated fact with no character does not print undefined (#161)", () => {
    const root = baseProject(2);
    writeState(root, `
knowledge-state:
  - knows: a
    fact: orphan-fact
  - knows: b
    fact: orphan-fact
`);
    const errors = messages(continuity(root).errors).join("\n");
    expect(errors).not.toContain("undefined");
    expect(errors).toContain("knowledge-state[1] references missing character (unset)");
  });

  test("numeric and boolean ids resolve as strings (#169)", () => {
    const root = baseProject(4);
    createEntity(root, { kind: "character", name: "47" });
    createEntity(root, { kind: "artifact", name: "1984" });
    writeState(root, `
object-state:
  - artifact: 1984
    owner: 47
    status: active
knowledge-state:
  - character: 47
    knows: x
`, 4);
    const artifact = path.join(root, "worldbuilding", "artifacts", "1984.md");
    fs.writeFileSync(artifact, fs.readFileSync(artifact, "utf8").replace(/^status: .*$/m, "status: active"), "utf8");
    const errors = messages(continuity(root).errors).join("\n");
    expect(errors).not.toContain("references missing");
    expect(knowledgeAtChapter(root, "47", "chapter-04")).toEqual([{ knows: "x", learnedIn: "", audience: "reader" }]);

    const character = path.join(root, "characters", "47.md");
    fs.writeFileSync(character, fs.readFileSync(character, "utf8").replace(/^status: .*$/m, "status: deceased\ndied-in: chapter-02"), "utf8");
    writeBaseChapter(root, 3, "characters:\n  - 47");
    expect(messages(continuity(root).errors)).toContain("chapters/chapter-03.md lists 47, who died in chapter-02; move posthumous appearances to mentions");

    addRoutes(root, "alpha", "- to: 1066\n  hours: 2");
    createEntity(root, { kind: "location", name: "1066" });
    expect(messages(validateProject(root).errors).join("\n")).not.toContain("route is missing to");

    renameEntity(root, { kind: "character", id: "47", name: "Agent Forty" });
    const state = fs.readFileSync(path.join(root, "continuity", "state.md"), "utf8");
    expect(state).toContain("owner: agent-forty");
    expect(state).toContain("character: agent-forty");
  });
});

describe("#224 chapter numbering that starts after 1", () => {
  test("continuity warns when chapters before the first are missing", () => {
    const root = newProject();
    for (const number of [3, 4, 6]) {
      createEntity(root, { kind: "chapter", name: `C${number}`, number });
    }
    const warnings = messages(checkProjectContinuity(root).warnings);
    expect(warnings).toContain("Chapter numbering starts at 3, not 1");
    expect(warnings).toContain("Chapter numbering skips from 4 to 6");
  });

  test("a book starting at chapter 1 gets no start warning", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    expect(messages(checkProjectContinuity(root).warnings).filter((warning) => warning.includes("starts at"))).toEqual([]);
  });
});

describe("resurrection, narrators, planned deaths (#172)", () => {
  test("revived-in ends the dead window", () => {
    const root = baseProject(5);
    setCharacter(root, "ann", "alive", "died-in: chapter-02\nrevived-in: chapter-04");
    writeBaseChapter(root, 3, "characters:\n  - ann");
    writeBaseChapter(root, 4, "characters:\n  - ann");
    writeBaseChapter(root, 5, "pov: ann\ncharacters:\n  - ann");
    const result = continuity(root);
    expect(messages(result.errors)).toEqual(["chapters/chapter-03.md lists ann, who died in chapter-02; move posthumous appearances to mentions"]);
  });

  test("revived-in must follow died-in, needs died-in, and a written revival is not deceased", () => {
    const root = baseProject(5);
    setCharacter(root, "ann", "alive", "revived-in: chapter-03");
    setCharacter(root, "bob", "deceased", "died-in: chapter-04\nrevived-in: chapter-02");
    let errors = messages(continuity(root).errors);
    expect(errors).toContain("characters/ann.md has revived-in chapter-03 but no died-in; set died-in or remove revived-in");
    expect(errors).toContain("characters/bob.md is revived in chapter-02, not after dying in chapter-04");

    setCharacter(root, "bob", "deceased", "died-in: chapter-01\nrevived-in: chapter-09");
    expect(messages(continuity(root).errors)).toContain("characters/bob.md revived-in references missing chapter chapter-09");
    const file = path.join(root, "characters", "bob.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("revived-in: chapter-09", "revived-in: chapter-03"), "utf8");
    errors = messages(continuity(root).errors);
    expect(errors).toContain("characters/bob.md has revived-in chapter-03 but status deceased; set status: alive");
  });

  test("revived-in is a checked, renamed chapter reference", () => {
    const root = baseProject(3);
    setCharacter(root, "ann", "alive", "died-in: chapter-01\nrevived-in: chapter-07");
    expect(messages(validateLinks(root).errors).join("\n")).toContain("characters/ann.md");
    setCharacter(root, "bob", "alive", "died-in: chapter-01\nrevived_in: chapter-02");
    expect(messages(validateProject(root).warnings).join("\n")).toContain("revived_in");
  });

  test("a dead POV listed in mentions narrates posthumously", () => {
    const root = baseProject(5);
    setCharacter(root, "bob", "deceased", "died-in: chapter-01");
    writeBaseChapter(root, 3, "pov: bob\nmentions:\n  - bob");
    writeBaseScene(root, 3, 1, "pov: bob\nmentions:\n  - bob");
    const result = continuity(root);
    expect(findings(result).filter((finding) => finding.includes("bob"))).toEqual([]);

    // A dead POV not in mentions is still posthumous.
    writeBaseChapter(root, 4, "pov: bob");
    expect(messages(continuity(root).errors)).toContain("chapters/chapter-04.md lists bob, who died in chapter-01; move posthumous appearances to mentions");
  });

  test("a death in an outline chapter is planned, so the character stays alive", () => {
    const root = baseProject(6);
    writeBaseChapter(root, 5, "", "outline");
    writeBaseChapter(root, 6, "pov: ann\ncharacters:\n  - ann");
    writeBaseScene(root, 6, 1, "characters:\n  - ann");
    setCharacter(root, "ann", "alive", "died-in: chapter-05");
    expect(messages(continuity(root).errors)).toEqual([]);

    writeBaseChapter(root, 5, "");
    const drafted = messages(continuity(root).errors);
    expect(drafted).toContain("characters/ann.md has died-in chapter-05 but status alive; set status: deceased");
    expect(drafted).toContain("chapters/chapter-06.md lists ann, who died in chapter-05; move posthumous appearances to mentions");
    expect(drafted).toContain("scenes/chapter-06-scene-01.md lists ann, who died in chapter-05; move posthumous appearances to mentions");
  });

  // Learning follows casts: an outline death is not in force until drafted.
  // Whether a fact learned in an outline chapter counts as known is issue 357,
  // and is not part of this.
  test("learning after an outline death waits for the death to be drafted", () => {
    const root = baseProject(6);
    writeBaseChapter(root, 5, "", "outline");
    writeBaseChapter(root, 6, "pov: ann\ncharacters:\n  - ann");
    setCharacter(root, "ann", "alive", "died-in: chapter-05");
    writeState(root, "knowledge-state:\n  - character: ann\n    knows: the plan\n    learned-in: chapter-06", 6);
    const learned = "continuity/state.md knowledge-state[0] has ann learn something in chapter-06, after they died in chapter-05";
    expect(messages(continuity(root).errors)).not.toContain(learned);

    writeBaseChapter(root, 5, "");
    setCharacter(root, "ann", "deceased", "died-in: chapter-05");
    expect(messages(continuity(root).errors)).toContain(learned);
  });
});

describe("loss windows (#172)", () => {
  test("a later entry with another status ends a loss", () => {
    const root = baseProject(5);
    writeState(root, `
object-state:
  - artifact: ring
    status: lost
    since: chapter-02
  - artifact: ring
    status: active
    since: chapter-04
`);
    writeBaseScene(root, 3, 1, "state-changes:\n  - target: ring\n    change: used while lost");
    writeBaseScene(root, 4, 1, "state-changes:\n  - target: ring\n    change: recovered");
    writeBaseScene(root, 5, 1, "mentions:\n  - ring");
    const result = continuity(root);
    expect(messages(result.errors)).toEqual(["scenes/chapter-03-scene-01.md uses ring, destroyed/lost since chapter-02"]);
    // The history is not a repeat, and only the latest entry is compared with
    // the artifact file.
    expect(messages(result.warnings).filter((warning) => warning.includes("object-state"))).toEqual([]);
  });

  test("a destroyed artifact listed in a later chapter's or scene's characters is reported (#702)", () => {
    const root = baseProject(5);
    writeState(root, "object-state:\n  - artifact: ring\n    status: destroyed\n    since: chapter-02");
    writeBaseChapter(root, 3, "characters:\n  - ann\n  - ring");
    writeBaseScene(root, 4, 1, "characters:\n  - ring");
    expect(messages(continuity(root).errors)).toEqual([
      "scenes/chapter-04-scene-01.md lists ring, destroyed/lost since chapter-02",
      "chapters/chapter-03.md lists ring, destroyed/lost since chapter-02"
    ]);
  });

  test("consecutive losses form one window, and a same-chapter repeat still warns", () => {
    const root = baseProject(5);
    writeState(root, `
object-state:
  - artifact: ring
    status: lost
    since: chapter-02
  - artifact: ring
    status: destroyed
    since: chapter-03
  - artifact: ring
    status: destroyed
    since: chapter-03
`);
    writeBaseScene(root, 5, 1, "state-changes:\n  - target: ring\n    change: used");
    const result = continuity(root);
    expect(messages(result.errors)).toEqual(["scenes/chapter-05-scene-01.md uses ring, destroyed/lost since chapter-02"]);
    expect(messages(result.warnings)).toContain("continuity/state.md object-state[2] repeats artifact ring from object-state[1]; keep one entry per artifact per since chapter");
  });
});

describe("review follow-ups (#251)", () => {
  test("a later entry does not end a destruction", () => {
    const root = baseProject(5);
    writeState(root, `
object-state:
  - artifact: ring
    status: destroyed
    since: chapter-02
  - artifact: ring
    status: active
    since: chapter-04
`);
    writeBaseScene(root, 5, 1, "state-changes:\n  - target: ring\n    change: used\nmentions:\n  - ring");
    writeBaseChapter(root, 5, "mentions:\n  - ring");
    expect(messages(continuity(root).errors)).toEqual([
      "scenes/chapter-05-scene-01.md uses ring, destroyed/lost since chapter-02",
      "scenes/chapter-05-scene-01.md mentions ring, destroyed/lost since chapter-02",
      "chapters/chapter-05.md mentions ring, destroyed/lost since chapter-02"
    ]);
  });

  test("character-state deaths follow story time, not chapter numbers", () => {
    const root = baseProject(4);
    writeBaseChapter(root, 1, "date: 2024-01-01");
    writeBaseChapter(root, 2, "date: 2024-01-05");
    writeBaseChapter(root, 3, "date: 2024-01-06");
    writeBaseChapter(root, 4, "date: 2024-01-02");
    setCharacter(root, "bob", "deceased", "died-in: chapter-02");
    writeState(root, "character-state:\n  - character: bob\n    location: alpha", 4);
    expect(messages(continuity(root).warnings).filter((warning) => warning.includes("tracks bob"))).toEqual([]);

    // The death chapter itself already counts.
    writeState(root, "character-state:\n  - character: bob\n    location: alpha", 2);
    expect(messages(continuity(root).warnings)).toContain("continuity/state.md character-state[0] tracks bob, who died in chapter-02; remove the entry once they are dead");
  });

  test("a scene cannot have a dead character learn something, even a fact recorded earlier", () => {
    const root = baseProject(4);
    setCharacter(root, "bob", "deceased", "died-in: chapter-02");
    writeBaseChapter(root, 1, "characters:\n  - bob");
    writeBaseScene(root, 1, 1, "characters:\n  - bob\nstate-changes:\n  - character: bob\n    knowledge: the vault code");
    writeBaseScene(root, 3, 1, "state-changes:\n  - character: bob\n    knowledge: the vault code");
    writeState(root, "knowledge-state:\n  - character: bob\n    knows: the vault code\n    learned-in: chapter-01", 4);
    expect(messages(continuity(root).errors)).toEqual(["scenes/chapter-03-scene-01.md state-change has bob learn something in chapter-03, after they died in chapter-02"]);
  });

  test("object-state history follows story time", () => {
    const root = baseProject(4);
    writeBaseChapter(root, 1, "strand: past\ndate: 1990-01-01");
    writeBaseChapter(root, 2, "strand: present\ndate: 2020-01-01");
    writeBaseChapter(root, 3, "strand: past\ndate: 1990-01-02");
    writeBaseChapter(root, 4, "strand: present\ndate: 2020-01-02");
    writeState(root, `
object-state:
  - artifact: ring
    owner: ann
    status: lost
    since: chapter-02
  - artifact: ring
    status: active
    since: chapter-03
`, 4);
    writeBaseScene(root, 3, 1, "state-changes:\n  - target: ring\n    owner: bob");
    writeBaseScene(root, 4, 1, "state-changes:\n  - target: ring\n    change: found in 2020");
    const findings = continuity(root);
    const errors = messages(findings.errors);
    const warnings = messages(findings.warnings);
    // The 2020 loss follows the 1990 entry, so it stays lost in chapter 4.
    expect(errors).toEqual(["scenes/chapter-04-scene-01.md uses ring, destroyed/lost since chapter-02"]);
    // The latest entry is the 2020 loss, which is newer than the 1990 scene.
    expect(warnings).toContain("continuity/state.md object-state[0] status lost conflicts with worldbuilding/artifacts/ring.md status active");
    expect(warnings.filter((warning) => warning.includes("last set it"))).toEqual([]);
  });

  test("timeline presence treats outline deaths and revivals as planned", () => {
    const root = baseProject(4);
    writeBaseChapter(root, 1, "characters:\n  - bob");
    writeBaseChapter(root, 2, "characters:\n  - bob", "outline");
    setCharacter(root, "bob", "alive", "died-in: chapter-02");
    let timeline = storyTimeline(root);
    expect(formatTimeline(timeline, timeline.totalChapters)).toContain("- bob: 2 of 4 chapters, chapters 1-2, absent from the last 2 chapters\n");

    // A written death stays reported while its revival is only planned.
    writeBaseChapter(root, 2, "characters:\n  - bob");
    writeBaseChapter(root, 3, "", "outline");
    setCharacter(root, "bob", "deceased", "died-in: chapter-02\nrevived-in: chapter-03");
    timeline = storyTimeline(root);
    expect(formatTimeline(timeline, timeline.totalChapters)).toContain("- bob: 2 of 4 chapters, chapters 1-2, died in chapter 2\n");
  });
});

describe("continuity/state.md cross-checks (#173)", () => {
  test("the citadel example agrees with itself", () => {
    const root = path.join(EXAMPLES, "the-fall-of-the-citadel");
    const result = continuity(root);
    expect(findings(result)).toEqual([]);
    expect(knowledgeAtChapter(root, "sera-voss", "chapter-01").map((entry) => entry.knows)).toEqual([
      "Maren asked the king to arm the ember well",
      "A tunnel behind the gallery leads to the Whisper Gate"
    ]);
  });

  test("scene knowledge needs a matching knowledge-state entry", () => {
    const root = baseProject(3);
    writeBaseChapter(root, 1, "characters:\n  - ann");
    writeBaseChapter(root, 2, "characters:\n  - ann");
    writeBaseScene(root, 1, 1, `characters:
  - ann
state-changes:
  - character: ann
    knowledge: The gate is open.
  - character: ann
    knowledge: Bob lied
    fact: bob-lied
  - character: ann
    knowledge: The ring is fake`);
    writeBaseScene(root, 2, 1, `characters:
  - ann
state-changes:
  - character: ann
    knowledge: A secret learned later`);
    writeState(root, `
knowledge-state:
  - character: ann
    knows: the gate is open
    learned-in: chapter-01
  - character: ann
    knows: Bob was not telling the truth
    fact: bob-lied
    learned-in: chapter-01
  - character: ann
    knows: A secret learned later
    learned-in: chapter-03
`, 3);
    const warnings = messages(continuity(root).warnings);
    expect(warnings).toContain("scenes/chapter-01-scene-01.md state-changes record ann learning \"The ring is fake\" but continuity/state.md has no knowledge-state entry for it learned by chapter-01");
    expect(warnings).toContain("scenes/chapter-02-scene-01.md state-changes record ann learning \"A secret learned later\" but continuity/state.md has no knowledge-state entry for it learned by chapter-02");
    expect(warnings.filter((warning) => warning.includes("learning"))).toHaveLength(2);
  });

  test("an unmatched entry learned in the same chapter pairs with a paraphrase", () => {
    const root = baseProject(1);
    writeBaseChapter(root, 1, "characters:\n  - ann");
    writeBaseScene(root, 1, 1, "characters:\n  - ann\nstate-changes:\n  - character: ann\n    knowledge: Maren has asked the king");
    writeState(root, "knowledge-state:\n  - character: ann\n    knows: Maren asked the king\n    learned-in: chapter-01", 1);
    expect(findings(continuity(root))).toEqual([]);
  });

  test("nobody learns or is tracked after dying, and learners are in the cast", () => {
    const root = baseProject(4);
    setCharacter(root, "bob", "deceased", "died-in: chapter-02");
    writeBaseChapter(root, 1, "characters:\n  - bob");
    writeBaseScene(root, 4, 1, "characters: []");
    writeState(root, `
character-state:
  - character: bob
    location: alpha
knowledge-state:
  - character: bob
    knows: the vault code
    learned-in: chapter-03
  - character: ann
    knows: where the ring is
    learned-in: chapter-04
  - character: bob
    knows: the password
    learned-in: chapter-01
`, 4);
    const findings = continuity(root);
    const errors = messages(findings.errors);
    const warnings = messages(findings.warnings);
    expect(errors).toContain("continuity/state.md knowledge-state[0] has bob learn something in chapter-03, after they died in chapter-02");
    expect(warnings).toContain("continuity/state.md knowledge-state[1] has ann learn something in chapter-04, which does not list ann in characters or pov");
    expect(warnings).toContain("continuity/state.md character-state[0] tracks bob, who died in chapter-02; remove the entry once they are dead");
    expect(warnings.filter((warning) => warning.includes("knowledge-state[2]"))).toEqual([]);
  });

  test("character locations and object owners agree with the scenes", () => {
    const root = baseProject(2);
    writeBaseChapter(root, 2, "locations:\n  - beta\n  - gamma\ncharacters:\n  - ann");
    writeBaseScene(root, 1, 1, "state-changes:\n  - target: ring\n    owner: bob");
    writeBaseScene(root, 2, 1, "location: beta\ncharacters:\n  - ann\nstate-changes:\n  - target: ring\n    owner: ann\n    location: beta");
    writeBaseScene(root, 2, 2, "location: gamma\ncharacters:\n  - ann");
    writeState(root, `
character-state:
  - character: ann
    location: delta
object-state:
  - artifact: ring
    owner: bob
    location: beta
    status: active
`, 2);
    let warnings = messages(continuity(root).warnings);
    expect(warnings).toContain("continuity/state.md character-state[0] puts ann at delta, but their last scene in chapter-02, scenes/chapter-02-scene-02.md, is at gamma and the chapter does not list delta");
    expect(warnings).toContain("continuity/state.md object-state[0] gives ring owner bob, but scenes/chapter-02-scene-01.md state-changes last set it to ann");
    expect(warnings.filter((warning) => warning.includes("ring location"))).toEqual([]);

    // A place the chapter lists is fine: the chapter may move them there.
    writeState(root, `
character-state:
  - character: ann
    location: beta
object-state:
  - artifact: ring
    owner: ann
    location: beta
    status: active
`, 2);
    warnings = messages(continuity(root).warnings);
    expect(warnings.filter((warning) => warning.includes("continuity/state.md"))).toEqual([]);
  });
});

describe("state cross-check edge cases (#173)", () => {
  test("skips malformed entries, reports artifacts with no entry, and trusts a newer entry", () => {
    const root = baseProject(3);
    writeBaseScene(root, 1, 1, `state-changes:
  - knowledge: nobody learns this
  - character: ann
    physical: tired
  - target: ring
    location: alpha`);
    writeBaseScene(root, 2, 1, "state-changes:\n  - target: ring\n    owner: bob");
    writeState(root, "knowledge-state:\n  - just a string\nobject-state: []", 3);
    let warnings = messages(continuity(root).warnings);
    expect(warnings).toContain("scenes/chapter-01-scene-01.md state-changes set ring location alpha but continuity/state.md has no object-state entry for ring");
    expect(warnings).toContain("scenes/chapter-02-scene-01.md state-changes set ring owner bob but continuity/state.md has no object-state entry for ring");
    expect(warnings.filter((warning) => warning.includes("learning"))).toEqual([]);

    // An object-state entry recorded after the scene's chapter is newer.
    writeState(root, "object-state:\n  - artifact: ring\n    owner: ann\n    location: beta\n    status: active\n    since: chapter-03", 3);
    warnings = messages(continuity(root).warnings);
    expect(warnings.filter((warning) => warning.includes("ring"))).toEqual([]);
  });
});

describe("two places at once (#171)", () => {
  test("reports different places at the same exact minute across route components", () => {
    const root = castProject(1);
    addRoutes(root, "alpha", "- to: beta\n  hours: 2");
    addRoutes(root, "gamma", "- to: delta\n  hours: 2");
    writeBaseScene(root, 1, 1, sighting("alpha"));
    writeBaseScene(root, 1, 2, sighting("gamma"));

    expect(messages(continuity(root).errors)).toEqual([
      "scenes/chapter-01-scene-02.md puts ann at gamma at the same time as scenes/chapter-01-scene-01.md at alpha"
    ]);
  });

  test("reports it when the project has no routes at all", () => {
    const root = castProject(1);
    writeBaseScene(root, 1, 1, sighting("alpha"));
    writeBaseScene(root, 1, 2, sighting("beta"));

    expect(messages(continuity(root).errors)).toEqual([
      "scenes/chapter-01-scene-02.md puts ann at beta at the same time as scenes/chapter-01-scene-01.md at alpha"
    ]);
  });

  test("ignores the same place, different minutes, and named times without routes", () => {
    const root = castProject(1);
    writeBaseScene(root, 1, 1, sighting("alpha"));
    writeBaseScene(root, 1, 2, sighting("alpha"));
    writeBaseScene(root, 1, 3, sighting("beta", "\"10:01\""));
    writeBaseScene(root, 1, 4, sighting("gamma", "morning"));
    writeBaseScene(root, 1, 5, sighting("delta", "morning"));

    expect(messages(continuity(root).errors)).toEqual([]);
  });

  test("still reports connected places with the route message", () => {
    const root = castProject(1);
    addRoutes(root, "alpha", "- to: beta\n  hours: 2");
    writeBaseScene(root, 1, 1, sighting("alpha"));
    writeBaseScene(root, 1, 2, sighting("beta"));

    expect(messages(continuity(root).errors)).toEqual([
      "scenes/chapter-01-scene-02.md puts ann at beta 0h after scenes/chapter-01-scene-01.md at alpha, but the fastest route takes 2h"
    ]);
  });
});

describe("clock order reads named times as windows (#84)", () => {
  test("an exact time inside a later named window is not backward", () => {
    const root = castProject(1);
    writeBaseScene(root, 1, 1, "date: 2024-01-01\ntime: \"10:20\"");
    writeBaseScene(root, 1, 2, "date: 2024-01-01\ntime: morning");

    expect(messages(continuity(root).warnings).filter((warning) => warning.includes("runs backward"))).toEqual([]);
  });

  test("a time that cannot fall after the reference is still backward", () => {
    const root = castProject(1);
    writeBaseScene(root, 1, 1, "date: 2024-01-01\ntime: \"13:00\"");
    writeBaseScene(root, 1, 2, "date: 2024-01-01\ntime: morning");
    writeBaseScene(root, 1, 3, "date: 2024-01-01\ntime: \"14:00\"");

    expect(messages(continuity(root).warnings)).toContain("scenes/chapter-01-scene-02.md timestamp runs backward");
    expect(messages(continuity(root).warnings)).not.toContain("scenes/chapter-01-scene-03.md timestamp runs backward");
  });

  test("the reference keeps the later known time when a named window starts before it", () => {
    const root = castProject(1);
    writeBaseScene(root, 1, 1, "date: 2024-01-01\ntime: \"10:20\"");
    writeBaseScene(root, 1, 2, "date: 2024-01-01\ntime: morning");
    writeBaseScene(root, 1, 3, "date: 2024-01-01\ntime: \"10:00\"");

    expect(messages(continuity(root).warnings)).toContain("scenes/chapter-01-scene-03.md timestamp runs backward");
  });

  test("travel-hours uses the widest reading of named times", () => {
    const root = castProject(1);
    writeBaseScene(root, 1, 1, "date: 2024-01-01\ntime: morning");
    writeBaseScene(root, 1, 2, "date: 2024-01-01\ntime: evening\ntravel-hours: 13");
    expect(messages(continuity(root).errors)).toEqual([]);

    writeBaseScene(root, 1, 2, "date: 2024-01-01\ntime: evening\ntravel-hours: 18");
    expect(messages(continuity(root).errors)).toEqual(["scenes/chapter-01-scene-02.md allows at most 16.9h for travel of 18h"]);
  });

  test("the CLI repro gives no warning", () => {
    const cwd = makeTempDir();
    const io = memoryIo(cwd);
    expect(runCli(["init", "CL", "--dir", "cl"], io)).toBe(0);
    const root = path.join(cwd, "cl");
    const run = (argv) => runCli([...argv, "--path", root], memoryIo(cwd));
    expect(run(["add", "chapter", "One"])).toBe(0);
    expect(run(["add", "scene", "A", "--chapter", "chapter-01", "--date", "2024-01-01", "--time", "10:20"])).toBe(0);
    expect(run(["add", "scene", "B", "--chapter", "chapter-01", "--date", "2024-01-01", "--time", "morning"])).toBe(0);

    expect(messages(continuity(root).warnings).filter((warning) => warning.includes("runs backward"))).toEqual([]);
  });
});

describe("cut characters still referenced (#115)", () => {
  test("warns for each cast, pov, arc, and relationship reference", () => {
    const root = castProject(1);
    writeBaseChapter(root, 1, "pov: ann\ncharacters:\n  - ann\n  - bob");
    writeBaseScene(root, 1, 1, "pov: bob\ncharacters:\n  - bob");
    createEntity(root, { kind: "arc", name: "Main", type: "main", characters: ["bob"] });
    const annFile = path.join(root, "characters", "ann.md");
    const bobFile = path.join(root, "characters", "bob.md");
    fs.writeFileSync(annFile, fs.readFileSync(annFile, "utf8").replace("relationships: []", "relationships:\n  - character: bob\n    type: friend"), "utf8");
    fs.writeFileSync(bobFile, fs.readFileSync(bobFile, "utf8").replace("relationships: []", "relationships:\n  - character: ann\n    type: friend"), "utf8");
    setStatus(bobFile, "cut");

    const warnings = messages(continuity(root).warnings).filter((warning) => warning.includes("status: cut"));
    expect(warnings).toEqual([
      "chapters/chapter-01.md lists bob, who has status: cut; drop them from pov and characters",
      "scenes/chapter-01-scene-01.md lists bob, who has status: cut; drop them from pov and characters",
      "plot/arcs/main.md lists bob, who has status: cut; drop them from characters",
      "characters/ann.md has a relationship with bob, but bob has status: cut; drop the relationship on both sides",
      "characters/bob.md has a relationship with ann, but bob has status: cut; drop the relationship on both sides"
    ]);
  });

  test("a clean cut gives no warning", () => {
    const root = castProject(1);
    writeBaseChapter(root, 1, "characters:\n  - ann");
    setStatus(path.join(root, "characters", "bob.md"), "cut");

    expect(messages(continuity(root).warnings).filter((warning) => warning.includes("status: cut"))).toEqual([]);
  });
});

describe("planned and payoff warnings read the named chapter's own status (#164)", () => {
  test("outline planted and payoff chapters give no warning when later chapters are drafted", () => {
    const root = castProject(5);
    writeBaseChapter(root, 2, "", "outline");
    writeBaseChapter(root, 3, "", "outline");
    writeMarkdown(path.join(root, "continuity", "promises", "gun.md"), "title: Gun\nstatus: planned\nplanted: chapter-02", "# Gun\n");
    writeMarkdown(path.join(root, "continuity", "promises", "knife.md"), "title: Knife\nstatus: planted\nplanted: chapter-01\npayoff: chapter-03", "# Knife\n");
    writeMarkdown(path.join(root, "continuity", "clues", "glove.md"), "title: Glove\nstatus: planted\nplanted: chapter-01\npayoff: chapter-02", "# Glove\n");

    const result = continuity(root);
    expect(messages(result.warnings).filter((warning) => warning.includes("continuity/"))).toEqual([]);
  });

  test("drafted planted and payoff chapters still warn", () => {
    const root = castProject(5);
    writeMarkdown(path.join(root, "continuity", "promises", "gun.md"), "title: Gun\nstatus: planned\nplanted: chapter-02", "# Gun\n");
    writeMarkdown(path.join(root, "continuity", "promises", "knife.md"), "title: Knife\nstatus: planted\nplanted: chapter-01\npayoff: chapter-03", "# Knife\n");

    const warnings = messages(continuity(root).warnings);
    expect(warnings).toContain("continuity/promises/gun.md records planted chapter chapter-02 but status is still planned");
    expect(warnings).toContain("continuity/promises/knife.md payoff chapter chapter-03 has passed and status is still planted");
  });
});

describe("continuity help lists every check (#168)", () => {
  test("names the checks its help text lists", () => {
    const io = memoryIo(makeTempDir());
    runCli(["continuity", "--help"], io);
    const help = (io.output() + io.error()).replace(/\s+/g, " ");
    // A fixed list of check names, not every check the command runs.
    for (const phrase of ["deaths", "casts and cut characters", "promises", "questions", "clues", "prop custody", "clock and travel time", "location routes", "durable state"]) {
      expect(help).toContain(phrase);
    }
  });

  test("names the chapter numbering and open promise checks by code", () => {
    const io = memoryIo(makeTempDir());
    runCli(["continuity", "--help"], io);
    const help = (io.output() + io.error()).replace(/\s+/g, " ");
    for (const code of ["chapter-numbering-start", "chapter-numbering-gap", "complete-with-open-promise"]) {
      expect(help).toContain(code);
    }
  });
});

describe("continuity ledger", () => {
  test("planned status with a drafted planted chapter warns for clues and promises alike", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1, status: "draft" });
    createEntity(root, { kind: "clue", name: "Locket", planted: "chapter-01", status: "planned" });
    createEntity(root, { kind: "promise", name: "Duel", planted: "chapter-01", status: "planned" });
    createEntity(root, { kind: "clue", name: "Ring", planted: "chapter-03", status: "planned" });
    const warnings = messages(checkProjectContinuity(root).warnings);
    expect(warnings).toContain("continuity/clues/locket.md records planted chapter chapter-01 but status is still planned");
    expect(warnings).toContain("continuity/promises/duel.md records planted chapter chapter-01 but status is still planned");
    expect(warnings.join("\n")).not.toContain("ring.md");
  });
});

describe("sweep fixes", () => {
  test("a character who died before the story is flagged in a cast", () => {
    const root = sweepProject();
    writeMarkdown(path.join(root, "characters", "tam.md"), "name: Tam\nrole: minor\nstatus: deceased");
    createEntity(root, { kind: "chapter", name: "One", number: 1, pov: "tam" });
    expect(messages(checkProjectContinuity(root).warnings)).toContain("chapters/chapter-01.md lists tam, who died before the story (deceased with no died-in); move appearances to mentions");
  });

  test("a chapter pov that none of its scenes share is flagged", () => {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "character", name: "Tam" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, pov: "mara", character: "tam" });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-01", pov: "tam" });
    expect(messages(checkProjectContinuity(root).warnings)).toContain("chapters/chapter-01.md has POV mara but its scenes are told by tam");
  });

  test("a payoff chapter that has passed warns at once", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1, status: "draft" });
    createEntity(root, { kind: "chapter", name: "Two", number: 2, status: "draft" });
    createEntity(root, { kind: "clue", name: "Herring", planted: "chapter-01", payoff: "chapter-02", "red-herring": true });
    expect(messages(checkProjectContinuity(root).warnings)).toContain("continuity/clues/herring.md payoff chapter chapter-02 has passed and status is still planted");
  });

  test("artifact mentions at or before since, and mentions of pre-story losses, are fine", () => {
    const root = sweepProject();
    createEntity(root, { kind: "artifact", name: "Blade" });
    createEntity(root, { kind: "artifact", name: "Crown" });
    for (const number of [1, 2, 3]) {
      createEntity(root, { kind: "chapter", name: `C${number}`, number, mention: ["blade", "crown"] });
    }
    const state = path.join(root, "continuity", "state.md");
    fs.writeFileSync(state, fs.readFileSync(state, "utf8").replace("object-state: []", "object-state:\n  - artifact: blade\n    status: destroyed\n    since: chapter-02\n  - artifact: crown\n    status: lost"));
    expect(messages(checkProjectContinuity(root).errors)).toEqual(["chapters/chapter-03.md mentions blade, destroyed/lost since chapter-02"]);
  });

  test("correctly ordered promises and clues give no errors", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    createEntity(root, { kind: "promise", name: "Oath", planted: "chapter-01", payoff: "chapter-02" });
    createEntity(root, { kind: "clue", name: "Ring", planted: "chapter-01", payoff: "chapter-02" });
    expect(messages(checkProjectContinuity(root).errors)).toEqual([]);
  });
});

describe("theme-craft motif rows raise no finding", () => {
  test("a planted motif with no payoff changes no check, in the ledger or an arc's Foreshadowing table", () => {
    const root = newProject("Salt");
    createEntity(root, { kind: "arc", name: "Main", type: "main" });
    const reports = () => {
      const project = validateProject(root);
      const continuityReport = checkProjectContinuity(root);
      return [...messages(project.errors), ...messages(project.warnings), ...messages(continuityReport.errors), ...messages(continuityReport.warnings)];
    };
    const before = reports();

    fs.mkdirSync(path.join(root, "continuity"), { recursive: true });
    fs.writeFileSync(path.join(root, "continuity", "motifs.md"), "# Motifs\n\n| Motif | Planted | Payoff | Status |\n|---|---|---|---|\n| salt | chapter-01 | | planted |\n", "utf8");
    const arc = path.join(root, "plot", "arcs", "main.md");
    const arcText = fs.readFileSync(arc, "utf8");
    const row = "| | | | | planned |";
    expect(arcText.split(row)).toHaveLength(2);
    fs.writeFileSync(arc, arcText.replace(row, "| Salt on the sill | | chapter-01 | | planted |"), "utf8");
    expect(fs.readFileSync(arc, "utf8")).toContain("| Salt on the sill | | chapter-01 | | planted |");

    expect(reports()).toEqual(before);
  });
});

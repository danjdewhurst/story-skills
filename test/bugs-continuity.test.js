import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { QUESTION_CHAPTER_GAP, checkContinuity } from "../src/continuity.js";
import { formatTimeline } from "../src/timeline.js";
import {
  createEntity,
  createStoryProject,
  diagramProject,
  knowledgeAtChapter,
  renameEntity,
  scanProject,
  storyTimeline,
  validateProject
} from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function writeChapter(root, number, fields = "", status = "draft") {
  writeMarkdown(path.join(root, "chapters", `chapter-${pad(number)}.md`), `
title: C${number}
number: ${number}
status: ${status}
${fields}
`, "## Chapter Text\n\nSome prose here.\n");
}

function writeScene(root, chapter, scene, fields = "") {
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
    writeChapter(root, number);
  }
  writeState(root, "character-state: []\nobject-state: []\nknowledge-state: []", chapters);
  return root;
}

function continuity(root) {
  return checkContinuity(scanProject(root));
}

describe("diagram labels (#55)", () => {
  test("quotes edge labels so brackets parse, and never emits an empty label", () => {
    const root = baseProject(3);
    writeMarkdown(path.join(root, "continuity", "clues", "silence.md"), `
title: The Silence (odd)
status: planted
planted: chapter-02
payoff: ""
red-herring: true
`, "# Silence\n");
    writeMarkdown(path.join(root, "continuity", "clues", "blank.md"), `
title: ""
status: planted
planted: chapter-01
payoff: chapter-03
`, "# Blank\n");
    addRoutes(root, "alpha", "- to: beta\n  hours: 2\n  mode: boat (fast)");

    const clues = diagramProject(root, { kind: "clues" }).text;
    expect(clues).toContain(`chapter_02 -.->|"The Silence (odd) (red herring)"| unrevealed`);
    expect(clues).toContain(`chapter_01 -->|"blank"| chapter_03`);
    expect(clues).not.toContain("||");
    expect(diagramProject(root, { kind: "locations" }).text).toContain(`alpha ---|"2h boat (fast)"| beta`);

    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: ""
number: 1
status: draft
date: 2024-01-01
`, "## Chapter Text\n\nText.\n");
    const timeline = diagramProject(root, { kind: "timeline" }).text;
    expect(timeline).toContain("    day : chapter-01\n");
    expect(timeline).not.toMatch(/: *\n/);
  });
});

describe("story knowledge (#60)", () => {
  test("fails when a chapter does not parse", () => {
    const root = baseProject(3);
    writeState(root, "knowledge-state:\n  - character: ann\n    knows: the code\n    learned-in: chapter-02");
    expect(knowledgeAtChapter(root, "ann", "chapter-03")).toEqual([{ knows: "the code", learnedIn: "chapter-02", audience: "reader" }]);

    const chapter = path.join(root, "chapters", "chapter-02.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace(/^---\n/, ""), "utf8");
    expect(() => knowledgeAtChapter(root, "ann", "chapter-03")).toThrow("chapters/chapter-02.md");
    const result = invoke(root, ["knowledge", "ann", "--at", "chapter-02"]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("chapters/chapter-02.md");
  });

  test("fails on an entry with no knows instead of printing a blank bullet", () => {
    const root = baseProject(2);
    writeState(root, "knowledge-state:\n  - character: ann\n    learned-in: chapter-02");
    expect(() => knowledgeAtChapter(root, "ann", "chapter-02")).toThrow("knowledge-state[0] is missing knows");
  });
});

describe("timeline and the clock", () => {
  test("an untimed scene is not told out of order against a timed one the same day (#61)", () => {
    const root = baseProject(2);
    writeScene(root, 1, 1, "date: 2024-01-01\ntime: \"10:00\"");
    writeScene(root, 2, 1, "date: 2024-01-01");
    const timeline = storyTimeline(root);
    expect(timeline.chronology.map((entry) => [entry.id, entry.toldLate])).toEqual([
      ["chapter-01-scene-01", false],
      ["chapter-02-scene-01", false]
    ]);
    expect(diagramProject(root, { kind: "timeline" }).text).not.toContain("told in chapter");
    expect(messages(continuity(root).warnings)).toEqual([]);
  });

  test("a timed scene read after a later timed scene is still told late (#61)", () => {
    const root = baseProject(2);
    writeScene(root, 1, 1, "date: 2024-01-01\ntime: \"10:00\"");
    writeScene(root, 1, 2, "date: 2024-01-01");
    writeScene(root, 2, 1, "date: 2024-01-01\ntime: \"08:00\"");
    const timeline = storyTimeline(root);
    expect(timeline.chronology.map((entry) => [entry.id, entry.toldLate])).toEqual([
      ["chapter-02-scene-01", true],
      ["chapter-01-scene-01", false],
      ["chapter-01-scene-02", false]
    ]);
    expect(messages(continuity(root).warnings)).toEqual(["scenes/chapter-02-scene-01.md timestamp runs backward"]);
  });

  test("travel-hours errors print rounded hours (#80)", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, "date: 2024-01-01\ntime: \"10:00\"");
    writeScene(root, 1, 2, "date: 2024-01-01\ntime: \"10:20\"\ntravel-hours: 1");
    expect(messages(continuity(root).errors)).toEqual(["scenes/chapter-01-scene-02.md allows only 0.3h for travel of 1h"]);
  });

  test("an untimed scene does not become the reference point (#154)", () => {
    const root = baseProject(2);
    writeScene(root, 1, 1, "date: 2024-05-01\ntime: \"20:00\"");
    writeScene(root, 2, 1, "date: 2024-05-01");
    writeScene(root, 2, 2, "date: 2024-05-01\ntime: \"08:00\"");
    expect(messages(continuity(root).warnings)).toEqual(["scenes/chapter-02-scene-02.md timestamp runs backward"]);
  });

  test("a flashback does not become the reference point (#154)", () => {
    const root = baseProject(5);
    writeScene(root, 1, 1, "date: 2024-05-01\ntime: \"10:00\"");
    writeScene(root, 2, 1, "date: 2020-01-01\ntime: \"09:00\"\nflashback-to: the war");
    writeScene(root, 3, 1, "date: 2024-05-01\ntime: \"11:00\"\ntravel-hours: 30");
    writeScene(root, 4, 1, "date: 2024-04-15\ntime: \"11:00\"");
    writeScene(root, 4, 2, "date: 2020-01-02\nflashback-to: the war again");
    writeScene(root, 5, 1, "date: 2024-04-20\ntime: \"11:00\"");
    const result = continuity(root);
    expect(messages(result.errors)).toEqual(["scenes/chapter-03-scene-01.md allows only 1h for travel of 30h"]);
    expect(messages(result.warnings).sort()).toEqual([
      "scenes/chapter-02-scene-01.md timestamp runs backward",
      "scenes/chapter-04-scene-01.md timestamp runs backward",
      "scenes/chapter-04-scene-02.md timestamp runs backward",
      "scenes/chapter-05-scene-01.md timestamp runs backward"
    ]);
  });

  test("continuity and timeline share one chronology of scenes and scene-less chapters (#155)", () => {
    const root = baseProject(4);
    writeChapter(root, 1, "date: 2024-05-01\ntime: \"22:00\"");
    writeChapter(root, 2, "date: 2024-05-01\ntime: \"08:00\"");
    writeChapter(root, 3, "date: 2024-06-10");
    writeScene(root, 4, 1, "date: 2024-06-01\ntime: \"10:00\"");
    const result = continuity(root);
    expect(messages(result.warnings)).toEqual([
      "Chapter 2 date 2024-05-01 08:00 is earlier than Chapter 1 date 2024-05-01 22:00",
      "scenes/chapter-04-scene-01.md timestamp runs backward"
    ]);
    const late = storyTimeline(root).chronology.filter((entry) => entry.toldLate).map((entry) => entry.id);
    expect(late).toEqual(["chapter-02", "chapter-04-scene-01"]);
  });

  test("a chapter with scenes is placed by its scenes, not its own date (#155)", () => {
    const root = baseProject(2);
    writeChapter(root, 1, "date: 2024-05-10");
    writeChapter(root, 2, "date: 2024-05-01");
    writeScene(root, 2, 1, "pov: ann");
    expect(messages(continuity(root).warnings).join("\n")).not.toContain("earlier than");
  });

  test("a flash-forward prologue gives one warning and later chapters are still checked (#156)", () => {
    const root = baseProject(5);
    writeChapter(root, 1, "date: 2034-01-01");
    writeChapter(root, 2, "date: 2024-05-02");
    writeChapter(root, 3, "date: 2024-05-03");
    writeChapter(root, 4, "date: 2024-05-01");
    writeChapter(root, 5, "date: 2024-05-05");
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
    writeScene(root, 1, 1, "time: \"25:99\"");
    writeScene(root, 1, 2, "date: 2024-05-01\ntime: \"10:00\"");
    writeScene(root, 1, 3, "time: \"11:00\"\ntravel-hours: 50");
    writeChapter(root, 2, "time: teatime");
    const warnings = messages(continuity(root).warnings);
    expect(warnings).toContain("scenes/chapter-01-scene-01.md has malformed time \"25:99\"");
    expect(warnings).toContain("Chapter 2 has malformed time \"teatime\"");
    expect(warnings).toContain("scenes/chapter-01-scene-03.md has travel-hours but no date, so the clock check skips it");
  });

  test("timeline lists dated scenes whose chapter file is missing (#170)", () => {
    const root = baseProject(5);
    writeScene(root, 7, 1, "date: 2024-05-02\ntime: \"10:00\"");
    writeScene(root, 7, 2, "date: 2024-05-01\ntime: \"10:00\"");
    const timeline = storyTimeline(root);
    expect(timeline.chronology.map((entry) => [entry.id, entry.orphanOf, entry.toldLate])).toEqual([
      ["chapter-07-scene-02", "chapter-07", true],
      ["chapter-07-scene-01", "chapter-07", false]
    ]);
    expect(timeline.undated).toHaveLength(5);
    const text = formatTimeline(timeline, timeline.totalChapters);
    expect(text).toContain("Timeline: 2 dated, 5 undated");
    expect(text).toContain("[told in chapter 7, after later events; no chapter file for chapter-07]");
    expect(messages(continuity(root).warnings)).toContain("scenes/chapter-07-scene-02.md timestamp runs backward");
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
    writeChapter(root, 10);
    writeMarkdown(path.join(root, "continuity", "promises", "p.md"), `
title: P
status: planted
planted: chapter-02
payoff: ""
`, "# P\n");
    writeState(root, "", 10);
    expect(messages(continuity(root).warnings).join("\n")).not.toContain("chapters ago");

    writeChapter(root, 3);
    writeChapter(root, 4);
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

    writeChapter(root, QUESTION_CHAPTER_GAP + 1);
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
    writeChapter(root, 30, "", "outline");
    expect(messages(continuity(root).warnings).join("\n")).not.toContain("has no resolution yet");

    writeChapter(root, 40);
    expect(messages(continuity(root).warnings).join("\n")).not.toContain("has no resolution yet");
  });

  test("a question introduced in an outline chapter does not age until that chapter is drafted", () => {
    const root = baseProject(QUESTION_CHAPTER_GAP + 1);
    writeChapter(root, 1, "", "outline");
    writeQuestion(root, "who-kept-the-key", `
status: open
introduced: chapter-01
resolved: ""
`);
    expect(messages(continuity(root).warnings).join("\n")).not.toContain("has no resolution yet");

    writeChapter(root, 1);
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
    writeScene(root, 5, 1, "state-changes:\n  - target: ring\n    change: used again");
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
    writeScene(root, 5, 1, "state-changes:\n  - target: ring\n    change: used again");

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
    writeChapter(root, 3, "characters:\n  - 47");
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

describe("routes", () => {
  test("diagram draws only the routes the travel check uses, and validate warns on duplicates (#160)", () => {
    const root = baseProject(1);
    addRoutes(root, "alpha", "- to: beta\n  hours: 2\n- to: beta\n  hours: 1.5");
    addRoutes(root, "beta", "- to: gamma\n  hours: 0\n- to: delta\n  hours: -1");
    const edges = diagramProject(root, { kind: "locations" }).text.split("\n").filter((line) => line.includes("---") || line.includes("-->"));
    expect(edges).toEqual([`  alpha ---|"1.5h"| beta`]);
    expect(messages(validateProject(root).warnings)).toContain(
      "worldbuilding/locations/alpha.md lists more than one route to beta; the travel check and story diagram use only the fastest"
    );
  });

  test("the chapter POV travels with scenes that have no POV of their own (#165)", () => {
    const root = baseProject(1);
    addRoutes(root, "alpha", "- to: beta\n  hours: 5");
    writeChapter(root, 1, "pov: ann\ncharacters:\n  - ann\nlocations:\n  - alpha\n  - beta");
    writeScene(root, 1, 1, "date: 2024-05-01\ntime: \"10:00\"\nlocation: alpha");
    writeScene(root, 1, 2, "date: 2024-05-01\ntime: \"10:10\"\nlocation: beta\npov: ann\ncharacters:\n  - ann");
    expect(messages(continuity(root).errors)).toEqual([
      "scenes/chapter-01-scene-02.md puts ann at beta 0.1h after scenes/chapter-01-scene-01.md at alpha, but the fastest route takes 5h"
    ]);
  });

  test("decimal route legs that exactly fit the gap are not an error (#166)", () => {
    const root = baseProject(1);
    addRoutes(root, "alpha", "- to: beta\n  hours: 0.1");
    addRoutes(root, "beta", "- to: gamma\n  hours: 0.2");
    writeChapter(root, 1, "characters:\n  - ann\nlocations:\n  - alpha\n  - gamma");
    writeScene(root, 1, 1, "date: 2024-05-01\ntime: \"10:00\"\nlocation: alpha\ncharacters:\n  - ann");
    writeScene(root, 1, 2, "date: 2024-05-01\ntime: \"10:18\"\nlocation: gamma\ncharacters:\n  - ann");
    expect(messages(continuity(root).errors)).toEqual([]);
    writeScene(root, 1, 2, "date: 2024-05-01\ntime: \"10:17\"\nlocation: gamma\ncharacters:\n  - ann");
    expect(continuity(root).errors).toHaveLength(1);
  });
});

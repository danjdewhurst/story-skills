import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { checkContinuity } from "../src/continuity.js";
import { formatTimeline } from "../src/timeline.js";
import {
  createEntity,
  createStoryProject,
  knowledgeAtChapter,
  moveEntity,
  scanProject,
  storyTimeline,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

const EXAMPLES = path.resolve(import.meta.dir, "..", "examples");

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
    writeChapter(root, number);
  }
  writeState(root, "character-state: []\nobject-state: []\nknowledge-state: []", chapters);
  return root;
}

function continuity(root) {
  return checkContinuity(scanProject(root));
}

function findings(result) {
  return [...result.errors, ...result.warnings];
}

describe("resurrection, narrators, planned deaths (#172)", () => {
  test("revived-in ends the dead window", () => {
    const root = baseProject(5);
    setCharacter(root, "ann", "alive", "died-in: chapter-02\nrevived-in: chapter-04");
    writeChapter(root, 3, "characters:\n  - ann");
    writeChapter(root, 4, "characters:\n  - ann");
    writeChapter(root, 5, "pov: ann\ncharacters:\n  - ann");
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
    writeChapter(root, 3, "pov: bob\nmentions:\n  - bob");
    writeScene(root, 3, 1, "pov: bob\nmentions:\n  - bob");
    const result = continuity(root);
    expect(findings(result).filter((finding) => finding.includes("bob"))).toEqual([]);

    // A dead POV not in mentions is still posthumous.
    writeChapter(root, 4, "pov: bob");
    expect(messages(continuity(root).errors)).toContain("chapters/chapter-04.md lists bob, who died in chapter-01; move posthumous appearances to mentions");
  });

  test("a death in an outline chapter is planned, so the character stays alive", () => {
    const root = baseProject(5);
    writeChapter(root, 5, "", "outline");
    setCharacter(root, "ann", "alive", "died-in: chapter-05");
    expect(messages(continuity(root).errors)).toEqual([]);

    writeChapter(root, 5, "");
    expect(messages(continuity(root).errors)).toContain("characters/ann.md has died-in chapter-05 but status alive; set status: deceased");
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
    writeScene(root, 3, 1, "state-changes:\n  - target: ring\n    change: used while lost");
    writeScene(root, 4, 1, "state-changes:\n  - target: ring\n    change: recovered");
    writeScene(root, 5, 1, "mentions:\n  - ring");
    const result = continuity(root);
    expect(messages(result.errors)).toEqual(["scenes/chapter-03-scene-01.md uses ring, destroyed/lost since chapter-02"]);
    // The history is not a repeat, and only the latest entry is compared with
    // the artifact file.
    expect(messages(result.warnings).filter((warning) => warning.includes("object-state"))).toEqual([]);
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
    writeScene(root, 5, 1, "state-changes:\n  - target: ring\n    change: used");
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
    writeScene(root, 5, 1, "state-changes:\n  - target: ring\n    change: used\nmentions:\n  - ring");
    writeChapter(root, 5, "mentions:\n  - ring");
    expect(messages(continuity(root).errors)).toEqual([
      "scenes/chapter-05-scene-01.md uses ring, destroyed/lost since chapter-02",
      "scenes/chapter-05-scene-01.md mentions ring, destroyed/lost since chapter-02",
      "chapters/chapter-05.md mentions ring, destroyed/lost since chapter-02"
    ]);
  });

  test("character-state deaths follow story time, not chapter numbers", () => {
    const root = baseProject(4);
    writeChapter(root, 1, "date: 2024-01-01");
    writeChapter(root, 2, "date: 2024-01-05");
    writeChapter(root, 3, "date: 2024-01-06");
    writeChapter(root, 4, "date: 2024-01-02");
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
    writeChapter(root, 1, "characters:\n  - bob");
    writeScene(root, 1, 1, "characters:\n  - bob\nstate-changes:\n  - character: bob\n    knowledge: the vault code");
    writeScene(root, 3, 1, "state-changes:\n  - character: bob\n    knowledge: the vault code");
    writeState(root, "knowledge-state:\n  - character: bob\n    knows: the vault code\n    learned-in: chapter-01", 4);
    expect(messages(continuity(root).errors)).toEqual(["scenes/chapter-03-scene-01.md state-change has bob learn something in chapter-03, after they died in chapter-02"]);
  });

  test("object-state history follows story time", () => {
    const root = baseProject(4);
    writeChapter(root, 1, "strand: past\ndate: 1990-01-01");
    writeChapter(root, 2, "strand: present\ndate: 2020-01-01");
    writeChapter(root, 3, "strand: past\ndate: 1990-01-02");
    writeChapter(root, 4, "strand: present\ndate: 2020-01-02");
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
    writeScene(root, 3, 1, "state-changes:\n  - target: ring\n    owner: bob");
    writeScene(root, 4, 1, "state-changes:\n  - target: ring\n    change: found in 2020");
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
    writeChapter(root, 1, "characters:\n  - bob");
    writeChapter(root, 2, "characters:\n  - bob", "outline");
    setCharacter(root, "bob", "alive", "died-in: chapter-02");
    let timeline = storyTimeline(root);
    expect(formatTimeline(timeline, timeline.totalChapters)).toContain("- bob: 2 of 4 chapters, chapters 1-2, absent from the last 2 chapters\n");

    // A written death stays reported while its revival is only planned.
    writeChapter(root, 2, "characters:\n  - bob");
    writeChapter(root, 3, "", "outline");
    setCharacter(root, "bob", "deceased", "died-in: chapter-02\nrevived-in: chapter-03");
    timeline = storyTimeline(root);
    expect(formatTimeline(timeline, timeline.totalChapters)).toContain("- bob: 2 of 4 chapters, chapters 1-2, died in chapter 2\n");
  });
});

describe("non-linear chronology (#172)", () => {
  function prologueProject() {
    const root = baseProject(5);
    writeChapter(root, 1, "date: 2034-01-01");
    for (let number = 2; number <= 5; number += 1) {
      writeChapter(root, number, `date: 2024-05-0${number}`);
    }
    return root;
  }

  test("story knowledge compares dated chapters by date", () => {
    const root = prologueProject();
    writeState(root, `
knowledge-state:
  - character: bob
    knows: who the traitor was
    learned-in: chapter-01
  - character: bob
    knows: the ring is fake
    learned-in: chapter-03
`);
    expect(knowledgeAtChapter(root, "bob", "chapter-02")).toEqual([]);
    expect(knowledgeAtChapter(root, "bob", "chapter-01").map((entry) => entry.learnedIn)).toEqual(["chapter-01", "chapter-03"]);
  });

  test("a character who dies in 2024 cannot appear in a 2034 prologue", () => {
    const root = prologueProject();
    setCharacter(root, "ann", "deceased", "died-in: chapter-03");
    writeChapter(root, 1, "date: 2034-01-01\npov: ann\ncharacters:\n  - ann");
    writeChapter(root, 2, "date: 2024-05-02\ncharacters:\n  - ann");
    expect(messages(continuity(root).errors)).toEqual(["chapters/chapter-01.md lists ann, who died in chapter-03; move posthumous appearances to mentions"]);
  });

  test("a dual-timeline book compares deaths by date and keeps a clock per strand", () => {
    const root = baseProject(4);
    writeChapter(root, 1, "strand: past\ndate: 1990-01-01");
    writeChapter(root, 2, "strand: present\ndate: 2020-01-01\ncharacters:\n  - ann");
    writeChapter(root, 3, "strand: past\ndate: 1990-01-02\ncharacters:\n  - ann");
    writeChapter(root, 4, "strand: present\ndate: 2020-01-02");
    setCharacter(root, "ann", "deceased", "died-in: chapter-02");
    const result = continuity(root);
    expect(messages(result.errors)).toEqual([]);
    expect(messages(result.warnings).filter((warning) => warning.includes("earlier than"))).toEqual([]);

    // Within a strand the clock still runs forward only.
    writeChapter(root, 3, "strand: past\ndate: 1989-12-31");
    expect(messages(continuity(root).warnings)).toContain("Chapter 3 date 1989-12-31 is earlier than Chapter 1 date 1990-01-01");
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
    writeChapter(root, 1, "characters:\n  - ann");
    writeChapter(root, 2, "characters:\n  - ann");
    writeScene(root, 1, 1, `characters:
  - ann
state-changes:
  - character: ann
    knowledge: The gate is open.
  - character: ann
    knowledge: Bob lied
    fact: bob-lied
  - character: ann
    knowledge: The ring is fake`);
    writeScene(root, 2, 1, `characters:
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
    writeChapter(root, 1, "characters:\n  - ann");
    writeScene(root, 1, 1, "characters:\n  - ann\nstate-changes:\n  - character: ann\n    knowledge: Maren has asked the king");
    writeState(root, "knowledge-state:\n  - character: ann\n    knows: Maren asked the king\n    learned-in: chapter-01", 1);
    expect(findings(continuity(root))).toEqual([]);
  });

  test("nobody learns or is tracked after dying, and learners are in the cast", () => {
    const root = baseProject(4);
    setCharacter(root, "bob", "deceased", "died-in: chapter-02");
    writeChapter(root, 1, "characters:\n  - bob");
    writeScene(root, 4, 1, "characters: []");
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
    writeChapter(root, 2, "locations:\n  - beta\n  - gamma\ncharacters:\n  - ann");
    writeScene(root, 1, 1, "state-changes:\n  - target: ring\n    owner: bob");
    writeScene(root, 2, 1, "location: beta\ncharacters:\n  - ann\nstate-changes:\n  - target: ring\n    owner: ann\n    location: beta");
    writeScene(root, 2, 2, "location: gamma\ncharacters:\n  - ann");
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
    writeScene(root, 1, 1, `state-changes:
  - knowledge: nobody learns this
  - character: ann
    physical: tired
  - target: ring
    location: alpha`);
    writeScene(root, 2, 1, "state-changes:\n  - target: ring\n    owner: bob");
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

describe("timeline presence and deaths (#174)", () => {
  test("a dead character reads died in chapter N, not absent", () => {
    const root = baseProject(4);
    setCharacter(root, "bob", "deceased", "died-in: chapter-02");
    writeChapter(root, 1, "characters:\n  - ann\n  - bob");
    writeChapter(root, 2, "characters:\n  - ann\n  - bob");
    writeChapter(root, 3, "characters:\n  - ann");
    const timeline = storyTimeline(root);
    const text = formatTimeline(timeline, timeline.totalChapters);
    expect(text).toContain("- bob: 2 of 4 chapters, chapters 1-2, died in chapter 2\n");
    expect(text).toContain("- ann: 3 of 4 chapters, chapters 1-3, absent from the last 1 chapter\n");

    // A revived character's absence is reported as usual.
    setCharacter(root, "bob", "alive", "died-in: chapter-02\nrevived-in: chapter-03");
    const revived = storyTimeline(root);
    expect(formatTimeline(revived, revived.totalChapters)).toContain("- bob: 2 of 4 chapters, chapters 1-2, absent from the last 2 chapters\n");
  });

  test("the CLI shows the unraveled thread's death", () => {
    const io = memoryIo(EXAMPLES);
    runCli(["timeline", "the-unraveled-thread"], io);
    expect(io.output()).toContain("- edran-vale: 3 of 4 chapters, chapters 1-4, longest absence 1 chapter after chapter 2, died in chapter 2");
  });
});

test("moving a chapter rewrites revived-in", () => {
  const root = baseProject(3);
  setCharacter(root, "ann", "alive", "died-in: chapter-01\nrevived-in: chapter-03");
  moveEntity(root, { kind: "chapter", id: "chapter-03", number: 4 });
  expect(fs.readFileSync(path.join(root, "characters", "ann.md"), "utf8")).toContain("revived-in: chapter-04");
});

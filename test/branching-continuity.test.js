import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { chapterChronology } from "../src/chronology.js";
import { buildContext } from "../src/context.js";
import { characterLifeline } from "../src/deaths.js";
import { checkProjectContinuity, createStoryProject, entityStateAtChapter, knowledgeAtChapter, scanProject } from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

// Path-sensitive continuity for branching books (#358): a death, fact, or
// change on one branch does not reach its sibling branches.

function project(title) {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function id(number) {
  return `chapter-${String(number).padStart(2, "0")}`;
}

// `links` is the list of chapter numbers the chapter's choices lead to.
function chapter(root, number, { links = [], cast = [], extra = "" } = {}) {
  const choices = links.length === 0 ? "" : `choices:\n${links.map((to) => `  - text: Go to ${to}\n    to: ${id(to)}\n`).join("")}`;
  const characters = cast.length === 0 ? "characters: []\n" : `characters:\n${cast.map((name) => `  - ${name}\n`).join("")}`;
  writeMarkdown(path.join(root, "chapters", `${id(number)}.md`), `
title: Chapter ${number}
number: ${number}
pov: mara-finn
${characters}${choices}${extra}status: draft
word-count: 0
`, `# Chapter ${number}\n\n## Chapter Text\n\nWords.\n`);
}

function character(root, name, extra = "") {
  writeMarkdown(path.join(root, "characters", `${name}.md`), `
name: ${name}
role: supporting
status: ${/died-in/.test(extra) && !/revived-in/.test(extra) ? "deceased" : "alive"}
${extra}
`, `# ${name}\n`);
}

function setState(root, current, body) {
  const statePath = path.join(root, "continuity", "state.md");
  const raw = fs.readFileSync(statePath, "utf8");
  let next = raw.replace("current-chapter: 0", `current-chapter: ${current}`);
  for (const [key, value] of Object.entries(body)) {
    next = next.replace(`${key}: []`, `${key}:\n${value.trimEnd()}`);
  }
  fs.writeFileSync(statePath, next);
}

function codes(result, code) {
  return [...result.errors, ...result.warnings].filter((finding) => finding.code === code).map((finding) => finding.message);
}

function brassKey(root) {
  writeMarkdown(path.join(root, "worldbuilding", "artifacts", "brass-key.md"), `
name: Brass Key
type: tool
status: active
`, "# Key\n");
}

// One scene in the chapter, with `changes` as its state-changes list.
function scene(root, number, changes) {
  writeMarkdown(path.join(root, "scenes", `${id(number)}-scene-01.md`), `
title: Scene ${number}
chapter: ${id(number)}
scene: 1
pov: mara-finn
characters:
  - mara-finn
state-changes:
${changes}
`, "# Scene\n");
}

// Chapter 1 offers a fight (2) or a flight (3); both lead on to 4.
function diamond() {
  const root = project("Diamond");
  character(root, "mara-finn");
  character(root, "jonas-reed", "died-in: chapter-02");
  chapter(root, 1, { links: [2, 3], cast: ["jonas-reed"] });
  chapter(root, 2, { links: [4], cast: ["jonas-reed"] });
  chapter(root, 3, { links: [4], cast: ["jonas-reed"] });
  chapter(root, 4, { cast: [] });
  return root;
}

describe("path-sensitive continuity", () => {
  test("a death on one branch is not a posthumous appearance on its sibling", () => {
    const root = diamond();
    const result = checkProjectContinuity(root);
    expect(codes(result, "posthumous-appearance")).toEqual([]);
  });

  test("a death still counts on the paths through it", () => {
    const root = diamond();
    chapter(root, 4, { cast: ["jonas-reed"] });
    const messages = codes(checkProjectContinuity(root), "posthumous-appearance");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("chapter-04");
  });

  test("a revival on one branch does not bring the character back on the other", () => {
    const root = project("Revival");
    character(root, "mara-finn");
    character(root, "jonas-reed", "died-in: chapter-02\nrevived-in: chapter-03");
    chapter(root, 1, { links: [2] });
    chapter(root, 2, { links: [3, 4], cast: ["jonas-reed"] });
    chapter(root, 3, { links: [5], cast: ["jonas-reed"] });
    chapter(root, 4, { links: [5] });
    chapter(root, 5, { cast: ["jonas-reed"] });
    const messages = codes(checkProjectContinuity(root), "posthumous-appearance");
    // Chapter 5 is reached through chapter 4 too, where Jonas is still dead.
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("chapter-05");
  });

  test("chapters compare along the choices, not by number", () => {
    const root = project("Out of order");
    character(root, "mara-finn");
    character(root, "jonas-reed", "died-in: chapter-03");
    chapter(root, 1, { links: [3] });
    chapter(root, 2, { cast: ["jonas-reed"] });
    chapter(root, 3, { links: [2], cast: ["jonas-reed"] });
    const messages = codes(checkProjectContinuity(root), "posthumous-appearance");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("chapter-02");
  });

  test("dates still order two chapters on one path", () => {
    const root = project("Flashback");
    character(root, "mara-finn");
    character(root, "jonas-reed", "died-in: chapter-02");
    chapter(root, 1, { links: [2] });
    chapter(root, 2, { links: [3, 4], cast: ["jonas-reed"], extra: "date: 2020-05-01\n" });
    chapter(root, 3, { cast: ["jonas-reed"], extra: "date: 2019-01-01\n" });
    chapter(root, 4, { cast: ["jonas-reed"], extra: "date: 2020-06-01\n" });
    const messages = codes(checkProjectContinuity(root), "posthumous-appearance");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("chapter-04");
  });

  test("chapters in one loop fall back to number order", () => {
    const root = project("Loop");
    character(root, "mara-finn");
    character(root, "jonas-reed", "died-in: chapter-02");
    chapter(root, 1, { links: [2], cast: ["jonas-reed"] });
    chapter(root, 2, { links: [1, 3], cast: ["jonas-reed"] });
    chapter(root, 3, { cast: ["jonas-reed"] });
    const messages = codes(checkProjectContinuity(root), "posthumous-appearance");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("chapter-03");
  });

  test("a linear book keeps reading every chapter as one path", () => {
    const root = project("Linear");
    character(root, "mara-finn");
    character(root, "jonas-reed", "died-in: chapter-02");
    chapter(root, 1, { cast: ["jonas-reed"] });
    chapter(root, 2, { cast: ["jonas-reed"] });
    chapter(root, 3, { cast: ["jonas-reed"] });
    expect(codes(checkProjectContinuity(root), "posthumous-appearance")).toHaveLength(1);
    expect(chapterChronology(scanProject(root)).branching).toBe(false);
  });

  test("a fact learned on one branch is unknown on its sibling", () => {
    const root = diamond();
    setState(root, 4, {
      "knowledge-state": `  - character: mara-finn
    knows: The bridge is out
    learned-in: chapter-02
`
    });
    expect(knowledgeAtChapter(root, "mara-finn", "chapter-02").map((entry) => entry.knows)).toEqual(["The bridge is out"]);
    expect(knowledgeAtChapter(root, "mara-finn", "chapter-03")).toEqual([]);
    expect(knowledgeAtChapter(root, "mara-finn", "chapter-04")).toEqual([{ knows: "The bridge is out", learnedIn: "chapter-02", audience: "reader" }]);
  });

  test("a character dead on one branch can learn on the other", () => {
    const root = diamond();
    chapter(root, 3, { links: [4], cast: ["jonas-reed", "mara-finn"] });
    setState(root, 3, {
      "knowledge-state": `  - character: jonas-reed
    knows: The bridge is out
    learned-in: chapter-03
`
    });
    expect(codes(checkProjectContinuity(root), "posthumous-learning")).toEqual([]);
  });

  test("a scene knowledge change needs an entry learned on its own path", () => {
    const root = diamond();
    writeMarkdown(path.join(root, "scenes", "chapter-03-scene-01.md"), `
title: The bank
chapter: chapter-03
scene: 1
pov: mara-finn
characters:
  - mara-finn
state-changes:
  - character: mara-finn
    knowledge: The bridge is out
`, "# The bank\n");
    setState(root, 4, {
      "knowledge-state": `  - character: mara-finn
    knows: The bridge is out
    learned-in: chapter-02
`
    });
    expect(codes(checkProjectContinuity(root), "knowledge-not-recorded")).toHaveLength(1);
  });

  test("progressions apply only on the paths through their chapter", () => {
    const root = diamond();
    character(root, "mara-finn", "progressions:\n  - from: chapter-02\n    field: location\n    value: the-bridge");
    expect(entityStateAtChapter(root, "character", "mara-finn", "chapter-03").state.location).toBeUndefined();
    expect(entityStateAtChapter(root, "character", "mara-finn", "chapter-04").state.location).toBe("the-bridge");
  });

  test("story context leaves out a sibling branch's scenes and deaths", () => {
    const root = diamond();
    writeMarkdown(path.join(root, "scenes", "chapter-02-scene-01.md"), `
title: The fight on the bridge
chapter: chapter-02
scene: 1
pov: mara-finn
characters:
  - mara-finn
`, "# The fight\n");
    const scanned = scanProject(root);
    const items = (target) => JSON.stringify(buildContext(scanned, target, () => "", { budget: 100000 }));
    expect(items("chapter-03")).not.toContain("The fight on the bridge");
    expect(items("chapter-04")).toContain("The fight on the bridge");
    expect(items("chapter-03")).not.toContain("died in chapter-02");
  });

  test("an object left in different states by the branches is reported once", () => {
    const root = diamond();
    writeMarkdown(path.join(root, "worldbuilding", "artifacts", "brass-key.md"), `
name: Brass Key
type: tool
status: active
`, "# Key\n");
    for (const [number, owner] of [[2, "mara-finn"], [3, "jonas-reed"]]) {
      writeMarkdown(path.join(root, "scenes", `${id(number)}-scene-01.md`), `
title: Scene ${number}
chapter: ${id(number)}
scene: 1
pov: mara-finn
characters:
  - mara-finn
state-changes:
  - target: brass-key
    owner: ${owner}
`, "# Scene\n");
    }
    setState(root, 4, {
      "object-state": `  - artifact: brass-key
    owner: mara-finn
`
    });
    const result = checkProjectContinuity(root);
    expect(codes(result, "state-differs-by-path")).toHaveLength(1);
    expect(codes(result, "state-object-drift")).toEqual([]);

    // At chapter 3 only the flight path counts, and the snapshot is wrong.
    fs.writeFileSync(path.join(root, "continuity", "state.md"), fs.readFileSync(path.join(root, "continuity", "state.md"), "utf8").replace("current-chapter: 4", "current-chapter: 3"));
    const atThree = checkProjectContinuity(root);
    expect(codes(atThree, "state-differs-by-path")).toEqual([]);
    expect(codes(atThree, "state-object-drift")).toHaveLength(1);
  });

  test("a chapter no path reaches compares by number", () => {
    const root = project("Unreached");
    character(root, "mara-finn");
    character(root, "jonas-reed", "died-in: chapter-02");
    chapter(root, 1, { links: [2] });
    chapter(root, 2, { cast: ["jonas-reed"] });
    chapter(root, 3, { cast: ["jonas-reed"] });
    setState(root, 3, {
      "knowledge-state": `  - character: mara-finn
    knows: The bridge is out
    learned-in: chapter-02
`
    });
    const messages = codes(checkProjectContinuity(root), "posthumous-appearance");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("chapter-03");
    expect(knowledgeAtChapter(root, "mara-finn", "chapter-03").map((entry) => entry.audience)).toEqual(["reader"]);
  });

  test("branches that disagree about an unrecorded object report it as unrecorded", () => {
    const root = diamond();
    writeMarkdown(path.join(root, "worldbuilding", "artifacts", "brass-key.md"), `
name: Brass Key
type: tool
status: active
`, "# Key\n");
    for (const [number, owner] of [[2, "mara-finn"], [3, "jonas-reed"]]) {
      writeMarkdown(path.join(root, "scenes", `${id(number)}-scene-01.md`), `
title: Scene ${number}
chapter: ${id(number)}
scene: 1
pov: mara-finn
characters:
  - mara-finn
state-changes:
  - target: brass-key
    owner: ${owner}
`, "# Scene\n");
    }
    setState(root, 4, {});
    const result = checkProjectContinuity(root);
    expect(codes(result, "state-differs-by-path")).toEqual([]);
    expect(codes(result, "object-not-recorded")).toHaveLength(1);
  });

  test("one fact learned on two separate branches takes one entry per branch", () => {
    const root = diamond();
    for (const number of [2, 3]) {
      scene(root, number, "  - character: mara-finn\n    fact: bridge-out\n    knowledge: The bridge is out");
    }
    const entries = (chapters) => chapters.map((number) => `  - character: mara-finn
    fact: bridge-out
    knows: The bridge is out
    learned-in: ${id(number)}
`).join("");
    setState(root, 4, { "knowledge-state": entries([2, 3]) });
    const result = checkProjectContinuity(root);
    expect(codes(result, "state-duplicate-fact")).toEqual([]);
    expect(codes(result, "knowledge-not-recorded")).toEqual([]);

    // On one path, the second entry is still a repeat.
    const again = diamond();
    setState(again, 4, { "knowledge-state": entries([2, 4]) });
    expect(codes(checkProjectContinuity(again), "state-duplicate-fact")).toHaveLength(1);
  });

  test("a change made before the split still holds on the branch that keeps it", () => {
    const root = diamond();
    brassKey(root);
    scene(root, 1, "  - target: brass-key\n    owner: mara-finn");
    scene(root, 2, "  - target: brass-key\n    owner: jonas-reed");
    setState(root, 4, { "object-state": "  - artifact: brass-key\n    owner: jonas-reed\n" });
    expect(codes(checkProjectContinuity(root), "state-differs-by-path")).toHaveLength(1);
  });

  test("an object-state entry from where the branches rejoin settles the difference", () => {
    const root = diamond();
    brassKey(root);
    scene(root, 2, "  - target: brass-key\n    owner: mara-finn");
    scene(root, 3, "  - target: brass-key\n    owner: jonas-reed");
    setState(root, 4, { "object-state": "  - artifact: brass-key\n    owner: jonas-reed\n    since: chapter-04\n" });
    const result = checkProjectContinuity(root);
    expect(codes(result, "state-differs-by-path")).toEqual([]);
    expect(codes(result, "state-object-drift")).toEqual([]);
  });

  test("progressions apply in path order when the path runs against chapter numbers", () => {
    const root = project("Path order");
    character(root, "mara-finn", `progressions:
  - from: chapter-02
    field: location
    value: the-ford
  - from: chapter-03
    field: location
    value: the-bank
  - from: chapter-05
    field: location
    value: the-mill`);
    chapter(root, 1, { links: [5, 3] });
    chapter(root, 2, { links: [4] });
    chapter(root, 3, { links: [4] });
    chapter(root, 4);
    chapter(root, 5, { links: [2] });
    expect(entityStateAtChapter(root, "character", "mara-finn", "chapter-02").state.location).toBe("the-ford");
    expect(entityStateAtChapter(root, "character", "mara-finn", "chapter-03").state.location).toBe("the-bank");
    expect(entityStateAtChapter(root, "character", "mara-finn", "chapter-04").state.location).toBe("the-ford");
  });

  test("a revival on another branch does not excuse a status change while dead", () => {
    const root = project("Revival conflict");
    character(root, "mara-finn");
    character(root, "jonas-reed", `died-in: chapter-02
revived-in: chapter-03
progressions:
  - from: chapter-02
    field: status
    value: deceased
  - from: chapter-03
    field: status
    value: alive
  - from: chapter-04
    field: status
    value: missing`);
    chapter(root, 1, { links: [2] });
    chapter(root, 2, { links: [3, 4], cast: ["jonas-reed"] });
    chapter(root, 3, { cast: ["jonas-reed"] });
    chapter(root, 4);
    const messages = codes(checkProjectContinuity(root), "progression-death-conflict");
    expect(messages.some((message) => message.includes("from chapter-04"))).toBe(true);
  });

  test("dated progressions on one path apply in story time", () => {
    const root = project("Dated progressions");
    character(root, "mara-finn", `progressions:
  - from: chapter-03
    field: location
    value: the-ford
  - from: chapter-02
    field: location
    value: the-mill`);
    chapter(root, 1, { links: [2] });
    chapter(root, 2, { links: [3], extra: "date: 2020-05-01\n" });
    chapter(root, 3, { links: [4], extra: "date: 2019-01-01\n" });
    chapter(root, 4, { extra: "date: 2021-01-01\n" });
    expect(entityStateAtChapter(root, "character", "mara-finn", "chapter-04").state.location).toBe("the-mill");
  });

  test("an object change in a chapter no path reaches is superseded in number order", () => {
    const root = project("Unreached object");
    character(root, "mara-finn");
    character(root, "jonas-reed");
    brassKey(root);
    chapter(root, 1, { links: [3] });
    chapter(root, 2);
    chapter(root, 3, { links: [4] });
    chapter(root, 4);
    scene(root, 2, "  - target: brass-key\n    owner: jonas-reed");
    scene(root, 3, "  - target: brass-key\n    owner: mara-finn");
    setState(root, 4, { "object-state": "  - artifact: brass-key\n    owner: mara-finn\n" });
    const result = checkProjectContinuity(root);
    expect(codes(result, "state-object-drift")).toEqual([]);
    expect(codes(result, "state-differs-by-path")).toEqual([]);
  });

  test("the whole-book lifeline still reads chapter-number order", () => {
    const root = diamond();
    const scanned = scanProject(root);
    const jonas = scanned.characters.find((entry) => entry.id === "jonas-reed");
    const lifeline = characterLifeline(jonas, chapterChronology(scanned));
    expect(lifeline.deadAtEnd).toBe(true);
    expect(lifeline.events).toEqual([{ type: "death", chapter: "chapter-02", source: "died-in" }]);
  });
});

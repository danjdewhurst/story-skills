import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { checkContinuity } from "../src/continuity.js";
import { formatTimeline } from "../src/timeline.js";
import { createEntity, createStoryProject, diagramProject, scanProject, storyTimeline } from "../src/story.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function writeChapter(root, number, fields, body = "Word ".repeat(number * 10)) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
${fields}
`, `## Chapter Text\n\n${body}\n`);
}

function writeScene(root, chapter, scene, fields) {
  writeMarkdown(path.join(root, "scenes", `${chapter}-scene-0${scene}.md`), `
title: Scene ${chapter} ${scene}
chapter: ${chapter}
scene: ${scene}
status: draft
${fields}
`, "# Scene\n");
}

// Chapter 1 happens on day 5; chapter 2 flashes back to day 1; chapter 3 has
// no scene records and is dated by its own frontmatter; chapter 4 is undated.
function timelineProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Timeline Story", force: false });
  for (const name of ["Mara Quill", "Tom Reed", "Ilya Venn"]) {
    createEntity(root, { kind: "character", name });
  }
  writeChapter(root, 1, "pov: mara-quill\ncharacters:\n  - mara-quill");
  writeChapter(root, 2, "pov: tom-reed\ncharacters:\n  - tom-reed");
  writeChapter(root, 3, "pov: mara-quill\ndate: 2024-03-06\ntime: 09:30\nlocations:\n  - the-reef\ncharacters:\n  - mara-quill");
  writeChapter(root, 4, "characters:\n  - mara-quill");
  writeChapter(root, 5, "pov: mara-quill");
  writeScene(root, "chapter-01", 1, "pov: mara-quill\nlocation: the-dock\ndate: 2024-03-05\ntime: evening\ncharacters:\n  - mara-quill");
  writeScene(root, "chapter-01", 2, "date: 2024-03-05\ntime: dawn\ncharacters:\n  - tom-reed");
  writeScene(root, "chapter-02", 1, "pov: tom-reed\ndate: 2024-03-01\nflashback-to: the storm\ncharacters:\n  - tom-reed");
  writeScene(root, "chapter-04", 1, "pov: mara-quill");
  return { root, cwd };
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

const EXAMPLES = path.resolve(import.meta.dir, "..", "examples");

// Rewrites a character's status and adds frontmatter lines such as died-in.
function setCharacter(root, id, status, extra = "") {
  const file = path.join(root, "characters", `${id}.md`);
  const text = fs.readFileSync(file, "utf8").replace(/^(died-in|revived-in): .*\n/gm, "").replace(/^status: .*$/m, `status: ${status}${extra ? `\n${extra}` : ""}`);
  fs.writeFileSync(file, text, "utf8");
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("story timeline", () => {
  test("orders dated scenes and chapters by story time and marks scenes told late", () => {
    const { root } = timelineProject();
    const timeline = storyTimeline(root);

    expect(timeline.ok).toBe(true);
    expect(timeline.chronology.map((entry) => [entry.id, entry.toldLate])).toEqual([
      ["chapter-02-scene-01", true],
      ["chapter-01-scene-02", true],
      ["chapter-01-scene-01", false],
      ["chapter-03", false]
    ]);
    const chapterThree = timeline.chronology[3];
    expect(chapterThree).toMatchObject({ date: "2024-03-06", time: "09:30", pov: "mara-quill", location: "the-reef", file: "chapters/chapter-03.md" });
    expect(timeline.chronology[1].pov).toBe("mara-quill");
    expect(timeline.undated.map((entry) => entry.id)).toEqual(["chapter-04-scene-01", "chapter-05"]);
  });

  test("reports POV balance by chapter words", () => {
    const { root } = timelineProject();
    const { pov } = storyTimeline(root);

    expect(pov.map((entry) => [entry.pov, entry.chapters, entry.words])).toEqual([
      ["mara-quill", 3, 90],
      ["unspecified", 1, 40],
      ["tom-reed", 1, 20]
    ]);
    expect(Math.round(pov[0].share)).toBe(60);
  });

  test("a book counted in words keeps its POV rows in words and says so", () => {
    const { root, cwd } = timelineProject();
    const timeline = storyTimeline(root);
    expect(timeline.unit).toBe("words");
    expect(timeline.pov.every((entry) => !("characterCount" in entry))).toBe(true);
    const envelope = JSON.parse(invoke(cwd, ["timeline", root, "--json"]).out);
    expect(validateAgainstSchema(envelope, schema)).toEqual([]);
    expect(envelope.data.unit).toBe("words");
  });

  test("a book counted in characters measures POV balance in characters", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Character Timeline", force: false });
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace("schema-version: 2\n", "schema-version: 2\ncount-unit: characters\n"), "utf8");
    // In words, short-words leads (4 to 1); in characters, long-word does
    // (13 to 8), so the order, totals, and shares follow the unit.
    writeChapter(root, 1, "pov: short-words", "a b c d e f g h");
    writeChapter(root, 2, "pov: long-word", "abcdefghijklm");
    const timeline = storyTimeline(root);

    expect(timeline.unit).toBe("characters");
    expect(timeline.pov.map((entry) => [entry.pov, entry.chapters, entry.words, entry.characterCount])).toEqual([
      ["long-word", 1, 1, 13],
      ["short-words", 1, 8, 8]
    ]);
    expect(Math.round(timeline.pov[0].share)).toBe(62);
    const text = formatTimeline(timeline, timeline.totalChapters);
    expect(text).toContain("POV balance:\n- long-word: 1 chapter, 13 characters (62%)\n- short-words: 1 chapter, 8 characters (38%)\n");

    const result = invoke(cwd, ["timeline", root, "--json"]);
    const envelope = JSON.parse(result.out);
    expect(validateAgainstSchema(envelope, schema)).toEqual([]);
    expect(envelope.data.unit).toBe("characters");
    expect(envelope.data.pov[0]).toMatchObject({ pov: "long-word", words: 1, characterCount: 13 });
  });

  test("POV ties in the unit fall back to chapters, words, then id", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Tied Timeline", force: false });
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace("schema-version: 2\n", "schema-version: 2\ncount-unit: characters\n"), "utf8");
    writeChapter(root, 1, "pov: zed", "abcd");
    writeChapter(root, 2, "pov: amy", "abcd");
    writeChapter(root, 3, "pov: bea", "a b");
    writeChapter(root, 4, "pov: bea", "cd");
    writeChapter(root, 5, "pov: cal", "ab cd");
    expect(storyTimeline(root).pov.map((entry) => entry.pov)).toEqual(["bea", "cal", "amy", "zed"]);
  });

  test("reports presence, absences, and characters never on the page", () => {
    const { root } = timelineProject();
    const byId = Object.fromEntries(storyTimeline(root).presence.map((entry) => [entry.id, entry]));

    // Chapter 5 has mara-quill only as its pov, which counts as present.
    expect(byId["mara-quill"]).toEqual({ id: "mara-quill", chapters: 4, first: 1, last: 5, longestGap: 1, gapAfter: 1, trailing: 0, died: null });
    expect(byId["tom-reed"]).toMatchObject({ chapters: 2, first: 1, last: 2, longestGap: 0, trailing: 3 });
    expect(byId["ilya-venn"]).toMatchObject({ chapters: 0, first: null, last: null });
  });

  test("the CLI prints every section", () => {
    const { root, cwd } = timelineProject();
    const result = invoke(cwd, ["timeline", "--path", root]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("Timeline: 4 dated, 2 undated");
    expect(result.out).toContain("- 2024-03-01  chapter-02-scene-01: Scene chapter-02 1 (POV tom-reed) [told in chapter 2, after later events; flashback to the storm]");
    expect(result.out).toContain("- 2024-03-05 evening  chapter-01-scene-01: Scene chapter-01 1 (POV mara-quill, at the-dock)");
    expect(result.out).toContain("Undated (reading order):\n- chapter-04-scene-01: Scene chapter-04 1 (POV mara-quill)\n- chapter-05: Chapter 5 (POV mara-quill)");
    expect(result.out).toContain("- mara-quill: 3 chapters, 90 words (60%)");
    expect(result.out).toContain("- tom-reed: 1 chapter, 20 words (13%)");
    expect(result.out).toContain("- mara-quill: 4 of 5 chapters, chapters 1-5, longest absence 1 chapter after chapter 1");
    expect(result.out).toContain("- ilya-venn: not present in any chapter");
    expect(result.err).toContain("Timeline built: 0 errors");
  });

  test("an empty project prints placeholders", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Empty Timeline", force: false });
    const timeline = storyTimeline(root);
    const text = formatTimeline(timeline, timeline.totalChapters);

    expect(text).toContain("Timeline: 0 dated, 0 undated");
    expect(text).toContain("- None: add date (YYYY-MM-DD)");
    expect(text).toContain("POV balance:\n- None");
    expect(text).toContain("Character presence:\n- None");
    expect(text).not.toContain("Undated");
  });

  test("a chapter present in one chapter shows a single-chapter span, and big numbers get commas", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Long Chapter", force: false });
    createEntity(root, { kind: "character", name: "Solo Hart" });
    writeChapter(root, 1, "pov: solo-hart\ncharacters:\n  - solo-hart\n  - nobody", "word ".repeat(1200));
    writeScene(root, "chapter-01", 1, "characters:\n  - solo-hart\n  - ghost");
    writeScene(root, "chapter-09", 1, "characters:\n  - solo-hart");
    const timeline = storyTimeline(root);
    const text = formatTimeline(timeline, timeline.totalChapters);

    expect(text).toContain("- solo-hart: 1 chapter, 1,200 words (100%)");
    expect(text).toContain("- solo-hart: 1 of 1 chapters, chapter 1");
  });

  test("scenes do not inherit their chapter's date, and a positional path works", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Inherit", force: false });
    writeChapter(root, 1, "date: 2024-03-01\ntime: dawn");
    writeScene(root, "chapter-01", 1, "pov: someone");
    const timeline = storyTimeline(root);

    expect(timeline.chronology).toEqual([]);
    expect(timeline.undated.map((entry) => entry.id)).toEqual(["chapter-01-scene-01"]);
    expect(invoke(cwd, ["timeline", root]).out).toContain("Timeline: 0 dated, 1 undated");
  });

  test("parse errors fail the command", () => {
    const { root, cwd } = timelineProject();
    fs.writeFileSync(path.join(root, "chapters", "chapter-09.md"), "no frontmatter", "utf8");
    const result = invoke(cwd, ["timeline", "--path", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("chapters/chapter-09.md");
  });
});

function newProject(title = "Analysis", cwd = makeTempDir()) {
  return createStoryProject({ cwd, title }).root;
}

function writeChapterWith(root, number, body, extra = "") {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft${extra ? `\n${extra}` : ""}`, `## Chapter Text\n\n${body}\n`);
}

describe("POV shares add up (#216)", () => {
  test("POV shares add up to 100", () => {
    const root = newProject();
    ["a", "b", "c"].forEach((pov, index) => writeChapterWith(root, index + 1, "word ".repeat(100), `pov: ${pov}`));
    const out = invoke(path.dirname(root), ["timeline", root]).out;
    const shares = [...out.matchAll(/words \((\d+)%\)/g)].map((match) => Number(match[1]));
    expect(shares).toHaveLength(3);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(100);
  });
});

describe("timeline and the clock", () => {
  test("an untimed scene is not told out of order against a timed one the same day (#61)", () => {
    const root = baseProject(2);
    writeBaseScene(root, 1, 1, "date: 2024-01-01\ntime: \"10:00\"");
    writeBaseScene(root, 2, 1, "date: 2024-01-01");
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
    writeBaseScene(root, 1, 1, "date: 2024-01-01\ntime: \"10:00\"");
    writeBaseScene(root, 1, 2, "date: 2024-01-01");
    writeBaseScene(root, 2, 1, "date: 2024-01-01\ntime: \"08:00\"");
    const timeline = storyTimeline(root);
    expect(timeline.chronology.map((entry) => [entry.id, entry.toldLate])).toEqual([
      ["chapter-02-scene-01", true],
      ["chapter-01-scene-01", false],
      ["chapter-01-scene-02", false]
    ]);
    expect(messages(continuity(root).warnings)).toEqual(["scenes/chapter-02-scene-01.md timestamp runs backward"]);
  });

  test("continuity and timeline share one chronology of scenes and scene-less chapters (#155)", () => {
    const root = baseProject(4);
    writeBaseChapter(root, 1, "date: 2024-05-01\ntime: \"22:00\"");
    writeBaseChapter(root, 2, "date: 2024-05-01\ntime: \"08:00\"");
    writeBaseChapter(root, 3, "date: 2024-06-10");
    writeBaseScene(root, 4, 1, "date: 2024-06-01\ntime: \"10:00\"");
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
    writeBaseChapter(root, 1, "date: 2024-05-10");
    writeBaseChapter(root, 2, "date: 2024-05-01");
    writeBaseScene(root, 2, 1, "pov: ann");
    expect(messages(continuity(root).warnings).join("\n")).not.toContain("earlier than");
  });

  test("timeline lists dated scenes whose chapter file is missing (#170)", () => {
    const root = baseProject(5);
    writeBaseScene(root, 7, 1, "date: 2024-05-02\ntime: \"10:00\"");
    writeBaseScene(root, 7, 2, "date: 2024-05-01\ntime: \"10:00\"");
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

describe("timeline presence and deaths (#174)", () => {
  test("a dead character reads died in chapter N, not absent", () => {
    const root = baseProject(4);
    setCharacter(root, "bob", "deceased", "died-in: chapter-02");
    writeBaseChapter(root, 1, "characters:\n  - ann\n  - bob");
    writeBaseChapter(root, 2, "characters:\n  - ann\n  - bob");
    writeBaseChapter(root, 3, "characters:\n  - ann");
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

describe("sweep fixes", () => {
  test("timeline counts a pov-only chapter as presence", () => {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace('pov: ""', "pov: mara"));
    expect(invoke(path.dirname(root), ["timeline", root]).out).toContain("- mara: 1 of 1 chapters");
  });
});

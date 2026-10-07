import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { buildPacing, formatPacing } from "../src/pacing.js";
import { createEntity, createStoryProject, pacingReport, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function project() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Pace", force: false });
  return { root, cwd };
}

function writeChapter(root, number, fields, words) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
${fields}
`, `## Chapter Text\n\n${"word ".repeat(words)}\n`);
}

function writeScene(root, chapter, scene, fields) {
  writeMarkdown(path.join(root, "scenes", `${chapter}-scene-0${scene}.md`), `
title: ${chapter} ${scene}
chapter: ${chapter}
scene: ${scene}
status: draft
${fields}
`, "# Scene\n");
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

describe("story pacing", () => {
  test("tabulates scenes, sequels, outcomes, and hooks per chapter", () => {
    const { root } = project();
    writeChapter(root, 1, "status: draft\nhook: question", 100);
    writeChapter(root, 2, "status: outline", 0);
    writeScene(root, "chapter-01", 1, "outcome: yes-but");
    writeScene(root, "chapter-01", 2, "sequel: true");
    writeScene(root, "chapter-01", 3, "outcome: no-and");

    const report = pacingReport(root);
    expect(report.ok).toBe(true);
    expect(report.rows[0]).toEqual({
      id: "chapter-01",
      number: 1,
      words: 100,
      characterCount: null,
      scenes: 2,
      sequels: 1,
      outcomes: { yes: 0, no: 0, "yes-but": 1, "no-and": 1 },
      hook: "question",
      status: "draft"
    });
    expect(report.totals).toEqual({ scenes: 2, sequels: 1, outcomesRecorded: 2, setbacks: 2, hooks: 1 });
    expect(messages(report.warnings)).toEqual([]);

    const text = formatPacing(report);
    expect(text).toContain("Outcomes: 100% of recorded outcomes are setbacks or complications");
    expect(text).toContain(" 1    100       2        1  0/0/1/1                           question");
    expect(text).toContain(" 2      0       0        0  0/0/0/0                           -");
  });

  test("flags easy-win runs, missing sequels, resolution runs, missing hooks, and length outliers", () => {
    const { root } = project();
    writeChapter(root, 1, "status: draft\nhook: resolution", 1000);
    writeChapter(root, 2, "status: draft\nhook: resolution", 1000);
    writeChapter(root, 3, "status: draft\nhook: resolution", 3000);
    writeChapter(root, 4, "status: draft", 300);
    writeScene(root, "chapter-01", 1, "outcome: yes");
    writeScene(root, "chapter-02", 1, "outcome: yes");
    writeScene(root, "chapter-03", 1, "outcome: yes");
    writeScene(root, "chapter-04", 1, "outcome: no");

    expect(messages(pacingReport(root).warnings)).toEqual([
      "chapter-04 has no hook: record how the chapter ending pulls the reader on",
      "3 scenes in a row end in an outright yes (chapter-01-scene-01 to chapter-03-scene-01): raise the cost with yes-but or no-and",
      "4 scene units in a row with no sequel (chapter-01-scene-01 to chapter-04-scene-01): give the POV character room to react and decide",
      "3 chapters in a row end on resolution (chapter-01 to chapter-03): readers can put the book down",
      "chapter-03 runs 3000 words, over twice the median chapter (1000): consider splitting it",
      "chapter-04 runs 300 words, under half the median chapter (1000): check it earns its place"
    ]);
  });

  test("easy-win runs skip sequels and a trailing run is reported; even medians average", () => {
    const { root } = project();
    writeChapter(root, 1, "status: outline", 0);
    writeScene(root, "chapter-01", 1, "outcome: yes");
    writeScene(root, "chapter-01", 2, "sequel: true");
    writeScene(root, "chapter-01", 3, "outcome: yes");
    writeScene(root, "chapter-01", 4, "outcome: yes");
    writeScene(root, "chapter-01", 5, "outcome: yes");
    expect(messages(pacingReport(root).warnings)).toEqual([
      "4 scenes in a row end in an outright yes (chapter-01-scene-01 to chapter-01-scene-05): raise the cost with yes-but or no-and"
    ]);
    writeChapter(root, 2, "status: outline", 10);
    writeChapter(root, 1, "status: outline", 20);
    expect(pacingReport(root).medianWords).toBe(15);
  });

  test("a sequel closes a long run without one, and a trailing run of resolutions is reported", () => {
    const { root } = project();
    for (const number of [1, 2, 3]) {
      writeChapter(root, number, "status: draft\nhook: resolution", 100);
    }
    for (const scene of [1, 2, 3, 4]) {
      writeScene(root, "chapter-01", scene, "outcome: no");
    }
    writeScene(root, "chapter-01", 5, "sequel: true");
    expect(messages(pacingReport(root).warnings)).toEqual([
      "4 scene units in a row with no sequel (chapter-01-scene-01 to chapter-01-scene-04): give the POV character room to react and decide",
      "3 chapters in a row end on resolution (chapter-01 to chapter-03): readers can put the book down"
    ]);
  });

  test("validate checks outcome and hook values; add writes them", () => {
    const { root } = project();
    createEntity(root, { kind: "chapter", name: "Opening", number: "1", hook: "cliffhanger" });
    createEntity(root, { kind: "scene", name: "Arrival", chapter: "chapter-01", outcome: "no-and" });
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8")).toContain("hook: cliffhanger");
    expect(fs.readFileSync(path.join(root, "scenes", "chapter-01-scene-01.md"), "utf8")).toContain("outcome: no-and");
    expect(messages(validateProject(root).errors)).toEqual([]);

    expect(() => createEntity(root, { kind: "scene", name: "Bad", chapter: "chapter-01", outcome: "maybe" })).toThrow('Unsupported scene outcome "maybe": expected one of yes, no, yes-but, no-and');
    writeScene(root, "chapter-01", 3, "outcome: maybe");
    writeChapter(root, 2, "status: draft\nhook: meh", 5);
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain("scenes/chapter-01-scene-03.md frontmatter field outcome has unsupported value maybe");
    expect(errors).toContain("chapters/chapter-02.md frontmatter field hook has unsupported value meh");
  });

  test("CLI prints the dashboard and an empty-state hint", () => {
    const { root, cwd } = project();
    const empty = invoke(cwd, ["pacing", root]);
    expect(empty.code).toBe(0);
    expect(empty.out).toContain("- None: add chapters with story add chapter");
    expect(empty.out).toContain("Outcomes: no outcomes recorded");
    expect(empty.err).toContain("Pacing check complete");
  });
});

describe("pacing and clues (#216, #217, #223)", () => {
  const chapter = (number, words) => ({ id: `chapter-${String(number).padStart(2, "0")}`, number, wordCount: words, hook: "x", status: "draft" });

  test("#217 the median is compared exactly", () => {
    const pacing = buildPacing({ chapters: [100, 100, 101, 202].map((words, index) => chapter(index + 1, words)), scenes: [] });
    expect(messages(pacing.warnings).join("\n")).toContain("chapter-04 runs 202 words, over twice the median chapter");
  });

  test("#216 #223 pacing says 1 scene and keeps wide rows aligned", () => {
    const pacing = buildPacing({ chapters: [chapter(9, 5), chapter(100, 123456)], scenes: [{ id: "s", chapter: "chapter-09", scene: 1, sequel: true, outcome: "" }] });
    const text = formatPacing(pacing);
    expect(text).toContain("Pacing: 0 scenes, 1 sequel, 2 of 2 chapters with hooks");
    const rows = text.split("\n").filter((line) => /^\s*\d/.test(line));
    expect(rows[0].indexOf("x")).toBe(rows[1].indexOf("x"));
    expect(rows[0].length).toBe(rows[1].length);
  });
});

describe("review fixes", () => {
  test("sequels never count toward chapter outcomes", () => {
    const { root } = reviewProject();
    writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), "title: S\nchapter: chapter-01\nscene: 1\nstatus: draft\nsequel: true\noutcome: yes", "# S\n");
    const report = pacingReport(root);
    expect(report.rows[0].outcomes).toEqual({ yes: 0, no: 0, "yes-but": 0, "no-and": 0 });
    expect(report.totals.outcomesRecorded).toBe(0);
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { formatPacing } from "../src/pacing.js";
import { createEntity, createStoryProject, pacingReport, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

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
      scenes: 2,
      sequels: 1,
      outcomes: { yes: 0, no: 0, "yes-but": 1, "no-and": 1 },
      hook: "question",
      status: "draft"
    });
    expect(report.totals).toEqual({ scenes: 2, sequels: 1, outcomesRecorded: 2, setbacks: 2, hooks: 1 });
    expect(report.warnings).toEqual([]);

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

    expect(pacingReport(root).warnings).toEqual([
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
    expect(pacingReport(root).warnings).toEqual([
      "4 scenes in a row end in an outright yes (chapter-01-scene-01 to chapter-01-scene-05): raise the cost with yes-but or no-and"
    ]);
    writeChapter(root, 2, "status: outline", 10);
    writeChapter(root, 1, "status: outline", 20);
    expect(pacingReport(root).medianWords).toBe(15);
  });

  test("validate checks outcome and hook values; add writes them", () => {
    const { root } = project();
    createEntity(root, { kind: "chapter", name: "Opening", number: "1", hook: "cliffhanger" });
    createEntity(root, { kind: "scene", name: "Arrival", chapter: "chapter-01", outcome: "no-and" });
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8")).toContain("hook: cliffhanger");
    expect(fs.readFileSync(path.join(root, "scenes", "chapter-01-scene-01.md"), "utf8")).toContain("outcome: no-and");
    expect(validateProject(root).errors).toEqual([]);

    expect(() => createEntity(root, { kind: "scene", name: "Bad", chapter: "chapter-01", outcome: "maybe" })).toThrow();
    writeScene(root, "chapter-01", 3, "outcome: maybe");
    writeChapter(root, 2, "status: draft\nhook: meh", 5);
    const errors = validateProject(root).errors;
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

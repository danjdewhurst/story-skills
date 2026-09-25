import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { formatTimeline } from "../src/timeline.js";
import { createEntity, createStoryProject, storyTimeline } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

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

  test("reports presence, absences, and characters never on the page", () => {
    const { root } = timelineProject();
    const byId = Object.fromEntries(storyTimeline(root).presence.map((entry) => [entry.id, entry]));

    // Chapter 5 has mara-quill only as its pov, which counts as present.
    expect(byId["mara-quill"]).toEqual({ id: "mara-quill", chapters: 4, first: 1, last: 5, longestGap: 1, gapAfter: 1, trailing: 0 });
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

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { chapterProse, wordCount } from "../src/markdown.js";
import {
  checkProjectContinuity,
  createEntity,
  createStoryProject,
  mergeChapters,
  splitChapter,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const examplesRoot = path.resolve(import.meta.dir, "..", "examples");

function read(root, ...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

function data(root, ...parts) {
  return parseFrontmatter(read(root, ...parts)).data;
}

function prose(root, id) {
  return chapterProse(parseFrontmatter(read(root, "chapters", `${id}.md`)).body).trim();
}

function snapshot(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files[path.relative(root, full)] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(root);
  return files;
}

// Replaces a chapter's prose, everything after `## Chapter Text`.
function setProse(root, id, text) {
  const file = path.join(root, "chapters", `${id}.md`);
  const markdown = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, `${markdown.slice(0, markdown.indexOf("## Chapter Text"))}## Chapter Text\n\n${text}`, "utf8");
}

function setFields(root, relativePath, fields) {
  const file = path.join(root, relativePath);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\nstatus: /, `\n${fields}status: `), "utf8");
}

function errors(root) {
  return [...validateProject(root).errors, ...validateLinks(root).errors, ...checkProjectContinuity(root).errors];
}

function codes(result) {
  return result.warnings.map((warning) => warning.code);
}

const CHAPTER_TWO = `Mara walked to the quay.

The tide was out.

* * *

The boat was late.

### The Ferry

The ferry came at noon.
`;

// Four chapters. Chapter 2 has two scenes of text and two scene records, a
// hook, and a clue planted in it and paid off in chapter 3, which has a
// scene of its own. continuity/state.md says chapter 2 is the latest.
function book() {
  const root = createStoryProject({ cwd: makeTempDir(), title: "Split Book" }).root;
  createEntity(root, { kind: "character", name: "Mara Quill" });
  for (const name of ["One", "Two", "Three", "Four"]) {
    createEntity(root, { kind: "chapter", name, status: "draft", characters: ["mara-quill"] });
  }
  setProse(root, "chapter-01", "Mara woke.\n");
  setProse(root, "chapter-02", CHAPTER_TWO);
  setProse(root, "chapter-03", "The ferry crossed.\n");
  setProse(root, "chapter-04", "They landed.\n");
  setFields(root, path.join("chapters", "chapter-02.md"), "hook: reversal\n");
  createEntity(root, { kind: "scene", name: "The Quay", chapter: "chapter-02", characters: ["mara-quill"] });
  createEntity(root, { kind: "scene", name: "The Boat", chapter: "chapter-02", characters: ["mara-quill"] });
  createEntity(root, { kind: "scene", name: "The Crossing", chapter: "chapter-03", characters: ["mara-quill"] });
  createEntity(root, { kind: "clue", name: "The Ticket", planted: "chapter-02", payoff: "chapter-03", status: "paid-off", characters: ["mara-quill"] });
  const state = path.join(root, "continuity", "state.md");
  fs.writeFileSync(state, read(root, "continuity", "state.md").replace(/current-chapter: \d+/, "current-chapter: 2"), "utf8");
  runCli(["wordcount", "--write", "--path", root], memoryIo(root));
  return root;
}

describe("story split", () => {
  test("splits at a scene break, renumbers the chapters after it, and moves the later scenes", () => {
    const root = book();
    expect(errors(root)).toEqual([]);
    const words = data(root, "chapters", "chapter-02.md")["word-count"];

    const result = splitChapter(root, { id: "chapter-02", at: "1" });

    expect(result).toMatchObject({ id: "chapter-02", newId: "chapter-03", title: "Two (continued)", scenesMoved: 1, renumbered: 2 });
    expect(fs.readdirSync(path.join(root, "chapters")).sort()).toEqual(["_index.md", "chapter-01.md", "chapter-02.md", "chapter-03.md", "chapter-04.md", "chapter-05.md"]);
    expect(prose(root, "chapter-02")).toBe("Mara walked to the quay.\n\nThe tide was out.");
    expect(prose(root, "chapter-03")).toBe("The boat was late.\n\n### The Ferry\n\nThe ferry came at noon.");
    expect(prose(root, "chapter-04")).toBe("The ferry crossed.");
    expect(prose(root, "chapter-05")).toBe("They landed.");

    const first = data(root, "chapters", "chapter-02.md");
    const second = data(root, "chapters", "chapter-03.md");
    expect(first.hook).toBeUndefined();
    expect(second).toMatchObject({ title: "Two (continued)", number: 3, status: "draft", characters: ["mara-quill"], hook: "reversal", "arcs-advanced": [] });
    expect(first["word-count"]).toBe(wordCount(prose(root, "chapter-02")));
    expect(first["word-count"] + second["word-count"]).toBe(words);
    expect(read(root, "chapters", "chapter-03.md")).toContain("# Chapter 3: Two (continued)\n\n## Chapter Text\n\nThe boat was late.");

    expect(fs.readdirSync(path.join(root, "scenes")).sort()).toEqual(["_index.md", "chapter-02-scene-01.md", "chapter-03-scene-01.md", "chapter-04-scene-01.md"]);
    expect(data(root, "scenes", "chapter-03-scene-01.md")).toMatchObject({ title: "The Boat", chapter: "chapter-03", scene: 1 });
    expect(data(root, "scenes", "chapter-04-scene-01.md")).toMatchObject({ title: "The Crossing", chapter: "chapter-04" });
    expect(data(root, "continuity", "clues", "the-ticket.md")).toMatchObject({ planted: "chapter-02", payoff: "chapter-04" });
    expect(data(root, "continuity", "state.md")["current-chapter"]).toBe(3);
    expect(read(root, "chapters", "_index.md")).toContain("chapter-05.md");

    expect(codes(result)).toEqual(["split-references"]);
    expect(result.warnings[0].message).toContain("continuity/clues/the-ticket.md");
    expect(result.warnings[0].message).toContain("should name chapter-03 instead");
    expect(errors(root)).toEqual([]);
  });

  test("splits before a heading or a line, and --title names the new chapter", () => {
    const atHeading = book();
    const result = splitChapter(atHeading, { id: "chapter-02", at: "The Ferry", title: "The Ferry" });
    expect(result.scenesMoved).toBe(0);
    expect(prose(atHeading, "chapter-02")).toBe("Mara walked to the quay.\n\nThe tide was out.\n\n* * *\n\nThe boat was late.");
    expect(prose(atHeading, "chapter-03")).toBe("### The Ferry\n\nThe ferry came at noon.");
    expect(data(atHeading, "chapters", "chapter-03.md").title).toBe("The Ferry");
    // The split falls inside the second scene, whose record stays.
    expect(codes(result)).toContain("split-scenes");
    expect(result.warnings.find((warning) => warning.code === "split-scenes").message).toContain("falls inside the text of chapter-02-scene-02");

    const atLine = book();
    splitChapter(atLine, { id: "chapter-02", at: "boat was" });
    expect(prose(atLine, "chapter-03")).toStartWith("The boat was late.");
    // A scene break just before the split point is dropped.
    expect(prose(atLine, "chapter-02")).toBe("Mara walked to the quay.\n\nThe tide was out.");
    expect(fs.existsSync(path.join(atLine, "scenes", "chapter-03-scene-01.md"))).toBe(true);
  });

  test("an exact line wins over lines that only contain the marker", () => {
    const root = book();
    setProse(root, "chapter-02", "The tide was out, and the tide was turning.\n\nThe tide was out\n\nThe end.\n");
    splitChapter(root, { id: "chapter-02", at: "The tide was out" });
    expect(prose(root, "chapter-03")).toBe("The tide was out\n\nThe end.");
  });

  test("refuses a marker that matches nothing, several lines, or an end of the text, and changes nothing", () => {
    const root = book();
    const before = snapshot(root);
    expect(() => splitChapter(root, { id: "chapter-02", at: "The" })).toThrow('--at "The" matches 4 lines in chapter-02');
    expect(() => splitChapter(root, { id: "chapter-02", at: "dragon" })).toThrow('--at "dragon" matches no line in the chapter text of chapter-02');
    expect(() => splitChapter(root, { id: "chapter-02", at: "Mara walked" })).toThrow("is at the start of the chapter text");
    expect(() => splitChapter(root, { id: "chapter-02", at: "2" })).toThrow("chapter chapter-02 has 1 scene break, so give a number from 1 to 1");
    expect(() => splitChapter(root, { id: "chapter-03", at: "1" })).toThrow("chapter chapter-03 has no scene breaks");
    expect(() => splitChapter(root, { id: "chapter-02" })).toThrow("split requires --at <marker>");
    expect(() => splitChapter(root, { id: "chapter-09", at: "1" })).toThrow("chapter chapter-09 does not exist");
    expect(() => splitChapter(root, { id: "chapter-02", at: "1", title: " " })).toThrow("--title cannot be empty");
    setProse(root, "chapter-04", "They landed.\n\n* * *\n\n<!-- later -->\n");
    const ending = snapshot(root);
    expect(() => splitChapter(root, { id: "chapter-04", at: "1" })).toThrow("is at the end of the chapter text of chapter-04");
    expect(snapshot(root)).toEqual(ending);
    setProse(root, "chapter-04", "They landed.\n");
    expect(snapshot(root)).toEqual(before);
  });

  test("markers and scene breaks inside comments and code fences do not count", () => {
    const root = book();
    setProse(root, "chapter-02", "Mara walked.\n\n<!--\n* * *\nhidden line\n-->\n\n```\n* * *\n```\n\nThe end.\n");
    expect(() => splitChapter(root, { id: "chapter-02", at: "1" })).toThrow("has no scene breaks");
    expect(() => splitChapter(root, { id: "chapter-02", at: "hidden line" })).toThrow("matches no line");
  });

  test("warns when the scene records do not match the scenes of text", () => {
    const root = book();
    createEntity(root, { kind: "scene", name: "Extra", chapter: "chapter-02" });
    const result = splitChapter(root, { id: "chapter-02", at: "1" });
    const warning = result.warnings.find((entry) => entry.code === "split-scenes");
    expect(warning.message).toContain("has 3 scene records but 2 scenes of text");
    expect(warning.message).toContain("moved chapter-02-scene-02, chapter-02-scene-03 to chapter-03");
    expect(fs.existsSync(path.join(root, "scenes", "chapter-03-scene-02.md"))).toBe(true);
  });

  test("leaves the chapters after a numbering gap alone", () => {
    const root = book();
    createEntity(root, { kind: "chapter", name: "Ten", number: 10 });
    const result = splitChapter(root, { id: "chapter-02", at: "1" });
    expect(result.renumbered).toBe(2);
    expect(fs.existsSync(path.join(root, "chapters", "chapter-10.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "chapters", "chapter-11.md"))).toBe(false);
  });

  test("keeps a CRLF chapter CRLF", () => {
    const root = book();
    const file = path.join(root, "chapters", "chapter-02.md");
    fs.writeFileSync(file, read(root, "chapters", "chapter-02.md").replace(/\r?\n/g, "\r\n"), "utf8");
    splitChapter(root, { id: "chapter-02", at: "1" });
    for (const id of ["chapter-02", "chapter-03"]) {
      expect(read(root, "chapters", `${id}.md`).replace(/\r\n/g, "")).not.toContain("\n");
    }
    expect(prose(root, "chapter-03").replace(/\r/g, "")).toStartWith("The boat was late.");
  });

  test("the CLI says what moved, and a split stopped part way says a rerun cannot finish it", () => {
    const root = book();
    const io = memoryIo(root);
    expect(runCli(["split", "chapter-02", "--at", "1"], io)).toBe(0);
    expect(io.output()).toMatch(/^Split chapter chapter-02: the rest is chapter-03 "Two \(continued\)": .*chapter-03\.md \(moved 1 scene, renumbered 2 chapters\)\n$/);
    const merged = memoryIo(root);
    expect(runCli(["merge", "chapter-04", "chapter-05"], merged)).toBe(0);
    expect(merged.output()).toMatch(/^Merged chapter chapter-05 into chapter-04: .*chapter-04\.md\n$/);

    // A scene file whose frontmatter names another chapter stays put when
    // its chapter is renumbered, so the scene the split moves finds it.
    const stray = book();
    const crossing = path.join(stray, "scenes", "chapter-03-scene-01.md");
    fs.writeFileSync(crossing, read(stray, "scenes", "chapter-03-scene-01.md").replace("chapter: chapter-03", "chapter: chapter-09"), "utf8");
    const failed = memoryIo(stray);
    expect(runCli(["split", "chapter-02", "--at", "1"], failed)).toBe(4);
    expect(failed.error()).toContain("chapter-03-scene-01 already exists: move it first. Some files were already changed, so a rerun cannot finish the job");
  });

  test("refuses duplicate chapter numbers and a file in the new chapter's place", () => {
    const duplicate = book();
    fs.copyFileSync(path.join(duplicate, "chapters", "chapter-03.md"), path.join(duplicate, "chapters", "chapter-3.md"));
    expect(() => splitChapter(duplicate, { id: "chapter-02", at: "1" })).toThrow(/chapter-0?3\.md and chapters.chapter-0?3\.md share chapter number 3/);

    const taken = book();
    for (const id of ["chapter-04", "chapter-03"]) {
      const file = path.join(taken, "chapters", `${id}.md`);
      fs.writeFileSync(file, read(taken, "chapters", `${id}.md`).replace(/^number: \d+$/m, `number: ${id === "chapter-03" ? 7 : 8}`), "utf8");
    }
    expect(() => splitChapter(taken, { id: "chapter-02", at: "1" })).toThrow("chapters/chapter-03.md already exists and is not chapter 3");
  });

  test("works without a trailing newline or continuity/state.md", () => {
    const root = book();
    setProse(root, "chapter-02", "Mara walked.\n\n* * *\n\nThe end.");
    fs.rmSync(path.join(root, "continuity", "state.md"));
    splitChapter(root, { id: "chapter-02", at: "1" });
    expect(prose(root, "chapter-03")).toBe("The end.");
  });

  test("refuses a branching book", () => {
    const root = book();
    setFields(root, path.join("chapters", "chapter-01.md"), "choices:\n  - text: Go on\n    to: chapter-02\n");
    const before = snapshot(root);
    expect(() => splitChapter(root, { id: "chapter-02", at: "1" })).toThrow("story split does not work on a branching book: chapters/chapter-01.md has choices");
    expect(() => mergeChapters(root, { id: "chapter-02", next: "chapter-03" })).toThrow("story merge does not work on a branching book");
    expect(snapshot(root)).toEqual(before);
  });
});

describe("story merge", () => {
  test("joins the prose, notes, lists, and scenes, rewrites references, and closes the gap", () => {
    const root = book();
    setFields(root, path.join("chapters", "chapter-03.md"), "hook: cliffhanger\n");
    createEntity(root, { kind: "character", name: "Ilse Marrow" });
    const third = path.join(root, "chapters", "chapter-03.md");
    fs.writeFileSync(third, read(root, "chapters", "chapter-03.md")
      .replace("  - mara-quill\n", "  - mara-quill\n  - ilse-marrow\n")
      .replace("1. Opening beat\n2. Escalation\n3. Turn or decision\n", "1. The crossing\n\n## Notes\n\nRough water.\n"), "utf8");
    fs.writeFileSync(path.join(root, "plot", "timeline.md"), `${read(root, "plot", "timeline.md")}\n- chapter-03: the crossing; chapter-04: the landing\n`, "utf8");
    runCli(["wordcount", "--write", "--path", root], memoryIo(root));
    const words = data(root, "chapters", "chapter-02.md")["word-count"] + data(root, "chapters", "chapter-03.md")["word-count"];

    const result = mergeChapters(root, { id: "chapter-02", next: "chapter-03" });

    expect(result).toMatchObject({ id: "chapter-02", mergedId: "chapter-03", scenesMoved: 1, renumbered: 1 });
    expect(result.warnings).toEqual([]);
    expect(fs.readdirSync(path.join(root, "chapters")).sort()).toEqual(["_index.md", "chapter-01.md", "chapter-02.md", "chapter-03.md"]);
    expect(prose(root, "chapter-02")).toBe(`${CHAPTER_TWO.trim()}\n\n* * *\n\nThe ferry crossed.`);
    expect(prose(root, "chapter-03")).toBe("They landed.");
    const merged = data(root, "chapters", "chapter-02.md");
    expect(merged).toMatchObject({ title: "Two", number: 2, hook: "cliffhanger", characters: ["mara-quill", "ilse-marrow"], "word-count": words });
    const text = read(root, "chapters", "chapter-02.md");
    expect(text).toContain("## Outline\n\n1. Opening beat\n2. Escalation\n3. Turn or decision\n1. The crossing\n\n## Notes\n\nRough water.\n\n---\n\n## Chapter Text\n\nMara walked");
    expect(data(root, "scenes", "chapter-02-scene-03.md")).toMatchObject({ title: "The Crossing", chapter: "chapter-02", scene: 3 });
    expect(data(root, "continuity", "clues", "the-ticket.md")).toMatchObject({ planted: "chapter-02", payoff: "chapter-02" });
    expect(read(root, "plot", "timeline.md")).toContain("- chapter-02: the crossing; chapter-03: the landing");
    expect(read(root, "chapters", "_index.md")).not.toContain("chapter-04.md");
    expect(errors(root)).toEqual([]);
  });

  test("keeps the first chapter's value for a field both set and warns", () => {
    const root = book();
    createEntity(root, { kind: "character", name: "Ilse Marrow" });
    setFields(root, path.join("chapters", "chapter-02.md"), "");
    const second = path.join(root, "chapters", "chapter-02.md");
    fs.writeFileSync(second, read(root, "chapters", "chapter-02.md").replace("pov: \"\"", "pov: mara-quill"), "utf8");
    const third = path.join(root, "chapters", "chapter-03.md");
    fs.writeFileSync(third, read(root, "chapters", "chapter-03.md").replace("pov: \"\"", "pov: ilse-marrow").replace("status: draft", "status: outline"), "utf8");
    const result = mergeChapters(root, { id: "chapter-02", next: "chapter-03" });
    expect(codes(result)).toEqual(["merge-conflicts", "merge-conflicts"]);
    expect(result.warnings[0].message).toContain('chapter-03 set pov "ilse-marrow", which the merged chapter-02 does not take');
    expect(result.warnings[1].message).toContain('chapter-02\'s hook "reversal" was dropped');
    const merged = data(root, "chapters", "chapter-02.md");
    expect(merged.pov).toBe("mara-quill");
    expect(merged.status).toBe("outline");
    expect(merged.hook).toBeUndefined();
  });

  test("keeps the later of two progressions that now start in the same chapter", () => {
    const root = book();
    const mara = path.join(root, "characters", "mara-quill.md");
    fs.writeFileSync(mara, read(root, "characters", "mara-quill.md").replace("\n---\n", "\nprogressions:\n  - from: chapter-02\n    field: occupation\n    value: clerk\n  - from: chapter-03\n    field: occupation\n    value: ferry hand\n  - from: chapter-04\n    field: occupation\n    value: pilot\n---\n"), "utf8");
    expect(errors(root)).toEqual([]);
    const result = mergeChapters(root, { id: "chapter-02", next: "chapter-03" });
    expect(codes(result)).toContain("merge-conflicts");
    expect(data(root, "characters", "mara-quill.md").progressions).toEqual([
      { from: "chapter-02", field: "occupation", value: "ferry hand" },
      { from: "chapter-03", field: "occupation", value: "pilot" }
    ]);
    expect(errors(root)).toEqual([]);
  });

  test("moves current-chapter off the merged chapter", () => {
    const root = book();
    mergeChapters(root, { id: "chapter-01", next: "chapter-02" });
    expect(data(root, "continuity", "state.md")["current-chapter"]).toBe(1);
  });

  test("refuses chapters that are not neighbours in order, and changes nothing", () => {
    const root = book();
    fs.writeFileSync(path.join(root, "scenes", "chapter-02-scene-03.md"), read(root, "scenes", "chapter-03-scene-01.md").replace("scene: 1", "scene: 3").replace("chapter: chapter-03", "chapter: chapter-09"), "utf8");
    const before = snapshot(root);
    expect(() => mergeChapters(root, { id: "chapter-02", next: "chapter-03" })).toThrow("scenes/chapter-02-scene-03.md already exists; nothing was changed");
    expect(() => mergeChapters(root, { id: "chapter-03", next: "chapter-02" })).toThrow("chapter-02 comes before chapter-03: name the earlier chapter first (story merge chapter-02 chapter-03)");
    expect(() => mergeChapters(root, { id: "chapter-01", next: "chapter-03" })).toThrow("chapter-03 does not follow chapter-01: merge takes neighbouring chapters, and chapter-02 comes between them");
    expect(() => mergeChapters(root, { id: "chapter-02", next: "chapter-02" })).toThrow("merge needs two different chapters");
    expect(() => mergeChapters(root, { id: "chapter-02" })).toThrow("merge requires two chapter ids");
    expect(() => mergeChapters(root, { id: "chapter-02", next: "chapter-09" })).toThrow("chapter chapter-09 does not exist");
    expect(snapshot(root)).toEqual(before);
  });

  test("a chapter with no notes or prose merges cleanly", () => {
    const root = createStoryProject({ cwd: makeTempDir(), title: "Bare Book" }).root;
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "\n# Chapter 1: One\n\nFirst words.\n");
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Two\nnumber: 2\nstatus: draft", "\n# Chapter 2: Two\n\n## Outline\n\n1. A beat\n\n---\n\nSecond words.\n");
    mergeChapters(root, { id: "chapter-01", next: "chapter-02" });
    const text = read(root, "chapters", "chapter-01.md");
    expect(text).toContain("# Chapter 1: One\n\n## Outline\n\n1. A beat\n\n## Chapter Text\n\nFirst words.\n\n* * *\n\nSecond words.\n");
    expect(data(root, "chapters", "chapter-01.md")["word-count"]).toBe(4);
  });
});

describe("split and merge on the examples", () => {
  const names = fs.readdirSync(examplesRoot).filter((name) => fs.existsSync(path.join(examplesRoot, name, "chapters", "chapter-02.md")));

  for (const name of names) {
    test(`${name}: merging chapters 1 and 2 and splitting them again keeps the prose and adds no errors`, () => {
      const root = path.join(makeTempDir(), name);
      fs.cpSync(path.join(examplesRoot, name), root, { recursive: true });
      const baseline = errors(root).length;
      const firstProse = prose(root, "chapter-01");
      const secondProse = prose(root, "chapter-02");
      if (fs.readdirSync(path.join(root, "chapters")).some((file) => /^choices:/m.test(read(root, "chapters", file)))) {
        expect(() => mergeChapters(root, { id: "chapter-01", next: "chapter-02" })).toThrow("does not work on a branching book");
        return;
      }
      const chapters = fs.readdirSync(path.join(root, "chapters")).length;

      mergeChapters(root, { id: "chapter-01", next: "chapter-02" });
      expect(errors(root).length).toBeLessThanOrEqual(baseline);
      expect(fs.readdirSync(path.join(root, "chapters")).length).toBe(chapters - 1);

      // The merge put its scene break after the first chapter's own breaks.
      const breaks = firstProse.split(/\n\s*\n/).filter((paragraph) => /^([*_~-])( ?\1){2,}$|^#$/.test(paragraph.trim())).length;
      const split = splitChapter(root, { id: "chapter-01", at: String(breaks + 1) });
      // A merge points the second chapter's references at the first, and a
      // split leaves them there (listing them to check), so a reference that
      // matters to continuity can move: the-unraveled-thread, broken on
      // purpose, kills a character in chapter 2. A valid example stays valid.
      if (baseline === 0) {
        expect(errors(root)).toEqual([]);
      } else {
        expect(codes(split)).toContain("split-references");
      }
      expect(fs.readdirSync(path.join(root, "chapters")).length).toBe(chapters);
      expect(prose(root, "chapter-01")).toBe(firstProse);
      expect(prose(root, "chapter-02")).toBe(secondProse);
    });
  }
});

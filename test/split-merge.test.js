import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { writeFile } from "../src/files.js";
import { restructureWrites } from "../src/mutate.js";
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
import { CHMOD_IGNORED, makeTempDir, memoryIo, whileWriting, writeMarkdown } from "./helpers.js";

const examplesRoot = path.resolve(import.meta.dir, "..", "examples");

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

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
    // A linear book gets no choice.
    expect(result.choiceAdded).toBeNull();
    expect(result.choicesRetargeted).toEqual([]);
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
    for (const title of ["Two\nParts", "Two\rParts", "Two\u2028Parts", "Two\u2029Parts"]) {
      expect(() => splitChapter(root, { id: "chapter-02", at: "1", title })).toThrow("A chapter title must be a single line");
    }
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

  test("splits at a scene-break line with text right above and below it, as builds read one", () => {
    const root = book();
    setProse(root, "chapter-02", "Mara walked to the quay.\n*  *  *\nThe boat was late.\n    ---\nIt came.\n```\n---\n```\n");
    splitChapter(root, { id: "chapter-02", at: "1" });
    expect(prose(root, "chapter-02")).toBe("Mara walked to the quay.");
    expect(prose(root, "chapter-03")).toBe("The boat was late.\n    ---\nIt came.\n```\n---\n```");
    // A break line indented four columns, or in a code fence, is not one.
    expect(() => splitChapter(root, { id: "chapter-03", at: "1" })).toThrow("has no scene breaks");
    // Neither half has a break left, so the merge puts the usual one back.
    mergeChapters(root, { id: "chapter-02", next: "chapter-03" });
    expect(prose(root, "chapter-02")).toBe("Mara walked to the quay.\n\n* * *\n\nThe boat was late.\n    ---\nIt came.\n```\n---\n```");
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

  test("warns when the new last chapter takes an id an abandoned thread still names, and refuses any other reference to it (#578)", () => {
    const root = book();
    setProse(root, "chapter-04", "They landed.\n\nNight fell.\n");
    createEntity(root, { kind: "promise", name: "The Duel", planted: "chapter-05", status: "abandoned" });
    createEntity(root, { kind: "clue", name: "The Ring", planted: "chapter-05" });
    const before = snapshot(root);
    expect(() => splitChapter(root, { id: "chapter-04", at: "Night fell." })).toThrow("continuity/clues/the-ring.md names chapter-05, which has no file yet, and this split would give that id to its new chapter, the rest of chapter-04, so it would point at that chapter. Point it at the chapter it means first: chapter-04 if it belongs in the text that moves (then point it at chapter-05 after the split), or chapter-06 for the chapter after it; nothing was changed");
    expect(snapshot(root)).toEqual(before);
    const clue = path.join(root, "continuity", "clues", "the-ring.md");
    fs.writeFileSync(clue, read(root, "continuity", "clues", "the-ring.md").replace("planted: chapter-05", "planted: chapter-06"), "utf8");
    const result = splitChapter(root, { id: "chapter-04", at: "Night fell." });
    expect(data(root, "continuity", "clues", "the-ring.md").planted).toBe("chapter-06");
    expect(result.newId).toBe("chapter-05");
    expect(codes(result)).toEqual(["adopted-references"]);
    expect(result.warnings[0].message).toBe("chapter-05 was already named by abandoned threads, and those references now point at the new chapter: continuity/promises/the-duel.md. Clear them if the cut threads do not belong there");
  });

  test("refuses to renumber a chapter onto an id that references already name, so a later merge cannot carry them back (#578)", () => {
    const root = book();
    createEntity(root, { kind: "promise", name: "The Return", planted: "chapter-01", payoff: "chapter-05" });
    const before = snapshot(root);
    expect(() => splitChapter(root, { id: "chapter-02", at: "1" })).toThrow("continuity/promises/the-return.md names chapter-05, which has no file yet, and this split would renumber chapter-04 to chapter-05, so it would point at that chapter. Point it at the chapter it means first: chapter-04 if it belongs there (the split then carries it to chapter-05), or chapter-06 for the chapter after it; nothing was changed");
    const failed = invoke(root, ["split", "chapter-02", "--at", "1"]);
    expect(failed.code).toBe(4);
    expect(failed.err).toContain("names chapter-05, which has no file yet");
    expect(snapshot(root)).toEqual(before);

    // Pointed at the chapter after chapter-04, the payoff stays put through
    // the split and a merge that undoes it.
    const promise = path.join(root, "continuity", "promises", "the-return.md");
    fs.writeFileSync(promise, read(root, "continuity", "promises", "the-return.md").replace("payoff: chapter-05", "payoff: chapter-06"), "utf8");
    expect(codes(splitChapter(root, { id: "chapter-02", at: "1" }))).not.toContain("adopted-references");
    expect(data(root, "continuity", "promises", "the-return.md").payoff).toBe("chapter-06");
    mergeChapters(root, { id: "chapter-02", next: "chapter-03" });
    expect(data(root, "continuity", "promises", "the-return.md").payoff).toBe("chapter-06");

    // Pointed at chapter-04 itself, it follows that chapter there and back.
    fs.writeFileSync(promise, read(root, "continuity", "promises", "the-return.md").replace("payoff: chapter-06", "payoff: chapter-04"), "utf8");
    splitChapter(root, { id: "chapter-02", at: "1" });
    expect(data(root, "continuity", "promises", "the-return.md").payoff).toBe("chapter-05");
    expect(data(root, "chapters", "chapter-05.md").title).toBe("Four");
    mergeChapters(root, { id: "chapter-02", next: "chapter-03" });
    expect(data(root, "continuity", "promises", "the-return.md").payoff).toBe("chapter-04");
    expect(data(root, "chapters", "chapter-04.md").title).toBe("Four");
  });

  test("counts the renumbered chapter's own links and every file, but only the chapter id, and leaves the registries to reindex (#578)", () => {
    // A link in the chapter that moves, to the chapter after it, and a bare
    // id in the timeline: the plural message.
    const root = book();
    const fourth = path.join(root, "chapters", "chapter-04.md");
    fs.appendFileSync(fourth, "\nNext: [chapter five](chapter-05.md).\n");
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), "\n- chapter-05: the return, planned\n");
    expect(() => splitChapter(root, { id: "chapter-02", at: "1" })).toThrow("chapters/chapter-04.md, plot/timeline.md name chapter-05, which has no file yet, and this split would renumber chapter-04 to chapter-05, so they would point at that chapter. Point them at the chapter they mean first: chapter-04 if they belong there (the split then carries them to chapter-05), or chapter-06 for the chapter after it; nothing was changed");

    // A planned scene id under the number is no reference to the chapter:
    // the renumbering warns about it, naming the split.
    const scene = book();
    fs.appendFileSync(path.join(scene, "plot", "timeline.md"), "\n- chapter-05-scene-01: planned\n");
    const result = splitChapter(scene, { id: "chapter-02", at: "1" });
    expect(result.warnings.filter((warning) => warning.code === "adopted-references").map((warning) => warning.message)).toEqual([
      "chapter-05 was already referenced before this split, and those references now point at the moved chapter: plot/timeline.md. Check them"
    ]);

    // A registry still listing a chapter deleted by hand is rebuilt, not
    // refused.
    const stale = book();
    createEntity(stale, { kind: "chapter", name: "Five" });
    fs.rmSync(path.join(stale, "chapters", "chapter-05.md"));
    expect(read(stale, "chapters", "_index.md")).toContain("chapter-05.md");
    expect(splitChapter(stale, { id: "chapter-02", at: "1" }).newId).toBe("chapter-03");
    expect(data(stale, "chapters", "chapter-05.md").title).toBe("Four");
  });

  test("names split in the adopted-references warning of a scene it moves (#537)", () => {
    const root = book();
    setProse(root, "chapter-04", "They landed.\n\n* * *\n\nNight fell.\n");
    createEntity(root, { kind: "scene", name: "The Landing", chapter: "chapter-04" });
    createEntity(root, { kind: "scene", name: "The Night", chapter: "chapter-04" });
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), "\n- chapter-05-scene-01: the night, planned\n");
    const result = splitChapter(root, { id: "chapter-04", at: "1" });
    expect(result.warnings.filter((warning) => warning.code === "adopted-references").map((warning) => warning.message)).toEqual([
      "chapter-05-scene-01 was already referenced before this split, and those references now point at the moved scene: plot/timeline.md. Check them"
    ]);
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

  test("the CLI says what moved, and a split refused before its first write changes nothing", () => {
    const root = book();
    const io = memoryIo(root);
    expect(runCli(["split", "chapter-02", "--at", "1"], io)).toBe(0);
    expect(io.output()).toMatch(/^Split chapter chapter-02: the rest is chapter-03 "Two \(continued\)": .*chapter-03\.md \(moved 1 scene, renumbered 2 chapters\)\n$/);
    const merged = memoryIo(root);
    expect(runCli(["merge", "chapter-04", "chapter-05"], merged)).toBe(0);
    expect(merged.output()).toMatch(/^Merged chapter chapter-05 into chapter-04: .*chapter-04\.md\n$/);

    // A scene file whose frontmatter names another chapter would stay put
    // when its chapter is renumbered, so the scene the split moves would
    // find it part way: it is refused first.
    const stray = book();
    const crossing = path.join(stray, "scenes", "chapter-03-scene-01.md");
    fs.writeFileSync(crossing, read(stray, "scenes", "chapter-03-scene-01.md").replace("chapter: chapter-03", "chapter: chapter-09"), "utf8");
    const before = snapshot(stray);
    const failed = memoryIo(stray);
    expect(runCli(["split", "chapter-02", "--at", "1"], failed)).toBe(4);
    expect(failed.error()).toContain("scenes/chapter-03-scene-01.md is scene 1 of chapter-09 by its frontmatter but not by its file name");
    expect(snapshot(stray)).toEqual(before);
  });

  test("a step that fails after another wrote says a rerun puts the changes back and starts over", () => {
    const root = book();
    const file = path.join(root, "notes.md");
    const fail = (wrote) => () => {
      if (wrote) {
        writeFile(file, "partial\n", { root });
      }
      throw Object.assign(new Error("disk full"), { hint: "run it again" });
    };
    expect(() => restructureWrites(root, fail(false))).toThrow(expect.objectContaining({ hint: "run it again" }));
    expect(() => restructureWrites(root, fail(true))).toThrow(expect.objectContaining({ hint: expect.stringContaining("run the same command again, which puts them back and starts over, or run story doctor --fix to put them back") }));
  });

  test.skipIf(CHMOD_IGNORED)("refuses before writing when a file it would rewrite is read-only", () => {
    const root = book();
    const clue = path.join(root, "continuity", "clues", "the-ticket.md");
    fs.chmodSync(clue, 0o444);
    const before = snapshot(root);
    expect(() => splitChapter(root, { id: "chapter-02", at: "1" })).toThrow("Cannot write to continuity/clues/the-ticket.md (permission denied); nothing was changed");
    expect(() => mergeChapters(root, { id: "chapter-02", next: "chapter-03" })).toThrow("Cannot write to continuity/clues/the-ticket.md (permission denied); nothing was changed");
    expect(snapshot(root)).toEqual(before);
  });

  test("the new chapter only mentions a character who died in the split chapter, and keeps an unnumbered heading", () => {
    const root = book();
    const mara = path.join(root, "characters", "mara-quill.md");
    fs.writeFileSync(mara, read(root, "characters", "mara-quill.md").replace(/\nstatus: \w+/, "\nstatus: deceased\ndied-in: chapter-02"), "utf8");
    const chapterTwo = path.join(root, "chapters", "chapter-02.md");
    fs.writeFileSync(chapterTwo, read(root, "chapters", "chapter-02.md").replace('time: ""', 'time: "09:00"\nnumbered: false'), "utf8");
    const result = splitChapter(root, { id: "chapter-02", at: "The Ferry", title: "Interlude" });
    const second = data(root, "chapters", "chapter-03.md");
    expect(second.characters).toEqual([]);
    expect(second.mentions).toEqual(["mara-quill"]);
    expect(second).toMatchObject({ numbered: false, time: "09:00" });
    expect(read(root, "chapters", "chapter-03.md")).toContain("\n# Interlude\n\n## Chapter Text\n");
    expect(result.warnings.find((warning) => warning.code === "split-references").message).toContain("characters/mara-quill.md");
  });

  test("refuses a chapter file in the way of the renumbering", () => {
    const root = book();
    const file = path.join(root, "chapters", "chapter-04.md");
    fs.writeFileSync(file, read(root, "chapters", "chapter-04.md").replace(/^number: 4$/m, "number: 9"), "utf8");
    expect(() => splitChapter(root, { id: "chapter-02", at: "1" })).toThrow("chapters/chapter-04.md already exists and is not a chapter this command renumbers");
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
    expect(() => splitChapter(taken, { id: "chapter-02", at: "1" })).toThrow("chapters/chapter-03.md already exists and is not a chapter this command renumbers");
  });

  test("works without a trailing newline or continuity/state.md", () => {
    const root = book();
    setProse(root, "chapter-02", "Mara walked.\n\n* * *\n\nThe end.");
    fs.rmSync(path.join(root, "continuity", "state.md"));
    splitChapter(root, { id: "chapter-02", at: "1" });
    expect(prose(root, "chapter-03")).toBe("The end.");
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

  test("never takes numbered from the second chapter, and warns when the two differ (#578)", () => {
    const root = book();
    setFields(root, path.join("chapters", "chapter-03.md"), "numbered: false\n");
    const result = mergeChapters(root, { id: "chapter-02", next: "chapter-03" });
    expect(data(root, "chapters", "chapter-02.md").numbered).toBeUndefined();
    expect(result.warnings.map((warning) => warning.message)).toContain("chapter-03 is unnumbered (numbered: false) but chapter-02 is not: the merged chapter-02 stays numbered. Set numbered: false on it if it should not be");

    const prologue = book();
    setFields(prologue, path.join("chapters", "chapter-02.md"), "numbered: false\n");
    const kept = mergeChapters(prologue, { id: "chapter-02", next: "chapter-03" });
    expect(data(prologue, "chapters", "chapter-02.md").numbered).toBe(false);
    expect(kept.warnings.map((warning) => warning.message)).toContain("chapter-02 is unnumbered (numbered: false) but chapter-03 is not: the merged chapter-02 stays unnumbered. Remove numbered: false from it if it should be numbered");

    const both = book();
    setFields(both, path.join("chapters", "chapter-02.md"), "numbered: true\n");
    expect(mergeChapters(both, { id: "chapter-02", next: "chapter-03" }).warnings.map((warning) => warning.message).join("\n")).not.toContain("numbered");
  });

  test("keeps the second chapter's text above its heading and comments after its notes (#578)", () => {
    const root = book();
    const third = path.join(root, "chapters", "chapter-03.md");
    fs.writeFileSync(third, read(root, "chapters", "chapter-03.md")
      .replace("\n# Chapter 3: Three\n", "\n<!-- KEEP-ME -->\nA note above the heading.\n# Chapter 3: Three\n")
      .replace("3. Turn or decision\n", "3. Turn or decision\n\n<!-- after the beats -->\n")
      .replace("---\n\n## Chapter Text", "---\n\n<!-- after the divider -->\n\n## Chapter Text"), "utf8");
    mergeChapters(root, { id: "chapter-02", next: "chapter-03" });
    const text = read(root, "chapters", "chapter-02.md");
    expect(text).toContain("# Chapter 2: Two\n\n<!-- KEEP-ME -->\nA note above the heading.\n\n## Outline\n\n1. Opening beat\n2. Escalation\n3. Turn or decision\n1. Opening beat\n2. Escalation\n3. Turn or decision\n\n<!-- after the beats -->\n\n<!-- after the divider -->\n\n---\n\n## Chapter Text\n\nMara walked");
    expect(text).not.toContain("# Chapter 3");
    expect(prose(root, "chapter-02")).toBe(`${CHAPTER_TWO.trim()}\n\n* * *\n\nThe ferry crossed.`);
  });

  test("keeps a comment on the last beat of either chapter on its line, and never puts beats inside one (#578)", () => {
    const root = book();
    const second = path.join(root, "chapters", "chapter-02.md");
    const third = path.join(root, "chapters", "chapter-03.md");
    fs.writeFileSync(second, read(root, "chapters", "chapter-02.md").replace("3. Turn or decision\n", "3. Turn or decision <!-- two -->\n"), "utf8");
    fs.writeFileSync(third, read(root, "chapters", "chapter-03.md").replace("3. Turn or decision\n", "3. Turn or decision <!-- three -->\n"), "utf8");
    mergeChapters(root, { id: "chapter-02", next: "chapter-03" });
    expect(read(root, "chapters", "chapter-02.md")).toContain("## Outline\n\n1. Opening beat\n2. Escalation\n3. Turn or decision <!-- two -->\n1. Opening beat\n2. Escalation\n3. Turn or decision <!-- three -->\n\n---\n\n## Chapter Text\n");

    const open = book();
    const kept = path.join(open, "chapters", "chapter-02.md");
    fs.writeFileSync(kept, read(open, "chapters", "chapter-02.md").replace("3. Turn or decision\n", "3. Turn or decision <!-- TODO:\nrework this\n-->\n"), "utf8");
    mergeChapters(open, { id: "chapter-02", next: "chapter-03" });
    expect(read(open, "chapters", "chapter-02.md")).toContain("3. Turn or decision <!-- TODO:\nrework this\n-->\n\n1. Opening beat\n2. Escalation\n3. Turn or decision\n\n---\n\n## Chapter Text\n");
  });

  test("takes only the second chapter's own heading for its heading (#578)", () => {
    // No chapter heading, and a level-1 heading inside the outline.
    const root = book();
    const third = path.join(root, "chapters", "chapter-03.md");
    fs.writeFileSync(third, read(root, "chapters", "chapter-03.md").replace("# Chapter 3: Three\n\n", "").replace("3. Turn or decision\n", "3. Turn or decision\n\n# Ideas\n\n- a ferry strike\n"), "utf8");
    mergeChapters(root, { id: "chapter-02", next: "chapter-03" });
    expect(read(root, "chapters", "chapter-02.md")).toContain("3. Turn or decision\n\n# Ideas\n\n- a ferry strike\n\n---\n\n## Chapter Text\n");

    // No `## Chapter Text` or outline, and text above the heading: the
    // heading still goes, and the text joins the notes.
    const bare = createStoryProject({ cwd: makeTempDir(), title: "Bare Merge" }).root;
    writeMarkdown(path.join(bare, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "\n# Chapter 1: One\n\nFirst words.\n");
    writeMarkdown(path.join(bare, "chapters", "chapter-02.md"), "title: Two\nnumber: 2\nstatus: draft", "\nA note above the heading.\n# Chapter 2: Two\n\nSecond words.\n");
    mergeChapters(bare, { id: "chapter-01", next: "chapter-02" });
    const text = read(bare, "chapters", "chapter-01.md");
    expect(text).toContain("# Chapter 1: One\n\nA note above the heading.\n\n## Chapter Text\n\nFirst words.\n\n* * *\n\nSecond words.\n");
    expect(text).not.toContain("Chapter 2");
    expect(prose(bare, "chapter-01")).toBe("First words.\n\n* * *\n\nSecond words.");
  });

  test("names merge in the adopted-references warning of a scene it moves (#537)", () => {
    const root = book();
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), "\n- chapter-02-scene-03: a third scene, planned\n");
    const result = mergeChapters(root, { id: "chapter-02", next: "chapter-03" });
    expect(result.warnings.filter((warning) => warning.code === "adopted-references").map((warning) => warning.message)).toEqual([
      "chapter-02-scene-03 was already referenced before this merge, and those references now point at the moved scene: plot/timeline.md. Check them"
    ]);
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

  test("keeps the merged-away chapter when it is saved meanwhile, puts the merged one back, and a rerun merges the save (#547)", () => {
    const root = createStoryProject({ cwd: makeTempDir(), title: "Saved Merge" }).root;
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "\n# Chapter 1: One\n\n## Chapter Text\n\nFirst words.\n");
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Two\nnumber: 2\nstatus: draft", "\n# Chapter 2: Two\n\n## Chapter Text\n\nSecond words.\n");
    writeMarkdown(path.join(root, "chapters", "chapter-03.md"), "title: Three\nnumber: 3\nstatus: draft", "\n# Chapter 3: Three\n\n## Chapter Text\n\nThird words.\n");
    const first = path.join(root, "chapters", "chapter-01.md");
    const second = path.join(root, "chapters", "chapter-02.md");
    const before = read(root, "chapters", "chapter-01.md");
    const saved = read(root, "chapters", "chapter-02.md").replace("Second words.", "Second words, saved.");
    const spy = whileWriting(first, () => fs.writeFileSync(second, saved));
    let result;
    try {
      result = invoke(root, ["merge", "chapter-01", "chapter-02"]);
    } finally {
      spy.mockRestore();
    }
    expect(result.code).toBe(4);
    expect(result.err).toBe("chapters/chapter-02.md changed on disk while story was merging it into chapter-01, so it was left as it is and chapters/chapter-01.md was put back. Run the same command again to merge it with the change\n");
    expect(fs.readFileSync(second, "utf8")).toBe(saved);
    expect(fs.readFileSync(first, "utf8")).toBe(before);
    expect(invoke(root, ["merge", "chapter-01", "chapter-02"]).code).toBe(0);
    expect(prose(root, "chapter-01")).toBe("First words.\n\n* * *\n\nSecond words, saved.");
    expect(fs.readdirSync(path.join(root, "chapters")).sort()).toEqual(["_index.md", "chapter-01.md", "chapter-02.md"]);
    expect(prose(root, "chapter-02")).toBe("Third words.");
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

// Gives each chapter `choices`, as [text, to] pairs.
function setChoices(root, choices) {
  for (const [id, entries] of Object.entries(choices)) {
    setFields(root, path.join("chapters", `${id}.md`), `choices:\n${entries.map(([text, to]) => `  - text: ${text}\n    to: ${to}\n`).join("")}`);
  }
}

function unreachable(root) {
  return validateLinks(root).warnings.filter((warning) => warning.code === "unreachable-chapter").map((warning) => warning.file);
}

describe("split and merge in a branching book", () => {
  // book() made branching: chapter 1 leads to chapter 2 or chapter 3, and
  // chapter 3 on to chapter 4, so chapters 2 and 4 are endings.
  function branching() {
    const root = book();
    setChoices(root, {
      "chapter-01": [["Take the ferry", "chapter-02"], ["Walk the coast", "chapter-03"]],
      "chapter-03": [["Go ashore", "chapter-04"]]
    });
    return root;
  }

  test("splits an ending, leading its first half on to the rest, and points every choice at the renumbered chapters (#535)", () => {
    const root = branching();
    expect(errors(root)).toEqual([]);
    expect(unreachable(root)).toEqual([]);

    const result = splitChapter(root, { id: "chapter-02", at: "1" });

    expect(result.choiceAdded).toEqual({ file: "chapters/chapter-02.md", index: 0, text: "Continue", to: "chapter-03" });
    expect(result.choicesRetargeted).toEqual([
      { file: "chapters/chapter-01.md", index: 1, text: "Walk the coast", from: "chapter-03", to: "chapter-04" },
      { file: "chapters/chapter-04.md", index: 0, text: "Go ashore", from: "chapter-04", to: "chapter-05" }
    ]);
    expect(data(root, "chapters", "chapter-01.md").choices).toEqual([{ text: "Take the ferry", to: "chapter-02" }, { text: "Walk the coast", to: "chapter-04" }]);
    expect(data(root, "chapters", "chapter-02.md").choices).toEqual([{ text: "Continue", to: "chapter-03" }]);
    expect(data(root, "chapters", "chapter-03.md").choices).toBeUndefined();
    expect(data(root, "chapters", "chapter-04.md").choices).toEqual([{ text: "Go ashore", to: "chapter-05" }]);
    expect(data(root, "chapters", "chapter-05.md").choices).toBeUndefined();
    // The choice into chapter 2 still leads to its start, so the split does
    // not list it as a reference to check.
    const references = result.warnings.find((warning) => warning.code === "split-references");
    expect(references.message).toStartWith("continuity/clues/the-ticket.md still names chapter-02");
    expect(errors(root)).toEqual([]);
    expect(unreachable(root)).toEqual([]);
  });

  test("lists a draft choice the renumbering rewrites, and adds no choice to a book whose only choices are drafts (#535)", () => {
    const root = book();
    setFields(root, path.join("chapters", "chapter-01.md"), "choices:\n  - to: chapter-03\n");
    const result = splitChapter(root, { id: "chapter-02", at: "1" });
    expect(result.choiceAdded).toBeNull();
    expect(result.choicesRetargeted).toEqual([{ file: "chapters/chapter-01.md", index: 0, text: null, from: "chapter-03", to: "chapter-04" }]);
    expect(data(root, "chapters", "chapter-01.md").choices).toEqual([{ to: "chapter-04" }]);
    expect(data(root, "chapters", "chapter-02.md").choices).toBeUndefined();
  });

  test("an empty choices list is no choices, and the split fills it", () => {
    const root = branching();
    setFields(root, path.join("chapters", "chapter-02.md"), "choices: []\n");
    splitChapter(root, { id: "chapter-02", at: "1" });
    expect(data(root, "chapters", "chapter-02.md").choices).toEqual([{ text: "Continue", to: "chapter-03" }]);
    expect(read(root, "chapters", "chapter-02.md").match(/^choices:/gm)).toHaveLength(1);
  });

  test("merges a chapter no choice leads to into the ending before it, and points every choice at the renumbered chapters (#535)", () => {
    const root = book();
    createEntity(root, { kind: "chapter", name: "Five", status: "draft", characters: ["mara-quill"] });
    setProse(root, "chapter-05", "They sailed home.\n");
    setChoices(root, {
      "chapter-01": [["Take the ferry", "chapter-02"], ["Walk the coast", "chapter-04"]],
      "chapter-04": [["Sail home", "chapter-05"]]
    });
    expect(unreachable(root)).toEqual(["chapters/chapter-03.md"]);

    const result = mergeChapters(root, { id: "chapter-02", next: "chapter-03" });

    expect(result.choicesRetargeted).toEqual([
      { file: "chapters/chapter-01.md", index: 1, text: "Walk the coast", from: "chapter-04", to: "chapter-03" },
      { file: "chapters/chapter-03.md", index: 0, text: "Sail home", from: "chapter-05", to: "chapter-04" }
    ]);
    expect(data(root, "chapters", "chapter-01.md").choices).toEqual([{ text: "Take the ferry", to: "chapter-02" }, { text: "Walk the coast", to: "chapter-03" }]);
    expect(data(root, "chapters", "chapter-02.md").choices).toBeUndefined();
    expect(data(root, "chapters", "chapter-03.md").choices).toEqual([{ text: "Sail home", to: "chapter-04" }]);
    expect(prose(root, "chapter-03")).toBe("They landed.");
    expect(errors(root)).toEqual([]);
    expect(unreachable(root)).toEqual([]);
  });

  test("refuses to split or merge a chapter with choices, naming them, and changes nothing (#535)", () => {
    const root = branching();
    const before = snapshot(root);
    expect(() => splitChapter(root, { id: "chapter-01", at: "Mara" })).toThrow("story split works on a branching book only when the chapter it splits has no choices, since a chapter's choices end it and a split would change the passage they end: chapters/chapter-01.md choices[0] (to chapter-02), chapters/chapter-01.md choices[1] (to chapter-03). Restructure the book by hand with story add chapter, story move, and story remove");
    expect(() => mergeChapters(root, { id: "chapter-02", next: "chapter-03" })).toThrow("story merge works on a branching book only when the chapters it merges have no choices, since a chapter's choices end it and a merge would change the passage they end: chapters/chapter-03.md choices[0] (to chapter-04). Restructure");
    expect(snapshot(root)).toEqual(before);
  });

  test("a malformed choices field counts as choices, and a control character in it is not printed (#535)", () => {
    const chapter = path.join("chapters", "chapter-04.md");
    for (const field of ["choices:\n", "choices: \"\"\n", "choices: Go home\n", "choices: null\n"]) {
      const root = branching();
      setFields(root, chapter, field);
      const before = snapshot(root);
      expect(() => splitChapter(root, { id: "chapter-04", at: "They" })).toThrow("would change the passage they end: chapters/chapter-04.md choices[0]. Restructure");
      expect(snapshot(root)).toEqual(before);
    }
    const root = branching();
    setFields(root, chapter, "choices:\n  - to: \"chapter-01\\u001b[2J\"\n");
    const before = snapshot(root);
    const failed = invoke(root, ["merge", "chapter-03", "chapter-04", "--dry-run"]);
    expect(failed.code).toBe(4);
    expect(failed.out).toBe("");
    expect(failed.err).toContain("chapters/chapter-03.md choices[0] (to chapter-04), chapters/chapter-04.md choices[0] (to chapter-01\ufffd[2J). Restructure");
    expect(snapshot(root)).toEqual(before);
  });

  test("lists at most ten choices in a refusal", () => {
    const root = branching();
    setFields(root, path.join("chapters", "chapter-02.md"), `choices:\n${Array.from({ length: 12 }, () => "  - text: Go on\n    to: chapter-03\n").join("")}`);
    expect(() => splitChapter(root, { id: "chapter-02", at: "1" })).toThrow("chapters/chapter-02.md choices[9] (to chapter-03), and 2 more. Restructure");
  });

  test("refuses a merge that folds away a chapter a draft choice with no text leads to (#535)", () => {
    const root = book();
    setChoices(root, { "chapter-01": [["Take the ferry", "chapter-02"], ["Walk the coast", "chapter-04"]] });
    setFields(root, path.join("chapters", "chapter-04.md"), "choices:\n  - to: chapter-03\n");
    const before = snapshot(root);
    expect(() => mergeChapters(root, { id: "chapter-02", next: "chapter-03" })).toThrow("story merge works on a branching book only when no choice leads to the chapter it folds into the one before, since a reader who took it would land at the start of chapter-02 instead: chapters/chapter-04.md choices[0] leads to chapter-03. Point it at another chapter first, or restructure the book by hand with story add chapter, story move, and story remove");
    expect(snapshot(root)).toEqual(before);
  });

  test("refuses a merge that folds away a chapter a choice leads to, naming the choices (#535)", () => {
    const root = book();
    setChoices(root, {
      "chapter-01": [["Take the ferry", "chapter-02"], ["Walk the coast", "chapter-03"]],
      "chapter-04": [["Go back", "chapter-03"]]
    });
    const before = snapshot(root);
    expect(() => mergeChapters(root, { id: "chapter-02", next: "chapter-03" })).toThrow("story merge works on a branching book only when no choice leads to the chapter it folds into the one before, since a reader who took it would land at the start of chapter-02 instead: chapters/chapter-01.md choices[1], chapters/chapter-04.md choices[0] lead to chapter-03. Point them at another chapter first, or restructure the book by hand with story add chapter, story move, and story remove");
    expect(snapshot(root)).toEqual(before);
  });

  test("refuses a split that would give a chapter the id a choice is scheduled for, naming the choice (#535)", () => {
    const root = book();
    setChoices(root, {
      "chapter-01": [["Take the ferry", "chapter-02"], ["Walk the coast", "chapter-03"]],
      "chapter-03": [["Go ashore", "chapter-04"], ["Swim out", "chapter-05"]]
    });
    setProse(root, "chapter-04", "They landed.\n\nThe gulls rose.\n");
    expect(errors(root)).toEqual([]);
    const before = snapshot(root);
    expect(() => splitChapter(root, { id: "chapter-02", at: "1" })).toThrow("chapters/chapter-03.md choices[1] names chapter-05, which has no file yet, and this split would renumber chapter-04 to chapter-05, so it would point at that chapter. Point it at the chapter it means first: chapter-04 if it belongs there (the split then carries it to chapter-05), or chapter-06 for the chapter after it; nothing was changed");
    expect(() => splitChapter(root, { id: "chapter-04", at: "The gulls" })).toThrow("chapters/chapter-03.md choices[1] names chapter-05, which has no file yet, and this split would give that id to its new chapter, the rest of chapter-04");
    expect(snapshot(root)).toEqual(before);

    // A link in the same chapter's text names it too, and the message says
    // so, so pointing the choice elsewhere is not the whole fix.
    setProse(root, "chapter-03", "The ferry crossed. [Later](chapter-05.md)\n");
    expect(() => splitChapter(root, { id: "chapter-04", at: "The gulls" })).toThrow("chapters/chapter-03.md choices[1], other references in chapters/chapter-03.md name chapter-05, which has no file yet");
  });

  test("names the choices that block a split in time linear in the size of the book (#535)", () => {
    // Chapters 1 to 59 each have 50 choices scheduled for chapter-61, the
    // id a split of chapter 60 would give its new chapter.
    const root = createStoryProject({ cwd: makeTempDir(), title: "Wide Book" }).root;
    const choices = `choices:\n${Array.from({ length: 50 }, () => "  - text: Go on\n    to: chapter-61").join("\n")}`;
    for (let number = 1; number <= 60; number += 1) {
      const id = `chapter-${String(number).padStart(2, "0")}`;
      writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Part ${number}\nnumber: ${number}\nstatus: draft${number < 60 ? `\n${choices}` : ""}`, `\n# Chapter ${number}: Part ${number}\n\n## Chapter Text\n\nFirst.\n\nSecond.\n`);
    }
    const started = performance.now();
    expect(() => splitChapter(root, { id: "chapter-60", at: "Second." })).toThrow("chapters/chapter-01.md choices[0], chapters/chapter-01.md choices[1], chapters/chapter-01.md choices[2], chapters/chapter-01.md choices[3], chapters/chapter-01.md choices[4], chapters/chapter-01.md choices[5], chapters/chapter-01.md choices[6], chapters/chapter-01.md choices[7], chapters/chapter-01.md choices[8], chapters/chapter-01.md choices[9], and 2940 more name chapter-61");
    // A backstop for a run that never ends. It leaves room for a loaded CI
    // runner: locally this takes a few milliseconds.
    expect(performance.now() - started).toBeLessThan(10000);
  });

  test("the output lists the choices a split or merge adds or points elsewhere, and so does --dry-run (#535)", () => {
    const root = branching();
    const before = snapshot(root);
    const preview = invoke(root, ["split", "chapter-02", "--at", "1", "--dry-run"]);
    expect(preview.code).toBe(0);
    expect(preview.out).toStartWith("Would give chapters/chapter-02.md a choice to chapter-03, the rest of chapter-02: Continue\nWould point chapters/chapter-01.md choices[1] at chapter-04, not chapter-03\nWould point chapters/chapter-04.md choices[0] at chapter-05, not chapter-04\nupdate  ");
    expect(preview.out).toContain("update  chapters/chapter-01.md\n");
    const json = JSON.parse(invoke(root, ["split", "chapter-02", "--at", "1", "--dry-run", "--json"]).out);
    expect(json.data.choiceAdded).toEqual({ file: "chapters/chapter-02.md", index: 0, text: "Continue", to: "chapter-03" });
    expect(json.data.choicesRetargeted.map((choice) => `${choice.file} ${choice.from} ${choice.to}`)).toEqual(["chapters/chapter-01.md chapter-03 chapter-04", "chapters/chapter-04.md chapter-04 chapter-05"]);
    expect(snapshot(root)).toEqual(before);

    const split = invoke(root, ["split", "chapter-02", "--at", "1"]);
    expect(split.code).toBe(0);
    expect(split.out).toEndWith(" (moved 1 scene, renumbered 2 chapters)\nGave chapters/chapter-02.md a choice to chapter-03, the rest of chapter-02: Continue\nPointed chapters/chapter-01.md choices[1] at chapter-04, not chapter-03\nPointed chapters/chapter-04.md choices[0] at chapter-05, not chapter-04\n");

    // The first half's new choice is all that keeps the merge back.
    fs.writeFileSync(path.join(root, "chapters", "chapter-02.md"), read(root, "chapters", "chapter-02.md").replace(/choices:\n  - text: Continue\n    to: chapter-03\n/, ""), "utf8");
    const mergeJson = JSON.parse(invoke(root, ["merge", "chapter-02", "chapter-03", "--dry-run", "--json"]).out);
    expect(mergeJson.data.choiceAdded).toBeUndefined();
    expect(mergeJson.data.choicesRetargeted).toEqual([
      { file: "chapters/chapter-01.md", index: 1, text: "Walk the coast", from: "chapter-04", to: "chapter-03" },
      { file: "chapters/chapter-03.md", index: 0, text: "Go ashore", from: "chapter-05", to: "chapter-04" }
    ]);
    const mergePreview = invoke(root, ["merge", "chapter-02", "chapter-03", "--dry-run"]);
    expect(mergePreview.out).toStartWith("Would point chapters/chapter-01.md choices[1] at chapter-03, not chapter-04\nWould point chapters/chapter-03.md choices[0] at chapter-04, not chapter-05\nupdate  ");
    const merge = invoke(root, ["merge", "chapter-02", "chapter-03"]);
    expect(merge.code).toBe(0);
    expect(merge.out).toEndWith(" (moved 1 scene, renumbered 2 chapters)\nPointed chapters/chapter-01.md choices[1] at chapter-03, not chapter-04\nPointed chapters/chapter-03.md choices[0] at chapter-04, not chapter-05\n");
    expect(data(root, "chapters", "chapter-03.md").choices).toEqual([{ text: "Go ashore", to: "chapter-04" }]);
  });
});

describe("split and merge on the examples", () => {
  test("the-gull-rock-light: splitting an ending prints what docs/cli-reference.md shows and leaves no errors (#535)", () => {
    const root = path.join(makeTempDir(), "the-gull-rock-light");
    fs.cpSync(path.join(examplesRoot, "the-gull-rock-light"), root, { recursive: true });
    const argv = ["split", "chapter-05", "--at", "At dawn", "--title", "Dawn"];
    const reference = fs.readFileSync(path.resolve(import.meta.dir, "..", "docs", "cli-reference.md"), "utf8");
    const shown = reference.slice(reference.indexOf(`$ story ${argv.slice(0, 3).join(" ")} "At dawn" --title "Dawn" --dry-run\n`)).split("\n```")[0].split("\n").slice(1);
    const preview = invoke(root, [...argv, "--dry-run"]);
    expect(preview.code).toBe(0);
    expect(`${preview.out}${preview.err}`.trimEnd().split("\n")).toEqual(shown);

    const split = invoke(root, argv);
    expect(split.code).toBe(0);
    expect(split.out).toEndWith("(renumbered 1 chapter)\nGave chapters/chapter-05.md a choice to chapter-06, the rest of chapter-05: Continue\nPointed chapters/chapter-04.md choices[1] at chapter-07, not chapter-06\n");
    expect(data(root, "chapters", "chapter-04.md").choices.map((choice) => choice.to)).toEqual(["chapter-05", "chapter-07"]);
    expect(data(root, "chapters", "chapter-05.md").choices).toEqual([{ text: "Continue", to: "chapter-06" }]);
    expect(errors(root)).toEqual([]);
    expect(unreachable(root)).toEqual([]);
  });

  const names = fs.readdirSync(examplesRoot).filter((name) => fs.existsSync(path.join(examplesRoot, name, "chapters", "chapter-02.md")));

  for (const name of names) {
    test(`${name}: merging chapters 1 and 2 and splitting them again keeps the prose and adds no errors`, () => {
      const root = path.join(makeTempDir(), name);
      fs.cpSync(path.join(examplesRoot, name), root, { recursive: true });
      const baseline = errors(root).length;
      const firstProse = prose(root, "chapter-01");
      const secondProse = prose(root, "chapter-02");
      if (fs.readdirSync(path.join(root, "chapters")).some((file) => /^choices:/m.test(read(root, "chapters", file)))) {
        expect(() => mergeChapters(root, { id: "chapter-01", next: "chapter-02" })).toThrow("works on a branching book only when the chapters it merges have no choices");
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

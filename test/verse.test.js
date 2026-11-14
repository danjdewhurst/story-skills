import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { isVerseChapter, STORY_FORMS } from "../src/forms.js";
import { verseLineCount } from "../src/markdown.js";
import { wordParagraphs } from "../src/packaging.js";
import {
  buildBook,
  checkProjectContinuity,
  computeWordCounts,
  createStoryProject,
  pacingReport,
  projectProgress,
  validateProject
} from "../src/story.js";
import { formatPacing } from "../src/pacing.js";
import { formatProgress } from "../src/progress.js";
import { makeTempDir, memoryIo, messages, readArchiveText, writeMarkdown } from "./helpers.js";

const POEM = "The water goes out\nlike a held breath,\\\nand the mud *shines*.\n\nGulls write their names\non the wet sand\nand the sea erases them.";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// A project of `form` (none when null) with each of `chapters` as
// { fields, body }, numbered from 1.
function project(form, chapters) {
  const { root } = createStoryProject({ cwd: makeTempDir(), title: "Salt Hours", force: false, ...(form === null ? {} : { form }) });
  chapters.forEach(({ fields = "", body }, index) => {
    const number = index + 1;
    writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Poem ${number}\nnumber: ${number}\nstatus: draft\n${fields}`, `\n## Chapter Text\n\n${body}\n`);
  });
  return root;
}

function file(root, options) {
  return fs.readFileSync(buildBook(root, options).outFile, "utf8");
}

describe("poetry collections and verse chapters", () => {
  test("init --form poetry-collection records the form with no word target and a poetry genre", () => {
    const cwd = makeTempDir();
    expect(STORY_FORMS.get("poetry-collection")).toEqual({ min: null, max: null, target: null });
    const { root } = createStoryProject({ cwd, title: "Tide Tables", form: "poetry-collection" });
    const raw = fs.readFileSync(path.join(root, "story.md"), "utf8");
    expect(raw).toContain("form: poetry-collection\n");
    expect(raw).toContain("genre: poetry\n");
    expect(raw).not.toContain("target-words");
    expect(validateProject(root)).toMatchObject({ ok: true, warnings: [] });

    const given = createStoryProject({ cwd, title: "Sea Songs", form: "poetry-collection", genre: "folk" });
    expect(fs.readFileSync(path.join(given.root, "story.md"), "utf8")).toContain("genre: folk\n");
    const novel = createStoryProject({ cwd, title: "Long One", form: "novel" });
    expect(fs.readFileSync(path.join(novel.root, "story.md"), "utf8")).toContain("genre: fiction\n");
  });

  test("a chapter is verse in a poetry collection or with verse: true, and verse: false turns it off", () => {
    const collection = { form: "poetry-collection" };
    expect(isVerseChapter(collection, {})).toBe(true);
    expect(isVerseChapter(collection, { verse: false })).toBe(false);
    expect(isVerseChapter({ form: "novel" }, {})).toBe(false);
    expect(isVerseChapter({ form: "novel" }, { verse: true })).toBe(true);
    expect(isVerseChapter({}, { verse: true })).toBe(true);
    // A value that is not a boolean is a validate error and reads as unset.
    expect(isVerseChapter(collection, { verse: "no" })).toBe(true);
    expect(isVerseChapter({}, { verse: "yes" })).toBe(false);
  });

  test("validate reports a verse field that is not true or false", () => {
    const root = project(null, [{ fields: "verse: yes please", body: "Words." }]);
    expect(messages(validateProject(root).errors)).toContain("chapters/chapter-01.md verse must be true or false");
  });

  test("every line break in a verse chapter is kept in the builds, and a blank line is a stanza break", () => {
    const root = project("poetry-collection", [{ body: POEM }, { fields: "verse: false", body: "This prose\njoins up." }]);
    const html = file(root, { format: "html" });
    expect(html).toContain("The water goes out<br>like a held breath,<br>and the mud <em>shines</em>.");
    expect(html).toContain("Gulls write their names<br>on the wet sand<br>and the sea erases them.");
    expect(html).toContain("This prose joins up.");
    expect(html).not.toContain("breath,\\");
    expect(file(root, { format: "print" })).toContain("The water goes out<br>like a held breath,<br>and the mud <em>shines</em>.");

    const epub = readArchiveText(buildBook(root, { format: "epub" }).outFile);
    expect(epub).toContain("The water goes out<br/>like a held breath,<br/>and the mud <em>shines</em>.");
    expect(epub).toContain("This prose joins up.");

    const docx = readArchiveText(buildBook(root, { format: "docx" }).outFile);
    expect(docx).toContain('goes out</w:t><w:br/><w:t xml:space="preserve">like a held breath,</w:t><w:br/>');
    expect(docx).toContain("This prose joins up.");
    expect(readArchiveText(buildBook(root, { format: "docx", shunn: true }).outFile)).toContain("<w:br/>");

    const shunn = file(root, { format: "shunn" });
    expect(shunn).toContain("The water goes out\\\nlike a held breath,\\\nand the mud *shines*.\n\nGulls write their names\\\non the wet sand\\\nand the sea erases them.");
    expect(shunn).toContain("This prose joins up.");
    // The markdown build copies the chapter text as written.
    expect(file(root, { format: "markdown" })).toContain(POEM);
  });

  test("verse: true keeps a poem's lines inside any other form, and code keeps its own lines", () => {
    const root = project("novel", [{ body: "A plain\nparagraph." }, { fields: "verse: true", body: "Sing low,\nsing slow." }]);
    const html = file(root, { format: "html" });
    expect(html).toContain("A plain paragraph.");
    expect(html).toContain("Sing low,<br>sing slow.");
    const fenced = wordParagraphs("```\nline one\nline two\n```", true);
    expect(fenced.map((paragraph) => paragraph.runs.map((run) => run.text).join(""))).toEqual(wordParagraphs("```\nline one\nline two\n```").map((paragraph) => paragraph.runs.map((run) => run.text).join("")));
  });

  test("verseLineCount counts lines of text, not blank lines, scene breaks, headings, or fences", () => {
    expect(verseLineCount(POEM)).toBe(6);
    expect(verseLineCount("# Title\n\none\ntwo\n\n* * *\n\nthree\n```\nfour\n```\n   \n")).toBe(4);
    expect(verseLineCount("")).toBe(0);
    expect(verseLineCount("one\r\ntwo\r\n")).toBe(2);
  });

  test("wordcount and progress count the lines of verse chapters, and --write records words only", () => {
    const root = project("poetry-collection", [{ body: POEM }, { fields: "verse: false", body: "Prose here." }]);
    const counts = computeWordCounts(root);
    expect(counts.chapters.map((chapter) => chapter.lineCount)).toEqual([6, undefined]);
    expect(counts.lines).toBe(6);
    expect(computeWordCounts(project(null, [{ body: "Prose." }])).lines).toBeUndefined();

    const cli = invoke(root, ["wordcount", root]);
    expect(cli.code).toBe(0);
    expect(cli.out).toContain("chapters/chapter-01.md: 25 (6 lines)\nchapters/chapter-02.md: 2\nTotal: 27\nLines: 6\n");

    expect(invoke(root, ["wordcount", root, "--write"]).code).toBe(0);
    const written = fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8");
    expect(written).toContain("word-count: 25");
    expect(written).not.toContain("line");

    const progress = projectProgress(root, { date: "2026-01-05" });
    expect(progress).toMatchObject({ words: 27, lines: 6, verseChapters: 1 });
    expect(formatProgress(progress)).toContain("Progress: 27 words (no target-words in story.md)\nLines: 6 in 1 verse chapter\n");
    const prose = projectProgress(project(null, [{ body: "Prose." }]), { date: "2026-01-05" });
    expect(prose).toMatchObject({ lines: null, verseChapters: 0 });
    expect(formatProgress(prose)).not.toContain("Lines:");
  });

  test("pacing leaves verse chapters out of its hook, scene, and length findings", () => {
    const long = "word ".repeat(400);
    const short = "word ".repeat(10);
    const root = project("poetry-collection", [
      { body: long },
      { body: short },
      { body: "word ".repeat(100) },
      { fields: "verse: false", body: "word ".repeat(100) }
    ]);
    for (const number of [1, 2, 3]) {
      for (const scene of [1, 2, 3]) {
        writeMarkdown(path.join(root, "scenes", `chapter-0${number}-scene-0${scene}.md`), `title: S${number}${scene}\nchapter: chapter-0${number}\nscene: ${scene}\nstatus: draft\noutcome: yes`, "# Scene\n");
      }
    }
    const report = pacingReport(root);
    expect(messages(report.warnings)).toEqual(["chapter-04 has no hook: record how the chapter ending pulls the reader on"]);
    expect(report.rows.map((row) => row.verse)).toEqual([true, true, true, false]);
    expect(report.totals).toMatchObject({ scenes: 0, hooks: 0, verseChapters: 3 });
    const text = formatPacing(report);
    expect(text).toContain("Pacing: 0 scenes, 0 sequels, 0 of 1 prose chapter with hooks (3 verse chapters left out)");
    expect(text).toContain("(verse)");

    // The same book as prose has every finding.
    const prose = project("novel", [{ body: long }, { body: short }, { body: "word ".repeat(100) }, { body: "word ".repeat(100) }]);
    for (const number of [1, 2, 3]) {
      for (const scene of [1, 2, 3]) {
        writeMarkdown(path.join(prose, "scenes", `chapter-0${number}-scene-0${scene}.md`), `title: S${number}${scene}\nchapter: chapter-0${number}\nscene: ${scene}\nstatus: draft\noutcome: yes`, "# Scene\n");
      }
    }
    const codes = pacingReport(prose).warnings.map((warning) => warning.code);
    expect(codes).toContain("pacing-no-hook");
    expect(codes).toContain("pacing-easy-wins");
    expect(codes).toContain("pacing-no-sequel");
    expect(codes).toContain("pacing-long-chapter");
    expect(codes).toContain("pacing-short-chapter");
    expect(formatPacing(pacingReport(prose))).toContain("0 of 4 chapters with hooks\n");
  });

  test("validate, next, and continuity skip scene-record and POV checks for verse chapters", () => {
    const root = project("poetry-collection", [{ fields: "pov: nobody", body: POEM }, { fields: "verse: false\npov: nobody", body: "Prose." }]);
    writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), "title: Shore\nchapter: chapter-01\nscene: 1\nstatus: draft\npov: someone", "# Scene\n");
    const validation = validateProject(root);
    expect(messages(validation.warnings).filter((message) => message.includes("scene records"))).toEqual(["chapters/chapter-02.md has no machine-readable scene records"]);
    const pov = checkProjectContinuity(root).warnings.filter((warning) => warning.code.startsWith("pov-"));
    expect(messages(pov)).toEqual(["chapters/chapter-02.md POV character nobody is not listed in characters"]);
    expect(invoke(root, ["next", root]).out).toContain("Create machine-readable scene files for 1 chapters");
  });
});

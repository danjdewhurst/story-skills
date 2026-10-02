import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { COUNT_UNITS, STORY_FORMS, countUnit, formRangeWarning, formRanges } from "../src/forms.js";
import { estimateBookPages } from "../src/html.js";
import { languagePack } from "../src/languages/index.js";
import { characterCount } from "../src/markdown.js";
import { narrationScript } from "../src/narration.js";
import { computeProgress, formatProgress } from "../src/progress.js";
import { buildContext } from "../src/context.js";
import {
  computeWordCounts,
  createStoryProject,
  formatProjectReport,
  projectProgress,
  projectReport,
  reindexProject,
  scanProject,
  pacingReport,
  validateProject
} from "../src/story.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function editStory(root, from, to) {
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(from, to), "utf8");
}

// 吾輩は猫である。名前はまだ無い。 is 16 characters, and the dialogue line 16.
const JAPANESE = "　吾輩は猫である。名前はまだ無い。\n\n「どこで生れたか」と彼は言った。";

function japaneseProject(options = {}) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Cat", language: "ja", ...options });
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", `# Chapter 1: One\n\n## Chapter Text\n\n${JAPANESE}\n`);
  return root;
}

describe("characterCount", () => {
  test("counts non-whitespace grapheme clusters, punctuation included", () => {
    expect(characterCount(JAPANESE)).toBe(32);
    expect(characterCount("你好，世界！")).toBe(6);
    expect(characterCount("Hello world.")).toBe(11);
    expect(characterCount("")).toBe(0);
  });

  test("leaves out whitespace, markup, scene breaks, link targets, and fences", () => {
    expect(characterCount("　猫　猫 \t猫\n")).toBe(3);
    expect(characterCount("**猫**と_犬_")).toBe(3);
    expect(characterCount("猫\n\n* * *\n\n犬\n\n---\n\n#\n\n鳥")).toBe(3);
    expect(characterCount("[猫](https://example.com/cat)![alt](cover.png)")).toBe(1);
    expect(characterCount("```\n猫\n```")).toBe(1);
    expect(characterCount("1\\.猫")).toBe(3);
  });

  test("a grapheme cluster counts once", () => {
    expect(characterCount("é")).toBe(1);
    expect(characterCount("👍🏽")).toBe(1);
    expect(characterCount("が")).toBe(1);
  });
});

describe("count unit", () => {
  test("Chinese and Japanese count characters, everything else words", () => {
    expect(languagePack("ja").countUnit).toBe("characters");
    expect(languagePack("zh").countUnit).toBe("characters");
    expect(languagePack("zh-Hant-TW").countUnit).toBe("characters");
    expect(languagePack("en").countUnit).toBe("words");
    expect(languagePack("ko").countUnit).toBe("words");
    expect(languagePack("xx").countUnit).toBe("words");
  });

  test("story.md count-unit overrides the language", () => {
    expect(countUnit({}, languagePack("ja")).name).toBe("characters");
    expect(countUnit({ "count-unit": "words" }, languagePack("ja")).name).toBe("words");
    expect(countUnit({ "count-unit": "characters" }, languagePack("en")).name).toBe("characters");
    expect(countUnit({ "count-unit": "glyphs" }, languagePack("en")).name).toBe("words");
    expect(countUnit(null, undefined)).toBe(COUNT_UNITS.get("words"));
  });

  test("character ranges cover every form and come from the pack", () => {
    for (const code of ["ja", "zh"]) {
      const ranges = formRanges(COUNT_UNITS.get("characters"), languagePack(code));
      expect([...ranges.keys()].sort()).toEqual([...STORY_FORMS.keys()].sort());
      for (const [form, range] of ranges) {
        if (range.min !== null) {
          expect(range.min).toBeLessThanOrEqual(range.target);
          expect(range.target).toBeLessThanOrEqual(range.max);
        } else {
          expect(form).toBe("serial");
        }
      }
    }
    expect(formRanges(COUNT_UNITS.get("words"), languagePack("ja"))).toBe(STORY_FORMS);
    expect(formRanges(COUNT_UNITS.get("characters"), languagePack("ko"))).toBeNull();
  });

  test("form range warnings name the unit", () => {
    const characters = COUNT_UNITS.get("characters");
    const zh = formRanges(characters, languagePack("zh"));
    expect(formRangeWarning("novel", 100000, "story.md target-characters", zh, characters))
      .toBe("story.md target-characters 100000 is outside the usual novel range of 130000-1000000 characters");
    expect(formRangeWarning("novella", 100000, "story.md target-characters", zh, characters)).toBe("");
    expect(formRangeWarning("novel", 100000, "x", null, characters)).toBe("");
    expect(formRangeWarning("novel", 30000, "story.md target-words")).toBe("story.md target-words 30000 is outside the usual novel range of 40000-200000 words");
  });
});

describe("a book counted in characters", () => {
  test("scans, counts, and records character-count beside word-count", () => {
    const root = japaneseProject();
    const project = scanProject(root);
    expect(project.unit.name).toBe("characters");
    expect(project.chapters[0]).toMatchObject({ wordCount: 27, count: 32, countMissing: true });

    const counts = computeWordCounts(root);
    expect(counts.unit).toBe("characters");
    expect(counts.total).toBe(32);
    expect(counts.chapters[0]).toMatchObject({ wordCount: 27, characterCount: 32 });

    expect(messages(validateProject(root).warnings)).toContain("chapters/chapter-01.md has no character-count (contains 32)");
    computeWordCounts(root, { write: true });
    const chapter = fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8");
    expect(chapter).toContain("word-count: 27\ncharacter-count: 32\n");
    expect(validateProject(root).warnings.filter((warning) => warning.code === "stale-word-count")).toEqual([]);

    const registry = fs.readFileSync(path.join(root, "chapters", "_index.md"), "utf8");
    expect(registry).toContain("| # | Title | POV | Status | Character Count | File |\n|---|-------|-----|--------|-----------------|------|\n");
    expect(registry).toContain("| 1 | One |  | draft | 32 | [chapter-01](chapter-01.md) |");
    expect(registry).toContain("## Total Character Count: 32\n");

    const out = invoke(root, ["wordcount"]).out;
    expect(out).toBe("chapters/chapter-01.md: 32\nTotal: 32 characters\n");
  });

  test("a stale character-count is reported and story next refreshes it", () => {
    const root = japaneseProject();
    computeWordCounts(root, { write: true });
    const file = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("character-count: 32", "character-count: 10"), "utf8");
    expect(messages(validateProject(root).warnings)).toContain("chapters/chapter-01.md declares 10 characters but contains 32");
    expect(invoke(root, ["next"]).out).toContain("Refresh word counts");
  });

  test("story add chapter starts character-count at 0", () => {
    const root = japaneseProject();
    expect(invoke(root, ["add", "chapter", "Two", "--number", "2"]).code).toBe(0);
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-02.md"), "utf8")).toContain("word-count: 0\ncharacter-count: 0\n");
  });

  test("init --form sets target-characters from the language's ranges", () => {
    const cwd = makeTempDir();
    const ja = createStoryProject({ cwd, title: "Ja", language: "ja", form: "novel" });
    const raw = fs.readFileSync(path.join(ja.root, "story.md"), "utf8");
    expect(raw).toContain("target-characters: 150000\n");
    expect(raw).not.toContain("target-words");
    expect(validateProject(ja.root).warnings.filter((warning) => warning.code === "form-length-range")).toEqual([]);

    const zh = createStoryProject({ cwd, title: "Zh", language: "zh", form: "short-story" });
    expect(fs.readFileSync(path.join(zh.root, "story.md"), "utf8")).toContain("target-characters: 10000\n");

    const ko = createStoryProject({ cwd, title: "Ko", language: "ko", form: "novel" });
    expect(fs.readFileSync(path.join(ko.root, "story.md"), "utf8")).toContain("target-words: 80000\n");
  });

  test("a linked book inherits the language and count-unit", () => {
    const cwd = makeTempDir();
    const one = createStoryProject({ cwd, title: "Book One", language: "ja" });
    const two = createStoryProject({ cwd, title: "Book Two", follows: ["book-one"], form: "novella" });
    expect(fs.readFileSync(path.join(two.root, "story.md"), "utf8")).toContain("language: ja\nform: novella\ntarget-characters: 80000\n");
    expect(fs.readFileSync(path.join(two.root, "chapters", "_index.md"), "utf8")).toContain("## Total Character Count: 0\n");

    editStory(one.root, "language: ja\n", "language: ja\ncount-unit: words\n");
    const three = createStoryProject({ cwd, title: "Book Three", follows: ["book-one"], form: "novella" });
    expect(fs.readFileSync(path.join(three.root, "story.md"), "utf8")).toContain("language: ja\ncount-unit: words\nform: novella\ntarget-words: 30000\n");
  });

  test("validate checks the unit, the targets, and the form range in characters", () => {
    const root = japaneseProject();
    editStory(root, "language: ja\n", "language: ja\nform: novel\ntarget-words: 90000\n");
    expect(messages(validateProject(root).warnings)).toContain("story.md target-words is not measured: this book counts characters (language ja), so set target-characters");

    editStory(root, "target-words: 90000\n", "target-characters: 90000\n");
    const warnings = messages(validateProject(root).warnings);
    expect(warnings).toContain("story.md target-characters 90000 is outside the usual novel range of 120000-600000 characters");
    expect(warnings.some((message) => message.includes("not measured"))).toBe(false);

    editStory(root, "status: planning", "status: complete");
    expect(messages(validateProject(root).warnings)).toContain("Manuscript length 32 is outside the usual novel range of 120000-600000 characters");

    editStory(root, "form: novel\n", "form: novel\ncount-unit: pages\n");
    expect(messages(validateProject(root).errors)).toContain("story.md frontmatter field count-unit has unsupported value pages");
    editStory(root, "count-unit: pages\n", "count-unit: words\n");
    editStory(root, "target-characters: 90000", "target-characters: many");
    const result = validateProject(root);
    expect(messages(result.errors)).toContain("story.md frontmatter field target-characters must be an integer");
    expect(messages(result.warnings)).toContain("story.md target-characters is not measured: this book counts words (count-unit), so set target-words");
  });

  test("a chapter's target in the other unit is reported", () => {
    const root = japaneseProject();
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Two\nnumber: 2\ntarget-words: 3000\ncharacter-count: x", "# Chapter 2: Two\n\n## Chapter Text\n\n猫\n");
    const result = validateProject(root);
    expect(messages(result.warnings)).toContain("chapters/chapter-02.md target-words is not measured: this book counts characters (language ja), so set target-characters");
    expect(messages(result.errors)).toContain("chapters/chapter-02.md frontmatter field character-count must be an integer");
  });

  test("progress logs characters and measures them against target-characters", () => {
    const root = japaneseProject();
    editStory(root, "language: ja\n", "language: ja\ntarget-characters: 100\n");
    const file = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: draft", "status: draft\ntarget-characters: 64"), "utf8");
    const progress = projectProgress(root, { log: true, date: "2026-01-02" });
    expect(progress.logged).toMatchObject({ date: "2026-01-02", words: 27, characters: 32 });
    expect(fs.readFileSync(path.join(root, "progress.md"), "utf8")).toContain("  - date: 2026-01-02\n    words: 27\n    characters: 32\n");
    expect(fs.readFileSync(path.join(root, "progress.md"), "utf8")).toContain("Set `target-characters` and `deadline`");
    expect(progress).toMatchObject({ unit: "characters", characters: 32, target: 100, remaining: 68, lastSession: { date: "2026-01-02", characters: 32, since: 0 } });
    expect(progress.words).toBeUndefined();
    expect(progress.chapters).toEqual([{ id: "chapter-01", characters: 32, target: 64, percent: 50 }]);
    const text = formatProgress(progress);
    expect(text).toContain("Progress: 32 of 100 characters (32.0%)");
    expect(text).toContain("Remaining: 68 characters");
    expect(text).toContain("- chapter-01: 32 of 64 characters (50%)");
    expect(invoke(root, ["progress", "--log", "--date", "2026-01-03"]).out).toContain("Logged 32 characters for 2026-01-03");
    expect(validateProject(root).ok).toBe(true);
  });

  test("sessions logged without characters are left out of the pace", () => {
    const progress = computeProgress({ unit: "characters", words: 500, target: null, deadline: null, today: "2026-01-10", chapters: [], sessions: [] });
    expect(formatProgress(progress)).toBe("Progress: 500 characters (no target-characters in story.md)\nSessions: none logged (run story progress --log after a writing session)\n");
    const root = japaneseProject();
    fs.writeFileSync(path.join(root, "progress.md"), "---\ntype: progress-log\nsessions:\n  - date: 2026-01-01\n    words: 10\n  - date: 2026-01-02\n    words: 20\n    characters: -1\n---\n# Progress Log\n", "utf8");
    expect(messages(validateProject(root).errors)).toContain("progress.md sessions[1] characters must be a non-negative integer");
    expect(projectProgress(root, { date: "2026-01-03" }).sessions).toBe(0);
  });

  test("report, pacing, and context give lengths in characters", () => {
    const root = japaneseProject();
    editStory(root, "language: ja\n", "language: ja\ntarget-characters: 64\n");
    const report = projectReport(root);
    expect(report).toMatchObject({ unit: "characters", targetCharacters: 64, counts: { words: 27, proseCharacters: 32 } });
    expect(report.chapters[0]).toMatchObject({ wordCount: 27, characterCount: 32 });
    const text = formatProjectReport(report);
    expect(text).toContain("- Total characters: 32\n- Target characters: 64 (50%)\n");
    expect(text).toContain("- 1. One (draft, 32 characters, POV: unspecified)");

    const pacing = pacingReport(root);
    expect(pacing).toMatchObject({ unit: "characters", medianCharacters: 32 });
    expect(pacing.rows[0].characters).toBe(32);
    expect(pacing.rows[0].words).toBeUndefined();
    const out = invoke(root, ["pacing"]).out;
    expect(out).toContain("Median chapter: 32 characters");
    expect(out).toContain("Ch  Characters  Scenes");

    const file = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: draft", "status: draft\ntarget-characters: 4000"), "utf8");
    const project = scanProject(root);
    const context = buildContext(project, "chapter-01", (filePath) => fs.readFileSync(filePath, "utf8"));
    expect(JSON.stringify(context.sections)).toContain("Target characters: 4000");
  });

  test("builds measure pages, runtime, and the metadata sheet in characters", () => {
    const root = japaneseProject();
    reindexProject(root);
    const book = { unit: "characters", parts: [{ kind: "chapter", heading: true, words: 1, characters: 5800 }] };
    // Title page and verso, one contents page, half a blank, then 5,800
    // characters at 580 a page below the heading sink: 11 pages and half a blank.
    expect(estimateBookPages(book, "5.5x8.5")).toBe(15);
    expect(estimateBookPages({ ...book, unit: undefined }, "5.5x8.5")).toBe(5);

    const script = narrationScript({ title: "猫", unit: "characters", meta: { authors: [] }, front: [], chapters: [{ heading: "One", body: "猫".repeat(600) }], back: [] }, []);
    expect(script).toContain("Estimated finished runtime: 0h 02m at 300 characters per minute (600 characters).");

    expect(invoke(root, ["build", "--format", "metadata", "--out", "meta.md"]).code).toBe(0);
    const sheet = fs.readFileSync(path.join(root, "meta.md"), "utf8");
    expect(sheet).toContain("| Character count | 32 |");
    expect(sheet).not.toContain("Word count");
    expect(invoke(root, ["build", "--format", "shunn", "--out", "shunn.md"]).code).toBe(0);
    expect(fs.readFileSync(path.join(root, "shunn.md"), "utf8")).toContain("Approximately 32 characters");
  });

  test("count-unit: words keeps a Japanese book in words", () => {
    const root = japaneseProject();
    editStory(root, "language: ja\n", "language: ja\ncount-unit: words\n");
    expect(computeWordCounts(root)).toEqual({ chapters: [{ number: 1, title: "One", file: "chapters/chapter-01.md", wordCount: 27 }], total: 27 });
    expect(projectReport(root).unit).toBeUndefined();
  });

  test("import records character-count for a Japanese manuscript", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "draft.md"), `# 第一章\n\n${JAPANESE}\n`, "utf8");
    const result = invoke(cwd, ["import", "draft.md", "--title", "Cat", "--dir", "cat", "--language", "ja"]);
    expect(result.out).toContain("Imported 1 chapter (32 characters)");
    const chapter = fs.readFileSync(path.join(cwd, "cat", "chapters", "chapter-01.md"), "utf8");
    expect(chapter).toContain("word-count: 27\ncharacter-count: 32\n");
    expect(validateProject(path.join(cwd, "cat")).warnings.filter((warning) => warning.code === "stale-word-count")).toEqual([]);
  });
});

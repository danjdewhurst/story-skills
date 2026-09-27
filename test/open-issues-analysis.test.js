import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { compareChapters, formatComparison } from "../src/compare.js";
import { formatClueMatrix } from "../src/clues.js";
import { splitWords, wordCount } from "../src/markdown.js";
import { splitSentences } from "../src/sentences.js";
import { buildBook, clueReport, createEntity, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function project(title = "Open Issues") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title, force: false });
  return { cwd, root };
}

function writeChapter(root, number, body, extra = "status: draft") {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Chapter ${number}\nnumber: ${number}\n${extra}`, `## Chapter Text\n\n${body}\n`);
}

function chapter(id, title, paragraphs) {
  return { id, title, words: paragraphs.join(" ").split(/\s+/).filter(Boolean).length, paragraphs };
}

describe("#221 clues header counts what the manuscript has done", () => {
  test("a planned clue with scheduled chapters counts as neither planted nor revealed", () => {
    const { root } = project();
    writeChapter(root, 1, "Words.");
    writeMarkdown(path.join(root, "continuity", "clues", "muddy-boot.md"), "title: Muddy Boot\nstatus: planned\nplanted: chapter-07\npayoff: chapter-09\ncharacters:\n  - x", "# Muddy Boot\n");
    writeMarkdown(path.join(root, "continuity", "clues", "torn-cuff.md"), "title: Torn Cuff\nstatus: planted\nplanted: chapter-01\npayoff: chapter-09\ncharacters:\n  - x", "# Torn Cuff\n");
    const report = clueReport(root);
    expect(report.totals).toEqual({ clues: 2, redHerrings: 0, planted: 1, revealed: 0 });
    expect(formatClueMatrix(report)).toContain("Clues: 2 live (0 red herrings), 1 planted, 0 revealed");
  });
});

describe("#208 Chinese and Japanese count per character", () => {
  test("each Han, Hiragana, or Katakana character is a word", () => {
    expect(splitWords("我是一个学生。他很好。")).toHaveLength(9);
    expect(wordCount("これは日本語の文章です。")).toBe(11);
    expect(wordCount("コーヒー and tea")).toBe(6);
    expect(wordCount("Plain English words stay whole.")).toBe(5);
  });

  test("。！？ end sentences", () => {
    expect(splitSentences("我是一个学生。他很好！你呢？")).toEqual(["我是一个学生。", "他很好！", "你呢？"]);
    expect(splitSentences("没有句号")).toEqual(["没有句号."]);
  });
});

describe("#189 compare pairs chapters renumbered by move", () => {
  test("moved chapters are reported as moved and the inserted one as added", () => {
    const before = [
      chapter("chapter-01", "C1", ["Paragraph one of chapter 1.", "Another paragraph 1."]),
      chapter("chapter-02", "C2", ["Paragraph one of chapter 2.", "Another paragraph 2."]),
      chapter("chapter-03", "C3", ["Paragraph one of chapter 3.", "Another paragraph 3."])
    ];
    const after = [
      before[0],
      chapter("chapter-02", "New", []),
      { ...before[1], id: "chapter-03" },
      { ...before[2], id: "chapter-04", paragraphs: [...before[2].paragraphs, "A new closing line."] }
    ];
    const comparison = compareChapters(before, after);
    expect(comparison.chapters.map((entry) => [entry.id, entry.status, entry.movedFrom])).toEqual([
      ["chapter-01", "unchanged", undefined],
      ["chapter-02", "added", undefined],
      ["chapter-03", "unchanged", "chapter-02"],
      ["chapter-04", "changed", "chapter-03"]
    ]);
    const text = formatComparison(comparison, "git ref HEAD");
    expect(text).toContain("(1 added, 0 removed, 2 moved)");
    expect(text).toContain("- chapter-03 C2 (moved from chapter-02): unchanged");
    expect(text).toContain("- chapter-02 New: added");
  });

  test("a rewritten chapter under the same id still matches by id", () => {
    const comparison = compareChapters(
      [chapter("chapter-01", "A", ["Old one.", "Old two."])],
      [chapter("chapter-01", "A", ["New one.", "New two."])]
    );
    expect(comparison.chapters).toHaveLength(1);
    expect(comparison.chapters[0].status).toBe("changed");
    expect(comparison.chapters[0].movedFrom).toBeUndefined();
    expect(formatComparison(comparison, "x")).toContain("(0 added, 0 removed)\n");
  });
});

describe("#187 import warns about chapter lines it did not split on", () => {
  test("plain chapter lines in a file with a markdown chapter heading", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "mix.md"), "# Prologue\n\nBefore it all.\n\nChapter 1\n\nFirst text.\n\nChapter 2\n\nSecond text.\n\nChapter 3\n\nThird text.\n");
    const result = invoke(cwd, ["import", "mix.md", "--title", "Mix"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("warning: mix.md: 3 plain-text chapter lines were not used to split chapters (first \"Chapter 1\" at line 5): the file has markdown chapter headings");
  });

  test("chapter lines not followed by a blank line, counted from the top of the file", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "t.txt"), "Chapter 1\nIt was dark.\n\nChapter 2\nMorning came.\n");
    const result = invoke(cwd, ["import", "t.txt", "--title", "Tx"]);
    expect(result.err).toContain("2 plain-text chapter lines were not used to split chapters (first \"Chapter 1\" at line 1): a chapter line splits only when it stands alone between blank lines");
  });

  test("a clean split prints no warning", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "ok.txt"), "Chapter 1\n\nIt was dark.\n\nChapter 2\n\nMorning came.\n");
    const result = invoke(cwd, ["import", "ok.txt", "--title", "Ok"]);
    expect(result.out).toContain("Imported 2 chapters");
    expect(result.err).not.toContain("warning:");
  });
});

describe("#133 [TODO markers in chapter prose", () => {
  test("validate warns and the metadata checklist names the chapter; comments do not count", () => {
    const { root } = project("Gull");
    writeChapter(root, 1, "A boy called Harry Rowe [TODO: check bible] came.\n\n<!-- [TODO: fine here] -->");
    writeChapter(root, 2, "Clean prose.\n\n<!-- [TODO: only a note] -->");
    const report = validateProject(root);
    const todo = messages(report.warnings).filter((warning) => warning.includes("[TODO"));
    expect(todo).toEqual([`${path.join("chapters", "chapter-01.md")} has 1 [TODO marker in its prose, which every build prints: resolve it or move it into an HTML comment`]);

    const { outFile } = buildBook(root, { format: "metadata" });
    const sheet = fs.readFileSync(outFile, "utf8");
    expect(sheet).toContain("- [ ] No `[TODO` markers in chapter prose (found in: chapter-01)");

    writeChapter(root, 1, "A boy called Harry Rowe came.");
    expect(fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8")).toContain("- [x] No `[TODO` markers in chapter prose\n");
  });
});

describe("#77 next drafts an empty outlined chapter before adding one", () => {
  test("suggests the first chapter with no prose", () => {
    const { cwd, root } = project("Fresh Book");
    createEntity(root, { kind: "chapter", name: "Chapter 1", number: 1 });
    const result = invoke(cwd, ["next", root]);
    expect(result.out).toContain("[P2] Draft chapter 1: chapters/chapter-01.md has no prose yet (status outline)");
    expect(result.out).not.toContain("Draft chapter 2");
  });

  test("suggests a new chapter once every chapter has prose", () => {
    const { cwd, root } = project();
    writeChapter(root, 1, "Some drafted words here.");
    const text = invoke(cwd, ["next", root]).out;
    expect(text).toContain("Draft chapter 2");
    expect(text).toContain("story add chapter");
  });
});

describe("#241 #240 review copy build stamp", () => {
  test("--stamp prints the build label; default builds carry none", () => {
    const { root } = project();
    writeChapter(root, 1, "One.\n\nTwo.");
    const plain = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(plain).toContain("<p class=\"note\">Review copy. Every paragraph");
    expect(plain).toContain("first few words");
    const stamped = fs.readFileSync(buildBook(root, { format: "html", stamp: "beta <round> 1\n" }).outFile, "utf8");
    expect(stamped).toContain("Review copy, build <code>beta &lt;round&gt; 1</code>.");
    expect(stamped).toContain("Quote the label and the build");
  });

  test("--stamp is refused with other formats or empty", () => {
    const { cwd, root } = project();
    writeChapter(root, 1, "One.");
    expect(() => buildBook(root, { format: "epub", stamp: "x" })).toThrow("--stamp applies only to --format html");
    expect(() => buildBook(root, { format: "html", stamp: " " })).toThrow("--stamp needs a label");
    const result = invoke(cwd, ["build", root, "--format", "html", "--stamp", "2026-09-27 abc1234"]);
    expect(result.code).toBe(0);
  });

  test("the issue form asks for the build and the first few words", () => {
    const form = fs.readFileSync(path.join(import.meta.dir, "..", "templates", "github", "ISSUE_TEMPLATE", "manuscript-note.yml"), "utf8");
    expect(form).toContain("id: build");
    expect(form).toContain("id: quote");
    const workflow = fs.readFileSync(path.join(import.meta.dir, "..", "templates", "github", "review-copy.yml"), "utf8");
    expect(workflow).toContain("--stamp");
  });

  test("docs and skills no longer call paragraph labels stable", () => {
    const repo = path.join(import.meta.dir, "..");
    for (const file of ["docs/cli-reference.md", "skills/feedback-triage/SKILL.md", "skills/story-maintenance/SKILL.md", "src/html.js"]) {
      expect(fs.readFileSync(path.join(repo, file), "utf8")).not.toMatch(/stable (?:label|anchor|paragraph anchor)/);
    }
  });
});

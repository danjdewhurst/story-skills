import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { checkProjectSchema } from "../scripts/check-schema.js";
import { runCli } from "../src/cli.js";
import { computeProgress, formatProgress, localDate } from "../src/progress.js";
import { createStoryProject, formatProjectReport, projectProgress, projectReport, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function progressProject(storyFields = "target-words: 1000\ndeadline: 2026-10-01") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Progress Story", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("tense: past\n", `tense: past\n${storyFields}\n`), "utf8");
  writeChapter(root, 1, 100, "target-words: 400");
  writeChapter(root, 2, 150, "");
  return { root, cwd };
}

function writeChapter(root, number, words, extra) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft\n${extra}`, `## Chapter Text\n\n${"word ".repeat(words)}\n`);
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

describe("story progress", () => {
  test("measures words against the target, deadline, and chapter targets", () => {
    const { root } = progressProject();
    const progress = projectProgress(root, { date: "2026-09-21" });

    expect(progress).toMatchObject({ ok: true, words: 250, target: 1000, percent: 25, remaining: 750, logged: null, sessions: 0 });
    expect(progress.deadline).toEqual({ date: "2026-10-01", daysLeft: 10, perDay: 75 });
    expect(progress.chapters).toEqual([{ id: "chapter-01", words: 100, target: 400, percent: 25 }]);
  });

  test("--log creates progress.md, replaces a same-day entry, and computes pace", () => {
    const { root, cwd } = progressProject();
    const first = invoke(cwd, ["progress", "--log", "--date", "2026-09-01", "--path", root]);
    expect(first.code).toBe(0);
    expect(first.out).toContain(`Logged 250 words for 2026-09-01 in ${path.join(root, "progress.md")}`);
    const log = fs.readFileSync(path.join(root, "progress.md"), "utf8");
    expect(log).toContain("type: progress-log\nsessions:\n  - date: 2026-09-01\n    words: 250\n");
    expect(log).toContain("# Progress Log");

    writeChapter(root, 3, 50, "");
    projectProgress(root, { log: true, date: "2026-09-01" });
    writeChapter(root, 4, 100, "");
    const progress = projectProgress(root, { log: true, date: "2026-09-06" });

    const sessions = fs.readFileSync(path.join(root, "progress.md"), "utf8");
    expect(sessions).toContain("  - date: 2026-09-01\n    words: 300\n  - date: 2026-09-06\n    words: 400\n");
    expect(progress.sessions).toBe(2);
    expect(progress.pace).toBe(20);
    expect(progress.projected).toBe("2026-10-06");
    expect(progress.lastSession).toEqual({ date: "2026-09-06", words: 400, since: 0 });
    expect(validateProject(root).errors).toEqual([]);
    expect(validateProject(root).warnings.join("\n")).not.toContain("progress.md");
    expect(checkProjectSchema(root)).toEqual([]);
  });

  test("--log keeps the log body and other frontmatter when appending", () => {
    const { root } = progressProject();
    writeMarkdown(path.join(root, "progress.md"), "type: progress-log\ngoal: finish draft one\nsessions:\n  - date: 2026-08-01\n    words: 10", "# My log\n\nNotes stay.\n");
    projectProgress(root, { log: true, date: "2026-08-02" });
    const log = fs.readFileSync(path.join(root, "progress.md"), "utf8");
    expect(log).toContain("goal: finish draft one");
    expect(log).toContain("  - date: 2026-08-02\n    words: 250");
    expect(log).toContain("# My log\n\nNotes stay.\n");
  });

  test("--log refuses an unparsable progress.md and a bad --date", () => {
    const { root } = progressProject();
    expect(() => projectProgress(root, { date: "2026-02-30" })).toThrow("progress --date date must be a real YYYY-MM-DD calendar day, got 2026-02-30");
    expect(() => projectProgress(root, { date: " " })).toThrow("progress --date must be a YYYY-MM-DD date");
    fs.writeFileSync(path.join(root, "progress.md"), "no frontmatter", "utf8");
    expect(() => projectProgress(root, { log: true, date: "2026-09-01" })).toThrow("Cannot log progress: progress.md does not parse");
    const result = projectProgress(root, { date: "2026-09-01" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("progress.md:");
  });

  test("defaults the date to today", () => {
    const { root } = progressProject("target-words: 1000");
    expect(projectProgress(root, { log: true }).logged.date).toBe(localDate());
  });

  test("validate checks deadline, chapter targets, and the log", () => {
    const { root } = progressProject("deadline: 2026-13-01");
    writeChapter(root, 3, 10, "target-words: 0");
    writeMarkdown(path.join(root, "progress.md"), "type: notes\nsessions:\n  - date: 2026-09-01\n    words: 5\n  - date: 2026-09-01\n    words: -1\n  - words: 3\n  - nope");
    const { errors } = validateProject(root);

    expect(errors).toContain("story.md deadline date must be a real YYYY-MM-DD calendar day, got 2026-13-01");
    expect(errors.join("\n")).toContain("chapters/chapter-03.md frontmatter field target-words");
    expect(errors).toContain("progress.md type must be progress-log");
    expect(errors).toContain("progress.md sessions[1] repeats date 2026-09-01");
    expect(errors).toContain("progress.md sessions[1] words must be a non-negative integer");
    expect(errors).toContain("progress.md sessions[2] requires a date");
    expect(errors).toContain("progress.md frontmatter field sessions must contain objects");
  });

  test("validate rejects a non-string, empty, or list deadline", () => {
    for (const value of ["20261001", '""', "\n  - 2026-10-01"]) {
      const { root } = progressProject(`deadline: ${value}`);
      expect(validateProject(root).errors).toContain("story.md deadline must be a YYYY-MM-DD date");
    }
  });

  test("--log refuses to rewrite a log with invalid sessions and leaves it untouched", () => {
    const { root } = progressProject();
    const original = "---\ntype: progress-log\nsessions:\n  - date: 2026-09-01\n    words: 5\n  - date: 2026-02-30\n    words: 7\n---\n\n# Log\n";
    fs.writeFileSync(path.join(root, "progress.md"), original, "utf8");

    expect(() => projectProgress(root, { log: true, date: "2026-09-02" })).toThrow("Cannot log progress until progress.md is fixed: progress.md sessions[1] date must be a real YYYY-MM-DD calendar day, got 2026-02-30");
    expect(fs.readFileSync(path.join(root, "progress.md"), "utf8")).toBe(original);
    expect(projectProgress(root, { date: "2026-09-02" }).sessions).toBe(1);
  });

  test("progress accepts a positional project path", () => {
    const { root, cwd } = progressProject();
    const result = invoke(cwd, ["progress", root, "--log", "--date", "2026-09-01"]);
    expect(result.code).toBe(0);
    expect(fs.existsSync(path.join(root, "progress.md"))).toBe(true);
  });

  test("report shows the target when set", () => {
    const { root } = progressProject();
    expect(formatProjectReport(projectReport(root))).toContain("- Target words: 1000 (25%)");
    const bare = progressProject("");
    expect(formatProjectReport(projectReport(bare.root))).not.toContain("Target words");
  });
});

describe("formatProgress", () => {
  const base = { words: 250, target: null, deadline: null, today: "2026-09-21", chapters: [], sessions: [] };

  test("without a target, sessions, or deadline", () => {
    const text = formatProgress(computeProgress(base));
    expect(text).toBe("Progress: 250 words (no target-words in story.md)\nSessions: none logged (run story progress --log after a writing session)\n");
  });

  test("with a target, a future deadline, pace, and chapter targets", () => {
    const text = formatProgress(computeProgress({
      ...base,
      words: 12500,
      target: 90000,
      deadline: "2026-10-01",
      chapters: [{ id: "chapter-01", words: 2500, target: 3000 }, { id: "chapter-02", words: 10, target: 0 }],
      sessions: [{ date: "2026-09-01", words: 10000 }, { date: "2026-09-11", words: 12000 }]
    }));

    expect(text).toContain("Progress: 12,500 of 90,000 words (13.9%)");
    expect(text).toContain("Remaining: 77,500 words");
    expect(text).toContain("Deadline: 2026-10-01 (10 days left): 7,750 words a day needed");
    expect(text).toContain("Sessions: 2 logged; last 2026-09-11 (+500 words since)");
    expect(text).toContain("Pace: 200 words a day over the last 2 sessions");
    expect(text).toContain("Projected finish at this pace: 2027-10-14");
    expect(text).toContain("Chapter targets:\n- chapter-01: 2,500 of 3,000 words (83%)\n");
    expect(text).not.toContain("chapter-02");
  });

  test("deadline passed, deadline without a target, and words falling since the last session", () => {
    const passed = formatProgress(computeProgress({ ...base, target: 100, deadline: "2026-09-20" }));
    expect(passed).toContain("Deadline: 2026-09-20 passed 1 day ago");

    const noTarget = formatProgress(computeProgress({ ...base, deadline: "2026-09-22", sessions: [{ date: "2026-09-20", words: 300 }] }));
    expect(noTarget).toContain("Deadline: 2026-09-22 (1 day left)");
    expect(noTarget).toContain("last 2026-09-20 (-50 words since)");
  });

  test("no pace from a single day or a flat log, and no projection once the target is met", () => {
    const sameDay = computeProgress({ ...base, target: 1000, sessions: [{ date: "2026-09-20", words: 1 }] });
    expect(sameDay.pace).toBeNull();

    const flat = computeProgress({ ...base, target: 1000, sessions: [{ date: "2026-09-01", words: 250 }, { date: "2026-09-10", words: 250 }] });
    expect(flat.pace).toBe(0);
    expect(flat.projected).toBeNull();

    const done = computeProgress({ ...base, words: 1200, target: 1000, sessions: [{ date: "2026-09-01", words: 0 }, { date: "2026-09-10", words: 1200 }] });
    expect(done.remaining).toBe(0);
    expect(done.projected).toBeNull();
    expect(computeProgress({ ...done, deadline: "2026-12-01", today: "2026-09-21" }).deadline.perDay).toBe(0);
  });
});

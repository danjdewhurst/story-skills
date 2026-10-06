import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { checkProjectSchema } from "../scripts/check-schema.js";
import { runCli } from "../src/cli.js";
import { computeProgress, formatProgress, historyWeeks, localDate } from "../src/progress.js";
import { createStoryProject, formatProjectReport, projectProgress, projectReport, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

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
    expect(progress.chapters).toEqual([{ id: "chapter-01", words: 100, characterCount: null, target: 400, percent: 25 }]);
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
    expect(progress.lastSession).toEqual({ date: "2026-09-06", words: 400, characterCount: null, since: 0 });
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(messages(validateProject(root).warnings).join("\n")).not.toContain("progress.md");
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
    expect(messages(result.errors).join("\n")).toContain("progress.md:");
  });

  test("defaults the date to today", () => {
    const { root } = progressProject("target-words: 1000");
    expect(projectProgress(root, { log: true }).logged.date).toBe(localDate());
  });

  test("validate checks deadline, chapter targets, and the log", () => {
    const { root } = progressProject("deadline: 2026-13-01");
    writeChapter(root, 3, 10, "target-words: 0");
    writeMarkdown(path.join(root, "progress.md"), "type: notes\nsessions:\n  - date: 2026-09-01\n    words: 5\n  - date: 2026-09-01\n    words: -1\n  - words: 3\n  - nope");
    const errors = messages(validateProject(root).errors);

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
      expect(messages(validateProject(root).errors)).toContain("story.md deadline must be a YYYY-MM-DD date");
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

describe("daily targets and streaks", () => {
  // 2026-09-14 is a Monday. Each session is the whole manuscript that day.
  const log = [
    { date: "2026-09-14", words: 100 },
    { date: "2026-09-15", words: 400 },
    { date: "2026-09-17", words: 700 },
    { date: "2026-09-18", words: 1000 },
    { date: "2026-09-21", words: 1100 }
  ];
  const daily = (options) => computeProgress({ words: 1250, target: null, deadline: null, today: "2026-09-22", chapters: [], sessions: log, ...options }).daily;

  test("today is measured live against the last session before it", () => {
    expect(daily({}).today).toEqual({ date: "2026-09-22", scheduled: true, written: 150, remaining: null, met: null });
    expect(daily({ dailyTarget: 200 }).today).toMatchObject({ written: 150, remaining: 50, met: false });
    expect(daily({ dailyTarget: 100 }).today).toMatchObject({ remaining: 0, met: true });
    // A session logged today does not stop the live measure.
    expect(daily({ today: "2026-09-21", words: 1300 }).today.written).toBe(300);
  });

  test("the streak counts gaining days, and a missed day breaks it", () => {
    // 15, 17, 18, 21, 22 gained words; 16, 19, and 20 did not.
    expect(daily({}).streak).toEqual({ current: 2, longest: 2 });
    // Weekends off: the 19th and 20th no longer break the run.
    expect(daily({ writingDays: ["mon", "tue", "wed", "thu", "fri"] }).streak).toEqual({ current: 4, longest: 4 });
    // A target of 200: the 21st (+100) and today (+150) fall short.
    expect(daily({ dailyTarget: 200, writingDays: ["mon", "tue", "thu", "fri"] }).streak).toEqual({ current: 0, longest: 3 });
  });

  test("today does not break the streak before it is written", () => {
    expect(daily({ words: 1100 }).streak).toEqual({ current: 1, longest: 2 });
    expect(daily({ words: 1100 }).today.written).toBe(0);
    expect(daily({ words: 1100, today: "2026-09-24" }).streak.current).toBe(0);
  });

  test("weeks run Monday to Sunday, oldest first, with each week's target", () => {
    const { weeks } = daily({ dailyTarget: 250, writingDays: ["mon", "wed"] });
    expect(weeks.map((week) => week.start)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]);
    expect(weeks[2]).toEqual({ start: "2026-09-14", end: "2026-09-20", written: 900, days: 3, target: 500 });
    expect(weeks[3]).toEqual({ start: "2026-09-21", end: "2026-09-27", written: 250, days: 2, target: 500 });
    expect(daily({}).weeks[3].target).toBeNull();
  });

  test("weeks sets how many weeks of history, ending with the current week", () => {
    const one = daily({ weeks: 1 }).weeks;
    expect(one).toEqual([{ start: "2026-09-21", end: "2026-09-27", written: 250, days: 2, target: null }]);
    const long = daily({ weeks: 52 }).weeks;
    expect(long).toHaveLength(52);
    expect(long[0].start).toBe("2025-09-29");
    expect(long.slice(-4)).toEqual(daily({}).weeks);

    const text = (weeks) => formatProgress(computeProgress({ words: 1250, target: null, deadline: null, today: "2026-09-22", chapters: [], sessions: log, weeks }));
    expect(text(1)).toContain("\nThis week:\n- 2026-09-21: 250 words on 2 days\n");
    expect(text(6)).toContain("\nLast 6 weeks:\n- 2026-08-17: 0 words on 0 days\n");
  });

  test("historyWeeks accepts a whole number 1 to 52, default 4", () => {
    expect(historyWeeks({})).toBe(4);
    expect(historyWeeks({ weeks: "1" })).toBe(1);
    expect(historyWeeks({ weeks: 52 })).toBe(52);
    expect(historyWeeks({ weeks: " 12 " })).toBe(12);
    for (const weeks of ["0", "53", "-1", "2.5", "abc", "", "1e1"]) {
      expect(() => historyWeeks({ weeks })).toThrow("--weeks must be a whole number 1 to 52, such as 4");
    }
  });

  test("story progress --weeks reaches text and JSON, and a bad value is a usage error", () => {
    const { root, cwd } = progressProject();
    writeMarkdown(path.join(root, "progress.md"), "type: progress-log\nsessions:\n  - date: 2026-09-01\n    words: 100", "");
    const text = invoke(cwd, ["progress", root, "--date", "2026-09-21", "--weeks", "8"]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("Last 8 weeks:\n- 2026-08-03: 0 words on 0 days\n");

    const json = invoke(cwd, ["progress", root, "--date", "2026-09-21", "--weeks", "12", "--json"]);
    expect(JSON.parse(json.out).data.daily.weeks).toHaveLength(12);

    for (const weeks of ["0", "53", "two"]) {
      const bad = invoke(cwd, ["progress", root, "--weeks", weeks]);
      expect(bad.code).toBe(2);
      expect(bad.err).toContain("--weeks must be a whole number 1 to 52");
    }
    // A bad --weeks stops --log before it writes.
    const before = fs.readFileSync(path.join(root, "progress.md"), "utf8");
    expect(invoke(cwd, ["progress", root, "--log", "--weeks", "99"]).code).toBe(2);
    expect(fs.readFileSync(path.join(root, "progress.md"), "utf8")).toBe(before);
  });

  test("story.md cli-defaults can set --weeks, and validate checks it", () => {
    const { root, cwd } = progressProject("cli-defaults:\n  - command: progress\n    weeks: 2");
    writeMarkdown(path.join(root, "progress.md"), "type: progress-log\nsessions:\n  - date: 2026-09-01\n    words: 100", "");
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(invoke(cwd, ["progress", root, "--date", "2026-09-21"]).out).toContain("Last 2 weeks:\n");
    // A flag on the command line wins over the default.
    expect(invoke(cwd, ["progress", root, "--date", "2026-09-21", "--weeks", "3"]).out).toContain("Last 3 weeks:\n");

    const bad = progressProject("cli-defaults:\n  - command: progress\n    weeks: 60");
    expect(messages(validateProject(bad.root).errors).join("\n")).toContain("cli-defaults[0]: --weeks must be a whole number 1 to 52");
  });

  test("sparse, out-of-order, future, and falling logs", () => {
    const sparse = computeProgress({
      words: 500,
      target: null,
      deadline: null,
      today: "2026-09-10",
      chapters: [],
      sessions: [{ date: "2026-12-01", words: 9000 }, { date: "2026-09-08", words: 600 }, { date: "2026-01-01", words: 0 }]
    }).daily;
    // The future session is ignored; the eight-month gap is one gain on the 8th.
    expect(sparse.today.written).toBe(-100);
    expect(sparse.streak).toEqual({ current: 0, longest: 1 });
    expect(sparse.weeks[3]).toMatchObject({ start: "2026-09-07", written: 500, days: 1 });

    const none = computeProgress({ words: 10, target: null, deadline: null, today: "2026-09-10", chapters: [], sessions: [] }).daily;
    expect(none.today.written).toBeNull();
    expect(none.streak).toEqual({ current: 0, longest: 0 });
  });

  test("formatProgress prints today, the streak, and the weeks", () => {
    const text = formatProgress(computeProgress({ words: 1250, target: null, deadline: null, today: "2026-09-22", chapters: [], sessions: log, dailyTarget: 200, writingDays: ["mon", "tue", "thu", "fri"] }));
    expect(text).toContain("Today: +150 of 200 words (50 to go)\nStreak: 0 days (longest 3; writing days mon, tue, thu, fri)\n\nLast 4 weeks:\n- 2026-08-31: 0 of 800 words on 0 days\n");
    expect(text).toContain("- 2026-09-21: 250 of 800 words on 2 days\n");

    const sunday = formatProgress(computeProgress({ words: 1250, target: null, deadline: null, today: "2026-09-20", chapters: [], sessions: log, writingDays: ["mon"] }));
    expect(sunday).toContain("Today: +250 words (not a writing day)\nStreak: 4 days (longest 4; writing days mon)\n");

    const unmeasured = formatProgress(computeProgress({ words: 10, target: null, deadline: null, today: "2026-09-20", chapters: [], sessions: [], dailyTarget: 500 }));
    expect(unmeasured).toContain("Today: 500 words a day target (no session logged before today to measure from)\n");
    expect(unmeasured).not.toContain("Streak");
  });

  test("story.md daily-target-words and writing-days reach progress and validate", () => {
    const { root, cwd } = progressProject("daily-target-words: 100\nwriting-days: [Mon, tuesday, fri]");
    writeMarkdown(path.join(root, "progress.md"), "type: progress-log\nsessions:\n  - date: 2026-09-20\n    words: 120", "");
    const progress = projectProgress(root, { date: "2026-09-21" });
    expect(progress.daily).toMatchObject({ target: 100, writingDays: ["mon", "tue", "fri"], today: { written: 130, met: true }, streak: { current: 1, longest: 1 } });
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(checkProjectSchema(root)).toEqual([]);

    const json = invoke(cwd, ["progress", root, "--date", "2026-09-21", "--json"]);
    expect(JSON.parse(json.out).data.daily.streak).toEqual({ current: 1, longest: 1 });

    const bad = progressProject("daily-target-words: 0\nwriting-days: [mon, someday]");
    const errors = messages(validateProject(bad.root).errors);
    expect(errors).toContain("story.md frontmatter field daily-target-words must be at least 1");
    expect(errors).toContain("story.md frontmatter field writing-days must be a list of weekdays (mon, tue, wed, thu, fri, sat, sun, or full names), got [mon, someday]");
    expect(projectProgress(bad.root, { date: "2026-09-21" }).ok).toBe(false);
    expect(messages(validateProject(progressProject("writing-days: fri").root).errors).join("\n")).toContain("writing-days must be a list of weekdays");
    expect(messages(validateProject(progressProject("writing-days: [1, mon]").root).errors).join("\n")).toContain("writing-days must be a list of weekdays");

    // An empty list, which the schema allows, means every day, like none.
    const empty = progressProject("writing-days: []");
    expect(messages(validateProject(empty.root).errors)).toEqual([]);
    expect(checkProjectSchema(empty.root)).toEqual([]);
    expect(projectProgress(empty.root, { date: "2026-09-21" })).toMatchObject({ ok: true, daily: { writingDays: null } });
  });

  test("a book counted in words warns about daily-target-characters", () => {
    const { root } = progressProject("daily-target-characters: 800");
    expect(messages(validateProject(root).warnings).join("\n")).toContain("story.md daily-target-characters is not measured: this book counts words (language en), so set daily-target-words");
  });
});

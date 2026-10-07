import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkProjectSchema } from "../scripts/check-schema.js";
import { runCli } from "../src/cli.js";
import { computeProgress, formatProgress, historyWeeks } from "../src/progress.js";
import { createStoryProject, formatProjectReport, projectProgress, projectReport, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown, messages, whileWriting } from "./helpers.js";

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

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

// progress.js sits in a circular import with scan.js. Each entry point loads in
// its own process, since a module graph loads once: progress.js first must not
// read PROGRESS_FILE before its module has run.
test("progress.js loads first, without a circular-import error (#735)", () => {
  const url = pathToFileURL(path.join(import.meta.dirname, "..", "src", "progress.js")).href;
  const result = spawnSync(process.execPath, ["--eval", `await import(${JSON.stringify(url)});`], { encoding: "utf8" });
  expect(result.stderr).not.toContain("before initialization");
  expect(result.status).toBe(0);
});

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

  test("--log keeps a session saved meanwhile, and a log made meanwhile (#547)", () => {
    const { root } = progressProject();
    const log = path.join(root, "progress.md");
    const made = "---\ntype: progress-log\nsessions:\n  - date: 2026-08-31\n    words: 90\n---\n";
    let spy = whileWriting(log, () => fs.writeFileSync(log, made));
    try {
      expect(() => projectProgress(root, { log: true, date: "2026-09-01" })).toThrow("progress.md changed on disk while story was updating it, so it was left as it is");
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(log, "utf8")).toBe(made);
    const saved = made.replace("words: 90", "words: 95");
    spy = whileWriting(log, () => fs.writeFileSync(log, saved));
    try {
      expect(() => projectProgress(root, { log: true, date: "2026-09-01" })).toThrow("progress.md changed on disk");
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(log, "utf8")).toBe(saved);
  });

  // String would flatten [2026-09-01] into a date; validate reports it, and
  // --log refuses to write until it is fixed.
  test("a session whose date is a list is left out", () => {
    const { root } = progressProject();
    writeMarkdown(path.join(root, "progress.md"), "type: progress-log\nsessions:\n  - date: [2026-09-01]\n    words: 10\n  - date: 2026-09-02\n    words: 20", "# Progress Log\n");
    const progress = projectProgress(root, { date: "2026-09-03" });
    expect(progress.sessions).toBe(1);
    expect(progress.lastSession.date).toBe("2026-09-02");
    expect(() => projectProgress(root, { log: true, date: "2026-09-01" })).toThrow("progress.md sessions[0] date must be a YYYY-MM-DD date");
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

  test("defaults the date to the local day, not the UTC day", () => {
    // This machine runs in UTC. Each instant falls on a different day in its
    // zone than in UTC, so a default taken from the UTC day fails a child.
    // Each child fixes the clock, so the expected day is a literal.
    const cases = [
      { zone: "Pacific/Kiritimati", instant: Date.UTC(2026, 9, 6, 12, 0), day: "2026-10-07" },
      { zone: "America/Los_Angeles", instant: Date.UTC(2026, 9, 7, 3, 0), day: "2026-10-06" }
    ];
    for (const { zone, instant, day } of cases) {
      const { root } = progressProject("target-words: 1000");
      const script = `
        const RealDate = Date;
        const fixed = ${instant};
        globalThis.Date = class extends RealDate {
          constructor(...args) {
            if (args.length === 0) {
              super(fixed);
            } else {
              super(...args);
            }
          }
          static now() {
            return fixed;
          }
        };
        const story = await import(${JSON.stringify(pathToFileURL(path.join(import.meta.dir, "..", "src", "story.js")).href)});
        console.log(JSON.stringify(story.projectProgress(${JSON.stringify(root)}, { log: true }).logged.date));
      `;
      const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", env: { ...process.env, TZ: zone }, timeout: 20000 });
      expect({ zone, status: result.status, stderr: result.stderr }).toEqual({ zone, status: 0, stderr: "" });
      expect({ zone, date: JSON.parse(result.stdout) }).toEqual({ zone, date: day });
    }
  });

  test("localDate reads the local calendar day, just either side of midnight", () => {
    // A child sets TZ, since this machine runs in UTC, where a UTC reading
    // would pass. Kiritimati is ahead of UTC and Los Angeles is behind it.
    const script = `
      // story.js first, as the test run loads it: progress.js alone meets an import cycle.
      await import(${JSON.stringify(pathToFileURL(path.join(import.meta.dir, "..", "src", "story.js")).href)});
      const { localDate } = await import(${JSON.stringify(pathToFileURL(path.join(import.meta.dir, "..", "src", "progress.js")).href)});
      console.log(JSON.stringify([localDate(new Date(2026, 9, 7, 0, 30)), localDate(new Date(2026, 9, 6, 23, 59, 59, 999))]));
    `;
    for (const zone of ["Pacific/Kiritimati", "America/Los_Angeles"]) {
      const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", env: { ...process.env, TZ: zone }, timeout: 20000 });
      expect({ zone, status: result.status, stderr: result.stderr }).toEqual({ zone, status: 0, stderr: "" });
      expect({ zone, days: JSON.parse(result.stdout) }).toEqual({ zone, days: ["2026-10-07", "2026-10-06"] });
    }
  });

  test("validate checks deadline, chapter targets, and the log", () => {
    const { root } = progressProject("deadline: 2026-13-01");
    writeChapter(root, 3, 10, "target-words: 0");
    writeMarkdown(path.join(root, "progress.md"), "type: notes\nsessions:\n  - date: 2026-09-01\n    words: 5\n  - date: 2026-09-01\n    words: -1\n  - words: 3\n  - nope\n  - date: \"  \"\n    words: 4\n  - date:\n    words: 4\n  - date: [2026-09-02]\n    words: 4\n  - date: 20260903\n    words: 4");
    const errors = messages(validateProject(root).errors);

    expect(errors).toContain("story.md deadline date must be a real YYYY-MM-DD calendar day, got 2026-13-01");
    expect(errors.join("\n")).toContain("chapters/chapter-03.md frontmatter field target-words");
    expect(errors).toContain("progress.md type must be progress-log");
    expect(errors).toContain("progress.md sessions[1] repeats date 2026-09-01");
    expect(errors).toContain("progress.md sessions[1] words must be a non-negative integer");
    expect(errors).toContain("progress.md sessions[2] requires a date");
    // A blank date, which story progress leaves out, is no date either.
    expect(errors).toContain("progress.md sessions[4] requires a date");
    expect(errors).toContain("progress.md sessions[5] requires a date");
    // A list is not a date, though it holds one.
    expect(errors).toContain("progress.md sessions[6] date must be a YYYY-MM-DD date");
    expect(errors).toContain("progress.md sessions[7] date must be a YYYY-MM-DD date");
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

function newProject(title = "Analysis", cwd = makeTempDir()) {
  return createStoryProject({ cwd, title }).root;
}

function writeChapterWith(root, number, body, extra = "") {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft${extra ? `\n${extra}` : ""}`, `## Chapter Text\n\n${body}\n`);
}

function setStoryFields(root, fields) {
  const file = path.join(root, "story.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("tense: past\n", `tense: past\n${fields}\n`), "utf8");
}

describe("progress (#56, #72, #216, #220)", () => {
  test("#56 --log keeps extra fields and the text of untouched entries", () => {
    const root = newProject();
    writeChapterWith(root, 1, "One two three.");
    fs.writeFileSync(path.join(root, "progress.md"), "---\ntype: progress-log\nsessions:\n  - date: \"2026-09-01\"\n    words: 100\n    note: good day\n---\n\n# Log\n", "utf8");
    projectProgress(root, { log: true, date: "2026-09-02" });
    const log = fs.readFileSync(path.join(root, "progress.md"), "utf8");
    expect(log).toContain("  - date: \"2026-09-01\"\n    words: 100\n    note: good day\n");
    expect(log).toContain("  - date: 2026-09-02\n    words: 3\n");

    writeChapterWith(root, 1, "One two three four.");
    projectProgress(root, { log: true, date: "2026-09-01" });
    const replaced = fs.readFileSync(path.join(root, "progress.md"), "utf8");
    expect(replaced).toContain("note: good day");
    expect(replaced).toContain("words: 4");
    expect(messages(validateProject(root).errors)).toEqual([]);
  });

  test("#72 a padded --date is trimmed, so a second log replaces the first", () => {
    const root = newProject();
    writeChapterWith(root, 1, "One two three.");
    projectProgress(root, { log: true, date: " 2026-09-25" });
    projectProgress(root, { log: true, date: "2026-09-25" });
    const log = fs.readFileSync(path.join(root, "progress.md"), "utf8");
    expect(log.match(/date:/g)).toHaveLength(1);
    expect(log).not.toContain("\" 2026");
  });

  test("#72 validate catches a duplicate date hidden by padding", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, "progress.md"), "---\ntype: progress-log\nsessions:\n  - date: \" 2026-09-25\"\n    words: 1\n  - date: 2026-09-25\n    words: 2\n---\n", "utf8");
    expect(messages(validateProject(root).errors).join("\n")).toContain("repeats date 2026-09-25");
  });

  test("#72 progress reports an invalid target-words or deadline", () => {
    const root = newProject();
    setStoryFields(root, "target-words: 90k\ndeadline: 2027-02-30");
    const result = invoke(path.dirname(root), ["progress", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("story.md frontmatter field target-words must be an integer");
    expect(result.err).toContain("story.md deadline");
  });

  test("#72 the deadline day asks for everything that is left", () => {
    const progress = computeProgress({ words: 993, target: 90000, deadline: "2026-09-20", today: "2026-09-20", chapters: [], sessions: [] });
    expect(formatProgress(progress)).toContain("Deadline: 2026-09-20 (today): 89,007 words needed");
    const done = computeProgress({ words: 90000, target: 90000, deadline: "2026-09-20", today: "2026-09-20", chapters: [], sessions: [] });
    expect(formatProgress(done)).toContain("Deadline: 2026-09-20 (today): 0 words needed");
  });

  test("#216 progress never rounds up to 100% and says 1 word", () => {
    const progress = computeProgress({ words: 624, target: 625, deadline: null, today: "2026-09-20", chapters: [{ id: "chapter-01", words: 624, target: 625 }], sessions: [] });
    const text = formatProgress(progress);
    expect(text).toContain("Remaining: 1 word\n");
    expect(text).toContain("- chapter-01: 624 of 625 words (99%)");
  });

  test("#220 a very slow pace projects nothing instead of crashing", () => {
    const sessions = [{ date: "2000-01-01", words: 0 }, { date: "2026-09-01", words: 976 }];
    const slow = computeProgress({ words: 976, target: 900000, deadline: null, today: "2026-09-02", chapters: [], sessions });
    expect(slow.projected).toBeNull();
    expect(formatProgress(slow)).not.toContain("Projected");
    const slower = computeProgress({ words: 5, target: 900000, deadline: null, today: "2026-09-02", chapters: [], sessions: [sessions[0], { date: "2026-09-01", words: 5 }] });
    expect(slower.projected).toBeNull();
    expect(() => formatProgress(slower)).not.toThrow();
  });
});

describe("sweep fixes", () => {
  test("progress --log refuses while a chapter cannot be read", () => {
    const root = sweepProject();
    fs.writeFileSync(path.join(root, "characters", "bad.md"), "---\nname: Bad\n");
    expect(() => projectProgress(root, { log: true, date: "2024-02-01" })).toThrow("Cannot log progress");
    expect(fs.existsSync(path.join(root, "progress.md"))).toBe(false);
  });
});

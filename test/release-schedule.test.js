import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { RESULT_SCHEMA_PATH, checkProjectSchema, validateAgainstSchema } from "../scripts/check-schema.js";
import { runCli } from "../src/cli.js";
import { formatNextRelease, releaseSchedule } from "../src/release-schedule.js";
import { projectActions } from "../src/report.js";
import { createStoryProject, projectProgress, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

function serialProject(storyFields = "release-every: 7\nrelease-start: 2026-09-04") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Serial Story", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("tense: past\n", `tense: past\nform: serial\n${storyFields}\n`), "utf8");
  writeChapter(root, 1, 100, "");
  writeChapter(root, 2, 100, "");
  writeChapter(root, 3, 0, "");
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

const resultSchema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

const episode = (id, releaseDate, drafted) => ({ id, file: `chapters/${id}.md`, releaseDate: releaseDate === "" ? undefined : releaseDate, drafted });

describe("releaseSchedule", () => {
  const data = { "release-every": 7, "release-start": "2026-09-04" };
  const chapters = [episode("chapter-01", "", true), episode("chapter-02", "", true), episode("chapter-03", "", false)];

  test("is null without a cadence or any release-date", () => {
    expect(releaseSchedule({ data: {}, chapters, today: "2026-09-01" })).toBeNull();
    // Half a cadence schedules nothing; validate reports it.
    expect(releaseSchedule({ data: { "release-every": 7 }, chapters, today: "2026-09-01" })).toBeNull();
    expect(formatNextRelease(null)).toBeNull();
  });

  test("schedules each chapter from the cadence and finds the next release", () => {
    const release = releaseSchedule({ data, chapters, today: "2026-09-05" });
    expect(release.every).toBe(7);
    expect(release.start).toBe("2026-09-04");
    expect(release.episodes.map((entry) => [entry.episode, entry.chapter, entry.date])).toEqual([[1, "chapter-01", "2026-09-04"], [2, "chapter-02", "2026-09-11"], [3, "chapter-03", "2026-09-18"]]);
    expect(release.next).toEqual({ episode: 2, chapter: "chapter-02", file: "chapters/chapter-02.md", date: "2026-09-11", drafted: true, daysUntil: 6 });
    expect(release.warnings).toEqual([]);
    expect(formatNextRelease(release)).toBe("Next release: episode 2 (chapter-02) on 2026-09-11, in 6 days (drafted)");
  });

  test("warns when an undrafted episode is due within 3 days or past, and not before", () => {
    expect(releaseSchedule({ data, chapters, today: "2026-09-14" }).warnings).toEqual([]);
    const soon = releaseSchedule({ data, chapters, today: "2026-09-15" });
    expect(soon.warnings).toEqual([{ code: "release-undrafted", message: "chapters/chapter-03.md (episode 3) releases 2026-09-18, in 3 days, and has no prose yet", file: "chapters/chapter-03.md", chapter: null }]);
    expect(formatNextRelease(soon)).toBe("Next release: episode 3 (chapter-03) on 2026-09-18, in 3 days (not drafted)");
    expect(messages(releaseSchedule({ data, chapters, today: "2026-09-18" }).warnings)).toEqual(["chapters/chapter-03.md (episode 3) releases today (2026-09-18) and has no prose yet"]);
    expect(formatNextRelease(releaseSchedule({ data, chapters, today: "2026-09-18" }))).toBe("Next release: episode 3 (chapter-03) on 2026-09-18, today (not drafted)");
  });

  test("projects the episodes past the last chapter, and warns once about those due", () => {
    const release = releaseSchedule({ data, chapters, today: "2026-09-19" });
    expect(release.next).toMatchObject({ episode: 4, chapter: null, file: null, date: "2026-09-25", daysUntil: 6 });
    expect(formatNextRelease(release)).toBe("Next release: episode 4 on 2026-09-25, in 6 days (no chapter yet)");
    expect(messages(release.warnings)).toEqual(["chapters/chapter-03.md (episode 3) was due 2026-09-18, 1 day ago, and has no prose yet"]);

    const late = releaseSchedule({ data, chapters, today: "2026-10-06" });
    expect(late.next).toMatchObject({ episode: 6, date: "2026-10-09", daysUntil: 3 });
    expect(late.warnings.map((warning) => [warning.file, warning.message])).toEqual([
      ["chapters/chapter-03.md", "chapters/chapter-03.md (episode 3) was due 2026-09-18, 18 days ago, and has no prose yet"],
      ["story.md", "episode 4 was due 2026-09-25, 11 days ago, and has no chapter yet (and 2 more scheduled episodes after it)"]
    ]);
    expect(messages(releaseSchedule({ data, chapters: chapters.slice(0, 2), today: "2026-09-18" }).warnings)).toEqual(["episode 3 releases today (2026-09-18) and has no chapter yet"]);
  });

  describe("in a complete story", () => {
    const done = { ...data, status: "complete" };
    const drafted = [episode("chapter-01", "", true), episode("chapter-02", "", true), episode("chapter-03", "", true)];

    test("keeps the releases still to come, and marks the last", () => {
      expect(formatNextRelease(releaseSchedule({ data: done, chapters: drafted, today: "2026-09-05" }))).toBe("Next release: episode 2 (chapter-02) on 2026-09-11, in 6 days (drafted)");
      const last = releaseSchedule({ data: done, chapters: drafted, today: "2026-09-12" });
      expect(last).toMatchObject({ every: 7, complete: true, last: 3, next: { episode: 3, chapter: "chapter-03", date: "2026-09-18", daysUntil: 6 }, warnings: [] });
      expect(formatNextRelease(last)).toBe("Next release: episode 3 (chapter-03) on 2026-09-18, in 6 days (drafted, the last episode)");
    });

    test("marks an undrafted last chapter and warns about it until it has prose", () => {
      const soon = releaseSchedule({ data: done, chapters, today: "2026-09-15" });
      expect(formatNextRelease(soon)).toBe("Next release: episode 3 (chapter-03) on 2026-09-18, in 3 days (not drafted, the last episode)");
      expect(messages(soon.warnings)).toEqual(["chapters/chapter-03.md (episode 3) releases 2026-09-18, in 3 days, and has no prose yet"]);
      const late = releaseSchedule({ data: done, chapters, today: "2026-09-19" });
      expect(late.next).toBeNull();
      expect(messages(late.warnings)).toEqual(["chapters/chapter-03.md (episode 3) was due 2026-09-18, 1 day ago, and has no prose yet"]);
    });

    test("projects no episode past the last chapter, and says the story is complete", () => {
      const after = releaseSchedule({ data: done, chapters: drafted, today: "2026-10-06" });
      expect(after).toMatchObject({ complete: true, last: 3, next: null, warnings: [] });
      expect(after.episodes.map((entry) => entry.episode)).toEqual([1, 2, 3]);
      expect(formatNextRelease(after)).toBe("Next release: none, the story is complete; episode 3 (chapter-03) on 2026-09-18 was the last");
    });

    test("the last episode is the last to go out, in reading order on the same day", () => {
      const moved = [episode("chapter-01", "", true), episode("chapter-02", "2026-09-20", true), episode("chapter-03", "", true)];
      expect(releaseSchedule({ data: done, chapters: moved, today: "2026-09-19" }).last).toBe(2);
      expect(formatNextRelease(releaseSchedule({ data: done, chapters: moved, today: "2026-09-19" }))).toBe("Next release: episode 2 (chapter-02) on 2026-09-20, in 1 day (drafted, the last episode)");
      expect(formatNextRelease(releaseSchedule({ data: done, chapters: moved, today: "2026-09-21" }))).toBe("Next release: none, the story is complete; episode 2 (chapter-02) on 2026-09-20 was the last");
      const tied = [episode("chapter-01", "", true), episode("chapter-02", "2026-09-18", true), episode("chapter-03", "", true)];
      expect(formatNextRelease(releaseSchedule({ data: done, chapters: tied, today: "2026-09-12" }))).toBe("Next release: episode 2 (chapter-02) on 2026-09-18, in 6 days (drafted)");
      expect(formatNextRelease(releaseSchedule({ data: done, chapters: tied, today: "2026-09-19" }))).toBe("Next release: none, the story is complete; episode 3 (chapter-03) on 2026-09-18 was the last");
    });

    test("names no last episode while a chapter is out of the schedule", () => {
      // Without a cadence, chapters 4 and 5 have no release date and could go out after episode 3.
      const five = [episode("chapter-01", "", true), episode("chapter-02", "", true), episode("chapter-03", "2026-10-10", true), episode("chapter-04", "", true), episode("chapter-05", "", true)];
      const before = releaseSchedule({ data: { status: "complete" }, chapters: five, today: "2026-10-06" });
      expect(before).toMatchObject({ every: null, complete: true, last: null, next: { episode: 3, date: "2026-10-10" } });
      expect(formatNextRelease(before)).toBe("Next release: episode 3 (chapter-03) on 2026-10-10, in 4 days (drafted)");
      expect(formatNextRelease(releaseSchedule({ data: { status: "complete" }, chapters: five, today: "2026-10-20" }))).toBe("Next release: none scheduled after today");

      // Under a cadence, an invalid release-date leaves its chapter out the same way.
      const invalid = [episode("chapter-01", "", true), episode("chapter-02", "", true), episode("chapter-03", "2026-02-30", true)];
      expect(formatNextRelease(releaseSchedule({ data: done, chapters: invalid, today: "2026-09-08" }))).toBe("Next release: episode 2 (chapter-02) on 2026-09-11, in 3 days (drafted)");
      expect(releaseSchedule({ data: done, chapters: invalid, today: "2026-09-12" })).toMatchObject({ last: null, next: null, warnings: [] });
      expect(formatNextRelease(releaseSchedule({ data: done, chapters: invalid, today: "2026-09-12" }))).toBe("Next release: none scheduled after today");
      expect(formatNextRelease(releaseSchedule({ data: done, chapters: [], today: "2026-08-01" }))).toBe("Next release: none scheduled after today");
    });

    test("only status complete stops the cadence: an abandoned story still projects", () => {
      for (const status of ["drafting", "abandoned"]) {
        const release = releaseSchedule({ data: { ...data, status }, chapters: drafted, today: "2026-10-06" });
        expect(release).toMatchObject({ complete: false, last: null, next: { episode: 6, chapter: null } });
        expect(messages(release.warnings)).toEqual(["episode 4 was due 2026-09-25, 11 days ago, and has no chapter yet (and 2 more scheduled episodes after it)"]);
      }
    });
  });

  test("a chapter release-date moves that episode only, and works without a cadence", () => {
    const moved = [episode("chapter-01", "", true), episode("chapter-02", "2026-09-14", true), episode("chapter-03", "", false)];
    const release = releaseSchedule({ data, chapters: moved, today: "2026-09-12" });
    expect(release.episodes.map((entry) => entry.date)).toEqual(["2026-09-04", "2026-09-14", "2026-09-18"]);
    expect(release.next).toMatchObject({ episode: 2, date: "2026-09-14" });

    const explicit = [episode("chapter-01", "2026-09-04", true), episode("chapter-02", "", true), episode("chapter-03", "2026-09-20", false)];
    const own = releaseSchedule({ data: {}, chapters: explicit, today: "2026-09-10" });
    expect(own).toMatchObject({ every: null, start: null, next: { episode: 3, date: "2026-09-20", daysUntil: 10 }, warnings: [] });
    expect(own.episodes.map((entry) => entry.chapter)).toEqual(["chapter-01", "chapter-03"]);
    const after = releaseSchedule({ data: {}, chapters: explicit, today: "2026-09-21" });
    expect(after.next).toBeNull();
    expect(formatNextRelease(after)).toBe("Next release: none scheduled after today");
    expect(messages(after.warnings)).toEqual(["chapters/chapter-03.md (episode 3) was due 2026-09-20, 1 day ago, and has no prose yet"]);
  });

  test("an invalid release-date leaves its episode out instead of putting it back on the cadence", () => {
    const invalid = [episode("chapter-01", "", true), episode("chapter-02", "2026-02-30", false), episode("chapter-03", 20260918, false)];
    expect(releaseSchedule({ data, chapters: invalid, today: "2026-09-12" }).episodes.map((entry) => entry.chapter)).toEqual(["chapter-01"]);
    expect(releaseSchedule({ data: {}, chapters: invalid.slice(1), today: "2026-09-12" })).toBeNull();
  });

  test("a cadence past 9999-12-31 schedules nothing more, and never crashes", () => {
    const huge = releaseSchedule({ data: { "release-every": 100000000, "release-start": "2026-09-04" }, chapters, today: "2026-09-05" });
    expect(huge.episodes.map((entry) => entry.date)).toEqual(["2026-09-04"]);
    expect(huge.next).toBeNull();
    const late = releaseSchedule({ data: { "release-every": 7, "release-start": "9999-12-20" }, chapters, today: "9999-12-21" });
    expect(late.episodes.map((entry) => entry.date)).toEqual(["9999-12-20", "9999-12-27"]);
    expect(late.next).toMatchObject({ episode: 2, date: "9999-12-27" });
    expect(releaseSchedule({ data: { "release-every": 7, "release-start": "9999-12-20" }, chapters, today: "9999-12-28" }).next).toBeNull();
  });

  test("before release-start the first episode is next", () => {
    expect(releaseSchedule({ data, chapters, today: "2026-08-01" }).next).toMatchObject({ episode: 1, daysUntil: 34 });
    expect(releaseSchedule({ data, chapters: [], today: "2026-08-01" }).next).toMatchObject({ episode: 1, chapter: null, date: "2026-09-04" });
  });

  describe("a monthly cadence", () => {
    const five = [1, 2, 3, 4, 5].map((number) => episode(`chapter-0${number}`, "", true));
    const dates = (every, start, list = five) => releaseSchedule({ data: { "release-every": every, "release-start": start }, chapters: list, today: "2026-01-01" }).episodes.map((entry) => entry.date);

    test("releases on the start's day each month, or the month's last day when it is shorter", () => {
      expect(dates("1 month", "2026-09-04")).toEqual(["2026-09-04", "2026-10-04", "2026-11-04", "2026-12-04", "2027-01-04"]);
      // Each month counts from release-start, so a clamped month does not pull the later ones back.
      expect(dates("1 month", "2027-01-31")).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
      expect(dates("1 month", "2026-08-30")).toEqual(["2026-08-30", "2026-09-30", "2026-10-30", "2026-11-30", "2026-12-30"]);
      expect(dates("2 months", "2026-12-31")).toEqual(["2026-12-31", "2027-02-28", "2027-04-30", "2027-06-30", "2027-08-31"]);
      expect(dates("12 months", "2027-03-15")).toEqual(["2027-03-15", "2028-03-15", "2029-03-15", "2030-03-15", "2031-03-15"]);
    });

    test("releases on 29 February in a leap year", () => {
      expect(dates("1 month", "2028-01-31").slice(0, 3)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
      expect(dates("1 month", "2028-01-29").slice(0, 3)).toEqual(["2028-01-29", "2028-02-29", "2028-03-29"]);
      // A leap day start falls back to 28 February in a common year, and returns on 29 February in the next leap year.
      expect(dates("12 months", "2028-02-29")).toEqual(["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
      // Century years are leap years only every 400 years.
      expect(dates("1 month", "2100-01-31").slice(1, 2)).toEqual(["2100-02-28"]);
      expect(dates("1 month", "2000-01-31").slice(1, 2)).toEqual(["2000-02-29"]);
    });

    test("reads month and months in any case, and reports the unit", () => {
      const release = releaseSchedule({ data: { "release-every": " 2 Months ", "release-start": "2026-09-04" }, chapters, today: "2026-09-05" });
      expect(release).toMatchObject({ every: 2, unit: "month", start: "2026-09-04", warnDays: 3, next: { episode: 2, date: "2026-11-04", daysUntil: 60 } });
      expect(releaseSchedule({ data, chapters, today: "2026-09-05" })).toMatchObject({ every: 7, unit: "day" });
      expect(releaseSchedule({ data: {}, chapters: [episode("chapter-01", "2026-09-04", true)], today: "2026-09-05" })).toMatchObject({ every: null, unit: null, warnDays: 3 });
      // Other units and zero months schedule nothing from the cadence; validate reports them.
      for (const every of ["1 week", "month", "0 months", "1.5 months", 7.5, true]) {
        expect(releaseSchedule({ data: { "release-every": every, "release-start": "2026-09-04" }, chapters, today: "2026-09-05" })).toBeNull();
      }
    });

    test("finds the next release and the due episodes on clamped days", () => {
      const monthly = { "release-every": "1 month", "release-start": "2027-01-31" };
      const three = [episode("chapter-01", "", true), episode("chapter-02", "", true), episode("chapter-03", "", false)];
      // 2027-02-28 is episode 2's day: next on the day itself, and the day after it is episode 3.
      expect(releaseSchedule({ data: monthly, chapters: three, today: "2027-02-28" }).next).toMatchObject({ episode: 2, date: "2027-02-28", daysUntil: 0 });
      expect(releaseSchedule({ data: monthly, chapters: three, today: "2027-03-01" }).next).toMatchObject({ episode: 3, date: "2027-03-31", daysUntil: 30 });
      expect(releaseSchedule({ data: monthly, chapters: three, today: "2027-03-27" }).warnings).toEqual([]);
      expect(messages(releaseSchedule({ data: monthly, chapters: three, today: "2027-03-28" }).warnings)).toEqual(["chapters/chapter-03.md (episode 3) releases 2027-03-31, in 3 days, and has no prose yet"]);

      // Past the last chapter, the projected episodes stay on the clamped days.
      const late = releaseSchedule({ data: monthly, chapters: three, today: "2027-06-28" });
      expect(late.next).toMatchObject({ episode: 6, chapter: null, date: "2027-06-30", daysUntil: 2 });
      expect(messages(late.warnings)).toEqual([
        "chapters/chapter-03.md (episode 3) was due 2027-03-31, 89 days ago, and has no prose yet",
        "episode 4 was due 2027-04-30, 59 days ago, and has no chapter yet (and 2 more scheduled episodes after it)"
      ]);
      // A day earlier, episode 6 on 2027-06-30 is still more than 3 days away.
      expect(releaseSchedule({ data: monthly, chapters: three, today: "2027-06-26" }).warnings.at(-1).message).toBe("episode 4 was due 2027-04-30, 57 days ago, and has no chapter yet (and 1 more scheduled episode after it)");
      // Before release-start, episode 1 is next.
      expect(releaseSchedule({ data: monthly, chapters: [], today: "2026-12-31" }).next).toMatchObject({ episode: 1, chapter: null, date: "2027-01-31", daysUntil: 31 });
    });

    test("keeps the complete story rules: the cadence stops at the last chapter", () => {
      const monthly = { "release-every": "1 month", "release-start": "2027-01-31", status: "complete" };
      const three = [episode("chapter-01", "", true), episode("chapter-02", "", true), episode("chapter-03", "", true)];
      const before = releaseSchedule({ data: monthly, chapters: three, today: "2027-03-01" });
      expect(before).toMatchObject({ unit: "month", complete: true, last: 3, next: { episode: 3, date: "2027-03-31" }, warnings: [] });
      expect(formatNextRelease(before)).toBe("Next release: episode 3 (chapter-03) on 2027-03-31, in 30 days (drafted, the last episode)");
      const after = releaseSchedule({ data: monthly, chapters: three, today: "2027-06-28" });
      expect(after).toMatchObject({ last: 3, next: null, warnings: [] });
      expect(formatNextRelease(after)).toBe("Next release: none, the story is complete; episode 3 (chapter-03) on 2027-03-31 was the last");
    });

    test("schedules nothing past 9999-12-31", () => {
      const late = releaseSchedule({ data: { "release-every": "1 month", "release-start": "9999-10-31" }, chapters: five, today: "9999-12-01" });
      expect(late.episodes.map((entry) => entry.date)).toEqual(["9999-10-31", "9999-11-30", "9999-12-31"]);
      expect(late.next).toMatchObject({ episode: 3, date: "9999-12-31" });
      expect(releaseSchedule({ data: { "release-every": "1 month", "release-start": "9999-10-31" }, chapters: [], today: "9999-12-31" }).next).toMatchObject({ episode: 3, chapter: null, date: "9999-12-31" });
      const huge = releaseSchedule({ data: { "release-every": "100000 months", "release-start": "2026-09-04" }, chapters, today: "2026-09-05" });
      expect(huge.episodes.map((entry) => entry.date)).toEqual(["2026-09-04"]);
      expect(huge.next).toBeNull();
    });
  });

  describe("release-warn-days", () => {
    test("sets how many days ahead an undrafted episode is warned about", () => {
      const wide = { ...data, "release-warn-days": 5 };
      expect(releaseSchedule({ data: wide, chapters, today: "2026-09-12" }).warnings).toEqual([]);
      expect(messages(releaseSchedule({ data: wide, chapters, today: "2026-09-13" }).warnings)).toEqual(["chapters/chapter-03.md (episode 3) releases 2026-09-18, in 5 days, and has no prose yet"]);
      expect(releaseSchedule({ data: wide, chapters, today: "2026-09-13" }).warnDays).toBe(5);
      // An episode with no chapter yet uses the same window.
      expect(messages(releaseSchedule({ data: wide, chapters: chapters.slice(0, 2), today: "2026-09-13" }).warnings)).toEqual(["episode 3 releases 2026-09-18, in 5 days, and has no chapter yet"]);
    });

    test("0 warns only from the release day, and past due episodes always", () => {
      const none = { ...data, "release-warn-days": 0 };
      expect(releaseSchedule({ data: none, chapters, today: "2026-09-17" }).warnings).toEqual([]);
      expect(releaseSchedule({ data: none, chapters: chapters.slice(0, 2), today: "2026-09-17" }).warnings).toEqual([]);
      expect(messages(releaseSchedule({ data: none, chapters, today: "2026-09-18" }).warnings)).toEqual(["chapters/chapter-03.md (episode 3) releases today (2026-09-18) and has no prose yet"]);
      expect(messages(releaseSchedule({ data: none, chapters: chapters.slice(0, 2), today: "2026-09-26" }).warnings)).toEqual(["episode 3 was due 2026-09-18, 8 days ago, and has no chapter yet (and 1 more scheduled episode after it)"]);
    });

    test("an invalid value falls back to 3 days, and a window past 9999-12-31 counts only real days", () => {
      for (const days of [-1, 2.5, "5"]) {
        const release = releaseSchedule({ data: { ...data, "release-warn-days": days }, chapters, today: "2026-09-14" });
        expect(release.warnDays).toBe(3);
        expect(release.warnings).toEqual([]);
      }
      const far = releaseSchedule({ data: { "release-every": 7, "release-start": "9999-12-01", "release-warn-days": 1000000 }, chapters: chapters.slice(0, 1), today: "9999-12-02" });
      expect(messages(far.warnings)).toEqual(["episode 2 releases 9999-12-08, in 6 days, and has no chapter yet (and 3 more scheduled episodes after it)"]);
    });

    test("works without a cadence, on release-date episodes", () => {
      const own = [episode("chapter-01", "2026-10-01", false)];
      expect(releaseSchedule({ data: { "release-warn-days": 10 }, chapters: own, today: "2026-09-20" }).warnings).toEqual([]);
      expect(messages(releaseSchedule({ data: { "release-warn-days": 10 }, chapters: own, today: "2026-09-21" }).warnings)).toEqual(["chapters/chapter-01.md (episode 1) releases 2026-10-01, in 10 days, and has no prose yet"]);
    });
  });
});

describe("release schedule in the project", () => {
  test("validate checks the fields, and accepts Gregorian release dates in a calendar book", () => {
    const { root } = serialProject();
    writeChapter(root, 2, 100, "release-date: 2026-09-12");
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(checkProjectSchema(root)).toEqual([]);

    const half = serialProject("release-every: 7");
    expect(messages(validateProject(half.root).errors)).toContain("story.md release-every needs release-start too: an episode every release-every days or months from release-start");
    expect(checkProjectSchema(half.root).join("\n")).toContain("release-start");
    const other = serialProject("release-start: 2026-09-04");
    expect(messages(validateProject(other.root).errors)).toContain("story.md release-start needs release-every too: an episode every release-every days or months from release-start");
    expect(checkProjectSchema(other.root).join("\n")).toContain("release-every");

    const bad = serialProject("release-every: 0\nrelease-start: 2026-02-30");
    writeChapter(bad.root, 1, 100, "release-date: 4 Thaw 302 AE");
    const errors = validateProject(bad.root).errors;
    expect(messages(errors)).toContain("story.md frontmatter field release-every must be at least 1");
    expect(messages(errors)).toContain("story.md release-start date must be a real YYYY-MM-DD calendar day, got 2026-02-30");
    expect(errors.find((error) => error.message.includes("release-date"))).toMatchObject({ code: "invalid-date", message: "chapters/chapter-01.md release-date date must be a real YYYY-MM-DD calendar day, got 4 Thaw 302 AE" });
    // progress reports the bad fields too, and schedules nothing from them.
    const progress = projectProgress(bad.root, { date: "2026-09-05" });
    expect(progress.ok).toBe(false);
    expect(messages(progress.errors)).toContain("chapters/chapter-01.md release-date date must be a real YYYY-MM-DD calendar day, got 4 Thaw 302 AE");
    expect(progress.release).toBeNull();

    const calendar = serialProject("release-every: 7\nrelease-start: 2026-09-04\ncalendar:\n  - month: Thaw\n    days: 30\n  - era: Age of Embers\n    abbrev: AE");
    writeChapter(calendar.root, 1, 100, "date: 3 Thaw 302 AE\nrelease-date: 2026-09-05");
    expect(messages(validateProject(calendar.root).errors)).toEqual([]);
    expect(projectProgress(calendar.root, { date: "2026-09-01" }).release.next).toMatchObject({ episode: 1, date: "2026-09-05" });
  });

  test("validate accepts a monthly cadence and release-warn-days, and the schema agrees", () => {
    for (const fields of ["release-every: 1 month\nrelease-start: 2026-01-31", "release-every: 3 Months\nrelease-start: 2026-01-31\nrelease-warn-days: 0", "release-every: 7\nrelease-start: 2026-09-04\nrelease-warn-days: 10"]) {
      const { root } = serialProject(fields);
      expect(messages(validateProject(root).errors)).toEqual([]);
      expect(validateProject(root).warnings.filter((warning) => warning.code === "near-miss-key")).toEqual([]);
      expect(checkProjectSchema(root)).toEqual([]);
    }

    const cases = [
      ["release-every: 0 months", "field-below-minimum", "story.md frontmatter field release-every must be at least 1 month"],
      ["release-every: 2 weeks", "unsupported-value", "story.md frontmatter field release-every must be a number of days, such as 7, or of months, such as 1 month, got \"2 weeks\""],
      ["release-every: 1.5 months", "unsupported-value", "story.md frontmatter field release-every must be a number of days, such as 7, or of months, such as 1 month, got \"1.5 months\""],
      ["release-every: 7.5", "unsupported-value", "story.md frontmatter field release-every must be a number of days, such as 7, or of months, such as 1 month, got 7.5"],
      ["release-every: 7\nrelease-warn-days: -1", "field-below-minimum", "story.md frontmatter field release-warn-days must be at least 0"],
      ["release-every: 7\nrelease-warn-days: soon", "field-not-integer", "story.md frontmatter field release-warn-days must be an integer"]
    ];
    for (const [fields, code, message] of cases) {
      const { root } = serialProject(`${fields}\nrelease-start: 2026-09-04`);
      const errors = validateProject(root).errors;
      expect(errors).toEqual([expect.objectContaining({ code, message })]);
      expect(checkProjectSchema(root)).not.toEqual([]);
      // progress reports the same error, and schedules nothing from a bad cadence.
      expect(messages(projectProgress(root, { date: "2026-09-05" }).errors)).toEqual([message]);
    }
    expect(projectProgress(serialProject("release-every: 2 weeks\nrelease-start: 2026-09-04").root, { date: "2026-09-05" }).release).toBeNull();
  });

  test("progress and next follow a monthly cadence and release-warn-days, in text and JSON", () => {
    const { root, cwd } = serialProject("release-every: 1 month\nrelease-start: 2027-01-31\nrelease-warn-days: 7");
    const quiet = invoke(cwd, ["progress", root, "--date", "2027-03-23"]);
    expect(quiet.out).toContain("Next release: episode 3 (chapter-03) on 2027-03-31, in 8 days (not drafted)\n");
    expect(quiet.err).not.toContain("release-undrafted");
    const text = invoke(cwd, ["next", root, "--date", "2027-03-24"]);
    expect(text.out).toContain("Next release: episode 3 (chapter-03) on 2027-03-31, in 7 days (not drafted)\n");
    expect(text.out).toContain("- [P1] Draft the scheduled episode: chapters/chapter-03.md (episode 3) releases 2027-03-31, in 7 days, and has no prose yet");

    for (const command of ["progress", "next"]) {
      const json = JSON.parse(invoke(cwd, [command, root, "--date", "2027-02-01", "--json"]).out);
      expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
      expect(json.data.release).toMatchObject({ every: 1, unit: "month", start: "2027-01-31", warnDays: 7, next: { episode: 2, date: "2027-02-28", daysUntil: 27 } });
      expect(json.data.release.episodes.map((entry) => entry.date)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    }
  });

  test("progress prints the next release and warns, in text and JSON", () => {
    const { root, cwd } = serialProject();
    const text = invoke(cwd, ["progress", root, "--date", "2026-09-16"]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("Next release: episode 3 (chapter-03) on 2026-09-18, in 2 days (not drafted)\n");
    expect(text.err).toContain("warning: chapters/chapter-03.md (episode 3) releases 2026-09-18, in 2 days, and has no prose yet [release-undrafted]");

    const json = JSON.parse(invoke(cwd, ["progress", root, "--date", "2026-09-16", "--json"]).out);
    expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
    expect(json.data.release).toMatchObject({ every: 7, start: "2026-09-04", complete: false, next: { episode: 3, chapter: "chapter-03", daysUntil: 2, drafted: false } });
    expect(json.data.release.warnings).toBeUndefined();
    expect(json.diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "release-undrafted", file: "chapters/chapter-03.md", check: "progress" })]);

    // Without a schedule the line and the JSON field stay out of the way.
    const plain = makeTempDir();
    const { root: plainRoot } = createStoryProject({ cwd: plain, title: "Plain Story", force: false });
    expect(invoke(plain, ["progress", plainRoot]).out).not.toContain("Next release");
    expect(projectProgress(plainRoot, {}).release).toBeNull();
  });

  describe("a complete serial", () => {
    function completeSerial(storyFields) {
      const project = serialProject(storyFields);
      const storyPath = path.join(project.root, "story.md");
      fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^status: .*$/m, "status: complete"), "utf8");
      return project;
    }

    test("next marks the last episode before it goes out, in text and JSON", () => {
      const { root, cwd } = completeSerial();
      writeChapter(root, 3, 100, "");
      const line = "Next release: episode 3 (chapter-03) on 2026-09-18, in 2 days (drafted, the last episode)\n";
      expect(invoke(cwd, ["progress", root, "--date", "2026-09-16"]).out).toContain(line);
      expect(invoke(cwd, ["next", root, "--date", "2026-09-16"]).out).toContain(line);
      const json = JSON.parse(invoke(cwd, ["next", root, "--date", "2026-09-16", "--json"]).out);
      expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
      expect(json.data.release).toMatchObject({ every: 7, complete: true, last: 3, next: { episode: 3, chapter: "chapter-03", file: "chapters/chapter-03.md", daysUntil: 2, drafted: true } });
    });

    test("schedules no episode past its last chapter, in progress, next, and JSON", () => {
      const { root, cwd } = completeSerial();
      writeChapter(root, 3, 100, "");
      const ended = "Next release: none, the story is complete; episode 3 (chapter-03) on 2026-09-18 was the last\n";
      const progress = invoke(cwd, ["progress", root, "--date", "2026-10-06"]);
      expect(progress.code).toBe(0);
      expect(progress.out).toContain(ended);
      expect(progress.err).not.toContain("release-undrafted");
      const json = JSON.parse(invoke(cwd, ["progress", root, "--date", "2026-10-06", "--json"]).out);
      expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
      expect(json.data.release).toMatchObject({ every: 7, complete: true, last: 3, next: null });
      expect(json.data.release.episodes.map((entry) => entry.episode)).toEqual([1, 2, 3]);
      expect(json.diagnostics.some((entry) => entry.code === "release-undrafted")).toBe(false);

      const next = invoke(cwd, ["next", root, "--date", "2026-10-06"]);
      expect(next.out).toContain(ended);
      expect(next.out).not.toContain("Draft the scheduled episode");
      const nextJson = JSON.parse(invoke(cwd, ["next", root, "--date", "2026-10-06", "--json"]).out);
      expect(validateAgainstSchema(nextJson, resultSchema)).toEqual([]);
      expect(nextJson.data.release).toMatchObject({ complete: true, last: 3, next: null });
      expect(nextJson.diagnostics.some((entry) => entry.code === "release-undrafted")).toBe(false);
    });

    test("with release dates and no cadence, names the last episode only once every chapter has one", () => {
      const { root, cwd } = completeSerial("season-goal: Find the owner of every bag");
      writeChapter(root, 1, 100, "release-date: 2026-09-04");
      writeChapter(root, 3, 100, "release-date: 2026-09-18");
      const partial = JSON.parse(invoke(cwd, ["next", root, "--date", "2026-09-12", "--json"]).out);
      expect(validateAgainstSchema(partial, resultSchema)).toEqual([]);
      expect(partial.data.release).toMatchObject({ every: null, start: null, complete: true, last: null, next: { episode: 3, chapter: "chapter-03" } });
      expect(invoke(cwd, ["progress", root, "--date", "2026-09-20"]).out).toContain("Next release: none scheduled after today\n");

      writeChapter(root, 2, 100, "release-date: 2026-09-11");
      const json = JSON.parse(invoke(cwd, ["next", root, "--date", "2026-09-12", "--json"]).out);
      expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
      expect(json.data.release).toMatchObject({ every: null, start: null, complete: true, last: 3, next: { episode: 3, chapter: "chapter-03" } });
      expect(invoke(cwd, ["next", root, "--date", "2026-09-12"]).out).toContain("Next release: episode 3 (chapter-03) on 2026-09-18, in 6 days (drafted, the last episode)\n");
      expect(invoke(cwd, ["progress", root, "--date", "2026-09-20"]).out).toContain("Next release: none, the story is complete; episode 3 (chapter-03) on 2026-09-18 was the last\n");
    });

    test("next still turns a due undrafted chapter into a P1 action", () => {
      const { root, cwd } = completeSerial();
      const text = invoke(cwd, ["next", root, "--date", "2026-09-16"]);
      expect(text.out).toContain("Next release: episode 3 (chapter-03) on 2026-09-18, in 2 days (not drafted, the last episode)\n");
      expect(text.out).toContain("- [P1] Draft the scheduled episode: chapters/chapter-03.md (episode 3) releases 2026-09-18, in 2 days, and has no prose yet: draft it under ## Chapter Text, then run story wordcount ");
      const json = JSON.parse(invoke(cwd, ["next", root, "--date", "2026-09-16", "--json"]).out);
      expect(json.diagnostics.filter((entry) => entry.code === "release-undrafted")).toEqual([expect.objectContaining({ severity: "warning", file: "chapters/chapter-03.md", check: "next" })]);
    });
  });

  test("story.md severity can turn the warning off or into an error", () => {
    const off = serialProject("release-every: 7\nrelease-start: 2026-09-04\nseverity:\n  - warning: release-undrafted\n    level: off");
    const result = invoke(off.cwd, ["progress", off.root, "--date", "2026-09-16"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("dismissed: chapters/chapter-03.md (episode 3)");
    expect(invoke(off.cwd, ["next", off.root, "--date", "2026-09-16"]).out).not.toContain("Draft the scheduled episode");

    const error = serialProject("release-every: 7\nrelease-start: 2026-09-04\nseverity:\n  - warning: release-undrafted\n    level: error");
    expect(invoke(error.cwd, ["progress", error.root, "--date", "2026-09-16"]).code).toBe(1);
  });

  test("next shows the next release and a P1 action, with --date and --json", () => {
    const { root, cwd } = serialProject();
    const text = invoke(cwd, ["next", root, "--date", "2026-09-19"]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("Next release: episode 4 on 2026-09-25, in 6 days (no chapter yet)\n\nActions:\n");
    expect(text.out).toContain(`- [P1] Draft the scheduled episode: chapters/chapter-03.md (episode 3) was due 2026-09-18, 1 day ago, and has no prose yet: draft it under ## Chapter Text, then run story wordcount `);

    const json = JSON.parse(invoke(cwd, ["next", root, "--date", "2026-09-19", "--json"]).out);
    expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
    expect(json.ok).toBe(true);
    expect(json.data.release.next).toMatchObject({ episode: 4, chapter: null });
    expect(json.data.releaseFindings).toBeUndefined();
    expect(json.diagnostics.filter((entry) => entry.code === "release-undrafted")).toEqual([expect.objectContaining({ severity: "warning", check: "next" })]);

    expect(projectActions(root, { date: "2026-09-05" }).actions.some((entry) => entry.title === "Draft the scheduled episode")).toBe(false);
    const bad = invoke(cwd, ["next", root, "--date", "2026-02-30"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("next --date date must be a real YYYY-MM-DD calendar day, got 2026-02-30");
  });

  test("doctor leaves the schedule to next", () => {
    const { root, cwd } = serialProject();
    const doctor = invoke(cwd, ["doctor", root]);
    expect(doctor.out).not.toContain("Draft the scheduled episode");
    const json = JSON.parse(invoke(cwd, ["doctor", root, "--json"]).out);
    expect(json.data.release).toBeUndefined();
    expect(json.data.releaseFindings).toBeUndefined();
    expect(json.diagnostics.some((entry) => entry.code === "release-undrafted")).toBe(false);
  });

  test("next --date cannot be a cli-defaults entry", () => {
    const { root } = serialProject("release-every: 7\nrelease-start: 2026-09-04\ncli-defaults:\n  - command: next\n    date: 2026-08-01");
    expect(messages(validateProject(root).errors).join("\n")).toContain("sets date, which names one target and cannot be a default");
  });
});

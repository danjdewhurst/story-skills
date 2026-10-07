import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { dayHours, dayLengthKnown, parseCalendar, parseCalendarDate } from "../src/calendar.js";
import { chapterChronology } from "../src/chronology.js";
import { runCli } from "../src/cli.js";
import { parseClockTime, parseStoryDate, storyDateError, storyTimeError } from "../src/continuity.js";
import { checkProjectContinuity, createStoryProject, scanProject, storyTimeline, validateProject } from "../src/story.js";
import { checkProjectSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

const repoRoot = path.join(import.meta.dir, "..");

// Four 30-day months and a 2-day festival: a 122-day year. Six weekdays.
const CALENDAR = [
  { month: "Thaw", days: 30 },
  { month: "Bloom", days: 30 },
  { month: "High Sun", days: 30 },
  { month: "Ashfall", days: 30 },
  { month: "Embertide", days: 2 },
  { weekdays: ["Hearthday", "Stoneday", "Rootday", "Windday", "Flameday", "Ashday"], "first-weekday": "Stoneday" },
  { era: "Before the Wells", abbrev: "BW", direction: "backward" },
  { era: "Age of Kings", abbrev: "AK", years: 300 },
  { era: "Age of Embers", abbrev: "AE" }
];

const CALENDAR_YAML = `calendar:
  - month: Thaw
    days: 30
  - month: Bloom
    days: 30
  - month: High Sun
    days: 30
  - month: Ashfall
    days: 30
  - month: Embertide
    days: 2
  - weekdays: [Hearthday, Stoneday, Rootday, Windday, Flameday, Ashday]
    first-weekday: Stoneday
  - era: Before the Wells
    abbrev: BW
    direction: backward
  - era: Age of Kings
    abbrev: AK
    years: 300
  - era: Age of Embers
    abbrev: AE
`;

function calendar() {
  const parsed = parseCalendar(CALENDAR);
  expect(parsed.problems).toEqual([]);
  return parsed.calendar;
}

function days(text) {
  const parsed = parseCalendarDate(text, calendar());
  expect(parsed.problem).toBeUndefined();
  return parsed.days;
}

function problem(text) {
  return parseCalendarDate(text, calendar()).problem;
}

describe("custom calendar dates (#407)", () => {
  test("named, ordinal, and numeric forms read the same day", () => {
    const expected = days("3 Thaw 12 AE");
    expect(days("3rd of Thaw, 12 AE")).toBe(expected);
    expect(days("  3   thaw 12 ae ")).toBe(expected);
    expect(days("3 Thaw 12 Age of Embers")).toBe(expected);
    expect(days("12-01-03 AE")).toBe(expected);
    expect(days("12-1-3 AE")).toBe(expected);
    // No era: the last era, the present one.
    expect(days("3 Thaw 12")).toBe(expected);
    expect(days("12-01-03")).toBe(expected);
    // Multi-word month names.
    expect(days("1 High Sun 1 AK")).toBe(60);
  });

  test("days count through months, years, and eras", () => {
    expect(days("1 Thaw 1 AK")).toBe(0);
    expect(days("2 Embertide 1 AK")).toBe(121);
    expect(days("1 Thaw 2 AK")).toBe(122);
    // The Age of Kings lasts 300 years, then the Age of Embers begins.
    expect(days("1 Thaw 1 AE")).toBe(300 * 122);
    expect(days("2 Embertide 300 AK")).toBe(300 * 122 - 1);
    // A backward era counts down to the first forward era: 1 BW is the
    // year before 1 AK, and 2 BW the year before that.
    expect(days("2 Embertide 1 BW")).toBe(-1);
    expect(days("1 Thaw 1 BW")).toBe(-122);
    expect(days("1 Thaw 2 BW")).toBe(-244);
  });

  test("a stated weekday must be the right one", () => {
    // first-weekday: Stoneday names the weekday of 1 Thaw 1 AK.
    expect(days("Stoneday, 1 Thaw 1 AK")).toBe(0);
    expect(days("rootday 2 Thaw 1 AK")).toBe(1);
    expect(days("Hearthday 1-01-06 AK")).toBe(5);
    expect(problem("Hearthday, 1 Thaw 1 AK")).toBe("that day is a Stoneday, not a Hearthday");
    // Weekdays carry on backward across year 1.
    expect(days("Hearthday, 2 Embertide 1 BW")).toBe(-1);
  });

  test("impossible days are explained", () => {
    expect(problem("31 Thaw 12 AE")).toBe("Thaw has 30 days, not 31");
    expect(problem("0 Thaw 12 AE")).toBe("Thaw has 30 days, not 0");
    expect(problem("3 Thw 12 AE")).toMatch(/^it names no calendar month \(Thaw, Bloom, High Sun, Ashfall, Embertide\)$/);
    expect(problem("3 Thaw 12 XX")).toBe("XX is not one of the calendar's eras (BW, AK, AE)");
    expect(problem("3 Thaw 301 AK")).toBe("Age of Kings lasts 300 years, not 301");
    expect(problem("3 Thaw 0 AE")).toBe("years start at 1");
    expect(problem("3 Thaw")).toBe("the month must be followed by a year, such as 3 Thaw 301 AE");
    expect(problem("12-06-01 AE")).toBe("month 06 is not one of the calendar's 5 months");
    expect(problem("Thaw the third")).toMatch(/^write it as day, month, and year/);
  });

  test("ordinal suffixes must fit the day", () => {
    expect(days("1st Thaw 12")).toBe(days("1 Thaw 12"));
    expect(days("2nd Thaw 12")).toBe(days("2 Thaw 12"));
    expect(days("11th Thaw 12")).toBe(days("11 Thaw 12"));
    expect(days("12th Thaw 12")).toBe(days("12 Thaw 12"));
    expect(days("13th Thaw 12")).toBe(days("13 Thaw 12"));
    expect(days("21st Thaw 12")).toBe(days("21 Thaw 12"));
    expect(days("23RD of Thaw 12")).toBe(days("23 Thaw 12"));
    expect(problem("1th Thaw 12")).toBe("write 1st, not 1th");
    expect(problem("3nd Thaw 12")).toBe("write 3rd, not 3nd");
    expect(problem("12nd Thaw 12")).toBe("write 12th, not 12nd");
  });

  test("a month may be called Of", () => {
    const odd = parseCalendar([{ month: "Thaw", days: 10 }, { month: "Of", days: 10 }]).calendar;
    expect(parseCalendarDate("3 of 1", odd).days).toBe(12);
    expect(parseCalendarDate("3 of Of 1", odd).days).toBe(12);
    expect(parseCalendarDate("3 of Thaw 1", odd).days).toBe(2);
  });

  test("days too large to count exactly are refused", () => {
    expect(parseCalendar([{ month: "Thaw", days: 2 ** 53 }]).problems).toEqual([`entry 1 days must be a whole number 1 or more, got ${2 ** 53}`]);
    expect(problem("3 Thaw 99999999999999999999 AE")).toBe("the year is too far from year 1 to count its days");
    expect(problem(`3 Thaw ${"9".repeat(400)} AE`)).toBe("the year is too far from year 1 to count its days");
  });

  test("the documented examples read as documented", () => {
    const ember = scanProject(path.join(repoRoot, "examples", "the-last-ember")).calendar;
    const read = (text) => parseStoryDate(text, ember)?.days;
    const expected = read("3 Thaw 302 AE");
    for (const text of ["3rd of Thaw, 302 Age of Embers", "302-02-03 AE", "3 Thaw 302", "Rootday, 3 Thaw 302 AE"]) {
      expect(read(text)).toBe(expected);
    }
    expect(read("1 Frostwane 1 AE") - read("6 Embertide 1 BW")).toBe(1);
    // skills/worldbuilding/references/calendars.md
    const vell = parseCalendar([
      ...["Thaw", "Sowing", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Frost"].map((month) => ({ month, days: 30 })),
      { month: "Hollow Days", days: 5 },
      { weekdays: ["Firstday", "Seconday", "Midweek", "Fourthday", "Fifthday", "Restday"], "first-weekday": "Midweek" },
      { era: "Before the Founding", abbrev: "BF", direction: "backward" },
      { era: "After the Founding", abbrev: "AF" }
    ]).calendar;
    const vellDays = parseCalendarDate("3 Thaw 412 AF", vell).days;
    for (const text of ["3rd of Thaw, 412 After the Founding", "412-01-03 AF", "3 Thaw 412", "Seconday, 3 Thaw 412 AF"]) {
      expect(parseCalendarDate(text, vell).days).toBe(vellDays);
    }
  });

  test("a calendar without eras takes a bare year", () => {
    const plain = parseCalendar([{ month: "Thaw", days: 10 }, { month: "Bloom", days: 10 }]).calendar;
    expect(parseCalendarDate("1 Bloom 2", plain).days).toBe(30);
    expect(parseCalendarDate("1 Bloom 2 AE", plain).problem).toBe("the calendar has no eras, so AE is not one");
  });

  test("calendar problems are listed", () => {
    const problems = (value) => parseCalendar(value).problems;
    expect(problems(undefined)).toEqual([]);
    expect(problems("Thaw")).toEqual(["must be a list of month, era, weekdays, and hours-per-day entries"]);
    expect(problems([])).toEqual(["needs at least one month entry, such as - month: Thaw then days: 30"]);
    expect(problems([{ month: "Thaw" }])).toEqual(["entry 1 month Thaw needs days, such as days: 30"]);
    expect(problems([{ month: "Thaw", days: 0 }])).toEqual(["entry 1 days must be a whole number 1 or more, got 0"]);
    expect(problems([{ month: "3rd", days: 3 }])).toEqual(["entry 1 month must be a name that does not start with a digit and has no comma, got 3rd"]);
    expect(problems([{ month: "Thaw", days: 3 }, { month: "thaw", days: 3 }])).toEqual(["month thaw appears more than once"]);
    expect(problems([{ month: "Thaw", days: 3, era: "Old" }])).toEqual(["entry 1 must name exactly one of month, era, weekdays, or hours-per-day, not month and era"]);
    expect(problems([{ month: "Thaw", days: 3 }, { days: 3 }])).toEqual(["entry 2 must name exactly one of month, era, weekdays, or hours-per-day"]);
    expect(problems([{ month: "Thaw", days: 3 }, { era: "Old", direction: "sideways" }])).toEqual(["entry 2 direction must be forward or backward, got sideways"]);
    expect(problems([{ month: "Thaw", days: 3 }, { era: "Old" }, { era: "New" }])).toEqual(["era Old needs years, the number of years it lasts, since another era follows it"]);
    expect(problems([{ month: "Thaw", days: 3 }, { era: "Old", years: 9 }, { era: "Back", direction: "backward" }])).toEqual(["era Back counts backward, but only the first era may"]);
    expect(problems([{ month: "Thaw", days: 3 }, { era: "Old", abbrev: "O", years: 9 }, { era: "o" }])).toEqual(["era name or abbrev o appears more than once"]);
    expect(problems([{ month: "Thaw", days: 3 }, { weekdays: ["One"], "first-weekday": "Two" }])).toEqual(["entry 2 first-weekday must be one of the weekdays (One), got Two"]);
    expect(problems([{ month: "Thaw", days: 3 }, { weekdays: ["One"] }, { weekdays: ["Two"] }])).toEqual(["entry 3 repeats weekdays; list them all in one entry"]);
    expect(problems([{ month: "Thaw", days: 3 }, { weekdays: [] }])).toEqual(["entry 2 weekdays needs at least one name"]);
    expect(problems([{ month: "Thaw", days: 3 }, { weekdays: "One" }])).toEqual(["entry 2 weekdays must be a list of names that do not start with a digit and have no comma, such as [Hearthday, Stoneday]"]);
    expect(problems([{ month: "Thaw", days: 3 }, { weekdays: ["One"], "first-weekday": 1 }])).toEqual(["entry 2 first-weekday must be text, got 1"]);
    expect(problems([{ month: "Thaw", days: 3 }, "Bloom"])).toEqual(["entry 2 must be a month, era, weekdays, or hours-per-day entry, such as - month: Thaw then days: 30"]);
  });

  test("without a calendar, dates read as before", () => {
    for (const value of ["2024-02-29", "2023-02-29", "2024-13-45", "Midwinter", "3 Thaw 12 AE", "", undefined]) {
      expect(storyDateError(value, { freeText: true, calendar: null })).toBe(storyDateError(value, { freeText: true }));
      expect(storyDateError(value, { calendar: null })).toBe(storyDateError(value));
      expect(parseStoryDate(String(value ?? ""), null)).toEqual(parseStoryDate(String(value ?? "")));
    }
    expect(storyDateError("2023-02-29", { freeText: true })).toBe("date must be a real YYYY-MM-DD calendar day, got 2023-02-29");
  });

  test("with a calendar, calendar-shaped dates must be real and other text stays free", () => {
    const cal = calendar();
    expect(storyDateError("3 Thaw 12 AE", { freeText: true, calendar: cal })).toBe("");
    expect(storyDateError("31 Thaw 12 AE", { freeText: true, calendar: cal })).toBe("date 31 Thaw 12 AE is not a day of the story calendar: Thaw has 30 days, not 31");
    expect(storyDateError("Ashday 3 Thaw 12 AE", { freeText: true, calendar: cal })).toMatch(/^date Ashday 3 Thaw 12 AE is not a day of the story calendar: that day is a/);
    // A YYYY-MM-DD date is read under the calendar too.
    expect(storyDateError("2024-03-14", { freeText: true, calendar: cal })).toBe("");
    expect(storyDateError("2024-07-14", { freeText: true, calendar: cal })).toBe("date 2024-07-14 is not a day of the story calendar: month 07 is not one of the calendar's 5 months");
    expect(storyDateError("the night of the fire", { freeText: true, calendar: cal })).toBe("");
    // story add takes no free text.
    expect(storyDateError("the night of the fire", { calendar: cal })).toMatch(/^date the night of the fire is not a day of the story calendar: write it as day, month, and year/);
    expect(storyDateError("3 Thaw 12", { calendar: { invalid: true } })).toBe("date cannot be read until the story.md calendar is fixed (see story validate)");
    expect(storyDateError("3 Thaw 12", { freeText: true, calendar: { invalid: true } })).toBe("");
  });
});

function calendarProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Ember Clock", force: false });
  const storyPath = path.join(root, "story.md");
  const story = fs.readFileSync(storyPath, "utf8");
  fs.writeFileSync(storyPath, story.replace(/\n---\n/, `\n${CALENDAR_YAML}---\n`), "utf8");
  for (const [id, hours] of [["the-vale", 30], ["the-citadel", 30]]) {
    const to = id === "the-vale" ? "the-citadel" : "the-vale";
    writeMarkdown(path.join(root, "worldbuilding", "locations", `${id}.md`), `
name: ${id}
type: place
routes:
  - to: ${to}
    hours: ${hours}
`, `# ${id}\n`);
  }
  writeMarkdown(path.join(root, "characters", "sera.md"), "name: Sera\nrole: protagonist\nstatus: alive\n", "# Sera\n");
  for (const number of [1, 2, 3]) {
    writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 0
`, "## Chapter Text\n\nWords here.\n");
  }
  return root;
}

function writeScene(root, chapter, frontmatter) {
  writeMarkdown(path.join(root, "scenes", `chapter-0${chapter}-scene-01.md`), `
title: Scene ${chapter}
chapter: chapter-0${chapter}
scene: 1
status: draft
pov: sera
characters:
  - sera
${frontmatter.trim()}
`, "## Scene Text\n\nWords here.\n");
}

function writeChapterTime(root, number, time) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 0
time: "${time}"
`, "## Chapter Text\n\nWords here.\n");
}

function codes(findings) {
  return findings.map((finding) => finding.code);
}

describe("calendar dates in a project (#407)", () => {
  test("validate checks the calendar and calendar-shaped dates", () => {
    const root = calendarProject();
    writeScene(root, 1, "date: 31 Thaw 12 AE\nlocation: the-vale");
    writeScene(root, 2, "date: the night of the fire\nlocation: the-vale");
    const result = validateProject(root);
    expect(messages(result.errors.filter((error) => error.code === "invalid-date"))).toEqual([
      "scenes/chapter-01-scene-01.md date 31 Thaw 12 AE is not a day of the story calendar: Thaw has 30 days, not 31"
    ]);
    const continuity = checkProjectContinuity(root);
    expect(messages(continuity.warnings.filter((warning) => warning.code === "malformed-date"))).toEqual([
      "scenes/chapter-01-scene-01.md has malformed date \"31 Thaw 12 AE\"",
      "scenes/chapter-02-scene-01.md has malformed date \"the night of the fire\""
    ]);
  });

  test("an invalid calendar is one error, not a warning per date", () => {
    const root = calendarProject();
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("    days: 2\n", "    days: none\n"), "utf8");
    writeScene(root, 1, "date: 3 Thaw 12 AE");
    expect(messages(validateProject(root).errors)).toEqual(["story.md calendar entry 5 days must be a whole number 1 or more, got none"]);
    expect(codes(checkProjectContinuity(root).warnings)).not.toContain("malformed-date");
  });

  test("clock, travel, and route checks compare calendar days", () => {
    const root = calendarProject();
    // Chapter 2 runs backward across the era boundary; chapter 3 crosses
    // a 30-hour route in 25 hours.
    writeScene(root, 1, "date: 1 Thaw 1 AE\ntime: 08:00\nlocation: the-vale");
    writeScene(root, 2, "date: 2 Embertide 300 AK\ntime: 09:00\nlocation: the-vale");
    writeScene(root, 3, "date: Rootday, 2 Thaw 1 AE\ntime: 09:00\nlocation: the-citadel\ntravel-hours: 30");
    expect(validateProject(root).errors).toEqual([]);
    const result = checkProjectContinuity(root);
    expect(codes(result.warnings)).toContain("clock-backward");
    // Chapter 3 is the day after chapter 1's 08:00, across the era change.
    expect(messages(result.errors)).toEqual([
      "scenes/chapter-03-scene-01.md allows only 25h for travel of 30h",
      "scenes/chapter-03-scene-01.md puts sera at the-citadel 25h after scenes/chapter-01-scene-01.md at the-vale, but the fastest route takes 30h"
    ]);
  });

  test("timeline and chronology order chapters by calendar day", () => {
    const root = calendarProject();
    writeScene(root, 1, "date: 1 Thaw 1 AE");
    writeScene(root, 2, "date: 5 Bloom 3 BW");
    writeScene(root, 3, "date: 20 Ashfall 299 AK");
    const timeline = storyTimeline(root);
    expect(timeline.chronology.map((entry) => entry.date)).toEqual(["5 Bloom 3 BW", "20 Ashfall 299 AK", "1 Thaw 1 AE"]);
    const chronology = chapterChronology(scanProject(root));
    expect(chronology.after("chapter-01", "chapter-03")).toBe(true);
    expect(chronology.after("chapter-03", "chapter-02")).toBe(true);
    expect(chronology.after("chapter-02", "chapter-01")).toBe(false);
  });

  test("story add takes a calendar date and rejects a wrong one", () => {
    const root = calendarProject();
    const io = memoryIo(root);
    expect(runCli(["add", "scene", "Arrival", "--chapter", "chapter-01", "--date", "4 Thaw 12 AE"], io)).toBe(0);
    expect(fs.readFileSync(path.join(root, "scenes", "chapter-01-scene-01.md"), "utf8")).toContain("date: 4 Thaw 12 AE");
    const bad = memoryIo(root);
    expect(runCli(["add", "chapter", "Late", "--date", "40 Thaw 12 AE"], bad)).not.toBe(0);
    expect(bad.error()).toContain("Thaw has 30 days, not 40");
  });

  test("the-last-ember example reads its calendar", () => {
    const project = scanProject(path.join(repoRoot, "examples", "the-last-ember"));
    expect(project.calendar.months).toHaveLength(13);
    expect(parseStoryDate("3 Thaw 302 AE", project.calendar).days).toBe(301 * 366 + 30 + 2);
  });
});

describe("calendar hours per day (#533)", () => {
  const MONTHS = [{ month: "Thaw", days: 30 }, { month: "Bloom", days: 30 }];

  // The test calendar with an hours-per-day entry after the eras.
  function dayProject(hours) {
    const root = calendarProject();
    setDayHours(root, hours);
    return root;
  }

  function setDayHours(root, hours) {
    const storyPath = path.join(root, "story.md");
    const story = fs.readFileSync(storyPath, "utf8").replace(/ {2}- hours-per-day: .*\n/, "");
    fs.writeFileSync(storyPath, story.replace("    abbrev: AE\n", `    abbrev: AE\n  - hours-per-day: ${hours}\n`), "utf8");
  }

  test("hours-per-day sets the length of the day, 24 when unset", () => {
    expect(dayHours(null)).toBe(24);
    expect(dayHours(parseCalendar(MONTHS).calendar)).toBe(24);
    expect(dayHours(parseCalendar([...MONTHS, { "hours-per-day": 30 }]).calendar)).toBe(30);
    expect(dayHours(parseCalendar([{ "hours-per-day": 1 }, ...MONTHS]).calendar)).toBe(1);
    expect(dayHours(parseCalendar([...MONTHS, { "hours-per-day": 100 }]).calendar)).toBe(100);
    // An invalid calendar keeps a valid hours-per-day, so its times still read.
    expect(dayHours(parseCalendar([{ month: "Thaw" }, { "hours-per-day": 30 }]).calendar)).toBe(30);
    expect(dayHours(parseCalendar([{ month: "Thaw" }, { "hours-per-day": 0 }]).calendar)).toBe(24);
    expect(dayHours(parseCalendar("Thaw").calendar)).toBe(24);
  });

  test("an hours-per-day that cannot be read leaves the day's length unknown", () => {
    const known = (value) => dayLengthKnown(parseCalendar(value).calendar);
    expect(dayLengthKnown(null)).toBe(true);
    expect(known(MONTHS)).toBe(true);
    expect(known([...MONTHS, { "hours-per-day": 30 }])).toBe(true);
    // Invalid elsewhere, but its one hours-per-day is clean.
    expect(known([{ month: "Thaw" }, { "hours-per-day": 30 }])).toBe(true);
    expect(known("Thaw")).toBe(true);
    expect(known([...MONTHS, { "hours-per-day": "30" }])).toBe(false);
    expect(known([...MONTHS, { "hours-per-day": 101 }])).toBe(false);
    expect(known([...MONTHS, { "hours-per-day": 30 }, { "hours-per-day": 26 }])).toBe(false);
    expect(known([{ month: "Thaw", days: 30, "hours-per-day": 30 }])).toBe(false);
    expect(known({ "hours-per-day": 30 })).toBe(false);
  });

  test("hours-per-day problems are listed", () => {
    const problems = (...entries) => parseCalendar([...MONTHS, ...entries]).problems;
    for (const bad of [0, -3, 101, 2.5, "30", true]) {
      expect(problems({ "hours-per-day": bad })).toEqual([`entry 3 hours-per-day must be a whole number from 1 to 100, got ${bad}`]);
    }
    expect(problems({ "hours-per-day": 30 }, { "hours-per-day": 30 })).toEqual(["entry 4 repeats hours-per-day; give it once"]);
    expect(problems({ month: "Ash", days: 3, "hours-per-day": 30 })).toEqual(["entry 3 must name exactly one of month, era, weekdays, or hours-per-day, not month and hours-per-day"]);
    // The day's length alone is not a calendar.
    expect(parseCalendar([{ "hours-per-day": 30 }]).problems).toEqual(["needs at least one month entry, such as - month: Thaw then days: 30"]);
  });

  test("a time's hour must be below hours-per-day", () => {
    expect(parseClockTime("23:59")).toBe(1439);
    expect(parseClockTime("24:00")).toBeUndefined();
    expect(parseClockTime("25:30", 30)).toBe(1530);
    expect(parseClockTime("29:59", 30)).toBe(1799);
    expect(parseClockTime("30:00", 30)).toBeUndefined();
    expect(parseClockTime("11:59", 12)).toBe(719);
    expect(parseClockTime("12:00", 12)).toBeUndefined();
    expect(parseClockTime("99:59", 100)).toBe(5999);
    // Named times keep their share of the day: dawn is 05:00 of 24 hours.
    expect(parseClockTime("dawn")).toBe(300);
    expect(parseClockTime("dawn", 30)).toBe(375);
    expect(parseClockTime("night", 12)).toBe(690);
    // 300 * 25 / 24 is 312.5 minutes, which rounds to 05:13.
    expect(parseClockTime("dawn", 25)).toBe(313);
    expect(parseClockTime("morning", 25)).toBe(438);

    const thirty = parseCalendar([...MONTHS, { "hours-per-day": 30 }]).calendar;
    expect(storyTimeError("27:15", { calendar: thirty })).toBe("");
    expect(storyTimeError("30:00", { calendar: thirty })).toBe("time must be HH:MM from 00:00 to 29:59 (the story calendar's 30-hour day) or a named part of day (dawn, morning, midday, afternoon, evening, night), got 30:00");
    expect(storyTimeError("24:00", { calendar: calendar() })).toBe("time must be HH:MM or a named part of day (dawn, morning, midday, afternoon, evening, night), got 24:00");
    expect(storyTimeError("24:00")).toBe(storyTimeError("24:00", { calendar: calendar() }));
  });

  test("validate and the schema agree on hours-per-day", () => {
    const root = calendarProject();
    for (const [hours, schemaError] of [
      [30, null],
      [1, null],
      [100, null],
      [0, "$.story.calendar[9].hours-per-day: 0 is below the minimum 1"],
      [101, "$.story.calendar[9].hours-per-day: 101 is above the maximum 100"],
      [2.5, "$.story.calendar[9].hours-per-day: expected integer, got number"]
    ]) {
      setDayHours(root, hours);
      const errors = validateProject(root).errors.filter((error) => error.code === "invalid-calendar");
      expect(messages(errors)).toEqual(schemaError === null ? [] : [`story.md calendar entry 10 hours-per-day must be a whole number from 1 to 100, got ${hours}`]);
      expect(checkProjectSchema(root)).toEqual(schemaError === null ? [] : [schemaError]);
    }
  });

  test("clock, travel, and route checks roll over on the calendar's day", () => {
    // Chapter 1 sets out at 08:00; chapter 2 arrives after a 30-hour route
    // at 09:00 the next day, and chapter 3 is later that day.
    const root = dayProject(30);
    writeScene(root, 1, "date: 1 Thaw 1 AE\ntime: \"08:00\"\nlocation: the-vale");
    writeScene(root, 2, "date: 2 Thaw 1 AE\ntime: \"09:00\"\nlocation: the-citadel\ntravel-hours: 30");
    writeScene(root, 3, "date: 2 Thaw 1 AE\ntime: \"27:00\"\nlocation: the-citadel");
    writeChapterTime(root, 1, "26:30");
    expect(validateProject(root).errors).toEqual([]);
    // A 30-hour day leaves 31 hours for the journey.
    let result = checkProjectContinuity(root);
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).not.toContain("malformed-time");
    expect(codes(result.warnings)).not.toContain("clock-backward");

    // A 26-hour day leaves 27, and has no 27:00.
    setDayHours(root, 26);
    result = checkProjectContinuity(root);
    expect(messages(result.errors)).toEqual([
      "scenes/chapter-02-scene-01.md allows only 27h for travel of 30h",
      "scenes/chapter-02-scene-01.md puts sera at the-citadel 27h after scenes/chapter-01-scene-01.md at the-vale, but the fastest route takes 30h"
    ]);
    expect(messages(result.warnings.filter((warning) => warning.code === "malformed-time"))).toEqual([
      "scenes/chapter-03-scene-01.md has malformed time \"27:00\" (the story calendar's 26-hour day runs 00:00 to 25:59)",
      "Chapter 1 has malformed time \"26:30\" (the story calendar's 26-hour day runs 00:00 to 25:59)"
    ]);
  });

  test("travel-hours reads exact times past 23:59", () => {
    // 25:00 on day 1 to 12:00 on day 3 of a 30-hour day is 5 + 30 + 12 hours.
    const root = dayProject(30);
    writeScene(root, 1, "date: 1 Thaw 1 AE\ntime: \"25:00\"\nlocation: the-vale");
    writeScene(root, 2, "date: 3 Thaw 1 AE\ntime: \"12:00\"\nlocation: the-citadel\ntravel-hours: 50");
    expect(messages(checkProjectContinuity(root).errors)).toEqual([
      "scenes/chapter-02-scene-01.md allows only 47h for travel of 50h"
    ]);
  });

  test("an untimed scene and a named time end on the day's last minute", () => {
    const backward = (root) => messages(checkProjectContinuity(root).warnings.filter((warning) => warning.code === "clock-backward"));
    // An untimed scene could be at 29:59, so it does not run backward
    // after 28:00 the same day.
    const thirty = dayProject(30);
    writeScene(thirty, 1, "date: 1 Thaw 1 AE\ntime: \"28:00\"");
    writeScene(thirty, 2, "date: 1 Thaw 1 AE");
    expect(backward(thirty)).toEqual([]);
    // night starts at 25:00 of 30 hours, so 24:00 cannot follow it.
    writeScene(thirty, 1, "date: 1 Thaw 1 AE\ntime: night");
    writeScene(thirty, 2, "date: 1 Thaw 1 AE\ntime: \"24:00\"");
    expect(backward(thirty)).toEqual(["scenes/chapter-02-scene-01.md timestamp runs backward"]);
    // night ends at 11:59 of 12 hours, before 00:00 the next day.
    const twelve = dayProject(12);
    writeScene(twelve, 1, "date: 2 Thaw 1 AE\ntime: \"00:00\"");
    writeScene(twelve, 2, "date: 1 Thaw 1 AE\ntime: night");
    expect(backward(twelve)).toEqual(["scenes/chapter-02-scene-01.md timestamp runs backward"]);
  });

  test("an unreadable hours-per-day is one error, not a warning per time", () => {
    const root = dayProject("\"30\"");
    writeScene(root, 1, "date: 1 Thaw 1 AE\ntime: \"27:00\"");
    writeScene(root, 2, "date: 1 Thaw 1 AE\ntime: noonish");
    expect(messages(validateProject(root).errors)).toEqual(["story.md calendar entry 10 hours-per-day must be a whole number from 1 to 100, got 30"]);
    // Any HH:MM could be on the day the writer meant; other text is not.
    expect(messages(checkProjectContinuity(root).warnings.filter((warning) => warning.code === "malformed-time"))).toEqual([
      "scenes/chapter-02-scene-01.md has malformed time \"noonish\""
    ]);
    const io = memoryIo(root);
    expect(runCli(["add", "chapter", "Late", "--time", "27:00"], io)).not.toBe(0);
    expect(io.error()).toContain("time cannot be read until the story.md calendar's hours-per-day is fixed (see story validate)");
    const noon = memoryIo(root);
    expect(runCli(["add", "chapter", "Noon", "--time", "noonish"], noon)).not.toBe(0);
    expect(noon.error()).toContain("time must be HH:MM or a named part of day");
    expect(runCli(["add", "chapter", "Dawn", "--time", "dawn"], memoryIo(root))).toBe(0);
  });

  test("named times keep their share of a longer day", () => {
    const root = dayProject(30);
    writeScene(root, 1, "date: 1 Thaw 1 AE\ntime: night");
    writeScene(root, 2, "date: 1 Thaw 1 AE\ntime: \"27:00\"");
    writeScene(root, 3, "date: 1 Thaw 1 AE\ntime: evening");
    // evening sorts at 19:00 of 24 hours, 23:45 of 30; night at 23:00, 28:45.
    expect(storyTimeline(root).chronology.map((entry) => entry.time)).toEqual(["evening", "27:00", "night"]);
    // night spans 25:00 to 29:59 and evening 21:15 to 27:29, so neither
    // 27:00 after night nor evening after 27:00 runs backward; dawn, 05:00
    // to 08:44, does.
    const backward = () => messages(checkProjectContinuity(root).warnings.filter((warning) => warning.code === "clock-backward"));
    expect(backward()).toEqual([]);
    writeScene(root, 3, "date: 1 Thaw 1 AE\ntime: dawn");
    expect(backward()).toEqual(["scenes/chapter-03-scene-01.md timestamp runs backward"]);
  });

  test("story add reads --time on the calendar's day", () => {
    const root = dayProject(30);
    expect(runCli(["add", "scene", "Late Watch", "--chapter", "chapter-01", "--time", "29:30"], memoryIo(root))).toBe(0);
    expect(fs.readFileSync(path.join(root, "scenes", "chapter-01-scene-01.md"), "utf8")).toContain("time: \"29:30\"");
    const bad = memoryIo(root);
    expect(runCli(["add", "chapter", "Too Late", "--time", "30:00"], bad)).not.toBe(0);
    expect(bad.error()).toContain("time must be HH:MM from 00:00 to 29:59 (the story calendar's 30-hour day)");
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { parseCalendar, parseCalendarDate } from "../src/calendar.js";
import { chapterChronology } from "../src/chronology.js";
import { runCli } from "../src/cli.js";
import { parseStoryDate, storyDateError } from "../src/continuity.js";
import { checkProjectContinuity, createStoryProject, scanProject, storyTimeline, validateProject } from "../src/story.js";
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

  test("a calendar without eras takes a bare year", () => {
    const plain = parseCalendar([{ month: "Thaw", days: 10 }, { month: "Bloom", days: 10 }]).calendar;
    expect(parseCalendarDate("1 Bloom 2", plain).days).toBe(30);
    expect(parseCalendarDate("1 Bloom 2 AE", plain).problem).toBe("the calendar has no eras, so AE is not one");
  });

  test("calendar problems are listed", () => {
    const problems = (value) => parseCalendar(value).problems;
    expect(problems(undefined)).toEqual([]);
    expect(problems("Thaw")).toEqual(["must be a list of month, era, and weekdays entries"]);
    expect(problems([])).toEqual(["needs at least one month entry, such as - month: Thaw then days: 30"]);
    expect(problems([{ month: "Thaw" }])).toEqual(["entry 1 month Thaw needs days, such as days: 30"]);
    expect(problems([{ month: "Thaw", days: 0 }])).toEqual(["entry 1 days must be a whole number 1 or more, got 0"]);
    expect(problems([{ month: "3rd", days: 3 }])).toEqual(["entry 1 month must be a name that does not start with a digit and has no comma, got 3rd"]);
    expect(problems([{ month: "Thaw", days: 3 }, { month: "thaw", days: 3 }])).toEqual(["month thaw appears more than once"]);
    expect(problems([{ month: "Thaw", days: 3, era: "Old" }])).toEqual(["entry 1 must name exactly one of month, era, or weekdays, not month and era"]);
    expect(problems([{ month: "Thaw", days: 3 }, { days: 3 }])).toEqual(["entry 2 must name exactly one of month, era, or weekdays"]);
    expect(problems([{ month: "Thaw", days: 3 }, { era: "Old", direction: "sideways" }])).toEqual(["entry 2 direction must be forward or backward, got sideways"]);
    expect(problems([{ month: "Thaw", days: 3 }, { era: "Old" }, { era: "New" }])).toEqual(["era Old needs years, the number of years it lasts, since another era follows it"]);
    expect(problems([{ month: "Thaw", days: 3 }, { era: "Old", years: 9 }, { era: "Back", direction: "backward" }])).toEqual(["era Back counts backward, but only the first era may"]);
    expect(problems([{ month: "Thaw", days: 3 }, { era: "Old", abbrev: "O", years: 9 }, { era: "o" }])).toEqual(["era name or abbrev o appears more than once"]);
    expect(problems([{ month: "Thaw", days: 3 }, { weekdays: ["One"], "first-weekday": "Two" }])).toEqual(["entry 2 first-weekday must be one of the weekdays (One), got Two"]);
    expect(problems([{ month: "Thaw", days: 3 }, { weekdays: ["One"] }, { weekdays: ["Two"] }])).toEqual(["entry 3 repeats weekdays; list them all in one entry"]);
    expect(problems([{ month: "Thaw", days: 3 }, { weekdays: [] }])).toEqual(["entry 2 weekdays needs at least one name"]);
    expect(problems([{ month: "Thaw", days: 3 }, { weekdays: "One" }])).toEqual(["entry 2 weekdays must be a list of names that do not start with a digit and have no comma, such as [Hearthday, Stoneday]"]);
    expect(problems([{ month: "Thaw", days: 3 }, { weekdays: ["One"], "first-weekday": 1 }])).toEqual(["entry 2 first-weekday must be text, got 1"]);
    expect(problems([{ month: "Thaw", days: 3 }, "Bloom"])).toEqual(["entry 2 must be a month, era, or weekdays entry, such as - month: Thaw then days: 30"]);
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

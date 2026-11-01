import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { runCli } from "../src/cli.js";
import { ICS_LINE_OCTETS, escapeText, foldLine } from "../src/ics.js";
import { buildBook, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

const repoRoot = path.join(import.meta.dir, "..");

function project(storyFields, chapters = []) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Calendar Book", force: false });
  const storyPath = path.join(root, "story.md");
  // A status in storyFields replaces the template's.
  const story = fs.readFileSync(storyPath, "utf8").replace(/status: planning\n/, (line) => (/^status:/m.test(storyFields) ? "" : line));
  fs.writeFileSync(storyPath, story.replace("tense: past\n", `tense: past\n${storyFields}\n`), "utf8");
  chapters.forEach((chapter, index) => {
    const number = index + 1;
    writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: ${JSON.stringify(chapter.title ?? `Chapter ${number}`)}\nnumber: ${number}\nstatus: draft\n${chapter.extra ?? ""}`, `## Chapter Text\n\n${"word ".repeat(chapter.words ?? 100)}\n`);
  });
  return { root, cwd };
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// A small RFC 5545 reader: checks the physical lines, unfolds them, and
// splits each content line into its name, parameters, and value, with TEXT
// values unescaped. It is strict where the writer must be: every line ends
// in CRLF, is at most 75 octets, and a continuation line starts with one
// space.
function parseIcs(text) {
  expect(text.endsWith("\r\n")).toBe(true);
  const physical = text.slice(0, -2).split("\r\n");
  for (const line of physical) {
    expect(line.includes("\n") || line.includes("\r")).toBe(false);
    expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(ICS_LINE_OCTETS);
  }
  const logical = [];
  for (const line of physical) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      expect(logical.length).toBeGreaterThan(0);
      logical[logical.length - 1] += line.slice(1);
    } else {
      logical.push(line);
    }
  }
  // One VCALENDAR holding only VEVENTs, no property given twice in a
  // component, and the properties RFC 5545 requires in each.
  expect(logical[0]).toBe("BEGIN:VCALENDAR");
  expect(logical[logical.length - 1]).toBe("END:VCALENDAR");
  const events = [];
  const calendar = {};
  let current = null;
  for (const line of logical.slice(1, -1)) {
    const colon = line.indexOf(":");
    expect(colon).toBeGreaterThan(0);
    const [name, ...params] = line.slice(0, colon).split(";");
    const raw = line.slice(colon + 1);
    if (name === "BEGIN") {
      expect(raw).toBe("VEVENT");
      expect(current).toBeNull();
      current = {};
      continue;
    }
    if (name === "END") {
      expect(raw).toBe("VEVENT");
      expect(current).not.toBeNull();
      for (const required of ["UID", "DTSTAMP", "DTSTART", "SUMMARY"]) {
        expect(current[required], required).toBeDefined();
      }
      events.push(current);
      current = null;
      continue;
    }
    const target = current ?? calendar;
    expect(target[name], `${name} given twice`).toBeUndefined();
    target[name] = { params, raw, text: unescape(raw) };
  }
  expect(current).toBeNull();
  expect(calendar.VERSION.raw).toBe("2.0");
  expect(calendar.PRODID).toBeDefined();
  return { calendar, events, logical };
}

function unescape(raw) {
  let out = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== "\\") {
      // A bare comma or semicolon in TEXT would be a list separator.
      out += char;
      continue;
    }
    index += 1;
    const next = raw[index];
    if (next === "n" || next === "N") {
      out += "\n";
    } else if (next === "\\" || next === ";" || next === ",") {
      out += next;
    } else {
      throw new Error(`Bad escape \\${next} in ${raw}`);
    }
  }
  return out;
}

function readCalendar(root) {
  return fs.readFileSync(path.join(root, "dist", "calendar-book.ics"), "utf8");
}

function buildCalendar(root) {
  return fs.readFileSync(buildBook(root, { format: "ics" }).outFile, "utf8");
}

const resultSchema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

const savedEpoch = process.env.SOURCE_DATE_EPOCH;
afterEach(() => {
  setSystemTime();
  if (savedEpoch === undefined) {
    delete process.env.SOURCE_DATE_EPOCH;
  } else {
    process.env.SOURCE_DATE_EPOCH = savedEpoch;
  }
});

describe("escapeText and foldLine", () => {
  test("escape backslashes, semicolons, commas, and line breaks, and drop control characters", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf\rg\u0007h")).toBe("a\\\\b\\;c\\,d\\ne\\nf\\ng h");
    // Separators a lax reader could split a line on become spaces too.
    expect(escapeText("a\u2028b\u2029c\u0085d")).toBe("a b c d");
  });

  test("leave a short line alone and fold a long one at 75 octets with a space", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
    const folded = foldLine(`DESCRIPTION:${"x".repeat(200)}`).split("\r\n");
    expect(folded[0].length).toBe(75);
    expect(folded.slice(1).every((line) => line.startsWith(" ") && line.length <= 75)).toBe(true);
    expect(folded.map((line, index) => (index === 0 ? line : line.slice(1))).join("")).toBe(`DESCRIPTION:${"x".repeat(200)}`);
  });

  test("never split a multibyte character or an escape across a fold", () => {
    // 74 ASCII octets, then a four-octet emoji that cannot fit on the line.
    expect(foldLine(`${"a".repeat(74)}\u{1F600}b`)).toBe(`${"a".repeat(74)}\r\n \u{1F600}b`);
    expect(foldLine(`${"a".repeat(74)}\\,b`)).toBe(`${"a".repeat(74)}\r\n \\,b`);
    for (const line of foldLine(`X:${"é\\;".repeat(80)}`).split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
      expect(line.endsWith("\\")).toBe(false);
    }
  });
});

describe("build --format ics", () => {
  test("puts the serial example's release dates and daily target in a calendar", () => {
    const cwd = makeTempDir();
    const root = path.join(cwd, "serial");
    fs.cpSync(path.join(repoRoot, "examples", "the-left-luggage-office"), root, { recursive: true });
    const result = buildBook(root, { format: "ics" });
    expect(result.outFile).toBe(path.join(root, "dist", "the-left-luggage-office.ics"));
    expect(result.events).toBe(5);
    expect(result.warnings).toEqual([]);
    const { calendar, events } = parseIcs(fs.readFileSync(result.outFile, "utf8"));
    expect(calendar.VERSION.raw).toBe("2.0");
    expect(calendar["X-WR-CALNAME"].text).toBe("The Left Luggage Office");
    expect(events.map((event) => event.UID.raw)).toEqual([
      "daily-target.the-left-luggage-office@story-skills",
      "episode-1.the-left-luggage-office@story-skills",
      "episode-2.the-left-luggage-office@story-skills",
      "episode-3.the-left-luggage-office@story-skills",
      "episode-4.the-left-luggage-office@story-skills"
    ]);
    expect(events.map((event) => event.DTSTART.raw)).toEqual(["20260904", "20260904", "20260911", "20260918", "20260925"]);
    expect(events.every((event) => event.DTSTART.params.join(";") === "VALUE=DATE" && event.DTEND.params.join(";") === "VALUE=DATE")).toBe(true);
    expect(events[0].RRULE.raw).toBe("FREQ=WEEKLY;BYDAY=MO,TU,TH,FR");
    expect(events[0].SUMMARY.text).toBe("Write 500 words: The Left Luggage Office");
    expect(events[0].DESCRIPTION.text).toBe("The daily target for The Left Luggage Office: 500 words on Mondays, Tuesdays, Thursdays, and Fridays.");
    expect(events[1].DESCRIPTION.text).toBe("The Left Luggage Office, episode 1. Chapter: Ticket 4417 (chapter-01).");
    // Episode 4 is on the cadence after the last chapter.
    expect(events[4].DESCRIPTION.text).toBe("The Left Luggage Office, episode 4. No chapter is written for it yet.");
  });

  test("is byte-identical from build to build, on any day, and DTSTAMP follows SOURCE_DATE_EPOCH", () => {
    const { root } = project("deadline: 2027-03-01\ntarget-words: 90000\ndaily-target-words: 500\nrelease-every: 7\nrelease-start: 2026-09-04", [{}]);
    delete process.env.SOURCE_DATE_EPOCH;
    setSystemTime(new Date("2026-09-01T10:00:00Z"));
    const first = buildCalendar(root);
    setSystemTime(new Date("2027-01-15T23:30:00Z"));
    expect(buildCalendar(root)).toBe(first);
    setSystemTime();
    // No version in PRODID, so a release does not change every calendar.
    expect(parseIcs(first).calendar.PRODID.raw).toBe("-//Story Skills//story build --format ics//EN");
    expect(parseIcs(first).events[0].DTSTAMP.raw).toBe("20000101T000000Z");
    process.env.SOURCE_DATE_EPOCH = "1767225600";
    buildBook(root, { format: "ics" });
    expect(parseIcs(readCalendar(root)).events[0].DTSTAMP.raw).toBe("20260101T000000Z");
  });

  test("gives the deadline with the target, and the daily target from the first session until it", () => {
    const { root } = project("deadline: 2027-03-01\ntarget-words: 90000\ndaily-target-words: 1250\nwriting-days: [wed, sat]", [{ words: 200 }]);
    // 2026-11-02 is a Monday, so the first writing day is Wednesday 4 November.
    fs.writeFileSync(path.join(root, "progress.md"), "---\ntype: progress-log\nsessions:\n  - date: 2026-11-05\n    words: 300\n  - date: 2026-11-02\n    words: 100\n---\n\n# Progress Log\n", "utf8");
    expect(messages(validateProject(root).errors)).toEqual([]);
    const { events } = parseIcs(buildCalendar(root));
    expect(events.map((event) => [event.UID.raw, event.DTSTART.raw, event.DTEND.raw])).toEqual([
      ["daily-target.calendar-book@story-skills", "20261104", "20261105"],
      ["deadline.calendar-book@story-skills", "20270301", "20270302"]
    ]);
    expect(events[0].RRULE.raw).toBe("FREQ=WEEKLY;BYDAY=WE,SA;UNTIL=20270301");
    expect(events[0].DESCRIPTION.text).toBe("The daily target for Calendar Book: 1,250 words on Wednesdays and Saturdays, until the deadline on 2027-03-01.");
    expect(events[1].SUMMARY.text).toBe("Deadline: Calendar Book");
    expect(events[1].DESCRIPTION.text).toBe("The deadline for Calendar Book. Target: 90,000 words.");
    expect(events.every((event) => event.TRANSP.raw === "TRANSPARENT")).toBe(true);
  });

  test("writes every day without writing-days, and leaves out a target that starts after the deadline", () => {
    const daily = project("daily-target-words: 400\nrelease-every: 1 month\nrelease-start: 2027-01-31", [{}, {}]);
    const { events } = parseIcs(buildCalendar(daily.root));
    expect(events[0].RRULE.raw).toBe("FREQ=DAILY");
    expect(events[0].DTSTART.raw).toBe("20270131");
    // A monthly cadence from the 31st goes out on the last day of a shorter month.
    expect(events.slice(1).map((event) => event.DTSTART.raw)).toEqual(["20270131", "20270228", "20270331"]);

    const late = project("deadline: 2026-01-01\ndaily-target-words: 400\nrelease-every: 7\nrelease-start: 2026-06-01", [{}]);
    const uids = parseIcs(buildCalendar(late.root)).events.map((event) => event.UID.raw);
    expect(uids).toEqual(["deadline.calendar-book@story-skills", "episode-1.calendar-book@story-skills", "episode-2.calendar-book@story-skills"]);
  });

  test("the daily target starts on the earliest anchor, and same-day events keep episodes first", () => {
    // Chapter 1 goes out before release-start; the deadline shares a day with episode 2.
    const { root } = project("deadline: 2026-09-11\ndaily-target-words: 400\nrelease-every: 7\nrelease-start: 2026-09-04", [{ extra: "release-date: 2026-08-01\n" }, {}, { extra: "release-date: 2026-12-24\n" }]);
    const { events } = parseIcs(buildCalendar(root));
    expect(events.map((event) => [event.UID.raw.split(".")[0], event.DTSTART.raw])).toEqual([
      ["daily-target", "20260801"],
      ["episode-1", "20260801"],
      ["episode-2", "20260911"],
      ["deadline", "20260911"],
      // Episode 4, projected after the last chapter, still comes before episode 3's own date.
      ["episode-4", "20260925"],
      ["episode-3", "20261224"]
    ]);
  });

  test("the release dates are the ones story next reports", () => {
    const cwd = makeTempDir();
    const root = path.join(cwd, "serial");
    fs.cpSync(path.join(repoRoot, "examples", "the-left-luggage-office"), root, { recursive: true });
    const next = JSON.parse(invoke(cwd, ["next", root, "--date", "2026-09-01", "--json"]).out).data.release;
    const { events } = parseIcs(buildCalendar(root));
    const episodes = events.filter((event) => event.UID.raw.startsWith("episode-"));
    const dates = [...next.episodes, next.next].map((episode) => episode.date.replace(/-/g, ""));
    expect(episodes.slice(0, next.episodes.length).map((event) => event.DTSTART.raw)).toEqual(dates.slice(0, -1));
    // On 2026-09-01 the next release is episode 1; the calendar also projects
    // the episode after the last chapter.
    expect(episodes[episodes.length - 1].UID.raw).toBe(`episode-${next.episodes.length + 1}.the-left-luggage-office@story-skills`);
  });

  test("a book counted in characters names characters", () => {
    const { root } = project("count-unit: characters\ndeadline: 2027-03-01\ntarget-characters: 120000\ndaily-target-characters: 2000");
    const result = buildBook(root, { format: "ics" });
    expect(result.warnings.map((warning) => warning.message)).toEqual(["story.md daily-target-characters is left out of the calendar: it has no first day. Log a session with story progress --log, or set release-start, and build again"]);
    const { events } = parseIcs(readCalendar(root));
    expect(events[0].DESCRIPTION.text).toBe("The deadline for Calendar Book. Target: 120,000 characters.");
    fs.writeFileSync(path.join(root, "progress.md"), "---\ntype: progress-log\nsessions:\n  - date: 2026-11-02\n    words: 0\n    characters: 0\n---\n\n# Progress Log\n", "utf8");
    expect(parseIcs(buildCalendar(root)).events[0].SUMMARY.text).toBe("Write 2,000 characters: Calendar Book");
  });

  test("a complete story has no projected episode and no daily target", () => {
    const { root } = project("status: complete\ndaily-target-words: 400\nrelease-every: 7\nrelease-start: 2026-09-04", [{}, { extra: "release-date: 2026-12-24\n" }]);
    const { events } = parseIcs(buildCalendar(root));
    expect(events.map((event) => [event.UID.raw, event.DTSTART.raw])).toEqual([
      ["episode-1.calendar-book@story-skills", "20260904"],
      ["episode-2.calendar-book@story-skills", "20261224"]
    ]);
  });

  test("escapes and folds titles so a calendar reads them back unchanged", () => {
    const title = "Salt, Pepper; and a Back\\slash: the very long chapter title that runs past one line, \u{1F30A} and on";
    const { root } = project("release-every: 7\nrelease-start: 2026-09-04\nstatus: complete", [{ title }]);
    const text = buildCalendar(root);
    const { events, logical } = parseIcs(text);
    expect(events[0].DESCRIPTION.text).toBe(`Calendar Book, episode 1. Chapter: ${title} (chapter-01).`);
    expect(events[0].DESCRIPTION.raw).toContain("Salt\\, Pepper\\; and a Back\\\\slash: ");
    // The description is longer than a line, so it is folded.
    expect(logical.find((line) => line.startsWith("DESCRIPTION:")).length).toBeGreaterThan(75);
    expect(text.split("\r\n").some((line) => line.startsWith(" "))).toBe(true);
    expect(text.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  test("warns when the daily target has no first day, and builds the rest", () => {
    const { root } = project("deadline: 2027-03-01\ndaily-target-words: 500");
    const result = buildBook(root, { format: "ics" });
    expect(result.warnings.map((warning) => warning.code)).toEqual(["ics-daily-target-left-out"]);
    expect(parseIcs(readCalendar(root)).events.map((event) => event.UID.raw)).toEqual(["deadline.calendar-book@story-skills"]);
  });

  test("a release-start alone anchors the daily target, and a start after the deadline warns", () => {
    const anchored = project("deadline: 2026-06-01\ndaily-target-words: 1\nrelease-start: 2026-02-01");
    const result = buildBook(anchored.root, { format: "ics" });
    expect(result.warnings.map((warning) => warning.code)).toEqual([]);
    const { events } = parseIcs(readCalendar(anchored.root));
    expect(events[0].DTSTART.raw).toBe("20260201");
    expect(events[0].SUMMARY.text).toBe("Write 1 word: Calendar Book");

    const late = project("deadline: 2026-01-01\ndaily-target-words: 500\nrelease-every: 7\nrelease-start: 2026-02-01", [{}]);
    const warnings = buildBook(late.root, { format: "ics" }).warnings;
    expect(warnings.map((warning) => [warning.code, warning.message])).toEqual([["ics-daily-target-left-out", "story.md daily-target-words is left out of the calendar: its first writing day is after the deadline (2026-01-01)"]]);

    // Friday 4 September, with Mondays only: the first writing day, the 7th, is past a deadline on the 5th.
    const moved = project("deadline: 2026-09-05\ndaily-target-words: 400\nwriting-days: [mon]\nrelease-start: 2026-09-04");
    expect(buildBook(moved.root, { format: "ics" }).warnings.map((warning) => warning.code)).toEqual(["ics-daily-target-left-out"]);

    // With no deadline, a first writing day past 9999-12-31 cannot be written.
    const end = project("daily-target-words: 400\nwriting-days: [mon]\nrelease-every: 7\nrelease-start: 9999-12-31", [{}]);
    expect(buildBook(end.root, { format: "ics" }).warnings.map((warning) => warning.message)).toEqual(["story.md daily-target-words is left out of the calendar: its first writing day is after 9999-12-31, the last day a calendar date can name"]);
    expect(readCalendar(end.root)).not.toContain("+0");

    // A first writing day on the deadline gives one occurrence.
    const same = project("deadline: 2026-09-07\ndaily-target-words: 400\nwriting-days: [mon]\nrelease-start: 2026-09-04");
    const daily = parseIcs(buildCalendar(same.root)).events[0];
    expect([daily.DTSTART.raw, daily.RRULE.raw]).toEqual(["20260907", "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260907"]);
  });

  test("an event on 9999-12-31 has no DTEND, since the next day cannot be written", () => {
    const { root } = project("deadline: 9999-12-31\ntarget-words: 1");
    const text = buildCalendar(root);
    const { events } = parseIcs(text);
    expect(events[0].DTSTART.raw).toBe("99991231");
    expect(events[0].DTEND).toBeUndefined();
    expect(events[0].DESCRIPTION.text).toBe("The deadline for Calendar Book. Target: 1 word.");
    expect(text).not.toContain("+0");
  });

  test("with only a daily target and no first day, the refusal says why", () => {
    const { root, cwd } = project("daily-target-words: 300");
    const { code, err } = invoke(cwd, ["build", root, "--format", "ics"]);
    expect(code).toBe(3);
    expect(err).toContain("Cannot build ics: the calendar would have no events. story.md daily-target-words is left out of the calendar: it has no first day. Log a session with story progress --log");
  });

  test("refuses a calendar with no events, exiting 3", () => {
    const { root, cwd } = project("");
    const { code, err } = invoke(cwd, ["build", root, "--format", "ics"]);
    expect(code).toBe(3);
    expect(err).toContain("Cannot build ics: the calendar would have no events");
    expect(fs.existsSync(path.join(root, "dist", "calendar-book.ics"))).toBe(false);
  });

  test("the CLI reports the events, and --dry-run writes nothing", () => {
    const { root, cwd } = project("deadline: 2027-03-01");
    const preview = invoke(cwd, ["build", root, "--format", "ics", "--dry-run"]);
    expect(preview.code).toBe(0);
    expect(fs.existsSync(path.join(root, "dist", "calendar-book.ics"))).toBe(false);
    const built = invoke(cwd, ["build", root, "--format", "ICS"]);
    expect(built.code).toBe(0);
    expect(built.out).toBe(`Built a calendar of 1 event to ${path.join(root, "dist", "calendar-book.ics")}\n`);
    for (const argv of [["--json"], ["--dry-run", "--json"]]) {
      const json = JSON.parse(invoke(cwd, ["build", root, "--format", "ics", ...argv]).out);
      expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
      expect(json.data).toMatchObject({ format: "ics", events: 1, pages: null, pdf: false, dryRun: argv.includes("--dry-run") });
    }
    // A warning goes to stderr and the build still passes.
    fs.writeFileSync(path.join(root, "story.md"), fs.readFileSync(path.join(root, "story.md"), "utf8").replace("deadline: 2027-03-01\n", "deadline: 2027-03-01\ndaily-target-words: 9\n"), "utf8");
    const warned = invoke(cwd, ["build", root, "--format", "ics", "--json"]);
    const envelope = JSON.parse(warned.out);
    expect(validateAgainstSchema(envelope, resultSchema)).toEqual([]);
    expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["ics-daily-target-left-out"]);
    const text = invoke(cwd, ["build", root, "--format", "ics"]);
    expect(text.code).toBe(0);
    expect(text.err).toContain("[ics-daily-target-left-out]");
  });

  test("--include-pending is an error with ics, which prints no matter", () => {
    const { root } = project("deadline: 2027-03-01");
    expect(() => buildBook(root, { format: "ics", includePending: true })).toThrow("prints none");
  });
});

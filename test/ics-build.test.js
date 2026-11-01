import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
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
  const events = [];
  let calendar = {};
  let current = null;
  for (const line of logical) {
    const colon = line.indexOf(":");
    expect(colon).toBeGreaterThan(0);
    const [name, ...params] = line.slice(0, colon).split(";");
    const raw = line.slice(colon + 1);
    if (name === "BEGIN" && raw === "VEVENT") {
      current = {};
      continue;
    }
    if (name === "END" && raw === "VEVENT") {
      events.push(current);
      current = null;
      continue;
    }
    const target = current ?? calendar;
    target[name] = { params, raw, text: unescape(raw) };
  }
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

const savedEpoch = process.env.SOURCE_DATE_EPOCH;
afterEach(() => {
  if (savedEpoch === undefined) {
    delete process.env.SOURCE_DATE_EPOCH;
  } else {
    process.env.SOURCE_DATE_EPOCH = savedEpoch;
  }
});

describe("escapeText and foldLine", () => {
  test("escape backslashes, semicolons, commas, and line breaks, and drop control characters", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf\rg\u0007h")).toBe("a\\\\b\\;c\\,d\\ne\\nf\\ng h");
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

  test("is byte-identical from build to build, and DTSTAMP follows SOURCE_DATE_EPOCH", () => {
    const { root } = project("deadline: 2027-03-01\ntarget-words: 90000");
    delete process.env.SOURCE_DATE_EPOCH;
    buildBook(root, { format: "ics" });
    const first = readCalendar(root);
    buildBook(root, { format: "ics" });
    expect(readCalendar(root)).toBe(first);
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
    const { events } = parseIcs(readCalendar(root, buildBook(root, { format: "ics" })));
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
    const { events } = parseIcs(readCalendar(daily.root, buildBook(daily.root, { format: "ics" })));
    expect(events[0].RRULE.raw).toBe("FREQ=DAILY");
    expect(events[0].DTSTART.raw).toBe("20270131");
    // A monthly cadence from the 31st goes out on the last day of a shorter month.
    expect(events.slice(1).map((event) => event.DTSTART.raw)).toEqual(["20270131", "20270228", "20270331"]);

    const late = project("deadline: 2026-01-01\ndaily-target-words: 400\nrelease-every: 7\nrelease-start: 2026-06-01", [{}]);
    const uids = parseIcs(readCalendar(late.root, buildBook(late.root, { format: "ics" }))).events.map((event) => event.UID.raw);
    expect(uids).toEqual(["deadline.calendar-book@story-skills", "episode-1.calendar-book@story-skills", "episode-2.calendar-book@story-skills"]);
  });

  test("a complete story has no projected episode and no daily target", () => {
    const { root } = project("status: complete\ndaily-target-words: 400\nrelease-every: 7\nrelease-start: 2026-09-04", [{}, { extra: "release-date: 2026-12-24\n" }]);
    const { events } = parseIcs(readCalendar(root, buildBook(root, { format: "ics" })));
    expect(events.map((event) => [event.UID.raw, event.DTSTART.raw])).toEqual([
      ["episode-1.calendar-book@story-skills", "20260904"],
      ["episode-2.calendar-book@story-skills", "20261224"]
    ]);
  });

  test("escapes and folds titles so a calendar reads them back unchanged", () => {
    const title = "Salt, Pepper; and a Back\\slash: the very long chapter title that runs past one line, \u{1F30A} and on";
    const { root } = project("release-every: 7\nrelease-start: 2026-09-04\nstatus: complete", [{ title }]);
    const text = readCalendar(root, buildBook(root, { format: "ics" }));
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
    expect(result.warnings.map((warning) => warning.code)).toEqual(["ics-daily-target-unanchored"]);
    expect(parseIcs(readCalendar(root)).events.map((event) => event.UID.raw)).toEqual(["deadline.calendar-book@story-skills"]);
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
    const json = JSON.parse(invoke(cwd, ["build", root, "--format", "ics", "--json"]).out);
    expect(json.data).toMatchObject({ format: "ics", events: 1, pages: null, pdf: false });
  });

  test("--include-pending and other matter options are errors with ics", () => {
    const { root } = project("deadline: 2027-03-01");
    expect(() => buildBook(root, { format: "ics", includePending: true })).toThrow("prints none");
  });
});

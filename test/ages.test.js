import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { ageOn, formatAge, parseBorn } from "../src/ages.js";
import { parseCalendar, parseCalendarDate } from "../src/calendar.js";
import { runCli } from "../src/cli.js";
import { parseClockDate } from "../src/continuity.js";
import { parseFrontmatter, replaceFrontmatter } from "../src/frontmatter.js";
import { checkProjectContinuity, createStoryProject, seriesReport, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const CALENDAR = [
  { month: "Thaw", days: 30 },
  { month: "Bloom", days: 30 },
  { era: "Before the Wells", abbrev: "BW", direction: "backward" },
  { era: "Age of Embers", abbrev: "AE" }
];

function calendar() {
  const parsed = parseCalendar(CALENDAR);
  expect(parsed.problems).toEqual([]);
  return parsed.calendar;
}

const day = (text) => parseClockDate(text).days;
const age = (born, at, cal = null) => formatAge(ageOn(parseBorn(born, cal), cal ? parseCalendarDate(at, cal).days : day(at), cal));

// A book with dated chapters. `chapters` maps a chapter number to extra
// frontmatter (a cast, a date); `characters` maps an id to frontmatter.
function book(cwd, title, { count = 3, characters = {}, chapters = {}, story = {} } = {}) {
  const { root } = createStoryProject({ cwd, title, force: false });
  setStory(root, story);
  for (let number = 1; number <= count; number += 1) {
    writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 1
${chapters[number] ?? "characters: []"}
`, "## Chapter Text\n\nWords.\n");
  }
  for (const [id, frontmatter] of Object.entries(characters)) {
    writeMarkdown(path.join(root, "characters", `${id}.md`), `
name: ${id}
role: supporting
${/^status:/m.test(frontmatter) ? "" : "status: alive\n"}${frontmatter}
`, `# ${id}\n`);
  }
  return root;
}

function setStory(root, fields) {
  const storyPath = path.join(root, "story.md");
  const markdown = fs.readFileSync(storyPath, "utf8");
  const { data } = parseFrontmatter(markdown, storyPath);
  fs.writeFileSync(storyPath, replaceFrontmatter(markdown, { ...data, ...fields }), "utf8");
}

function codes(findings) {
  return findings.map((finding) => finding.code);
}

function run(args, cwd) {
  const io = memoryIo(cwd);
  const code = runCli(args, io);
  return { code, stdout: io.output(), stderr: io.error() };
}

describe("parseBorn", () => {
  test("reads a day or a year alone as the span the birth may fall on", () => {
    expect(parseBorn("1990-05-12")).toEqual({ text: "1990-05-12", first: day("1990-05-12"), last: day("1990-05-12") });
    expect(parseBorn(1990)).toEqual({ text: "1990", first: day("1990-01-01"), last: day("1990-12-31") });
    expect(parseBorn(undefined)).toBeNull();
    expect(parseBorn("  ")).toBeNull();
  });

  test("names the problem with a value that is not a date or a year", () => {
    expect(parseBorn("1990-02-30").problem).toBe("must be a real YYYY-MM-DD calendar day or a year, got 1990-02-30");
    expect(parseBorn("spring").problem).toBe("must be a YYYY-MM-DD day or a YYYY year, got spring");
    expect(parseBorn(["1990"]).problem).toBe("must be a date or a year, such as 1990-05-12 or 1990");
  });

  test("reads a day or a year of the story calendar", () => {
    const cal = calendar();
    expect(parseBorn("3 Bloom 270 AE", cal)).toEqual({ text: "3 Bloom 270 AE", first: parseCalendarDate("3 Bloom 270 AE", cal).days, last: parseCalendarDate("3 Bloom 270 AE", cal).days });
    expect(parseBorn("270 AE", cal)).toEqual({ text: "270 AE", first: parseCalendarDate("1 Thaw 270 AE", cal).days, last: parseCalendarDate("30 Bloom 270 AE", cal).days });
    expect(parseBorn("12 BW", cal).first).toBe(parseCalendarDate("1 Thaw 12 BW", cal).days);
    expect(parseBorn("3 Frost 270 AE", cal).problem).toBe("is not a day or a year of the story calendar: it names no calendar month (Thaw, Bloom)");
    expect(parseBorn("1990-05-12", { invalid: true })).toBeNull();
  });
});

describe("ages", () => {
  test("a birthday counts on its day", () => {
    expect(age("1990-05-12", "2026-05-11")).toBe("35");
    expect(age("1990-05-12", "2026-05-12")).toBe("36");
    expect(age("1990-05-12", "1990-05-12")).toBe("0");
  });

  test("a 29 February birthday counts on 1 March in other years", () => {
    expect(age("2000-02-29", "2001-02-28")).toBe("0");
    expect(age("2000-02-29", "2001-03-01")).toBe("1");
    expect(age("2000-02-29", "2004-02-29")).toBe("4");
  });

  test("a year alone gives a range, and a day before it is not born yet", () => {
    expect(age("1990", "2026-06-01")).toBe("35 or 36");
    expect(age("1990", "1990-06-01")).toBe("0, or not born yet");
    expect(age("1990", "1989-12-31")).toBe("not born yet");
    expect(ageOn(parseBorn("1990"), undefined)).toBeNull();
    expect(ageOn(null, day("2026-01-01"))).toBeNull();
  });

  test("ages count in the story calendar's years, across a backward era", () => {
    const cal = calendar();
    expect(age("3 Bloom 270 AE", "2 Bloom 300 AE", cal)).toBe("29");
    expect(age("3 Bloom 270 AE", "3 Bloom 300 AE", cal)).toBe("30");
    // 2 BW, 1 BW, then 1 AE: three years from 5 Thaw 2 BW to 5 Thaw 2 AE.
    expect(age("5 Thaw 2 BW", "5 Thaw 2 AE", cal)).toBe("3");
    expect(age("2 BW", "1 Thaw 1 AE", cal)).toBe("1 or 2");
  });
});

describe("story continuity birth checks", () => {
  test("reports a character listed in a chapter or scene dated before their birth", () => {
    const root = book(makeTempDir(), "Before Birth", {
      characters: { mira: "born: 2001-09-14", tomas: "born: 1990" },
      chapters: {
        1: "date: 2001-09-13\ncharacters:\n  - mira\n  - tomas",
        2: "date: 2001-09-14\ncharacters:\n  - mira",
        3: "date: 2026-02-06\ncharacters: []\nmentions:\n  - mira"
      }
    });
    writeMarkdown(path.join(root, "scenes", "chapter-03-scene-01.md"), `
title: Flashback
chapter: chapter-03
scene: 1
status: draft
date: 1999-01-01
flashback-to: chapter-01
characters:
  - mira
`, "Words.\n");
    const result = checkProjectContinuity(root);
    const before = result.errors.filter((finding) => finding.code === "appears-before-birth");
    expect(before.map((finding) => [finding.message, finding.chapter])).toEqual([
      ["chapters/chapter-01.md lists mira, who is born 2001-09-14, in a chapter dated 2001-09-13; move them to mentions or fix the dates", "chapter-01"],
      ["scenes/chapter-03-scene-01.md lists mira, who is born 2001-09-14, in a scene dated 1999-01-01; move them to mentions or fix the dates", "chapter-03"]
    ]);
  });

  test("a chapter counts from its latest date, so a birth partway through is allowed", () => {
    const root = book(makeTempDir(), "Born Today", {
      characters: { baby: "born: 2026-03-02" },
      chapters: { 1: "characters:\n  - baby" }
    });
    for (const [scene, date] of [[1, "2026-03-01"], [2, "2026-03-02"]]) {
      writeMarkdown(path.join(root, "scenes", `chapter-01-scene-0${scene}.md`), `
title: Scene ${scene}
chapter: chapter-01
scene: ${scene}
status: draft
date: ${date}
characters: []
`, "Words.\n");
    }
    expect(codes(checkProjectContinuity(root).errors)).not.toContain("appears-before-birth");
  });

  test("reports a birth after the death, and a parent born after their child", () => {
    const root = book(makeTempDir(), "Families", {
      characters: {
        elder: "born: 2010\nrelationships:\n  - character: younger\n    type: parent",
        younger: "born: 2005-04-01\nrelationships:\n  - character: elder\n    type: child",
        ghost: "status: deceased\nborn: 2030-01-01\ndied-in: chapter-02"
      },
      chapters: { 2: "date: 2026-02-06\ncharacters: []" }
    });
    const result = checkProjectContinuity(root);
    expect(result.errors.filter((finding) => ["born-after-death", "parent-born-after-child"].includes(finding.code)).map((finding) => finding.message)).toEqual([
      "characters/ghost.md is born 2030-01-01, after dying in chapter-02 (2026-02-06); fix born or the chapter's date",
      "characters/elder.md is born 2010, not before younger, their child, born 2005-04-01; fix born or the relationship"
    ]);
  });

  test("reports only what is certain, and nothing without birth dates", () => {
    const root = book(makeTempDir(), "Maybe", {
      characters: {
        parent: "born: 1990\nrelationships:\n  - character: child\n    type: parent",
        child: "born: 1990\nrelationships:\n  - character: parent\n    type: child",
        undated: "relationships: []"
      },
      chapters: { 1: "date: 1990-06-01\ncharacters:\n  - parent\n  - child\n  - undated" }
    });
    expect(codes(checkProjectContinuity(root).errors)).toEqual([]);
  });

  test("an exemption dismisses a birth error", () => {
    const root = book(makeTempDir(), "Time Travel", {
      characters: { visitor: "born: 2090-01-01" },
      chapters: { 1: "date: 2026-01-01\ncharacters:\n  - visitor" }
    });
    writeMarkdown(path.join(root, "continuity", "exemptions.md"), `
type: exemption-log
exemptions:
  - code: appears-before-birth
    chapter: chapter-01
    reason: She travels back from 2120.
`, "# Exemptions\n");
    const result = checkProjectContinuity(root);
    expect(result.ok).toBe(true);
    expect(result.dismissed.map((entry) => entry.finding.code)).toEqual(["appears-before-birth"]);
  });
});

describe("born in validate, add, and progressions", () => {
  test("validate reports a born value that is not a date or a year", () => {
    const root = book(makeTempDir(), "Bad Born", {
      characters: { mira: "born: 1990-13-01", tomas: "born: 1990", ana: "born: about thirty" }
    });
    const findings = validateProject(root).errors.filter((finding) => finding.code === "invalid-date");
    expect(findings.map((finding) => finding.message)).toEqual([
      "characters/ana.md born must be a YYYY-MM-DD day or a YYYY year, got about thirty",
      "characters/mira.md born must be a real YYYY-MM-DD calendar day or a year, got 1990-13-01"
    ]);
  });

  test("a progression cannot change born", () => {
    const root = book(makeTempDir(), "Fixed Born", {
      characters: { mira: "born: 1990\nprogressions:\n  - from: chapter-02\n    field: born\n    value: 1991" }
    });
    const finding = validateProject(root).errors.find((entry) => entry.code === "progression-fixed-field");
    expect(finding.message).toContain("cannot change born; a birth date stays the same");
  });

  test("story add character --born writes the date, and refuses one that is not a date", () => {
    const root = book(makeTempDir(), "Add Born");
    expect(run(["add", "character", "Mira Holt", "--born", "2001-09-14", "--path", root], root).code).toBe(0);
    const { data } = parseFrontmatter(fs.readFileSync(path.join(root, "characters", "mira-holt.md"), "utf8"));
    expect(String(data.born)).toBe("2001-09-14");
    const refused = run(["add", "character", "Tomas", "--born", "next spring", "--path", root], root);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("born must be a YYYY-MM-DD day or a YYYY year, got next spring");
    expect(fs.existsSync(path.join(root, "characters", "tomas.md"))).toBe(false);
  });
});

describe("ages in knowledge and context", () => {
  function family() {
    return book(makeTempDir(), "Ages", {
      characters: { mira: "born: 2001-09-14", tomas: "born: 1968", ana: "relationships: []" },
      chapters: {
        1: "date: 2026-02-06\npov: mira\ncharacters:\n  - mira\n  - tomas\n  - ana",
        2: "characters:\n  - mira"
      }
    });
  }

  test("story knowledge prints the age at the chapter, and gives it in JSON", () => {
    const root = family();
    expect(run(["knowledge", "mira", "--at", "chapter-01", "--path", root], root).stdout).toStartWith("Age at chapter-01: 24\n");
    const json = JSON.parse(run(["knowledge", "mira", "--at", "chapter-01", "--json", "--path", root], root).stdout);
    expect(json.data.age).toEqual({ min: 24, max: 24, unborn: false, maybeUnborn: false, text: "24" });
    // An undated chapter has no age to give.
    expect(run(["knowledge", "mira", "--at", "chapter-02", "--path", root], root).stdout).not.toContain("Age");
    expect(JSON.parse(run(["knowledge", "mira", "--at", "chapter-02", "--json", "--path", root], root).stdout).data.age).toBeNull();
  });

  test("story context puts each character's age on their card, on a scene's own date", () => {
    const root = family();
    const chapter = run(["context", "chapter-01", "--path", root], root).stdout;
    expect(chapter).toContain("- Status: alive\n- Age: 24\n");
    expect(chapter).toContain("- Age: 57 or 58\n");
    expect(chapter.match(/- Age:/g)).toHaveLength(2);
    writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), `
title: Long Ago
chapter: chapter-01
scene: 1
status: draft
date: 2010-01-01
flashback-to: chapter-01
characters:
  - mira
`, "Words.\n");
    expect(run(["context", "chapter-01-scene-01", "--path", root], root).stdout).toContain("- Age: 8\n");
  });
});

describe("story series born check", () => {
  test("warns when a shared character's birth date differs between books, and not when a later book says more", () => {
    const cwd = makeTempDir();
    const first = book(cwd, "Book One", { characters: { mira: "born: 2001", tomas: "born: 1968-03-01" } });
    const second = book(cwd, "Book Two", { characters: { mira: "born: 2001-09-14", tomas: "born: 1969-03-01" } });
    setStory(first, { series: "saga", precedes: ["../book-two"] });
    setStory(second, { series: "saga", follows: ["../book-one"] });
    const report = seriesReport(first);
    expect(report.warnings.filter((finding) => finding.code === "canon-born-mismatch").map((finding) => finding.message)).toEqual([
      "../book-two/characters/tomas.md born 1969-03-01 differs from 1968-03-01 in characters/tomas.md"
    ]);
  });
});

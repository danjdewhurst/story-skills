import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { ageOn, formatAge, parseBorn } from "../src/ages.js";
import { parseCalendar, parseCalendarDate } from "../src/calendar.js";
import { runCli } from "../src/cli.js";
import { parseClockDate } from "../src/continuity.js";
import { parseFrontmatter, replaceFrontmatter } from "../src/frontmatter.js";
import { checkProjectContinuity, createStoryProject, seriesReport, validateProject } from "../src/story.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const resultSchema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

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

function scene(root, chapter, number, frontmatter) {
  writeMarkdown(path.join(root, "scenes", `${chapter}-scene-0${number}.md`), `
title: Scene ${number}
chapter: ${chapter}
scene: ${number}
status: draft
${frontmatter}
`, "Words.\n");
}

function birthErrors(root) {
  return checkProjectContinuity(root).errors.filter((finding) => ["appears-before-birth", "born-after-death", "parent-born-after-child"].includes(finding.code));
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
    // YAML reads `born: 0968` as 968, so the leading zero is gone.
    expect(parseBorn(968).problem).toBe('must be a YYYY-MM-DD day or a YYYY year, got 968; quote a year before 1000, such as "0968"');
    expect(parseBorn("0968")).toEqual({ text: "0968", first: day("0968-01-01"), last: day("0968-12-31") });
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
    expect(ageOn(parseBorn("2001-09-14"), day("2000-01-01"))).toEqual({ min: null, max: null, unborn: true, maybeUnborn: false });
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

  test("a flashback scene does not date its chapter, and an undated scene leaves an undated chapter unchecked", () => {
    const root = book(makeTempDir(), "Flashbacks", {
      count: 4,
      characters: { mira: "born: 2001-09-14" },
      chapters: { 1: "characters:\n  - mira", 2: "characters:\n  - mira", 3: "characters:\n  - mira", 4: "date: 2001-09-10\ncharacters:\n  - mira" }
    });
    // Chapter 4 has its own date, so its undated scene happens on that date.
    scene(root, "chapter-04", 1, "date: 2001-09-10\ncharacters: []");
    scene(root, "chapter-04", 2, "characters:\n  - mira");
    // Chapter 1: its only dated scene is a flashback.
    scene(root, "chapter-01", 1, "date: 1995-03-01\nflashback-to: chapter-03\ncharacters: []");
    scene(root, "chapter-01", 2, "characters:\n  - mira");
    // Chapter 2: one present-day scene is dated before the birth, the other is not dated.
    scene(root, "chapter-02", 1, "date: 2001-01-01\ncharacters: []");
    scene(root, "chapter-02", 2, "characters:\n  - mira");
    // Chapter 3: every scene is dated before the birth.
    scene(root, "chapter-03", 1, "date: 2000-01-01\ncharacters: []");
    scene(root, "chapter-03", 2, "date: 2001-09-13\ncharacters: []");
    expect(birthErrors(root).map((finding) => finding.message)).toEqual([
      "chapters/chapter-03.md lists mira, who is born 2001-09-14, in a chapter dated 2001-09-13; move them to mentions or fix the dates",
      "chapters/chapter-04.md lists mira, who is born 2001-09-14, in a chapter dated 2001-09-10; move them to mentions or fix the dates"
    ]);
  });

  test("a pov counts as an appearance, and a birth on the day of the death is allowed", () => {
    const root = book(makeTempDir(), "Pov", {
      characters: { mira: "born: 2001-09-14", brief: "status: deceased\nborn: 2026-02-06\ndied-in: chapter-02" },
      chapters: { 1: "date: 2001-09-13\npov: mira\ncharacters: []", 2: "date: 2026-02-06\ncharacters: []" }
    });
    expect(birthErrors(root).map((finding) => [finding.code, finding.chapter])).toEqual([["appears-before-birth", "chapter-01"]]);
  });

  test("reads either side of a parent and child pair, and a birth on the same day", () => {
    const relation = (other, type) => `relationships:\n  - character: ${other}\n    type: ${type}`;
    const root = book(makeTempDir(), "One Sided", {
      characters: {
        mum: `born: 1990\n${relation("kid", "parent")}`,
        kid: "born: 1985-01-01",
        dad: "born: 1960",
        son: `born: 1990-01-01\n${relation("dad", "child")}`,
        aunt: "born: 1995-05-05",
        niece: `born: 1990-05-05\n${relation("aunt", "child")}`,
        twin: `born: 2000-02-02\n${relation("twinkid", "parent")}`,
        twinkid: "born: 2000-02-02"
      }
    });
    expect(birthErrors(root).map((finding) => finding.message)).toEqual([
      "characters/mum.md is born 1990, not before kid, their child, born 1985-01-01; fix born or the relationship",
      "characters/aunt.md is born 1995-05-05, not before niece, their child, born 1990-05-05; fix born or the relationship",
      "characters/twin.md is born 2000-02-02, not before twinkid, their child, born 2000-02-02; fix born or the relationship"
    ]);
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

describe("born under a story calendar", () => {
  function calendarBook(characters, chapters = {}) {
    return book(makeTempDir(), "Embers", { story: { calendar: CALENDAR }, characters, chapters });
  }

  test("validate, add, continuity, context, and knowledge read born in the calendar", () => {
    const root = calendarBook(
      { kael: "born: 3 Bloom 270 AE", sera: "born: 270 AE", odd: "born: 3 Frost 270 AE" },
      { 1: "date: 2 Bloom 300 AE\npov: kael\ncharacters:\n  - kael\n  - sera", 2: "date: 1 Thaw 260 AE\ncharacters:\n  - kael" }
    );
    expect(validateProject(root).errors.filter((finding) => finding.code === "invalid-date").map((finding) => finding.message)).toEqual([
      "characters/odd.md born is not a day or a year of the story calendar: it names no calendar month (Thaw, Bloom)"
    ]);
    expect(birthErrors(root).map((finding) => finding.message)).toEqual([
      "chapters/chapter-02.md lists kael, who is born 3 Bloom 270 AE, in a chapter dated 1 Thaw 260 AE; move them to mentions or fix the dates"
    ]);
    expect(run(["knowledge", "kael", "--at", "chapter-01", "--path", root], root).stdout).toStartWith("Age at chapter-01: 29\n");
    const context = run(["context", "chapter-01", "--path", root], root).stdout;
    expect(context).toContain("- Age: 29\n");
    expect(context).toContain("- Age: 29 or 30\n");
    expect(run(["add", "character", "Ivo", "--born", "5 Thaw 2 BW", "--path", root], root).code).toBe(0);
    expect(String(parseFrontmatter(fs.readFileSync(path.join(root, "characters", "ivo.md"), "utf8")).data.born)).toBe("5 Thaw 2 BW");
  });

  test("an invalid calendar reads no born, so it reports nothing about it", () => {
    const root = book(makeTempDir(), "Broken", {
      story: { calendar: [{ era: "Only an era" }] },
      characters: { kael: "born: 3 Bloom 270 AE" },
      chapters: { 1: "date: 1 Thaw 260 AE\ncharacters:\n  - kael" }
    });
    const result = validateProject(root);
    expect(codes(result.errors)).toContain("invalid-calendar");
    expect(result.errors.filter((finding) => finding.message.includes(" born "))).toEqual([]);
    expect(birthErrors(root)).toEqual([]);
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

  test("a location or faction progression may still name a born field of its own", () => {
    const root = book(makeTempDir(), "Born Town");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "new-town.md"), `
name: New Town
type: city
status: active
progressions:
  - from: chapter-02
    field: born
    value: rebuilt
`, "# New Town\n");
    expect(codes(validateProject(root).errors)).not.toContain("progression-fixed-field");
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
    expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
    const ranged = JSON.parse(run(["knowledge", "tomas", "--at", "chapter-01", "--json", "--path", root], root).stdout);
    expect(ranged.data.age).toEqual({ min: 57, max: 58, unborn: false, maybeUnborn: false, text: "57 or 58" });
    expect(validateAgainstSchema(ranged, resultSchema)).toEqual([]);
    const later = path.join(root, "characters", "ana.md");
    fs.writeFileSync(later, fs.readFileSync(later, "utf8").replace("relationships: []", "born: 2030-01-01\nrelationships: []"));
    const unborn = JSON.parse(run(["knowledge", "ana", "--at", "chapter-01", "--json", "--path", root], root).stdout);
    expect(unborn.data.age).toEqual({ min: null, max: null, unborn: true, maybeUnborn: false, text: "not born yet" });
    expect(validateAgainstSchema(unborn, resultSchema)).toEqual([]);
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
  function series(cwd, books) {
    const roots = books.map(([title, options]) => book(cwd, title, options));
    roots.forEach((root, index) => {
      const fields = { series: "saga" };
      if (index > 0) {
        fields.follows = [`../${path.basename(roots[index - 1])}`];
      }
      if (index < roots.length - 1) {
        fields.precedes = [`../${path.basename(roots[index + 1])}`];
      }
      setStory(root, fields);
    });
    return roots;
  }
  const mismatches = (root) => seriesReport(root).warnings.filter((finding) => finding.code === "canon-born-mismatch").map((finding) => finding.message);

  test("warns when a shared character's birth date differs between books, earlier or later, and not when a later book says more", () => {
    const [first] = series(makeTempDir(), [
      ["Book One", { characters: { mira: "born: 2001", tomas: "born: 1968-03-01", ana: "born: 1970-01-01" } }],
      ["Book Two", { characters: { mira: "born: 2001-09-14", tomas: "born: 1969-03-01", ana: "born: 1969-01-01" } }]
    ]);
    expect(mismatches(first)).toEqual([
      "../book-two/characters/ana.md born 1969-01-01 differs from 1970-01-01 in characters/ana.md",
      "../book-two/characters/tomas.md born 1969-03-01 differs from 1968-03-01 in characters/tomas.md"
    ]);
  });

  test("compares with the most recent earlier book that gives one", () => {
    const [first] = series(makeTempDir(), [
      ["Book One", { characters: { mira: "born: 2001" } }],
      ["Book Two", { characters: { mira: "born: 2002" } }],
      ["Book Three", { characters: { mira: "born: 2002-03-03" } }]
    ]);
    expect(mismatches(first)).toEqual(["../book-two/characters/mira.md born 2002 differs from 2001 in characters/mira.md"]);
  });

  test("where two lines of books join, compares with the latest book on each line", () => {
    const cwd = makeTempDir();
    const [one, left, right, last] = [
      ["Origin", "born: 2001"], ["Left", "born: 2001"], ["Right", "born: 2002"], ["Joined", "born: 2001-05-05"]
    ].map(([title, born]) => book(cwd, title, { characters: { mira: born } }));
    const link = (root, fields) => setStory(root, { series: "saga", ...fields });
    const rel = (root) => `../${path.basename(root)}`;
    link(one, { precedes: [rel(left), rel(right)] });
    link(left, { follows: [rel(one)], precedes: [rel(last)] });
    link(right, { follows: [rel(one)], precedes: [rel(last)] });
    link(last, { follows: [rel(left), rel(right)] });
    expect(mismatches(one).sort()).toEqual([
      "../joined/characters/mira.md born 2001-05-05 differs from 2002 in ../right/characters/mira.md",
      "../right/characters/mira.md born 2002 differs from 2001 in characters/mira.md"
    ]);
  });

  test("does not compare books with different calendars, and passes over a book on another calendar", () => {
    const [first] = series(makeTempDir(), [
      ["Book One", { characters: { mira: "born: 1968" } }],
      ["Book Two", { story: { calendar: CALENDAR }, characters: { mira: "born: 1968" } }]
    ]);
    expect(mismatches(first)).toEqual([]);
    const [start] = series(makeTempDir(), [
      ["Book One", { characters: { mira: "born: 1968" } }],
      ["Book Two", { story: { calendar: CALENDAR }, characters: { mira: "born: 270 AE" } }],
      ["Book Three", { characters: { mira: "born: 1975" } }]
    ]);
    expect(mismatches(start)).toEqual(["../book-three/characters/mira.md born 1975 differs from 1968 in characters/mira.md"]);
  });
});

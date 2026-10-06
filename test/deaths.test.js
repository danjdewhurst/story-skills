import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { chapterChronology } from "../src/chronology.js";
import { characterLifeline, revivedBy } from "../src/deaths.js";
import { parseFrontmatter, replaceFrontmatter } from "../src/frontmatter.js";
import { checkProjectContinuity, createStoryProject, diagramProject, scanProject, seriesReport, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

// A book with `count` drafted chapters. `chapters` maps a chapter number to
// extra frontmatter (a cast, a date).
function book(cwd, title, { count = 5, characters = {}, chapters = {}, state = "" } = {}) {
  const { root } = createStoryProject({ cwd, title, force: false });
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
${frontmatter}
`, `# ${id}\n`);
  }
  if (state !== "") {
    writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: x
current-chapter: 0
${state}
`, "# State\n");
  }
  return root;
}

function setStory(root, fields) {
  const storyPath = path.join(root, "story.md");
  const markdown = fs.readFileSync(storyPath, "utf8");
  const { data } = parseFrontmatter(markdown, storyPath);
  fs.writeFileSync(storyPath, replaceFrontmatter(markdown, { ...data, ...fields }), "utf8");
}

// Links books in the order given, each following the one before.
function linkSeries(roots) {
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
}

function lifeline(root, id) {
  const project = scanProject(root);
  const chronology = chapterChronology(project);
  return { life: characterLifeline(project.characters.find((character) => character.id === id), chronology), chronology };
}

const progression = (...entries) => `progressions:\n${entries.map(([from, value]) => `  - from: ${from}\n    field: status\n    value: ${value}`).join("\n")}`;
const cast = (id) => `characters:\n  - ${id}`;

describe("characterLifeline", () => {
  test("reads died-in, revived-in, status, and status progressions in story order", () => {
    const root = book(makeTempDir(), "Lives", {
      characters: {
        living: "status: alive",
        ghost: "status: deceased",
        fallen: `status: alive\n${progression(["chapter-03", "deceased"])}`,
        phoenix: "status: alive\ndied-in: chapter-02\nrevived-in: chapter-04",
        twice: `status: alive\ndied-in: chapter-01\nrevived-in: chapter-02\n${progression(["chapter-01", "deceased"], ["chapter-02", "alive"], ["chapter-04", "deceased"])}`,
        returned: `status: deceased\n${progression(["chapter-03", "alive"])}`,
        lost: "status: deceased\ndied-in: chapter-09",
        missing: `status: alive\n${progression(["chapter-02", "missing"])}`,
        again: `status: deceased\ndied-in: chapter-04\n${progression(["chapter-02", "alive"], ["chapter-04", "deceased"])}`
      }
    });
    const events = (id) => lifeline(root, id).life;
    expect(events("living")).toEqual({ deadAtStart: false, deadAtEnd: false, events: [] });
    expect(events("ghost")).toEqual({ deadAtStart: true, deadAtEnd: true, events: [] });
    expect(events("fallen")).toEqual({ deadAtStart: false, deadAtEnd: true, events: [{ type: "death", chapter: "chapter-03", source: "progression" }] });
    expect(events("phoenix")).toEqual({
      deadAtStart: false,
      deadAtEnd: false,
      events: [{ type: "death", chapter: "chapter-02", source: "died-in" }, { type: "revival", chapter: "chapter-04", source: "revived-in" }]
    });
    expect(events("twice").events).toEqual([
      { type: "death", chapter: "chapter-01", source: "died-in" },
      { type: "revival", chapter: "chapter-02", source: "revived-in" },
      { type: "death", chapter: "chapter-04", source: "progression" }
    ]);
    expect(events("twice").deadAtEnd).toBe(true);
    expect(events("returned")).toEqual({ deadAtStart: true, deadAtEnd: false, events: [{ type: "revival", chapter: "chapter-03", source: "progression" }] });
    // A died-in the book has no chapter for leaves the status in charge.
    expect(events("lost")).toEqual({ deadAtStart: true, deadAtEnd: true, events: [] });
    expect(events("missing")).toEqual({ deadAtStart: false, deadAtEnd: false, events: [] });

    // Opens dead, is brought back, and dies again by died-in.
    expect(events("again")).toEqual({
      deadAtStart: true,
      deadAtEnd: true,
      events: [{ type: "revival", chapter: "chapter-02", source: "progression" }, { type: "death", chapter: "chapter-04", source: "died-in" }]
    });

    const { life, chronology } = lifeline(root, "returned");
    expect(revivedBy(life, "chapter-02", chronology)).toBe(false);
    expect(revivedBy(life, "chapter-03", chronology)).toBe(true);
    expect(revivedBy(life, "chapter-05", chronology)).toBe(true);
    expect(revivedBy(life, "chapter-09", chronology)).toBe(false);
  });

  test("orders dated chapters by story time, so the end of the book is the latest date", () => {
    // Chapter 1 is a flash-forward: it happens last, after the revival in
    // chapter 3, so the character ends the book dead.
    const root = book(makeTempDir(), "Dated", {
      chapters: { 1: "date: 2030-01-01", 2: "date: 2020-01-01", 3: "date: 2021-01-01" },
      characters: { seer: `status: alive\n${progression(["chapter-02", "deceased"], ["chapter-03", "alive"], ["chapter-01", "deceased"])}` }
    });
    expect(lifeline(root, "seer").life.events.map((event) => `${event.type} ${event.chapter}`)).toEqual([
      "death chapter-02",
      "revival chapter-03",
      "death chapter-01"
    ]);
    expect(lifeline(root, "seer").life.deadAtEnd).toBe(true);
  });

  test("an undated chapter between dated ones does not invent a revival", () => {
    // By date chapter 3 comes before chapter 1; by number chapter 2 sits
    // between them, where the progression from chapter 3 does not apply yet.
    const root = book(makeTempDir(), "Mixed", {
      count: 3,
      chapters: { 1: "date: 2030-01-01", 3: "date: 2020-01-01" },
      characters: { seer: `status: alive\n${progression(["chapter-03", "deceased"])}` }
    });
    const { life } = lifeline(root, "seer");
    expect(life.events.filter((event) => event.type === "revival")).toEqual([]);
    expect(life.deadAtEnd).toBe(true);
  });

  test("a book dated only in places has one lifeline, which continuity agrees with", () => {
    // Chapter 3 is dated a day after chapter 5, and chapter 4 is undated
    // between them. Bun and Node sorted the chapters differently: Ana ended
    // the book dead in one and revived in the other (#545). Chapter 4 keeps
    // the date of chapter 3, read before it, so the revival in the
    // flashback chapter 5 comes before the death, and ends nothing.
    const root = book(makeTempDir(), "Circle", {
      chapters: { 3: "date: 2024-01-02", 5: "date: 2024-01-01" },
      characters: { ana: "status: deceased\ndied-in: chapter-04\nrevived-in: chapter-05" }
    });
    expect(lifeline(root, "ana").life).toEqual({ deadAtStart: false, deadAtEnd: true, events: [{ type: "death", chapter: "chapter-04", source: "died-in" }] });
    expect(diagramProject(root, { kind: "relationships" }).text).toContain("  class ana deceased\n");
    expect(checkProjectContinuity(root).errors.map((finding) => finding.message)).toContain("characters/ana.md is revived in chapter-05, not after dying in chapter-04");
  });

  test("a died-in chapter dated before an undated one is where the death is", () => {
    // Chapter 1 is dated after chapter 3, the death chapter, and chapter 2
    // has no date. The death used to land in chapter 1, from a progression
    // the character does not have.
    const root = book(makeTempDir(), "Flashback", {
      count: 3,
      chapters: { 1: "date: 2024-01-06", 3: "date: 2024-01-01" },
      characters: { cy: "status: deceased\ndied-in: chapter-03" }
    });
    expect(lifeline(root, "cy").life).toEqual({ deadAtStart: false, deadAtEnd: true, events: [{ type: "death", chapter: "chapter-03", source: "died-in" }] });
  });

  test("a revived-in before died-in brings nobody back", () => {
    const root = book(makeTempDir(), "Backwards", {
      characters: {
        eli: "status: deceased\ndied-in: chapter-03\nrevived-in: chapter-02",
        // A progression to deceased after that revival is no return to life,
        // and one before died-in is no second death.
        fay: `status: deceased\ndied-in: chapter-03\nrevived-in: chapter-02\n${progression(["chapter-04", "deceased"])}`,
        gus: `status: alive\ndied-in: chapter-04\nrevived-in: chapter-01\n${progression(["chapter-03", "deceased"])}`
      }
    });
    expect(lifeline(root, "eli").life).toEqual({ deadAtStart: false, deadAtEnd: true, events: [{ type: "death", chapter: "chapter-03", source: "died-in" }] });
    expect(lifeline(root, "fay").life).toEqual({ deadAtStart: false, deadAtEnd: true, events: [{ type: "death", chapter: "chapter-03", source: "died-in" }] });
    expect(lifeline(root, "gus").life).toEqual({ deadAtStart: false, deadAtEnd: true, events: [{ type: "death", chapter: "chapter-04", source: "died-in" }] });
  });

  test("a status that is not one value does not stop the checks", () => {
    const root = book(makeTempDir(), "Odd", {
      characters: { odd: `status:\n  - toString: 1\ndied-in: chapter-02\n${progression(["chapter-04", "deceased"])}` }
    });
    expect(lifeline(root, "odd").life).toEqual({ deadAtStart: false, deadAtEnd: true, events: [{ type: "death", chapter: "chapter-02", source: "died-in" }] });
    expect(validateProject(root).errors.map((finding) => finding.message)).toContain("characters/odd.md frontmatter field status must be a scalar");
    expect(checkProjectContinuity(root).errors.map((finding) => finding.message)).toContain("characters/odd.md has died-in chapter-02 but status unset; set status: deceased");
  });

  test("an outline death still counts at the end of the book", () => {
    const root = book(makeTempDir(), "Planned", {
      characters: { eli: "status: alive\ndied-in: chapter-05" }
    });
    const chapter = path.join(root, "chapters", "chapter-05.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("status: draft", "status: outline"), "utf8");
    const life = lifeline(root, "eli").life;
    expect(life.deadAtEnd).toBe(true);
    expect(life.events).toEqual([{ type: "death", chapter: "chapter-05", source: "died-in" }]);
  });

  test("a book with no chapters reads the frontmatter status", () => {
    const root = book(makeTempDir(), "Empty", { count: 0, characters: { ghost: `status: deceased\n${progression(["chapter-02", "alive"])}` } });
    expect(lifeline(root, "ghost").life).toEqual({ deadAtStart: true, deadAtEnd: true, events: [] });
  });
});

describe("story series with deaths recorded as progressions", () => {
  function invoke(cwd, argv) {
    const io = memoryIo(cwd);
    const code = runCli(argv, io);
    return { code, out: io.output(), err: io.error() };
  }

  test("a progression death in book one is canon in book two", () => {
    const cwd = makeTempDir();
    const one = book(cwd, "One", { characters: { mara: `status: alive\n${progression(["chapter-04", "deceased"])}` } });
    const two = book(cwd, "Two", {
      chapters: { 2: cast("mara") },
      characters: { mara: "status: alive" },
      state: "knowledge-state:\n  - character: mara\n    knows: the tide turns\n    learned-in: chapter-03"
    });
    linkSeries([one, two]);

    const report = seriesReport(two);
    expect(report.errors.map((finding) => [finding.code, finding.message])).toEqual([
      ["canon-death-status", "characters/mara.md has status alive, but mara is deceased in earlier book One; set status: deceased"],
      ["canon-posthumous-appearance", "chapters/chapter-02.md lists mara, who died in earlier book One; move appearances to mentions"],
      ["canon-posthumous-learning", "continuity/state.md knowledge-state[0] has mara learn something in chapter-03, but mara died in earlier book One; drop learned-in or the entry"]
    ]);
    const json = JSON.parse(invoke(cwd, ["series", two, "--json"]).out);
    expect(json.diagnostics.map((finding) => finding.code)).toEqual(["canon-death-status", "canon-posthumous-appearance", "canon-posthumous-learning"]);

    // The same findings from book one, naming book two's files from there.
    expect(seriesReport(one).errors.map((finding) => finding.file)).toEqual(["../two/characters/mara.md", "../two/chapters/chapter-02.md", "../two/continuity/state.md"]);
  });

  test("a later book's status that is not one value reads as unset", () => {
    const cwd = makeTempDir();
    const one = book(cwd, "One", { characters: { mara: `status: alive\n${progression(["chapter-04", "deceased"])}` } });
    const two = book(cwd, "Two", { characters: { mara: "status:\n  - toString: 1" } });
    linkSeries([one, two]);
    expect(seriesReport(two).errors.map((finding) => finding.message)).toEqual([
      "characters/mara.md has status unset, but mara is deceased in earlier book One; set status: deceased"
    ]);
  });

  test("a revival ends the death, in the earlier book or in the later one", () => {
    const cwd = makeTempDir();
    // Revived by a progression before book one ends: alive in book two.
    const one = book(cwd, "One", { characters: { mara: `status: alive\n${progression(["chapter-02", "deceased"], ["chapter-04", "alive"])}` } });
    const two = book(cwd, "Two", {
      chapters: { 1: cast("mara"), 3: cast("mara") },
      characters: { mara: "status: alive", ren: `status: deceased\n${progression(["chapter-03", "alive"])}` }
    });
    // Ren dies in book one by died-in; book two opens with them deceased and
    // brings them back in chapter 3.
    fs.writeFileSync(path.join(one, "characters", "ren.md"), "---\nname: Ren\nrole: supporting\nstatus: deceased\ndied-in: chapter-05\n---\n# Ren\n");
    fs.writeFileSync(path.join(two, "chapters", "chapter-02.md"), "---\ntitle: Chapter 2\nnumber: 2\nstatus: draft\nword-count: 1\ncharacters:\n  - ren\n---\nWords.\n");
    fs.writeFileSync(path.join(two, "chapters", "chapter-04.md"), "---\ntitle: Chapter 4\nnumber: 4\nstatus: draft\nword-count: 1\ncharacters:\n  - ren\n---\nWords.\n");
    // Kai dies in book one; book two brings them back in chapter 3 and they
    // die again there by died-in in chapter 5, so chapter 3 is no finding.
    fs.writeFileSync(path.join(one, "characters", "kai.md"), "---\nname: Kai\nrole: supporting\nstatus: deceased\n---\n# Kai\n");
    fs.writeFileSync(path.join(two, "characters", "kai.md"), `---\nname: Kai\nrole: supporting\nstatus: deceased\ndied-in: chapter-05\n${progression(["chapter-03", "alive"], ["chapter-05", "deceased"])}\n---\n# Kai\n`);
    fs.writeFileSync(path.join(two, "chapters", "chapter-03.md"), "---\ntitle: Chapter 3\nnumber: 3\nstatus: draft\nword-count: 1\ncharacters:\n  - mara\n  - kai\n---\nWords.\n");
    linkSeries([one, two]);

    expect(seriesReport(two).errors.map((finding) => finding.message)).toEqual([
      "chapters/chapter-02.md lists ren, who died in earlier book One; move appearances to mentions"
    ]);
  });

  test("across three books, only a revival clears a death, and the death names the book it happened in", () => {
    const cwd = makeTempDir();
    const one = book(cwd, "One", {
      characters: {
        mara: `status: alive\n${progression(["chapter-03", "deceased"])}`,
        ren: `status: alive\n${progression(["chapter-03", "deceased"])}`,
        tam: "status: alive"
      }
    });
    // Mara is wrongly alive in book two (its own error), which does not bring
    // her back; Ren is revived; Tam dies here.
    const two = book(cwd, "Two", {
      characters: {
        mara: "status: alive",
        ren: `status: deceased\n${progression(["chapter-02", "alive"])}`,
        tam: `status: alive\n${progression(["chapter-05", "deceased"])}`
      }
    });
    const three = book(cwd, "Three", {
      chapters: { 1: "characters:\n  - mara\n  - ren\n  - tam" },
      characters: { mara: "status: deceased", ren: "status: alive", tam: "status: deceased" }
    });
    linkSeries([one, two, three]);

    expect(seriesReport(three).errors.map((finding) => finding.message)).toEqual([
      "../two/characters/mara.md has status alive, but mara is deceased in earlier book One; set status: deceased",
      "chapters/chapter-01.md lists mara, who died in earlier book One; move appearances to mentions",
      "chapters/chapter-01.md lists tam, who died in earlier book Two; move appearances to mentions"
    ]);
  });
});

describe("story diagram with deaths recorded as progressions", () => {
  test("marks characters dead or revived at the end of the book", () => {
    const root = book(makeTempDir(), "Graph", {
      characters: {
        ana: `status: alive\n${progression(["chapter-03", "deceased"])}`,
        ben: "status: alive\ndied-in: chapter-02\nrevived-in: chapter-04",
        cy: `status: deceased\n${progression(["chapter-02", "alive"])}`,
        dee: "status: deceased",
        eli: "status: alive\ndied-in: chapter-05"
      }
    });
    const text = diagramProject(root, { kind: "relationships" }).text;
    expect(text).toContain("  classDef deceased stroke-dasharray: 4 4,color:#888\n  class ana,dee,eli deceased\n");
    expect(text).toContain("  classDef revived stroke-width:3px\n  class ben,cy revived\n");
  });

  test("draws no revived class when nobody comes back", () => {
    const root = book(makeTempDir(), "Plain", { characters: { ana: "status: alive" } });
    const text = diagramProject(root, { kind: "relationships" }).text;
    expect(text).not.toContain("classDef");
  });
});

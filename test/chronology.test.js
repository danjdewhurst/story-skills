import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCli } from "../src/cli.js";
import { chapterChronology, orderedChronology, renumberedChronology } from "../src/chronology.js";
import { characterLifeline } from "../src/deaths.js";
import { entityStateAt, happensAfter, sortProgressions, validateProgressions } from "../src/progressions.js";
import { checkProjectContinuity, createStoryProject, diagramProject, entityStateAtChapter, moveEntity, scanProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const repoRoot = path.resolve(import.meta.dir, "..");
const id = (number) => `chapter-${String(number).padStart(2, "0")}`;

// The chronology of a book with written chapters `numbers`. `days` maps a
// chapter number to its day in January 2024, and `choices` maps a chapter
// number to the chapter numbers its choices lead to (a branching book).
function chronologyOf(numbers, days = {}, choices = {}) {
  const chapters = numbers.map((number) => ({
    id: id(number),
    number,
    file: `/book/chapters/${id(number)}.md`,
    status: "draft",
    date: days[number] === undefined ? "" : `2024-01-${String(days[number]).padStart(2, "0")}`,
    choices: choices[number]?.map((to) => ({ text: `To ${to}`, to: id(to) }))
  }));
  return chapterChronology({ root: "/book", chapters, scenes: [], calendar: null });
}

function permutations(list) {
  if (list.length <= 1) {
    return [list];
  }
  return list.flatMap((first, index) => permutations([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [first, ...rest]));
}

// A seeded generator (mulberry32), so a failing book can be rebuilt.
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// A random book of up to ten chapter numbers: each is written or planned
// (an id with no file), and each written one is dated on one of four days,
// so dates often disagree with numbers, or not dated. With `branching`, some
// chapters get choices, loops included.
function randomBook(random, branching) {
  const numbers = [];
  const planned = [];
  for (let number = 1; number <= 10; number += 1) {
    (random() < 0.6 || (number === 10 && numbers.length === 0) ? numbers : planned).push(number);
  }
  const days = {};
  const choices = {};
  for (const number of numbers) {
    if (random() < 0.5) {
      days[number] = 1 + Math.floor(random() * 4);
    }
    if (branching && (random() < 0.5 || number === numbers[0])) {
      choices[number] = [numbers[Math.floor(random() * numbers.length)], numbers[Math.floor(random() * numbers.length)]];
    }
  }
  return { chronology: chronologyOf(numbers, days, choices), written: numbers.map(id), planned: planned.map(id) };
}

// The rule two chapters follow on their own: by date when both are dated on
// different days, else by number. With only some chapters dated it can go
// in a circle.
function plainAfter(chronology, later, earlier) {
  const laterDays = chronology.days.get(later);
  const earlierDays = chronology.days.get(earlier);
  if (laterDays !== undefined && earlierDays !== undefined && laterDays !== earlierDays) {
    return laterDays > earlierDays;
  }
  return chronology.numbers.get(later) > chronology.numbers.get(earlier);
}

const PROGRESSION_RULES = { lists: new Set(), enums: new Map() };

describe("the story order", () => {
  test("orders a book dated only in places by story date, whatever order it starts in", () => {
    // Chapter 2 is dated a day after chapter 5, and 3 and 4 have no date: by
    // the plain rule 3 comes after 2 and 5 after 4 by number, but 2 after 5
    // by date (#545). Chapter 5 is a flashback: it comes first, and 3 and 4
    // keep the date of chapter 2, the latest read before them.
    const chronology = chronologyOf([1, 2, 3, 4, 5], { 2: 2, 5: 1 });
    expect([plainAfter(chronology, id(3), id(2)), plainAfter(chronology, id(5), id(4)), plainAfter(chronology, id(2), id(5))]).toEqual([true, true, true]);
    const expected = [1, 5, 2, 3, 4].map(id);
    for (const start of permutations([1, 2, 3, 4, 5].map(id))) {
      expect([...start].sort(chronology.compare)).toEqual(expected);
    }
    expect(chronology.order).toEqual(expected);
    expect(expected.map((later) => expected.filter((earlier) => chronology.after(later, earlier)))).toEqual(expected.map((_, index) => expected.slice(0, index)));
  });

  test("places a planned chapter as an undated one with its number", () => {
    // Chapter 4 is a flashback, dated before chapter 2. Planned 3, read
    // after 2, takes the date of 2 as an undated chapter would.
    const linear = chronologyOf([1, 2, 4], { 2: 5, 4: 1 });
    expect([id(4), id(3), id(9), id(1), id(2)].sort(linear.compare)).toEqual([1, 4, 2, 3, 9].map(id));
    // Chapter 1 leads to 4, and 4 to 2: planned 3 follows 2, the last-read
    // chapter numbered below it, and comes before planned 5.
    const branching = chronologyOf([1, 2, 4], {}, { 1: [4], 4: [2] });
    expect([id(5), id(2), id(3), id(4), id(1)].sort(branching.compare)).toEqual([1, 4, 2, 3, 5].map(id));
    // An id too long to be a number is no planned chapter: it sorts with the
    // unknown chapters, after the known ones.
    const huge = `chapter-${"9".repeat(400)}`;
    expect(sortProgressions([{ from: huge }, { from: id(3) }], linear)).toEqual([{ from: id(3) }, { from: huge }]);
    expect(happensAfter(linear, huge, id(1))).toBe(false);
  });

  test("is one consistent order on random partly dated books, which every reader of it follows", () => {
    const random = generator(545);
    for (let round = 0; round < 400; round += 1) {
      const branching = round % 2 === 1;
      const { chronology, written, planned } = randomBook(random, branching);
      const { compare } = chronology;
      const ids = [...written, ...planned];
      const context = `round ${round}: ${JSON.stringify({ written, days: [...chronology.days] })}`;
      for (const left of ids) {
        expect(compare(left, left)).toBe(0);
        for (const right of ids) {
          if (left !== right) {
            expect(compare(left, right), context).not.toBe(0);
            expect(compare(left, right), context).toBe(-compare(right, left));
          }
          for (const third of ids) {
            if (compare(left, right) < 0 && compare(right, third) < 0) {
              expect(compare(left, third), context).toBe(-1);
            }
          }
        }
      }
      // A consistent order sorts the same from any start.
      const sorted = [...ids].sort(compare);
      expect([...ids].reverse().sort(compare), context).toEqual(sorted);
      expect(chronology.order, context).toEqual(sorted.filter((chapterId) => written.includes(chapterId)));
      // Two dated chapters keep their date order.
      const dayOf = (chapterId) => chronology.days.get(chapterId);
      for (const left of written) {
        for (const right of written) {
          if (dayOf(left) !== undefined && dayOf(right) !== undefined && dayOf(left) !== dayOf(right)) {
            expect(compare(left, right), context).toBe(Math.sign(dayOf(left) - dayOf(right)));
          }
        }
      }
      // The whole-book read compares chapters as `compare` orders them.
      const ordered = orderedChronology(chronology);
      for (const left of ids) {
        for (const right of ids) {
          expect(happensAfter(ordered, left, right), context).toBe(compare(left, right) > 0);
        }
      }
      if (branching) {
        continue;
      }
      for (const later of ids) {
        for (const earlier of ids) {
          // An undated chapter happens after every chapter read before it.
          if (dayOf(later) === undefined && Number(later.slice(8)) > Number(earlier.slice(8))) {
            expect(compare(later, earlier), context).toBe(1);
          }
          if (written.includes(later) && written.includes(earlier)) {
            expect(chronology.after(later, earlier), context).toBe(compare(later, earlier) > 0);
          }
        }
      }
      // Where the plain rule is consistent, the order is the same as it.
      const consistent = written.every((left) => written.every((right) => written.every((third) => !(plainAfter(chronology, left, right) && plainAfter(chronology, right, third)) || plainAfter(chronology, left, third))));
      if (consistent) {
        for (const left of written) {
          for (const right of written) {
            expect(compare(left, right) > 0, context).toBe(plainAfter(chronology, left, right));
          }
        }
      }
      // A progressions list sorted into story order is one validate accepts,
      // and a chapter's state applies exactly the entries at or before it,
      // in that order.
      const progressions = ids.filter(() => random() < 0.5).map((from, index) => ({ from, field: "mood", value: `mood-${index}` })).reverse();
      const errors = [];
      validateProgressions({ progressions: sortProgressions(progressions, chronology) }, "characters/ada.md", PROGRESSION_RULES, chronology, errors);
      expect(errors, context).toEqual([]);
      for (const target of ids) {
        const applied = progressions.filter((entry) => compare(entry.from, target) <= 0).sort((left, right) => compare(left.from, right.from));
        expect(entityStateAt({ progressions }, target, chronology).changes.map((change) => change.from), context).toEqual(applied.map((entry) => entry.from));
      }
    }
  });
});

// The book from review of #545: chapter 2 is dated a day after chapter 5,
// a flashback, and the rest are undated.
function flashbackBook({ chapters = {}, characters = {}, count = 5, state = "" } = {}) {
  const { root } = createStoryProject({ cwd: makeTempDir(), title: "Flashback", force: false });
  const dates = { 2: "date: 2024-01-02", 5: "date: 2024-01-01" };
  for (let number = 1; number <= count; number += 1) {
    writeMarkdown(path.join(root, "chapters", `${id(number)}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 1
${dates[number] ?? ""}
${chapters[number] ?? "characters: []"}
`, "## Chapter Text\n\nWords.\n");
  }
  for (const [characterId, frontmatter] of Object.entries(characters)) {
    writeMarkdown(path.join(root, "characters", `${characterId}.md`), `
name: ${characterId}
role: supporting
${frontmatter}
`, `# ${characterId}\n`);
  }
  if (state !== "") {
    writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: flashback
current-chapter: 0
${state}
`, "# State\n");
  }
  return root;
}

const progressionList = (...entries) => `progressions:\n${entries.map(([from, field, value]) => `  - from: ${id(from)}\n    field: ${field}\n    value: ${value}`).join("\n")}`;

describe("one order for every command on a book dated only in places", () => {
  test("state, casts, deaths, and the diagram agree", () => {
    const root = flashbackBook({
      chapters: { 4: "characters:\n  - bo", 5: "characters:\n  - bo" },
      characters: {
        ada: `status: alive\nmood: calm\n${progressionList([2, "mood", "hopeful"], [5, "mood", "grim"])}`,
        // Dead in chapter 2 and back from 3, so in casts in 4 and in the
        // flashback 5.
        bo: `status: alive\n${progressionList([2, "status", "deceased"], [3, "status", "alive"])}`,
        cy: "status: alive\ndied-in: chapter-02\nrevived-in: chapter-04"
      }
    });
    // The flashback's change comes first; chapter 3 has both, chapter 1
    // neither.
    expect(entityStateAtChapter(root, "character", "ada", "chapter-03").changes.map((change) => `${change.from} ${change.value}`)).toEqual(["chapter-05 grim", "chapter-02 hopeful"]);
    expect(entityStateAtChapter(root, "character", "ada", "chapter-03").state.mood).toBe("hopeful");
    expect(entityStateAtChapter(root, "character", "ada", "chapter-01").state.mood).toBe("calm");
    const result = checkProjectContinuity(root);
    const found = [...result.errors, ...result.warnings].map((finding) => finding.code);
    expect(found).not.toContain("progression-deceased-in-cast");
    expect(found).not.toContain("revival-before-death");
    const project = scanProject(root);
    const cy = project.characters.find((character) => character.id === "cy");
    expect(characterLifeline(cy, chapterChronology(project)).events.map((event) => `${event.type} ${event.chapter}`)).toEqual(["death chapter-02", "revival chapter-04"]);
    expect(diagramProject(root, { kind: "relationships" }).text).toContain("  class bo,cy revived\n");
  });

  test("story move writes a progressions list validate accepts", () => {
    const root = flashbackBook({ count: 6, characters: { ada: `status: alive\n${progressionList([2, "mood", "a"], [3, "mood", "b"], [6, "mood", "c"])}` } });
    moveEntity(root, { kind: "chapter", id: "chapter-06", number: 7 });
    const text = fs.readFileSync(path.join(root, "characters", "ada.md"), "utf8");
    expect([...text.matchAll(/from: (chapter-\d+)/g)].map((match) => match[1])).toEqual(["chapter-02", "chapter-03", "chapter-07"]);
    expect(validateProject(root).errors.map((finding) => finding.code)).not.toContain("progression-out-of-order");
    // The chronology the move sorts with reads the moved chapter as it will
    // be.
    const moved = renumberedChronology(chapterChronology(scanProject(root)), "chapter-07", "chapter-08", 8);
    expect(moved.order).toEqual(["chapter-01", "chapter-05", "chapter-02", "chapter-03", "chapter-04", "chapter-08"]);
  });

  test("an object found again after it was lost is not gone", () => {
    const root = flashbackBook({
      chapters: { 4: "characters: []\nmentions:\n  - ring" },
      state: "object-state:\n  - artifact: ring\n    status: lost\n    since: chapter-02\n  - artifact: ring\n    status: active\n    since: chapter-03"
    });
    writeMarkdown(path.join(root, "worldbuilding", "artifacts", "ring.md"), "name: Ring\ntype: jewellery\nstatus: active", "# Ring\n");
    const result = checkProjectContinuity(root);
    expect([...result.errors, ...result.warnings].map((finding) => finding.code)).not.toContain("gone-artifact-mentioned");
  });
});

describe("Bun and Node", () => {
  test("give the same lifelines, progression order, and state on random partly dated books", async () => {
    // One module, run here under Bun and in a node process: any comparator
    // that sorts differently in the two engines shows up as a difference.
    const file = path.join(makeTempDir(), "books.mjs");
    const source = (name) => JSON.stringify(pathToFileURL(path.join(repoRoot, "src", name)).href);
    fs.writeFileSync(file, `
import { chapterChronology } from ${source("chronology.js")};
import { characterLifeline } from ${source("deaths.js")};
import { entityStateAt, sortProgressions } from ${source("progressions.js")};

export function results(rounds) {
  let state = 584;
  const random = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const lines = [];
  for (let round = 0; round < rounds; round += 1) {
    const count = 3 + Math.floor(random() * 6);
    const chapters = [];
    for (let number = 1; number <= count; number += 1) {
      chapters.push({ id: "chapter-0" + number, number, file: "/b/chapters/chapter-0" + number + ".md", status: "draft", date: random() < 0.4 ? "2024-01-0" + (1 + Math.floor(random() * 5)) : "" });
    }
    const chronology = chapterChronology({ root: "/b", chapters, scenes: [], calendar: null });
    const ids = chapters.map((chapter) => chapter.id);
    const progressions = [];
    for (let left = Math.floor(random() * 4); left > 0; left -= 1) {
      progressions.push({ from: pick(ids), field: "status", value: pick(["alive", "deceased", "missing"]) });
    }
    const character = { id: "x", status: pick(["alive", "deceased"]), diedIn: random() < 0.6 ? pick(ids) : "", revivedIn: random() < 0.4 ? pick(ids) : "" };
    Object.defineProperty(character, "frontmatter", { value: { progressions } });
    lines.push(JSON.stringify([
      characterLifeline(character, chronology),
      sortProgressions(progressions, chronology),
      ids.map((chapterId) => entityStateAt({ status: character.status, progressions }, chapterId, chronology).state.status)
    ]));
  }
  return lines.join("\\n");
}
`);
    const node = spawnSync("node", ["--input-type=module", "-e", `import { results } from ${JSON.stringify(pathToFileURL(file).href)}; process.stdout.write(results(600));`], { encoding: "utf8" });
    expect(node.stderr).toBe("");
    const here = (await import(file)).results(600).split("\n");
    const there = node.stdout.split("\n");
    expect(there).toHaveLength(600);
    expect(there.filter((line, index) => line !== here[index])).toEqual([]);
  });

  test("the CLI and the fallback under node print what Bun prints for the issue's books", () => {
    const root = flashbackBook({ characters: { cy: "status: alive\ndied-in: chapter-02\nrevived-in: chapter-04", di: `status: deceased\ndied-in: chapter-05\n${progressionList([2, "mood", "grim"])}` } });
    for (const argv of [["diagram", "relationships"], ["continuity", "--json"]]) {
      const io = memoryIo(root);
      runCli(argv, io);
      for (const cli of [path.join(repoRoot, "bin", "story.js"), path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js")]) {
        const node = spawnSync("node", [cli, ...argv], { cwd: root, encoding: "utf8" });
        expect(node.stdout).toBe(io.output());
      }
    }
  });
});

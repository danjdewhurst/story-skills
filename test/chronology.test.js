import { describe, expect, test } from "bun:test";
import { chapterChronology, orderedChronology } from "../src/chronology.js";
import { happensAfter } from "../src/progressions.js";

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
  return { chronology: chronologyOf(numbers, days, choices), written: numbers.map(id), planned: planned.map(id), days };
}

describe("compare, the story order chapters sort in", () => {
  test("sorts a book dated only in places into one order, whatever order it starts in", () => {
    // Chapter 3 is dated a day after chapter 5, and chapter 4 has no date:
    // 4 comes after 3 and 5 after 4 by number, but 3 comes after 5 by date.
    // Sorting by `after` gave Bun and Node different orders (#545).
    const chronology = chronologyOf([1, 2, 3, 4, 5], { 3: 2, 5: 1 });
    expect([chronology.after(id(4), id(3)), chronology.after(id(5), id(4)), chronology.after(id(3), id(5))]).toEqual([true, true, true]);
    // The dates keep 5 before 3, and 4 comes before 5 by number.
    const expected = [1, 2, 4, 5, 3].map(id);
    for (const start of permutations([1, 2, 3, 4, 5].map(id))) {
      expect([...start].sort(chronology.compare)).toEqual(expected);
    }
    expect(orderedChronology(chronology).order).toEqual(expected);
  });

  test("places a planned chapter by its number, in a branching book among the written chapters", () => {
    const linear = chronologyOf([1, 2, 4]);
    expect([id(4), id(3), id(9), id(1)].sort(linear.compare)).toEqual([1, 3, 4, 9].map(id));
    // Chapter 1 leads to 4, and 4 to 2: a planned chapter 3 follows 2, the
    // last-read chapter numbered below it, and comes before planned 5.
    const branching = chronologyOf([1, 2, 4], {}, { 1: [4], 4: [2] });
    expect([id(5), id(2), id(3), id(4), id(1)].sort(branching.compare)).toEqual([1, 4, 2, 3, 5].map(id));
  });

  test("is a consistent total order on random partly dated books, linear and branching", () => {
    const random = generator(545);
    for (let round = 0; round < 400; round += 1) {
      const branching = round % 2 === 1;
      const { chronology, written, planned, days } = randomBook(random, branching);
      const { compare } = chronology;
      const ids = [...written, ...planned];
      const context = `round ${round}: ${JSON.stringify({ written, days })}`;
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
      // Two written chapters dated on different days keep their date order.
      const dayOf = (chapterId) => chronology.days.get(chapterId);
      for (const left of written) {
        for (const right of written) {
          if (dayOf(left) !== undefined && dayOf(right) !== undefined && dayOf(left) !== dayOf(right)) {
            expect(compare(left, right), context).toBe(Math.sign(dayOf(left) - dayOf(right)));
          }
        }
      }
      if (branching) {
        continue;
      }
      // Undated chapters keep their number order, and no chapter sorts
      // straight after one that happens after it, so `story move` writes a
      // progressions list that validate accepts.
      for (const left of ids) {
        for (const right of ids) {
          if (dayOf(left) === undefined && dayOf(right) === undefined && left !== right) {
            expect(compare(left, right), context).toBe(left < right ? -1 : 1);
          }
        }
      }
      sorted.slice(1).forEach((next, index) => {
        expect(happensAfter(chronology, sorted[index], next), context).toBe(false);
      });
      // Where `after` is transitive, the order is the same as `after`.
      const transitive = written.every((left) => written.every((right) => written.every((third) => !(chronology.after(left, right) && chronology.after(right, third)) || chronology.after(left, third))));
      if (transitive) {
        for (const left of written) {
          for (const right of written) {
            expect(compare(left, right) > 0, context).toBe(chronology.after(left, right));
          }
        }
      }
      // The whole-book read compares chapters by their place in that order.
      const ordered = orderedChronology(chronology);
      expect(ordered.order).toEqual(sorted.filter((chapterId) => written.includes(chapterId)));
      for (const left of written) {
        for (const right of written) {
          expect(ordered.after(left, right)).toBe(compare(left, right) > 0);
        }
      }
    }
  });
});

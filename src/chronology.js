import { parseClockDate } from "./continuity.js";

// Story-time order of chapters, shared by the death, knowledge, and state
// checks. Two chapters that are both dated compare by date, so a 2034
// prologue read first comes after a 2024 chapter 3, and a dual-timeline book
// compares its 1990 and 2020 strands correctly. Otherwise, or on the same
// day, they compare by chapter number (reading order). A chapter's date is
// its own `date`, else the earliest dated scene in it.
export function chapterChronology(project) {
  const numbers = new Map(project.chapters.map((chapter) => [chapter.id, chapter.number]));
  const days = new Map();
  for (const chapter of project.chapters) {
    const parsed = parseClockDate(String(chapter.date ?? ""));
    if (parsed) {
      days.set(chapter.id, parsed.days);
    }
  }
  const sceneDays = new Map();
  for (const scene of project.scenes) {
    const parsed = parseClockDate(String(scene.date ?? ""));
    if (parsed && numbers.has(scene.chapter) && !days.has(scene.chapter)) {
      sceneDays.set(scene.chapter, Math.min(sceneDays.get(scene.chapter) ?? Infinity, parsed.days));
    }
  }
  for (const [id, value] of sceneDays) {
    days.set(id, value);
  }
  const outline = new Set(project.chapters.filter((chapter) => chapter.status === "outline").map((chapter) => chapter.id));
  return { ...chronologyFrom(numbers, days), outline };
}

// The story-time order over chapter numbers and days, as { numbers, days,
// after }. `after(later, earlier)` is true when chapter `later` happens
// strictly after chapter `earlier`.
export function chronologyFrom(numbers, days) {
  const after = (later, earlier) => {
    const laterDays = days.get(later);
    const earlierDays = days.get(earlier);
    if (laterDays !== undefined && earlierDays !== undefined && laterDays !== earlierDays) {
      return laterDays > earlierDays;
    }
    return numbers.get(later) > numbers.get(earlier);
  };
  return { numbers, days, after };
}

// How a knowledge-state fact stands at `atChapterId`.
//
// Story time decides whether the character knows it, the same clock as
// deaths: when both chapters are dated, by date, otherwise by chapter
// number. Reading order decides whether the reader has been shown it.
// Returns "reader" when the reader has reached the learning chapter (or
// the fact is pre-existing), "character" when only the character knows it
// (learned in a flashback the reader has not reached), and null when the
// character does not know it yet or `learnedIn` names no chapter.
export function knowledgeAudience(chronology, learnedIn, atChapterId) {
  if (learnedIn === "") {
    return "reader";
  }
  if (!chronology.numbers.has(learnedIn) || chronology.after(learnedIn, atChapterId)) {
    return null;
  }
  return chronology.numbers.get(learnedIn) <= chronology.numbers.get(atChapterId) ? "reader" : "character";
}

// The parenthetical `story knowledge` and `story context` both print.
// Pass `atChapterId` when the line is for the chapter being drafted, so a
// fact learned there says "this chapter", and `scene` (the number of the
// earlier scene whose state-changes record it) for a scene target.
export function formatKnowledgeMark(learnedIn, audience, { atChapterId = "", scene = "" } = {}) {
  if (audience === "character") {
    return `character-knowledge, learned in ${learnedIn}; not yet shown to the reader, do not reveal`;
  }
  if (learnedIn === "") {
    return "reader-knowledge, pre-existing";
  }
  if (atChapterId !== "" && learnedIn === atChapterId) {
    return scene === "" ? "reader-knowledge, learned in this chapter" : `reader-knowledge, learned in this chapter, scene ${scene}`;
  }
  return `reader-knowledge, learned in ${learnedIn}`;
}

// The chronology after chapter `oldId` is renumbered to `newId`: the chapter
// keeps its date and takes the new number.
export function renumberedChronology(chronology, oldId, newId, number) {
  const numbers = new Map(chronology.numbers);
  const days = new Map(chronology.days);
  numbers.delete(oldId);
  numbers.set(newId, number);
  if (days.has(oldId)) {
    days.set(newId, days.get(oldId));
    days.delete(oldId);
  }
  return chronologyFrom(numbers, days);
}

// A character's dead window: after `died-in` and, with `revived-in`, before
// the revival chapter. Returns null for a character with no usable death.
// A death whose chapter is still `outline` is planned, not in force, so the
// window stays closed until that chapter is drafted. Pass `{ planned: true }`
// to count that scheduled death anyway (the end-of-book lifeline series and
// diagram read).
export function deathWindow(character, chronology, options = {}) {
  const died = character.diedIn;
  if (!died || !chronology.numbers.has(died)) {
    return null;
  }
  if (options.planned !== true && chronology.outline.has(died)) {
    return null;
  }
  const revived = character.revivedIn && chronology.numbers.has(character.revivedIn) ? character.revivedIn : "";
  return {
    died,
    revived,
    // Whether the character is dead during chapter `chapterId`.
    deadIn(chapterId) {
      if (!chronology.numbers.has(chapterId) || !chronology.after(chapterId, died)) {
        return false;
      }
      return revived === "" || chronology.after(revived, chapterId);
    }
  };
}

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

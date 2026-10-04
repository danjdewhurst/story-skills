import { deathWindow } from "./chronology.js";
import { entityStateAt, happensAfter, progressionEntry } from "./progressions.js";

// When a character is dead or alive, from `died-in`, `revived-in`, `status`,
// and `status` progressions, resolved in story time (see chronology.js).
// `story continuity` reads the per-chapter functions below; `story series`
// and `story diagram` read `characterLifeline`, which is built from them, so
// the three commands agree on every death and revival.

// A character's usable status progressions (see progressions.js), with their
// place in the list. Worked out once per character.
const STATUS_PROGRESSIONS = new WeakMap();

export function statusProgressions(character) {
  if (!STATUS_PROGRESSIONS.has(character)) {
    const list = Array.isArray(character.frontmatter.progressions) ? character.frontmatter.progressions : [];
    STATUS_PROGRESSIONS.set(character, list
      .map((item, index) => ({ index, entry: progressionEntry(item) }))
      .filter(({ entry }) => entry !== null && entry.field === "status")
      .map(({ index, entry }) => ({ index, from: entry.from, value: String(entry.value) })));
  }
  return STATUS_PROGRESSIONS.get(character);
}

// A character's status during chapter `chapterId`, with the status
// progressions that take effect by then applied in story order: `status`,
// `from`, the chapter of the last progression that set it ("" while the
// frontmatter status holds), and `deadFrom`, where the current run of
// deceased began ("" when it holds from the frontmatter, so a progression
// that repeats deceased does not move the death). A record in a chapter that
// is not written keeps the frontmatter status, as the died-in window does.
export function progressionStatusAt(character, chapterId, chronology) {
  let status = String(character.status);
  let from = "";
  let deadFrom = "";
  if (chronology.numbers.has(chapterId) && statusProgressions(character).length > 0) {
    for (const change of entityStateAt(character.frontmatter, chapterId, chronology).changes) {
      if (change.field !== "status") {
        continue;
      }
      const value = String(change.value);
      if (value === "deceased" && status !== "deceased") {
        deadFrom = change.from;
      }
      status = value;
      from = change.from;
    }
  }
  return { status, from, deadFrom };
}

// Whether the character is dead during chapter `chapterId` by their status
// rather than by died-in: { from: "" } dead since before the story (no
// died-in), { from } dead by a status progression that took effect in an
// earlier chapter, or null. With died-in, only a progression death after
// revived-in counts; the died-in window covers the first.
export function progressionDeathAt(character, chapterId, chronology) {
  const from = progressionDeathFrom(character, chapterId, chronology);
  if (from === null || (from !== "" && !happensAfter(chronology, chapterId, from))) {
    return null;
  }
  return { from };
}

// Where the character's current death by status began at chapter
// `chapterId`, including in that chapter itself: "" for dead since before
// the story, a chapter id for a progression death, or null when they are not
// dead by status (see progressionDeathAt).
export function progressionDeathFrom(character, chapterId, chronology) {
  const { status, deadFrom } = progressionStatusAt(character, chapterId, chronology);
  if (status !== "deceased" || (character.diedIn && deadFrom === "")) {
    return null;
  }
  if (character.diedIn && (character.revivedIn === "" || !happensAfter(chronology, deadFrom, character.revivedIn))) {
    return null;
  }
  return deadFrom;
}

// A character's deaths and revivals across the whole book, as
// { deadAtStart, deadAtEnd, events }. `events` lists each change in story
// order as { type: "death" | "revival", chapter, source }, where `source` is
// "died-in", "revived-in", or "progression". A character is dead by the end
// of a chapter from their died-in chapter until revived-in, and from the
// chapter a status progression makes them deceased until one changes it
// back; `status: deceased` with no died-in is dead before the story, as it
// is with died-in when a status progression brings them back first. These
// match the cast checks, so the death chapter itself ends dead and the
// revival chapter ends alive, except that planned `outline` chapters count
// here. Series and diagram read the end of the book with that death still
// in the plan. Continuity's cast check does not: an outline `died-in` is
// not in force until that chapter is drafted.
//
// With no chapters, or a died-in the book has no chapter for, there is no
// timeline to place a death on, so the frontmatter status alone decides:
// deceased is dead throughout, with no events.
export function characterLifeline(character, bookChronology) {
  // The lifeline reads the whole book in one order, so a branching book is
  // read in chapter-number order.
  const chronology = bookChronology.linear ?? bookChronology;
  const status = String(character.status ?? "");
  const chapters = storyOrder(chronology);
  if (chapters.length === 0 || (character.diedIn && !chronology.numbers.has(character.diedIn))) {
    const dead = status === "deceased";
    return { deadAtStart: dead, deadAtEnd: dead, events: [] };
  }
  // With died-in, `status: deceased` normally records that written death.
  // A status progression away from deceased before died-in says instead that
  // the character opens the book dead and comes back before dying again, as
  // a sequel records a character killed in an earlier book.
  const leadIn = status === "deceased" && Boolean(character.diedIn)
    && statusProgressions(character).some(({ from, value }) => value !== "deceased" && happensAfter(chronology, character.diedIn, from));
  const deadAtStart = status === "deceased" && (!character.diedIn || leadIn);
  if (!character.diedIn && statusProgressions(character).length === 0) {
    return { deadAtStart, deadAtEnd: deadAtStart, events: [] };
  }
  const window = deathWindow(character, chronology, { planned: true });
  const events = [];
  let dead = deadAtStart;
  for (const chapter of chapters) {
    const byDiedIn = window !== null && (chapter === window.died || window.deadIn(chapter));
    // Before died-in, a lead-in death holds until a status progression
    // changes it.
    const beforeDeath = leadIn && happensAfter(chronology, window.died, chapter) && progressionStatusAt(character, chapter, chronology).status === "deceased";
    const now = byDiedIn || beforeDeath || progressionDeathFrom(character, chapter, chronology) !== null;
    // A revival needs a cause: revived-in, or a status progression that set
    // the status the character now has. Dates on only some chapters can
    // order a chapter between two others that disagree about it, which would
    // otherwise read the frontmatter status there as a return to life.
    if (!now && dead && chapter !== window?.revived && progressionStatusAt(character, chapter, chronology).from === "") {
      continue;
    }
    if (now !== dead) {
      events.push(now
        ? { type: "death", chapter, source: chapter === window?.died ? "died-in" : "progression" }
        : { type: "revival", chapter, source: chapter === window?.revived ? "revived-in" : "progression" });
      dead = now;
    }
  }
  return { deadAtStart, deadAtEnd: dead, events };
}

// Whether a lifeline has the character come back to life in or before
// chapter `chapterId`: a revival event in that chapter or an earlier one. A
// chapter the book does not have gets no revival.
export function revivedBy(lifeline, chapterId, bookChronology) {
  const chronology = bookChronology.linear ?? bookChronology;
  return chronology.numbers.has(chapterId) && lifeline.events.some((event) => event.type === "revival" && !happensAfter(chronology, event.chapter, chapterId));
}

// Every chapter in story order: by date where both are dated, else by number.
function storyOrder(chronology) {
  return [...chronology.numbers.keys()]
    .sort((left, right) => chronology.numbers.get(left) - chronology.numbers.get(right) || (left < right ? -1 : left > right ? 1 : 0))
    .sort((left, right) => (chronology.after(left, right) ? 1 : chronology.after(right, left) ? -1 : 0));
}

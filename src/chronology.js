import { parseStoryDate } from "./continuity.js";
import { branchGraph } from "./scan.js";

// Story-time order of chapters, shared by the death, knowledge, and state
// checks. A chapter's date is its own `date`, else the earliest dated scene
// in it. Two chapters that are both dated compare by date, so a 2034
// prologue read first comes after a 2024 chapter 3, and a dual-timeline book
// compares its 1990 and 2020 strands correctly. An undated chapter happens
// after every chapter read before it, and on the same day chapters compare
// by chapter number (reading order); see storyOrder.
export function chapterChronology(project) {
  const numbers = new Map(project.chapters.map((chapter) => [chapter.id, chapter.number]));
  const days = new Map();
  for (const chapter of project.chapters) {
    const parsed = parseStoryDate(String(chapter.date ?? ""), project.calendar);
    if (parsed) {
      days.set(chapter.id, parsed.days);
    }
  }
  const sceneDays = new Map();
  for (const scene of project.scenes) {
    const parsed = parseStoryDate(String(scene.date ?? ""), project.calendar);
    if (parsed && numbers.has(scene.chapter) && !days.has(scene.chapter)) {
      sceneDays.set(scene.chapter, Math.min(sceneDays.get(scene.chapter) ?? Infinity, parsed.days));
    }
  }
  for (const [id, value] of sceneDays) {
    days.set(id, value);
  }
  const outline = new Set(project.chapters.filter((chapter) => chapter.status === "outline").map((chapter) => chapter.id));
  const linear = { ...chronologyFrom(numbers, days), outline };
  const graph = project.chapters.length > 0 ? branchGraph(project) : null;
  if (!graph || !graph.branching) {
    return linear;
  }
  return { ...pathChronology(linear, graph.passages), outline, linear };
}

// A branching book's chronology: chapters compare only along a path of
// choices, so a death, fact, or change on one branch does not reach its
// sibling branches. `after(later, earlier)` is true when `later` follows
// `earlier` on some path from the first chapter: by date when both are dated
// on different days (a flashback reached later stays earlier), otherwise by
// the choices. Two chapters in the same loop, each reaching the other,
// compare as a linear book does, by date then number. A chapter no path
// reaches compares with everything by date then number, as before the
// choices were written. `compare` is the total order for sorting, by story
// date and then the reading rank below, and `linear` keeps the number-order
// chronology for checking and rewriting progressions lists.
function pathChronology(linear, passages) {
  const { numbers, days } = linear;
  const links = new Map(passages.map((passage) => [passage.chapter.id, passage.links.map((link) => link.to)]));
  const downstream = new Map();
  // The chapters reachable from `from` by one or more choices, skipping the
  // chapters in `avoid` (an id or a set of ids) when given.
  const reach = (from, avoid = "") => {
    const blocked = avoid instanceof Set ? avoid : new Set([avoid]);
    const seen = new Set();
    const queue = [...(links.get(from) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift();
      if (seen.has(id) || blocked.has(id)) {
        continue;
      }
      seen.add(id);
      queue.push(...(links.get(id) ?? []));
    }
    return seen;
  };
  const reaches = (from, to) => {
    if (!downstream.has(from)) {
      downstream.set(from, reach(from));
    }
    return downstream.get(from).has(to);
  };
  const start = passages[0].chapter.id;
  const onPath = new Set([start, ...reach(start)]);
  const placed = (id) => onPath.has(id);
  // The order two chapters on paths are read in: 1 when `later` comes after
  // `earlier`, 0 when neither path leads from one to the other, and null
  // when each leads to the other (a loop).
  const pathOrder = (later, earlier) => {
    const forward = reaches(earlier, later);
    const back = reaches(later, earlier);
    if (forward && back) {
      return null;
    }
    return forward ? 1 : back ? -1 : 0;
  };
  const after = (later, earlier) => {
    if (later === earlier) {
      return false;
    }
    if (!placed(later) || !placed(earlier)) {
      return linear.after(later, earlier);
    }
    const order = pathOrder(later, earlier);
    if (order === 0) {
      return false;
    }
    const laterDays = days.get(later);
    const earlierDays = days.get(earlier);
    if (laterDays !== undefined && earlierDays !== undefined && laterDays !== earlierDays) {
      return laterDays > earlierDays;
    }
    return order === null ? numbers.get(later) > numbers.get(earlier) : order === 1;
  };
  // Reading order: `later` is read after `earlier` on some path.
  const readAfter = (later, earlier) => {
    if (!placed(later) || !placed(earlier)) {
      return numbers.get(later) > numbers.get(earlier);
    }
    const order = pathOrder(later, earlier);
    return order === null ? numbers.get(later) > numbers.get(earlier) : order === 1;
  };
  // A total reading order for sorting (`compare` adds dates to it): a
  // topological order of the choices from the first chapter, taking the
  // lowest-numbered ready chapter first, and inside a loop (or for chapters
  // no path reaches) the lowest-numbered chapter left.
  const rank = new Map();
  const ids = [...numbers.keys()].sort((left, right) => numbers.get(left) - numbers.get(right) || (left < right ? -1 : left > right ? 1 : 0));
  const incoming = new Map(ids.map((id) => [id, 0]));
  for (const id of ids) {
    for (const to of new Set(links.get(id) ?? [])) {
      if (to !== id && incoming.has(to)) {
        incoming.set(to, incoming.get(to) + 1);
      }
    }
  }
  while (rank.size < ids.length) {
    const left = ids.filter((id) => !rank.has(id));
    const next = left.find((id) => id === start && !rank.size) ?? left.find((id) => incoming.get(id) === 0) ?? left[0];
    rank.set(next, rank.size);
    for (const to of new Set(links.get(next) ?? [])) {
      if (to !== next && incoming.has(to)) {
        incoming.set(to, incoming.get(to) - 1);
      }
    }
  }
  const { compare, order } = storyOrder([...rank.keys()], numbers, days);
  return {
    numbers,
    days,
    branching: true,
    after,
    compare,
    order,
    atOrBefore: (earlier, later) => earlier === later || after(later, earlier),
    readBy: (earlier, later) => numbers.has(earlier) && numbers.has(later) && (earlier === later || readAfter(later, earlier)),
    // `later` is read strictly after `earlier` on some path.
    readAfter: (later, earlier) => numbers.has(later) && numbers.has(earlier) && readAfter(later, earlier),
    placed,
    // Whether some path of choices leads from `from` to `to` without
    // passing through `avoid`.
    reachesAvoiding: (from, to, avoid) => reach(from, avoid).has(to)
  };
}

// The story-time order over chapter numbers and days, as { numbers, days,
// after, compare, order }. `compare` is the total order storyOrder builds,
// `after(later, earlier)` is true when chapter `later` comes strictly after
// chapter `earlier` in it, and `order` lists the chapters in it.
export function chronologyFrom(numbers, days) {
  const reading = [...numbers.keys()].sort((left, right) => numbers.get(left) - numbers.get(right) || (left < right ? -1 : left > right ? 1 : 0));
  const { compare, order } = storyOrder(reading, numbers, days);
  const after = (later, earlier) => compare(later, earlier) > 0;
  return {
    numbers,
    days,
    branching: false,
    after,
    compare,
    order,
    // `earlier` happens at or before `later` in story time.
    atOrBefore: (earlier, later) => !after(earlier, later),
    // `earlier` is read at or before `later`: by chapter number.
    readBy: (earlier, later) => numbers.has(earlier) && numbers.has(later) && numbers.get(earlier) <= numbers.get(later)
  };
}

// The number in a planned chapter id (`chapter-NN`, for a chapter not
// written yet), or NaN for any other id, or one too long to be a number.
export function plannedChapterNumber(id) {
  const match = /^chapter-(\d+)$/.exec(id);
  const number = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : Number.NaN;
}

// The total story order over the written chapters in `reading`, listed in
// reading order, and planned `chapter-NN` ids, as `compare` (-1, 0, or 1)
// and `order`, the written chapters in it. Each chapter's story date is its
// own date, else the latest date among the chapters read before it (before
// every date when there is none), and chapters compare by story date, then
// by their place in `reading`. So an undated chapter happens after every
// chapter read before it, and a flashback dated before an earlier chapter
// comes before the undated chapters read since then too. Two chapters
// compare as the plain rule says (by date when both are dated, else by
// number), except where that rule goes in a circle: with chapter 2 dated a
// day after chapter 5 and chapters 3 and 4 undated, 3 comes after 2 and 5
// after 4 by number, but 2 after 5 by date. Array.prototype.sort orders such
// a circle differently in Bun and Node; here 5 comes before 2, 3, and 4.
// A planned chapter is placed as an undated one read just after the
// last-read written chapter numbered below it; planned chapters sharing a
// place go by number. Callers leave out ids that are neither.
function storyOrder(reading, numbers, days) {
  const keys = new Map();
  // latest[i]: the latest date among the first i + 1 chapters read.
  const latest = [];
  let reached = -Infinity;
  reading.forEach((id, index) => {
    const day = days.get(id) ?? reached;
    keys.set(id, [day, index, 0, id]);
    reached = Math.max(reached, day);
    latest.push(reached);
  });
  // The written chapters by number, each with the last place in `reading`
  // among them and those numbered below, for placing planned chapters.
  const byNumber = [...reading].sort((left, right) => numbers.get(left) - numbers.get(right));
  const lastRead = [];
  for (const id of byNumber) {
    lastRead.push(Math.max(lastRead.at(-1) ?? -1, keys.get(id)[1]));
  }
  const plannedKey = (id) => {
    const number = plannedChapterNumber(id);
    let below = 0;
    let above = byNumber.length;
    while (below < above) {
      const middle = (below + above) >> 1;
      if (numbers.get(byNumber[middle]) < number) {
        below = middle + 1;
      } else {
        above = middle;
      }
    }
    const place = below === 0 ? -1 : lastRead[below - 1];
    return [place === -1 ? -Infinity : latest[place], place + 0.5, number, id];
  };
  const key = (id) => {
    if (!keys.has(id)) {
      keys.set(id, plannedKey(id));
    }
    return keys.get(id);
  };
  const compare = (left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    const at = leftKey.findIndex((value, index) => value !== rightKey[index]);
    return at === -1 ? 0 : leftKey[at] < rightKey[at] ? -1 : 1;
  };
  return { compare, order: [...reading].sort(compare) };
}

// The chronology a whole-book read walks (the series and diagram
// lifelines, and the second-death checks that read them): every chapter in
// one order, `order`, with `after` comparing places in it. A linear book's
// chronology already is one. A branching book is read in its `compare`
// order, by story date and then reading rank, rather than path by path.
const ORDERED = new WeakMap();

export function orderedChronology(chronology) {
  if (!chronology.branching) {
    return chronology;
  }
  if (!ORDERED.has(chronology)) {
    const { numbers, days, outline, compare, order } = chronology;
    const after = (later, earlier) => compare(later, earlier) > 0;
    ORDERED.set(chronology, { numbers, days, outline, branching: false, compare, order, after, atOrBefore: (earlier, later) => !after(earlier, later) });
  }
  return ORDERED.get(chronology);
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
  if (!chronology.numbers.has(learnedIn) || !chronology.atOrBefore(learnedIn, atChapterId)) {
    return null;
  }
  return chronology.readBy(learnedIn, atChapterId) ? "reader" : "character";
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
      if (!chronology.branching || revived === "" || ![chapterId, died, revived].every(chronology.placed)) {
        return revived === "" || chronology.after(revived, chapterId);
      }
      // In a branching book the revival only counts on its own paths: still
      // dead when the revival is on another branch or later, or when some
      // path from the death reaches the chapter without passing it.
      if (chapterId === revived) {
        return false;
      }
      return !chronology.after(chapterId, revived) || chronology.reachesAvoiding(died, chapterId, revived);
    }
  };
}

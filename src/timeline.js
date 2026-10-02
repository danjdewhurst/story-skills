import path from "node:path";
import { parseClockDate, parseClockTime, readingUnits } from "./continuity.js";
import { compareText } from "./languages/locale.js";
import { roundedShares } from "./plural.js";

// Read-only views over the project: story events in chronological order,
// POV balance, and each character's presence across chapters. Nothing here
// is a finding; `story continuity` owns the clock checks.

export function buildTimeline(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  // A chapter with no scene records stands in for its own scenes, and scenes
  // whose chapter file is missing are kept, as story continuity reads them.
  const entries = readingUnits(project).map((unit, reading) => timelineEntry(project, unit, reading));

  const dated = orderByStoryTime(entries.filter((entry) => entry.days !== undefined));
  markToldLate(dated);

  return {
    chronology: dated,
    undated: entries.filter((entry) => entry.days === undefined),
    pov: povBalance(chapters, project.pack),
    presence: characterPresence(project, chapters, chapterById)
  };
}

// Within a day, timed entries run in time order. An untimed entry could fall
// at any time that day, so it keeps its reading position: it follows the
// timed entry read just before it, or opens the day when none was.
function orderByStoryTime(dated) {
  const days = new Map();
  for (const entry of dated) {
    const list = days.get(entry.days) ?? [];
    list.push(entry);
    days.set(entry.days, list);
  }
  const ordered = [];
  for (const day of [...days.keys()].sort((left, right) => left - right)) {
    const list = days.get(day);
    const timed = list.filter((entry) => entry.minutes !== undefined)
      .sort((left, right) => left.minutes - right.minutes || left.reading - right.reading);
    const following = new Map();
    const opening = [];
    for (const entry of list.filter((item) => item.minutes === undefined)) {
      let before = null;
      for (const candidate of timed) {
        if (candidate.reading < entry.reading && (before === null || candidate.reading > before.reading)) {
          before = candidate;
        }
      }
      if (before === null) {
        opening.push(entry);
      } else {
        following.set(before, [...(following.get(before) ?? []), entry]);
      }
    }
    ordered.push(...opening);
    for (const entry of timed) {
      ordered.push(entry, ...(following.get(entry) ?? []));
    }
  }
  return ordered;
}

// An entry is told out of order when something that happens strictly after
// it in story time was read before it: a later day, or a later time on the
// same day when both entries have a time.
function markToldLate(dated) {
  let earliestLaterDay = Infinity;
  let index = dated.length;
  while (index > 0) {
    let start = index - 1;
    while (start > 0 && dated[start - 1].days === dated[index - 1].days) {
      start -= 1;
    }
    const day = dated.slice(start, index);
    const timed = day.filter((entry) => entry.minutes !== undefined)
      .sort((left, right) => right.minutes - left.minutes);
    let earliestLaterTime = Infinity;
    let group = [];
    let groupMinutes;
    const flush = () => {
      for (const entry of group) {
        earliestLaterTime = Math.min(earliestLaterTime, entry.reading);
      }
      group = [];
    };
    const laterTime = new Map();
    for (const entry of timed) {
      if (entry.minutes !== groupMinutes) {
        flush();
        groupMinutes = entry.minutes;
      }
      laterTime.set(entry, earliestLaterTime);
      group.push(entry);
    }
    for (const entry of day) {
      entry.toldLate = entry.reading > earliestLaterDay || entry.reading > (laterTime.get(entry) ?? Infinity);
    }
    for (const entry of day) {
      earliestLaterDay = Math.min(earliestLaterDay, entry.reading);
    }
    index = start;
  }
}

function timelineEntry(project, { unit, chapter, isChapter, orphan }, reading) {
  // Scenes carry their own timestamps; a chapter's date and time only apply
  // to the chapter-level entry that stands in for a chapter with no scenes,
  // matching how story continuity reads them.
  const parsedDate = parseClockDate(unit.date || "");
  const time = unit.time;
  const minutes = parseClockTime(time || "");
  return {
    id: unit.id,
    file: path.relative(project.root, unit.file),
    title: unit.title,
    chapterNumber: Number.isFinite(chapter.number) ? chapter.number : chapter.id,
    // Set when the scene's chapter has no chapter file.
    orphanOf: orphan ? chapter.id : "",
    pov: unit.pov || chapter.pov || "",
    location: isChapter ? chapter.locations[0] ?? "" : unit.location,
    date: parsedDate?.text ?? "",
    time: minutes === undefined ? "" : time.trim(),
    days: parsedDate?.days,
    // Undefined when the entry has no time: it spans its whole day.
    minutes,
    flashbackTo: isChapter ? "" : unit.flashbackTo,
    reading
  };
}

function povBalance(chapters, pack) {
  const totals = new Map();
  let words = 0;
  for (const chapter of chapters) {
    const key = chapter.pov || "unspecified";
    const entry = totals.get(key) ?? { pov: key, chapters: 0, words: 0 };
    entry.chapters += 1;
    entry.words += chapter.wordCount;
    words += chapter.wordCount;
    totals.set(key, entry);
  }
  return [...totals.values()]
    .map((entry) => ({ ...entry, share: words === 0 ? 0 : (entry.words * 100) / words }))
    .sort((left, right) => right.words - left.words || right.chapters - left.chapters || compareText(pack)(left.pov, right.pov));
}

// Presence counts a character in a chapter when the chapter or one of its
// scenes lists them under characters or as pov (mentions do not count). Absences are
// measured in chapter positions, so gaps in chapter numbering do not inflate
// them.
function characterPresence(project, chapters, chapterById) {
  const present = new Map(project.characters.map((character) => [character.id, new Set()]));
  const mark = (characterId, chapterId) => {
    if (present.has(characterId) && chapterById.has(chapterId)) {
      present.get(characterId).add(chapterId);
    }
  };
  for (const chapter of chapters) {
    [...chapter.characters, chapter.pov].forEach((characterId) => mark(characterId, chapter.id));
  }
  for (const scene of project.scenes) {
    [...scene.characters, scene.pov].forEach((characterId) => mark(characterId, scene.chapter));
  }

  const positions = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  return project.characters
    .map((character) => {
      const seen = [...present.get(character.id)].map((id) => positions.get(id)).sort((left, right) => left - right);
      let longestGap = 0;
      let gapAfter = null;
      for (let index = 1; index < seen.length; index += 1) {
        const gap = seen[index] - seen[index - 1] - 1;
        if (gap > longestGap) {
          longestGap = gap;
          gapAfter = chapters[seen[index - 1]].number;
        }
      }
      const trailing = seen.length === 0 ? 0 : chapters.length - 1 - seen[seen.length - 1];
      // A written death with no written revival explains the absence at the
      // end. A death or revival in an outline chapter is planned, not yet
      // written, as in continuity.
      const written = (chapterId) => chapterById.has(chapterId ?? "") && chapterById.get(chapterId).status !== "outline";
      const died = written(character.diedIn) && !written(character.revivedIn)
        ? chapterById.get(character.diedIn).number
        : null;
      return {
        id: character.id,
        chapters: seen.length,
        first: seen.length === 0 ? null : chapters[seen[0]].number,
        last: seen.length === 0 ? null : chapters[seen[seen.length - 1]].number,
        longestGap,
        gapAfter,
        trailing,
        died
      };
    })
    .sort((left, right) => right.chapters - left.chapters || left.id.localeCompare(right.id, "en"));
}

export function formatTimeline(timeline, totalChapters) {
  const lines = [`Timeline: ${timeline.chronology.length} dated, ${timeline.undated.length} undated`];

  lines.push("", "Chronology (story order):");
  if (timeline.chronology.length === 0) {
    lines.push("- None: add date (YYYY-MM-DD) and time to scenes or chapters to order them");
  }
  for (const entry of timeline.chronology) {
    const when = [entry.date, entry.time].filter(Boolean).join(" ");
    const notes = [];
    if (entry.toldLate) {
      notes.push(`told in chapter ${entry.chapterNumber}, after later events`);
    }
    if (entry.flashbackTo) {
      notes.push(`flashback to ${entry.flashbackTo}`);
    }
    if (entry.orphanOf) {
      notes.push(`no chapter file for ${entry.orphanOf}`);
    }
    lines.push(`- ${when}  ${entry.id}: ${entry.title}${describe(entry)}${notes.length === 0 ? "" : ` [${notes.join("; ")}]`}`);
  }

  if (timeline.undated.length > 0) {
    lines.push("", "Undated (reading order):");
    for (const entry of timeline.undated) {
      const orphan = entry.orphanOf ? ` [no chapter file for ${entry.orphanOf}]` : "";
      lines.push(`- ${entry.id}: ${entry.title}${describe(entry)}${orphan}`);
    }
  }

  lines.push("", "POV balance:");
  if (timeline.pov.length === 0) {
    lines.push("- None");
  }
  // Rounded so the shares add up to 100.
  const shares = roundedShares(timeline.pov.map((entry) => entry.words));
  for (const [index, entry] of timeline.pov.entries()) {
    lines.push(`- ${entry.pov}: ${plural(entry.chapters, "chapter")}, ${formatNumber(entry.words)} words (${shares[index]}%)`);
  }

  lines.push("", "Character presence:");
  if (timeline.presence.length === 0) {
    lines.push("- None");
  }
  for (const entry of timeline.presence) {
    if (entry.chapters === 0) {
      lines.push(`- ${entry.id}: not present in any chapter`);
      continue;
    }
    const span = entry.first === entry.last ? `chapter ${entry.first}` : `chapters ${entry.first}-${entry.last}`;
    const details = [`${entry.chapters} of ${totalChapters} chapters`, span];
    if (entry.longestGap > 0) {
      details.push(`longest absence ${plural(entry.longestGap, "chapter")} after chapter ${entry.gapAfter}`);
    }
    if (entry.died !== null && entry.died !== undefined) {
      details.push(`died in chapter ${entry.died}`);
    } else if (entry.trailing > 0) {
      details.push(`absent from the last ${plural(entry.trailing, "chapter")}`);
    }
    lines.push(`- ${entry.id}: ${details.join(", ")}`);
  }

  return `${lines.join("\n")}\n`;
}

function describe(entry) {
  const parts = [];
  if (entry.pov) {
    parts.push(`POV ${entry.pov}`);
  }
  if (entry.location) {
    parts.push(`at ${entry.location}`);
  }
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

import path from "node:path";
import { parseClockDate, parseClockTime } from "./continuity.js";

// Read-only views over the project: story events in chronological order,
// POV balance, and each character's presence across chapters. Nothing here
// is a finding; `story continuity` owns the clock checks.

export function buildTimeline(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const entries = [];

  for (const chapter of chapters) {
    const scenes = project.scenes
      .filter((scene) => scene.chapter === chapter.id)
      .sort((left, right) => left.scene - right.scene || left.id.localeCompare(right.id, "en"));
    // A chapter with no scene records stands in for its own scenes.
    const units = scenes.length === 0 ? [{ ...chapter, isChapter: true }] : scenes;
    for (const unit of units) {
      entries.push(timelineEntry(project, unit, chapter, entries.length));
    }
  }

  const dated = entries.filter((entry) => entry.days !== undefined)
    .sort((left, right) => left.days - right.days || left.minutes - right.minutes || left.reading - right.reading);
  // An entry is told out of order when something that happens after it in
  // story time was read before it.
  let earliestLaterReading = Infinity;
  for (let index = dated.length - 1; index >= 0; index -= 1) {
    const entry = dated[index];
    entry.toldLate = entry.reading > earliestLaterReading;
    earliestLaterReading = Math.min(earliestLaterReading, entry.reading);
  }

  return {
    chronology: dated,
    undated: entries.filter((entry) => entry.days === undefined),
    pov: povBalance(chapters),
    presence: characterPresence(project, chapters, chapterById)
  };
}

function timelineEntry(project, unit, chapter, reading) {
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
    chapterNumber: chapter.number,
    pov: unit.pov || chapter.pov || "",
    location: unit.isChapter ? chapter.locations[0] ?? "" : unit.location,
    date: parsedDate?.text ?? "",
    time: minutes === undefined ? "" : time.trim(),
    days: parsedDate?.days,
    minutes: minutes ?? 0,
    flashbackTo: unit.isChapter ? "" : unit.flashbackTo,
    reading
  };
}

function povBalance(chapters) {
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
    .sort((left, right) => right.words - left.words || right.chapters - left.chapters || left.pov.localeCompare(right.pov, "en"));
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
      return {
        id: character.id,
        chapters: seen.length,
        first: seen.length === 0 ? null : chapters[seen[0]].number,
        last: seen.length === 0 ? null : chapters[seen[seen.length - 1]].number,
        longestGap,
        gapAfter,
        trailing
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
    lines.push(`- ${when}  ${entry.id}: ${entry.title}${describe(entry)}${notes.length === 0 ? "" : ` [${notes.join("; ")}]`}`);
  }

  if (timeline.undated.length > 0) {
    lines.push("", "Undated (reading order):");
    for (const entry of timeline.undated) {
      lines.push(`- ${entry.id}: ${entry.title}${describe(entry)}`);
    }
  }

  lines.push("", "POV balance:");
  if (timeline.pov.length === 0) {
    lines.push("- None");
  }
  for (const entry of timeline.pov) {
    lines.push(`- ${entry.pov}: ${plural(entry.chapters, "chapter")}, ${formatNumber(entry.words)} words (${Math.round(entry.share)}%)`);
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
    if (entry.trailing > 0) {
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

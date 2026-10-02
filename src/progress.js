import { parseClockDate } from "./continuity.js";

// Progress in words or characters against the book target, per-chapter targets, the
// deadline, and the session log in progress.md. Pure functions: story.js
// reads and writes the files.

export const PROGRESS_FILE = "progress.md";
const PACE_SESSIONS = 7;

// Projections further out than this are not a date anyone can plan by.
const PROJECTION_HORIZON_DAYS = 100 * 366;

// Adds or replaces the log entry for `date` and keeps entries in date order.
// Existing entries are kept as written, extra fields and all; only the
// entry for `date` changes its counts. `counts` is { words }, plus
// { characters } for a project counted in characters.
export function withSession(sessions, date, counts) {
  let found = false;
  const kept = (Array.isArray(sessions) ? sessions : []).map((session) => {
    if (!found && session && typeof session === "object" && sessionDate(session) === date) {
      found = true;
      return { ...session, ...counts };
    }
    return session;
  });
  if (!found) {
    kept.push({ date, ...counts });
  }
  return kept.sort((left, right) => sessionDate(left).localeCompare(sessionDate(right), "en"));
}

function sessionDate(session) {
  return String(session?.date ?? "").trim();
}

// Valid sessions only, in date order, as { date, words, characters }, with
// `characters` null when the entry has none (one logged while the book was
// counted in words); validate reports the malformed ones.
export function cleanSessions(value) {
  const sessions = [];
  const count = (number) => Number.isInteger(number) && number >= 0;
  for (const entry of Array.isArray(value) ? value : []) {
    if (entry && typeof entry === "object" && parseClockDate(sessionDate(entry)) && count(entry.words)) {
      sessions.push({ date: sessionDate(entry), words: entry.words, characters: count(entry.characters) ? entry.characters : null });
    }
  }
  return sessions.sort((left, right) => left.date.localeCompare(right.date, "en"));
}

// Progress in the count unit (`unit`, "words" or "characters"). `words`
// stays the word count in every book and `characterCount` is the character
// count, or null in a book counted in words; `target`, `percent`,
// `remaining`, `perDay`, `since`, and `pace` are in the unit. Chapters and
// the last session carry both counts too. A session without the unit's
// count (one logged before the book was counted in characters) is left out
// of `sessions`, the last session, and the pace.
export function computeProgress({ unit = "words", words, characters = null, target, deadline, today, chapters, sessions }) {
  const characterBook = unit === "characters";
  const inUnit = (entry) => (characterBook ? entry.characters ?? null : entry.words);
  const length = characterBook ? characters : words;
  const measured = (Array.isArray(sessions) ? sessions : []).filter((session) => inUnit(session) !== null);
  const todayDays = parseClockDate(today).days;
  const result = {
    unit,
    words,
    characterCount: characterBook ? characters : null,
    target: target ?? null,
    percent: target ? (length * 100) / target : null,
    remaining: target ? Math.max(0, target - length) : null,
    deadline: null,
    chapters: chapters
      .filter((chapter) => chapter.target > 0)
      .map((chapter) => ({
        id: chapter.id,
        words: chapter.words,
        characterCount: characterBook ? chapter.characters : null,
        target: chapter.target,
        percent: (inUnit(chapter) * 100) / chapter.target
      })),
    sessions: measured.length,
    lastSession: null,
    pace: null,
    projected: null
  };

  const deadlineDate = deadline ? parseClockDate(deadline) : undefined;
  if (deadlineDate) {
    const daysLeft = deadlineDate.days - todayDays;
    result.deadline = {
      date: deadlineDate.text,
      daysLeft,
      // On the deadline day everything left is needed today.
      perDay: result.remaining !== null && daysLeft >= 0 ? Math.ceil(result.remaining / Math.max(daysLeft, 1)) : null
    };
  }

  if (measured.length > 0) {
    const last = measured[measured.length - 1];
    result.lastSession = { date: last.date, words: last.words, characterCount: characterBook ? last.characters : null, since: length - inUnit(last) };
    // Pace is measured across the most recent sessions, per calendar day.
    const recent = measured.slice(-PACE_SESSIONS);
    const span = parseClockDate(recent[recent.length - 1].date).days - parseClockDate(recent[0].date).days;
    if (recent.length > 1 && span > 0) {
      result.pace = (inUnit(recent[recent.length - 1]) - inUnit(recent[0])) / span;
      // A pace that rounds to 0 a day, or a finish past the horizon,
      // projects nothing.
      const daysNeeded = Math.ceil(result.remaining / result.pace);
      if (result.remaining > 0 && Math.round(result.pace) > 0 && daysNeeded <= PROJECTION_HORIZON_DAYS) {
        result.projected = formatDate(todayDays + daysNeeded);
      }
    }
  }
  return result;
}

export function formatProgress(progress) {
  const characters = progress.unit === "characters";
  const noun = characters ? "character" : "word";
  const count = (entry) => (characters ? entry.characterCount : entry.words);
  const lines = [];
  if (progress.target === null) {
    lines.push(`Progress: ${formatNumber(count(progress))} ${noun}s (no target-${noun}s in story.md)`);
  } else {
    lines.push(`Progress: ${formatNumber(count(progress))} of ${formatNumber(progress.target)} ${noun}s (${formatPercent(progress.percent, 1)}%)`);
    lines.push(`Remaining: ${plural(progress.remaining, noun, formatNumber)}`);
  }

  if (progress.deadline) {
    const { date, daysLeft, perDay } = progress.deadline;
    if (daysLeft < 0) {
      lines.push(`Deadline: ${date} passed ${plural(-daysLeft, "day")} ago`);
    } else if (perDay === null) {
      lines.push(`Deadline: ${date} (${daysLeft === 0 ? "today" : `${plural(daysLeft, "day")} left`})`);
    } else if (daysLeft === 0) {
      lines.push(`Deadline: ${date} (today): ${plural(perDay, noun, formatNumber)} needed`);
    } else {
      lines.push(`Deadline: ${date} (${plural(daysLeft, "day")} left): ${formatNumber(perDay)} ${noun}s a day needed`);
    }
  }

  if (progress.lastSession) {
    const { date, since } = progress.lastSession;
    lines.push(`Sessions: ${progress.sessions} logged; last ${date} (${since >= 0 ? "+" : ""}${formatNumber(since)} ${noun}s since)`);
  } else {
    lines.push("Sessions: none logged (run story progress --log after a writing session)");
  }
  if (progress.pace !== null) {
    lines.push(`Pace: ${formatNumber(Math.round(progress.pace))} ${noun}s a day over the last ${Math.min(progress.sessions, PACE_SESSIONS)} sessions`);
  }
  if (progress.projected) {
    lines.push(`Projected finish at this pace: ${progress.projected}`);
  }

  if (progress.chapters.length > 0) {
    lines.push("", "Chapter targets:");
    for (const chapter of progress.chapters) {
      lines.push(`- ${chapter.id}: ${formatNumber(count(chapter))} of ${formatNumber(chapter.target)} ${noun}s (${formatPercent(chapter.percent, 0)}%)`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function formatDate(days) {
  return new Date(days * 86400000).toISOString().slice(0, 10);
}

function plural(count, noun, format = String) {
  return `${format(count)} ${noun}${count === 1 ? "" : "s"}`;
}

// Rounds a share of a target without claiming 100% (or 0%) before it is
// reached: 99.8 prints as 99 at whole percents, not 100.
export function formatPercent(percent, places) {
  const scale = 10 ** places;
  let value = Math.round(percent * scale) / scale;
  if (value >= 100 && percent < 100) {
    value = Math.floor(percent * scale) / scale;
  }
  return value.toFixed(places);
}

function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

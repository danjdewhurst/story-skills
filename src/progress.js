import { parseClockDate } from "./continuity.js";

// Word-count progress against the book target, per-chapter targets, the
// deadline, and the session log in progress.md. Pure functions: story.js
// reads and writes the files.

export const PROGRESS_FILE = "progress.md";
const PACE_SESSIONS = 7;

// Projections further out than this are not a date anyone can plan by.
const PROJECTION_HORIZON_DAYS = 100 * 366;

// Adds or replaces the log entry for `date` and keeps entries in date order.
// Existing entries are kept as written, extra fields and all; only the
// entry for `date` changes its word count.
export function withSession(sessions, date, words) {
  let found = false;
  const kept = (Array.isArray(sessions) ? sessions : []).map((session) => {
    if (!found && session && typeof session === "object" && sessionDate(session) === date) {
      found = true;
      return { ...session, words };
    }
    return session;
  });
  if (!found) {
    kept.push({ date, words });
  }
  return kept.sort((left, right) => sessionDate(left).localeCompare(sessionDate(right), "en"));
}

function sessionDate(session) {
  return String(session?.date ?? "").trim();
}

// Valid sessions only, in date order; validate reports the malformed ones.
export function cleanSessions(value) {
  const sessions = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (entry && typeof entry === "object" && parseClockDate(sessionDate(entry)) && Number.isInteger(entry.words) && entry.words >= 0) {
      sessions.push({ date: sessionDate(entry), words: entry.words });
    }
  }
  return sessions.sort((left, right) => left.date.localeCompare(right.date, "en"));
}

export function computeProgress({ words, target, deadline, today, chapters, sessions }) {
  const todayDays = parseClockDate(today).days;
  const result = {
    words,
    target: target ?? null,
    percent: target ? (words * 100) / target : null,
    remaining: target ? Math.max(0, target - words) : null,
    deadline: null,
    chapters: chapters
      .filter((chapter) => chapter.target > 0)
      .map((chapter) => ({ ...chapter, percent: (chapter.words * 100) / chapter.target })),
    sessions: sessions.length,
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

  if (sessions.length > 0) {
    const last = sessions[sessions.length - 1];
    result.lastSession = { date: last.date, words: last.words, since: words - last.words };
    // Pace is measured across the most recent sessions, per calendar day.
    const recent = sessions.slice(-PACE_SESSIONS);
    const span = parseClockDate(recent[recent.length - 1].date).days - parseClockDate(recent[0].date).days;
    if (recent.length > 1 && span > 0) {
      result.pace = (recent[recent.length - 1].words - recent[0].words) / span;
      // A pace that rounds to 0 words a day, or a finish past the horizon,
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
  const lines = [];
  if (progress.target === null) {
    lines.push(`Progress: ${formatNumber(progress.words)} words (no target-words in story.md)`);
  } else {
    lines.push(`Progress: ${formatNumber(progress.words)} of ${formatNumber(progress.target)} words (${formatPercent(progress.percent, 1)}%)`);
    lines.push(`Remaining: ${plural(progress.remaining, "word", formatNumber)}`);
  }

  if (progress.deadline) {
    const { date, daysLeft, perDay } = progress.deadline;
    if (daysLeft < 0) {
      lines.push(`Deadline: ${date} passed ${plural(-daysLeft, "day")} ago`);
    } else if (perDay === null) {
      lines.push(`Deadline: ${date} (${daysLeft === 0 ? "today" : `${plural(daysLeft, "day")} left`})`);
    } else if (daysLeft === 0) {
      lines.push(`Deadline: ${date} (today): ${plural(perDay, "word", formatNumber)} needed`);
    } else {
      lines.push(`Deadline: ${date} (${plural(daysLeft, "day")} left): ${formatNumber(perDay)} words a day needed`);
    }
  }

  if (progress.lastSession) {
    const { date, since } = progress.lastSession;
    lines.push(`Sessions: ${progress.sessions} logged; last ${date} (${since >= 0 ? "+" : ""}${formatNumber(since)} words since)`);
  } else {
    lines.push("Sessions: none logged (run story progress --log after a writing session)");
  }
  if (progress.pace !== null) {
    lines.push(`Pace: ${formatNumber(Math.round(progress.pace))} words a day over the last ${Math.min(progress.sessions, PACE_SESSIONS)} sessions`);
  }
  if (progress.projected) {
    lines.push(`Projected finish at this pace: ${progress.projected}`);
  }

  if (progress.chapters.length > 0) {
    lines.push("", "Chapter targets:");
    for (const chapter of progress.chapters) {
      lines.push(`- ${chapter.id}: ${formatNumber(chapter.words)} of ${formatNumber(chapter.target)} words (${formatPercent(chapter.percent, 0)}%)`);
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

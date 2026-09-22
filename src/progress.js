import { parseClockDate } from "./continuity.js";

// Word-count progress against the book target, per-chapter targets, the
// deadline, and the session log in progress.md. Pure functions: story.js
// reads and writes the files.

export const PROGRESS_FILE = "progress.md";
const PACE_SESSIONS = 7;

// Adds or replaces the log entry for `date` and keeps entries in date order.
export function withSession(sessions, date, words) {
  const kept = sessions.filter((session) => session.date !== date);
  kept.push({ date, words });
  return kept.sort((left, right) => left.date.localeCompare(right.date, "en"));
}

// Valid sessions only, in date order; validate reports the malformed ones.
export function cleanSessions(value) {
  const sessions = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (entry && typeof entry === "object" && parseClockDate(String(entry.date ?? "")) && Number.isInteger(entry.words) && entry.words >= 0) {
      sessions.push({ date: String(entry.date), words: entry.words });
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
      perDay: result.remaining !== null && daysLeft > 0 ? Math.ceil(result.remaining / daysLeft) : null
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
      if (result.remaining > 0 && result.pace > 0) {
        result.projected = formatDate(todayDays + Math.ceil(result.remaining / result.pace));
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
    lines.push(`Progress: ${formatNumber(progress.words)} of ${formatNumber(progress.target)} words (${progress.percent.toFixed(1)}%)`);
    lines.push(`Remaining: ${formatNumber(progress.remaining)} words`);
  }

  if (progress.deadline) {
    const { date, daysLeft, perDay } = progress.deadline;
    if (daysLeft < 0) {
      lines.push(`Deadline: ${date} passed ${plural(-daysLeft, "day")} ago`);
    } else if (perDay === null) {
      lines.push(`Deadline: ${date} (${plural(daysLeft, "day")} left)`);
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
      lines.push(`- ${chapter.id}: ${formatNumber(chapter.words)} of ${formatNumber(chapter.target)} words (${Math.round(chapter.percent)}%)`);
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

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

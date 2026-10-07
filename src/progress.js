import { parseClockDate, storyDateError } from "./continuity.js";
import { usageError } from "./exit-codes.js";
import { formatNextRelease } from "./release-schedule.js";

// Progress in words or characters against the book target, per-chapter targets, the
// deadline, and the session log in progress.md. Pure functions: story.js
// reads and writes the files.

export const PROGRESS_FILE = "progress.md";
const PACE_SESSIONS = 7;
const HISTORY_WEEKS = 4;
const MAX_HISTORY_WEEKS = 52;

// The weeks of history from --weeks: a whole number 1 to 52, default 4.
export function historyWeeks(options = {}) {
  const raw = options.weeks;
  if (raw === undefined) {
    return HISTORY_WEEKS;
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > MAX_HISTORY_WEEKS) {
    throw usageError(`--weeks must be a whole number 1 to ${MAX_HISTORY_WEEKS}, such as ${HISTORY_WEEKS}`, "weeks");
  }
  return Number(text);
}

// story.md writing-days entries, Monday first. Full names are accepted too.
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// The weekday of a writing-days entry ("mon" for mon, Mon, or Monday), or
// null for anything else.
export function weekdayName(value) {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim().toLowerCase();
  const index = WEEKDAY_NAMES.findIndex((name, position) => text === name || text === WEEKDAYS[position]);
  return index === -1 ? null : WEEKDAYS[index];
}

// The scheduled writing days from story.md writing-days, Monday first and
// without repeats, or null when the field is unset or holds no weekday.
export function writingDays(value) {
  const days = new Set((Array.isArray(value) ? value : []).map(weekdayName).filter((day) => day !== null));
  return days.size === 0 ? null : WEEKDAYS.filter((day) => days.has(day));
}

// Epoch days to the weekday, 0 for Monday: 1970-01-01 was a Thursday.
function weekdayIndex(days) {
  return (((days + 3) % 7) + 7) % 7;
}

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

// A session's date as written, or "" when it is not text: a list such as
// [2024-01-05] is not a date, though String would flatten it into one.
function sessionDate(session) {
  return typeof session?.date === "string" ? session.date.trim() : "";
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
export function computeProgress({ unit = "words", words, characters = null, target, deadline, today, chapters, sessions, dailyTarget = null, writingDays: scheduled = null, weeks = HISTORY_WEEKS }) {
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
    projected: null,
    daily: computeDaily({ measured: measured.map((session) => ({ date: session.date, count: inUnit(session) })), length, todayDays, dailyTarget, scheduled, weeks })
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

// Words written per day, today's against the daily target, the streak, and
// the last weeks, from the session log. Each session records the whole
// manuscript, so a day's words are the gain since the session before it;
// the first session is only the baseline. Today's words are measured live,
// from the manuscript now against the last session before today. A day
// counts toward the streak when it gained words (at least the daily target,
// when one is set). Days outside writing-days never break a streak, and
// today does not break it before it is written.
function computeDaily({ measured, length, todayDays, dailyTarget, scheduled, weeks: historyLength }) {
  const byDay = new Map();
  for (const session of measured) {
    const days = parseClockDate(session.date).days;
    if (days <= todayDays) {
      // A repeated date (which validate reports) keeps the later entry.
      byDay.set(days, session.count);
    }
  }
  const logged = [...byDay.keys()].sort((left, right) => left - right);
  const gains = new Map();
  for (let index = 1; index < logged.length; index += 1) {
    gains.set(logged[index], byDay.get(logged[index]) - byDay.get(logged[index - 1]));
  }
  const before = logged.filter((days) => days < todayDays);
  if (before.length > 0) {
    gains.set(todayDays, length - byDay.get(before[before.length - 1]));
  }

  const scheduledDays = scheduled === null ? null : new Set(scheduled);
  const isScheduled = (days) => scheduledDays === null || scheduledDays.has(WEEKDAYS[weekdayIndex(days)]);
  const counts = (days) => gains.has(days) && gains.get(days) > 0 && (dailyTarget === null || gains.get(days) >= dailyTarget);
  const first = logged.length > 0 ? logged[0] : todayDays;

  let current = 0;
  for (let days = counts(todayDays) ? todayDays : todayDays - 1; days >= first; days -= 1) {
    if (counts(days)) {
      current += 1;
    } else if (isScheduled(days)) {
      break;
    }
  }
  let longest = 0;
  let run = 0;
  for (let days = first; days <= todayDays; days += 1) {
    if (counts(days)) {
      run += 1;
      longest = Math.max(longest, run);
    } else if (isScheduled(days) && days !== todayDays) {
      run = 0;
    }
  }

  const written = gains.has(todayDays) ? gains.get(todayDays) : null;
  const monday = todayDays - weekdayIndex(todayDays);
  const weeks = [];
  for (let back = historyLength - 1; back >= 0; back -= 1) {
    const start = monday - back * 7;
    let total = 0;
    let days = 0;
    let planned = 0;
    for (let day = start; day < start + 7; day += 1) {
      if (gains.has(day)) {
        total += gains.get(day);
        days += gains.get(day) > 0 ? 1 : 0;
      }
      planned += isScheduled(day) ? 1 : 0;
    }
    weeks.push({ start: formatDate(start), end: formatDate(start + 6), written: total, days, target: dailyTarget === null ? null : dailyTarget * planned });
  }

  return {
    target: dailyTarget,
    writingDays: scheduled,
    today: {
      date: formatDate(todayDays),
      scheduled: isScheduled(todayDays),
      written,
      remaining: dailyTarget === null || written === null ? null : Math.max(0, dailyTarget - written),
      met: dailyTarget === null || written === null ? null : written >= dailyTarget
    },
    streak: { current, longest },
    weeks
  };
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

  const release = formatNextRelease(progress.release);
  if (release !== null) {
    lines.push(release);
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
  lines.push(...formatDaily(progress.daily, progress.lastSession !== null, noun));

  if (progress.chapters.length > 0) {
    lines.push("", "Chapter targets:");
    for (const chapter of progress.chapters) {
      lines.push(`- ${chapter.id}: ${formatNumber(count(chapter))} of ${formatNumber(chapter.target)} ${noun}s (${formatPercent(chapter.percent, 0)}%)`);
    }
  }
  return `${lines.join("\n")}\n`;
}

// Today against the daily target, the streak, and the weekly history. Only
// a project with a log or a daily target prints them.
function formatDaily(daily, hasSessions, noun) {
  if (!hasSessions && daily.target === null) {
    return [];
  }
  const lines = [];
  const { today, target } = daily;
  const off = today.scheduled ? "" : " (not a writing day)";
  if (today.written === null) {
    if (target !== null) {
      lines.push(`Today: ${formatNumber(target)} ${noun}s a day target (no session logged before today to measure from)${off}`);
    }
  } else {
    const gained = `${today.written >= 0 ? "+" : ""}${formatNumber(today.written)}`;
    if (target === null) {
      lines.push(`Today: ${gained} ${noun}s${off}`);
    } else {
      lines.push(`Today: ${gained} of ${formatNumber(target)} ${noun}s (${today.met ? "target met" : `${formatNumber(today.remaining)} to go`})${off}`);
    }
  }
  if (!hasSessions) {
    return lines;
  }
  const days = daily.writingDays === null ? "" : `; writing days ${daily.writingDays.join(", ")}`;
  lines.push(`Streak: ${plural(daily.streak.current, "day")} (longest ${formatNumber(daily.streak.longest)}${days})`);
  lines.push("", daily.weeks.length === 1 ? "This week:" : `Last ${daily.weeks.length} weeks:`);
  for (const week of daily.weeks) {
    const amount = week.target === null ? formatNumber(week.written) : `${formatNumber(week.written)} of ${formatNumber(week.target)}`;
    lines.push(`- ${week.start}: ${amount} ${noun}s on ${plural(week.days, "day")}`);
  }
  return lines;
}

// "Today" for `command` from its --date option, or the local date: a
// real YYYY-MM-DD day, else a usage error.
export function todayOption(date, command) {
  const today = date === undefined ? localDate() : String(date).trim();
  const dateError = storyDateError(today);
  if (dateError !== "" || today === "") {
    throw usageError(`${command} --date ${dateError || "must be a YYYY-MM-DD date"}`);
  }
  return today;
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

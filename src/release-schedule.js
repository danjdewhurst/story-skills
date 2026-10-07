import { parseClockDate } from "./continuity.js";
import { projectPath } from "./files.js";
import { warn } from "./findings.js";
import { plural } from "./plural.js";

// A serial's release schedule: when each episode (chapter, in reading
// order) goes out, from a chapter's own `release-date` or from the story.md
// cadence, `release-every` days or months from `release-start`. Release
// dates are real-world days, always YYYY-MM-DD, even in a book with a story
// calendar. Pure functions: the caller passes the chapters and today.

// An undrafted episode due within this many days is warned about, as well
// as one already past its date, unless story.md sets release-warn-days.
export const RELEASE_SOON_DAYS = 3;

// A monthly release-every, such as `1 month` or `3 months`.
const MONTHS_PATTERN = /^(\d+)\s+months?$/i;

// The last day a YYYY-MM-DD date can name: a cadence that runs past it
// schedules nothing more.
const LAST_DAY = parseClockDate("9999-12-31").days;

// The project's release schedule on `today`, or null when the book has
// none. An episode counts as drafted once its chapter has prose.
export function projectRelease(project, today) {
  return releaseSchedule({
    data: project.story.data,
    today,
    chapters: project.chapters.map((chapter) => ({
      id: chapter.id,
      file: projectPath(project.root, chapter.file),
      releaseDate: chapter.releaseDate,
      drafted: chapter.wordCount > 0 || chapter.count > 0
    }))
  });
}

// The schedule as --json reports it: its findings are the command's own.
export function releaseData(release) {
  if (release === null) {
    return null;
  }
  const { warnings, ...rest } = release;
  return rest;
}

// story.md release-every as { every, unit }: a whole number of days, such
// as 7, or of months, such as `1 month`. null when it is neither, or is
// below 1 (validate reports which).
export function releaseEvery(value) {
  if (Number.isInteger(value)) {
    return value >= 1 ? { every: value, unit: "day" } : null;
  }
  const months = releaseMonths(value);
  return months !== null && months >= 1 ? { every: months, unit: "month" } : null;
}

// The number of months a `N months` value names, even 0, or null for any
// other value.
export function releaseMonths(value) {
  const match = typeof value === "string" ? MONTHS_PATTERN.exec(value.trim()) : null;
  return match ? Number(match[1]) : null;
}

// The due-soon window in days: story.md release-warn-days, or
// RELEASE_SOON_DAYS when it is unset or invalid (validate reports it).
export function releaseWarnDays(data) {
  const days = data["release-warn-days"];
  return Number.isInteger(days) && days >= 0 ? days : RELEASE_SOON_DAYS;
}

// The story.md cadence as { every, unit, start }, or null when either
// field is unset or invalid (validate reports which). A monthly cadence
// also keeps the start's month, counted from year 0, and day of the month.
export function releaseCadence(data) {
  const every = releaseEvery(data["release-every"]);
  const start = typeof data["release-start"] === "string" ? parseClockDate(data["release-start"]) : undefined;
  if (every === null || !start) {
    return null;
  }
  const date = new Date(start.days * 86400000);
  return { ...every, start: start.text, startDays: start.days, startMonth: date.getUTCFullYear() * 12 + date.getUTCMonth(), startDay: date.getUTCDate() };
}

// The day the cadence releases episode `index + 1`, in days since
// 1970-01-01: `every` days after the one before, or `every` months after it
// on the start's day of the month, or on the month's last day when the
// month is shorter, so a cadence from 31 January goes out on 28 February,
// or 29 in a leap year, then 31 March. A month past 9999 is Infinity.
function cadenceDays(cadence, index) {
  if (cadence.unit === "day") {
    return cadence.startDays + index * cadence.every;
  }
  const month = cadence.startMonth + index * cadence.every;
  const year = Math.floor(month / 12);
  if (year > 9999) {
    return Infinity;
  }
  // Day 0 of the next month is this month's last day.
  const lastDay = utcDate(year, month % 12 + 1, 0).getUTCDate();
  return utcDate(year, month % 12, Math.min(cadence.startDay, lastDay)).getTime() / 86400000;
}

// How many cadence episodes are due by the day `days`: the number of the
// last one on or before it, or 0 before the first.
function dueBy(cadence, days) {
  if (days < cadence.startDays) {
    return 0;
  }
  if (cadence.unit === "day") {
    return Math.floor((days - cadence.startDays) / cadence.every) + 1;
  }
  // The last episode in this month or before, which can still be later in
  // the month than `days`.
  const date = new Date(days * 86400000);
  const index = Math.floor((date.getUTCFullYear() * 12 + date.getUTCMonth() - cadence.startMonth) / cadence.every);
  return cadenceDays(cadence, index) <= days ? index + 1 : index;
}

// Midnight UTC on a day, with `month` from 0. Date.UTC maps years 0-99 to
// 1900-1999, so the full year is set explicitly.
function utcDate(year, month, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return date;
}

// The release schedule as { every, unit, start, warnDays, complete, last,
// next, episodes, warnings }, or null when the book sets no cadence and no
// chapter has a release-date. `chapters` are { id, file, releaseDate,
// drafted } in reading order, with `releaseDate` the raw frontmatter value
// or undefined; the episode number is the chapter's position. An episode
// whose release-date is not a real day is left out rather than put back on
// the cadence (validate reports it). With a cadence, the episodes after the last chapter are
// projected too, so `next` can be one with no chapter yet (`chapter` and
// `file` null), unless story.md has `status: complete`: then the chapters
// are every episode there is, and the cadence stops at the last one. `last`
// is the episode number of a complete story's final release, or null; it is
// known only when every chapter is in the schedule, since a chapter with no
// release date could go out after the others. An undrafted episode due
// within `warnDays` days, or past due, is warned about.
export function releaseSchedule({ data, chapters, today }) {
  const cadence = releaseCadence(data);
  const warnDays = releaseWarnDays(data);
  const complete = data.status === "complete";
  const todayDays = parseClockDate(today).days;
  const episodes = [];
  chapters.forEach((chapter, index) => {
    let days = cadence ? cadenceDays(cadence, index) : null;
    if (chapter.releaseDate !== undefined && chapter.releaseDate !== null) {
      days = typeof chapter.releaseDate === "string" ? parseClockDate(chapter.releaseDate)?.days ?? null : null;
    }
    if (days !== null && days <= LAST_DAY) {
      episodes.push({ episode: index + 1, chapter: chapter.id, file: chapter.file, date: formatDate(days), days, drafted: chapter.drafted });
    }
  });
  if (cadence === null && episodes.length === 0) {
    return null;
  }

  // Past the last chapter, a cadence keeps scheduling episodes: those due
  // by today plus warnDays have no chapter to draft yet, and the first one
  // today or later can be the next release. A complete story has no
  // episode past its last chapter, so nothing is projected. A projection
  // past LAST_DAY is null.
  const projected = (index) => {
    const days = cadenceDays(cadence, index);
    return days > LAST_DAY ? null : { episode: index + 1, chapter: null, file: null, date: formatDate(days), days, drafted: false };
  };
  const candidates = episodes.filter((episode) => episode.days >= todayDays);
  let unwritten = 0;
  let firstUnwritten = null;
  if (cadence !== null && !complete) {
    // The episodes due before today are behind it.
    const upcoming = projected(Math.max(chapters.length, dueBy(cadence, todayDays - 1)));
    if (upcoming !== null) {
      candidates.push(upcoming);
    }
    // The window stops at LAST_DAY, so every episode it counts is a real day.
    unwritten = dueBy(cadence, Math.min(todayDays + warnDays, LAST_DAY)) - chapters.length;
    firstUnwritten = unwritten > 0 ? projected(chapters.length) : null;
  }
  candidates.sort((left, right) => left.days - right.days || left.episode - right.episode);
  const next = candidates.length === 0 ? null : withDaysUntil(candidates[0], todayDays);
  // Episodes due the same day go out in reading order, as `next` picks them.
  const last = complete && episodes.length > 0 && episodes.length === chapters.length
    ? episodes.reduce((latest, episode) => (episode.days >= latest.days ? episode : latest)).episode
    : null;

  const warnings = [];
  for (const episode of episodes) {
    if (!episode.drafted && episode.days <= todayDays + warnDays) {
      warnings.push(warn("release-undrafted", `${episode.file} (episode ${episode.episode}) ${releaseWhen(episode.date, episode.days - todayDays)} and has no prose yet`, episode.file));
    }
  }
  if (firstUnwritten !== null) {
    const more = unwritten === 1 ? "" : ` (and ${plural(unwritten - 1, "more scheduled episode")} after it)`;
    warnings.push(warn("release-undrafted", `episode ${firstUnwritten.episode} ${releaseWhen(firstUnwritten.date, firstUnwritten.days - todayDays)} and has no chapter yet${more}`, "story.md"));
  }

  return {
    every: cadence?.every ?? null,
    unit: cadence?.unit ?? null,
    start: cadence?.start ?? null,
    warnDays,
    complete,
    last,
    next,
    episodes: episodes.map(({ days, ...episode }) => episode),
    warnings
  };
}

function withDaysUntil({ days, ...episode }, todayDays) {
  return { ...episode, daysUntil: days - todayDays };
}

function releaseWhen(date, daysUntil) {
  if (daysUntil === 0) {
    return `releases today (${date})`;
  }
  return daysUntil > 0 ? `releases ${date}, in ${plural(daysUntil, "day")},` : `was due ${date}, ${plural(-daysUntil, "day")} ago,`;
}

// The next release as a report line, or null without a schedule. With a
// complete story's last episode known, the line marks it, and once it is
// out says the serial has ended rather than that nothing is scheduled.
export function formatNextRelease(release) {
  if (!release) {
    return null;
  }
  if (release.next === null) {
    const last = release.episodes.find((entry) => entry.episode === release.last);
    return last === undefined ? "Next release: none scheduled after today" : `Next release: none, the story is complete; episode ${last.episode} (${last.chapter}) on ${last.date} was the last`;
  }
  const { episode, chapter, date, daysUntil, drafted } = release.next;
  const when = daysUntil === 0 ? "today" : `in ${plural(daysUntil, "day")}`;
  const state = chapter === null ? "no chapter yet" : drafted ? "drafted" : "not drafted";
  return `Next release: episode ${episode}${chapter === null ? "" : ` (${chapter})`} on ${date}, ${when} (${state}${episode === release.last ? ", the last episode" : ""})`;
}

function formatDate(days) {
  return new Date(days * 86400000).toISOString().slice(0, 10);
}

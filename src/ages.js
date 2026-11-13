import { calendarYearDay, parseCalendarDate, parseCalendarYear } from "./calendar.js";

// A character's `born` date and their age at a story date. `born` is a day
// (`1990-05-12`, or a day of the story.md calendar such as `3 Thaw 270 AE`)
// or a year alone (`1990`, or `270 AE`). It is read as the span of days the
// birth may fall on, `{ text, first, last }`: one day for a full date, the
// whole year for a year alone. Day numbers count as chapter dates do (see
// parseStoryDate in continuity.js), so an age compares with any dated
// chapter or scene.
//
// This module reads no other check, so continuity.js, context.js, and the
// language server can all import it.

const DAY_MS = 86400000;

// The day number of a real YYYY-MM-DD day, or undefined. The same count as
// parseClockDate in continuity.js: days since 1970-01-01.
function gregorianDays(year, month, day) {
  const date = new Date(Date.UTC(2000, month - 1, day));
  // Date.UTC maps years 0-99 to 1900-1999, so set the full year explicitly.
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return date.getTime() / DAY_MS;
}

function bornText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : null;
}

// `{ text, first, last }` for a `born` value, `{ problem }` when it is not a
// date or a year, or null when it is unset or cannot be read until the
// story.md calendar is fixed (story validate reports the calendar).
export function parseBorn(value, calendar = null) {
  const text = bornText(value);
  if (text === "") {
    return null;
  }
  if (text === null) {
    return { problem: "must be a date or a year, such as 1990-05-12 or 1990" };
  }
  if (calendar?.invalid) {
    return null;
  }
  if (calendar) {
    const day = parseCalendarDate(text, calendar);
    if (!day.problem) {
      return { text, first: day.days, last: day.days };
    }
    const year = parseCalendarYear(text, calendar);
    if (!year.problem) {
      return year;
    }
    return { problem: `is not a day or a year of the story calendar: ${day.problem}` };
  }
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (full) {
    const days = gregorianDays(Number(full[1]), Number(full[2]), Number(full[3]));
    return days === undefined ? { problem: `must be a real YYYY-MM-DD calendar day or a year, got ${text}` } : { text, first: days, last: days };
  }
  // YAML reads `born: 0968` as the number 968, so its leading zero is lost.
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1000) {
    return { problem: `must be a YYYY-MM-DD day or a YYYY year, got ${text}; quote a year before 1000, such as "${text.padStart(4, "0")}"` };
  }
  if (/^\d{4}$/.test(text)) {
    const year = Number(text);
    return { text, first: gregorianDays(year, 1, 1), last: gregorianDays(year, 12, 31) };
  }
  return { problem: `must be a YYYY-MM-DD day or a YYYY year, got ${text}` };
}

// The problem with a `born` value for story validate, or "".
export function bornProblem(value, calendar = null) {
  return parseBorn(value, calendar)?.problem ?? "";
}

// A readable `born` span, or null.
export function readBorn(value, calendar = null) {
  const born = parseBorn(value, calendar);
  return born && !born.problem ? born : null;
}

// Whole years from a birth on day `born` to day `at`, which is not before
// it. A birthday counts on its day of the year; one on 29 February counts
// on 1 March in other years.
function yearsBetween(born, at, calendar) {
  if (calendar) {
    const from = calendarYearDay(born, calendar);
    const to = calendarYearDay(at, calendar);
    return to.year - from.year - (to.day < from.day ? 1 : 0);
  }
  const from = new Date(born * DAY_MS);
  const to = new Date(at * DAY_MS);
  const before = to.getUTCMonth() < from.getUTCMonth() || (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate());
  return to.getUTCFullYear() - from.getUTCFullYear() - (before ? 1 : 0);
}

// The age on day `at` of someone born in the `born` span, as `{ min, max }`
// whole years. min and max differ when only the year of birth is known.
// `unborn` is true when the day is before the span (certainly not born
// yet, and min and max are null), and `maybeUnborn` when it falls inside
// the span of a birth known only by its year. null when either is unknown.
export function ageOn(born, at, calendar = null) {
  if (!born || at === undefined || at === null || !Number.isFinite(at)) {
    return null;
  }
  if (at < born.first) {
    return { min: null, max: null, unborn: true, maybeUnborn: false };
  }
  const max = yearsBetween(born.first, at, calendar);
  const min = at < born.last ? 0 : yearsBetween(born.last, at, calendar);
  return { min, max, unborn: false, maybeUnborn: at < born.last };
}

// An age for a card or a hover: `34`, `34 or 35` when only the year of
// birth is known, or `not born yet`.
export function formatAge(age) {
  if (!age) {
    return "";
  }
  if (age.unborn) {
    return "not born yet";
  }
  const years = age.min === age.max ? String(age.max) : `${age.min} or ${age.max}`;
  return age.maybeUnborn ? `${years}, or not born yet` : years;
}

// A character's age on day `at`, or null.
export function characterAgeOn(character, at, calendar = null) {
  return ageOn(readBorn(character.born, calendar), at, calendar);
}

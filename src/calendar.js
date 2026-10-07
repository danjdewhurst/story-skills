// A secondary world's calendar, from the story.md `calendar` list: months
// (each `month` with its `days`), an optional `weekdays` entry, optional
// `era` entries, and an optional `hours-per-day` entry. Chapter and scene
// dates written under it, such as `3 Thaw 301 AE` or `301-02-03 AE`, become
// a day number, the same `days` a YYYY-MM-DD date gives, so the clock,
// travel, timeline, and chronology checks compare them unchanged. Clock
// times run from 00:00 to the last minute of the calendar's day, 24 hours
// unless `hours-per-day` says otherwise; an hour keeps 60 minutes.
//
// The year has no leap days: every year is the sum of the month lengths.
// Eras run in list order. A `backward` era (only the first may be one)
// counts its years down toward the era after it, as BC does, so 1 BW is the
// year before 1 AE. Every forward era but the last gives its `years`, so
// the next era knows where it starts. A date with no era is in the last
// era, the present one.

// A month, weekday, era name, or era abbreviation: text that starts with
// something other than a digit or a space and holds no comma, so a date
// such as `3 Thaw, 301 AE` splits one way only. schemas/story.schema.json
// uses the same pattern.
export const CALENDAR_NAME = /^\s*[^\s\d,][^,]*$/u;

const KINDS = ["month", "era", "weekdays", "hours-per-day"];
// The ways an era counts its years: up from its start, or down toward the
// next era, as BC does.
export const ERA_DIRECTIONS = ["forward", "backward"];

export const DEFAULT_HOURS_PER_DAY = 24;
// An `HH:MM` time has two hour digits, so the last hour of a day is 99.
// schemas/story.schema.json uses the same maximum.
export const MAX_HOURS_PER_DAY = 100;

function isName(value) {
  return typeof value === "string" && CALENDAR_NAME.test(value);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isDayLength(value) {
  return isCount(value) && value <= MAX_HOURS_PER_DAY;
}

// The hours in a day of the story calendar: its `hours-per-day`, or 24 for
// a book without a calendar or a calendar that does not set it. An invalid
// calendar keeps a valid `hours-per-day`, so its times still read. When
// its `hours-per-day` cannot be read, the day's length is unknown (see
// dayLengthKnown) and this is 24, for views that only show times.
export function dayHours(calendar) {
  return calendar?.hoursPerDay ?? DEFAULT_HOURS_PER_DAY;
}

// False when the calendar gives an `hours-per-day` that cannot be read (a
// validate error), so no time can be judged against the day.
export function dayLengthKnown(calendar) {
  return calendar?.hoursPerDay !== null;
}

function hasDayLength(entry) {
  return entry !== null && typeof entry === "object" && entry["hours-per-day"] !== undefined;
}

// An invalid calendar's day length: the one it gives cleanly, 24 when it
// gives none, or null when an entry gives one that cannot be read, or more
// than one entry gives one.
function invalidDayLength(entries, hoursPerDay) {
  const given = entries.filter(hasDayLength).length;
  if (given === 0) {
    return DEFAULT_HOURS_PER_DAY;
  }
  return given === 1 ? hoursPerDay : null;
}

// The English ordinal suffix for a day: 1st, 2nd, 3rd, 4th, 11th, 21st.
function ordinalSuffix(day) {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) {
    return "th";
  }
  return ["th", "st", "nd", "rd"][day % 10] ?? "th";
}

function fold(value) {
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
}

function plainName(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

// The calendar a story.md `calendar` value describes, and every problem with
// it. `calendar` is null when the value is unset, and `{ invalid: true,
// hoursPerDay }` when it has problems, so dates are not read against a
// broken calendar.
export function parseCalendar(value) {
  if (value === undefined) {
    return { calendar: null, problems: [] };
  }
  const problems = [];
  if (!Array.isArray(value)) {
    return { calendar: { invalid: true, hoursPerDay: invalidDayLength([value], null) }, problems: ["must be a list of month, era, weekdays, and hours-per-day entries"] };
  }
  const months = [];
  const eras = [];
  let weekdays = null;
  let firstWeekday = 0;
  let hoursPerDay = null;
  value.forEach((entry, index) => {
    const at = `entry ${index + 1}`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${at} must be a month, era, weekdays, or hours-per-day entry, such as - month: Thaw then days: 30`);
      return;
    }
    // Each key's shape is checked wherever it appears, as the schema does.
    const before = problems.length;
    for (const key of ["month", "era", "abbrev"]) {
      if (entry[key] !== undefined && !isName(entry[key])) {
        problems.push(`${at} ${key} must be a name that does not start with a digit and has no comma, got ${entry[key]}`);
      }
    }
    for (const key of ["days", "years"]) {
      if (entry[key] !== undefined && !isCount(entry[key])) {
        problems.push(`${at} ${key} must be a whole number 1 or more, got ${entry[key]}`);
      }
    }
    if (entry["hours-per-day"] !== undefined && !isDayLength(entry["hours-per-day"])) {
      problems.push(`${at} hours-per-day must be a whole number from 1 to ${MAX_HOURS_PER_DAY}, got ${entry["hours-per-day"]}`);
    }
    if (entry.direction !== undefined && !ERA_DIRECTIONS.includes(entry.direction)) {
      problems.push(`${at} direction must be forward or backward, got ${entry.direction}`);
    }
    if (entry.weekdays !== undefined && (!Array.isArray(entry.weekdays) || !entry.weekdays.every(isName))) {
      problems.push(`${at} weekdays must be a list of names that do not start with a digit and have no comma, such as [Hearthday, Stoneday]`);
    }
    if (entry["first-weekday"] !== undefined && typeof entry["first-weekday"] !== "string") {
      problems.push(`${at} first-weekday must be text, got ${entry["first-weekday"]}`);
    }
    if (entry.month !== undefined && entry.days === undefined) {
      problems.push(`${at} month ${entry.month} needs days, such as days: 30`);
    }
    const kinds = KINDS.filter((kind) => entry[kind] !== undefined);
    if (kinds.length !== 1) {
      problems.push(`${at} must name exactly one of month, era, weekdays, or hours-per-day${kinds.length > 1 ? `, not ${kinds.join(" and ")}` : ""}`);
      return;
    }
    if (problems.length > before) {
      return;
    }
    if (kinds[0] === "month") {
      months.push({ name: plainName(entry.month), days: entry.days });
    } else if (kinds[0] === "era") {
      eras.push({
        name: plainName(entry.era),
        abbrev: entry.abbrev === undefined ? "" : plainName(entry.abbrev),
        backward: entry.direction === "backward",
        years: entry.years ?? null
      });
    } else if (kinds[0] === "hours-per-day") {
      if (hoursPerDay !== null) {
        problems.push(`${at} repeats hours-per-day; give it once`);
      } else {
        hoursPerDay = entry["hours-per-day"];
      }
    } else if (weekdays !== null) {
      problems.push(`${at} repeats weekdays; list them all in one entry`);
    } else if (entry.weekdays.length === 0) {
      problems.push(`${at} weekdays needs at least one name`);
    } else {
      weekdays = entry.weekdays.map(plainName);
      if (entry["first-weekday"] !== undefined) {
        firstWeekday = weekdays.findIndex((name) => fold(name) === fold(entry["first-weekday"]));
        if (firstWeekday < 0) {
          problems.push(`${at} first-weekday must be one of the weekdays (${weekdays.join(", ")}), got ${entry["first-weekday"]}`);
        }
      }
    }
  });
  if (!value.some((entry) => entry !== null && typeof entry === "object" && entry.month !== undefined)) {
    problems.push("needs at least one month entry, such as - month: Thaw then days: 30");
  }
  repeated(months.map((month) => month.name), "month", problems);
  repeated(weekdays ?? [], "weekday", problems);
  repeated(eras.flatMap((era) => [era.name, era.abbrev].filter(Boolean)), "era name or abbrev", problems);
  eras.forEach((era, index) => {
    if (era.backward && index > 0) {
      problems.push(`era ${era.name} counts backward, but only the first era may`);
    }
    if (!era.backward && era.years === null && index < eras.length - 1) {
      problems.push(`era ${era.name} needs years, the number of years it lasts, since another era follows it`);
    }
  });
  if (problems.length > 0) {
    return { calendar: { invalid: true, hoursPerDay: invalidDayLength(value, hoursPerDay) }, problems };
  }
  let start = 1;
  for (const era of eras) {
    if (!era.backward) {
      era.start = start;
      start += era.years ?? 0;
    }
  }
  let offset = 0;
  for (const month of months) {
    month.offset = offset;
    offset += month.days;
  }
  return {
    calendar: { invalid: false, months, yearDays: offset, weekdays: weekdays ?? [], firstWeekday, eras, hoursPerDay: hoursPerDay ?? DEFAULT_HOURS_PER_DAY },
    problems: []
  };
}

function repeated(names, what, problems) {
  const seen = new Set();
  for (const name of names) {
    if (seen.has(fold(name))) {
      problems.push(`${what} ${name} appears more than once`);
    }
    seen.add(fold(name));
  }
}

// The name in `names` that `text` starts with, as a whole word (followed by
// the end, a space, or a comma), longest first, and the text after it.
function leadingName(text, names) {
  const lower = text.toLowerCase();
  const sorted = [...names].sort((left, right) => right.length - left.length);
  for (const name of sorted) {
    const key = name.toLowerCase();
    if (lower.startsWith(key) && (lower.length === key.length || lower[key.length] === " " || lower[key.length] === ",")) {
      return { name, rest: text.slice(key.length).replace(/^,?\s*/, "") };
    }
  }
  return null;
}

// A date that is clearly meant for the calendar: it starts with a digit or
// a weekday name. Other text (`the night of the fire`) is free text, which
// continuity warns about rather than validate rejecting.
export function calendarShaped(value, calendar) {
  const text = plainName(value);
  return /^\d/.test(text) || (calendar.weekdays.length > 0 && leadingName(text, calendar.weekdays) !== null);
}

// `{ text, days }` for a date under the calendar, or `{ problem }` saying
// why it is not one. Accepted forms, case-insensitive, with an optional
// leading weekday (`Hearthday, 3 Thaw 301 AE`, which must be the right one):
//   3 Thaw 301 AE    3rd of Thaw, 301 AE    301-02-03 AE
// The era may be its name or abbreviation, and may be left off for the
// last era. `days` counts from the first day of year 1 of the first
// forward era, and is negative before it.
export function parseCalendarDate(value, calendar) {
  const original = String(value).trim();
  let text = plainName(value);
  let stated = null;
  if (calendar.weekdays.length > 0) {
    const weekday = leadingName(text, calendar.weekdays);
    if (weekday) {
      stated = weekday.name;
      text = weekday.rest;
    }
  }
  let day;
  let month;
  let rest;
  const numeric = /^(\d+)-(\d{1,2})-(\d{1,2})(?: (.+))?$/.exec(text);
  if (numeric) {
    const index = Number(numeric[2]);
    if (index < 1 || index > calendar.months.length) {
      return { problem: `month ${numeric[2]} is not one of the calendar's ${calendar.months.length} months` };
    }
    month = calendar.months[index - 1];
    day = Number(numeric[3]);
    rest = `${numeric[1]}${numeric[4] === undefined ? "" : ` ${numeric[4]}`}`;
  } else {
    const named = /^(\d+)(st|nd|rd|th)? (.+)$/i.exec(text);
    if (!named) {
      return { problem: "write it as day, month, and year, such as 3 Thaw 301 AE or 301-02-03 AE" };
    }
    day = Number(named[1]);
    if (named[2] !== undefined && named[2].toLowerCase() !== ordinalSuffix(day)) {
      return { problem: `write ${named[1]}${ordinalSuffix(day)}, not ${named[1]}${named[2]}` };
    }
    // `of` before the month is optional, and a month may itself be
    // called Of: the reading followed by a year wins.
    const names = calendar.months.map((entry) => entry.name);
    const readings = [named[3], ...(/^of /i.test(named[3]) ? [named[3].slice(3)] : [])]
      .map((candidate) => leadingName(candidate, names))
      .filter(Boolean);
    const found = readings.find((reading) => /^\d/.test(reading.rest)) ?? readings[0];
    if (!found) {
      return { problem: `it names no calendar month (${names.join(", ")})` };
    }
    month = calendar.months.find((entry) => entry.name === found.name);
    rest = found.rest;
  }
  const yearMatch = /^(\d+)(?: (.+))?$/.exec(rest);
  if (!yearMatch) {
    return { problem: "the month must be followed by a year, such as 3 Thaw 301 AE" };
  }
  if (day < 1 || day > month.days) {
    return { problem: `${month.name} has ${month.days} days, not ${day}` };
  }
  const year = Number(yearMatch[1]);
  if (year < 1) {
    return { problem: "years start at 1" };
  }
  const absolute = absoluteYear(year, yearMatch[2], calendar);
  if (absolute.problem) {
    return absolute;
  }
  const days = (absolute.year - 1) * calendar.yearDays + month.offset + day - 1;
  // Past about 9 quadrillion days, two dates could share a number.
  if (!Number.isSafeInteger(days)) {
    return { problem: "the year is too far from year 1 to count its days" };
  }
  if (stated !== null) {
    const actual = calendar.weekdays[mod(days + calendar.firstWeekday, calendar.weekdays.length)];
    if (actual !== stated) {
      return { problem: `that day is a ${actual}, not a ${stated}` };
    }
  }
  return { text: original, days };
}

// Year 1 of the first forward era is year 1; a backward era's year 1 is
// year 0, its year 2 is year -1, and so on.
function absoluteYear(year, eraText, calendar) {
  if (calendar.eras.length === 0) {
    return eraText === undefined ? { year } : { problem: `the calendar has no eras, so ${eraText} is not one` };
  }
  const era = eraText === undefined
    ? calendar.eras[calendar.eras.length - 1]
    : calendar.eras.find((entry) => fold(entry.name) === fold(eraText) || (entry.abbrev !== "" && fold(entry.abbrev) === fold(eraText)));
  if (!era) {
    return { problem: `${eraText} is not one of the calendar's eras (${calendar.eras.map((entry) => entry.abbrev || entry.name).join(", ")})` };
  }
  if (era.years !== null && year > era.years) {
    return { problem: `${era.name} lasts ${era.years} years, not ${year}` };
  }
  return { year: era.backward ? 1 - year : era.start + year - 1 };
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

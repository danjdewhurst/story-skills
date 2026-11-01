// `build --format ics`: the book's schedule as an iCalendar (RFC 5545)
// file that a writer imports into a calendar app or subscribes to from a
// published build. Every event is all-day, so no time zone is needed: the
// story.md deadline, each serial episode's release date, and the daily
// writing target as a recurring event on the writing days. Pure functions:
// build.js gathers the dates from the project.
//
// The output is deterministic, as every build is: UIDs come from the story
// id and the event's role, never from a clock or a random number, and
// DTSTAMP is the same fixed build timestamp the EPUB uses.

import { WEEKDAYS } from "./progress.js";

// The longest line RFC 5545 allows, in octets, not counting the CRLF.
export const ICS_LINE_OCTETS = 75;

const BYDAY = { mon: "MO", tue: "TU", wed: "WE", thu: "TH", fri: "FR", sat: "SA", sun: "SU" };
const DAY_NAMES = { mon: "Mondays", tue: "Tuesdays", wed: "Wednesdays", thu: "Thursdays", fri: "Fridays", sat: "Saturdays", sun: "Sundays" };

// "Mondays", "Mondays and Fridays", "Mondays, Tuesdays, and Fridays".
function listText(items) {
  return items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// Escapes a TEXT value (RFC 5545 3.3.11): a backslash, semicolon, and comma
// take a backslash, and a line break becomes `\n`. Other control characters
// are not allowed in TEXT, so each becomes a space.
export function escapeText(value) {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/[\u0000-\u001f\u007f]/g, " ");
}

// Folds a content line (RFC 5545 3.1): no line is longer than 75 octets of
// UTF-8, and each continuation line starts with one space, which counts
// toward its 75. A fold never splits a character's bytes, and never splits
// a backslash escape from the character it escapes, which unfolding would
// rejoin but some readers do not.
export function foldLine(line) {
  const parts = [];
  let current = "";
  let octets = 0;
  for (const char of line.match(/\\[^]|[^]/gu) ?? []) {
    const size = Buffer.byteLength(char, "utf8");
    if (octets + size > ICS_LINE_OCTETS) {
      parts.push(current);
      current = " ";
      octets = 1;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n");
}

// A day since 1970-01-01 as an iCalendar DATE, such as 20260904.
function icsDate(days) {
  return new Date(days * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
}

// An ISO timestamp such as 2000-01-01T00:00:00Z as an iCalendar UTC
// DATE-TIME, 20000101T000000Z.
function icsTimestamp(iso) {
  return iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Epoch days to the weekday, 0 for Monday: 1970-01-01 was a Thursday.
function weekdayIndex(days) {
  return (((days + 3) % 7) + 7) % 7;
}

// The events of a schedule, in the order the file lists them: the daily
// target first, then the dated events by day, episodes before the deadline
// on the same day. Each is { uid, days, summary, description, rrule }.
// `schedule` is:
// - title, storyId: the book's display title and id
// - noun: "word" or "character", the count unit
// - target: target-words (or target-characters), or null
// - deadline: { days, date } or null
// - daily: { target, writingDays, startDays } or null, with writingDays a
//   list of WEEKDAYS or null for every day, and startDays the day the
//   target starts from
// - episodes: { episode, chapter, title, days } in reading order, with
//   chapter and title null for an episode with no chapter yet
export function scheduleEvents(schedule) {
  const { title, storyId, noun, target, deadline, daily, episodes } = schedule;
  const uid = (role) => `${role}.${storyId}@story-skills`;
  const events = [];

  if (daily !== null) {
    const scheduled = daily.writingDays === null ? null : new Set(daily.writingDays);
    let start = daily.startDays;
    while (scheduled !== null && !scheduled.has(WEEKDAYS[weekdayIndex(start)])) {
      start += 1;
    }
    if (deadline === null || start <= deadline.days) {
      const rule = scheduled === null ? ["FREQ=DAILY"] : ["FREQ=WEEKLY", `BYDAY=${daily.writingDays.map((day) => BYDAY[day]).join(",")}`];
      if (deadline !== null) {
        rule.push(`UNTIL=${icsDate(deadline.days)}`);
      }
      const days = scheduled === null ? "every day" : `on ${listText(daily.writingDays.map((day) => DAY_NAMES[day]))}`;
      const until = deadline === null ? "" : `, until the deadline on ${deadline.date}`;
      events.push({
        uid: uid("daily-target"),
        days: start,
        summary: `Write ${formatNumber(daily.target)} ${noun}s: ${title}`,
        description: `The daily target for ${title}: ${formatNumber(daily.target)} ${noun}s ${days}${until}.`,
        rrule: rule.join(";")
      });
    }
  }

  const dated = [];
  for (const episode of episodes) {
    const chapter = episode.chapter === null ? "No chapter is written for it yet." : `Chapter: ${episode.title} (${episode.chapter}).`;
    dated.push({
      uid: uid(`episode-${episode.episode}`),
      days: episode.days,
      order: episode.episode,
      summary: `Episode ${episode.episode} release: ${title}`,
      description: `${title}, episode ${episode.episode}. ${chapter}`,
      rrule: null
    });
  }
  if (deadline !== null) {
    const goal = target === null ? "" : ` Target: ${formatNumber(target)} ${noun}s.`;
    dated.push({
      uid: uid("deadline"),
      days: deadline.days,
      order: Infinity,
      summary: `Deadline: ${title}`,
      description: `The deadline for ${title}.${goal}`,
      rrule: null
    });
  }
  dated.sort((left, right) => left.days - right.days || left.order - right.order);
  return [...events, ...dated.map(({ order, ...event }) => event)];
}

// The iCalendar file for the events, with CRLF line endings and every line
// folded. `stamp` is the build timestamp as an ISO string.
export function icsCalendar({ title, events, stamp }) {
  const dtstamp = icsTimestamp(stamp);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Story Skills//story build --format ics//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `NAME:${escapeText(title)}`,
    `X-WR-CALNAME:${escapeText(title)}`
  ];
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${icsDate(event.days)}`,
      `DTEND;VALUE=DATE:${icsDate(event.days + 1)}`,
      ...(event.rrule === null ? [] : [`RRULE:${event.rrule}`]),
      `SUMMARY:${escapeText(event.summary)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

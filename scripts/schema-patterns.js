#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { parseClockDate } from "../src/continuity.js";
import { SCHEMA_PATH } from "./check-schema.js";

// Some patterns in schemas/story.schema.json are generated from the code
// story validate runs rather than written by hand: a real YYYY-MM-DD day
// (from parseClockDate). Running this script writes them into the schema;
// test/schema.test.js fails when one is out of date or disagrees with
// validate.

const pad = (number, width) => String(number).padStart(width, "0");
const isDay = (year, month, day) => parseClockDate(`${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`) !== undefined;
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
// An alternation as one group; a single choice needs none.
const group = (alternation) => (alternation.includes("|") ? `(?:${alternation})` : alternation);

// A class for a set of digits: \d for all ten, [1-9] for a run, else a list.
function digitClass(digits) {
  if (digits.length === 10) {
    return "\\d";
  }
  if (digits.length === 1) {
    return String(digits[0]);
  }
  const run = digits.every((digit, index) => index === 0 || digit === digits[index - 1] + 1);
  return run && digits.length > 2 ? `[${digits[0]}-${digits[digits.length - 1]}]` : `[${digits.join("")}]`;
}

// An alternation that matches exactly the two-digit numbers in `numbers`,
// tens digits that allow the same units sharing a class: the multiples of
// four from 04 to 96 are 0[48]|[13579][26]|[2468][048].
function twoDigits(numbers) {
  const units = new Map();
  for (const number of [...new Set(numbers)].sort((left, right) => left - right)) {
    const tens = Math.floor(number / 10);
    units.set(tens, [...(units.get(tens) ?? []), number % 10]);
  }
  const tensByUnits = new Map();
  for (const [tens, digits] of units) {
    const key = digitClass(digits);
    tensByUnits.set(key, [...(tensByUnits.get(key) ?? []), tens]);
  }
  return [...tensByUnits].map(([unitClass, tens]) => `${digitClass(tens)}${unitClass}`).join("|");
}

// The days parseClockDate accepts, as a regular expression without anchors:
// each month with the days it has in a common year, then 29 February in a
// leap year. A leap year ends in a multiple of four other than 00, or is a
// century whose first two digits are a multiple of four (2000, not 1900).
export function calendarDayPattern() {
  const lastDay = (year, month) => range(28, 31).filter((day) => isDay(year, month, day)).pop();
  const monthsByLength = new Map();
  const leapDays = [];
  for (const month of range(1, 12)) {
    const common = lastDay(2001, month);
    monthsByLength.set(common, [...(monthsByLength.get(common) ?? []), month]);
    leapDays.push(...range(common + 1, lastDay(2000, month)).map((day) => `${pad(month, 2)}-${pad(day, 2)}`));
  }
  const months = [...monthsByLength].map(([length, list]) => `${group(twoDigits(list))}-${group(twoDigits(range(1, length)))}`);
  const endings = range(1, 99).filter((year) => isDay(year, 2, 29));
  const centuries = range(0, 99).filter((century) => isDay(century * 100, 2, 29));
  const leapYears = `(?:\\d{2}${group(twoDigits(endings))}|${group(twoDigits(centuries))}00)`;
  return `(?:\\d{4}-(?:${months.join("|")})|${leapYears}-${group(leapDays.join("|"))})`;
}

// The generated patterns, by JSON pointer into the schema.
export function generatedPatterns() {
  const day = calendarDayPattern();
  return {
    "/$defs/realDate/pattern": `^\\s*${day}\\s*$`,
    "/$defs/realDateOrText/pattern": `^(?:(?!\\s*\\d{4}-\\d{2}-\\d{2}\\s*$)|\\s*${day}\\s*$)`,
    "/properties/story/properties/publication-date/pattern": `^(?:\\s*${day}?\\s*$|\\s*\\[[Tt][Oo][Dd][Oo]\\b)`
  };
}

// The schema text with each generated pattern in place. Only the pattern
// strings change, so the file keeps its layout; each pattern being
// replaced must appear once.
export function withGeneratedPatterns(text) {
  const schema = JSON.parse(text);
  let updated = text;
  for (const [pointer, pattern] of Object.entries(generatedPatterns())) {
    const current = pointer.split("/").slice(1).reduce((node, key) => node?.[key], schema);
    if (typeof current !== "string") {
      throw new Error(`The schema has no pattern at ${pointer}`);
    }
    const written = `"pattern": ${JSON.stringify(current)}`;
    if (updated.split(written).length !== 2) {
      throw new Error(`The pattern at ${pointer} must appear once in the schema`);
    }
    updated = updated.replace(written, () => `"pattern": ${JSON.stringify(pattern)}`);
  }
  return updated;
}

export function main(schemaPath = SCHEMA_PATH, log = console.log) {
  const text = fs.readFileSync(schemaPath, "utf8");
  const updated = withGeneratedPatterns(text);
  if (updated === text) {
    log("The generated schema patterns are up to date");
    return;
  }
  fs.writeFileSync(schemaPath, updated);
  log(`Wrote the generated patterns into ${schemaPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

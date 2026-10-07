#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { parseClockDate } from "../src/continuity.js";
import { CHINESE_SCRIPTS, GRANDFATHERED, LANGUAGE_ALIASES, PACKS } from "../src/languages/index.js";
import { LIKELY_SCRIPTS, VERTICAL_SCRIPTS, supportsVertical } from "../src/typesetting.js";
import { SCHEMA_PATH } from "./check-schema.js";

// Some patterns in schemas/story.schema.json are generated from the code
// story validate runs rather than written by hand: a real YYYY-MM-DD day
// (from parseClockDate), and the language tags writing-mode: vertical
// allows (from supportsVertical and the language tables). Running this
// script writes them into the schema; test/schema.test.js fails when one
// is out of date or disagrees with validate.

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

const LETTER = "[A-Za-z]";
const ALNUM = "[A-Za-z0-9]";
// The end of a subtag, and any subtags after it.
const END = `(?!${ALNUM})`;
const MORE = `(?:-${ALNUM}{1,8})*`;
// A code no table names: qaa to qtz are reserved for private use.
const UNKNOWN = "qaa";

// A code in any case, as story validate reads tags: ja is [Jj][Aa].
const caseless = (code) => [...code].map((char) => (/[a-z]/.test(char) ? `[${char.toUpperCase()}${char}]` : char)).join("");
const anyOf = (codes) => `(?:${codes.map(caseless).join("|")})`;
const sameSet = (left, right) => left.length === right.length && left.every((item) => right.includes(item));

// Every language code the language and script tables name, in lower case.
export function tableCodes() {
  const codes = new Set();
  const add = (tag) => {
    if (tag) {
      codes.add(tag.toLowerCase().split("-")[0]);
    }
  };
  [...PACKS.keys()].forEach(add);
  Object.entries(LANGUAGE_ALIASES).flat().forEach(add);
  Object.keys(CHINESE_SCRIPTS).forEach(add);
  Object.values(LIKELY_SCRIPTS).flat().forEach(add);
  Object.values(GRANDFATHERED).flat().forEach(add);
  return [...codes].sort();
}

// The language tags supportsVertical accepts, as a regular expression
// without anchors, read the way parseTag reads a tag: a script subtag (the
// one after the language, or after an extlang) decides; without one, the
// language does, which for an extlang tag such as zh-yue or ja-xyz is the
// extlang under its macrolanguage. Every code the tables name is tried,
// and a code they do not name behaves like qaa.
export function verticalLanguagePattern() {
  const codes = tableCodes();
  const extlangs = [...codes.filter((code) => code.length === 3), UNKNOWN];
  const scripts = [...VERTICAL_SCRIPTS].map((script) => script.toLowerCase()).sort();
  const branches = [`${LETTER}{2,3}(?:-${LETTER}{3})?-${anyOf(scripts)}${END}${MORE}`];

  // A language alone, or with subtags after it that are neither an extlang
  // (three letters) nor a script (four).
  branches.push(`${anyOf(codes.filter((code) => supportsVertical(code)))}(?:-(?!${LETTER}{3,4}${END})${ALNUM}{1,8}${MORE})?`);

  // An extlang, then subtags that are not a script. Macrolanguages whose
  // extlangs differ from an unknown one's get their own branch.
  const verticalUnder = (macrolanguage) => extlangs.filter((extlang) => supportsVertical(`${macrolanguage}-${extlang}`));
  const extlangPattern = (allowed) => {
    if (!allowed.includes(UNKNOWN)) {
      return anyOf(allowed);
    }
    const refused = extlangs.filter((extlang) => !allowed.includes(extlang));
    return `${refused.length > 0 ? `(?!${anyOf(refused)}${END})` : ""}${LETTER}{3}`;
  };
  const rest = `(?:-(?!${LETTER}{4}${END})${ALNUM}{1,8}${MORE})?`;
  const anyMacrolanguage = verticalUnder(UNKNOWN);
  const groups = new Map();
  for (const code of codes) {
    const allowed = verticalUnder(code);
    if (!sameSet(allowed, anyMacrolanguage)) {
      const key = allowed.join(",");
      groups.set(key, { allowed, macrolanguages: [...(groups.get(key)?.macrolanguages ?? []), code] });
    }
  }
  for (const { allowed, macrolanguages } of [...groups.values()].filter((group) => group.allowed.length > 0)) {
    branches.push(`${anyOf(macrolanguages)}-${extlangPattern(allowed)}${rest}`);
  }
  // The extlangs set vertically under any macrolanguage (Chinese ones),
  // except under one that refuses some of them.
  const refuseAny = [...groups.values()].filter(({ allowed }) => anyMacrolanguage.some((extlang) => !allowed.includes(extlang))).flatMap(({ macrolanguages }) => macrolanguages);
  if (anyMacrolanguage.length > 0) {
    branches.push(`${refuseAny.length > 0 ? `(?!${anyOf(refuseAny)}-)` : ""}${LETTER}{2,3}-${extlangPattern(anyMacrolanguage)}${rest}`);
  }

  // Grandfathered tags (zh-min-nan) skip the rules above, so any the
  // branches read wrongly are listed or refused by name.
  const tags = Object.keys(GRANDFATHERED).filter((tag) => /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/.test(tag));
  const generic = new RegExp(`^(?:${branches.join("|")})$`, "u");
  const include = tags.filter((tag) => supportsVertical(tag) && !generic.test(tag));
  const refuse = tags.filter((tag) => !supportsVertical(tag) && generic.test(tag));
  return `${refuse.length > 0 ? `(?!${anyOf(refuse)}\\s*$)` : ""}(?:${[...branches, ...include.map(caseless)].join("|")})`;
}

// The generated patterns, by JSON pointer into the schema.
export function generatedPatterns() {
  const day = calendarDayPattern();
  return {
    "/$defs/realDate/pattern": `^\\s*${day}\\s*$`,
    "/$defs/realDateOrText/pattern": `^(?:(?!\\s*\\d{4}-\\d{2}-\\d{2}\\s*$)|\\s*${day}\\s*$)`,
    "/properties/story/properties/publication-date/pattern": `^(?:\\s*${day}?\\s*$|\\s*\\[[Tt][Oo][Dd][Oo]\\b)`,
    "/properties/story/allOf/0/then/properties/language/pattern": `^\\s*${verticalLanguagePattern()}\\s*$`
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

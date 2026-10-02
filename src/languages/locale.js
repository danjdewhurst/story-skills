import { languagePack } from "./index.js";

// Locale-aware text for a language pack: the order names and words are
// listed in, upper and lower case, and numbers a reader sees. Each passes
// `pack.locale` to Intl, so Swedish lists Ö after Z and Turkish upper-cases
// i as İ. In English each gives what the plain methods do.

const COMPARERS = new Map();

// A sort comparator for display text (names, titles, words) in the pack's
// language. Text the collator ranks equal, such as é written as one or two
// code points, is ordered by code point, so the order never depends on
// input order. Never use it for ids or file names, which sort the same in
// every language.
export function compareText(pack = languagePack()) {
  if (!COMPARERS.has(pack.locale)) {
    const collator = new Intl.Collator(pack.locale);
    COMPARERS.set(pack.locale, (left, right) => collator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0));
  }
  return COMPARERS.get(pack.locale);
}

export function lowerCase(text, pack = languagePack()) {
  return String(text).toLocaleLowerCase(pack.locale);
}

export function upperCase(text, pack = languagePack()) {
  return String(text).toLocaleUpperCase(pack.locale);
}

const NUMBER_FORMATS = new Map();

// A whole number as a reader of the pack's language writes it: 12,300 in
// English, 12.300 in German, 12 300 in Swedish. Digits are always 0-9,
// since runtimes disagree on which digits some languages default to.
// Author-facing reports keep their own fixed format.
export function formatNumber(value, pack = languagePack()) {
  if (!NUMBER_FORMATS.has(pack.locale)) {
    NUMBER_FORMATS.set(pack.locale, new Intl.NumberFormat(pack.locale, { numberingSystem: "latn", maximumFractionDigits: 0 }));
  }
  return NUMBER_FORMATS.get(pack.locale).format(value);
}

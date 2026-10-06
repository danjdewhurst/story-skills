import { composedText, nfc } from "../unicode.js";
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

// Languages whose i has a dotted and a dotless form in both cases (I ı,
// İ i), which the regex `i` flag, following English casing, gets wrong.
// Turkish and Azerbaijani are the ones the runtime lower-cases that way.
const DOTLESS_I = new Set(["tr", "az"]);

function casesDotlessI(pack) {
  return DOTLESS_I.has(pack.locale.split("-")[0].toLowerCase());
}

// Author-supplied words (watch words, avoided spellings, voice phrases) and
// the prose they are looked for in, made ready for a case-insensitive (`i`)
// regex, in NFC. In Turkish and Azerbaijani both are lower-cased with the
// pack, so ILIK finds ılık and İnce finds ince but not ınce; every other
// language matches the text as written, with the `i` flag alone.
export function matchingCase(phrase, pack = languagePack()) {
  const composed = nfc(phrase);
  return casesDotlessI(pack) ? lowerCase(composed, pack) : composed;
}

// `text` as matchingCase gives it, with `original(start, end)` mapping a
// span of it back to the text as written, for excerpts and offsets:
// composing e + U+0301 into é makes the text shorter (see ../unicode.js).
// Turkish lower-casing drops a dot above only after an I that no mark of
// class 0 or 230 parts from it, which is just when NFC has already composed
// the two into İ, so in composed text it never changes the length.
export function matchingText(text, pack = languagePack()) {
  const composed = composedText(text);
  return casesDotlessI(pack) ? { ...composed, text: lowerCase(composed.text, pack) } : composed;
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

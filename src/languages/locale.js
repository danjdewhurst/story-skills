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
// regex. In Turkish and Azerbaijani both are lower-cased with the pack, so
// ILIK finds ılık and İnce finds ince but not ınce; every other language
// matches the text as written, with the `i` flag alone.
export function matchingCase(phrase, pack = languagePack()) {
  return casesDotlessI(pack) ? lowerCase(phrase, pack) : String(phrase);
}

// `text` as matchingCase gives it, with `original(start, end)` mapping a
// span of it back to the text as written, for excerpts and offsets: a
// Turkish lower-casing drops a dot written after I (I followed by U+0307 is
// i), so the text can come out shorter.
export function matchingText(text, pack = languagePack()) {
  const source = String(text);
  const same = { text: source, original: (start, end) => [start, end] };
  if (!casesDotlessI(pack)) {
    return same;
  }
  const lower = lowerCase(source, pack);
  if (lower.length === source.length) {
    return { ...same, text: lower };
  }
  // Only an I with marks after it can change length, so each is a piece of
  // its own, lower-cased alone; the runs between keep their length.
  let folded = "";
  const starts = [];
  const sources = [];
  const add = (from, value) => {
    starts.push(folded.length);
    sources.push(from);
    folded += lowerCase(value, pack);
  };
  let last = 0;
  for (const match of source.matchAll(/I\p{M}+/gu)) {
    if (match.index > last) {
      add(last, source.slice(last, match.index));
    }
    add(match.index, match[0]);
    last = match.index + match[0].length;
  }
  if (last < source.length) {
    add(last, source.slice(last));
  }
  starts.push(folded.length);
  sources.push(source.length);
  // The last piece starting at or before `offset`, by binary search.
  const piece = (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  };
  // An offset inside a piece that kept its length maps across exactly;
  // inside one that changed, it moves to the piece's start, or its end
  // for the end of a span, so the span takes in the whole piece as written.
  const at = (offset, end) => {
    const index = piece(offset);
    const inside = offset - starts[index];
    if (inside === 0) {
      return sources[index];
    }
    if (starts[index + 1] - starts[index] === sources[index + 1] - sources[index]) {
      return sources[index] + inside;
    }
    return sources[end ? index + 1 : index];
  };
  return { text: folded, original: (start, end) => [at(start, false), at(end, true)] };
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

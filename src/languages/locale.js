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

// `text` lower-cased with the pack, for matching author-supplied words
// (watch words, avoided spellings, voice phrases) against prose. Lower-case
// the pattern's words with the same pack and match against this, so Turkish
// ILIK finds ılık and İnce finds ince but not ınce, which the regex `i` flag
// alone, blind to language, gets wrong. Lower-casing can change the length
// (İ is i plus a combining dot outside Turkish; Turkish drops a dot written
// after I), so `original(start, end)` maps a span of the lower-cased text
// back to the text as written, for excerpts and offsets.
export function lowerCaseText(text, pack = languagePack()) {
  const source = String(text);
  const lower = lowerCase(source, pack);
  // A locale's lower-casing only lengthens text or only shortens it, so the
  // same length means every character kept its place.
  if (lower.length === source.length) {
    return { text: lower, original: (start, end) => [start, end] };
  }
  // Otherwise lower-case each letter with its marks, the unit whose length
  // can change, and note where each piece starts in both texts. A run of
  // ASCII with no mark after it keeps its length, so it is one piece.
  let folded = "";
  const starts = [];
  const sources = [];
  for (const match of source.matchAll(/(?:[\0-\x7F](?!\p{M}))+|\P{M}\p{M}*|\p{M}+/gsu)) {
    starts.push(folded.length);
    sources.push(match.index);
    folded += lowerCase(match[0], pack);
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

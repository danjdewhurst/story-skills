import { composedText } from "./unicode.js";

// Words in scripts written without spaces between them. Every word count and
// word comparison goes through wordSpans, so `story wordcount`, `compare`,
// `similarity`, and the prose checks split these scripts the same way.

// One Han, Hiragana, or Katakana character, or the Katakana long-vowel mark,
// which Unicode files under no single script. Chinese and Japanese count a
// word per character, as Word and Scrivener count them.
const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30FC";
// A run of Thai, Lao, Khmer, or Myanmar (Burmese) script. These also put no
// spaces between words, but a word is several characters, so the run is
// split by Intl.Segmenter's dictionary. That dictionary is the runtime's ICU
// data, so a count can shift slightly between Node and Bun versions.
const SOUTHEAST_ASIAN = "\\p{Script=Thai}\\p{Script=Lao}\\p{Script=Khmer}\\p{Script=Myanmar}";
// Soft hyphens and zero-width joiners inside a word keep the run going, so
// the segmenter sees the whole word.
const JOINER = "\\u00AD\\u200C\\u200D";
// Every letter of those scripts, as the body of a character class.
export const UNSPACED_LETTERS = `${CJK}${SOUTHEAST_ASIAN}`;
const UNSPACED = new RegExp(`[${CJK}]|[${SOUTHEAST_ASIAN}](?:[${SOUTHEAST_ASIAN}]|[${JOINER}]+(?=[${SOUTHEAST_ASIAN}]))*`, "gu");
const CJK_CHARACTER = new RegExp(`^[${CJK}]$`, "u");

// Node 18 and 20 segment a long unbroken run in more than linear time (a
// 200,000-character run takes seconds), so a run is segmented this many
// characters at a time. The last few words of a window may be cut short or
// split differently once the text after them is seen, so the next window
// starts again at the RESTART_WORDS-th word from the end.
const WINDOW = 10000;
const RESTART_WORDS = 4;

// Created on first use, so text without these scripts never needs it.
let segmenter;

// The words of one run of Southeast Asian script, as [word, offset] pairs.
// `window` is the window size, which tests shrink.
export function segmentRun(run, window = WINDOW) {
  segmenter ??= new Intl.Segmenter("en", { granularity: "word" });
  const words = [];
  let offset = 0;
  while (offset < run.length) {
    const end = offset + window;
    const found = [];
    for (const { segment, index, isWordLike } of segmenter.segment(run.slice(offset, end))) {
      if (isWordLike) {
        found.push([segment, offset + index]);
      }
    }
    const restart = end < run.length && found.length > RESTART_WORDS ? found[found.length - RESTART_WORDS][1] : end;
    for (const word of found) {
      if (word[1] < restart) {
        words.push(word);
      }
    }
    offset = restart;
  }
  return words;
}

// The words of `text` in order, as { word, start, end } with offsets into
// `text`. Each Chinese or Japanese character is a word, each run of Thai,
// Lao, Khmer, or Burmese is split by the segmenter, and the text between
// them is matched with `pattern` (a global regex), the caller's rule for
// words in spaced scripts. Those scripts are cut out first, so a word in
// `pattern` never runs on into them.
export function wordSpans(text, pattern) {
  const source = String(text);
  const spans = [];
  let last = 0;
  const between = (end) => {
    if (end > last) {
      for (const match of source.slice(last, end).matchAll(pattern)) {
        spans.push({ word: match[0], start: last + match.index, end: last + match.index + match[0].length });
      }
    }
  };
  for (const match of source.matchAll(UNSPACED)) {
    between(match.index);
    if (CJK_CHARACTER.test(match[0])) {
      spans.push({ word: match[0], start: match.index, end: match.index + match[0].length });
    } else {
      for (const [word, offset] of segmentRun(match[0])) {
        spans.push({ word, start: match.index + offset, end: match.index + offset + word.length });
      }
    }
    last = match.index + match[0].length;
  }
  between(source.length);
  return spans;
}

// The offsets in `text` where a word of those scripts starts or ends, as a
// Set: a name or phrase in them sits against the next word with no space,
// so its edges must fall here to count as whole words.
export function unspacedBoundaries(text) {
  const boundaries = new Set();
  for (const { start, end } of wordSpans(text, /(?!)/gu)) {
    boundaries.add(start);
    boundaries.add(end);
  }
  return boundaries;
}

// One letter of a script written with spaces, as a regex source: the edge a
// name or phrase pattern stops at. A letter of an unspaced script is left to
// wordMatcher, which checks those edges against the words around them.
const SPACED_LETTER = `(?![${UNSPACED_LETTERS}])[\\p{L}\\p{M}\\p{N}]`;
const UNSPACED_LETTER = new RegExp(`[${UNSPACED_LETTERS}]`, "u");
const UNSPACED_START = new RegExp(`^[${UNSPACED_LETTERS}]`, "u");
const UNSPACED_END = new RegExp(`[${UNSPACED_LETTERS}]$`, "u");
const JOINER_CHARACTER = new RegExp(`[${JOINER}]`, "u");

// `body`, the regex source for `phrase`, bounded by SPACED_LETTER as whole
// words, for wordMatcher. An end of the phrase in an unspaced script needs
// no bound: a letter of another script beside it starts a new word, as
// wordSpans splits them, and one of its own is checked by wordMatcher. Only
// a combining mark after it (the dakuten of が written as か plus U+3099)
// is still part of its last character.
export function wholeWords(body, phrase) {
  const before = UNSPACED_START.test(phrase) ? "" : `(?<!${SPACED_LETTER})`;
  const after = UNSPACED_END.test(phrase) ? "(?!\\p{M})" : `(?!${SPACED_LETTER})`;
  return `${before}${body}${after}`;
}

// A finder for whole-word matches in `text`, for names and author-supplied
// phrases (watch words, avoided spellings, voice phrases). Call it with a
// global pattern bounded by SPACED_LETTER (or a narrower spaced letter): it
// returns each match's [start, end] in `text` whose edges between two
// letters of an unspaced script fall between two of its words, so a Chinese
// or Japanese phrase matches at any character and a Thai one only at the
// segmenter's word boundaries. Matches do not overlap; with `first`, only
// the first is returned. Patterns run on `text` in NFC (composedText), or
// on `cased`, `text` as matchingText gives it, so they must be in NFC too;
// their spans map back to `text` as written. The boundaries
// are found once, the first time an edge needs them, so one finder serves
// every pattern looked for in the same text.
export function wordMatcher(text, cased = null) {
  const source = String(text);
  const view = cased ?? composedText(source);
  const searched = view.text;
  let boundaries = null;
  return (pattern, { first = false } = {}) => {
    const spans = [];
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(searched)) !== null) {
      const end = match.index + match[0].length;
      const span = view.original(match.index, end);
      const edges = span.map((offset) => joinedEdge(source, offset)).filter(Boolean);
      if (edges.length > 0) {
        boundaries ??= unspacedBoundaries(source);
      }
      if (edges.every(([from, to]) => boundaries.has(from) || boundaries.has(to))) {
        spans.push(span);
        if (first) {
          break;
        }
        pattern.lastIndex = end > match.index ? end : nextCharacter(searched, match.index);
      } else {
        // A match cut off mid-word may overlap a whole one further on.
        pattern.lastIndex = nextCharacter(searched, match.index);
      }
    }
    pattern.lastIndex = 0;
    return spans;
  };
}

// The edge at `offset` as [from, to], widened over the soft hyphens and
// zero-width joiners around it, when it falls between two letters of an
// unspaced script; else null. Joiners keep a run one word, so the edge is
// whole if a word boundary falls on either side of them.
function joinedEdge(text, offset) {
  let from = offset;
  let to = offset;
  while (from > 0 && JOINER_CHARACTER.test(text[from - 1])) {
    from -= 1;
  }
  while (to < text.length && JOINER_CHARACTER.test(text[to])) {
    to += 1;
  }
  return UNSPACED_LETTER.test(text[from - 1] ?? "") && UNSPACED_LETTER.test(text[to] ?? "") ? [from, to] : null;
}

function nextCharacter(text, index) {
  return index + (text.codePointAt(index) > 0xffff ? 2 : 1);
}

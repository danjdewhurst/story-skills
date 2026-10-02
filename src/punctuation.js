import { languagePack } from "./languages/index.js";

// The punctuation a language pack sets out (sentenceEnd, quotes,
// dialogueDash), arranged for the sentence splitter and the dialogue finder.
// Marks such as » (opening in German, closing in French) and ’ (a closing
// quote and an apostrophe) mean different things in different languages, so
// their roles come from the story's pack, never from one global list.

// Spanish ¿ and ¡ only ever open a sentence, in any language.
export const SENTENCE_OPENERS = "¿¡";
// Marks that end a question or an exclamation, for the voice statistics.
export const QUESTION_MARKS = "?？؟";
export const EXCLAMATION_MARKS = "!！";
// The quotation dash (U+2015), which some typesetters use in place of the
// pack's dialogue dash.
const QUOTATION_DASH = "―";
// Full-width stops (。！？) end a sentence with no space after them: that
// writing puts none between sentences.
const FULL_WIDTH = /^[　-〿＀-￯]$/u;
// Quote marks that double as apostrophes (don’t, the dogs’ bowls).
const APOSTROPHES = new Set(["'", "’"]);

const CACHE = new WeakMap();

// The pack's punctuation, worked out once per pack:
// - `pairs`: { open, close, kind } for each quote pair. `kind` is "single"
//   when the closer can be an apostrophe, so letters either side decide
//   whether it is a quote; "straight" when both marks are the same, so they
//   pair in order; else "explicit".
// - `byOpener`: the pairs by opening mark.
// - `openers` and `closers`: every opening and closing quote mark.
// - `spacedEnds` and `fullWidthEnds`: the sentence-ending marks, split by
//   whether a space must follow.
// - `dashes`: the dialogue dashes and the quotation dash, or "" when the
//   pack sets no dialogue dash. `dialogueDash` is one dash or a list.
export function punctuation(pack = languagePack()) {
  if (!CACHE.has(pack)) {
    CACHE.set(pack, buildPunctuation(pack));
  }
  return CACHE.get(pack);
}

function buildPunctuation(pack) {
  const pairs = (pack.quotes ?? []).map(([open, close]) => ({
    open,
    close,
    kind: APOSTROPHES.has(close) ? "single" : open === close ? "straight" : "explicit"
  }));
  const byOpener = new Map();
  for (const pair of pairs) {
    byOpener.set(pair.open, [...(byOpener.get(pair.open) ?? []), pair]);
  }
  const ends = pack.sentenceEnd ?? [];
  return {
    pairs,
    byOpener,
    openers: unique(pairs.map((pair) => pair.open)),
    closers: unique(pairs.map((pair) => pair.close)),
    spacedEnds: unique(ends.filter((mark) => !FULL_WIDTH.test(mark))),
    fullWidthEnds: unique(ends.filter((mark) => FULL_WIDTH.test(mark))),
    dashes: pack.dialogueDash ? unique([...[].concat(pack.dialogueDash), QUOTATION_DASH]) : ""
  };
}

function unique(marks) {
  return [...new Set(marks.join(""))].join("");
}

// The marks as the body of a regex character class.
export function charClass(marks) {
  return marks.replace(/[\\\]\[^-]/g, "\\$&");
}

// A regex character class matching any of the marks, or one that never
// matches when there are none.
export function anyOf(marks) {
  return marks === "" ? "(?!)" : `[${charClass(marks)}]`;
}

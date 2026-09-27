// One sentence splitter for synopsis, prose, and voices, so `Dr. Hale`, the
// `U.S. Navy`, and a stammer (`I… I don't know`) never end a sentence.

// Words that end in a full stop without ending the sentence: titles and
// initials (Dr. Hale, J. Smith, the U.S. Navy) never end one. Words that
// often close a sentence too (etc., No., a.m.) end it unless the next word
// starts in lower case, with a digit, or is a day or month (No. 5, 9 a.m.
// Monday).
const TITLE_ABBREVIATIONS = /(?:^|[\s(“"‘'])(?:Dr|Mr|Mrs|Ms|St|Mt|Jr|Sr|Prof|Capt|Gen|Col|Lt|Sgt|Rev|Fr|e\.g|i\.e|(?:[A-Za-z]\.)*[A-Za-z])$/;
const CONTEXT_ABBREVIATIONS = /(?:^|[\s(“"‘'])(?:No|vs|etc|a\.m|p\.m)$/;
const CALENDAR_WORD = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)(?![\p{L}\p{N}])/u;
// A sentence ends at a run of . ! ? or … plus any closing quotes, brackets,
// or emphasis marks, before a space or the end of the text.
// A Chinese or Japanese full stop, exclamation, or question mark (。！？)
// always ends one: that writing puts no space after it and has no capitals.
const SENTENCE_END = /[.!?…]+["”’')\]*_]*(?= |$)|[。！？]+[」』）”’"')\]*_]*/g;
// How many characters either side of a stop decide whether it ends a
// sentence.
const CONTEXT_WINDOW = 64;
// The next sentence starts with a capital or digit, after any opening
// quotes, brackets, or emphasis marks.
const SENTENCE_START = /^["'“‘(\[*_]*[\p{Lu}\p{N}]/u;

// With `capitalStart` (the default), only a capital, digit, or opening quote
// starts the next sentence, so `"Why?" she asked` stays one sentence. The
// synopsis turns it off because its list items may start in lower case.
export function splitSentences(text, { capitalStart = true } = {}) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (normalized === "") {
    return [];
  }
  const sentences = [];
  let start = 0;
  for (const match of normalized.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    if (/^[。！？]/.test(match[0])) {
      sentences.push(normalized.slice(start, end).trim());
      start = end;
      continue;
    }
    // Only the words either side of the stop decide, so test short windows:
    // slicing the whole text each time would make long passages quadratic.
    const next = normalized.slice(end + 1, end + 1 + CONTEXT_WINDOW);
    if (capitalStart && next !== "" && !SENTENCE_START.test(next)) {
      continue;
    }
    // A cut window gets a letter in front, so its first word never counts
    // as whole.
    const from = Math.max(start, match.index - CONTEXT_WINDOW);
    const before = `${from > start ? "x" : ""}${normalized.slice(from, match.index)}`;
    const abbreviation = match[0] === "." && (CONTEXT_ABBREVIATIONS.test(before)
      ? /^[\p{Ll}\p{N}]/u.test(next) || CALENDAR_WORD.test(next)
      : TITLE_ABBREVIATIONS.test(before));
    const stammer = /^(?:…|\.\.\.)/.test(match[0]) && isStammer(before, next);
    if (abbreviation || stammer) {
      continue;
    }
    sentences.push(normalized.slice(start, end).trim());
    start = end;
  }
  const tail = normalized.slice(start).trim();
  if (tail !== "") {
    sentences.push(/[.!?…。！？]["”’')\]」』）]*$/.test(tail) ? tail : `${tail}.`);
  }
  return sentences.filter((sentence) => sentence !== "");
}

// "I… I don't": the word after an ellipsis repeats the word before it.
function isStammer(before, next) {
  const last = /([\p{L}\p{N}'’]+)$/u.exec(before);
  const first = /^["'“‘(\[*_]*([\p{L}\p{N}'’]+)/u.exec(next);
  return Boolean(last && first) && last[1].toLowerCase() === first[1].toLowerCase();
}

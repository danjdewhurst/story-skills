import { checkList, languagePack } from "./languages/index.js";
import { escapeRegExp } from "./markdown.js";
import { SENTENCE_OPENERS, anyOf, charClass, punctuation } from "./punctuation.js";

// One sentence splitter for synopsis, prose, and voices, so `Dr. Hale`, the
// `U.S. Navy`, and a stammer (`I… I don't know`) never end a sentence.

// Words that end in a full stop without ending the sentence come from the
// language pack. Titles and initials (Dr. Hale, J. Smith, the U.S. Navy)
// never end one. Words that often close a sentence too (etc., No., a.m.)
// end it unless the next word starts in lower case, with a digit, or is a
// calendar word (No. 5, 9 a.m. Monday). Initials need no list, so a
// language without one still keeps them.
const INITIALS = "(?:[A-Za-z]\\.)*[A-Za-z]";
const NEVER = "(?!)";
// How many characters either side of a stop decide whether it ends a
// sentence.
const CONTEXT_WINDOW = 64;
// Brackets and emphasis marks that close a sentence after its stop, or
// open one before its first word.
const CLOSING_MARKS = ")\\]*_";
const OPENING_MARKS = "(\\[*_";
// Brackets that close a sentence after a full-width stop (。」), in any
// language.
const FULL_WIDTH_CLOSERS = "」』）";
// Closing guillemets, which some languages set after a space.
const SPACED_CLOSERS = "»›";
const SPACED_OPENERS = "«‹";
const RULES = new WeakMap();

// The patterns built from a pack's word lists and punctuation, once per
// pack. The stops and quote marks come from the pack (sentenceEnd, quotes),
// so » closes a French sentence and opens a German one.
function sentenceRules(pack) {
  if (!RULES.has(pack)) {
    RULES.set(pack, buildRules(pack));
  }
  return RULES.get(pack);
}

function buildRules(pack) {
  const words = (name) => (checkList(pack, name) ?? []).map(escapeRegExp);
  const either = (list) => (list.length === 0 ? NEVER : list.join("|"));
  const marks = punctuation(pack);
  // Opening quotes, and Spanish ¿ and ¡, can stand before a sentence's
  // first word.
  const openers = charClass(marks.openers + SENTENCE_OPENERS);
  const closers = charClass(marks.closers);
  // French sets a space inside guillemets (« Viens. »), so a closing
  // guillemet may follow the stop after a space, where it cannot open a
  // quote in this language.
  const spacedClosers = [...SPACED_CLOSERS].filter((mark) => marks.closers.includes(mark) && !marks.openers.includes(mark)).join("");
  // Likewise an opening guillemet may stand before a space (« Quoi ? »).
  const spacedOpeners = [...SPACED_OPENERS].filter((mark) => marks.openers.includes(mark) && !marks.closers.includes(mark)).join("");
  const opening = `(?:[${openers}${OPENING_MARKS}]|${anyOf(spacedOpeners)} )*`;
  // After a full-width stop, which needs no space, a closing mark that can
  // also open a quote in this language (“ closes „…“ but opens “…”) is taken
  // only when it closes a quote still open in the sentence; see
  // closingQuotes.
  const ambiguous = [...marks.closers].filter((mark) => marks.openers.includes(mark)).join("");
  const plainClosers = charClass([...marks.closers].filter((mark) => !ambiguous.includes(mark)).join(""));
  const ends = [
    marks.spacedEnds === "" ? null : `${anyOf(marks.spacedEnds)}+(?: ${anyOf(spacedClosers)})?[${closers}${CLOSING_MARKS}]*(?= |$)`,
    marks.fullWidthEnds === "" ? null : `${anyOf(marks.fullWidthEnds)}+`
  ].filter(Boolean);
  // A letter of a script without case (Arabic, Hebrew, Devanagari, Chinese,
  // Japanese, Thai) starts a sentence as a capital does. In a pack for such
  // a script (`cased: false`) any letter starts one.
  const startLetter = pack.cased === false ? "\\p{L}\\p{N}" : "\\p{Lu}\\p{Lo}\\p{N}";
  return {
    title: new RegExp(`(?:^|[\\s${openers}(])(?:${[...words("titleAbbreviations"), INITIALS].join("|")})$`),
    // In a pack with `ordinalStop`, a number before the stop is an ordinal
    // (am 3. Mai) and is read like a context abbreviation.
    context: new RegExp(`(?:^|[\\s${openers}(])(?:${either([...words("contextAbbreviations"), ...(pack.ordinalStop === true ? ["\\d+"] : [])])})$`),
    calendar: new RegExp(`^(?:${either(words("calendarWords"))})(?![\\p{L}\\p{N}])`, "u"),
    // A sentence ends at a run of stops plus any closing quotes, brackets,
    // or emphasis marks, before a space or the end of the text. A
    // full-width stop (。！？) always ends one: that writing puts no space
    // after it and has no capitals.
    end: new RegExp(ends.join("|") || NEVER, "g"),
    fullWidth: new RegExp(`^${anyOf(marks.fullWidthEnds)}`),
    fullWidthCloser: new RegExp(`[${plainClosers}${CLOSING_MARKS}${FULL_WIDTH_CLOSERS}]`),
    ambiguous,
    pairs: marks.pairs,
    // The next sentence starts with a capital, digit, or letter without
    // case, after any opening quotes, brackets, or emphasis marks.
    start: new RegExp(`^${opening}[${startLetter}]`, "u"),
    // A last sentence that already ends with a stop gets no full stop.
    finished: new RegExp(`${anyOf(marks.spacedEnds + marks.fullWidthEnds)}(?: ${anyOf(spacedClosers)})?[${closers})\\]${FULL_WIDTH_CLOSERS}]*$`),
    firstWord: new RegExp(`^${opening}([\\p{L}\\p{N}'’]+)`, "u")
  };
}

// The end of a sentence that a full-width stop ends at `end`, past any
// closing quotes and brackets after it. A mark that can also open a quote
// counts only when a quote it closes is still open in the sentence.
function closingQuotes(text, start, end, rules) {
  let position = end;
  while (position < text.length) {
    const mark = text[position];
    if (!rules.fullWidthCloser.test(mark) && !(rules.ambiguous.includes(mark) && quoteOpen(text.slice(start, position), mark, rules))) {
      break;
    }
    position += 1;
  }
  return position;
}

function quoteOpen(sentence, mark, rules) {
  return rules.pairs.some(({ open, close }) => close === mark && (open === close
    ? sentence.split(mark).length % 2 === 0
    : sentence.lastIndexOf(open) > sentence.lastIndexOf(close)));
}

// Whether `text` already ends a sentence with one of the pack's stops, so
// a list item needs no full stop added.
export function endsSentence(text, pack = languagePack()) {
  return sentenceRules(pack).finished.test(String(text).trim());
}

// With `capitalStart` (the default), only a capital, digit, letter without
// case, or opening quote starts the next sentence, so `"Why?" she asked`
// stays one sentence. The synopsis turns it off because its list items may
// start in lower case. `pack` is the story's language pack, English by
// default.
export function splitSentences(text, { capitalStart = true, pack = languagePack() } = {}) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (normalized === "") {
    return [];
  }
  const rules = sentenceRules(pack);
  const sentences = [];
  let start = 0;
  for (const match of normalized.matchAll(rules.end)) {
    if (rules.fullWidth.test(match[0])) {
      const end = closingQuotes(normalized, start, match.index + match[0].length, rules);
      sentences.push(normalized.slice(start, end).trim());
      start = end;
      continue;
    }
    const end = match.index + match[0].length;
    // Only the words either side of the stop decide, so test short windows:
    // slicing the whole text each time would make long passages quadratic.
    const next = normalized.slice(end + 1, end + 1 + CONTEXT_WINDOW);
    if (capitalStart && next !== "" && !rules.start.test(next)) {
      continue;
    }
    // A cut window gets a letter in front, so its first word never counts
    // as whole.
    const from = Math.max(start, match.index - CONTEXT_WINDOW);
    const before = `${from > start ? "x" : ""}${normalized.slice(from, match.index)}`;
    const abbreviation = match[0] === "." && (rules.context.test(before)
      ? /^[\p{Ll}\p{N}]/u.test(next) || rules.calendar.test(next)
      : rules.title.test(before));
    const stammer = /^(?:…|\.\.\.)/.test(match[0]) && isStammer(before, next, rules);
    if (abbreviation || stammer) {
      continue;
    }
    sentences.push(normalized.slice(start, end).trim());
    start = end;
  }
  const tail = normalized.slice(start).trim();
  if (tail !== "") {
    sentences.push(rules.finished.test(tail) ? tail : `${tail}.`);
  }
  return sentences.filter((sentence) => sentence !== "");
}

// "I… I don't": the word after an ellipsis repeats the word before it.
function isStammer(before, next, rules) {
  const last = /([\p{L}\p{N}'’]+)$/u.exec(before);
  const first = rules.firstWord.exec(next);
  return Boolean(last && first) && last[1].toLowerCase() === first[1].toLowerCase();
}

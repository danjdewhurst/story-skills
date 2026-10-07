import { checkList, checkSet, languagePack } from "./languages/index.js";
import { lowerCase } from "./languages/locale.js";
import { escapeRegExp } from "./markdown.js";
import { SENTENCE_OPENERS, anyOf, charClass, punctuation } from "./punctuation.js";

// One sentence splitter for synopsis, prose, and voices, so `Dr. Hale`, the
// `U.S. Navy`, and a stammer (`I… I don't know`) never end a sentence.

// Words that end in a full stop without ending the sentence come from the
// language pack. Titles and initials (Dr. Hale, J. Smith, the U.S. Navy)
// never end one. Words that often close a sentence too (etc., No., a.m.)
// end it unless the next word starts in lower case, with a digit, or is a
// calendar word (No. 5, 9 a.m. Monday). Initials need no list, so a
// language without one still keeps them. In a pack with
// `capitalInitials`, any capital letter is an initial too (É. Zola); only
// capitals, so a one-letter word (Russian я, Portuguese é) still ends a
// sentence. A capital alone, outside a run of initials (J. R., U.S.,
// z. B.), ends one before a word that is never a name (So do I. She left.,
// plan B. Nobody); see loneCapitalEnds.
const INITIALS = "(?:[A-Za-z]\\.)*[A-Za-z]";
const CAPITAL_INITIALS = "(?:\\p{Lu}\\.)*\\p{Lu}";
// A letter right before the stop that follows another initial (J. R,
// U.S, z. B), so it belongs to a run of initials.
const INITIAL_RUN = /(?:^|[^\p{L}\p{N}])\p{L}\. ?\p{L}$/u;
// Japanese particles that tie a quote to the clause after it, so a stop
// inside the quote does not end the sentence: 「はい。」と言った。 is one.
// Only before punctuation or a verb of saying or thinking, so a word that
// starts with と (ところが, とにかく, とても) still starts a new sentence.
// Only Japanese writes them, so this holds in any language.
const QUOTATIVE = new RegExp("^(?:と|って)(?:$|[、，。！？!?…―—]"
  + "|[言云思聞訊尋叫答返呟囁告話笑続頷怒書呼考感述繰漏応唱祈誓説念頼謝断命誘促喚呻唸泣嘆記伝教知信決願望名称認]"
  + "|い[うっいわえ]|おも[うっいわえ]|わら[うっいわえ]|こたえ|さけ[ぶびん]|つぶや|ささや|たずね)");
const NEVER = "(?!)";
// How many characters either side of a stop decide whether it ends a
// sentence.
const CONTEXT_WINDOW = 64;
// Brackets and emphasis marks that close a sentence after its stop, or
// open one before its first word.
const CLOSING_MARKS = ")\\]*_";
const OPENING_MARKS = "(\\[*_";
// A stop that ends an abbreviation: one full stop, with any closing marks
// after it (*Mr.*, [Dr.], (Mr.)).
const ABBREVIATION_STOP = new RegExp(`^\\.[${CLOSING_MARKS}]*$`);
// Brackets that close a sentence after a full-width stop (。」), in any
// language.
const FULL_WIDTH_CLOSERS = "」』）";
// Closing guillemets, which some languages set after a space.
const SPACED_CLOSERS = "»›";
const SPACED_OPENERS = "«‹";
// Symbols, each with the skin-tone modifiers, variation selectors, zero-width
// joiners, and tag characters that finish it (❤️, 👨‍👩‍👧, the 🏴 of a flag),
// and the space after them.
const EMOJI_RUN = "(?:\\p{So}[\\p{Sk}\\p{Mn}\\u200D\\uFE0F\\u{E0020}-\\u{E007F}]* ?)*";
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
  // An apostrophe in a list word matches a straight or curly one.
  const words = (name) => (checkList(pack, name) ?? []).map((word) => escapeRegExp(word).replace(/'/g, "['’]"));
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
  // A dialogue dash opens a sentence too, with or without a space after it
  // (—Vete. —Ella se giró., – Kom hit.), but only before a capital: after
  // a letter without case nothing tells a new sentence from a tag
  // (ماذا؟ — قال أحمد.), whatever the pack.
  const dashed = `(?:[${openers}${OPENING_MARKS}]|${anyOf(spacedOpeners)} |${anyOf(marks.dashes)} ?)*`;
  // After a full-width stop, which needs no space, a closing mark that can
  // also open a quote in this language (“ closes „…“ but opens “…”) is taken
  // only when it closes a quote still open in the sentence; see
  // closingQuotes.
  const ambiguous = [...marks.closers].filter((mark) => marks.openers.includes(mark)).join("");
  const plainClosers = charClass([...marks.closers].filter((mark) => !ambiguous.includes(mark)).join(""));
  // A spaced stop's match starts only at the first stop of a run. A run
  // with no space after it (.....x) otherwise fails again from each stop
  // in it, which is quadratic in the run's length.
  const ends = [
    marks.spacedEnds === "" ? null : `(?<!${anyOf(marks.spacedEnds)})${anyOf(marks.spacedEnds)}+(?: ${anyOf(spacedClosers)})?[${closers}${CLOSING_MARKS}]*(?= |$)`,
    marks.fullWidthEnds === "" ? null : `${anyOf(marks.fullWidthEnds)}+`
  ].filter(Boolean);
  // A letter of a script without case (Arabic, Hebrew, Devanagari, Chinese,
  // Japanese, Thai) starts a sentence as a capital does. In a pack for such
  // a script (`cased: false`) any letter starts one.
  const startLetter = pack.cased === false ? "\\p{L}\\p{N}" : "\\p{Lu}\\p{Lo}\\p{N}";
  // Capitalised words that are never names (She, Nobody). Calendar words
  // are left out, since May, Mayo, and Mai are surnames too.
  const nonNames = either(words("candidateStopwords"));
  return {
    title: new RegExp(`(?:^|[\\s${openers}${OPENING_MARKS}])(?:${either(words("titleAbbreviations"))})$`),
    initial: new RegExp(`(?:^|[\\s${openers}${OPENING_MARKS}])(?:${INITIALS}${pack.capitalInitials === true ? `|${CAPITAL_INITIALS}` : ""})$`, "u"),
    // The next word is an initial too (I. M. Pei).
    nextInitial: new RegExp(`^${dashed}\\p{Lu}\\.`, "u"),
    // The next word is never a name, whole or before a contraction (It's),
    // and whether a capital follows it.
    nextNonName: new RegExp(`^${dashed}(${nonNames})(?![\\p{L}\\p{N}]|['’]\\p{Lu})( \\p{Lu})?`, "u"),
    // Articles, particles, and titles that may start a name (Le Guin,
    // De León, The Navy), from the pack's title words.
    particles: checkSet(pack, "titleWords") ?? new Set(),
    dash: new RegExp(`^${anyOf(marks.dashes)}`),
    // In a pack with `ordinalStop`, a number before the stop is an ordinal
    // (am 3. Mai) and is read like a context abbreviation.
    context: new RegExp(`(?:^|[\\s${openers}${OPENING_MARKS}])(?:${either([...words("contextAbbreviations"), ...(pack.ordinalStop === true ? ["\\d+"] : [])])})$`),
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
    // case, after any opening quotes, brackets, or emphasis marks, or with
    // a capital after a dialogue dash. Emoji before that word (Yay! 😀 Next)
    // do not change where the sentence starts.
    start: new RegExp(`^${EMOJI_RUN}(?:${opening}[${startLetter}]|${dashed}\\p{Lu})`, "u"),
    // A last sentence that already ends with a stop gets no full stop.
    finished: new RegExp(`${anyOf(marks.spacedEnds + marks.fullWidthEnds)}(?: ${anyOf(spacedClosers)})?[${closers})\\]${FULL_WIDTH_CLOSERS}]*$`),
    firstWord: new RegExp(`^${dashed}([\\p{L}\\p{N}'’]+)`, "u")
  };
}

// The end of a sentence that a full-width stop ends at `end`, past any
// closing quotes and brackets after it. A mark that can also open a quote
// counts only when a quote it closes is still open in the sentence; see
// openQuotes.
function closingQuotes(text, start, end, rules, quoteOpen) {
  let position = end;
  while (position < text.length) {
    const mark = text[position];
    if (!rules.fullWidthCloser.test(mark) && !(rules.ambiguous.includes(mark) && quoteOpen(start, position, mark))) {
      break;
    }
    position += 1;
  }
  return position;
}

// Whether a quote that `mark` closes is open in text.slice(start, position):
// an odd number of marks when both are the same, else an opener after the
// last closer. The text is read forward once per sentence, since a
// quotative と keeps a sentence going past many stops.
function openQuotes(text, rules) {
  let start = -1;
  let read = 0;
  let counts = new Map();
  let last = new Map();
  return (from, position, mark) => {
    if (from !== start) {
      start = from;
      read = from;
      counts = new Map();
      last = new Map();
    }
    for (; read < position; read += 1) {
      counts.set(text[read], (counts.get(text[read]) ?? 0) + 1);
      last.set(text[read], read);
    }
    return rules.pairs.some(({ open, close }) => close === mark && (open === close
      ? (counts.get(mark) ?? 0) % 2 === 1
      : (last.get(open) ?? -1) > (last.get(close) ?? -1)));
  };
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
  const quoteOpen = openQuotes(normalized, rules);
  const sentences = [];
  let start = 0;
  for (const match of normalized.matchAll(rules.end)) {
    if (rules.fullWidth.test(match[0])) {
      const stop = match.index + match[0].length;
      const end = closingQuotes(normalized, start, stop, rules, quoteOpen);
      if (end > stop && QUOTATIVE.test(normalized.slice(end, end + 2))) {
        continue;
      }
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
    const abbreviation = ABBREVIATION_STOP.test(match[0]) && (rules.context.test(before)
      ? /^[\p{Ll}\p{N}]/u.test(next) || rules.calendar.test(next) || rules.dash.test(next)
      : rules.title.test(before) || (rules.initial.test(before) && !loneCapitalEnds(before, next, rules, pack)));
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

// Whether the stop after a capital alone, outside a run of initials, ends
// the sentence rather than an initial (J. Smith, Anna K. Smith): only
// when the next word is never a name (So do I. She left., plan B. Nobody
// agreed.). Where the text cannot tell, the sentence runs on: before a
// name (written by I. Asimov), a name particle or article and a capital
// (Ursula K. Le Guin), or another initial (I. M. Pei).
function loneCapitalEnds(before, next, rules, pack) {
  if (!/\p{Lu}$/u.test(before) || INITIAL_RUN.test(before) || rules.nextInitial.test(next)) {
    return false;
  }
  const word = rules.nextNonName.exec(next);
  return word !== null && !(word[2] !== undefined && rules.particles.has(lowerCase(word[1], pack)));
}

// "I… I don't": the word after an ellipsis repeats the word before it.
function isStammer(before, next, rules) {
  const last = /([\p{L}\p{N}'’]+)$/u.exec(before);
  const first = rules.firstWord.exec(next);
  return Boolean(last && first) && last[1].toLowerCase() === first[1].toLowerCase();
}

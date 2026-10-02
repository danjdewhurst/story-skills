import { warn } from "./findings.js";
import { checkList, checkSet, languagePack, skippedChecks, skippedLines } from "./languages/index.js";
import { compareText, lowerCase, matchingCase, matchingText } from "./languages/locale.js";
import { splitWords } from "./markdown.js";
import { givenName } from "./names.js";
import { plural } from "./plural.js";
import { EXCLAMATION_MARKS, QUESTION_MARKS, anyOf, charClass, punctuation } from "./punctuation.js";
import { splitSentences } from "./sentences.js";
import { UNSPACED_LETTERS, wholeWords, wordMatcher } from "./words.js";

// Dialogue voice fingerprints for `story voices`. Speech is attributed only
// when the paragraph says who spoke: a tag naming the speaker next to a
// speech verb, or, failing that, narration that names exactly one character
// (an action beat). Unattributed lines are counted but never guessed at.
// The speech verbs, pronouns, contractions, and stopwords come from the
// story's language pack; a check whose lists the pack lacks is skipped.

export const VOICE_CHECKS = [
  { check: "speech-tags", label: "Speech-tag attribution", lists: ["speechVerbs", "speechPronouns"] },
  { check: "contractions", label: "Contraction counts", lists: ["contractionSuffixes", "contractedIs"] },
  { check: "signature-words", label: "Signature words", lists: ["voiceStopwords"] }
];

const NEVER = "(?!)";
const RULES = new WeakMap();

// The patterns built from a pack's lists, once per pack. A pattern whose
// lists the pack lacks is null.
function voiceRules(pack) {
  if (!RULES.has(pack)) {
    RULES.set(pack, buildVoiceRules(pack));
  }
  return RULES.get(pack);
}

function buildVoiceRules(pack) {
  const verbs = checkList(pack, "speechVerbs");
  const pronouns = checkList(pack, "speechPronouns");
  const suffixes = checkList(pack, "contractionSuffixes");
  const contractedIs = checkList(pack, "contractedIs");
  const elisions = checkList(pack, "elisions") ?? [];
  const apostrophe = (word) => escape(word).replace(/'/g, "['’]");
  const marks = punctuation(pack);
  const closers = `[${charClass(marks.closers)})]*$`;
  const rules = {
    marks,
    // A paragraph that opens with a quote can continue speech left open at
    // the end of the one before.
    opensWithQuote: new RegExp(`^${anyOf(marks.openers)}`),
    // Dialogue set with a leading dash, and the dash that closes its speech.
    dashOpen: marks.dashes === "" ? null : new RegExp(`^${anyOf(marks.dashes)}\\s*`),
    dashClose: new RegExp(`\\s${anyOf(marks.dashes)}`),
    dash: new RegExp(anyOf(marks.dashes)),
    dashStartsLine: pack.dashStartsLine === true,
    // A sentence-ending mark, and text that ends with one.
    stop: new RegExp(anyOf(marks.spacedEnds + marks.fullWidthEnds)),
    stopEnd: new RegExp(`${anyOf(marks.spacedEnds + marks.fullWidthEnds)}[${charClass(marks.closers)})]*$`),
    // A speech verb anywhere in a dash dialogue's tag, or null without verbs.
    tagVerb: null,
    // An opening single quote (‘) after a non-letter, for open speech.
    singleOpen: new Map(marks.pairs.filter((pair) => pair.kind === "single" && pair.open !== pair.close)
      .map((pair) => [pair, new RegExp(`(?<![\\p{L}\\p{N}])${anyOf(pair.open)}`, "u")])),
    question: new RegExp(`${anyOf(QUESTION_MARKS)}${closers}`),
    exclamation: new RegExp(`${anyOf(EXCLAMATION_MARKS)}${closers}`),
    verbs: null,
    tagAfterQuote: null,
    tagBeforeQuote: null,
    dashTag: null,
    dashIncise: null,
    // A tag inside a quote (« Viens, dit-il, nous partons. »), in a pack
    // with `inciseTags`, or null.
    incise: null,
    // Words that open with an apostrophe rather than a single quote.
    elision: new RegExp(`^(?:${elisions.map(listWord).join("|") || NEVER})(?![\\p{L}\\p{N}])`, "iu"),
    // 's is counted only after words where it cannot be a possessive (it's,
    // that's, let's), so "Tom's" is never a contraction.
    contraction: suffixes === null || contractedIs === null
      ? null
      : new RegExp(`[\\p{L}](?:${suffixes.map(apostrophe).join("|") || NEVER})\\b|(?<![\\p{L}\\p{N}])(?:${contractedIs.map(listWord).join("|") || NEVER})['’]s(?![\\p{L}\\p{N}])`, "giu"),
    stopwords: checkSet(pack, "voiceStopwords")
  };
  if (verbs === null || pronouns === null) {
    return rules;
  }
  const verbAlternation = verbs.map(listWord).join("|") || NEVER;
  const pronounAlternation = pronouns.map(listWord).join("|") || NEVER;
  // An inverted tag joined by a hyphen (dit-il, demanda-t-elle), in a pack
  // with `inversionLinks`.
  const links = (checkList(pack, "inversionLinks") ?? []).map(listWord).join("|");
  // French sets a tag inside the speech: after a comma, and closed by
  // another or by the end of the quote (« Viens, dit-il, nous partons. »),
  // or after ? or ! (— Viens ! s'exclama-t-il.). The prose check's tags
  // count as well as the speech verbs.
  // An incise may invert any pronoun (dit-on, demandez-vous).
  const inciseVerbs = [...new Set([...verbs, ...(checkList(pack, "plainTags") ?? []), ...(checkList(pack, "saidBookisms") ?? [])])].map(listWord).join("|");
  const incisePronouns = [...new Set([...pronouns, ...(checkList(pack, "beatPronouns") ?? [])])].map(listWord).join("|");
  const inciseCore = `(?:(?:${inciseVerbs})(?:${links || NEVER})(?:${incisePronouns})|(?:${inciseVerbs})\\s+\\p{Lu}[\\p{L}'’-]*(?:\\s+\\p{Lu}[\\p{L}'’-]*){0,2}|(?:${incisePronouns})\\s+(?:${inciseVerbs}))(?![\\p{L}\\p{N}])`;
  const inciseDash = pack.inciseTags === true ? `|,\\s+(?=${inciseCore})|(?<=[?!…])\\s+(?=${inciseCore})` : "";
  const inverted = links === "" ? "" : `|(?:${verbAlternation})(?:${links})(?:${pronounAlternation})`;
  const pronounTag = `(?:(?:${pronounAlternation})\\s+(?:${verbAlternation})|(?:${verbAlternation})\\s+(?:${pronounAlternation})${inverted})(?![\\p{L}\\p{N}])`;
  return {
    ...rules,
    verbs,
    tagVerb: new RegExp(`(?<![\\p{L}\\p{N}])(?:${verbAlternation})(?![\\p{L}\\p{N}])`, "iu"),
    // A tag right after a closing quote (`"...," she said`) or right before
    // an opening one (`She said, "..."`); a pronoun and verb elsewhere in the
    // paragraph ("She said nothing more") is narration.
    tagAfterQuote: new RegExp(`^[\\s,.;:!?…()—–-]*${pronounTag}`, "iu"),
    tagBeforeQuote: new RegExp(`(?<![\\p{L}\\p{N}])${pronounTag}[\\s,:…()—–-]*$`, "iu"),
    // Dialogue set with a leading dash (— Line, said Cy.) runs to a closing
    // dash or to a tag after a comma.
    incise: pack.inciseTags === true ? new RegExp(`(?:,|(?<=[?!…]))\\s+${inciseCore}\\s*(?:,|[.!?…]?\\s*$)`, "u") : null,
    // In dash dialogue, a tag after a comma that closes with another comma,
    // perhaps after more words (— Viens, dit Paul en souriant, nous
    // partons.): speech resumes after it.
    dashIncise: pack.inciseTags === true ? new RegExp(`^,\\s+${inciseCore}[^,.!?;:…—–«»"“”]*,`, "u") : null,
    dashTag: new RegExp(`(?:,\\s+(?:(?:${verbAlternation})\\s+\\p{Lu}|(?:${pronounAlternation})\\s+(?:${verbAlternation})(?![\\p{L}\\p{N}])${inverted === "" ? "" : `${inverted}(?![\\p{L}\\p{N}])`}|\\p{Lu}[\\p{L}'’-]*(?:\\s+\\p{Lu}[\\p{L}'’-]*){0,2}\\s+(?:${verbAlternation})(?![\\p{L}\\p{N}]))${inciseDash})`, "u")
  };
}

export const VOICE_THRESHOLDS = {
  minLines: 5,
  sentenceLength: 1.5,
  contractions: 1.5,
  questions: 0.1,
  exclamations: 0.1
};

// `project.pack` is the story's language pack (English when absent).
export function buildVoices(project, chapters) {
  const pack = project.pack ?? languagePack();
  const rules = voiceRules(pack);
  const speakers = speakerPatterns(project.characters, pack, rules);
  const lines = new Map(project.characters.map((character) => [character.id, []]));
  let unattributed = 0;

  for (const chapter of chapters) {
    // Speech that runs over several paragraphs leaves its quote open at each
    // paragraph end and reopens it at the next paragraph start. Its lines go
    // to whoever the chain is attributed to, or count as unattributed.
    let pending = [];
    let chainSpeaker = null;
    const credit = (speaker, texts) => {
      if (speaker === null) {
        unattributed += texts.length;
      } else {
        lines.get(speaker).push(...texts.map((text) => ({ chapter: chapter.id, text })));
      }
    };
    for (const paragraph of chapter.paragraphs) {
      const continues = (pending.length > 0 || chainSpeaker !== null) && rules.opensWithQuote.test(paragraph);
      if (!continues) {
        credit(null, pending);
        pending = [];
        chainSpeaker = null;
      }
      const quotes = quotedSpans(paragraph, pack);
      const open = splitOpenSpeech(paragraph, pack).open;
      if (open !== null) {
        quotes.push(open);
      }
      if (quotes.length === 0) {
        continue;
      }
      const speaker = attribute(paragraph, speakers, pack) ?? chainSpeaker;
      if (open !== null && speaker === null) {
        pending.push(...quotes);
        continue;
      }
      credit(speaker, [...pending, ...quotes]);
      pending = [];
      chainSpeaker = open === null ? null : speaker;
    }
    credit(null, pending);
  }

  const profiles = project.characters
    .map((character) => profile(character, lines.get(character.id), pack, rules))
    .filter((entry) => entry.lines > 0);
  signatureWords(profiles, pack);

  const warnings = [];
  // Voice phrases match in the story's casing, so each line is prepared
  // once, when a phrase is first looked for in it.
  const matchers = new Map();
  const says = (pattern, line) => {
    if (!matchers.has(line)) {
      matchers.set(line, wordMatcher(line.text, matchingText(line.text, pack)));
    }
    return matchers.get(line)(pattern, { first: true }).length > 0;
  };
  for (const character of project.characters) {
    const said = lines.get(character.id);
    for (const phrase of stringList(character.voiceAvoid)) {
      const pattern = phrasePattern(phrase, pack);
      const chaptersUsing = [...new Set(said.filter((line) => says(pattern, line)).map((line) => line.chapter))];
      if (chaptersUsing.length > 0) {
        warnings.push(warn("voice-avoid", `${character.id} says "${phrase}", which is in their voice-avoid list (${chaptersUsing.join(", ")})`));
      }
    }
    if (said.length >= VOICE_THRESHOLDS.minLines) {
      for (const phrase of stringList(character.voiceWords)) {
        const pattern = phrasePattern(phrase, pack);
        if (!said.some((line) => says(pattern, line))) {
          // Only attributed lines count, so say so: the phrase may sit in dialogue
          // tagged with a pronoun.
          warnings.push(warn("voice-words-unused", `${character.id} does not say "${phrase}" from their voice-words list in ${said.length} attributed lines of dialogue`));
        }
      }
    }
  }

  const eligible = profiles.filter((entry) => entry.lines >= VOICE_THRESHOLDS.minLines);
  for (let left = 0; left < eligible.length; left += 1) {
    for (let right = left + 1; right < eligible.length; right += 1) {
      if (similarVoices(eligible[left], eligible[right])) {
        const measures = rules.contraction === null ? "sentence length, questions" : "sentence length, contractions, questions";
        warnings.push(warn("voice-sound-alike", `${eligible[left].id} and ${eligible[right].id} may sound alike: similar ${measures}, and exclamations`));
      }
    }
  }

  return {
    profiles: profiles.sort((left, right) => right.words - left.words || left.id.localeCompare(right.id, "en")),
    unattributed,
    warnings,
    language: pack.tag,
    skipped: skippedChecks(pack, VOICE_CHECKS)
  };
}

const TAG_WINDOW = 40;

function hasPronounTag(paragraph, pack) {
  const rules = voiceRules(pack);
  return rules.tagAfterQuote !== null && quoteMatches(paragraph, pack).some((match) => rules.tagAfterQuote.test(paragraph.slice(match.end, match.end + TAG_WINDOW))
    || rules.tagBeforeQuote.test(paragraph.slice(Math.max(0, match.start - TAG_WINDOW), match.start)));
}

// Names are proper nouns, so they match case-sensitively ("the lord's hall"
// is not Lord Maren); speech verbs match in either case. Without speech
// verbs there are no tag patterns, and only action beats attribute speech.
function speakerPatterns(characters, pack, rules) {
  const verbs = rules.verbs === null ? null : rules.verbs
    .flatMap((verb) => [verb, `${verb[0].toUpperCase()}${verb.slice(1)}`])
    .map(listWord)
    .join("|") || NEVER;
  return characters
    .filter((character) => character.status !== "cut")
    .map((character) => {
      const names = new Set();
      const full = String(character.name ?? "").trim();
      if (full !== "") {
        names.add(full);
        const first = givenName(full, pack);
        if (first.length >= 2) {
          names.add(first);
        }
      }
      for (const alias of stringList(character.aliases)) {
        names.add(alias);
      }
      const alternatives = [...names].sort((left, right) => right.length - left.length).map(escape).join("|");
      if (alternatives === "") {
        return null;
      }
      // The first letters-and-digits run of each name: a paragraph can only
      // name this speaker if it contains one of these as a whole word.
      const keys = new Set([...names].map((entry) => entry.split(NON_WORD)[0]));
      return {
        id: character.id,
        keys,
        name: new RegExp(`(?<!${SPACED_LETTER})(?:${alternatives})(?!${SPACED_LETTER})`, "gu"),
        subject: verbs === null ? null : new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})\\s+(?:${verbs})(?![\\p{L}\\p{N}])`, "u"),
        inverted: verbs === null ? null : new RegExp(`(?<![\\p{L}\\p{N}])(?:${verbs})\\s+(?:${alternatives})(?![\\p{L}\\p{N}])`, "u")
      };
    })
    .filter(Boolean);
}

const NON_WORD = /[^\p{L}\p{N}]+/u;

// A letter or digit of a script written with spaces. Chinese, Japanese, Thai,
// Lao, Khmer, and Burmese put none between words, so a name in them sits
// against the next word: wordMatcher checks those edges with wordSpans
// instead.
const SPACED_LETTER = `(?![${UNSPACED_LETTERS}])[\\p{L}\\p{N}]`;
const UNSPACED_LETTER = new RegExp(`[${UNSPACED_LETTERS}]`, "u");

function attribute(paragraph, allSpeakers, pack) {
  const narration = `${splitOpenSpeech(paragraph, pack).narration} `;
  // Test only speakers whose name could appear, so the per-speaker patterns
  // run for a handful of speakers rather than the whole cast. A name in an
  // unspaced script is not split from the words around it, so it is looked
  // for as it stands.
  const words = new Set(narration.split(NON_WORD));
  const speakers = allSpeakers.filter((speaker) => [...speaker.keys].some((key) => key === "" || words.has(key)
    || (UNSPACED_LETTER.test(key) && narration.includes(key))));
  // "Sera told Kael": the name before the verb is the speaker, so subject
  // tags win over inverted ones ("said Sera").
  for (const form of ["subject", "inverted"]) {
    const tagged = speakers.filter((speaker) => speaker[form] !== null && speaker[form].test(narration));
    if (tagged.length === 1) {
      return tagged[0].id;
    }
    if (tagged.length > 1) {
      return null;
    }
  }
  // A pronoun tag ("she said") names nobody, so a character merely named
  // nearby in the narration is not taken to be the speaker.
  if (hasPronounTag(paragraph, pack)) {
    return null;
  }
  const findWords = wordMatcher(narration);
  const named = speakers.filter((speaker) => findWords(speaker.name, { first: true }).length > 0);
  return named.length === 1 ? named[0].id : null;
}

const LETTER = /[\p{L}\p{N}]/u;

// Quoted speech in a paragraph, left to right, using the pack's quote pairs
// (“…”, « … », „…“, 「…」), so » opens speech in German and closes it in
// French. A pair whose marks differ pairs explicitly, and one whose marks
// are the same (", or Swedish ”) pairs in order. A pair that closes with a
// mark that can be an apostrophe (‘…’, '…', Swedish ’…’) opens after a
// non-letter and closes before one, so an apostrophe inside a word (don’t)
// never ends the quote, and a plural possessive (the dogs’ bowls) does not
// end it when a later closer does. A paragraph that opens with the pack's
// dialogue dash is dialogue up to a closing dash or its tag, and resumes
// after the next dash (—Ya voy —dijo ella—. Espera.). Returns
// { start, end, text } with `end` just past the closing mark. Each search
// for a closer resumes where the last one stopped, so the scan stays close
// to linear however many quotes never close.
export function quoteMatches(paragraph, pack = languagePack()) {
  const rules = voiceRules(pack);
  const matches = [];
  const next = new Map();
  const find = (key, from) => {
    const known = next.get(key) ?? -1;
    if (known !== Infinity && known < from) {
      const found = paragraph.indexOf(key, from);
      next.set(key, found === -1 ? Infinity : found);
    }
    return next.get(key);
  };
  const singles = singleQuoteMarks(paragraph, rules);
  let index = dashMatches(paragraph, rules, matches);
  while (index < paragraph.length) {
    let close = Infinity;
    for (const pair of rules.marks.byOpener.get(paragraph[index]) ?? []) {
      close = Math.min(close, pair.kind === "single" ? singleClose(singles.get(pair), index) : find(pair.close, index + 1));
    }
    if (close === Infinity) {
      index += 1;
      continue;
    }
    matches.push(...splitIncise({ start: index, end: close + 1, text: paragraph.slice(index + 1, close).trim() }, paragraph, rules));
    index = close + 1;
  }
  return matches;
}

// A quote with a tag inside it (« Viens, dit-il, nous partons. ») as the
// speech either side of the tag, so the tag reads as narration. The first
// part ends where the tag starts, so the tag follows it as it follows a
// closed quote; a tag at the end of the quote leaves one part.
function splitIncise(match, paragraph, rules) {
  const tag = rules.incise === null ? null : rules.incise.exec(paragraph.slice(match.start + 1, match.end - 1));
  if (tag === null) {
    return [match];
  }
  const tagStart = match.start + 1 + tag.index;
  const tagEnd = tagStart + tag[0].length;
  const first = { start: match.start, end: tagStart, text: paragraph.slice(match.start + 1, tagStart).trim() };
  const rest = paragraph.slice(tagEnd, match.end - 1).trim();
  return rest === "" ? [first] : [first, { start: tagEnd - 1, end: match.end, text: rest }];
}

// Speech in a paragraph that opens with the dialogue dash, added to
// `matches`; returns where the quote scan starts. Speech stops at a tag
// after a comma or at a closing dash. After a closing dash, speech starts
// again:
// - at once, in a pack with `dashStartsLine` (Swedish, Finnish), when the
//   speech before it ended a sentence, holds no speech verb, and a capital
//   follows the dash (– Hej, sa Anna. – Kom hit.); elsewhere that dash
//   opens narration (—Is it? —I asked.);
// - after the tag, when the next dash closes it (see tagCloses).
// The searches use global patterns from a moving start, never slices of
// the rest, so many dashes stay linear.
function dashMatches(paragraph, rules, matches) {
  const dash = rules.dashOpen === null ? null : rules.dashOpen.exec(paragraph);
  if (!dash) {
    return 0;
  }
  const search = (pattern) => {
    const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
    let found = { index: -1 };
    return (from) => {
      if (found !== null && found.index < from) {
        global.lastIndex = from;
        found = global.exec(paragraph);
      }
      return found === null ? Infinity : found.index;
    };
  };
  const nextTag = rules.dashTag === null ? () => Infinity : search(rules.dashTag);
  const nextClosing = search(rules.dashClose);
  const nextDash = search(rules.dash);
  let start = 0;
  let from = dash[0].length;
  let index;
  do {
    const tag = nextTag(from);
    const closing = nextClosing(from) + 1;
    const close = Math.min(tag, closing, paragraph.length);
    const text = paragraph.slice(from, close).trim();
    const closedByDash = closing < Math.min(tag, paragraph.length);
    const newLine = closedByDash && rules.dashStartsLine && rules.stopEnd.test(text)
      && /^\s*\p{Lu}/u.test(paragraph.slice(close + 1, close + 4)) && !(rules.tagVerb !== null && rules.tagVerb.test(text));
    matches.push({ start, end: newLine ? close : Math.min(close + 1, paragraph.length), text });
    index = close + 1;
    start = Infinity;
    const incise = !closedByDash && close === tag && rules.dashIncise !== null ? rules.dashIncise.exec(paragraph.slice(close, close + 120)) : null;
    if (newLine) {
      start = close;
    } else if (incise !== null) {
      // Speech resumes after the incise's closing comma.
      start = close + incise[0].length - 1;
    } else if (closedByDash) {
      const next = nextDash(index);
      start = next !== Infinity && tagCloses(paragraph, index, next, rules) ? next : Infinity;
    }
    from = start === Infinity ? Infinity : start + 1 + /^[\s.,;:]*/.exec(paragraph.slice(start + 1, start + 65))[0].length;
  } while (from < paragraph.length);
  return index;
}

// Whether the dash at `dash` closes the tag that starts at `from`, so speech
// resumes after it: Spanish closes the tag with a dash against its last
// word (—dijo ella—. Espera.), Russian with a spaced dash after its
// punctuation (— сказал он. — Как дела?). A dash between two words, or one
// after narration that has run past a sentence end, is narration
// (—he said. The sky darkened—rain was coming.). With speech verbs, the
// tag must hold one, so —the house fell silent —or almost— is narration.
function tagCloses(paragraph, from, dash, rules) {
  const tag = paragraph.slice(from, dash).trimEnd();
  if (rules.tagVerb !== null && !rules.tagVerb.test(tag)) {
    return false;
  }
  if (/\s/.test(paragraph[dash - 1] ?? "")) {
    return /[.!?…,;:]$/.test(tag) && !rules.stop.test(tag.slice(0, -1));
  }
  return !LETTER.test(paragraph[dash + 1] ?? "") && !rules.stop.test(tag);
}

// Opening and closing positions of each quote pair that closes with a mark
// that can be an apostrophe, in order, by pair. When both marks are the
// same ('…', Swedish ’…’), a mark opens after a non-letter and before a
// letter that does not start an elision ('tis), and closes before a
// non-letter after a non-space.
function singleQuoteMarks(paragraph, rules) {
  const marks = new Map();
  for (const pair of rules.marks.pairs) {
    if (pair.kind !== "single") {
      continue;
    }
    const open = [];
    const close = [];
    for (let index = paragraph.indexOf(pair.open); index !== -1; index = paragraph.indexOf(pair.open, index + 1)) {
      const before = paragraph[index - 1] ?? "";
      const after = paragraph[index + 1] ?? "";
      if (pair.open === pair.close) {
        if (!LETTER.test(before) && LETTER.test(after) && !rules.elision.test(paragraph.slice(index + 1))) {
          open.push(index);
        } else if (!LETTER.test(after) && before !== "" && !/\s/.test(before)) {
          close.push(index);
        }
      } else if (!LETTER.test(before)) {
        open.push(index);
      }
    }
    if (pair.open !== pair.close) {
      for (let index = paragraph.indexOf(pair.close); index !== -1; index = paragraph.indexOf(pair.close, index + 1)) {
        if (!LETTER.test(paragraph[index + 1] ?? "")) {
          close.push(index);
        }
      }
    }
    marks.set(pair, { open, close, opens: new Set(open), paragraph });
  }
  return marks;
}

// The closer for the single quote opening at `index`, or Infinity when the
// next opener comes first.
function singleClose(marks, index) {
  if (!marks.opens.has(index)) {
    return Infinity;
  }
  const nextOpen = firstAfter(marks.open, index);
  let position = firstIndexAfter(marks.close, index);
  if (position === -1 || marks.close[position] > nextOpen) {
    return Infinity;
  }
  // "dogs’ bowls": an s-possessive before a lower-case word is skipped when
  // another closer follows before the next opener.
  while (position + 1 < marks.close.length && marks.close[position + 1] < nextOpen && looksPossessive(marks.paragraph, marks.close[position])) {
    position += 1;
  }
  return marks.close[position];
}

function looksPossessive(paragraph, index) {
  return /[sS]/.test(paragraph[index - 1] ?? "") && /^\s+\p{Ll}/u.test(paragraph.slice(index + 1, index + 4));
}

function firstIndexAfter(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low < sorted.length ? low : -1;
}

function firstAfter(sorted, value) {
  const position = firstIndexAfter(sorted, value);
  return position === -1 ? Infinity : sorted[position];
}

// The paragraph with each quote replaced by a space.
export function replaceQuotes(paragraph, pack = languagePack()) {
  let result = "";
  let position = 0;
  for (const match of quoteMatches(paragraph, pack)) {
    result += `${paragraph.slice(position, match.start)} `;
    position = match.end;
  }
  return result + paragraph.slice(position);
}

export function quotedSpans(paragraph, pack = languagePack()) {
  return quoteMatches(paragraph, pack).map((match) => match.text.trim()).filter((text) => text !== "");
}

// The paragraph's narration, and the text of speech still open at its end
// (or null). Open speech starts at the first opener with no closer after it,
// found with index searches so a run of unclosed quotes stays linear; a
// quote whose marks are the same and can be apostrophes ('…') counts only
// when it opens the paragraph.
export function splitOpenSpeech(paragraph, pack = languagePack()) {
  const text = replaceQuotes(paragraph, pack);
  const rules = voiceRules(pack);
  const cuts = rules.marks.pairs.map((pair) => {
    const { open, close, kind } = pair;
    if (kind === "straight") {
      return text.indexOf(open);
    }
    if (kind === "explicit") {
      return text.indexOf(open, text.lastIndexOf(close) + 1);
    }
    if (open !== close) {
      const lastClose = text.lastIndexOf(close);
      const single = rules.singleOpen.get(pair).exec(text.slice(lastClose + 1));
      return single ? lastClose + 1 + single.index : -1;
    }
    return text.startsWith(open) && /^[\s\S][\p{L}\p{N}]/u.test(text) && !rules.elision.test(text.slice(1)) ? 0 : -1;
  }).filter((cut) => cut !== -1);
  if (cuts.length === 0) {
    return { narration: text, open: null };
  }
  const cut = Math.min(...cuts);
  const open = text.slice(cut + 1).trim();
  return { narration: text.slice(0, cut), open: open === "" ? null : open };
}

// The paragraph without its quoted speech, for narration-only checks.
export function narrationOnly(paragraph, pack = languagePack()) {
  return splitOpenSpeech(paragraph, pack).narration;
}

// `contractions` is null when the pack has no contraction lists.
function profile(character, said, pack, rules) {
  const text = said.map((line) => line.text).join(" ");
  const words = splitWords(text);
  const sentences = said.flatMap((line) => splitSentences(line.text, { pack }).filter((sentence) => splitWords(sentence).length > 0));
  const questions = sentences.filter((sentence) => rules.question.test(sentence.trim())).length;
  const exclamations = sentences.filter((sentence) => rules.exclamation.test(sentence.trim())).length;
  return {
    id: character.id,
    lines: said.length,
    words: words.length,
    sentenceLength: sentences.length === 0 ? 0 : words.length / sentences.length,
    contractions: rules.contraction === null ? null : words.length === 0 ? 0 : ((text.match(rules.contraction) ?? []).length * 100) / words.length,
    questions: sentences.length === 0 ? 0 : questions / sentences.length,
    exclamations: sentences.length === 0 ? 0 : exclamations / sentences.length,
    counts: wordCounts(words, rules.stopwords, pack),
    signature: []
  };
}

// Without stopwords no word is counted, so no signature words are found.
function wordCounts(words, stopwords, pack) {
  const counts = new Map();
  if (stopwords === null) {
    return counts;
  }
  for (const raw of words) {
    const word = lowerCase(raw, pack).replace(/’/g, "'");
    if (word.length >= 4 && !stopwords.has(word) && !/^\d+$/.test(word)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return counts;
}

// A signature word is one a character uses at least twice and more often,
// per word spoken, than everyone else's dialogue combined.
function signatureWords(profiles, pack) {
  const totals = new Map();
  let allWords = 0;
  for (const entry of profiles) {
    allWords += entry.words;
    for (const [word, count] of entry.counts) {
      totals.set(word, (totals.get(word) ?? 0) + count);
    }
  }
  for (const entry of profiles) {
    const otherWords = allWords - entry.words;
    const scored = [];
    for (const [word, count] of entry.counts) {
      if (count < 2) {
        continue;
      }
      const own = count / entry.words;
      const others = otherWords === 0 ? 0 : (totals.get(word) - count) / otherWords;
      if (own > others * 2) {
        scored.push({ word, count, score: own - others });
      }
    }
    entry.signature = scored
      .sort((left, right) => right.score - left.score || right.count - left.count || compareText(pack)(left.word, right.word))
      .slice(0, 5)
      .map((item) => item.word);
    delete entry.counts;
  }
}

// Each measure must differ by less than its limit. The small allowance
// keeps floating-point error from deciding the boundary, so shares exactly
// 10 points apart are never "close" (0.3 - 0.2 is 0.0999...). Skipped
// contraction counts (null) are left out of the comparison.
function similarVoices(left, right) {
  const limits = VOICE_THRESHOLDS;
  const close = (a, b, limit) => Math.abs(a - b) < limit - 1e-9;
  return close(left.sentenceLength, right.sentenceLength, limits.sentenceLength)
    && (left.contractions === null || close(left.contractions, right.contractions, limits.contractions))
    && close(left.questions, right.questions, limits.questions)
    && close(left.exclamations, right.exclamations, limits.exclamations);
}

// A voice-words or voice-avoid phrase as whole words, for wordMatcher on
// matchingText.
function phrasePattern(phrase, pack) {
  const trimmed = String(phrase).trim();
  return new RegExp(wholeWords(escape(matchingCase(trimmed, pack)).replace(/['’]/g, "['’]"), trimmed), "giu");
}

// A word-list entry as a pattern: an apostrophe matches a straight or
// curly one, and a space any run of spaces.
function listWord(word) {
  return escape(word).replace(/'/g, "['’]").replace(/ /g, "\\s+");
}

function escape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringList(value) {
  return (Array.isArray(value) ? value : []).filter((item) => typeof item === "string" && item.trim() !== "");
}

export function formatVoices(report) {
  const skipped = report.skipped ?? [];
  const lines = [`Voices: ${plural(report.profiles.length, "speaking character")}, ${plural(report.unattributed, "unattributed line")}`, ...skippedLines(skipped)];
  if (report.profiles.length === 0) {
    lines.push("", "- None: tag dialogue with a character's name and a speech verb (\"...,\" Mara said)");
    return `${lines.join("\n")}\n`;
  }
  const signatures = !skipped.some((entry) => entry.check === "signature-words");
  for (const entry of report.profiles) {
    const contractions = entry.contractions === null ? "" : `, contractions ${entry.contractions.toFixed(1)} per 100 words`;
    lines.push(
      "",
      `${entry.id}: ${plural(entry.lines, "line")}, ${plural(entry.words, "word")}`,
      `  Sentence length ${entry.sentenceLength.toFixed(1)}${contractions}, questions ${Math.round(entry.questions * 100)}%, exclamations ${Math.round(entry.exclamations * 100)}%`,
      ...(signatures ? [`  Signature words: ${entry.signature.join(", ") || "none yet"}`] : [])
    );
  }
  return `${lines.join("\n")}\n`;
}

import { warn } from "./findings.js";
import { splitWords } from "./markdown.js";
import { givenName } from "./names.js";
import { plural } from "./plural.js";
import { splitSentences } from "./sentences.js";

// Dialogue voice fingerprints for `story voices`. Speech is attributed only
// when the paragraph says who spoke: a tag naming the speaker next to a
// speech verb, or, failing that, narration that names exactly one character
// (an action beat). Unattributed lines are counted but never guessed at.

const SPEECH_VERBS = [
  "said", "says", "asked", "asks", "replied", "replies", "answered", "answers",
  "whispered", "whispers", "shouted", "shouts", "called", "calls", "muttered",
  "mutters", "murmured", "murmurs", "cried", "cries", "yelled", "yells",
  "added", "adds", "told", "tells", "snapped", "snaps", "admitted", "admits",
  "insisted", "insists", "demanded", "demands", "continued", "continues",
  "began", "begins", "went on", "goes on"
];

// 's is counted only after words where it cannot be a possessive (it's,
// that's, let's), so "Tom's" is never a contraction.
const CONTRACTION_PATTERN = /[\p{L}](?:n['’]t|['’](?:re|ll|ve|m|d))\b|(?<![\p{L}\p{N}])(?:it|that|let|what|there|here|where|who|he|she|how|when|why)['’]s(?![\p{L}\p{N}])/giu;

// Common words that say nothing about a voice.
const STOPWORDS = new Set([
  "that", "this", "with", "have", "what", "from", "they", "there", "their", "them",
  "then", "than", "were", "would", "could", "should", "your", "yours", "just",
  "know", "been", "will", "when", "where", "which", "about", "into", "some",
  "because", "want", "like", "only", "here", "does", "didn't", "don't", "it's",
  "can't", "won't", "i'm", "you're", "we're", "that's", "there's", "what's",
  "going", "come", "back", "over", "tell", "said", "more", "very", "also"
]);

export const VOICE_THRESHOLDS = {
  minLines: 5,
  sentenceLength: 1.5,
  contractions: 1.5,
  questions: 0.1,
  exclamations: 0.1
};

export function buildVoices(project, chapters) {
  const speakers = speakerPatterns(project.characters);
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
      const continues = (pending.length > 0 || chainSpeaker !== null) && OPENS_WITH_QUOTE.test(paragraph);
      if (!continues) {
        credit(null, pending);
        pending = [];
        chainSpeaker = null;
      }
      const quotes = quotedSpans(paragraph);
      const open = splitOpenSpeech(paragraph).open;
      if (open !== null) {
        quotes.push(open);
      }
      if (quotes.length === 0) {
        continue;
      }
      const speaker = attribute(paragraph, speakers) ?? chainSpeaker;
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
    .map((character) => profile(character, lines.get(character.id)))
    .filter((entry) => entry.lines > 0);
  signatureWords(profiles);

  const warnings = [];
  for (const character of project.characters) {
    const said = lines.get(character.id);
    for (const phrase of stringList(character.voiceAvoid)) {
      const pattern = phrasePattern(phrase);
      const chaptersUsing = [...new Set(said.filter((line) => pattern.test(line.text)).map((line) => line.chapter))];
      if (chaptersUsing.length > 0) {
        warnings.push(warn("voice-avoid", `${character.id} says "${phrase}", which is in their voice-avoid list (${chaptersUsing.join(", ")})`));
      }
    }
    if (said.length >= VOICE_THRESHOLDS.minLines) {
      for (const phrase of stringList(character.voiceWords)) {
        const pattern = phrasePattern(phrase);
        if (!said.some((line) => pattern.test(line.text))) {
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
        warnings.push(warn("voice-sound-alike", `${eligible[left].id} and ${eligible[right].id} may sound alike: similar sentence length, contractions, questions, and exclamations`));
      }
    }
  }

  return {
    profiles: profiles.sort((left, right) => right.words - left.words || left.id.localeCompare(right.id, "en")),
    unattributed,
    warnings
  };
}

// Personal pronouns that tag speech; "it" and "you" are left out because
// "It went on raining" is narration, not a tag.
const PRONOUNS = "he|she|they|i|we";
const VERB_ALTERNATION = SPEECH_VERBS.map((verb) => verb.replace(/ /g, "\\s+")).join("|");
const PRONOUN_TAG_SOURCE = `(?:(?:${PRONOUNS})\\s+(?:${VERB_ALTERNATION})|(?:${VERB_ALTERNATION})\\s+(?:${PRONOUNS}))(?![\\p{L}\\p{N}])`;
// A tag right after a closing quote (`"...," she said`) or right before an
// opening one (`She said, "..."`); a pronoun and verb elsewhere in the
// paragraph ("She said nothing more") is narration.
const TAG_AFTER_QUOTE = new RegExp(`^[\\s,.;:!?…()—–-]*${PRONOUN_TAG_SOURCE}`, "iu");
const TAG_BEFORE_QUOTE = new RegExp(`(?<![\\p{L}\\p{N}])${PRONOUN_TAG_SOURCE}[\\s,:…()—–-]*$`, "iu");
const TAG_WINDOW = 40;

function hasPronounTag(paragraph) {
  return quoteMatches(paragraph).some((match) => TAG_AFTER_QUOTE.test(paragraph.slice(match.end, match.end + TAG_WINDOW))
    || TAG_BEFORE_QUOTE.test(paragraph.slice(Math.max(0, match.start - TAG_WINDOW), match.start)));
}

// Names are proper nouns, so they match case-sensitively ("the lord's hall"
// is not Lord Maren); speech verbs match in either case.
function speakerPatterns(characters) {
  const verbs = SPEECH_VERBS
    .flatMap((verb) => [verb, `${verb[0].toUpperCase()}${verb.slice(1)}`])
    .map((verb) => verb.replace(/ /g, "\\s+"))
    .join("|");
  return characters
    .filter((character) => character.status !== "cut")
    .map((character) => {
      const names = new Set();
      const full = String(character.name ?? "").trim();
      if (full !== "") {
        names.add(full);
        const first = givenName(full);
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
        name: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "u"),
        subject: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})\\s+(?:${verbs})(?![\\p{L}\\p{N}])`, "u"),
        inverted: new RegExp(`(?<![\\p{L}\\p{N}])(?:${verbs})\\s+(?:${alternatives})(?![\\p{L}\\p{N}])`, "u")
      };
    })
    .filter(Boolean);
}

const NON_WORD = /[^\p{L}\p{N}]+/u;

const OPENS_WITH_QUOTE = /^["“‘']/;

function attribute(paragraph, allSpeakers) {
  const narration = `${splitOpenSpeech(paragraph).narration} `;
  // Test only speakers whose name could appear, so the per-speaker patterns
  // run for a handful of speakers rather than the whole cast.
  const words = new Set(narration.split(NON_WORD));
  const speakers = allSpeakers.filter((speaker) => [...speaker.keys].some((key) => key === "" || words.has(key)));
  // "Sera told Kael": the name before the verb is the speaker, so subject
  // tags win over inverted ones ("said Sera").
  for (const form of ["subject", "inverted"]) {
    const tagged = speakers.filter((speaker) => speaker[form].test(narration));
    if (tagged.length === 1) {
      return tagged[0].id;
    }
    if (tagged.length > 1) {
      return null;
    }
  }
  // A pronoun tag ("she said") names nobody, so a character merely named
  // nearby in the narration is not taken to be the speaker.
  if (hasPronounTag(paragraph)) {
    return null;
  }
  const named = speakers.filter((speaker) => speaker.name.test(narration));
  return named.length === 1 ? named[0].id : null;
}

const LETTER = /[\p{L}\p{N}]/u;
// Words that open with an apostrophe rather than a single quote.
const ELISION = /^(?:em|tis|twas|cause|cos|til|till|bout|round|n|nuff)(?![\p{L}\p{N}])/iu;
// Dialogue set with a leading dash (— Line, said Cy.) runs to a closing dash
// or to a tag after a comma.
const DASH_OPEN = /^[—―]\s*/;
const DASH_TAG = new RegExp(`,\\s+(?:(?:${VERB_ALTERNATION})\\s+\\p{Lu}|(?:${PRONOUNS})\\s+(?:${VERB_ALTERNATION})(?![\\p{L}\\p{N}])|\\p{Lu}[\\p{L}'’-]*(?:\\s+\\p{Lu}[\\p{L}'’-]*){0,2}\\s+(?:${VERB_ALTERNATION})(?![\\p{L}\\p{N}]))`, "u");

// Quoted speech in a paragraph, left to right: curly double quotes pair
// explicitly and straight quotes pair in order. Single quotes (curly or
// straight) open after a non-letter and close before one, so an apostrophe
// inside a word (don’t) never ends the quote, and a plural possessive
// (the dogs’ bowls) does not end it when a later closer does. A paragraph
// that opens with a dash is dialogue up to a closing dash or its tag.
// Returns { start, end, text } with `end` just past the closing mark. Each
// search for a closer resumes where the last one stopped, so the scan stays
// close to linear however many quotes never close.
export function quoteMatches(paragraph) {
  const matches = [];
  const next = { "”": -1, "\"": -1 };
  const find = (key, from) => {
    if (next[key] !== Infinity && next[key] < from) {
      const found = paragraph.indexOf(key, from);
      next[key] = found === -1 ? Infinity : found;
    }
    return next[key];
  };
  const singles = singleQuoteMarks(paragraph);
  let index = 0;
  const dash = DASH_OPEN.exec(paragraph);
  if (dash) {
    const body = paragraph.slice(dash[0].length);
    const tag = DASH_TAG.exec(body);
    const closing = /\s[—―]/.exec(body);
    const stop = Math.min(tag ? tag.index : Infinity, closing ? closing.index + 1 : Infinity);
    const close = stop === Infinity ? paragraph.length : dash[0].length + stop;
    matches.push({ start: 0, end: Math.min(close + 1, paragraph.length), text: paragraph.slice(dash[0].length, close) });
    index = close + 1;
  }
  while (index < paragraph.length) {
    const char = paragraph[index];
    let close = Infinity;
    if (char === "“") {
      close = find("”", index + 1);
    } else if (char === "\"") {
      close = find("\"", index + 1);
    } else if (char === "‘" || char === "'") {
      close = singleClose(singles[char], index);
    }
    if (close === Infinity) {
      index += 1;
      continue;
    }
    matches.push({ start: index, end: close + 1, text: paragraph.slice(index + 1, close) });
    index = close + 1;
  }
  return matches;
}

// Opening and closing positions of single quotes, curly (‘’) and straight
// ('), in order.
function singleQuoteMarks(paragraph) {
  const marks = { "‘": { open: [], close: [] }, "'": { open: [], close: [] } };
  for (let index = 0; index < paragraph.length; index += 1) {
    const char = paragraph[index];
    const before = paragraph[index - 1] ?? "";
    const after = paragraph[index + 1] ?? "";
    if (char === "‘" && !LETTER.test(before)) {
      marks["‘"].open.push(index);
    } else if (char === "’" && !LETTER.test(after)) {
      marks["‘"].close.push(index);
    } else if (char === "'") {
      if (!LETTER.test(before) && LETTER.test(after) && !ELISION.test(paragraph.slice(index + 1))) {
        marks["'"].open.push(index);
      } else if (!LETTER.test(after) && before !== "" && !/\s/.test(before)) {
        marks["'"].close.push(index);
      }
    }
  }
  for (const key of Object.keys(marks)) {
    marks[key].opens = new Set(marks[key].open);
    marks[key].paragraph = paragraph;
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
export function replaceQuotes(paragraph) {
  let result = "";
  let position = 0;
  for (const match of quoteMatches(paragraph)) {
    result += `${paragraph.slice(position, match.start)} `;
    position = match.end;
  }
  return result + paragraph.slice(position);
}

export function quotedSpans(paragraph) {
  return quoteMatches(paragraph).map((match) => match.text.trim()).filter((text) => text !== "");
}

// The paragraph's narration, and the text of speech still open at its end
// (or null). Open speech starts at the first opener with no closer after it,
// found with index searches so a run of unclosed quotes stays linear; a
// straight single quote counts only when it opens the paragraph.
export function splitOpenSpeech(paragraph) {
  const text = replaceQuotes(paragraph);
  const cuts = [];
  const curly = text.indexOf("“", text.lastIndexOf("”") + 1);
  if (curly !== -1) {
    cuts.push(curly);
  }
  const straight = text.indexOf("\"");
  if (straight !== -1) {
    cuts.push(straight);
  }
  const lastSingleClose = text.lastIndexOf("’");
  const single = /(?<![\p{L}\p{N}])‘/u.exec(text.slice(lastSingleClose + 1));
  if (single) {
    cuts.push(lastSingleClose + 1 + single.index);
  }
  if (/^'[\p{L}\p{N}]/u.test(text) && !ELISION.test(text.slice(1))) {
    cuts.push(0);
  }
  if (cuts.length === 0) {
    return { narration: text, open: null };
  }
  const cut = Math.min(...cuts);
  const open = text.slice(cut + 1).trim();
  return { narration: text.slice(0, cut), open: open === "" ? null : open };
}

// The paragraph without its quoted speech, for narration-only checks.
export function narrationOnly(paragraph) {
  return splitOpenSpeech(paragraph).narration;
}

function profile(character, said) {
  const text = said.map((line) => line.text).join(" ");
  const words = splitWords(text);
  const sentences = said.flatMap((line) => splitSentences(line.text).filter((sentence) => splitWords(sentence).length > 0));
  const questions = sentences.filter((sentence) => /\?["'”’)]*$/.test(sentence.trim())).length;
  const exclamations = sentences.filter((sentence) => /!["'”’)]*$/.test(sentence.trim())).length;
  return {
    id: character.id,
    lines: said.length,
    words: words.length,
    sentenceLength: sentences.length === 0 ? 0 : words.length / sentences.length,
    contractions: words.length === 0 ? 0 : ((text.match(CONTRACTION_PATTERN) ?? []).length * 100) / words.length,
    questions: sentences.length === 0 ? 0 : questions / sentences.length,
    exclamations: sentences.length === 0 ? 0 : exclamations / sentences.length,
    counts: wordCounts(words),
    signature: []
  };
}

function wordCounts(words) {
  const counts = new Map();
  for (const raw of words) {
    const word = raw.toLowerCase().replace(/’/g, "'");
    if (word.length >= 4 && !STOPWORDS.has(word) && !/^\d+$/.test(word)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return counts;
}

// A signature word is one a character uses at least twice and more often,
// per word spoken, than everyone else's dialogue combined.
function signatureWords(profiles) {
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
      .sort((left, right) => right.score - left.score || right.count - left.count || left.word.localeCompare(right.word, "en"))
      .slice(0, 5)
      .map((item) => item.word);
    delete entry.counts;
  }
}

// Each measure must differ by less than its limit. The small allowance
// keeps floating-point error from deciding the boundary, so shares exactly
// 10 points apart are never "close" (0.3 - 0.2 is 0.0999...).
function similarVoices(left, right) {
  const limits = VOICE_THRESHOLDS;
  const close = (a, b, limit) => Math.abs(a - b) < limit - 1e-9;
  return close(left.sentenceLength, right.sentenceLength, limits.sentenceLength)
    && close(left.contractions, right.contractions, limits.contractions)
    && close(left.questions, right.questions, limits.questions)
    && close(left.exclamations, right.exclamations, limits.exclamations);
}

function phrasePattern(phrase) {
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escape(String(phrase).trim()).replace(/['’]/g, "['’]")}(?![\\p{L}\\p{M}\\p{N}])`, "iu");
}

function escape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringList(value) {
  return (Array.isArray(value) ? value : []).filter((item) => typeof item === "string" && item.trim() !== "");
}

export function formatVoices(report) {
  const lines = [`Voices: ${plural(report.profiles.length, "speaking character")}, ${plural(report.unattributed, "unattributed line")}`];
  if (report.profiles.length === 0) {
    lines.push("", "- None: tag dialogue with a character's name and a speech verb (\"...,\" Mara said)");
    return `${lines.join("\n")}\n`;
  }
  for (const entry of report.profiles) {
    lines.push(
      "",
      `${entry.id}: ${plural(entry.lines, "line")}, ${plural(entry.words, "word")}`,
      `  Sentence length ${entry.sentenceLength.toFixed(1)}, contractions ${entry.contractions.toFixed(1)} per 100 words, questions ${Math.round(entry.questions * 100)}%, exclamations ${Math.round(entry.exclamations * 100)}%`,
      `  Signature words: ${entry.signature.join(", ") || "none yet"}`
    );
  }
  return `${lines.join("\n")}\n`;
}

import { splitWords } from "./markdown.js";
import { givenName } from "./names.js";

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

const CONTRACTION_PATTERN = /[\p{L}](?:n['’]t|['’](?:re|ll|ve|m|d))\b/giu;

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
    for (const paragraph of chapter.paragraphs) {
      const quotes = quotedSpans(paragraph);
      if (quotes.length === 0) {
        continue;
      }
      const speaker = attribute(paragraph, speakers);
      if (speaker === null) {
        unattributed += quotes.length;
        continue;
      }
      for (const text of quotes) {
        lines.get(speaker).push({ chapter: chapter.id, text });
      }
    }
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
        warnings.push(`${character.id} says "${phrase}", which is in their voice-avoid list (${chaptersUsing.join(", ")})`);
      }
    }
    if (said.length >= VOICE_THRESHOLDS.minLines) {
      for (const phrase of stringList(character.voiceWords)) {
        const pattern = phrasePattern(phrase);
        if (!said.some((line) => pattern.test(line.text))) {
          warnings.push(`${character.id} never says "${phrase}" from their voice-words list in ${said.length} lines of dialogue`);
        }
      }
    }
  }

  const eligible = profiles.filter((entry) => entry.lines >= VOICE_THRESHOLDS.minLines);
  for (let left = 0; left < eligible.length; left += 1) {
    for (let right = left + 1; right < eligible.length; right += 1) {
      if (similarVoices(eligible[left], eligible[right])) {
        warnings.push(`${eligible[left].id} and ${eligible[right].id} may sound alike: similar sentence length, contractions, questions, and exclamations`);
      }
    }
  }

  return {
    profiles: profiles.sort((left, right) => right.words - left.words || left.id.localeCompare(right.id, "en")),
    unattributed,
    warnings
  };
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
      return {
        id: character.id,
        name: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "u"),
        subject: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})\\s+(?:${verbs})(?![\\p{L}\\p{N}])`, "u"),
        inverted: new RegExp(`(?<![\\p{L}\\p{N}])(?:${verbs})\\s+(?:${alternatives})(?![\\p{L}\\p{N}])`, "u")
      };
    })
    .filter(Boolean);
}

function attribute(paragraph, speakers) {
  const narration = stripQuotes(paragraph);
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
  const named = speakers.filter((speaker) => speaker.name.test(narration));
  return named.length === 1 ? named[0].id : null;
}

// Curly double quotes pair explicitly and straight quotes pair in order.
// British single quotes open after a non-letter and close before one, so an
// apostrophe inside a word (don’t) never ends the quote.
const SINGLE_QUOTE = "(?<![\\p{L}\\p{N}])‘((?:[^‘’]|’(?=[\\p{L}\\p{N}]))*)’(?![\\p{L}\\p{N}])";
const QUOTE_PATTERN = new RegExp(`“([^”]*)”|"([^"]*)"|${SINGLE_QUOTE}`, "gu");

export function quotedSpans(paragraph) {
  const spans = [];
  for (const match of paragraph.matchAll(QUOTE_PATTERN)) {
    const text = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (text !== "") {
      spans.push(text);
    }
  }
  return spans;
}

function stripQuotes(paragraph) {
  return paragraph.replace(QUOTE_PATTERN, " ").replace(/“[^”]*$/g, " ").replace(/"[^"]*$/g, " ");
}

function profile(character, said) {
  const text = said.map((line) => line.text).join(" ");
  const words = splitWords(text);
  const sentences = said.flatMap((line) => line.text.split(/(?<=[.!?…])\s+/).filter((sentence) => splitWords(sentence).length > 0));
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

function similarVoices(left, right) {
  const limits = VOICE_THRESHOLDS;
  return Math.abs(left.sentenceLength - right.sentenceLength) < limits.sentenceLength
    && Math.abs(left.contractions - right.contractions) < limits.contractions
    && Math.abs(left.questions - right.questions) < limits.questions
    && Math.abs(left.exclamations - right.exclamations) < limits.exclamations;
}

function phrasePattern(phrase) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(String(phrase).trim()).replace(/['’]/g, "['’]")}(?![\\p{L}\\p{N}])`, "iu");
}

function escape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringList(value) {
  return (Array.isArray(value) ? value : []).filter((item) => typeof item === "string" && item.trim() !== "");
}

export function formatVoices(report) {
  const lines = [`Voices: ${report.profiles.length} speaking characters, ${report.unattributed} unattributed lines`];
  if (report.profiles.length === 0) {
    lines.push("", "- None: tag dialogue with a character's name and a speech verb (\"...,\" Mara said)");
    return `${lines.join("\n")}\n`;
  }
  for (const entry of report.profiles) {
    lines.push(
      "",
      `${entry.id}: ${entry.lines} lines, ${entry.words} words`,
      `  Sentence length ${entry.sentenceLength.toFixed(1)}, contractions ${entry.contractions.toFixed(1)} per 100 words, questions ${Math.round(entry.questions * 100)}%, exclamations ${Math.round(entry.exclamations * 100)}%`,
      `  Signature words: ${entry.signature.join(", ") || "none yet"}`
    );
  }
  return `${lines.join("\n")}\n`;
}

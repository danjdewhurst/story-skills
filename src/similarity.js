import { formatNumber } from "./compare.js";
import { usageError } from "./exit-codes.js";
import { warn } from "./findings.js";

// story similarity: passages of chapter prose that share a run of words with
// reference text (the author's earlier books, a previous draft, a source).
// Both sides are split into words, lowercased, with punctuation dropped, so
// "The tide, turning," and "the tide turning" match. Every run of
// `minWords` words (a shingle) in the reference is indexed; each chapter is
// then scanned for shingles in the index, and each hit is extended word by
// word to the longest shared run, which is reported once. The result is
// advisory: a shared run is a place to look, not a finding of copying.

export const SIMILARITY_DEFAULTS = { minWords: 8 };

// Below this a shared run is ordinary phrasing ("at the end of the"), so
// --min-words refuses it.
const MIN_SHINGLE = 5;

// A common shingle can occur hundreds of times in a long reference; trying
// more than this many places for each hit only finds the same run again.
const MAX_CANDIDATES = 32;

// The words of a passage the text output quotes; --json keeps them all.
const QUOTE_WORDS = 24;

// Chinese and Japanese are written without spaces, so each character is a
// word, as story wordcount counts them. Other letters, digits, and combining
// marks make words, joined by an inner apostrophe (don't, O'Brien).
const CJK = "\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}";
const WORD_CHAR = `(?:(?![${CJK}])[\\p{L}\\p{N}\\p{M}])`;
const WORD_PATTERN = new RegExp(`[${CJK}]|${WORD_CHAR}+(?:['’ʼ]${WORD_CHAR}+)*`, "gu");

export function similarityOptions(options = {}) {
  const settings = { ...SIMILARITY_DEFAULTS };
  const raw = options["min-words"];
  if (raw !== undefined) {
    const text = String(raw).trim();
    if (!/^\d+$/.test(text) || Number(text) < MIN_SHINGLE || !Number.isSafeInteger(Number(text))) {
      throw usageError(`--min-words must be a whole number ${MIN_SHINGLE} or more, such as ${SIMILARITY_DEFAULTS.minWords}`);
    }
    settings.minWords = Number(text);
  }
  return settings;
}

// The words of one document, each with the paragraph it is in and its place
// in that paragraph's text, so a shared run can be quoted as written.
// `paragraphs` is a list of { label, text }.
export function tokenizeDocument(paragraphs) {
  const words = [];
  paragraphs.forEach((paragraph, index) => {
    for (const match of paragraph.text.normalize("NFC").matchAll(WORD_PATTERN)) {
      words.push({
        word: match[0].toLowerCase().replace(/[’ʼ]/g, "'"),
        paragraph: index,
        start: match.index,
        end: match.index + match[0].length
      });
    }
  });
  return words;
}

function shingleKey(words, at, size) {
  let key = words[at].word;
  for (let offset = 1; offset < size; offset += 1) {
    key += ` ${words[at + offset].word}`;
  }
  return key;
}

// Where every shingle of the reference starts, as "document:word" pairs.
function indexReference(references, size) {
  const index = new Map();
  references.forEach((reference, doc) => {
    const words = reference.words;
    for (let at = 0; at + size <= words.length; at += 1) {
      const key = shingleKey(words, at, size);
      const places = index.get(key);
      if (places === undefined) {
        index.set(key, [[doc, at]]);
      } else if (places.length < MAX_CANDIDATES) {
        places.push([doc, at]);
      }
    }
  });
  return index;
}

function runLength(source, from, target, at) {
  let length = 0;
  while (from + length < source.length && at + length < target.length && source[from + length].word === target[at + length].word) {
    length += 1;
  }
  return length;
}

// The longest shared runs between each source document and the references:
// each source word is reported in at most one run.
export function sharedRuns(sources, references, minWords) {
  const index = indexReference(references, minWords);
  const runs = [];
  sources.forEach((source, doc) => {
    const words = source.words;
    let at = 0;
    while (at + minWords <= words.length) {
      const places = index.get(shingleKey(words, at, minWords));
      if (places === undefined) {
        at += 1;
        continue;
      }
      let best = null;
      for (const [refDoc, refAt] of places) {
        const length = runLength(words, at, references[refDoc].words, refAt);
        if (best === null || length > best.length) {
          best = { refDoc, refAt, length };
        }
      }
      runs.push({ doc, at, ...best });
      at += best.length;
    }
  });
  return runs;
}

// A run's paragraphs as labels ("ch03-p12", or "ch03-p12 to ch03-p13") and
// its words as written, paragraph by paragraph.
function describe(document, from, length) {
  const words = document.words.slice(from, from + length);
  const first = words[0];
  const last = words[words.length - 1];
  const labels = document.paragraphs.slice(first.paragraph, last.paragraph + 1).map((paragraph) => paragraph.label);
  const pieces = [];
  for (let paragraph = first.paragraph; paragraph <= last.paragraph; paragraph += 1) {
    const text = document.paragraphs[paragraph].text.normalize("NFC");
    const start = paragraph === first.paragraph ? first.start : 0;
    const end = paragraph === last.paragraph ? last.end : text.length;
    pieces.push(text.slice(start, end).replace(/\s+/g, " ").trim());
  }
  return {
    from: labels[0],
    to: labels[labels.length - 1],
    text: pieces.join(" / ")
  };
}

// "1 word", "1,492 words".
function count(value, noun) {
  return `${formatNumber(value)} ${value === 1 ? noun : `${noun}s`}`;
}

function place(location) {
  return location.from === location.to ? location.from : `${location.from} to ${location.to}`;
}

function quote(text) {
  const words = text.split(" ");
  return words.length > QUOTE_WORDS ? `${words.slice(0, QUOTE_WORDS).join(" ")}…` : text;
}

// Compares chapter documents with reference documents. Each document is
// { file, title?, paragraphs: [{ label, text }] }; `label` names the
// reference as a whole (a folder, a file, or a git ref).
export function compareSimilarity(chapters, references, { minWords, label }) {
  const sources = chapters.map((chapter) => ({ ...chapter, words: tokenizeDocument(chapter.paragraphs) }));
  const targets = references.map((reference) => ({ ...reference, words: tokenizeDocument(reference.paragraphs) }));
  const runs = sharedRuns(sources, targets, minWords);
  const passages = runs.map((run) => {
    const source = sources[run.doc];
    const target = targets[run.refDoc];
    const here = describe(source, run.at, run.length);
    const there = describe(target, run.refAt, run.length);
    return {
      file: source.file,
      from: here.from,
      to: here.to,
      words: run.length,
      text: here.text,
      reference: { file: target.file, from: there.from, to: there.to, text: there.text }
    };
  });
  const warnings = passages.map((passage) => warn(
    "similarity-shared-passage",
    `${passage.file} (${place(passage)}) shares ${count(passage.words, "word")} with ${passage.reference.file} (${place(passage.reference)}): "${quote(passage.text)}"`,
    passage.file
  ));
  const summary = sources.map((source) => {
    const own = passages.filter((passage) => passage.file === source.file);
    return {
      file: source.file,
      title: source.title ?? "",
      words: source.words.length,
      sharedWords: own.reduce((sum, passage) => sum + passage.words, 0),
      passages: own.length
    };
  });
  return {
    ok: true,
    errors: [],
    warnings,
    label,
    minWords,
    reference: {
      files: targets.length,
      words: targets.reduce((sum, target) => sum + target.words.length, 0)
    },
    words: summary.reduce((sum, chapter) => sum + chapter.words, 0),
    sharedWords: summary.reduce((sum, chapter) => sum + chapter.sharedWords, 0),
    chapters: summary,
    passages
  };
}

// Tenths of a percent, so a single shared run in a long book shows as 0.1%
// rather than 0%, and never rounds up to 100% while a word differs.
function percent(part, whole) {
  if (whole === 0 || part === 0) {
    return "0%";
  }
  const tenths = Math.max(1, Math.floor((part / whole) * 1000));
  return `${(tenths / 10).toFixed(tenths % 10 === 0 ? 0 : 1)}%`;
}

export function formatSimilarity(report) {
  const lines = [
    `Similarity against ${report.label}: ${count(report.reference.words, "word")} in ${count(report.reference.files, "file")}, runs of ${report.minWords} or more shared words`,
    ""
  ];
  for (const chapter of report.chapters) {
    const passages = chapter.passages === 0 ? "no shared passages" : `${count(chapter.passages, "shared passage")}, ${count(chapter.sharedWords, "word")} (${percent(chapter.sharedWords, chapter.words)})`;
    lines.push(`- ${chapter.file}: ${passages}`);
  }
  lines.push("", `Total: ${formatNumber(report.sharedWords)} of ${count(report.words, "word")} shared (${percent(report.sharedWords, report.words)})`);
  lines.push("Shared text is a place to look, not proof of copying: check each passage in context.");
  return `${lines.join("\n")}\n`;
}

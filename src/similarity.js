import { formatNumber } from "./compare.js";
import { usageError } from "./exit-codes.js";
import { warn } from "./findings.js";
import { wordSpans } from "./words.js";

// story similarity: passages of chapter prose that share a run of words with
// reference text (the author's earlier books, a previous draft, a source).
// Both sides are split into words, lowercased, with punctuation dropped, so
// "The tide, turning," and "the tide turning" match. Every run of
// `minWords` words (a shingle) in the reference is indexed. Each chapter
// shingle found there starts an alignment wherever the two texts do not
// already agree on the word before, and the alignment runs as far as they
// agree. The longest alignments are reported first; a shorter one keeps
// only the words no longer one has, if at least `minWords` of them are
// left. The result is advisory: a shared run is a place to look, not a
// finding of copying.

export const SIMILARITY_DEFAULTS = { minWords: 8 };

// Below this a shared run is ordinary phrasing ("at the end of the"), so
// --min-words refuses it.
const MIN_SHINGLE = 5;

// A shingle can occur thousands of times in a reference built from
// repeated text. Past this many places a hit is not tried further, so a
// pathological reference cannot make the scan quadratic.
const MAX_PLACES = 1000;

// The words of a passage the text output quotes; --json keeps them all.
const QUOTE_WORDS = 24;

// Letters, digits, and combining marks make words, joined by an inner
// apostrophe (don't, O'Brien). Chinese and Japanese are a word per
// character, and Thai, Lao, Khmer, and Burmese are split by dictionary, as
// story wordcount counts them (see wordSpans).
const WORD_PATTERN = /[\p{L}\p{N}\p{M}]+(?:['’ʼ][\p{L}\p{N}\p{M}]+)*/gu;

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
    for (const { word, start, end } of wordSpans(paragraph.text.normalize("NFC"), WORD_PATTERN)) {
      words.push({ word: word.toLowerCase().replace(/[’ʼ]/g, "'"), paragraph: index, start, end });
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
      } else {
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

// Every alignment of a chapter with the references that no earlier word
// extends, as { doc, at, refDoc, refAt, length }.
function alignments(source, doc, index, references, minWords) {
  const words = source.words;
  const found = [];
  // The furthest word any alignment found so far reaches. They all start at
  // or before `at`, so one that cannot reach past it lies inside one of them
  // and could never be reported: skipping it keeps repetitive text linear.
  let reach = 0;
  for (let at = 0; at + minWords <= words.length; at += 1) {
    const places = index.get(shingleKey(words, at, minWords));
    if (places === undefined) {
      continue;
    }
    for (const [refDoc, refAt] of places.length > MAX_PLACES ? places.slice(0, MAX_PLACES) : places) {
      const target = references[refDoc].words;
      // Already part of the alignment that starts a word earlier.
      if (at > 0 && refAt > 0 && words[at - 1].word === target[refAt - 1].word) {
        continue;
      }
      if (at + Math.min(words.length - at, target.length - refAt) <= reach) {
        continue;
      }
      const length = runLength(words, at, target, refAt);
      found.push({ doc, at, refDoc, refAt, length });
      reach = Math.max(reach, at + length);
    }
  }
  return found;
}

// The shared runs between each source document and the references, longest
// first: a run is cut to the words no longer run has reported, and dropped
// when fewer than `minWords` are left, so each word is reported once.
export function sharedRuns(sources, references, minWords) {
  const index = indexReference(references, minWords);
  const runs = [];
  sources.forEach((source, doc) => {
    const found = alignments(source, doc, index, references, minWords)
      .sort((a, b) => b.length - a.length || a.at - b.at || a.refDoc - b.refDoc || a.refAt - b.refAt);
    const taken = new Uint8Array(source.words.length);
    for (const alignment of found) {
      let from = alignment.at;
      const end = alignment.at + alignment.length;
      while (from < end) {
        while (from < end && taken[from] === 1) {
          from += 1;
        }
        let to = from;
        while (to < end && taken[to] === 0) {
          to += 1;
        }
        if (to - from >= minWords) {
          taken.fill(1, from, to);
          runs.push({ doc, at: from, refDoc: alignment.refDoc, refAt: alignment.refAt + (from - alignment.at), length: to - from });
        }
        from = to;
      }
    }
  });
  return runs.sort((a, b) => a.doc - b.doc || a.at - b.at);
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

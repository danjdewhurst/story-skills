// One Unicode form for every comparison of names and author-supplied
// phrases with prose. A letter with an accent or a voiced kana can be
// written as one code point (é, が: NFC) or as a base letter and a combining
// mark (e + U+0301, か + U+3099: NFD); macOS file names, some input methods,
// and pasted text give the second. Both sides are composed to NFC before
// they are compared, so either spelling finds the other.

// `value` as a string in NFC.
export function nfc(value) {
  return String(value).normalize("NFC");
}

const SAME = (start, end) => [start, end];

// A letter with the combining marks after it, or a Hangul syllable with the
// conjoining vowels and finals after it: the runs NFC may compose. Every
// other code point is composed on its own.
const CLUSTER = /\P{M}?[\p{M}\u1160-\u11FF\uD7B0-\uD7FF]+/gu;

// `text` in NFC, with `original(start, end)` mapping a span of it back to
// the text as written, so offsets, line and column numbers, and excerpts
// refer to the text as written. Text already in NFC is returned as it is.
export function composedText(text) {
  const source = String(text);
  if (nfc(source) === source) {
    return { text: source, original: SAME };
  }
  let composed = "";
  const starts = [];
  const sources = [];
  const add = (from, value) => {
    starts.push(composed.length);
    sources.push(from);
    composed += value;
  };
  // A run between clusters with a code point that changes length (a CJK
  // compatibility ideograph outside the Basic Multilingual Plane composes
  // to one inside it, and one inside may compose to one outside) is split
  // into code points, even when the run as a whole keeps its length. A run
  // NFC leaves as it is, as most are, is one piece without that check.
  const addRun = (from, run) => {
    const value = nfc(run);
    if (value === run || (value.length === run.length && Array.from(run).every((character) => nfc(character).length === character.length))) {
      add(from, value);
      return;
    }
    let offset = from;
    for (const character of run) {
      add(offset, nfc(character));
      offset += character.length;
    }
  };
  let last = 0;
  for (const match of source.matchAll(CLUSTER)) {
    if (match.index > last) {
      addRun(last, source.slice(last, match.index));
    }
    add(match.index, nfc(match[0]));
    last = match.index + match[0].length;
  }
  if (last < source.length) {
    addRun(last, source.slice(last));
  }
  starts.push(composed.length);
  sources.push(source.length);
  // The last piece starting at or before `offset`, by binary search.
  const piece = (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  };
  // An offset inside a piece that kept its length maps across exactly;
  // inside one that changed, it moves to the piece's start, or its end for
  // the end of a span, so the span takes in the whole piece as written.
  const at = (offset, end) => {
    const index = piece(offset);
    const inside = offset - starts[index];
    if (inside === 0) {
      return sources[index];
    }
    if (starts[index + 1] - starts[index] === sources[index + 1] - sources[index]) {
      return sources[index] + inside;
    }
    return sources[end ? index + 1 : index];
  };
  return { text: composed, original: (start, end) => [at(start, false), at(end, true)] };
}

// The characters that end a line. A run of whitespace holding one is folded
// to a space by oneLine.
const LINE_BREAK = /[\n\v\f\r\u0085\u2028\u2029]/;

// `text` on one line, trimmed: each run of whitespace that holds a line
// break becomes one space, and other runs are kept as written. Each run is
// matched once, so a long run of spaces costs no more than its length.
export function oneLine(text) {
  return String(text).replace(/[\s\u0085]+/g, (space) => (LINE_BREAK.test(space) ? " " : space)).trim();
}

let graphemes;

function graphemeSegments(text) {
  graphemes ??= new Intl.Segmenter("en", { granularity: "grapheme" });
  return graphemes.segment(text);
}

// The characters a reader sees in `text`: grapheme clusters after NFC, so a
// letter and its accent, a Devanagari or Thai consonant and its vowel sign,
// and an emoji with its modifiers each count once.
export function graphemeCount(text) {
  let count = 0;
  for (const _ of graphemeSegments(nfc(text))) {
    count += 1;
  }
  return count;
}

// A grapheme cluster a terminal draws two columns wide: one that starts with
// an East Asian wide or fullwidth character (Hangul, CJK punctuation and
// ideographs, kana, Yi, fullwidth forms, Tangut) or an emoji, or that asks
// for emoji presentation (U+FE0F). One that starts with a combining mark, a
// control or format character, or a Hangul vowel or final takes none.
const WIDE = /^(?:[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{16fe0}-\u{16fe4}\u{17000}-\u{18cff}\u{1b000}-\u{1b2ff}\u{20000}-\u{2fffd}\u{30000}-\u{3fffd}]|\p{Emoji_Presentation})|\ufe0f/u;
const ZERO_WIDTH = /^[\p{M}\p{Cc}\p{Cf}\u1160-\u11ff\ud7b0-\ud7ff]/u;

// The columns `text` takes in a monospaced terminal, for padding a table.
export function displayWidth(text) {
  let width = 0;
  for (const { segment } of graphemeSegments(String(text))) {
    width += WIDE.test(segment) ? 2 : ZERO_WIDTH.test(segment) ? 0 : 1;
  }
  return width;
}

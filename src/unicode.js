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
  // into code points, even when the run as a whole keeps its length.
  const addRun = (from, run) => {
    const characters = Array.from(run);
    if (characters.every((character) => nfc(character).length === character.length)) {
      add(from, nfc(run));
      return;
    }
    let offset = from;
    for (const character of characters) {
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

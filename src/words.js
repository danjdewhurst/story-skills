// Words in scripts written without spaces between them. Every word count and
// word comparison goes through wordSpans, so `story wordcount`, `compare`,
// `similarity`, and the prose checks split these scripts the same way.

// One Han, Hiragana, or Katakana character, or the Katakana long-vowel mark,
// which Unicode files under no single script. Chinese and Japanese count a
// word per character, as Word and Scrivener count them.
const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30FC";
// A run of Thai, Lao, Khmer, or Myanmar (Burmese) script. These also put no
// spaces between words, but a word is several characters, so the run is
// split by Intl.Segmenter's dictionary. That dictionary is the runtime's ICU
// data, so a count can shift slightly between Node and Bun versions.
const SOUTHEAST_ASIAN = "\\p{Script=Thai}\\p{Script=Lao}\\p{Script=Khmer}\\p{Script=Myanmar}";
const UNSPACED = new RegExp(`[${CJK}]|[${SOUTHEAST_ASIAN}]+`, "gu");
const CJK_CHARACTER = new RegExp(`^[${CJK}]$`, "u");

// Node 18+ and Bun ship Intl.Segmenter with full ICU data.
const SEGMENTER = new Intl.Segmenter("en", { granularity: "word" });

// The words of one run of Southeast Asian script, as [word, offset] pairs.
function segmentRun(run) {
  const words = [];
  for (const { segment, index, isWordLike } of SEGMENTER.segment(run)) {
    if (isWordLike) {
      words.push([segment, index]);
    }
  }
  return words;
}

// The words of `text` in order, as { word, start, end } with offsets into
// `text`. Each Chinese or Japanese character is a word, each run of Thai,
// Lao, Khmer, or Burmese is split by the segmenter, and the text between
// them is matched with `pattern` (a global regex), the caller's rule for
// words in spaced scripts. Those scripts are cut out first, so a word in
// `pattern` never runs on into them.
export function wordSpans(text, pattern) {
  const source = String(text);
  const spans = [];
  let last = 0;
  const between = (end) => {
    if (end > last) {
      for (const match of source.slice(last, end).matchAll(pattern)) {
        spans.push({ word: match[0], start: last + match.index, end: last + match.index + match[0].length });
      }
    }
  };
  for (const match of source.matchAll(UNSPACED)) {
    between(match.index);
    if (CJK_CHARACTER.test(match[0])) {
      spans.push({ word: match[0], start: match.index, end: match.index + match[0].length });
    } else {
      for (const [word, offset] of segmentRun(match[0])) {
        spans.push({ word, start: match.index + offset, end: match.index + offset + word.length });
      }
    }
    last = match.index + match[0].length;
  }
  between(source.length);
  return spans;
}

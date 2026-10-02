// The base language pack: the conventions every language starts from, and
// all a language without its own pack gets. It holds no word lists, so a
// check that needs one is skipped for such a language rather than run with
// another language's words; see ./index.js.

export default {
  code: "und",
  name: "Generic",
  // The script has upper and lower case, so a capital can start a sentence
  // or mark a name.
  cased: true,
  // How words are found: "space" (between spaces and punctuation),
  // "character" (each character is a word), or "dictionary" (a word
  // segmenter is needed).
  segmentation: "space",
  // Marks that can end a sentence.
  sentenceEnd: [".", "!", "?", "…", "。", "！", "？"],
  // Quotation marks for speech, as [open, close] pairs.
  quotes: [["“", "”"], ["‘", "’"], ["\"", "\""], ["'", "'"]],
  // The dash that opens a line of dialogue (— Line, said Cy.), or null.
  dialogueDash: "—",
  // Generated text in builds, by key.
  labels: {},
  // Word lists for the analysis checks, by name; see ./en.js.
  checks: {}
};

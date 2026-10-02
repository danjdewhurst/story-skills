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
  // The ISO 15924 script the language is usually written in (Latn, Jpan,
  // Arab), which picks fonts and layout for builds, or null for a language
  // without a pack: builds then take it from the tag's script subtag or a
  // table of common languages; see ../typesetting.js.
  script: null,
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

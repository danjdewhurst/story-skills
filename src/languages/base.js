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
  // The unit a manuscript's length is counted in, unless story.md sets
  // `count-unit`: "words" or "characters".
  countUnit: "words",
  // Marks that can end a sentence: the full stop, question and exclamation
  // marks, and ellipsis; the full-width CJK stops (。！？), which need no
  // space after them; the Arabic question mark (؟), the Urdu full stop (۔),
  // the Devanagari danda (। ॥), and the Ethiopic full stop (።). Spanish ¿
  // and ¡ open a sentence in every language; see ../punctuation.js.
  sentenceEnd: [".", "!", "?", "…", "。", "！", "？", "؟", "۔", "।", "॥", "።"],
  // Quotation marks for speech, as [open, close] pairs: curly and straight
  // quotes, guillemets pointing out (« », as in French, Spanish, Italian, and
  // Russian), low-high quotes („ “ as in German and Czech, „ ” as in
  // Polish), and corner brackets (「 」 『 』). A mark that opens in one
  // language and closes in another (» in German and Danish, ” in Swedish)
  // is left to that language's pack. A closing mark that can be an
  // apostrophe (’ or ') closes only before a non-letter.
  quotes: [
    ["“", "”"], ["‘", "’"], ["\"", "\""], ["'", "'"],
    ["«", "»"], ["‹", "›"], ["„", "“"], ["„", "”"], ["‚", "‘"],
    ["「", "」"], ["『", "』"]
  ],
  // The dash that opens a line of dialogue (— Line, said Cy.), a list of
  // them, or null.
  // Speech runs to a closing dash or a tag after a comma, and resumes after
  // the dash that closes the tag (—Ya voy —dijo ella—. Espera.).
  dialogueDash: "—",
  // Whether a dash after a finished sentence and before a capital starts a
  // new line of speech (– Hej, sa Anna. – Kom hit.) rather than narration
  // (—Vete. —Ella se giró.).
  dashStartsLine: false,
  // Whether a full stop after a number marks an ordinal (am 3. Mai, as in
  // German), so it ends a sentence only before a capital that is not a
  // calendar word.
  ordinalStop: false,
  // Generated text in builds, by key; a key a pack leaves out is English
  // (see ./en.js).
  labels: {},
  // Narration pace for the audiobook script's runtime estimate, in words
  // per minute as story wordcount counts them, so a character for a
  // language segmented by character. English's rate stands in for a
  // language with no figure of its own. The European, Turkish, Arabic, and
  // Hebrew packs scale 155 by the language's reading speed against
  // English's in the IReST study (Trauzettel-Klosinski and Dietz, 2012);
  // all are starting points that the script tells the narrator to retime.
  // A rate is per counted unit: if counts gain another unit (characters for
  // a spaced language), this field and narrationRate in ../narration.js are
  // the two places to change.
  narrationRate: 155,
  // Word lists for the analysis checks, by name; see ./en.js.
  checks: {}
};

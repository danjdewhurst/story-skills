// Japanese: no letter case, and no spaces between words, so each character
// counts as a word, as Word and Scrivener count it. Speech is set in corner
// brackets (「…」, 『…』 inside), sometimes in “…”, 〝…〟, or "…"; a leading dash
// (――) is a pause, not dialogue. Lengths are counted in characters
// (原稿用紙 sheets of 400字). No word lists yet.

export default {
  code: "ja",
  name: "Japanese",
  cased: false,
  script: "Jpan",
  segmentation: "character",
  quotes: [["「", "」"], ["『", "』"], ["“", "”"], ["〝", "〟"], ["\"", "\""]],
  dialogueDash: null,
  countUnit: "characters",
  // Usual lengths by form, in characters. Japanese draws no fixed lines:
  // 中編 is about 100 to 300 sheets of 400字 (40,000-120,000), 短編 up to
  // 100 sheets, 長編 300 and up with no upper limit, and ショートショート
  // about 10 sheets; the cap of 10,000 for flash is the Hoshi Shinichi
  // Award's entry rule. Sheets times 400 runs above a count of characters,
  // since line ends and dialogue leave cells blank. No source sets the
  // other forms, so they have no range; see docs/project-format.md.
  characterForms: {
    flash: { min: 1, max: 10000, target: 4000 },
    "short-story": { min: 4000, max: 40000, target: 20000 },
    novella: { min: 40000, max: 120000, target: 80000 },
    novel: { min: 120000, max: null, target: 150000 }
  }
};

// Chinese: no letter case, and no spaces between words, so each character
// counts as a word, as Word and Scrivener count it. Speech is set in “…”
// or corner brackets (the base pack's quotes); a leading dash (——) is not
// dialogue. Lengths are counted in characters (字数).
// No word lists yet.

export default {
  code: "zh",
  name: "Chinese",
  cased: false,
  script: "Hans",
  segmentation: "character",
  dialogueDash: null,
  countUnit: "characters",
  // Usual lengths by form, in characters, from the China Writers
  // Association's prize rules: 小小说 under 2,000, 短篇 under 25,000, and
  // 中篇 25,000-130,000 (Lu Xun Literary Prize, 2022), 长篇 130,000 and up
  // with no upper limit (Mao Dun Literature Prize, 2023). Those count
  // 版面字数, a page-layout count that runs above a count of characters.
  // No source sets the other forms, so they have no range; see
  // docs/project-format.md.
  characterForms: {
    flash: { min: 1, max: 2000, target: 1500 },
    "short-story": { min: 2000, max: 25000, target: 10000 },
    novella: { min: 25000, max: 130000, target: 60000 },
    novel: { min: 130000, max: null, target: 200000 }
  }
};

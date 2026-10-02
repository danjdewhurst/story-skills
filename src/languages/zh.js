// Chinese: no letter case, and no spaces between words, so each character
// counts as a word, as Word and Scrivener count it. Speech is set in “…”
// or corner brackets (the base pack's quotes); a leading dash (——) is not
// dialogue. No word lists yet.

export default {
  code: "zh",
  name: "Chinese",
  cased: false,
  script: "Hans",
  segmentation: "character",
  dialogueDash: null
};

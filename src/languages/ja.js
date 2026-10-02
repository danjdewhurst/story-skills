// Japanese: no letter case, and no spaces between words, so each character
// counts as a word, as Word and Scrivener count it. Speech is set in corner
// brackets (「…」, 『…』 inside), sometimes in “…”, 〝…〟, or "…"; a leading dash
// (――) is a pause, not dialogue. No word lists yet.

export default {
  code: "ja",
  name: "Japanese",
  cased: false,
  script: "Jpan",
  segmentation: "character",
  quotes: [["「", "」"], ["『", "』"], ["“", "”"], ["〝", "〟"], ["\"", "\""]],
  dialogueDash: null
};

// Swedish: ”…” and ’…’, both marks the same shape, or »…»; dialogue set
// with a dash opens with an en dash (– Hej, sa hon.) or an em dash.
// Straight and curly quotes are kept. No word lists yet.

export default {
  code: "sv",
  name: "Swedish",
  quotes: [["”", "”"], ["’", "’"], ["»", "»"], ["“", "”"], ["\"", "\""]],
  dialogueDash: ["–", "—"],
  // – Hej, sa Anna. – Kom hit. is two lines of speech.
  dashStartsLine: true
};

// Finnish: ”…” and ’…’, both marks the same shape, or »…»; dialogue set
// with a dash opens with an en dash or an em dash. Straight and curly
// quotes are kept. No word lists yet.

export default {
  code: "fi",
  name: "Finnish",
  quotes: [["”", "”"], ["’", "’"], ["»", "»"], ["“", "”"], ["\"", "\""]],
  dialogueDash: ["–", "—"],
  // – Moi, sanoi Anna. – Tule tänne. is two lines of speech.
  dashStartsLine: true
};

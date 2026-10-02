// Swedish: ”…” and ’…’, both marks the same shape, or »…»; dialogue set
// with a dash opens with an en dash (– Hej, sa hon.) or an em dash.
// Straight and curly quotes are kept. No word lists yet; build labels and
// narration pace below.

export default {
  code: "sv",
  name: "Swedish",
  quotes: [["”", "”"], ["’", "’"], ["»", "»"], ["“", "”"], ["\"", "\""]],
  dialogueDash: ["–", "—"],
  // – Hej, sa Anna. – Kom hit. is two lines of speech.
  dashStartsLine: true,
  narrationRate: 135,
  labels: {
    chapter: "Kapitel {n}",
    "chapter-heading": "{chapter}: {title}",
    contents: "Innehåll",
    and: "{a} och {b}",
    copyright: "Upphovsrätt",
    "all-rights-reserved": "Alla rättigheter förbehållna.",
    "published-by": "Utgiven av {publisher}",
    "scene-break": "Scenbyte",
    "cover-alt": "Omslag till {title}",
    "start-of-content": "Början av innehållet",
    "accessibility-summary": "Bok med enbart text, med navigerbar innehållsförteckning, en rubrik för varje kapitel och en enda logisk läsordning.",
    "accessibility-summary-cover": "Bok med text och en beskriven omslagsbild, med navigerbar innehållsförteckning, en rubrik för varje kapitel och en enda logisk läsordning.",
    "review-title": "{title}: läsexemplar",
    "review-intro": "Läsexemplar.",
    "review-intro-build": "Läsexemplar, version {build}.",
    "review-labels": "Varje stycke har en etikett som {label} (kapitel 3, stycke 12).",
    "review-quote": "Ange etiketten i varje anteckning, tillsammans med styckets första ord, så att författaren hittar exakt rätt ställe även när texten har ändrats.",
    "review-quote-build": "Ange etiketten och versionen i varje anteckning, tillsammans med styckets första ord, så att författaren hittar exakt rätt ställe även när texten har ändrats.",
    "review-note-link": "Länken Anteckning bredvid varje etikett öppnar en anteckning där detta redan är ifyllt.",
    note: "Anteckning",
    "note-title": "Skriv en anteckning om {label}",
    "anchor-title": "Länk till {label}",
    by: "av",
    "approximate-words": "Cirka {words} ord",
    "approximate-characters": "Cirka {characters} tecken",
    "narration-opening": "{title}. Skriven av {authors}. Uppläst av {narrator}.",
    "narration-opening-anonymous": "{title}. Uppläst av {narrator}.",
    "narration-closing": "Slut. Du har lyssnat på {title}, skriven av {authors}, uppläst av {narrator}.",
    "narration-closing-anonymous": "Slut. Du har lyssnat på {title}, uppläst av {narrator}.",
    "screenplay-credit": "Skriven av",
    "screenplay-source": "Baserad på verket av {authors}",
    "screenplay-source-anonymous": "Baserad på originalverket"
  }
};

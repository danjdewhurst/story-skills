// German: „…“ and ‚…‘, or »…« and ›…‹ in many books. » opens a quote here
// and closes one in French, so the base pack's guillemets are replaced.
// Straight and curly quotes are kept. No word lists yet; build labels and
// narration pace below.

export default {
  code: "de",
  name: "German",
  quotes: [["„", "“"], ["‚", "‘"], ["»", "«"], ["›", "‹"], ["“", "”"], ["\"", "\""]],
  narrationRate: 120,
  labels: {
    chapter: "Kapitel {n}",
    "chapter-heading": "{chapter}: {title}",
    contents: "Inhalt",
    and: "{a} und {b}",
    copyright: "Impressum",
    "all-rights-reserved": "Alle Rechte vorbehalten.",
    "published-by": "Erschienen bei {publisher}",
    "scene-break": "Szenenwechsel",
    "cover-alt": "Cover von {title}",
    "start-of-content": "Beginn des Inhalts",
    "accessibility-summary": "Buch, das nur aus Text besteht, mit navigierbarem Inhaltsverzeichnis, einer Überschrift für jedes Kapitel und einer einzigen logischen Lesereihenfolge.",
    "accessibility-summary-cover": "Buch mit Text und beschriebenem Coverbild, navigierbarem Inhaltsverzeichnis, einer Überschrift für jedes Kapitel und einer einzigen logischen Lesereihenfolge.",
    "review-title": "{title}: Leseexemplar",
    "review-intro": "Leseexemplar.",
    "review-intro-build": "Leseexemplar, Fassung {build}.",
    "review-labels": "Jeder Absatz hat eine Kennung wie {label} (Kapitel 3, Absatz 12).",
    "review-quote": "Geben Sie bei jeder Anmerkung die Kennung und die ersten Wörter des Absatzes an, damit sich die Stelle auch nach Änderungen am Text genau finden lässt.",
    "review-quote-build": "Geben Sie bei jeder Anmerkung die Kennung, die Fassung und die ersten Wörter des Absatzes an, damit sich die Stelle auch nach Änderungen am Text genau finden lässt.",
    "review-note-link": "Der Link „Anmerkung“ neben jeder Kennung öffnet eine Anmerkung, in der diese Angaben schon ausgefüllt sind.",
    note: "Anmerkung",
    "note-title": "Anmerkung zu {label} schreiben",
    "anchor-title": "Link zu {label}",
    by: "von",
    "approximate-words": "Etwa {words} Wörter",
    "approximate-characters": "Etwa {characters} Zeichen",
    "narration-opening": "{title}. Geschrieben von {authors}. Gelesen von {narrator}.",
    "narration-opening-anonymous": "{title}. Gelesen von {narrator}.",
    "narration-closing": "Ende. Sie hörten {title}, geschrieben von {authors}, gelesen von {narrator}.",
    "narration-closing-anonymous": "Ende. Sie hörten {title}, gelesen von {narrator}.",
    "screenplay-credit": "Geschrieben von",
    "screenplay-source": "Nach einer Vorlage von {authors}",
    "screenplay-source-anonymous": "Nach einer literarischen Vorlage"
  }
};

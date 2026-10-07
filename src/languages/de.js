// German: „…“ and ‚…‘, or »…« and ›…‹ in many books. » opens a quote here
// and closes one in French, so the base pack's guillemets are replaced.
// Straight and curly quotes are kept.
//
// Build labels and narration pace come first, then the word lists.
//
// Verbs are listed in the simple past, which is the same for first and
// third person singular (sagte, fühlte), plus the present for tags. A
// separable verb is listed by the part next to the subject (fügte for
// "fügte er hinzu"). Choices that differ from English:
// - No adverbSuffixes or adverbExceptions: a German manner adverb is the
//   bare adjective (schnell, leise), so no ending marks one, and the
//   adverb check is skipped.
// - No dialectPairs: the British and American pairs are English. Record
//   Swiss ss for ß, or Austrian words, as style-sheet `preferred` entries.
// - Contractions: the spoken forms with an apostrophe (geht's, auf'm,
//   hab'n) are counted. German has no contracted "is" to tell from a
//   possessive, so contractedIs is empty, and 's after any word counts:
//   a written possessive takes no apostrophe (Annas Buch).
// - No elisions: an apostrophe is not a quote mark in German.
// - Every noun is capitalised, so import's name candidates need
//   `determiners`, `relativeWords`, and `nounSuffixes`: a word that follows
//   an article (die Tür, der alte Hund), or ends like a noun (Hoffnung) and
//   follows one at least once, is a common noun, unless it also follows a
//   title or stands by a speech verb (Herr Jung, sagte Gretchen); see
//   extractNameCandidates in ../import.js. Common nouns that go without an
//   article (vor Angst, mit Kindern) are candidateStopwords.
// - Headings: an ordinal, or a number with a full stop, may come before
//   the heading word (Erstes Kapitel, 1. Kapitel, Zweiter Teil), in
//   `ordinalWords`.
// - A full stop after a number marks an ordinal (am 3. Mai), so
//   `ordinalStop` keeps the sentence going before a calendar word or a
//   word in lower case.

// Ordinals in every ending an ordinal before a heading word takes.
const ORDINALS = [
  "erst", "zweit", "dritt", "viert", "fünft", "sechst", "siebt", "siebent", "acht", "neunt", "zehnt", "elft", "zwölft"
].flatMap((stem) => ["e", "er", "es", "en"].map((ending) => `${stem}${ending}`));

export default {
  code: "de",
  name: "German",
  quotes: [["„", "“"], ["‚", "‘"], ["»", "«"], ["›", "‹"], ["“", "”"], ["\"", "\""]],
  ordinalStop: true,
  // Any capital before a full stop is an initial (É. Zola, Á. Pérez).
  capitalInitials: true,
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
    byline: "von {names}",
    "edited-by": "Herausgegeben von {names}",
    "approximate-words": "Etwa {words} Wörter",
    "approximate-characters": "Etwa {characters} Zeichen",
    "narration-opening": "{title}. Geschrieben von {authors}. Gelesen von {narrator}.",
    "narration-opening-anonymous": "{title}. Gelesen von {narrator}.",
    "narration-closing": "Ende. Sie hörten {title}, geschrieben von {authors}, gelesen von {narrator}.",
    "narration-closing-anonymous": "Ende. Sie hörten {title}, gelesen von {narrator}.",
    "narration-byline": "Geschrieben von {names}.",
    "narration-contributors": "Mit Beiträgen von {names}.",
    "screenplay-credit": "Geschrieben von",
    "screenplay-source": "Nach einer Vorlage von {authors}",
    "screenplay-source-anonymous": "Nach einer literarischen Vorlage",
    // The codex (`build --format codex`), the story bible site: its page
    // and section names, the kinds of entity (plural, then singular), and
    // the headings, table columns, and notes on its pages. {flag},
    // {command}, and {field} place code that stays in English.
    "codex-story-bible": "Story-Bible",
    "codex-index-title": "{title}: Story-Bible",
    "codex-timeline": "Zeitleiste",
    "codex-threads": "Handlungsstränge und Hinweise",
    "codex-progress": "Fortschritt",
    "codex-characters": "Figuren",
    "codex-locations": "Schauplätze",
    "codex-factions": "Fraktionen",
    "codex-artifacts": "Artefakte",
    "codex-systems": "Systeme",
    "codex-arcs": "Erzählbögen",
    "codex-character": "Figur",
    "codex-location": "Schauplatz",
    "codex-faction": "Fraktion",
    "codex-artifact": "Artefakt",
    "codex-system": "System",
    "codex-arc": "Erzählbogen",
    "codex-chapters": "Kapitel",
    "codex-scenes": "Szenen",
    "codex-questions": "Fragen",
    "codex-promises": "Versprechen",
    "codex-clues": "Hinweise",
    "codex-note-spoilers": "Story-Bible mit Spoilern: Notizen zu den Einträgen, Status, Tode, Wissen, Hinweise und die Auflösung jedes Handlungsstrangs.",
    "codex-note-safe": "Spoilerfreie Story-Bible: wer und was in der Geschichte vorkommt und wo. Notizen, Status, Tode, Wissen, Hinweise und Auflösungen fehlen; mit {flag} entsteht die vollständige Story-Bible.",
    "codex-no-entities": "Noch keine Figuren, Orte oder anderen Einträge.",
    "codex-relationships": "Beziehungen",
    "codex-appears-in": "Kommt vor in",
    "codex-advanced-in": "Vorangetrieben in",
    "codex-linked-from": "Verlinkt von",
    "codex-changes": "Änderungen",
    "codex-change": "Ab {chapter}: {field} wird zu {value}",
    "codex-knows": "Wissen",
    "codex-known-from-start": "von Anfang an bekannt",
    "codex-learned-in": "erfährt es in {chapter}",
    "codex-notes": "Notizen",
    "codex-role": "Rolle",
    "codex-aliases": "Aliasnamen",
    "codex-status": "Status",
    "codex-dies-in": "Stirbt in",
    "codex-revived-in": "Wiederbelebt in",
    "codex-type": "Typ",
    "codex-region": "Region",
    "codex-setting": "Umgebung",
    "codex-notable-characters": "Wichtige Figuren",
    "codex-routes": "Routen",
    "codex-hours": "{hours} Std.",
    "codex-members": "Mitglieder",
    "codex-owner": "Besitzer",
    "codex-themes": "Themen",
    "codex-pronunciation": "Aussprache",
    "codex-date": "Datum",
    "codex-time": "Zeit",
    "codex-scene": "Szene",
    "codex-chapter": "Kapitel",
    "codex-pov": "Perspektivfigur",
    "codex-told-late": "nicht chronologisch erzählt",
    "codex-flashback": "Rückblende auf {date}",
    "codex-no-dates": "Noch keine datierten Szenen oder Kapitel. Geben Sie Szenen ein Feld {field}, um sie in der erzählten Zeit einzuordnen.",
    "codex-timeline-note": "Ereignisse in der Reihenfolge der erzählten Zeit, wie {command} sie auflistet.",
    "codex-undated": "Ohne Datum",
    "codex-point-of-view": "Erzählperspektive",
    "codex-words": "Wörter",
    "codex-share": "Anteil",
    "codex-unspecified": "nicht angegeben",
    "codex-presence": "Auftritte",
    "codex-first": "Erster Auftritt",
    "codex-last": "Letzter Auftritt",
    "codex-longest-gap": "Längste Lücke",
    "codex-death": "Tod",
    "codex-dies-in-chapter": "stirbt in Kapitel {n}",
    "codex-threads-note": "Nur offene Fragen und Versprechen, ohne Antworten und Einlösungen. Hinweise und aufgelöste Handlungsstränge erfordern {flag}.",
    "codex-none": "Keine.",
    "codex-question": "Frage",
    "codex-raised-in": "Aufgeworfen in",
    "codex-resolved-in": "Aufgelöst in",
    "codex-promise": "Versprechen",
    "codex-planted-in": "Angelegt in",
    "codex-paid-off-in": "Eingelöst in",
    "codex-clue": "Hinweis",
    "codex-clues-note": "P markiert das Kapitel, in dem ein Hinweis gelegt wird, R das Kapitel, in dem er aufgedeckt wird, und x beides, wie {command} sie ausgibt.",
    // The clue totals, with one red herring and with any other number.
    "codex-clue-totals-one": "{planted} von {total} gelegt, {revealed} aufgedeckt, {herrings} falsche Fährte.",
    "codex-clue-totals": "{planted} von {total} gelegt, {revealed} aufgedeckt, {herrings} falsche Fährten.",
    "codex-red-herring": "falsche Fährte",
    "codex-significance-delayed": "Bedeutung zeigt sich später",
    "codex-total-words": "Wörter gesamt",
    "codex-total-characters": "Zeichen gesamt",
    "codex-target-words": "Wortziel",
    "codex-target-characters": "Zeichenziel",
    "codex-done": "Erreicht",
    "codex-remaining": "Verbleibend",
    "codex-deadline": "Abgabetermin",
    "codex-target": "Ziel",
    // A count of written characters (letters), not of people.
    "codex-character-count": "Zeichen",
    "codex-plot-grid": "Handlungsraster",
    "codex-grid-note": "Erzählbögen nach Kapitel, wie {command} sie ausgibt: x, wo ein Kapitel oder eine seiner Szenen den Bogen vorantreibt.",
    "codex-unknown": "unbekannt",
    "codex-hook": "Hook",
    "codex-outcomes": "Ergebnisse",
    "codex-session-log": "Schreibprotokoll"
  },
  checks: {
    filterWords: [
      "fühlte", "spürte", "empfand", "sah", "hörte", "vernahm", "bemerkte", "merkte", "wunderte",
      "schien", "beobachtete", "wusste", "entschied", "beschloss", "dachte", "glaubte", "erkannte",
      "begriff", "ahnte", "registrierte"
    ],

    // Tags that replace "sagte" with an action or a manner. Rief, schrie,
    // brüllte, flüsterte, and murmelte describe volume and are left out, as
    // in English; erwiderte and entgegnete are ordinary German tags.
    saidBookisms: [
      "bellte", "erkundigte", "fauchte", "frotzelte", "gluckste", "grinste", "grunzte", "gurrte", "höhnte",
      "jammerte", "japste", "keuchte", "kicherte", "knurrte", "konterte", "kreischte", "lachte", "lächelte",
      "maulte", "nörgelte", "schluchzte", "schnappte", "schnaubte", "schnurrte", "seufzte", "spie",
      "spottete", "stöhnte", "säuselte", "verkündete", "witzelte", "zischte", "ächzte", "hauchte",
      "schmunzelte", "blaffte", "schnauzte"
    ],

    // Versetzte is an old-fashioned but plain "replied".
    plainTags: ["sagte", "sagten", "fragte", "fragten", "sagt", "fragt", "versetzte"],

    beatPronouns: ["er", "sie", "es", "ich", "wir", "ihr", "du"],

    echoStopwords: [
      "aber", "alle", "alles", "also", "andere", "anderen", "auch", "bevor", "beim", "dabei", "damit",
      "dann", "darauf", "darum", "dass", "dein", "deine", "denen", "denn", "dessen", "dich", "dies",
      "diese", "diesem", "diesen", "dieser", "dieses", "doch", "dort", "durch", "eine", "einem", "einen",
      "einer", "eines", "einfach", "einige", "einmal", "etwas", "ganz", "gegen", "gewesen", "habe",
      "haben", "hatte", "hatten", "hier", "hinter", "ihnen", "ihre", "ihrem", "ihren", "ihrer", "immer",
      "jede", "jeder", "jedes", "jetzt", "kein", "keine", "konnte", "konnten", "können", "machen", "mehr",
      "mein", "meine", "mich", "nach", "nicht", "nichts", "noch", "oder", "ohne", "schon", "sehr", "sein",
      "seine", "seinem", "seinen", "seiner", "selbst", "sich", "sind", "sollte", "über", "unter", "viel",
      "vielleicht", "waren", "warum", "wäre", "weil", "weiter", "welche", "wenn", "werden", "wieder",
      "will", "wird", "wollte", "wurde", "wurden", "würde", "zurück", "zwischen", "während"
    ],

    phraseStopwords: [
      "aber", "als", "am", "an", "auch", "auf", "aus", "bei", "da", "dann", "das", "dass", "dem", "den",
      "der", "des", "die", "du", "ein", "eine", "einem", "einen", "einer", "er", "es", "hat", "hatte",
      "ich", "ihm", "ihn", "ihr", "ihre", "im", "in", "ist", "mich", "mir", "mit", "nicht", "noch", "nur",
      "sein", "seine", "sich", "sie", "so", "um", "und", "uns", "von", "vor", "war", "was", "wenn", "wie",
      "wir", "zu", "zum", "zur"
    ],

    // story voices.
    speechVerbs: [
      "sagte", "sagt", "fragte", "fragt", "antwortete", "antwortet", "erwiderte", "entgegnete",
      "flüsterte", "flüstert", "rief", "ruft", "schrie", "schreit", "murmelte", "murmelt", "brummte",
      "meinte", "meint", "fügte", "erklärte", "erzählte", "befahl", "verlangte", "beharrte",
      "bestätigte", "wiederholte", "begann"
    ],

    // "Es" is left out, as English leaves out "it": "es regnete" is
    // narration.
    speechPronouns: ["er", "sie", "ich", "wir"],

    contractionSuffixes: ["'s", "'m", "'n"],
    contractedIs: [],

    voiceStopwords: [
      "aber", "also", "auch", "bitte", "danke", "dann", "dass", "denn", "dich", "diese", "dieser", "doch",
      "eben", "eigentlich", "eine", "einen", "einfach", "etwas", "euch", "ganz", "geht", "gibt", "habe",
      "haben", "hast", "hier", "ihnen", "immer", "jetzt", "kann", "kannst", "kein", "keine", "mach",
      "mehr", "mein", "meine", "mich", "nicht", "nichts", "noch", "oder", "sagen", "sagte", "schon",
      "sehr", "sein", "selbst", "sind", "warum", "weil", "weiß", "wenn", "werde", "wieder", "will",
      "wird", "wirklich", "wohl", "wollte"
    ],

    // Sentence splitting: Dr. Weber and bzw. never end a sentence; usw. and
    // Nr. may. Single letters (z. B., d. h., u. a.) are initials. Mio. and
    // Mrd. stay titles: every German noun is capitalised, so as context
    // words they would end the sentence before the noun (3 Mio. Euro).
    titleAbbreviations: ["Dr", "Prof", "Hr", "Hrn", "Fr", "Frl", "St", "bzw", "bspw", "ca", "ehem", "sog", "vgl", "ggf", "evtl", "inkl", "zzgl", "Str", "Mio", "Mrd"],
    contextAbbreviations: ["usw", "etc", "Nr", "Jh", "Std", "Min"],

    // Capitalised in German like every noun, and never names.
    calendarWords: [
      "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonnabend", "Sonntag",
      "Januar", "Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September",
      "Oktober", "November", "Dezember"
    ],

    // story import. "Erstes Kapitel", with the ordinal first, is not
    // recognised; write "Kapitel 1" or "Kapitel Eins".
    chapterWords: ["kapitel"],
    sectionWords: ["prolog", "epilog", "zwischenspiel", "nachwort"],
    partWords: ["teil", "buch"],
    frontMatterWords: ["prolog", "vorwort", "einleitung", "einführung", "vorspiel"],

    // Spelled-out chapter numbers, written as one word ("Kapitel
    // Einundzwanzig", "Kapitel Hundertzwei"); see wordNumeral in
    // ../import.js.
    numberWords: {
      words: [
        "eins", "ein", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf",
        "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn",
        "zwanzig", "dreißig", "dreissig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig",
        "hundert"
      ],
      joiners: ["und"]
    },
    // Ordinals before the heading word (Erstes Kapitel, Zweiter Teil); a
    // number with a full stop (1. Kapitel) is read as one too.
    ordinalWords: ORDINALS,

    // Formal Sie and Ihr are capitalised mid-sentence.
    candidateStopwords: [
      "Aber", "Als", "Am", "An", "Auch", "Auf", "Aus", "Bei", "Bis", "Da", "Dann", "Das", "Dass", "Dein",
      "Dem", "Den", "Denn", "Der", "Des", "Die", "Dies", "Diese", "Dieser", "Doch", "Dr", "Du", "Ein",
      "Eine", "Einem", "Einen", "Einer", "Er", "Es", "Frau", "Fräulein", "Für", "Herr", "Hier", "Ich",
      "Ihnen", "Ihr", "Ihre", "Ihrem", "Ihren", "Ihrer", "Im", "In", "Ja", "Jetzt", "Kein", "Keine", "Man",
      "Mein", "Meine", "Mit", "Nach", "Nein", "Nicht", "Noch", "Nun", "Nur", "Ob", "Oder", "Sein", "Seine",
      "Sie", "So", "Über", "Um", "Und", "Uns", "Unter", "Von", "Vor", "Was", "Wenn", "Wer", "Wie", "Wir",
      "Wo", "Zu", "Zum", "Zur",
      // Common nouns that often go without an article (vor Angst, mit
      // Kindern), so the article rule below cannot catch them.
      "Abend", "Angst", "Arbeit", "Augen", "Blut", "Brot", "Durst", "Ende", "Erde", "Feuer", "Frauen",
      "Freude", "Geld", "Glück", "Gott", "Hand", "Händen", "Hause", "Haus", "Häusern", "Herz", "Hilfe",
      "Himmel", "Hunger", "Jahre", "Jahren", "Kinder", "Kindern", "Kraft", "Leben", "Leute", "Leuten",
      "Licht", "Liebe", "Luft", "Lust", "Männer", "Männern", "Menschen", "Minuten", "Morgen", "Musik", "Mut",
      "Nacht", "Recht", "Regen", "Ruhe", "Schuld", "Schule", "Sorge", "Sorgen", "Spaß", "Stunden", "Tag",
      "Tage", "Tagen", "Tod", "Uhr", "Wasser", "Wein", "Welt", "Wind", "Zeit"
    ],

    // Determiners that are also relative pronouns (die Frau, die Lena
    // kannte): after a comma they start a clause, not a noun phrase.
    relativeWords: ["der", "die", "das", "den", "dem", "deren", "dessen", "denen"],

    // Words that make the capitalised word after them, with up to two
    // lower-case words between (der alte Hund), a common noun: articles,
    // their contractions with a preposition, possessives, demonstratives,
    // quantifiers, and the words before a noun made from an adjective
    // (etwas Neues).
    determiners: [
      "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines",
      "kein", "keine", "keinen", "keinem", "keiner", "keines", "mein", "meine", "meinen", "meinem",
      "meiner", "meines", "dein", "deine", "deinen", "deinem", "deiner", "deines", "sein", "seine",
      "seinen", "seinem", "seiner", "seines", "ihr", "ihre", "ihren", "ihrem", "ihrer", "ihres", "unser",
      "unsere", "unseren", "unserem", "unserer", "unseres", "euer", "eure", "euren", "eurem", "eurer",
      "eures", "dieser", "diese", "dieses", "diesem", "diesen", "jener", "jene", "jenes", "jenem",
      "jenen", "jeder", "jede", "jedes", "jedem", "jeden", "welcher", "welche", "welches", "welchem",
      "welchen", "mancher", "manche", "manches", "solche", "solcher", "solches", "alle", "alles",
      "beide", "einige", "mehrere", "viele", "wenige", "etwas", "nichts", "viel", "wenig", "im", "am",
      "zum", "zur", "vom", "beim", "ins", "ans", "aufs", "durchs", "fürs", "ums", "übers"
    ],

    // Endings only nouns have.
    nounSuffixes: [
      "ung", "ungen", "heit", "heiten", "keit", "keiten", "schaft", "schaften", "tion", "tionen", "tät",
      "täten", "ismus", "nis", "nisse", "chen", "lein", "tum"
    ],

    titleWords: [
      "der", "die", "das", "ein", "eine", "von", "van", "zu", "herr", "frau", "fräulein", "hr", "fr",
      "frl", "dr", "doktor", "prof", "professor", "könig", "königin", "prinz", "prinzessin", "herzog",
      "herzogin", "graf", "gräfin", "baron", "baronin", "fürst", "fürstin", "kaiser", "kaiserin", "ritter",
      "hauptmann", "kapitän", "general", "oberst", "major", "leutnant", "feldwebel", "kommandant",
      "vater", "mutter", "bruder", "schwester", "onkel", "tante", "sankt", "st", "pater", "meister",
      "alte", "alter", "junge", "kleine", "kleiner"
    ]
  }
};

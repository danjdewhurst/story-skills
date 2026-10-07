// French. Speech is set in « … » (with a space inside, which ../sentences.js
// allows) or with a dialogue dash, both from the base pack.
//
// Build labels and narration pace come first, then the word lists. In the
// labels a colon takes a no-break space before it, as French typography
// sets it.
//
// Verbs are listed in the forms fiction narrates in: the passé simple and
// imperfect, third and first person singular (sentit, sentait, sentis),
// with the past participle where the passé composé is common. Words are
// matched as written after a curly apostrophe is made straight, so an
// elided form is listed whole (s'exclama, c'était). Choices that differ
// from English:
// - Adverbs: a manner adverb is a feminine adjective plus -ment
//   (lentement, vraiment, absolument, constamment). The suffixes are the
//   endings those take, so moment, comment, and dorment never count; the
//   nouns and verbs that share an ending are exceptions.
//   Since French nouns take an article, `adverbBlockers` lists the words
//   after which an -ment word is a noun or verb (le moment, ils aiment),
//   with the elisions (l'appartement, s'enflamment).
// - Inverted tags (dit-il, demanda-t-elle) join verb and pronoun with a
//   hyphen; `inversionLinks` names the joins, so the tag counts as dit.
//   A tag may stand inside the speech (« Viens, dit-il, nous partons. »,
//   — Viens ! s'exclama-t-il.); `inciseTags` reads it there.
// - Filter words leave out vit (also "lives") and compris (also
//   "included"), and se demander, which is two words and whose demandait
//   is also a tag.
// - Headings: an ordinal may come before the heading word (Première
//   partie), in `ordinalWords`; septante, huitante, octante, and nonante
//   are numbers too.
// - No dialectPairs: the British and American pairs are English. Record
//   Quebec or Swiss usage as style-sheet `preferred` entries.
// - No contractionSuffixes or contractedIs: elision (l'homme, j'ai) is
//   compulsory, so an apostrophe says nothing about how formal a voice
//   is, and the spoken ne dropped from a negation leaves no mark to count.
//   The contraction count is skipped. No elisions either: an elided word
//   carries its apostrophe inside it, after a letter, where no quote opens.

export default {
  code: "fr",
  name: "French",
  // Any capital before a full stop is an initial (É. Zola, Á. Pérez).
  capitalInitials: true,
  narrationRate: 135,
  // A tag may stand inside the speech: « Viens, dit-il, nous partons. »,
  // or — Viens ! s'exclama-t-il.
  inciseTags: true,
  labels: {
    chapter: "Chapitre {n}",
    "chapter-heading": "{chapter} : {title}",
    contents: "Table des matières",
    and: "{a} et {b}",
    copyright: "Droits d’auteur",
    "all-rights-reserved": "Tous droits réservés.",
    "published-by": "Publié par {publisher}",
    "scene-break": "Changement de scène",
    "cover-alt": "Couverture de {title}",
    "start-of-content": "Début du contenu",
    "accessibility-summary": "Livre entièrement textuel, avec une table des matières navigable, un titre pour chaque chapitre et un ordre de lecture logique unique.",
    "accessibility-summary-cover": "Livre textuel avec une image de couverture décrite, une table des matières navigable, un titre pour chaque chapitre et un ordre de lecture logique unique.",
    "review-title": "{title} : exemplaire de relecture",
    "review-intro": "Exemplaire de relecture.",
    "review-intro-build": "Exemplaire de relecture, version {build}.",
    "review-labels": "Chaque paragraphe porte une étiquette comme {label} (chapitre 3, paragraphe 12).",
    "review-quote": "Citez l’étiquette dans chaque note, avec les premiers mots du paragraphe, pour que l’auteur retrouve l’endroit exact même après une modification du texte.",
    "review-quote-build": "Citez l’étiquette et la version dans chaque note, avec les premiers mots du paragraphe, pour que l’auteur retrouve l’endroit exact même après une modification du texte.",
    "review-note-link": "Le lien Note à côté de chaque étiquette ouvre une note où ces informations sont déjà remplies.",
    note: "Note",
    "note-title": "Écrire une note sur {label}",
    "anchor-title": "Lien vers {label}",
    by: "par",
    byline: "par {names}",
    "edited-by": "Sous la direction de {names}",
    "approximate-words": "Environ {words} mots",
    "approximate-characters": "Environ {characters} caractères",
    "narration-opening": "{title}. Écrit par {authors}. Lu par {narrator}.",
    "narration-opening-anonymous": "{title}. Lu par {narrator}.",
    "narration-closing": "Fin. Vous venez d’écouter {title}, écrit par {authors}, lu par {narrator}.",
    "narration-closing-anonymous": "Fin. Vous venez d’écouter {title}, lu par {narrator}.",
    "narration-byline": "Écrit par {names}.",
    "narration-edited-by": "Sous la direction de {names}.",
    "narration-contributors": "Avec des contributions de {names}.",
    "screenplay-credit": "Écrit par",
    "screenplay-source": "D’après l’œuvre de {authors}",
    "screenplay-source-anonymous": "D’après l’œuvre originale",
    // The codex (`build --format codex`), the story bible site: its page
    // and section names, the kinds of entity, and the headings, table
    // columns, and notes on its pages.
    "codex-story-bible": "Bible de l’histoire",
    "codex-index-title": "{title} : bible de l’histoire",
    "codex-timeline": "Chronologie",
    "codex-threads": "Intrigues et indices",
    "codex-progress": "Avancement",
    "codex-characters": "Personnages",
    "codex-locations": "Lieux",
    "codex-factions": "Factions",
    "codex-artifacts": "Artefacts",
    "codex-systems": "Systèmes",
    "codex-arcs": "Arcs",
    "codex-character": "Personnage",
    "codex-location": "Lieu",
    "codex-faction": "Faction",
    "codex-artifact": "Artefact",
    "codex-system": "Système",
    "codex-arc": "Arc",
    "codex-chapters": "Chapitres",
    "codex-scenes": "Scènes",
    "codex-questions": "Questions",
    "codex-promises": "Promesses",
    "codex-clues": "Indices",
    "codex-note-spoilers": "Bible de l’histoire avec révélations : notes sur les entités, statuts, morts, connaissances, indices et dénouement de chaque intrigue.",
    "codex-note-safe": "Bible de l’histoire sans révélations : qui et quoi figure dans l’histoire, et où. Les notes, statuts, morts, connaissances, indices et dénouements sont omis ; générez-la avec {flag} pour obtenir la bible complète.",
    "codex-no-entities": "Aucun personnage, lieu ou autre entité pour l’instant.",
    "codex-relationships": "Relations",
    "codex-appears-in": "Apparaît dans",
    "codex-advanced-in": "Progresse dans",
    "codex-linked-from": "Mentionné dans",
    "codex-changes": "Évolutions",
    "codex-change": "À partir de {chapter} : {field} devient {value}",
    "codex-knows": "Sait",
    "codex-known-from-start": "connu dès le début",
    "codex-learned-in": "appris dans {chapter}",
    "codex-notes": "Notes",
    "codex-role": "Rôle",
    "codex-aliases": "Alias",
    "codex-status": "Statut",
    "codex-dies-in": "Meurt dans",
    "codex-revived-in": "Ressuscite dans",
    "codex-type": "Type",
    "codex-region": "Région",
    "codex-setting": "Cadre",
    "codex-notable-characters": "Personnages notables",
    "codex-routes": "Itinéraires",
    "codex-hours": "{hours} h",
    "codex-members": "Membres",
    "codex-owner": "Propriétaire",
    "codex-themes": "Thèmes",
    "codex-pronunciation": "Prononciation",
    "codex-date": "Date",
    "codex-time": "Heure",
    "codex-scene": "Scène",
    "codex-chapter": "Chapitre",
    "codex-pov": "PDV",
    "codex-told-late": "raconté hors chronologie",
    "codex-flashback": "retour en arrière : {date}",
    "codex-no-dates": "Aucune scène ni aucun chapitre daté pour l’instant. Donnez aux scènes un champ {field} pour les situer dans le temps de l’histoire.",
    "codex-timeline-note": "Les événements dans l’ordre chronologique de l’histoire, tels que {command} les liste.",
    "codex-undated": "Non daté",
    "codex-point-of-view": "Point de vue",
    "codex-words": "Mots",
    "codex-share": "Part",
    "codex-unspecified": "non précisé",
    "codex-presence": "Présence",
    "codex-first": "Premier",
    "codex-last": "Dernier",
    "codex-longest-gap": "Plus longue absence",
    "codex-death": "Mort",
    "codex-dies-in-chapter": "meurt au chapitre {n}",
    "codex-threads-note": "Uniquement les questions ouvertes et les promesses, sans leurs réponses ni leur résolution. Les indices et les intrigues résolues nécessitent {flag}.",
    "codex-none": "Aucun.",
    "codex-question": "Question",
    "codex-raised-in": "Posée dans",
    "codex-resolved-in": "Résolue dans",
    "codex-promise": "Promesse",
    "codex-planted-in": "Plantée dans",
    "codex-paid-off-in": "Tenue dans",
    "codex-clue": "Indice",
    "codex-clues-note": "P marque le chapitre où un indice est planté, R celui où il est révélé, et x les deux, comme les affiche {command}.",
    "codex-clue-totals-one": "Indices plantés : {planted} sur {total} ; révélés : {revealed} ; fausse piste : {herrings}.",
    "codex-clue-totals": "Indices plantés : {planted} sur {total} ; révélés : {revealed} ; fausses pistes : {herrings}.",
    "codex-red-herring": "fausse piste",
    "codex-significance-delayed": "portée révélée plus tard",
    "codex-total-words": "Total des mots",
    "codex-total-characters": "Total des caractères",
    "codex-target-words": "Objectif de mots",
    "codex-target-characters": "Objectif de caractères",
    "codex-done": "Réalisé",
    "codex-remaining": "Restant",
    "codex-deadline": "Échéance",
    "codex-target": "Objectif",
    "codex-character-count": "Caractères",
    "codex-plot-grid": "Grille des intrigues",
    "codex-grid-note": "Les arcs par chapitre, comme les affiche {command} : x lorsqu’un chapitre ou l’une de ses scènes fait avancer l’arc.",
    "codex-unknown": "inconnu",
    "codex-hook": "Accroche",
    "codex-outcomes": "Issues",
    "codex-session-log": "Journal des séances"
  },
  checks: {
    filterWords: [
      "sentit", "sentait", "sentis", "senti", "voyait", "vis", "entendit", "entendait", "entendis",
      "entendu", "remarqua", "remarquait", "remarquai", "remarqué", "aperçut", "apercevait", "aperçus",
      "aperçu", "sembla", "semblait", "parut", "paraissait", "observa", "observait", "sut", "savait",
      "sus", "su", "décida", "décidait", "décidai", "décidé", "pensa", "pensait", "pensai", "pensé",
      "comprit", "comprenait", "réalisa", "réalisait", "crut", "croyait", "songea", "songeait", "regarda",
      "regardait", "écouta", "écoutait"
    ],

    // Tags that replace "dit" with an action or a manner. Murmura,
    // chuchota, marmonna, and hurla describe volume and are left out, as in
    // English; reprit, répliqua, and lança are ordinary French tags.
    saidBookisms: [
      "aboya", "affirma", "bougonna", "cracha", "déclara", "glapit", "gloussa", "gronda", "grogna",
      "haleta", "maugréa", "minauda", "persifla", "railla", "ricana", "ronronna", "rugit", "rétorqua",
      "sanglota", "siffla", "souffla", "soupira", "sourit", "s'enquit", "s'esclaffa", "s'exclama",
      "s'écria", "trancha", "ironisa", "énonça", "rit", "gémit", "plaisanta", "grommela"
    ],

    plainTags: ["dit", "dis", "dirent", "demanda", "demandai", "demande", "demandèrent"],

    beatPronouns: ["il", "elle", "ils", "elles", "je", "nous", "on", "vous", "tu"],

    // dit-il, demanda-t-elle: the hyphens between a tag's verb and its
    // pronoun. The longer join is tried first.
    inversionLinks: ["-t-", "-"],

    adverbSuffixes: ["ement", "ément", "iment", "ument", "ûment", "amment", "emment"],
    adverbLabel: "-ment adverbs",
    // Nouns, adjectives, and third person plural verbs with an adverb's
    // ending.
    adverbExceptions: [
      "abaissement", "aboiement", "accouchement", "acharnement", "acquiescement", "affrontement",
      "agacement", "agrément", "aliment", "allument", "aménagement", "animent", "apaisement",
      "appartement", "argument", "armement", "assument", "attachement", "avertissement", "aveuglement",
      "balancement", "battement", "bâtiment", "bombardement", "bouleversement", "bourdonnement",
      "campement", "changement", "châtiment", "cheminement", "chuchotement", "ciment", "claquement",
      "clément", "clignement", "commencement", "comportement", "complément", "compliment",
      "consentiment", "consument", "craquement", "crépitement", "croisement", "déciment", "déplacement",
      "dément", "département", "déroulement", "détachement", "détriment", "développement", "dévouement",
      "divertissement", "document", "écoulement", "effondrement", "égarement", "élancement", "élément",
      "éloignement", "embarquement", "emplacement", "emportement", "empressement", "encouragement",
      "enchantement", "enfermement", "engagement", "engourdissement", "enlèvement", "enseignement",
      "entêtement", "enterrement", "entraînement", "épuisement", "équipement", "établissement",
      "estiment", "étonnement", "étranglement", "évanouissement", "événement", "évènement", "expriment",
      "flottement", "froncement", "frémissement", "frottement", "fument", "gémissement", "glissement",
      "gouvernement", "grésillement", "grincement", "grondement", "haussement", "hochement", "hument",
      "hurlement", "impriment", "inclément", "instrument", "isolement", "jaillissement", "jugement",
      "jument", "lancement", "liment", "logement", "mécontentement", "monument", "mouvement",
      "parfument", "piment", "piétinement", "pincement", "présument", "pressentiment", "raclement",
      "raisonnement", "ralentissement", "rapprochement", "rassemblement", "recueillement", "régiment",
      "règlement", "relâchement", "remerciement", "renseignement", "ressentiment", "résument",
      "revirement", "riment", "ronflement", "roulement", "rugissement", "ruissellement", "saignement",
      "scintillement", "sentiment", "serrement", "sifflement", "soulagement", "soulèvement", "suppriment",
      "supplément", "tiraillement", "tintement", "traitement", "tremblement", "tressaillement",
      "véhément", "vêtement", "vieillissement", "aiment", "abîment", "condiment", "rudiment",
      "abattement", "aboutissement", "abrutissement", "accablement", "accomplissement", "accroissement",
      "achèvement", "acheminement", "adoucissement", "affaiblissement", "affaissement", "affolement",
      "agenouillement", "agissement", "agrandissement", "ahurissement", "ajustement", "alignement",
      "allaitement", "allongement", "alourdissement", "amoncellement", "amusement", "anéantissement",
      "apitoiement", "applaudissement", "appauvrissement", "arrachement", "arrangement", "arriment",
      "assentiment", "assombrissement", "assoupissement", "atermoiement", "attendrissement", "attroupement",
      "avancement", "avènement", "avilissement", "bâillement", "balbutiement", "bannissement", "bégaiement",
      "bêlement", "beuglement", "blanchiment", "bouillonnement", "bredouillement", "bruissement",
      "chamboulement", "chancellement", "chargement", "chavirement", "chevauchement", "chuintement",
      "classement", "clapotement", "cliquetement", "clignotement", "commandement", "compartiment",
      "compriment", "consentement", "contentement", "couronnement", "crissement", "croassement",
      "débarquement", "débordement", "déchaînement", "déchirement", "décollement", "découragement",
      "décrément", "dédommagement", "défilement", "dégagement", "déguisement", "délabrement",
      "délaissement", "délassement", "démantèlement", "déménagement", "dénigrement", "dénouement",
      "dénuement", "dépassement", "dépaysement", "dépérissement", "déploiement", "déracinement",
      "dérangement", "dérèglement", "désagrément", "désarmement", "désœuvrement", "dessèchement",
      "détournement", "dévoilement", "discernement", "durcissement", "ébahissement", "éblouissement",
      "éboulement", "ébranlement", "écartement", "échauffement", "éclaircissement", "éclatement",
      "écrasement", "écroulement", "effacement", "effarement", "effleurement", "effritement", "égouttement",
      "élargissement", "émerveillement", "emballement", "embellissement", "embrasement", "émiettement",
      "emménagement", "empêchement", "empiètement", "empilement", "empoisonnement", "emprisonnement",
      "encadrement", "enchaînement", "encombrement", "endettement", "endormissement", "enfoncement",
      "enflamment", "engloutissement", "engouement", "enivrement", "enlisement", "enracinement",
      "enregistrement", "enrichissement", "enroulement", "enrouement", "ensevelissement", "ensorcellement",
      "entassement", "entrechoquement", "entrelacement", "envahissement", "envoûtement", "épaississement",
      "épanchement", "épanouissement", "éparpillement", "escarpement", "escriment", "essoufflement",
      "étalement", "étirement", "étouffement", "étourdissement", "excrément", "exhument", "flamboiement",
      "fléchissement", "foisonnement", "fonctionnement", "fourmillement", "fourvoiement",
      "frétillement", "froissement", "gazouillement", "glapissement", "gloussement", "gonflement",
      "grignotement", "grognement", "grossissement", "grouillement", "halètement", "harcèlement",
      "hébergement", "hennissement", "incrément", "inhument", "jaunissement", "jappement", "larmoiement",
      "licenciement", "maniement", "marmonnement", "martèlement", "médicament", "ménagement", "miaulement",
      "miroitement", "nivellement", "noircissement", "ondoiement", "oppriment", "ornement", "paiement",
      "pansement", "parlement", "pétillement", "peuplement", "piaillement", "picotement", "placement",
      "plissement", "pourrissement", "priment", "prolongement", "raffermissement", "rafraîchissement",
      "raidissement", "rajeunissement", "ralliement", "rallument", "ramollissement", "raniment", "rangement",
      "rapetissement", "ravissement", "rayonnement", "recensement", "recommencement", "recrutement",
      "redoublement", "redressement", "refroidissement", "regroupement", "rejaillissement", "remboursement",
      "remuement", "renfrognement", "renforcement", "reniement", "renoncement", "renouvellement",
      "renversement", "répriment", "resserrement", "retentissement", "rétablissement", "retournement",
      "retranchement", "rétrécissement", "ricanement", "ronronnement", "roucoulement", "saisissement",
      "sautillement", "sédiment", "sifflotement", "sous-estiment", "subliment", "surgissement", "susurrement",
      "tapotement", "tassement", "tâtonnement", "tégument", "titubement", "tortillement", "tournoiement",
      "trébuchement", "tremblotement", "trépignement", "tressautement", "trottinement", "tutoiement",
      "vacillement", "vagissement", "verdissement", "vouvoiement", "vrombissement", "émolument", "enrhument"
    ],

    // Words after which a word in -ment is not an adverb: articles,
    // possessives, and demonstratives (le moment, son mouvement), subject
    // pronouns and qui before a verb (ils aiment), and prepositions that
    // take a bare noun (avec étonnement). Those ending in an apostrophe are
    // elisions joined to the word (l'appartement, s'enflamment).
    adverbBlockers: [
      "le", "la", "les", "un", "une", "du", "des", "au", "aux", "ce", "cet", "cette", "ces", "mon", "ma",
      "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos", "votre", "vos", "leur", "leurs",
      "quel", "quelle", "quels", "quelles", "chaque", "aucun", "aucune", "nul", "nulle", "ils", "elles",
      "qui", "avec", "en", "de", "par", "l'", "d'", "s'", "n'", "j'", "m'", "t'"
    ],

    echoStopwords: [
      "ainsi", "alors", "après", "aussi", "autre", "autres", "avaient", "avait", "avant", "avec", "avoir",
      "beaucoup", "bien", "c'est", "c'était", "cela", "celle", "celui", "cette", "ceux", "chose", "comme",
      "comment", "contre", "d'un", "d'une", "dans", "déjà", "depuis", "deux", "devant", "donc", "dont",
      "elle", "elles", "encore", "entre", "être", "était", "étaient", "faire", "fait", "j'ai", "jamais",
      "jusqu'à", "l'autre", "leur", "leurs", "lorsque", "mais", "même", "moins", "n'est", "n'était",
      "nous", "parce", "pendant", "peut", "plus", "pour", "pourquoi", "pouvait", "puis", "qu'elle",
      "qu'il", "qu'on", "quand", "quelqu'un", "quelque", "quelques", "quoi", "rien", "s'il", "sans",
      "serait", "sont", "sous", "tandis", "toujours", "tous", "tout", "toute", "toutes", "très", "vers",
      "voulait", "votre", "vous", "aurait", "fallait"
    ],

    phraseStopwords: [
      "a", "à", "au", "aux", "avec", "c'est", "c'était", "ce", "d'un", "d'une", "dans", "de", "des", "du",
      "elle", "en", "est", "et", "était", "il", "j'ai", "je", "la", "le", "les", "leur", "lui", "ma", "mais",
      "me", "mes", "mon", "n'est", "ne", "nous", "on", "ou", "par", "pas", "pour", "qu'elle", "qu'il",
      "que", "qui", "s'il", "sa", "se", "ses", "son", "sur", "ta", "te", "tu", "un", "une", "vous", "y"
    ],

    // story voices. Fit and reprit are among the commonest French tags.
    speechVerbs: [
      "dit", "dis", "demanda", "demande", "demandai", "répondit", "répond", "répondis", "fit", "reprit",
      "murmura", "murmure", "chuchota", "susurra", "marmonna", "cria", "crie", "hurla", "s'écria",
      "s'exclama", "ajouta", "ajoute", "expliqua", "insista", "poursuivit", "continua", "lança", "souffla",
      "appela", "admit", "avoua", "exigea", "ordonna", "déclara", "répliqua", "rétorqua"
    ],

    // On is left out, as English leaves out "you": "on dit" is narration.
    speechPronouns: ["il", "elle", "ils", "elles", "je", "nous"],

    voiceStopwords: [
      "alors", "aussi", "avec", "avoir", "bien", "c'est", "cela", "ceci", "cette", "comme", "dans", "dire",
      "elle", "encore", "est-ce", "était", "être", "faire", "fait", "faut", "j'ai", "j'en", "leur", "mais",
      "m'a", "n'est", "nous", "parce", "peut", "peux", "plus", "pour", "qu'est-ce", "qu'il", "quand",
      "quoi", "rien", "sais", "sont", "suis", "tout", "très", "vais", "veux", "voilà", "vous", "êtes",
      "votre", "juste", "vraiment"
    ],

    // Sentence splitting: M. Dupont, Mme Roux, and Dr Morel never end a
    // sentence (M. is an initial); etc. and p. may.
    // av. and apr. come before J.-C., which may end a sentence.
    titleAbbreviations: ["Mme", "Mmes", "Mlle", "Mlles", "MM", "Me", "Dr", "Pr", "St", "Ste", "Mgr", "cf", "env", "av", "apr"],
    contextAbbreviations: ["etc", "chap", "vol", "n°", "J.-C"],

    // Written in lower case in French, so only a capitalised one at the
    // start of a sentence could pass for a name.
    calendarWords: [
      "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche",
      "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre",
      "Novembre", "Décembre"
    ],

    // story import.
    chapterWords: ["chapitre"],
    sectionWords: ["prologue", "épilogue", "interlude", "postface"],
    partWords: ["partie", "livre"],
    frontMatterWords: ["prologue", "préface", "avant-propos", "introduction", "prélude"],

    // Spelled-out chapter numbers ("Chapitre vingt et un", "Chapitre
    // quatre-vingt-dix-sept", "Chapitre premier"); see wordNumeral in
    // ../import.js.
    numberWords: {
      words: [
        "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze",
        "treize", "quatorze", "quinze", "seize", "vingt", "vingts", "trente", "quarante", "cinquante",
        "soixante", "cent", "cents", "premier", "première",
        // Belgian and Swiss French.
        "septante", "huitante", "octante", "nonante"
      ],
      joiners: ["et"]
    },
    // Ordinals that may come before the heading word (Première partie).
    ordinalWords: [
      "premier", "première", "deuxième", "second", "seconde", "troisième", "quatrième", "cinquième",
      "sixième", "septième", "huitième", "neuvième", "dixième", "onzième", "douzième"
    ],

    candidateStopwords: [
      "À", "Alors", "Après", "Au", "Aux", "Avec", "Ce", "Cela", "Ces", "Cette", "Comme", "Dans", "De", "Des",
      "Docteur", "Dr", "Du", "Elle", "Elles", "En", "Enfin", "Et", "Il", "Ils", "Je", "La", "Le", "Les",
      "Leur", "Lui", "Ma", "Madame", "Mademoiselle", "Mais", "Maître", "Me", "Mes", "Mlle", "Mme", "Moi",
      "Mon", "Monsieur", "Ne", "Ni", "Non", "Nous", "On", "Or", "Ou", "Oui", "Par", "Pas", "Pendant", "Pour",
      "Pourquoi", "Puis", "Qu'elle", "Qu'il", "Quand", "Que", "Qui", "Quoi", "Sa", "Sans", "Se", "Ses", "Si",
      "Son", "Sur", "Ta", "Toi", "Ton", "Tout", "Tu", "Un", "Une", "Vous", "Y"
    ],

    titleWords: [
      "le", "la", "les", "un", "une", "de", "du", "monsieur", "madame", "mademoiselle", "m", "mme", "mlle",
      "dr", "docteur", "maître", "me", "roi", "reine", "prince", "princesse", "duc", "duchesse", "comte",
      "comtesse", "baron", "baronne", "marquis", "marquise", "capitaine", "général", "colonel",
      "commandant", "sergent", "lieutenant", "père", "mère", "frère", "sœur", "soeur", "oncle", "tante",
      "saint", "sainte", "st", "ste", "professeur", "prof", "sire", "dame", "seigneur", "messire", "abbé",
      "vieux", "vieille", "petit", "petite", "jeune"
    ]
  }
};

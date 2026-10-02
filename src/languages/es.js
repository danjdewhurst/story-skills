// Spanish. Dialogue is set with the base pack's em dash (—Ya voy —dijo
// ella—.) or with «…» and “…” quotes, all of which the base pack has.
//
// Build labels and narration pace come first, then the word lists.
//
// Verbs are listed in the forms fiction uses for tags and narration: the
// preterite and imperfect, third and first person singular (dijo, dije,
// decía). Choices that differ from English:
// - Adverbs: a manner adverb ends in -mente (lentamente), so that is the
//   suffix, with the -mente words that are not adverbs as exceptions, and
//   `adverbBlockers` for the words before a noun or subjunctive (la mente,
//   se lamente). Que and lo also come before adverbs, so they are not.
// - Headings: an ordinal may come before the heading word (Primera
//   parte), in `ordinalWords`.
// - No dialectPairs: the British and American pairs are English. Record a
//   Spanish variant's spellings as style-sheet `preferred` entries.
// - No contractionSuffixes or contractedIs: al and del are compulsory, so
//   they say nothing about how formal a voice is, and Spanish marks
//   dropped sounds (pa', to') too rarely for a count. The contraction count
//   is skipped. No elisions either: no word opens with an apostrophe.

// Ordinals, masculine and feminine: a chapter number after the heading
// word (Capítulo primero), or before it (Primera parte).
const ORDINALS = [
  "primero", "primera", "primer", "segundo", "segunda", "tercero", "tercera", "tercer", "cuarto", "cuarta",
  "quinto", "quinta", "sexto", "sexta", "séptimo", "séptima", "octavo", "octava", "noveno", "novena",
  "décimo", "décima", "undécimo", "undécima", "duodécimo", "duodécima"
];

export default {
  code: "es",
  name: "Spanish",
  // Any capital before a full stop is an initial (É. Zola, Á. Pérez).
  capitalInitials: true,
  narrationRate: 150,
  labels: {
    chapter: "Capítulo {n}",
    "chapter-heading": "{chapter}: {title}",
    contents: "Índice",
    and: "{a} y {b}",
    copyright: "Derechos de autor",
    "all-rights-reserved": "Todos los derechos reservados.",
    "published-by": "Publicado por {publisher}",
    "scene-break": "Cambio de escena",
    "cover-alt": "Portada de {title}",
    "start-of-content": "Inicio del contenido",
    "accessibility-summary": "Libro solo de texto con un índice navegable, encabezados para cada capítulo y un único orden de lectura lógico.",
    "accessibility-summary-cover": "Libro con texto e imagen de portada descrita, con un índice navegable, encabezados para cada capítulo y un único orden de lectura lógico.",
    "review-title": "{title}: copia de revisión",
    "review-intro": "Copia de revisión.",
    "review-intro-build": "Copia de revisión, versión {build}.",
    "review-labels": "Cada párrafo tiene una etiqueta como {label} (capítulo 3, párrafo 12).",
    "review-quote": "Cite la etiqueta en cada nota, junto con las primeras palabras del párrafo, para que el autor encuentre el lugar exacto aunque el texto cambie.",
    "review-quote-build": "Cite la etiqueta y la versión en cada nota, junto con las primeras palabras del párrafo, para que el autor encuentre el lugar exacto aunque el texto cambie.",
    "review-note-link": "El enlace Nota junto a cada etiqueta abre una nota con estos datos ya rellenados.",
    note: "Nota",
    "note-title": "Escribir una nota sobre {label}",
    "anchor-title": "Enlace a {label}",
    by: "por",
    "approximate-words": "Aproximadamente {words} palabras",
    "approximate-characters": "Aproximadamente {characters} caracteres",
    "narration-opening": "{title}. Escrito por {authors}. Narrado por {narrator}.",
    "narration-opening-anonymous": "{title}. Narrado por {narrator}.",
    "narration-closing": "Fin. Ha escuchado {title}, escrito por {authors}, narrado por {narrator}.",
    "narration-closing-anonymous": "Fin. Ha escuchado {title}, narrado por {narrator}.",
    "screenplay-credit": "Escrito por",
    "screenplay-source": "Basado en la obra de {authors}",
    "screenplay-source-anonymous": "Basado en la obra original"
  },
  checks: {
    filterWords: [
      "sintió", "sentía", "sentí", "vio", "veía", "vi", "oyó", "oía", "oí", "escuchó", "escuchaba",
      "notó", "notaba", "noté", "advirtió", "advertía", "percibió", "percibía", "pareció", "parecía",
      "observó", "observaba", "supo", "sabía", "supe", "decidió", "decidí", "pensó", "pensaba", "pensé",
      "creyó", "creía", "comprendió", "comprendía", "comprendí", "recordó", "recordaba"
    ],

    // Tags that replace "dijo" with an action or a manner. Spanish tags
    // range wider than English ones (replicó and repuso are plain), so only
    // the verbs no one can say a line with are here; susurró, gritó, and
    // masculló describe volume and are left out, as in English.
    saidBookisms: [
      "bramó", "bufó", "chilló", "declaró", "espetó", "exclamó", "gimió", "gruñó", "inquirió",
      "jadeó", "ladró", "refunfuñó", "resopló", "rezongó", "rio", "rió", "rugió", "sentenció",
      "siseó", "sollozó", "sonrió", "suspiró", "bromeó", "ronroneó", "aseveró", "graznó"
    ],

    plainTags: ["dijo", "dice", "dije", "dijeron", "preguntó", "pregunta", "pregunté", "preguntaron"],

    beatPronouns: ["él", "ella", "ellos", "ellas", "yo", "nosotros", "nosotras", "usted", "tú"],

    adverbSuffixes: ["mente"],
    adverbLabel: "-mente adverbs",
    // The noun mente and its compounds, adjectives in -mente, and
    // subjunctives of verbs in -mentar (que lamente).
    adverbExceptions: [
      "mente", "demente", "clemente", "inclemente", "vehemente",
      "alimente", "argumente", "atormente", "aumente", "cimente", "comente", "complemente",
      "documente", "experimente", "fomente", "fragmente", "implemente", "incremente", "lamente",
      "segmente", "sedimente", "fermente", "ornamente", "pigmente", "reglamente", "suplemente",
      "condimente", "cumplimente", "parlamente", "pavimente"
    ],

    // Words after which a word in -mente is not an adverb: articles,
    // possessives, and demonstratives (la mente, su mente), and object
    // pronouns before a subjunctive (se lamente). Que and lo come before
    // adverbs too (que finalmente, lo realmente importante), so the
    // subjunctives they introduce are exceptions instead.
    adverbBlockers: [
      "el", "la", "los", "las", "un", "una", "unos", "unas", "mi", "tu", "su", "mis", "tus", "sus",
      "nuestra", "vuestra", "esa", "esta", "aquella", "se", "me", "te", "le", "les", "nos", "os"
    ],

    echoStopwords: [
      "ahora", "algo", "alguien", "allí", "antes", "aquel", "aquella", "aquello", "aquí", "aunque",
      "bien", "cada", "casi", "como", "cómo", "contra", "cuando", "cuándo", "debía", "desde", "después",
      "donde", "dónde", "durante", "ellas", "ellos", "entonces", "entre", "eran", "estaba", "estaban",
      "estar", "estas", "este", "esta", "esto", "estos", "fueron", "había", "habían", "hacia", "hasta",
      "mientras", "misma", "mismo", "mucha", "mucho", "muchos", "nada", "nadie", "nunca", "otra", "otras",
      "otro", "otros", "para", "pero", "poco", "podía", "porque", "pudo", "puede", "quería", "sido",
      "siempre", "sobre", "solo", "sólo", "también", "tanto", "tenía", "tenían", "toda", "todas", "todavía",
      "todo", "todos", "tras", "unas", "unos"
    ],

    phraseStopwords: [
      "a", "al", "como", "con", "de", "del", "el", "él", "ella", "ellas", "ellos", "en", "era", "es",
      "esa", "ese", "eso", "esta", "este", "esto", "fue", "ha", "había", "la", "las", "le", "les", "lo",
      "los", "me", "mi", "mis", "más", "muy", "ni", "no", "nos", "o", "para", "pero", "por", "que", "qué",
      "se", "si", "sí", "sin", "su", "sus", "te", "tu", "tus", "un", "una", "uno", "y", "ya", "yo"
    ],

    // story voices.
    speechVerbs: [
      "dijo", "dice", "dije", "decía", "preguntó", "pregunta", "pregunté", "preguntaba",
      "respondió", "responde", "contestó", "contesta", "replicó", "repuso", "susurró", "susurra",
      "gritó", "grita", "murmuró", "murmura", "masculló", "exclamó", "añadió", "añade", "explicó",
      "insistió", "continuó", "prosiguió", "siguió", "llamó", "admitió", "exigió", "ordenó"
    ],

    // Spanish often drops the pronoun (—Ven —dijo.), so most tags name the
    // speaker or no one. Usted and tú are left out, as English leaves out
    // "you".
    speechPronouns: ["él", "ella", "ellos", "ellas", "yo", "nosotros", "nosotras"],

    voiceStopwords: [
      "ahora", "algo", "aquí", "bien", "cómo", "como", "cuando", "decir", "dijo", "eres", "esta", "está",
      "estás", "este", "esto", "hacer", "hasta", "nada", "para", "pero", "porque", "puedo", "puede",
      "quiero", "sabes", "solo", "sólo", "también", "tengo", "tiene", "todo", "usted", "vamos", "verdad",
      "favor", "entonces", "nunca", "siempre", "mucho", "ella", "ellos", "estoy", "creo", "sobre"
    ],

    // Sentence splitting: Sr. García and Dña. Elvira never end a sentence;
    // etc. and núm. may. Single letters (p. ej., a. m.) are initials.
    titleAbbreviations: ["Sr", "Sra", "Srta", "Dr", "Dra", "Dña", "Ud", "Uds", "Vd", "Vds", "Lic", "Ing", "Prof", "Profa", "Sto", "Sta", "Gral", "Cap", "Excmo", "Excma", "Ilmo", "Mons", "Fr", "ej", "EE"],
    // UU. closes EE. UU., which may end a sentence.
    contextAbbreviations: ["etc", "núm", "pág", "aprox", "vs", "a.m", "p.m", "a. m", "p. m", "UU"],

    // Written in lower case in Spanish, so only a capitalised one at the
    // start of a sentence could pass for a name.
    calendarWords: [
      "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo",
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Setiembre",
      "Octubre", "Noviembre", "Diciembre"
    ],

    // story import.
    // Written without accents too, as plain-text drafts often are.
    chapterWords: ["capítulo", "capitulo"],
    sectionWords: ["prólogo", "prologo", "epílogo", "epilogo", "interludio", "posfacio"],
    partWords: ["parte"],
    frontMatterWords: ["prólogo", "prologo", "prefacio", "introducción", "introduccion", "preludio", "preámbulo"],

    // Spelled-out chapter numbers ("Capítulo veintiuno", "Capítulo treinta
    // y dos", "Capítulo primero"), as words joined by a space, a hyphen, or
    // a joiner; see wordNumeral in ../import.js.
    numberWords: {
      words: [
        "uno", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
        "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "dieciseis", "diecisiete", "dieciocho", "diecinueve",
        "veinte", "veintiuno", "veintidós", "veintidos", "veintitrés", "veintitres", "veinticuatro", "veinticinco",
        "veintiséis", "veintiseis", "veintisiete", "veintiocho", "veintinueve",
        "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa",
        "cien", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos",
        "setecientos", "ochocientos", "novecientos",
        ...ORDINALS
      ],
      joiners: ["y"]
    },
    // Ordinals that may come before the heading word (Primera parte).
    ordinalWords: ORDINALS,

    candidateStopwords: [
      "A", "Al", "Allí", "Ahora", "Aquí", "Así", "Como", "Cómo", "Con", "Cuando", "De", "Del", "Desde",
      "Después", "Don", "Doña", "Donde", "Dónde", "Dr", "Dra", "El", "Él", "Ella", "Ellas", "Ellos", "En",
      "Entonces", "Era", "Es", "Esa", "Ese", "Eso", "Esta", "Este", "Esto", "Fue", "Hasta", "La", "Las",
      "Le", "Lo", "Los", "Mi", "Mientras", "Muy", "Nada", "Nadie", "No", "Nos", "Nosotros", "Nunca", "O",
      "Para", "Pero", "Por", "Porque", "Que", "Qué", "Quién", "Se", "Señor", "Señora", "Señorita", "Si",
      "Sí", "Sin", "Sobre", "Sr", "Sra", "Srta", "Su", "Sus", "También", "Todo", "Tras", "Tú", "Un", "Una",
      "Usted", "Y", "Ya", "Yo"
    ],

    titleWords: [
      "el", "la", "los", "las", "un", "una", "de", "del", "don", "doña", "señor", "señora", "señorita", "sr",
      "sra", "srta", "dr", "dra", "doctor", "doctora", "rey", "reina", "príncipe", "princesa", "duque",
      "duquesa", "conde", "condesa", "marqués", "marquesa", "barón", "baronesa", "capitán", "capitana",
      "general", "coronel", "comandante", "sargento", "teniente", "padre", "madre", "fray", "sor",
      "hermano", "hermana", "tío", "tía", "san", "santo", "santa", "profesor", "profesora", "maestro",
      "maestra", "viejo", "vieja", "joven", "pequeño", "pequeña"
    ]
  }
};

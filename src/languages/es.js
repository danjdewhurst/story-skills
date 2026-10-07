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
    byline: "por {names}",
    "edited-by": "Edición de {names}",
    "approximate-words": "Aproximadamente {words} palabras",
    "approximate-characters": "Aproximadamente {characters} caracteres",
    "narration-opening": "{title}. Escrito por {authors}. Narrado por {narrator}.",
    "narration-opening-anonymous": "{title}. Narrado por {narrator}.",
    "narration-closing": "Fin. Ha escuchado {title}, escrito por {authors}, narrado por {narrator}.",
    "narration-closing-anonymous": "Fin. Ha escuchado {title}, narrado por {narrator}.",
    "narration-byline": "Escrito por {names}.",
    "narration-edited-by": "Edición de {names}.",
    "narration-contributors": "Con contribuciones de {names}.",
    "screenplay-credit": "Escrito por",
    "screenplay-source": "Basado en la obra de {authors}",
    "screenplay-source-anonymous": "Basado en la obra original",
    // The codex (`build --format codex`), the story bible site: its page
    // and section names, the kinds of entity, and the headings, table
    // columns, and notes on its pages.
    "codex-story-bible": "Biblia de la historia",
    "codex-index-title": "{title}: biblia de la historia",
    "codex-timeline": "Cronología",
    "codex-threads": "Tramas y pistas",
    "codex-progress": "Progreso",
    "codex-characters": "Personajes",
    "codex-locations": "Lugares",
    "codex-factions": "Facciones",
    "codex-artifacts": "Artefactos",
    "codex-systems": "Sistemas",
    "codex-arcs": "Arcos",
    "codex-character": "Personaje",
    "codex-location": "Lugar",
    "codex-faction": "Facción",
    "codex-artifact": "Artefacto",
    "codex-system": "Sistema",
    "codex-arc": "Arco",
    "codex-chapters": "Capítulos",
    "codex-scenes": "Escenas",
    "codex-questions": "Preguntas",
    "codex-promises": "Promesas",
    "codex-clues": "Pistas",
    "codex-note-spoilers": "Biblia de la historia con revelaciones de la trama: notas de las entidades, estados, muertes, conocimientos, pistas y la resolución de cada trama.",
    "codex-note-safe": "Biblia de la historia sin revelaciones de la trama: quién y qué aparece en la historia, y dónde. Se omiten notas, estados, muertes, conocimientos, pistas y resoluciones; genérela con {flag} para obtener la biblia completa.",
    "codex-no-entities": "Aún no hay personajes, lugares ni otras entidades.",
    "codex-relationships": "Relaciones",
    "codex-appears-in": "Aparece en",
    "codex-advanced-in": "Avanza en",
    "codex-linked-from": "Mencionado en",
    "codex-changes": "Cambios",
    "codex-change": "Desde {chapter}: {field} pasa a ser {value}",
    "codex-knows": "Sabe",
    "codex-known-from-start": "sabido desde el principio",
    "codex-learned-in": "descubierto en {chapter}",
    "codex-notes": "Notas",
    "codex-role": "Papel",
    "codex-aliases": "Alias",
    "codex-status": "Estado",
    "codex-dies-in": "Muere en",
    "codex-revived-in": "Revive en",
    "codex-type": "Tipo",
    "codex-region": "Región",
    "codex-setting": "Ambientación",
    "codex-notable-characters": "Personajes destacados",
    "codex-routes": "Rutas",
    "codex-hours": "{hours} h",
    "codex-members": "Miembros",
    "codex-owner": "Propietario",
    "codex-themes": "Temas",
    "codex-pronunciation": "Pronunciación",
    "codex-date": "Fecha",
    "codex-time": "Hora",
    "codex-scene": "Escena",
    "codex-chapter": "Capítulo",
    "codex-pov": "PDV",
    "codex-told-late": "narrado fuera de orden",
    "codex-flashback": "retrospectiva: {date}",
    "codex-no-dates": "Aún no hay escenas ni capítulos con fecha. Dé a las escenas un campo {field} para situarlas en el tiempo de la historia.",
    "codex-timeline-note": "Los acontecimientos en el orden cronológico de la historia, tal como los lista {command}.",
    "codex-undated": "Sin fecha",
    "codex-point-of-view": "Punto de vista",
    "codex-words": "Palabras",
    "codex-share": "Porcentaje",
    "codex-unspecified": "sin especificar",
    "codex-presence": "Presencia",
    "codex-first": "Primero",
    "codex-last": "Último",
    "codex-longest-gap": "Mayor ausencia",
    "codex-death": "Muerte",
    "codex-dies-in-chapter": "muere en el capítulo {n}",
    "codex-threads-note": "Solo preguntas abiertas y promesas, sin sus respuestas ni su cumplimiento. Las pistas y las tramas resueltas requieren {flag}.",
    "codex-none": "Ninguna.",
    "codex-question": "Pregunta",
    "codex-raised-in": "Planteada en",
    "codex-resolved-in": "Resuelta en",
    "codex-promise": "Promesa",
    "codex-planted-in": "Sembrada en",
    "codex-paid-off-in": "Cumplida en",
    "codex-clue": "Pista",
    "codex-clues-note": "P marca el capítulo que siembra una pista, R el que la revela y x ambos, tal como los muestra {command}.",
    "codex-clue-totals-one": "Pistas sembradas: {planted} de {total}; reveladas: {revealed}; pista falsa: {herrings}.",
    "codex-clue-totals": "Pistas sembradas: {planted} de {total}; reveladas: {revealed}; pistas falsas: {herrings}.",
    "codex-red-herring": "pista falsa",
    "codex-significance-delayed": "importancia revelada más tarde",
    "codex-total-words": "Total de palabras",
    "codex-total-characters": "Total de caracteres",
    "codex-target-words": "Objetivo de palabras",
    "codex-target-characters": "Objetivo de caracteres",
    "codex-done": "Completado",
    "codex-remaining": "Pendiente",
    "codex-deadline": "Fecha límite",
    "codex-target": "Objetivo",
    "codex-character-count": "Caracteres",
    "codex-plot-grid": "Cuadrícula de tramas",
    "codex-grid-note": "Arcos por capítulo, tal como los muestra {command}: x donde un capítulo o una de sus escenas hace avanzar el arco.",
    "codex-unknown": "desconocido",
    "codex-beat": "Momento clave",
    "codex-hook": "Gancho",
    "codex-outcomes": "Resultados",
    "codex-session-log": "Registro de sesiones"
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

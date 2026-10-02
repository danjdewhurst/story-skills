// The English language pack. Every word list the analysis commands use for
// English lives here, as plain data, so the bundled Node fallback carries it
// and another language can supply its own lists under the same names. A
// list a pack leaves out turns its check off for that language rather than
// running it with English words; see ./index.js.

export default {
  code: "en",
  name: "English",
  script: "Latn",
  checks: {
    // story prose: narration verbs that filter a scene through a character.
    filterWords: [
      "felt", "saw", "heard", "noticed", "realized", "realised", "wondered",
      "seemed", "watched", "knew", "decided", "thought", "sensed"
    ],

    // Tags that replace "said" with an action or a manner. "whispered",
    // "muttered", and "shouted" are left out on purpose: they describe volume,
    // which "said" cannot.
    saidBookisms: [
      "barked", "bellowed", "breathed", "chuckled", "cooed", "declared", "exclaimed",
      "gasped", "grinned", "groaned", "growled", "grunted", "hissed", "inquired",
      "interjected", "intoned", "laughed", "opined", "purred", "queried", "quipped",
      "retorted", "shrieked", "sighed", "smiled", "smirked", "snapped", "snarled",
      "sneered", "spat", "stated"
    ],

    plainTags: ["said", "asked", "says", "asks"],

    // A capitalised pronoun after a quote ending in ? ! … or a dash starts an
    // action beat, not a tag.
    beatPronouns: ["he", "she", "they", "i", "we", "it", "you"],

    // A word longer than four letters with one of these endings counts as a
    // manner adverb, unless it is an exception.
    adverbSuffixes: ["ly"],
    // What the report calls those adverbs.
    adverbLabel: "-ly adverbs",

    // Words ending in -ly that are not manner adverbs.
    adverbExceptions: [
      "ally", "anomaly", "apply", "assembly", "belly", "bully", "burly", "butterfly",
      "chilly", "comply", "costly", "curly", "daily", "deadly", "dolly", "dragonfly",
      "early", "elderly", "family", "fly", "folly", "friendly", "ghastly", "ghostly",
      "gully", "holly", "holy", "homely", "hourly", "imply", "italy", "jelly", "jolly",
      "july", "lily", "likely", "lively", "lonely", "lovely", "melancholy", "monopoly",
      "monthly", "multiply", "oily", "only", "orderly", "prickly", "rally", "rely",
      "reply", "sickly", "silly", "sly", "smelly", "stately", "supply", "surly",
      "tally", "ugly", "unlikely", "weekly", "wobbly", "woolly", "yearly"
    ],

    // Common words long enough to pass the echo length floor but too frequent
    // to count as an echo.
    echoStopwords: [
      "about", "above", "after", "again", "against", "along", "always", "among",
      "another", "around", "because", "before", "behind", "being", "below", "between",
      "could", "couldn't", "didn't", "doesn't", "don't", "every", "first", "hadn't",
      "haven't", "isn't", "might", "never", "other", "right", "should", "since",
      "something", "still", "their", "there", "these", "thing", "things", "those",
      "though", "three", "through", "until", "wasn't", "where", "which", "while",
      "without", "would", "wouldn't", "you're", "they're", "we're"
    ],

    // Function words: a repeated phrase made only of these is not reported.
    phraseStopwords: [
      "a", "an", "and", "as", "at", "be", "but", "by", "for", "from", "had", "has",
      "have", "he", "her", "his", "i", "in", "into", "is", "it", "its", "me", "my",
      "not", "of", "on", "or", "she", "so", "that", "the", "their", "them", "then",
      "they", "this", "to", "was", "we", "were", "with", "you"
    ],

    // [british, american] pairs, including the common inflections, flagged by
    // the style sheet's dialect. -ise/-ize is left out because British
    // publishers use both; record that choice as a preferred entry instead.
    dialectPairs: [
      ["armour", "armor"], ["armoured", "armored"],
      ["centre", "center"], ["centres", "centers"], ["centred", "centered"],
      ["colour", "color"], ["colours", "colors"], ["coloured", "colored"], ["colourful", "colorful"],
      ["defence", "defense"], ["defences", "defenses"],
      ["favour", "favor"], ["favours", "favors"], ["favoured", "favored"], ["favourite", "favorite"],
      ["grey", "gray"], ["greying", "graying"],
      ["harbour", "harbor"], ["harbours", "harbors"],
      ["honour", "honor"], ["honours", "honors"], ["honoured", "honored"], ["honourable", "honorable"],
      ["jewellery", "jewelry"],
      ["labour", "labor"],
      ["mould", "mold"], ["mouldy", "moldy"],
      ["neighbour", "neighbor"], ["neighbours", "neighbors"],
      ["odour", "odor"],
      ["offence", "offense"],
      ["plough", "plow"],
      ["rumour", "rumor"], ["rumours", "rumors"],
      ["sceptic", "skeptic"], ["sceptical", "skeptical"],
      ["smoulder", "smolder"], ["smouldering", "smoldering"],
      ["theatre", "theater"],
      ["towards", "toward"],
      ["travelled", "traveled"], ["travelling", "traveling"], ["traveller", "traveler"],
      ["cancelled", "canceled"],
      ["vapour", "vapor"],
      ["whisky", "whiskey"]
    ],

    // story voices: verbs that tag speech.
    speechVerbs: [
      "said", "says", "asked", "asks", "replied", "replies", "answered", "answers",
      "whispered", "whispers", "shouted", "shouts", "called", "calls", "muttered",
      "mutters", "murmured", "murmurs", "cried", "cries", "yelled", "yells",
      "added", "adds", "told", "tells", "snapped", "snaps", "admitted", "admits",
      "insisted", "insists", "demanded", "demands", "continued", "continues",
      "began", "begins", "went on", "goes on"
    ],

    // Personal pronouns that tag speech; "it" and "you" are left out because
    // "It went on raining" is narration, not a tag.
    speechPronouns: ["he", "she", "they", "i", "we"],

    // Contraction endings, written with a straight apostrophe (a curly one
    // matches too) and counted after a letter: "don't", "we're".
    contractionSuffixes: ["n't", "'re", "'ll", "'ve", "'m", "'d"],

    // 's is counted only after words where it cannot be a possessive (it's,
    // that's, let's), so "Tom's" is never a contraction.
    contractedIs: ["it", "that", "let", "what", "there", "here", "where", "who", "he", "she", "how", "when", "why"],

    // Words that open with an apostrophe rather than a single quote.
    elisions: ["em", "tis", "twas", "cause", "cos", "til", "till", "bout", "round", "n", "nuff"],

    // Common words that say nothing about a voice.
    voiceStopwords: [
      "that", "this", "with", "have", "what", "from", "they", "there", "their", "them",
      "then", "than", "were", "would", "could", "should", "your", "yours", "just",
      "know", "been", "will", "when", "where", "which", "about", "into", "some",
      "because", "want", "like", "only", "here", "does", "didn't", "don't", "it's",
      "can't", "won't", "i'm", "you're", "we're", "that's", "there's", "what's",
      "going", "come", "back", "over", "tell", "said", "more", "very", "also"
    ],

    // Sentence splitting: words that end in a full stop without ending the
    // sentence. Titles never end one (Dr. Hale); context abbreviations (etc.,
    // No., a.m.) end it unless the next word starts in lower case, with a
    // digit, or is a calendar word (No. 5, 9 a.m. Monday).
    titleAbbreviations: ["Dr", "Mr", "Mrs", "Ms", "St", "Mt", "Jr", "Sr", "Prof", "Capt", "Gen", "Col", "Lt", "Sgt", "Rev", "Fr", "e.g", "i.e"],
    contextAbbreviations: ["No", "vs", "etc", "a.m", "p.m"],

    // Days and months: capitalised, but never names.
    calendarWords: [
      "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
      "January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
      "November", "December"
    ],

    // story import: the heading words that start a chapter, a section that
    // is a chapter in its own right but carries no number, and a part.
    chapterWords: ["chapter"],
    sectionWords: ["prologue", "epilogue", "interlude", "afterword"],
    partWords: ["part"],
    // Unnumbered source files with these names sort before the numbered ones.
    frontMatterWords: ["prologue", "preface", "foreword", "introduction", "prelude"],

    // Spelled-out chapter numbers up to nine hundred and ninety-nine
    // ("Chapter Twenty-One", "Chapter One Hundred and Two").
    numberWords: {
      units: ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"],
      teens: ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"],
      tens: ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"],
      hundred: "hundred",
      and: "and"
    },

    // Capitalised words that are not names, for import's entity candidates.
    // The calendar words are added to these.
    candidateStopwords: [
      "A", "An", "And", "At", "But", "By", "Dr", "For", "He", "Her", "His", "I", "If", "In", "It", "Its",
      "Mr", "Mrs", "Ms", "No", "Not", "Of", "On", "Or", "She", "That", "The", "Then", "They", "Their",
      "This", "To", "We", "When", "While", "With", "Yes", "You"
    ],

    // Leading words that are titles or articles, not names: "Lord Maren" is
    // known as Maren, and "The Iron Lord" should not make every "The..." name
    // a look-alike.
    titleWords: [
      "the", "a", "an", "lord", "lady", "sir", "dame", "dr", "doctor", "mr", "mrs", "ms", "miss",
      "master", "mistress", "captain", "capt", "king", "queen", "prince", "princess", "duke", "duchess",
      "count", "countess", "baron", "baroness", "father", "mother", "sister", "brother", "uncle", "aunt",
      "councillor", "councilor", "general", "colonel", "major", "sergeant", "lieutenant", "commander",
      "professor", "prof", "saint", "st", "old", "young", "little"
    ]
  }
};

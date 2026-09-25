import { escapeRegExp, scanComments, splitWords, withoutFencedCode } from "./markdown.js";
import { quoteMatches, replaceQuotes } from "./voices.js";

// Deterministic prose checks for `story prose`. Everything here is counting:
// no scoring, no rewriting. Thresholds only decide which counts are raised as
// warnings; the full counts are always reported so the writer can judge.

const FILTER_WORDS = [
  "felt", "saw", "heard", "noticed", "realized", "realised", "wondered",
  "seemed", "watched", "knew", "decided", "thought", "sensed"
];

// Tags that replace "said" with an action or a manner. "whispered",
// "muttered", and "shouted" are left out on purpose: they describe volume,
// which "said" cannot.
const SAID_BOOKISMS = [
  "barked", "bellowed", "breathed", "chuckled", "cooed", "declared", "exclaimed",
  "gasped", "grinned", "groaned", "growled", "grunted", "hissed", "inquired",
  "interjected", "intoned", "laughed", "opined", "purred", "queried", "quipped",
  "retorted", "shrieked", "sighed", "smiled", "smirked", "snapped", "snarled",
  "sneered", "spat", "stated"
];

const PLAIN_TAGS = ["said", "asked", "says", "asks"];

// Words ending in -ly that are not manner adverbs.
const NOT_ADVERBS = new Set([
  "ally", "anomaly", "apply", "assembly", "belly", "bully", "burly", "butterfly",
  "chilly", "comply", "costly", "curly", "daily", "deadly", "dolly", "dragonfly",
  "early", "elderly", "family", "fly", "folly", "friendly", "ghastly", "ghostly",
  "gully", "holly", "holy", "homely", "hourly", "imply", "italy", "jelly", "jolly",
  "july", "lily", "likely", "lively", "lonely", "lovely", "melancholy", "monopoly",
  "monthly", "multiply", "oily", "only", "orderly", "prickly", "rally", "rely",
  "reply", "sickly", "silly", "sly", "smelly", "stately", "supply", "surly",
  "tally", "ugly", "unlikely", "weekly", "wobbly", "woolly", "yearly"
]);

// Common words long enough to pass the echo length floor but too frequent to
// count as an echo.
const ECHO_STOPWORDS = new Set([
  "about", "above", "after", "again", "against", "along", "always", "among",
  "another", "around", "because", "before", "behind", "being", "below", "between",
  "could", "couldn't", "didn't", "doesn't", "don't", "every", "first", "hadn't",
  "haven't", "isn't", "might", "never", "other", "right", "should", "since",
  "something", "still", "their", "there", "these", "thing", "things", "those",
  "though", "three", "through", "until", "wasn't", "where", "which", "while",
  "without", "would", "wouldn't", "you're", "they're", "we're"
]);

const PHRASE_STOPWORDS = new Set([
  "a", "an", "and", "as", "at", "be", "but", "by", "for", "from", "had", "has",
  "have", "he", "her", "his", "i", "in", "into", "is", "it", "its", "me", "my",
  "not", "of", "on", "or", "she", "so", "that", "the", "their", "them", "then",
  "they", "this", "to", "was", "we", "were", "with", "you"
]);

// [british, american] pairs, including the common inflections, flagged by
// the style sheet's dialect. -ise/-ize is left out because British publishers
// use both; record that choice as a preferred entry instead.
const DIALECT_PAIRS = [
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
];

export const PROSE_THRESHOLDS = {
  filterPerThousand: 10,
  adverbsPerThousand: 12,
  // Rates on a few dozen words swing wildly, so rate warnings need this much
  // narration first.
  minRateWords: 300,
  bookismsPerChapter: 3,
  echoWindow: 30,
  echoMinLength: 5,
  uniformMinSentences: 20,
  uniformSpread: 5,
  phraseLength: 4,
  phraseMinCount: 3,
  phraseLimit: 10
};

export function proseRules(styleData, characterNames) {
  const data = styleData ?? {};
  const allow = new Set(stringList(data["allow-words"]).map((word) => word.toLowerCase()));
  const variants = [];
  for (const entry of Array.isArray(data.preferred) ? data.preferred : []) {
    if (entry && typeof entry.use === "string" && typeof entry.avoid === "string"
      && entry.use.trim() !== "" && entry.avoid.trim() !== "") {
      variants.push({ use: entry.use.trim(), avoid: entry.avoid.trim(), source: "style sheet" });
    }
  }
  const dialect = typeof data.dialect === "string" ? data.dialect : "unspecified";
  if (dialect === "british" || dialect === "american") {
    // A style-sheet entry or allow-word naming either spelling overrides the
    // built-in pair, so "use: toward" in a British book is not flagged twice.
    const claimed = new Set(variants.flatMap((variant) => [variant.use.toLowerCase(), variant.avoid.toLowerCase()]).concat([...allow]));
    for (const [british, american] of DIALECT_PAIRS) {
      const [use, avoid] = dialect === "british" ? [british, american] : [american, british];
      if (!claimed.has(use) && !claimed.has(avoid)) {
        variants.push({ use, avoid, source: `${dialect} dialect` });
      }
    }
  }
  const nameTokens = new Set();
  for (const name of characterNames) {
    for (const token of splitWords(name)) {
      nameTokens.add(token.toLowerCase());
    }
  }
  return {
    allow,
    variants: variants.map((variant) => ({ ...variant, pattern: phrasePattern(variant.avoid) })),
    watch: stringList(data["watch-words"]).map((word) => ({ word, pattern: phrasePattern(word) })),
    filterWords: new Set(FILTER_WORDS.filter((word) => !allow.has(word))),
    bookisms: new Set(SAID_BOOKISMS.filter((word) => !allow.has(word))),
    nameTokens
  };
}

export function analyzeChapter(prose, rules) {
  const paragraphs = proseParagraphs(prose);
  const text = paragraphs.join("\n\n");
  const words = splitWords(text);
  const narration = splitWords(paragraphs.map(stripDialogue).join("\n\n"));
  const sentences = paragraphs.flatMap(splitSentences).map((sentence) => splitWords(sentence).length).filter((count) => count > 0);

  const filterWords = countMatching(narration, (word) => rules.filterWords.has(word));
  const adverbs = countMatching(narration, (word) => isAdverb(word, rules));
  const tags = dialogueTags(paragraphs, rules);

  return {
    words: words.length,
    narrationWords: narration.length,
    sentences: sentenceStats(sentences),
    filterWords,
    adverbs,
    plainTags: tags.plain,
    bookisms: tags.bookisms,
    echoes: echoes(words, rules),
    watch: rules.watch.map(({ word, pattern }) => ({ word, count: countPattern(text, pattern) })).filter((entry) => entry.count > 0),
    variants: rules.variants.map(({ use, avoid, source, pattern }) => ({ use, avoid, source, count: countPattern(text, pattern) })).filter((entry) => entry.count > 0),
    phraseSentences: paragraphs.flatMap(splitSentences).map((sentence) => splitWords(sentence).map((word) => word.toLowerCase()))
  };
}

export function chapterFindings(label, analysis, thresholds = PROSE_THRESHOLDS) {
  const findings = [];
  for (const variant of analysis.variants) {
    findings.push(`${label} uses "${variant.avoid}" ${times(variant.count)}; ${variant.source} prefers "${variant.use}"`);
  }
  const rated = analysis.narrationWords >= thresholds.minRateWords;
  const filterRate = perThousand(total(analysis.filterWords), analysis.narrationWords);
  if (rated && filterRate > thresholds.filterPerThousand) {
    findings.push(`${label} has ${formatRate(filterRate)} filter words per 1,000 narration words (over ${thresholds.filterPerThousand}): ${formatCounts(analysis.filterWords, 5)}`);
  }
  const adverbRate = perThousand(total(analysis.adverbs), analysis.narrationWords);
  if (rated && adverbRate > thresholds.adverbsPerThousand) {
    findings.push(`${label} has ${formatRate(adverbRate)} -ly adverbs per 1,000 narration words (over ${thresholds.adverbsPerThousand}): ${formatCounts(analysis.adverbs, 5)}`);
  }
  const bookisms = total(analysis.bookisms);
  if (bookisms >= thresholds.bookismsPerChapter) {
    findings.push(`${label} has ${bookisms} said-bookism dialogue tags: ${formatCounts(analysis.bookisms, 5)}`);
  }
  const stats = analysis.sentences;
  if (stats.count >= thresholds.uniformMinSentences && stats.spread < thresholds.uniformSpread) {
    findings.push(`${label} sentence lengths are uniform (spread ${formatRate(stats.spread)} words over ${stats.count} sentences); vary the rhythm`);
  }
  return findings;
}

export function repeatedPhrases(analyses, thresholds = PROSE_THRESHOLDS) {
  const counts = new Map();
  const size = thresholds.phraseLength;
  for (const analysis of analyses) {
    for (const sentence of analysis.phraseSentences) {
      for (let index = 0; index + size <= sentence.length; index += 1) {
        const gram = sentence.slice(index, index + size);
        if (gram.every((word) => PHRASE_STOPWORDS.has(word))) {
          continue;
        }
        const key = gram.join(" ");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  // Filter before sorting: a long manuscript has hundreds of thousands of
  // distinct phrases, almost all seen once.
  const repeated = new Map([...counts].filter(([, count]) => count >= thresholds.phraseMinCount));
  return sortCounts(repeated)
    .slice(0, thresholds.phraseLimit)
    .map((entry) => ({ phrase: entry.word, count: entry.count }));
}

// Character first names that a reader could confuse: identical, sharing
// their first three letters, or one or two edits apart.
export function similarNames(characters) {
  const firsts = characters
    .map((character) => ({ id: character.id, name: String(character.name), first: (splitWords(character.name)[0] ?? "").toLowerCase() }))
    .filter((entry) => entry.first.length >= 3)
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  const pairs = [];
  for (let left = 0; left < firsts.length; left += 1) {
    for (let right = left + 1; right < firsts.length; right += 1) {
      const a = firsts[left].first;
      const b = firsts[right].first;
      const limit = Math.min(a.length, b.length) >= 5 ? 2 : 1;
      if (a === b || a.slice(0, 3) === b.slice(0, 3) || editDistance(a, b) <= limit) {
        pairs.push([firsts[left], firsts[right]]);
      }
    }
  }
  return pairs;
}

export function formatProseReport(report) {
  const chapterCount = `${report.chapters.length} ${report.chapters.length === 1 ? "chapter" : "chapters"}`;
  const lines = [`Prose report: ${chapterCount}, ${report.words} words`];
  if (!report.styleSheet) {
    lines.push("No style-sheet.md: spelling and watch-word checks are off");
  }
  for (const chapter of report.chapters) {
    const analysis = chapter.analysis;
    const stats = analysis.sentences;
    lines.push("", `${chapter.file}: ${chapter.title} (${analysis.words} words)`);
    lines.push(`  Sentences: ${stats.count}, average ${formatRate(stats.mean)} words, longest ${stats.longest}, spread ${formatRate(stats.spread)}`);
    lines.push(`  Filter words: ${formatRate(perThousand(total(analysis.filterWords), analysis.narrationWords))} per 1k narration words${countSuffix(analysis.filterWords)}`);
    lines.push(`  -ly adverbs: ${formatRate(perThousand(total(analysis.adverbs), analysis.narrationWords))} per 1k narration words${countSuffix(analysis.adverbs)}`);
    lines.push(`  Dialogue tags: ${formatCounts(analysis.plainTags, 4) || "none plain"}; said-bookisms: ${formatCounts(analysis.bookisms, 5) || "none"}`);
    lines.push(`  Echoes within ${PROSE_THRESHOLDS.echoWindow} words: ${formatCounts(analysis.echoes, 5) || "none"}`);
    if (analysis.watch.length > 0) {
      lines.push(`  Watch words: ${analysis.watch.map((entry) => `${entry.word} ${entry.count}`).join(", ")}`);
    }
    if (analysis.variants.length > 0) {
      lines.push(`  Spelling: ${analysis.variants.map((entry) => `${entry.avoid} ${entry.count} (use ${entry.use})`).join(", ")}`);
    }
  }
  lines.push("", "Manuscript:");
  lines.push(`  Repeated ${PROSE_THRESHOLDS.phraseLength}-word phrases: ${report.phrases.map((entry) => `"${entry.phrase}" ${entry.count}`).join(", ") || "none"}`);
  lines.push(`  Similar character names: ${report.similarNames.map(([a, b]) => `${a.name} / ${b.name}`).join(", ") || "none"}`);
  return `${lines.join("\n")}\n`;
}

// Prose paragraphs without headings, HTML comments, or scene-break rules.
function proseParagraphs(prose) {
  // Fenced code is dropped before paragraphs are joined, as word counts do.
  return withoutFencedCode(scanComments(String(prose), " ").text)
    .split(/\r?\n\s*\r?\n/)
    // Drop heading lines, not the prose that follows one without a blank line.
    .map((paragraph) => paragraph.split(/\r?\n/).filter((line) => !/^\s{0,3}#/.test(line)).join(" "))
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph !== "" && !/^([*_-])( ?\1){2,}$/.test(paragraph));
}

// Splits after . ! ? or … (and up to eight closing quotes, brackets, or
// emphasis marks) before a capital or digit. The look-back is bounded, so
// a run of quote marks stays linear.
function splitSentences(paragraph) {
  const sentences = [];
  let start = 0;
  for (const space of paragraph.matchAll(/\s+/g)) {
    const before = paragraph.slice(Math.max(0, space.index - 9), space.index);
    const after = paragraph.slice(space.index + space[0].length, space.index + space[0].length + 9);
    if (/[.!?…]["'”’)\]*_]{0,8}$/.test(before) && /^["'“‘(*_]{0,8}[\p{Lu}\p{N}]/u.test(after)) {
      sentences.push(paragraph.slice(start, space.index));
      start = space.index + space[0].length;
    }
  }
  sentences.push(paragraph.slice(start));
  return sentences;
}

// Removes quoted speech so narration checks do not count a character's own
// words. Quotes pair as in `story voices` (curly, straight, and British
// single quotes); speech still open at the paragraph end runs to the end.
function stripDialogue(paragraph) {
  let text = replaceQuotes(paragraph);
  // Cut at the first opener with no closer after it, found with index
  // searches so a run of unclosed quotes stays linear.
  const curly = text.indexOf("“", text.lastIndexOf("”") + 1);
  if (curly !== -1) {
    text = text.slice(0, curly);
  }
  const straight = text.indexOf("\"");
  if (straight !== -1) {
    text = text.slice(0, straight);
  }
  const lastSingleClose = text.lastIndexOf("’");
  const single = /(?<![\p{L}\p{N}])‘/u.exec(text.slice(lastSingleClose + 1));
  if (single) {
    text = text.slice(0, lastSingleClose + 1 + single.index);
  }
  return text;
}

function dialogueTags(paragraphs, rules) {
  const plain = new Map();
  const bookisms = new Map();
  for (const paragraph of paragraphs) {
    for (const closing of closingQuoteIndexes(paragraph)) {
      // A tag sits within a few words of the closing quote.
      const after = splitWords(paragraph.slice(closing + 1, closing + 200).split(/[.!?;:“"]/)[0]).slice(0, 3);
      for (const raw of after) {
        const word = raw.toLowerCase();
        if (PLAIN_TAGS.includes(word)) {
          increment(plain, word);
          break;
        }
        if (rules.bookisms.has(word)) {
          increment(bookisms, word);
          break;
        }
      }
    }
  }
  return { plain: sortCounts(plain), bookisms: sortCounts(bookisms) };
}

function closingQuoteIndexes(paragraph) {
  return quoteMatches(paragraph).map((match) => match.end - 1);
}

function isAdverb(word, rules) {
  return word.length > 4 && word.endsWith("ly") && !NOT_ADVERBS.has(word) && !rules.allow.has(word) && !rules.nameTokens.has(word);
}

function echoes(words, rules) {
  const lastSeen = new Map();
  const counts = new Map();
  words.forEach((raw, index) => {
    const word = raw.toLowerCase();
    if (word.length < PROSE_THRESHOLDS.echoMinLength || ECHO_STOPWORDS.has(word) || rules.nameTokens.has(word) || rules.allow.has(word) || /^\p{N}+$/u.test(word)) {
      return;
    }
    if (lastSeen.has(word) && index - lastSeen.get(word) <= PROSE_THRESHOLDS.echoWindow) {
      increment(counts, word);
    }
    lastSeen.set(word, index);
  });
  return sortCounts(counts);
}

function sentenceStats(lengths) {
  if (lengths.length === 0) {
    return { count: 0, mean: 0, longest: 0, spread: 0 };
  }
  const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
  return { count: lengths.length, mean, longest: Math.max(...lengths), spread: Math.sqrt(variance) };
}

function countMatching(words, predicate) {
  const counts = new Map();
  for (const raw of words) {
    const word = raw.toLowerCase();
    if (predicate(word)) {
      increment(counts, word);
    }
  }
  return sortCounts(counts);
}

function phrasePattern(phrase) {
  const body = phrase.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
  // Letter boundaries only, so compounds ("grey-haired") and possessives
  // still count as uses of the word.
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

function countPattern(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

export function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

function increment(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

const COLLATOR = new Intl.Collator("en");

// Highest count first, then alphabetical, so output is stable across runs.
function sortCounts(counts) {
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((left, right) => right.count - left.count || COLLATOR.compare(left.word, right.word));
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
}

function total(counts) {
  return counts.reduce((sum, entry) => sum + entry.count, 0);
}

function perThousand(count, words) {
  return words === 0 ? 0 : (count * 1000) / words;
}

function formatRate(value) {
  return value.toFixed(1);
}

function formatCounts(counts, limit) {
  return counts.slice(0, limit).map((entry) => `${entry.word} ${entry.count}`).join(", ");
}

function countSuffix(counts) {
  return counts.length === 0 ? "" : ` (${formatCounts(counts, 5)})`;
}

function times(count) {
  return count === 1 ? "once" : `${count} times`;
}

import { usageError } from "./exit-codes.js";
import { escapeRegExp, scanComments, splitWords, withoutFenceMarkers } from "./markdown.js";
import { givenName } from "./names.js";
import { splitSentences } from "./sentences.js";
import { narrationOnly, quoteMatches, replaceQuotes } from "./voices.js";

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
  maxBookisms: 2,
  echoWindow: 30,
  echoMinLength: 5,
  uniformMinSentences: 20,
  uniformSpread: 5,
  phraseLength: 4,
  phraseMinCount: 3,
  phraseLimit: 10
};

// The thresholds with the story prose --max-* flags applied. Each flag is a
// number 0 or more; --max-bookisms is a whole number.
export function proseThresholds(options = {}) {
  const thresholds = { ...PROSE_THRESHOLDS };
  for (const [flag, key, whole] of [["max-filter-words", "filterPerThousand", false], ["max-adverbs", "adverbsPerThousand", false], ["max-bookisms", "maxBookisms", true]]) {
    const raw = options[flag];
    if (raw === undefined) {
      continue;
    }
    const text = String(raw).trim();
    if (!(whole ? /^\d+$/ : /^\d+(?:\.\d+)?$/).test(text) || !Number.isFinite(Number(text))) {
      throw usageError(`--${flag} must be ${whole ? "a whole number" : "a number"} 0 or more, such as ${PROSE_THRESHOLDS[key]}`);
    }
    thresholds[key] = Number(text);
  }
  return thresholds;
}

// `names` are every name and alias in the bible: their words are never
// adverbs or echoes, and a capitalised name is never a dialect spelling.
export function proseRules(styleData, names) {
  const data = styleData ?? {};
  const allow = new Set(stringList(data["allow-words"]).map(normalizeWord));
  const variants = [];
  for (const entry of Array.isArray(data.preferred) ? data.preferred : []) {
    // validate rejects an entry whose use and avoid are the same word.
    if (entry && typeof entry.use === "string" && typeof entry.avoid === "string"
      && entry.use.trim() !== "" && entry.avoid.trim() !== ""
      && normalizeWord(entry.use.trim()) !== normalizeWord(entry.avoid.trim())) {
      variants.push({ use: entry.use.trim(), avoid: entry.avoid.trim(), source: "style sheet" });
    }
  }
  const dialect = typeof data.dialect === "string" ? data.dialect : "unspecified";
  if (dialect === "british" || dialect === "american") {
    // A style-sheet entry or allow-word naming either spelling overrides the
    // built-in pair, so "use: toward" in a British book is not flagged twice.
    const claimed = new Set(variants.flatMap((variant) => [normalizeWord(variant.use), normalizeWord(variant.avoid)]).concat([...allow]));
    for (const [british, american] of DIALECT_PAIRS) {
      const [use, avoid] = dialect === "british" ? [british, american] : [american, british];
      if (!claimed.has(use) && !claimed.has(avoid)) {
        variants.push({ use, avoid, source: `${dialect} dialect` });
      }
    }
  }
  const nameTokens = new Set();
  for (const name of names) {
    for (const token of splitWords(String(name))) {
      nameTokens.add(nameKey(token));
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
  const narration = splitWords(paragraphs.map(narrationOnly).join("\n\n"));
  const sentenceList = paragraphs.flatMap((paragraph) => splitSentences(paragraph));
  const sentences = sentenceList.map((sentence) => splitWords(sentence).length).filter((count) => count > 0);

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
    variants: rules.variants.map(({ use, avoid, source, pattern }) => ({ use, avoid, source, count: countVariant(text, pattern, rules) })).filter((entry) => entry.count > 0),
    phraseSentences: sentenceList.map((sentence) => splitWords(sentence).map(normalizeWord))
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
    findings.push(`${label} has ${formatAgainst(filterRate, thresholds.filterPerThousand, "over")} filter words per 1,000 narration words (over ${thresholds.filterPerThousand}): ${formatCounts(analysis.filterWords, 5)}`);
  }
  const adverbRate = perThousand(total(analysis.adverbs), analysis.narrationWords);
  if (rated && adverbRate > thresholds.adverbsPerThousand) {
    findings.push(`${label} has ${formatAgainst(adverbRate, thresholds.adverbsPerThousand, "over")} -ly adverbs per 1,000 narration words (over ${thresholds.adverbsPerThousand}): ${formatCounts(analysis.adverbs, 5)}`);
  }
  const bookisms = total(analysis.bookisms);
  if (bookisms > thresholds.maxBookisms) {
    findings.push(`${label} has ${bookisms} said-bookism dialogue tags: ${formatCounts(analysis.bookisms, 5)}`);
  }
  const stats = analysis.sentences;
  if (stats.count >= thresholds.uniformMinSentences && stats.spread < thresholds.uniformSpread) {
    findings.push(`${label} sentence lengths are uniform (spread ${formatAgainst(stats.spread, thresholds.uniformSpread, "under")} words over ${stats.count} sentences); vary the rhythm`);
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
// their first three letters, or one or two edits apart. Titles are skipped,
// so Captain Mara Dole is compared as Mara.
export function similarNames(characters) {
  const firsts = characters
    .map((character) => ({ id: character.id, name: String(character.name), first: givenName(character.name).toLowerCase() }))
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
  const lines = [`Prose report: ${report.passage ? "passage from stdin" : chapterCount}, ${report.words} words`];
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
  lines.push("", report.passage ? "Passage:" : "Manuscript:");
  lines.push(`  Repeated ${PROSE_THRESHOLDS.phraseLength}-word phrases: ${report.phrases.map((entry) => `"${entry.phrase}" ${entry.count}`).join(", ") || "none"}`);
  // Similar names are a bible finding, so a passage report leaves them out.
  if (!report.passage) {
    lines.push(`  Similar character names: ${report.similarNames.map(([a, b]) => `${a.name} / ${b.name}`).join(", ") || "none"}`);
  }
  return `${lines.join("\n")}\n`;
}

// Prose paragraphs without headings, HTML comments, or scene-break rules.
function proseParagraphs(prose) {
  // Fence lines are dropped and the code kept, as word counts and builds do.
  return withoutFenceMarkers(scanComments(String(prose), " ").text)
    .split(/\r?\n\s*\r?\n/)
    // Drop heading lines, not the prose that follows one without a blank line.
    .map((paragraph) => paragraph.split(/\r?\n/).filter((line) => !/^\s{0,3}#/.test(line)).join(" "))
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph !== "" && !/^([*_-])( ?\1){2,}$/.test(paragraph));
}

const BEAT_PRONOUNS = new Set(["he", "she", "they", "i", "we", "it", "you"]);

function dialogueTags(paragraphs, rules) {
  const plain = new Map();
  const bookisms = new Map();
  for (const paragraph of paragraphs) {
    for (const match of quoteMatches(paragraph)) {
      // A tag sits within a few words of the closing quote.
      const after = splitWords(paragraph.slice(match.end, match.end + 200).split(/[.!?;:“"]/)[0]).slice(0, 3);
      const tag = tagKind(match.text, after[0] ?? "");
      if (tag === "none") {
        continue;
      }
      for (const raw of after) {
        const word = raw.toLowerCase();
        if (PLAIN_TAGS.includes(word)) {
          increment(plain, word);
          break;
        }
        if (tag === "any" && rules.bookisms.has(word)) {
          increment(bookisms, word);
          break;
        }
      }
    }
  }
  return { plain: sortCounts(plain), bookisms: sortCounts(bookisms) };
}

// Whether the words after a quote can be its tag. A quote ending in a full
// stop is a finished sentence, so what follows is an action beat ("We leave
// at dawn." She smiled.). After ? ! … or a dash, a lower-case word continues
// the sentence as a tag; a capitalised pronoun starts a beat, and a
// capitalised name counts only with a plain tag ("Now?" Mara asked.), since
// "No!" Mara laughed. is a beat.
function tagKind(quoted, nextWord) {
  const end = quoted.trim().replace(/["'”’)\]*_]+$/, "").slice(-1);
  if (end === ".") {
    return "none";
  }
  if (/[?!…—–-]/.test(end) && /^\p{Lu}/u.test(nextWord)) {
    return BEAT_PRONOUNS.has(nextWord.toLowerCase()) ? "none" : "plain";
  }
  return "any";
}

function isAdverb(word, rules) {
  return word.length > 4 && word.endsWith("ly") && !NOT_ADVERBS.has(word) && !rules.allow.has(word) && !isName(word, rules);
}

// A name token, also in the possessive (Maren's, Maren’s).
function isName(word, rules) {
  return rules.nameTokens.has(word) || rules.nameTokens.has(nameKey(word));
}

// Lower case with curly apostrophes made straight, so style-sheet entries
// typed with ' match manuscripts that use ’.
function normalizeWord(word) {
  return String(word).toLowerCase().replace(/’/g, "'");
}

function nameKey(word) {
  return normalizeWord(word).replace(/'s$/, "");
}

// Uses of an avoided spelling, minus capitalised uses that are part of a
// name in the bible (Dorian Gray, Center Point).
function countVariant(text, pattern, rules) {
  let count = 0;
  for (const match of text.matchAll(pattern)) {
    const first = splitWords(match[0])[0] ?? "";
    if (/^\p{Lu}/u.test(first) && isName(first, rules)) {
      continue;
    }
    count += 1;
  }
  return count;
}

function echoes(words, rules) {
  const lastSeen = new Map();
  const counts = new Map();
  words.forEach((raw, index) => {
    const word = normalizeWord(raw);
    if (word.length < PROSE_THRESHOLDS.echoMinLength || ECHO_STOPWORDS.has(word) || isName(word, rules) || rules.allow.has(word) || /^\p{N}+$/u.test(word)) {
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
    const word = normalizeWord(raw);
    if (predicate(word)) {
      increment(counts, word);
    }
  }
  return sortCounts(counts);
}

function phrasePattern(phrase) {
  const body = phrase.trim().split(/\s+/).map((word) => escapeRegExp(word).replace(/['’]/g, "['’]")).join("\\s+");
  // Letter boundaries only, so compounds ("grey-haired") and possessives
  // still count as uses of the word.
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${body}(?![\\p{L}\\p{M}\\p{N}])`, "giu");
}

function countPattern(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

// A rate printed on the warned side of its threshold: 4.975 against "under
// 5" prints 4.98, not 5.0.
function formatAgainst(value, threshold, side) {
  for (let places = 1; places < 6; places += 1) {
    const shown = Number(value.toFixed(places));
    if (side === "over" ? shown > threshold : shown < threshold) {
      return value.toFixed(places);
    }
  }
  return String(value);
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

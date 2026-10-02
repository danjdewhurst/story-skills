import { usageError } from "./exit-codes.js";
import { warn } from "./findings.js";
import { checkList, checkSet, hasLists, languagePack, skippedCheck, skippedChecks, skippedLines } from "./languages/index.js";
import { compareText, lowerCase, matchingCase, matchingText } from "./languages/locale.js";
import { escapeRegExp, scanComments, splitWords, withoutFenceMarkers } from "./markdown.js";
import { givenName } from "./names.js";
import { splitSentences } from "./sentences.js";
import { narrationOnly, quoteMatches, replaceQuotes } from "./voices.js";
import { wholeWords, wordMatcher } from "./words.js";

// Deterministic prose checks for `story prose`. Everything here is counting:
// no scoring, no rewriting. Thresholds only decide which counts are raised as
// warnings; the full counts are always reported so the writer can judge.
// The word lists come from the story's language pack; a check whose lists
// the pack lacks is skipped and listed in the rules' `skipped`.

export const PROSE_CHECKS = [
  { check: "filter-words", label: "Filter words", lists: ["filterWords"] },
  { check: "adverbs", label: "Adverbs", lists: ["adverbSuffixes", "adverbExceptions"] },
  { check: "dialogue-tags", label: "Dialogue tags", lists: ["plainTags", "saidBookisms", "beatPronouns"] },
  { check: "echoes", label: "Echoes", lists: ["echoStopwords"] },
  { check: "repeated-phrases", label: "Repeated phrases", lists: ["phraseStopwords"] }
];

// Checks that run only with a baseline from style-sheet.md samples.
export const BASELINE_CHECKS = [
  { check: "signature-words", label: "Baseline signature words", lists: ["echoStopwords", "phraseStopwords"] }
];

const DIALECT_CHECK = { check: "dialect-spellings", label: "British and American spellings", lists: ["dialectPairs"] };

// Whether the pack has the lists a check in PROSE_CHECKS or BASELINE_CHECKS
// needs.
export function checkRuns(pack, check) {
  return hasLists(pack, [...PROSE_CHECKS, ...BASELINE_CHECKS].find((definition) => definition.check === check).lists);
}

// What the pack calls the adverbs it counts: "-ly adverbs" in English.
export function adverbLabel(pack) {
  return checkList(pack, "adverbLabel") ?? "adverbs";
}

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
// `pack` is the story's language pack, English by default. A word list the
// pack lacks is null in the rules, and its check is listed in `skipped`.
export function proseRules(styleData, names, pack = languagePack()) {
  const data = styleData ?? {};
  const skipped = skippedChecks(pack, PROSE_CHECKS);
  const allow = new Set(stringList(data["allow-words"]).map((word) => normalizeWord(word, pack)));
  const variants = [];
  for (const entry of Array.isArray(data.preferred) ? data.preferred : []) {
    // validate rejects an entry whose use and avoid are the same word.
    if (entry && typeof entry.use === "string" && typeof entry.avoid === "string"
      && entry.use.trim() !== "" && entry.avoid.trim() !== ""
      && normalizeWord(entry.use.trim(), pack) !== normalizeWord(entry.avoid.trim(), pack)) {
      variants.push({ use: entry.use.trim(), avoid: entry.avoid.trim(), source: "style sheet" });
    }
  }
  const dialect = typeof data.dialect === "string" ? data.dialect : "unspecified";
  const dialectPairs = checkList(pack, "dialectPairs");
  if ((dialect === "british" || dialect === "american") && dialectPairs === null) {
    skipped.push(skippedCheck(pack, DIALECT_CHECK));
  } else if (dialect === "british" || dialect === "american") {
    // A style-sheet entry or allow-word naming either spelling overrides the
    // built-in pair, so "use: toward" in a British book is not flagged twice.
    const claimed = new Set(variants.flatMap((variant) => [normalizeWord(variant.use, pack), normalizeWord(variant.avoid, pack)]).concat([...allow]));
    for (const [british, american] of dialectPairs) {
      const [use, avoid] = dialect === "british" ? [british, american] : [american, british];
      if (!claimed.has(use) && !claimed.has(avoid)) {
        variants.push({ use, avoid, source: `${dialect} dialect` });
      }
    }
  }
  const nameTokens = new Set();
  for (const name of names) {
    for (const token of splitWords(String(name))) {
      nameTokens.add(nameKey(token, pack));
    }
  }
  const allowed = (name) => {
    const list = checkList(pack, name);
    return list === null ? null : new Set(list.filter((word) => !allow.has(word)));
  };
  const tags = !skipped.some((entry) => entry.check === "dialogue-tags");
  return {
    pack,
    skipped,
    allow,
    variants: variants.map((variant) => ({ ...variant, pattern: phrasePattern(variant.avoid, pack) })),
    watch: stringList(data["watch-words"]).map((word) => ({ word, pattern: phrasePattern(word, pack) })),
    filterWords: allowed("filterWords"),
    // Dialogue tags need all three lists, so they are all null without one.
    bookisms: tags ? allowed("saidBookisms") : null,
    plainTags: tags ? checkSet(pack, "plainTags") : null,
    beatPronouns: tags ? checkSet(pack, "beatPronouns") : null,
    // The joins of an inverted tag's verb and pronoun (dit-il).
    inversionLinks: checkList(pack, "inversionLinks") ?? [],
    adverbSuffixes: checkList(pack, "adverbExceptions") === null ? null : checkList(pack, "adverbSuffixes"),
    adverbExceptions: checkSet(pack, "adverbExceptions"),
    // Words after which an adverb-shaped word is a noun or verb (le
    // moment, ils aiment), and the elisions among them (l'appartement).
    adverbBlockers: checkSet(pack, "adverbBlockers"),
    echoStopwords: checkSet(pack, "echoStopwords"),
    phraseStopwords: checkSet(pack, "phraseStopwords"),
    nameTokens
  };
}

export function analyzeChapter(prose, rules) {
  const paragraphs = proseParagraphs(prose);
  const text = paragraphs.join("\n\n");
  const words = splitWords(text);
  const narration = splitWords(paragraphs.map((paragraph) => narrationOnly(paragraph, rules.pack)).join("\n\n"));
  const sentenceList = paragraphs.flatMap((paragraph) => splitSentences(paragraph, { pack: rules.pack }));
  const sentences = sentenceList.map((sentence) => splitWords(sentence).length).filter((count) => count > 0);

  // A skipped check counts nothing.
  const filterWords = rules.filterWords === null ? [] : countMatching(narration, (word) => rules.filterWords.has(word), rules.pack);
  const adverbs = rules.adverbSuffixes === null ? [] : countAdverbs(narration, rules);
  const tags = rules.plainTags === null ? { plain: [], bookisms: [] } : dialogueTags(paragraphs, rules);
  // Watch words and avoided spellings match in the story's casing, as whole
  // words, which in an unspaced script are found by wordSpans.
  const find = rules.watch.length + rules.variants.length === 0 ? null : wordMatcher(text, matchingText(text, rules.pack));

  return {
    words: words.length,
    narrationWords: narration.length,
    paragraphs: paragraphs.length,
    sentences: sentenceStats(sentences),
    filterWords,
    adverbs,
    plainTags: tags.plain,
    bookisms: tags.bookisms,
    echoes: echoes(words, rules),
    watch: rules.watch.map(({ word, pattern }) => ({ word, count: find(pattern).length })).filter((entry) => entry.count > 0),
    variants: rules.variants.map(({ use, avoid, source, pattern }) => ({ use, avoid, source, count: countVariant(text, find(pattern), rules) })).filter((entry) => entry.count > 0),
    phraseSentences: sentenceList.map((sentence) => splitWords(sentence).map((word) => normalizeWord(word, rules.pack)))
  };
}

// With a baseline, the author's own rates replace the fixed filter-word and
// adverb limits, so those two generic warnings are left to baselineFindings.
// `pack` names the adverbs ("-ly adverbs" in English).
export function chapterFindings(label, analysis, thresholds = PROSE_THRESHOLDS, { baseline = false, pack = languagePack() } = {}) {
  const findings = [];
  for (const variant of analysis.variants) {
    findings.push(warn("prose-avoided-spelling", `${label} uses "${variant.avoid}" ${times(variant.count)}; ${variant.source} prefers "${variant.use}"`, label));
  }
  const rated = analysis.narrationWords >= thresholds.minRateWords;
  const filterRate = perThousand(total(analysis.filterWords), analysis.narrationWords);
  if (!baseline && rated && filterRate > thresholds.filterPerThousand) {
    findings.push(warn("prose-filter-words", `${label} has ${formatAgainst(filterRate, thresholds.filterPerThousand, "over")} filter words per 1,000 narration words (over ${thresholds.filterPerThousand}): ${formatCounts(analysis.filterWords, 5)}`, label));
  }
  const adverbRate = perThousand(total(analysis.adverbs), analysis.narrationWords);
  if (!baseline && rated && adverbRate > thresholds.adverbsPerThousand) {
    findings.push(warn("prose-adverbs", `${label} has ${formatAgainst(adverbRate, thresholds.adverbsPerThousand, "over")} ${adverbLabel(pack)} per 1,000 narration words (over ${thresholds.adverbsPerThousand}): ${formatCounts(analysis.adverbs, 5)}`, label));
  }
  const bookisms = total(analysis.bookisms);
  if (bookisms > thresholds.maxBookisms) {
    findings.push(warn("prose-bookisms", `${label} has ${bookisms} said-bookism dialogue tags: ${formatCounts(analysis.bookisms, 5)}`, label));
  }
  const stats = analysis.sentences;
  if (stats.count >= thresholds.uniformMinSentences && stats.spread < thresholds.uniformSpread) {
    findings.push(warn("prose-uniform-sentences", `${label} sentence lengths are uniform (spread ${formatAgainst(stats.spread, thresholds.uniformSpread, "under")} words over ${stats.count} sentences); vary the rhythm`, label));
  }
  return findings;
}

// The author's own prose, from the style sheet's `samples`, as a profile
// chapters are compared with. Every tolerance is a documented constant, so
// the same samples and chapter always give the same findings. A drift is a
// prompt to reread the chapter, not a rule: a fight scene should run shorter
// than the book's average.
export const BASELINE_TOLERANCES = {
  // Below this much sample narration the profile is too thin to compare with.
  minSampleWords: 2000,
  // A chapter needs this many sentences before its average is compared.
  minSentences: 10,
  // Average sentence length, as a share of the samples' average.
  sentenceLength: 0.3,
  // Average paragraph length, as a share of the samples' average.
  paragraphLength: 0.5,
  // Share of words inside dialogue, in percentage points.
  dialogueShare: 20,
  // Filter words and -ly adverbs per 1,000 narration words: half the
  // samples' rate, and never less than this many.
  rateFloor: 3,
  rateShare: 0.5,
  // Signature words: the samples' most used content words.
  signatureWords: 20,
  signatureMinCount: 3
};

// A measure whose check the pack skips (`pack`, English by default) is null.
export function baselineProfile(samples, pack = languagePack()) {
  const analyses = samples.map((sample) => sample.analysis);
  const sum = (pick) => analyses.reduce((total, analysis) => total + pick(analysis), 0);
  const words = sum((analysis) => analysis.words);
  const narrationWords = sum((analysis) => analysis.narrationWords);
  const lengths = samples.flatMap((sample) => sample.sentenceLengths);
  const counts = new Map();
  for (const sample of samples) {
    for (const word of sample.contentWords) {
      increment(counts, word);
    }
  }
  return {
    samples: samples.map((sample) => sample.file),
    words,
    narrationWords,
    sentences: sentenceStats(lengths),
    paragraphMean: sum((analysis) => analysis.paragraphs) === 0 ? 0 : words / sum((analysis) => analysis.paragraphs),
    dialogueShare: words === 0 ? 0 : ((words - narrationWords) * 100) / words,
    filterPerThousand: checkRuns(pack, "filter-words") ? perThousand(sum((analysis) => total(analysis.filterWords)), narrationWords) : null,
    adverbsPerThousand: checkRuns(pack, "adverbs") ? perThousand(sum((analysis) => total(analysis.adverbs)), narrationWords) : null,
    signatureWords: checkRuns(pack, "signature-words")
      ? sortCounts(counts, pack)
        .filter((entry) => entry.count >= BASELINE_TOLERANCES.signatureMinCount)
        .slice(0, BASELINE_TOLERANCES.signatureWords)
        .map((entry) => entry.word)
      : null,
    usable: narrationWords >= BASELINE_TOLERANCES.minSampleWords
  };
}

// The words a signature can be made of: four letters or more, not a common
// function word, a number, or a name in the bible. None without the pack's
// stopwords, so the signature words are skipped.
export function contentWords(prose, rules) {
  if (rules.echoStopwords === null || rules.phraseStopwords === null) {
    return [];
  }
  return splitWords(proseParagraphs(prose).join("\n\n"))
    .map((word) => normalizeWord(word, rules.pack))
    .filter((word) => word.length >= 4 && !rules.echoStopwords.has(word) && !rules.phraseStopwords.has(word) && !isName(word, rules) && !/^\p{N}+$/u.test(word));
}

// The sentence lengths analyzeChapter summarises, for pooling samples.
export function sentenceLengths(prose, pack = languagePack()) {
  return proseParagraphs(prose)
    .flatMap((paragraph) => splitSentences(paragraph, { pack }))
    .map((sentence) => splitWords(sentence).length)
    .filter((count) => count > 0);
}

// A chapter's figures on the profile's scales, and the signature words it
// uses. A measure the profile skips (null) is null here too.
export function baselineFigures(analysis, profile, chapterWords) {
  const used = new Set(chapterWords);
  return {
    sentenceMean: analysis.sentences.mean,
    paragraphMean: analysis.paragraphs === 0 ? 0 : analysis.words / analysis.paragraphs,
    dialogueShare: analysis.words === 0 ? 0 : ((analysis.words - analysis.narrationWords) * 100) / analysis.words,
    filterPerThousand: profile.filterPerThousand === null ? null : perThousand(total(analysis.filterWords), analysis.narrationWords),
    adverbsPerThousand: profile.adverbsPerThousand === null ? null : perThousand(total(analysis.adverbs), analysis.narrationWords),
    signatureWordsUsed: profile.signatureWords === null ? null : profile.signatureWords.filter((word) => used.has(word)).length
  };
}

// `pack` names the adverbs ("-ly adverbs" in English).
export function baselineFindings(label, analysis, figures, profile, tolerances = BASELINE_TOLERANCES, pack = languagePack()) {
  const findings = [];
  // Shape measures need a chapter of some length; the per-1,000 rates need
  // that much narration, so a chapter that is nearly all dialogue is still
  // compared on its dialogue share.
  if (!profile.usable || analysis.words < PROSE_THRESHOLDS.minRateWords) {
    return findings;
  }
  const rated = analysis.narrationWords >= PROSE_THRESHOLDS.minRateWords;
  const relative = (value, base, share) => base > 0 && Math.abs(value - base) > base * share;
  const direction = (value, base, more, fewer) => (value > base ? more : fewer);
  if (analysis.sentences.count >= tolerances.minSentences && relative(figures.sentenceMean, profile.sentences.mean, tolerances.sentenceLength)) {
    findings.push(warn("prose-baseline-sentences", `${label} sentences average ${formatRate(figures.sentenceMean)} words, ${direction(figures.sentenceMean, profile.sentences.mean, "longer", "shorter")} than your samples' ${formatRate(profile.sentences.mean)} (tolerance ${tolerances.sentenceLength * 100}%)`, label));
  }
  if (relative(figures.paragraphMean, profile.paragraphMean, tolerances.paragraphLength)) {
    findings.push(warn("prose-baseline-paragraphs", `${label} paragraphs average ${formatRate(figures.paragraphMean)} words, ${direction(figures.paragraphMean, profile.paragraphMean, "longer", "shorter")} than your samples' ${formatRate(profile.paragraphMean)} (tolerance ${tolerances.paragraphLength * 100}%)`, label));
  }
  if (Math.abs(figures.dialogueShare - profile.dialogueShare) > tolerances.dialogueShare) {
    findings.push(warn("prose-baseline-dialogue", `${label} is ${formatRate(figures.dialogueShare)}% dialogue, ${direction(figures.dialogueShare, profile.dialogueShare, "more", "less")} than your samples' ${formatRate(profile.dialogueShare)}% (tolerance ${tolerances.dialogueShare} points)`, label));
  }
  // The message for a rate that drifts past its tolerance, or null. A
  // skipped rate (null) never drifts.
  const rateDrift = (name, field) => {
    if (profile[field] === null) {
      return null;
    }
    const allowed = Math.max(tolerances.rateFloor, profile[field] * tolerances.rateShare);
    return Math.abs(figures[field] - profile[field]) > allowed
      ? `${label} has ${formatRate(figures[field])} ${name} per 1,000 narration words, ${direction(figures[field], profile[field], "more", "fewer")} than your samples' ${formatRate(profile[field])} (tolerance ${formatRate(allowed)})`
      : null;
  };
  const filterDrift = rated ? rateDrift("filter words", "filterPerThousand") : null;
  if (filterDrift !== null) {
    findings.push(warn("prose-baseline-filter-words", filterDrift, label));
  }
  const adverbDrift = rated ? rateDrift(adverbLabel(pack), "adverbsPerThousand") : null;
  if (adverbDrift !== null) {
    findings.push(warn("prose-baseline-adverbs", adverbDrift, label));
  }
  return findings;
}

// None when the pack has no phrase stopwords: the check is skipped.
export function repeatedPhrases(analyses, thresholds = PROSE_THRESHOLDS, pack = languagePack()) {
  const stopwords = checkSet(pack, "phraseStopwords");
  if (stopwords === null) {
    return [];
  }
  const counts = new Map();
  const size = thresholds.phraseLength;
  for (const analysis of analyses) {
    for (const sentence of analysis.phraseSentences) {
      for (let index = 0; index + size <= sentence.length; index += 1) {
        const gram = sentence.slice(index, index + size);
        if (gram.every((word) => stopwords.has(word))) {
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
  return sortCounts(repeated, pack)
    .slice(0, thresholds.phraseLimit)
    .map((entry) => ({ phrase: entry.word, count: entry.count }));
}

// Character first names that a reader could confuse: identical, sharing
// their first three letters, or one or two edits apart. Titles are skipped,
// so Captain Mara Dole is compared as Mara.
export function similarNames(characters, pack = languagePack()) {
  const firsts = characters
    .map((character) => ({ id: character.id, name: String(character.name), first: lowerCase(givenName(character.name, pack), pack) }))
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
  // Checks the language pack cannot run are noted here and their lines left
  // out below, so a zero is never read as a clean result.
  const skipped = report.skipped ?? [];
  lines.push(...skippedLines(skipped));
  const runs = (check) => !skipped.some((entry) => entry.check === check);
  const adverbs = adverbLabel(languagePack(report.language));
  const profile = report.baseline;
  if (profile) {
    const stats = profile.sentences;
    // Skipped rates and signature words (null) are left out.
    const rates = [];
    if (profile.filterPerThousand !== null) {
      rates.push(`${formatRate(profile.filterPerThousand)} filter words`);
    }
    if (profile.adverbsPerThousand !== null) {
      rates.push(`${formatRate(profile.adverbsPerThousand)} ${adverbs}`);
    }
    const rateText = rates.length === 0 ? "" : `, ${rates.join(" and ")} per 1k narration words`;
    lines.push(`Baseline from ${profile.samples.length} ${profile.samples.length === 1 ? "sample" : "samples"} (${profile.words} words): sentences ${formatRate(stats.mean)} words (spread ${formatRate(stats.spread)}), paragraphs ${formatRate(profile.paragraphMean)} words, ${formatRate(profile.dialogueShare)}% dialogue${rateText}`);
    if (!profile.usable) {
      lines.push(`  Too few sample words to compare with (${profile.narrationWords} of ${BASELINE_TOLERANCES.minSampleWords} narration words): the fixed limits apply`);
    } else if (profile.signatureWords !== null) {
      lines.push(`  Signature words: ${profile.signatureWords.join(", ") || "none"}`);
    }
  }
  for (const chapter of report.chapters) {
    const analysis = chapter.analysis;
    const stats = analysis.sentences;
    lines.push("", `${chapter.file}: ${chapter.title} (${analysis.words} words)`);
    lines.push(`  Sentences: ${stats.count}, average ${formatRate(stats.mean)} words, longest ${stats.longest}, spread ${formatRate(stats.spread)}`);
    if (runs("filter-words")) {
      lines.push(`  Filter words: ${formatRate(perThousand(total(analysis.filterWords), analysis.narrationWords))} per 1k narration words${countSuffix(analysis.filterWords)}`);
    }
    if (runs("adverbs")) {
      lines.push(`  ${adverbs[0].toUpperCase()}${adverbs.slice(1)}: ${formatRate(perThousand(total(analysis.adverbs), analysis.narrationWords))} per 1k narration words${countSuffix(analysis.adverbs)}`);
    }
    if (runs("dialogue-tags")) {
      lines.push(`  Dialogue tags: ${formatCounts(analysis.plainTags, 4) || "none plain"}; said-bookisms: ${formatCounts(analysis.bookisms, 5) || "none"}`);
    }
    if (chapter.baseline && profile.usable) {
      const figures = chapter.baseline;
      const signature = figures.signatureWordsUsed === null ? "" : `, signature words ${figures.signatureWordsUsed} of ${profile.signatureWords.length}`;
      lines.push(`  Against the baseline: paragraphs ${formatRate(figures.paragraphMean)} words, ${formatRate(figures.dialogueShare)}% dialogue${signature}`);
    }
    if (runs("echoes")) {
      lines.push(`  Echoes within ${PROSE_THRESHOLDS.echoWindow} words: ${formatCounts(analysis.echoes, 5) || "none"}`);
    }
    if (analysis.watch.length > 0) {
      lines.push(`  Watch words: ${analysis.watch.map((entry) => `${entry.word} ${entry.count}`).join(", ")}`);
    }
    if (analysis.variants.length > 0) {
      lines.push(`  Spelling: ${analysis.variants.map((entry) => `${entry.avoid} ${entry.count} (use ${entry.use})`).join(", ")}`);
    }
  }
  const whole = [];
  if (runs("repeated-phrases")) {
    whole.push(`  Repeated ${PROSE_THRESHOLDS.phraseLength}-word phrases: ${report.phrases.map((entry) => `"${entry.phrase}" ${entry.count}`).join(", ") || "none"}`);
  }
  // Similar names are a bible finding, so a passage report leaves them out.
  if (!report.passage) {
    whole.push(`  Similar character names: ${report.similarNames.map(([a, b]) => `${a.name} / ${b.name}`).join(", ") || "none"}`);
  }
  if (whole.length > 0) {
    lines.push("", report.passage ? "Passage:" : "Manuscript:", ...whole);
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

function dialogueTags(paragraphs, rules) {
  const plain = new Map();
  const bookisms = new Map();
  for (const paragraph of paragraphs) {
    for (const match of quoteMatches(paragraph, rules.pack)) {
      // A tag sits within a few words of the closing quote.
      const after = splitWords(paragraph.slice(match.end, match.end + 200).split(/[.!?;:“"]/)[0]).slice(0, 3);
      const tag = tagKind(match.text, after[0] ?? "", rules);
      if (tag === "none") {
        continue;
      }
      for (const raw of after) {
        const word = tagWord(normalizeWord(raw, rules.pack), rules);
        if (rules.plainTags.has(word)) {
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
  return { plain: sortCounts(plain, rules.pack), bookisms: sortCounts(bookisms, rules.pack) };
}

// Whether the words after a quote can be its tag. A quote ending in a full
// stop is a finished sentence, so what follows is an action beat ("We leave
// at dawn." She smiled.). After ? ! … or a dash, a lower-case word continues
// the sentence as a tag; a capitalised pronoun starts a beat, and a
// capitalised name counts only with a plain tag ("Now?" Mara asked.), since
// "No!" Mara laughed. is a beat.
// An inverted tag (dit-il, demanda-t-elle) counts as its verb.
function tagWord(word, rules) {
  for (const link of rules.inversionLinks) {
    const index = word.indexOf(link);
    if (index > 0 && rules.beatPronouns.has(word.slice(index + link.length))) {
      return word.slice(0, index);
    }
  }
  return word;
}

function tagKind(quoted, nextWord, rules) {
  const end = quoted.trim().replace(/["'”’)\]*_]+$/, "").slice(-1);
  if (end === ".") {
    return "none";
  }
  if (/[?!…—–-]/.test(end) && /^\p{Lu}/u.test(nextWord)) {
    return rules.beatPronouns.has(lowerCase(nextWord, rules.pack)) ? "none" : "plain";
  }
  return "any";
}

// Adverbs among the narration words. With `adverbBlockers`, a word after
// one, or joined to one by an elision, is not an adverb, and an adverb is
// counted without an elision it carries (qu'évidemment).
function countAdverbs(words, rules) {
  if (rules.adverbBlockers === null) {
    return countMatching(words, (word) => isAdverb(word, rules), rules.pack);
  }
  const counts = new Map();
  let previous = "";
  for (const raw of words) {
    const word = normalizeWord(raw, rules.pack);
    const elision = /^\p{L}{1,2}'(?=\p{L})/u.exec(word)?.[0] ?? "";
    const bare = word.slice(elision.length);
    if (!rules.adverbBlockers.has(previous) && !rules.adverbBlockers.has(elision) && isAdverb(bare, rules)) {
      increment(counts, bare);
    }
    previous = word;
  }
  return sortCounts(counts, rules.pack);
}

function isAdverb(word, rules) {
  return word.length > 4 && rules.adverbSuffixes.some((suffix) => word.endsWith(suffix)) && !rules.adverbExceptions.has(word) && !rules.allow.has(word) && !isName(word, rules);
}

// A name token, also in the possessive (Maren's, Maren’s).
function isName(word, rules) {
  return rules.nameTokens.has(word) || rules.nameTokens.has(nameKey(word, rules.pack));
}

// Lower case with curly apostrophes made straight, so style-sheet entries
// typed with ' match manuscripts that use ’.
function normalizeWord(word, pack) {
  return lowerCase(word, pack).replace(/’/g, "'");
}

function nameKey(word, pack) {
  return normalizeWord(word, pack).replace(/'s$/, "");
}

// Uses of an avoided spelling, minus capitalised uses that are part of a
// name in the bible (Dorian Gray, Center Point). `spans` are its matches in
// `text`, as written, where the capital is looked for.
function countVariant(text, spans, rules) {
  let count = 0;
  for (const [start, end] of spans) {
    const first = splitWords(text.slice(start, end))[0] ?? "";
    if (/^\p{Lu}/u.test(first) && isName(first, rules)) {
      continue;
    }
    count += 1;
  }
  return count;
}

function echoes(words, rules) {
  if (rules.echoStopwords === null) {
    return [];
  }
  const lastSeen = new Map();
  const counts = new Map();
  words.forEach((raw, index) => {
    const word = normalizeWord(raw, rules.pack);
    if (word.length < PROSE_THRESHOLDS.echoMinLength || rules.echoStopwords.has(word) || isName(word, rules) || rules.allow.has(word) || /^\p{N}+$/u.test(word)) {
      return;
    }
    if (lastSeen.has(word) && index - lastSeen.get(word) <= PROSE_THRESHOLDS.echoWindow) {
      increment(counts, word);
    }
    lastSeen.set(word, index);
  });
  return sortCounts(counts, rules.pack);
}

function sentenceStats(lengths) {
  if (lengths.length === 0) {
    return { count: 0, mean: 0, longest: 0, spread: 0 };
  }
  const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
  return { count: lengths.length, mean, longest: Math.max(...lengths), spread: Math.sqrt(variance) };
}

function countMatching(words, predicate, pack) {
  const counts = new Map();
  for (const raw of words) {
    const word = normalizeWord(raw, pack);
    if (predicate(word)) {
      increment(counts, word);
    }
  }
  return sortCounts(counts, pack);
}

// A watch word or avoided spelling, for wordMatcher on matchingText.
function phrasePattern(phrase, pack) {
  const body = matchingCase(phrase.trim(), pack).split(/\s+/).map((word) => escapeRegExp(word).replace(/['’]/g, "['’]")).join("\\s+");
  // Letter boundaries only, so compounds ("grey-haired") and possessives
  // still count as uses of the word.
  return new RegExp(wholeWords(body, phrase.trim()), "giu");
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

// Highest count first, then alphabetical in the story's language, so output
// is stable across runs.
function sortCounts(counts, pack) {
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((left, right) => right.count - left.count || compareText(pack)(left.word, right.word));
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

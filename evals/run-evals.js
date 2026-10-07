#!/usr/bin/env node
/**
 * Check a draft against a fixture's canon and craft rules.
 *
 * Usage:
 *   node evals/run-evals.js <fixture-dir> <draft-file>
 *   node evals/run-evals.js --all <outputs-dir>
 *
 * In --all mode, <outputs-dir> must contain one file per fixture, named
 * <fixture-name>.md (for example outputs/canon-keeping.md). Exits non-zero
 * if any check fails. No dependencies beyond the Node standard library.
 *
 * A fixture is a drafting brief seeded with known canon (established facts
 * that must survive) and known traps (inventions, resolutions, or slop a
 * lazy draft would introduce). A passing draft keeps the canon, springs
 * none of the traps, and reads as written by one person.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(here, "fixtures");

const KNOWN_MARKERS = new Set([
  "contraction_rate",
  "first_person_rate",
  "hedge_rate",
  "mean_word_length",
]);

// Every top-level field a checks.json may set. The checker and
// scripts/check-evals.js reject any other, so a misspelled field fails
// instead of being ignored.
export const CHECK_KEYS = new Set([
  "name",
  "brief",
  "skill",
  "keep",
  "language",
  "baseline_margin",
  "required",
  "required_regex",
  "required_in_order",
  "banned",
  "banned_regex",
  "chapter_text",
  "chapter_frontmatter",
  "max_words",
  "max_words_ratio",
  "min_words_ratio",
  "paragraphs",
  "lines",
  "ends_with_question",
  "requires_first_person",
  "requires_past_tense",
  "voice_drift",
  "expected_overlaps",
]);

function normalizeApos(text) {
  return text.replace(/[’‘ʼ]/g, "'");
}

// Flexible separator for phrase matching: spaces, hyphens, dashes, newlines,
// and underscores are equivalent ("sea-chest" matches "sea chest"). Used to
// build word-boundary regexes from checks.json phrases so punctuation does
// not matter, while partial-word matches ("key" in "turkey", "Ana" in
// "Indiana", "montre" in "démontre", "кот" in "скот") still fail.
const FLEX_SEP_SRC = "[\\s\\-—–―−‐‑_]+";

// A letter, combining mark, digit, or underscore in any script, so a word
// boundary holds next to accented letters (é, ç), precomposed or written
// with a combining accent, as well as ASCII ones.
const WORD_CHAR_SRC = "[\\p{L}\\p{M}\\p{N}_]";
const WORD_CHAR = new RegExp(WORD_CHAR_SRC, "u");

// Scripts written without spaces between words: Chinese, Japanese, Thai,
// Lao, Khmer, and Myanmar, the set src/words.js splits by character or by
// dictionary. A phrase edge in one of these joins the text around it, so
// that edge is matched with no boundary.
const UNSPACED_LETTER =
  /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]/u;

const LATIN_LETTER = /\p{Script=Latin}/u;
const ARABIC_LETTER = /\p{Script=Arabic}/u;
const HEBREW_LETTER = /\p{Script=Hebrew}/u;
// A decimal digit in any script (0-9, Arabic-Indic ١, Devanagari १, ...).
const DIGIT = /\p{Nd}/u;

// Arabic and Hebrew join a conjunction, a preposition, and the article to
// the word after them (مخطوطة "manuscript", والمخطوطة "and the manuscript";
// ספר "book", בספר "in the book"), so in a fixture in those languages a
// phrase may follow them inside a word. Arabic ل before ال contracts to لل,
// and س marks the future before a verb's own prefix (سيدخل). Hebrew ש
// ("that") may itself follow כ or מ (כשהלך "when he went"). Other languages
// in these scripts (Persian, Urdu, Yiddish) join no such prefixes, so they
// take the plain rule.
const ARABIC_PROCLITICS_SRC = "(?:[وف]?(?:[بك]?ال|لل|[بكل]|س(?=[يتنأ]))?)";
const ARABIC_ARTICLE_SRC = "(?:[وف]?(?:[بك]?ال|لل))";
const HEBREW_PROCLITICS_SRC = "(?:ו?(?:[כמ]?ש)?[בכלמ]?ה?)";

// The fixture's language, as far as phrase matching cares: "ar", "he", or
// null for anything else.
function prefixLanguage(language) {
  const primary = String(language ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (["ar", "ara", "arb"].includes(primary)) return "ar";
  if (["he", "iw", "heb"].includes(primary)) return "he";
  return null;
}

// The first or last letter of a phrase part, whose script decides how that
// edge is bounded. A combining mark (a vowel sign, a harakah) belongs to the
// letter before it, so it is skipped.
function edgeLetter(text, fromEnd) {
  const chars = [...text];
  if (fromEnd) chars.reverse();
  return chars.find((c) => /\p{L}/u.test(c)) ?? "";
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Each edge of a phrase is bounded by what stands there:
// - a digit, in any script, may not run on into another digit;
// - a letter of a script written with spaces (Latin with or without
//   accents, Cyrillic, Greek, Arabic, Hebrew, Devanagari, Hangul, ...) may
//   not follow another letter, so a phrase matches only at the start of a
//   word;
// - at the end, a Latin letter may not run on into another letter except by
//   an English inflection, while a letter of any other spaced script may,
//   since those languages inflect by endings and join particles to the word
//   (кот in кота, ספר in ספרים, 책 in 책을, کتاب in کتابی);
// - a letter of an unspaced script, or punctuation, is matched as it stands.
// A mixed phrase ("Kirimi駅") bounds each edge by its own script. `language`
// is the fixture's, which adds the Arabic and Hebrew prefixes above.
function phrasePattern(phrase, inflect = false, language = null) {
  const norm = normalizeApos(phrase);
  const parts = norm.split(new RegExp(FLEX_SEP_SRC)).filter(Boolean);
  if (parts.length === 0) return null;
  const innerPieces = parts.map((p) => [...p].map(escapeRegExp).join(""));
  let inner = innerPieces.join(FLEX_SEP_SRC);
  const first = [...parts[0]][0];
  const last = [...parts[parts.length - 1]].pop();
  const firstLetter = edgeLetter(parts[0], false);
  const lastLetter = edgeLetter(parts[parts.length - 1], true);
  const prefixes = prefixLanguage(language);
  const arabic = prefixes === "ar" && ARABIC_LETTER.test(lastLetter);
  let right;
  if (DIGIT.test(last)) right = "(?!\\p{Nd})";
  else if (WORD_CHAR.test(last) && LATIN_LETTER.test(lastLetter)) {
    // With inflect=true (required canon), a trailing inflection is allowed
    // so "logbook" matches "logbooks" while "key" still does not match
    // "turkey".
    // A silent final e drops before -ing/-ed ("delve" -> "delving") and a
    // consonant + y becomes -ies/-ied ("tapestry" -> "tapestries").
    if (inflect) {
      const word = parts[parts.length - 1];
      const head = innerPieces.slice(0, -1).concat("").join(FLEX_SEP_SRC);
      const stem = [...word.slice(0, -1)].map(escapeRegExp).join("");
      if (/[^aeiouy]y$/i.test(word)) inner = `${head}${stem}(?:y|ys|ies|ied|ying)`;
      else if (/[^e]e$/i.test(word)) inner = `${head}${stem}(?:e|es|ed|ing)`;
      else inner += "(?:s|es|ed|ing|d)?";
    }
    right = `(?!${WORD_CHAR_SRC})`;
  } else {
    // An Arabic final ة is written ت before an ending and gives way to the
    // plural ات (مخطوطتها, مخطوطات); a final ى is written ا (ليلاه).
    if (arabic && /[ةى]$/.test(inner)) {
      inner = inner.slice(0, -1) + (inner.endsWith("ة") ? "(?:ة|ت|ات)" : "(?:ى|ا)");
    }
    right = "";
  }
  let left;
  if (DIGIT.test(first)) left = "(?<!\\p{Nd})";
  else if (WORD_CHAR.test(first) && !UNSPACED_LETTER.test(firstLetter)) {
    left = `(?<!${WORD_CHAR_SRC})`;
    if (prefixes === "ar" && ARABIC_LETTER.test(firstLetter)) {
      // A phrase that starts with the article also matches it after ل (لل).
      if (inner.startsWith("ال")) inner = ARABIC_ARTICLE_SRC + inner.slice(2);
      else left += ARABIC_PROCLITICS_SRC;
    } else if (prefixes === "he" && HEBREW_LETTER.test(firstLetter)) left += HEBREW_PROCLITICS_SRC;
  } else left = "";
  return left + inner + right;
}

function phraseFound(phrase, text, inflect = false, language = null) {
  const normText = normalizeApos(text);
  const pattern = phrasePattern(phrase, inflect, language);
  const fallback = () =>
    normText.toLowerCase().includes(normalizeApos(phrase).toLowerCase());
  if (pattern === null) return fallback();
  try {
    return new RegExp(pattern, "iu").test(normText);
  } catch {
    return fallback();
  }
}

/**
 * Fill `{name}` placeholders in one pass. A function replacer keeps `$&`,
 * `$'` and friends in the values literal, and a single scan means text
 * inserted for one placeholder is never re-scanned for another.
 */
export function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

export function loadFixture(fixtureDir) {
  const checks = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, "checks.json"), "utf8")
  );
  const inputText = fs.readFileSync(path.join(fixtureDir, "input.md"), "utf8");
  return { checks, inputText };
}

// Chinese and Japanese put no spaces between words, so each of their
// characters counts as a word, as `story wordcount` counts them; the rest of
// the text counts its whitespace-separated tokens. Text with no Chinese or
// Japanese counts exactly as before.
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30FC]/gu;

export function wordCount(text) {
  const cjk = (text.match(CJK_CHAR) || []).length;
  if (cjk === 0) return text.split(/\s+/).filter(Boolean).length;
  const rest = text.replace(CJK_CHAR, " ").split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token));
  return cjk + rest.length;
}

// A book in Chinese or Japanese is measured in characters, as `story
// wordcount` measures it there: grapheme clusters that are not whitespace,
// punctuation included. A fixture whose `language` is one of these counts
// its length checks this way, so its caps read as the book's own counts.
const CHARACTER_LANGUAGES = /^(?:zh|ja|cmn|yue|lzh|jpn|zho|chi)(?:-|$)/i;
let graphemes;

export function characterCount(text) {
  graphemes ??= new Intl.Segmenter("en", { granularity: "grapheme" });
  let count = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (!/^\s+$/u.test(segment)) count += 1;
  }
  return count;
}

// How a fixture measures length: its counter and the unit it reports.
export function lengthUnit(language) {
  return CHARACTER_LANGUAGES.test(String(language ?? "").trim())
    ? { count: characterCount, name: "characters" }
    : { count: wordCount, name: "words" };
}

// Fenced code blocks are exempt from well-formedness and structural checks:
// a draft that quotes a logbook page or a noticeboard inside fences should
// not fail for the quoted text's spacing, paragraph breaks, or ending.
// Required/banned phrase checks still run on the full text so traps cannot
// hide inside a fence.
function stripCodeFences(text) {
  return text.replace(/```[\s\S]*?```/g, "").replace(/```[\s\S]*$/g, "");
}

// An inline code span that holds a command: `story reindex .` has a space
// before its full stop by design.
const COMMAND_SPAN_RE = /`(?:story|node|bun|bunx|npm|npx|git|gh|claude)[ \t][^`\n]*`/g;

// The prose the well-formedness and structural checks read: the draft
// without its fenced blocks, and with each inline command read as a single
// word. Other inline code keeps its text, so prose in backticks is still
// checked.
function proseText(text) {
  return stripCodeFences(text).replace(COMMAND_SPAN_RE, "code");
}

// Nonblank lines outside code fences: the line count of a poem.
function lines(text) {
  return stripCodeFences(text)
    .split("\n")
    .filter((line) => line.trim() !== "");
}

function paragraphs(text) {
  return stripCodeFences(text)
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Damage a search-and-replace draft leaves behind: doubled spaces mid-line,
// a space before closing punctuation, or two punctuation marks with nothing
// between them ("I !", "our  new", "to ."). French sets a space before
// : ; ! and ? (and inside guillemets), so a fixture with `language: fr`
// checks only commas and full stops for a space before them.
function wellFormed(language) {
  const french = /^fr(?:-|$)/i.test(String(language ?? "").trim());
  return [
    [/\S[^\S\n]{2,}\S/, "no doubled spaces inside a line"],
    french
      ? [/\s[,.]/, "no space before a comma or full stop"]
      : [/\s[,.;:!?]/, "no space before punctuation"],
    [/[,;:!?]\s*[,;:!?]/, "no empty clause between punctuation marks"],
  ];
}

// Binary-contrast scaffolds ("not just X but Y"). Checked on every draft;
// no fixture's ideal output needs one.
const CONTRAST = [
  [
    /\bnot\s+(?:just|only|merely|simply)\b[\s\S]{0,120}?\bbut\b/i,
    "no 'not just X but Y' scaffold",
  ],
  [
    /\b(?:isn't|is not|wasn't|was not|weren't|were not|aren't|are not|it's not|it is not)\s+(?:just|only|merely|simply)\b/i,
    "no 'isn't just X' scaffold",
  ],
  [
    /\bit(?:'s| is)\s+not\b[\s\S]{0,120}?\b(?:it(?:'s| is)|but)\b/i,
    "no 'it's not X, it's Y' scaffold",
  ],
  [
    /\bnot\s+because\b[\s\S]{0,120}?\b(?:but\b(?:\s+because)?|because\b)/i,
    "no 'not because X but because Y' scaffold",
  ],
];

// Voice markers a draft moves even when told to keep the voice:
// contractions, first person, and hedges fall, mean word length rises. Each
// is measured per 100 words on the input and the draft; checks.json's
// "voice_drift" gives the largest change allowed per marker. A possessive
// "'s" still counts as a contraction; only the input-to-draft change
// matters, so the skew cancels out.
const WORD_RE = /[A-Za-z0-9][A-Za-z0-9'’-]*/g;
const CONTRACTION_RE = /\b\w+(?:n['’]t|['’](?:s|re|ve|ll|d|m))\b/gi;
const FIRST_PERSON_RE = /\b(?:I|me|my|mine|myself|we|us|our|ours|ourselves)\b/gi;
const HEDGE_RE =
  /\b(?:I think|I suspect|I guess|probably|perhaps|maybe|sort of|kind of|seems|seemed|apparently|arguably|roughly|might|may|tends? to|not sure)\b/gi;

// Past-tense proxy for the requires_past_tense structural check: strong
// irregular markers plus regular -ed forms. Deliberately coarse — it counts
// "red" as past tense — so the check needs PAST_TENSE_MIN_MARKERS hits, not
// one, and fixtures only opt in where the known-good draft clears it with
// headroom. It is a tripwire for drafts that ignore the brief's tense, not
// a tense classifier.
const PAST_TENSE_RE =
  /\b(?:was|were|had|did|said|told|went|came|took|brought|carried|looked|stood|knew|felt|thought|saw|heard|found|left|kept|put|sat|locked|checked|lifted|asked|\w+ed)\b/gi;
const PAST_TENSE_MIN_MARKERS = 2;

function voiceMetrics(text) {
  const words = text.match(WORD_RE) || [];
  const n = Math.max(words.length, 1);
  const per100 = 100 / n;
  const count = (re) => {
    re.lastIndex = 0;
    return (text.match(re) || []).length;
  };
  return {
    contraction_rate: count(CONTRACTION_RE) * per100,
    first_person_rate: count(FIRST_PERSON_RE) * per100,
    hedge_rate: count(HEDGE_RE) * per100,
    mean_word_length: words.reduce((a, w) => a + w.length, 0) / n,
  };
}

function isNumber(v) {
  return typeof v === "number" && !Number.isNaN(v);
}

// The prose under a `## Chapter Text` heading: from the heading to the next
// fence line (the one that closes the block a fenced chapter file sits in,
// or opens the block after it), the next `#` or `##` heading, or the end of
// the reply. Null when the reply has no such heading.
const CHAPTER_TEXT_RE = /^##\s+chapter text\b[^\n]*$/im;
const CHAPTER_TEXT_END_RE = /^(?: {0,3}(?:`{3,}|~{3,})|#{1,2}[ \t])/m;

function chapterTextOrNull(text) {
  const m = CHAPTER_TEXT_RE.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const end = CHAPTER_TEXT_END_RE.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

// The chapter text, or the whole text when it has none. A fixture with
// `"keep": "file"` scores the whole chapter file, but its brief's length
// limit is about the prose, so its length checks count only this.
export function chapterText(text) {
  return chapterTextOrNull(text) ?? text;
}

const FENCE_LINE_RE = /^---[ \t]*$/;
// A line a frontmatter block may hold: a top-level key, an indented line,
// a list item, or a blank line. A heading or prose line ends the block.
const FRONTMATTER_LINE_RE = /^(?:[\w-]+:(?:\s|$)|[ \t]+\S|-[ \t]|\s*$)/;

// The frontmatter of the chapter file in a reply: the last `---` block of
// YAML lines that closes before the `## Chapter Text` heading. A `---` rule
// between the outline and the chapter text opens no block. Null when there
// is none.
function chapterFrontmatterOrNull(text) {
  const m = CHAPTER_TEXT_RE.exec(text);
  if (!m) return null;
  const lines = text.slice(0, m.index).split("\n");
  let found = null;
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE_LINE_RE.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !FENCE_LINE_RE.test(lines[j]) && FRONTMATTER_LINE_RE.test(lines[j])) j++;
    if (j < lines.length && j > i + 1 && FENCE_LINE_RE.test(lines[j])) {
      found = lines.slice(i + 1, j).join("\n");
      i = j;
    }
  }
  return found;
}

// The parts of a reply a fixture can scope checks to (`chapter_text`,
// `chapter_frontmatter` in checks.json), each with the label its results
// carry.
const SCOPES = [
  ["chapter_text", "chapter text", chapterTextOrNull],
  ["chapter_frontmatter", "chapter frontmatter", chapterFrontmatterOrNull],
];

// Quoted speech, so the narration checks can leave it out: an "I" in a line
// of dialogue is not first-person narration. Single quotes count only away
// from letters, so an apostrophe (didn't, Tomas') is not one. Each quote is
// bounded so an unclosed one cannot make the scan quadratic.
const DIALOGUE_RE =
  /"[^"\n]{0,2000}"|“[^”\n]{0,2000}”|«[^»\n]{0,2000}»|(?<![\p{L}\p{N}])'(?:[^'\n]|'(?=\p{L})){0,2000}?'(?![\p{L}\p{N}])/gu;

function narration(text) {
  return text.replace(DIALOGUE_RE, " ");
}

// First-person action verbs in the present ("I take the key"): narration a
// past-tense brief rules out. Reflective verbs (I am, I think, I wonder) are
// left out, since past-tense narration uses them too, and so are verbs whose
// past is the same word (put, set, shut).
const PRESENT_TENSE_ACTION_RE =
  /\bI (?:take|turn|kneel|walk|climb|carry|hold|stand|sit|look|reach|open|light|trim|lift|weigh|wait|pull|push|step|press|grab|drop|touch|unlock|pick|lean)\b/i;

function runPattern(pattern, text, flags = "iu") {
  return new RegExp(pattern, flags).test(text);
}

/**
 * The phrase, pattern, and order checks of `checks` on `text`, each result
 * labelled with `prefix`. A null `text` is a scope the draft lacks: every
 * check fails, so a draft without the part scores no better for it.
 */
function textChecks(checks, text, language, prefix = "", missing = "") {
  const results = [];
  const push = (ok, desc) => results.push([text !== null && ok, `${prefix}${desc}${text === null ? missing : ""}`]);
  const body = text ?? "";

  for (const fact of checks.required || []) {
    if (typeof fact !== "string") {
      results.push([false, `${prefix}required canon must be a string, got ${fact}`]);
      continue;
    }
    push(phraseFound(fact, body, true, language), `canon kept: "${fact}"`);
  }

  for (const phrase of checks.banned || []) {
    if (typeof phrase !== "string") {
      results.push([false, `${prefix}banned phrase must be a string, got ${phrase}`]);
      continue;
    }
    // Banned phrases inflect like required ones: a draft that "delves",
    // "treasures", or "shows Petra the keys" springs the same trap as the
    // base form. See phraseFound's inflect flag.
    push(!phraseFound(phrase, body, true, language), `trap avoided: "${phrase}"`);
  }

  for (const pattern of checks.required_regex || []) {
    if (typeof pattern !== "string") {
      results.push([false, `${prefix}required pattern must be a string, got ${pattern}`]);
      continue;
    }
    let ok;
    try {
      ok = runPattern(pattern, body);
    } catch (err) {
      results.push([false, `${prefix}required pattern invalid: /${pattern}/ (${err})`]);
      continue;
    }
    push(ok, `canon kept: /${pattern}/`);
  }

  for (const pattern of checks.banned_regex || []) {
    if (typeof pattern !== "string") {
      results.push([false, `${prefix}banned pattern must be a string, got ${pattern}`]);
      continue;
    }
    let ok;
    try {
      // Unicode mode, so a pattern can bound a word with \p{L}, which
      // holds next to accented letters where \b does not.
      ok = runPattern(pattern, body) === false;
    } catch (err) {
      results.push([false, `${prefix}banned pattern invalid: /${pattern}/ (${err})`]);
      continue;
    }
    push(ok, `trap avoided: /${pattern}/`);
  }

  // Each pattern of a sequence must match after the previous one's match:
  // one forward scan, so the check stays linear where a single pattern of
  // the form a[\s\S]*?b[\s\S]*?c would not.
  for (const sequence of checks.required_in_order || []) {
    if (!Array.isArray(sequence) || !sequence.every((p) => typeof p === "string")) {
      results.push([false, `${prefix}required_in_order entries must be lists of patterns, got ${JSON.stringify(sequence)}`]);
      continue;
    }
    const desc = `in order: ${sequence.map((p) => `/${p}/`).join(", then ")}`;
    let ok = true;
    try {
      let from = 0;
      for (const pattern of sequence) {
        const re = new RegExp(pattern, "giu");
        re.lastIndex = from;
        const m = re.exec(body);
        if (!m) {
          ok = false;
          break;
        }
        from = m.index + m[0].length;
      }
    } catch (err) {
      results.push([false, `${prefix}required_in_order pattern invalid (${err})`]);
      continue;
    }
    push(ok, desc);
  }
  return results;
}

// The voice checks of a `chapter_text` scope, on its narration: quoted
// dialogue is left out, and past tense also fails a first-person action verb
// in the present.
function narrationChecks(checks, text, prefix, missing) {
  const results = [];
  const told = narration(text ?? "");
  const push = (ok, desc) => results.push([text !== null && ok, `${prefix}${desc}${text === null ? missing : ""}`]);
  if (checks.requires_first_person === true) {
    FIRST_PERSON_RE.lastIndex = 0;
    push(FIRST_PERSON_RE.test(told), "first-person narration present");
  }
  if (checks.requires_past_tense === true) {
    PAST_TENSE_RE.lastIndex = 0;
    const markers = told.match(PAST_TENSE_RE) || [];
    const present = told.match(PRESENT_TENSE_ACTION_RE);
    push(
      markers.length >= PAST_TENSE_MIN_MARKERS && !present,
      `past-tense narration (${markers.length} marker(s), need ${PAST_TENSE_MIN_MARKERS}${present ? `; present tense: "${present[0]}"` : ""})`
    );
  }
  return results;
}

export function checkDraft(checks, inputText, draftText) {
  const results = [];
  const normDraft = normalizeApos(draftText);
  const normInput = normalizeApos(inputText);
  const proseOnly = proseText(normDraft);

  for (const key of Object.keys(checks)) {
    if (!CHECK_KEYS.has(key)) results.push([false, `checks.json: unknown key ${JSON.stringify(key)}`]);
  }
  results.push(...textChecks(checks, normDraft, checks.language));
  for (const [key, label, find] of SCOPES) {
    const scoped = checks[key];
    if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) continue;
    const text = find(normDraft);
    const prefix = `${label}: `;
    const missing = ` (no ${label} in the draft)`;
    results.push(...textChecks(scoped, text, checks.language, prefix, missing));
    if (key === "chapter_text") results.push(...narrationChecks(scoped, text, prefix, missing));
  }

  for (const [pattern, desc] of wellFormed(checks.language)) {
    results.push([!pattern.test(proseOnly), `well formed: ${desc}`]);
  }

  // Collapse whitespace for structure checks so scaffolds split across
  // lines or sentences still match.
  const contrastText = proseOnly.replace(/\s+/g, " ");
  for (const [pattern, desc] of CONTRAST) {
    results.push([!pattern.test(contrastText), `structure: ${desc}`]);
  }

  // Structural promises made by fixture briefs, checked only when the
  // fixture opts in via checks.json. All are smoke-test proxies, not
  // literary judgments; see evals/README.md.
  if (checks.paragraphs !== undefined) {
    const count = paragraphs(draftText).length;
    results.push([
      count === checks.paragraphs,
      `structure: ${count} paragraph(s), brief asks for ${checks.paragraphs}`,
    ]);
  }
  if (checks.lines !== undefined) {
    const count = lines(draftText).length;
    results.push([
      count === checks.lines,
      `structure: ${count} line(s), brief asks for ${checks.lines}`,
    ]);
  }
  if (checks.ends_with_question === true) {
    results.push([
      proseOnly.trim().endsWith("?"),
      `structure: ends on a question`,
    ]);
  }
  if (checks.requires_first_person === true) {
    FIRST_PERSON_RE.lastIndex = 0;
    results.push([
      FIRST_PERSON_RE.test(narration(proseOnly)),
      `structure: first-person voice present`,
    ]);
  }
  if (checks.requires_past_tense === true) {
    PAST_TENSE_RE.lastIndex = 0;
    const markers = proseOnly.match(PAST_TENSE_RE) || [];
    const present = narration(proseOnly).match(PRESENT_TENSE_ACTION_RE);
    results.push([
      markers.length >= PAST_TENSE_MIN_MARKERS && !present,
      `structure: past-tense voice present (${markers.length} marker(s), need ${PAST_TENSE_MIN_MARKERS}${present ? `; present tense: "${present[0]}"` : ""})`,
    ]);
  }
  const unit = lengthUnit(checks.language);
  const proseOnlyLength = checks.keep === "file" && CHAPTER_TEXT_RE.test(draftText);
  const lengthText = proseOnlyLength ? chapterText(draftText) : draftText;
  const lengthOf = proseOnlyLength ? " of the chapter text" : "";
  if (checks.max_words !== undefined) {
    const count = unit.count(lengthText);
    results.push([
      count <= checks.max_words,
      `length${lengthOf} ${count} ${unit.name} <= ${checks.max_words} (absolute cap)`,
    ]);
  }

  const maxRatio = checks.max_words_ratio;
  const minRatio = checks.min_words_ratio;
  if (maxRatio !== undefined || minRatio !== undefined) {
    const ratio = unit.count(lengthText) / Math.max(unit.count(inputText), 1);
    if (maxRatio !== undefined) {
      results.push([
        ratio <= maxRatio,
        `length ratio${lengthOf} ${ratio.toFixed(2)} <= ${maxRatio} (no padding)`,
      ]);
    }
    if (minRatio !== undefined) {
      results.push([
        ratio >= minRatio,
        `length ratio${lengthOf} ${ratio.toFixed(2)} >= ${minRatio} (no over-cutting)`,
      ]);
    }
  }

  const drift = checks.voice_drift;
  if (drift) {
    // Rate markers fail when the draft falls below the limit. Mean word
    // length fails when it rises. The other direction is a warning.
    const STRIP_DIRECTION = {
      contraction_rate: "fall",
      first_person_rate: "fall",
      hedge_rate: "fall",
      mean_word_length: "rise",
    };
    const before = voiceMetrics(normInput);
    const after = voiceMetrics(normDraft);
    for (const [name, limit] of Object.entries(drift)) {
      if (!KNOWN_MARKERS.has(name)) {
        results.push([
          false,
          `voice kept: unknown marker "${name}" (known: ${[...KNOWN_MARKERS].sort().join(", ")})`,
        ]);
        continue;
      }
      if (!isNumber(limit)) {
        results.push([
          false,
          `voice kept: limit for ${name} must be a number, got ${limit}`,
        ]);
        continue;
      }
      const delta = after[name] - before[name];
      const change = `${before[name].toFixed(1)} -> ${after[name].toFixed(1)} (change ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}, limit ${limit})`;
      const strips =
        (STRIP_DIRECTION[name] === "fall" && delta < -limit) ||
        (STRIP_DIRECTION[name] === "rise" && delta > limit);
      if (strips) {
        results.push([false, `voice kept: ${name} ${change} (voice stripped)`]);
      } else if (Math.abs(delta) > limit) {
        results.push([true, `voice note (warn): ${name} ${change} (overshoot, not stripping)`]);
      } else {
        results.push([true, `voice kept: ${name} ${change}`]);
      }
    }
  }

  return results;
}

export function runOne(fixtureDir, draftPath) {
  const { checks, inputText } = loadFixture(fixtureDir);
  const draftText = fs.readFileSync(draftPath, "utf8");
  const results = checkDraft(checks, inputText, draftText);
  const name = checks.name || path.basename(fixtureDir);
  const failures = results.filter(([ok]) => !ok).map(([, desc]) => desc);
  console.log(`${name}: ${results.length - failures.length}/${results.length} checks passed`);
  for (const desc of failures) console.log(`  FAIL ${desc}`);
  return failures.length === 0;
}

// `argv` is process.argv.slice(1): the script path, then the arguments.
export function main(argv) {
  if (argv.length !== 3) {
    console.log(
      "Usage:\n  node evals/run-evals.js <fixture-dir> <draft-file>\n  node evals/run-evals.js --all <outputs-dir>"
    );
    return 2;
  }
  if (argv[1] === "--all") {
    const outputsDir = argv[2];
    let fixtures;
    try {
      fixtures = fs
        .readdirSync(FIXTURES_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(FIXTURES_DIR, e.name))
        .sort();
    } catch (err) {
      console.log(`FAIL (cannot list fixtures in ${FIXTURES_DIR}: ${err})`);
      return 2;
    }
    if (fixtures.length === 0) {
      console.log(`no fixtures found in ${FIXTURES_DIR}`);
      return 2;
    }
    let allOk = true;
    for (const fixtureDir of fixtures) {
      const draftPath = path.join(outputsDir, `${path.basename(fixtureDir)}.md`);
      if (!fs.existsSync(draftPath)) {
        console.log(`${path.basename(fixtureDir)}: FAIL (no draft at ${draftPath})`);
        allOk = false;
        continue;
      }
      try {
        if (!runOne(fixtureDir, draftPath)) allOk = false;
      } catch (err) {
        console.log(`${path.basename(fixtureDir)}: FAIL (bad fixture: ${err})`);
        allOk = false;
      }
    }
    return allOk ? 0 : 1;
  }
  try {
    return runOne(argv[1], argv[2]) ? 0 : 1;
  } catch (err) {
    console.log(`FAIL (bad fixture or draft: ${err})`);
    return 2;
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) process.exit(main(process.argv.slice(1)));

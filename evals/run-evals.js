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

function normalizeApos(text) {
  return text.replace(/[’‘ʼ]/g, "'");
}

// Flexible separator for phrase matching: spaces, hyphens, dashes, newlines,
// and underscores are equivalent ("sea-chest" matches "sea chest"). Used to
// build word-boundary regexes from checks.json phrases so punctuation does
// not matter, while partial-word matches ("key" in "turkey", "Ana" in
// "Indiana") still fail.
const FLEX_SEP_SRC = "[\\s\\-—–―−‐‑_]+";

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phrasePattern(phrase, inflect = false) {
  const norm = normalizeApos(phrase);
  if (!/[A-Za-z0-9]/.test(norm)) return null;
  const parts = norm.split(new RegExp(FLEX_SEP_SRC)).filter(Boolean);
  if (parts.length === 0) return null;
  const innerPieces = parts.map((p) => [...p].map(escapeRegExp).join(""));
  let inner = innerPieces.join(FLEX_SEP_SRC);
  const first = parts[0][0];
  const last = parts[parts.length - 1].slice(-1);
  let left;
  if (/\d/.test(first)) left = "(?<!\\d)";
  else if (/[A-Za-z0-9_]/.test(first)) left = "(?<!\\w)";
  else left = "";
  let right;
  if (/\d/.test(last)) right = "(?!\\d)";
  else if (/[A-Za-z0-9_]/.test(last)) {
    // With inflect=true (required canon), a trailing inflection is allowed
    // so "logbook" matches "logbooks" while "key" still does not match
    // "turkey".
    if (inflect) inner += "(?:s|es|ed|ing|d)?";
    right = "(?!\\w)";
  } else right = "";
  return left + inner + right;
}

function phraseFound(phrase, text, inflect = false) {
  const normText = normalizeApos(text);
  const pattern = phrasePattern(phrase, inflect);
  const fallback = () =>
    normText.toLowerCase().includes(normalizeApos(phrase).toLowerCase());
  if (pattern === null) return fallback();
  try {
    return new RegExp(pattern, "i").test(normText);
  } catch {
    return fallback();
  }
}

export function loadFixture(fixtureDir) {
  const checks = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, "checks.json"), "utf8")
  );
  const inputText = fs.readFileSync(path.join(fixtureDir, "input.md"), "utf8");
  return { checks, inputText };
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// Damage a search-and-replace draft leaves behind: doubled spaces mid-line,
// a space before closing punctuation, or two punctuation marks with nothing
// between them ("I !", "our  new", "to .").
const WELL_FORMED = [
  [/\S[^\S\n]{2,}\S/, "no doubled spaces inside a line"],
  [/\s[,.;:!?]/, "no space before punctuation"],
  [/[,;:!?]\s*[,;:!?]/, "no empty clause between punctuation marks"],
];

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

export function checkDraft(checks, inputText, draftText) {
  const results = [];
  const normDraft = normalizeApos(draftText);
  const normInput = normalizeApos(inputText);

  for (const fact of checks.required || []) {
    if (typeof fact !== "string") {
      results.push([false, `required canon must be a string, got ${fact}`]);
      continue;
    }
    results.push([
      phraseFound(fact, normDraft, true),
      `canon kept: "${fact}"`,
    ]);
  }

  for (const phrase of checks.banned || []) {
    if (typeof phrase !== "string") {
      results.push([false, `banned phrase must be a string, got ${phrase}`]);
      continue;
    }
    results.push([
      !phraseFound(phrase, normDraft, false),
      `trap avoided: "${phrase}"`,
    ]);
  }

  for (const pattern of checks.banned_regex || []) {
    if (typeof pattern !== "string") {
      results.push([false, `banned pattern must be a string, got ${pattern}`]);
      continue;
    }
    let ok;
    try {
      ok = new RegExp(pattern, "i").test(normDraft) === false;
    } catch (err) {
      results.push([false, `banned pattern invalid: /${pattern}/ (${err})`]);
      continue;
    }
    results.push([ok, `trap avoided: /${pattern}/`]);
  }

  for (const [pattern, desc] of WELL_FORMED) {
    results.push([!pattern.test(normDraft), `well formed: ${desc}`]);
  }

  // Collapse whitespace for structure checks so scaffolds split across
  // lines or sentences still match.
  const contrastText = normDraft.replace(/\s+/g, " ");
  for (const [pattern, desc] of CONTRAST) {
    results.push([!pattern.test(contrastText), `structure: ${desc}`]);
  }

  const maxRatio = checks.max_words_ratio;
  const minRatio = checks.min_words_ratio;
  if (maxRatio !== undefined || minRatio !== undefined) {
    const ratio = wordCount(draftText) / Math.max(wordCount(inputText), 1);
    if (maxRatio !== undefined) {
      results.push([
        ratio <= maxRatio,
        `length ratio ${ratio.toFixed(2)} <= ${maxRatio} (no padding)`,
      ]);
    }
    if (minRatio !== undefined) {
      results.push([
        ratio >= minRatio,
        `length ratio ${ratio.toFixed(2)} >= ${minRatio} (no over-cutting)`,
      ]);
    }
  }

  const drift = checks.voice_drift;
  if (drift) {
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
      results.push([
        Math.abs(delta) <= limit,
        `voice kept: ${name} ${before[name].toFixed(1)} -> ${after[name].toFixed(1)} (change ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}, limit ${limit})`,
      ]);
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

function main(argv) {
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

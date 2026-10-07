#!/usr/bin/env node
/**
 * Validate eval fixtures and their known-good examples.
 *
 * Checks that every fixture in evals/fixtures/ has an input.md and a
 * checks.json with a brief, at least one check, valid JSON, and compiling
 * regexes, plus a known-good draft in evals/examples/<fixture>.md (and no
 * stray examples). A fixture whose known-good draft opens with frontmatter
 * must set `keep: file`. Run from anywhere; exits non-zero on failure.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const KNOWN_VOICE_KEYS = new Set([
  "contraction_rate",
  "first_person_rate",
  "hedge_rate",
  "mean_word_length",
]);

function isNumber(v) {
  return typeof v === "number" && !Number.isNaN(v);
}

function nonemptyStrings(list) {
  return Array.isArray(list) && list.some((item) => typeof item === "string" && item.trim() !== "");
}

function voiceDriftActive(drift) {
  return Boolean(drift) && typeof drift === "object" && !Array.isArray(drift)
    && Object.entries(drift).some(([key, value]) => KNOWN_VOICE_KEYS.has(key) && isNumber(value));
}

const OVERLAP_KINDS = ["in_input", "with_required"];

// What `run-skill.js` scores of a chapter reply: the prose under
// `## Chapter Text` (the default) or the whole file, frontmatter included.
const KEEP_VALUES = ["chapter-text", "file"];

const trimmed = (s) => String(s).trim();
const lowered = (s) => String(s).toLowerCase();

/**
 * The two phrase collisions a fixture can carry: a banned phrase the input
 * already contains, and a banned phrase that sits inside a required one, so
 * a draft that keeps the canon also trips the trap. The other direction (a
 * banned "it was Ana" beside a required "Ana") is harmless: keeping "Ana"
 * cannot produce the longer phrase. Returns both as lists of `[phrase]` / `[phrase, fact]`
 * entries, in fixture order.
 */
export function findOverlaps(checks, inputText) {
  const found = { in_input: [], with_required: [] };
  const input = lowered(inputText);
  for (const phrase of checks.banned || []) {
    if (typeof phrase !== "string" || phrase.trim() === "") continue;
    const banned = trimmed(phrase);
    if (input.includes(lowered(banned))) found.in_input.push([banned]);
    for (const fact of checks.required || []) {
      if (typeof fact !== "string" || fact.trim() === "") continue;
      const required = trimmed(fact);
      const b = lowered(banned);
      const r = lowered(required);
      if (r.includes(b)) found.with_required.push([banned, required]);
    }
  }
  return found;
}

// Overlap entries are keyed on their lowercased parts joined by a NUL, so a
// one-part key can never collide with a two-part one.
function overlapKey(entry) {
  return entry.map((part) => lowered(trimmed(part))).join("\u0000");
}

/**
 * Compare a fixture's real overlaps against the ones its checks.json
 * acknowledges in `expected_overlaps`.
 *
 * An unacknowledged overlap warns, so a new collision is what the output
 * says. A stale acknowledgement fails, so an entry cannot outlive the
 * phrase it covers: that is what keeps the list an acknowledgement rather
 * than a mute button. A malformed `expected_overlaps` fails and
 * acknowledges nothing.
 */
export function checkFixtureOverlaps(failures, warnings, fixtureName, checks, inputText) {
  const acknowledged = { in_input: new Map(), with_required: new Map() };
  const expected = checks.expected_overlaps;
  if (expected !== undefined) {
    if (typeof expected !== "object" || expected === null || Array.isArray(expected)) {
      failures.push(`${fixtureName}/checks.json: expected_overlaps must be an object`);
    } else {
      for (const key of Object.keys(expected)) {
        if (OVERLAP_KINDS.includes(key)) continue;
        failures.push(
          `${fixtureName}/checks.json: expected_overlaps has unknown key ${JSON.stringify(key)} ` +
            `(known: ${OVERLAP_KINDS.join(", ")})`
        );
      }
      for (const kind of OVERLAP_KINDS) {
        if (!(kind in expected)) continue;
        const width = kind === "in_input" ? 1 : 2;
        const entries = expected[kind];
        const shaped =
          Array.isArray(entries) &&
          entries.every(
            (entry) =>
              Array.isArray(entry) &&
              entry.length === width &&
              entry.every((part) => typeof part === "string" && part.trim() !== "")
          );
        if (!shaped) {
          failures.push(
            `${fixtureName}/checks.json: expected_overlaps.${kind} must be a list of ` +
              `${width}-string entries`
          );
          continue;
        }
        for (const entry of entries) acknowledged[kind].set(overlapKey(entry), entry);
      }
    }
  }

  const found = findOverlaps(checks, inputText);
  const seen = { in_input: new Set(), with_required: new Set() };
  for (const [banned] of found.in_input) {
    const key = overlapKey([banned]);
    seen.in_input.add(key);
    if (acknowledged.in_input.has(key)) continue;
    warnings.push(
      `${fixtureName}: banned phrase ${JSON.stringify(banned)} appears in input.md — ` +
        `drafts quoting that context will fail unless the brief tells the model to remove it ` +
        `(acknowledge it in expected_overlaps.in_input if it is deliberate)`
    );
  }
  for (const [banned, required] of found.with_required) {
    const key = overlapKey([banned, required]);
    seen.with_required.add(key);
    if (acknowledged.with_required.has(key)) continue;
    warnings.push(
      `${fixtureName}: banned ${JSON.stringify(banned)} overlaps required ${JSON.stringify(required)} — ` +
        `keeping the canon may trip the trap ` +
        `(acknowledge it in expected_overlaps.with_required if it is deliberate)`
    );
  }
  for (const kind of OVERLAP_KINDS) {
    for (const [key, entry] of acknowledged[kind]) {
      if (seen[kind].has(key)) continue;
      failures.push(
        `${fixtureName}/checks.json: expected_overlaps.${kind} entry ` +
          `${JSON.stringify(entry)} no longer collides — remove it`
      );
    }
  }
  return failures;
}

export function checkFixtureSkill(failures, skillsDir, skillName, fixtureName, exists) {
  const skill = typeof skillName === "string" ? skillName.trim() : "";
  if (skill === "") {
    failures.push(`${fixtureName}/checks.json: skill must be a non-empty string naming the skill under test`);
    return failures;
  }
  if (!exists(path.join(skillsDir, skill, "SKILL.md"))) {
    failures.push(`${fixtureName}/checks.json: skill "${skill}" does not match a skill in skills/`);
  }
  return failures;
}

// Checks evals/fixtures and evals/examples under `root` and returns the exit
// status, printing each line through `log`.
export function checkEvals(root = ROOT, log = console.log) {
  const fixturesDir = path.join(root, "evals", "fixtures");
  const examplesDir = path.join(root, "evals", "examples");
  const errors = [];
  const warnings = [];
  const check = (cond, msg) => {
    if (!cond) errors.push(msg);
  };
  if (!fs.existsSync(fixturesDir)) {
    log("FAIL evals/fixtures: missing directory");
    return 1;
  }
  if (!fs.existsSync(examplesDir)) {
    log("FAIL evals/examples: missing directory");
    return 1;
  }
  const fixtures = fs
    .readdirSync(fixturesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  check(fixtures.length > 0, "evals/fixtures: no fixtures found");

  for (const name of fixtures) {
    const dir = path.join(fixturesDir, name);
    check(
      fs.existsSync(path.join(dir, "input.md")),
      `${name}: missing input.md`
    );
    check(
      fs.existsSync(path.join(examplesDir, `${name}.md`)),
      `evals/examples/${name}.md: missing known-good draft`
    );
    const checksPath = path.join(dir, "checks.json");
    if (!fs.existsSync(checksPath)) {
      errors.push(`${name}: missing checks.json`);
      continue;
    }
    let checks;
    try {
      checks = JSON.parse(fs.readFileSync(checksPath, "utf8"));
    } catch (err) {
      errors.push(`${name}/checks.json: invalid JSON (${err.message})`);
      continue;
    }
    if (typeof checks !== "object" || checks === null || Array.isArray(checks)) {
      errors.push(`${name}/checks.json: top level must be an object`);
      continue;
    }
    check(
      typeof checks.brief === "string" && checks.brief.trim().length > 0,
      `${name}/checks.json: brief must be a non-empty string`
    );
    checkFixtureSkill(errors, path.join(root, "skills"), checks.skill, name, (skillPath) =>
      fs.existsSync(skillPath)
    );
    for (const key of ["required", "required_regex", "banned", "banned_regex"]) {
      if (key in checks) {
        check(
          Array.isArray(checks[key]) && checks[key].every((s) => typeof s === "string" && s.trim() !== ""),
          `${name}/checks.json: ${key} must be a list of non-empty strings`
        );
      }
    }
    for (const key of ["max_words_ratio", "min_words_ratio", "max_words"]) {
      if (key in checks) {
        check(
          isNumber(checks[key]) && checks[key] > 0,
          `${name}/checks.json: ${key} must be a positive number`
        );
      }
    }
    for (const key of ["paragraphs", "lines"]) {
      if (key in checks) {
        check(
          Number.isInteger(checks[key]) && checks[key] > 0,
          `${name}/checks.json: ${key} must be a positive integer`
        );
      }
    }
    for (const key of ["ends_with_question", "requires_first_person", "requires_past_tense"]) {
      if (key in checks) {
        check(
          typeof checks[key] === "boolean",
          `${name}/checks.json: ${key} must be a boolean`
        );
      }
    }
    if ("language" in checks) {
      check(
        typeof checks.language === "string" && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(checks.language),
        `${name}/checks.json: language must be a BCP 47 tag such as fr, ja, or ar`
      );
    }
    if ("keep" in checks) {
      check(
        KEEP_VALUES.includes(checks.keep),
        `${name}/checks.json: keep must be one of ${KEEP_VALUES.map((v) => JSON.stringify(v)).join(", ")}`
      );
    }
    // A known-good draft that opens with frontmatter is a whole file, and
    // only `keep: file` asks the model for one: under the default prose rule
    // the brief and the system prompt contradict each other.
    const examplePath = path.join(examplesDir, `${name}.md`);
    if (checks.keep !== "file" && fs.existsSync(examplePath)) {
      check(
        !/^---\r?\n/.test(fs.readFileSync(examplePath, "utf8")),
        `${name}/checks.json: evals/examples/${name}.md opens with frontmatter, so set "keep": "file"`
      );
    }
    if ("voice_drift" in checks) {
      const drift = checks.voice_drift;
      if (typeof drift !== "object" || drift === null || Array.isArray(drift)) {
        errors.push(`${name}/checks.json: voice_drift must be an object`);
      } else {
        for (const [key, val] of Object.entries(drift)) {
          check(
            KNOWN_VOICE_KEYS.has(key),
            `${name}/checks.json: voice_drift has unknown key ${JSON.stringify(key)}`
          );
          if (KNOWN_VOICE_KEYS.has(key)) {
            check(
              isNumber(val),
              `${name}/checks.json: voice_drift[${key}] must be numeric`
            );
          }
        }
        check(
          voiceDriftActive(drift),
          `${name}/checks.json: voice_drift must include a known numeric marker`
        );
      }
    }
    const voiceActive = voiceDriftActive(checks.voice_drift);
    check(
      nonemptyStrings(checks.required) ||
        nonemptyStrings(checks.banned) ||
        nonemptyStrings(checks.required_regex) ||
        nonemptyStrings(checks.banned_regex) ||
        checks.max_words_ratio !== undefined ||
        checks.min_words_ratio !== undefined ||
        checks.max_words !== undefined ||
        checks.paragraphs !== undefined ||
        checks.ends_with_question === true ||
        checks.requires_first_person === true ||
        checks.requires_past_tense === true ||
        voiceActive,
      `${name}/checks.json: defines no required, required_regex, banned, banned_regex, length, structural, or voice_drift checks`
    );
    for (const key of ["required_regex", "banned_regex"]) {
      for (const pattern of Array.isArray(checks[key]) ? checks[key] : []) {
        if (typeof pattern !== "string") continue;
        try {
          new RegExp(pattern, "iu");
        } catch (err) {
          errors.push(`${name}/checks.json: ${key} /${pattern}/ does not compile (${err.message})`);
        }
      }
    }

    // Cross-check phrases against the fixture input and its canon. Both
    // collisions are warnings, not errors: anti-slop-style briefs ("rewrite
    // without X") deliberately seed the input with the banned tells, and a
    // trap often has to contain a required name ("it was Petra").
    let inputText = "";
    try {
      inputText = fs.readFileSync(path.join(dir, "input.md"), "utf8");
    } catch {
      inputText = "";
    }
    checkFixtureOverlaps(errors, warnings, name, checks, inputText);
  }

  for (const file of fs.readdirSync(examplesDir).sort()) {
    if (!file.endsWith(".md")) continue;
    check(
      fixtures.includes(path.basename(file, ".md")),
      `evals/examples/${file}: no matching fixture`
    );
  }

  if (errors.length > 0) {
    for (const e of errors) log(`FAIL ${e}`);
    for (const w of warnings) log(`WARN ${w}`);
    log(`${errors.length} problem(s) found`);
    return 1;
  }
  for (const w of warnings) log(`WARN ${w}`);
  log("all eval fixture checks passed");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(checkEvals());
}

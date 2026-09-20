#!/usr/bin/env node
/**
 * Validate eval fixtures and their known-good examples.
 *
 * Checks that every fixture in evals/fixtures/ has an input.md and a
 * checks.json with a brief, at least one check, valid JSON, and compiling
 * regexes, plus a known-good draft in evals/examples/<fixture>.md (and no
 * stray examples). Run from anywhere; exits non-zero on failure.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES_DIR = path.join(ROOT, "evals", "fixtures");
const EXAMPLES_DIR = path.join(ROOT, "evals", "examples");

const KNOWN_VOICE_KEYS = new Set([
  "contraction_rate",
  "first_person_rate",
  "hedge_rate",
  "mean_word_length",
]);

const errors = [];
const warnings = [];
const check = (cond, msg) => {
  if (!cond) errors.push(msg);
};
const warn = (msg) => {
  warnings.push(msg);
};

function isNumber(v) {
  return typeof v === "number" && !Number.isNaN(v);
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

function main() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    console.log("FAIL evals/fixtures: missing directory");
    return 1;
  }
  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.log("FAIL evals/examples: missing directory");
    return 1;
  }
  const fixtures = fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  check(fixtures.length > 0, "evals/fixtures: no fixtures found");

  for (const name of fixtures) {
    const dir = path.join(FIXTURES_DIR, name);
    check(
      fs.existsSync(path.join(dir, "input.md")),
      `${name}: missing input.md`
    );
    check(
      fs.existsSync(path.join(EXAMPLES_DIR, `${name}.md`)),
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
    checkFixtureSkill(errors, path.join(ROOT, "skills"), checks.skill, name, (skillPath) =>
      fs.existsSync(skillPath)
    );
    for (const key of ["required", "banned", "banned_regex"]) {
      if (key in checks) {
        check(
          Array.isArray(checks[key]) && checks[key].every((s) => typeof s === "string"),
          `${name}/checks.json: ${key} must be a list of strings`
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
    if ("paragraphs" in checks) {
      check(
        Number.isInteger(checks.paragraphs) && checks.paragraphs > 0,
        `${name}/checks.json: paragraphs must be a positive integer`
      );
    }
    for (const key of ["ends_with_question", "requires_first_person", "requires_past_tense"]) {
      if (key in checks) {
        check(
          typeof checks[key] === "boolean",
          `${name}/checks.json: ${key} must be a boolean`
        );
      }
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
      }
    }
    check(
      (checks.required && checks.required.length > 0) ||
        (checks.banned && checks.banned.length > 0) ||
        (checks.banned_regex && checks.banned_regex.length > 0) ||
        checks.max_words_ratio !== undefined ||
        checks.min_words_ratio !== undefined ||
        checks.max_words !== undefined ||
        checks.paragraphs !== undefined ||
        checks.ends_with_question !== undefined ||
        checks.requires_first_person !== undefined ||
        checks.requires_past_tense !== undefined ||
        checks.voice_drift !== undefined,
      `${name}/checks.json: defines no required, banned, banned_regex, length, structural, or voice_drift checks`
    );
    for (const pattern of checks.banned_regex || []) {
      if (typeof pattern !== "string") continue;
      try {
        new RegExp(pattern, "i");
      } catch (err) {
        errors.push(`${name}/checks.json: banned_regex /${pattern}/ does not compile (${err.message})`);
      }
    }

    // Cross-check phrases against the fixture input. Both are warnings, not
    // errors: anti-slop-style briefs ("rewrite without X") deliberately seed
    // the input with the banned tells, and near-overlaps can be intentional.
    let inputText = "";
    try {
      inputText = fs.readFileSync(path.join(dir, "input.md"), "utf8");
    } catch {
      inputText = "";
    }
    const lowered = (s) => String(s).toLowerCase();
    for (const phrase of checks.banned || []) {
      if (typeof phrase !== "string" || phrase.trim() === "") continue;
      if (lowered(inputText).includes(lowered(phrase.trim()))) {
        warn(
          `${name}: banned phrase ${JSON.stringify(phrase)} appears in input.md — ` +
            `drafts quoting that context will fail unless the brief tells the model to remove it`
        );
      }
      for (const fact of checks.required || []) {
        if (typeof fact !== "string" || fact.trim() === "") continue;
        const b = lowered(phrase.trim());
        const r = lowered(fact.trim());
        if (b.includes(r) || r.includes(b)) {
          warn(
            `${name}: banned ${JSON.stringify(phrase)} overlaps required ${JSON.stringify(fact)} — ` +
              `keeping the canon may trip the trap`
          );
        }
      }
    }
  }

  for (const file of fs.readdirSync(EXAMPLES_DIR).sort()) {
    if (!file.endsWith(".md")) continue;
    check(
      fixtures.includes(path.basename(file, ".md")),
      `evals/examples/${file}: no matching fixture`
    );
  }

  if (errors.length > 0) {
    for (const e of errors) console.log(`FAIL ${e}`);
    for (const w of warnings) console.log(`WARN ${w}`);
    console.log(`${errors.length} problem(s) found`);
    return 1;
  }
  for (const w of warnings) console.log(`WARN ${w}`);
  console.log("all eval fixture checks passed");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

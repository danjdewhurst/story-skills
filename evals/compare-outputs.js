#!/usr/bin/env node
/**
 * Pairwise comparison of two sets of drafts with a model as judge.
 *
 * Usage:
 *   node evals/compare-outputs.js [--model MODEL] [--no-judge] <dir-a> <dir-b> [fixture-name ...]
 *
 * For every fixture, the judge sees the brief, the story context, and the
 * two drafts, unlabelled and in both orders, and says which better serves
 * the brief's reader. A pair counts as a win only if the same draft wins
 * both orders; a split is a tie. Typical use: dir-a from
 * `run-skill.js --no-skill` and dir-b from `run-skill.js`, to show the
 * skill changes the output for the better and not just differently.
 *
 * A fixture whose checks.json sets `baseline_margin` also gets a margin
 * check, with no model call: the checker runs on both drafts, and the
 * dir-b draft must pass at least that many more of the fixture's checks
 * than the dir-a draft. It reads dir-a as the no-skill baseline and dir-b
 * as the skill's run, the order above. Pass --no-judge to run only the
 * margin checks; it leaves out, and lists, the fixtures that set no margin.
 *
 * Exits non-zero when a fixture has no draft in one directory (a missing
 * draft is a failed comparison, not a tie), when a margin is not met, when
 * nothing was compared, or when a named fixture does not exist. Each judge
 * verdict is logged raw, with the model and temperature noted; `claude -p`
 * exposes no temperature flag, so judging always uses the CLI defaults.
 *
 * Judges prefer low-perplexity text and the first item shown, and they
 * agree with human writing preferences only about three quarters of the
 * time, so a loss here is a flag to read the two drafts, not a verdict.
 *
 * Requires the Claude Code CLI (`claude`) on PATH with working credentials,
 * unless --no-judge is passed. It runs with --safe-mode, so the caller's
 * CLAUDE.md files, skills, plugins, hooks, and MCP servers stay out of the
 * judge's context.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES_DIR, checkDraft, fillTemplate, loadFixture } from "./run-evals.js";

const CLAUDE_TIMEOUT_MS = 300_000;
const MAX_RETRIES = 2;

const PROMPT = `Two writers were given the same brief and the same story context. Judge which draft better serves the reader. Weigh, in this order: every established fact kept and nothing invented; the POV, tense, and voice the brief asks for; directness and specificity; whether it reads as written by one person. Do not reward length, formatting, or polish for its own sake.

Brief: {brief}

Story context:
<context>
{context}
</context>

Draft 1:
<draft1>
{first}
</draft1>

Draft 2:
<draft2>
{second}
</draft2>

Reply with exactly one character: 1 or 2.`;

function ask(spawn, model, prompt) {
  const args = ["-p", prompt, "--model", model, "--tools", "", "--safe-mode", "--output-format", "text"];
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = spawn("claude", args, {
      encoding: "utf8",
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (res.error?.code === "ENOENT") {
      console.log("  FAIL judge: `claude` not found on PATH. Install the Claude Code CLI with credentials, then retry.");
      return null;
    }
    if (res.error || res.status !== 0) {
      console.log(`  WARN judge failed (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      if (attempt >= MAX_RETRIES) return null;
      continue;
    }
    const raw = res.stdout.trim();
    const m = raw.match(/[12]/);
    // Log the raw verdict (not just the extracted digit) so order-effect
    // audits can see hedging like "leaning 1, but 2 has...".
    console.log(`  judge raw verdict: ${JSON.stringify(raw.slice(0, 200))}`);
    if (m) return m[0];
    console.log(`  WARN judge gave no verdict (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
  }
  return null;
}

/**
 * How far the skill's draft (`skill`, from dir-b) beats the baseline's
 * (`baseline`, from dir-a) on the fixture's own checks: the number of
 * checks each passes, out of the same total, and whether the difference
 * reaches the fixture's `baseline_margin`.
 */
export function marginCheck(checks, inputText, baseline, skill) {
  const passed = (draft) => checkDraft(checks, inputText, draft).filter(([ok]) => ok).length;
  const total = checkDraft(checks, inputText, skill).length;
  const a = passed(baseline);
  const b = passed(skill);
  return { a, b, total, margin: b - a, needs: checks.baseline_margin, ok: b - a >= checks.baseline_margin };
}

export function programArgs(argv = process.argv) {
  return argv.slice(2);
}

// `spawn` stands in for child_process.spawnSync, so tests can answer for the
// judge without a `claude` binary.
export function main(argv, { spawn = spawnSync } = {}) {
  let model = "claude-opus-5";
  let judge = true;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--model") model = argv[++i];
    else if (argv[i] === "--no-judge") judge = false;
    else rest.push(argv[i]);
  }
  if (rest.length < 2) {
    console.log("Usage: node evals/compare-outputs.js [--model MODEL] [--no-judge] <dir-a> <dir-b> [fixture-name ...]");
    return 2;
  }
  const [dirA, dirB, ...only] = rest;
  let names = fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (only.length > 0) {
    const unknown = only.filter((n) => !names.includes(n));
    if (unknown.length > 0) {
      console.log(`unknown fixture(s): ${unknown.join(", ")}`);
      return 2;
    }
    names = names.filter((n) => only.includes(n));
  }
  if (names.length === 0) {
    console.log("no fixtures selected");
    return 2;
  }
  // Without the judge only a margin can be checked, so a fixture that sets
  // none is left out, and said to be.
  if (!judge) {
    const margined = names.filter((n) => loadFixture(path.join(FIXTURES_DIR, n)).checks.baseline_margin !== undefined);
    const skipped = names.filter((n) => !margined.includes(n));
    if (skipped.length > 0) console.log(`skipped, no baseline_margin: ${skipped.join(", ")}`);
    if (margined.length === 0) {
      console.log("no selected fixture sets baseline_margin, and --no-judge skips the judge");
      return 1;
    }
    names = margined;
  }

  const tally = { a: 0, b: 0, tie: 0 };
  const margins = { met: 0, missed: 0 };
  let missing = 0;
  if (judge) console.log(`model: ${model}, temperature: default (not settable via claude -p)`);
  for (const name of names) {
    const aPath = path.join(dirA, `${name}.md`);
    const bPath = path.join(dirB, `${name}.md`);
    if (!fs.existsSync(aPath) || !fs.existsSync(bPath)) {
      console.log(`${name}: FAIL (missing draft in one directory)`);
      missing++;
      continue;
    }
    const { checks, inputText } = loadFixture(path.join(FIXTURES_DIR, name));
    const a = fs.readFileSync(aPath, "utf8");
    const b = fs.readFileSync(bPath, "utf8");
    if (checks.baseline_margin !== undefined) {
      const m = marginCheck(checks, inputText, a, b);
      margins[m.ok ? "met" : "missed"]++;
      console.log(
        `${name}: ${m.ok ? "margin met" : "FAIL margin"}: B passes ${m.b}/${m.total} checks, A ${m.a}/${m.total}, ` +
          `margin ${m.margin}, needs ${m.needs}`
      );
    }
    if (!judge) continue;
    const fill = (first, second) =>
      fillTemplate(PROMPT, { brief: checks.brief, context: inputText, first, second });
    const v1 = ask(spawn, model, fill(a, b)); // A first
    const v2 = ask(spawn, model, fill(b, a)); // B first
    // v1 === "1" means A won when shown first; v2 === "2" means A won when shown second.
    const aWins = v1 === "1" && v2 === "2";
    const bWins = v1 === "2" && v2 === "1";
    if (aWins) {
      tally.a++;
      console.log(`${name}: A wins both orders`);
    } else if (bWins) {
      tally.b++;
      console.log(`${name}: B wins both orders`);
    } else if (v1 === null || v2 === null) {
      // A missing verdict is a failed comparison, never a tie.
      missing++;
      console.log(`${name}: FAIL (judge gave no verdict)`);
    } else {
      tally.tie++;
      console.log(`${name}: tie (order split)`);
    }
  }
  const compared = tally.a + tally.b + tally.tie + margins.met + margins.missed;
  if (judge) {
    console.log(`\nA: ${tally.a}  B: ${tally.b}  ties: ${tally.tie}`);
    console.log("(Never label which directory came from the skill: labelled authorship shifts judge preference.)");
  }
  if (margins.met + margins.missed > 0) {
    console.log(`${judge ? "" : "\n"}margins met: ${margins.met} of ${margins.met + margins.missed}`);
  }
  // A missing draft or judge verdict fails the run, and so does a missed
  // margin or a run that compared nothing, so it is never a vacuous pass.
  return missing > 0 || margins.missed > 0 || compared === 0 ? 1 : 0;
}

const invoked =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) process.exit(main(programArgs()));

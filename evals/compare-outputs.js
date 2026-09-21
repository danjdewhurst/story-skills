#!/usr/bin/env node
/**
 * Pairwise comparison of two sets of drafts with a model as judge.
 *
 * Usage:
 *   node evals/compare-outputs.js [--model MODEL] <dir-a> <dir-b> [fixture-name ...]
 *
 * For every fixture, the judge sees the brief, the story context, and the
 * two drafts, unlabelled and in both orders, and says which better serves
 * the brief's reader. A pair counts as a win only if the same draft wins
 * both orders; a split is a tie. Typical use: dir-a from
 * `run-skill.js --no-skill` and dir-b from `run-skill.js`, to show the
 * skill changes the output for the better and not just differently.
 * Exits non-zero when a fixture has no draft in one directory (a missing
 * draft is a failed comparison, not a tie). Each judge verdict is logged
 * raw, with the model and temperature noted; `claude -p` exposes no
 * temperature flag, so judging always uses the CLI defaults.
 *
 * Judges prefer low-perplexity text and the first item shown, and they
 * agree with human writing preferences only about three quarters of the
 * time, so a loss here is a flag to read the two drafts, not a verdict.
 *
 * Requires the Claude Code CLI (`claude`) on PATH with working credentials.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES_DIR, loadFixture } from "./run-evals.js";

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

function ask(model, prompt) {
  const args = ["-p", prompt, "--model", model, "--tools", "", "--output-format", "text"];
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = spawnSync("claude", args, {
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

export function programArgs(argv = process.argv) {
  return argv.slice(2);
}

export function main(argv) {
  let model = "claude-opus-5";
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--model") model = argv[++i];
    else rest.push(argv[i]);
  }
  if (rest.length < 2) {
    console.log("Usage: node evals/compare-outputs.js [--model MODEL] <dir-a> <dir-b> [fixture-name ...]");
    return 2;
  }
  const [dirA, dirB, ...only] = rest;
  let names = fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (only.length > 0) names = names.filter((n) => only.includes(n));
  if (names.length === 0) {
    console.log("no fixtures selected");
    return 2;
  }

  const tally = { a: 0, b: 0, tie: 0 };
  let missing = 0;
  console.log(`model: ${model}, temperature: default (not settable via claude -p)`);
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
    const fill = (first, second) =>
      PROMPT.replace("{brief}", checks.brief)
        .replace("{context}", inputText)
        .replace("{first}", first)
        .replace("{second}", second);
    const v1 = ask(model, fill(a, b)); // A first
    const v2 = ask(model, fill(b, a)); // B first
    // v1 === "1" means A won when shown first; v2 === "2" means A won when shown second.
    const aWins = v1 === "1" && v2 === "2";
    const bWins = v1 === "2" && v2 === "1";
    if (aWins) {
      tally.a++;
      console.log(`${name}: A wins both orders`);
    } else if (bWins) {
      tally.b++;
      console.log(`${name}: B wins both orders`);
    } else {
      tally.tie++;
      console.log(`${name}: tie (order split or no verdict)`);
    }
  }
  console.log(`\nA: ${tally.a}  B: ${tally.b}  ties: ${tally.tie}`);
  console.log("(Never label which directory came from the skill: labelled authorship shifts judge preference.)");
  return missing > 0 ? 1 : 0;
}

const invoked =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) process.exit(main(programArgs()));

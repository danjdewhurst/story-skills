#!/usr/bin/env node
/**
 * Run the skill on every fixture with a real model, then check the drafts.
 *
 * Usage:
 *   node evals/run-skill.js [--model MODEL] [--skill SKILL] [--out DIR]
 *                           [--no-skill] [--no-judge] [--judge-model MODEL]
 *                           [fixture-name ...]
 *
 * Each fixture's input.md is sent to `claude -p` with the skill's SKILL.md
 * and references as the system prompt and the fixture's brief as the
 * instruction. Each fixture runs under the skill named by its checks.json
 * (`skill`); pass --skill to override every fixture at once (useful for
 * cross-skill experiments). Drafts land in DIR (default evals/outputs/) as
 * <fixture-name>.md, then run-evals.js checks them. Run provenance lands
 * next to each draft: <fixture-name>.prompt.md (the exact prompt sent),
 * <fixture-name>.system.sha256 (hash of the system prompt), and
 * <fixture-name>.judge-raw.txt (the judge's raw reply). Model, temperature,
 * and seed are logged per run; `claude -p` exposes no temperature/seed
 * flags, so sampling always uses the CLI defaults. A second model call
 * then lists any canon claim the draft makes that the context does not
 * state or imply; one invented claim fails the fixture. Pass --no-judge to
 * skip that call. Exits non-zero if any fixture fails.
 *
 * Pass --no-skill to produce a baseline with the same briefs and no skill
 * loaded, into a different --out directory, then compare the two with
 * evals/compare-outputs.js.
 *
 * Requires the Claude Code CLI (`claude`) on PATH with working
 * credentials. The model is claude-opus-5 unless --model says otherwise;
 * --judge-model picks a different model for the canon check (default stays
 * claude-opus-5 regardless of --model, since a smaller judge over-flags).
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES_DIR, loadFixture, checkDraft } from "./run-evals.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");

const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_JUDGE_MODEL = "claude-opus-5";
const CLAUDE_TIMEOUT_MS = 300_000;
const MAX_RETRIES = 2;

const BASELINE_HEADER = `You are a careful fiction writer. Apply the user's request to the text.

Output rules for this run: return only the final draft prose. No preamble, no outline, no change note, no diagnostic audit, no closing remark.
`;

const JUDGE_PROMPT = `You are checking a story draft for invented canon.

Story context:
<context>
{context}
</context>

Draft:
<draft>
{draft}
</draft>

List every canon claim the draft makes that a reader of the context could not have taken from it: a new named character, place, or object; a new rule of the world; a resolved mystery or answered open question; a changed established fact (a name, age, date, cause of death, or an object behaving differently than stated); an event the context never mentions.

Do not list: rewording, reordering, or cuts; showing rather than telling; ordinary sensory detail consistent with the location (smells, weather, textures); a character's plausible thoughts or feelings; bracketed gap markers such as [name needed]; a heading that names the scene.

Reply with a JSON array of short strings, one per invented canon claim, and nothing else. Reply with [] if there are none.`;

function buildSystemPrompt(skillName, withSkill) {
  if (!withSkill) return BASELINE_HEADER;
  const skillDir = path.join(ROOT, "skills", skillName);
  if (!fs.existsSync(path.join(skillDir, "SKILL.md"))) {
    throw new Error(`unknown skill "${skillName}": no ${path.join("skills", skillName, "SKILL.md")}`);
  }
  const header = `You are running a story-skills ${skillName} workflow. The skill instructions and reference material follow. Apply them to the user's request.

Output rules for this run: return only the final draft prose. No preamble, no outline, no change note, no diagnostic audit, no closing remark.
`;
  const parts = [header, fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8")];
  const refsDir = path.join(skillDir, "references");
  if (fs.existsSync(refsDir)) {
    for (const name of fs.readdirSync(refsDir).sort()) {
      if (!name.endsWith(".md")) continue;
      parts.push(`\n\n<!-- references/${name} -->\n\n` + fs.readFileSync(path.join(refsDir, name), "utf8"));
    }
  }
  return parts.join("\n");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function claudeText(model, prompt, systemText) {
  const sysFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "story-eval-")),
    "system.txt"
  );
  fs.writeFileSync(sysFile, systemText, "utf8");
  const args = [
    "-p", prompt,
    "--model", model,
    "--tools", "",
    "--output-format", "text",
    "--system-prompt-file", sysFile,
  ];
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = spawnSync("claude", args, {
      encoding: "utf8",
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (res.error) {
      if (res.error.code === "ENOENT") {
        throw new Error("Claude Code CLI (`claude`) not found on PATH. Install it and authenticate, then retry.");
      }
      lastErr = res.error;
      console.log(`  WARN claude failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${res.error.message}`);
      continue;
    }
    if (res.status !== 0) {
      lastErr = new Error(`exit ${res.status}: ${(res.stderr || "").slice(0, 300)}`);
      console.log(`  WARN claude exited ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      continue;
    }
    return res.stdout.trim();
  }
  throw lastErr || new Error("claude call failed");
}

function stripPreamble(text) {
  let t = text.trim();
  t = t.replace(/^```(?:json|markdown|md|text)?\s*\n/, "");
  t = t.replace(/\n```\s*$/, "").trim();
  const lines = t.split("\n");
  const preambleRe = /^(?:here(?:'s| is)|sure|certainly|of course|okay|ok)\b[^.!?]{0,60}:\s*$/i;
  while (lines.length > 0 && preambleRe.test(lines[0].trim())) lines.shift();
  if (lines.length > 0 && /^draft\s*:\s*$/i.test(lines[0].trim())) lines.shift();
  // Drop a beat-by-beat outline if the model emitted one above the prose.
  const textIdx = lines.findIndex((l) => /^##\s+chapter text/i.test(l.trim()));
  const body = textIdx >= 0 ? lines.slice(textIdx + 1) : lines;
  return body.join("\n").trim() + "\n";
}

function parseJudgeJson(raw) {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error(`judge did not return a JSON array: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(m[0]);
  if (!Array.isArray(parsed) || !parsed.every((s) => typeof s === "string")) {
    throw new Error(`judge returned a non-string array: ${m[0].slice(0, 200)}`);
  }
  return parsed;
}

export function programArgs(argv = process.argv) {
  return argv.slice(2);
}

export function parseArgs(argv) {
  const opts = {
    model: DEFAULT_MODEL,
    judgeModel: DEFAULT_JUDGE_MODEL,
    skill: "chapter-writing",
    skillOverridden: false,
    out: path.join(here, "outputs"),
    withSkill: true,
    judge: true,
    fixtures: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model") opts.model = argv[++i];
    else if (a === "--judge-model") opts.judgeModel = argv[++i];
    else if (a === "--skill") {
      opts.skill = argv[++i];
      opts.skillOverridden = true;
    }
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--no-skill") opts.withSkill = false;
    else if (a === "--no-judge") opts.judge = false;
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else opts.fixtures.push(a);
  }
  return opts;
}

export function main(argv) {
  const opts = parseArgs(argv);
  fs.mkdirSync(opts.out, { recursive: true });

  let names = fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (opts.fixtures.length > 0) names = names.filter((n) => opts.fixtures.includes(n));
  if (names.length === 0) {
    console.log("no fixtures selected");
    return 2;
  }

  console.log(`model: ${opts.model}${opts.withSkill ? "" : " (no skill baseline)"}`);
  // `claude -p` exposes no temperature or seed flags, so every run uses the
  // CLI defaults; they are logged here (and saved per fixture below) so a
  // future reader knows sampling was not pinned.
  console.log(`temperature: default (not settable via claude -p)`);
  console.log(`seed: default (not settable via claude -p)`);
  let allOk = true;
  const report = [];
  for (const name of names) {
    const fixtureDir = path.join(FIXTURES_DIR, name);
    const { checks, inputText } = loadFixture(fixtureDir);
    // Each fixture runs under the skill it declares; an explicit --skill
    // overrides every fixture (useful for cross-skill experiments).
    const skillName = opts.withSkill ? (opts.skillOverridden ? opts.skill : checks.skill || opts.skill) : opts.skill;
    const systemPrompt = buildSystemPrompt(skillName, opts.withSkill);
    // Clear stale outputs first so a failed run never presents a previous
    // run's draft, claims, or judge reply as current results.
    for (const ext of [".md", ".claims.json", ".judge-raw.txt"]) {
      try {
        fs.rmSync(path.join(opts.out, `${name}${ext}`), { force: true });
      } catch {
        // Missing files are the common case; ignore removal failures.
      }
    }
    const prompt = `${checks.brief}\n\nText:\n\n${inputText}`;
    console.log(`\n${name}: drafting...`);
    console.log(`  model: ${opts.model}, skill: ${opts.withSkill ? skillName : "(none)"}, temperature: default, seed: default`);
    console.log(`  system sha256: ${sha256(systemPrompt)}`);
    // Provenance saved next to the draft so a run can be audited later.
    fs.writeFileSync(path.join(opts.out, `${name}.prompt.md`), prompt, "utf8");
    fs.writeFileSync(path.join(opts.out, `${name}.system.sha256`), `${sha256(systemPrompt)}\n`, "utf8");
    let draft;
    try {
      draft = stripPreamble(claudeText(opts.model, prompt, systemPrompt));
    } catch (err) {
      console.log(`  FAIL draft call: ${err.message}`);
      allOk = false;
      continue;
    }
    const draftPath = path.join(opts.out, `${name}.md`);
    fs.writeFileSync(draftPath, draft, "utf8");

    const results = checkDraft(checks, inputText, draft);
    const failures = results.filter(([ok]) => !ok).map(([, desc]) => desc);
    console.log(`  checker: ${results.length - failures.length}/${results.length} passed`);
    for (const desc of failures) console.log(`  FAIL ${desc}`);

    let claims = [];
    if (opts.judge) {
      const judgePrompt = JUDGE_PROMPT.replace("{context}", inputText).replace("{draft}", draft);
      try {
        const raw = claudeText(opts.judgeModel, judgePrompt, BASELINE_HEADER);
        fs.writeFileSync(path.join(opts.out, `${name}.judge-raw.txt`), raw, "utf8");
        claims = parseJudgeJson(raw);
        fs.writeFileSync(path.join(opts.out, `${name}.claims.json`), JSON.stringify(claims, null, 2) + "\n", "utf8");
      } catch (err) {
        console.log(`  FAIL judge: ${err.message}`);
        allOk = false;
        continue;
      }
      if (claims.length > 0) {
        console.log(`  FAIL invented canon (${claims.length}):`);
        for (const c of claims) console.log(`    - ${c}`);
      } else {
        console.log("  judge: no invented canon");
      }
    }
    const ok = failures.length === 0 && claims.length === 0;
    if (!ok) allOk = false;
    report.push({ fixture: name, ok, checks: `${results.length - failures.length}/${results.length}`, claims: claims.length });
  }

  console.log(`\nmodel: ${opts.model}`);
  for (const r of report) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"} ${r.fixture} (checker ${r.checks}, invented claims ${r.claims})`);
  }
  return allOk ? 0 : 1;
}

const invoked =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    process.exit(main(programArgs()));
  } catch (err) {
    console.log(`FAIL ${err.message}`);
    process.exit(2);
  }
}

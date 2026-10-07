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
 * and the reference files it names (see skillReferences) as the system
 * prompt and the fixture's brief as the instruction. Each fixture runs under
 * the skill named by its checks.json
 * (`skill`); pass --skill to override every fixture at once (useful for
 * cross-skill experiments). Drafts land in DIR (default evals/outputs/) as
 * <fixture-name>.md, then run-evals.js checks them. A chapter draft keeps
 * only the text under `## Chapter Text` unless the fixture's checks.json sets
 * `"keep": "file"`, which asks for and scores the whole file, frontmatter
 * included. Run
 * provenance lands next to each draft: <fixture-name>.prompt.md (the exact prompt sent),
 * <fixture-name>.system.sha256 (hash of the system prompt), and
 * <fixture-name>.judge-raw.txt (the judge's raw reply). Model, temperature,
 * and seed are logged per run; `claude -p` exposes no temperature/seed
 * flags, so sampling always uses the CLI defaults. A second model call
 * then lists any canon claim the draft makes that the context does not
 * state or imply; one invented claim fails the fixture. Pass --no-judge to
 * skip that call. A draft or judge call that fails after its retries fails
 * the fixture too, and the summary counts it. Exits non-zero if any fixture
 * fails.
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
import { FIXTURES_DIR, fillTemplate, loadFixture, checkDraft } from "./run-evals.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const SKILLS_DIR = path.join(ROOT, "skills");

const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_JUDGE_MODEL = "claude-opus-5";
const CLAUDE_TIMEOUT_MS = 300_000;
const MAX_RETRIES = 2;

// Files a reference names only load while the reference text stays within
// this many characters. Files SKILL.md names itself always load.
export const MAX_REFERENCE_CHARS = 48_000;

// A fixture's `keep` (checks.json) says what of the reply is scored:
// "chapter-text" (the default) keeps only the prose under `## Chapter Text`,
// "file" keeps the whole reply, frontmatter included, for fixtures whose
// brief asks for a file (a chapter's `choices`, a feedback file, a style
// sheet, an entity's frontmatter).
const PROSE_RULE = "Output rules for this run: return only the final draft prose. No preamble, no outline, no change note, no diagnostic audit, no closing remark.";
const FILE_RULE = "Output rules for this run: return only the file content the brief asks for, frontmatter included. No preamble, no change note, no diagnostic audit, no closing remark.";

function outputRule(keep) {
  return keep === "file" ? FILE_RULE : PROSE_RULE;
}

function baselineHeader(keep) {
  return `You are a careful fiction writer. Apply the user's request to the text.

${outputRule(keep)}
`;
}

const BASELINE_HEADER = baselineHeader();

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

// A path a skill file names: a link target or a code span ending in `.md`,
// with any `#anchor` dropped.
const PATH_MENTION_RE = /(?:\]\(|`)([^\s`()<>]+?\.md)(?:#[^\s`()]*)?(?=[`)])/g;

// The skill files `file` names, resolved from its folder as a link would be,
// in the order it names them. Only existing files inside `skillsDir` count,
// and never a SKILL.md: a project path such as `chapters/chapter-{NN}.md`, a
// path that leaves the skills folder, or another skill's instructions is
// not reference material.
function namedFiles(file, text, skillsDir) {
  const files = [];
  for (const m of text.matchAll(PATH_MENTION_RE)) {
    const target = path.resolve(path.dirname(file), m[1]);
    const rel = path.relative(skillsDir, target);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
    if (path.basename(target) === "SKILL.md") continue;
    if (!fs.statSync(target, { throwIfNoEntry: false })?.isFile()) continue;
    files.push(target);
  }
  return files;
}

/**
 * The reference files an agent running the skill would read: the files
 * SKILL.md names (`references/x.md`, or another skill's
 * `../feedback-triage/references/feedback-template.md`), then the files
 * those name, breadth-first. Every file SKILL.md names loads. A file only a
 * reference names loads while the total reference text stays within `cap`
 * characters; past that it is left out, and so are the files only it names.
 * Each file has a label: its path from the skill folder, as SKILL.md would
 * write it.
 */
export function skillReferences(skillDir, { skillsDir = SKILLS_DIR, cap = MAX_REFERENCE_CHARS } = {}) {
  const skillFile = path.join(skillDir, "SKILL.md");
  const label = (file) => path.relative(skillDir, file).split(path.sep).join("/");
  const seen = new Set([skillFile]);
  const loaded = [];
  const leftOut = [];
  let chars = 0;
  let level = namedFiles(skillFile, fs.readFileSync(skillFile, "utf8"), skillsDir);
  for (let depth = 1; level.length > 0; depth++) {
    const next = [];
    for (const file of level) {
      if (seen.has(file)) continue;
      seen.add(file);
      const text = fs.readFileSync(file, "utf8");
      if (depth > 1 && chars + text.length > cap) {
        leftOut.push(label(file));
        continue;
      }
      chars += text.length;
      loaded.push({ label: label(file), text });
      next.push(...namedFiles(file, text, skillsDir));
    }
    level = next;
  }
  return { loaded, leftOut, chars };
}

function buildSystemPrompt(skillName, withSkill, keep) {
  if (!withSkill) return { text: baselineHeader(keep), references: null };
  const skillDir = path.join(SKILLS_DIR, skillName);
  if (!fs.existsSync(path.join(skillDir, "SKILL.md"))) {
    throw new Error(`unknown skill "${skillName}": no ${path.join("skills", skillName, "SKILL.md")}`);
  }
  const header = `You are running a story-skills ${skillName} workflow. The skill's SKILL.md follows, then the reference files it names, each under a comment with its path from the skill folder. Apply them to the user's request.

${outputRule(keep)}
`;
  const references = skillReferences(skillDir);
  const parts = [header, fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8")];
  for (const ref of references.loaded) {
    parts.push(`\n\n<!-- ${ref.label} -->\n\n` + ref.text);
  }
  return { text: parts.join("\n"), references };
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// The system prompt goes through a temp file, removed once the call is done.
function claudeText(spawn, model, prompt, systemText) {
  const sysDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-eval-"));
  try {
    return claudeCall(spawn, model, prompt, systemText, path.join(sysDir, "system.txt"));
  } finally {
    fs.rmSync(sysDir, { recursive: true, force: true });
  }
}

function claudeCall(spawn, model, prompt, systemText, sysFile) {
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
    const res = spawn("claude", args, {
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

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function fenceLine(line) {
  const m = line.match(FENCE_RE);
  if (!m) return null;
  const info = m[2].trim();
  // A backtick fence's info string cannot hold a backtick (CommonMark).
  if (m[1][0] === "`" && info.includes("`")) return null;
  return { char: m[1][0], len: m[1].length, info };
}

// A short lead-in such as "Here's the draft:" above the fence: one or two
// lines, the last ending in a colon. A heading or a frontmatter delimiter is
// draft, never a lead-in.
function isLeadIn(lines) {
  if (lines.length === 0) return true;
  if (lines.length > 2) return false;
  if (lines.some((l) => l.length > 200 || /^\s*(?:#|---\s*$)/.test(l))) return false;
  return /:\s*$/.test(lines[lines.length - 1]);
}

// A one-line conversational sign-off after the closing fence, such as "Let me
// know if you want changes." Only an opening addressed to the user counts: a
// line of prose after the fence may be the draft's last sentence, and
// dropping it would score a different draft.
const SIGN_OFF_RE =
  /^(?:let me know|(?:i )?hope (?:this|that|it)|feel free|would you like|do you want|want me to|shall i|should i|happy to|i(?:'d| would) be happy|if you(?:'d)? like|i can (?:also )?(?:adjust|revise|change|expand|trim|tweak))\b/i;

function isSignOff(lines) {
  if (lines.length === 0) return true;
  return lines.length === 1 && lines[0].length <= 160 && SIGN_OFF_RE.test(lines[0].trim());
}

/**
 * Unwraps a reply that is one fenced block, after an optional lead-in (see
 * isLeadIn) and before an optional one-line sign-off. The outer fence may use
 * backticks or tildes, three or more, with any info string. Fences inside the
 * draft stay: inside the outer block, a fence with an info string, or one that
 * cannot close the outer fence (another character, or shorter), opens a nested
 * block. A reply with several top-level blocks, or with content around the
 * block, comes back unchanged.
 */
export function unwrapFence(text) {
  const lines = text.split("\n");
  const nonBlank = (arr) => arr.filter((l) => l.trim() !== "");
  const open = lines.findIndex((l) => fenceLine(l));
  if (open < 0 || !isLeadIn(nonBlank(lines.slice(0, open)))) return text;
  const outer = fenceLine(lines[open]);
  let inner = null;
  let close = -1;
  for (let i = open + 1; i < lines.length && close < 0; i++) {
    const f = fenceLine(lines[i]);
    if (!f) continue;
    if (inner) {
      if (f.char === inner.char && f.len >= inner.len && !f.info) inner = null;
    } else if (f.char === outer.char && f.len >= outer.len && !f.info) {
      close = i;
    } else {
      inner = f;
    }
  }
  // An unclosed fence runs to the end of the reply, as in CommonMark.
  if (close < 0) return lines.slice(open + 1).join("\n");
  if (!isSignOff(nonBlank(lines.slice(close + 1)))) return text;
  return lines.slice(open + 1, close).join("\n");
}

export function stripPreamble(text, keep = "chapter-text") {
  const t = unwrapFence(text.trim()).trim();
  const lines = t.split("\n");
  const preambleRe = /^(?:here(?:'s| is)|sure|certainly|of course|okay|ok)\b[^.!?]{0,60}:\s*$/i;
  while (lines.length > 0 && preambleRe.test(lines[0].trim())) lines.shift();
  if (lines.length > 0 && /^draft\s*:\s*$/i.test(lines[0].trim())) lines.shift();
  // Drop a beat-by-beat outline if the model emitted one above the prose,
  // unless the fixture scores the whole file.
  const textIdx = keep === "file" ? -1 : lines.findIndex((l) => /^##\s+chapter text/i.test(l.trim()));
  const body = textIdx >= 0 ? lines.slice(textIdx + 1) : lines;
  return body.join("\n").trim() + "\n";
}

// The end (exclusive) of the bracketed span that opens at `start`, skipping
// brackets inside JSON strings, or -1 if it never closes.
function closingBracket(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return i + 1;
  }
  return -1;
}

// The judge is told to reply with the array alone, but a reply can carry
// prose around it, and that prose can hold brackets ("[name needed]"). Take
// the last span that parses as JSON; a nested array is part of its parent.
function lastJsonArray(raw) {
  let found = null;
  for (let i = raw.indexOf("["); i >= 0; i = raw.indexOf("[", i + 1)) {
    const end = closingBracket(raw, i);
    if (end < 0) continue;
    try {
      found = { value: JSON.parse(raw.slice(i, end)), text: raw.slice(i, end) };
      i = end - 1;
    } catch {
      // A bracket in the judge's prose, not JSON.
    }
  }
  return found;
}

export function parseJudgeJson(raw) {
  const found = lastJsonArray(raw);
  if (!found) throw new Error(`judge did not return a JSON array: ${raw.slice(0, 200)}`);
  if (!found.value.every((s) => typeof s === "string")) {
    throw new Error(`judge returned a non-string array: ${found.text.slice(0, 200)}`);
  }
  return found.value;
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

export function selectFixtures(requested) {
  const all = fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (requested.length === 0) return { names: all, unknown: [] };
  return {
    names: all.filter((n) => requested.includes(n)),
    unknown: requested.filter((n) => !all.includes(n)),
  };
}

export function buildJudgePrompt(inputText, draft) {
  return fillTemplate(JUDGE_PROMPT, { context: inputText, draft });
}

// `spawn` stands in for child_process.spawnSync, so tests can answer for the
// model without a `claude` binary.
export function main(argv, { spawn = spawnSync } = {}) {
  const opts = parseArgs(argv);
  const { names, unknown } = selectFixtures(opts.fixtures);
  if (unknown.length > 0) {
    console.log(`unknown fixture(s): ${unknown.join(", ")}`);
    return 2;
  }
  if (names.length === 0) {
    console.log("no fixtures selected");
    return 2;
  }
  fs.mkdirSync(opts.out, { recursive: true });

  console.log(`model: ${opts.model}${opts.withSkill ? "" : " (no skill baseline)"}`);
  // `claude -p` exposes no temperature or seed flags, so every run uses the
  // CLI defaults; they are logged here (and saved per fixture below) so a
  // future reader knows sampling was not pinned.
  console.log(`temperature: default (not settable via claude -p)`);
  console.log(`seed: default (not settable via claude -p)`);
  const report = [];
  for (const name of names) {
    const fixtureDir = path.join(FIXTURES_DIR, name);
    const { checks, inputText } = loadFixture(fixtureDir);
    // Each fixture runs under the skill it declares; an explicit --skill
    // overrides every fixture (useful for cross-skill experiments).
    const skillName = opts.withSkill ? (opts.skillOverridden ? opts.skill : checks.skill || opts.skill) : opts.skill;
    const { text: systemPrompt, references } = buildSystemPrompt(skillName, opts.withSkill, checks.keep);
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
    if (references) {
      const leftOut = references.leftOut.length > 0 ? `; left out over the ${MAX_REFERENCE_CHARS}-character cap: ${references.leftOut.join(", ")}` : "";
      console.log(`  references: ${references.loaded.map((r) => r.label).join(", ") || "(none)"} (${references.chars} characters)${leftOut}`);
    }
    console.log(`  system sha256: ${sha256(systemPrompt)}`);
    // Provenance saved next to the draft so a run can be audited later.
    fs.writeFileSync(path.join(opts.out, `${name}.prompt.md`), prompt, "utf8");
    fs.writeFileSync(path.join(opts.out, `${name}.system.sha256`), `${sha256(systemPrompt)}\n`, "utf8");
    let draft;
    try {
      draft = stripPreamble(claudeText(spawn, opts.model, prompt, systemPrompt), checks.keep);
    } catch (err) {
      console.log(`  FAIL draft call: ${err.message}`);
      report.push({ fixture: name, ok: false, detail: "draft call failed" });
      continue;
    }
    const draftPath = path.join(opts.out, `${name}.md`);
    fs.writeFileSync(draftPath, draft, "utf8");

    const results = checkDraft(checks, inputText, draft);
    const failures = results.filter(([ok]) => !ok).map(([, desc]) => desc);
    const checker = `checker ${results.length - failures.length}/${results.length}`;
    console.log(`  checker: ${results.length - failures.length}/${results.length} passed`);
    for (const desc of failures) console.log(`  FAIL ${desc}`);

    let claims = [];
    if (opts.judge) {
      const judgePrompt = buildJudgePrompt(inputText, draft);
      try {
        const raw = claudeText(spawn, opts.judgeModel, judgePrompt, BASELINE_HEADER);
        fs.writeFileSync(path.join(opts.out, `${name}.judge-raw.txt`), raw, "utf8");
        claims = parseJudgeJson(raw);
        fs.writeFileSync(path.join(opts.out, `${name}.claims.json`), JSON.stringify(claims, null, 2) + "\n", "utf8");
      } catch (err) {
        console.log(`  FAIL judge: ${err.message}`);
        report.push({ fixture: name, ok: false, detail: `${checker}, judge failed` });
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
    report.push({ fixture: name, ok, detail: `${checker}, invented claims ${claims.length}` });
  }

  // Every selected fixture has a line here, including one whose draft or
  // judge call failed, so a failed call cannot drop out of the count.
  const passed = report.filter((r) => r.ok).length;
  console.log(`\nmodel: ${opts.model}`);
  for (const r of report) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"} ${r.fixture} (${r.detail})`);
  }
  console.log(`${passed} of ${report.length} fixtures passed`);
  return passed === report.length ? 0 : 1;
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

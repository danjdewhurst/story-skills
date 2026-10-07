import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { COMMANDS } from "../src/commands.js";

// Every skill ends its edits with the same maintenance block, in the same
// order: reindex, wordcount --write, then check (validate, links, and
// continuity over one scan).
//
// A maintenance block is a fenced code block in a markdown file under
// skills/ with a line that runs `story reindex`, `story wordcount ... --write`,
// `story check`, `story links`, or `story validate` (see storyCommands for
// how a line is read). Its first three `story` commands must be the
// canonical three on one project path, and no later one may run one of them,
// or `story continuity`, again: `check` already covers them. Other commands
// (`story clues .`, `story pacing .`) may follow. A fence preceded by a
// `<!-- command-reference -->` line is a command catalogue, not a block an
// agent runs, and is skipped.
//
// Outside fences, an inline maintenance list is two or more inline-code
// maintenance commands with a path (`story links .`, not a bare
// `story links` named in passing) joined only by commas, "and", "then", or
// "and then". Each must be exactly `story reindex P`, `story wordcount P
// --write`, and `story check P`, in that order.
//
// The docs, the README, the contributor guides, the eval reference answers,
// and the workflow templates describe the same block, but they also show one
// command at a time, a CI step that runs only reindex and wordcount --write
// to catch stale files, and hooks that run the checks one by one. So there
// the rule is about maintenance runs. A sequence is a fenced block, an
// inline list that gives a run order (see runOrder), or the `story` commands
// of one job in a template, read across comments, blank lines, and steps.
// A sequence that runs neither reindex nor wordcount --write is a read-only
// listing and passes. One that runs either is a maintenance run from its
// first writer on; what comes before, such as the `story validate` that
// finds a stale count or the `story migrate` that needs a reindex after it,
// is free. From the first writer on it may not run `wordcount` without
// --write, or validate, links, or continuity on their own (`check` runs
// them), and the reindex, wordcount --write, and check it runs must be the
// start of the canonical block, on one path, with no other command between
// them. `check` may take flags such as --strict.

const repoRoot = path.join(import.meta.dir, "..");
const skillsDir = path.join(repoRoot, "skills");
const REFERENCE_MARKER = "<!-- command-reference -->";
const FENCE = /^\s*(```|~~~)/;
const MAINTENANCE = /^story (?:reindex|check|links|validate)(?:\s|$)|^story wordcount\b.*\s--write(?:\s|$)/;
const REPEATED = /^story (?:reindex|check|links|validate|continuity)(?:\s|$)|^story wordcount\b.*\s--write(?:\s|$)/;
const COMMAND_NAMES = new Set(COMMANDS.map((command) => command.name));

function filesUnder(dir, name) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return filesUnder(full, name);
    }
    return name.test(entry.name) ? [full] : [];
  }).sort();
}

function markdownFiles(dir) {
  return filesUnder(dir, /\.md$/);
}

// The pages outside skills/ that describe the maintenance block.
const docFiles = [
  ...markdownFiles(path.join(repoRoot, "docs")),
  ...["README.md", "CONTRIBUTING.md", "AGENTS.md", "evals/README.md"].map((file) => path.join(repoRoot, file)),
  ...markdownFiles(path.join(repoRoot, "evals", "examples"))
];
const templateFiles = filesUnder(path.join(repoRoot, "templates"), /\.ya?ml$/);

// The `story` commands a line of a code block or template runs: after a
// shell prompt (`$ `) or a YAML `run:` key, each command of a chain joined
// with `&&`, `||`, or `;`, and `npx story-skills` or the `node .../story.js`
// fallback read as `story`. An expression such as `${{ env.STORY_DIR }}`
// loses its spaces, so a path stays one word. Only a real command name
// counts, so prose that starts with "story" is not a command.
function storyCommands(line) {
  const text = line.trim()
    .replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_, expression) => `\${{${expression}}}`)
    .replace(/^(?:-\s+)?run:\s*/, "")
    .replace(/^\$\s+/, "");
  return text.split(/\s*(?:&&|\|\||;)\s*/)
    .map((part) => part
      .replace(/^npx\s+(?:(?:--yes|-y)\s+)?story-skills(?:@\S+)?(?=\s|$)/, "story")
      .replace(/^node\s+\S*story\.js(?=\s|$)/, "story")
      .trim())
    .filter((part) => COMMAND_NAMES.has(/^story ([a-z-]+)(?:\s|$)/.exec(part)?.[1]));
}

// The fenced code blocks of a markdown file, with the line each opens on
// and whether a command-reference marker precedes it.
function fencedBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const open = lines[index].match(FENCE);
    if (!open) {
      continue;
    }
    const marker = open[1];
    let end = index + 1;
    while (end < lines.length && !lines[end].trim().startsWith(marker)) {
      end += 1;
    }
    let previous = index - 1;
    while (previous >= 0 && lines[previous].trim() === "") {
      previous -= 1;
    }
    blocks.push({
      line: index + 1,
      reference: previous >= 0 && lines[previous].trim() === REFERENCE_MARKER,
      commands: lines.slice(index + 1, end).flatMap(storyCommands)
    });
    index = end;
  }
  return blocks;
}

// The text of a markdown file with every fenced block blanked, so offsets
// still give the right line numbers.
function proseOnly(text) {
  let inFence = null;
  return text.split("\n").map((line) => {
    const fence = line.match(FENCE);
    if (inFence) {
      if (line.trim().startsWith(inFence)) {
        inFence = null;
      }
      return "";
    }
    if (fence) {
      inFence = fence[1];
      return "";
    }
    return line;
  }).join("\n");
}

const INLINE_COMMAND = /`(story [^`]+)`/g;
const INLINE_MAINTENANCE = /^story (?:(?:reindex|check|links|validate|continuity) \S+|wordcount \S+ --write)$/;
// The docs also name the commands without a path (`story wordcount --write`),
// with flags (`story check . --strict`), and as a plain `story wordcount`.
const DOC_INLINE_MAINTENANCE = /^story (?:reindex|check|links|validate|continuity|wordcount)(?:\s|$)/;
const SEPARATOR = /^(?:\s*,)?\s*(?:(?:and|then|and then)\s+)?$/;

// The inline lists of two or more commands that `maintenance` matches in
// the prose of a markdown file, as { line, start, end, commands, then }:
// the offsets of the list in the prose, and whether "then" joins it.
function inlineLists(text, maintenance) {
  const prose = proseOnly(text);
  const runs = [];
  let run = null;
  for (const match of prose.matchAll(INLINE_COMMAND)) {
    const command = match[1].trim();
    if (!maintenance.test(command)) {
      run = null;
      continue;
    }
    const separator = run ? prose.slice(run.end, match.index) : "";
    if (run && SEPARATOR.test(separator)) {
      run.commands.push(command);
      run.then ||= /\bthen\b/.test(separator);
    } else {
      run = { line: prose.slice(0, match.index).split("\n").length, start: match.index, commands: [command], then: false };
      runs.push(run);
    }
    run.end = match.index + match[0].length;
  }
  return runs.filter(({ commands }) => commands.length >= 2);
}

function formatList(commands) {
  return commands.map((command) => `\`${command}\``).join(", ");
}

// Each inline maintenance list in prose that is not the canonical three.
function inlineProblems(text) {
  return inlineLists(text, INLINE_MAINTENANCE).filter(({ commands }) => {
    const projectPath = commands[0].split(" ")[2];
    const expected = [`story reindex ${projectPath}`, `story wordcount ${projectPath} --write`, `story check ${projectPath}`];
    return commands.join("\n") !== expected.join("\n");
  }).map(({ line, commands }) => `line ${line}: inline list ${formatList(commands)}`);
}

// The first argument of a command that is not a flag, with its leading
// space (" ." in `story check . --strict`), or "" when it has none.
function projectArgument(command) {
  return /^story \S+((?: (?!-)\S+)?)/.exec(command)[1];
}

// Whether an inline list in the docs gives a run order rather than naming
// commands in passing ("`story reindex` and `story wordcount --write`
// rewrite registry tables"): every command names its project path, "then"
// joins it or follows it, or its sentence or table cell says "run" before
// it. Code spans are masked so the dots in them do not end a sentence.
function runOrder(prose, list) {
  if (list.then || /^\s*,?\s*then\b/.test(prose.slice(list.end)) || list.commands.every((command) => projectArgument(command) !== "")) {
    return true;
  }
  const before = prose.slice(0, list.start).replace(/`[^`\n]*`/g, (span) => "x".repeat(span.length));
  const sentence = before.split(/[.!?]\s|\n\s*\n|\||\n\s*(?:[-*]|\d+\.)\s/).pop();
  return /\b(?:run|runs|running|ran)\b/i.test(sentence);
}

function commandKind(command) {
  if (/^story wordcount(?:\s|$)/.test(command)) {
    return /\s--write(?:\s|$)/.test(command) ? "wordcount --write" : "wordcount";
  }
  return /^story (reindex|check|validate|links|continuity)(?:\s|$)/.exec(command)?.[1] ?? "other";
}

const BLOCK_KINDS = ["reindex", "wordcount --write", "check"];

// Why a sequence of commands in the docs or a template breaks the
// maintenance block, or null when it keeps it (see the rule at the top).
function sequenceProblem(sequence) {
  const start = sequence.map(commandKind).findIndex((kind) => kind === "reindex" || kind === "wordcount --write");
  if (start === -1) {
    return null;
  }
  const commands = sequence.slice(start);
  const kinds = commands.map(commandKind);
  const stray = commands.find((command, index) => ["wordcount", "validate", "links", "continuity"].includes(kinds[index]));
  if (stray) {
    return `runs \`${stray}\` in a maintenance run, where \`story wordcount --write\` and \`story check\` belong`;
  }
  const block = commands.slice(0, kinds.findLastIndex((kind) => BLOCK_KINDS.includes(kind)) + 1);
  // A writer shown on its own, like `story wordcount . --write` with the
  // counts it prints.
  if (block.length === 1) {
    return null;
  }
  const projectPath = projectArgument(block[0]);
  const expected = [`story reindex${projectPath}`, `story wordcount${projectPath} --write`, `story check${projectPath}`];
  const canonical = block.length <= expected.length && block.every((command, index) =>
    command === expected[index] || (index === 2 && command.startsWith(`${expected[2]} --`)));
  return canonical ? null : `runs ${formatList(block)}, not ${formatList(expected.slice(0, Math.min(block.length, 3)))}`;
}

// The `story` commands each job of a workflow template runs, in order, as
// { line, commands }: its `run:` steps, its `run: |` blocks, and the lines
// of a prompt that hold a command of their own. Comments are skipped, and
// blank lines and step boundaries do not end the sequence; a new key two
// spaces in (a job under `jobs:`) starts a new one. `line` is the first
// command's line.
function templateSequences(text) {
  const sequences = [];
  let current = null;
  text.split("\n").forEach((line, index) => {
    if (/^ {2}[\w-]+:\s*$/.test(line)) {
      current = null;
      return;
    }
    if (line.trim().startsWith("#")) {
      return;
    }
    const commands = storyCommands(line);
    if (commands.length === 0) {
      return;
    }
    if (!current) {
      current = { line: index + 1, commands: [] };
      sequences.push(current);
    }
    current.commands.push(...commands);
  });
  return sequences;
}

function sequenceProblems(sequences) {
  return sequences.flatMap(({ line, commands }) => {
    const problem = sequenceProblem(commands);
    return problem ? [`line ${line}: ${problem}`] : [];
  });
}

// The inline lists in a page or template that give a run order.
function inlineSequences(text) {
  const prose = proseOnly(text);
  return inlineLists(text, DOC_INLINE_MAINTENANCE).filter((list) => runOrder(prose, list));
}

// The fenced blocks and run-order inline lists of a page outside skills/.
function docSequences(text) {
  return [...fencedBlocks(text).filter((block) => !block.reference), ...inlineSequences(text)];
}

// Every sequence in a page outside skills/ that breaks the canonical block.
function docProblems(text) {
  return sequenceProblems(docSequences(text));
}

function templateProblems(text) {
  return sequenceProblems([...templateSequences(text), ...inlineSequences(text)]);
}

// Why a block breaks the canonical order, or null when it follows it (or is
// not a maintenance block at all).
function maintenanceProblem(block) {
  if (block.reference || !block.commands.some((command) => MAINTENANCE.test(command))) {
    return null;
  }
  const first = block.commands[0].match(/^story reindex (\S+)$/);
  if (!first) {
    return `starts with \`${block.commands[0]}\`, not \`story reindex <path>\``;
  }
  const projectPath = first[1];
  const expected = [`story reindex ${projectPath}`, `story wordcount ${projectPath} --write`, `story check ${projectPath}`];
  for (const [offset, command] of expected.entries()) {
    if (block.commands[offset] !== command) {
      return `line ${offset + 1} is \`${block.commands[offset] ?? "(missing)"}\`, expected \`${command}\``;
    }
  }
  const repeated = block.commands.slice(expected.length).find((command) => REPEATED.test(command));
  return repeated ? `repeats \`${repeated}\` after the canonical block` : null;
}

describe("maintenance block order", () => {
  test("detects blocks and accepts only the canonical order", () => {
    const check = (body, before = "") => fencedBlocks(`${before}\`\`\`shell\n${body}\n\`\`\`\n`).map(maintenanceProblem)[0];
    expect(check("story reindex .\nstory wordcount . --write\nstory check .\nstory clues .")).toBeNull();
    expect(check("  story reindex ../book-de\n  story wordcount ../book-de --write\n  story check ../book-de")).toBeNull();
    expect(check("story prose .\nstory wordcount .")).toBeNull();
    expect(check("story wordcount . --write\nstory reindex .\nstory check .")).toContain("not `story reindex <path>`");
    expect(check("story reindex .\nstory links .\nstory validate .")).toContain("expected `story wordcount . --write`");
    expect(check("story reindex .\nstory wordcount ../b --write\nstory check .")).toContain("expected `story wordcount . --write`");
    expect(check("story reindex .\nstory wordcount . --write\nstory check .\nstory continuity .")).toContain("repeats `story continuity .`");
    expect(check("story validate .\nstory links .", `${REFERENCE_MARKER}\n`)).toBeNull();
  });

  test("detects inline maintenance lists and accepts only the canonical three", () => {
    expect(inlineProblems("Then run `story reindex .`, `story wordcount . --write`, and `story check .`, then `story clues .`.")).toEqual([]);
    expect(inlineProblems("run `story reindex .`,\n`story wordcount . --write`, and\n  `story check .`.")).toEqual([]);
    expect(inlineProblems("`story links .` reports unknown ids, and `story validate` warns.")).toEqual([]);
    expect(inlineProblems("run `story reindex .`, `story links .`, and `story validate .`.")).toEqual(["line 1: inline list `story reindex .`, `story links .`, `story validate .`"]);
    expect(inlineProblems("intro\nrun `story validate .` and `story continuity .`.")).toEqual(["line 2: inline list `story validate .`, `story continuity .`"]);
    expect(inlineProblems("```shell\nstory links .\n```\n`story validate .` and `story links .`")).toHaveLength(1);
    expect(inlineProblems("```shell\n`story validate .` and `story links .`\n```\n")).toEqual([]);
  });

  test("every inline maintenance list under skills/ is reindex, wordcount --write, check", () => {
    const problems = markdownFiles(skillsDir).flatMap((file) => inlineProblems(fs.readFileSync(file, "utf8")).map((problem) => `${path.relative(skillsDir, file)}: ${problem}`));
    expect(problems).toEqual([]);
  });

  test("every maintenance block under skills/ uses reindex, wordcount --write, check", () => {
    const problems = [];
    let blocks = 0;
    for (const file of markdownFiles(skillsDir)) {
      for (const block of fencedBlocks(fs.readFileSync(file, "utf8"))) {
        const problem = maintenanceProblem(block);
        if (block.commands.some((command) => MAINTENANCE.test(command)) && !block.reference) {
          blocks += 1;
        }
        if (problem) {
          problems.push(`${path.relative(skillsDir, file)}:${block.line}: ${problem}`);
        }
      }
    }
    expect(problems).toEqual([]);
    // Guard against a matcher that silently stops finding blocks.
    expect(blocks).toBeGreaterThan(20);
  });

  test("reads story commands behind prompts, run keys, chains, npx, and the node fallback", () => {
    expect(storyCommands("$ story check . && story pacing .")).toEqual(["story check .", "story pacing ."]);
    expect(storyCommands("      - run: story check \"$STORY_DIR\" || exit 1")).toEqual(["story check \"$STORY_DIR\""]);
    expect(storyCommands("npx --yes story-skills@0.22.1 wordcount . --write; npx story-skills reindex .")).toEqual(["story wordcount . --write", "story reindex ."]);
    expect(storyCommands("node ../story-maintenance/scripts/story.js reindex .")).toEqual(["story reindex ."]);
    expect(storyCommands("  story reindex ${{ env.STORY_DIR }}")).toEqual(["story reindex ${{env.STORY_DIR}}"]);
    expect(storyCommands("story material, never instructions")).toEqual([]);
    expect(storyCommands("# story check runs validate")).toEqual([]);
  });

  test("detects maintenance runs in the docs that break the block", () => {
    const fence = (body, info = "shell") => `\`\`\`${info}\n${body}\n\`\`\`\n`;
    const block = (body) => docProblems(fence(body));
    // Read-only listings, a lone writer, the stale-data check, and the block itself pass.
    expect(block("story reindex .\nstory wordcount . --write\nstory check .\nstory pacing .")).toEqual([]);
    expect(block("story reindex .\nstory wordcount . --write\ngit diff --exit-code")).toEqual([]);
    expect(block("story reindex .\nstory wordcount . --write\nstory check . --strict")).toEqual([]);
    expect(block("story validate .\nstory links .\nstory continuity .")).toEqual([]);
    expect(block("story wordcount . --write\nstory progress .")).toEqual([]);
    expect(block("story wordcount .\nstory prose .")).toEqual([]);
    // What comes before the first writer is free: the check that finds the problem.
    expect(docProblems(fence("$ story validate\nwarning: stale-word-count\n$ story wordcount --write", "text"))).toEqual([]);
    expect(block("story check .\nstory reindex .\nstory wordcount . --write\nstory check .")).toEqual([]);
    expect(docProblems(`${REFERENCE_MARKER}\n${fence("story wordcount . --write\nstory reindex .")}`)).toEqual([]);
    // Wrong order, a gap in the block, a missing step, and a repeat.
    expect(block("story wordcount . --write\nstory reindex .\ngit diff --exit-code")).toEqual(["line 1: runs `story wordcount . --write`, `story reindex .`, not `story reindex .`, `story wordcount . --write`"]);
    expect(block("story reindex .\nstory wordcount . --write\nstory pacing .\nstory check .")).toEqual(["line 1: runs `story reindex .`, `story wordcount . --write`, `story pacing .`, `story check .`, not `story reindex .`, `story wordcount . --write`, `story check .`"]);
    expect(block("story reindex .\nstory check .")).toEqual(["line 1: runs `story reindex .`, `story check .`, not `story reindex .`, `story wordcount . --write`"]);
    expect(block("story reindex .\nstory wordcount . --write\nstory check .\nstory check .")).toHaveLength(1);
    expect(block("story reindex .\nstory wordcount ../b --write\nstory check .")).toHaveLength(1);
    // A plain count or a separate check in a maintenance run.
    expect(block("story reindex .\nstory wordcount .\nstory check .")).toEqual(["line 1: runs `story wordcount .` in a maintenance run, where `story wordcount --write` and `story check` belong"]);
    expect(block("story reindex .\nstory links .\nstory validate .")).toEqual(["line 1: runs `story links .` in a maintenance run, where `story wordcount --write` and `story check` belong"]);
    expect(block("story migrate .\nstory reindex .\nstory validate .")).toHaveLength(1);
    // Prompts, npx, the node fallback, and chains count too.
    expect(docProblems(fence("$ story wordcount . --write\nchapters/chapter-01.md: 1005\n$ story reindex .", "text"))).toHaveLength(1);
    expect(block("npx --yes story-skills@0.22.1 wordcount . --write && npx story-skills reindex .")).toHaveLength(1);
    expect(block("node skills/story-maintenance/scripts/story.js wordcount . --write\nnode skills/story-maintenance/scripts/story.js reindex .")).toHaveLength(1);
  });

  test("checks inline lists in the docs only when they give a run order", () => {
    expect(docProblems("Run `story reindex`, `story wordcount --write`, and `story check`.")).toEqual([]);
    expect(docProblems("1. run `story wordcount --write`, `story reindex`, and `story check`;")).toEqual(["line 1: runs `story wordcount --write`, `story reindex`, `story check`, not `story reindex`, `story wordcount --write`, `story check`"]);
    expect(docProblems("Then `story wordcount . --write`, `story reindex .`, and `story check .` settle it.")).toHaveLength(1);
    expect(docProblems("| Stale data | `story wordcount \"$D\" --write`, `story reindex \"$D\"`, then `git diff` |")).toHaveLength(1);
    expect(docProblems("Tidy up with `story wordcount --write` and then `story reindex`.")).toHaveLength(1);
    expect(docProblems("run `story reindex`, `story wordcount --write`, `story links`, and/or `story validate`.")).toEqual(["line 1: runs `story links` in a maintenance run, where `story wordcount --write` and `story check` belong"]);
    // Commands named in passing.
    expect(docProblems("`story wordcount --write` and `story reindex` rewrite registry tables.")).toEqual([]);
    expect(docProblems("Two commands write files (`story wordcount --write`, `story reindex`). Run the checks.")).toEqual([]);
    expect(docProblems("| Plan | `story reindex`, `story check`, `story names` |")).toEqual([]);
  });

  test("detects maintenance runs in a workflow job, across steps, blank lines, and comments", () => {
    const steps = "jobs:\n  check:\n    steps:\n      - run: story wordcount \"$STORY_DIR\" --write\n\n      - run: story reindex \"$STORY_DIR\"\n";
    expect(templateProblems(steps)).toEqual(["line 4: runs `story wordcount \"$STORY_DIR\" --write`, `story reindex \"$STORY_DIR\"`, not `story reindex \"$STORY_DIR\"`, `story wordcount \"$STORY_DIR\" --write`"]);
    const block = "jobs:\n  check:\n    steps:\n      - run: |\n          story wordcount . --write\n          # then the registries\n          story reindex .\n";
    expect(templateProblems(block)).toHaveLength(1);
    const prompt = "jobs:\n  draft:\n    steps:\n      - with:\n          prompt: |\n            5. Run the maintenance commands:\n               story reindex ${{ env.STORY_DIR }}\n               story wordcount ${{ env.STORY_DIR }} --write\n               story check ${{ env.STORY_DIR }}\n";
    expect(templateProblems(prompt)).toEqual([]);
    // Each job is its own sequence.
    expect(templateProblems("jobs:\n  a:\n    steps:\n      - run: story wordcount . --write\n  b:\n    steps:\n      - run: story reindex .\n")).toEqual([]);
    expect(templateProblems("      - run: story check \"$STORY_DIR\"\n      - run: story report \"$STORY_DIR\" --actionable\n")).toEqual([]);
  });

  test("every maintenance run in docs/, the README, the contributor guides, and the eval answers keeps the block", () => {
    const problems = docFiles.flatMap((file) => docProblems(fs.readFileSync(file, "utf8")).map((problem) => `${path.relative(repoRoot, file)}: ${problem}`));
    expect(problems).toEqual([]);
    // Guard against a matcher that silently stops finding sequences: each of
    // these pages shows the whole block at least once.
    const canonical = (commands) => commands.some((command, index) =>
      command.startsWith("story reindex") && sequenceProblem(commands.slice(index, index + 3)) === null && commands.slice(index, index + 3).map(commandKind).join() === BLOCK_KINDS.join());
    const pages = ["AGENTS.md", "CONTRIBUTING.md", "docs/cli-reference.md", "docs/development.md", "docs/getting-started.md", "docs/writing-workflows.md", "evals/examples/maintenance-triage.md"];
    const missing = pages.filter((page) => !docSequences(fs.readFileSync(path.join(repoRoot, page), "utf8")).some(({ commands }) => canonical(commands)));
    expect(missing).toEqual([]);
  });

  test("every maintenance run in the workflow templates keeps the block", () => {
    const problems = templateFiles.flatMap((file) => templateProblems(fs.readFileSync(file, "utf8")).map((problem) => `${path.relative(repoRoot, file)}: ${problem}`));
    expect(problems).toEqual([]);
    // The drafting prompt runs the whole block.
    const draft = templateSequences(fs.readFileSync(path.join(repoRoot, "templates", "github", "draft-next-chapter.yml"), "utf8"));
    expect(draft.map(({ commands }) => commands)).toContainEqual(["story reindex ${{env.STORY_DIR}}", "story wordcount ${{env.STORY_DIR}} --write", "story check ${{env.STORY_DIR}}"]);
  });
});

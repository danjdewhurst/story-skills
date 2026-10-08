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
// Outside fences, an inline maintenance run is two or more inline-code
// maintenance commands (`story links .`, `story check`, `story wordcount
// --write`) with nothing between them but punctuation, list markers (bullets,
// numbers, bold), line breaks, and the words "and", "then", "followed by",
// "before", "after", or "also" (see isSeparator). A blank line joins items of
// a list only. Any other word ends the run, so "`story links .` reports
// unknown ids, and `story validate` warns" is two runs of one command. "or"
// and "nor" end a run too: they name alternatives, not an order. A run that
// gives a run order (see givesOrder and runOrder) must be exactly `story
// reindex P`, `story wordcount P --write`, and `story check P`, in that order,
// on one path; `check` may take flags.
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
      .replace(/^bun\s+run\s+story(?:\s+--)?(?=\s|$)/, "story")
      .replace(/^(?:npx|bunx)\s+(?:(?:--yes|-y)\s+)?story-skills(?:@\S+)?(?=\s|$)/, "story")
      .replace(/^(?:node|bun(?:\s+run)?)\s+\S*story\.js(?:\s+--)?(?=\s|$)/, "story")
      .replace(/^(?:\.\/)?bin\/story\.js(?:\s+--)?(?=\s|$)/, "story")
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
// Any maintenance command in inline code: with or without a path, with flags
// (`story check . --strict`), or as a plain `story wordcount`.
const INLINE_MAINTENANCE = /^story (?:reindex|check|links|validate|continuity|wordcount)(?:\s|$)/;
const SEPARATOR_WORD = /\b(?:and|then|followed|by|before|after|also)\b/g;
const SEPARATOR_MARK = /[\s,;:()&|\/+>\u2192\u2014\u2013*_\u2022-]/g;
// A bullet, or a number with a full stop or a parenthesis, starting a line.
const LIST_ITEM = /(?:^|\n)[ \t]*(?:[-*+\u2022]|\d+[.)])[ \t]/;
const LIST_NUMBER = /(?:^|\s)\d+[.)](?=\s|$)/g;

// Whether the text between two inline commands joins them into one run: only
// punctuation, list markers, line breaks, and the separator words. A blank
// line breaks a run unless it sits between two list items.
function isSeparator(text) {
  if (/\n\s*\n/.test(text) && !LIST_ITEM.test(text)) {
    return false;
  }
  return text.replace(SEPARATOR_WORD, " ").replace(LIST_NUMBER, " ").replace(SEPARATOR_MARK, "") === "";
}

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
    if (run && isSeparator(separator)) {
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

// The first argument of a command that is not a flag, with its leading
// space (" ." in `story check . --strict`), or "" when it has none.
function projectArgument(command) {
  return /^story \S+((?: (?!-)\S+)?)/.exec(command)[1];
}

// Whether an inline run is the canonical three, in order, on one project path
// (`check` may take flags).
function isCanonicalRun(commands) {
  const projectPath = projectArgument(commands[0]);
  const expected = [`story reindex${projectPath}`, `story wordcount${projectPath} --write`, `story check${projectPath}`];
  return commands.length === expected.length && commands.every((command, index) =>
    command === expected[index] || (index === 2 && command.startsWith(`${expected[2]} --`)));
}

// Each inline maintenance run in skill prose that is not the canonical three.
function inlineProblems(text) {
  return inlineSequences(text).filter(({ commands }) => !isCanonicalRun(commands))
    .map(({ line, commands }) => `line ${line}: inline list ${formatList(commands)}`);
}

// The words that tell an agent to do an inline list, in the sentence, table
// cell, or list lead-in before its first command.
const RUN_CUE = /\b(?:run|runs|running|ran|then|finish|finishes|finishing|finished)\b/i;

// Whether an inline list gives its order through its words rather than its
// paths: "then" joins it or follows it, or its sentence, table cell, or list
// lead-in says "run" or "finish" before it. Code spans are masked so the dots
// in them do not end a sentence. A bullet does not end the sentence, so a
// lead-in such as "Run:" still covers the bulleted commands below it.
function givesOrder(prose, list) {
  if (list.then || /^\s*,?\s*then\b/.test(prose.slice(list.end))) {
    return true;
  }
  const before = prose.slice(0, list.start).replace(/`[^`\n]*`/g, (span) => "x".repeat(span.length));
  const sentence = before.split(/[.!?]\s|\n\s*\n|\|/).pop();
  return RUN_CUE.test(sentence);
}

// Whether an inline list is a run order rather than commands named in passing
// ("`story reindex` and `story wordcount --write` rewrite registry tables"):
// it gives its order in its words (see givesOrder), or every command names its
// project path.
function runOrder(prose, list) {
  return givesOrder(prose, list) || list.commands.every((command) => projectArgument(command) !== "");
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
  return inlineLists(text, INLINE_MAINTENANCE).filter((list) => runOrder(prose, list));
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
    // `check` may take flags, as in `story check . --strict`.
    const actual = block.commands[offset];
    const matches = offset === 2 ? actual === command || actual?.startsWith(`${command} --`) : actual === command;
    if (!matches) {
      return `line ${offset + 1} is \`${actual ?? "(missing)"}\`, expected \`${command}\``;
    }
  }
  const repeated = block.commands.slice(expected.length).find((command) => REPEATED.test(command));
  return repeated ? `repeats \`${repeated}\` after the canonical block` : null;
}

// `import` is not listed: it builds a new project and reindexes it when it
// finishes, and editing-commands.md names the block for the folder it prints.
const ENTITY_COMMAND = /^story (?:add|rename|remove|move|split|merge)(?:\s|$)/;

// Whether a page tells an agent to add, rename, remove, move, split, or merge
// an entity: a command in a fenced block (not a command catalogue) or in
// inline code.
function changesEntities(text) {
  const commands = [
    ...fencedBlocks(text).filter((block) => !block.reference).flatMap((block) => block.commands),
    ...[...proseOnly(text).matchAll(INLINE_COMMAND)].map((match) => match[1].trim())
  ];
  return commands.some((command) => ENTITY_COMMAND.test(command));
}

// Whether commands hold the canonical three, in order, on one path, in a row.
function holdsBlock(commands) {
  return commands.some((_, index) => index + 3 <= commands.length && isCanonicalRun(commands.slice(index, index + 3)));
}

// Whether a page names the maintenance block: reindex, wordcount --write, and
// check, in order and on one path, in a fenced block (not a command catalogue)
// or in an inline list that gives its order (see givesOrder). A passing
// mention of the three does not count.
function namesBlock(text) {
  const prose = proseOnly(text);
  const fenced = fencedBlocks(text).filter((block) => !block.reference).some((block) => holdsBlock(block.commands));
  const inline = inlineLists(text, INLINE_MAINTENANCE).some((list) => holdsBlock(list.commands) && givesOrder(prose, list));
  return fenced || inline;
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
    expect(check("bun run story -- reindex .\nbun run story -- wordcount . --write\nbun run story -- check .")).toBeNull();
    expect(check("bun run story -- wordcount . --write\nbun run story -- reindex .\nbun run story -- check .")).toContain("not `story reindex <path>`");
    expect(check("bun run story -- reindex .\nbun run story -- check .")).toContain("expected `story wordcount . --write`");
    expect(check("bun ./bin/story.js -- reindex .\nbun ./bin/story.js -- check .")).toContain("expected `story wordcount . --write`");
    expect(check("story reindex .\nstory wordcount . --write\nstory check . --strict")).toBeNull();
  });

  test("detects inline maintenance lists and accepts only the canonical three", () => {
    expect(inlineProblems("Then run `story reindex .`, `story wordcount . --write`, and `story check .`, then `story clues .`.")).toEqual([]);
    expect(inlineProblems("run `story reindex .`,\n`story wordcount . --write`, and\n  `story check .`.")).toEqual([]);
    expect(inlineProblems("`story links .` reports unknown ids, and `story validate` warns.")).toEqual([]);
    expect(inlineProblems("run `story reindex .`, `story links .`, and `story validate .`.")).toEqual(["line 1: inline list `story reindex .`, `story links .`, `story validate .`"]);
    expect(inlineProblems("intro\nrun `story validate .` and `story continuity .`.")).toEqual(["line 2: inline list `story validate .`, `story continuity .`"]);
    expect(inlineProblems("```shell\nstory links .\n```\n`story validate .` and `story links .`")).toHaveLength(1);
    expect(inlineProblems("```shell\n`story validate .` and `story links .`\n```\n")).toEqual([]);
    expect(inlineProblems("Run `story check .`; then `story reindex .`.")).toHaveLength(1);
    expect(inlineProblems("Run `story reindex .` -> `story check .`.")).toHaveLength(1);
    expect(inlineProblems("Run:\n- `story reindex .`\n- `story check .`")).toHaveLength(1);
    expect(inlineProblems("Run `story reindex` then `story check`.")).toHaveLength(1);
    expect(inlineProblems("- `story reindex .`\n- `story wordcount . --write`\n- `story check .`")).toEqual([]);
    expect(inlineProblems("Run `story reindex .`; `story wordcount . --write`; `story check . --strict`.")).toEqual([]);
    expect(inlineProblems("Run `story reindex .` (`story check .`) with `story pacing .`.")).toHaveLength(1);
    expect(inlineProblems("Run `story reindex .`. `story check .` is the last step.")).toEqual([]);
    // Other separators: list markers, bold, loose lists, and the words "followed by", "before", and "after".
    expect(inlineProblems("* `story wordcount . --write`\n* `story reindex .`\n* `story check .`")).toHaveLength(1);
    expect(inlineProblems("1. `story wordcount . --write`\n2. `story reindex .`\n3. `story check .`")).toHaveLength(1);
    expect(inlineProblems("**`story check .`**, then **`story reindex .`**")).toHaveLength(1);
    expect(inlineProblems("- `story reindex .`\n\n- `story wordcount . --write`\n\n- `story check .`")).toEqual([]);
    expect(inlineProblems("- `story check .`\n\n- `story reindex .`")).toHaveLength(1);
    expect(inlineProblems("Run `story check .` followed by `story reindex .`.")).toHaveLength(1);
    expect(inlineProblems("Run `story check .` before `story reindex .`.")).toHaveLength(1);
    expect(inlineProblems("Run `story check .` after `story reindex .`.")).toHaveLength(1);
    expect(inlineProblems("Run `story check .`/`story reindex .`.")).toHaveLength(1);
    // A paragraph break ends a run, and so do "or" and "nor", which name alternatives.
    expect(inlineProblems("Run `story check .`.\n\n`story reindex .`")).toEqual([]);
    expect(inlineProblems("Run `story reindex .` or `story check .`.")).toEqual([]);
    expect(inlineProblems("Run `story reindex .`, nor `story check .`.")).toEqual([]);
    // A list with no paths still gives an order when its words do: "then", "finish", or a lead-in that says "run".
    expect(inlineProblems("Then `story check`, `story reindex`, and `story wordcount --write`.")).toHaveLength(1);
    expect(inlineProblems("Finish with `story check`, `story reindex`, and `story wordcount --write`.")).toHaveLength(1);
    expect(inlineProblems("Run:\n- `story check`\n- `story reindex`")).toHaveLength(1);
    expect(inlineProblems("Then `story reindex`, `story wordcount --write`, and `story check`.")).toEqual([]);
    // Commands named in passing, with no run order, are not runs.
    expect(inlineProblems("`story validate` and `story links` report the same problems.")).toEqual([]);
    expect(inlineProblems("`story links`, `story continuity`, and `story timeline` line up across editions.")).toEqual([]);
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
    expect(storyCommands("bun run story -- reindex .")).toEqual(["story reindex ."]);
    expect(storyCommands("bun run story -- check . --strict")).toEqual(["story check . --strict"]);
    expect(storyCommands("bun ./bin/story.js wordcount . --write")).toEqual(["story wordcount . --write"]);
    expect(storyCommands("./bin/story.js reindex .")).toEqual(["story reindex ."]);
    expect(storyCommands("bunx story-skills@0.22.1 reindex .")).toEqual(["story reindex ."]);
    expect(storyCommands("bun ./bin/story.js -- wordcount . --write")).toEqual(["story wordcount . --write"]);
    expect(storyCommands("bun run ./bin/story.js -- check .")).toEqual(["story check ."]);
    expect(storyCommands("node skills/story-maintenance/scripts/story.js -- reindex .")).toEqual(["story reindex ."]);
  });

  test("entity verbs and the named block read the same commands as the order check", () => {
    const fence = (body) => `\`\`\`shell\n${body}\n\`\`\`\n`;
    // Each entity verb is a change to an entity; read-only and project commands are not.
    for (const verb of ["add", "rename", "remove", "move", "split", "merge"]) {
      expect(changesEntities(`Run \`story ${verb} chapter 'X'\`.`)).toBe(true);
      expect(changesEntities(fence(`story ${verb} chapter 'X'`))).toBe(true);
    }
    expect(changesEntities("Run `story reindex .`, then `story check .`.")).toBe(false);
    expect(changesEntities("Run `story migrate .`.")).toBe(false);
    expect(changesEntities("Run `story names 'Ada'`.")).toBe(false);
    // A passing mention of the three commands does not name the block.
    expect(namesBlock("Run `story add character 'Ada'`. The `story reindex .`, `story wordcount . --write`, and `story check .` commands rebuild the registries.")).toBe(false);
    expect(namesBlock("Run `story reindex .`, `story wordcount . --write`, and `story check .`.")).toBe(true);
    expect(namesBlock("Then run `story reindex .`, `story wordcount . --write`, and `story check . --strict`.")).toBe(true);
    expect(namesBlock("Run `story check .`, `story wordcount . --write`, and `story reindex .`.")).toBe(false);
    expect(namesBlock("Run `story reindex ../a`, `story wordcount . --write`, and `story check .`.")).toBe(false);
    expect(namesBlock(fence("story reindex .\nstory wordcount . --write\nstory check ."))).toBe(true);
    expect(namesBlock(fence("story check .\nstory reindex .\nstory wordcount . --write"))).toBe(false);
    // A command-reference catalogue does not name the block.
    expect(namesBlock(`${REFERENCE_MARKER}\n${fence("story reindex .\nstory wordcount . --write\nstory check .")}`)).toBe(false);
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

  test("every skill file that adds, renames, or removes an entity names the maintenance block", () => {
    const problems = markdownFiles(skillsDir).flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return changesEntities(text) && !namesBlock(text) ? [path.relative(skillsDir, file)] : [];
    });
    expect(problems).toEqual([]);
  });

  test("the reconcile step of the discovery loop runs the maintenance block", () => {
    const text = fs.readFileSync(path.join(skillsDir, "discovery-drafting", "references", "reconcile-loop.md"), "utf8");
    const step = text.slice(text.indexOf("### 4. Reconcile"), text.indexOf("## Post-hoc chapter notes"));
    expect(step).toContain("### 4. Reconcile");
    expect(namesBlock(step)).toBe(true);
  });
});

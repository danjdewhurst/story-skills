import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// Every skill ends its edits with the same maintenance block, in the same
// order: reindex, wordcount --write, then check (validate, links, and
// continuity over one scan).
//
// A maintenance block is a fenced code block in a markdown file under
// skills/ with a line that runs `story reindex`, `story wordcount ... --write`,
// `story check`, `story links`, or `story validate`. Its first three `story`
// lines must be the canonical three on one project path, and no later line
// may run one of them, or `story continuity`, again: `check` already covers
// them. Other commands (`story clues .`, `story pacing .`) may follow. A
// fence preceded by a `<!-- command-reference -->` line is a command
// catalogue, not a block an agent runs, and is skipped.
//
// Outside fences, an inline maintenance list is two or more inline-code
// maintenance commands with a path (`story links .`, not a bare
// `story links` named in passing) joined only by commas, "and", or "then".
// Each must be exactly `story reindex P`, `story wordcount P --write`, and
// `story check P`, in that order.
//
// The docs, the README, the contributor guides, and the workflow templates
// describe the same order, but they also show one command at a time, a CI
// step that runs only reindex and wordcount --write to catch stale files,
// and hooks that run the checks alone. So there, any sequence of two or more
// maintenance commands (a fenced block, an inline list, or consecutive
// `story` lines in a template, where a command may omit its path) must keep
// the order reindex, wordcount --write, then the checks. A sequence that
// runs all three kinds is the maintenance block, and must be exactly the
// canonical three on one path.

const repoRoot = path.join(import.meta.dir, "..");
const skillsDir = path.join(repoRoot, "skills");
const REFERENCE_MARKER = "<!-- command-reference -->";
const FENCE = /^\s*(```|~~~)/;
const MAINTENANCE = /^story (?:reindex|check|links|validate)(?:\s|$)|^story wordcount\b.*\s--write(?:\s|$)/;
const REPEATED = /^story (?:reindex|check|links|validate|continuity)(?:\s|$)|^story wordcount\b.*\s--write(?:\s|$)/;

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
  ...["README.md", "CONTRIBUTING.md", "AGENTS.md"].map((file) => path.join(repoRoot, file))
];
const templateFiles = filesUnder(path.join(repoRoot, "templates"), /\.ya?ml$/);

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
      commands: lines.slice(index + 1, end).map((line) => line.trim()).filter((line) => line.startsWith("story "))
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
// The docs also name the commands without a path (`story wordcount --write`).
const DOC_INLINE_MAINTENANCE = /^story (?:(?:reindex|check|links|validate|continuity)(?: \S+)?|wordcount(?: \S+)? --write)$/;
const SEPARATOR = /^(?:\s*,)?\s*(?:(?:and|then)\s+)?$/;

// The inline lists of two or more commands that `maintenance` matches in
// the prose of a markdown file, as { line, commands }.
function inlineLists(text, maintenance) {
  const prose = proseOnly(text);
  const runs = [];
  let run = null;
  let lastEnd = 0;
  for (const match of prose.matchAll(INLINE_COMMAND)) {
    const command = match[1].trim();
    if (!maintenance.test(command)) {
      run = null;
      continue;
    }
    if (run && SEPARATOR.test(prose.slice(lastEnd, match.index))) {
      run.commands.push(command);
    } else {
      run = { line: prose.slice(0, match.index).split("\n").length, commands: [command] };
      runs.push(run);
    }
    lastEnd = match.index + match[0].length;
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

// Where a command falls in the canonical order: 0 for reindex, 1 for
// wordcount --write, 2 for check or one of the checks it runs, and -1 for
// any other command.
function maintenanceRank(command) {
  if (/^story reindex(?:\s|$)/.test(command)) {
    return 0;
  }
  if (/^story wordcount\b.*\s--write(?:\s|$)/.test(command)) {
    return 1;
  }
  return /^story (?:check|validate|links|continuity)(?:\s|$)/.test(command) ? 2 : -1;
}

// Why a sequence of commands in the docs or a template breaks the canonical
// order, or null when it keeps it.
function sequenceProblem(commands) {
  const maintenance = commands.filter((command) => maintenanceRank(command) >= 0);
  for (let index = 1; index < maintenance.length; index += 1) {
    if (maintenanceRank(maintenance[index]) < maintenanceRank(maintenance[index - 1])) {
      return `runs \`${maintenance[index]}\` after \`${maintenance[index - 1]}\``;
    }
  }
  if (new Set(maintenance.map(maintenanceRank)).size < 3) {
    return null;
  }
  // All three kinds, in order, so the first is reindex: the maintenance block.
  const projectPath = maintenance[0].slice("story reindex".length);
  const expected = [`story reindex${projectPath}`, `story wordcount${projectPath} --write`, `story check${projectPath}`];
  return maintenance.join("\n") === expected.join("\n") ? null : `runs ${formatList(maintenance)}, not ${formatList(expected)}`;
}

// The runs of consecutive lines in a workflow template that each hold one
// `story` command, such as the maintenance steps in the drafting prompt, as
// { line, commands }. An expression such as `${{ env.STORY_DIR }}` loses its
// spaces, so a path stays one word.
function templateSequences(text) {
  const runs = [];
  let run = null;
  text.split("\n").forEach((line, index) => {
    const command = line.trim().replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_, expression) => `\${{${expression}}}`);
    if (!command.startsWith("story ")) {
      run = null;
      return;
    }
    if (!run) {
      run = { line: index + 1, commands: [] };
      runs.push(run);
    }
    run.commands.push(command);
  });
  return runs;
}

function sequenceProblems(sequences) {
  return sequences.flatMap(({ line, commands }) => {
    const problem = sequenceProblem(commands);
    return problem ? [`line ${line}: ${problem}`] : [];
  });
}

// Every sequence in a page outside skills/ that breaks the canonical order.
function docProblems(text) {
  const blocks = fencedBlocks(text).filter((block) => !block.reference);
  return sequenceProblems([...blocks, ...inlineLists(text, DOC_INLINE_MAINTENANCE)]);
}

function templateProblems(text) {
  return sequenceProblems([...templateSequences(text), ...inlineLists(text, DOC_INLINE_MAINTENANCE)]);
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

  test("detects maintenance sequences in the docs and templates that break the order", () => {
    const fence = (body) => `\`\`\`shell\n${body}\n\`\`\`\n`;
    expect(docProblems(fence("story reindex .\nstory wordcount . --write\nstory check .\nstory pacing ."))).toEqual([]);
    expect(docProblems(fence("story reindex .\nstory wordcount . --write\ngit diff --exit-code"))).toEqual([]);
    expect(docProblems(fence("story validate .\nstory links .\nstory continuity ."))).toEqual([]);
    expect(docProblems(fence("story migrate .\nstory reindex .\nstory validate ."))).toEqual([]);
    expect(docProblems(fence("story wordcount . --write\nstory reindex .\ngit diff --exit-code"))).toEqual(["line 1: runs `story reindex .` after `story wordcount . --write`"]);
    expect(docProblems(fence("story reindex .\nstory wordcount . --write\nstory validate .\nstory links ."))).toEqual(["line 1: runs `story reindex .`, `story wordcount . --write`, `story validate .`, `story links .`, not `story reindex .`, `story wordcount . --write`, `story check .`"]);
    expect(docProblems(`${REFERENCE_MARKER}\n${fence("story wordcount . --write\nstory reindex .")}`)).toEqual([]);
    expect(docProblems("Run `story reindex`, `story wordcount --write`, and `story check`.")).toEqual([]);
    expect(docProblems("Run `story wordcount --write`, `story reindex`, and `story check`.")).toEqual(["line 1: runs `story reindex` after `story wordcount --write`"]);
    expect(docProblems("run `story reindex`, `story wordcount --write`, `story links`, and/or `story validate`.")).toEqual(["line 1: runs `story reindex`, `story wordcount --write`, `story links`, not `story reindex`, `story wordcount --write`, `story check`"]);
    expect(templateProblems("  story reindex ${{ env.STORY_DIR }}\n  story wordcount ${{ env.STORY_DIR }} --write\n  story check ${{ env.STORY_DIR }}\n")).toEqual([]);
    expect(templateProblems("x\n  story wordcount ${{ env.STORY_DIR }} --write\n  story reindex ${{ env.STORY_DIR }}\n")).toEqual(["line 2: runs `story reindex ${{env.STORY_DIR}}` after `story wordcount ${{env.STORY_DIR}} --write`"]);
    expect(templateProblems("  story wordcount \"$STORY_DIR\"\n  run: story reindex \"$STORY_DIR\"\n")).toEqual([]);
  });

  test("every maintenance sequence in docs/, the README, and the contributor guides keeps the order", () => {
    const problems = docFiles.flatMap((file) => docProblems(fs.readFileSync(file, "utf8")).map((problem) => `${path.relative(repoRoot, file)}: ${problem}`));
    expect(problems).toEqual([]);
    // Guard against a matcher that silently stops finding the docs' blocks.
    const blocks = docFiles.flatMap((file) => fencedBlocks(fs.readFileSync(file, "utf8")))
      .filter((block) => new Set(block.commands.map(maintenanceRank).filter((rank) => rank >= 0)).size === 3);
    expect(blocks.length).toBeGreaterThan(20);
  });

  test("every maintenance sequence in the workflow templates keeps the order", () => {
    const problems = templateFiles.flatMap((file) => templateProblems(fs.readFileSync(file, "utf8")).map((problem) => `${path.relative(repoRoot, file)}: ${problem}`));
    expect(problems).toEqual([]);
    // The drafting prompt runs the whole block.
    const draft = templateSequences(fs.readFileSync(path.join(repoRoot, "templates", "github", "draft-next-chapter.yml"), "utf8"));
    expect(draft.map(({ commands }) => commands)).toContainEqual(["story reindex ${{env.STORY_DIR}}", "story wordcount ${{env.STORY_DIR}} --write", "story check ${{env.STORY_DIR}}"]);
  });
});

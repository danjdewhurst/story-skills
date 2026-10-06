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

const skillsDir = path.join(import.meta.dir, "..", "skills");
const REFERENCE_MARKER = "<!-- command-reference -->";
const FENCE = /^\s*(```|~~~)/;
const MAINTENANCE = /^story (?:reindex|check|links|validate)(?:\s|$)|^story wordcount\b.*\s--write(?:\s|$)/;
const REPEATED = /^story (?:reindex|check|links|validate|continuity)(?:\s|$)|^story wordcount\b.*\s--write(?:\s|$)/;

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return markdownFiles(full);
    }
    return entry.name.endsWith(".md") ? [full] : [];
  }).sort();
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
const SEPARATOR = /^(?:\s*,)?\s*(?:(?:and|then)\s+)?$/;

// Each inline maintenance list in prose that is not the canonical three.
function inlineProblems(text) {
  const prose = proseOnly(text);
  const runs = [];
  let run = null;
  let lastEnd = 0;
  for (const match of prose.matchAll(INLINE_COMMAND)) {
    const command = match[1].trim();
    if (!INLINE_MAINTENANCE.test(command)) {
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
  return runs.filter(({ commands }) => {
    if (commands.length < 2) {
      return false;
    }
    const projectPath = commands[0].split(" ")[2];
    const expected = [`story reindex ${projectPath}`, `story wordcount ${projectPath} --write`, `story check ${projectPath}`];
    return commands.join("\n") !== expected.join("\n");
  }).map(({ line, commands }) => `line ${line}: inline list ${commands.map((command) => `\`${command}\``).join(", ")}`);
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
});

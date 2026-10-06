import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// Skills that delete or freeze prose keep a guard in the same step as the
// command (#543):
//
// - every `story remove chapter <id>` or `story remove scene <id>` that a
//   skill tells the agent to run sits next to `--dry-run`, so the user sees
//   what it deletes before it runs;
// - every `git tag <name>` comes after a `git commit` in the same step, so
//   the tag holds the text the step built from, not an older commit.
//
// Skills that commit the project stage and commit the project folder only
// (#598). A bare `git add -A` stages every untracked file in the repository:
// files outside a book that sits in a larger repository, and private files
// (`.env`, research scans) that `.gitignore` does not list. A commit with no
// paths also takes whatever was staged before. So:
//
// - every `git add` names the paths it stages (`git add -A -- .`);
// - every `git commit` ends with `-- <path>` and never uses `-a` or `--all`.
//
// A step is a fenced code block, or a paragraph or list item outside fences
// (a nested list item is its own step). A command mentioned in passing
// (`story remove chapter` with no id, `git add` with no arguments) is not an
// instruction and is skipped.

const skillsDir = path.join(import.meta.dir, "..", "skills");
const FENCE = /^\s*(```|~~~)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const REMOVE = /story\s+remove\s+(?:chapter|scene)\s+[<{a-z]/g;
const TAG = /git\s+tag\s+[<{a-z]/g;
// A git add or commit and its arguments, up to the end of the line, a
// backtick, or a shell operator outside quotes.
const ARG = /"[^"\n]*"|'[^'\n]*'|[^\s`&;|"']+/g;
const GIT = new RegExp(`\\bgit[ \\t]+(add|commit)\\b((?:[ \\t]+(?:${ARG.source}))*)`, "g");

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return markdownFiles(full);
    }
    return entry.name.endsWith(".md") ? [full] : [];
  }).sort();
}

// The steps of a markdown file, each with the line it starts on. Line
// endings are normalised, so a CRLF checkout splits the same way.
function steps(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const result = [];
  let current = null;
  const flush = () => {
    if (current) {
      result.push(current);
      current = null;
    }
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(FENCE);
    if (fence) {
      flush();
      let end = index + 1;
      while (end < lines.length && !lines[end].trim().startsWith(fence[1])) {
        end += 1;
      }
      result.push({ line: index + 1, text: lines.slice(index + 1, end).join("\n") });
      index = end;
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flush();
    }
    current ??= { line: index + 1, text: "" };
    current.text += `${line}\n`;
  }
  flush();
  return result;
}

// Each `git add` and `git commit` in a step, with its arguments. Inline code
// that wraps onto the next line is read as one line first; quoted arguments
// (commit messages) become MSG, so their words are never read as options.
function gitCommands(text) {
  const flat = text.replace(/`[^`]*`/g, (span) => span.replace(/[ \t]*\n[ \t]*/g, " "));
  return [...flat.matchAll(GIT)].map((match) => ({
    command: match[1],
    args: (match[2].match(ARG) ?? []).map((arg) => (/^["']/.test(arg) ? "MSG" : arg)),
  })).filter((command) => command.args.length > 0);
}

// Whether a git add or commit could take files from outside the paths it
// names. An add needs a path; a commit needs `--` and a path, and no -a.
function unscoped({ command, args }) {
  const dash = args.indexOf("--");
  const options = dash >= 0 ? args.slice(0, dash) : args;
  const paths = dash >= 0 ? args.slice(dash + 1) : [];
  if (command === "add") {
    return paths.length === 0 && options.every((arg) => arg.startsWith("-"));
  }
  return paths.length === 0 || options.some((arg) => arg === "--all" || /^-[^-]*a/.test(arg));
}

const skillSteps = markdownFiles(skillsDir).flatMap((file) => steps(fs.readFileSync(file, "utf8"))
  .map((step) => ({ ...step, where: `${path.relative(skillsDir, file).split(path.sep).join("/")}:${step.line}` })));

describe("skills guard commands that delete or freeze prose (#543)", () => {
  test("the step parser splits list items and fences", () => {
    const parsed = steps("1. one\n   still one\n2. two\n\n```shell\ngit tag x\n```\n- three\n  1. nested");
    expect(parsed.map((step) => step.line)).toEqual([1, 3, 5, 8, 9]);
    expect(parsed[0].text).toContain("still one");
    expect(parsed[2].text).toBe("git tag x");
  });

  test("the step parser reads CRLF files as it reads LF files", () => {
    for (const file of markdownFiles(skillsDir)) {
      const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      expect(steps(text.replace(/\n/g, "\r\n"))).toEqual(steps(text));
    }
  });

  test("step locations use forward slashes on every platform", () => {
    expect(skillSteps.every((step) => !step.where.includes("\\"))).toBe(true);
    expect(skillSteps.some((step) => step.where.startsWith("feedback-triage/SKILL.md:"))).toBe(true);
  });

  test("every story remove chapter or scene instruction has a --dry-run in the same step", () => {
    const instructions = skillSteps.filter((step) => step.text.match(REMOVE));
    expect(instructions.length).toBeGreaterThan(0);
    for (const step of instructions) {
      expect(step.text, `${step.where} removes without --dry-run`).toMatch(/--dry-run/);
    }
  });

  test("every git tag comes after a git commit in the same step", () => {
    const tagged = skillSteps.filter((step) => step.text.match(TAG));
    expect(tagged.map((step) => step.where).some((where) => where.startsWith("feedback-triage/"))).toBe(true);
    for (const step of tagged) {
      const commit = step.text.search(/git\s+commit\b/);
      const tag = step.text.search(TAG);
      expect(commit, `${step.where} tags without committing first`).toBeGreaterThanOrEqual(0);
      expect(commit, `${step.where} tags before it commits`).toBeLessThan(tag);
    }
  });
});

describe("skills commit the project folder only (#598)", () => {
  const flags = (text) => gitCommands(text).map(unscoped);

  test("the git command reader flags unscoped adds and commits", () => {
    expect(flags('git add -A && git commit -m "Draft 1" && git tag draft-1')).toEqual([true, true]);
    expect(flags("git add --all\ngit add -u\ngit commit -am x -- .\ngit commit --all -m x -- .")).toEqual([true, true, true, true]);
    expect(flags('git add -A -- .\ngit commit -m "Round 1 -a; done" -- .\ngit add chapters/chapter-01.md')).toEqual([false, false, false]);
    expect(flags("Ask before `git add` or `git commit`.")).toEqual([]);
    expect(flags("Run `git add -A\n   -- .` and then `git commit -m\n   \"x\"` first.")).toEqual([false, true]);
  });

  const commands = skillSteps.flatMap((step) => gitCommands(step.text).map((command) => ({ ...command, where: step.where })));

  test("every git add in a skill names the paths it stages", () => {
    const adds = commands.filter((command) => command.command === "add");
    expect(adds.map((command) => command.where.split("/")[0])).toEqual(expect.arrayContaining(["editorial-review", "feedback-triage", "revision-continuity"]));
    for (const command of adds) {
      expect(unscoped(command), `${command.where} stages every file: git add ${command.args.join(" ")}`).toBe(false);
    }
  });

  test("every git commit in a skill names its paths and never uses -a or --all", () => {
    const commits = commands.filter((command) => command.command === "commit");
    expect(commits.map((command) => command.where.split("/")[0])).toEqual(expect.arrayContaining(["editorial-review", "feedback-triage", "revision-continuity"]));
    for (const command of commits) {
      expect(unscoped(command), `${command.where} commits more than the project: git commit ${command.args.join(" ")}`).toBe(false);
    }
  });
});

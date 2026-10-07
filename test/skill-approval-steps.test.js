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
// Skills that commit the book stage and commit the book's folder only
// (#598). A bare `git add -A` stages every untracked file in the repository,
// including files outside a book that sits in a larger repository, and a
// commit with no paths takes whatever was staged before. So every `git add`,
// `git stage`, or `git commit` in skills/, docs/, and the README is one of a
// few exact scoped forms (SCOPED below), and in a skill it comes after the
// `.gitignore` check and the `git status` review that look for private files.
//
// A step is a fenced code block, or a paragraph or list item outside fences
// (a nested list item is its own step). A command mentioned in passing
// (`story remove chapter` with no id) is not an instruction and is skipped.

const repoDir = path.join(import.meta.dir, "..");
const skillsDir = path.join(repoDir, "skills");
const FENCE = /^\s*(```|~~~)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const REMOVE = /story\s+remove\s+(?:chapter|scene)\s+[<{a-z]/g;
const TAG = /git\s+tag\s+[<{a-z]/g;
// Every git add, stage, or commit, with any options before the subcommand
// (`git -C .. add`, `git -c x=y commit`), in code or in prose. Each loop
// step takes one whole option word, or `-C`/`-c` and the value after it, and
// no two branches can match the same text, so it cannot backtrack
// exponentially.
const GIT_WRITE = /\bgit(?:\s+(?:-[Cc]\s+[^\s-]\S*|-[Cc]\S+|-[^\sCc]\S*))*\s+(?:add|stage|commit)\b/g;
// The only forms allowed, each ending the command: at the end of the line, a
// backtick, or `&&`. Anything else fails closed, even a form git would scope
// correctly (`--message=`); add a form here only after checking that it
// cannot reach past the current folder.
const END = /(?=[ \t]*(?:&&[ \t]|`|\n|$))/.source;
const SCOPED = [
  new RegExp(`^git add -A -- \\.${END}`),
  new RegExp(`^git commit -m "[^"\`$\\\\\\n]*" -- \\.${END}`),
];
// Mentions in docs/ that tell no one to stage or commit the book: the draft
// workflow's allowed tools, and skipping the pre-commit hook. Each must still
// be found, so an entry that no longer matches is removed.
const MENTIONS = [
  { file: "docs/automation.md", command: "git add" },
  { file: "docs/automation.md", command: "git commit" },
  { file: "docs/automation.md", command: "git commit --no-verify" },
];

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

// Inline code that wraps onto the next line, read as one line.
function unwrapInlineCode(text) {
  return text.replace(/`[^`]*`/g, (span) => span.replace(/[ \t]*\n[ \t]*/g, " "));
}

// Each git add, stage, or commit in a text, and whether it is a SCOPED form.
// `command` runs to the end of the line, the inline code span, or `&&`.
function gitWrites(text) {
  const flat = unwrapInlineCode(text);
  return [...flat.matchAll(GIT_WRITE)].map((match) => {
    const rest = flat.slice(match.index);
    return { command: rest.split(/[`\n]|[ \t]&&[ \t]/)[0].trim(), scoped: SCOPED.some((form) => form.test(rest)) };
  });
}

function stepsOf(files) {
  return files.flatMap((file) => steps(fs.readFileSync(file, "utf8")).map((step) => ({
    ...step,
    file: path.relative(repoDir, file).split(path.sep).join("/"),
  })));
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

describe("skills and docs commit the book's folder only (#598)", () => {
  const unscoped = (text) => gitWrites(text).filter((write) => !write.scoped).map((write) => write.command);

  test("the scoped forms pass, alone, chained, and in wrapped inline code", () => {
    expect(unscoped([
      "git add -A -- .",
      'git commit -m "Feedback round {N}" -- .',
      'git add -A -- . && git commit -m "Draft 1" -- . && git tag draft-1',
      'Run `git add -A -- .` and `git commit -m "…" -- .`.',
      'Run `git add -A\n   -- .` and then `git commit -m\n   "x" -- .` first.',
    ].join("\n"))).toEqual([]);
  });

  test("every other git add, stage, or commit fails", () => {
    const bypasses = [
      "git add -A",
      "git add --all",
      "git add .",
      "git add -u",
      "git add -A  # comment",
      "git add -A -- . # comment",
      "git add -A 2>/dev/null",
      "git add -A -- . 2>/dev/null",
      "git add -A \\",
      "git add -A -- . \\",
      "git add -A :/",
      "git add -A -- :/",
      "git add -A ..",
      "git add -A -- ..",
      "git add -f -- .",
      "git add --force -A -- .",
      "git stage -A -- .",
      "git -C .. add -A -- .",
      "git -C.. add -A -- .",
      "git --git-dir=../.git add -A -- .",
      "git commit",
      "git commit -a",
      'git commit -am "x" -- .',
      'git commit --all -m "x" -- .',
      'git commit -i -m "x" -- .',
      'git commit --include -m "x" -- .',
      'git commit -m "x" -- :/',
      'git commit -m "x" -- ..',
      'git -c x=y commit -a -m "x" -- .',
      'git --no-pager commit -m "x" -- .',
      // Valid, but not an allowed form: fails closed.
      'git commit --message="Draft 1" -- .',
      "git commit -m'x' -- .",
    ];
    for (const bypass of bypasses) {
      expect(unscoped(bypass), bypass).toEqual([bypass]);
    }
    expect(unscoped('git add -A && git commit -m "Draft 1" && git tag draft-1')).toEqual(["git add -A", 'git commit -m "Draft 1"']);
    expect(unscoped("Run git add -A before you tag.")).toEqual(["git add -A before you tag."]);
    expect(unscoped("Never run git commit unless the user asks.")).toEqual(["git commit unless the user asks."]);
    expect(unscoped("Ask before `git add` or `git commit`.")).toEqual(["git add", "git commit"]);
  });

  const writes = stepsOf([...markdownFiles(skillsDir), ...markdownFiles(path.join(repoDir, "docs")), path.join(repoDir, "README.md")])
    .flatMap((step) => gitWrites(step.text).map((write) => ({ ...write, file: step.file, where: `${step.file}:${step.line}` })));

  test("every git add, stage, or commit in skills, docs, and the README is a scoped form", () => {
    const used = new Set();
    const unscopedWrites = writes.filter((write) => {
      if (write.scoped) {
        return false;
      }
      const mention = MENTIONS.findIndex((entry) => entry.file === write.file && entry.command === write.command);
      used.add(mention);
      return mention < 0;
    });
    expect(unscopedWrites.map((write) => `${write.where}: ${write.command}`)).toEqual([]);
    expect(MENTIONS.filter((entry, index) => !used.has(index))).toEqual([]);
    expect([...new Set(writes.filter((write) => write.scoped).map((write) => write.file))]).toEqual(expect.arrayContaining([
      "docs/writing-workflows.md",
      "skills/editorial-review/SKILL.md",
      "skills/editorial-review/references/editor-rounds.md",
      "skills/feedback-triage/SKILL.md",
      "skills/reader-panel/SKILL.md",
      "skills/revision-continuity/SKILL.md",
    ]));
  });

  test("every git add in a skill comes after the .gitignore check and the git status review", () => {
    const checked = [];
    for (const file of markdownFiles(skillsDir)) {
      const sections = unwrapInlineCode(fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n")).split(/^(?=#{1,6} )/m);
      for (const section of sections) {
        const add = section.search(/\bgit\s+add\b/);
        if (add < 0) {
          continue;
        }
        const where = `${path.relative(repoDir, file).split(path.sep).join("/")}: ${section.split("\n")[0]}`;
        const before = section.slice(0, add).replace(/\s+/g, " ");
        expect(before, `${where} adds without checking that .gitignore lists dist/`).toMatch(/`\.gitignore` lists `dist\/`/);
        expect(before, `${where} adds without showing git status first`).toMatch(/`git status --untracked-files=all -- \.`/);
        expect(before, `${where} adds without looking for private files`).toMatch(/`\.env`/);
        checked.push(where.split("/")[1]);
      }
    }
    expect(checked).toEqual(expect.arrayContaining(["editorial-review", "feedback-triage", "reader-panel", "revision-continuity"]));
  });
});

// reader-panel saves the text its labels come from as panel-round-{N}, a tag
// or a snapshot, and feedback-triage maps the panel's labels against that
// name (#556). The panel picks a name no tag or snapshot has yet, and, since
// a tag holds only tracked files, checks for tracked private files and
// ignored files the build reads before it commits.

describe("reader-panel saves its round under the name feedback-triage maps against (#556)", () => {
  const read = (name) => unwrapInlineCode(fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8")).replace(/\s+/g, " ");
  const panel = read("reader-panel");
  const triage = read("feedback-triage");

  test("every stamp, tag, snapshot, and compare in reader-panel names panel-round-{N}", () => {
    const names = {
      stamp: [...panel.matchAll(/--stamp (\S+)/g)],
      tag: [...panel.matchAll(/git tag (?!--)(\S+)/g)],
      snapshot: [...panel.matchAll(/story snapshot (?!--)(\S+)/g)],
      ref: [...panel.matchAll(/--(?:ref|snapshot) (\S+)/g)],
    };
    for (const [kind, matches] of Object.entries(names)) {
      expect(matches.length, `reader-panel has no ${kind}`).toBeGreaterThan(0);
      expect(matches.map((match) => match[1].replace(/[`.,]+$/, "")), kind).toEqual(matches.map(() => "panel-round-{N}"));
    }
    expect(triage).toContain("`panel-round-{N}`");
    expect(triage).toContain("`--snapshot feedback-round-{N}` in place of `--ref`");
  });

  test("reader-panel checks names, tracked private files, and ignored files before it commits", () => {
    const add = panel.indexOf("git add -A -- .");
    expect(add).toBeGreaterThan(0);
    for (const check of ["git tag --list 'panel-round-*'", "story snapshot --list --path .", "git ls-files -- .", "git ls-files --others --ignored --exclude-standard -- ."]) {
      const at = panel.indexOf(check);
      expect(at, check).toBeGreaterThanOrEqual(0);
      expect(at, `${check} comes after git add`).toBeLessThan(add);
    }
  });
});

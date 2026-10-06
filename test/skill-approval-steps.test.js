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
// A step is a fenced code block, or a paragraph or list item outside fences
// (a nested list item is its own step). A command mentioned in passing
// (`story remove chapter` with no id) is not an instruction and is skipped.

const skillsDir = path.join(import.meta.dir, "..", "skills");
const FENCE = /^\s*(```|~~~)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const REMOVE = /story\s+remove\s+(?:chapter|scene)\s+[<{a-z]/g;
const TAG = /git\s+tag\s+[<{a-z]/g;

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return markdownFiles(full);
    }
    return entry.name.endsWith(".md") ? [full] : [];
  }).sort();
}

// The steps of a markdown file, each with the line it starts on.
function steps(text) {
  const lines = text.split("\n");
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

const skillSteps = markdownFiles(skillsDir).flatMap((file) => steps(fs.readFileSync(file, "utf8"))
  .map((step) => ({ ...step, where: `${path.relative(skillsDir, file)}:${step.line}` })));

describe("skills guard commands that delete or freeze prose (#543)", () => {
  test("the step parser splits list items and fences", () => {
    const parsed = steps("1. one\n   still one\n2. two\n\n```shell\ngit tag x\n```\n- three\n  1. nested");
    expect(parsed.map((step) => step.line)).toEqual([1, 3, 5, 8, 9]);
    expect(parsed[0].text).toContain("still one");
    expect(parsed[2].text).toBe("git tag x");
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

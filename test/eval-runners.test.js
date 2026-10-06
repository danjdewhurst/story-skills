import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import { main as compareMain } from "../evals/compare-outputs.js";
import { main as runSkillMain, stripPreamble } from "../evals/run-skill.js";
import { checkDraft, loadFixture } from "../evals/run-evals.js";

// Both runners call `claude -p` through an injected spawn, so these tests
// answer for the model and never start a real process.

const repoRoot = path.resolve(import.meta.dir, "..");
const goodDraft = fs.readFileSync(path.join(repoRoot, "evals", "examples", "canon-keeping.md"), "utf8");
const goodChapterFile = fs.readFileSync(path.join(repoRoot, "evals", "examples", "branch-choices.md"), "utf8");

let logs;
let originalLog;
beforeEach(() => {
  logs = [];
  originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
});
afterEach(() => {
  console.log = originalLog;
});
const output = () => logs.join("\n");

const ok = (stdout) => ({ status: 0, stdout, stderr: "" });
const promptOf = (args) => args[args.indexOf("-p") + 1];

// Answers the drafting call with `draft` and the canon check with `judge`,
// recording each call and the system prompt it was given.
function modelStub({ draft = goodDraft, judge = "[]" } = {}) {
  const calls = [];
  const spawn = (command, args) => {
    const systemFile = args[args.indexOf("--system-prompt-file") + 1];
    const call = { command, args, system: fs.readFileSync(systemFile, "utf8"), systemFile };
    calls.push(call);
    const isJudge = promptOf(args).startsWith("You are checking a story draft for invented canon.");
    const reply = isJudge ? judge : draft;
    return typeof reply === "function" ? reply(call) : ok(reply);
  };
  return { spawn, calls };
}

describe("run-skill with a stubbed model", () => {
  test("drafts under the fixture's skill, checks the draft, and saves provenance", () => {
    const out = makeTempDir("story-run-skill-");
    fs.writeFileSync(path.join(out, "canon-keeping.claims.json"), '["stale"]\n');
    const stub = modelStub({ draft: `\`\`\`markdown\n${goodDraft}\n\`\`\`\n` });
    expect(runSkillMain(["--out", out, "canon-keeping"], { spawn: stub.spawn })).toBe(0);

    expect(stub.calls).toHaveLength(2);
    const [draftCall, judgeCall] = stub.calls;
    expect(draftCall.command).toBe("claude");
    expect(draftCall.args).toContain("claude-opus-5");
    expect(draftCall.system).toContain("You are running a story-skills chapter-writing workflow.");
    expect(draftCall.system).toContain("<!-- references/writing-guidelines.md -->");
    expect(promptOf(draftCall.args)).toContain("Petra's supply boat calls.");
    expect(promptOf(judgeCall.args)).toContain(goodDraft.trim());
    // The system prompt file is removed once each call is done.
    expect(fs.existsSync(draftCall.systemFile)).toBe(false);

    expect(fs.readFileSync(path.join(out, "canon-keeping.md"), "utf8")).toBe(`${goodDraft.trim()}\n`);
    expect(fs.readFileSync(path.join(out, "canon-keeping.prompt.md"), "utf8")).toBe(promptOf(draftCall.args));
    expect(fs.readFileSync(path.join(out, "canon-keeping.system.sha256"), "utf8")).toMatch(/^[0-9a-f]{64}\n$/);
    expect(fs.readFileSync(path.join(out, "canon-keeping.judge-raw.txt"), "utf8")).toBe("[]");
    expect(JSON.parse(fs.readFileSync(path.join(out, "canon-keeping.claims.json"), "utf8"))).toEqual([]);
    expect(output()).toContain("judge: no invented canon");
    expect(output()).toContain("PASS canon-keeping");
  });

  test("an invented canon claim fails the fixture", () => {
    const out = makeTempDir("story-run-skill-");
    const stub = modelStub({ judge: 'Claims:\n["Petra owns a radio"]' });
    expect(runSkillMain(["--out", out, "--judge-model", "judge-x", "canon-keeping"], { spawn: stub.spawn })).toBe(1);
    expect(stub.calls[1].args).toContain("judge-x");
    expect(output()).toContain("FAIL invented canon (1):\n    - Petra owns a radio");
    expect(output()).toMatch(/FAIL canon-keeping \(checker (\d+)\/\1, invented claims 1\)/);
  });

  test("a judge reply that is not a string array fails the fixture", () => {
    for (const judge of ["No problems found.", "[1, 2]"]) {
      logs.length = 0;
      const out = makeTempDir("story-run-skill-");
      expect(runSkillMain(["--out", out, "canon-keeping"], { spawn: modelStub({ judge }).spawn })).toBe(1);
      expect(output()).toMatch(/FAIL judge: judge (did not return a JSON array|returned a non-string array)/);
      expect(fs.existsSync(path.join(out, "canon-keeping.claims.json"))).toBe(false);
    }
  });

  test("a baseline run uses no skill, skips the judge, and fails checker misses", () => {
    const out = makeTempDir("story-run-skill-");
    const stub = modelStub({ draft: "Sure, here it is:\nDraft:\n## Outline\n- beat\n## Chapter text\nThe ghost of Ana walked." });
    expect(runSkillMain(["--no-skill", "--no-judge", "--model", "m-1", "--out", out, "canon-keeping"], { spawn: stub.spawn })).toBe(1);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].args).toContain("m-1");
    expect(stub.calls[0].system).toStartWith("You are a careful fiction writer.");
    expect(fs.readFileSync(path.join(out, "canon-keeping.md"), "utf8")).toBe("The ghost of Ana walked.\n");
    expect(output()).toContain("model: m-1 (no skill baseline)");
    expect(output()).toContain("skill: (none)");
    expect(output()).toMatch(/FAIL canon-keeping \(checker \d+\/\d+, invented claims 0\)/);
  });

  test("--skill overrides every fixture and rejects an unknown skill", () => {
    const out = makeTempDir("story-run-skill-");
    const stub = modelStub();
    expect(runSkillMain(["--skill", "voice-style", "--no-judge", "--out", out, "canon-keeping"], { spawn: stub.spawn })).toBe(0);
    expect(stub.calls[0].system).toContain("story-skills voice-style workflow");
    expect(() => runSkillMain(["--skill", "no-such-skill", "--out", out, "canon-keeping"], { spawn: stub.spawn })).toThrow(
      'unknown skill "no-such-skill"'
    );
    expect(() => runSkillMain(["--bogus"])).toThrow("unknown flag --bogus");
  });

  test("retries a failed call, then fails the fixture", () => {
    const out = makeTempDir("story-run-skill-");
    const failing = modelStub({ draft: () => ({ status: 1, stdout: "", stderr: "overloaded" }) });
    expect(runSkillMain(["--out", out, "canon-keeping"], { spawn: failing.spawn })).toBe(1);
    expect(failing.calls).toHaveLength(3);
    expect(output()).toContain("WARN claude exited 1 (attempt 3/3)");
    expect(output()).toContain("FAIL draft call: exit 1: overloaded");

    logs.length = 0;
    const erroring = modelStub({ draft: () => ({ error: new Error("timed out") }) });
    expect(runSkillMain(["--out", out, "canon-keeping"], { spawn: erroring.spawn })).toBe(1);
    expect(output()).toContain("WARN claude failed (attempt 1/3): timed out");
    expect(output()).toContain("FAIL draft call: timed out");
  });

  test("a missing claude binary fails without retrying", () => {
    const out = makeTempDir("story-run-skill-");
    const missing = modelStub({ draft: () => ({ error: Object.assign(new Error("spawnSync claude ENOENT"), { code: "ENOENT" }) }) });
    expect(runSkillMain(["--out", out, "canon-keeping"], { spawn: missing.spawn })).toBe(1);
    expect(missing.calls).toHaveLength(1);
    expect(output()).toContain("FAIL draft call: Claude Code CLI (`claude`) not found on PATH.");
  });
});

describe("a fixture's keep option", () => {
  const chapterFile = "---\ntitle: One\nchoices:\n  - text: Go on\n    to: chapter-02\n---\n\n# Chapter 1: One\n\n## Chapter Text\n\nYou go on.\n";

  test("keeps only the chapter text by default and the whole file with keep: file", () => {
    expect(stripPreamble(chapterFile)).toBe("You go on.\n");
    expect(stripPreamble(chapterFile, "chapter-text")).toBe("You go on.\n");
    expect(stripPreamble(`Here is the chapter:\n${chapterFile}`, "file")).toBe(chapterFile);
  });

  test("run-skill asks for the whole file and scores its frontmatter", () => {
    const out = makeTempDir("story-run-skill-");
    const stub = modelStub({ draft: goodChapterFile });
    expect(runSkillMain(["--out", out, "branch-choices"], { spawn: stub.spawn })).toBe(0);
    expect(stub.calls[0].system).toContain("story-skills interactive-fiction workflow");
    expect(stub.calls[0].system).toContain("return only the complete file the brief asks for, frontmatter included");
    expect(stub.calls[0].system).not.toContain("return only the final draft prose");
    // The judge keeps the prose rule: it is not drafting a file.
    expect(stub.calls[1].system).toContain("return only the final draft prose");
    expect(fs.readFileSync(path.join(out, "branch-choices.md"), "utf8")).toBe(goodChapterFile);
    expect(output()).toContain("PASS branch-choices");

    logs.length = 0;
    const baseline = modelStub({ draft: goodChapterFile });
    expect(runSkillMain(["--no-skill", "--no-judge", "--out", out, "branch-choices"], { spawn: baseline.spawn })).toBe(0);
    expect(baseline.calls[0].system).toContain("frontmatter included");
  });

  test("branch-choices passes quoted YAML and fails lazy or malformed chapter files", () => {
    const { checks, inputText } = loadFixture(path.join(repoRoot, "evals", "fixtures", "branch-choices"));
    const failed = (draft) => checkDraft(checks, inputText, draft).filter(([ok]) => !ok).map(([, desc]) => desc);
    const [titleRe, toFiveRe, toSixRe] = checks.required_regex.map((pattern) => `canon kept: /${pattern}/`);
    expect(failed(goodChapterFile)).toEqual([]);
    expect(failed(goodChapterFile.replace("title: The Storm", "title: 'The Storm'").replace("to: chapter-05", 'to: "chapter-05"'))).toEqual([]);

    const lazy = goodChapterFile
      .replace("text: Ring the storm bell", 'text: "[[Ring the storm bell->chapter-05]]"')
      .replace("to: chapter-06", "to: chapter-04");
    const lazyFailures = failed(lazy);
    expect(lazyFailures).toContain(toSixRe);
    expect(lazyFailures).toContain("trap avoided: /\\[\\[/");
    expect(lazyFailures.some((d) => d.startsWith("trap avoided: /(?:^|\\n)[ \\t-]*text:"))).toBe(true);
    expect(lazyFailures.some((d) => d.startsWith("trap avoided: /(?:^|\\n)[ \\t-]*to:"))).toBe(true);

    expect(failed(goodChapterFile.replace("to: chapter-05", "to: chapter-09"))).toEqual([
      toFiveRe,
      expect.stringMatching(/^trap avoided: .*to:/),
    ]);
    // No frontmatter delimiters, or the second ending outside the choices list.
    expect(failed(goodChapterFile.replace(/^---\n/gm, ""))).toEqual([titleRe, toFiveRe, toSixRe]);
    const outside = goodChapterFile
      .replace("  - text: Keep the lamp burning\n    to: chapter-06\n", "")
      .replace("---\n\n#", "next:\n  to: chapter-06\n---\n\n#");
    expect(failed(outside)).toEqual([toSixRe]);
    // The 150-word cap counts the prose under ## Chapter Text, not the frontmatter.
    const padded = `${goodChapterFile}\n${"The wind keeps on at the glass. ".repeat(10)}\n`;
    expect(failed(padded)).toEqual([expect.stringMatching(/^length of the chapter text 1\d\d words <= 150/)]);
    expect(padded.split(/\s+/).filter(Boolean).length).toBeLessThan(230);

    expect(failed(stripPreamble(goodChapterFile))).toEqual(expect.arrayContaining([titleRe, toFiveRe, toSixRe, 'canon kept: "Chapter Text"']));
  });
});

describe("compare-outputs with a stubbed judge", () => {
  function draftDirs() {
    const dirA = makeTempDir("story-cmp-a-");
    const dirB = makeTempDir("story-cmp-b-");
    for (const name of ["canon-keeping", "anti-slop"]) {
      fs.writeFileSync(path.join(dirA, `${name}.md`), "Draft A.\n");
      fs.writeFileSync(path.join(dirB, `${name}.md`), "Draft B.\n");
    }
    return { dirA, dirB };
  }

  // Votes for whichever draft `prefers` names, wherever it is shown.
  function judge(prefers, calls = []) {
    return (command, args) => {
      calls.push(args);
      const first = promptOf(args).match(/<draft1>\n([\s\S]*?)\n<\/draft1>/)[1];
      if (prefers === "first") return ok("1");
      return ok(first.includes(prefers) ? "Draft 1." : "2");
    };
  }

  test("counts a win only when the same draft wins both orders", () => {
    const { dirA, dirB } = draftDirs();
    const calls = [];
    expect(compareMain(["--model", "judge-m", dirA, dirB, "canon-keeping", "anti-slop"], { spawn: judge("Draft A", calls) })).toBe(0);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toContain("judge-m");
    expect(calls.some((args) => promptOf(args).includes("Brief: Draft the Thursday scene"))).toBe(true);
    expect(output()).toContain("canon-keeping: A wins both orders");
    expect(output()).toContain("A: 2  B: 0  ties: 0");
    expect(output()).toContain('judge raw verdict: "Draft 1."');

    logs.length = 0;
    expect(compareMain([dirA, dirB, "canon-keeping"], { spawn: judge("Draft B") })).toBe(0);
    expect(output()).toContain("canon-keeping: B wins both orders");
    expect(output()).toContain("model: claude-opus-5");

    logs.length = 0;
    expect(compareMain([dirA, dirB, "canon-keeping"], { spawn: judge("first") })).toBe(0);
    expect(output()).toContain("canon-keeping: tie (order split)");
  });

  test("a judge that never gives a verdict fails the comparison", () => {
    const { dirA, dirB } = draftDirs();
    let count = 0;
    const hedging = () => {
      count += 1;
      return ok("Both drafts have merits.");
    };
    expect(compareMain([dirA, dirB, "canon-keeping"], { spawn: hedging })).toBe(1);
    expect(count).toBe(6);
    expect(output()).toContain("WARN judge gave no verdict (attempt 3/3)");
    expect(output()).toContain("canon-keeping: FAIL (judge gave no verdict)");
  });

  test("retries a failed judge call and stops at a missing binary", () => {
    const { dirA, dirB } = draftDirs();
    const failing = () => ({ status: 1, stdout: "", stderr: "boom" });
    expect(compareMain([dirA, dirB, "canon-keeping"], { spawn: failing })).toBe(1);
    expect(output()).toContain("WARN judge failed (attempt 3/3)");

    logs.length = 0;
    let calls = 0;
    const missing = () => {
      calls += 1;
      return { error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) };
    };
    expect(compareMain([dirA, dirB, "canon-keeping"], { spawn: missing })).toBe(1);
    expect(calls).toBe(2);
    expect(output()).toContain("FAIL judge: `claude` not found on PATH.");
  });
});

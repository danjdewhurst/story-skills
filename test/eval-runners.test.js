import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import { main as compareMain } from "../evals/compare-outputs.js";
import { MAX_REFERENCE_CHARS, main as runSkillMain, skillReferences, stripPreamble, unwrapFence } from "../evals/run-skill.js";
import { characterCount, checkDraft, loadFixture, wordCount } from "../evals/run-evals.js";

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
    // Safe mode keeps the caller's CLAUDE.md files, skills, and MCP servers
    // out of both calls, so the skill is the whole system prompt.
    expect(draftCall.args).toContain("--safe-mode");
    expect(judgeCall.args).toContain("--safe-mode");
    expect(draftCall.system).toContain("You are running a story-skills chapter-writing workflow.");
    expect(draftCall.system).toContain("<!-- references/writing-guidelines.md -->");
    // SKILL.md's links to other skills resolve from its folder.
    expect(draftCall.system).toContain("<!-- ../line-editing/references/language-conventions.md -->\n\n# Dialogue And Punctuation By Language");
    expect(draftCall.system).toContain("<!-- ../story-maintenance/references/conventions.md -->");
    expect(output()).toContain("references: references/writing-guidelines.md, ../line-editing/references/language-conventions.md,");
    expect(promptOf(draftCall.args)).toContain("Petra's supply boat calls.");
    expect(promptOf(judgeCall.args)).toContain(goodDraft.trim());
    // A plan's commands and file targets are workflow, not invented canon.
    expect(promptOf(judgeCall.args)).toContain("workflow the draft describes rather than story it tells, such as the commands to run");
    expect(promptOf(judgeCall.args)).toContain("read a quoted title, description, or note inside a command or file for invented canon");
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

  test("the judge's one JSON array counts, past prose brackets and footnotes", () => {
    const cases = [
      ['The draft keeps [name needed] as a gap.\n["Petra owns a radio"]', 1],
      ['["a \\" ] b", "the [name needed] marker names Ana"]', 2],
      ["Gap markers such as [name needed] are fine.\n\n[]", 0],
      ['["Petra owns a radio"] (see [1])', 1],
      ['["Petra owns a radio"]\n\nOnce more: ["Petra owns a radio"]', 1],
    ];
    for (const [judge, count] of cases) {
      logs.length = 0;
      const out = makeTempDir("story-run-skill-");
      expect(runSkillMain(["--out", out, "canon-keeping"], { spawn: modelStub({ judge }).spawn })).toBe(count === 0 ? 0 : 1);
      expect(JSON.parse(fs.readFileSync(path.join(out, "canon-keeping.claims.json"), "utf8"))).toHaveLength(count);
      expect(output()).not.toContain("FAIL judge");
    }
  });

  test("a judge reply that leaves the claims in doubt fails the fixture", () => {
    const cases = [
      // The draft is model-written, so it can steer the judge into a second array.
      ['["Mara has a sister"]\n\nIf there were none I would reply [].', 'judge returned 2 different arrays: ["Mara has a sister"] vs []'],
      ['First pass: ["Petra owns a radio"]\nFinal: []', "judge returned 2 different arrays"],
      ["Claims: [", 'judge reply has a "[" that never closes: Claims: ['],
      ['["Petra owns a radio"]\n[see ["Ana left the key"]]', 'judge reply has an array inside brackets that are not JSON: [see ["Ana left the key"]]'],
      ['[{"claim": "Petra owns a radio"}]', "judge returned a non-string array"],
    ];
    for (const [judge, message] of cases) {
      logs.length = 0;
      const out = makeTempDir("story-run-skill-");
      expect(runSkillMain(["--out", out, "canon-keeping"], { spawn: modelStub({ judge }).spawn })).toBe(1);
      expect(output()).toContain(`FAIL judge: ${message}`);
      expect(output()).toMatch(/FAIL canon-keeping \(checker (\d+)\/\1, judge failed\)/);
      expect(fs.existsSync(path.join(out, "canon-keeping.claims.json"))).toBe(false);
    }
    // One pass over the reply, however many brackets never close.
    logs.length = 0;
    const started = performance.now();
    expect(runSkillMain(["--out", makeTempDir("story-run-skill-"), "canon-keeping"], { spawn: modelStub({ judge: "[ ".repeat(40_000) }).spawn })).toBe(1);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(output()).toContain('FAIL judge: judge reply has a "[" that never closes');
  });

  test("a failed draft or judge call stays in the summary and fails the run", () => {
    const out = makeTempDir("story-run-skill-");
    const goodLamp = fs.readFileSync(path.join(repoRoot, "evals", "examples", "no-invention.md"), "utf8");
    const failed = { status: 1, stdout: "", stderr: "overloaded" };
    const { spawn } = modelStub({
      // anti-slop's draft call fails; canon-keeping and no-invention draft.
      draft: (call) => {
        const brief = promptOf(call.args);
        if (brief.startsWith("Rewrite this draft")) return failed;
        return ok(brief.startsWith("Describe the lamp room") ? goodLamp : goodDraft);
      },
      // The judge fails on no-invention's draft only.
      judge: (call) => (promptOf(call.args).includes(`<draft>\n${goodLamp.trim()}`) ? failed : ok("[]")),
    });
    expect(runSkillMain(["--out", out, "anti-slop", "canon-keeping", "no-invention"], { spawn })).toBe(1);
    const summary = output().slice(output().lastIndexOf("model: claude-opus-5\n"));
    expect(summary).toContain("  FAIL anti-slop (draft call failed)");
    expect(summary).toMatch(/ {2}PASS canon-keeping \(checker (\d+)\/\1, invented claims 0\)/);
    expect(summary).toMatch(/ {2}FAIL no-invention \(checker (\d+)\/\1, judge failed\)/);
    expect(summary).toEndWith("1 of 3 fixtures passed");
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

describe("the reference files a skill loads", () => {
  // Writes `files` (path from the skills folder -> text) into a skills
  // folder inside a fresh temp folder, and returns the skills folder.
  function skillsTree(files) {
    const dir = path.join(makeTempDir("story-skills-tree-"), "skills");
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    return dir;
  }

  test("follows the links SKILL.md names, then theirs, breadth-first, under the cap", () => {
    const skillsDir = skillsTree({
      "a/SKILL.md": [
        "Read `references/big.md` first, then [the template](../b/references/template.md#fields).",
        "Write `chapters/chapter-{NN}.md`, never `../b/SKILL.md`, `../../outside.md`, `references/linked.md`,",
        "`references/out/secret.md`, or `references/missing.md`.",
        "See `references/big.md` again, `references/small.md`, and `b/references/other.md`.",
      ].join("\n"),
      "a/references/big.md": `${"x".repeat(80)} names \`deep.md\` and \`../../c/references/far.md\``,
      // `references/huge.md` here means the skill folder's references.
      "a/references/small.md": "small, names `../../b/references/template.md` and `references/huge.md`",
      "a/references/deep.md": "deep",
      "a/references/huge.md": `${"h".repeat(200)} names \`beyond.md\` and \`deep.md\``,
      "a/references/beyond.md": "beyond",
      "a/references/unnamed.md": "never named",
      "b/SKILL.md": "another skill",
      "b/references/template.md": "**Where:** {label}",
      "b/references/other.md": "other",
      "c/references/far.md": "far, names `../../a/references/huge.md`",
    });
    // Outside the skills folder, reached by name and through symlinks.
    const outside = path.dirname(skillsDir);
    fs.writeFileSync(path.join(outside, "outside.md"), "outside");
    fs.mkdirSync(path.join(outside, "out"));
    fs.writeFileSync(path.join(outside, "out", "secret.md"), "secret");
    fs.symlinkSync(path.join(outside, "outside.md"), path.join(skillsDir, "a", "references", "linked.md"));
    fs.symlinkSync(path.join(outside, "out"), path.join(skillsDir, "a", "references", "out"), "dir");

    const skillDir = path.join(skillsDir, "a");
    const size = (rel) => fs.readFileSync(path.join(skillsDir, rel), "utf8").length;
    const direct = ["a/references/big.md", "b/references/template.md", "a/references/small.md", "b/references/other.md"]
      .reduce((n, rel) => n + size(rel), 0);

    // Room for deep.md and far.md but not huge.md, which small.md names next.
    const refs = skillReferences(skillDir, { skillsDir, cap: direct + size("a/references/deep.md") + size("c/references/far.md") });
    const labels = refs.loaded.map((r) => r.label);
    expect(labels).toEqual([
      "references/big.md",
      "../b/references/template.md",
      "references/small.md",
      "../b/references/other.md",
      "references/deep.md",
      "../c/references/far.md",
    ]);
    expect(refs.loaded[1].text).toBe("**Where:** {label}");
    // beyond.md is named only by the left-out huge.md, so it is left out too;
    // deep.md, which huge.md also names, stays loaded.
    expect(refs.leftOut).toEqual(["references/huge.md", "references/beyond.md"]);
    expect(refs.chars).toBe(refs.loaded.reduce((n, r) => n + r.text.length, 0));
    // A file nothing names never loads, nor does a file outside the skills
    // folder, by name or through a symlink.
    expect(labels).not.toContain("references/unnamed.md");
    expect(refs.loaded.map((r) => r.text).join("\n")).not.toMatch(/outside|secret|another skill/);
    // Reference-like names that point to no file are reported; project paths are not.
    expect(refs.unresolved).toEqual([
      "references/linked.md (in SKILL.md)",
      "references/out/secret.md (in SKILL.md)",
      "references/missing.md (in SKILL.md)",
    ]);

    // The files SKILL.md names load whatever their size; the rest wait for room.
    const tight = skillReferences(skillDir, { skillsDir, cap: 10 });
    expect(tight.loaded.map((r) => r.label)).toEqual(["references/big.md", "../b/references/template.md", "references/small.md", "../b/references/other.md"]);
    expect(tight.leftOut).toEqual(["references/deep.md", "../c/references/far.md", "references/huge.md", "references/beyond.md"]);
    const all = skillReferences(skillDir, { skillsDir });
    expect(all.leftOut).toEqual([]);
    expect(all.loaded.map((r) => r.label)).toContain("references/beyond.md");
    expect(MAX_REFERENCE_CHARS).toBe(48_000);
  });

  test("an unclosed code span full of anchors does not slow the scan", () => {
    const skillsDir = skillsTree({ "a/SKILL.md": `\`${"a.md#".repeat(50_000)}` });
    const started = performance.now();
    expect(skillReferences(path.join(skillsDir, "a"), { skillsDir }).loaded).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("every reference file is reachable from its SKILL.md", () => {
    const skillsDir = path.join(repoRoot, "skills");
    for (const skill of fs.readdirSync(skillsDir)) {
      const refsDir = path.join(skillsDir, skill, "references");
      if (!fs.existsSync(path.join(skillsDir, skill, "SKILL.md")) || !fs.existsSync(refsDir)) continue;
      const labels = new Set(skillReferences(path.join(skillsDir, skill), { cap: Infinity }).loaded.map((r) => r.label));
      const unreached = fs.readdirSync(refsDir).filter((name) => name.endsWith(".md") && !labels.has(`references/${name}`));
      expect(unreached, `${skill}: no link or code path from SKILL.md reaches these`).toEqual([]);
    }
  });

  test("the reader-panel fixture sees the feedback template its banned_regex checks", () => {
    const out = makeTempDir("story-run-skill-");
    const example = fs.readFileSync(path.join(repoRoot, "evals", "examples", "reader-panel.md"), "utf8");
    const stub = modelStub({ draft: example });
    expect(runSkillMain(["--out", out, "reader-panel"], { spawn: stub.spawn })).toBe(0);
    const system = stub.calls[0].system;
    expect(system).toContain("<!-- references/line-editor.md -->");
    expect(system).toContain("<!-- ../feedback-triage/references/feedback-template.md -->");
    expect(system).toContain("- **Where:** {paragraph label in the current build");
    // feedback-triage's synthesis template sits beside the feedback template,
    // but nothing reader-panel loads names it.
    expect(system).not.toContain("synthesis-template.md");
    expect(system).not.toMatch(/<!-- [^\n]*SKILL\.md -->/);
    const skillText = fs.readFileSync(path.join(repoRoot, "skills", "reader-panel", "SKILL.md"), "utf8");
    expect(system.split(skillText)).toHaveLength(2);
  });

  test("premise-workshop loads the other skills' references it links to", () => {
    const stub = modelStub({ draft: fs.readFileSync(path.join(repoRoot, "evals", "examples", "premise-logline.md"), "utf8") });
    expect(runSkillMain(["--no-judge", "--out", makeTempDir("story-run-skill-"), "premise-logline"], { spawn: stub.spawn })).toBe(0);
    // Its links reach past the cap, and the log names what was left out.
    expect(output()).toMatch(/left out over the 48000-character cap: [^\n]*\.\.\/revision-continuity\/references\/pass-checklists\.md/);
    expect(stub.calls[0].system).not.toContain("<!-- ../revision-continuity/references/pass-checklists.md -->");
    expect(stub.calls[0].system).toContain("<!-- ../story-init/references/title-logline.md -->\n\n# Title & Logline");
    expect(stub.calls[0].system).toContain("<!-- ../theme-craft/references/controlling-idea.md -->\n\n# The Controlling Idea");
  });
});

describe("unwrapping a fenced reply", () => {
  const prose = "The boat came in at six.\n\nTomas said nothing.";
  const chapterFile = "---\ntitle: One\n---\n\n# Chapter 1: One\n\n## Chapter Text\n\nYou go on.\n";

  test("strips one outer fence after a lead-in line, with any info string or fence character", () => {
    expect(stripPreamble(`Here's the draft:\n\`\`\`markdown\n${prose}\n\`\`\``)).toBe(`${prose}\n`);
    expect(stripPreamble(`Sure, here you go.\nHere's the draft:\n\n\`\`\`\n${prose}\n\`\`\`\n`)).toBe(`${prose}\n`);
    expect(stripPreamble(`The revised scene:\n~~~~ prose\n${prose}\n~~~~`)).toBe(`${prose}\n`);
    expect(stripPreamble(`\`\`\`text\n${prose}\n\`\`\``)).toBe(`${prose}\n`);
    // A short sign-off after the fence goes too; an unclosed fence runs to the end.
    expect(stripPreamble(`Draft:\n\`\`\`md\n${prose}\n\`\`\`\nLet me know if you want changes.`)).toBe(`${prose}\n`);
    expect(stripPreamble(`Here it is:\n\`\`\`\n${prose}`)).toBe(`${prose}\n`);
  });

  test("unwraps a whole-file reply without mistaking frontmatter for a fence or lead-in", () => {
    expect(stripPreamble(`Here is the chapter file:\n\`\`\`markdown\n${chapterFile}\`\`\``, "file")).toBe(chapterFile);
    expect(stripPreamble(`\`\`\`markdown\n${chapterFile}\`\`\``, "chapter-text")).toBe("You go on.\n");
    // A fence inside a bare file is draft, so the frontmatter above it stays.
    const withCode = `${chapterFile}\n\`\`\`\nA note in the margin\n\`\`\`\n`;
    expect(stripPreamble(withCode, "file")).toBe(withCode);
  });

  test("keeps fences inside the draft", () => {
    const inner = `${prose}\n\n\`\`\`text\nTHE KEY IS UNDER THE STONE\n\`\`\`\n\nHe burned it.`;
    expect(stripPreamble(`Here's the draft:\n\`\`\`markdown\n${inner}\n\`\`\``)).toBe(`${inner}\n`);
    const shorter = `${prose}\n\n\`\`\`\nnote\n\`\`\``;
    expect(stripPreamble(`Here's the draft:\n\`\`\`\`\n${shorter}\n\`\`\`\``)).toBe(`${shorter}\n`);
    const tilde = `${prose}\n\n~~~\nnote\n~~~`;
    expect(stripPreamble(`\`\`\`markdown\n${tilde}\n\`\`\``)).toBe(`${tilde}\n`);
  });

  test("leaves several blocks, or content around a block, alone", () => {
    const two = "Here are two takes:\n```\nFirst take.\n```\n\n```\nSecond take.\n```";
    expect(unwrapFence(two)).toBe(two);
    const stray = "Here's the draft:\n```\nFirst take.\n```\n```";
    expect(unwrapFence(stray)).toBe(stray);
    const after = `Here's the draft:\n\`\`\`\n${prose}\n\`\`\`\n\nHe went back to the boat.\n\nPetra waited.`;
    expect(unwrapFence(after)).toBe(after);
    const listAfter = `Here's the draft:\n\`\`\`\n${prose}\n\`\`\`\n- changed the ending`;
    expect(unwrapFence(listAfter)).toBe(listAfter);
    // One line of prose after the fence may be the draft's last sentence.
    const lastLine = `Here's the draft:\n\`\`\`\n${prose}\n\`\`\`\nThe key stayed in his pocket.`;
    expect(unwrapFence(lastLine)).toBe(lastLine);
    expect(unwrapFence(`Here's the draft:\n\`\`\`\n${prose}\n\`\`\`\nI hope this works for the chapter.`)).toBe(prose);
    const longLeadIn = `One.\nTwo.\nThree:\n\`\`\`\n${prose}\n\`\`\``;
    expect(unwrapFence(longLeadIn)).toBe(longLeadIn);
    const noColon = `He read the note aloud.\n\`\`\`\n${prose}\n\`\`\``;
    expect(unwrapFence(noColon)).toBe(noColon);
    const heading = `## Notes:\n\`\`\`\n${prose}\n\`\`\``;
    expect(unwrapFence(heading)).toBe(heading);
    // A backtick fence's info string cannot hold a backtick, so this is prose.
    expect(stripPreamble("```not `a` fence\nprose")).toBe("```not `a` fence\nprose\n");
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
    expect(stub.calls[0].system).toContain("return only what the brief asks for, in the form it asks for, frontmatter included");
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

  test("every fixture whose brief asks for a file or frontmatter gets the file rule and passes its example", () => {
    const fileFixtures = ["character-progression", "copyright-page", "genre-craft-mystery", "init-project", "location-routes", "reader-panel", "research-note", "revision-continuity", "series-continuity", "style-sheet", "triage-synthesis"];
    for (const name of fileFixtures) {
      logs.length = 0;
      const example = fs.readFileSync(path.join(repoRoot, "evals", "examples", `${name}.md`), "utf8");
      const stub = modelStub({ draft: `Here is the file:\n\`\`\`markdown\n${example}\`\`\`\n` });
      expect(runSkillMain(["--no-judge", "--out", makeTempDir("story-run-skill-"), name], { spawn: stub.spawn })).toBe(0);
      expect(stub.calls[0].system).toContain("return only what the brief asks for, in the form it asks for, frontmatter included");
      expect(stub.calls[0].system).not.toContain("return only the final draft prose");
      expect(output()).toContain(`PASS ${name}`);
    }
  });

  test("branch-choices passes quoted YAML and fails lazy or malformed chapter files", () => {
    const { checks, inputText } = loadFixture(path.join(repoRoot, "evals", "fixtures", "branch-choices"));
    const failed = (draft) => checkDraft(checks, inputText, draft).filter(([ok]) => !ok).map(([, desc]) => desc);
    const [titleRe, toFiveRe, toSixRe, endsOnChoiceRe] = checks.required_regex.map((pattern) => `canon kept: /${pattern}/`);
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
    expect(failed(padded)).toEqual([endsOnChoiceRe, expect.stringMatching(/^length of the chapter text 1\d\d words <= 150/)]);
    // The prose ends on the choice: "choose" in its last line, or a question
    // about the bell or the lamp, quoted or in emphasis or not.
    const ending = (text) => failed(goodChapterFile.replace("You have to choose.", text));
    expect(ending("Do you ring the bell, or keep the lamp burning?")).toEqual([]);
    expect(ending('"The bell, or the lamp?"')).toEqual([]);
    expect(ending("*The bell, or the lamp?*")).toEqual([]);
    expect(ending("You stand at the glass.")).toEqual([endsOnChoiceRe]);
    // A last question that is not about the choice does not count.
    expect(ending("You stand at the glass.\n\nWhat now?")).toEqual([endsOnChoiceRe]);
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
    expect(calls[0]).toContain("--safe-mode");
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

describe("the checker's prose checks", () => {
  test("read an inline command as one word, so its own spacing is not the draft's", () => {
    const badlyFormed = (draft) =>
      checkDraft({}, "", draft)
        .filter(([ok, desc]) => !ok && desc.startsWith("well formed"))
        .map(([, desc]) => desc);
    expect(badlyFormed("Then run `story reindex .`, `story wordcount . --write`, and `story check .`.\n")).toEqual([]);
    expect(badlyFormed("Then run story reindex . and rest.\n")).toEqual(["well formed: no space before punctuation"]);
    // Other inline code is still read as prose.
    expect(badlyFormed("He wrote `the end , at last` on the slate.\n")).toEqual(["well formed: no space before punctuation"]);
    // Phrase checks still read the code.
    expect(checkDraft({ required: ["story reindex"] }, "", "Run `story reindex .` now.\n")[0]).toEqual([true, 'canon kept: "story reindex"']);
  });

  test("a scope reads only its part of the reply, and fails every check when the part is missing", () => {
    const checks = {
      chapter_text: { banned: ["a week"], requires_first_person: true },
      chapter_frontmatter: { required_regex: ["(?:^|\\n)status: revised"] },
    };
    const reply = "Plan: fix \"a week\".\n\n```markdown\n---\nstatus: revised\n---\n\n# Chapter 3\n\n## Outline\n\n---\n\n## Chapter Text\n\nI waited.\n```\n\nI changed \"a week\" to three days.\n";
    const results = (draft) => checkDraft(checks, "", draft).filter(([, desc]) => /^chapter (?:text|frontmatter):/.test(desc));
    expect(results(reply)).toEqual([
      [true, 'chapter text: trap avoided: "a week"'],
      [true, "chapter text: first-person narration present"],
      [true, "chapter frontmatter: canon kept: /(?:^|\\n)status: revised/"],
    ]);
    // The chapter text ends at the fence that closes its block; with no fence
    // it runs on to the end, and the rule above the heading opens no block.
    expect(results(reply.replace("\n```\n\nI changed", "\nI changed"))[0]).toEqual([false, 'chapter text: trap avoided: "a week"']);
    expect(results("No chapter here.\n")).toEqual([
      [false, 'chapter text: trap avoided: "a week" (no chapter text in the draft)'],
      [false, "chapter text: first-person narration present (no chapter text in the draft)"],
      [false, "chapter frontmatter: canon kept: /(?:^|\\n)status: revised/ (no chapter frontmatter in the draft)"],
    ]);
  });

  test("the top-level first-person check reads narration, so dialogue alone does not count", () => {
    const firstPerson = (draft) =>
      checkDraft({ requires_first_person: true }, "", draft).find(([, desc]) => desc === "structure: first-person voice present");
    expect(firstPerson('"I can wait," he said. Petra walked on.\n')).toEqual([false, "structure: first-person voice present"]);
    expect(firstPerson('"I can wait," he said. I walked on.\n')).toEqual([true, "structure: first-person voice present"]);
  });

  test("dialogue in each quote style and in a dash line is not first-person narration", () => {
    const firstPerson = (draft) =>
      checkDraft({ requires_first_person: true }, "", draft).find(([, desc]) => desc === "structure: first-person voice present")[0];
    for (const speech of ['"I can wait," he said.', "“I can wait,” he said.", "'I can wait,' he said.", "‘I can wait,’ he said.", "—I can wait, he said."]) {
      expect([speech, firstPerson(`${speech} Petra walked on.\n`)]).toEqual([speech, false]);
    }
    // Narration after a closed quote still counts.
    expect(firstPerson('“I can wait,” he said. I walked on.\n')).toBe(true);
  });

  test("a dash line, or a quote left open across paragraphs, is dialogue for the past-tense checks", () => {
    const top = (draft) =>
      checkDraft({ requires_past_tense: true }, "", draft).find(([, desc]) => desc.startsWith("structure: past-tense voice present"));
    const chapter = (text) =>
      checkDraft({ chapter_text: { requires_past_tense: true } }, "", `## Chapter Text\n\n${text}\n`).find(([, desc]) =>
        desc.startsWith("chapter text: past-tense narration")
      );
    const dashLine = "Petra turned to the chest. The key was gone.\n—I take the key from you, Tomas, she said. Tomas said nothing and sat down.\n";
    const longSpeech = "Petra turned to the chest. The key was gone.\n\n“I take the key from you, Tomas.\n\nHe said nothing and sat down. It was late.”\n";
    expect(top(dashLine)[0]).toBe(true);
    expect(top(longSpeech)[0]).toBe(true);
    expect(chapter(longSpeech)[0]).toBe(true);
    // A closing quote opens no speech, so the narration after it still counts.
    expect(top('She said nothing." I take the lamp. Petra said it was late.\n')).toEqual([
      false,
      'structure: past-tense voice present (3 marker(s), need 2; present tense: "I take")',
    ]);
  });

  test("the top-level past-tense check fails first-person present-tense action, as the chapter check does", () => {
    const pastTense = (draft) =>
      checkDraft({ requires_past_tense: true }, "", draft).find(([, desc]) => desc.startsWith("structure: past-tense voice present"));
    expect(pastTense("I take the key and I kneel by the chest. Petra said it was late.\n")).toEqual([
      false,
      'structure: past-tense voice present (2 marker(s), need 2; present tense: "I take")',
    ]);
    expect(pastTense("I took the key and knelt by the chest. Petra said it was late.\n")[0]).toBe(true);
    // A present-tense line of dialogue is not narration.
    expect(pastTense('Petra said, "I take it." She was late.\n')[0]).toBe(true);
  });

  test("the chapter past-tense check fails first-person present-tense wait and pull", () => {
    const narration = (text) =>
      checkDraft({ chapter_text: { requires_past_tense: true } }, "", `## Chapter Text\n\n${text}\n`).find(([, desc]) =>
        desc.startsWith("chapter text: past-tense narration")
      );
    expect(narration("I wait by the door and I pull the lever. Petra said it was late.")).toEqual([
      false,
      'chapter text: past-tense narration (2 marker(s), need 2; present tense: "I wait")',
    ]);
    expect(narration("I waited by the door and I pulled the lever. Petra said it was late.")[0]).toBe(true);
  });

  test("a misspelled top-level field fails the draft instead of being ignored", () => {
    const results = checkDraft({ required: ["Petra"], banned_regx: ["Thursday"] }, "", "Petra came on Thursday.\n");
    expect(results).toContainEqual([false, 'checks.json: unknown key "banned_regx"']);
  });

  test("required_in_order finds each pattern after the one before", () => {
    const checks = { required_in_order: [["story passes", "story reindex", "story check"]] };
    const ok = (draft) => checkDraft(checks, "", draft)[0][0];
    expect(ok("story passes\nstory reindex\nstory check\n")).toBe(true);
    expect(ok("story reindex\nstory passes\nstory check\n")).toBe(false);
    expect(ok("story passes\nstory reindex\n")).toBe(false);
  });

  test("every fixture's checks stay fast on long, repetitive drafts", () => {
    const fragment =
      'story passes . --start continuity story reindex . story wordcount . --write story add clue "key hour" --planted chapter-01 ' +
      "--characters tomas-reyes, --red-herring it was a who opened the inside the a week I took the bell lamp choose ? “ « ' \" " +
      "status: revised answers who learned-in: since: object-state: knowledge-state: fact: romance 1. no ";
    const reps = Math.ceil(100_000 / fragment.length);
    const drafts = [
      `## Chapter Text\n${fragment.repeat(reps)}`,
      `## Chapter Text\n${`${fragment}\n`.repeat(reps)}`,
      `${"---\nstatus: revised\nnumber: 3\n".repeat(reps * 4)}## Chapter Text\nI took it.`,
      "object-state:\n  - x: y\nknowledge-state:\n  - fact: z\n---\n".repeat(reps * 3),
      `## Chapter Text\n${" 'a “b «c \"d ".repeat(reps * 6)}`,
      `1. ${"no word ".repeat(50)}romance\n`.repeat(reps),
    ];
    const fixturesDir = path.join(repoRoot, "evals", "fixtures");
    for (const name of fs.readdirSync(fixturesDir)) {
      const { checks, inputText } = loadFixture(path.join(fixturesDir, name));
      for (const draft of drafts) {
        const started = performance.now();
        checkDraft(checks, inputText, draft);
        expect(performance.now() - started).toBeLessThan(2000);
      }
    }
  });
});

// What a model with no skill loaded wrote for these briefs: the passage or
// notes right, the skill's own steps missing or wrong.
const example = (name) => fs.readFileSync(path.join(repoRoot, "evals", "examples", `${name}.md`), "utf8");
const noSkillDrafts = {
  "revision-continuity": () =>
    example("revision-continuity")
      .replace("story passes . --start continuity\n", "")
      .replace("story reindex .\nstory wordcount . --write\nstory check .\n", "story check continuity chapters/chapter-03.md\n")
      .replace("status: revised", "status: draft"),
  "series-continuity": () =>
    example("series-continuity")
      .replace("current-chapter: 0", "current-chapter: 12")
      .replace("    fact: key-on-the-door\n", "    fact: key-on-the-door\n    learned-in: the-key-on-the-door/chapter-01\n")
      .replace("    status: active\n  - artifact: anas-sea-chest", "    status: active\n    since: chapter-01\n  - artifact: anas-sea-chest"),
  "genre-craft-mystery": () => example("genre-craft-mystery").replace(/```shell[\s\S]*?```\n\n/, ""),
};

describe("skill-specific checks", () => {
  const fixture = (name) => loadFixture(path.join(repoRoot, "evals", "fixtures", name));
  const failed = (name, draft) => {
    const { checks, inputText } = fixture(name);
    return checkDraft(checks, inputText, draft).filter(([ok]) => !ok).map(([, desc]) => desc);
  };
  // Swaps `from` for `to` in a fixture's example, failing if `from` is absent.
  const edit = (name, ...pairs) =>
    pairs.reduce((draft, [from, to]) => {
      expect(draft).toContain(from);
      return draft.replace(from, to);
    }, example(name));

  test("revision-continuity needs the pass started first, the chapter marked revised, and the maintenance block", () => {
    const name = "revision-continuity";
    const { checks } = fixture(name);
    const [maintenance, beforeEdit] = checks.required_in_order.map((seq) => `in order: ${seq.map((p) => `/${p}/`).join(", then ")}`);
    const revised = `chapter frontmatter: canon kept: /${checks.chapter_frontmatter.required_regex[1]}/`;
    expect(failed(name, example(name))).toEqual([]);
    expect(failed(name, noSkillDrafts[name]())).toEqual([maintenance, beforeEdit, revised]);

    // `status: revised` counts only in the chapter's own frontmatter.
    expect(failed(name, edit(name, ["status: revised", "status: draft"], ["Plan:", "status: revised\n\nPlan:"]))).toEqual([revised]);
    expect(failed(name, edit(name, ["---\ntitle: Three Days", "title: Three Days"]))).toEqual(
      expect.arrayContaining([`${revised} (no chapter frontmatter in the draft)`])
    );
    // The pass starts before the maintenance and before the edit.
    expect(failed(name, edit(name, ["story passes . --start continuity\n", ""], ["story check .\n", "story check .\nstory passes . --start continuity\n"]))).toEqual([maintenance]);
    expect(failed(name, edit(name, ["story passes . --start continuity", "story passes --start=continuity --path ."]))).toEqual([]);
  });

  test("revision-continuity's chapter text keeps the person, tense, and three days, and opens nothing", () => {
    const name = "revision-continuity";
    const { checks } = fixture(name);
    const trap = (start) => `chapter text: trap avoided: /${checks.chapter_text.banned_regex.find((p) => p.startsWith(start))}/`;
    const opened = trap("(?<!");
    const duration = trap("\\b(?:(?:a|one|two");
    const prose = (from, to) => edit(name, [from, to]);

    // First person and past tense are read from the narration, not the dialogue.
    const thirdPerson = edit(
      name,
      ["I took the brass key from my pocket and weighed it in my palm.", 'He took the brass key from his pocket. "I can wait," he said.'],
      ["Three days I had carried it", "Three days he had carried it"],
      ["I knelt by the chest and kept my hands on my knees.", "He knelt by the chest."],
      ["knows I found it", "knows he found it"]
    );
    expect(failed(name, thirdPerson)).toEqual(["chapter text: first-person narration present"]);
    const presentTense = edit(
      name,
      ["I took the brass key from my pocket and weighed it in my palm.", "I take the brass key from my pocket and weigh it in my palm."],
      ["I knelt by the chest", "I kneel by the chest"]
    );
    expect(failed(name, presentTense)).toEqual([expect.stringMatching(/^chapter text: past-tense narration \(.*present tense: "I take"\)$/)]);

    expect(failed(name, prose("Three days I had carried it", "Seven days I had carried it"))).toEqual(['chapter text: canon kept: "three days"', duration]);
    expect(failed(name, prose("Let them wait.", "I opened Ana's sea-chest."))).toEqual([opened]);
    expect(failed(name, prose("Let them wait.", "I opened the\nchest."))).toEqual([opened]);
    expect(failed(name, prose("Let them wait.", "I had not opened the chest in four winters."))).toEqual([]);
    expect(failed(name, prose("Let them wait.", "Inside lay her logbook."))).toEqual(expect.arrayContaining([trap("\\binside")]));
    // A closing note after the fenced chapter is not chapter text.
    const fenced = example(name).replace("\n---\ntitle:", "\n```markdown\n---\ntitle:") + '```\n\nChanged "a week" to three days.\n';
    expect(failed(name, fenced)).toEqual([]);
  });

  test("series-continuity needs book two's state at chapter 0, with no chapter of book one carried", () => {
    const name = "series-continuity";
    const { checks } = fixture(name);
    const required = (start) => `canon kept: /${checks.required_regex.find((p) => p.startsWith(start))}/`;
    const trap = (start) => `trap avoided: /${checks.banned_regex.find((p) => p.startsWith(start))}/`;
    expect(failed(name, example(name))).toEqual([]);
    expect(failed(name, noSkillDrafts[name]())).toEqual([
      required("(?:^|\\n)current-chapter"),
      trap("(?:^|\\n)[ \\t-]*learned-in"),
      trap("(?:^|\\n)[ \\t-]*since"),
    ]);

    // The state is a continuity-state frontmatter block with the carried entries.
    expect(failed(name, edit(name, ["type: continuity-state\n", ""]))).toEqual([required("(?:^|\\n)---")]);
    expect(failed(name, edit(name, ["  - artifact: brass-key\n", "  - artifact: brass-lamp\n"]))).toEqual([required("(?:^|\\n)object-state:[ \\t]*\\n(?:[ \\t-][^\\n]*\\n)*?[ \\t]*-?[ \\t]*artifact:[ \\t]*['\"]?brass-key")]);
    const factsOutside = edit(name, ["knowledge-state:\n", "knowledge-state: []\nnotes:\n"]);
    expect(failed(name, factsOutside)).toEqual([
      required("(?:^|\\n)knowledge-state:[ \\t]*\\n(?:[ \\t-][^\\n]*\\n)*?[ \\t]*-?[ \\t]*fact:[ \\t]*['\"]?key-on-the-door"),
      required("(?:^|\\n)knowledge-state:[ \\t]*\\n(?:[ \\t-][^\\n]*\\n)*?[ \\t]*-?[ \\t]*fact:[ \\t]*['\"]?board-wants"),
    ]);

    // A negation counts only right before "opened"; "answers who" is a resolution.
    const note = (line) => example(name).replace("## Series Notes\n\n", `## Series Notes\n\n- ${line}\n`);
    const opened = trap("(?<!\\b(?:not|never)\\s+(?:(?:yet|once|ever|been)\\s+)?|n't");
    const answers = trap("(?<!\\b(?:not|never)\\s+|n't\\s+)\\banswer");
    for (const ok of ["Tomas has never opened the sea-chest.", "Nobody has opened it.", "Tomas hasn't opened the chest.", "No one has ever opened it.", "Book two does not answer it."]) {
      expect(failed(name, note(ok))).toEqual([]);
    }
    for (const bad of ["Nobody knows Tomas opened the sea-chest last winter.", "He couldn't wait and opened the chest.", "No one but Tomas opened it.", "Tomas opened Ana's sea-chest."]) {
      expect(failed(name, note(bad))).toEqual([opened]);
    }
    expect(failed(name, note("Book two answers who left the key: Petra."))).toEqual([answers]);
  });

  test("genre-craft-mystery needs each clue on its own line with its flags and chapters", () => {
    const name = "genre-craft-mystery";
    const { checks } = fixture(name);
    const [key, hour, herring, clues] = checks.required_regex.map((pattern) => `canon kept: /${pattern}/`);
    const invented = `trap avoided: /${checks.banned_regex[0]}/`;
    expect(failed(name, example(name))).toEqual([]);
    expect(failed(name, noSkillDrafts[name]())).toEqual([key, hour, herring, clues]);

    const keyLine = "'The brass key on the lamp-room door' --planted chapter-01 --payoff chapter-12 --character tomas-reyes";
    const hourLine = "--character tomas-reyes --significance-delayed";
    const herringLine = "--character tomas-reyes --character petra-lindqvist --red-herring";
    // The flags swapped between the hour and the herring.
    expect(failed(name, edit(name, [hourLine, "--character tomas-reyes --red-herring"], [herringLine, "--character tomas-reyes --character petra-lindqvist --significance-delayed"]))).toEqual([hour, herring]);
    expect(failed(name, edit(name, [keyLine, keyLine.replace("chapter-01", "chapter-02")]))).toEqual([key]);
    expect(failed(name, edit(name, [herringLine, "--character tomas-reyes --red-herring"]))).toEqual([herring]);
    const addClue = (line) => edit(name, ["story reindex .", `${line}\nstory reindex .`]);
    expect(failed(name, addClue("story add clue 'A fisherman'\\''s boot print' --planted chapter-02 --character petra-lindqvist"))).toEqual([invented]);
    expect(failed(name, addClue('story add clue "A fisherman\'s boot print" --planted chapter-02'))).toEqual([invented]);
    // A clue the plan names may hold an escaped quote in its title.
    expect(failed(name, addClue("story add clue 'Ana'\\''s shut sea-chest' --status planned"))).toEqual([]);
    // Every valid form of the flags counts.
    expect(failed(name, edit(name, [keyLine, "'The brass key on the lamp-room door' --planted=chapter-01 --payoff=chapter-12 --characters tomas-reyes,petra-lindqvist"]))).toEqual([]);
  });
});

describe("compare-outputs baseline margins", () => {
  const noModel = () => {
    throw new Error("no model call expected");
  };
  function marginDirs(names = Object.keys(noSkillDrafts)) {
    const baseline = makeTempDir("story-cmp-a-");
    const skill = makeTempDir("story-cmp-b-");
    for (const name of names) {
      fs.writeFileSync(path.join(baseline, `${name}.md`), noSkillDrafts[name]());
      fs.writeFileSync(path.join(skill, `${name}.md`), example(name));
    }
    return { baseline, skill };
  }

  test("--no-judge checks each fixture's margin over the baseline with no model call", () => {
    const { baseline, skill } = marginDirs();
    // With no fixture named, only the fixtures that set a margin are compared.
    expect(compareMain(["--no-judge", baseline, skill], { spawn: noModel })).toBe(0);
    expect(output()).toContain("genre-craft-mystery: margin met: B passes 30/30 checks, A 26/30, margin 4, needs 3");
    expect(output()).toContain("revision-continuity: margin met: B passes 32/32 checks, A 29/32, margin 3, needs 2");
    expect(output()).toContain("series-continuity: margin met: B passes 40/40 checks, A 37/40, margin 3, needs 2");
    expect(output()).toContain("margins met: 3 of 3");
    expect(output()).toMatch(/skipped, no baseline_margin: anti-slop, branch-choices, .*, voice-preservation\n/);
    expect(output()).not.toContain("missing draft");
    expect(output()).not.toContain("model:");

    // The margin is directional: dir-b is the skill's run.
    logs.length = 0;
    expect(compareMain(["--no-judge", skill, baseline, "genre-craft-mystery"], { spawn: noModel })).toBe(1);
    expect(output()).toContain("genre-craft-mystery: FAIL margin: B passes 26/30 checks, A 30/30, margin -4, needs 3");
    expect(output()).toContain("margins met: 0 of 1");
  });

  test("a margin is checked beside the judge, and a missed one fails the run", () => {
    const { baseline, skill } = marginDirs(["genre-craft-mystery"]);
    const firstWins = () => ok("1");
    expect(compareMain([baseline, skill, "genre-craft-mystery"], { spawn: firstWins })).toBe(0);
    expect(output()).toContain("genre-craft-mystery: margin met");
    expect(output()).toContain("genre-craft-mystery: tie (order split)");

    logs.length = 0;
    expect(compareMain([skill, baseline, "genre-craft-mystery"], { spawn: firstWins })).toBe(1);
    expect(output()).toContain("genre-craft-mystery: FAIL margin");
    expect(output()).toContain("A: 0  B: 0  ties: 1");
  });

  test("--no-judge names the fixtures it skips, and fails when it compares nothing", () => {
    const { baseline, skill } = marginDirs(["genre-craft-mystery"]);
    fs.writeFileSync(path.join(baseline, "canon-keeping.md"), goodDraft);
    fs.writeFileSync(path.join(skill, "canon-keeping.md"), goodDraft);
    expect(compareMain(["--no-judge", baseline, skill, "canon-keeping", "genre-craft-mystery"], { spawn: noModel })).toBe(0);
    expect(output()).toContain("skipped, no baseline_margin: canon-keeping");
    expect(output()).toContain("margins met: 1 of 1");

    logs.length = 0;
    expect(compareMain(["--no-judge", baseline, skill, "canon-keeping"], { spawn: noModel })).toBe(1);
    expect(output()).toContain("skipped, no baseline_margin: canon-keeping");
    expect(output()).toContain("no selected fixture sets baseline_margin, and --no-judge skips the judge");

    logs.length = 0;
    fs.rmSync(path.join(baseline, "genre-craft-mystery.md"));
    expect(compareMain(["--no-judge", baseline, skill, "genre-craft-mystery"], { spawn: noModel })).toBe(1);
    expect(output()).toContain("genre-craft-mystery: FAIL (missing draft in one directory)");
  });
});

describe("#98 banned-phrase inflection", () => {
  function trapResults(banned, draft) {
    return checkDraft({ banned, required: [] }, "", draft).filter(([, label]) => label.startsWith("trap avoided"));
  }

  test("silent-e and y-to-ies forms are caught", () => {
    expect(trapResults(["delve"], "We kept delving deeper.")).toEqual([[false, 'trap avoided: "delve"']]);
    expect(trapResults(["delve"], "She delved and delves.")).toEqual([[false, 'trap avoided: "delve"']]);
    expect(trapResults(["tapestry"], "Rich tapestries hung there.")).toEqual([[false, 'trap avoided: "tapestry"']]);
    expect(trapResults(["rich tapestry"], "A rich tapestries hall.")).toEqual([[false, 'trap avoided: "rich tapestry"']]);
    expect(trapResults(["key"], "They carved the turkey.")).toEqual([[true, 'trap avoided: "key"']]);
    expect(trapResults(["delve"], "The delft plates.")).toEqual([[true, 'trap avoided: "delve"']]);
  });
});

describe("eval checker in other languages", () => {
  function results(checks, draft, prefix) {
    return checkDraft({ required: [], ...checks }, "", draft).filter(([, label]) => label.startsWith(prefix));
  }

  test("counts each Chinese or Japanese character as a word and other text as before", () => {
    expect(wordCount("The bell was ringing.")).toBe(4);
    expect(wordCount("a — b")).toBe(3);
    expect(wordCount("「来てくれたね」\n\n　大島はうなずいた。")).toBe(14);
    expect(wordCount("霧見駅 Kirimi 3")).toBe(5);
    expect(results({ max_words: 3 }, "「ただいま」", "length")).toEqual([[false, "length 4 words <= 3 (absolute cap)"]]);
  });

  test("a Chinese or Japanese fixture measures length in characters, punctuation included, as story wordcount does", () => {
    expect(characterCount("　「ただいま」\n\nが")).toBe(7);
    expect(results({ language: "ja", max_words: 6 }, "「ただいま」", "length")).toEqual([[true, "length 6 characters <= 6 (absolute cap)"]]);
    expect(results({ language: "zh-Hant", max_words: 5 }, "「你好！」", "length")).toEqual([[true, "length 5 characters <= 5 (absolute cap)"]]);
    expect(results({ language: "ko", max_words: 5 }, "안녕 하세요", "length")).toEqual([[true, "length 2 words <= 5 (absolute cap)"]]);
  });

  test("banned_regex runs in Unicode mode, so \\p{L} boundaries hold next to accented letters", () => {
    const traps = { banned_regex: ["(?<![\\p{L}\\p{M}])(?:the|said)(?![\\p{L}\\p{M}])"] };
    expect(results(traps, "Elle but son thé.", "trap avoided")[0][0]).toBe(true);
    expect(results(traps, "She said nothing.", "trap avoided")[0][0]).toBe(false);
  });

  test("French spacing before ; : ! and ? is well formed only in a French fixture", () => {
    const draft = "« Tu l’as vu faire ? » Il hocha la tête : oui.";
    expect(results({ language: "fr" }, draft, "well formed: no space before")).toEqual([[true, "well formed: no space before a comma or full stop"]]);
    expect(results({ language: "fr-CA" }, "Il partit , seul.", "well formed: no space before")).toEqual([[false, "well formed: no space before a comma or full stop"]]);
    expect(results({}, draft, "well formed: no space before")).toEqual([[false, "well formed: no space before punctuation"]]);
    expect(results({ language: "fy" }, draft, "well formed: no space before")).toEqual([[false, "well formed: no space before punctuation"]]);
  });

  test("phrases keep word boundaries next to accented letters and match unspaced scripts as substrings", () => {
    expect(results({ banned: ["montre"] }, "Cela démontre tout.", "trap avoided")).toEqual([[true, 'trap avoided: "montre"']]);
    expect(results({ banned: ["montre"] }, "Cela de\\u0301montre tout.", "trap avoided")).toEqual([[true, 'trap avoided: "montre"']]);
    expect(results({ banned: ["montre"] }, "Les montres battaient.", "trap avoided")).toEqual([[false, 'trap avoided: "montre"']]);
    expect(results({ banned: ["arrêté"] }, "Ils sont arrêtés.", "trap avoided")).toEqual([[false, 'trap avoided: "arrêté"']]);
    expect(results({ required: ["封筒"] }, "青い封筒が一通。", "canon kept")).toEqual([[true, 'canon kept: "封筒"']]);
    expect(results({ language: "ar", required: ["مخطوطة"] }, "كانت المخطوطة الخضراء هناك.", "canon kept")).toEqual([[true, 'canon kept: "مخطوطة"']]);
  });

  test("#334 phrases in spaced scripts start at a word boundary, whatever the alphabet", () => {
    const trap = (phrase, draft, language) => results({ language, banned: [phrase] }, draft, "trap avoided")[0][0];
    const kept = (phrase, draft, language) => results({ language, required: [phrase] }, draft, "canon kept")[0][0];
    // A phrase may not start inside a word: French with no ASCII letter,
    // Russian, Greek, Devanagari, Hebrew, Persian.
    expect(trap("à", "Il était déjà parti.")).toBe(true);
    expect(trap("à", "Il pensait à elle.")).toBe(false);
    expect(trap("кот", "Пастух гнал скот.")).toBe(true);
    expect(trap("ναι", "Είναι εδώ.")).toBe(true);
    expect(trap("ναι", "Ναι, είπε.")).toBe(false);
    expect(trap("राम", "उसने आराम किया।")).toBe(true);
    expect(trap("राम", "राम घर गया।")).toBe(false);
    expect(trap("שם", "ירד גשם כל הלילה.")).toBe(true);
    expect(trap("در", "بدر آمد.", "fa")).toBe(true);
    // Latin keeps its strict end, with English inflections.
    expect(trap("montre", "Il montrait tout.", "fr")).toBe(true);
    // Any other spaced script may run on at the end, for case endings,
    // plurals, and joined particles.
    expect(kept("кот", "Она видела кота.", "ru")).toBe(true);
    expect(kept("мост", "Он шёл к мосту.", "ru")).toBe(true);
    expect(kept("ספר", "היו שם ספרים.", "he")).toBe(true);
    expect(kept("책", "책을 읽었다.", "ko")).toBe(true);
    expect(kept("کتاب", "کتابی خرید.", "fa")).toBe(true);
  });

  test("#334 Arabic and Hebrew fixtures allow the prefixes those languages join to a word", () => {
    const trap = (phrase, draft, language) => results({ language, banned: [phrase] }, draft, "trap avoided")[0][0];
    const kept = (phrase, draft, language) => results({ language, required: [phrase] }, draft, "canon kept")[0][0];
    // Arabic: conjunction, preposition, and article; ل before ال.
    expect(trap("نادر", "ونادر لم يأت.", "ar")).toBe(false);
    expect(trap("مخطوطة", "أمسكت بالمخطوطة.", "ar")).toBe(false);
    expect(trap("مخطوطة", "قرأت للمخطوطة.", "ar")).toBe(false);
    expect(trap("المخطوطة", "قرأت للمخطوطة.", "ar")).toBe(false);
    expect(trap("المخطوطة", "أمسكت بالمخطوطة.", "ar-EG")).toBe(false);
    expect(trap("علم", "جاء المعلم.", "ar")).toBe(true);
    // The future س only before a verb's own prefix.
    expect(trap("يدخل", "سيدخل غدا.", "ar")).toBe(false);
    expect(trap("حب", "سحب الكرسي.", "ar")).toBe(true);
    expect(trap("عيد", "كان سعيدا.", "ar")).toBe(true);
    // Endings: ة as ت or the plural ات, ى as ا.
    expect(kept("مخطوطة", "فتحت مخطوطتها.", "ar")).toBe(true);
    expect(kept("مخطوطة", "رأت مخطوطات.", "ar")).toBe(true);
    expect(kept("ليلى", "رأى ليلاه.", "ar")).toBe(true);
    expect(kept("مكبس", "رفعت المكبس.", "ar")).toBe(true);
    // Without an Arabic language, the plain rule: no prefixes.
    expect(kept("مكبس", "رفعت المكبس.")).toBe(false);
    expect(kept("مكبس", "رفعت المكبس.", "fa")).toBe(false);
    // Hebrew: ו, ש after כ or מ, a preposition, and the article.
    expect(trap("ספר", "הוא קרא בספר.", "he")).toBe(false);
    expect(trap("הלך", "כשהלך הביתה.", "he")).toBe(false);
    expect(trap("ספר", "הוא קרא בספר.")).toBe(true);
  });

  test("#334 digits in any script keep a digit boundary only", () => {
    const kept = (phrase, draft) => results({ required: [phrase] }, draft, "canon kept")[0][0];
    expect(kept("١", "a١")).toBe(true);
    expect(kept("١", "١٢")).toBe(false);
    expect(kept("3", "٣3")).toBe(false);
    expect(kept("3", "x3")).toBe(true);
  });

  test("#334 unspaced scripts match as substrings, and a mixed phrase bounds each edge by its script", () => {
    const kept = (phrase, draft) => results({ required: [phrase] }, draft, "canon kept")[0][0];
    expect(kept("แมว", "แมวดำนอนอยู่")).toBe(true);
    expect(kept("時刻表", "古い時刻表が")).toBe(true);
    expect(kept("Kirimi駅", "Kirimi駅前で")).toBe(true);
    expect(kept("Kirimi駅", "XKirimi駅前で")).toBe(false);
    expect(kept("駅 Kirimi", "霧見駅 Kirimi")).toBe(true);
    expect(kept("駅 Kirimi", "駅 Kirimian")).toBe(false);
  });
});

describe("eval checker line count", () => {
  function lineResult(draft) {
    return checkDraft({ lines: 5, required: [] }, "", draft).filter(([, label]) => label.includes(" line(s), "));
  }

  test("counts nonblank verse lines, not paragraphs", () => {
    expect(lineResult("Tomas brought paraffin.")).toEqual([[false, "structure: 1 line(s), brief asks for 5"]]);
    expect(lineResult("one\ntwo\n\n  three\nfour\nfive\n")).toEqual([[true, "structure: 5 line(s), brief asks for 5"]]);
    expect(lineResult("one\ntwo\nthree\nfour\nfive\n```\nsix\n```\n")).toEqual([[true, "structure: 5 line(s), brief asks for 5"]]);
  });
});

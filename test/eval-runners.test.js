import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import { main as compareMain } from "../evals/compare-outputs.js";
import { MAX_REFERENCE_CHARS, main as runSkillMain, skillReferences, stripPreamble, unwrapFence } from "../evals/run-skill.js";
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
    // SKILL.md's links to other skills resolve from its folder.
    expect(draftCall.system).toContain("<!-- ../line-editing/references/language-conventions.md -->\n\n# Dialogue And Punctuation By Language");
    expect(draftCall.system).toContain("<!-- ../story-maintenance/references/conventions.md -->");
    expect(output()).toContain("references: references/writing-guidelines.md, ../line-editing/references/language-conventions.md,");
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
  const required = (name, i) => `canon kept: /${fixture(name).checks.required_regex[i]}/`;
  const trap = (name, start) => `trap avoided: /${fixture(name).checks.banned_regex.find((p) => p.startsWith(start))}/`;

  test("revision-continuity needs the pass started, the chapter marked revised, and the maintenance block", () => {
    expect(failed("revision-continuity", example("revision-continuity"))).toEqual([]);
    expect(failed("revision-continuity", noSkillDrafts["revision-continuity"]())).toEqual([
      required("revision-continuity", 0),
      required("revision-continuity", 1),
      required("revision-continuity", 2),
    ]);
    // The passage's traps read only the chapter text, so the plan may name
    // the slip it fixes and what stays shut.
    const draft = example("revision-continuity");
    const chapterText = draft.indexOf("## Chapter Text");
    const plan = (text) => draft.replace("Plan: start", `Plan: ${text}; start`);
    const prose = (text) => draft.slice(0, chapterText) + draft.slice(chapterText).replace("Let them wait.", text);
    expect(failed("revision-continuity", plan("Tomas still has not opened the sea-chest"))).toEqual([]);
    expect(failed("revision-continuity", prose("I opened the sea-chest."))).toEqual([trap("revision-continuity", "## Chapter Text[\\s\\S]*\\b(?:opened")]);
    expect(failed("revision-continuity", prose("I had carried it a week."))).toEqual([trap("revision-continuity", "## Chapter Text[\\s\\S]*\\b(?:a|one) week")]);
  });

  test("series-continuity needs book two's state at chapter 0, with no chapter of book one carried", () => {
    expect(failed("series-continuity", example("series-continuity"))).toEqual([]);
    expect(failed("series-continuity", noSkillDrafts["series-continuity"]())).toEqual([
      required("series-continuity", 0),
      trap("series-continuity", "(?:^|\\n)[ \\t-]*learned-in"),
      trap("series-continuity", "(?:^|\\n)[ \\t-]*since"),
    ]);
    const note = (line) => example("series-continuity").replace("## Series Notes\n\n", `## Series Notes\n\n- ${line}\n`);
    expect(failed("series-continuity", note("Tomas has never opened the sea-chest."))).toEqual([]);
    expect(failed("series-continuity", note("Nobody has opened it."))).toEqual([]);
    expect(failed("series-continuity", note("In book two Tomas opened the sea-chest."))).toEqual([trap("series-continuity", "(?<!")]);
  });

  test("genre-craft-mystery needs the clue ledger the plan describes", () => {
    expect(failed("genre-craft-mystery", example("genre-craft-mystery"))).toEqual([]);
    const { checks } = fixture("genre-craft-mystery");
    expect(failed("genre-craft-mystery", noSkillDrafts["genre-craft-mystery"]())).toEqual(checks.required_regex.map((pattern) => `canon kept: /${pattern}/`));
  });
});

describe("compare-outputs baseline margins", () => {
  const noModel = () => {
    throw new Error("no model call expected");
  };
  function marginDirs(name) {
    const baseline = makeTempDir("story-cmp-a-");
    const skill = makeTempDir("story-cmp-b-");
    fs.writeFileSync(path.join(baseline, `${name}.md`), noSkillDrafts[name]());
    fs.writeFileSync(path.join(skill, `${name}.md`), example(name));
    return { baseline, skill };
  }

  test("--no-judge checks each fixture's margin over the baseline with no model call", () => {
    const dirs = Object.keys(noSkillDrafts).map(marginDirs);
    const baseline = dirs[0].baseline;
    const skill = dirs[0].skill;
    for (const d of dirs.slice(1)) {
      for (const file of fs.readdirSync(d.baseline)) fs.copyFileSync(path.join(d.baseline, file), path.join(baseline, file));
      for (const file of fs.readdirSync(d.skill)) fs.copyFileSync(path.join(d.skill, file), path.join(skill, file));
    }
    const names = Object.keys(noSkillDrafts);
    expect(compareMain(["--no-judge", baseline, skill, ...names], { spawn: noModel })).toBe(0);
    expect(output()).toContain("genre-craft-mystery: margin met: B passes 33/33 checks, A 25/33, margin 8, needs 3");
    expect(output()).toContain("revision-continuity: margin met: B passes 29/29 checks, A 26/29, margin 3, needs 2");
    expect(output()).toContain("series-continuity: margin met: B passes 35/35 checks, A 32/35, margin 3, needs 2");
    expect(output()).toContain("margins met: 3 of 3");
    expect(output()).not.toContain("model:");

    // The margin is directional: dir-b is the skill's run.
    logs.length = 0;
    expect(compareMain(["--no-judge", skill, baseline, "genre-craft-mystery"], { spawn: noModel })).toBe(1);
    expect(output()).toContain("genre-craft-mystery: FAIL margin: B passes 25/33 checks, A 33/33, margin -8, needs 3");
    expect(output()).toContain("margins met: 0 of 1");
  });

  test("a margin is checked beside the judge, and a missed one fails the run", () => {
    const { baseline, skill } = marginDirs("genre-craft-mystery");
    const firstWins = () => ok("1");
    expect(compareMain([baseline, skill, "genre-craft-mystery"], { spawn: firstWins })).toBe(0);
    expect(output()).toContain("genre-craft-mystery: margin met");
    expect(output()).toContain("genre-craft-mystery: tie (order split)");

    logs.length = 0;
    expect(compareMain([skill, baseline, "genre-craft-mystery"], { spawn: firstWins })).toBe(1);
    expect(output()).toContain("genre-craft-mystery: FAIL margin");
    expect(output()).toContain("A: 0  B: 0  ties: 1");
  });

  test("--no-judge with no margin to check compares nothing and fails", () => {
    const { baseline, skill } = marginDirs("genre-craft-mystery");
    fs.writeFileSync(path.join(baseline, "canon-keeping.md"), goodDraft);
    fs.writeFileSync(path.join(skill, "canon-keeping.md"), goodDraft);
    expect(compareMain(["--no-judge", baseline, skill, "canon-keeping"], { spawn: noModel })).toBe(1);
    expect(output()).toContain("no selected fixture sets baseline_margin, and --no-judge skips the judge");

    logs.length = 0;
    fs.rmSync(path.join(baseline, "genre-craft-mystery.md"));
    expect(compareMain(["--no-judge", baseline, skill, "genre-craft-mystery"], { spawn: noModel })).toBe(1);
    expect(output()).toContain("genre-craft-mystery: FAIL (missing draft in one directory)");
  });
});

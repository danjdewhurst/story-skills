import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { err, warn } from "../src/findings.js";
import { checkFormat, githubAnnotations, githubSummary, reportGithub, SUMMARY_ROW_LIMIT } from "../src/github.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const examplesRoot = path.resolve(import.meta.dir, "..", "examples");
const thread = path.join(examplesRoot, "the-unraveled-thread");

function invoke(cwd, argv, env = {}) {
  const io = memoryIo(cwd);
  io.env = env;
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

describe("story check --format github", () => {
  test("prints one workflow command per finding, placed on its line, and keeps the text report", () => {
    const text = invoke(thread, ["check"]);
    const github = invoke(thread, ["check", "--format", "github"]);
    expect(github.code).toBe(1);
    expect(github.code).toBe(text.code);
    expect(github.err).toBe(text.err);
    const lines = github.out.trimEnd().split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("::error file=chapters/chapter-04.md,line=9,endLine=9,title=posthumous-appearance::lists edran-vale, who died in chapter-02; move posthumous appearances to mentions");
    expect(lines[4]).toBe("::warning file=chapters/chapter-03.md,line=4,endLine=4,title=pov-not-in-cast::POV character nessa-thorn is not listed in characters");
    expect(lines.filter((line) => line.startsWith("::error "))).toHaveLength(4);
    expect(lines.filter((line) => line.startsWith("::warning "))).toHaveLength(3);
    // The annotated line is the one the chapter's cast is on.
    const chapter = fs.readFileSync(path.join(thread, "chapters", "chapter-04.md"), "utf8").split("\n");
    expect(chapter[8]).toContain("edran-vale");
  });

  test("names files from GITHUB_WORKSPACE, so a project in a subdirectory points at the right file", () => {
    const { out } = invoke(thread, ["check", "--format", "github"], { GITHUB_WORKSPACE: examplesRoot });
    expect(out).toStartWith("::error file=the-unraveled-thread/chapters/chapter-04.md,line=9,");
    // With no GITHUB_WORKSPACE, the working directory is the base.
    expect(invoke(examplesRoot, ["check", "the-unraveled-thread", "--format", "github"]).out).toStartWith("::error file=the-unraveled-thread/chapters/chapter-04.md,");
  });

  test("appends a findings table to GITHUB_STEP_SUMMARY", () => {
    const summary = path.join(makeTempDir(), "summary.md");
    fs.writeFileSync(summary, "earlier step\n");
    const { code } = invoke(thread, ["check", "--format", "github"], { GITHUB_STEP_SUMMARY: summary });
    expect(code).toBe(1);
    const text = fs.readFileSync(summary, "utf8");
    expect(text).toStartWith("earlier step\n## Story checks\n\n4 errors, 3 warnings, 0 dismissed\n\n| Level | File | Line | Finding | Code |\n|---|---|---|---|---|\n");
    expect(text).toContain("| error | chapters/chapter-04.md | 9 | lists edran-vale, who died in chapter-02; move posthumous appearances to mentions | posthumous-appearance |\n");
    expect(text.split("\n").filter((line) => line.startsWith("| warning |"))).toHaveLength(3);
  });

  test("a clean project prints no annotations and a summary with no table", () => {
    const root = path.join(examplesRoot, "the-last-ember");
    const summary = path.join(makeTempDir(), "summary.md");
    const text = invoke(root, ["check"]);
    const { code, out } = invoke(root, ["check", "--format", "github"], { GITHUB_STEP_SUMMARY: summary });
    expect(code).toBe(text.code);
    const warnings = text.err.split("\n").filter((line) => line.startsWith("warning: ")).length;
    expect(out.split("\n").filter(Boolean)).toHaveLength(warnings);
    if (warnings === 0) {
      expect(fs.readFileSync(summary, "utf8")).toBe("## Story checks\n\n0 errors, 0 warnings, 0 dismissed\n\n");
    }
  });

  test("a summary that cannot be written is a note, and the exit code still comes from the findings", () => {
    const folder = makeTempDir();
    const { code, err: stderr, out } = invoke(thread, ["check", "--format", "github"], { GITHUB_STEP_SUMMARY: folder });
    expect(code).toBe(1);
    expect(out.split("\n").filter(Boolean)).toHaveLength(7);
    expect(stderr).toMatch(/^note: could not write the step summary: /m);
  });

  test("--json takes precedence and prints only the JSON result", () => {
    const summary = path.join(makeTempDir(), "summary.md");
    const { code, out, err: stderr } = invoke(thread, ["check", "--format", "github", "--json"], { GITHUB_STEP_SUMMARY: summary });
    expect(code).toBe(1);
    expect(stderr).toBe("");
    const envelope = JSON.parse(out);
    expect(validateAgainstSchema(envelope, schema)).toEqual([]);
    expect(envelope.command).toBe("check");
    expect(fs.existsSync(summary)).toBe(false);
  });

  test("--format text is the default and an unknown format is a usage error", () => {
    expect(invoke(thread, ["check", "--format", "text"])).toEqual(invoke(thread, ["check"]));
    const { code, err: stderr, out } = invoke(thread, ["check", "--format", "sarif"]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(stderr).toContain("Unknown check format: sarif (use text or github)");
    expect(checkFormat(undefined)).toBe("text");
    expect(() => checkFormat("csv")).toThrow("Unknown check format: csv (use text or github)");
  });

  test("other commands still escape a workflow command in their output", () => {
    expect(invoke(thread, ["validate", "--format", "github"]).code).toBe(2);
  });
});

describe("GitHub annotation output", () => {
  test("escapes project text, so a message cannot end the command or start another", () => {
    const finding = err("posthumous-appearance", "chapters/a.md lists x\n::error::injected 100% | [link](https://example.com) <b>", "chapters/a.md");
    const output = githubAnnotations([{ level: "error", finding, file: "chap:ters/a,b.md", line: 3, endLine: 4 }]);
    expect(output.split("\n")).toEqual([
      "::error file=chap%3Aters/a%2Cb.md,line=3,endLine=4,title=posthumous-appearance::lists x\\u000a::error::injected 100%25 | [link](https://example.com) <b>",
      ""
    ]);
    const summary = githubSummary([{ level: "error", finding, file: "chapters/a.md", line: 3, endLine: 4 }], { errors: [finding], warnings: [], dismissed: [] }, "Story checks");
    const row = summary.split("\n").find((line) => line.startsWith("| error |"));
    expect(row).toBe(String.raw`| error | chapters/a.md | 3 | lists x\\u000a::error::injected 100% \| \[link\](https://example.com) \<b\> | posthumous-appearance |`);
  });

  test("places what it can: no file property without a file, and no line for a file it cannot read", () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, "story.md"), "---\ntitle: T\n---\n");
    const io = memoryIo(root);
    const result = {
      errors: [err("missing-file", "gone.md is missing", "gone.md"), err("parse-error", "story.md: Unclosed thing (line 2)", "story.md")],
      warnings: [warn("no-scene-records", "the project has a warning about no file")],
      dismissed: [{ finding: warn("promise-unpaid", "dismissed one", "story.md"), reason: "accepted" }]
    };
    reportGithub(io, root, result, { env: {}, cwd: root });
    expect(io.output().split("\n")).toEqual([
      "::error file=gone.md,title=missing-file::gone.md is missing",
      "::error file=story.md,line=2,endLine=2,title=parse-error::Unclosed thing (line 2)",
      "::warning title=no-scene-records::the project has a warning about no file",
      ""
    ]);
  });

  test("the summary table stops at the row limit and says how many more there are", () => {
    const findings = Array.from({ length: SUMMARY_ROW_LIMIT + 5 }, (_, index) => warn("promise-unpaid", `finding ${index}`, "story.md"));
    const located = findings.map((finding) => ({ level: "warning", finding, file: "story.md", line: 1, endLine: 1 }));
    const summary = githubSummary(located, { errors: [], warnings: findings, dismissed: [] }, "Story checks");
    expect(summary.split("\n").filter((line) => line.startsWith("| warning |"))).toHaveLength(SUMMARY_ROW_LIMIT);
    expect(summary).toContain("\n5 more findings are in the job log.\n");
  });
});

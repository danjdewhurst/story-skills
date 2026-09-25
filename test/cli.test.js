import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isTruthy, parseArgs, runCli } from "../src/cli.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function addMinimalChapter(root) {
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: One
number: 1
pov: ""
locations: []
characters: []
arcs-advanced: []
status: draft
word-count: 0
`, "## Chapter Text\n\nOne two.");
}

describe("cli", () => {
  test("parses options and repeated values", () => {
    expect(parseArgs(["init", "A", "--theme", "x", "--theme=y", "--force", "-h"])).toEqual({
      positionals: ["init", "A"],
      options: { theme: ["x", "y"], force: true, help: true }
    });
  });

  test("keeps the last value of a repeated single-value option", () => {
    expect(parseArgs(["export", "proj", "--out", "a.md", "--out", "b.md", "--format=x", "--format", "y"])).toEqual({
      positionals: ["export", "proj"],
      options: { out: "b.md", format: "y" }
    });
    expect(parseArgs(["init", "A", "--force", "--force=false"]).options.force).toBe(false);
    expect(parseArgs(["add", "scene", "S", "--character", "a", "--character", "b"]).options.character).toEqual(["a", "b"]);
  });

  test("boolean flags never swallow the following positional", () => {
    expect(parseArgs(["wordcount", "--write", "my-story"])).toEqual({
      positionals: ["wordcount", "my-story"],
      options: { write: true }
    });
    expect(parseArgs(["init", "--force", "Alpha", "Beta"])).toEqual({
      positionals: ["init", "Alpha", "Beta"],
      options: { force: true }
    });
    expect(parseArgs(["report", "--actionable", "."])).toEqual({
      positionals: ["report", "."],
      options: { actionable: true }
    });
  });

  test("accepts dash-led separate values for known value-taking options", () => {
    expect(parseArgs(["add", "chapter", "Foo", "--number", "-1"])).toEqual({
      positionals: ["add", "chapter", "Foo"],
      options: { number: "-1" }
    });
    expect(parseArgs(["add", "location", "Cave", "--region", "-north"])).toEqual({
      positionals: ["add", "location", "Cave"],
      options: { region: "-north" }
    });
    expect(parseArgs(["add", "chapter", "Foo", "--theme", "-dark", "--pov", "-first"])).toEqual({
      positionals: ["add", "chapter", "Foo"],
      options: { theme: "-dark", pov: "-first" }
    });
  });

  test("keeps --option=value working for dash-led values", () => {
    expect(parseArgs(["add", "chapter", "Foo", "--number=-1"])).toEqual({
      positionals: ["add", "chapter", "Foo"],
      options: { number: "-1" }
    });
    expect(parseArgs(["init", "A", "--synopsis=-a dark tale"])).toEqual({
      positionals: ["init", "A"],
      options: { synopsis: "-a dark tale" }
    });
  });

  test("errors clearly on truly missing option values", () => {
    expect(() => parseArgs(["add", "chapter", "Foo", "--number"])).toThrow("Missing value for --number");
    expect(() => parseArgs(["add", "chapter", "Foo", "--number", "--format"])).toThrow("Missing value for --number");
    expect(() => parseArgs(["add", "scene", "Bar", "--chapter", "--scene"])).toThrow("Missing value for --chapter");
    expect(() => parseArgs(["add", "chapter", "Foo", "--number", "-h"])).toThrow("Missing value for --number");
    const cwd = makeTempDir();
    const missing = invoke(cwd, ["add", "chapter", "Foo", "--number"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("Missing value for --number");
    expect(() => parseArgs(["validate", "--path", "--bogus"])).toThrow("Missing value for --path");
    const badPath = invoke(cwd, ["validate", "--path", "--bogus"]);
    expect(badPath.code).toBe(1);
    expect(badPath.err).toContain("Missing value for --path");
  });

  test("rejects unknown options instead of passing them through", () => {
    expect(() => parseArgs(["add", "chapter", "Foo", "--bogus", "value"])).toThrow("Unknown option --bogus");
    expect(() => parseArgs(["add", "chapter", "Foo", "--bogus=inline"])).toThrow("Unknown option --bogus");
    expect(() => parseArgs(["add", "chapter", "Foo", "--bogus"])).toThrow("Unknown option --bogus");
    const cwd = makeTempDir();
    const rejected = invoke(cwd, ["add", "chapter", "Foo", "--bogus", "value"]);
    expect(rejected.code).toBe(1);
    expect(rejected.err).toContain("Unknown option --bogus");
  });

  test("normalizes --flag=false/0/no to false", () => {
    expect(parseArgs(["init", "A", "--force=false"]).options).toEqual({ force: false });
    expect(parseArgs(["init", "A", "--force=0"]).options).toEqual({ force: false });
    expect(parseArgs(["init", "A", "--force=no"]).options).toEqual({ force: false });
    expect(parseArgs(["init", "A", "--force=NO"]).options).toEqual({ force: false });
    expect(parseArgs(["wordcount", "--write=false", "."]).options).toEqual({ write: false, });
    expect(parseArgs(["report", "--actionable", "."]).options).toEqual({ actionable: true });
    expect(parseArgs(["build", ".", "--shunn=true"]).options).toEqual({ shunn: true });
  });

  test("rejects unrecognized --flag=value strings", () => {
    expect(() => parseArgs(["init", "A", "--force=maybe"])).toThrow('Unknown value "maybe" for --force');
    expect(() => parseArgs(["init", "A", "--force="])).toThrow('Unknown value "" for --force');
    expect(parseArgs(["init", "A", "--force=yes"]).options).toEqual({ force: true });
  });

  test("consumes space-separated boolean literals without swallowing positionals", () => {
    expect(parseArgs(["init", "A", "--force", "false"])).toEqual({
      positionals: ["init", "A"],
      options: { force: false }
    });
    expect(parseArgs(["init", "A", "--force", "off"])).toEqual({
      positionals: ["init", "A"],
      options: { force: false }
    });
    expect(parseArgs(["wordcount", "--write", "my-story"])).toEqual({
      positionals: ["wordcount", "my-story"],
      options: { write: true }
    });
  });

  test("isTruthy coerces strings, arrays, and misc values", () => {
    expect(isTruthy("false")).toBe(false);
    expect(isTruthy("FALSE")).toBe(false);
    expect(isTruthy("0")).toBe(false);
    expect(isTruthy("no")).toBe(false);
    expect(isTruthy("off")).toBe(false);
    expect(isTruthy("")).toBe(false);
    expect(isTruthy("yes")).toBe(true);
    expect(isTruthy("anything-else")).toBe(true);
    expect(isTruthy(true)).toBe(true);
    expect(isTruthy(false)).toBe(false);
    expect(isTruthy(undefined)).toBe(false);
    expect(isTruthy(["true", "false"])).toBe(false);
    expect(isTruthy(["false", "yes"])).toBe(true);
  });

  test("--force=false does not overwrite an existing project", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Forced"]).code).toBe(0);
    const root = path.join(cwd, "forced");
    const retry = invoke(cwd, ["init", "Forced", "--force=false"]);
    expect(retry.code).toBe(1);
    expect(retry.err).toContain("already exists");
    expect(invoke(cwd, ["init", "Forced", "--force"]).code).toBe(0);
    expect(invoke(cwd, ["wordcount", root, "--write=false"]).out).toContain("Total:");
  });

  test("resolveRoot accepts a positional path or --path but rejects conflicts", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Rooted"]).code).toBe(0);
    const root = path.join(cwd, "rooted");
    const positional = invoke(cwd, ["validate", root]);
    expect(positional.code).toBe(0);
    const flagged = invoke(cwd, ["validate", "--path", root]);
    expect(flagged.code).toBe(0);
    const same = invoke(cwd, ["validate", root, "--path", root]);
    expect(same.code).toBe(0);
    const conflict = invoke(cwd, ["validate", root, "--path", cwd]);
    expect(conflict.code).toBe(1);
    expect(conflict.err).toContain("Conflicting project paths");
    const added = invoke(cwd, ["add", "character", "Root Hero", "--path", root]);
    expect(added.code).toBe(0);
    expect(added.out).toContain("Created character root-hero");
  });

  test("check output goes to stderr while report bodies stay on stdout", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Streams"]).code).toBe(0);
    const root = path.join(cwd, "streams");
    const validate = invoke(cwd, ["validate", root]);
    expect(validate.code).toBe(0);
    expect(validate.err).toContain("Project is valid");
    expect(validate.out).toBe("");
    const series = invoke(cwd, ["series", root]);
    expect(series.code).toBe(0);
    expect(series.out).toContain("# Series:");
    expect(series.out).not.toContain("Series is consistent");
    expect(series.err).toContain("Series is consistent");
  });

  test("add accepts plural kinds but rejects non-kinds like glass", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Kinds"]).code).toBe(0);
    const root = path.join(cwd, "kinds");
    for (const kind of ["characters", "terms", "glossary-terms"]) {
      const name = "Plural " + kind;
      const result = invoke(cwd, ["add", kind, name, "--path", root]);
      expect(result.code).toBe(0);
      expect(result.out).toContain("Created ");
    }
    const bad = invoke(cwd, ["add", "glass", "Pane", "--path", root]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("Unsupported entity kind: glass");
  });
  test("names the missing story.md when a path is not a project", () => {
    const cwd = makeTempDir();
    const result = invoke(cwd, ["links", "nowhere"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("is not a story project: missing story.md");
  });

  test("prints the package version", () => {
    const cwd = makeTempDir();
    const { version } = JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, "..", "package.json"), "utf8"));
    for (const argv of [["--version"], ["-v"], ["validate", "-v"]]) {
      expect(invoke(cwd, argv)).toEqual({ code: 0, out: `${version}\n`, err: "" });
    }
    expect(parseArgs(["--version", "--help"]).options).toEqual({ version: true, help: true });
    expect(invoke(cwd, ["--help"]).out).toContain("-v, --version");
  });

  test("prints help and handles unknown commands", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, []).out).toContain("Usage: story");
    expect(invoke(cwd, ["help"]).out).toContain("Commands:");
    const help = invoke(cwd, ["--help"]).out;
    expect(help).toContain("validate");
    expect(help).toContain("continuity [path]");
    expect(help).toContain("series [path]");
    expect(help).toContain("--follows <path>");
    expect(help).toContain("--precedes <path>");
    expect(help).toContain("import <source>");
    expect(help).toContain("--title <name>");
    expect(help).toContain("--role <name>");
    expect(help).toContain("--introduced <id>");
    expect(help).toContain("--category <name>");
    const initPath = invoke(cwd, ["init", "Nope", "--path", "somewhere"]);
    expect(initPath.code).toBe(1);
    expect(initPath.err).toContain("init uses --dir");
    const importPath = invoke(cwd, ["import", "draft.md", "--path", "somewhere"]);
    expect(importPath.code).toBe(1);
    expect(importPath.err).toContain("import uses --dir");
    const unknown = invoke(cwd, ["nope"]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("Unknown command: nope");
  });

  test("help documents builder options consumed by add", () => {
    const cwd = makeTempDir();
    const help = invoke(cwd, ["--help"]).out;
    expect(help).toContain("--pov <style|id>");
    expect(help).toContain("add chapter/scene");
    expect(help).toContain("--theme <name>");
    expect(help).toContain("add arc");
    expect(help).toContain("--chapter <id>");
    expect(help).toContain("Chapter id for add scene");
    expect(help).not.toContain("or continuity records");
    expect(help).toContain("--region <name>");
    expect(help).toContain("--population <name>");
    expect(help).toContain("--controlled-by <id>");
    expect(help).toContain("--prevalence <name>");
    expect(help).toContain("--acts <a,b>");
    expect(help).toContain("--mention <id>");
    expect(help).toContain("add chapter/scene");
    expect(help).toContain("--mode <name>");
    expect(help).toContain("--date <date>");
    expect(help).toContain("--time <time>");
    expect(help).toContain("--travel-hours <n>");
    expect(help).toContain("--dilemma <text>");
    expect(help).toContain("--sequel");
  });

  test("parses mention options and writes them for new chapters", () => {
    expect(parseArgs(["add", "chapter", "Foo", "--mention", "mira-sol"])).toEqual({
      positionals: ["add", "chapter", "Foo"],
      options: { mention: "mira-sol" }
    });
    expect(parseArgs(["add", "scene", "Bar", "--mentions", "-ghost"])).toEqual({
      positionals: ["add", "scene", "Bar"],
      options: { mentions: "-ghost" }
    });
    expect(() => parseArgs(["add", "chapter", "Foo", "--mention"])).toThrow("Missing value for --mention");
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Mentions"]).code).toBe(0);
    const root = path.join(cwd, "mentions");
    const added = invoke(cwd, ["add", "chapter", "Arrival", "--path", root, "--number", "1", "--mention", "mira-sol"]);
    expect(added.code).toBe(0);
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8")).toContain("mira-sol");
  });

  test("add chapter serializes --date and --time into chapter frontmatter", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Chronology"]).code).toBe(0);
    const root = path.join(cwd, "chronology");
    const added = invoke(cwd, ["add", "chapter", "Harvest", "--path", root, "--number", "1", "--date", "2026-03-01", "--time", "09:30"]);
    expect(added.code).toBe(0);
    const raw = fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8");
    expect(raw).toContain("date: 2026-03-01");
    expect(raw).toContain(`time: "09:30"`);
  });

  test("runs init, validate, wordcount, reindex, links, and export commands", () => {
    const cwd = makeTempDir();
    const init = invoke(cwd, [
      "init",
      "CLI",
      "Story",
      "--genre=fantasy",
      "--sub-genre",
      "epic",
      "--setting-era",
      "future",
      "--themes",
      "hope,loss",
      "--pov",
      "first-person",
      "--tense",
      "present",
      "--synopsis",
      "A test story.",
      "--force"
    ]);
    expect(init.code).toBe(0);
    expect(init.out).toContain("Created story project:");

    const root = path.join(cwd, "cli-story");
    addMinimalChapter(root);
    expect(invoke(cwd, ["wordcount", root]).out).toContain("Total: 2");
    expect(invoke(cwd, ["wordcount", root, "--write"]).out).toContain("chapters/chapter-01.md: 2");
    expect(fs.readFileSync(path.join(root, "chapters", "_index.md"), "utf8")).toContain("Total Word Count: 2");
    expect(invoke(cwd, ["reindex", root]).out).toContain("Registries already up to date");
    expect(invoke(cwd, ["validate", root]).err).toContain("Project is valid");
    expect(invoke(cwd, ["links", root]).err).toContain("Links are valid");
    const report = invoke(cwd, ["report", root]);
    expect(report.out).toContain("# CLI Story");
    expect(report.out).toContain("Schema version: 2");
    expect(report.out).toContain("- Total words: 2");
    expect(invoke(cwd, ["report", root, "--actionable"]).out).toContain("Next Actions:");
    expect(invoke(cwd, ["next", root]).out).toContain("Draft chapter 2");
    expect(invoke(cwd, ["doctor", root]).out).toContain("Story Doctor");
    expect(invoke(cwd, ["export", root, "--out", "out.md"]).out).toContain("Exported 1 chapters");
    const build = invoke(cwd, ["build", root]);
    expect(build.out).toContain("Built 1 chapters as markdown");
    expect(fs.existsSync(path.join(root, "dist", "cli-story.md"))).toBe(true);
    expect(invoke(cwd, ["build", root, "--format", "epub"]).out).toContain("as epub");
    expect(fs.existsSync(path.join(root, "dist", "cli-story.epub"))).toBe(true);
  });

  test("reports command failures", () => {
    const cwd = makeTempDir();
    const init = invoke(cwd, ["init"]);
    expect(init.code).toBe(1);
    expect(init.err).toContain("A story title is required");

    const validate = invoke(cwd, ["validate"]);
    expect(validate.code).toBe(1);
    expect(validate.err).toContain("is not a story project: missing story.md");

    const created = invoke(cwd, ["init", "Broken"]);
    expect(created.code).toBe(0);
    writeMarkdown(path.join(cwd, "broken", "chapters", "chapter-01.md"), `
title: Broken
number: 1
pov: ""
locations:
  - missing-place
characters: []
arcs-advanced: []
status: draft
word-count: 0
`, "## Chapter Text\n\nWords.");
    const links = invoke(cwd, ["links", path.join(cwd, "broken")]);
    expect(links.code).toBe(1);
    expect(links.err).toContain("references missing location missing-place");

    const build = invoke(cwd, ["build", path.join(cwd, "broken"), "--format", "pdf"]);
    expect(build.code).toBe(1);
    expect(build.err).toContain("Unsupported build format: pdf");
  });

  test("runs add, rename, remove, and migrate commands", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Helpers"]).code).toBe(0);
    const root = path.join(cwd, "helpers");

    const character = invoke(cwd, ["add", "character", "Ada Reed", "--path", root, "--role", "protagonist"]);
    expect(character.code).toBe(0);
    expect(character.out).toContain("Created character ada-reed");
    expect(fs.existsSync(path.join(root, "characters", "ada-reed.md"))).toBe(true);

    const renamed = invoke(cwd, ["rename", "character", "ada-reed", "Ada Vale", "--path", root]);
    expect(renamed.code).toBe(0);
    expect(fs.existsSync(path.join(root, "characters", "ada-vale.md"))).toBe(true);

    const removed = invoke(cwd, ["remove", "character", "ada-vale", "--path", root]);
    expect(removed.code).toBe(0);
    expect(fs.existsSync(path.join(root, "characters", "ada-vale.md"))).toBe(false);

    fs.rmSync(path.join(root, "scenes"), { recursive: true, force: true });
    fs.writeFileSync(
      path.join(root, "story.md"),
      fs.readFileSync(path.join(root, "story.md"), "utf8").replace("schema-version: 2", "schema-version: 1"),
      "utf8"
    );
    const migrated = invoke(cwd, ["migrate", root]);
    expect(migrated.code).toBe(0);
    expect(migrated.out).toContain("Migrated project");
    expect(fs.existsSync(path.join(root, "scenes", "_index.md"))).toBe(true);
  });

  test("runs continuity and import commands", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Checked"]).code).toBe(0);
    const root = path.join(cwd, "checked");
    addMinimalChapter(root);

    const clean = invoke(cwd, ["continuity", root]);
    expect(clean.code).toBe(0);
    expect(clean.err).toContain("Continuity is consistent");

    writeMarkdown(path.join(root, "continuity", "promises", "ghost-payoff.md"), `
title: Ghost Payoff
status: paid-off
planted: ""
payoff: ""
`, "# Ghost Payoff\n");
    const broken = invoke(cwd, ["continuity", root]);
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("ghost-payoff.md is paid-off but has no payoff chapter");

    fs.writeFileSync(path.join(cwd, "book.md"), "## Chapter 1: Door\n\nThe door held fast.\n\n## Chapter 2: Smoke\n\nSmoke crept under it.", "utf8");
    const imported = invoke(cwd, ["import", "book.md", "--title", "Imported Tale", "--genre", "mystery"]);
    expect(imported.code).toBe(0);
    expect(imported.out).toContain("Imported 2 chapters");
    expect(invoke(cwd, ["validate", path.join(cwd, "imported-tale")]).code).toBe(0);

    fs.writeFileSync(path.join(cwd, "names.md"), "## Chapter 1\n\nHe met Vex Marrow. She trusted Vex Marrow. They feared Vex Marrow.", "utf8");
    const withCandidates = invoke(cwd, ["import", "names.md", "--title", "Named Tale"]);
    expect(withCandidates.out).toContain("Entity candidates");
    expect(withCandidates.out).toContain("- Vex Marrow (3 mentions)");

    const failed = invoke(cwd, ["import"]);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain("An import source file or directory is required");
  });

  test("prints validation warnings on successful validation", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Warned"]).code).toBe(0);
    const root = path.join(cwd, "warned");
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: Warned
number: 1
pov: ""
locations: []
characters: []
arcs-advanced: []
status: draft
word-count: 9
`, "## Chapter Text\n\nTwo words.");

    const validation = invoke(cwd, ["validate", root]);
    expect(validation.code).toBe(0);
    expect(validation.err).toContain("warning:");
    expect(validation.err).toContain("declares 9 words");
    expect(validation.out).not.toContain("warning:");
  });

  test("runs the bundled story-maintenance fallback script under Node", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const bundle = path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js");

    // process.execPath is Bun under `bun test`, so the Node-compat bundle must
    // be spawned via an explicit `node` lookup instead.
    let nodeAvailable = true;
    try {
      const probe = spawnSync("node", ["--version"], { encoding: "utf8" });
      nodeAvailable = probe.status === 0;
    } catch {
      nodeAvailable = false;
    }
    if (!nodeAvailable) {
      console.warn("Skipping fallback behavioral tests: node is not on PATH.");
      return;
    }

    const runBundle = (args, cwd = repoRoot) =>
      spawnSync("node", [bundle, ...args], { cwd, encoding: "utf8" });

    const help = runBundle(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: story");
    expect(help.stdout).toContain("wordcount");
    expect(help.stdout).toContain("build");

    // Exercise core commands against a temp copy so reindex cannot dirty the repo.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "story-skills-fallback-"));
    try {
      const fixture = path.join(scratch, "the-last-ember");
      fs.cpSync(path.join(repoRoot, "examples", "the-last-ember"), fixture, { recursive: true });
      // the-last-ember follows its prequel, so links need the sibling book too.
      fs.cpSync(path.join(repoRoot, "examples", "the-fall-of-the-citadel"), path.join(scratch, "the-fall-of-the-citadel"), { recursive: true });

      const series = runBundle(["series", fixture]);
      expect(series.status).toBe(0);
      expect(series.stderr).toContain("Series is consistent");

      const validate = runBundle(["validate", fixture]);
      expect(validate.status).toBe(0);
      expect(validate.stderr).toContain("Project is valid");

      const links = runBundle(["links", fixture]);
      expect(links.status).toBe(0);
      expect(links.stderr).toContain("Links are valid");

      const wordcount = runBundle(["wordcount", fixture]);
      expect(wordcount.status).toBe(0);
      expect(wordcount.stdout).toContain("Total:");

      const reindex = runBundle(["reindex", fixture]);
      expect(reindex.status).toBe(0);
      expect(reindex.stdout).toContain("Registries already up to date");

      const missing = runBundle(["validate", path.join(scratch, "does-not-exist")]);
      expect(missing.status).toBe(1);
      expect(`${missing.stdout}${missing.stderr}`).toContain("is not a story project: missing story.md");
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

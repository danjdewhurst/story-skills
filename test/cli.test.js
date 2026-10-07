import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleOutputError, isTruthy, parseArgs, runCli } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { KIND_ALIASES, buildEntity, scanProject } from "../src/scan.js";
import { createStoryProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// Every file under root with its text, to show a command changed nothing.
function snapshotFiles(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true })
    .filter((file) => fs.statSync(path.join(root, file)).isFile())
    .sort()
    .map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]));
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

const repoRoot = path.resolve(import.meta.dir, "..");

function newProject(title = "Gull") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function fakeProcess(exitCode) {
  const written = [];
  return {
    exitCode,
    exits: [],
    stderr: { write: (text) => written.push(text) },
    exit(code) {
      this.exits.push(code);
    },
    written
  };
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
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("Missing value for --number");
    expect(() => parseArgs(["validate", "--path", "--bogus"])).toThrow("Missing value for --path");
    const badPath = invoke(cwd, ["validate", "--path", "--bogus"]);
    expect(badPath.code).toBe(2);
    expect(badPath.err).toContain("Missing value for --path");
  });

  test("rejects unknown options instead of passing them through", () => {
    expect(() => parseArgs(["add", "chapter", "Foo", "--bogus", "value"])).toThrow("Unknown option --bogus");
    expect(() => parseArgs(["add", "chapter", "Foo", "--bogus=inline"])).toThrow("Unknown option --bogus");
    expect(() => parseArgs(["add", "chapter", "Foo", "--bogus"])).toThrow("Unknown option --bogus");
    const cwd = makeTempDir();
    const rejected = invoke(cwd, ["add", "chapter", "Foo", "--bogus", "value"]);
    expect(rejected.code).toBe(2);
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

  test("a boolean flag takes a value only as --flag=value, never the next word (#549)", () => {
    expect(parseArgs(["init", "--force", "Alpha", "Beta"])).toEqual({
      positionals: ["init", "Alpha", "Beta"],
      options: { force: true }
    });
    // A boolean word after a bare flag, in any case, is refused rather than
    // read as the flag's value or as a title word.
    expect(() => parseArgs(["add", "chapter", "--dry-run", "No", "Way", "Back"])).toThrow("--dry-run No is ambiguous: write --dry-run=false to turn the flag off, or put --dry-run after No, or No after --, to keep No as an argument");
    expect(() => parseArgs(["init", "A", "--force", "true"])).toThrow("--force true is ambiguous: write --force=true to turn the flag on");
    for (const word of ["true", "false", "yes", "no", "on", "off", "1", "0", "True", "FALSE", "On", "NO"]) {
      expect(() => parseArgs(["init", "--force", word])).toThrow(`--force ${word} is ambiguous`);
    }
    expect(parseArgs(["add", "chapter", "No", "Way", "Back", "--dry-run"])).toEqual({
      positionals: ["add", "chapter", "No", "Way", "Back"],
      options: { "dry-run": true }
    });
    expect(parseArgs(["add", "chapter", "--dry-run", "--", "No", "Way", "Back"])).toEqual({
      positionals: ["add", "chapter", "No", "Way", "Back"],
      options: { "dry-run": true }
    });
  });

  test("a boolean word after a flag never turns into a write (#549)", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Tide"]).code).toBe(0);
    const root = path.join(cwd, "tide");
    expect(invoke(root, ["add", "character", "Mara"]).code).toBe(0);
    const before = snapshotFiles(root);
    for (const argv of [
      ["add", "chapter", "--dry-run", "No", "Way", "Back"],
      ["add", "matter", "Dedication", "--heading", "no"],
      ["add", "clue", "Key", "--red-herring", "False"],
      ["add", "scene", "Arrival", "--sequel", "no"],
      ["rename", "character", "mara", "Mara Vell", "--prose", "0"]
    ]) {
      const result = invoke(root, argv);
      expect(result.code).toBe(2);
      expect(result.err).toContain("is ambiguous: write --");
    }
    expect(snapshotFiles(root)).toEqual(before);
    const preview = invoke(root, ["add", "chapter", "No", "Way", "Back", "--dry-run"]);
    expect(preview.code).toBe(0);
    expect(preview.out).toContain("create  chapters/chapter-01.md");
    expect(snapshotFiles(root)).toEqual(before);
    // init --force with a boolean word refuses before it touches a folder.
    fs.mkdirSync(path.join(cwd, "book"));
    expect(invoke(cwd, ["init", "Book", "--dir", "book", "--force", "FALSE"]).code).toBe(2);
    expect(fs.readdirSync(path.join(cwd, "book"))).toEqual([]);
    expect(invoke(cwd, ["init", "On", "the", "Road", "--force"]).code).toBe(0);
    expect(fs.readFileSync(path.join(cwd, "on-the-road", "story.md"), "utf8")).toContain("title: On the Road");
    // --json is on whatever follows it, so the refusal is a JSON envelope,
    // also when the flag comes before the command.
    for (const argv of [["validate", "--json", "false"], ["--json", "false", "validate"], ["--json", "No", "validate"]]) {
      const json = invoke(root, argv);
      expect(json.code).toBe(2);
      expect(json.err).toBe("");
      expect(JSON.parse(json.out)).toMatchObject({ command: "validate", ok: false });
      expect(JSON.parse(json.out).diagnostics[0].message).toContain(`--json ${argv.includes("No") ? "No" : "false"} is ambiguous`);
    }
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
    expect(retry.code).toBe(4);
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
    expect(conflict.code).toBe(2);
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
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("Unsupported entity kind: glass");
  });
  test("names the missing story.md when a path is not a project", () => {
    const cwd = makeTempDir();
    const result = invoke(cwd, ["links", "nowhere"]);
    expect(result.code).toBe(3);
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
    expect(help).toContain("import <source|->");
    expect(help).toContain("--title <name>");
    expect(help).toContain("--role <name>");
    expect(help).toContain("--introduced <id>");
    expect(help).toContain("--category <name>");
    const initPath = invoke(cwd, ["init", "Nope", "--path", "somewhere"]);
    expect(initPath.code).toBe(2);
    expect(initPath.err).toContain("init uses --dir");
    const importPath = invoke(cwd, ["import", "draft.md", "--path", "somewhere"]);
    expect(importPath.code).toBe(2);
    expect(importPath.err).toContain("import uses --dir");
    const unknown = invoke(cwd, ["nope"]);
    expect(unknown.code).toBe(2);
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

  test("add refuses an option that only another kind reads (#576)", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Watch"]).code).toBe(0);
    const root = path.join(cwd, "watch");
    expect(invoke(root, ["add", "chapter", "One"]).code).toBe(0);
    const scene = invoke(root, ["add", "scene", "Night Watch", "--chapter", "chapter-01", "--number", "5"]);
    expect(scene.code).toBe(2);
    expect(scene.err).toBe("--number does not apply to story add scene: story help add lists the options each kind reads\n");
    expect(fs.existsSync(path.join(root, "scenes", "chapter-01-scene-01.md"))).toBe(false);
    // Kinds match as add matches them: plural, in any case.
    expect(invoke(root, ["add", "Characters", "Mira", "--hook", "cliffhanger"]).err).toContain("--hook does not apply to story add character:");
    expect(invoke(root, ["add", "artifact", "Key", "--locations", "port"]).err).toContain("--locations does not apply to story add artifact:");
    expect(fs.existsSync(path.join(root, "characters", "mira.md"))).toBe(false);
    // A chapter or scene id comes from its number.
    expect(invoke(root, ["add", "chapter", "Low Tide", "--id", "opening"]).err).toBe("--id does not apply to story add chapter: story help add lists the options each kind reads\n");
    const json = invoke(root, ["add", "system", "Tithe", "--owner", "mara", "--json"]);
    expect(json.code).toBe(2);
    expect(JSON.parse(json.out)).toMatchObject({ command: "add", ok: false, diagnostics: [{ code: "usage-error", message: "--owner does not apply to story add system: story help add lists the options each kind reads" }] });
    // An unknown kind is reported as one, not as a stray option.
    expect(invoke(root, ["add", "villain", "Maren", "--hook", "cliffhanger"]).err).toContain("Unsupported entity kind: villain");
    // --dry-run applies to every kind, and --id to every kind but chapter and scene.
    const add = COMMANDS.find((command) => command.name === "add");
    for (const [kind, options] of Object.entries(add.kinds)) {
      const result = invoke(root, ["add", kind, "Sample Thing", "--dry-run", ...(options.includes("id") ? ["--id", "sample-id"] : [])]);
      expect({ kind, code: result.code, err: result.err }).toEqual({ kind, code: 0, err: "" });
    }
    expect(add.kinds.chapter.includes("id") || add.kinds.scene.includes("id")).toBe(false);
    expect(invoke(root, ["add", "scene", "Night Watch", "--chapter", "chapter-01", "--scene", "5"]).code).toBe(0);
    const help = invoke(root, ["help", "add"]).out;
    expect(help).toContain("Options by kind (every kind also takes --path, --json, and --dry-run):\n");
    expect(help).toContain("\n  system      --id --type --prevalence\n");
    expect(help).not.toContain("--characters");
  });

  test("add chapter --beat writes the beat on one line, and a blank one sets none (#531)", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Beats"]).code).toBe(0);
    const root = path.join(cwd, "beats");
    const frontmatter = (number) => parseFrontmatter(fs.readFileSync(path.join(root, "chapters", `chapter-0${number}.md`), "utf8")).data;
    expect(invoke(root, ["add", "chapter", "Storm", "--beat", "  Inciting\n  Incident ", "--hook", "revelation"]).code).toBe(0);
    expect(frontmatter(1)).toMatchObject({ hook: "revelation", beat: "Inciting Incident" });
    // A beat that looks like a number is written as text.
    expect(invoke(root, ["add", "chapter", "Year", "--beat", "1984"]).code).toBe(0);
    expect(frontmatter(2).beat).toBe("1984");
    // A # would start a comment, so the writer quotes it.
    expect(invoke(root, ["add", "chapter", "Again", "--beat", "Try/Fail #2"]).code).toBe(0);
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-03.md"), "utf8")).toContain('beat: "Try/Fail #2"\n');
    expect(frontmatter(3).beat).toBe("Try/Fail #2");
    expect(invoke(root, ["add", "chapter", "Lull", "--number", "4", "--beat", " "]).code).toBe(0);
    expect(Object.hasOwn(frontmatter(4), "beat")).toBe(false);
    expect(invoke(root, ["check"]).code).toBe(0);
    expect(invoke(root, ["add", "scene", "Wreck", "--chapter", "chapter-01", "--beat", "Midpoint"]).err).toContain("--beat does not apply to story add scene:");
  });

  test("each add kind lists exactly the options its builder reads", () => {
    // A value for every add option that differs from the builder's default.
    const values = {
      id: "custom-id", number: "7", chapter: "chapter-01", scene: "9", type: "zz-type", role: "zz-role", status: "zz-status",
      mode: "discovered", date: "2026-01-02", time: "dawn", "travel-hours": "3", dilemma: "Stay or go", sequel: true,
      outcome: "yes-but", hook: "cliffhanger", beat: "Midpoint", location: "port", locations: "port", character: "mara", characters: "mara",
      mention: "ivo", mentions: "ivo", member: "mara", members: "mara", owner: "mara", arc: "long-road", arcs: "long-road",
      introduced: "chapter-01", resolved: "chapter-01", planted: "chapter-01", payoff: "chapter-02", "significance-delayed": true,
      "red-herring": true, category: "zz-category", alias: "Rite", aliases: "Rite", region: "North", population: "Few",
      "controlled-by": "council", prevalence: "rare", acts: "I", act: "I", placement: "back", order: "5", heading: false,
      source: "Book", sources: "Book", "used-in": "chapter-01", accuracy: "blended", confidence: "high", method: "fact",
      risk: "legal", theme: "grief", themes: "grief", pov: "mara"
    };
    const add = COMMANDS.find((command) => command.name === "add");
    const named = add.options.filter((name) => name !== "dry-run" && name !== "json");
    expect(Object.keys(values).sort()).toEqual([...named].sort());
    expect(Object.keys(add.kinds).sort()).toEqual([...new Set(Object.values(KIND_ALIASES))].sort());
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Builders"]).code).toBe(0);
    const root = path.join(cwd, "builders");
    expect(invoke(root, ["add", "chapter", "One"]).code).toBe(0);
    expect(invoke(root, ["add", "chapter", "Two"]).code).toBe(0);
    const project = scanProject(root);
    const render = (kind, options) => {
      const entity = buildEntity(project, kind, "Sample Name", options);
      return `${entity.id}\n${entity.markdown}`;
    };
    for (const [kind, listed] of Object.entries(add.kinds)) {
      const base = render(kind, {});
      for (const name of named) {
        if ((kind === "chapter" || kind === "scene") && name === "id") {
          expect(() => render(kind, { id: values.id })).toThrow(`--id does not apply to a ${kind}`);
          continue;
        }
        const reads = render(kind, { [name]: values[name] }) !== base;
        expect({ kind, name, reads }).toEqual({ kind, name, reads: listed.includes(name) });
      }
    }
  });

  test("only the plural list flags split on commas (#576)", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Ash", "--theme", "Love, loss", "--themes", "grief,hope"]).code).toBe(0);
    const root = path.join(cwd, "ash");
    const frontmatter = (...parts) => parseFrontmatter(fs.readFileSync(path.join(root, ...parts), "utf8")).data;
    expect(frontmatter("story.md").themes).toEqual(["Love, loss", "grief", "hope"]);
    expect(invoke(root, ["add", "term", "Ember Rite", "--alias", "Rite of Ash, the", "--aliases", "Ash Rite,Burning"]).code).toBe(0);
    expect(frontmatter("glossary", "terms", "ember-rite.md").aliases).toEqual(["Ash Rite", "Burning", "Rite of Ash, the"]);
    expect(invoke(root, ["add", "arc", "Long Road", "--act", "Act I, the fall", "--acts", "II,III", "--theme", "Ash, salt"]).code).toBe(0);
    expect(frontmatter("plot", "arcs", "long-road.md")).toMatchObject({ acts: ["II", "III", "Act I, the fall"], themes: ["Ash, salt"] });
    expect(invoke(root, ["add", "chapter", "One", "--locations", "port,dock", "--mentions", "ivo,sal", "--arcs", "tide,salt", "--characters", "mara,ivo"]).code).toBe(0);
    expect(frontmatter("chapters", "chapter-01.md")).toMatchObject({ locations: ["port", "dock"], mentions: ["ivo", "sal"], "arcs-advanced": ["tide", "salt"], characters: ["mara", "ivo"] });
    expect(invoke(root, ["add", "faction", "Guild", "--members", "mara,ivo"]).code).toBe(0);
    expect(frontmatter("worldbuilding", "factions", "guild.md").members).toEqual(["mara", "ivo"]);
    // A comma in a singular id flag is not an id, and one in --risk is not a
    // risk, so both are refused.
    for (const [argv, message] of [
      [["add", "chapter", "Two", "--character", "mara,ivo"], '--character "mara,ivo" must be a kebab-case id'],
      [["add", "chapter", "Two", "--mention", "ivo,sal"], '--mention "ivo,sal" must be a kebab-case id'],
      [["add", "chapter", "Two", "--arc", "tide,salt"], '--arc "tide,salt" must be a kebab-case id'],
      [["add", "faction", "Crew", "--member", "mara,ivo"], '--member "mara,ivo" must be a kebab-case id'],
      [["add", "research", "Tides", "--used-in", "chapter-01,chapter-02"], '--used-in "chapter-01,chapter-02" must be a kebab-case id'],
      [["add", "research", "Tides", "--risk", "legal,medical"], 'Unsupported risk "legal,medical"']
    ]) {
      const result = invoke(root, argv);
      expect(result.code).toBe(2);
      expect(result.err).toContain(message);
    }
    expect(fs.existsSync(path.join(root, "chapters", "chapter-02.md"))).toBe(false);
  });

  test("an empty --path or project path is refused, as an empty --out is (#576)", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Here"]).code).toBe(0);
    const root = path.join(cwd, "here");
    for (const argv of [["reindex", "--path", ""], ["reindex", "--path="], ["add", "character", "Mira", "--path", " "]]) {
      const result = invoke(root, argv);
      expect(result.code).toBe(2);
      expect(result.err).toBe("--path cannot be empty: give the project folder, or leave --path out to use the current directory\n");
    }
    expect(fs.existsSync(path.join(root, "characters", "mira.md"))).toBe(false);
    for (const argv of [["validate", ""], ["validate", " "]]) {
      const positional = invoke(root, argv);
      expect(positional.code).toBe(2);
      expect(positional.err).toBe("The project path cannot be empty: give the project folder, or leave it out to use the current directory\n");
    }
    // --dir, --follows, --precedes, and --against are paths too.
    const before = snapshotFiles(root);
    for (const [argv, flag] of [
      [["import", "ms.md", "--title", "T", "--dir", "", "--force"], "dir"],
      [["init", "Sequel", "--follows", ".", "--follows", ""], "follows"],
      [["init", "Prequel", "--precedes", " "], "precedes"],
      [["compare", "--against="], "against"]
    ]) {
      const result = invoke(root, argv);
      expect(result.code).toBe(2);
      expect(result.err).toBe(`--${flag} cannot be empty: give a path, or leave --${flag} out\n`);
    }
    expect(snapshotFiles(root)).toEqual(before);
    const json = invoke(root, ["check", "", "--json"]);
    expect(json.code).toBe(2);
    expect(JSON.parse(json.out).diagnostics[0].message).toContain("The project path cannot be empty");
    expect(invoke(root, ["validate"]).code).toBe(0);
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
    expect(init.code).toBe(2);
    expect(init.err).toContain("A story title is required");

    const validate = invoke(cwd, ["validate"]);
    expect(validate.code).toBe(3);
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
    expect(build.code).toBe(2);
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
    expect(failed.code).toBe(2);
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

      // A copied skill must run wherever it lands, even under a package.json
      // that declares CommonJS, so the fallback carries its own package.json.
      const install = path.join(scratch, "install");
      fs.writeFileSync(path.join(scratch, "package.json"), '{ "type": "commonjs" }\n');
      fs.cpSync(path.join(repoRoot, "skills", "story-maintenance"), path.join(install, "story-maintenance"), { recursive: true });
      const copied = spawnSync("node", [path.join(install, "story-maintenance", "scripts", "story.js"), "validate", fixture], { encoding: "utf8" });
      expect(copied.stderr).toContain("Project is valid");
      expect(copied.status).toBe(0);

      const missing = runBundle(["validate", path.join(scratch, "does-not-exist")]);
      expect(missing.status).toBe(3);
      expect(`${missing.stdout}${missing.stderr}`).toContain("is not a story project: missing story.md");
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("#66 output errors", () => {
  test("a closed pipe exits quietly and keeps the exit code", () => {
    const proc = fakeProcess(undefined);
    handleOutputError(Object.assign(new Error("write EPIPE"), { code: "EPIPE", syscall: "write" }), proc);
    expect(proc.exits).toEqual([0]);
    expect(proc.written).toEqual([]);
    const failing = fakeProcess(1);
    handleOutputError(Object.assign(new Error("write EPIPE"), { code: "EPIPE", syscall: "write" }), failing);
    expect(failing.exits).toEqual([1]);
  });

  test("another write failure is one line, and other errors keep their stack", () => {
    const proc = fakeProcess(0);
    handleOutputError(Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC", syscall: "write" }), proc);
    expect(proc.written).toEqual(["Cannot write output: no space left on the device\n"]);
    expect(proc.exits).toEqual([1]);
    const other = fakeProcess(0);
    handleOutputError(new TypeError("boom"), other);
    expect(other.written[0]).toContain("TypeError: boom");
    expect(other.exits).toEqual([1]);
  });

  test.skipIf(!fs.existsSync("/dev/full"))("writing help to a full disk prints one line, not a stack trace", () => {
    const fd = fs.openSync("/dev/full", "w");
    try {
      const result = spawnSync(process.execPath, [path.join(repoRoot, "bin", "story.js"), "--help"], { stdio: ["ignore", fd, "pipe"], encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("Cannot write output: no space left on the device\n");
    } finally {
      fs.closeSync(fd);
    }
  });
});

describe("#94 help parsing", () => {
  test("story help help prints the general usage", () => {
    const result = invoke(makeTempDir(), ["help", "help"]);
    expect(result.code).toBe(0);
    expect(result.out).toStartWith("Usage: story <command> [options]");
  });

  test("--help and --version take a boolean value", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["validate", "--help=true"]).out).toStartWith("Usage: story validate");
    expect(invoke(cwd, ["--version=1"]).out).toMatch(/^\d+\.\d+\.\d+\n$/);
    expect(parseArgs(["--help=false", "--version=no"])).toEqual({ positionals: [], options: {} });
    const bad = invoke(cwd, ["--help=maybe"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('Unknown value "maybe" for --help');
  });
});

describe("#78 project path errors", () => {
  test("pointing at story.md says to pass the folder", () => {
    const root = newProject();
    const result = invoke(root, ["validate", "story.md"]);
    expect(result.code).toBe(3);
    expect(result.err).toBe(`${path.join(root, "story.md")} is a file; pass the folder that contains it\n`);
  });

  test("a project subfolder hints at the project root", () => {
    const root = newProject();
    const result = invoke(path.join(root, "chapters"), ["report"]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("is not a story project: missing story.md (the project root looks like ");
    expect(result.err).toContain("; pass that path instead)");
    const outside = invoke(makeTempDir(), ["report"]);
    expect(outside.err).not.toContain("project root looks like");
  });
});

describe("#87 positive integer options", () => {
  test("only plain decimal integers within the safe range are accepted", () => {
    const root = newProject();
    for (const value of ["0x10", "1e21", "99999999999999999999", "2.0", "0b11", "-3", "0"]) {
      const result = invoke(root, ["add", "chapter", "Bad", "--number", value]);
      expect(result.code).toBe(2);
      expect(result.err).toContain("chapter number must be a positive integer");
    }
    expect(fs.readdirSync(path.join(root, "chapters")).filter((name) => name !== "_index.md")).toEqual([]);
    expect(invoke(root, ["add", "chapter", "Pad", "--number", " 2 "]).code).toBe(0);
    expect(invoke(root, ["add", "scene", "Hex", "--chapter", "chapter-02", "--scene", "0x2"]).err).toContain("scene number must be a positive integer");
    expect(invoke(root, ["synopsis", "--pages", "0x3"]).err).toContain("Unsupported synopsis length: 0x3");
    expect(invoke(root, ["add", "matter", "Dedication", "--order", "1e1"]).err).toContain("matter order must be a non-negative integer");
    expect(invoke(makeTempDir(), ["init", "N", "--book-number", "1e3"]).err).toContain("Book number must be 0 or a positive number");
  });
});

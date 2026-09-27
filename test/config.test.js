import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { FINDING_CODES, SEVERITY_LEVELS, applyDefaults, applySeverity, parseCliConfig, readCliConfig } from "../src/config.js";
import { OPTIONS, optionFamily } from "../src/options.js";
import { PROSE_THRESHOLDS, proseThresholds } from "../src/prose.js";
import { createStoryProject, proseReport, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv, stdin) {
  const io = memoryIo(cwd);
  if (stdin !== undefined) {
    io.readStdin = () => Buffer.from(stdin);
  }
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function project() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Configured", force: false });
  return { root, cwd };
}

// Appends lines to the end of story.md frontmatter.
function configure(root, yaml) {
  const file = path.join(root, "story.md");
  const text = fs.readFileSync(file, "utf8");
  const end = text.indexOf("\n---\n", 4);
  fs.writeFileSync(file, `${text.slice(0, end)}\n${yaml.trim()}${text.slice(end)}`, "utf8");
}

function writeChapter(root, number, fields, body) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
${fields.trim()}
`, `## Chapter Text\n\n${body}\n`);
}

// A project that raises every warning FINDING_CODES names, so each pattern is
// pinned against the text its command really writes.
function noisyProject() {
  const { root, cwd } = project();
  writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\npreferred:\n  - use: grey\n    avoid: gray", "# Style Sheet\n");
  writeMarkdown(path.join(root, "characters", "mara-quill.md"), "name: Mara Quill\nrole: protagonist\nstatus: alive\nvoice-avoid:\n  - okay", "# Mara Quill\n");
  const filler = "She felt the gray water. He saw it slowly and quietly and really suddenly. ".repeat(30);
  writeChapter(root, 1, "status: draft\nword-count: 3", [
    filler,
    "\"Okay, fine,\" Mara said.",
    "\"Go,\" he hissed. \"Now,\" she snapped. \"Why,\" he growled.",
    "[TODO check the tide]"
  ].join("\n\n"));
  writeChapter(root, 2, "status: draft\nword-count: 1\nhook: question", "Words.");
  writeMarkdown(path.join(root, "continuity", "clues", "lost-key.md"), "title: Lost Key\nstatus: paid-off\npayoff: chapter-02\ncharacters:\n  - mara-quill", "# Lost Key\n");
  writeMarkdown(path.join(root, "continuity", "clues", "wet-boots.md"), "title: Wet Boots\nstatus: paid-off\nplanted: chapter-02\npayoff: chapter-02\ncharacters:\n  - mara-quill", "# Wet Boots\n");
  return { root, cwd };
}

describe("finding codes", () => {
  test("every code matches a finding its command writes, and only its own", () => {
    const { root, cwd } = noisyProject();
    const all = Object.keys(FINDING_CODES).map((code) => `  - warning: ${code}\n    level: error`).join("\n");
    configure(root, `severity:\n${all}`);
    const seen = new Set();
    for (const command of new Set(Object.values(FINDING_CODES).map((entry) => entry.command))) {
      const result = invoke(cwd, [command, root]);
      expect(result.code).toBe(1);
      for (const line of result.err.split("\n").filter((entry) => entry.startsWith("error: "))) {
        const code = /\[([a-z-]+)\]$/.exec(line)?.[1];
        if (code !== undefined) {
          expect(FINDING_CODES[code].command).toBe(command);
          seen.add(code);
        }
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(FINDING_CODES).sort());
  });

  test("the missing word-count wording is a stale-word-count finding too", () => {
    expect(FINDING_CODES["stale-word-count"].pattern.test("chapters/chapter-01.md has no word-count (contains 12)")).toBe(true);
  });

  test("no finding matches two codes", () => {
    const samples = [
      "chapters/chapter-01.md has 2 [TODO markers in its prose, which every build prints: resolve them or move them into an HTML comment",
      "chapters/_index.md does not list chapter-02.md; run story reindex",
      "chapters/chapter-01.md declares 1 word but contains 4",
      "chapters/chapter-01.md declares -5 words but contains 4",
      "chapters/chapter-01.md has 12.5 filter words per 1,000 narration words (over 10): felt 3",
      "chapters/chapter-01.md has 13 -ly adverbs per 1,000 narration words (over 12): slowly 3",
      "chapters/chapter-01.md has 3 said-bookism dialogue tags: hissed 1",
      "chapters/chapter-01.md uses \"gray\" once; style sheet prefers \"grey\"",
      "chapter-01 has no hook: record how the chapter ending pulls the reader on",
      "clue lost-key is revealed in chapter-02 but never planted: readers cannot play fair",
      "clue wet-boots is planted in the same chapter as its reveal (chapter-02 -> chapter-02): late plant gives readers no time to notice it",
      "mara-quill says \"okay\", which is in their voice-avoid list (chapter-01)"
    ];
    for (const sample of samples) {
      expect(Object.values(FINDING_CODES).filter((entry) => entry.pattern.test(sample))).toHaveLength(1);
    }
  });

  test("the schema lists the same warning codes and levels as the validator", () => {
    const schema = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "..", "schemas", "story.schema.json"), "utf8"));
    const severity = schema.properties.story.properties.severity.items.properties;
    expect(severity.warning.enum).toEqual(Object.keys(FINDING_CODES));
    expect(severity.level.enum).toEqual(SEVERITY_LEVELS);
    const command = new RegExp(schema.properties.story.properties["cli-defaults"].items.properties.command.pattern, "u");
    expect(COMMANDS.every((entry) => command.test(entry.name))).toBe(true);
  });
});

describe("severity", () => {
  test("error promotes a warning, fails the command, and names the code", () => {
    const { root, cwd } = noisyProject();
    configure(root, "severity:\n  - warning: todo-markers\n    level: error");
    const result = invoke(cwd, ["validate", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Project validation failed: 1 errors");
    expect(result.err).toContain("error: chapters/chapter-01.md has 1 [TODO marker in its prose, which every build prints: resolve it or move it into an HTML comment [todo-markers]\n");
  });

  test("off reports the warning as dismissed, and warning keeps it as it was", () => {
    const { root, cwd } = noisyProject();
    configure(root, "severity:\n  - warning: stale-word-count\n    level: off\n  - warning: todo-markers\n    level: warning");
    const result = invoke(cwd, ["validate", root]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("dismissed: chapters/chapter-01.md declares 3 words but contains");
    expect(result.err).toContain("(severity stale-word-count is off in story.md)\n");
    expect(result.err).toContain("warning: chapters/chapter-01.md has 1 [TODO marker");
  });

  test("an override for another command's warning leaves this command alone", () => {
    const { root, cwd } = noisyProject();
    configure(root, "severity:\n  - warning: prose-adverbs\n    level: error");
    expect(invoke(cwd, ["validate", root]).code).toBe(0);
    expect(invoke(cwd, ["prose", root]).code).toBe(1);
  });

  test("applySeverity keeps continuity-style dismissals and an already failing result", () => {
    const result = { ok: false, errors: ["broken"], warnings: ["chapter-01 has no hook: record how the chapter ending pulls the reader on", "other"], dismissed: [{ finding: "x", reason: "y" }] };
    const applied = applySeverity(result, [["pacing-no-hook", "off"]]);
    expect(applied).toEqual({ ok: false, errors: ["broken"], warnings: ["other"], dismissed: [{ finding: "x", reason: "y" }, { finding: result.warnings[0], reason: "severity pacing-no-hook is off in story.md", note: "severity pacing-no-hook is off in story.md" }] });
    expect(applySeverity(result, [])).toBe(result);
  });
});

describe("cli-defaults", () => {
  test("fills in a flag the command line did not give, and the command line wins", () => {
    const { root, cwd } = noisyProject();
    configure(root, "cli-defaults:\n  - command: build\n    format: html\n  - command: prose\n    max-adverbs: 1000\n    max-filter-words: 1000\n    max-bookisms: 99");
    expect(invoke(cwd, ["build", root]).out).toContain("as html to");
    expect(invoke(cwd, ["build", root, "--format", "markdown"]).out).toContain("as markdown to");
    const prose = invoke(cwd, ["prose", root]);
    expect(prose.err).not.toContain("adverbs per 1,000");
    expect(prose.err).not.toContain("filter words per 1,000");
    expect(prose.err).not.toContain("said-bookism");
    expect(invoke(cwd, ["prose", root, "--max-adverbs", "1"]).err).toContain("adverbs per 1,000 narration words (over 1)");
  });

  test("boolean defaults take true or false, and --flag false on the command line still wins", () => {
    const { root, cwd } = project();
    configure(root, "cli-defaults:\n  - command: report\n    actionable: yes");
    expect(invoke(cwd, ["report", root]).out).toContain("Next Actions");
    expect(invoke(cwd, ["report", root, "--actionable", "false"]).out).not.toContain("Next Actions");
  });

  test("an alias on the command line overrides a default set through the other name", () => {
    const options = { themes: "a,b" };
    const config = { defaults: { add: { theme: "c" } } };
    expect(applyDefaults(config, "add", options)).toEqual([]);
    expect(options).toEqual({ themes: "a,b" });
    expect(applyDefaults(config, "build", options)).toEqual([]);
    expect(optionFamily("characters")).toEqual(["character", "characters"]);
  });

  test("a flag on the command line drops the defaults linked to it", () => {
    const { root, cwd } = noisyProject();
    configure(root, "cli-defaults:\n  - command: build\n    format: html\n    stamp: draft-2");
    expect(invoke(cwd, ["build", root]).out).toContain("as html to");
    const epub = invoke(cwd, ["build", root, "--format", "epub"]);
    expect(epub.err).toBe("");
    expect(epub.code).toBe(0);
    const options = { against: "../old" };
    expect(applyDefaults({ defaults: { compare: { ref: "main", anchor: "ch01-p1" } } }, "compare", options)).toEqual(["anchor"]);
    expect(options).toEqual({ against: "../old", anchor: "ch01-p1" });
  });

  test("an error unrelated to a default does not blame story.md", () => {
    const { root, cwd } = project();
    configure(root, "cli-defaults:\n  - command: build\n    out: dist/book.md");
    const result = invoke(cwd, ["build", root]);
    expect(result.code).toBe(3);
    expect(result.err).not.toContain("cli-defaults");
  });

  test("a bad default value says it came from story.md", () => {
    const { root, cwd } = project();
    configure(root, "cli-defaults:\n  - command: build\n    format: scroll");
    const result = invoke(cwd, ["build", root]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("Unsupported build format: scroll. Supported formats: markdown, epub, docx, shunn, html, print, narration, metadata, fountain (story.md cli-defaults set --format scroll)");
    expect(invoke(cwd, ["build", root, "--format", "scroll"]).err).not.toContain("cli-defaults");
  });

  test("commands that make a project, and projects without a readable story.md, read no config", () => {
    const cwd = makeTempDir();
    expect(readCliConfig(cwd)).toEqual({ defaults: {}, severity: {}, errors: [] });
    expect(invoke(cwd, ["init", "Fresh", "--dir", "fresh"]).code).toBe(0);
    fs.writeFileSync(path.join(cwd, "fresh", "story.md"), "no frontmatter\n", "utf8");
    expect(readCliConfig(path.join(cwd, "fresh")).errors).toEqual([]);
  });
});

describe("config validation", () => {
  const cases = [
    ["cli-defaults: build", "story.md frontmatter field cli-defaults must be a list"],
    ["cli-defaults:\n  - build", "story.md cli-defaults[0] must be a mapping, such as - command: prose"],
    ["severity:\n  - todo-markers", "story.md severity[0] must be a mapping, such as - warning: todo-markers"],
    ["cli-defaults:\n  - format: html", "story.md cli-defaults[0] must name a command"],
    ["cli-defaults:\n  - command: buld", "story.md cli-defaults[0] names unknown command buld; did you mean build?"],
    ["cli-defaults:\n  - command: init\n    genre: fantasy", "story.md cli-defaults[0] names init, which creates a project and cannot take defaults from one"],
    ["cli-defaults:\n  - command: build\n  - command: build", "story.md cli-defaults[1] repeats command build: put all its defaults in one entry"],
    ["cli-defaults:\n  - command: build\n    path: ../other", "story.md cli-defaults[0] sets path: the project is the folder story.md is in"],
    ["cli-defaults:\n  - command: prose\n    max-adverb: 3", "story.md cli-defaults[0] sets max-adverb, which story prose does not accept; did you mean max-adverbs?"],
    ["cli-defaults:\n  - command: validate\n    help: true", "story.md cli-defaults[0] sets help, which story validate does not accept"],
    ["cli-defaults:\n  - command: add\n    status: draft", "story.md cli-defaults[0] names add, which acts on one named entity and cannot take defaults"],
    ["cli-defaults:\n  - command: passes\n    start: line", "story.md cli-defaults[0] sets start, which names one target and cannot be a default"],
    ["cli-defaults:\n  - command: progress\n    date: 2026-01-01", "story.md cli-defaults[0] sets date, which names one target and cannot be a default"],
    ["cli-defaults:\n  - command: wordcount\n    write: sometimes", "story.md cli-defaults[0] write must be true or false"],
    ["cli-defaults:\n  - command: build\n    format: true", "story.md cli-defaults[0] format needs a value, such as format: name"],
    ["cli-defaults:\n  - command: build\n    format:", "story.md cli-defaults[0] format needs a value, such as format: name"],
    ["cli-defaults:\n  - command: prose\n    max-bookisms: 2.5", "story.md cli-defaults[0]: --max-bookisms must be a whole number 0 or more, such as 2"],
    ["cli-defaults:\n  - command: validate\n    json: true", "story.md cli-defaults[0] sets json, which changes the output a script reads: pass --json on the command line"],
    ["severity:\n  - level: error", "story.md severity[0] must name a warning"],
    ["severity:\n  - warning: todo-marker\n    level: error", "story.md severity[0] names unknown warning todo-marker; did you mean todo-markers?"],
    ["severity:\n  - warning: todo-markers\n    level: fatal", "story.md severity[0] level must be one of error, warning, off"],
    ["severity:\n  - warning: todo-markers\n    level: error\n    note: ci", "story.md severity[0] has note: an entry takes only warning and level"],
    ["severity:\n  - warning: todo-markers\n    level: error\n  - warning: todo-markers\n    level: off", "story.md severity[1] repeats warning todo-markers"]
  ];
  for (const [yaml, message] of cases) {
    test(message, () => {
      const { root } = project();
      configure(root, yaml);
      expect(validateProject(root).errors).toEqual([message]);
    });
  }

  test("a valid config passes validate and the schema's shape", () => {
    const { root } = project();
    configure(root, "cli-defaults:\n  - command: build\n    format: html\n    shunn: false\n  - command: synopsis\n    pages: 3\n  - command: validate\nseverity:\n  - warning: todo-markers\n    level: error");
    expect(validateProject(root).errors).toEqual([]);
  });

  test("an invalid config stops other commands but not the ones that report it", () => {
    const { root, cwd } = noisyProject();
    configure(root, "severity:\n  - warning: todo-marker\n    level: error");
    const prose = invoke(cwd, ["prose", root]);
    expect(prose.code).toBe(3);
    expect(prose.err).toBe("Fix cli-defaults or severity in story.md before running story prose (story validate lists every problem): story.md severity[0] names unknown warning todo-marker; did you mean todo-markers?\n");
    const validate = invoke(cwd, ["validate", root]);
    expect(validate.code).toBe(1);
    expect(validate.err).toContain("error: story.md severity[0] names unknown warning todo-marker");
    // The broken config is ignored rather than half applied.
    expect(validate.err).toContain("warning: chapters/chapter-01.md has 1 [TODO marker");
    expect(invoke(cwd, ["doctor", root]).code).toBe(0);
  });
});

describe("with --json and stdin", () => {
  test("a promoted warning is an error diagnostic, ok is false, and the run exits 1", () => {
    const { root, cwd } = noisyProject();
    configure(root, "severity:\n  - warning: todo-markers\n    level: error\n  - warning: stale-word-count\n    level: off");
    const result = invoke(cwd, ["validate", root, "--json"]);
    expect(result.code).toBe(1);
    const json = JSON.parse(result.out);
    expect(json.ok).toBe(false);
    const promoted = json.diagnostics.find((entry) => entry.message.endsWith("[todo-markers]"));
    expect(promoted).toMatchObject({ severity: "error", file: "chapters/chapter-01.md", code: "validate" });
    const dismissed = json.diagnostics.find((entry) => entry.message.includes("declares 3 words"));
    expect(dismissed).toMatchObject({ severity: "dismissed", exemption: "severity stale-word-count is off in story.md" });
    expect(json.data.errors).toBe(1);
  });

  test("defaults apply to --json runs, and prose reports the thresholds it used", () => {
    const { root, cwd } = noisyProject();
    configure(root, "cli-defaults:\n  - command: prose\n    max-adverbs: 1000\n    max-bookisms: 5");
    const json = JSON.parse(invoke(cwd, ["prose", root, "--json"]).out);
    expect(json.data.thresholds).toEqual({ maxFilterWords: 10, maxAdverbs: 1000, maxBookisms: 5 });
    expect(json.diagnostics.some((entry) => entry.message.includes("adverbs per 1,000"))).toBe(false);
    const flagged = JSON.parse(invoke(cwd, ["prose", root, "--json", "--max-adverbs", "0"]).out);
    expect(flagged.data.thresholds.maxAdverbs).toBe(0);
  });

  test("defaults and severity apply to a passage piped to prose - and voices -", () => {
    const { root } = noisyProject();
    configure(root, "cli-defaults:\n  - command: prose\n    max-bookisms: 0\nseverity:\n  - warning: prose-bookisms\n    level: error\n  - warning: voice-avoid\n    level: error");
    const prose = invoke(root, ["prose", "-"], "\"Go,\" he hissed.\n");
    expect(prose.code).toBe(1);
    expect(prose.err).toContain("error: stdin has 1 said-bookism dialogue tags: hissed 1 [prose-bookisms]");
    const voices = invoke(root, ["voices", "-", "--json"], "\"Okay,\" Mara said.\n");
    expect(voices.code).toBe(1);
    expect(JSON.parse(voices.out).diagnostics[0]).toMatchObject({ severity: "error", file: "stdin" });
  });

  test("an invalid config comes out as a JSON error object and exits 3", () => {
    const { root, cwd } = noisyProject();
    configure(root, "cli-defaults:\n  - command: prose\n    json: true");
    const result = invoke(cwd, ["prose", root, "--json"]);
    expect(result.code).toBe(3);
    const json = JSON.parse(result.out);
    expect(json.ok).toBe(false);
    expect(json.diagnostics[0].message).toContain("Fix cli-defaults or severity in story.md before running story prose");
  });
});

describe("prose thresholds", () => {
  test("proseThresholds reads the --max flags and refuses anything but a number 0 or more", () => {
    expect(proseThresholds()).toEqual(PROSE_THRESHOLDS);
    expect(proseThresholds({ "max-filter-words": "7.5", "max-adverbs": 0, "max-bookisms": "4" })).toMatchObject({ filterPerThousand: 7.5, adverbsPerThousand: 0, maxBookisms: 4 });
    expect(() => proseThresholds({ "max-adverbs": "-1" })).toThrow("--max-adverbs must be a number 0 or more, such as 12");
    expect(() => proseThresholds({ "max-filter-words": "lots" })).toThrow("--max-filter-words must be a number 0 or more, such as 10");
    expect(() => proseThresholds({ "max-adverbs": "9".repeat(400) })).toThrow("--max-adverbs must be a number 0 or more");
  });

  test("--max-bookisms warns only above the limit", () => {
    const { root } = noisyProject();
    expect(proseReport(root, { "max-bookisms": "3" }).warnings.join("\n")).not.toContain("said-bookism");
    expect(proseReport(root, { "max-bookisms": "2" }).warnings.join("\n")).toContain("has 3 said-bookism dialogue tags");
  });

  test("the threshold flags are prose-only options", () => {
    const names = ["max-filter-words", "max-adverbs", "max-bookisms"];
    expect(OPTIONS.filter((option) => names.includes(option.name))).toHaveLength(3);
    expect(COMMANDS.filter((command) => (command.options ?? []).some((option) => names.includes(option))).map((command) => command.name)).toEqual(["prose"]);
  });
});

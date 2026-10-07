import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { SEVERITY_LEVELS, applyDefaults, applySeverity, parseCliConfig, readCliConfig, severityCodes } from "../src/config.js";
import { warn } from "../src/findings.js";
import { OPTIONS, optionFamily } from "../src/options.js";
import { PROSE_THRESHOLDS, proseThresholds } from "../src/prose.js";
import { BUILD_EXTENSIONS } from "../src/build.js";
import { createStoryProject, proseReport, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

function invoke(cwd, argv, stdin) {
  const io = memoryIo(cwd);
  if (stdin !== undefined) {
    io.readStdin = () => Buffer.from(stdin);
  }
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// Runs `run` with these environment variables set, then puts them back.
function withEnv(env, run) {
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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

// The eleven codes story.md severity could name before every finding had a
// code, and the command that raises each. Projects already name them, so
// they keep these names.
const LEGACY_CODES = {
  "todo-markers": "validate",
  "stale-registry": "validate",
  "stale-word-count": "validate",
  "prose-filter-words": "prose",
  "prose-adverbs": "prose",
  "prose-bookisms": "prose",
  "prose-avoided-spelling": "prose",
  "pacing-no-hook": "pacing",
  "clue-unplanted": "clues",
  "clue-late-plant": "clues",
  "voice-avoid": "voices"
};

// A project that raises every warning LEGACY_CODES names.
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

// Three chapters where only chapter-02 is reached from chapter-01.
function branchingProject() {
  const { root, cwd } = project();
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", "schema-version: 2\nifid: 3F2C9A61-7B1D-4E8A-9C3B-2A6D5E4F1B07\n"));
  writeChapter(root, 1, "status: draft\nchoices:\n  - text: On\n    to: chapter-02", "Start.");
  writeChapter(root, 2, "status: draft", "Middle.");
  writeChapter(root, 3, "status: draft", "Lost.");
  return { root, cwd };
}

describe("finding codes", () => {
  test("the codes severity named before every finding had one keep their names", () => {
    const { root, cwd } = noisyProject();
    const all = Object.keys(LEGACY_CODES).map((code) => `  - warning: ${code}\n    level: error`).join("\n");
    configure(root, `severity:\n${all}`);
    const seen = new Set();
    for (const command of new Set(Object.values(LEGACY_CODES))) {
      const result = invoke(cwd, [command, root]);
      expect(result.code).toBe(1);
      for (const line of result.err.split("\n").filter((entry) => entry.startsWith("error: "))) {
        const code = /\[([a-z-]+)\]$/.exec(line)?.[1];
        if (Object.hasOwn(LEGACY_CODES, code ?? "")) {
          expect(LEGACY_CODES[code]).toBe(command);
          seen.add(code);
        }
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(LEGACY_CODES).sort());
  });

  test("a chapter with no word-count raises stale-word-count", () => {
    const { root } = project();
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nWords here.\n");
    expect(validateProject(root).warnings).toContainEqual(warn("stale-word-count", `${"chapters/chapter-01.md"} has no word-count (contains 2)`, "chapters/chapter-01.md"));
  });

  test("the schema lists the same warning codes and levels as the validator", () => {
    const schema = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "..", "schemas", "story.schema.json"), "utf8"));
    const severity = schema.properties.story.properties.severity.items.properties;
    expect(severity.warning.enum).toEqual(severityCodes());
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

  test("an override applies wherever its warning is reported: links, a build, and report", () => {
    const { root, cwd } = branchingProject();
    const unreachable = `${"chapters/chapter-03.md"} cannot be reached: no choice path from chapter-01 leads to it`;
    expect(invoke(cwd, ["links", root]).err).toContain(`warning: ${unreachable} [unreachable-chapter]\n`);

    configure(root, "severity:\n  - warning: unreachable-chapter\n    level: error");
    const links = invoke(cwd, ["links", root]);
    expect(links.code).toBe(1);
    expect(links.err).toContain(`error: ${unreachable} [unreachable-chapter]\n`);
    const build = invoke(cwd, ["build", root, "--format", "twee"]);
    expect(build.code).toBe(1);
    expect(build.out).toContain("Built 3 chapters as twee");
    expect(build.err).toContain(`error: ${unreachable} [unreachable-chapter]\n`);
    expect(invoke(cwd, ["report", root]).out).toContain("- Links: failed (1 errors, 0 warnings)\n");

    const other = branchingProject();
    configure(other.root, "severity:\n  - warning: unreachable-chapter\n    level: off");
    const quiet = invoke(other.cwd, ["links", other.root]);
    expect(quiet.code).toBe(0);
    expect(quiet.err).toContain(`dismissed: ${unreachable} (severity unreachable-chapter is off in story.md)\n`);
    const built = invoke(other.cwd, ["build", other.root, "--format", "twee"]);
    expect(built.code).toBe(0);
    expect(built.err).toContain(`dismissed: ${unreachable} (severity unreachable-chapter is off in story.md)\n`);
    expect(invoke(other.cwd, ["report", other.root]).out).toContain("- Links: ok (0 errors, 0 warnings)\n");
  });

  test("next and doctor follow an override of the word-count and scene-record warnings", () => {
    const off = project();
    writeChapter(off.root, 1, "status: draft", "Words here.");
    configure(off.root, "severity:\n  - warning: stale-word-count\n    level: off\n  - warning: no-scene-records\n    level: off");
    for (const command of ["next", "doctor"]) {
      const out = invoke(off.cwd, [command, off.root]).out;
      expect(out).not.toContain("Refresh word counts");
      expect(out).not.toContain("Add scene records");
    }
    const promoted = project();
    writeChapter(promoted.root, 1, "status: draft", "Words here.");
    configure(promoted.root, "severity:\n  - warning: stale-word-count\n    level: error");
    const out = invoke(promoted.cwd, ["next", promoted.root]).out;
    expect(out).toContain("Fix validation errors");
    expect(out).not.toContain("Refresh word counts");
    expect(out).toContain("Add scene records");
  });

  test("a promoted warning from add fails the command after the file is written", () => {
    const { root, cwd } = project();
    configure(root, "severity:\n  - warning: unknown-reference\n    level: error");
    const result = invoke(cwd, ["add", "chapter", "One", "--character", "nobody", "--path", root]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("Created chapter chapter-01");
    expect(result.err).toContain("story links reports it until you add it [unknown-reference]\n");
    expect(fs.existsSync(path.join(root, "chapters", "chapter-01.md"))).toBe(true);
  });

  test("a continuity exemption still dismisses a warning severity promotes", () => {
    const { root, cwd } = project();
    writeChapter(root, 2, "status: draft", "Words.");
    writeMarkdown(path.join(root, "continuity", "exemptions.md"), "type: exemption-log\nstory: configured\nexemptions:\n  - pattern: \"numbering starts at 2\"\n    reason: \"Prologue cut\"", "# Exemptions\n");
    configure(root, "severity:\n  - warning: chapter-numbering-start\n    level: error");
    const result = invoke(cwd, ["continuity", root]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("dismissed: Chapter numbering starts at 2, not 1 (exemption: Prologue cut)\n");
  });

  test("context --json leaves a warning severity turned off out of data.warnings", () => {
    const { root, cwd } = project();
    writeChapter(root, 1, "status: draft", "Words.");
    fs.writeFileSync(path.join(root, "style-sheet.md"), "no frontmatter", "utf8");
    configure(root, "severity:\n  - warning: context-file-skipped\n    level: off");
    const json = JSON.parse(invoke(cwd, ["context", "chapter-01", "--path", root, "--json"]).out);
    expect(json.ok).toBe(true);
    expect(json.data.warnings).toEqual([]);
    expect(json.diagnostics[0]).toMatchObject({ severity: "dismissed", code: "context-file-skipped" });
  });

  test("the deceased-without-died-in warning can be promoted", () => {
    const { root, cwd } = project();
    writeMarkdown(path.join(root, "characters", "ann.md"), "name: Ann\nrole: supporting\nstatus: alive\nprogressions:\n  - from: chapter-02\n    field: status\n    value: deceased", "# Ann\n");
    configure(root, "severity:\n  - warning: deceased-without-died-in\n    level: error");
    const result = invoke(cwd, ["validate", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("set died-in: chapter-02 too so story continuity treats appearances after the death as errors [deceased-without-died-in]\n");
  });

  test("a promoted context warning fails the command, as text and as JSON", () => {
    const { root, cwd } = project();
    writeChapter(root, 1, "status: draft", "Words.");
    fs.writeFileSync(path.join(root, "style-sheet.md"), "no frontmatter", "utf8");
    configure(root, "severity:\n  - warning: context-file-skipped\n    level: error");
    const text = invoke(cwd, ["context", "chapter-01", "--path", root]);
    expect(text.code).toBe(1);
    expect(text.err).toContain("[context-file-skipped]\n");
    const json = JSON.parse(invoke(cwd, ["context", "chapter-01", "--path", root, "--json"]).out);
    expect(json.ok).toBe(false);
    expect(json.diagnostics[0].severity).toBe("error");
  });

  test("applySeverity keeps continuity-style dismissals and an already failing result", () => {
    const hook = warn("pacing-no-hook", "chapter-01 has no hook: record how the chapter ending pulls the reader on");
    const other = warn("voice-avoid", "other");
    const result = { ok: false, errors: ["broken"], warnings: [hook, other], dismissed: [{ finding: "x", reason: "y" }] };
    const applied = applySeverity(result, { severity: [["pacing-no-hook", "off"]], exemptions: [] });
    expect(applied).toEqual({ ok: false, errors: ["broken"], warnings: [other], dismissed: [{ finding: "x", reason: "y" }, { finding: hook, reason: "severity pacing-no-hook is off in story.md", note: "severity pacing-no-hook is off in story.md" }] });
    expect(applySeverity(result, { severity: [], exemptions: [] })).toBe(result);
    expect(applySeverity(result)).toBe(result);
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

  test("boolean defaults take true or false, and --flag=false on the command line still wins", () => {
    const { root, cwd } = project();
    configure(root, "cli-defaults:\n  - command: report\n    actionable: yes");
    expect(invoke(cwd, ["report", root]).out).toContain("Next Actions");
    const off = invoke(cwd, ["report", root, "--actionable=false"]);
    expect(off.code).toBe(0);
    expect(off.out).toContain("# ");
    expect(off.out).not.toContain("Next Actions");
  });

  test("an error names a false boolean default as --flag=false", () => {
    const { root, cwd } = project();
    configure(root, "cli-defaults:\n  - command: build\n    pdf: false");
    const result = invoke(cwd, ["build", root, "--pdf-engine", "chrome"]);
    expect(result.code).toBe(2);
    expect(result.err).toBe("--pdf-engine applies only with --pdf (story.md cli-defaults set --pdf=false)\n");
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
    expect(result.err).toContain("Unsupported build format: scroll. Supported formats: markdown, epub, docx, shunn, html, print, narration, metadata, fountain, twee, ink, codex (story.md cli-defaults set --format scroll)");
    expect(invoke(cwd, ["build", root, "--format", "scroll"]).err).not.toContain("cli-defaults");
  });

  test("an error names a default only when it is about that flag, not when it quotes its value (#566)", () => {
    const { root, cwd } = project();
    configure(root, "cli-defaults:\n  - command: progress\n    weeks: 3\n  - command: context\n    scenes: \" 2 \"\n  - command: synopsis\n    pages: 2\n  - command: build\n    pdf-engine: chrome");
    // The error is about --date, given on the command line, though it quotes the 3 of the default --weeks.
    const date = invoke(cwd, ["progress", root, "--date", "3"]);
    expect(date.code).toBe(2);
    expect(date.err).toBe("progress --date date must be a real YYYY-MM-DD calendar day, got 3\n");
    // An unknown id is about no flag, whatever the value of a default.
    expect(invoke(cwd, ["context", "2", "--path", root]).err).toBe("Unknown chapter or scene 2\n");
    expect(invoke(cwd, ["context", "chapter-2", "--path", root]).err).toBe("Unknown chapter or scene chapter-2\n");
    // A usage line lists --scenes as an option, not as the flag that failed.
    expect(invoke(cwd, ["context", "--path", root]).err).toBe("Usage: story context <chapter-or-scene-id> [--budget <tokens>] [--scenes <n>] [--path <project>]\n");
    // The --format on the command line is at fault, not the default engine it happens to name.
    const format = invoke(cwd, ["build", root, "--format", "chrome"]);
    expect(format.code).toBe(2);
    expect(format.err).toBe(`Unsupported build format: chrome. Supported formats: ${Object.keys(BUILD_EXTENSIONS).join(", ")}\n`);
    expect(invoke(cwd, ["synopsis", root]).err).toBe("Unsupported synopsis length: 2. Supported pages: 1, 3 (story.md cli-defaults set --pages 2)\n");
  });

  test("an error reading or writing the path a default names says so (#566)", () => {
    const { root, cwd } = project();
    writeChapter(root, 1, "status: draft", "Words here.");
    configure(root, "cli-defaults:\n  - command: build\n    format: html\n    out: story.md/book.html\n  - command: similarity\n    against: drafts/v1\n  - command: compare\n    against: drafts/v1");
    const build = invoke(root, ["build"]);
    expect(build.code).toBe(4);
    expect(build.err).toBe("Cannot check story.md/book.html: a part of the path is not a folder (story.md cli-defaults set --out story.md/book.html)\n");
    const similarity = invoke(root, ["similarity"]);
    expect(similarity.code).toBe(2);
    expect(similarity.err).toEndWith("(story.md cli-defaults set --against drafts/v1)\n");
    const compare = invoke(root, ["compare"]);
    expect(compare.code).toBe(3);
    expect(compare.err).toEndWith("(story.md cli-defaults set --against drafts/v1)\n");
  });

  // Root ignores folder permissions, and Windows has no read-only folders.
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a default --out in a folder story cannot write to says so (#566)", () => {
    const { root, cwd } = project();
    writeChapter(root, 1, "status: draft", "Words here.");
    configure(root, "cli-defaults:\n  - command: export\n    out: locked/book.md");
    const locked = path.join(root, "locked");
    fs.mkdirSync(locked);
    fs.chmodSync(locked, 0o555);
    try {
      const result = invoke(root, ["export"]);
      expect(result.code).toBe(4);
      expect(result.err).toBe("Cannot write to locked/book.md: permission denied (story.md cli-defaults set --out locked/book.md)\n");
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });

  test("a PDF engine error names the default --pdf or --pdf-engine it is about (#566)", () => {
    const { root, cwd } = project();
    writeChapter(root, 1, "status: draft", "Words here.");
    configure(root, "cli-defaults:\n  - command: build\n    format: print\n    pdf: true");
    const noEngines = { PATH: makeTempDir(), ProgramFiles: "", "ProgramFiles(x86)": "", LOCALAPPDATA: "" };
    // The engine on the command line is at fault, not the default --pdf or --format print.
    const unknown = withEnv(noEngines, () => invoke(cwd, ["build", root, "--pdf-engine", "nonsense"]));
    expect(unknown.code).toBe(2);
    expect(unknown.err).toStartWith("Unknown PDF engine: nonsense. Name one of");
    expect(unknown.err).not.toContain("cli-defaults");
    // Chrome in /Applications on macOS (as on CI runners) would count as an engine.
    if (process.platform !== "darwin") {
      const none = withEnv(noEngines, () => invoke(cwd, ["build", root]));
      expect(none.code).toBe(4);
      expect(none.err).toStartWith("No PDF engine found on PATH");
      expect(none.err).toEndWith("(story.md cli-defaults set --pdf)\n");
    }
    const storyFile = path.join(root, "story.md");
    fs.writeFileSync(storyFile, fs.readFileSync(storyFile, "utf8").replace("    pdf: true\n", "    pdf: true\n    pdf-engine: weasyprint\n"), "utf8");
    const missing = withEnv(noEngines, () => invoke(cwd, ["build", root]));
    expect(missing.code).toBe(4);
    expect(missing.err).toStartWith("PDF engine weasyprint was not found on PATH");
    expect(missing.err).toEndWith("(story.md cli-defaults set --pdf-engine weasyprint)\n");
  });

  test("defaults of one linked group all apply, unless the command line gives one (#566)", () => {
    const options = {};
    expect(applyDefaults({ defaults: { build: { format: "html", stamp: "draft-2" } } }, "build", options)).toEqual(["format", "stamp"]);
    expect(options).toEqual({ format: "html", stamp: "draft-2" });
    const { root, cwd } = noisyProject();
    configure(root, "cli-defaults:\n  - command: build\n    format: html\n    stamp: draft-2");
    expect(invoke(cwd, ["build", root]).code).toBe(0);
    expect(fs.readFileSync(path.join(root, "dist", "configured.html"), "utf8")).toContain("draft-2");
  });

  test("a huge default value or error message is handled in linear time (#566)", () => {
    const { root, cwd } = project();
    // The value of a default once went into a regular expression, which V8 refuses above about 32,000 characters.
    configure(root, `cli-defaults:\n  - command: grid\n    format: ${"x".repeat(40000)}`);
    const grid = invoke(cwd, ["grid", root, "--json"]);
    expect(grid.code).toBe(2);
    expect(JSON.parse(grid.out).diagnostics[0].message).toEndWith(`(story.md cli-defaults set --format ${"x".repeat(40000)})`);
    // An error message holding user text is not searched, so many unclosed [-- cost nothing.
    const where = "[-- ".repeat(100000);
    const started = performance.now();
    const list = invoke(cwd, ["list", "chapters", "--where", where, "--path", root]);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(list.code).toBe(2);
    expect(list.err).toStartWith("Cannot read --where [-- [-- ");
  });

  test("split and merge take no defaults, so split without --at fails rather than splits at one (#566)", () => {
    const { root, cwd } = project();
    // A scene break 1 to split at, so a default --at would be used if it were read.
    writeChapter(root, 1, "status: draft", "One.\n\n***\n\nTwo.");
    writeChapter(root, 2, "status: draft", "Three.");
    expect(invoke(cwd, ["reindex", root]).code).toBe(0);
    const chapter = path.join(root, "chapters", "chapter-01.md");
    const before = fs.readFileSync(chapter, "utf8");
    configure(root, "cli-defaults:\n  - command: split\n    at: 1");
    const split = invoke(cwd, ["split", "chapter-01", "--path", root]);
    expect(split.code).toBe(3);
    expect(split.err).toBe("Fix cli-defaults or severity in story.md before running story split (story validate lists every problem): story.md cli-defaults[0] names split, which acts on named entities and cannot take defaults\n");
    expect(fs.readFileSync(chapter, "utf8")).toBe(before);
    expect(fs.existsSync(path.join(root, "chapters", "chapter-03.md"))).toBe(false);
  });

  test("commands that make a project, and projects without a readable story.md, read no config", () => {
    const cwd = makeTempDir();
    expect(readCliConfig(cwd)).toEqual({ defaults: {}, severity: {}, exemptions: [], errors: [] });
    expect(invoke(cwd, ["init", "Fresh", "--dir", "fresh"]).code).toBe(0);
    fs.writeFileSync(path.join(cwd, "fresh", "story.md"), "no frontmatter\n", "utf8");
    expect(messages(readCliConfig(path.join(cwd, "fresh")).errors)).toEqual([]);
  });

  test.skipIf(process.platform === "win32")("a symlinked story.md gives no config, and one linked to /dev/zero does not hang the command (#548)", () => {
    const { root } = project();
    const storyPath = path.join(root, "story.md");
    // A story.md elsewhere whose defaults would otherwise apply.
    const outside = path.join(makeTempDir(), "story.md");
    fs.copyFileSync(storyPath, outside);
    configure(path.dirname(outside), "cli-defaults:\n  - command: prose\n    max-adverbs: 8");
    fs.rmSync(storyPath);
    fs.symlinkSync(outside, storyPath);
    expect(readCliConfig(root)).toEqual({ defaults: {}, severity: {}, exemptions: [], errors: [] });
    // Every project command reads the config first. Run in a child, so a
    // read that never ends fails the test rather than stalling the suite.
    fs.rmSync(storyPath);
    fs.symlinkSync("/dev/zero", storyPath);
    const result = spawnSync(process.execPath, [path.join(import.meta.dir, "..", "bin", "story.js"), "validate", root], { encoding: "utf8", timeout: 20000 });
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("story.md: Refusing to read through symlink");
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
    ["cli-defaults:\n  - command: add\n    status: draft", "story.md cli-defaults[0] names add, which acts on named entities and cannot take defaults"],
    ["cli-defaults:\n  - command: split\n    at: 1", "story.md cli-defaults[0] names split, which acts on named entities and cannot take defaults"],
    ["cli-defaults:\n  - command: merge", "story.md cli-defaults[0] names merge, which acts on named entities and cannot take defaults"],
    ["cli-defaults:\n  - command: passes\n    start: line", "story.md cli-defaults[0] sets start, which names one target and cannot be a default"],
    ["cli-defaults:\n  - command: progress\n    date: 2026-01-01", "story.md cli-defaults[0] sets date, which names one target and cannot be a default"],
    ["cli-defaults:\n  - command: snapshot\n    force: true", "story.md cli-defaults[0] sets force, which belongs to one run: pass --force on the command line"],
    ["cli-defaults:\n  - command: snapshot\n    list: true", "story.md cli-defaults[0] sets list, which belongs to one run: pass --list on the command line"],
    ["cli-defaults:\n  - command: wordcount\n    write: sometimes", "story.md cli-defaults[0] write must be true or false"],
    ["cli-defaults:\n  - command: build\n    format: true", "story.md cli-defaults[0] format needs a value, such as format: name"],
    ["cli-defaults:\n  - command: build\n    format:", "story.md cli-defaults[0] format needs a value, such as format: name"],
    ["cli-defaults:\n  - command: prose\n    max-bookisms: 2.5", "story.md cli-defaults[0]: --max-bookisms must be a whole number 0 or more, such as 2"],
    ["cli-defaults:\n  - command: validate\n    json: true", "story.md cli-defaults[0] sets json, which changes the output a script reads: pass --json on the command line"],
    ["severity:\n  - level: error", "story.md severity[0] must name a warning"],
    ["severity:\n  - warning: todo-marker\n    level: error", "story.md severity[0] names unknown warning todo-marker; did you mean todo-markers?"],
    ["severity:\n  - warning: name-clash\n    level: off", "story.md severity[0] names name-clash, which is an error: severity changes only warnings"],
    ["severity:\n  - warning: unsplit-chapter-lines\n    level: error", "story.md severity[0] names unsplit-chapter-lines, which story init or story import reports before there is a story.md to read: severity cannot change it"],
    ["severity:\n  - warning: todo-markers\n    level: fatal", "story.md severity[0] level must be one of error, warning, off"],
    ["severity:\n  - warning: todo-markers\n    level: error\n    note: ci", "story.md severity[0] has note: an entry takes only warning and level"],
    ["severity:\n  - warning: todo-markers\n    level: error\n  - warning: todo-markers\n    level: off", "story.md severity[1] repeats warning todo-markers"]
  ];
  for (const [yaml, message] of cases) {
    test(message, () => {
      const { root } = project();
      configure(root, yaml);
      expect(messages(validateProject(root).errors)).toEqual([message]);
    });
  }

  test("a valid config passes validate and the schema's shape", () => {
    const { root } = project();
    configure(root, "cli-defaults:\n  - command: build\n    format: html\n    shunn: false\n  - command: synopsis\n    pages: 3\n  - command: validate\nseverity:\n  - warning: todo-markers\n    level: error");
    expect(messages(validateProject(root).errors)).toEqual([]);
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
    expect(invoke(cwd, ["report", root]).code).toBe(0);
    expect(invoke(cwd, ["next", root]).code).toBe(0);
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
    const promoted = json.diagnostics.find((entry) => entry.message.includes("[TODO marker"));
    expect(promoted).toMatchObject({ severity: "error", file: "chapters/chapter-01.md", code: "todo-markers", check: "validate" });
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
    expect(messages(proseReport(root, { "max-bookisms": "3" }).warnings).join("\n")).not.toContain("said-bookism");
    expect(messages(proseReport(root, { "max-bookisms": "2" }).warnings).join("\n")).toContain("has 3 said-bookism dialogue tags");
  });

  test("the threshold flags are prose-only options", () => {
    const names = ["max-filter-words", "max-adverbs", "max-bookisms"];
    expect(OPTIONS.filter((option) => names.includes(option.name))).toHaveLength(3);
    expect(COMMANDS.filter((command) => (command.options ?? []).some((option) => names.includes(option))).map((command) => command.name)).toEqual(["prose"]);
  });
});

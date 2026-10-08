import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkProjectSchema } from "../scripts/check-schema.js";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { buildBook, createEntity, createStoryProject, validateLinks, validateProject } from "../src/story.js";
import { CHMOD_IGNORED, makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

function newProject(title = "Gull") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(repoRoot, "examples");

function bugsProject(title = "Bugs") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function copyExample(name) {
  const target = path.join(makeTempDir(), name);
  fs.cpSync(path.join(examplesRoot, name), target, { recursive: true });
  return target;
}

function editFile(file, edit) {
  fs.writeFileSync(file, edit(fs.readFileSync(file, "utf8")), "utf8");
}

function analysisProject(title = "Analysis", cwd = makeTempDir()) {
  return createStoryProject({ cwd, title }).root;
}

function project(title = "Open Issues") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title, force: false });
  return { cwd, root };
}

function writeChapter(root, number, body, extra = "status: draft") {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Chapter ${number}\nnumber: ${number}\n${extra}`, `## Chapter Text\n\n${body}\n`);
}

function reviewProject(fields = "") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Fixes", force: false });
  if (fields !== "") {
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\n${fields}\n`), "utf8");
  }
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nWords.\n");
  return { root, cwd };
}

function gapProject(title = "Gap Story") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

function writeStory(root, update) {
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, update(fs.readFileSync(storyPath, "utf8")), "utf8");
}

function safetyProject(title = "Safety") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("#112 scheduled chapters in arc bodies", () => {
  test("a planned plot point may name a chapter not yet written", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const arc = createEntity(root, { kind: "arc", name: "Main", type: "main" });
    fs.appendFileSync(arc.file, "\n| 1 | Harry sees the lights | act-3 | chapter-09 | planned | |\n");
    expect(messages(validateLinks(root).errors)).toEqual([]);
    fs.appendFileSync(arc.file, "\nA typo: chapter-1 and chapter-00.\n");
    expect(messages(validateLinks(root).errors)).toEqual([
      "plot/arcs/main.md references missing chapter chapter-1",
      "plot/arcs/main.md references missing chapter chapter-00"
    ]);
  });

  test("the timeline still needs chapters that exist", () => {
    const root = newProject();
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), "\n- chapter-09: the lights\n");
    expect(messages(validateLinks(root).errors)).toEqual(["plot/timeline.md references missing chapter chapter-09"]);
  });
});

describe("#128 missing registry link warning names the file", () => {
  test("the warning names the unlisted file and the fix", () => {
    const root = bugsProject();
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "\n## Chapter Text\n\nShe climbed.\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "harbor.md"), "name: Harbor\ntype: city\nstatus: active", "# Harbor\n");
    const warnings = messages(validateProject(root).warnings);
    expect(warnings).toContain("chapters/_index.md does not list chapters/chapter-01.md; run story reindex");
    expect(warnings).toContain("worldbuilding/_index.md does not list worldbuilding/locations/harbor.md; run story reindex");
  });
});

describe("#132 validate rejects non-string text fields", () => {
  test("a numeric title or name is an error that says to quote it", () => {
    const root = copyExample("the-last-ember");
    editFile(path.join(root, "chapters", "chapter-01.md"), (text) => text.replace(/^title: .*$/m, "title: 1984"));
    editFile(path.join(root, "characters", "kael-voss.md"), (text) => text.replace(/^name: .*$/m, "name: 7"));
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain('chapters/chapter-01.md frontmatter field title must be text: quote it as title: "1984"');
    expect(errors).toContain('characters/kael-voss.md frontmatter field name must be text: quote it as name: "7"');
  });

  test("the quote hint spells the value as the file does", () => {
    const root = copyExample("the-last-ember");
    editFile(path.join(root, "chapters", "chapter-01.md"), (text) => text.replace(/^title: .*$/m, "title: True # draft"));
    editFile(path.join(root, "characters", "kael-voss.md"), (text) => text.replace(/^name: .*$/m, "name: 007"));
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain('chapters/chapter-01.md frontmatter field title must be text: quote it as title: "True"');
    expect(errors).toContain('characters/kael-voss.md frontmatter field name must be text: quote it as name: "007"');
  });

  test("a numeric or list pronunciation gets one error, not one from each pronunciation check", () => {
    const root = copyExample("the-last-ember");
    editFile(path.join(root, "characters", "kael-voss.md"), (text) => text.replace(/^name: .*$/m, "name: \"Kael Voss\"\npronunciation: 42"));
    editFile(path.join(root, "glossary", "terms", "ember-burn.md"), (text) => text.replace(/^(term: .*)$/m, "$1\npronunciation:\n  - one\n  - two"));
    const errors = validateProject(root).errors.map((error) => error.message).filter((message) => message.includes("pronunciation"));
    expect(errors.sort()).toEqual([
      'characters/kael-voss.md frontmatter field pronunciation must be text: quote it as pronunciation: "42"',
      "glossary/terms/ember-burn.md frontmatter field pronunciation must be text"
    ].sort());
  });

  test("a true or false pronunciation gets one error, quoted as the file should write it", () => {
    const root = copyExample("the-last-ember");
    editFile(path.join(root, "characters", "kael-voss.md"), (text) => text.replace(/^name: .*$/m, "name: \"Kael Voss\"\npronunciation: true"));
    const errors = validateProject(root).errors.map((error) => error.message).filter((message) => message.includes("pronunciation"));
    expect(errors).toEqual(['characters/kael-voss.md frontmatter field pronunciation must be text: quote it as pronunciation: "true"']);
  });

  test("validate fails wherever the schema rejects a number in a text field", () => {
    const root = copyExample("the-last-ember");
    const files = ["story.md", "chapters/chapter-01.md", "characters/kael-voss.md", "worldbuilding/locations/ashen-citadel.md", "glossary/terms/ember-sight.md"]
      .filter((file) => fs.existsSync(path.join(root, file)));
    const mismatches = [];
    for (const file of files) {
      const fullPath = path.join(root, file);
      const original = fs.readFileSync(fullPath, "utf8");
      const keys = Object.entries(parseFrontmatter(original).data)
        .filter(([, value]) => typeof value === "string")
        .map(([key]) => key);
      for (const key of keys) {
        fs.writeFileSync(fullPath, original.replace(new RegExp(`^${key}: .*$`, "m"), `${key}: 7`), "utf8");
        const schemaRejects = checkProjectSchema(root).some((error) => error.includes("expected string, got integer"));
        if (schemaRejects && validateProject(root).ok) {
          mismatches.push(`${file} ${key}`);
        }
      }
      fs.writeFileSync(fullPath, original, "utf8");
    }
    expect(mismatches).toEqual([]);
  });

  test("a numeric population is allowed by both", () => {
    const root = copyExample("the-last-ember");
    editFile(path.join(root, "worldbuilding", "locations", "ashen-citadel.md"), (text) => text.replace(/^population: .*$/m, "population: 12000"));
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(checkProjectSchema(root)).toEqual([]);
  });
});

describe("rounding and plurals elsewhere (#216)", () => {
  test("validate says a chapter has no word-count instead of declaring 0", () => {
    const root = analysisProject();
    fs.writeFileSync(path.join(root, "chapters", "chapter-01.md"), "---\ntitle: One\nnumber: 1\nstatus: draft\n---\n## Chapter Text\n\nOne two three.\n", "utf8");
    expect(messages(validateProject(root).warnings)).toContain("chapters/chapter-01.md has no word-count (contains 3)");
  });
});

describe("#133 [TODO markers in chapter prose", () => {
  test("validate warns and the metadata checklist names the chapter; comments do not count", () => {
    const { root } = project("Gull");
    writeChapter(root, 1, "A boy called Harry Rowe [TODO: check bible] came.\n\n<!-- [TODO: fine here] -->");
    writeChapter(root, 2, "Clean prose.\n\n<!-- [TODO: only a note] -->");
    const report = validateProject(root);
    const todo = messages(report.warnings).filter((warning) => warning.includes("[TODO"));
    expect(todo).toEqual([`${"chapters/chapter-01.md"} has 1 [TODO marker in its prose, which every build prints: resolve it or move it into an HTML comment`]);

    const { outFile } = buildBook(root, { format: "metadata" });
    const sheet = fs.readFileSync(outFile, "utf8");
    expect(sheet).toContain("- [ ] No `[TODO` markers in chapter prose (found in: chapter-01)");

    writeChapter(root, 1, "A boy called Harry Rowe came.");
    expect(fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8")).toContain("- [x] No `[TODO` markers in chapter prose\n");
  });
});

describe("review fixes", () => {
  test("a non-text author is a validation error", () => {
    const { root } = reviewProject("author: 123");
    expect(messages(validateProject(root).errors)).toContain("story.md frontmatter field author must be text");
  });
});

describe("story.md validation", () => {
  test("an older schema-version is reported", () => {
    const root = gapProject();
    writeStory(root, (text) => text.replace(/schema-version: \d+/, "schema-version: 1"));
    expect(messages(validateProject(root).errors)).toContain("story.md schema-version must be 2");
  });

  test("a cover that is a directory is not a file", () => {
    const root = gapProject();
    fs.mkdirSync(path.join(root, "cover.png"));
    writeStory(root, (text) => text.replace(/^---\n/, "---\ncover: cover.png\n"));
    expect(messages(validateProject(root).errors)).toContain("story.md cover cover.png is not a file");
  });
});

describe("unreadable files name their path once (#383)", () => {
  test("validate names a non-UTF-8, oversized, unreadable, or symlinked file once", () => {
    const root = safetyProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    createEntity(root, { kind: "character", name: "Mara" });
    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), Buffer.from([0xff]));
    fs.appendFileSync(path.join(root, "characters", "_index.md"), Buffer.from([0xff]));
    fs.writeFileSync(path.join(root, "chapters", "chapter-02.md"), "a".repeat(5 * 1024 * 1024 + 1));
    fs.symlinkSync(path.join(root, "story.md"), path.join(root, "continuity", "exemptions.md"));
    if (!CHMOD_IGNORED) {
      fs.chmodSync(path.join(root, "characters", "mara.md"), 0o000);
    }
    const errors = messages(validateProject(root).errors);
    for (const error of errors) {
      const [label] = error.split(": ");
      expect(error.slice(label.length)).not.toContain(label);
      expect(error).not.toContain(root);
    }
    expect(errors).toContain(`${"chapters/chapter-01.md"}: is not valid UTF-8 (byte 0xff at offset ${fs.statSync(path.join(root, "chapters", "chapter-01.md")).size - 1}): re-save it as UTF-8`);
    expect(errors).toContain(`${"chapters/chapter-02.md"}: Refusing to read oversized file: ${5 * 1024 * 1024 + 1} bytes exceeds the ${5 * 1024 * 1024} byte limit`);
    expect(errors).toContain(`${"continuity/exemptions.md"}: Refusing to read through symlink`);
    expect(errors.filter((error) => error.startsWith(`${"characters/_index.md"}: is not valid UTF-8`))).toHaveLength(1);
    if (!CHMOD_IGNORED) {
      expect(errors).toContain(`${"characters/mara.md"}: Cannot read: permission denied`);
    }
  });

  test("an unreadable optional registry or timeline is reported once", () => {
    const root = safetyProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), Buffer.from([0xff]));
    fs.mkdirSync(path.join(root, "matter"));
    fs.writeFileSync(path.join(root, "matter", "_index.md"), Buffer.from([0x2d, 0xff]));
    fs.mkdirSync(path.join(root, "research"));
    fs.symlinkSync(path.join(root, "story.md"), path.join(root, "research", "_index.md"));
    const once = (errors, label) => errors.filter((error) => error.startsWith(`${label}: `));
    const errors = messages(validateProject(root).errors);
    expect(once(errors, "plot/timeline.md")).toHaveLength(1);
    expect(once(errors, "matter/_index.md")).toEqual([`${"matter/_index.md"}: is not valid UTF-8 (byte 0xff at offset 1): re-save it as UTF-8 (it is a registry: run story reindex to rebuild it)`]);
    expect(once(errors, "research/_index.md")).toEqual([`${"research/_index.md"}: Refusing to read through symlink (it is a registry: run story reindex to rebuild it)`]);
    expect(once(messages(validateLinks(root).errors), "plot/timeline.md")).toHaveLength(1);
  });
});

describe("project structure", () => {
  test("a fresh project validates after a git round trip drops its empty folders", () => {
    const root = sweepProject();
    for (const dir of ["worldbuilding/locations", "worldbuilding/systems", "plot/arcs", "glossary/terms"]) {
      fs.rmSync(path.join(root, dir), { recursive: true });
    }
    expect(messages(validateProject(root).errors)).toEqual([]);
    createEntity(root, { kind: "location", name: "Port" });
    expect(fs.existsSync(path.join(root, "worldbuilding", "locations", "port.md"))).toBe(true);
  });

  test("validate outside a project says so instead of listing every path", () => {
    const result = invoke(makeTempDir(), ["validate"]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("is not a story project: missing story.md");
    expect(result.err).not.toContain("Missing required path");
  });
});

describe("continuity ledger", () => {
  test("links accept promise and clue chapters scheduled past the last chapter", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "clue", name: "Locket", planted: "chapter-01", payoff: "chapter-05" });
    createEntity(root, { kind: "promise", name: "Duel", planted: "chapter-04", status: "planned" });
    expect(messages(validateLinks(root).errors)).toEqual([]);
    // A planted status needs the chapter written, so add refuses it (#68).
    expect(() => createEntity(root, { kind: "clue", name: "Ring", planted: "chapter-04", status: "planted" })).toThrow("--planted chapter-04 is not written yet");
  });
});

describe("sweep fixes", () => {
  test("links accept scheduled chapters below a later outline chapter", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "clue", name: "Locket", planted: "chapter-01", payoff: "chapter-09" });
    createEntity(root, { kind: "promise", name: "Duel", planted: "chapter-07", status: "planned", payoff: "chapter-12" });
    createEntity(root, { kind: "chapter", name: "Finale", number: 20 });
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });

  test("links reject chapter-id typos that scheduling would hide", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    expect(() => createEntity(root, { kind: "clue", name: "Locket", planted: "chapter-01", payoff: "chapter-1" })).toThrow("--payoff chapter-1: did you mean chapter-01?");
    expect(() => createEntity(root, { kind: "clue", name: "Zero", planted: "chapter-01", payoff: "chapter-00" })).toThrow("--payoff chapter-00: chapter numbers start at 1");
    // links catches the same typos written by hand.
    writeMarkdown(path.join(root, "continuity", "clues", "locket.md"), "title: Locket\nstatus: planted\nplanted: chapter-01\npayoff: chapter-1");
    writeMarkdown(path.join(root, "continuity", "clues", "zero.md"), "title: Zero\nstatus: planted\nplanted: chapter-01\npayoff: chapter-00");
    createEntity(root, { kind: "clue", name: "Later", planted: "chapter-01", payoff: "chapter-09" });
    const errors = messages(validateLinks(root).errors);
    expect(errors).toContain("continuity/clues/locket.md references missing chapter chapter-1");
    expect(errors).toContain("continuity/clues/zero.md references missing chapter chapter-00");
    expect(errors.join("\n")).not.toContain("chapter-09");
  });

  test("a question may be introduced in a chapter not written yet", () => {
    const root = sweepProject();
    createEntity(root, { kind: "question", name: "Who", introduced: "chapter-02" });
    expect(messages(validateLinks(root).errors)).toEqual([]);
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    // A resolved chapter must exist, so add refuses it (#68).
    expect(() => createEntity(root, { kind: "question", name: "Why", introduced: "chapter-01", resolved: "chapter-04" })).toThrow("--resolved chapter-04 is not written yet");
  });

  test("pre-0.10.0 relationship pairs warn instead of failing links", () => {
    const root = sweepProject();
    writeMarkdown(path.join(root, "characters", "ilya.md"), "name: Ilya\nrole: antagonist\nstatus: alive\nrelationships:\n  - character: theo\n    type: former-supervisor\n  - character: mara\n    type: adversary");
    writeMarkdown(path.join(root, "characters", "theo.md"), "name: Theo\nrole: supporting\nstatus: alive\nrelationships:\n  - character: ilya\n    type: former-supervisor");
    writeMarkdown(path.join(root, "characters", "mara.md"), "name: Mara\nrole: protagonist\nstatus: alive\nrelationships:\n  - character: ilya\n    type: antagonist");
    const result = validateLinks(root);
    expect(messages(result.errors)).toEqual([]);
    expect(messages(result.warnings)).toContain("characters/ilya.md relationship adversary to mara has backlink antagonist, a pairing from before story-skills 0.10.0; change the backlink to adversary");
    expect(messages(result.warnings).filter((warning) => warning.includes("change the backlink to former-subordinate"))).toHaveLength(2);
  });

  test("parse errors name files by their project path only", () => {
    const root = sweepProject();
    fs.writeFileSync(path.join(root, "progress.md"), "no frontmatter\n");
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain("progress.md: is missing YAML frontmatter");
    expect(errors.join("\n")).not.toContain(root);
  });

  test("an unreadable story.md is reported once", () => {
    const root = sweepProject();
    fs.writeFileSync(path.join(root, "story.md"), "no frontmatter\n");
    expect(messages(validateProject(root).errors)).toEqual(["story.md: is missing YAML frontmatter"]);
  });

  test("validate reports a bad word count and a list status plainly", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("word-count: 0", "word-count: many").replace("status: outline", "status:\n  - draft"));
    let result = validateProject(root);
    expect(messages(result.warnings).join("\n")).not.toContain("NaN");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("word-count: many", "word-count: many\nhook:\n  - cliffhanger"));
    expect(messages(validateProject(root).errors)).toContain("chapters/chapter-01.md frontmatter field hook must be a single value, not a list");
    // One error for the list, not two.
    result = validateProject(root);
    expect(messages(result.errors).filter((error) => error.includes("field status"))).toEqual(["chapters/chapter-01.md frontmatter field status must be a scalar"]);
  });

  test("an untitled story.md does not set off registry story errors", () => {
    const root = sweepProject();
    fs.writeFileSync(path.join(root, "story.md"), "---\nfoo: bar\n---\n");
    expect(messages(validateProject(root).errors).join("\n")).not.toContain("story must be");
  });

  test("links rejects a pov that is a name, not an id", () => {
    const root = sweepProject();
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft\npov: Mara Quill");
    expect(messages(validateLinks(root).errors).join("\n")).toContain("must be kebab-case");
  });
});

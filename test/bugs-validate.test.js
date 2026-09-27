import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import { parseFrontmatter, replaceFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";
import { kebabCase } from "../src/markdown.js";
import {
  checkProjectContinuity,
  createEntity,
  createStoryProject,
  migrateProject,
  namesReport,
  reindexProject,
  renameEntity,
  scanProject,
  validateProject
} from "../src/story.js";
import { checkProjectSchema } from "../scripts/check-schema.js";
import { staleRegistries } from "../scripts/check-examples.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(repoRoot, "examples");

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function newProject(title = "Bugs") {
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

describe("#57 migrate creates plot/timeline.md", () => {
  test("a project missing the timeline validates after one migrate", () => {
    const root = copyExample("the-unraveled-thread");
    fs.rmSync(path.join(root, "plot", "timeline.md"));
    expect(messages(validateProject(root).errors)).toContain("Missing required path: plot/timeline.md (story migrate adds missing registries)");
    const result = migrateProject(root);
    expect(result.changed).toContain(path.join(root, "plot", "timeline.md"));
    expect(parseFrontmatter(fs.readFileSync(path.join(root, "plot", "timeline.md"), "utf8")).data.type).toBe("timeline");
    expect(messages(validateProject(root).errors).filter((error) => error.startsWith("Missing required path"))).toEqual([]);
  });
});

describe("#64 registry cells escape pipes and names are one line", () => {
  test("a | in a name or title is escaped in its registry row", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Ann | Bee" });
    createEntity(root, { kind: "chapter", name: "Either | Or" });
    const characters = fs.readFileSync(path.join(root, "characters", "_index.md"), "utf8");
    const chapters = fs.readFileSync(path.join(root, "chapters", "_index.md"), "utf8");
    expect(characters).toContain("| Ann \\| Bee | supporting | alive | [ann-bee](ann-bee.md) |");
    expect(chapters).toContain("| 1 | Either \\| Or |  | outline | 0 | [chapter-01](chapter-01.md) |");
  });

  test("a hand-written multi-line title stays on one registry row", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Plain" });
    editFile(path.join(root, "characters", "plain.md"), (text) => text.replace("name: Plain", 'name: "New\\nLine"'));
    reindexProject(root);
    expect(fs.readFileSync(path.join(root, "characters", "_index.md"), "utf8")).toContain("| New Line | supporting | alive | [plain](plain.md) |");
  });

  test("add and rename refuse a name with a line break", () => {
    const root = newProject();
    expect(() => createEntity(root, { kind: "character", name: "New\nLine" })).toThrow("A character name must be a single line");
    createEntity(root, { kind: "character", name: "Mara" });
    expect(() => renameEntity(root, { kind: "character", id: "mara", name: "Ma\nra" })).toThrow("A character name must be a single line");
  });
});

describe("#65 reindex keeps registry frontmatter it does not own", () => {
  test("unknown keys and comments survive reindex, add, and CRLF registries", () => {
    const root = newProject();
    const index = path.join(root, "characters", "_index.md");
    editFile(index, (text) => text.replace(/^story: .*$/m, "$&\n# owner: dan\ncustom: keep"));
    reindexProject(root);
    createEntity(root, { kind: "character", name: "Mara" });
    const text = fs.readFileSync(index, "utf8");
    expect(text).toContain("# owner: dan\ncustom: keep\n");
    expect(text).toContain("[mara](mara.md)");
    expect(reindexProject(root).changed).toEqual([]);

    const chapters = path.join(root, "chapters", "_index.md");
    editFile(chapters, (text) => text.replace("story: bugs", "story: stale\nextra: 1").replace(/\n/g, "\r\n"));
    reindexProject(root);
    const crlf = fs.readFileSync(chapters, "utf8");
    expect(crlf).toContain("type: chapter-registry\r\nstory: bugs\r\nextra: 1\r\n---\r\n");
    expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");
  });
});

describe("#71 ids and names fold Latin letters without decompositions", () => {
  test("kebabCase transliterates special Latin letters", () => {
    expect(["Æthelred", "Łukasz Nowak", "Søren", "Straße", "Đorđe", "Þórr", "Œuvre", "Zoë"].map(kebabCase))
      .toEqual(["aethelred", "lukasz-nowak", "soren", "strasse", "dorde", "thorr", "oeuvre", "zoe"]);
  });

  test("story add derives the folded id", () => {
    const root = newProject();
    expect(createEntity(root, { kind: "character", name: "Łukasz Nowak" }).id).toBe("lukasz-nowak");
    expect(createEntity(root, { kind: "character", name: "Søren" }).id).toBe("soren");
  });

  test("story names treats Lukasz and Łukasz as the same name", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Łukasz Nowak" });
    createEntity(root, { kind: "character", name: "Søren" });
    const report = namesReport(root, ["Lukasz", "Soren"]);
    expect(messages(report.errors)).toEqual([
      "\"Lukasz\" clashes with character lukasz-nowak (Łukasz)",
      "\"Soren\" clashes with character soren (Søren)"
    ]);
  });
});

describe("#75 migrate on a broken or newer story.md", () => {
  test("an unparseable story.md is reported by name", () => {
    const root = newProject();
    editFile(path.join(root, "story.md"), (text) => text.replace("---\n", "---\ntitle: dup\n"));
    expect(() => migrateProject(root)).toThrow("Cannot migrate: fix this file first (story validate reports it):\n- story.md: Duplicate frontmatter key: title");
  });

  test("a newer schema-version is refused, not downgraded", () => {
    const root = newProject();
    const storyPath = path.join(root, "story.md");
    editFile(storyPath, (text) => text.replace("schema-version: 2", "schema-version: 3"));
    const before = fs.readFileSync(storyPath, "utf8");
    expect(() => migrateProject(root)).toThrow("story.md uses schema-version 3, newer than this CLI (2); upgrade story-skills");
    expect(fs.readFileSync(storyPath, "utf8")).toBe(before);
    expect(messages(validateProject(root).errors)).toContain("story.md uses schema-version 3, newer than this CLI (2); upgrade story-skills");
  });

  test("an older schema-version is still upgraded", () => {
    const root = newProject();
    editFile(path.join(root, "story.md"), (text) => text.replace("schema-version: 2", "schema-version: 1"));
    migrateProject(root);
    expect(fs.readFileSync(path.join(root, "story.md"), "utf8")).toContain("schema-version: 2\n");
  });
});

describe("#89 frontmatter writer quotes YAML indicator values", () => {
  test("values another YAML parser would misread are quoted", () => {
    const values = ["*Star", "[Redacted]", "| Pipe", "No", "yes", "off", "~", "- 1920s", "&anchor", "!tag", "%x", "@at", "`tick", "{x}", ">fold", "?q", ",c", "0x1F", "1e3", "1_000", ".5", "+5", ".inf", "12.", "tab\there"];
    for (const value of values) {
      const text = stringifyFrontmatter({ name: value });
      expect(text).toBe(`---\nname: ${JSON.stringify(value)}\n---\n\n`);
      expect(parseFrontmatter(text).data.name).toBe(value);
    }
  });

  test("ordinary values and dates stay bare", () => {
    for (const value of ["Mara Quill", "chapter-01", "2026-09-01", "The End", "x-1", "Y", "a*b"]) {
      expect(stringifyFrontmatter({ name: value })).toBe(`---\nname: ${value}\n---\n\n`);
    }
  });

  test("story add writes a quoted name", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "[Redacted]" });
    expect(fs.readFileSync(path.join(root, "characters", "redacted.md"), "utf8")).toContain('name: "[Redacted]"\n');
  });
});

describe("#90 closing frontmatter delimiter", () => {
  test("only a line holding exactly --- closes the block", () => {
    expect(() => parseFrontmatter("---\ntitle: x\n----\nBody\n", "a.md")).toThrow("a.md has unclosed YAML frontmatter");
    expect(() => parseFrontmatter("---\ntitle: x\n--- # end\nBody\n", "a.md")).toThrow("a.md has unclosed YAML frontmatter");
    expect(() => parseFrontmatter("---\ntitle: x\n", "a.md")).toThrow("a.md has unclosed YAML frontmatter");
    expect(() => parseFrontmatter("# Just a body\n", "a.md")).toThrow("a.md is missing YAML frontmatter");
    expect(parseFrontmatter("---\ntitle: x\n---   \nBody\n").body).toBe("Body\n");
    expect(parseFrontmatter("---\ntitle: x\n---").body).toBe("");
    expect(parseFrontmatter("---\r\ntitle: x\r\n---\r\nBody\r\n").body).toBe("Body\r\n");
  });

  test("an empty frontmatter block parses, and replaceFrontmatter can fill it", () => {
    expect(parseFrontmatter("---\n---\nBody\n")).toEqual({ data: {}, body: "Body\n", raw: "" });
    expect(replaceFrontmatter("---\n---\nBody\n", {})).toBe("---\n---\nBody\n");
    expect(replaceFrontmatter("---\n---\nBody\n", { title: "X" })).toBe("---\ntitle: X\n---\nBody\n");
  });
});

describe("#91 frontmatter rewrites keep each line's ending", () => {
  test("untouched lines keep CRLF or LF in a mixed file", () => {
    const original = "---\ntitle: One\r\nnumber: 1\r\nstatus: draft\nword-count: 1\r\n---\nBody\n";
    const { data } = parseFrontmatter(original);
    expect(replaceFrontmatter(original, { ...data, "word-count": 5 }))
      .toBe("---\ntitle: One\r\nnumber: 1\r\nstatus: draft\nword-count: 5\r\n---\nBody\n");
    expect(replaceFrontmatter(original, { ...data, status: "revised" }))
      .toBe("---\ntitle: One\r\nnumber: 1\r\nstatus: revised\nword-count: 1\r\n---\nBody\n");
  });

  test("consistent CRLF files stay CRLF when keys are added or lists change", () => {
    const original = "---\r\ntitle: One\r\ntags:\r\n  - a\r\n---\r\nBody\r\n";
    const { data } = parseFrontmatter(original);
    expect(replaceFrontmatter(original, { ...data, tags: ["a", "b"], extra: "x" }))
      .toBe("---\r\ntitle: One\r\ntags:\r\n  - a\r\n  - b\r\nextra: x\r\n---\r\nBody\r\n");
    const moved = replaceFrontmatter(original, { tags: ["a"], title: "One" });
    expect(moved.replace(/\r\n/g, "")).not.toContain("\n");
  });

  test("wordcount --write changes only the word-count line", () => {
    const root = copyExample("the-last-ember");
    const file = path.join(root, "chapters", "chapter-01.md");
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const mixed = lines.map((line, index) => (index >= 1 && index <= 4 ? `${line}\r` : line)).join("\n").replace(/^word-count: \d+$/m, "word-count: 1");
    fs.writeFileSync(file, mixed, "utf8");
    expect(invoke(root, ["wordcount", "--write", "."]).code).toBe(0);
    const after = fs.readFileSync(file, "utf8");
    expect(after.split("\n").slice(1, 5)).toEqual(mixed.split("\n").slice(1, 5));
    expect(after.replace(/^word-count: \d+$/m, "word-count: 1")).toBe(mixed);
  });
});

describe("#99 shipped examples have current registries", () => {
  test("reindex is a no-op on every example", () => {
    for (const name of fs.readdirSync(examplesRoot).sort()) {
      if (!fs.existsSync(path.join(examplesRoot, name, "story.md"))) {
        continue;
      }
      expect({ name, stale: staleRegistries(path.join(examplesRoot, name)) }).toEqual({ name, stale: [] });
    }
  });
});

describe("#105 scenes sort by chapter number", () => {
  test("chapter-99 scenes come before chapter-100 scenes", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "A", number: 99 });
    createEntity(root, { kind: "chapter", name: "B" });
    createEntity(root, { kind: "scene", name: "Y", chapter: "chapter-100" });
    createEntity(root, { kind: "scene", name: "X", chapter: "chapter-99" });
    expect(scanProject(root).scenes.map((scene) => scene.id)).toEqual(["chapter-99-scene-01", "chapter-100-scene-01"]);
    const rows = fs.readFileSync(path.join(root, "scenes", "_index.md"), "utf8").split("\n").filter((line) => line.startsWith("| chapter-"));
    expect(rows.map((row) => row.split(" | ")[0])).toEqual(["| chapter-99", "| chapter-100"]);
  });
});

describe("#128 missing registry link warning names the file", () => {
  test("the warning names the unlisted file and the fix", () => {
    const root = newProject();
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

function exemptionProject() {
  const root = newProject();
  for (const name of ["Ann", "Joann"]) {
    createEntity(root, { kind: "character", name });
  }
  for (const number of [1, 2, 3]) {
    createEntity(root, { kind: "chapter", name: `C${number}`, number });
  }
  for (const id of ["ann", "joann"]) {
    editFile(path.join(root, "characters", `${id}.md`), (text) => text.replace("status: alive", "status: deceased\ndied-in: chapter-01"));
  }
  editFile(path.join(root, "chapters", "chapter-03.md"), (text) => text.replace("characters: []", "characters:\n  - ann\n  - joann"));
  return root;
}

function writeExemptions(root, entries) {
  writeMarkdown(path.join(root, "continuity", "exemptions.md"), `type: exemption-log\nexemptions:\n${entries}`);
}

describe("#162 exemptions", () => {
  test("a leading space in a pattern is kept as a word boundary", () => {
    const root = exemptionProject();
    writeExemptions(root, '  - pattern: " ann, who died in chapter-01"\n    reason: "Ann is a ghost"');
    const result = checkProjectContinuity(root);
    expect(result.dismissed.map((entry) => entry.finding.message)).toEqual([expect.stringContaining("lists ann, who died")]);
    expect(messages(result.errors)).toContain("chapters/chapter-03.md lists joann, who died in chapter-01; move posthumous appearances to mentions");
  });

  test("an entry without a reason dismisses nothing", () => {
    const root = exemptionProject();
    writeExemptions(root, '  - pattern: "chapter-03.md lists ann"');
    expect(checkProjectContinuity(root).dismissed).toEqual([]);
    expect(messages(validateProject(root).errors)).toContain("continuity/exemptions.md exemptions[0] is missing a non-empty reason");
  });

  test("a refused exemptions file or state file is named by its project path", () => {
    const root = exemptionProject();
    fs.mkdirSync(path.join(root, "continuity", "exemptions.md"));
    const result = checkProjectContinuity(root);
    const refusal = messages(result.errors).find((error) => error.startsWith("continuity/exemptions.md:"));
    expect(refusal).toBe("continuity/exemptions.md: Refusing to read continuity/exemptions.md: not a regular file");

    const statePath = path.join(root, "continuity", "state.md");
    const outside = path.join(makeTempDir(), "state.md");
    fs.renameSync(statePath, outside);
    fs.symlinkSync(outside, statePath);
    const errors = messages(validateProject(root).errors).join("\n");
    expect(errors).toContain("continuity/state.md");
    expect(errors).not.toContain(root);
  });
});

describe("#205 dot-files in entity folders are skipped", () => {
  test("AppleDouble files do not block validate, wordcount, or build", () => {
    const root = copyExample("the-unraveled-thread");
    fs.writeFileSync(path.join(root, "chapters", "._chapter-01.md"), Buffer.from("\u0000\u0005\u0016\u0007\u0000\u0002\u0000\u0000Mac OS X        \u0000\u0002", "latin1"));
    fs.writeFileSync(path.join(root, "._story.md"), "\u0000\u0005");
    const validation = validateProject(root);
    expect(messages(validation.errors).filter((error) => error.includes("._"))).toEqual([]);
    expect(messages(validation.warnings).filter((warning) => warning.includes("._"))).toEqual([]);
    expect(invoke(root, ["wordcount", "."]).code).toBe(0);
    const out = path.join(makeTempDir(), "book.md");
    expect(invoke(root, ["build", ".", "--format", "markdown", "--out", out]).code).toBe(0);
  });
});

describe("#224 chapter numbering that starts after 1", () => {
  test("continuity warns when chapters before the first are missing", () => {
    const root = newProject();
    for (const number of [3, 4, 6]) {
      createEntity(root, { kind: "chapter", name: `C${number}`, number });
    }
    const warnings = messages(checkProjectContinuity(root).warnings);
    expect(warnings).toContain("Chapter numbering starts at 3, not 1");
    expect(warnings).toContain("Chapter numbering skips from 4 to 6");
  });

  test("a book starting at chapter 1 gets no start warning", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    expect(messages(checkProjectContinuity(root).warnings).filter((warning) => warning.includes("starts at"))).toEqual([]);
  });
});

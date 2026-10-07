import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import { characterIndex, extractMarkdownLinkTargets, mapOutsideLinks } from "../src/scan.js";
import {
  buildBook,
  computeWordCounts,
  createEntity,
  createStoryProject,
  exportManuscript,
  pacingReport,
  reindexProject,
  renameEntity,
  scanProject,
  synopsisBook,
  validateProject
} from "../src/story.js";
import { expectComparableTime, expectLinearTime, makeTempDir, memoryIo, messages } from "./helpers.js";

const upper = (text) => mapOutsideLinks(text, (part) => part.toUpperCase());
const row = (name) => characterIndex("s", [{ id: "a", name, role: "lead", status: "alive" }], new Map(), []).split("\n").find((line) => line.includes("[a]"));

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

function gapProject(title = "Gap Story") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("link and URL scans", () => {
  test("text outside link destinations and URLs is mapped, in linear time", () => {
    expect(upper("See [a](chapter-01.md) and https://x.test/chapter-02 or <mailto:chapter-03@x> chapter-04.")).toBe("SEE [A](chapter-01.md) AND https://x.test/chapter-02 OR <mailto:chapter-03@x> CHAPTER-04.");
    // Each of these fails fast, so the text is longer.
    expectLinearTime(upper, (n) => "a.".repeat(n / 2), { length: 64000 });
    expectLinearTime(upper, (n) => "](".repeat(n / 2), { length: 64000 });
    expectLinearTime(upper, (n) => "<a:".repeat(n / 3), { length: 64000 });
  });

  test("a link, autolink, or URL of any length is kept whole, and unclosed ones cost little (#587)", () => {
    const path = "x/".repeat(520);
    expect(upper(`[map](${path}chapter-01.md) chapter-02`)).toBe(`[MAP](${path}chapter-01.md) CHAPTER-02`);
    expect(upper(`<mailto:${path}chapter-01@x.test> chapter-02`)).toBe(`<mailto:${path}chapter-01@x.test> CHAPTER-02`);
    const scheme = `${"a".repeat(70)}+x`;
    expect(upper(`${scheme}://x.test/chapter-01 chapter-02`)).toBe(`${scheme}://x.test/chapter-01 CHAPTER-02`);
    // Each unclosed `](` or `<a:` once read up to a thousand characters
    // ahead.
    expectComparableTime(upper, "](".repeat(128000), "]x".repeat(128000));
    expectComparableTime(upper, "<a:".repeat(128000), "<a;".repeat(128000));
  });

  test("link targets are found in linear time", () => {
    expect(extractMarkdownLinkTargets("[a](one.md) [b](<two words.md>) [c](three.md \"Title\") []() [d](four.md#x) ](five.md")).toEqual(["one.md", "two words.md", "three.md", "four.md"]);
    expectLinearTime(extractMarkdownLinkTargets, (n) => "](".repeat(n / 2));
    expectLinearTime(extractMarkdownLinkTargets, (n) => `[a](a${" ".repeat(n)}b)`);
  });
});

describe("registry cells", () => {
  test("flatten newlines and escape pipes in linear time", () => {
    expect(row("Ann \\| Bo  \n  Cy")).toBe("| Ann \\\\\\| Bo Cy | lead | alive | [a](a.md) |");
    expectLinearTime(row, (n) => `a${" ".repeat(n)}b`);
    expectLinearTime(row, (n) => `a${"\\".repeat(n)}b`);
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

  test("#438 a backslash before a | is escaped too, and reindex round-trips", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Ann \\| Bee" });
    const index = path.join(root, "characters", "_index.md");
    const first = fs.readFileSync(index, "utf8");
    expect(first).toContain("| Ann \\\\\\| Bee | supporting | alive | [ann-bee](ann-bee.md) |");
    reindexProject(root);
    expect(fs.readFileSync(index, "utf8")).toBe(first);
    expect(messages(validateProject(root).warnings)).toEqual([]);
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

describe("symlinked entity files (#63)", () => {
  test("validate warns about a symlinked chapter the scan skips", () => {
    const root = copyExample("the-last-ember");
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.renameSync(chapter, path.join(root, "..", "c1.md"));
    fs.symlinkSync("../../c1.md", chapter);
    const result = invoke(root, ["validate"]);
    expect(result.err).toContain(`warning: ${"chapters/chapter-01.md"} is a symlink and is ignored: replace it with the file itself`);
  });
});

describe("add, rename, and scan limits", () => {
  test("scanning refuses more markdown files than the limit", () => {
    const root = gapProject();
    const nested = path.join(root, "characters", "extra");
    fs.mkdirSync(nested);
    for (let index = 0; index <= 5000; index += 1) {
      fs.writeFileSync(path.join(nested, `note-${index}.md`), "", "utf8");
    }
    expect(() => validateProject(root)).toThrow("Too many markdown files in the project: the scan exceeds the 5000 file limit");
  });
});

describe("files that fail to parse", () => {
  test("wordcount, reindex, export, and build refuse instead of dropping the file", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    const registry = fs.readFileSync(path.join(root, "chapters", "_index.md"), "utf8");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("---\n", "---\n  bad-indent: x\n"));
    expect(() => computeWordCounts(root)).toThrow("Cannot count words: fix this file first");
    expect(() => reindexProject(root)).toThrow("Cannot reindex");
    expect(() => exportManuscript(root)).toThrow("Cannot export");
    expect(() => buildBook(root, { format: "epub" })).toThrow("Cannot build");
    expect(fs.readFileSync(path.join(root, "chapters", "_index.md"), "utf8")).toBe(registry);
    expect(invoke(path.dirname(root), ["wordcount", root]).code).toBe(3);
  });

  test("add and synopsis refuse before writing anything", () => {
    const root = sweepProject();
    fs.writeFileSync(path.join(root, "characters", "broken.md"), "# No frontmatter\n");
    expect(() => createEntity(root, { kind: "character", name: "Mara" })).toThrow("Cannot add: fix this file first (story validate reports it):\n- characters/broken.md: is missing YAML frontmatter");
    expect(fs.existsSync(path.join(root, "characters", "mara.md"))).toBe(false);
    expect(() => synopsisBook(root)).toThrow("Cannot build a synopsis");
    expect(() => exportManuscript(root)).toThrow("Cannot export");
  });

  test("a broken style sheet does not block reindex", () => {
    const root = sweepProject();
    fs.writeFileSync(path.join(root, "style-sheet.md"), "---\n: bad\n---\n");
    // A new character is not in the registry until reindex rebuilds it.
    fs.writeFileSync(path.join(root, "characters", "rowan.md"), "---\nname: Rowan\nrole: supporting\nstatus: alive\nrelationships: []\n---\n# Rowan\n", "utf8");
    const { changed } = reindexProject(root);
    expect(changed).toContain(path.join(root, "characters", "_index.md"));
    expect(fs.readFileSync(path.join(root, "characters", "_index.md"), "utf8")).toContain("Rowan");
  });

  test("rename aborts when an entity file or registry has no frontmatter", () => {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "location", name: "Port", "notable-characters": "mara-quill" });
    const location = path.join(root, "worldbuilding", "locations", "port.md");
    const locationText = fs.readFileSync(location, "utf8");
    fs.writeFileSync(location, locationText.replace(/^---\n/, ""));
    expect(() => renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Q" })).toThrow("Cannot rename: fix this file first");
    fs.writeFileSync(location, locationText);
    const registry = path.join(root, "worldbuilding", "_index.md");
    fs.writeFileSync(registry, fs.readFileSync(registry, "utf8").replace(/^---\n[\s\S]*?\n---\n/, ""));
    expect(() => renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Q" })).toThrow("worldbuilding/_index.md is missing YAML frontmatter (it is a registry: run story reindex to rebuild it); nothing was changed");
    expect(fs.existsSync(path.join(root, "characters", "mara-quill.md"))).toBe(true);
  });
});

describe("reports and views", () => {
  test("a non-integer chapter number falls back to the file name in views and blocks builds", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 3 });
    const chapter = path.join(root, "chapters", "chapter-03.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("number: 3", 'number: "3a"'));
    expect(pacingReport(root).rows?.[0]?.number ?? scanProject(root).chapters[0].number).toBe(3);
    expect(() => buildBook(root, { format: "html" })).toThrow("chapters/chapter-03.md: chapter number must be a positive integer to build");
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter, replaceFrontmatter } from "../src/frontmatter.js";
import { createStoryProject, translationReport, validateLinks, validateProject } from "../src/story.js";
import { sourceHash, translationLabel, validateTranslationLink } from "../src/translation.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, messages } from "./helpers.js";

const resultSchema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

const PROSE = {
  "chapter-01": "The tide came in over the rocks.\n\nMara lit the lamp.\n\nThe gulls went quiet.",
  "chapter-02": "Morning broke grey.\n\nThe boat was gone."
};

// A source book with two chapters, a scene, and a character, and its
// translation: a copy beside it whose story.md names it.
function editions() {
  const cwd = makeTempDir();
  const source = createStoryProject({ title: "The Tide", cwd, dir: "book-en" }).root;
  for (const title of ["One", "Two"]) {
    expect(invoke(source, ["add", "chapter", title]).code).toBe(0);
  }
  expect(invoke(source, ["add", "scene", "Arrival", "--chapter", "chapter-01"]).code).toBe(0);
  expect(invoke(source, ["add", "character", "Mara Quill"]).code).toBe(0);
  for (const [id, prose] of Object.entries(PROSE)) {
    fs.appendFileSync(path.join(source, "chapters", `${id}.md`), `\n${prose}\n`, "utf8");
  }
  expect(invoke(source, ["wordcount", "--write"]).code).toBe(0);
  const translation = path.join(cwd, "book-es");
  fs.cpSync(source, translation, { recursive: true });
  setFields(path.join(translation, "story.md"), { language: "es", "translation-of": "../book-en" });
  return { cwd, source, translation };
}

function setFields(file, fields) {
  const markdown = fs.readFileSync(file, "utf8");
  const { data } = parseFrontmatter(markdown, file);
  const next = { ...data, ...fields };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      delete next[key];
    }
  }
  fs.writeFileSync(file, replaceFrontmatter(markdown, next), "utf8");
}

function frontmatter(file) {
  return parseFrontmatter(fs.readFileSync(file, "utf8"), file).data;
}

function chapterFile(root, id) {
  return path.join(root, "chapters", `${id}.md`);
}

function codes(findings) {
  return findings.map((finding) => finding.code);
}

describe("translation-of", () => {
  test("a relative link to another story project is followed; an unset or blank one is no link", () => {
    const { source, translation } = editions();
    const errors = [];
    expect(validateTranslationLink(translation, { "translation-of": "../book-en" }, errors)).toBe(source);
    expect(validateTranslationLink(translation, {}, errors)).toBeNull();
    expect(validateTranslationLink(translation, { "translation-of": "  " }, errors)).toBeNull();
    expect(errors).toEqual([]);
  });

  test("a backslash, an absolute path, the project itself, or a folder with no story.md is an error", () => {
    const { cwd, translation } = editions();
    fs.mkdirSync(path.join(cwd, "empty"));
    const cases = [
      ["..\\book-en", "translation-of-backslash", "story.md translation-of ..\\book-en uses a backslash; write ../book-en so the link works on every system"],
      [path.join(cwd, "book-en"), "translation-of-absolute", `story.md translation-of ${path.join(cwd, "book-en")} is an absolute path; write the path from this project's folder, such as ../book-en`],
      ["C:/books/book-en", "translation-of-absolute", "story.md translation-of C:/books/book-en is an absolute path; write the path from this project's folder, such as ../book-en"],
      [".", "translation-of-self", "story.md translation-of . points at this project"],
      ["../book-es/", "translation-of-self", "story.md translation-of ../book-es/ points at this project"],
      ["../empty", "translation-of-not-project", "story.md translation-of ../empty is not a story project: missing story.md"],
      ["../missing", "translation-of-not-project", "story.md translation-of ../missing is not a story project: missing story.md"]
    ];
    for (const [value, code, message] of cases) {
      const errors = [];
      expect(validateTranslationLink(translation, { "translation-of": value }, errors)).toBeNull();
      expect(errors).toEqual([{ code, message, file: "story.md", chapter: null }]);
    }
  });

  test("story links checks the link, and validate asks for text", () => {
    const { translation } = editions();
    expect(validateLinks(translation).ok).toBe(true);
    setFields(path.join(translation, "story.md"), { "translation-of": "../book-fr" });
    expect(messages(validateLinks(translation).errors)).toContain("story.md translation-of ../book-fr is not a story project: missing story.md");

    setFields(path.join(translation, "story.md"), { "translation-of": 12 });
    setFields(chapterFile(translation, "chapter-01"), { "source-hash": 123456789012 });
    const found = messages(validateProject(translation).errors);
    expect(found).toContain('story.md frontmatter field translation-of must be text: quote it as translation-of: "12"');
    expect(found).toContain('chapters/chapter-01.md frontmatter field source-hash must be text: quote it as source-hash: "123456789012"');
  });

  test("validate warns about a backslash, as for series links", () => {
    const { translation } = editions();
    setFields(path.join(translation, "story.md"), { "translation-of": "..\\book-en" });
    expect(messages(validateProject(translation).warnings)).toContain("story.md translation-of ..\\book-en uses a backslash; write ../book-en so the path works on every system");
  });

  test("the label is the link with / separators and no trailing slash", () => {
    expect(translationLabel("../book-en/")).toBe("../book-en");
    expect(translationLabel("./../book-en")).toBe("../book-en");
  });
});

describe("story translation", () => {
  test("a fresh copy is in step with its source", () => {
    const { translation } = editions();
    const report = translationReport(translation);
    expect(report).toMatchObject({ ok: true, errors: [], warnings: [], source: "../book-en", sourceTitle: "The Tide", language: "es", sourceLanguage: "en", missing: [], extra: [], recorded: [] });
    expect(report.chapters).toEqual([
      expect.objectContaining({ id: "chapter-01", file: "chapters/chapter-01.md", sourceFile: "../book-en/chapters/chapter-01.md", paragraphs: 3, sourceParagraphs: 3, recordedHash: null, sourceChanged: null }),
      expect.objectContaining({ id: "chapter-02", paragraphs: 2, sourceParagraphs: 2, recordedHash: null, sourceChanged: null })
    ]);
    const result = invoke(translation, ["translation"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("- chapter-01: 3 paragraphs (source 3), no source-hash");
    expect(result.err).toBe("Translation is in step with its source: 0 errors, 0 warnings, 0 dismissed\n");
  });

  test("chapters, scenes, and ids in one edition only are errors", () => {
    const { source, translation } = editions();
    // The source gains a chapter after the copy, and renames its character.
    expect(invoke(source, ["add", "chapter", "Three"]).code).toBe(0);
    expect(invoke(source, ["rename", "character", "mara-quill", "Mara Vell"]).code).toBe(0);
    // The translation has a scene the source does not.
    expect(invoke(translation, ["add", "scene", "Departure", "--chapter", "chapter-02"]).code).toBe(0);
    const report = translationReport(translation);
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual([
      { kind: "chapter", id: "chapter-03", file: "../book-en/chapters/chapter-03.md" },
      { kind: "character", id: "mara-vell", file: "../book-en/characters/mara-vell.md" }
    ]);
    expect(report.extra).toEqual([
      { kind: "scene", id: "chapter-02-scene-01", file: "scenes/chapter-02-scene-01.md" },
      { kind: "character", id: "mara-quill", file: "characters/mara-quill.md" }
    ]);
    expect(messages(report.errors)).toEqual([
      "chapter chapter-03 is in the source (../book-en/chapters/chapter-03.md) but not in the translation; copy it across and translate it",
      "scenes/chapter-02-scene-01.md has scene chapter-02-scene-01, which the source ../book-en does not; give it the source's id, or add it to the source first",
      "character mara-vell is in the source (../book-en/characters/mara-vell.md) but not in the translation; copy it across and translate it",
      "characters/mara-quill.md has character mara-quill, which the source ../book-en does not; give it the source's id, or add it to the source first"
    ]);
    expect(codes(report.errors)).toEqual(["translation-missing", "translation-extra", "translation-missing", "translation-extra"]);
    expect(report.errors[0].file).toBe("../book-en/chapters/chapter-03.md");
    expect(invoke(translation, ["translation"]).code).toBe(1);
  });

  test("research notes are not compared", () => {
    const { source, translation } = editions();
    expect(invoke(source, ["add", "research", "Lighthouses"]).code).toBe(0);
    expect(translationReport(translation).ok).toBe(true);
  });

  test("a chapter with another paragraph count is a warning; one with no prose yet is not", () => {
    const { translation } = editions();
    fs.appendFileSync(chapterFile(translation, "chapter-01"), "\nUna frase más.\n", "utf8");
    const file = chapterFile(translation, "chapter-02");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(PROSE["chapter-02"], ""), "utf8");
    const report = translationReport(translation);
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([{ code: "translation-paragraph-count", message: "chapters/chapter-01.md has 4 paragraphs; the source ../book-en/chapters/chapter-01.md has 3", file: "chapters/chapter-01.md", chapter: null }]);
    expect(report.chapters[1]).toMatchObject({ id: "chapter-02", paragraphs: 0, sourceParagraphs: 2 });
  });

  test("--record writes each source chapter's hash; a later source change is a warning until it is recorded again", () => {
    const { source, translation } = editions();
    const recorded = invoke(translation, ["translation", "--record"]);
    expect(recorded.code).toBe(0);
    expect(recorded.out).toContain("Recorded source-hash in 2 chapters: chapter-01, chapter-02");
    const hash = frontmatter(chapterFile(translation, "chapter-01"))["source-hash"];
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(translationReport(translation).chapters.map((entry) => entry.sourceChanged)).toEqual([false, false]);
    // Recording again changes nothing.
    expect(invoke(translation, ["translation", "--record", "--json"]).out).toContain('"recorded": []');

    const sourceChapter = chapterFile(source, "chapter-01");
    fs.writeFileSync(sourceChapter, fs.readFileSync(sourceChapter, "utf8").replace("Mara lit the lamp.", "Mara lit the old lamp."), "utf8");
    fs.writeFileSync(chapterFile(source, "chapter-02"), fs.readFileSync(chapterFile(source, "chapter-02"), "utf8").replace("Morning broke grey.", "Morning broke grey"), "utf8");
    const report = translationReport(translation);
    const now = report.chapters[0].sourceHash;
    expect(now).not.toBe(hash);
    expect(report.warnings).toEqual([
      { code: "translation-source-changed", message: `../book-en/chapters/chapter-01.md changed since chapters/chapter-01.md was translated (source-hash ${hash}, now ${now}); carry the change across, then run story translation --record --chapter chapter-01`, file: "chapters/chapter-01.md", chapter: null },
      expect.objectContaining({ code: "translation-source-changed", file: "chapters/chapter-02.md" })
    ]);
    expect(report.ok).toBe(true);

    // --chapter records the one chapter whose change was carried across.
    const one = invoke(translation, ["translation", "--record", "--chapter", "chapter-01", "--json"]);
    const envelope = JSON.parse(one.out);
    expect(envelope.data.recorded).toEqual(["chapter-01"]);
    expect(envelope.data.changes).toEqual([{ action: "update", path: "chapters/chapter-01.md" }]);
    expect(envelope.writes).toEqual([chapterFile(fs.realpathSync(translation), "chapter-01")]);
    expect(frontmatter(chapterFile(translation, "chapter-01"))["source-hash"]).toBe(now);
    expect(codes(translationReport(translation).warnings)).toEqual(["translation-source-changed"]);
  });

  test("the hash ignores the outline, comments, and line wrapping, but not the title", () => {
    const { source, translation } = editions();
    expect(invoke(translation, ["translation", "--record"]).code).toBe(0);
    const file = chapterFile(source, "chapter-01");
    let text = fs.readFileSync(file, "utf8")
      .replace("1. Opening beat", "1. A new opening beat")
      .replace("Mara lit the lamp.", "Mara lit\nthe lamp. <!-- check the lamp -->");
    fs.writeFileSync(file, text, "utf8");
    expect(translationReport(translation).warnings).toEqual([]);
    setFields(file, { title: "One Again" });
    expect(codes(translationReport(translation).warnings)).toEqual(["translation-source-changed"]);
    expect(sourceHash("One", ["A b.", "C d."])).toBe(sourceHash("One", ["A b.", "C d."]));
    expect(sourceHash("One", ["A b.", "C d."])).not.toBe(sourceHash("One", ["A b. C d."]));
  });

  test("--dry-run lists the chapters --record would change and writes nothing", () => {
    const { translation } = editions();
    const before = fs.readFileSync(chapterFile(translation, "chapter-01"), "utf8");
    const result = invoke(translation, ["translation", "--record", "--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("update  chapters/chapter-01.md\nupdate  chapters/chapter-02.md\nDry run: story translation --record would make 2 changes; nothing was written\n");
    expect(fs.readFileSync(chapterFile(translation, "chapter-01"), "utf8")).toBe(before);
    const json = JSON.parse(invoke(translation, ["translation", "--record", "--dry-run", "--json"]).out);
    expect(json).toMatchObject({ ok: true, writes: [], data: { dryRun: true, recorded: ["chapter-01", "chapter-02"] } });
  });

  test("usage and project errors", () => {
    const { source, translation } = editions();
    const plain = invoke(source, ["translation"]);
    expect(plain.code).toBe(3);
    expect(plain.err).toContain("story.md sets no translation-of; add translation-of: <path to the source project>");
    expect(invoke(translation, ["translation", "--dry-run"]).code).toBe(2);
    expect(invoke(translation, ["translation", "--chapter", "chapter-01"]).code).toBe(2);
    const unknown = invoke(translation, ["translation", "--record", "--chapter", "chapter-09"]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("Chapter chapter-09 is not in both the translation and its source ../book-en");
  });

  test("a source that cannot be followed is an error, and --record refuses it", () => {
    const { cwd, translation } = editions();
    fs.renameSync(path.join(cwd, "book-en"), path.join(cwd, "book-gone"));
    const report = translationReport(translation);
    expect(report).toMatchObject({ ok: false, source: "../book-en", sourceTitle: null, chapters: [], missing: [], extra: [] });
    expect(codes(report.errors)).toEqual(["translation-of-not-project"]);
    expect(invoke(translation, ["translation"]).code).toBe(1);
    const record = invoke(translation, ["translation", "--record"]);
    expect(record.code).toBe(3);
    expect(record.err).toContain("Cannot record source hashes: story.md translation-of ../book-en is not a story project: missing story.md");
  });

  test("a source file that fails to parse is reported with the source path, and --record refuses it", () => {
    const { source, translation } = editions();
    fs.writeFileSync(path.join(source, "characters", "zz-broken.md"), "---\nname: A\nname: B\n---\n", "utf8");
    const report = translationReport(translation);
    expect(report.errors.find((error) => error.code === "unreadable-file")).toMatchObject({ file: "../book-en/characters/zz-broken.md" });
    const record = invoke(translation, ["translation", "--record"]);
    expect(record.code).toBe(3);
    expect(record.err).toContain("../book-en: characters/zz-broken.md");
  });

  test("--json matches the result schema, with findings, a record, and a link that cannot be followed", () => {
    const { cwd, source, translation } = editions();
    const json = (argv) => {
      const result = invoke(translation, [...argv, "--json"]);
      expect(result.err).toBe("");
      const envelope = JSON.parse(result.out);
      expect(validateAgainstSchema(envelope, resultSchema)).toEqual([]);
      expect(envelope.ok).toBe(result.code === 0);
      return envelope;
    };
    const clean = json(["translation"]);
    expect(clean).toMatchObject({ apiVersion: "story/v2", command: "translation", ok: true, diagnostics: [], writes: [] });
    expect(Object.keys(clean.data).sort()).toEqual(["changes", "chapters", "dryRun", "extra", "language", "missing", "recorded", "root", "source", "sourceLanguage", "sourceTitle", "title"]);
    expect(json(["translation", "--record"]).data.recorded).toEqual(["chapter-01", "chapter-02"]);
    expect(invoke(source, ["add", "chapter", "Three"]).code).toBe(0);
    fs.appendFileSync(chapterFile(source, "chapter-01"), "\nOne more.\n", "utf8");
    const drift = json(["translation"]);
    expect(drift.diagnostics.map((entry) => [entry.severity, entry.code, entry.check])).toEqual([
      ["error", "translation-missing", "translation"],
      ["warning", "translation-paragraph-count", "translation"],
      ["warning", "translation-source-changed", "translation"]
    ]);
    fs.renameSync(source, path.join(cwd, "book-gone"));
    expect(json(["translation"]).data).toMatchObject({ source: "../book-en", sourceTitle: null, chapters: [] });
  });
});

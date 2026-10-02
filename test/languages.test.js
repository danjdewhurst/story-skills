import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { compareImportNames, extractNameCandidates, importManuscript } from "../src/import.js";
import { DEFAULT_LANGUAGE, checkList, checkSet, hasLists, isLanguageTag, languagePack, projectLanguage, skippedCheck, skippedChecks, skippedLines } from "../src/languages/index.js";
import { givenName } from "../src/names.js";
import { contentWords, proseRules, repeatedPhrases, sentenceLengths } from "../src/prose.js";
import { splitSentences } from "../src/sentences.js";
import { createStoryProject, namesReport, proseReport, scanProject, voicesReport } from "../src/story.js";
import { formatVoices, quoteMatches } from "../src/voices.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

// `stdin`, when given, stands in for text piped to `story <command> -`.
function invoke(cwd, argv, stdin) {
  const io = memoryIo(cwd);
  if (stdin !== undefined) {
    io.readStdin = () => Buffer.from(stdin);
  }
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// A new project whose story.md names `language`.
function languageProject(language) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Language Story", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^---\n/, `---\nlanguage: ${language}\n`));
  return { root, cwd };
}

function writeChapter(root, number, paragraphs) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
`, `## Chapter Text\n\n${paragraphs.join("\n\n")}\n`);
}

function writeCharacter(root, id, name) {
  writeMarkdown(path.join(root, "characters", `${id}.md`), `
name: ${name}
role: supporting
status: alive
`, `# ${name}\n`);
}

// Narration thick with the English lists: filter words, -ly adverbs,
// said-bookisms, echoes, and a repeated phrase.
const ENGLISH_BAIT = Array.from({ length: 40 }, () => "She felt the harbour lights quietly fade and she saw the harbour lights. \"Go,\" she hissed.");

describe("language packs", () => {
  test("languagePack resolves a tag to the most specific pack, then the base pack", () => {
    const english = languagePack("en");
    expect(english.code).toBe("en");
    expect(english.tag).toBe("en");
    expect(english.cased).toBe(true);
    expect(english.segmentation).toBe("space");
    expect(english.checks.filterWords).toContain("felt");
    expect(Object.isFrozen(english)).toBe(true);
    expect(Object.isFrozen(english.checks.filterWords)).toBe(true);
    expect(languagePack("en")).toBe(english);
    expect(languagePack()).toBe(english);

    const british = languagePack("en-GB");
    expect(british.code).toBe("en");
    expect(british.tag).toBe("en-GB");
    expect(british.checks.dialectPairs).toBe(english.checks.dialectPairs);

    const french = languagePack("fr-CA");
    expect(french.code).toBe("und");
    expect(french.tag).toBe("fr-CA");
    expect(french.checks).toEqual({});
    expect(french.labels).toEqual({});
    expect(french.quotes).toContainEqual(["“", "”"]);

    expect(languagePack("not a tag").tag).toBe(DEFAULT_LANGUAGE);
    expect(languagePack(" de ").tag).toBe("de");
  });

  test("projectLanguage reads story.md language, falling back to English", () => {
    expect(projectLanguage({ language: " fr " })).toBe("fr");
    expect(projectLanguage({ language: "[TODO: author to supply]" })).toBe("en");
    expect(projectLanguage({ language: 3 })).toBe("en");
    expect(projectLanguage({})).toBe("en");
    expect(projectLanguage(undefined)).toBe("en");
    expect(isLanguageTag("zh-Hant-TW")).toBe(true);
    expect(isLanguageTag("english")).toBe(false);
  });

  test("checkList, checkSet, and hasLists answer whether a pack has a list", () => {
    const english = languagePack("en");
    const french = languagePack("fr");
    expect(checkList(english, "plainTags")).toEqual(["said", "asked", "says", "asks"]);
    expect(checkList(french, "plainTags")).toBeNull();
    expect(checkSet(english, "plainTags").has("said")).toBe(true);
    expect(checkSet(english, "plainTags")).toBe(checkSet(english, "plainTags"));
    expect(checkSet(french, "plainTags")).toBeNull();
    expect(hasLists(english, ["filterWords", "plainTags"])).toBe(true);
    expect(hasLists(french, ["filterWords"])).toBe(false);
  });

  test("skipped checks name the check, the language, and the missing lists", () => {
    const french = languagePack("fr");
    const definitions = [
      { check: "one", label: "One list", lists: ["filterWords"] },
      { check: "two", label: "Two lists", lists: ["filterWords", "plainTags"] },
      { check: "three", label: "Three lists", lists: ["filterWords", "plainTags", "echoStopwords"] }
    ];
    const skipped = skippedChecks(french, definitions);
    expect(skipped.map((entry) => entry.message)).toEqual([
      "One list skipped: no filterWords list for language fr",
      "Two lists skipped: no filterWords or plainTags list for language fr",
      "Three lists skipped: no filterWords, plainTags, or echoStopwords list for language fr"
    ]);
    expect(skipped[1]).toMatchObject({ check: "two", language: "fr", missing: ["filterWords", "plainTags"] });
    expect(skippedChecks(languagePack("en"), definitions)).toEqual([]);
    expect(skippedCheck(languagePack("en"), definitions[0]).missing).toEqual([]);
    expect(skippedLines(skipped.slice(0, 1))).toEqual(["Note: One list skipped: no filterWords list for language fr"]);
  });

  test("scanProject carries the story's language and pack", () => {
    const { root } = languageProject("fr-CA");
    const project = scanProject(root);
    expect(project.language).toBe("fr-CA");
    expect(project.pack).toBe(languagePack("fr-CA"));
  });
});

describe("analysis without a language's word lists", () => {
  test("story prose skips the English-list checks for a French project and says so", () => {
    const { root, cwd } = languageProject("fr");
    writeChapter(root, 1, ENGLISH_BAIT);
    const report = proseReport(root);
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
    const analysis = report.chapters[0].analysis;
    expect(analysis.filterWords).toEqual([]);
    expect(analysis.adverbs).toEqual([]);
    expect(analysis.plainTags).toEqual([]);
    expect(analysis.bookisms).toEqual([]);
    expect(analysis.echoes).toEqual([]);
    expect(report.phrases).toEqual([]);
    expect(report.skipped.map((entry) => entry.check)).toEqual(["filter-words", "adverbs", "dialogue-tags", "echoes", "repeated-phrases"]);

    const text = invoke(cwd, ["prose", root]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("Note: Filter words skipped: no filterWords list for language fr\n");
    expect(text.out).toContain("Note: Repeated phrases skipped: no phraseStopwords list for language fr\n");
    expect(text.out).not.toContain("Filter words:");
    expect(text.out).not.toContain("-ly adverbs:");
    expect(text.out).not.toContain("Dialogue tags:");
    expect(text.out).not.toContain("Echoes within");
    expect(text.out).not.toContain("Repeated 4-word phrases");
    expect(text.out).toContain("Manuscript:\n  Similar character names: none");

    const json = invoke(cwd, ["prose", root, "--json"]);
    expect(json.code).toBe(0);
    const result = JSON.parse(json.out);
    expect(validateAgainstSchema(result, schema)).toEqual([]);
    expect(result.data.skipped.map((entry) => entry.check)).toEqual(["filter-words", "adverbs", "dialogue-tags", "echoes", "repeated-phrases"]);
    expect(result.data.skipped[0]).toEqual({ check: "filter-words", language: "fr", missing: ["filterWords"], message: "Filter words skipped: no filterWords list for language fr" });
    expect(result.diagnostics).toEqual([]);
  });

  test("an English project reports no skipped checks", () => {
    const { root } = languageProject("en-GB");
    writeChapter(root, 1, ENGLISH_BAIT);
    const report = proseReport(root);
    expect(report.skipped).toEqual([]);
    expect(report.warnings.map((warning) => warning.code)).toContain("prose-filter-words");
  });

  test("a passage piped into a French project's prose check is skipped the same way", () => {
    const { root, cwd } = languageProject("fr");
    const report = proseReport(root, { passage: ENGLISH_BAIT.join("\n\n") });
    expect(report.skipped.map((entry) => entry.check)).toContain("filter-words");
    expect(report.warnings).toEqual([]);
    expect(report.phrases).toEqual([]);
    // With the repeated phrases skipped, a passage has no whole-text lines.
    const text = invoke(cwd, ["prose", "-", "--path", root], ENGLISH_BAIT.join("\n\n"));
    expect(text.code).toBe(0);
    expect(text.out).toContain("Note: Echoes skipped");
    expect(text.out).not.toContain("Passage:");
    const json = invoke(cwd, ["prose", "-", "--path", root, "--json"], ENGLISH_BAIT.join("\n\n"));
    expect(validateAgainstSchema(JSON.parse(json.out), schema)).toEqual([]);
  });

  test("the dialect pairs and the baseline's signature words are skipped only when asked for", () => {
    const { root } = languageProject("fr");
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\ndialect: british\nsamples:\n  - ../samples", "# Style Sheet\n");
    fs.mkdirSync(path.join(root, "..", "samples"));
    fs.writeFileSync(path.join(root, "..", "samples", "one.md"), ENGLISH_BAIT.join("\n\n"));
    writeChapter(root, 1, ENGLISH_BAIT);
    const report = proseReport(root);
    expect(report.skipped.map((entry) => entry.check)).toEqual(["filter-words", "adverbs", "dialogue-tags", "echoes", "repeated-phrases", "dialect-spellings", "signature-words"]);
    expect(report.skipped.at(-2).message).toBe("British and American spellings skipped: no dialectPairs list for language fr");
    expect(report.baseline.signatureWords).toEqual([]);
    expect(report.chapters[0].analysis.variants).toEqual([]);
    expect(proseReport(root, { baseline: "false" }).skipped.map((entry) => entry.check)).not.toContain("signature-words");
  });

  test("prose helpers take the pack and fall back to English", () => {
    const french = languagePack("fr");
    const rules = proseRules({}, [], french);
    expect(contentWords("Harbour lights harbour lights.", rules)).toEqual([]);
    expect(contentWords("Harbour lights harbour lights.", proseRules({}, []))).toEqual(["harbour", "lights", "harbour", "lights"]);
    expect(sentenceLengths("Mr. Hale left. He went.", french)).toEqual([1, 2, 2]);
    expect(sentenceLengths("Mr. Hale left. He went.")).toEqual([3, 2]);
    expect(repeatedPhrases([{ phraseSentences: [["a", "b", "c", "d"], ["a", "b", "c", "d"], ["a", "b", "c", "d"]] }], undefined, french)).toEqual([]);
  });

  test("story voices attributes by action beats alone and skips tags, contractions, and signature words", () => {
    const { root, cwd } = languageProject("fr");
    writeCharacter(root, "mara-quill", "Mara Quill");
    writeCharacter(root, "tom-reed", "Tom Reed");
    const lines = [];
    for (let index = 0; index < 5; index += 1) {
      lines.push("Mara leva les yeux. « Je ne sais pas. »", "\"Don't go,\" she said.", "Tom sourit. \"Tu viens?\"", "— Peut-être, dit Tom.");
    }
    writeChapter(root, 1, lines);
    const report = voicesReport(root);
    expect(report.skipped.map((entry) => entry.check)).toEqual(["speech-tags", "contractions", "signature-words"]);
    const mara = report.profiles.find((entry) => entry.id === "mara-quill");
    const tom = report.profiles.find((entry) => entry.id === "tom-reed");
    // "she said" is not a tag without speech verbs, and Tom's dash line has
    // no tag to stop at, so it runs to the paragraph end.
    expect(mara).toBeUndefined();
    expect(tom.lines).toBe(5);
    expect(tom.contractions).toBeNull();
    expect(tom.signature).toEqual([]);
    expect(quoteMatches("— Peut-être, dit Tom.", languagePack("fr"))[0].text).toBe("Peut-être, dit Tom.");
    expect(quoteMatches("— Maybe, said Tom.")[0].text).toBe("Maybe");

    const text = invoke(cwd, ["voices", root]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("Note: Speech-tag attribution skipped: no speechVerbs or speechPronouns list for language fr\n");
    expect(text.out).toContain("  Sentence length");
    expect(text.out).not.toContain("contractions");
    expect(text.out).not.toContain("  Signature words:");

    const json = JSON.parse(invoke(cwd, ["voices", root, "--json"]).out);
    expect(validateAgainstSchema(json, schema)).toEqual([]);
    expect(json.data.skipped.map((entry) => entry.check)).toEqual(["speech-tags", "contractions", "signature-words"]);
    expect(json.data.profiles.find((entry) => entry.id === "tom-reed").contractions).toBeNull();
  });

  test("voices compares sound-alike speakers without contractions when they are skipped", () => {
    const { root } = languageProject("fr");
    writeCharacter(root, "mara-quill", "Mara Quill");
    writeCharacter(root, "tom-reed", "Tom Reed");
    const lines = [];
    for (let index = 0; index < 5; index += 1) {
      lines.push("Mara leva les yeux. \"Nous partons demain matin.\"", "Tom sourit. \"Nous partons demain soir.\"");
    }
    writeChapter(root, 1, lines);
    const report = voicesReport(root);
    expect(report.warnings.map((warning) => warning.message)).toEqual(["mara-quill and tom-reed may sound alike: similar sentence length, questions, and exclamations"]);
    expect(formatVoices({ profiles: [], unattributed: 0 })).toContain("- None:");
  });

  test("names keep a title as the given name when the pack has no title words", () => {
    expect(givenName("Lord Maren", languagePack("fr"))).toBe("Lord");
    expect(givenName("Lord Maren")).toBe("Maren");
    const { root } = languageProject("fr");
    writeCharacter(root, "lord-maren", "Lord Maren");
    expect(namesReport(root, ["Maren"]).errors).toEqual([]);
    expect(namesReport(root, ["Lord Maren"]).errors.map((error) => error.code)).toEqual(["name-clash"]);
  });

  test("splitSentences keeps initials but not English abbreviations without a list", () => {
    const french = languagePack("fr");
    expect(splitSentences("M. Dupont arriva. Il partit.", { pack: french })).toEqual(["M. Dupont arriva.", "Il partit."]);
    expect(splitSentences("Dr. Hale arriva. Il partit.", { pack: french })).toEqual(["Dr.", "Hale arriva.", "Il partit."]);
    expect(splitSentences("Dr. Hale arrived. He left.")).toEqual(["Dr. Hale arrived.", "He left."]);
  });

  test("import splits on the pack's heading words only", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), "# Chapter One\n\nMara Quill walked. Mara Quill ran. Mara Quill hid.\n\n# Chapter Two\n\nThe end, on Monday.\n");
    const english = importManuscript({ source: "book.md", title: "English", cwd, dir: "english" });
    expect(english.chapters).toBe(2);
    const french = importManuscript({ source: "book.md", title: "French", cwd, dir: "french", language: "fr" });
    expect(french.chapters).toBe(1);
    expect(french.candidates).toEqual([{ name: "Mara Quill", count: 3 }]);
    expect(extractNameCandidates("We met on Monday. You left on Monday. I stayed on Monday.", languagePack("fr"))).toEqual([{ name: "Monday", count: 3 }]);
    expect(extractNameCandidates("We met on Monday. You left on Monday. I stayed on Monday.")).toEqual([]);
    expect(["chapter-2.md", "preface.md", "chapter-1.md"].sort(compareImportNames)).toEqual(["preface.md", "chapter-1.md", "chapter-2.md"]);
  });
});

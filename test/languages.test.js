import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { compareImportNames, extractNameCandidates, importManuscript } from "../src/import.js";
import { DEFAULT_LANGUAGE, canonicalTag, checkList, checkSet, hasLists, isLanguageTag, languagePack, lookupTag, projectLanguage, skippedCheck, skippedChecks, skippedLines } from "../src/languages/index.js";
import { givenName } from "../src/names.js";
import { adverbLabel, contentWords, proseRules, repeatedPhrases, sentenceLengths } from "../src/prose.js";
import { endsSentence, splitSentences } from "../src/sentences.js";
import { createStoryProject, existingStoryLanguage, namesReport, newProjectRoot, proseReport, scanProject, synopsisBook, validateProject, voicesReport } from "../src/story.js";
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

    const czech = languagePack("cs-CZ");
    expect(czech.code).toBe("und");
    expect(czech.tag).toBe("cs-CZ");
    expect(czech.checks).toEqual({});
    expect(czech.labels).toEqual({});
    expect(czech.quotes).toContainEqual(["“", "”"]);

    expect(languagePack(" de ").tag).toBe("de");
    expect(languagePack("").tag).toBe(DEFAULT_LANGUAGE);
    expect(languagePack(null)).toBe(english);
  });

  test("tags are canonicalised for lookup and Intl, and kept as written for messages", () => {
    expect(languagePack("eng").code).toBe("en");
    expect(languagePack("eng").locale).toBe("en");
    expect(languagePack("eng").tag).toBe("eng");
    expect(languagePack("EN-gb").locale).toBe("en-GB");
    expect(languagePack("iw").code).toBe("he");
    expect(languagePack("in").locale).toBe("id");
    expect(languagePack("zh-hant-tw").locale).toBe("zh-Hant-TW");
    expect(canonicalTag("jpn")).toBe("ja");
    expect(canonicalTag(3)).toBeNull();
    expect(canonicalTag("abc-de-fg-hi")).toBeNull();
    expect(isLanguageTag("ja-JP-u-ca-japanese")).toBe(true);
    expect(isLanguageTag("zh-Hant-TW")).toBe(true);
    // Validity is the tag's shape, never the runtime's Intl data.
    expect(isLanguageTag("en-GB-GB")).toBe(true);
    expect(isLanguageTag("fr_FR")).toBe(false);
    expect(isLanguageTag("english")).toBe(false);
    expect(isLanguageTag(3)).toBe(false);
    // Every locale is safe to hand to Intl.
    for (const tag of ["en-GB-GB", "abc-de-fg-hi", "fr_FR", "not a tag", "3", "ja-JP-u-ca-japanese", "zh-yue", "zh-min-nan", "en-GB-oed", "sgn-BE-FR"]) {
      expect(() => new Intl.Collator(languagePack(tag).locale)).not.toThrow();
    }
  });

  test("extlang and grandfathered tags are valid and find their packs without Intl", () => {
    for (const tag of ["zh-yue", "zh-cmn-Hans", "zh-min-nan", "en-GB-oed", "sgn-BE-FR", "no-bok"]) {
      expect(isLanguageTag(tag)).toBe(true);
    }
    // An extlang tag drops its macrolanguage for the locale and keeps it for the pack:
    // zh-yue layers the zh pack, then yue (Traditional labels).
    expect(languagePack("zh-yue")).toMatchObject({ tag: "zh-yue", locale: "yue", code: "yue", segmentation: "character" });
    expect(languagePack("zh-cmn-Hans")).toMatchObject({ locale: "cmn-Hans", code: "zh" });
    expect(languagePack("zh-min-nan")).toMatchObject({ locale: "nan", code: "zh" });
    expect(languagePack("en-GB-oed")).toMatchObject({ tag: "en-GB-oed", locale: "en-GB-oxendict", code: "en" });
    expect(languagePack("en-GB-oed").checks.filterWords).toContain("felt");
    expect(languagePack("sgn-BE-FR")).toMatchObject({ locale: "sfb", code: "und" });
    // Packs come from the lookup tables, so a region Intl rewrites on one
    // runtime (en-UK) finds the same pack everywhere.
    expect(languagePack("en-UK").code).toBe("en");
    for (const tag of ["zh-yue", "zh-cmn-Hans", "en-GB-oed", "ja-JP-u-ca-japanese"]) {
      const { root } = languageProject(tag);
      expect(validateProject(root).errors.map((error) => error.code)).not.toContain("invalid-language");
    }
  });

  // ISO 639-3 codes that have a two-letter code, as Danish, Finnish, and the
  // right-to-left languages written with one (Urdu, Yiddish, Kurdish).
  test("ISO 639-3 codes resolve to the two-letter code's pack or language", () => {
    const codes = { dan: "da", fin: "fi", urd: "ur", yid: "yi", kur: "ku", snd: "sd", pus: "ps", div: "dv", uig: "ug" };
    for (const [alias, code] of Object.entries(codes)) {
      expect({ alias, lookup: lookupTag(alias) }).toEqual({ alias, lookup: [code, null] });
    }
    expect(languagePack("dan")).toMatchObject({ code: "da", locale: "da" });
    expect(languagePack("fin")).toMatchObject({ code: "fi", locale: "fi" });
  });

  // A tag that names an inherited property of an object is an unknown tag:
  // the lookup tables must not answer for it with the property.
  test("a tag named like an inherited property is unknown, not a crash", () => {
    for (const tag of ["constructor", "__proto__"]) {
      expect({ tag, lookup: lookupTag(tag) }).toEqual({ tag, lookup: ["und", null] });
      expect(languagePack(tag)).toMatchObject({ code: "und", locale: "und" });
    }
    const { root } = languageProject("constructor");
    expect(validateProject(root).errors.map((error) => error.code)).toContain("invalid-language");
  });

  test("a set but invalid language resolves from its first subtag or the base pack, never English", () => {
    expect(languagePack("cs_CZ")).toMatchObject({ tag: "cs_CZ", locale: "cs", code: "und" });
    expect(languagePack("en_GB")).toMatchObject({ tag: "en_GB", locale: "en", code: "en" });
    expect(languagePack("en-GB-GB")).toMatchObject({ locale: "en", code: "en" });
    expect(languagePack("not a tag")).toMatchObject({ tag: "not a tag", locale: "und", code: "und" });
    expect(languagePack("english").checks).toEqual({});
  });

  test("script packs set case and word segmentation", () => {
    expect(languagePack("ja")).toMatchObject({ cased: false, segmentation: "character" });
    expect(languagePack("zh-Hans")).toMatchObject({ code: "zh", cased: false, segmentation: "character" });
    expect(languagePack("ko")).toMatchObject({ cased: false, segmentation: "space" });
    expect(languagePack("th")).toMatchObject({ cased: false, segmentation: "dictionary" });
    for (const tag of ["ar", "he", "hi"]) {
      expect(languagePack(tag)).toMatchObject({ code: tag, cased: false, segmentation: "space" });
    }
    expect(languagePack("ja").checks).toEqual({});
    expect(languagePack("fr")).toMatchObject({ cased: true, segmentation: "space" });
  });

  test("projectLanguage uses English only when language is unset", () => {
    expect(projectLanguage({ language: " fr " })).toBe("fr");
    expect(projectLanguage({ language: "[TODO: author to supply]" })).toBe("en");
    expect(projectLanguage({ language: "  " })).toBe("en");
    expect(projectLanguage({ language: null })).toBe("en");
    expect(projectLanguage({})).toBe("en");
    expect(projectLanguage(undefined)).toBe("en");
    expect(projectLanguage({ language: "fr_FR" })).toBe("fr_FR");
    expect(projectLanguage({ language: 3 })).toBe("3");
  });

  test("checkList, checkSet, and hasLists answer whether a pack has a list", () => {
    const english = languagePack("en");
    const italian = languagePack("it");
    expect(checkList(english, "plainTags")).toEqual(["said", "asked", "says", "asks"]);
    expect(checkList(italian, "plainTags")).toBeNull();
    expect(checkSet(english, "plainTags").has("said")).toBe(true);
    expect(checkSet(english, "plainTags")).toBe(checkSet(english, "plainTags"));
    expect(checkSet(italian, "plainTags")).toBeNull();
    expect(hasLists(english, ["filterWords", "plainTags"])).toBe(true);
    expect(hasLists(italian, ["filterWords"])).toBe(false);
  });

  test("skipped checks name the check, the language, and the missing lists", () => {
    const italian = languagePack("it");
    const definitions = [
      { check: "one", label: "One list", lists: ["filterWords"] },
      { check: "two", label: "Two lists", lists: ["filterWords", "plainTags"] },
      { check: "three", label: "Three lists", lists: ["filterWords", "plainTags", "echoStopwords"] }
    ];
    const skipped = skippedChecks(italian, definitions);
    expect(skipped.map((entry) => entry.message)).toEqual([
      "One list skipped: no filterWords list for language it",
      "Two lists skipped: no filterWords or plainTags list for language it",
      "Three lists skipped: no filterWords, plainTags, or echoStopwords list for language it"
    ]);
    expect(skipped[1]).toMatchObject({ check: "two", language: "it", missing: ["filterWords", "plainTags"] });
    expect(skippedChecks(languagePack("en"), definitions)).toEqual([]);
    expect(skippedCheck(languagePack("en"), definitions[0]).missing).toEqual([]);
    expect(skippedLines(skipped.slice(0, 1))).toEqual(["Note: One list skipped: no filterWords list for language it"]);
  });

  test("scanProject carries the story's language and pack", () => {
    const { root } = languageProject("fr-CA");
    const project = scanProject(root);
    expect(project.language).toBe("fr-CA");
    expect(project.pack).toBe(languagePack("fr-CA"));
  });
});

describe("analysis without a language's word lists", () => {
  test("story prose skips the English-list checks for a Italian project and says so", () => {
    const { root, cwd } = languageProject("it");
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
    expect(text.out).toContain("Note: Filter words skipped: no filterWords list for language it\n");
    expect(text.out).toContain("Note: Repeated phrases skipped: no phraseStopwords list for language it\n");
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
    expect(result.data.skipped[0]).toEqual({ check: "filter-words", language: "it", missing: ["filterWords"], message: "Filter words skipped: no filterWords list for language it" });
    expect(result.diagnostics).toEqual([]);
  });

  test("an English project reports no skipped checks", () => {
    const { root } = languageProject("en-GB");
    writeChapter(root, 1, ENGLISH_BAIT);
    const report = proseReport(root);
    expect(report.skipped).toEqual([]);
    expect(report.warnings.map((warning) => warning.code)).toContain("prose-filter-words");
  });

  test("a passage piped into a Italian project's prose check is skipped the same way", () => {
    const { root, cwd } = languageProject("it");
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
    const { root } = languageProject("it");
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\ndialect: british\nsamples:\n  - ../samples", "# Style Sheet\n");
    fs.mkdirSync(path.join(root, "..", "samples"));
    fs.writeFileSync(path.join(root, "..", "samples", "one.md"), ENGLISH_BAIT.join("\n\n"));
    writeChapter(root, 1, ENGLISH_BAIT);
    const report = proseReport(root);
    expect(report.skipped.map((entry) => entry.check)).toEqual(["filter-words", "adverbs", "dialogue-tags", "echoes", "repeated-phrases", "dialect-spellings", "signature-words"]);
    expect(report.skipped.at(-2).message).toBe("British and American spellings skipped: no dialectPairs list for language it");
    expect(report.baseline).toMatchObject({ usable: false, signatureWords: null, filterPerThousand: null, adverbsPerThousand: null });
    // Too few sample words, and no fixed filter-word or adverb limits to fall back on.
    expect(report.warnings.find((warning) => warning.code === "prose-baseline-small").message).toMatch(/\(at least 2000\)$/);
    expect(report.chapters[0].analysis.variants).toEqual([]);
    expect(proseReport(root, { baseline: "false" }).skipped.map((entry) => entry.check)).not.toContain("signature-words");
  });

  test("a usable baseline leaves out the measures the language skips", () => {
    const { root, cwd } = languageProject("it");
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\nsamples:\n  - ../samples", "# Style Sheet\n");
    fs.mkdirSync(path.join(root, "..", "samples"));
    fs.writeFileSync(path.join(root, "..", "samples", "one.md"), Array.from({ length: 4 }, () => ENGLISH_BAIT.join("\n\n")).join("\n\n"));
    writeChapter(root, 1, ENGLISH_BAIT);
    const report = proseReport(root);
    expect(report.language).toBe("it");
    expect(report.baseline).toMatchObject({ usable: true, signatureWords: null, filterPerThousand: null, adverbsPerThousand: null });
    expect(report.chapters[0].baseline).toMatchObject({ filterPerThousand: null, adverbsPerThousand: null, signatureWordsUsed: null });
    expect(report.warnings.map((warning) => warning.code)).toEqual([]);

    const text = invoke(cwd, ["prose", root]).out;
    expect(text).toMatch(/% dialogue\n/);
    expect(text).not.toContain("filter words and");
    expect(text).not.toContain("  Signature words:");
    expect(text).not.toContain(", signature words");
    expect(text).toMatch(/Against the baseline: paragraphs [\d.]+ words, [\d.]+% dialogue\n/);
    const json = JSON.parse(invoke(cwd, ["prose", root, "--json"]).out);
    expect(validateAgainstSchema(json, schema)).toEqual([]);
    expect(json.data.baseline.filterPerThousand).toBeNull();
  });

  test("the adverb label and the small-baseline note come from the pack", () => {
    const english = languagePack("en");
    expect(adverbLabel(english)).toBe("-ly adverbs");
    expect(adverbLabel(languagePack("it"))).toBe("adverbs");
    const { root } = languageProject("en");
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\nsamples:\n  - ../samples", "# Style Sheet\n");
    fs.mkdirSync(path.join(root, "..", "samples"));
    fs.writeFileSync(path.join(root, "..", "samples", "one.md"), "A short sample.");
    expect(proseReport(root).warnings.find((warning) => warning.code === "prose-baseline-small").message).toMatch(/: the fixed filter-word and adverb limits apply instead$/);
  });

  test("prose helpers take the pack and fall back to English", () => {
    const italian = languagePack("it");
    const rules = proseRules({}, [], italian);
    expect(contentWords("Harbour lights harbour lights.", rules)).toEqual([]);
    expect(contentWords("Harbour lights harbour lights.", proseRules({}, []))).toEqual(["harbour", "lights", "harbour", "lights"]);
    expect(sentenceLengths("Mr. Hale left. He went.", italian)).toEqual([1, 2, 2]);
    expect(sentenceLengths("Mr. Hale left. He went.")).toEqual([3, 2]);
    expect(repeatedPhrases([{ phraseSentences: [["a", "b", "c", "d"], ["a", "b", "c", "d"], ["a", "b", "c", "d"]] }], undefined, italian)).toEqual([]);
  });

  test("story voices attributes by action beats alone and skips tags, contractions, and signature words", () => {
    const { root, cwd } = languageProject("it");
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
    // Mara's guillemets are speech in French, "she said" is not a tag without
    // speech verbs, and Tom's dash line has no tag to stop at, so it runs to
    // the paragraph end.
    expect(mara.lines).toBe(5);
    expect(tom.lines).toBe(5);
    expect(tom.contractions).toBeNull();
    expect(tom.signature).toEqual([]);
    expect(quoteMatches("— Peut-être, dit Tom.", languagePack("it"))[0].text).toBe("Peut-être, dit Tom.");
    expect(quoteMatches("— Maybe, said Tom.")[0].text).toBe("Maybe");

    const text = invoke(cwd, ["voices", root]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("Note: Speech-tag attribution skipped: no speechVerbs or speechPronouns list for language it\n");
    expect(text.out).toContain("  Sentence length");
    expect(text.out).not.toContain("contractions");
    expect(text.out).not.toContain("  Signature words:");

    const json = JSON.parse(invoke(cwd, ["voices", root, "--json"]).out);
    expect(validateAgainstSchema(json, schema)).toEqual([]);
    expect(json.data.skipped.map((entry) => entry.check)).toEqual(["speech-tags", "contractions", "signature-words"]);
    expect(json.data.profiles.find((entry) => entry.id === "tom-reed").contractions).toBeNull();
  });

  test("voices compares sound-alike speakers without contractions when they are skipped", () => {
    const { root } = languageProject("it");
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
    expect(givenName("Lord Maren", languagePack("it"))).toBe("Lord");
    expect(givenName("Lord Maren")).toBe("Maren");
    const { root } = languageProject("it");
    writeCharacter(root, "lord-maren", "Lord Maren");
    expect(namesReport(root, ["Maren"]).errors).toEqual([]);
    expect(namesReport(root, ["Lord Maren"]).errors.map((error) => error.code)).toEqual(["name-clash"]);
  });

  test("splitSentences keeps initials but not English abbreviations without a list", () => {
    const italian = languagePack("it");
    expect(splitSentences("M. Dupont arriva. Il partit.", { pack: italian })).toEqual(["M. Dupont arriva.", "Il partit."]);
    expect(splitSentences("Dr. Hale arriva. Il partit.", { pack: italian })).toEqual(["Dr.", "Hale arriva.", "Il partit."]);
    expect(splitSentences("Dr. Hale arrived. He left.")).toEqual(["Dr. Hale arrived.", "He left."]);
  });

  test("import splits on the pack's heading words only", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), "# Chapter One\n\nMara Quill walked. Mara Quill ran. Mara Quill hid.\n\n# Chapter Two\n\nThe end, on Monday.\n");
    const english = importManuscript({ source: "book.md", title: "English", cwd, dir: "english" });
    expect(english.chapters).toBe(2);
    const italian = importManuscript({ source: "book.md", title: "French", cwd, dir: "italian", language: "it" });
    expect(italian.chapters).toBe(1);
    expect(italian.candidates).toEqual([{ name: "Mara Quill", count: 3 }]);
    expect(extractNameCandidates("We met on Monday. You left on Monday. I stayed on Monday.", languagePack("it"))).toEqual([{ name: "Monday", count: 3 }]);
    expect(extractNameCandidates("We met on Monday. You left on Monday. I stayed on Monday.")).toEqual([]);
    expect(["chapter-2.md", "preface.md", "chapter-1.md"].sort(compareImportNames)).toEqual(["preface.md", "chapter-1.md", "chapter-2.md"]);
  });

  test("the synopsis splits sentences with the project's pack", () => {
    const { root } = languageProject("it");
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("Add a 2-3 sentence synopsis here.", "Dr. Hale arriva. Il partit."));
    expect(synopsisBook(root).text).toContain("Logline: Dr.\n");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("language: it\n", ""));
    expect(synopsisBook(root).text).toContain("Logline: Dr. Hale arriva.\n");
  });

  test("synopsis list items keep the pack's own stops", () => {
    const { root } = languageProject("hi");
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("Add a 2-3 sentence synopsis here.", "- वह आया।\n- क्या वह गया؟"));
    expect(synopsisBook(root).text).toContain("Logline: वह आया।\n");
    expect(endsSentence("क्या वह गया؟", languagePack("hi"))).toBe(true);
    expect(endsSentence("She left")).toBe(false);
    expect(endsSentence("She said, \"Go.\"")).toBe(true);
    expect(endsSentence("She waited…")).toBe(true);
  });
});

describe("story import --language", () => {
  const BOOK = "# Chapter One\n\nThe start.\n\n# Chapter Two\n\nThe end.\n";

  test("splits with that language and records it in the new story.md", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), BOOK);
    const result = invoke(cwd, ["import", "book.md", "--title", "Le Livre", "--language", "fr-CA"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Imported 1 chapter");
    const project = scanProject(path.join(cwd, "le-livre"));
    expect(project.language).toBe("fr-CA");
    expect(project.story.data.language).toBe("fr-CA");
  });

  test("writes no language when none is given, and rejects a value that is not a tag", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), BOOK);
    expect(invoke(cwd, ["import", "book.md", "--title", "Plain"]).out).toContain("Imported 2 chapters");
    expect(scanProject(path.join(cwd, "plain")).story.data.language).toBeUndefined();
    const bad = invoke(cwd, ["import", "book.md", "--title", "Bad", "--language", "fr_FR"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("--language fr_FR must be a BCP 47 tag such as en, en-GB, or fr");
    expect(fs.existsSync(path.join(cwd, "bad"))).toBe(false);
    expect(() => createStoryProject({ cwd, title: "Worse", language: "english" })).toThrow("--language english must be a BCP 47 tag");
  });

  test("into an existing project defaults to its language and reports a different one as not applied", () => {
    const { root, cwd } = languageProject("fr");
    fs.writeFileSync(path.join(cwd, "book.md"), BOOK);
    const kept = invoke(cwd, ["import", "book.md", "--title", "Language Story", "--force"]);
    expect(kept.code).toBe(0);
    expect(kept.out).toContain("Imported 1 chapter");
    expect(kept.err).not.toContain("--language");
    expect(invoke(cwd, ["import", "book.md", "--title", "Language Story", "--force", "--language", "fr"]).err).not.toContain("--language");
    const english = invoke(cwd, ["import", "book.md", "--title", "Language Story", "--force", "--language", "en"]);
    expect(english.out).toContain("Imported 2 chapters");
    expect(english.err).toContain("--language was not applied");
    expect(scanProject(root).language).toBe("fr");
  });

  test("a new project from a title with no folder imports in English", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), BOOK);
    expect(newProjectRoot({ title: "", cwd })).toBeNull();
    expect(newProjectRoot({ title: "", cwd, dir: "here" })).toBe(path.join(cwd, "here"));
    expect(existingStoryLanguage(cwd)).toBeNull();
    expect(() => importManuscript({ source: "book.md", cwd })).toThrow("A story title is required");
  });
});

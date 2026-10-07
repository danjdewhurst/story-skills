import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { languagePack } from "../src/languages/index.js";
import { analyzeChapter, proseRules, repeatedPhrases, similarNames } from "../src/prose.js";
import { createEntity, createStoryProject, proseReport, validateProject } from "../src/story.js";
import { expectLinearTime, makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

function proseProject(title = "Prose Story") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title, force: false });
  return { root, cwd };
}

function writeChapter(root, number, body) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 0
`, `## Chapter Text\n\n${body}\n`);
}

function writeStyleSheet(root, frontmatter) {
  writeMarkdown(path.join(root, "style-sheet.md"), `type: style-sheet\n${frontmatter.trim()}`, "# Style Sheet\n");
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function analyze(prose, style = {}, names = []) {
  return analyzeChapter(prose, proseRules(style, names));
}

describe("style sheet", () => {
  test("init scaffolds a valid style-sheet.md without a stray-file warning", () => {
    const { root } = proseProject();
    const text = fs.readFileSync(path.join(root, "style-sheet.md"), "utf8");

    expect(text).toContain("type: style-sheet");
    expect(text).toContain("dialect: unspecified");
    expect(text).toContain("## Character Voices");
    const validation = validateProject(root);
    expect(messages(validation.errors)).toEqual([]);
    expect(messages(validation.warnings).join("\n")).not.toContain("style-sheet.md");
  });

  test("init --force adds a missing style sheet and keeps an existing one", () => {
    const { root, cwd } = proseProject();
    fs.rmSync(path.join(root, "style-sheet.md"));
    createStoryProject({ cwd, title: "Prose Story", force: true });
    expect(fs.existsSync(path.join(root, "style-sheet.md"))).toBe(true);

    writeStyleSheet(root, "dialect: british");
    createStoryProject({ cwd, title: "Prose Story", force: true });
    expect(fs.readFileSync(path.join(root, "style-sheet.md"), "utf8")).toContain("dialect: british");
  });

  test("a project without a style sheet is still valid", () => {
    const { root } = proseProject();
    fs.rmSync(path.join(root, "style-sheet.md"));
    expect(messages(validateProject(root).errors)).toEqual([]);
  });

  test("validate rejects malformed style-sheet frontmatter", () => {
    const { root } = proseProject();
    writeMarkdown(path.join(root, "style-sheet.md"), `
type: notes
dialect: klingon
preferred:
  - use: grey
    avoid: Grey
  - use: OK
  - nope
watch-words: suddenly
allow-words:
  - ""
`);
    const errors = messages(validateProject(root).errors);

    expect(errors).toContain("style-sheet.md type must be style-sheet");
    expect(errors).toContain("style-sheet.md frontmatter field dialect has unsupported value klingon");
    expect(errors).toContain("style-sheet.md preferred[0] use and avoid must differ");
    expect(errors).toContain("style-sheet.md preferred[1] requires a non-empty avoid");
    expect(errors).toContain("style-sheet.md frontmatter field preferred must contain objects");
    expect(errors).toContain("style-sheet.md frontmatter field watch-words must be a list");
    expect(errors).toContain("style-sheet.md frontmatter field allow-words must contain only non-empty strings");
  });

  test("validate reports an unparsable style sheet", () => {
    const { root } = proseProject();
    fs.writeFileSync(path.join(root, "style-sheet.md"), "# no frontmatter\n", "utf8");
    expect(messages(validateProject(root).errors).join("\n")).toContain("style-sheet.md:");
  });
});

describe("prose analysis", () => {
  test("counts filter words and adverbs in narration only", () => {
    const analysis = analyze(`She felt the cold slowly. "I felt nothing, honestly," she said.`);

    expect(analysis.filterWords).toEqual([{ word: "felt", count: 1 }]);
    expect(analysis.adverbs).toEqual([{ word: "slowly", count: 1 }]);
    expect(analysis.narrationWords).toBeLessThan(analysis.words);
  });

  test("skips -ly words that are not adverbs, character names, and allow-words", () => {
    const analysis = analyze("The only family ran early. Emily walked quickly and quietly.", { "allow-words": ["quietly"] }, ["Emily Hart"]);
    expect(analysis.adverbs).toEqual([{ word: "quickly", count: 1 }]);
  });

  test("classifies dialogue tags after curly and straight closing quotes", () => {
    const analysis = analyze([
      "“Go,” she hissed.",
      "\"Why?\" asked Tom.",
      "\"Because,\" he snapped, \"I said so.\"",
      "Mara hissed, \"No.\""
    ].join("\n\n"));

    expect(analysis.bookisms).toEqual([{ word: "hissed", count: 1 }, { word: "snapped", count: 1 }]);
    expect(analysis.plainTags).toEqual([{ word: "asked", count: 1 }]);
  });

  test("long runs of stops or closing marks lint in linear time (#587)", () => {
    const rules = proseRules({}, []);
    expect(analyzeChapter("\"Go!**\" she hissed.", rules).bookisms).toEqual([{ word: "hissed", count: 1 }]);
    expectLinearTime((prose) => analyzeChapter(prose, rules), (n) => `${".".repeat(n)}x`);
    expectLinearTime((prose) => analyzeChapter(prose, rules), (n) => `"${"*".repeat(n)}x" she said.`);
  });

  test("counts echoes inside the window but not across it", () => {
    const near = analyze("The lantern swung. The lantern dimmed.");
    expect(near.echoes).toEqual([{ word: "lantern", count: 1 }]);

    const far = analyze(`The lantern swung. ${"word ".repeat(40)}The lantern dimmed.`);
    expect(far.echoes).toEqual([]);
  });

  test("reports sentence statistics and ignores headings and scene breaks", () => {
    const analysis = analyze("# Heading\n\nOne two three. Four five.\n\n* * *\n\n<!-- note -->Six.");
    expect(analysis.sentences.count).toBe(3);
    expect(analysis.sentences.longest).toBe(3);
    expect(analysis.words).toBe(6);
  });

  test("counts a sentence that ends at I. or a capital alone, but not at an initial (#586)", () => {
    const analysis = analyze("So do I. She laughed. He wanted plan B. Nobody agreed. J. R. Hale left.");
    expect(analysis.sentences.count).toBe(5);
    expect(analysis.sentences.longest).toBe(4);
  });

  test("drops ATX headings only, so a line of prose that opens with # is analysed", () => {
    const analysis = analyze("#1 on the list was Mara, she said quietly.\n\nShe ran.");
    expect(analysis.words).toBe(11);
    expect(analysis.paragraphs).toBe(2);
    expect(analysis.adverbs).toEqual([{ word: "quietly", count: 1 }]);
    const headings = analyze("# One\n###### Six\n#\n####### seven is prose\n#hashtag too\n\nText.");
    expect(headings.words).toBe(6);
    expect(headings.paragraphs).toBe(2);
  });

  test("empty prose yields zeroed statistics", () => {
    const analysis = analyze("");
    expect(analysis.sentences).toEqual({ count: 0, mean: 0, longest: 0, spread: 0 });
    expect(analysis.words).toBe(0);
  });

  test("flags style-sheet variants and dialect spellings on whole words", () => {
    const analysis = analyze("The colour was okay. Okay, the grey-haired man went towards the colourful harbor. Colours.", {
      dialect: "american",
      preferred: [{ use: "OK", avoid: "okay" }, { use: "toward", avoid: "towards" }]
    });
    const byAvoid = Object.fromEntries(analysis.variants.map((entry) => [entry.avoid, entry]));

    expect(byAvoid.okay).toEqual({ use: "OK", avoid: "okay", source: "style sheet", count: 2 });
    expect(byAvoid.towards.count).toBe(1);
    expect(byAvoid.towards.source).toBe("style sheet");
    expect(byAvoid.colour.count).toBe(1);
    expect(byAvoid.colourful.count).toBe(1);
    expect(byAvoid.colours.count).toBe(1);
    expect(byAvoid.grey.count).toBe(1);
    expect(analysis.variants.filter((entry) => entry.avoid === "towards")).toHaveLength(1);
  });

  test("allow-words and style-sheet entries override a dialect pair", () => {
    const analysis = analyze("Harbor Street ran toward the gray sea.", {
      dialect: "british",
      preferred: [{ use: "toward", avoid: "towards" }],
      "allow-words": ["harbor"]
    });
    expect(analysis.variants.map((entry) => entry.avoid)).toEqual(["gray"]);
  });

  test("matches multi-word watch words", () => {
    const analysis = analyze("A beat of silence. Then another beat  of silence. Very well.", { "watch-words": ["beat of silence", "very"] });
    expect(analysis.watch).toEqual([{ word: "beat of silence", count: 2 }, { word: "very", count: 1 }]);
  });

  test("matches watch words and avoided spellings in the story's casing", () => {
    const turkish = analyzeChapter("ILIK bir rüzgâr. İnce bir ses, ınce değil. Ilık su.", proseRules({
      "watch-words": ["ılık", "ince"],
      preferred: [{ use: "ince", avoid: "ılık" }]
    }, [], languagePack("tr")));
    expect(turkish.watch).toEqual([{ word: "ılık", count: 2 }, { word: "ince", count: 1 }]);
    expect(turkish.variants.map((entry) => entry.count)).toEqual([2]);
    // Turkish drops a dot written after I, so the text matched is shorter;
    // the capital of a name is still read from the text as written.
    const shorter = analyzeChapter("I\u0307zmir had Gray Morn at the gray sea.", proseRules({
      preferred: [{ use: "grey", avoid: "gray" }]
    }, ["Gray Morn"], languagePack("tr")));
    expect(shorter.variants.map((entry) => entry.count)).toEqual([1]);
  });

  test("matches watch words and avoided spellings inside scripts written without spaces", () => {
    // Chinese and Japanese: any run of characters is whole words.
    const japanese = analyzeChapter("彼女はとても静かだった。とてもOKだ。", proseRules({ "watch-words": ["とても", "ok"] }, [], languagePack("ja")));
    expect(japanese.watch).toEqual([{ word: "とても", count: 2 }, { word: "ok", count: 1 }]);
    const chinese = analyzeChapter("他突然笑了。他在家裡，突然安静。", proseRules({
      "watch-words": ["突然"],
      preferred: [{ use: "里", avoid: "裡" }]
    }, [], languagePack("zh")));
    expect(chinese.watch).toEqual([{ word: "突然", count: 2 }]);
    expect(chinese.variants).toEqual([{ use: "里", avoid: "裡", source: "style sheet", count: 1 }]);
    // Thai matches at the segmenter's word boundaries (ฉัน รัก แมว), so
    // แม is not found inside แมว.
    const thai = analyzeChapter("ฉันรักแมว ฉันรักแมว", proseRules({ "watch-words": ["รัก", "แม", "แมว"] }, [], languagePack("th")));
    expect(thai.watch).toEqual([{ word: "รัก", count: 2 }, { word: "แมว", count: 2 }]);
  });

  test("a joiner or combining mark inside an unspaced word hides no edge", () => {
    // A soft hyphen or zero-width joiner keeps แ­มว and รัก‍แมว one word each,
    // as story wordcount counts them, so neither มว nor แมว is in them.
    const thai = analyzeChapter("แ­มว ฉันรัก‍แมว แมว", proseRules({ "watch-words": ["มว", "แมว"] }, [], languagePack("th")));
    expect(thai.watch).toEqual([{ word: "แมว", count: 1 }]);
    // A Chinese or Japanese character is a word, joiner or not.
    const japanese = analyzeChapter("東‍京へ行く。", proseRules({ "watch-words": ["東", "京"] }, [], languagePack("ja")));
    expect(japanese.watch).toEqual([{ word: "東", count: 1 }, { word: "京", count: 1 }]);
    // か followed by a combining dakuten is が, not か.
    const kana = analyzeChapter("がか", proseRules({ "watch-words": ["か"] }, [], languagePack("ja")));
    expect(kana.watch).toEqual([{ word: "か", count: 1 }]);
  });

  test("matches unspaced watch words in long chapters quickly", () => {
    const chapter = "彼女はとても静かだった。ฉันรักแมว ".repeat(20000);
    const started = Date.now();
    expect(analyzeChapter(chapter, proseRules({ "watch-words": ["とても", "รัก", "แม", "静か"] }, [], languagePack("ja"))).watch)
      .toEqual([{ word: "とても", count: 20000 }, { word: "รัก", count: 20000 }, { word: "静か", count: 20000 }]);
    expect(Date.now() - started).toBeLessThan(10000);
  });

  test("matches other languages' watch words as the case-insensitive regex always has", () => {
    // Dotted İ is its own letter outside Turkish, as before.
    const english = analyze("ince İnce INCE", { "watch-words": ["İnce", "ince"] });
    expect(english.watch).toEqual([{ word: "İnce", count: 1 }, { word: "ince", count: 2 }]);
    // Lithuanian lower-casing adds a dot to I before an accent; matching
    // does not.
    const lithuanian = analyzeChapter("ÌR ir ìr", proseRules({ "watch-words": ["ìr"] }, [], languagePack("lt")));
    expect(lithuanian.watch).toEqual([{ word: "ìr", count: 2 }]);
  });

  test("matches watch words in long chapters quickly, with or without dotted capitals", () => {
    const cyrillic = "Ирина шла к морю, и вдруг ветер стих. İ ".repeat(25000);
    const turkish = "Ilık rüzgâr birden durdu, I\u0307nce bir ses geldi. ".repeat(20000);
    const started = Date.now();
    expect(analyzeChapter(cyrillic, proseRules({ "watch-words": ["вдруг"] }, [], languagePack("ru"))).watch).toEqual([{ word: "вдруг", count: 25000 }]);
    expect(analyzeChapter(turkish, proseRules({ "watch-words": ["ince", "ılık"] }, [], languagePack("tr"))).watch)
      .toEqual([{ word: "ince", count: 20000 }, { word: "ılık", count: 20000 }]);
    expect(Date.now() - started).toBeLessThan(10000);
  });

  test("finds repeated phrases that are not all stopwords", () => {
    const sentence = "She stood at the edge of the pier. ";
    const phrases = repeatedPhrases([analyze(sentence.repeat(2)), analyze(sentence)]);
    expect(phrases[0]).toEqual({ phrase: "at the edge of", count: 3 });
    expect(phrases.map((entry) => entry.phrase)).not.toContain("of the");
  });

  test("pairs similar character first names", () => {
    const pairs = similarNames([
      { id: "mara-quill", name: "Mara Quill" },
      { id: "maren-voss", name: "Maren Voss" },
      { id: "tom-reed", name: "Tom Reed" },
      { id: "tim-bell", name: "Tim Bell" },
      { id: "jo", name: "Jo" },
      { id: "alexandra-a", name: "Alexandra" },
      { id: "alejandro-b", name: "Zlexandro" }
    ]);
    expect(pairs.map(([a, b]) => `${a.id}/${b.id}`)).toEqual(["alejandro-b/alexandra-a", "mara-quill/maren-voss", "tim-bell/tom-reed"]);
  });
});

describe("proseReport", () => {
  test("raises findings for spellings, bookisms, rates, rhythm, and names", () => {
    const { root } = proseProject();
    writeStyleSheet(root, "dialect: british");
    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "character", name: "Maren Voss" });
    const flat = "She felt the wind and saw the gray sea today. ".repeat(40);
    writeChapter(root, 1, `${flat}\n\n"Go," she hissed. "Now," he snapped. "Fine," she retorted.`);

    const report = proseReport(root);
    const warnings = messages(report.warnings).join("\n");

    expect(report.ok).toBe(true);
    expect(report.styleSheet).toBe(true);
    expect(warnings).toContain('chapters/chapter-01.md uses "gray" 40 times; british dialect prefers "grey"');
    expect(warnings).toContain("chapters/chapter-01.md has 3 said-bookism dialogue tags: hissed 1, retorted 1, snapped 1");
    expect(warnings).toMatch(/chapters\/chapter-01\.md has [\d.]+ filter words per 1,000 narration words \(over 10\): felt 40, saw 40/);
    expect(warnings).toContain("chapters/chapter-01.md sentence lengths are uniform");
    expect(warnings).toContain("characters mara-quill and maren-voss have similar first names (Mara Quill / Maren Voss)");
  });

  test("rate findings wait for enough narration", () => {
    const { root } = proseProject();
    writeChapter(root, 1, "She felt it. She saw it. She knew it slowly.");
    expect(messages(proseReport(root).warnings)).toEqual([]);
  });

  test("reports adverb density over the threshold", () => {
    const { root } = proseProject();
    writeChapter(root, 1, "He moved quickly across the long wide field toward the old grey barn and home. ".repeat(30));
    expect(messages(proseReport(root).warnings).join("\n")).toMatch(/-ly adverbs per 1,000 narration words \(over 12\): quickly 30/);
  });

  test("collects unreadable chapters as errors", () => {
    const { root } = proseProject();
    writeChapter(root, 1, "Fine prose.");
    const report = proseReport(root);
    fs.writeFileSync(path.join(root, "chapters", "chapter-01.md"), "no frontmatter", "utf8");
    const broken = proseReport(root);

    expect(report.ok).toBe(true);
    expect(broken.ok).toBe(false);
    expect(messages(broken.errors).join("\n")).toContain("chapters/chapter-01.md");
  });

  test("story prose prints the report and exits 0 with warnings", () => {
    const { root, cwd } = proseProject();
    fs.rmSync(path.join(root, "style-sheet.md"));
    writeChapter(root, 1, "\"Go,\" she said. The lantern swung. The lantern dimmed.");

    const result = invoke(cwd, ["prose", "--path", root]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("Prose report: 1 chapter, 9 words");
    expect(result.out).toContain("No style-sheet.md: spelling and watch-word checks are off");
    expect(result.out).toContain("chapters/chapter-01.md: Chapter 1 (9 words)");
    expect(result.out).toContain("Dialogue tags: said 1; said-bookisms: none");
    expect(result.out).toContain("Echoes within 30 words: lantern 1");
    expect(result.out).toContain("Repeated 4-word phrases: none");
    expect(result.err).toContain("Prose check complete: 0 errors, 0 warnings");
  });

  test("story prose accepts a positional project path", () => {
    const { root, cwd } = proseProject();
    writeChapter(root, 1, "Positional prose.");
    const result = invoke(cwd, ["prose", root]);
    expect(result.out).toContain("Prose report: 1 chapter, 2 words");
  });

  test("story prose lists watch words, spellings, phrases, and similar names", () => {
    const { root, cwd } = proseProject();
    writeStyleSheet(root, "dialect: american\nwatch-words:\n  - suddenly");
    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "character", name: "Maren Voss" });
    writeChapter(root, 1, "Suddenly the colour went. She stood at the edge of it. She stood at the edge of it. She stood at the edge of it.");
    writeChapter(root, 2, "Another chapter here.");

    const result = invoke(cwd, ["prose", "--path", root]);

    expect(result.out).toContain("Prose report: 2 chapters");
    expect(result.out).toContain("Watch words: suddenly 1");
    expect(result.out).toContain("Spelling: colour 1 (use color)");
    expect(result.out).toContain('"at the edge of" 3');
    expect(result.out).toContain("Similar character names: Mara Quill / Maren Voss");
  });
});

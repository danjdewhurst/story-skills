import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { extractNameCandidates, importManuscript } from "../src/import.js";
import { checkList, languagePack } from "../src/languages/index.js";
import { lowerCase } from "../src/languages/locale.js";
import { STYLE_LISTS, styleWords, withStyleLists } from "../src/languages/style.js";
import { givenName } from "../src/names.js";
import { adverbLabel, analyzeChapter, proseRules } from "../src/prose.js";
import { splitSentences } from "../src/sentences.js";
import { createStoryProject, existingStyleData, proseReport, scanProject, validateProject, voicesReport } from "../src/story.js";
import { narrationOnly, quoteMatches } from "../src/voices.js";
import { RESULT_SCHEMA_PATH, SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const resultSchema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const storySchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));

function invoke(cwd, argv, stdin) {
  const io = memoryIo(cwd);
  if (stdin !== undefined) {
    io.readStdin = () => Buffer.from(stdin);
  }
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

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

function writeStyleSheet(root, frontmatter) {
  writeMarkdown(path.join(root, "style-sheet.md"), `type: style-sheet\n${frontmatter}`, "# Style Sheet\n");
}

const PACKS = ["es", "fr", "de"];
// Lists matched as written; every other list is matched in lower case.
const CASED = new Set(["titleAbbreviations", "contextAbbreviations", "calendarWords", "candidateStopwords"]);

describe("Spanish, French, and German packs", () => {
  test("every list a pack has can be changed from the style sheet", () => {
    const named = new Set(Object.values(STYLE_LISTS).map((entry) => entry.list));
    for (const code of ["en", ...PACKS]) {
      for (const name of Object.keys(languagePack(code).checks)) {
        if (name !== "adverbLabel") {
          expect(`${code} ${name} ${named.has(name)}`).toBe(`${code} ${name} true`);
        }
      }
    }
  });

  test("each pack has every English list but the ones it leaves out on purpose", () => {
    const english = Object.keys(languagePack("en").checks);
    const absent = {
      es: ["dialectPairs", "contractionSuffixes", "contractedIs", "elisions"],
      fr: ["dialectPairs", "contractionSuffixes", "contractedIs", "elisions"],
      de: ["adverbSuffixes", "adverbLabel", "adverbExceptions", "dialectPairs", "elisions"]
    };
    for (const code of PACKS) {
      const pack = languagePack(code);
      expect(english.filter((name) => checkList(pack, name) === null)).toEqual(absent[code]);
    }
    expect(languagePack("de-CH").checks.filterWords).toBe(languagePack("de").checks.filterWords);
    expect(languagePack("fr-CA").checks.saidBookisms).toContain("s'exclama");
  });

  test("lists are free of duplicates and in the case they are matched in", () => {
    for (const code of PACKS) {
      const pack = languagePack(code);
      for (const [name, list] of Object.entries(pack.checks)) {
        if (!Array.isArray(list)) {
          continue;
        }
        expect(`${code} ${name} ${new Set(list.map(String)).size}`).toBe(`${code} ${name} ${list.length}`);
        if (!CASED.has(name) && name !== "dialectPairs") {
          expect(list.filter((word) => lowerCase(word, pack) !== word || word.includes("’"))).toEqual([]);
        }
      }
    }
  });

  test("Spanish prose counts filter words, -mente adverbs, and dash-dialogue tags", () => {
    const rules = proseRules({}, [], languagePack("es"));
    const analysis = analyzeChapter([
      "Sintió el frío y vio el mar. Caminaba lentamente. Tenía la mente en blanco y nadie lo lamente.",
      "—Ven —exclamó él.",
      "—No —dijo ella—. Espera.",
      "—¿Por qué? —preguntó Tom."
    ].join("\n\n"), rules);
    expect(analysis.filterWords).toEqual([{ word: "sintió", count: 1 }, { word: "vio", count: 1 }]);
    expect(analysis.adverbs).toEqual([{ word: "lentamente", count: 1 }]);
    expect(analysis.plainTags).toEqual([{ word: "dijo", count: 1 }, { word: "preguntó", count: 1 }]);
    expect(analysis.bookisms).toEqual([{ word: "exclamó", count: 1 }]);
    expect(adverbLabel(languagePack("es"))).toBe("-mente adverbs");
  });

  test("French prose reads inverted tags and leaves nouns and verbs in -ment alone", () => {
    const rules = proseRules({}, [], languagePack("fr"));
    const analysis = analyzeChapter([
      "Elle sentit le froid et vit la mer. Elle marchait lentement, vraiment lentement, pendant un moment. Ils aiment la mer, comment dire, et le mouvement.",
      "« Viens ! » s’exclama-t-il.",
      "« Non », dit-elle.",
      "« Pourquoi ? » demanda-t-elle.",
      "« Bon. » Il sourit."
    ].join("\n\n"), rules);
    expect(analysis.filterWords).toEqual([{ word: "sentit", count: 1 }]);
    expect(analysis.adverbs).toEqual([{ word: "lentement", count: 2 }, { word: "vraiment", count: 1 }]);
    expect(analysis.plainTags).toEqual([{ word: "demanda", count: 1 }, { word: "dit", count: 1 }]);
    expect(analysis.bookisms).toEqual([{ word: "s'exclama", count: 1 }]);
  });

  test("German prose runs every check but adverbs, which it skips", () => {
    const { root, cwd } = languageProject("de");
    const paragraphs = [];
    for (let index = 0; index < 30; index += 1) {
      paragraphs.push("Sie fühlte die Kälte und sah das Meer. Er ging langsam zum Hafen.", "„Komm“, knurrte er.", "„Nein“, sagte sie.");
    }
    writeChapter(root, 1, paragraphs);
    const report = proseReport(root);
    expect(report.skipped.map((entry) => entry.check)).toEqual(["adverbs"]);
    expect(report.skipped[0].message).toBe("Adverbs skipped: no adverbSuffixes or adverbExceptions list for language de");
    const analysis = report.chapters[0].analysis;
    expect(analysis.filterWords).toEqual([{ word: "fühlte", count: 30 }, { word: "sah", count: 30 }]);
    expect(analysis.plainTags).toEqual([{ word: "sagte", count: 30 }]);
    expect(analysis.bookisms).toEqual([{ word: "knurrte", count: 30 }]);
    expect(report.warnings.map((warning) => warning.code)).toEqual(["prose-filter-words", "prose-bookisms", "prose-uniform-sentences"]);
    const json = JSON.parse(invoke(cwd, ["prose", root, "--json"]).out);
    expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
  });

  test("voices attributes tags in each language and counts German contractions", () => {
    const cases = {
      es: ["—No lo sé —dijo Mara.", "—¿Vienes? —preguntó Tom.", "—Tal vez —dijo ella mientras Mara esperaba."],
      fr: ["« Je ne sais pas », dit Mara.", "« Tu viens ? » demanda Tom.", "Mara attendit. « Peut-être », dit-elle."],
      de: ["„Geht’s dir gut?“, fragte Mara.", "„Ich weiß es nicht“, sagte Tom.", "Mara wartete. „Vielleicht“, sagte sie."]
    };
    for (const [code, lines] of Object.entries(cases)) {
      const { root } = languageProject(code);
      writeCharacter(root, "mara-quill", "Mara Quill");
      writeCharacter(root, "tom-reed", "Tom Reed");
      // The pronoun tag names nobody, so Mara, in the narration, is not
      // taken for the speaker of the third line.
      writeChapter(root, 1, lines);
      const report = voicesReport(root);
      expect(`${code} ${report.skipped.map((entry) => entry.check).join(",")}`).toBe(`${code} ${code === "de" ? "" : "contractions"}`);
      expect(`${code} ${report.profiles.map((entry) => `${entry.id}:${entry.lines}`).sort().join(",")}`).toBe(`${code} mara-quill:1,tom-reed:1`);
      expect(report.unattributed).toBe(1);
      if (code === "de") {
        expect(report.profiles.find((entry) => entry.id === "mara-quill").contractions).toBeGreaterThan(0);
        expect(report.profiles.find((entry) => entry.id === "tom-reed").contractions).toBe(0);
      }
    }
  });

  test("sentences keep each language's abbreviations, and German ordinals", () => {
    expect(splitSentences("Llegó la Sra. García. Se fue.", { pack: languagePack("es") })).toEqual(["Llegó la Sra. García.", "Se fue."]);
    expect(splitSentences("Mme Roux vit M. Dupont. Il partit.", { pack: languagePack("fr") })).toEqual(["Mme Roux vit M. Dupont.", "Il partit."]);
    const german = languagePack("de");
    expect(splitSentences("Er kam am 3. Mai. Dann ging er. Es war 1999. Später kam Dr. Weber, z. B. heute.", { pack: german }))
      .toEqual(["Er kam am 3. Mai.", "Dann ging er.", "Es war 1999.", "Später kam Dr. Weber, z. B. heute."]);
    // Only a pack with ordinalStop reads a number that way.
    expect(splitSentences("It was 3. May came.")).toEqual(["It was 3.", "May came."]);
  });

  test("names drop each language's titles", () => {
    expect(givenName("Don Alonso Quijano", languagePack("es"))).toBe("Alonso");
    expect(givenName("Mme. Roux", languagePack("fr"))).toBe("Roux");
    expect(givenName("Frau Dr. Weber", languagePack("de"))).toBe("Weber");
  });
});

describe("import in Spanish, French, and German", () => {
  const books = {
    es: "# Prólogo\n\nAntes.\n\n# Capítulo primero\n\nUno.\n\n# Capítulo veintiuno: El puerto\n\nDos.\n\n# Capítulo treinta y dos\n\nTres.\n",
    fr: "# Prologue\n\nAvant.\n\n# Chapitre premier\n\nUn.\n\n# Chapitre vingt et un : Le port\n\nDeux.\n\n# Chapitre quatre-vingt-dix-sept\n\nTrois.\n",
    de: "# Prolog\n\nVorher.\n\n# Kapitel Eins\n\nEins.\n\n# Kapitel Einundzwanzig: Der Hafen\n\nZwei.\n\n# Kapitel Hundertzwei\n\nDrei.\n"
  };
  const titles = {
    es: ["Prólogo", "Chapter 2", "El puerto", "Chapter 4"],
    fr: ["Prologue", "Chapter 2", "Le port", "Chapter 4"],
    de: ["Prolog", "Chapter 2", "Der Hafen", "Chapter 4"]
  };

  test("splits on each language's headings and spelled-out numbers", () => {
    for (const code of PACKS) {
      const cwd = makeTempDir();
      fs.writeFileSync(path.join(cwd, "book.md"), books[code]);
      const result = importManuscript({ source: "book.md", title: "Book", cwd, language: code });
      expect(`${code} ${result.chapters}`).toBe(`${code} 4`);
      expect(scanProject(result.root).chapters.map((chapter) => chapter.title)).toEqual(titles[code]);
    }
  });

  test("plain-text headings need the number, in any case", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.txt"), "CAPÍTULO UNO\n\nUno.\n\nCapítulo 2: El mar\n\nDos.\n\nCapítulo es una palabra.\n");
    expect(importManuscript({ source: "book.txt", title: "Libro", cwd, language: "es" }).chapters).toBe(2);
  });

  test("German name candidates leave out capitalised common nouns", () => {
    const prose = Array.from({ length: 4 }, () => [
      "Anna öffnete die Tür und sah Lukas. Die Tür knarrte. Er hörte die alte Tür und dachte an die Hoffnung.",
      "Sie sprach mit Lukas über Anna und über Hoffnung. Herr Weber nickte, und Anna lachte.",
      "Sie sah Anna an, und Lukas winkte. Die kleine Anna winkte zurück.",
      "Am Montag kam etwas Neues: nichts Neues für Lukas."
    ].join(" ")).join("\n\n");
    const german = extractNameCandidates(prose, languagePack("de"));
    expect(german.map((entry) => entry.name)).toEqual(["Anna", "Lukas", "Weber"]);
    // Without the German rules, the nouns pass for names.
    expect(extractNameCandidates(prose, languagePack("en")).map((entry) => entry.name)).toContain("Tür");
  });

  test("French and Spanish name candidates skip titles and sentence words", () => {
    const french = "M. Dupont parla à Élodie. Madame Roux vit Élodie. Puis Élodie partit avec Madame Roux. Madame Roux sourit.";
    expect(extractNameCandidates(french, languagePack("fr"))).toEqual([{ name: "Élodie", count: 3 }, { name: "Roux", count: 3 }]);
    const spanish = "Vio a Lucía en Sevilla. Habló con Lucía en Sevilla. Señora Pérez buscó a Lucía en Sevilla.";
    expect(extractNameCandidates(spanish, languagePack("es"))).toEqual([{ name: "Lucía", count: 3 }, { name: "Sevilla", count: 3 }]);
  });
});

describe("style-sheet word lists", () => {
  test("add-words supplies lists a language lacks, turning its checks on", () => {
    const { root, cwd } = languageProject("it");
    writeStyleSheet(root, [
      "add-words:",
      "  - filter-words: sentì, vide",
      "  - adverb-suffixes: mente",
      "  - adverb-exceptions: mente, clemente",
      "  - speech-verbs: disse, chiese",
      "  - speech-pronouns: lui, lei"
    ].join("\n"));
    const paragraphs = [];
    for (let index = 0; index < 5; index += 1) {
      paragraphs.push("Sentì il freddo e vide il mare. Camminava lentamente con la mente altrove.", "«Vieni», disse Mara.", "«No», disse lei.");
    }
    writeCharacter(root, "mara-quill", "Mara Quill");
    writeChapter(root, 1, paragraphs);
    const report = proseReport(root);
    expect(report.skipped.map((entry) => entry.check)).toEqual(["dialogue-tags", "echoes", "repeated-phrases"]);
    expect(report.chapters[0].analysis.filterWords).toEqual([{ word: "sentì", count: 5 }, { word: "vide", count: 5 }]);
    expect(report.chapters[0].analysis.adverbs).toEqual([{ word: "lentamente", count: 5 }]);
    expect(invoke(cwd, ["prose", root]).out).toContain("  Adverbs: ");

    const voices = voicesReport(root);
    expect(voices.skipped.map((entry) => entry.check)).toEqual(["contractions", "signature-words"]);
    expect(voices.profiles.map((entry) => `${entry.id}:${entry.lines}`)).toEqual(["mara-quill:5"]);
    expect(voices.unattributed).toBe(5);
    expect(validateProject(root).warnings.map((warning) => warning.code)).not.toContain("unknown-word-list");
  });

  test("replace-words swaps a pack's list, and [] empties one", () => {
    const { root } = languageProject("en");
    writeStyleSheet(root, [
      "replace-words:",
      "  - filter-words: Noticed",
      "  - filter-words: wondered",
      "  - said-bookisms: []",
      "add-words:",
      "  - filter-words: glimpsed",
      "  - title-abbreviations: Insp"
    ].join("\n"));
    const project = scanProject(root);
    expect(project.pack).not.toBe(languagePack("en"));
    expect(project.pack.tag).toBe("en");
    expect(Object.isFrozen(project.pack.checks.filterWords)).toBe(true);
    expect(checkList(project.pack, "filterWords")).toEqual(["noticed", "wondered", "glimpsed"]);
    expect(checkList(project.pack, "saidBookisms")).toEqual([]);
    expect(checkList(project.pack, "titleAbbreviations")).toContain("Insp");
    const analysis = analyzeChapter("She felt it. She noticed it and glimpsed him. \"Go,\" she hissed.", proseRules({}, [], project.pack));
    expect(analysis.filterWords).toEqual([{ word: "glimpsed", count: 1 }, { word: "noticed", count: 1 }]);
    expect(analysis.bookisms).toEqual([]);
    expect(splitSentences("Insp. Hale left. He ran.", { pack: project.pack })).toEqual(["Insp. Hale left.", "He ran."]);
  });

  test("a project without word-list entries keeps the shared pack", () => {
    const { root } = languageProject("fr");
    writeStyleSheet(root, "allow-words:\n  - vraiment");
    expect(scanProject(root).pack).toBe(languagePack("fr"));
    expect(withStyleLists(languagePack("de"), null)).toBe(languagePack("de"));
    expect(withStyleLists(languagePack("de"), { "add-words": [{ "no-such-list": "x" }, { "filter-words": 3 }] })).toBe(languagePack("de"));
  });

  test("dialect pairs and number words take their own shapes", () => {
    const english = languagePack("en");
    const pack = withStyleLists(english, {
      "add-words": [{ "dialect-pairs": "grey/gray, odd, kerb/curb" }, { "number-words": "zero, eleventy" }],
      "replace-words": [{ "number-joiners": "plus" }]
    });
    expect(checkList(pack, "dialectPairs").slice(-1)).toEqual([["kerb", "curb"]]);
    expect(checkList(pack, "dialectPairs").length).toBe(english.checks.dialectPairs.length + 2);
    expect(checkList(pack, "numberWords")).toMatchObject({ units: english.checks.numberWords.units, words: ["zero", "eleventy"], joiners: ["plus"] });
    const replaced = withStyleLists(english, { "replace-words": [{ "number-words": "un, deux" }] });
    expect(checkList(replaced, "numberWords")).toEqual({ joiners: [], words: ["un", "deux"] });
  });

  test("story import reads the style sheet of the project it imports into", () => {
    const { root, cwd } = languageProject("it");
    writeStyleSheet(root, "add-words:\n  - chapter-words: capitolo\n  - number-words: uno, due, tre");
    fs.writeFileSync(path.join(cwd, "libro.md"), "# Capitolo uno\n\nUno.\n\n# Capitolo due: Il porto\n\nDue.\n");
    const result = importManuscript({ source: "libro.md", title: "Language Story", cwd, force: true });
    expect(result.chapters).toBe(2);
    expect(scanProject(root).chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Il porto"]);
  });

  test("validate reports a malformed entry and warns about an unknown list", () => {
    const { root, cwd } = languageProject("es");
    writeStyleSheet(root, [
      "replace-words:",
      "  - filter-word: sintió",
      "  - plain-tags: 3",
      "add-words:",
      "  - said-bookisms: rugió",
      "  - plain"
    ].join("\n"));
    const result = validateProject(root);
    expect(result.errors.map((error) => error.message)).toEqual([
      "style-sheet.md replace-words entry plain-tags must be text: words separated by commas, or [] for none",
      "style-sheet.md frontmatter field add-words must be a list of list: words entries, such as - filter-words: sintió, vio"
    ]);
    expect(result.errors.map((error) => error.code)).toEqual(["field-not-text", "field-not-list"]);
    expect(result.warnings.filter((warning) => warning.code === "unknown-word-list").map((warning) => warning.message))
      .toEqual(["style-sheet.md replace-words entry filter-word is not a word list; the checks ignore it (see docs/project-format.md#word-lists)"]);
    const json = JSON.parse(invoke(cwd, ["validate", root, "--json"]).out);
    expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
  });

  test("the story schema accepts word-list entries as validate does", () => {
    const data = { type: "style-sheet", "replace-words": [{ "filter-words": "sintió, vio" }, { "said-bookisms": [] }], "add-words": [{ "title-words": "don" }] };
    expect(validateAgainstSchema(data, storySchema.$defs.styleSheet, storySchema)).toEqual([]);
    expect(validateAgainstSchema({ type: "style-sheet", "add-words": "filter-words" }, storySchema.$defs.styleSheet, storySchema)).not.toEqual([]);
  });
});

describe("language edge cases", () => {
  test("French adverbs skip nouns and verbs after an article, pronoun, or elision", () => {
    const rules = proseRules({}, [], languagePack("fr"));
    const analysis = analyzeChapter([
      "Dans l’appartement, le mouvement de l’élément était lent. Elle avançait lentement, vraiment lentement, et le bâillement du chat dura un moment.",
      "Les flammes s’enflamment et ils aiment le parlement. Avec étonnement, il comprit qu’évidemment rien n’allait.",
      "D’un grognement, il rangea le paiement et l'aliment. Son rangement était parfaitement net."
    ].join("\n\n"), rules);
    expect(analysis.adverbs).toEqual([{ word: "lentement", count: 2 }, { word: "évidemment", count: 1 }, { word: "parfaitement", count: 1 }, { word: "vraiment", count: 1 }]);
    const spanish = analyzeChapter("Tenía la mente en blanco. Espero que lo lamente y se lamente. Caminaba lentamente.", proseRules({}, [], languagePack("es")));
    expect(spanish.adverbs).toEqual([{ word: "lentamente", count: 1 }]);
    // Que and lo come before adverbs too.
    const before = analyzeChapter("Dijo que finalmente vendría. Lo que realmente importa. Era lo realmente importante. Sabía que rápidamente se iría.", proseRules({}, [], languagePack("es")));
    expect(before.adverbs).toEqual([{ word: "realmente", count: 2 }, { word: "finalmente", count: 1 }, { word: "rápidamente", count: 1 }]);
  });

  test("French tags inside the speech, and after ? or ! in dash dialogue, are tags", () => {
    const french = languagePack("fr");
    const paragraphs = ["« Viens, dit-il, nous partons. »", "— Viens ! s’exclama-t-il.", "— Pourquoi ? demanda Marie.", "« Pourquoi ? demanda-t-elle. »"];
    expect(paragraphs.map((paragraph) => quoteMatches(paragraph, french).map((match) => match.text)))
      .toEqual([["Viens", "nous partons."], ["Viens !"], ["Pourquoi ?"], ["Pourquoi ?"]]);
    expect(narrationOnly(paragraphs[0], french)).toContain("dit-il");
    const analysis = analyzeChapter(paragraphs.join("\n\n"), proseRules({}, [], french));
    expect(analysis.plainTags).toEqual([{ word: "demanda", count: 2 }, { word: "dit", count: 1 }]);
    expect(analysis.bookisms).toEqual([{ word: "s'exclama", count: 1 }]);
    // In dash dialogue speech resumes after an incise that closes with a
    // comma, even after more words; a comma that ends no tag is speech.
    const dashes = ["— Viens, dit-il, nous partons.", "— Viens, dit Paul en souriant, nous partons.", "— C'est fini, dit-on souvent, mais non.", "— Viens, mon ami, nous partons.", "— Viens, dit-il."];
    expect(dashes.map((paragraph) => quoteMatches(paragraph, french).map((match) => match.text)))
      .toEqual([["Viens", "nous partons."], ["Viens", "nous partons."], ["C'est fini", "mais non."], ["Viens, mon ami, nous partons."], ["Viens"]]);
    expect(narrationOnly(dashes[1], french).trim()).toBe("dit Paul en souriant");
    // English has no incise: the comma inside a quote is speech.
    expect(quoteMatches("\"Come, said he, we leave.\"").map((match) => match.text)).toEqual(["Come, said he, we leave."]);

    const { root } = languageProject("fr");
    writeCharacter(root, "mara-quill", "Mara Quill");
    writeCharacter(root, "tom-reed", "Tom Reed");
    writeChapter(root, 1, ["« Viens, dit Mara, nous partons. »", "« Non ! » s’écria Tom.", "— Pourquoi ? demanda Mara."]);
    const report = voicesReport(root);
    expect(report.profiles.map((entry) => `${entry.id}:${entry.lines}`).sort()).toEqual(["mara-quill:3", "tom-reed:1"]);
  });

  test("German names survive relative pronouns, spoken articles, and noun-like endings", () => {
    const prose = Array.from({ length: 3 }, () => [
      "Die Frau, die Lena kannte, kam aus Hamburg. Lena lachte.",
      "„Komm her“, rief der Peter. „Wo ist der Peter?“ Dann sagte Peter nichts mehr.",
      "Herr Jung nickte. „Ja“, sagte Gretchen, und Jannis sah Gretchen an. Jannis wartete.",
      "Vor Angst trank sie Wasser. Mit Kindern aus Häusern spielte sie, mit Kindern und mit Wasser, aus Angst.",
      "Die Hoffnung blieb. Sie sprach von der Hoffnung und von Hoffnung."
    ].join(" ")).join("\n\n");
    expect(extractNameCandidates(prose, languagePack("de")).map((entry) => entry.name)).toEqual(["Peter", "Gretchen", "Hamburg", "Jannis", "Jung", "Lena"]);
    // A name at the very start of the text has nothing before it.
    expect(extractNameCandidates("Nur Lena lachte. Dann kam Lena. Sie sah Lena.", languagePack("de"))).toEqual([{ name: "Lena", count: 3 }]);
  });

  test("headings with the number first, unaccented, and in Belgian or Swiss French", () => {
    const books = {
      de: ["# Erster Teil\n\nVorher.\n\n# Erstes Kapitel\n\nEins.\n\n# 2. Kapitel: Der Hafen\n\nZwei.\n", ["Opening", "Chapter 2", "Der Hafen"]],
      es: ["# Primera parte\n\nAntes.\n\n# Capitulo 7\n\nUno.\n\n# Prologo\n\nDos.\n", ["Opening", "Chapter 2", "Prologo"]],
      fr: ["# Première partie\n\nAvant.\n\n# Chapitre septante-deux\n\nUn.\n\n# Deuxième partie\n\n# Chapitre nonante : La fin\n\nDeux.\n", ["Opening", "Chapter 2", "La fin"]]
    };
    for (const [code, [book, titles]] of Object.entries(books)) {
      const cwd = makeTempDir();
      fs.writeFileSync(path.join(cwd, "book.md"), book);
      const result = importManuscript({ source: "book.md", title: "Book", cwd, language: code });
      expect(`${code} ${scanProject(result.root).chapters.map((chapter) => chapter.title).join(", ")}`).toBe(`${code} ${titles.join(", ")}`);
    }
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "buch.txt"), "Erstes Kapitel\n\nEins.\n\n2. Kapitel\n\nZwei.\n");
    expect(importManuscript({ source: "buch.txt", title: "Buch", cwd, language: "de" }).chapters).toBe(2);
  });

  test("sentences keep EE. UU., p. m., av. J.-C., accented initials, and sog.", () => {
    expect(splitSentences("Viajó a EE. UU. en mayo. Volvió a las 9 p. m. Luego durmió.", { pack: languagePack("es") }))
      .toEqual(["Viajó a EE. UU. en mayo.", "Volvió a las 9 p. m.", "Luego durmió."]);
    expect(splitSentences("César mourut en 44 av. J.-C. Puis vint É. Zola. Il partit.", { pack: languagePack("fr") }))
      .toEqual(["César mourut en 44 av. J.-C.", "Puis vint É. Zola.", "Il partit."]);
    expect(splitSentences("Der sog. Experte kam. Es kostete 3 Mio. Euro. Dann ging er.", { pack: languagePack("de") }))
      .toEqual(["Der sog. Experte kam.", "Es kostete 3 Mio. Euro.", "Dann ging er."]);
    expect(splitSentences("Llegó Á. Pérez. Se fue.", { pack: languagePack("es") })).toEqual(["Llegó Á. Pérez.", "Se fue."]);
    // Only capitals are initials, and only in a pack with capitalInitials:
    // a one-letter word still ends a sentence, and English is as before.
    expect(splitSentences("Это была я. Потом она ушла.", { pack: languagePack("ru") })).toEqual(["Это была я.", "Потом она ушла."]);
    expect(splitSentences("Sim, é. Depois saiu.", { pack: languagePack("pt") })).toEqual(["Sim, é.", "Depois saiu."]);
    expect(splitSentences("Il vint à é. Puis partit.", { pack: languagePack("fr") })).toEqual(["Il vint à é.", "Puis partit."]);
    expect(splitSentences("He met É. Zola. She saw Ö. Then left.")).toEqual(["He met É.", "Zola.", "She saw Ö.", "Then left."]);
  });

  test("plural tags count", () => {
    const counts = (code, text) => analyzeChapter(text, proseRules({}, [], languagePack(code))).plainTags;
    expect(counts("es", "—Vamos —dijeron ellos.")).toEqual([{ word: "dijeron", count: 1 }]);
    expect(counts("fr", "« Allons », dirent-ils.")).toEqual([{ word: "dirent", count: 1 }]);
    expect(counts("de", "„Gehen wir“, sagten sie.")).toEqual([{ word: "sagten", count: 1 }]);
  });

  test("style-sheet values may be flow lists, and abbreviations may keep their stop", () => {
    expect(styleWords("[sintió, \"vio\", 'oyó']")).toEqual(["sintió", "vio", "oyó"]);
    expect(styleWords(["a", " b "])).toEqual(["a", "b"]);
    expect(styleWords([1])).toBeNull();
    const { root } = languageProject("it");
    writeStyleSheet(root, "add-words:\n  - filter-words: [sentì, vide]\n  - title-abbreviations: Sig., Sig.ra");
    const project = scanProject(root);
    expect(checkList(project.pack, "filterWords")).toEqual(["sentì", "vide"]);
    expect(checkList(project.pack, "titleAbbreviations")).toEqual(["Sig", "Sig.ra"]);
    expect(splitSentences("Il Sig. Rossi arrivò. Partì.", { pack: project.pack })).toEqual(["Il Sig. Rossi arrivò.", "Partì."]);
    expect(validateProject(root).errors).toEqual([]);
    const data = { type: "style-sheet", "add-words": [{ "filter-words": ["sentì", "vide"] }] };
    expect(validateAgainstSchema(data, storySchema.$defs.styleSheet, storySchema)).toEqual([]);
  });

  test("import reads a style sheet in a folder without story.md", () => {
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(cwd, "libro"));
    writeStyleSheet(path.join(cwd, "libro"), "add-words:\n  - chapter-words: capitolo");
    expect(existingStyleData(path.join(cwd, "libro"))).toMatchObject({ "add-words": [{ "chapter-words": "capitolo" }] });
    fs.writeFileSync(path.join(cwd, "libro.md"), "# Capitolo 1\n\nUno.\n\n# Capitolo 2\n\nDue.\n");
    expect(importManuscript({ source: "libro.md", title: "Libro", cwd, dir: "libro", language: "it", force: true }).chapters).toBe(2);
    // A file where the folder should be has no style sheet.
    fs.writeFileSync(path.join(cwd, "file"), "");
    expect(existingStyleData(path.join(cwd, "file"))).toBeNull();
  });
});

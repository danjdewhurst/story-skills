import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fillLabel, joinNames, LABEL_KEYS, languagePack } from "../src/languages/index.js";
import { chapterHeading } from "../src/markdown.js";
import { formatRuntime, narrationRate, narrationScript } from "../src/narration.js";
import { buildLabels, publishingMeta, textDirection } from "../src/publishing.js";
import { buildBook, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, messages, readArchiveText, writeMarkdown } from "./helpers.js";

const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

// The languages with translated labels, and Traditional Chinese.
const TRANSLATED = ["es", "fr", "de", "it", "pt", "nl", "sv", "pl", "ru", "uk", "tr", "ar", "he", "fa", "hi", "ja", "zh", "ko", "zh-Hant"];

function project(title, storyFields = "") {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title, force: false });
  const storyPath = path.join(created.root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(`title: ${title}\n`, `title: ${title}\n${storyFields}`), "utf8");
  return created.root;
}

function chapter(root, number, title, body) {
  writeMarkdown(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), `number: ${number}\nstatus: draft\ntitle: ${title}`, `## Chapter Text\n\n${body}\n`);
}

function build(root, format, options = {}) {
  const { outFile } = buildBook(root, { format, ...options });
  return format === "epub" || format === "docx" ? readArchiveText(outFile) : fs.readFileSync(outFile, "utf8");
}

const placeholders = (text) => [...String(text).matchAll(/\{([a-z]+)\}/g)].map((match) => match[1]).sort();

describe("build labels", () => {
  test("every translated pack has every label, with English's placeholders", () => {
    const english = languagePack("en").labels;
    expect(Object.keys(english).sort()).toEqual([...LABEL_KEYS].sort());
    for (const tag of TRANSLATED) {
      const labels = languagePack(tag).labels;
      for (const key of LABEL_KEYS) {
        expect({ tag, key, has: typeof labels[key] === "string" }).toEqual({ tag, key, has: true });
        // {form} is an English noun, so other languages may leave it out.
        expect({ tag, key, placeholders: placeholders(labels[key]).filter((name) => name !== "form") })
          .toEqual({ tag, key, placeholders: placeholders(english[key]).filter((name) => name !== "form") });
      }
    }
  });

  test("the schema names every label", () => {
    const schema = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "..", "schemas", "story.schema.json"), "utf8"));
    expect(Object.keys(schema.properties.story.properties.labels.items.properties)).toEqual([...LABEL_KEYS]);
  });

  test("a language without labels falls back to English, key by key", () => {
    expect(languagePack("cs").labels).toEqual({});
    expect(fillLabel(languagePack("cs").labels, "contents")).toBe("Contents");
    expect(fillLabel(undefined, "chapter", { n: 3 })).toBe("Chapter 3");
    expect(buildLabels({ language: "cs" }).contents).toBe("Contents");
  });

  test("fillLabel fills each placeholder once and escapes only the label's own text", () => {
    expect(fillLabel({ and: "{a} & {b}" }, "and", { a: "{b}", b: "<i>B</i>" }, (text) => text.replace(/&/g, "&amp;"))).toBe("{b} &amp; <i>B</i>");
    expect(fillLabel({ note: "Note {unknown}" }, "note")).toBe("Note {unknown}");
    expect(joinNames(["A", "B", "C"], undefined)).toBe("A and B and C");
    expect(joinNames(["A", "B"], languagePack("ar").labels)).toBe("A وB");
    expect(joinNames([], undefined)).toBe("");
  });

  test("chapter headings follow each language's format", () => {
    expect(chapterHeading(3, "Arrival")).toBe("Chapter 3: Arrival");
    const heading = (tag, title = "T") => chapterHeading(1, title, languagePack(tag).labels);
    expect(heading("fr")).toBe("Chapitre 1 : T");
    expect(heading("ru")).toBe("Глава 1. T");
    expect(heading("ja", "風")).toBe("第1章　風");
    expect(heading("zh-TW", "風")).toBe("第1章　風");
    expect(heading("ko")).toBe("제1장 T");
    expect(heading("ar")).toBe("الفصل 1: T");
    expect(heading("fa")).toBe("فصل 1: T");
    // A title that only repeats the label is not printed twice.
    expect(heading("de", "kapitel 1")).toBe("Kapitel 1");
  });

  test("a story in German builds every reader-facing string in German", () => {
    const root = project("Die Glocke", "language: de\nauthors:\n  - Anna\n  - Ben\n  - Cem\ncopyright: © 2026 Anna\npublisher: Kleinverlag\ncover: cover.png\n");
    fs.writeFileSync(path.join(root, "cover.png"), PNG_BYTES);
    chapter(root, 1, "Das Riff", `${"Wort ".repeat(1489)}\n\n* * *\n\nDann Stille.`);
    expect(messages(validateProject(root).errors)).toEqual([]);

    const markdown = build(root, "markdown");
    expect(markdown).toContain("# Kapitel 1: Das Riff");
    expect(markdown).toContain("Alle Rechte vorbehalten.\n\nErschienen bei Kleinverlag");

    const html = build(root, "html", { stamp: "r2", noteUrl: "https://example.com/new" });
    expect(html).toContain("<title>Die Glocke: Leseexemplar</title>");
    expect(html).toContain('<p class="byline">Anna und Ben und Cem</p>');
    expect(html).toContain('<p class="note">Leseexemplar, Fassung <code>r2</code>. Jeder Absatz hat eine Kennung wie <code>ch03-p12</code> (Kapitel 3, Absatz 12). Geben Sie bei jeder Anmerkung die Kennung, die Fassung und die ersten Wörter des Absatzes an,');
    expect(html).toContain('aria-label="Szenenwechsel"');
    expect(html).toContain('title="Anmerkung zu ch01-p1 schreiben"');
    expect(html).toContain('title="Link zu ch01-p1"');
    expect(html).toContain(">Anmerkung</a>");
    expect(html).toContain('<nav aria-label="Inhalt"><h2>Inhalt</h2>');
    expect(html).toContain('<a href="#matter-front-copyright">Impressum</a>');

    const print = build(root, "print");
    expect(print).toContain("<h1>Inhalt</h1>");
    expect(print).toContain('aria-label="Szenenwechsel"');
    expect(print).toContain('<p class="author">Anna und Ben und Cem</p>');

    const epub = build(root, "epub");
    expect(epub).toContain('alt="Cover von Die Glocke"');
    expect(epub).toContain(">Beginn des Inhalts</a>");
    expect(epub).toContain("Buch mit Text und beschriebenem Coverbild");
    expect(epub).toContain("<h1>Kapitel 1: Das Riff</h1>");

    const shunn = build(root, "shunn");
    expect(shunn).toContain("Die Glocke\nvon\nAnna und Ben und Cem\n\nEtwa 1.500 Wörter\n");
    const shunnDocx = readArchiveText(buildBook(root, { format: "docx", shunn: true }).outFile);
    expect(shunnDocx).toContain(">von</w:t>");
    expect(shunnDocx).toContain(">Etwa 1.500 Wörter</w:t>");

    const narration = build(root, "narration");
    expect(narration).toContain("Die Glocke. Geschrieben von Anna und Ben und Cem. Gelesen von [narrator].");
    expect(narration).toContain("Ende. Sie hörten Die Glocke, geschrieben von Anna und Ben und Cem, gelesen von [narrator].");
    expect(narration).toContain("at 120 words per minute");

    const fountain = build(root, "fountain");
    expect(fountain).toContain("Credit: Geschrieben von\nAuthor: Anna und Ben und Cem\nSource: Nach einer Vorlage von Anna und Ben und Cem\n");
    expect(fountain).toContain("## Kapitel 1: Das Riff");
  });

  test("Japanese sets sentences without spaces, a byline without by, and counts characters", () => {
    const root = project("Kaze", "language: ja\nauthor: 山田\n");
    chapter(root, 1, "風", "風が吹いた。");
    const html = build(root, "html");
    expect(html).toContain("<title>Kaze（レビュー用原稿）</title>");
    expect(html).toContain('<p class="note">レビュー用の原稿です。各段落には <code>ch03-p12</code>（第3章の第12段落）のようなラベルが付いています。コメントには');
    expect(html).toContain("<h2>第1章　風</h2>");
    expect(build(root, "shunn")).toContain("Kaze\n山田\n\n約6字\n");
    const narration = build(root, "narration");
    expect(narration).toContain("『Kaze』。作、山田。朗読、[narrator]。");
    expect(narration).toContain("at 300 characters per minute (6 characters)");
  });

  test("story.md labels override the pack, and chapter-label and contents-label still work", () => {
    const root = project("Teile", [
      "language: de",
      "chapter-label: Abschnitt",
      "contents-label: Übersicht",
      "labels:",
      "  - chapter: Teil",
      "  - chapter-heading: \"{chapter} – {title}\"",
      "  - by: \"\"",
      "  - scene-break: Pause",
      ""
    ].join("\n"));
    chapter(root, 1, "Anfang", "Eins.\n\n* * *\n\nZwei.");
    expect(messages(validateProject(root).errors)).toEqual([]);
    const html = build(root, "html");
    expect(html).toContain("<h2>Teil 1 – Anfang</h2>");
    expect(html).toContain('<nav aria-label="Übersicht">');
    expect(html).toContain('aria-label="Pause"');

    const aliases = buildLabels({ language: "fr", "chapter-label": "第{n}章", "contents-label": " Sommaire " });
    expect(aliases.chapter).toBe("第{n}章");
    expect(aliases.contents).toBe("Sommaire");
    expect(aliases["chapter-heading"]).toBe("{chapter} : {title}");
    // A blank chapter label is ignored; a [TODO] placeholder too.
    expect(buildLabels({ labels: [{ chapter: " " }, { contents: "[TODO: later]" }] })).toMatchObject({ chapter: "Chapter {n}", contents: "Contents" });
  });

  test("validate checks the labels list", () => {
    const shape = project("Shape", "labels: Kapitel\n");
    expect(messages(validateProject(shape).errors)).toContain("story.md frontmatter field labels must be a list of label: text entries, such as - chapter: Teil {n}");
    const entries = project("Entries", "labels:\n  - chapter: 3\n  - chapters: Teil\n");
    const result = validateProject(entries);
    expect(messages(result.errors)).toContain("story.md labels entry chapter must be text");
    expect(messages(result.warnings)).toContain("story.md labels entry chapters is not a build label; builds ignore it (see docs/manuscripts.md#build-labels)");
  });

  test("a blank or [TODO] label is unset and warned about, except a blank by", () => {
    const root = project("Blank", [
      "labels:",
      "  - chapter-heading: \"\"",
      "  - copyright: \" \"",
      "  - start-of-content: \"\"",
      "  - contents: \"[TODO: ask the editor]\"",
      "  - by: \"\"",
      "copyright: © 2026 Ada",
      ""
    ].join("\n"));
    chapter(root, 1, "Arrival", "Text.");
    const warnings = messages(validateProject(root).warnings);
    expect(warnings).toContain("story.md labels entry chapter-heading is blank; builds use the language's own text");
    expect(warnings).toContain("story.md labels entry copyright is blank; builds use the language's own text");
    expect(warnings).toContain("story.md labels entry contents is still a [TODO] placeholder; builds use the language's own text");
    expect(warnings.filter((warning) => warning.includes("entry by"))).toEqual([]);
    const epub = build(root, "epub");
    expect(epub).toContain("<h1>Chapter 1: Arrival</h1>");
    expect(epub).toContain(">Start of Content</a>");
    expect(epub).toContain('<a href="front-copyright.xhtml">Copyright</a>');
    expect(epub).toContain('<h1>Contents</h1>');
    expect(buildLabels({ labels: [{ by: "" }] }).by).toBe("");
  });

  test("an and label that drops a name falls back to a comma", () => {
    expect(joinNames(["A", "B", "C"], { and: "" })).toBe("A, B, C");
    expect(joinNames(["A", "B"], { and: "{a} &" })).toBe("A, B");
    expect(joinNames(["A", "B"], buildLabels({ labels: [{ and: "{a} & {b}" }] }))).toBe("A & B");
  });

  test("Traditional Chinese tags get Traditional labels", () => {
    for (const tag of ["zh-Hant", "zh-TW", "zh-HK", "zh-Hant-TW", "zh-yue", "yue", "lzh"]) {
      expect(publishingMeta({ language: tag }).labels.contents).toBe("目錄");
    }
    expect(publishingMeta({ language: "zh-CN" }).labels.contents).toBe("目录");
    expect(languagePack("yue")).toMatchObject({ cased: false, segmentation: "character", script: "Hant" });
  });

  test("European Portuguese changes only the labels that differ", () => {
    const european = publishingMeta({ language: "pt-PT" }).labels;
    expect(european.copyright).toBe("Direitos de autor");
    expect(european["anchor-title"]).toBe("Ligação para {label}");
    expect(european.contents).toBe(languagePack("pt").labels.contents);
    expect(publishingMeta({ language: "pt-BR" }).labels.copyright).toBe("Direitos autorais");
  });

  test("text direction reads language aliases as the packs do", () => {
    for (const tag of ["fas", "per", "heb", "iw", "ara", "ar-arz"]) {
      expect({ tag, direction: textDirection(tag) }).toEqual({ tag, direction: "rtl" });
    }
    expect(textDirection("fa-Latn")).toBe("ltr");
    expect(textDirection("")).toBe("ltr");
  });

  test("narration runtime uses the pack's rate in the book's count unit", () => {
    expect(formatRuntime(300 * 61, 300)).toBe("1h 01m");
    const chapters = [{ number: 1, title: "C", heading: "C", body: "字".repeat(600) }];
    const script = narrationScript({ title: "N", unit: "characters", meta: publishingMeta({ language: "ja" }), front: [], chapters, back: [] }, []);
    expect(script).toContain("0h 02m at 300 characters per minute (600 characters)");
    expect(script).toContain("[about 2 min]");
    expect(narrationRate(publishingMeta({ language: "zh" }), "characters")).toBe(300);
    // A pack's rate is in its own count unit: a German book counted in
    // characters, or a Japanese one counted in words, gets the default.
    expect(narrationRate(publishingMeta({ language: "de" }), "words")).toBe(120);
    expect(narrationRate(publishingMeta({ language: "de" }), "characters")).toBe(300);
    expect(narrationRate(publishingMeta({ language: "ja" }), "words")).toBe(155);
    const german = narrationScript({ title: "N", unit: "characters", meta: publishingMeta({ language: "de", "count-unit": "characters" }), front: [], chapters, back: [] }, []);
    expect(german).toContain("at 300 characters per minute (600 characters)");
    // English keeps its rate and its credit when the title ends a sentence.
    const english = narrationScript({ title: "Run!", meta: publishingMeta({}), front: [], chapters, back: [] }, []);
    expect(english).toContain("at 155 words per minute");
    expect(english).toContain("Run! Narrated by [narrator].");
  });
});

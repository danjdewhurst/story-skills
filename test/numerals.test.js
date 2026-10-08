import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { chapterHeading } from "../src/markdown.js";
import { CHAPTER_NUMERALS, chapterNumerals, formatNumeral, nativeNumerals } from "../src/numerals.js";
import { buildLabels, publishingMeta } from "../src/publishing.js";
import { buildBook, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, messages, readArchiveText, writeMarkdown } from "./helpers.js";

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

const codes = (findings) => findings.map((finding) => finding.code);

const SAMPLES = [1, 2, 9, 10, 11, 12, 19, 20, 21, 99, 100, 101, 110, 111, 999, 1000, 1001, 1010, 10000, 10001, 10100, 11000, 100000, 1010000, 100000001];

describe("chapter numerals", () => {
  test("Japanese Han numerals drop 一 before 十, 百, and 千 and write no zero", () => {
    expect(SAMPLES.map((n) => formatNumeral(n, "jpan"))).toEqual([
      "一", "二", "九", "十", "十一", "十二", "十九", "二十", "二十一", "九十九", "百", "百一", "百十", "百十一", "九百九十九",
      "千", "千一", "千十", "一万", "一万一", "一万百", "一万千", "十万", "百一万", "一億一"
    ]);
  });

  test("Chinese Han numerals keep 一 except before a leading 十 and mark skipped places with 零", () => {
    expect(SAMPLES.map((n) => formatNumeral(n, "hans"))).toEqual([
      "一", "二", "九", "十", "十一", "十二", "十九", "二十", "二十一", "九十九", "一百", "一百零一", "一百一十", "一百一十一", "九百九十九",
      "一千", "一千零一", "一千零一十", "一万", "一万零一", "一万零一百", "一万一千", "十万", "一百零一万", "一亿零一"
    ]);
    expect(formatNumeral(10010, "hant")).toBe("一萬零一十");
    expect(formatNumeral(200000000, "hant")).toBe("二億");
    expect([formatNumeral(0, "jpan"), formatNumeral(0, "hans")]).toEqual(["〇", "零"]);
    // 兆 (10^12) covers every safe integer; Simplified Chinese writes 万亿,
    // or 万 before a 亿 group of its own.
    expect([formatNumeral(1e12, "jpan"), formatNumeral(1e12, "hant"), formatNumeral(1e12, "hans")]).toEqual(["一兆", "一兆", "一万亿"]);
    expect(formatNumeral(1e12 + 1, "hans")).toBe("一万亿零一");
    expect(formatNumeral(1234500000000, "hans")).toBe("一万二千三百四十五亿");
    expect(formatNumeral(1000100000000, "hans")).toBe("一万零一亿");
    expect(formatNumeral(1234500000000, "jpan")).toBe("一兆二千三百四十五億");
    expect(formatNumeral(Number.MAX_SAFE_INTEGER, "jpan")).toBe("九千七兆千九百九十二億五千四百七十四万九百九十一");
    // Past the safe integers, the number keeps 0-9.
    expect(formatNumeral(2 ** 60, "jpan")).toBe(String(2 ** 60));
  });

  test("digit systems swap each digit from fixed tables, without grouping", () => {
    expect(formatNumeral(1234567890, "arab")).toBe("١٢٣٤٥٦٧٨٩٠");
    expect(formatNumeral(1234567890, "arabext")).toBe("۱۲۳۴۵۶۷۸۹۰");
    expect(formatNumeral(1234567890, "deva")).toBe("१२३४५६७८९०");
    expect(formatNumeral(1234567890, "beng")).toBe("১২৩৪৫৬৭৮৯০");
    expect(formatNumeral(1234567890, "thai")).toBe("๑๒๓๔๕๖๗๘๙๐");
    expect(formatNumeral(12, "latn")).toBe("12");
    expect(formatNumeral(12, "unknown")).toBe("12");
    // Each table agrees with the runtime's own digits for that system.
    for (const system of ["arab", "arabext", "deva", "beng", "guru", "gujr", "orya", "tamldec", "telu", "knda", "mlym", "thai", "laoo", "tibt", "mymr", "khmr", "mong", "nkoo", "mtei"]) {
      expect({ system, text: formatNumeral(9876543210, system) }).toEqual({ system, text: new Intl.NumberFormat("en", { numberingSystem: system, useGrouping: false }).format(9876543210) });
    }
  });

  test("each language gets its script's numerals, or none", () => {
    const table = Object.fromEntries(["ja", "jpn", "ja-Hani", "zh", "cmn", "zh-Hant", "zh-TW", "yue", "yue-CN", "zh-Hani", "zh-Bopo", "ar", "ckb", "fa", "ur", "urd", "ps", "pus", "sd", "snd", "ug", "uig", "pa", "pa-Arab", "hi", "mr", "ne", "bn", "th", "lo", "km", "my", "bo", "mn-Mong", "en", "ko", "he", "ru", "mn", "ar-Latn"].map((tag) => [tag, nativeNumerals(tag)]));
    expect(table).toEqual({
      ja: "jpan", jpn: "jpan", "ja-Hani": "jpan", zh: "hans", cmn: "hans", "zh-Hant": "hant", "zh-TW": "hant", yue: "hant", "yue-CN": "hans", "zh-Hani": "hans", "zh-Bopo": "hant",
      ar: "arab", ckb: "arab", fa: "arabext", ur: "arabext", urd: "arabext", ps: "arabext", pus: "arabext", sd: "arab", snd: "arab", ug: "arab", uig: "arab",
      "pa-Arab": "arabext", pa: "guru", hi: "deva", mr: "deva", ne: "deva", bn: "beng",
      th: "thai", lo: "laoo", km: "khmr", my: "mymr", bo: "tibt", "mn-Mong": "mong", en: null, ko: null, he: null, ru: null, mn: null, "ar-Latn": null
    });
    // Tags whose script the typesetting table does not name: N'Ko and
    // Manipuri by language, Dari, and Azerbaijani in Iran and Uzbek in
    // Afghanistan, which use the Persian digit forms in Arabic script.
    const more = Object.fromEntries(["nqo", "nqo-Nkoo", "mni", "mni-Beng", "mni-Mtei", "prs", "prs-AF", "az-IR", "az-Arab", "az", "uz-AF", "uz-Arab", "uz"].map((tag) => [tag, nativeNumerals(tag)]));
    expect(more).toEqual({
      nqo: "nkoo", "nqo-Nkoo": "nkoo", mni: "beng", "mni-Beng": "beng", "mni-Mtei": "mtei", prs: "arabext", "prs-AF": "arabext",
      "az-IR": "arabext", "az-Arab": "arabext", az: null, "uz-AF": "arabext", "uz-Arab": "arabext", uz: null
    });
    for (const language of ["nqo", "mni", "prs", "az-IR"]) {
      expect({ language, codes: codes(validateProject(project(`Book ${language}`, `language: ${language}\nchapter-numerals: native\n`)).errors) }).toEqual({ language, codes: [] });
    }
    expect(chapterNumerals({ language: "ja" })).toBe("latn");
    expect(chapterNumerals({ language: "ja", "chapter-numerals": "western" })).toBe("latn");
    expect(chapterNumerals({ language: "ja", "chapter-numerals": "native" })).toBe("jpan");
    expect(chapterNumerals({ language: "en", "chapter-numerals": "native" })).toBe("latn");
    expect(chapterNumerals({ language: "ar", "chapter-numerals": "hindi" })).toBe("latn");
    expect([...CHAPTER_NUMERALS]).toEqual(["western", "native"]);
  });

  test("chapterHeading puts the numerals in the chapter label and drops a title that repeats either form", () => {
    const ja = buildLabels({ language: "ja" });
    expect(chapterHeading(12, "風", ja, "jpan")).toBe("第十二章　風");
    expect(chapterHeading(3, "第3章", ja, "jpan")).toBe("第三章");
    expect(chapterHeading(3, "第三章", ja, "jpan")).toBe("第三章");
    expect(chapterHeading(3, "第三章", ja)).toBe("第3章　第三章");
    // Full-width digits repeat the number too.
    expect(chapterHeading(12, "第１２章", ja, "jpan")).toBe("第十二章");
    expect(chapterHeading(12, "第１２章", ja)).toBe("第12章");
    expect(chapterHeading(12, "البداية", buildLabels({ language: "ar" }), "arab")).toBe("الفصل ١٢: البداية");
    // A chapter label without {n} still takes the number after it.
    expect(chapterHeading(4, "", buildLabels({ language: "hi", "chapter-label": "भाग" }), "deva")).toBe("भाग ४");
    expect(chapterHeading(4, "Arrival")).toBe("Chapter 4: Arrival");
  });

  test("a Japanese book prints Han numerals in every format, and keeps ids, file names, and anchors in 0-9", () => {
    const root = project("Kaze", "language: ja\nauthor: 山田\nwriting-mode: vertical\nchapter-numerals: native\n");
    chapter(root, 1, "風", "風が吹いた。");
    chapter(root, 12, "雨", "雨が降った。");
    expect(validateProject(root).errors).toEqual([]);
    expect(publishingMeta({ language: "ja", "chapter-numerals": "native" }).chapterNumerals).toBe("jpan");

    const html = build(root, "html");
    expect(html).toContain("<h2>第一章　風</h2>");
    expect(html).toContain("第十二章　雨");
    expect(html).not.toContain("第12章");
    expect(html).toContain('id="ch12-p1"');
    // The review note's example label stays a label.
    expect(html).toContain("<code>ch03-p12</code>（第3章の第12段落）");

    const epub = build(root, "epub");
    expect(epub).toContain("OEBPS/chapter-12.xhtml");
    expect(epub).toContain('<a href="chapter-12.xhtml">第十二章　雨</a>');
    expect(epub).toContain("<h1>第十二章　雨</h1>");
    expect(epub).not.toContain("第12章");

    for (const format of ["markdown", "print", "docx", "shunn", "narration", "fountain"]) {
      const text = build(root, format);
      expect({ format, han: text.includes("第十二章") }).toEqual({ format, han: true });
      expect({ format, latin: text.includes("第12章") }).toEqual({ format, latin: false });
    }
  });

  test("Arabic, Persian, Hindi, Thai, and Chinese books print their own numerals", () => {
    const cases = [
      ["ar", "الفصل ١٢: ب"],
      ["fa", "فصل ۱۲: ب"],
      ["hi", "अध्याय १२: ब"],
      // Thai has no labels yet, so the number goes into English's.
      ["th", "Chapter ๑๒: ข"],
      ["zh", "第十二章　乙"],
      ["zh-TW", "第十二章　乙"]
    ];
    for (const [language] of cases) {
      const root = project(`Book ${language}`, `language: ${language}\nchapter-numerals: native\n`);
      chapter(root, 12, { ar: "ب", fa: "ب", hi: "ब", th: "ข" }[language] ?? "乙", "Text.");
      const markdown = build(root, "markdown");
      const expected = cases.find(([tag]) => tag === language)[1];
      expect({ language, heading: markdown.includes(`# ${expected}`) }).toEqual({ language, heading: true });
    }
  });

  test("western, or no setting, builds the same bytes as before", () => {
    const plain = project("Plain", "language: ja\n");
    const western = project("Plain", "language: ja\nchapter-numerals: western\n");
    for (const root of [plain, western]) {
      chapter(root, 2, "風", "風が吹いた。");
    }
    expect(build(western, "html")).toBe(build(plain, "html"));
    expect(build(plain, "html")).toContain("<h2>第2章　風</h2>");
  });

  test("validate rejects other values and native for a language without numerals of its own", () => {
    const english = validateProject(project("English", "chapter-numerals: native\n"));
    expect(codes(english.errors)).toContain("unsupported-chapter-numerals");
    expect(messages(english.errors)).toContain("story.md chapter-numerals native needs a language with its own numerals, such as ja, zh, ar, fa, hi, or th; en prints 0-9, so builds ignore it");
    expect(codes(validateProject(project("Korean", "language: ko\nchapter-numerals: native\n")).errors)).toContain("unsupported-chapter-numerals");
    expect(codes(validateProject(project("Kanji", "language: ja\nchapter-numerals: kanji\n")).errors)).toContain("unsupported-value");
    expect(codes(validateProject(project("List", "language: ja\nchapter-numerals:\n  - native\n")).errors)).toContain("field-not-scalar");
    expect(validateProject(project("Western", "chapter-numerals: western\n")).errors).toEqual([]);

    // Builds ignore the unsupported setting.
    const root = project("Ignored", "chapter-numerals: native\n");
    chapter(root, 3, "Arrival", "Text.");
    expect(build(root, "markdown")).toContain("# Chapter 3: Arrival");
  });
});

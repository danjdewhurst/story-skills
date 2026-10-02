import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { buildBook, createStoryProject, validateProject } from "../src/story.js";
import { languageScript, supportsVertical, typesetting, writtenTag } from "../src/typesetting.js";
import { makeTempDir, readArchiveEntries, writeMarkdown } from "./helpers.js";

// A two-chapter book in `language`, with optional extra story.md lines.
function book(language, extra = "") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Lamp" });
  const storyPath = path.join(root, "story.md");
  const fields = `${language === null ? "" : `language: ${language}\n`}${extra}`;
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\nauthor: Ada\n${fields}`), "utf8");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "\nFirst **bold** and *soft*.\n\n> A letter.\n\n* * *\n\nAfter.\n");
  writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Two\nnumber: 2\nstatus: draft", "\nSecond.\n");
  return root;
}

function text(root, format, options = {}) {
  return fs.readFileSync(buildBook(root, { format, ...options }).outFile, "utf8");
}

function archive(root, format, options = {}) {
  const entries = readArchiveEntries(buildBook(root, { format, ...options }).outFile);
  return Object.fromEntries(entries.map((entry) => [entry.name, entry.content.toString("utf8")]));
}

// Fails unless `xml` is well formed: every tag closes in order, attribute
// values are quoted, and no element repeats an attribute.
function expectWellFormed(xml) {
  const stack = [];
  const body = xml.replace(/^<\?xml[^?]*\?>/, "");
  for (const match of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g)) {
    const [, closing, name, attributes, empty] = match;
    const names = [...attributes.matchAll(/([\w:.-]+)=/g)].map((attribute) => attribute[1]);
    expect(new Set(names).size).toBe(names.length);
    if (closing) {
      expect(stack.pop()).toBe(name);
    } else if (!empty) {
      stack.push(name);
    }
  }
  expect(stack).toEqual([]);
  // Every < starts a tag the pattern above read.
  expect(body.replace(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g, "")).not.toContain("<");
}

// The order WordprocessingML's schema gives these paragraph and run
// properties (CT_PPrBase, CT_RPr): each pPr and rPr must list its children
// in it.
const PPR_ORDER = ["pStyle", "keepNext", "bidi", "spacing", "ind", "jc", "textDirection", "outlineLvl"];
const RPR_ORDER = ["rFonts", "b", "bCs", "i", "iCs", "sz", "szCs", "rtl", "lang"];

function expectSchemaOrder(xml, element, order, ignore = []) {
  for (const match of xml.matchAll(new RegExp(`<w:${element}>(.*?)</w:${element}>`, "g"))) {
    const children = [...match[1].matchAll(/<w:(\w+)[ />]/g)].map((child) => child[1]).filter((name) => !ignore.includes(name));
    const positions = children.map((name) => order.indexOf(name));
    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  }
}

describe("script-aware typesetting", () => {
  test("the script comes from the tag, the pack, or a table of common languages", () => {
    expect(languageScript("en")).toBe("Latn");
    expect(languageScript("ja")).toBe("Jpan");
    expect(languageScript("zh")).toBe("Hans");
    expect(languageScript("zh-TW")).toBe("Hant");
    expect(languageScript("zh-Hant")).toBe("Hant");
    expect(languageScript("zh-Hans-HK")).toBe("Hans");
    expect(languageScript("sr")).toBe("Cyrl");
    expect(languageScript("sr-Latn")).toBe("Latn");
    expect(languageScript("fa")).toBe("Arab");
    expect(languageScript("xx")).toBe("Latn");
    expect(languageScript("chr")).toBe("Cher");

    // Tags resolve as the language packs resolve them, not through Intl:
    // aliases, extlang tags, and grandfathered tags.
    expect(languageScript("iw")).toBe("Hebr");
    expect(languageScript("ji")).toBe("Hebr");
    expect(languageScript("jpn")).toBe("Jpan");
    expect(languageScript("zh-yue")).toBe("Hant");
    expect(languageScript("zh-min-nan")).toBe("Hans");
    for (const code of ["cmn", "wuu", "hak", "nan", "gan", "hsn", "cjy"]) {
      expect(languageScript(code)).toBe("Hans");
    }
    expect(languageScript("lzh")).toBe("Hant");

    // Only the subtag after the language is a script, and only the next a
    // region; extension and private-use subtags never count.
    expect(languageScript("en-x-hani")).toBe("Latn");
    expect(languageScript("en-x-test")).toBe("Latn");
    expect(languageScript("ar-u-nu-latn")).toBe("Arab");
    expect(languageScript("zh-x-tw")).toBe("Hans");
    expect(languageScript("zh-yue-HK")).toBe("Hant");

    expect(writtenTag("en-gb")).toBe("en-GB");
    expect(writtenTag("zh-hant-tw")).toBe("zh-Hant-TW");
    expect(writtenTag("jpn")).toBe("ja");
    expect(writtenTag("iw-il")).toBe("he-IL");
    expect(writtenTag("zh-yue")).toBe("yue");
    expect(writtenTag("ar-u-nu-latn")).toBe("ar-u-nu-latn");
    expect(writtenTag("en-GB-oed")).toBe("en-GB-oxendict");

    expect(typesetting("ja")).toMatchObject({ cased: false, rtl: false, vertical: false });
    expect(typesetting("ja-Latn").cased).toBe(true);
    expect(typesetting("ru").cased).toBe(true);
    expect(typesetting("fa")).toMatchObject({ cased: false, rtl: true });
    expect(typesetting("ja", "vertical").vertical).toBe(true);
    expect(typesetting("en", "vertical").vertical).toBe(false);

    expect(supportsVertical("zh-Hant")).toBe(true);
    expect(supportsVertical("jpn")).toBe(true);
    expect(supportsVertical("ko")).toBe(true);
    expect(supportsVertical("ko-Hang")).toBe(true);
    expect(supportsVertical("ko-Hani")).toBe(true);
    expect(supportsVertical("ar")).toBe(false);
    expect(supportsVertical("en-x-hani")).toBe(false);
    expect(supportsVertical("mn-Mong")).toBe(false);
  });

  test("every font stack ends in a generic family", () => {
    for (const language of ["en", "ru", "el", "ja", "zh", "zh-TW", "ko", "ar", "he", "hi", "th", "km", "chr"]) {
      const { fonts } = typesetting(language);
      expect(fonts.body).toMatch(/, serif$/);
      expect(fonts.heads).toMatch(/, serif$/);
    }
    expect(typesetting("ja").fonts.body).toContain('"Noto Serif CJK JP"');
    expect(typesetting("zh-TW").fonts.body).toContain('"Noto Serif TC"');
    expect(typesetting("ar").fonts.body).toContain('"Noto Naskh Arabic"');
    expect(typesetting("hi").fonts.body).toContain('"Noto Serif Devanagari"');
    expect(typesetting("th").fonts.body).toContain('"Noto Serif Thai"');
    expect(typesetting("ru").fonts.body).toContain('"Noto Serif"');

    // Kana, Hangul, Bopomofo, and Han alone use the fonts of the language
    // they are written for.
    const body = (language) => typesetting(language).fonts.body;
    expect(body("ja-Hira")).toBe(body("ja"));
    expect(body("ja-Kana")).toBe(body("ja"));
    expect(body("ja-Hani")).toBe(body("ja"));
    expect(body("ko-Hang")).toBe(body("ko"));
    expect(body("ko-Hani")).toBe(body("ko"));
    expect(body("zh-Bopo")).toBe(body("zh-Hant"));
    expect(body("zh-Hani")).toBe(body("zh"));
    expect(body("zh-Hani-TW")).toBe(body("zh-Hant"));
    expect(body("yue-Hani")).toBe(body("zh-Hant"));
  });

  test("a print interior in an uncased script drops small caps, the raised initial, and italic heads", () => {
    const english = text(book("en-GB"), "print");
    expect(english).toContain("font: 11pt/1.4 Georgia, \"Iowan Old Style\", \"Palatino Linotype\", serif;");
    expect(english).toContain("font-variant: small-caps; letter-spacing: 0.05em;");
    expect(english).toContain("::first-letter");
    expect(english).toContain("font: italic 9pt Georgia, serif;");

    const japanese = text(book("ja"), "print");
    expect(japanese).toContain(`html { font: 11pt/1.4 ${typesetting("ja").fonts.body}; }`);
    expect(japanese).not.toContain("small-caps");
    expect(japanese).not.toContain("letter-spacing");
    expect(japanese).not.toContain("::first-letter");
    expect(japanese).not.toContain("italic");
    expect(japanese).toContain(`content: counter(page); font: 9pt ${typesetting("ja").fonts.body};`);
    expect(japanese).not.toContain("writing-mode");
    expect(japanese).toContain("break-before: right;");

    const russian = text(book("ru"), "print");
    expect(russian).toContain("font-variant: small-caps");
    expect(russian).toContain(`font: italic 9pt ${typesetting("ru").fonts.body};`);

    const arabic = text(book("ar"), "print");
    expect(arabic).toContain('<html lang="ar" dir="rtl">');
    expect(arabic).toContain('"Noto Naskh Arabic"');
    expect(arabic).not.toContain("small-caps");
  });

  test("the review copy names fonts for the book's script", () => {
    expect(text(book(null), "html")).toContain('font: 1.1rem/1.65 Georgia, "Iowan Old Style", "Palatino Linotype", serif; }');
    expect(text(book("he"), "html")).toContain(`font: 1.1rem/1.65 ${typesetting("he").fonts.body}; }`);
  });

  test("writing-mode: vertical sets HTML and print in columns that turn right to left", () => {
    const root = book("ja", "writing-mode: vertical\n");
    const print = text(root, "print");
    expect(print).toContain("html { writing-mode: vertical-rl; }");
    expect(print).toContain("section.chapter, section.back { page: chapter; break-before: left; }");
    expect(print).toMatch(/@page :left \{\n {2}@top-center \{ content: string\(chapter-title/);
    expect(print).toContain("float: none;");
    expect(print).toContain("Vivliostyle");
    expect(print).toContain("max-height: 8.5in;");
    expect(print).not.toContain('dir="rtl"');

    const review = text(root, "html", { noteUrl: "https://example.com/new" });
    expect(review).toContain("html { writing-mode: vertical-rl; }");
    expect(review).toContain(".anchor, .note-link { position: static;");

    // A language not set vertically ignores it.
    const english = book("en", "writing-mode: vertical\n");
    expect(text(english, "print")).not.toContain("writing-mode");
    expect(text(english, "html")).not.toContain("writing-mode");
  });

  test("EPUB carries a stylesheet only for a non-Latin script or vertical text", () => {
    const english = archive(book("en"), "epub");
    expect(Object.keys(english)).not.toContain("OEBPS/style.css");
    expect(english["OEBPS/chapter-01.xhtml"]).not.toContain("<link");

    const chinese = archive(book("zh-TW"), "epub");
    expect(chinese["OEBPS/style.css"]).toBe(`body { font-family: ${typesetting("zh-TW").fonts.body}; }\n`);
    expect(chinese["OEBPS/content.opf"]).toContain('<item id="style" href="style.css" media-type="text/css"/>');
    expect(chinese["OEBPS/content.opf"]).toContain("<spine>");
    for (const name of ["OEBPS/chapter-01.xhtml", "OEBPS/nav.xhtml"]) {
      expect(chinese[name]).toContain('</title><link rel="stylesheet" type="text/css" href="style.css"/></head>');
      expectWellFormed(chinese[name]);
    }

    const vertical = archive(book("ja", "writing-mode: vertical\n"), "epub");
    expect(vertical["OEBPS/style.css"]).toContain("html { -epub-writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl; writing-mode: vertical-rl; }");
    expect(vertical["OEBPS/content.opf"]).toContain('<spine page-progression-direction="rtl">');
    // Kindle reads the writing mode from this OPF 2 meta.
    expect(vertical["OEBPS/content.opf"]).toContain('<meta name="primary-writing-mode" content="vertical-rl"/></metadata>');
    expect(chinese["OEBPS/content.opf"]).not.toContain("primary-writing-mode");
    expect(vertical["OEBPS/chapter-01.xhtml"]).toContain('xml:lang="ja" lang="ja">');
    expectWellFormed(vertical["OEBPS/content.opf"]);
  });

  test("DOCX leaves the default language alone and names any other", () => {
    const english = archive(book(null), "docx");
    expect(english["word/styles.xml"]).toContain('<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>');
    expect(english["word/styles.xml"]).not.toContain("<w:lang");
    expect(english["word/document.xml"]).toContain("<w:sectPr/></w:body>");

    const british = archive(book("en-GB"), "docx");
    expect(british["word/styles.xml"]).toContain('<w:szCs w:val="24"/><w:lang w:val="en-GB"/></w:rPr>');
    expect(british["word/document.xml"]).not.toContain("<w:rtl/>");

    // Word gets the tag in its usual form, aliases resolved.
    expect(archive(book("jpn"), "docx")["word/styles.xml"]).toContain('<w:lang w:val="ja" w:eastAsia="ja"/>');
    expect(archive(book("zh-hant-tw"), "docx")["word/styles.xml"]).toContain('<w:lang w:val="zh-Hant-TW" w:eastAsia="zh-Hant-TW"/>');
  });

  test("DOCX sets East Asian fonts and language, and vertical text, for Japanese", () => {
    const japanese = archive(book("ja", "writing-mode: vertical\n"), "docx");
    const styles = japanese["word/styles.xml"];
    expect(styles).toContain('<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="MS Mincho" w:cs="Times New Roman" w:hint="eastAsia"/>');
    expect(styles).toContain('<w:lang w:val="ja" w:eastAsia="ja"/>');
    expect(japanese["word/document.xml"]).toContain('<w:sectPr><w:textDirection w:val="tbRl"/></w:sectPr></w:body>');
    for (const xml of [styles, japanese["word/document.xml"]]) {
      expectWellFormed(xml);
      expectSchemaOrder(xml, "pPr", PPR_ORDER);
      expectSchemaOrder(xml, "rPr", RPR_ORDER);
    }
  });

  test("DOCX marks a right-to-left book's paragraphs, runs, and section", () => {
    const root = book("ar");
    const docx = archive(root, "docx");
    const document = docx["word/document.xml"];
    const styles = docx["word/styles.xml"];
    expect(styles).toContain('<w:lang w:val="ar" w:bidi="ar"/>');
    expect(styles).toContain('<w:rPr><w:b/><w:bCs/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr>');
    expect(document).toContain('<w:p><w:pPr><w:pStyle w:val="Title"/><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr>');
    expect(document).toContain('<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">First </w:t></w:r><w:r><w:rPr><w:b/><w:bCs/><w:rtl/></w:rPr>');
    expect(document).toContain("<w:rPr><w:i/><w:iCs/><w:rtl/></w:rPr>");
    expect(document).toContain("<w:sectPr><w:bidi/></w:sectPr></w:body>");
    expect(document.match(/<w:p>/g).length).toBe(document.match(/<w:bidi\/><\/w:pPr>|<w:pPr><w:bidi\/>/g).length);
    for (const xml of [styles, document]) {
      expectWellFormed(xml);
      expectSchemaOrder(xml, "pPr", PPR_ORDER);
      expectSchemaOrder(xml, "rPr", RPR_ORDER);
    }

    const shunn = archive(root, "docx", { shunn: true, out: "dist/shunn.docx" })["word/document.xml"];
    expect(shunn).toContain('<w:p><w:pPr><w:bidi/><w:spacing w:line="480" w:lineRule="auto"/>');
    expect(shunn).toContain('<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/><w:b/><w:bCs/><w:rtl/></w:rPr>');
    // Every run, the chapter heading's page break too, is right to left.
    expect(shunn).toContain('<w:r><w:rPr><w:rtl/></w:rPr><w:br w:type="page"/></w:r>');
    expect(shunn.match(/<w:r>/g).length).toBe(shunn.match(/<w:rtl\/><\/w:rPr>/g).length);
    expectWellFormed(shunn);
    // Shunn runs have always put sz before b and i, so only the order of
    // the other properties is checked.
    expectSchemaOrder(shunn, "pPr", PPR_ORDER);
    expectSchemaOrder(shunn, "rPr", RPR_ORDER, ["b", "bCs", "i", "iCs"]);
  });

  test("validate allows writing-mode: vertical only for a language set vertically", () => {
    const codes = (root) => validateProject(root).errors.map((error) => error.code);
    expect(codes(book("ja", "writing-mode: vertical\n"))).toEqual([]);
    expect(codes(book("zh-Hant", "writing-mode: vertical\n"))).toEqual([]);
    expect(codes(book("ko", "writing-mode: horizontal\n"))).toEqual([]);
    expect(codes(book("ko", "writing-mode: vertical\n"))).toEqual([]);
    expect(codes(book("jpn", "writing-mode: vertical\n"))).toEqual([]);
    expect(codes(book("en-x-hani", "writing-mode: vertical\n"))).toContain("unsupported-writing-mode");
    expect(codes(book(null, "writing-mode: vertical\n"))).toContain("unsupported-writing-mode");
    expect(codes(book("ja", "writing-mode: sideways\n"))).toContain("unsupported-value");
    expect(codes(book("ja", "writing-mode:\n  - vertical\n"))).toContain("field-not-scalar");
    const message = validateProject(book("en", "writing-mode: vertical\n")).errors.find((error) => error.code === "unsupported-writing-mode").message;
    expect(message).toContain("en is set horizontally");
    const mongolian = validateProject(book("mn-Mong", "writing-mode: vertical\n")).errors.find((error) => error.code === "unsupported-writing-mode").message;
    expect(mongolian).toContain("not supported yet for mn-Mong");
    expect(mongolian).toContain("vertical-lr");
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { shunnWordCount } from "../src/packaging.js";
import { textDirection } from "../src/publishing.js";
import { buildBook, createStoryProject, exportManuscript, synopsisBook, validateProject } from "../src/story.js";
import { makeTempDir, readArchiveEntries, writeMarkdown } from "./helpers.js";

const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function newProject(title = "Builds") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

function setStoryFields(root, lines) {
  const storyPath = path.join(root, "story.md");
  const raw = fs.readFileSync(storyPath, "utf8");
  fs.writeFileSync(storyPath, raw.replace("tense: past\n", `tense: past\n${lines}\n`), "utf8");
}

function chapter(root, number, frontmatter, body) {
  writeMarkdown(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), `${frontmatter}\nnumber: ${number}\nstatus: draft`, `\n${body}\n`);
}

function matter(root, id, frontmatter, body) {
  writeMarkdown(path.join(root, "matter", `${id}.md`), frontmatter, `\n${body}\n`);
}

function entry(file, name) {
  return readArchiveEntries(file).find((item) => item.name === name).content.toString("utf8");
}

function words(count) {
  return Array.from({ length: count }, () => "word").join(" ");
}

describe("build and export bug fixes", () => {
  test("#107 DOCX body paragraphs are indented and scene breaks centred", () => {
    const root = newProject();
    chapter(root, 1, "title: One", "First paragraph.\n\nSecond paragraph.\n\n* * *\n\nAfter the break.");

    const plain = buildBook(root, { format: "docx" }).outFile;
    const styles = entry(plain, "word/styles.xml");
    expect(styles).toContain("<w:docDefaults>");
    expect(styles).toContain('w:styleId="Normal"');
    expect(styles).toContain('<w:ind w:firstLine="720"/>');
    const document = entry(plain, "word/document.xml");
    expect(document).toContain('<w:pStyle w:val="SceneBreak"/>');

    const shunn = buildBook(root, { format: "docx", shunn: true, out: "dist/shunn.docx" }).outFile;
    const shunnXml = entry(shunn, "word/document.xml");
    expect(shunnXml).toContain('<w:ind w:firstLine="720"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">First paragraph.');
    expect(shunnXml).toContain('<w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">* * *');
  });

  test("#108 RTL books build right to left in EPUB, HTML, and print", () => {
    expect(textDirection("he")).toBe("rtl");
    expect(textDirection("ar-EG")).toBe("rtl");
    expect(textDirection("az-Arab")).toBe("rtl");
    expect(textDirection("ku-Latn")).toBe("ltr");
    expect(textDirection("en-GB")).toBe("ltr");

    const root = newProject("Rtl");
    setStoryFields(root, "language: he");
    chapter(root, 1, "title: A", "שלום עולם.");

    const epub = buildBook(root, { format: "epub" }).outFile;
    expect(entry(epub, "OEBPS/content.opf")).toContain('<spine page-progression-direction="rtl">');
    expect(entry(epub, "OEBPS/chapter-01.xhtml")).toContain('xml:lang="he" lang="he" dir="rtl"');
    expect(entry(epub, "OEBPS/nav.xhtml")).toContain('dir="rtl"');

    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain('<html lang="he" dir="rtl">');

    const print = fs.readFileSync(buildBook(root, { format: "print" }).outFile, "utf8");
    expect(print).toContain('<html lang="he" dir="rtl">');
    expect(print).toContain("section.chapter, section.back { page: chapter; break-before: left; }");
    expect(print).toMatch(/@page :left \{\n {2}@top-center \{ content: string\(chapter-title/);

    // LTR output is unchanged.
    const ltr = newProject("Ltr");
    chapter(ltr, 1, "title: A", "Hello.");
    expect(entry(buildBook(ltr, { format: "epub" }).outFile, "OEBPS/content.opf")).toContain("<spine>");
    expect(fs.readFileSync(buildBook(ltr, { format: "html" }).outFile, "utf8")).toContain('<html lang="en">');
  });

  test("#110 TODO placeholders and a missing cover are not ticked or published", () => {
    const root = newProject("Gull");
    chapter(root, 1, "title: One", "Text.");
    setStoryFields(root, [
      'author: "[TODO: author to supply]"',
      'publisher: "[TODO: author to supply]"',
      'copyright: "[TODO: author to supply]"',
      "cover: assets/cover.png",
      'cover-alt: "A lighthouse"'
    ].join("\n"));

    const sheet = fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8");
    expect(sheet).toContain("- [ ] Author named");
    expect(sheet).toContain("- [ ] Publisher or imprint");
    expect(sheet).toContain("- [ ] Copyright line");
    expect(sheet).toContain("- [ ] Cover image");
    expect(validateProject(root).warnings).toContain("story.md author is still a [TODO] placeholder; builds leave it out");

    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(path.join(root, "assets", "cover.png"), PNG_BYTES);
    expect(fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8")).toContain("- [x] Cover image");

    const opf = entry(buildBook(root, { format: "epub" }).outFile, "OEBPS/content.opf");
    expect(opf).not.toContain("[TODO");
  });

  test("#118 only the copyright page moves ahead of the print contents", () => {
    const root = newProject("Order");
    chapter(root, 1, "title: C1", "Text.");
    matter(root, "dedication", "title: Dedication\nplacement: front\norder: 1\nheading: false", "For you.");
    matter(root, "copyright", "title: Copyright\nplacement: front\norder: 2", "Copyright 2026 me.");
    const html = fs.readFileSync(buildBook(root, { format: "print" }).outFile, "utf8");
    const order = [...html.matchAll(/<section class="title-page">|<section id="[^"]+"|<nav class="toc">/g)].map((match) => match[0]);
    expect(order.slice(0, 4)).toEqual(['<section class="title-page">', '<section id="front-copyright"', '<nav class="toc">', '<section id="front-dedication"']);
    expect(html).not.toContain("front front");
  });

  test("#120 blank and missing chapter titles fall back to Chapter N", () => {
    const root = newProject("Untitled");
    chapter(root, 1, 'title: "   "', "Body one.");
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "number: 2\nstatus: draft", "\nBody two.\n");
    const epub = buildBook(root, { format: "epub" }).outFile;
    expect(entry(epub, "OEBPS/chapter-01.xhtml")).toContain("<title>Chapter 1</title>");
    expect(entry(epub, "OEBPS/chapter-02.xhtml")).toContain("<h1>Chapter 2</h1>");
    expect(validateProject(root).errors).toContain("chapters/chapter-01.md is missing frontmatter field title");
  });

  test("#121 and #219 the Shunn title page has no bare by and a rounded count", () => {
    expect(shunnWordCount(11)).toBe("11");
    expect(shunnWordCount(1489)).toBe("1,500");
    expect(shunnWordCount(87342)).toBe("87,000");

    const root = newProject("Shunn");
    chapter(root, 1, "title: One", words(1489));
    const markdown = fs.readFileSync(buildBook(root, { format: "shunn" }).outFile, "utf8");
    expect(markdown.startsWith("Shunn\n\nApproximately 1,500 words\n")).toBe(true);
    const docx = entry(buildBook(root, { format: "docx", shunn: true }).outFile, "word/document.xml");
    expect(docx).not.toContain(">by<");
    expect(docx).toContain("Approximately 1,500 words");
  });

  test("#122 --out refuses a trailing slash, an empty path, and a dist file", () => {
    const root = newProject();
    chapter(root, 1, "title: One", "Text.");
    expect(() => exportManuscript(root, { out: "newdir/" })).toThrow("--out newdir/ is a directory");
    expect(() => buildBook(root, { out: "dist/sub/" })).toThrow("--out dist/sub/ is a directory");
    expect(fs.existsSync(path.join(root, "newdir"))).toBe(false);
    expect(() => synopsisBook(root, { out: "" })).toThrow("--out needs a file path");
    fs.writeFileSync(path.join(root, "dist"), "file");
    expect(() => buildBook(root, { out: "dist" })).toThrow("--out dist is reserved for the build folder");
  });

  test("#123 large covers build and a symlinked cover is refused as a symlink", () => {
    const root = newProject();
    chapter(root, 1, "title: One", "Text.");
    fs.mkdirSync(path.join(root, "art"));
    fs.writeFileSync(path.join(root, "art", "big.png"), PNG_BYTES);
    fs.truncateSync(path.join(root, "art", "big.png"), 6 * 1024 * 1024);
    setStoryFields(root, "cover: art/big.png");
    expect(buildBook(root, { format: "epub" }).format).toBe("epub");

    fs.symlinkSync("big.png", path.join(root, "art", "link.png"));
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("cover: art/big.png", "cover: art/link.png"));
    expect(() => buildBook(root, { format: "epub" })).toThrow("Refusing to read through symlink");
  });

  test("#230 a heading-less back page resets the print running head", () => {
    const root = newProject();
    chapter(root, 1, "title: One", "Text.");
    matter(root, "thanks", "title: Acknowledgments\nplacement: back\norder: 1", "Thanks to everyone.");
    matter(root, "about", "title: About the Author\nplacement: back\norder: 2\nheading: false", "Jo Quill lives by the sea.");
    const html = fs.readFileSync(buildBook(root, { format: "print" }).outFile, "utf8");
    expect(html).toContain('<section id="back-about" class="back"><div class="running-head" aria-hidden="true"></div>');
    expect(html).toContain("section.back > .running-head { string-set: chapter-title content(text); }");
  });

  test("#238 --trim is case-insensitive and checked before building", () => {
    const root = newProject();
    chapter(root, 1, "title: One", "Text.");
    expect(fs.readFileSync(buildBook(root, { format: "PRINT", trim: "A5" }).outFile, "utf8")).toContain("size: 148mm 210mm");
    expect(fs.readFileSync(buildBook(root, { format: "print", trim: "6X9" }).outFile, "utf8")).toContain("size: 6in 9in");
    const empty = newProject("Empty");
    // No chapters: an unknown trim is reported before "No chapters found".
    expect(() => buildBook(empty, { format: "print", trim: "b5" })).toThrow("Unsupported trim size: b5");
  });
});

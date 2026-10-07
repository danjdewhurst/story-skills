import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { estimateBookPages, printHtml } from "../src/html.js";
import { importManuscript } from "../src/import.js";
import { shunnWordCount } from "../src/packaging.js";
import { textDirection } from "../src/publishing.js";
import { buildBook, createEntity, createStoryProject, exportManuscript, synopsisBook, validateProject } from "../src/story.js";
import { makeTempDir, readArchiveEntries, writeMarkdown, messages, readArchiveText, memoryIo } from "./helpers.js";

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

function bugsProject(title = "Bugs") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function appendProse(root, file, prose) {
  fs.appendFileSync(path.join(root, file), `\n${prose}\n`);
}

function build(root, format) {
  return fs.readFileSync(buildBook(root, { format, out: `dist/book.${format}` }).outFile, "utf8");
}

function storyWithFields(title = "Open Builds", storyFields = "") {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title, force: false });
  const storyPath = path.join(created.root, "story.md");
  if (storyFields !== "") {
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(`title: ${title}\n`, `title: ${title}\n${storyFields}`), "utf8");
  }
  return { root: created.root, cwd };
}

function writeChapterFile(root, number, frontmatter, body) {
  writeMarkdown(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), `
number: ${number}
${/^status:/m.test(frontmatter) ? "" : "status: draft"}
${frontmatter}
`, `## Chapter Text\n\n${body}\n`);
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
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
    expect(messages(validateProject(root).warnings)).toContain("story.md author is still a [TODO] placeholder; builds leave it out");

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
    expect(messages(validateProject(root).errors)).toContain("chapters/chapter-01.md is missing frontmatter field title");
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

describe("#184 a # scene break with a trailing space", () => {
  test("stays a scene break in every build; an empty ## heading is dropped", () => {
    const root = bugsProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "First part.\n\n#\n\nSecond part.\n\n# \n\nThird.\n\n## \n\nFourth.");
    expect(build(root, "html").match(/class="scene-break"/g)).toHaveLength(2);
    const narration = build(root, "narration").replace(/\n+/g, " ");
    expect(narration).toContain("First part. [pause] Second part. [pause] Third. Fourth.");
    const docx = readArchiveText(buildBook(root, { format: "docx", out: "dist/book.docx" }).outFile);
    expect(docx.match(/\* \* \*/g)).toHaveLength(2);
    expect(docx).not.toContain(">##<");
  });
});

describe("unnumbered chapters (#244)", () => {
  test("import marks Prologue, Epilogue, and {.unnumbered} chapters and builds keep the author's numbering", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), "# Prologue\n\nBefore it all.\n\n# Chapter 1: Arrival\n\nFirst text.\n\n# Chapter 2: Interval {.unnumbered}\n\nBetween.\n\n# Chapter 3: Departure\n\nSecond text.\n\n# Epilogue\n\nAfter.\n", "utf8");
    const { root } = importManuscript({ source: "book.md", title: "Pro Book", cwd });
    const prologue = fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8");
    expect(prologue).toContain("numbered: false");
    expect(prologue).toContain("# Prologue\n");
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-03.md"), "utf8")).toContain("title: Interval\nnumber: 3\nnumbered: false");
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-02.md"), "utf8")).not.toContain("numbered:");
    expect(messages(validateProject(root).errors)).toEqual([]);

    const print = fs.readFileSync(buildBook(root, { format: "print" }).outFile, "utf8");
    expect(print.match(/<h1>[^<]*<\/h1>/g).slice(2)).toEqual([
      "<h1>Prologue</h1>", "<h1>Chapter 1: Arrival</h1>", "<h1>Interval</h1>", "<h1>Chapter 2: Departure</h1>", "<h1>Epilogue</h1>"
    ]);
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    for (const anchor of ["prologue-p1", "ch01-p1", "interval-p1", "ch02-p1", "epilogue-p1"]) {
      expect(html).toContain(`id="${anchor}"`);
    }
    const epub = readArchiveText(buildBook(root, { format: "epub" }).outFile);
    expect(epub).toContain('<li><a href="chapter-01.xhtml">Prologue</a></li><li><a href="chapter-02.xhtml">Chapter 1: Arrival</a></li>');
    expect(fs.readFileSync(exportManuscript(root).outFile, "utf8")).toContain("# Prologue\n\nBefore it all.\n\n# Chapter 1: Arrival");
    expect(fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8")).toContain("## Epilogue\n");
  });

  test("importing a Story Skills chapter keeps numbered: false", () => {
    const cwd = makeTempDir();
    const source = path.join(cwd, "source");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "01-prologue.md"), "---\ntitle: Prologue\nnumber: 1\nnumbered: false\nstatus: draft\n---\n\n# Prologue\n\n## Chapter Text\n\nBefore it all.\n", "utf8");
    fs.writeFileSync(path.join(source, "02-arrival.md"), "---\ntitle: Arrival\nnumber: 2\nstatus: draft\n---\n\n# Chapter 1: Arrival\n\n## Chapter Text\n\nFirst text.\n", "utf8");
    const { root } = importManuscript({ source: "source", title: "Own Book", cwd });
    const prologue = fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8");
    expect(prologue).toContain("title: Prologue\nnumber: 1\nnumbered: false");
    expect(prologue).toContain("# Prologue\n");
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-02.md"), "utf8")).not.toContain("numbered:");
  });

  test("an unnumbered chapter needs a title, and numbered must be a boolean", () => {
    const { root } = storyWithFields();
    writeChapterFile(root, 1, `title: ""\nnumbered: false`, "Text.");
    writeChapterFile(root, 2, "title: Two\nnumbered: nope", "Text.");
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain("chapters/chapter-01.md is unnumbered (numbered: false), so it needs a title to print as its heading");
    expect(errors).toContain("chapters/chapter-02.md numbered must be true or false");
    expect(() => buildBook(root, { format: "html" })).toThrow("chapters/chapter-01.md: an unnumbered chapter needs a title to build");
  });

  test("an unnumbered title that looks like another label falls back to the file number", () => {
    const { root } = storyWithFields();
    writeChapterFile(root, 1, "title: CH01\nnumbered: false", "Odd.");
    writeChapterFile(root, 2, "title: One", "Text.");
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain('id="unnumbered-01-p1"');
    expect(html).toContain('id="ch01-p1"');
  });
});

describe("localised labels (#243)", () => {
  test("chapter-label and contents-label replace the English labels in every build", () => {
    const { root } = storyWithFields("Die Glocke", "language: de\nchapter-label: Kapitel\ncontents-label: Inhalt\n");
    writeChapterFile(root, 1, "title: Das Riff", "Die Glocke läutete.");
    expect(messages(validateProject(root).errors)).toEqual([]);

    const print = fs.readFileSync(buildBook(root, { format: "print" }).outFile, "utf8");
    expect(print).toContain("<h1>Inhalt</h1>");
    expect(print).toContain("<h1>Kapitel 1: Das Riff</h1>");
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain('<nav aria-label="Inhalt"><h2>Inhalt</h2>');
    const epub = readArchiveText(buildBook(root, { format: "epub" }).outFile);
    expect(epub).toContain('<nav epub:type="toc" id="toc"><h1>Inhalt</h1>');
    expect(epub).toContain("<h1>Kapitel 1: Das Riff</h1>");
    expect(fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8")).toContain("## Kapitel 1: Das Riff");
    expect(fs.readFileSync(buildBook(root).outFile, "utf8")).toContain("# Kapitel 1: Das Riff");
    expect(readArchiveText(buildBook(root, { format: "docx" }).outFile)).toContain("Kapitel 1: Das Riff");
  });

  test("a {n} in chapter-label places the number, and a non-text label is a validate error", () => {
    const { root } = storyWithFields("Kaze", "chapter-label: 第{n}章\n");
    writeChapterFile(root, 1, "title: 風", "風が吹いた。");
    expect(fs.readFileSync(buildBook(root, { format: "print" }).outFile, "utf8")).toContain("<h1>第1章: 風</h1>");

    const other = storyWithFields("Bad Label", "chapter-label: 3\n");
    expect(messages(validateProject(other.root).errors)).toContain("story.md frontmatter field chapter-label must be text");
  });
});

describe("print page estimate (#222)", () => {
  test("counts whole chapter pages, recto blanks, the title page, and the contents", () => {
    const parts = Array.from({ length: 60 }, (_, index) => ({ key: `ch${index + 1}`, kind: "chapter", title: `C${index + 1}`, heading: true, words: 1333, paragraphs: [] }));
    const book = { title: "PG", authors: [], language: "en", words: 79980, parts };
    const pages = estimateBookPages(book, "6x9");
    expect(pages).toBeGreaterThanOrEqual(330);
    expect(pages).toBeLessThanOrEqual(340);
    const html = printHtml(book, "6x9");
    expect(html).toContain(`about ${pages} pages`);
    expect(html).toContain("@page { size: 6in 9in; margin: 0.75in 0.5in 0.75in 0.875in; }");
  });

  test("a front copyright page shares the title page's verso", () => {
    const chapterPart = { key: "ch1", kind: "chapter", title: "One", heading: true, words: 300, paragraphs: [] };
    const copyright = { key: "copyright", kind: "matter", title: "Copyright", heading: false, words: 50, paragraphs: [], copyright: true, placement: "front" };
    const book = { title: "PG", authors: [], language: "en", words: 350, parts: [chapterPart] };
    expect(estimateBookPages({ ...book, parts: [copyright, chapterPart] })).toBe(estimateBookPages(book));
  });

  test("the metadata sheet quotes the same estimate as the print build", () => {
    const { root } = storyWithFields();
    writeChapterFile(root, 1, "title: One", "word ".repeat(700));
    writeChapterFile(root, 2, "title: Two", "word ".repeat(700));
    const print = fs.readFileSync(buildBook(root, { format: "print", trim: "6x9" }).outFile, "utf8");
    const pages = /about (\d+) pages/.exec(print)[1];
    const sheet = fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8");
    expect(sheet).toContain(`at 5.5x8.5, ${pages} at 6x9 |`);
    // 2 title pages, 1.5 for the contents, and 2 chapters of
    // ceil(700 / 300 + 0.3) + 0.5 pages: 10.5, rounded up.
    expect(pages).toBe("11");
  });
});

describe("empty chapters (#134)", () => {
  test("build and export warn about a chapter with no prose", () => {
    const { root, cwd } = storyWithFields();
    writeChapterFile(root, 1, "title: One", "She climbed.");
    writeChapterFile(root, 2, "title: Unwritten\nstatus: outline", "");
    const result = invoke(cwd, ["build", root, "--format", "epub"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("warning: chapters/chapter-02.md has no prose yet and is built as a heading-only page");
    expect(invoke(cwd, ["export", root]).err).toContain("chapters/chapter-02.md has no prose yet");
    expect(buildBook(root, { format: "html" }).warnings).toHaveLength(1);
  });

  test("validate warns once the chapter or the story claims to be finished", () => {
    const { root } = storyWithFields();
    writeChapterFile(root, 1, "title: One", "She climbed.");
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Unwritten\nnumber: 2\nstatus: outline\n", "## Chapter Text\n");
    const warning = "chapters/chapter-02.md has no prose yet, so export and build print it as a heading-only page";
    expect(messages(validateProject(root).warnings)).not.toContain(warning);

    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^status: \w+/m, "status: complete"), "utf8");
    expect(messages(validateProject(root).warnings)).toContain(warning);
  });
});

describe("skill-owned folders under --out (#188)", () => {
  test("--out never replaces a file in feedback/, submission/, publishing/, or adaptations/", () => {
    const { root } = storyWithFields();
    writeChapterFile(root, 1, "title: One", "Text.");
    const notes = path.join(root, "feedback", "round-1", "ann.md");
    fs.mkdirSync(path.dirname(notes), { recursive: true });
    fs.writeFileSync(notes, "Important notes.\n", "utf8");

    expect(() => exportManuscript(root, { out: "feedback/round-1/ann.md" })).toThrow("Refusing to overwrite feedback/round-1/ann.md: files in feedback/, submission/, publishing/, adaptations/ may hold hand-written work");
    expect(fs.readFileSync(notes, "utf8")).toBe("Important notes.\n");

    for (const folder of ["Submission", "publishing", "adaptations"]) {
      const target = path.join(root, folder, "kept.md");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "Mine.\n", "utf8");
      expect(() => buildBook(root, { format: "markdown", out: `${folder}/kept.md` })).toThrow("Refusing to overwrite");
      expect(fs.readFileSync(target, "utf8")).toBe("Mine.\n");
    }
  });

  test("a new file in a skill-owned folder is still written", () => {
    const { root } = storyWithFields();
    writeChapterFile(root, 1, "title: One", "Text.");
    const result = synopsisBook(root, { out: "submission/synopsis-1-page.md" });
    expect(fs.existsSync(result.outFile)).toBe(true);
    expect(() => synopsisBook(root, { out: "submission/synopsis-1-page.md" })).toThrow("Refusing to overwrite submission/synopsis-1-page.md");
    expect(buildBook(root, { format: "narration", out: "adaptations/audiobook/narration-script.md" }).outFile).toContain("adaptations");
  });
});

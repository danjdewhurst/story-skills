import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { estimateBookPages, printHtml } from "../src/html.js";
import { importManuscript } from "../src/import.js";
import { buildBook, createStoryProject, exportManuscript, synopsisBook, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, readArchiveText, writeMarkdown, messages } from "./helpers.js";

function project(title = "Open Builds", storyFields = "") {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title, force: false });
  const storyPath = path.join(created.root, "story.md");
  if (storyFields !== "") {
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(`title: ${title}\n`, `title: ${title}\n${storyFields}`), "utf8");
  }
  return { root: created.root, cwd };
}

function chapter(root, number, frontmatter, body) {
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

const SONG = "The old song went:\n\n*Ember given, fire kept,\\\nEmber taken, mountain wept,  \nWhat the Vale has lent.*\n\n> Dear Mara,\n>\n> Come home.\\\n> Your father\n\nShe hummed it anyway.";

describe("hard breaks and blockquotes (#245)", () => {
  test("a quoted line directly after a plain line starts its own paragraph", () => {
    const { root } = project();
    chapter(root, 1, "title: One", "She read the note.\n> Come home.");
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toMatch(/<p id="ch01-p1">.*She read the note\.<\/p>\n<blockquote>\n<p id="ch01-p2">.*Come home\.<\/p>\n<\/blockquote>/);
  });

  test("every paragraph build keeps hard breaks and sets quotes as blockquotes", () => {
    const { root } = project();
    chapter(root, 1, "title: Song", SONG);

    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain("<em>Ember given, fire kept,<br>Ember taken, mountain wept,<br>What the Vale has lent.</em>");
    expect(html).toMatch(/<blockquote>\n<p id="ch01-p3">.*Dear Mara,<\/p>\n<p id="ch01-p4">.*Come home\.<br>Your father<\/p>\n<\/blockquote>\n<p id="ch01-p5">/);

    const print = fs.readFileSync(buildBook(root, { format: "print" }).outFile, "utf8");
    expect(print).toContain("<blockquote>\n<p>Dear Mara,</p>\n<p>Come home.<br>Your father</p>\n</blockquote>");

    const epub = readArchiveText(buildBook(root, { format: "epub" }).outFile);
    expect(epub).toContain("<em>Ember given, fire kept,<br/>Ember taken, mountain wept,<br/>What the Vale has lent.</em>");
    expect(epub).toContain("<blockquote><p>Dear Mara,</p><p>Come home.<br/>Your father</p></blockquote><p>She hummed it anyway.</p>");

    const docx = readArchiveText(buildBook(root, { format: "docx" }).outFile);
    expect(docx).toContain(`fire kept,</w:t><w:br/><w:t xml:space="preserve">Ember taken`);
    expect(docx).toContain(`<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t xml:space="preserve">Dear Mara,</w:t></w:r></w:p>`);
    expect(docx).toContain(`w:styleId="Quote"`);

    const shunnDocx = readArchiveText(buildBook(root, { format: "docx", shunn: true, out: "dist/s.docx" }).outFile);
    expect(shunnDocx).toContain(`<w:ind w:left="720" w:right="720" w:firstLine="0"/>`);
    expect(shunnDocx).toContain(`Come home.</w:t><w:br/><w:t xml:space="preserve">Your father`);

    const shunn = fs.readFileSync(buildBook(root, { format: "shunn" }).outFile, "utf8");
    expect(shunn).toContain("*Ember given, fire kept,\\\nEmber taken, mountain wept,\\\nWhat the Vale has lent.*");
    expect(shunn).toContain("> Dear Mara,\n\n> Come home.\\\n> Your father\n\nShe hummed it anyway.");
  });

  test("a soft line break still joins, and a trailing backslash ends no line", () => {
    const { root } = project();
    chapter(root, 1, "title: Soft", "One line\nand the next.\\");
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain("One line and the next.\\</p>");
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
    const { root } = project();
    chapter(root, 1, `title: ""\nnumbered: false`, "Text.");
    chapter(root, 2, "title: Two\nnumbered: nope", "Text.");
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain("chapters/chapter-01.md is unnumbered (numbered: false), so it needs a title to print as its heading");
    expect(errors).toContain("chapters/chapter-02.md numbered must be true or false");
    expect(() => buildBook(root, { format: "html" })).toThrow("chapters/chapter-01.md: an unnumbered chapter needs a title to build");
  });

  test("an unnumbered title that looks like another label falls back to the file number", () => {
    const { root } = project();
    chapter(root, 1, "title: CH01\nnumbered: false", "Odd.");
    chapter(root, 2, "title: One", "Text.");
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain('id="unnumbered-01-p1"');
    expect(html).toContain('id="ch01-p1"');
  });
});

describe("localised labels (#243)", () => {
  test("chapter-label and contents-label replace the English labels in every build", () => {
    const { root } = project("Die Glocke", "language: de\nchapter-label: Kapitel\ncontents-label: Inhalt\n");
    chapter(root, 1, "title: Das Riff", "Die Glocke läutete.");
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
    const { root } = project("Kaze", "chapter-label: 第{n}章\n");
    chapter(root, 1, "title: 風", "風が吹いた。");
    expect(fs.readFileSync(buildBook(root, { format: "print" }).outFile, "utf8")).toContain("<h1>第1章: 風</h1>");

    const other = project("Bad Label", "chapter-label: 3\n");
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
    const { root } = project();
    chapter(root, 1, "title: One", "word ".repeat(700));
    chapter(root, 2, "title: Two", "word ".repeat(700));
    const print = fs.readFileSync(buildBook(root, { format: "print", trim: "6x9" }).outFile, "utf8");
    const pages = /about (\d+) pages/.exec(print)[1];
    const sheet = fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8");
    expect(sheet).toContain(`at 5.5x8.5, ${pages} at 6x9 |`);
    // 2 title pages, 1.5 for the contents, and 2 chapters of
    // ceil(700 / 300 + 0.3) + 0.5 pages: 10.5, rounded up.
    expect(pages).toBe("11");
  });
});

describe("Shunn short-story layout (#135)", () => {
  test("short-story and flash forms join chapters with a centred # and no headings or page breaks", () => {
    const { root } = project("Gull", "form: short-story\n");
    chapter(root, 1, "title: Part 1", "Text one.\n\n* * *\n\nAfter the break.");
    chapter(root, 2, "title: Part 2", "Text two.");
    chapter(root, 3, "title: Part 3", "");

    const docx = readArchiveText(buildBook(root, { format: "docx", shunn: true }).outFile);
    expect(docx).not.toContain('w:type="page"');
    expect(docx).not.toContain("Part 1");
    expect(docx.match(/<w:t xml:space="preserve">#<\/w:t>/g)).toHaveLength(2);

    const shunn = fs.readFileSync(buildBook(root, { format: "shunn" }).outFile, "utf8");
    expect(shunn).not.toContain("\f");
    expect(shunn).not.toContain("Part 1");
    expect(shunn).toContain("Text one.\n\n#\n\nAfter the break.\n\n#\n\nText two.\n");
    expect(shunn.trimEnd().endsWith("Text two.")).toBe(true);
  });

  test("a novel keeps chapter headings on new pages", () => {
    const { root } = project("Long", "form: novel\n");
    chapter(root, 1, "title: Part 1", "Text one.");
    const shunn = fs.readFileSync(buildBook(root, { format: "shunn" }).outFile, "utf8");
    expect(shunn).toContain("\f\n# Chapter 1: Part 1");
  });
});

describe("empty chapters (#134)", () => {
  test("build and export warn about a chapter with no prose", () => {
    const { root, cwd } = project();
    chapter(root, 1, "title: One", "She climbed.");
    chapter(root, 2, "title: Unwritten\nstatus: outline", "");
    const result = invoke(cwd, ["build", root, "--format", "epub"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("warning: chapters/chapter-02.md has no prose yet and is built as a heading-only page");
    expect(invoke(cwd, ["export", root]).err).toContain("chapters/chapter-02.md has no prose yet");
    expect(buildBook(root, { format: "html" }).warnings).toHaveLength(1);
  });

  test("validate warns once the chapter or the story claims to be finished", () => {
    const { root } = project();
    chapter(root, 1, "title: One", "She climbed.");
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
    const { root } = project();
    chapter(root, 1, "title: One", "Text.");
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
    const { root } = project();
    chapter(root, 1, "title: One", "Text.");
    const result = synopsisBook(root, { out: "submission/synopsis-1-page.md" });
    expect(fs.existsSync(result.outFile)).toBe(true);
    expect(() => synopsisBook(root, { out: "submission/synopsis-1-page.md" })).toThrow("Refusing to overwrite submission/synopsis-1-page.md");
    expect(buildBook(root, { format: "narration", out: "adaptations/audiobook/narration-script.md" }).outFile).toContain("adaptations");
  });
});

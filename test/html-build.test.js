import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { estimatePages, printHtml } from "../src/html.js";
import { htmlBook, inlineHtml } from "../src/packaging.js";
import { findCommand } from "../src/pdf.js";
import { buildBook, createEntity, createStoryProject } from "../src/story.js";
import { backtickRuns, expectLinearTime, makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function project() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Lamp & Tide", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", "schema-version: 2\nauthor: Ada \"Q\" Writer\nlanguage: en-GB\ncopyright: © 2026 Ada Writer\n"), "utf8");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Arrival\nnumber: 1\nstatus: draft", "## Chapter Text\n\nThe <lamps> came *on*.\n\nShe waited.\n\n* * *\n\nMorning.\n");
  writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Departure\nnumber: 2\nstatus: draft", "## Chapter Text\n\nGone.\n");
  createEntity(root, { kind: "matter", name: "Dedication" });
  fs.appendFileSync(path.join(root, "matter", "dedication.md"), "\nFor the keepers.\n");
  createEntity(root, { kind: "matter", name: "Afterword", placement: "back" });
  fs.appendFileSync(path.join(root, "matter", "afterword.md"), "\nThanks.\n");
  return { root, cwd };
}

describe("html and print builds", () => {
  test("the review copy anchors every paragraph by chapter and matter", () => {
    const { root } = project();
    const result = buildBook(root, { format: "html" });
    expect(result).toMatchObject({ format: "html", chapters: 2, outFile: path.join(root, "dist", "lamp-tide.html") });
    const html = fs.readFileSync(result.outFile, "utf8");

    expect(html).toContain('<html lang="en-GB">');
    expect(html).toContain("<title>Lamp &amp; Tide: review copy</title>");
    expect(html).toContain('<p class="byline">Ada &quot;Q&quot; Writer</p>');
    expect(html).toContain('<li><a href="#ch01">Chapter 1: Arrival</a></li>');
    expect(html).toContain('<p id="ch01-p1"><a class="anchor" href="#ch01-p1" title="Link to ch01-p1">ch01-p1</a>The &lt;lamps&gt; came <em>on</em>.</p>');
    expect(html).toContain('<hr class="scene-break" aria-label="Scene break">\n<p id="ch01-p3"><a class="anchor" href="#ch01-p3" title="Link to ch01-p3">ch01-p3</a>Morning.</p>');
    expect(html).toContain('<p id="ch02-p1">');
    expect(html).toContain('<section id="matter-front-copyright" class="front copyright-page"><h2 class="visually-hidden">Copyright</h2>');
    expect(html).toContain('<p id="front-dedication-p1">');
    expect(html).toContain('<section id="matter-back-afterword" class="back"><h2>Afterword</h2>');
  });

  test("the print interior sets the trim, running heads, title page, contents, and matter order", () => {
    const { root } = project();
    const html = fs.readFileSync(buildBook(root, { format: "print", trim: "6x9" }).outFile, "utf8");
    expect(html).toContain("@page { size: 6in 9in; margin: 0.75in 0.5in 0.75in 0.625in; }");
    expect(html).toContain('@top-center { content: "Ada \\"Q\\" Writer"; font: italic 9pt Georgia, serif; }');
    expect(html).toContain("string(chapter-title, first-except)");
    expect(html).toContain('<section class="title-page"><h1>Lamp &amp; Tide</h1><p class="author">Ada &quot;Q&quot; Writer</p></section>');
    const order = ['class="title-page"', 'id="front-copyright"', 'class="toc"', 'id="front-dedication"', 'id="ch01"', 'id="ch02"', 'id="back-afterword"'].map((marker) => html.indexOf(marker));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('<p class="first">The &lt;lamps&gt; came <em>on</em>.</p>\n<p>She waited.</p>\n<p class="scene-break" aria-label="Scene break">');
    expect(html).toContain('<p class="first">Morning.</p>');
    expect(html).toContain('<li><a href="#ch01">Chapter 1: Arrival</a></li>');
    expect(html).not.toContain('<li><a href="#front-dedication">');
    expect(fs.existsSync(path.join(root, "dist", "lamp-tide.print.html"))).toBe(true);
  });

  test("print defaults to 5.5x8.5, widens the gutter for long books, and rejects unknown trims", () => {
    const book = (words) => ({ title: "T", authors: [], language: "en", words, parts: [{ key: "ch01", kind: "chapter", title: "C", heading: true, words, paragraphs: [] }] });
    expect(printHtml(book(100))).toContain("size: 5.5in 8.5in; margin: 0.75in 0.5in 0.75in 0.625in;");
    expect(printHtml(book(60000), "6x9")).toContain("0.75in 0.5in 0.75in 0.75in;");
    expect(printHtml(book(120000), "6x9")).toContain("0.75in 0.5in 0.75in 0.875in;");
    expect(printHtml(book(200000), "a5")).toContain("size: 148mm 210mm; margin: 0.75in 0.5in 0.75in 1in;");
    expect(printHtml(book(100))).toContain('@top-center { content: "T";');
    expect(() => printHtml(book(100), "9x12")).toThrow("Unsupported trim size: 9x12. Supported sizes: 5x8, 5.25x8, 5.5x8.5, 6x9, a5");
    expect(estimatePages(0)).toBe(1);
    expect(estimatePages(3000, "6x9")).toBe(10);
    expect(estimatePages(3000, "unknown")).toBe(11);
  });

  // CSS reads a form feed as a line break, which ended the running head's
  // string: the rule after it hid the body, and WeasyPrint and Chrome
  // printed one blank page.
  test("the running head keeps form feeds and other control characters inside its CSS string", () => {
    const name = "Ann\f}} body { display: none } x {\r\n\u0000\u000b\u001f\u007f\\\"<>&";
    const parts = [{ key: "ch01", kind: "chapter", title: "C", heading: true, words: 100, paragraphs: [] }];
    // A CSS string token: anything but a quote, backslash, or line break,
    // or a backslash and the character it escapes.
    const head = (html) => /@top-center \{ content: ("(?:[^"\\\n\r\f]|\\[\s\S])*"); font: /.exec(html)?.[1];
    const expected = '"Ann }} body { display: none } x { \\0 \\B \\1F \\7F \\\\\\"\\3C \\3E \\26 "';
    // The author heads the left-hand pages; with no author, the title does.
    expect(head(printHtml({ title: "T", authors: [name], language: "en", words: 100, parts }))).toBe(expected);
    expect(head(printHtml({ title: name, authors: [], language: "en", words: 100, parts }))).toBe(expected);
  });

  test("the print contents set a right-to-left book's page numbers at the left margin without a float (#591)", () => {
    const book = (language) => ({ title: "T", authors: [], language, words: 100, parts: [{ key: "ch01", kind: "chapter", title: "C", heading: true, words: 100, paragraphs: [] }] });
    // WeasyPrint drops a float that follows text on a right-to-left line.
    for (const language of ["ar", "he"]) {
      const html = printHtml(book(language));
      expect(html).toContain(`<html lang="${language}" dir="rtl">`);
      expect(html).toContain("\n.toc li { position: relative; padding-left: 2.5em; }\n.toc a::after { content: target-counter(attr(href), page); position: absolute; left: 0; bottom: 0; }\n");
      expect(html).not.toMatch(/\.toc [^{]*\{[^}]*float/);
    }
    // Left to right, the number still floats to the right margin.
    const english = printHtml(book("en"));
    expect(english).toContain('.toc a::after { content: " " target-counter(attr(href), page); float: right; }\n');
    expect(english).not.toContain(".toc li {");
  });

  test("the CLI builds both formats and reports unsupported ones", () => {
    const { root, cwd } = project();
    expect(invoke(cwd, ["build", root, "--format", "html"]).out).toContain("as html to");
    const print = invoke(cwd, ["build", root, "--format", "print", "--trim", "a5"]);
    expect(print.code).toBe(0);
    expect(fs.readFileSync(path.join(root, "dist", "lamp-tide.print.html"), "utf8")).toContain("148mm 210mm");
    const bad = invoke(cwd, ["build", root, "--format", "pdf"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("Supported formats: markdown, epub, docx, shunn, html, print");
  });

  test("long runs of spaces in a code span, a hard-broken line, or a heading build in linear time", () => {
    const paragraphs = (body) => htmlBook({ title: "T", meta: { authors: [], language: "en", labels: {} }, front: [], back: [], chapters: [{ key: "ch01", heading: "One", body }] }).parts[0].paragraphs;
    expect(paragraphs("Use ` a ` here  \nnext line\n\n# Title   ##").map((paragraph) => paragraph.html)).toEqual(["Use a here<br>next line", "Title"]);
    // One space comes off each end of a code span that is not all spaces,
    // whatever it holds: a pattern with `.` kept the spaces round two line
    // separators.
    expect(inlineHtml("` a\u2028\u2029b ` and `  `")).toBe("a\u2028\u2029b and   ");
    expectLinearTime(paragraphs, (n) => `\` ${"a ".repeat(n / 2)}x\``, { length: 64000 });
    expectLinearTime(paragraphs, (n) => `a${" ".repeat(n)}b\nc`);
    expectLinearTime(paragraphs, (n) => `# a${" ".repeat(n)}b`);
  });

  test("character references print as their characters and autolinks as their addresses (#592)", () => {
    const paragraphs = (body) => htmlBook({ title: "T", meta: { authors: [], language: "en", labels: {} }, front: [], back: [], chapters: [{ key: "ch01", heading: "One", body }] }).parts[0].paragraphs;
    const [paragraph] = paragraphs("He left&mdash;then&nbsp;stopped &amp; wrote to <sera@example.com> from <https://example.com/a_b_c>.");
    expect(paragraph.html).toBe("He left\u2014then\u00a0stopped &amp; wrote to sera@example.com from https://example.com/a_b_c.");
    // The review copy's labels match the printed text, on one line.
    expect(paragraph.text).toBe("He left\u2014then stopped & wrote to sera@example.com from https://example.com/a_b_c.");
    // A reference is text, never markup, and nothing in a code span or an
    // autolink is read as one; an escaped & and an unknown name stay as written.
    expect(inlineHtml("&#42;not emphasis&#42; `&amp;` <https://x.com/?a=1&amp;b=*2*> \\&amp; &madeup; &copy")).toBe("*not emphasis* &amp;amp; https://x.com/?a=1&amp;amp;b=*2* &amp;amp; &amp;madeup; &amp;copy");
    // Not autolinks: a space inside, no scheme, a bad email domain, or a
    // one-letter scheme. An autolink holds no emphasis.
    expect(inlineHtml("<https://a b> <a.b> <a@b..c> <a:b> *<ab:c*d>*")).toBe("&lt;https://a b&gt; &lt;a.b&gt; &lt;a@b..c&gt; &lt;a:b&gt; <em>ab:c*d</em>");
    expectLinearTime(inlineHtml, (n) => `<a@${"b.".repeat(n / 2)}`);
    expectLinearTime(inlineHtml, (n) => "&#1".repeat(n / 3));
  });

  test("backtick runs of many lengths build in linear time (#587)", () => {
    const html = (body) => htmlBook({ title: "T", meta: { authors: [], language: "en", labels: {} }, front: [], back: [], chapters: [{ key: "ch01", heading: "One", body }] }).parts[0].paragraphs.map((paragraph) => paragraph.html);
    expect(html("```x `y` *z* `` *w*")).toEqual(["```x y <em>z</em> `` <em>w</em>"]);
    // Each run that nothing closed once read to the end of the paragraph.
    expectLinearTime(html, backtickRuns, { length: 512000, pieces: 256 });
  });
});

// With WeasyPrint and pdftotext (from poppler) on PATH, render the print
// interior and read the contents page back. CI installs neither, so there
// the CSS checks above stand alone.
const weasyprint = findCommand("weasyprint");
const pdftotext = findCommand("pdftotext");

describe.skipIf(!weasyprint || !pdftotext)("print contents rendered with WeasyPrint", () => {
  // Each page's words, with their edges in points.
  function pdfWords(file) {
    const xml = spawnSync(pdftotext, ["-bbox", file, "-"], { encoding: "utf8" }).stdout;
    return xml.split("<page ").slice(1).map((page) => [...page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g)]
      .map(([, left, top, right, text]) => ({ text, left: Number(left), top: Number(top), right: Number(right) })));
  }

  // Latin titles and labels, which pdftotext reads back as written. A line
  // in a right-to-left book still runs right to left.
  const titles = ["Alpha", "Bravo", "Charlie"];

  // Each contents entry's words, and the number on its line: the page the
  // chapter's heading is on, the first page after the contents with its title.
  function renderedContents(language) {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Lamp", force: false });
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\nlanguage: ${language}\nlabels:\n  - chapter: Chapter {n}\n  - contents: Contents\n`), "utf8");
    titles.forEach((title, index) => writeMarkdown(path.join(root, "chapters", `chapter-0${index + 1}.md`), `title: ${title}\nnumber: ${index + 1}\nstatus: draft`, "## Chapter Text\n\nThe lamps came on.\n"));
    const out = path.join(cwd, "lamp.pdf");
    expect(invoke(cwd, ["build", root, "--format", "print", "--pdf", "--pdf-engine", weasyprint, "--out", out]).code).toBe(0);
    const pages = pdfWords(out);
    const contents = pages.findIndex((words) => words.some((word) => word.text === "Contents"));
    expect(contents).toBeGreaterThanOrEqual(0);
    return titles.map((title) => {
      const start = pages.findIndex((words, index) => index > contents && words.some((word) => word.text === title));
      expect(start).toBeGreaterThan(contents);
      const top = pages[contents].find((word) => word.text === title).top;
      const line = pages[contents].filter((word) => Math.abs(word.top - top) < 2);
      const number = line.find((word) => word.text === String(start + 1));
      expect(number).toBeDefined();
      return { number, entry: line.filter((word) => word !== number) };
    });
  }

  test("a right-to-left book's contents show each chapter's page left of its title (#591)", () => {
    for (const { number, entry } of renderedContents("ar")) {
      expect(number.right).toBeLessThan(Math.min(...entry.map((word) => word.left)));
    }
  });

  test("a left-to-right book's contents show each chapter's page right of its title", () => {
    for (const { number, entry } of renderedContents("en")) {
      expect(number.left).toBeGreaterThan(Math.max(...entry.map((word) => word.right)));
    }
  });
});

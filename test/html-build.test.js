import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { estimatePages, printHtml } from "../src/html.js";
import { buildBook, createEntity, createStoryProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

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
    const book = (words) => ({ title: "T", authors: [], language: "en", words, parts: [] });
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

  test("the CLI builds both formats and reports unsupported ones", () => {
    const { root, cwd } = project();
    expect(invoke(cwd, ["build", root, "--format", "html"]).out).toContain("as html to");
    const print = invoke(cwd, ["build", root, "--format", "print", "--trim", "a5"]);
    expect(print.code).toBe(0);
    expect(fs.readFileSync(path.join(root, "dist", "lamp-tide.print.html"), "utf8")).toContain("148mm 210mm");
    const bad = invoke(cwd, ["build", root, "--format", "pdf"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("Supported formats: markdown, epub, docx, shunn, html, print");
  });
});

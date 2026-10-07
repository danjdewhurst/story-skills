import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { printHtml } from "../src/html.js";
import { buildBook, createStoryProject, validateProject } from "../src/story.js";
import { buildStyle, fontList } from "../src/build-style.js";
import { makeTempDir, memoryIo, messages, readArchiveEntries, writeMarkdown } from "./helpers.js";

// A two-chapter book with a scene break, a dedication, and `extra` lines
// added to story.md (a build-style block, say).
function project(extra = "", language = "en") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Lamp Tide", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\nauthor: Ada Writer\nlanguage: ${language}\n${extra}`), "utf8");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Arrival\nnumber: 1\nstatus: draft", "## Chapter Text\n\nThe lamps came on.\n\nShe waited.\n\n* * *\n\nMorning.\n");
  writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Departure\nnumber: 2\nstatus: draft", "## Chapter Text\n\nGone.\n");
  return root;
}

function build(root, format, options = {}) {
  const out = path.join(root, "dist", `book-${format}-${Object.keys(options).join("-")}`);
  buildBook(root, { format, out, ...options });
  return fs.readFileSync(out);
}

function epubEntries(root) {
  const out = path.join(root, "dist", "book.epub");
  buildBook(root, { format: "epub", out });
  return new Map(readArchiveEntries(out).map((entry) => [entry.name, entry.content.toString("utf8")]));
}

// The text of the review copy's or print interior's first <style>, from
// the rules a build-style adds: everything after the build's own last rule.
function addedRules(html, lastRule) {
  const style = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
  return style.slice(style.indexOf(lastRule) + lastRule.length);
}

const PRINT_LAST = "section { margin-top: 3rem; } }\n";

describe("build-style presets", () => {
  test("unset, or preset classic alone, leaves every build byte for byte as it was", () => {
    const plain = project();
    const classic = project("build-style:\n  - preset: classic\n");
    for (const [format, options] of [["html", {}], ["print", {}], ["print", { trim: "6x9" }], ["epub", {}]]) {
      expect(build(classic, format, options).equals(build(plain, format, options))).toBe(true);
    }
    // The classic EPUB of a Latin-script book has no stylesheet at all.
    expect([...epubEntries(plain).keys()].some((name) => name.endsWith(".css"))).toBe(false);
    expect(epubEntries(plain).get("OEBPS/chapter-01.xhtml")).toContain("<p>* * *</p>");
  });

  test("modern: sans-serif headings flush left, block paragraphs, bullet scene breaks, no initial", () => {
    const root = project("build-style:\n  - preset: modern\n");
    const sans = '"Avenir Next", "Segoe UI", "Helvetica Neue", Arial, "Noto Sans", sans-serif';
    const review = build(root, "html").toString("utf8");
    expect(review).toContain('.scene-break::after { content: "• • •"; color: var(--muted); }');
    expect(addedRules(review, '@media (max-width: 52rem) { .anchor { position: static; display: block; width: auto; text-align: left; line-height: 1.4; opacity: 0.6; } }\n')).toBe(
      `header h1, section > h2 { font-family: ${sans}; }\nsection > h2 { text-align: left; font-weight: bold; }\n`
    );
    const print = build(root, "print").toString("utf8");
    expect(print).toContain(">• • •</p>");
    expect(print).not.toContain("A raised initial");
    expect(print).toContain("@top-center { content: string(chapter-title, first-except); font: italic 9pt \"Avenir Next\"");
    expect(addedRules(print, PRINT_LAST)).toBe(
      `h1 { font-family: ${sans}; }\nsection.chapter > h1, section.front > h1, section.back > h1 { text-align: left; font-weight: bold; }\np { text-indent: 0; margin-bottom: 0.7em; }\n`
    );
    const epub = epubEntries(root);
    expect(epub.get("OEBPS/style.css")).toBe([
      `h1 { font-family: ${sans}; }`,
      "h1 { text-align: left; font-weight: bold; }",
      "p { margin: 0 0 0.8em; text-indent: 0; }",
      "p.scene-break { text-align: center; text-indent: 0; margin: 1em 0; }",
      ""
    ].join("\n"));
    expect(epub.get("OEBPS/chapter-01.xhtml")).toContain('<body epub:type="bodymatter chapter" class="chapter"><h1>');
    expect(epub.get("OEBPS/chapter-01.xhtml")).toContain('<p class="scene-break">• • •</p>');
    expect(epub.get("OEBPS/content.opf")).toContain('<item id="style" href="style.css" media-type="text/css"/>');
  });

  test("elegant: an old-style body, small-caps headings, a fleuron, indents, and drop caps", () => {
    const root = project("build-style:\n  - preset: elegant\n");
    const body = 'Palatino, "Palatino Linotype", "Book Antiqua", "Iowan Old Style", Georgia, serif';
    const dropCap = "float: left; font-size: 3.2em; line-height: 0.8; margin: 0.08em 0.08em 0 0;";
    const review = build(root, "html").toString("utf8");
    expect(review).toContain(`font: 1.1rem/1.65 ${body}; }`);
    expect(review).toContain('.scene-break::after { content: "❦"; color: var(--muted); }');
    expect(addedRules(review, '@media (max-width: 52rem) { .anchor { position: static; display: block; width: auto; text-align: left; line-height: 1.4; opacity: 0.6; } }\n')).toBe([
      "section > h2 { text-align: center; font-weight: normal; font-variant: small-caps; letter-spacing: 0.08em; }",
      "section p { margin-block-end: 0; text-indent: 1.5em; }",
      "section > h2 + p, .scene-break + p, blockquote p, section.front p, section.back p { text-indent: 0; }",
      "section.front p, section.back p { margin-block-end: 1rem; }",
      `@media (min-width: 52.01rem) { section.chapter > h2 + p::first-letter { ${dropCap} } }`,
      ""
    ].join("\n"));
    const print = build(root, "print").toString("utf8");
    expect(print).toContain(`html { font: 11pt/1.4 ${body}; }`);
    // Running heads and folios follow the body font the style chose.
    expect(print).toContain(`@bottom-center { content: counter(page); font: 9pt ${body}; } }`);
    expect(print).toContain('<p class="scene-break" aria-label="Scene break">❦</p>');
    expect(print).not.toContain("A raised initial");
    expect(addedRules(print, PRINT_LAST)).toBe([
      "section.chapter > h1, section.front > h1, section.back > h1 { text-align: center; font-weight: normal; font-variant: small-caps; letter-spacing: 0.08em; }",
      `section.chapter > h1 + p.first::first-letter { ${dropCap} }`,
      ""
    ].join("\n"));
    expect(epubEntries(root).get("OEBPS/style.css")).toBe([
      `body { font-family: ${body}; }`,
      "h1 { text-align: center; font-weight: normal; font-variant: small-caps; letter-spacing: 0.08em; }",
      "p { margin: 0; text-indent: 1.5em; }",
      "h1 + p, p.scene-break + p, blockquote p, body.matter p { text-indent: 0; }",
      "body.matter p { margin: 0 0 0.8em; }",
      "p.scene-break { text-align: center; text-indent: 0; margin: 1em 0; }",
      `body.chapter > h1 + p::first-letter { ${dropCap} }`,
      ""
    ].join("\n"));
  });

  test("overrides win over the preset, in any entry", () => {
    const root = project("build-style:\n  - preset: elegant\n    drop-caps: false\n  - scene-break: \"<§> \\\"x\\\"\"\n    body-font: Source Serif 4, 'Iowan Old Style', serif\n");
    expect(validateProject(root).errors).toEqual([]);
    const review = build(root, "html").toString("utf8");
    expect(review).toContain('font: 1.1rem/1.65 "Source Serif 4", "Iowan Old Style", serif; }');
    expect(review).toContain('.scene-break::after { content: "\\3C §\\3E  \\"x\\""; color: var(--muted); }');
    expect(review).not.toContain("first-letter");
    const print = build(root, "print").toString("utf8");
    expect(print).toContain('aria-label="Scene break">&lt;§&gt; &quot;x&quot;</p>');
    expect(print).not.toContain("first-letter");
    const epub = epubEntries(root);
    expect(epub.get("OEBPS/chapter-01.xhtml")).toContain('<p class="scene-break">&lt;§&gt; &quot;x&quot;</p>');
    expect(epub.get("OEBPS/style.css")).toStartWith('body { font-family: "Source Serif 4", "Iowan Old Style", serif; }\n');
  });

  test("a styled EPUB that chooses no font leaves the reader's own", () => {
    const root = project("build-style:\n  - scene-break: \"~\"\n");
    expect(epubEntries(root).get("OEBPS/style.css")).toBe("p.scene-break { text-align: center; text-indent: 0; margin: 1em 0; }\n");
  });

  test("a book in another script keeps its script's fonts", () => {
    // A preset's Latin fonts never replace the script's stack.
    const elegant = project("build-style:\n  - preset: elegant\n", "ja");
    const mincho = '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "MS Mincho", "Noto Serif JP", "Noto Serif CJK JP", serif';
    expect(build(elegant, "print").toString("utf8")).toContain(`html { font: 11pt/1.4 ${mincho}; }`);
    const css = epubEntries(elegant).get("OEBPS/style.css");
    expect(css).toStartWith(`body { font-family: ${mincho}; }\n`);
    // Japanese has no capitals: no small caps, no drop cap.
    expect(css).not.toContain("small-caps");
    expect(css).not.toContain("first-letter");
    // A font the writer names comes first, and the script's stack follows.
    const named = project("build-style:\n  - body-font: Klee One\n", "ja");
    expect(build(named, "html").toString("utf8")).toContain(`font: 1.1rem/1.65 "Klee One", ${mincho}; }`);
    const arabic = project("build-style:\n  - heading-style: left\n", "ar");
    expect(epubEntries(arabic).get("OEBPS/style.css")).toContain("h1 { text-align: right; font-weight: bold; }");
  });

  test("centred headings, and block paragraphs and no drop cap in vertical text", () => {
    const centred = project("build-style:\n  - heading-style: centered\n    heading-font: Futura, sans-serif\n");
    const print = build(centred, "print").toString("utf8");
    expect(addedRules(print, PRINT_LAST)).toBe('h1 { font-family: "Futura", sans-serif; }\nsection.chapter > h1, section.front > h1, section.back > h1 { text-align: center; font-weight: normal; }\n');
    expect(print).toContain('@bottom-center { content: counter(page); font: 9pt "Futura", sans-serif; } }');
    const vertical = project("writing-mode: vertical\nbuild-style:\n  - paragraphs: block\n    drop-caps: true\n", "ja");
    expect(build(vertical, "print").toString("utf8")).toContain("p { text-indent: 0; margin-left: 0.7em; }\n");
    const css = epubEntries(vertical).get("OEBPS/style.css");
    expect(css).toStartWith("html { -epub-writing-mode: vertical-rl;");
    expect(css).toContain("p { margin: 0 0 0 0.8em; text-indent: 0; }");
    expect(css).not.toContain("first-letter");
    // Hebrew has no capitals either.
    expect(epubEntries(project("build-style:\n  - drop-caps: true\n", "he")).get("OEBPS/style.css")).not.toContain("first-letter");
  });

  test("the Shunn manuscript and DOCX builds never read build-style", () => {
    const plain = project();
    const styled = project("build-style:\n  - preset: elegant\n    css: missing.css\n");
    for (const [format, options] of [["shunn", {}], ["docx", {}], ["docx", { shunn: true }], ["markdown", {}]]) {
      expect(build(styled, format, options).equals(build(plain, format, options))).toBe(true);
    }
  });
});

describe("build-style css", () => {
  test("an extra stylesheet follows the build's own rules in every styled format", () => {
    const root = project("build-style:\n  - css: styles/book.css\n");
    fs.mkdirSync(path.join(root, "styles"));
    fs.writeFileSync(path.join(root, "styles", "book.css"), "﻿h1 { color: teal; }\r\np { hyphens: none; }");
    expect(validateProject(root).errors).toEqual([]);
    for (const format of ["html", "print"]) {
      const html = build(root, format).toString("utf8");
      expect(html).toContain("</style>\n<style>\nh1 { color: teal; }\np { hyphens: none; }\n</style>\n</head>");
    }
    const epub = epubEntries(root);
    expect(epub.get("OEBPS/extra.css")).toBe("h1 { color: teal; }\np { hyphens: none; }\n");
    expect(epub.get("OEBPS/content.opf")).toContain('<item id="extra-style" href="extra.css" media-type="text/css"/>');
    // Only the extra stylesheet: no style.css, and the markup stays plain.
    expect(epub.has("OEBPS/style.css")).toBe(false);
    for (const name of ["OEBPS/nav.xhtml", "OEBPS/chapter-01.xhtml"]) {
      expect(epub.get(name)).toContain('<link rel="stylesheet" type="text/css" href="extra.css"/></head>');
    }
    expect(epub.get("OEBPS/chapter-01.xhtml")).toContain("<p>* * *</p>");
  });

  test("with a preset, both stylesheets are linked, the preset's first", () => {
    const root = project("build-style:\n  - preset: modern\n    css: book.css\n");
    fs.writeFileSync(path.join(root, "book.css"), "p { color: navy; }\n");
    const chapter = epubEntries(root).get("OEBPS/chapter-01.xhtml");
    expect(chapter).toContain('<link rel="stylesheet" type="text/css" href="style.css"/><link rel="stylesheet" type="text/css" href="extra.css"/>');
  });

  test("a stylesheet outside the project, missing, not .css, linked, or closing the style element is refused", () => {
    const cases = [
      ["../outside.css", /must be inside the project/],
      ["nowhere.css", /does not exist/],
      ["notes.txt", /must be a \.css file/],
      ["bad.css", /must not contain <\/style/]
    ];
    for (const [value, pattern] of cases) {
      const root = project(`build-style:\n  - css: ${value}\n`);
      fs.writeFileSync(path.join(root, "..", "outside.css"), "p {}\n");
      fs.writeFileSync(path.join(root, "bad.css"), "p {}\n</STYLE><script>alert(1)</script>\n");
      fs.writeFileSync(path.join(root, "notes.txt"), "p {}\n");
      const errors = validateProject(root).errors.filter((error) => error.code === "invalid-build-style");
      expect(messages(errors)).toEqual([expect.stringMatching(pattern)]);
      expect(() => buildBook(root, { format: "html" })).toThrow(/Cannot build until story\.md build-style is fixed/);
    }
  });

  test("a symlinked stylesheet is refused", () => {
    const root = project("build-style:\n  - css: linked.css\n");
    const target = path.join(root, "..", "secret.css");
    fs.writeFileSync(target, "p {}\n");
    try {
      fs.symlinkSync(target, path.join(root, "linked.css"));
    } catch {
      return; // Creating symlinks needs a privilege some Windows runners lack.
    }
    expect(messages(validateProject(root).errors)).toEqual([expect.stringMatching(/^story\.md build-style css linked\.css: Refusing to read through symlink$/)]);
    expect(() => buildBook(root, { format: "epub" })).toThrow(/symlink/);
  });

  test("a stylesheet path with a control character is refused, named, before any file is read", () => {
    const root = project('build-style:\n  - css: "a\\u0000.css"\n');
    const message = 'story.md build-style css "a\\u0000.css" must not contain control characters';
    expect(messages(validateProject(root).errors.filter((error) => error.code === "invalid-build-style"))).toEqual([message]);
    const io = memoryIo(root);
    expect(runCli(["build", "--format", "html"], io)).toBe(3);
    expect(io.error()).toContain(`Cannot build until story.md build-style is fixed:\n${message}`);
    // C0 and C1 controls, DEL, and the bidirectional marks and controls.
    for (const code of ["0001", "001f", "007f", "0085", "009f", "200f", "202e", "2066"]) {
      const marked = project(`build-style:\n  - css: "a\\u${code}.css"\n`);
      expect(messages(validateProject(marked).errors)).toEqual([`story.md build-style css "a\\u${code}.css" must not contain control characters`]);
    }
  });

  test("--out never replaces the stylesheet story.md names", () => {
    const root = project("build-style:\n  - css: styles/book.css\n");
    fs.mkdirSync(path.join(root, "styles"));
    fs.writeFileSync(path.join(root, "styles", "book.css"), "p { color: navy; }\n");
    expect(() => buildBook(root, { format: "html", out: "styles/book.css" })).toThrow("Refusing to write generated output to styles/book.css: story.md names it as the build-style css. Use a path such as dist/ instead");
    expect(() => buildBook(root, { format: "markdown", out: path.join(root, "Styles", "Book.CSS") })).toThrow("story.md names it as the build-style css");
    const io = memoryIo(root);
    expect(runCli(["build", "--format", "print", "--out", "./styles/book.css"], io)).toBe(4);
    expect(fs.readFileSync(path.join(root, "styles", "book.css"), "utf8")).toBe("p { color: navy; }\n");
    // story.md in another letter case than --out.
    const upper = project("build-style:\n  - css: Styles/Book.CSS\n");
    expect(() => buildBook(upper, { format: "html", out: "styles/book.css" })).toThrow("Refusing to write generated output to styles/book.css: story.md names it as the build-style css");
  });
});

describe("build-style validation", () => {
  test("rejects a bad shape, an unknown or repeated key, and bad values", () => {
    const root = project([
      "build-style:",
      "  - preset: fancy",
      "    body-font: Georgia; color: red",
      "    heading-style: right",
      "    drop-caps: yes",
      "    paragraphs: spaced",
      "    scene-break: \"  \"",
      "    colour: blue",
      "  - preset: modern",
      ""
    ].join("\n"));
    expect(messages(validateProject(root).errors.filter((error) => error.code === "invalid-build-style"))).toEqual([
      "story.md build-style preset must be one of classic, modern, elegant",
      "story.md build-style body-font must be a comma-separated list of font names, such as Iowan Old Style, Georgia, serif",
      "story.md build-style heading-style must be one of centered, small-caps, left",
      "story.md build-style drop-caps must be true or false",
      "story.md build-style paragraphs must be one of indented, block",
      "story.md build-style scene-break must be one line of text, such as \"* * *\" or \"~\"",
      "story.md build-style key colour is not a style setting; use preset, body-font, heading-font, heading-style, scene-break, drop-caps, paragraphs, css",
      "story.md build-style sets preset more than once"
    ]);
    const io = memoryIo(root);
    expect(runCli(["build", "--format", "epub"], io)).toBe(3);
    expect(io.error()).toContain("Cannot build until story.md build-style is fixed:\nstory.md build-style preset must be one of");
    const scalar = project("build-style: modern\n");
    expect(messages(validateProject(scalar).errors)).toEqual([
      "story.md build-style must be a list of key: value entries, such as - preset: modern (see docs/manuscripts.md#build-styles)"
    ]);
  });

  test("font lists are quoted for CSS, generic families left bare", () => {
    expect(fontList("Iowan Old Style, 'Palatino', \"Source Serif 4\" , SERIF")).toBe('"Iowan Old Style", "Palatino", "Source Serif 4", serif');
    expect(buildStyle({}).styled).toBe(false);
    expect(buildStyle({ "build-style": [{ preset: "classic" }] }).styled).toBe(false);
    expect(buildStyle({ "build-style": [{ css: "a.css" }] })).toMatchObject({ styled: false, css: "a.css" });
    expect(buildStyle({ "build-style": [{ "drop-caps": false }] }).styled).toBe(true);
  });
});

describe("review fixes", () => {
  test("print css strings cannot close the style element", () => {
    const html = printHtml({ title: "T", authors: ["</style><script>x()</script> & co"], language: "en", words: 10, parts: [] });
    expect(html).not.toContain("</style><script>");
    expect(html).toContain('content: "\\3C /style\\3E \\3C script\\3E x()\\3C /script\\3E  \\26  co"');
  });
});

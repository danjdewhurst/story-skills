import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { collapseSourceSpace, plainSpaces, trimBlankLines, trimSourceSpace } from "../src/markdown.js";
import { shunnHtml } from "../src/packaging.js";
import { buildBook, createStoryProject } from "../src/story.js";
import { makeTempDir, readArchiveEntries, writeMarkdown } from "./helpers.js";

// Spaces a writer types as text, which builds must keep (#542): French sets
// a no-break space inside « » and a narrow no-break space before ? and !,
// and a Japanese paragraph opens with an ideographic space. Escapes, so an
// editor cannot quietly turn them into plain spaces.
const NBSP = "\u00a0";
const NNBSP = "\u202f";
const IDEOGRAPHIC = "\u3000";

// A one-chapter book in `language`, with optional extra story.md lines.
function project(language, body, extra = "") {
  const { root } = createStoryProject({ cwd: makeTempDir(), title: "Spaces", language, force: false });
  if (extra !== "") {
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\n${extra}`), "utf8");
  }
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", `\n## Chapter Text\n\n${body}`);
  return root;
}

function archive(root, options, entry) {
  return readArchiveEntries(buildBook(root, options).outFile).find((candidate) => candidate.name === entry).content.toString("utf8");
}

function file(root, options) {
  return fs.readFileSync(buildBook(root, options).outFile, "utf8");
}

// Every build that sets prose, as text: the chapter part of each archive,
// and the whole file for the rest.
function builds(root) {
  return {
    markdown: file(root, { format: "markdown" }),
    epub: archive(root, { format: "epub" }, "OEBPS/chapter-01.xhtml"),
    docx: archive(root, { format: "docx" }, "word/document.xml"),
    shunnDocx: archive(root, { format: "docx", shunn: true }, "word/document.xml"),
    shunn: file(root, { format: "shunn" }),
    html: file(root, { format: "html" }),
    print: file(root, { format: "print" }),
    narration: file(root, { format: "narration" })
  };
}

// The Shunn PDF's HTML source, which `build --format shunn --pdf` renders.
function shunnPdfHtml(language, body) {
  return shunnHtml({ meta: { language }, chapters: [{ heading: "One", byline: "", body }] }, {
    title: "Spaces", author: "Ada", lead: "Ada", editors: "", labels: undefined, contact: [], words: 10, pack: undefined, shortForm: false
  });
}

describe("typed spaces in builds (#542)", () => {
  test("French no-break and narrow no-break spaces reach every format", () => {
    const root = project("fr", [
      `«${NBSP}Bonjour${NBSP}», dit-elle. «${NBSP}Ça va${NNBSP}?${NBSP}»`,
      `Non${NNBSP}! répondit-il.`,
      "",
      "Après.",
      ""
    ].join("\n"));
    const output = { ...builds(root), shunnPdf: shunnPdfHtml("fr", `«${NBSP}Bonjour${NBSP}», dit-elle. «${NBSP}Ça va${NNBSP}?${NBSP}»`) };
    for (const [format, text] of Object.entries(output)) {
      expect({ format, guillemets: text.includes(`«${NBSP}Bonjour${NBSP}»`), question: text.includes(`va${NNBSP}?${NBSP}»`) })
        .toEqual({ format, guillemets: true, question: true });
    }
    for (const [format, text] of Object.entries(builds(root))) {
      expect({ format, exclamation: text.includes(`Non${NNBSP}!`) }).toEqual({ format, exclamation: true });
    }
  });

  test("a scene break spaced with no-break spaces is a break in every format", () => {
    const root = project("en", ["Before.", "", `*${NBSP}*${NBSP}*`, "", "After.", ""].join("\n"));
    const output = builds(root);
    for (const [format, text] of Object.entries(output)) {
      if (format !== "markdown") {
        expect({ format, literal: text.includes(`*${NBSP}*`) }).toEqual({ format, literal: false });
      }
    }
    expect(output.epub).toContain("<p>Before.</p><p>* * *</p><p>After.</p>");
    expect(output.docx).toContain('<w:pStyle w:val="SceneBreak"/>');
    expect(output.shunnDocx).toMatch(/<w:t xml:space="preserve">(#|\* \* \*)<\/w:t>/);
    expect(output.shunn).toMatch(/Before\.\n\n(#|\* \* \*)\n\nAfter\./);
    expect(output.html).toContain('<hr class="scene-break"');
    expect(output.print).toContain('<p class="scene-break"');
    expect(output.narration).toContain("Before.\n\n[pause]\n\nAfter.");
    expect(shunnPdfHtml("en", `Before.\n\n*${NBSP}*${NBSP}*\n\nAfter.`)).not.toContain(`*${NBSP}*`);
  });

  test("a typed indent stays in builds that set no indent of their own, the first paragraph's too", () => {
    const root = project("ja", [
      IDEOGRAPHIC,
      `${IDEOGRAPHIC}一つ目の段落。`,
      "",
      `${IDEOGRAPHIC}二つ目の段落。`,
      IDEOGRAPHIC,
      ""
    ].join("\n"));
    const { markdown, epub, html, narration } = builds(root);
    for (const [format, text] of Object.entries({ markdown, epub, html, narration })) {
      expect({ format, first: text.includes(`${IDEOGRAPHIC}一つ目の段落。`), second: text.includes(`${IDEOGRAPHIC}二つ目の段落。`) })
        .toEqual({ format, first: true, second: true });
    }
    // Lines of nothing but typed spaces at either end of the chapter are
    // blank: no empty paragraph, and no stray line in the markdown build.
    expect(epub).toContain(`<p>${IDEOGRAPHIC}一つ目の段落。</p><p>${IDEOGRAPHIC}二つ目の段落。</p>`);
    expect(markdown).toContain(`\n\n${IDEOGRAPHIC}一つ目の段落。\n\n${IDEOGRAPHIC}二つ目の段落。\n`);
    expect(markdown).not.toContain(`\n${IDEOGRAPHIC}\n`);
    // Print with block paragraphs has no first-line indent either.
    const block = project("ja", `${IDEOGRAPHIC}段落。\n`, "build-style:\n  - paragraphs: block\n");
    expect(file(block, { format: "print" })).toContain(`<p class="first">${IDEOGRAPHIC}段落。</p>`);
  });

  test("a build that indents first lines itself drops a typed indent instead of adding to it", () => {
    const body = `${IDEOGRAPHIC}一つ目の段落。\n\n${IDEOGRAPHIC}「二つ目」の段落。\n`;
    const root = project("ja", body);
    const output = builds(root);
    expect(output.print).toContain("<p class=\"first\">一つ目の段落。</p>\n<p>「二つ目」の段落。</p>");
    expect(output.docx).toContain('<w:t xml:space="preserve">一つ目の段落。</w:t>');
    expect(output.shunnDocx).toContain('<w:t xml:space="preserve">一つ目の段落。</w:t>');
    expect(output.shunn).toContain("\n一つ目の段落。\n\n「二つ目」の段落。\n");
    expect(shunnPdfHtml("ja", body)).toContain("<p>一つ目の段落。</p>");
    for (const [format, text] of Object.entries({ print: output.print, docx: output.docx, shunnDocx: output.shunnDocx, shunn: output.shunn })) {
      expect({ format, typed: text.includes(`${IDEOGRAPHIC}一つ目`) || text.includes(`${IDEOGRAPHIC}「二つ目`) }).toEqual({ format, typed: false });
    }
    // Indented build-style paragraphs: the EPUB and the review copy too.
    const indented = project("ja", body, "build-style:\n  - paragraphs: indented\n");
    expect(archive(indented, { format: "epub" }, "OEBPS/chapter-01.xhtml")).toContain("<p>一つ目の段落。</p><p>「二つ目」の段落。</p>");
    const review = file(indented, { format: "html" });
    expect(review).toContain("</a>一つ目の段落。</p>");
    expect(review).not.toContain(`${IDEOGRAPHIC}一つ目`);
    expect(file(indented, { format: "print" })).toContain("<p>「二つ目」の段落。</p>");
  });

  test("a matter page keeps its typed indent where chapters do", () => {
    const root = project("ja", `${IDEOGRAPHIC}本文。\n`);
    writeMarkdown(path.join(root, "matter", "dedication.md"), "title: Dedication\nplacement: front\nheading: false", `\n${IDEOGRAPHIC}祖母に。\n`);
    expect(archive(root, { format: "epub" }, "OEBPS/front-dedication.xhtml")).toContain(`<p>${IDEOGRAPHIC}祖母に。</p>`);
    expect(archive(root, { format: "docx" }, "word/document.xml")).toContain('<w:t xml:space="preserve">祖母に。</w:t>');
  });

  test("the narration script reads a line of typed spaces as blank", () => {
    const between = file(project("ja", `${IDEOGRAPHIC}一つ目。\n\n${IDEOGRAPHIC}\n${IDEOGRAPHIC}二つ目。\n`), { format: "narration" });
    expect(between).toContain(`${IDEOGRAPHIC}一つ目。\n\n${IDEOGRAPHIC}二つ目。`);
    expect(between).not.toContain(`${IDEOGRAPHIC}\n`);
    // Nor does an empty heading at either end leave an empty paragraph.
    const alone = file(project("en", `### \n\nA.\n\n${IDEOGRAPHIC}\n\nB.\n\n### \n`), { format: "narration" });
    expect(alone).toContain("\n\nA.\n\nB.\n\n");
    expect(alone).not.toContain("\n\n\n");
  });

  test("layout whitespace still collapses, and a typed-space line that opens a paragraph goes", () => {
    const root = project("en", [
      "One  \ttwo",
      "three.",
      "",
      `${NBSP}\\`,
      "Four.",
      ""
    ].join("\n"));
    const { epub, html } = builds(root);
    expect(epub).toContain("<p>One two three.</p>");
    // The hard-broken line of only a no-break space opens the paragraph, so
    // it goes, as an empty one always did.
    expect(epub).toContain("<p>Four.</p>");
    expect(epub).not.toContain(`<p>${NBSP}`);
    expect(html).not.toContain(`${NBSP}<br>`);
  });
});

describe("layout whitespace helpers", () => {
  const samples = [
    "",
    " ",
    "  a  ",
    "\t\na b\r\n",
    "\v\fword\f\v",
    "a \u2028b\u2029",
    "\u2028\u2029 text \u2028"
  ];

  test("on layout whitespace alone they agree with trim() and \\s", () => {
    for (const sample of samples) {
      expect(trimSourceSpace(sample)).toBe(sample.trim());
      expect(collapseSourceSpace(sample)).toBe(sample.replace(/\s+/g, " "));
      expect(trimBlankLines(sample)).toBe(sample.trim());
      expect(plainSpaces(sample)).toBe(sample);
    }
  });

  test("typed spaces stay", () => {
    expect(trimSourceSpace(` ${NBSP}a${NNBSP} `)).toBe(`${NBSP}a${NNBSP}`);
    expect(collapseSourceSpace(`a ${NBSP} b${IDEOGRAPHIC}\tc`)).toBe(`a ${NBSP} b${IDEOGRAPHIC} c`);
    expect(trimSourceSpace(IDEOGRAPHIC)).toBe(IDEOGRAPHIC);
    expect(plainSpaces(`*${NBSP}*${NNBSP}*${IDEOGRAPHIC}`)).toBe("* * * ");
  });

  test("trimBlankLines drops typed-space lines at either end but keeps an indent", () => {
    expect(trimBlankLines(`\n${IDEOGRAPHIC}\n \n${IDEOGRAPHIC}本文\n\n${IDEOGRAPHIC}次\n${NBSP}\n`)).toBe(`${IDEOGRAPHIC}本文\n\n${IDEOGRAPHIC}次`);
    expect(trimBlankLines(`${IDEOGRAPHIC}\n${NBSP}`)).toBe("");
  });
});

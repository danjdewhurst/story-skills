import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { collapseSourceSpace, trimBlankLines, trimSourceSpace } from "../src/markdown.js";
import { buildBook, createStoryProject } from "../src/story.js";
import { makeTempDir, readArchiveEntries, writeMarkdown } from "./helpers.js";

// Spaces a writer types as text, which builds must keep (#542): French sets
// a no-break space inside « » and a narrow no-break space before ? and !,
// and a Japanese paragraph opens with an ideographic space.
const NBSP = " ";
const NNBSP = " ";
const IDEOGRAPHIC = "　";

function project(language, body) {
  const { root } = createStoryProject({ cwd: makeTempDir(), title: "Spaces", language, force: false });
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", `\n## Chapter Text\n\n${body}`);
  return root;
}

// Every build that sets prose, as text: the chapter part of each archive,
// and the whole file for the rest.
function builds(root) {
  const archive = (options, entry) => readArchiveEntries(buildBook(root, options).outFile)
    .find((candidate) => candidate.name === entry).content.toString("utf8");
  const file = (options) => fs.readFileSync(buildBook(root, options).outFile, "utf8");
  return {
    markdown: file({ format: "markdown" }),
    epub: archive({ format: "epub" }, "OEBPS/chapter-01.xhtml"),
    docx: archive({ format: "docx" }, "word/document.xml"),
    shunnDocx: archive({ format: "docx", shunn: true }, "word/document.xml"),
    shunn: file({ format: "shunn" }),
    html: file({ format: "html" }),
    print: file({ format: "print" }),
    narration: file({ format: "narration" })
  };
}

describe("typed spaces in builds (#542)", () => {
  test("French no-break and narrow no-break spaces reach every format", () => {
    const root = project("fr", [
      `«${NBSP}Bonjour${NBSP}», dit-elle. «${NBSP}Ça va${NNBSP}?${NBSP}»`,
      `Non${NNBSP}! répondit-il.`,
      "",
      `*${NBSP}*${NBSP}*`,
      "",
      "Après la pause.",
      ""
    ].join("\n"));
    for (const [format, output] of Object.entries(builds(root))) {
      expect({ format, kept: output.includes(`«${NBSP}Bonjour${NBSP}»`) }).toEqual({ format, kept: true });
      expect({ format, kept: output.includes(`va${NNBSP}?${NBSP}»`) }).toEqual({ format, kept: true });
      expect({ format, kept: output.includes(`Non${NNBSP}!`) }).toEqual({ format, kept: true });
    }
    // A break spaced with no-break spaces is still a scene break, set as
    // the build sets every break.
    const { epub, docx } = builds(root);
    expect(epub).toContain("<p>* * *</p>");
    expect(epub).not.toContain(`*${NBSP}*`);
    expect(docx).not.toContain(`*${NBSP}*`);
  });

  test("a Japanese paragraph keeps its ideographic-space indent, the first one too", () => {
    const root = project("ja", [
      IDEOGRAPHIC,
      `${IDEOGRAPHIC}一つ目の段落。`,
      "",
      `${IDEOGRAPHIC}二つ目の段落。`,
      IDEOGRAPHIC,
      ""
    ].join("\n"));
    const output = builds(root);
    for (const [format, text] of Object.entries(output)) {
      expect({ format, first: text.includes(`${IDEOGRAPHIC}一つ目の段落。`), second: text.includes(`${IDEOGRAPHIC}二つ目の段落。`) })
        .toEqual({ format, first: true, second: true });
    }
    // Lines of nothing but typed spaces at either end of the chapter are
    // blank: no empty paragraph, and no stray line in the markdown build.
    expect(output.epub).toContain(`<p>${IDEOGRAPHIC}一つ目の段落。</p><p>${IDEOGRAPHIC}二つ目の段落。</p>`);
    expect(output.markdown).toContain(`\n\n${IDEOGRAPHIC}一つ目の段落。\n\n${IDEOGRAPHIC}二つ目の段落。\n`);
    expect(output.markdown).not.toContain(`\n${IDEOGRAPHIC}\n`);
    expect(output.docx).toContain(`<w:t xml:space="preserve">${IDEOGRAPHIC}一つ目の段落。</w:t>`);
  });

  test("layout whitespace still collapses, and a typed-space line at a paragraph's end goes", () => {
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
    "a  b ",
    "   text  "
  ];

  test("on layout whitespace alone they agree with trim() and \\s", () => {
    for (const sample of samples) {
      expect(trimSourceSpace(sample)).toBe(sample.trim());
      expect(collapseSourceSpace(sample)).toBe(sample.replace(/\s+/g, " "));
      expect(trimBlankLines(sample)).toBe(sample.trim());
    }
  });

  test("typed spaces stay", () => {
    expect(trimSourceSpace(` ${NBSP}a${NNBSP} `)).toBe(`${NBSP}a${NNBSP}`);
    expect(collapseSourceSpace(`a ${NBSP} b${IDEOGRAPHIC}\tc`)).toBe(`a ${NBSP} b${IDEOGRAPHIC} c`);
    expect(trimSourceSpace(`${IDEOGRAPHIC}`)).toBe(IDEOGRAPHIC);
  });

  test("trimBlankLines drops typed-space lines at either end but keeps an indent", () => {
    expect(trimBlankLines(`\n${IDEOGRAPHIC}\n \n${IDEOGRAPHIC}本文\n\n${IDEOGRAPHIC}次\n${NBSP}\n`)).toBe(`${IDEOGRAPHIC}本文\n\n${IDEOGRAPHIC}次`);
    expect(trimBlankLines(`${IDEOGRAPHIC}\n${NBSP}`)).toBe("");
  });
});

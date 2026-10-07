import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { shunnHtml } from "../src/packaging.js";
import { buildBook, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, readArchiveText, writeMarkdown } from "./helpers.js";

const repoRoot = path.join(import.meta.dir, "..");

// A one-chapter book in `language` with `prose` as its chapter text.
function project(language, prose) {
  const { root } = createStoryProject({ cwd: makeTempDir(), title: "Breaks", language, force: false });
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", `\n## Chapter Text\n\n${prose}`);
  return root;
}

function file(root, options) {
  return fs.readFileSync(buildBook(root, options).outFile, "utf8");
}

// Every build that turns prose into paragraphs, as text: each archive's
// entries, and the whole file for the rest.
function builds(root) {
  return {
    epub: readArchiveText(buildBook(root, { format: "epub" }).outFile),
    docx: readArchiveText(buildBook(root, { format: "docx" }).outFile),
    shunnDocx: readArchiveText(buildBook(root, { format: "docx", shunn: true }).outFile),
    shunn: file(root, { format: "shunn" }),
    html: file(root, { format: "html" }),
    print: file(root, { format: "print" }),
    narration: file(root, { format: "narration" }),
    ink: file(root, { format: "ink" })
  };
}

// The Shunn PDF's HTML source, which `build --format shunn --pdf` renders.
function shunnPdfHtml(language, body) {
  return shunnHtml({ meta: { language }, chapters: [{ heading: "One", byline: "", body }] }, {
    title: "Breaks", author: "Ada", lead: "Ada", editors: "", labels: undefined, contact: [], words: 10, pack: undefined, shortForm: false
  });
}

describe("scene-break lines in builds (#551)", () => {
  // The same scenes with and without blank lines around each break.
  const spaced = "He left.\n\n* * *\n\nShe came.\n\n---\n\nThen night.\n\n#\n\nMorning.\n";
  const tight = "He left.\n* * *\nShe came.\n---\nThen night.\n#\nMorning.\n";

  test("a scene-break line ends the paragraph with no blank line around it, in every format", () => {
    const expected = builds(project("en", spaced));
    const output = builds(project("en", tight));
    for (const [format, text] of Object.entries(output)) {
      expect({ format, same: text === expected[format] }).toEqual({ format, same: true });
    }
    expect(output.epub).toContain("<p>He left.</p><p>* * *</p><p>She came.</p><p>* * *</p><p>Then night.</p><p>* * *</p><p>Morning.</p>");
    expect(output.docx.match(/<w:pStyle w:val="SceneBreak"\/>/g)).toHaveLength(3);
    expect(output.shunn).toMatch(/He left\.\n\n(#|\* \* \*)\n\nShe came\./);
    // The review copy labels the four paragraphs, as it does the spaced text.
    expect(output.html).toContain('<p id="ch01-p4">');
    expect(output.html).not.toContain('<p id="ch01-p5">');
    expect(output.narration).toContain("He left.\n\n[pause]\n\nShe came.\n\n[pause]\n\nThen night.\n\n[pause]\n\nMorning.");
    expect(output.ink).toContain("He left.\n\n\\* * *\n\nShe came.\n\n\\---\n\nThen night.\n\n\\#\n\nMorning.");
    expect(shunnPdfHtml("en", tight)).toBe(shunnPdfHtml("en", spaced));
  });

  test("a scene-break line inside a quote ends the quoted paragraph", () => {
    const expected = builds(project("en", "> A letter.\n>\n> ***\n>\n> Signed.\n"));
    const output = builds(project("en", "> A letter.\n> ***\n> Signed.\n"));
    // The narration script and ink keep a quote's `>` markers as written.
    delete output.narration;
    delete output.ink;
    for (const [format, text] of Object.entries(output)) {
      expect({ format, same: text === expected[format] }).toEqual({ format, same: true });
    }
    expect(output.epub).toContain("<blockquote><p>A letter.</p></blockquote><p>* * *</p><blockquote><p>Signed.</p></blockquote>");
  });

  test("the markdown build keeps the prose as written", () => {
    expect(file(project("en", tight), { format: "markdown" })).toContain("He left.\n* * *\nShe came.\n---\nThen night.\n");
  });

  test("validate warns about a --- right under a line of text, which markdown viewers read as a heading underline", () => {
    const warnings = (prose) => validateProject(project("en", prose)).warnings.filter((warning) => warning.code === "ambiguous-scene-break");
    expect(warnings(tight).map((warning) => [warning.message, warning.file])).toEqual([[
      "chapters/chapter-01.md has a --- scene break right under a line of text (line 12): builds print a scene break, but markdown viewers read it as a heading underline, so put a blank line above it",
      "chapters/chapter-01.md"
    ]]);
    expect(warnings("One.\n---\nTwo.\n---\nThree.\n")[0].message).toBe(
      "chapters/chapter-01.md has 2 --- scene breaks right under a line of text (lines 10, 12): builds print scene breaks, but markdown viewers read them as heading underlines, so put a blank line above each"
    );
    expect(warnings(spaced)).toEqual([]);
  });
});

describe("soft-wrapped Chinese and Japanese lines in builds (#599)", () => {
  test("kirimi-eki-no-wasuremono wrapped after each sentence builds as it does unwrapped", () => {
    const copy = (name) => {
      const root = path.join(makeTempDir(), name);
      fs.cpSync(path.join(repoRoot, "examples", "kirimi-eki-no-wasuremono"), root, { recursive: true });
      return root;
    };
    const original = copy("kirimi-eki-no-wasuremono");
    const wrapped = copy("kirimi-eki-no-wasuremono");
    let wraps = 0;
    for (const name of ["chapter-01.md", "chapter-02.md", "chapter-03.md"]) {
      const chapter = path.join(wrapped, "chapters", name);
      const [head, prose] = fs.readFileSync(chapter, "utf8").split("## Chapter Text");
      // A break after each 。 that does not end its line or close a quote.
      const broken = prose.replace(/。(?=[^」\n])/g, () => {
        wraps += 1;
        return "。\n";
      });
      fs.writeFileSync(chapter, `${head}## Chapter Text${broken}`, "utf8");
    }
    expect(wraps).toBeGreaterThan(20);
    const expected = builds(original);
    const output = builds(wrapped);
    for (const format of ["epub", "docx", "shunnDocx", "shunn", "html", "print", "ink"]) {
      expect({ format, same: output[format] === expected[format] }).toEqual({ format, same: true });
    }
    // The narration script keeps the lines as written, as the markdown
    // export does.
    expect(output.narration).not.toBe(expected.narration);
  });

  test("a line break between Chinese or Japanese characters is dropped, and a space kept beside other text, in every format", () => {
    const prose = [
      "一行目の文。",
      "二行目の文。",
      "",
      "東京で",
      "Alice に会った。",
      "She said hi.",
      "「こんにちは」と",
      "言った。",
      "",
      "他说：",
      "\u201c你好。\u201d",
      "然后走了。",
      "",
      "The lamp",
      "is dark.",
      ""
    ].join("\n");
    const output = { ...builds(project("ja", prose)), shunnPdf: shunnPdfHtml("ja", prose) };
    delete output.narration;
    for (const [format, text] of Object.entries(output)) {
      expect({
        format,
        japanese: text.includes("一行目の文。二行目の文。"),
        mixed: text.includes("東京で Alice に会った。 She said hi. 「こんにちは」と言った。"),
        chinese: text.includes("他说：\u201c你好。\u201d然后走了。"),
        latin: text.includes("The lamp is dark.")
      }).toEqual({ format, japanese: true, mixed: true, chinese: true, latin: true });
    }
  });

  test("a hard line break between Chinese or Japanese lines stays a break", () => {
    const epub = readArchiveText(buildBook(project("ja", "一行目。\\\n二行目。  \n三行目。\n"), { format: "epub" }).outFile);
    expect(epub).toContain("<p>一行目。<br/>二行目。<br/>三行目。</p>");
  });
});

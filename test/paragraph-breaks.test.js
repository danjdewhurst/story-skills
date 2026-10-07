import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { shunnHtml } from "../src/packaging.js";
import { buildBook, computeWordCounts, createEntity, createStoryProject, exportManuscript, validateProject } from "../src/story.js";
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

const SONG = "The old song went:\n\n*Ember given, fire kept,\\\nEmber taken, mountain wept,  \nWhat the Vale has lent.*\n\n> Dear Mara,\n>\n> Come home.\\\n> Your father\n\nShe hummed it anyway.";

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

function appendProse(root, file, prose) {
  fs.appendFileSync(path.join(root, file), `\n${prose}\n`);
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

  test("a break line in a code fence is code, and the paragraph stays whole", () => {
    // The dashes build as the same text as any other line would.
    const prose = (line) => `Before.\n\n\`\`\`\nINCOMING TRANSMISSION\n${line}\nOrigin: unknown\n\`\`\`\n\nAfter.\n`;
    const output = { ...builds(project("en", prose("----------"))), shunnPdf: shunnPdfHtml("en", prose("----------")) };
    const expected = { ...builds(project("en", prose("=========="))), shunnPdf: shunnPdfHtml("en", prose("==========")) };
    for (const [format, text] of Object.entries(output)) {
      expect({ format, same: text.replaceAll("----------", "==========") === expected[format] }).toEqual({ format, same: true });
    }
    expect(output.epub).toContain("<p>Before.</p><p>INCOMING TRANSMISSION ---------- Origin: unknown</p><p>After.</p>");
    expect(output.narration).toContain("```\nINCOMING TRANSMISSION\n----------\nOrigin: unknown\n```");
    expect(output.ink).toContain("``` INCOMING TRANSMISSION ---------- Origin: unknown ```");
  });

  test("a break line indented by four columns or more stays in its paragraph, as in CommonMark", () => {
    const output = builds(project("en", "One\n    ---\ntwo.\n\nThree\n\t***\nfour.\n"));
    expect(output.epub).toContain("<p>One --- two.</p><p>Three *** four.</p>");
    expect(output.narration).not.toContain("[pause]");
    expect(output.ink).toContain("One --- two.\n\nThree *** four.");
  });

  test("the markdown build, story export, and Twee keep the prose as written", () => {
    const root = project("en", tight);
    expect(file(root, { format: "markdown" })).toContain("He left.\n* * *\nShe came.\n---\nThen night.\n");
    expect(fs.readFileSync(exportManuscript(root, { out: "dist/book.md" }).outFile, "utf8")).toContain("He left.\n* * *\nShe came.\n---\nThen night.\n");
    expect(file(root, { format: "twee" })).toContain("He left.\n* * *\nShe came.\n---\nThen night.\n");
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

  test("a line that ends or starts with emphasis or code keeps its space, so the markup stays apart", () => {
    const prose = "**強調**\n**次**\n\n*彼は*\n*言った*\n\n他说`东京`\n`大阪`很远\n";
    const output = { ...builds(project("ja", prose)), shunnPdf: shunnPdfHtml("ja", prose) };
    expect(output.epub).toContain("<p><strong>強調</strong> <strong>次</strong></p><p><em>彼は</em> <em>言った</em></p><p>他说东京 大阪很远</p>");
    expect(output.html).toContain("<strong>強調</strong> <strong>次</strong>");
    expect(output.shunn).toContain("**強調** **次**\n\n*彼は* *言った*\n\n他说`东京` `大阪`很远");
    expect(output.ink).toContain("\\**強調** **次**\n\n\\*彼は* *言った*\n\n他说`东京` `大阪`很远");
    delete output.narration;
    for (const [format, text] of Object.entries(output)) {
      expect({ format, merged: /強調\*\*\*\*次|彼は\*\*言った|东京``大阪/.test(text) }).toEqual({ format, merged: false });
    }
  });

  test("a heading's text keeps a space before the line under it", () => {
    const output = { ...builds(project("ja", "### 第二部\n本文が始まる。\n")), shunnPdf: shunnPdfHtml("ja", "### 第二部\n本文が始まる。\n") };
    expect(output.narration).toContain("第二部\n本文が始まる。");
    expect(output.ink).toContain("\\#\\#\\# 第二部 本文が始まる。");
    delete output.narration;
    for (const [format, text] of Object.entries(output)) {
      expect({ format, spaced: text.includes("第二部 本文が始まる。") }).toEqual({ format, spaced: true });
    }
  });

  test("a hard line break between Chinese or Japanese lines stays a break", () => {
    const epub = readArchiveText(buildBook(project("ja", "一行目。\\\n二行目。  \n三行目。\n"), { format: "epub" }).outFile);
    expect(epub).toContain("<p>一行目。<br/>二行目。<br/>三行目。</p>");
  });
});

describe("paragraph breaks under Node (#551, #599)", () => {
  test("bin/story.js and the fallback under node build what Bun builds", () => {
    const root = project("ja", [
      "一行目の文。",
      "二行目の文。",
      "* * *",
      "列夫\u00b7",
      "托尔斯泰。",
      "---",
      "### 第二部",
      "本文。",
      "",
      "```",
      "信号",
      "----------",
      "```",
      ""
    ].join("\n"));
    const formats = [["epub", "epub"], ["docx", "docx"], ["docx", "docx", "--shunn"], ["shunn", "md"], ["html", "html"], ["print", "html"], ["narration", "md"], ["ink", "ink"]];
    // Bun and Node deflate archives differently, so archives compare by their
    // entries.
    const text = (file) => (/\.(?:epub|docx)$/.test(file) ? readArchiveText(file) : fs.readFileSync(file, "utf8"));
    for (const [format, extension, ...flags] of formats) {
      const expected = text(buildBook(root, { format, shunn: flags.length > 0, out: `dist/bun-${format}${flags.join("")}.${extension}` }).outFile);
      for (const cli of [path.join(repoRoot, "bin", "story.js"), path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js")]) {
        const out = path.join(root, "dist", `node-${format}${flags.join("")}.${extension}`);
        const node = spawnSync("node", [cli, "build", root, "--format", format, ...flags, "--out", out], { encoding: "utf8" });
        expect({ format, flags, cli, status: node.status, stderr: node.stderr }).toEqual({ format, flags, cli, status: 0, stderr: node.stderr });
        expect({ format, flags, cli, same: text(out) === expected }).toEqual({ format, flags, cli, same: true });
      }
    }
  });
});

describe("hard breaks and blockquotes (#245)", () => {
  test("a quoted line directly after a plain line starts its own paragraph", () => {
    const { root } = storyWithFields();
    writeChapterFile(root, 1, "title: One", "She read the note.\n> Come home.");
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toMatch(/<p id="ch01-p1">.*She read the note\.<\/p>\n<blockquote>\n<p id="ch01-p2">.*Come home\.<\/p>\n<\/blockquote>/);
  });

  test("every paragraph build keeps hard breaks and sets quotes as blockquotes", () => {
    const { root } = storyWithFields();
    writeChapterFile(root, 1, "title: Song", SONG);

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
    const { root } = storyWithFields();
    writeChapterFile(root, 1, "title: Soft", "One line\nand the next.\\");
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain("One line and the next.\\</p>");
  });
});

describe("sweep fixes", () => {
  test("builds read escaped and # scene breaks, hard breaks, and escapes", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "Mara didn\\'t look.\n\n\\* \\* \\*\n\nShe said, \"It's nothing.\"\\\nThe gate was open.\n\n#\n\nEnd.");
    expect(computeWordCounts(root).total).toBe(12);
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html.match(/class="scene-break"/g)).toHaveLength(2);
    expect(html).toContain("nothing.&quot;<br>The gate");
    const narration = fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8");
    expect(narration.match(/\[pause\]/g)).toHaveLength(2);
  });
});

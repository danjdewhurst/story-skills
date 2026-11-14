import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { characterCount, footnoteUses, splitFootnotes, withoutFootnotes, wordCount } from "../src/markdown.js";
import { shunnHtml, wordParagraphs, writeZip } from "../src/packaging.js";
import { manuscriptParts } from "../src/build.js";
import { scanProject } from "../src/scan.js";
import { buildBook, createEntity, createStoryProject, validateProject } from "../src/story.js";
import { footnoteTexts } from "../src/notes.js";
import { makeTempDir, memoryIo, readArchiveEntries, writeMarkdown } from "./helpers.js";

const PROSE = [
  "She left.[^lamp] The *door*[^Lamp] shut.[^2] Not [^none] or `[^code]`.",
  "",
  "[^2]: The second, with *weight*.",
  "",
  "[^lamp]: The lamp went with her,",
  "and the key.",
  "",
  "    It was cold.",
  "",
  "[^spare]: Never used.",
  "",
  "Morning."
].join("\n");

function project(prose = PROSE, second = "Again.[^a]\n\n[^a]: Chapter two's own note.") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Lamp Notes", force: false });
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Night\nnumber: 1\nstatus: draft", `## Chapter Text\n\n${prose}\n`);
  writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Day\nnumber: 2\nstatus: draft", `## Chapter Text\n\n${second}\n`);
  return root;
}

function entries(file) {
  return new Map(readArchiveEntries(file).map((entry) => [entry.name, entry.content.toString("utf8")]));
}

describe("footnotes in builds", () => {
  test("the EPUB links each marker to a footnote aside, numbered per chapter in order of first reference", () => {
    const root = project();
    const files = entries(buildBook(root, { format: "epub" }).outFile);
    const chapter = files.get("OEBPS/chapter-01.xhtml");
    expect(chapter).toContain('<p>She left.<a epub:type="noteref" role="doc-noteref" id="noteref-1" href="#note-1"><sup>1</sup></a> The <em>door</em><a epub:type="noteref" role="doc-noteref" id="noteref-1-2" href="#note-1"><sup>1</sup></a> shut.<a epub:type="noteref" role="doc-noteref" id="noteref-2" href="#note-2"><sup>2</sup></a> Not [^none] or [^code].</p><p>It was cold.</p><p>Morning.</p>');
    expect(chapter).toContain('<aside epub:type="footnote" role="doc-footnote" id="note-1"><p><a role="doc-backlink" href="#noteref-1">1.</a> The lamp went with her, and the key.</p></aside><aside epub:type="footnote" role="doc-footnote" id="note-2"><p><a role="doc-backlink" href="#noteref-2">2.</a> The second, with <em>weight</em>.</p></aside></body>');
    expect(chapter).not.toContain("Never used");
    expect(files.get("OEBPS/chapter-02.xhtml")).toContain('id="note-1"><p><a role="doc-backlink" href="#noteref-1">1.</a> Chapter two');
  });

  test("the review copy and print interior put a chapter's notes after it, linked both ways, and notes take no paragraph label", () => {
    const root = project();
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain('She left.<sup class="noteref"><a href="#ch01-fn1" id="ch01-fnref1" role="doc-noteref">1</a></sup> The <em>door</em><sup class="noteref"><a href="#ch01-fn1" id="ch01-fnref1-2" role="doc-noteref">1</a></sup>');
    expect(html).toContain('<p id="ch01-p3"><a class="anchor" href="#ch01-p3" title="Link to ch01-p3">ch01-p3</a>Morning.</p>\n<aside class="footnotes"><h3>Notes</h3>\n<div class="footnote" id="ch01-fn1" role="doc-footnote"><p><a href="#ch01-fnref1" role="doc-backlink">1.</a> The lamp went with her, and the key.</p></div>');
    expect(html).not.toContain("ch01-p4");
    expect(html).toContain('<div class="footnote" id="ch02-fn1" role="doc-footnote">');
    expect(html).toContain(".footnotes h3 {");
    const print = fs.readFileSync(buildBook(root, { format: "print" }).outFile, "utf8");
    expect(print).toContain('<p>Morning.</p>\n<aside class="footnotes"><h2>Notes</h2>');
    expect(print).toContain(".footnotes h2 {");
  });

  test("a book without footnotes has no note rules or parts", () => {
    const root = project("Plain.", "Also plain.");
    expect(fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8")).not.toContain("footnote");
    const files = entries(buildBook(root, { format: "docx" }).outFile);
    expect(files.has("word/footnotes.xml")).toBe(false);
    expect(files.get("word/styles.xml")).not.toContain("Footnote");
  });

  test("the DOCX sets real footnotes, one per marker, and the text keeps no marker", () => {
    const root = project();
    const files = entries(buildBook(root, { format: "docx" }).outFile);
    const document = files.get("word/document.xml");
    expect(document).toContain('<w:r><w:t xml:space="preserve">She left.</w:t></w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r><w:r><w:t xml:space="preserve"> The </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">door</w:t></w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="2"/></w:r>');
    // Word numbers footnotes through the document: chapter two's is the fourth.
    expect(document).toContain('<w:footnoteReference w:id="4"/>');
    expect(document).not.toContain('w:id="5"');
    const footnotes = files.get("word/footnotes.xml");
    expect(footnotes).toContain('<w:footnote w:type="separator" w:id="-1">');
    expect(footnotes).toContain('<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:t xml:space="preserve">The lamp went with her, and the key.</w:t></w:r></w:p></w:footnote>');
    // The note referenced twice is a footnote at each marker.
    expect(footnotes.match(/The lamp went with her/g)).toHaveLength(2);
    expect(footnotes).toContain("Chapter two");
    expect(files.get("[Content_Types].xml")).toContain('<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>');
    expect(files.get("word/_rels/document.xml.rels")).toContain('Target="footnotes.xml"');
    expect(files.get("word/styles.xml")).toContain('<w:style w:type="character" w:styleId="FootnoteReference">');
  });

  test("the Shunn builds number the markers and set the notes after each chapter under a heading", () => {
    const root = project();
    const markdown = fs.readFileSync(buildBook(root, { format: "shunn" }).outFile, "utf8");
    expect(markdown).toContain("She left.[1] The *door*[1] shut.[2] Not [^none] or `[^code]`.\n\nIt was cold.\n\nMorning.\n\nNotes\n\n1. The lamp went with her, and the key.\n\n2. The second, with *weight*.\n");
    expect(markdown).toContain("Again.[1]\n\nNotes\n\n1. Chapter two's own note.\n");
    const docx = entries(buildBook(root, { format: "docx", shunn: true }).outFile);
    expect(docx.has("word/footnotes.xml")).toBe(false);
    expect(docx.get("word/document.xml")).toContain('<w:sz w:val="24"/><w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">1</w:t>');
    expect(docx.get("word/document.xml")).toContain('<w:t xml:space="preserve">Notes</w:t>');
    expect(docx.get("word/document.xml")).toContain('<w:t xml:space="preserve">1. </w:t></w:r><w:r>');
  });

  test("the narration script reads no footnote, the markdown export keeps them as written, and word counts leave notes out", () => {
    const root = project();
    const narration = fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8");
    expect(narration).toContain("She left. The *door* shut. Not [^none] or `[^code]`.");
    expect(narration).toContain("Morning.");
    expect(narration).not.toContain("lamp went");
    expect(fs.readFileSync(buildBook(root, { format: "markdown" }).outFile, "utf8")).toContain(PROSE);
    expect(wordCount(PROSE)).toBe(wordCount("She left. The door shut. Not or code. It was cold. Morning."));
    expect(characterCount("A.[^1]\n\n[^1]: Note.")).toBe(2);
  });

  test("story apply reads back a build with footnotes and changes nothing", () => {
    const root = project();
    const dir = path.dirname(root);
    const out = path.join(dir, "sent.docx");
    const run = (...argv) => {
      const io = memoryIo(dir);
      const code = runCli(argv, io);
      return { code, stdout: io.output(), stderr: io.error() };
    };
    expect(run("build", path.basename(root), "--format", "docx", "--out", out).code).toBe(0);
    const before = fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8");
    const result = run("apply", out, "--path", path.basename(root));
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8")).toBe(before);
  });

  test("story apply writes an edit in a chapter with footnotes", () => {
    const root = project();
    const dir = path.dirname(root);
    const out = path.join(dir, "sent.docx");
    const run = (...argv) => {
      const io = memoryIo(dir);
      const code = runCli(argv, io);
      return { code, stdout: io.output(), stderr: io.error() };
    };
    expect(run("build", path.basename(root), "--format", "docx", "--out", out).code).toBe(0);
    const sent = readArchiveEntries(out);
    const edited = path.join(dir, "edited.docx");
    writeZip(edited, sent.map((entry) => (entry.name === "word/document.xml" ? { ...entry, content: entry.content.toString("utf8").replace(">Morning.<", ">Morning came.<") } : entry)));
    const chapterPath = path.join(root, "chapters", "chapter-01.md");
    const before = fs.readFileSync(chapterPath, "utf8");
    const result = run("apply", edited, "--path", path.basename(root));
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
    expect(fs.readFileSync(chapterPath, "utf8")).toBe(before.replace("\nMorning.\n", "\nMorning came.\n"));
    // A note the editor rewrote in Word is not written, and says so.
    const noted = path.join(dir, "noted.docx");
    writeZip(noted, sent.map((entry) => (entry.name === "word/footnotes.xml" ? { ...entry, content: entry.content.toString("utf8").replace("The second, with", "The second, now with") } : entry)));
    expect(run("apply", noted, "--path", path.basename(root)).stderr).toContain("has 1 footnote whose text is not in the project's footnotes (or the project changed them since sending; pass --ref or --snapshot to tell), which story apply does not write");
  });

  test("footnotes in a matter page link within its own document, and the Shunn PDF source numbers them", () => {
    const root = project("Plain.", "Again.[^a]\n\n[^a]: Day note.");
    createEntity(root, { kind: "matter", name: "Afterword", placement: "back" });
    fs.appendFileSync(path.join(root, "matter", "afterword.md"), "\nThanks.[^t]\n\n[^t]: To all.\n");
    const epub = entries(buildBook(root, { format: "epub" }).outFile);
    expect(epub.get("OEBPS/back-afterword.xhtml")).toContain('<aside epub:type="footnote" role="doc-footnote" id="note-1"><p><a role="doc-backlink" href="#noteref-1">1.</a> To all.</p></aside>');
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain('<a href="#back-afterword-fn1" id="back-afterword-fnref1" role="doc-noteref">1</a>');
    const book = manuscriptParts(scanProject(root), "build");
    const shunn = shunnHtml(book, { title: "Lamp Notes", contact: [], labels: book.meta.labels });
    expect(shunn).toContain('<p>Again.<sup>1</sup></p>\n<p class="break">Notes</p>\n<p>1. Day note.</p>');
  });

  test("a short story's Shunn PDF source sets each chapter's notes after its section", () => {
    const root = project("One.[^1]\n\n[^1]: First.", "Two.[^1]\n\n[^1]: Second.");
    const book = manuscriptParts(scanProject(root), "build");
    const shunn = shunnHtml(book, { title: "Lamp Notes", contact: [], labels: book.meta.labels, shortForm: true });
    expect(shunn).toContain('<p>One.<sup>1</sup></p>\n<p class="break">Notes</p>\n<p>1. First.</p>\n<p class="break">#</p>\n<p>Two.<sup>1</sup></p>\n<p class="break">Notes</p>\n<p>1. Second.</p>');
  });

  test("an image in a footnote is left out with a warning", () => {
    const root = project("A.[^1]\n\n[^1]: See ![map](../map.png).");
    const result = buildBook(root, { format: "epub" });
    expect(result.warnings.map((warning) => warning.message)).toEqual(["chapters/chapter-01.md image ../map.png is in footnote [^1], which builds set as text only, so it is left out"]);
    expect(entries(result.outFile).get("OEBPS/chapter-01.xhtml")).toContain("1.</a> See .</p>");
  });

  test("the Word text view drops markers and definitions, also for a block read without its chapter's notes", () => {
    const text = (paragraphs) => paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(""));
    expect(text(wordParagraphs("A.[^1] B.\n\n[^1]: Note."))).toEqual(["A. B."]);
    expect(text(wordParagraphs("A.[^1] B."))).toEqual(["A.[^1] B."]);
    expect(text(wordParagraphs("A.[^1] B.", false, splitFootnotes("[^1]: Note.").notes))).toEqual(["A. B."]);
  });
});

describe("footnote parsing", () => {
  test("a marker escaped, in an autolink, or in code is no marker, and fenced code keeps its text", () => {
    expect(withoutFootnotes("A.[^1] \\[^1] <https://x.example/[^1]> `[^1]`\n\n```\n[^1]\n```\n\n[^1]: Note.")).toBe("A. \\[^1] <https://x.example/[^1]> `[^1]`\n\n```\n[^1]\n```\n\n");
  });

  test("footnoteTexts reads each note's text, entities and all, without Word's separators", () => {
    expect(footnoteTexts('<w:footnotes><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t xml:space="preserve"> Tom &amp; Jerry</w:t></w:r><w:r><w:t>  &quot;ran&quot;</w:t></w:r></w:p></w:footnote></w:footnotes>')).toEqual(["Tom & Jerry \"ran\""]);
    expect(footnoteTexts(null)).toEqual([]);
  });

  test("a definition is one paragraph, ends at a blank line or a block quote, and may sit in a block quote", () => {
    const { text, notes } = splitFootnotes("A.[^1]\n[^1]: One\nlazy.\n\n    Indented prose.\n\nB.\n\n> C.[^q]\n>\n> [^Q]: Quoted.\n\n[^z]: Zed\n> quoted\n\n```\n[^f]: fenced\n```\n");
    expect([...notes.values()]).toEqual([{ label: "1", text: "One\nlazy." }, { label: "Q", text: "Quoted." }, { label: "z", text: "Zed" }]);
    expect(text).toBe("A.[^1]\n\n\n\n    Indented prose.\n\nB.\n\n> C.[^q]\n>\n\n\n\n> quoted\n\n```\n[^f]: fenced\n```\n");
  });

  test("footnoteUses finds definitions and markers in the prose only, with their body lines", () => {
    const body = "# One\n\n## Outline\n\n- A note[^x]\n\n## Chapter Text\n\nText.[^1] [x](y[^2]) <!-- [^3] --> [^5](https://example.com) ![see [^6]](a.png)\n\n[^1]: Note [^4].\n";
    expect(footnoteUses(body)).toEqual({ definitions: [{ label: "1", line: 10 }], markers: [{ label: "1", line: 8 }] });
  });
});

describe("footnote checks", () => {
  test("validate checks matter pages too, and a severity entry or exemption for the retired unsupported-footnote is accepted", () => {
    const root = project("Plain.", "Plain.");
    createEntity(root, { kind: "matter", name: "Afterword", placement: "back" });
    fs.appendFileSync(path.join(root, "matter", "afterword.md"), "\nThanks.[^1]\n");
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", "schema-version: 2\nseverity:\n  - warning: unsupported-footnote\n    level: off\n"));
    fs.mkdirSync(path.join(root, "continuity"), { recursive: true });
    writeMarkdown(path.join(root, "continuity", "exemptions.md"), "type: exemption-log\nexemptions:\n  - code: unsupported-footnote\n    file: chapters/chapter-01.md\n    reason: Kept from before footnotes were set");
    const result = validateProject(root);
    expect(result.errors).toEqual([]);
    expect(result.warnings.filter((warning) => warning.code === "missing-footnote").map((warning) => [warning.file, warning.message])).toEqual([
      ["matter/afterword.md", "matter/afterword.md has footnote marker [^1] (line 11) with no [^1]: note, so builds print the marker as written: add the note or remove the marker"]
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { shunnHtml, writeDocx } from "../src/packaging.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { buildBook, computeWordCounts, createStoryProject, exportManuscript, splitChapter, validateProject } from "../src/story.js";
import { makeTempDir, messages, readArchiveEntries, readArchiveText, writeMarkdown } from "./helpers.js";

// Collections and anthologies (#473): a chapter's own `author` and the
// book's `editor`.

const repoRoot = path.resolve(import.meta.dir, "..");

function project(storyFields = "", title = "Salt Roads") {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title, force: false });
  const storyPath = path.join(created.root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(`title: ${title}\n`, `title: ${title}\n${storyFields}`), "utf8");
  return created.root;
}

function chapter(root, number, title, body, fields = "") {
  writeMarkdown(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), `number: ${number}\nstatus: draft\ntitle: ${title}${fields}`, `## Chapter Text\n\n${body}\n`);
}

function anthology(storyFields = "editor: Cara Editor\nlabels:\n  - chapter-heading: \"{title}\"\n") {
  const root = project(storyFields);
  chapter(root, 1, "Low Tide", "The tide went out.", "\nauthor: Ben Other");
  chapter(root, 2, "Salt", "Ruth raked the salt.", "\nauthor:\n  - Dee Writer\n  - Eve Poet");
  chapter(root, 3, "Lantern", "The lamp was lit.");
  return root;
}

function build(root, format, options = {}) {
  const { outFile } = buildBook(root, { format, ...options });
  return format === "epub" || format === "docx" ? readArchiveText(outFile) : fs.readFileSync(outFile, "utf8");
}

// The plain DOCX build's entries by name, decoded.
function docx(root, options = {}) {
  const entries = readArchiveEntries(buildBook(root, { format: "docx", ...options }).outFile);
  return Object.fromEntries(entries.map((entry) => [entry.name, entry.content.toString("utf8")]));
}

// A credit line in the DOCX title block.
function credit(text) {
  return `<w:p><w:pPr><w:pStyle w:val="Credit"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

const DOCX_TITLE = `<w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">Salt Roads</w:t></w:r></w:p>`;
const DOCX_HEADING = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>`;

describe("collection and anthology authors (#473)", () => {
  test("validate accepts a name or a list and rejects anything else", () => {
    const root = anthology();
    expect(validateProject(root).errors).toEqual([]);
    chapter(root, 1, "Low Tide", "The tide went out.", "\nauthor: 42");
    chapter(root, 2, "Salt", "Ruth raked the salt.", "\nauthor:\n  - Dee Writer\n  - \"\"");
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("editor: Cara Editor", "editor: \" \""), "utf8");
    expect(messages(validateProject(root).errors)).toEqual(expect.arrayContaining([
      "story.md frontmatter field editor must be a name or a list of names, such as editor: Ada Writer",
      "chapters/chapter-01.md frontmatter field author must be a name or a list of names, such as author: Ada Writer",
      "chapters/chapter-02.md frontmatter field author must be a name or a list of names, such as author: Ada Writer"
    ]));
  });

  test("bylines never count toward word counts", () => {
    const root = anthology();
    expect(computeWordCounts(root).total).toBe(12);
    expect(build(root, "shunn")).toContain("Approximately 12 words");
  });

  test("the markdown build and export print each story's byline under its heading", () => {
    const root = anthology();
    const text = build(root, "markdown");
    expect(text).toContain("# Low Tide\n\n*by Ben Other*\n\nThe tide went out.");
    expect(text).toContain("# Salt\n\n*by Dee Writer and Eve Poet*\n\nRuth raked the salt.");
    expect(text).toContain("# Lantern\n\nThe lamp was lit.");
    const exported = fs.readFileSync(exportManuscript(root).outFile, "utf8");
    expect(exported).toContain("*by Ben Other*");
  });

  test("the EPUB credits the editor and story authors with their roles", () => {
    const text = build(anthology(), "epub");
    expect(text).toContain(`<dc:creator id="editor-1">Cara Editor</dc:creator><meta refines="#editor-1" property="role" scheme="marc:relators">edt</meta>`);
    expect(text).toContain(`<dc:contributor id="contributor-1">Ben Other</dc:contributor><meta refines="#contributor-1" property="role" scheme="marc:relators">aut</meta>`);
    expect(text).toContain(`<dc:contributor id="contributor-3">Eve Poet</dc:contributor>`);
    expect(text).toContain(`<h1>Low Tide</h1><p class="byline"><em>by Ben Other</em></p><p>The tide went out.</p>`);
    expect(text).toContain(`<h1>Lantern</h1><p>The lamp was lit.</p>`);
  });

  test("an author who also writes a story is credited once, as an author", () => {
    const root = anthology("author: Ben Other\neditor: Cara Editor\n");
    const text = build(root, "epub");
    expect(text).toContain(`<dc:creator id="author-1">Ben Other</dc:creator><meta refines="#author-1" property="role" scheme="marc:relators">aut</meta>`);
    expect(text).not.toContain(`<dc:contributor id="contributor-1">Ben Other`);
    expect(text).toContain(`<dc:contributor id="contributor-1">Dee Writer</dc:contributor>`);
  });

  test("a book by its authors alone keeps plain creators and an unchanged stylesheet", () => {
    const root = project("author: Ada Writer\nbuild-style:\n  - drop-caps: true\n");
    chapter(root, 1, "One", "Text here.");
    const text = build(root, "epub");
    expect(text).toContain("<dc:creator>Ada Writer</dc:creator><dc:language>");
    expect(text).not.toContain("byline");
    expect(text).toContain("body.chapter > h1 + p::first-letter");
  });

  test("a styled EPUB keeps its drop cap and first-line indent off the byline", () => {
    const root = anthology("editor: Cara Editor\nbuild-style:\n  - drop-caps: true\n");
    const text = build(root, "epub");
    expect(text).toContain("p.byline { text-align: center; text-indent: 0;");
    expect(text).toContain("body.chapter > h1 + p:not(.byline)::first-letter, body.chapter > h1 + p.byline + p::first-letter {");
  });

  test("DOCX sets each byline as a Byline paragraph under the heading", () => {
    const text = build(anthology(), "docx");
    expect(text).toContain(`w:styleId="Byline"`);
    expect(text).toMatch(/Low Tide<\/w:t><\/w:r><\/w:p><w:p><w:pPr><w:pStyle w:val="Byline"\/><\/w:pPr><w:r><w:t xml:space="preserve">by Ben Other<\/w:t>/);
  });

  test("the DOCX title block credits the authors, then the editor (#518)", () => {
    const root = anthology("author: Ada Writer\neditor: Cara Editor\n");
    const entries = docx(root);
    expect(entries["word/document.xml"]).toContain(`${DOCX_TITLE}${credit("Ada Writer")}${credit("Edited by Cara Editor")}${DOCX_HEADING}`);
    // Each story's own author stays in its byline under the heading.
    expect(entries["word/document.xml"].match(/w:val="Credit"/g)).toHaveLength(2);
    expect(entries["word/document.xml"]).toContain(`<w:pStyle w:val="Byline"/></w:pPr><w:r><w:t xml:space="preserve">by Ben Other</w:t>`);
    expect(entries["word/styles.xml"]).toContain(`<w:style w:type="paragraph" w:customStyle="1" w:styleId="Credit"><w:name w:val="Credit"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="240"/><w:ind w:firstLine="0"/><w:contextualSpacing/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="28"/></w:rPr></w:style>`);
  });

  test("a credited DOCX is byte for byte the same from Bun, Node, and the Node fallback (#518)", () => {
    // process.execPath is Bun under `bun test`, so Node is looked up on PATH.
    if (spawnSync("node", ["--version"]).status !== 0) {
      console.warn("Skipping the cross-runtime DOCX credit test: node is not on PATH.");
      return;
    }
    const root = anthology("language: de\nauthors:\n  - Ada Writer\n  - Bo Two\neditor: Cara Editor\n");
    const built = fs.readFileSync(buildBook(root, { format: "docx", out: "dist/bun.docx" }).outFile);
    expect(built.length).toBeGreaterThan(0);
    for (const [runner, script] of [["node", path.join(repoRoot, "bin", "story.js")], ["fallback", path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js")]]) {
      const out = path.join(root, "dist", `${runner}.docx`);
      const result = spawnSync("node", [script, "build", root, "--format", "docx", "--out", out], { encoding: "utf8" });
      expect(result.status).toBe(0);
      expect({ runner, same: fs.readFileSync(out).equals(built) }).toEqual({ runner, same: true });
    }
  });

  test("writeDocx credits only the names its metadata holds (#518)", () => {
    const dir = makeTempDir();
    const book = { title: "Salt Roads", front: [], chapters: [{ heading: "One", body: "Text here." }], back: [] };
    const document = (name, meta) => {
      const outFile = path.join(dir, `${name}.docx`);
      writeDocx(outFile, { ...book, meta });
      return readArchiveEntries(outFile).find((entry) => entry.name === "word/document.xml").content.toString("utf8");
    };
    expect(document("none", undefined)).toContain(`${DOCX_TITLE}${DOCX_HEADING}`);
    expect(document("partial", { language: "en" })).toContain(`${DOCX_TITLE}${DOCX_HEADING}`);
    expect(document("editors", { language: "en", editors: ["Cara Editor"] })).toContain(`${DOCX_TITLE}${credit("Edited by Cara Editor")}${DOCX_HEADING}`);
    expect(document("authors", { language: "en", authors: ["Ada Writer", "Bo Two"] })).toContain(`${DOCX_TITLE}${credit("Ada Writer and Bo Two")}${DOCX_HEADING}`);
  });

  test("an anthology's DOCX credits its editor alone, and an uncredited book has no credit line (#518)", () => {
    expect(docx(anthology())["word/document.xml"]).toContain(`${DOCX_TITLE}${credit("Edited by Cara Editor")}${DOCX_HEADING}`);
    const plain = project();
    chapter(plain, 1, "One", "Text here.");
    expect(docx(plain)["word/document.xml"]).toContain(`${DOCX_TITLE}${DOCX_HEADING}`);
    const placeholder = project("author: \"[TODO: author to supply]\"\n");
    chapter(placeholder, 1, "One", "Text here.");
    expect(docx(placeholder)["word/document.xml"]).not.toContain(`w:val="Credit"`);
  });

  test("the DOCX credits join co-authors and follow the book's language and labels (#518)", () => {
    const coAuthors = project("authors:\n  - Ada Writer\n  - \"Bo & <Two>\"\n");
    chapter(coAuthors, 1, "One", "Text here.");
    expect(docx(coAuthors)["word/document.xml"]).toContain(`${DOCX_TITLE}${credit("Ada Writer and Bo &amp; &lt;Two&gt;")}${DOCX_HEADING}`);
    const german = anthology("language: de\nauthors:\n  - Ada Writer\n  - Bo Two\neditor: Cara Editor\n");
    expect(docx(german)["word/document.xml"]).toContain(`${credit("Ada Writer und Bo Two")}${credit("Herausgegeben von Cara Editor")}`);
    const japanese = anthology("language: ja\neditor: Cara Editor\n");
    expect(docx(japanese)["word/document.xml"]).toContain(credit("Cara Editor 編"));
    const custom = anthology("editor: Cara Editor\nlabels:\n  - edited-by: \"Selected by {names}\"\n");
    expect(docx(custom)["word/document.xml"]).toContain(credit("Selected by Cara Editor"));
  });

  test("the HTML review copy and print interior credit the editor and each story", () => {
    const root = anthology();
    const review = build(root, "html");
    expect(review).toContain(`<p class="byline">Edited by Cara Editor</p>`);
    expect(review).toContain(`<h2>Low Tide</h2>\n<p class="byline">by Ben Other</p>`);
    // The byline takes no paragraph label: the story's first paragraph is still p1.
    expect(review).toMatch(/<p class="byline">by Ben Other<\/p>\n<p id="ch01-p1">/);
    const print = build(root, "print");
    expect(print).toContain(`<p class="author">Edited by Cara Editor</p>`);
    expect(print).toContain(`<h1>Low Tide</h1>\n<p class="byline">by Ben Other</p>`);
    expect(print).toContain(`@top-center { content: "Cara Editor";`);
    expect(print).toContain("section.chapter > h1 + p.byline + p.first::first-letter");
  });

  test("a collection by one writer with an editor credits both on the title page", () => {
    const root = anthology("author: Ada Writer\neditor: Cara Editor\n");
    const print = build(root, "print");
    expect(print).toContain(`<p class="author">Ada Writer</p><p class="author">Edited by Cara Editor</p>`);
    expect(print).toContain(`@top-center { content: "Ada Writer";`);
  });

  test("the Shunn builds use the editor's credit and print each story's byline", () => {
    const root = anthology();
    const text = build(root, "shunn");
    expect(text.startsWith("Salt Roads\nEdited by Cara Editor\n\nApproximately 12 words")).toBe(true);
    expect(text).toContain("# Low Tide\n\nby Ben Other\n\nThe tide went out.");
    const docx = build(root, "docx", { shunn: true });
    expect(docx).toContain(">Edited by Cara Editor<");
    expect(docx).toContain(">by Ben Other<");
    const html = shunnHtml({ meta: { language: "en" }, chapters: [{ heading: "Low Tide", byline: "by Ben Other", body: "The tide went out." }] }, {
      title: "Salt Roads", author: "", lead: "Cara Editor", editors: "Edited by Cara Editor", labels: undefined, contact: [], words: 4, pack: undefined, shortForm: false
    });
    expect(html).toContain(`<h1>Salt Roads</h1>\n<p>Edited by Cara Editor</p>`);
    expect(html).toContain(`<h2>Low Tide</h2>\n<p class="byline">by Ben Other</p>`);
    expect(html).toContain(`"Editor / " "Salt Roads / " counter(page)`);
  });

  test("a short story's Shunn manuscript runs on without chapter bylines", () => {
    const root = anthology("form: short-story\neditor: Cara Editor\n");
    const text = build(root, "shunn");
    expect(text).not.toContain("by Ben Other");
  });

  test("the codex credits the editor and names each story's author", () => {
    const root = anthology();
    const site = buildBook(root, { format: "codex" }).outFile;
    expect(fs.readFileSync(path.join(site, "index.html"), "utf8")).toContain(`<p class="byline">Edited by Cara Editor</p>`);
    expect(fs.readFileSync(path.join(site, "progress.html"), "utf8")).toContain(`<span class="byline">by Dee Writer and Eve Poet</span>`);
  });

  test("bylines and the editor credit follow the book's language and labels", () => {
    const german = anthology("language: de\neditor: Cara Editor\n");
    const text = build(german, "markdown");
    expect(text).toContain("*von Ben Other*");
    expect(text).toContain("*von Dee Writer und Eve Poet*");
    expect(build(german, "shunn")).toContain("Herausgegeben von Cara Editor");
    const japanese = anthology("language: ja\neditor: Cara Editor\n");
    expect(build(japanese, "print")).toContain(`<p class="author">Cara Editor 編</p>`);
    const custom = anthology("editor: Cara Editor\nlabels:\n  - byline: \"Story by {names}\"\n  - edited-by: \"Selected by {names}\"\n");
    expect(build(custom, "markdown")).toContain("*Story by Ben Other*");
    expect(build(custom, "shunn")).toContain("Selected by Cara Editor");
  });

  // #539: these credits name the work, not the person, so they need no
  // plural for two editors and no feminine form for an editor who is a
  // woman; a Hindi byline is the name alone, as a Russian one is.
  test("Russian, Ukrainian, and Hindi credits fit any number of editors and any gender", () => {
    const credits = { ru: "Составление: Cara Editor и Ada Writer", uk: "Упорядкування: Cara Editor і Ada Writer", hi: "संपादन: Cara Editor और Ada Writer" };
    for (const [language, credit] of Object.entries(credits)) {
      expect(build(anthology(`language: ${language}\neditor:\n  - Cara Editor\n  - Ada Writer\n`), "shunn")).toContain(credit);
    }
    const hindi = build(anthology("language: hi\n"), "markdown");
    expect(hindi).toContain("*Dee Writer और Eve Poet*");
    expect(hindi).not.toContain("लेखक");
  });

  test("the metadata sheet lists editors and counts an editor as the credit", () => {
    const text = build(anthology(), "metadata");
    expect(text).toContain("| Editor(s) | Cara Editor |");
    expect(text).toContain("- [x] Author named");
  });
  test("a placeholder story author warns and is left out of builds", () => {
    const root = anthology();
    chapter(root, 3, "Lantern", "The lamp was lit.", "\nauthor: \"[TODO: author to supply]\"");
    expect(messages(validateProject(root).warnings)).toContain("chapters/chapter-03.md author is still a [TODO] placeholder; builds leave it out");
    expect(build(root, "markdown")).not.toContain("TODO");
  });

  test("an editor who also wrote a story carries both roles in the EPUB", () => {
    const root = anthology("editor: Ben Other\n");
    const text = build(root, "epub");
    expect(text).toContain(`<dc:creator id="editor-1">Ben Other</dc:creator><meta refines="#editor-1" property="role" scheme="marc:relators">edt</meta><meta refines="#editor-1" property="role" scheme="marc:relators">aut</meta>`);
    expect(text).not.toContain(`<dc:contributor id="contributor-1">Ben Other`);
  });

  test("the ink author tag names only authors, never the editor", () => {
    const text = build(anthology(), "ink");
    expect(text).not.toContain("Cara Editor");
    expect(build(anthology("author: Ada Writer\neditor: Cara Editor\n"), "ink")).toContain("# author: Ada Writer");
  });

  test("an indented review copy keeps the byline unindented", () => {
    const review = build(anthology("editor: Cara Editor\nbuild-style:\n  - paragraphs: indented\n    drop-caps: true\n"), "html");
    expect(review).toContain("section > p.byline { text-indent: 0; margin-block-end: 1rem; }");
    expect(review).toContain("section > h2 + p:not(.byline), section > h2 + p.byline + p, .scene-break + p");
    expect(review).toContain("section.chapter > h2 + p:not(.byline)::first-letter, section.chapter > h2 + p.byline + p::first-letter");
  });

  test("splitting a story keeps its author on both halves", () => {
    const root = anthology();
    chapter(root, 1, "Low Tide", "The tide went out.\n\n* * *\n\nNell walked home.", "\nauthor: Ben Other");
    splitChapter(root, { id: "chapter-01", at: "1" });
    const second = parseFrontmatter(fs.readFileSync(path.join(root, "chapters", "chapter-02.md"), "utf8")).data;
    expect(second.author).toBe("Ben Other");
    expect(build(root, "markdown")).toContain("# Low Tide (continued)\n\n*by Ben Other*");
  });
});

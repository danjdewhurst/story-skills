import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { shunnHtml } from "../src/packaging.js";
import { buildBook, computeWordCounts, createStoryProject, exportManuscript, validateProject } from "../src/story.js";
import { makeTempDir, messages, readArchiveText, writeMarkdown } from "./helpers.js";

// Collections and anthologies (#473): a chapter's own `author` and the
// book's `editor`.

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
    expect(html).toContain(`"Cara Editor / " "Salt Roads / " counter(page)`);
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

  test("the metadata sheet lists editors and counts an editor as the credit", () => {
    const text = build(anthology(), "metadata");
    expect(text).toContain("| Editor(s) | Cara Editor |");
    expect(text).toContain("- [x] Author named");
  });
});

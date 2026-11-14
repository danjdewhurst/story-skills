import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { runCli } from "../src/cli.js";
import { buildBook, createStoryProject, scanProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

const EPISODE = `The bell rang *twice* and then **stopped**.

> A letter, old and creased.
>
> It said:\\
> come home.

Roses are red,\\
violets are blue.

* * *

She ran <fast> & far.`;

function project(storyFields = "") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Serial Book", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("tense: past\n", `tense: past\n${storyFields}`), "utf8");
  return root;
}

function chapter(root, number, { id = `chapter-${String(number).padStart(2, "0")}`, title = `Part ${number}`, extra = "", body = `Episode ${number} begins.` } = {}) {
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: ${JSON.stringify(title)}\nnumber: ${number}\nstatus: draft\n${extra}`, `## Chapter Text\n\n${body}\n`);
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// The folder's files, without the manifest that every build writes.
const posts = (root, folder = path.join("dist", "posts")) => fs.readdirSync(path.join(root, folder)).filter((name) => name !== ".story-posts.json").sort();
const manifest = (root, folder = path.join("dist", "posts")) => JSON.parse(fs.readFileSync(path.join(root, folder, ".story-posts.json"), "utf8"));
const read = (root, name, folder = path.join("dist", "posts")) => fs.readFileSync(path.join(root, folder, name), "utf8");

const NOTE = 'author-note: "Thanks for reading! Next episode on *Friday*.\\n\\nSupport me at https://example.com"\n';

describe("build --format post", () => {
  test("writes each chapter as an HTML fragment and plain text, with its author's note after", () => {
    const root = project();
    chapter(root, 1, { body: EPISODE, extra: NOTE });
    chapter(root, 2);
    const result = buildBook(root, { format: "post" });
    expect(result).toMatchObject({ format: "post", outFile: path.join(root, "dist", "posts"), chapters: 2, posts: 2, warnings: [] });
    expect(posts(root)).toEqual(["01-chapter-01.html", "01-chapter-01.txt", "02-chapter-02.html", "02-chapter-02.txt"]);
    expect(read(root, "01-chapter-01.html")).toBe(`<p>The bell rang <em>twice</em> and then <strong>stopped</strong>.</p>
<blockquote>
<p>A letter, old and creased.</p>
<p>It said:<br>come home.</p>
</blockquote>
<p>Roses are red,<br>violets are blue.</p>
<hr>
<p>She ran &lt;fast&gt; &amp; far.</p>
<hr>
<p><strong>Author's note</strong></p>
<p>Thanks for reading! Next episode on <em>Friday</em>.</p>
<p>Support me at https://example.com</p>
`);
    expect(read(root, "01-chapter-01.txt")).toBe(`The bell rang twice and then stopped.

    A letter, old and creased.

    It said:
    come home.

Roses are red,
violets are blue.

* * *

She ran <fast> & far.

---

Author's note

Thanks for reading! Next episode on Friday.

Support me at https://example.com
`);
    // No page wrapper, no heading: the site takes the title in its own field.
    expect(read(root, "02-chapter-02.html")).toBe("<p>Episode 2 begins.</p>\n");
    expect(read(root, "02-chapter-02.txt")).toBe("Episode 2 begins.\n");
  });

  test("leaves the author's note out of word counts and every other build", () => {
    const root = project();
    chapter(root, 1, { body: "One two three.", extra: 'author-note: "Patreon readers get the next episode early."\n' });
    expect(scanProject(root).chapters[0].wordCount).toBe(3);
    for (const format of ["markdown", "html", "shunn", "narration"]) {
      const { outFile } = buildBook(root, { format });
      expect({ format, note: fs.readFileSync(outFile, "utf8").includes("Patreon") }).toEqual({ format, note: false });
    }
    buildBook(root, { format: "post" });
    expect(read(root, "01-chapter-01.html")).toContain("Patreon readers");
  });

  test("names files by chapter number, padded to the widest, then id, so they sort in reading order", () => {
    const root = project();
    chapter(root, 2, { id: "the-tide" });
    chapter(root, 10, { id: "the-bell" });
    chapter(root, 101, { id: "coda" });
    buildBook(root, { format: "post" });
    expect(posts(root)).toEqual(["002-the-tide.html", "002-the-tide.txt", "010-the-bell.html", "010-the-bell.txt", "101-coda.html", "101-coda.txt"]);
    // The width comes from every chapter, not the ones built.
    fs.rmSync(path.join(root, "dist"), { recursive: true });
    buildBook(root, { format: "post", chapter: "2" });
    expect(posts(root)).toEqual(["002-the-tide.html", "002-the-tide.txt"]);
  });

  test("prints a chapter's own author first, and refuses a chapter id that cannot name a file", () => {
    const root = project();
    chapter(root, 1, { extra: 'author: "Ann & Bo"\n' });
    buildBook(root, { format: "post" });
    expect(read(root, "01-chapter-01.html")).toBe("<p><em>by Ann &amp; Bo</em></p>\n<p>Episode 1 begins.</p>\n");
    expect(read(root, "01-chapter-01.txt")).toBe("by Ann & Bo\n\nEpisode 1 begins.\n");
    const other = project();
    chapter(other, 1, { id: "Chapter_One" });
    expect(() => buildBook(other, { format: "post" })).toThrow("chapters/Chapter_One.md: chapter ids must be kebab-case to build posts");
    expect(fs.existsSync(path.join(other, "dist"))).toBe(false);
  });

  test("builds one chapter with --chapter, or a range with --from and --to, by id or number", () => {
    const root = project();
    for (const number of [1, 2, 3, 4]) {
      chapter(root, number);
    }
    expect(buildBook(root, { format: "post", chapter: "3" })).toMatchObject({ chapters: 1, posts: 1 });
    expect(posts(root)).toEqual(["03-chapter-03.html", "03-chapter-03.txt"]);
    // A later build keeps the posts of the chapters it did not build.
    expect(buildBook(root, { format: "post", from: "chapter-01", to: 2 })).toMatchObject({ chapters: 2, posts: 2 });
    expect(posts(root)).toEqual(["01-chapter-01.html", "01-chapter-01.txt", "02-chapter-02.html", "02-chapter-02.txt", "03-chapter-03.html", "03-chapter-03.txt"]);
    buildBook(root, { format: "post", from: "4" });
    expect(posts(root)).toHaveLength(8);
    fs.rmSync(path.join(root, "dist"), { recursive: true });
    buildBook(root, { format: "post", to: "chapter-02" });
    expect(posts(root)).toEqual(["01-chapter-01.html", "01-chapter-01.txt", "02-chapter-02.html", "02-chapter-02.txt"]);
  });

  test("refuses a chapter it cannot find, a backward range, and the selection flags on other formats", () => {
    const root = project();
    chapter(root, 1);
    chapter(root, 2);
    expect(() => buildBook(root, { format: "post", chapter: "chapter-09" })).toThrow("--chapter chapter-09 is not a chapter in this project");
    expect(() => buildBook(root, { format: "post", from: "2", to: "1" })).toThrow("--from 2 comes after --to 1: give the earlier chapter first");
    expect(() => buildBook(root, { format: "post", chapter: "1", to: "2" })).toThrow("--chapter builds one chapter");
    expect(() => buildBook(root, { format: "html", chapter: "1" })).toThrow("--chapter applies only to --format post");
    expect(() => buildBook(root, { format: "epub", from: "1" })).toThrow("--from applies only to --format post");
    expect(() => buildBook(root, { format: "post", includePending: true })).toThrow("--include-pending applies only to builds that print matter pages");
    const cli = invoke(root, ["build", "--format", "markdown", "--to", "2"]);
    expect(cli.code).toBe(2);
    expect(cli.err).toContain("--to applies only to --format post");
    expect(fs.existsSync(path.join(root, "dist"))).toBe(false);
  });

  test("a full rebuild removes the posts it wrote for a renamed or renumbered chapter, and nothing else", () => {
    const root = project();
    chapter(root, 1);
    chapter(root, 2);
    buildBook(root, { format: "post" });
    expect(manifest(root)).toEqual({ generator: "story build --format post", files: ["01-chapter-01.html", "01-chapter-01.txt", "02-chapter-02.html", "02-chapter-02.txt"] });
    // Files the build did not write stay, whatever their names.
    for (const name of [".DS_Store", "2024-taxes.txt", "07-reader-notes.html"]) {
      fs.writeFileSync(path.join(root, "dist", "posts", name), "mine\n", "utf8");
    }
    fs.renameSync(path.join(root, "chapters", "chapter-02.md"), path.join(root, "chapters", "the-tide.md"));
    // A build of some chapters removes nothing.
    expect(buildBook(root, { format: "post", chapter: "1" }).removed).toBe(0);
    expect(posts(root)).toEqual([".DS_Store", "01-chapter-01.html", "01-chapter-01.txt", "02-chapter-02.html", "02-chapter-02.txt", "07-reader-notes.html", "2024-taxes.txt"]);
    const full = invoke(root, ["build", "--format", "post"]);
    expect(full.out).toBe(`Built 2 posts (HTML and text) to ${path.join(root, "dist", "posts")}, and removed 2 stale files\n`);
    expect(posts(root)).toEqual([".DS_Store", "01-chapter-01.html", "01-chapter-01.txt", "02-the-tide.html", "02-the-tide.txt", "07-reader-notes.html", "2024-taxes.txt"]);
    // A renumbering that widens the numbers renames every post, and only a
    // full build clears the old names.
    writeMarkdown(path.join(root, "chapters", "the-tide.md"), 'title: "Part 2"\nnumber: 100\nstatus: draft\n', "## Chapter Text\n\nEpisode 2 begins.\n");
    buildBook(root, { format: "post", chapter: "100" });
    expect(posts(root)).toContain("02-the-tide.html");
    expect(posts(root)).toContain("100-the-tide.html");
    expect(buildBook(root, { format: "post" }).removed).toBe(4);
    expect(posts(root)).toEqual([".DS_Store", "001-chapter-01.html", "001-chapter-01.txt", "07-reader-notes.html", "100-the-tide.html", "100-the-tide.txt", "2024-taxes.txt"]);
    expect(read(root, "2024-taxes.txt")).toBe("mine\n");
  });

  test("refuses a folder with files and no manifest, and writes to the folder --out names", () => {
    const root = project();
    chapter(root, 1);
    fs.mkdirSync(path.join(root, "site"));
    fs.writeFileSync(path.join(root, "site", "01-intro.html"), "<p>mine</p>\n", "utf8");
    expect(() => buildBook(root, { format: "post", out: "site" })).toThrow("Refusing to write the posts into site: it holds other files. Use a new or empty folder, such as dist/posts");
    expect(read(root, "01-intro.html", "site")).toBe("<p>mine</p>\n");
    // A manifest some other tool wrote does not count.
    fs.writeFileSync(path.join(root, "site", ".story-posts.json"), '{"files":["01-intro.html"]}', "utf8");
    expect(() => buildBook(root, { format: "post", out: "site" })).toThrow("it holds other files");
    expect(() => buildBook(root, { format: "post", out: "." })).toThrow("Refusing to write the posts to .: it holds the project");
    fs.mkdirSync(path.join(root, "dist"));
    fs.writeFileSync(path.join(root, "dist", "book.md"), "", "utf8");
    expect(() => buildBook(root, { format: "post", out: "dist/book.md" })).toThrow("--out dist/book.md is not a folder: give a folder for --format post");
    expect(() => buildBook(root, { format: "post", out: "chapters" })).toThrow("it is project source");
    expect(buildBook(root, { format: "post", out: "release/episodes" }).outFile).toBe(path.join(root, "release", "episodes"));
    expect(posts(root, path.join("release", "episodes"))).toEqual(["01-chapter-01.html", "01-chapter-01.txt"]);
  });

  test("writes into a folder of hidden files, and a build stopped partway leaves a folder it still owns", () => {
    const root = project();
    chapter(root, 1);
    chapter(root, 2);
    const folder = path.join(root, "dist", "posts");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, ".gitkeep"), "", "utf8");
    buildBook(root, { format: "post", chapter: "1" });
    expect(posts(root)).toEqual([".gitkeep", "01-chapter-01.html", "01-chapter-01.txt"]);
    // A manifest naming posts not yet written, as a stopped build leaves it.
    fs.writeFileSync(path.join(folder, ".story-posts.json"), JSON.stringify({ generator: "story build --format post", files: ["01-chapter-01.html", "01-chapter-01.txt", "02-old-name.html"] }), "utf8");
    fs.writeFileSync(path.join(folder, "02-old-name.html"), "<p>old</p>\n", "utf8");
    expect(buildBook(root, { format: "post" }).removed).toBe(1);
    expect(posts(root)).toEqual([".gitkeep", "01-chapter-01.html", "01-chapter-01.txt", "02-chapter-02.html", "02-chapter-02.txt"]);
  });

  test("keeps every line and stanza break of a verse chapter", () => {
    const root = project();
    chapter(root, 1, { extra: "verse: true\n", body: "The tide goes out\nand leaves the stones;\n\nthe *gulls* come in\nto count the bones." });
    chapter(root, 2, { body: "Prose runs on\nas one line." });
    buildBook(root, { format: "post" });
    expect(read(root, "01-chapter-01.html")).toBe("<p>The tide goes out<br>and leaves the stones;</p>\n<p>the <em>gulls</em> come in<br>to count the bones.</p>\n");
    expect(read(root, "01-chapter-01.txt")).toBe("The tide goes out\nand leaves the stones;\n\nthe gulls come in\nto count the bones.\n");
    // A prose chapter still joins its soft line breaks.
    expect(read(root, "02-chapter-02.txt")).toBe("Prose runs on as one line.\n");
  });

  test("refuses an --out under project source, even a folder that does not exist yet, and an invalid build-style", () => {
    const root = project();
    chapter(root, 1);
    expect(() => buildBook(root, { format: "post", out: "chapters/posts" })).toThrow("Refusing to write generated output to chapters/posts: it is project source");
    expect(fs.existsSync(path.join(root, "chapters", "posts"))).toBe(false);
    const styled = project("build-style: invalid\n");
    chapter(styled, 1);
    expect(() => buildBook(styled, { format: "post" })).toThrow("Cannot build until story.md build-style is fixed");
    expect(fs.existsSync(path.join(styled, "dist"))).toBe(false);
  });

  test("never removes a symlink or a folder in a listed post's place, or a file the manifest names outside the folder", () => {
    const root = project();
    chapter(root, 1);
    chapter(root, 2);
    buildBook(root, { format: "post" });
    const folder = path.join(root, "dist", "posts");
    fs.writeFileSync(path.join(root, "keep.txt"), "mine\n", "utf8");
    fs.writeFileSync(path.join(folder, ".story-posts.json"), JSON.stringify({ generator: "story build --format post", files: ["01-chapter-01.html", "../../keep.txt", "02-chapter-02.html", "02-chapter-02.txt"] }), "utf8");
    fs.rmSync(path.join(folder, "02-chapter-02.html"));
    fs.mkdirSync(path.join(folder, "02-chapter-02.html"));
    fs.rmSync(path.join(root, "chapters", "chapter-02.md"));
    expect(buildBook(root, { format: "post" }).removed).toBe(1);
    expect(fs.statSync(path.join(folder, "02-chapter-02.html")).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(folder, "02-chapter-02.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "keep.txt"), "utf8")).toBe("mine\n");
  });

  test("a --dry-run lists the stale posts a full rebuild would remove, and changes nothing", () => {
    const root = project();
    chapter(root, 1);
    chapter(root, 2);
    buildBook(root, { format: "post" });
    fs.rmSync(path.join(root, "chapters", "chapter-02.md"));
    const run = invoke(root, ["build", "--format", "post", "--dry-run", "--json"]);
    expect(run.code).toBe(0);
    const changes = JSON.parse(run.out).data.changes;
    expect(changes).toContainEqual({ action: "delete", path: "dist/posts/02-chapter-02.html" });
    expect(changes).toContainEqual({ action: "delete", path: "dist/posts/02-chapter-02.txt" });
    expect(posts(root)).toEqual(["01-chapter-01.html", "01-chapter-01.txt", "02-chapter-02.html", "02-chapter-02.txt"]);
  });

  test("labels the note in the book's language and sets the text scene break from build-style", () => {
    const root = project('language: fr\nbuild-style:\n  - scene-break: "❦"\n');
    chapter(root, 1, { body: "Un.\n\n***\n\nDeux.", extra: 'author-note: "Merci."\n' });
    buildBook(root, { format: "post" });
    expect(read(root, "01-chapter-01.html")).toContain("<p><strong>Note d’auteur</strong></p>");
    expect(read(root, "01-chapter-01.txt")).toBe("Un.\n\n❦\n\nDeux.\n\n---\n\nNote d’auteur\n\nMerci.\n");
  });

  test("warns about an empty chapter it builds, and only that one", () => {
    const root = project();
    chapter(root, 1, { body: "" });
    chapter(root, 2, { body: "" });
    const result = buildBook(root, { format: "post", chapter: "2" });
    expect(result.warnings.map((finding) => [finding.code, finding.message])).toEqual([["empty-chapter", "chapters/chapter-02.md has no prose yet and is built as an empty post"]]);
    expect(read(root, "02-chapter-02.html")).toBe("");
  });

  test("--json gives the folder and the posts written, and matches the result schema", () => {
    const root = project();
    chapter(root, 1);
    chapter(root, 2);
    const run = invoke(root, ["build", "--format", "post", "--chapter", "chapter-02", "--json"]);
    expect(run.code).toBe(0);
    const envelope = JSON.parse(run.out);
    expect(envelope.data).toMatchObject({ format: "post", outFile: path.join(root, "dist", "posts"), chapters: 1, posts: 1, pages: null, events: null });
    expect(envelope.writes.sort()).toEqual([".story-posts.json", "02-chapter-02.html", "02-chapter-02.txt"].map((name) => path.join(root, "dist", "posts", name)));
    expect(validateAgainstSchema(envelope, JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8")))).toEqual([]);
    const one = invoke(root, ["build", "--format", "post", "--chapter", "1"]);
    expect(one.out).toBe(`Built 1 post (HTML and text) to ${path.join(root, "dist", "posts")}\n`);
    const text = invoke(root, ["build", "--format", "post"]);
    expect(text.out).toBe(`Built 2 posts (HTML and text) to ${path.join(root, "dist", "posts")}\n`);
  });
});

describe("chapter author-note", () => {
  test("validate asks for text", () => {
    const root = project();
    chapter(root, 1, { extra: "author-note: 1984\n" });
    chapter(root, 2, { id: "chapter-02", extra: "author-note:\n  - one\n" });
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain('chapters/chapter-01.md frontmatter field author-note must be text: quote it as author-note: "1984"');
    expect(errors).toContain("chapters/chapter-02.md frontmatter field author-note must be a scalar");
  });

  test("a comment in the note stays private, and a closing scene break does not double the note's rule", () => {
    const root = project();
    chapter(root, 1, { body: "The end.\n\n* * *", extra: 'author-note: "<!-- check the date -->More on Friday."\n' });
    buildBook(root, { format: "post" });
    expect(read(root, "01-chapter-01.html")).toBe("<p>The end.</p>\n<hr>\n<p><strong>Author's note</strong></p>\n<p>More on Friday.</p>\n");
    expect(read(root, "01-chapter-01.txt")).toBe("The end.\n\n---\n\nAuthor's note\n\nMore on Friday.\n");
  });

  test("validate warns about a comment in the note that never closes", () => {
    const root = project();
    chapter(root, 1, { extra: 'author-note: "<!-- ask about the date\\nMore on Friday."\n' });
    const warnings = validateProject(root).warnings.filter((finding) => finding.code === "unclosed-comment");
    expect(messages(warnings)).toEqual(["chapters/chapter-01.md author-note opens an HTML comment (<!--) that never closes, so the text after it shows in build --format post"]);
  });

  test("cli-defaults cannot set the chapters a build posts", () => {
    const root = project("cli-defaults:\n  - command: build\n    format: post\n    chapter: 1\n");
    chapter(root, 1);
    expect(messages(validateProject(root).errors)).toContain("story.md cli-defaults[0] sets chapter, which names one target and cannot be a default");
    const run = invoke(root, ["build", "--format", "markdown"]);
    expect(run.code).toBe(3);
    expect(run.err).toContain("sets chapter, which names one target and cannot be a default");
  });

  test("a text note is valid", () => {
    const root = project();
    chapter(root, 1, { extra: "author-note: |\n  Thanks for reading.\n\n  More on Friday.\n" });
    expect(messages(validateProject(root).errors)).toEqual([]);
    buildBook(root, { format: "post" });
    expect(read(root, "01-chapter-01.txt")).toBe("Episode 1 begins.\n\n---\n\nAuthor's note\n\nThanks for reading.\n\nMore on Friday.\n");
  });
});

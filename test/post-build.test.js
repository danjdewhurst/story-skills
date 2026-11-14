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
> It said: come home.

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

const posts = (root, folder = path.join("dist", "posts")) => fs.readdirSync(path.join(root, folder)).sort();
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
<p>It said: come home.</p>
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

    It said: come home.

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

  test("a rebuild removes the posts of a renamed or renumbered chapter, and keeps hidden files", () => {
    const root = project();
    chapter(root, 1);
    chapter(root, 2);
    buildBook(root, { format: "post" });
    fs.writeFileSync(path.join(root, "dist", "posts", ".DS_Store"), "", "utf8");
    fs.renameSync(path.join(root, "chapters", "chapter-02.md"), path.join(root, "chapters", "the-tide.md"));
    // Building chapter 1 alone still clears the renamed chapter's old posts.
    buildBook(root, { format: "post", chapter: "1" });
    expect(posts(root)).toEqual([".DS_Store", "01-chapter-01.html", "01-chapter-01.txt"]);
    buildBook(root, { format: "post" });
    expect(posts(root)).toEqual([".DS_Store", "01-chapter-01.html", "01-chapter-01.txt", "02-the-tide.html", "02-the-tide.txt"]);
  });

  test("refuses a folder that holds anything but posts, and writes to the folder --out names", () => {
    const root = project();
    chapter(root, 1);
    fs.mkdirSync(path.join(root, "site"));
    fs.writeFileSync(path.join(root, "site", "index.html"), "<p>mine</p>\n", "utf8");
    expect(() => buildBook(root, { format: "post", out: "site" })).toThrow("Refusing to write the posts into site: it holds other files. Use a new or empty folder, such as dist/posts");
    expect(read(root, "index.html", "site")).toBe("<p>mine</p>\n");
    expect(() => buildBook(root, { format: "post", out: "." })).toThrow("Refusing to write the posts to .: it holds the project");
    expect(buildBook(root, { format: "post", out: "release/episodes" }).outFile).toBe(path.join(root, "release", "episodes"));
    expect(posts(root, path.join("release", "episodes"))).toEqual(["01-chapter-01.html", "01-chapter-01.txt"]);
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
    expect(envelope.writes.sort()).toEqual([path.join(root, "dist", "posts", "02-chapter-02.html"), path.join(root, "dist", "posts", "02-chapter-02.txt")]);
    expect(validateAgainstSchema(envelope, JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8")))).toEqual([]);
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

  test("a text note is valid", () => {
    const root = project();
    chapter(root, 1, { extra: "author-note: |\n  Thanks for reading.\n\n  More on Friday.\n" });
    expect(messages(validateProject(root).errors)).toEqual([]);
    buildBook(root, { format: "post" });
    expect(read(root, "01-chapter-01.txt")).toBe("Episode 1 begins.\n\n---\n\nAuthor's note\n\nThanks for reading.\n\nMore on Friday.\n");
  });
});

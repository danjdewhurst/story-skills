import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { checkProjectSchema } from "../scripts/check-schema.js";
import { runCli } from "../src/cli.js";
import { buildBook, createEntity, createStoryProject, exportManuscript, removeEntity, renameEntity, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function matterProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Matter Story", force: false });
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: Opening
number: 1
status: draft
word-count: 2
`, "## Chapter Text\n\nChapter prose.\n");
  return { root, cwd };
}

function writeMatter(root, id, frontmatter, body) {
  writeMarkdown(path.join(root, "matter", `${id}.md`), frontmatter, body);
}

function setStoryFields(root, lines) {
  const storyPath = path.join(root, "story.md");
  const raw = fs.readFileSync(storyPath, "utf8");
  fs.writeFileSync(storyPath, raw.replace("tense: past\n", `tense: past\n${lines}\n`), "utf8");
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function withBookMatter(root) {
  writeMatter(root, "dedication", "title: Dedication\nplacement: front\norder: 1\nheading: false", "# Dedication\n\nFor the lamplighters.\n");
  writeMatter(root, "epigraph", "title: Epigraph\nplacement: front\norder: 2\nheading: false", "> The sea keeps what it takes.\n");
  writeMatter(root, "author-note", "title: Author's Note\nplacement: back\norder: 2", "# Author's Note\n\nThe harbor is invented.\n");
  writeMatter(root, "acknowledgments", "title: Acknowledgments\nplacement: back\norder: 1", "Thanks to *everyone*.\n");
  writeMatter(root, "unwritten", "title: Unwritten\nplacement: back\norder: 3", "# Unwritten\n\n");
}

describe("story add matter", () => {
  test("defaults to front placement and numbers order within each placement", () => {
    const { root } = matterProject();
    const dedication = createEntity(root, { kind: "matter", name: "Dedication" });
    createEntity(root, { kind: "matter", name: "Epigraph" });
    createEntity(root, { kind: "matter", name: "Acknowledgments", placement: "back" });
    createEntity(root, { kind: "matter", name: "About the Author", placement: "back", order: "7" });

    expect(dedication.file).toBe(path.join(root, "matter", "dedication.md"));
    const read = (id) => fs.readFileSync(path.join(root, "matter", `${id}.md`), "utf8");
    expect(read("dedication")).toBe("---\ntitle: Dedication\nplacement: front\norder: 1\nheading: true\n---\n\n# Dedication\n\n");
    expect(read("epigraph")).toContain("order: 2");
    expect(read("acknowledgments")).toContain("placement: back\norder: 1");
    expect(read("about-the-author")).toContain("order: 7");
  });

  test("rejects an unknown placement or a bad order", () => {
    const { root } = matterProject();
    expect(() => createEntity(root, { kind: "matter", name: "X", placement: "middle" })).toThrow('Unsupported matter placement "middle": expected one of front, back');
    expect(() => createEntity(root, { kind: "matter", name: "X", order: "-1" })).toThrow("matter order must be a non-negative integer, got -1");
    expect(() => createEntity(root, { kind: "matter", name: "X", order: "1.5" })).toThrow("non-negative integer");
  });

  test("rename and remove work on matter files", () => {
    const { root } = matterProject();
    createEntity(root, { kind: "matter", name: "Afterword", placement: "back" });
    const renamed = renameEntity(root, { kind: "matter", id: "afterword", name: "Author's Note" });
    expect(renamed.id).toBe("authors-note");
    expect(fs.readFileSync(renamed.file, "utf8")).toContain("title: \"Author's Note\"");

    removeEntity(root, { kind: "matter", id: "authors-note" });
    expect(fs.existsSync(renamed.file)).toBe(false);
  });

  test("the CLI accepts --placement and --order", () => {
    const { root, cwd } = matterProject();
    const result = invoke(cwd, ["add", "matter", "Also By", "--placement", "back", "--order", "3", "--path", root]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("Created matter also-by");
    expect(fs.readFileSync(path.join(root, "matter", "also-by.md"), "utf8")).toContain("placement: back\norder: 3");
    expect(invoke(cwd, ["--help"]).out).toContain("--placement <front|back>");
  });
});

describe("matter validation", () => {
  test("accepts well-formed matter and warns about unwritten matter", () => {
    const { root } = matterProject();
    withBookMatter(root);
    const result = validateProject(root);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain("matter/unwritten.md has no text and is left out of export and build");
    expect(checkProjectSchema(root)).toEqual([]);
  });

  test("reports missing fields, bad values, and nested files", () => {
    const { root } = matterProject();
    writeMatter(root, "broken", "order: -2\nheading: sometimes\nplacement: middle", "Text.\n");
    writeMatter(root, "untitled", "placement: front", "Text.\n");
    writeMarkdown(path.join(root, "matter", "drafts", "old.md"), "title: Old\nplacement: front", "Old.\n");
    const { errors, warnings } = validateProject(root);

    expect(errors).toContain("matter/broken.md is missing frontmatter field title");
    expect(errors).toContain("matter/broken.md frontmatter field placement has unsupported value middle");
    expect(errors.join("\n")).toContain("matter/broken.md frontmatter field order");
    expect(errors).toContain("matter/broken.md heading must be true or false");
    expect(errors).toContain("matter/untitled.md is missing frontmatter field title");
    expect(warnings).toContain("matter/drafts/old.md is nested inside an entity directory and is ignored");
  });

  test("validates the story.md cover path", () => {
    const { root } = matterProject();
    const coverErrors = () => validateProject(root).errors.filter((error) => error.includes("cover"));

    setStoryFields(root, "cover: art/cover.png");
    expect(coverErrors()).toEqual(["story.md cover art/cover.png does not exist"]);

    fs.mkdirSync(path.join(root, "art"));
    fs.writeFileSync(path.join(root, "art", "cover.png"), PNG_BYTES);
    expect(coverErrors()).toEqual([]);
    expect(checkProjectSchema(root)).toEqual([]);

    const storyPath = path.join(root, "story.md");
    const replaceCover = (value) => fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^cover:.*$/m, value), "utf8");
    replaceCover("cover: art/cover.tiff");
    expect(coverErrors()).toEqual(["story.md cover art/cover.tiff must be a .gif, .jpeg, .jpg, .png, .webp image"]);
    replaceCover("cover: ../outside.png");
    expect(coverErrors()).toEqual(["story.md cover ../outside.png must be inside the project"]);
    replaceCover("cover:\n  - a.png");
    expect(coverErrors()).toEqual(["story.md cover must be a path to an image file"]);
  });
});

describe("matter in export and build", () => {
  test("export places front matter before chapters and back matter after, in order", () => {
    const { root } = matterProject();
    withBookMatter(root);
    const { outFile } = exportManuscript(root);
    const text = fs.readFileSync(outFile, "utf8");

    expect(text).toContain("<!-- Generated by story export. -->\n\nFor the lamplighters.\n\n> The sea keeps what it takes.\n\n# Chapter 1: Opening\n\nChapter prose.\n\n# Acknowledgments\n\nThanks to *everyone*.\n\n# Author's Note\n\nThe harbor is invented.\n");
    expect(text).not.toContain("# Dedication");
    expect(text).not.toContain("Unwritten");
  });

  test("markdown build includes matter too", () => {
    const { root } = matterProject();
    withBookMatter(root);
    const text = fs.readFileSync(buildBook(root).outFile, "utf8");
    expect(text).toContain("For the lamplighters.");
    expect(text).toContain("# Author's Note");
  });

  test("docx places matter around the chapters", () => {
    const { root } = matterProject();
    withBookMatter(root);
    const docx = fs.readFileSync(buildBook(root, { format: "docx" }).outFile).toString("utf8");
    const order = ["For the lamplighters.", "Chapter 1: Opening", "Acknowledgments", "The harbor is invented."].map((text) => docx.indexOf(text));

    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(docx).not.toContain(">Dedication<");
  });

  test("epub adds matter documents, the cover image, and the author", () => {
    const { root } = matterProject();
    withBookMatter(root);
    fs.writeFileSync(path.join(root, "cover.PNG"), PNG_BYTES);
    setStoryFields(root, "cover: cover.PNG\nauthor: Ada Writer");
    const epub = fs.readFileSync(buildBook(root, { format: "epub" }).outFile);
    const text = epub.toString("latin1");

    expect(text).toContain("<dc:creator>Ada Writer</dc:creator>");
    expect(text).toContain('<meta name="cover" content="cover-image"/>');
    expect(text).toContain('<item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>');
    expect(text).toContain('<spine><itemref idref="cover"/><itemref idref="front-dedication"/><itemref idref="front-epigraph"/><itemref idref="chapter-01"/><itemref idref="back-acknowledgments"/><itemref idref="back-author-note"/></spine>');
    expect(text).toContain('<li><a href="front-dedication.xhtml">Dedication</a></li>');
    expect(text).toContain(`<li><a href="back-author-note.xhtml">Author's Note</a></li>`);
    expect(text).toContain("<body><p>For the lamplighters.</p></body>");
    expect(text).toContain("<body><p>The sea keeps what it takes.</p></body>");
    expect(text).toContain("<body><h1>Acknowledgments</h1><p>Thanks to <em>everyone</em>.</p></body>");
    expect(text).toContain('<img src="images/cover.png" alt="Cover of Matter Story"/>');
    expect(text).toContain("OEBPS/images/cover.png");
    expect(epub.includes(PNG_BYTES)).toBe(true);
    expect(text).not.toContain("back-unwritten");
  });

  test("jpeg covers are stored as cover.jpg", () => {
    const { root } = matterProject();
    fs.writeFileSync(path.join(root, "cover.jpeg"), Buffer.from([0xff, 0xd8, 0xff]));
    setStoryFields(root, "cover: cover.jpeg");
    const text = fs.readFileSync(buildBook(root, { format: "epub" }).outFile).toString("latin1");
    expect(text).toContain('href="images/cover.jpg" media-type="image/jpeg"');
  });

  test("epub without cover or author has neither", () => {
    const { root } = matterProject();
    const text = fs.readFileSync(buildBook(root, { format: "epub" }).outFile).toString("utf8");
    expect(text).not.toContain("cover");
    expect(text).not.toContain("dc:creator");
  });

  test("an epub build fails when the cover is missing", () => {
    const { root } = matterProject();
    setStoryFields(root, "cover: gone.png");
    expect(() => buildBook(root, { format: "epub" })).toThrow("story.md cover gone.png does not exist");
    expect(buildBook(root, { format: "docx" }).format).toBe("docx");
  });

  test("shunn manuscripts leave matter out", () => {
    const { root } = matterProject();
    withBookMatter(root);
    const text = fs.readFileSync(buildBook(root, { format: "shunn" }).outFile, "utf8");
    expect(text).not.toContain("lamplighters");
    expect(text).not.toContain("Acknowledgments");
  });
});

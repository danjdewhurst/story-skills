import { describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { checkProjectSchema } from "../scripts/check-schema.js";
import { runCli } from "../src/cli.js";
import { buildBook, compareProject, createEntity, createStoryProject, exportManuscript, removeEntity, renameEntity, validateProject } from "../src/story.js";
import { CHMOD_IGNORED, makeTempDir, memoryIo, readArchiveEntries, readArchiveText, writeMarkdown, messages } from "./helpers.js";

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

  test("reindex keeps matter/_index.md current and validate checks it", () => {
    const { root } = matterProject();
    createEntity(root, { kind: "matter", name: "Dedication" });
    createEntity(root, { kind: "matter", name: "Acknowledgments", placement: "back" });
    const indexPath = path.join(root, "matter", "_index.md");
    const index = fs.readFileSync(indexPath, "utf8");

    expect(index).toContain("type: matter-registry\nstory: matter-story");
    expect(index).toContain("| Dedication | front | 1 | [dedication](dedication.md) |");
    expect(index).toContain("| Acknowledgments | back | 1 | [acknowledgments](acknowledgments.md) |");

    removeEntity(root, { kind: "matter", id: "dedication" });
    removeEntity(root, { kind: "matter", id: "acknowledgments" });
    expect(fs.readFileSync(indexPath, "utf8")).toContain("*No matter pages yet*");

    writeMatter(root, "stray", "title: Stray\nplacement: back", "Text.\n");
    expect(messages(validateProject(root).warnings)).toContain("matter/_index.md does not list matter/stray.md; run story reindex");
    writeMarkdown(indexPath, "type: notes\nstory: matter-story", "# Matter\n");
    expect(messages(validateProject(root).errors)).toContain("matter/_index.md type must be matter-registry");
  });

  test("builds refuse matter files whose names are not kebab-case", () => {
    const { root } = matterProject();
    writeMatter(root, "a&b", "title: Odd\nplacement: front", "Text.\n");
    expect(() => buildBook(root, { format: "epub" })).toThrow("matter/a&b.md: matter file names must be kebab-case to build");
  });

  test("builds and export refuse a written matter page with a blank title, which validate reports", () => {
    const { root, cwd } = matterProject();
    const refusal = "matter/dedication.md: a matter page needs a title to build";
    writeMatter(root, "dedication", 'title: ""\nplacement: front\nheading: false', "For the lamplighters.\n");
    expect(messages(validateProject(root).errors)).toContain("matter/dedication.md is missing frontmatter field title");
    for (const format of ["epub", "markdown", "html", "docx"]) {
      expect(() => buildBook(root, { format })).toThrow(refusal);
    }
    expect(() => exportManuscript(root)).toThrow(refusal);
    const result = invoke(cwd, ["build", root, "--format", "epub"]);
    expect(result.code).toBe(3);
    expect(result.err).toContain(refusal);
    expect(fs.existsSync(path.join(root, "dist"))).toBe(false);
    // Paragraph labels key matter by id, so compare --anchor still maps them.
    fs.cpSync(root, path.join(cwd, "old"), { recursive: true });
    expect(compareProject(root, { against: "old", cwd, anchors: ["ch01-p1"] }).anchors.map((anchor) => anchor.status)).toEqual(["unchanged"]);
    writeMatter(root, "dedication", 'title: "  "\nplacement: front', "For the lamplighters.\n");
    expect(() => buildBook(root, { format: "epub" })).toThrow(refusal);
    // An unwritten page stays out of the book, so its title cannot reach it.
    writeMatter(root, "dedication", 'title: ""\nplacement: front', "");
    expect(buildBook(root, { format: "epub" }).format).toBe("epub");
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

    expect(messages(result.errors)).toEqual([]);
    expect(messages(result.warnings)).toContain("matter/unwritten.md has no text and is left out of export and build");
    expect(checkProjectSchema(root)).toEqual([]);
  });

  test("reports missing fields, bad values, and nested files", () => {
    const { root } = matterProject();
    writeMatter(root, "broken", "order: -2\nheading: sometimes\nplacement: middle", "Text.\n");
    writeMatter(root, "untitled", "placement: front", "Text.\n");
    writeMarkdown(path.join(root, "matter", "drafts", "old.md"), "title: Old\nplacement: front", "Old.\n");
    const findings = validateProject(root);
    const errors = messages(findings.errors);
    const warnings = messages(findings.warnings);

    expect(errors).toContain("matter/broken.md is missing frontmatter field title");
    expect(errors).toContain("matter/broken.md frontmatter field placement has unsupported value middle");
    expect(errors.join("\n")).toContain("matter/broken.md frontmatter field order");
    expect(errors).toContain("matter/broken.md heading must be true or false");
    expect(errors).toContain("matter/untitled.md is missing frontmatter field title");
    expect(warnings).toContain("matter/drafts/old.md is nested inside an entity directory and is ignored");
  });

  test("validates the story.md cover path", () => {
    const { root } = matterProject();
    const coverErrors = () => messages(validateProject(root).errors).filter((error) => error.includes("cover"));

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

  test("checks that the cover holds the image its extension names", () => {
    const { root } = matterProject();
    const coverErrors = () => messages(validateProject(root).errors).filter((error) => error.includes("cover"));
    setStoryFields(root, "cover: cover.png");
    const storyPath = path.join(root, "story.md");
    const replaceCover = (value) => fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^cover:.*$/m, value), "utf8");

    // A review copy saved over the cover.
    fs.writeFileSync(path.join(root, "cover.png"), "<!DOCTYPE html>\n<html lang=\"en\"></html>\n");
    const notPng = "story.md cover cover.png does not hold a PNG image: its first bytes are not the PNG signature";
    expect(coverErrors()).toEqual([notPng]);
    expect(() => buildBook(root, { format: "epub" })).toThrow(notPng);
    fs.writeFileSync(path.join(root, "cover.png"), "");
    expect(coverErrors()).toEqual([notPng]);
    fs.writeFileSync(path.join(root, "cover.png"), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(coverErrors()).toEqual(["story.md cover cover.png holds a JPEG image, not a PNG one: rename it to end in .jpeg or .jpg"]);
    replaceCover("cover: cover.webp");
    fs.writeFileSync(path.join(root, "cover.webp"), "GIF89a");
    expect(coverErrors()).toEqual(["story.md cover cover.webp holds a GIF image, not a WebP one: rename it to end in .gif"]);
    // A RIFF file of another kind: a WAVE sound.
    fs.writeFileSync(path.join(root, "cover.webp"), Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WAVEfmt ")]));
    expect(coverErrors()).toEqual(["story.md cover cover.webp does not hold a WebP image: its first bytes are not the WebP signature"]);

    const images = {
      "cover.png": PNG_BYTES,
      "cover.JPG": Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
      "cover.jpeg": Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
      "cover.gif": Buffer.from("GIF87a"),
      "cover.webp": Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")])
    };
    for (const [name, bytes] of Object.entries(images)) {
      fs.writeFileSync(path.join(root, name), bytes);
      replaceCover(`cover: ${name}`);
      expect(coverErrors()).toEqual([]);
    }
  });

  test("a cover path with a control character is refused, named, before any file is read", () => {
    const { root, cwd } = matterProject();
    setStoryFields(root, 'cover: "a\\u0000.png"');
    const message = 'story.md cover "a\\u0000.png" must not contain control characters';
    expect(messages(validateProject(root).errors)).toContain(message);
    const result = invoke(cwd, ["build", root, "--format", "epub"]);
    expect(result.code).toBe(3);
    expect(result.err).toContain(message);
    // C0 and C1 controls, DEL, and the bidirectional marks and controls.
    const storyPath = path.join(root, "story.md");
    for (const code of ["0001", "001f", "007f", "0080", "0085", "009f", "061c", "200e", "200f", "202a", "202e", "2066", "2069"]) {
      fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^cover:.*$/m, `cover: "a\\u${code}.png"`), "utf8");
      expect(messages(validateProject(root).errors)).toContain(`story.md cover "a\\u${code}.png" must not contain control characters`);
    }
  });

  test("an unreadable cover is reported by name, in plain words", () => {
    if (CHMOD_IGNORED) {
      return;
    }
    const { root, cwd } = matterProject();
    fs.writeFileSync(path.join(root, "cover.png"), PNG_BYTES);
    setStoryFields(root, "cover: cover.png");
    fs.chmodSync(path.join(root, "cover.png"), 0o000);
    try {
      const message = "story.md cover cover.png: Cannot read: permission denied";
      expect(messages(validateProject(root).errors)).toContain(message);
      const result = invoke(cwd, ["build", root, "--format", "epub"]);
      expect(result.code).toBe(3);
      expect(result.err).toBe(`${message}\n`);
    } finally {
      fs.chmodSync(path.join(root, "cover.png"), 0o644);
    }
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
    const docx = readArchiveText(buildBook(root, { format: "docx" }).outFile);
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
    const entries = readArchiveEntries(buildBook(root, { format: "epub" }).outFile);
    const text = entries.map((entry) => `${entry.name}\n${entry.content.toString("utf8")}`).join("\n");

    expect(text).toContain("<dc:creator>Ada Writer</dc:creator>");
    expect(text).toContain('<meta name="cover" content="cover-image"/>');
    expect(text).toContain('<item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>');
    expect(text).toContain('<spine><itemref idref="cover"/><itemref idref="front-dedication"/><itemref idref="front-epigraph"/><itemref idref="chapter-01"/><itemref idref="back-acknowledgments"/><itemref idref="back-author-note"/></spine>');
    expect(text).toContain('<li><a href="front-dedication.xhtml">Dedication</a></li>');
    expect(text).toContain(`<li><a href="back-author-note.xhtml">Author's Note</a></li>`);
    expect(text).toContain('<body epub:type="frontmatter"><p>For the lamplighters.</p></body>');
    expect(text).toContain('<body epub:type="frontmatter"><blockquote><p>The sea keeps what it takes.</p></blockquote></body>');
    expect(text).toContain('<body epub:type="backmatter"><h1>Acknowledgments</h1><p>Thanks to <em>everyone</em>.</p></body>');
    expect(text).toContain('<img src="images/cover.png" alt="Cover of Matter Story"/>');
    expect(text).toContain("OEBPS/images/cover.png");
    expect(entries.find((entry) => entry.name === "OEBPS/images/cover.png").content.equals(PNG_BYTES)).toBe(true);
    expect(text).not.toContain("back-unwritten");
  });

  test("jpeg covers are stored as cover.jpg", () => {
    const { root } = matterProject();
    fs.writeFileSync(path.join(root, "cover.jpeg"), Buffer.from([0xff, 0xd8, 0xff]));
    setStoryFields(root, "cover: cover.jpeg");
    const text = readArchiveText(buildBook(root, { format: "epub" }).outFile);
    expect(text).toContain('href="images/cover.jpg" media-type="image/jpeg"');
  });

  test("epub without cover or author has neither", () => {
    const { root } = matterProject();
    const text = readArchiveText(buildBook(root, { format: "epub" }).outFile);
    expect(text).not.toContain("cover");
    expect(text).not.toContain("dc:creator");
  });

  test("--out never replaces the cover story.md names", () => {
    const { root, cwd } = matterProject();
    fs.mkdirSync(path.join(root, "art"));
    fs.writeFileSync(path.join(root, "art", "cover.png"), PNG_BYTES);
    setStoryFields(root, "cover: art/cover.png");
    const refusal = "Refusing to write generated output to art/cover.png: story.md names it as the cover. Use a path such as dist/ instead";
    expect(() => buildBook(root, { format: "html", out: "art/cover.png" })).toThrow(refusal);
    expect(() => exportManuscript(root, { out: "art/../art/cover.png" })).toThrow(refusal);
    expect(() => buildBook(root, { format: "print", out: path.join(root, "Art", "Cover.PNG") })).toThrow("story.md names it as the cover");
    const result = invoke(cwd, ["build", root, "--format", "html", "--out", "art/cover.png"]);
    expect(result.code).toBe(4);
    expect(result.err).toContain(refusal);
    expect(fs.readFileSync(path.join(root, "art", "cover.png")).equals(PNG_BYTES)).toBe(true);
    // The path is trimmed as the build trims it: a folded `cover: >` ends in a
    // line break.
    const storyPath = path.join(root, "story.md");
    const replaceCover = (value) => fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^cover:.*\n(?: {2}.*\n)*/m, `${value}\n`), "utf8");
    replaceCover("cover: >\n  art/cover.png");
    expect(validateProject(root).errors.filter((error) => error.code === "invalid-cover")).toEqual([]);
    expect(() => buildBook(root, { format: "html", out: "art/cover.png" })).toThrow(refusal);
    // story.md in another letter case than --out.
    replaceCover("cover: Art/Cover.PNG");
    expect(() => buildBook(root, { format: "html", out: "art/cover.png" })).toThrow(refusal);
    // Names a disk reads as the cover: an NTFS stream, a trailing dot, the
    // NTFS short name, and an ignorable character HFS+ leaves out.
    for (const out of ["art/cover.png::$DATA", "art/cover.png.", "ART/COVER~1.PNG", "art/cov\u200Ber.png"]) {
      expect(() => buildBook(root, { format: "html", out })).toThrow("story.md names it as the cover");
    }
    // A cover outside the project, which an absolute --out can reach.
    const outside = path.join(makeTempDir(), "cover.png");
    fs.writeFileSync(outside, PNG_BYTES);
    replaceCover(`cover: ${outside}`);
    expect(() => buildBook(root, { format: "markdown", out: outside })).toThrow("story.md names it as the cover");
    expect(fs.readFileSync(outside).equals(PNG_BYTES)).toBe(true);
    replaceCover("cover: art/cover.png");
    try {
      fs.symlinkSync(path.join(root, "art"), path.join(root, "images"));
    } catch {
      return; // Creating symlinks needs a privilege some Windows runners lack.
    }
    expect(() => buildBook(root, { format: "html", out: "images/cover.png" })).toThrow("story.md names it as the cover");
  });

  test("the --out guard never resolves the cover itself, and works without its folder's real path", () => {
    const { root, cwd } = matterProject();
    fs.mkdirSync(path.join(root, "art"));
    fs.writeFileSync(path.join(root, "art", "cover.png"), PNG_BYTES);
    setStoryFields(root, "cover: art/cover.png");
    // macOS resolves a path by opening it, so its realpath fails on a cover
    // this user cannot read; the guard must not stop the build there.
    const realpath = fs.realpathSync.native;
    let refused = (target) => path.basename(String(target)) === "cover.png";
    const resolve = spyOn(fs.realpathSync, "native").mockImplementation((target, ...rest) => {
      if (refused(target)) {
        throw Object.assign(new Error(`EACCES: permission denied, realpath '${target}'`), { code: "EACCES" });
      }
      return realpath(target, ...rest);
    });
    try {
      expect(invoke(cwd, ["build", root, "--format", "epub"]).code).toBe(0);
      expect(resolve.mock.calls.filter(([target]) => refused(target))).toEqual([]);
      // A folder that cannot be resolved leaves the path as written.
      refused = (target) => path.basename(String(target)) === "art";
      expect(invoke(cwd, ["build", root, "--format", "epub"]).code).toBe(0);
      expect(invoke(cwd, ["build", root, "--format", "html", "--out", "art/cover.png"]).code).toBe(4);
      expect(fs.readFileSync(path.join(root, "art", "cover.png")).equals(PNG_BYTES)).toBe(true);
    } finally {
      resolve.mockRestore();
    }
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

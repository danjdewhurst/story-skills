import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { runCli } from "../src/cli.js";
import { crc32, wordParagraphs, writeZip } from "../src/packaging.js";
import { imageSize, proseImage, proseImageBytes } from "../src/scan-cover.js";
import { scanProject } from "../src/scan.js";
import { proseImages, wordCount } from "../src/markdown.js";
import { buildBook, createEntity, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, readArchiveEntries, writeMarkdown } from "./helpers.js";

// A real PNG of `width` by `height` pixels, so its signature and IHDR
// chunk are what a reader checks.
function png(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const PROSE = [
  "![Bo at the *sett* door](../art/page-1.png)",
  "",
  "Every night ![a small moon](/art/moon.png) Bo looked up.",
  "",
  "He waved."
].join("\n");

function project(prose = PROSE) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Bo and the Moon", force: false });
  fs.mkdirSync(path.join(root, "art"));
  fs.writeFileSync(path.join(root, "art", "page-1.png"), png(192, 96));
  fs.writeFileSync(path.join(root, "art", "moon.png"), png(20, 20));
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Night\nnumber: 1\nstatus: draft", `## Chapter Text\n\n${prose}\n`);
  return root;
}

function entries(file) {
  return new Map(readArchiveEntries(file).map((entry) => [entry.name, entry]));
}

function text(map, name) {
  return map.get(name).content.toString("utf8");
}

describe("images in builds", () => {
  test("the EPUB stores each image once, lists it in the manifest, and sets a line of images as a figure", () => {
    const root = project(`${PROSE}\n\n![Bo again](../art/page-1.png)`);
    const result = buildBook(root, { format: "epub" });
    expect(result.warnings).toEqual([]);
    const files = entries(result.outFile);
    expect(files.get("OEBPS/images/figure-1.png").content.equals(fs.readFileSync(path.join(root, "art", "page-1.png")))).toBe(true);
    expect(files.get("OEBPS/images/figure-1.png").method).toBe(0);
    expect(files.has("OEBPS/images/figure-3.png")).toBe(false);
    const chapter = text(files, "OEBPS/chapter-01.xhtml");
    expect(chapter).toContain('<figure><img src="images/figure-1.png" alt="Bo at the sett door"/></figure><p>Every night <img src="images/figure-2.png" alt="a small moon"/> Bo looked up.</p><p>He waved.</p><figure><img src="images/figure-1.png" alt="Bo again"/></figure>');
    const opf = text(files, "OEBPS/content.opf");
    expect(opf).toContain('<item id="figure-1" href="images/figure-1.png" media-type="image/png"/><item id="figure-2" href="images/figure-2.png" media-type="image/png"/>');
    expect(opf).toContain('<meta property="schema:accessMode">visual</meta>');
    expect(text(files, "OEBPS/style.css")).toContain("img { max-width: 100%; height: auto; }");
    expect(opf).toContain('<meta property="schema:accessibilityFeature">alternativeText</meta>');
    expect(opf).toContain("Text book with described images,");
  });

  test("the DOCX embeds each image as media with its size, and a figure in its own centred style", () => {
    const root = project();
    const files = entries(buildBook(root, { format: "docx" }).outFile);
    expect(files.get("word/media/image1.png").content.equals(fs.readFileSync(path.join(root, "art", "page-1.png")))).toBe(true);
    expect(text(files, "[Content_Types].xml")).toContain('<Default Extension="png" ContentType="image/png"/>');
    expect(text(files, "word/_rels/document.xml.rels")).toContain('<Relationship Id="rIdImage2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.png"/>');
    const document = text(files, "word/document.xml");
    // 192 by 96 pixels at 96 dpi: 2in by 1in.
    expect(document).toContain('<w:p><w:pPr><w:pStyle w:val="Figure"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1828800" cy="914400"/><wp:docPr id="1" name="Picture 1" descr="Bo at the sett door"/>');
    expect(document).toContain('<a:blip r:embed="rIdImage1"/>');
    expect(document).toContain('<w:r><w:t xml:space="preserve">Every night </w:t></w:r><w:r><w:drawing>');
    expect(document).toContain('xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"');
    expect(text(files, "word/styles.xml")).toContain('w:styleId="Figure"');
  });

  test("a large image is scaled to fit the page, keeping its shape", () => {
    const root = project("![Wide](../art/wide.png)");
    fs.writeFileSync(path.join(root, "art", "wide.png"), png(1920, 480));
    const document = text(entries(buildBook(root, { format: "docx" }).outFile), "word/document.xml");
    expect(document).toContain('<wp:extent cx="5486400" cy="1371600"/>');
  });

  test("the review copy and print interior set images as data URIs, and a figure takes no paragraph label", () => {
    const root = project();
    const data = `data:image/png;base64,${fs.readFileSync(path.join(root, "art", "page-1.png")).toString("base64")}`;
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain(`<figure><img src="${data}" alt="Bo at the sett door"></figure>\n<p id="ch01-p1">`);
    expect(html).toContain("ch01-p1</a>Every night <img src=\"data:image/png;base64,");
    expect(html).toContain('<p id="ch01-p2">');
    expect(html).not.toContain("ch01-p3");
    expect(html).toContain("img { max-width: 100%; height: auto; }");
    const print = fs.readFileSync(buildBook(root, { format: "print" }).outFile, "utf8");
    expect(print).toContain(`<figure><img src="${data}" alt="Bo at the sett door"></figure>\n<p class="first">Every night`);
    expect(print).toContain("figure { margin: 0.8em 0; text-align: center; break-inside: avoid; }");
  });

  test("a book without images builds as before, with no image rules", () => {
    const root = project("He waved.");
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).not.toContain("img {");
    const files = entries(buildBook(root, { format: "docx" }).outFile);
    expect([...files.keys()].some((name) => name.startsWith("word/media/"))).toBe(false);
    expect(text(files, "word/styles.xml")).not.toContain("Figure");
    expect(text(files, "word/document.xml")).not.toContain("xmlns:wp");
  });

  test("the Shunn builds, the narration script, and word counts leave images out, and the markdown build keeps them as written", () => {
    const root = project();
    const shunn = fs.readFileSync(buildBook(root, { format: "shunn" }).outFile, "utf8");
    expect(shunn).toContain("Every night Bo looked up.\n\nHe waved.");
    expect(shunn).not.toContain("sett");
    const narration = fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8");
    expect(narration).toContain("Bo looked up.");
    expect(narration).not.toContain("png");
    const shunnDocx = text(entries(buildBook(root, { format: "docx", shunn: true }).outFile), "word/document.xml");
    expect(shunnDocx).not.toContain("w:drawing");
    expect(fs.readFileSync(buildBook(root, { format: "markdown" }).outFile, "utf8")).toContain("![Bo at the *sett* door](../art/page-1.png)");
    expect(wordCount(PROSE)).toBe(7);
  });

  test("an image a build cannot place is left out with a warning, and the build goes on", () => {
    const root = project([
      "![Gone](../art/gone.png)",
      "",
      "Look ![web](https://example.com/moon.png) up.",
      "",
      "![Text](../chapters/chapter-01.md)"
    ].join("\n"));
    const result = buildBook(root, { format: "epub" });
    expect(result.warnings.map((warning) => [warning.code, warning.message])).toEqual([
      ["image-left-out", "chapters/chapter-01.md image ../art/gone.png does not exist, so it is left out"],
      ["image-left-out", "chapters/chapter-01.md image https://example.com/moon.png is a web address, which builds do not fetch, so it is left out"],
      ["image-left-out", "chapters/chapter-01.md image ../chapters/chapter-01.md must be a .gif, .jpeg, .jpg, .png, .webp image, so it is left out"]
    ]);
    const files = entries(result.outFile);
    expect(text(files, "OEBPS/chapter-01.xhtml")).toContain("<h1>Chapter 1: Night</h1><p>Look up.</p></body>");
    expect([...files.keys()].some((name) => name.includes("figure"))).toBe(false);
  });

  test("images in matter pages are placed, and a typed image mark stands for nothing", () => {
    const root = project("A \uE0020\uE003 mark.");
    createEntity(root, { kind: "matter", name: "Frontispiece" });
    fs.appendFileSync(path.join(root, "matter", "frontispiece.md"), "\n![The hollow](../art/page-1.png)\n");
    const files = entries(buildBook(root, { format: "epub" }).outFile);
    expect(text(files, "OEBPS/front-frontispiece.xhtml")).toContain('<figure><img src="images/figure-1.png" alt="The hollow"/></figure>');
    expect(text(files, "OEBPS/chapter-01.xhtml")).toContain("<p>A \uFFFD0\uFFFD mark.</p>");
  });

  test("story apply reads back a build with images and changes nothing", () => {
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
    expect(result.stdout).toContain("Changed 0, added 0, and cut 0 paragraphs in 0 chapters.");
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8")).toBe(before);
  });

  test("story apply writes an edit after a figure to its own paragraph, and warns about an image the editor adds", () => {
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
    const document = sent.find((entry) => entry.name === "word/document.xml").content.toString("utf8");
    const edited = path.join(dir, "edited.docx");
    writeZip(edited, sent.map((entry) => (entry.name === "word/document.xml" ? { ...entry, content: document.replace("He waved.", "He waved twice.") } : entry)));
    const chapterPath = path.join(root, "chapters", "chapter-01.md");
    const before = fs.readFileSync(chapterPath, "utf8");
    const result = run("apply", edited, "--path", path.basename(root));
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
    expect(fs.readFileSync(chapterPath, "utf8")).toBe(before.replace("He waved.", "He waved twice."));
    // A picture the editor pastes in is more than the build set.
    const drawing = /<w:r><w:drawing>.*?<\/w:drawing><\/w:r>/s.exec(document)[0];
    const added = path.join(dir, "added.docx");
    writeZip(added, sent.map((entry) => (entry.name === "word/document.xml" ? { ...entry, content: document.replace("He waved.</w:t></w:r>", `He waved.</w:t></w:r>${drawing}`) } : entry)));
    expect(run("apply", added, "--path", path.basename(root)).stderr).toContain("has images or drawings, which story apply leaves out");
  });

  test("alt text is escaped in every format", () => {
    const root = project('![He said "hi" & <left>](../art/moon.png)');
    expect(text(entries(buildBook(root, { format: "epub" }).outFile), "OEBPS/chapter-01.xhtml")).toContain('alt="He said &quot;hi&quot; &amp; &lt;left&gt;"/>');
    expect(text(entries(buildBook(root, { format: "docx" }).outFile), "word/document.xml")).toContain('descr="He said &quot;hi&quot; &amp; &lt;left&gt;"');
    expect(fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8")).toContain('alt="He said &quot;hi&quot; &amp; &lt;left&gt;">');
  });

  test("the Word text view drops figures, so a story apply trace keeps its paragraph numbers", () => {
    expect(wordParagraphs("Before\n![Map](map.png)\nAfter").map((paragraph) => paragraph.runs.map((run) => run.text).join(""))).toEqual(["Before", "After"]);
  });
});

describe("images and footnotes in a verse chapter", () => {
  test("the builds keep each line, set the image line as a figure, and place the note", () => {
    const root = project();
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Night\nnumber: 1\nstatus: draft\nverse: true", [
      "## Chapter Text",
      "",
      "The tide comes in[^tide]",
      "and the moon goes up",
      "![The moon over the sea](../art/moon.png)",
      "and the gulls go home",
      "",
      "[^tide]: Twice a day."
    ].join("\n"));
    const data = `data:image/png;base64,${fs.readFileSync(path.join(root, "art", "moon.png")).toString("base64")}`;
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain('ch01-p1</a>The tide comes in<sup class="noteref"><a href="#ch01-fn1" id="ch01-fnref1" role="doc-noteref">1</a></sup><br>and the moon goes up</p>');
    expect(html).toContain(`<figure><img src="${data}" alt="The moon over the sea"></figure>`);
    expect(html).toContain('ch01-p2</a>and the gulls go home</p>');
    expect(html).toContain('<div class="footnote" id="ch01-fn1" role="doc-footnote"><p><a href="#ch01-fnref1" role="doc-backlink">1.</a> Twice a day.</p></div>');
    const epub = entries(buildBook(root, { format: "epub" }).outFile);
    expect(text(epub, "OEBPS/chapter-01.xhtml")).toContain('<p>The tide comes in<a epub:type="noteref" role="doc-noteref" id="noteref-1" href="#note-1"><sup>1</sup></a><br/>and the moon goes up</p><figure><img src="images/figure-1.png" alt="The moon over the sea"/></figure><p>and the gulls go home</p><aside epub:type="footnote" role="doc-footnote" id="note-1"><p><a role="doc-backlink" href="#noteref-1">1.</a> Twice a day.</p></aside>');
    const docx = entries(buildBook(root, { format: "docx" }).outFile);
    expect(text(docx, "word/document.xml")).toContain('<w:footnoteReference w:id="1"/></w:r><w:r><w:t xml:space="preserve"></w:t><w:br/><w:t xml:space="preserve">and the moon goes up</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Figure"/></w:pPr>');
    expect(text(docx, "word/footnotes.xml")).toContain("Twice a day.");
    // The note is no line of the poem.
    expect(scanProject(root).chapters[0].lineCount).toBe(3);
  });
});

describe("image checks", () => {
  test("validate warns about an image that is missing, outside the project, a symlink, or not the image its name says, once per image", () => {
    const root = project([
      "![a](../art/page-1.png)",
      "![b](../art/missing.png)",
      "![c](../../outside.png)",
      "![d](../art/link.png)",
      "![e](../art/fake.jpg)",
      "![f](../art/notes.txt)",
      "![g](https://example.com/g.png)",
      "![h](data:image/png;base64,AAAA)",
      "![i](chapter-01.md/x.png)",
      "`![code](nowhere.png)`",
      "![again](../art/missing.png)"
    ].join("\n\n"));
    fs.symlinkSync(path.join(root, "art", "page-1.png"), path.join(root, "art", "link.png"));
    fs.writeFileSync(path.join(root, "art", "fake.jpg"), png(4, 4));
    fs.writeFileSync(path.join(root, "art", "notes.txt"), "text");
    const result = validateProject(root);
    const imageErrors = result.warnings.filter((warning) => warning.code === "invalid-image").map((warning) => warning.message.replace(/, so builds leave it out$/, ""));
    expect(imageErrors).toEqual([
      "chapters/chapter-01.md image ../art/missing.png does not exist (lines 10, 28)",
      "chapters/chapter-01.md image ../../outside.png must be inside the project (line 12)",
      "chapters/chapter-01.md image ../art/link.png: Refusing to read through symlink (line 14)",
      "chapters/chapter-01.md image ../art/fake.jpg holds a PNG image, not a JPEG one: rename it to end in .png (line 16)",
      "chapters/chapter-01.md image ../art/notes.txt must be a .gif, .jpeg, .jpg, .png, .webp image (line 18)",
      "chapters/chapter-01.md image data:image/png;base64,AAAA must be a file inside the project, not a URL (line 22)",
      // A path through a file names no absolute path, whatever the system says.
      expect.stringMatching(/^chapters\/chapter-01\.md image chapter-01\.md\/x\.png(?:: Cannot read: a part of the path is not a folder| does not exist) \(line 24\)$/)
    ]);
    expect(result.warnings.filter((warning) => warning.code === "remote-image").map((warning) => warning.message)).toEqual([
      "chapters/chapter-01.md image https://example.com/g.png (line 20) is a web address, which builds do not fetch, so it is left out: save the image in the project and name its path"
    ]);
  });

  test("validate checks matter images, reads %-escapes, and a path from the project root", () => {
    const root = project("![a](/art/page%201.png)\n\n![b](../art/moon.png?raw=true)\n\n![c](//cdn.example.com/x.png)\n\nA.[^1]\n\n[^1]: ![d](../art/gone.png)");
    fs.writeFileSync(path.join(root, "art", "page 1.png"), png(4, 4));
    createEntity(root, { kind: "matter", name: "Plates" });
    fs.appendFileSync(path.join(root, "matter", "plates.md"), "\n![b](art/page-1.png)\n");
    const warnings = validateProject(root).warnings.filter((warning) => warning.code === "invalid-image");
    // A query is left off, an image in a footnote is no image to check,
    // and an address with no scheme is a web address.
    expect(warnings.map((warning) => [warning.file, warning.message.replace(/ \(line \d+\), so builds leave it out$/, "")])).toEqual([
      ["matter/plates.md", "matter/plates.md image art/page-1.png does not exist"]
    ]);
    expect(validateProject(root).warnings.filter((warning) => warning.message.includes("footnote")).map((warning) => [warning.code, warning.message])).toEqual([
      ["image-left-out", "chapters/chapter-01.md image ../art/gone.png (line 16) is in footnote [^1], which builds set as text only, so it is left out"]
    ]);
    expect(validateProject(root).warnings.filter((warning) => warning.code === "remote-image").map((warning) => warning.message)).toEqual([
      expect.stringContaining("image //cdn.example.com/x.png (line 12) is a web address")
    ]);
  });

  test("proseImages finds images outside code, with their alt text and destination as written", () => {
    expect(proseImages("![a *b*](<my file.png> \"Title\") `![c](d.png)` [![e](f\\(g.png)](link)\n\n```\n![h](i.png)\n```\n")).toEqual([
      { alt: "a *b*", destination: "my file.png" },
      { alt: "e", destination: "f(g.png" }
    ]);
  });

  test("validate warns about an image path that is empty, holds a control character, or names a folder", () => {
    const root = project("![a](?raw=true)\n\n![b](../art/x%00.png)\n\n![c](../art/folder.png)");
    fs.mkdirSync(path.join(root, "art", "folder.png"));
    expect(validateProject(root).warnings.filter((warning) => warning.code === "invalid-image").map((warning) => warning.message)).toEqual([
      "chapters/chapter-01.md image ?raw=true names no file (line 8), so builds leave it out",
      "chapters/chapter-01.md image ../art/x%00.png must not contain control characters (line 10), so builds leave it out",
      "chapters/chapter-01.md image ../art/folder.png is not a file (line 12), so builds leave it out"
    ]);
  });

  test("a build refuses an image that changed or went after its check, naming no absolute path", () => {
    const root = project("![a](../art/moon.png)");
    const image = proseImage(scanProject(root), "chapters/chapter-01.md", "../art/moon.png");
    expect(proseImageBytes(image).equals(fs.readFileSync(path.join(root, "art", "moon.png")))).toBe(true);
    fs.writeFileSync(path.join(root, "art", "moon.png"), "<!DOCTYPE html>\n");
    expect(() => proseImageBytes(image)).toThrow("chapters/chapter-01.md image ../art/moon.png changed while the build read it: build again");
    fs.rmSync(path.join(root, "art", "moon.png"));
    let message = "";
    try {
      proseImageBytes(image);
    } catch (error) {
      message = error.message;
    }
    expect(message).toStartWith("chapters/chapter-01.md image ../art/moon.png changed while the build read it: ");
    expect(message).not.toContain(root);
  });

  test("a page build leaves out an image whose uses would pass its size limit", () => {
    // Eight uses of a 50 MiB image (sparse, so it takes no disk) are 400
    // MiB, past the 360 MiB a page sets; an archive would store it once.
    const root = project(Array.from({ length: 8 }, () => "![Big](../art/big.png)").join("\n\n"));
    fs.writeFileSync(path.join(root, "art", "big.png"), png(1, 1));
    fs.truncateSync(path.join(root, "art", "big.png"), 50 * 1024 * 1024);
    const result = buildBook(root, { format: "html" });
    expect(result.warnings.filter((warning) => warning.code === "image-left-out").map((warning) => warning.message)).toEqual(["chapters/chapter-01.md image ../art/big.png would take this build's images past 360 MiB, so it is left out"]);
    expect(fs.readFileSync(result.outFile, "utf8")).not.toContain("<img");
  });

  test("a ZIP that would pass its size limit is refused", () => {
    const out = path.join(makeTempDir(), "big.zip");
    expect(() => writeZip(out, [{ name: "a.bin", content: Buffer.alloc(20) }], {}, 10)).toThrow("its archive would pass 4 GiB");
  });

  test("imageSize reads PNG, GIF, JPEG, and WebP headers", () => {
    expect(imageSize(png(30, 20), "image/png")).toEqual({ width: 30, height: 20 });
    const gif = Buffer.from("GIF89a\x2c\x01\xc8\x00", "latin1");
    expect(imageSize(gif, "image/gif")).toEqual({ width: 300, height: 200 });
    // SOI, an APP0 segment of 16 bytes, then SOF0: precision, height 480, width 640.
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80])]);
    expect(imageSize(jpeg, "image/jpeg")).toEqual({ width: 640, height: 480 });
    const vp8x = Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBPVP8X", "latin1"), Buffer.alloc(8), Buffer.from([0x3f, 0x01, 0x00, 0xc7, 0x00, 0x00])]);
    expect(imageSize(vp8x, "image/webp")).toEqual({ width: 320, height: 200 });
    expect(imageSize(Buffer.from("nothing"), "image/png")).toBe(null);
    // A WebP of the lossy and lossless kinds, one too short, and one of no known kind.
    const webp = (chunk, body) => Buffer.concat([Buffer.from(`RIFF\0\0\0\0WEBP${chunk}`, "latin1"), body]);
    expect(imageSize(webp("VP8 ", Buffer.concat([Buffer.alloc(10), Buffer.from([0x40, 0x01, 0xc8, 0x00])])), "image/webp")).toEqual({ width: 320, height: 200 });
    // VP8L: a signature byte, then width - 1 and height - 1 in 14 bits each.
    const bits = Buffer.alloc(4);
    bits.writeUInt32LE((319 & 0x3fff) | ((199 & 0x3fff) << 14));
    expect(imageSize(webp("VP8L", Buffer.concat([Buffer.alloc(5), bits, Buffer.alloc(5)])), "image/webp")).toEqual({ width: 320, height: 200 });
    expect(imageSize(webp("VP8 ", Buffer.alloc(2)), "image/webp")).toBe(null);
    expect(imageSize(webp("ALPH", Buffer.alloc(20)), "image/webp")).toBe(null);
    // JPEG: fill bytes and a standalone marker before the frame, a scan
    // before any frame, bytes that are no marker, and a header cut short.
    const frame = Buffer.from([0xff, 0xc2, 0x00, 0x11, 0x08, 0x00, 0x0a, 0x00, 0x14]);
    expect(imageSize(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xd0]), frame]), "image/jpeg")).toEqual({ width: 20, height: 10 });
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]), "image/jpeg")).toBe(null);
    expect(imageSize(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00]), "image/jpeg")).toBe(null);
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), "image/jpeg")).toBe(null);
    expect(imageSize(Buffer.alloc(30), "image/bmp")).toBe(null);
  });
});

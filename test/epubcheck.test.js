import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { crc32 } from "../src/packaging.js";
import { buildBook, createStoryProject } from "../src/story.js";
import { makeTempDir, readArchiveEntries, writeMarkdown } from "./helpers.js";

// Set EPUBCHECK_JAR to an epubcheck.jar (https://github.com/w3c/epubcheck)
// to check the EPUB builds against the EPUB specification, as retailers do
// before they accept a book. The epubcheck job in ci.yml downloads a pinned
// release and sets it; other runs skip these tests.
const jar = process.env.EPUBCHECK_JAR;
const examplesRoot = path.join(import.meta.dir, "..", "examples");
const EXAMPLES = fs.readdirSync(examplesRoot).filter((name) => fs.existsSync(path.join(examplesRoot, name, "story.md"))).sort();

// Each test starts a JVM, which takes a few seconds, so the tests get the
// same 60 seconds as `bun run test` however the file is run. A synchronous
// spawn cannot be cut off by a test timeout, so the spawn has its own.
const TEST_TIMEOUT = 60000;
const SPAWN_TIMEOUT = 50000;

// EPUBCheck's messages for `file` at warning level or above, one line each
// as `<severity> <ID> <path>:<line>: <message>`, so a failure names what to
// fix. --failonwarnings makes the exit status fail on a warning too, so a
// warning fails the test even if the severity names change.
function epubcheck(file) {
  const run = spawnSync("java", ["-jar", jar, file, "--json", "-", "--quiet", "--failonwarnings"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: SPAWN_TIMEOUT });
  if (run.error) {
    throw run.error;
  }
  const start = run.stdout.indexOf("{");
  if (start === -1) {
    throw new Error(`EPUBCheck wrote no report (exit ${run.status}): ${run.stderr}`);
  }
  const report = JSON.parse(run.stdout.slice(start));
  const problems = report.messages
    .filter((message) => ["FATAL", "ERROR", "WARNING"].includes(message.severity))
    .flatMap((message) => (message.locations.length > 0 ? message.locations : [{ path: "", line: -1 }]).map((location) => `${message.severity} ${message.ID} ${location.path}:${location.line}: ${message.message}`));
  return { status: run.status, problems };
}

// A real PNG of `width` by `height` pixels.
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
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.alloc((width * 3 + 1) * height))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// One-pixel images in the other three EPUB core image types.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

function chapter(root, id, frontmatter, body) {
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: ${frontmatter.title}\n${frontmatter.extra ?? ""}status: draft`, `\n## Chapter Text\n\n${body}\n`);
}

// The retail metadata a book carries when it is uploaded, which the EPUB
// writes only when story.md sets it.
const RETAIL_FIELDS = [
  "cover: art/cover.png",
  "cover-alt: A lamp on a ledger",
  "isbn: 978-0-306-40615-7",
  "publisher: Harbour Press",
  "publication-date: 2027-03-01",
  "description: A lamp keeper keeps a ledger of the tides.",
  "subjects: [Fiction, Sea stories]",
  "build-style:",
  "  - preset: modern",
  "    drop-caps: true",
  "    css: styles/book.css"
].join("\n");

// A book that uses what the examples do not: a cover, the retail metadata,
// a figure and an inline image in each image type the build takes (PNG,
// GIF, JPEG, WebP), footnotes (repeated, styled, in verse, and in back
// matter), a verse chapter, an unnumbered prologue, and a build style with
// drop caps and a stylesheet of its own.
function featureBook() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Lamp and Ledger", force: false });
  const storyPath = path.join(root, "story.md");
  const story = fs.readFileSync(storyPath, "utf8");
  if (!story.includes("tense: past\n")) {
    throw new Error("story.md from createStoryProject has no tense: past line to add the retail fields after");
  }
  fs.writeFileSync(storyPath, story.replace("tense: past\n", `tense: past\n${RETAIL_FIELDS}\n`), "utf8");
  fs.mkdirSync(path.join(root, "styles"));
  fs.writeFileSync(path.join(root, "styles", "book.css"), "figure { margin: 1em auto; }\n");
  fs.mkdirSync(path.join(root, "art"));
  fs.writeFileSync(path.join(root, "art", "cover.png"), png(160, 240));
  fs.writeFileSync(path.join(root, "art", "map.png"), png(120, 60));
  fs.writeFileSync(path.join(root, "art", "lamp.gif"), GIF);
  fs.writeFileSync(path.join(root, "art", "seal.jpg"), JPEG);
  fs.writeFileSync(path.join(root, "art", "gull.webp"), WEBP);

  writeMarkdown(path.join(root, "matter", "epigraph.md"), "title: Epigraph\nplacement: front\norder: 1\nheading: false", "\n> A ledger kept is a lamp lit.\n>\n> — *harbour saying*\n");
  writeMarkdown(path.join(root, "matter", "authors-note.md"), "title: Author's Note\nplacement: back\norder: 1", "\nThe harbour is invented.[^place] Its tides are not.\n\n[^place]: Any likeness to a real harbour is *chance*.\n");

  chapter(root, "prologue", { title: "Before", extra: "number: 1\nnumbered: false\n" }, "The ledger came first.\n\n![The harbour map](../art/map.png)\n\n![The lamp](../art/lamp.gif)");
  chapter(root, "chapter-02", { title: "The Lamp", extra: "number: 2\n" }, [
    "Mara lit the lamp ![a lamp](../art/lamp.gif) at dusk.[^dusk] The tide turned.[^tide]",
    "",
    "She wrote it down, as the harbour rule says.[^dusk]",
    "",
    "* * *",
    "",
    "![The harbour seal](/art/seal.jpg)",
    "",
    "> Lamps lit: one. Ships in: none.",
    "",
    "The ledger's marks: a map ![map mark](../art/map.png), a seal ![seal mark](/art/seal.jpg), and a gull ![gull mark](../art/gull.webp).",
    "",
    "[^dusk]: Dusk in the [harbour](https://example.com/harbour) rules is sunset plus *half an hour*.",
    "",
    "[^tide]: The ebb, that night."
  ].join("\n"));
  chapter(root, "chapter-03", { title: "Gull Song", extra: "number: 3\nverse: true\n" }, [
    "The gull goes out before the light,[^gull]",
    "  and comes back with the boats.",
    "",
    "![A gull](../art/gull.webp)",
    "",
    "No ledger holds the gull.",
    "",
    "[^gull]: A herring gull, by the ledger."
  ].join("\n"));
  return root;
}

describe.skipIf(!jar)("EPUBCheck on the EPUB builds", () => {
  test("finds the examples to check", () => {
    expect(EXAMPLES.length).toBeGreaterThan(0);
  });

  test.each(EXAMPLES)("the %s example builds a valid EPUB", (name) => {
    const out = path.join(makeTempDir(), `${name}.epub`);
    buildBook(path.join(examplesRoot, name), { format: "epub", out });
    expect(epubcheck(out)).toEqual({ status: 0, problems: [] });
  }, TEST_TIMEOUT);

  test("a book with a cover, retail metadata, images, footnotes, verse, a prologue, and a build style builds a valid EPUB", () => {
    const root = featureBook();
    const result = buildBook(root, { format: "epub" });
    expect(result.warnings).toEqual([]);
    // The book must hold what it is meant to test, or a build that left a
    // feature out would still pass EPUBCheck.
    const entries = new Map(readArchiveEntries(result.outFile).map((entry) => [entry.name, entry.content]));
    const text = (name) => {
      expect(entries.has(name)).toBe(true);
      return entries.get(name).toString("utf8");
    };
    const opf = text("OEBPS/content.opf");
    expect(entries.has("OEBPS/images/cover.png")).toBe(true);
    expect(opf).toContain('properties="cover-image"');
    expect(text("OEBPS/cover.xhtml")).toContain('alt="A lamp on a ledger"');
    for (const field of ["urn:isbn:9780306406157", "<dc:publisher>", "<dc:date>2027-03-01</dc:date>", "<dc:description>", "<dc:subject>Sea stories</dc:subject>"]) {
      expect(opf).toContain(field);
    }
    expect(opf).toContain('href="extra.css"');
    const chapters = ["chapter-01", "chapter-02", "chapter-03"].map((name) => text(`OEBPS/${name}.xhtml`));
    const documents = [...chapters, text("OEBPS/back-authors-note.xhtml")].join("\n");
    for (const extension of ["png", "gif", "jpg", "webp"]) {
      expect(documents).toMatch(new RegExp(`<figure><img src="images/figure-\\d+\\.${extension}"`));
      expect(documents).toMatch(new RegExp(`[^>]<img src="images/figure-\\d+\\.${extension}"`));
    }
    expect(documents.match(/epub:type="noteref"/g)?.length).toBe(5);
    expect(documents.match(/epub:type="footnote"/g)?.length).toBe(4);
    expect(chapters[0]).toContain("<h1>Before</h1>");
    expect(chapters[1]).toContain("Chapter 1: The Lamp");
    expect(chapters[2]).toContain("<br/>and comes back with the boats.");
    expect(epubcheck(result.outFile)).toEqual({ status: 0, problems: [] });
  }, TEST_TIMEOUT);

  test("a file that is not an EPUB fails, so the check reads EPUBCheck's verdict", () => {
    const out = path.join(makeTempDir(), "broken.epub");
    fs.writeFileSync(out, "not a zip");
    const { status, problems } = epubcheck(out);
    expect(status).not.toBe(0);
    expect(problems.length).toBeGreaterThan(0);
  }, TEST_TIMEOUT);
});

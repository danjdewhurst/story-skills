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

// EPUBCheck's messages for `file` at warning level or above, one line each
// as `<ID> <path>:<line>: <message>`, so a failure names what to fix.
function epubcheck(file) {
  const run = spawnSync("java", ["-jar", jar, file, "--json", "-", "--quiet"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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

// A book that uses what the examples do not: a cover, figures and inline
// images in every core image type, footnotes (repeated, styled, and in
// verse), an unnumbered prologue, and front and back matter with a quote.
function featureBook() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Lamp and Ledger", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("tense: past\n", "tense: past\ncover: art/cover.png\ncover-alt: A lamp on a ledger\n"), "utf8");
  fs.mkdirSync(path.join(root, "art"));
  fs.writeFileSync(path.join(root, "art", "cover.png"), png(160, 240));
  fs.writeFileSync(path.join(root, "art", "map.png"), png(120, 60));
  fs.writeFileSync(path.join(root, "art", "lamp.gif"), GIF);
  fs.writeFileSync(path.join(root, "art", "seal.jpg"), JPEG);
  fs.writeFileSync(path.join(root, "art", "gull.webp"), WEBP);

  writeMarkdown(path.join(root, "matter", "epigraph.md"), "title: Epigraph\nplacement: front\norder: 1\nheading: false", "\n> A ledger kept is a lamp lit.\n>\n> — *harbour saying*\n");
  writeMarkdown(path.join(root, "matter", "authors-note.md"), "title: Author's Note\nplacement: back\norder: 1", "\nThe harbour is invented.[^place] Its tides are not.\n\n[^place]: Any likeness to a real harbour is *chance*.\n");

  chapter(root, "prologue", { title: "Before", extra: "number: 1\nnumbered: false\n" }, "The ledger came first.\n\n![The harbour map](../art/map.png)");
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
  test.each(EXAMPLES)("the %s example builds a valid EPUB", (name) => {
    const out = path.join(makeTempDir(), `${name}.epub`);
    buildBook(path.join(examplesRoot, name), { format: "epub", out });
    expect(epubcheck(out)).toEqual({ status: 0, problems: [] });
  });

  test("a book with a cover, images, footnotes, verse, a prologue, and matter builds a valid EPUB", () => {
    const root = featureBook();
    const result = buildBook(root, { format: "epub" });
    expect(result.warnings).toEqual([]);
    // The book must hold what it is meant to test, or a build that left the
    // images or notes out would pass.
    const entries = readArchiveEntries(result.outFile);
    const names = entries.map((entry) => entry.name);
    for (const extension of ["png", "gif", "jpg", "webp"]) {
      expect(names.some((name) => name.startsWith("OEBPS/images/figure-") && name.endsWith(`.${extension}`))).toBe(true);
    }
    const documents = entries.filter((entry) => entry.name.endsWith(".xhtml")).map((entry) => entry.content.toString("utf8")).join("\n");
    expect(documents.match(/epub:type="noteref"/g)?.length).toBe(5);
    expect(documents).toContain('epub:type="footnote"');
    expect(epubcheck(result.outFile)).toEqual({ status: 0, problems: [] });
  });

  test("a file that is not an EPUB fails, so the check reads EPUBCheck's verdict", () => {
    const out = path.join(makeTempDir(), "broken.epub");
    fs.writeFileSync(out, "not a zip");
    const { status, problems } = epubcheck(out);
    expect(status).not.toBe(0);
    expect(problems.length).toBeGreaterThan(0);
  });
});

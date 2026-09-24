import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { copyrightPage, normalizeIsbn, publishingMeta } from "../src/publishing.js";
import { buildBook, createEntity, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function project(fields = "") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Harbor Lights", force: false });
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Arrival\nnumber: 1\nstatus: final", "## Chapter Text\n\nThe lamps came on.\n");
  if (fields !== "") {
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\n${fields}\n`), "utf8");
  }
  return root;
}

const FULL_METADATA = `authors:
  - Ada Writer
  - Ben Other
language: en-GB
isbn: 978-0-306-40615-7
publisher: Lamplight Press
publication-date: 2026-10-01
description: "A harbor town & its lights."
keywords:
  - lighthouse
subjects:
  - FIC022000
copyright: © 2026 Ada Writer
cover-alt: A lighthouse at dusk
ai-disclosure: No generative AI was used to write the text.`;

describe("publishing metadata", () => {
  test("normalizeIsbn accepts valid ISBN-13 and ISBN-10 and rejects bad checksums", () => {
    expect(normalizeIsbn("978-0-306-40615-7")).toBe("9780306406157");
    expect(normalizeIsbn("0-306-40615-2")).toBe("0306406152");
    expect(normalizeIsbn("0-8044-2957-x")).toBe("080442957X");
    expect(normalizeIsbn("978-0-306-40615-8")).toBe("");
    expect(normalizeIsbn("0-306-40615-3")).toBe("");
    expect(normalizeIsbn("12345")).toBe("");
    expect(normalizeIsbn(undefined)).toBe("");
  });

  test("publishingMeta defaults the language and falls back to author", () => {
    expect(publishingMeta({ author: "Solo" })).toMatchObject({ authors: ["Solo"], language: "en", isbn: "", keywords: [] });
    expect(publishingMeta({ authors: ["A", "", 3], author: "Solo" }).authors).toEqual(["A"]);
    expect(copyrightPage(publishingMeta({ copyright: "© Me" }))).toBe("© Me\n\nAll rights reserved.");
  });

  test("validate accepts full metadata and reports malformed fields", () => {
    expect(validateProject(project(FULL_METADATA)).errors).toEqual([]);

    const root = project(`language: english!
isbn: 978-0-306-40615-8
publication-date: 2026-13-01
subjects:
  - fiction
keywords:
  - a
  - b
  - c
  - d
  - e
  - f
  - g
  - h
publisher:
  - Two
authors: Solo
author: Solo`);
    const result = validateProject(root);
    expect(result.errors).toEqual(expect.arrayContaining([
      "story.md language english! must be a BCP 47 tag such as en, en-GB, or fr",
      "story.md isbn 978-0-306-40615-8 is not a valid ISBN-13 or ISBN-10 (check the digits and checksum)",
      "story.md publication-date date must be a real YYYY-MM-DD calendar day, got 2026-13-01",
      "story.md subject fiction must be a BISAC code such as FIC022000",
      "story.md frontmatter field publisher must be text",
      "story.md frontmatter field authors must be a list of text"
    ]));
    expect(result.warnings).toEqual(expect.arrayContaining([
      "story.md lists 8 keywords; most retailers accept 7",
      "story.md sets both author and authors; builds use authors"
    ]));
  });

  test("epub carries the metadata, accessibility, language, landmarks, and a generated copyright page", () => {
    const root = project(`${FULL_METADATA}\ncover: cover.png`);
    fs.writeFileSync(path.join(root, "cover.png"), PNG_BYTES);
    const text = fs.readFileSync(buildBook(root, { format: "epub" }).outFile).toString("utf8");

    expect(text).toContain('<dc:identifier id="book-id">urn:isbn:9780306406157</dc:identifier>');
    expect(text).toContain("<dc:creator>Ada Writer</dc:creator><dc:creator>Ben Other</dc:creator>");
    expect(text).toContain("<dc:language>en-GB</dc:language>");
    expect(text).toContain("<dc:publisher>Lamplight Press</dc:publisher><dc:date>2026-10-01</dc:date><dc:description>A harbor town &amp; its lights.</dc:description><dc:subject>FIC022000</dc:subject><dc:rights>© 2026 Ada Writer</dc:rights>");
    expect(text).toContain('<meta property="schema:accessModeSufficient">textual</meta>');
    expect(text).toContain('<meta property="schema:accessibilityFeature">alternativeText</meta>');
    expect(text).toContain('<meta property="schema:accessibilityHazard">none</meta>');
    expect(text).toContain('xml:lang="en-GB" lang="en-GB"');
    expect(text).toContain('<img src="images/cover.png" alt="A lighthouse at dusk"/>');
    expect(text).toContain('<nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="toc" href="nav.xhtml">Table of Contents</a></li><li><a epub:type="bodymatter" href="chapter-01.xhtml">Start of Content</a></li></ol></nav>');
    expect(text).toContain('<body epub:type="bodymatter chapter"><h1>Chapter 1: Arrival</h1>');
    expect(text).toContain('<body epub:type="frontmatter copyright-page"><p>© 2026 Ada Writer</p><p>All rights reserved.</p><p>Published by Lamplight Press</p><p>ISBN 9780306406157</p><p>No generative AI was used to write the text.</p></body>');
    expect(text).toContain('<spine><itemref idref="cover"/><itemref idref="front-copyright"/><itemref idref="chapter-01"/></spine>');
  });

  test("an existing copyright matter page wins, and plain books keep the story id and English", () => {
    const root = project("copyright: © 2026 Ada Writer");
    createEntity(root, { kind: "matter", name: "Copyright", order: "1" });
    fs.appendFileSync(path.join(root, "matter", "copyright.md"), "\nHand-written copyright page.\n");
    const markdown = fs.readFileSync(buildBook(root).outFile, "utf8");
    expect(markdown).toContain("Hand-written copyright page.");
    expect(markdown).not.toContain("All rights reserved.");

    const plain = fs.readFileSync(buildBook(project(), { format: "epub" }).outFile).toString("utf8");
    expect(plain).toContain('<dc:identifier id="book-id">harbor-lights</dc:identifier>');
    expect(plain).toContain("<dc:language>en</dc:language>");
    expect(plain).not.toContain("alternativeText");
    expect(plain).not.toContain("copyright");
  });
});

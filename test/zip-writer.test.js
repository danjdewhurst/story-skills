import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { buildBook, createStoryProject } from "../src/story.js";
import { makeTempDir, readArchiveEntries, writeMarkdown } from "./helpers.js";

const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const UTF8_NAME_FLAG = 0x0800;
const STORED = 0;
const DEFLATED = 8;

function bookProject(cover = false) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Zip Story", force: false });
  writeMarkdown(
    path.join(root, "chapters", "chapter-01.md"),
    "title: Arrival\nnumber: 1\nstatus: final",
    // Repetitive prose so deflate has something to work with.
    `## Chapter Text\n\n${"The lamps came on along the harbor wall. ".repeat(60)}\n`
  );
  if (cover) {
    fs.writeFileSync(path.join(root, "cover.png"), PNG_BYTES);
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", "schema-version: 2\ncover: cover.png\n"), "utf8");
  }
  return root;
}

describe("zip writer", () => {
  test("every entry declares its name as UTF-8", () => {
    const root = bookProject();
    for (const format of ["epub", "docx"]) {
      const entries = readArchiveEntries(buildBook(root, { format }).outFile);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.flags & UTF8_NAME_FLAG).toBe(UTF8_NAME_FLAG);
      }
    }
  });

  test("the epub mimetype stays stored and first while the rest deflate", () => {
    const entries = readArchiveEntries(buildBook(bookProject(), { format: "epub" }).outFile);

    expect(entries[0].name).toBe("mimetype");
    expect(entries[0].method).toBe(STORED);
    expect(entries[0].compressedSize).toBe(entries[0].size);
    for (const entry of entries.slice(1)) {
      expect(entry.method).toBe(DEFLATED);
      expect(entry.compressedSize).toBeLessThan(entry.size);
    }
  });

  test("the mimetype media type sits at the fixed OCF offset", () => {
    const buffer = fs.readFileSync(buildBook(bookProject(), { format: "epub" }).outFile);
    expect(buffer.toString("utf8", 30, 38)).toBe("mimetype");
    expect(buffer.toString("utf8", 38, 58)).toBe("application/epub+zip");
  });

  test("docx entries all deflate", () => {
    const entries = readArchiveEntries(buildBook(bookProject(), { format: "docx" }).outFile);
    for (const entry of entries) {
      expect(entry.method).toBe(DEFLATED);
    }
  });

  test("an incompressible cover image is stored rather than grown", () => {
    const entries = readArchiveEntries(buildBook(bookProject(true), { format: "epub" }).outFile);
    const cover = entries.find((entry) => entry.name === "OEBPS/images/cover.png");

    expect(cover.method).toBe(STORED);
    expect(cover.content.equals(PNG_BYTES)).toBe(true);
  });

  test("repeated builds stay byte-identical", () => {
    const root = bookProject(true);
    for (const format of ["epub", "docx"]) {
      const first = buildBook(root, { format, out: `dist/first.${format}` });
      const second = buildBook(root, { format, out: `dist/second.${format}` });
      expect(fs.readFileSync(first.outFile).equals(fs.readFileSync(second.outFile))).toBe(true);
    }
  });
});

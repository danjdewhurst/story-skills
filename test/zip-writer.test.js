import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { deflateRaw } from "../src/deflate.js";
import { buildBook, createStoryProject } from "../src/story.js";
import { makeTempDir, NODE_ON_PATH, readArchiveEntries, writeMarkdown } from "./helpers.js";

const repoRoot = path.resolve(import.meta.dir, "..");
const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const UTF8_NAME_FLAG = 0x0800;
const STORED = 0;
const DEFLATED = 8;

// `cover` is the bytes of a cover.png, if the book has one.
function bookProject(cover = null) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Zip Story", force: false });
  writeMarkdown(
    path.join(root, "chapters", "chapter-01.md"),
    "title: Arrival\nnumber: 1\nstatus: final",
    // Repetitive prose so deflate has something to work with.
    `## Chapter Text\n\n${"The lamps came on along the harbor wall. ".repeat(60)}\n`
  );
  if (cover) {
    fs.writeFileSync(path.join(root, "cover.png"), cover);
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
    const entries = readArchiveEntries(buildBook(bookProject(PNG_BYTES), { format: "epub" }).outFile);
    const cover = entries.find((entry) => entry.name === "OEBPS/images/cover.png");

    expect(cover.method).toBe(STORED);
    expect(cover.content.equals(PNG_BYTES)).toBe(true);
  });

  test("a cover image is stored without trying to deflate it, even when that would shrink it (#589)", () => {
    // Every cover type is compressed already, so a crafted cover cannot make
    // the build spend time deflating it.
    const padded = Buffer.concat([PNG_BYTES, Buffer.alloc(20000)]);
    const entries = readArchiveEntries(buildBook(bookProject(padded), { format: "epub" }).outFile);
    const cover = entries.find((entry) => entry.name === "OEBPS/images/cover.png");

    expect(deflateRaw(padded).length).toBeLessThan(padded.length);
    expect(cover.method).toBe(STORED);
    expect(cover.content.equals(padded)).toBe(true);
  });

  test("repeated builds stay byte-identical", () => {
    const root = bookProject(PNG_BYTES);
    for (const format of ["epub", "docx"]) {
      const first = buildBook(root, { format, out: `dist/first.${format}` });
      const second = buildBook(root, { format, out: `dist/second.${format}` });
      expect(fs.readFileSync(first.outFile).equals(fs.readFileSync(second.outFile))).toBe(true);
    }
  });

  // process.execPath is Bun under `bun test`, so Node is looked up on PATH.
  test.skipIf(!NODE_ON_PATH)("bun, node, and the node fallback build the same bytes (#589)", () => {
    const root = bookProject(PNG_BYTES);
    // A long chapter of varied prose, so its entry spans several deflate
    // blocks.
    const words = "lamp harbor wall tide rope keeper gull salt light stair window bell night storm boat".split(" ");
    let seed = 7;
    const sentences = Array.from({ length: 6000 }, () => {
      seed = (seed * 48271) % 2147483647;
      return `${Array.from({ length: 6 + (seed % 9) }, (_, index) => words[(seed >> index) % words.length]).join(" ")} ${seed % 1000}.`;
    });
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Night\nnumber: 2\nstatus: final", `## Chapter Text\n\n${sentences.join(" ")}\n`);
    const runners = {
      node: path.join(repoRoot, "bin", "story.js"),
      fallback: path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js")
    };
    for (const [format, shunn] of [["epub", false], ["docx", false], ["docx", true]]) {
      const name = `${shunn ? "shunn" : "book"}.${format}`;
      const bunFile = buildBook(root, { format, shunn, out: `dist/bun-${name}` }).outFile;
      const built = fs.readFileSync(bunFile);
      const largest = readArchiveEntries(bunFile).reduce((most, entry) => (entry.size > most.size ? entry : most));
      const stats = {};
      deflateRaw(largest.content, { stats });
      expect(stats.blocks.length).toBeGreaterThan(1);
      for (const [runner, script] of Object.entries(runners)) {
        const out = path.join(root, "dist", `${runner}-${name}`);
        const result = spawnSync("node", [script, "build", root, "--format", format, ...(shunn ? ["--shunn"] : []), "--out", out], { encoding: "utf8" });
        expect(result.stderr).not.toContain("Error");
        expect(result.status).toBe(0);
        expect({ runner, name, same: fs.readFileSync(out).equals(built) }).toEqual({ runner, name, same: true });
      }
    }
  });
});

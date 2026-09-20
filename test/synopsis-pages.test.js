import { describe, expect, test } from "bun:test";
import { createStoryProject, synopsisBook } from "../src/story.js";
import { makeTempDir } from "./helpers.js";

function synopsisRoot() {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title: "Page Counts", force: false }).root;
}

describe("synopsis page counts", () => {
  test("rejects pages 0, -1, and 1.5", () => {
    for (const pages of [0, -1, 1.5]) {
      const root = synopsisRoot();
      expect(() => synopsisBook(root, { pages })).toThrow(
        `Unsupported synopsis length: ${pages}. Supported pages: 1, 3`
      );
    }
  });

  test("accepts the string '1' via Number coercion (the CLI passes argv strings)", () => {
    const root = synopsisRoot();
    expect(() => synopsisBook(root, { pages: "1" })).not.toThrow();
    expect(synopsisBook(root, { pages: "1" }).text).toBe(synopsisBook(root, { pages: 1 }).text);
  });
});

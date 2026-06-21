import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStoryProject } from "../../../../src/story.js";
import { readMarkdownDocument, safeProjectPath, saveMarkdownDocument } from "./markdown-store";

describe("markdown store", () => {
  test("round trips story.md and validates after save", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "story-md-"));
    const { root } = createStoryProject({ cwd: workspace, title: "Editor Story" });
    const document = readMarkdownDocument(root, "story.md");
    const saved = saveMarkdownDocument(root, "story.md", { ...document.frontmatter, status: "drafting" }, `${document.body}\nExtra note.\n`);
    expect(saved.document.frontmatter.status).toBe("drafting");
    expect(saved.validation.ok).toBe(true);
  });

  test("rejects traversal", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "story-md-"));
    const { root } = createStoryProject({ cwd: workspace, title: "Safe Story" });
    expect(() => safeProjectPath(root, "../escape.md")).toThrow(/outside project root/);
  });
});

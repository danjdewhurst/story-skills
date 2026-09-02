import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runStoryOperation } from "./story-cli";

const repoRoot = path.resolve(import.meta.dir, "../../../..");

describe("story-cli web wrappers", () => {
  test("reports clean example health", () => {
    const root = path.join(repoRoot, "examples", "the-last-ember");
    const result = runStoryOperation(root, "validate");
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("Project is valid");
  });

  test("surfaces continuity findings", () => {
    const root = path.join(repoRoot, "examples", "the-unraveled-thread");
    const result = runStoryOperation(root, "continuity");
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("wordcount is read-only unless write is explicit", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "story-cli-wrapper-"));
    const root = path.join(workspace, "the-last-ember");
    fs.cpSync(path.join(repoRoot, "examples", "the-last-ember"), root, { recursive: true });
    const before = fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8");
    const readOnly = runStoryOperation(root, "wordcount");
    const afterReadOnly = fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8");
    const write = runStoryOperation(root, "wordcount-write");
    expect(readOnly.ok).toBe(true);
    expect(readOnly.stdout).not.toContain("Updated chapter word-count");
    expect(afterReadOnly).toBe(before);
    expect(write.ok).toBe(true);
    expect(write.stdout).toContain("Updated chapter word-count");
  });
});

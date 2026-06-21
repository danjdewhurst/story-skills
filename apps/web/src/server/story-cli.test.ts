import { describe, expect, test } from "bun:test";
import path from "node:path";
import { runStoryOperation, storyHealth } from "./story-cli";

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

  test("builds report and next action data", () => {
    const root = path.join(repoRoot, "examples", "the-last-ember");
    const health = storyHealth(root);
    expect(health.report.ok).toBe(true);
    expect(health.next.ok).toBe(true);
  });
});

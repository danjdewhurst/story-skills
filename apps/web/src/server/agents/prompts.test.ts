import { describe, expect, test } from "bun:test";
import path from "node:path";
import { buildAgentPrompt } from "./prompts";

const repoRoot = path.resolve(import.meta.dir, "../../../../..");

describe("agent prompts", () => {
  test("includes workflow skill and context", () => {
    const projectRoot = path.join(repoRoot, "examples", "the-last-ember");
    const prompt = buildAgentPrompt({
      provider: "fake",
      projectRoot,
      workflow: "chapter-writing",
      userGoal: "Outline chapter two",
      allowedPaths: ["chapters/", "scenes/"],
      contextFiles: ["story.md", "chapters/_index.md"]
    });
    expect(prompt).toContain("Use the loaded workflow skill: chapter-writing");
    expect(prompt).toContain("# Chapter Writing");
    expect(prompt).toContain("Outline chapter two");
    expect(prompt).toContain("## story.md");
  });
});

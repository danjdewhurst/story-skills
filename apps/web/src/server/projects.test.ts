import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listStoryProjects, resolveStoryProject } from "./projects";

const repoRoot = path.resolve(import.meta.dir, "../../../..");

describe("project discovery", () => {
  test("lists example story projects", () => {
    const projects = listStoryProjects(path.join(repoRoot, "examples"));
    expect(projects.map((project) => project.id)).toContain("the-last-ember");
  });

  test("resolves projects inside the workspace", () => {
    const root = resolveStoryProject("the-last-ember", path.join(repoRoot, "examples"));
    expect(root.endsWith(path.join("examples", "the-last-ember"))).toBe(true);
  });

  test("rejects symlink escapes", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "story-studio-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "story-outside-"));
    fs.writeFileSync(path.join(outside, "story.md"), "---\ntitle: Escape\n---\n");
    fs.symlinkSync(outside, path.join(temp, "escape"), "dir");
    expect(() => resolveStoryProject("escape", temp)).toThrow(/outside workspace/);
  });
});

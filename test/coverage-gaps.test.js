import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createEntity, createStoryProject, renameEntity } from "../src/story.js";
import { makeTempDir } from "./helpers.js";

function newProject(title = "Gap Story") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("add, rename, and scan limits", () => {
  test("rename refuses when a project file's frontmatter does not parse", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara Quill" });
    fs.writeFileSync(path.join(root, "continuity", "exemptions.md"), "---\nnot yaml\n---\n", "utf8");
    expect(() => renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Vell" })).toThrow(/continuity[\\/]exemptions\.md: .*; nothing was changed/);
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  createEntity,
  createStoryProject,
  renameEntity
} from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

function project(fields = "") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Fixes", force: false });
  if (fields !== "") {
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\n${fields}\n`), "utf8");
  }
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nWords.\n");
  return { root, cwd };
}

describe("review fixes", () => {
  test("rename leaves a `to` key outside routes alone", () => {
    const { root } = project();
    createEntity(root, { kind: "location", name: "Yonder" });
    writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), "title: S\nchapter: chapter-01\nscene: 1\nstatus: draft\nstate-changes:\n  - character: mara\n    to: yonder", "# S\n");
    renameEntity(root, { kind: "location", id: "yonder", name: "Far Yonder" });
    expect(fs.readFileSync(path.join(root, "scenes", "chapter-01-scene-01.md"), "utf8")).toContain("    to: yonder");
  });
});

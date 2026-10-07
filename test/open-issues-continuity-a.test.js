import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  createEntity,
  createStoryProject,
  moveEntity
} from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

function pad(number) {
  return String(number).padStart(2, "0");
}

function writeChapter(root, number, fields = "", status = "draft") {
  writeMarkdown(path.join(root, "chapters", `chapter-${pad(number)}.md`), `
title: C${number}
number: ${number}
status: ${status}
${fields}
`, "## Chapter Text\n\nSome prose here.\n");
}

function writeState(root, lists, currentChapter = 5) {
  writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: base
current-chapter: ${currentChapter}
${lists}
`, "# Continuity State\n");
}

// Rewrites a character's status and adds frontmatter lines such as died-in.
function setCharacter(root, id, status, extra = "") {
  const file = path.join(root, "characters", `${id}.md`);
  const text = fs.readFileSync(file, "utf8").replace(/^(died-in|revived-in): .*\n/gm, "").replace(/^status: .*$/m, `status: ${status}${extra ? `\n${extra}` : ""}`);
  fs.writeFileSync(file, text, "utf8");
}

// Characters ann and bob, locations alpha..delta, artifact ring, and
// `chapters` drafted chapters with no fields.
function baseProject(chapters = 5) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Base", force: false });
  for (const name of ["Ann", "Bob"]) {
    createEntity(root, { kind: "character", name });
  }
  for (const name of ["Alpha", "Beta", "Gamma", "Delta"]) {
    createEntity(root, { kind: "location", name });
  }
  createEntity(root, { kind: "artifact", name: "Ring" });
  for (let number = 1; number <= chapters; number += 1) {
    writeChapter(root, number);
  }
  writeState(root, "character-state: []\nobject-state: []\nknowledge-state: []", chapters);
  return root;
}

test("moving a chapter rewrites revived-in", () => {
  const root = baseProject(3);
  setCharacter(root, "ann", "alive", "died-in: chapter-01\nrevived-in: chapter-03");
  moveEntity(root, { kind: "chapter", id: "chapter-03", number: 4 });
  expect(fs.readFileSync(path.join(root, "characters", "ann.md"), "utf8")).toContain("revived-in: chapter-04");
});

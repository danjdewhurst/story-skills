import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { chapterChronology } from "../src/chronology.js";
import { characterStateAt, formatContext } from "../src/context.js";
import { runCli } from "../src/cli.js";
import { checkProjectContinuity, createStoryProject, draftingContext, knowledgeAtChapter, scanProject } from "../src/story.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

const RESULT_SCHEMA = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

const MILL = "character-knowledge, learned in chapter-02; not yet shown to the reader, do not reveal";

// Chapter 1 is dated 2034 and chapter 2 is dated 2020. Ada learns "the mill
// burned" in chapter 2, so at the prologue she knows it and the reader does not.
function dualTimelineProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Dual Timeline", force: false });

  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: Prologue
number: 1
status: draft
date: 2034-06-01
pov: ada
characters:
  - ada
`, "# Chapter 1\n\n## Chapter Text\n\nThe city is quiet.\n");
  writeMarkdown(path.join(root, "chapters", "chapter-02.md"), `
title: The Fire
number: 2
status: draft
date: 2020-03-01
pov: ada
characters:
  - ada
`, "# Chapter 2\n\n## Chapter Text\n\nThe mill burned.\n");
  writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), `
title: The quiet
chapter: chapter-01
scene: 1
status: draft
pov: ada
characters:
  - ada
`, "# Scene\n\n## Purpose\n\nAda walks the empty street.\n");
  writeMarkdown(path.join(root, "characters", "ada.md"), `
name: Ada
role: protagonist
status: alive
`, "# Ada\n");

  const statePath = path.join(root, "continuity", "state.md");
  const raw = fs.readFileSync(statePath, "utf8");
  fs.writeFileSync(statePath, raw.replace(
    "knowledge-state: []",
    `knowledge-state:
  - character: ada
    knows: The river floods in spring
  - character: ada
    knows: the mill burned
    learned-in: chapter-02
  - character: ada
    knows: the city is gone
    learned-in: chapter-01`
  ), "utf8");

  return { root, cwd };
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

describe("dual-timeline knowledge (#341)", () => {
  test("story knowledge and story context label a flashback fact the same way", () => {
    const { root, cwd } = dualTimelineProject();

    expect(knowledgeAtChapter(root, "ada", "chapter-01")).toEqual([
      { knows: "The river floods in spring", learnedIn: "", audience: "reader" },
      { knows: "the mill burned", learnedIn: "chapter-02", audience: "character" },
      { knows: "the city is gone", learnedIn: "chapter-01", audience: "reader" }
    ]);
    // 2034 is after 2020, so the prologue's fact is not known in the flashback.
    expect(knowledgeAtChapter(root, "ada", "chapter-02")).toEqual([
      { knows: "The river floods in spring", learnedIn: "", audience: "reader" },
      { knows: "the mill burned", learnedIn: "chapter-02", audience: "reader" }
    ]);

    const atPrologue = invoke(cwd, ["knowledge", "ada", "--at", "chapter-01", "--path", root]);
    expect(atPrologue.code).toBe(0);
    expect(atPrologue.out).toContain(`- the mill burned (${MILL})`);
    expect(atPrologue.out).toContain("- The river floods in spring (reader-knowledge, pre-existing)");
    expect(atPrologue.out).toContain("- the city is gone (reader-knowledge, learned in chapter-01)");

    const atFlashback = invoke(cwd, ["knowledge", "ada", "--at", "chapter-02", "--path", root]);
    expect(atFlashback.out).toContain("- the mill burned (reader-knowledge, learned in chapter-02)");
    expect(atFlashback.out).not.toContain("the city is gone");
    expect(atFlashback.out).not.toContain("do not reveal");

    const prologue = formatContext(draftingContext(root, "chapter-01"));
    expect(prologue).toContain(`- the mill burned (${MILL})`);
    expect(prologue).toContain("- The river floods in spring (reader-knowledge, pre-existing)");
    expect(prologue).toContain("- the city is gone (reader-knowledge, learned in this chapter)");
    const prologueScene = formatContext(draftingContext(root, "chapter-01-scene-01"));
    expect(prologueScene).toContain(`- the mill burned (${MILL})`);
    expect(prologueScene).not.toContain("the mill burned (reader-knowledge");

    const flashback = formatContext(draftingContext(root, "chapter-02"));
    expect(flashback).toContain("- the mill burned (reader-knowledge, learned in this chapter)");
    expect(flashback).not.toContain("the city is gone");
    expect(flashback).not.toContain("the mill burned (character-knowledge");

    const json = invoke(cwd, ["knowledge", "ada", "--at", "chapter-01", "--path", root, "--json"]);
    expect(json.err).toBe("");
    const envelope = JSON.parse(json.out);
    expect(validateAgainstSchema(envelope, RESULT_SCHEMA)).toEqual([]);
    expect(envelope.data.entries.map((entry) => entry.audience)).toEqual(["reader", "character", "reader"]);
  });

  test("context keeps hidden facts in their own item, packed after what the reader has seen", () => {
    const { root } = dualTimelineProject();
    const statePath = path.join(root, "continuity", "state.md");
    fs.writeFileSync(statePath, fs.readFileSync(statePath, "utf8").replace(
      "    knows: the mill burned\n",
      "    knows: \"the mill burned\\nand Ada lit the match herself, in the dry spring, with the doors barred\"\n"
    ), "utf8");

    const full = draftingContext(root, "chapter-01");
    const items = full.sections.flatMap((entry) => entry.items);
    const seen = items.find((candidate) => candidate.id === "knowledge:ada");
    const hidden = items.find((candidate) => candidate.id === "hidden-knowledge:ada");
    expect(seen.text).not.toContain("the mill burned");
    expect(seen.text).not.toContain("character-knowledge");
    // The whole multiline fact sits under one heading that can be removed as a unit.
    expect(hidden.text).toBe(
      "### What Ada (ada) knows that the reader has not seen (do not reveal)\n" +
      `- the mill burned\nand Ada lit the match herself, in the dry spring, with the doors barred (${MILL})`
    );
    expect(items.indexOf(hidden)).toBe(items.indexOf(seen) + 1);

    // A budget that fits everything up to the seen facts but not the hidden
    // item keeps the seen facts.
    const before = items.slice(0, items.indexOf(seen) + 1).reduce((sum, candidate) => sum + candidate.tokens, 0);
    const tight = draftingContext(root, "chapter-01", { budget: before + hidden.tokens - 1 });
    const text = formatContext(tight);
    expect(text).toContain("- the city is gone (reader-knowledge, learned in this chapter)");
    expect(text).not.toContain("the mill burned");
    expect(tight.omitted.map((entry) => entry.id)).toContain("hidden-knowledge:ada");
  });

  test("a death in the earlier story-time chapter still applies to the later-dated prologue", () => {
    const { root } = dualTimelineProject();
    writeMarkdown(path.join(root, "characters", "ada.md"), `
name: Ada
role: protagonist
status: deceased
died-in: chapter-02
`, "# Ada\n");

    expect(messages(checkProjectContinuity(root).errors)).toContain(
      "chapters/chapter-01.md lists ada, who died in chapter-02; move posthumous appearances to mentions"
    );
    const project = scanProject(root);
    const ada = project.characters.find((character) => character.id === "ada");
    // Dead in 2020, so the 2034 prologue is after the death. The death chapter
    // has not been read, so the status is left out rather than shown as alive.
    expect(characterStateAt(ada, chapterChronology(project), "chapter-01").status).toBe("");
  });
});

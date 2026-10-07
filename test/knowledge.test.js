import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createEntity, createStoryProject, knowledgeAtChapter } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function knowledgeProject() {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title: "Knowledge", force: false });
  const root = created.root;

  for (let number = 1; number <= 3; number += 1) {
    writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 0
`, `## Chapter Text\n\nWords here.\n`);
  }
  writeMarkdown(path.join(root, "characters", "mara-finn.md"), `
name: Mara Finn
role: protagonist
status: alive
`, "# Mara\n");
  writeMarkdown(path.join(root, "characters", "jonas-reed.md"), `
name: Jonas Reed
role: supporting
status: alive
`, "# Jonas\n");

  const statePath = path.join(root, "continuity", "state.md");
  const raw = fs.readFileSync(statePath, "utf8");
  fs.writeFileSync(statePath, raw.replace("current-chapter: 0", "current-chapter: 3").replace(
    "knowledge-state: []",
    `knowledge-state:
  - character: mara-finn
    knows: The miller keeps a ledger
  - character: mara-finn
    knows: The ledger page is burned
    learned-in: chapter-02
  - character: mara-finn
    knows: The vault combination
    learned-in: chapter-03
  - character: jonas-reed
    knows: The tide schedule
    learned-in: chapter-01`
  ), "utf8");

  return { root, cwd };
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function writeBaseChapter(root, number, fields = "", status = "draft") {
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
    writeBaseChapter(root, number);
  }
  writeState(root, "character-state: []\nobject-state: []\nknowledge-state: []", chapters);
  return root;
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("knowledge queries", () => {
  test("returns pre-existing and learned-in-order knowledge in file order", () => {
    const { root } = knowledgeProject();
    expect(knowledgeAtChapter(root, "mara-finn", "chapter-02")).toEqual([
      { knows: "The miller keeps a ledger", learnedIn: "", audience: "reader" },
      { knows: "The ledger page is burned", learnedIn: "chapter-02", audience: "reader" }
    ]);
  });

  test("excludes knowledge learned after the requested chapter", () => {
    const { root } = knowledgeProject();
    expect(knowledgeAtChapter(root, "mara-finn", "chapter-01")).toEqual([
      { knows: "The miller keeps a ledger", learnedIn: "", audience: "reader" }
    ]);
  });

  test("scopes entries to the requested character", () => {
    const { root } = knowledgeProject();
    expect(knowledgeAtChapter(root, "jonas-reed", "chapter-03")).toEqual([
      { knows: "The tide schedule", learnedIn: "chapter-01", audience: "reader" }
    ]);
  });

  test("throws for unknown characters and chapters", () => {
    const { root } = knowledgeProject();
    expect(() => knowledgeAtChapter(root, "nobody-here", "chapter-01")).toThrow("Unknown character nobody-here");
    expect(() => knowledgeAtChapter(root, "mara-finn", "chapter-09")).toThrow("Unknown chapter chapter-09");
  });

  test("skips learned-in chapters that do not exist", () => {
    const { root } = knowledgeProject();
    const statePath = path.join(root, "continuity", "state.md");
    const raw = fs.readFileSync(statePath, "utf8");
    fs.writeFileSync(statePath, raw.replace(
      "learned-in: chapter-03",
      "learned-in: chapter-99"
    ), "utf8");
    expect(knowledgeAtChapter(root, "mara-finn", "chapter-03")).toEqual([
      { knows: "The miller keeps a ledger", learnedIn: "", audience: "reader" },
      { knows: "The ledger page is burned", learnedIn: "chapter-02", audience: "reader" }
    ]);
  });

  test("cli lists knowledge with learned-in and pre-existing markers", () => {
    const { root, cwd } = knowledgeProject();
    const result = invoke(cwd, ["knowledge", "mara-finn", "--at", "chapter-02", "--path", root]);
    expect(result.code).toBe(0);
    expect(result.out).toBe(
      "- The miller keeps a ledger (reader-knowledge, pre-existing)\n" +
      "- The ledger page is burned (reader-knowledge, learned in chapter-02)\n"
    );
  });

  test("cli reports when no knowledge applies", () => {
    const { root, cwd } = knowledgeProject();
    writeMarkdown(path.join(root, "characters", "blank-slate.md"), `
name: Blank Slate
role: minor
status: alive
`, "# Blank\n");
    const none = invoke(cwd, ["knowledge", "blank-slate", "--at", "chapter-03", "--path", root]);
    expect(none.code).toBe(0);
    expect(none.out).toBe("No recorded knowledge for blank-slate at chapter-03\n");
  });

  test("cli requires --at and a character id", () => {
    const { cwd } = knowledgeProject();
    const missingAt = invoke(cwd, ["knowledge", "mara-finn"]);
    expect(missingAt.code).toBe(2);
    expect(missingAt.err).toContain("Usage: story knowledge");

    const missingCharacter = invoke(cwd, ["knowledge", "--at", "chapter-01"]);
    expect(missingCharacter.code).toBe(2);
  });

  test("cli errors for unknown characters and chapters", () => {
    const { root, cwd } = knowledgeProject();
    const unknown = invoke(cwd, ["knowledge", "nobody-here", "--at", "chapter-01", "--path", root]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("Unknown character nobody-here");
  });
});

describe("story knowledge (#60)", () => {
  test("fails when a chapter does not parse", () => {
    const root = baseProject(3);
    writeState(root, "knowledge-state:\n  - character: ann\n    knows: the code\n    learned-in: chapter-02");
    expect(knowledgeAtChapter(root, "ann", "chapter-03")).toEqual([{ knows: "the code", learnedIn: "chapter-02", audience: "reader" }]);

    const chapter = path.join(root, "chapters", "chapter-02.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace(/^---\n/, ""), "utf8");
    expect(() => knowledgeAtChapter(root, "ann", "chapter-03")).toThrow("chapters/chapter-02.md");
    const result = invoke(root, ["knowledge", "ann", "--at", "chapter-02"]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("chapters/chapter-02.md");
  });

  test("fails on an entry with no knows instead of printing a blank bullet", () => {
    const root = baseProject(2);
    writeState(root, "knowledge-state:\n  - character: ann\n    learned-in: chapter-02");
    expect(() => knowledgeAtChapter(root, "ann", "chapter-02")).toThrow("knowledge-state[0] is missing knows");
  });
});

describe("sweep fixes", () => {
  test("knowledge names the parse error for a broken character file", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.writeFileSync(path.join(root, "characters", "mara.md"), "# No frontmatter\n");
    const result = invoke(path.dirname(root), ["knowledge", "mara", "--at", "chapter-01", "--path", root]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("characters/mara.md: is missing YAML frontmatter");
  });
});

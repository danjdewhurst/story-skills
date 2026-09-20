import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createStoryProject, knowledgeAtChapter } from "../src/story.js";
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

describe("knowledge queries", () => {
  test("returns pre-existing and learned-in-order knowledge in file order", () => {
    const { root } = knowledgeProject();
    expect(knowledgeAtChapter(root, "mara-finn", "chapter-02")).toEqual([
      { knows: "The miller keeps a ledger", learnedIn: "" },
      { knows: "The ledger page is burned", learnedIn: "chapter-02" }
    ]);
  });

  test("excludes knowledge learned after the requested chapter", () => {
    const { root } = knowledgeProject();
    expect(knowledgeAtChapter(root, "mara-finn", "chapter-01")).toEqual([
      { knows: "The miller keeps a ledger", learnedIn: "" }
    ]);
  });

  test("scopes entries to the requested character", () => {
    const { root } = knowledgeProject();
    expect(knowledgeAtChapter(root, "jonas-reed", "chapter-03")).toEqual([
      { knows: "The tide schedule", learnedIn: "chapter-01" }
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
      { knows: "The miller keeps a ledger", learnedIn: "" },
      { knows: "The ledger page is burned", learnedIn: "chapter-02" }
    ]);
  });

  test("cli lists knowledge with learned-in and pre-existing markers", () => {
    const { root, cwd } = knowledgeProject();
    const result = invoke(cwd, ["knowledge", "mara-finn", "--at", "chapter-02", "--path", root]);
    expect(result.code).toBe(0);
    expect(result.out).toBe(
      "- The miller keeps a ledger (pre-existing knowledge)\n" +
      "- The ledger page is burned (learned in chapter-02)\n"
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
    expect(missingAt.code).toBe(1);
    expect(missingAt.err).toContain("Usage: story knowledge");

    const missingCharacter = invoke(cwd, ["knowledge", "--at", "chapter-01"]);
    expect(missingCharacter.code).toBe(1);
  });

  test("cli errors for unknown characters and chapters", () => {
    const { root, cwd } = knowledgeProject();
    const unknown = invoke(cwd, ["knowledge", "nobody-here", "--at", "chapter-01", "--path", root]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("Unknown character nobody-here");
  });
});

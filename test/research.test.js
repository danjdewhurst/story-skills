import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { checkProjectSchema } from "../scripts/check-schema.js";
import { runCli } from "../src/cli.js";
import { createEntity, createStoryProject, formatProjectReport, projectReport, reindexProject, removeEntity, validateLinks, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function researchProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Research Story", force: false });
  createEntity(root, { kind: "chapter", name: "Low Tide", number: "1" });
  return { root, cwd };
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function setChapterStatus(root, status) {
  const file = path.join(root, "chapters", "chapter-01.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^status: .*$/m, `status: ${status}`), "utf8");
}

describe("research notes", () => {
  test("story add research writes the note and the registry", () => {
    const { root, cwd } = researchProject();
    const result = invoke(cwd, [
      "add", "research", "Tidal Bore Timing",
      "--source", "Smith, J. (2020). Tides of the Severn.",
      "--source", "Harbour master interview",
      "--used-in", "chapter-01",
      "--path", root
    ]);

    expect(result.code).toBe(0);
    const note = fs.readFileSync(path.join(root, "research", "tidal-bore-timing.md"), "utf8");
    expect(note).toContain("status: open\nsources:\n  - Smith, J. (2020). Tides of the Severn.\n  - Harbour master interview\nused-in:\n  - chapter-01\n");
    expect(note).toContain("## Findings");
    const index = fs.readFileSync(path.join(root, "research", "_index.md"), "utf8");
    expect(index).toContain("type: research-registry");
    expect(index).toContain("| Tidal Bore Timing | open | chapter-01 | [tidal-bore-timing](tidal-bore-timing.md) |");
    expect(validateProject(root).errors).toEqual([]);
    expect(validateLinks(root).errors).toEqual([]);
    expect(checkProjectSchema(root)).toEqual([]);
  });

  test("reindex leaves projects without research/ alone and empties the registry when notes go", () => {
    const { root } = researchProject();
    reindexProject(root);
    expect(fs.existsSync(path.join(root, "research"))).toBe(false);

    createEntity(root, { kind: "research-note", name: "Lamp Oil", status: "verified", source: "Museum label" });
    removeEntity(root, { kind: "research", id: "lamp-oil" });
    expect(fs.readFileSync(path.join(root, "research", "_index.md"), "utf8")).toContain("*No research notes yet*");
  });

  test("rejects an unknown status on add", () => {
    const { root } = researchProject();
    expect(() => createEntity(root, { kind: "research", name: "X", status: "maybe" })).toThrow('Unsupported research status "maybe": expected one of open, verified, disputed');
  });

  test("validate checks fields, the registry, and settled chapters resting on open research", () => {
    const { root } = researchProject();
    createEntity(root, { kind: "research", name: "Lamp Oil", "used-in": "chapter-01" });
    createEntity(root, { kind: "research", name: "Signal Codes", status: "verified" });
    writeMarkdown(path.join(root, "research", "bad-note.md"), "status: guessed\nsources: one\nused-in:\n  - \"\"");
    setChapterStatus(root, "final");
    const { errors, warnings } = validateProject(root);

    expect(errors).toContain("research/bad-note.md is missing frontmatter field title");
    expect(errors).toContain("research/bad-note.md frontmatter field status has unsupported value guessed");
    expect(errors).toContain("research/bad-note.md frontmatter field sources must be a list");
    expect(errors).toContain("research/bad-note.md frontmatter field used-in must contain only non-empty strings");
    expect(warnings).toContain("research/lamp-oil.md is open but chapter-01 relies on it and is final");
    expect(warnings).toContain("research/signal-codes.md is verified but lists no sources");
    expect(warnings).toContain("research/_index.md is missing registry link ](bad-note.md)");

    setChapterStatus(root, "draft");
    expect(validateProject(root).warnings.join("\n")).not.toContain("relies on it");
  });

  test("validate rejects a research registry with the wrong type", () => {
    const { root } = researchProject();
    createEntity(root, { kind: "research", name: "Lamp Oil" });
    writeMarkdown(path.join(root, "research", "_index.md"), "type: notes\nstory: research-story", "# Research\n");
    expect(validateProject(root).errors).toContain("research/_index.md type must be research-registry");
  });

  test("links accepts plot links to research notes and matter pages", () => {
    const { root } = researchProject();
    createEntity(root, { kind: "research", name: "Lamp Oil" });
    createEntity(root, { kind: "matter", name: "Author Note", placement: "back" });
    const timelinePath = path.join(root, "plot", "timeline.md");
    fs.appendFileSync(timelinePath, "\nSee [lamp oil](../research/lamp-oil.md) and [the note](../matter/author-note.md).\n", "utf8");
    expect(validateLinks(root).errors).toEqual([]);
  });

  test("links accepts scheduled used-in chapters and reports typos", () => {
    const { root } = researchProject();
    createEntity(root, { kind: "research", name: "Lamp Oil", "used-in": ["chapter-01", "chapter-09", "chapter-1"] });
    // chapter-09 is not written yet; chapter-1 is a typo of chapter-01.
    expect(validateLinks(root).errors).toEqual(["research/lamp-oil.md references missing chapter chapter-1"]);
  });

  test("removing a chapter scrubs used-in and report counts notes", () => {
    const { root } = researchProject();
    expect(formatProjectReport(projectReport(root))).not.toContain("Research notes");
    createEntity(root, { kind: "research", name: "Lamp Oil", "used-in": "chapter-01" });
    removeEntity(root, { kind: "chapter", id: "chapter-01" });

    expect(fs.readFileSync(path.join(root, "research", "lamp-oil.md"), "utf8")).toContain("used-in: []");
    expect(projectReport(root).counts.research).toBe(1);
    expect(formatProjectReport(projectReport(root))).toContain("- Research notes: 1");
  });
});

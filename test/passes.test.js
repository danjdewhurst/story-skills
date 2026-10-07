import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { DEFAULT_PASSES, formatPasses, nextPass, passChecks, readPasses, updatePasses } from "../src/passes.js";
import { createEntity, createStoryProject, formatActionReport, projectActions, projectPasses, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages, whileWriting, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function project() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Revise Me", force: false });
  return { root, cwd };
}

function setStoryField(root, text) {
  const storyPath = path.join(root, "story.md");
  const raw = fs.readFileSync(storyPath, "utf8");
  fs.writeFileSync(storyPath, raw.replace("schema-version: 2\n", `schema-version: 2\n${text}\n`), "utf8");
}

function reviewProject(fields = "") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Fixes", force: false });
  if (fields !== "") {
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\n${fields}\n`), "utf8");
  }
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nWords.\n");
  return { root, cwd };
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("story passes", () => {
  test("keeps story.md when it is saved after it was read (#547)", () => {
    const { root } = project();
    const storyPath = path.join(root, "story.md");
    const saved = fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", "schema-version: 2\ndeadline: 2027-01-01\n");
    const spy = whileWriting(storyPath, () => fs.writeFileSync(storyPath, saved));
    try {
      expect(() => projectPasses(root, { init: true })).toThrow("story.md changed on disk while story was updating it, so it was left as it is");
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(storyPath, "utf8")).toBe(saved);
  });

  test("init adds the ladder, start and done mark passes, and the rest of story.md is kept", () => {
    const { root } = project();
    const before = fs.readFileSync(path.join(root, "story.md"), "utf8");
    expect(projectPasses(root)).toEqual({ passes: [], changed: false });

    const init = projectPasses(root, { init: true });
    expect(init.changed).toBe(true);
    expect(init.passes.map((entry) => entry.pass)).toEqual(["structure", "character", "theme", "continuity", "pacing", "line", "copyedit", "proof"]);
    expect(projectPasses(root, { init: true }).changed).toBe(false);

    projectPasses(root, { start: "structure" });
    projectPasses(root, { done: "character", start: "dialect-pass" });
    const passes = readPasses({ "revision-passes": projectPasses(root).passes });
    expect(passes.slice(0, 2)).toEqual([{ pass: "structure", status: "in-progress" }, { pass: "character", status: "done" }]);
    expect(passes[passes.length - 1]).toEqual({ pass: "dialect-pass", status: "in-progress" });

    const after = fs.readFileSync(path.join(root, "story.md"), "utf8");
    expect(after.split("---")[2]).toBe(before.split("---")[2]);
    expect(after).toContain("  - pass: structure\n    status: in-progress");
    expect(messages(validateProject(root).errors)).toEqual([]);
  });

  test("update and next follow the ladder", () => {
    expect(() => updatePasses([], { done: "Not Kebab" })).toThrow("Revision pass names must be kebab-case, got Not Kebab");
    expect(nextPass([{ pass: "a", status: "done" }, { pass: "b", status: "pending" }, { pass: "c", status: "in-progress" }])).toEqual({ pass: "c", status: "in-progress" });
    expect(nextPass([{ pass: "a", status: "done" }])).toBe(null);
    expect(readPasses({ "revision-passes": "nope" })).toEqual([]);
    expect(readPasses({ "revision-passes": [{ pass: "a" }, "junk"] })).toEqual([{ pass: "a", status: "pending" }]);
  });

  test("format shows the default ladder, progress marks, and the next pass", () => {
    expect(formatPasses([])).toContain("Run story passes --init to add the default ladder");
    const text = formatPasses([{ pass: "structure", status: "done" }, { pass: "custom", status: "in-progress" }, { pass: "proof", status: "pending" }]);
    expect(text).toContain("Revision passes: 1 of 3 done");
    expect(text).toContain("[x] structure - Order of events");
    expect(text).toContain("[~] custom\n");
    expect(text).toContain("[ ] proof - Typos and layout");
    expect(text).toContain("Next: custom (in progress); mark it with story passes --done custom");
    expect(formatPasses([{ pass: "proof", status: "done" }])).toContain("All passes done.");
  });

  test("validate rejects malformed pass lists", () => {
    const { root } = project();
    setStoryField(root, "revision-passes:\n  - pass: Bad Name\n  - pass: line\n    status: someday\n  - pass: line\n  - loose");
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain("story.md revision pass Bad Name must be a kebab-case name");
    expect(errors).toContain("story.md revision pass line has unsupported status someday");
    expect(errors).toContain("story.md lists revision pass line more than once");
    expect(errors).toContain("story.md frontmatter field revision-passes must contain objects");

    const other = project();
    setStoryField(other.root, "revision-passes: all");
    expect(messages(validateProject(other.root).errors)).toContain("story.md frontmatter field revision-passes must be a list");
  });

  test("story next recommends planning passes, then the next pass, while revising", () => {
    const { root } = project();
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/status: \w+/, "status: revising"), "utf8");
    expect(formatActionReport(projectActions(root))).toContain("Plan revision passes");

    projectPasses(root, { init: true, done: "structure" });
    const report = formatActionReport(projectActions(root));
    expect(report).toContain("Revision pass: character");
    expect(report).toContain("story voices");
    expect(report).toContain("story passes --done character");

    projectPasses(root, { start: "house-style" });
    expect(formatActionReport(projectActions(root))).toContain("Work through this pass. Mark it with story passes --done house-style.");
  });

  test("story next lists actions by priority and keeps ties in insertion order", () => {
    const { root } = project();
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/status: \w+/, "status: revising"), "utf8");
    createEntity(root, { kind: "question", name: "Who lit the fire" });
    createEntity(root, { kind: "chapter", name: "Chapter 1", number: 1 });
    projectPasses(root, { init: true });

    const actions = projectActions(root).actions.map((item) => `${item.priority} ${item.title}`);
    expect(actions).toEqual([
      "P1 Add scene records",
      "P1 Revision pass: structure",
      "P2 Track open questions",
      // A book under revision gets no "Draft chapter" suggestion.
      "P2 Create first character"
    ]);
  });

  test("CLI prints the checklist and reports updates", () => {
    const { root, cwd } = project();
    const result = invoke(cwd, ["passes", root, "--init", "--start", "structure"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Updated revision-passes in story.md");
    expect(result.out).toContain("[~] structure");
    const quiet = invoke(cwd, ["passes", root]);
    expect(quiet.out).not.toContain("Updated");

    fs.writeFileSync(path.join(root, "story.md"), "---\ntitle: Broken\n      - boat\n---\n", "utf8");
    const broken = invoke(cwd, ["passes", root, "--done", "proof"]);
    expect(broken.code).toBe(3);
    expect(broken.err).toContain("story.md cannot be parsed");
  });
});

describe("#76 revision pass checks", () => {
  test("check commands name the project path", () => {
    const structure = DEFAULT_PASSES.find((entry) => entry.pass === "structure");
    expect(passChecks(structure, ".")).toEqual(["story timeline", "story pacing", "story diagram arcs"]);
    expect(passChecks(structure, "book")).toEqual(["story timeline book", "story pacing book", "story diagram arcs --path book"]);
    const proof = DEFAULT_PASSES.find((entry) => entry.pass === "proof");
    expect(passChecks(proof, "book")).toEqual(["story build book --format print", "story build book --format html"]);
  });

  test("story next from the parent folder prints runnable checks", () => {
    const cwd = makeTempDir();
    const root = createStoryProject({ cwd, title: "Book", dir: "book", force: false }).root;
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^status: \w+/m, "status: revising"));
    expect(invoke(cwd, ["passes", "book", "--init"]).code).toBe(0);
    expect(invoke(cwd, ["next", "book"]).out).toContain("Run story timeline book, story pacing book, story diagram arcs --path book. Mark it with story passes book --done structure.");
  });
});

describe("review fixes", () => {
  test("pass updates keep extra fields and refuse to rewrite a malformed list", () => {
    const { root } = reviewProject("revision-passes:\n  - pass: structure\n    status: pending\n    note: check act two");
    projectPasses(root, { done: "structure" });
    expect(fs.readFileSync(path.join(root, "story.md"), "utf8")).toContain("  - pass: structure\n    status: done\n    note: check act two");

    const broken = reviewProject("revision-passes:\n  - pass: Bad Name");
    expect(() => projectPasses(broken.root, { init: true })).toThrow("Fix revision-passes in story.md before changing it");
  });
});

describe("reports and views", () => {
  test("passes notes a custom pass that looks like a typo", () => {
    const root = sweepProject();
    const result = projectPasses(root, { done: "strucutre" });
    expect(result.notes).toEqual(["Added custom pass strucutre, which is not in the default ladder; did you mean structure?"]);
    expect(projectPasses(root, { done: "structure" }).notes).toEqual([]);
    const cli = invoke(path.dirname(root), ["passes", root, "--start", "sensitivity-read"]);
    expect(cli.err).toContain("note: Added custom pass sensitivity-read, which is not in the default ladder\n");
  });
});

describe("sweep fixes", () => {
  test("passes hints use the path the user typed", () => {
    const root = sweepProject();
    const typed = path.basename(root);
    expect(invoke(path.dirname(root), ["passes", typed]).out).toContain(`Run story passes ${typed} --init`);
    expect(invoke(path.dirname(root), ["passes", typed, "--start", "structure"]).out).toContain(`mark it with story passes ${typed} --done structure`);
  });
});

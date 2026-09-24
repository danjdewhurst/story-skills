import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { formatPasses, nextPass, readPasses, updatePasses } from "../src/passes.js";
import { createStoryProject, formatActionReport, projectActions, projectPasses, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo } from "./helpers.js";

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

describe("story passes", () => {
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
    expect(validateProject(root).errors).toEqual([]);
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
    const errors = validateProject(root).errors;
    expect(errors).toContain("story.md revision pass Bad Name must be a kebab-case name");
    expect(errors).toContain("story.md revision pass line has unsupported status someday");
    expect(errors).toContain("story.md lists revision pass line more than once");
    expect(errors).toContain("story.md frontmatter field revision-passes must contain objects");

    const other = project();
    setStoryField(other.root, "revision-passes: all");
    expect(validateProject(other.root).errors).toContain("story.md frontmatter field revision-passes must be a list");
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
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("story.md cannot be parsed");
  });
});

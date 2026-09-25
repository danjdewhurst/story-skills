import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { checkContinuity } from "../src/continuity.js";
import {
  createEntity,
  createStoryProject,
  formatActionReport,
  projectActions,
  reindexProject,
  removeEntity,
  renameEntity,
  scanProject,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function writeChapter(root, number) {
  writeMarkdown(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 0
`, `## Chapter Text\n\nWords here.\n`);
}

function writeClue(root, id, frontmatter) {
  writeMarkdown(path.join(root, "continuity", "clues", `${id}.md`), `
title: ${id}
${frontmatter.trim()}
`, `# ${id}\n`);
}

function clueProject(chapters) {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title: "Clue Ledger", force: false });
  const root = created.root;
  for (let number = 1; number <= chapters; number += 1) {
    writeChapter(root, number);
  }
  const statePath = path.join(root, "continuity", "state.md");
  fs.writeFileSync(statePath, fs.readFileSync(statePath, "utf8").replace("current-chapter: 0", `current-chapter: ${chapters}`), "utf8");
  return root;
}

describe("clue ledger", () => {
  test("add clue writes the clue template with defaults", () => {
    const root = clueProject(3);
    const result = createEntity(root, {
      kind: "clue",
      name: "The silver locket",
      planted: "chapter-01",
      payoff: "chapter-03"
    });

    expect(result.kind).toBe("clue");
    expect(result.id).toBe("the-silver-locket");
    const raw = fs.readFileSync(result.file, "utf8");
    expect(raw).toContain("status: planted");
    expect(raw).toContain("planted: chapter-01");
    expect(raw).toContain("payoff: chapter-03");
    expect(raw).toContain("significance-delayed: false");
    expect(raw).toContain("## Clue");
    expect(raw).toContain("## Planting Plan");
    expect(raw).toContain("## Payoff Plan");
    expect(raw).toContain("## Tracking Notes");

    const project = scanProject(root);
    expect(project.clues.map((clue) => clue.id)).toContain("the-silver-locket");
    const clue = project.clues.find((entry) => entry.id === "the-silver-locket");
    expect(clue.significanceDelayed).toBe(false);
    expect(clue.title).toBe("The silver locket");
  });

  test("add clue honors --significance-delayed", () => {
    const root = clueProject(1);
    const result = createEntity(root, {
      kind: "clue",
      name: "Delayed Meaning",
      "significance-delayed": true
    });
    const raw = fs.readFileSync(result.file, "utf8");
    expect(raw).toContain("significance-delayed: true");
    expect(scanProject(root).clues.find((clue) => clue.id === "delayed-meaning").significanceDelayed).toBe(true);
  });

  test("reindex writes the clue registry", () => {
    const root = clueProject(1);
    createEntity(root, { kind: "clue", name: "The silver locket", planted: "chapter-01" });
    reindexProject(root);
    const raw = fs.readFileSync(path.join(root, "continuity", "clues", "_index.md"), "utf8");
    expect(raw).toContain("type: clue-registry");
    expect(raw).toContain("the-silver-locket");
    expect(formatActionReport(projectActions(root))).toContain("Review open clues");
  });

  test("flags payoff before plant, planted without chapter, and paid-off without payoff", () => {
    const root = clueProject(3);
    writeClue(root, "backward-clue", `
status: planted
planted: chapter-03
payoff: chapter-01
`);
    writeClue(root, "planted-nowhere", `
status: planted
`);
    writeClue(root, "paid-unrecorded", `
status: paid-off
planted: chapter-01
`);

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toContain(
      "continuity/clues/backward-clue.md pays off in chapter-01 before it is planted in chapter-03"
    );
    expect(result.errors).toContain(
      "continuity/clues/planted-nowhere.md is planted but no plant chapter recorded"
    );
    expect(result.errors).toContain(
      "continuity/clues/paid-unrecorded.md has status paid-off but no payoff chapter recorded"
    );
    expect(result.ok).toBe(false);
  });

  test("warns when a planted clue goes unpaid for three chapters", () => {
    const root = clueProject(5);
    writeClue(root, "stale-clue", `
status: planted
planted: chapter-01
`);

    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toContain(
      "continuity/clues/stale-clue.md was planted in chapter-01, 4 chapters ago, and has no payoff yet"
    );
    expect(result.ok).toBe(true);
  });

  test("skips the gap warning when payoff is still ahead and names a passed payoff", () => {
    const ahead = clueProject(4);
    writeClue(ahead, "later-clue", `
status: planted
planted: chapter-01
payoff: chapter-10
`);
    const aheadResult = checkContinuity(scanProject(ahead));
    expect(aheadResult.warnings.join("\n")).not.toContain("later-clue");

    const passed = clueProject(4);
    writeClue(passed, "missed-clue", `
status: planted
planted: chapter-01
payoff: chapter-02
`);
    const passedResult = checkContinuity(scanProject(passed));
    expect(passedResult.warnings).toContain(
      "continuity/clues/missed-clue.md payoff chapter chapter-02 has passed and status is still planted"
    );
  });

  test("does not warn for recently planted clues", () => {
    const root = clueProject(3);
    writeClue(root, "fresh-clue", `
status: planted
planted: chapter-02
`);

    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("complete stories reject planned and planted clues", () => {
    const root = clueProject(2);
    writeClue(root, "open-clue", `
status: planned
`);
    writeClue(root, "growing-clue", `
status: planted
planted: chapter-01
`);
    const storyPath = path.join(root, "story.md");
    const storyRaw = fs.readFileSync(storyPath, "utf8");
    fs.writeFileSync(storyPath, storyRaw.replace("status: planning", "status: complete"), "utf8");

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toContain(
      "story.md is complete but continuity/clues/open-clue.md is still planned"
    );
    expect(result.errors).toContain(
      "story.md is complete but continuity/clues/growing-clue.md is still planted"
    );
  });

  test("rename rewrites clue character references", () => {
    const root = clueProject(2);
    createEntity(root, { kind: "character", name: "Mara Finn", role: "protagonist" });
    writeClue(root, "tracked-clue", `
status: planted
planted: chapter-01
characters:
  - mara-finn
`);
    renameEntity(root, { kind: "character", id: "mara-finn", name: "Mara Vale" });

    const raw = fs.readFileSync(path.join(root, "continuity", "clues", "tracked-clue.md"), "utf8");
    expect(raw).toContain("mara-vale");
    expect(raw).not.toContain("mara-finn");
    expect(raw).toContain("planted: chapter-01");
  });

  test("remove scrubs clue chapter references", () => {
    const root = clueProject(3);
    writeClue(root, "tracked-clue", `
status: planted
planted: chapter-02
payoff: chapter-03
`);
    removeEntity(root, { kind: "chapter", id: "chapter-02" });

    const raw = fs.readFileSync(path.join(root, "continuity", "clues", "tracked-clue.md"), "utf8");
    expect(raw).toContain("planted: ");
    expect(raw).not.toContain("planted: chapter-02");
    expect(raw).toContain("payoff: chapter-03");
  });

  test("add clue through the CLI honors --significance-delayed", () => {
    const root = clueProject(1);
    const io = memoryIo(root);
    const code = runCli(["add", "clue", "--significance-delayed", "The Marked Locket"], io);
    expect(code).toBe(0);
    expect(io.output()).toContain("Created clue the-marked-locket");

    const raw = fs.readFileSync(path.join(root, "continuity", "clues", "the-marked-locket.md"), "utf8");
    expect(raw).toContain("significance-delayed: true");
    expect(scanProject(root).clues.find((clue) => clue.id === "the-marked-locket").significanceDelayed).toBe(true);
  });

  test("validate rejects malformed clue files", () => {
    const root = clueProject(2);
    writeClue(root, "missing-status", `
status: ""
`);
    writeClue(root, "bad-status", `
status: glowing
`);
    writeClue(root, "bad-flag", `
status: planned
significance-delayed: "yes"
`);
    writeClue(root, "bad-lists", `
status: planned
characters: not-a-list
`);

    const result = validateProject(root);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("frontmatter field status has unsupported value ");
    expect(result.errors.join("\n")).toContain("frontmatter field significance-delayed must be a boolean");
    expect(result.errors.join("\n")).toContain("frontmatter field characters must be a list");
  });

  test("validate accepts a well-formed clue", () => {
    const root = clueProject(2);
    createEntity(root, { kind: "clue", name: "The Marked Locket", planted: "chapter-01", payoff: "chapter-02", "significance-delayed": true });

    const result = validateProject(root);
    expect(result.errors.filter((error) => error.includes("clues/"))).toEqual([]);
  });

  test("links flags clue references to missing chapters, arcs, and characters", () => {
    const root = clueProject(2);
    writeClue(root, "dangling-clue", `
status: planted
planted: chapter-09
payoff: chapter-10
arcs:
  - missing-arc
characters:
  - missing-character
`);

    const result = validateLinks(root);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("continuity/clues/dangling-clue.md references missing chapter chapter-09");
    // A payoff past the last chapter is scheduled, not missing.
    expect(result.errors).not.toContain("continuity/clues/dangling-clue.md references missing chapter chapter-10");
    expect(result.errors).toContain("continuity/clues/dangling-clue.md references missing arc missing-arc");
    expect(result.errors).toContain("continuity/clues/dangling-clue.md references missing character missing-character");
  });

  test("validate accepts abandoned clue status and continuity skips abandoned ordering", () => {
    const root = clueProject(3);
    writeClue(root, "cut-clue", `
status: abandoned
planted: chapter-03
payoff: chapter-01
`);

    const validation = validateProject(root);
    expect(validation.errors.filter((error) => error.includes("cut-clue"))).toEqual([]);

    const result = checkContinuity(scanProject(root));
    expect(result.errors.filter((error) => error.includes("cut-clue"))).toEqual([]);
  });

  test("validate rejects non-scalar planted and payoff in clue files", () => {
    const root = clueProject(2);
    writeClue(root, "list-planted", `
status: planted
planted:
  - chapter-01
`);
    writeClue(root, "map-payoff", `
status: planned
payoff:
  - chapter: chapter-02
`);

    const result = validateProject(root);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("continuity/clues/list-planted.md frontmatter field planted must be a scalar");
    expect(result.errors).toContain("continuity/clues/map-payoff.md frontmatter field payoff must be a scalar");
  });

  test("warns on nested files inside continuity/clues", () => {
    const root = clueProject(1);
    writeMarkdown(path.join(root, "continuity", "clues", "extra", "nested.md"), `
title: Nested
status: planned
`, "# Nested\n");

    const validation = validateProject(root);
    expect(validation.warnings.join("\n")).toContain("continuity/clues/extra/nested.md is nested inside an entity directory and is ignored");
  });

  test("body links to clue ids resolve instead of reporting missing", () => {
    const root = clueProject(2);
    createEntity(root, { kind: "clue", name: "Known Clue", planted: "chapter-01" });
    const timelinePath = path.join(root, "plot", "timeline.md");
    const timelineRaw = fs.readFileSync(timelinePath, "utf8");
    fs.writeFileSync(timelinePath, `${timelineRaw}\nSee [Known Clue](../continuity/clues/known-clue.md).\nSee [Ghost Clue](ghost-clue.md).\n`, "utf8");

    const result = validateLinks(root);
    expect(result.errors.join("\n")).toContain("links to missing file ghost-clue.md");
    expect(result.errors.join("\n")).not.toContain("known-clue");
  });
});

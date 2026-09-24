import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { formatClueMatrix } from "../src/clues.js";
import { clueReport, createEntity, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function clueProject(chapters) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Fair Play", force: false });
  for (let number = 1; number <= chapters; number += 1) {
    writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
`, "## Chapter Text\n\nWords.\n");
  }
  return { root, cwd };
}

function writeClue(root, id, frontmatter) {
  writeMarkdown(path.join(root, "continuity", "clues", `${id}.md`), `
title: ${id}
${frontmatter.trim()}
`, `# ${id}\n`);
}

describe("story clues", () => {
  test("draws plants and reveals per chapter, sorted by plant", () => {
    const { root } = clueProject(4);
    writeClue(root, "ash-print", "status: paid-off\nplanted: chapter-02\npayoff: chapter-04\ncharacters:\n  - jonas");
    writeClue(root, "torn-glove", "status: planted\nplanted: chapter-01\nsignificance-delayed: true\ncharacters:\n  - jonas");
    writeClue(root, "same-page", "status: paid-off\nplanted: chapter-03\npayoff: chapter-03\ncharacters:\n  - jonas");

    const report = clueReport(root);
    expect(report.ok).toBe(true);
    expect(report.rows.map((row) => [row.id, row.cells.join("")])).toEqual([
      ["torn-glove", "P..."],
      ["ash-print", ".P.R"],
      ["same-page", "..x."]
    ]);
    expect(report.totals).toEqual({ clues: 3, redHerrings: 0, planted: 3, revealed: 2 });
    expect(report.warnings).toEqual([
      "clue same-page is planted in the same chapter as its reveal (chapter-03 -> chapter-03): late plant gives readers no time to notice it"
    ]);

    const text = formatClueMatrix(report);
    expect(text).toMatch(/Clue\s+1  2  3  4\n/);
    expect(text).toContain("planted, delayed");
    expect(text).toContain("P planted, R revealed, x both, ~ red herring");
  });

  test("flags unplanted reveals, late plants, silent clues, undebunked red herrings, and no delayed clue", () => {
    const { root } = clueProject(5);
    writeClue(root, "a-reveal-only", "status: paid-off\npayoff: chapter-05\ncharacters:\n  - x");
    writeClue(root, "b-late", "status: paid-off\nplanted: chapter-03\npayoff: chapter-04\ncharacters:\n  - x");
    writeClue(root, "c-silent", "status: planted\nplanted: chapter-01");
    writeClue(root, "d-herring", "status: planted\nplanted: chapter-02\nred-herring: true\ncharacters:\n  - x");
    writeClue(root, "e-dropped", "status: dropped\npayoff: chapter-05");

    const report = clueReport(root);
    expect(report.warnings).toEqual([
      "clue c-silent lists no characters: record who could notice it",
      "clue d-herring is a red herring with no payoff: record the chapter that debunks it",
      "clue b-late is planted in the chapter before its reveal (chapter-03 -> chapter-04): late plant gives readers no time to notice it",
      "clue a-reveal-only is revealed in chapter-05 but never planted: readers cannot play fair",
      "no clue is significance-delayed: every clue announces its meaning when planted"
    ]);
    expect(formatClueMatrix(report)).toContain("d-herring ~");
    expect(formatClueMatrix(report)).toContain("Clues: 4 live (1 red herring), 3 planted, 2 revealed");
  });

  test("add clue --red-herring writes the flag and validate checks its type", () => {
    const { root } = clueProject(2);
    createEntity(root, { kind: "clue", name: "False Trail", planted: "chapter-01", "red-herring": true });
    const raw = fs.readFileSync(path.join(root, "continuity", "clues", "false-trail.md"), "utf8");
    expect(raw).toContain("red-herring: true");
    expect(clueReport(root).totals.redHerrings).toBe(1);

    createEntity(root, { kind: "clue", name: "Plain" });
    expect(fs.readFileSync(path.join(root, "continuity", "clues", "plain.md"), "utf8")).not.toContain("red-herring");

    writeClue(root, "bad-flag", "status: planned\nred-herring: yes please");
    expect(validateProject(root).errors).toContain("continuity/clues/bad-flag.md frontmatter field red-herring must be a boolean");
  });

  test("CLI prints the grid and an empty-state hint", () => {
    const { root, cwd } = clueProject(1);
    const empty = invoke(cwd, ["clues", root]);
    expect(empty.code).toBe(0);
    expect(empty.out).toContain("- None: add clues with story add clue");

    writeClue(root, "ash", "status: planted\nplanted: chapter-01\ncharacters:\n  - x");
    const result = invoke(cwd, ["clues", root]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Clue   1");
    expect(result.err).toContain("Clue check complete: 0 errors, 0 warnings");
  });
});

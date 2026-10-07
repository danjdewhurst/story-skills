import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import { EXPECTED_WARNINGS, checkExamples, collectAdvisory } from "../scripts/check-examples.js";

const examplesRoot = path.resolve(import.meta.dir, "..", "examples");

// Copies the named examples into a scratch examples folder, plus a stray file
// and a folder without story.md that the check must skip.
function examplesCopy(names) {
  const dir = makeTempDir("story-check-examples-");
  for (const name of names) {
    fs.cpSync(path.join(examplesRoot, name), path.join(dir, name), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, "README.md"), "Not a project.\n");
  fs.mkdirSync(path.join(dir, "drafts"));
  return dir;
}

function run(dir) {
  const out = [];
  const err = [];
  const status = checkExamples(dir, { log: (line) => out.push(line), error: (line) => err.push(line) });
  return { status, out: out.join("\n"), err: err.join("\n") };
}

describe("check-examples", () => {
  test("passes valid examples, including the continuity showcase", () => {
    const result = run(examplesCopy(["kirimi-eki-no-wasuremono", "the-unraveled-thread"]));
    expect(result.err).toBe("");
    expect(result.status).toBe(0);
    expect(result.out).toContain("Examples are valid:");
    expect(result.out).toContain("kirimi-eki-no-wasuremono: ");
    expect(result.out).toContain("the-unraveled-thread:");
    expect(result.out).not.toContain("drafts");
  });

  test("fails a stale registry and a continuity showcase that drifts", () => {
    const dir = examplesCopy(["kirimi-eki-no-wasuremono", "the-unraveled-thread"]);
    fs.writeFileSync(path.join(dir, "kirimi-eki-no-wasuremono", "chapters", "_index.md"), "# Chapters\n");
    fs.rmSync(path.join(dir, "the-unraveled-thread", "chapters", "chapter-04.md"));
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.err).toContain("Example validation failed:");
    expect(result.err).toContain("kirimi-eki-no-wasuremono registry is stale: chapters/_index.md (run story reindex)");
    expect(result.err).toContain("the-unraveled-thread continuity is missing expected error");
  });

  test("fails a mentions or pacing warning that the example does not exempt", () => {
    const dir = examplesCopy(["kirimi-eki-no-wasuremono"]);
    const root = path.join(dir, "kirimi-eki-no-wasuremono");
    expect(collectAdvisory([], "kirimi-eki-no-wasuremono", root)).toEqual([]);
    fs.rmSync(path.join(root, "continuity", "exemptions.md"));
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace(/^hook: .*\n/m, ""));
    expect(collectAdvisory([], "kirimi-eki-no-wasuremono", root)).toEqual([
      "kirimi-eki-no-wasuremono mentions warning: chapters/chapter-02.md lists character morita-fumi in mentions but never names it; add the name the chapter uses as an alias, or drop the mention",
      "kirimi-eki-no-wasuremono pacing warning: chapter-01 has no hook: record how the chapter ending pulls the reader on"
    ]);
  });

  test("holds an example that keeps advisory warnings to exactly those warnings", () => {
    const root = path.join(examplesRoot, "the-unraveled-thread");
    expect(collectAdvisory([], "the-unraveled-thread", root)).toEqual([]);
    const expected = { pacing: { reason: "test", warnings: ["a warning that is gone"] } };
    expect(collectAdvisory([], "the-unraveled-thread", root, expected)).toEqual([
      "the-unraveled-thread pacing is missing expected warning: a warning that is gone",
      `the-unraveled-thread pacing has unexpected warning: ${EXPECTED_WARNINGS["the-unraveled-thread"].pacing.warnings[0]}`
    ]);
    // Every example that keeps a warning says why.
    for (const entry of Object.values(EXPECTED_WARNINGS).flatMap(Object.values)) {
      expect(entry.reason.trim()).not.toBe("");
    }
  });
});

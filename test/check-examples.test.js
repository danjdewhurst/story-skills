import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import { EXPECTED_WARNINGS, checkExamples, collectAdvisory, staleRegistries } from "../scripts/check-examples.js";

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

  test("fails an example whose mentions or pacing warning is not dismissed", () => {
    const dir = examplesCopy(["kirimi-eki-no-wasuremono"]);
    fs.rmSync(path.join(dir, "kirimi-eki-no-wasuremono", "continuity", "exemptions.md"));
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.err).toBe("Example validation failed:\nkirimi-eki-no-wasuremono mentions warning: chapters/chapter-02.md lists character morita-fumi in mentions but never names it; add the name the chapter uses as an alias, or drop the mention");
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
    // A story.md severity entry applies as in the CLI: a kept warning it
    // promotes to an error fails the check.
    const copy = path.join(examplesCopy(["the-unraveled-thread"]), "the-unraveled-thread");
    const story = path.join(copy, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace("schema-version: 2\n", "schema-version: 2\nseverity:\n  - warning: pacing-no-sequel\n    level: error\n"));
    const kept = EXPECTED_WARNINGS["the-unraveled-thread"].pacing.warnings[0];
    expect(collectAdvisory([], "the-unraveled-thread", copy)).toEqual([
      `the-unraveled-thread pacing error: ${kept}`,
      `the-unraveled-thread pacing is missing expected warning: ${kept}`
    ]);
    // Every example that keeps a warning says why.
    for (const entry of Object.values(EXPECTED_WARNINGS).flatMap(Object.values)) {
      expect(entry.reason.trim()).not.toBe("");
    }
  });
});

describe("#99 shipped examples have current registries", () => {
  test("reindex is a no-op on every example", () => {
    for (const name of fs.readdirSync(examplesRoot).sort()) {
      if (!fs.existsSync(path.join(examplesRoot, name, "story.md"))) {
        continue;
      }
      expect({ name, stale: staleRegistries(path.join(examplesRoot, name)) }).toEqual({ name, stale: [] });
    }
  });
});

// The docs say how many sample projects ship. Count the folders with a story.md
// so that adding or removing one fails here until the docs say the new number.
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

describe("the docs count the sample projects", () => {
  test("development guide and README name the number of examples", () => {
    const count = fs.readdirSync(examplesRoot).filter((name) => fs.existsSync(path.join(examplesRoot, name, "story.md"))).length;
    const docsRoot = path.resolve(import.meta.dir, "..", "docs");
    const development = fs.readFileSync(path.join(docsRoot, "development.md"), "utf8").match(/# (\w+) sample story projects/);
    const readme = fs.readFileSync(path.join(docsRoot, "README.md"), "utf8").match(/includes (\w+) sample projects in/);
    expect(development?.[1]).toBe(NUMBER_WORDS[count]);
    expect(readme?.[1]).toBe(NUMBER_WORDS[count]);
  });
});

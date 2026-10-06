#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkProjectSchema } from "./check-schema.js";
import { characterCount } from "../src/markdown.js";
import { buildBook, checkProjectContinuity, computeWordCounts, reindexProject, seriesReport, validateLinks, validateProject } from "../src/story.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(repoRoot, "examples");

// the-unraveled-thread is the showcase for `story continuity`: it must stay
// structurally valid while producing exactly these deterministic findings.
export const EXPECTED_CONTINUITY = {
  "the-unraveled-thread": {
    errors: [
      "chapters/chapter-04.md lists edran-vale, who died in chapter-02; move posthumous appearances to mentions",
      "continuity/promises/the-broken-compass.md pays off in chapter-02 before it is planted in chapter-03",
      "continuity/questions/who-burned-the-mill.md resolves in chapter-02 before it is introduced in chapter-03",
      "continuity/state.md knowledge-state[0] references missing chapter chapter-05"
    ],
    warnings: [
      "chapters/chapter-03.md POV character nessa-thorn is not listed in characters",
      "continuity/promises/the-sealed-letter.md was planted in chapter-01, 3 chapters ago, and has no payoff yet",
      "continuity/state.md object-state[0] status active conflicts with worldbuilding/artifacts/vales-compass.md status destroyed"
    ]
  }
};

// Character counts for Chinese and Japanese books split text into grapheme
// clusters with Intl.Segmenter. kirimi-eki-no-wasuremono counts plain
// Japanese prose, so CI's Node matrix also checks the edge cases directly:
// punctuation counts, whitespace (a full-width indent included) and markup
// do not, and a cluster counts once.
export const CHARACTER_COUNT_CASES = [
  ["　吾輩は猫である。名前はまだ無い。", 16],
  ["「你好，世界！」她说。", 11],
  ["**猫**と_犬_\n\n* * *\n\n[鳥](birds.md)", 4],
  ["e\u0301 👍🏽 👩‍👩‍👧 か\u3099", 4]
];

export function characterCountFailures(cases = CHARACTER_COUNT_CASES) {
  return cases
    .filter(([text, expected]) => characterCount(text) !== expected)
    .map(([text, expected]) => `characterCount(${JSON.stringify(text)}) is ${characterCount(text)}, expected ${expected}`);
}

export function collectResult(failures, exampleName, command, result) {
  for (const error of result.errors) {
    failures.push(`${exampleName} ${command} error: ${error.message}`);
  }

  for (const warning of result.warnings) {
    failures.push(`${exampleName} ${command} warning: ${warning.message}`);
  }
  return failures;
}

export function compareFindings(failures, exampleName, kind, expected, findings) {
  const actual = findings.map((finding) => finding.message);
  for (const finding of expected) {
    if (!actual.includes(finding)) {
      failures.push(`${exampleName} continuity is missing expected ${kind}: ${finding}`);
    }
  }

  for (const finding of actual) {
    if (!expected.includes(finding)) {
      failures.push(`${exampleName} continuity has unexpected ${kind}: ${finding}`);
    }
  }
  return failures;
}

// Registries the example ships out of date: reindexes a scratch copy and
// returns the project-relative paths reindex would change.
export function staleRegistries(root) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "story-examples-"));
  try {
    const copy = path.join(scratch, path.basename(root));
    fs.cpSync(root, copy, { recursive: true });
    return reindexProject(copy).changed.map((file) => path.relative(copy, file));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// Builds the example as Twine or ink source twice, outside the project, and
// returns the build warnings plus a note if the two builds differ: the IFID
// and every passage or knot must come out the same on each rebuild. The
// linear examples set no ifid, so the warning that the IFID was derived is
// expected there.
export function interactiveBuildFindings(root, format) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `story-${format}-`));
  try {
    const first = buildBook(root, { format, out: path.join(scratch, `first.${format}`) });
    const second = buildBook(root, { format, out: path.join(scratch, `second.${format}`) });
    const same = fs.readFileSync(first.outFile, "utf8") === fs.readFileSync(second.outFile, "utf8");
    const warnings = first.warnings.filter((warning) => warning.code !== "derived-ifid").map((warning) => warning.message);
    return [...warnings, ...(same ? [] : [`two ${format} builds differ`])];
  } catch (error) {
    return [error.message];
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// Checks every project under `examplesDir` and returns the exit status.
export function checkExamples(examplesDir = examplesRoot, { log = console.log, error = console.error } = {}) {
  const failures = characterCountFailures();
  const summaries = [];

  for (const name of fs.readdirSync(examplesDir).sort()) {
    const root = path.join(examplesDir, name);
    if (!fs.statSync(root).isDirectory() || !fs.existsSync(path.join(root, "story.md"))) {
      continue;
    }

    const validation = validateProject(root);
    const links = validateLinks(root);
    const continuity = checkProjectContinuity(root);
    const counts = computeWordCounts(root);
    const expected = EXPECTED_CONTINUITY[name];
    summaries.push(`${name}: ${counts.chapters.length} chapters, ${counts.total} ${counts.unit ?? "words"}, ${continuity.errors.length + continuity.warnings.length} expected continuity findings`);

    collectResult(failures, name, "validate", validation);
    collectResult(failures, name, "links", links);
    for (const error of checkProjectSchema(root)) {
      failures.push(`${name} schema error: ${error}`);
    }
    for (const format of ["twee", "ink"]) {
      for (const finding of interactiveBuildFindings(root, format)) {
        failures.push(`${name} ${format} build: ${finding}`);
      }
    }
    for (const registry of staleRegistries(root)) {
      failures.push(`${name} registry is stale: ${registry} (run story reindex)`);
    }
    // Linked examples (the-last-ember and its prequel) must agree on shared canon.
    collectResult(failures, name, "series", seriesReport(root));

    if (expected) {
      compareFindings(failures, name, "error", expected.errors, continuity.errors);
      compareFindings(failures, name, "warning", expected.warnings, continuity.warnings);
    } else {
      collectResult(failures, name, "continuity", continuity);
    }
  }

  if (failures.length > 0) {
    error(`Example validation failed:\n${failures.join("\n")}`);
    return 1;
  }

  log(`Examples are valid:\n${summaries.join("\n")}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = checkExamples();
}

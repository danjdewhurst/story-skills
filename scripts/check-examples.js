#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkProjectContinuity, computeWordCounts, validateLinks, validateProject } from "../src/story.js";

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

export function collectResult(failures, exampleName, command, result) {
  for (const error of result.errors) {
    failures.push(`${exampleName} ${command} error: ${error}`);
  }

  for (const warning of result.warnings) {
    failures.push(`${exampleName} ${command} warning: ${warning}`);
  }
  return failures;
}

export function compareFindings(failures, exampleName, kind, expected, actual) {
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

function main() {
  const failures = [];
  const summaries = [];

  for (const name of fs.readdirSync(examplesRoot).sort()) {
    const root = path.join(examplesRoot, name);
    if (!fs.statSync(root).isDirectory() || !fs.existsSync(path.join(root, "story.md"))) {
      continue;
    }

    const validation = validateProject(root);
    const links = validateLinks(root);
    const continuity = checkProjectContinuity(root);
    const counts = computeWordCounts(root);
    const expected = EXPECTED_CONTINUITY[name];
    summaries.push(`${name}: ${counts.chapters.length} chapters, ${counts.total} words, ${continuity.errors.length + continuity.warnings.length} expected continuity findings`);

    collectResult(failures, name, "validate", validation);
    collectResult(failures, name, "links", links);

    if (expected) {
      compareFindings(failures, name, "error", expected.errors, continuity.errors);
      compareFindings(failures, name, "warning", expected.warnings, continuity.warnings);
    } else {
      collectResult(failures, name, "continuity", continuity);
    }
  }

  if (failures.length > 0) {
    console.error(`Example validation failed:\n${failures.join("\n")}`);
    process.exit(1);
  }

  console.log(`Examples are valid:\n${summaries.join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

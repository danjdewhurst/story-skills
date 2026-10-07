#!/usr/bin/env node
// Balance the Windows CI shards. `bun test --shard` assigns every
// test/*.test.js file to one shard when the job starts, so a new test file
// cannot fall out of the run. This script writes the per-file timings bun
// uses to balance those shards.
//
// The workflow must not pass the file list to `bun test` itself. Doing that
// makes bun walk the repository, follow plugins/story-skills (a symlink to
// the repo root), and exit ELOOP on Windows. `bun run test -- --shard=i/n`
// keeps bun's own glob, which stays inside test/.
//
// Weights are Windows timings from issue #672. A file with no weight still
// runs. It takes the default, a few seconds, far below the timed files.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_WEIGHT_SECONDS = 5;

// Summed per-test seconds on windows-latest, from the runs cited in #672.
export const FILE_WEIGHT_SECONDS = {
  "split-merge.test.js": 80.5,
  "rename-remove.test.js": 67.9,
  "undo.test.js": 62.2,
  "validate-schema-property.test.js": 58.6,
  "story.test.js": 55.9,
  "exit-codes.test.js": 45.5,
  "draft-workflow.test.js": 34.4,
  "series.test.js": 30.5,
  "snapshot.test.js": 28.4,
  "numerals.test.js": 14.4
};

// The same set `bun test ./test/*.test.js` runs: files in this directory
// whose names end in .test.js, not a nested folder.
export function testFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
    .map((entry) => entry.name)
    .sort();
}

function weightOf(file, weights, defaultWeight) {
  if (!Object.hasOwn(weights, file)) {
    return defaultWeight;
  }
  const weight = weights[file];
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
    throw new Error(`Weight for ${file} must be a non-negative number, got ${weight}`);
  }
  return weight;
}

// Bun's --timings file. Both slash styles are written so a Windows path and
// a POSIX path find the same weight. An untimed file uses the default.
export function timingsDocument(files, weights = FILE_WEIGHT_SECONDS, defaultWeight = DEFAULT_WEIGHT_SECONDS) {
  if (typeof defaultWeight !== "number" || !Number.isFinite(defaultWeight) || defaultWeight < 0) {
    throw new Error(`default weight must be a non-negative number, got ${defaultWeight}`);
  }
  const entries = {};
  for (const file of files) {
    const milliseconds = Math.round(weightOf(file, weights, defaultWeight) * 1000);
    entries[`test/${file}`] = milliseconds;
    entries[`test\\${file}`] = milliseconds;
  }
  return { version: 1, files: entries };
}

// Problems when the timings file would leave a test file out. Empty means
// every file has both path keys.
export function timingsCoverage(files, document) {
  const problems = [];
  const keys = new Set(Object.keys(document?.files ?? {}));
  for (const file of files) {
    if (!keys.has(`test/${file}`) || !keys.has(`test\\${file}`)) {
      problems.push(`${file} is missing from the timings file`);
    }
  }
  return problems;
}

// Problems when `shards` is not a partition of `files`.
export function auditAssignment(files, shards) {
  const problems = [];
  const seen = new Map();
  shards.forEach((shardFiles, index) => {
    for (const file of shardFiles) {
      const shard = index + 1;
      if (seen.has(file)) {
        problems.push(`${file} is assigned to shard ${seen.get(file)} and shard ${shard}`);
      } else {
        seen.set(file, shard);
      }
    }
  });
  for (const file of files) {
    if (!seen.has(file)) {
      problems.push(`${file} is not assigned to a shard`);
    }
  }
  for (const file of seen.keys()) {
    if (!files.includes(file)) {
      problems.push(`${file} is assigned but is not a test file`);
    }
  }
  return problems;
}

export function parseShardArgs(argv) {
  const options = { audit: false, writeTimings: null, dir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--audit") {
      options.audit = true;
      continue;
    }
    if (arg !== "--write-timings" && arg !== "--dir") {
      throw new Error(`Unknown argument ${arg}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${arg} needs a value`);
    }
    index += 1;
    if (arg === "--dir") {
      options.dir = value;
    } else {
      options.writeTimings = value;
    }
  }
  if (!options.audit && options.writeTimings === null) {
    throw new Error("Pass --write-timings, or --audit");
  }
  return options;
}

export function main(argv, { log = console.log, error = console.error, testDir = path.join(repoRoot, "test") } = {}) {
  let options;
  try {
    options = parseShardArgs(argv);
  } catch (problem) {
    error(problem.message);
    return 1;
  }
  const dir = options.dir ?? testDir;
  let document;
  try {
    document = timingsDocument(testFiles(dir));
  } catch (problem) {
    error(problem.message);
    return 1;
  }
  const files = testFiles(dir);
  const problems = timingsCoverage(files, document);
  if (problems.length > 0) {
    error(problems.join("\n"));
    return 1;
  }
  if (options.writeTimings) {
    fs.mkdirSync(path.dirname(path.resolve(options.writeTimings)), { recursive: true });
    fs.writeFileSync(options.writeTimings, `${JSON.stringify(document)}\n`);
    log(`Wrote timings for ${files.length} test files to ${options.writeTimings}`);
  }
  if (options.audit) {
    log(`All ${files.length} test files are in the Windows shard timings.`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}

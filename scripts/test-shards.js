#!/usr/bin/env node
// Split test/*.test.js across the Windows CI shards. The workflow does not
// list files: every file in the directory is assigned to exactly one shard
// when the job starts, so a new test file cannot fall out of the run.
//
// Weights are Windows timings from issue #672, used only to balance the
// shards. A file with no weight still runs. It takes the default, a few
// seconds, which is far below the timed files, so those land on different
// shards and the rest fill the gaps.
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

// Heavier files are placed first, each onto the lightest shard. Equal loads
// keep the lower shard index, and equal weights break ties by file name, so
// the same directory always produces the same plan.
export function shardPlan(files, shardCount, weights = FILE_WEIGHT_SECONDS, defaultWeight = DEFAULT_WEIGHT_SECONDS) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`shard count must be a positive integer, got ${shardCount}`);
  }
  if (typeof defaultWeight !== "number" || !Number.isFinite(defaultWeight) || defaultWeight < 0) {
    throw new Error(`default weight must be a non-negative number, got ${defaultWeight}`);
  }
  const items = files.map((file) => ({ file, weight: weightOf(file, weights, defaultWeight) }));
  items.sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const shards = Array.from({ length: shardCount }, () => ({ weight: 0, files: [] }));
  for (const item of items) {
    let lightest = 0;
    for (let index = 1; index < shards.length; index += 1) {
      if (shards[index].weight < shards[lightest].weight) {
        lightest = index;
      }
    }
    shards[lightest].weight += item.weight;
    shards[lightest].files.push(item.file);
  }
  for (const shard of shards) {
    shard.files.sort();
  }
  return shards;
}

export function filesForShard(plan, shard) {
  if (!Number.isInteger(shard) || shard < 1 || shard > plan.length) {
    throw new Error(`shard must be an integer from 1 to ${plan.length}, got ${shard}`);
  }
  return plan[shard - 1].files;
}

// Problems when `shards` is not a partition of `files`. Empty means every
// file is in exactly one shard and nothing else was assigned.
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
  const options = { shard: null, shards: null, audit: false, dir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--audit") {
      options.audit = true;
      continue;
    }
    if (arg !== "--shard" && arg !== "--shards" && arg !== "--dir") {
      throw new Error(`Unknown argument ${arg}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${arg} needs a value`);
    }
    index += 1;
    if (arg === "--dir") {
      options.dir = value;
      continue;
    }
    const number = Number(value);
    if (!Number.isInteger(number)) {
      throw new Error(`${arg} must be an integer, got ${value}`);
    }
    options[arg.slice(2)] = number;
  }
  if (options.shards === null) {
    throw new Error("--shards is required");
  }
  if (!options.audit && options.shard === null) {
    throw new Error("--shard is required unless --audit is set");
  }
  return options;
}

// Paths bun test can open from the repo root, with forward slashes on Windows.
function listedPath(dir, file) {
  return path.relative(path.resolve(dir, ".."), path.join(dir, file)).split(path.sep).join("/");
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
  let plan;
  try {
    plan = shardPlan(testFiles(dir), options.shards);
  } catch (problem) {
    error(problem.message);
    return 1;
  }
  const directoryFiles = testFiles(dir);
  const problems = auditAssignment(directoryFiles, plan.map((shard) => shard.files));
  if (problems.length > 0) {
    error(problems.join("\n"));
    return 1;
  }
  if (options.audit) {
    log(`All ${directoryFiles.length} test files are assigned across ${options.shards} shards.`);
    return 0;
  }
  let shardFiles;
  try {
    shardFiles = filesForShard(plan, options.shard);
  } catch (problem) {
    error(problem.message);
    return 1;
  }
  if (shardFiles.length === 0) {
    error(`Shard ${options.shard} of ${options.shards} has no test files.`);
    return 1;
  }
  log(shardFiles.map((file) => listedPath(dir, file)).join("\n"));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}

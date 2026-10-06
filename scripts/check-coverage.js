#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Line and function counts per source file. Bun's lcov reporter writes no
// branch records (BRDA, BRF, BRH), so branches are not read or gated: an
// untaken `??`, `||`, or ternary arm on a line that ran counts as covered.
export function parseLcov(source) {
  const records = new Map();
  let current = null;

  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      current = {
        file: path.resolve(line.slice(3)),
        lines: { found: 0, hit: 0 },
        functions: { found: 0, hit: 0 }
      };
      records.set(current.file, current);
    } else if (!current) {
      continue;
    } else if (line.startsWith("LF:")) {
      current.lines.found = Number(line.slice(3));
    } else if (line.startsWith("LH:")) {
      current.lines.hit = Number(line.slice(3));
    } else if (line.startsWith("FNF:")) {
      current.functions.found = Number(line.slice(4));
    } else if (line.startsWith("FNH:")) {
      current.functions.hit = Number(line.slice(4));
    }
  }

  return records;
}

export function checkCoverage(lcovText, absoluteSourceFiles) {
  const records = parseLcov(lcovText);
  const failures = [];

  for (const filePath of absoluteSourceFiles) {
    const record = records.get(filePath);
    if (!record) {
      failures.push(`${filePath} has no coverage record`);
      continue;
    }

    if (record.lines.found !== record.lines.hit) {
      failures.push(`${filePath} line coverage ${record.lines.hit}/${record.lines.found}`);
    }

    if (record.functions.found !== record.functions.hit) {
      failures.push(`${filePath} function coverage ${record.functions.hit}/${record.functions.found}`);
    }
  }

  return { failures, filesChecked: absoluteSourceFiles.length };
}

// Every .js file under `dir`, subfolders (src/languages) included.
export function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

// Each file needs a coverage record and at least `minPercent` of its lines
// hit. Used for scripts/ and evals/, whose CLI entry points and model or
// network calls are not all reachable from a test.
export function checkLineThreshold(lcovText, absoluteSourceFiles, minPercent) {
  const records = parseLcov(lcovText);
  const failures = [];
  for (const filePath of absoluteSourceFiles) {
    const record = records.get(filePath);
    if (!record) {
      failures.push(`${filePath} has no coverage record`);
      continue;
    }
    const { found, hit } = record.lines;
    const percent = found === 0 ? 100 : (hit / found) * 100;
    if (percent < minPercent) {
      failures.push(`${filePath} line coverage ${percent.toFixed(1)}% (${hit}/${found}) is below ${minPercent}%`);
    }
  }
  return { failures, filesChecked: absoluteSourceFiles.length };
}

// `src` gates a folder's lines and functions at 100%; `scripts:85` gates each
// file's lines at 85%.
// A colon followed by no path separator is a threshold, so `scripts:abc` is
// refused while a Windows path such as `C:\repo\src` stays a folder.
export function parseGate(arg) {
  const match = /^(.+):([^:\\/]*)$/.exec(arg);
  if (!match) {
    return { dir: arg, minPercent: null };
  }
  const [, dir, threshold] = match;
  if (!/^\d+(?:\.\d+)?$/.test(threshold) || Number(threshold) > 100) {
    throw new Error(`Coverage threshold for ${dir} must be a number from 0 to 100, got "${threshold}"`);
  }
  return { dir, minPercent: Number(threshold) };
}

export const USAGE = "Usage: check-coverage <lcov.info> <dir>[:<min-line-percent>] ...";

export function main(argv, { log = console.log, error = console.error } = {}) {
  const [lcovPath, ...gateArgs] = argv;
  if (!lcovPath || gateArgs.length === 0) {
    error(USAGE);
    return 1;
  }

  let gates;
  try {
    gates = gateArgs.map(parseGate);
  } catch (problem) {
    error(problem.message);
    return 1;
  }
  const missingDir = gates.find((gate) => !fs.statSync(gate.dir, { throwIfNoEntry: false })?.isDirectory());
  if (missingDir) {
    error(`Coverage folder ${missingDir.dir} does not exist`);
    return 1;
  }

  const lcov = fs.readFileSync(lcovPath, "utf8");
  const full = gates.filter((gate) => gate.minPercent === null);
  const partial = gates.filter((gate) => gate.minPercent !== null);
  const failures = [];

  for (const gate of full) {
    failures.push(...checkCoverage(lcov, sourceFiles(path.resolve(gate.dir))).failures);
  }
  for (const gate of partial) {
    failures.push(...checkLineThreshold(lcov, sourceFiles(path.resolve(gate.dir)), gate.minPercent).failures);
  }

  if (failures.length > 0) {
    error(`Coverage is below the gate:\n${failures.join("\n")}`);
    return 1;
  }

  if (full.length > 0) {
    const dirs = full.map((gate) => gate.dir).join(", ");
    log(`Coverage is 100% for ${dirs} line and function coverage; branch coverage is not gated.`);
  }
  for (const gate of partial) {
    log(`Line coverage is at least ${gate.minPercent}% for every file in ${gate.dir}.`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}


#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function parseLcov(source) {
  const records = new Map();
  let current = null;

  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      current = {
        file: path.resolve(line.slice(3)),
        lines: { found: 0, hit: 0 },
        functions: { found: 0, hit: 0 },
        branches: { found: 0, hit: 0 },
        hasBranchData: false
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
    } else if (line.startsWith("BRDA:")) {
      // BRDA:<line>,<block>,<branch>,<taken> where <taken> is "-" when the
      // branch was never taken. Count branches directly so reports that omit
      // the BRF:/BRH: summaries are still gated.
      current.hasBranchData = true;
      current.branches.found += 1;
      const taken = line.slice(5).split(",")[3];
      if (taken !== undefined && taken !== "-" && Number(taken) > 0) {
        current.branches.hit += 1;
      }
    } else if (line.startsWith("BRF:")) {
      // Summary lines are authoritative when present and come after the BRDA
      // lines, so they overwrite the derived counts above.
      current.hasBranchData = true;
      current.branches.found = Number(line.slice(4));
    } else if (line.startsWith("BRH:")) {
      current.branches.hit = Number(line.slice(4));
    }
  }

  return records;
}

export function checkCoverage(lcovText, absoluteSourceFiles) {
  const records = parseLcov(lcovText);
  const failures = [];
  let filesWithBranches = 0;

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

    if (record.hasBranchData) {
      filesWithBranches += 1;
      if (record.branches.found !== record.branches.hit) {
        failures.push(`${filePath} branch coverage ${record.branches.hit}/${record.branches.found}`);
      }
    }
  }

  return { failures, filesWithBranches, filesChecked: absoluteSourceFiles.length };
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

// `src` gates a folder at 100%; `scripts:85` gates each file's lines at 85%.
export function parseGate(arg) {
  const match = /^(.+):(\d+(?:\.\d+)?)$/.exec(arg);
  if (!match) {
    return { dir: arg, minPercent: null };
  }
  const minPercent = Number(match[2]);
  if (minPercent > 100) {
    throw new Error(`Coverage threshold for ${match[1]} must be at most 100, got ${match[2]}`);
  }
  return { dir: match[1], minPercent };
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

  const lcov = fs.readFileSync(lcovPath, "utf8");
  const full = gates.filter((gate) => gate.minPercent === null);
  const partial = gates.filter((gate) => gate.minPercent !== null);
  const failures = [];
  let filesWithBranches = 0;

  for (const gate of full) {
    const result = checkCoverage(lcov, sourceFiles(path.resolve(gate.dir)));
    failures.push(...result.failures);
    filesWithBranches += result.filesWithBranches;
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
    if (filesWithBranches > 0) {
      log(`Coverage is 100% for ${dirs} line, function, branch coverage.`);
    } else {
      error(
        `Note: ${lcovPath} contains no branch records, so the branch gate was skipped. ` +
        "Use a coverage reporter that emits BRDA/BRF/BRH records to enforce branch coverage."
      );
      log(`Coverage is 100% for ${dirs} line and function coverage.`);
    }
  }
  for (const gate of partial) {
    log(`Line coverage is at least ${gate.minPercent}% for every file in ${gate.dir}.`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}


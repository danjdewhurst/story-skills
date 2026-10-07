import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir, writeMarkdown } from "./helpers.js";
import { createStoryProject } from "../src/story.js";
import { checkCoverage, parseLcov, sourceFiles } from "../scripts/check-coverage.js";
import { collectResult, compareFindings } from "../scripts/check-examples.js";
import { anchorsFor, checkLinks, extractLinks, headingText, isSkipped, maskCode, repoPath, slugify } from "../scripts/check-links.js";
import { docVersionFiles } from "../scripts/doc-versions.js";
import { checkDocBunPin, checkDocVersions, checkMarketplaces, checkPluginManifests, checkSkillFrontmatter, checkTemplateStoryVersion, checkVersionModule, checkWorkflowBunPin, expectEqual, readWorkflows, repositoryUrl } from "../scripts/check-metadata.js";
import { bunPinFailure, localBunVersion, parsePinnedBunVersion, readPinnedBunVersion } from "../scripts/bun-pin.js";
import { checkFixtureOverlaps, checkFixtureSkill } from "../scripts/check-evals.js";
import { MISSING_BUN_MESSAGE, missingBunMessage } from "../scripts/bun-missing.js";
import { PREFLIGHT } from "../scripts/release.js";
import { CI_WAIT } from "../scripts/publish-gate.js";
import { packageFiles, relativeLinks, unshippedLinks } from "../scripts/check-package.js";
import { spawnSync } from "node:child_process";
import { fillTemplate } from "../evals/run-evals.js";
import { buildJudgePrompt, parseArgs as parseRunSkillArgs, selectFixtures } from "../evals/run-skill.js";

const repoRoot = path.resolve(import.meta.dir, "..");

function readRepo(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

// The repo ships zero dependencies, so workflow files are checked with a
// dependency-free structural parse (top-level key extraction plus `uses:`
// reference validation) rather than a full YAML parser.
function topLevelKeys(text) {
  const keys = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):(\s|$)/.exec(line);
    if (match) {
      keys.push(match[1]);
    }
  }
  return keys;
}

function usesRefs(text) {
  const refs = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*uses:\s*(\S+)\s*(#\s*(.+))?$/.exec(line);
    if (match) {
      refs.push({ ref: match[1], comment: (match[3] || "").trim(), line: line.trim() });
    }
  }
  return refs;
}

// Each job's lines, keyed by job id, from a workflow's `jobs:` block. A
// comment or blank line at column 0 does not end the block, and a job id may
// carry a trailing comment.
function workflowJobs(text) {
  const jobs = {};
  const start = /^jobs:[ \t]*(?:#.*)?$/m.exec(text);
  if (!start) {
    return jobs;
  }
  let current = null;
  for (const line of text.slice(start.index + start[0].length).split(/\r?\n/)) {
    const id = /^ {2}([\w-]+):[ \t]*(?:#.*)?$/.exec(line);
    if (id) {
      current = id[1];
      jobs[current] = "";
    } else if (/^#/.test(line)) {
      continue;
    } else if (/^\S/.test(line)) {
      break;
    } else if (current) {
      jobs[current] += `${line}\n`;
    }
  }
  return jobs;
}

// The jobs a job names in `needs:`, as one id, a flow list, or a block list.
function directNeeds(job = "") {
  const inline = /^ {4}needs:[ \t]*(?:\[([^\]]*)\]|([^\s#]+))[ \t]*(?:#.*)?$/m.exec(job);
  if (inline) {
    return (inline[1] ?? inline[2]).split(",").map((need) => need.trim()).filter(Boolean);
  }
  const block = /^ {4}needs:[ \t]*(?:#.*)?\n((?: {6}- .*(?:\n|$))+)/m.exec(job);
  return block ? block[1].trim().split("\n").map((line) => line.replace(/^\s*- /, "").replace(/\s+#.*$/, "").trim()) : [];
}

// Every job a job waits for, directly or through the jobs it needs.
function allNeeds(jobs, id) {
  return [...new Set(directNeeds(jobs[id]).flatMap((need) => [need, ...allNeeds(jobs, need)]))].sort();
}

// A job's `timeout-minutes`, or null when it sets none (or 0, or an
// expression this check cannot read).
function jobTimeout(job = "") {
  const match = /^ {4}timeout-minutes:[ \t]*([1-9]\d*)[ \t]*(?:#.*)?$/m.exec(job);
  return match ? Number(match[1]) : null;
}

// The jobs in a workflow with no timeout, or with one over maxMinutes. A job
// that calls a reusable workflow cannot set one; the called workflow's jobs do.
function timeoutProblems(text, maxMinutes = Infinity) {
  const problems = [];
  for (const [id, job] of Object.entries(workflowJobs(text))) {
    const minutes = jobTimeout(job);
    if (/^ {4}uses:/m.test(job)) {
      continue;
    } else if (minutes === null) {
      problems.push(`${id} has no timeout-minutes`);
    } else if (minutes > maxMinutes) {
      problems.push(`${id} has timeout-minutes: ${minutes}, over ${maxMinutes}`);
    }
  }
  return problems;
}

// The most minutes a job can end after its workflow starts: its own timeout
// plus the longest chain of jobs it waits for. No timeout counts as Infinity.
function longestRunMinutes(jobs, id, seen = []) {
  if (seen.includes(id)) {
    return Infinity;
  }
  const waits = directNeeds(jobs[id]).map((need) => longestRunMinutes(jobs, need, [...seen, id]));
  return (jobTimeout(jobs[id]) ?? Infinity) + Math.max(0, ...waits);
}

// Each step's `run:` script in a job, inline or as a block scalar.
function runScripts(job = "") {
  const scripts = [];
  const lines = job.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*(?:- )?)run:[ \t]*(.*)$/.exec(lines[index]);
    if (!match) {
      continue;
    }
    const [, key, value] = match;
    if (/^[|>][+-]?\d*[ \t]*(?:#.*)?$/.test(value)) {
      const body = [];
      while (index + 1 < lines.length && (!lines[index + 1].trim() || lines[index + 1].search(/\S/) > key.length)) {
        index += 1;
        body.push(lines[index]);
      }
      scripts.push(body.join(value.startsWith(">") ? " " : "\n"));
    } else {
      scripts.push(value.replace(/^(["'])(.*)\1$/, "$2"));
    }
  }
  return scripts;
}

// How many commands in a job's steps run the whole test suite:
// `bun run test`, `bun run test:coverage`, `npm test`, or a `bun test` that
// names no single test file and no test-name filter.
function suiteRuns(job) {
  let runs = 0;
  for (const script of runScripts(job)) {
    const code = script.split("\n").map((line) => line.replace(/(^|\s)#.*$/, "")).join("\n");
    for (const part of code.split(/&&|\|\||[;|&\n]/)) {
      const command = part.trim().replace(/^(?:(?:do|then|else|time|exec)\s+|\w+=\S*\s+)+/, "");
      if (/^(?:(?:bun|npm|pnpm|yarn)\s+run\s+test(?::coverage)?|(?:npm|pnpm|yarn)\s+test)(?:\s|$)/.test(command)) {
        runs += 1;
      } else if (/^bun\s+test(?:\s|$)/.test(command) && !/(?:^|\s)(?:-t|--test-name-pattern)(?:\s|=)|(?:^|\s)[^\s*]+\.test\.[cm]?[jt]sx?(?=\s|$)/.test(command)) {
        runs += 1;
      }
    }
  }
  return runs;
}

// What would let publish.yml reach npm around the gate, one line per problem.
// Comments are ignored, so only what a job runs counts.
function publishGateProblems(text) {
  const jobs = workflowJobs(text);
  const code = (job = "") => job.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
  const problems = [];
  // Any package publish, however it is written, belongs to the npm job alone.
  for (const [id, job] of Object.entries(jobs)) {
    if (id !== "publish" && /\b(?:npm|pnpm|yarn|bun)\s+publish\b/.test(code(job))) {
      problems.push(`${id} runs a package publish`);
    }
  }
  if (!/\bnpm\s+publish\b/.test(code(jobs.publish))) {
    problems.push("publish does not run npm publish");
  }
  // npm runs only behind both gate jobs, and nothing on the way may run past
  // a failure: no always(), cancelled(), or failure() condition, and no
  // continue-on-error, in publish or any job it needs.
  const npmPath = jobs.publish ? ["publish", ...allNeeds(jobs, "publish")] : [];
  for (const gate of ["verify", "ci"]) {
    if (!npmPath.includes(gate)) {
      problems.push(`publish does not need ${gate}`);
    }
  }
  for (const id of npmPath) {
    for (const line of code(jobs[id]).split("\n")) {
      if (/\b(?:always|cancelled|failure)\(\)|continue-on-error:/.test(line)) {
        problems.push(`${id} has ${line.trim()}`);
      }
    }
  }
  // The gate jobs run the workflow's own commit; every other checkout builds
  // the commit verify checked.
  for (const [id, job] of Object.entries(jobs)) {
    for (const step of code(job).split(/^ {6}- /m).filter((step) => /uses: actions\/checkout@/.test(step))) {
      const ref = /^\s+ref: (.*)$/m.exec(step)?.[1];
      if (id === "verify" || id === "ci") {
        if (ref) {
          problems.push(`${id} checks out ${ref}, not the workflow's own commit`);
        }
      } else if (ref !== "${{ needs.verify.outputs.sha }}") {
        problems.push(`${id} checks out ${ref ?? "the run's ref"}, not the verified commit`);
      }
    }
  }
  return problems;
}

// Lists each action that more than one SHA pins across the given files, so a
// bump that reaches ci.yml but not another workflow or a template is caught.
function actionPinConflicts(files) {
  const shas = new Map();
  for (const [relativePath, text] of Object.entries(files)) {
    for (const { ref } of usesRefs(text)) {
      const [action, sha] = ref.split("@");
      const bySha = shas.get(action) || new Map();
      bySha.set(sha, [...(bySha.get(sha) || []), relativePath]);
      shas.set(action, bySha);
    }
  }
  return [...shas]
    .filter(([, bySha]) => bySha.size > 1)
    .map(([action, bySha]) => `${action}: ${[...bySha].map(([sha, paths]) => `${sha} (${[...new Set(paths)].join(", ")})`).join(", ")}`);
}

function lcovRecord(file, { lines = [10, 10], functions = [2, 2], branches = null } = {}) {
  let text = `TN:\nSF:${file}\nFNF:${functions[0]}\nFNH:${functions[1]}\n`;
  for (let index = 0; index < lines[0]; index += 1) {
    text += `DA:${index + 1},${index < lines[1] ? 1 : 0}\n`;
  }
  if (branches) {
    for (const taken of branches) {
      text += `BRDA:1,0,0,${taken}\n`;
    }
    const hit = branches.filter((taken) => taken !== "-").length;
    text += `BRF:${branches.length}\nBRH:${hit}\n`;
  }
  return `${text}LF:${lines[0]}\nLH:${lines[1]}\nend_of_record\n`;
}

// A bare `localeCompare` resolves against the host default locale, so registry,
// backlink, and report order can differ between machines and differ again on a
// `small-icu` Node build. Every runtime call site pins `"en"` or passes a
// language pack's `pack.locale` (src/languages/locale.js); the scan below is
// a dependency-free source check that keeps a new one from drifting back.
const LOCALE_ARGUMENT = /^(?:(["'])[a-z]{2}(-[A-Za-z0-9]+)*\1|pack\.locale)$/;

// Each entry pairs a call shape with the argument index that must hold a locale.
const LOCALE_CALLS = [
  { pattern: /\.localeCompare\s*\(/g, localeIndex: 1 },
  { pattern: /\.toLocale(?:Upper|Lower)Case\s*\(/g, localeIndex: 0 },
  { pattern: /\.toLocale(?:String|DateString|TimeString)\s*\(/g, localeIndex: 0 },
  { pattern: /\bnew Intl\.[A-Za-z]+\s*\(/g, localeIndex: 0 }
];

function runtimeSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".js")) {
        files.push(full);
      }
    }
  };
  for (const dir of ["src", "scripts", "bin"]) {
    walk(path.join(repoRoot, dir));
  }
  return files;
}

// Splits the argument list opening at `open` (the index of its `(`), keeping
// nested calls, literals, and strings intact so a comma inside one is not read
// as an argument separator. Returns null for an unbalanced call.
function callArguments(text, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  let quote = null;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
    } else if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        const last = text.slice(start, index).trim();
        if (last !== "" || args.length > 0) {
          args.push(last);
        }
        return args;
      }
    } else if (char === "," && depth === 1) {
      args.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  return null;
}

function localeCallSites(text) {
  const sites = [];
  for (const { pattern, localeIndex } of LOCALE_CALLS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      const args = callArguments(text, pattern.lastIndex - 1);
      const locale = args === null ? undefined : args[localeIndex];
      sites.push({
        call: match[0],
        line: text.slice(0, match.index).split("\n").length,
        pinned: locale !== undefined && LOCALE_ARGUMENT.test(locale)
      });
      match = pattern.exec(text);
    }
  }
  return sites;
}

// The `with:` block directly under each actions/checkout step.
function checkoutBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  lines.forEach((line, index) => {
    if (!/uses: actions\/checkout@/.test(line)) return;
    const indent = line.search(/\S/);
    const block = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const current = lines[next];
      if (current.trim() === "" || current.search(/\S/) < indent) break;
      if (current.search(/\S/) === indent && !current.trim().startsWith("with:")) break;
      block.push(current.trim());
    }
    blocks.push(block);
  });
  return blocks;
}

// The shell body of the review-copy "Look for chapters" step.
function chapterGuardScript() {
  const text = readRepo("templates/github/review-copy.yml");
  const match = /- name: Look for chapters\n(?:.*\n)*? {8}run: \|\n((?: {10}.*\n)+)/.exec(text);
  expect(match).not.toBeNull();
  return match[1].replace(/^ {10}/gm, "");
}

describe("release preflight", () => {
  test("gates on test:coverage", () => {
    expect(PREFLIGHT).toContain("test:coverage");
    expect(PREFLIGHT).toContain("check:metadata");
    expect(PREFLIGHT).toContain("check:evals");
    expect(PREFLIGHT).toContain("test:examples");
  });
});

// Emptying PATH is what hides bun from the script under test, but it also hides
// a bare `node`, so the runtime has to be resolved to an absolute path first.
function resolveOnPath(command) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = dir && path.join(dir, command);
    try {
      if (candidate && fs.statSync(candidate).isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      // Not this directory; keep looking.
    }
  }
  return null;
}

// package.json defines check:fallback as `node scripts/check-fallback.js`, so
// node is the runtime worth measuring; under `bun test` process.execPath is bun,
// which would miss a node-only regression. Falls back to the current runtime
// where node is not installed.
function nodeRuntime() {
  return resolveOnPath("node") || process.execPath;
}

describe("missing bun", () => {
  test("reports only a failed spawn of a missing binary", () => {
    expect(missingBunMessage({ code: "ENOENT", syscall: "spawnSync bun" })).toBe(MISSING_BUN_MESSAGE);
    expect(MISSING_BUN_MESSAGE).toContain("https://bun.sh");
    expect(missingBunMessage({ code: "EACCES" })).toBeNull();
    expect(missingBunMessage(undefined)).toBeNull();
  });

  test("check-fallback names the missing binary instead of crashing on null output", () => {
    // AGENTS.md and docs/development.md both send contributors to
    // `bun run check:fallback`, so a contributor without Bun must get the
    // install hint, not a TypeError about the stream chunk spawnSync never wrote.
    const runtime = nodeRuntime();
    const res = spawnSync(runtime, [path.join(repoRoot, "scripts", "check-fallback.js")], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: makeTempDir("story-empty-path-") }
    });
    // The Bun pin check runs first, so a missing Bun gets its install hint.
    expect(res.status, runtime).toBe(1);
    expect(res.stderr, runtime).toContain("`bun --version` did not run here");
    expect(res.stderr, runtime).toContain("https://bun.sh/install");
    // The crash this replaced raised ERR_INVALID_ARG_TYPE under node and
    // ERR_STREAM_NULL_VALUES under bun; both print a TypeError, so asserting on
    // the shared word catches the regression under either runtime.
    expect(res.stderr, runtime).not.toContain("TypeError");
  });
});

describe("check-coverage", () => {
  test("gates source files in subfolders such as src/languages", () => {
    const files = sourceFiles(path.resolve(import.meta.dir, "..", "src"));
    expect(files).toContain(path.resolve(import.meta.dir, "..", "src", "languages", "en.js"));
    expect(files).toContain(path.resolve(import.meta.dir, "..", "src", "story.js"));
    expect(files.every((file) => file.endsWith(".js"))).toBe(true);
  });

  test("passes full line and function coverage", () => {
    const file = path.join(repoRoot, "src", "a.js");
    expect(checkCoverage(lcovRecord(file), [file])).toEqual({ failures: [], filesChecked: 1 });
  });

  // #570: Bun writes no branch records, so a branch gate never ran while the
  // summary could still claim one. Branches are not read at all now.
  test("reads and gates only lines and functions, never branch records (#570)", () => {
    const file = path.join(repoRoot, "src", "a.js");
    const lcov = lcovRecord(file, { branches: ["1", "-"] });
    expect(parseLcov(lcov).get(file)).toEqual({ file, lines: { found: 10, hit: 10 }, functions: { found: 2, hit: 2 } });
    expect(checkCoverage(lcov, [file])).toEqual({ failures: [], filesChecked: 1 });
  });

  test("still gates lines, functions, and missing records", () => {
    const covered = path.join(repoRoot, "src", "a.js");
    const missing = path.join(repoRoot, "src", "missing.js");
    const lcov = lcovRecord(covered, { lines: [4, 3], functions: [2, 1] });
    const { failures } = checkCoverage(lcov, [covered, missing]);
    expect(failures).toEqual([
      `${covered} line coverage 3/4`,
      `${covered} function coverage 1/2`,
      `${missing} has no coverage record`
    ]);
  });
});

describe("checkSkillFrontmatter", () => {
  function skillDir() {
    const dir = makeTempDir("story-skills-frontmatter-");
    const write = (name, frontmatter) => {
      fs.mkdirSync(path.join(dir, name), { recursive: true });
      fs.writeFileSync(path.join(dir, name, "SKILL.md"), `---\n${frontmatter}\n---\n\n# Skill\n`, "utf8");
    };
    write("good-skill", "name: good-skill\ndescription: Does good things.");
    return { dir, write };
  }

  test("accepts a well-formed skill", () => {
    const { dir } = skillDir();
    expect(checkSkillFrontmatter([], dir, (filePath) => fs.readFileSync(filePath, "utf8"))).toEqual([]);
  });

  test("flags a missing SKILL.md, a wrong name field, and a missing description", () => {
    const { dir, write } = skillDir();
    fs.mkdirSync(path.join(dir, "no-file"));
    write("bad-name", "name: other-name\ndescription: Mismatched name.");
    write("no-desc", "name: no-desc");
    const failures = checkSkillFrontmatter([], dir, (filePath) => fs.readFileSync(filePath, "utf8"));
    expect(failures.join("\n")).toContain("skills/no-file is missing SKILL.md");
    expect(failures.join("\n")).toContain("skills/bad-name/SKILL.md name");
    expect(failures.join("\n")).toContain("skills/no-desc/SKILL.md is missing description");
  });
});

describe("bun pin", () => {
  test("parses only an exact bun pin", () => {
    expect(parsePinnedBunVersion("bun@1.4.2")).toBe("1.4.2");
    expect(parsePinnedBunVersion("  bun@1.4.2  ")).toBe("1.4.2");
    expect(parsePinnedBunVersion("bun@^1.4.2")).toBe(null);
    expect(parsePinnedBunVersion("bun@1.4")).toBe(null);
    expect(parsePinnedBunVersion("pnpm@9.0.0")).toBe(null);
    expect(parsePinnedBunVersion(undefined)).toBe(null);
  });

  test("localBunVersion reports the running bun and tolerates a missing one", () => {
    expect(localBunVersion()).toBe(Bun.version);
    expect(localBunVersion(() => ({ status: 1, stdout: "" }))).toBe(null);
    expect(localBunVersion(() => ({ status: 0, stdout: "  \n" }))).toBe(null);
    expect(localBunVersion(() => null)).toBe(null);
  });

  test("bunPinFailure explains drift instead of blaming the bundle", () => {
    expect(bunPinFailure("1.4.2", "1.4.2")).toBe(null);
    expect(bunPinFailure(null, "1.4.2")).toContain("must pin an exact Bun version");
    expect(bunPinFailure("1.4.2", null)).toContain("bun-v1.4.2");
    const drift = bunPinFailure("1.4.2", "1.3.14");
    expect(drift).toContain("this machine runs Bun 1.3.14");
    expect(drift).toContain('set packageManager to "bun@1.3.14"');
    // The point of the message: drift must not read as a stale bundle.
    expect(drift).not.toContain("out of date");
  });

  test("the repository pin matches the bun that built the committed fallback", () => {
    expect(readPinnedBunVersion()).toBe(parsePinnedBunVersion(JSON.parse(readRepo("package.json")).packageManager));
    expect(readPinnedBunVersion()).not.toBe(null);
  });

  // The fake bun is a shell script, which Windows cannot run from PATH.
  test.skipIf(process.platform === "win32")("check:fallback refuses to compare bytes under an unpinned bun", () => {
    // A fake `bun` earlier on PATH stands in for a contributor on another release.
    const fakeBin = makeTempDir("story-fake-bun-");
    fs.writeFileSync(path.join(fakeBin, "bun"), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 9.9.9; exit 0; fi\nexit 1\n', "utf8");
    fs.chmodSync(path.join(fakeBin, "bun"), 0o755);
    const res = spawnSync("node", [path.join(repoRoot, "scripts", "check-fallback.js")], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` }
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("this machine runs Bun 9.9.9");
    expect(res.stderr).not.toContain("out of date");
  });
});

describe("check-metadata bun pin", () => {
  test("every workflow installs the pinned bun", () => {
    const packageJson = JSON.parse(readRepo("package.json"));
    const workflows = readWorkflows(repoRoot);
    expect(Object.keys(workflows)).toEqual(expect.arrayContaining(["ci.yml", "publish.yml"]));
    expect(checkWorkflowBunPin([], packageJson.packageManager, workflows)).toEqual([]);
  });

  test("the development guide names the pinned bun", () => {
    const packageJson = JSON.parse(readRepo("package.json"));
    expect(checkDocBunPin([], packageJson.packageManager, readRepo("docs/development.md"))).toEqual([]);
    expect(readRepo("docs/development.md")).toContain(`bun-v${parsePinnedBunVersion(packageJson.packageManager)}`);
  });

  test("flags a development guide that names another bun", () => {
    expect(checkDocBunPin([], "bun@1.4.2", "pins `bun@1.3.14` and also `bun@1.3.14`\n")).toEqual([
      "docs/development.md bun pin mismatch: expected 1.4.2, got 1.3.14"
    ]);
    expect(checkDocBunPin([], "bun@1.4.2", "no pin here\n")).toEqual([
      "docs/development.md must name the pinned Bun version as `bun@1.4.2`"
    ]);
    // An unparseable pin is reported once by checkWorkflowBunPin, not twice.
    expect(checkDocBunPin([], "bun@latest", "no pin here\n")).toEqual([]);
  });

  test("flags a ci bun-version that drifts from packageManager", () => {
    expect(checkWorkflowBunPin([], "bun@1.4.2", { "ci.yml": "          bun-version: 1.3.14\n" })).toEqual([
      ".github/workflows/ci.yml:1 bun-version mismatch: expected 1.4.2, got 1.3.14"
    ]);
    expect(checkWorkflowBunPin([], "bun@1.4.2", { "ci.yml": "name: CI\n" })).toEqual([".github/workflows/ci.yml is missing bun-version"]);
    expect(checkWorkflowBunPin([], "bun@^1.4.2", { "ci.yml": "          bun-version: 1.4.2\n" })).toEqual([
      'package.json packageManager must pin an exact Bun version, got "bun@^1.4.2"'
    ]);
  });

  // #570: only the first bun-version in ci.yml was read, so a later job or
  // publish.yml, which builds the release binaries, could drift unnoticed.
  test("checks every bun-version in every workflow (#570)", () => {
    const setup = (version) => `      - uses: oven-sh/setup-bun@abc # v2\n        with:\n          bun-version: ${version}\n`;
    const workflows = {
      "ci.yml": `jobs:\n${setup("1.4.2")}${setup("1.3.0")}${setup("1.4.2")}`,
      "codeql.yml": "jobs:\n  analyze:\n    runs-on: ubuntu-latest\n",
      "publish.yml": `jobs:\n${setup("1.3.0")}`
    };
    expect(checkWorkflowBunPin([], "bun@1.4.2", workflows)).toEqual([
      ".github/workflows/ci.yml:7 bun-version mismatch: expected 1.4.2, got 1.3.0",
      ".github/workflows/publish.yml:4 bun-version mismatch: expected 1.4.2, got 1.3.0"
    ]);
    // A pin only outside ci.yml still leaves CI on an unpinned Bun.
    expect(checkWorkflowBunPin([], "bun@1.4.2", { "ci.yml": "name: CI\n", "publish.yml": `jobs:\n${setup("1.4.2")}` })).toEqual([
      ".github/workflows/ci.yml is missing bun-version"
    ]);
  });

  test("reads quoted, commented, list, and expression bun-version values (#570)", () => {
    const ci = [
      '          bun-version: "1.4.2"',
      "          bun-version: '1.4.2' # the pin",
      "          bun-version: 1.4.2   ",
      "        - bun-version: 1.3.0",
      "          # bun-version: 0.0.1 is a comment",
      "          run: echo ok # bun-version: 0.0.1",
      "          bun-version: 1.4.2 # 1.3.0 is older",
      "          bun-version: latest",
      "          bun-version: ${{ matrix.bun }}",
      "          bun-version:",
      "        name: next step"
    ].join("\r\n");
    expect(checkWorkflowBunPin([], "bun@1.4.2", { "ci.yml": ci })).toEqual([
      ".github/workflows/ci.yml:4 bun-version mismatch: expected 1.4.2, got 1.3.0",
      ".github/workflows/ci.yml:8 bun-version mismatch: expected 1.4.2, got latest",
      ".github/workflows/ci.yml:9 bun-version mismatch: expected 1.4.2, got ${{ matrix.bun }}",
      ".github/workflows/ci.yml:10 bun-version mismatch: expected 1.4.2, got "
    ]);
  });

  test("reads every YAML form of the key and the value (#570)", () => {
    const ci = [
      "          bun-version : 1.3.0",
      '          "bun-version": 1.3.1',
      "          'bun-version' : '1.3.2'",
      "        with: { bun-version: 1.3.3, no-cache: true }",
      "        with: {no-cache: true,bun-version: '1.3.4'}",
      "        with: { bun-version: 1.4.2 }",
      "          bun-version: >-",
      "            1.3.5",
      "          bun-version: |",
      "            1.4.2",
      "          bun-version:",
      "            1.3.6",
      "          bun-version: >-",
      "            1.4.2",
      "            1.3.7",
      "          my-bun-version: 0.0.1"
    ].join("\n");
    expect(checkWorkflowBunPin([], "bun@1.4.2", { "ci.yml": ci })).toEqual([
      ".github/workflows/ci.yml:1 bun-version mismatch: expected 1.4.2, got 1.3.0",
      ".github/workflows/ci.yml:2 bun-version mismatch: expected 1.4.2, got 1.3.1",
      ".github/workflows/ci.yml:3 bun-version mismatch: expected 1.4.2, got 1.3.2",
      ".github/workflows/ci.yml:4 bun-version mismatch: expected 1.4.2, got 1.3.3",
      ".github/workflows/ci.yml:5 bun-version mismatch: expected 1.4.2, got 1.3.4",
      ".github/workflows/ci.yml:7 bun-version mismatch: expected 1.4.2, got 1.3.5",
      ".github/workflows/ci.yml:11 bun-version mismatch: expected 1.4.2, got 1.3.6",
      ".github/workflows/ci.yml:13 bun-version mismatch: expected 1.4.2, got 1.4.2 1.3.7"
    ]);
  });

  test("refuses setup-bun inputs and install scripts that bypass the pin (#570)", () => {
    const publish = [
      "          bun-version-file: package.json",
      '          "bun-download-url": https://example.com/bun.zip',
      "        with: { bun-version-file: .bun-version }",
      "        run: curl -fsSL https://bun.sh/install | bash",
      '        run: curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.0"',
      "        run: curl -fsSL https://bun.com/install | bash -s bun-v1.4.2",
      "        run: echo done # curl https://bun.sh/install | bash"
    ].join("\n");
    expect(checkWorkflowBunPin([], "bun@1.4.2", { "ci.yml": "          bun-version: 1.4.2\n", "publish.yml": publish })).toEqual([
      ".github/workflows/publish.yml:1 sets bun-version-file, which check:metadata cannot compare with the pin; use bun-version: 1.4.2",
      ".github/workflows/publish.yml:2 sets bun-download-url, which check:metadata cannot compare with the pin; use bun-version: 1.4.2",
      ".github/workflows/publish.yml:3 sets bun-version-file, which check:metadata cannot compare with the pin; use bun-version: 1.4.2",
      ".github/workflows/publish.yml:4 runs Bun's install script without bun-v1.4.2",
      ".github/workflows/publish.yml:5 Bun install script mismatch: expected 1.4.2, got 1.3.0"
    ]);
    // A pinned install script is a pin for ci.yml.
    expect(checkWorkflowBunPin([], "bun@1.4.2", { "ci.yml": 'run: curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"\n' })).toEqual([]);
  });

  // Qodo on #624: a `run: |` script is text, so a version in it is not a pin.
  test("skips keys inside block scalars but still checks install scripts there (#570)", () => {
    const ci = [
      "jobs:",
      "  test:",
      "    steps:",
      "      - uses: oven-sh/setup-bun@abc # v2",
      "        with:",
      "          bun-version: 1.4.2",
      "      - run: |",
      "          echo bun-version: 1.3.0",
      "          cat > x.yml <<'EOF'",
      "          bun-version: 1.0.0",
      "          EOF",
      "",
      "          curl -fsSL https://bun.sh/install | bash -s bun-v1.3.0",
      "      - name: notes",
      "        env:",
      "          NOTES: >-",
      "            use bun-version: 0.1.0",
      "        run: echo done"
    ].join("\n");
    expect(checkWorkflowBunPin([], "bun@1.4.2", { "ci.yml": ci })).toEqual([
      ".github/workflows/ci.yml:13 Bun install script mismatch: expected 1.4.2, got 1.3.0"
    ]);
  });

  // setup-bun v2 falls back to packageManager only when package.json is
  // already checked out, and installs the latest Bun otherwise.
  test("requires bun-version on every setup-bun step (#570)", () => {
    const publish = [
      "jobs:",
      "  build:",
      "    steps:",
      "      - name: Set up Bun",
      "        uses: oven-sh/setup-bun@abc # v2",
      "      - uses: 'oven-sh/setup-bun@abc'",
      "        with:",
      "          no-cache: true",
      "      - uses: actions/checkout@abc",
      "        with:",
      "          bun-version: 1.4.2",
      "      - { uses: oven-sh/setup-bun@abc, with: { bun-version: 1.4.2 } }",
      "      - name: From a file",
      "        uses: oven-sh/setup-bun@abc",
      "        with:",
      "          bun-version-file: package.json",
      "      - name: Pinned",
      "        uses: oven-sh/setup-bun@abc",
      "        with:",
      "          # the pin",
      "          bun-version: 1.4.2",
      "      - uses: oven-sh/setup-bun@abc"
    ].join("\n");
    expect(checkWorkflowBunPin([], "bun@1.4.2", { "ci.yml": "          bun-version: 1.4.2\n", "publish.yml": publish })).toEqual([
      ".github/workflows/publish.yml:5 runs oven-sh/setup-bun without bun-version; add bun-version: 1.4.2",
      ".github/workflows/publish.yml:6 runs oven-sh/setup-bun without bun-version; add bun-version: 1.4.2",
      ".github/workflows/publish.yml:16 sets bun-version-file, which check:metadata cannot compare with the pin; use bun-version: 1.4.2",
      ".github/workflows/publish.yml:22 runs oven-sh/setup-bun without bun-version; add bun-version: 1.4.2"
    ]);
  });

  test("readWorkflows reads every yml and yaml file in .github/workflows, and no folder (#570)", () => {
    const root = makeTempDir("story-workflows-");
    const dir = path.join(root, ".github", "workflows");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "z.yaml"), "z\n");
    fs.writeFileSync(path.join(dir, "a.yml"), "a\n");
    fs.writeFileSync(path.join(dir, "notes.md"), "not a workflow\n");
    // Qodo on #624: a folder named like a workflow made readFileSync throw.
    fs.mkdirSync(path.join(dir, "archived.yml"));
    expect(readWorkflows(root)).toEqual({ "a.yml": "a\n", "z.yaml": "z\n" });
  });
});

describe("check-metadata marketplaces", () => {
  const packageJson = JSON.parse(readRepo("package.json"));
  const claudeMarketplace = JSON.parse(readRepo(".claude-plugin/marketplace.json"));
  const agentsMarketplace = JSON.parse(readRepo(".agents/plugins/marketplace.json"));
  const base = {
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    claudeMarketplace,
    agentsMarketplace,
    exists: (relativePath) => fs.existsSync(path.join(repoRoot, relativePath))
  };

  test("accepts the committed marketplace manifests", () => {
    expect(checkMarketplaces(base)).toEqual([]);
  });

  test("detects name drift", () => {
    const renamed = {
      ...base,
      agentsMarketplace: {
        ...agentsMarketplace,
        plugins: [{ ...agentsMarketplace.plugins[0], name: "other-name" }]
      }
    };
    expect(checkMarketplaces(renamed).join("\n")).toContain("has no plugin named story-skills");
  });

  test("detects a drifted agents plugin path", () => {
    const moved = {
      ...base,
      agentsMarketplace: {
        ...agentsMarketplace,
        plugins: [{ ...agentsMarketplace.plugins[0], source: { source: "local", path: "./skills" } }]
      }
    };
    const failures = checkMarketplaces(moved);
    expect(failures.join("\n")).toContain("source.path");
    expect(failures.join("\n")).toContain("./plugins/story-skills");
  });

  test("detects a missing plugins checkout path", () => {
    const failures = checkMarketplaces({ ...base, exists: () => false });
    expect(failures.join("\n")).toContain("./plugins/story-skills but that path does not exist");
  });

  test("detects a bad plugin version that trails the package", () => {
    const stale = {
      ...base,
      agentsMarketplace: {
        ...agentsMarketplace,
        plugins: [{ ...agentsMarketplace.plugins[0], version: "0.0.0" }]
      }
    };
    expect(checkMarketplaces(stale).join("\n")).toContain("version");
  });

  test("detects version drift where versions are declared", () => {
    const stale = {
      ...base,
      claudeMarketplace: { ...claudeMarketplace, version: "0.0.0" }
    };
    expect(checkMarketplaces(stale).join("\n")).toContain("version");
  });

  test("expectEqual reports mismatches", () => {
    expect(expectEqual([], "label", "a", "a")).toEqual([]);
    expect(expectEqual([], "label", "a", "b")).toEqual(["label mismatch: expected a, got b"]);
  });
});

describe("check-metadata plugin manifests (#568)", () => {
  const packageJson = JSON.parse(readRepo("package.json"));
  const claudePlugin = JSON.parse(readRepo(".claude-plugin/plugin.json"));
  const codexPlugin = JSON.parse(readRepo(".codex-plugin/plugin.json"));
  const claudeMarketplace = JSON.parse(readRepo(".claude-plugin/marketplace.json"));
  const base = { packageJson, claudePlugin, codexPlugin, claudeMarketplace };
  const entry = claudeMarketplace.plugins[0];
  const withPlugins = (...plugins) => ({ ...claudeMarketplace, plugins });
  const { homepage, repository } = claudePlugin;

  // The phrase each skill's area goes by in both descriptions, so a new skill
  // fails here until the descriptions name it.
  const AREAS = {
    adaptation: "adaptation",
    "chapter-writing": "chapter writing",
    "character-management": "character management",
    "discovery-drafting": "discovery drafting",
    "editorial-review": "editorial review",
    "feedback-triage": "feedback",
    "genre-craft": "genre craft",
    "interactive-fiction": "interactive fiction",
    "line-editing": "line editing",
    "plot-structure": "plot structure",
    "premise-workshop": "premise development",
    publishing: "publishing",
    "reader-panel": "simulated reader panels",
    research: "research",
    "revision-continuity": "revision passes",
    "scene-craft": "scene craft",
    "series-continuity": "series",
    "story-init": "story initialization",
    "story-maintenance": "maintenance",
    submission: "submission",
    "theme-craft": "theme",
    "verse-craft": "verse",
    "voice-style": "voice and style",
    worldbuilding: "worldbuilding"
  };

  test("accepts the committed manifests", () => {
    expect(checkPluginManifests([], base)).toEqual([]);
  });

  test("both descriptions name every skill's area, pacing, and other languages", () => {
    const skills = fs.readdirSync(path.join(repoRoot, "skills"), { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name);
    expect(Object.keys(AREAS).sort()).toEqual(skills.sort());
    for (const text of [claudePlugin.description, codexPlugin.interface.longDescription]) {
      const missing = [...Object.values(AREAS), "pacing", "any other language"].filter((area) => !text.includes(area));
      expect(missing).toEqual([]);
    }
  });

  test("detects a description that drifts between the manifests", () => {
    const stale = { ...codexPlugin, description: "Older text." };
    expect(checkPluginManifests([], { ...base, codexPlugin: stale })).toEqual([
      ".codex-plugin/plugin.json description differs from .claude-plugin/plugin.json; give both the same text"
    ]);
    const { description, ...bare } = entry;
    expect(checkPluginManifests([], { ...base, claudeMarketplace: withPlugins(bare) })).toEqual([
      ".claude-plugin/marketplace.json plugins[0] description differs from .claude-plugin/plugin.json; give both the same text"
    ]);
  });

  // Qodo on #651: only the first entry with the plugin's name was read.
  test("checks every marketplace entry with the plugin's name, and no other", () => {
    const other = { name: "other-plugin", source: entry.source, description: "Something else." };
    const drifted = { ...entry, description: "Older text.", homepage: "https://example.com" };
    expect(checkPluginManifests([], { ...base, claudeMarketplace: withPlugins(other, entry, drifted, null) })).toEqual([
      ".claude-plugin/marketplace.json plugins[2] description differs from .claude-plugin/plugin.json; give both the same text",
      `.claude-plugin/marketplace.json plugins[2] homepage mismatch: expected ${homepage}, got https://example.com`
    ]);
    expect(checkPluginManifests([], { ...base, claudeMarketplace: null })).toEqual([]);
  });

  test("requires a description, homepage, and repository in each manifest", () => {
    const blank = (manifest) => ({ ...manifest, description: " ", homepage: undefined, repository: undefined });
    const missing = { ...base, claudePlugin: blank(claudePlugin), codexPlugin: blank(codexPlugin), claudeMarketplace: withPlugins(blank(entry)) };
    expect(checkPluginManifests([], missing)).toEqual([
      ".claude-plugin/plugin.json is missing description",
      `.claude-plugin/plugin.json homepage mismatch: expected ${homepage}, got undefined`,
      `.claude-plugin/plugin.json repository mismatch: expected ${repository}, got undefined`,
      `.codex-plugin/plugin.json homepage mismatch: expected ${homepage}, got undefined`,
      `.codex-plugin/plugin.json repository mismatch: expected ${repository}, got undefined`,
      `.claude-plugin/marketplace.json plugins[0] homepage mismatch: expected ${homepage}, got undefined`,
      `.claude-plugin/marketplace.json plugins[0] repository mismatch: expected ${repository}, got undefined`
    ]);
    // Qodo on #651: without the package.json fields, the manifests could drop theirs.
    const { homepage: _homepage, repository: _repository, ...unlinked } = packageJson;
    const bare = (manifest) => ({ ...manifest, homepage: undefined, repository: undefined });
    expect(checkPluginManifests([], {
      packageJson: unlinked,
      claudePlugin: bare(claudePlugin),
      codexPlugin: bare(codexPlugin),
      claudeMarketplace: withPlugins(bare(entry))
    })).toEqual(["package.json is missing homepage", "package.json is missing repository"]);
  });

  test("compares the repository without npm's git+ and .git", () => {
    const moved = { ...codexPlugin, repository: "https://github.com/someone/story-skills" };
    expect(checkPluginManifests([], { ...base, codexPlugin: moved })).toEqual([
      `.codex-plugin/plugin.json repository mismatch: expected ${repository}, got https://github.com/someone/story-skills`
    ]);
    expect(repositoryUrl({ type: "git", url: "git+https://github.com/a/b.git" })).toBe("https://github.com/a/b");
    expect(repositoryUrl("https://github.com/a/b")).toBe("https://github.com/a/b");
    expect(repositoryUrl(undefined)).toBeUndefined();
    expect(repositoryUrl({ type: "git" })).toBeUndefined();
  });
});

describe("check-examples helpers", () => {
  test("collectResult prefixes errors and warnings", () => {
    const failures = collectResult([], "demo", "validate", { errors: [{ message: "bad" }], warnings: [{ message: "meh" }] });
    expect(failures).toEqual(["demo validate error: bad", "demo validate warning: meh"]);
  });

  test("compareFindings reports missing and unexpected findings", () => {
    const failures = compareFindings([], "demo", "error", ["a", "b"], [{ message: "b" }, { message: "c" }]);
    expect(failures).toEqual([
      "demo continuity is missing expected error: a",
      "demo continuity has unexpected error: c"
    ]);
    expect(compareFindings([], "demo", "warning", ["a"], [{ message: "a" }])).toEqual([]);
  });
});

describe("check-links", () => {
  function linkRepo(files) {
    const root = makeTempDir("story-links-");
    for (const [relativePath, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
      fs.writeFileSync(path.join(root, relativePath), text);
    }
    return root;
  }

  test("slugs headings the way GitHub does", () => {
    expect(slugify(headingText("The `story series` command"))).toBe("the-story-series-command");
    expect(slugify(headingText("What's new? (v2.0)"))).toBe("whats-new-v20");
    expect(slugify(headingText("[Links](x.md) and _emphasis_ in snake_case"))).toBe("links-and-emphasis-in-snake_case");
    expect(slugify(headingText("Ünïcode — dash"))).toBe("ünïcode--dash");
    expect(headingText("<code>Tagged</code> <<b>x</b>>heading")).toBe("Tagged heading");
    expect([...anchorsFor("# Notes\n\n## Notes\n\nSetext\n---\n\n## Notes\n\n<a id=\"custom\"></a>\n")]).toEqual(["notes", "notes-1", "setext", "notes-2", "custom"]);
  });

  test("ignores frontmatter, fenced code, inline code, and comments", () => {
    const text = "---\nlink: \"[a](front.md)\"\n---\n```md\n[b](fenced.md)\n```\n~~~~\n```\n[c](tilde.md)\n~~~~\n`[d](inline.md)` <!-- [e](comment.md) -->\n[f](real.md)\n";
    expect(extractLinks(text)).toEqual([{ target: "real.md", line: 12 }]);
    expect(maskCode(text).split("\n").length).toBe(text.split("\n").length);
  });

  test("a <!-- in a code span opens no comment, so a later comment hides nothing else", () => {
    const text = "A `<!--` that never closes.\n\n## Kept\n\n[seen](seen.md)\n\n<!-- marker -->\n";
    expect([...anchorsFor(text)]).toEqual(["kept"]);
    expect(extractLinks(text)).toEqual([{ target: "seen.md", line: 5 }]);
  });

  test("a lone backtick pairs with none in a later paragraph, so a comment between them stays hidden", () => {
    const text = "A lone ` here.\n\n<!--\n## Draft heading\n[gone](gone.md)\n-->\n\nSee [real](real.md) and a lone ` there.\n\n## Kept\n";
    expect([...anchorsFor(text)]).toEqual(["kept"]);
    expect(extractLinks(text)).toEqual([{ target: "real.md", line: 8 }]);
  });

  test("a comment that starts a line hides its content, whatever backticks the paragraph around it holds", () => {
    const text = "Text with a ` tick\n<!--\n## Hidden\n[gone](gone.md) `\n-->\nand `code` then [real](real.md).\n";
    expect([...anchorsFor(text)]).toEqual([]);
    expect(extractLinks(text)).toEqual([{ target: "real.md", line: 6 }]);
  });

  test("extracts titled links, images, angle links, references, and html", () => {
    const text = "[a](a.md \"Title\") ![img](pic.png 'Alt')\n[b](<with space.md>) [c](has(paren).md)\n[ref]: ref.md \"t\"\n<img src=\"logo.svg\"> <a href=\"page.md#x\">x</a>\n";
    expect(extractLinks(text).map((link) => link.target)).toEqual(["a.md", "pic.png", "with space.md", "has(paren).md", "ref.md", "logo.svg", "page.md#x"]);
  });

  test("masks fences inside block quotes and treats an unclosed leading --- as a divider", () => {
    expect(extractLinks("> ```md\n> [made-up](missing.md)\n> ```\n[real](real.md)\n")).toEqual([{ target: "real.md", line: 4 }]);
    expect(extractLinks("---\n\n[after](after.md)\n")).toEqual([{ target: "after.md", line: 3 }]);
  });

  test("finds quoted, wrapped setext, and only real setext headings", () => {
    const text = "> # Quoted note\n\nA long\nwrapped heading\n---------------\n\n- list item\n---\n\n***\nplain\n===\n";
    expect([...anchorsFor(text)]).toEqual(["quoted-note", "a-long-wrapped-heading", "plain"]);
  });

  test("extracts unquoted html attributes and each srcset candidate", () => {
    const text = "<a href=docs/guide.md>g</a> <img srcset=\"small.png 1x, large.png 2x\" src='small.png'>\n";
    expect(extractLinks(text).map((link) => link.target)).toEqual(["docs/guide.md", "small.png", "large.png", "small.png"]);
  });

  test("skips external links and template placeholders", () => {
    for (const target of ["https://example.com", "mailto:a@b.c", "//cdn.example.com/x", "characters/{name-kebab}.md", "${dir}/x.md", ""]) {
      expect(isSkipped(target)).toBe(true);
    }
    expect(isSkipped("docs/cli.md#check")).toBe(false);
  });

  test("reports missing files and anchors and accepts valid ones", () => {
    const root = linkRepo({
      "README.md": "[ok](docs/guide.md#second-part) [dir](docs/) [img](assets/logo.png) [self](#top)\n[gone](docs/missing.md)\n[bad](docs/guide.md#nope) [line](docs/guide.md#L3) [yml](ci.yml#anything) [dup](docs/guide.md#intro-1)\n# Top\n",
      "CONTRIBUTING.md": "[up](README.md#top) [abs](/docs/guide.md) [enc](docs/with%20space.md)\n",
      "docs/guide.md": "# Intro\n\n## Second part\n\n## Intro\n",
      "docs/with space.md": "x\n",
      "skills/demo/SKILL.md": "[ref](references/a.md) [back](../../README.md#nowhere)\n",
      "skills/demo/references/a.md": "fine\n",
      "templates/github/notes.md": "[t](../../docs/guide.md#intro)\n",
      "examples/demo/README.md": "[s](story.md)\n",
      "examples/demo/chapters/ignored.md": "[x](nothing.md)\n",
      "assets/logo.png": "",
      "ci.yml": ""
    });
    const { files, failures } = checkLinks(root);
    expect(files.map((file) => path.relative(root, file).split(path.sep).join("/"))).toEqual([
      "CONTRIBUTING.md",
      "README.md",
      "docs/guide.md",
      "docs/with space.md",
      "skills/demo/SKILL.md",
      "skills/demo/references/a.md",
      "templates/github/notes.md",
      "examples/demo/README.md"
    ]);
    expect(failures).toEqual([
      "README.md:2: docs/missing.md points at a missing file",
      "README.md:3: docs/guide.md#nope has no heading or anchor #nope in docs/guide.md",
      "skills/demo/SKILL.md:1: ../../README.md#nowhere has no heading or anchor #nowhere in README.md",
      "examples/demo/README.md:1: story.md points at a missing file"
    ]);
  });

  // #570: a link above the root passed whenever the target existed on this
  // disk, though GitHub cannot serve it.
  test("rejects links that leave the repository, even to files that exist (#570)", () => {
    const parent = makeTempDir("story-links-outside-");
    fs.writeFileSync(path.join(parent, "outside.md"), "# Outside\n");
    const root = path.join(parent, "repo");
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "README.md"), "[out](../outside.md) [abs](/../outside.md#outside) [up](..) [in](docs/../README.md) [root](./)\n");
    fs.writeFileSync(path.join(root, "docs", "guide.md"), "[deep](../../outside.md)\n<img src=\"../../outside.md\">\n");
    // A name that only starts with two dots is inside the repository.
    fs.writeFileSync(path.join(root, "..notes.md"), "notes\n");
    fs.writeFileSync(path.join(root, "CONTRIBUTING.md"), "[dots](..notes.md) [gone](../missing-outside.md)\n");
    expect(checkLinks(root).failures).toEqual([
      "CONTRIBUTING.md:1: ../missing-outside.md points outside the repository",
      "README.md:1: ../outside.md points outside the repository",
      "README.md:1: /../outside.md#outside points outside the repository",
      "README.md:1: .. points outside the repository",
      "docs/guide.md:1: ../../outside.md points outside the repository",
      "docs/guide.md:2: ../../outside.md points outside the repository"
    ]);
  });

  // Windows needs Developer Mode to create a symlink.
  test.skipIf(process.platform === "win32")("rejects links that leave the repository through a symlink (#570)", () => {
    const parent = makeTempDir("story-links-symlink-");
    fs.writeFileSync(path.join(parent, "outside.md"), "# Outside\n");
    const root = path.join(parent, "repo");
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.mkdirSync(path.join(root, "plugins"));
    fs.symlinkSync("../..", path.join(root, "docs", "up"));
    fs.symlinkSync("../outside.md", path.join(root, "esc.md"));
    // plugins/story-skills points back at the root, which is still inside.
    fs.symlinkSync("..", path.join(root, "plugins", "story-skills"));
    fs.writeFileSync(path.join(root, "README.md"), "# Top\n\n[a](docs/up/outside.md#outside) [b](esc.md) [c](plugins/story-skills/README.md#top)\n");
    expect(checkLinks(root).failures).toEqual([
      "README.md:3: docs/up/outside.md#outside points outside the repository through a symlink",
      "README.md:3: esc.md points outside the repository through a symlink"
    ]);
  });

  test("checks root and .github markdown, CHANGELOG and AGENTS included, and evals/README.md (#570)", () => {
    const root = linkRepo({
      "AGENTS.md": "[a](gone-agents.md)\n",
      "CHANGELOG.md": "[c](CONTRIBUTING.md#nope)\n",
      "CONTRIBUTING.md": "# Contributing\n",
      "SECURITY.md": "[s](gone-security.md)\n",
      ".github/SUPPORT.md": "[g](../gone-support.md) [ok](../CONTRIBUTING.md#contributing)\n",
      ".github/ISSUE_TEMPLATE/notes.md": "# Notes\n\n[n](https://example.com/notes) [top](#notes)\n",
      "evals/README.md": "[e](fixtures/gone/)\n",
      "evals/examples/draft.md": "[x](gone-draft.md)\n"
    });
    // CLAUDE.md is a symlink to AGENTS.md and is not checked twice. Windows
    // needs Developer Mode for a symlink, and the expected list is the same
    // without one, so the link is made only elsewhere.
    if (process.platform !== "win32") {
      fs.symlinkSync("AGENTS.md", path.join(root, "CLAUDE.md"));
    }
    const { files, failures } = checkLinks(root);
    expect(files.map((file) => path.relative(root, file).split(path.sep).join("/"))).toEqual([
      "AGENTS.md",
      "CHANGELOG.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      ".github/ISSUE_TEMPLATE/notes.md",
      ".github/SUPPORT.md",
      "evals/README.md"
    ]);
    expect(failures).toEqual([
      "AGENTS.md:1: gone-agents.md points at a missing file",
      "CHANGELOG.md:1: CONTRIBUTING.md#nope has no heading or anchor #nope in CONTRIBUTING.md",
      "SECURITY.md:1: gone-security.md points at a missing file",
      ".github/SUPPORT.md:1: ../gone-support.md points at a missing file",
      "evals/README.md:1: fixtures/gone/ points at a missing file"
    ]);
  });

  // A template's relative link resolves against the pull request or issue
  // page, so it is broken there even when the file exists in the repository.
  test("pull request and issue templates need full URLs (#570)", () => {
    const root = linkRepo({
      "CONTRIBUTING.md": "# Contributing\n",
      ".github/PULL_REQUEST_TEMPLATE.md": "# Summary\n\n[guide](../CONTRIBUTING.md) [top](#summary) [web](https://example.com)\n",
      ".github/PULL_REQUEST_TEMPLATE/release.md": "[r](../../CONTRIBUTING.md#contributing)\n",
      ".github/ISSUE_TEMPLATE/bug.md": "<a href=\"../../CONTRIBUTING.md\">guide</a>\n",
      "docs/pull_request_template.md": "[d](../CONTRIBUTING.md)\n",
      "pull_request_template.md": "[p](CONTRIBUTING.md)\n"
    });
    const message = "is relative, but this template is shown on the pull request or issue page; use a full https:// URL";
    expect(checkLinks(root).failures).toEqual([
      `pull_request_template.md:1: CONTRIBUTING.md ${message}`,
      `.github/ISSUE_TEMPLATE/bug.md:1: ../../CONTRIBUTING.md ${message}`,
      `.github/PULL_REQUEST_TEMPLATE/release.md:1: ../../CONTRIBUTING.md#contributing ${message}`,
      `.github/PULL_REQUEST_TEMPLATE.md:3: ../CONTRIBUTING.md ${message}`,
      `docs/pull_request_template.md:1: ../CONTRIBUTING.md ${message}`
    ]);
  });

  // #569: docs that ship in the npm package link files the package leaves
  // out by GitHub URL, so those URLs are checked against the checkout.
  test("checks links to this repository's main branch on GitHub (#569)", () => {
    const repo = "https://github.com/danjdewhurst/story-skills";
    const root = linkRepo({
      "AGENTS.md": "# Agent Instructions\n",
      "evals/README.md": "# Evals\n\n## Skill coverage\n",
      ".github/workflows/ci.yml": "",
      ".github/PULL_REQUEST_TEMPLATE.md": `[guide](${repo}/blob/main/AGENTS.md) [gone](${repo}/blob/main/GONE.md)\n`,
      "docs/README.md": [
        `[a](${repo}/blob/main/AGENTS.md#agent-instructions) [e](${repo}/blob/main/evals/README.md#skill-coverage) [host](https://GitHub.com/DanJDewhurst/Story-Skills/blob/main/AGENTS.md)`,
        `[w](${repo}/tree/main/.github/workflows) [ci](${repo}/blob/main/.github/workflows/ci.yml?plain=1#L3) [root](${repo}/tree/main) [slash](${repo}/tree/main/)`,
        `[gone](${repo}/blob/main/scripts/gone.js) [bad](${repo}/blob/main/AGENTS.md#nope) [up](${repo}/blob/main/../outside.md)`,
        `[issues](${repo}/issues/1) [tag](${repo}/blob/v0.1.0/gone.md) [fork](https://github.com/someone/story-skills/blob/main/gone.md) [branch](${repo}/blob/mainline/gone.md)`,
        `[upper](${repo}/blob/MAIN/AGENTS.md) [mixed](${repo}/Tree/main/evals) [double](${repo}/blob/main//gone.md) [inner](${repo}/blob/main/evals//README.md)`
      ].join("\n")
    });
    const caseProblem = (name) => `names ${name}, but GitHub paths are case-sensitive; write blob/main or tree/main`;
    const emptySegment = "has an empty path segment (//), which GitHub does not serve";
    expect(checkLinks(root).failures).toEqual([
      `.github/PULL_REQUEST_TEMPLATE.md:1: ${repo}/blob/main/GONE.md points at a missing file`,
      `docs/README.md:3: ${repo}/blob/main/scripts/gone.js points at a missing file`,
      `docs/README.md:3: ${repo}/blob/main/AGENTS.md#nope has no heading or anchor #nope in AGENTS.md`,
      `docs/README.md:3: ${repo}/blob/main/../outside.md points outside the repository`,
      `docs/README.md:5: ${repo}/blob/MAIN/AGENTS.md ${caseProblem("blob/MAIN")}`,
      `docs/README.md:5: ${repo}/Tree/main/evals ${caseProblem("Tree/main")}`,
      `docs/README.md:5: ${repo}/blob/main//gone.md ${emptySegment}`,
      `docs/README.md:5: ${repo}/blob/main/evals//README.md ${emptySegment}`
    ]);
  });

  // GitHub does not follow a symlink in a /blob/ or /tree/ URL, though a
  // relative link through one resolves on disk. Windows needs Developer Mode
  // to create a symlink.
  test.skipIf(process.platform === "win32")("rejects a GitHub URL that goes through a symlink (#569)", () => {
    const repo = "https://github.com/danjdewhurst/story-skills";
    const root = linkRepo({
      "AGENTS.md": "# Overview\n",
      "docs/guide.md": [
        `[file](${repo}/blob/main/CLAUDE.md#overview) [folder](${repo}/blob/main/plugins/story-skills/AGENTS.md) [real](${repo}/blob/main/AGENTS.md#overview)`,
        "[relative](../CLAUDE.md#overview)"
      ].join("\n")
    });
    fs.symlinkSync("AGENTS.md", path.join(root, "CLAUDE.md"));
    fs.mkdirSync(path.join(root, "plugins"));
    fs.symlinkSync("..", path.join(root, "plugins", "story-skills"));
    const message = "goes through a symlink, which a GitHub URL does not follow; link the real path";
    expect(checkLinks(root).failures).toEqual([
      `docs/guide.md:1: ${repo}/blob/main/CLAUDE.md#overview ${message}`,
      `docs/guide.md:1: ${repo}/blob/main/plugins/story-skills/AGENTS.md ${message}`
    ]);
  });

  test("repoPath maps main-branch GitHub URLs to root-relative paths", () => {
    const repo = "https://github.com/danjdewhurst/story-skills";
    expect(repoPath(`${repo}/blob/main/docs/cli.md#check`)).toEqual({ path: "/docs/cli.md#check" });
    expect(repoPath(`${repo}/tree/main/evals/`)).toEqual({ path: "/evals/" });
    expect(repoPath(`${repo}/tree/main`)).toEqual({ path: "/" });
    expect(repoPath(`${repo}/blob/main?plain=1`)).toEqual({ path: "/?plain=1" });
    expect(repoPath(`${repo}/blob/main/a.md?q=x//y#a//b`)).toEqual({ path: "/a.md?q=x//y#a//b" });
    expect(repoPath(`${repo}/blob/Main/README.md`).problem).toContain("case-sensitive");
    expect(repoPath(`${repo}/BLOB/main/README.md`).problem).toContain("case-sensitive");
    expect(repoPath(`${repo}/blob/main//README.md`).problem).toContain("empty path segment");
    for (const other of [`${repo}/issues/1`, `${repo}/blob/v1.0.0/README.md`, `${repo}/blob/mainline/README.md`, "https://example.com/blob/main/x.md", "docs/cli.md"]) {
      expect(repoPath(other)).toBeNull();
    }
  });

  test("the repository's own markdown links resolve", () => {
    expect(checkLinks().failures).toEqual([]);
  });

  test("ci runs the link check", () => {
    expect(JSON.parse(readRepo("package.json")).scripts["check:links"]).toBe("node scripts/check-links.js");
    expect(readRepo(".github/workflows/ci.yml")).toContain("bun run check:links");
  });
});

describe("github workflows", () => {
  // The workflow templates users copy into their story repositories.
  const templateWorkflowFiles = fs
    .readdirSync(path.join(repoRoot, "templates/github"))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => `templates/github/${name}`);
  const workflowFiles = [".github/workflows/ci.yml", ...templateWorkflowFiles];
  // A template job runs on users' pull requests, so it gets an hour at most.
  const TEMPLATE_TIMEOUT_CAP = 60;
  // Every workflow this repository runs, including publish, CodeQL, and
  // Scorecard, which run with write tokens.
  const repoWorkflowFiles = fs
    .readdirSync(path.join(repoRoot, ".github/workflows"))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => `.github/workflows/${name}`);
  const pinnedFiles = [...new Set([...repoWorkflowFiles, ...workflowFiles])];

  test("each workflow declares top-level structure", () => {
    for (const relativePath of workflowFiles) {
      const keys = topLevelKeys(readRepo(relativePath));
      for (const required of ["name", "on", "jobs"]) {
        expect(keys).toContain(required);
      }
    }
  });

  test("every actions reference is SHA-pinned with a version comment", () => {
    // Repo workflows and user-facing templates are all gated: a moving tag
    // must never silently change what any of them run.
    expect(repoWorkflowFiles).toEqual(expect.arrayContaining([".github/workflows/ci.yml", ".github/workflows/codeql.yml", ".github/workflows/publish.yml", ".github/workflows/scorecard.yml"]));
    for (const relativePath of pinnedFiles) {
      const refs = usesRefs(readRepo(relativePath));
      expect(refs.length, relativePath).toBeGreaterThan(0);
      for (const { ref, comment, line } of refs) {
        expect(`${relativePath}: ${line}`).toContain("#");
        expect(ref).toMatch(/^[\w-]+\/[\w.-]+(\/[\w.-]+)*@[0-9a-f]{40}$/);
        expect(comment).toMatch(/^v\d/);
      }
    }
  });

  test("each action is pinned at one SHA across repo workflows and templates", () => {
    // Users copy the templates, so a stale pin there spreads to every story
    // repository. Dependabot bumps both directories in one pull request; this
    // catches a hand edit, or a partial bump, that moves only some files.
    const files = Object.fromEntries(pinnedFiles.map((relativePath) => [relativePath, readRepo(relativePath)]));
    expect(actionPinConflicts(files)).toEqual([]);
  });

  test("a partial action bump is a pin conflict", () => {
    const old = "actions/checkout@" + "a".repeat(40) + " # v6.0.0";
    const bumped = "actions/checkout@" + "b".repeat(40) + " # v7.0.1";
    const files = {
      ".github/workflows/ci.yml": `        uses: ${bumped}\n`,
      ".github/workflows/publish.yml": `        uses: ${old}\n`,
      "templates/github/story-checks.yml": `        uses: ${old}\n`
    };
    expect(actionPinConflicts(files)).toEqual([
      `actions/checkout: ${"b".repeat(40)} (.github/workflows/ci.yml), ${"a".repeat(40)} (.github/workflows/publish.yml, templates/github/story-checks.yml)`
    ]);
  });

  test("one action SHA carries one version comment everywhere", () => {
    // A bare `# v7` beside the SHA another file labels `# v7.0.1` hides which
    // release is pinned and stops the files reading as identical pins.
    const comments = new Map();
    for (const relativePath of pinnedFiles) {
      for (const { ref, comment } of usesRefs(readRepo(relativePath))) {
        comments.set(ref, [...new Set([...(comments.get(ref) || []), comment])]);
      }
    }
    const drift = [...comments].filter(([, labels]) => labels.length > 1).map(([ref, labels]) => `${ref}: ${labels.join(" vs ")}`);
    expect(drift).toEqual([]);
  });

  test("the workflow templates are read from templates/github", () => {
    expect(templateWorkflowFiles).toEqual(expect.arrayContaining(["templates/github/story-checks.yml", "templates/github/draft-next-chapter.yml", "templates/github/review-copy.yml"]));
  });

  test("every workflow job has a timeout (#575)", () => {
    // Story checks run on pull requests, so a hostile or huge project must
    // not hold a runner for GitHub's six-hour default, and a hung step in
    // this repository's own CI or release must fail in minutes too.
    const problems = [];
    for (const relativePath of pinnedFiles) {
      const text = readRepo(relativePath);
      expect(Object.keys(workflowJobs(text)).length, relativePath).toBeGreaterThan(0);
      const cap = templateWorkflowFiles.includes(relativePath) ? TEMPLATE_TIMEOUT_CAP : Infinity;
      problems.push(...timeoutProblems(text, cap).map((problem) => `${relativePath}: ${problem}`));
    }
    expect(problems).toEqual([]);
  });

  test("the timeout check sees every job and caps template jobs (#575)", () => {
    const text = [
      "on: push",
      "jobs: # every job",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 10 # plenty",
      "# A comment at column 0 does not end the jobs block.",
      "",
      "  b: # no timeout",
      "    runs-on: ubuntu-latest",
      "  reusable:",
      "    uses: ./.github/workflows/called.yml",
      "  d:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 360",
      "  e:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 0",
      ""
    ].join("\n");
    expect(Object.keys(workflowJobs(text))).toEqual(["a", "b", "reusable", "d", "e"]);
    expect(timeoutProblems(text, TEMPLATE_TIMEOUT_CAP)).toEqual(["b has no timeout-minutes", "d has timeout-minutes: 360, over 60", "e has no timeout-minutes"]);
    expect(timeoutProblems(text)).toEqual(["b has no timeout-minutes", "e has no timeout-minutes"]);
  });

  test("the publish gate waits longer than any CI job can run (#575)", () => {
    // The gate's ci job waits for the whole ci.yml run on the release commit,
    // so a CI job, with the jobs it waits for, that could run past that wait
    // would fail the release.
    const jobs = workflowJobs(readRepo(".github/workflows/ci.yml"));
    const longest = Math.max(...Object.keys(jobs).map((id) => longestRunMinutes(jobs, id)));
    expect(longest * 60_000).toBeLessThan(CI_WAIT.timeoutMs);
  });

  test("a chain of needs adds up its timeouts (#575)", () => {
    const jobs = workflowJobs(
      [
        "jobs:",
        "  a:",
        "    timeout-minutes: 45",
        "  b:",
        "    needs: a",
        "    timeout-minutes: 20",
        "  c:",
        "    needs:",
        "      - b",
        "      - d",
        "    timeout-minutes: 5",
        "  d:",
        "    needs: [a]",
        "    timeout-minutes: 1",
        "  e:",
        "    needs: [a]",
        "  f:",
        "    needs: f",
        "    timeout-minutes: 1",
        ""
      ].join("\n")
    );
    expect(longestRunMinutes(jobs, "b")).toBe(65);
    expect(longestRunMinutes(jobs, "c")).toBe(70);
    expect(longestRunMinutes(jobs, "e")).toBe(Infinity);
    expect(longestRunMinutes(jobs, "f")).toBe(Infinity);
    expect(allNeeds(jobs, "c")).toEqual(["a", "b", "d"]);
  });

  test("no CI job runs the suite twice (#575)", () => {
    // test:coverage runs the whole suite, so another suite run beside it
    // only doubles the job's time.
    for (const relativePath of repoWorkflowFiles) {
      for (const [id, job] of Object.entries(workflowJobs(readRepo(relativePath)))) {
        expect(suiteRuns(job), `${relativePath}: ${id}`).toBeLessThanOrEqual(1);
      }
    }
    expect(suiteRuns(workflowJobs(readRepo(".github/workflows/ci.yml")).test)).toBe(1);
  });

  test("the suite-run count reads every way a step can run the suite (#575)", () => {
    const job = (...steps) => steps.map((step) => `      - name: Step\n${step}`).join("\n");
    expect(suiteRuns(job("        run: bun run test", "        run: bun run test:coverage"))).toBe(2);
    expect(suiteRuns(job("        run: |\n          bun run test\n          bun run test:coverage\n"))).toBe(2);
    expect(suiteRuns(job("        run: >-\n          bun run test &&\n          bun run test:coverage\n"))).toBe(2);
    expect(suiteRuns(job("        run: bun run test && bun run test:coverage"))).toBe(2);
    expect(suiteRuns(job("        run: bun test --timeout 60000 ./test/*.test.js", "        run: bun run test:coverage # with coverage"))).toBe(2);
    expect(suiteRuns(job("        run: bun run test # the whole suite"))).toBe(1);
    expect(suiteRuns(job('        run: "npm test"', "      - run: bun test"))).toBe(2);
    // One test file, a name filter, or another script is not the suite.
    expect(
      suiteRuns(
        job(
          "        run: |\n          for seed in 1 2 3; do\n            STORY_PROPERTY_SEED=$seed bun test test/validate-schema-property.test.js || exit 1\n          done\n",
          '        run: bun test -t "repeated"',
          "        run: bun run test:examples",
          "        # run: bun run test"
        )
      )
    ).toBe(0);
  });

  test("test:coverage runs the same suite as test (#575)", () => {
    // CI runs only test:coverage, so it must run every file test does, with
    // the same per-test timeout.
    const { scripts } = JSON.parse(readRepo("package.json"));
    const [suite] = scripts["test:coverage"].split(" && ");
    expect(suite.split(" ").filter((arg) => !arg.startsWith("--coverage")).join(" ")).toBe(scripts.test);
  });

  test("publish reaches npm only behind the gate, the binaries, and the npm environment (#544)", () => {
    const text = readRepo(".github/workflows/publish.yml");
    expect(publishGateProblems(text)).toEqual([]);
    const jobs = workflowJobs(text);
    expect(Object.keys(jobs)).toEqual(["verify", "ci", "binaries", "release-assets", "publish", "homebrew"]);
    expect(allNeeds(jobs, "verify")).toEqual([]);
    expect(allNeeds(jobs, "ci")).toEqual(["verify"]);
    expect(allNeeds(jobs, "binaries")).toEqual(["verify"]);
    expect(allNeeds(jobs, "release-assets")).toEqual(["binaries", "ci", "verify"]);
    expect(allNeeds(jobs, "publish")).toEqual(["binaries", "ci", "release-assets", "verify"]);
    expect(allNeeds(jobs, "homebrew")).toEqual(["binaries", "ci", "release-assets", "verify"]);

    // verify reads every branch and tag, and can write nothing.
    expect(jobs.verify).toContain("run: node scripts/publish-gate.js verify\n");
    expect(jobs.verify).toContain("fetch-depth: 0");
    expect(jobs.verify).toContain("TAG_INPUT: ${{ inputs.tag }}");
    expect(jobs.verify).toMatch(/ {4}permissions:\n {6}contents: read\n {4}outputs:/);

    // ci reads workflow runs with the job token, and outlasts the gate's own wait.
    expect(jobs.ci).toContain('run: node scripts/publish-gate.js ci "$RELEASE_SHA"\n');
    expect(jobs.ci).toContain("RELEASE_SHA: ${{ needs.verify.outputs.sha }}");
    expect(jobs.ci).toContain("GITHUB_TOKEN: ${{ github.token }}");
    expect(jobs.ci).toMatch(/ {4}permissions:\n {6}contents: read\n {6}actions: read\n {4}steps:/);
    expect(Number(/^ {4}timeout-minutes: (\d+)$/m.exec(jobs.ci)[1]) * 60_000).toBeGreaterThan(CI_WAIT.timeoutMs);

    // Only the npm job is in the npm environment. release-assets' OIDC token
    // signs attestations only.
    expect(jobs.publish).toMatch(/^ {4}environment: npm$/m);
    expect(Object.keys(jobs).filter((id) => jobs[id].includes("id-token: write"))).toEqual(["release-assets", "publish"]);
    expect(Object.keys(jobs).filter((id) => /^ {4}environment:/m.test(jobs[id]))).toEqual(["publish"]);

    // The tag is named only through verify's output.
    for (const id of ["binaries", "release-assets", "publish", "homebrew"]) {
      expect(jobs[id], id).toContain("TAG: ${{ needs.verify.outputs.tag }}");
      expect(jobs[id], id).not.toContain("refs/tags/${{");
      expect(jobs[id], id).not.toContain("inputs.tag");
    }
  });

  test("the publish gate check catches each way around the gate (#544)", () => {
    const text = readRepo(".github/workflows/publish.yml");
    const edited = (from, to) => {
      expect(text).toContain(from);
      return publishGateProblems(text.replace(from, to));
    };
    // A condition or continue-on-error that runs past a failure.
    for (const condition of ["${{ always() }}", "${{ !cancelled() }}", "failure() || success()"]) {
      expect(edited("    environment: npm\n", `    if: ${condition}\n    environment: npm\n`)).toEqual([`publish has if: ${condition}`]);
    }
    expect(edited("      - name: Publish to npm\n", "      - name: Publish to npm\n        if: always()\n")).toEqual(["publish has if: always()"]);
    expect(edited("        run: node scripts/publish-gate.js verify\n", "        continue-on-error: true\n        run: node scripts/publish-gate.js verify\n")).toEqual([
      "verify has continue-on-error: true"
    ]);
    // publish must reach both gate jobs, directly or through the jobs it needs.
    expect(edited("    needs: [verify, ci, release-assets]\n", "    needs: [verify, binaries]\n")).toEqual(["publish does not need ci"]);
    expect(edited("    needs: [verify, ci, release-assets]\n", "    needs: [release-assets]\n")).toEqual([]);
    expect(edited("    needs: [verify, ci, release-assets]\n", "")).toEqual([
      "publish does not need verify",
      "publish does not need ci"
    ]);
    // A package publish in any other job, however it is written.
    const sneak = (command) => edited("      - name: Keep the checksums for the tap\n", `      - name: Ship it\n        run: ${command}\n\n      - name: Keep the checksums for the tap\n`);
    for (const command of ["npm publish", "npm publish --provenance --access public", "npm  publish --tag next", "cd dist && npm publish", "pnpm publish", "bun publish"]) {
      expect(sneak(command), command).toEqual(["release-assets runs a package publish"]);
    }
    expect(edited("          npm publish\n", "          npm publish --provenance --access public\n")).toEqual([]);
    expect(edited("          npm publish\n", "          echo done\n")).toEqual(["publish does not run npm publish"]);
    // A checkout of anything but the verified commit after verify.
    expect(edited("          ref: ${{ needs.verify.outputs.sha }}\n", "          ref: refs/tags/${{ env.TAG }}\n")).toEqual([
      "binaries checks out refs/tags/${{ env.TAG }}, not the verified commit"
    ]);
    expect(edited("          ref: ${{ needs.verify.outputs.sha }}\n", "")).toEqual(["binaries checks out the run's ref, not the verified commit"]);
    expect(edited("          fetch-depth: 0\n", "          fetch-depth: 0\n          ref: ${{ inputs.tag }}\n")).toEqual([
      "verify checks out ${{ inputs.tag }}, not the workflow's own commit"
    ]);
  });

  test("release-assets attaches nothing once the tag has moved (#544)", () => {
    const jobs = workflowJobs(readRepo(".github/workflows/publish.yml"));
    expect(jobs["release-assets"]).toContain("RELEASE_SHA: ${{ needs.verify.outputs.sha }}");
    const match = /- name: Attach the binaries and skill zips to the GitHub release\n(?:.*\n)*? {8}run: \|\n((?: {10}.*\n)+)/.exec(jobs["release-assets"]);
    const script = match[1].replace(/^ {10}/gm, "");
    // Runs the step with a fake gh that logs its calls and names `tagged` as
    // the tag's commit, or fails the lookup when tagged is empty.
    const attach = (tagged) => {
      const bin = makeTempDir("fake-gh-");
      const log = path.join(bin, "gh.log");
      fs.writeFileSync(
        path.join(bin, "gh"),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\ncase "$1" in\n  api) [ -n "$TAGGED" ] || exit 1; printf '%s\\n' "$TAGGED" ;;\nesac\n`,
        { mode: 0o755 }
      );
      const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
        encoding: "utf8",
        env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, TAG: "v1.2.3", RELEASE_SHA: "a".repeat(40), GITHUB_REPOSITORY: "danjdewhurst/story-skills", TAGGED: tagged }
      });
      return { status: result.status, out: result.stdout, calls: fs.readFileSync(log, "utf8").trim().split("\n") };
    };
    const same = attach("a".repeat(40));
    expect(same.status).toBe(0);
    expect(same.calls).toEqual([
      "release view v1.2.3 --repo danjdewhurst/story-skills",
      "api repos/danjdewhurst/story-skills/commits/refs/tags/v1.2.3 --jq .sha",
      "release upload v1.2.3 dist/binaries/* --repo danjdewhurst/story-skills --clobber"
    ]);
    const moved = attach("b".repeat(40));
    expect(moved.status).toBe(1);
    expect(moved.out).toContain(`::error::Tag v1.2.3 now points at ${"b".repeat(40)}, not ${"a".repeat(40)}, the commit this run built and checked. Nothing was attached.`);
    expect(moved.calls.some((call) => call.startsWith("release upload"))).toBe(false);
    const unreadable = attach("");
    expect(unreadable.status).not.toBe(0);
    expect(unreadable.calls.some((call) => call.startsWith("release upload"))).toBe(false);
  });

  test("the gate's CI lookup matches ci.yml, whose main runs never cancel each other (#544)", () => {
    // publish-gate.js asks for ci.yml's push runs on main by file name.
    expect(readRepo("scripts/publish-gate.js")).toContain('const CI_WORKFLOW = "ci.yml";');
    const ci = readRepo(".github/workflows/ci.yml");
    expect(ci).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]\n/m);
    // Pull requests share a group per ref and cancel; each push gets its own
    // group, so a later push neither cancels a main run nor leaves it pending.
    expect(ci).toContain("concurrency:\n  group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.sha }}\n");
    expect(ci).toContain("  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n");
  });

  test("ci runs the release-gate checks and the Node fallback", () => {
    const ci = readRepo(".github/workflows/ci.yml");
    for (const step of ["bun run check:metadata", "bun run check:evals", "bun run test:coverage", "bun run test:examples"]) {
      expect(ci).toContain(step);
    }
    expect(ci).toContain("node skills/story-maintenance/scripts/story.js");
  });

  test("ci runs the source and fallback CLIs on the lowest supported Node", () => {
    const ci = readRepo(".github/workflows/ci.yml");
    const floor = /^>=(\d+)$/.exec(JSON.parse(readRepo("package.json")).engines.node)[1];
    expect(ci).toMatch(new RegExp(`node: \\[[^\\]]*"${floor}"`));
    expect(ci).toContain("node scripts/check-examples.js");
    expect(ci).toContain("node bin/story.js validate");
  });

  test("story templates invoke the deterministic story checks", () => {
    // story check runs validate, links, and continuity in one scan.
    for (const relativePath of ["templates/github/story-checks.yml", "templates/github/review-copy.yml"]) {
      expect(readRepo(relativePath)).toContain("story check \"$STORY_DIR\"");
    }
    // The draft workflow tells the agent to run story check, and its publish
    // gate runs each check on its own so the pull request lists each result.
    const draft = readRepo("templates/github/draft-next-chapter.yml");
    expect(draft).toContain("story check ${{ env.STORY_DIR }}");
    expect(draft).toContain("for check in validate links continuity; do");
  });

  test("story templates install the CLI from npm once per job (#402)", () => {
    const templates = ["templates/github/story-checks.yml", "templates/github/review-copy.yml", "templates/github/draft-next-chapter.yml"];
    // Every "Install the Story CLI" step body, unindented.
    const installScripts = (text) =>
      [...text.matchAll(/- name: Install the Story CLI\n(?:(?! {6}- name:).*\n)*? {8}run: \|\n((?: {10}.*\n)+)/g)].map(([, body]) => body.replace(/^ {10}/gm, ""));
    // Runs a step with a fake npm that records its arguments.
    const runInstall = (script, env) => {
      const bin = makeTempDir("fake-npm-");
      const log = path.join(bin, "npm.log");
      fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\n`, { mode: 0o755 });
      const runnerTemp = makeTempDir("runner-");
      const githubPath = path.join(runnerTemp, "github-path");
      const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
        encoding: "utf8",
        env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, RUNNER_TEMP: runnerTemp, GITHUB_PATH: githubPath, ...env }
      });
      expect(result.status, result.stderr).toBe(0);
      return { args: fs.readFileSync(log, "utf8").trim().split("\n"), path: fs.readFileSync(githubPath, "utf8").trim(), runnerTemp };
    };
    for (const relativePath of templates) {
      const text = readRepo(relativePath);
      expect(/npx --(?:yes|package)/.test(text), relativePath).toBe(false);
      expect(/^\s*STORY_PACKAGE:/m.test(text), relativePath).toBe(false);
      const jobs = text.match(/^ {4}runs-on:/gm).length;
      const scripts = installScripts(text);
      // review-copy's deploy job runs no story command, so it installs nothing.
      expect(scripts.length, relativePath).toBe(relativePath.endsWith("review-copy.yml") ? jobs - 1 : jobs);
      for (const script of scripts) {
        const npm = runInstall(script, { STORY_VERSION: "1.2.3" });
        expect(npm.args).toEqual(["install", "--global", "--prefix", `${npm.runnerTemp}/story-cli`, "story-skills@1.2.3"]);
        expect(npm.path).toBe(`${npm.runnerTemp}/story-cli/bin`);
        // The documented opt-in installs from a git ref instead.
        const git = runInstall(script, { STORY_VERSION: "1.2.3", STORY_PACKAGE: "github:danjdewhurst/story-skills#main" });
        expect(git.args.at(-1)).toBe("github:danjdewhurst/story-skills#main");
      }
      // Every step that runs story comes after the job's install step.
      for (const job of text.split(/\n {2}(?=[a-z][\w-]*:\n {4})/).slice(1)) {
        const firstStory = job.search(/(?:^\s*(?:run: )?|\$\(|\|\| )story [a-z"$]/m);
        if (firstStory !== -1) {
          const install = job.indexOf("- name: Install the Story CLI");
          expect(install, relativePath).toBeGreaterThan(-1);
          expect(install, relativePath).toBeLessThan(firstStory);
        }
      }
    }
  });

  test("the review copy template builds html and publishes it with Pages", () => {
    const template = readRepo("templates/github/review-copy.yml");
    expect(template).toContain("story build \"$STORY_DIR\" --format html");
    expect(template).toContain("actions/deploy-pages@");
    expect(template).toContain("pages: write");
    const note = readRepo("templates/github/ISSUE_TEMPLATE/manuscript-note.yml");
    expect(note).toContain("id: anchor");
    expect(note).toContain("ch03-p12");
  });

  test("the review copy leaves out matter whose permission is pending (#558)", () => {
    const template = readRepo("templates/github/review-copy.yml");
    const match = /- name: Build the review copy\n(?:(?! {6}- name:).*\n)*? {8}run: \|\n((?: {10}.*\n)+)/.exec(template);
    expect(match).not.toBeNull();
    const script = match[1].replace(/^ {10}/gm, "");
    // Only the header comment may name the flag, to warn against it.
    expect(script).not.toContain("--include-pending");
    expect(template).toContain("Never add --include-pending to the build step");

    // The step, run as the runner would, with `story` from this checkout.
    const workspace = makeTempDir("review-copy-");
    const { root } = createStoryProject({ cwd: workspace, title: "Quoted", dir: workspace, force: true });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Opening\nnumber: 1\nstatus: draft\nword-count: 2", "\n## Chapter Text\n\nChapter prose.\n");
    writeMarkdown(path.join(root, "matter", "epigraph.md"), "title: Epigraph\nplacement: front\nheading: false\npermission: pending", "\nA line of a song.\n");
    const bin = makeTempDir("fake-story-");
    fs.writeFileSync(path.join(bin, "story"), `#!/bin/sh\nexec "${process.execPath}" "${path.join(repoRoot, "bin", "story.js")}" "$@"\n`, { mode: 0o755 });
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
      cwd: workspace,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, STORY_DIR: ".", GITHUB_SHA: "0123456789abcdef", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "owner/book", GITHUB_WORKSPACE: workspace }
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("warning: matter/epigraph.md permission is still pending, so it is left out; pass --include-pending to include it [permission-pending-left-out]");
    const site = fs.readFileSync(path.join(workspace, "review-site", "index.html"), "utf8");
    expect(site).toContain("Chapter prose.");
    expect(site).not.toContain("A line of a song.");
  });

  test("the review copy names matter waiting for permission whatever STORY_VERSION installs (#558)", () => {
    const template = readRepo("templates/github/review-copy.yml");
    const match = /- name: Look for matter waiting for permission\n(?:(?! {6}- name:).*\n)*? {8}run: \|\n((?: {10}.*\n)+)/.exec(template);
    expect(match).not.toBeNull();
    const script = match[1].replace(/^ {10}/gm, "");
    // It runs before the build, so it warns even when the build fails.
    expect(template.indexOf("- name: Look for matter waiting for permission")).toBeLessThan(template.indexOf("- name: Build the review copy"));
    const run = (cwd) => spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], { cwd, encoding: "utf8", env: { ...process.env, STORY_DIR: "." } });

    const workspace = makeTempDir("review-copy-");
    writeMarkdown(path.join(workspace, "matter", "epigraph.md"), "title: Epigraph\nplacement: front\npermission: pending", "\nA line of a song.\n");
    writeMarkdown(path.join(workspace, "matter", "lyrics.md"), "title: Lyrics\nplacement: back\nPermissions: \"Pending\"", "\nA chorus.\n");
    writeMarkdown(path.join(workspace, "matter", "poem.md"), "title: Poem\nplacement: back\npermission: granted\nrights-holder: Estate", "\nA poem.\n");
    writeMarkdown(path.join(workspace, "matter", "dedication.md"), "title: Dedication\nplacement: front", "\nFor the pending ones.\n");
    const warned = run(workspace);
    expect(warned.status, warned.stderr).toBe(0);
    const note = "has permission pending. Story Skills releases after 0.22.1 leave the page out of the review copy; 0.22.1 and earlier publish it.";
    expect(warned.stdout).toBe(`::warning::./matter/epigraph.md ${note}\n::warning::./matter/lyrics.md ${note}\n`);

    // A project with no matter folder passes quietly.
    const bare = run(makeTempDir("review-copy-"));
    expect(bare.status, bare.stderr).toBe(0);
    expect(bare.stdout).toBe("");
  });

  test("story templates pin STORY_VERSION to the package version", () => {
    const packageJson = JSON.parse(readRepo("package.json"));
    const failures = checkTemplateStoryVersion([], packageJson.version, path.join(repoRoot, "templates", "github"), (filePath) =>
      fs.readFileSync(filePath, "utf8")
    );
    expect(failures).toEqual([]);
  });

  test("doc version examples match the package version", () => {
    const packageJson = JSON.parse(readRepo("package.json"));
    const files = docVersionFiles(repoRoot);
    expect(files).toContain("README.md");
    expect(files).toContain("docs/getting-started.md");
    expect(checkDocVersions([], packageJson.version, files, readRepo)).toEqual([]);
  });

  test("checkDocVersions flags stale version examples with file and line", () => {
    const readFile = (relativePath) => (relativePath === "docs/a.md" ? "intro\nnpm install -g story-skills@0.4.0\n" : "0.5.0\n");
    expect(checkDocVersions([], "0.5.0", ["docs/a.md", "docs/b.md"], readFile)).toEqual([
      "docs/a.md:2 version example mismatch: expected 0.5.0, got 0.4.0"
    ]);
  });

  test("checkTemplateStoryVersion flags missing and stale refs", () => {
    const readFile = (filePath) => (filePath.endsWith("story-checks.yml") ? 'STORY_VERSION: "9.9.9"\n' : "no ref here\n");
    expect(checkTemplateStoryVersion([], "0.5.0", "/templates", readFile)).toEqual([
      "templates/github/story-checks.yml STORY_VERSION mismatch: expected 0.5.0, got 9.9.9",
      "templates/github/draft-next-chapter.yml is missing STORY_VERSION",
      "templates/github/review-copy.yml is missing STORY_VERSION"
    ]);
  });

  test("checkVersionModule matches src/version.js to the package version", () => {
    const packageJson = JSON.parse(readRepo("package.json"));
    expect(checkVersionModule([], packageJson.version, readRepo("src/version.js"))).toEqual([]);
    expect(checkVersionModule([], "0.5.0", 'export const VERSION = "0.4.0";\n')).toEqual([
      "src/version.js VERSION mismatch: expected 0.5.0, got 0.4.0"
    ]);
    expect(checkVersionModule([], "0.5.0", "")).toEqual(["src/version.js is missing export const VERSION"]);
  });

  test("checkFixtureSkill accepts real skills and flags typos", () => {
    const skillsDir = path.join(repoRoot, "skills");
    const exists = (skillPath) => fs.existsSync(skillPath);
    expect(checkFixtureSkill([], skillsDir, "chapter-writing", "canon-keeping", exists)).toEqual([]);
    expect(checkFixtureSkill([], skillsDir, "  ", "canon-keeping", exists)).toEqual([
      "canon-keeping/checks.json: skill must be a non-empty string naming the skill under test"
    ]);
    expect(checkFixtureSkill([], skillsDir, "chapter-writting", "canon-keeping", exists)).toEqual([
      'canon-keeping/checks.json: skill "chapter-writting" does not match a skill in skills/'
    ]);
  });

  test("checkFixtureOverlaps stays quiet on acknowledged collisions", () => {
    const checks = {
      required: ["Petra's brass key", "Thursday"],
      banned: ["brass key", "delve"],
      expected_overlaps: {
        in_input: [["delve"]],
        with_required: [["brass key", "Petra's brass key"]]
      }
    };
    const warnings = [];
    expect(checkFixtureOverlaps([], warnings, "demo", checks, "Petra called on Thursday. Do not delve.")).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("checkFixtureOverlaps warns on a new collision", () => {
    const checks = {
      required: ["Petra's brass key", "the Thursday boat"],
      banned: ["brass key", "Thursday", "it was Petra"],
      expected_overlaps: { with_required: [["brass key", "Petra's brass key"]] }
    };
    const warnings = [];
    expect(checkFixtureOverlaps([], warnings, "demo", checks, "Petra called.")).toEqual([]);
    expect(warnings).toEqual([
      'demo: banned "Thursday" overlaps required "the Thursday boat" — keeping the canon may trip the trap ' +
        "(acknowledge it in expected_overlaps.with_required if it is deliberate)"
    ]);
  });

  test("checkFixtureOverlaps fails on an acknowledgement that no longer collides", () => {
    const checks = {
      required: ["Petra"],
      banned: ["it was Ana", "it was Petra"],
      expected_overlaps: {
        in_input: [["delve"]],
        with_required: [["it was Petra", "Petra"]]
      }
    };
    const warnings = [];
    expect(checkFixtureOverlaps([], warnings, "demo", checks, "Petra called.")).toEqual([
      'demo/checks.json: expected_overlaps.in_input entry ["delve"] no longer collides — remove it',
      'demo/checks.json: expected_overlaps.with_required entry ["it was Petra","Petra"] no longer collides — remove it'
    ]);
    expect(warnings).toEqual([]);
  });

  test("checkFixtureOverlaps rejects a malformed acknowledgement and still warns", () => {
    const checks = {
      required: ["Petra's brass key"],
      banned: ["brass key"],
      expected_overlaps: { with_required: ["brass key"], typo: [] }
    };
    const warnings = [];
    expect(checkFixtureOverlaps([], warnings, "demo", checks, "Petra called.")).toEqual([
      'demo/checks.json: expected_overlaps has unknown key "typo" (known: in_input, with_required)',
      "demo/checks.json: expected_overlaps.with_required must be a list of 2-string entries"
    ]);
    expect(warnings).toHaveLength(1);
  });

  test("draft template skips while a draft PR is open and never runs concurrently", () => {
    const template = readRepo("templates/github/draft-next-chapter.yml");
    expect(topLevelKeys(template)).toContain("concurrency");
    expect(template).toContain("cancel-in-progress: false");
    expect(template).toContain("gh pr list");
    expect(template).toContain('startswith("draft/")');
    // Fork PRs cannot suppress drafting.
    expect(template).toContain("(.isCrossRepository | not)");
    // Every later step of the draft job is gated on it, so a skip is a
    // successful no-op; the publish job runs only when a draft was made.
    const stepsAfterGuard = template.split("id: guard")[1].split("\n  publish:\n")[0].split(/\n\s+- name: /).slice(1);
    expect(stepsAfterGuard.length).toBeGreaterThan(0);
    for (const step of stepsAfterGuard) {
      expect(step).toMatch(/\n\s+if: [^\n]*steps\.guard\.outputs\.skip != 'true'/);
    }
    expect(template).toContain("needs: draft\n    if: needs.draft.outputs.drafted == 'true'");
  });

  test("draft template prompt commands match the allowed-tools rules", () => {
    // Resolve ${{ env.X }} expressions the way Actions does before the agent sees them.
    const raw = readRepo("templates/github/draft-next-chapter.yml");
    // A budget is `${{ inputs.x || 'default' }}`: a scheduled run gets the default.
    const envValue = (name) => {
      const match = new RegExp(`^  ${name}: (?:"([^"]*)"|\\$\\{\\{ inputs\\.\\w+ \\|\\| '([^']*)' \\}\\})$`, "m").exec(raw);
      return match[1] ?? match[2];
    };
    const template = raw.replace(/\$\{\{ env\.(\w+) \}\}/g, (_, name) => envValue(name));
    const prompt = template.split("prompt: |")[1].split("claude_args:")[0];
    const allowed = /--allowedTools "([^"]+)"/.exec(template)[1];
    const bashPrefixes = [...allowed.matchAll(/Bash\(([^)]+)\)/g)].map(([, rule]) => rule.replace(/(:\*| \*)$/, ""));
    // Every story command the prompt tells the agent to run, in backticks or
    // on a line of its own.
    const commands = [...prompt.matchAll(/\bstory (?:next|context|wordcount|reindex|check|validate|links|continuity)\b[^`\n]*/g)].map(([command]) => command.trim());
    expect(commands.length).toBeGreaterThanOrEqual(6);
    for (const command of commands) {
      // Claude Code matches rules against the literal command text, so quotes
      // or shell variables in the prompt would never match an unquoted rule.
      expect(command).not.toMatch(/["'$]/);
      expect(bashPrefixes.some((prefix) => command === prefix || command.startsWith(`${prefix} `)), command).toBe(true);
    }
  });

  test("dependabot keeps pinned actions updated", () => {
    const dependabot = readRepo(".github/dependabot.yml");
    expect(dependabot).toContain("github-actions");
    expect(topLevelKeys(dependabot)).toContain("updates");
    // The templates users copy must get bump pull requests too, grouped with
    // the matching .github/workflows bump so the pins stay equal.
    expect(dependabot).toMatch(/^\s+- "\/"$/m);
    expect(dependabot).toMatch(/^\s+- "\/templates\/github"$/m);
    expect(dependabot).toMatch(/^\s+group-by: dependency-name$/m);
  });
});

describe("eval scripts", () => {
  const nodeScript = (script, args) =>
    spawnSync("node", [path.join(repoRoot, "evals", script), ...args], { cwd: repoRoot, encoding: "utf8" });

  test("fillTemplate keeps $ patterns literal and never re-scans inserted text", () => {
    expect(fillTemplate("A {c} B {d}", { c: "x $' $& $$ {d}", d: "DRAFT" })).toBe("A x $' $& $$ {d} B DRAFT");
    expect(fillTemplate("{a}{missing}", { a: "1" })).toBe("1{missing}");
  });

  test("judge prompt puts the draft in its own slot", () => {
    const prompt = buildJudgePrompt("context with {draft} and $'", "THE DRAFT");
    expect(prompt).toContain("<context>\ncontext with {draft} and $'\n</context>");
    expect(prompt).toContain("<draft>\nTHE DRAFT\n</draft>");
  });

  test("run-skill selects every fixture when none are named", () => {
    // Mirrors `node evals/run-skill.js --no-judge --out DIR`: argv.slice(2)
    // must not carry the script path into the fixture filter.
    const opts = parseRunSkillArgs(["--no-judge", "--out", "/tmp/out"]);
    expect(opts.fixtures).toEqual([]);
    const { names, unknown } = selectFixtures(opts.fixtures);
    expect(names.length).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
    expect(selectFixtures(["canon-keeping", "no-such-fixture"])).toEqual({ names: ["canon-keeping"], unknown: ["no-such-fixture"] });
  });

  test("run-skill rejects an unknown fixture name before calling a model", () => {
    const res = nodeScript("run-skill.js", ["--no-judge", "--out", makeTempDir("story-eval-"), "no-such-fixture"]);
    expect(res.status).toBe(2);
    expect(res.stdout).toContain("unknown fixture(s): no-such-fixture");
  });

  test("compare-outputs reads dir-a and dir-b from the right arguments", () => {
    const dirA = makeTempDir("story-cmp-a-");
    const dirB = makeTempDir("story-cmp-b-");
    const res = nodeScript("compare-outputs.js", [dirA, dirB]);
    // Every fixture lacks drafts, so each is reported missing and the run fails.
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("canon-keeping: FAIL (missing draft in one directory)");
  });

  test("compare-outputs fails when the judge gives no verdict", () => {
    const dirA = makeTempDir("story-cmp-a-");
    const dirB = makeTempDir("story-cmp-b-");
    fs.writeFileSync(path.join(dirA, "canon-keeping.md"), "Draft A.", "utf8");
    fs.writeFileSync(path.join(dirB, "canon-keeping.md"), "Draft B.", "utf8");
    // No `claude` on PATH, so every judge call returns no verdict.
    const res = spawnSync(process.execPath, [path.join(repoRoot, "evals", "compare-outputs.js"), dirA, dirB, "canon-keeping"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: makeTempDir("story-empty-path-") }
    });
    expect(res.stdout).toContain("canon-keeping: FAIL (judge gave no verdict)");
    expect(res.status).toBe(1);
  });

  test("compare-outputs fails when there is nothing to compare", () => {
    const dir = makeTempDir("story-cmp-");
    const unknown = nodeScript("compare-outputs.js", [dir, dir, "no-such-fixture"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stdout).toContain("unknown fixture(s): no-such-fixture");
    expect(nodeScript("compare-outputs.js", [dir]).status).toBe(2);
  });
});

describe("locale-sensitive comparisons", () => {
  test("every runtime call site pins a locale", () => {
    const unpinned = [];
    let total = 0;
    for (const file of runtimeSources()) {
      const relative = path.relative(repoRoot, file);
      for (const site of localeCallSites(fs.readFileSync(file, "utf8"))) {
        total += 1;
        if (!site.pinned) {
          unpinned.push(`${relative}:${site.line} ${site.call}`);
        }
      }
    }
    expect(unpinned).toEqual([]);
    // Keeps the assertion above from passing because the scan matched nothing.
    expect(total).toBeGreaterThan(20);
  });

  test("the scan flags a call that omits the locale", () => {
    const pinning = (source) => localeCallSites(source).map((site) => site.pinned);
    expect(pinning("left.title.localeCompare(right.title, \"en\")")).toEqual([true]);
    expect(pinning("left.title.localeCompare(right.title)")).toEqual([false]);
    expect(pinning("left.localeCompare(right, \"en\", { numeric: true })")).toEqual([true]);
    // A comma inside the compared expression must not be read as the locale.
    expect(pinning("left.localeCompare(pick(right, fallback))")).toEqual([false]);
    expect(pinning("new Intl.Collator(\"en\")")).toEqual([true]);
    expect(pinning("new Intl.Collator()")).toEqual([false]);
    expect(pinning("value.toLocaleUpperCase(\"en\")")).toEqual([true]);
    expect(pinning("value.toLocaleUpperCase()")).toEqual([false]);
    expect(pinning("new Intl.Collator(pack.locale)")).toEqual([true]);
    expect(pinning("value.toLocaleLowerCase(locale)")).toEqual([false]);
    expect(localeCallSites("const label = \"no comparison here\";")).toEqual([]);
  });
});

describe("the published README only links to files the package ships (#401)", () => {
  test("relativeLinks finds markdown and HTML paths, not URLs, anchors, or code", () => {
    const markdown = [
      '<img src="assets/a.svg"> [docs](docs/x.md#part) [site](https://example.com/y.md)',
      "[top](#top) [mail](mailto:a@b.c) [abs](/root.md) [space](docs/a%20b.md)",
      '[titled](CONTRIBUTING.md "Contributing") [angle](<evals/README.md>) <a href=\'SECURITY.md\'>s</a>',
      "[ref]: CODE_OF_CONDUCT.md",
      "[ref-url]: https://example.com/z.md",
      "```shell",
      "[not](code/link.md)",
      "```"
    ].join("\n");
    expect(relativeLinks(markdown)).toEqual([
      "/root.md",
      "CODE_OF_CONDUCT.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "assets/a.svg",
      "docs/a b.md",
      "docs/x.md",
      "evals/README.md"
    ]);
  });

  test("relativeLinks skips inline code, comments, and queries, and keeps root-relative paths", () => {
    const markdown = "`[code](code.md)` <!-- [hidden](hidden.md) --> [q](docs/a.md?plain=1#L2) [root](/AGENTS.md) [cdn](//cdn.example.com/x.js) [bad](100%.md)\n";
    expect(relativeLinks(markdown)).toEqual(["/AGENTS.md", "100%.md", "docs/a.md"]);
  });

  // #569: check:package read only the README, so docs/ shipped about thirty
  // links to files the tarball leaves out.
  test("unshippedLinks checks every shipped markdown file against the shipped files (#569)", () => {
    const texts = {
      "README.md": "[docs](docs/) [guide](docs/guide.md#part) [root](./) [abs](/docs/guide.md)",
      "CHANGELOG.md": "[c](CONTRIBUTING.md#changelog)",
      "docs/guide.md": "[up](../README.md) [agents](../AGENTS.md) [evals](../evals/README.md) [case](Guide.md) [out](../../outside.md) [pkg](..)",
      "skills/demo/SKILL.md": "[ref](references/a.md) [docs](../../docs/guide.md) [test](../../test/demo.test.js)",
      "skills/demo/references/a.md": "fine",
      "bin/story.js": "[not](markdown.md)"
    };
    // A root-relative link resolves from the disk's root in node_modules, so
    // it fails even when the package ships its target.
    expect(unshippedLinks(Object.keys(texts), (file) => texts[file])).toEqual([
      "README.md -> /docs/guide.md",
      "CHANGELOG.md -> CONTRIBUTING.md",
      "docs/guide.md -> ../../outside.md",
      "docs/guide.md -> ../AGENTS.md",
      "docs/guide.md -> ../evals/README.md",
      "docs/guide.md -> Guide.md",
      "skills/demo/SKILL.md -> ../../test/demo.test.js"
    ]);
  });

  test("packageFiles lists every file under a folder but node_modules", () => {
    const dir = makeTempDir("story-package-files-");
    for (const file of ["README.md", "docs/guide.md", "docs/deep/x.md", "node_modules/dep/README.md"]) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), "");
    }
    expect(packageFiles(dir)).toEqual(["README.md", "docs/deep/x.md", "docs/guide.md"]);
  });

  test("every relative link in the shipped markdown is inside package.json files (#569)", () => {
    const pkg = JSON.parse(readRepo("package.json"));
    const shipped = ["package.json", ...pkg.files.flatMap((entry) =>
      fs.statSync(path.join(repoRoot, entry)).isDirectory() ? packageFiles(path.join(repoRoot, entry), `${entry}/`) : [entry]
    )];
    expect(shipped.filter((file) => file.startsWith("docs/") && file.endsWith(".md")).length).toBeGreaterThan(10);
    expect(unshippedLinks(shipped, readRepo)).toEqual([]);
  });

  test("exports exposes package.json and the schemas, not src", () => {
    expect(JSON.parse(readRepo("package.json")).exports).toEqual({
      "./package.json": "./package.json",
      "./schemas/*": "./schemas/*"
    });
  });
});

describe("checkouts drop the token: only draft-next-chapter pushes, with its own (#137, #294)", () => {
  for (const relativePath of [".github/workflows/ci.yml", "templates/github/story-checks.yml", "templates/github/review-copy.yml", "templates/github/draft-next-chapter.yml"]) {
    test(relativePath, () => {
      const blocks = checkoutBlocks(readRepo(relativePath));
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block).toContain("persist-credentials: false");
      }
    });
  }

});

describe("review copy skips the build until a chapter exists (#140)", () => {
  function runGuard(storyDir) {
    const output = path.join(makeTempDir(), "github-output");
    fs.writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", chapterGuardScript()], {
      encoding: "utf8",
      env: { ...process.env, STORY_DIR: storyDir, GITHUB_OUTPUT: output }
    });
    expect(result.status).toBe(0);
    return fs.readFileSync(output, "utf8").trim();
  }

  test("a fresh project has no chapters and an example does", () => {
    const root = makeTempDir();
    const fresh = path.join(root, "fresh");
    const init = spawnSync(process.execPath, [path.join(repoRoot, "bin", "story.js"), "init", "Fresh", "--dir", fresh], { encoding: "utf8" });
    expect(init.status).toBe(0);
    expect(runGuard(fresh)).toBe("has-chapters=false");
    expect(runGuard(path.join(root, "missing"))).toBe("has-chapters=false");
    expect(runGuard(path.join(repoRoot, "examples", "the-last-ember"))).toBe("has-chapters=true");
  });

  test("build, uploads, and deploy are conditional on chapters", () => {
    const text = readRepo("templates/github/review-copy.yml");
    for (const step of ["Build the review copy", "Keep the review copy as a workflow artifact", "Upload the Pages site"]) {
      expect(text).toContain(`- name: ${step}\n        if: steps.chapters.outputs.has-chapters == 'true'`);
    }
    expect(text).toContain("has-chapters: ${{ steps.chapters.outputs.has-chapters }}");
    expect(text).toContain("needs: build\n    if: needs.build.outputs.has-chapters == 'true'");
    expect(readRepo("docs/automation.md")).toContain("`story build` needs at least one chapter");
  });
});

describe("the packed tarball is smoke-tested (#136)", () => {
  test("ci and publish install and run the packed tarball", () => {
    expect(JSON.parse(readRepo("package.json")).scripts["check:package"]).toBe("node scripts/check-package.js");
    expect(readRepo(".github/workflows/ci.yml")).toContain("run: node scripts/check-package.js");
    const publish = readRepo(".github/workflows/publish.yml");
    expect(publish.indexOf("node scripts/check-package.js")).toBeGreaterThan(0);
    expect(publish.indexOf("node scripts/check-package.js")).toBeLessThan(publish.indexOf("npm publish"));
  });

  test("the Windows and macOS jobs install and run the packed tarball too (#573)", () => {
    const jobs = workflowJobs(readRepo(".github/workflows/ci.yml"));
    const macos = jobs["test-os"];
    expect(macos).toContain("os: [macos-latest]");
    expect(macos).not.toContain("windows-latest");
    expect(macos).not.toMatch(/^ {4}if:/m);
    const macosStep = macos.split(/\n(?= {6}- )/).find((text) => text.includes("run: bun run check:package"));
    expect(macosStep).toBeDefined();
    expect(macosStep).not.toMatch(/^\s*if:/m);

    // Shard 1 always exists, so the step if selects that shard and does not skip Windows.
    const windows = jobs["test-windows"];
    expect(windows).toContain("runs-on: windows-latest");
    expect(windows).toContain("shard: [1, 2, 3, 4]");
    expect(windows).not.toMatch(/^ {4}if:/m);
    const windowsStep = windows.split(/\n(?= {6}- )/).find((text) => text.includes("run: bun run check:package"));
    expect(windowsStep).toBeDefined();
    expect(windowsStep).toContain("if: matrix.shard == 1");
  });

  test("Windows shards run every test file exactly once (#672)", () => {
    const jobs = workflowJobs(readRepo(".github/workflows/ci.yml"));
    const windows = jobs["test-windows"];
    const gate = jobs["test-windows-done"];
    const count = Number(/shards: \[(\d+)\]/.exec(windows)[1]);
    const listed = /shard: \[([^\]]+)\]/.exec(windows)[1].split(",").map((value) => Number(value.trim()));
    expect(listed).toEqual(Array.from({ length: count }, (_, index) => index + 1));
    const runStep = windows.split(/\n(?= {6}- )/).find((text) => text.includes("name: Run tests"));
    expect(runStep).toBeDefined();
    // bun run test keeps the package script's glob. A hand-built file list
    // makes bun follow plugins/story-skills and exit ELOOP on Windows.
    expect(runStep).toContain("bun run test -- --shard=");
    expect(runStep).toContain("--timings=");
    expect(runStep).not.toContain("bun test --timeout");
    expect(gate).toMatch(/^ {4}name: Tests windows-latest\n/m);
    expect(gate).toContain("needs: test-windows");
    expect(gate).toContain('"${{ needs.test-windows.result }}" != "success"');
    // test/test-shards.test.js asks bun for four shards.
    expect(count).toBe(4);
  });

  test("the check installs the tarball and runs the installed bin", () => {
    const script = readRepo("scripts/check-package.js");
    for (const fragment of ['"pack"', '"install"', '"--version"', '"validate"', "node_modules"]) {
      expect(script).toContain(fragment);
    }
  });
});

describe("series docs say every linked book must be checked out (#242)", () => {
  test("series and automation docs cover the CI checkout", () => {
    expect(readRepo("docs/series.md")).toContain("Every linked book must be on disk at that path");
    const automation = readRepo("docs/automation.md");
    expect(automation).toContain("Every book a linked series names in `follows` or `precedes` must be in the checkout");
    expect(automation).toContain("is not a story project: missing story.md");
  });
});

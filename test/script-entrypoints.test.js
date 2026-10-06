import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import { buildBundle, buildFallback } from "../scripts/build-fallback.js";
import { TARGETS, archiveName, checksumsName, hostTarget, main as buildBinaries } from "../scripts/build-binaries.js";
import { checkFallback } from "../scripts/check-fallback.js";
import { checkLineThreshold, main as checkCoverageMain, parseGate, USAGE as COVERAGE_USAGE } from "../scripts/check-coverage.js";
import { metadataFailures } from "../scripts/check-metadata.js";
import { checkPackage } from "../scripts/check-package.js";
import { main as homebrewMain } from "../scripts/homebrew-formula.js";
import { FIXTURES_DIR, checkDraft, main as runEvals } from "../evals/run-evals.js";
import { VERSION } from "../src/version.js";

// The scripts' entry points, driven in-process with their external commands
// stubbed: nothing here runs npm, bun build, tar, or a model.

const repoRoot = path.resolve(import.meta.dir, "..");

function capture() {
  const out = [];
  const err = [];
  return {
    log: (line) => out.push(line),
    error: (line) => err.push(line),
    writeError: (text) => err.push(text),
    out: () => out.join("\n"),
    err: () => err.join("\n")
  };
}

function lcovFor(entries) {
  return entries.map(([file, found, hit]) => `TN:\nSF:${file}\nFNF:1\nFNH:1\nLF:${found}\nLH:${hit}\nend_of_record\n`).join("");
}

describe("check-coverage gates", () => {
  test("parses a folder alone as 100% and folder:N as a per-file line floor", () => {
    expect(parseGate("src")).toEqual({ dir: "src", minPercent: null });
    expect(parseGate("scripts:85")).toEqual({ dir: "scripts", minPercent: 85 });
    expect(parseGate("evals:72.5")).toEqual({ dir: "evals", minPercent: 72.5 });
    expect(parseGate("C:\\repo\\src")).toEqual({ dir: "C:\\repo\\src", minPercent: null });
    expect(() => parseGate("evals:101")).toThrow('Coverage threshold for evals must be a number from 0 to 100, got "101"');
    expect(() => parseGate("scripts:abc")).toThrow('got "abc"');
    expect(() => parseGate("scripts:")).toThrow('got ""');
  });

  test("a line floor fails low and missing files, and passes an empty one", () => {
    const low = path.join(repoRoot, "scripts", "low.js");
    const ok = path.join(repoRoot, "scripts", "ok.js");
    const empty = path.join(repoRoot, "scripts", "empty.js");
    const missing = path.join(repoRoot, "scripts", "missing.js");
    const lcov = lcovFor([[low, 10, 7], [ok, 10, 9], [empty, 0, 0]]);
    expect(checkLineThreshold(lcov, [low, ok, empty, missing], 85)).toEqual({
      failures: [`${low} line coverage 70.0% (7/10) is below 85%`, `${missing} has no coverage record`],
      filesChecked: 4
    });
  });

  test("main gates each folder and reports what it checked", () => {
    const dir = makeTempDir("story-coverage-");
    fs.mkdirSync(path.join(dir, "full"));
    fs.mkdirSync(path.join(dir, "partial"));
    const fullFile = path.join(dir, "full", "a.js");
    const partialFile = path.join(dir, "partial", "b.js");
    fs.writeFileSync(fullFile, "");
    fs.writeFileSync(partialFile, "");
    const lcovPath = path.join(dir, "lcov.info");
    const run = (lcov, ...gates) => {
      fs.writeFileSync(lcovPath, lcov);
      const io = capture();
      return { status: checkCoverageMain([lcovPath, ...gates], io), out: io.out(), err: io.err() };
    };

    const passing = run(lcovFor([[fullFile, 4, 4], [partialFile, 10, 9]]), path.join(dir, "full"), `${path.join(dir, "partial")}:80`);
    expect(passing.status).toBe(0);
    expect(passing.out).toContain(`Coverage is 100% for ${path.join(dir, "full")} line and function coverage; branch coverage is not gated.`);
    expect(passing.out).toContain(`Line coverage is at least 80% for every file in ${path.join(dir, "partial")}.`);
    expect(passing.err).toBe("");

    // #570: branch records never claim or fail a branch gate.
    const branches = run(`TN:\nSF:${fullFile}\nFNF:0\nFNH:0\nLF:1\nLH:1\nBRDA:1,0,0,-\nBRF:1\nBRH:0\nend_of_record\n`, path.join(dir, "full"));
    expect(branches).toEqual({
      status: 0,
      out: `Coverage is 100% for ${path.join(dir, "full")} line and function coverage; branch coverage is not gated.`,
      err: ""
    });

    const failing = run(lcovFor([[fullFile, 4, 3], [partialFile, 10, 5]]), path.join(dir, "full"), `${path.join(dir, "partial")}:80`);
    expect(failing.status).toBe(1);
    expect(failing.err).toBe(
      `Coverage is below the gate:\n${fullFile} line coverage 3/4\n${partialFile} line coverage 50.0% (5/10) is below 80%`
    );

    expect(run("", `${dir}:900`)).toMatchObject({ status: 1, err: `Coverage threshold for ${dir} must be a number from 0 to 100, got "900"` });
    const missingDir = path.join(dir, "nope");
    expect(run("", `${missingDir}:80`)).toMatchObject({ status: 1, err: `Coverage folder ${missingDir} does not exist` });
    expect(run("", fullFile)).toMatchObject({ status: 1, err: `Coverage folder ${fullFile} does not exist` });
    const io = capture();
    expect(checkCoverageMain([lcovPath], io)).toBe(1);
    expect(io.err()).toBe(COVERAGE_USAGE);
  });
});

describe("check-metadata", () => {
  test("the repository's metadata is aligned", () => {
    const { failures, packageJson } = metadataFailures(repoRoot);
    expect(failures).toEqual([]);
    expect(packageJson.version).toBe(VERSION);
  });

  // #570: only ci.yml was read, so a drifted publish.yml passed.
  test("reads every workflow, publish.yml included (#570)", () => {
    const root = makeTempDir("story-metadata-");
    const copy = (relativePath, filter) =>
      fs.cpSync(path.join(repoRoot, relativePath), path.join(root, relativePath), { recursive: true, filter });
    for (const relativePath of [
      "package.json", "CHANGELOG.md", "README.md", "src/version.js", "docs", "templates/github",
      ".github/workflows", ".codex-plugin", ".claude-plugin", ".agents"
    ]) {
      copy(relativePath);
    }
    copy("skills", (source) => fs.statSync(source).isDirectory() || path.basename(source) === "SKILL.md");
    fs.mkdirSync(path.join(root, "plugins", "story-skills"), { recursive: true });
    expect(metadataFailures(root).failures).toEqual([]);

    const pinned = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).packageManager.replace("bun@", "");
    const publishPath = path.join(root, ".github", "workflows", "publish.yml");
    const publish = fs.readFileSync(publishPath, "utf8");
    const line = publish.split("\n").findIndex((text) => text.trim() === `bun-version: ${pinned}`) + 1;
    expect(line).toBeGreaterThan(0);
    fs.writeFileSync(publishPath, publish.replace(`bun-version: ${pinned}`, "bun-version: 1.0.0"));
    expect(metadataFailures(root).failures).toEqual([
      `.github/workflows/publish.yml:${line} bun-version mismatch: expected ${pinned}, got 1.0.0`
    ]);
  });
});

describe("homebrew-formula entry point", () => {
  test("writes the formula from a checksums file and refuses missing arguments", () => {
    const dir = makeTempDir("story-brew-");
    const checksums = path.join(dir, "checksums.txt");
    const lines = TARGETS.map((target) => `${"a".repeat(64)}  ${archiveName("1.2.3", target)}\n`);
    fs.writeFileSync(checksums, lines.join(""));
    let written = "";
    homebrewMain(["1.2.3", checksums], (text) => {
      written += text;
    });
    expect(written).toContain('version "1.2.3"');
    expect(() => homebrewMain(["1.2.3"])).toThrow("usage: node scripts/homebrew-formula.js <version> <checksums-file>");
  });
});

describe("build-binaries entry point", () => {
  // Writes the file each command would have produced.
  function fakeSpawn(calls) {
    return (command, args, options) => {
      calls.push([command, ...args].join(" "));
      if (command === "bun") {
        fs.writeFileSync(args.find((arg) => arg.startsWith("--outfile=")).slice("--outfile=".length), "binary");
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "tar") {
        fs.writeFileSync(args[1], `tar of ${args[2]} in ${path.basename(options.cwd)}`);
        return { status: 0, stdout: "", stderr: "" };
      }
      // The smoke test runs the built executable.
      return { status: 0, stdout: args[0] === "--version" ? `${VERSION}\n` : "Project is valid", stderr: "" };
    };
  }

  test("builds, smoke-tests, archives, and writes checksums", () => {
    const out = path.join(makeTempDir("story-binaries-"), "dist");
    const calls = [];
    const io = capture();
    // A second target that is never the host, so one build archives as a zip
    // and the other as a tarball on any machine.
    const host = hostTarget();
    const other = TARGETS.find((target) => target.name === (host.os === "windows" ? "linux-x64" : "windows-x64"));
    buildBinaries(["--host", "--smoke", "--target", other.name, "--out", out], { spawn: fakeSpawn(calls), log: io.log });
    const files = fs.readdirSync(out).sort();
    expect(files).toEqual([archiveName(VERSION, host), archiveName(VERSION, other), checksumsName(VERSION)].sort());
    expect(calls.filter((call) => call.startsWith("bun build"))).toHaveLength(2);
    expect(calls.some((call) => call.endsWith(" --version"))).toBe(true);
    expect(io.out()).toContain(`Smoke-tested ${host.name}`);
    expect(io.out()).toContain(`Wrote ${path.join(out, checksumsName(VERSION))}`);
    const checksums = fs.readFileSync(path.join(out, checksumsName(VERSION)), "utf8");
    expect(checksums.trim().split("\n")).toHaveLength(2);
  });

  test("a failed compile stops the build", () => {
    const out = makeTempDir("story-binaries-");
    const failing = () => ({ status: 1, stdout: "", stderr: "compile error" });
    expect(() => buildBinaries(["--target", "linux-x64", "--out", out], { spawn: failing, log: () => {} })).toThrow(
      "failed: compile error"
    );
    const missing = () => ({ error: new Error("spawnSync bun ENOENT"), status: null });
    expect(() => buildBinaries(["--target", "linux-x64", "--out", out], { spawn: missing, log: () => {} })).toThrow(
      "failed: spawnSync bun ENOENT"
    );
  });
});

describe("check-package entry point", () => {
  // Stands in for npm: `install` links `source` in as the installed package.
  function fakeNpm(source, { version = VERSION } = {}) {
    const calls = [];
    const run = (command, args, cwd) => {
      calls.push([path.basename(command), ...args]);
      if (args[0] === "pack") return '[{ "filename": "story-skills-test.tgz" }]';
      if (args[0] === "install") {
        fs.mkdirSync(path.join(cwd, "node_modules"), { recursive: true });
        fs.symlinkSync(source, path.join(cwd, "node_modules", "story-skills"), "dir");
        return "";
      }
      if (args[0] === "--version") return `${version}\n`;
      return "";
    };
    return { run, calls };
  }

  function fakePackage({ readme = "See [the docs](docs/README.md).\n", exportsField = true } = {}) {
    const dir = makeTempDir("story-fake-package-");
    const pkg = { name: "story-skills", version: VERSION };
    if (exportsField) pkg.exports = { "./package.json": "./package.json", "./schemas/*": "./schemas/*" };
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
    fs.writeFileSync(path.join(dir, "README.md"), readme);
    for (const file of ["docs/README.md", "schemas/story.schema.json", "schemas/result.schema.json", "src/cli.js"]) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), "{}");
    }
    return dir;
  }

  test("passes a package that installs, runs, and exports only what it should", () => {
    const npm = fakeNpm(fakePackage());
    const io = capture();
    const status = checkPackage({ run: npm.run, root: repoRoot, ...io });
    expect(io.err()).toBe("");
    expect(status).toBe(0);
    expect(io.out()).toBe(`Packed tarball story-skills-test.tgz installs and runs story ${VERSION}`);
    expect(npm.calls.map((call) => call[1])).toEqual(["pack", "install", "--version", "validate", expect.stringContaining("story.js")]);
  });

  const failures = [
    ["a wrong version", () => fakeNpm(fakePackage(), { version: "0.0.0" }), `Installed story --version printed "0.0.0", expected ${VERSION}`],
    ["a README link to an unshipped file", () => fakeNpm(fakePackage({ readme: "[guide](CONTRIBUTING.md)\n" })), "README links to files the package does not ship: CONTRIBUTING.md"],
    ["an exported src/", () => fakeNpm(fakePackage({ exportsField: false })), "story-skills/src/cli.js resolves, but src/ should not be exported"]
  ];
  for (const [name, npm, message] of failures) {
    test(`fails ${name}`, () => {
      const io = capture();
      expect(checkPackage({ run: npm().run, root: repoRoot, ...io })).toBe(1);
      expect(io.err()).toBe(`Package check failed: ${message}`);
    });
  }
});

describe("fallback build and check entry points", () => {
  test("buildBundle bundles bin/story.js for Node from the repository root", () => {
    const calls = [];
    buildBundle("/tmp/out.js", (...args) => calls.push(args));
    expect(calls).toEqual([
      ["bun", ["build", "./bin/story.js", "--target=node", "--outfile=/tmp/out.js"], { cwd: repoRoot, encoding: "utf8" }]
    ]);
  });

  test("build-fallback reports the built file or the build's error output", () => {
    const io = capture();
    expect(buildFallback({ build: () => ({ status: 0 }), ...io })).toBe(0);
    expect(io.out()).toBe("Built skills/story-maintenance/scripts/story.js.");
    expect(buildFallback({ build: () => ({ status: 2, stderr: "bad import" }), ...io })).toBe(2);
    expect(buildFallback({ build: () => ({ status: null, stdout: "" }), ...io })).toBe(1);
    expect(io.err()).toBe("bad import\n");
  });

  test("check-fallback compares a fresh build with the committed bundle", () => {
    const committedPath = path.join(makeTempDir("story-fallback-"), "story.js");
    fs.writeFileSync(committedPath, "bundle v1");
    const building = (text) => (outFile) => {
      fs.writeFileSync(outFile, text);
      return { status: 0 };
    };
    const check = (build) => {
      const io = capture();
      return { status: checkFallback({ build, committedPath, ...io }), out: io.out(), err: io.err() };
    };

    expect(check(building("bundle v1"))).toEqual({ status: 0, out: "Bundled story-maintenance fallback is up to date.", err: "" });
    const stale = check(building("bundle v2"));
    expect(stale.status).toBe(1);
    expect(stale.err).toContain("is out of date");
    expect(stale.err).toContain("Run: bun run build:fallback");
    expect(check(() => ({ status: 3, stderr: "syntax error" }))).toEqual({ status: 3, out: "", err: "syntax error" });
    const missing = check(() => ({ error: Object.assign(new Error("spawnSync bun ENOENT"), { code: "ENOENT" }), status: null }));
    expect(missing.status).toBe(1);
    expect(missing.err).toContain("https://bun.sh");
    expect(() => check(() => ({ error: new Error("EACCES"), status: null }))).toThrow("EACCES");
  });
});

describe("run-evals entry point", () => {
  let lines;
  let originalLog;
  beforeEach(() => {
    lines = [];
    originalLog = console.log;
    console.log = (...args) => lines.push(args.join(" "));
  });
  afterEach(() => {
    console.log = originalLog;
  });

  test("checks every known-good example and fails a missing draft", () => {
    expect(runEvals(["run-evals.js", "--all", path.join(repoRoot, "evals", "examples")])).toBe(0);
    expect(lines.some((line) => line.startsWith("canon-keeping: "))).toBe(true);
    lines.length = 0;
    expect(runEvals(["run-evals.js", "--all", makeTempDir("story-evals-")])).toBe(1);
    expect(lines.join("\n")).toContain("canon-keeping: FAIL (no draft at");
  });

  test("checks one draft, and reports usage and unreadable input", () => {
    const fixture = path.join(FIXTURES_DIR, "canon-keeping");
    const dir = makeTempDir("story-evals-");
    const draft = path.join(dir, "draft.md");
    fs.writeFileSync(draft, "A ghost told Petra about the key.\n");
    expect(runEvals(["run-evals.js", fixture, path.join(repoRoot, "evals", "examples", "canon-keeping.md")])).toBe(0);
    expect(runEvals(["run-evals.js", fixture, draft])).toBe(1);
    expect(lines.join("\n")).toContain('FAIL trap avoided: "ghost"');
    expect(runEvals(["run-evals.js", fixture, path.join(dir, "missing.md")])).toBe(2);
    expect(lines.at(-1)).toStartWith("FAIL (bad fixture or draft:");
    expect(runEvals(["run-evals.js"])).toBe(2);
    expect(lines.at(-1)).toStartWith("Usage:");
  });
});

describe("checkDraft structural and voice checks", () => {
  const descriptions = (checks, input, draft) =>
    checkDraft(checks, input, draft).map(([ok, desc]) => `${ok ? "PASS" : "FAIL"} ${desc}`);

  test("reports malformed checks instead of throwing", () => {
    const results = descriptions({ required: [3], banned: [null], banned_regex: [1, "(open"] }, "", "Text.");
    expect(results).toContain("FAIL required canon must be a string, got 3");
    expect(results).toContain("FAIL banned phrase must be a string, got null");
    expect(results).toContain("FAIL banned pattern must be a string, got 1");
    expect(results.some((line) => line.startsWith("FAIL banned pattern invalid: /(open/"))).toBe(true);
  });

  test("counts paragraphs and lines and checks the closing question", () => {
    const draft = "One line.\nTwo lines?\n\nSecond paragraph?\n";
    const results = descriptions({ paragraphs: 2, lines: 4, ends_with_question: true }, "", draft);
    expect(results).toContain("PASS structure: 2 paragraph(s), brief asks for 2");
    expect(results).toContain("FAIL structure: 3 line(s), brief asks for 4");
    expect(results).toContain("PASS structure: ends on a question");
  });

  test("flags stripped voice, notes an overshoot, and rejects bad markers", () => {
    const input = "I can't say. I won't. I'd guess it's late, I think.";
    const flat = "The hour was late. The keeper waited by the lamp.";
    const results = descriptions(
      { voice_drift: { contraction_rate: 5, mean_word_length: 0.1, hedge_rate: 100, tone: 1, first_person_rate: "x" } },
      input,
      flat
    );
    expect(results.some((line) => /^FAIL voice kept: contraction_rate .* \(voice stripped\)$/.test(line))).toBe(true);
    expect(results.some((line) => /^PASS voice kept: hedge_rate /.test(line))).toBe(true);
    expect(results.some((line) => line.startsWith('FAIL voice kept: unknown marker "tone"'))).toBe(true);
    expect(results).toContain("FAIL voice kept: limit for first_person_rate must be a number, got x");
    const overshoot = descriptions({ voice_drift: { contraction_rate: 1 } }, flat, input);
    expect(overshoot.some((line) => /^PASS voice note \(warn\): contraction_rate .* \(overshoot, not stripping\)$/.test(line))).toBe(true);
  });
});

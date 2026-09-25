import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkCoverage, parseLcov } from "../scripts/check-coverage.js";
import { collectResult, compareFindings } from "../scripts/check-examples.js";
import { docVersionFiles } from "../scripts/doc-versions.js";
import { checkDocVersions, checkMarketplaces, checkSkillFrontmatter, checkTemplateStoryRef, checkVersionModule, expectEqual } from "../scripts/check-metadata.js";
import { checkFixtureSkill } from "../scripts/check-evals.js";
import { PREFLIGHT } from "../scripts/release.js";
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

describe("release preflight", () => {
  test("gates on test:coverage", () => {
    expect(PREFLIGHT).toContain("test:coverage");
    expect(PREFLIGHT).toContain("check:metadata");
    expect(PREFLIGHT).toContain("check:evals");
    expect(PREFLIGHT).toContain("test:examples");
  });
});

describe("check-coverage", () => {
  test("parses BRDA branch records for real", () => {
    const records = parseLcov(
      "TN:\nSF:/repo/src/a.js\nBRDA:10,0,0,1\nBRDA:10,0,1,-\nBRDA:12,1,0,3\n" +
      "LF:5\nLH:5\nFNF:1\nFNH:1\nBRF:3\nBRH:2\nend_of_record\n"
    );
    const record = records.get("/repo/src/a.js");
    expect(record.hasBranchData).toBe(true);
    expect(record.branches).toEqual({ found: 3, hit: 2 });
  });

  test("counts BRDA lines when BRF/BRH summaries are absent", () => {
    const records = parseLcov("TN:\nSF:/repo/src/a.js\nBRDA:1,0,0,2\nBRDA:2,0,0,-\nLF:2\nLH:2\nFNF:0\nFNH:0\nend_of_record\n");
    const record = records.get("/repo/src/a.js");
    expect(record.hasBranchData).toBe(true);
    expect(record.branches).toEqual({ found: 2, hit: 1 });
  });

  test("marks files without branch records as having no branch data", () => {
    const records = parseLcov("TN:\nSF:/repo/src/a.js\nLF:2\nLH:2\nFNF:0\nFNH:0\nend_of_record\n");
    const record = records.get("/repo/src/a.js");
    expect(record.hasBranchData).toBe(false);
  });

  test("passes full line and function coverage, gating branches only when records exist", () => {
    const file = path.join(repoRoot, "src", "a.js");
    const lcov = lcovRecord(file, { branches: ["1", "2"] });
    expect(checkCoverage(lcov, [file])).toEqual({ failures: [], filesWithBranches: 1, filesChecked: 1 });
  });

  test("fails a file with an untaken branch", () => {
    const file = path.join(repoRoot, "src", "a.js");
    const { failures, filesWithBranches } = checkCoverage(lcovRecord(file, { branches: ["1", "-"] }), [file]);
    expect(filesWithBranches).toBe(1);
    expect(failures).toEqual([`${file} branch coverage 1/2`]);
  });

  test("skips the branch gate only when the report has no branch records", () => {
    // Bun's lcov reporter emits no BRDA/BRF/BRH records, which is the only
    // case this skip is for; check-coverage.js prints a skip note in main().
    const file = path.join(repoRoot, "src", "a.js");
    const result = checkCoverage(lcovRecord(file), [file]);
    expect(result).toEqual({ failures: [], filesWithBranches: 0, filesChecked: 1 });
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-skills-frontmatter-"));
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

describe("check-examples helpers", () => {
  test("collectResult prefixes errors and warnings", () => {
    const failures = collectResult([], "demo", "validate", { errors: ["bad"], warnings: ["meh"] });
    expect(failures).toEqual(["demo validate error: bad", "demo validate warning: meh"]);
  });

  test("compareFindings reports missing and unexpected findings", () => {
    const failures = compareFindings([], "demo", "error", ["a", "b"], ["b", "c"]);
    expect(failures).toEqual([
      "demo continuity is missing expected error: a",
      "demo continuity has unexpected error: c"
    ]);
    expect(compareFindings([], "demo", "warning", ["a"], ["a"])).toEqual([]);
  });
});

describe("github workflows", () => {
  const workflowFiles = [".github/workflows/ci.yml", "templates/github/story-checks.yml", "templates/github/draft-next-chapter.yml", "templates/github/review-copy.yml"];

  test("each workflow declares top-level structure", () => {
    for (const relativePath of workflowFiles) {
      const keys = topLevelKeys(readRepo(relativePath));
      for (const required of ["name", "on", "jobs"]) {
        expect(keys).toContain(required);
      }
    }
  });

  test("every actions reference is SHA-pinned with a version comment", () => {
    // Repo workflow and user-facing templates are all gated: a moving tag
    // must never silently change what any of them run.
    for (const relativePath of workflowFiles) {
      const refs = usesRefs(readRepo(relativePath));
      expect(refs.length, relativePath).toBeGreaterThan(0);
      for (const { ref, comment, line } of refs) {
        expect(`${relativePath}: ${line}`).toContain("#");
        expect(ref).toMatch(/^[\w-]+\/[\w.-]+@[0-9a-f]{40}$/);
        expect(comment).toMatch(/^v\d/);
      }
    }
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
    for (const relativePath of ["templates/github/story-checks.yml", "templates/github/draft-next-chapter.yml", "templates/github/review-copy.yml"]) {
      const template = readRepo(relativePath);
      for (const command of ["story validate", "story links", "story continuity"]) {
        expect(template).toContain(command);
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

  test("story templates pin STORY_REF to the package version", () => {
    const packageJson = JSON.parse(readRepo("package.json"));
    const failures = checkTemplateStoryRef([], packageJson.version, path.join(repoRoot, "templates", "github"), (filePath) =>
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

  test("checkTemplateStoryRef flags missing and stale refs", () => {
    const readFile = (filePath) => (filePath.endsWith("story-checks.yml") ? 'STORY_REF: "v9.9.9"\n' : "no ref here\n");
    expect(checkTemplateStoryRef([], "0.5.0", "/templates", readFile)).toEqual([
      "templates/github/story-checks.yml STORY_REF mismatch: expected v0.5.0, got v9.9.9",
      "templates/github/draft-next-chapter.yml is missing STORY_REF",
      "templates/github/review-copy.yml is missing STORY_REF"
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

  test("draft template skips while a draft PR is open and never runs concurrently", () => {
    const template = readRepo("templates/github/draft-next-chapter.yml");
    expect(topLevelKeys(template)).toContain("concurrency");
    expect(template).toContain("cancel-in-progress: false");
    expect(template).toContain("gh pr list");
    expect(template).toContain('startswith("draft/")');
    // Fork PRs cannot suppress drafting.
    expect(template).toContain("(.isCrossRepository | not)");
    // Every step after the guard is gated on it, so a skip is a successful no-op.
    const stepsAfterGuard = template.split("id: guard")[1].split(/\n\s+- name: /).slice(1);
    expect(stepsAfterGuard.length).toBeGreaterThan(0);
    for (const step of stepsAfterGuard) {
      expect(step).toContain("if: steps.guard.outputs.skip != 'true'");
    }
  });

  test("draft template prompt commands match the allowed-tools rules", () => {
    // Resolve ${{ env.X }} expressions the way Actions does before the agent sees them.
    const raw = readRepo("templates/github/draft-next-chapter.yml");
    const envValue = (name) => new RegExp(`^  ${name}: "([^"]*)"`, "m").exec(raw)[1];
    const template = raw.replace(/\$\{\{ env\.(\w+) \}\}/g, (_, name) => envValue(name));
    const prompt = template.split("prompt: |")[1].split("claude_args:")[0];
    const allowed = /--allowedTools "([^"]+)"/.exec(template)[1];
    const bashPrefixes = [...allowed.matchAll(/Bash\(([^)]+)\)/g)].map(([, rule]) => rule.replace(/(:\*| \*)$/, ""));
    const commands = [...prompt.matchAll(/npx [^`\n]+/g)].map(([command]) => command.trim());
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
    const res = nodeScript("run-skill.js", ["--no-judge", "--out", fs.mkdtempSync(path.join(os.tmpdir(), "story-eval-")), "no-such-fixture"]);
    expect(res.status).toBe(2);
    expect(res.stdout).toContain("unknown fixture(s): no-such-fixture");
  });

  test("compare-outputs reads dir-a and dir-b from the right arguments", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "story-cmp-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "story-cmp-b-"));
    const res = nodeScript("compare-outputs.js", [dirA, dirB]);
    // Every fixture lacks drafts, so each is reported missing and the run fails.
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("canon-keeping: FAIL (missing draft in one directory)");
  });

  test("compare-outputs fails when the judge gives no verdict", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "story-cmp-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "story-cmp-b-"));
    fs.writeFileSync(path.join(dirA, "canon-keeping.md"), "Draft A.", "utf8");
    fs.writeFileSync(path.join(dirB, "canon-keeping.md"), "Draft B.", "utf8");
    // No `claude` on PATH, so every judge call returns no verdict.
    const res = spawnSync(process.execPath, [path.join(repoRoot, "evals", "compare-outputs.js"), dirA, dirB, "canon-keeping"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: fs.mkdtempSync(path.join(os.tmpdir(), "story-empty-path-")) }
    });
    expect(res.stdout).toContain("canon-keeping: FAIL (judge gave no verdict)");
    expect(res.status).toBe(1);
  });

  test("compare-outputs fails when there is nothing to compare", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-cmp-"));
    const unknown = nodeScript("compare-outputs.js", [dir, dir, "no-such-fixture"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stdout).toContain("unknown fixture(s): no-such-fixture");
    expect(nodeScript("compare-outputs.js", [dir]).status).toBe(2);
  });
});

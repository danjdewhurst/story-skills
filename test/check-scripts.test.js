import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkCoverage, parseLcov } from "../scripts/check-coverage.js";
import { collectResult, compareFindings } from "../scripts/check-examples.js";
import { checkMarketplaces, checkSkillFrontmatter, checkTemplateStoryRef, expectEqual } from "../scripts/check-metadata.js";
import { PREFLIGHT } from "../scripts/release.js";

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
  const workflowFiles = [".github/workflows/ci.yml", "templates/github/story-checks.yml", "templates/github/draft-next-chapter.yml"];

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

  test("story templates invoke the deterministic story checks", () => {
    for (const relativePath of ["templates/github/story-checks.yml", "templates/github/draft-next-chapter.yml"]) {
      const template = readRepo(relativePath);
      for (const command of ["story validate", "story links", "story continuity"]) {
        expect(template).toContain(command);
      }
    }
  });

  test("story templates pin STORY_REF to the package version", () => {
    const packageJson = JSON.parse(readRepo("package.json"));
    const failures = checkTemplateStoryRef([], packageJson.version, path.join(repoRoot, "templates", "github"), (filePath) =>
      fs.readFileSync(filePath, "utf8")
    );
    expect(failures).toEqual([]);
  });

  test("checkTemplateStoryRef flags missing and stale refs", () => {
    const readFile = (filePath) => (filePath.endsWith("story-checks.yml") ? 'STORY_REF: "v9.9.9"\n' : "no ref here\n");
    expect(checkTemplateStoryRef([], "0.5.0", "/templates", readFile)).toEqual([
      "templates/github/story-checks.yml STORY_REF mismatch: expected v0.5.0, got v9.9.9",
      "templates/github/draft-next-chapter.yml is missing STORY_REF"
    ]);
  });

  test("dependabot keeps pinned actions updated", () => {
    const dependabot = readRepo(".github/dependabot.yml");
    expect(dependabot).toContain("github-actions");
    expect(topLevelKeys(dependabot)).toContain("updates");
  });
});

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFrontmatter } from "../src/frontmatter.js";
import { parsePinnedBunVersion } from "./bun-pin.js";
import { docVersionFiles, staleDocVersions } from "./doc-versions.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function expectEqual(failures, label, expected, actual) {
  if (actual !== expected) {
    failures.push(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
  return failures;
}

export function checkVersionModule(failures, packageVersion, source) {
  const match = /export const VERSION = "([^"]+)";/.exec(source);
  if (!match) {
    failures.push("src/version.js is missing export const VERSION");
    return failures;
  }
  return expectEqual(failures, "src/version.js VERSION", packageVersion, match[1]);
}

export function checkSkillFrontmatter(failures, skillsDir, readFile) {
  for (const skillName of fs.readdirSync(skillsDir).sort()) {
    const skillDir = path.join(skillsDir, skillName);
    if (!fs.statSync(skillDir).isDirectory()) {
      continue;
    }

    const skillPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      failures.push(`skills/${skillName} is missing SKILL.md`);
      continue;
    }

    const markdown = readFile(skillPath);
    const frontmatter = parseFrontmatter(markdown, skillPath).data;
    expectEqual(failures, `skills/${skillName}/SKILL.md name`, skillName, frontmatter.name);
    if (typeof frontmatter.description !== "string" || frontmatter.description.trim() === "") {
      failures.push(`skills/${skillName}/SKILL.md is missing description`);
    }
  }
  return failures;
}

export function checkTemplateStoryVersion(failures, packageVersion, templatesDir, readFile) {
  for (const name of ["story-checks.yml", "draft-next-chapter.yml", "review-copy.yml"]) {
    const text = readFile(path.join(templatesDir, name));
    const match = /^\s*STORY_VERSION:\s*"([^"]+)"/m.exec(text);
    if (!match) {
      failures.push(`templates/github/${name} is missing STORY_VERSION`);
      continue;
    }
    expectEqual(failures, `templates/github/${name} STORY_VERSION`, packageVersion, match[1]);
  }
  return failures;
}

// The value of a `bun-version:` line, without quotes or a trailing comment.
function bunVersionValue(raw) {
  const value = raw.replace(/(^|\s)#.*$/, "").trim();
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}

// The committed fallback bundle only reproduces byte for byte on the pinned
// Bun, and publish.yml builds the release binaries, so every job in every
// workflow must install the version `packageManager` names. `workflows` maps
// each file name in .github/workflows to its text.
export function checkWorkflowBunPin(failures, packageManager, workflows) {
  const pinned = parsePinnedBunVersion(packageManager);
  if (!pinned) {
    failures.push(`package.json packageManager must pin an exact Bun version, got ${JSON.stringify(packageManager)}`);
    return failures;
  }

  let ciPins = 0;
  for (const [name, text] of Object.entries(workflows)) {
    text.split(/\r?\n/).forEach((line, index) => {
      const match = /^\s*(?:-\s+)?bun-version:(.*)$/.exec(line);
      if (!match) {
        return;
      }
      if (name === "ci.yml") {
        ciPins += 1;
      }
      expectEqual(failures, `.github/workflows/${name}:${index + 1} bun-version`, pinned, bunVersionValue(match[1]));
    });
  }

  if (ciPins === 0) {
    failures.push(".github/workflows/ci.yml is missing bun-version");
  }
  return failures;
}

// Every workflow in .github/workflows, keyed by file name.
export function readWorkflows(root) {
  const dir = path.join(root, ".github", "workflows");
  return Object.fromEntries(
    fs.readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
      .map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")])
  );
}

// docs/development.md tells contributors which Bun to install, so it is the
// one place the pin is written out in prose. Keep it aligned with the pin.
export function checkDocBunPin(failures, packageManager, developmentDoc) {
  const pinned = parsePinnedBunVersion(packageManager);
  if (!pinned) {
    return failures;
  }

  const found = [...developmentDoc.matchAll(/`bun@(\d+\.\d+\.\d+)`/g)].map((match) => match[1]);
  if (found.length === 0) {
    failures.push(`docs/development.md must name the pinned Bun version as \`bun@${pinned}\``);
    return failures;
  }

  for (const version of new Set(found.filter((version) => version !== pinned))) {
    failures.push(`docs/development.md bun pin mismatch: expected ${pinned}, got ${version}`);
  }
  return failures;
}

export function checkDocVersions(failures, packageVersion, relativePaths, readFile) {
  for (const relativePath of relativePaths) {
    for (const { line, found } of staleDocVersions(readFile(relativePath), packageVersion)) {
      failures.push(`${relativePath}:${line} version example mismatch: expected ${packageVersion}, got ${found}`);
    }
  }
  return failures;
}

// The release script moves the Unreleased entries under the new version, so
// the released version must have its own section and compare link.
export function checkChangelogVersion(failures, packageVersion, changelog) {
  const escaped = packageVersion.replaceAll(".", "\\.");
  if (!/^## \[Unreleased\]/m.test(changelog)) {
    failures.push('CHANGELOG.md is missing the "## [Unreleased]" section');
  }
  if (!new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").test(changelog)) {
    failures.push(`CHANGELOG.md is missing a "## [${packageVersion}] - YYYY-MM-DD" section`);
  }
  if (!new RegExp(`^\\[${escaped}\\]: `, "m").test(changelog)) {
    failures.push(`CHANGELOG.md is missing the [${packageVersion}] link reference`);
  }
  return failures;
}

export function checkMarketplaces({ packageName, packageVersion, claudeMarketplace, agentsMarketplace, exists }) {
  const failures = [];

  if (!claudeMarketplace || typeof claudeMarketplace !== "object") {
    failures.push(".claude-plugin/marketplace.json is missing or is not an object");
  } else {
    expectEqual(failures, ".claude-plugin/marketplace.json name", packageName, claudeMarketplace.name);
    if (claudeMarketplace.version !== undefined) {
      expectEqual(failures, ".claude-plugin/marketplace.json version", packageVersion, claudeMarketplace.version);
    }
    const plugins = claudeMarketplace.plugins;
    if (!Array.isArray(plugins)) {
      failures.push(".claude-plugin/marketplace.json plugins must be an array");
    } else {
      if (!plugins.some((plugin) => plugin && plugin.name === packageName)) {
        failures.push(`.claude-plugin/marketplace.json has no plugin named ${packageName}`);
      }
      for (const plugin of plugins) {
        if (plugin && plugin.version !== undefined) {
          expectEqual(failures, `.claude-plugin/marketplace.json plugin ${plugin.name} version`, packageVersion, plugin.version);
        }
      }
    }
  }

  if (!agentsMarketplace || typeof agentsMarketplace !== "object") {
    failures.push(".agents/plugins/marketplace.json is missing or is not an object");
  } else {
    expectEqual(failures, ".agents/plugins/marketplace.json name", packageName, agentsMarketplace.name);
    if (agentsMarketplace.version !== undefined) {
      expectEqual(failures, ".agents/plugins/marketplace.json version", packageVersion, agentsMarketplace.version);
    }
    const plugins = agentsMarketplace.plugins;
    if (!Array.isArray(plugins)) {
      failures.push(".agents/plugins/marketplace.json plugins must be an array");
    } else {
      const entry = plugins.find((plugin) => plugin && plugin.name === packageName);
      if (!entry) {
        failures.push(`.agents/plugins/marketplace.json has no plugin named ${packageName}`);
      } else {
        expectEqual(
          failures,
          ".agents/plugins/marketplace.json plugin source.path",
          "./plugins/story-skills",
          entry.source && entry.source.path
        );
        if (entry.source && entry.source.path === "./plugins/story-skills" && !exists("./plugins/story-skills")) {
          failures.push(".agents/plugins/marketplace.json points at ./plugins/story-skills but that path does not exist");
        }
      }
      for (const plugin of plugins) {
        if (plugin && plugin.version !== undefined) {
          expectEqual(failures, `.agents/plugins/marketplace.json plugin ${plugin.name} version`, packageVersion, plugin.version);
        }
      }
    }
  }

  return failures;
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

// Every metadata check against the checkout at `root`; returns the failures
// and the package.json it read.
export function metadataFailures(root = repoRoot) {
  const failures = [];

  const packageJson = readJson(root, "package.json");
  const codexPlugin = readJson(root, ".codex-plugin/plugin.json");
  const claudePlugin = readJson(root, ".claude-plugin/plugin.json");

  expectEqual(failures, "package.json name", packageJson.name, codexPlugin.name);
  expectEqual(failures, "package.json name", packageJson.name, claudePlugin.name);
  expectEqual(failures, "package/plugin version", packageJson.version, codexPlugin.version);
  expectEqual(failures, "package/plugin version", packageJson.version, claudePlugin.version);

  checkVersionModule(failures, packageJson.version, fs.readFileSync(path.join(root, "src", "version.js"), "utf8"));

  if (codexPlugin.skills !== "./skills/") {
    failures.push(".codex-plugin/plugin.json skills must point to ./skills/");
  }

  checkSkillFrontmatter(failures, path.join(root, "skills"), (filePath) => fs.readFileSync(filePath, "utf8"));

  checkTemplateStoryVersion(failures, packageJson.version, path.join(root, "templates", "github"), (filePath) =>
    fs.readFileSync(filePath, "utf8")
  );

  checkWorkflowBunPin(failures, packageJson.packageManager, readWorkflows(root));

  checkDocBunPin(failures, packageJson.packageManager, fs.readFileSync(path.join(root, "docs", "development.md"), "utf8"));

  checkDocVersions(failures, packageJson.version, docVersionFiles(root), (relativePath) =>
    fs.readFileSync(path.join(root, relativePath), "utf8")
  );

  checkChangelogVersion(failures, packageJson.version, fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"));

  const marketplaceFailures = checkMarketplaces({
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    claudeMarketplace: readJson(root, ".claude-plugin/marketplace.json"),
    agentsMarketplace: readJson(root, ".agents/plugins/marketplace.json"),
    exists: (relativePath) => fs.existsSync(path.join(root, relativePath))
  });
  failures.push(...marketplaceFailures);
  return { failures, packageJson };
}

function main() {
  const { failures, packageJson } = metadataFailures();
  if (failures.length > 0) {
    console.error(`Metadata check failed:\n${failures.join("\n")}`);
    process.exit(1);
  }

  console.log(`Metadata is aligned for ${packageJson.name}@${packageJson.version}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

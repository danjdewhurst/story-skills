#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFrontmatter } from "../src/frontmatter.js";

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

export function checkTemplateStoryRef(failures, packageVersion, templatesDir, readFile) {
  for (const name of ["story-checks.yml", "draft-next-chapter.yml", "review-copy.yml"]) {
    const text = readFile(path.join(templatesDir, name));
    const match = /STORY_REF:\s*"([^"]+)"/.exec(text);
    if (!match) {
      failures.push(`templates/github/${name} is missing STORY_REF`);
      continue;
    }
    expectEqual(failures, `templates/github/${name} STORY_REF`, `v${packageVersion}`, match[1]);
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

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function main() {
  const failures = [];

  const packageJson = readJson("package.json");
  const codexPlugin = readJson(".codex-plugin/plugin.json");
  const claudePlugin = readJson(".claude-plugin/plugin.json");

  expectEqual(failures, "package.json name", packageJson.name, codexPlugin.name);
  expectEqual(failures, "package.json name", packageJson.name, claudePlugin.name);
  expectEqual(failures, "package/plugin version", packageJson.version, codexPlugin.version);
  expectEqual(failures, "package/plugin version", packageJson.version, claudePlugin.version);

  checkVersionModule(failures, packageJson.version, fs.readFileSync(path.join(repoRoot, "src", "version.js"), "utf8"));

  if (codexPlugin.skills !== "./skills/") {
    failures.push(".codex-plugin/plugin.json skills must point to ./skills/");
  }

  checkSkillFrontmatter(failures, path.join(repoRoot, "skills"), (filePath) => fs.readFileSync(filePath, "utf8"));

  checkTemplateStoryRef(failures, packageJson.version, path.join(repoRoot, "templates", "github"), (filePath) =>
    fs.readFileSync(filePath, "utf8")
  );

  const marketplaceFailures = checkMarketplaces({
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    claudeMarketplace: readJson(".claude-plugin/marketplace.json"),
    agentsMarketplace: readJson(".agents/plugins/marketplace.json"),
    exists: (relativePath) => fs.existsSync(path.join(repoRoot, relativePath))
  });
  failures.push(...marketplaceFailures);

  if (failures.length > 0) {
    console.error(`Metadata check failed:\n${failures.join("\n")}`);
    process.exit(1);
  }

  console.log(`Metadata is aligned for ${packageJson.name}@${packageJson.version}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

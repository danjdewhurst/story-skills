#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILES = ["package.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"];
const VERSION_MODULE = "src/version.js";
const FALLBACK_FILE = "skills/story-maintenance/scripts/story.js";
const STORY_REF_FILES = ["templates/github/story-checks.yml", "templates/github/draft-next-chapter.yml"];
const RELEASE_BRANCH = "main";
// test:coverage gates src line and function coverage, then the fallback bundle.
// Branch records are gated only when the lcov report contains them.
export const PREFLIGHT = ["check:metadata", "check:evals", "eval:selftest", "test:coverage", "test:examples", "check:node-help"];

export function isAbsentGitHubRelease(error) {
  const stderr = `${error.stderr ?? ""}\n${error.message ?? ""}`;
  return /release not found/i.test(stderr);
}

// `npm view name@version` exits non-zero with E404 when the package or that
// version has never been published; anything else (auth, network) is a real error.
export function isAbsentNpmVersion(error) {
  const stderr = `${error.stderr ?? ""}\n${error.message ?? ""}`;
  return /\bE404\b/.test(stderr);
}

// --atomic makes the remote accept both refs or neither, so a rejected main
// push (someone pushed during the checks) can never leave a published tag
// pointing at a commit that is not on main.
export function releasePushArgs(tag) {
  return ["push", "--atomic", "origin", RELEASE_BRANCH, tag];
}

export function bumpVersion(current, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) {
    throw new Error(`Current version "${current}" is not a plain MAJOR.MINOR.PATCH version.`);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      if (!/^\d+\.\d+\.\d+$/.test(bump)) {
        throw new Error(`Expected patch, minor, major, or an explicit MAJOR.MINOR.PATCH version, got "${bump}".`);
      }
      if (compareVersions(bump, current) <= 0) {
        throw new Error(`Version ${bump} is not greater than the current version ${current}.`);
      }
      return bump;
  }
}

export function replaceVersion(json, nextVersion) {
  const pattern = /^(\s*"version":\s*")([^"]*)(")/m;
  if (!pattern.test(json)) {
    throw new Error('No top-level "version" field found.');
  }
  return json.replace(pattern, `$1${nextVersion}$3`);
}

function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
  });
}

function git(...args) {
  return run("git", args).trim();
}

function fail(message) {
  console.error(`Release aborted: ${message}`);
  process.exit(1);
}

// The tag push triggers .github/workflows/publish.yml, which publishes to npm
// through trusted publishing. Check here that the version is still free.
function checkNpm(name, nextVersion) {
  let published = "";
  try {
    published = run("npm", ["view", `${name}@${nextVersion}`, "version"]).trim();
  } catch (error) {
    if (!isAbsentNpmVersion(error)) {
      fail(`could not check npm for ${name}@${nextVersion}: ${error.stderr || error.message}`);
    }
  }
  if (published !== "") {
    fail(`${name}@${nextVersion} is already published on npm.`);
  }
}

function preflight(nextVersion, tag, name) {
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== RELEASE_BRANCH) {
    fail(`releases are cut from ${RELEASE_BRANCH}.`);
  }
  if (git("status", "--porcelain") !== "") {
    fail("working tree is not clean. Commit or stash your changes first.");
  }
  git("fetch", "origin", RELEASE_BRANCH, "--tags");
  if (git("rev-parse", "HEAD") !== git("rev-parse", `origin/${RELEASE_BRANCH}`)) {
    fail(`local ${RELEASE_BRANCH} does not match origin/${RELEASE_BRANCH}. Pull or push first.`);
  }
  if (git("tag", "--list", tag) !== "") {
    fail(`tag ${tag} already exists.`);
  }
  try {
    run("gh", ["auth", "status"]);
  } catch {
    fail("gh is not installed or not logged in. Run `gh auth login`.");
  }
  try {
    run("gh", ["release", "view", tag]);
    fail(`GitHub release ${tag} already exists.`);
  } catch (error) {
    if (!isAbsentGitHubRelease(error)) {
      fail(`could not check GitHub release ${tag}: ${error.stderr || error.message}`);
    }
  }
  checkNpm(name, nextVersion);

  for (const script of PREFLIGHT) {
    console.log(`\n> bun run ${script}`);
    run("bun", ["run", script], { inherit: true });
  }
  console.log(`\nPreflight passed for ${nextVersion}.`);
}

export function updateVersionFiles(root, nextVersion) {
  const updated = [];
  for (const relativePath of VERSION_FILES) {
    const filePath = path.join(root, relativePath);
    fs.writeFileSync(filePath, replaceVersion(fs.readFileSync(filePath, "utf8"), nextVersion));
    updated.push(relativePath);
  }
  const modulePath = path.join(root, VERSION_MODULE);
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const versionPattern = /^(export const VERSION = ")[^"]*(";)/m;
  if (!versionPattern.test(moduleSource)) {
    throw new Error(`No VERSION export found in ${VERSION_MODULE}.`);
  }
  fs.writeFileSync(modulePath, moduleSource.replace(versionPattern, `$1${nextVersion}$2`));
  updated.push(VERSION_MODULE);
  for (const relativePath of STORY_REF_FILES) {
    const filePath = path.join(root, relativePath);
    const text = fs.readFileSync(filePath, "utf8");
    const pattern = /^(\s*STORY_REF:\s*")[^"]*(")/m;
    if (!pattern.test(text)) {
      throw new Error(`No STORY_REF found in ${relativePath}.`);
    }
    fs.writeFileSync(filePath, text.replace(pattern, `$1v${nextVersion}$2`));
    updated.push(relativePath);
  }
  return updated;
}

function writeVersions(nextVersion) {
  for (const relativePath of updateVersionFiles(repoRoot, nextVersion)) {
    console.log(`Bumped ${relativePath} to ${nextVersion}`);
  }
  // The bundled fallback inlines src/version.js, so rebuild it with the bump.
  run("bun", ["run", "build:fallback"], { inherit: true });
  run("bun", ["run", "check:metadata"], { inherit: true });
}

function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const [bump] = argv.filter((arg) => !arg.startsWith("--"));
  if (!bump) {
    console.error("Usage: bun run release <patch|minor|major|MAJOR.MINOR.PATCH> [--dry-run]");
    process.exit(1);
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const nextVersion = bumpVersion(packageJson.version, bump);
  const tag = `v${nextVersion}`;
  console.log(`Releasing ${packageJson.version} -> ${nextVersion} (${tag})`);

  preflight(nextVersion, tag, packageJson.name);
  if (dryRun) {
    console.log(`Dry run: would bump ${[...VERSION_FILES, VERSION_MODULE].join(", ")}, rebuild the fallback, commit, tag ${tag}, push, and create the GitHub release. The tag push publishes ${packageJson.name}@${nextVersion} to npm from GitHub Actions.`);
    return;
  }

  writeVersions(nextVersion);
  git("add", ...VERSION_FILES, VERSION_MODULE, FALLBACK_FILE, ...STORY_REF_FILES);
  git("commit", "-m", `chore: release ${nextVersion}`);
  git("tag", "-a", tag, "-m", tag);
  git(...releasePushArgs(tag));
  console.log(`Pushed ${RELEASE_BRANCH} and ${tag}`);

  const releaseUrl = run("gh", ["release", "create", tag, "--title", tag, "--generate-notes", "--verify-tag"]).trim();
  console.log(`Created GitHub release: ${releaseUrl}`);

  console.log(`The Publish workflow is publishing ${packageJson.name}@${nextVersion} to npm: https://github.com/danjdewhurst/story-skills/actions/workflows/publish.yml`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}

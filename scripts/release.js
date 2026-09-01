#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILES = ["package.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"];
const RELEASE_BRANCH = "main";
const PREFLIGHT = ["check:metadata", "test", "check:fallback", "test:examples"];

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

function preflight(nextVersion, tag) {
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
    if (error.status === undefined) {
      throw error;
    }
  }

  for (const script of PREFLIGHT) {
    console.log(`\n> bun run ${script}`);
    run("bun", ["run", script], { inherit: true });
  }
  console.log(`\nPreflight passed for ${nextVersion}.`);
}

function writeVersions(nextVersion) {
  for (const relativePath of VERSION_FILES) {
    const filePath = path.join(repoRoot, relativePath);
    const updated = replaceVersion(fs.readFileSync(filePath, "utf8"), nextVersion);
    fs.writeFileSync(filePath, updated);
    console.log(`Bumped ${relativePath} to ${nextVersion}`);
  }
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

  preflight(nextVersion, tag);
  if (dryRun) {
    console.log(`Dry run: would bump ${VERSION_FILES.join(", ")}, commit, tag ${tag}, push, and create the GitHub release.`);
    return;
  }

  writeVersions(nextVersion);
  git("add", ...VERSION_FILES);
  git("commit", "-m", `chore: release ${nextVersion}`);
  git("tag", "-a", tag, "-m", tag);
  git("push", "origin", RELEASE_BRANCH, tag);
  console.log(`Pushed ${RELEASE_BRANCH} and ${tag}`);

  const releaseUrl = run("gh", ["release", "create", tag, "--title", tag, "--generate-notes", "--verify-tag"]).trim();
  console.log(`Created GitHub release: ${releaseUrl}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}

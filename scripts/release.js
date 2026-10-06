#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bumpDocVersions, docVersionFiles } from "./doc-versions.js";
import { missingBunMessage } from "./bun-missing.js";
import { CHANGELOG_FILE, promoteUnreleased, unreleasedEntries } from "./changelog.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILES = ["package.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"];
const VERSION_MODULE = "src/version.js";
const FALLBACK_FILE = "skills/story-maintenance/scripts/story.js";
const STORY_VERSION_FILES = ["templates/github/story-checks.yml", "templates/github/draft-next-chapter.yml", "templates/github/review-copy.yml"];
const RELEASE_BRANCH = "main";
// test:coverage gates src line and function coverage, then the fallback bundle.
// Branch records are gated only when the lcov report contains them.
export const PREFLIGHT = ["check:metadata", "check:evals", "check:links", "eval:selftest", "test:coverage", "test:examples", "check:node-help"];

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

// Semver forbids leading zeros: npm would publish 0.11.01 as 0.11.1 while the
// tag, manifests, and `story --version` kept 0.11.01.
const PLAIN_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const USAGE = "Usage: bun run release <patch|minor|major|MAJOR.MINOR.PATCH> [--dry-run]";

// Exactly one bump and at most --dry-run. Anything else is refused before any
// check runs, so a mistyped `--dryrun` can never fall through to a real
// release (bump, tag, push, npm publish).
export function parseReleaseArgs(argv) {
  const flags = argv.filter((arg) => arg.startsWith("-"));
  const positionals = argv.filter((arg) => !arg.startsWith("-"));
  const unknown = flags.filter((arg) => arg !== "--dry-run");
  if (unknown.length > 0) {
    throw new Error(`Unknown option ${unknown.join(" ")}. ${USAGE}`);
  }
  if (positionals.length !== 1) {
    throw new Error(`${positionals.length === 0 ? "Missing" : "Expected one"} version bump${positionals.length > 1 ? `, got ${positionals.join(" ")}` : ""}. ${USAGE}`);
  }
  return { bump: positionals[0], dryRun: flags.includes("--dry-run") };
}

export function bumpVersion(current, bump) {
  const match = PLAIN_VERSION.exec(current);
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
      if (!PLAIN_VERSION.test(bump)) {
        throw new Error(`Expected patch, minor, major, or an explicit MAJOR.MINOR.PATCH version without leading zeros, got "${bump}".`);
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

// Everything that reaches outside the process goes through these, so tests
// drive the whole release with a stubbed `run` and a temporary root: a test
// never starts a real git, gh, npm, or bun process.
export function releaseDeps(overrides = {}) {
  const root = overrides.root ?? repoRoot;
  return {
    root,
    run: (command, args, options = {}) =>
      execFileSync(command, args, {
        cwd: root,
        encoding: "utf8",
        stdio: options.inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
      }),
    log: console.log,
    error: console.error,
    today: () => new Date().toISOString().slice(0, 10),
    ...overrides
  };
}

// A check that refuses the release. runRelease prints it as
// "Release aborted: <message>" and returns 1.
export class ReleaseAbort extends Error {}

function fail(message) {
  throw new ReleaseAbort(message);
}

function git(deps, ...args) {
  return deps.run("git", args).trim();
}

// Releases are cut with Bun, so a missing binary should read as a setup problem
// rather than a `spawnSync bun ENOENT` stack trace.
function runBun(deps, args, options = {}) {
  try {
    return deps.run("bun", args, options);
  } catch (error) {
    const missing = missingBunMessage(error);
    if (!missing) {
      throw error;
    }
    return fail(missing);
  }
}

// The tag push triggers .github/workflows/publish.yml, which publishes to npm
// through trusted publishing. Check here that the version is still free.
function checkNpm(deps, name, nextVersion) {
  let published = "";
  try {
    published = deps.run("npm", ["view", `${name}@${nextVersion}`, "version"]).trim();
  } catch (error) {
    if (!isAbsentNpmVersion(error)) {
      fail(`could not check npm for ${name}@${nextVersion}: ${error.stderr || error.message}`);
    }
  }
  if (published !== "") {
    fail(`${name}@${nextVersion} is already published on npm.`);
  }
}

function preflight(deps, nextVersion, tag, name) {
  if (git(deps, "rev-parse", "--abbrev-ref", "HEAD") !== RELEASE_BRANCH) {
    fail(`releases are cut from ${RELEASE_BRANCH}.`);
  }
  if (git(deps, "status", "--porcelain") !== "") {
    fail("working tree is not clean. Commit or stash your changes first.");
  }
  git(deps, "fetch", "origin", RELEASE_BRANCH, "--tags");
  if (git(deps, "rev-parse", "HEAD") !== git(deps, "rev-parse", `origin/${RELEASE_BRANCH}`)) {
    fail(`local ${RELEASE_BRANCH} does not match origin/${RELEASE_BRANCH}. Pull or push first.`);
  }
  const changelogProblem = changelogProblemFor(fs.readFileSync(path.join(deps.root, CHANGELOG_FILE), "utf8"));
  if (changelogProblem) {
    fail(changelogProblem);
  }
  if (git(deps, "tag", "--list", tag) !== "") {
    fail(`tag ${tag} already exists.`);
  }
  try {
    deps.run("gh", ["auth", "status"]);
  } catch {
    fail("gh is not installed or not logged in. Run `gh auth login`.");
  }
  // fail() throws, so it stays outside the try: inside, the catch would
  // swallow "already exists" and report it as a failed lookup.
  let releaseExists = true;
  try {
    deps.run("gh", ["release", "view", tag]);
  } catch (error) {
    if (!isAbsentGitHubRelease(error)) {
      fail(`could not check GitHub release ${tag}: ${error.stderr || error.message}`);
    }
    releaseExists = false;
  }
  if (releaseExists) {
    fail(`GitHub release ${tag} already exists.`);
  }
  checkNpm(deps, name, nextVersion);

  for (const script of PREFLIGHT) {
    deps.log(`\n> bun run ${script}`);
    runBun(deps, ["run", script], { inherit: true });
  }
  deps.log(`\nPreflight passed for ${nextVersion}.`);
}

// A release with nothing under Unreleased would publish an empty changelog
// section, so the preflight refuses it before any slow check runs.
export function changelogProblemFor(text) {
  return unreleasedEntries(text).length === 0
    ? `${CHANGELOG_FILE} has no entries under "## [Unreleased]". Add the user-visible changes first.`
    : null;
}

export function updateChangelog(root, currentVersion, nextVersion, date) {
  const filePath = path.join(root, CHANGELOG_FILE);
  fs.writeFileSync(filePath, promoteUnreleased(fs.readFileSync(filePath, "utf8"), currentVersion, nextVersion, date));
  return CHANGELOG_FILE;
}

export function updateVersionFiles(root, nextVersion) {
  const updated = [];
  const currentVersion = JSON.parse(fs.readFileSync(path.join(root, VERSION_FILES[0]), "utf8")).version;
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
  for (const relativePath of STORY_VERSION_FILES) {
    const filePath = path.join(root, relativePath);
    const text = fs.readFileSync(filePath, "utf8");
    const pattern = /^(\s*STORY_VERSION:\s*")[^"]*(")/m;
    if (!pattern.test(text)) {
      throw new Error(`No STORY_VERSION found in ${relativePath}.`);
    }
    fs.writeFileSync(filePath, text.replace(pattern, `$1${nextVersion}$2`));
    updated.push(relativePath);
  }
  // Doc examples name the current release, so bump the ones that still do.
  for (const relativePath of docVersionFiles(root)) {
    const filePath = path.join(root, relativePath);
    const text = fs.readFileSync(filePath, "utf8");
    const bumped = bumpDocVersions(text, currentVersion, nextVersion);
    if (bumped !== text) {
      fs.writeFileSync(filePath, bumped);
      updated.push(relativePath);
    }
  }
  return updated;
}

function writeVersions(deps, currentVersion, nextVersion) {
  // The changelog goes first: it is the one rewrite that can refuse (a section
  // for this version already exists), and it should refuse before any bump.
  const date = deps.today();
  const changelog = updateChangelog(deps.root, currentVersion, nextVersion, date);
  deps.log(`Moved the Unreleased entries in ${CHANGELOG_FILE} under ${nextVersion} - ${date}`);
  const updated = updateVersionFiles(deps.root, nextVersion);
  for (const relativePath of updated) {
    deps.log(`Bumped ${relativePath} to ${nextVersion}`);
  }
  updated.push(changelog);
  // The bundled fallback inlines src/version.js, so rebuild it with the bump.
  runBun(deps, ["run", "build:fallback"], { inherit: true });
  runBun(deps, ["run", "check:metadata"], { inherit: true });
  return updated;
}

// Runs the release and returns its exit status. Bad arguments print the usage
// and a refused check prints "Release aborted: ..."; both return 1. Any other
// error propagates, as an uncaught exception did before.
export function runRelease(argv, overrides = {}) {
  const deps = releaseDeps(overrides);
  let bump;
  let dryRun;
  try {
    ({ bump, dryRun } = parseReleaseArgs(argv));
  } catch (error) {
    deps.error(error.message);
    return 1;
  }
  try {
    release(deps, bump, dryRun);
  } catch (error) {
    if (!(error instanceof ReleaseAbort)) {
      throw error;
    }
    deps.error(`Release aborted: ${error.message}`);
    return 1;
  }
  return 0;
}

function release(deps, bump, dryRun) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(deps.root, "package.json"), "utf8"));
  let nextVersion;
  try {
    nextVersion = bumpVersion(packageJson.version, bump);
  } catch (error) {
    fail(error.message);
  }
  const tag = `v${nextVersion}`;
  deps.log(`Releasing ${packageJson.version} -> ${nextVersion} (${tag})`);

  preflight(deps, nextVersion, tag, packageJson.name);
  if (dryRun) {
    deps.log(`Dry run: would bump ${[...VERSION_FILES, VERSION_MODULE].join(", ")}, the STORY_VERSION templates, and the version examples in README.md and docs/, move the ${CHANGELOG_FILE} Unreleased entries under ${nextVersion}, rebuild the fallback, commit, tag ${tag}, push, and create the GitHub release. The tag push publishes ${packageJson.name}@${nextVersion} to npm from GitHub Actions.`);
    return;
  }

  const updated = writeVersions(deps, packageJson.version, nextVersion);
  git(deps, "add", ...updated, FALLBACK_FILE);
  git(deps, "commit", "-m", `chore: release ${nextVersion}`);
  git(deps, "tag", "-a", tag, "-m", tag);
  git(deps, ...releasePushArgs(tag));
  deps.log(`Pushed ${RELEASE_BRANCH} and ${tag}`);

  const releaseUrl = deps.run("gh", ["release", "create", tag, "--title", tag, "--generate-notes", "--verify-tag"]).trim();
  deps.log(`Created GitHub release: ${releaseUrl}`);

  deps.log(`The Publish workflow publishes ${packageJson.name}@${nextVersion} to npm once CI passes on ${RELEASE_BRANCH} for the release commit: https://github.com/danjdewhurst/story-skills/actions/workflows/publish.yml`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runRelease(process.argv.slice(2));
}

#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnCommand } from "./spawn-command.js";
import { bumpDocVersions, docVersionFiles } from "./doc-versions.js";
import { missingBunMessage } from "./bun-missing.js";
import { CHANGELOG_FILE, hasVersionSection, promoteUnreleased, unreleasedEntries } from "./changelog.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILES = ["package.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"];
const VERSION_MODULE = "src/version.js";
const FALLBACK_FILE = "skills/story-maintenance/scripts/story.js";
const STORY_VERSION_FILES = ["templates/github/story-checks.yml", "templates/github/draft-next-chapter.yml", "templates/github/review-copy.yml"];
const RELEASE_BRANCH = "main";
// A signal that arrives during the local phase rolls the release back instead
// of ending the process with the bumped files in place. SIGHUP is the signal a
// dropped terminal session sends.
const INTERRUPT_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
// test:coverage gates src line and function coverage (not branches, which
// Bun's lcov report does not record), then the fallback bundle.
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
// pointing at a commit that is not on main. Full ref names keep a local
// branch named like the tag from being pushed in its place.
export function releasePushArgs(tag) {
  return ["push", "--atomic", "origin", ...pushTargets(tag).map((ref) => `${ref}:${ref}`)];
}

function pushTargets(tag) {
  return [`refs/heads/${RELEASE_BRANCH}`, `refs/tags/${tag}`];
}

function githubReleaseArgs(tag) {
  return ["release", "create", tag, "--title", tag, "--generate-notes", "--verify-tag"];
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
// never starts a real gh, npm, or bun process, and runs git only in
// throwaway repositories.
export function releaseDeps(overrides = {}) {
  const root = overrides.root ?? repoRoot;
  return {
    root,
    // spawnCommand runs npm with node on Windows, where npm is a .cmd shim.
    // `host` stands in for the platform there, so tests can ask for Windows.
    run: (command, args, options = {}) =>
      execFileSync(...spawnCommand(command, args, overrides.host), {
        cwd: root,
        encoding: "utf8",
        stdio: options.inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
      }),
    log: console.log,
    error: console.error,
    today: () => new Date().toISOString().slice(0, 10),
    sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
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

// What a failed step said: a piped command's stderr, or the error's message
// when the command's output already went to the terminal.
function reason(error) {
  return String(error.stderr || error.message).trim();
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

// What origin's main points at. A real run fetches main and the tags, so the
// checks see origin's refs. A dry run only asks origin with ls-remote, which
// moves no remote-tracking ref and fetches no tag.
function originMain(deps, dryRun) {
  if (dryRun) {
    return remoteSha(deps, `refs/heads/${RELEASE_BRANCH}`) ?? "";
  }
  git(deps, "fetch", "origin", RELEASE_BRANCH, "--tags");
  return git(deps, "rev-parse", `origin/${RELEASE_BRANCH}`);
}

// The object origin has under ref, or null when origin has no such ref.
function remoteSha(deps, ref) {
  const line = git(deps, "ls-remote", "origin", ref)
    .split("\n")
    .find((entry) => entry.split("\t")[1] === ref);
  return line ? line.split("\t")[0] : null;
}

function preflight(deps, nextVersion, tag, name, dryRun) {
  if (git(deps, "rev-parse", "--abbrev-ref", "HEAD") !== RELEASE_BRANCH) {
    fail(`releases are cut from ${RELEASE_BRANCH}.`);
  }
  if (git(deps, "status", "--porcelain") !== "") {
    fail("working tree is not clean. Commit or stash your changes first.");
  }
  const originHead = originMain(deps, dryRun);
  const head = git(deps, "rev-parse", "HEAD");
  if (head !== originHead) {
    fail(`local ${RELEASE_BRANCH} does not match origin/${RELEASE_BRANCH}. Pull or push first.`);
  }
  const changelogProblem = changelogProblemFor(fs.readFileSync(path.join(deps.root, CHANGELOG_FILE), "utf8"), nextVersion);
  if (changelogProblem) {
    fail(changelogProblem);
  }
  // A dry run has not fetched the tags, so it asks origin for this one.
  const tagTaken = git(deps, "tag", "--list", tag) !== "" || (dryRun && remoteSha(deps, `refs/tags/${tag}`) !== null);
  if (tagTaken) {
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
  return head;
}

// The two ways the changelog rewrite can refuse, checked before any slow
// check runs and in --dry-run too, so a dry run that passes means the real
// run's rewrite will not refuse. Nothing under Unreleased would publish an
// empty section, and a section for the new version would be a duplicate.
export function changelogProblemFor(text, nextVersion) {
  if (unreleasedEntries(text).length === 0) {
    return `${CHANGELOG_FILE} has no entries under "## [Unreleased]". Add the user-visible changes first.`;
  }
  if (hasVersionSection(text, nextVersion)) {
    return `${CHANGELOG_FILE} already has a section for ${nextVersion}. Move its entries back under "## [Unreleased]" and remove its heading, or release a later version.`;
  }
  return null;
}

// These rewrites add each file to `written` just before writing it, so after
// a failure the release knows which files to restore, and only those.
export function updateChangelog(root, currentVersion, nextVersion, date, written = []) {
  const filePath = path.join(root, CHANGELOG_FILE);
  const text = promoteUnreleased(fs.readFileSync(filePath, "utf8"), currentVersion, nextVersion, date);
  written.push(CHANGELOG_FILE);
  fs.writeFileSync(filePath, text);
  return CHANGELOG_FILE;
}

export function updateVersionFiles(root, nextVersion, written = []) {
  const updated = [];
  const write = (relativePath, text) => {
    written.push(relativePath);
    fs.writeFileSync(path.join(root, relativePath), text);
    updated.push(relativePath);
  };
  const currentVersion = JSON.parse(fs.readFileSync(path.join(root, VERSION_FILES[0]), "utf8")).version;
  for (const relativePath of VERSION_FILES) {
    write(relativePath, replaceVersion(fs.readFileSync(path.join(root, relativePath), "utf8"), nextVersion));
  }
  const modulePath = path.join(root, VERSION_MODULE);
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const versionPattern = /^(export const VERSION = ")[^"]*(";)/m;
  if (!versionPattern.test(moduleSource)) {
    throw new Error(`No VERSION export found in ${VERSION_MODULE}.`);
  }
  write(VERSION_MODULE, moduleSource.replace(versionPattern, `$1${nextVersion}$2`));
  for (const relativePath of STORY_VERSION_FILES) {
    const text = fs.readFileSync(path.join(root, relativePath), "utf8");
    const pattern = /^(\s*STORY_VERSION:\s*")[^"]*(")/m;
    if (!pattern.test(text)) {
      throw new Error(`No STORY_VERSION found in ${relativePath}.`);
    }
    write(relativePath, text.replace(pattern, `$1${nextVersion}$2`));
  }
  // Doc examples name the current release, so bump the ones that still do.
  for (const relativePath of docVersionFiles(root)) {
    const text = fs.readFileSync(path.join(root, relativePath), "utf8");
    const bumped = bumpDocVersions(text, currentVersion, nextVersion);
    if (bumped !== text) {
      write(relativePath, bumped);
    }
  }
  return updated;
}

function writeVersions(deps, currentVersion, nextVersion, written) {
  // The changelog goes first: it is the one rewrite that can refuse, and the
  // preflight has already checked that it will not.
  const date = deps.today();
  updateChangelog(deps.root, currentVersion, nextVersion, date, written);
  deps.log(`Moved the Unreleased entries in ${CHANGELOG_FILE} under ${nextVersion} - ${date}`);
  for (const relativePath of updateVersionFiles(deps.root, nextVersion, written)) {
    deps.log(`Bumped ${relativePath} to ${nextVersion}`);
  }
  // The bundled fallback inlines src/version.js, so rebuild it with the bump.
  written.push(FALLBACK_FILE);
  runBun(deps, ["run", "build:fallback"], { inherit: true });
  runBun(deps, ["run", "check:metadata"], { inherit: true });
}

// Runs the release and resolves to its exit status. Bad arguments print the
// usage and a refused check or a failed release step prints "Release aborted:
// ..." with what to do next; both resolve to 1. Any other error, such as a
// failing preflight check whose output is already on the terminal, rejects.
export async function runRelease(argv, overrides = {}) {
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
    await release(deps, bump, dryRun);
  } catch (error) {
    if (!(error instanceof ReleaseAbort)) {
      throw error;
    }
    deps.error(`Release aborted: ${error.message}`);
    return 1;
  }
  return 0;
}

// Node runs a signal's listener only when the event loop turns. The commands of
// the local phase block the loop, so the release yields before each check.
// Without the yield, a signal sent during a command would be seen only after
// the listeners were removed, and the release would go on to push.
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

async function release(deps, bump, dryRun) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(deps.root, "package.json"), "utf8"));
  let nextVersion;
  try {
    nextVersion = bumpVersion(packageJson.version, bump);
  } catch (error) {
    fail(error.message);
  }
  const tag = `v${nextVersion}`;
  deps.log(`Releasing ${packageJson.version} -> ${nextVersion} (${tag})`);

  const head = preflight(deps, nextVersion, tag, packageJson.name, dryRun);
  if (dryRun) {
    deps.log(`Dry run: would bump ${[...VERSION_FILES, VERSION_MODULE].join(", ")}, the STORY_VERSION templates, and the version examples in README.md and docs/, move the ${CHANGELOG_FILE} Unreleased entries under ${nextVersion}, rebuild the fallback, commit, tag ${tag}, push, and create the GitHub release. The tag push publishes ${packageJson.name}@${nextVersion} to npm from GitHub Actions.`);
    return;
  }

  // Until the push everything is local. `local` records what the release has
  // done so far, so a failure undoes exactly that and nothing else.
  const local = { head, written: [], commit: null, tag: null };
  // A signal is noticed between the steps and undone like any other failure.
  // A command the terminal interrupts fails on its own and is undone the same way.
  const interrupts = [];
  const listeners = INTERRUPT_SIGNALS.map((signal) => [signal, () => interrupts.push(signal)]);
  const stopIfInterrupted = async () => {
    await yieldToEventLoop();
    if (interrupts.length > 0) {
      throw new Error(`interrupted by ${interrupts[0]}`);
    }
  };
  for (const [signal, listener] of listeners) {
    process.on(signal, listener);
  }
  try {
    writeVersions(deps, packageJson.version, nextVersion, local.written);
    await stopIfInterrupted();
    git(deps, "add", ...local.written);
    git(deps, "commit", "-m", `chore: release ${nextVersion}`);
    local.commit = git(deps, "rev-parse", "HEAD");
    await stopIfInterrupted();
    git(deps, "tag", "-a", tag, "-m", tag);
    local.tag = tag;
    await stopIfInterrupted();
    checkPushTargets(deps, tag);
    await stopIfInterrupted();
  } catch (error) {
    rollBack(deps, local, `the release failed before anything was pushed: ${reason(error)}`);
  } finally {
    for (const [signal, listener] of listeners) {
      process.off(signal, listener);
    }
  }
  pushRelease(deps, local, nextVersion);
  deps.log(`Pushed ${RELEASE_BRANCH} and ${tag}`);

  // The tag is on origin now, and tag rules stop anyone moving or deleting
  // it, so from here a failure is finished by hand, never rolled back.
  let releaseUrl;
  try {
    releaseUrl = deps.run("gh", githubReleaseArgs(tag)).trim();
  } catch (error) {
    fail(
      `${RELEASE_BRANCH} and ${tag} are on origin, but \`gh release create\` failed: ${reason(error)}\n` +
        `Do not run the release again, and leave ${tag} where it is. The Publish workflow runs for ${tag} anyway: once CI and the binaries pass, its release-assets job waits five minutes for the GitHub release, and npm publishes only after that job passes.\n` +
        `Create the release now: gh ${githubReleaseArgs(tag).join(" ")}\n` +
        "If release-assets has already failed, re-run the failed jobs of that Publish run: `gh run list --workflow publish.yml` lists the runs, then `gh run rerun <run-id> --failed`."
    );
  }
  deps.log(`Created GitHub release: ${releaseUrl}`);

  deps.log(`The Publish workflow publishes ${packageJson.name}@${nextVersion} to npm once CI passes on ${RELEASE_BRANCH} for the release commit: https://github.com/danjdewhurst/story-skills/actions/workflows/publish.yml`);
}

// The git commands that undo what the release did locally: delete its tag,
// move main back from its commit (only if main still points at that commit),
// and restore the files it wrote. Other files and branches are never touched.
function undoSteps(local) {
  return [
    ...(local.tag ? [["tag", "-d", local.tag]] : []),
    ...(local.commit ? [["update-ref", `refs/heads/${RELEASE_BRANCH}`, local.head, local.commit]] : []),
    ...(local.written.length > 0 ? [["checkout", local.head, "--", ...local.written]] : [])
  ];
}

function byHand(steps) {
  return steps.map((args) => `\`git ${args.join(" ")}\``).join(", then ");
}

// Undoes a release that never reached origin, after checking that HEAD is
// still main at the commit the release left it on. The checks after the
// preflight take minutes, and if anything moved HEAD meanwhile (a checkout,
// a commit), the rollback changes nothing and prints the steps instead.
function rollBack(deps, local, problem) {
  const steps = undoSteps(local);
  if (steps.length === 0) {
    fail(`${problem}\nNothing had changed yet. Fix the problem, then run the release again.`);
  }
  const expected = local.commit ?? local.head;
  let branch = "";
  let at = "";
  try {
    branch = git(deps, "symbolic-ref", "-q", "HEAD");
    at = git(deps, "rev-parse", "HEAD");
  } catch {
    // A detached HEAD, or a git that fails here, counts as moved.
  }
  if (branch !== `refs/heads/${RELEASE_BRANCH}` || at !== expected) {
    fail(
      `${problem}\nNothing was rolled back: HEAD is no longer ${RELEASE_BRANCH} at ${expected}, so something else changed the repository while the release ran. ` +
        `Check \`git status\` and \`git log\`, then, with ${RELEASE_BRANCH} checked out, undo the release by hand with ${byHand(steps)}.`
    );
  }
  let done = 0;
  try {
    for (const args of steps) {
      git(deps, ...args);
      done += 1;
    }
  } catch (error) {
    fail(`${problem}\nThe rollback failed too: ${reason(error)}\nFinish it by hand with ${byHand(steps.slice(done))}, then run the release again.`);
  }
  fail(
    `${problem}\nRolled back: ${RELEASE_BRANCH} is at ${local.head} again${local.tag ? `, the local ${local.tag} tag is deleted,` : ""} and the files the release wrote are restored. Fix the problem, then run the release again.`
  );
}

// git push matches even a full destination ref against origin's refs the way
// rev-parse expands a short name, so a branch named refs/tags/vX.Y.Z
// (refs/heads/refs/tags/vX.Y.Z), a tag named refs/heads/main, or a
// refs/remotes/<target>/HEAD on origin would take the push in place of the
// real ref. ls-remote lists every ref that ends in a target, so refuse while
// it lists anything else.
function checkPushTargets(deps, tag) {
  const targets = pushTargets(tag);
  const decoys = git(deps, "ls-remote", "origin", ...targets, ...targets.map((ref) => `${ref}/HEAD`))
    .split("\n")
    .map((line) => line.split("\t")[1])
    .filter((ref) => ref && !ref.endsWith("^{}") && !targets.includes(ref));
  if (decoys.length > 0) {
    fail(`origin has ${decoys.join(" and ")}, which \`git push\` would update in place of ${targets.join(" or ")}. Ask a repository admin to delete it.`);
  }
}

// The object origin's refs/tags/<tag> names, or null when origin has none.
function remoteTag(deps, tag) {
  const ref = `refs/tags/${tag}`;
  const line = git(deps, "ls-remote", "--tags", "origin", ref)
    .split("\n")
    .find((entry) => entry.split("\t")[1] === ref);
  return line ? line.split("\t")[0] : null;
}

const PUSH_CHECKS = 3;
const PUSH_CHECK_DELAY_MS = 5000;

// --atomic means origin takes both refs or neither, so a refused push leaves
// nothing there and is rolled back. A dropped connection can hide a push that
// landed, or one the server is still applying, so ask origin for the tag a
// few times before undoing anything.
function pushRelease(deps, local, version) {
  const tag = local.tag;
  const ref = `refs/tags/${tag}`;
  let pushError;
  try {
    git(deps, ...releasePushArgs(tag));
    return;
  } catch (error) {
    pushError = error;
  }
  let mine;
  let theirs = null;
  try {
    mine = git(deps, "rev-parse", ref);
    for (let check = 1; check <= PUSH_CHECKS && theirs === null; check += 1) {
      if (check > 1) {
        deps.sleep(PUSH_CHECK_DELAY_MS);
      }
      theirs = remoteTag(deps, tag);
    }
  } catch (error) {
    fail(
      `\`git push\` failed: ${reason(pushError)}\nCould not check whether the push reached origin: ${reason(error)}\n` +
        `Run \`git ls-remote --tags origin ${ref}\` and compare the SHA it prints with \`git rev-parse ${ref}\`. ` +
        `If origin lists no ${tag}, the push did not land: undo the release with ${byHand(undoSteps(local))}, then run it again. ` +
        `If the SHAs match, the push landed: create the GitHub release with \`gh ${githubReleaseArgs(tag).join(" ")}\`. ` +
        `If they differ, another release of ${version} reached origin first: undo this one the same way, then fetch ${RELEASE_BRANCH} and the tags and check that release.`
    );
  }
  if (theirs === mine) {
    deps.log(`\`git push\` reported an error, but origin has ${tag}, so the push landed: ${reason(pushError)}`);
    return;
  }
  if (theirs !== null) {
    rollBack(
      deps,
      local,
      `origin already has a different ${tag} (${theirs}; this run made ${mine}), so another release of ${version} reached origin first, and the atomic push changed nothing there: ${reason(pushError)}\n` +
        `Fetch ${RELEASE_BRANCH} and the tags, and check that release before you release again.`
    );
  }
  rollBack(
    deps,
    local,
    `\`git push\` failed and origin does not have ${tag}, so the atomic push probably did not land: ${reason(pushError)}\n` +
      `If origin/${RELEASE_BRANCH} has moved on, pull it first. Only a repository admin can push a v* tag. ` +
      `If \`git ls-remote --tags origin ${ref}\` lists ${tag} later after all, the push landed: pull ${RELEASE_BRANCH}, then create the GitHub release with \`gh ${githubReleaseArgs(tag).join(" ")}\`.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRelease(process.argv.slice(2)).then((status) => {
    process.exitCode = status;
  });
}

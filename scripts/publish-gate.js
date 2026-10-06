#!/usr/bin/env node
// The gate in front of .github/workflows/publish.yml. Nothing is attached to
// the GitHub release or published to npm until both commands pass.
//
//   verify    The run comes from a v* tag push, or from a manual run
//             dispatched on main or on the tag itself; the tag is vX.Y.Z and
//             equals "v" plus package.json's version at the tagged commit; that
//             commit is the release commit (its first parent has another
//             version); and it is on main. Writes `tag` and `sha` to
//             $GITHUB_OUTPUT so later jobs check out exactly that commit.
//   ci <sha>  Waits for the CI workflow's push run on main for that commit and
//             passes only once it has succeeded. A cancelled run fails.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const RELEASE_BRANCH = "main";
// The gate looks CI up by file name, so renaming ci.yml means updating this.
const CI_WORKFLOW = "ci.yml";
// The tags `bun run release` creates: semver without leading zeros or a suffix.
const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
export const USAGE = "Usage: node scripts/publish-gate.js <verify | ci <sha>>";

// CI on main takes ten to fifteen minutes. A run appears within seconds of the
// push, so ten minutes without one means there is none to wait for. Each API
// request gets its own deadline, so a stalled one cannot outlast the wait.
export const CI_WAIT = { timeoutMs: 60 * 60_000, missingMs: 10 * 60_000, intervalMs: 30_000, requestMs: 30_000 };

// A check that refuses the release. main() prints it as a workflow error and
// returns 1.
export class GateError extends Error {}

function fail(message) {
  throw new GateError(message);
}

// Everything that reaches outside the process goes through these, so tests
// stub git, the GitHub API, and the clock.
export function gateDeps(overrides = {}) {
  return {
    env: process.env,
    run: (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    fetch: (url, options) => fetch(url, options),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: console.log,
    error: console.error,
    ...overrides
  };
}

// The tag this run publishes. A tag push publishes the pushed tag. A manual
// run names its tag and must be dispatched on main or on that tag: the npm
// environment admits no other ref, and a run on a branch would use that
// branch's copy of publish.yml.
export function releaseTag({ eventName, ref, tagInput = "" }) {
  let tag;
  if (eventName === "push") {
    if (!ref.startsWith("refs/tags/")) {
      fail(`a push to ${ref} is not a tag push.`);
    }
    tag = ref.slice("refs/tags/".length);
  } else if (eventName === "workflow_dispatch") {
    if (!tagInput) {
      fail("a manual run needs the tag input, such as -f tag=v1.2.3.");
    }
    tag = tagInput;
  } else {
    fail(`publishing does not run on ${eventName} events.`);
  }
  // Checked before the tag is printed or used in a git argument.
  if (!TAG_PATTERN.test(tag)) {
    fail(`tag ${JSON.stringify(tag)} is not vMAJOR.MINOR.PATCH.`);
  }
  if (eventName === "workflow_dispatch" && ref !== `refs/heads/${RELEASE_BRANCH}` && ref !== `refs/tags/${tag}`) {
    fail(`a manual run must be dispatched on ${RELEASE_BRANCH} or on the tag, not on ${ref}. Run: gh workflow run publish.yml --ref ${tag} -f tag=${tag}`);
  }
  return tag;
}

function git(deps, ...args) {
  return deps.run("git", args).trim();
}

function commandOutput(error) {
  return String(error.stderr || error.message).trim();
}

// Needs a checkout with every branch and tag (fetch-depth: 0), so the tag and
// origin/main are both there.
export function verifyRelease(deps) {
  const { env } = deps;
  const tag = releaseTag({ eventName: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, tagInput: env.TAG_INPUT });

  let sha;
  try {
    sha = git(deps, "rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`);
  } catch (error) {
    if (error.status === 1) {
      fail(`tag ${tag} does not exist.`);
    }
    throw error;
  }
  // A run started by the tag carries the commit the tag named then. If the tag
  // has since moved, the workflow file and the commit would not match.
  if (env.GITHUB_REF === `refs/tags/${tag}` && sha !== env.GITHUB_SHA) {
    fail(`tag ${tag} now points at ${sha}, but this run started from ${env.GITHUB_SHA}. The tag was moved; publish a new release instead.`);
  }

  try {
    deps.run("git", ["merge-base", "--is-ancestor", sha, `origin/${RELEASE_BRANCH}`]);
  } catch (error) {
    if (error.status === 1) {
      fail(`tag ${tag} points at ${sha}, which is not on ${RELEASE_BRANCH}. Only a commit on ${RELEASE_BRANCH} is published; cut releases with bun run release.`);
    }
    fail(`could not check that ${sha} is on ${RELEASE_BRANCH}: ${commandOutput(error)}`);
  }

  const version = JSON.parse(git(deps, "show", `${sha}:package.json`)).version;
  if (tag !== `v${version}`) {
    fail(`tag ${tag} does not match package.json version ${version} at ${sha}.`);
  }

  // Every later commit on main carries the same version until the next
  // release, so the tag must be on the commit that set it.
  let parentVersion;
  try {
    parentVersion = JSON.parse(git(deps, "show", `${sha}^1:package.json`)).version;
  } catch (error) {
    if (error.status === undefined) {
      throw error;
    }
    fail(`could not read package.json in the parent of ${sha}, so it is not a release commit: ${commandOutput(error)}`);
  }
  if (parentVersion === version) {
    fail(`tag ${tag} points at ${sha}, but its parent already has version ${version}, so it is not the release commit. Tag the commit that sets the version, as bun run release does.`);
  }

  if (env.GITHUB_OUTPUT) {
    fs.appendFileSync(env.GITHUB_OUTPUT, `tag=${tag}\nsha=${sha}\n`);
  }
  deps.log(`${tag} is ${sha}, which is on ${RELEASE_BRANCH}, and package.json there is version ${version}.`);
  return { tag, sha };
}

// What the CI runs for one commit say. Any success passes: the code is the
// same in every run. Otherwise a run still going is waited for, and with none
// left the newest decides the failure message.
export function ciVerdict(runs, sha) {
  if (runs.length === 0) {
    return { state: "missing", message: `No CI run on ${RELEASE_BRANCH} for ${sha} yet.` };
  }
  const passed = runs.find((run) => run.status === "completed" && run.conclusion === "success");
  if (passed) {
    return { state: "pass", message: `CI passed on ${RELEASE_BRANCH} for ${sha}: ${passed.html_url}` };
  }
  const running = runs.find((run) => run.status !== "completed");
  if (running) {
    return { state: "wait", message: `CI is ${running.status} on ${RELEASE_BRANCH} for ${sha}: ${running.html_url}` };
  }
  const newest = runs.reduce((a, b) => (b.id > a.id ? b : a));
  if (newest.conclusion === "cancelled") {
    return {
      state: "fail",
      message:
        `CI run ${newest.html_url} for ${sha} was cancelled, so it never passed. ` +
        `Re-run it with gh run rerun ${newest.id}, then re-run this workflow's failed jobs. ` +
        `GitHub re-runs a run only within 30 days of it; after that, cut a new patch release.`
    };
  }
  return {
    state: "fail",
    message:
      `CI run ${newest.html_url} for ${sha} finished as ${newest.conclusion}. ` +
      `Fix ${RELEASE_BRANCH} and cut a new release, or, if the failure was a flake, ` +
      `re-run it with gh run rerun ${newest.id} --failed (within 30 days of the run), then re-run this workflow's failed jobs.`
  };
}

// A 403 is a rate limit, not a missing permission, when GitHub says so in
// its headers or its message.
async function rateLimited(response) {
  if (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")) {
    return true;
  }
  return /rate limit/i.test(await response.text().catch(() => ""));
}

// One GET from the GitHub API, returning { body }. A rate limit, a server
// error, a network error, or a request that outlives requestMs returns
// { retry } with the reason; any other refusal fails with `refused(status)`.
async function githubGet(deps, apiPath, { requestMs, refused }) {
  const { env } = deps;
  const url = `${env.GITHUB_API_URL || "https://api.github.com"}/repos/${env.GITHUB_REPOSITORY}/${apiPath}`;
  try {
    const response = await deps.fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "x-github-api-version": "2022-11-28"
      },
      signal: AbortSignal.timeout(requestMs)
    });
    if (response.status === 429 || response.status >= 500 || (response.status === 403 && (await rateLimited(response)))) {
      return { retry: `The GitHub API answered ${response.status}.` };
    }
    if (!response.ok) {
      fail(refused(response.status));
    }
    return { body: await response.json() };
  } catch (error) {
    if (error instanceof GateError) {
      throw error;
    }
    return { retry: `Could not reach the GitHub API (${error.message}).` };
  }
}

function checkSha(sha) {
  if (!SHA_PATTERN.test(sha ?? "")) {
    fail(`expected a 40-character commit SHA, got ${JSON.stringify(sha ?? "")}.`);
  }
}

// Polls the push runs of ci.yml on main for the commit until one passes, one
// fails, or the wait runs out.
export async function waitForCi(deps, sha, options = {}) {
  const { timeoutMs, missingMs, intervalMs, requestMs } = { ...CI_WAIT, ...options };
  checkSha(sha);
  const query = new URLSearchParams({ head_sha: sha, branch: RELEASE_BRANCH, event: "push", per_page: "100" });
  const refused = (status) => `the GitHub API answered ${status} when listing CI runs. The job needs the actions: read permission and GITHUB_TOKEN.`;
  const started = deps.now();
  for (;;) {
    const listed = await githubGet(deps, `actions/workflows/${CI_WORKFLOW}/runs?${query}`, { requestMs, refused });
    const verdict = listed.body ? ciVerdict(listed.body.workflow_runs ?? [], sha) : { state: "retry", message: listed.retry };
    if (verdict.state === "pass") {
      deps.log(verdict.message);
      return verdict;
    }
    if (verdict.state === "fail") {
      fail(verdict.message);
    }
    const waited = deps.now() - started;
    if (verdict.state === "missing" && waited >= missingMs) {
      fail(
        `no CI run on ${RELEASE_BRANCH} for ${sha} after ${Math.round(waited / 60_000)} minutes. ` +
          `CI runs only for the last commit of each push to ${RELEASE_BRANCH}, which bun run release makes the release commit.`
      );
    }
    if (waited >= timeoutMs) {
      fail(
        verdict.state === "retry"
          ? `could not list the CI runs for ${sha} within ${Math.round(timeoutMs / 60_000)} minutes. ${verdict.message} Re-run this job once the GitHub API answers.`
          : `CI did not finish within ${Math.round(timeoutMs / 60_000)} minutes. ${verdict.message} Re-run this job once CI has passed.`
      );
    }
    deps.log(`${verdict.message} Checking again in ${Math.round(intervalMs / 1000)} seconds.`);
    await deps.sleep(intervalMs);
  }
}

// Runs one gate command and returns its exit status. A refused check prints a
// workflow error annotation and returns 1; any other error propagates.
export async function main(argv, overrides = {}) {
  const deps = gateDeps(overrides);
  const [command, ...rest] = argv;
  try {
    if (command === "verify" && rest.length === 0) {
      verifyRelease(deps);
      return 0;
    }
    if (command === "ci" && rest.length === 1) {
      await waitForCi(deps, rest[0]);
      return 0;
    }
  } catch (error) {
    if (!(error instanceof GateError)) {
      throw error;
    }
    deps.error(`::error::Publish gate: ${error.message}`);
    return 1;
  }
  deps.error(USAGE);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}

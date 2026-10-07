import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { git, gitEnv, makeTempDir } from "./helpers.js";
import { CI_WAIT, USAGE, ciVerdict, gateDeps, main, releaseTag, verifyRelease, waitForCi } from "../scripts/publish-gate.js";

// scripts/publish-gate.js guards .github/workflows/publish.yml (#544). The git
// checks run against a real throwaway repository; the GitHub API and the
// clock are stubbed, so nothing here reaches GitHub or waits.

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

// main is 0.9.0, then the 1.0.0 release commit (tagged v1.0.0, and v2.0.0,
// the wrong version), then a later commit still at 1.0.0. A side branch off
// the release has v1.0.1, which never reached main.
function releaseRepo() {
  const dir = makeTempDir("story-publish-gate-");
  git(dir, "init", "-q", "-b", "main");
  const commit = (version, message = `release ${version}`) => {
    fs.writeFileSync(path.join(dir, "package.json"), `{\n  "name": "story-skills",\n  "version": "${version}"\n}\n`);
    fs.writeFileSync(path.join(dir, "notes.txt"), `${message}\n`);
    git(dir, "add", "package.json", "notes.txt");
    git(dir, "commit", "-q", "-m", message);
    return git(dir, "rev-parse", "HEAD").trim();
  };
  commit("0.9.0");
  const onMain = commit("1.0.0");
  git(dir, "tag", "-a", "v1.0.0", "-m", "v1.0.0");
  git(dir, "tag", "-a", "v2.0.0", "-m", "v2.0.0");
  const later = commit("1.0.0", "docs: after the release");
  git(dir, "update-ref", "refs/remotes/origin/main", later);
  git(dir, "checkout", "-q", "-b", "side", onMain);
  const offMain = commit("1.0.1");
  git(dir, "tag", "-a", "v1.0.1", "-m", "v1.0.1");
  return { dir, onMain, later, offMain, retag: (tag, sha) => git(dir, "tag", "-f", "-a", tag, "-m", tag, sha) };
}

function verifyIn(dir, env) {
  const output = path.join(makeTempDir("story-gate-output-"), "output");
  fs.writeFileSync(output, "");
  const logs = [];
  const run = (command, args) => execFileSync(command, args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: gitEnv() });
  const result = verifyRelease({ env: { GITHUB_OUTPUT: output, ...env }, run, log: (line) => logs.push(line) });
  return { result, output: fs.readFileSync(output, "utf8"), logs };
}

function ciRun(id, status, conclusion = null) {
  return { id, status, conclusion, html_url: `https://github.com/danjdewhurst/story-skills/actions/runs/${id}` };
}

// An API answer; the stub builds a fresh Response from it for each request.
function response(status, body = {}, headers = {}) {
  return { status, body, headers };
}

// Answers each API call with the next reply (the last one repeats): a list of
// runs, a response(), an Error to throw, or a function of the request options.
// sleep() moves a fake clock forward.
function stubGitHub(replies) {
  const requests = [];
  let clock = 0;
  const logs = [];
  const errors = [];
  const deps = gateDeps({
    env: { GITHUB_REPOSITORY: "danjdewhurst/story-skills", GITHUB_TOKEN: "token", GITHUB_API_URL: "https://api.github.test" },
    fetch: async (url, requestOptions) => {
      requests.push({ url, options: requestOptions });
      let reply = replies[Math.min(requests.length, replies.length) - 1];
      if (reply instanceof Error) {
        throw reply;
      }
      if (typeof reply === "function") {
        return reply(requestOptions);
      }
      if (Array.isArray(reply)) {
        reply = response(200, { workflow_runs: reply });
      }
      const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      return new Response(body, { status: reply.status, headers: reply.headers });
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    log: (line) => logs.push(line),
    error: (line) => errors.push(line)
  });
  return { deps, requests, logs, errors, minutes: () => clock / 60_000 };
}

describe("the tag a publish run may publish", () => {
  test("a tag push publishes that tag", () => {
    expect(releaseTag({ eventName: "push", ref: "refs/tags/v1.2.3" })).toBe("v1.2.3");
    expect(() => releaseTag({ eventName: "push", ref: "refs/heads/main" })).toThrow("a push to refs/heads/main is not a tag push.");
  });

  test("a manual run is accepted on main or on the tag itself", () => {
    expect(releaseTag({ eventName: "workflow_dispatch", ref: "refs/heads/main", tagInput: "v1.2.3" })).toBe("v1.2.3");
    expect(releaseTag({ eventName: "workflow_dispatch", ref: "refs/tags/v1.2.3", tagInput: "v1.2.3" })).toBe("v1.2.3");
  });

  test("a manual run on any other ref is refused", () => {
    for (const ref of ["refs/heads/feature", "refs/tags/v1.2.2", "refs/heads/main-old", "refs/pull/1/merge"]) {
      expect(() => releaseTag({ eventName: "workflow_dispatch", ref, tagInput: "v1.2.3" })).toThrow(
        `a manual run must be dispatched on main or on the tag, not on ${ref}. Run: gh workflow run publish.yml --ref v1.2.3 -f tag=v1.2.3`
      );
    }
    expect(() => releaseTag({ eventName: "workflow_dispatch", ref: "refs/heads/main" })).toThrow("a manual run needs the tag input");
  });

  test("only a plain vMAJOR.MINOR.PATCH tag is accepted, and other events are refused", () => {
    for (const tag of ["1.2.3", "v1.2", "v01.2.3", "v1.2.3-rc.1", "v1.2.3\n::error::x", "--upload-pack=x"]) {
      expect(() => releaseTag({ eventName: "workflow_dispatch", ref: "refs/heads/main", tagInput: tag })).toThrow(`tag ${JSON.stringify(tag)} is not vMAJOR.MINOR.PATCH.`);
    }
    expect(() => releaseTag({ eventName: "push", ref: "refs/tags/vnext" })).toThrow('tag "vnext" is not vMAJOR.MINOR.PATCH.');
    expect(() => releaseTag({ eventName: "pull_request", ref: "refs/pull/1/merge" })).toThrow("publishing does not run on pull_request events.");
  });
});

describe("verify checks the tagged commit", () => {
  test("a tag on main that names package.json's version passes and hands on the commit", () => {
    const { dir, onMain } = releaseRepo();
    const { result, output, logs } = verifyIn(dir, { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.0.0", GITHUB_SHA: onMain });
    expect(result).toEqual({ tag: "v1.0.0", sha: onMain });
    expect(output).toBe(`tag=v1.0.0\nsha=${onMain}\n`);
    expect(logs).toEqual([`v1.0.0 is ${onMain}, which is on main, and package.json there is version 1.0.0.`]);
  });

  test("a manual run on main checks the tag's commit, not main's", () => {
    const { dir, onMain } = releaseRepo();
    const { result } = verifyIn(dir, { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_SHA: OTHER, TAG_INPUT: "v1.0.0" });
    expect(result).toEqual({ tag: "v1.0.0", sha: onMain });
  });

  test("a tag on a commit that is not on main is refused", () => {
    const { dir, offMain } = releaseRepo();
    for (const env of [
      { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.0.1", GITHUB_SHA: offMain },
      { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_SHA: OTHER, TAG_INPUT: "v1.0.1" }
    ]) {
      expect(() => verifyIn(dir, env)).toThrow(`tag v1.0.1 points at ${offMain}, which is not on main. Only a commit on main is published; cut releases with bun run release.`);
    }
  });

  test("a tag that does not match package.json is refused", () => {
    const { dir, onMain } = releaseRepo();
    expect(() => verifyIn(dir, { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v2.0.0", GITHUB_SHA: onMain })).toThrow(
      `tag v2.0.0 does not match package.json version 1.0.0 at ${onMain}.`
    );
  });

  test("a tag on a later commit that keeps the version is refused: it is not the release commit", () => {
    const { dir, later, retag } = releaseRepo();
    retag("v1.0.0", later);
    for (const env of [
      { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.0.0", GITHUB_SHA: later },
      { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_SHA: later, TAG_INPUT: "v1.0.0" }
    ]) {
      expect(() => verifyIn(dir, env)).toThrow(
        `tag v1.0.0 points at ${later}, but its parent already has version 1.0.0, so it is not the release commit. Tag the commit that sets the version, as bun run release does.`
      );
    }
  });

  test("a tag on a commit with no parent is refused", () => {
    const dir = makeTempDir("story-publish-gate-root-");
    git(dir, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "package.json"), '{ "version": "1.0.0" }\n');
    git(dir, "add", "package.json");
    git(dir, "commit", "-q", "-m", "first");
    git(dir, "tag", "-a", "v1.0.0", "-m", "v1.0.0");
    const root = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "update-ref", "refs/remotes/origin/main", root);
    expect(() => verifyIn(dir, { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.0.0", GITHUB_SHA: root })).toThrow(
      `could not read package.json in the parent of ${root}, so it is not a release commit:`
    );
  });

  test("a missing tag, or one moved since the run started, is refused", () => {
    const { dir, onMain, offMain } = releaseRepo();
    expect(() => verifyIn(dir, { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", TAG_INPUT: "v9.9.9" })).toThrow("tag v9.9.9 does not exist.");
    expect(() => verifyIn(dir, { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.0.0", GITHUB_SHA: offMain })).toThrow(
      `tag v1.0.0 now points at ${onMain}, but this run started from ${offMain}. The tag was moved; publish a new release instead.`
    );
    expect(() => verifyIn(dir, { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/tags/v1.0.0", GITHUB_SHA: offMain, TAG_INPUT: "v1.0.0" })).toThrow("tag v1.0.0 now points at");
  });

  test("a merge-base error other than 'not an ancestor' is reported, not read as a pass", () => {
    const run = (command, args) => {
      if (args[0] === "rev-parse") return `${SHA}\n`;
      throw Object.assign(new Error("Command failed"), { status: 128, stderr: "fatal: Not a valid object name origin/main\n" });
    };
    expect(() => verifyRelease({ env: { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.0.0", GITHUB_SHA: SHA }, run, log: () => {} })).toThrow(
      `could not check that ${SHA} is on main: fatal: Not a valid object name origin/main`
    );
  });
});

describe("the CI verdict for the release commit", () => {
  test("any successful run passes", () => {
    expect(ciVerdict([ciRun(2, "completed", "cancelled"), ciRun(1, "completed", "success")], SHA)).toEqual({
      state: "pass",
      message: `CI passed on main for ${SHA}: https://github.com/danjdewhurst/story-skills/actions/runs/1`
    });
  });

  test("no run yet, or one still going, is waited for", () => {
    expect(ciVerdict([], SHA)).toEqual({ state: "missing", message: `No CI run on main for ${SHA} yet.` });
    for (const status of ["queued", "in_progress", "waiting", "pending", "requested"]) {
      expect(ciVerdict([ciRun(3, "completed", "failure"), ciRun(4, status)], SHA)).toEqual({
        state: "wait",
        message: `CI is ${status} on main for ${SHA}: https://github.com/danjdewhurst/story-skills/actions/runs/4`
      });
    }
  });

  test("a cancelled run fails and says how to re-run it", () => {
    const verdict = ciVerdict([ciRun(7, "completed", "cancelled")], SHA);
    expect(verdict.state).toBe("fail");
    expect(verdict.message).toBe(
      `CI run https://github.com/danjdewhurst/story-skills/actions/runs/7 for ${SHA} was cancelled, so it never passed. ` +
        "Re-run it with gh run rerun 7, then re-run this workflow's failed jobs. " +
        "GitHub re-runs a run only within 30 days of it; after that, cut a new patch release."
    );
  });

  test("any other finished run fails, named by the newest", () => {
    for (const conclusion of ["failure", "timed_out", "action_required", "skipped", "neutral", "startup_failure"]) {
      // The newest run decides, whichever order the API lists them in.
      for (const runs of [
        [ciRun(9, "completed", conclusion), ciRun(8, "completed", "cancelled")],
        [ciRun(8, "completed", "cancelled"), ciRun(9, "completed", conclusion)]
      ]) {
        const verdict = ciVerdict(runs, SHA);
        expect(verdict.state).toBe("fail");
        expect(verdict.message).toContain(`/runs/9 for ${SHA} finished as ${conclusion}. Fix main and cut a new release`);
        expect(verdict.message).toContain("gh run rerun 9 --failed (within 30 days of the run)");
      }
    }
    expect(ciVerdict([ciRun(3, "completed", "failure"), ciRun(4, "completed", "cancelled")], SHA).message).toContain("/runs/4 for");
  });
});

describe("waiting for CI", () => {
  test("asks for the push runs of ci.yml on main for the commit, with the token", async () => {
    const github = stubGitHub([[ciRun(1, "completed", "success")]]);
    await waitForCi(github.deps, SHA);
    expect(github.requests).toHaveLength(1);
    const url = new URL(github.requests[0].url);
    expect(`${url.origin}${url.pathname}`).toBe("https://api.github.test/repos/danjdewhurst/story-skills/actions/workflows/ci.yml/runs");
    expect(Object.fromEntries(url.searchParams)).toEqual({ head_sha: SHA, branch: "main", event: "push", per_page: "100" });
    expect(github.requests[0].options.headers.authorization).toBe("Bearer token");
    expect(github.requests[0].options.signal).toBeInstanceOf(AbortSignal);
    expect(github.logs).toEqual([`CI passed on main for ${SHA}: https://github.com/danjdewhurst/story-skills/actions/runs/1`]);
  });

  test("waits while the run starts and runs, then passes", async () => {
    const github = stubGitHub([[], [ciRun(1, "queued")], response(502), new Error("socket hang up"), [ciRun(1, "in_progress")], [ciRun(1, "completed", "success")]]);
    expect((await waitForCi(github.deps, SHA)).state).toBe("pass");
    expect(github.requests).toHaveLength(6);
    expect(github.minutes()).toBe(2.5);
    expect(github.logs.slice(0, 4)).toEqual([
      `No CI run on main for ${SHA} yet. Checking again in 30 seconds.`,
      `CI is queued on main for ${SHA}: https://github.com/danjdewhurst/story-skills/actions/runs/1 Checking again in 30 seconds.`,
      "The GitHub API answered 502. Checking again in 30 seconds.",
      "Could not reach the GitHub API (socket hang up). Checking again in 30 seconds."
    ]);
  });

  test("a run that ends cancelled or failed fails the gate", async () => {
    const cancelled = stubGitHub([[ciRun(5, "in_progress")], [ciRun(5, "completed", "cancelled")]]);
    await expect(waitForCi(cancelled.deps, SHA)).rejects.toThrow("was cancelled, so it never passed");
    const failed = stubGitHub([[ciRun(6, "completed", "failure")]]);
    await expect(waitForCi(failed.deps, SHA)).rejects.toThrow("finished as failure");
    expect(failed.requests).toHaveLength(1);
  });

  test("gives up when no run appears, or when CI does not finish in time", async () => {
    const missing = stubGitHub([[]]);
    await expect(waitForCi(missing.deps, SHA)).rejects.toThrow(
      `no CI run on main for ${SHA} after 10 minutes. CI runs only for the last commit of each push to main, which bun run release makes the release commit.`
    );
    expect(missing.minutes()).toBe(CI_WAIT.missingMs / 60_000);
    const slow = stubGitHub([[ciRun(1, "in_progress")]]);
    await expect(waitForCi(slow.deps, SHA)).rejects.toThrow(`CI did not finish within 60 minutes. CI is in_progress on main for ${SHA}`);
    expect(slow.minutes()).toBe(CI_WAIT.timeoutMs / 60_000);
  });

  test("a refused API call fails at once", async () => {
    for (const status of [401, 403, 404]) {
      const github = stubGitHub([response(status, { message: "Resource not accessible by integration" })]);
      await expect(waitForCi(github.deps, SHA)).rejects.toThrow(
        `the GitHub API answered ${status} when listing CI runs. The job needs the actions: read permission and GITHUB_TOKEN.`
      );
      expect(github.requests).toHaveLength(1);
    }
  });

  test("a rate limit is waited out, as a 429 or as a 403 that says so", async () => {
    for (const limited of [
      response(429),
      response(403, { message: "Forbidden" }, { "x-ratelimit-remaining": "0" }),
      response(403, { message: "Forbidden" }, { "retry-after": "60" }),
      response(403, { message: "You have exceeded a secondary rate limit." })
    ]) {
      const github = stubGitHub([limited, [ciRun(1, "completed", "success")]]);
      expect((await waitForCi(github.deps, SHA)).state).toBe("pass");
      expect(github.logs[0]).toBe(`The GitHub API answered ${limited.status}. Checking again in 30 seconds.`);
    }
  });

  test("an answer without workflow_runs counts as no run yet", async () => {
    const github = stubGitHub([response(200, {}), [ciRun(1, "completed", "success")]]);
    expect((await waitForCi(github.deps, SHA)).state).toBe("pass");
    expect(github.logs[0]).toBe(`No CI run on main for ${SHA} yet. Checking again in 30 seconds.`);
  });

  test("a request that stalls is abandoned at its own deadline and tried again", async () => {
    const stalled = ({ signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    const github = stubGitHub([stalled, [ciRun(1, "completed", "success")]]);
    expect((await waitForCi(github.deps, SHA, { requestMs: 5 })).state).toBe("pass");
    expect(github.requests).toHaveLength(2);
    expect(github.logs[0]).toStartWith("Could not reach the GitHub API (");
  });

  test("an API that keeps failing until the deadline is blamed, not CI", async () => {
    const github = stubGitHub([[ciRun(1, "in_progress")], response(503)]);
    await expect(waitForCi(github.deps, SHA)).rejects.toThrow(
      `could not list the CI runs for ${SHA} within 60 minutes. The GitHub API answered 503. Re-run this job once the GitHub API answers.`
    );
    expect(github.minutes()).toBe(CI_WAIT.timeoutMs / 60_000);
  });

  test("refuses anything but a full commit SHA before asking GitHub", async () => {
    const github = stubGitHub([[]]);
    for (const sha of [undefined, "", "abc123", `${SHA}\n`]) {
      await expect(waitForCi(github.deps, sha)).rejects.toThrow("expected a 40-character commit SHA");
    }
    expect(github.requests).toEqual([]);
  });
});

describe("the publish-gate entry point", () => {
  test("ci <sha> returns 0 on a pass and 1 with an error annotation on a refusal", async () => {
    const passed = stubGitHub([[ciRun(1, "completed", "success")]]);
    expect(await main(["ci", SHA], passed.deps)).toBe(0);
    const failed = stubGitHub([[ciRun(2, "completed", "cancelled")]]);
    expect(await main(["ci", SHA], failed.deps)).toBe(1);
    expect(failed.errors).toHaveLength(1);
    expect(failed.errors[0]).toStartWith(`::error::Publish gate: CI run https://github.com/danjdewhurst/story-skills/actions/runs/2 for ${SHA} was cancelled`);
  });

  test("verify returns 0 for a release of main and 1 otherwise", async () => {
    const { dir, onMain } = releaseRepo();
    const errors = [];
    const run = (command, args) => execFileSync(command, args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: gitEnv() });
    const deps = (env) => ({ env, run, log: () => {}, error: (line) => errors.push(line) });
    expect(await main(["verify"], deps({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.0.0", GITHUB_SHA: onMain }))).toBe(0);
    expect(await main(["verify"], deps({ GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/feature", TAG_INPUT: "v1.0.0" }))).toBe(1);
    expect(errors).toEqual(["::error::Publish gate: a manual run must be dispatched on main or on the tag, not on refs/heads/feature. Run: gh workflow run publish.yml --ref v1.0.0 -f tag=v1.0.0"]);
  });

  test("bad arguments print the usage", async () => {
    for (const argv of [[], ["verify", "extra"], ["ci"], ["publish"]]) {
      const errors = [];
      expect(await main(argv, { error: (line) => errors.push(line) })).toBe(1);
      expect(errors).toEqual([USAGE]);
    }
  });

  test("an unexpected error propagates", async () => {
    const run = () => {
      throw new TypeError("boom");
    };
    await expect(main(["verify"], { env: { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.0.0", GITHUB_SHA: SHA }, run })).rejects.toThrow("boom");
  });

  test("the default commands run a program, wait, and tell the time", async () => {
    const deps = gateDeps();
    expect(deps.run(process.execPath, ["-e", "process.stdout.write('ran')"])).toBe("ran");
    await deps.sleep(0);
    expect(deps.now()).toBeGreaterThan(0);
    expect(deps.env).toBe(process.env);
  });
});

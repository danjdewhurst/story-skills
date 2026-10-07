import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import { MISSING_BUN_MESSAGE } from "../scripts/bun-missing.js";
import { PREFLIGHT, USAGE, parseReleaseArgs, releaseDeps, runRelease } from "../scripts/release.js";

// These tests drive scripts/release.js end to end with every external command
// stubbed. Nothing here starts gh, npm, or bun, and git runs only against a
// throwaway clone and a bare origin in a temp folder, so a test can never tag,
// push, or publish anything real.

const FALLBACK = "skills/story-maintenance/scripts/story.js";

// A throwaway release root with every file the release rewrites.
function releaseFixture({ unreleased = "- Added a thing.\n" } = {}) {
  const dir = makeTempDir("story-release-run-");
  const write = (relativePath, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(dir, relativePath), text, "utf8");
  };
  for (const relativePath of ["package.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"]) {
    write(relativePath, '{\n  "name": "story-skills",\n  "version": "0.5.0"\n}\n');
  }
  write("src/version.js", 'export const VERSION = "0.5.0";\n');
  for (const name of ["story-checks.yml", "draft-next-chapter.yml", "review-copy.yml"]) {
    write(`templates/github/${name}`, 'env:\n  STORY_VERSION: "0.5.0"\n');
  }
  write("docs/install.md", "npm install -g story-skills@0.5.0\n");
  write(FALLBACK, 'const VERSION = "0.5.0";\n');
  write(
    "CHANGELOG.md",
    `# Changelog\n\n## [Unreleased]\n\n### Added\n\n${unreleased}\n## [0.5.0] - 2026-01-01\n\n- Earlier.\n\n` +
      "[Unreleased]: https://github.com/danjdewhurst/story-skills/compare/v0.5.0...HEAD\n"
  );
  return dir;
}

function commandError(stderr, extra = {}) {
  return Object.assign(new Error(`Command failed\n${stderr}`), { stderr, ...extra });
}

const throws = (error) => () => {
  throw error;
};

const PUSH = "git push --atomic origin refs/heads/main:refs/heads/main refs/tags/v0.5.1:refs/tags/v0.5.1";
const PUSH_TARGETS = "git ls-remote origin refs/heads/main refs/tags/v0.5.1 refs/heads/main/HEAD refs/tags/v0.5.1/HEAD";
const REMOTE_TAG = "git ls-remote --tags origin refs/tags/v0.5.1";
const GH_RELEASE = "gh release create v0.5.1 --title v0.5.1 --generate-notes --verify-tag";

// Replies keyed by the command and its arguments joined by spaces; a function
// reply may throw. Given `git`, unscripted git commands run through it for
// real; anything else unscripted fails the test. The stubbed git starts at
// abc123 and moves to rel456 once the release commits.
function stubRun(overrides = {}, git = null) {
  const calls = [];
  let committed = false;
  const stubGit = {
    "git rev-parse --abbrev-ref HEAD": "main\n",
    "git symbolic-ref -q HEAD": "refs/heads/main\n",
    "git status --porcelain": "",
    "git fetch origin main --tags": "",
    "git rev-parse HEAD": () => (committed ? "rel456\n" : "abc123\n"),
    "git rev-parse origin/main": "abc123\n",
    "git rev-parse refs/tags/v0.5.1": "tag789\n",
    [PUSH_TARGETS]: "abc123\trefs/heads/main\n",
    [REMOTE_TAG]: ""
  };
  const replies = {
    ...(git ? {} : stubGit),
    "gh auth status": "",
    "gh release view v0.5.1": throws(commandError("release not found")),
    "npm view story-skills@0.5.1 version": throws(commandError("npm error code E404")),
    "gh release view v0.6.0": throws(commandError("release not found")),
    "npm view story-skills@0.6.0 version": throws(commandError("npm error code E404")),
    ...overrides
  };
  const run = (command, args, options = {}) => {
    const key = [command, ...args].join(" ");
    calls.push({ key, inherit: Boolean(options.inherit) });
    if (key in replies) {
      const reply = replies[key];
      return typeof reply === "function" ? reply() : reply;
    }
    if (command === "bun" && args[0] === "run") return "";
    if (git && command === "git") return git(...args);
    if (key.startsWith("git tag --list ")) return "";
    if (key.startsWith("git commit ")) committed = true;
    if (/^git (add|commit|tag -a|tag -d|push|update-ref|checkout) /.test(key)) return "";
    if (key.startsWith("gh release create ")) return "https://github.com/danjdewhurst/story-skills/releases/tag/v0.5.1\n";
    throw new Error(`unexpected command in test: ${key}`);
  };
  return { run, calls, keys: () => calls.map((call) => call.key) };
}

function releaseWith(argv, { root = releaseFixture(), replies, git, deps = {} } = {}) {
  const stub = stubRun(replies, git);
  const logs = [];
  const errors = [];
  const sleeps = [];
  const status = runRelease(argv, {
    root,
    run: stub.run,
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    today: () => "2026-10-06",
    sleep: (ms) => sleeps.push(ms),
    ...deps
  });
  return { status, root, stub, sleeps, out: logs.join("\n"), err: errors.join("\n") };
}

const failedBuild = () => Object.assign(new Error("Command failed: bun run build:fallback"), { status: 1, stderr: null });
// Every file the fixture's release writes, in the order it writes them.
const WRITTEN = [
  "CHANGELOG.md",
  "package.json",
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  "src/version.js",
  "templates/github/story-checks.yml",
  "templates/github/draft-next-chapter.yml",
  "templates/github/review-copy.yml",
  "docs/install.md",
  FALLBACK
].join(" ");

const PUBLISHING = /^(git (add|commit|tag -a|push)|gh release create)/;
const read = (root, relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("release arguments", () => {
  test("parses exactly one bump plus an optional --dry-run", () => {
    expect(parseReleaseArgs(["patch"])).toEqual({ bump: "patch", dryRun: false });
    expect(parseReleaseArgs(["--dry-run", "1.2.3"])).toEqual({ bump: "1.2.3", dryRun: true });
    expect(() => parseReleaseArgs([])).toThrow(`Missing version bump. ${USAGE}`);
    expect(() => parseReleaseArgs(["patch", "minor"])).toThrow("Expected one version bump, got patch minor.");
    expect(() => parseReleaseArgs(["patch", "--dryrun"])).toThrow("Unknown option --dryrun.");
  });

  test("bad arguments print the usage and run nothing", () => {
    for (const argv of [[], ["patch", "--dryrun"], ["patch", "minor"]]) {
      const result = releaseWith(argv);
      expect(result.status).toBe(1);
      expect(result.err).toContain(USAGE);
      expect(result.err).not.toContain("Release aborted");
      expect(result.stub.calls).toEqual([]);
    }
  });

  test("a bump that does not move forward aborts before any command runs", () => {
    const result = releaseWith(["0.5.0"]);
    expect(result.status).toBe(1);
    expect(result.err).toBe("Release aborted: Version 0.5.0 is not greater than the current version 0.5.0.");
    expect(result.stub.calls).toEqual([]);
  });
});

describe("release run with stubbed commands", () => {
  test("--dry-run runs every preflight check and changes nothing", () => {
    const root = releaseFixture();
    const before = read(root, "package.json");
    const changelog = read(root, "CHANGELOG.md");
    const result = releaseWith(["minor", "--dry-run"], { root });
    expect(result.err).toBe("");
    expect(result.status).toBe(0);
    expect(result.out).toContain("Releasing 0.5.0 -> 0.6.0 (v0.6.0)");
    expect(result.out).toContain("Preflight passed for 0.6.0.");
    expect(result.out).toContain("Dry run: would bump package.json");
    const bunRuns = result.stub.calls.filter((call) => call.key.startsWith("bun run "));
    expect(bunRuns.map((call) => call.key.slice("bun run ".length))).toEqual(PREFLIGHT);
    expect(bunRuns.every((call) => call.inherit)).toBe(true);
    expect(result.stub.keys().filter((key) => PUBLISHING.test(key))).toEqual([]);
    expect(read(root, "package.json")).toBe(before);
    expect(read(root, "CHANGELOG.md")).toBe(changelog);
  });

  test("a full run bumps every file, then commits, tags, pushes, and releases in order", () => {
    const result = releaseWith(["patch"]);
    expect(result.err).toBe("");
    expect(result.status).toBe(0);
    for (const relativePath of ["package.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"]) {
      expect(JSON.parse(read(result.root, relativePath)).version).toBe("0.5.1");
    }
    expect(read(result.root, "src/version.js")).toBe('export const VERSION = "0.5.1";\n');
    for (const name of ["story-checks.yml", "draft-next-chapter.yml", "review-copy.yml"]) {
      expect(read(result.root, `templates/github/${name}`)).toContain('STORY_VERSION: "0.5.1"');
    }
    expect(read(result.root, "docs/install.md")).toBe("npm install -g story-skills@0.5.1\n");
    const changelog = read(result.root, "CHANGELOG.md");
    expect(changelog).toContain("## [Unreleased]\n\n## [0.5.1] - 2026-10-06\n\n### Added\n\n- Added a thing.");
    expect(changelog).toContain("[0.5.1]: https://github.com/danjdewhurst/story-skills/compare/v0.5.0...v0.5.1");

    const keys = result.stub.keys();
    expect(keys.slice(keys.indexOf(`bun run ${PREFLIGHT.at(-1)}`) + 1)).toEqual([
      "bun run build:fallback",
      "bun run check:metadata",
      `git add ${WRITTEN}`,
      "git commit -m chore: release 0.5.1",
      "git rev-parse HEAD",
      "git tag -a v0.5.1 -m v0.5.1",
      PUSH_TARGETS,
      PUSH,
      GH_RELEASE
    ]);
    expect(result.sleeps).toEqual([]);
    expect(result.out).toContain("Created GitHub release: https://github.com/danjdewhurst/story-skills/releases/tag/v0.5.1");
    expect(result.out).toContain("publishes story-skills@0.5.1 to npm once CI passes on main for the release commit");
  });

  test("refuses an empty Unreleased section before any slow check", () => {
    const result = releaseWith(["patch"], { root: releaseFixture({ unreleased: "" }) });
    expect(result.status).toBe(1);
    expect(result.err).toBe(
      'Release aborted: CHANGELOG.md has no entries under "## [Unreleased]". Add the user-visible changes first.'
    );
    expect(result.stub.keys().some((key) => key.startsWith("bun ") || PUBLISHING.test(key))).toBe(false);
  });

  const refusals = [
    ["a branch other than main", { "git rev-parse --abbrev-ref HEAD": "feature\n" }, "releases are cut from main."],
    ["a dirty working tree", { "git status --porcelain": " M README.md\n" }, "working tree is not clean. Commit or stash your changes first."],
    ["main out of step with origin", { "git rev-parse origin/main": "def456\n" }, "local main does not match origin/main. Pull or push first."],
    ["an existing tag", { "git tag --list v0.5.1": "v0.5.1\n" }, "tag v0.5.1 already exists."],
    ["gh logged out", { "gh auth status": throws(commandError("not logged in")) }, "gh is not installed or not logged in. Run `gh auth login`."],
    ["an existing GitHub release", { "gh release view v0.5.1": "v0.5.1\n" }, "GitHub release v0.5.1 already exists."],
    [
      "a GitHub release lookup that fails",
      { "gh release view v0.5.1": throws(commandError("HTTP 401: Bad credentials")) },
      "could not check GitHub release v0.5.1: HTTP 401: Bad credentials"
    ],
    ["a version already on npm", { "npm view story-skills@0.5.1 version": "0.5.1\n" }, "story-skills@0.5.1 is already published on npm."],
    [
      "an npm lookup that fails",
      { "npm view story-skills@0.5.1 version": throws(commandError("npm error code E401")) },
      "could not check npm for story-skills@0.5.1: npm error code E401"
    ],
    [
      "a missing bun",
      { "bun run check:metadata": throws(Object.assign(new Error("spawnSync bun ENOENT"), { code: "ENOENT" })) },
      MISSING_BUN_MESSAGE
    ]
  ];

  for (const [name, replies, message] of refusals) {
    test(`refuses ${name} and never publishes`, () => {
      const root = releaseFixture();
      const before = read(root, "package.json");
      const result = releaseWith(["patch"], { root, replies });
      expect(result.status).toBe(1);
      expect(result.err).toBe(`Release aborted: ${message}`);
      expect(result.stub.keys().filter((key) => PUBLISHING.test(key))).toEqual([]);
      expect(read(root, "package.json")).toBe(before);
    });
  }

  test("a failing preflight check propagates instead of releasing", () => {
    const root = releaseFixture();
    const before = read(root, "package.json");
    expect(() =>
      releaseWith(["patch"], { root, replies: { "bun run test:coverage": throws(commandError("1 fail", { status: 1 })) } })
    ).toThrow("1 fail");
    expect(read(root, "package.json")).toBe(before);
  });

  for (const argv of [["patch"], ["patch", "--dry-run"]]) {
    test(`a changelog that already has the new section stops ${argv.join(" ")} before any slow check`, () => {
      const root = releaseFixture();
      const changelogPath = path.join(root, "CHANGELOG.md");
      fs.writeFileSync(
        changelogPath,
        fs.readFileSync(changelogPath, "utf8").replace("## [0.5.0]", "## [0.5.1] - 2026-01-02\n\n- Oops.\n\n## [0.5.0]")
      );
      const before = read(root, "package.json");
      const changelog = read(root, "CHANGELOG.md");
      const result = releaseWith(argv, { root });
      expect(result.status).toBe(1);
      expect(result.err).toBe(
        'Release aborted: CHANGELOG.md already has a section for 0.5.1. Move its entries back under "## [Unreleased]" and remove its heading, or release a later version.'
      );
      expect(result.stub.keys().some((key) => key.startsWith("bun ") || PUBLISHING.test(key))).toBe(false);
      expect(read(root, "package.json")).toBe(before);
      expect(read(root, "CHANGELOG.md")).toBe(changelog);
    });
  }

  test("a failed `gh release create` after the push says how to finish, and undoes nothing", () => {
    const result = releaseWith(["patch"], { replies: { [GH_RELEASE]: throws(commandError("HTTP 502: Bad Gateway")) } });
    expect(result.status).toBe(1);
    expect(result.err).toBe(
      [
        "Release aborted: main and v0.5.1 are on origin, but `gh release create` failed: HTTP 502: Bad Gateway",
        "Do not run the release again, and leave v0.5.1 where it is. The Publish workflow runs for v0.5.1 anyway: once CI and the binaries pass, its release-assets job waits five minutes for the GitHub release, and npm publishes only after that job passes.",
        "Create the release now: gh release create v0.5.1 --title v0.5.1 --generate-notes --verify-tag",
        "If release-assets has already failed, re-run the failed jobs of that Publish run: `gh run list --workflow publish.yml` lists the runs, then `gh run rerun <run-id> --failed`."
      ].join("\n")
    );
    expect(result.out).toContain("Pushed main and v0.5.1");
    // The tag is on origin and tag rules forbid moving or deleting it.
    expect(result.stub.keys().filter((key) => /^git (reset|update-ref|checkout|tag -d|push .*(--delete|--force|-f\b| :refs))/.test(key))).toEqual([]);
  });

  const unreachable = commandError("fatal: unable to access origin: Could not resolve host");
  for (const [name, replies, cause] of [
    ["origin cannot be reached", { [REMOTE_TAG]: throws(unreachable) }, unreachable.stderr],
    ["the local tag cannot be read", { "git rev-parse refs/tags/v0.5.1": throws(commandError("fatal: bad object")) }, "fatal: bad object"]
  ]) {
    test(`a failed push is left for the maintainer to check when ${name}`, () => {
      const result = releaseWith(["patch"], { replies: { [PUSH]: throws(unreachable), ...replies } });
      expect(result.status).toBe(1);
      expect(result.err).toBe(
        [
          `Release aborted: \`git push\` failed: ${unreachable.stderr}`,
          `Could not check whether the push reached origin: ${cause}`,
          "Run `git ls-remote --tags origin refs/tags/v0.5.1` and compare the SHA it prints with `git rev-parse refs/tags/v0.5.1`. " +
            `If origin lists no v0.5.1, the push did not land: undo the release with \`git tag -d v0.5.1\`, then \`git update-ref refs/heads/main abc123 rel456\`, then \`git checkout abc123 -- ${WRITTEN}\`, then run it again. ` +
            "If the SHAs match, the push landed: create the GitHub release with `gh release create v0.5.1 --title v0.5.1 --generate-notes --verify-tag`. " +
            "If they differ, another release of 0.5.1 reached origin first: undo this one the same way, then fetch main and the tags and check that release."
        ].join("\n")
      );
      expect(result.stub.keys().filter((key) => /^(git (update-ref|checkout|tag -d)|gh release create)/.test(key))).toEqual([]);
    });
  }

  test("a missing bun after the bump restores the files the release wrote", () => {
    const result = releaseWith(["patch"], {
      replies: { "bun run build:fallback": throws(Object.assign(new Error("spawnSync bun ENOENT"), { code: "ENOENT" })) }
    });
    expect(result.status).toBe(1);
    expect(result.err).toBe(
      `Release aborted: the release failed before anything was pushed: ${MISSING_BUN_MESSAGE}\n` +
        "Rolled back: main is at abc123 again and the files the release wrote are restored. Fix the problem, then run the release again."
    );
    const keys = result.stub.keys();
    expect(keys.slice(keys.indexOf("bun run build:fallback") + 1)).toEqual([
      "git symbolic-ref -q HEAD",
      "git rev-parse HEAD",
      `git checkout abc123 -- ${WRITTEN}`
    ]);
  });

  test("a failure before the release writes anything has nothing to roll back", () => {
    const result = releaseWith(["patch"], {
      deps: {
        today: () => {
          throw new Error("no clock");
        }
      }
    });
    expect(result.status).toBe(1);
    expect(result.err).toBe(
      "Release aborted: the release failed before anything was pushed: no clock\nNothing had changed yet. Fix the problem, then run the release again."
    );
    expect(result.stub.keys().filter((key) => /^git (update-ref|checkout|tag -d|symbolic-ref)/.test(key))).toEqual([]);
  });

  test("the default runner executes commands in the release root", () => {
    const root = makeTempDir("story-release-root-");
    const deps = releaseDeps({ root });
    expect(deps.root).toBe(root);
    expect(deps.run(process.execPath, ["-e", "process.stdout.write(process.cwd())"])).toBe(fs.realpathSync(root));
    expect(deps.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const started = Date.now();
    deps.sleep(20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});

// git for the throwaway repositories reads nothing from this machine: no
// global or system config, and no inherited GIT_* variable (a GIT_DIR from a
// hook would point every command, the release's own included, at another
// repository). It has a fixed identity, no signing, and no line-ending
// conversion, so a restore puts files back byte for byte.
const GIT_SETTINGS = [
  ["user.name", "Release Test"],
  ["user.email", "release@example.com"],
  ["init.defaultBranch", "main"],
  ["commit.gpgsign", "false"],
  ["tag.gpgsign", "false"],
  ["core.autocrlf", "false"]
];

function gitEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  GIT_SETTINGS.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return { ...env, GIT_CONFIG_COUNT: String(GIT_SETTINGS.length), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
}

function gitIn(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: gitEnv() });
}

// The release fixture, plus a file the release never writes, committed on
// main in a real repository with a bare origin that already has the commit.
function gitFixture() {
  const root = releaseFixture();
  fs.writeFileSync(path.join(root, "docs", "notes.md"), "Notes.\n");
  const origin = path.join(makeTempDir("story-release-origin-"), "origin.git");
  gitIn(path.dirname(origin), "init", "-q", "--bare", origin);
  gitIn(root, "init", "-q");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "initial");
  gitIn(root, "remote", "add", "origin", origin);
  gitIn(root, "push", "-q", "origin", "main");
  const head = gitIn(root, "rev-parse", "HEAD").trim();
  const files = Object.fromEntries(gitIn(root, "ls-files").trim().split("\n").map((file) => [file, read(root, file)]));
  return {
    root,
    origin,
    head,
    git: (...args) => gitIn(root, ...args),
    // What every tracked file held before the release.
    files,
    // Someone else pushes to main while the release runs.
    advanceOrigin() {
      const commit = gitIn(origin, "commit-tree", `${head}^{tree}`, "-p", head, "-m", "concurrent").trim();
      gitIn(origin, "update-ref", "refs/heads/main", commit);
    }
  };
}

// Runs the release in a git fixture. `fail` names git commands (their first
// arguments, such as "commit" or "tag -a") that throw instead of running.
function gitRelease(repo, { replies, fail = [] } = {}) {
  const git = (...args) => {
    const command = args.join(" ");
    const failing = fail.find((prefix) => command.startsWith(prefix));
    if (failing) {
      throw commandError(`fatal: ${failing} failed in test`);
    }
    return repo.git(...args);
  };
  return releaseWith(["patch"], { root: repo.root, git, replies });
}

function expectUntouched(repo) {
  expect(repo.git("rev-parse", "HEAD").trim()).toBe(repo.head);
  expect(repo.git("symbolic-ref", "HEAD").trim()).toBe("refs/heads/main");
  expect(repo.git("status", "--porcelain")).toBe("");
  expect(repo.git("tag", "--list")).toBe("");
  for (const [file, text] of Object.entries(repo.files)) {
    expect(read(repo.root, file)).toBe(text);
  }
  expect(gitIn(repo.origin, "for-each-ref", "--format=%(refname)").trim()).toBe("refs/heads/main");
}

const rolledBack = (repo, tag = false) =>
  `Rolled back: main is at ${repo.head} again${tag ? ", the local v0.5.1 tag is deleted," : ""} and the files the release wrote are restored. Fix the problem, then run the release again.`;

describe("release run against a throwaway git origin", () => {
  test("a failed step before the commit restores only the files the release wrote", () => {
    const repo = gitFixture();
    const result = gitRelease(repo, {
      replies: {
        "bun run build:fallback": () => {
          fs.writeFileSync(path.join(repo.root, FALLBACK), "half built\n");
          // The maintainer edits a file the release never writes.
          fs.writeFileSync(path.join(repo.root, "docs", "notes.md"), "Notes, edited during the checks.\n");
          throw failedBuild();
        }
      }
    });
    expect(result.status).toBe(1);
    expect(result.err).toBe(`Release aborted: the release failed before anything was pushed: Command failed: bun run build:fallback\n${rolledBack(repo)}`);
    expect(repo.git("status", "--porcelain")).toBe(" M docs/notes.md\n");
    expect(read(repo.root, "docs/notes.md")).toBe("Notes, edited during the checks.\n");
    fs.writeFileSync(path.join(repo.root, "docs", "notes.md"), repo.files["docs/notes.md"]);
    expectUntouched(repo);
    expect(result.stub.keys().filter((key) => PUBLISHING.test(key))).toEqual([]);
  });

  test("a failed commit unstages and restores the files the release wrote", () => {
    const repo = gitFixture();
    const result = gitRelease(repo, { fail: ["commit"] });
    expect(result.status).toBe(1);
    expect(result.err).toBe(`Release aborted: the release failed before anything was pushed: fatal: commit failed in test\n${rolledBack(repo)}`);
    expectUntouched(repo);
  });

  test("a failed tag after the commit moves main back off the release commit", () => {
    const repo = gitFixture();
    const result = gitRelease(repo, { fail: ["tag -a"] });
    expect(result.status).toBe(1);
    expect(result.err).toBe(`Release aborted: the release failed before anything was pushed: fatal: tag -a failed in test\n${rolledBack(repo)}`);
    expect(result.stub.keys()).toContain(`git update-ref refs/heads/main ${repo.head} ${repo.git("rev-parse", "HEAD@{1}").trim()}`);
    expectUntouched(repo);
  });

  test("a rollback changes nothing once something else has moved HEAD", () => {
    const repo = gitFixture();
    const result = gitRelease(repo, {
      replies: {
        "bun run build:fallback": () => {
          repo.git("checkout", "-q", "-b", "other");
          repo.git("commit", "-q", "--allow-empty", "-m", "work on another branch");
          throw failedBuild();
        }
      }
    });
    const other = repo.git("rev-parse", "other").trim();
    expect(result.status).toBe(1);
    expect(result.err).toBe(
      "Release aborted: the release failed before anything was pushed: Command failed: bun run build:fallback\n" +
        `Nothing was rolled back: HEAD is no longer main at ${repo.head}, so something else changed the repository while the release ran. ` +
        `Check \`git status\` and \`git log\`, then, with main checked out, undo the release by hand with \`git checkout ${repo.head} -- ${WRITTEN}\`.`
    );
    expect(repo.git("symbolic-ref", "HEAD").trim()).toBe("refs/heads/other");
    expect(repo.git("rev-parse", "HEAD").trim()).toBe(other);
    expect(repo.git("rev-parse", "main").trim()).toBe(repo.head);
    expect(JSON.parse(read(repo.root, "package.json")).version).toBe("0.5.1");
  });

  test("a push origin refuses rolls back the release commit and the local tag", () => {
    const repo = gitFixture();
    const result = gitRelease(repo, {
      replies: {
        "bun run build:fallback": () => {
          repo.advanceOrigin();
          return "";
        }
      }
    });
    expect(result.status).toBe(1);
    expect(result.err).toStartWith("Release aborted: `git push` failed and origin does not have v0.5.1, so the atomic push probably did not land: ");
    expect(result.err).toContain("[rejected]");
    expect(result.err).toEndWith(
      "If origin/main has moved on, pull it first. Only a repository admin can push a v* tag. " +
        "If `git ls-remote --tags origin refs/tags/v0.5.1` lists v0.5.1 later after all, the push landed: pull main, then create the GitHub release with `gh release create v0.5.1 --title v0.5.1 --generate-notes --verify-tag`.\n" +
        rolledBack(repo, true)
    );
    // Origin was asked three times, five seconds apart, before the rollback.
    expect(result.stub.keys().filter((key) => key === REMOTE_TAG)).toHaveLength(3);
    expect(result.sleeps).toEqual([5000, 5000]);
    expect(repo.git("rev-parse", "HEAD").trim()).toBe(repo.head);
    expect(repo.git("status", "--porcelain")).toBe("");
    expect(repo.git("tag", "--list")).toBe("");
    expect(gitIn(repo.origin, "tag", "--list")).toBe("");
    expect(result.stub.keys()).not.toContain(GH_RELEASE);
  });

  test("another release's tag on origin is reported as such, and this release is rolled back", () => {
    const repo = gitFixture();
    let theirs;
    const result = gitRelease(repo, {
      replies: {
        "bun run build:fallback": () => {
          gitIn(repo.origin, "tag", "-a", "v0.5.1", "-m", "another releaser", repo.head);
          theirs = gitIn(repo.origin, "rev-parse", "refs/tags/v0.5.1").trim();
          return "";
        }
      }
    });
    expect(result.status).toBe(1);
    expect(result.err).toMatch(
      new RegExp(`^Release aborted: origin already has a different v0\\.5\\.1 \\(${theirs}; this run made [0-9a-f]{40}\\), so another release of 0\\.5\\.1 reached origin first, and the atomic push changed nothing there: `)
    );
    expect(result.err).toEndWith(`Fetch main and the tags, and check that release before you release again.\n${rolledBack(repo, true)}`);
    expect(result.sleeps).toEqual([]);
    expect(repo.git("rev-parse", "HEAD").trim()).toBe(repo.head);
    expect(repo.git("status", "--porcelain")).toBe("");
    expect(repo.git("tag", "--list")).toBe("");
    expect(gitIn(repo.origin, "rev-parse", "main", "refs/tags/v0.5.1").trim().split("\n")).toEqual([repo.head, theirs]);
  });

  for (const [failing, remaining] of [
    ["tag -d", (repo, release) => `\`git tag -d v0.5.1\`, then \`git update-ref refs/heads/main ${repo.head} ${release}\`, then \`git checkout ${repo.head} -- ${WRITTEN}\``],
    ["update-ref", (repo, release) => `\`git update-ref refs/heads/main ${repo.head} ${release}\`, then \`git checkout ${repo.head} -- ${WRITTEN}\``]
  ]) {
    test(`a rollback whose ${failing} fails lists only the steps still to do`, () => {
      const repo = gitFixture();
      const result = gitRelease(repo, {
        fail: [failing],
        replies: {
          "bun run build:fallback": () => {
            repo.advanceOrigin();
            return "";
          }
        }
      });
      const release = repo.git("rev-parse", "main").trim();
      expect(result.status).toBe(1);
      expect(result.err).toEndWith(
        `\nThe rollback failed too: fatal: ${failing} failed in test\nFinish it by hand with ${remaining(repo, release)}, then run the release again.`
      );
      expect(repo.git("tag", "--list")).toBe(failing === "tag -d" ? "v0.5.1\n" : "");
    });
  }

  test("a ref on origin that git push would take for main or the tag stops the release before the push", () => {
    const repo = gitFixture();
    gitIn(repo.origin, "update-ref", "refs/heads/refs/tags/v0.5.1", repo.head);
    const result = gitRelease(repo);
    expect(result.status).toBe(1);
    expect(result.err).toBe(
      "Release aborted: the release failed before anything was pushed: origin has refs/heads/refs/tags/v0.5.1, which `git push` would update in place of refs/heads/main or refs/tags/v0.5.1. Ask a repository admin to delete it.\n" +
        rolledBack(repo, true)
    );
    expect(result.stub.keys()).not.toContain(PUSH);
    expect(gitIn(repo.origin, "for-each-ref", "--format=%(refname) %(objectname)").trim().split("\n")).toEqual([
      `refs/heads/main ${repo.head}`,
      `refs/heads/refs/tags/v0.5.1 ${repo.head}`
    ]);
  });

  test("a push that lands but reports an error goes on to the GitHub release", () => {
    const repo = gitFixture();
    const result = gitRelease(repo, {
      replies: {
        [PUSH]: () => {
          repo.git("push", "-q", "--atomic", "origin", "refs/heads/main:refs/heads/main", "refs/tags/v0.5.1:refs/tags/v0.5.1");
          throw commandError("fatal: the remote end hung up unexpectedly");
        }
      }
    });
    expect(result.err).toBe("");
    expect(result.status).toBe(0);
    expect(result.out).toContain("`git push` reported an error, but origin has v0.5.1, so the push landed: fatal: the remote end hung up unexpectedly");
    expect(result.out).toContain("Created GitHub release:");
    const release = repo.git("rev-parse", "HEAD").trim();
    expect(release).not.toBe(repo.head);
    expect(gitIn(repo.origin, "rev-parse", "main", "v0.5.1^{commit}").trim().split("\n")).toEqual([release, release]);
  });

  test("a full release pushes main and the tag to origin", () => {
    const repo = gitFixture();
    const result = gitRelease(repo);
    expect(result.err).toBe("");
    expect(result.status).toBe(0);
    const release = repo.git("rev-parse", "HEAD").trim();
    expect(repo.git("log", "-1", "--format=%s").trim()).toBe("chore: release 0.5.1");
    expect(repo.git("status", "--porcelain")).toBe("");
    expect(gitIn(repo.origin, "rev-parse", "main", "v0.5.1^{commit}").trim().split("\n")).toEqual([release, release]);
  });
});

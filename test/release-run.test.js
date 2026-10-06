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

const GIT_REPLIES = {
  "git rev-parse --abbrev-ref HEAD": "main\n",
  "git status --porcelain": "",
  "git fetch origin main --tags": "",
  "git rev-parse HEAD": "abc123\n",
  "git rev-parse origin/main": "abc123\n"
};

// Replies keyed by the command and its arguments joined by spaces; a function
// reply may throw. Given `git`, unscripted git commands run through it for
// real; anything else unscripted fails the test.
function stubRun(overrides = {}, git = null) {
  const calls = [];
  const replies = {
    ...(git ? {} : GIT_REPLIES),
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
    if (/^git (add|commit|tag -a|tag -d|push|reset --hard) /.test(key)) return "";
    if (key.startsWith("gh release create ")) return "https://github.com/danjdewhurst/story-skills/releases/tag/v0.5.1\n";
    throw new Error(`unexpected command in test: ${key}`);
  };
  return { run, calls, keys: () => calls.map((call) => call.key) };
}

function releaseWith(argv, { root = releaseFixture(), replies, git } = {}) {
  const stub = stubRun(replies, git);
  const logs = [];
  const errors = [];
  const status = runRelease(argv, {
    root,
    run: stub.run,
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    today: () => "2026-10-06"
  });
  return { status, root, stub, out: logs.join("\n"), err: errors.join("\n") };
}

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
      [
        "git add package.json .codex-plugin/plugin.json .claude-plugin/plugin.json src/version.js",
        "templates/github/story-checks.yml templates/github/draft-next-chapter.yml templates/github/review-copy.yml",
        "docs/install.md CHANGELOG.md skills/story-maintenance/scripts/story.js"
      ].join(" "),
      "git commit -m chore: release 0.5.1",
      "git tag -a v0.5.1 -m v0.5.1",
      "git push --atomic origin main v0.5.1",
      "gh release create v0.5.1 --title v0.5.1 --generate-notes --verify-tag"
    ]);
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
    const result = releaseWith(["patch"], {
      replies: { "gh release create v0.5.1 --title v0.5.1 --generate-notes --verify-tag": throws(commandError("HTTP 502: Bad Gateway")) }
    });
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
    expect(result.stub.keys().filter((key) => /^git (reset|tag -d|push .*(--delete|--force|-f\b|:refs))/.test(key))).toEqual([]);
  });

  test("a push whose outcome origin cannot confirm is left for the maintainer to check", () => {
    const result = releaseWith(["patch"], {
      replies: {
        "git push --atomic origin main v0.5.1": throws(commandError("fatal: unable to access origin: Could not resolve host")),
        "git ls-remote origin refs/tags/v0.5.1": throws(commandError("fatal: unable to access origin: Could not resolve host"))
      }
    });
    expect(result.status).toBe(1);
    expect(result.err).toBe(
      [
        "Release aborted: `git push` failed: fatal: unable to access origin: Could not resolve host",
        "Could not ask origin whether the push landed: fatal: unable to access origin: Could not resolve host",
        "Run `git ls-remote origin refs/tags/v0.5.1`. If it prints nothing, the push did not land: run `git tag -d v0.5.1` and `git reset --hard abc123`, then run the release again. If it prints the tag, the push landed: create the GitHub release with `gh release create v0.5.1 --title v0.5.1 --generate-notes --verify-tag`."
      ].join("\n")
    );
    expect(result.stub.keys().filter((key) => /^(git (reset|tag -d)|gh release create)/.test(key))).toEqual([]);
  });

  test("a rollback that fails too names the commands that finish it", () => {
    const result = releaseWith(["patch"], {
      replies: {
        "bun run build:fallback": throws(Object.assign(new Error("Command failed: bun run build:fallback"), { status: 1, stderr: null })),
        "git reset --hard abc123": throws(commandError("fatal: Unable to create '.git/index.lock': File exists."))
      }
    });
    expect(result.status).toBe(1);
    expect(result.err).toBe(
      [
        "Release aborted: the release failed before anything was pushed: Command failed: bun run build:fallback",
        "The rollback failed too: fatal: Unable to create '.git/index.lock': File exists.",
        "Undo the release by hand with `git reset --hard abc123`, then run the release again."
      ].join("\n")
    );
    expect(result.stub.keys().filter((key) => PUBLISHING.test(key))).toEqual([]);
  });

  test("a missing bun after the bump rolls the bump back", () => {
    const result = releaseWith(["patch"], {
      replies: { "bun run build:fallback": throws(Object.assign(new Error("spawnSync bun ENOENT"), { code: "ENOENT" })) }
    });
    expect(result.status).toBe(1);
    expect(result.err).toBe(
      `Release aborted: the release failed before anything was pushed: ${MISSING_BUN_MESSAGE}\n` +
        "Rolled back: main is at abc123 again and the bumped files are restored. Fix the problem, then run the release again."
    );
    const keys = result.stub.keys();
    expect(keys.slice(keys.indexOf("bun run build:fallback") + 1)).toEqual(["git reset --hard abc123"]);
  });

  test("the default runner executes commands in the release root", () => {
    const root = makeTempDir("story-release-root-");
    const deps = releaseDeps({ root });
    expect(deps.root).toBe(root);
    expect(deps.run(process.execPath, ["-e", "process.stdout.write(process.cwd())"])).toBe(fs.realpathSync(root));
    expect(deps.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// git config for the throwaway repositories: a fixed identity, no signing,
// and no line-ending conversion, so a reset restores files byte for byte.
const GIT_CONFIG = ["-c", "user.name=Release Test", "-c", "user.email=release@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.autocrlf=false"];

function gitIn(cwd, ...args) {
  return execFileSync("git", [...GIT_CONFIG, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// The release fixture committed on main in a real repository, with a bare
// origin that already has that commit.
function gitFixture() {
  const root = releaseFixture();
  const origin = path.join(makeTempDir("story-release-origin-"), "origin.git");
  gitIn(path.dirname(origin), "init", "-q", "--bare", "-b", "main", origin);
  gitIn(root, "init", "-q", "-b", "main");
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

function expectUntouched(repo) {
  expect(repo.git("rev-parse", "HEAD").trim()).toBe(repo.head);
  expect(repo.git("status", "--porcelain")).toBe("");
  expect(repo.git("tag", "--list")).toBe("");
  for (const [file, text] of Object.entries(repo.files)) {
    expect(read(repo.root, file)).toBe(text);
  }
}

describe("release run against a throwaway git origin", () => {
  test("a failed step before the push restores every file and leaves main where it was", () => {
    const repo = gitFixture();
    const result = releaseWith(["patch"], {
      root: repo.root,
      git: repo.git,
      replies: {
        "bun run build:fallback": () => {
          fs.writeFileSync(path.join(repo.root, FALLBACK), "half built\n");
          throw Object.assign(new Error("Command failed: bun run build:fallback"), { status: 1, stderr: null });
        }
      }
    });
    expect(result.status).toBe(1);
    expect(result.err).toBe(
      "Release aborted: the release failed before anything was pushed: Command failed: bun run build:fallback\n" +
        `Rolled back: main is at ${repo.head} again and the bumped files are restored. Fix the problem, then run the release again.`
    );
    expectUntouched(repo);
    expect(result.stub.keys().filter((key) => PUBLISHING.test(key))).toEqual([]);
  });

  test("a push origin refuses rolls back the release commit and the local tag", () => {
    const repo = gitFixture();
    const result = releaseWith(["patch"], {
      root: repo.root,
      git: repo.git,
      replies: {
        "bun run build:fallback": () => {
          repo.advanceOrigin();
          return "";
        }
      }
    });
    expect(result.status).toBe(1);
    expect(result.err).toStartWith("Release aborted: `git push` failed and origin does not have this release's v0.5.1, so the atomic push changed nothing there: ");
    expect(result.err).toContain("[rejected]");
    expect(result.err).toEndWith(
      "If origin/main has moved on, pull it first. Only a repository admin can push a v* tag.\n" +
        `Rolled back: main is at ${repo.head} again, the local v0.5.1 tag is deleted, and the bumped files are restored. Fix the problem, then run the release again.`
    );
    expectUntouched(repo);
    expect(gitIn(repo.origin, "tag", "--list")).toBe("");
    expect(result.stub.keys().some((key) => key.startsWith("gh release create "))).toBe(false);
  });

  test("a push that lands but reports an error goes on to the GitHub release", () => {
    const repo = gitFixture();
    const result = releaseWith(["patch"], {
      root: repo.root,
      git: repo.git,
      replies: {
        "git push --atomic origin main v0.5.1": () => {
          repo.git("push", "-q", "--atomic", "origin", "main", "v0.5.1");
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
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import { MISSING_BUN_MESSAGE } from "../scripts/bun-missing.js";
import { PREFLIGHT, USAGE, parseReleaseArgs, releaseDeps, runRelease } from "../scripts/release.js";

// These tests drive scripts/release.js end to end with every external command
// stubbed. Nothing here starts git, gh, npm, or bun, so a test can never tag,
// push, or publish.

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

// Replies keyed by the command and its arguments joined by spaces; a function
// reply may throw. Anything unscripted fails the test.
function stubRun(overrides = {}) {
  const calls = [];
  const replies = {
    "git rev-parse --abbrev-ref HEAD": "main\n",
    "git status --porcelain": "",
    "git fetch origin main --tags": "",
    "git rev-parse HEAD": "abc123\n",
    "git rev-parse origin/main": "abc123\n",
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
    if (key.startsWith("git tag --list ")) return "";
    if (/^git (add|commit|tag -a|push) /.test(key)) return "";
    if (key.startsWith("gh release create ")) return "https://github.com/danjdewhurst/story-skills/releases/tag/v0.5.1\n";
    throw new Error(`unexpected command in test: ${key}`);
  };
  return { run, calls, keys: () => calls.map((call) => call.key) };
}

function releaseWith(argv, { root = releaseFixture(), replies } = {}) {
  const stub = stubRun(replies);
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

  test("a changelog that already has the new section stops before any bump", () => {
    const root = releaseFixture();
    const changelogPath = path.join(root, "CHANGELOG.md");
    fs.writeFileSync(
      changelogPath,
      fs.readFileSync(changelogPath, "utf8").replace("## [0.5.0]", "## [0.5.1] - 2026-01-02\n\n- Oops.\n\n## [0.5.0]")
    );
    const before = read(root, "package.json");
    expect(() => releaseWith(["patch"], { root })).toThrow("already has a section for 0.5.1");
    expect(read(root, "package.json")).toBe(before);
  });

  test("the default runner executes commands in the release root", () => {
    const root = makeTempDir("story-release-root-");
    const deps = releaseDeps({ root });
    expect(deps.root).toBe(root);
    expect(deps.run(process.execPath, ["-e", "process.stdout.write(process.cwd())"])).toBe(fs.realpathSync(root));
    expect(deps.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

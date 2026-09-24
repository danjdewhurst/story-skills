import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { bumpVersion, isAbsentGitHubRelease, isAbsentNpmVersion, releasePushArgs, replaceVersion, updateVersionFiles } from "../scripts/release.js";

describe("release script", () => {
  test("bumps patch, minor, and major", () => {
    expect(bumpVersion("0.3.1", "patch")).toBe("0.3.2");
    expect(bumpVersion("0.3.1", "minor")).toBe("0.4.0");
    expect(bumpVersion("0.3.1", "major")).toBe("1.0.0");
  });

  test("accepts an explicit version only when it is greater than the current one", () => {
    expect(bumpVersion("0.3.1", "1.2.3")).toBe("1.2.3");
    expect(() => bumpVersion("0.3.1", "0.3.1")).toThrow("not greater");
    expect(() => bumpVersion("0.3.1", "0.2.9")).toThrow("not greater");
    expect(() => bumpVersion("0.3.1", "banana")).toThrow("Expected patch, minor, major");
    expect(() => bumpVersion("0.3.1-beta", "patch")).toThrow("not a plain MAJOR.MINOR.PATCH");
  });

  test("replaces only the version field and preserves formatting", () => {
    const json = '{\n  "name": "story-skills",\n  "version": "0.3.1",\n  "keywords": ["a", "b"]\n}\n';
    expect(replaceVersion(json, "0.4.0")).toBe('{\n  "name": "story-skills",\n  "version": "0.4.0",\n  "keywords": ["a", "b"]\n}\n');
    expect(() => replaceVersion('{\n  "name": "x"\n}\n', "1.0.0")).toThrow('No top-level "version"');
  });

  test("every release-managed file has a replaceable version field", () => {
    const repoRoot = path.resolve(import.meta.dir, "..");
    for (const relativePath of ["package.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"]) {
      const original = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
      const updated = replaceVersion(original, "9.9.9");
      expect(JSON.parse(updated).version).toBe("9.9.9");
      expect(updated.replace("9.9.9", JSON.parse(original).version)).toBe(original);
    }
  });

  test("updateVersionFiles bumps versions and template refs together", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-release-"));
    fs.mkdirSync(path.join(dir, "templates", "github"), { recursive: true });
    for (const relativePath of ["package.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"]) {
      fs.mkdirSync(path.join(dir, path.dirname(relativePath)), { recursive: true });
      fs.writeFileSync(path.join(dir, relativePath), '{\n  "name": "story-skills",\n  "version": "0.5.0"\n}\n', "utf8");
    }
    for (const name of ["story-checks.yml", "draft-next-chapter.yml"]) {
      fs.writeFileSync(path.join(dir, "templates", "github", name), 'env:\n  STORY_REF: "v0.5.0"\n', "utf8");
    }
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "version.js"), '// note\nexport const VERSION = "0.5.0";\n', "utf8");
    expect(updateVersionFiles(dir, "0.6.0")).toEqual([
      "package.json",
      ".codex-plugin/plugin.json",
      ".claude-plugin/plugin.json",
      "src/version.js",
      "templates/github/story-checks.yml",
      "templates/github/draft-next-chapter.yml"
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version).toBe("0.6.0");
    expect(fs.readFileSync(path.join(dir, "src", "version.js"), "utf8")).toBe('// note\nexport const VERSION = "0.6.0";\n');
    for (const name of ["story-checks.yml", "draft-next-chapter.yml"]) {
      expect(fs.readFileSync(path.join(dir, "templates", "github", name), "utf8")).toContain('STORY_REF: "v0.6.0"');
    }
    fs.writeFileSync(path.join(dir, "templates", "github", "story-checks.yml"), "env: {}\n", "utf8");
    expect(() => updateVersionFiles(dir, "0.6.1")).toThrow("No STORY_REF");
  });

  test("treats only a missing GitHub release as absent", () => {
    expect(isAbsentGitHubRelease({ stderr: "release not found\n", status: 1 })).toBe(true);
    expect(isAbsentGitHubRelease({ stderr: "HTTP 401: Bad credentials\n", status: 1 })).toBe(false);
    expect(isAbsentGitHubRelease({ message: "connect ETIMEDOUT", status: 1 })).toBe(false);
  });

  test("treats only an npm E404 as an unpublished version", () => {
    expect(isAbsentNpmVersion({ stderr: "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/story-skills\n" })).toBe(true);
    expect(isAbsentNpmVersion({ stderr: "npm error code E401\nnpm error 401 Unauthorized\n" })).toBe(false);
    expect(isAbsentNpmVersion({ message: "getaddrinfo ENOTFOUND registry.npmjs.org" })).toBe(false);
  });

  test("pushes main and the tag atomically", () => {
    expect(releasePushArgs("v1.2.3")).toEqual(["push", "--atomic", "origin", "main", "v1.2.3"]);
  });

  test("a rejected main push leaves no tag on the remote", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-release-push-"));
    const git = (cwd, ...args) =>
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "init.defaultBranch=main", ...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    const remote = path.join(dir, "remote.git");
    git(dir, "init", "--bare", "--initial-branch=main", remote);
    const seed = path.join(dir, "seed");
    git(dir, "clone", remote, seed);
    git(seed, "checkout", "-B", "main");
    git(seed, "commit", "--allow-empty", "-m", "initial");
    git(seed, "push", "origin", "main");
    const releaser = path.join(dir, "releaser");
    git(dir, "clone", remote, releaser);
    // Someone else advances origin/main while the release checks run.
    git(seed, "commit", "--allow-empty", "-m", "concurrent");
    git(seed, "push", "origin", "main");
    git(releaser, "commit", "--allow-empty", "-m", "chore: release 1.2.3");
    git(releaser, "tag", "-a", "v1.2.3", "-m", "v1.2.3");
    const push = spawnSync("git", releasePushArgs("v1.2.3"), { cwd: releaser, encoding: "utf8" });
    expect(push.status).not.toBe(0);
    expect(git(remote, "tag", "--list")).toBe("");
  });
});

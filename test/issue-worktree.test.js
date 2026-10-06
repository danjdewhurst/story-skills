import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTempDir } from "./helpers.js";

const SCRIPT = path.resolve(import.meta.dir, "..", "scripts", "issue-worktree.sh");
const GIT_CONFIG = ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false"];

function git(cwd, ...args) {
  return execFileSync("git", [...GIT_CONFIG, ...args], { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

// A shared checkout at <temp>/<checkout>, cloned from a bare origin whose
// main branch has one commit.
function sharedCheckout(checkout) {
  const root = makeTempDir("issue-worktree-");
  const seed = path.join(root, "seed");
  fs.mkdirSync(seed);
  git(seed, "init", "--quiet");
  git(seed, "commit", "--allow-empty", "--quiet", "-m", "start");
  git(root, "clone", "--quiet", "--bare", seed, "origin.git");
  const shared = path.join(root, checkout);
  fs.mkdirSync(path.dirname(shared), { recursive: true });
  git(root, "clone", "--quiet", path.join(root, "origin.git"), shared);
  return { root, shared };
}

// Runs the script as an agent whose project checkout is `shared`.
function run(shared, args, env = {}) {
  const { ISSUE_WORKTREE_ROOT, ...inherited } = process.env;
  const result = spawnSync("bash", [SCRIPT, ...args], {
    cwd: shared,
    encoding: "utf8",
    env: { ...inherited, PAPERCLIP_WORKSPACE_CWD: shared, PAPERCLIP_AGENT_ID: "agent-1", ...env }
  });
  return { status: result.status, out: result.stdout.trim(), err: result.stderr };
}

const PAPERCLIP = path.join("instance", "projects", "proj-1", "story-skills");

// The script is tooling for the Linux and macOS hosts automated agents run
// on; Git Bash on Windows would see the temp paths in another form.
describe.skipIf(process.platform === "win32")("scripts/issue-worktree.sh (#572)", () => {
  test("puts the worktree in the instance's workspaces folder, and a rerun returns it", () => {
    const { root, shared } = sharedCheckout(PAPERCLIP);
    const first = run(shared, [".", "FOR-1", "fix/1-thing"]);
    expect(first.status, first.err).toBe(0);
    expect(first.out).toBe(path.join(root, "instance", "workspaces", "agent-1", "worktrees", "story-skills-FOR-1"));
    expect(git(first.out, "symbolic-ref", "--short", "HEAD")).toBe("fix/1-thing");
    expect(run(shared, [".", "FOR-1", "fix/1-thing"])).toMatchObject({ status: 0, out: first.out });
    expect(git(shared, "status", "--porcelain")).toBe("");
  });

  test("a checkout under Projects/ keeps its worktrees outside the checkout", () => {
    const { root, shared } = sharedCheckout(path.join("home", "Projects", "story-skills"));
    const result = run(shared, [".", "FOR-2"]);
    expect(result.status, result.err).toBe(0);
    expect(result.out).toBe(path.join(root, "home", "workspaces", "agent-1", "worktrees", "story-skills-FOR-2"));
    expect(git(result.out, "symbolic-ref", "--short", "HEAD")).toBe("work/for-2");
    expect(git(shared, "status", "--porcelain")).toBe("");
  });

  test.skipIf(/[/\\]projects[/\\]/i.test(os.tmpdir()))("a checkout under no projects folder needs ISSUE_WORKTREE_ROOT", () => {
    const { root, shared } = sharedCheckout(path.join("checkouts", "story-skills"));
    const refused = run(shared, [".", "FOR-3"]);
    expect(refused.status).toBe(1);
    expect(refused.out).toBe("");
    expect(refused.err).toContain("set ISSUE_WORKTREE_ROOT");
    expect(git(shared, "branch", "--list", "work/for-3")).toBe("");

    const worktrees = path.join(root, "worktrees");
    const result = run(shared, [".", "FOR-3"], { ISSUE_WORKTREE_ROOT: worktrees });
    expect(result.status, result.err).toBe(0);
    expect(result.out).toBe(path.join(worktrees, "agent-1", "story-skills-FOR-3"));
    expect(git(result.out, "symbolic-ref", "--short", "HEAD")).toBe("work/for-3");
    expect(git(shared, "status", "--porcelain")).toBe("");
  });

  test("refuses an ISSUE_WORKTREE_ROOT inside the checkout, also through a symlink", () => {
    const { root, shared } = sharedCheckout(PAPERCLIP);
    fs.symlinkSync(shared, path.join(root, "link"));
    for (const inside of [path.join(shared, "workspaces"), path.join(root, "link", "workspaces")]) {
      const result = run(shared, [".", "FOR-4"], { ISSUE_WORKTREE_ROOT: inside });
      expect(result.status, inside).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toContain("is inside the shared checkout");
    }
    expect(fs.existsSync(path.join(shared, "workspaces"))).toBe(false);
    expect(git(shared, "branch", "--list", "work/for-4")).toBe("");
  });

  test("a rerun that asks for another branch fails instead of returning the old worktree", () => {
    const { shared } = sharedCheckout(PAPERCLIP);
    expect(run(shared, [".", "FOR-5", "fix/5-first"]).status).toBe(0);
    // Leaving the branch out asks for the default, work/for-5.
    for (const args of [[".", "FOR-5", "fix/5-second"], [".", "FOR-5"]]) {
      const rerun = run(shared, args);
      expect(rerun.status, args.join(" ")).toBe(1);
      expect(rerun.out).toBe("");
      expect(rerun.err).toContain("already holds branch 'fix/5-first'");
    }
    expect(git(shared, "branch", "--list", "fix/5-second", "work/for-5")).toBe("");
  });

  test("a worktree stopped in a rebase still holds the branch being rebased", () => {
    const { shared } = sharedCheckout(PAPERCLIP);
    const { out: worktree } = run(shared, [".", "FOR-6", "fix/6-rebase"]);
    git(worktree, "commit", "--allow-empty", "--quiet", "-m", "work");
    const rebase = spawnSync("git", [...GIT_CONFIG, "rebase", "--exec", "false", "HEAD~1"], { cwd: worktree, encoding: "utf8" });
    expect(rebase.status).not.toBe(0);
    expect(spawnSync("git", ["symbolic-ref", "--quiet", "HEAD"], { cwd: worktree }).status).not.toBe(0);

    expect(run(shared, [".", "FOR-6", "fix/6-rebase"])).toMatchObject({ status: 0, out: worktree });
    const other = run(shared, [".", "FOR-6", "fix/6-other"]);
    expect(other.status).toBe(1);
    expect(other.err).toContain("already holds branch 'fix/6-rebase'");
  });
});

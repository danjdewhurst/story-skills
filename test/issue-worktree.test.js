import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitEnv, makeTempDir } from "./helpers.js";

const SCRIPT = path.resolve(import.meta.dir, "..", "scripts", "issue-worktree.sh");
const TEMP_PREFIX = "issue-worktree-";

// Every child process runs in a folder this file made. An empty cwd would
// mean the test process's own folder, which is this repository's checkout.
function inTemp(cwd) {
  const top = cwd ? path.relative(os.tmpdir(), path.resolve(cwd)).split(path.sep)[0] : "";
  if (!top.startsWith(TEMP_PREFIX)) {
    throw new Error(`refusing to run outside a test folder: ${JSON.stringify(cwd)}`);
  }
  return cwd;
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd: inTemp(cwd), encoding: "utf8", stdio: "pipe", env: gitEnv() }).trim();
}

// A git command expected to fail, such as a rebase that stops.
function gitStatus(cwd, ...args) {
  return spawnSync("git", args, { cwd: inTemp(cwd), encoding: "utf8", env: gitEnv() }).status;
}

// A shared checkout at <temp>/<checkout>, cloned from a bare origin whose
// main branch has one commit.
function sharedCheckout(checkout, root = makeTempDir(TEMP_PREFIX)) {
  const seed = path.join(root, "seed");
  if (!fs.existsSync(seed)) {
    fs.mkdirSync(seed);
    git(seed, "init", "--quiet");
    git(seed, "commit", "--allow-empty", "--quiet", "-m", "start");
    git(root, "clone", "--quiet", "--bare", seed, "origin.git");
  }
  const shared = path.join(root, checkout);
  fs.mkdirSync(path.dirname(shared), { recursive: true });
  git(root, "clone", "--quiet", path.join(root, "origin.git"), shared);
  return { root, shared };
}

// Runs the script as an agent whose project checkout is `shared`.
function run(shared, args, env = {}, cwd = shared) {
  const { ISSUE_WORKTREE_ROOT, ...inherited } = gitEnv();
  const result = spawnSync("bash", [SCRIPT, ...args], {
    cwd: inTemp(cwd),
    encoding: "utf8",
    env: { ...inherited, PWD: cwd, PAPERCLIP_WORKSPACE_CWD: shared, PAPERCLIP_AGENT_ID: "agent-1", ...env }
  });
  return { status: result.status, out: result.stdout.trim(), err: result.stderr };
}

// Runs the script and returns the worktree it made, failing the test unless
// it made one.
function worktree(shared, args, env) {
  const result = run(shared, args, env);
  expect(result.status, result.err).toBe(0);
  expect(result.out).not.toBe("");
  return inTemp(result.out);
}

const PAPERCLIP = path.join("instance", "projects", "proj-1", "story-skills");

// The script is tooling for the Linux and macOS hosts automated agents run
// on; Git Bash on Windows would see the temp paths in another form.
describe.skipIf(process.platform === "win32")("scripts/issue-worktree.sh (#572)", () => {
  test("puts the worktree in the instance's workspaces folder, and a rerun returns it", () => {
    const { root, shared } = sharedCheckout(PAPERCLIP);
    const first = worktree(shared, [".", "FOR-1", "fix/1-thing"]);
    expect(first).toBe(path.join(root, "instance", "workspaces", "agent-1", "worktrees", "story-skills-FOR-1"));
    expect(git(first, "symbolic-ref", "--short", "HEAD")).toBe("fix/1-thing");
    expect(run(shared, [".", "FOR-1", "fix/1-thing"])).toMatchObject({ status: 0, out: first });
    expect(git(shared, "status", "--porcelain")).toBe("");
  });

  test("a checkout under Projects/ keeps its worktrees outside the checkout, and a rerun with the default branch returns it", () => {
    const { root, shared } = sharedCheckout(path.join("home", "Projects", "story-skills"));
    const first = worktree(shared, [".", "FOR-2"]);
    expect(first).toBe(path.join(root, "home", "workspaces", "agent-1", "worktrees", "story-skills-FOR-2"));
    expect(git(first, "symbolic-ref", "--short", "HEAD")).toBe("work/for-2");
    expect(run(shared, [".", "FOR-2"])).toMatchObject({ status: 0, out: first });
    expect(git(shared, "status", "--porcelain")).toBe("");
  });

  test("the last projects folder counts, in any letter case", () => {
    const { root, shared } = sharedCheckout(path.join("projects", "instance", "PROJECTS", "proj-1", "story-skills"));
    expect(worktree(shared, [".", "FOR-3"])).toBe(path.join(root, "projects", "instance", "workspaces", "agent-1", "worktrees", "story-skills-FOR-3"));
  });

  test("a checkout reached through a symlink keeps that path, and is still guarded", () => {
    const { root } = sharedCheckout(PAPERCLIP);
    fs.symlinkSync(path.join(root, "instance"), path.join(root, "alias"));
    const shared = path.join(root, "alias", "projects", "proj-1", "story-skills");
    expect(worktree(shared, [".", "FOR-4"])).toBe(path.join(root, "alias", "workspaces", "agent-1", "worktrees", "story-skills-FOR-4"));
    const inside = run(shared, [".", "FOR-5"], { ISSUE_WORKTREE_ROOT: path.join(root, PAPERCLIP, "workspaces") });
    expect(inside.status).toBe(1);
    expect(inside.err).toContain("is inside the shared checkout");
  });

  test.skipIf(/[/\\]projects[/\\]/i.test(os.tmpdir()))("a checkout under no projects folder needs ISSUE_WORKTREE_ROOT", () => {
    const { root, shared } = sharedCheckout(path.join("checkouts", "story-skills"));
    const refused = run(shared, [".", "FOR-6"]);
    expect(refused.status).toBe(1);
    expect(refused.out).toBe("");
    expect(refused.err).toContain("set ISSUE_WORKTREE_ROOT");
    expect(git(shared, "branch", "--list", "work/for-6")).toBe("");

    const worktrees = path.join(root, "worktrees");
    const made = worktree(shared, [".", "FOR-6"], { ISSUE_WORKTREE_ROOT: worktrees });
    expect(made).toBe(path.join(worktrees, "agent-1", "story-skills-FOR-6"));
    expect(git(made, "symbolic-ref", "--short", "HEAD")).toBe("work/for-6");
    expect(git(shared, "status", "--porcelain")).toBe("");
  });

  test("a relative ISSUE_WORKTREE_ROOT is taken from the current folder", () => {
    const { root, shared } = sharedCheckout(PAPERCLIP);
    const result = run(shared, [".", "FOR-7"], { ISSUE_WORKTREE_ROOT: "worktrees" }, root);
    expect(result.status, result.err).toBe(0);
    expect(result.out).toBe(path.join(root, "worktrees", "agent-1", "story-skills-FOR-7"));
    expect(git(result.out, "symbolic-ref", "--short", "HEAD")).toBe("work/for-7");
  });

  test("accepts a sibling folder whose name starts with the checkout's", () => {
    const { shared } = sharedCheckout(PAPERCLIP);
    expect(worktree(shared, [".", "FOR-8"], { ISSUE_WORKTREE_ROOT: `${shared}-worktrees` })).toBe(path.join(`${shared}-worktrees`, "agent-1", "story-skills-FOR-8"));
  });

  test("refuses a worktree path inside the checkout however it gets there", () => {
    const { root, shared } = sharedCheckout(PAPERCLIP);
    fs.mkdirSync(path.join(shared, "sub"));
    fs.mkdirSync(path.join(root, "outside"));
    fs.symlinkSync(shared, path.join(root, "outside", "checkout"));
    fs.symlinkSync(path.join(shared, "sub"), path.join(root, "outside", "sub"));
    fs.symlinkSync(path.join(shared, "missing"), path.join(root, "outside", "dangling"));
    const tries = [
      ["inside", { ISSUE_WORKTREE_ROOT: path.join(shared, "workspaces") }, "is inside the shared checkout"],
      ["through a symlink", { ISSUE_WORKTREE_ROOT: path.join(root, "outside", "checkout", "workspaces") }, "is inside the shared checkout"],
      ["through a symlink and ..", { ISSUE_WORKTREE_ROOT: `${path.join(root, "outside", "sub")}/../ws` }, "is inside the shared checkout"],
      ["through .. below a missing folder", { ISSUE_WORKTREE_ROOT: `${path.join(root, "nothere")}/../${PAPERCLIP}/ws` }, "cannot tell where"],
      ["through a dangling symlink", { ISSUE_WORKTREE_ROOT: path.join(root, "outside", "dangling", "ws") }, "cannot tell where"],
      ["through the agent id", { PAPERCLIP_AGENT_ID: `x/../../${path.join("projects", "proj-1", "story-skills")}` }, "cannot be a folder name"],
      ["through the agent id ..", { PAPERCLIP_AGENT_ID: "..", ISSUE_WORKTREE_ROOT: path.join(shared, "a", "b") }, "cannot be a folder name"]
    ];
    for (const [name, env, message] of tries) {
      const result = run(shared, [".", "FOR-9"], env);
      expect(result.status, name).toBe(1);
      expect(result.out, name).toBe("");
      expect(result.err, name).toContain(message);
    }
    const key = run(shared, [".", "FOR/../../9"]);
    expect(key.status).toBe(1);
    expect(key.err).toContain("cannot be a folder name");

    expect(fs.existsSync(path.join(root, "nothere"))).toBe(false);
    expect(fs.readdirSync(shared).sort()).toEqual([".git", "sub"]);
    expect(git(shared, "branch", "--list", "work/*")).toBe("");
  });

  test("a rerun that asks for another branch fails instead of returning the old worktree", () => {
    const { shared } = sharedCheckout(PAPERCLIP);
    worktree(shared, [".", "FOR-10", "fix/10-first"]);
    // Leaving the branch out asks for the default, work/for-10.
    for (const args of [[".", "FOR-10", "fix/10-second"], [".", "FOR-10"]]) {
      const rerun = run(shared, args);
      expect(rerun.status, args.join(" ")).toBe(1);
      expect(rerun.out).toBe("");
      expect(rerun.err).toContain("already holds branch 'fix/10-first'");
    }
    expect(git(shared, "branch", "--list", "fix/10-second", "work/for-10")).toBe("");
  });

  test("a rerun does not hand over another checkout's worktree of the same name", () => {
    const { root, shared } = sharedCheckout(PAPERCLIP);
    const { shared: other } = sharedCheckout(path.join("instance", "projects", "proj-2", "story-skills"), root);
    const made = worktree(shared, [".", "FOR-11"]);
    const rerun = run(other, [".", "FOR-11"]);
    expect(rerun.status).toBe(1);
    expect(rerun.out).toBe("");
    expect(rerun.err).toContain(`${made} is not a worktree of ${other}`);
  });

  test("a worktree stopped in a rebase still holds the branch being rebased", () => {
    const { shared } = sharedCheckout(PAPERCLIP);
    const merge = worktree(shared, [".", "FOR-12", "fix/12-merge"]);
    git(merge, "commit", "--allow-empty", "--quiet", "-m", "work");
    expect(gitStatus(merge, "rebase", "--exec", "false", "HEAD~1")).not.toBe(0);

    // The apply backend stops only on a conflict.
    const apply = worktree(shared, [".", "FOR-13", "fix/13-apply"]);
    fs.writeFileSync(path.join(apply, "notes.txt"), "branch\n");
    git(apply, "add", "notes.txt");
    git(apply, "commit", "--quiet", "-m", "branch notes");
    fs.writeFileSync(path.join(shared, "notes.txt"), "main\n");
    git(shared, "add", "notes.txt");
    git(shared, "commit", "--quiet", "-m", "main notes");
    expect(gitStatus(apply, "rebase", "--apply", "main")).not.toBe(0);

    for (const [stopped, issue, branch, state] of [[merge, "FOR-12", "fix/12-merge", "rebase-merge"], [apply, "FOR-13", "fix/13-apply", "rebase-apply"]]) {
      expect(fs.existsSync(git(stopped, "rev-parse", "--git-path", `${state}/head-name`)), state).toBe(true);
      expect(gitStatus(stopped, "symbolic-ref", "--quiet", "HEAD"), state).not.toBe(0);
      expect(run(shared, [".", issue, branch]), state).toMatchObject({ status: 0, out: stopped });
      const other = run(shared, [".", issue, "fix/other"]);
      expect(other.status, state).toBe(1);
      expect(other.err).toContain(`already holds branch '${branch}'`);
    }
  });

  test("a worktree with a detached HEAD is not handed back", () => {
    const { shared } = sharedCheckout(PAPERCLIP);
    const made = worktree(shared, [".", "FOR-14", "fix/14-detached"]);
    git(made, "checkout", "--quiet", "--detach");
    const rerun = run(shared, [".", "FOR-14", "fix/14-detached"]);
    expect(rerun.status).toBe(1);
    expect(rerun.out).toBe("");
    expect(rerun.err).toContain("has a detached HEAD, not branch 'fix/14-detached'");
  });
});

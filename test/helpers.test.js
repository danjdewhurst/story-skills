import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { git, gitEnv, makeTempDir } from "./helpers.js";

const repoRoot = path.resolve(import.meta.dir, "..");

// Sets process.env keys while fn runs, then puts back what was there.
function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

// Every call that can start a process, from its name to its closing
// parenthesis: the child_process functions, Bun.spawn, and run() wrappers.
const PROCESS_CALL = /(?:\bBun\.)?\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec|run)\(/g;
// A call whose first argument, or the first item of an argument list, is git.
const GIT_FIRST = /^[\w.]+\(\s*\[?\s*(["'`])git(?:\1|\s)/;

function closingQuote(text, start) {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
    } else if (text[index] === text[start]) {
      return index;
    }
  }
  return text.length;
}

function gitCalls(text) {
  const calls = [];
  for (const match of text.matchAll(PROCESS_CALL)) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < text.length; end += 1) {
      if (`"'\``.includes(text[end])) {
        end = closingQuote(text, end);
      } else if (text[end] === "(") {
        depth += 1;
      } else if (text[end] === ")" && --depth === 0) {
        break;
      }
    }
    const call = text.slice(match.index, end + 1);
    if (GIT_FIRST.test(call)) {
      calls.push(call);
    }
  }
  return calls;
}

describe("git for tests (#561)", () => {
  test("git reads none of the developer's git config, ignores, attributes, or GIT_* variables", () => {
    // Where git would find them: ~/.gitconfig and ~/.config/git/.
    const home = makeTempDir("home-");
    const hooks = path.join(home, "hooks");
    const failing = path.join(hooks, "pre-commit");
    fs.mkdirSync(hooks);
    fs.writeFileSync(failing, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const slashes = (file) => file.split(path.sep).join("/");
    const config = `[user]\n\tname = Developer\n[init]\n\tdefaultBranch = trunk\n[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = ${slashes(failing)}\n[core]\n\thooksPath = ${slashes(hooks)}\n`;
    const xdg = path.join(home, ".config");
    fs.mkdirSync(path.join(xdg, "git"), { recursive: true });
    fs.writeFileSync(path.join(home, ".gitconfig"), config);
    fs.writeFileSync(path.join(xdg, "git", "config"), config);
    fs.writeFileSync(path.join(xdg, "git", "ignore"), "*.sh\n");
    fs.writeFileSync(path.join(xdg, "git", "attributes"), "* -diff\n");

    const repo = makeTempDir("repo-");
    withEnv({ HOME: home, XDG_CONFIG_HOME: xdg, GIT_DIR: path.join(home, "elsewhere.git") }, () => {
      git(repo, "init", "-q");
      fs.writeFileSync(path.join(repo, "notes.sh"), "echo hi\n");
      git(repo, "add", "-A");
      // The developer's config is real: git that reads it runs the hook.
      expect(() => execFileSync("git", ["commit", "-qm", "one"], { cwd: repo, stdio: "pipe", env: gitEnv({ GIT_CONFIG_GLOBAL: undefined }) })).toThrow();
      git(repo, "commit", "-qm", "one");
      expect(git(repo, "log", "-1", "--format=%an <%ae> %G?")).toBe("Test <test@example.com> N\n");
      expect(git(repo, "symbolic-ref", "--short", "HEAD")).toBe("main\n");
      expect(git(repo, "ls-files")).toBe("notes.sh\n");
      expect(git(repo, "check-attr", "diff", "--", "notes.sh")).toBe("notes.sh: diff: unspecified\n");
    });
    expect(fs.existsSync(path.join(home, "elsewhere.git"))).toBe(false);
  });

  test("the preload drops GIT_* variables, so the git src/ runs finds the test's repository", () => {
    // As when bun test runs from a git hook in a linked worktree.
    const elsewhere = makeTempDir("elsewhere-");
    const result = spawnSync(process.execPath, ["test", "--timeout", "60000", "./test/compare.test.js", "-t", "compares with a git ref when the project is the repository root"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, GIT_DIR: path.join(elsewhere, ".git"), GIT_WORK_TREE: elsewhere }
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(" 1 pass");
  });

  test("the scan finds git calls in every form, across lines", () => {
    const sample = [
      'Bun.spawn(["git", "status"], {',
      "  env: gitEnv(),",
      "});",
      "execSync(`git log ${ref(1)}`);",
      "deps.run('git', [\"fetch\"]);",
      'spawnSync(process.execPath, ["git"]);',
      'execFileSync("gitk");'
    ].join("\n");
    expect(gitCalls(sample)).toEqual(['Bun.spawn(["git", "status"], {\n  env: gitEnv(),\n})', "execSync(`git log ${ref(1)}`)", "run('git', [\"fetch\"])"]);
  });

  test("every git a test starts gets gitEnv", () => {
    // This file is left out: its samples above are strings, not calls.
    const files = fs.readdirSync(import.meta.dir).filter((name) => name.endsWith(".js") && name !== path.basename(import.meta.path));
    const found = [];
    for (const name of files) {
      for (const call of gitCalls(fs.readFileSync(path.join(import.meta.dir, name), "utf8"))) {
        found.push(name);
        expect(call, name).toContain("gitEnv(");
      }
    }
    // Calls known to start git, so a scan that matches nothing fails.
    expect(found).toEqual(expect.arrayContaining(["helpers.js", "release.test.js"]));
  });
});

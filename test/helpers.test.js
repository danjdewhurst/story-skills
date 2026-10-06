import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { git, makeTempDir } from "./helpers.js";

describe("git for tests (#561)", () => {
  test("git reads none of the developer's git config or GIT_* variables", () => {
    const dir = makeTempDir();
    const hostile = path.join(dir, "hostile.gitconfig");
    fs.writeFileSync(hostile, "[user]\n\tname = Hostile\n[init]\n\tdefaultBranch = trunk\n[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n[core]\n\thooksPath = /nonexistent\n");
    const developer = {
      GIT_CONFIG_GLOBAL: hostile,
      GIT_CONFIG_SYSTEM: hostile,
      GIT_CONFIG_PARAMETERS: "'commit.gpgsign=true'",
      GIT_DIR: path.join(dir, "elsewhere.git")
    };
    const saved = Object.fromEntries(Object.keys(developer).map((key) => [key, process.env[key]]));
    Object.assign(process.env, developer);
    try {
      const repo = path.join(dir, "repo");
      fs.mkdirSync(repo);
      git(repo, "init", "-q");
      git(repo, "commit", "-q", "--allow-empty", "-m", "one");
      expect(fs.existsSync(path.join(repo, ".git"))).toBe(true);
      expect(git(repo, "log", "-1", "--format=%an <%ae> %G?")).toBe("Test <test@example.com> N\n");
      expect(git(repo, "symbolic-ref", "--short", "HEAD")).toBe("main\n");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("every test that starts git itself passes gitEnv", () => {
    for (const name of fs.readdirSync(import.meta.dir).filter((file) => file.endsWith(".test.js"))) {
      const text = fs.readFileSync(path.join(import.meta.dir, name), "utf8");
      for (const [line] of text.matchAll(/\b(?:spawnSync|execFileSync|execSync|spawn|execFile)\(\s*"git".*/g)) {
        expect(line, name).toContain("gitEnv(");
      }
    }
  });
});

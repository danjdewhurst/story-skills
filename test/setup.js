import { afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { gitEnv, removeTempDirs } from "./helpers.js";

// Preloaded by bunfig.toml, so this hook runs after every test in every file.
// Removing each test's temp dirs as soon as it finishes means no single hook
// has to delete the whole run's dirs at once, which timed out on a slow CI
// runner (#464). The per-test timeout lives in the package.json test scripts:
// Bun 1.4.2 ignores [test] timeout in bunfig.toml, and setDefaultTimeout here
// would reach only the first test file.
afterEach(removeTempDirs);

// A run started from a git hook, or from a shell with GIT_DIR, GIT_WORK_TREE,
// or GIT_CONFIG_PARAMETERS set, would hand them to the git that src/ runs
// in-process (compare --ref, similarity --against) and point it at the wrong
// repository (#561). gitEnv() in helpers.js drops them for the tests' own git.
for (const key of Object.keys(process.env)) {
  if (/^GIT_/i.test(key)) {
    delete process.env[key];
  }
}

// gitEnv() needs git 2.32 or later. Older git ignores GIT_CONFIG_GLOBAL and
// GIT_CONFIG_COUNT, so it would read the developer's config after all, and
// commit as them or as no one, on master.
const gitVersion = spawnSync("git", ["--version"], { encoding: "utf8", env: gitEnv() }).stdout ?? "";
removeTempDirs();
const [, major, minor] = /(\d+)\.(\d+)/.exec(gitVersion) ?? [];
if (major !== undefined && Number(major) * 1000 + Number(minor) < 2032) {
  throw new Error(`The tests need git 2.32 or later, which reads GIT_CONFIG_GLOBAL and GIT_CONFIG_COUNT; this is ${gitVersion.trim()}.`);
}

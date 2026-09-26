#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { bunVersionAdvice, pinnedBunVersion, repoRoot, runningBunVersion } from "./bun-version.js";

const OUTFILE = "skills/story-maintenance/scripts/story.js";
const ALLOW_FLAG = "--allow-bun-mismatch";

const allowMismatch = process.argv.slice(2).includes(ALLOW_FLAG);
const pinned = pinnedBunVersion();
const running = runningBunVersion();

if (running === null) {
  console.error("bun is required to build the story-maintenance fallback, but `bun --version` did not run.");
  console.error(`Install bun ${pinned} from https://bun.sh and try again.`);
  process.exit(1);
}

// Building on a different bun rewrites the whole bundle with renamed internal
// identifiers, which buries a real src/ change in unrelated churn and turns CI
// red, because CI builds on the pinned version.
if (running !== pinned && !allowMismatch) {
  console.error(`Refusing to rebuild ${OUTFILE} on bun ${running}.`);
  console.error("");
  console.error(bunVersionAdvice(pinned, running));
  console.error("");
  console.error(`If you are deliberately moving the pin to bun ${running}, set packageManager in`);
  console.error("package.json and bun-version in .github/workflows/ci.yml to it first; this");
  console.error("build then runs normally, and the rebuild belongs in its own chore: commit.");
  console.error(`Use ${ALLOW_FLAG} only to force a throwaway local build.`);
  process.exit(1);
}

if (running !== pinned) {
  console.warn(`Rebuilding on bun ${running}, which is not the pinned ${pinned} (${ALLOW_FLAG}).`);
}

const build = spawnSync("bun", ["build", "./bin/story.js", "--target=node", `--outfile=${OUTFILE}`], {
  cwd: repoRoot,
  stdio: "inherit"
});

process.exit(build.status ?? 1);

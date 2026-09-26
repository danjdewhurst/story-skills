#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bunVersionAdvice, pinnedBunVersion, repoRoot, runningBunVersion } from "./bun-version.js";

const fallbackPath = path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-skills-fallback-"));
const generatedPath = path.join(tempDir, "story.js");

try {
  const build = spawnSync("bun", [
    "build",
    "./bin/story.js",
    "--target=node",
    `--outfile=${generatedPath}`
  ], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (build.status !== 0) {
    process.stderr.write(build.stderr || build.stdout);
    process.exit(build.status ?? 1);
  }

  const committed = fs.readFileSync(fallbackPath);
  const generated = fs.readFileSync(generatedPath);
  const pinned = pinnedBunVersion();
  const running = runningBunVersion();

  if (committed.equals(generated)) {
    console.log("Bundled story-maintenance fallback is up to date.");
  } else if (running === pinned) {
    console.error("Bundled story-maintenance fallback is out of date.");
    console.error("Run: bun run build:fallback");
    process.exit(1);
  } else {
    // On a different bun we cannot tell a genuinely stale bundle from bundler
    // churn, so name the likely cause instead of sending the contributor to
    // build:fallback, which would commit an unrelated whole-file diff.
    console.error("Bundled story-maintenance fallback does not match a fresh build.");
    console.error("");
    console.error(bunVersionAdvice(pinned, running));
    console.error("");
    console.error(`Re-run this check on bun@${pinned} to tell whether the bundle is genuinely stale.`);
    process.exit(1);
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

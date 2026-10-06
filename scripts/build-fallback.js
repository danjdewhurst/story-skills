#!/usr/bin/env node
// Builds the Node-compatible fallback CLI that copied skill installs run.
// Wraps `bun build` so the pinned Bun version is enforced in one place; see
// scripts/bun-pin.js for why the pin matters.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot, requirePinnedBun } from "./bun-pin.js";

export const FALLBACK_PATH = path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js");

export function buildBundle(outFile, run = spawnSync) {
  return run("bun", ["build", "./bin/story.js", "--target=node", `--outfile=${outFile}`], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

// Returns the exit status. `build(outFile)` stands in for buildBundle, so
// tests can run it without Bun.
export function buildFallback({ build = buildBundle, log = console.log, writeError = (text) => process.stderr.write(text) } = {}) {
  const result = build(FALLBACK_PATH);
  if (result.status !== 0) {
    writeError(result.stderr || result.stdout || "");
    return result.status ?? 1;
  }

  log(`Built ${path.relative(repoRoot, FALLBACK_PATH)}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  requirePinnedBun();
  process.exitCode = buildFallback();
}

#!/usr/bin/env node
// The bundled story-maintenance fallback is a committed build artifact that
// `check:fallback` compares byte for byte. Bun's bundler renames generated
// identifiers between releases, so a bundle built with a different Bun differs
// in hundreds of cosmetic lines and looks exactly like a stale bundle. Both
// building and checking the bundle therefore require the Bun version pinned in
// `package.json`, and this module is the single place that pin is read.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parsePinnedBunVersion(packageManager) {
  const match = /^bun@(\d+\.\d+\.\d+)$/.exec(typeof packageManager === "string" ? packageManager.trim() : "");
  return match ? match[1] : null;
}

export function readPinnedBunVersion(readFile = (filePath) => fs.readFileSync(filePath, "utf8")) {
  return parsePinnedBunVersion(JSON.parse(readFile(path.join(repoRoot, "package.json"))).packageManager);
}

export function localBunVersion(run = spawnSync) {
  const result = run("bun", ["--version"], { encoding: "utf8" });
  if (!result || result.status !== 0 || typeof result.stdout !== "string") {
    return null;
  }
  return result.stdout.trim() || null;
}

export function bunPinFailure(pinned, local) {
  if (!pinned) {
    return 'package.json packageManager must pin an exact Bun version, such as "bun@1.4.2".';
  }
  if (!local) {
    return [
      `Bun ${pinned} builds the story-maintenance fallback, but \`bun --version\` did not run here.`,
      `Install it with: curl -fsSL https://bun.sh/install | bash -s "bun-v${pinned}"`
    ].join("\n");
  }
  if (local !== pinned) {
    return [
      `Bun ${pinned} builds the story-maintenance fallback, but this machine runs Bun ${local}.`,
      "Bun renames generated identifiers between releases, so building the bundle with another Bun",
      "rewrites hundreds of cosmetic lines and check:fallback can no longer tell drift from a stale bundle.",
      "Either match the pin:",
      `  curl -fsSL https://bun.sh/install | bash -s "bun-v${pinned}"`,
      `or move the project to Bun ${local}: set packageManager to "bun@${local}" in package.json and`,
      "bun-version in .github/workflows/ci.yml, then run bun run build:fallback and commit the new bundle."
    ].join("\n");
  }
  return null;
}

// Exits non-zero with an actionable message rather than letting a byte
// comparison report unrelated bundler drift as an out-of-date bundle.
export function requirePinnedBun() {
  const failure = bunPinFailure(readPinnedBunVersion(), localBunVersion());
  if (failure) {
    console.error(failure);
    process.exit(1);
  }
}

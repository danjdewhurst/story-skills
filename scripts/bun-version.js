import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The bundled fallback is compared byte for byte, and Bun's bundler renames
// generated identifiers between releases, so the pin in packageManager is the
// only version that reproduces the committed bundle.
export function pinnedBunVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const match = /^bun@(\d+\.\d+\.\d+)$/.exec(packageJson.packageManager ?? "");
  if (!match) {
    throw new Error(`package.json packageManager must look like "bun@X.Y.Z", got ${JSON.stringify(packageJson.packageManager)}`);
  }
  return match[1];
}

// Returns null when bun is not installed or does not report a version, so
// callers can keep their own "bun is missing" message.
export function runningBunVersion() {
  const result = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

export function bunVersionAdvice(pinned, running) {
  return [
    `This repository pins bun@${pinned} in package.json; you are running ${running ?? "an unknown bun"}.`,
    "Bun's bundler renames generated identifiers between releases, so a different bun",
    "rebuilds the fallback with a whole-file diff that has no behavioural change.",
    "",
    `Install the pinned version, for example:  bun upgrade --to ${pinned}`,
    `or pick it per shell with a version manager, for example:  mise use bun@${pinned}`
  ].join("\n");
}

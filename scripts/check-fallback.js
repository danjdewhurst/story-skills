#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot, requirePinnedBun } from "./bun-pin.js";
import { buildBundle, FALLBACK_PATH } from "./build-fallback.js";
import { missingBunMessage } from "./bun-missing.js";

// Returns an exit code rather than calling process.exit, so the temp dir is
// always removed before the process ends. `build(outFile)` stands in for
// buildBundle, so tests can compare without running Bun.
export function checkFallback({
  build = buildBundle,
  committedPath = FALLBACK_PATH,
  log = console.log,
  error = console.error,
  writeError = (text) => process.stderr.write(text)
} = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-skills-fallback-"));
  const generatedPath = path.join(tempDir, "story.js");

  try {
    const result = build(generatedPath);

    // A spawn that never started has null status and no output at all, so it
    // has to be handled before anything reads result.stderr.
    if (result.error) {
      const missing = missingBunMessage(result.error);
      if (!missing) {
        throw result.error;
      }
      error(missing);
      return 1;
    }

    if (result.status !== 0) {
      writeError(result.stderr || result.stdout || "");
      return result.status ?? 1;
    }

    const committed = fs.readFileSync(committedPath);
    const generated = fs.readFileSync(generatedPath);

    if (!committed.equals(generated)) {
      error(`Bundled story-maintenance fallback is out of date: ${path.relative(repoRoot, committedPath).split(path.sep).join("/")} does not match a fresh build of bin/story.js.`);
      error("Run: bun run build:fallback");
      return 1;
    }

    log("Bundled story-maintenance fallback is up to date.");
    return 0;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A different Bun rebuilds the bundle with renamed generated identifiers, so
  // the byte comparison only means anything on the pinned version.
  requirePinnedBun();
  // Setting exitCode rather than calling process.exit lets the event loop drain
  // stderr first; process.exit truncates a piped build failure at the pipe buffer.
  process.exitCode = checkFallback();
}

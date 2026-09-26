#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot, requirePinnedBun } from "./bun-pin.js";
import { buildBundle, FALLBACK_PATH } from "./build-fallback.js";
import { missingBunMessage } from "./bun-missing.js";

// A different Bun rebuilds the bundle with renamed generated identifiers, so
// the byte comparison below only means anything on the pinned version.
requirePinnedBun();

// Returns an exit code rather than calling process.exit, so the temp dir is
// always removed before the process ends.
function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-skills-fallback-"));
  const generatedPath = path.join(tempDir, "story.js");

  try {
    const build = buildBundle(generatedPath);

    // A spawn that never started has null status and no output at all, so it
    // has to be handled before anything reads build.stderr.
    if (build.error) {
      const missing = missingBunMessage(build.error);
      if (!missing) {
        throw build.error;
      }
      console.error(missing);
      return 1;
    }

    if (build.status !== 0) {
      process.stderr.write(build.stderr || build.stdout || "");
      return build.status ?? 1;
    }

    const committed = fs.readFileSync(FALLBACK_PATH);
    const generated = fs.readFileSync(generatedPath);

    if (!committed.equals(generated)) {
      console.error(`Bundled story-maintenance fallback is out of date: ${path.relative(repoRoot, FALLBACK_PATH)} does not match a fresh build of bin/story.js.`);
      console.error("Run: bun run build:fallback");
      return 1;
    }

    console.log("Bundled story-maintenance fallback is up to date.");
    return 0;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// Setting exitCode rather than calling process.exit lets the event loop drain
// stderr first; process.exit truncates a piped build failure at the pipe buffer.
process.exitCode = main();

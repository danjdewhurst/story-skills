#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { missingBunMessage } from "./bun-missing.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fallbackPath = path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js");

// Returns an exit code rather than calling process.exit, so the temp dir is
// always removed before the process ends.
function main() {
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

    const committed = fs.readFileSync(fallbackPath);
    const generated = fs.readFileSync(generatedPath);

    if (!committed.equals(generated)) {
      console.error("Bundled story-maintenance fallback is out of date.");
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

#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot, requirePinnedBun } from "./bun-pin.js";
import { buildBundle, FALLBACK_PATH } from "./build-fallback.js";

// A different Bun rebuilds the bundle with renamed generated identifiers, so
// the byte comparison below only means anything on the pinned version.
requirePinnedBun();

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-skills-fallback-"));
const generatedPath = path.join(tempDir, "story.js");

try {
  const build = buildBundle(generatedPath);

  if (build.status !== 0) {
    process.stderr.write(build.stderr || build.stdout || "");
    process.exit(build.status ?? 1);
  }

  const committed = fs.readFileSync(FALLBACK_PATH);
  const generated = fs.readFileSync(generatedPath);

  if (!committed.equals(generated)) {
    console.error(`Bundled story-maintenance fallback is out of date: ${path.relative(repoRoot, FALLBACK_PATH)} does not match a fresh build of bin/story.js.`);
    console.error("Run: bun run build:fallback");
    process.exit(1);
  }

  console.log("Bundled story-maintenance fallback is up to date.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

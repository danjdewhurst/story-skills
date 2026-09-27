#!/usr/bin/env node
// Smoke-test the package as npm users get it: pack the tarball, install it
// into an empty folder, and run the installed `story` bin. Every other check
// runs from the git checkout, so a source file left out of package.json
// `files` would pass them and still ship a bin that crashes on start.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "story-skills-pack-"));
try {
  const packDir = path.join(work, "pack");
  const installDir = path.join(work, "install");
  fs.mkdirSync(packDir);
  fs.mkdirSync(installDir);

  const packed = JSON.parse(run(npm, ["pack", "--json", "--pack-destination", packDir], repoRoot));
  const tarball = path.join(packDir, packed[0].filename);
  const version = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;

  fs.writeFileSync(path.join(installDir, "package.json"), '{ "name": "story-skills-pack-check", "private": true }\n');
  run(npm, ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball], installDir);

  const installed = path.join(installDir, "node_modules", "story-skills");
  const bin = path.join(installDir, "node_modules", ".bin", process.platform === "win32" ? "story.cmd" : "story");

  const printed = run(bin, ["--version"], installDir).trim();
  if (!printed.includes(version)) {
    throw new Error(`Installed story --version printed "${printed}", expected ${version}`);
  }
  run(bin, ["validate", path.join(installed, "examples", "the-last-ember")], installDir);
  run(process.execPath, [path.join(installed, "skills", "story-maintenance", "scripts", "story.js"), "--version"], installDir);

  console.log(`Packed tarball ${packed[0].filename} installs and runs story ${version}`);
} catch (error) {
  console.error(`Package check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

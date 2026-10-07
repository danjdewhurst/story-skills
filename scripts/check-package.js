#!/usr/bin/env node
// Smoke-test the package as npm users get it: pack the tarball, install it
// into an empty folder, and run the installed `story` bin. Every other check
// runs from the git checkout, so a source file left out of package.json
// `files` would pass them and still ship a bin that crashes on start.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractLinks, isSkipped } from "./check-links.js";
import { packageBin, spawnCommand } from "./spawn-command.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Markdown and HTML link targets that are paths inside the package, without
// their #fragment or ?query, as check:links reads them: inline links (with or
// without a title or <angle> target), reference definitions, and src, href,
// and srcset attributes. Code, comments, and frontmatter are skipped, and so
// are root-relative paths (/docs), which name nothing inside an installed
// package.
export function relativeLinks(markdown) {
  const links = new Set();
  for (const { target } of extractLinks(markdown)) {
    const file = target.replace(/[?#].*$/, "");
    if (file && !isSkipped(file) && !file.startsWith("/")) {
      try {
        links.add(decodeURIComponent(file));
      } catch {
        links.add(file);
      }
    }
  }
  return [...links].sort();
}

// Every file under `dir`, as /-separated paths relative to it, skipping
// node_modules. Symlinks are not followed.
export function packageFiles(dir, prefix = "") {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...packageFiles(path.join(dir, entry.name), `${relative}/`));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

// The relative links in the shipped markdown that name nothing the package
// ships, as "file -> link". `files` is every shipped file as a /-separated
// path from the package root, and `read(file)` returns one's text. The
// package's markdown is read from node_modules too, so a link to anything
// left out of package.json `files` (AGENTS.md, evals/, scripts/) needs an
// absolute GitHub URL. Paths are compared exactly, so a link that differs
// only in case fails here as it would on a case-sensitive disk.
export function unshippedLinks(files, read) {
  const shipped = new Set(files);
  for (const file of files) {
    for (let dir = path.posix.dirname(file); dir !== "."; dir = path.posix.dirname(dir)) {
      shipped.add(dir);
    }
  }
  const broken = [];
  for (const file of files.filter((name) => name.endsWith(".md"))) {
    for (const link of relativeLinks(read(file))) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), link)).replace(/(.)\/$/, "$1");
      const inside = target !== ".." && !target.startsWith("../");
      if (!inside || (target !== "." && !shipped.has(target))) {
        broken.push(`${file} -> ${link}`);
      }
    }
  }
  return broken;
}

function execRun(command, args, cwd, host) {
  return execFileSync(...spawnCommand(command, args, host), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

// Returns the exit status. `run(command, args, cwd)` stands in for execRun,
// so tests can stand in for npm without packing anything. `host` stands in
// for the platform and process in scripts/spawn-command.js: npm and the
// installed bin are .cmd shims on Windows, so there both run as node and a
// script.
export function checkPackage({
  host = {},
  run = (command, args, cwd) => execRun(command, args, cwd, host),
  root = repoRoot,
  log = console.log,
  error: logError = console.error
} = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "story-skills-pack-"));
  try {
    const packDir = path.join(work, "pack");
    const installDir = path.join(work, "install");
    fs.mkdirSync(packDir);
    fs.mkdirSync(installDir);

    const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", packDir], root));
    const tarball = path.join(packDir, packed[0].filename);
    const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

    fs.writeFileSync(path.join(installDir, "package.json"), '{ "name": "story-skills-pack-check", "private": true }\n');
    run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball], installDir);

    const installed = path.join(installDir, "node_modules", "story-skills");
    const story = (args) => packageBin(installDir, "story-skills", "story", args, host);

    const printed = run(...story(["--version"]), installDir).trim();
    if (!printed.includes(version)) {
      throw new Error(`Installed story --version printed "${printed}", expected ${version}`);
    }
    run(...story(["validate", path.join(installed, "examples", "the-last-ember")]), installDir);
    run(process.execPath, [path.join(installed, "skills", "story-maintenance", "scripts", "story.js"), "--version"], installDir);

    const broken = unshippedLinks(packageFiles(installed), (file) => fs.readFileSync(path.join(installed, file), "utf8"));
    if (broken.length > 0) {
      throw new Error(`Shipped markdown links to files the package does not ship: ${broken.join(", ")}`);
    }

    // `exports` keeps package.json and the schemas resolvable and the source private.
    const requireFromInstall = createRequire(path.join(installDir, "package.json"));
    requireFromInstall.resolve("story-skills/package.json");
    requireFromInstall.resolve("story-skills/schemas/story.schema.json");
    requireFromInstall.resolve("story-skills/schemas/result.schema.json");
    let leaked = true;
    try {
      requireFromInstall.resolve("story-skills/src/cli.js");
    } catch (error) {
      // Node reports an unexported subpath as ERR_PACKAGE_PATH_NOT_EXPORTED;
      // Bun reports MODULE_NOT_FOUND. Either way it does not resolve.
      if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" && error.code !== "MODULE_NOT_FOUND") throw error;
      leaked = false;
    }
    if (leaked) {
      throw new Error("story-skills/src/cli.js resolves, but src/ should not be exported");
    }

    log(`Packed tarball ${packed[0].filename} installs and runs story ${version}`);
    return 0;
  } catch (error) {
    logError(`Package check failed: ${error.message}`);
    return 1;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = checkPackage();
}

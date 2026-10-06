#!/usr/bin/env node
// Packs each skill in skills/ as its own zip, the shape claude.ai's
// Customize > Skills upload expects: one folder named after the skill at the
// top of the archive, with SKILL.md and its references inside
// (chapter-writing.zip holds chapter-writing/SKILL.md, not SKILL.md). It also
// writes all-skills.zip, every skill folder side by side, for agents that
// read a skills folder (unzip it into ~/.claude/skills/ or .agents/skills/).
// The publish workflow attaches them all to the GitHub release.
//
// A skill on its own loses links into other skill folders, such as
// ../story-maintenance/references/conventions.md and the bundled CLI at
// ../story-maintenance/scripts/story.js. Every skill already says what to do
// when those are missing (its conventions summary, and the manual checks), so
// the zips keep each folder exactly as it is in the repository rather than
// copying shared files in at paths the skills never name.
//
// The archives are deterministic: files are in sorted path order, every
// entry carries the zip writer's fixed 1980-01-01 timestamp, and dotfiles
// are left out, so the same skills give byte-identical zips.
//
// Usage:
//   node scripts/build-skill-zips.js [--out <dir>]
//
// Zips land in dist/skills/ unless --out says otherwise.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseFrontmatter } from "../src/frontmatter.js";
import { writeZip } from "../src/packaging.js";
import { repoRoot } from "./bun-pin.js";

export const ALL_SKILLS_ZIP = "all-skills.zip";

// The Agent Skills specification's limits, which claude.ai's upload enforces.
export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
// claude.ai's documented limit for a skill upload (all files, uncompressed).
export const MAX_SKILL_BYTES = 30 * 1024 * 1024;

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Every skill folder under skillsDir, sorted.
export function skillNames(skillsDir) {
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort(byName);
}

// The files in one folder as zip entry paths ("a/b.md"), sorted, without
// dotfiles. Symlinks are refused: a zip entry cannot say where one points.
export function listFiles(dir, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => byName(a.name, b.name))) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`${relative} is a symlink; skill zips hold real files only`);
    }
    if (entry.isDirectory()) {
      files.push(...listFiles(path.join(dir, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

// Refuses a skill claude.ai would reject on upload.
export function checkSkill(name, skillDir, files) {
  if (!files.includes("SKILL.md")) {
    throw new Error(`skills/${name} has no SKILL.md`);
  }
  const { data } = parseFrontmatter(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"), `skills/${name}/SKILL.md`);
  if (data.name !== name) {
    throw new Error(`skills/${name}/SKILL.md name is ${JSON.stringify(data.name)}; it must match the folder name`);
  }
  if (name.length > MAX_NAME_LENGTH || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`skill name ${name} must be lowercase letters, numbers, and hyphens, at most ${MAX_NAME_LENGTH} characters`);
  }
  if (typeof data.description !== "string" || data.description.trim() === "") {
    throw new Error(`skills/${name}/SKILL.md has no description`);
  }
  if (data.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`skills/${name}/SKILL.md description is ${data.description.length} characters; the limit is ${MAX_DESCRIPTION_LENGTH}`);
  }
}

// The zip entries for one skill: a directory entry for each folder, then its
// files, all under "<name>/".
export function skillEntries(name, skillDir) {
  const files = listFiles(skillDir);
  checkSkill(name, skillDir, files);
  const entries = [];
  const folders = new Set([""]);
  let bytes = 0;
  for (const file of files) {
    const parts = file.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      const folder = parts.slice(0, depth).join("/");
      if (!folders.has(folder)) {
        folders.add(folder);
        entries.push({ name: `${name}/${folder}/`, content: Buffer.alloc(0), stored: true });
      }
    }
    const content = fs.readFileSync(path.join(skillDir, ...parts));
    bytes += content.length;
    entries.push({ name: `${name}/${file}`, content });
  }
  if (bytes > MAX_SKILL_BYTES) {
    throw new Error(`skills/${name} is ${bytes} bytes; claude.ai accepts at most ${MAX_SKILL_BYTES}`);
  }
  return [{ name: `${name}/`, content: Buffer.alloc(0), stored: true }, ...entries];
}

// Writes <name>.zip for every skill and all-skills.zip, and returns the file
// names written.
export function buildSkillZips(skillsDir, out) {
  fs.mkdirSync(out, { recursive: true });
  const all = [];
  const written = [];
  for (const name of skillNames(skillsDir)) {
    const entries = skillEntries(name, path.join(skillsDir, name));
    writeZip(path.join(out, `${name}.zip`), entries);
    written.push(`${name}.zip`);
    all.push(...entries);
  }
  if (all.length === 0) {
    throw new Error(`no skills found in ${skillsDir}`);
  }
  writeZip(path.join(out, ALL_SKILLS_ZIP), all);
  written.push(ALL_SKILLS_ZIP);
  return written;
}

export function parseArgs(argv) {
  const options = { out: path.join(repoRoot, "dist", "skills") };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      if (argv[index + 1] === undefined) {
        throw new Error("--out needs a folder");
      }
      options.out = path.resolve(argv[++index]);
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    for (const file of buildSkillZips(path.join(repoRoot, "skills"), options.out)) {
      console.log(`Built ${path.join(options.out, file)}`);
    }
  } catch (error) {
    console.error(`build-skill-zips: ${error.message}`);
    process.exit(1);
  }
}

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ALL_SKILLS_ZIP, MAX_DESCRIPTION_LENGTH, buildSkillZips, listFiles, parseArgs, skillEntries, skillNames } from "../scripts/build-skill-zips.js";
import { makeTempDir } from "./helpers.js";

const repoRoot = path.resolve(import.meta.dir, "..");
const skillsDir = path.join(repoRoot, "skills");
const readRepo = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

// Reads a zip through its central directory, as an unzip tool does, and
// inflates each entry, so the test needs no unzip binary.
function readZip(file) {
  const zip = fs.readFileSync(file);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const date = zip.readUInt16LE(at + 14);
    const compressedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localOffset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const body = zip.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, { date, content: method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function writeSkill(root, name, files) {
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, name, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

const skillMd = (name, description = "Use when testing.") => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

describe("skill zips for claude.ai and release downloads (#394)", () => {
  test("each zip holds one skill folder at its top, with every file in it", () => {
    const out = makeTempDir();
    const written = buildSkillZips(skillsDir, out);
    const names = skillNames(skillsDir);
    expect(names).toContain("story-maintenance");
    expect(written).toEqual([...names.map((name) => `${name}.zip`), ALL_SKILLS_ZIP]);
    for (const name of names) {
      const entries = readZip(path.join(out, `${name}.zip`));
      for (const [entry, { date }] of entries) {
        expect(entry.startsWith(`${name}/`)).toBe(true);
        expect(date).toBe(33);
      }
      const files = listFiles(path.join(skillsDir, name));
      expect([...entries.keys()].filter((entry) => !entry.endsWith("/"))).toEqual(files.map((file) => `${name}/${file}`));
      for (const file of files) {
        expect(entries.get(`${name}/${file}`).content.equals(fs.readFileSync(path.join(skillsDir, name, file)))).toBe(true);
      }
    }
    // The bundled CLI and its package.json travel with story-maintenance.
    const maintenance = readZip(path.join(out, "story-maintenance.zip"));
    expect(maintenance.has("story-maintenance/scripts/story.js")).toBe(true);
    expect(maintenance.has("story-maintenance/scripts/package.json")).toBe(true);
    expect(maintenance.has("story-maintenance/references/conventions.md")).toBe(true);
  });

  test("all-skills.zip holds every skill folder side by side, so cross-skill links resolve", () => {
    const out = makeTempDir();
    buildSkillZips(skillsDir, out);
    const entries = readZip(path.join(out, ALL_SKILLS_ZIP));
    for (const name of skillNames(skillsDir)) {
      expect(entries.has(`${name}/SKILL.md`)).toBe(true);
    }
    expect(entries.has("story-maintenance/references/conventions.md")).toBe(true);
  });

  test("the zips are byte-identical from one build to the next", () => {
    const first = makeTempDir();
    const second = makeTempDir();
    buildSkillZips(skillsDir, first);
    buildSkillZips(skillsDir, second);
    for (const file of fs.readdirSync(first)) {
      expect(fs.readFileSync(path.join(first, file)).equals(fs.readFileSync(path.join(second, file)))).toBe(true);
    }
  });

  test("unzip accepts the archives when it is installed", () => {
    const probe = spawnSync("unzip", ["-v"], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) {
      return;
    }
    const out = makeTempDir();
    buildSkillZips(skillsDir, out);
    for (const file of ["chapter-writing.zip", "story-maintenance.zip", ALL_SKILLS_ZIP]) {
      const result = spawnSync("unzip", ["-t", path.join(out, file)], { encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("No errors detected");
    }
    const target = makeTempDir();
    expect(spawnSync("unzip", ["-q", path.join(out, "chapter-writing.zip"), "-d", target]).status).toBe(0);
    expect(fs.readFileSync(path.join(target, "chapter-writing", "SKILL.md"), "utf8")).toBe(readRepo("skills/chapter-writing/SKILL.md"));
  });

  test("dotfiles are left out and nested folders get directory entries", () => {
    const root = makeTempDir();
    writeSkill(root, "demo", { "SKILL.md": skillMd("demo"), ".DS_Store": "x", "references/deep/note.md": "note", "references/.hidden": "x" });
    expect(skillEntries("demo", path.join(root, "demo")).map((entry) => entry.name)).toEqual([
      "demo/",
      "demo/SKILL.md",
      "demo/references/",
      "demo/references/deep/",
      "demo/references/deep/note.md"
    ]);
  });

  test("a skill claude.ai would reject on upload stops the build", () => {
    const root = makeTempDir();
    writeSkill(root, "no-skill-md", { "README.md": "x" });
    expect(() => skillEntries("no-skill-md", path.join(root, "no-skill-md"))).toThrow("skills/no-skill-md has no SKILL.md");
    writeSkill(root, "mismatch", { "SKILL.md": skillMd("other") });
    expect(() => skillEntries("mismatch", path.join(root, "mismatch"))).toThrow("it must match the folder name");
    writeSkill(root, "Bad_Name", { "SKILL.md": skillMd("Bad_Name") });
    expect(() => skillEntries("Bad_Name", path.join(root, "Bad_Name"))).toThrow("lowercase letters, numbers, and hyphens");
    writeSkill(root, "long", { "SKILL.md": skillMd("long", "x".repeat(MAX_DESCRIPTION_LENGTH + 1)) });
    expect(() => skillEntries("long", path.join(root, "long"))).toThrow(`the limit is ${MAX_DESCRIPTION_LENGTH}`);
    writeSkill(root, "linked", { "SKILL.md": skillMd("linked") });
    fs.symlinkSync(path.join(root, "linked", "SKILL.md"), path.join(root, "linked", "copy.md"));
    expect(() => skillEntries("linked", path.join(root, "linked"))).toThrow("copy.md is a symlink");
    expect(() => buildSkillZips(makeTempDir(), makeTempDir())).toThrow("no skills found");
  });

  test("a rebuild removes the zip of a skill that is gone, and leaves release archives alone", () => {
    const root = makeTempDir();
    const out = makeTempDir();
    writeSkill(root, "kept", { "SKILL.md": skillMd("kept") });
    writeSkill(root, "dropped", { "SKILL.md": skillMd("dropped") });
    buildSkillZips(root, out);
    fs.writeFileSync(path.join(out, "story-skills_1.2.3_windows_x64.zip"), "binary");
    fs.writeFileSync(path.join(out, "notes.txt"), "keep");
    fs.rmSync(path.join(root, "dropped"), { recursive: true });
    expect(buildSkillZips(root, out)).toEqual(["kept.zip", ALL_SKILLS_ZIP]);
    expect(fs.readdirSync(out).sort()).toEqual([ALL_SKILLS_ZIP, "kept.zip", "notes.txt", "story-skills_1.2.3_windows_x64.zip"]);
  });

  test("arguments take an output folder", () => {
    expect(parseArgs(["--out", "x"]).out).toBe(path.resolve("x"));
    expect(parseArgs([]).out).toBe(path.join(repoRoot, "dist", "skills"));
    expect(() => parseArgs(["--out"])).toThrow("--out needs a folder");
    expect(() => parseArgs(["--zip"])).toThrow("unknown argument --zip");
  });

  test("the publish workflow attaches, checksums, and attests the skill zips", () => {
    const publish = readRepo(".github/workflows/publish.yml");
    const pack = publish.indexOf("node scripts/build-skill-zips.js --out dist/binaries");
    expect(pack).toBeGreaterThan(publish.indexOf("pattern: binary-*"));
    expect(pack).toBeLessThan(publish.indexOf("sha256sum story-skills_"));
    expect(publish).toContain('sha256sum story-skills_"$version"_* *.zip');
    expect(publish).toContain('[ "$(wc -l < "$sums")" -eq "$((5 + skills + 1))" ]');
    expect(publish).toContain("subject-path: dist/binaries/*\n");
  });

  test("the writers' start page links the zips and is linked from the README and docs index", () => {
    const page = readRepo("docs/writers-start-here.md");
    expect(page).toContain("https://github.com/danjdewhurst/story-skills/releases/latest");
    expect(page).toContain("Customize > Skills");
    expect(readRepo("README.md")).toContain("docs/writers-start-here.md");
    expect(readRepo("docs/README.md")).toContain("(writers-start-here.md)");
  });
});

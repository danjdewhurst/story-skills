import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import {
  createEntity,
  createStoryProject,
  renameEntity,
  scanProject,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, memoryIo } from "./helpers.js";

function project(title) {
  return createStoryProject({ cwd: makeTempDir(), title, force: false }).root;
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function frontmatter(root, ...parts) {
  const file = path.join(root, ...parts);
  return parseFrontmatter(fs.readFileSync(file, "utf8"), file).data;
}

describe("--id for names outside ASCII", () => {
  test("add keeps a Cyrillic name and takes the id from --id", () => {
    const root = project("Explicit Ids");
    const result = createEntity(root, { kind: "character", name: "Пётр", id: "petr" });

    expect(result.id).toBe("petr");
    expect(result.file).toBe(path.join(root, "characters", "petr.md"));
    expect(frontmatter(root, "characters", "petr.md").name).toBe("Пётр");
    expect(fs.readFileSync(result.file, "utf8")).toContain("# Пётр");
    expect(fs.readFileSync(path.join(root, "characters", "_index.md"), "utf8")).toContain("| Пётр | supporting | alive | [petr](petr.md) |");
    expect(validateProject(root).ok).toBe(true);
    expect(validateLinks(root).ok).toBe(true);
  });

  test("add writes backlinks for a CJK location the same way", () => {
    const root = project("Backlinks");
    createEntity(root, { kind: "location", name: "東京", id: "tokyo", type: "city" });
    createEntity(root, { kind: "character", name: "李明", id: "li-ming", location: "tokyo" });

    expect(frontmatter(root, "worldbuilding", "locations", "tokyo.md")["notable-characters"]).toEqual(["li-ming"]);
    expect(frontmatter(root, "characters", "li-ming.md").locations).toEqual(["tokyo"]);
    expect(validateProject(root).ok).toBe(true);
    expect(validateLinks(root).ok).toBe(true);
  });

  test("a name with no kebab-case form names --id as the fix", () => {
    const root = project("No Id");
    for (const name of ["Пётр", "李明", "Ολυμπία"]) {
      expect(() => createEntity(root, { kind: "character", name })).toThrow(
        `Cannot derive a kebab-case id from character name "${name}": pass --id with a kebab-case id, or use a name containing ASCII letters or digits`
      );
    }
    expect(fs.readdirSync(path.join(root, "characters"))).toEqual(["_index.md"]);
  });

  test("--id must itself be kebab-case and must not collide", () => {
    const root = project("Bad Ids");
    expect(() => createEntity(root, { kind: "character", name: "Пётр", id: "Пётр" })).toThrow('character id must be a kebab-case id, got "Пётр"');
    expect(() => createEntity(root, { kind: "character", name: "Пётр", id: "Petr" })).toThrow('character id must be a kebab-case id, got "Petr"');
    expect(() => createEntity(root, { kind: "character", name: "Пётр", id: "aux" })).toThrow("Windows reserves the file name aux.md");
    expect(fs.readdirSync(path.join(root, "characters"))).toEqual(["_index.md"]);

    createEntity(root, { kind: "character", name: "Пётр", id: "petr" });
    expect(() => createEntity(root, { kind: "character", name: "Пётр Второй", id: "petr" })).toThrow(`${path.join("characters", "petr.md")} already exists`);
  });

  test("--id is refused for chapters and scenes, whose ids come from numbers", () => {
    const root = project("Numbered");
    expect(() => createEntity(root, { kind: "chapter", name: "First", id: "chapter-99" })).toThrow(
      "--id does not apply to a chapter: a chapter id comes from its number. Use --number for a chapter, or --chapter and --scene for a scene"
    );
    createEntity(root, { kind: "chapter", name: "First", number: 1 });
    expect(() => createEntity(root, { kind: "scene", name: "Beat", chapter: "chapter-01", id: "opening" })).toThrow("--id does not apply to a scene");
    expect(fs.readdirSync(path.join(root, "scenes"))).toEqual(["_index.md"]);
  });

  test("rename takes the new id from --id and rewrites references", () => {
    const root = project("Rename Ids");
    createEntity(root, { kind: "character", name: "Petr", id: "petr" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: "petr" });

    expect(() => renameEntity(root, { kind: "character", id: "petr", name: "Пётр Иванов" })).toThrow("pass --id with a kebab-case id");

    const result = renameEntity(root, { kind: "character", id: "petr", name: "Пётр Иванов", newId: "petr-ivanov" });

    expect(result.id).toBe("petr-ivanov");
    expect(fs.existsSync(path.join(root, "characters", "petr.md"))).toBe(false);
    expect(frontmatter(root, "characters", "petr-ivanov.md").name).toBe("Пётр Иванов");
    expect(frontmatter(root, "chapters", "chapter-01.md").characters).toEqual(["petr-ivanov"]);
    expect(validateLinks(root).ok).toBe(true);
  });

  test("rename --id refuses an id that is not kebab-case or already taken", () => {
    const root = project("Rename Guards");
    createEntity(root, { kind: "character", name: "Petr", id: "petr" });
    createEntity(root, { kind: "character", name: "Olga", id: "olga" });

    expect(() => renameEntity(root, { kind: "character", id: "petr", name: "Пётр", newId: "Пётр" })).toThrow('character id must be a kebab-case id, got "Пётр"');
    expect(() => renameEntity(root, { kind: "character", id: "petr", name: "Пётр", newId: "olga" })).toThrow("character olga already exists");
    expect(frontmatter(root, "characters", "olga.md").name).toBe("Olga");
    expect(frontmatter(root, "characters", "petr.md").name).toBe("Petr");
  });

  test("the CLI accepts --id on add and rename and refuses it elsewhere", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Cli Ids", "--dir", "book"]).code).toBe(0);
    const root = path.join(cwd, "book");

    const added = invoke(root, ["add", "character", "Пётр", "--id", "petr"]);
    expect(added.code).toBe(0);
    expect(added.out).toBe(`Created character petr: ${path.join(root, "characters", "petr.md")}\n`);

    const failed = invoke(root, ["add", "character", "李明"]);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain("pass --id with a kebab-case id");

    const renamed = invoke(root, ["rename", "character", "petr", "Пётр Ильич", "--id", "petr-ilyich"]);
    expect(renamed.code).toBe(0);
    expect(scanProject(root).characters.map((character) => character.id)).toEqual(["petr-ilyich"]);

    const wrongCommand = invoke(root, ["remove", "character", "petr-ilyich", "--id", "petr"]);
    expect(wrongCommand.code).toBe(1);
    expect(wrongCommand.err).toBe("--id does not apply to story remove\n");
  });
});

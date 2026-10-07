import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { kebabCase } from "../src/markdown.js";
import {
  createEntity,
  createStoryProject,
  namesReport,
  renameEntity,
  scanProject,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

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

function newProject(title = "Bugs") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
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
    for (const name of ["李明", "محمد", "דוד", "สมชาย"]) {
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
    expect(() => createEntity(root, { kind: "character", name: "Пётр Второй", id: "petr" })).toThrow(`${"characters/petr.md"} already exists`);
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

    expect(() => renameEntity(root, { kind: "character", id: "petr", name: "李明" })).toThrow("pass --id with a kebab-case id");

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
    expect(failed.code).toBe(2);
    expect(failed.err).toContain("pass --id with a kebab-case id");

    const renamed = invoke(root, ["rename", "character", "petr", "Пётр Ильич", "--id", "petr-ilyich"]);
    expect(renamed.code).toBe(0);
    expect(scanProject(root).characters.map((character) => character.id)).toEqual(["petr-ilyich"]);

    const wrongCommand = invoke(root, ["remove", "character", "petr-ilyich", "--id", "petr"]);
    expect(wrongCommand.code).toBe(2);
    expect(wrongCommand.err).toBe("--id does not apply to story remove\n");
  });
});

describe("#71 ids and names fold Latin letters without decompositions", () => {
  test("kebabCase transliterates special Latin letters", () => {
    expect(["Æthelred", "Łukasz Nowak", "Søren", "Straße", "Đorđe", "Þórr", "Œuvre", "Zoë"].map(kebabCase))
      .toEqual(["aethelred", "lukasz-nowak", "soren", "strasse", "dorde", "thorr", "oeuvre", "zoe"]);
  });

  test("story add derives the folded id", () => {
    const root = newProject();
    expect(createEntity(root, { kind: "character", name: "Łukasz Nowak" }).id).toBe("lukasz-nowak");
    expect(createEntity(root, { kind: "character", name: "Søren" }).id).toBe("soren");
  });

  test("story names treats Lukasz and Łukasz as the same name", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Łukasz Nowak" });
    createEntity(root, { kind: "character", name: "Søren" });
    const report = namesReport(root, ["Lukasz", "Soren"]);
    expect(messages(report.errors)).toEqual([
      "\"Lukasz\" clashes with character lukasz-nowak (Łukasz)",
      "\"Soren\" clashes with character soren (Søren)"
    ]);
  });
});

describe("sweep fixes", () => {
  test("Windows-reserved ids are refused and flagged", () => {
    const root = sweepProject();
    expect(() => createEntity(root, { kind: "character", name: "Con" })).toThrow("Windows reserves the file name con.md");
    createEntity(root, { kind: "character", name: "Mara" });
    expect(() => renameEntity(root, { kind: "character", id: "mara", name: "Aux" })).toThrow("Windows reserves");
    writeMarkdown(path.join(root, "characters", "nul.md"), "name: Nul\nrole: minor\nstatus: alive");
    expect(messages(validateProject(root).warnings)).toContain("characters/nul.md uses a file name Windows reserves, so the project cannot be checked out on Windows; rename the entity");
  });

  test("a long id is not pushed over the file name limit", () => {
    const root = sweepProject();
    const name = "a".repeat(248);
    expect(createEntity(root, { kind: "character", name }).id).toBe(name);
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { kebabCase } from "../src/markdown.js";
import { buildBook, createEntity, createStoryProject, renameEntity, scanProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

describe("kebabCase transliterates Cyrillic and Greek", () => {
  test("Russian, Ukrainian, Belarusian, Serbian, Macedonian, and Bulgarian letters", () => {
    expect([
      "Пётр", "Война и мир", "Щука Юля", "Хрущёв", "Объём", "Мышь",
      "Їжак Ґонта", "Євген Іваненко", "Ўладзімір",
      "Ђорђе Јовановић", "Љубица Њего", "Џамбо", "Ѓорѓи Ќосе", "Ѕвезда"
    ].map((name) => kebabCase(name))).toEqual([
      "petr", "voyna-i-mir", "shchuka-yulya", "khrushchev", "obem", "mysh",
      "yizhak-gonta", "yevgen-ivanenko", "uladzimir",
      "djordje-jovanovic", "ljubitsa-njego", "dzambo", "gjorgji-kjose", "dzvezda"
    ]);
  });

  test("Greek letters, digraphs, accents, breathings, and diaeresis", () => {
    expect([
      "Ολυμπία", "Αθήνα", "Σωκράτης", "ΟΔΥΣΣΕΑΣ", "Ευριπίδης", "Αύρα", "Γιώργος Παπαδόπουλος",
      "Άγγελος", "Σφίγξ", "Ψυχή", "Ἀλέξανδρος", "Ὅμηρος", "Μαΐου", "Αϋπνία"
    ].map((name) => kebabCase(name))).toEqual([
      "olympia", "athina", "sokratis", "odysseas", "evripidis", "avra", "giorgos-papadopoulos",
      "angelos", "sfinx", "psychi", "alexandros", "omiros", "maiou", "aypnia"
    ]);
  });

  test("composed and decomposed input give the same id", () => {
    for (const name of ["Пётр Йорк", "Їжак", "Ѓорѓи Ќосе", "Ολυμπία", "Μαΐου"]) {
      expect(kebabCase(name.normalize("NFD"))).toBe(kebabCase(name.normalize("NFC")));
    }
  });

  test("mixed scripts keep every transliterated part, and Latin is unchanged", () => {
    expect(kebabCase("Søren Пётр")).toBe("soren-petr");
    expect(kebabCase("Агент 007")).toBe("agent-007");
    expect(kebabCase("Sera's Last Ember")).toBe("seras-last-ember");
    expect(kebabCase("Łukasz Straße")).toBe("lukasz-strasse");
  });

  test("Bulgarian and Macedonian grave-accented letters and the Ukrainian apostrophe", () => {
    expect(kebabCase("ѐтер")).toBe("eter");
    expect(kebabCase("Свѝрка")).toBe("svirka");
    expect(kebabCase("ѝ")).toBe("i");
    expect(kebabCase("Мʼята")).toBe("myata");
    expect(kebabCase("OʼBrien", { transliterate: false })).toBe("o-brien");
  });

  test("a Cyrillic or Greek letter the tables lack is never dropped from a transliteration", () => {
    expect(kebabCase("Қазақ")).toBe("");
    expect(kebabCase("Ѣлка")).toBe("");
    expect(kebabCase("Sera Қазақ")).toBe("sera");
    expect(kebabCase("Sera Қазақ")).toBe(kebabCase("Sera Қазақ", { transliterate: false }));
  });

  test("scripts without a table still leave nothing", () => {
    for (const name of ["李明", "東京", "محمد", "דוד", "สมชาย", "देवी"]) {
      expect(kebabCase(name)).toBe("");
    }
  });

  test("transliterate: false keeps the ASCII-only slug", () => {
    expect(kebabCase("Война и мир", { transliterate: false })).toBe("");
    expect(kebabCase("Søren Пётр", { transliterate: false })).toBe("soren");
    expect(kebabCase("Sera Voss", { transliterate: false })).toBe("sera-voss");
  });

  test("a kebab-case id is its own kebabCase, and nothing non-ASCII is", () => {
    for (const id of ["petr", "sera-voss", "chapter-03", "olympia"]) {
      expect(kebabCase(id)).toBe(id);
    }
    for (const value of ["Пётр", "petr-Пётр", "ολυμπία"]) {
      expect(kebabCase(value)).not.toBe(value);
    }
  });
});

describe("derived ids for Cyrillic and Greek names", () => {
  test("add derives the id and keeps the name as written", () => {
    const { root } = createStoryProject({ cwd: makeTempDir(), title: "Translit" });
    const petr = createEntity(root, { kind: "character", name: "Пётр Иванов" });
    const olympia = createEntity(root, { kind: "location", name: "Ολυμπία", type: "city" });

    expect(petr.file).toBe(path.join(root, "characters", "petr-ivanov.md"));
    expect(olympia.file).toBe(path.join(root, "worldbuilding", "locations", "olympia.md"));
    expect(fs.readFileSync(petr.file, "utf8")).toContain("name: Пётр Иванов");
    expect(validateProject(root).ok).toBe(true);
  });

  test("rename derives the new id from a Cyrillic name", () => {
    const { root } = createStoryProject({ cwd: makeTempDir(), title: "Translit" });
    createEntity(root, { kind: "character", name: "Petr" });
    const result = renameEntity(root, { kind: "character", id: "petr", name: "Пётр Ильич" });
    expect(result.id).toBe("petr-ilich");
    expect(scanProject(root).characters.map((character) => character.id)).toEqual(["petr-ilich"]);
  });

  test("the CLI adds a Greek name without --id and still asks for one for CJK", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Cli Translit", "--dir", "book"]).code).toBe(0);
    const root = path.join(cwd, "book");
    const added = invoke(root, ["add", "character", "Σωκράτης"]);
    expect(added.code).toBe(0);
    expect(added.out).toBe(`Created character sokratis: ${path.join(root, "characters", "sokratis.md")}\n`);
    const failed = invoke(root, ["add", "character", "李明"]);
    expect(failed.code).toBe(2);
    expect(failed.err).toContain("pass --id with a kebab-case id, or use a name containing ASCII letters or digits");
  });
});

describe("ids recomputed on every run do not change", () => {
  test("init without --dir names the folder from a Cyrillic title, which gives the story id", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Война и мир" });
    expect(created.root).toBe(path.join(cwd, "voyna-i-mir"));
    expect(created.storyId).toBe("voyna-i-mir");
    expect(validateProject(created.root).ok).toBe(true);
  });

  test("an existing project with a Cyrillic title keeps its folder-name story id", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Война и мир", dir: "war-and-peace" });
    expect(created.storyId).toBe("war-and-peace");
    expect(scanProject(created.root).storyId).toBe("war-and-peace");
    expect(validateProject(created.root).ok).toBe(true);
    createEntity(created.root, { kind: "chapter", name: "Один", number: 1 });
    expect(path.basename(buildBook(created.root, { format: "epub" }).outFile)).toBe("war-and-peace.epub");
  });

  test("a Cyrillic folder name is not transliterated into the story id", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Война и мир", dir: "Проект-Book" });
    expect(created.storyId).toBe("book");
    expect(scanProject(created.root).storyId).toBe("book");
    expect(validateProject(created.root).ok).toBe(true);
  });

  test("init without --dir names the folder after a mixed-script title's story id", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Война и мир 2" });
    expect(created.root).toBe(path.join(cwd, "2"));
    expect(created.storyId).toBe("2");
    expect(validateProject(created.root).ok).toBe(true);
  });

  test("an unnumbered Cyrillic chapter keeps its file-number review label", () => {
    const { root } = createStoryProject({ cwd: makeTempDir(), title: "Labels" });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Пролог\nnumber: 1\nnumbered: false\nstatus: draft", "## Chapter Text\n\nБуря пришла первой.\n");
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect([...html.matchAll(/<p id="([^"]+)">/g)].map((match) => match[1])).toEqual(["unnumbered-01-p1"]);
  });
});

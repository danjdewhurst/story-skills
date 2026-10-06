import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { kebabCase } from "../src/markdown.js";
import { buildBook, createEntity, createStoryProject, reindexProject, renameEntity, scanProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages, readArchiveText, writeMarkdown } from "./helpers.js";

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

describe("a project whose title and folder name have no ASCII letters or digits", () => {
  // Made with an ASCII --dir, as init requires, then moved to a folder
  // named after the title (a clone, say), with `title` set as given (null
  // for none) and no reindex since.
  function movedProject(title, folder) {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Placeholder", dir: "book" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    setTitle(root, title);
    fs.renameSync(root, path.join(cwd, folder));
    return path.join(cwd, folder);
  }

  function setTitle(root, title) {
    const storyPath = path.join(root, "story.md");
    const text = fs.readFileSync(storyPath, "utf8");
    fs.writeFileSync(storyPath, title === null ? text.replace(/^title: .*\n/m, "") : text.replace(/^title: .*$/m, `title: ${title}`), "utf8");
  }

  const substitute = (id, from) => `story.md title and the project folder name have no ASCII letters or digits, so the story id is ${id}, hashed from ${from}; rename the folder with ASCII letters or digits to choose the id, then run story reindex`;
  const codes = (findings) => findings.map((finding) => finding.code);

  test("init still refuses to make one", () => {
    expect(() => createStoryProject({ cwd: makeTempDir(), title: "東京物語", dir: "東京" })).toThrow("Cannot derive a story id");
  });

  test("the story id is a hash of the title, the same in every run and runtime, and names the builds", () => {
    const root = movedProject("東京物語", "東京");
    expect(scanProject(root).storyId).toBe("story-d209412e");
    const epub = buildBook(root, { format: "epub" });
    expect(path.relative(root, epub.outFile)).toBe(path.join("dist", "story-d209412e.epub"));
    expect(readArchiveText(epub.outFile)).toContain('<dc:identifier id="book-id">story-d209412e</dc:identifier>');
    for (const format of ["epub", "markdown", "fountain"]) {
      expect(messages(buildBook(root, { format }).warnings)).toContain(substitute("story-d209412e", "the title"));
    }
    reindexProject(root);
    expect(fs.readFileSync(path.join(root, "chapters", "_index.md"), "utf8")).toContain("story: story-d209412e\n");
    const validation = validateProject(root);
    expect(messages(validation.errors)).toEqual([]);
    expect(messages(validation.warnings)).toContain(substitute("story-d209412e", "the title"));
    // The Node fallback CLI hashes the same.
    const bundle = path.resolve(import.meta.dir, "..", "skills", "story-maintenance", "scripts", "story.js");
    const node = spawnSync("node", [bundle, "build", root, "--format", "epub", "--out", "dist/node.epub"], { encoding: "utf8" });
    if (node.error?.code !== "ENOENT") {
      expect(node.status).toBe(0);
      expect(node.stderr).toContain(substitute("story-d209412e", "the title"));
    }
  });

  test("each title hashes to its own id, in either Unicode form, and no title hashes the folder name", () => {
    expect(scanProject(movedProject("京都物語", "東京")).storyId).toBe("story-46087463");
    // が as one code point, and as か and a combining mark.
    expect(scanProject(movedProject("がっこう".normalize("NFD"), "学校")).storyId).toBe("story-95ec5cbb");
    expect(scanProject(movedProject("がっこう", "学校")).storyId).toBe("story-95ec5cbb");
    const untitled = movedProject(null, "東京");
    expect(scanProject(untitled).storyId).toBe("story-130016b2");
    expect(messages(validateProject(untitled).warnings)).toContain(substitute("story-130016b2", "the folder name"));
  });

  test("a Cyrillic title is hashed rather than transliterated, so a new transliteration cannot change the id", () => {
    const root = movedProject("Война и мир", "Война");
    expect(scanProject(root).storyId).toBe("story-f83d61d9");
    expect(messages(validateProject(root).warnings)).toContain(substitute("story-f83d61d9", "the title"));
  });

  test("registries are checked against the substitute id, which follows the title", () => {
    const root = movedProject("東京物語", "東京");
    const stale = (id) => ["chapters/_index.md", "scenes/_index.md", "continuity/state.md", "plot/timeline.md"]
      .map((file) => `${file} story must be ${id} (run story reindex after changing the story.md title)`);
    expect(messages(validateProject(root).errors)).toEqual(expect.arrayContaining(stale("story-d209412e")));
    reindexProject(root);
    expect(messages(validateProject(root).errors)).toEqual([]);
    setTitle(root, "京都物語");
    expect(messages(validateProject(root).errors)).toEqual(expect.arrayContaining(stale("story-46087463")));
    reindexProject(root);
    expect(fs.readFileSync(path.join(root, "continuity", "state.md"), "utf8")).toContain("story: story-46087463\n");
    expect(messages(validateProject(root).errors)).toEqual([]);
  });

  test("an ASCII title or folder name gives the id with no warning", () => {
    const root = movedProject("東京物語", "tokyo");
    expect(scanProject(root).storyId).toBe("tokyo");
    expect(codes(validateProject(root).warnings)).not.toContain("substitute-story-id");
    expect(codes(buildBook(root, { format: "epub" }).warnings)).not.toContain("substitute-story-id");
  });
});

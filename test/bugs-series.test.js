import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { buildSeries } from "../src/series.js";
import { createEntity, createStoryProject, renameEntity, scanProject, validateLinks } from "../src/story.js";
import { makeTempDir, memoryIo } from "./helpers.js";

const EXAMPLES = path.join(import.meta.dir, "..", "examples");

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function frontmatter(file) {
  return parseFrontmatter(fs.readFileSync(file, "utf8"), file).data;
}

function edit(file, from, to) {
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(from, to), "utf8");
}

function copyExampleSeries() {
  const cwd = makeTempDir();
  for (const book of ["the-last-ember", "the-fall-of-the-citadel"]) {
    fs.cpSync(path.join(EXAMPLES, book), path.join(cwd, book), { recursive: true });
    fs.rmSync(path.join(cwd, book, "dist"), { recursive: true, force: true });
  }
  return cwd;
}

function chronology(report) {
  return report.books.map((book) => `${book.title}|${book.label}`);
}

describe("#58 series scope does not depend on the start book", () => {
  test("init refuses a link to a book outside the new book's parent folder", () => {
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(cwd, "sub"));
    createStoryProject({ cwd, title: "Alpha", series: "x", dir: "a" });
    expect(() => createStoryProject({ cwd, title: "Beta", dir: "sub/b", follows: ["a"] }))
      .toThrow("is not in the same parent folder as the new book");
    expect(fs.existsSync(path.join(cwd, "sub", "b"))).toBe(false);
    expect(frontmatter(path.join(cwd, "a", "story.md")).precedes).toBeUndefined();
  });

  test("a hand-made cross-folder link fails series from either book, and links reports it", () => {
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(cwd, "sub"));
    createStoryProject({ cwd, title: "Alpha", series: "x", dir: "a" });
    createStoryProject({ cwd, title: "Beta", series: "x", dir: "sub/b" });
    edit(path.join(cwd, "a", "story.md"), "series: x\n", "series: x\nprecedes:\n  - ../sub/b\n");
    edit(path.join(cwd, "sub", "b", "story.md"), "series: x\n", "series: x\nfollows:\n  - ../../a\n");

    const fromA = invoke(cwd, ["series", "a"]);
    const fromB = invoke(cwd, ["series", "sub/b"]);
    expect(fromA.code).toBe(1);
    expect(fromB.code).toBe(1);
    expect(fromA.err).toContain("sub/b is not a sibling folder");
    expect(fromB.err).toContain("../../a points outside the series directory");

    expect(invoke(cwd, ["links", "a"]).err).toContain("story.md precedes ../sub/b is not in the same parent folder as this book");
    expect(invoke(cwd, ["links", "sub/b"]).err).toContain("story.md follows ../../a is not in the same parent folder as this book");
  });
});

describe("#59 init checks the new book against the linked books", () => {
  test("refuses a --series that differs from the linked book's series", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Book One", dir: "b1", series: "saga" });
    const before = fs.readFileSync(path.join(cwd, "b1", "story.md"), "utf8");
    expect(() => createStoryProject({ cwd, title: "Other", dir: "x2", follows: ["b1"], series: "other" }))
      .toThrow("--series other conflicts with --follows b1, which belongs to series saga");
    expect(fs.existsSync(path.join(cwd, "x2"))).toBe(false);
    expect(fs.readFileSync(path.join(cwd, "b1", "story.md"), "utf8")).toBe(before);
  });

  test("refuses linked books from different series", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "One", series: "saga" });
    createStoryProject({ cwd, title: "Two", series: "other" });
    expect(() => createStoryProject({ cwd, title: "Middle", follows: ["one"], precedes: ["two"] }))
      .toThrow("Linked books belong to different series: other, saga");
  });

  test("refuses the same book as both --follows and --precedes", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Book One", dir: "b1", series: "saga" });
    const before = fs.readFileSync(path.join(cwd, "b1", "story.md"), "utf8");
    expect(() => createStoryProject({ cwd, title: "Loop", dir: "x4", follows: ["b1"], precedes: ["b1"] }))
      .toThrow("--follows b1 and --precedes b1 name the same book");
    expect(fs.existsSync(path.join(cwd, "x4"))).toBe(false);
    expect(fs.readFileSync(path.join(cwd, "b1", "story.md"), "utf8")).toBe(before);
  });

  test("de-duplicates a repeated link, including one spelled differently", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Book One", dir: "b1", series: "saga" });
    createStoryProject({ cwd, title: "Dup", dir: "x3", follows: ["b1", "./b1/"] });
    expect(frontmatter(path.join(cwd, "x3", "story.md")).follows).toEqual(["../b1"]);
    expect(invoke(cwd, ["links", "x3"]).code).toBe(0);
    expect(invoke(cwd, ["links", "b1"]).code).toBe(0);
  });

  test("refuses a --book-number already used in the series", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "N1", series: "s", bookNumber: 1 });
    createStoryProject({ cwd, title: "N2", follows: ["n1"] });
    expect(() => createStoryProject({ cwd, title: "N3", follows: ["n2"], bookNumber: 1 }))
      .toThrow("Book number 1 is already used by n1");
    expect(fs.existsSync(path.join(cwd, "n3"))).toBe(false);
  });
});

describe("#93 series order does not depend on the locale", () => {
  test("title ties are broken with a pinned locale", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Hub", series: "s", dir: "hub" });
    createStoryProject({ cwd, title: "Zebra", dir: "zebra", follows: ["hub"], bookNumber: 5 });
    createStoryProject({ cwd, title: "Ärlig", dir: "arlig", follows: ["hub"], bookNumber: 5 - 1 });
    for (const book of ["zebra", "arlig"]) {
      edit(path.join(cwd, book, "story.md"), /book-number: \d+\n/, "");
    }
    const report = buildSeries(path.join(cwd, "hub"), scanProject);
    expect(report.books.map((book) => book.title)).toEqual(["Hub", "Ärlig", "Zebra"]);
  });
});

describe("#113 init never nests a project inside another", () => {
  test("init --follows . from inside a book is refused", () => {
    const cwd = makeTempDir();
    const one = createStoryProject({ cwd, title: "Book One" }).root;
    const before = fs.readFileSync(path.join(one, "story.md"), "utf8");
    expect(() => createStoryProject({ cwd: one, title: "Book Two", follows: ["."] }))
      .toThrow("Cannot create a story project inside another story project");
    expect(fs.existsSync(path.join(one, "book-two"))).toBe(false);
    expect(fs.readFileSync(path.join(one, "story.md"), "utf8")).toBe(before);
  });

  test("rename in one project leaves a project nested inside it alone", () => {
    const cwd = makeTempDir();
    const one = createStoryProject({ cwd, title: "Book One" }).root;
    // A nested project made by hand, as an older init allowed.
    const two = createStoryProject({ cwd: makeTempDir(), title: "Book Two" }).root;
    fs.cpSync(two, path.join(one, "book-two"), { recursive: true });
    createEntity(one, { kind: "character", name: "Ellen Trewin" });
    const nested = path.join(one, "book-two");
    createEntity(nested, { kind: "character", name: "Tom Hocking" });
    const tom = path.join(nested, "characters", "tom-hocking.md");
    edit(tom, "relationships: []", "relationships:\n  - character: ellen-trewin\n    type: friend");
    const before = fs.readFileSync(tom, "utf8");
    renameEntity(one, { kind: "character", id: "ellen-trewin", name: "Ellen Hale" });
    expect(fs.readFileSync(tom, "utf8")).toBe(before);
  });
});

describe("#200 init --follows cannot leave a half-linked book", () => {
  test.skipIf(process.getuid?.() === 0)("an unwritable linked book is refused before anything is created", () => {
    const cwd = makeTempDir();
    const one = createStoryProject({ cwd, title: "Book One", dir: "book1", series: "s", bookNumber: 1 }).root;
    const storyPath = path.join(one, "story.md");
    fs.chmodSync(storyPath, 0o444);
    try {
      expect(() => createStoryProject({ cwd, title: "Book Two", dir: "book2", follows: ["book1"] }))
        .toThrow("is not writable; nothing was created");
    } finally {
      fs.chmodSync(storyPath, 0o644);
    }
    expect(fs.existsSync(path.join(cwd, "book2"))).toBe(false);
  });

  test("a --force rerun adds the backlink the existing story.md mirrors", () => {
    const cwd = makeTempDir();
    const one = createStoryProject({ cwd, title: "Book One", dir: "book1", series: "s", bookNumber: 1 }).root;
    const original = fs.readFileSync(path.join(one, "story.md"), "utf8");
    createStoryProject({ cwd, title: "Book Two", dir: "book2", follows: ["book1"] });
    // Simulate the backlink write failing after book2 was created.
    fs.writeFileSync(path.join(one, "story.md"), original, "utf8");
    expect(invoke(cwd, ["links", "book2"]).code).toBe(1);

    const rerun = createStoryProject({ cwd, title: "Book Two", dir: "book2", follows: ["book1"], force: true });
    expect(rerun.linkedBooks).toEqual([one]);
    expect(frontmatter(path.join(one, "story.md")).precedes).toEqual(["../book2"]);
    expect(invoke(cwd, ["links", "book2"]).code).toBe(0);
  });

  test("a --force rerun still skips a backlink the existing story.md does not mirror", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Book One", dir: "book1", series: "s" });
    createStoryProject({ cwd, title: "Book Two", dir: "book2", series: "s" });
    const rerun = createStoryProject({ cwd, title: "Book Two", dir: "book2", follows: ["book1"], force: true });
    expect(rerun.linkedBooks).toEqual([]);
    expect(frontmatter(path.join(cwd, "book1", "story.md")).precedes).toBeUndefined();
  });
});

describe("#232 an unparseable linked story.md is not read as an empty book", () => {
  test("series reports the parse error without a series-id warning", () => {
    const cwd = copyExampleSeries();
    createStoryProject({ cwd, title: "Embers of the Vale", follows: ["the-last-ember"] });
    edit(path.join(cwd, "embers-of-the-vale", "story.md"), "title:", "bad line no colon\ntitle:");
    const report = buildSeries(path.join(cwd, "the-last-ember"), scanProject);
    expect(report.errors.join("\n")).toContain("../embers-of-the-vale: story.md:");
    expect(report.warnings.join("\n")).not.toContain("set no series id");
    expect(report.books.map((book) => book.label)).toEqual(["../the-fall-of-the-citadel", "."]);
  });

  test("init refuses to compute a book-number past an unreadable book", () => {
    const cwd = copyExampleSeries();
    createStoryProject({ cwd, title: "Book Three", follows: ["the-last-ember"] });
    createStoryProject({ cwd, title: "Book Four", follows: ["book-three"] });
    edit(path.join(cwd, "book-three", "story.md"), "title:", "oops no colon\ntitle:");
    expect(() => createStoryProject({ cwd, title: "Prequel Zero", precedes: ["the-fall-of-the-citadel"] }))
      .toThrow("Cannot compute the next book-number");
    expect(fs.existsSync(path.join(cwd, "prequel-zero"))).toBe(false);
    createStoryProject({ cwd, title: "Prequel Zero", precedes: ["the-fall-of-the-citadel"], bookNumber: 5 });
    expect(frontmatter(path.join(cwd, "prequel-zero", "story.md"))["book-number"]).toBe(5);
  });
});

describe("#233 init names the linked story.md that fails to parse", () => {
  test("the error names the link and the file", () => {
    const cwd = copyExampleSeries();
    edit(path.join(cwd, "the-last-ember", "story.md"), "title:", "oops\ntitle:");
    expect(() => createStoryProject({ cwd, title: "Next", follows: ["the-last-ember"] }))
      .toThrow(`--follows the-last-ember: ${path.join("the-last-ember", "story.md")}: Unsupported frontmatter line: oops`);
  });
});

describe("#234 series name check ignores Unicode normalization", () => {
  test("NFC and NFD spellings of a name match", () => {
    const cwd = copyExampleSeries();
    createStoryProject({ cwd, title: "Embers of the Vale", follows: ["the-last-ember"] });
    const sequel = path.join(cwd, "embers-of-the-vale", "characters");
    fs.mkdirSync(sequel, { recursive: true });
    fs.copyFileSync(path.join(cwd, "the-last-ember", "characters", "kael-voss.md"), path.join(sequel, "kael-voss.md"));
    edit(path.join(cwd, "the-last-ember", "characters", "kael-voss.md"), /^name: .*$/m, `name: "${"Kaël Voss".normalize("NFC")}"`);
    edit(path.join(sequel, "kael-voss.md"), /^name: .*$/m, `name: "${"Kaël Voss".normalize("NFD")}"`);
    const report = buildSeries(path.join(cwd, "embers-of-the-vale"), scanProject);
    expect(report.warnings.filter((warning) => warning.startsWith("characters/kael-voss.md name"))).toEqual([]);
  });
});

describe("#235 a backlink through a symlink counts as the same book", () => {
  test("links passes whichever path names the book", () => {
    const cwd = copyExampleSeries();
    fs.renameSync(path.join(cwd, "the-last-ember"), path.join(cwd, "book-one"));
    fs.symlinkSync("book-one", path.join(cwd, "the-last-ember"));
    expect(validateLinks(path.join(cwd, "book-one")).errors).toEqual([]);
    expect(validateLinks(path.join(cwd, "the-last-ember")).errors).toEqual([]);
  });

  test("init through a symlinked path does not add a duplicate backlink", () => {
    const cwd = copyExampleSeries();
    fs.renameSync(path.join(cwd, "the-fall-of-the-citadel"), path.join(cwd, "prequel"));
    fs.symlinkSync("prequel", path.join(cwd, "the-fall-of-the-citadel"));
    // the-last-ember already follows ../the-fall-of-the-citadel (the symlink).
    const result = createStoryProject({ cwd, title: "Middle", follows: ["prequel"], precedes: ["the-last-ember"] });
    const lastEmber = frontmatter(path.join(cwd, "the-last-ember", "story.md"));
    expect(lastEmber.follows).toEqual(["../the-fall-of-the-citadel", "../middle"]);
    expect(result.linkedBooks.length).toBe(2);
  });
});

describe("#236 a blank series id is treated as missing", () => {
  test("series and links do not report a series with a blank name", () => {
    const cwd = copyExampleSeries();
    edit(path.join(cwd, "the-fall-of-the-citadel", "story.md"), "series: the-ember-cycle", 'series: ""');
    const report = buildSeries(path.join(cwd, "the-last-ember"), scanProject);
    expect(report.errors.join("\n")).not.toContain("different series");
    expect(report.warnings.join("\n")).toContain("The Fall of the Citadel set no series id; add series: the-ember-cycle");
    expect(validateLinks(path.join(cwd, "the-last-ember")).errors.join("\n")).not.toContain("belongs to series");
  });
});

describe("#237 series order is the same from every start book", () => {
  test("same-title unnumbered books are ordered by path", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Root", series: "t" });
    createStoryProject({ cwd, title: "Draft One", follows: ["root"] });
    createStoryProject({ cwd, title: "Draft Two", follows: ["root"] });
    for (const book of ["root", "draft-one", "draft-two"]) {
      const file = path.join(cwd, book, "story.md");
      edit(file, /book-number: \d+\n/, "");
      if (book !== "root") {
        edit(file, /^title: .*$/m, "title: Untitled");
      }
    }
    const fromOne = buildSeries(path.join(cwd, "draft-one"), scanProject);
    const fromTwo = buildSeries(path.join(cwd, "draft-two"), scanProject);
    expect(chronology(fromOne)).toEqual(["Root|../root", "Untitled|.", "Untitled|../draft-two"]);
    expect(chronology(fromTwo)).toEqual(["Root|../root", "Untitled|../draft-one", "Untitled|."]);
  });
});

describe("#239 citing another book in the timeline", () => {
  function sequelTimeline() {
    const cwd = copyExampleSeries();
    const root = path.join(cwd, "the-last-ember");
    const timeline = path.join(root, "plot", "timeline.md");
    edit(timeline, "| 12 years ago | Maren burns out his own ember affinity | Sera's Reclamation | — |",
      "| 12 years ago | Maren burns out his own ember affinity | Sera's Reclamation | — |\n"
      + "| 12 years ago | The coup, told in [the prequel](../../the-fall-of-the-citadel/chapters/chapter-01.md) | — | — |\n"
      + "| 12 years ago | Research: [coup notes](https://example.com/drafts/chapter-09) | — | — |\n"
      + "| 12 years ago | Raw notes at https://example.com/drafts/chapter-01 | — | — |");
    return { cwd, root, timeline };
  }

  test("links accepts an existing file in a linked book and ignores ids inside URLs", () => {
    const { root } = sequelTimeline();
    expect(validateLinks(root).errors).toEqual([]);
  });

  test("links still reports a missing file in a linked book", () => {
    const { root, timeline } = sequelTimeline();
    edit(timeline, "chapters/chapter-01.md)", "chapters/chapter-99.md)");
    expect(validateLinks(root).errors).toEqual(["plot/timeline.md links to missing file ../../the-fall-of-the-citadel/chapters/chapter-99.md"]);
  });

  test("move leaves paths into other books and URLs alone", () => {
    const { cwd, timeline } = sequelTimeline();
    const result = invoke(cwd, ["move", "chapter", "chapter-01", "--number", "7", "--path", "the-last-ember"]);
    expect(result.err).toBe("");
    const text = fs.readFileSync(timeline, "utf8");
    expect(text).toContain("(../../the-fall-of-the-citadel/chapters/chapter-01.md)");
    expect(text).toContain("(https://example.com/drafts/chapter-09)");
    expect(text).toContain("https://example.com/drafts/chapter-01 ");
  });
});

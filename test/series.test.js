import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter, replaceFrontmatter } from "../src/frontmatter.js";
import {
  buildSeries,
  canonicalPath,
  formatSeriesReport,
  seriesLinkPath,
  seriesLinks,
  validateSeriesLinks,
  withSeriesBacklink
} from "../src/series.js";
import {
  checkProjectContinuity,
  createStoryProject,
  formatProjectReport,
  projectReport,
  scanProject,
  seriesReport,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown, messages, CHMOD_IGNORED } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function book(cwd, title, options = {}) {
  return createStoryProject({ title, cwd, ...options }).root;
}

function setStory(root, fields) {
  const storyPath = path.join(root, "story.md");
  const markdown = fs.readFileSync(storyPath, "utf8");
  const { data } = parseFrontmatter(markdown, storyPath);
  const next = { ...data, ...fields };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      delete next[key];
    }
  }
  fs.writeFileSync(storyPath, replaceFrontmatter(markdown, next), "utf8");
}

function character(root, id, fields) {
  writeMarkdown(path.join(root, "characters", `${id}.md`), fields, `# ${id}\n`);
}

const EXAMPLES = path.join(import.meta.dir, "..", "examples");

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

function storyData(root) {
  const storyPath = path.join(root, "story.md");
  return parseFrontmatter(fs.readFileSync(storyPath, "utf8"), storyPath).data;
}

function setFields(file, fields) {
  const markdown = fs.readFileSync(file, "utf8");
  const { data } = parseFrontmatter(markdown, file);
  fs.writeFileSync(file, replaceFrontmatter(markdown, { ...data, ...fields }), "utf8");
}

function setStoryFields(root, fields) {
  setFields(path.join(root, "story.md"), fields);
}

// A copy of the two-book example series in a fresh parent folder.
function emberSeries() {
  const cwd = makeTempDir();
  for (const name of ["the-last-ember", "the-fall-of-the-citadel"]) {
    fs.cpSync(path.join(EXAMPLES, name), path.join(cwd, name), { recursive: true });
  }
  return cwd;
}

describe("series links", () => {
  test("resolves link paths and ignores blank or non-string entries", () => {
    const root = path.resolve("/stories/book-two");
    expect(seriesLinkPath(root, path.resolve("/stories/book-one"))).toBe("../book-one");
    expect(seriesLinks(root, { follows: ["../book-one", "", "  ", 3] }, "follows")).toEqual([path.resolve("/stories/book-one")]);
    expect(seriesLinks(root, { follows: "../book-one" }, "follows")).toEqual([path.resolve("/stories/book-one")]);
    expect(seriesLinks(root, { follows: "  " }, "follows")).toEqual([]);
  });

  test("reports self links, missing projects, unreadable bibles, missing backlinks, and series mismatches", () => {
    const cwd = makeTempDir();
    const one = book(cwd, "Book One");
    const two = book(cwd, "Book Two");
    fs.mkdirSync(path.join(cwd, "not-a-book"));
    fs.mkdirSync(path.join(cwd, "broken"));
    fs.writeFileSync(path.join(cwd, "broken", "story.md"), "no frontmatter", "utf8");

    const errors = [];
    validateSeriesLinks(two, {
      series: "saga",
      follows: ["../book-one", "../not-a-book", "../broken", "."],
      precedes: []
    }, errors);
    setStory(one, { series: "other" });
    const mismatch = [];
    validateSeriesLinks(two, { series: "saga", follows: ["../book-one"] }, mismatch);

    expect(messages(errors)).toEqual([
      "story.md follows ../book-one is missing backlink: add ../book-two to its precedes",
      "story.md follows ../not-a-book is not a story project: missing story.md",
      `story.md follows ../broken: ${path.join(cwd, "broken", "story.md")} is missing YAML frontmatter`,
      "story.md follows  points at this book"
    ]);
    expect(messages(mismatch)).toContain("story.md follows ../book-one belongs to series other, not saga");
  });

  test("adds a backlink once, appending to any existing list", () => {
    const cwd = makeTempDir();
    const one = book(cwd, "Book One");
    const two = book(cwd, "Book Two");
    const three = book(cwd, "Book Three");
    const first = withSeriesBacklink(one, "precedes", two);
    expect(parseFrontmatter(first).data.precedes).toEqual(["../book-two"]);
    fs.writeFileSync(path.join(one, "story.md"), first, "utf8");
    expect(withSeriesBacklink(one, "precedes", two)).toBeNull();
    expect(parseFrontmatter(withSeriesBacklink(one, "precedes", three)).data.precedes).toEqual(["../book-two", "../book-three"]);
  });
});

describe("series init", () => {
  test("links a sequel, inherits series defaults, and writes the backlink", () => {
    const cwd = makeTempDir();
    book(cwd, "Book One", { genre: "fantasy", subGenre: "epic", pov: "first-person", tense: "present" });
    setStory(path.join(cwd, "book-one"), { series: "the-saga", "book-number": 1 });

    const result = invoke(cwd, ["init", "Book Two", "--follows", "book-one"]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain(`Updated series links in ${path.join(cwd, "book-one", "story.md")}`);

    const two = parseFrontmatter(fs.readFileSync(path.join(cwd, "book-two", "story.md"), "utf8")).data;
    expect(two).toMatchObject({
      series: "the-saga",
      "book-number": 2,
      genre: "fantasy",
      "sub-genre": "epic",
      pov: "first-person",
      tense: "present",
      follows: ["../book-one"]
    });
    expect(two.precedes).toBeUndefined();
    expect(parseFrontmatter(fs.readFileSync(path.join(cwd, "book-one", "story.md"), "utf8")).data.precedes).toEqual(["../book-two"]);
    expect(validateLinks(path.join(cwd, "book-two")).ok).toBe(true);
    expect(validateLinks(path.join(cwd, "book-one")).ok).toBe(true);

    const rerun = invoke(cwd, ["init", "Book Two", "--follows", "book-one", "--force"]);
    expect(rerun.code).toBe(0);
    expect(rerun.out).not.toContain("Updated series links");
  });

  test("links a prequel with explicit options and no inherited numbers", () => {
    const cwd = makeTempDir();
    book(cwd, "Book One");
    const root = book(cwd, "Origins", {
      precedes: ["book-one", ""],
      series: "saga",
      bookNumber: "4",
      genre: "horror"
    });
    const data = parseFrontmatter(fs.readFileSync(path.join(root, "story.md"), "utf8")).data;
    expect(data).toMatchObject({ series: "saga", "book-number": 4, genre: "horror", "sub-genre": "general", precedes: ["../book-one"] });
    expect(data.follows).toBeUndefined();

    // Book One is unnumbered, but Origins (book 4) is in the same series, so
    // the new book numbers after it rather than colliding.
    const sideStory = book(cwd, "Side Story", { follows: "book-one" });
    const sideData = parseFrontmatter(fs.readFileSync(path.join(sideStory, "story.md"), "utf8")).data;
    expect(sideData["book-number"]).toBe(5);
    // Origins gave Book One its series id, so the side story inherits it.
    expect(sideData.series).toBe("saga");
    expect(parseFrontmatter(fs.readFileSync(path.join(cwd, "book-one", "story.md"), "utf8")).data.series).toBe("saga");

    book(cwd, "Loose One");
    const unnumbered = book(cwd, "Loose Two", { follows: "loose-one" });
    expect(parseFrontmatter(fs.readFileSync(path.join(unnumbered, "story.md"), "utf8")).data["book-number"]).toBeUndefined();
  });

  test("rejects invalid series options before creating files", () => {
    const cwd = makeTempDir();
    book(cwd, "Book One");
    expect(() => book(cwd, "Loop", { follows: "loop" })).toThrow("--follows loop points at the new story itself");
    expect(() => book(cwd, "Lost", { precedes: "nowhere" })).toThrow("--precedes nowhere is not a story project: missing story.md");
    expect(() => book(cwd, "Bad Series", { series: "Bad Series" })).toThrow("Series id must be kebab-case: Bad Series");
    expect(() => book(cwd, "Bad Number", { bookNumber: "-1" })).toThrow("Book number must be 0 or a positive number");
    expect(fs.existsSync(path.join(cwd, "lost"))).toBe(false);
  });
});

describe("series validation and reporting", () => {
  test("validates series fields in story.md", () => {
    const cwd = makeTempDir();
    const root = book(cwd, "Book One");
    setStory(root, { series: "Not Kebab", "book-number": -1, follows: "../x" });
    expect(messages(validateProject(root).errors)).toEqual(expect.arrayContaining([
      "story.md series must be a kebab-case id",
      "story.md book-number must be a number 0 or more, such as 2, 0 for a prequel, or 1.5 for a novella",
      "story.md frontmatter field follows must be a list"
    ]));
    setStory(root, { series: ["a"], "book-number": "two", follows: undefined, precedes: [""] });
    expect(messages(validateProject(root).errors)).toEqual(expect.arrayContaining([
      "story.md frontmatter field series must be a scalar",
      "story.md book-number must be a number 0 or more, such as 2, 0 for a prequel, or 1.5 for a novella",
      "story.md frontmatter field precedes must contain only non-empty strings"
    ]));
    setStory(root, { series: "saga", "book-number": 2, precedes: undefined });
    expect(validateProject(root).ok).toBe(true);
  });

  test("shows series in the project report", () => {
    const cwd = makeTempDir();
    const root = book(cwd, "Book One");
    expect(formatProjectReport(projectReport(root))).not.toContain("Series:");
    setStory(root, { series: "saga" });
    expect(formatProjectReport(projectReport(root))).toContain("Series: saga\n");
    setStory(root, { "book-number": 3 });
    expect(formatProjectReport(projectReport(root))).toContain("Series: saga (book 3)\n");
  });

  test("orders a standalone book and requires a story project", () => {
    const cwd = makeTempDir();
    const root = book(cwd, "Solo");
    const report = seriesReport(root);
    expect(report).toMatchObject({ series: null, ordered: true, ok: true, shared: [] });
    expect(formatSeriesReport(report)).toBe("# Series: Unnamed series\n\nChronological order:\n1. Solo (unnumbered, planning) - .\n\nShared canon:\n- None\n\n");
    expect(() => seriesReport(path.join(cwd, "missing"))).toThrow("is not a story project");
  });

  test("breaks unconstrained book ties by title", () => {
    const cwd = makeTempDir();
    const zephyr = book(cwd, "Zephyr");
    const anvil = book(cwd, "Anvil");
    const marrow = book(cwd, "Marrow");
    for (const root of [zephyr, anvil, marrow]) {
      setStory(root, { series: "saga", "book-number": undefined });
    }
    // Discovery walks `precedes` in order, so list Marrow first: only the title
    // tie-break can put Anvil ahead of it.
    setStory(zephyr, { precedes: ["../marrow", "../anvil"] });

    const report = seriesReport(zephyr);
    expect(report.ordered).toBe(true);
    // Zephyr precedes both; Anvil and Marrow share book-number and fall back to title.
    expect(report.books.map((entry) => entry.title)).toEqual(["Zephyr", "Anvil", "Marrow"]);
  });

  test("orders a diamond chronology and checks shared canon across books", () => {
    const cwd = makeTempDir();
    const origins = book(cwd, "Origins");
    const east = book(cwd, "East");
    const west = book(cwd, "West");
    const finale = book(cwd, "Finale");
    setStory(origins, { title: undefined, series: "saga", "book-number": 4, status: undefined, precedes: ["../east", "../west", "../origins", "../gone"] });
    setStory(east, { follows: ["../origins"], precedes: ["../finale"] });
    setStory(west, { series: "saga", "book-number": 2, follows: ["../origins"] });
    setStory(finale, { "book-number": 1, follows: ["../east", "../west"] });

    character(origins, "old-king", "name: \"Old King\"\nrole: supporting\nstatus: deceased");
    character(east, "old-king", "name: \"Old King\"\nrole: supporting\nstatus: deceased");
    character(finale, "old-king", "name: \"The Old King\"\nrole: supporting\nstatus: alive");
    character(west, "hero", "name: \"Hero\"\nrole: protagonist\nstatus: alive");
    character(finale, "hero", "name: \"Hero\"\nrole: protagonist\nstatus: alive");
    character(finale, "ghost", "name: \"Ghost\"\nrole: minor\nstatus: deceased");
    character(east, "ghost", "name: \"Ghost\"\nrole: minor\nstatus: deceased");
    character(finale, "nameless", "role: minor");
    character(origins, "nameless", "role: minor\nstatus: deceased");
    writeMarkdown(path.join(finale, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft\npov: old-king\ncharacters: []", "# One\n");
    writeMarkdown(path.join(finale, "scenes", "chapter-01-scene-01.md"), "title: S\nchapter: chapter-01\nscene: 1\nstatus: draft\ncharacters:\n  - ghost\nmentions:\n  - old-king", "# S\n");
    writeMarkdown(path.join(origins, "worldbuilding", "artifacts", "crown.md"), "name: Crown\ntype: relic\nstatus: destroyed", "# Crown\n");
    writeMarkdown(path.join(east, "worldbuilding", "artifacts", "crown.md"), "name: Crown\ntype: relic\nstatus: destroyed", "# Crown\n");
    writeMarkdown(path.join(finale, "worldbuilding", "artifacts", "crown.md"), "name: Crown\ntype: relic", "# Crown\n");
    writeMarkdown(path.join(west, "worldbuilding", "artifacts", "sword.md"), "name: Sword\ntype: weapon\nstatus: active", "# Sword\n");
    writeMarkdown(path.join(finale, "worldbuilding", "artifacts", "sword.md"), "name: Sword\ntype: weapon\nstatus: active", "# Sword\n");

    const report = seriesReport(finale);
    expect(report.series).toBe("saga");
    expect(report.books.map((entry) => entry.label)).toEqual(["../origins", "../west", "../east", "."]);
    expect(messages(report.errors)).toEqual([
      "../gone is not a story project: missing story.md",
      "characters/nameless.md has status unset, but nameless is deceased in earlier book origins; set status: deceased",
      "characters/old-king.md has status alive, but old-king is deceased in earlier book origins; set status: deceased",
      "chapters/chapter-01.md lists old-king, who died in earlier book origins; move appearances to mentions",
      "scenes/chapter-01-scene-01.md lists ghost, who died in earlier book East; move appearances to mentions"
    ]);
    expect(messages(report.warnings)).toEqual([
      "Linked books Finale, East set no series id; add series: saga",
      "characters/old-king.md name \"The Old King\" differs from \"Old King\" in ../east/characters/old-king.md",
      "worldbuilding/artifacts/crown.md has status unset, but crown was destroyed in earlier book origins"
    ]);
    expect(report.shared).toEqual([
      { label: "Characters", ids: ["ghost", "hero", "nameless", "old-king"] },
      { label: "Artifacts", ids: ["crown", "sword"] }
    ]);

    const text = formatSeriesReport(report);
    expect(text).toContain("1. origins (book 4, no status) - ../origins");
    expect(text).toContain("- Characters: ghost, hero, nameless, old-king");

    const cli = invoke(cwd, ["series", finale]);
    expect(cli.code).toBe(1);
    expect(cli.out).toContain("# Series: saga");
    expect(cli.err).toContain("Series check failed: 5 errors, 3 warnings");
  });

  test("flags facts a later book learns that an earlier book already knows", () => {
    const cwd = makeTempDir();
    const origins = book(cwd, "Origins");
    const sequel = book(cwd, "Sequel");
    const finale = book(cwd, "Finale");
    setStory(origins, { precedes: ["../sequel"] });
    setStory(sequel, { follows: ["../origins"], precedes: ["../finale"] });
    setStory(finale, { follows: ["../sequel"] });
    fs.rmSync(path.join(sequel, "continuity", "state.md"));

    const state = (knowledge) => `type: continuity-state\nstory: x\ncurrent-chapter: 0\nknowledge-state:\n${knowledge}`;
    writeMarkdown(path.join(origins, "continuity", "state.md"), state([
      "  - character: ana",
      "    knows: the heir survived",
      "    fact: heir-survived",
      "    learned-in: chapter-03",
      "  - loose-note",
      "  - character: ana",
      "    knows: no id"
    ].join("\n")), "# State\n");
    writeMarkdown(path.join(finale, "continuity", "state.md"), state([
      "  - character: ana",
      "    knows: the heir survived",
      "    fact: heir-survived",
      "    learned-in: chapter-01",
      "  - character: ana",
      "    knows: the heir survived, carried forward",
      "    fact: heir-survived",
      "  - character: ben",
      "    knows: the heir survived",
      "    fact: heir-survived",
      "    learned-in: chapter-02",
      "  - character: ana",
      "    fact: 7",
      "    learned-in: chapter-02",
      "  - fact: orphan-fact"
    ].join("\n")), "# State\n");

    const report = seriesReport(finale);
    expect(messages(report.errors)).toEqual([
      "continuity/state.md knowledge-state[0] has ana learn heir-survived in chapter-01, but they already know it in earlier book Origins (../origins/continuity/state.md knowledge-state[0])"
    ]);
    expect(report.shared).toEqual([{ label: "Facts", ids: ["heir-survived"] }]);
  });

  test("reports cycles and conflicting series ids without ordering", () => {
    const cwd = makeTempDir();
    const one = book(cwd, "One");
    const two = book(cwd, "Two");
    setStory(one, { precedes: ["../two"] });
    setStory(two, { series: "beta", precedes: ["../one"] });
    setStory(one, { series: "alpha" });

    const report = seriesReport(one);
    expect(report.ordered).toBe(false);
    expect(report.series).toBe("alpha");
    expect(messages(report.errors)).toEqual([
      "Linked books belong to different series: alpha, beta",
      "Series chronology has a cycle between One, Two; check follows and precedes"
    ]);
    expect(formatSeriesReport(report)).toContain("Books (unordered):");

    setStory(one, { series: undefined });
    expect(seriesReport(one).series).toBe("beta");

    const consistent = invoke(cwd, ["series", book(cwd, "Three")]);
    expect(consistent.code).toBe(0);
    expect(consistent.err).toContain("Series is consistent: 0 errors, 0 warnings");
    expect(consistent.out).toContain("# Series:");
  });
});

describe("series traversal limits", () => {
  test("refuses to follow links outside the common parent directory", () => {
    const cwd = makeTempDir();
    const root = book(cwd, "Scoped");
    const outside = makeTempDir();
    const outsideBook = createStoryProject({ title: "Outside", cwd: outside }).root;
    const outsideData = parseFrontmatter(fs.readFileSync(path.join(outsideBook, "story.md"), "utf8")).data;
    expect(outsideData.title).toContain("Outside");
    setStory(root, { follows: [path.relative(root, outsideBook)] });
    const report = seriesReport(root);
    expect(report.ok).toBe(false);
    expect(messages(report.errors).join("\n")).toContain("points outside the series directory");
  });

  test("refuses links that escape the scope through a symlink", () => {
    const cwd = makeTempDir();
    const root = book(cwd, "Linked");
    const outside = makeTempDir();
    const outsideBook = createStoryProject({ title: "Far Away", cwd: outside }).root;
    try {
      fs.symlinkSync(outsideBook, path.join(cwd, "sneaky"), "dir");
    } catch {
      console.warn("Skipping series symlink test: symlinks unavailable.");
      return;
    }
    setStory(root, { follows: ["../sneaky"] });
    const report = seriesReport(root);
    expect(report.ok).toBe(false);
    expect(messages(report.errors).join("\n")).toContain("points outside the series directory");
  });

  test("visits a book reached through a symlink alias only once", () => {
    const cwd = makeTempDir();
    const root = book(cwd, "Linked");
    const other = book(cwd, "Other");
    try {
      fs.symlinkSync(other, path.join(cwd, "alias"), "dir");
    } catch {
      console.warn("Skipping series symlink test: symlinks unavailable.");
      return;
    }
    setStory(root, { follows: ["../other", "../alias"] });
    setStory(other, { precedes: ["../linked"] });
    const report = seriesReport(root);
    expect(report.books.map((entry) => entry.title)).toEqual(["Other", "Linked"]);
  });

  test("reports parse errors in linked books instead of silently dropping them", () => {
    const cwd = makeTempDir();
    const one = book(cwd, "Book One", { series: "saga" });
    const two = book(cwd, "Book Two", { follows: ["book-one"] });
    const storyPath = path.join(one, "story.md");
    const markdown = fs.readFileSync(storyPath, "utf8");
    fs.writeFileSync(storyPath, markdown.replace("---\n", "---\nlogline:\n  nested: text\n"), "utf8");
    const report = seriesReport(two);
    expect(report.ok).toBe(false);
    expect(messages(report.errors).join("\n")).toContain("../book-one: story.md: Unsupported frontmatter line: nested: text (line 3). Nested fields are not supported");
    const cli = invoke(cwd, ["series", "--path", "book-two"]);
    expect(cli.code).toBe(1);
  });

  test("reports linked books whose scan throws", () => {
    const cwd = makeTempDir();
    const one = book(cwd, "Book One", { series: "saga" });
    const two = book(cwd, "Book Two", { follows: ["book-one"] });
    const outside = path.join(cwd, "outside-world");
    fs.mkdirSync(path.join(outside, "locations"), { recursive: true });
    fs.rmSync(path.join(one, "worldbuilding"), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(one, "worldbuilding"), "dir");
    const report = seriesReport(two);
    expect(report.ok).toBe(false);
    expect(messages(report.errors).join("\n")).toContain("../book-one: Refusing to use project directory outside root");
  });

  test("orders a book reached through a symlink and through its real path as one book", () => {
    const cwd = makeTempDir();
    const opening = book(cwd, "Opening");
    const middle = book(cwd, "Zeta");
    const last = book(cwd, "Alpha");
    try {
      fs.symlinkSync(middle, path.join(cwd, "zeta-alias"), "dir");
    } catch {
      console.warn("Skipping series alias test: symlinks unavailable.");
      return;
    }
    setStory(opening, { precedes: ["../zeta-alias", "../alpha"] });
    setStory(last, { follows: ["../zeta"] });

    const report = buildSeries(opening, scanProject);
    expect(report.books.map((entry) => entry.title)).toEqual(["Opening", "Zeta", "Alpha"]);
  });

  test("series scope check falls back to lexical paths when realpath fails", () => {
    const cwd = makeTempDir();
    const root = book(cwd, "Scoped");
    const originalRealpath = fs.realpathSync;
    fs.realpathSync = (target) => {
      if (target === cwd) {
        throw new Error("EIO: simulated realpath failure");
      }
      return originalRealpath(target);
    };
    try {
      expect(seriesReport(root).ok).toBe(true);
    } finally {
      fs.realpathSync = originalRealpath;
    }
  });

  test("canonicalPath falls back when realpath fails, including at the filesystem root", () => {
    const cwd = makeTempDir();
    const root = book(cwd, "Scoped");
    const originalRealpath = fs.realpathSync;
    fs.realpathSync = (target) => {
      if (target === path.parse(target).root) {
        return originalRealpath(target);
      }
      throw new Error("EIO");
    };
    try {
      expect(canonicalPath(root)).toBe(path.resolve(root));
    } finally {
      fs.realpathSync = originalRealpath;
    }
    fs.realpathSync = () => {
      throw new Error("EIO");
    };
    try {
      expect(canonicalPath(root)).toBe(path.resolve(root));
    } finally {
      fs.realpathSync = originalRealpath;
    }
  });

  test("reports an empty series when the start path is not a project", () => {
    const cwd = makeTempDir();
    const report = buildSeries(cwd, () => {
      throw new Error("scan should not run");
    });
    expect(report.books).toEqual([]);
    expect(report.ok).toBe(false);
    expect(messages(report.errors).join("\n")).toContain("missing story.md");
  });

  test("reports scan errors from a linked book", () => {
    const cwd = makeTempDir();
    const one = book(cwd, "Book One");
    const two = book(cwd, "Book Two");
    setStory(one, { series: "saga", "book-number": 1, precedes: ["../book-two"] });
    setStory(two, { series: "saga", "book-number": 2, follows: ["../book-one"] });
    fs.writeFileSync(path.join(two, "characters", "ada.md"), "not frontmatter\n", "utf8");
    const report = seriesReport(one);
    expect(report.ok).toBe(false);
    expect(messages(report.errors).join("\n")).toContain("characters/ada.md");
  });

  test("does not false-fail at exactly 100 books with reciprocal links", () => {
    // Bare story.md folders rather than full scaffolds: the limit counts
    // books, and 100 scaffolds took over 5s on a slow CI runner (#464).
    const cwd = makeTempDir();
    const names = Array.from({ length: 100 }, (_, index) => `saga-${index}`);
    for (const [index, name] of names.entries()) {
      const links = index === 0
        ? "follows:\n" + names.slice(1).map((other) => `  - ../${other}\n`).join("")
        : `precedes:\n  - ../${names[0]}\n`;
      fs.mkdirSync(path.join(cwd, name));
      fs.writeFileSync(path.join(cwd, name, "story.md"), `---\nschema-version: 2\ntitle: Saga ${index}\n${links}---\n`, "utf8");
    }
    const report = seriesReport(path.join(cwd, names[0]));
    expect(report.books).toHaveLength(100);
    expect(messages(report.errors)).toEqual([]);
  });

  test("follows a long linear chain to its end", () => {
    const cwd = makeTempDir();
    let previous = null;
    const chain = [];
    for (let index = 0; index < 13; index += 1) {
      const root = book(cwd, "Chain " + index);
      chain.push(root);
      if (previous !== null) {
        setStory(root, { follows: ["../" + path.basename(previous)] });
      }
      previous = root;
    }
    const report = seriesReport(chain[chain.length - 1]);
    expect(messages(report.errors)).toEqual([]);
    expect(report.books).toHaveLength(13);
  });

  test("caps the total number of traversed books", () => {
    const cwd = makeTempDir();
    const start = path.join(cwd, "start");
    fs.mkdirSync(start, { recursive: true });
    fs.writeFileSync(path.join(start, "story.md"), "---\ntitle: Start\n---\nBody\n", "utf8");
    const follows = [];
    for (let index = 0; index < 110; index += 1) {
      const dir = path.join(cwd, "leaf-" + index);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "story.md"), "---\ntitle: Leaf " + index + "\n---\nBody\n", "utf8");
      follows.push("../leaf-" + index);
    }
    const fakeScan = (root) => ({
      root,
      story: { data: root === start ? { title: "Start", follows } : { title: path.basename(root) } },
      characters: [],
      locations: [],
      systems: [],
      factions: [],
      artifacts: [],
      chapters: [],
      scenes: [],
      glossaryTerms: [],
      continuity: null
    });
    const report = buildSeries(start, fakeScan);
    expect(messages(report.errors).join("\n")).toContain("book limit");
  });
});

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

describe("#200 init --follows cannot leave a half-linked book", () => {
  test.skipIf(CHMOD_IGNORED)("an unwritable linked book is refused before anything is created", () => {
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
    expect(messages(report.errors).join("\n")).toContain("../embers-of-the-vale: story.md:");
    expect(messages(report.warnings).join("\n")).not.toContain("set no series id");
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
      .toThrow(`--follows the-last-ember: ${"the-last-ember/story.md"}: Unsupported frontmatter line: oops`);
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
    expect(messages(report.warnings).filter((warning) => warning.startsWith("characters/kael-voss.md name"))).toEqual([]);
  });
});

describe("#235 a backlink through a symlink counts as the same book", () => {
  test("links passes whichever path names the book", () => {
    const cwd = copyExampleSeries();
    fs.renameSync(path.join(cwd, "the-last-ember"), path.join(cwd, "book-one"));
    fs.symlinkSync("book-one", path.join(cwd, "the-last-ember"));
    expect(messages(validateLinks(path.join(cwd, "book-one")).errors)).toEqual([]);
    expect(messages(validateLinks(path.join(cwd, "the-last-ember")).errors)).toEqual([]);
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
    expect(messages(report.errors).join("\n")).not.toContain("different series");
    expect(messages(report.warnings).join("\n")).toContain("The Fall of the Citadel set no series id; add series: the-ember-cycle");
    expect(messages(validateLinks(path.join(cwd, "the-last-ember")).errors).join("\n")).not.toContain("belongs to series");
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
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });

  test("links still reports a missing file in a linked book", () => {
    const { root, timeline } = sequelTimeline();
    edit(timeline, "chapters/chapter-01.md)", "chapters/chapter-99.md)");
    expect(messages(validateLinks(root).errors)).toEqual(["plot/timeline.md links to missing file ../../the-fall-of-the-citadel/chapters/chapter-99.md"]);
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

describe("#248 series metadata", () => {
  test("book-number accepts 0 and decimals, and series reports an invalid value", () => {
    const cwd = emberSeries();
    const interlude = book(cwd, "Interlude", { follows: ["the-last-ember"] });
    setStoryFields(interlude, { "book-number": 1.5 });
    expect(messages(validateProject(interlude).errors).join("\n")).not.toContain("book-number");
    const report = seriesReport(interlude);
    expect(messages(report.errors)).toEqual([]);
    expect(report.books.find((entry) => entry.title === "Interlude").bookNumber).toBe(1.5);

    setStoryFields(interlude, { "book-number": 0 });
    expect(messages(validateProject(interlude).errors).join("\n")).not.toContain("book-number");

    setStoryFields(interlude, { "book-number": "1.5" });
    expect(messages(seriesReport(interlude).errors).join("\n")).toContain('story.md book-number "1.5" is not a number 0 or more');
  });

  test("init accepts a decimal book number and numbers the next book after it", () => {
    const cwd = makeTempDir();
    book(cwd, "One", { series: "saga", bookNumber: "1" });
    const novella = book(cwd, "Novella", { follows: ["one"], bookNumber: "1.5" });
    expect(storyData(novella)["book-number"]).toBe(1.5);
    const two = book(cwd, "Two", { follows: ["novella"] });
    expect(storyData(two)["book-number"]).toBe(2);
    expect(invoke(cwd, ["init", "Bad", "--book-number", "-1"]).err).toContain("Book number must be 0 or a positive number");
  });

  test("series-title names the series on the metadata sheet and the series header", () => {
    const cwd = emberSeries();
    const root = path.join(cwd, "the-last-ember");
    setStoryFields(root, { "series-title": "The Ember Cycle" });
    expect(invoke(cwd, ["build", "the-last-ember", "--format", "metadata"]).code).toBe(0);
    const sheet = fs.readFileSync(path.join(root, "dist", "the-last-ember.metadata.md"), "utf8");
    expect(sheet).toContain("| Series | The Ember Cycle, book 1 |");
    expect(invoke(cwd, ["series", "the-last-ember"]).out).toContain("# Series: The Ember Cycle");

    setStoryFields(path.join(cwd, "the-fall-of-the-citadel"), { "series-title": "Ember Cycle" });
    expect(messages(seriesReport(root).warnings).join("\n")).toContain("Linked books set different series-title values");
  });

  test("init carries author, language, and series-title into the sequel", () => {
    const cwd = makeTempDir();
    const first = book(cwd, "Harbor One", { series: "harbor", bookNumber: "1" });
    setStoryFields(first, { author: "Morgan Hale", language: "fr", "series-title": "Harbor" });
    const second = book(cwd, "Harbor Two", { follows: ["harbor-one"] });
    const data = storyData(second);
    expect(data.author).toBe("Morgan Hale");
    expect(data.language).toBe("fr");
    expect(data["series-title"]).toBe("Harbor");
    expect(validateProject(second).ok).toBe(true);

    setStoryFields(first, { author: undefined, authors: ["A. Writer", "B. Writer"] });
    expect(storyData(book(cwd, "Harbor Three", { follows: ["harbor-one"] })).authors).toEqual(["A. Writer", "B. Writer"]);
  });
});

describe("#247 pronunciation across books and on systems", () => {
  test("series warns when a shared entity's pronunciation differs between books", () => {
    const cwd = emberSeries();
    setFields(path.join(cwd, "the-last-ember", "characters", "lord-maren.md"), { pronunciation: "MARE-en" });
    setFields(path.join(cwd, "the-fall-of-the-citadel", "characters", "lord-maren.md"), { pronunciation: "MAH-ren" });
    const warnings = messages(seriesReport(path.join(cwd, "the-last-ember")).warnings).join("\n");
    expect(warnings).toContain('pronunciation "MARE-en" differs from "MAH-ren"');
  });

  test("system pronunciations reach the narration guide and are type-checked", () => {
    const cwd = emberSeries();
    const root = path.join(cwd, "the-last-ember");
    const system = path.join(root, "worldbuilding", "systems", "ember-magic.md");
    setFields(system, { pronunciation: "EM-ber MAJ-ik" });
    expect(invoke(root, ["build", ".", "--format", "narration"]).code).toBe(0);
    const script = fs.readFileSync(path.join(root, "dist", "the-last-ember.narration.md"), "utf8");
    expect(script).toMatch(/\| Ember Magic \| EM-ber MAJ-ik \| system \|/);

    setFields(system, { pronunciation: 7 });
    expect(messages(validateProject(root).errors).join("\n")).toContain("worldbuilding/systems/ember-magic.md frontmatter field pronunciation must be text");
  });
});

describe("#246 destroyed artifacts and dead characters in later books", () => {
  function ashesRising() {
    const cwd = emberSeries();
    const first = path.join(cwd, "the-last-ember");
    setFields(path.join(first, "worldbuilding", "artifacts", "blackened-crown.md"), { status: "destroyed" });
    setFields(path.join(first, "characters", "lord-maren.md"), { status: "deceased" });
    const root = book(cwd, "Ashes Rising", { follows: ["the-last-ember"] });
    fs.mkdirSync(path.join(root, "worldbuilding", "artifacts"), { recursive: true });
    fs.copyFileSync(path.join(first, "worldbuilding", "artifacts", "blackened-crown.md"), path.join(root, "worldbuilding", "artifacts", "blackened-crown.md"));
    for (const id of ["sera-voss", "lord-maren", "kael-voss"]) {
      fs.copyFileSync(path.join(first, "characters", `${id}.md`), path.join(root, "characters", `${id}.md`));
    }
    expect(invoke(root, ["add", "chapter", "Return"]).code).toBe(0);
    expect(invoke(root, ["add", "scene", "Crowning", "--chapter", "chapter-01", "--pov", "sera-voss"]).code).toBe(0);
    setFields(path.join(root, "scenes", "chapter-01-scene-01.md"), { "state-changes": [{ target: "blackened-crown", change: "Sera puts on the crown" }] });
    setFields(path.join(root, "continuity", "state.md"), {
      "knowledge-state": [{ character: "lord-maren", knows: "Sera has taken the throne", fact: "sera-crowned", "learned-in": "chapter-01" }]
    });
    return root;
  }

  test("series errors on a destroyed artifact used, and a dead character learning, in a later book", () => {
    const root = ashesRising();
    const errors = messages(seriesReport(root).errors).join("\n");
    expect(errors).toContain("scenes/chapter-01-scene-01.md uses blackened-crown, which was destroyed in earlier book The Last Ember");
    expect(errors).toContain("knowledge-state[0] has lord-maren learn something in chapter-01, but lord-maren died in earlier book The Last Ember");
  });

  test("a dead character may narrate a later book as a ghost listed in mentions", () => {
    const root = ashesRising();
    setFields(path.join(root, "scenes", "chapter-01-scene-01.md"), { pov: "lord-maren", mentions: ["lord-maren"], "state-changes": [] });
    setFields(path.join(root, "continuity", "state.md"), { "knowledge-state": [] });
    expect(messages(seriesReport(root).errors).join("\n")).not.toContain("lord-maren");

    setFields(path.join(root, "scenes", "chapter-01-scene-01.md"), { mentions: [] });
    expect(messages(seriesReport(root).errors).join("\n")).toContain("scenes/chapter-01-scene-01.md lists lord-maren, who died in earlier book The Last Ember");
  });

  test("continuity errors when a character learns something after their death chapter", () => {
    const cwd = makeTempDir();
    const root = book(cwd, "Solo");
    // Drafted, since an outline death is planned and not in force yet.
    for (const title of ["One", "Two"]) {
      expect(invoke(root, ["add", "chapter", title, "--status", "draft"]).code).toBe(0);
    }
    expect(invoke(root, ["add", "character", "Ann Lee", "--status", "deceased"]).code).toBe(0);
    setFields(path.join(root, "characters", "ann-lee.md"), { "died-in": "chapter-01" });
    setFields(path.join(root, "continuity", "state.md"), {
      "knowledge-state": [{ character: "ann-lee", knows: "The truth", "learned-in": "chapter-02" }]
    });
    expect(messages(checkProjectContinuity(root).errors).join("\n")).toContain("knowledge-state[0] has ann-lee learn something in chapter-02, after they died in chapter-01");

    setFields(path.join(root, "characters", "ann-lee.md"), { "died-in": "chapter-02" });
    expect(messages(checkProjectContinuity(root).errors).join("\n")).not.toContain("learn something");

    const character = path.join(root, "characters", "ann-lee.md");
    const markdown = fs.readFileSync(character, "utf8");
    const { data } = parseFrontmatter(markdown, character);
    delete data["died-in"];
    fs.writeFileSync(character, replaceFrontmatter(markdown, data), "utf8");
    expect(messages(checkProjectContinuity(root).warnings).join("\n")).toContain("ann-lee died before the story (deceased with no died-in)");
  });
});

describe("#102 rename warns about ids shared with linked books", () => {
  test("renaming an id a linked book also defines prints a warning", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Book One", "--dir", "b1", "--series", "saga"]).code).toBe(0);
    expect(invoke(cwd, ["init", "Book Two", "--dir", "b2", "--follows", "b1"]).code).toBe(0);
    expect(invoke(cwd, ["add", "character", "Ann Lee", "--status", "deceased", "--path", "b1"]).code).toBe(0);
    expect(invoke(cwd, ["add", "character", "Ann Lee", "--path", "b2"]).code).toBe(0);
    const result = invoke(cwd, ["rename", "character", "ann-lee", "Anne Lee", "--path", "b1"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("warning: character ann-lee is also defined in linked book Book Two (../b2)");

    expect(invoke(cwd, ["add", "character", "Solo Only", "--path", "b1"]).code).toBe(0);
    expect(invoke(cwd, ["rename", "character", "solo-only", "Solo Two", "--path", "b1"]).err).not.toContain("linked book");
  });
});

describe("#79 long linear series", () => {
  test("a 13-book sibling chain is checked from either end", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Book 1", "--series", "long", "--book-number", "1", "--dir", "b1"]).code).toBe(0);
    for (let index = 2; index <= 13; index += 1) {
      expect(invoke(cwd, ["init", `Book ${index}`, "--dir", `b${index}`, "--follows", `b${index - 1}`]).code).toBe(0);
    }
    for (const start of ["b1", "b13"]) {
      const report = seriesReport(path.join(cwd, start));
      expect(messages(report.errors)).toEqual([]);
      expect(report.books).toHaveLength(13);
    }
  });
});

describe("#203 backslash separators", () => {
  test("validate warns and links errors on a backslash series link on every platform", () => {
    const cwd = makeTempDir();
    book(cwd, "Ser One", { series: "ser" });
    const two = book(cwd, "Ser Two", { follows: ["ser-one"] });
    setStoryFields(two, { follows: ["..\\ser-one"], cover: "images\\cover.jpg" });
    const warnings = messages(validateProject(two).warnings).join("\n");
    expect(warnings).toContain("story.md follows ..\\ser-one uses a backslash; write ../ser-one");
    expect(warnings).toContain("story.md cover images\\cover.jpg uses a backslash; write images/cover.jpg");
    const errors = messages(validateLinks(two).errors).join("\n");
    expect(errors).toContain("story.md follows ..\\ser-one uses a backslash; write ../ser-one so the link works on every system");
    expect(errors).not.toContain("is not a story project");
  });

  test("links names the backslash in a body link", () => {
    const cwd = makeTempDir();
    const root = book(cwd, "Body Links");
    expect(invoke(root, ["add", "character", "Ilya Venn"]).code).toBe(0);
    const timeline = path.join(root, "plot", "timeline.md");
    fs.appendFileSync(timeline, "\n[Ilya](..\\characters\\ilya-venn.md)\n", "utf8");
    const errors = messages(validateLinks(root).errors).join("\n");
    expect(errors).toContain("links to ..\\characters\\ilya-venn.md with a backslash; write ../characters/ilya-venn.md");
    expect(errors).not.toContain("must be kebab-case");
  });
});

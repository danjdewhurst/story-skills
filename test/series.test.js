import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter, replaceFrontmatter } from "../src/frontmatter.js";
import {
  formatSeriesReport,
  seriesLinkPath,
  seriesLinks,
  validateSeriesLinks,
  withSeriesBacklink
} from "../src/series.js";
import {
  createStoryProject,
  formatProjectReport,
  projectReport,
  seriesReport,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

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

describe("series links", () => {
  test("resolves link paths and ignores blank or non-string entries", () => {
    const root = path.resolve("/stories/book-two");
    expect(seriesLinkPath(root, path.resolve("/stories/book-one"))).toBe("../book-one");
    expect(seriesLinks(root, { follows: ["../book-one", "", "  ", 3] }, "follows")).toEqual([path.resolve("/stories/book-one")]);
    expect(seriesLinks(root, { follows: "../book-one" }, "follows")).toEqual([]);
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

    expect(errors).toEqual([
      "story.md follows ../book-one is missing backlink: add ../book-two to its precedes",
      "story.md follows ../not-a-book is not a story project: missing story.md",
      `story.md follows ../broken: ${path.join(cwd, "broken", "story.md")} is missing YAML frontmatter`,
      "story.md follows  points at this book"
    ]);
    expect(mismatch).toContain("story.md follows ../book-one belongs to series other, not saga");
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
    expect(result.out).toContain(`Linked series backlink in ${path.join(cwd, "book-one", "story.md")}`);

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
    expect(rerun.out).not.toContain("Linked series backlink");
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

    const unnumbered = book(cwd, "Side Story", { follows: "book-one" });
    const sideData = parseFrontmatter(fs.readFileSync(path.join(unnumbered, "story.md"), "utf8")).data;
    expect(sideData["book-number"]).toBeUndefined();
    expect(sideData.series).toBeUndefined();
  });

  test("rejects invalid series options before creating files", () => {
    const cwd = makeTempDir();
    book(cwd, "Book One");
    expect(() => book(cwd, "Loop", { follows: "loop" })).toThrow("--follows loop points at the new story itself");
    expect(() => book(cwd, "Lost", { precedes: "nowhere" })).toThrow("--precedes nowhere is not a story project: missing story.md");
    expect(() => book(cwd, "Bad Series", { series: "Bad Series" })).toThrow("Series id must be kebab-case: Bad Series");
    expect(() => book(cwd, "Bad Number", { bookNumber: "0" })).toThrow("Book number must be a positive integer");
    expect(fs.existsSync(path.join(cwd, "lost"))).toBe(false);
  });
});

describe("series validation and reporting", () => {
  test("validates series fields in story.md", () => {
    const cwd = makeTempDir();
    const root = book(cwd, "Book One");
    setStory(root, { series: "Not Kebab", "book-number": 0, follows: "../x" });
    expect(validateProject(root).errors).toEqual(expect.arrayContaining([
      "story.md series must be a kebab-case id",
      "story.md book-number must be a positive integer",
      "story.md frontmatter field follows must be a list"
    ]));
    setStory(root, { series: ["a"], "book-number": 1.5, follows: undefined, precedes: [""] });
    expect(validateProject(root).errors).toEqual(expect.arrayContaining([
      "story.md frontmatter field series must be a scalar",
      "story.md book-number must be a positive integer",
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
    expect(report.errors).toEqual([
      "../gone is not a story project: missing story.md",
      "characters/nameless.md has status unset, but nameless is deceased in earlier book origins; set status: deceased",
      "characters/old-king.md has status alive, but old-king is deceased in earlier book origins; set status: deceased",
      "chapters/chapter-01.md lists old-king, who died in earlier book origins; move appearances to mentions",
      "scenes/chapter-01-scene-01.md lists ghost, who died in earlier book East; move appearances to mentions"
    ]);
    expect(report.warnings).toEqual([
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
    expect(cli.err).toContain("Series check failed: 5 errors, 2 warnings");
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
    expect(report.errors).toEqual([
      "Linked books belong to different series: alpha, beta",
      "Series chronology has a cycle between One, Two; check follows and precedes"
    ]);
    expect(formatSeriesReport(report)).toContain("Books (unordered):");

    setStory(one, { series: undefined });
    expect(seriesReport(one).series).toBe("beta");

    const consistent = invoke(cwd, ["series", book(cwd, "Three")]);
    expect(consistent.code).toBe(0);
    expect(consistent.out).toContain("Series is consistent: 0 errors, 0 warnings");
  });
});

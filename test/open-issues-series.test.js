import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter, replaceFrontmatter } from "../src/frontmatter.js";
import { checkProjectContinuity, createStoryProject, seriesReport, validateLinks, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages } from "./helpers.js";

const EXAMPLES = path.resolve(import.meta.dir, "..", "examples");

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function book(cwd, title, options = {}) {
  return createStoryProject({ title, cwd, ...options }).root;
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

function setStory(root, fields) {
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

describe("#248 series metadata", () => {
  test("book-number accepts 0 and decimals, and series reports an invalid value", () => {
    const cwd = emberSeries();
    const interlude = book(cwd, "Interlude", { follows: ["the-last-ember"] });
    setStory(interlude, { "book-number": 1.5 });
    expect(messages(validateProject(interlude).errors).join("\n")).not.toContain("book-number");
    const report = seriesReport(interlude);
    expect(messages(report.errors)).toEqual([]);
    expect(report.books.find((entry) => entry.title === "Interlude").bookNumber).toBe(1.5);

    setStory(interlude, { "book-number": 0 });
    expect(messages(validateProject(interlude).errors).join("\n")).not.toContain("book-number");

    setStory(interlude, { "book-number": "1.5" });
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
    setStory(root, { "series-title": "The Ember Cycle" });
    expect(invoke(cwd, ["build", "the-last-ember", "--format", "metadata"]).code).toBe(0);
    const sheet = fs.readFileSync(path.join(root, "dist", "the-last-ember.metadata.md"), "utf8");
    expect(sheet).toContain("| Series | The Ember Cycle, book 1 |");
    expect(invoke(cwd, ["series", "the-last-ember"]).out).toContain("# Series: The Ember Cycle");

    setStory(path.join(cwd, "the-fall-of-the-citadel"), { "series-title": "Ember Cycle" });
    expect(messages(seriesReport(root).warnings).join("\n")).toContain("Linked books set different series-title values");
  });

  test("init carries author, language, and series-title into the sequel", () => {
    const cwd = makeTempDir();
    const first = book(cwd, "Harbor One", { series: "harbor", bookNumber: "1" });
    setStory(first, { author: "Morgan Hale", language: "fr", "series-title": "Harbor" });
    const second = book(cwd, "Harbor Two", { follows: ["harbor-one"] });
    const data = storyData(second);
    expect(data.author).toBe("Morgan Hale");
    expect(data.language).toBe("fr");
    expect(data["series-title"]).toBe("Harbor");
    expect(validateProject(second).ok).toBe(true);

    setStory(first, { author: undefined, authors: ["A. Writer", "B. Writer"] });
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
    for (const title of ["One", "Two"]) {
      expect(invoke(root, ["add", "chapter", title]).code).toBe(0);
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
    setStory(two, { follows: ["..\\ser-one"], cover: "images\\cover.jpg" });
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

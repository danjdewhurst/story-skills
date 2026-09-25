import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { importManuscript } from "../src/import.js";
import {
  buildBook,
  checkProjectContinuity,
  computeWordCounts,
  createEntity,
  createStoryProject,
  diagramProject,
  exportManuscript,
  migrateProject,
  moveEntity,
  pacingReport,
  projectActions,
  projectPasses,
  projectProgress,
  proseReport,
  reindexProject,
  removeEntity,
  renameEntity,
  scanProject,
  synopsisBook,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function newProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

function appendProse(root, file, prose) {
  fs.appendFileSync(path.join(root, file), `\n${prose}\n`);
}

describe("project structure", () => {
  test("a fresh project validates after a git round trip drops its empty folders", () => {
    const root = newProject();
    for (const dir of ["worldbuilding/locations", "worldbuilding/systems", "plot/arcs", "glossary/terms"]) {
      fs.rmSync(path.join(root, dir), { recursive: true });
    }
    expect(validateProject(root).errors).toEqual([]);
    createEntity(root, { kind: "location", name: "Port" });
    expect(fs.existsSync(path.join(root, "worldbuilding", "locations", "port.md"))).toBe(true);
  });

  test("migrate restores every folder init creates", () => {
    const root = newProject();
    for (const dir of ["worldbuilding/locations", "worldbuilding/systems", "plot/arcs"]) {
      fs.rmSync(path.join(root, dir), { recursive: true });
    }
    migrateProject(root);
    for (const dir of ["worldbuilding/locations", "worldbuilding/systems", "plot/arcs"]) {
      expect(fs.existsSync(path.join(root, dir))).toBe(true);
    }
  });

  test("validate outside a project says so instead of listing every path", () => {
    const result = invoke(makeTempDir(), ["validate"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("is not a story project: missing story.md");
    expect(result.err).not.toContain("Missing required path");
  });

  test("validate and doctor report the same errors on a partial project", () => {
    const root = newProject();
    fs.rmSync(path.join(root, "scenes"), { recursive: true });
    expect(projectActions(root).validation.errors).toEqual(validateProject(root).errors);
  });
});

describe("argument checking", () => {
  test("extra positional arguments are an error", () => {
    const root = newProject();
    const cwd = path.dirname(root);
    const result = invoke(cwd, ["continuity", root, root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Unexpected argument for story continuity [path]");
    expect(invoke(cwd, ["remove", "character", "x", "extra", "--path", root]).err).toContain("Unexpected argument");
    expect(invoke(cwd, ["diagram", "locations", "extra", "--path", root]).err).toContain("Unexpected argument");
  });

  test("flags a command does not read are an error", () => {
    const root = newProject();
    const result = invoke(path.dirname(root), ["timeline", root, "--at", "chapter-01"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("--at does not apply to story timeline");
  });

  test("build rejects --trim and --shunn for other formats", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    expect(() => buildBook(root, { format: "epub", trim: "6x9" })).toThrow("--trim applies only to --format print");
    expect(() => buildBook(root, { format: "html", shunn: true })).toThrow("--shunn applies only to --format docx");
  });

  test("add names a missing or unknown kind", () => {
    const root = newProject();
    expect(invoke(path.dirname(root), ["add", "--path", root]).err).toContain("An entity kind is required: expected one of character");
    expect(invoke(path.dirname(root), ["add", "character=Foo", "--path", root]).err).toContain("Unsupported entity kind: character=Foo");
  });
});

describe("files that fail to parse", () => {
  test("wordcount, reindex, export, and build refuse instead of dropping the file", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    const registry = fs.readFileSync(path.join(root, "chapters", "_index.md"), "utf8");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("---\n", "---\n  bad-indent: x\n"));
    expect(() => computeWordCounts(root)).toThrow("Cannot count words: fix this file first");
    expect(() => reindexProject(root)).toThrow("Cannot reindex");
    expect(() => exportManuscript(root)).toThrow("Cannot export");
    expect(() => buildBook(root, { format: "epub" })).toThrow("Cannot build");
    expect(fs.readFileSync(path.join(root, "chapters", "_index.md"), "utf8")).toBe(registry);
    expect(invoke(path.dirname(root), ["wordcount", root]).code).toBe(1);
  });

  test("add and synopsis refuse before writing anything", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, "characters", "broken.md"), "# No frontmatter\n");
    expect(() => createEntity(root, { kind: "character", name: "Mara" })).toThrow("Cannot add: fix this file first (story validate reports it):\n- characters/broken.md: is missing YAML frontmatter");
    expect(fs.existsSync(path.join(root, "characters", "mara.md"))).toBe(false);
    expect(() => synopsisBook(root)).toThrow("Cannot build a synopsis");
    expect(() => exportManuscript(root)).toThrow("Cannot export");
  });

  test("a broken style sheet does not block reindex", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, "style-sheet.md"), "---\n: bad\n---\n");
    expect(() => reindexProject(root)).not.toThrow();
  });

  test("rename aborts when an entity file or registry has no frontmatter", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "location", name: "Port", "notable-characters": "mara-quill" });
    const location = path.join(root, "worldbuilding", "locations", "port.md");
    const locationText = fs.readFileSync(location, "utf8");
    fs.writeFileSync(location, locationText.replace(/^---\n/, ""));
    expect(() => renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Q" })).toThrow("Cannot rename: fix this file first");
    fs.writeFileSync(location, locationText);
    const registry = path.join(root, "worldbuilding", "_index.md");
    fs.writeFileSync(registry, fs.readFileSync(registry, "utf8").replace(/^---\n[\s\S]*?\n---\n/, ""));
    expect(() => renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Q" })).toThrow("worldbuilding/_index.md is missing YAML frontmatter; nothing was changed");
    expect(fs.existsSync(path.join(root, "characters", "mara-quill.md"))).toBe(true);
  });
});

describe("registries", () => {
  test("reindex keeps hand-written sections", () => {
    const root = newProject();
    const index = path.join(root, "characters", "_index.md");
    fs.appendFileSync(index, "\n## My Notes\n\nKeep this.\n");
    createEntity(root, { kind: "character", name: "Mara" });
    const text = fs.readFileSync(index, "utf8");
    expect(text).toContain("## My Notes\n\nKeep this.");
    expect(text).toContain("[mara](mara.md)");
    expect(reindexProject(root).changed).toEqual([]);
  });

  test("reindex keeps CRLF registries CRLF", () => {
    const root = newProject();
    const index = path.join(root, "characters", "_index.md");
    fs.writeFileSync(index, fs.readFileSync(index, "utf8").replace(/\n/g, "\r\n"));
    createEntity(root, { kind: "character", name: "Mara" });
    const text = fs.readFileSync(index, "utf8");
    expect(text).toContain("[mara](mara.md)");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });
});

describe("entity commands", () => {
  test("remove chapter refuses while scenes point at it and walks back statuses", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-01" });
    createEntity(root, { kind: "clue", name: "Bell", planted: "chapter-01" });
    createEntity(root, { kind: "promise", name: "Oath", planted: "chapter-01", payoff: "chapter-01", status: "paid-off" });
    createEntity(root, { kind: "promise", name: "Debt", planted: "chapter-02", payoff: "chapter-01", status: "paid-off" });
    createEntity(root, { kind: "question", name: "Who", introduced: "chapter-02", resolved: "chapter-01" });
    expect(() => removeEntity(root, { kind: "chapter", id: "chapter-01" })).toThrow("chapter chapter-01 still has scenes: chapter-01-scene-01");
    removeEntity(root, { kind: "scene", id: "chapter-01-scene-01" });
    removeEntity(root, { kind: "chapter", id: "chapter-01" });
    const project = scanProject(root);
    expect(project.clues[0].status).toBe("planned");
    expect(project.promises.map((promise) => [promise.id, promise.status])).toEqual([["debt", "planted"], ["oath", "planned"]]);
    expect(project.questions[0].status).toBe("open");
    expect(validateProject(root).errors).toEqual([]);
    expect(checkProjectContinuity(root).errors).toEqual([]);
  });

  test("rename updates the entity heading", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "chapter", name: "Arrival", number: 3 });
    renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Venn" });
    renameEntity(root, { kind: "chapter", id: "chapter-03", name: "Departure" });
    expect(fs.readFileSync(path.join(root, "characters", "mara-venn.md"), "utf8")).toContain("\n# Mara Venn\n");
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-03.md"), "utf8")).toContain("\n# Chapter 3: Departure\n");
  });

  test("add question --resolved records an answered question", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Three", number: 3 });
    createEntity(root, { kind: "question", name: "Who", introduced: "chapter-01", resolved: "chapter-03" });
    expect(scanProject(root).questions[0].status).toBe("answered");
    expect(checkProjectContinuity(root).errors).toEqual([]);
    expect(() => createEntity(root, { kind: "question", name: "Why", resolved: "chapter-03", status: "open" })).toThrow("cannot have status open");
  });

  test("add chapter and scene --pov put the POV character in the cast", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, pov: "mara" });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-01", pov: "mara" });
    const project = scanProject(root);
    expect(project.chapters[0].characters).toEqual(["mara"]);
    expect(project.scenes[0].characters).toEqual(["mara"]);
    expect(checkProjectContinuity(root).warnings.join("\n")).not.toContain("is not listed in characters");
  });

  test("init takes the story id from --dir when the title has no ASCII letters", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Война и мир", dir: "war-and-peace" });
    expect(created.storyId).toBe("war-and-peace");
    createEntity(created.root, { kind: "chapter", name: "One", number: 1 });
    const built = buildBook(created.root, { format: "epub" });
    expect(path.basename(built.outFile)).toBe("war-and-peace.epub");
    expect(validateProject(created.root).errors).toEqual([]);
  });
});

describe("continuity ledger", () => {
  test("links accept promise and clue chapters scheduled past the last chapter", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "clue", name: "Locket", planted: "chapter-01", payoff: "chapter-05" });
    createEntity(root, { kind: "promise", name: "Duel", planted: "chapter-04", status: "planned" });
    expect(validateLinks(root).errors).toEqual([]);
    createEntity(root, { kind: "clue", name: "Ring", planted: "chapter-04", status: "planted" });
    expect(validateLinks(root).errors).toContain("continuity/clues/ring.md references missing chapter chapter-04");
  });

  test("planned status with a drafted planted chapter warns for clues and promises alike", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1, status: "draft" });
    createEntity(root, { kind: "clue", name: "Locket", planted: "chapter-01", status: "planned" });
    createEntity(root, { kind: "promise", name: "Duel", planted: "chapter-01", status: "planned" });
    createEntity(root, { kind: "clue", name: "Ring", planted: "chapter-03", status: "planned" });
    const warnings = checkProjectContinuity(root).warnings;
    expect(warnings).toContain("continuity/clues/locket.md records planted chapter chapter-01 but status is still planned");
    expect(warnings).toContain("continuity/promises/duel.md records planted chapter chapter-01 but status is still planned");
    expect(warnings.join("\n")).not.toContain("ring.md");
  });
});

describe("reports and views", () => {
  test("a non-integer chapter number falls back to the file name in views and blocks builds", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 3 });
    const chapter = path.join(root, "chapters", "chapter-03.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("number: 3", 'number: "3a"'));
    expect(pacingReport(root).rows?.[0]?.number ?? scanProject(root).chapters[0].number).toBe(3);
    expect(() => buildBook(root, { format: "html" })).toThrow("chapters/chapter-03.md: chapter number must be a positive integer to build");
  });

  test("next suggests commands for the path the user typed", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    // A chapter number gap is a continuity warning.
    createEntity(root, { kind: "chapter", name: "Three", number: 3 });
    const cwd = path.dirname(root);
    const result = invoke(cwd, ["next", path.basename(root)]);
    expect(result.out).toContain(`Run story continuity ${path.basename(root)} and`);
    expect(invoke(root, ["next"]).out).toContain("Run story continuity . and");
  });

  test("report shows unset instead of undefined", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, "story.md"), "---\nschema-version: 2\n---\n# Story\n");
    const result = invoke(path.dirname(root), ["report", root]);
    expect(result.out).not.toContain("undefined");
    expect(result.out).toContain(`# ${path.basename(root)}`);
    expect(result.out).toContain("Status: unset");
  });

  test("passes notes a custom pass that looks like a typo", () => {
    const root = newProject();
    const result = projectPasses(root, { done: "strucutre" });
    expect(result.notes).toEqual(["Added custom pass strucutre, which is not in the default ladder; did you mean structure?"]);
    expect(projectPasses(root, { done: "structure" }).notes).toEqual([]);
    const cli = invoke(path.dirname(root), ["passes", root, "--start", "sensitivity-read"]);
    expect(cli.err).toContain("note: Added custom pass sensitivity-read, which is not in the default ladder\n");
  });

  test("diagram ids never collide with Mermaid keywords", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "End" });
    const text = diagramProject(root, { kind: "relationships" }).text;
    expect(text).toContain('end_node["End"]');
    expect(text).not.toMatch(/^\s+end\[/m);
  });

  test("route errors round the gap down and the route up", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    writeMarkdown(path.join(root, "worldbuilding", "locations", "a.md"), "name: A\ntype: city\nroutes:\n  - to: b\n    hours: 11");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "b.md"), "name: B\ntype: city\nroutes:\n  - to: a\n    hours: 11");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "scene", name: "S1", chapter: "chapter-01", character: "mara", location: "a", date: "2024-01-01", time: "00:00" });
    createEntity(root, { kind: "scene", name: "S2", chapter: "chapter-01", character: "mara", location: "b", date: "2024-01-01", time: "10:59" });
    const error = checkProjectContinuity(root).errors.find((entry) => entry.includes("fastest route"));
    expect(error).toContain("10.9h after");
    expect(error).toContain("takes 11h");
  });
});

describe("prose lint", () => {
  test("British single-quoted dialogue is dialogue, and its tags count", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "‘I really felt it,’ Bob said. ‘I saw it. Honestly.’");
    const analysis = proseReport(root).chapters[0].analysis;
    expect(analysis.filterWords).toEqual([]);
    expect(analysis.adverbs).toEqual([]);
    expect(analysis.plainTags).toEqual([{ word: "said", count: 1 }]);
  });

  test("prose right after a heading line still counts", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "### Part One\nThe tide came in over the harbour wall at dusk.");
    expect(proseReport(root).chapters[0].analysis.words).toBe(10);
  });
});

describe("builds", () => {
  function bookProject(prose) {
    const root = newProject("Book");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", prose);
    return root;
  }

  test("--out refuses project source and directories", () => {
    const root = bookProject("Text.");
    const chapter = fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8");
    expect(() => buildBook(root, { out: "chapters/chapter-01.md" })).toThrow("Refusing to write generated output to chapters/chapter-01.md");
    expect(() => exportManuscript(root, { out: "story.md" })).toThrow("it is project source");
    expect(() => synopsisBook(root, { out: path.join(root, "plot", "s.md") })).toThrow("it is project source");
    fs.mkdirSync(path.join(root, "dist"));
    expect(() => buildBook(root, { out: "dist" })).toThrow("--out dist is a directory");
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8")).toBe(chapter);
  });

  test("export defaults to dist/manuscript.md", () => {
    const root = bookProject("Text.");
    expect(exportManuscript(root).outFile).toBe(path.join(root, "dist", "manuscript.md"));
    expect(validateProject(root).warnings.join("\n")).not.toContain("manuscript.md");
  });

  test("HTML comments stay out of word counts and builds", () => {
    const root = bookProject("Visible words here.\n\n<!-- TODO: fix this scene -->");
    expect(computeWordCounts(root).total).toBe(3);
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).not.toContain("TODO");
  });

  test("emphasis follows CommonMark", () => {
    const root = bookProject("***both*** and *a **b** c* and \\*literal\\* and snake_case_word and ** spaced ** and *foo**bar* and *a _b* c_");
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain("<strong><em>both</em></strong>");
    expect(html).toContain("<em>a </em><strong><em>b</em></strong><em> c</em>");
    expect(html).toContain("*literal*");
    expect(html).toContain("snake_case_word");
    expect(html).toContain("** spaced **");
    // The rule of three: ** cannot close a single *.
    expect(html).toContain("<em>foo**bar</em>");
    expect(html).toContain("<em>a _b</em> c_");
  });

  test("XML-invalid characters are dropped from EPUB and DOCX", () => {
    const root = bookProject("Bell\u0001 rang￾.");
    for (const format of ["epub", "docx"]) {
      const outFile = buildBook(root, { format }).outFile;
      const listing = execFileSync("unzip", ["-p", outFile], { encoding: "utf8" });
      expect(listing).toContain("Bell rang.");
      expect(listing).not.toContain("\u0001");
    }
  });

  test("zip entries carry a valid date", () => {
    const root = bookProject("Text.");
    const outFile = buildBook(root, { format: "epub" }).outFile;
    const buffer = fs.readFileSync(outFile);
    expect(buffer.readUInt16LE(12)).toBe(33);
  });

  test("a long title keeps the default file name within limits", () => {
    const cwd = makeTempDir();
    const root = createStoryProject({ cwd, title: "word ".repeat(80), dir: "long" }).root;
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    expect(path.basename(buildBook(root, { format: "html" }).outFile).length).toBeLessThanOrEqual(110);
  });
});

describe("synopsis", () => {
  test("skips starter text and turns list items into sentences", () => {
    const root = newProject();
    createEntity(root, { kind: "arc", name: "Main" });
    const arc = path.join(root, "plot", "arcs", "main.md");
    fs.writeFileSync(arc, fs.readFileSync(arc, "utf8").replace("1. First escalation\n2. Second escalation", "1. The tide turns\n2. The bell rings"));
    const text = synopsisBook(root).text;
    expect(text).toContain("Logline: No logline recorded.");
    expect(text).not.toContain("Initial state and inciting pressure");
    expect(text).not.toContain("Decision point");
    expect(text).toContain("The tide turns. The bell rings.");
    expect(text).not.toMatch(/ {2}/);
  });

  test("truncation keeps headings and paragraphs", () => {
    const root = newProject();
    for (let index = 1; index <= 30; index += 1) {
      createEntity(root, { kind: "arc", name: `Arc ${index}` });
      const arc = path.join(root, "plot", "arcs", `arc-${index}.md`);
      const setup = Array.from({ length: 3 }, (_, n) => `Setup sentence ${n} for arc ${index} with several more words.`).join(" ");
      fs.writeFileSync(arc, fs.readFileSync(arc, "utf8").replace("Initial state and inciting pressure.", setup));
    }
    const text = synopsisBook(root).text;
    expect(text).toContain("\n## Arc 1\n\n");
    expect(text).not.toMatch(/\S ## Arc/);
    expect(text.trimEnd().endsWith("…")).toBe(true);
  });
});

describe("import", () => {
  function importText(text, name = "draft.txt") {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, name), text);
    const result = importManuscript({ source: name, title: "Imported", cwd, dir: "out" });
    return { result, project: scanProject(result.root) };
  }

  test("splits plain-text chapter lines", () => {
    const { result, project } = importText("The Book\n\nChapter 1\n\nHello there.\n\nCHAPTER TWO: Arrival\n\nChapter and verse were quoted.\n\nEpilogue\n\nAfter.\n");
    expect(result.chapters).toBe(3);
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Arrival", "Epilogue"]);
  });

  test("prologue and epilogue headings are chapters and spelled-out numbers leave titles", () => {
    const { project } = importText("# Book\n\n## Prologue\n\nBefore.\n\n## Chapter One: Arrival\n\nA.\n\n## Chapter Twenty-One\n\nB.\n\n## Epilogue\n\nAfter.\n", "draft.md");
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(["Prologue", "Arrival", "Chapter 3", "Epilogue"]);
  });
});

describe("round two", () => {
  test("the chapter total heading never piles up across word-count changes", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const index = path.join(root, "chapters", "_index.md");
    for (const words of ["one two three", "four", "five six"]) {
      appendProse(root, "chapters/chapter-01.md", words);
      computeWordCounts(root, { write: true });
    }
    const text = fs.readFileSync(index, "utf8");
    expect(text.match(/## Total Word Count/g)).toHaveLength(1);
    expect(text).toContain("## Total Word Count: 6");
  });

  test("reindex repairs stale total headings left by 0.10.0", () => {
    const root = newProject();
    const index = path.join(root, "chapters", "_index.md");
    fs.appendFileSync(index, "\n## Total Word Count: 4\n\n## Total Word Count: 3\n\n## Notes\n\nKeep.\n");
    reindexProject(root);
    const text = fs.readFileSync(index, "utf8");
    expect(text.match(/## Total Word Count/g)).toHaveLength(1);
    expect(text).toContain("## Notes\n\nKeep.");
  });

  test("a custom section above the title does not duplicate the title", () => {
    const root = newProject();
    const index = path.join(root, "characters", "_index.md");
    fs.writeFileSync(index, fs.readFileSync(index, "utf8").replace("# Characters", "## Preface\n\npre text\n\n# Characters"));
    reindexProject(root);
    const text = fs.readFileSync(index, "utf8");
    expect(text.match(/^# Characters$/gm)).toHaveLength(1);
    expect(text).toContain("## Preface\n\npre text");
  });

  test("a second section named like a generated one is kept", () => {
    const root = newProject();
    const index = path.join(root, "characters", "_index.md");
    fs.appendFileSync(index, "\n## Registry\n\nMy own registry notes.\n");
    reindexProject(root);
    expect(fs.readFileSync(index, "utf8")).toContain("My own registry notes.");
    expect(reindexProject(root).changed).toEqual([]);
  });

  test("--out through a symlinked folder or a case variant cannot reach source", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    const before = fs.readFileSync(chapter, "utf8");
    fs.symlinkSync(path.join(root, "chapters"), path.join(root, "lnk"));
    expect(() => exportManuscript(root, { out: "lnk/chapter-01.md" })).toThrow("it is project source");
    const outside = makeTempDir();
    fs.symlinkSync(path.join(root, "chapters"), path.join(outside, "x"));
    expect(() => exportManuscript(root, { out: path.join(outside, "x", "chapter-01.md") })).toThrow("it is project source");
    expect(() => exportManuscript(root, { out: "Chapters/chapter-01.md" })).toThrow("it is project source");
    expect(fs.readFileSync(chapter, "utf8")).toBe(before);
  });

  test("--out dist is refused before the dist folder exists", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    expect(() => buildBook(root, { format: "epub", out: "dist" })).toThrow("--out dist is a directory");
    expect(fs.existsSync(path.join(root, "dist"))).toBe(false);
  });

  test("links accept scheduled chapters below a later outline chapter", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "clue", name: "Locket", planted: "chapter-01", payoff: "chapter-09" });
    createEntity(root, { kind: "promise", name: "Duel", planted: "chapter-07", status: "planned", payoff: "chapter-12" });
    createEntity(root, { kind: "chapter", name: "Finale", number: 20 });
    expect(validateLinks(root).errors).toEqual([]);
  });

  test("plain-text import leaves sentences that start like headings alone", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "draft.txt"), "Chapter 1\n\nIt began.\n\nChapter 12 was the worst.\n\nEpilogue of his life, he thought, was near.\n\nChapter Nine Lives of a Cat\n\nCHAPTER TWO: Arrival\n\nNext.\n\nEpilogue\n\nEnd.\n");
    const result = importManuscript({ source: "draft.txt", title: "Imported", cwd, dir: "out" });
    const project = scanProject(result.root);
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Arrival", "Epilogue"]);
    expect(fs.readFileSync(project.chapters[0].file, "utf8")).toContain("Chapter 12 was the worst.");
  });

  test("knowledge names the parse error for a broken character file", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.writeFileSync(path.join(root, "characters", "mara.md"), "# No frontmatter\n");
    const result = invoke(path.dirname(root), ["knowledge", "mara", "--at", "chapter-01", "--path", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("characters/mara.md: is missing YAML frontmatter");
  });

  test("passes hints use the path the user typed", () => {
    const root = newProject();
    const typed = path.basename(root);
    expect(invoke(path.dirname(root), ["passes", typed]).out).toContain(`Run story passes ${typed} --init`);
    expect(invoke(path.dirname(root), ["passes", typed, "--start", "structure"]).out).toContain(`mark it with story passes ${typed} --done structure`);
  });

  test("emphasis stays fast on pathological paragraphs", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", `${"rate 5* and 4* and ".repeat(25000)}\n\n${"*a ".repeat(10000)}b${" c*".repeat(10000)}`);
    const started = performance.now();
    buildBook(root, { format: "html" });
    expect(performance.now() - started).toBeLessThan(3000);
  });

  test("synopsis sentences respect abbreviations, closing quotes, and names", () => {
    const root = newProject();
    createEntity(root, { kind: "arc", name: "Main" });
    const arc = path.join(root, "plot", "arcs", "main.md");
    fs.writeFileSync(arc, fs.readFileSync(arc, "utf8")
      .replace("Initial state and inciting pressure.", "Mara, e.g. the heir, stays. She says \"Run.\" Then everyone runs.")
      .replace("Decision point or highest tension.", "She chooses the reef!")
      .replace("What changes because of this arc.", "Mara keeps the light."));
    const text = synopsisBook(root).text;
    expect(text).toContain("Mara, e.g. the heir, stays. She says \"Run.\"\n");
    expect(text).toContain("Because she chooses the reef! Mara keeps the light.");
  });

  test("comments in code spans stay, and an unclosed comment is flagged", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "Type `<!-- x -->` here.\n\nZeta <!-- unterminated");
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html).toContain("`&lt;!-- x --&gt;`");
    expect(validateProject(root).warnings).toContain("chapters/chapter-01.md opens an HTML comment (<!--) that never closes, so the text after it shows in builds and word counts");
  });
});

describe("round three", () => {
  test("symlinked exemptions, timeline, and linked story files are never followed", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const outside = path.join(makeTempDir(), "outside.md");
    fs.writeFileSync(outside, "---\nexemptions:\n  - pattern: secret-pattern\n    reason: outside file\n---\n");
    fs.symlinkSync(outside, path.join(root, "continuity", "exemptions.md"));
    fs.rmSync(path.join(root, "plot", "timeline.md"));
    fs.symlinkSync("/dev/zero", path.join(root, "plot", "timeline.md"));
    const started = performance.now();
    expect(computeWordCounts(root).total).toBe(0);
    expect(validateLinks(root).ok).toBe(false);
    expect(validateProject(root).errors.join("\n")).toContain("through symlink");
    expect(performance.now() - started).toBeLessThan(5000);
  });

  test("a device file is refused rather than read", async () => {
    const { readTextFile } = await import("../src/files.js");
    expect(() => readTextFile("/dev/null")).toThrow("not a regular file");
  });

  test("links reject chapter-id typos that scheduling would hide", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    expect(() => createEntity(root, { kind: "clue", name: "Locket", planted: "chapter-01", payoff: "chapter-1" })).toThrow("--payoff chapter-1: did you mean chapter-01?");
    expect(() => createEntity(root, { kind: "clue", name: "Zero", planted: "chapter-01", payoff: "chapter-00" })).toThrow("--payoff chapter-00: chapter numbers start at 1");
    // links catches the same typos written by hand.
    writeMarkdown(path.join(root, "continuity", "clues", "locket.md"), "title: Locket\nstatus: planted\nplanted: chapter-01\npayoff: chapter-1");
    writeMarkdown(path.join(root, "continuity", "clues", "zero.md"), "title: Zero\nstatus: planted\nplanted: chapter-01\npayoff: chapter-00");
    createEntity(root, { kind: "clue", name: "Later", planted: "chapter-01", payoff: "chapter-09" });
    const errors = validateLinks(root).errors;
    expect(errors).toContain("continuity/clues/locket.md references missing chapter chapter-1");
    expect(errors).toContain("continuity/clues/zero.md references missing chapter chapter-00");
    expect(errors.join("\n")).not.toContain("chapter-09");
  });

  test("reindex keeps hand-written sections headed like generated ones with a number", () => {
    const root = newProject();
    const index = path.join(root, "characters", "_index.md");
    fs.appendFileSync(index, "\n## Registry: 2\n\nMy registry notes from March.\n\n## Notes\n\n```\n## Family Trees\n```\n\nAfter the fence.\n");
    reindexProject(root);
    const text = fs.readFileSync(index, "utf8");
    expect(text).toContain("## Registry: 2\n\nMy registry notes from March.");
    expect(text).toContain("## Notes\n\n```\n## Family Trees\n```\n\nAfter the fence.");
    expect(reindexProject(root).changed).toEqual([]);
  });

  test("comment stripping respects code fences and stays linear", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "```\n<!-- literal\n```\n\nKept paragraph here.\n\n```\nend -->\n```");
    expect(computeWordCounts(root).total).toBe(3);
    expect(validateProject(root).warnings.join("\n")).not.toContain("never closes");
    const started = performance.now();
    appendProse(root, "chapters/chapter-01.md", `${"[a](b ".repeat(20000)}${"<!--".repeat(20000)}`);
    computeWordCounts(root);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  test("prose and voices stay linear on long unclosed quotes", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", `${"“".repeat(30000)} ${"\"".repeat(30000)} ${"\"a,\" said Bob. ".repeat(4000)}`);
    const started = performance.now();
    proseReport(root);
    invoke(path.dirname(root), ["voices", root]);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  test("rename rewrites a long list in linear time", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    const mentions = Array.from({ length: 30000 }, () => "  - mara").join("\n");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("mentions: []", `mentions:\n${mentions}`));
    const started = performance.now();
    renameEntity(root, { kind: "character", id: "mara", name: "Mara Quill" });
    expect(performance.now() - started).toBeLessThan(3000);
    expect(scanProject(root).chapters[0].mentions.every((id) => id === "mara-quill")).toBe(true);
  });

  test("--out through a hard link replaces the link instead of the chapter", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    const before = fs.readFileSync(chapter, "utf8");
    const link = path.join(makeTempDir(), "hard.md");
    fs.linkSync(chapter, link);
    exportManuscript(root, { out: link });
    expect(fs.readFileSync(chapter, "utf8")).toBe(before);
    expect(fs.readFileSync(link, "utf8")).toContain("Generated by story export");
  });

  test("a failed write leaves no temporary file behind", async () => {
    const { writeFile } = await import("../src/story.js");
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, "target"));
    fs.writeFileSync(path.join(dir, "target", "keep.md"), "x");
    expect(() => writeFile(path.join(dir, "target"), "text")).toThrow();
    expect(fs.readdirSync(dir)).toEqual(["target"]);
  });

  test("Windows-reserved ids are refused and flagged", () => {
    const root = newProject();
    expect(() => createEntity(root, { kind: "character", name: "Con" })).toThrow("Windows reserves the file name con.md");
    createEntity(root, { kind: "character", name: "Mara" });
    expect(() => renameEntity(root, { kind: "character", id: "mara", name: "Aux" })).toThrow("Windows reserves");
    writeMarkdown(path.join(root, "characters", "nul.md"), "name: Nul\nrole: minor\nstatus: alive");
    expect(validateProject(root).warnings).toContain("characters/nul.md uses a file name Windows reserves, so the project cannot be checked out on Windows; rename the entity");
  });

  test("exemption patterns match paths written with either separator", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1, status: "draft" });
    createEntity(root, { kind: "promise", name: "Oath", planted: "chapter-01", status: "planned" });
    writeMarkdown(path.join(root, "continuity", "exemptions.md"), "type: exemption-log\nexemptions:\n  - pattern: \"continuity\\\\promises\\\\oath.md records planted\"\n    reason: written on Windows");
    const result = checkProjectContinuity(root);
    expect(result.dismissed.map((entry) => entry.reason)).toEqual(["written on Windows"]);
  });

  test("series follows a book reached through a symlinked path", () => {
    const cwd = makeTempDir();
    const first = createStoryProject({ cwd, title: "First Book" }).root;
    createStoryProject({ cwd, title: "Second Book", follows: [first] });
    fs.mkdirSync(path.join(cwd, "links"));
    fs.symlinkSync(path.join(cwd, "second-book"), path.join(cwd, "links", "second"));
    const result = invoke(cwd, ["series", "links/second"]);
    expect(result.err).toContain("Series is consistent");
  });

  test("import cleans Pandoc and Scrivener conventions", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "pandoc.md"), "# Chapter 1: Arrival {#arrival .unnumbered}\n\nShe walked on --- faster now -- then stopped.\n\n---\n\nAfter the break `a--b`.\n");
    const md = scanProject(importManuscript({ source: "pandoc.md", title: "P", cwd, dir: "p" }).root);
    expect(md.chapters[0].title).toBe("Arrival");
    const prose = fs.readFileSync(md.chapters[0].file, "utf8");
    expect(prose).toContain("She walked on — faster now – then stopped.");
    expect(prose).toContain("\n---\n");
    expect(prose).toContain("`a--b`");
    fs.writeFileSync(path.join(cwd, "scriv.txt"), "Chapter 1:\n\n\tFirst paragraph.\n\n\tSecond paragraph.\n\nPrologue:\n\nEarlier.\n");
    const txt = scanProject(importManuscript({ source: "scriv.txt", title: "S", cwd, dir: "s" }).root);
    expect(txt.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Prologue"]);
    expect(fs.readFileSync(txt.chapters[0].file, "utf8")).toContain("\nSecond paragraph.");
  });

  test("builds read escaped and # scene breaks, hard breaks, and escapes", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "Mara didn\\'t look.\n\n\\* \\* \\*\n\nShe said, \"It's nothing.\"\\\nThe gate was open.\n\n#\n\nEnd.");
    expect(computeWordCounts(root).total).toBe(12);
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html.match(/class="scene-break"/g)).toHaveLength(2);
    expect(html).toContain("nothing.&quot; The gate");
    const narration = fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8");
    expect(narration.match(/\[pause\]/g)).toHaveLength(2);
  });

  test("export of a CRLF project uses LF only", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, `${fs.readFileSync(chapter, "utf8")}\nOne line.\n\nTwo line.\n`.replace(/\n/g, "\r\n"));
    expect(fs.readFileSync(exportManuscript(root).outFile, "utf8")).not.toContain("\r");
  });

  test("synopsis sentences handle dotted abbreviations and compound names", () => {
    const root = newProject();
    createEntity(root, { kind: "arc", name: "Main" });
    const arc = path.join(root, "plot", "arcs", "main.md");
    fs.writeFileSync(arc, fs.readFileSync(arc, "utf8")
      .replace("Initial state and inciting pressure.", "Mara joins the U.S. Navy. She leaves at 9 a.m. Then the tide turns.")
      .replace("Decision point or highest tension.", "A.J. arrives."));
    const text = synopsisBook(root).text;
    expect(text).toContain("Mara joins the U.S. Navy. She leaves at 9 a.m.\n");
    expect(text).toContain("Because A.J. arrives.");
  });

  test("prose treats unclosed straight and single quotes as speech to the end", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "He walked. \"I really felt it\n\nShe ran. ‘I truly saw it");
    const analysis = proseReport(root).chapters[0].analysis;
    expect(analysis.filterWords).toEqual([]);
    expect(analysis.adverbs).toEqual([]);
  });

  test("an oversized cover is refused", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.writeFileSync(path.join(root, "cover.png"), "");
    fs.truncateSync(path.join(root, "cover.png"), 6 * 1024 * 1024);
    fs.writeFileSync(path.join(root, "story.md"), fs.readFileSync(path.join(root, "story.md"), "utf8").replace("---\ntitle:", "---\ncover: cover.png\ntitle:"));
    expect(() => buildBook(root, { format: "epub" })).toThrow("Refusing to read oversized file");
  });

  test("import leaves comments and fenced code alone when converting dashes", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "notes.md"), "# Chapter 1: One\n\nText <!-- a -- note --> more -- then.\n\n```\nx -- y\n```\n");
    const project = scanProject(importManuscript({ source: "notes.md", title: "N", cwd, dir: "n" }).root);
    const prose = fs.readFileSync(project.chapters[0].file, "utf8");
    expect(prose).toContain("Text <!-- a -- note --> more – then.");
    expect(prose).toContain("x -- y");
  });

  test("continuity reports a refused exemptions file instead of dropping it", () => {
    const root = newProject();
    const outside = path.join(makeTempDir(), "exemptions.md");
    fs.writeFileSync(outside, "---\ntype: exemption-log\nexemptions: []\n---\n");
    fs.symlinkSync(outside, path.join(root, "continuity", "exemptions.md"));
    const result = checkProjectContinuity(root);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("continuity/exemptions.md: Refusing to read through symlink");
  });
});

describe("round four", () => {
  test("~~~ separators and unclosed fences never hide text from counts", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "First part has five words.\n\n~~~\n\nSecond part has five words.\n\n\\~\\~\\~\n\nThird part has five words.\n\n```\nUnclosed fence still counts.");
    expect(computeWordCounts(root).total).toBe(19);
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    expect(html.match(/class="scene-break"/g)).toHaveLength(2);
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    appendProse(root, "chapters/chapter-02.md", "Words outside.\n\n```\nclosed code here\n```");
    expect(computeWordCounts(root).chapters[1].wordCount).toBe(2);
  });

  test("writes keep file permissions and refuse read-only files", () => {
    if (process.getuid?.() === 0) {
      return;
    }
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "Some words here.");
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.chmodSync(chapter, 0o444);
    expect(() => computeWordCounts(root, { write: true })).toThrow("EACCES");
    fs.chmodSync(chapter, 0o600);
    computeWordCounts(root, { write: true });
    expect(fs.statSync(chapter).mode & 0o777).toBe(0o600);
  });

  test("a hard-linked target is replaced with its permissions kept", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const outDir = makeTempDir();
    const target = path.join(outDir, "book.md");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o640);
    fs.linkSync(target, path.join(outDir, "other.md"));
    exportManuscript(root, { out: target });
    expect(fs.statSync(target).mode & 0o777).toBe(0o640);
    expect(fs.readFileSync(path.join(outDir, "other.md"), "utf8")).toBe("old");
    expect(fs.readdirSync(outDir).sort()).toEqual(["book.md", "other.md"]);
  });

  test("a failed hard-link replacement leaves no temporary file", async () => {
    if (process.getuid?.() === 0) {
      return;
    }
    const { writeFile } = await import("../src/story.js");
    const dir = makeTempDir();
    const target = path.join(dir, "book.md");
    fs.writeFileSync(target, "old");
    fs.linkSync(target, path.join(makeTempDir(), "elsewhere.md"));
    fs.chmodSync(dir, 0o555);
    try {
      expect(() => writeFile(target, "new")).toThrow();
      expect(fs.readdirSync(dir)).toEqual(["book.md"]);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  test("import dash conversion leaves URLs, tables, indented code, and unclosed comments", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "src.md"), [
      "# Chapter 1: One",
      "",
      "See [the site](https://example.com/a--b) and https://x.org/--flag now -- then.",
      "",
      "| a | b |",
      "|---|---|",
      "",
      "    indented -- code",
      "",
      "End -- here <!-- note -- unclosed"
    ].join("\n"));
    const project = scanProject(importManuscript({ source: "src.md", title: "S", cwd, dir: "s" }).root);
    const text = fs.readFileSync(project.chapters[0].file, "utf8");
    expect(text).toContain("(https://example.com/a--b)");
    expect(text).toContain("https://x.org/--flag now – then.");
    expect(text).toContain("|---|---|");
    expect(text).toContain("    indented -- code");
    expect(text).toContain("End – here <!-- note -- unclosed");
  });

  test("prose keeps words apart across a comment", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "It was really<!--x-->quiet.");
    expect(proseReport(root).chapters[0].analysis.adverbs).toEqual([{ word: "really", count: 1 }]);
  });

  test("a long id is not pushed over the file name limit", () => {
    const root = newProject();
    const name = "a".repeat(248);
    expect(createEntity(root, { kind: "character", name }).id).toBe(name);
  });

  test("an unclosed fence in a registry section does not duplicate headings", () => {
    const root = newProject();
    const index = path.join(root, "characters", "_index.md");
    fs.writeFileSync(index, fs.readFileSync(index, "utf8").replace("## Relationship Map", "## My Notes\n\n```\nunclosed fence\n\n## Relationship Map"));
    reindexProject(root);
    expect(fs.readFileSync(index, "utf8").match(/^## Relationship Map$/gm)).toHaveLength(1);
  });

  test("init refuses a story id Windows reserves", () => {
    const cwd = makeTempDir();
    expect(() => createStoryProject({ cwd, title: "Con" })).toThrow("Windows reserves the file name con");
    expect(() => createStoryProject({ cwd, title: "Fine Title", dir: "AUX" })).toThrow("Cannot use folder AUX: Windows reserves that name");
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  test("rename and remove leave node_modules alone", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara Quill" });
    const vendored = path.join(root, "node_modules", "story-skills", "examples", "x", "characters");
    fs.mkdirSync(vendored, { recursive: true });
    const vendoredFile = path.join(vendored, "theo.md");
    fs.writeFileSync(vendoredFile, "---\nname: Theo\nrelationships:\n  - character: mara-quill\n    type: sibling\n---\n");
    renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Tide" });
    removeEntity(root, { kind: "character", id: "mara-tide" });
    expect(fs.readFileSync(vendoredFile, "utf8")).toContain("character: mara-quill");
  });

  test("continuity route checks stay fast with a busy character and a big map", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    for (let index = 0; index < 60; index += 1) {
      const routes = index < 59 ? `\nroutes:\n  - to: loc-${index + 1}\n    hours: 1` : "";
      writeMarkdown(path.join(root, "worldbuilding", "locations", `loc-${index}.md`), `name: Loc ${index}\ntype: city${routes}`);
    }
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const scenes = path.join(root, "scenes");
    for (let index = 0; index < 600; index += 1) {
      const day = String(1 + Math.floor(index / 24)).padStart(2, "0");
      const hour = String(index % 24).padStart(2, "0");
      writeMarkdown(path.join(scenes, `chapter-01-scene-${String(index + 1).padStart(3, "0")}.md`), `title: S${index}\nchapter: chapter-01\nscene: ${index + 1}\nstatus: draft\nlocation: loc-${index % 60}\ncharacters:\n  - mara\ndate: 2024-01-${day}\ntime: "${hour}:00"`);
    }
    const started = performance.now();
    checkProjectContinuity(root);
    expect(performance.now() - started).toBeLessThan(4000);
  });

  test("Shunn title pages name every co-author", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace("---\ntitle:", "---\nauthors:\n  - Ann Lee\n  - Bo Chen\ntitle:"));
    const text = fs.readFileSync(buildBook(root, { format: "shunn" }).outFile, "utf8");
    expect(text).toContain("Ann Lee and Bo Chen");
  });

  test("route checks find the shortest path through a branching map", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    const routes = { a: [["b", 5], ["c", 1], ["e", 3], ["f", 9], ["g", 4]], b: [["d", 1]], c: [["b", 1], ["d", 7], ["f", 2]], d: [], e: [["d", 2]], f: [["d", 6]], g: [["d", 8]] };
    for (const [id, edges] of Object.entries(routes)) {
      const list = edges.length === 0 ? "" : `\nroutes:\n${edges.map(([to, hours]) => `  - to: ${to}\n    hours: ${hours}`).join("\n")}`;
      writeMarkdown(path.join(root, "worldbuilding", "locations", `${id}.md`), `name: ${id.toUpperCase()}\ntype: city${list}`);
    }
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "scene", name: "S1", chapter: "chapter-01", character: "mara", location: "a", date: "2024-01-01", time: "00:00" });
    createEntity(root, { kind: "scene", name: "S2", chapter: "chapter-01", character: "mara", location: "d", date: "2024-01-01", time: "02:00" });
    const error = checkProjectContinuity(root).errors.find((entry) => entry.includes("fastest route"));
    expect(error).toContain("takes 3h");
  });
});

describe("round five", () => {
  test("a wide-window sighting in between never hides a travel conflict", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    writeMarkdown(path.join(root, "worldbuilding", "locations", "x.md"), "name: X\ntype: city\nroutes:\n  - to: y\n    hours: 1.6");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "y.md"), "name: Y\ntype: city");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "scene", name: "E", chapter: "chapter-01", character: "mara", location: "x", date: "2024-01-01", time: "19:00" });
    createEntity(root, { kind: "scene", name: "M", chapter: "chapter-01", character: "mara", location: "y", date: "2024-01-01", time: "night" });
    createEntity(root, { kind: "scene", name: "C", chapter: "chapter-01", character: "mara", location: "y", date: "2024-01-01", time: "20:30" });
    expect(checkProjectContinuity(root).errors).toContain("scenes/chapter-01-scene-03.md puts mara at y 1.5h after scenes/chapter-01-scene-01.md at x, but the fastest route takes 1.6h");
  });

  test("a question may be introduced in a chapter not written yet", () => {
    const root = newProject();
    createEntity(root, { kind: "question", name: "Who", introduced: "chapter-02" });
    expect(validateLinks(root).errors).toEqual([]);
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "question", name: "Why", introduced: "chapter-01", resolved: "chapter-04" });
    expect(validateLinks(root).errors).toContain("continuity/questions/why.md references missing chapter chapter-04");
  });

  test("add scene lists its location and cast on the chapter", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "character", name: "Theo" });
    createEntity(root, { kind: "location", name: "Harbor" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, mention: "theo" });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-01", location: "harbor", character: ["mara", "theo"] });
    const chapter = scanProject(root).chapters[0];
    expect(chapter.locations).toEqual(["harbor"]);
    expect(chapter.characters).toEqual(["mara"]);
    expect(checkProjectContinuity(root).warnings.join("\n")).not.toContain("does not list");
  });

  test("next stops suggesting chapters for a finished book and sorts by priority", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "arc", name: "Main", status: "resolved" });
    const actions = projectActions(root).actions;
    expect(actions.map((item) => item.title).join("\n")).not.toContain("Draft chapter");
    const priorities = actions.map((item) => item.priority);
    expect(priorities).toEqual([...priorities].sort());
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/status: \w+/, "status: complete"));
    fs.rmSync(path.join(root, "plot", "arcs", "main.md"));
    expect(projectActions(root).actions.map((item) => item.title).join("\n")).not.toContain("Draft chapter");
  });

  test("synopsis labels the logline, and three pages carry more than one", () => {
    const root = newProject();
    createEntity(root, { kind: "arc", name: "Main" });
    const arc = path.join(root, "plot", "arcs", "main.md");
    const setup = Array.from({ length: 5 }, (_, index) => `Setup beat ${index + 1} happens.`).join(" ");
    fs.writeFileSync(arc, fs.readFileSync(arc, "utf8").replace("Initial state and inciting pressure.", setup));
    const one = synopsisBook(root, { pages: 1 }).text;
    const three = synopsisBook(root, { pages: 3 }).text;
    expect(one).toContain("Logline: No logline recorded.");
    expect(one).toContain("Setup beat 2 happens.");
    expect(one).not.toContain("Setup beat 3");
    expect(three).toContain("Setup beat 4 happens.");
  });

  test("voices says a voice word is missing only from attributed lines", () => {
    const root = newProject();
    writeMarkdown(path.join(root, "characters", "mara.md"), "name: Mara\nrole: protagonist\nstatus: alive\nvoice-words:\n  - reckon");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", Array.from({ length: 5 }, () => "\"Fine,\" Mara said.").join("\n\n"));
    const result = invoke(path.dirname(root), ["voices", root]);
    expect(result.err).toContain("mara does not say \"reckon\" from their voice-words list in 5 attributed lines of dialogue");
  });

  test("import converts dashes in list continuations and leaves mailto addresses", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "list.md"), "# Chapter 1: One\n\n- Item one\n\n    Continued -- still prose.\n\nWrite to mailto:someone--x@example.com today.\n");
    const project = scanProject(importManuscript({ source: "list.md", title: "L", cwd, dir: "l" }).root);
    const text = fs.readFileSync(project.chapters[0].file, "utf8");
    expect(text).toContain("    Continued – still prose.");
    expect(text).toContain("mailto:someone--x@example.com");
  });

  test("a failed hard-link replacement names the target", async () => {
    if (process.getuid?.() === 0) {
      return;
    }
    const { writeFile } = await import("../src/story.js");
    const dir = makeTempDir();
    const target = path.join(dir, "book.md");
    fs.writeFileSync(target, "old");
    fs.linkSync(target, path.join(makeTempDir(), "elsewhere.md"));
    fs.chmodSync(dir, 0o555);
    try {
      expect(() => writeFile(target, "new")).toThrow(`Cannot replace hard-linked ${target}: EACCES`);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  test("prose and wordcount agree when a chapter has code fences", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "Words before.\n\n```\ncode words here\n```\n\nWords after.");
    expect(proseReport(root).chapters[0].analysis.words).toBe(computeWordCounts(root).total);
  });
});

describe("round six", () => {
  test("skill notes without frontmatter do not block rename or remove", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    fs.writeFileSync(path.join(root, "continuity", "motifs.md"), "# Motifs\n\n| Motif | Chapters |\n|---|---|\n| salt | 1 |\n");
    fs.writeFileSync(path.join(root, "continuity", "theme-audit.md"), "# Theme audit\n\nMara carries the lie.\n");
    expect(renameEntity(root, { kind: "character", id: "mara", name: "Mara Quill" }).id).toBe("mara-quill");
    expect(removeEntity(root, { kind: "character", id: "mara-quill" }).id).toBe("mara-quill");
  });

  test("pre-0.10.0 relationship pairs warn instead of failing links", () => {
    const root = newProject();
    writeMarkdown(path.join(root, "characters", "ilya.md"), "name: Ilya\nrole: antagonist\nstatus: alive\nrelationships:\n  - character: theo\n    type: former-supervisor\n  - character: mara\n    type: adversary");
    writeMarkdown(path.join(root, "characters", "theo.md"), "name: Theo\nrole: supporting\nstatus: alive\nrelationships:\n  - character: ilya\n    type: former-supervisor");
    writeMarkdown(path.join(root, "characters", "mara.md"), "name: Mara\nrole: protagonist\nstatus: alive\nrelationships:\n  - character: ilya\n    type: antagonist");
    const result = validateLinks(root);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain("characters/ilya.md relationship adversary to mara has backlink antagonist, a pairing from before story-skills 0.10.0; change the backlink to adversary");
    expect(result.warnings.filter((warning) => warning.includes("change the backlink to former-subordinate"))).toHaveLength(2);
  });

  test("a character who died before the story is flagged in a cast", () => {
    const root = newProject();
    writeMarkdown(path.join(root, "characters", "tam.md"), "name: Tam\nrole: minor\nstatus: deceased");
    createEntity(root, { kind: "chapter", name: "One", number: 1, pov: "tam" });
    expect(checkProjectContinuity(root).warnings).toContain("chapters/chapter-01.md lists tam, who died before the story (deceased with no died-in); move appearances to mentions");
  });

  test("next asks for post-hoc notes on discovered chapters", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1, mode: "discovered" });
    const titles = () => projectActions(root).actions.map((item) => `${item.title}: ${item.detail}`).join("\n");
    expect(titles()).toContain("Reconcile discovered chapters: Run the discovery-drafting reconcile loop and add ## Chapter Notes (post-hoc) for chapter-01.");
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("## Chapter Text", "## Chapter Notes (post-hoc)\n\nFound the harbour.\n\n## Chapter Text"));
    expect(titles()).not.toContain("Reconcile discovered chapters");
  });

  test("a missing registry points to story migrate, and abandoned stories get no draft suggestion", () => {
    const root = newProject();
    fs.rmSync(path.join(root, "continuity", "clues"), { recursive: true });
    expect(validateProject(root).errors).toContain("Missing required path: continuity/clues/_index.md (story migrate adds missing registries)");
    migrateProject(root);
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/status: \w+/, "status: abandoned"));
    expect(projectActions(root).actions.map((item) => item.title).join("\n")).not.toContain("Draft chapter");
  });

  test("add scene copies only existing characters and locations onto the chapter", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-01", character: "nobody", location: "nowhere" });
    const chapter = scanProject(root).chapters[0];
    expect(chapter.characters).toEqual([]);
    expect(chapter.locations).toEqual([]);
  });

  test("voices leaves a pronoun-tagged line unattributed", () => {
    const root = newProject();
    writeMarkdown(path.join(root, "characters", "tam.md"), "name: Tam\nrole: minor\nstatus: alive");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "\u2018It\u2019s nothing,\u2019 she said, holding it the way Tam used to hold shells.");
    const report = invoke(path.dirname(root), ["voices", root]);
    expect(report.out).toContain("Voices: 0 speaking characters, 1 unattributed lines");
  });

  test("init --follows gives the earlier book the series id", () => {
    const cwd = makeTempDir();
    const first = createStoryProject({ cwd, title: "First" }).root;
    createStoryProject({ cwd, title: "Second", follows: [first], series: "tides" });
    expect(scanProject(first).story.data.series).toBe("tides");
  });

  test("add matter --heading false makes a page without a title", () => {
    const root = newProject();
    const result = invoke(path.dirname(root), ["add", "matter", "Dedication", "--heading", "false", "--path", root]);
    expect(result.code).toBe(0);
    expect(fs.readFileSync(path.join(root, "matter", "dedication.md"), "utf8")).toContain("heading: false");
  });

  test("the metadata checklist lists pending permissions", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "matter", name: "Epigraph" });
    const epigraph = path.join(root, "matter", "epigraph.md");
    fs.writeFileSync(epigraph, fs.readFileSync(epigraph, "utf8").replace("heading: true", "heading: true\npermission: pending") + "A quoted line.\n");
    const sheet = fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8");
    expect(sheet).toContain("Permissions cleared for quoted matter (`permission`; pending: epigraph)");
  });
});

describe("round seven", () => {
  test("voices only treats a pronoun as a tag next to a quote", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", [
      "\"Not yet.\" Mara shook her head. She said nothing more for a while.",
      "\"The tide.\" Mara pointed. What she said next was lost to the wind.",
      "\"It is nothing,\" she said, and Mara looked away."
    ].join("\n\n"));
    expect(invoke(path.dirname(root), ["voices", root]).out).toContain("Voices: 1 speaking characters, 1 unattributed lines");
  });

  test("a plain _index.md outside the registries does not block rename", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    fs.mkdirSync(path.join(root, "notes"));
    fs.writeFileSync(path.join(root, "notes", "_index.md"), "# Notes\n");
    expect(renameEntity(root, { kind: "character", id: "mara", name: "Mara Quill" }).id).toBe("mara-quill");
  });

  test("parse errors name files by their project path only", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, "progress.md"), "no frontmatter\n");
    const errors = validateProject(root).errors;
    expect(errors).toContain("progress.md: is missing YAML frontmatter");
    expect(errors.join("\n")).not.toContain(root);
  });

  test("an unreadable story.md is reported once", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, "story.md"), "no frontmatter\n");
    expect(validateProject(root).errors).toEqual(["story.md: is missing YAML frontmatter"]);
  });

  test("file-system errors are described in plain words", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const outside = makeTempDir();
    fs.writeFileSync(path.join(outside, "afile"), "x");
    const result = invoke(outside, ["export", root, "--out", path.join(outside, "afile", "x.md")]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^Cannot \w+( the folder)? afile(\/x\.md)?: a part of the path is not a folder\n$/);
  });

  test("add scene refuses a chapter that does not exist", () => {
    const root = newProject();
    expect(() => createEntity(root, { kind: "scene", name: "Dock" })).toThrow("No chapters yet");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    expect(() => createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-99" })).toThrow("chapter chapter-99 does not exist");
  });

  test("add rejects reference ids that can never resolve", () => {
    const root = newProject();
    expect(() => createEntity(root, { kind: "clue", name: "C", planted: "Chapter 1" })).toThrow('--planted "Chapter 1" must be a kebab-case id (such as chapter-01)');
    expect(() => createEntity(root, { kind: "character", name: "Mara", location: "Port Town" })).toThrow('--location "Port Town" must be a kebab-case id');
    expect(() => createEntity(root, { kind: "chapter", name: "One", pov: "Mara Quill" })).toThrow('--pov "Mara Quill" must be a character id');
    expect(() => createEntity(root, { kind: "chapter", name: "One", arc: "Main Arc" })).toThrow('--arc "Main Arc" must be a kebab-case id (such as the-long-road)');
    // A character's --arc is a free-text arc theme.
    expect(createEntity(root, { kind: "character", name: "Old Bram", arc: "Found Family" }).id).toBe("old-bram");
  });

  test("validate reports a bad word count and a list status plainly", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("word-count: 0", "word-count: many").replace("status: outline", "status:\n  - draft"));
    let result = validateProject(root);
    expect(result.warnings.join("\n")).not.toContain("NaN");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("word-count: many", "word-count: many\nhook:\n  - cliffhanger"));
    expect(validateProject(root).errors).toContain("chapters/chapter-01.md frontmatter field hook must be a single value, not a list");
    // One error for the list, not two.
    result = validateProject(root);
    expect(result.errors.filter((error) => error.includes("field status"))).toEqual(["chapters/chapter-01.md frontmatter field status must be a scalar"]);
  });

  test("the CLI suggests near misses and treats -x as an option", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["valdate"]).err).toContain("Unknown command: valdate; did you mean validate?");
    // Only build's own options are suggested.
    expect(invoke(cwd, ["build", "--formt", "x"]).err).toContain("Unknown option --formt; did you mean --format?");
    expect(invoke(cwd, ["init", "--formt", "x"]).err).toContain("Unknown option --formt; did you mean --form?");
    expect(invoke(cwd, ["help", "nosuch"]).code).toBe(1);
    expect(invoke(cwd, ["validate", "-x"]).err).toContain("-x is not a story project: missing story.md; -x is not an option (run story help)");
    expect(invoke(cwd, ["build", "--format="]).err).toContain("Unsupported build format: (empty)");
  });

  test("help for one command lists only its options", () => {
    const cwd = makeTempDir();
    const help = invoke(cwd, ["help", "wordcount"]).out;
    expect(help).toContain("Usage: story wordcount [path] [options]");
    expect(help).toContain("--write");
    expect(help).not.toContain("--format");
    expect(invoke(cwd, ["wordcount", "--help"]).out).toBe(help);
  });

  test("import refuses a folder that is already a story project", () => {
    const root = newProject();
    expect(() => importManuscript({ source: root, title: "Again", cwd: path.dirname(root), dir: "again" })).toThrow("is already a story project");
  });

  test("timeline counts a pov-only chapter as presence", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace('pov: ""', "pov: mara"));
    expect(invoke(path.dirname(root), ["timeline", root]).out).toContain("- mara: 1 of 1 chapters");
  });
});

describe("round eight", () => {
  test("an interrupted rename can be rerun to finish", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: "mara-quill" });
    createEntity(root, { kind: "chapter", name: "Two", number: 2, character: "mara-quill" });
    // A kill while references are rewritten leaves the entity file in place
    // (it moves last), with some references already on the new id...
    const one = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(one, fs.readFileSync(one, "utf8").replace("mara-quill", "mara-tide"));
    // ...so a rerun finishes the job.
    expect(renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Tide" }).id).toBe("mara-tide");
    expect(validateLinks(root).errors).toEqual([]);
    // Killed after the old file was deleted, only the reindex was missed; a
    // rerun resumes rather than failing with "does not exist".
    expect(invoke(path.dirname(root), ["rename", "character", "mara-quill", "Mara Tide", "--path", root]).out).toContain("Finished an interrupted rename of character mara-quill to mara-tide");
    // Renaming onto another entity with the same name is still refused.
    createEntity(root, { kind: "character", name: "Other" });
    createEntity(root, { kind: "character", name: "Other Two" });
    expect(() => renameEntity(root, { kind: "character", id: "other-two", name: "Other" })).toThrow("character other already exists");
  });

  test("remove rewrites references before deleting the file", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: "mara" });
    removeEntity(root, { kind: "character", id: "mara" });
    expect(scanProject(root).chapters[0].characters).toEqual([]);
  });

  test("names may start with a dash, and -- ends the options", () => {
    const root = newProject();
    expect(invoke(path.dirname(root), ["add", "term", "-ism", "--path", root]).code).toBe(0);
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "--", "--Untitled"]).code).toBe(0);
    expect(fs.existsSync(path.join(cwd, "untitled"))).toBe(true);
  });

  test("progress --log refuses while a chapter cannot be read", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, "characters", "bad.md"), "---\nname: Bad\n");
    expect(() => projectProgress(root, { log: true, date: "2024-02-01" })).toThrow("Cannot log progress");
    expect(fs.existsSync(path.join(root, "progress.md"))).toBe(false);
  });

  test("an untitled story.md does not set off registry story errors", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, "story.md"), "---\nfoo: bar\n---\n");
    expect(validateProject(root).errors.join("\n")).not.toContain("story must be");
  });

  test("a chapter pov that none of its scenes share is flagged", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "character", name: "Tam" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, pov: "mara", character: "tam" });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-01", pov: "tam" });
    expect(checkProjectContinuity(root).warnings).toContain("chapters/chapter-01.md has POV mara but its scenes are told by tam");
  });

  test("a payoff chapter that has passed warns at once", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1, status: "draft" });
    createEntity(root, { kind: "chapter", name: "Two", number: 2, status: "draft" });
    createEntity(root, { kind: "clue", name: "Herring", planted: "chapter-01", payoff: "chapter-02", "red-herring": true });
    expect(checkProjectContinuity(root).warnings).toContain("continuity/clues/herring.md payoff chapter chapter-02 has passed and status is still planted");
  });

  test("voices sees a pronoun tag across an ellipsis or bracket", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "\"Hold on\"\u2026 she said, and Mara looked away.\n\n\"Wait\" (she said) and Mara nodded.");
    expect(invoke(path.dirname(root), ["voices", root]).out).toContain("Voices: 0 speaking characters, 2 unattributed lines");
  });

  // Gaps found by mutation testing.
  test("the character right after a comment survives", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "The tide<!-- note -->came in slowly.");
    expect(computeWordCounts(root).total).toBe(4);
    expect(fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8")).toContain("The tidecame in slowly.");
  });

  test("links rejects a pov that is a name, not an id", () => {
    const root = newProject();
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft\npov: Mara Quill");
    expect(validateLinks(root).errors.join("\n")).toContain("must be kebab-case");
  });

  test("artifact mentions at or before since, and mentions of pre-story losses, are fine", () => {
    const root = newProject();
    createEntity(root, { kind: "artifact", name: "Blade" });
    createEntity(root, { kind: "artifact", name: "Crown" });
    for (const number of [1, 2, 3]) {
      createEntity(root, { kind: "chapter", name: `C${number}`, number, mention: ["blade", "crown"] });
    }
    const state = path.join(root, "continuity", "state.md");
    fs.writeFileSync(state, fs.readFileSync(state, "utf8").replace("object-state: []", "object-state:\n  - artifact: blade\n    status: destroyed\n    since: chapter-02\n  - artifact: crown\n    status: lost"));
    expect(checkProjectContinuity(root).errors).toEqual(["chapters/chapter-03.md mentions blade, destroyed/lost since chapter-02"]);
  });

  test("malformed exemption entries give one error each and never crash", () => {
    const root = newProject();
    writeMarkdown(path.join(root, "continuity", "exemptions.md"), "type: exemption-log\nexemptions:\n  - just-a-string\n  - ~");
    const errors = validateProject(root).errors.filter((error) => error.includes("exemptions"));
    expect(errors.filter((error) => error.includes("must be a mapping"))).toHaveLength(2);
    expect(errors.join("\n")).not.toContain("non-empty pattern");
  });

  test("correctly ordered promises and clues give no errors", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    createEntity(root, { kind: "promise", name: "Oath", planted: "chapter-01", payoff: "chapter-02" });
    createEntity(root, { kind: "clue", name: "Ring", planted: "chapter-01", payoff: "chapter-02" });
    expect(checkProjectContinuity(root).errors).toEqual([]);
  });

  test("removing a chapter reopens a resolved question", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    createEntity(root, { kind: "question", name: "Who", introduced: "chapter-01", resolved: "chapter-02", status: "resolved" });
    removeEntity(root, { kind: "chapter", id: "chapter-02" });
    expect(scanProject(root).questions[0].status).toBe("open");
  });

  test("British single quotes pair exactly, apostrophes included", async () => {
    const { quotedSpans } = await import("../src/voices.js");
    expect(quotedSpans("\u2018Don\u2019t,\u2019 she said. Tam\u2019s boat.")).toEqual(["Don\u2019t,"]);
  });

  test("repeated phrases are found at any word offset", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "x the grey tide rose. y z the grey tide rose. w the grey tide rose.");
    expect(proseReport(root).phrases).toContainEqual({ phrase: "the grey tide rose", count: 3 });
  });

  test("two-letter given names are matched in attributions", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Al Reed" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "\"Hi,\" Al said.");
    expect(invoke(path.dirname(root), ["voices", root]).out).toContain("al-reed: 1 lines");
  });

  test("a code span on the last line keeps its comment", async () => {
    const { chapterProse } = await import("../src/markdown.js");
    expect(chapterProse("Type `<!-- x -->`")).toBe("Type `<!-- x -->`");
  });
});


describe("move", () => {
  function book() {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: "mara" });
    createEntity(root, { kind: "chapter", name: "Two", number: 2, character: "mara" });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-02", character: "mara" });
    createEntity(root, { kind: "clue", name: "Ring", planted: "chapter-01", payoff: "chapter-02" });
    createEntity(root, { kind: "question", name: "Who", introduced: "chapter-01", resolved: "chapter-02" });
    const character = path.join(root, "characters", "mara.md");
    fs.writeFileSync(character, fs.readFileSync(character, "utf8").replace("status: alive", "status: deceased\ndied-in: chapter-02"));
    const state = path.join(root, "continuity", "state.md");
    fs.writeFileSync(state, fs.readFileSync(state, "utf8").replace("current-chapter: 0", "current-chapter: 2").replace("knowledge-state: []", "knowledge-state:\n  - character: mara\n    knows: The ring is fake\n    learned-in: chapter-02"));
    fs.writeFileSync(path.join(root, "plot", "timeline.md"), `${fs.readFileSync(path.join(root, "plot", "timeline.md"), "utf8")}\n- chapter-02: the dock (chapter-02-scene-01)\n`);
    return root;
  }

  test("move chapter renumbers files and every reference", () => {
    const root = book();
    const result = invoke(path.dirname(root), ["move", "chapter", "chapter-02", "--number", "3", "--path", root]);
    expect(result.out).toContain("Moved chapter chapter-02 to chapter-03");
    expect(result.out).toContain("(with 1 scene)");
    const project = scanProject(root);
    expect(project.chapters.map((chapter) => [chapter.id, chapter.number])).toEqual([["chapter-01", 1], ["chapter-03", 3]]);
    expect(project.scenes.map((scene) => [scene.id, scene.chapter])).toEqual([["chapter-03-scene-01", "chapter-03"]]);
    expect(project.clues[0].payoff).toBe("chapter-03");
    expect(project.questions[0].resolved).toBe("chapter-03");
    expect(project.characters[0].diedIn).toBe("chapter-03");
    const stateData = project.continuity.data;
    expect(stateData["current-chapter"]).toBe(3);
    expect(stateData["knowledge-state"][0]["learned-in"]).toBe("chapter-03");
    expect(fs.readFileSync(path.join(root, "plot", "timeline.md"), "utf8")).toContain("- chapter-03: the dock (chapter-03-scene-01)");
    expect(fs.readFileSync(project.chapters[1].file, "utf8")).toContain("# Chapter 3: Two");
    expect(validateProject(root).errors).toEqual([]);
    expect(validateLinks(root).errors).toEqual([]);
  });

  test("move chapter refuses a taken number and names the fix", () => {
    const root = book();
    expect(() => moveEntity(root, { kind: "chapter", id: "chapter-01", number: 2 })).toThrow("chapter-02 already exists: move it first. To make room, renumber from the highest chapter down");
    expect(() => moveEntity(root, { kind: "chapter", id: "chapter-01" })).toThrow("move chapter requires --number <n>");
    expect(() => moveEntity(root, { kind: "chapter", id: "chapter-09", number: 4 })).toThrow("chapter chapter-09 does not exist");
    expect(() => moveEntity(root, { kind: "chapter", id: "chapter-01", number: 1 })).toThrow("chapter-01 is already chapter 1");
    expect(() => moveEntity(root, { kind: "character", id: "mara", number: 1 })).toThrow("story move works on chapters and scenes");
  });

  test("move scene changes chapter and number and updates the chapter cast", () => {
    const root = book();
    moveEntity(root, { kind: "scene", id: "chapter-02-scene-01", chapter: "chapter-01" });
    let project = scanProject(root);
    expect(project.scenes.map((scene) => [scene.id, scene.chapter, scene.scene])).toEqual([["chapter-01-scene-01", "chapter-01", 1]]);
    expect(fs.readFileSync(path.join(root, "plot", "timeline.md"), "utf8")).toContain("(chapter-01-scene-01)");
    moveEntity(root, { kind: "scene", id: "chapter-01-scene-01", scene: 4 });
    project = scanProject(root);
    expect(project.scenes[0].id).toBe("chapter-01-scene-04");
    expect(validateLinks(root).errors).toEqual([]);
    expect(() => moveEntity(root, { kind: "scene", id: "chapter-01-scene-04" })).toThrow("move scene requires --chapter <id>, --scene <n>, or both");
    expect(() => moveEntity(root, { kind: "scene", id: "chapter-01-scene-04", chapter: "chapter-07" })).toThrow("chapter chapter-07 does not exist");
    expect(() => moveEntity(root, { kind: "scene", id: "chapter-01-scene-04", scene: 4 })).toThrow("is already scene 4");
    expect(() => moveEntity(root, { kind: "scene", id: "nope-scene-01", scene: 1 })).toThrow("scene nope-scene-01 does not exist");
    createEntity(root, { kind: "scene", name: "Other", chapter: "chapter-01", scene: 5 });
    expect(() => moveEntity(root, { kind: "scene", id: "chapter-01-scene-04", scene: 5 })).toThrow("chapter-01-scene-05 already exists");
  });

  test("move chapter refuses when a scene file is in the way", () => {
    const root = book();
    writeMarkdown(path.join(root, "scenes", "chapter-05-scene-01.md"), "title: Stray\nchapter: chapter-05\nscene: 1\nstatus: draft");
    expect(() => moveEntity(root, { kind: "chapter", id: "chapter-02", number: 5 })).toThrow("scenes/chapter-05-scene-01.md already exists; nothing was changed");
    expect(fs.existsSync(path.join(root, "chapters", "chapter-02.md"))).toBe(true);
  });

  test("move chapter follows links to its scene files and a colonless heading", () => {
    const root = book();
    const character = path.join(root, "characters", "mara.md");
    fs.appendFileSync(character, "\nSee [the dock](../scenes/chapter-02-scene-01.md).\n");
    const chapter = path.join(root, "chapters", "chapter-02.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("# Chapter 2: Two", "# Chapter 2"));
    moveEntity(root, { kind: "chapter", id: "chapter-02", number: 3 });
    expect(fs.readFileSync(character, "utf8")).toContain("(../scenes/chapter-03-scene-01.md)");
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-03.md"), "utf8")).toContain("\n# Chapter 3\n");
  });

  test("an interrupted move can be rerun to finish", () => {
    const root = book();
    moveEntity(root, { kind: "chapter", id: "chapter-02", number: 3 });
    // Recreate the state of a run killed after writing the new files but
    // before deleting the old ones.
    const project = scanProject(root);
    const snapshot = new Map([...project.chapters, ...project.scenes].map((entry) => [entry.file, fs.readFileSync(entry.file, "utf8")]));
    moveEntity(root, { kind: "chapter", id: "chapter-03", number: 2 });
    for (const [file, text] of snapshot) {
      fs.writeFileSync(file, text);
    }
    expect(moveEntity(root, { kind: "chapter", id: "chapter-03", number: 2 }).id).toBe("chapter-02");
    expect(scanProject(root).chapters.map((entry) => entry.id)).toEqual(["chapter-01", "chapter-02"]);
  });

  test("move requires an id", () => {
    const root = book();
    expect(() => moveEntity(root, { kind: "chapter", id: "" })).toThrow("move requires a chapter or scene id");
  });
});

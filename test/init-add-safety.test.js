import { afterEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { importManuscript } from "../src/import.js";
import { LOCK_FILE } from "../src/lock.js";
import { buildSeries } from "../src/series.js";
import {
  buildBook,
  checkProjectContinuity,
  createEntity,
  createStoryProject,
  renameEntity,
  scanProject,
  validateLinks,
  validateProject
} from "../src/story.js";
import { otherLivePid, makeTempDir, memoryIo, readArchiveText, writeMarkdown, messages, whileWriting, CHMOD_IGNORED } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function frontmatter(file) {
  return parseFrontmatter(fs.readFileSync(file, "utf8"), file).data;
}

function setFrontmatterLine(file, pattern, replacement) {
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.replace(pattern, replacement), "utf8");
}

function newProject(title = "Refs") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function read(root, ...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

function edit(root, relativePath, from, to) {
  const file = path.join(root, relativePath);
  const text = fs.readFileSync(file, "utf8");
  expect(text).toContain(from);
  fs.writeFileSync(file, text.replace(from, to));
}

function editFile(file, from, to) {
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(from, to), "utf8");
}

function initProject() {
  const cwd = makeTempDir();
  expect(invoke(cwd, ["init", "Safety", "--dir", "p"]).code).toBe(0);
  return path.join(cwd, "p");
}

function gapProject(title = "Gap Story") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

function safetyProject(title = "Safety") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function listDir(root, dir) {
  return fs.readdirSync(path.join(root, dir)).sort();
}

function readOnly(file, run) {
  fs.chmodSync(file, 0o444);
  try {
    expect(run).toThrow(`EACCES: permission denied, access '${file}'`);
  } finally {
    fs.chmodSync(file, 0o644);
  }
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("init", () => {
  test("a title with no kebab-case form takes its story id from --dir", () => {
    const cwd = makeTempDir();
    expect(() => createStoryProject({ cwd, title: "東京物語" })).toThrow("Cannot derive a story id");
    expect(fs.readdirSync(cwd)).toEqual([]);
    const result = invoke(cwd, ["init", "東京物語", "--dir", "tk"]);
    expect(result.code).toBe(0);
    const created = scanProject(path.join(cwd, "tk"));
    expect(created.storyId).toBe("tk");
    expect(created.title).toBe("東京物語");
    expect(messages(validateProject(path.join(cwd, "tk")).errors)).toEqual([]);
  });

  test("refuses a title with a line break, so it cannot add lines to story.md", () => {
    const cwd = makeTempDir();
    for (const title of ["Night\nTrain", "X\n## Synopsis\nInjected", "Night\rTrain", "Night\u2028Train", "Night\u2029Train"]) {
      const result = invoke(cwd, ["init", title, "--dir", "night"]);
      expect(result.code).toBe(2);
      expect(result.err).toContain("A story title must be a single line");
    }
    expect(fs.readdirSync(cwd)).toEqual([]);
    expect(invoke(cwd, ["init", "Night Train", "--dir", "night"]).code).toBe(0);
    const story = fs.readFileSync(path.join(cwd, "night", "story.md"), "utf8");
    expect(story).toContain("\n# Night Train\n");
    expect(story).not.toContain("Injected");
  });

  test("--force adds missing starter files and never overwrites existing ones", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Kept Work" });
    const statePath = path.join(root, "continuity", "state.md");
    const storyPath = path.join(root, "story.md");
    const timelinePath = path.join(root, "plot", "timeline.md");
    const characterIndexPath = path.join(root, "characters", "_index.md");
    fs.appendFileSync(statePath, "\nUser continuity notes.\n");
    fs.appendFileSync(storyPath, "\nUser synopsis notes.\n");
    fs.appendFileSync(timelinePath, "\nUser timeline.\n");
    fs.appendFileSync(characterIndexPath, "\nUser relationship map.\n");
    const before = [statePath, storyPath, timelinePath, characterIndexPath].map((file) => fs.readFileSync(file, "utf8"));
    fs.rmSync(path.join(root, "glossary", "_index.md"));

    const retry = invoke(cwd, ["init", "Kept Work"]);
    expect(retry.code).toBe(4);
    expect(retry.err).toContain("never overwritten");

    expect(invoke(cwd, ["init", "Kept Work", "--force"]).code).toBe(0);
    const after = [statePath, storyPath, timelinePath, characterIndexPath].map((file) => fs.readFileSync(file, "utf8"));
    expect(after).toEqual(before);
    expect(fs.existsSync(path.join(root, "glossary", "_index.md"))).toBe(true);
  });

  test("--force against an existing book does not add series backlinks it did not write", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Book One", bookNumber: 1 });
    createStoryProject({ cwd, title: "Loose" });
    expect(invoke(cwd, ["init", "Loose", "--follows", "book-one", "--force"]).code).toBe(0);
    expect(frontmatter(path.join(cwd, "book-one", "story.md")).precedes).toBeUndefined();
    expect(frontmatter(path.join(cwd, "loose", "story.md")).follows).toBeUndefined();
  });

  test("an inherited book-number skips numbers already used in the series", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Book One", series: "saga", bookNumber: 1 });
    createStoryProject({ cwd, title: "Book Two", follows: ["book-one"] });
    expect(frontmatter(path.join(cwd, "book-two", "story.md"))["book-number"]).toBe(2);
    createStoryProject({ cwd, title: "Book Zero", precedes: ["book-one"] });
    expect(frontmatter(path.join(cwd, "book-zero", "story.md"))["book-number"]).toBe(3);
    expect(buildSeries(path.join(cwd, "book-one"), scanProject).ok).toBe(true);
  });

  test("an inherited book-number counts numbered books beyond an unnumbered direct link", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Book One", series: "saga", bookNumber: 1 });
    createStoryProject({ cwd, title: "Book Two", follows: ["book-one"] });
    setFrontmatterLine(path.join(cwd, "book-two", "story.md"), /^book-number: 2\n/m, "");
    expect(frontmatter(path.join(cwd, "book-two", "story.md"))["book-number"]).toBeUndefined();
    createStoryProject({ cwd, title: "Book Three", follows: ["book-two"] });
    expect(frontmatter(path.join(cwd, "book-three", "story.md"))["book-number"]).toBe(2);
  });

  test("series reports duplicate book-number values", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "Book One", series: "saga", bookNumber: 1 });
    // init refuses a colliding --book-number, so the collision is hand-made.
    expect(() => createStoryProject({ cwd, title: "Book Two", follows: ["book-one"], bookNumber: 1 })).toThrow("Book number 1 is already used by book-one");
    createStoryProject({ cwd, title: "Book Two", follows: ["book-one"], bookNumber: 2 });
    const twoStory = path.join(cwd, "book-two", "story.md");
    fs.writeFileSync(twoStory, fs.readFileSync(twoStory, "utf8").replace("book-number: 2", "book-number: 1"), "utf8");
    const report = buildSeries(path.join(cwd, "book-one"), scanProject);
    expect(report.ok).toBe(false);
    expect(messages(report.errors).join("\n")).toContain("share book-number 1");
  });
});

describe("init and the project lock", () => {
  const savedWait = process.env.STORY_LOCK_WAIT_MS;
  afterEach(() => {
    if (savedWait === undefined) {
      delete process.env.STORY_LOCK_WAIT_MS;
    } else {
      process.env.STORY_LOCK_WAIT_MS = savedWait;
    }
  });

  function holdLock(dir) {
    const lock = `${otherLivePid()}\n${os.hostname()}\n${new Date().toISOString()}\n`;
    fs.writeFileSync(path.join(dir, LOCK_FILE), lock);
    process.env.STORY_LOCK_WAIT_MS = "0";
    return lock;
  }

  test("--force locks an existing folder that has no story.md yet (#601)", () => {
    const cwd = makeTempDir();
    const dir = path.join(cwd, "draft");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "notes.md"), "Notes.\n");
    const lock = holdLock(dir);
    const held = invoke(cwd, ["init", "Draft", "--dir", "draft", "--force"]);
    expect(held.code).toBe(4);
    expect(held.err).toContain("is modifying this project; nothing was changed");
    expect(fs.readdirSync(dir).sort()).toEqual([LOCK_FILE, "notes.md"]);
    // A dry run is planned without writing, so it takes no lock.
    expect(invoke(cwd, ["init", "Draft", "--dir", "draft", "--force", "--dry-run"]).code).toBe(0);
    expect(fs.readFileSync(path.join(dir, LOCK_FILE), "utf8")).toBe(lock);
    fs.rmSync(path.join(dir, LOCK_FILE));
    expect(invoke(cwd, ["init", "Draft", "--dir", "draft", "--force"]).code).toBe(0);
    expect(fs.existsSync(path.join(dir, "story.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, LOCK_FILE))).toBe(false);
  });

  test("a linked book's lock is held before anything is created, and its backlink keeps an edit saved meanwhile", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Book One"]).code).toBe(0);
    const one = path.join(cwd, "book-one");
    const story = path.join(one, "story.md");
    holdLock(one);
    const held = invoke(cwd, ["init", "Book Two", "--follows", "book-one"]);
    expect(held.code).toBe(4);
    expect(held.err).toContain("is modifying this project; nothing was changed");
    expect(fs.existsSync(path.join(cwd, "book-two"))).toBe(false);
    fs.rmSync(path.join(one, LOCK_FILE));

    const saved = `${fs.readFileSync(story, "utf8")}\nSaved meanwhile.\n`;
    const spy = whileWriting(story, () => fs.writeFileSync(story, saved));
    let result;
    try {
      result = invoke(cwd, ["init", "Book Two", "--follows", "book-one"]);
    } finally {
      spy.mockRestore();
    }
    expect(result.code).toBe(4);
    expect(result.err).toBe(`${story} changed on disk while story was adding the series backlink, so it was left as it is. The new book in ${path.join(cwd, "book-two")} was made without it: run the same story init with --force to add it\n`);
    expect(fs.readFileSync(story, "utf8")).toBe(saved);
    expect(fs.existsSync(path.join(one, LOCK_FILE))).toBe(false);
    // A plain rerun finds the new book; --force adds the backlink.
    expect(invoke(cwd, ["init", "Book Two", "--follows", "book-one"]).code).toBe(4);
    expect(invoke(cwd, ["init", "Book Two", "--follows", "book-one", "--force"]).code).toBe(0);
    expect(frontmatter(story).precedes).toEqual(["../book-two"]);
    expect(fs.readFileSync(story, "utf8")).toContain("Saved meanwhile.");
  });

  test("a linked book whose lock cannot be made is refused before anything is created", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Book One"]).code).toBe(0);
    const lockPath = path.join(cwd, "book-one", LOCK_FILE);
    const open = fs.openSync;
    const spy = spyOn(fs, "openSync").mockImplementation((file, flags, ...rest) => {
      if (file === lockPath && flags === "wx") {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return open(file, flags, ...rest);
    });
    let result;
    try {
      result = invoke(cwd, ["init", "Book Two", "--follows", "book-one"]);
    } finally {
      spy.mockRestore();
    }
    expect(result.code).toBe(4);
    expect(result.err).toBe(`Cannot add the series backlink to ${path.join(cwd, "book-one", "story.md")}: Cannot create the project lock ${LOCK_FILE} (permission denied), which keeps two story commands from changing the project at once; nothing was changed. Make the project folder writable and try again\n`);
    expect(fs.existsSync(path.join(cwd, "book-two"))).toBe(false);
  });
});

describe("add", () => {
  test("rejects unsupported faction, artifact, arc, and scene status", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Enum Checks" });
    expect(() => createEntity(root, { kind: "faction", name: "Bogus Guild", status: "nonsense" })).toThrow("Unsupported faction status");
    expect(() => createEntity(root, { kind: "artifact", name: "Bogus Blade", status: "nonsense" })).toThrow("Unsupported artifact status");
    expect(() => createEntity(root, { kind: "arc", name: "Bogus Arc", status: "wat" })).toThrow("Unsupported arc status");
    expect(() => createEntity(root, { kind: "scene", name: "Bogus Scene", status: "wat" })).toThrow("Unsupported scene status");
    createEntity(root, { kind: "faction", name: "Real Guild", status: "hidden" });
    expect(validateProject(root).ok).toBe(true);
  });

  test("promise and clue default to planted status when --planted is given", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Planted Defaults" });
    expect(invoke(cwd, ["add", "chapter", "One", "--number", "1", "--path", root]).code).toBe(0);
    expect(invoke(cwd, ["add", "promise", "The warning", "--planted", "chapter-01", "--path", root]).code).toBe(0);
    expect(invoke(cwd, ["add", "clue", "The torn page", "--planted", "chapter-01", "--payoff", "chapter-03", "--path", root]).code).toBe(0);
    expect(invoke(cwd, ["add", "promise", "Unplanted", "--path", root]).code).toBe(0);
    expect(invoke(cwd, ["add", "clue", "Overridden", "--planted", "chapter-01", "--status", "planned", "--path", root]).code).toBe(0);
    expect(frontmatter(path.join(root, "continuity", "promises", "the-warning.md")).status).toBe("planted");
    expect(frontmatter(path.join(root, "continuity", "clues", "the-torn-page.md")).status).toBe("planted");
    expect(frontmatter(path.join(root, "continuity", "promises", "unplanted.md")).status).toBe("planned");
    expect(frontmatter(path.join(root, "continuity", "clues", "overridden.md")).status).toBe("planned");
    // Planted in a chapter with no file yet is still a plan; a chapter that
    // has a file counts as written, even an outline, as chapter-01 is here.
    expect(frontmatter(path.join(root, "chapters", "chapter-01.md")).status).toBe("outline");
    expect(invoke(cwd, ["add", "promise", "Later", "--planted", "chapter-05", "--path", root]).code).toBe(0);
    expect(invoke(cwd, ["add", "clue", "Later clue", "--planted", "chapter-05", "--payoff", "chapter-06", "--path", root]).code).toBe(0);
    expect(frontmatter(path.join(root, "continuity", "promises", "later.md")).status).toBe("planned");
    expect(frontmatter(path.join(root, "continuity", "clues", "later-clue.md")).status).toBe("planned");
  });

  test("refuses a name with a line or paragraph separator and writes nothing", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Separators" });
    for (const name of ["Sera\u2028Voss", "Sera\u2029Voss"]) {
      const result = invoke(cwd, ["add", "character", name, "--path", root]);
      expect(result.code).toBe(2);
      expect(result.err).toContain("A character name must be a single line");
    }
    expect(fs.readdirSync(path.join(root, "characters"))).toEqual(["_index.md"]);
    createEntity(root, { kind: "character", name: "Sera Voss" });
    const renamed = invoke(cwd, ["rename", "character", "sera-voss", "Sera\u2028Storm", "--path", root]);
    expect(renamed.code).toBe(2);
    expect(renamed.err).toContain("A character name must be a single line");
    expect(fs.readdirSync(path.join(root, "characters")).sort()).toEqual(["_index.md", "sera-voss.md"]);
    expect(validateProject(root).ok).toBe(true);
  });

  test("a scene marked sequel: True validates as a boolean", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Booleans" });
    expect(invoke(cwd, ["add", "chapter", "One", "--path", root]).code).toBe(0);
    expect(invoke(cwd, ["add", "scene", "Arrival", "--path", root]).code).toBe(0);
    const scene = path.join(root, "scenes", "chapter-01-scene-01.md");
    setFrontmatterLine(scene, /^sequel: false$/m, "sequel: True");
    expect(frontmatter(scene).sequel).toBe(true);
    expect(messages(validateProject(root).errors)).toEqual([]);
  });
});

describe("build paragraphs", () => {
  test("whitespace-only blank lines and CRLF separate paragraphs", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Paragraphs" });
    const chapterPath = path.join(root, "chapters", "chapter-01.md");
    writeMarkdown(chapterPath, `
title: One
number: 1
status: draft
word-count: 0
`, "## Chapter Text\n\nFirst line.\n  \t\nSecond line.\n \n* * *\n\nThird line.");
    let epub = readArchiveText(buildBook(root, { format: "epub" }).outFile);
    expect(epub).toContain("<p>First line.</p>");
    expect(epub).toContain("<p>Second line.</p>");
    expect(epub).toContain("<p>* * *</p>");

    fs.writeFileSync(chapterPath, fs.readFileSync(chapterPath, "utf8").replace(/\n/g, "\r\n"), "utf8");
    epub = readArchiveText(buildBook(root, { format: "epub" }).outFile);
    expect(epub).toContain("<p>First line.</p>");
    expect(epub).toContain("<p>Second line.</p>");
    expect(epub).toContain("<p>Third line.</p>");
  });
});

describe("write containment", () => {
  test("does not create directories through a symlink that leaves the root", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Contained" });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: One
number: 1
status: draft
word-count: 0
`, "## Chapter Text\n\nText.");
    const outside = makeTempDir();
    fs.symlinkSync(outside, path.join(root, "dist"));
    expect(() => buildBook(root, { format: "epub", out: "dist/a/b/x.epub" })).toThrow("outside root");
    expect(fs.existsSync(path.join(outside, "a"))).toBe(false);
  });
});

describe("forced init containment", () => {
  test("refuses a preserved starter file behind a symlinked directory", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Linked Chapters" });
    const outside = makeTempDir();
    fs.copyFileSync(path.join(root, "chapters", "_index.md"), path.join(outside, "_index.md"));
    fs.rmSync(path.join(root, "chapters"), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, "chapters"), "dir");
    fs.writeFileSync(path.join(cwd, "m.md"), "# Chapter 1\n\nText.\n", "utf8");
    expect(() => importManuscript({ source: "m.md", title: "Linked Chapters", cwd, force: true })).toThrow("outside root");
    expect(fs.readdirSync(outside)).toEqual(["_index.md"]);
  });
});

describe("read containment", () => {
  test("reports continuity state read through a symlinked directory outside the root", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Read Contained" });
    const outside = makeTempDir();
    fs.copyFileSync(path.join(root, "continuity", "state.md"), path.join(outside, "state.md"));
    fs.rmSync(path.join(root, "continuity"), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, "continuity"), "dir");
    expect(messages(scanProject(root).fileErrors).join("\n")).toContain("continuity/state.md: Refusing to access project path outside root");
  });

  test("refuses writes through a dangling symlinked directory", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Dangling" });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: One
number: 1
status: draft
word-count: 0
`, "## Chapter Text\n\nText.");
    fs.symlinkSync(path.join(cwd, "missing-target"), path.join(root, "dist"));
    expect(() => buildBook(root, { format: "epub", out: "dist/a/x.epub" })).toThrow("outside root");
    expect(fs.existsSync(path.join(cwd, "missing-target"))).toBe(false);
  });
});

describe("validation minimums", () => {
  test("rejects negative target-words, word-count, and current-chapter", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Minimums" });
    setFrontmatterLine(path.join(root, "story.md"), /^title:/m, "target-words: 0\ntitle:");
    setFrontmatterLine(path.join(root, "continuity", "state.md"), /^current-chapter: 0$/m, "current-chapter: -1");
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: One
number: 1
status: draft
word-count: -4
`, "## Chapter Text\n\nText.");
    const errors = messages(validateProject(root).errors).join("\n");
    expect(errors).toContain("target-words must be at least 1");
    expect(errors).toContain("current-chapter must be at least 0");
    expect(errors).toContain("word-count must be at least 0");
  });
});

describe("init and import --force on an existing project (#125, #153)", () => {
  test("new registries take the story id from the kept story.md", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "The Lamp at Gull Rock" });
    fs.rmSync(path.join(root, "style-sheet.md"));
    fs.rmSync(path.join(root, "continuity", "clues", "_index.md"));

    const again = createStoryProject({ cwd, title: "Lamp", dir: "the-lamp-at-gull-rock", force: true });

    expect(again.storyId).toBe("the-lamp-at-gull-rock");
    expect(fs.readFileSync(path.join(root, "continuity", "clues", "_index.md"), "utf8")).toContain("story: the-lamp-at-gull-rock");
    expect(messages(validateProject(root).errors)).toEqual([]);
  });

  test("init --force names the options a kept story.md did not take", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Alpha"]);

    const run = invoke(cwd, ["init", "New Name", "--dir", "alpha", "--force", "--genre", "horror", "--form", "novel"]);

    expect(run.code).toBe(0);
    expect(run.out).toContain("Updated story project:");
    expect(run.out).not.toContain("Created");
    expect(run.err).toContain("story.md already exists and was kept, so the title, --genre and --form were not applied");
    expect(run.err).toContain("Edit story.md to change them. [kept-story-options]\n");
    expect(fs.readFileSync(path.join(cwd, "alpha", "story.md"), "utf8")).toContain("title: Alpha");
  });

  test("init --force with matching options stays quiet", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Alpha"]);
    const run = invoke(cwd, ["init", "Alpha", "--force"]);
    expect(run.err).toBe("");
  });
});

describe("portable folder names (#204)", () => {
  test.each(["con.txt", "COM1.book", "book.", "book ", "bo:ok", "a<b", "q?", "star*"])("refuses --dir %p", (dir) => {
    const cwd = makeTempDir();
    expect(() => createStoryProject({ cwd, title: "Book", dir })).toThrow("Windows");
    expect(fs.existsSync(path.join(cwd, dir))).toBe(false);
  });

  test("accepts an ordinary dotted folder name", () => {
    const cwd = makeTempDir();
    expect(createStoryProject({ cwd, title: "Book", dir: "book.v2" }).storyId).toBe("book");
  });
});

describe("reference handling in add and init", () => {
  test("#68 add refuses a resolved or status chapter that is not written yet", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One" });
    expect(() => createEntity(root, { kind: "question", name: "Who", introduced: "chapter-01", resolved: "chapter-05" })).toThrow("--resolved chapter-05 is not written yet");
    expect(() => createEntity(root, { kind: "question", name: "Why", introduced: "chapter-04", status: "dropped" })).toThrow("--introduced chapter-04 is not written yet");
    expect(() => createEntity(root, { kind: "promise", name: "P", planted: "chapter-01", payoff: "chapter-05", status: "paid-off" })).toThrow("--payoff chapter-05 is not written yet");
    expect(() => createEntity(root, { kind: "clue", name: "C", planted: "chapter-05", status: "planted" })).toThrow("--planted chapter-05 is not written yet");
    expect(fs.readdirSync(path.join(root, "continuity", "questions"))).toEqual(["_index.md"]);
    createEntity(root, { kind: "question", name: "When", introduced: "chapter-01", resolved: "chapter-01" });
    createEntity(root, { kind: "promise", name: "Q", planted: "chapter-01", payoff: "chapter-05" });
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });

  test("#100 add refuses several ids for one-id fields and merges singular and plural flags", () => {
    const root = newProject();
    createEntity(root, { kind: "location", name: "Port Kestrel" });
    createEntity(root, { kind: "location", name: "Salt Market" });
    createEntity(root, { kind: "chapter", name: "One" });
    expect(() => createEntity(root, { kind: "scene", name: "Docks", chapter: "chapter-01", location: ["port-kestrel", "salt-market"] })).toThrow("--location takes one id for a scene, got port-kestrel, salt-market");
    expect(() => createEntity(root, { kind: "artifact", name: "Key", location: ["port-kestrel", "salt-market"] })).toThrow("--location takes one id for an artifact");
    expect(() => createEntity(root, { kind: "location", name: "Keep", "controlled-by": ["ann", "bo"] })).toThrow("--controlled-by takes one id");
    // A singular flag keeps a comma, so a comma list is not an id.
    expect(() => createEntity(root, { kind: "artifact", name: "Key", location: "port-kestrel,salt-market" })).toThrow('--location "port-kestrel,salt-market" must be a kebab-case id');
    createEntity(root, { kind: "scene", name: "Docks", chapter: "chapter-01", location: ["port-kestrel"] });
    expect(read(root, "scenes", "chapter-01-scene-01.md")).toContain("location: port-kestrel\n");

    createEntity(root, { kind: "character", name: "Mara Quill" });
    createEntity(root, { kind: "character", name: "Ivo Pell" });
    createEntity(root, { kind: "chapter", name: "Mix", character: ["ivo-pell", "ivo-pell"], characters: "mara-quill", location: ["port-kestrel", "port-kestrel"] });
    const chapter = scanProject(root).chapters.find((entry) => entry.id === "chapter-02");
    expect(chapter.characters).toEqual(["mara-quill", "ivo-pell"]);
    expect(chapter.locations).toEqual(["port-kestrel"]);
    createEntity(root, { kind: "research", name: "R", risk: ["legal", "legal"], "used-in": ["chapter-01", "chapter-01"] });
    expect(read(root, "research", "r.md")).toContain("used-in:\n  - chapter-01\n");
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });

  test("#175 add refuses unpadded scheduled chapter ids, and links reports them", () => {
    const root = newProject();
    expect(() => createEntity(root, { kind: "clue", name: "Ledger", planted: "chapter-1" })).toThrow("--planted chapter-1: did you mean chapter-01?");
    expect(() => createEntity(root, { kind: "research", name: "R", "used-in": "chapter-003" })).toThrow("did you mean chapter-03?");
    createEntity(root, { kind: "promise", name: "P", payoff: "chapter-03" });
    edit(root, "continuity/promises/p.md", "payoff: chapter-03", "payoff: chapter-3");
    expect(messages(validateLinks(root).errors)).toContain("continuity/promises/p.md references missing chapter chapter-3");
  });

  test("#180 init and add refuse empty tense, pov, genre, and type", () => {
    const cwd = makeTempDir();
    for (const option of ["tense", "pov", "genre"]) {
      expect(() => createStoryProject({ cwd, title: "T", dir: option, [option]: "" })).toThrow(`--${option} cannot be empty`);
      expect(fs.existsSync(path.join(cwd, option))).toBe(false);
    }
    const root = newProject();
    expect(() => createEntity(root, { kind: "location", name: "L", type: "" })).toThrow("--type cannot be empty");
    expect(() => createEntity(root, { kind: "system", name: "S", type: " " })).toThrow("--type cannot be empty");
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
    editFile(tom, "relationships: []", "relationships:\n  - character: ellen-trewin\n    type: friend");
    const before = fs.readFileSync(tom, "utf8");
    renameEntity(one, { kind: "character", id: "ellen-trewin", name: "Ellen Hale" });
    expect(fs.readFileSync(tom, "utf8")).toBe(before);
  });
});

describe("add warns about references to missing entities (#186)", () => {
  test("each unknown id is named, with the skipped backlink", () => {
    const root = initProject();
    createEntity(root, { kind: "location", name: "Gull Harbour" });
    const character = invoke(root, ["add", "character", "Ilse", "--location", "gul-harbour", "--arc", "redemption"]);
    expect(character.code).toBe(0);
    expect(character.err).toBe("warning: location gul-harbour (locations) does not exist, so no backlink was written; story links reports it until you add it [unknown-reference]\n");
    expect(invoke(root, ["add", "location", "X", "--character", "ghost-id"]).err).toContain("character ghost-id (notable-characters) does not exist, so no backlink was written");
    expect(invoke(root, ["add", "faction", "F", "--member", "ghost"]).err).toContain("character ghost (members) does not exist; story links reports it");
    expect(invoke(root, ["add", "artifact", "A", "--owner", "ghost"]).err).toContain("character or faction ghost (owner) does not exist");
    // Existing ids and future chapters are quiet.
    expect(invoke(root, ["add", "character", "Ann", "--location", "gull-harbour"]).err).toBe("");
    expect(invoke(root, ["add", "promise", "Oath", "--planted", "chapter-09"]).err).toBe("");
  });
});

describe("init over an unreadable story.md", () => {
  test("--force keeps a story.md whose frontmatter does not parse", () => {
    const cwd = makeTempDir();
    const root = path.join(cwd, "broken");
    fs.mkdirSync(root);
    const broken = "---\ntitle: Broken\nnot yaml\n---\n\nNotes.\n";
    fs.writeFileSync(path.join(root, "story.md"), broken, "utf8");
    const result = createStoryProject({ cwd, title: "Broken", dir: "broken", force: true });
    expect(result.keptStory).toBe(true);
    expect(result.storyId).toBe("broken");
    expect(fs.readFileSync(path.join(root, "story.md"), "utf8")).toBe(broken);
    expect(fs.existsSync(path.join(root, "characters", "_index.md"))).toBe(true);
  });
});

describe("add, rename, and scan limits", () => {
  test("add finishes an interrupted add when the registry is missing", () => {
    const root = gapProject();
    const first = createEntity(root, { kind: "character", name: "Mara Quill" });
    fs.rmSync(path.join(root, "characters", "_index.md"));
    const second = createEntity(root, { kind: "character", name: "Mara Quill" });
    expect(second.resumed).toBe(true);
    expect(second.id).toBe(first.id);
    expect(fs.existsSync(path.join(root, "characters", "_index.md"))).toBe(true);
  });
});

describe("interrupted add (#202)", () => {
  test("rerunning an add whose backlink step failed finishes it", () => {
    if (CHMOD_IGNORED) {
      return;
    }
    const root = safetyProject();
    createEntity(root, { kind: "location", name: "Port Kestrel" });
    const location = path.join(root, "worldbuilding", "locations", "port-kestrel.md");
    readOnly(location, () => createEntity(root, { kind: "character", name: "Nia Holt", location: "port-kestrel" }));
    expect(fs.existsSync(path.join(root, "characters", "nia-holt.md"))).toBe(true);
    const rerun = invoke(root, ["add", "character", "Nia Holt", "--location", "port-kestrel"]);
    expect(rerun.out).toContain("Finished an interrupted add of character nia-holt");
    expect(messages(validateLinks(root).errors)).toEqual([]);
    // A finished add is listed in the registry, so adding it again is refused.
    expect(() => createEntity(root, { kind: "character", name: "Nia Holt", location: "port-kestrel" })).toThrow("characters/nia-holt.md already exists");
  });

  test("rerunning an unnumbered scene add does not create a second copy", () => {
    if (CHMOD_IGNORED) {
      return;
    }
    const root = safetyProject();
    createEntity(root, { kind: "character", name: "Nessa" });
    createEntity(root, { kind: "chapter", name: "One" });
    createEntity(root, { kind: "scene", name: "Opening", chapter: "chapter-01" });
    readOnly(path.join(root, "chapters", "chapter-01.md"), () => createEntity(root, { kind: "scene", name: "Extra Beat", chapter: "chapter-01", character: "nessa" }));
    expect(createEntity(root, { kind: "scene", name: "Extra Beat", chapter: "chapter-01", character: "nessa" })).toMatchObject({ id: "chapter-01-scene-02", resumed: true });
    expect(listDir(root, "scenes")).toEqual(["_index.md", "chapter-01-scene-01.md", "chapter-01-scene-02.md"]);
    expect(scanProject(root).chapters[0].characters).toContain("nessa");
    // Once finished, the same add is a new scene again.
    expect(createEntity(root, { kind: "scene", name: "Extra Beat", chapter: "chapter-01", character: "nessa" }).id).toBe("chapter-01-scene-03");
  });
});

describe("argument checking", () => {
  test("add names a missing or unknown kind", () => {
    const root = sweepProject();
    expect(invoke(path.dirname(root), ["add", "--path", root]).err).toContain("An entity kind is required: expected one of character");
    expect(invoke(path.dirname(root), ["add", "character=Foo", "--path", root]).err).toContain("Unsupported entity kind: character=Foo");
  });
});

describe("entity commands", () => {
  test("add question --resolved records an answered question", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Three", number: 3 });
    createEntity(root, { kind: "question", name: "Who", introduced: "chapter-01", resolved: "chapter-03" });
    expect(scanProject(root).questions[0].status).toBe("answered");
    expect(messages(checkProjectContinuity(root).errors)).toEqual([]);
    expect(() => createEntity(root, { kind: "question", name: "Why", resolved: "chapter-03", status: "open" })).toThrow("cannot have status open");
  });

  test("add chapter and scene --pov put the POV character in the cast", () => {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, pov: "mara" });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-01", pov: "mara" });
    const project = scanProject(root);
    expect(project.chapters[0].characters).toEqual(["mara"]);
    expect(project.scenes[0].characters).toEqual(["mara"]);
    expect(messages(checkProjectContinuity(root).warnings).join("\n")).not.toContain("is not listed in characters");
  });

  test("init takes the story id from --dir when the title has no ASCII letters", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Война и мир", dir: "war-and-peace" });
    expect(created.storyId).toBe("war-and-peace");
    createEntity(created.root, { kind: "chapter", name: "One", number: 1 });
    const built = buildBook(created.root, { format: "epub" });
    expect(path.basename(built.outFile)).toBe("war-and-peace.epub");
    expect(messages(validateProject(created.root).errors)).toEqual([]);
  });
});

describe("sweep fixes", () => {
  test("init refuses a story id Windows reserves", () => {
    const cwd = makeTempDir();
    expect(() => createStoryProject({ cwd, title: "Con" })).toThrow("Windows reserves the file name con");
    expect(() => createStoryProject({ cwd, title: "Fine Title", dir: "AUX" })).toThrow("Cannot use folder AUX: Windows reserves that name");
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  test("add scene lists its location and cast on the chapter", () => {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "character", name: "Theo" });
    createEntity(root, { kind: "location", name: "Harbor" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, mention: "theo" });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-01", location: "harbor", character: ["mara", "theo"] });
    const chapter = scanProject(root).chapters[0];
    expect(chapter.locations).toEqual(["harbor"]);
    expect(chapter.characters).toEqual(["mara"]);
    expect(messages(checkProjectContinuity(root).warnings).join("\n")).not.toContain("does not list");
  });

  test("add scene copies only existing characters and locations onto the chapter", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-01", character: "nobody", location: "nowhere" });
    const chapter = scanProject(root).chapters[0];
    expect(chapter.characters).toEqual([]);
    expect(chapter.locations).toEqual([]);
  });

  test("add scene refuses a chapter that does not exist", () => {
    const root = sweepProject();
    expect(() => createEntity(root, { kind: "scene", name: "Dock" })).toThrow("No chapters yet");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    expect(() => createEntity(root, { kind: "scene", name: "Dock", chapter: "chapter-99" })).toThrow("chapter chapter-99 does not exist");
  });

  test("add rejects reference ids that can never resolve", () => {
    const root = sweepProject();
    expect(() => createEntity(root, { kind: "clue", name: "C", planted: "Chapter 1" })).toThrow('--planted "Chapter 1" must be a kebab-case id (such as chapter-01)');
    expect(() => createEntity(root, { kind: "character", name: "Mara", location: "Port Town" })).toThrow('--location "Port Town" must be a kebab-case id');
    expect(() => createEntity(root, { kind: "chapter", name: "One", pov: "Mara Quill" })).toThrow('--pov "Mara Quill" must be a character id');
    expect(() => createEntity(root, { kind: "chapter", name: "One", arc: "Main Arc" })).toThrow('--arc "Main Arc" must be a kebab-case id (such as the-long-road)');
    // A character's --arc is a free-text arc theme.
    expect(createEntity(root, { kind: "character", name: "Old Bram", arc: "Found Family" }).id).toBe("old-bram");
  });
});

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { importManuscript } from "../src/import.js";
import { chapterFindings } from "../src/prose.js";
import { splitSentences } from "../src/sentences.js";
import { splitOpenSpeech } from "../src/voices.js";
import { compareProject, createEntity, createStoryProject, renameEntity, scanProject, validateProject } from "../src/story.js";
import { makeTempDir, writeMarkdown, messages } from "./helpers.js";

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
}

function newProject(title = "Gap Story") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

function writeStory(root, update) {
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, update(fs.readFileSync(storyPath, "utf8")), "utf8");
}

// Runs fn with PATH pointing only at `dir`, so git is whatever lives there.
function withPath(dir, fn) {
  const saved = process.env.PATH;
  process.env.PATH = dir;
  try {
    return fn();
  } finally {
    process.env.PATH = saved;
  }
}

describe("sentence and speech edge cases", () => {
  test("a stammer across an ellipsis does not end the sentence", () => {
    expect(splitSentences("I… I don’t know. Fine.")).toEqual(["I… I don’t know.", "Fine."]);
    expect(splitSentences("We... we should go. Now.")).toEqual(["We... we should go.", "Now."]);
  });

  test("a straight single quote opening a paragraph opens speech", () => {
    expect(splitOpenSpeech("'Come here and wait")).toEqual({ narration: "", open: "Come here and wait" });
  });
});

describe("prose findings", () => {
  test("a spread too close to the threshold to round below it prints in full", () => {
    const findings = chapterFindings("Chapter 1", {
      variants: [],
      narrationWords: 0,
      filterWords: [],
      adverbs: [],
      bookisms: [],
      sentences: { count: 50, spread: 4.9999999 }
    });
    expect(messages(findings)).toEqual(["Chapter 1 sentence lengths are uniform (spread 4.9999999 words over 50 sentences); vary the rhythm"]);
  });
});

describe("import edge cases", () => {
  test("a document with a Chapter Text heading but no frontmatter is split as plain markdown", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), "# Chapter 1: Arrival\n\nOutline notes.\n\n## Chapter Text\n\nThe ship came in at dawn.\n", "utf8");
    const result = importManuscript({ source: "book.md", title: "No Frontmatter", cwd });
    const [first] = scanProject(result.root).chapters;
    expect(first.title).toBe("Arrival");
    // Not read as a Story Skills chapter, so the outline stays in the prose.
    expect(fs.readFileSync(first.file, "utf8")).toContain("Outline notes.");
  });

  test("a list item over a dash line is not a setext chapter heading", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.md"), [
      "# Chapter 1: Lists",
      "",
      "Before the list.",
      "",
      "- Chapter Two",
      "---",
      "",
      "After the list."
    ].join("\n"), "utf8");
    const result = importManuscript({ source: "book.md", title: "List Book", cwd });
    expect(result.chapters).toBe(1);
    expect(scanProject(result.root).chapters.map((chapter) => chapter.title)).toEqual(["Lists"]);
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

describe("compare --ref git failures", () => {
  test("reports git missing from PATH", () => {
    const root = newProject();
    const empty = makeTempDir();
    expect(() => withPath(empty, () => compareProject(root, { ref: "HEAD" }))).toThrow("compare --ref needs git, which was not found on PATH");
  });

  // The fake git is a shell script, which Windows cannot run from PATH.
  test.skipIf(process.platform === "win32")("reports the first line of an unexpected git error", () => {
    const root = newProject();
    const bin = makeTempDir();
    const fake = path.join(bin, "git");
    fs.writeFileSync(fake, "#!/bin/sh\necho 'fatal: something odd happened' >&2\necho 'second line' >&2\nexit 128\n", "utf8");
    fs.chmodSync(fake, 0o755);
    expect(() => withPath(bin, () => compareProject(root, { ref: "HEAD" }))).toThrow("compare --ref could not run git: fatal: something odd happened");
  });

  test("warns when story.md is missing at the ref", () => {
    const repo = makeTempDir();
    const root = path.join(repo, "book");
    createStoryProject({ cwd: repo, title: "Late Story", dir: root });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nFirst words.\n");
    git(repo, "init", "-q");
    git(repo, "add", "-A");
    git(repo, "reset", "-q", "--", "book/story.md");
    git(repo, "commit", "-qm", "chapters first");
    git(repo, "tag", "early");
    const result = compareProject(root, { ref: "early" });
    expect(messages(result.warnings)).toContain("story.md does not exist at git ref early: the project may not have existed then");
  });
});

describe("add, rename, and scan limits", () => {
  test("add finishes an interrupted add when the registry is missing", () => {
    const root = newProject();
    const first = createEntity(root, { kind: "character", name: "Mara Quill" });
    fs.rmSync(path.join(root, "characters", "_index.md"));
    const second = createEntity(root, { kind: "character", name: "Mara Quill" });
    expect(second.resumed).toBe(true);
    expect(second.id).toBe(first.id);
    expect(fs.existsSync(path.join(root, "characters", "_index.md"))).toBe(true);
  });

  test("rename refuses when a project file's frontmatter does not parse", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara Quill" });
    fs.writeFileSync(path.join(root, "continuity", "exemptions.md"), "---\nnot yaml\n---\n", "utf8");
    expect(() => renameEntity(root, { kind: "character", id: "mara-quill", name: "Mara Vell" })).toThrow(/continuity[\\/]exemptions\.md: .*; nothing was changed/);
  });

  test("scanning refuses more markdown files than the limit", () => {
    const root = newProject();
    const nested = path.join(root, "characters", "extra");
    fs.mkdirSync(nested);
    for (let index = 0; index <= 5000; index += 1) {
      fs.writeFileSync(path.join(nested, `note-${index}.md`), "", "utf8");
    }
    expect(() => validateProject(root)).toThrow("Too many markdown files in the project: the scan exceeds the 5000 file limit");
  });
});

describe("story.md validation", () => {
  test("an older schema-version is reported", () => {
    const root = newProject();
    writeStory(root, (text) => text.replace(/schema-version: \d+/, "schema-version: 1"));
    expect(messages(validateProject(root).errors)).toContain("story.md schema-version must be 2");
  });

  test("a cover that is a directory is not a file", () => {
    const root = newProject();
    fs.mkdirSync(path.join(root, "cover.png"));
    writeStory(root, (text) => text.replace(/^---\n/, "---\ncover: cover.png\n"));
    expect(messages(validateProject(root).errors)).toContain("story.md cover cover.png is not a file");
  });
});

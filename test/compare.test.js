import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { compareChapters, formatComparison, proseParagraphs } from "../src/compare.js";
import { compareProject, createStoryProject } from "../src/story.js";
import { git, makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function writeChapter(root, number, body, title = `Chapter ${number}`) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: ${title}\nnumber: ${number}\nstatus: draft`, `## Chapter Text\n\n${body}\n`);
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// A repository holding the project in book/, with draft-1 tagged before the
// revision below.
function gitProject({ subdir = "book" } = {}) {
  const repo = makeTempDir();
  const root = subdir ? path.join(repo, subdir) : repo;
  createStoryProject({ cwd: repo, title: "Compare Story", dir: root, force: Boolean(!subdir) });
  writeChapter(root, 1, "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
  writeChapter(root, 2, "Cut me.");
  fs.writeFileSync(path.join(root, "chapters", "chapter-03.md"), "Old prose with no frontmatter.\n", "utf8");
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "draft one");
  git(repo, "tag", "draft-1");

  writeChapter(root, 1, "First paragraph.\n\nSecond paragraph, revised and longer.\n\nThird paragraph.", "Chapter One");
  fs.rmSync(path.join(root, "chapters", "chapter-02.md"));
  writeChapter(root, 3, "Old prose with no frontmatter.");
  writeChapter(root, 4, "A new ending.");
  return { repo, root };
}

function chapter(id, title, paragraphs) {
  return { id, title, words: paragraphs.join(" ").split(/\s+/).filter(Boolean).length, paragraphs };
}

describe("story compare", () => {
  test("compares with a git ref when the project is in a subdirectory", () => {
    const { root } = gitProject();
    const result = compareProject(root, { ref: "draft-1" });

    expect(result.label).toBe("git ref draft-1");
    expect(result.beforeChapters).toBe(3);
    expect(result.afterChapters).toBe(3);
    expect(result.chapters.map((chapter) => [chapter.id, chapter.status])).toEqual([
      ["chapter-01", "changed"],
      ["chapter-02", "removed"],
      ["chapter-03", "unchanged"],
      ["chapter-04", "added"]
    ]);
    expect(result.chapters[0]).toMatchObject({ title: "Chapter One", before: 6, after: 9 });
    expect(result.chapters[0].unchanged).toBeCloseTo(2 / 3);
    expect(result.chapters[2].title).toBe("Chapter 3");
  });

  test("compares with a git ref when the project is the repository root", () => {
    const { root } = gitProject({ subdir: "" });
    expect(compareProject(root, { ref: "HEAD" }).chapters.find((chapter) => chapter.id === "chapter-04").status).toBe("added");
  });

  test("compares with another copy of the project", () => {
    const { root } = gitProject();
    const copy = path.join(makeTempDir(), "copy");
    fs.cpSync(root, copy, { recursive: true });
    writeChapter(copy, 4, "A different ending entirely.");
    const result = invoke(path.dirname(copy), ["compare", "--path", root, "--against", "copy"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain(`Compared with ${copy}`);
    expect(result.out).toContain("- chapter-04 Chapter 4: 4 -> 3 words (-1), 0% of paragraphs unchanged");
    expect(result.out).toContain("- chapter-01 Chapter One: unchanged (9 words)");
  });

  test("the CLI prints the git comparison", () => {
    const { root, repo } = gitProject();
    const result = invoke(repo, ["compare", root, "--ref", "draft-1"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("Chapters: 3 then, 3 now (1 added, 1 removed)");
    expect(result.out).toContain("- chapter-01 Chapter One: 6 -> 9 words (+3), 67% of paragraphs unchanged");
    expect(result.out).toContain("- chapter-02 Chapter 2: removed (was 2 words)");
    expect(result.out).toContain("- chapter-04 Chapter 4: added (3 words)");
    expect(result.err).toContain("Comparison complete: 0 errors");
  });

  test("rejects missing or doubled sources, bad refs, non-repositories, and unreadable copies", () => {
    const { root } = gitProject();
    expect(() => compareProject(root, {})).toThrow("compare needs exactly one of --ref <git-ref>, --against <project-path>, or --snapshot <name>");
    expect(() => compareProject(root, { ref: "HEAD", against: "x" })).toThrow("exactly one");
    expect(() => compareProject(root, { ref: "--output=x" })).toThrow("Unsupported git ref: --output=x");
    expect(() => compareProject(root, { ref: "no-such-tag" })).toThrow("Unknown git ref: no-such-tag");

    const plain = makeTempDir();
    createStoryProject({ cwd: plain, title: "Plain", force: false });
    expect(() => compareProject(path.join(plain, "plain"), { ref: "HEAD" })).toThrow("compare --ref needs the project inside a git repository");

    const broken = path.join(makeTempDir(), "broken");
    fs.cpSync(root, broken, { recursive: true });
    fs.writeFileSync(path.join(broken, "chapters", "chapter-09.md"), "no frontmatter", "utf8");
    expect(() => compareProject(root, { against: broken })).toThrow(`Cannot read ${broken}: chapters/chapter-09.md`);
  });
});

describe("compareChapters", () => {
  const chapter = (id, prose, title = id) => ({ id, title, words: prose.split(/\s+/).filter(Boolean).length, paragraphs: proseParagraphs(prose) });

  test("counts repeated paragraphs once each and treats empty chapters as unchanged", () => {
    const result = compareChapters(
      [chapter("chapter-01", "Same.\n\nSame."), chapter("chapter-02", "")],
      [chapter("chapter-01", "Same.\n\nSame.\n\nSame."), chapter("chapter-02", "")]
    );
    expect(result.chapters[0]).toMatchObject({ status: "changed" });
    expect(result.chapters[0].unchanged).toBeCloseTo(2 / 3);
    expect(result.chapters[1]).toMatchObject({ status: "unchanged", unchanged: 1 });
  });

  test("an emptied chapter is fully changed and paragraphs dropped from the end still count as a change", () => {
    const emptied = compareChapters([chapter("chapter-01", "Gone.")], [chapter("chapter-01", "")]);
    expect(emptied.chapters[0]).toMatchObject({ status: "changed", unchanged: 0 });

    const trimmed = compareChapters([chapter("chapter-01", "Keep.\n\nDrop.")], [chapter("chapter-01", "Keep.")]);
    expect(trimmed.chapters[0]).toMatchObject({ status: "changed", unchanged: 1 });
  });

  test("a scene-break line ends a paragraph, as builds read one", () => {
    expect(proseParagraphs("He left.\n* * *\nShe came.")).toEqual(["He left.", "She came."]);
    expect(proseParagraphs("One\n    ---\ntwo.")).toEqual(["One --- two."]);
  });

  test("orders chapter ids numerically and formats an empty comparison", () => {
    const result = compareChapters([chapter("chapter-10", "a")], [chapter("chapter-9", "b")]);
    expect(result.chapters.map((entry) => entry.id)).toEqual(["chapter-9", "chapter-10"]);
    expect(formatComparison(compareChapters([], []), "nothing")).toBe("Compared with nothing\nChapters: 0 then, 0 now (0 added, 0 removed)\nWords: 0 then, 0 now (±0)\n\n- No chapters in either version\n");
  });
});

function newProject(title = "Analysis", cwd = makeTempDir()) {
  return createStoryProject({ cwd, title }).root;
}

function writeChapterWith(root, number, body, extra = "") {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft${extra ? `\n${extra}` : ""}`, `## Chapter Text\n\n${body}\n`);
}

describe("compare (#73, #74, #216, #218)", () => {
  test("#73 a project folder missing at the ref is an error, not all-added", () => {
    const repo = makeTempDir();
    const root = path.join(repo, "book");
    createStoryProject({ cwd: repo, title: "Book", dir: root });
    writeChapterWith(root, 1, "Some prose.");
    git(repo, "init", "-q");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "v1");
    git(repo, "tag", "v1");
    git(repo, "mv", "book", "renamed book");
    git(repo, "commit", "-qm", "mv");
    const result = invoke(repo, ["compare", path.join(repo, "renamed book"), "--ref", "v1"]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("renamed book/ does not exist at git ref v1");
  });

  test("#73 branch names git accepts are compared, and a missing git is named", () => {
    const repo = makeTempDir();
    const root = newProject("Refs", repo);
    writeChapterWith(root, 1, "Some prose.");
    git(repo, "init", "-q");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "v1");
    git(repo, "branch", "brouillon-é");
    git(repo, "branch", "feature+x");
    for (const ref of ["brouillon-é", "feature+x"]) {
      const result = invoke(repo, ["compare", root, "--ref", ref]);
      expect(result.err).not.toContain("Unsupported git ref");
      expect(result.out).toContain(`Compared with git ref ${ref}`);
    }
    expect(invoke(repo, ["compare", root, "--ref", "-x"]).err).toContain("Unsupported git ref: -x");
    const missing = spawnSync(process.execPath, [path.resolve("bin/story.js"), "compare", root, "--ref", "HEAD"], { cwd: repo, encoding: "utf8", env: { ...process.env, PATH: "/nonexistent" } });
    expect(missing.stderr).toContain("git, which was not found on PATH");
  });

  test("#74 compare refuses when a current chapter fails to parse", () => {
    const cwd = makeTempDir();
    const before = newProject("Before", cwd);
    const after = newProject("After", cwd);
    for (const root of [before, after]) {
      writeChapterWith(root, 1, "One.");
      writeChapterWith(root, 2, "Two.");
    }
    const file = path.join(after, "chapters", "chapter-02.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("---\n", "---\ntitle: dup\ntitle: dup2\n"), "utf8");
    const result = invoke(cwd, ["compare", after, "--against", before]);
    expect(result.code).toBe(3);
    expect(result.out).not.toContain("removed");
    expect(result.err).toContain("Cannot compare");
  });

  test("#218 reordered paragraphs are changed and scene breaks never match", () => {
    const chapter = (paragraphs) => ({ id: "chapter-01", title: "One", words: 6, paragraphs });
    const reordered = compareChapters([chapter(["First.", "Second."])], [chapter(["Second.", "First."])]);
    expect(reordered.chapters[0].status).toBe("changed");

    const cwd = makeTempDir();
    const a = newProject("A", cwd);
    const b = newProject("B", cwd);
    writeChapterWith(a, 1, "Alpha one.\n\n* * *\n\nBeta two.\n\n* * *\n\nGamma three.");
    writeChapterWith(b, 1, "Delta four.\n\n* * *\n\nEpsilon five.\n\n* * *\n\nZeta six.");
    expect(invoke(cwd, ["compare", b, "--against", a]).out).toContain("0% of paragraphs unchanged");
  });

  test("#216 one changed paragraph in 200 is not 100% unchanged", () => {
    const text = formatComparison({ chapters: [{ id: "chapter-01", title: "One", status: "changed", before: 10, after: 10, unchanged: 199 / 200 }], beforeChapters: 1, afterChapters: 1, beforeWords: 10, afterWords: 10 }, "x");
    expect(text).toContain("99% of paragraphs unchanged");
  });
});

describe("#189 compare pairs chapters renumbered by move", () => {
  test("moved chapters are reported as moved and the inserted one as added", () => {
    const before = [
      chapter("chapter-01", "C1", ["Paragraph one of chapter 1.", "Another paragraph 1."]),
      chapter("chapter-02", "C2", ["Paragraph one of chapter 2.", "Another paragraph 2."]),
      chapter("chapter-03", "C3", ["Paragraph one of chapter 3.", "Another paragraph 3."])
    ];
    const after = [
      before[0],
      chapter("chapter-02", "New", []),
      { ...before[1], id: "chapter-03" },
      { ...before[2], id: "chapter-04", paragraphs: [...before[2].paragraphs, "A new closing line."] }
    ];
    const comparison = compareChapters(before, after);
    expect(comparison.chapters.map((entry) => [entry.id, entry.status, entry.movedFrom])).toEqual([
      ["chapter-01", "unchanged", undefined],
      ["chapter-02", "added", undefined],
      ["chapter-03", "unchanged", "chapter-02"],
      ["chapter-04", "changed", "chapter-03"]
    ]);
    const text = formatComparison(comparison, "git ref HEAD");
    expect(text).toContain("(1 added, 0 removed, 2 moved)");
    expect(text).toContain("- chapter-03 C2 (moved from chapter-02): unchanged");
    expect(text).toContain("- chapter-02 New: added");
  });

  test("a rewritten chapter under the same id still matches by id", () => {
    const comparison = compareChapters(
      [chapter("chapter-01", "A", ["Old one.", "Old two."])],
      [chapter("chapter-01", "A", ["New one.", "New two."])]
    );
    expect(comparison.chapters).toHaveLength(1);
    expect(comparison.chapters[0].status).toBe("changed");
    expect(comparison.chapters[0].movedFrom).toBeUndefined();
    expect(formatComparison(comparison, "x")).toContain("(0 added, 0 removed)\n");
  });
});

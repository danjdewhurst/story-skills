import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { formatLabelMapping, mapLabels } from "../src/compare.js";
import { openingWords, paragraphLabels, reviewHtml } from "../src/html.js";
import { buildBook, compareProject, createStoryProject } from "../src/story.js";
import { expectLinearTime, git, makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function writeChapter(root, number, body, extra = "") {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft\n${extra}`, `## Chapter Text\n\n${body}\n`);
}

const REEF = "Mara heard it through thirty feet of water, not as sound exactly, but as a dull knock.";
const LATER = "The bell knocked again, and this time the silt answered it.";

function project(dir = makeTempDir()) {
  const { root } = createStoryProject({ cwd: dir, title: "Label Story", dir: path.join(dir, "book") });
  writeChapter(root, 1, `The bell was ringing under the reef.\n\n${REEF}\n\n---\n\n${LATER}\n\nShe surfaced.`);
  writeChapter(root, 2, "Dock Six was quiet.");
  return root;
}

// The old text in `old/` and the revised text in `book/`, side by side.
function revisedPair() {
  const dir = makeTempDir();
  const old = path.join(dir, "old");
  const { root: oldRoot } = createStoryProject({ cwd: dir, title: "Label Story", dir: old });
  writeChapter(oldRoot, 1, `The bell was ringing under the reef.\n\n${REEF}\n\n---\n\n${LATER}\n\nShe surfaced.`);
  const root = project(dir);
  writeChapter(root, 1, `The bell was ringing under the reef.\n\nShe had been diving the reef for eleven years.\n\n${REEF}\n\n---\n\nThe bell knocked again, and this time the silt answered.`);
  return { dir, old: oldRoot, root };
}

describe("story compare --anchor", () => {
  test("maps unchanged, edited, deleted, and unknown labels against another copy", () => {
    const { dir, root } = revisedPair();
    const result = compareProject(root, { against: "old", cwd: dir, anchors: ["ch01-p2", "CH01-P3", "#ch01-p4", "ch09-p3"] });
    expect(result.anchors).toEqual([
      { label: "ch01-p2", status: "unchanged", to: "ch01-p3", similarity: 1 },
      { label: "ch01-p3", status: "edited", to: "ch01-p4", similarity: expect.any(Number) },
      { label: "ch01-p4", status: "not-found", excerpt: "She surfaced." },
      { label: "ch09-p3", status: "unknown" }
    ]);
    const text = formatLabelMapping(result.anchors, result.label);
    expect(text).toBe([
      "ch01-p2 -> ch01-p3 (text unchanged)",
      "ch01-p3 -> ch01-p4 (edited, 95% similar)",
      "ch01-p4: not found in the current text (\"She surfaced.\")",
      `ch09-p3: no such label in ${path.join(dir, "old")}`,
      ""
    ].join("\n"));
  });

  test("the CLI prints only the mapping and exits 0", () => {
    const { dir, root } = revisedPair();
    const result = invoke(dir, ["compare", root, "--against", "old", "--anchor", "ch01-p2", "--anchor", "ch07-p1"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe(`ch01-p2 -> ch01-p3 (text unchanged)\nch07-p1: no such label in ${path.join(dir, "old")}\n`);
    expect(result.out).not.toContain("Compared with");
    expect(invoke(dir, ["compare", root, "--anchor", "ch01-p2"]).err).toContain("exactly one of --ref");
    expect(invoke(dir, ["compare", root, "--against", "old", "--anchor", " "]).err).toContain("--anchor needs a paragraph label");
  });

  test("maps labels from a git ref without touching the repository", () => {
    const repo = makeTempDir();
    const root = project(repo);
    git(repo, "init", "-q");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "round one");
    git(repo, "tag", "beta-round-1");
    const before = git(repo, "status", "--porcelain");
    writeChapter(root, 1, `A new opening line.\n\nThe bell was ringing under the reef.\n\n${REEF}\n\n---\n\n${LATER}\n\nShe surfaced.`);

    const result = invoke(repo, ["compare", root, "--ref", "beta-round-1", "--anchor", "ch01-p3", "--anchor", "ch02-p1", "--anchor", "ch01-p9"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe([
      "ch01-p3 -> ch01-p4 (text unchanged)",
      "ch02-p1 -> ch02-p1 (text unchanged)",
      "ch01-p9: no such label in git ref beta-round-1",
      ""
    ].join("\n"));
    expect(before).toBe("");
    expect(git(repo, "status", "--porcelain")).toBe(" M book/chapters/chapter-01.md\n");
    expect(git(repo, "tag")).toBe("beta-round-1\n");
    expect(() => compareProject(root, { ref: "no-such-tag", anchors: ["ch01-p1"] })).toThrow("Unknown git ref: no-such-tag");
  });

  test("tree entries with a backslash or colon are skipped, never written outside the temp folder", () => {
    const repo = makeTempDir();
    const root = project(repo);
    fs.writeFileSync(path.join(root, "..\\escape.md"), "x\n");
    fs.writeFileSync(path.join(root, "c:odd.md"), "x\n");
    git(repo, "init", "-q");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "round one");
    const result = invoke(repo, ["compare", root, "--ref", "HEAD", "--anchor", "ch02-p1"]);
    expect(result.out).toBe("ch02-p1 -> ch02-p1 (text unchanged)\n");
  });

  test("a ref where the project folder has no story.md is an error naming the ref", () => {
    const repo = makeTempDir();
    fs.mkdirSync(path.join(repo, "book"));
    fs.writeFileSync(path.join(repo, "book", "notes.txt"), "early\n");
    git(repo, "init", "-q");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "before the book");
    git(repo, "tag", "early");
    fs.rmSync(path.join(repo, "book"), { recursive: true });
    const root = project(repo);
    expect(() => compareProject(root, { ref: "early", anchors: ["ch01-p1"] })).toThrow("No story project (story.md) in git ref early");
  });

  test("an unnumbered chapter's label maps by its title key", () => {
    const dir = makeTempDir();
    const { root: old } = createStoryProject({ cwd: dir, title: "Label Story", dir: path.join(dir, "old") });
    writeMarkdown(path.join(old, "chapters", "chapter-01.md"), "title: Prologue\nnumber: 1\nnumbered: false\nstatus: draft", "## Chapter Text\n\nThe storm came first.\n\nThen the bell.\n");
    writeChapter(old, 2, "Morning.");
    const root = path.join(dir, "book");
    fs.cpSync(old, root, { recursive: true });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Prologue\nnumber: 1\nnumbered: false\nstatus: draft", "## Chapter Text\n\nThe storm came first, black off the shelf.\n\nA gull.\n\nThen the bell.\n");
    const result = compareProject(root, { against: "old", cwd: dir, anchors: ["prologue-p2", "ch01-p1"] });
    expect(result.anchors.map((entry) => [entry.label, entry.status, entry.to])).toEqual([
      ["prologue-p2", "unchanged", "prologue-p3"],
      ["ch01-p1", "unchanged", "ch01-p1"]
    ]);
  });

  test("labels match the review copy's anchors exactly", () => {
    const { root } = revisedPair();
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    const anchors = [...html.matchAll(/<p id="([^"]+)">/g)].map((match) => match[1]);
    const book = { title: "T", authors: [], language: "en", parts: [{ key: "ch01", kind: "chapter", title: "One", heading: true, paragraphs: [{ html: "A", text: "A", quote: false }, null, { html: "B", text: "B", quote: false }] }] };
    expect(paragraphLabels(book)).toEqual([{ label: "ch01-p1", key: "ch01", text: "A" }, { label: "ch01-p2", key: "ch01", text: "B" }]);
    expect(anchors.filter((anchor) => anchor.startsWith("ch01"))).toEqual(["ch01-p1", "ch01-p2", "ch01-p3", "ch01-p4"]);
  });
});

describe("mapLabels", () => {
  const entry = (label, text) => ({ label, key: label.replace(/-p\d+$/, ""), text });

  test("a repeated paragraph maps to the nearest copy in the same part", () => {
    const previous = [entry("ch01-p1", "Yes."), entry("ch02-p1", "Intro."), entry("ch02-p2", "Yes.")];
    const current = [entry("ch01-p1", "Yes."), entry("ch02-p1", "New."), entry("ch02-p2", "Intro."), entry("ch02-p3", "Yes.")];
    expect(mapLabels(previous, current, ["ch02-p2", "ch01-p1"]).map((mapped) => mapped.to)).toEqual(["ch02-p3", "ch01-p1"]);
  });

  test("two copies of a paragraph never both claim the one that survived", () => {
    const previous = ["Yes.", "One.", "Two.", "Three.", "Yes."].map((text, index) => entry(`ch01-p${index + 1}`, text));
    const current = ["One.", "Two.", "Three.", "Yes."].map((text, index) => entry(`ch01-p${index + 1}`, text));
    expect(mapLabels(previous, current, ["ch01-p1", "ch01-p5"])).toEqual([
      { label: "ch01-p1", status: "not-found", excerpt: "Yes." },
      { label: "ch01-p5", status: "unchanged", to: "ch01-p4", similarity: 1 }
    ]);
  });

  test("an edit maps to the most similar paragraph, then the one in the same part", () => {
    const previous = [entry("ch01-p1", "The tide came in fast over the rocks.")];
    const best = [entry("ch02-p1", "The tide came in fast over the black rocks."), entry("ch01-p1", "The tide came in over the rocks.")];
    expect(mapLabels(previous, best, ["ch01-p1"])[0].to).toBe("ch02-p1");
    const tied = [entry("ch02-p1", "The tide came in fast over rocks."), entry("ch01-p1", "The tide came in fast over rocks.")];
    expect(mapLabels(previous, tied, ["ch01-p1"])[0].to).toBe("ch01-p1");
  });

  test("a punctuation-only edit reads as edited, never 100%", () => {
    const mapping = mapLabels([entry("ch01-p1", "Stop, she said.")], [entry("ch01-p1", "Stop! She said.")], ["ch01-p1"]);
    expect(mapping[0]).toMatchObject({ status: "edited", similarity: 1 });
    expect(formatLabelMapping(mapping, "x")).toBe("ch01-p1 -> ch01-p1 (edited, 99% similar)\n");
  });

  test("paragraphs without words match nothing but their own text", () => {
    const mapping = mapLabels([entry("ch01-p1", "…")], [entry("ch01-p1", "—")], ["ch01-p1"]);
    expect(mapping[0]).toEqual({ label: "ch01-p1", status: "not-found", excerpt: "…" });
  });

  test("opening words stop at six with an ellipsis", () => {
    expect(openingWords("She had been diving the reef for eleven years.")).toBe("She had been diving the reef…");
    expect(openingWords("  Short   one. ")).toBe("Short one.");
  });

  test("opening words skip runs with no letter, in linear time (#587)", () => {
    expect(openingWords("*_*_ ![ Hello there, said the *_ keeper of the light.")).toBe("*_*_ ![ Hello there, said the *_ keeper of…");
    expectLinearTime((text) => openingWords(text), (n) => "*_".repeat(n / 2));
    expectLinearTime((text) => openingWords(text), (n) => "![".repeat(n / 2));
  });
});

describe("build --format html --note-url", () => {
  const FORM = "https://github.com/me/book/issues/new?template=manuscript-note.yml";

  test("each label gets a prefilled note link; builds without it are unchanged", () => {
    const { root } = revisedPair();
    const plain = fs.readFileSync(buildBook(root, { format: "html", stamp: "beta 1" }).outFile, "utf8");
    const linked = fs.readFileSync(buildBook(root, { format: "html", stamp: "beta 1", noteUrl: FORM }).outFile, "utf8");
    expect(plain).not.toContain("note-link");
    expect(linked).toContain(`<a class="note-link" href="${FORM}&amp;title=%5Bch01-p2%5D%20&amp;anchor=ch01-p2&amp;build=beta%201&amp;quote=She%20had%20been%20diving%20the%20reef%E2%80%A6" title="Write a note on ch01-p2" target="_blank" rel="noopener">Note</a>She had been`);
    expect(linked).toContain(".note-link { position: absolute;");
    expect(linked).toContain("The Note link beside each label");
    // Removing the links and their rules gives back the plain build.
    const stripped = linked
      .replace(/<a class="note-link"[^>]*>Note<\/a>/g, "")
      .replace(/^.*note-link.*\n/gm, "")
      .replace(" The Note link beside each label opens a note with these filled in.", "");
    expect(stripped).toBe(plain);
  });

  test("a url without a query starts one; no stamp means no build field", () => {
    const book = { title: "T", authors: [], language: "ar", parts: [{ key: "ch01", kind: "chapter", title: "One", heading: true, paragraphs: [{ html: "<em>Hi</em> &amp; bye", text: "Hi & bye", quote: false }] }] };
    const html = reviewHtml(book, { noteUrl: "https://example.com/note" });
    expect(html).toContain(`href="https://example.com/note?title=%5Bch01-p1%5D%20&amp;anchor=ch01-p1&amp;quote=Hi%20%26%20bye"`);
    expect(html).toContain(`[dir="rtl"] .note-link { left: auto; right: -5.5rem; text-align: left; }`);
    expect(reviewHtml({ ...book, language: "en" }, { noteUrl: "https://example.com/note" })).not.toContain(`[dir="rtl"] .note-link`);
  });

  test("the prefill goes before a #fragment in the note url", () => {
    const book = { title: "T", authors: [], language: "en", parts: [{ key: "ch01", kind: "chapter", title: "One", heading: true, paragraphs: [{ html: "Hi", text: "Hi", quote: false }] }] };
    expect(reviewHtml(book, { noteUrl: "https://example.com/new?t=1#form" })).toContain(`href="https://example.com/new?t=1&amp;title=%5Bch01-p1%5D%20&amp;anchor=ch01-p1&amp;quote=Hi#form"`);
  });

  test("--note-url is refused with other formats or a non-web address", () => {
    const { dir, root } = revisedPair();
    expect(() => buildBook(root, { format: "epub", noteUrl: FORM })).toThrow("--note-url applies only to --format html");
    expect(() => buildBook(root, { format: "html", noteUrl: "javascript:alert(1)" })).toThrow("--note-url needs an http or https address");
    expect(() => buildBook(root, { format: "html", noteUrl: " " })).toThrow("--note-url needs an http or https address");
    const result = invoke(dir, ["build", root, "--format", "html", "--note-url", FORM]);
    expect(result.code).toBe(0);
    expect(fs.readFileSync(path.join(root, "dist", "label-story.html"), "utf8")).toContain("class=\"note-link\"");
  });

  test("the review-copy workflow links labels to the note form", () => {
    const workflow = fs.readFileSync(path.join(import.meta.dir, "..", "templates", "github", "review-copy.yml"), "utf8");
    expect(workflow).toContain("--note-url \"$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/issues/new?template=manuscript-note.yml\"");
  });
});

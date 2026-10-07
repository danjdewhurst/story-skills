import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { compareSimilarity, formatSimilarity, similarityOptions, tokenizeDocument } from "../src/similarity.js";
import { wordCount } from "../src/markdown.js";
import { createStoryProject, similarityReport, validateProject } from "../src/story.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { git, makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

const SHARED = "The lamp keeper counted the steps twice before he trusted the rail again";

function writeChapter(root, number, body, title = `Chapter ${number}`) {
  writeMarkdown(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), `title: ${title}\nnumber: ${number}\nstatus: draft`, `## Chapter Text\n\n${body}\n`);
}

function project(chapters = [`Fog came in off the water. ${SHARED}, and then he went down.\n\nNothing else happened that night.`]) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Similar Story", force: false });
  chapters.forEach((body, index) => writeChapter(root, index + 1, body));
  return { cwd, root };
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function doc(file, ...paragraphs) {
  return { file, paragraphs: paragraphs.map((text, index) => ({ label: `p${index + 1}`, text })) };
}

describe("similarity matching", () => {
  test("words are compared lowercased, without punctuation, with curly apostrophes folded", () => {
    const words = tokenizeDocument([{ label: "p1", text: "“Don’t,” she said. THE Tide—turning!" }]).map((entry) => entry.word);
    expect(words).toEqual(["don't", "she", "said", "the", "tide", "turning"]);
  });

  test("words are split as story wordcount splits them, with hyphens and soft hyphens folded", () => {
    const text = "A well-known well\u2011known hyphen\u00adation lamp keeper, בית־ספר, snake_case.";
    const words = tokenizeDocument([{ label: "p1", text }]).map((entry) => entry.word);
    expect(words).toEqual(["a", "well-known", "well-known", "hyphenation", "lamp", "keeper", "בית־ספר", "snake_case"]);
    expect(words).toHaveLength(wordCount(text));
  });

  test("Chinese and Japanese text is compared a character at a time", () => {
    const words = tokenizeDocument([{ label: "p1", text: "灯台守は、階段を数えた。" }]).map((entry) => entry.word);
    expect(words).toEqual(["灯", "台", "守", "は", "階", "段", "を", "数", "え", "た"]);
  });

  test("a shared run is reported once, at its full length, with both locations and the text as written", () => {
    const report = compareSimilarity(
      [doc("chapters/chapter-01.md", `Fog came in. ${SHARED}, and then he went down.`)],
      [doc("book-one.txt", "Something else entirely.", `She wrote: "the lamp keeper counted the steps twice, before he trusted the rail again."`)],
      { minWords: 8, label: "book-one.txt" }
    );
    expect(report.passages).toHaveLength(1);
    expect(report.passages[0]).toMatchObject({
      file: "chapters/chapter-01.md",
      from: "p1",
      to: "p1",
      words: 13,
      text: SHARED,
      reference: { file: "book-one.txt", from: "p2", to: "p2", text: "the lamp keeper counted the steps twice, before he trusted the rail again" }
    });
    expect(report.warnings[0].code).toBe("similarity-shared-passage");
    expect(report.warnings[0].message).toContain("chapters/chapter-01.md (p1) shares 13 words with book-one.txt (p2)");
  });

  test("a run shorter than --min-words is not reported, and one exactly that long is", () => {
    const chapter = doc("c.md", "one two three four five six seven eight nine");
    expect(compareSimilarity([chapter], [doc("r.txt", "zero two three four five six seven eight nine ten")], { minWords: 9, label: "r" }).passages).toEqual([]);
    const exact = compareSimilarity([chapter], [doc("r.txt", "zero two three four five six seven eight nine ten")], { minWords: 8, label: "r" });
    expect(exact.passages.map((passage) => passage.words)).toEqual([8]);
  });

  test("a phrase repeated many times in the reference is still matched, at its longest", () => {
    const refrain = "the bell rang out across the water at dusk";
    const reference = doc("r.txt", Array.from({ length: 40 }, () => refrain).join(". "));
    const report = compareSimilarity([doc("c.md", `Then ${refrain} again.`)], [reference], { minWords: 8, label: "r" });
    expect(report.passages.map((passage) => [passage.words, passage.text])).toEqual([[9, refrain]]);
  });

  test("a longer run that starts a word later, elsewhere in the reference, wins", () => {
    const greek = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron".split(" ");
    const report = compareSimilarity(
      [doc("c.md", greek.join(" "))],
      [doc("a.txt", `${greek.slice(0, 8).join(" ")} QQQ`), doc("b.txt", greek.slice(1).join(" "))],
      { minWords: 8, label: "r" }
    );
    expect(report.passages.map((passage) => [passage.from, passage.words, passage.reference.file])).toEqual([["p1", 14, "b.txt"]]);
  });

  test("the longest match is found however often its opening repeats in the reference", () => {
    const opening = "and then he said that it was over";
    const filler = Array.from({ length: 40 }, (_, index) => `${opening} filler${index}`).join(". ");
    const chapter = `${opening} when the lighthouse finally went dark`;
    const report = compareSimilarity([doc("c.md", chapter)], [doc("r.txt", `${filler}. ${chapter}.`)], { minWords: 8, label: "r" });
    expect(report.passages.map((passage) => passage.words)).toEqual([14]);
  });

  test("overlapping runs report each word once, the longest first", () => {
    const words = "one two three four five six seven eight nine ten eleven twelve".split(" ");
    const report = compareSimilarity(
      [doc("c.md", words.join(" "))],
      [doc("a.txt", words.slice(0, 10).join(" ")), doc("b.txt", `x ${words.slice(2).join(" ")}`)],
      { minWords: 5, label: "r" }
    );
    // b shares words 3-12 (10), a shares 1-10 (10): the tie goes to the
    // earlier start, and b keeps only its last two words, too few to report.
    expect(report.passages.map((passage) => [passage.text, passage.reference.file])).toEqual([[words.slice(0, 10).join(" "), "a.txt"]]);
    expect(report.sharedWords).toBe(10);
  });

  test("passages are listed in chapter order, whatever their length", () => {
    const short = "one two three four five six seven eight";
    const long = "nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen";
    const report = compareSimilarity([doc("c.md", `${short} gap ${long}`)], [doc("r.txt", `${long} and ${short}`)], { minWords: 8, label: "r" });
    expect(report.passages.map((passage) => passage.words)).toEqual([8, 10]);
  });

  test("highly repetitive text on both sides stays fast", () => {
    const the = Array.from({ length: 20000 }, () => "the").join(" ");
    const started = performance.now();
    const report = compareSimilarity([doc("c.md", the)], [doc("r.txt", the)], { minWords: 8, label: "r" });
    expect(report.passages.map((passage) => passage.words)).toEqual([20000]);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  test("a run across paragraphs names both labels and joins the text with a slash", () => {
    const report = compareSimilarity(
      [doc("c.md", "alpha beta gamma delta", "epsilon zeta eta theta iota")],
      [doc("r.txt", "alpha beta gamma delta epsilon zeta eta theta iota")],
      { minWords: 8, label: "r" }
    );
    expect(report.passages[0]).toMatchObject({ from: "p1", to: "p2", words: 9, text: "alpha beta gamma delta / epsilon zeta eta theta iota" });
    expect(report.warnings[0].message).toContain("(p1 to p2)");
  });

  test("the summary counts shared words per chapter and in total", () => {
    const report = compareSimilarity(
      [doc("a.md", `${SHARED}. Then more words that are only in the chapter.`), doc("b.md", "Nothing shared here at all.")],
      [doc("r.txt", SHARED)],
      { minWords: 8, label: "r.txt" }
    );
    expect(report.chapters).toEqual([
      { file: "a.md", title: "", words: 22, sharedWords: 13, passages: 1 },
      { file: "b.md", title: "", words: 5, sharedWords: 0, passages: 0 }
    ]);
    const text = formatSimilarity(report);
    expect(text).toContain("- a.md: 1 shared passage, 13 words (59%)");
    expect(text).toContain("- b.md: no shared passages");
    expect(text).toContain("Total: 13 of 27 words shared (48.1%)");
    expect(text).toContain("not proof of copying");
  });

  test("a tiny overlap in a long book shows as 0.1%, not 0%", () => {
    const report = { label: "r", minWords: 8, reference: { words: 10, files: 1 }, words: 20000, sharedWords: 8, chapters: [] };
    expect(formatSimilarity(report)).toContain("Total: 8 of 20,000 words shared (0.1%)");
  });

  test("--min-words takes a whole number of at least 5", () => {
    expect(similarityOptions({})).toEqual({ minWords: 8 });
    expect(similarityOptions({ "min-words": "12" })).toEqual({ minWords: 12 });
    for (const bad of ["4", "0", "8.5", "abc", "-8"]) {
      expect(() => similarityOptions({ "min-words": bad })).toThrow("--min-words must be a whole number 5 or more");
    }
  });
});

describe("story similarity", () => {
  test("--against a text file reports the shared passage with its review-copy label, and exits 0", () => {
    const { cwd, root } = project();
    fs.writeFileSync(path.join(cwd, "source.txt"), `Opening.\n\nAn old story: ${SHARED}.\n`);
    const result = invoke(root, ["similarity", "--against", "../source.txt"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Similarity against ../source.txt: 17 words in 1 file, runs of 8 or more shared words");
    expect(result.out).toContain("- chapters/chapter-01.md: 1 shared passage, 13 words");
    expect(result.err).toContain(`warning: chapters/chapter-01.md (ch01-p1) shares 13 words with ../source.txt (p2): "${SHARED}" [similarity-shared-passage]`);
  });

  test("--against a folder reads every .md, .markdown, and .txt file, skipping hidden files and markdown frontmatter", () => {
    const { cwd, root } = project();
    const refs = path.join(cwd, "refs");
    fs.mkdirSync(path.join(refs, "nested"), { recursive: true });
    fs.writeFileSync(path.join(refs, "a.md"), `---\ntitle: ${SHARED}\n---\n# Heading\n\nNothing shared.\n`);
    fs.writeFileSync(path.join(refs, "nested", "b.markdown"), `${SHARED}.\n`);
    fs.writeFileSync(path.join(refs, ".hidden.txt"), `${SHARED}.\n`);
    fs.writeFileSync(path.join(refs, "._b.md"), `${SHARED}.\n`);
    fs.writeFileSync(path.join(refs, "notes.pdf"), `${SHARED}.\n`);
    const report = similarityReport(root, { against: refs, cwd });
    expect(report.reference.files).toBe(2);
    expect(report.passages.map((passage) => passage.reference.file)).toEqual([path.relative(cwd, path.join(refs, "nested", "b.markdown")).split(path.sep).join("/")]);
  });

  test("--against another story project compares chapter with chapter, using that book's labels", () => {
    const { cwd, root } = project();
    const other = createStoryProject({ cwd, title: "Book One", dir: "book-one", force: false }).root;
    writeChapter(other, 1, "First.");
    writeChapter(other, 2, `Second chapter.\n\nAgain: ${SHARED}.`);
    const report = similarityReport(root, { against: "book-one", cwd });
    expect(report.passages).toHaveLength(1);
    expect(report.passages[0].reference).toMatchObject({ file: "book-one/chapters/chapter-02.md", from: "ch02-p2" });
  });

  test("--against a git ref compares with the project's chapters at that commit", () => {
    const { root } = project();
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "draft one");
    git(root, "tag", "draft-1");
    writeChapter(root, 1, `Rewritten opening. ${SHARED}, and the rest is new.`);
    const result = invoke(root, ["similarity", "--against", "draft-1", "--json"]);
    const envelope = JSON.parse(result.out);
    expect(validateAgainstSchema(envelope, schema)).toEqual([]);
    expect(result.code).toBe(0);
    expect(envelope.command).toBe("similarity");
    expect(envelope.data.label).toBe("git ref draft-1");
    expect(envelope.data.passages[0].reference.file).toBe("draft-1:chapters/chapter-01.md");
    expect(envelope.diagnostics[0]).toMatchObject({ code: "similarity-shared-passage", severity: "warning", file: "chapters/chapter-01.md" });
  });

  test("a git ref where the project folder or its story.md does not exist yet is an unusable project", () => {
    const repo = makeTempDir();
    fs.writeFileSync(path.join(repo, "README.md"), "Notes.\n");
    git(repo, "init", "-q");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "notes");
    git(repo, "tag", "before-book");
    fs.mkdirSync(path.join(repo, "book"));
    fs.writeFileSync(path.join(repo, "book", "ideas.md"), "Ideas.\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "ideas");
    git(repo, "tag", "ideas-only");
    const { root } = createStoryProject({ cwd: repo, title: "Late Book", dir: "book", force: true });
    writeChapter(root, 1, SHARED);

    const before = invoke(root, ["similarity", "--against", "before-book"]);
    expect(before.code).toBe(3);
    expect(before.err).toContain("book/ does not exist at git ref before-book");
    const ideas = invoke(root, ["similarity", "--against", "ideas-only"]);
    expect(ideas.code).toBe(3);
    expect(ideas.err).toContain("No story project (story.md) at git ref ideas-only");
  });

  test("a reference folder with more text files than the scan limit is refused", () => {
    const { cwd, root } = project();
    const many = path.join(cwd, "many");
    fs.mkdirSync(many);
    for (let index = 0; index <= 5000; index += 1) {
      fs.writeFileSync(path.join(many, `${index}.txt`), "x");
    }
    const result = invoke(root, ["similarity", "--against", "../many"]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("the reference exceeds the 5000 file limit");
  });

  test("--against a parent folder skips this project and reads another project in it chapter by chapter", () => {
    const { cwd, root } = project();
    const other = createStoryProject({ cwd, title: "Book One", dir: "book-one", force: false }).root;
    writeChapter(other, 1, `Again: ${SHARED}.`);
    fs.writeFileSync(path.join(cwd, "notes.txt"), "Nothing shared.");
    const report = similarityReport(root, { against: "..", cwd: root });
    expect(report.reference.files).toBe(2);
    expect(report.passages.map((passage) => [passage.reference.file, passage.reference.from])).toEqual([["../book-one/chapters/chapter-01.md", "ch01-p1"]]);
  });

  test("a symlink named by --against is followed, and shown as typed", () => {
    const { cwd, root } = project();
    fs.mkdirSync(path.join(cwd, "sources"));
    fs.writeFileSync(path.join(cwd, "sources", "a.txt"), SHARED);
    fs.symlinkSync(path.join(cwd, "sources"), path.join(cwd, "linked"));
    fs.symlinkSync(path.join(cwd, "sources", "a.txt"), path.join(cwd, "one.txt"));
    expect(similarityReport(root, { against: "../linked", cwd: root }).passages[0].reference.file).toBe("../linked/a.txt");
    expect(similarityReport(root, { against: "../one.txt", cwd: root }).passages[0].reference.file).toBe("../one.txt");
  });

  test("a reference project that cannot build is still compared, by paragraph number", () => {
    const { cwd, root } = project();
    const other = createStoryProject({ cwd, title: "Messy", dir: "messy", force: false }).root;
    writeMarkdown(path.join(other, "chapters", "chapter-01.md"), "title: One\nnumber: 3\nstatus: draft", `## Chapter Text\n\nFirst.\n\n${SHARED}.\n`);
    writeMarkdown(path.join(other, "chapters", "chapter-02.md"), "title: Two\nnumber: 3\nstatus: draft", "## Chapter Text\n\nSecond.\n");
    const report = similarityReport(root, { against: "messy", cwd });
    expect(report.passages[0].reference).toMatchObject({ file: "messy/chapters/chapter-01.md", from: "p2" });
  });

  test("a relative against in cli-defaults is read from the project folder", () => {
    const { cwd, root } = project();
    fs.writeFileSync(path.join(cwd, "source.txt"), SHARED);
    const storyFile = path.join(root, "story.md");
    fs.writeFileSync(storyFile, fs.readFileSync(storyFile, "utf8").replace(/^---\n/, "---\ncli-defaults:\n  - command: similarity\n    against: ../source.txt\n"));
    // Run from the parent folder: ../source.txt from there would not exist.
    const result = invoke(cwd, ["similarity", path.basename(root)]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("shares 13 words with source.txt (p1)");
    // On the command line it is read from the current directory.
    expect(invoke(cwd, ["similarity", path.basename(root), "--against", "source.txt"]).err).toContain("shares 13 words with source.txt");
  });

  test("the project's own chapters are never their own reference", () => {
    const { root } = project();
    expect(similarityReport(root, { against: "chapters", cwd: root }).passages).toEqual([]);
    expect(() => similarityReport(root, { against: ".", cwd: root })).toThrow("is this project");
  });

  test("a missing --against, or one that names nothing, is a usage error", () => {
    const { root } = project();
    expect(invoke(root, ["similarity"])).toMatchObject({ code: 2 });
    const unknown = invoke(root, ["similarity", "--against", "no-such-thing"]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("similarity --against no-such-thing is not a file or folder, and the project is not in a git repository, so it cannot be a git ref");
  });

  test("a git ref from a folder outside any repository is reported as a usage error", () => {
    const { root } = project();
    const result = invoke(root, ["similarity", "--against", "main"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("is not a file or folder, and the project is not in a git repository");
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "draft one");
    expect(invoke(root, ["similarity", "--against", "no-such-ref"]).err).toContain("is not a file or folder, and no git ref has that name");
  });

  test("reference text with no words warns", () => {
    const { cwd, root } = project();
    fs.mkdirSync(path.join(cwd, "empty"));
    const report = similarityReport(root, { against: "empty", cwd });
    expect(report.warnings.map((warning) => warning.code)).toEqual(["similarity-no-reference-text"]);
  });

  test("a project with no chapters compares nothing", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Empty Story", force: false });
    fs.writeFileSync(path.join(cwd, "source.txt"), SHARED);
    expect(similarityReport(root, { against: "source.txt", cwd })).toMatchObject({ words: 0, passages: [] });
  });

  test("a reference file that is not UTF-8 is refused", () => {
    const { cwd, root } = project();
    fs.writeFileSync(path.join(cwd, "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    const result = invoke(root, ["similarity", "--against", "../latin1.txt"]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("is not valid UTF-8");
  });

  test("story.md cli-defaults set --min-words, validate checks it, and severity can promote the warning", () => {
    const { cwd, root } = project();
    fs.writeFileSync(path.join(cwd, "source.txt"), SHARED);
    const storyFile = path.join(root, "story.md");
    const original = fs.readFileSync(storyFile, "utf8");
    const withConfig = (yaml) => fs.writeFileSync(storyFile, original.replace(/^---\n/, `---\n${yaml}\n`));

    withConfig("cli-defaults:\n  - command: similarity\n    min-words: 20");
    expect(invoke(root, ["similarity", "--against", "../source.txt"]).err).toContain("0 warnings");
    // A flag on the command line wins over the default.
    expect(invoke(root, ["similarity", "--against", "../source.txt", "--min-words", "8"]).err).toContain("1 warnings");

    withConfig("cli-defaults:\n  - command: similarity\n    min-words: 3");
    expect(validateProject(root).errors.map((error) => error.message).join("\n")).toContain("cli-defaults[0]: --min-words must be a whole number 5 or more");

    withConfig("severity:\n  - warning: similarity-shared-passage\n    level: error");
    const promoted = invoke(root, ["similarity", "--against", "../source.txt"]);
    expect(promoted.code).toBe(1);
    expect(promoted.err).toContain("error: chapters/chapter-01.md (ch01-p1) shares 13 words");
  });

  test("stays fast on a 150,000-word manuscript against 300,000 words of reference", () => {
    // A seeded generator, so the text and the result are the same every run.
    // mulberry32
    let seed = 20260928;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const vocabulary = Array.from({ length: 5000 }, (_, index) => `w${index.toString(36)}`);
    const words = (count) => Array.from({ length: count }, () => vocabulary[Math.floor(random() * vocabulary.length)]);
    const paragraphs = (list, size = 100) => {
      const out = [];
      for (let at = 0; at < list.length; at += size) {
        out.push({ label: `p${out.length + 1}`, text: list.slice(at, at + size).join(" ") });
      }
      return out;
    };
    const planted = words(30);
    const chapters = Array.from({ length: 30 }, (_, index) => {
      const text = words(5000);
      if (index === 17) {
        text.splice(2500, 30, ...planted);
      }
      return { file: `chapters/chapter-${index + 1}.md`, paragraphs: paragraphs(text) };
    });
    const references = Array.from({ length: 3 }, (_, index) => {
      const text = words(100000);
      if (index === 1) {
        text.splice(40000, 30, ...planted);
      }
      return { file: `book-${index + 1}.txt`, paragraphs: paragraphs(text) };
    });

    const started = performance.now();
    const report = compareSimilarity(chapters, references, { minWords: 8, label: "books" });
    const elapsed = performance.now() - started;

    expect(report.words).toBe(150000);
    expect(report.reference.words).toBe(300000);
    expect(report.passages.map((passage) => [passage.file, passage.words, passage.reference.file])).toEqual([["chapters/chapter-18.md", 30, "book-2.txt"]]);
    // The budget allows for a slow CI runner; locally this takes well under
    // a second.
    expect(elapsed).toBeLessThan(5000);
  });
});

import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { BASELINE_TOLERANCES, analyzeChapter, baselineFigures, baselineFindings, baselineProfile, contentWords, proseRules, sentenceLengths } from "../src/prose.js";
import { createStoryProject, proseReport, validateProject } from "../src/story.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

const VOCABULARY = ["harbour", "lantern", "rope", "gull", "tide", "keeper", "stair", "window", "salt", "boat", "shore", "bell", "net", "stone", "wind", "door"];

// `count` sentences of `length` words, `perParagraph` to a paragraph, with
// words drawn in turn from the vocabulary so the text is the same every run.
// `extra` is added to the end of every sentence (a filter word, an adverb).
function prose(count, length, { perParagraph = 4, extra = "", dialogue = false } = {}) {
  let next = 0;
  const sentences = [];
  for (let index = 0; index < count; index += 1) {
    const words = Array.from({ length }, () => VOCABULARY[next++ % VOCABULARY.length]);
    words[0] = words[0][0].toUpperCase() + words[0].slice(1);
    const sentence = `${words.join(" ")}${extra ? ` ${extra}` : ""}.`;
    sentences.push(dialogue && index % 2 === 0 ? `"${sentence}" she said.` : sentence);
  }
  const paragraphs = [];
  for (let index = 0; index < sentences.length; index += perParagraph) {
    paragraphs.push(sentences.slice(index, index + perParagraph).join(" "));
  }
  return paragraphs.join("\n\n");
}

function project({ samples, chapter, style = "" } = {}) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Baseline Story", force: false });
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", `## Chapter Text\n\n${chapter}\n`);
  fs.mkdirSync(path.join(root, "research"), { recursive: true });
  if (samples !== undefined) {
    fs.writeFileSync(path.join(root, "research", "samples.txt"), samples);
  }
  writeMarkdown(path.join(root, "style-sheet.md"), `type: style-sheet\ndialect: unspecified\n${samples === undefined ? "" : "samples:\n  - research/samples.txt\n"}${style}`, "# Style Sheet\n");
  return { cwd, root };
}

function invoke(cwd, argv, stdin) {
  const io = memoryIo(cwd);
  if (stdin !== undefined) {
    io.readStdin = () => Buffer.from(stdin);
  }
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

const codes = (report) => report.warnings.map((warning) => warning.code);

// The style-sample-duplicate messages of a prose or validate report.
const duplicateMessages = (report) => report.warnings.filter((warning) => warning.code === "style-sample-duplicate").map((warning) => warning.message);

// Rewrites the style sheet to list `entries` as samples, each quoted so
// trailing spaces stay in it.
function listSamples(root, entries) {
  writeMarkdown(path.join(root, "style-sheet.md"), `type: style-sheet\ndialect: unspecified\nsamples:\n${entries.map((entry) => `  - ${JSON.stringify(entry)}`).join("\n")}`, "# Style Sheet\n");
}

function profileOf(text) {
  const rules = proseRules({}, []);
  return baselineProfile([{ file: "s.txt", analysis: analyzeChapter(text, rules), sentenceLengths: sentenceLengths(text), contentWords: contentWords(text, rules) }]);
}

describe("prose baseline profile", () => {
  test("pools sentence and paragraph lengths, dialogue, rates, and signature words across samples", () => {
    const rules = proseRules({}, []);
    const texts = [prose(300, 8), prose(100, 12, { perParagraph: 2 })];
    const profile = baselineProfile(texts.map((text, index) => ({ file: `s${index}.txt`, analysis: analyzeChapter(text, rules), sentenceLengths: sentenceLengths(text), contentWords: contentWords(text, rules) })));
    expect(profile.samples).toEqual(["s0.txt", "s1.txt"]);
    expect(profile.words).toBe(300 * 8 + 100 * 12);
    expect(profile.sentences.count).toBe(400);
    expect(profile.sentences.mean).toBe((300 * 8 + 100 * 12) / 400);
    expect(profile.paragraphMean).toBe(3600 / (75 + 50));
    expect(profile.dialogueShare).toBe(0);
    expect(profile.usable).toBe(true);
    // Every vocabulary word of four letters or more; "net" is too short.
    expect(profile.signatureWords).toHaveLength(15);
    expect(profile.signatureWords).not.toContain("net");
    expect(BASELINE_TOLERANCES.signatureWords).toBeGreaterThanOrEqual(15);
  });

  test("too little sample narration is not usable, and nothing is compared", () => {
    const profile = profileOf(prose(20, 8));
    expect(profile.usable).toBe(false);
    const analysis = analyzeChapter(prose(100, 30), proseRules({}, []));
    expect(baselineFindings("c.md", analysis, baselineFigures(analysis, profile, []), profile)).toEqual([]);
  });

  test("each drift is reported with its direction, and a chapter inside every tolerance is not", () => {
    const rules = proseRules({}, []);
    const profile = profileOf(prose(400, 8));
    const check = (text) => {
      const analysis = analyzeChapter(text, rules);
      return baselineFindings("c.md", analysis, baselineFigures(analysis, profile, contentWords(text, rules)), profile);
    };
    expect(check(prose(60, 9))).toEqual([]);

    const long = check(prose(40, 14, { perParagraph: 2 }));
    expect(long.map((finding) => finding.code)).toEqual(["prose-baseline-sentences"]);
    expect(long[0].message).toBe("c.md sentences average 14.0 words, longer than your samples' 8.0 (tolerance 30%)");

    expect(check(prose(60, 8, { perParagraph: 12 })).map((finding) => finding.code)).toEqual(["prose-baseline-paragraphs"]);
    const talky = check(prose(80, 8, { dialogue: true }));
    expect(talky.map((finding) => finding.code)).toContain("prose-baseline-dialogue");
    expect(talky.find((finding) => finding.code === "prose-baseline-dialogue").message).toMatch(/is \d+\.\d% dialogue, more than your samples' 0\.0% \(tolerance 20 points\)$/);

    const filtered = check(prose(60, 7, { extra: "noticed" }));
    expect(filtered.map((finding) => finding.code)).toContain("prose-baseline-filter-words");
    expect(filtered.find((finding) => finding.code === "prose-baseline-filter-words").message).toContain("more than your samples' 0.0 (tolerance 3.0)");
  });

  test("an author who writes heavy adverbs is warned when a chapter has far fewer", () => {
    const rules = proseRules({}, []);
    const profile = profileOf(prose(400, 7, { extra: "slowly" }));
    const analysis = analyzeChapter(prose(60, 8), rules);
    const findings = baselineFindings("c.md", analysis, baselineFigures(analysis, profile, []), profile);
    expect(findings.map((finding) => finding.code)).toEqual(["prose-baseline-adverbs"]);
    expect(findings[0].message).toContain("fewer than your samples'");
  });
});

describe("story prose with samples", () => {
  test("samples replace the fixed filter-word and adverb limits", () => {
    // The author uses "slowly" in every sentence, which the fixed limit flags.
    const { root } = project({ samples: prose(400, 7, { extra: "slowly" }), chapter: prose(60, 7, { extra: "slowly" }) });
    const report = proseReport(root);
    expect(report.baseline.usable).toBe(true);
    expect(report.baseline.samples).toEqual(["research/samples.txt"]);
    expect(codes(report)).not.toContain("prose-adverbs");
    expect(codes(report).filter((code) => code.startsWith("prose-baseline"))).toEqual([]);
    expect(report.chapters[0].baseline).toMatchObject({ adverbsPerThousand: expect.any(Number), signatureWordsUsed: expect.any(Number) });

    // Without the baseline the fixed limit applies again.
    const off = proseReport(root, { baseline: "false" });
    expect(off.baseline).toBeNull();
    expect(codes(off)).toContain("prose-adverbs");
    expect(off.chapters[0].baseline).toBeUndefined();
  });

  test("too few sample words warns and keeps the fixed limits", () => {
    const { root } = project({ samples: prose(30, 7), chapter: prose(60, 7, { extra: "slowly" }) });
    const report = proseReport(root);
    expect(codes(report)).toContain("prose-baseline-small");
    expect(codes(report)).toContain("prose-adverbs");
    const text = invoke(root, ["prose"]).out;
    expect(text).toContain("Too few sample words to compare with");
  });

  test("the text report shows the baseline and each chapter against it", () => {
    const { root } = project({ samples: prose(400, 8), chapter: prose(40, 14) });
    const result = invoke(root, ["prose"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Baseline from 1 sample (3200 words): sentences 8.0 words (spread 0.0), paragraphs 32.0 words, 0.0% dialogue");
    expect(result.out).toContain("  Signature words: ");
    expect(result.out).toContain("  Against the baseline: paragraphs 56.0 words, 0.0% dialogue, signature words ");
    expect(result.err).toContain("warning: chapters/chapter-01.md sentences average 14.0 words, longer than your samples' 8.0 (tolerance 30%) [prose-baseline-sentences]");
  });

  test("--json includes the profile and each chapter's figures, and matches the schema", () => {
    const { root } = project({ samples: prose(400, 8), chapter: prose(40, 14) });
    const result = invoke(root, ["prose", "--json"]);
    const envelope = JSON.parse(result.out);
    expect(validateAgainstSchema(envelope, schema)).toEqual([]);
    expect(envelope.data.baseline).toMatchObject({ samples: ["research/samples.txt"], usable: true, sentences: { mean: 8 } });
    expect(envelope.data.chapters[0].baseline.sentenceMean).toBe(14);
    expect(envelope.diagnostics.map((entry) => entry.code)).toContain("prose-baseline-sentences");
    // Without samples the profile is null.
    const plain = project({ chapter: prose(40, 14) });
    expect(JSON.parse(invoke(plain.root, ["prose", "--json"]).out).data.baseline).toBeNull();
  });

  test("--baseline with no samples is a usage error", () => {
    const { root } = project({ chapter: prose(40, 8) });
    const result = invoke(root, ["prose", "--baseline"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("prose --baseline needs samples in style-sheet.md");
  });

  test("a sample folder can be another story project, read chapter by chapter", () => {
    const { cwd, root } = project({ chapter: prose(40, 14) });
    const other = createStoryProject({ cwd, title: "Book One", dir: "book-one", force: false }).root;
    writeMarkdown(path.join(other, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", `## Chapter Text\n\n${prose(400, 8)}\n`);
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\ndialect: unspecified\nsamples:\n  - ../book-one", "# Style Sheet\n");
    const report = proseReport(root);
    expect(report.baseline.samples).toEqual(["../book-one/chapters/chapter-01.md"]);
    expect(codes(report)).toContain("prose-baseline-sentences");
  });

  test("a missing sample is reported by prose and validate, and the rest are used", () => {
    const { root } = project({ samples: prose(400, 8), chapter: prose(40, 8) });
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\ndialect: unspecified\nsamples:\n  - research/samples.txt\n  - ../gone", "# Style Sheet\n");
    const report = proseReport(root);
    expect(report.baseline.samples).toEqual(["research/samples.txt"]);
    expect(report.warnings.find((warning) => warning.code === "style-sample-missing").message).toBe("style-sheet.md samples entry ../gone names no file or folder in reach of the project");
    const validation = validateProject(root);
    expect(validation.ok).toBe(true);
    expect(validation.warnings.map((warning) => warning.code)).toContain("style-sample-missing");
  });

  test("a sample listed twice, however it is spelled, counts once and warns (#523)", () => {
    const { root } = project({ samples: prose(400, 8), chapter: prose(40, 8) });
    listSamples(root, ["research/samples.txt", "./research/samples.txt", "research//samples.txt", "research/samples.txt  ", "../gone", "./../gone"]);
    const report = proseReport(root);
    expect(report.baseline.samples).toEqual(["research/samples.txt"]);
    expect(report.baseline.words).toBe(400 * 8);
    const duplicates = [
      "style-sheet.md samples entry ./research/samples.txt names the same file or folder as research/samples.txt, so story prose leaves it out: remove one of them",
      "style-sheet.md samples entry research//samples.txt names the same file or folder as research/samples.txt, so story prose leaves it out: remove one of them",
      "style-sheet.md samples entry research/samples.txt is already listed, so story prose leaves it out: remove one of them"
    ];
    expect(duplicateMessages(report)).toEqual(duplicates);
    // An entry that names nothing is missing each time, not a duplicate.
    expect(codes(report).filter((code) => code === "style-sample-missing")).toHaveLength(2);
    const validation = validateProject(root);
    expect(validation.ok).toBe(true);
    expect(duplicateMessages(validation)).toEqual(duplicates);
    expect(validateAgainstSchema(JSON.parse(invoke(root, ["prose", "--json"]).out), schema)).toEqual([]);
  });

  test("a sample file inside a listed folder counts once, in either order, without a warning", () => {
    const { root } = project({ samples: prose(400, 8), chapter: prose(40, 8) });
    fs.mkdirSync(path.join(root, "research", "sub"));
    fs.writeFileSync(path.join(root, "research", "sub", "more.txt"), prose(100, 8));
    for (const entries of [["research/samples.txt", "research"], ["research", "research/samples.txt"], ["research", "research/sub"], ["research/sub", "research"]]) {
      listSamples(root, entries);
      const report = proseReport(root);
      expect([...report.baseline.samples].sort()).toEqual(["research/samples.txt", "research/sub/more.txt"]);
      expect(report.baseline.words).toBe(500 * 8);
      expect(codes(report)).not.toContain("style-sample-duplicate");
      expect(validateProject(root).warnings.map((warning) => warning.code)).not.toContain("style-sample-duplicate");
    }
  });

  test.skipIf(process.platform === "win32")("a symlink listed beside the file or folder it points to is a duplicate", () => {
    const { cwd, root } = project({ samples: prose(400, 8), chapter: prose(40, 8) });
    fs.symlinkSync("samples.txt", path.join(root, "research", "link.txt"));
    fs.symlinkSync(path.join(root, "research"), path.join(cwd, "linked"));
    listSamples(root, ["research/samples.txt", "research/link.txt", "research", "../linked"]);
    const report = proseReport(root);
    expect(report.baseline.samples).toEqual(["research/samples.txt"]);
    expect(report.baseline.words).toBe(400 * 8);
    const duplicates = [
      "style-sheet.md samples entry research/link.txt names the same file or folder as research/samples.txt, so story prose leaves it out: remove one of them",
      "style-sheet.md samples entry ../linked names the same file or folder as research, so story prose leaves it out: remove one of them"
    ];
    expect(duplicateMessages(report)).toEqual(duplicates);
    expect(duplicateMessages(validateProject(root))).toEqual(duplicates);
  });

  test("an unreadable sample listed twice is unreadable once and a duplicate once", () => {
    const { root } = project({ samples: prose(400, 8), chapter: prose(40, 8) });
    fs.writeFileSync(path.join(root, "research", "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    listSamples(root, ["research/latin1.txt", "./research/latin1.txt", "research/samples.txt"]);
    const report = proseReport(root);
    expect(report.baseline.samples).toEqual(["research/samples.txt"]);
    expect(codes(report).filter((code) => code === "style-sample-unreadable")).toHaveLength(1);
    expect(duplicateMessages(report)).toEqual(["style-sheet.md samples entry ./research/latin1.txt names the same file or folder as research/latin1.txt, so story prose leaves it out: remove one of them"]);
  });

  test.skipIf(process.platform === "win32")("each spelling of a dangling symlink is unreadable, not a duplicate", () => {
    const { root } = project({ samples: prose(400, 8), chapter: prose(40, 8) });
    fs.symlinkSync("missing.txt", path.join(root, "research", "gone.txt"));
    listSamples(root, ["research/gone.txt", "./research/gone.txt", "research/samples.txt"]);
    const report = proseReport(root);
    expect(report.baseline.samples).toEqual(["research/samples.txt"]);
    expect(report.warnings.filter((warning) => warning.code === "style-sample-unreadable").map((warning) => warning.message.split(" cannot")[0])).toEqual([
      "style-sheet.md samples entry research/gone.txt",
      "style-sheet.md samples entry ./research/gone.txt"
    ]);
    expect(codes(report)).not.toContain("style-sample-duplicate");
    expect(validateProject(root).warnings.map((warning) => warning.code)).not.toContain("style-sample-duplicate");
  });

  test("an approved chapter listed twice is one sample and is still not compared with itself", () => {
    // Chapter one's sentences run far longer than the pooled samples', so
    // it would drift if it were compared with them.
    const { root } = project({ samples: prose(400, 8), chapter: prose(200, 20) });
    listSamples(root, ["research/samples.txt", "chapters/chapter-01.md", "./chapters//chapter-01.md"]);
    const report = proseReport(root);
    expect(report.baseline.samples).toEqual(["research/samples.txt", "chapters/chapter-01.md"]);
    expect(report.baseline.sentences.mean).toBe((400 * 8 + 200 * 20) / 600);
    expect(report.chapters[0].baseline.sentenceMean).toBe(20);
    expect(report.chapters[0].sample).toBe(true);
    expect(report.warnings.filter((warning) => warning.code.startsWith("prose-baseline-"))).toEqual([]);
    expect(codes(report)).toContain("style-sample-duplicate");
  });

  // Whether the temporary folder's disk finds a file under another case,
  // as macOS and Windows do by default and Linux does not.
  const caseInsensitive = (() => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "probe.txt"), "");
    return fs.existsSync(path.join(dir, "PROBE.TXT"));
  })();

  test.skipIf(!caseInsensitive)("on a case-insensitive disk, a sample named in another case counts once", () => {
    const { root } = project({ samples: prose(400, 8), chapter: prose(200, 20) });
    listSamples(root, ["RESEARCH/SAMPLES.TXT", "research/samples.txt", "Chapters/Chapter-01.md", "chapters/chapter-01.md"]);
    const report = proseReport(root);
    expect(report.baseline.words).toBe(400 * 8 + 200 * 20);
    expect(codes(report).filter((code) => code === "style-sample-duplicate")).toHaveLength(2);
    expect(validateProject(root).warnings.filter((warning) => warning.code === "style-sample-duplicate")).toHaveLength(2);
    // Chapter one, first named in another case, is still a sample, so it
    // is not compared with a profile it is part of.
    expect(report.chapters[0].sample).toBe(true);
    expect(report.warnings.filter((warning) => warning.code.startsWith("prose-baseline-"))).toEqual([]);
  });

  test("validate refuses samples that are not a list of relative paths", () => {
    const { root } = project({ chapter: prose(40, 8) });
    const withSamples = (yaml) => {
      writeMarkdown(path.join(root, "style-sheet.md"), `type: style-sheet\ndialect: unspecified\n${yaml}`, "# Style Sheet\n");
      return validateProject(root).errors.map((error) => error.message);
    };
    expect(withSamples("samples: ../book-one")).toContain("style-sheet.md frontmatter field samples must be a list");
    expect(withSamples("samples:\n  - /home/me/book")).toContain("style-sheet.md samples entry /home/me/book must be a path relative to the project folder, such as ../book-one");
    expect(withSamples("samples:\n  - \"C:/books/one\"")).toContain("style-sheet.md samples entry C:/books/one must be a path relative to the project folder, such as ../book-one");
  });

  test("a passage piped to prose - is compared with the project's samples", () => {
    const { root } = project({ samples: prose(400, 8), chapter: prose(40, 8) });
    const result = invoke(root, ["prose", "-", "--json"], prose(40, 14));
    const envelope = JSON.parse(result.out);
    expect(envelope.data.baseline.usable).toBe(true);
    expect(envelope.diagnostics.find((entry) => entry.code === "prose-baseline-sentences")).toMatchObject({ file: "stdin" });
  });

  test("cli-defaults can turn the baseline off for every run", () => {
    const { root } = project({ samples: prose(400, 8), chapter: prose(40, 14) });
    const storyFile = path.join(root, "story.md");
    fs.writeFileSync(storyFile, fs.readFileSync(storyFile, "utf8").replace(/^---\n/, "---\ncli-defaults:\n  - command: prose\n    baseline: false\n"));
    expect(invoke(root, ["prose"]).err).not.toContain("prose-baseline");
    expect(invoke(root, ["prose", "--baseline"]).err).toContain("[prose-baseline-sentences]");
  });

  test("a chapter that is nearly all dialogue is still compared on its dialogue share", () => {
    const rules = proseRules({}, []);
    const profile = profileOf(prose(400, 8));
    const text = Array.from({ length: 40 }, (_, index) => `"${VOCABULARY.slice(0, 8).join(" ")} ${index}."`).join("\n\n");
    const analysis = analyzeChapter(text, rules);
    expect(analysis.narrationWords).toBeLessThan(300);
    const findings = baselineFindings("c.md", analysis, baselineFigures(analysis, profile, []), profile);
    expect(findings.map((finding) => finding.code)).toContain("prose-baseline-dialogue");
    // Too little narration for the per-1,000 rates.
    expect(findings.map((finding) => finding.code)).not.toContain("prose-baseline-filter-words");
  });

  test("a folder of this project's chapters is never a sample", () => {
    const { cwd, root } = project({ chapter: prose(40, 14) });
    fs.mkdirSync(path.join(root, "chapters", "part-one"));
    const withSamples = (list) => writeMarkdown(path.join(root, "style-sheet.md"), `type: style-sheet\ndialect: unspecified\nsamples:\n${list.map((entry) => `  - "${entry}"`).join("\n")}`, "# Style Sheet\n");
    for (const entry of [".", "chapters", "./chapters/", "chapters/part-one"]) {
      withSamples([entry]);
      const report = proseReport(root);
      expect(report.baseline.samples).toEqual([]);
      expect(codes(report)).toContain("style-sample-own-chapters");
      expect(validateProject(root).warnings.map((warning) => warning.code)).toContain("style-sample-own-chapters");
    }
    // A parent folder holding this book and another reads only the other.
    const other = createStoryProject({ cwd, title: "Book One", dir: "book-one", force: false }).root;
    writeMarkdown(path.join(other, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", `## Chapter Text\n\n${prose(400, 8)}\n`);
    withSamples([".."]);
    expect(proseReport(root).baseline.samples).toEqual(["../book-one/chapters/chapter-01.md"]);
  });

  test("an approved chapter named on its own is a sample and is not compared with itself", () => {
    const { root } = project({ chapter: prose(400, 8) });
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Two\nnumber: 2\nstatus: draft", `## Chapter Text\n\n${prose(40, 14)}\n`);
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\ndialect: unspecified\nsamples:\n  - chapters/chapter-01.md", "# Style Sheet\n");
    expect(validateProject(root).warnings.map((warning) => warning.code)).not.toContain("style-sample-own-chapters");
    const report = proseReport(root);
    expect(report.baseline.samples).toEqual(["chapters/chapter-01.md"]);
    expect(report.baseline.usable).toBe(true);
    expect(codes(report)).not.toContain("style-sample-own-chapters");
    const [one, two] = report.chapters;
    expect(one.sample).toBe(true);
    expect(two.sample).toBeUndefined();
    // Chapter two, with longer sentences, drifts; chapter one is the measure.
    const drifts = report.warnings.filter((warning) => warning.code.startsWith("prose-baseline-"));
    expect(drifts.map((warning) => warning.file)).toContain("chapters/chapter-02.md");
    expect(drifts.map((warning) => warning.file)).not.toContain("chapters/chapter-01.md");
    expect(validateAgainstSchema(JSON.parse(invoke(root, ["prose", "--json"]).out), schema)).toEqual([]);
    const text = invoke(root, ["prose"]).out;
    expect(text).toContain("A sample: part of the baseline, so not compared with it");
  });

  test.skipIf(process.platform === "win32")("a symlink loop in chapters/ named as a sample is unreadable, not fatal", () => {
    const { root } = project({ chapter: prose(40, 14) });
    fs.symlinkSync("loop.md", path.join(root, "chapters", "loop.md"));
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\ndialect: unspecified\nsamples:\n  - chapters/loop.md", "# Style Sheet\n");
    expect(validateProject(root).warnings.map((warning) => warning.code)).not.toContain("style-sample-own-chapters");
    const report = proseReport(root);
    expect(codes(report)).toContain("style-sample-unreadable");
    expect(report.baseline.samples).toEqual([]);
  });

  test("a sample that cannot be read is reported and left out, and the run goes on", () => {
    const { root } = project({ samples: prose(400, 8), chapter: prose(40, 14) });
    fs.writeFileSync(path.join(root, "research", "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\ndialect: unspecified\nsamples:\n  - research/latin1.txt\n  - research/samples.txt\n  - /abs/path", "# Style Sheet\n");
    const result = invoke(root, ["prose"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("style-sheet.md samples entry research/latin1.txt cannot be read, so it is left out:");
    expect(result.err).toContain("[style-sample-unreadable]");
    expect(result.err).toContain("style-sheet.md samples entry /abs/path must be a path relative to the project folder, such as ../book-one, so it is left out");
    expect(proseReport(root).baseline.samples).toEqual(["research/samples.txt"]);
  });

  test("a registry _index.md in a sample folder is not prose", () => {
    const { cwd, root } = project({ chapter: prose(40, 8) });
    fs.mkdirSync(path.join(cwd, "drafts"));
    fs.writeFileSync(path.join(cwd, "drafts", "one.md"), prose(400, 8));
    fs.writeFileSync(path.join(cwd, "drafts", "_index.md"), "| Chapter | Title |\n|---|---|\n| 1 | One |\n");
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\ndialect: unspecified\nsamples:\n  - ../drafts", "# Style Sheet\n");
    expect(proseReport(root).baseline.samples).toEqual(["../drafts/one.md"]);
  });
});

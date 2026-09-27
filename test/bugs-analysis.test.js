import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { compareChapters, formatComparison } from "../src/compare.js";
import { formatClueMatrix } from "../src/clues.js";
import { narrationScript } from "../src/narration.js";
import { buildPacing, formatPacing } from "../src/pacing.js";
import { computeProgress, formatProgress } from "../src/progress.js";
import { analyzeChapter, chapterFindings, proseRules, similarNames } from "../src/prose.js";
import { splitSentences } from "../src/sentences.js";
import { buildVoices, quotedSpans } from "../src/voices.js";
import { createEntity, createStoryProject, projectProgress, proseReport, validateProject, voicesReport } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function newProject(title = "Analysis", cwd = makeTempDir()) {
  return createStoryProject({ cwd, title }).root;
}

function writeChapter(root, number, body, extra = "") {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft${extra ? `\n${extra}` : ""}`, `## Chapter Text\n\n${body}\n`);
}

function setStoryFields(root, fields) {
  const file = path.join(root, "story.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("tense: past\n", `tense: past\n${fields}\n`), "utf8");
}

function setStyleSheet(root, replace) {
  const file = path.join(root, "style-sheet.md");
  let text = fs.readFileSync(file, "utf8");
  for (const [from, to] of replace) {
    text = text.replace(from, to);
  }
  fs.writeFileSync(file, text, "utf8");
}

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
}

const rules = (style = {}, names = []) => proseRules(style, names);

describe("progress (#56, #72, #216, #220)", () => {
  test("#56 --log keeps extra fields and the text of untouched entries", () => {
    const root = newProject();
    writeChapter(root, 1, "One two three.");
    fs.writeFileSync(path.join(root, "progress.md"), "---\ntype: progress-log\nsessions:\n  - date: \"2026-09-01\"\n    words: 100\n    note: good day\n---\n\n# Log\n", "utf8");
    projectProgress(root, { log: true, date: "2026-09-02" });
    const log = fs.readFileSync(path.join(root, "progress.md"), "utf8");
    expect(log).toContain("  - date: \"2026-09-01\"\n    words: 100\n    note: good day\n");
    expect(log).toContain("  - date: 2026-09-02\n    words: 3\n");

    writeChapter(root, 1, "One two three four.");
    projectProgress(root, { log: true, date: "2026-09-01" });
    const replaced = fs.readFileSync(path.join(root, "progress.md"), "utf8");
    expect(replaced).toContain("note: good day");
    expect(replaced).toContain("words: 4");
    expect(validateProject(root).errors).toEqual([]);
  });

  test("#72 a padded --date is trimmed, so a second log replaces the first", () => {
    const root = newProject();
    writeChapter(root, 1, "One two three.");
    projectProgress(root, { log: true, date: " 2026-09-25" });
    projectProgress(root, { log: true, date: "2026-09-25" });
    const log = fs.readFileSync(path.join(root, "progress.md"), "utf8");
    expect(log.match(/date:/g)).toHaveLength(1);
    expect(log).not.toContain("\" 2026");
  });

  test("#72 validate catches a duplicate date hidden by padding", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, "progress.md"), "---\ntype: progress-log\nsessions:\n  - date: \" 2026-09-25\"\n    words: 1\n  - date: 2026-09-25\n    words: 2\n---\n", "utf8");
    expect(validateProject(root).errors.join("\n")).toContain("repeats date 2026-09-25");
  });

  test("#72 progress reports an invalid target-words or deadline", () => {
    const root = newProject();
    setStoryFields(root, "target-words: 90k\ndeadline: 2027-02-30");
    const result = invoke(path.dirname(root), ["progress", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("story.md frontmatter field target-words must be an integer");
    expect(result.err).toContain("story.md deadline");
  });

  test("#72 the deadline day asks for everything that is left", () => {
    const progress = computeProgress({ words: 993, target: 90000, deadline: "2026-09-20", today: "2026-09-20", chapters: [], sessions: [] });
    expect(formatProgress(progress)).toContain("Deadline: 2026-09-20 (today): 89,007 words needed");
    const done = computeProgress({ words: 90000, target: 90000, deadline: "2026-09-20", today: "2026-09-20", chapters: [], sessions: [] });
    expect(formatProgress(done)).toContain("Deadline: 2026-09-20 (today): 0 words needed");
  });

  test("#216 progress never rounds up to 100% and says 1 word", () => {
    const progress = computeProgress({ words: 624, target: 625, deadline: null, today: "2026-09-20", chapters: [{ id: "chapter-01", words: 624, target: 625 }], sessions: [] });
    const text = formatProgress(progress);
    expect(text).toContain("Remaining: 1 word\n");
    expect(text).toContain("- chapter-01: 624 of 625 words (99%)");
  });

  test("#220 a very slow pace projects nothing instead of crashing", () => {
    const sessions = [{ date: "2000-01-01", words: 0 }, { date: "2026-09-01", words: 976 }];
    const slow = computeProgress({ words: 976, target: 900000, deadline: null, today: "2026-09-02", chapters: [], sessions });
    expect(slow.projected).toBeNull();
    expect(formatProgress(slow)).not.toContain("Projected");
    const slower = computeProgress({ words: 5, target: 900000, deadline: null, today: "2026-09-02", chapters: [], sessions: [sessions[0], { date: "2026-09-01", words: 5 }] });
    expect(slower.projected).toBeNull();
    expect(() => formatProgress(slower)).not.toThrow();
  });
});

describe("compare (#73, #74, #216, #218)", () => {
  test("#73 a project folder missing at the ref is an error, not all-added", () => {
    const repo = makeTempDir();
    const root = path.join(repo, "book");
    createStoryProject({ cwd: repo, title: "Book", dir: root });
    writeChapter(root, 1, "Some prose.");
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
    writeChapter(root, 1, "Some prose.");
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
      writeChapter(root, 1, "One.");
      writeChapter(root, 2, "Two.");
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
    writeChapter(a, 1, "Alpha one.\n\n* * *\n\nBeta two.\n\n* * *\n\nGamma three.");
    writeChapter(b, 1, "Delta four.\n\n* * *\n\nEpsilon five.\n\n* * *\n\nZeta six.");
    expect(invoke(cwd, ["compare", b, "--against", a]).out).toContain("0% of paragraphs unchanged");
  });

  test("#216 one changed paragraph in 200 is not 100% unchanged", () => {
    const text = formatComparison({ chapters: [{ id: "chapter-01", title: "One", status: "changed", before: 10, after: 10, unchanged: 199 / 200 }], beforeChapters: 1, afterChapters: 1, beforeWords: 10, afterWords: 10 }, "x");
    expect(text).toContain("99% of paragraphs unchanged");
  });
});

describe("prose (#81, #126, #210, #211, #212, #213, #216)", () => {
  test("#81 honorifics are skipped when comparing first names", () => {
    expect(similarNames([{ id: "a", name: "Captain Mara Dole" }, { id: "b", name: "Captain Theo Quill" }, { id: "c", name: "Lord Ash" }, { id: "d", name: "Lord Wren" }])).toEqual([]);
  });

  test("#126 a preferred entry whose use equals avoid is skipped", () => {
    const analysis = analyzeChapter("The sky was grey.", rules({ preferred: [{ use: "grey", avoid: "Grey" }] }));
    expect(analysis.variants).toEqual([]);
  });

  test("#210 titles, initials, and stammers do not end sentences", () => {
    expect(analyzeChapter("Mr. Smith arrived. Dr. Jones left. Mrs. Brown stayed.", rules()).sentences.count).toBe(3);
    expect(splitSentences("J. R. Hale wrote to St. Mary at 9 a.m. Monday. The U.S. Navy answered.")).toHaveLength(2);
    expect(splitSentences("I… I don’t know what to say. She waited at 3 p.m. Then she left.")).toHaveLength(3);
  });

  test("#211 aliases, place names, and possessive names are not adverbs, echoes, or dialect spellings", () => {
    const cwd = makeTempDir();
    const root = newProject("E", cwd);
    createEntity(root, { kind: "character", name: "Katherine Moss" });
    const katherine = path.join(root, "characters", "katherine-moss.md");
    fs.writeFileSync(katherine, fs.readFileSync(katherine, "utf8").replace("aliases: []", "aliases:\n  - Kelly"), "utf8");
    createEntity(root, { kind: "character", name: "Maren" });
    createEntity(root, { kind: "location", name: "Sicily" });
    createEntity(root, { kind: "character", name: "Dorian Gray" });
    createEntity(root, { kind: "location", name: "Center Point" });
    setStyleSheet(root, [[/^dialect: .*$/m, "dialect: british"]]);
    writeChapter(root, 1, `${Array(25).fill("Kelly went back to Sicily and waited. Maren’s hand shook.").join(" ")}\n\nDorian Gray smiled. Gray walked from Center Point to the harbour. The gray sky.`);
    const report = proseReport(root);
    const analysis = report.chapters[0].analysis;
    expect(analysis.adverbs).toEqual([]);
    expect(analysis.echoes.map((entry) => entry.word)).not.toContain("kelly");
    expect(analysis.echoes.map((entry) => entry.word)).not.toContain("maren's");
    expect(analysis.echoes.map((entry) => entry.word)).not.toContain("sicily");
    expect(analysis.variants).toEqual([{ use: "grey", avoid: "gray", source: "british dialect", count: 1 }]);
  });

  test("#212 straight-apostrophe style entries match curly text", () => {
    const style = { preferred: [{ use: "OK", avoid: "o'clock" }], "watch-words": ["don't"], "allow-words": ["couldn't"] };
    const analysis = analyzeChapter("I don’t know. I don't. At ten o’clock she left.", rules(style));
    expect(analysis.watch).toEqual([{ word: "don't", count: 2 }]);
    expect(analysis.variants.map((entry) => entry.count)).toEqual([1]);
    const echoes = analyzeChapter(Array(25).fill("She couldn’t move. He wouldn’t stay.").join(" "), rules()).echoes;
    expect(echoes).toEqual([]);
    const mixed = analyzeChapter("I don't know what. I don’t know what.", rules());
    expect(mixed.phraseSentences[0]).toEqual(mixed.phraseSentences[1]);
  });

  test("#213 action beats are not dialogue tags", () => {
    const beats = analyzeChapter("\"We leave at dawn.\" She smiled.\n\n\"Fine.\" He sighed and sat down.\n\n\"No!\" Mara laughed.\n\n\"Go.\" He said nothing more.", rules());
    expect(beats.bookisms).toEqual([]);
    expect(beats.plainTags).toEqual([]);
    const tags = analyzeChapter("\"Yes,\" she smiled.\n\n\"Now?\" Mara asked.\n\n\"No!\" she laughed.", rules());
    expect(tags.bookisms).toEqual([{ word: "laughed", count: 1 }, { word: "smiled", count: 1 }]);
    expect(tags.plainTags).toEqual([{ word: "asked", count: 1 }]);
  });

  test("#216 a warning's figure sits on the warned side of its threshold", () => {
    const findings = chapterFindings("ch", {
      variants: [], narrationWords: 0, filterWords: [], adverbs: [], bookisms: [],
      sentences: { count: 20, mean: 5, longest: 12, spread: 4.975 }
    });
    expect(findings[0]).toContain("spread 4.97 words");
    const rate = chapterFindings("ch", {
      variants: [], narrationWords: 1000, filterWords: [{ word: "felt", count: 10.04 }], adverbs: [], bookisms: [],
      sentences: { count: 0, mean: 0, longest: 0, spread: 0 }
    });
    expect(rate[0]).toContain("has 10.04 filter words");
  });
});

describe("voices (#83, #210, #214, #215, #216, #217)", () => {
  const project = (names) => ({ characters: names.map((name) => ({ id: name.toLowerCase(), name, aliases: [], status: "alive" })) });

  test("#83 single quotes, dash dialogue, and possessives inside British quotes", () => {
    const report = buildVoices(project(["Bo", "Cy"]), [{
      id: "chapter-01",
      paragraphs: [
        "\"Double quoted line here,\" Bo said.",
        "'Single quoted line here,' Cy said.",
        "— Dash dialogue line here, said Cy.",
        "‘The dogs’ bowls are empty,’ Bo said."
      ]
    }]);
    const byId = Object.fromEntries(report.profiles.map((entry) => [entry.id, entry]));
    expect(byId.cy.lines).toBe(2);
    expect(byId.bo.words).toBe(4 + 5);
    expect(quotedSpans("‘The dogs’ bowls are empty,’ Bo said.")).toEqual(["The dogs’ bowls are empty,"]);
    expect(quotedSpans("She didn't say 'tis the season.")).toEqual([]);
  });

  test("#83 multi-paragraph speech goes to the tagged speaker", () => {
    const report = buildVoices(project(["Bo"]), [{
      id: "chapter-01",
      paragraphs: ["Bo said, \"The first part runs on.", "\"And the last part ends here.\""]
    }]);
    expect(report.profiles[0]).toMatchObject({ id: "bo", lines: 2 });
    const unknown = buildVoices(project(["Bo"]), [{ id: "chapter-01", paragraphs: ["\"Nobody tagged this.", "\"Or this.\""] }]);
    expect(unknown.unattributed).toBe(2);
  });

  test("#83 prose sees said-bookisms in single-quoted lines", () => {
    expect(analyzeChapter("'Stop that,' she snapped.", rules()).bookisms).toEqual([{ word: "snapped", count: 1 }]);
  });

  test("#210 voices sentences survive titles", () => {
    const report = buildVoices(project(["Mara"]), [{ id: "chapter-01", paragraphs: ["\"Mr. Reed is waiting. He's patient,\" Mara said."] }]);
    expect(report.profiles[0].sentenceLength).toBe(3);
  });

  test("#214 's contractions count, possessives do not", () => {
    const report = buildVoices(project(["Mara"]), [{ id: "chapter-01", paragraphs: ["\"It's late. That's fine. Let's go. He's here. Where's Tom?\" Mara said.", "\"Tom's boat,\" Mara said."] }]);
    expect(report.profiles[0].contractions).toBeCloseTo((5 * 100) / 12, 5);
  });

  test("#215 dialogue in closed code fences is ignored", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    writeChapter(root, 1, "\"Run it,\" Mara said.\n\n```\n$ echo \"Access denied, Mara said the system.\"\n> \"Retry?\" Mara asked.\n```");
    expect(voicesReport(root).profiles[0]).toMatchObject({ id: "mara", lines: 1, words: 2 });
  });

  test("#217 shares exactly 10 points apart are treated alike", () => {
    const lines = (name, questions) => Array.from({ length: 10 }, (_, index) => `"${index < questions ? "Where are we going now?" : "We are going home now."}" ${name} said.`);
    const report = buildVoices(project(["Anna", "Bert", "Cara"]), [{ id: "chapter-01", paragraphs: [...lines("Anna", 3), ...lines("Bert", 2), ...lines("Cara", 4)] }]);
    expect(report.warnings.filter((warning) => warning.includes("may sound alike") && warning.includes("anna"))).toEqual([]);
  });
});

describe("pacing and clues (#216, #217, #223)", () => {
  const chapter = (number, words) => ({ id: `chapter-${String(number).padStart(2, "0")}`, number, wordCount: words, hook: "x", status: "draft" });

  test("#217 the median is compared exactly", () => {
    const pacing = buildPacing({ chapters: [100, 100, 101, 202].map((words, index) => chapter(index + 1, words)), scenes: [] });
    expect(pacing.warnings.join("\n")).toContain("chapter-04 runs 202 words, over twice the median chapter");
  });

  test("#216 #223 pacing says 1 scene and keeps wide rows aligned", () => {
    const pacing = buildPacing({ chapters: [chapter(9, 5), chapter(100, 123456)], scenes: [{ id: "s", chapter: "chapter-09", scene: 1, sequel: true, outcome: "" }] });
    const text = formatPacing(pacing);
    expect(text).toContain("Pacing: 0 scenes, 1 sequel, 2 of 2 chapters with hooks");
    const rows = text.split("\n").filter((line) => /^\s*\d/.test(line));
    expect(rows[0].indexOf("x")).toBe(rows[1].indexOf("x"));
    expect(rows[0].length).toBe(rows[1].length);
  });

  test("#223 clue columns fit three-digit chapters", () => {
    const text = formatClueMatrix({
      totals: { clues: 1, redHerrings: 0, planted: 1, revealed: 1 },
      chapters: [9, 10, 20, 100].map((number) => ({ id: `chapter-${number}`, number })),
      rows: [{ id: "knife", status: "planted", redHerring: false, significanceDelayed: false, cells: [".", "P", ".", "R"] }]
    });
    expect(text).toContain("Clue     9  10  20 100\n");
    expect(text).toContain("knife    .   P   .   R  planted");
  });
});

describe("rounding and plurals elsewhere (#216)", () => {
  test("POV shares add up to 100", () => {
    const root = newProject();
    ["a", "b", "c"].forEach((pov, index) => writeChapter(root, index + 1, "word ".repeat(100), `pov: ${pov}`));
    const out = invoke(path.dirname(root), ["timeline", root]).out;
    const shares = [...out.matchAll(/words \((\d+)%\)/g)].map((match) => Number(match[1]));
    expect(shares).toHaveLength(3);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  test("narration section times add up to the runtime", () => {
    const chapters = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, title: `C${index + 1}`, body: "word ".repeat(217) }));
    const script = narrationScript({ title: "N", meta: { authors: [] }, front: [], chapters, back: [] }, []);
    const minutes = [...script.matchAll(/\[about (\d+) min\]/g)].reduce((sum, match) => sum + Number(match[1]), 0);
    expect(script).toContain("0h 14m");
    expect(minutes).toBe(14);
  });

  test("validate says a chapter has no word-count instead of declaring 0", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, "chapters", "chapter-01.md"), "---\ntitle: One\nnumber: 1\nstatus: draft\n---\n## Chapter Text\n\nOne two three.\n", "utf8");
    expect(validateProject(root).warnings).toContain("chapters/chapter-01.md has no word-count (contains 3)");
  });
});

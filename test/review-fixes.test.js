import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { validateAgainstSchema } from "../scripts/check-schema.js";
import { runCli } from "../src/cli.js";
import { printHtml } from "../src/html.js";
import {
  buildBook,
  checkProjectContinuity,
  createEntity,
  clueReport,
  createStoryProject,
  diagramProject,
  namesReport,
  pacingReport,
  projectPasses,
  renameEntity,
  validateProject,
  voicesReport
} from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function project(fields = "") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Fixes", force: false });
  if (fields !== "") {
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\n${fields}\n`), "utf8");
  }
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nWords.\n");
  return { root, cwd };
}

describe("review fixes", () => {
  test("an empty copyright scaffold does not suppress the generated copyright page", () => {
    const { root } = project("copyright: © 2026 Ada");
    createEntity(root, { kind: "matter", name: "Copyright" });
    const markdown = fs.readFileSync(buildBook(root).outFile, "utf8");
    expect(markdown).toContain("© 2026 Ada\n\nAll rights reserved.");
  });

  test("pass updates keep extra fields and refuse to rewrite a malformed list", () => {
    const { root } = project("revision-passes:\n  - pass: structure\n    status: pending\n    note: check act two");
    projectPasses(root, { done: "structure" });
    expect(fs.readFileSync(path.join(root, "story.md"), "utf8")).toContain("  - pass: structure\n    status: done\n    note: check act two");

    const broken = project("revision-passes:\n  - pass: Bad Name");
    expect(() => projectPasses(broken.root, { init: true })).toThrow("Fix revision-passes in story.md before changing it");
  });

  test("routes to undeclared places never join the travel graph", () => {
    const { root } = project();
    createEntity(root, { kind: "character", name: "Mara" });
    writeMarkdown(path.join(root, "worldbuilding", "locations", "harbor.md"), "name: Harbor\ntype: town\nroutes:\n  - to: typo\n    hours: 10", "# H\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "mill.md"), "name: Mill\ntype: mill\nroutes:\n  - to: typo\n    hours: 10", "# M\n");
    for (const [scene, location, time] of [[1, "harbor", "08:00"], [2, "mill", "09:00"]]) {
      writeMarkdown(path.join(root, "scenes", `chapter-01-scene-0${scene}.md`), `title: S${scene}\nchapter: chapter-01\nscene: ${scene}\nstatus: draft\nlocation: ${location}\ndate: 2024-05-01\ntime: "${time}"\ncharacters:\n  - mara`, "# S\n");
    }
    expect(checkProjectContinuity(root).errors).toEqual([]);
  });

  test("print css strings cannot close the style element", () => {
    const html = printHtml({ title: "T", authors: ["</style><script>x()</script> & co"], language: "en", words: 10, parts: [] });
    expect(html).not.toContain("</style><script>");
    expect(html).toContain('content: "\\3C /style\\3E \\3C script\\3E x()\\3C /script\\3E  \\26  co"');
  });

  test("diagram refuses to write from a partly unreadable project", () => {
    const { root, cwd } = project();
    writeMarkdown(path.join(root, "characters", "bad.md"), "name: Bad\n      - broken", "# Bad\n");
    expect(diagramProject(root, { kind: "relationships", out: "dist/rel.mmd" })).toMatchObject({ ok: false });
    expect(fs.existsSync(path.join(root, "dist", "rel.mmd"))).toBe(false);
    const result = invoke(cwd, ["diagram", "relationships", "--path", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Diagram failed");
  });

  test("names match case-sensitively, titles are skipped, and subject tags win", () => {
    const { root } = project();
    writeMarkdown(path.join(root, "characters", "lord-maren.md"), "name: Lord Maren\nrole: antagonist\nstatus: alive", "# L\n");
    writeMarkdown(path.join(root, "characters", "sera.md"), "name: Sera\nrole: protagonist\nstatus: alive\nvoice-avoid:\n  - don\u2019t", "# S\n");
    writeMarkdown(path.join(root, "characters", "kael.md"), "name: Kael\nrole: supporting\nstatus: alive", "# K\n");
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", [
      "## Chapter Text",
      "\u201cWe ride at dawn,\u201d she said, glancing toward the lord\u2019s hall.",
      "\u201cI wasn\u2019t there,\u201d Sera told Kael.",
      "\u2018I don't know,\u2019 Maren said.",
      "\u2018Don\u2019t,\u2019 said Kael."
    ].join("\n\n") + "\n");
    const report = voicesReport(root);
    expect(report.unattributed).toBe(1);
    expect(report.profiles.map((entry) => [entry.id, entry.lines]).sort()).toEqual([["kael", 1], ["lord-maren", 1], ["sera", 1]]);
    expect(report.warnings).toEqual([]);

    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Two\nnumber: 2\nstatus: draft", "## Chapter Text\n\n\"I don't care,\" Sera said.\n");
    expect(voicesReport(root).warnings).toEqual(["sera says \"don\u2019t\", which is in their voice-avoid list (chapter-02)"]);
  });

  test("story names skips titles and articles and compares whole names whole", () => {
    const { root } = project();
    writeMarkdown(path.join(root, "characters", "lord-maren.md"), "name: Lord Maren\nrole: antagonist\nstatus: alive\naliases:\n  - The Iron Lord", "# L\n");
    createEntity(root, { kind: "location", name: "The Ashen Citadel" });
    const report = namesReport(root, ["Lord Vance", "Theo", "The Hollow", "Tobias", "Maren", "Marek"]);
    expect(report.errors).toEqual(["\"Maren\" clashes with character lord-maren (Maren)"]);
    expect(report.warnings).toEqual([
      "\"Marek\" looks like character lord-maren (Lord Maren)"
    ]);
  });

  test("a string significance-delayed does not count as delayed", () => {
    const { root } = project();
    for (const id of ["a", "b", "c"]) {
      writeMarkdown(path.join(root, "continuity", "clues", `${id}.md`), `title: ${id}\nstatus: planted\nplanted: chapter-01\ncharacters:\n  - x${id === "a" ? "\nsignificance-delayed: \"false\"" : ""}`, `# ${id}\n`);
    }
    expect(clueReport(root).warnings).toContain("no clue is significance-delayed: every clue announces its meaning when planted");
  });

  test("a non-text author is a validation error", () => {
    const { root } = project("author: 123");
    expect(validateProject(root).errors).toContain("story.md frontmatter field author must be text");
  });

  test("arc nodes never collide with chapter nodes", () => {
    const { root } = project();
    createEntity(root, { kind: "arc", name: "Chapter 01" });
    const text = diagramProject(root, { kind: "arcs" }).text;
    expect(text).toContain('  arc__chapter_01(["Chapter 01"])');
    expect(text).toContain('  chapter_01["1. One"]');
  });

  test("sequels never count toward chapter outcomes", () => {
    const { root } = project();
    writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), "title: S\nchapter: chapter-01\nscene: 1\nstatus: draft\nsequel: true\noutcome: yes", "# S\n");
    const report = pacingReport(root);
    expect(report.rows[0].outcomes).toEqual({ yes: 0, no: 0, "yes-but": 0, "no-and": 0 });
    expect(report.totals.outcomesRecorded).toBe(0);
  });

  test("multi-line pronunciations stay on one table row", () => {
    const { root } = project();
    writeMarkdown(path.join(root, "glossary", "terms", "sgian.md"), "term: Sgian\ncategory: term\npronunciation: \"SKEE-an\\ndubh\"", "# S\n");
    const text = fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8");
    expect(text).toContain("| Sgian | SKEE-an dubh | term |");
  });

  test("the schema rejects zero-hour routes and accepts numeric isbns", () => {
    const schema = {
      type: "object",
      properties: { hours: { type: "number", exclusiveMinimum: 0 }, isbn: { type: ["string", "integer"] } }
    };
    expect(validateAgainstSchema({ hours: 0, isbn: 9780306406157 }, schema)).toEqual(["$.hours: 0 must be greater than 0"]);
    expect(validateAgainstSchema({ hours: 0.5, isbn: "978" }, schema)).toEqual([]);
    expect(validateAgainstSchema({ isbn: true }, schema)).toEqual(["$.isbn: expected string or integer, got boolean"]);
  });

  test("travel checks compare every earlier sighting and read scene times at their widest", () => {
    const { root } = project();
    createEntity(root, { kind: "character", name: "Mara" });
    writeMarkdown(path.join(root, "worldbuilding", "locations", "x.md"), "name: X\ntype: town\nroutes:\n  - to: y\n    hours: 10\n  - to: z\n    hours: 30", "# X\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "y.md"), "name: Y\ntype: town", "# Y\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "z.md"), "name: Z\ntype: town", "# Z\n");
    const scene = (chapter, number, fields) => writeMarkdown(path.join(root, "scenes", `${chapter}-scene-0${number}.md`), `title: ${chapter} ${number}\nchapter: ${chapter}\nscene: ${number}\nstatus: draft\ncharacters:\n  - mara\n${fields}`, "# S\n");
    // An untimed scene between two timed ones across midnight hides nothing.
    scene("chapter-01", 1, "location: x\ndate: 2020-01-01\ntime: \"23:00\"");
    scene("chapter-01", 2, "location: x\ndate: 2020-01-02");
    scene("chapter-01", 3, "location: y\ndate: 2020-01-02\ntime: \"01:00\"");
    expect(checkProjectContinuity(root).errors).toEqual([
      "scenes/chapter-01-scene-03.md puts mara at y 2h after scenes/chapter-01-scene-01.md at x, but the fastest route takes 10h"
    ]);

    // An untimed earlier scene starts at midnight at the latest-possible reading; 25h < 30h.
    for (const number of [1, 2, 3]) {
      fs.rmSync(path.join(root, "scenes", `chapter-01-scene-0${number}.md`));
    }
    scene("chapter-01", 1, "location: x\ndate: 2020-01-01");
    scene("chapter-01", 2, "location: z\ndate: 2020-01-02\ntime: \"01:00\"");
    expect(checkProjectContinuity(root).errors).toEqual([
      "scenes/chapter-01-scene-02.md puts mara at z at most 25h after scenes/chapter-01-scene-01.md at x, but the fastest route takes 30h"
    ]);

    // Morning to afternoon can span 06:00 to 16:00, so a 9h route is possible.
    scene("chapter-01", 1, "location: x\ndate: 2020-01-01\ntime: morning");
    scene("chapter-01", 2, "location: y\ndate: 2020-01-01\ntime: afternoon");
    expect(checkProjectContinuity(root).errors).toEqual([]);
  });

  test("rename leaves a `to` key outside routes alone", () => {
    const { root } = project();
    createEntity(root, { kind: "location", name: "Yonder" });
    writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), "title: S\nchapter: chapter-01\nscene: 1\nstatus: draft\nstate-changes:\n  - character: mara\n    to: yonder", "# S\n");
    renameEntity(root, { kind: "location", id: "yonder", name: "Far Yonder" });
    expect(fs.readFileSync(path.join(root, "scenes", "chapter-01-scene-01.md"), "utf8")).toContain("    to: yonder");
  });

  test("a copyright page found by title is treated as the copyright page everywhere", () => {
    const { root } = project("copyright: © 2026 Ada");
    createEntity(root, { kind: "matter", name: "Legal", order: "1" });
    const legal = path.join(root, "matter", "legal.md");
    fs.writeFileSync(legal, fs.readFileSync(legal, "utf8").replace("title: Legal", "title: Copyright Notice") + "\nAll mine.\n");
    expect(fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8")).not.toContain("Copyright Notice");
    expect(fs.readFileSync(buildBook(root, { format: "epub" }).outFile).toString("utf8")).toContain('<body epub:type="frontmatter copyright-page"><h1>Copyright Notice</h1>');
    const print = fs.readFileSync(buildBook(root, { format: "print" }).outFile, "utf8");
    expect(print.indexOf('id="front-legal"')).toBeLessThan(print.indexOf('class="toc"'));
  });

  test("an EAN-13 that is not an ISBN is rejected", () => {
    const { root } = project("isbn: \"4006381333931\"");
    expect(validateProject(root).errors).toContain("story.md isbn 4006381333931 is not a valid ISBN-13 or ISBN-10 (check the digits and checksum)");
  });

  test("matter section ids cannot collide with paragraph anchors in the review copy", () => {
    const { root } = project();
    for (const name of ["Note", "Note P1"]) {
      createEntity(root, { kind: "matter", name });
      fs.appendFileSync(path.join(root, "matter", `${name.toLowerCase().replace(" ", "-")}.md`), "\nText.\n");
    }
    const html = fs.readFileSync(buildBook(root, { format: "html" }).outFile, "utf8");
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("single-word names get initial checks, and one character is reported once", () => {
    const { root } = project();
    writeMarkdown(path.join(root, "characters", "mara.md"), "name: Mara\nrole: protagonist\nstatus: alive\naliases:\n  - Maro\n  - Mo", "# M\n");
    const report = namesReport(root, ["Mila", "Maro", "Mo"]);
    expect(report.errors).toEqual([
      "\"Maro\" clashes with character mara (Maro)",
      "\"Mo\" clashes with character mara (Mo)"
    ]);
    expect(report.warnings).toEqual(["\"Mila\" shares an initial with protagonist mara (Mara)"]);
  });
});

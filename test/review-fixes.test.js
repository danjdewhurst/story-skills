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
  createStoryProject,
  diagramProject,
  pacingReport,
  projectPasses,
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

  test("action beats match names in any case", () => {
    const { root } = project();
    writeMarkdown(path.join(root, "characters", "mara.md"), "name: Mara\nrole: protagonist\nstatus: alive\naliases:\n  - The Diver", "# M\n");
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nthe diver shrugged. \"Fine.\"\n");
    expect(voicesReport(root).profiles.map((entry) => entry.id)).toEqual(["mara"]);
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
});

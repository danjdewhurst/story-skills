import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { checkProjectContinuity, createEntity, createStoryProject, mentionsReport } from "../src/story.js";
import { auditMentions, formatMentions } from "../src/mentions.js";
import { scanProject } from "../src/scan.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function chapter(root, number, frontmatter, text, { outline = "" } = {}) {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  const body = `# Chapter ${number}\n\n${outline === "" ? "" : `## Outline\n\n${outline}\n\n`}## Chapter Text\n\n${text}\n`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft\n${frontmatter}`, body);
  return id;
}

function mentionsProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Mentions", force: false });
  writeMarkdown(path.join(root, "characters", "edran-vale.md"), "name: Captain Edran Vale\nrole: supporting\nstatus: alive\naliases:\n  - The Grey Man", "# Edran\n");
  writeMarkdown(path.join(root, "characters", "rose-hale.md"), "name: Rose\nrole: protagonist\nstatus: alive", "# Rose\n");
  writeMarkdown(path.join(root, "characters", "cut-guy.md"), "name: Zander\nrole: minor\nstatus: cut", "# Cut\n");
  createEntity(root, { kind: "location", name: "Vale" });
  createEntity(root, { kind: "location", name: "The Hollow" });
  createEntity(root, { kind: "artifact", name: "Brass Key" });
  return root;
}

describe("story mentions <kind> <id>", () => {
  test("lists each place prose names an entity, by name, given name, alias, and possessive, with line and column", () => {
    const root = mentionsProject();
    chapter(root, 1, "characters:\n  - edran-vale", [
      "Captain Edran Vale rode in at dusk.",
      "",
      "<!-- Edran is a note, not prose -->",
      "",
      "```",
      "Edran in a fence",
      "```",
      "",
      "They called him the Grey Man, and Edran's horse was lame."
    ].join("\n"), { outline: "1. Edran arrives" });
    const report = mentionsReport(root, { kind: "character", id: "edran-vale" });
    expect(report.names).toEqual(["Captain Edran Vale", "Edran Vale", "Edran", "The Grey Man", "Grey Man"]);
    expect(report.matches.map(({ line, column, text }) => [line, column, text])).toEqual([[16, 1, "Captain Edran Vale"], [24, 17, "the Grey Man"], [24, 35, "Edran"]]);
    expect(report.matches[0]).toMatchObject({ chapter: "chapter-01", file: "chapters/chapter-01.md", excerpt: "Captain Edran Vale rode in at dusk." });
    expect(report.chapters).toEqual([{ chapter: "chapter-01", file: "chapters/chapter-01.md", count: 3, listed: true }]);
    expect(formatMentions(report)).toContain("chapters/chapter-01.md:16:1: Captain Edran Vale: Captain Edran Vale rode in at dusk.\n");
  });

  test("a longer name wins its span, case is as written, and listing is reported per chapter", () => {
    const root = mentionsProject();
    chapter(root, 1, "locations:\n  - vale", "Edran Vale looked down on the Vale. the vale was quiet.");
    chapter(root, 2, "locations:\n  - vale", "Nobody came.");
    const report = mentionsReport(root, { kind: "location", id: "vale" });
    expect(report.matches.map((match) => [match.column, match.text])).toEqual([[31, "Vale"]]);
    expect(report.chapters.map((entry) => [entry.chapter, entry.count, entry.listed])).toEqual([["chapter-01", 1, true], ["chapter-02", 0, true]]);
    expect(formatMentions(report)).toContain("chapters/chapter-02.md lists it but its prose never names it\n");
    const hollow = mentionsReport(root, { kind: "location", id: "the-hollow" });
    expect(hollow.matches).toEqual([]);
    expect(formatMentions(hollow)).toBe("No mentions of location the-hollow (The Hollow, Hollow) in chapter prose\n");
  });

  test("a name never runs across a paragraph break, a comment, or a fence, and outline chapters are left out", () => {
    const root = mentionsProject();
    chapter(root, 1, "", [
      "He said Edran",
      "Vale was near.",
      "",
      "Then Edran",
      "",
      "Vale. And Edran <!-- note --> Vale.",
      "",
      "Brass",
      "```",
      "x",
      "```",
      "Key."
    ].join("\n"));
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Two\nnumber: 2\nstatus: outline\ncharacters:\n  - edran-vale", "# Chapter 2\n\nEdran Vale comes back.\n");
    const edran = mentionsReport(root, { kind: "character", id: "edran-vale" });
    expect(edran.matches.map((match) => [match.line, match.text])).toEqual([[10, "Edran\nVale"], [13, "Edran"], [15, "Edran"]]);
    expect(edran.chapters.map((entry) => entry.chapter)).toEqual(["chapter-01"]);
    expect(formatMentions(edran)).toContain("chapters/chapter-01.md:10:9: Edran Vale: He said Edran\n");
    expect(mentionsReport(root, { kind: "artifact", id: "brass-key" }).matches).toEqual([]);
  });

  test("an artifact is listed by mentions, and a location named but not listed is reported", () => {
    const root = mentionsProject();
    chapter(root, 1, "mentions:\n  - brass-key", "The Brass Key was cold.");
    chapter(root, 2, "", "She left the Vale at dawn.");
    expect(mentionsReport(root, { kind: "artifact", id: "brass-key" }).chapters).toEqual([{ chapter: "chapter-01", file: "chapters/chapter-01.md", count: 1, listed: true }]);
    const vale = mentionsReport(root, { kind: "location", id: "vale" });
    expect(vale.chapters).toEqual([{ chapter: "chapter-02", file: "chapters/chapter-02.md", count: 1, listed: false }]);
    expect(formatMentions(vale)).toContain("chapters/chapter-02.md names it but does not list it\n");
    const unnamed = mentionsReport(root, { kind: "location", id: "the-hollow" });
    expect(unnamed.chapters).toEqual([]);
    createEntity(root, { kind: "faction", name: "Tide Guild" });
    chapter(root, 3, "", "The Tide Guild met.");
    expect(mentionsReport(root, { kind: "factions", id: "tide-guild" }).chapters).toEqual([{ chapter: "chapter-03", file: "chapters/chapter-03.md", count: 1, listed: null }]);
  });

  test("names in Japanese match inside a run of characters, and a name without spaces has no given name", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "霧見", dir: "kirimi", force: false, language: "ja" });
    writeMarkdown(path.join(root, "characters", "oshima-genji.md"), "name: 大島源治\nrole: supporting\nstatus: alive\naliases:\n  - 大島", "# 大島\n");
    chapter(root, 1, "characters:\n  - oshima-genji", "駅の大島さんは、雪の朝には誰より先にホームを掃いている。大学の話もした。");
    const report = mentionsReport(root, { kind: "character", id: "oshima-genji" });
    expect(report.names).toEqual(["大島源治", "大島"]);
    expect(report.matches.map((match) => match.text)).toEqual(["大島"]);
    // Written with a space, the name is known by its first word, not its
    // first character.
    writeMarkdown(path.join(root, "characters", "morita-fumi.md"), "name: 森田 ふみ\nrole: supporting\nstatus: alive", "# 森田\n");
    expect(mentionsReport(root, { kind: "character", id: "morita-fumi" }).names).toEqual(["森田 ふみ", "森田"]);
    expect(checkProjectContinuity(root).warnings.filter((warning) => warning.code === "named-not-listed")).toEqual([]);
  });

  test("the command prints matches on stdout, takes --json, and rejects a bad kind or id", () => {
    const root = mentionsProject();
    chapter(root, 1, "characters:\n  - rose-hale", "Rose waited.");
    const text = invoke(root, ["mentions", "character", "rose-hale"]);
    expect(text.code).toBe(0);
    expect(text.out).toBe("chapters/chapter-01.md:12:1: Rose: Rose waited.\n1 mention of character rose-hale (Rose) in 1 chapter\n");
    const json = JSON.parse(invoke(root, ["mentions", "characters", "rose-hale", "--json"]).out);
    expect(json.data).toMatchObject({ mode: "entity", kind: "character", id: "rose-hale", names: ["Rose"] });
    expect(json.data.matches).toHaveLength(1);
    expect(invoke(root, ["mentions", "character"]).code).toBe(2);
    expect(invoke(root, ["mentions", "character", "nobody"]).err).toContain("character nobody does not exist");
    expect(invoke(root, ["mentions", "arc", "rose-hale"]).err).toContain("story mentions looks for names");
  });
});

describe("names in prose against chapter frontmatter", () => {
  test("continuity warns when prose names a character the chapter does not list", () => {
    const root = mentionsProject();
    chapter(root, 1, "characters:\n  - rose-hale", "Rose watched Edran cross the Hollow with the Brass Key. Zander was gone.");
    chapter(root, 2, "mentions:\n  - edran-vale", "Rose remembered Edran.");
    const result = checkProjectContinuity(root);
    expect(result.warnings.filter((warning) => warning.code === "named-not-listed")).toEqual([
      { code: "named-not-listed", message: "chapters/chapter-01.md names character edran-vale (\"Edran\") but does not list them in characters or mentions", file: "chapters/chapter-01.md", chapter: "chapter-01" },
      { code: "named-not-listed", message: "chapters/chapter-02.md names character rose-hale (\"Rose\") but does not list them in characters or mentions", file: "chapters/chapter-02.md", chapter: "chapter-02" }
    ]);
  });

  test("a one-word name that opens a sentence is not counted when the chapter also uses it as a word", () => {
    const root = mentionsProject();
    chapter(root, 1, "", "She cut a rose for the table.\n\nRose from her chair, she left. \"Go.\" Rose was not listening.");
    expect(messages(checkProjectContinuity(root).warnings.filter((warning) => warning.code === "named-not-listed"))).toEqual([]);
    chapter(root, 1, "", "She cut a rose for the table, and told Rose.");
    expect(messages(checkProjectContinuity(root).warnings.filter((warning) => warning.code === "named-not-listed"))).toEqual([
      "chapters/chapter-01.md names character rose-hale (\"Rose\") but does not list them in characters or mentions"
    ]);
  });

  test("a name of two words opening a sentence still counts, and a chapter gone since the scan is skipped", () => {
    const root = mentionsProject();
    chapter(root, 1, "", "She cut a rose.\n\nEdran Vale came in.");
    chapter(root, 2, "", "Edran Vale left.");
    const project = scanProject(root);
    fs.rmSync(path.join(root, "chapters", "chapter-02.md"));
    expect(messages(auditMentions(project))).toEqual([
      "chapters/chapter-01.md names character edran-vale (\"Edran Vale\") but does not list them in characters or mentions"
    ]);
    expect(mentionsReport(root, { kind: "character", id: "edran-vale" }).matches).toHaveLength(1);
  });

  test("outline chapters, outlines, and names two entities share are not checked", () => {
    const root = mentionsProject();
    writeMarkdown(path.join(root, "characters", "other-rose.md"), "name: Rose\nrole: minor\nstatus: alive", "# Rose\n");
    chapter(root, 1, "", "Rose waited.", { outline: "1. Edran arrives" });
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Two\nnumber: 2\nstatus: outline", "# Chapter 2\n\nEdran comes back.\n");
    expect(checkProjectContinuity(root).warnings.filter((warning) => warning.code === "named-not-listed")).toEqual([]);
  });

  test("story mentions with no entity also warns about mentions the prose never names", () => {
    const root = mentionsProject();
    chapter(root, 1, "characters:\n  - rose-hale\nmentions:\n  - edran-vale\n  - brass-key\n  - zander-missing", "Rose thought of her father.");
    const report = mentionsReport(root);
    expect(report).toMatchObject({ ok: true, mode: "audit", kind: null, matches: null });
    expect(messages(report.warnings)).toEqual([
      "chapters/chapter-01.md lists artifact brass-key in mentions but never names it; add the name the chapter uses as an alias, or drop the mention",
      "chapters/chapter-01.md lists character edran-vale in mentions but never names it; add the name the chapter uses as an alias, or drop the mention"
    ]);
    expect(checkProjectContinuity(root).warnings.filter((warning) => warning.code === "mention-not-named")).toEqual([]);
    const run = invoke(root, ["mentions"]);
    expect(run.code).toBe(0);
    expect(run.out).toBe("");
    expect(run.err).toContain("[mention-not-named]");
  });
});

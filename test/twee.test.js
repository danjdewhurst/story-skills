import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { buildBook, createStoryProject, moveEntity, removeEntity, validateLinks, validateProject } from "../src/story.js";
import { derivedIfid, isIfid, tweeSource } from "../src/twee.js";
import { SCHEMA_PATH, buildSchemaDocument, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));

function project(title = "Gull Rock") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function chapter(root, number, prose, extra = "") {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Part ${number}\nnumber: ${number}\nstatus: draft${extra ? `\n${extra.trim()}` : ""}`, `\n# Chapter ${number}: Part ${number}\n\n## Chapter Text\n\n${prose}\n`);
  return id;
}

function choices(...pairs) {
  return `choices:\n${pairs.map(([text, to]) => `  - text: ${text}\n    to: ${to}\n`).join("")}`;
}

const IFID = "3F2C9A61-7B1D-4E8A-9C3B-2A6D5E4F1B07";

function setIfid(root, line) {
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^ifid: .*\n/m, "").replace("schema-version: 2\n", `schema-version: 2\n${line}`));
}

function branching() {
  const root = project();
  setIfid(root, `ifid: ${IFID}\n`);
  chapter(root, 1, "The lamp is dark.", choices(["Search the rocks", "chapter-02"], ["Climb the tower", "chapter-03"]));
  chapter(root, 2, ":: not a passage\nA coat on the ledge.", choices(["Go up", "chapter-04"]));
  chapter(root, 3, "Tobias on the stair.", choices(["Go up", "chapter-04"]));
  chapter(root, 4, "The ship on the reef. THE END.");
  return root;
}

const read = (file) => fs.readFileSync(file, "utf8");

describe("twee build", () => {
  test("turns chapter choices into linked passages, with the first chapter as the start", () => {
    const root = branching();
    const result = buildBook(root, { format: "twee" });
    expect(result.outFile).toBe(path.join(root, "dist", "gull-rock.twee"));
    expect(result.format).toBe("twee");
    expect(messages(result.warnings)).toEqual([]);
    expect(read(result.outFile)).toBe([
      ":: StoryTitle",
      "Gull Rock",
      "",
      ":: StoryData",
      "{",
      `  "ifid": "${IFID}",`,
      "  \"start\": \"chapter-01\"",
      "}",
      "",
      ":: chapter-01",
      "The lamp is dark.",
      "",
      "[[Search the rocks->chapter-02]]",
      "[[Climb the tower->chapter-03]]",
      "",
      ":: chapter-02",
      "\\:: not a passage",
      "A coat on the ledge.",
      "",
      "[[Go up->chapter-04]]",
      "",
      ":: chapter-03",
      "Tobias on the stair.",
      "",
      "[[Go up->chapter-04]]",
      "",
      ":: chapter-04",
      "The ship on the reef. THE END.",
      ""
    ].join("\n"));
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(validateLinks(root)).toMatchObject({ errors: [], warnings: [] });
  });

  test("links a book with no choices in reading order, derives its IFID, and rebuilds byte for byte", () => {
    const root = project("Plain Line");
    chapter(root, 1, "One.");
    chapter(root, 2, "Two.");
    const result = buildBook(root, { format: "twee" });
    const ifid = derivedIfid("plain-line");
    expect(messages(result.warnings)).toEqual([`story.md has no ifid, so the build derived ${ifid} from the story id; add ifid: ${ifid} to story.md to keep it if the title changes`]);
    const first = read(result.outFile);
    expect(first).toContain(`"ifid": "${ifid}"`);
    expect(first).toContain(":: chapter-01\nOne.\n\n[[Continue->chapter-02]]\n\n:: chapter-02\nTwo.\n");
    expect(first.endsWith("Two.\n")).toBe(true);
    expect(read(buildBook(root, { format: "TWEE" }).outFile)).toBe(first);
  });

  test("uses the ifid in story.md, and validate and the schema check its form", () => {
    const root = branching();
    setIfid(root, `ifid: ${IFID.toLowerCase()}\n`);
    const result = buildBook(root, { format: "twee" });
    expect(messages(result.warnings)).toEqual([]);
    expect(read(result.outFile)).toContain(`"ifid": "${IFID}"`);
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(validateAgainstSchema(buildSchemaDocument(root), schema)).toEqual([]);

    // A mistyped ifid stops the build rather than shipping another story's id.
    setIfid(root, "ifid: not-a-uuid\n");
    expect(messages(validateProject(root).errors)).toContain("story.md ifid must be a version 4 UUID, such as 3F2C9A61-7B1D-4E8A-9C3B-2A6D5E4F1B07");
    expect(validateAgainstSchema(buildSchemaDocument(root), schema).join("\n")).toContain("not-a-uuid");
    expect(() => buildBook(root, { format: "twee" })).toThrow("Cannot build twee until these are fixed:\nstory.md ifid must be a version 4 UUID");
  });

  test("derives a version 4 IFID that differs between stories", () => {
    expect(isIfid(derivedIfid("gull-rock"))).toBe(true);
    expect(derivedIfid("gull-rock")).toBe(derivedIfid("gull-rock"));
    expect(derivedIfid("gull-rock")).not.toBe(derivedIfid("another-book"));
    expect(isIfid(42)).toBe(false);
  });

  test("writes a passage with no prose as its links alone", () => {
    expect(tweeSource({ title: "T", ifid: derivedIfid("t"), start: "a", passages: [{ name: "a", body: "", links: [{ text: "On", to: "b" }] }, { name: "b", body: "", links: [] }] }))
      .toContain(":: a\n[[On->b]]\n\n:: b\n");
  });

  test("refuses to build until every choice is usable, and warns about unreachable chapters", () => {
    const root = branching();
    chapter(root, 5, "Nobody gets here.");
    const result = buildBook(root, { format: "twee" });
    expect(messages(result.warnings)).toEqual(["chapters/chapter-05.md cannot be reached: no choice path from chapter-01 leads to it"]);
    expect(read(result.outFile)).toContain(":: chapter-05\nNobody gets here.\n");
    expect(messages(validateLinks(root).warnings)).toEqual(["chapters/chapter-05.md cannot be reached: no choice path from chapter-01 leads to it"]);

    // A chapter not written yet is a plan to links, but the build needs it.
    chapter(root, 4, "End.", choices(["Try again", "chapter-09"]));
    expect(() => buildBook(root, { format: "twee" })).toThrow("Cannot build twee until these are fixed:\nchapters/chapter-04.md choices[0] references missing chapter chapter-09");
    expect(messages(validateLinks(root).errors)).toEqual([]);
    chapter(root, 4, "End.", choices(["Try again", "chapter-9"]));
    expect(messages(validateLinks(root).errors)).toEqual(["chapters/chapter-04.md choices[0] references missing chapter chapter-9"]);

    chapter(root, 4, "End.", "choices: chapter-01");
    expect(() => buildBook(root, { format: "twee" })).toThrow("chapters/chapter-04.md frontmatter field choices must be a list of { text, to } entries");

    chapter(root, 4, "End.");
    writeMarkdown(path.join(root, "chapters", "Chapter [06].md"), "title: Odd\nnumber: 6\nstatus: draft", "\n## Chapter Text\n\nOdd.\n");
    expect(() => buildBook(root, { format: "twee" })).toThrow("chapters/Chapter [06].md: chapter file names must be kebab-case to name a passage");
  });

  test("validate reports every malformed choice", () => {
    const root = project();
    chapter(root, 1, "Start.", `choices:
  - chapter-02
  - text: ""
    to: chapter-02
  - text: Left [or right]
    to: chapter-02
  - text: Go -> now
  - text: Run
    to: Chapter Two
  - text: 1984
    to: 2
  - text: Search <
    to: chapter-02
  - text: Fine
    to: chapter-02
  - text: Padded
    to: "chapter-02 "`);
    chapter(root, 2, "End.");
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain("chapters/chapter-01.md choices[8] to chapter-02  must be a kebab-case chapter id");
    expect(errors).toEqual([
      "chapters/chapter-01.md choices[0] must have text and to, such as { text: Follow the light, to: chapter-02 }",
      "chapters/chapter-01.md choices[1] needs text: the words the reader picks, quoted if they look like a number",
      "chapters/chapter-01.md choices[2] text cannot contain [, ], |, ->, <-, or a line break, or end in <, which Twine reads as link syntax",
      "chapters/chapter-01.md choices[3] text cannot contain [, ], |, ->, <-, or a line break, or end in <, which Twine reads as link syntax",
      "chapters/chapter-01.md choices[3] needs to: the id of the chapter it leads to, such as chapter-02",
      "chapters/chapter-01.md choices[4] to Chapter Two must be a kebab-case chapter id",
      "chapters/chapter-01.md choices[5] needs text: the words the reader picks, quoted if they look like a number",
      "chapters/chapter-01.md choices[5] needs to: the id of the chapter it leads to, such as chapter-02",
      "chapters/chapter-01.md choices[6] text cannot contain [, ], |, ->, <-, or a line break, or end in <, which Twine reads as link syntax",
      "chapters/chapter-01.md choices[8] to chapter-02  must be a kebab-case chapter id"
    ]);
    const schemaErrors = validateAgainstSchema(buildSchemaDocument(root), schema);
    expect(schemaErrors.length).toBeGreaterThanOrEqual(7);
    expect(schemaErrors.join("\n")).toContain("Search <");
    expect(() => buildBook(root, { format: "twee" })).toThrow("choices[4] to Chapter Two must be a kebab-case chapter id");
  });

  test("follows --out write safety: new files in adaptations/, never over one", () => {
    const root = branching();
    const cwd = path.dirname(root);
    const io = memoryIo(cwd);
    expect(runCli(["build", root, "--format", "twee", "--out", "adaptations/interactive/gull-rock.twee"], io)).toBe(0);
    expect(io.output()).toBe(`Built 4 chapters as twee to ${path.join(root, "adaptations", "interactive", "gull-rock.twee")}\n`);
    const again = memoryIo(cwd);
    expect(runCli(["build", root, "--format", "twee", "--out", "adaptations/interactive/gull-rock.twee"], again)).toBe(4);
    expect(again.error()).toContain("Refusing to overwrite");
    const source = memoryIo(cwd);
    expect(runCli(["build", root, "--format", "twee", "--out", "chapters/story.twee"], source)).toBe(4);
    expect(source.error()).toContain("it is project source");
  });
});

describe("twee on the command line", () => {
  test("bad choices exit 3 like other unbuildable content, an unknown format 2", () => {
    const root = branching();
    chapter(root, 4, "End.", choices(["Try again", "chapter-09"]));
    const io = memoryIo(root);
    expect(runCli(["build", root, "--format", "twee"], io)).toBe(3);
    expect(io.error()).toContain("Cannot build twee until these are fixed:");
    const unknown = memoryIo(root);
    expect(runCli(["build", root, "--format", "tweee"], unknown)).toBe(2);
    expect(unknown.error()).toContain("Supported formats: markdown, epub, docx, shunn, html, print, narration, metadata, fountain, twee, ink");
  });

  test("story.md cli-defaults can make twee the default build, and a given --format still wins", () => {
    const root = branching();
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, read(storyPath).replace("schema-version: 2\n", "schema-version: 2\ncli-defaults:\n  - command: build\n    format: twee\n"));
    expect(messages(validateProject(root).errors)).toEqual([]);
    const io = memoryIo(root);
    expect(runCli(["build", root], io)).toBe(0);
    expect(io.output()).toContain("as twee to");
    const epub = memoryIo(root);
    expect(runCli(["build", root, "--format", "markdown"], epub)).toBe(0);
    expect(epub.output()).toContain("as markdown to");
  });
});

describe("choice targets follow move and remove", () => {
  const choiceTargets = (root, id) => parseFrontmatter(read(path.join(root, "chapters", `${id}.md`))).data.choices;

  test("move rewrites every choice that leads to the moved chapter, its own included", () => {
    const root = branching();
    chapter(root, 3, "Tobias on the stair.", choices(["Go up", "chapter-04"], ["Wait here", "chapter-03"]));
    moveEntity(root, { kind: "chapter", id: "chapter-03", number: 7 });
    expect(choiceTargets(root, "chapter-01")).toEqual([{ text: "Search the rocks", to: "chapter-02" }, { text: "Climb the tower", to: "chapter-07" }]);
    expect(choiceTargets(root, "chapter-07")).toEqual([{ text: "Go up", to: "chapter-04" }, { text: "Wait here", to: "chapter-07" }]);
    expect(validateLinks(root)).toMatchObject({ errors: [], warnings: [] });
  });

  test("remove drops the choices that led to the removed chapter", () => {
    const root = branching();
    expect(messages(removeEntity(root, { kind: "chapter", id: "chapter-03" }).warnings)).toEqual(["chapters/chapter-01.md had choices leading to chapter-03, which remove dropped; a chapter left with no choices is an ending, so check where it leads now"]);
    expect(choiceTargets(root, "chapter-01")).toEqual([{ text: "Search the rocks", to: "chapter-02" }]);
    chapter(root, 3, "Back.", choices(["Go up", "chapter-04"]));
    expect(messages(removeEntity(root, { kind: "chapter", id: "chapter-04" }).warnings)[0]).toStartWith("chapters/chapter-02.md, chapters/chapter-03.md had choices leading to chapter-04, which remove dropped; a chapter left with no choices is an ending, so check where they lead now");
    expect(messages(validateLinks(root).errors)).toEqual([]);
    expect(messages(validateLinks(root).warnings)).toEqual(["chapters/chapter-03.md cannot be reached: no choice path from chapter-01 leads to it"]);
  });

  test("remove says when the last choice goes and the book turns linear", () => {
    const root = project();
    chapter(root, 1, "Start.", choices(["Go", "chapter-03"]));
    chapter(root, 2, "Middle.");
    chapter(root, 3, "End.");
    expect(messages(removeEntity(root, { kind: "chapter", id: "chapter-03" }).warnings)).toEqual(["chapters/chapter-01.md had the last choices in the book, leading to chapter-03, which remove dropped; with no choices left the book is linear again and each chapter continues to the next, so add choices back to keep it branching"]);
    expect(choiceTargets(root, "chapter-01")).toEqual([]);
  });

  test("move rewrites a chapter named by both a progression and a choice; remove refuses and leaves both", () => {
    const root = branching();
    writeMarkdown(path.join(root, "characters", "ada-fenn.md"), "name: Ada Fenn\nrole: protagonist\nstatus: alive\nprogressions:\n  - from: chapter-03\n    field: status\n    value: missing", "# Ada Fenn\n");
    moveEntity(root, { kind: "chapter", id: "chapter-03", number: 7 });
    expect(choiceTargets(root, "chapter-01")[1]).toEqual({ text: "Climb the tower", to: "chapter-07" });
    const progressions = () => parseFrontmatter(read(path.join(root, "characters", "ada-fenn.md"))).data.progressions;
    expect(progressions()).toEqual([{ from: "chapter-07", field: "status", value: "missing" }]);

    expect(() => removeEntity(root, { kind: "chapter", id: "chapter-07" })).toThrow("a progression's from in characters/ada-fenn.md");
    expect(choiceTargets(root, "chapter-01")[1].to).toBe("chapter-07");
    expect(progressions()[0].from).toBe("chapter-07");
  });

  test("a route's to still names a location, never a chapter", () => {
    const root = branching();
    writeMarkdown(path.join(root, "worldbuilding", "locations", "chapter-03.md"), "name: Odd Place\ntype: place\nroutes:\n  - to: chapter-03\n    hours: 1", "# Odd\n");
    removeEntity(root, { kind: "chapter", id: "chapter-03" });
    expect(parseFrontmatter(read(path.join(root, "worldbuilding", "locations", "chapter-03.md"))).data.routes).toEqual([{ to: "chapter-03", hours: 1 }]);
  });
});

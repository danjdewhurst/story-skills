import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { chapterProse, extractSection, scanComments, wordCount } from "../src/markdown.js";
import { buildBook, computeWordCounts, createEntity, createStoryProject, exportManuscript, validateProject } from "../src/story.js";
import { makeTempDir, writeMarkdown, messages } from "./helpers.js";

function newProject(title = "Bugs") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function appendProse(root, file, prose) {
  fs.appendFileSync(path.join(root, file), `\n${prose}\n`);
}

function writeChapter(root, body, number = 1) {
  const file = path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`);
  writeMarkdown(file, `title: One\nnumber: ${number}\nstatus: draft\nword-count: 0`, body);
}

function build(root, format) {
  return fs.readFileSync(buildBook(root, { format, out: `dist/book.${format}` }).outFile, "utf8");
}

describe("#119 word counts match what builds print", () => {
  test("code is counted, and builds print code spans literally", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "A", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "The sign read:\n\n```\nKEEP OUT OF THE ARCHIVE BY ORDER OF THE COUNCIL\n```\n\nShe typed `rm *everything* now` and left.");
    expect(computeWordCounts(root).total).toBe(20);
    const shunn = build(root, "shunn");
    expect(shunn).toContain("Approximately 20 words");
    expect(shunn).not.toContain("```");
    const html = build(root, "html");
    expect(html).toContain("She typed rm *everything* now and left.");
    expect(html).not.toContain("<em>everything");
  });

  test("single and double backtick code spans count alike", () => {
    expect(wordCount("Run ``ls -la`` now")).toBe(wordCount("Run `ls -la` now"));
    expect(wordCount("Plain `x y z` here")).toBe(5);
    // A code span closes only on a backtick run of its own length.
    expect(scanComments("Use `` a ` <!-- b `` here").text).toBe("Use `` a ` <!-- b `` here");
  });

  test("builds print double-backtick spans without their backticks", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "A", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "Use `` a ` *b* `` here, and `` unclosed ` ticks.");
    const html = build(root, "html");
    expect(html).toContain("Use a ` *b* here, and `` unclosed ` ticks.");
  });

  test("builds print a link as its text and leave out images, as the count does", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "A", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "She walked to [the mill](../locations/mill.md) at dawn. ![chart](map.png)");
    expect(computeWordCounts(root).total).toBe(7);
    const html = build(root, "html");
    expect(html).toContain("She walked to the mill at dawn.");
    expect(html).not.toContain("mill.md");
    expect(html).not.toContain("map.png");
  });
});

describe("#225 an outline without its divider", () => {
  test("a --- scene break in the prose is not taken for the divider", () => {
    const body = "\n# Chapter 1: One\n\n## Outline\n\n1. Opening beat\n2. Second beat\n\nThe bell was ringing.\n\n---\n\nLater that night.\n";
    const prose = chapterProse(body);
    expect(prose).toContain("The bell was ringing.");
    expect(prose).toContain("Later that night.");
  });

  test("the divider directly after the outline still hides the outline", () => {
    const body = "\n## Outline\n\n1. Opening beat\n   continued here\n2. Second beat\n\n---\n\nThe bell was ringing.\n\n---\n\nLater.\n";
    const prose = chapterProse(body);
    expect(prose).not.toContain("Opening beat");
    expect(prose).toContain("The bell was ringing.");
    expect(prose).toContain("Later.");
  });
});

describe("#226 headings inside comments and fences", () => {
  test("a ## Chapter Text inside a comment is ignored", () => {
    const root = newProject();
    writeChapter(root, "\n# Chapter 1: One\n\n<!-- Old outline, kept for reference:\n## Outline\n1. She leaves.\n---\n## Chapter Text\nOld draft words here.\n-->\n\n## Chapter Text\n\nNew prose.\n");
    expect(computeWordCounts(root).total).toBe(2);
    const exported = fs.readFileSync(exportManuscript(root, { out: "dist/book.md" }).outFile, "utf8");
    expect(exported).not.toContain("Old draft");
    expect(exported).toContain("# Chapter 1: One\n\nNew prose.\n");
    expect(messages(validateProject(root).warnings).join("\n")).not.toContain("never closes");
  });

  test("a ## Chapter Text inside a code fence is ignored", () => {
    const root = newProject();
    writeChapter(root, "\n# Chapter 1: One\n\n## Outline\n\nTemplate reminder:\n\n```\n## Chapter Text\nprose goes here\n```\n\n---\n\n## Chapter Text\n\nNew prose.\n");
    expect(computeWordCounts(root).total).toBe(2);
  });

  test("a comment above the chapter heading does not keep the heading", () => {
    const root = newProject();
    writeChapter(root, "<!-- TODO: tighten the opening -->\n# Chapter 1: Arrival\n\nShe came home.\n");
    expect(computeWordCounts(root).total).toBe(3);
    const exported = fs.readFileSync(exportManuscript(root, { out: "dist/book.md" }).outFile, "utf8");
    expect(exported.match(/# Chapter 1/g)).toHaveLength(1);
  });
});

describe("#227 a fence inside a comment", () => {
  test("the comment still closes and is left out of counts, checks, and builds", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "Kept text.\n\n<!-- Old version:\nOld words here.\n```\nletter text\n```\nMore old words.\n-->\n\nNew text.");
    expect(computeWordCounts(root).total).toBe(4);
    expect(messages(validateProject(root).warnings).join("\n")).not.toContain("never closes");
    const html = build(root, "html");
    expect(html).not.toContain("Old words");
    expect(html).not.toContain("&lt;!--");
  });

  test("a comment marker inside a fence stays literal", () => {
    const { text, unclosed } = scanComments("```\n<!-- literal\n```\nafter\n");
    expect(text).toContain("<!-- literal");
    expect(unclosed).toBe(false);
  });
});

describe("#228 heading variants", () => {
  test("## Chapter Text with extra spaces or closing hashes", () => {
    expect(chapterProse("\n##  Chapter Text\n\nShe ran.\n").trim()).toBe("She ran.");
    expect(chapterProse("\n## Chapter Text ##\n\nShe ran.\n").trim()).toBe("She ran.");
    expect(extractSection("## Setup  ##\n\nMara lives here.\n\n##  Climax\n\nEnd.", "Setup")).toBe("Mara lives here.");
  });

  test("a setext chapter heading is stripped", () => {
    const root = newProject();
    writeChapter(root, "\nChapter 1: Arrival\n==================\n\nShe came home.\n");
    expect(computeWordCounts(root).total).toBe(3);
  });
});

import { describe, expect, test } from "bun:test";
import { chapterHeading, chapterProse, extractSection, kebabCase, titleCaseSlug, wordCount } from "../src/markdown.js";

describe("markdown utilities", () => {
  test("normalizes labels and counts prose words", () => {
    expect(kebabCase(" Sera's Last Ember! ")).toBe("seras-last-ember");
    expect(titleCaseSlug("seras-last-ember")).toBe("Seras Last Ember");
    expect(wordCount("# Title\n\nSera's [lost heir](x.md) `code` **returns**.")).toBe(5);
  });

  test("omits a chapter title that is blank or only repeats the number", () => {
    expect(chapterHeading(3, "Arrival")).toBe("Chapter 3: Arrival");
    expect(chapterHeading(3, "Chapter 3")).toBe("Chapter 3");
    expect(chapterHeading(3, "chapter 3")).toBe("Chapter 3");
    expect(chapterHeading(3, "")).toBe("Chapter 3");
    expect(chapterHeading(3, "Chapter 30")).toBe("Chapter 3: Chapter 30");
  });

  test("counts the visible text of links but not their targets or images", () => {
    expect(wordCount("She walked to [the old stone mill](../locations/mill.md) at dawn.")).toBe(9);
    expect(wordCount("A map ![harbor chart](map.png) hung there.")).toBe(4);
  });

  test("counts curly apostrophes, accents, and hyphenated words as single words", () => {
    expect(wordCount("don\u2019t stop")).toBe(2);
    expect(wordCount("na\u00efve caf\u00e9 \u00c9lodie")).toBe(3);
    expect(wordCount("well-known - list item\n\n---\n\nend")).toBe(4);
    expect(kebabCase("O\u2019Brien")).toBe("obrien");
    expect(kebabCase("O'Brien")).toBe("obrien");
  });

  test("extracts chapter prose from template, outline, and natural formats", () => {
    expect(chapterProse("# Chapter\n\n## Chapter Text\n\nActual prose.").trim()).toBe("Actual prose.");
    expect(chapterProse("# Chapter\n\n## Outline\n\n1. Beat\n\n---\n\nActual prose.").trim()).toBe("Actual prose.");
    expect(chapterProse("# Chapter\n\n## Outline\n\n1. Beat").trim()).toBe("1. Beat");
    expect(chapterProse("# Chapter\n\nNo outline.").trim()).toBe("No outline.");
    expect(chapterProse("No leading heading.").trim()).toBe("No leading heading.");
  });

  test("extracts named sections", () => {
    const markdown = "# Index\n\n## Registry\n\nRows\n\n## Family Trees\n\nTrees\n\n## Notes\n\nEnd";
    expect(extractSection(markdown, "Family Trees")).toBe("Trees");
    expect(extractSection(markdown, "Missing")).toBe("");
  });
});

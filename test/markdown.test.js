import { describe, expect, test } from "bun:test";
import { chapterHeading, chapterProse, extractSection, isSceneBreakLine, kebabCase, maskLinkTargets, setextSceneBreakLines, splitAtSceneBreaks, titleCaseSlug, wordCount } from "../src/markdown.js";

describe("markdown utilities", () => {
  test("normalizes labels and counts prose words", () => {
    expect(kebabCase(" Sera's Last Ember! ")).toBe("seras-last-ember");
    expect(titleCaseSlug("seras-last-ember")).toBe("Seras Last Ember");
    expect(wordCount("# Title\n\nSera's [lost heir](x.md) `code` **returns**.")).toBe(6);
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

  test("masks link targets, URLs, HTML tags, and reference definitions, keeping link text, offsets, and line breaks", () => {
    const blank = (part) => part.replace(/[^\n]/g, "_");
    const text = [
      "![Ines](img/Ines.png) met [Ines](https://en.wikipedia.org/wiki/Ines_(name) \"Ines\") and [Ines][ines-ref].",
      "Write to <mailto:ines@example.com>, ines.achebe@example.com, or https://example.com/Ines today.",
      "<img src=\"img/Ines.png\" alt=\"Ines\"> <a href=\"Ines.html\">Ines</a> and [the map](",
      "maps/Ines.png \"Ines's",
      "map\").",
      "[Ines] and [Ines][] are defined; [Ruth] is not. [^1] is a note.",
      "",
      "[ines]: https://example.com/Ines \"Ines\"",
      "[p]:",
      "img/Ines.png",
      "'Ines'",
      "> [q]: img/Ines.png",
      "- item",
      "",
      "      [r]: img/Ines.png",
      "# Heading",
      "[s]: img/Ines.png",
      "[^1]: Ines wrote this.",
      "[Ines]: are you there?",
      "She read the log.",
      "[t]: Ines"
    ].join("\n");
    const { text: masked, references } = maskLinkTargets(text, "_");
    expect(masked.length).toBe(text.length);
    expect(masked.split("\n")).toEqual([
      `![Ines]${blank("(img/Ines.png)")} met [Ines]${blank("(https://en.wikipedia.org/wiki/Ines_(name) \"Ines\")")} and [Ines]${blank("[ines-ref]")}.`,
      `Write to ${blank("<mailto:ines@example.com>")}, ${blank("ines.achebe@example.com")}, or ${blank("https://example.com/Ines")} today.`,
      `${blank("<img src=\"img/Ines.png\" alt=\"Ines\">")} ${blank("<a href=\"Ines.html\">")}Ines${blank("</a>")} and [the map]_`,
      blank("maps/Ines.png \"Ines's"),
      `${blank("map\")")}.`,
      `[Ines] and [Ines]${blank("[]")} are defined; [Ruth] is not. [^1] is a note.`,
      "",
      blank("[ines]: https://example.com/Ines \"Ines\""),
      blank("[p]:"),
      blank("img/Ines.png"),
      blank("'Ines'"),
      blank("> [q]: img/Ines.png"),
      "- item",
      "",
      blank("      [r]: img/Ines.png"),
      "# Heading",
      blank("[s]: img/Ines.png"),
      "[^1]: Ines wrote this.",
      "[Ines]: are you there?",
      "She read the log.",
      "[t]: Ines"
    ]);
    // The text of a shortcut or collapsed reference whose label is defined,
    // a line that is not a definition included.
    const line = text.indexOf("[Ines] and");
    const question = text.indexOf("[Ines]: are");
    expect(references).toEqual([[line + 1, line + 5], [line + 12, line + 16], [question + 1, question + 5]]);
    // A line of nothing but the blank, as a masked comment leaves, ends a
    // paragraph; without a definition, a bracketed name is prose. The
    // default blank is a space.
    expect(maskLinkTargets("Text.\n_____\n[a]: b\n[a]").text).toBe("Text.\n_____\n      \n[a]");
    expect(maskLinkTargets("[Ines] (Ines) <Ines").text).toBe("[Ines] (Ines) <Ines");
    expect(maskLinkTargets("[a](b)")).toEqual({ text: "[a]   ", references: [] });
  });

  test("masks nested, escaped, and wrapped destinations, URLs with brackets, and titles on the next line", () => {
    const blank = (part) => part.replace(/[^\n]/g, "_");
    const mask = (text) => maskLinkTargets(text, "_").text;
    expect(mask("![map](images/a(b(c-Ines))) and [x](img/Ines\\(draft.png) end")).toBe(`![map]${blank("(images/a(b(c-Ines)))")} and [x]${blank("(img/Ines\\(draft.png)")} end`);
    expect(mask("![x](\n img/Ines.png) end")).toBe(`![x]${blank("(\n img/Ines.png)")} end`);
    expect(mask("See https://example.com/(Ines) and http://[::1]/Ines now.")).toBe(`See ${blank("https://example.com/(Ines)")} and ${blank("http://[::1]/Ines")} now.`);
    // A blank line ends the paragraph, and the destination with it.
    expect(mask("[a](Ines\n\nInes) and \\\\(x)")).toBe("[a](Ines\n\nInes) and \\\\(x)");
    expect(mask("[ref]: /url\n  \"Ines\"\n[Ines]:\n\n[Ines]")).toBe(`${blank("[ref]: /url\n  \"Ines\"")}\n[Ines]:\n\n[Ines]`);
    expect(maskLinkTargets("[Ines]:\n\n[Ines]").references).toEqual([]);
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

describe("scene-break lines (#551)", () => {
  test("a line of three or more markers, however spaced, is a scene break", () => {
    for (const line of ["* * *", "*  *\t*", "*\u00a0*\u202f*", "---", "  ***  ", "~~~", "___", "#", "\\* \\* \\*"]) {
      expect({ line, sceneBreak: isSceneBreakLine(line) }).toEqual({ line, sceneBreak: true });
    }
    for (const line of ["He left.", "* *", "--", "# Heading", "#hashtag", "* * * and more"]) {
      expect({ line, sceneBreak: isSceneBreakLine(line) }).toEqual({ line, sceneBreak: false });
    }
  });

  test("splits a paragraph at each scene-break line", () => {
    expect(splitAtSceneBreaks("He left.\n* * *\nShe came.")).toEqual(["He left.", "* * *", "She came."]);
    expect(splitAtSceneBreaks("---\nOne\ntwo.\n#\n***")).toEqual(["---", "One\ntwo.", "#", "***"]);
    expect(splitAtSceneBreaks("One\ntwo.")).toEqual(["One\ntwo."]);
  });

  test("finds a --- right under a line of text, where CommonMark reads a heading underline", () => {
    const lines = (prose) => setextSceneBreakLines(`## Chapter Text\n\n${prose}`).map((index) => index - 2);
    expect(lines("He left.\n---\nShe came.\n")).toEqual([1]);
    expect(lines("One\ntwo.\n  ---  \nThree.\n---\n")).toEqual([2, 4]);
    expect(lines("> He said.\n> ---\n")).toEqual([1]);
    // A list that does not start at 1 cannot interrupt a paragraph.
    expect(lines("He wrote:\n1999. The year it ended.\n---\n")).toEqual([2]);
    // CommonMark reads each of these as a thematic break, as builds do.
    for (const prose of [
      "He left.\n\n---\n",
      "He left.\n* * *\n",
      "He left.\n- - -\n",
      "> He said.\n---\n",
      "> He said.\nlazily.\n---\n",
      "He left.\n> She said.\n---\n",
      "- An item\n---\n",
      "1999. The year it ended.\n---\n",
      "He left.\n1. An item\n---\n",
      "### Part Two\n---\n",
      "Part Two\n===\n---\n",
      "    indented code\n---\n",
      "---\n---\n",
      "```\nHe left.\n---\n```\n",
      "<!--\nHe left.\n---\n-->\n"
    ]) {
      expect({ prose, lines: lines(prose) }).toEqual({ prose, lines: [] });
    }
  });

  test("counts body lines from the top, past an outline and its divider, and in CRLF files", () => {
    expect(setextSceneBreakLines("He left.\n---\n")).toEqual([1]);
    expect(setextSceneBreakLines("## Outline\n\n1. Beat\n---\n\nHe left.\n---\n")).toEqual([6]);
    expect(setextSceneBreakLines("\r\n## Chapter Text\r\n\r\nHe left.\r\n---\r\nShe came.\r\n")).toEqual([4]);
  });
});

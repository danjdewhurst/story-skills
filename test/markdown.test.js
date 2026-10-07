import { describe, expect, test } from "bun:test";
import { breaksParagraph, chapterHeading, chapterProse, extractSection, isSceneBreakLine, kebabCase, maskLinkTargets, separateSceneBreaks, setextSceneBreakLines, softBreak, titleCaseSlug, wordCount } from "../src/markdown.js";

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

  test("only a break line indented by fewer than four columns ends a paragraph, as in CommonMark", () => {
    expect(["---", "   ***", "    ---", "\t---", " \t* * *"].map(breaksParagraph)).toEqual([true, true, false, false, false]);
  });

  test("sets each break line apart with blank lines, but not one in a code fence", () => {
    expect(separateSceneBreaks("He left.\n* * *\nShe came.")).toBe("He left.\n\n* * *\n\nShe came.");
    expect(separateSceneBreaks("---\nOne\ntwo.\n#\n\n***")).toBe("---\n\nOne\ntwo.\n\n#\n\n***");
    expect(separateSceneBreaks("One\n    ---\ntwo.")).toBe("One\n    ---\ntwo.");
    expect(separateSceneBreaks("```\nINCOMING\n----------\n```\nOne\r\n---\r\nTwo")).toBe("```\nINCOMING\n----------\n```\nOne\r\n\n---\r\n\nTwo");
  });

  // Each `---` line pandoc's CommonMark reader (pandoc -f commonmark) takes
  // for a setext heading underline, counted from the first line of the prose,
  // where builds print a scene break.
  const setextCases = [
      ["He left.\n---\nShe came.\n", [1]],
      ["One\ntwo.\n  ---  \nThree.\n---\n", [2, 4]],
      ["> He said.\n> ---\n", [1]],
      ["He wrote:\n1999. The year it ended.\n---\n", [2]],
      ["He left.\n\n---\n", []],
      ["He left.\n* * *\n", []],
      ["He left.\n- - -\n", []],
      ["> He said.\n---\n", []],
      ["> He said.\nlazily.\n---\n", []],
      ["He left.\n> She said.\n---\n", []],
      ["- An item\n---\n", []],
      ["1999. The year it ended.\n---\n", []],
      ["He left.\n1. An item\n---\n", []],
      ["### Part Two\n---\n", []],
      ["Part Two\n===\n---\n", []],
      ["    indented code\n---\n", []],
      ["---\n---\n", []],
      ["```\nHe left.\n---\n```\n", []],
      ["<!--\nHe left.\n---\n-->\n", []],
      ["> Outer\n>> ---\n", []],
      [">> foo\n> ---\n", []],
      [">> foo\n> bar\n> ---\n", []],
      ["> foo\nbar\n> ---\n", [2]],
      ["- item\n  ---\n", [1]],
      ["- item\n\n  more\n---\n", []],
      ["- item\n\n  more\n  ---\n", [3]],
      ["<div>\n---\n", []],
      ["<div>\n\nHe left.\n---\n", [3]],
      ["foo\n    ---\n", []],
      ["foo\n\t---\n", []],
      ["~~~\nHe left.\n---\n~~~\n", []],
      ["~~~\nHe left.\n---\n", []],
      ["Text\n~~~\nHe left.\n---\n~~~\nAfter.\n---\n", [6]],
      ["- item\n    ---\n", []],
      ["1. item\n   ---\n", [1]],
      ["- a\n- b\n  ---\n", [2]],
      ["* item\n  text\n  ---\n", [2]],
      ["- item\nlazy\n---\n", []],
      ["- item\nlazy\n  ---\n", [2]],
      ["> - item\n>   ---\n", [1]],
      ["> - item\n> ---\n", []],
      ["- > quote\n  > ---\n", [1]],
      ["- > quote\n  ---\n", []],
      ["<span>text</span>\n---\n", [1]],
      ["Text <!-- c -->\n---\n", [1]],
      ["Text\n<!-- c -->\n---\n", []],
      ["<p>\ntext\n</p>\n---\n", []],
      ["<p>text</p>\n\nPara\n---\n", [3]],
      ["Text\n<custom-tag>\n---\n", [2]],
      ["<custom-tag>\n---\n", []],
      ["<script>\nx\n</script>\nText\n---\n", [4]],
      ["Para\n  ---\n", [1]],
      ["Para\n   ---\n", [1]],
      ["> > nested\n> > ---\n", [1]],
      ["> a\n>\n> b\n> ---\n", [3]],
      ["a\n> b\n> ---\n", [2]],
      ["1) item\n   para\n   ---\n", [2]],
      ["2. item\n   ---\n", [1]],
      ["-\n  foo\n  ---\n", [2]],
      ["- \n\n  foo\n---\n", [3]],
      ["``` js\ncode\n```\nText\n---\n", [4]],
      ["````\n```\n---\n````\nText\n---\n", [5]],
      ["Text\n```\n---\n", []],
      ["  > quote\n  > ---\n", [1]],
      ["    > not quote\n---\n", []],
      ["Text\n    ---\n    more\n", []],
      ["*\tx\n ---\n", []],
      ["- a\n\n\n  b\n  ---\n", [4]],
      ["-\n\n  foo\n---\n", [3]],
      ["-\n  foo\n\n  bar\n  ---\n", [4]],
      ["- \n  foo\n---\n", []],
      ["-\n\n  foo\n  ---\n", [3]],
      ["> -\n>\n>   foo\n> ---\n", [3]],
      ["- a\n  - b\n    ---\n", []],
      ["- a\n  - b\n  ---\n", []],
      ["- a\n  - b\n\n    c\n---\n", []],
      ["10. x\n    y\n    ---\n", []],
      ["-    code?\n     ---\n", []],
      ["-     code\n  ---\n", []],
      ["> foo\n    bar\n> ---\n", [2]],
      ["- foo\n      bar\n  ---\n", [2]]
  ];

  test("finds a --- that CommonMark reads as a heading underline and builds as a scene break", () => {
    const lines = (prose) => setextSceneBreakLines(`## Chapter Text\n\n${prose}`).map((index) => index - 2);
    for (const [prose, expected] of setextCases) {
      expect({ prose, lines: lines(prose) }).toEqual({ prose, lines: expected });
    }
  });

  test("stays linear on deeply nested list and quote markers", () => {
    const started = performance.now();
    expect(setextSceneBreakLines(`${"- ".repeat(50000)}x\n---\n\n${"> ".repeat(50000)}x\n---\n`)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("counts body lines from the top, past an outline and its divider, and in CRLF files", () => {
    expect(setextSceneBreakLines("He left.\n---\n")).toEqual([1]);
    expect(setextSceneBreakLines("## Outline\n\n1. Beat\n---\n\nHe left.\n---\n")).toEqual([6]);
    expect(setextSceneBreakLines("\r\n## Chapter Text\r\n\r\nHe left.\r\n---\r\nShe came.\r\n")).toEqual([4]);
  });
});

describe("soft line breaks (#599)", () => {
  test("join two Chinese or Japanese characters with no space", () => {
    expect(softBreak("一行目の文。", "二行目の文。")).toBe("");
    expect(softBreak("カタカナ", "ひらがな")).toBe("");
    expect(softBreak("他说：", "我来了。")).toBe("");
    expect(softBreak("ｶﾀｶﾅ", "ＡＢＣ")).toBe("");
    expect(softBreak("文。", "\u3000次の段落")).toBe("");
    // Characters outside the BMP, and a trailing variation selector or
    // combining mark, which belongs to the character before it.
    expect(softBreak("吉\u{20bb7}", "\u{20bb7}野家")).toBe("");
    expect(softBreak("葛\u{e0100}", "城")).toBe("");
    expect(softBreak("神\ufe00", "社")).toBe("");
    expect(softBreak("か\u3099", "き")).toBe("");
  });

  test("join curly quotes, dashes, ellipses, and a name's middle dot to a Chinese or Japanese character", () => {
    expect(softBreak("他说：", "\u201c你好。\u201d")).toBe("");
    expect(softBreak("\u201c你好。\u201d", "他说。")).toBe("");
    expect(softBreak("彼は言った", "\u2026\u2026")).toBe("");
    expect(softBreak("\u2014\u2014", "そうか")).toBe("");
    expect(softBreak("列夫\u00b7", "托尔斯泰")).toBe("");
    expect(softBreak("列夫", "\u00b7托尔斯泰")).toBe("");
  });

  test("keep the space everywhere else", () => {
    expect(softBreak("The lamp", "is dark.")).toBe(" ");
    expect(softBreak("東京で", "Alice")).toBe(" ");
    expect(softBreak("Alice", "に会った。")).toBe(" ");
    expect(softBreak("He said\u2014", "\u201cthere.\u201d")).toBe(" ");
    expect(softBreak("Jean\u00b7", "Paul")).toBe(" ");
    // Korean sets spaces between words, halfwidth Hangul included.
    expect(softBreak("안녕하세요", "반갑습니다")).toBe(" ");
    expect(softBreak("\uffa1", "文")).toBe(" ");
    expect(softBreak("", "文")).toBe(" ");
    expect(softBreak("文", "")).toBe(" ");
    expect(softBreak("\u0301", "文")).toBe(" ");
  });

  test("keep the space beside an emphasis or code marker, so the markup on either side never runs together", () => {
    expect(softBreak("**強調**", "**次**")).toBe(" ");
    expect(softBreak("*彼は*", "*言った*")).toBe(" ");
    expect(softBreak("他说`东京`", "`大阪`很远")).toBe(" ");
    expect(softBreak("強調", "_です_")).toBe(" ");
  });
});

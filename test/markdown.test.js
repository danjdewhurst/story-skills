import { describe, expect, test } from "bun:test";
import { breaksParagraph, chapterHeading, chapterProse, countTodoMarkers, countedText, extractSection, flattenHeadings, isSceneBreakLine, kebabCase, maskLinkTargets, maskMarkup, plainLinks, separateSceneBreaks, setextSceneBreakLines, softBreak, splitWords, titleCaseSlug, wordCount } from "../src/markdown.js";
import { backtickRuns, expectComparableTime, expectLinearTime } from "./helpers.js";

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

  test("Hebrew maqaf, geresh, and gershayim and Armenian marks inside a word join it", () => {
    expect(splitWords("בית־ספר צה״ל ג׳ירפה צה\"ל")).toEqual(["בית־ספר", "צה״ל", "ג׳ירפה", "צה\"ל"]);
    expect(splitWords("Ո՞վ է, Ո՛չ, Ո՜վ")).toEqual(["Ո՞վ", "է", "Ո՛չ", "Ո՜վ"]);
    // A `"` joins Hebrew letters only, as a typed gershayim.
    expect(splitWords("She said \"no\"yes")).toEqual(["She", "said", "no", "yes"]);
  });

  test("footnote markers, entities, HTML tags, reference definitions, and task boxes are not words", () => {
    expect(splitWords("The end.[^1] Then[^note] more.\n\n[^1]: A note counts.")).toEqual(["The", "end", "Then", "more", "A", "note", "counts"]);
    expect(splitWords("Tom &amp; Jerry don&rsquo;t pay caf&eacute; prices&#8202;&mdash;&#X2014;today&nbsp;now &alpha;&AMP;&ast;"))
      .toEqual(["Tom", "Jerry", "don\u2019t", "pay", "caf\u00e9", "prices", "today", "now", "\u03b1"]);
    expect(splitWords("<span class=\"smallcaps\">Lord</span> said <i>un</i>known, line<br/>two <p data-x='1'\nhidden>three</p> <book-note class=\"small\">four</book-note> <details open>five</details>"))
      .toEqual(["Lord", "said", "unknown", "line", "two", "three", "four", "five"]);
    expect(splitWords("See [the mill][mill] at [dawn][] and [Dusk].\n\n[mill]: https://example.com/mill \"The Mill\"\n[dawn]: <dawn.md>\n[dusk]: dusk.md"))
      .toEqual(["See", "the", "mill", "at", "dawn", "and", "Dusk"]);
    expect(splitWords("- [x] Done\n- [ ] Todo\n> * [X] Quoted\n\nA [x] in prose.")).toEqual(["Done", "Todo", "Quoted", "A", "x", "in", "prose"]);
    expect(splitWords("snake_case and __init__ but _emphasis_ and a_ b")).toEqual(["snake_case", "and", "init", "but", "emphasis", "and", "a", "b"]);
  });

  test("an entity is its character, an invalid number U+FFFD, and a name HTML does not define, in its case, text", () => {
    expect(countedText("a&#0;b&#xD800;c&#x110000;d&#x41;")).toBe("a\ufffdb\ufffdc\ufffddA");
    expect(splitWords("&bogus; Smith&Wesson; &Amp; &amp")).toEqual(["bogus", "Smith", "Wesson", "Amp", "amp"]);
  });

  test("words a build prints are never dropped as markup", () => {
    // Speech in angle brackets: not a lowercase element name, or plain words after one.
    const speech = ["<I hear you>", "<I am here> she thought.", "<A ship comes.>", "<Time is short>", "<Small talk bores me>", "<Head north now>", "<i hear you>", "<Can you hear me?>"];
    expect(speech.map(wordCount)).toEqual([3, 5, 3, 3, 4, 3, 3, 4]);
    // A definition whose label no reference uses, as in a chat log, or one
    // indented as code, is prose, and so is a full reference to a label
    // that is not defined.
    expect(splitWords("[Mira]: Hello?\n[10:42]: Here.\n[Mira]: Fine.")).toEqual(["Mira", "Hello", "10:42", "Here", "Mira", "Fine"]);
    expect(splitWords("Use [x][code].\n\n    [code]: indented.md")).toEqual(["Use", "x", "code", "code", "indented", "md"]);
    expect(splitWords("[sic][1], See [foo][missing], [a][b][c].")).toEqual(["sic", "1", "See", "foo", "missing", "a", "b", "c"]);
  });

  test("markup in code, or escaped, is printed, so it counts", () => {
    expect(splitWords("Type `<b>&amp;[^1]</b>` here, not <b>there</b>.")).toEqual(["Type", "b", "amp", "1", "b", "here", "not", "there"]);
    expect(splitWords("```\n<div>&amp;</div>\n[mill]: mill.md\n```\n<div>x</div> ` <b>tick</b> [the mill][mill]"))
      .toEqual(["div", "amp", "div", "mill", "mill", "md", "x", "tick", "the", "mill", "mill"]);
    expect(splitWords("\\<b> and \\&amp; and \\[^1] but \\\\<b>bold</b>")).toEqual(["b", "and", "amp", "and", "1", "but", "bold"]);
    // An escaped backtick opens no code span; the rest of an escaped run does.
    expect(splitWords("\\`<b>x</b>`\n\\``<b>y</b>`")).toEqual(["x", "b", "y", "b"]);
  });

  test("an entity in a link is read after the link is", () => {
    expect(splitWords("[chapter&#93; two](notes/a-b.md) and [the mill](https://x.org/a&#41;b) ran")).toEqual(["chapter", "two", "and", "the", "mill", "ran"]);
  });

  test("markup stays linear on long runs", () => {
    const started = performance.now();
    wordCount(`a${"_".repeat(100000)}b ${"<b x=".repeat(20000)} <i title="${"a".repeat(100000)} ${"[^".repeat(50000)} ${"&a".repeat(50000)}`);
    wordCount(`${"- [".repeat(30000)}\n${" ".repeat(100000)}x\n${"[a]".repeat(30000)}\n${"> ".repeat(50000)}[x]: y`);
    wordCount(`${Array.from({ length: 400 }, (_, index) => "`".repeat(index + 1)).join(" ")}\n${"\\`".repeat(30000)}\n${"[a]: b\n".repeat(20000)}${"[x][a]".repeat(10000)}`);
    wordCount(`<b${" hidden".repeat(20000)} ${"<i open ".repeat(20000)}`);
    expect(performance.now() - started).toBeLessThan(2000);
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

  test("heading hashes and markup scans stay linear on long runs (#587)", () => {
    expect(flattenHeadings("# Title   ##\n## A # B ###  \n#")).toBe("Title\nA # B\n#");
    expect(maskMarkup("a `<!--` b\n<!-- c -->\nd")).toBe("a `<!--` b\n          \nd");
    expectLinearTime(flattenHeadings, (n) => `# a${" ".repeat(n)}b`);
    // Many lines and no backtick: each line once searched the rest of the
    // text for one. That search is fast, so the text is longer.
    expectLinearTime(maskMarkup, (n) => "a\n".repeat(n / 2), { length: 512000 });
  });

  test("code spans and fences are matched in linear time (#587)", () => {
    // The ``` finds no closer, so the line is read once; `y` still closes,
    // and the `` after it still finds no closer.
    expect(maskMarkup("```x `y` <!--z--> `` <!--w-->")).toBe("```x `y`          ``         ");
    // The five-backtick fence never closes; the three-backtick one does.
    expect(maskMarkup("`````\n```\ncode <!-- x -->\n```\n<!-- y -->")).toBe("`````\n   \n               \n   \n          ");
    // A shorter line of backticks inside a fence does not close it.
    expect(maskMarkup("````\n```\n# a\n````\n# b")).toBe("    \n   \n   \n    \n# b");
    // One long line of code spans: the line's end was found again after
    // each span. A search for a newline is fast, so the text is longer.
    expectLinearTime(maskMarkup, (n) => "`a` ".repeat(n / 4), { length: 1024000 });
    // Runs of backticks of every length, none closed: each run read to the
    // end of the line.
    expectLinearTime(maskMarkup, backtickRuns, { length: 512000, pieces: 256 });
    // Fence openers that nothing closes, each shorter than the last, then
    // many lines: each opener read every line after it.
    const fences = (n) => {
      let text = "";
      for (let length = Math.floor(Math.sqrt(n)); length >= 3; length -= 1) {
        text += `${"`".repeat(length)}\n`;
      }
      return text + "a\n".repeat(n / 4);
    };
    expectLinearTime(maskMarkup, fences, { length: 512000, pieces: 256 });
  });

  test("links and images print as their text at any length, in linear time (#587)", () => {
    const destination = "x/".repeat(600);
    expect(plainLinks(`See [the map](${destination}map.md "Map") and ![a gull](${"y".repeat(1200)}.png) here.`)).toBe("See the map and  here.");
    expect(plainLinks("[a](b) [c] (d) ![e](f [g](h")).toBe("a [c] (d) ![e](f [g](h");
    // Unclosed openers once each read up to a thousand characters ahead.
    expectComparableTime(plainLinks, "![".repeat(128000), "!x".repeat(128000));
    expectComparableTime(plainLinks, "[a](".repeat(256000), "[a]x".repeat(256000));
    // Openers that share one `]` with no `(` after it: each one searched
    // for that `]` again. A search for `]` is fast, so the text is longer.
    expectLinearTime(plainLinks, (n) => `${"[".repeat(n)}]x`, { length: 512000 });
    expectLinearTime(plainLinks, (n) => `${"![".repeat(n / 2)}]x`, { length: 512000 });
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

  test("ends an HTML block where a browser ends it", () => {
    const lines = (prose) => setextSceneBreakLines(`## Chapter Text\n\n${prose}`).map((index) => index - 2);
    // A comment ends at --!> as well as -->, a processing instruction or a
    // CDATA section at its first >, and a script at an end tag with a space.
    expect(lines("<!--\nnote --!>\n\nHe left.\n---\n")).toEqual([4]);
    expect(lines("<!--\nnote -->\n\nHe left.\n---\n")).toEqual([4]);
    expect(lines("<?php\necho 1 >\n\nHe left.\n---\n")).toEqual([4]);
    expect(lines("<![CDATA[\nx >\n\nHe left.\n---\n")).toEqual([4]);
    expect(lines("<script>\nx\n</script >\n\nHe left.\n---\n")).toEqual([5]);
    // Until then, a --- is inside the block.
    expect(lines("<!--\nHe left.\n---\n")).toEqual([]);
    expect(lines("<script>\nHe left.\n---\n</scripts>\n")).toEqual([]);
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

describe("countTodoMarkers", () => {
  test("counts only the [TODO markers a reader sees (#557)", () => {
    expect(countTodoMarkers("ISBN [TODO: author to supply], [todo: later], [TODO check]")).toBe(3);
    expect(countTodoMarkers("No markers, not even TODO or [TODOS].")).toBe(0);
    // Link text is printed; a destination, link title, URL, or tag is not.
    expect(countTodoMarkers("[TODO: the sequel](https://example.com) and [TODO: notes][ref]\n\n[ref]: https://example.com/[TODO]")).toBe(2);
    expect(countTodoMarkers("[notes](notes.md \"[TODO: title]\") [site](https://example.com/[TODO]) https://example.com/[TODO] <span title=\"[TODO]\">x</span>")).toBe(0);
  });
});

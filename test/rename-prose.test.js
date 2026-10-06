import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createStoryProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function chapter(root, number, text, { status = "draft", outline = "" } = {}) {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  const body = `# Chapter ${number}\n\n${outline === "" ? "" : `## Outline\n\n${outline}\n\n`}## Chapter Text\n\n${text}\n`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: ${status}`, body);
  return path.join(root, "chapters", `${id}.md`);
}

function character(root, id, frontmatter) {
  writeMarkdown(path.join(root, "characters", `${id}.md`), `${frontmatter}\nrole: supporting\nstatus: alive`, "\n# Character\n");
}

function project() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Prose Rename", force: false });
  character(root, "edran-vale", "name: Captain Edran Vale\naliases:\n  - The Grey Man");
  writeMarkdown(path.join(root, "worldbuilding", "locations", "vale.md"), "name: Vale\ntype: valley", "\n# Vale\n");
  return root;
}

function prose(file) {
  return fs.readFileSync(file, "utf8").split("## Chapter Text\n\n")[1];
}

describe("story rename --prose", () => {
  test("renames the full name, the name without titles, the given name, possessives, and a name wrapped across lines", () => {
    const root = project();
    const file = chapter(root, 1, [
      "Captain Edran Vale rode in. Edran's horse was lame, and Vale-born men",
      "stared. Later Edran",
      "Vale slept by the Grey Man's fire in the Vale.",
      "",
      "<!-- Edran is a note -->",
      "",
      "```",
      "Edran in a fence",
      "```"
    ].join("\n"), { outline: "1. Edran arrives" });
    const { code, out } = invoke(root, ["rename", "character", "edran-vale", "Captain Mara Holt", "--prose"]);
    expect(code).toBe(0);
    expect(prose(file)).toBe([
      "Captain Mara Holt rode in. Mara's horse was lame, and Vale-born men",
      "stared. Later Mara",
      "Holt slept by the Grey Man's fire in the Vale.",
      "",
      "<!-- Edran is a note -->",
      "",
      "```",
      "Edran in a fence",
      "```",
      ""
    ].join("\n"));
    expect(fs.readFileSync(file, "utf8")).toContain("1. Edran arrives");
    expect(out).toContain("chapters/chapter-01.md:14:1: Captain Edran Vale → Captain Mara Holt\n");
    expect(out).toContain("chapters/chapter-01.md:14:29: Edran → Mara\n");
    expect(out).toContain("chapters/chapter-01.md:15:15: Edran Vale → Mara Holt (wraps to line 16)\n");
    expect(out).toContain("Renamed 3 names in 1 chapter; left 1 alias as written\n");
  });

  test("without --prose the text is left alone, and outline chapters are never changed", () => {
    const root = project();
    const drafted = chapter(root, 1, "Edran waited.");
    const outline = chapter(root, 2, "Edran waited.", { status: "outline" });
    expect(invoke(root, ["rename", "character", "edran-vale", "Mara Holt"]).code).toBe(0);
    expect(prose(drafted)).toBe("Edran waited.\n");
    expect(invoke(root, ["rename", "character", "mara-holt", "Ilse Marrow", "--prose"]).out).toContain("No names to rename in chapter prose\n");
    expect(prose(outline)).toBe("Edran waited.\n");
  });

  test("--dry-run lists every replacement, writes nothing, and matches the real run", () => {
    const root = project();
    const file = chapter(root, 1, "Edran Vale smiled.\n\nEdran left.");
    const before = fs.readFileSync(file, "utf8");
    const preview = invoke(root, ["rename", "character", "edran-vale", "Mara Holt", "--prose", "--dry-run"]);
    expect(preview.code).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(preview.out).toBe([
      "chapters/chapter-01.md:10:1: Edran Vale → Mara Holt",
      "chapters/chapter-01.md:12:1: Edran → Mara",
      "Renamed 2 names in 1 chapter",
      "update  chapters/_index.md",
      "update  chapters/chapter-01.md",
      "update  characters/_index.md",
      "delete  characters/edran-vale.md",
      "create  characters/mara-holt.md",
      "update  worldbuilding/_index.md",
      "Dry run: story rename would make 6 changes; nothing was written",
      ""
    ].join("\n"));
    const real = invoke(root, ["rename", "character", "edran-vale", "Mara Holt", "--prose", "--json"]);
    const envelope = JSON.parse(real.out);
    expect(envelope.data.prose).toEqual({
      edits: [
        { file: "chapters/chapter-01.md", line: 10, endLine: 10, column: 1, from: "Edran Vale", to: "Mara Holt" },
        { file: "chapters/chapter-01.md", line: 12, endLine: 12, column: 1, from: "Edran", to: "Mara" }
      ],
      aliases: 0,
      shared: 0,
      review: []
    });
    expect(prose(file)).toBe("Mara Holt smiled.\n\nMara left.\n");
  });

  test("renames CJK names and names written in decomposed Unicode", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "CJK", force: false });
    character(root, "li-ming", "name: 李明");
    character(root, "jose", "name: José");
    const file = chapter(root, 1, "李明说，李明的猫睡了。José's hat fell.");
    expect(invoke(root, ["rename", "character", "li-ming", "王芳", "--id", "wang-fang", "--prose"]).code).toBe(0);
    expect(invoke(root, ["rename", "character", "jose", "Iñigo", "--prose"]).code).toBe(0);
    expect(prose(file)).toBe("王芳说，王芳的猫睡了。Iñigo's hat fell.\n");
  });

  test("keeps the case of a first letter that differs from the name, and renames a location without its article", () => {
    const root = project();
    writeMarkdown(path.join(root, "worldbuilding", "locations", "the-hollow.md"), "name: The Hollow\ntype: valley", "\n# The Hollow\n");
    const file = chapter(root, 1, "The Hollow was cold; they left the Hollow. Hollow winds blew.");
    expect(invoke(root, ["rename", "location", "the-hollow", "The Deep", "--prose"]).code).toBe(0);
    expect(prose(file)).toBe("The Deep was cold; they left the Deep. Deep winds blew.\n");
  });

  test("keeps the id when --id names it, and still renames the prose", () => {
    const root = project();
    const file = chapter(root, 1, "Edran nodded.");
    const { code, out } = invoke(root, ["rename", "character", "edran-vale", "Arlo Vale", "--id", "edran-vale", "--prose"]);
    expect(code).toBe(0);
    expect(out).toContain("Renamed character edran-vale to edran-vale");
    expect(prose(file)).toBe("Arlo nodded.\n");
  });

  test("refuses a new name or given name another entity has, changing nothing", () => {
    const root = project();
    character(root, "ann-lee", "name: Ann Lee");
    const file = chapter(root, 1, "Edran nodded.");
    const before = fs.readFileSync(file, "utf8");
    const whole = invoke(root, ["rename", "character", "edran-vale", "Vale", "--prose"]);
    expect(whole.code).toBe(4);
    expect(whole.err).toContain("\"Vale\" is already a name of location vale, so --prose would give two entities one name in the text");
    const given = invoke(root, ["rename", "character", "edran-vale", "Ann Marsh", "--prose"]);
    expect(given.code).toBe(4);
    expect(given.err).toContain("\"Ann\" is already a name of character ann-lee");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.existsSync(path.join(root, "characters", "edran-vale.md"))).toBe(true);
    // Without --prose the name is the writer's call, as before.
    expect(invoke(root, ["rename", "character", "edran-vale", "Ann Marsh"]).code).toBe(0);
  });

  test("refuses a name the prose would share with a cut character or with another name's title-less form", () => {
    const root = project();
    writeMarkdown(path.join(root, "characters", "old-tom.md"), "name: Tom Reed\nrole: minor\nstatus: cut\naliases:\n  - Tommo", "\n# Tom\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "the-deep.md"), "name: The Deep\ntype: sea", "\n# The Deep\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "the-hollow.md"), "name: The Hollow\ntype: valley", "\n# The Hollow\n");
    chapter(root, 1, "Edran nodded.");
    const cut = invoke(root, ["rename", "character", "edran-vale", "Tommo", "--prose"]);
    expect(cut.code).toBe(4);
    expect(cut.err).toContain("\"Tommo\" is already a name of character old-tom");
    // "Old" is a title word, so the prose would also call it "Deep".
    const stripped = invoke(root, ["rename", "location", "the-hollow", "Old Deep", "--prose"]);
    expect(stripped.code).toBe(4);
    expect(stripped.err).toContain("\"Deep\" is already a name of location the-deep");
  });

  test("allows a name whose unchanged given name, or first word, another entity shares", () => {
    const root = project();
    character(root, "ann-lee", "name: Ann Lee");
    character(root, "ann-moss", "name: Ann Moss");
    character(root, "mara-holt", "name: Mara Holt");
    const file = chapter(root, 1, "Ann Lee waved from Vale.");
    expect(invoke(root, ["rename", "character", "ann-lee", "Ann Leigh", "--prose"]).code).toBe(0);
    expect(invoke(root, ["rename", "location", "vale", "Mara Point", "--prose"]).code).toBe(0);
    expect(prose(file)).toBe("Ann Leigh waved from Mara Point.\n");
  });

  test("never doubles a title the prose adds, and does not lower-case a new name that drops an article", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Titles", force: false });
    character(root, "edran-vale", "name: Edran Vale");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "hollow.md"), "name: Hollow\ntype: valley", "\n# Hollow\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "the-marsh.md"), "name: The Marsh\ntype: fen", "\n# The Marsh\n");
    const file = chapter(root, 1, "Captain Edran Vale crossed the Hollow and the Marsh.");
    expect(invoke(root, ["rename", "character", "edran-vale", "Captain Mara Holt", "--prose"]).code).toBe(0);
    expect(invoke(root, ["rename", "location", "hollow", "The Deep", "--prose"]).code).toBe(0);
    expect(invoke(root, ["rename", "location", "the-marsh", "Fenwick", "--prose"]).code).toBe(0);
    expect(prose(file)).toBe("Captain Mara Holt crossed the Deep and Fenwick.\n");
  });

  test("leaves a name two entities share as written, with a warning", () => {
    const root = project();
    character(root, "ann-lee", "name: Ann Lee");
    character(root, "ann-moss", "name: Ann Moss");
    const file = chapter(root, 1, "Ann Lee waved. Ann waved back.");
    const { code, out, err } = invoke(root, ["rename", "character", "ann-lee", "Bea Lee", "--prose"]);
    expect(code).toBe(0);
    expect(prose(file)).toBe("Bea Lee waved. Ann waved back.\n");
    expect(out).toContain("Renamed 1 name in 1 chapter\n");
    expect(err).toContain("--prose left 1 name that character ann-lee shares with another entity as written: chapters/chapter-01.md:10:16. Check them [prose-name-shared]");
  });

  test("leaves link and image targets, HTML tags, URLs, and reference definitions as written, and lists a reference's text", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Links", force: false });
    character(root, "ines-holt", "name: Ines Holt");
    const file = chapter(root, 1, [
      "![Ines](img/Ines.png) waved. [Ines](https://en.wikipedia.org/wiki/Ines_Holt) wrote from <https://example.com/Ines>, Ines@example.com.",
      "<img src=\"img/Ines.png\" alt=\"Ines\"> <a href=\"Ines.html\">Ines</a> smiled.",
      "",
      "She opened [Ines Holt]'s file and [Ines][] waved, said Ines.",
      "",
      "[ines holt]: files/ines.md",
      "[ines]: https://example.com/Ines"
    ].join("\n"));
    const { code, out } = invoke(root, ["rename", "character", "ines-holt", "Ruth Holt", "--prose"]);
    expect(code).toBe(0);
    const line = "She opened [Ines Holt]'s file and [Ines][] waved, said Ines.";
    expect(out).toContain([
      "Renamed 4 names in 1 chapter",
      "Left 2 matches as written; check each and rename it by hand if it is the name:",
      `chapters/chapter-01.md:13:13: Ines Holt (also the label of a reference link): ${line}`,
      `chapters/chapter-01.md:13:36: Ines (also the label of a reference link): ${line}`,
      ""
    ].join("\n"));
    expect(prose(file)).toBe([
      "![Ruth](img/Ines.png) waved. [Ruth](https://en.wikipedia.org/wiki/Ines_Holt) wrote from <https://example.com/Ines>, Ines@example.com.",
      "<img src=\"img/Ines.png\" alt=\"Ines\"> <a href=\"Ines.html\">Ruth</a> smiled.",
      "",
      "She opened [Ines Holt]'s file and [Ines][] waved, said Ruth.",
      "",
      "[ines holt]: files/ines.md",
      "[ines]: https://example.com/Ines",
      ""
    ].join("\n"));
  });

  test("never renames an initial as a given name, nor writes one", () => {
    const root = project();
    character(root, "j-r-dunn", "name: J. R. Dunn\naliases:\n  - J");
    character(root, "ines-holt", "name: Ines Holt");
    const file = chapter(root, 1, "J. R. Dunn wrote the letter J. J smiled. Ines Holt waved, and Ines's horse neighed. Edran nodded.");
    expect(invoke(root, ["rename", "character", "j-r-dunn", "Kim Dunn", "--prose"]).out).toContain("Renamed 1 name in 1 chapter; left 2 aliases as written\n");
    // A new given name that is an initial gives the new name without its
    // titles, as the full name does.
    expect(invoke(root, ["rename", "character", "ines-holt", "Dr K. Holt", "--prose"]).code).toBe(0);
    expect(invoke(root, ["rename", "character", "edran-vale", "K. Vale", "--prose"]).code).toBe(0);
    expect(prose(file)).toBe("Kim Dunn wrote the letter J. J smiled. K. Holt waved, and K. Holt's horse neighed. K. Vale nodded.\n");
  });

  test("lists a one-word match that may be an ordinary word instead of rewriting it", () => {
    const root = project();
    character(root, "may-dunn", "name: May Dunn");
    character(root, "rose-hale", "name: Rose Hale");
    const file = chapter(root, 1, "\"May I come in?\" May Dunn asked. It was late in May.\u001b]52;c;eA==\u0007\n\nShe cut a rose. Rose from her chair, she told Rose.");
    const before = fs.readFileSync(file, "utf8");
    const preview = invoke(root, ["rename", "character", "may-dunn", "June Dunn", "--prose", "--dry-run"]);
    expect(preview.code).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    // A control character in the line prints as U+FFFD.
    const excerpt = "\"May I come in?\" May Dunn asked. It was late in May.�]52;c;eA==�";
    expect(preview.out).toStartWith([
      "chapters/chapter-01.md:10:18: May Dunn → June Dunn",
      "Renamed 1 name in 1 chapter",
      "Left 2 matches as written; check each and rename it by hand if it is the name:",
      `chapters/chapter-01.md:10:2: May (may be an ordinary word): ${excerpt}`,
      `chapters/chapter-01.md:10:49: May (may be an ordinary word): ${excerpt}`,
      "update  chapters/_index.md",
      ""
    ].join("\n"));
    const real = JSON.parse(invoke(root, ["rename", "character", "may-dunn", "June Dunn", "--prose", "--json"]).out);
    expect(real.data.prose.edits.map((edit) => edit.to)).toEqual(["June Dunn"]);
    expect(real.data.prose.review).toEqual([
      { file: "chapters/chapter-01.md", line: 10, column: 2, text: "May", excerpt, reason: "ordinary-word" },
      { file: "chapters/chapter-01.md", line: 10, column: 49, text: "May", excerpt, reason: "ordinary-word" }
    ]);
    // "Rose" opening a sentence in a chapter that also says "a rose".
    const rose = invoke(root, ["rename", "character", "rose-hale", "Iris Hale", "--prose"]);
    expect(rose.out).toContain([
      "Renamed 1 name in 1 chapter",
      "Left 1 match as written; check it and rename it by hand if it is the name:",
      "chapters/chapter-01.md:12:17: Rose (may be an ordinary word): She cut a rose. Rose from her chair, she told Rose.",
      ""
    ].join("\n"));
    expect(prose(file)).toBe("\"May I come in?\" June Dunn asked. It was late in May.\u001b]52;c;eA==\u0007\n\nShe cut a rose. Rose from her chair, she told Iris.\n");
  });

  test("renames a one-word name that is a month, and a name written in lower case that opens a sentence", () => {
    const root = project();
    character(root, "april", "name: April");
    expect(invoke(root, ["add", "term", "aether"]).code).toBe(0);
    const file = chapter(root, 1, "April smiled. Later April left. It was April.\n\nThe aether hummed. Aether flowed.");
    const april = invoke(root, ["rename", "character", "april", "Iris", "--prose"]);
    expect(april.out).toContain("Renamed 3 names in 1 chapter\n");
    expect(invoke(root, ["rename", "term", "aether", "ether", "--prose"]).out).toContain("Renamed 2 names in 1 chapter\n");
    expect(prose(file)).toBe("Iris smiled. Later Iris left. It was Iris.\n\nThe ether hummed. Ether flowed.\n");
  });

  test("renames a name between compatibility ideographs that change length", () => {
    const root = project();
    const file = chapter(root, 1, "\ufa6c Edran \u{2f800} waited.");
    const { code, out } = invoke(root, ["rename", "character", "edran-vale", "Mara Holt", "--prose"]);
    expect(code).toBe(0);
    expect(out).toContain("chapters/chapter-01.md:10:3: Edran → Mara\nRenamed 1 name in 1 chapter\n");
    expect(prose(file)).toBe("\ufa6c Mara \u{2f800} waited.\n");
  });

  test("is refused for chapters and scenes", () => {
    const root = project();
    chapter(root, 1, "Text.");
    const { code, err } = invoke(root, ["rename", "chapter", "chapter-01", "Slack Water", "--prose"]);
    expect(code).toBe(2);
    expect(err).toContain("--prose does not apply to a chapter");
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { extractNameCandidates, importManuscript } from "../src/import.js";
import { createStoryProject, exportManuscript, scanProject, synopsisBook, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function importText(text, { name = "m.md", ...options } = {}) {
  const cwd = makeTempDir();
  fs.writeFileSync(path.join(cwd, name), text);
  const result = importManuscript({ source: name, title: "Imported", cwd, ...options });
  return { cwd, result, chapters: scanProject(result.root).chapters };
}

function chapterFile(root, number) {
  return fs.readFileSync(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), "utf8");
}

function chapterText(root, number) {
  return chapterFile(root, number).split("## Chapter Text\n")[1];
}

describe("import performance (#92)", () => {
  test("a long line of spaced hyphens imports in linear time", () => {
    const started = Date.now();
    const { chapters } = importText(`# Chapter 1\n\nHello.\n\n${" -".repeat(100000)}x\n`);
    expect(chapters).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("a synopsis made of initials splits in linear time", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Initials" });
    const storyPath = path.join(root, "story.md");
    const raw = fs.readFileSync(storyPath, "utf8");
    fs.writeFileSync(storyPath, raw.replace("# Synopsis", `# Synopsis\n\n${"A. ".repeat(30000)}\n\nThe end came.`), "utf8");
    const started = Date.now();
    synopsisBook(root);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("import word counts (#124)", () => {
  test("words inside HTML comments are not counted", () => {
    const { result, chapters } = importText("# Chapter 1: One\n\nShe walked.\n\n<!-- note to self: fix this later please -->\n\nHe ran.\n");
    expect(result.words).toBe(4);
    expect(chapters[0].declaredWordCount).toBe(4);
    expect(messages(validateProject(result.root).warnings).filter((warning) => warning.includes("declares"))).toEqual([]);
  });
});

describe("init and import --force on an existing project (#125, #153)", () => {
  test("new registries take the story id from the kept story.md", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "The Lamp at Gull Rock" });
    fs.rmSync(path.join(root, "style-sheet.md"));
    fs.rmSync(path.join(root, "continuity", "clues", "_index.md"));

    const again = createStoryProject({ cwd, title: "Lamp", dir: "the-lamp-at-gull-rock", force: true });

    expect(again.storyId).toBe("the-lamp-at-gull-rock");
    expect(fs.readFileSync(path.join(root, "continuity", "clues", "_index.md"), "utf8")).toContain("story: the-lamp-at-gull-rock");
    expect(messages(validateProject(root).errors)).toEqual([]);
  });

  test("init --force names the options a kept story.md did not take", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Alpha"]);

    const run = invoke(cwd, ["init", "New Name", "--dir", "alpha", "--force", "--genre", "horror", "--form", "novel"]);

    expect(run.code).toBe(0);
    expect(run.out).toContain("Updated story project:");
    expect(run.out).not.toContain("Created");
    expect(run.err).toContain("story.md already exists and was kept, so the title, --genre and --form were not applied");
    expect(fs.readFileSync(path.join(cwd, "alpha", "story.md"), "utf8")).toContain("title: Alpha");
  });

  test("init --force with matching options stays quiet", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Alpha"]);
    const run = invoke(cwd, ["init", "Alpha", "--force"]);
    expect(run.err).toBe("");
  });

  test("import --force warns that the title was kept and old references may dangle", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Old Title", "--dir", "book"]);
    fs.writeFileSync(path.join(cwd, "one.md"), "## Chapter 1\n\nOnly one.\n");

    const run = invoke(cwd, ["import", "one.md", "--title", "New Title", "--dir", "book", "--force"]);

    expect(run.code).toBe(0);
    expect(run.err).toContain("so --title was not applied");
    expect(run.err).toContain("Run story links");
    expect(run.err).not.toContain("--synopsis");
  });
});

describe("lone # scene breaks (#143)", () => {
  test("a lone # in a one-chapter file stays a scene break", () => {
    const { result, chapters } = importText("First paragraph of the story.\n\n#\n\nSecond scene opens here with many words.\n\nThird paragraph.\n", { name: "d.md" });
    expect(chapters[0].title).toBe("D");
    const text = chapterText(result.root, 1);
    expect(text).toContain("#\n\nSecond scene opens here with many words.");
    expect(chapters[0].declaredWordCount).toBe(14);
  });

  test("a lone # before the first chapter heading keeps the paragraph after it", () => {
    const { result } = importText("#\n\nA dedication paragraph that should survive.\n\n## Chapter 1\n\nBody text.\n");
    expect(chapterText(result.root, 1)).toContain("A dedication paragraph that should survive.");
  });
});

describe("headings in comments and code (#144)", () => {
  test("a chapter heading inside a comment or code fence does not split", () => {
    const { result, chapters } = importText("## Chapter 1: Start\n\nText.\n\n<!--\nOutline:\n## Chapter 2: Planned\nsomething\n-->\n\nMore of chapter one.\n\n```\n## Chapter 9: in code\n```\n\nStill chapter one.\n");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Start"]);
    expect(chapterText(result.root, 1)).toContain("## Chapter 9: in code");
    expect(messages(validateProject(result.root).warnings).join("\n")).not.toContain("never closes");
  });
});

describe("leading scene break with colons (#145)", () => {
  test("dialogue with colons after a leading --- is kept", () => {
    const { result } = importText("---\n\nShe said: go now.\nHe answered: never, not while the tide is high.\n\n---\n\nThe rest of the story.\n");
    expect(chapterText(result.root, 1)).toContain("She said: go now.");
  });

  test("a note after a leading --- and a blank line is kept", () => {
    const { result } = importText("---\n\nNote: the first scene opens at dawn.\n\n---\n\nThe rest.\n");
    expect(chapterText(result.root, 1)).toContain("Note: the first scene opens at dawn.");
  });

  test("real frontmatter is still removed", () => {
    const { result } = importText("---\ntitle: Old\nauthor:\n  name: Someone\n---\n# Chapter 1\n\nBody.\n");
    expect(chapterText(result.root, 1)).not.toContain("Someone");
  });
});

describe("byte-order mark (#146)", () => {
  test("the first chapter heading is found after a BOM", () => {
    const { chapters, result } = importText("﻿## Chapter 1: One\n\nAlpha text.\n\n## Chapter 2: Two\n\nBeta text.\n");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["One", "Two"]);
    expect(chapterText(result.root, 1)).not.toContain("## Chapter 1");
  });

  test("a single chapter titled on line 1 after a BOM", () => {
    const { chapters } = importText("﻿# The Only Chapter\n\nText.\n");
    expect(chapters[0].title).toBe("The Only Chapter");
  });
});

describe("setext headings (#147)", () => {
  test("setext chapter headings split and a setext book title is dropped", () => {
    const { chapters, result } = importText("The Book\n========\n\nChapter One\n-----------\n\nAlpha text here.\n\nChapter Two\n-----------\n\nBeta text here.\n");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(chapterText(result.root, 1).trim()).toBe("Alpha text here.");
  });
});

describe("heading titles (#148)", () => {
  test("closing hashes, decimal numbers, and hundreds are consumed", () => {
    const { chapters } = importText("## Chapter 2: Closing Hashes ##\n\nb\n\n## Chapter 12.5: Half\n\nf\n\n## Chapter One Hundred\n\no\n\n## Chapter One Hundred and Five: Late\n\np\n");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Closing Hashes", "Half", "Chapter 3", "Late"]);
  });
});

describe("entity candidates (#149)", () => {
  test("finds accented, curly-apostrophe, hyphenated, and Mc names and skips weekdays", () => {
    const paragraph = "“Where?” asked Élodie Durand. On Monday they left. Élodie laughed. O’Brien nodded; O’Brien always nodded. The King’s Road was shut. I told Anna-Maria to wait. Anna-Maria waited. McAllister argued. Then Élodie smiled, and Sarah ran.\n\n";
    const names = extractNameCandidates(paragraph.repeat(3)).map((candidate) => candidate.name);
    for (const name of ["Élodie", "Élodie Durand", "O’Brien", "King’s Road", "Anna-Maria", "McAllister", "Sarah"]) {
      expect(names).toContain(name);
    }
    for (const name of ["Monday", "Anna", "King", "Road"]) {
      expect(names).not.toContain(name);
    }
  });

  test("a possessive counts toward the name", () => {
    const names = extractNameCandidates("She met Élodie. She took Élodie’s coat. She saw Élodie’s hat.").map((candidate) => candidate.name);
    expect(names).toEqual(["Élodie"]);
  });
});

describe("non-text sources (#150)", () => {
  test("a zip file such as .docx is refused", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "book.docx"), Buffer.from("PK\x03\x04garbage", "latin1"));
    expect(() => importManuscript({ source: "book.docx", title: "Docx", cwd })).toThrow("zip archive");
    expect(fs.existsSync(path.join(cwd, "docx"))).toBe(false);
  });

  test("a binary file is refused", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "b.md"), Buffer.from([0x23, 0x20, 0x41, 0x00, 0x01]));
    expect(() => importManuscript({ source: "b.md", title: "Bin", cwd })).toThrow("not UTF-8 text");
  });

  test("Windows-1252 text is refused rather than corrupted", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "win.txt"), Buffer.from("Chapter 1\r\n\r\n\x93Hello,\x94 she said. Caf\xe9\r\n", "latin1"));
    expect(() => importManuscript({ source: "win.txt", title: "Win", cwd })).toThrow("not valid UTF-8");
  });
});

describe("comment-only preamble (#151)", () => {
  test("re-importing an export keeps the chapter count", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "src.md"), "## Chapter 1: A\n\nAlpha text.\n\n## Chapter 2: B\n\nBeta text.\n");
    const first = importManuscript({ source: "src.md", title: "Round Trip", cwd, dir: "one" });
    const { outFile } = exportManuscript(first.root);

    const again = importManuscript({ source: outFile, title: "Round Trip", cwd, dir: "two" });

    expect(again.chapters).toBe(2);
    expect(scanProject(again.root).chapters.map((chapter) => chapter.title)).toEqual(["A", "B"]);
    expect(chapterText(again.root, 1)).not.toContain("Generated by");
  });

  test("other comments before the first chapter move into it", () => {
    const { chapters, result } = importText("<!-- draft two -->\n\n## Chapter 1: A\n\nAlpha.\n");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["A"]);
    expect(chapterText(result.root, 1)).toContain("<!-- draft two -->\n\nAlpha.");
  });
});

describe("part headings (#152)", () => {
  test("each part heading opens the chapter after it", () => {
    const { result, chapters } = importText("# Part One: Land\n\n## Chapter 1\n\nAlpha.\n\n# Part Two: Sea\n\n## Chapter 2\n\nBeta.\n");
    expect(chapters).toHaveLength(2);
    expect(chapterText(result.root, 1).trim()).toBe("# Part One: Land\n\nAlpha.");
    expect(chapterText(result.root, 2).trim()).toBe("# Part Two: Sea\n\nBeta.");
  });

  test("a book title before a part heading is still dropped", () => {
    const { result } = importText("# The Book\n\n# Part One\n\n## Chapter 1\n\nAlpha.\n");
    expect(chapterText(result.root, 1).trim()).toBe("# Part One\n\nAlpha.");
  });
});

describe("directory import skips droppings (#177)", () => {
  test("hidden, AppleDouble, and Word lock files are not chapters", () => {
    const cwd = makeTempDir();
    const dir = path.join(cwd, "dj");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "chapter-1.md"), "# Chapter 1\n\nReal.\n");
    fs.writeFileSync(path.join(dir, "chapter-2.md"), "# Chapter 2\n\nTwo.\n");
    fs.writeFileSync(path.join(dir, "~$apter-1.md"), "lock junk\n");
    fs.writeFileSync(path.join(dir, ".chapter-1.md"), "# Chapter 1\n\nOld hidden copy.\n");
    fs.writeFileSync(path.join(dir, "._chapter-1.md"), Buffer.from([0, 5, 22, 7, 0, 2]));

    const result = importManuscript({ source: "dj", title: "J", cwd, dir: "dji" });

    expect(result.chapters).toBe(2);
    expect(chapterText(result.root, 1).trim()).toBe("Real.");
    expect(chapterText(result.root, 2).trim()).toBe("Two.");
  });
});

describe("import --force parse check (#178)", () => {
  test("a project file that does not parse stops import before any chapter changes", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Ff", "--dir", "ff"]);
    invoke(cwd, ["add", "chapter", "A", "--path", "ff"]);
    invoke(cwd, ["add", "chapter", "B", "--number", "100", "--path", "ff"]);
    fs.writeFileSync(path.join(cwd, "ff", "chapters", "notes.md"), "my notes\n");
    fs.writeFileSync(path.join(cwd, "one.md"), "# Chapter 1\n\nOnly one.\n");
    const before = chapterFile(path.join(cwd, "ff"), 1);

    expect(() => importManuscript({ source: "one.md", title: "T", cwd, dir: "ff", force: true })).toThrow("chapters/notes.md");

    expect(fs.existsSync(path.join(cwd, "ff", "chapters", "chapter-100.md"))).toBe(true);
    expect(chapterFile(path.join(cwd, "ff"), 1)).toBe(before);
  });

  test("broken chapter files that import replaces do not block it", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Gg", "--dir", "gg"]);
    fs.writeFileSync(path.join(cwd, "gg", "chapters", "chapter-01.md"), "no frontmatter\n");
    fs.writeFileSync(path.join(cwd, "one.md"), "# Chapter 1\n\nOnly one.\n");

    const result = importManuscript({ source: "one.md", title: "Gg", cwd, dir: "gg", force: true });

    expect(result.chapters).toBe(1);
    expect(messages(validateProject(result.root).errors)).toEqual([]);
  });
});

describe("dash conversion (#183)", () => {
  test("www. URLs, email addresses, and HTML attributes keep their hyphens", () => {
    const { result } = importText("# Chapter 1\n\nVisit www.example.com/a--b and a--b@mail.com and <span class=\"x--y\">t</span>. It was--oh.\n");
    expect(chapterText(result.root, 1).trim()).toBe("Visit www.example.com/a--b and a--b@mail.com and <span class=\"x--y\">t</span>. It was–oh.");
  });
});

describe("Story Skills chapter files (#185)", () => {
  test("a chapter file in Story Skills layout imports as one chapter with its prose", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Re", "--dir", "re"]);
    invoke(cwd, ["add", "chapter", "One", "--path", "re"]);
    invoke(cwd, ["add", "chapter", "Two", "--path", "re"]);
    fs.appendFileSync(path.join(cwd, "re", "chapters", "chapter-01.md"), "Prose of one.\n");
    fs.appendFileSync(path.join(cwd, "re", "chapters", "chapter-02.md"), "Prose of two.\n");
    fs.mkdirSync(path.join(cwd, "src"));
    for (const name of ["chapter-01.md", "chapter-02.md"]) {
      fs.copyFileSync(path.join(cwd, "re", "chapters", name), path.join(cwd, "src", name));
    }

    const result = importManuscript({ source: "src", title: "Re", cwd, dir: "out" });

    expect(scanProject(result.root).chapters.map((chapter) => chapter.title)).toEqual(["One", "Two"]);
    expect(chapterText(result.root, 1).trim()).toBe("Prose of one.");
  });
});

describe("CR line endings (#201)", () => {
  test("a CR-only source splits into chapters", () => {
    const { result, chapters } = importText("# Chapter 1: A\r\rShe ran.\r\r# Chapter 2: B\r\rHe hid.\r");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["A", "B"]);
    expect(chapterFile(result.root, 1)).not.toContain("\r");
  });
});

describe("portable folder names (#204)", () => {
  test.each(["con.txt", "COM1.book", "book.", "book ", "bo:ok", "a<b", "q?", "star*"])("refuses --dir %p", (dir) => {
    const cwd = makeTempDir();
    expect(() => createStoryProject({ cwd, title: "Book", dir })).toThrow("Windows");
    expect(fs.existsSync(path.join(cwd, dir))).toBe(false);
  });

  test("accepts an ordinary dotted folder name", () => {
    const cwd = makeTempDir();
    expect(createStoryProject({ cwd, title: "Book", dir: "book.v2" }).storyId).toBe("book");
  });
});

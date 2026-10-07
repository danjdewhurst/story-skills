import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { formatRuntime, narrationScript } from "../src/narration.js";
import { buildBook, createEntity, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, writeMarkdown, messages } from "./helpers.js";

function project() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Siorsa", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", "schema-version: 2\nauthor: Ada Writer\ncopyright: © 2026 Ada Writer\n"), "utf8");
  writeMarkdown(path.join(root, "characters", "siorsa.md"), "name: Siorsa\nrole: protagonist\nstatus: alive\npronunciation: SHUR-sha", "# Siorsa\n");
  writeMarkdown(path.join(root, "characters", "gone.md"), "name: Gone\nrole: minor\nstatus: cut\npronunciation: GON", "# Gone\n");
  writeMarkdown(path.join(root, "worldbuilding", "locations", "dun-eideann.md"), "name: Dùn Èideann\ntype: city\npronunciation: doon AY-jun", "# Dun\n");
  writeMarkdown(path.join(root, "worldbuilding", "factions", "the-ceilidh.md"), "name: The Ceilidh | Band\ntype: guild\nstatus: active\npronunciation: KAY-lee", "# C\n");
  writeMarkdown(path.join(root, "worldbuilding", "artifacts", "quaich.md"), "name: Quaich\ntype: object\nstatus: active\npronunciation: QUAYKH", "# Q\n");
  writeMarkdown(path.join(root, "glossary", "terms", "sgian.md"), "term: Sgian\ncategory: term\npronunciation: SKEE-an", "# S\n");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Arrival\nnumber: 1\nstatus: draft", `## Chapter Text\n\nShe *ran*.\n\n* * *\n\n${"word ".repeat(310)}\n`);
  createEntity(root, { kind: "matter", name: "Dedication" });
  fs.appendFileSync(path.join(root, "matter", "dedication.md"), "\nFor Morag.\n");
  createEntity(root, { kind: "matter", name: "Historical Note", placement: "back" });
  fs.appendFileSync(path.join(root, "matter", "historical-note.md"), "\nThe clans are invented.\n");
  return root;
}

// A collection or anthology (#520): one chapter per story, each with its
// own `author` (a name, a list, or null for none).
function collection(storyFields, authors) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Tales", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\n${storyFields}`), "utf8");
  authors.forEach((names, index) => {
    const author = names === null ? "" : Array.isArray(names) ? `\nauthor:\n${names.map((name) => `  - ${name}`).join("\n")}` : `\nauthor: ${names}`;
    writeMarkdown(path.join(root, "chapters", `chapter-0${index + 1}.md`), `title: Story ${index + 1}\nnumber: ${index + 1}\nstatus: draft${author}`, "## Chapter Text\n\nThe tide went out.\n");
  });
  return root;
}

function narration(root) {
  return fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8");
}

function newProject(title = "Bugs") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function appendProse(root, file, prose) {
  fs.appendFileSync(path.join(root, file), `\n${prose}\n`);
}

function build(root, format) {
  return fs.readFileSync(buildBook(root, { format, out: `dist/book.${format}` }).outFile, "utf8");
}

function reviewProject(fields = "") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Fixes", force: false });
  if (fields !== "") {
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\n${fields}\n`), "utf8");
  }
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nWords.\n");
  return { root, cwd };
}

describe("narration build", () => {
  test("writes the pronunciation guide, credits, runtimes, and pauses", () => {
    const root = project();
    const result = buildBook(root, { format: "narration" });
    expect(result.outFile).toBe(path.join(root, "dist", "siorsa.narration.md"));
    const text = fs.readFileSync(result.outFile, "utf8");

    expect(text).toContain("# Siorsa: Narration Script\n\nEstimated finished runtime: 0h 02m at 155 words per minute (318 words).");
    expect(text).toContain([
      "| Name | Say it | Kind |",
      "| --- | --- | --- |",
      "| Dùn Èideann | doon AY-jun | location |",
      "| Quaich | QUAYKH | artifact |",
      "| Sgian | SKEE-an | term |",
      "| Siorsa | SHUR-sha | character |",
      "| The Ceilidh \\| Band | KAY-lee | faction |"
    ].join("\n"));
    expect(text).not.toContain("GON");
    expect(text).toContain("## Opening Credits\n\nSiorsa. Written by Ada Writer. Narrated by [narrator].");
    expect(text).toContain("## Dedication\n\n[under 1 min]\n\nFor Morag.");
    expect(text).toContain("## Chapter 1: Arrival\n\n[about 2 min]\n\nShe *ran*.\n\n[pause]\n\nword word");
    expect(text).not.toContain("All rights reserved");
    expect(text).toContain("## Historical Note\n\n[under 1 min]\n\nThe clans are invented.\n\n## Closing Credits");
    expect(text.trimEnd().endsWith("You have been listening to Siorsa, written by Ada Writer, narrated by [narrator].")).toBe(true);
    expect(messages(validateProject(root).errors)).toEqual([]);
  });

  test("says how to add pronunciations when there are none, and validate checks their type", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Plain", force: false });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nHi.\n");
    const text = fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8");
    expect(text).toContain("No pronunciations recorded.");
    expect(text).toContain("## Opening Credits\n\nPlain. Narrated by [narrator].");
    expect(text).toContain("You have been listening to Plain, narrated by [narrator].");

    writeMarkdown(path.join(root, "glossary", "terms", "odd.md"), "term: Odd\ncategory: term\npronunciation:\n  - one\n  - two", "# Odd\n");
    expect(messages(validateProject(root).errors)).toContain("glossary/terms/odd.md frontmatter field pronunciation must be text");
  });

  test("#438 a backslash before a pipe in a table cell is escaped too", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Slash", force: false });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nHi.\n");
    writeMarkdown(path.join(root, "glossary", "terms", "either.md"), "term: Either \\| Or\ncategory: term\npronunciation: EE-ther \\*OR\\*", "# E\n");
    const text = fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8");
    expect(text).toContain("| Either \\\\\\| Or | EE-ther \\*OR\\* | term |");
  });

  test("a scene-break line is a pause with no blank line around it", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Tight", force: false });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nHe left.\n* * *\nShe came\nback.\n#\nEnd.\n");
    const text = fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8");
    expect(text).toContain("[under 1 min]\n\nHe left.\n\n[pause]\n\nShe came\nback.\n\n[pause]\n\nEnd.\n\n## Closing Credits");
  });

  test("#520 an anthology speaks each story's credit after its heading and names its editor and writers in the opening", () => {
    // Reading order is not alphabetical, so the opening's order is the stories'.
    const root = collection("editor: Cara Editor\nlabels:\n  - chapter-heading: \"{title}\"\n", ["Zoe Quill", ["Dee Writer", "Ben Other"], null, "Zoe Quill"]);
    const text = narration(root);
    expect(text).toContain("## Opening Credits\n\nTales. Narrated by [narrator].\n\nEdited by Cara Editor.\n\nWith contributions by Zoe Quill and Dee Writer and Ben Other.\n\n## Story 1");
    expect(text).toContain("## Story 1\n\n[under 1 min]\n\nWritten by Zoe Quill.\n\nThe tide went out.");
    expect(text).toContain("## Story 2\n\n[under 1 min]\n\nWritten by Dee Writer and Ben Other.\n\nThe tide went out.");
    // A story without `author` has no credit, and no credit is timed.
    expect(text).toContain("## Story 3\n\n[under 1 min]\n\nThe tide went out.");
    expect(text).toContain("## Story 4\n\n[under 1 min]\n\nWritten by Zoe Quill.\n\nThe tide went out.");
    expect(text).toContain("(16 words)");
    expect(text).toContain("You have been listening to Tales, narrated by [narrator].");
  });

  test("#520 an editor is credited in the opening, and as a writer only for their own story", () => {
    // As in the EPUB, an editor who wrote a story is not also a contributor.
    const text = narration(collection("editor: Ben Other\n", ["Zoe Quill", "Ben Other"]));
    expect(text).toContain("## Opening Credits\n\nTales. Narrated by [narrator].\n\nEdited by Ben Other.\n\nWith contributions by Zoe Quill.\n\n## Chapter 1");
    expect(text).toContain("## Chapter 2: Story 2\n\n[under 1 min]\n\nWritten by Ben Other.\n\nThe tide went out.");
    // An editor alone, with no story authors, is still credited.
    const edited = narration(collection("author: Ada Writer\neditor: Cara Editor\n", [null]));
    expect(edited).toContain("## Opening Credits\n\nTales. Written by Ada Writer. Narrated by [narrator].\n\nEdited by Cara Editor.\n\n## Chapter 1: Story 1\n\n[under 1 min]\n\nThe tide went out.");
  });

  test("#520 a book whose stories all name its own authors speaks no story credits", () => {
    const single = narration(collection("author: Ada Writer\n", ["Ada Writer", null, "Ada Writer"]));
    // The opening's "Written by Ada Writer." is the book's own credit.
    expect(single).not.toContain("min]\n\nWritten by");
    expect(single).not.toContain("With contributions by");
    expect(single).toContain("## Chapter 1: Story 1\n\n[under 1 min]\n\nThe tide went out.");
    // Joint authors in another order are still the book's own.
    const joint = narration(collection("authors:\n  - Ada Writer\n  - Ben Other\n", [["Ben Other", "Ada Writer"], ["Ada Writer", "Ben Other"]]));
    expect(joint).not.toContain("min]\n\nWritten by");
    expect(joint).not.toContain("With contributions by");
  });

  test("#520 a collection with a guest story credits every story and names only the guest in the opening", () => {
    const text = narration(collection("author: Ada Writer\n", ["Ada Writer", "Ben Other", null]));
    expect(text).toContain("## Opening Credits\n\nTales. Written by Ada Writer. Narrated by [narrator].\n\nWith contributions by Ben Other.\n\n");
    expect(text).toContain("## Chapter 1: Story 1\n\n[under 1 min]\n\nWritten by Ada Writer.\n\n");
    expect(text).toContain("## Chapter 2: Story 2\n\n[under 1 min]\n\nWritten by Ben Other.\n\n");
    expect(text).toContain("## Chapter 3: Story 3\n\n[under 1 min]\n\nThe tide went out.");
    // Co-writers of a joint book each writing their own stories are
    // credited story by story, but the opening already names them both.
    const joint = narration(collection("authors:\n  - Ada Writer\n  - Ben Other\n", ["Ada Writer", "Ben Other"]));
    expect(joint).toContain("## Chapter 1: Story 1\n\n[under 1 min]\n\nWritten by Ada Writer.\n\nThe tide went out.");
    expect(joint).toContain("## Chapter 2: Story 2\n\n[under 1 min]\n\nWritten by Ben Other.\n\nThe tide went out.");
    expect(joint).not.toContain("With contributions by");
  });

  test("#520 a name that ends a sentence takes no second full stop in any credit", () => {
    const text = narration(collection("author: Martin Luther King Jr.\n", ["Martin Luther King Jr.", "Ben Other Jr."]));
    expect(text).toContain("## Opening Credits\n\nTales. Written by Martin Luther King Jr. Narrated by [narrator].\n\nWith contributions by Ben Other Jr.\n\n");
    expect(text).toContain("[under 1 min]\n\nWritten by Martin Luther King Jr.\n\nThe tide went out.");
    expect(text).toContain("[under 1 min]\n\nWritten by Ben Other Jr.\n\nThe tide went out.");
    expect(text).toContain("You have been listening to Tales, written by Martin Luther King Jr., narrated by [narrator].");
    expect(text).not.toContain("..");
    // The stop the label ends on goes in the book's script too.
    const japanese = narration(collection("language: ja\neditor: Cara Ed.\n", ["山田"]));
    expect(japanese).toContain("編者、Cara Ed.\n\n");
  });

  test("#520 a line break in a title or name cannot start a heading in the script", () => {
    const root = collection("editor: \"Cara\\n## Editor\"\n", ["\"Zoe\\n## Closing Credits\"", "\"Ben Other\""]);
    writeMarkdown(path.join(root, "chapters", "chapter-03.md"), "title: \"Three\\n# Four\"\nnumber: 3\nstatus: draft", "## Chapter Text\n\nThe tide went out.\n");
    const text = narration(root);
    expect(text.split("\n").filter((line) => line.startsWith("#"))).toEqual([
      "# Tales: Narration Script",
      "## Pronunciation Guide",
      "## Opening Credits",
      "## Chapter 1: Story 1",
      "## Chapter 2: Story 2",
      "## Chapter 3: Three # Four",
      "## Closing Credits"
    ]);
    expect(text).toContain("Edited by Cara ## Editor.\n\nWith contributions by Zoe ## Closing Credits and Ben Other.");
    expect(text).toContain("Written by Zoe ## Closing Credits.");
  });

  test("#520 story credits follow the book's language and labels", () => {
    const german = narration(collection("language: de\neditor: Cara Editor\n", ["Zoe Quill", ["Dee Writer", "Ben Other"]]));
    expect(german).toContain("Herausgegeben von Cara Editor.\n\nMit Beiträgen von Zoe Quill und Dee Writer und Ben Other.");
    expect(german).toContain("Geschrieben von Dee Writer und Ben Other.");
    // Polish, Russian, and Ukrainian credits read the same for one name or several.
    const polish = narration(collection("language: pl\n", ["Zoe Quill", ["Dee Writer", "Ben Other"]]));
    expect(polish).toContain("Opowiadania: Zoe Quill i Dee Writer i Ben Other.");
    expect(polish).toContain("Tekst: Zoe Quill.");
    expect(polish).toContain("Tekst: Dee Writer i Ben Other.");
    const japanese = narration(collection("language: ja\n", ["山田", "佐藤"]));
    expect(japanese).toContain("『Tales』。朗読、[narrator]。\n\n寄稿、山田、佐藤。");
    expect(japanese).toContain("作、佐藤。");
    // Hindi credits name the work, not the person, so they take no gender (#539).
    const hindi = narration(collection("language: hi\neditor: Cara Editor\n", ["Zoe Quill", ["Dee Writer", "Ben Other"]]));
    expect(hindi).toContain("संपादन: Cara Editor।\n\nसहयोग: Zoe Quill और Dee Writer और Ben Other।");
    expect(hindi).toContain("लेखन: Dee Writer और Ben Other।");
    expect(hindi).not.toMatch(/लेखक|संपादक/);
    const custom = narration(collection("editor: Cara Editor\nlabels:\n  - narration-byline: \"A story by {names}.\"\n  - narration-edited-by: \"Selected by {names}.\"\n  - narration-contributors: \"Stories by {names}.\"\n", ["Ben Other"]));
    expect(custom).toContain("Selected by Cara Editor.\n\nStories by Ben Other.");
    expect(custom).toContain("A story by Ben Other.");
  });

  test("formatRuntime rounds to minutes", () => {
    expect(formatRuntime(0)).toBe("0h 00m");
    expect(formatRuntime(155 * 61)).toBe("1h 01m");
  });
});

describe("narration section times add up (#216)", () => {
  test("narration section times add up to the runtime", () => {
    const chapters = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, title: `C${index + 1}`, body: "word ".repeat(217) }));
    const script = narrationScript({ title: "N", meta: { authors: [] }, front: [], chapters, back: [] }, []);
    const minutes = [...script.matchAll(/\[about (\d+) min\]/g)].reduce((sum, match) => sum + Number(match[1]), 0);
    expect(script).toContain("0h 14m");
    expect(minutes).toBe(14);
  });
});

describe("#231 narration script", () => {
  test("in-prose headings are paragraphs, and a title ending in ? gets no extra period", () => {
    const root = newProject("Who Burns Next?");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    appendProse(root, "chapters/chapter-01.md", "Start.\n\n## The Letter\n\n> Dear Kael.\n\nShe folded it away.");
    const script = build(root, "narration");
    expect(script.match(/^## .*$/gm)).toEqual(["## Pronunciation Guide", "## Opening Credits", "## Chapter 1: One", "## Closing Credits"]);
    expect(script).toContain("\nThe Letter\n");
    expect(script).toContain("Who Burns Next? Narrated by [narrator].");
    expect(script).not.toContain("Next?.");
  });
});

describe("review fixes", () => {
  test("multi-line pronunciations stay on one table row", () => {
    const { root } = reviewProject();
    writeMarkdown(path.join(root, "glossary", "terms", "sgian.md"), "term: Sgian\ncategory: term\npronunciation: \"SKEE-an\\ndubh\"", "# S\n");
    const text = fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8");
    expect(text).toContain("| Sgian | SKEE-an dubh | term |");
  });
});

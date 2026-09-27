import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { fountainScript, inline, sceneHeading, timeOfDay } from "../src/fountain.js";
import { buildBook, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

// The screenplay-fountain eval fixture as a story project: Tomas alone in
// the lamp room of Greywidow Light at dusk.
function lighthouse(storyExtra = "author: Ada Writer\nform: novel\n") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "The Key on the Door", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\n${storyExtra}`), "utf8");
  writeMarkdown(path.join(root, "characters", "tomas-reyes.md"), "name: Tomas Reyes\nrole: protagonist\nstatus: alive", "# Tomas\n");
  writeMarkdown(path.join(root, "characters", "ana-reyes.md"), "name: Ana Reyes\nrole: supporting\nstatus: deceased", "# Ana\n");
  writeMarkdown(path.join(root, "worldbuilding", "locations", "lamp-room.md"), "name: Lamp Room\ntype: building\nsetting: interior", "# Lamp Room\n");
  writeMarkdown(path.join(root, "worldbuilding", "locations", "gallery.md"), "name: Gallery\ntype: building", "# Gallery\n");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Greywidow\nnumber: 1\nstatus: draft\ntime: morning", "## Chapter Text\n\nThe light.\n");
  writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: The Key\nnumber: 2\nstatus: draft", "## Chapter Text\n\nI climbed to the lamp room at dusk.\n");
  writeMarkdown(path.join(root, "chapters", "chapter-03.md"), "title: Unplanned\nnumber: 3\nstatus: draft", "## Chapter Text\n\nLater.\n");
  writeMarkdown(path.join(root, "scenes", "chapter-02-scene-01.md"), [
    "title: Lighting the Lamp",
    "chapter: chapter-02",
    "scene: 1",
    "status: draft",
    "pov: tomas-reyes",
    "location: lamp-room",
    "time: dusk",
    "characters:\n  - tomas-reyes",
    "mentions:\n  - ana-reyes",
    "outcome: yes-but",
    "dilemma: open the chest or lock the door"
  ].join("\n"), "# Lighting the Lamp\n");
  writeMarkdown(path.join(root, "scenes", "chapter-02-scene-02.md"), [
    "title: On the Gallery",
    "chapter: chapter-02",
    "scene: 2",
    "status: draft",
    "location: gallery",
    "date: 1897-11-02",
    "time: \"21:40\"",
    "characters:\n  - tomas-reyes\n  - ana-reyes",
    "flashback-to: the winter Ana left"
  ].join("\n"), "# On the Gallery\n");
  writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), [
    "title: Morning Watch",
    "chapter: chapter-01",
    "scene: 1",
    "status: draft",
    "pov: tomas-reyes",
    "location: gallery",
    "setting: exterior"
  ].join("\n"), "# Morning Watch\n");
  return root;
}

describe("fountain build", () => {
  test("writes a title page and one heading per scene record, in reading order", () => {
    const root = lighthouse();
    const result = buildBook(root, { format: "fountain" });
    expect(result.outFile).toBe(path.join(root, "dist", "the-key-on-the-door.fountain"));
    expect(result.format).toBe("fountain");
    expect(result.chapters).toBe(3);
    const text = fs.readFileSync(result.outFile, "utf8");

    expect(text.startsWith([
      "Title: The Key on the Door",
      "Credit: Written by",
      "Author: Ada Writer",
      "Source: Based on the novel by Ada Writer",
      "",
      "[[Scene skeleton built by story build"
    ].join("\n"))).toBe(true);
    // The scene's own setting wins over the location; the chapter's time
    // fills in for a scene without one.
    expect(text).toContain([
      "## Chapter 1: Greywidow",
      "",
      "EXT. GALLERY - MORNING",
      "",
      "= Morning Watch",
      "",
      "[[Source: chapter-01-scene-01]]",
      "[[Characters: TOMAS REYES]]",
      "[[Story time: morning]]",
      "",
      "## Chapter 2: The Key",
      "",
      "INT. LAMP ROOM - DUSK",
      "",
      "= Lighting the Lamp",
      "",
      "[[Source: chapter-02-scene-01]]",
      "[[Characters: TOMAS REYES]]",
      "[[Story time: dusk]]",
      "[[Dilemma: open the chest or lock the door]]",
      "[[Outcome: yes-but]]",
      "",
      ".GALLERY - NIGHT",
      "",
      "= On the Gallery",
      "",
      "[[Source: chapter-02-scene-02]]",
      "[[Characters: TOMAS REYES, ANA REYES]]",
      "[[Story time: 1897-11-02 21:40]]",
      "[[Flashback to: the winter Ana left]]",
      "[[No setting: add setting (interior, exterior, or both) to worldbuilding/locations/gallery.md or the scene for INT. or EXT.]]",
      "",
      "## Chapter 3: Unplanned",
      "",
      "[[No scene records for chapter-03: add them to outline this chapter.]]",
      ""
    ].join("\n"));
    // No prose is carried over: a screenplay is written, not converted.
    expect(text).not.toContain("I climbed");
    expect(result.warnings).toEqual([
      "No scene records for chapter-03: the screenplay has no headings for that chapter",
      "No setting (interior, exterior, or both) for gallery: their scene headings are forced without INT. or EXT."
    ]);
    expect(validateProject(root).errors).toEqual([]);
  });

  test("builds into adaptations/ once and never replaces the draft there", () => {
    const root = lighthouse();
    const out = path.join("adaptations", "screenplay", "the-key-on-the-door.fountain");
    buildBook(root, { format: "fountain", out });
    expect(fs.readFileSync(path.join(root, out), "utf8")).toContain("INT. LAMP ROOM - DUSK");
    expect(() => buildBook(root, { format: "fountain", out })).toThrow("Refusing to overwrite adaptations/screenplay/the-key-on-the-door.fountain");
    expect(() => buildBook(root, { format: "fountain", out: "scenes/script.fountain" })).toThrow("it is project source");
  });

  test("matter the skeleton does not read cannot stop it", () => {
    const root = lighthouse();
    writeMarkdown(path.join(root, "matter", "Bad Name.md"), "title: Dedication\nplacement: front", "For Ana.\n");
    expect(() => buildBook(root, { format: "markdown" })).toThrow("matter file names must be kebab-case");
    expect(fs.readFileSync(buildBook(root, { format: "fountain" }).outFile, "utf8")).toContain("INT. LAMP ROOM - DUSK");
  });

  test("warns about scenes without a location and scenes outside the book", () => {
    const root = lighthouse("");
    writeMarkdown(path.join(root, "scenes", "chapter-03-scene-01.md"), "title: Nowhere\nchapter: chapter-03\nscene: 1\nstatus: draft\npov: ghost\nmentions:\n  - ghost\ncharacters:\n  - stranger-one", "# Nowhere\n");
    writeMarkdown(path.join(root, "scenes", "chapter-09-scene-01.md"), "title: Stray\nchapter: chapter-09\nscene: 1\nstatus: draft\nlocation: lamp-room", "# Stray\n");
    writeMarkdown(path.join(root, "scenes", "chapter-03-scene-02.md"), "title: Missing Place\nchapter: chapter-03\nscene: 2\nstatus: draft\nlocation: sea-cave\nsetting: both", "# Missing\n");
    writeMarkdown(path.join(root, "scenes", "chapter-03-scene-03.md"), "title: Typo\nchapter: chapter-03\nscene: 3\nstatus: draft\nlocation: lamp-rooom", "# Typo\n");
    const result = buildBook(root, { format: "fountain" });
    const text = fs.readFileSync(result.outFile, "utf8");
    // No author: no credit lines, and the source names no one.
    expect(text.startsWith("Title: The Key on the Door\nSource: Based on the book\n\n")).toBe(true);
    // A pov who is only mentioned is not cast; an unknown id reads as a name.
    expect(text).toContain(".LOCATION TBD\n\n= Nowhere\n\n[[Source: chapter-03-scene-01]]\n[[Characters: STRANGER ONE]]\n[[No location on the scene record: set location for the heading.]]\n");
    expect(text).toContain("INT./EXT. SEA CAVE\n\n= Missing Place\n\n[[Source: chapter-03-scene-02]]\n[[No location record for sea-cave: fix the scene's location or add the location.]]\n");
    expect(text).toContain(".LAMP ROOOM\n\n= Typo\n\n[[Source: chapter-03-scene-03]]\n[[No location record for lamp-rooom: fix the scene's location or add the location.]]\n[[No setting: add setting (interior, exterior, or both) to the scene for INT. or EXT.]]\n");
    expect(text).not.toContain("Stray");
    expect(result.warnings).toEqual([
      "scenes/chapter-09-scene-01.md names chapter chapter-09, which is not in the book, and is left out of the screenplay",
      "scenes/chapter-03-scene-01.md has no location; its screenplay heading reads LOCATION TBD",
      "scenes/chapter-03-scene-02.md names location sea-cave, which has no record; run story links",
      "scenes/chapter-03-scene-03.md names location lamp-rooom, which has no record; run story links",
      "No setting (interior, exterior, or both) for gallery: their scene headings are forced without INT. or EXT."
    ]);
  });

  test("validate checks setting on locations and scenes", () => {
    const root = lighthouse();
    writeMarkdown(path.join(root, "worldbuilding", "locations", "yard.md"), "name: Yard\ntype: building\nsetting: outside", "# Yard\n");
    writeMarkdown(path.join(root, "scenes", "chapter-03-scene-01.md"), "title: Odd\nchapter: chapter-03\nscene: 1\nstatus: draft\nsetting:\n  - interior", "# Odd\n");
    const { errors } = validateProject(root);
    expect(errors).toContain("worldbuilding/locations/yard.md frontmatter field setting has unsupported value outside");
    expect(errors).toContain("scenes/chapter-03-scene-01.md frontmatter field setting must be a single value, not a list");
  });

  test("the CLI builds it and lists it among the formats", () => {
    const root = lighthouse();
    const io = memoryIo(root);
    expect(runCli(["build", root, "--format", "Fountain"], io)).toBe(0);
    expect(io.output()).toContain("Built 3 chapters as fountain to ");
    expect(io.error()).toContain("warning: No setting (interior, exterior, or both) for gallery");

    const bad = memoryIo(root);
    expect(runCli(["build", root, "--format", "fdx"], bad)).toBe(1);
    expect(bad.error()).toContain("Supported formats: markdown, epub, docx, shunn, html, print, narration, metadata, fountain");
  });
});

describe("fountain text", () => {
  test("record text cannot open emphasis, notes, or a boneyard", () => {
    expect(inline("  a\tb\n\u0007c\u0085d\u2028e  ")).toBe("a b c d e");
    expect(inline("*bold* _under_ back\\slash")).toBe("\\*bold\\* \\_under\\_ back\\\\slash");
    expect(inline("[[note]] and [[[deep]]]")).toBe("[ [note] ] and [ [ [deep] ] ]");
    expect(inline("/* cut */")).toBe("/\\* cut \\*/");
    expect(inline(undefined)).toBe("");
  });

  test("scene headings", () => {
    const heading = (fields) => sceneHeading({ locationName: "Lamp Room", setting: "interior", time: "", ...fields });
    expect(heading({})).toBe("INT. LAMP ROOM");
    expect(heading({ setting: "exterior", time: "dawn" })).toBe("EXT. LAMP ROOM - DAWN");
    expect(heading({ setting: "both", time: "evening" })).toBe("INT./EXT. LAMP ROOM - EVENING");
    // Without a setting, a heading is forced with one period and a letter.
    expect(heading({ setting: "", locationName: "...'Tween Decks" })).toBe(".TWEEN DECKS");
    expect(heading({ setting: "", locationName: "***" })).toBe(".LOCATION TBD");
    expect(heading({ locationName: "" })).toBe("INT. LOCATION TBD");
    // A trailing #...# would read as a scene number.
    expect(heading({ locationName: "Pier #4#" })).toBe("INT. PIER #4");
    expect(heading({ locationName: "#", time: "" })).toBe("INT. LOCATION TBD");
    expect(heading({ locationName: "Hold_2 *aft*" })).toBe("INT. HOLD\\_2 \\*AFT\\*");
  });

  test("time of day", () => {
    expect(timeOfDay("midday")).toBe("DAY");
    expect(timeOfDay("Afternoon")).toBe("DAY");
    expect(timeOfDay("night")).toBe("NIGHT");
    expect(timeOfDay("morning")).toBe("MORNING");
    expect(timeOfDay("05:59")).toBe("NIGHT");
    expect(timeOfDay("06:00")).toBe("DAY");
    expect(timeOfDay("17:59")).toBe("DAY");
    expect(timeOfDay("18:00")).toBe("NIGHT");
    expect(timeOfDay("later that day")).toBe("LATER THAT DAY");
    expect(timeOfDay("")).toBe("");
  });

  test("sections, synopses, and notes stay single elements", () => {
    const text = fountainScript({
      title: "*Glass* [[Plates]]",
      authors: ["Ada Writer", "  ", "Bo_Two"],
      form: "short-story",
      chapters: [{
        id: "chapter-01",
        heading: "## Chapter 1: #Two",
        scenes: [{
          id: "chapter-01-scene-01",
          title: "= Open /* here",
          locationName: "Harbor",
          setting: "exterior",
          time: "",
          date: "",
          cast: ["Mara"],
          dilemma: "",
          outcome: "",
          flashbackTo: "",
          notes: ["ends in [a]"]
        }]
      }, { id: "chapter-02", heading: "", scenes: [] }]
    });
    expect(text).toContain("Title: \\*Glass\\* [ [Plates] ]\nCredit: Written by\nAuthor: Ada Writer and Bo\\_Two\nSource: Based on the short story by Ada Writer and Bo\\_Two\n");
    expect(text).toContain("## Chapter 1: #Two\n");
    expect(text).toContain("## Untitled\n");
    expect(text).toContain("EXT. HARBOR\n\n= = Open /\\* here\n\n[[Source: chapter-01-scene-01]]\n[[Characters: MARA]]\n[[ends in [a] ]]\n");
    expect(text).not.toContain("/*");
  });
});

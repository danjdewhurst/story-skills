import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { buildContext, characterStateAt, estimateTokens, formatContext } from "../src/context.js";
import { chapterChronology } from "../src/chronology.js";
import { createStoryProject, draftingContext, scanProject } from "../src/story.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const RESULT_SCHEMA = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

// A --json run: one envelope on stdout that matches the result schema.
function invokeJson(cwd, argv) {
  const result = invoke(cwd, [...argv, "--json"]);
  expect(result.err).toBe("");
  const envelope = JSON.parse(result.out);
  expect(validateAgainstSchema(envelope, RESULT_SCHEMA)).toEqual([]);
  expect(envelope.ok).toBe(result.code === 0);
  return { ...result, envelope };
}

const EXAMPLES = path.join(import.meta.dir, "..", "examples");

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// Four chapters. Everything set up in chapter 3 or 4 carries a SPOILER marker,
// so a test drafting chapter 2 can assert none of it leaks.
function contextProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Context Book", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8")
    .replace("themes:", "premise: Truth costs more than silence\nthemes:")
    .replace("Add notes on the story's voice, texture, and emotional register.", "Spare and cold.")
    .replace("## Notes\n", "## Setting\n\nA drowned mill town.\n\n## Notes\n\nSPOILER-NOTES the miller did it.\n")
    .replace(/## Synopsis\n\n[^#]*/, "## Synopsis\n\nSPOILER-SYNOPSIS Jonas confesses in the end.\n\n"), "utf8");

  const chapter = (number, extra = "", body = "## Chapter Text\n\nProse.\n") => writeMarkdown(
    path.join(root, "chapters", `chapter-0${number}.md`),
    `title: Chapter ${number}\nnumber: ${number}\nstatus: draft\npov: mara-finn\ncharacters:\n  - mara-finn\n  - jonas-reed\n  - ghost-id\n${extra}`,
    `# Chapter ${number}\n\n${body}`
  );
  chapter(1, "date: 2024-01-01\n");
  chapter(2, "date: 2024-01-05\ntime: dawn\nhook: question\ntarget-words: 2500\nmentions:\n  - edran-vale\nlocations:\n  - the-mill\n",
    "## Outline\n\n1. Mara finds the letter\n2. Jonas lies\n\n---\n\n## Chapter Text\n\nSPOILER-PROSE of chapter two.\n");
  chapter(3, "date: 2024-01-02\n", "## Outline\n\nSPOILER-OUTLINE-3\n\n## Chapter Text\n\nProse.\n");
  chapter(4, "", "## Outline\n\nSPOILER-OUTLINE-4\n");

  writeMarkdown(path.join(root, "characters", "mara-finn.md"), "name: Mara Finn\nrole: protagonist\nstatus: alive\nvoice-words:\n  - reckon\naliases:\n  - The Diver",
    "# Mara\n\n## Appearance\n\nSalt-grey hair.\n\n### Scars\n\nA hook scar.\n\n## Personality & Traits\n\nAdd behavior, temperament, habits, and contradictions.\n\n## Character Arc\n\nSPOILER-ARC she forgives him.\n\n## Timeline\n\nSPOILER-TIMELINE\n");
  writeMarkdown(path.join(root, "characters", "jonas-reed.md"), "name: Jonas Reed\nrole: supporting\nstatus: deceased\ndied-in: chapter-04", "# Jonas\n");
  writeMarkdown(path.join(root, "characters", "edran-vale.md"), "name: Edran Vale\nrole: minor\nstatus: deceased\ndied-in: chapter-01", "# Edran\n");

  const statePath = path.join(root, "continuity", "state.md");
  fs.writeFileSync(statePath, fs.readFileSync(statePath, "utf8").replace("current-chapter: 0", "current-chapter: 1").replace("character-state: []", `character-state:
  - character: mara-finn
    location: the-mill
    emotional: wary
  - character: jonas-reed
    emotional: SPOILER-OTHER-STATE
  - not a mapping`).replace("knowledge-state: []", `knowledge-state:
  - character: mara-finn
    knows: The mill had two owners
  - character: mara-finn
    knows: The letter is forged
    learned-in: chapter-01
  - character: mara-finn
    knows: The ledger names the buyer
    learned-in: chapter-02
  - character: mara-finn
    knows: SPOILER-KNOWLEDGE-3 read later but dated earlier
    learned-in: chapter-03
  - character: mara-finn
    knows: SPOILER-KNOWLEDGE-4
    learned-in: chapter-04
  - character: mara-finn
    knows: SPOILER-KNOWLEDGE-UNKNOWN
    learned-in: chapter-09
  - character: jonas-reed
    knows: SPOILER-OTHER-CHARACTER
  - character: mara-finn
    knows: ""
  - just text`), "utf8");

  const scene = (chapterId, number, extra, purpose) => writeMarkdown(
    path.join(root, "scenes", `${chapterId}-scene-0${number}.md`),
    `title: ${chapterId} scene ${number}\nchapter: ${chapterId}\nscene: ${number}\nstatus: draft\n${extra}`,
    `# Scene\n\n## Purpose\n\n${purpose}\n`
  );
  scene("chapter-01", 1, "pov: mara-finn\nlocation: the-mill\noutcome: no\nstate-changes:\n  - character: mara-finn\n    physical: cut hand\n  - target: brass-key\n    owner: mara-finn\n    change: finds the key\n  - target: brass-key\n    owner: jonas-reed\n  - character: jonas-reed\n    physical: SPOILER-NOT-POV\n  - loose", "Mara reaches the mill.");
  scene("chapter-01", 2, "state-changes: []", "What this scene changes.");
  scene("chapter-02", 1, "pov: mara-finn\noutcome: yes-but\ncharacters:\n  - mara-finn\n  - edran-vale", "Mara opens the letter.");
  scene("chapter-02", 2, "pov: mara-finn\nstate-changes:\n  - character: mara-finn\n    knowledge: SPOILER-LATER-SCENE", "SPOILER-SCENE-2-2");
  scene("chapter-03", 1, "state-changes:\n  - character: mara-finn\n    physical: SPOILER-SCENE-3", "SPOILER-SCENE-3-PURPOSE");

  const thread = (dir, id, frontmatter, body) => writeMarkdown(path.join(root, "continuity", dir, `${id}.md`), `title: ${id}\n${frontmatter}`, body);
  thread("promises", "open-promise", "status: planted\nplanted: chapter-01\npayoff: chapter-04", "# P\n\n## Setup\n\nThe locked box.\n\n## Payoff\n\nSPOILER-PAYOFF the box is empty.\n");
  thread("promises", "closed-promise", "status: paid-off\nplanted: chapter-01\npayoff: chapter-01", "# P\n\n## Setup\n\nSPOILER-CLOSED\n");
  thread("promises", "later-promise", "status: planned\nplanted: chapter-03", "# P\n\n## Setup\n\nSPOILER-LATER-PROMISE\n");
  thread("promises", "dropped-promise", "status: dropped\nplanted: chapter-01", "# P\n\n## Setup\n\nSPOILER-DROPPED\n");
  thread("promises", "unplanted-promise", "status: planned", "# P\n\n## Setup\n\nSPOILER-UNPLANTED\n");
  thread("promises", "here-promise", "status: planted\nplanted: chapter-01\npayoff: chapter-02", "# P\n\n## Setup\n\nWhat is promised to the reader.\n");
  thread("clues", "here-clue", "status: planned\nplanted: chapter-02\nred-herring: true", "# C\n\n## Clue\n\nMuddy boots.\n");
  thread("clues", "abandoned-clue", "status: abandoned\nplanted: chapter-01", "# C\n\n## Clue\n\nSPOILER-ABANDONED\n");
  thread("questions", "who-lied", "status: answered\nintroduced: chapter-02\nresolved: chapter-02", "# Q\n\n## Question\n\nWho lied?\n");
  return { root, cwd };
}

function contextOf(root, target, options) {
  return draftingContext(root, target, options);
}

function textOf(context) {
  return formatContext(context);
}

describe("story context", () => {
  test("packs the target, essentials, POV state, cards, threads, and earlier scenes", () => {
    const { root } = contextProject();
    const text = textOf(contextOf(root, "chapter-02"));

    expect(text).toContain("# Drafting context: chapter-02");
    expect(text).toContain("### Chapter 2: Chapter 2");
    expect(text).toContain("- POV: Mara Finn (mara-finn)");
    expect(text).toContain("- On the page: Mara Finn (mara-finn), Jonas Reed (jonas-reed), ghost-id");
    expect(text).toContain("- Mentioned: Edran Vale (edran-vale)");
    expect(text).toContain("- Locations: the-mill");
    expect(text).toContain("- Date: 2024-01-05 dawn");
    expect(text).toContain("- Hook: question");
    expect(text).toContain("- Target words: 2500");
    expect(text).toContain("Chapter outline:\n\n1. Mara finds the letter\n2. Jonas lies\n\nScenes planned:\n\n1. chapter-02 scene 1 (outcome: yes-but)\n2. chapter-02 scene 2");

    expect(text).toContain("- Language: en");
    expect(text).toContain("- Writing mode: horizontal");
    expect(text).toContain("- Chapter numerals: western");
    expect(text).toContain("- Count unit: words");
    expect(text).toContain("- Premise: Truth costs more than silence");
    expect(text).toContain("#### Tone & Style\n\nSpare and cold.");
    expect(text).toContain("#### Setting\n\nA drowned mill town.");

    expect(text).toContain("- The mill had two owners (reader-knowledge, pre-existing)");
    expect(text).toContain("- The letter is forged (reader-knowledge, learned in chapter-01)");
    expect(text).toContain("- The ledger names the buyer (reader-knowledge, learned in this chapter)");
    expect(text).toContain("- As of chapter 1: location the-mill; emotional wary");
    expect(text).toContain("- chapter-01 scene 1: physical cut hand");
    expect(text).toContain("- chapter-01 scene 1: target brass-key; owner mara-finn; change finds the key");
    expect(text).not.toContain("owner jonas-reed");
    // The style sheet story init writes is starter text only.
    expect(text).toContain("### Style sheet\n- Dialect: unspecified\n\n## POV knowledge and state");

    expect(text).toContain("### Mara Finn (POV)");
    expect(text).toContain("- Aliases: The Diver");
    expect(text).toContain("- Voice words: reckon");
    // Embedded headings are pushed below the card's own heading.
    expect(text).toContain("#### Appearance\n\nSalt-grey hair.\n\n##### Scars");
    expect(text).not.toContain("#### Personality & Traits");
    expect(text).toContain("### Jonas Reed\n- Id: jonas-reed\n- Role: supporting\n- Status: alive");

    expect(text).toContain("- **open-promise** (promise; planted in chapter-01)\n  The locked box.");
    expect(text).toContain("- **here-promise** (promise; planted in chapter-01; pay off in this chapter)");
    expect(text).toContain("- **here-clue** (clue; plant in this chapter; red herring)\n  Muddy boots.");
    expect(text).toContain("- **who-lied** (question; raise in this chapter; answer in this chapter)\n  Who lied?");

    expect(text).toContain("## Previous scenes\n\n- **chapter-01 scene 1: chapter-01 scene 1** (POV mara-finn, at the-mill, outcome no)\n  Mara reaches the mill.\n- **chapter-01 scene 2: chapter-01 scene 2**\n");
    expect(text).not.toContain("Left out to fit the budget");
  });

  test("includes nothing from chapters after the target, except a labeled unread flashback fact", () => {
    const { root } = contextProject();
    const context = contextOf(root, "chapter-02");
    const text = textOf(context);
    const json = JSON.stringify(context);
    const { envelope, out } = invokeJson(path.dirname(root), ["context", "chapter-02", "--path", root]);
    expect(envelope.data.target.id).toBe("chapter-02");
    // Chapter 3 is dated before chapter 2, so Mara already knows this and
    // the reader has not been shown it. The fact stays, marked do not reveal.
    const flashback = "SPOILER-KNOWLEDGE-3 read later but dated earlier (character-knowledge, learned in chapter-03; not yet shown to the reader, do not reveal)";
    expect(text).toContain(flashback);
    for (const output of [text, json, out]) {
      expect(output.split(flashback).join("")).not.toContain("SPOILER");
    }
    expect(text.split(flashback).join("")).not.toContain("chapter-03");
    expect(text).not.toContain("closed-promise");
    expect(text).not.toContain("later-promise");
    expect(text).not.toContain("chapter-04");
  });

  test("a scene target sees only the earlier scenes of its own chapter", () => {
    const { root } = contextProject();
    const first = textOf(contextOf(root, "chapter-02-scene-01"));
    expect(first).toContain("### Scene 1 of Chapter 2: Chapter 2");
    expect(first).toContain("- Scene: chapter-02 scene 1");
    expect(first).toContain("- On the page: Mara Finn (mara-finn), Edran Vale (edran-vale)");
    expect(first).toContain("- Outcome: yes-but");
    expect(first).toContain("Scene purpose:\n\nMara opens the letter.");
    expect(first).toContain("### Edran Vale\n- Id: edran-vale\n- Role: minor\n- Status: deceased (died in chapter-01)");
    const flashback = "SPOILER-KNOWLEDGE-3 read later but dated earlier (character-knowledge, learned in chapter-03; not yet shown to the reader, do not reveal)";
    expect(first).toContain(flashback);
    expect(first.split(flashback).join("")).not.toContain("SPOILER");

    expect(first).not.toContain("The ledger names the buyer");
    expect(first).not.toContain("possibly in a later scene");

    const second = textOf(contextOf(root, "chapter-02-scene-02"));
    // Learned in this chapter, and no earlier scene records it.
    expect(second).not.toContain("The ledger names the buyer");
    expect(second).not.toContain("possibly in a later scene");
    expect(second).toContain("- The letter is forged (reader-knowledge, learned in chapter-01)");
    expect(second).toContain("- **chapter-02 scene 1: chapter-02 scene 1** (POV mara-finn, outcome yes-but)\n  Mara opens the letter.");
    // Its own purpose is the thing being drafted.
    expect(second).toContain("Scene purpose:\n\nSPOILER-SCENE-2-2");
    expect(second).not.toContain("SPOILER-LATER-SCENE");
  });

  test("a scene includes a same-chapter fact only when an earlier scene records it", () => {
    const { root } = contextProject();
    const statePath = path.join(root, "continuity", "state.md");
    fs.writeFileSync(statePath, fs.readFileSync(statePath, "utf8").replace(
      "    knows: The ledger names the buyer\n    learned-in: chapter-02",
      `    knows: The ledger names the buyer
    fact: ledger-buyer
    learned-in: chapter-02
  - character: mara-finn
    knows: The tide chart is wrong.
    learned-in: chapter-02
  - character: mara-finn
    knows: The door is locked
    fact: door-locked
    learned-in: chapter-02
  - character: mara-finn
    knows: The window is open
    fact: window-open
    learned-in: chapter-02
  - character: mara-finn
    knows: .
    learned-in: chapter-02
  - character: mara-finn
    knows: The buyer is the miller
    fact: miller-buyer
    learned-in: chapter-02`
    ), "utf8");

    // An earlier chapter recording the secret does not make it known in
    // this chapter's first scene: learned-in still says this chapter.
    const earlier = path.join(root, "scenes", "chapter-01-scene-01.md");
    fs.writeFileSync(earlier, fs.readFileSync(earlier, "utf8").replace(
      "  - loose",
      `  - loose
  - character: mara-finn
    fact: miller-buyer
    knowledge: recorded too early`
    ), "utf8");

    writeMarkdown(
      path.join(root, "scenes", "chapter-02-scene-01.md"),
      `title: chapter-02 scene 1
chapter: chapter-02
scene: 1
status: draft
pov: mara-finn
outcome: yes-but
characters:
  - mara-finn
  - edran-vale
state-changes:
  - loose
  - character: jonas-reed
    knowledge: The buyer is the miller
  - character: mara-finn
    physical: cut hand
  - character: mara-finn
    knowledge: 1
  - character: mara-finn
    fact: other-fact
    knowledge: something else
  - character: mara-finn
    fact: ledger-buyer
    knowledge: She finds the name in the margin
  - character: mara-finn
    knowledge: the tide chart is wrong
  - character: mara-finn
    fact: wrong-id
    knowledge: The door is locked!
  - character: mara-finn
    knowledge: "  The   window is open.  "`,
      "# Scene\n\n## Purpose\n\nMara opens the letter.\n"
    );
    writeMarkdown(
      path.join(root, "scenes", "chapter-02-scene-04.md"),
      `title: chapter-02 scene 4
chapter: chapter-02
scene: 4
status: draft
pov: mara-finn
state-changes:
  - character: mara-finn
    fact: miller-buyer
    knowledge: The buyer is the miller`,
      "# Scene\n\n## Purpose\n\nThe reveal.\n"
    );
    writeMarkdown(
      path.join(root, "scenes", "chapter-02-scene-05.md"),
      "title: chapter-02 scene 5\nchapter: chapter-02\nscene: 5\nstatus: draft\npov: mara-finn",
      "# Scene\n\n## Purpose\n\nAfter the reveal.\n"
    );

    const chapter = textOf(contextOf(root, "chapter-02"));
    expect(chapter).toContain("- The ledger names the buyer (reader-knowledge, learned in this chapter)");
    expect(chapter).toContain("- The tide chart is wrong. (reader-knowledge, learned in this chapter)");
    expect(chapter).toContain("- The door is locked (reader-knowledge, learned in this chapter)");
    expect(chapter).toContain("- The window is open (reader-knowledge, learned in this chapter)");
    expect(chapter).toContain("- The buyer is the miller (reader-knowledge, learned in this chapter)");
    expect(chapter).not.toContain("possibly in a later scene");

    const scene1 = textOf(contextOf(root, "chapter-02-scene-01"));
    expect(scene1).toContain("- The letter is forged (reader-knowledge, learned in chapter-01)");
    expect(scene1).toContain("- The mill had two owners (reader-knowledge, pre-existing)");
    expect(scene1).not.toContain("The ledger names the buyer");
    expect(scene1).not.toContain("The tide chart is wrong");
    expect(scene1).not.toContain("The door is locked");
    expect(scene1).not.toContain("The window is open");
    expect(scene1).not.toContain("The buyer is the miller");

    const scene2 = textOf(contextOf(root, "chapter-02-scene-02"));
    expect(scene2).toContain("- The ledger names the buyer (reader-knowledge, learned in this chapter, scene 1)");
    expect(scene2).toContain("- The tide chart is wrong. (reader-knowledge, learned in this chapter, scene 1)");
    expect(scene2).toContain("- The door is locked (reader-knowledge, learned in this chapter, scene 1)");
    expect(scene2).toContain("- The window is open (reader-knowledge, learned in this chapter, scene 1)");
    expect(scene2).not.toContain("The buyer is the miller");
    expect(scene2).not.toContain("possibly in a later scene");

    const scene4 = textOf(contextOf(root, "chapter-02-scene-04"));
    expect(scene4).not.toContain("The buyer is the miller");

    const scene5 = textOf(contextOf(root, "chapter-02-scene-05"));
    expect(scene5).toContain("- The buyer is the miller (reader-knowledge, learned in this chapter, scene 4)");
  });

  test("a scene with no POV of its own uses its chapter's", () => {
    const { root } = contextProject();
    const text = textOf(contextOf(root, "chapter-01-scene-02"));
    expect(text).toContain("- POV: Mara Finn (mara-finn)");
    expect(text).toContain("### Mara Finn (POV)");
    expect(text).toContain("- chapter-01 scene 1: physical cut hand");
  });

  test("the target shows its chapter's beat above the hook, for the chapter and its scenes", () => {
    const { root } = contextProject();
    const file = path.join(root, "chapters", "chapter-02.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("hook: question\n", "hook: question\nbeat: Midpoint\n"), "utf8");
    expect(textOf(contextOf(root, "chapter-02"))).toContain("- Beat: Midpoint\n- Hook: question\n");
    expect(textOf(contextOf(root, "chapter-02-scene-01"))).toContain("- Beat: Midpoint\n");
    expect(textOf(contextOf(root, "chapter-01"))).not.toContain("- Beat:");
  });

  test("omitted items name every file they draw on", () => {
    const { root } = contextProject();
    const context = contextOf(root, "chapter-02-scene-02", { budget: "1" });
    const sources = new Map(context.omitted.map((entry) => [entry.id, entry.source]));
    expect(sources.get("target:chapter-02-scene-02")).toBe(`${"chapters/chapter-02.md"}, ${"scenes/chapter-02-scene-02.md"}`);
    expect(sources.get("state:mara-finn")).toBe(`${"continuity/state.md"}, ${"scenes/chapter-01-scene-01.md"}`);
  });

  test("state.md is used only when it describes a point before the target", () => {
    const { root } = contextProject();
    expect(textOf(contextOf(root, "chapter-01"))).not.toContain("As of chapter");
  });

  test("--scenes limits the earlier scenes, nearest first", () => {
    const { root } = contextProject();
    const one = textOf(contextOf(root, "chapter-02", { scenes: "1" }));
    expect(one).toContain("chapter-01 scene 2");
    expect(one).not.toContain("Mara reaches the mill.");
    expect(textOf(contextOf(root, "chapter-02", { scenes: "0" }))).not.toContain("## Previous scenes");
  });

  test("a small budget drops items in priority order and lists them", () => {
    const { root } = contextProject();
    const context = contextOf(root, "chapter-02", { budget: "260" });
    expect(context.estimatedTokens).toBeLessThanOrEqual(260);
    const text = textOf(context);
    expect(text).toContain("## Target");
    expect(text).toContain("## Left out to fit the budget");
    expect(context.omitted.length).toBeGreaterThan(0);
    for (const entry of context.omitted) {
      expect(text).toContain(`- ${entry.label}: ${entry.source} (about ${entry.tokens} tokens)`);
    }
    // A later, smaller item can still fit after a bigger one is left out.
    const tiny = contextOf(root, "chapter-02", { budget: "1" });
    expect(tiny.estimatedTokens).toBe(0);
    expect(textOf(tiny)).not.toContain("## Target");
  });

  test("the language contract fits a budget the story essentials do not", () => {
    const { root } = contextProject();
    const full = contextOf(root, "chapter-02", { budget: "100000" });
    const tokensOf = (id) => full.sections.flatMap((section) => section.items).find((entry) => entry.id === id).tokens;
    expect(tokensOf("story")).toBeGreaterThan(tokensOf("language"));
    const budget = tokensOf("target:chapter-02") + tokensOf("language");
    const context = contextOf(root, "chapter-02", { budget: String(budget) });
    const essentials = context.sections.find((section) => section.id === "essentials").items;
    expect(essentials.find((entry) => entry.id === "language").included).toBe(true);
    expect(essentials.find((entry) => entry.id === "story").included).toBe(false);
    const text = textOf(context);
    expect(text).toContain("## Story essentials\n\n### Language contract\n- Language: en\n- Writing mode: horizontal\n- Chapter numerals: western\n- Count unit: words");
    expect(text).toContain("- story.md essentials: story.md");
  });

  test("the CLI prints the context and reports bad input", () => {
    const { root, cwd } = contextProject();
    const ok = invoke(cwd, ["context", "chapter-02", "--path", root, "--budget", "5000"]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("About ");
    expect(ok.out).toContain("of 5000 tokens");
    expect(ok.err).toBe("");

    expect(invoke(cwd, ["context", "--path", root]).err).toContain("Usage: story context <chapter-or-scene-id>");
    expect(invoke(cwd, ["context", "chapter-09", "--path", root]).err).toContain("Unknown chapter or scene chapter-09");
    expect(invoke(cwd, ["context", "chapter-02", "--path", root, "--budget", "0"]).err).toContain("Budget must be a positive integer, got 0");
    expect(invoke(cwd, ["context", "chapter-02", "--path", root, "--scenes", "-1"]).err).toContain("Scenes must be 0 or a positive integer, got -1");
  });

  test("unreadable chapters stop the command; other unreadable files are warnings", () => {
    const { root, cwd } = contextProject();
    fs.writeFileSync(path.join(root, "characters", "broken.md"), "not frontmatter\n", "utf8");
    const warned = invoke(cwd, ["context", "chapter-02", "--path", root]);
    expect(warned.code).toBe(0);
    expect(warned.err).toContain(`warning: characters/broken.md:`);
    const json = invokeJson(cwd, ["context", "chapter-02", "--path", root]);
    expect(json.envelope.diagnostics).toEqual([expect.objectContaining({ severity: "warning", file: "characters/broken.md", code: "context-file-skipped", check: "context" })]);

    fs.writeFileSync(path.join(root, "chapters", "chapter-05.md"), "not frontmatter\n", "utf8");
    const failed = invoke(cwd, ["context", "chapter-02", "--path", root]);
    expect(failed.code).toBe(3);
    expect(failed.err).toContain(`chapters/chapter-05.md`);
  });

  test("a target scene that fails to parse reports the parse error", () => {
    const { root, cwd } = contextProject();
    fs.writeFileSync(path.join(root, "scenes", "chapter-02-scene-01.md"), "not frontmatter\n", "utf8");
    const result = invoke(cwd, ["context", "chapter-02-scene-01", "--path", root]);
    expect(result.code).toBe(3);
    expect(result.err).toContain(`scenes/chapter-02-scene-01.md:`);
    expect(result.err).not.toContain("Unknown chapter or scene");
  });

  test("the starter chapter outline is skipped", () => {
    const { root, cwd } = contextProject();
    expect(invoke(cwd, ["add", "chapter", "Fresh", "--path", root]).code).toBe(0);
    const text = textOf(contextOf(root, "chapter-05"));
    expect(text).toContain("### Chapter 5: Fresh");
    expect(text).not.toContain("Opening beat");
    expect(text).not.toContain("Chapter outline:");
  });

  test("a scene of an unknown chapter is refused", () => {
    const { root } = contextProject();
    writeMarkdown(path.join(root, "scenes", "chapter-07-scene-01.md"), "title: Orphan\nchapter: chapter-07\nscene: 1\nstatus: outline", "# Orphan\n");
    expect(() => contextOf(root, "chapter-07-scene-01")).toThrow("Scene chapter-07-scene-01 belongs to unknown chapter chapter-07");
  });

  test("a project without a style sheet, POV, or scenes still packs", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Bare", force: false });
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Start\nnumber: 1\nstatus: outline", "# Start\n");
    fs.rmSync(path.join(root, "continuity", "state.md"));
    const project = scanProject(root);
    project.styleSheet = null;
    const context = buildContext(project, "chapter-01", () => "");
    const text = formatContext(context);
    expect(text).toContain("### Chapter 1: Start");
    expect(text).not.toContain("POV knowledge");
    expect(text).not.toContain("### Style sheet");
  });

  test("a style sheet with an empty body and loose preferred entries", () => {
    const { root } = contextProject();
    writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\ndialect: american\npreferred:\n  - loose\n  - use: only\n  - use: gray\n    avoid: grey", "# Style Sheet\n");
    const text = textOf(contextOf(root, "chapter-01"));
    expect(text).toContain("### Style sheet\n- Dialect: american\n- Preferred: gray (not grey)\n\n## ");
  });
});

describe("context helpers", () => {
  test("estimateTokens is ceil(words * 4 / 3) for spaced text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("one")).toBe(2);
    expect(estimateTokens("one two three")).toBe(4);
    expect(estimateTokens("  a\n b\tc d  ")).toBe(6);
    // Punctuation stays with the whitespace-separated run, as before.
    expect(estimateTokens("hello, world")).toBe(3);
    expect(estimateTokens("hello , world")).toBe(4);
  });

  test("estimateTokens prices unspaced scripts by the words wordcount uses", () => {
    // Han and katakana are 2/3 of a token per character; hiragana is 1/2.
    expect(estimateTokens("字")).toBe(1);
    expect(estimateTokens("字".repeat(3))).toBe(2);
    expect(estimateTokens("字".repeat(1520))).toBe(1014);
    expect(estimateTokens("𠀀𠀀")).toBe(2);
    expect(estimateTokens("あ")).toBe(1);
    expect(estimateTokens("あ".repeat(6))).toBe(3);
    expect(estimateTokens("字".repeat(6))).toBe(4);
    expect(estimateTokens("ーー")).toBe(2);
    expect(estimateTokens("ああ")).toBe(1);
    expect(estimateTokens("コーヒー")).toBe(3);
    // A combining mark belongs to the character before it, so decomposed
    // Japanese costs what composed Japanese does.
    expect(estimateTokens("か\u3099")).toBe(estimateTokens("が"));
    expect(estimateTokens("か\u3099".repeat(6))).toBe(estimateTokens("が".repeat(6)));
    expect(estimateTokens("ハ\u309Aン")).toBe(estimateTokens("パン"));
    expect(estimateTokens("葛\uDB40\uDD00城")).toBe(estimateTokens("葛城"));
    expect(estimateTokens("か\u3099 word")).toBe(estimateTokens("が word"));
    // Dictionary words: one token each. A soft hyphen keeps one Thai word.
    expect(estimateTokens("ฉันรักแมว")).toBe(3);
    expect(estimateTokens("ຂ້ອຍຮັກແມວ")).toBe(3);
    expect(estimateTokens("ខ្ញុំស្រលាញ់ឆ្មា")).toBe(3);
    expect(estimateTokens("ကျွန်တော်ကြောင်ကိုချစ်တယ်")).toBe(5);
    expect(estimateTokens("แม\u00ADว")).toBe(1);
    // Spaced words on either side of an unspaced word stay apart, and the
    // rates add before the single rounding.
    expect(estimateTokens("cat猫dog")).toBe(4);
    expect(estimateTokens("one two 三")).toBe(4);
    expect(estimateTokens("one あ")).toBe(2);
  });

  test("a long Chinese card costs by the character and is left out of a budget that used to hold it", () => {
    const { root } = contextProject();
    const cardPath = path.join(root, "characters", "mara-finn.md");
    const han = "字".repeat(1520);
    fs.writeFileSync(cardPath, fs.readFileSync(cardPath, "utf8").replace("Salt-grey hair.", `Salt-grey hair. ${han}`), "utf8");
    const context = contextOf(root, "chapter-02");
    const card = context.sections.find((section) => section.id === "characters").items.find((item) => item.id === "character:mara-finn");
    expect(card.tokens).toBeGreaterThan(1000);
    let used = 0;
    for (const section of context.sections) {
      for (const item of section.items) {
        if (item.id === card.id) {
          const tight = contextOf(root, "chapter-02", { budget: String(used + 10) });
          expect(tight.omitted.find((entry) => entry.id === card.id).tokens).toBe(card.tokens);
          expect(tight.estimatedTokens).toBeLessThanOrEqual(used + 10);
          const text = textOf(tight);
          expect(text).toContain("## Left out to fit the budget");
          expect(text).not.toContain(han.slice(0, 32));
          return;
        }
        if (item.included) {
          used += item.tokens;
        }
      }
    }
    throw new Error("missing character card");
  });

  test("characterStateAt resolves death and revival at the chapter", () => {
    const { root } = contextProject();
    const project = scanProject(root);
    const chronology = chapterChronology(project);
    const jonas = project.characters.find((character) => character.id === "jonas-reed");
    expect(characterStateAt(jonas, chronology, "chapter-02").status).toBe("alive");
    expect(characterStateAt(jonas, chronology, "chapter-04").status).toBe("dies in this chapter");
    const revived = { ...jonas, diedIn: "chapter-01", revivedIn: "chapter-04" };
    expect(characterStateAt(revived, chronology, "chapter-02").status).toBe("deceased (died in chapter-01)");
    expect(characterStateAt({ status: "missing" }, chronology, "chapter-02").status).toBe("missing");
    // An undated death could be a later one, so it is not shown.
    expect(characterStateAt({ status: "deceased" }, chronology, "chapter-02").status).toBe("");
    // Chapter 3 is read after chapter 2 but dated before it: a revival there
    // is not known yet, and it would change the answer, so nothing is shown.
    expect(characterStateAt({ status: "alive", diedIn: "chapter-01", revivedIn: "chapter-03" }, chronology, "chapter-02").status).toBe("");
    expect(characterStateAt({}, chronology, "chapter-02").status).toBe("");
    // A death in an unwritten chapter is not known yet.
    expect(characterStateAt({ status: "deceased", diedIn: "chapter-09" }, chronology, "chapter-02").status).toBe("alive");
    // Chapter 3 is dated before chapter 2: a chapter-02 flash-forward comes
    // after a chapter-03 death in story time, but the death is read later,
    // so the status is left out rather than shown either way.
    expect(characterStateAt({ status: "deceased", diedIn: "chapter-03" }, chronology, "chapter-02").status).toBe("");
  });

  test("an outline death is not in force in a later chapter", () => {
    const { root } = contextProject();
    const death = path.join(root, "chapters", "chapter-04.md");
    fs.writeFileSync(death, fs.readFileSync(death, "utf8").replace("status: draft", "status: outline"), "utf8");
    writeMarkdown(path.join(root, "chapters", "chapter-05.md"), "title: Chapter 5\nnumber: 5\nstatus: draft\n", "# Chapter 5\n");
    const project = scanProject(root);
    const chronology = chapterChronology(project);
    const jonas = project.characters.find((character) => character.id === "jonas-reed");
    expect(characterStateAt(jonas, chronology, "chapter-04").status).toBe("dies in this chapter");
    expect(characterStateAt(jonas, chronology, "chapter-05").status).toBe("alive");
  });
});

describe("story context on the examples", () => {
  test("the-unraveled-thread at chapter 2 leaves out chapter 3 and 4 threads", () => {
    const text = textOf(contextOf(path.join(EXAMPLES, "the-unraveled-thread"), "chapter-02"));
    expect(text).toContain("The Sealed Letter");
    expect(text).toContain("The Constable's Silence");
    expect(text).toContain("Edran's Margin Notes");
    expect(text).toContain("### Edran Vale\n- Id: edran-vale\n- Role: supporting\n- Status: dies in this chapter");
    // Planted in chapter 3, learned in (missing) chapter 5, paid off in 4.
    expect(text).not.toContain("The Burned Page");
    expect(text).not.toContain("The Broken Compass");
    expect(text).not.toContain("Who Burned The Mill");
    expect(text).not.toContain("which ledger page names the firestarter");
    expect(text).not.toContain("the margin notes on that page become the schedule");
    expect(text).not.toContain("Nessa");
  });

  test("kirimi chapter 2 prices Japanese prose, and the old 297-token figure leaves text out", () => {
    const root = path.join(EXAMPLES, "kirimi-eki-no-wasuremono");
    const context = contextOf(root, "chapter-02");
    const text = textOf(context);
    // The knowledge line's "reader-knowledge, " mark is one more spaced word.
    expect(context.estimatedTokens).toBe(906);
    expect(text).toContain("Chapter 2:");
    expect(text).toContain("(estimated at 4 tokens per 3 words in spaced text; 2 per 3 Han or katakana characters, 1 per 2 hiragana, and 1 per Thai, Lao, Khmer, or Burmese word). Later chapters are left out. A fact marked character-knowledge is known in story time; do not reveal it.");
    const tight = contextOf(root, "chapter-02", { budget: "297" });
    expect(tight.estimatedTokens).toBeLessThanOrEqual(297);
    expect(tight.omitted.length).toBeGreaterThan(0);
    expect(textOf(tight)).toContain("## Left out to fit the budget");
  });

  test("kirimi-eki-no-wasuremono packs the language contract", () => {
    const root = path.join(EXAMPLES, "kirimi-eki-no-wasuremono");
    for (const target of ["chapter-01", "chapter-03"]) {
      const text = textOf(contextOf(root, target));
      const essentials = text.split("## Story essentials")[1].split(/^## /m)[0];
      expect(essentials).toContain("- Language: ja");
      expect(essentials).toContain("- Writing mode: vertical");
      expect(essentials).toContain("- Chapter numerals: native");
      expect(essentials).toContain("- Count unit: characters");
    }
  });

  test("the-last-ember packs the style sheet and both cards", () => {
    const text = textOf(contextOf(path.join(EXAMPLES, "the-last-ember"), "chapter-01"));
    expect(text).toContain("#### Voice\n\nClose third person");
    expect(text).toContain("### Sera Voss (POV)");
    expect(text).toContain("### Kael Voss");
    expect(text).not.toContain("The grove was quieter than it should have been.\n\nSera stood");
    expect(text).not.toContain("SPOILER");
  });
});

// Progressions on the POV character, a cast member, and the chapter's
// location. Every change from chapter 3 or later carries a SPOILER marker.
function progressionProject() {
  const { root, cwd } = contextProject();
  writeMarkdown(path.join(root, "characters", "mara-finn.md"), `name: Mara Finn
role: protagonist
status: alive
progressions:
  - from: chapter-01
    field: whereabouts
    value: the mill loft
  - from: chapter-02
    field: mood
    value: wary
  - from: chapter-03
    field: mood
    value: SPOILER-PROG-3 read later, dated earlier
  - from: chapter-04
    field: whereabouts
    value: SPOILER-PROG-4
  - from: chapter-09
    field: status
    value: SPOILER-PROG-9`, "# Mara\n");
  writeMarkdown(path.join(root, "characters", "jonas-reed.md"), `name: Jonas Reed
role: supporting
status: alive
progressions:
  - from: chapter-01
    field: aliases
    value: The Ferryman
  - from: chapter-01
    field: role
    value: antagonist
  - from: chapter-04
    field: status
    value: SPOILER-JONAS`, "# Jonas\n");
  writeMarkdown(path.join(root, "worldbuilding", "locations", "the-mill.md"), `name: The Mill
type: building
region: Mill Row
status: working
progressions:
  - from: chapter-02
    field: status
    value: burned
  - from: chapter-02
    field: controlled-by
    value: the bank
  - from: chapter-04
    field: status
    value: SPOILER-LOCATION`, "# The Mill\n");
  return { root, cwd };
}

describe("story context with progressions", () => {
  test("applies progressions up to the target and none after it", () => {
    const { root, cwd } = progressionProject();
    const text = textOf(contextOf(root, "chapter-02"));
    // POV changes sit under its state, the others' on their cards.
    expect(text).toContain("- From chapter-01: whereabouts the mill loft\n- From this chapter: mood wary");
    expect(text).toContain("### Jonas Reed\n- Id: jonas-reed\n- Role: antagonist\n- Status: alive\n- Aliases: The Ferryman\n- From chapter-01: aliases The Ferryman\n- From chapter-01: role antagonist");
    expect(text).toContain("## Where it happens\n\n### The Mill\n- Id: the-mill\n- Type: building\n- Region: Mill Row\n- Status: burned\n- Controlled by: the bank\n- From this chapter: status burned\n- From this chapter: controlled-by the bank");
    const { out } = invokeJson(cwd, ["context", "chapter-02", "--path", root]);
    for (const output of [text, out]) {
      expect(output.split("SPOILER-KNOWLEDGE-3").join("")).not.toContain("SPOILER");
    }
    // At chapter 1 the location has not changed yet.
    const first = textOf(contextOf(root, "chapter-01-scene-01"));
    expect(first).toContain("- Status: working");
    expect(first).not.toContain("burned");
    for (const marker of ["SPOILER-PROG", "SPOILER-JONAS", "SPOILER-LOCATION"]) {
      expect(first).not.toContain(marker);
    }
  });

  test("a scene target shows only its own location", () => {
    const { root } = progressionProject();
    expect(textOf(contextOf(root, "chapter-02-scene-01"))).not.toContain("## Where it happens");
  });

  test("a dated status progression is shown", () => {
    const { root } = progressionProject();
    const project = scanProject(root);
    const chronology = chapterChronology(project);
    const frontmatter = { status: "deceased", progressions: [{ from: "chapter-01", field: "status", value: "deceased" }] };
    expect(characterStateAt({ frontmatter }, chronology, "chapter-02").status).toBe("deceased");
    expect(characterStateAt({ frontmatter: { status: "deceased" } }, chronology, "chapter-02").status).toBe("");
  });

  test("the-fall-of-the-citadel keeps chapter 10 and 11 progressions out of chapter 1", () => {
    const root = path.join(EXAMPLES, "the-fall-of-the-citadel");
    const text = textOf(contextOf(root, "chapter-01"));
    expect(text).toContain("### The Ashen Citadel\n- Id: ashen-citadel\n- Type: city\n- Region: Northern Reach\n- Status: thriving");
    for (const later of ["occupied", "sealed and cooling", "Jaw to collarbone", "in hiding with Kael", "From chapter-1"]) {
      expect(text).not.toContain(later);
    }
    const { envelope } = invokeJson(root, ["context", "chapter-01"]);
    expect(JSON.stringify(envelope)).not.toContain("occupied");
  });

  test("story.md cli-defaults set --budget and --scenes for context", () => {
    const { root, cwd } = contextProject();
    const storyPath = path.join(root, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("themes:", "cli-defaults:\n  - command: context\n    budget: 300\n    scenes: 1\nthemes:"), "utf8");
    const { envelope } = invokeJson(cwd, ["context", "chapter-02", "--path", root]);
    expect(envelope.data.budget).toBe(300);
    expect(envelope.data.sections.find((section) => section.id === "scenes").items.map((entry) => entry.id)).toEqual(["scene:chapter-01-scene-02"]);
    // The command line wins.
    expect(invokeJson(cwd, ["context", "chapter-02", "--path", root, "--budget", "5000"]).envelope.data.budget).toBe(5000);
  });

  test("usage errors and unusable projects use the shared exit codes", () => {
    const { root, cwd } = contextProject();
    expect(invoke(cwd, ["context", "--path", root]).code).toBe(2);
    expect(invoke(cwd, ["context", "chapter-09", "--path", root]).code).toBe(2);
    expect(invoke(cwd, ["context", "chapter-02", "--path", root, "--budget", "0"]).code).toBe(2);
    const missing = invokeJson(cwd, ["context", "--path", root]);
    expect(missing.code).toBe(2);
    expect(missing.envelope.data).toBeNull();
    writeMarkdown(path.join(root, "scenes", "chapter-07-scene-01.md"), "title: Orphan\nchapter: chapter-07\nscene: 1\nstatus: outline", "# Orphan\n");
    expect(invoke(cwd, ["context", "chapter-07-scene-01", "--path", root]).code).toBe(3);
    fs.writeFileSync(path.join(root, "chapters", "chapter-05.md"), "not frontmatter\n", "utf8");
    expect(invoke(cwd, ["context", "chapter-02", "--path", root]).code).toBe(3);
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { buildContext, characterStateAt, estimateTokens, formatContext } from "../src/context.js";
import { chapterChronology } from "../src/chronology.js";
import { createStoryProject, draftingContext, scanProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

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

    expect(text).toContain("- Premise: Truth costs more than silence");
    expect(text).toContain("#### Tone & Style\n\nSpare and cold.");
    expect(text).toContain("#### Setting\n\nA drowned mill town.");

    expect(text).toContain("- The mill had two owners (before the story)");
    expect(text).toContain("- The letter is forged (learned in chapter-01)");
    expect(text).toContain("- The ledger names the buyer (learned in this chapter)");
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

  test("includes nothing from chapters after the target", () => {
    const { root } = contextProject();
    const context = contextOf(root, "chapter-02");
    const text = textOf(context);
    const json = JSON.stringify(context);
    for (const output of [text, json]) {
      expect(output).not.toContain("SPOILER");
    }
    expect(text).not.toContain("closed-promise");
    expect(text).not.toContain("later-promise");
    expect(text).not.toContain("chapter-03");
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
    expect(first).not.toContain("SPOILER");

    const second = textOf(contextOf(root, "chapter-02-scene-02"));
    // Dated only by chapter, so it may come later in the chapter.
    expect(second).toContain("- The ledger names the buyer (learned in this chapter, possibly in a later scene)");
    expect(second).toContain("- **chapter-02 scene 1: chapter-02 scene 1** (POV mara-finn, outcome yes-but)\n  Mara opens the letter.");
    // Its own purpose is the thing being drafted.
    expect(second).toContain("Scene purpose:\n\nSPOILER-SCENE-2-2");
    expect(second).not.toContain("SPOILER-LATER-SCENE");
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
    expect(warned.err).toContain("warning: Skipped unreadable file: characters");

    fs.writeFileSync(path.join(root, "chapters", "chapter-05.md"), "not frontmatter\n", "utf8");
    const failed = invoke(cwd, ["context", "chapter-02", "--path", root]);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain(`chapters${path.sep}chapter-05.md`);
  });

  test("a target scene that fails to parse reports the parse error", () => {
    const { root, cwd } = contextProject();
    fs.writeFileSync(path.join(root, "scenes", "chapter-02-scene-01.md"), "not frontmatter\n", "utf8");
    const result = invoke(cwd, ["context", "chapter-02-scene-01", "--path", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain(`scenes${path.sep}chapter-02-scene-01.md:`);
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
  test("estimateTokens is ceil(words * 4 / 3)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("one")).toBe(2);
    expect(estimateTokens("one two three")).toBe(4);
    expect(estimateTokens("  a\n b\tc d  ")).toBe(6);
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
    expect(characterStateAt({}, chronology, "chapter-02").status).toBe("");
    // A death in an unwritten chapter is not known yet.
    expect(characterStateAt({ status: "deceased", diedIn: "chapter-09" }, chronology, "chapter-02").status).toBe("alive");
    // Chapter 3 is dated before chapter 2: a chapter-02 flash-forward comes
    // after a chapter-03 death in story time, but the death is read later,
    // so the status is left out rather than shown either way.
    expect(characterStateAt({ status: "deceased", diedIn: "chapter-03" }, chronology, "chapter-02").status).toBe("");
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

  test("the-last-ember packs the style sheet and both cards", () => {
    const text = textOf(contextOf(path.join(EXAMPLES, "the-last-ember"), "chapter-01"));
    expect(text).toContain("#### Voice\n\nClose third person");
    expect(text).toContain("### Sera Voss (POV)");
    expect(text).toContain("### Kael Voss");
    expect(text).not.toContain("The grove was quieter than it should have been.\n\nSera stood");
    expect(text).not.toContain("SPOILER");
  });
});

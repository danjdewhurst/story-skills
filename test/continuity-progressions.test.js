import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { checkContinuity } from "../src/continuity.js";
import { createStoryProject, scanProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

// A five-chapter fixture for status progressions. `chapters` maps a chapter
// number to extra frontmatter (cast, date); every chapter is drafted.
function fixture({ characters = {}, chapters = {}, scenes = [], state = "" } = {}) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Tidewater", force: false });
  for (let number = 1; number <= 5; number += 1) {
    writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 1
${chapters[number] ?? "characters: []"}
`, "## Chapter Text\n\nWords.\n");
  }
  for (const [id, frontmatter] of Object.entries(characters)) {
    writeMarkdown(path.join(root, "characters", `${id}.md`), `
name: ${id}
role: supporting
${frontmatter}
`, `# ${id}\n`);
  }
  for (const { id, frontmatter } of scenes) {
    writeMarkdown(path.join(root, "scenes", `${id}.md`), `
title: ${id}
status: draft
${frontmatter}
`, `# ${id}\n`);
  }
  if (state !== "") {
    writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: tidewater
${state}
`, "# State\n");
  }
  return { root, cwd };
}

function findings(root, code) {
  const result = checkContinuity(scanProject(root));
  return [...result.errors, ...result.warnings].filter((finding) => finding.code === code);
}

function codes(root) {
  const result = checkContinuity(scanProject(root));
  return [...result.errors, ...result.warnings].map((finding) => finding.code);
}

const cast = (id) => `characters:\n  - ${id}`;

describe("continuity with status progressions", () => {
  test("a progression to deceased makes later casts posthumous, as died-in does", () => {
    const { root } = fixture({
      characters: {
        "ada-fenn": "status: alive\nprogressions:\n  - from: chapter-03\n    field: status\n    value: deceased"
      },
      chapters: {
        2: cast("ada-fenn"),
        3: cast("ada-fenn"),
        4: cast("ada-fenn"),
        // Remembered, and narrating as a ghost: neither is an appearance.
        5: "pov: ada-fenn\ncharacters: []\nmentions:\n  - ada-fenn"
      },
      scenes: [
        { id: "chapter-04-scene-01", frontmatter: "chapter: chapter-04\nscene: 1\npov: ada-fenn\ncharacters:\n  - ada-fenn" },
        { id: "chapter-05-scene-01", frontmatter: "chapter: chapter-05\nscene: 1\ncharacters: []\nmentions:\n  - ada-fenn" }
      ]
    });
    const found = findings(root, "progression-deceased-in-cast");
    // The death chapter itself and the earlier chapter are fine.
    expect(found).toEqual([
      { code: "progression-deceased-in-cast", message: `${path.join("chapters", "chapter-04.md")} lists ada-fenn, whose progressions make them deceased from chapter-03; move appearances after the death to mentions`, file: path.join("chapters", "chapter-04.md") },
      { code: "progression-deceased-in-cast", message: `${path.join("scenes", "chapter-04-scene-01.md")} lists ada-fenn, whose progressions make them deceased from chapter-03; move appearances after the death to mentions`, file: path.join("scenes", "chapter-04-scene-01.md") }
    ]);
    expect(codes(root)).not.toContain("posthumous-appearance");
    expect(codes(root)).not.toContain("deceased-in-cast");
  });

  test("a later status progression ends the dead window", () => {
    const { root } = fixture({
      characters: {
        "ada-fenn": "status: alive\nprogressions:\n  - from: chapter-02\n    field: status\n    value: deceased\n  - from: chapter-04\n    field: status\n    value: alive"
      },
      chapters: { 3: cast("ada-fenn"), 4: cast("ada-fenn"), 5: cast("ada-fenn") }
    });
    expect(findings(root, "progression-deceased-in-cast").map((finding) => finding.file)).toEqual([path.join("chapters", "chapter-03.md")]);
  });

  test("a character dead before the story may appear once a progression brings them back", () => {
    const { root } = fixture({
      characters: {
        "old-tomas": "status: deceased\nprogressions:\n  - from: chapter-03\n    field: status\n    value: alive"
      },
      chapters: { 2: cast("old-tomas"), 3: cast("old-tomas"), 4: cast("old-tomas") },
      state: "current-chapter: 4\nknowledge-state:\n  - character: old-tomas\n    knows: The tide turned\n    learned-in: chapter-02\n  - character: old-tomas\n    knows: The mill burned\n    learned-in: chapter-04"
    });
    expect(findings(root, "deceased-in-cast").map((finding) => finding.file)).toEqual([path.join("chapters", "chapter-02.md")]);
    expect(findings(root, "deceased-learning").map((finding) => finding.message)).toEqual([
      `${path.join("continuity", "state.md")} knowledge-state[0] has old-tomas learn something in chapter-02, but old-tomas died before the story (deceased with no died-in)`
    ]);
    expect(codes(root)).not.toContain("progression-deceased-in-cast");
  });

  test("a scene in a chapter that does not exist keeps the frontmatter status", () => {
    const { root } = fixture({
      characters: {
        "ada-fenn": "status: alive\nprogressions:\n  - from: chapter-02\n    field: status\n    value: deceased",
        "old-tomas": "status: deceased\nprogressions:\n  - from: chapter-02\n    field: status\n    value: alive"
      },
      scenes: [{ id: "chapter-07-scene-01", frontmatter: "chapter: chapter-07\nscene: 1\ncharacters:\n  - ada-fenn\n  - old-tomas" }]
    });
    expect(findings(root, "progression-deceased-in-cast")).toEqual([]);
    expect(findings(root, "deceased-in-cast").map((finding) => finding.message)).toEqual([
      `${path.join("scenes", "chapter-07-scene-01.md")} lists old-tomas, who died before the story (deceased with no died-in); move appearances to mentions`
    ]);
  });

  test("a death planned for a chapter not yet written flags nothing", () => {
    const { root } = fixture({
      characters: { "ada-fenn": "status: alive\nprogressions:\n  - from: chapter-09\n    field: status\n    value: deceased" },
      chapters: { 4: cast("ada-fenn"), 5: cast("ada-fenn") }
    });
    expect(findings(root, "progression-deceased-in-cast")).toEqual([]);
  });

  test("dated chapters order the death in story time", () => {
    // Chapter 1 is a flash-forward to 2034; the death is in 2024's chapter 2.
    const { root } = fixture({
      characters: { "ada-fenn": "status: alive\nprogressions:\n  - from: chapter-02\n    field: status\n    value: deceased" },
      chapters: {
        1: `date: 2034-05-01\n${cast("ada-fenn")}`,
        2: "date: 2024-05-01\ncharacters: []",
        3: `date: 2023-01-01\n${cast("ada-fenn")}`,
        4: `date: 2025-01-01\n${cast("ada-fenn")}`
      }
    });
    expect(findings(root, "progression-deceased-in-cast").map((finding) => finding.file)).toEqual([
      path.join("chapters", "chapter-01.md"),
      path.join("chapters", "chapter-04.md")
    ]);
  });

  test("died-in governs a character who has one, so nothing is reported twice", () => {
    const { root } = fixture({
      characters: { "ada-fenn": "status: deceased\ndied-in: chapter-02\nprogressions:\n  - from: chapter-02\n    field: status\n    value: deceased" },
      chapters: { 4: cast("ada-fenn") }
    });
    expect(codes(root)).toContain("posthumous-appearance");
    expect(codes(root)).not.toContain("progression-deceased-in-cast");
    expect(codes(root)).not.toContain("progression-death-conflict");
  });

  test("learning after a progression to deceased is reported, in state and in scenes", () => {
    const { root } = fixture({
      characters: { "ada-fenn": "status: alive\nprogressions:\n  - from: chapter-03\n    field: status\n    value: deceased" },
      chapters: { 3: cast("ada-fenn"), 4: "characters: []" },
      scenes: [{ id: "chapter-04-scene-01", frontmatter: "chapter: chapter-04\nscene: 1\ncharacters: []\nstate-changes:\n  - character: ada-fenn\n    knowledge: The mill burned" }],
      state: "current-chapter: 4\nknowledge-state:\n  - character: ada-fenn\n    knows: The tide turned\n    learned-in: chapter-03\n  - character: ada-fenn\n    knows: The mill burned\n    learned-in: chapter-04"
    });
    expect(findings(root, "progression-deceased-learning").map((finding) => finding.message)).toEqual([
      `${path.join("continuity", "state.md")} knowledge-state[1] has ada-fenn learn something in chapter-04, but their progressions make them deceased from chapter-03`,
      `${path.join("scenes", "chapter-04-scene-01.md")} state-change has ada-fenn learn something in chapter-04, but their progressions make them deceased from chapter-03`
    ]);
    expect(codes(root)).not.toContain("deceased-learning");
  });
});

describe("status progressions against died-in and revived-in", () => {
  const conflicts = (root) => findings(root, "progression-death-conflict").map((finding) => finding.message);
  const label = path.join("characters", "ada-fenn.md");

  test("a status other than deceased while the character is dead", () => {
    const { root } = fixture({
      characters: { "ada-fenn": "status: deceased\ndied-in: chapter-02\nprogressions:\n  - from: chapter-02\n    field: status\n    value: deceased\n  - from: chapter-04\n    field: status\n    value: missing" }
    });
    expect(conflicts(root)).toEqual([
      `${label} progressions[1] sets status missing from chapter-04, while ada-fenn is dead after dying in chapter-02; set revived-in: chapter-04 if they come back`
    ]);
  });

  test("a status change before the revival chapter, and a planned one", () => {
    const { root } = fixture({
      characters: {
        "ada-fenn": "status: alive\ndied-in: chapter-02\nrevived-in: chapter-04\nprogressions:\n  - from: chapter-03\n    field: status\n    value: alive",
        "old-tomas": "status: deceased\ndied-in: chapter-02\nprogressions:\n  - from: chapter-09\n    field: status\n    value: alive"
      }
    });
    expect(conflicts(root)).toEqual([
      `${label} progressions[0] sets status alive from chapter-03, while ada-fenn is dead after dying in chapter-02; move it to chapter-04, when they are revived`,
      `${path.join("characters", "old-tomas.md")} progressions[0] sets status alive from chapter-09, while old-tomas is dead after dying in chapter-02; set revived-in: chapter-09 if they come back`
    ]);
  });

  test("a progression to deceased that outlasts the revival", () => {
    const { root } = fixture({
      characters: { "ada-fenn": "status: alive\ndied-in: chapter-02\nrevived-in: chapter-04\nprogressions:\n  - from: chapter-02\n    field: status\n    value: deceased" }
    });
    expect(conflicts(root)).toEqual([
      `${label} progressions[0] makes ada-fenn deceased from chapter-02, which still holds when they are revived in chapter-04; add a status progression from chapter-04`
    ]);
  });

  test("progressions that match the death and the revival are clean", () => {
    const { root } = fixture({
      characters: {
        "ada-fenn": "status: alive\ndied-in: chapter-02\nrevived-in: chapter-04\nprogressions:\n  - from: chapter-02\n    field: status\n    value: deceased\n  - from: chapter-04\n    field: status\n    value: alive",
        // A revived character with no status progressions is left to the
        // revival-status check.
        "old-tomas": "status: alive\ndied-in: chapter-02\nrevived-in: chapter-04"
      }
    });
    expect(conflicts(root)).toEqual([]);
    expect(validateProject(root).warnings.filter((warning) => warning.code === "deceased-without-died-in")).toEqual([]);
  });
});

describe("progression findings in the CLI", () => {
  test("severity promotes the new warnings, and --json carries code, check, and file", () => {
    const { root, cwd } = fixture({
      characters: { "ada-fenn": "status: alive\nprogressions:\n  - from: chapter-02\n    field: status\n    value: deceased" },
      chapters: { 3: cast("ada-fenn") }
    });
    let io = memoryIo(cwd);
    expect(runCli(["continuity", root], io)).toBe(0);
    expect(io.error()).toContain("move appearances after the death to mentions [progression-deceased-in-cast]\n");

    const file = path.join(root, "story.md");
    const text = fs.readFileSync(file, "utf8");
    const end = text.indexOf("\n---\n", 4);
    fs.writeFileSync(file, `${text.slice(0, end)}\nseverity:\n  - warning: progression-deceased-in-cast\n    level: error${text.slice(end)}`, "utf8");
    io = memoryIo(cwd);
    expect(runCli(["continuity", root], io)).toBe(1);
    io = memoryIo(cwd);
    expect(runCli(["continuity", root, "--json"], io)).toBe(1);
    const json = JSON.parse(io.output());
    expect(json.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "progression-deceased-in-cast",
      check: "continuity",
      file: path.join("chapters", "chapter-03.md")
    }));
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { checkContinuity } from "../src/continuity.js";
import { createStoryProject, scanProject } from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

function baseProject(chapters) {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title: "Custody And Clock", force: false });
  const root = created.root;
  for (let number = 1; number <= chapters; number += 1) {
    writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
word-count: 0
`, `## Chapter Text\n\nWords here.\n`);
  }
  writeMarkdown(path.join(root, "worldbuilding", "artifacts", "moon-blade.md"), `
name: Moon Blade
type: weapon
status: destroyed
`, "# Moon Blade\n");

  const statePath = path.join(root, "continuity", "state.md");
  fs.writeFileSync(statePath, fs.readFileSync(statePath, "utf8").replace("current-chapter: 0", `current-chapter: ${chapters}`), "utf8");
  return root;
}

function writeScene(root, chapterNumber, sceneNumber, frontmatter) {
  writeMarkdown(path.join(root, "scenes", `chapter-0${chapterNumber}-scene-0${sceneNumber}.md`), `
title: Scene ${sceneNumber}
chapter: chapter-0${chapterNumber}
scene: ${sceneNumber}
status: draft
${frontmatter.trim()}
`, `## Scene Text\n\nWords here.\n`);
}

function setObjectState(root, yaml) {
  const statePath = path.join(root, "continuity", "state.md");
  const raw = fs.readFileSync(statePath, "utf8");
  fs.writeFileSync(statePath, raw.replace("object-state: []", `object-state:\n${yaml}`), "utf8");
}

describe("prop custody", () => {
  test("flags scenes that use a destroyed artifact after its since chapter", () => {
    const root = baseProject(3);
    setObjectState(root, `  - artifact: moon-blade\n    status: destroyed\n    since: chapter-02\n`);
    writeScene(root, 3, 1, `
state-changes:
  - target: moon-blade
    change: "Shattered against the altar"
`);

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toContain(
      "scenes/chapter-03-scene-01.md uses moon-blade, destroyed/lost since chapter-02"
    );
    expect(result.ok).toBe(false);
  });

  test("flags mentions and character listings after the since chapter", () => {
    const root = baseProject(3);
    setObjectState(root, `  - artifact: moon-blade\n    status: lost\n    since: chapter-01\n`);
    writeScene(root, 2, 1, `
mentions:
  - moon-blade
characters:
  - moon-blade
`);

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toContain(
      "scenes/chapter-02-scene-01.md mentions moon-blade, destroyed/lost since chapter-01"
    );
  });

  test("flags chapter mentions after the since chapter", () => {
    const root = baseProject(3);
    setObjectState(root, `  - artifact: moon-blade\n    status: destroyed\n    since: chapter-02\n`);
    const chapterPath = path.join(root, "chapters", "chapter-03.md");
    const raw = fs.readFileSync(chapterPath, "utf8");
    fs.writeFileSync(chapterPath, raw.replace("word-count: 0", "word-count: 0\nmentions:\n  - moon-blade"), "utf8");

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toContain("Chapter 3 mentions moon-blade, destroyed/lost since chapter-02");
  });

  test("ignores references at or before the since chapter", () => {
    const root = baseProject(3);
    setObjectState(root, `  - artifact: moon-blade\n    status: destroyed\n    since: chapter-02\n`);
    writeScene(root, 1, 1, `
state-changes:
  - target: moon-blade
    change: "Drawn for the first time"
mentions:
  - moon-blade
`);
    writeScene(root, 2, 1, `
mentions:
  - moon-blade
`);

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("ignores artifacts that are not destroyed or lost", () => {
    const root = baseProject(3);
    setObjectState(root, `  - artifact: moon-blade\n    status: active\n    since: chapter-01\n`);
    writeScene(root, 3, 1, `
state-changes:
  - target: moon-blade
    change: "Polished"
`);

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toEqual([]);
  });

  test("warns when a destroyed artifact has no since chapter", () => {
    const root = baseProject(2);
    setObjectState(root, `  - artifact: moon-blade\n    status: destroyed\n`);
    writeScene(root, 2, 1, `
mentions:
  - moon-blade
`);

    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toContain(
      "continuity/state.md object-state[0] is destroyed/lost with no since chapter; custody cannot be checked"
    );
    expect(result.errors).toEqual([]);
  });

  test("errors when the since chapter does not exist", () => {
    const root = baseProject(2);
    setObjectState(root, `  - artifact: moon-blade\n    status: destroyed\n    since: chapter-09\n`);

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toContain("continuity/state.md object-state[0] references missing since chapter chapter-09");
  });

  test("skips malformed object-state entries without crashing", () => {
    const root = baseProject(2);
    setObjectState(root, `  - just-a-string\n  - artifact: ""\n    status: destroyed\n    since: chapter-01\n`);

    const result = checkContinuity(scanProject(root));
    expect(result.errors).not.toContain(expect.stringContaining("destroyed/lost since"));
  });

  test("skips non-object state-changes when checking custody", () => {
    const root = baseProject(3);
    setObjectState(root, `  - artifact: moon-blade\n    status: destroyed\n    since: chapter-02\n`);
    writeScene(root, 3, 1, `
state-changes:
  - just-a-string
  - 42
`);

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("clock and time", () => {
  test("warns on scene timestamps that run backward", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, `
date: 2026-01-05
time: "10:00"
`);
    writeScene(root, 1, 2, `
date: 2026-01-03
time: "09:00"
`);

    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toContain("scenes/chapter-01-scene-02.md timestamp runs backward");
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("warns on backward time within the same date", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, `
date: 2026-01-05
time: morning
`);
    writeScene(root, 1, 2, `
date: 2026-01-05
time: dawn
`);

    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toContain("scenes/chapter-01-scene-02.md timestamp runs backward");
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("accepts forward-moving timestamps", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, `
date: 2026-01-05
time: "10:00"
`);
    writeScene(root, 1, 2, `
date: 2026-01-05
time: "12:00"
`);
    writeScene(root, 1, 3, `
date: 2026-01-06
`);

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("flags travel that allows less time than travel-hours", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, `
date: 2026-01-05
time: "10:00"
`);
    writeScene(root, 1, 2, `
date: 2026-01-05
time: "12:00"
travel-hours: 3
`);

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toContain("scenes/chapter-01-scene-02.md allows only 2h for travel of 3h");
  });

  test("accepts travel within the asserted travel-hours", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, `
date: 2026-01-05
time: "10:00"
`);
    writeScene(root, 1, 2, `
date: 2026-01-05
time: "12:00"
travel-hours: 2
`);

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toEqual([]);
  });

  test("skips travel checks when a timestamp has no time", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, `
date: 2026-01-05
`);
    writeScene(root, 1, 2, `
date: 2026-01-05
time: "12:00"
travel-hours: 3
`);
    writeScene(root, 1, 3, `
date: 2026-01-05
travel-hours: 3
`);

    const result = checkContinuity(scanProject(root));
    expect(result.errors).toEqual([]);
  });

  test("no scene dates means no time findings", () => {
    const root = baseProject(2);
    writeScene(root, 1, 1, `
time: "10:00"
`);

    const result = checkContinuity(scanProject(root));
    expect(result).toEqual({ ok: true, errors: [], warnings: [], dismissed: [] });
  });

  test("warns on malformed dates and times without crashing", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, `
date: not-a-date
time: "10:00"
`);
    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toContain(`scenes/chapter-01-scene-01.md has malformed date "not-a-date"`);
    expect(result.ok).toBe(true);
  });

  test("warns on malformed times and impossible calendar dates", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, `
date: 2026-01-05
time: "10:00"
`);
    writeScene(root, 1, 2, `
date: 2026-02-30
time: "10:00"
`);
    writeScene(root, 1, 3, `
date: 2026-13-01
time: "10:00"
`);
    writeScene(root, 1, 4, `
date: 2026-01-32
time: "10:00"
`);
    writeScene(root, 1, 5, `
date: 2026-01-06
time: "25:00"
`);
    writeScene(root, 1, 6, `
date: 2026-01-07
time: "10:75"
`);

    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toContain(`scenes/chapter-01-scene-02.md has malformed date "2026-02-30"`);
    expect(result.warnings).toContain(`scenes/chapter-01-scene-03.md has malformed date "2026-13-01"`);
    expect(result.warnings).toContain(`scenes/chapter-01-scene-04.md has malformed date "2026-01-32"`);
    expect(result.warnings).toContain(`scenes/chapter-01-scene-05.md has malformed time "25:00"`);
    expect(result.warnings).toContain(`scenes/chapter-01-scene-06.md has malformed time "10:75"`);
    expect(result.ok).toBe(true);
  });

  test("warns on malformed scene times", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, `
date: 2026-01-05
time: "10:00"
`);
    writeScene(root, 1, 2, `
date: 2026-01-06
time: noon
`);

    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toContain(`scenes/chapter-01-scene-02.md has malformed time "noon"`);
  });

  test("warns on negative travel-hours", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, `
date: 2026-01-05
time: "10:00"
travel-hours: -2
`);

    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toContain("scenes/chapter-01-scene-01.md has negative travel-hours -2");
  });

  test("warns when a higher-numbered chapter has an earlier date", () => {
    const root = baseProject(3);
    const dated = (number, date) => {
      const chapterPath = path.join(root, "chapters", `chapter-0${number}.md`);
      const raw = fs.readFileSync(chapterPath, "utf8");
      fs.writeFileSync(chapterPath, raw.replace("word-count: 0", `word-count: 0\ndate: ${date}`), "utf8");
    };
    dated(1, "2026-01-10");
    dated(2, "2026-01-10");
    dated(3, "2026-01-01");
    writeScene(root, 1, 1, `
date: 2026-01-10
time: "10:00"
`);

    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toContain("Chapter 3 date 2026-01-01 is earlier than Chapter 1 date 2026-01-10");
  });

  test("checks chapter dates when no scene has a date", () => {
    const root = baseProject(3);
    for (const [number, date] of [[1, "2026-01-10"], [2, "2026-01-10"], [3, "2026-01-01"]]) {
      const chapterPath = path.join(root, "chapters", `chapter-0${number}.md`);
      const raw = fs.readFileSync(chapterPath, "utf8");
      fs.writeFileSync(chapterPath, raw.replace("word-count: 0", `word-count: 0\ndate: ${date}`), "utf8");
    }

    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toContain("Chapter 3 date 2026-01-01 is earlier than Chapter 1 date 2026-01-10");
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("warns on malformed chapter dates when no scene has a date", () => {
    const root = baseProject(2);
    const chapterPath = path.join(root, "chapters", "chapter-02.md");
    const raw = fs.readFileSync(chapterPath, "utf8");
    fs.writeFileSync(chapterPath, raw.replace("word-count: 0", "word-count: 0\ndate: 2026-02-30"), "utf8");

    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toContain(`Chapter 2 has malformed date "2026-02-30"`);
  });

  test("warns on malformed chapter dates and times", () => {
    const root = baseProject(2);
    const chapterPath = path.join(root, "chapters", "chapter-02.md");
    const raw = fs.readFileSync(chapterPath, "utf8");
    fs.writeFileSync(chapterPath, raw.replace("word-count: 0", `word-count: 0\ndate: 2026-02-30`), "utf8");
    const chapterOne = path.join(root, "chapters", "chapter-01.md");
    const rawOne = fs.readFileSync(chapterOne, "utf8");
    fs.writeFileSync(chapterOne, rawOne.replace("word-count: 0", `word-count: 0\ndate: 2026-01-05\ntime: someday`), "utf8");
    writeScene(root, 1, 1, `
date: 2026-01-05
time: "10:00"
`);

    const result = checkContinuity(scanProject(root));
    expect(result.warnings).toContain(`Chapter 2 has malformed date "2026-02-30"`);
    expect(result.warnings).toContain(`Chapter 1 has malformed time "someday"`);
  });
});

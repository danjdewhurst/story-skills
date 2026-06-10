import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { checkContinuity } from "../src/continuity.js";
import {
  checkProjectContinuity,
  createStoryProject,
  formatActionReport,
  projectActions,
  scanProject,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

function writeChapter(root, number, frontmatter) {
  writeMarkdown(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), `
title: Chapter ${number}
number: ${number}
${frontmatter.trim()}
status: draft
word-count: 0
`, `# Chapter ${number}\n\n## Chapter Text\n\nWords.\n`);
}

describe("continuity checks", () => {
  test("flags dead characters, cast mismatches, and numbering gaps", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Deaths", force: false });
    const root = created.root;

    writeMarkdown(path.join(root, "characters", "edran-vale.md"), `
name: Edran Vale
role: supporting
status: deceased
died-in: chapter-01
`, "# Edran\n");
    writeMarkdown(path.join(root, "characters", "liv-marsh.md"), `
name: Liv Marsh
role: supporting
status: alive
died-in: chapter-01
`, "# Liv\n");
    writeMarkdown(path.join(root, "characters", "ghost-orin.md"), `
name: Ghost Orin
role: minor
status: deceased
died-in: chapter-09
`, "# Orin\n");
    writeMarkdown(path.join(root, "characters", "mara-finn.md"), `
name: Mara Finn
role: protagonist
status: alive
`, "# Mara\n");
    writeMarkdown(path.join(root, "characters", "old-tomas.md"), `
name: Old Tomas
role: minor
status: alive
`, "# Tomas\n");
    writeMarkdown(path.join(root, "characters", "stray-soul.md"), `
name: Stray Soul
role: minor
status: alive
`, "# Stray\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "old-mill.md"), `
name: Old Mill
type: building
`, "# Mill\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "elsewhere-lane.md"), `
name: Elsewhere Lane
type: street
`, "# Lane\n");

    writeChapter(root, 1, `
pov: mara-finn
locations:
  - old-mill
characters:
  - edran-vale
  - liv-marsh
  - mara-finn
`);
    writeChapter(root, 2, `
pov: mara-finn
locations:
  - old-mill
characters:
  - edran-vale
`);
    writeChapter(root, 3, `
pov: edran-vale
locations: []
characters: []
mentions:
  - edran-vale
  - old-tomas
  - nobody-here
`);
    writeChapter(root, 5, `
pov: mara-finn
locations: []
characters:
  - mara-finn
`);

    writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), `
title: Opening
chapter: chapter-01
scene: 1
pov: mara-finn
location: old-mill
characters:
  - edran-vale
status: draft
state-changes: []
`, "# Opening\n");
    writeMarkdown(path.join(root, "scenes", "chapter-02-scene-01.md"), `
title: Aftermath
chapter: chapter-02
scene: 1
pov: edran-vale
location: elsewhere-lane
characters:
  - edran-vale
status: draft
state-changes: []
`, "# Aftermath\n");
    writeMarkdown(path.join(root, "scenes", "chapter-03-scene-01.md"), `
title: Memorial
chapter: chapter-03
scene: 1
pov: ""
location: ""
characters:
  - old-tomas
status: draft
state-changes: []
`, "# Memorial\n");
    writeMarkdown(path.join(root, "scenes", "chapter-05-scene-01.md"), `
title: Stray
chapter: chapter-05
scene: 1
pov: ""
location: old-mill
characters:
  - stray-soul
status: draft
state-changes: []
`, "# Stray\n");
    writeMarkdown(path.join(root, "scenes", "chapter-77-scene-01.md"), `
title: Orphan
chapter: chapter-77
scene: 1
pov: ""
location: ""
characters: []
mentions:
  - nobody-scene
status: draft
state-changes: []
`, "# Orphan\n");

    writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: deaths
current-chapter: 0
`, "# Continuity State\n");

    const result = checkContinuity(scanProject(root));
    const errors = result.errors.join("\n");
    const warnings = result.warnings.join("\n");

    expect(result.ok).toBe(false);
    expect(errors).toContain("characters/liv-marsh.md has died-in chapter-01 but status alive; set status: deceased");
    expect(errors).toContain("characters/ghost-orin.md died-in references missing chapter chapter-09");
    expect(errors).toContain("chapters/chapter-02.md lists edran-vale, who died in chapter-01");
    expect(errors).toContain("chapters/chapter-03.md lists edran-vale, who died in chapter-01");
    expect(errors).toContain("scenes/chapter-02-scene-01.md lists edran-vale, who died in chapter-01");
    expect(warnings).toContain("chapters/chapter-03.md POV character edran-vale is not listed in characters");
    expect(warnings).toContain("scenes/chapter-01-scene-01.md POV character mara-finn is not listed in characters");
    expect(warnings).toContain("scenes/chapter-05-scene-01.md lists stray-soul but chapters/chapter-05.md does not list them in characters or mentions");
    expect(warnings).toContain("scenes/chapter-02-scene-01.md is set in elsewhere-lane but chapters/chapter-02.md does not list that location");
    expect(warnings).toContain("Chapter numbering skips from 3 to 5");
    expect(warnings).toContain("continuity/state.md current-chapter 0 is behind the latest chapter 5");
    expect(warnings).not.toContain("chapter-03-scene-01.md lists old-tomas");

    expect(checkProjectContinuity(root).ok).toBe(false);
    expect(validateProject(root).errors.join("\n")).not.toContain("died-in");

    const links = validateLinks(root).errors.join("\n");
    expect(links).toContain("chapters/chapter-03.md references missing character nobody-here");
    expect(links).toContain("scenes/chapter-77-scene-01.md references missing character nobody-scene");
  });

  test("flags promise, question, completion, and durable state contradictions", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Promises", force: false });
    const root = created.root;
    fs.writeFileSync(
      path.join(root, "story.md"),
      fs.readFileSync(path.join(root, "story.md"), "utf8").replace("status: planning", "status: complete"),
      "utf8"
    );

    for (const number of [1, 2, 3, 4]) {
      writeChapter(root, number, "pov: \"\"\nlocations: []\ncharacters: []");
    }
    writeMarkdown(path.join(root, "characters", "kira-snow.md"), `
name: Kira Snow
role: protagonist
status: alive
`, "# Kira\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "salt-row.md"), `
name: Salt Row
type: street
`, "# Salt Row\n");
    writeMarkdown(path.join(root, "worldbuilding", "factions", "tide-guild.md"), `
name: Tide Guild
type: guild
status: active
`, "# Guild\n");
    writeMarkdown(path.join(root, "worldbuilding", "artifacts", "silver-key.md"), `
name: Silver Key
type: object
status: hidden
`, "# Key\n");

    writeMarkdown(path.join(root, "continuity", "promises", "long-fuse.md"), `
title: Long Fuse
status: planted
planted: chapter-01
payoff: ""
`, "# Long Fuse\n");
    writeMarkdown(path.join(root, "continuity", "promises", "backwards-payoff.md"), `
title: Backwards Payoff
status: paid-off
planted: chapter-03
payoff: chapter-02
`, "# Backwards\n");
    writeMarkdown(path.join(root, "continuity", "promises", "missing-payoff.md"), `
title: Missing Payoff
status: paid-off
planted: ""
payoff: ""
`, "# Missing\n");
    writeMarkdown(path.join(root, "continuity", "promises", "unrooted-plant.md"), `
title: Unrooted Plant
status: planted
planted: ""
payoff: ""
`, "# Unrooted\n");
    writeMarkdown(path.join(root, "continuity", "promises", "early-record.md"), `
title: Early Record
status: planned
planted: chapter-02
payoff: ""
`, "# Early\n");

    writeMarkdown(path.join(root, "continuity", "questions", "reversed.md"), `
title: Reversed
status: resolved
introduced: chapter-03
resolved: chapter-02
`, "# Reversed\n");
    writeMarkdown(path.join(root, "continuity", "questions", "unanchored.md"), `
title: Unanchored
status: answered
introduced: chapter-01
resolved: ""
`, "# Unanchored\n");
    writeMarkdown(path.join(root, "continuity", "questions", "lingering.md"), `
title: Lingering
status: open
introduced: chapter-01
resolved: chapter-02
`, "# Lingering\n");

    writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: promises
current-chapter: 7
character-state:
  - loose-note
  - character: missing-person
  - character: kira-snow
    location: nowhere-bay
  - character: kira-snow
    location: salt-row
knowledge-state:
  - character: ""
    knows: a secret
  - character: kira-snow
    knows: ""
  - character: kira-snow
    knows: the key is real
    learned-in: chapter-09
object-state:
  - artifact: ghost-item
  - artifact: silver-key
    owner: nobody-known
  - artifact: silver-key
    owner: tide-guild
    location: nowhere-bay
  - artifact: silver-key
    owner: kira-snow
    location: salt-row
    status: active
`, "# Continuity State\n");

    const result = checkContinuity(scanProject(root));
    const errors = result.errors.join("\n");
    const warnings = result.warnings.join("\n");

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(20);
    expect(result.warnings).toHaveLength(3);
    expect(errors).toContain("continuity/promises/backwards-payoff.md pays off in chapter-02 before it is planted in chapter-03");
    expect(errors).toContain("continuity/promises/missing-payoff.md is paid-off but has no payoff chapter");
    expect(errors).toContain("continuity/promises/unrooted-plant.md is planted but has no planted chapter");
    expect(errors).toContain("continuity/questions/reversed.md resolves in chapter-02 before it is introduced in chapter-03");
    expect(errors).toContain("continuity/questions/unanchored.md is answered but has no resolved chapter");
    expect(errors).toContain("continuity/questions/lingering.md records resolved chapter chapter-02 but status is still open");
    expect(errors).toContain("story.md is complete but continuity/promises/long-fuse.md is still planted");
    expect(errors).toContain("story.md is complete but continuity/promises/early-record.md is still planned");
    expect(errors).toContain("story.md is complete but continuity/questions/lingering.md is still open");
    expect(errors).toContain("continuity/state.md current-chapter 7 is ahead of the latest chapter 4");
    expect(errors).toContain("continuity/state.md character-state[0] must be a mapping");
    expect(errors).toContain("continuity/state.md character-state[1] references missing character missing-person");
    expect(errors).toContain("continuity/state.md character-state[2] references missing location nowhere-bay");
    expect(errors).toContain("continuity/state.md knowledge-state[0] references missing character (unset)");
    expect(errors).toContain("continuity/state.md knowledge-state[1] is missing knows");
    expect(errors).toContain("continuity/state.md knowledge-state[2] references missing chapter chapter-09");
    expect(errors).toContain("continuity/state.md object-state[0] references missing artifact ghost-item");
    expect(errors).toContain("continuity/state.md object-state[1] references missing owner nobody-known");
    expect(errors).toContain("continuity/state.md object-state[2] references missing location nowhere-bay");
    expect(warnings).toContain("continuity/promises/long-fuse.md was planted in chapter-01, 3 chapters ago, and has no payoff yet");
    expect(warnings).toContain("continuity/promises/early-record.md records planted chapter chapter-02 but status is still planned");
    expect(warnings).toContain("continuity/state.md object-state[3] status active conflicts with worldbuilding/artifacts/silver-key.md status hidden");

    const actionReport = formatActionReport(projectActions(root));
    expect(actionReport).toContain("Fix continuity contradictions");
    expect(actionReport).toContain("Review continuity warnings");
  });

  test("passes clean projects and skips missing continuity state", () => {
    const cwd = makeTempDir();
    const created = createStoryProject({ cwd, title: "Clean", force: false });

    const clean = checkContinuity(scanProject(created.root));
    expect(clean).toEqual({ ok: true, errors: [], warnings: [] });

    writeMarkdown(path.join(created.root, "characters", "lone-scribe.md"), `
name: Lone Scribe
role: protagonist
status: alive
`, "# Scribe\n");
    expect(formatActionReport(projectActions(created.root))).toContain("Project is mechanically healthy");

    fs.rmSync(path.join(created.root, "continuity", "state.md"));
    expect(checkContinuity(scanProject(created.root)).ok).toBe(true);
  });
});

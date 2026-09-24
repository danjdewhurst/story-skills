import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createEntity, createStoryProject, diagramProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function writeCharacter(root, id, name, status, relationships) {
  writeMarkdown(path.join(root, "characters", `${id}.md`), `
name: ${name}
role: supporting
status: ${status}
relationships:
${relationships.map(([character, type]) => `  - character: ${character}\n    type: ${type}`).join("\n")}
`, `# ${name}\n`);
}

function diagramFixture() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Graph: Book", force: false });
  writeCharacter(root, "ada", "Ada \"The Elder\"", "deceased", [["ben", "parent"], ["cy", "rival"]]);
  writeCharacter(root, "ben", "Ben", "alive", [["ada", "child"], ["cy", "sibling"]]);
  writeCharacter(root, "cy", "Cy | Twin", "alive", [["ben", "sibling"], ["ada", "rival"], ["ghost", "friend"]]);
  writeMarkdown(path.join(root, "worldbuilding", "locations", "port.md"), `
name: Port
type: town
region: Coast
routes:
  - to: fort
    hours: 5
    mode: cart
  - to: nowhere
    hours: 1
`, "# Port\n");
  writeMarkdown(path.join(root, "worldbuilding", "locations", "fort.md"), `
name: Fort
type: keep
routes:
  - to: inn
    hours: 2
`, "# Fort\n");
  writeMarkdown(path.join(root, "worldbuilding", "locations", "inn.md"), `
name: Inn
type: inn
routes:
  - to: fort
    hours: 3
`, "# Inn\n");
  for (const number of [1, 2, 3]) {
    writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Part ${number}
number: ${number}
status: draft
${number === 2 ? "date: 2024-01-01\ntime: 09:30\narcs-advanced:\n  - main-line" : ""}
`, "## Chapter Text\n\nWords.\n");
  }
  writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), `
title: "Dock: arrival"
chapter: chapter-01
scene: 1
status: draft
date: 2024-01-02
arcs-advanced:
  - main-line
  - missing-arc
`, "# Scene\n");
  createEntity(root, { kind: "arc", name: "Main Line" });
  writeMarkdown(path.join(root, "continuity", "clues", "ash.md"), "title: Ash\nstatus: paid-off\nplanted: chapter-01\npayoff: chapter-03", "# Ash\n");
  writeMarkdown(path.join(root, "continuity", "clues", "glove.md"), "title: Glove\nstatus: planted\nplanted: chapter-02\nred-herring: true", "# Glove\n");
  writeMarkdown(path.join(root, "continuity", "clues", "cut.md"), "title: Cut\nstatus: dropped\nplanted: chapter-01", "# Cut\n");
  return { root, cwd };
}

describe("story diagram", () => {
  test("relationships draws one edge per pair, family edges heavy, and marks the dead", () => {
    const { root } = diagramFixture();
    expect(diagramProject(root, { kind: "relationships" }).text).toBe(`flowchart LR
  ada["Ada #quot;The Elder#quot;"]
  ben["Ben"]
  cy["Cy #124; Twin"]
  ada ==>|parent| ben
  ada -.-|rival| cy
  ben ===|sibling| cy
  classDef deceased stroke-dasharray: 4 4,color:#888
  class ada deceased
`);
  });

  test("locations draws two-way routes once and one-way declarations as arrows", () => {
    const { root } = diagramFixture();
    expect(diagramProject(root, { kind: "locations" }).text).toBe(`flowchart LR
  fort["Fort"]
  inn["Inn"]
  port["Port<br/>Coast"]
  fort -->|2h| inn
  inn -->|3h| fort
  port ---|5h cart| fort
`);
  });

  test("timeline groups dated entries by day and escapes colons", () => {
    const { root } = diagramFixture();
    expect(diagramProject(root, { kind: "timeline" }).text).toBe(`timeline
  title Graph∶ Book
  section 2024-01-01
    09∶30 : Part 2 (told in chapter 2)
  section 2024-01-02
    day : Dock∶ arrival
`);
  });

  test("clues links plant to reveal, dots red herrings, and skips dropped clues", () => {
    const { root } = diagramFixture();
    const text = diagramProject(root, { kind: "clues" }).text;
    expect(text).toContain("  chapter_01 ~~~ chapter_02\n");
    expect(text).toContain("  chapter_01 -->|Ash| chapter_03\n");
    expect(text).toContain("  chapter_02 -.->|Glove (red herring)| unrevealed((\"not yet revealed\"))\n");
    expect(text).not.toContain("Cut");
    expect(text).toContain("class unrevealed open");
  });

  test("arcs joins each arc to the chapters and scenes that advance it", () => {
    const { root } = diagramFixture();
    const text = diagramProject(root, { kind: "arcs" }).text;
    expect(text).toContain("  arc_main_line([\"Main Line\"])\n");
    expect(text).toContain("  arc_main_line --> chapter_01\n");
    expect(text).toContain("  arc_main_line --> chapter_02\n");
    expect(text).not.toContain("missing");
  });

  test("CLI prints to stdout, writes --out, and rejects unknown kinds", () => {
    const { root, cwd } = diagramFixture();
    const printed = invoke(cwd, ["diagram", "arcs", "--path", root]);
    expect(printed.code).toBe(0);
    expect(printed.out.startsWith("flowchart LR\n")).toBe(true);

    const written = invoke(cwd, ["diagram", "locations", "--path", root, "--out", "dist/map.mmd"]);
    expect(written.code).toBe(0);
    expect(written.out).toContain("Wrote locations diagram to");
    expect(fs.readFileSync(path.join(root, "dist", "map.mmd"), "utf8")).toContain("port ---|5h cart| fort");

    const bad = invoke(cwd, ["diagram", "weather", "--path", root]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("Unknown diagram kind: weather. Supported kinds: relationships, locations, timeline, clues, arcs");
  });
});

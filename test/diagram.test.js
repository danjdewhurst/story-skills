import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { DIAGRAM_KINDS } from "../src/diagram.js";
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
  ada ==>|"parent"| ben
  ada -.-|"rival"| cy
  ben ===|"sibling"| cy
  classDef deceased stroke-dasharray: 4 4,color:#888
  class ada deceased
`);
  });

  test("locations draws a route declared once as a line and a route declared both ways as two arrows", () => {
    const { root } = diagramFixture();
    expect(diagramProject(root, { kind: "locations" }).text).toBe(`flowchart LR
  fort["Fort"]
  inn["Inn"]
  port["Port<br/>Coast"]
  fort -->|"2h"| inn
  inn -->|"3h"| fort
  port ---|"5h cart"| fort
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
    expect(text).toContain("  chapter_01 -->|\"Ash\"| chapter_03\n");
    expect(text).toContain("  chapter_02 -.->|\"Glove (red herring)\"| unrevealed((\"not yet revealed\"))\n");
    expect(text).not.toContain("Cut");
    expect(text).toContain("class unrevealed open");
  });

  test("arcs joins each arc to the chapters and scenes that advance it", () => {
    const { root } = diagramFixture();
    const text = diagramProject(root, { kind: "arcs" }).text;
    expect(text).toContain("  arc__main_line([\"Main Line\"])\n");
    expect(text).toContain("  arc__main_line --> chapter_01\n");
    expect(text).toContain("  arc__main_line --> chapter_02\n");
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
    expect(fs.readFileSync(path.join(root, "dist", "map.mmd"), "utf8")).toContain("port ---|\"5h cart\"| fort");

    const bad = invoke(cwd, ["diagram", "weather", "--path", root]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("Unknown diagram kind: weather. Supported kinds: relationships, locations, timeline, clues, arcs");
  });

  test("--json returns the nodes and edges the Mermaid text is drawn from", () => {
    const { root, cwd } = diagramFixture();
    const json = (kind) => {
      const run = invoke(cwd, ["diagram", kind, "--path", root, "--json"]);
      expect(run.code).toBe(0);
      const { data } = JSON.parse(run.out);
      expect(data.text).toBe(diagramProject(root, { kind }).text);
      return data;
    };

    const relationships = json("relationships");
    expect(relationships.nodes).toEqual([
      { id: "ada", label: "Ada \"The Elder\"", kind: "character", state: "deceased" },
      { id: "ben", label: "Ben", kind: "character", state: "alive" },
      { id: "cy", label: "Cy | Twin", kind: "character", state: "alive" }
    ]);
    expect(relationships.edges).toEqual([
      { from: "ada", to: "ben", label: "parent", kind: "family-directed" },
      { from: "ada", to: "cy", label: "rival", kind: "relationship" },
      { from: "ben", to: "cy", label: "sibling", kind: "family" }
    ]);
    expect(relationships.groups).toBeUndefined();

    const locations = json("locations");
    expect(locations.nodes.find((node) => node.id === "port")).toEqual({ id: "port", label: "Port", kind: "location", region: "Coast" });
    expect(locations.nodes.find((node) => node.id === "fort").region).toBeNull();
    expect(locations.edges).toEqual([
      { from: "fort", to: "inn", label: "2h", kind: "route", hours: 2, mode: null, reverse: true },
      { from: "inn", to: "fort", label: "3h", kind: "route", hours: 3, mode: null, reverse: true },
      { from: "port", to: "fort", label: "5h cart", kind: "route", hours: 5, mode: "cart", reverse: false }
    ]);

    const timeline = json("timeline");
    expect(timeline.title).toBe("Graph: Book");
    expect(timeline.nodes).toEqual([
      { id: "chapter-02", label: "Part 2", kind: "event", date: "2024-01-01", time: "09:30", toldLateIn: 2 },
      { id: "chapter-01-scene-01", label: "Dock: arrival", kind: "event", date: "2024-01-02", time: null, toldLateIn: null }
    ]);
    expect(timeline.edges).toEqual([]);
    expect(timeline.groups).toEqual([
      { label: "2024-01-01", kind: "date", nodes: ["chapter-02"] },
      { label: "2024-01-02", kind: "date", nodes: ["chapter-01-scene-01"] }
    ]);

    const clues = json("clues");
    expect(clues.nodes.map((node) => `${node.kind}:${node.id}`)).toEqual(["chapter:chapter-01", "chapter:chapter-02", "chapter:chapter-03", "unrevealed:unrevealed"]);
    expect(clues.nodes[0]).toEqual({ id: "chapter-01", label: "Part 1", kind: "chapter", number: 1 });
    expect(clues.edges.filter((edge) => edge.kind !== "sequence")).toEqual([
      { from: "chapter-01", to: "chapter-03", label: "Ash", kind: "clue", clue: "ash", revealed: true },
      { from: "chapter-02", to: "unrevealed", label: "Glove", kind: "red-herring", clue: "glove", revealed: false }
    ]);
    expect(clues.edges.filter((edge) => edge.kind === "sequence").map((edge) => `${edge.from}>${edge.to}`)).toEqual(["chapter-01>chapter-02", "chapter-02>chapter-03"]);

    const arcs = json("arcs");
    expect(arcs.nodes[0]).toEqual({ id: "main-line", label: "Main Line", kind: "arc" });
    expect(arcs.edges).toEqual([
      { from: "main-line", to: "chapter-01", label: null, kind: "advances" },
      { from: "main-line", to: "chapter-02", label: null, kind: "advances" }
    ]);
  });

  test("chapter labels are strings with whitespace closed up, as drawn", () => {
    const { root } = diagramFixture();
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: \"  Two   words \"\nnumber: 1\nstatus: draft", "Words.\n");
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: 42\nnumber: 2\nstatus: draft", "Words.\n");
    const diagram = diagramProject(root, { kind: "arcs" });
    const labels = Object.fromEntries(diagram.nodes.filter((node) => node.kind === "chapter").map((node) => [node.id, node.label]));
    expect(labels).toMatchObject({ "chapter-01": "Two words", "chapter-02": "42" });
    expect(diagram.text).toContain("  chapter_01[\"1. Two words\"]\n");
    expect(diagram.text).toContain("  chapter_02[\"2. 42\"]\n");
  });

  // The Mermaid text is rendered from the node and edge model; these golden
  // files pin it byte for byte for every kind on every example. A deliberate
  // change to the output updates the matching file in test/fixtures/diagrams.
  const examplesDir = path.join(import.meta.dir, "..", "examples");
  const goldenDir = path.join(import.meta.dir, "fixtures", "diagrams");
  const examples = fs.readdirSync(examplesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

  test("golden files cover every example and kind", () => {
    expect(fs.readdirSync(goldenDir).sort()).toEqual(examples);
    for (const example of examples) {
      expect(fs.readdirSync(path.join(goldenDir, example)).sort()).toEqual(DIAGRAM_KINDS.map((kind) => `${kind}.mmd`).sort());
    }
  });

  for (const example of examples) {
    test(`${example} diagrams match their golden files`, () => {
      for (const kind of DIAGRAM_KINDS) {
        const golden = fs.readFileSync(path.join(goldenDir, example, `${kind}.mmd`), "utf8");
        expect(`${kind}:\n${diagramProject(path.join(examplesDir, example), { kind }).text}`).toBe(`${kind}:\n${golden}`);
      }
    });
  }
});

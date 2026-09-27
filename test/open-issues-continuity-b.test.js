import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { checkContinuity } from "../src/continuity.js";
import { createEntity, createStoryProject, scanProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

function pad(number) {
  return String(number).padStart(2, "0");
}

function writeChapter(root, number, fields = "", status = "draft") {
  writeMarkdown(path.join(root, "chapters", `chapter-${pad(number)}.md`), `
title: C${number}
number: ${number}
status: ${status}
${fields}
`, "## Chapter Text\n\nSome prose here.\n");
}

function writeScene(root, chapter, scene, fields = "") {
  writeMarkdown(path.join(root, "scenes", `chapter-${pad(chapter)}-scene-${pad(scene)}.md`), `
title: Scene ${chapter}.${scene}
chapter: chapter-${pad(chapter)}
scene: ${scene}
status: draft
${fields}
`, "# Scene\n");
}

function addRoutes(root, location, routes) {
  const file = path.join(root, "worldbuilding", "locations", `${location}.md`);
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.replace(/^---\n/, `---\nroutes:\n${routes.trim().split("\n").map((line) => `  ${line}`).join("\n")}\n`), "utf8");
}

function setStatus(file, status) {
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^status: .*$/m, `status: ${status}`), "utf8");
}

// Characters ann and bob, locations alpha..delta, and drafted chapters.
function baseProject(chapters = 5) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Base", force: false });
  for (const name of ["Ann", "Bob"]) {
    createEntity(root, { kind: "character", name });
  }
  for (const name of ["Alpha", "Beta", "Gamma", "Delta"]) {
    createEntity(root, { kind: "location", name });
  }
  for (let number = 1; number <= chapters; number += 1) {
    writeChapter(root, number, "characters:\n  - ann\n  - bob");
  }
  writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: base
current-chapter: ${chapters}
`, "# Continuity State\n");
  return root;
}

function continuity(root) {
  return checkContinuity(scanProject(root));
}

function sighting(location, time = "\"10:00\"") {
  return `date: 2024-05-01\ntime: ${time}\nlocation: ${location}\ncharacters:\n  - ann`;
}

describe("two places at once (#171)", () => {
  test("reports different places at the same exact minute across route components", () => {
    const root = baseProject(1);
    addRoutes(root, "alpha", "- to: beta\n  hours: 2");
    addRoutes(root, "gamma", "- to: delta\n  hours: 2");
    writeScene(root, 1, 1, sighting("alpha"));
    writeScene(root, 1, 2, sighting("gamma"));

    expect(messages(continuity(root).errors)).toEqual([
      "scenes/chapter-01-scene-02.md puts ann at gamma at the same time as scenes/chapter-01-scene-01.md at alpha"
    ]);
  });

  test("reports it when the project has no routes at all", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, sighting("alpha"));
    writeScene(root, 1, 2, sighting("beta"));

    expect(messages(continuity(root).errors)).toEqual([
      "scenes/chapter-01-scene-02.md puts ann at beta at the same time as scenes/chapter-01-scene-01.md at alpha"
    ]);
  });

  test("ignores the same place, different minutes, and named times without routes", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, sighting("alpha"));
    writeScene(root, 1, 2, sighting("alpha"));
    writeScene(root, 1, 3, sighting("beta", "\"10:01\""));
    writeScene(root, 1, 4, sighting("gamma", "morning"));
    writeScene(root, 1, 5, sighting("delta", "morning"));

    expect(messages(continuity(root).errors)).toEqual([]);
  });

  test("still reports connected places with the route message", () => {
    const root = baseProject(1);
    addRoutes(root, "alpha", "- to: beta\n  hours: 2");
    writeScene(root, 1, 1, sighting("alpha"));
    writeScene(root, 1, 2, sighting("beta"));

    expect(messages(continuity(root).errors)).toEqual([
      "scenes/chapter-01-scene-02.md puts ann at beta 0h after scenes/chapter-01-scene-01.md at alpha, but the fastest route takes 2h"
    ]);
  });
});

describe("clock order reads named times as windows (#84)", () => {
  test("an exact time inside a later named window is not backward", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, "date: 2024-01-01\ntime: \"10:20\"");
    writeScene(root, 1, 2, "date: 2024-01-01\ntime: morning");

    expect(messages(continuity(root).warnings).filter((warning) => warning.includes("runs backward"))).toEqual([]);
  });

  test("a time that cannot fall after the reference is still backward", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, "date: 2024-01-01\ntime: \"13:00\"");
    writeScene(root, 1, 2, "date: 2024-01-01\ntime: morning");
    writeScene(root, 1, 3, "date: 2024-01-01\ntime: \"14:00\"");

    expect(messages(continuity(root).warnings)).toContain("scenes/chapter-01-scene-02.md timestamp runs backward");
    expect(messages(continuity(root).warnings)).not.toContain("scenes/chapter-01-scene-03.md timestamp runs backward");
  });

  test("the reference keeps the later known time when a named window starts before it", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, "date: 2024-01-01\ntime: \"10:20\"");
    writeScene(root, 1, 2, "date: 2024-01-01\ntime: morning");
    writeScene(root, 1, 3, "date: 2024-01-01\ntime: \"10:00\"");

    expect(messages(continuity(root).warnings)).toContain("scenes/chapter-01-scene-03.md timestamp runs backward");
  });

  test("travel-hours uses the widest reading of named times", () => {
    const root = baseProject(1);
    writeScene(root, 1, 1, "date: 2024-01-01\ntime: morning");
    writeScene(root, 1, 2, "date: 2024-01-01\ntime: evening\ntravel-hours: 13");
    expect(messages(continuity(root).errors)).toEqual([]);

    writeScene(root, 1, 2, "date: 2024-01-01\ntime: evening\ntravel-hours: 18");
    expect(messages(continuity(root).errors)).toEqual(["scenes/chapter-01-scene-02.md allows at most 16.9h for travel of 18h"]);
  });

  test("the CLI repro gives no warning", () => {
    const cwd = makeTempDir();
    const io = memoryIo(cwd);
    expect(runCli(["init", "CL", "--dir", "cl"], io)).toBe(0);
    const root = path.join(cwd, "cl");
    const run = (argv) => runCli([...argv, "--path", root], memoryIo(cwd));
    run(["add", "chapter", "One"]);
    run(["add", "scene", "A", "--chapter", "chapter-01", "--date", "2024-01-01", "--time", "10:20"]);
    run(["add", "scene", "B", "--chapter", "chapter-01", "--date", "2024-01-01", "--time", "morning"]);

    expect(messages(continuity(root).warnings).filter((warning) => warning.includes("runs backward"))).toEqual([]);
  });
});

describe("cut characters still referenced (#115)", () => {
  test("warns for each cast, pov, arc, and relationship reference", () => {
    const root = baseProject(1);
    writeChapter(root, 1, "pov: ann\ncharacters:\n  - ann\n  - bob");
    writeScene(root, 1, 1, "pov: bob\ncharacters:\n  - bob");
    createEntity(root, { kind: "arc", name: "Main", type: "main", characters: ["bob"] });
    const annFile = path.join(root, "characters", "ann.md");
    const bobFile = path.join(root, "characters", "bob.md");
    fs.writeFileSync(annFile, fs.readFileSync(annFile, "utf8").replace("relationships: []", "relationships:\n  - character: bob\n    type: friend"), "utf8");
    fs.writeFileSync(bobFile, fs.readFileSync(bobFile, "utf8").replace("relationships: []", "relationships:\n  - character: ann\n    type: friend"), "utf8");
    setStatus(bobFile, "cut");

    const warnings = messages(continuity(root).warnings).filter((warning) => warning.includes("status: cut"));
    expect(warnings).toEqual([
      "chapters/chapter-01.md lists bob, who has status: cut; drop them from pov and characters",
      "scenes/chapter-01-scene-01.md lists bob, who has status: cut; drop them from pov and characters",
      "plot/arcs/main.md lists bob, who has status: cut; drop them from characters",
      "characters/ann.md has a relationship with bob, but bob has status: cut; drop the relationship on both sides",
      "characters/bob.md has a relationship with ann, but bob has status: cut; drop the relationship on both sides"
    ]);
  });

  test("a clean cut gives no warning", () => {
    const root = baseProject(1);
    writeChapter(root, 1, "characters:\n  - ann");
    setStatus(path.join(root, "characters", "bob.md"), "cut");

    expect(messages(continuity(root).warnings).filter((warning) => warning.includes("status: cut"))).toEqual([]);
  });
});

describe("planned and payoff warnings read the named chapter's own status (#164)", () => {
  test("outline planted and payoff chapters give no warning when later chapters are drafted", () => {
    const root = baseProject(5);
    writeChapter(root, 2, "", "outline");
    writeChapter(root, 3, "", "outline");
    writeMarkdown(path.join(root, "continuity", "promises", "gun.md"), "title: Gun\nstatus: planned\nplanted: chapter-02", "# Gun\n");
    writeMarkdown(path.join(root, "continuity", "promises", "knife.md"), "title: Knife\nstatus: planted\nplanted: chapter-01\npayoff: chapter-03", "# Knife\n");
    writeMarkdown(path.join(root, "continuity", "clues", "glove.md"), "title: Glove\nstatus: planted\nplanted: chapter-01\npayoff: chapter-02", "# Glove\n");

    const result = continuity(root);
    expect(messages(result.warnings).filter((warning) => warning.includes("continuity/"))).toEqual([]);
  });

  test("drafted planted and payoff chapters still warn", () => {
    const root = baseProject(5);
    writeMarkdown(path.join(root, "continuity", "promises", "gun.md"), "title: Gun\nstatus: planned\nplanted: chapter-02", "# Gun\n");
    writeMarkdown(path.join(root, "continuity", "promises", "knife.md"), "title: Knife\nstatus: planted\nplanted: chapter-01\npayoff: chapter-03", "# Knife\n");

    const warnings = messages(continuity(root).warnings);
    expect(warnings).toContain("continuity/promises/gun.md records planted chapter chapter-02 but status is still planned");
    expect(warnings).toContain("continuity/promises/knife.md payoff chapter chapter-03 has passed and status is still planted");
  });
});

describe("continuity help lists every check (#168)", () => {
  test("mentions clues, custody, clock and travel time, and routes", () => {
    const io = memoryIo(makeTempDir());
    runCli(["continuity", "--help"], io);
    const help = (io.output() + io.error()).replace(/\s+/g, " ");
    for (const phrase of ["clues", "prop custody", "clock and travel time", "routes"]) {
      expect(help).toContain(phrase);
    }
  });
});

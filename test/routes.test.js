import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { checkContinuity } from "../src/continuity.js";
import {
  checkProjectContinuity,
  createEntity,
  createStoryProject,
  diagramProject,
  removeEntity,
  renameEntity,
  scanProject,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, writeMarkdown, messages } from "./helpers.js";

function writeLocation(root, id, routes) {
  writeMarkdown(path.join(root, "worldbuilding", "locations", `${id}.md`), `
name: ${id}
type: town
${routes}
`, `# ${id}\n`);
}

function writeScene(root, chapter, scene, fields) {
  writeMarkdown(path.join(root, "scenes", `${chapter}-scene-0${scene}.md`), `
title: ${chapter} ${scene}
chapter: ${chapter}
scene: ${scene}
status: draft
${fields}
`, "# Scene\n");
}

function routeProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Roads", force: false });
  createEntity(root, { kind: "character", name: "Mara" });
  createEntity(root, { kind: "character", name: "Tom" });
  for (const number of [1, 2]) {
    writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
`, "## Chapter Text\n\nWords.\n");
  }
  // harbor <-> mill 6h (declared once, so two-way); mill -> keep 10h and
  // keep -> mill 20h (each side declares its own); tower is unconnected.
  writeLocation(root, "harbor", "routes:\n  - to: mill\n    hours: 6\n    mode: cart");
  writeLocation(root, "mill", "routes:\n  - to: keep\n    hours: 10");
  writeLocation(root, "keep", "routes:\n  - to: mill\n    hours: 20");
  writeLocation(root, "tower", "");
  return root;
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function writeBaseChapter(root, number, fields = "", status = "draft") {
  writeMarkdown(path.join(root, "chapters", `chapter-${pad(number)}.md`), `
title: C${number}
number: ${number}
status: ${status}
${fields}
`, "## Chapter Text\n\nSome prose here.\n");
}

function writeBaseScene(root, chapter, scene, fields = "") {
  writeMarkdown(path.join(root, "scenes", `chapter-${pad(chapter)}-scene-${pad(scene)}.md`), `
title: Scene ${chapter}.${scene}
chapter: chapter-${pad(chapter)}
scene: ${scene}
status: draft
${fields}
`, "# Scene\n");
}

function writeState(root, lists, currentChapter = 5) {
  writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
story: base
current-chapter: ${currentChapter}
${lists}
`, "# Continuity State\n");
}

function addRoutes(root, location, routes) {
  const file = path.join(root, "worldbuilding", "locations", `${location}.md`);
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.replace(/^---\n/, `---\nroutes:\n${routes.trim().split("\n").map((line) => `  ${line}`).join("\n")}\n`), "utf8");
}

// Characters ann and bob, locations alpha..delta, artifact ring, and
// `chapters` drafted chapters with no fields.
function baseProject(chapters = 5) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Base", force: false });
  for (const name of ["Ann", "Bob"]) {
    createEntity(root, { kind: "character", name });
  }
  for (const name of ["Alpha", "Beta", "Gamma", "Delta"]) {
    createEntity(root, { kind: "location", name });
  }
  createEntity(root, { kind: "artifact", name: "Ring" });
  for (let number = 1; number <= chapters; number += 1) {
    writeBaseChapter(root, number);
  }
  writeState(root, "character-state: []\nobject-state: []\nknowledge-state: []", chapters);
  return root;
}

function continuity(root) {
  return checkContinuity(scanProject(root));
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

describe("location routes", () => {
  test("validate and links accept well-formed routes", () => {
    const root = routeProject();
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(messages(validateLinks(root).errors)).toEqual([]);
  });

  test("validate rejects malformed routes and links rejects missing or self targets", () => {
    const root = routeProject();
    writeLocation(root, "bad", "routes:\n  - hours: -1\n    mode: boat\n  - to: nowhere\n    hours: 2\n  - to: bad\n    hours: 1\n  - plain");
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain("worldbuilding/locations/bad.md route is missing to");
    expect(errors).toContain("worldbuilding/locations/bad.md route to ? hours must be a positive number");
    expect(errors).toContain("worldbuilding/locations/bad.md frontmatter field routes must contain objects");
    const links = messages(validateLinks(root).errors);
    expect(links).toContain("worldbuilding/locations/bad.md route references missing location nowhere");
    expect(links).toContain("worldbuilding/locations/bad.md route points at itself");
  });

  // mode is free text, which the codex and the travel messages show only
  // when it is a string; the schema has always asked for one (#565).
  test("validate asks for quotes around a route mode that is a number or true", () => {
    const root = routeProject();
    writeLocation(root, "ferry", "routes:\n  - to: harbor\n    hours: 2\n    mode: 3\n  - to: mill\n    hours: 1\n    mode: true\n  - to: keep\n    hours: 4\n    mode: \"3\"");
    expect(messages(validateProject(root).errors)).toEqual([
      "worldbuilding/locations/ferry.md route to harbor mode must be text: quote it as mode: \"3\"",
      "worldbuilding/locations/ferry.md route to mill mode must be text: quote it as mode: \"true\""
    ]);
  });

  test("continuity errors when a character outruns the fastest route", () => {
    const root = routeProject();
    // Mara: harbor 08:00 -> keep 20:00 same day = 12h, needs 6 + 10 = 16h.
    writeScene(root, "chapter-01", 1, "location: harbor\ndate: 2024-05-01\ntime: 08:00\npov: mara");
    writeScene(root, "chapter-01", 2, "location: keep\ndate: 2024-05-01\ntime: \"20:00\"\ncharacters:\n  - mara");
    // Tom: keep -> harbor without times over two days = 48h max, needs 20 + 6 = 26h: fine.
    writeScene(root, "chapter-02", 1, "location: keep\ndate: 2024-05-02\ncharacters:\n  - tom");
    writeScene(root, "chapter-02", 2, "location: harbor\ndate: 2024-05-03\ncharacters:\n  - tom");
    const result = checkProjectContinuity(root);
    expect(messages(result.errors)).toEqual([
      "scenes/chapter-01-scene-02.md puts mara at keep 12h after scenes/chapter-01-scene-01.md at harbor, but the fastest route takes 16h"
    ]);
  });

  test("one-way declarations, undated days, unconnected places, and same place stay quiet", () => {
    const root = routeProject();
    // keep -> mill is declared as 20h, so the 10h mill -> keep route does not apply backwards.
    writeScene(root, "chapter-01", 1, "location: keep\ndate: 2024-05-01\ntime: 06:00\ncharacters:\n  - mara");
    writeScene(root, "chapter-01", 2, "location: mill\ndate: 2024-05-01\ntime: \"18:00\"\ncharacters:\n  - mara");
    writeScene(root, "chapter-01", 3, "location: tower\ndate: 2024-05-01\ntime: \"19:00\"\ncharacters:\n  - mara");
    writeScene(root, "chapter-01", 4, "location: mill\ndate: 2024-05-01\ntime: \"19:30\"\ncharacters:\n  - tom");
    writeScene(root, "chapter-01", 5, "location: mill\ndate: 2024-05-01\ntime: \"20:00\"\ncharacters:\n  - tom");
    expect(messages(checkProjectContinuity(root).errors)).toEqual([
      "scenes/chapter-01-scene-02.md puts mara at mill 12h after scenes/chapter-01-scene-01.md at keep, but the fastest route takes 20h"
    ]);
  });

  test("places in separate route networks are not compared", () => {
    const root = routeProject();
    writeLocation(root, "isle", "routes:\n  - to: lighthouse\n    hours: 1");
    writeLocation(root, "lighthouse", "");
    writeScene(root, "chapter-01", 1, "location: harbor\ndate: 2024-05-01\ntime: 08:00\ncharacters:\n  - mara");
    writeScene(root, "chapter-01", 2, "location: isle\ndate: 2024-05-01\ntime: 08:05\ncharacters:\n  - mara");
    expect(messages(checkProjectContinuity(root).errors)).toEqual([]);
  });

  test("route travel stays inside one strand (#345)", () => {
    const root = routeProject();
    createEntity(root, { kind: "character", name: "Ada" });
    // mill -> keep is 5h. Twenty minutes on one calendar is not a journey
    // when the chapters are different strands.
    writeLocation(root, "mill", "routes:\n  - to: keep\n    hours: 5");
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: The Mill
number: 1
status: draft
strand: "1990"
`, "## Chapter Text\n\nWords.\n");
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), `
title: The Keep
number: 2
status: draft
strand: "2020"
`, "## Chapter Text\n\nWords.\n");
    writeScene(root, "chapter-01", 1, "location: mill\ndate: 1990-06-01\ntime: \"09:00\"\ncharacters:\n  - ada");
    writeScene(root, "chapter-02", 1, "location: keep\ndate: 1990-06-01\ntime: \"09:20\"\ncharacters:\n  - ada");
    expect(messages(checkProjectContinuity(root).errors)).toEqual([]);

    // The same exact minute at unrouted places is not a clash across strands.
    writeScene(root, "chapter-02", 2, "location: harbour\ndate: 1990-06-01\ntime: \"09:00\"\ncharacters:\n  - ada");
    expect(messages(checkProjectContinuity(root).errors)).toEqual([]);
    fs.rmSync(path.join(root, "scenes", "chapter-02-scene-02.md"));

    // The same twenty minutes inside one strand still outruns the route.
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"), `
title: The Keep
number: 2
status: draft
strand: "1990"
`, "## Chapter Text\n\nWords.\n");
    expect(messages(checkProjectContinuity(root).errors)).toEqual([
      "scenes/chapter-02-scene-01.md puts ada at keep 0.3h after scenes/chapter-01-scene-01.md at mill, but the fastest route takes 5h"
    ]);
  });

  test("rename and remove keep route targets current", () => {
    const root = routeProject();
    renameEntity(root, { kind: "location", id: "mill", name: "Old Mill" });
    expect(fs.readFileSync(path.join(root, "worldbuilding", "locations", "harbor.md"), "utf8")).toContain("to: old-mill");
    removeEntity(root, { kind: "location", id: "old-mill" });
    const harbor = fs.readFileSync(path.join(root, "worldbuilding", "locations", "harbor.md"), "utf8");
    expect(harbor).not.toContain("old-mill");
    expect(harbor).not.toContain("hours: 6");
    expect(messages(validateProject(root).errors)).toEqual([]);
  });
});

describe("routes", () => {
  test("diagram draws only the routes the travel check uses, and validate warns on duplicates (#160)", () => {
    const root = baseProject(1);
    addRoutes(root, "alpha", "- to: beta\n  hours: 2\n- to: beta\n  hours: 1.5");
    addRoutes(root, "beta", "- to: gamma\n  hours: 0\n- to: delta\n  hours: -1");
    const edges = diagramProject(root, { kind: "locations" }).text.split("\n").filter((line) => line.includes("---") || line.includes("-->"));
    expect(edges).toEqual([`  alpha ---|"1.5h"| beta`]);
    expect(messages(validateProject(root).warnings)).toContain(
      "worldbuilding/locations/alpha.md lists more than one route to beta; the travel check and story diagram use only the fastest"
    );
  });

  test("the chapter POV travels with scenes that have no POV of their own (#165)", () => {
    const root = baseProject(1);
    addRoutes(root, "alpha", "- to: beta\n  hours: 5");
    writeBaseChapter(root, 1, "pov: ann\ncharacters:\n  - ann\nlocations:\n  - alpha\n  - beta");
    writeBaseScene(root, 1, 1, "date: 2024-05-01\ntime: \"10:00\"\nlocation: alpha");
    writeBaseScene(root, 1, 2, "date: 2024-05-01\ntime: \"10:10\"\nlocation: beta\npov: ann\ncharacters:\n  - ann");
    expect(messages(continuity(root).errors)).toEqual([
      "scenes/chapter-01-scene-02.md puts ann at beta 0.1h after scenes/chapter-01-scene-01.md at alpha, but the fastest route takes 5h"
    ]);
  });

  test("decimal route legs that exactly fit the gap are not an error (#166)", () => {
    const root = baseProject(1);
    addRoutes(root, "alpha", "- to: beta\n  hours: 0.1");
    addRoutes(root, "beta", "- to: gamma\n  hours: 0.2");
    writeBaseChapter(root, 1, "characters:\n  - ann\nlocations:\n  - alpha\n  - gamma");
    writeBaseScene(root, 1, 1, "date: 2024-05-01\ntime: \"10:00\"\nlocation: alpha\ncharacters:\n  - ann");
    writeBaseScene(root, 1, 2, "date: 2024-05-01\ntime: \"10:18\"\nlocation: gamma\ncharacters:\n  - ann");
    expect(messages(continuity(root).errors)).toEqual([]);
    writeBaseScene(root, 1, 2, "date: 2024-05-01\ntime: \"10:17\"\nlocation: gamma\ncharacters:\n  - ann");
    expect(continuity(root).errors).toHaveLength(1);
  });
});

describe("review fixes", () => {
  test("routes to undeclared places never join the travel graph", () => {
    const { root } = reviewProject();
    createEntity(root, { kind: "character", name: "Mara" });
    writeMarkdown(path.join(root, "worldbuilding", "locations", "harbor.md"), "name: Harbor\ntype: town\nroutes:\n  - to: typo\n    hours: 10", "# H\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "mill.md"), "name: Mill\ntype: mill\nroutes:\n  - to: typo\n    hours: 10", "# M\n");
    for (const [scene, location, time] of [[1, "harbor", "08:00"], [2, "mill", "09:00"]]) {
      writeMarkdown(path.join(root, "scenes", `chapter-01-scene-0${scene}.md`), `title: S${scene}\nchapter: chapter-01\nscene: ${scene}\nstatus: draft\nlocation: ${location}\ndate: 2024-05-01\ntime: "${time}"\ncharacters:\n  - mara`, "# S\n");
    }
    expect(messages(checkProjectContinuity(root).errors)).toEqual([]);
  });

  test("travel checks compare every earlier sighting and read scene times at their widest", () => {
    const { root } = reviewProject();
    createEntity(root, { kind: "character", name: "Mara" });
    writeMarkdown(path.join(root, "worldbuilding", "locations", "x.md"), "name: X\ntype: town\nroutes:\n  - to: y\n    hours: 10\n  - to: z\n    hours: 30", "# X\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "y.md"), "name: Y\ntype: town", "# Y\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "z.md"), "name: Z\ntype: town", "# Z\n");
    const scene = (chapter, number, fields) => writeMarkdown(path.join(root, "scenes", `${chapter}-scene-0${number}.md`), `title: ${chapter} ${number}\nchapter: ${chapter}\nscene: ${number}\nstatus: draft\ncharacters:\n  - mara\n${fields}`, "# S\n");
    // An untimed scene between two timed ones across midnight hides nothing.
    scene("chapter-01", 1, "location: x\ndate: 2020-01-01\ntime: \"23:00\"");
    scene("chapter-01", 2, "location: x\ndate: 2020-01-02");
    scene("chapter-01", 3, "location: y\ndate: 2020-01-02\ntime: \"01:00\"");
    expect(messages(checkProjectContinuity(root).errors)).toEqual([
      "scenes/chapter-01-scene-03.md puts mara at y 2h after scenes/chapter-01-scene-01.md at x, but the fastest route takes 10h"
    ]);

    // An untimed earlier scene starts at midnight at the latest-possible reading; 25h < 30h.
    for (const number of [1, 2, 3]) {
      fs.rmSync(path.join(root, "scenes", `chapter-01-scene-0${number}.md`));
    }
    scene("chapter-01", 1, "location: x\ndate: 2020-01-01");
    scene("chapter-01", 2, "location: z\ndate: 2020-01-02\ntime: \"01:00\"");
    expect(messages(checkProjectContinuity(root).errors)).toEqual([
      "scenes/chapter-01-scene-02.md puts mara at z at most 25h after scenes/chapter-01-scene-01.md at x, but the fastest route takes 30h"
    ]);

    // Morning to afternoon can span 06:00 to 16:00, so a 9h route is possible.
    scene("chapter-01", 1, "location: x\ndate: 2020-01-01\ntime: morning");
    scene("chapter-01", 2, "location: y\ndate: 2020-01-01\ntime: afternoon");
    expect(messages(checkProjectContinuity(root).errors)).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { hoursNeeded, parseGeography } from "../src/geography.js";
import {
  checkProjectContinuity,
  createEntity,
  createStoryProject,
  removeEntity,
  renameEntity,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

const GEOGRAPHY = `distance-unit: leagues
map-scale: 4
travel-modes:
  - mode: on foot
    speed: 1
    per-day: 8
  - mode: horse
    speed: 3
    per-day: 15
  - mode: wyvern
    speed: 12`;

function pad(number) {
  return String(number).padStart(2, "0");
}

function setStoryFields(root, fields) {
  const file = path.join(root, "story.md");
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.replace("schema-version: 2\n", `schema-version: 2\n${fields}\n`));
}

function writeLocation(root, id, fields = "") {
  writeMarkdown(path.join(root, "worldbuilding", "locations", `${id}.md`), `
name: ${id}
type: town
${fields}
`, `# ${id}\n`);
}

function writeChapter(root, number, fields = "") {
  writeMarkdown(path.join(root, "chapters", `chapter-${pad(number)}.md`), `
title: C${number}
number: ${number}
status: draft
${fields}
`, "## Chapter Text\n\nSome prose here.\n");
}

function writeScene(root, chapter, scene, fields) {
  writeMarkdown(path.join(root, "scenes", `chapter-${pad(chapter)}-scene-${pad(scene)}.md`), `
title: Scene ${chapter}.${scene}
chapter: chapter-${pad(chapter)}
scene: ${scene}
status: draft
${fields}
`, "# Scene\n");
}

// greyhaven <-> stonebridge 30 leagues (listed), stonebridge at [12, 40]
// and the-barrow at [12, 52] on a map of 4 leagues a square (48 leagues),
// the-barrow <-> fenmoor 10 leagues, and an island with no geography.
function geographyProject({ geography = GEOGRAPHY, chapters = 3 } = {}) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Long Roads", force: false });
  createEntity(root, { kind: "character", name: "Mara" });
  createEntity(root, { kind: "character", name: "Ivo" });
  if (geography) {
    setStoryFields(root, geography);
  }
  writeLocation(root, "greyhaven", "distances:\n  - to: stonebridge\n    distance: 30");
  writeLocation(root, "stonebridge", "coordinates: [12, 40]");
  writeLocation(root, "the-barrow", "coordinates: [12, 52]\ndistances:\n  - to: fenmoor\n    distance: 10");
  writeLocation(root, "fenmoor");
  writeLocation(root, "island");
  for (let number = 1; number <= chapters; number += 1) {
    writeChapter(root, number);
  }
  return root;
}

function distanceWarnings(root) {
  return checkProjectContinuity(root).warnings.filter((finding) => finding.code === "travel-too-far").map((finding) => finding.message);
}

describe("geography parsing", () => {
  test("defaults to units and a scale of 1, and keeps only readable modes", () => {
    expect(parseGeography({})).toEqual({ geography: { unit: "units", scale: 1, modes: [] }, problems: [] });
    const { geography, problems } = parseGeography({
      "distance-unit": " km ",
      "map-scale": 0,
      "travel-modes": [{ mode: "Horse", speed: 8 }, { mode: "horse ", speed: 9 }, { mode: "cart", speed: -1 }, { speed: 2 }, "boat", { mode: "ship", speed: 6, "per-day": 0 }]
    });
    expect(geography.unit).toBe("km");
    expect(geography.scale).toBeNull();
    expect(geography.modes).toEqual([{ mode: "Horse", key: "horse", speed: 8, perDay: undefined }]);
    expect(problems).toEqual([
      "map-scale must be a number greater than 0, the distance one coordinate unit spans, got 0",
      "travel-modes entry 2 mode horse appears more than once",
      "travel-modes entry 3 speed must be a number greater than 0, in km an hour, got -1",
      "travel-modes entry 4 mode must be text, such as horse or \"on foot\", got nothing",
      "travel-modes entry 5 must be a mode with a speed, such as - mode: horse then speed: 8",
      "travel-modes entry 6 per-day must be a number greater than 0, in km, got 0"
    ]);
  });

  test("travel-modes must be a list", () => {
    expect(parseGeography({ "travel-modes": "horse" }).problems).toEqual(["travel-modes must be a list of entries, such as - mode: horse then speed: 8"]);
  });

  test("a per-day limit adds a whole day for each full day's distance", () => {
    const horse = { speed: 3, perDay: 15 };
    expect(hoursNeeded(12, horse, 24)).toBe(4);
    expect(hoursNeeded(15, horse, 24)).toBe(5);
    expect(hoursNeeded(30, horse, 24)).toBe(29);
    expect(hoursNeeded(31, horse, 24)).toBeCloseTo(48 + 1 / 3);
    expect(hoursNeeded(30, horse, 30)).toBe(35);
    expect(hoursNeeded(30, { speed: 3 }, 24)).toBe(10);
  });
});

describe("distance travel check", () => {
  test("a project without travel-modes gets no new findings", () => {
    const root = geographyProject({ geography: "" });
    writeScene(root, 1, 1, "pov: mara\nlocation: greyhaven");
    writeScene(root, 1, 2, "pov: mara\nlocation: stonebridge\ntravel-hours: 1\ntravel-mode: horse");
    expect(distanceWarnings(root)).toEqual([]);
    expect(messages(validateProject(root).warnings)).toContain(
      "scenes/chapter-01-scene-02.md travel-mode horse is not a travel mode (story.md lists no travel-modes), so the distance check uses the fastest one"
    );
  });

  test("travel-hours too short for a listed distance by the scene's mode warns, with the chapter", () => {
    const root = geographyProject();
    writeScene(root, 1, 1, "pov: mara\nlocation: greyhaven");
    writeScene(root, 1, 2, "pov: mara\nlocation: stonebridge\ntravel-hours: 2\ntravel-mode: Horse");
    const result = checkProjectContinuity(root);
    const finding = result.warnings.find((item) => item.code === "travel-too-far");
    expect(finding).toEqual({
      code: "travel-too-far",
      message: "scenes/chapter-01-scene-02.md gives mara 2h to travel 30 leagues from greyhaven to stonebridge, but the horse mode (3 leagues an hour and 15 leagues a day) needs at least 29h",
      file: "scenes/chapter-01-scene-02.md",
      chapter: "chapter-01"
    });
    expect(result.errors).toEqual([]);
  });

  test("enough hours, the same place, no travel-hours, or no earlier scene report nothing", () => {
    const root = geographyProject();
    writeScene(root, 1, 1, "pov: mara\nlocation: greyhaven\ntravel-hours: 1");
    writeScene(root, 1, 2, "pov: mara\nlocation: stonebridge\ntravel-hours: 29\ntravel-mode: horse");
    writeScene(root, 1, 3, "pov: mara\nlocation: stonebridge\ntravel-hours: 0.1");
    writeScene(root, 2, 1, "pov: mara\nlocation: greyhaven");
    expect(distanceWarnings(root)).toEqual([]);
  });

  test("without a travel-mode, or with an unlisted one, the fastest mode is used", () => {
    const root = geographyProject();
    writeScene(root, 1, 1, "pov: ivo\nlocation: stonebridge");
    writeScene(root, 1, 2, "pov: ivo\nlocation: the-barrow\ntravel-hours: 1");
    writeScene(root, 1, 3, "pov: ivo\nlocation: stonebridge\ntravel-hours: 3.9\ntravel-mode: griffin");
    expect(distanceWarnings(root)).toEqual([
      "scenes/chapter-01-scene-02.md gives ivo 1h to travel 48 leagues in a straight line on the map from stonebridge to the-barrow, but even the fastest travel mode, wyvern (12 leagues an hour), needs at least 4h",
      "scenes/chapter-01-scene-03.md gives ivo 3.9h to travel 48 leagues in a straight line on the map from the-barrow to stonebridge, but even the fastest travel mode, wyvern (12 leagues an hour), needs at least 4h"
    ]);
    expect(messages(validateProject(root).warnings)).toContain(
      "scenes/chapter-01-scene-03.md travel-mode griffin is not a travel mode (story.md travel-modes lists on foot, horse, wyvern), so the distance check uses the fastest one"
    );
  });

  test("a listed distance wins over the map, and a chain of distances is used last", () => {
    const root = geographyProject();
    // Listed 5 leagues, though the map puts them 48 apart.
    writeLocation(root, "stonebridge", "coordinates: [12, 40]\ndistances:\n  - to: the-barrow\n    distance: 5");
    writeScene(root, 1, 1, "pov: mara\nlocation: stonebridge");
    writeScene(root, 1, 2, "pov: mara\nlocation: the-barrow\ntravel-hours: 0.5\ntravel-mode: wyvern");
    // greyhaven -> stonebridge -> the-barrow -> fenmoor: 30 + 5 + 10.
    writeScene(root, 2, 1, "pov: ivo\nlocation: greyhaven");
    writeScene(root, 2, 2, "pov: ivo\nlocation: fenmoor\ntravel-hours: 3\ntravel-mode: wyvern");
    expect(distanceWarnings(root)).toEqual([
      "scenes/chapter-02-scene-02.md gives ivo 3h to travel 45 leagues by the listed distances from greyhaven to fenmoor, but the wyvern mode (12 leagues an hour) needs at least 3.8h"
    ]);
  });

  test("a place with no geography, or no way to it, is not judged", () => {
    const root = geographyProject();
    writeScene(root, 1, 1, "pov: mara\nlocation: greyhaven");
    writeScene(root, 1, 2, "pov: mara\nlocation: island\ntravel-hours: 0.1");
    writeScene(root, 1, 3, "pov: mara\nlocation: fenmoor\ntravel-hours: 0.1");
    // An unquoted number is read as the id it spells, which names nothing.
    writeLocation(root, "island", "distances:\n  - to: 7\n    distance: 3");
    expect(distanceWarnings(root)).toEqual([]);
  });

  test("characters who arrive together from one place get one warning; cast and chapter POV both count", () => {
    const root = geographyProject();
    writeChapter(root, 1, "pov: ivo");
    writeScene(root, 1, 1, "location: greyhaven\ncharacters: [mara]");
    writeScene(root, 1, 2, "location: stonebridge\ncharacters: [mara]\ntravel-hours: 1");
    expect(distanceWarnings(root)).toEqual([
      "scenes/chapter-01-scene-02.md gives ivo, mara 1h to travel 30 leagues from greyhaven to stonebridge, but even the fastest travel mode, wyvern (12 leagues an hour), needs at least 2.5h"
    ]);
  });

  test("characters arriving from different places get a warning each, by origin", () => {
    const root = geographyProject();
    writeScene(root, 1, 1, "pov: mara\nlocation: the-barrow");
    writeScene(root, 1, 2, "pov: ivo\nlocation: greyhaven");
    writeScene(root, 1, 3, "location: stonebridge\ncharacters: [mara, ivo]\ntravel-hours: 1");
    expect(distanceWarnings(root)).toEqual([
      "scenes/chapter-01-scene-03.md gives ivo 1h to travel 30 leagues from greyhaven to stonebridge, but even the fastest travel mode, wyvern (12 leagues an hour), needs at least 2.5h",
      "scenes/chapter-01-scene-03.md gives mara 1h to travel 48 leagues in a straight line on the map from the-barrow to stonebridge, but even the fastest travel mode, wyvern (12 leagues an hour), needs at least 4h"
    ]);
  });

  test("flashbacks are skipped, and a scene with no location or a chapter with no scenes resets whereabouts", () => {
    const root = geographyProject({ chapters: 4 });
    writeScene(root, 1, 1, "pov: mara\nlocation: greyhaven");
    writeScene(root, 1, 2, "pov: mara\nlocation: the-barrow\nflashback-to: her childhood");
    writeScene(root, 1, 3, "pov: mara\nlocation: greyhaven\ntravel-hours: 0.1");
    writeScene(root, 2, 1, "pov: mara\nlocation: stonebridge\ntravel-hours: 30");
    writeScene(root, 2, 2, "pov: mara");
    writeScene(root, 2, 3, "pov: mara\nlocation: greyhaven\ntravel-hours: 0.1");
    // Chapter 3 has no scene records, so chapter 4 starts afresh.
    writeScene(root, 4, 1, "pov: mara\nlocation: stonebridge\ntravel-hours: 0.1");
    expect(distanceWarnings(root)).toEqual([]);
  });

  test("each strand keeps its own whereabouts", () => {
    const root = geographyProject();
    writeChapter(root, 1, "strand: \"1990\"");
    writeChapter(root, 2, "strand: \"2020\"");
    writeChapter(root, 3, "strand: \"1990\"");
    writeScene(root, 1, 1, "pov: mara\nlocation: greyhaven");
    writeScene(root, 2, 1, "pov: mara\nlocation: stonebridge\ntravel-hours: 0.1");
    writeScene(root, 3, 1, "pov: mara\nlocation: stonebridge\ntravel-hours: 1");
    expect(distanceWarnings(root)).toEqual([
      "scenes/chapter-03-scene-01.md gives mara 1h to travel 30 leagues from greyhaven to stonebridge, but even the fastest travel mode, wyvern (12 leagues an hour), needs at least 2.5h"
    ]);
  });

  test("dated scenes are checked as well as undated ones, and a calendar's day sets per-day days", () => {
    const root = geographyProject();
    setStoryFields(root, "calendar:\n  - month: Thaw\n    days: 30\n  - hours-per-day: 30");
    writeScene(root, 1, 1, "pov: mara\nlocation: greyhaven\ndate: 1 Thaw 1\ntime: \"08:00\"");
    writeScene(root, 1, 2, "pov: mara\nlocation: stonebridge\ndate: 3 Thaw 1\ntime: \"08:00\"\ntravel-hours: 34\ntravel-mode: horse");
    expect(distanceWarnings(root)).toEqual([
      "scenes/chapter-01-scene-02.md gives mara 34h to travel 30 leagues from greyhaven to stonebridge, but the horse mode (3 leagues an hour and 15 leagues a day) needs at least 35h"
    ]);
    expect(messages(checkProjectContinuity(root).errors)).toEqual([]);
  });

  test("an exemption dismisses a travel-too-far warning", () => {
    const root = geographyProject();
    writeScene(root, 1, 1, "pov: mara\nlocation: greyhaven");
    writeScene(root, 1, 2, "pov: mara\nlocation: stonebridge\ntravel-hours: 1");
    writeMarkdown(path.join(root, "continuity", "exemptions.md"), `
type: exemption-log
exemptions:
  - code: travel-too-far
    chapter: chapter-01
    reason: Mara steps through the old gate.
`, "# Exemptions\n");
    const result = checkProjectContinuity(root);
    expect(distanceWarnings(root)).toEqual([]);
    expect(result.dismissed.map((item) => item.finding.code)).toEqual(["travel-too-far"]);
  });
});

describe("geography validation", () => {
  test("validate reports bad story.md geography, coordinates, distances, and travel-mode", () => {
    const root = geographyProject({ geography: "map-scale: -2\ntravel-modes:\n  - mode: horse\n    speed: fast" });
    writeLocation(root, "greyhaven", "coordinates: [1, 2, 3]\ndistances:\n  - to: stonebridge\n    distance: 0\n  - to: stonebridge\n    distance: 4\n  - distance: 2");
    writeLocation(root, "fenmoor", "coordinates: [1, north]");
    writeScene(root, 1, 1, "pov: mara\nlocation: greyhaven\ntravel-mode: 4");
    const { errors, warnings } = validateProject(root);
    expect(errors.filter((finding) => finding.code !== "missing-required-path").map((finding) => `${finding.code}: ${finding.message}`)).toEqual([
      "invalid-geography: story.md map-scale must be a number greater than 0, the distance one coordinate unit spans, got -2",
      "invalid-geography: story.md travel-modes entry 1 speed must be a number greater than 0, in units an hour, got fast",
      "invalid-coordinates: worldbuilding/locations/fenmoor.md coordinates must be two numbers, the place on the story's map, such as [12, 40]",
      "invalid-coordinates: worldbuilding/locations/greyhaven.md coordinates must be two numbers, the place on the story's map, such as [12, 40]",
      "invalid-distance: worldbuilding/locations/greyhaven.md distance to stonebridge must be a positive number",
      "missing-field: worldbuilding/locations/greyhaven.md distance is missing to",
      "field-not-text: scenes/chapter-01-scene-01.md frontmatter field travel-mode must be text: quote it as travel-mode: \"4\""
    ]);
    expect(messages(warnings)).toContain("worldbuilding/locations/greyhaven.md lists more than one distance to stonebridge; the distance check uses only the shortest");
  });

  test("an empty travel-mode is no mode, and a list is not a single value", () => {
    const root = geographyProject();
    writeScene(root, 1, 1, "pov: mara\nlocation: greyhaven\ntravel-mode: \"\"");
    writeScene(root, 1, 2, "pov: mara\nlocation: stonebridge\ntravel-mode: [horse]");
    const { errors, warnings } = validateProject(root);
    expect(messages(errors)).toContain("scenes/chapter-01-scene-02.md frontmatter field travel-mode must be a scalar");
    expect(warnings.filter((finding) => finding.code === "unknown-travel-mode")).toEqual([]);
  });

  test("an invalid map-scale turns the map off rather than guess", () => {
    const root = geographyProject({ geography: `${GEOGRAPHY.replace("map-scale: 4", "map-scale: none")}` });
    writeScene(root, 1, 1, "pov: ivo\nlocation: stonebridge");
    writeScene(root, 1, 2, "pov: ivo\nlocation: the-barrow\ntravel-hours: 0.1");
    expect(distanceWarnings(root)).toEqual([]);
  });

  test("links checks distance targets, and rename and remove keep them current", () => {
    const root = geographyProject();
    writeLocation(root, "fenmoor", "distances:\n  - to: fenmoor\n    distance: 1\n  - to: nowhere\n    distance: 2");
    const links = messages(validateLinks(root).errors);
    expect(links).toContain("worldbuilding/locations/fenmoor.md distance points at itself");
    expect(links.some((message) => message.startsWith("worldbuilding/locations/fenmoor.md distance") && message.includes("nowhere"))).toBe(true);
    writeLocation(root, "fenmoor");

    renameEntity(root, { kind: "location", id: "stonebridge", name: "Stone Bridge" });
    expect(fs.readFileSync(path.join(root, "worldbuilding", "locations", "greyhaven.md"), "utf8")).toContain("to: stone-bridge");
    removeEntity(root, { kind: "location", id: "stone-bridge" });
    const greyhaven = fs.readFileSync(path.join(root, "worldbuilding", "locations", "greyhaven.md"), "utf8");
    expect(greyhaven).not.toContain("stone-bridge");
    expect(greyhaven).not.toContain("distance: 30");
    expect(messages(validateProject(root).errors).filter((message) => !message.startsWith("Missing required path"))).toEqual([]);
  });
});

describe("story add geography flags", () => {
  test("add location --coordinates and add scene --travel-mode write the fields", () => {
    const root = geographyProject();
    const io = memoryIo(root);
    expect(runCli(["add", "location", "Hollow Oak", "--coordinates", "3.5, -2"], io)).toBe(0);
    expect(fs.readFileSync(path.join(root, "worldbuilding", "locations", "hollow-oak.md"), "utf8")).toContain("coordinates:\n  - 3.5\n  - -2\n");
    expect(runCli(["add", "scene", "Ride", "--chapter", "chapter-01", "--travel-hours", "3", "--travel-mode", "horse"], io)).toBe(0);
    const scene = fs.readFileSync(path.join(root, "scenes", "chapter-01-scene-01.md"), "utf8");
    expect(scene).toContain("travel-mode: horse\n");
    expect(scene).toContain("travel-hours: 3\n");
    expect(messages(validateProject(root).errors).filter((message) => !message.startsWith("Missing required path"))).toEqual([]);
  });

  test("add location refuses coordinates that are not two numbers", () => {
    const root = geographyProject();
    for (const value of ["3", "3,4,5", "north,4", "3,"]) {
      const io = memoryIo(root);
      expect(runCli(["add", "location", "Far Point", "--coordinates", value], io)).toBe(2);
      expect(io.error()).toContain(`coordinates must be two numbers separated by a comma, such as 12,40, got ${value}`);
    }
    expect(fs.existsSync(path.join(root, "worldbuilding", "locations", "far-point.md"))).toBe(false);
  });
});

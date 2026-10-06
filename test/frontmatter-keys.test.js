import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { FRONTMATTER_KEYS, nearMissKeys } from "../src/frontmatter-keys.js";
import { validateProject } from "../src/story.js";
import { makeTempDir, messages } from "./helpers.js";

const repoRoot = path.join(import.meta.dir, "..");

function exampleCopy() {
  const root = path.join(makeTempDir(), "book");
  fs.cpSync(path.join(repoRoot, "examples", "the-unraveled-thread"), root, { recursive: true });
  return root;
}

function edit(root, file, from, to) {
  const target = path.join(root, file);
  const text = fs.readFileSync(target, "utf8");
  expect(text).toMatch(from);
  fs.writeFileSync(target, text.replace(from, to), "utf8");
}

function nearMisses(root) {
  return messages(validateProject(root).warnings.filter((warning) => warning.code === "near-miss-key"));
}

describe("misspelled frontmatter keys (#373)", () => {
  test("the known keys match schemas/story.schema.json", () => {
    const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas", "story.schema.json"), "utf8"));
    const fromSchema = { story: Object.keys(schema.properties.story.properties) };
    for (const kind of Object.keys(FRONTMATTER_KEYS).filter((name) => name !== "story")) {
      fromSchema[kind] = Object.keys(schema.$defs[kind].properties);
    }
    expect(FRONTMATTER_KEYS).toEqual(fromSchema);
  });

  test("nearMissKeys matches case, separators, hyphens, and small typos", () => {
    const chapter = FRONTMATTER_KEYS.chapter;
    expect(nearMissKeys("arcs_advanced", chapter)).toEqual(["arcs-advanced"]);
    expect(nearMissKeys("Arcs-Advanced", chapter)).toEqual(["arcs-advanced"]);
    expect(nearMissKeys("arcsadvanced", chapter)).toEqual(["arcs-advanced"]);
    expect(nearMissKeys("arcs-advaced", chapter)).toEqual(["arcs-advanced"]);
    expect(nearMissKeys("stauts", chapter)).toEqual(["status"]);
    expect(nearMissKeys("statsu", chapter)).toEqual(["status"]);
    expect(nearMissKeys("tilte", chapter)).toEqual(["title"]);
    expect(nearMissKeys("hoook", chapter)).toEqual(["hook"]);
    expect(nearMissKeys("charaters", chapter)).toEqual(["characters"]);
    expect(nearMissKeys("wordcount", chapter)).toEqual(["word-count"]);
    expect(nearMissKeys("since_chapter", FRONTMATTER_KEYS.objectState)).toEqual(["since"]);
    expect(nearMissKeys("died-in-chapter", FRONTMATTER_KEYS.character)).toEqual(["died-in"]);
  });

  test("nearMissKeys leaves known, short, distant, and other-kind keys alone", () => {
    const chapter = FRONTMATTER_KEYS.chapter;
    for (const key of [
      "status", "arcs-advanced",
      // short custom fields and short known keys
      "age", "po", "povs",
      // custom fields far from every known key
      "mood", "notes", "summary", "beats", "theme", "sex",
      // keys another kind defines
      "location", "arcs", "scene", "setting", "tags", "type", "themes"
    ]) {
      expect({ key, intended: nearMissKeys(key, chapter) }).toEqual({ key, intended: [] });
    }
    expect(nearMissKeys("Location", chapter)).toEqual([]);
    expect(nearMissKeys("locaton", FRONTMATTER_KEYS.scene)).toEqual(["location"]);
    // Two edits count only when the first letter matches: notes is not routes.
    expect(nearMissKeys("notes", FRONTMATTER_KEYS.location)).toEqual([]);
    expect(nearMissKeys("ruotse", FRONTMATTER_KEYS.location)).toEqual(["routes"]);
    // A key only continuity state entries define is still a near miss on a file.
    expect(nearMissKeys("character", chapter)).toEqual(["characters"]);
    // A key far longer than every known one is never compared in full.
    expect(nearMissKeys("x".repeat(100000), chapter)).toEqual([]);
  });

  test("equally close keys are all suggested, leaving out those already set", () => {
    expect(nearMissKeys("numberd", FRONTMATTER_KEYS.chapter)).toEqual(["number", "numbered"]);
    const root = exampleCopy();
    edit(root, "chapters/chapter-01.md", /^status:/m, "numberd: false\nstatus:");
    expect(nearMisses(root)).toEqual(["chapters/chapter-01.md has numberd; did you mean numbered?"]);
  });

  test("story validate warns about a misspelled key in any kind of file", () => {
    const root = exampleCopy();
    edit(root, "chapters/chapter-01.md", /^arcs-advanced:/m, "arcs_advanced:");
    edit(root, "chapters/chapter-02.md", /^status:/m, "stauts:");
    edit(root, "story.md", /^tense:/m, "tence:");
    edit(root, "characters/nessa-thorn.md", /^name:/m, "Name:");
    edit(root, "worldbuilding/locations/the-mill-row.md", /^region:/m, "regoin:");
    // Custom fields stay quiet.
    edit(root, "chapters/chapter-03.md", /^status:/m, "mood: tense\nage: 3\nlocation: the-mill-row\nstatus:");

    expect(nearMisses(root)).toEqual([
      "story.md has tence; did you mean tense?",
      "characters/nessa-thorn.md has Name; did you mean name?",
      "worldbuilding/locations/the-mill-row.md has regoin; did you mean region?",
      "chapters/chapter-01.md has arcs_advanced; did you mean arcs-advanced?",
      "chapters/chapter-02.md has stauts; did you mean status?"
    ]);
    expect(validateProject(root).warnings.find((warning) => warning.code === "near-miss-key")).toMatchObject({ code: "near-miss-key", file: "story.md" });
  });

  test("a near miss is quiet when the intended key is also set", () => {
    const root = exampleCopy();
    edit(root, "chapters/chapter-01.md", /^status:/m, "Status: draft\nstatus:");
    expect(nearMisses(root)).toEqual([]);
  });
});

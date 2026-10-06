import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { FRONTMATTER_KEYS, nearMissKey } from "../src/frontmatter-keys.js";
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

  test("nearMissKey matches case, separators, hyphens, and small typos", () => {
    const chapter = FRONTMATTER_KEYS.chapter;
    expect(nearMissKey("arcs_advanced", chapter)).toBe("arcs-advanced");
    expect(nearMissKey("Arcs-Advanced", chapter)).toBe("arcs-advanced");
    expect(nearMissKey("arcsadvanced", chapter)).toBe("arcs-advanced");
    expect(nearMissKey("arcs-advaced", chapter)).toBe("arcs-advanced");
    expect(nearMissKey("stauts", chapter)).toBe("status");
    expect(nearMissKey("statsu", chapter)).toBe("status");
    expect(nearMissKey("tilte", chapter)).toBe("title");
    expect(nearMissKey("hoook", chapter)).toBe("hook");
    expect(nearMissKey("charaters", chapter)).toBe("characters");
    expect(nearMissKey("wordcount", chapter)).toBe("word-count");
    expect(nearMissKey("since_chapter", FRONTMATTER_KEYS.objectState)).toBe("since");
    expect(nearMissKey("died-in-chapter", FRONTMATTER_KEYS.character)).toBe("died-in");
  });

  test("nearMissKey leaves known, short, distant, and other-kind keys alone", () => {
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
      expect({ key, intended: nearMissKey(key, chapter) }).toEqual({ key, intended: undefined });
    }
    expect(nearMissKey("Location", chapter)).toBeUndefined();
    expect(nearMissKey("locaton", FRONTMATTER_KEYS.scene)).toBe("location");
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

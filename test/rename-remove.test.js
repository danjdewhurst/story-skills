import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createEntity, createStoryProject, removeEntity, renameEntity } from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

function project(title) {
  return createStoryProject({ cwd: makeTempDir(), title, force: false }).root;
}

function read(root, ...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

function snapshot(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files[path.relative(root, full)] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(root);
  return files;
}

describe("rename and remove reference rewriting", () => {
  test("rename rejects names that produce an empty id (findings 0, 12)", () => {
    const root = project("Empty Id");
    createEntity(root, { kind: "character", name: "Lord Maren" });
    createEntity(root, { kind: "artifact", name: "Crown", owner: "lord-maren" });
    const before = snapshot(root);

    expect(() => renameEntity(root, { kind: "character", id: "lord-maren", name: "???" })).toThrow("Cannot derive a kebab-case id");

    expect(snapshot(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, "characters", ".md"))).toBe(false);
  });

  test("scene rename keeps the {chapter}-scene-NN id and only updates the title (finding 3)", () => {
    const root = project("Scene Rename");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "scene", name: "Beat", chapter: "chapter-01", scene: 1 });

    const renamed = renameEntity(root, { kind: "scene", id: "chapter-01-scene-01", name: "The Arrival" });

    expect(renamed.id).toBe("chapter-01-scene-01");
    expect(fs.existsSync(path.join(root, "scenes", "the-arrival.md"))).toBe(false);
    expect(read(root, "scenes", "chapter-01-scene-01.md")).toContain("title: The Arrival");
  });

  test("remove only clears fields that point at the removed kind (findings 1, 8)", () => {
    const root = project("Kind Remove");
    createEntity(root, { kind: "faction", name: "Marens Guard" });
    createEntity(root, { kind: "artifact", name: "Guard Seal", owner: "marens-guard" });
    createEntity(root, { kind: "location", name: "Marens Guard" });
    createEntity(root, { kind: "location", name: "Ashen Citadel" });
    createEntity(root, { kind: "character", name: "Lord Maren", location: "ashen-citadel" });
    createEntity(root, { kind: "term", name: "Ashen Citadel" });

    removeEntity(root, { kind: "location", id: "marens-guard" });
    expect(read(root, "worldbuilding", "artifacts", "guard-seal.md")).toContain("owner: marens-guard");

    removeEntity(root, { kind: "term", id: "ashen-citadel" });
    expect(read(root, "characters", "lord-maren.md")).toContain("locations:\n  - ashen-citadel");
  });

  test("rename rewrites fields and body links only for the renamed kind (findings 1, 8)", () => {
    const root = project("Kind Rename");
    createEntity(root, { kind: "faction", name: "Marens Guard" });
    createEntity(root, { kind: "location", name: "Marens Guard" });
    createEntity(root, { kind: "artifact", name: "Guard Seal", owner: "marens-guard", location: "marens-guard" });
    const sealPath = path.join(root, "worldbuilding", "artifacts", "guard-seal.md");
    fs.appendFileSync(sealPath, "[marens-guard](../factions/marens-guard.md) and [marens-guard](../locations/marens-guard.md)\n", "utf8");

    renameEntity(root, { kind: "location", id: "marens-guard", name: "Guard Keep" });

    const seal = fs.readFileSync(sealPath, "utf8");
    expect(seal).toContain("owner: marens-guard");
    expect(seal).toContain("location: guard-keep");
    expect(seal).toContain("[marens-guard](../factions/marens-guard.md) and [guard-keep](../locations/guard-keep.md)");
  });

  test("owner references are left alone when a character and faction share the id", () => {
    const root = project("Ambiguous Owner");
    createEntity(root, { kind: "faction", name: "Vale" });
    createEntity(root, { kind: "character", name: "Vale" });
    createEntity(root, { kind: "artifact", name: "Ring", owner: "vale" });

    renameEntity(root, { kind: "character", id: "vale", name: "Vale Two" });

    expect(read(root, "worldbuilding", "artifacts", "ring.md")).toContain("owner: vale");
  });

  test("remove clears nested fields but keeps continuity entries unless the entry is about the removed entity (findings 2, 7)", () => {
    const root = project("Nested Remove");
    createEntity(root, { kind: "location", name: "Port" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "character", name: "Ilya" });
    createEntity(root, { kind: "artifact", name: "Lantern" });
    writeMarkdown(path.join(root, "continuity", "state.md"), `
type: continuity-state
character-state:
  - character: mara
    location: port
    physical: wounded shoulder
  - character: ilya
    location: port
    physical: unharmed
object-state:
  - artifact: lantern
    owner: mara
    location: port
    status: hidden
knowledge-state:
  - character: mara
    knows: the archive was active
    learned-in: chapter-01
`, "# Continuity State\n");

    removeEntity(root, { kind: "location", id: "port" });
    let state = read(root, "continuity", "state.md");
    expect(state).toContain("  - character: mara\n    location: \"\"\n    physical: wounded shoulder");
    expect(state).toContain("  - artifact: lantern\n    owner: mara\n    location: \"\"");

    removeEntity(root, { kind: "chapter", id: "chapter-01" });
    state = read(root, "continuity", "state.md");
    expect(state).toContain("knows: the archive was active");

    removeEntity(root, { kind: "character", id: "mara" });
    state = read(root, "continuity", "state.md");
    expect(state).not.toContain("character: mara");
    expect(state).not.toContain("wounded shoulder");
    expect(state).toContain("character: ilya");
    expect(state).toContain("  - artifact: lantern\n    owner: \"\"");
    expect(state).toContain("knowledge-state: []");

    removeEntity(root, { kind: "artifact", id: "lantern" });
    expect(read(root, "continuity", "state.md")).toContain("object-state: []");
  });

  test("rename and remove leave the project untouched when a markdown file cannot be parsed (finding 10)", () => {
    const root = project("Parse Abort");
    createEntity(root, { kind: "character", name: "Lord Maren" });
    createEntity(root, { kind: "location", name: "Citadel", character: "lord-maren" });
    createEntity(root, { kind: "artifact", name: "Crown", owner: "lord-maren" });
    fs.mkdirSync(path.join(root, "notes"));
    fs.writeFileSync(path.join(root, "notes", "aaa.md"), "---\nmeta:\n  nested: yes\n---\n", "utf8");
    const before = snapshot(root);

    expect(() => renameEntity(root, { kind: "character", id: "lord-maren", name: "Maren Two" })).toThrow("nothing was changed");
    expect(snapshot(root)).toEqual(before);

    expect(() => removeEntity(root, { kind: "character", id: "lord-maren" })).toThrow("nothing was changed");
    expect(snapshot(root)).toEqual(before);
  });

  test("rename rewrites links in markdown files without frontmatter (finding 14)", () => {
    const root = project("No Frontmatter Links");
    createEntity(root, { kind: "character", name: "Lord Maren" });
    fs.mkdirSync(path.join(root, "notes"));
    const planPath = path.join(root, "notes", "plan.md");
    fs.writeFileSync(planPath, "# Plan\n\nSee [Maren](../characters/lord-maren.md) and [lord-maren](/characters/lord-maren.md#bio).\n[web](https://example.com/lord-maren.md) [top](#lord-maren) [bad](%E0%A4%A.md)\n", "utf8");

    renameEntity(root, { kind: "character", id: "lord-maren", name: "Maren Two" });

    expect(fs.readFileSync(planPath, "utf8")).toBe("# Plan\n\nSee [Maren](../characters/maren-two.md) and [maren-two](/characters/maren-two.md#bio).\n[web](https://example.com/lord-maren.md) [top](#lord-maren) [bad](%E0%A4%A.md)\n");
  });
});

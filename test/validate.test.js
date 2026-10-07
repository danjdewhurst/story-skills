import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkProjectSchema } from "../scripts/check-schema.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { createEntity, createStoryProject, validateLinks, validateProject } from "../src/story.js";
import { makeTempDir, messages, writeMarkdown } from "./helpers.js";

function newProject(title = "Gull") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(repoRoot, "examples");

function bugsProject(title = "Bugs") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function copyExample(name) {
  const target = path.join(makeTempDir(), name);
  fs.cpSync(path.join(examplesRoot, name), target, { recursive: true });
  return target;
}

function editFile(file, edit) {
  fs.writeFileSync(file, edit(fs.readFileSync(file, "utf8")), "utf8");
}

function analysisProject(title = "Analysis", cwd = makeTempDir()) {
  return createStoryProject({ cwd, title }).root;
}

describe("#112 scheduled chapters in arc bodies", () => {
  test("a planned plot point may name a chapter not yet written", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const arc = createEntity(root, { kind: "arc", name: "Main", type: "main" });
    fs.appendFileSync(arc.file, "\n| 1 | Harry sees the lights | act-3 | chapter-09 | planned | |\n");
    expect(messages(validateLinks(root).errors)).toEqual([]);
    fs.appendFileSync(arc.file, "\nA typo: chapter-1 and chapter-00.\n");
    expect(messages(validateLinks(root).errors)).toEqual([
      "plot/arcs/main.md references missing chapter chapter-1",
      "plot/arcs/main.md references missing chapter chapter-00"
    ]);
  });

  test("the timeline still needs chapters that exist", () => {
    const root = newProject();
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), "\n- chapter-09: the lights\n");
    expect(messages(validateLinks(root).errors)).toEqual(["plot/timeline.md references missing chapter chapter-09"]);
  });
});

describe("#128 missing registry link warning names the file", () => {
  test("the warning names the unlisted file and the fix", () => {
    const root = bugsProject();
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "\n## Chapter Text\n\nShe climbed.\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "harbor.md"), "name: Harbor\ntype: city\nstatus: active", "# Harbor\n");
    const warnings = messages(validateProject(root).warnings);
    expect(warnings).toContain("chapters/_index.md does not list chapters/chapter-01.md; run story reindex");
    expect(warnings).toContain("worldbuilding/_index.md does not list worldbuilding/locations/harbor.md; run story reindex");
  });
});

describe("#132 validate rejects non-string text fields", () => {
  test("a numeric title or name is an error that says to quote it", () => {
    const root = copyExample("the-last-ember");
    editFile(path.join(root, "chapters", "chapter-01.md"), (text) => text.replace(/^title: .*$/m, "title: 1984"));
    editFile(path.join(root, "characters", "kael-voss.md"), (text) => text.replace(/^name: .*$/m, "name: 7"));
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain('chapters/chapter-01.md frontmatter field title must be text: quote it as title: "1984"');
    expect(errors).toContain('characters/kael-voss.md frontmatter field name must be text: quote it as name: "7"');
  });

  test("the quote hint spells the value as the file does", () => {
    const root = copyExample("the-last-ember");
    editFile(path.join(root, "chapters", "chapter-01.md"), (text) => text.replace(/^title: .*$/m, "title: True # draft"));
    editFile(path.join(root, "characters", "kael-voss.md"), (text) => text.replace(/^name: .*$/m, "name: 007"));
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain('chapters/chapter-01.md frontmatter field title must be text: quote it as title: "True"');
    expect(errors).toContain('characters/kael-voss.md frontmatter field name must be text: quote it as name: "007"');
  });

  test("validate fails wherever the schema rejects a number in a text field", () => {
    const root = copyExample("the-last-ember");
    const files = ["story.md", "chapters/chapter-01.md", "characters/kael-voss.md", "worldbuilding/locations/ashen-citadel.md", "glossary/terms/ember-sight.md"]
      .filter((file) => fs.existsSync(path.join(root, file)));
    const mismatches = [];
    for (const file of files) {
      const fullPath = path.join(root, file);
      const original = fs.readFileSync(fullPath, "utf8");
      const keys = Object.entries(parseFrontmatter(original).data)
        .filter(([, value]) => typeof value === "string")
        .map(([key]) => key);
      for (const key of keys) {
        fs.writeFileSync(fullPath, original.replace(new RegExp(`^${key}: .*$`, "m"), `${key}: 7`), "utf8");
        const schemaRejects = checkProjectSchema(root).some((error) => error.includes("expected string, got integer"));
        if (schemaRejects && validateProject(root).ok) {
          mismatches.push(`${file} ${key}`);
        }
      }
      fs.writeFileSync(fullPath, original, "utf8");
    }
    expect(mismatches).toEqual([]);
  });

  test("a numeric population is allowed by both", () => {
    const root = copyExample("the-last-ember");
    editFile(path.join(root, "worldbuilding", "locations", "ashen-citadel.md"), (text) => text.replace(/^population: .*$/m, "population: 12000"));
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(checkProjectSchema(root)).toEqual([]);
  });
});

describe("rounding and plurals elsewhere (#216)", () => {
  test("validate says a chapter has no word-count instead of declaring 0", () => {
    const root = analysisProject();
    fs.writeFileSync(path.join(root, "chapters", "chapter-01.md"), "---\ntitle: One\nnumber: 1\nstatus: draft\n---\n## Chapter Text\n\nOne two three.\n", "utf8");
    expect(messages(validateProject(root).warnings)).toContain("chapters/chapter-01.md has no word-count (contains 3)");
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createEntity, createStoryProject, projectActions, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

function newProject(title = "Gull") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function actionLines(root, options) {
  return projectActions(root, options).actions.map((item) => `[${item.priority}] ${item.title}: ${item.detail}`).join("\n");
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function project(title = "Open Issues") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title, force: false });
  return { cwd, root };
}

function writeChapter(root, number, body, extra = "status: draft") {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Chapter ${number}\nnumber: ${number}\n${extra}`, `## Chapter Text\n\n${body}\n`);
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("#109 discovered chapters", () => {
  function reconcile(root) {
    return actionLines(root).split("\n").find((line) => line.includes("Reconcile discovered chapters")) ?? "";
  }

  test("post-hoc notes below ## Chapter Text do not count", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "Relief", number: 1, mode: "discovered" });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.appendFileSync(chapter, "\nShe climbed.\n\n## Chapter Notes (post-hoc)\n\n- TODO: add Harry Rowe file.\n");
    expect(reconcile(root)).toContain("chapter-01");
    const text = fs.readFileSync(chapter, "utf8").replace("\n## Chapter Notes (post-hoc)\n\n- TODO: add Harry Rowe file.\n", "");
    fs.writeFileSync(chapter, text.replace("## Chapter Text", "## Chapter Notes (post-hoc)\n\n- Reconciled.\n\n## Chapter Text"));
    expect(reconcile(root)).toBe("");
  });

  test("a draft-mode: discovered project flags drafted chapters with no mode", () => {
    const root = newProject();
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^status: /m, "draft-mode: discovered\nstatus: "));
    createEntity(root, { kind: "chapter", name: "Planned", number: 1 });
    expect(reconcile(root)).toBe("");
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    fs.appendFileSync(path.join(root, "chapters", "chapter-02.md"), "\nA boy waved.\n");
    expect(reconcile(root)).toContain("for chapter-02.");
  });

  test("mode and draft-mode are enums", () => {
    const root = newProject();
    expect(() => createEntity(root, { kind: "chapter", name: "Three", number: 3, mode: "pantsed" })).toThrow('Unsupported chapter mode "pantsed"');
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace(/^mode: .*$/m, "mode: discoverd"));
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^status: /m, "draft-mode: pantsed\nstatus: "));
    const errors = messages(validateProject(root).errors);
    expect(errors).toContain("chapters/chapter-01.md frontmatter field mode has unsupported value discoverd");
    expect(errors).toContain("story.md frontmatter field draft-mode has unsupported value pantsed");
  });
});

describe("#111 validation warnings in next", () => {
  test("validate warnings get an action instead of the healthy fallback", () => {
    const root = newProject();
    createEntity(root, { kind: "matter", name: "Dedication" });
    const lines = actionLines(root);
    expect(lines).toContain("[P1] Review validation warnings: Run story validate . and review 1 warning.");
    expect(lines).not.toContain("mechanically healthy");
  });

  test("stale word counts and missing scenes keep their own actions only", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), "\nShe climbed the steps.\n");
    const lines = actionLines(root);
    expect(lines).toContain("Refresh word counts");
    expect(lines).toContain("Add scene records");
    expect(lines).not.toContain("Review validation warnings");
  });

  test("a chapter declaring one word, or none, is a word-count action only", () => {
    for (const edit of [(text) => text.replace(/^word-count: .*\n/m, ""), (text) => text.replace(/^word-count: .*$/m, "word-count: 1")]) {
      const root = newProject();
      createEntity(root, { kind: "chapter", name: "One", number: 1 });
      const chapter = path.join(root, "chapters", "chapter-01.md");
      fs.writeFileSync(chapter, `${edit(fs.readFileSync(chapter, "utf8"))}\nShe climbed the steps.\n`);
      expect(messages(validateProject(root).warnings).some((warning) => /has no word-count|declares 1 word but/.test(warning))).toBe(true);
      const lines = actionLines(root);
      expect(lines).toContain("Refresh word counts");
      expect(lines).not.toContain("Review validation warnings");
    }
  });
});

describe("#77 next drafts an empty outlined chapter before adding one", () => {
  test("suggests the first chapter with no prose", () => {
    const { cwd, root } = project("Fresh Book");
    createEntity(root, { kind: "chapter", name: "Chapter 1", number: 1 });
    const result = invoke(cwd, ["next", root]);
    expect(result.out).toContain("[P2] Draft chapter 1: chapters/chapter-01.md has no prose yet (status outline)");
    expect(result.out).not.toContain("Draft chapter 2");
  });

  test("suggests a new chapter once every chapter has prose", () => {
    const { cwd, root } = project();
    writeChapter(root, 1, "Some drafted words here.");
    const text = invoke(cwd, ["next", root]).out;
    expect(text).toContain("Draft chapter 2");
    expect(text).toContain("story add chapter");
  });
});

describe("reports and views", () => {
  test("next suggests commands for the path the user typed", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    // A chapter number gap is a continuity warning.
    createEntity(root, { kind: "chapter", name: "Three", number: 3 });
    const cwd = path.dirname(root);
    const result = invoke(cwd, ["next", path.basename(root)]);
    expect(result.out).toContain(`Run story continuity ${path.basename(root)} and`);
    expect(invoke(root, ["next"]).out).toContain("Run story continuity . and");
  });
});

describe("sweep fixes", () => {
  test("next stops suggesting chapters for a finished book and sorts by priority", () => {
    const root = sweepProject();
    createEntity(root, { kind: "character", name: "Mara" });
    createEntity(root, { kind: "arc", name: "Main", status: "resolved" });
    const actions = projectActions(root).actions;
    expect(actions.map((item) => item.title).join("\n")).not.toContain("Draft chapter");
    const priorities = actions.map((item) => item.priority);
    expect(priorities).toEqual([...priorities].sort());
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/status: \w+/, "status: complete"));
    fs.rmSync(path.join(root, "plot", "arcs", "main.md"));
    expect(projectActions(root).actions.map((item) => item.title).join("\n")).not.toContain("Draft chapter");
  });

  test("next asks for post-hoc notes on discovered chapters", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1, mode: "discovered" });
    const titles = () => projectActions(root).actions.map((item) => `${item.title}: ${item.detail}`).join("\n");
    expect(titles()).toContain("Reconcile discovered chapters: Run the discovery-drafting reconcile loop and add ## Chapter Notes (post-hoc) for chapter-01.");
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("## Chapter Text", "## Chapter Notes (post-hoc)\n\nFound the harbour.\n\n## Chapter Text"));
    expect(titles()).not.toContain("Reconcile discovered chapters");
  });
});

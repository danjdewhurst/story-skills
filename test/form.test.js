import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { formRangeWarning } from "../src/forms.js";
import { createStoryProject, formatProjectReport, projectReport, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function editStory(root, from, to) {
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(from, to), "utf8");
}

describe("story form", () => {
  test("init --form records the form and a default target", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Short One", form: "short-story" });
    const raw = fs.readFileSync(path.join(root, "story.md"), "utf8");
    expect(raw).toContain("form: short-story\ntarget-words: 5000\n");
    expect(validateProject(root)).toMatchObject({ ok: true, warnings: [] });
    expect(formatProjectReport(projectReport(root))).toContain("Form: short-story");

    const serial = createStoryProject({ cwd, title: "Serial One", form: "serial" });
    const serialRaw = fs.readFileSync(path.join(serial.root, "story.md"), "utf8");
    expect(serialRaw).toContain("form: serial\n");
    expect(serialRaw).not.toContain("target-words");

    const plain = createStoryProject({ cwd, title: "Plain One" });
    expect(fs.readFileSync(path.join(plain.root, "story.md"), "utf8")).not.toContain("form:");
    expect(formatProjectReport(projectReport(plain.root))).not.toContain("Form:");

    expect(() => createStoryProject({ cwd, title: "Bad One", form: "epic-poem" })).toThrow('Unsupported form "epic-poem"');
  });

  test("validate warns about targets and finished manuscripts outside the form's range", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Too Long", form: "flash" });
    editStory(root, "target-words: 1000", "target-words: 9000");
    expect(validateProject(root).warnings).toContain("story.md target-words 9000 is outside the usual flash range of 1-1500 words");

    editStory(root, "target-words: 9000", "target-words: 900");
    editStory(root, "status: planning", "status: complete");
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: final\nword-count: 1600", `## Chapter Text\n\n${"word ".repeat(1600)}\n`);
    expect(validateProject(root).warnings).toContain("Manuscript length 1600 is outside the usual flash range of 1-1500 words");

    editStory(root, "form: flash", "form: sonnet");
    expect(validateProject(root).errors).toContain("story.md frontmatter field form has unsupported value sonnet");
  });

  test("formRangeWarning ignores unknown forms, serials, and missing counts", () => {
    expect(formRangeWarning("sonnet", 10, "x")).toBe("");
    expect(formRangeWarning("serial", 10, "x")).toBe("");
    expect(formRangeWarning("novel", undefined, "x")).toBe("");
    expect(formRangeWarning("novel", 90000, "x")).toBe("");
  });

  test("the CLI accepts --form", () => {
    const cwd = makeTempDir();
    const result = invoke(cwd, ["init", "Tiny Book", "--form", "picture-book"]);
    expect(result.code).toBe(0);
    expect(fs.readFileSync(path.join(cwd, "tiny-book", "story.md"), "utf8")).toContain("form: picture-book\ntarget-words: 500\n");
  });
});

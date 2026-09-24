import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createEntity, createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function project(chapterStatus = "final") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Checked Facts", force: false });
  createEntity(root, { kind: "chapter", name: "Ward", number: "1", status: chapterStatus });
  return { root, cwd };
}

function writeNote(root, id, fields) {
  writeMarkdown(path.join(root, "research", `${id}.md`), `
title: ${id}
${fields}
used-in:
  - chapter-01
`, `# ${id}\n`);
}

function researchWarnings(root) {
  return validateProject(root).warnings.filter((warning) => warning.startsWith("research/") && !warning.includes("registry"));
}

describe("research accuracy, method, and risk review", () => {
  test("add research writes accuracy, confidence, method, and risks", () => {
    const { root, cwd } = project();
    const result = invoke(cwd, [
      "add", "research", "Night Shift",
      "--accuracy", "must-be-accurate", "--confidence", "medium", "--method", "interview",
      "--risk", "medical", "--risk", "safety", "--path", root
    ]);
    expect(result.code).toBe(0);
    const note = fs.readFileSync(path.join(root, "research", "night-shift.md"), "utf8");
    expect(note).toContain("accuracy: must-be-accurate\nconfidence: medium\nmethod: interview\nrisk:\n  - medical\n  - safety\n");

    expect(invoke(cwd, ["add", "research", "Bad", "--method", "guess", "--path", root]).err).toContain("guess");
    expect(invoke(cwd, ["add", "research", "Bad", "--risk", "spicy", "--path", root]).err).toContain('Unsupported risk "spicy"');
  });

  test("invented notes need no sources and never hold up final chapters", () => {
    const { root } = project();
    writeNote(root, "the-guild-charter", "status: open\naccuracy: invented");
    writeNote(root, "made-up-verified", "status: verified\naccuracy: invented");
    expect(researchWarnings(root)).toEqual([]);
  });

  test("risky notes used in settled chapters need a reviewer", () => {
    const { root } = project();
    writeNote(root, "dosage", "status: verified\nsources:\n  - BNF\nrisk:\n  - medical\n  - legal");
    expect(validateProject(root).warnings).toContain("research/dosage.md carries medical, legal risk but has no reviewed-by, and chapter-01 relies on it");
    writeNote(root, "dosage", "status: verified\nsources:\n  - BNF\nrisk:\n  - medical\nreviewed-by:\n  - ward nurse (retired)");
    expect(researchWarnings(root)).toEqual([]);

    const drafting = project("draft");
    writeNote(drafting.root, "dosage", "status: verified\nsources:\n  - BNF\nrisk:\n  - medical");
    expect(researchWarnings(drafting.root)).toEqual([]);
  });

  test("validate rejects unknown accuracy, confidence, method, and risk values", () => {
    const { root } = project();
    writeNote(root, "odd", "status: open\naccuracy: vibes\nconfidence: total\nmethod: dream\nrisk:\n  - spicy\nreviewed-by: someone");
    const errors = validateProject(root).errors;
    expect(errors).toContain("research/odd.md frontmatter field accuracy has unsupported value vibes");
    expect(errors).toContain("research/odd.md frontmatter field confidence has unsupported value total");
    expect(errors).toContain("research/odd.md frontmatter field method has unsupported value dream");
    expect(errors).toContain("research/odd.md risk has unsupported value spicy");
    expect(errors).toContain("research/odd.md frontmatter field reviewed-by must be a list");
  });
});

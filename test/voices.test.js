import { describe, expect, test } from "bun:test";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createStoryProject, validateProject, voicesReport } from "../src/story.js";
import { formatVoices, quotedSpans } from "../src/voices.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function writeCharacter(root, id, name, extra = "", status = "alive") {
  writeMarkdown(path.join(root, "characters", `${id}.md`), `
name: ${name}
role: supporting
status: ${status}
${extra}
`, `# ${name}\n`);
}

function writeChapter(root, number, paragraphs) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `
title: Chapter ${number}
number: ${number}
status: draft
`, `## Chapter Text\n\n${paragraphs.join("\n\n")}\n`);
}

function voiceProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Voices", force: false });
  writeCharacter(root, "mara-quill", "Mara Quill", "aliases:\n  - The Diver\nvoice-words:\n  - tide\n  - reckon\nvoice-avoid:\n  - okay");
  writeCharacter(root, "tom-reed", "Tom Reed");
  writeCharacter(root, "old-cut", "Oldcut", "", "cut");
  return { root, cwd };
}

describe("story voices", () => {
  test("attributes tagged lines, action beats, and aliases; counts the rest", () => {
    const { root } = voiceProject();
    writeChapter(root, 1, [
      "“The tide turns at nine,” Mara said.",
      "“You can’t be sure,” said Tom. “Can you?”",
      "The Diver shrugged. \"The tide never lies. Okay?\"",
      "\"Nobody knows,\" someone called.",
      "Mara looked at Tom. \"Well?\"",
      "No dialogue here."
    ]);
    const report = voicesReport(root);
    expect(report.ok).toBe(true);
    expect(report.unattributed).toBe(2);
    const mara = report.profiles.find((entry) => entry.id === "mara-quill");
    const tom = report.profiles.find((entry) => entry.id === "tom-reed");
    expect(mara.lines).toBe(2);
    expect(mara.words).toBe(10);
    expect(mara.signature).toEqual(["tide"]);
    expect(tom.lines).toBe(2);
    expect(tom.contractions).toBeCloseTo(100 / 6, 5);
    expect(tom.questions).toBe(0.5);
    expect(report.warnings).toEqual([
      "mara-quill says \"okay\", which is in their voice-avoid list (chapter-01)"
    ]);
  });

  test("flags unused voice-words and characters who sound alike once they have five lines", () => {
    const { root } = voiceProject();
    const lines = [];
    for (let index = 0; index < 5; index += 1) {
      lines.push(`"We go now. We go fast." Mara said.`, `"We go now. We go fast," Tom said.`);
    }
    writeChapter(root, 1, lines);
    expect(voicesReport(root).warnings).toEqual([
      "mara-quill does not say \"tide\" from their voice-words list in 5 attributed lines of dialogue",
      "mara-quill does not say \"reckon\" from their voice-words list in 5 attributed lines of dialogue",
      "mara-quill and tom-reed may sound alike: similar sentence length, contractions, questions, and exclamations"
    ]);
  });

  test("two tagged speakers leave a line unattributed, nameless characters are skipped, and signature words rank", () => {
    const { root } = voiceProject();
    writeCharacter(root, "nameless", "\"\"");
    writeChapter(root, 1, [
      "\"Enough,\" Mara said, and Tom said nothing.",
      "\"Brine and brine and kelp and kelp and kelp,\" Tom said."
    ]);
    const report = voicesReport(root);
    expect(report.unattributed).toBe(1);
    expect(report.profiles.map((entry) => [entry.id, entry.signature])).toEqual([["tom-reed", ["kelp", "brine"]]]);
  });

  test("quotedSpans pairs curly and straight quotes and skips empty ones", () => {
    expect(quotedSpans("“One,” she said, \"two\" and \"\" “ ”")).toEqual(["One,", "two"]);
  });

  test("validate checks voice lists; the CLI prints profiles and an empty state", () => {
    const { root, cwd } = voiceProject();
    const empty = invoke(cwd, ["voices", root]);
    expect(empty.code).toBe(0);
    expect(empty.out).toContain("- None: tag dialogue with a character's name and a speech verb");

    writeChapter(root, 1, ["\"Wait!\" Tom shouted."]);
    const result = invoke(cwd, ["voices", root]);
    expect(result.out).toContain("tom-reed: 1 lines, 1 words");
    expect(result.out).toContain("exclamations 100%");
    expect(result.out).toContain("Signature words: none yet");
    expect(result.err).toContain("Voice check complete");
    expect(formatVoices({ profiles: [], unattributed: 3, warnings: [] })).toContain("0 speaking characters, 3 unattributed lines");

    writeCharacter(root, "bad", "Bad", "voice-words: nope");
    expect(validateProject(root).errors).toContain("characters/bad.md frontmatter field voice-words must be a list");
  });
});

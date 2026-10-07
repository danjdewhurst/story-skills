import { describe, expect, test } from "bun:test";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { analyzeChapter, proseRules } from "../src/prose.js";
import { createEntity, createStoryProject, validateProject, voicesReport } from "../src/story.js";
import { buildVoices, formatVoices, quotedSpans } from "../src/voices.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

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
    expect(messages(report.warnings)).toEqual([
      "mara-quill says \"okay\", which is in their voice-avoid list (chapter-01)"
    ]);
  });

  test("counts the words of a line as story wordcount counts them", () => {
    const { root } = voiceProject();
    writeChapter(root, 1, ["“The well-known <em>tide</em> turns&hellip;” Mara said."]);
    expect(voicesReport(root).profiles.find((entry) => entry.id === "mara-quill").words).toBe(4);
  });

  test("flags unused voice-words and characters who sound alike once they have five lines", () => {
    const { root } = voiceProject();
    const lines = [];
    for (let index = 0; index < 5; index += 1) {
      lines.push(`"We go now. We go fast." Mara said.`, `"We go now. We go fast," Tom said.`);
    }
    writeChapter(root, 1, lines);
    expect(messages(voicesReport(root).warnings)).toEqual([
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

  test("matches voice-words and voice-avoid in the story's casing", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Sesler", force: false, language: "tr" });
    writeCharacter(root, "mara", "Mara", "voice-words:\n  - ince\nvoice-avoid:\n  - ılık");
    writeCharacter(root, "tom", "Tom", "voice-words:\n  - ince");
    const lines = [];
    for (let index = 0; index < 5; index += 1) {
      lines.push("Mara güldü. \"ILIK bir gün, ınce değil.\"", "Tom baktı. \"İnce bir ses mi?\"");
    }
    writeChapter(root, 1, lines);
    const warnings = messages(voicesReport(root).warnings);
    expect(warnings).toContain("mara says \"ılık\", which is in their voice-avoid list (chapter-01)");
    expect(warnings).toContain("mara does not say \"ince\" from their voice-words list in 5 attributed lines of dialogue");
    expect(warnings.filter((message) => message.startsWith("tom "))).toEqual([]);
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
    expect(result.out).toContain("tom-reed: 1 line, 1 word");
    expect(result.out).toContain("exclamations 100%");
    expect(result.out).toContain("Signature words: none yet");
    expect(result.err).toContain("Voice check complete");
    expect(formatVoices({ profiles: [], unattributed: 3, warnings: [] })).toContain("0 speaking characters, 3 unattributed lines");

    writeCharacter(root, "bad", "Bad", "voice-words: nope");
    expect(messages(validateProject(root).errors)).toContain("characters/bad.md frontmatter field voice-words must be a list");
  });
});

function newProject(title = "Analysis", cwd = makeTempDir()) {
  return createStoryProject({ cwd, title }).root;
}

function writeChapterWith(root, number, body, extra = "") {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft${extra ? `\n${extra}` : ""}`, `## Chapter Text\n\n${body}\n`);
}

const rules = (style = {}, names = []) => proseRules(style, names);

describe("voices (#83, #210, #214, #215, #216, #217)", () => {
  const project = (names) => ({ characters: names.map((name) => ({ id: name.toLowerCase(), name, aliases: [], status: "alive" })) });

  test("#83 single quotes, dash dialogue, and possessives inside British quotes", () => {
    const report = buildVoices(project(["Bo", "Cy"]), [{
      id: "chapter-01",
      paragraphs: [
        "\"Double quoted line here,\" Bo said.",
        "'Single quoted line here,' Cy said.",
        "— Dash dialogue line here, said Cy.",
        "‘The dogs’ bowls are empty,’ Bo said."
      ]
    }]);
    const byId = Object.fromEntries(report.profiles.map((entry) => [entry.id, entry]));
    expect(byId.cy.lines).toBe(2);
    expect(byId.bo.words).toBe(4 + 5);
    expect(quotedSpans("‘The dogs’ bowls are empty,’ Bo said.")).toEqual(["The dogs’ bowls are empty,"]);
    expect(quotedSpans("She didn't say 'tis the season.")).toEqual([]);
  });

  test("#83 multi-paragraph speech goes to the tagged speaker", () => {
    const report = buildVoices(project(["Bo"]), [{
      id: "chapter-01",
      paragraphs: ["Bo said, \"The first part runs on.", "\"And the last part ends here.\""]
    }]);
    expect(report.profiles[0]).toMatchObject({ id: "bo", lines: 2 });
    const unknown = buildVoices(project(["Bo"]), [{ id: "chapter-01", paragraphs: ["\"Nobody tagged this.", "\"Or this.\""] }]);
    expect(unknown.unattributed).toBe(2);
  });

  test("#83 prose sees said-bookisms in single-quoted lines", () => {
    expect(analyzeChapter("'Stop that,' she snapped.", rules()).bookisms).toEqual([{ word: "snapped", count: 1 }]);
  });

  test("#210 voices sentences survive titles", () => {
    const report = buildVoices(project(["Mara"]), [{ id: "chapter-01", paragraphs: ["\"Mr. Reed is waiting. He's patient,\" Mara said."] }]);
    expect(report.profiles[0].sentenceLength).toBe(3);
  });

  test("#214 's contractions count, possessives do not", () => {
    const report = buildVoices(project(["Mara"]), [{ id: "chapter-01", paragraphs: ["\"It's late. That's fine. Let's go. He's here. Where's Tom?\" Mara said.", "\"Tom's boat,\" Mara said."] }]);
    expect(report.profiles[0].contractions).toBeCloseTo((5 * 100) / 12, 5);
  });

  test("#215 dialogue in closed code fences is ignored", () => {
    const root = newProject();
    createEntity(root, { kind: "character", name: "Mara" });
    writeChapterWith(root, 1, "\"Run it,\" Mara said.\n\n```\n$ echo \"Access denied, Mara said the system.\"\n> \"Retry?\" Mara asked.\n```");
    expect(voicesReport(root).profiles[0]).toMatchObject({ id: "mara", lines: 1, words: 2 });
  });

  test("#217 shares exactly 10 points apart are treated alike", () => {
    const lines = (name, questions) => Array.from({ length: 10 }, (_, index) => `"${index < questions ? "Where are we going now?" : "We are going home now."}" ${name} said.`);
    const report = buildVoices(project(["Anna", "Bert", "Cara"]), [{ id: "chapter-01", paragraphs: [...lines("Anna", 3), ...lines("Bert", 2), ...lines("Cara", 4)] }]);
    expect(messages(report.warnings).filter((warning) => warning.includes("may sound alike") && warning.includes("anna"))).toEqual([]);
  });
});

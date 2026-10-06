import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import { checkEvals } from "../scripts/check-evals.js";

function evalsRoot() {
  const root = makeTempDir("story-check-evals-");
  fs.mkdirSync(path.join(root, "evals", "fixtures"), { recursive: true });
  fs.mkdirSync(path.join(root, "evals", "examples"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills", "chapter-writing"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills", "chapter-writing", "SKILL.md"), "---\nname: chapter-writing\n---\n");
  return root;
}

function addFixture(root, name, checks, { input = "Petra came on Thursday.\n", example = true } = {}) {
  const dir = path.join(root, "evals", "fixtures", name);
  fs.mkdirSync(dir, { recursive: true });
  if (input !== null) fs.writeFileSync(path.join(dir, "input.md"), input);
  if (checks !== null) {
    fs.writeFileSync(path.join(dir, "checks.json"), typeof checks === "string" ? checks : JSON.stringify(checks));
  }
  if (example) fs.writeFileSync(path.join(root, "evals", "examples", `${name}.md`), "Draft.\n");
}

function run(root) {
  const lines = [];
  const status = checkEvals(root, (line) => lines.push(line));
  return { status, lines, out: lines.join("\n") };
}

const good = { brief: "Draft the scene.", skill: "chapter-writing", required: ["Petra"] };

describe("check-evals", () => {
  test("passes the repository's own fixtures", () => {
    const result = run(path.resolve(import.meta.dir, ".."));
    expect(result.out).toContain("all eval fixture checks passed");
    expect(result.status).toBe(0);
  });

  test("fails when either folder is missing", () => {
    const root = makeTempDir("story-check-evals-");
    expect(run(root)).toEqual({ status: 1, lines: ["FAIL evals/fixtures: missing directory"], out: "FAIL evals/fixtures: missing directory" });
    fs.mkdirSync(path.join(root, "evals", "fixtures"), { recursive: true });
    expect(run(root).out).toBe("FAIL evals/examples: missing directory");
  });

  test("fails a folder with no fixtures", () => {
    const result = run(evalsRoot());
    expect(result.status).toBe(1);
    expect(result.out).toContain("FAIL evals/fixtures: no fixtures found");
  });

  test("passes a well-formed fixture and prints its warnings", () => {
    const root = evalsRoot();
    addFixture(root, "ok", { ...good, banned: ["Thursday"] });
    const result = run(root);
    expect(result.status).toBe(0);
    expect(result.out).toContain('WARN ok: banned phrase "Thursday" appears in input.md');
    expect(result.lines.at(-1)).toBe("all eval fixture checks passed");
  });

  test("reports every malformed field", () => {
    const root = evalsRoot();
    addFixture(root, "bad-json", "{ nope", { example: false });
    addFixture(root, "array", "[]");
    addFixture(root, "no-checks", null, { input: null });
    addFixture(root, "fields", {
      brief: " ",
      skill: "no-such-skill",
      required: ["", 3],
      max_words: -1,
      paragraphs: 1.5,
      ends_with_question: "yes",
      language: "not a tag",
      voice_drift: { hedge_rate: "high", tone: 1 },
      banned_regex: ["(unclosed", 7]
    });
    addFixture(root, "empty", { brief: "Draft.", skill: "chapter-writing", voice_drift: [] });
    addFixture(root, "voice", { brief: "Draft.", skill: "chapter-writing", voice_drift: { mean_word_length: 4.2 } });
    fs.writeFileSync(path.join(root, "evals", "examples", "stray.md"), "Draft.\n");
    fs.writeFileSync(path.join(root, "evals", "examples", "notes.txt"), "ignored\n");

    const result = run(root);
    expect(result.status).toBe(1);
    for (const line of [
      "FAIL bad-json/checks.json: invalid JSON",
      "FAIL evals/examples/bad-json.md: missing known-good draft",
      "FAIL array/checks.json: top level must be an object",
      "FAIL no-checks: missing input.md",
      "FAIL no-checks: missing checks.json",
      "FAIL fields/checks.json: brief must be a non-empty string",
      'FAIL fields/checks.json: skill "no-such-skill" does not match a skill in skills/',
      "FAIL fields/checks.json: required must be a list of non-empty strings",
      "FAIL fields/checks.json: max_words must be a positive number",
      "FAIL fields/checks.json: paragraphs must be a positive integer",
      "FAIL fields/checks.json: ends_with_question must be a boolean",
      "FAIL fields/checks.json: language must be a BCP 47 tag",
      'FAIL fields/checks.json: voice_drift has unknown key "tone"',
      "FAIL fields/checks.json: voice_drift[hedge_rate] must be numeric",
      "FAIL fields/checks.json: voice_drift must include a known numeric marker",
      "FAIL fields/checks.json: banned_regex /(unclosed/ does not compile",
      "FAIL empty/checks.json: voice_drift must be an object",
      "FAIL empty/checks.json: defines no required, banned, banned_regex, length, structural, or voice_drift checks",
      "FAIL evals/examples/stray.md: no matching fixture"
    ]) {
      expect(result.out).toContain(line);
    }
    expect(result.out).not.toContain("voice/checks.json");
    expect(result.out).not.toContain("notes.txt");
    expect(result.lines.at(-1)).toMatch(/^\d+ problem\(s\) found$/);
  });

  test("warnings still print beside failures", () => {
    const root = evalsRoot();
    addFixture(root, "warned", { ...good, brief: "", banned: ["Thursday"] });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.out).toContain("FAIL warned/checks.json: brief must be a non-empty string");
    expect(result.out).toContain('WARN warned: banned phrase "Thursday" appears in input.md');
  });
});

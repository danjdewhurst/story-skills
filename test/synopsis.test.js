import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createStoryProject, synopsisBook } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function synopsisProject(title = "The Long Valley") {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title, force: false });
  const root = created.root;

  const storyPath = path.join(root, "story.md");
  const raw = fs.readFileSync(storyPath, "utf8");
  fs.writeFileSync(storyPath, raw.replace("# Synopsis", "# Synopsis\n\nA ledger burns in the valley. Mara must find who lit the match. The town keeps its silence."), "utf8");
  return { root, cwd };
}

function writeArc(root, id, body) {
  writeMarkdown(path.join(root, "plot", "arcs", `${id}.md`), `
name: ${id}
type: main
status: active
`, `# ${id}\n\n${body}\n`);
}

function wordy(word, repeats) {
  return `${word} `.repeat(repeats).trim();
}

function countWords(text) {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

const STANDARD_ARC = `## Setup

Mara arrives in the valley with a burned hand. She asks questions no one answers.

## Rising Action

She finds the mill door ajar. She follows the ash trail into the woods.

## Climax

She confronts the miller at dawn.

## Resolution

The valley keeps its secret.`;

describe("synopsis builder", () => {
  test("uses the first synopsis sentence as the premise", () => {
    const { root } = synopsisProject();
    writeArc(root, "test-arc", STANDARD_ARC);

    const { text } = synopsisBook(root);
    expect(text).toContain("Premise: A ledger burns in the valley.");
    expect(text).not.toContain("Mara must find who lit the match.");
  });

  test("is deterministic across runs", () => {
    const { root } = synopsisProject();
    writeArc(root, "test-arc", STANDARD_ARC);

    expect(synopsisBook(root).text).toBe(synopsisBook(root).text);
  });

  test("honors question-mark boundaries in the premise", () => {
    const { root } = synopsisProject();
    const storyPath = path.join(root, "story.md");
    const raw = fs.readFileSync(storyPath, "utf8");
    fs.writeFileSync(
      storyPath,
      raw.replace("A ledger burns in the valley.", "Who lit the fire? Mara investigates."),
      "utf8"
    );

    const { text } = synopsisBook(root);
    expect(text).toContain("Premise: Who lit the fire?");
    expect(text).not.toContain("Premise: Who lit the fire? Mara investigates.");
  });

  test("honors exclamation-mark boundaries in the causal chain", () => {
    const { root } = synopsisProject();
    writeArc(root, "test-arc", "## Climax\n\nShe confronts the miller at dawn! The mill burns behind them.\n");

    const { text } = synopsisBook(root);
    expect(text).toContain("Because She confronts the miller at dawn!");
    expect(text).not.toContain("The mill burns behind them.");
  });

  test("appends a period to premise text without terminal punctuation", () => {
    const { root } = synopsisProject();
    const storyPath = path.join(root, "story.md");
    const raw = fs.readFileSync(storyPath, "utf8");
    fs.writeFileSync(
      storyPath,
      raw
        .replace("A ledger burns in the valley. Mara must find who lit the match. The town keeps its silence.", "A ledger burns in the valley")
        .replace("Add a 2-3 sentence synopsis here.", ""),
      "utf8"
    );

    const { text } = synopsisBook(root);
    expect(text).toContain("Premise: A ledger burns in the valley.");
  });

  test("renders arc beats in sequence with a Because-joined causal chain", () => {
    const { root } = synopsisProject();
    writeArc(root, "test-arc", STANDARD_ARC);

    const { text } = synopsisBook(root);
    const setupIndex = text.indexOf("Mara arrives in the valley");
    const risingIndex = text.indexOf("She finds the mill door ajar");
    const chainIndex = text.indexOf("Because She confronts the miller at dawn. The valley keeps its secret.");
    expect(setupIndex).toBeGreaterThan(-1);
    expect(risingIndex).toBeGreaterThan(setupIndex);
    expect(chainIndex).toBeGreaterThan(risingIndex);
  });

  test("skips arcs without recognized sections", () => {
    const { root } = synopsisProject();
    writeArc(root, "empty-arc", "## Notes\n\nNothing structured here.\n");

    const { text } = synopsisBook(root);
    expect(text).toContain("## empty-arc");
    expect(text).not.toContain("Nothing structured here.");
  });

  test("writes the synopsis file to a dist path", () => {
    const { root } = synopsisProject();
    writeArc(root, "test-arc", STANDARD_ARC);

    const result = synopsisBook(root, { out: path.join("dist", "the-long-valley.synopsis.md") });
    expect(result.outFile).toBe(path.join(root, "dist", "the-long-valley.synopsis.md"));
    expect(fs.existsSync(result.outFile)).toBe(true);
    expect(fs.readFileSync(result.outFile, "utf8")).toBe(result.text);
  });

  test("keeps a 1-page synopsis within the 500-word budget with hard truncation", () => {
    const { root } = synopsisProject();
    writeArc(root, "big-arc", `## Setup

${wordy("Mara", 300)} arrives.

## Rising Action

She searches the valley.

## Climax

${wordy("Confrontation", 300)} happens.

## Resolution

The valley keeps its secret.`);

    const { text } = synopsisBook(root);
    expect(countWords(text)).toBeLessThanOrEqual(500);
    expect(text.trimEnd().endsWith("…")).toBe(true);
  });

  test("drops rising action first when trimming to fit one page", () => {
    const { root } = synopsisProject();
    writeArc(root, "trim-arc", `## Setup

Mara arrives in the valley.

## Rising Action

${wordy("UNIQUE-RISING-WORD", 480)} she searches.

## Climax

She confronts the miller.

## Resolution

The valley keeps its secret.`);

    const { text } = synopsisBook(root, { pages: 1 });
    expect(countWords(text)).toBeLessThanOrEqual(500);
    expect(text).not.toContain("UNIQUE-RISING-WORD");
    expect(text).toContain("Because She confronts the miller. The valley keeps its secret.");
  });

  test("a 3-page synopsis keeps content the 1-page version trims", () => {
    const { root } = synopsisProject();
    const body = `## Setup

Mara arrives in the valley.

## Rising Action

${wordy("Valley", 480)} she searches.

## Climax

She confronts the miller.

## Resolution

The valley keeps its secret.`;
    writeArc(root, "sized-arc", body);

    const onePage = synopsisBook(root, { pages: 1 }).text;
    const threePage = synopsisBook(root, { pages: 3 }).text;
    expect(countWords(onePage)).toBeLessThanOrEqual(500);
    expect(countWords(threePage)).toBeGreaterThan(countWords(onePage));
    expect(countWords(threePage)).toBeLessThanOrEqual(1500);
    expect(threePage.trimEnd().endsWith("…")).toBe(false);
  });

  test("rejects unsupported page counts", () => {
    const { root } = synopsisProject();
    expect(() => synopsisBook(root, { pages: 2 })).toThrow(
      "Unsupported synopsis length: 2. Supported pages: 1, 3"
    );
  });

  test("cli prints the synopsis text when --out is omitted", () => {
    const { root, cwd } = synopsisProject();
    writeArc(root, "test-arc", STANDARD_ARC);

    const result = invoke(cwd, ["synopsis", root]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("# Synopsis: The Long Valley");
    expect(result.out).toContain("Premise: A ledger burns in the valley.");
  });

  test("cli writes a 3-page synopsis file", () => {
    const { root, cwd } = synopsisProject();
    writeArc(root, "test-arc", STANDARD_ARC);

    const result = invoke(cwd, ["synopsis", root, "--pages", "3", "--out", "dist/the-long-valley.synopsis.md"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain(path.join("dist", "the-long-valley.synopsis.md"));
    expect(fs.existsSync(path.join(root, "dist", "the-long-valley.synopsis.md"))).toBe(true);
  });

  test("cli rejects unsupported page counts", () => {
    const { root, cwd } = synopsisProject();
    const result = invoke(cwd, ["synopsis", root, "--pages", "2"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Unsupported synopsis length: 2. Supported pages: 1, 3");
  });
});

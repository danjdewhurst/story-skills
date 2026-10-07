import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { wordCount } from "../src/markdown.js";
import { truncateWords } from "../src/build.js";
import { createEntity, createStoryProject, synopsisBook } from "../src/story.js";
import { expectLinearGrowth, makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

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
  return wordCount(text);
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

function newProject(title = "Bugs") {
  return createStoryProject({ cwd: makeTempDir(), title }).root;
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("synopsis builder", () => {
  test("uses the first synopsis sentence as the premise", () => {
    const { root } = synopsisProject();
    writeArc(root, "test-arc", STANDARD_ARC);

    const { text } = synopsisBook(root);
    expect(text).toContain("Logline: A ledger burns in the valley.");
    expect(text).not.toContain("Mara must find who lit the match.");
  });

  test("keeps an honorific with the premise sentence", () => {
    const { root } = synopsisProject();
    const storyPath = path.join(root, "story.md");
    const raw = fs.readFileSync(storyPath, "utf8");
    fs.writeFileSync(storyPath, raw.replace("A ledger burns in the valley.", "Dr. Mara left the mill."), "utf8");

    expect(synopsisBook(root).text).toContain("Logline: Dr. Mara left the mill.");
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
    expect(text).toContain("Logline: Who lit the fire?");
    expect(text).not.toContain("Logline: Who lit the fire? Mara investigates.");
  });

  test("honors exclamation-mark boundaries in the causal chain", () => {
    const { root } = synopsisProject();
    writeArc(root, "test-arc", "## Climax\n\nShe confronts the miller at dawn! The mill burns behind them.\n");

    const { text } = synopsisBook(root);
    expect(text).toContain("Because she confronts the miller at dawn!");
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
    expect(text).toContain("Logline: A ledger burns in the valley.");
  });

  test("renders arc beats in sequence with a Because-joined causal chain", () => {
    const { root } = synopsisProject();
    writeArc(root, "test-arc", STANDARD_ARC);

    const { text } = synopsisBook(root);
    const setupIndex = text.indexOf("Mara arrives in the valley");
    const risingIndex = text.indexOf("She finds the mill door ajar");
    const chainIndex = text.indexOf("Because she confronts the miller at dawn. The valley keeps its secret.");
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

    const result = synopsisBook(root, { out: "dist/the-long-valley.synopsis.md" });
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
    expect(text).not.toContain("undefined");
  });

  test("truncates dotted tokens with the same word count as the budget", () => {
    const { root } = synopsisProject();
    writeArc(root, "dotted-arc", `## Climax\n\n${"U.S.A ".repeat(400).trim()}\n`);

    const { text } = synopsisBook(root, { pages: 1 });
    expect(wordCount(text)).toBeLessThanOrEqual(500);
    expect(text).not.toContain("undefined");
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
    expect(text).toContain("Because she confronts the miller. The valley keeps its secret.");
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
    expect(result.out).toContain("Logline: A ledger burns in the valley.");
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
    expect(result.code).toBe(2);
    expect(result.err).toContain("Unsupported synopsis length: 2. Supported pages: 1, 3");
  });
});

describe("#438 truncation drops trailing headings and blank lines quickly", () => {
  test("a cut synopsis never ends on a heading or a blank line", () => {
    expect(truncateWords("Opening line.\n\n## Act Two\n\nmore words here", 2)).toBe("Opening line.…\n");
    expect(truncateWords("# Only\n\nalpha beta", 1)).toBe("# Only…\n");
    // Markup split by a space counts as wordCount counts the whole line.
    expect(truncateWords("<span class=\"smallcaps\">Lord</span> Ash rode north", 2)).toBe("<span class=\"smallcaps\">Lord</span> Ash…\n");
    expect(truncateWords("A 灯台守 B", 3)).toBe("A 灯台…\n");
    expect(truncateWords("One two\n#\t\n   \nthree four", 3)).toBe("One two\n#\t\n   \nthree…\n");
  });

  test("a long run of heading and tab lines before the cut finishes fast", () => {
    // The old trailing-lines regex backtracked exponentially on this input.
    const text = `a\n${"#\t\n".repeat(5000)}b c`;
    const started = performance.now();
    expect(truncateWords(text, 2)).toBe(`a\n${"#\t\n".repeat(5000)}b…\n`);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("synopsis performance (#92)", () => {
  test("a synopsis made of initials splits in linear time", () => {
    const project = (n) => {
      const cwd = makeTempDir();
      const { root } = createStoryProject({ cwd, title: "Initials" });
      const storyPath = path.join(root, "story.md");
      const raw = fs.readFileSync(storyPath, "utf8");
      fs.writeFileSync(storyPath, raw.replace("# Synopsis", `# Synopsis\n\n${"A. ".repeat(n / 3)}\n\nThe end came.`), "utf8");
      return root;
    };
    expectLinearGrowth(synopsisBook, project, 24000);
  });
});

describe("#229 synopsis skips HTML comments", () => {
  test("comments stay out of the logline and arc sections", () => {
    const root = newProject("SP");
    const storyFile = path.join(root, "story.md");
    const story = fs.readFileSync(storyFile, "utf8");
    fs.writeFileSync(storyFile, story.replace(/## Synopsis\n[\s\S]*?(\n## |$)/, "## Synopsis\n\n<!-- TODO: sharpen this. Maybe mention the twin. -->\nA diver finds a drowned bell. It rings for the dead.\n$1"));
    createEntity(root, { kind: "arc", name: "Main" });
    const arcFile = path.join(root, "plot", "arcs", "main.md");
    const arc = fs.readFileSync(arcFile, "utf8");
    fs.writeFileSync(arcFile, arc.replace(/(## Setup\n)[\s\S]*?(\n## )/, "$1\n<!-- note: check dates -->\nMara lives on the reef. She hates the bell.\n$2"));
    const { text } = synopsisBook(root);
    expect(text).toContain("Logline: A diver finds a drowned bell.");
    expect(text).toContain("## Main\n\nMara lives on the reef. She hates the bell.");
    expect(text).not.toContain("<!--");
  });
});

describe("synopsis", () => {
  test("skips starter text and turns list items into sentences", () => {
    const root = sweepProject();
    createEntity(root, { kind: "arc", name: "Main" });
    const arc = path.join(root, "plot", "arcs", "main.md");
    fs.writeFileSync(arc, fs.readFileSync(arc, "utf8").replace("1. First escalation\n2. Second escalation", "1. The tide turns\n2. The bell rings"));
    const text = synopsisBook(root).text;
    expect(text).toContain("Logline: No logline recorded.");
    expect(text).not.toContain("Initial state and inciting pressure");
    expect(text).not.toContain("Decision point");
    expect(text).toContain("The tide turns. The bell rings.");
    expect(text).not.toMatch(/ {2}/);
  });

  test("truncation keeps headings and paragraphs", () => {
    const root = sweepProject();
    for (let index = 1; index <= 30; index += 1) {
      createEntity(root, { kind: "arc", name: `Arc ${index}` });
      const arc = path.join(root, "plot", "arcs", `arc-${index}.md`);
      const setup = Array.from({ length: 3 }, (_, n) => `Setup sentence ${n} for arc ${index} with several more words.`).join(" ");
      fs.writeFileSync(arc, fs.readFileSync(arc, "utf8").replace("Initial state and inciting pressure.", setup));
    }
    const text = synopsisBook(root).text;
    expect(text).toContain("\n## Arc 1\n\n");
    expect(text).not.toMatch(/\S ## Arc/);
    expect(text.trimEnd().endsWith("…")).toBe(true);
  });
});

describe("sweep fixes", () => {
  test("synopsis sentences respect abbreviations, closing quotes, and names", () => {
    const root = sweepProject();
    createEntity(root, { kind: "arc", name: "Main" });
    const arc = path.join(root, "plot", "arcs", "main.md");
    fs.writeFileSync(arc, fs.readFileSync(arc, "utf8")
      .replace("Initial state and inciting pressure.", "Mara, e.g. the heir, stays. She says \"Run.\" Then everyone runs.")
      .replace("Decision point or highest tension.", "She chooses the reef!")
      .replace("What changes because of this arc.", "Mara keeps the light."));
    const text = synopsisBook(root).text;
    expect(text).toContain("Mara, e.g. the heir, stays. She says \"Run.\"\n");
    expect(text).toContain("Because she chooses the reef! Mara keeps the light.");
  });

  test("synopsis sentences handle dotted abbreviations and compound names", () => {
    const root = sweepProject();
    createEntity(root, { kind: "arc", name: "Main" });
    const arc = path.join(root, "plot", "arcs", "main.md");
    fs.writeFileSync(arc, fs.readFileSync(arc, "utf8")
      .replace("Initial state and inciting pressure.", "Mara joins the U.S. Navy. She leaves at 9 a.m. Then the tide turns.")
      .replace("Decision point or highest tension.", "A.J. arrives."));
    const text = synopsisBook(root).text;
    expect(text).toContain("Mara joins the U.S. Navy. She leaves at 9 a.m.\n");
    expect(text).toContain("Because A.J. arrives.");
  });

  test("synopsis labels the logline, and three pages carry more than one", () => {
    const root = sweepProject();
    createEntity(root, { kind: "arc", name: "Main" });
    const arc = path.join(root, "plot", "arcs", "main.md");
    const setup = Array.from({ length: 5 }, (_, index) => `Setup beat ${index + 1} happens.`).join(" ");
    fs.writeFileSync(arc, fs.readFileSync(arc, "utf8").replace("Initial state and inciting pressure.", setup));
    const one = synopsisBook(root, { pages: 1 }).text;
    const three = synopsisBook(root, { pages: 3 }).text;
    expect(one).toContain("Logline: No logline recorded.");
    expect(one).toContain("Setup beat 2 happens.");
    expect(one).not.toContain("Setup beat 3");
    expect(three).toContain("Setup beat 4 happens.");
  });
});

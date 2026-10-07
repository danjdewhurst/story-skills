import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { inkKnotName, inkSource } from "../src/ink.js";
import { buildBook, createStoryProject } from "../src/story.js";
import { derivedIfid } from "../src/twee.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

function project(title = "Gull Rock") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function chapter(root, id, prose, extra = "", number = Number(id.replace(/\D+/g, "")) || 1) {
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Part ${number}\nnumber: ${number}\nstatus: draft${extra ? `\n${extra.trim()}` : ""}`, `\n# Chapter ${number}: Part ${number}\n\n## Chapter Text\n\n${prose}\n`);
  return id;
}

// Single-quoted YAML, so a backslash in the text stays one backslash.
function choices(...pairs) {
  return `choices:\n${pairs.map(([text, to]) => `  - text: '${text.replace(/'/g, "''")}'\n    to: '${to}'\n`).join("")}`;
}

const IFID = "3F2C9A61-7B1D-4E8A-9C3B-2A6D5E4F1B07";

function setStory(root, lines) {
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\n${lines}`));
}

function branching() {
  const root = project();
  setStory(root, `ifid: ${IFID.toLowerCase()}\nauthor: Ada Fenn\n`);
  chapter(root, "chapter-01", "The lamp is dark.", choices(["Search the rocks", "chapter-02"], ["Climb the tower", "chapter-03"]));
  chapter(root, "chapter-02", "A coat on the ledge.", choices(["Go up", "chapter-04"]));
  chapter(root, "chapter-03", "Tobias on the stair.", choices(["Go up", "chapter-04"], ["Start over", "chapter-01"]));
  chapter(root, "chapter-04", "The ship on the reef. THE END.");
  return root;
}

const read = (file) => fs.readFileSync(file, "utf8");

// Prose lines that ink would read as syntax, with the line the build must
// write so ink prints them unchanged. Each was checked with inklecate.
const PROSE_CASES = [
  ["* * *", "\\* * *"],
  ["***", "\\***"],
  ["+ a list item", "\\+ a list item"],
  ["- a dash item", "\\- a dash item"],
  ["---", "\\---"],
  ["-- em", "\\-- em"],
  ["= eq", "\\= eq"],
  ["== Part Two ==", "\\== Part Two =="],
  ["~ a tilde", "\\~ a tilde"],
  ["-> a divert", "\\-> a divert"],
  ["<- a thread", "\\<- a thread"],
  ["--> a long arrow", "\\-\\-> a long arrow"],
  ["// not a comment", "/\\/ not a comment"],
  ["/* not a block */", "/\\* not a block */"],
  ["See http://gull.example/// now", "See http:/\\/gull.example/\\/\\/ now"],
  ["A {brace} and } alone", "A \\{brace\\} and \\} alone"],
  ["Either | or", "Either \\| or"],
  ["Hash # tag", "Hash \\# tag"],
  ["Glue <> here", "Glue \\<> here"],
  ["A back\\slash and a final \\", "A back\\\\slash and a final \\\\"],
  ["Bracketed [text]", "Bracketed \\[text\\]"],
  ["Mid ~ tilde", "Mid \\~ tilde"],
  ["Arrows -> and <- inside", "Arrows \\-> and \\<- inside"],
  ["INCLUDE other.ink", "\\INCLUDE other.ink"],
  ["VAR x = 1", "\\VAR x = 1"],
  ["CONST x = 1", "\\CONST x = 1"],
  ["LIST x = a", "\\LIST x = a"],
  ["EXTERNAL f()", "\\EXTERNAL f()"],
  ["TODO: fix this", "\\TODO: fix this"],
  ["TODO", "\\TODO"],
  ["TODOS stay", "TODOS stay"],
  ["   * indented", "\\* indented"],
  ["Plain *emphasis*, a + b = c, 3 - 2, a < b > c, and a / b.", "Plain *emphasis*, a + b = c, 3 - 2, a < b > c, and a / b."]
];

// Choice text runs inside `+ [ ... ]`: the same inline escapes, and nothing
// at its start is a line-start construct. Twine's rules already keep [, ],
// |, ->, and <- out of choice text.
const CHOICE_CASES = [
  ["Ring {the} bell", "Ring \\{the\\} bell"],
  ["#1 option", "\\#1 option"],
  ["Glue <> it", "Glue \\<> it"],
  ["Back\\slash", "Back\\\\slash"],
  ["Visit http://gull.example", "Visit http:/\\/gull.example"],
  ["a/*b", "a/\\*b"],
  ["~Tilde", "\\~Tilde"],
  ["* star", "* star"],
  ["- dash", "- dash"],
  ["(aside) go", "(aside) go"],
  ["TODO later", "TODO later"]
];

describe("ink build", () => {
  test("writes a knot per chapter with sticky choices, -> END for an ending, and the metadata as tags", () => {
    const root = branching();
    const result = buildBook(root, { format: "ink" });
    expect(result.outFile).toBe(path.join(root, "dist", "gull-rock.ink"));
    expect(result.format).toBe("ink");
    expect(messages(result.warnings)).toEqual([]);
    expect(read(result.outFile)).toBe([
      "# title: Gull Rock",
      "# author: Ada Fenn",
      `# ifid: ${IFID}`,
      "",
      "-> chapter_01",
      "",
      "=== chapter_01 ===",
      "The lamp is dark.",
      "",
      "+ [Search the rocks] -> chapter_02",
      "+ [Climb the tower] -> chapter_03",
      "",
      "=== chapter_02 ===",
      "A coat on the ledge.",
      "",
      "+ [Go up] -> chapter_04",
      "",
      "=== chapter_03 ===",
      "Tobias on the stair.",
      "",
      "+ [Go up] -> chapter_04",
      "+ [Start over] -> chapter_01",
      "",
      "=== chapter_04 ===",
      "The ship on the reef. THE END.",
      "",
      "-> END",
      ""
    ].join("\n"));
    expect(read(buildBook(root, { format: "INK" }).outFile)).toBe(read(result.outFile));
  });

  test("diverts each chapter of a linear book to the next, derives its IFID, and leaves out a missing author", () => {
    const root = project("Plain Line");
    chapter(root, "chapter-01", "One.");
    chapter(root, "chapter-02", "Two.");
    const result = buildBook(root, { format: "ink" });
    const ifid = derivedIfid("plain-line");
    expect(messages(result.warnings)).toEqual([`story.md has no ifid, so the build derived ${ifid} from the story id; add ifid: ${ifid} to story.md to keep it if the title changes`]);
    expect(read(result.outFile)).toBe(`# title: Plain Line\n# ifid: ${ifid}\n\n-> chapter_01\n\n=== chapter_01 ===\nOne.\n\n-> chapter_02\n\n=== chapter_02 ===\nTwo.\n\n-> END\n`);
  });

  test("escapes every prose line and choice text ink would read as syntax", () => {
    const root = branching();
    chapter(root, "chapter-01", PROSE_CASES.map(([line]) => line).join("\n\n"), choices(...CHOICE_CASES.map(([text]) => [text, "chapter-02"])));
    const source = read(buildBook(root, { format: "ink" }).outFile);
    const knot = source.slice(source.indexOf("=== chapter_01 ===\n") + 19, source.indexOf("=== chapter_02 ==="));
    expect(knot).toBe(`${PROSE_CASES.map(([, escaped]) => escaped).join("\n\n")}\n\n${CHOICE_CASES.map(([, escaped]) => `+ [${escaped}] -> chapter_02`).join("\n")}\n\n`);
  });

  test("joins a wrapped paragraph into one line and keeps hard breaks", () => {
    const body = "The lamp is dark,\nand the sun\n   is down.\n\n\n  \nRoses are red,  \nviolets\\\nblue.\\\\\nDone \\";
    const text = inkSource({ title: "T", author: "", ifid: IFID, branching: false, passages: [{ name: "a", body, links: [] }] });
    expect(text).toContain("=== a ===\nThe lamp is dark, and the sun is down.\n\nRoses are red,\nviolets\nblue.\\\\\\\\ Done \\\\\n\n-> END\n");
  });

  test("ends a paragraph at a scene-break line", () => {
    const body = "He left.\n* * *\nShe came\nback.";
    const text = inkSource({ title: "T", author: "", ifid: IFID, branching: false, passages: [{ name: "a", body, links: [] }] });
    expect(text).toContain("=== a ===\nHe left.\n\n\\* * *\n\nShe came back.\n\n-> END\n");
  });

  test("escapes the title and author tags onto one line each", () => {
    const text = inkSource({ title: "Hash # and // slash", author: "Jo {Ann}\nSmith", ifid: IFID.toLowerCase(), branching: false, passages: [{ name: "a", body: "", links: [] }] });
    expect(text).toBe(`# title: Hash \\# and /\\/ slash\n# author: Jo \\{Ann\\} Smith\n# ifid: ${IFID}\n\n-> a\n\n=== a ===\n-> END\n`);
  });

  test("names knots with valid, distinct ink identifiers", () => {
    expect(inkKnotName("chapter-03")).toBe("chapter_03");
    expect(inkKnotName("prologue")).toBe("prologue");
    // All digits, a leading digit, or a reserved word is not a knot name ink
    // accepts; the leading _ cannot meet a mapped kebab-case id.
    expect(inkKnotName("01")).toBe("_01");
    expect(inkKnotName("1a-arrival")).toBe("_1a_arrival");
    for (const word of ["true", "false", "not", "else", "return", "temp", "function"]) {
      expect(inkKnotName(word)).toBe(`_${word}`);
    }
    expect(inkKnotName("the-end")).toBe("the_end");
    const ids = ["01", "true", "chapter-01", "chapter-1", "a-b-c", "a-bc", "ab-c"];
    expect(new Set(ids.map(inkKnotName)).size).toBe(ids.length);
  });

  test("builds chapters named with a reserved word or digits as prefixed knots", () => {
    const root = project();
    chapter(root, "01", "Start.", choices(["Truth", "true"]), 1);
    chapter(root, "true", "True.", "", 2);
    const source = read(buildBook(root, { format: "ink" }).outFile);
    expect(source).toContain("-> _01\n\n=== _01 ===\nStart.\n\n+ [Truth] -> _true\n\n=== _true ===\nTrue.\n\n-> END\n");
  });

  test("refuses the same problems as twee, naming the ink build", () => {
    const root = branching();
    chapter(root, "chapter-04", "End.", choices(["Try again", "chapter-09"]));
    expect(() => buildBook(root, { format: "ink" })).toThrow("Cannot build ink until these are fixed:\nchapters/chapter-04.md choices[0] references missing chapter chapter-09");
    chapter(root, "chapter-04", "End.");
    writeMarkdown(path.join(root, "chapters", "Chapter [06].md"), "title: Odd\nnumber: 6\nstatus: draft", "\n## Chapter Text\n\nOdd.\n");
    expect(() => buildBook(root, { format: "ink" })).toThrow("chapters/Chapter [06].md: chapter file names must be kebab-case to name a knot");
  });

  test("warns about unreachable chapters and still writes them", () => {
    const root = branching();
    chapter(root, "chapter-05", "Nobody gets here.");
    const result = buildBook(root, { format: "ink" });
    expect(messages(result.warnings)).toEqual(["chapters/chapter-05.md cannot be reached: no choice path from chapter-01 leads to it"]);
    expect(read(result.outFile).endsWith("=== chapter_05 ===\nNobody gets here.\n\n-> END\n")).toBe(true);
  });
});

describe("ink on the command line", () => {
  test("builds with --format ink, exits 3 for bad choices, and follows --out write safety", () => {
    const root = branching();
    const cwd = path.dirname(root);
    const io = memoryIo(cwd);
    expect(runCli(["build", root, "--format", "ink", "--out", "adaptations/interactive/gull-rock.ink"], io)).toBe(0);
    expect(io.output()).toBe(`Built 4 chapters as ink to ${path.join(root, "adaptations", "interactive", "gull-rock.ink")}\n`);
    const again = memoryIo(cwd);
    expect(runCli(["build", root, "--format", "ink", "--out", "adaptations/interactive/gull-rock.ink"], again)).toBe(4);
    expect(again.error()).toContain("Refusing to overwrite");

    chapter(root, "chapter-04", "End.", choices(["Try again", "chapter-09"]));
    const bad = memoryIo(root);
    expect(runCli(["build", root, "--format", "ink"], bad)).toBe(3);
    expect(bad.error()).toContain("Cannot build ink until these are fixed:");
  });

  test("story.md cli-defaults can make ink the default build", () => {
    const root = branching();
    setStory(root, "cli-defaults:\n  - command: build\n    format: ink\n");
    const io = memoryIo(root);
    expect(runCli(["build", root], io)).toBe(0);
    expect(io.output()).toContain("as ink to");
  });
});

// Set INKLECATE to an inklecate binary to compile and play the builds above:
// the escaped prose and choices must print exactly as written. CI does not
// install inklecate, so there the text checks above stand alone.
const inklecate = process.env.INKLECATE;

describe.skipIf(!inklecate)("ink compiled with inklecate", () => {
  function play(inkFile, picks) {
    const json = `${inkFile}.json`;
    const compiled = spawnSync(inklecate, ["-o", json, inkFile], { encoding: "utf8" });
    expect(`${compiled.stdout}${compiled.stderr}`).not.toMatch(/ERROR|WARNING/);
    expect(compiled.status).toBe(0);
    return spawnSync(inklecate, ["-p", json], { encoding: "utf8", input: `${picks.join("\n")}\n` }).stdout;
  }

  test("prints every escaped line and choice as written", () => {
    const root = branching();
    chapter(root, "chapter-01", PROSE_CASES.map(([line]) => line).join("\n\n"), choices(...CHOICE_CASES.map(([text]) => [text, "chapter-02"])));
    const output = play(buildBook(root, { format: "ink" }).outFile, ["1", "1"]);
    for (const [line] of PROSE_CASES) {
      expect(output).toContain(`${line.trim()}\n`);
    }
    CHOICE_CASES.forEach(([text], index) => expect(output).toContain(`${index + 1}: ${text}\n`));
    expect(output).toContain("A coat on the ledge.");
  });

  test("returns to a chapter with its choices still offered", () => {
    const output = play(buildBook(branching(), { format: "ink" }).outFile, ["2", "2", "2", "2", "1", "1"]);
    expect(output.split("Tobias on the stair.").length).toBe(3);
    expect(output).toContain("The ship on the reef. THE END.");
    expect(output).not.toContain("RUNTIME ERROR");
  });

  test("accepts the prefixed knot names", () => {
    const root = project();
    chapter(root, "01", "Start.", choices(["Truth", "true"], ["Else", "else"]), 1);
    chapter(root, "true", "True.", choices(["On", "1a-arrival"]), 2);
    chapter(root, "else", "Else.", "", 3);
    chapter(root, "1a-arrival", "Arrived.", "", 4);
    expect(play(buildBook(root, { format: "ink" }).outFile, ["1", "1"])).toContain("\n\n1: Truth\n2: Else\n?> True.\n\n1: On\n?> Arrived.\n");
  });

  test("compiles every example", () => {
    const examples = path.join(import.meta.dir, "..", "examples");
    for (const name of fs.readdirSync(examples)) {
      if (fs.existsSync(path.join(examples, name, "story.md"))) {
        const out = path.join(makeTempDir(), `${name}.ink`);
        buildBook(path.join(examples, name), { format: "ink", out });
        expect(play(out, [])).not.toContain("RUNTIME ERROR");
      }
    }
  });
});

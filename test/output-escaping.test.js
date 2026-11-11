import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { outputText } from "../src/findings.js";
import { createStoryProject } from "../src/story.js";
import { makeTempDir, memoryIo } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// Project text reaches the terminal and a CI log in findings. A project from
// another author must not move the cursor, ring the bell, or start a line of
// its own, such as a forged ::error:: workflow command.
describe("project text in text output", () => {
  test("outputText escapes control characters, separators, and bidirectional marks", () => {
    expect(outputText("a\u001b[31mb\u0007c\u009bd\ne f‮g")).toBe("a\\u001b[31mb\\u0007c\\u009bd\\u000ae\\u2028f\\u202eg");
    expect(outputText("one\ntwo\u001b", { lines: true })).toBe("one\ntwo\\u001b");
    // Text that keeps its lines keeps tabs and the marks right-to-left text
    // needs, and a line cannot start a workflow command.
    expect(outputText("a\tb \u200fשלום\u200e\n  ::error::x\n::warning::y\u202e", { lines: true })).toBe("a\tb \u200fשלום\u200e\n  \\u003a:error::x\n\\u003a:warning::y\\u202e");
    expect(outputText("Café — “quoted”")).toBe("Café — “quoted”");
  });

  test("validate and check print a finding about a hostile value on one escaped line", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Hostile Story" });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    const hostile = "\\u001b[2J\\u0007\\u009b\\n::error file=a::forged";
    fs.writeFileSync(chapter, `---\ntitle: One\nnumber: 1\nstatus: "x${hostile}"\ncharacters:\n  - "y${hostile}"\n---\n\n## Chapter Text\n\nWords.\n`, "utf8");
    for (const [command, prefix] of [["validate", "x"], ["links", "y"], ["check", "x"], ["check", "y"]]) {
      const result = invoke(root, [command]);
      expect(result.code).toBe(1);
      expect(result.err).toContain(`${prefix}\\u001b[2J\\u0007\\u009b\\u000a::error file=a::forged`);
      expect(result.err + result.out).not.toMatch(/[\u0007\u001b\u009b]/);
      expect((result.err + result.out).split("\n").some((line) => line.startsWith("::error"))).toBe(false);
    }
  });

  test("every text command escapes project text, and keeps its own lines", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Hostile Story" });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, '---\ntitle: "One\\u001b[2J\\n::error::TITLE"\nnumber: 1\nstatus: draft\nhook: "h\\u0007\\n::warning::HOOK"\n---\n\n## Chapter Text\n\nWords.\n', "utf8");
    for (const argv of [["report"], ["list", "chapters"], ["grid"], ["next"], ["wordcount"]]) {
      const result = invoke(root, argv);
      const text = result.out + result.err;
      expect(text).not.toMatch(/[\u0007\u001b]/);
      expect(text.split("\n").some((line) => line.trimStart().startsWith("::"))).toBe(false);
      expect(text.split("\n").length).toBeGreaterThan(1);
    }
    expect(invoke(root, ["list", "chapters"]).out).toContain("One\\u001b[2J");
  });

  test("an error that quotes a story.md value cannot start a workflow command", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Hostile Story" });
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^---\n/, '---\ncli-defaults:\n  - command: "x\\n::error file=story.md::FORGED"\n'));
    const result = invoke(root, ["check"]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("\\u003a:error file=story.md::FORGED");
    expect(result.err.split("\n").some((line) => line.trimStart().startsWith("::"))).toBe(false);
  });
});

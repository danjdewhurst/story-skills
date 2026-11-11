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
});

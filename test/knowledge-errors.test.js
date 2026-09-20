import { describe, expect, test } from "bun:test";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createStoryProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function knowledgeProject() {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title: "Knowledge", force: false });
  const root = created.root;

  writeMarkdown(path.join(root, "characters", "mara-finn.md"), `
name: Mara Finn
role: protagonist
status: alive
`, "# Mara\n");
  return { root, cwd };
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

describe("knowledge CLI errors", () => {
  test("cli errors for an unknown chapter id", () => {
    const { root, cwd } = knowledgeProject();
    const unknown = invoke(cwd, ["knowledge", "mara-finn", "--at", "chapter-09", "--path", root]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("Unknown chapter chapter-09");
  });
});

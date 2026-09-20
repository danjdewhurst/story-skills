import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { makeTempDir, memoryIo } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

describe("skill workflow eval", () => {
  test("first-story workflow reaches a valid, exportable project", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, [
      "init",
      "Eval Story",
      "--genre",
      "mystery",
      "--theme",
      "truth",
      "--synopsis",
      "A compact workflow evaluation story."
    ]).code).toBe(0);

    const root = path.join(cwd, "eval-story");
    const commands = [
      ["add", "character", "Nia Vale", "--path", root, "--role", "protagonist"],
      ["add", "location", "Clock Pier", "--path", root, "--type", "landmark", "--character", "nia-vale"],
      ["add", "faction", "Harbor Watch", "--path", root, "--type", "government", "--member", "nia-vale", "--location", "clock-pier"],
      ["add", "artifact", "Brass Ledger", "--path", root, "--type", "document", "--owner", "nia-vale", "--location", "clock-pier"],
      ["add", "arc", "Ledger Conspiracy", "--path", root, "--type", "main", "--character", "nia-vale", "--theme", "truth"],
      ["add", "chapter", "The Missing Page", "--path", root, "--number", "1", "--pov", "nia-vale", "--location", "clock-pier", "--character", "nia-vale", "--arc", "ledger-conspiracy"],
      ["add", "scene", "Nia Finds The Ledger", "--path", root, "--chapter", "chapter-01", "--scene", "1", "--pov", "nia-vale", "--location", "clock-pier", "--character", "nia-vale", "--arc", "ledger-conspiracy"],
      ["add", "question", "Who removed the page?", "--path", root, "--introduced", "chapter-01", "--character", "nia-vale"],
      ["add", "promise", "The ledger names the traitor", "--path", root, "--planted", "chapter-01", "--arc", "ledger-conspiracy", "--character", "nia-vale"],
      ["add", "term", "Clock Pier", "--path", root, "--category", "place"]
    ];

    for (const command of commands) {
      const result = invoke(cwd, command);
      expect(result.code, result.err).toBe(0);
    }

    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), "Nia found the missing page beneath the clock.\n", "utf8");
    expect(invoke(cwd, ["wordcount", root, "--write"]).out).toContain("Total: 8");
    expect(invoke(cwd, ["validate", root]).err).toContain("Project is valid: 0 errors, 0 warnings");
    expect(invoke(cwd, ["links", root]).err).toContain("Links are valid");
    expect(invoke(cwd, ["next", root]).out).toContain("Draft chapter 2");
    expect(invoke(cwd, ["build", root, "--format", "docx"]).out).toContain("as docx");
  });
});

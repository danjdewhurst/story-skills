import { describe, expect, test } from "bun:test";
import path from "node:path";
import { HELP, resolveRoot, runCli } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { OPTIONS, parseArgs } from "../src/options.js";
import { makeTempDir, memoryIo } from "./helpers.js";

describe("command registry", () => {
  test("every command is well formed and unique", () => {
    const names = COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    for (const command of COMMANDS) {
      expect(command.usage.split(" ")[0]).toBe(command.name);
      expect(["positional", "flag", "none"]).toContain(command.project);
      expect(command.summary.length).toBeGreaterThan(0);
      expect(typeof command.run).toBe("function");
    }
  });

  test("help lists every command and every documented option", () => {
    for (const command of COMMANDS) {
      expect(HELP).toContain(`  ${command.usage}`);
    }
    for (const option of OPTIONS.filter((entry) => entry.help)) {
      expect(HELP).toContain(`--${option.name}${option.value ? ` ${option.value}` : ""}`);
    }
    for (const line of HELP.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  test("options are unique and every hidden alias is repeatable", () => {
    const names = OPTIONS.map((option) => option.name);
    expect(new Set(names).size).toBe(names.length);
    for (const option of OPTIONS.filter((entry) => !entry.help)) {
      expect(option.repeatable).toBe(true);
    }
  });

  test("positional commands take their first argument as the project path", () => {
    const cwd = makeTempDir();
    for (const command of COMMANDS) {
      const parsed = parseArgs([command.name, "book"]);
      const expected = command.project === "positional" ? path.join(cwd, "book") : cwd;
      expect(resolveRoot(cwd, parsed, command.name)).toBe(expected);
    }
  });

  test("commands that create projects refuse --path", () => {
    const cwd = makeTempDir();
    for (const command of COMMANDS.filter((entry) => entry.project === "none")) {
      const io = memoryIo(cwd);
      expect(runCli([command.name, "x", "--path", "."], io)).toBe(1);
      expect(io.error()).toBe(`${command.name} uses --dir for the target directory. --path is the project root for other commands.\n`);
    }
  });
});

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

  test("every command that changes the project in place declares it, so runCli holds the lock", () => {
    // These write only generated files (dist/, --out); init and import
    // lock the folder they fill themselves.
    const generated = ["diagram", "export", "build", "synopsis"];
    // Commands that never write the project. Every other command on a
    // project must declare `writes`, so a new writing command cannot skip
    // this check, and a command here must not declare it.
    const readOnly = ["validate", "links", "continuity", "check", "knowledge", "context", "compare", "similarity", "timeline", "prose", "names", "mentions", "pacing", "clues", "grid", "list", "voices", "series", "report", "next"];
    for (const command of COMMANDS.filter((entry) => entry.project !== "none")) {
      const writing = !generated.includes(command.name) && !readOnly.includes(command.name);
      expect([command.name, command.writes !== undefined]).toEqual([command.name, writing]);
    }
    for (const command of COMMANDS.filter((entry) => entry.writes !== undefined)) {
      expect(command.writes === true || typeof command.writes === "function").toBe(true);
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
      expect(runCli([command.name, "x", "--path", "."], io)).toBe(2);
      expect(io.error()).toBe(`${command.name} uses --dir for the target directory. --path is the project root for other commands.\n`);
    }
  });
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { BUILD_EXTENSIONS, BUILD_FORMAT_ALIASES } from "../src/build.js";
import { COMMANDS } from "../src/commands.js";
import { OPTIONS } from "../src/options.js";

// docs/cli-reference.md is written by hand, so these tests keep its command
// lists in step with the registries the CLI is generated from.
const reference = fs.readFileSync(path.join(import.meta.dir, "..", "docs", "cli-reference.md"), "utf8");
const commandNames = COMMANDS.map((command) => command.name).sort();
const buildFormats = Object.keys(BUILD_EXTENSIONS);

// The text under a heading line, up to the next heading of the same or a
// higher level.
function section(heading) {
  const level = heading.match(/^#+/)[0].length;
  const lines = reference.split("\n");
  const start = lines.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => {
    const match = line.match(/^(#+) /);
    return index > start && match !== null && match[1].length <= level;
  });
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

// The words in backticks, first word of each: `doctor --fix` gives doctor.
function codeWords(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1].split(" ")[0]);
}

function sorted(values) {
  return [...new Set(values)].sort();
}

// Inside the code spans of a markdown table, \| is a literal |.
function unescapeCell(text) {
  return text.replaceAll("\\|", "|");
}

describe("docs/cli-reference.md", () => {
  test("the command summary lists every command, with its usage and section, and no others", () => {
    const rows = [...section("## Command summary").matchAll(/\[`([^`]+)`\]\(#([^)]+)\)/g)];
    const usages = rows.map((match) => unescapeCell(match[1]));
    expect(sorted(usages.map((usage) => usage.split(" ")[0]))).toEqual(commandNames);
    expect(usages.length).toBe(commandNames.length);
    for (const command of COMMANDS) {
      const row = rows.find((match) => match[1].split(" ")[0] === command.name);
      expect(unescapeCell(row[1])).toBe(command.usage);
      expect(row[2]).toBe(command.name);
      expect(reference.split("\n")).toContain(`### ${command.name}`);
    }
  });

  test("the page contents name every command", () => {
    const groups = [...reference.matchAll(/^- \[[^\]]+ commands\]\(#[a-z-]+-commands\): (.+)$/gm)];
    expect(groups.length).toBeGreaterThan(0);
    expect(sorted(groups.flatMap((match) => codeWords(match[1])))).toEqual(commandNames);
  });

  test("the project paths table sorts every command by how it takes its project", () => {
    const rows = section("### Project paths").split("\n").filter((line) => line.startsWith("| `"));
    const byKind = (kind) => sorted(COMMANDS.filter((command) => command.project === kind).map((command) => command.name));
    const cell = (index) => sorted(codeWords(rows[index].split(" | ")[0]));
    expect(rows).toHaveLength(3);
    expect(cell(0)).toEqual(byKind("positional"));
    expect(cell(1)).toEqual(byKind("flag"));
    expect(cell(2)).toEqual(byKind("none"));
  });

  test("the JSON output section names exactly the commands that read --json", () => {
    const paragraph = section("### JSON output").split("\n").find((line) => line.startsWith("`--json` prints"));
    const list = paragraph.slice(paragraph.indexOf("It works on"), paragraph.indexOf("Other commands refuse it"));
    const withJson = COMMANDS.filter((command) => (command.options ?? []).includes("json")).map((command) => command.name);
    expect(sorted(codeWords(list))).toEqual(sorted(withJson));
  });

  test("every build format is in the command summary, the --format help, and the formats table", () => {
    const summaryRow = section("## Command summary").split("\n").find((line) => line.includes("(#build)"));
    const build = section("### build");
    const formatRow = build.split("\n").find((line) => line.startsWith("| `--format <name>` |"));
    const tableFormats = build.split("\n")
      .filter((line) => /^\| `[a-z]+`( with `[^`]+`)? \| `dist\//.test(line))
      .map((line) => line.match(/^\| `([a-z]+)`/)[1]);
    const help = OPTIONS.find((option) => option.name === "format").help.join(" ");
    for (const format of buildFormats) {
      expect(summaryRow).toContain(`\`${format}\``);
      expect(formatRow).toContain(`\`${format}\``);
      expect(help).toMatch(new RegExp(`\\b${format}\\b`));
    }
    for (const [alias, format] of Object.entries(BUILD_FORMAT_ALIASES)) {
      expect(formatRow).toContain(`\`${format}\` (or \`${alias}\`)`);
    }
    expect(sorted(tableFormats)).toEqual(sorted(buildFormats));
    // The row is "| | [`build [path]`](#build) | Build ... | Yes |", so cell 2 is
    // the description.
    const description = summaryRow.split(" | ")[2];
    expect(description).toStartWith("Build ");
    expect(sorted(codeWords(description).filter((word) => !word.startsWith("dist")))).toEqual(sorted(buildFormats));
  });
});

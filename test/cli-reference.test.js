import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { BUILD_EXTENSIONS, BUILD_FORMAT_ALIASES, EXPORT_FILE, MANUSCRIPT_BUILD_FILE, PDF_EXTENSIONS, SHUNN_DOCX_EXTENSION } from "../src/build.js";
import { CONFIG_REPAIR_COMMANDS, runCli } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { OPTIONS, documentedOptions } from "../src/options.js";
import { makeTempDir, memoryIo } from "./helpers.js";

// docs/cli-reference.md, and the CLI facts docs/automation.md repeats, are
// written by hand, so these tests keep their command and option lists in
// step with the registries the CLI is generated from.
const docsDir = path.join(import.meta.dir, "..", "docs");
const readDoc = (name) => fs.readFileSync(path.join(docsDir, name), "utf8");
const reference = readDoc("cli-reference.md");
const automation = readDoc("automation.md");
const commandNames = COMMANDS.map((command) => command.name).sort();
const buildFormats = Object.keys(BUILD_EXTENSIONS);
const documented = OPTIONS.filter((option) => option.help);

// The text under a heading line, up to the next heading of the same or a
// higher level.
function section(heading, text = reference) {
  const level = heading.match(/^#+/)[0].length;
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => {
    const match = line.match(/^(#+) /);
    return index > start && match !== null && match[1].length <= level;
  });
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

// The text of each code span.
function codeSpans(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

// The words in backticks, first word of each: `doctor --fix` gives doctor.
function codeWords(text) {
  return codeSpans(text).map((span) => span.split(" ")[0]);
}

function sorted(values) {
  return [...new Set(values)].sort();
}

// Inside the code spans of a markdown table, \| is a literal |.
function unescapeCell(text) {
  return text.replaceAll("\\|", "|");
}

// The cells of a markdown table row, split at each | that is not \|.
function cells(line) {
  return line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim());
}

// The commands a list of code spans names, each once.
function commandsIn(text) {
  return sorted(codeWords(text).filter((word) => commandNames.includes(word)));
}

// The commands whose registry entry reads --name.
function commandsReading(name) {
  return COMMANDS.filter((command) => (command.options ?? []).includes(name)).map((command) => command.name).sort();
}

// The line of `text` that starts with `start`.
function lineStarting(text, start) {
  const line = text.split("\n").find((entry) => entry.startsWith(start));
  expect(line).toBeDefined();
  return line;
}

// What an Option index row's "Used by" cell names: each command, with the
// entity kinds for a command that has them (`add chapter`, `scene` is add
// with two kinds; a bare `add` is every kind, less any named after "every
// kind except"). "Every command", or "Every command except ...", names all
// or the rest.
function usedBy(cell) {
  const users = {};
  const kindsOf = (command, kinds) => (command.kinds === undefined ? null : kinds);
  const every = cell.match(/^Every command(?: except (.+))?$/);
  if (every !== null) {
    const except = codeWords(every[1] ?? "");
    for (const command of COMMANDS.filter((entry) => !except.includes(entry.name))) {
      users[command.name] = kindsOf(command, Object.keys(command.kinds ?? {}));
    }
  } else {
    let current = null;
    let excluding = false;
    for (const match of cell.matchAll(/every kind except|`([^`]+)`/g)) {
      if (match[1] === undefined) {
        excluding = true;
        continue;
      }
      const [word, kind] = match[1].split(" ");
      const command = COMMANDS.find((entry) => entry.name === word);
      if (command !== undefined) {
        current = command;
        excluding = false;
        users[word] = kindsOf(command, [...(users[word] ?? []), ...(kind === undefined ? Object.keys(command.kinds ?? {}) : [kind])]);
        continue;
      }
      // A bare word after a command is another of its kinds.
      expect({ cell, word, kinds: Array.isArray(users[current?.name]) }).toEqual({ cell, word, kinds: true });
      users[current.name] = excluding ? users[current.name].filter((entry) => entry !== word) : [...users[current.name], word];
    }
  }
  return Object.fromEntries(Object.entries(users).map(([name, kinds]) => [name, kinds === null ? null : sorted(kinds)]));
}

// The commands, and kinds, that read --name, in the shape usedBy returns.
// Every command but init and import reads --path. A flag every kind of add
// reads (--dry-run, --json) is in no kind's list.
function readers(name) {
  const users = {};
  for (const command of COMMANDS) {
    const reads = name === "path" ? command.project !== "none" : (command.options ?? []).includes(name);
    if (!reads) {
      continue;
    }
    if (command.kinds === undefined) {
      users[command.name] = null;
      continue;
    }
    const kinds = Object.keys(command.kinds).filter((kind) => command.kinds[kind].includes(name));
    users[command.name] = sorted(kinds.length > 0 ? kinds : Object.keys(command.kinds));
  }
  return users;
}

function optionIndex() {
  return section("## Option index").split("\n").filter((line) => line.startsWith("| `-")).map(cells);
}

function optionRow(name) {
  const row = optionIndex().find((entry) => entry[0] === `\`--${name}\``);
  expect({ name, row: row !== undefined }).toEqual({ name, row: true });
  return row;
}

// The default output each build gives, keyed by format plus the flag that
// changes it ("docx --shunn"). The codex is a folder, not a file extension.
const DEFAULT_OUTPUTS = {
  ...Object.fromEntries(buildFormats.map((format) => [format, format === "codex" ? "dist/codex/" : `dist/<story-id>.${BUILD_EXTENSIONS[format]}`])),
  "docx --shunn": `dist/<story-id>.${SHUNN_DOCX_EXTENSION}`,
  ...Object.fromEntries(Object.entries(PDF_EXTENSIONS).map(([format, extension]) => [`${format} --pdf`, `dist/<story-id>.${extension}`]))
};

// The rows of a formats table (a first cell such as "`docx` with `--shunn`"
// and a `dist/...` output), keyed as DEFAULT_OUTPUTS is.
function outputRows(text) {
  const rows = {};
  for (const line of text.split("\n").filter((entry) => /^\| `[a-z]+`/.test(entry) && entry.includes("`dist/"))) {
    const spans = codeSpans(cells(line)[0]);
    const flag = spans.find((span) => span.startsWith("--"));
    const key = flag === undefined ? spans[0] : `${spans[0]} ${flag}`;
    expect({ key, repeated: key in rows }).toEqual({ key, repeated: false });
    rows[key] = line;
  }
  return rows;
}

// The runs a docs/automation.md or cli-reference.md bullet names before
// "write": each code span that starts with a command, such as `mentions` or
// `mentions <kind> <id>`.
function streamList(text, marker) {
  const line = text.split("\n").find((entry) => entry.startsWith("- ") && entry.includes(marker));
  expect(line).toBeDefined();
  return sorted(codeSpans(line.slice(0, line.indexOf(" write"))).filter((span) => commandNames.includes(span.split(" ")[0])));
}

// The rows of the "Which commands can report findings" table in
// docs/automation.md: the commands each names, and when they exit 1.
function exitOneRows() {
  const text = section("### Exit codes", automation);
  const table = text.slice(text.indexOf("Which commands can report findings")).split("\n\n")[1];
  return table.split("\n").filter((line) => line.startsWith("| `")).map(cells).map(([commands, when]) => ({ commands: codeSpans(commands), when }));
}

// A copy of examples/the-last-ember, changed by `edit`.
function exampleCopy(edit = () => {}) {
  const root = path.join(makeTempDir(), "the-last-ember");
  fs.cpSync(path.join(import.meta.dir, "..", "examples", "the-last-ember"), root, { recursive: true });
  edit(root);
  return root;
}

// The arguments each run needs besides its project, by the name the docs
// give the run: `mentions` audits every chapter, and `mentions <kind> <id>`
// lists one entity's mentions. compare and similarity read the copy at
// `clean` and a text taken from its chapter, outside the project.
function runArgs(clean) {
  const reference = path.join(path.dirname(clean), "reference.txt");
  fs.copyFileSync(path.join(clean, "chapters", "chapter-01.md"), reference);
  return {
    knowledge: ["kael-voss", "--at", "chapter-01"],
    context: ["chapter-01"],
    compare: ["--against", clean],
    similarity: ["--against", reference],
    names: ["Zed"],
    "mentions <kind> <id>": ["character", "kael-voss"],
    list: ["chapters"],
    diagram: ["relationships"],
    snapshot: ["--list"]
  };
}

// Runs the command a run name starts with on the project at `root`.
function runStory(root, name, args, extra = []) {
  const command = COMMANDS.find((entry) => entry.name === name.split(" ")[0]);
  const io = memoryIo(root);
  const where = command.project === "positional" ? [root] : ["--path", root];
  const code = runCli([command.name, ...where, ...(args[name] ?? []), ...extra], io);
  return { code, out: io.output(), err: io.error() };
}

// The commands that read a project and write nothing by default.
const readOnly = COMMANDS.filter((command) => command.project !== "none" && command.writes !== true).map((command) => command.name);

// GitHub's anchor for a heading.
function anchor(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").replaceAll(" ", "-");
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

  test("each command's usage block names every option the command reads, and no other", () => {
    for (const command of COMMANDS) {
      const text = section(`### ${command.name}`);
      const block = text.match(/^```text\n([\s\S]*?)\n```/m)[1];
      for (const line of block.split("\n")) {
        expect(line).toStartWith(`story ${command.name} `);
      }
      const shown = sorted([...block.matchAll(/--([a-z-]+)/g)].map((match) => match[1]));
      const accepted = [...(command.options ?? []), ...(command.project === "none" ? [] : ["path"])];
      expect({ command: command.name, unknown: shown.filter((name) => !accepted.includes(name)) }).toEqual({ command: command.name, unknown: [] });
      // `[options]` stands for options the section describes in a table or
      // in prose instead, each as `--name`, `--name <value>`, or `--name=value`.
      const expected = documentedOptions(command.options ?? []);
      const described = (name) => new RegExp(`\`--${name}[\` =]`).test(text);
      const missing = block.includes("[options]")
        ? expected.filter((name) => !shown.includes(name) && !described(name))
        : expected.filter((name) => !shown.includes(name));
      expect({ command: command.name, missing }).toEqual({ command: command.name, missing: [] });
    }
  });

  test("Running the CLI lists every way getting-started.md runs the CLI", () => {
    const rows = (text) => text.split("\n").filter((line) => line.startsWith("| "));
    const running = rows(section("## Running the CLI").split("\n\n").find((block) => block.startsWith("| How you have it |")));
    const install = rows(section("## Install the story CLI", readDoc("getting-started.md")).split("\n\n").find((block) => block.startsWith("| Method |")));
    expect(running.length).toBe(install.length);
    const commands = running.flatMap(codeSpans);
    for (const span of install.flatMap(codeSpans)) {
      expect(commands).toContain(span.replace(/ --help$/, " <command>").replace("<skills-directory>", "<skills-dir>"));
    }
    expect(section("## Running the CLI")).not.toMatch(/All (?:two|three|four|five|six|seven|eight|nine|ten) /);
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

  test("the option syntax names every boolean flag and every flag that splits on commas", () => {
    const text = section("### Option syntax");
    const booleans = OPTIONS.filter((option) => option.value === undefined).map((option) => `--${option.name}`);
    const commas = OPTIONS.filter((option) => option.commas).map((option) => `--${option.name}`);
    expect(sorted(codeWords(text.match(/Boolean flags \(([^)]+)\)/)[1]))).toEqual(sorted(booleans));
    expect(sorted(codeWords(text.match(/Only the plural list forms \(([^)]+)\)/)[1]))).toEqual(sorted(commas));
  });

  test("the JSON output section names exactly the commands that read --json", () => {
    const paragraph = section("### JSON output").split("\n").find((line) => line.startsWith("`--json` prints"));
    const list = paragraph.slice(paragraph.indexOf("Every command takes it"), paragraph.indexOf("Nothing is written to stderr"));
    expect(commandNames.filter((name) => !commandsReading("json").includes(name))).toEqual([]);
    expect(commandsIn(list)).toEqual(commandsReading("json"));
  });

  test("the --dry-run section names exactly the commands that read --dry-run", () => {
    const text = section("### Previewing changes with --dry-run");
    const takes = text.split("\n").find((line) => line.includes(" take `--dry-run`."));
    expect(commandsIn(takes.slice(0, takes.indexOf(" take `--dry-run`.")))).toEqual(commandsReading("dry-run"));
  });

  test("the add options-by-kind table lists the options each kind accepts", () => {
    const add = COMMANDS.find((command) => command.name === "add");
    const text = section("### add");
    const table = text.split("Options by kind:")[1];
    for (const [kind, names] of Object.entries(add.kinds)) {
      const row = table.split("\n").find((line) => line.startsWith(`| \`${kind}\` |`));
      // Cell 2 lists the options; the defaults cell may name some too. --id
      // is described once, above the table.
      const flags = codeWords(row.split(" | ")[1]).filter((word) => word.startsWith("--")).map((word) => word.slice(2).split("=")[0]);
      expect(sorted(flags)).toEqual(sorted(documentedOptions(names).filter((name) => name !== "id")));
    }
    const withoutId = Object.keys(add.kinds).filter((kind) => !add.kinds[kind].includes("id"));
    expect(withoutId).toEqual(["chapter", "scene"]);
    expect(text).toContain("Every kind but `chapter` and `scene` also takes `--id`.");
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

  test("the formats tables here and in manuscripts.md give every build's default output", () => {
    for (const text of [section("### build"), section("## Build a book", readDoc("manuscripts.md"))]) {
      const rows = outputRows(text);
      expect(sorted(Object.keys(rows))).toEqual(sorted(Object.keys(DEFAULT_OUTPUTS)));
      for (const [key, output] of Object.entries(DEFAULT_OUTPUTS)) {
        expect({ key, output, listed: rows[key].includes(`\`${output}\``) }).toEqual({ key, output, listed: true });
      }
      expect(rows.markdown).toContain(`\`${MANUSCRIPT_BUILD_FILE}\``);
    }
    expect(lineStarting(section("### export"), "| `--out <file>` |")).toContain(`\`${EXPORT_FILE}\``);
  });

  test("the codes navigation links every codes table, in order", () => {
    const text = section("## Finding codes");
    const nav = text.slice(text.indexOf("**Codes by command**"), text.indexOf("### Codes: "));
    const headings = [...text.matchAll(/^### (Codes: .+)$/gm)].map((match) => anchor(match[1]));
    expect([...nav.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1])).toEqual(headings);
  });

  test("the option index lists every option in help order, with its value, and says which are boolean and repeatable", () => {
    const rows = optionIndex();
    expect(rows.map((row) => codeSpans(row[0]).join(", "))).toEqual([...documented.map((option) => `--${option.name}`), "-h, --help", "-v, --version"]);
    for (const option of documented) {
      const [, value, , notes] = optionRow(option.name);
      expect({ option: option.name, value: unescapeCell(value) }).toEqual({ option: option.name, value: option.value === undefined ? "" : `\`${option.value}\`` });
      expect({ option: option.name, boolean: notes.startsWith("Boolean") }).toEqual({ option: option.name, boolean: option.value === undefined });
      expect({ option: option.name, repeatable: /repeatable/i.test(notes) }).toEqual({ option: option.name, repeatable: option.repeatable === true });
    }
  });

  test("the option index names the commands, and add kinds, that read each option", () => {
    for (const option of documented) {
      expect({ option: option.name, usedBy: usedBy(optionRow(option.name)[2]) }).toEqual({ option: option.name, usedBy: readers(option.name) });
    }
    for (const row of optionIndex().filter((entry) => entry[0].startsWith("`-h`") || entry[0].startsWith("`-v`"))) {
      expect(row[2]).toBe("Any");
    }
  });

  test("the option index names every alias it leaves out, beside the option it stands for", () => {
    const aliases = OPTIONS.filter((option) => !option.help);
    const paragraph = lineStarting(section("## Option index"), "The aliases (");
    expect(sorted(codeWords(paragraph.slice(0, paragraph.indexOf(")"))))).toEqual(sorted(aliases.map((option) => `--${option.name}`)));
    for (const alias of aliases) {
      expect(optionRow(alias.aliasOf)[3]).toContain(`alias \`--${alias.name}\``);
    }
  });
});

describe("docs/automation.md and the CLI reference", () => {
  // The exit code tables say which commands still run with invalid
  // cli-defaults or severity in story.md.
  test("both exit code tables name the commands that run with an invalid cli-defaults or severity", () => {
    for (const text of [section("### Output streams and exit codes"), section("### Exit codes", automation)]) {
      const row = lineStarting(text, "| `3` |");
      expect(commandsIn(row.match(/every command except ([^)]+)\)/)[1])).toEqual(sorted(CONFIG_REPAIR_COMMANDS));
    }
  });

  test("the exit 1 table sorts every command into one row", () => {
    const text = section("### Exit codes", automation);
    const table = text.slice(text.indexOf("Which commands can report findings"));
    const firstCells = table.split("\n\n")[1].split("\n").filter((line) => line.startsWith("| `")).map((line) => cells(line)[0]);
    const spans = firstCells.flatMap(codeSpans);
    const plain = spans.filter((span) => !span.includes(" "));
    expect([...plain].sort()).toEqual(commandNames);
    // A row such as `doctor --fix` names a command with a flag it reads.
    for (const span of spans.filter((entry) => entry.includes(" "))) {
      const [name, flag] = span.split(" ");
      expect(commandsReading(flag.slice(2))).toContain(name);
    }
  });

  test("both name the same commands for each output stream", () => {
    for (const marker of ["to **stderr**", "write their report to stdout"]) {
      expect(streamList(automation, marker)).toEqual(streamList(section("### Output streams and exit codes"), marker));
    }
  });

  // Each command that reads a project and writes nothing by default runs on
  // a copy of an example, and so does each variant runArgs names. One that
  // prints only the summary and findings on stderr must be in the stderr
  // list; one that prints a report on stdout and the summary on stderr, in
  // the report list.
  test("the output stream lists match what each command prints", () => {
    const root = exampleCopy();
    const args = runArgs(root);
    const runs = [...readOnly, ...Object.keys(args).filter((name) => name.includes(" "))];
    const streams = { stderr: [], report: [] };
    const results = {};
    for (const name of runs) {
      results[name] = runStory(root, name, args);
      const { code, out, err } = results[name];
      // A usage or project error prints no summary, which would drop the run
      // from both lists.
      expect({ name, error: code > 1 ? err : null }).toEqual({ name, error: null });
      if (/^[^\n]+: \d+ errors, \d+ warnings, \d+ dismissed$/m.test(err)) {
        streams[out === "" ? "stderr" : "report"].push(name);
      }
    }
    expect(results.similarity.out).toContain("1 shared passage");
    expect(streamList(section("### Output streams and exit codes"), "to **stderr**")).toEqual(sorted(streams.stderr));
    expect(streamList(section("### Output streams and exit codes"), "write their report to stdout")).toEqual(sorted(streams.report));
  });

  test("the exit 1 table's claims about a file that fails to parse hold", () => {
    const args = runArgs(exampleCopy());
    const broken = exampleCopy((root) => fs.writeFileSync(path.join(root, "characters", "zz-broken.md"), "---\nname: A\nname: B\n---\n"));
    const exits = (name, root = broken) => ({ name, code: runStory(root, name, args).code });
    const row = (start) => exitOneRows().find((entry) => entry.when.startsWith(start)).commands;
    for (const name of [...row("A project file cannot be parsed"), ...row("A candidate name clashes")]) {
      expect(exits(name)).toEqual({ name, code: 1 });
    }
    for (const name of row("Never, on a readable project")) {
      expect(exits(name)).toEqual({ name, code: 0 });
    }
    for (const name of row("Never:").filter((entry) => readOnly.includes(entry))) {
      expect(exits(name).code).not.toBe(1);
    }
    // compare stops on any file it would compare, but reports a style sheet
    // or progress log that fails to parse.
    expect(row("`style-sheet.md` or `progress.md` cannot be parsed")).toEqual(["compare"]);
    expect(exits("compare")).toEqual({ name: "compare", code: 3 });
    for (const file of ["style-sheet.md", "progress.md"]) {
      const root = exampleCopy((copy) => fs.writeFileSync(path.join(copy, file), "---\ntype: a\ntype: b\n---\n"));
      expect({ file, ...exits("compare", root) }).toEqual({ file, name: "compare", code: 1 });
    }
  });

  test("the --dry-run notes name the commands that refuse it where they would write nothing", () => {
    const root = exampleCopy();
    const args = runArgs(root);
    const refused = readOnly.filter((name) => commandsReading("dry-run").includes(name)).filter((name) => {
      const { code, err } = runStory(root, name, args, ["--dry-run"]);
      return code === 2 && err.includes("--dry-run");
    });
    expect(refused.length).toBeGreaterThan(0);
    expect(commandsIn(optionRow("dry-run")[3])).toEqual(sorted(refused));
    const sentence = section("### Previewing changes with --dry-run").match(/`--dry-run` is a usage error where the command would write nothing: ([^.]+)\./)[1];
    expect(commandsIn(sentence)).toEqual(sorted(refused));
  });

  test("the JSON output section names the commands that read --json", () => {
    const paragraph = lineStarting(section("### JSON output", automation), "`--json` works on every command:");
    expect(commandsIn(paragraph.slice(0, paragraph.indexOf(" It prints")))).toEqual(commandsReading("json"));
  });
});

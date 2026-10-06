import path from "node:path";
import { COMMANDS } from "./commands.js";
import { NO_OVERRIDES, applyDefaults, findingOverrides, readCliConfig } from "./config.js";
import { failureDiagnostic, writeJsonResult } from "./json.js";
import { documentedOptions, formatOptionsHelp, isBooleanLiteralToken, isTruthy, parseArgs, suggestion, takesValue } from "./options.js";
import { KIND_ALIASES } from "./scan.js";
import { VERSION } from "./version.js";
import { EXIT_CODES, exitCodeFor, projectError, usageError } from "./exit-codes.js";
import { FILE_ERROR_REASONS, portablePath } from "./files.js";

export { isTruthy, parseArgs };

const COMMANDS_BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));
const COMMAND_COLUMN = 21;
const KIND_COLUMN = 14;
const HELP_WIDTH = 80;

// Help is generated from the command and option tables, so a command cannot
// be dispatched without being documented, or documented without being wired.
export const HELP = [
  "Usage: story <command> [options]",
  "",
  "Commands:",
  ...formatCommandsHelp(),
  "",
  "Options:",
  ...formatOptionsHelp(),
  "",
  "Values beginning with a dash may also use the --option=value form.",
  ""
].join("\n");

function formatCommandHelp(command) {
  const options = [...(command.options ?? []), ...(command.project === "none" ? [] : ["path"])];
  return [
    `Usage: story ${command.usage}${options.length > 0 ? " [options]" : ""}`,
    "",
    command.summary.join(" "),
    "",
    ...(command.kinds === undefined ? [] : [...formatKindsHelp(command.kinds, options), ""]),
    "Options:",
    ...formatOptionsHelp(options),
    ""
  ].join("\n");
}

// The options each kind reads, for `story help add`. Aliases such as
// --characters stay out, as in the options list, and the options every kind
// takes are named once.
function formatKindsHelp(kinds, options) {
  const kindOptions = new Set(Object.values(kinds).flat());
  const shared = documentedOptions(options.filter((name) => !kindOptions.has(name))).map((name) => `--${name}`);
  const lines = [`Options by kind (every kind also takes ${shared.slice(0, -1).join(", ")}, and ${shared.at(-1)}):`];
  for (const [kind, names] of Object.entries(kinds)) {
    let line = `  ${kind}`.padEnd(KIND_COLUMN);
    for (const flag of documentedOptions(names).map((name) => `--${name}`)) {
      if (line.length > KIND_COLUMN && line.length + 1 + flag.length > HELP_WIDTH) {
        lines.push(line);
        line = " ".repeat(KIND_COLUMN);
      }
      line += line.length > KIND_COLUMN ? ` ${flag}` : flag;
    }
    lines.push(line);
  }
  return lines;
}

function formatCommandsHelp() {
  const lines = [];
  for (const command of COMMANDS) {
    const head = `  ${command.usage}`;
    const [first, ...rest] = command.summary;
    if (head.length < COMMAND_COLUMN - 1) {
      lines.push(`${head.padEnd(COMMAND_COLUMN)}${first}`);
    } else {
      lines.push(head, `${" ".repeat(COMMAND_COLUMN)}${first}`);
    }
    for (const line of rest) {
      lines.push(`${" ".repeat(COMMAND_COLUMN)}${line}`);
    }
  }
  return lines;
}

// Commands that still run when story.md cli-defaults or severity is invalid,
// ignoring both, because they report the problem: validate lists it, and
// check, report, next, and doctor include it in their checks.
const CONFIG_REPAIR_COMMANDS = new Set(["validate", "check", "report", "next", "doctor"]);

export function runCli(argv, io) {
  let configured = [];
  // A command asked for --json reports a usage error or a failure as a JSON
  // result too, so a script reading stdout always gets one object.
  const jsonCommand = COMMANDS_BY_NAME.get(commandWord(argv));
  const failJson = jsonCommand?.options?.includes("json") && jsonRequested(argv)
    ? (message, exitCode) => writeJsonResult(io, { command: jsonCommand.name, ok: false, exitCode, diagnostics: [failureDiagnostic(message, exitCode, jsonCommand.name)] })
    : null;
  try {
    const named = COMMANDS_BY_NAME.get(argv[0]);
    const parsed = parseArgs(argv, named ? [...(named.options ?? []), ...(named.project === "none" ? [] : ["path"])] : undefined);
    const cwd = io.cwd ?? process.cwd();
    const name = parsed.positionals[0];

    if (parsed.options.version) {
      io.stdout.write(`${VERSION}\n`);
      return EXIT_CODES.ok;
    }

    // `story help <command>` and `story <command> --help` show one
    // command; `story help` and `story --help` show everything.
    const topic = name === "help" ? parsed.positionals[1] : parsed.options.help ? name : undefined;
    // `story help help` is the general usage, as `story help` is.
    const helpTopic = topic === "help" ? undefined : topic;
    if (helpTopic !== undefined && COMMANDS_BY_NAME.has(helpTopic)) {
      io.stdout.write(formatCommandHelp(COMMANDS_BY_NAME.get(helpTopic)));
      return EXIT_CODES.ok;
    }
    if (name === "help" && helpTopic !== undefined) {
      io.stderr.write(`Unknown command: ${helpTopic}${suggestion(helpTopic, [...COMMANDS_BY_NAME.keys()])}\nRun story --help to list commands.\n`);
      return EXIT_CODES.usage;
    }
    if (!name || name === "help" || parsed.options.help) {
      io.stdout.write(HELP);
      return EXIT_CODES.ok;
    }

    const command = COMMANDS_BY_NAME.get(name);
    if (!command) {
      io.stderr.write(`Unknown command: ${name}${suggestion(name, [...COMMANDS_BY_NAME.keys()])}\nRun story --help to list commands.\n`);
      return EXIT_CODES.usage;
    }

    if (command.project === "none" && parsed.options.path !== undefined) {
      io.stderr.write(`${name} uses --dir for the target directory. --path is the project root for other commands.\n`);
      return EXIT_CODES.usage;
    }

    const misuse = commandUsageError(command, parsed);
    if (misuse) {
      if (failJson) {
        return failJson(misuse, EXIT_CODES.usage);
      }
      io.stderr.write(`${misuse}\n`);
      return EXIT_CODES.usage;
    }

    const root = () => resolveRoot(cwd, parsed, name);
    const config = command.project === "none" ? null : projectConfig(command, configRoot(cwd, parsed, root));
    configured = config === null ? [] : applyDefaults(config, name, parsed.options).map((key) => [key, parsed.options[key]]);
    const overrides = config === null ? NO_OVERRIDES : findingOverrides(config);
    return command.run({ parsed, io, cwd, root, overrides, defaulted: new Set(configured.map(([key]) => key)) });
  } catch (error) {
    const message = `${describeError(error, io.cwd ?? process.cwd())}${configuredHint(error, configured)}`;
    const exitCode = exitCodeFor(error);
    if (failJson) {
      return failJson(message, exitCode);
    }
    io.stderr.write(`${message}\n`);
    return exitCode;
  }
}

// The project whose story.md holds the config. A passage piped to `story
// prose -` or `story voices -` takes the place of [path], so the project is
// --path, else the current directory, as for the passage itself.
function configRoot(cwd, parsed, root) {
  return parsed.positionals[1] === "-" ? path.resolve(cwd, lastOptionValue(parsed.options.path) ?? ".") : root();
}

// story.md cli-defaults and severity. An invalid config stops every command
// except the ones that report it, so a typo cannot quietly drop a severity
// promotion a CI job relies on. It exits as an unusable project.
function projectConfig(command, root) {
  const config = readCliConfig(root);
  if (config.errors.length === 0) {
    return config;
  }
  if (CONFIG_REPAIR_COMMANDS.has(command.name)) {
    // The exemptions log is its own file, so it still applies.
    return { defaults: {}, severity: {}, exemptions: config.exemptions, errors: config.errors };
  }
  throw projectError(`Fix cli-defaults or severity in story.md before running story ${command.name} (story validate lists every problem): ${config.errors.join("; ")}`);
}

// When an error names a flag that story.md cli-defaults filled in, or its
// value, say so: the bad value came from there, not the command line.
function configuredHint(error, configured) {
  const message = String(error?.message);
  const named = configured.filter(([key, value]) => message.includes(`--${key}`) || (typeof value === "string" && message.includes(value)));
  return named.length === 0 ? "" : ` (story.md cli-defaults set ${named.map(([key, value]) => (value === true ? `--${key}` : value === false ? `--${key}=false` : `--${key} ${value}`)).join(", ")})`;
}

// The command word, read from the raw arguments so it is known even when
// they fail to parse: the first argument that is neither an option nor an
// option's value (`story --json validate` and `story --path x validate`).
function commandWord(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      return argv[index + 1];
    }
    if (!arg.startsWith("-")) {
      return arg;
    }
    if (arg.startsWith("--") && !arg.includes("=") && takesValue(arg.slice(2))) {
      index += 1;
    }
  }
  return undefined;
}

// Whether argv turns on --json, read from the raw arguments so a parse error
// is still reported as JSON. The last --json wins, as parseArgs keeps it, and
// `--` ends the options.
function jsonRequested(argv) {
  let requested = false;
  for (let index = 0; index < argv.length && argv[index] !== "--"; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      // A flag takes a value only as --json=value, as parseArgs reads it.
      requested = true;
    } else if (arg.startsWith("--json=")) {
      // An invalid value (--json=maybe) is a parse error, reported as JSON.
      requested = isTruthy(arg.slice("--json=".length)) || !isBooleanLiteralToken(arg.slice("--json=".length).trim());
    }
  }
  return requested;
}

// Called for an 'error' event on stdout/stderr or an uncaught exception in
// bin/story.js. A closed pipe (`story prose | head`) exits quietly, keeping
// any exit code already set, like `ls | head`; any other write failure (a
// full disk) gets one line on stderr instead of a stack trace. Anything that
// is not an output error is reported with its stack, as Node would.
export function handleOutputError(error, proc) {
  if (error?.code === "EPIPE") {
    proc.exit(proc.exitCode ?? 0);
    return;
  }
  const reason = FILE_ERROR_REASONS[error?.code];
  const message = error?.syscall === "write" && reason ? `Cannot write output: ${reason}` : error?.stack ?? String(error);
  try {
    proc.stderr.write(`${message}\n`);
  } catch {
    // stderr is gone too; the exit code still reports the failure.
  }
  proc.exit(1);
}

const FILE_ERROR_ACTIONS = { open: "open", scandir: "list", stat: "check", statx: "check", lstat: "check", rename: "replace", mkdir: "create the folder", unlink: "delete", rmdir: "delete", copyfile: "copy", access: "write to", write: "write to", rm: "delete" };

// A file-system error from Node names a syscall and an absolute path; say
// what failed in plain words, with the path relative to where the user is.
// A `reason` on the error (a temporary file's name already taken) stands in
// for FILE_ERROR_REASONS. A `hint` on the error (a rename stopped partway)
// follows the message.
function describeError(error, cwd) {
  const hint = typeof error.hint === "string" ? `. ${error.hint}` : "";
  const reason = typeof error.reason === "string" ? error.reason : FILE_ERROR_REASONS[error.code];
  if (!reason || typeof error.path !== "string") {
    return `${error.message}${hint}`;
  }
  const relativePath = path.relative(cwd, error.path);
  const shown = relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath) ? portablePath(relativePath) : error.path;
  return `Cannot ${FILE_ERROR_ACTIONS[error.syscall] ?? "use"} ${shown}: ${reason}${hint}`;
}

function commandUsageError(command, parsed) {
  const maxArgs = command.args ?? (command.project === "positional" ? 1 : 0);
  const extra = parsed.positionals.slice(1 + maxArgs);
  if (extra.length > 0) {
    const plural = extra.length === 1 ? "" : "s";
    return `Unexpected argument${plural} for story ${command.usage}: ${extra.join(" ")}`;
  }
  const allowed = new Set(command.options ?? []);
  if (command.project !== "none") {
    allowed.add("path");
  }
  for (const key of Object.keys(parsed.options)) {
    if (key !== "help" && key !== "version" && !allowed.has(key)) {
      return `--${key} does not apply to story ${command.name}`;
    }
  }
  return kindUsageError(command, parsed) ?? emptyPathError(command, parsed);
}

// A command with `kinds` reads its first argument as an entity kind, and an
// option only other kinds read does not apply: `story add scene` refuses
// --number rather than ignore it. An unknown kind is left for the command to
// report.
function kindUsageError(command, parsed) {
  const word = String(parsed.positionals[1] ?? "").trim().toLowerCase();
  if (command.kinds === undefined || !Object.hasOwn(KIND_ALIASES, word)) {
    return null;
  }
  const kind = KIND_ALIASES[word];
  const kindOptions = new Set(Object.values(command.kinds).flat());
  const stray = Object.keys(parsed.options).find((key) => kindOptions.has(key) && !command.kinds[kind].includes(key));
  return stray === undefined ? null : `--${stray} does not apply to story ${command.name} ${kind}: story help ${command.name} lists the options each kind reads`;
}

// An empty project path, such as `--path "$UNSET"`, would quietly mean the
// current directory, so it is refused, as an empty --out is.
function emptyPathError(command, parsed) {
  if (parsed.options.path !== undefined && String(lastOptionValue(parsed.options.path)).trim() === "") {
    return "--path cannot be empty: give the project folder, or leave --path out to use the current directory";
  }
  if (command.project === "positional" && parsed.positionals[1]?.trim() === "") {
    return "The project path cannot be empty: give the project folder, or leave it out to use the current directory";
  }
  return null;
}

function lastOptionValue(value) {
  return Array.isArray(value) ? value[value.length - 1] : value;
}

export function resolveRoot(cwd, parsed, name) {
  const flagPath = lastOptionValue(parsed.options.path);
  if (COMMANDS_BY_NAME.get(name)?.project !== "positional") {
    return path.resolve(cwd, flagPath ?? ".");
  }
  const positionalPath = parsed.positionals[1];
  if (positionalPath !== undefined && flagPath !== undefined) {
    const resolvedPositional = path.resolve(cwd, positionalPath);
    const resolvedFlag = path.resolve(cwd, flagPath);
    if (resolvedPositional !== resolvedFlag) {
      throw usageError(`Conflicting project paths: ${positionalPath} and --path ${flagPath}. Use either a positional path or --path, not both.`);
    }
    return resolvedFlag;
  }
  return path.resolve(cwd, flagPath ?? positionalPath ?? ".");
}

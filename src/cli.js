import path from "node:path";
import { COMMANDS } from "./commands.js";
import { diagnostic, writeJsonResult } from "./json.js";
import { formatOptionsHelp, isTruthy, parseArgs, suggestion } from "./options.js";
import { VERSION } from "./version.js";

export { isTruthy, parseArgs };

const COMMANDS_BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));
const COMMAND_COLUMN = 21;

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
    "Options:",
    ...formatOptionsHelp(options),
    ""
  ].join("\n");
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

export function runCli(argv, io) {
  const named = COMMANDS_BY_NAME.get(argv[0]);
  // A command asked for --json reports a usage error or a failure as a JSON
  // result too, so a script reading stdout always gets one object.
  const failJson = named?.options?.includes("json") && jsonRequested(argv)
    ? (message) => writeJsonResult(io, { command: named.name, ok: false, diagnostics: [diagnostic("error", message, named.name)] })
    : null;
  try {
    const parsed = parseArgs(argv, named ? [...(named.options ?? []), ...(named.project === "none" ? [] : ["path"])] : undefined);
    const cwd = io.cwd ?? process.cwd();
    const name = parsed.positionals[0];

    if (parsed.options.version) {
      io.stdout.write(`${VERSION}\n`);
      return 0;
    }

    // `story help <command>` and `story <command> --help` show one
    // command; `story help` and `story --help` show everything.
    const topic = name === "help" ? parsed.positionals[1] : parsed.options.help ? name : undefined;
    // `story help help` is the general usage, as `story help` is.
    const helpTopic = topic === "help" ? undefined : topic;
    if (helpTopic !== undefined && COMMANDS_BY_NAME.has(helpTopic)) {
      io.stdout.write(formatCommandHelp(COMMANDS_BY_NAME.get(helpTopic)));
      return 0;
    }
    if (name === "help" && helpTopic !== undefined) {
      io.stderr.write(`Unknown command: ${helpTopic}${suggestion(helpTopic, [...COMMANDS_BY_NAME.keys()])}\nRun story --help to list commands.\n`);
      return 1;
    }
    if (!name || name === "help" || parsed.options.help) {
      io.stdout.write(HELP);
      return 0;
    }

    const command = COMMANDS_BY_NAME.get(name);
    if (!command) {
      io.stderr.write(`Unknown command: ${name}${suggestion(name, [...COMMANDS_BY_NAME.keys()])}\nRun story --help to list commands.\n`);
      return 1;
    }

    if (command.project === "none" && parsed.options.path !== undefined) {
      io.stderr.write(`${name} uses --dir for the target directory. --path is the project root for other commands.\n`);
      return 1;
    }

    const usageError = commandUsageError(command, parsed);
    if (usageError) {
      if (failJson) {
        return failJson(usageError);
      }
      io.stderr.write(`${usageError}\n`);
      return 1;
    }

    return command.run({ parsed, io, cwd, root: () => resolveRoot(cwd, parsed, name) });
  } catch (error) {
    const message = describeError(error, io.cwd ?? process.cwd());
    if (failJson) {
      return failJson(message);
    }
    io.stderr.write(`${message}\n`);
    return 1;
  }
}

// Whether argv turns on --json, read from the raw arguments so a parse error
// is still reported as JSON. The last --json wins, as parseArgs keeps it, and
// `--` ends the options.
function jsonRequested(argv) {
  let requested = false;
  for (let index = 0; index < argv.length && argv[index] !== "--"; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      requested = !/^(false|0|no|off)$/i.test(argv[index + 1] ?? "");
    } else if (arg.startsWith("--json=")) {
      requested = !/^(false|0|no|off)$/i.test(arg.slice("--json=".length).trim());
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

const FILE_ERROR_REASONS = {
  EACCES: "permission denied",
  EPERM: "permission denied",
  ENOENT: "no such file or folder",
  EISDIR: "it is a folder, not a file",
  ENOTDIR: "a part of the path is not a folder",
  EROFS: "the file system is read-only",
  ENOSPC: "no space left on the device",
  ENAMETOOLONG: "the name is too long",
  EDQUOT: "the disk quota is exceeded",
  EFBIG: "the file is too large",
  EIO: "an input/output error",
  EBUSY: "the file is in use"
};
const FILE_ERROR_ACTIONS = { open: "open", scandir: "list", stat: "check", statx: "check", lstat: "check", rename: "replace", mkdir: "create the folder", unlink: "delete", rmdir: "delete", copyfile: "copy", access: "write to", write: "write to", rm: "delete" };

// A file-system error from Node names a syscall and an absolute path; say
// what failed in plain words, with the path relative to where the user is.
// A `hint` on the error (a rename stopped partway) follows the message.
function describeError(error, cwd) {
  const hint = typeof error.hint === "string" ? `. ${error.hint}` : "";
  const reason = FILE_ERROR_REASONS[error.code];
  if (!reason || typeof error.path !== "string") {
    return `${error.message}${hint}`;
  }
  const relativePath = path.relative(cwd, error.path);
  const shown = relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath) ? relativePath : error.path;
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
      throw new Error(`Conflicting project paths: ${positionalPath} and --path ${flagPath}. Use either a positional path or --path, not both.`);
    }
    return resolvedFlag;
  }
  return path.resolve(cwd, flagPath ?? positionalPath ?? ".");
}

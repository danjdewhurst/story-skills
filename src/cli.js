import path from "node:path";
import { COMMANDS } from "./commands.js";
import { formatOptionsHelp, isTruthy, parseArgs } from "./options.js";
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
  try {
    const parsed = parseArgs(argv);
    const cwd = io.cwd ?? process.cwd();
    const name = parsed.positionals[0];

    if (parsed.options.version) {
      io.stdout.write(`${VERSION}\n`);
      return 0;
    }

    if (!name || name === "help" || parsed.options.help) {
      io.stdout.write(HELP);
      return 0;
    }

    const command = COMMANDS_BY_NAME.get(name);
    if (!command) {
      io.stderr.write(`Unknown command: ${name}\n\n${HELP}`);
      return 1;
    }

    if (command.project === "none" && parsed.options.path !== undefined) {
      io.stderr.write(`${name} uses --dir for the target directory. --path is the project root for other commands.\n`);
      return 1;
    }

    return command.run({ parsed, io, cwd, root: () => resolveRoot(cwd, parsed, name) });
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
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

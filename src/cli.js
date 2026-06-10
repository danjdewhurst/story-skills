import path from "node:path";
import {
  buildBook,
  computeWordCounts,
  createEntity,
  createStoryProject,
  exportManuscript,
  formatActionReport,
  formatDoctorReport,
  formatProjectReport,
  migrateProject,
  projectReport,
  projectActions,
  reindexProject,
  removeEntity,
  renameEntity,
  validateLinks,
  validateProject
} from "./story.js";

const HELP = `Usage: story <command> [options]

Commands:
  init <title>       Scaffold a story project
  validate [path]    Check project structure, frontmatter, and registries
  reindex [path]     Rebuild registry tables from markdown files
  wordcount [path]   Count chapter prose words
  links [path]       Check cross-reference targets and backlinks
  report [path]      Summarize project inventory, progress, and checks
  next [path]        Recommend the next writing and maintenance actions
  doctor [path]      Show health checks plus actionable repair steps
  migrate [path]     Upgrade a project to the current schema
  add <kind> <name>  Create an entity file and reindex registries
  rename <kind> <id> <name>
                    Rename an entity and update id references
  remove <kind> <id>
                    Remove an entity and scrub id references
  export [path]      Combine chapters into a manuscript markdown file
  build [path]       Build a disposable book artifact in dist/

Options:
  --dir <path>              Target directory for init
  --genre <name>            Story genre for init
  --sub-genre <name>        Story sub-genre for init
  --setting-era <name>      Setting era for init
  --theme <name>            Add a theme for init; repeatable
  --themes <a,b>            Add comma-separated themes for init
  --pov <style>             POV style for init
  --tense <tense>           Narrative tense for init
  --synopsis <text>         Starter synopsis for init
  --force                   Allow init to overwrite starter files
  --write                   Update chapter word-count frontmatter
  --path <path>             Target story root for add/rename/remove
  --out <file>              Output path for export/build
  --format <name>           Output format for build (markdown, epub, docx)
  --actionable              Include next actions in report
  --number <n>              Chapter number for add chapter
  --chapter <id>            Chapter id for add scene or continuity records
  --scene <n>               Scene number for add scene
  --type <name>             Entity type for add
  --role <name>             Character role for add character
  --status <name>           Entity status for add
  --location <id>           Location reference for add
  --character <id>          Character reference for add; repeatable
  --member <id>             Faction member reference for add faction; repeatable
  --owner <id>              Owner reference for add artifact
  --arc <id>                Arc reference for add; repeatable
  --introduced <id>         Chapter id for add question
  --resolved <id>           Chapter id for add question
  --planted <id>            Chapter id for add promise
  --payoff <id>             Chapter id for add promise
  --category <name>         Category for add term
  --alias <name>            Alias for add term; repeatable
  -h, --help                Show this help

Option values that begin with a dash must use the --option=value form.
`;

export function runCli(argv, io) {
  const parsed = parseArgs(argv);
  const cwd = io.cwd ?? process.cwd();
  const command = parsed.positionals[0];

  try {
    if (!command || command === "help" || parsed.options.help) {
      io.stdout.write(HELP);
      return 0;
    }

    if (command === "init") {
      const title = parsed.positionals.slice(1).join(" ");
      const result = createStoryProject({
        title,
        cwd,
        dir: parsed.options.dir,
        genre: parsed.options.genre,
        subGenre: parsed.options["sub-genre"],
        settingEra: parsed.options["setting-era"],
        themes: collectThemes(parsed.options),
        pov: parsed.options.pov,
        tense: parsed.options.tense,
        synopsis: parsed.options.synopsis,
        force: Boolean(parsed.options.force)
      });
      io.stdout.write(`Created story project: ${result.root}\n`);
      return 0;
    }

    const root = path.resolve(cwd, parsed.positionals[1] ?? ".");
    if (command === "validate") {
      return reportResult(io, validateProject(root), "Project is valid");
    }

    if (command === "links") {
      return reportResult(io, validateLinks(root), "Links are valid");
    }

    if (command === "report") {
      io.stdout.write(formatProjectReport(projectReport(root), { actionable: Boolean(parsed.options.actionable) }));
      return 0;
    }

    if (command === "next") {
      io.stdout.write(formatActionReport(projectActions(root)));
      return 0;
    }

    if (command === "doctor") {
      io.stdout.write(formatDoctorReport(projectActions(root)));
      return 0;
    }

    if (command === "migrate") {
      const result = migrateProject(root);
      io.stdout.write(result.changed.length === 0
        ? "Project already uses the current schema\n"
        : `Migrated project to current schema: ${result.changed.length} changes\n`);
      return 0;
    }

    if (command === "add") {
      const result = createEntity(targetRoot(cwd, parsed), {
        ...parsed.options,
        kind: parsed.positionals[1],
        name: parsed.positionals.slice(2).join(" ")
      });
      io.stdout.write(`Created ${result.kind} ${result.id}: ${result.file}\n`);
      return 0;
    }

    if (command === "rename") {
      const result = renameEntity(targetRoot(cwd, parsed), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2],
        name: parsed.positionals.slice(3).join(" ")
      });
      io.stdout.write(`Renamed ${result.kind} ${result.oldId} to ${result.id}: ${result.file}\n`);
      return 0;
    }

    if (command === "remove") {
      const result = removeEntity(targetRoot(cwd, parsed), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2]
      });
      io.stdout.write(`Removed ${result.kind} ${result.id}: ${result.file}\n`);
      return 0;
    }

    if (command === "reindex") {
      const result = reindexProject(root);
      io.stdout.write(result.changed.length === 0
        ? "Registries already up to date\n"
        : `Updated ${result.changed.length} registries\n`);
      return 0;
    }

    if (command === "wordcount") {
      const result = computeWordCounts(root, { write: Boolean(parsed.options.write) });
      for (const chapter of result.chapters) {
        io.stdout.write(`${chapter.file}: ${chapter.wordCount}\n`);
      }
      io.stdout.write(`Total: ${result.total}\n`);
      return 0;
    }

    if (command === "export") {
      const result = exportManuscript(root, { out: parsed.options.out });
      io.stdout.write(`Exported ${result.chapters} chapters to ${result.outFile}\n`);
      return 0;
    }

    if (command === "build") {
      const result = buildBook(root, {
        out: parsed.options.out,
        format: parsed.options.format
      });
      io.stdout.write(`Built ${result.chapters} chapters as ${result.format} to ${result.outFile}\n`);
      return 0;
    }

    io.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    return 1;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

export function parseArgs(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const equalIndex = arg.indexOf("=");
    const key = arg.slice(2, equalIndex === -1 ? undefined : equalIndex);
    const inlineValue = equalIndex === -1 ? undefined : arg.slice(equalIndex + 1);
    const nextValue = argv[index + 1];
    const hasSeparateValue = inlineValue === undefined && nextValue !== undefined && !nextValue.startsWith("-");
    const value = inlineValue ?? (hasSeparateValue ? nextValue : true);

    if (hasSeparateValue) {
      index += 1;
    }

    if (options[key] === undefined) {
      options[key] = value;
    } else {
      options[key] = Array.isArray(options[key]) ? options[key].concat(value) : [options[key], value];
    }
  }

  return { positionals, options };
}

function collectThemes(options) {
  return []
    .concat(options.theme ?? [])
    .concat(options.themes ?? [])
    .filter((value) => value !== undefined && value !== true);
}

function targetRoot(cwd, parsed) {
  return path.resolve(cwd, parsed.options.path ?? ".");
}

function reportResult(io, result, successMessage) {
  const output = result.ok ? io.stdout : io.stderr;
  output.write(`${successMessage}: ${result.errors.length} errors, ${result.warnings.length} warnings\n`);

  for (const error of result.errors) {
    io.stderr.write(`error: ${error}\n`);
  }

  for (const warning of result.warnings) {
    output.write(`warning: ${warning}\n`);
  }

  return result.ok ? 0 : 1;
}

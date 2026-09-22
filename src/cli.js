import path from "node:path";
import { importManuscript } from "./import.js";
import { formatProseReport } from "./prose.js";
import { formatSeriesReport } from "./series.js";
import { VERSION } from "./version.js";
import {
  buildBook,
  checkProjectContinuity,
  computeWordCounts,
  createEntity,
  createStoryProject,
  exportManuscript,
  formatActionReport,
  formatDoctorReport,
  formatProjectReport,
  knowledgeAtChapter,
  migrateProject,
  projectReport,
  projectActions,
  proseReport,
  reindexProject,
  removeEntity,
  renameEntity,
  seriesReport,
  synopsisBook,
  validateLinks,
  validateProject
} from "./story.js";

const HELP = `Usage: story <command> [options]

Commands:
  init <title>       Scaffold a story project
  import <source>    Split an existing manuscript into a new story project
  validate [path]    Check project structure, frontmatter, and registries
  reindex [path]     Rebuild registry tables from markdown files
  wordcount [path]   Count chapter prose words
  links [path]       Check cross-reference targets and backlinks
  continuity [path]  Check deterministic continuity contracts: deaths,
                    promises, questions, casts, and durable state.
                    Findings matching continuity/exemptions.md are
                    reported as dismissed
  knowledge <id>    List what a character knew at a chapter; requires --at
  prose [path]       Lint chapter prose: filter words, adverbs, dialogue
                    tags, echoes, rhythm, repeated phrases, similar
                    names, and style-sheet.md spellings and watch words
  series [path]      Order linked prequels and sequels and check shared
                    canon across books
  report [path]      Summarize project inventory, progress, and checks
  next [path]        Recommend the next writing and maintenance actions
  doctor [path]      Show health checks plus actionable repair steps
  migrate [path]     Upgrade a project to the current schema
  add <kind> <name>  Create an entity file and reindex registries
  rename <kind> <id> <name>
                    Rename an entity and update id references
  remove <kind> <id>
                    Remove an entity and scrub id references
  export [path]      Combine front matter, chapters, and back matter into a
                    manuscript markdown file
  build [path]       Build a disposable book artifact in dist/; EPUB
                    builds use the story.md cover image
  synopsis [path]    Build a deterministic 1- or 3-page synopsis from arcs

Options:
  --title <name>            Story title for import
  --dir <path>              Target directory for init or import
  --genre <name>            Story genre for init
  --sub-genre <name>        Story sub-genre for init
  --setting-era <name>      Setting era for init
  --theme <name>            Theme for init or add arc; repeatable
  --themes <a,b>            Comma-separated themes for init or add arc
  --pov <style>             POV style for init or add chapter/scene
  --tense <tense>           Narrative tense for init
  --synopsis <text>         Starter synopsis for init
  --series <id>             Series id for init
  --book-number <n>         Publication order for init
  --follows <path>          Init a sequel set after this story project;
                            repeatable
  --precedes <path>         Init a prequel set before this story project;
                            repeatable
  --force                   Let init/import use an existing directory: add
                            missing starter files, never overwrite existing ones;
                            import also replaces every chapter-NN.md file
  --write                   Update chapter word-count frontmatter
  --path <path>             Project root for every command except init and import
  --out <file>              Output path for export/build/synopsis
  --format <name>           Output format for build (markdown, epub, docx, shunn)
  --shunn                   Apply Shunn manuscript formatting (with --format docx)
  --at <chapter-id>         Chapter id for knowledge
  --pages <n>               Synopsis length for synopsis (1 or 3)
  --actionable              Include next actions in report
  --number <n>              Chapter number for add chapter
  --chapter <id>            Chapter id for add scene
  --scene <n>               Scene number for add scene
  --type <name>             Entity type for add
  --role <name>             Character role for add character
  --status <name>           Entity status for add
  --mode <name>             Mode for add chapter (e.g. discovered)
  --date <date>             Story date (YYYY-MM-DD) for add chapter/scene
  --time <time>             Story time (HH:MM or dawn, morning, midday, afternoon, evening, night) for add chapter/scene
  --travel-hours <n>        Travel hours for add scene
  --dilemma <text>          Dilemma for add scene sequel unit
  --sequel                  Mark scene as sequel unit for add scene
  --location <id>           Location reference for add
  --character <id>          Character reference for add; repeatable
  --mention <id>            Mentioned character for add chapter/scene; repeatable
  --member <id>             Faction member reference for add faction; repeatable
  --owner <id>              Owner reference for add artifact
  --arc <id>                Arc reference for add (arc theme for add character); repeatable
  --introduced <id>         Chapter id for add question
  --resolved <id>           Chapter id for add question
  --planted <id>            Chapter id for add promise/clue
  --payoff <id>             Chapter id for add promise/clue
  --significance-delayed    Significance is delayed for add clue
  --category <name>         Category for add term
  --alias <name>            Alias for add term; repeatable
  --region <name>           Region for add location
  --population <name>       Population for add location
  --controlled-by <id>      Controlling faction for add location
  --prevalence <name>       Prevalence for add system
  --acts <a,b>              Comma-separated acts for add arc; repeatable
  --placement <front|back>  Placement for add matter (default front)
  --order <n>               Order within its placement for add matter
  --source <text>           Source for add research; repeatable
  --used-in <chapter-id>    Chapter that relies on add research; repeatable
  -h, --help                Show this help
  -v, --version             Show the story CLI version

Values beginning with a dash may also use the --option=value form.
`;

export function runCli(argv, io) {
  try {
    const parsed = parseArgs(argv);
    const cwd = io.cwd ?? process.cwd();
    const command = parsed.positionals[0];

    if (parsed.options.version) {
      io.stdout.write(`${VERSION}\n`);
      return 0;
    }

    if (!command || command === "help" || parsed.options.help) {
      io.stdout.write(HELP);
      return 0;
    }

    if (command === "init") {
      if (parsed.options.path !== undefined) {
        io.stderr.write("init uses --dir for the target directory. --path is the project root for other commands.\n");
        return 1;
      }
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
        series: parsed.options.series,
        bookNumber: parsed.options["book-number"],
        follows: parsed.options.follows,
        precedes: parsed.options.precedes,
        force: isTruthy(parsed.options.force)
      });
      io.stdout.write(`Created story project: ${result.root}\n`);
      for (const linkedBook of result.linkedBooks) {
        io.stdout.write(`Linked series backlink in ${path.join(linkedBook, "story.md")}\n`);
      }
      return 0;
    }

    if (command === "import") {
      if (parsed.options.path !== undefined) {
        io.stderr.write("import uses --dir for the target directory. --path is the project root for other commands.\n");
        return 1;
      }
      const result = importManuscript({
        source: parsed.positionals[1],
        title: parsed.options.title,
        cwd,
        dir: parsed.options.dir,
        genre: parsed.options.genre,
        subGenre: parsed.options["sub-genre"],
        settingEra: parsed.options["setting-era"],
        themes: collectThemes(parsed.options),
        pov: parsed.options.pov,
        tense: parsed.options.tense,
        synopsis: parsed.options.synopsis,
        force: isTruthy(parsed.options.force)
      });
      io.stdout.write(`Imported ${result.chapters} chapters (${result.words} words) into ${result.root}\n`);
      if (result.candidates.length > 0) {
        io.stdout.write("Entity candidates (review, then create with story add):\n");
        for (const candidate of result.candidates) {
          io.stdout.write(`- ${candidate.name} (${candidate.count} mentions)\n`);
        }
      }
      return 0;
    }

    if (command === "validate") {
      const root = resolveRoot(cwd, parsed, command);
      return reportResult(io, validateProject(root), "Project is valid", "Project validation failed");
    }

    if (command === "links") {
      const root = resolveRoot(cwd, parsed, command);
      return reportResult(io, validateLinks(root), "Links are valid", "Link check failed");
    }

    if (command === "continuity") {
      const root = resolveRoot(cwd, parsed, command);
      return reportResult(io, checkProjectContinuity(root), "Continuity is consistent", "Continuity check failed");
    }

    if (command === "knowledge") {
      const characterId = parsed.positionals[1];
      const atChapterId = parsed.options.at;
      if (!characterId || typeof atChapterId !== "string") {
        io.stderr.write("Usage: story knowledge <character-id> --at <chapter-id> [--path <project>]\n");
        return 1;
      }
      const entries = knowledgeAtChapter(resolveRoot(cwd, parsed, command), characterId, atChapterId);
      if (entries.length === 0) {
        io.stdout.write(`No recorded knowledge for ${characterId} at ${atChapterId}\n`);
        return 0;
      }
      for (const entry of entries) {
        const source = entry.learnedIn === "" ? "pre-existing knowledge" : `learned in ${entry.learnedIn}`;
        io.stdout.write(`- ${entry.knows} (${source})\n`);
      }
      return 0;
    }

    if (command === "series") {
      const root = resolveRoot(cwd, parsed, command);
      const report = seriesReport(root);
      io.stdout.write(formatSeriesReport(report));
      return reportResult(io, report, "Series is consistent", "Series check failed");
    }

    if (command === "prose") {
      const root = resolveRoot(cwd, parsed, command);
      const report = proseReport(root);
      io.stdout.write(formatProseReport(report));
      return reportResult(io, report, "Prose check complete", "Prose check failed");
    }

    if (command === "report") {
      const root = resolveRoot(cwd, parsed, command);
      io.stdout.write(formatProjectReport(projectReport(root), { actionable: isTruthy(parsed.options.actionable) }));
      return 0;
    }

    if (command === "next") {
      const root = resolveRoot(cwd, parsed, command);
      io.stdout.write(formatActionReport(projectActions(root)));
      return 0;
    }

    if (command === "doctor") {
      const root = resolveRoot(cwd, parsed, command);
      io.stdout.write(formatDoctorReport(projectActions(root)));
      return 0;
    }

    if (command === "migrate") {
      const root = resolveRoot(cwd, parsed, command);
      const result = migrateProject(root);
      io.stdout.write(result.changed.length === 0
        ? "Project already uses the current schema\n"
        : `Migrated project to current schema: ${result.changed.length} changes\n`);
      return 0;
    }

    if (command === "add") {
      const result = createEntity(resolveRoot(cwd, parsed, command), {
        ...parsed.options,
        kind: parsed.positionals[1],
        name: parsed.positionals.slice(2).join(" ")
      });
      io.stdout.write(`Created ${result.kind} ${result.id}: ${result.file}\n`);
      return 0;
    }

    if (command === "rename") {
      const result = renameEntity(resolveRoot(cwd, parsed, command), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2],
        name: parsed.positionals.slice(3).join(" ")
      });
      io.stdout.write(`Renamed ${result.kind} ${result.oldId} to ${result.id}: ${result.file}\n`);
      return 0;
    }

    if (command === "remove") {
      const result = removeEntity(resolveRoot(cwd, parsed, command), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2]
      });
      io.stdout.write(`Removed ${result.kind} ${result.id}: ${result.file}\n`);
      return 0;
    }

    if (command === "reindex") {
      const root = resolveRoot(cwd, parsed, command);
      const result = reindexProject(root);
      io.stdout.write(result.changed.length === 0
        ? "Registries already up to date\n"
        : `Updated ${result.changed.length} registries\n`);
      return 0;
    }

    if (command === "wordcount") {
      const root = resolveRoot(cwd, parsed, command);
      const result = computeWordCounts(root, { write: isTruthy(parsed.options.write) });
      for (const chapter of result.chapters) {
        io.stdout.write(`${chapter.file}: ${chapter.wordCount}\n`);
      }
      io.stdout.write(`Total: ${result.total}\n`);
      return 0;
    }

    if (command === "export") {
      const root = resolveRoot(cwd, parsed, command);
      const result = exportManuscript(root, { out: parsed.options.out });
      io.stdout.write(`Exported ${result.chapters} chapters to ${result.outFile}\n`);
      return 0;
    }

    if (command === "build") {
      const root = resolveRoot(cwd, parsed, command);
      const result = buildBook(root, {
        out: parsed.options.out,
        format: parsed.options.format,
        shunn: isTruthy(parsed.options.shunn)
      });
      io.stdout.write(`Built ${result.chapters} chapters as ${result.format} to ${result.outFile}\n`);
      return 0;
    }

    if (command === "synopsis") {
      const root = resolveRoot(cwd, parsed, command);
      const result = synopsisBook(root, { pages: parsed.options.pages, out: parsed.options.out });
      if (result.outFile === undefined) {
        io.stdout.write(result.text);
      } else {
        io.stdout.write(`Wrote synopsis to ${result.outFile}\n`);
      }
      return 0;
    }

    io.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    return 1;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

const BOOLEAN_OPTIONS = new Set(["force", "write", "actionable", "significance-delayed", "shunn", "sequel"]);

const VALUE_OPTIONS = new Set([
  "title", "dir", "genre", "sub-genre", "setting-era",
  "theme", "themes", "pov", "tense", "synopsis",
  "series", "book-number", "follows", "precedes",
  "path", "out", "format", "at", "pages",
  "number", "chapter", "scene",
  "type", "role", "status", "mode",
  "date", "time", "travel-hours", "dilemma",
  "location", "locations", "character", "characters",
  "mention", "mentions",
  "member", "members", "owner", "arc", "arcs",
  "introduced", "resolved", "planted", "payoff",
  "category", "alias", "aliases",
  "region", "population", "controlled-by",
  "prevalence", "acts", "act", "placement", "order",
  "source", "sources", "used-in"
]);

// Options that collect every value when repeated. Any other option keeps the
// last value given, so `--out a.md --out b.md` writes b.md.
const REPEATABLE_OPTIONS = new Set([
  "theme", "themes", "follows", "precedes",
  "location", "locations", "character", "characters",
  "mention", "mentions", "member", "members",
  "arc", "arcs", "alias", "aliases", "acts", "act",
  "source", "sources", "used-in"
]);

function isKnownOptionToken(token) {
  if (token === "-h" || token === "-v") {
    return true;
  }
  if (!token.startsWith("--")) {
    return false;
  }
  const equalIndex = token.indexOf("=");
  const key = token.slice(2, equalIndex === -1 ? undefined : equalIndex);
  return key === "help" || key === "version" || BOOLEAN_OPTIONS.has(key) || VALUE_OPTIONS.has(key);
}

function addOption(options, key, value) {
  const stored = BOOLEAN_OPTIONS.has(key) ? normalizeBooleanValue(key, value) : value;
  if (options[key] === undefined || !REPEATABLE_OPTIONS.has(key)) {
    options[key] = stored;
  } else {
    options[key] = Array.isArray(options[key]) ? options[key].concat(stored) : [options[key], stored];
  }
}

function normalizeBooleanValue(key, value) {
  if (typeof value !== "string") {
    return Boolean(value);
  }
  const lower = value.trim().toLowerCase();
  if (lower === "false" || lower === "0" || lower === "no" || lower === "off") {
    return false;
  }
  if (lower === "true" || lower === "1" || lower === "yes" || lower === "on") {
    return true;
  }
  throw new Error(`Unknown value "${value}" for --${key}: expected true or false`);
}

export function isTruthy(value) {
  const current = Array.isArray(value) ? value[value.length - 1] : value;
  if (typeof current === "string") {
    const lower = current.trim().toLowerCase();
    if (lower === "false" || lower === "0" || lower === "no" || lower === "off" || lower === "") {
      return false;
    }
    return true;
  }
  return Boolean(current);
}

function isBooleanLiteralToken(token) {
  return typeof token === "string" && /^(true|false|0|1|yes|no|on|off)$/i.test(token);
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
    if (arg === "-v" || arg === "--version") {
      options.version = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const equalIndex = arg.indexOf("=");
    const key = arg.slice(2, equalIndex === -1 ? undefined : equalIndex);
    const inlineValue = equalIndex === -1 ? undefined : arg.slice(equalIndex + 1);

    if (BOOLEAN_OPTIONS.has(key)) {
      if (inlineValue !== undefined) {
        addOption(options, key, inlineValue);
        continue;
      }
      // Accept a space-separated boolean literal (`--force false`) so it is
      // not mistaken for a positional; anything else stays positional.
      const nextToken = argv[index + 1];
      if (isBooleanLiteralToken(nextToken)) {
        addOption(options, key, nextToken);
        index += 1;
        continue;
      }
      addOption(options, key, true);
      continue;
    }

    if (VALUE_OPTIONS.has(key)) {
      if (inlineValue !== undefined) {
        addOption(options, key, inlineValue);
        continue;
      }
      const nextValue = argv[index + 1];
      if (nextValue === undefined || isKnownOptionToken(nextValue) || nextValue.startsWith("--")) {
        throw new Error(`Missing value for --${key}: expected a value`);
      }
      addOption(options, key, nextValue);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option --${key}`);
  }

  return { positionals, options };
}

function collectThemes(options) {
  return []
    .concat(options.theme ?? [])
    .concat(options.themes ?? [])
    .filter((value) => value !== undefined && value !== true);
}

const PATH_POSITIONAL_COMMANDS = new Set([
  "validate", "links", "continuity", "series", "report", "next",
  "doctor", "migrate", "reindex", "wordcount", "export", "build", "synopsis"
]);

function lastOptionValue(value) {
  return Array.isArray(value) ? value[value.length - 1] : value;
}

export function resolveRoot(cwd, parsed, command) {
  const flagPath = lastOptionValue(parsed.options.path);
  if (!PATH_POSITIONAL_COMMANDS.has(command)) {
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

function reportResult(io, result, successMessage, failureMessage) {
  const dismissed = result.dismissed ?? [];
  io.stderr.write(`${result.ok ? successMessage : failureMessage}: ${result.errors.length} errors, ${result.warnings.length} warnings, ${dismissed.length} dismissed\n`);

  for (const error of result.errors) {
    io.stderr.write(`error: ${error}\n`);
  }

  for (const warning of result.warnings) {
    io.stderr.write(`warning: ${warning}\n`);
  }

  for (const entry of dismissed) {
    io.stderr.write(`dismissed: ${entry.finding} (exemption: ${entry.reason})\n`);
  }

  return result.ok ? 0 : 1;
}

// Every CLI option, in help order. `value` names the argument shown in help
// (boolean flags have none), `repeatable` collects every value given, and
// `help` lists the help lines; options without help are accepted aliases
// (plural forms such as --characters) that stay out of the help text.
export const OPTIONS = [
  { name: "title", value: "<name>", help: ["Story title for import"] },
  { name: "dir", value: "<path>", help: ["Target directory for init or import"] },
  { name: "genre", value: "<name>", help: ["Story genre for init"] },
  { name: "sub-genre", value: "<name>", help: ["Story sub-genre for init"] },
  { name: "setting-era", value: "<name>", help: ["Setting era for init"] },
  { name: "theme", value: "<name>", repeatable: true, help: ["Theme for init or add arc; repeatable"] },
  { name: "themes", value: "<a,b>", repeatable: true, help: ["Comma-separated themes for init or add arc"] },
  { name: "pov", value: "<style>", help: ["POV style for init or add chapter/scene"] },
  { name: "tense", value: "<tense>", help: ["Narrative tense for init"] },
  { name: "synopsis", value: "<text>", help: ["Starter synopsis for init"] },
  { name: "series", value: "<id>", help: ["Series id for init"] },
  { name: "book-number", value: "<n>", help: ["Publication order for init"] },
  { name: "follows", value: "<path>", repeatable: true, help: ["Init a sequel set after this story project;", "repeatable"] },
  { name: "precedes", value: "<path>", repeatable: true, help: ["Init a prequel set before this story project;", "repeatable"] },
  {
    name: "force",
    help: [
      "Let init/import use an existing directory: add",
      "missing starter files, never overwrite existing",
      "ones; import also replaces every chapter-NN.md file"
    ]
  },
  { name: "write", help: ["Update chapter word-count frontmatter"] },
  { name: "log", help: ["Record today's word count in progress.md"] },
  { name: "ref", value: "<git-ref>", help: ["Earlier draft as a git branch, tag, or commit", "for compare"] },
  { name: "against", value: "<path>", help: ["Earlier draft as another project folder for compare"] },
  { name: "path", value: "<path>", help: ["Project root for every command except init and", "import"] },
  { name: "out", value: "<file>", help: ["Output path for export/build/synopsis/diagram"] },
  { name: "format", value: "<name>", help: ["Output format for build (markdown, epub, docx,", "shunn)"] },
  { name: "shunn", help: ["Apply Shunn manuscript formatting (with --format", "docx)"] },
  { name: "at", value: "<chapter-id>", help: ["Chapter id for knowledge"] },
  { name: "init", help: ["Add the default revision passes for passes"] },
  { name: "start", value: "<pass>", help: ["Mark a revision pass in progress for passes"] },
  { name: "done", value: "<pass>", help: ["Mark a revision pass done for passes"] },
  { name: "pages", value: "<n>", help: ["Synopsis length for synopsis (1 or 3)"] },
  { name: "actionable", help: ["Include next actions in report"] },
  { name: "number", value: "<n>", help: ["Chapter number for add chapter"] },
  { name: "chapter", value: "<id>", help: ["Chapter id for add scene"] },
  { name: "scene", value: "<n>", help: ["Scene number for add scene"] },
  { name: "type", value: "<name>", help: ["Entity type for add"] },
  { name: "role", value: "<name>", help: ["Character role for add character"] },
  { name: "status", value: "<name>", help: ["Entity status for add"] },
  { name: "mode", value: "<name>", help: ["Mode for add chapter (e.g. discovered)"] },
  { name: "date", value: "<date>", help: ["Story date (YYYY-MM-DD) for add chapter/scene;", "the session date for progress (default today)"] },
  { name: "time", value: "<time>", help: ["Story time (HH:MM or dawn, morning, midday,", "afternoon, evening, night) for add chapter/scene"] },
  { name: "travel-hours", value: "<n>", help: ["Travel hours for add scene"] },
  { name: "dilemma", value: "<text>", help: ["Dilemma for add scene sequel unit"] },
  { name: "sequel", help: ["Mark scene as sequel unit for add scene"] },
  { name: "outcome", value: "<name>", help: ["Scene outcome for add scene (yes, no, yes-but,", "no-and)"] },
  { name: "hook", value: "<name>", help: ["Chapter-ending hook for add chapter (cliffhanger,", "question, revelation, reversal, decision,", "emotional, resolution)"] },
  { name: "location", value: "<id>", repeatable: true, help: ["Location reference for add"] },
  { name: "locations", value: "<ids>", repeatable: true },
  { name: "character", value: "<id>", repeatable: true, help: ["Character reference for add; repeatable"] },
  { name: "characters", value: "<ids>", repeatable: true },
  { name: "mention", value: "<id>", repeatable: true, help: ["Mentioned character for add chapter/scene;", "repeatable"] },
  { name: "mentions", value: "<ids>", repeatable: true },
  { name: "member", value: "<id>", repeatable: true, help: ["Faction member reference for add faction; repeatable"] },
  { name: "members", value: "<ids>", repeatable: true },
  { name: "owner", value: "<id>", help: ["Owner reference for add artifact"] },
  { name: "arc", value: "<id>", repeatable: true, help: ["Arc reference for add (arc theme for add", "character); repeatable"] },
  { name: "arcs", value: "<ids>", repeatable: true },
  { name: "introduced", value: "<id>", help: ["Chapter id for add question"] },
  { name: "resolved", value: "<id>", help: ["Chapter id for add question"] },
  { name: "planted", value: "<id>", help: ["Chapter id for add promise/clue"] },
  { name: "payoff", value: "<id>", help: ["Chapter id for add promise/clue"] },
  { name: "significance-delayed", help: ["Significance is delayed for add clue"] },
  { name: "red-herring", help: ["Mark add clue as a red herring"] },
  { name: "category", value: "<name>", help: ["Category for add term"] },
  { name: "alias", value: "<name>", repeatable: true, help: ["Alias for add term; repeatable"] },
  { name: "aliases", value: "<names>", repeatable: true },
  { name: "region", value: "<name>", help: ["Region for add location"] },
  { name: "population", value: "<name>", help: ["Population for add location"] },
  { name: "controlled-by", value: "<id>", help: ["Controlling faction for add location"] },
  { name: "prevalence", value: "<name>", help: ["Prevalence for add system"] },
  { name: "acts", value: "<a,b>", repeatable: true, help: ["Comma-separated acts for add arc; repeatable"] },
  { name: "act", value: "<name>", repeatable: true },
  { name: "placement", value: "<front|back>", help: ["Placement for add matter (default front)"] },
  { name: "order", value: "<n>", help: ["Order within its placement for add matter"] },
  { name: "source", value: "<text>", repeatable: true, help: ["Source for add research; repeatable"] },
  { name: "sources", value: "<texts>", repeatable: true },
  { name: "used-in", value: "<chapter-id>", repeatable: true, help: ["Chapter that relies on add research; repeatable"] }
];

const BOOLEAN_OPTIONS = new Set(OPTIONS.filter((option) => option.value === undefined).map((option) => option.name));
const VALUE_OPTIONS = new Set(OPTIONS.filter((option) => option.value !== undefined).map((option) => option.name));
// Any option not marked repeatable keeps the last value given, so
// `--out a.md --out b.md` writes b.md.
const REPEATABLE_OPTIONS = new Set(OPTIONS.filter((option) => option.repeatable).map((option) => option.name));

const OPTION_COLUMN = 28;

export function formatOptionsHelp() {
  const rows = OPTIONS
    .filter((option) => option.help)
    .map((option) => ({ flag: `--${option.name}${option.value ? ` ${option.value}` : ""}`, help: option.help }))
    .concat([
      { flag: "-h, --help", help: ["Show this help"] },
      { flag: "-v, --version", help: ["Show the story CLI version"] }
    ]);
  const lines = [];
  for (const row of rows) {
    const head = `  ${row.flag}`;
    const [first, ...rest] = row.help;
    lines.push(head.length < OPTION_COLUMN ? `${head.padEnd(OPTION_COLUMN)}${first}` : `${head}  ${first}`);
    for (const line of rest) {
      lines.push(`${" ".repeat(OPTION_COLUMN)}${line}`);
    }
  }
  return lines;
}

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

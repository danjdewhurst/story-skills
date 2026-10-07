import path from "node:path";
// validate.js imports this module, and commands.js imports story.js, which
// imports validate.js, so this import is circular. COMMANDS is only read
// inside functions, after every module has finished loading.
import { COMMANDS } from "./commands.js";
import { dismissByExemptions, readExemptionLog } from "./exemptions.js";
import { readTextFile } from "./files.js";
import { FINDING_CODES, PROJECTLESS_CODES, err, severityCodes } from "./findings.js";
import { parseFrontmatter } from "./frontmatter.js";
import { OPTIONS, normalizeBooleanValue, optionFamily, suggestion } from "./options.js";
import { PDF_ENGINES, isPdfEngineName } from "./pdf.js";
import { historyWeeks } from "./progress.js";
import { SHUNN_PAPERS } from "./packaging.js";
import { proseThresholds } from "./prose.js";
import { similarityOptions } from "./similarity.js";

// Optional CLI configuration in story.md frontmatter:
//
//   cli-defaults:            default flags per command; a flag given on the
//     - command: prose       command line always wins
//       max-adverbs: 8
//   severity:                promote a named warning to an error, or turn it
//     - warning: todo-markers  off (it is then reported as dismissed)
//       level: error

export const SEVERITY_LEVELS = ["error", "warning", "off"];

// The warning codes a severity entry can name.
export { severityCodes };

// Commands that act on named entities: a default would send every run to the
// same target, so cli-defaults refuses them. Each run is about one entity, so
// their flags (split --at and --title, move --number, rename --id) are refused
// with the command rather than one by one: a story-wide default for them
// makes no sense, and story split chapter-01 with no --at still fails with a
// usage error instead of splitting where a default says.
const TARGETED_COMMANDS = new Set(["knowledge", "add", "rename", "move", "remove", "split", "merge"]);

// Flags that name one target or one moment rather than a habit.
const TARGETED_FLAGS = { passes: ["start", "done"], progress: ["date"], next: ["date"] };

// Flags that change what one run does rather than set a habit: a default
// --force would replace every snapshot whose name is taken, a default
// --list or --restore would stop snapshot taking one, a default
// --include-pending would put uncleared matter in every build, the
// published review copy too, a default --query would refuse every
// story list of another kind, and an anonymous manuscript is for one
// blind market, not every submission.
const ONE_RUN_FLAGS = { snapshot: ["force", "list", "id", "restore"], export: ["include-pending"], build: ["include-pending", "anonymous"], list: ["query"] };

// Flags that only make sense together. When the command line gives any of a
// group, the defaults for the whole group are dropped: `story build --format
// epub` must not pick up a default --trim meant for --format print, and
// `story compare --against` must not pick up a default --ref.
const LINKED_FLAGS = {
  build: [["format", "shunn", "trim", "stamp", "note-url", "pdf"]],
  compare: [["ref", "against", "snapshot"]],
  similarity: [["against", "snapshot"]]
};

const EMPTY_CONFIG = Object.freeze({ defaults: {}, severity: {}, exemptions: [], errors: [] });

// The config for a project, read from its story.md, with the usable entries
// of continuity/exemptions.md. A missing or unreadable story.md gives an
// empty config: the command reports that problem itself. It is read as
// validate reads it, so a story.md that is a FIFO or a symlink to /dev/zero
// is refused here too rather than hanging every command.
export function readCliConfig(root) {
  let data;
  try {
    data = parseFrontmatter(readTextFile(path.join(root, "story.md"))).data;
  } catch {
    return EMPTY_CONFIG;
  }
  return { ...parseCliConfig(data), exemptions: readExemptionLog(root) };
}

export function validateCliConfig(data, errors) {
  errors.push(...parseCliConfig(data).errors.map((message) => err("invalid-cli-config", message, "story.md")));
}

export function parseCliConfig(data) {
  const errors = [];
  const defaults = parseDefaults(data["cli-defaults"], errors);
  const severity = parseSeverity(data.severity, errors);
  return { defaults, severity, errors };
}

function parseDefaults(raw, errors) {
  const defaults = {};
  for (const [index, item] of listItems(raw, "cli-defaults", errors)) {
    const label = `story.md cli-defaults[${index}]`;
    if (typeof item.command !== "string" || item.command.trim() === "") {
      errors.push(`${label} must name a command`);
      continue;
    }
    const name = item.command.trim();
    const command = COMMANDS.find((entry) => entry.name === name);
    if (command === undefined) {
      errors.push(`${label} names unknown command ${name}${suggestion(name, COMMANDS.map((entry) => entry.name))}`);
      continue;
    }
    if (command.project === "none") {
      errors.push(`${label} names ${name}, which creates a project and cannot take defaults from one`);
      continue;
    }
    if (TARGETED_COMMANDS.has(name)) {
      errors.push(`${label} names ${name}, which acts on named entities and cannot take defaults`);
      continue;
    }
    if (Object.hasOwn(defaults, name)) {
      errors.push(`${label} repeats command ${name}: put all its defaults in one entry`);
      continue;
    }
    defaults[name] = parseCommandDefaults(command, item, label, errors);
    // The prose and similarity thresholds and progress --weeks are checked
    // here too, so story validate catches a bad one before a CI run of the
    // command does.
    const thresholds = { prose: proseThresholds, similarity: similarityOptions, progress: historyWeeks }[name];
    if (thresholds !== undefined) {
      try {
        thresholds(defaults[name]);
      } catch (error) {
        errors.push(`${label}: ${error.message}`);
      }
    }
  }
  return defaults;
}

function parseCommandDefaults(command, item, label, errors) {
  const accepted = command.options ?? [];
  const values = {};
  for (const [key, value] of Object.entries(item)) {
    if (key === "command") {
      continue;
    }
    const option = OPTIONS.find((entry) => entry.name === key);
    if (key === "json") {
      errors.push(`${label} sets json, which changes the output a script reads: pass --json on the command line`);
    } else if (key === "dry-run") {
      errors.push(`${label} sets dry-run, which would stop the command changing anything: pass --dry-run on the command line`);
    } else if (key === "path") {
      errors.push(`${label} sets path: the project is the folder story.md is in`);
    } else if (!accepted.includes(key)) {
      errors.push(`${label} sets ${key}, which story ${command.name} does not accept${suggestion(key, accepted)}`);
    } else if ((TARGETED_FLAGS[command.name] ?? []).includes(key)) {
      errors.push(`${label} sets ${key}, which names one target and cannot be a default`);
    } else if ((ONE_RUN_FLAGS[command.name] ?? []).includes(key)) {
      errors.push(`${label} sets ${key}, which belongs to one run: pass --${key} on the command line`);
    } else if (key === "pdf-engine" && !isPdfEngineName(value)) {
      // A path or command here would let a cloned project pick a program
      // for `story build` to run, so a default may only name an engine.
      errors.push(`${label} pdf-engine must name an engine (${PDF_ENGINES.map((engine) => engine.name).join(", ")}); give the path to one with --pdf-engine on the command line`);
    } else if (key === "paper" && !SHUNN_PAPERS.has(String(value).trim().toLowerCase())) {
      errors.push(`${label} paper must be ${[...SHUNN_PAPERS.keys()].join(" or ")}`);
    } else if (option.value === undefined) {
      try {
        values[key] = normalizeBooleanValue(key, typeof value === "boolean" ? value : String(value));
      } catch {
        errors.push(`${label} ${key} must be true or false`);
      }
    } else if ((typeof value === "string" && value.trim() !== "") || typeof value === "number") {
      values[key] = String(value);
    } else {
      errors.push(`${label} ${key} needs a value, such as ${key}: ${option.value.replace(/^<|>$/g, "")}`);
    }
  }
  return values;
}

function parseSeverity(raw, errors) {
  const severity = {};
  const codes = severityCodes();
  for (const [index, item] of listItems(raw, "severity", errors)) {
    const label = `story.md severity[${index}]`;
    const extra = Object.keys(item).filter((key) => key !== "warning" && key !== "level");
    if (extra.length > 0) {
      errors.push(`${label} has ${extra.join(", ")}: an entry takes only warning and level`);
    }
    const code = typeof item.warning === "string" ? item.warning.trim() : "";
    if (code === "") {
      errors.push(`${label} must name a warning`);
      continue;
    }
    // An error means the project is broken, not a matter of house style, so
    // severity cannot demote or silence one.
    if (FINDING_CODES[code] === "error") {
      errors.push(`${label} names ${code}, which is an error: severity changes only warnings`);
      continue;
    }
    if (PROJECTLESS_CODES.includes(code)) {
      errors.push(`${label} names ${code}, which story init or story import reports before there is a story.md to read: severity cannot change it`);
      continue;
    }
    if (!codes.includes(code)) {
      errors.push(`${label} names unknown warning ${code}${suggestion(code, codes)}`);
      continue;
    }
    if (!SEVERITY_LEVELS.includes(item.level)) {
      errors.push(`${label} level must be one of ${SEVERITY_LEVELS.join(", ")}`);
      continue;
    }
    if (Object.hasOwn(severity, code)) {
      errors.push(`${label} repeats warning ${code}`);
      continue;
    }
    severity[code] = item.level;
  }
  return severity;
}

// The [index, mapping] entries of a list-of-mappings field, reporting a
// field that is not a list and items that are not mappings.
function listItems(raw, field, errors) {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push(`story.md frontmatter field ${field} must be a list`);
    return [];
  }
  const items = [];
  raw.forEach((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`story.md ${field}[${index}] must be a mapping, such as - ${field === "severity" ? "warning: todo-markers" : "command: prose"}`);
    } else {
      items.push([index, item]);
    }
  });
  return items;
}

// Fills in a command's configured defaults for the flags the command line did
// not give (an alias, or another flag of a linked group, given on the command
// line counts), and returns the names of the flags it filled in. Only the
// command line drops a group, so `format: html` with `stamp: draft-2` fills
// in both, not just the first.
export function applyDefaults(config, commandName, options) {
  const filled = [];
  const commandLine = { ...options };
  const given = (name) => optionFamily(name).some((member) => commandLine[member] !== undefined);
  for (const [key, value] of Object.entries(config.defaults[commandName] ?? {})) {
    const group = (LINKED_FLAGS[commandName] ?? []).find((flags) => flags.includes(key)) ?? [key];
    if (!group.some(given)) {
      options[key] = value;
      filled.push(key);
    }
  }
  return filled;
}

export const NO_OVERRIDES = Object.freeze({ severity: [], exemptions: [] });

// What a project changes about the warnings every command reports: the
// story.md severity overrides, as [code, level] pairs, and the exemptions
// that name a code. A code names one rule wherever it is checked, so both
// apply to every command that reports that warning. Exemptions with no code
// apply only in story continuity, which dismisses with every entry.
export function findingOverrides(config) {
  return {
    severity: Object.entries(config.severity),
    exemptions: (config.exemptions ?? []).filter((exemption) => exemption.code !== undefined)
  };
}

// Applies a project's overrides to a result's warnings. An exemption that
// matches a warning dismisses it first, so one finding a writer exempted
// stays dismissed even when severity promotes the rest of its code. Then a
// severity override moves the warnings it names: `error` makes them errors
// (so the command exits 1) and `off` reports them as dismissed.
export function applySeverity(result, overrides = NO_OVERRIDES) {
  const exempted = dismissByExemptions(result, overrides.exemptions, { errors: false });
  if (overrides.severity.length === 0) {
    return exempted;
  }
  const levels = new Map(overrides.severity);
  const errors = [...exempted.errors];
  const warnings = [];
  const dismissed = [...(exempted.dismissed ?? [])];
  for (const warning of exempted.warnings) {
    const code = warning.code;
    const level = levels.get(code) ?? "warning";
    if (level === "warning") {
      warnings.push(warning);
    } else if (level === "error") {
      errors.push(warning);
    } else {
      // `reason` is the --json exemption; `note` replaces "exemption:" in text.
      const note = `severity ${code} is off in story.md`;
      dismissed.push({ finding: warning, reason: note, note });
    }
  }
  const promoted = errors.length > exempted.errors.length;
  return { ...exempted, ok: exempted.ok && !promoted, errors, warnings, dismissed };
}

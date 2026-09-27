import fs from "node:fs";
import path from "node:path";
// commands.js imports story.js, which imports this module for validation, so
// the import is circular. COMMANDS is only read inside functions, after every
// module has finished loading.
import { COMMANDS } from "./commands.js";
import { asFinding, codesAt } from "./findings.js";
import { parseFrontmatter } from "./frontmatter.js";
import { OPTIONS, normalizeBooleanValue, optionFamily, suggestion } from "./options.js";
import { proseThresholds } from "./prose.js";

// Optional CLI configuration in story.md frontmatter:
//
//   cli-defaults:            default flags per command; a flag given on the
//     - command: prose       command line always wins
//       max-adverbs: 8
//   severity:                promote a named warning to an error, or turn it
//     - warning: todo-markers  off (it is then reported as dismissed)
//       level: error

export const SEVERITY_LEVELS = ["error", "warning", "off"];

// Commands that act on one named entity: a default would send every run to
// the same target, so cli-defaults refuses them.
const TARGETED_COMMANDS = new Set(["knowledge", "add", "rename", "move", "remove"]);

// Flags that name one target or one moment rather than a habit.
const TARGETED_FLAGS = { passes: ["start", "done"], progress: ["date"] };

// Flags that only make sense together. When the command line gives any of a
// group, the defaults for the whole group are dropped: `story build --format
// epub` must not pick up a default --trim meant for --format print, and
// `story compare --against` must not pick up a default --ref.
const LINKED_FLAGS = {
  build: [["format", "shunn", "trim", "stamp", "note-url"]],
  compare: [["ref", "against"]]
};

const EMPTY_CONFIG = Object.freeze({ defaults: {}, severity: {}, errors: [] });

// The config for a project, read from its story.md. A missing or unreadable
// story.md gives an empty config: the command reports that problem itself.
export function readCliConfig(root) {
  let data;
  try {
    data = parseFrontmatter(fs.readFileSync(path.join(root, "story.md"), "utf8")).data;
  } catch {
    return EMPTY_CONFIG;
  }
  return parseCliConfig(data);
}

export function validateCliConfig(data, errors) {
  errors.push(...parseCliConfig(data).errors);
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
      errors.push(`${label} names ${name}, which acts on one named entity and cannot take defaults`);
      continue;
    }
    if (Object.hasOwn(defaults, name)) {
      errors.push(`${label} repeats command ${name}: put all its defaults in one entry`);
      continue;
    }
    defaults[name] = parseCommandDefaults(command, item, label, errors);
    // The prose thresholds are checked here too, so story validate catches a
    // bad one before a CI run of story prose does.
    if (name === "prose") {
      try {
        proseThresholds(defaults[name]);
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
    } else if (key === "path") {
      errors.push(`${label} sets path: the project is the folder story.md is in`);
    } else if (!accepted.includes(key)) {
      errors.push(`${label} sets ${key}, which story ${command.name} does not accept${suggestion(key, accepted)}`);
    } else if ((TARGETED_FLAGS[command.name] ?? []).includes(key)) {
      errors.push(`${label} sets ${key}, which names one target and cannot be a default`);
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
  const codes = codesAt("warning");
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
// line counts), and returns the names of the flags it filled in.
export function applyDefaults(config, commandName, options) {
  const filled = [];
  const given = (name) => optionFamily(name).some((member) => options[member] !== undefined);
  for (const [key, value] of Object.entries(config.defaults[commandName] ?? {})) {
    const group = (LINKED_FLAGS[commandName] ?? []).find((flags) => flags.includes(key)) ?? [key];
    if (!group.some(given)) {
      options[key] = value;
      filled.push(key);
    }
  }
  return filled;
}

// The severity overrides, as [code, level] pairs. A code names one rule
// wherever it is checked, so an override applies to every command that
// reports that warning.
export function severityFor(config) {
  return Object.entries(config.severity);
}

// Moves warnings a severity override names: `error` makes them errors (so the
// command exits 1) and `off` reports them as dismissed.
export function applySeverity(result, overrides) {
  if (overrides.length === 0) {
    return result;
  }
  const levels = new Map(overrides);
  const errors = [...result.errors];
  const warnings = [];
  const dismissed = [...(result.dismissed ?? [])];
  for (const warning of result.warnings) {
    const code = asFinding(warning).code;
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
  const promoted = errors.length > result.errors.length;
  return { ...result, ok: result.ok && !promoted, errors, warnings, dismissed };
}

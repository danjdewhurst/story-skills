// Project-defined checks: story.md `checks` lists rules of the project's
// own, each a kind and the story list filters that describe a problem:
//
//   checks:
//     - id: chapter-needs-hook
//       kind: chapter
//       where: [status=draft, "!hook"]
//       level: warning
//       message: has no hook
//
// story continuity, and so story check, report every entity of the kind
// that matches all the filters as a finding coded custom-<id>, at the
// entry's level, so story.md severity, continuity/exemptions.md, --strict,
// --json, and the language server treat it as any other finding. The
// filters are the ones story list --where and saved queries take, read and
// matched by the same code. story validate reports the problems with the
// list itself; story continuity skips an entry with an error.

import path from "node:path";
import { CUSTOM_CODE_PREFIX, customFinding, err, warn } from "./findings.js";
import { KEBAB_NAME, isMapping, knownKeysOnce, matchesAll, quoted, readFilterSpec } from "./list.js";
import { oneLine } from "./unicode.js";

// The keys a check takes.
const CHECK_KEYS = ["id", "kind", "where", "level", "message"];

// The levels a check can report at: the two levels a finding has.
export const CHECK_LEVELS = ["error", "warning"];

// A check as messages name it: a kebab-case id as written, anything else by
// its place in the list.
function checkLabel(item, index) {
  return typeof item.id === "string" && KEBAB_NAME.test(item.id) ? `story.md check ${item.id}` : `story.md checks[${index}]`;
}

// The problems with story.md `checks`, as story validate reports them: a
// field that is not a list of mappings, an id used twice, and each entry's
// own errors and warnings (see checkProblems).
export function checkDefinitionFindings(project) {
  const errors = [];
  const warnings = [];
  const raw = project.story.data.checks;
  if (raw === undefined) {
    return { errors, warnings };
  }
  if (!Array.isArray(raw)) {
    errors.push(err("field-not-list", "story.md frontmatter field checks must be a list", "story.md"));
    return { errors, warnings };
  }
  const knownFor = knownKeysOnce(project);
  const seen = new Set();
  raw.forEach((item, index) => {
    if (!isMapping(item)) {
      errors.push(err("field-invalid-items", "story.md frontmatter field checks must contain mappings, such as - id: chapter-needs-hook", "story.md"));
      return;
    }
    const problems = checkProblems(project, item, index, knownFor);
    errors.push(...problems.errors);
    warnings.push(...problems.warnings);
    if (typeof item.id === "string" && seen.has(item.id)) {
      errors.push(err("duplicate-check", `story.md lists check ${KEBAB_NAME.test(item.id) ? item.id : quoted(item.id)} more than once`, "story.md"));
    }
    seen.add(item.id);
  });
  return { errors, warnings };
}

// The problems with one check. Errors, which stop it running: a missing,
// unquoted-number, or non-kebab-case id; a missing or unknown kind; a where
// that is not a list of filters, is empty, or has a filter --where could not
// read; a missing level or one other than error or warning; a missing or
// empty message; and any other key. A warning: a filter on a key the kind
// neither defines nor any of its files sets.
function checkProblems(project, item, index, knownFor) {
  const errors = [];
  const warnings = [];
  const label = checkLabel(item, index);
  const extra = Object.keys(item).filter((key) => !CHECK_KEYS.includes(key));
  if (extra.length > 0) {
    errors.push(err("invalid-check", `${label} has ${extra.join(", ")}: a check takes only id, kind, where, level, and message`, "story.md"));
  }
  if (item.id === undefined) {
    errors.push(err("missing-field", `${label} is missing id`, "story.md"));
  } else if (typeof item.id === "number" || typeof item.id === "boolean") {
    errors.push(err("field-not-text", `${label} id ${String(item.id)} is not text: quote it, such as id: "${String(item.id)}"`, "story.md"));
  } else if (typeof item.id !== "string" || !KEBAB_NAME.test(item.id)) {
    errors.push(err("id-not-kebab", `${label} id ${quoted(item.id)} must be kebab-case, such as chapter-needs-hook`, "story.md"));
  }

  const spec = readFilterSpec(project, item, label, knownFor);
  for (const problem of spec.problems) {
    if (problem.type === "unknown-key") {
      warnings.push(warn("check-unknown-key", problem.message, "story.md"));
    } else {
      errors.push(problem.type === "missing" ? err("missing-field", problem.message, "story.md") : err("invalid-check", problem.message, "story.md"));
    }
  }

  if (item.level === undefined) {
    errors.push(err("missing-field", `${label} is missing level`, "story.md"));
  } else if (!CHECK_LEVELS.includes(item.level)) {
    errors.push(err("invalid-check", `${label} level ${quoted(item.level)} must be error or warning`, "story.md"));
  }

  if (item.message === undefined) {
    errors.push(err("missing-field", `${label} is missing message`, "story.md"));
  } else if (typeof item.message !== "string" || item.message.trim() === "") {
    errors.push(err("invalid-check", `${label} message must be text, such as message: has no hook`, "story.md"));
  }
  return { errors, warnings, spec };
}

// The checks story continuity runs: each entry with no error, in list
// order, with its id, kind entry, filters, level, and message. An id listed
// twice runs once, as its first entry. A story.md that does not parse has
// no checks.
export function usableChecks(project) {
  const raw = project.story.data?.checks;
  if (!Array.isArray(raw)) {
    return [];
  }
  const knownFor = knownKeysOnce(project);
  const checks = [];
  const seen = new Set();
  raw.forEach((item, index) => {
    if (!isMapping(item)) {
      return;
    }
    const problems = checkProblems(project, item, index, knownFor);
    if (problems.errors.length > 0 || seen.has(item.id)) {
      return;
    }
    seen.add(item.id);
    checks.push({ id: item.id, entry: problems.spec.entry, filters: problems.spec.filters, level: item.level, message: oneLine(item.message.trim()) });
  });
  return checks;
}

// The findings story.md checks report: one per entity a check matches, in
// scan order, about the entity's file, as "<file> <message>".
export function customCheckFindings(project) {
  const errors = [];
  const warnings = [];
  for (const check of usableChecks(project)) {
    for (const entity of project[check.entry.collection] ?? []) {
      if (!matchesAll(entity.frontmatter, check.filters)) {
        continue;
      }
      const file = path.relative(project.root, entity.file).split(path.sep).join("/");
      const finding = customFinding(check.id, `${file} ${check.message}`, file);
      (check.level === "error" ? errors : warnings).push(finding);
    }
  }
  return { errors, warnings };
}

// The ids story.md `checks` lists with the level each gives, read without
// checking the rest of the entry: story.md severity and
// continuity/exemptions.md name a check by its code, and story validate
// reports the entry's own problems.
export function definedCheckLevels(data) {
  const levels = new Map();
  if (!Array.isArray(data?.checks)) {
    return levels;
  }
  for (const item of data.checks) {
    if (isMapping(item) && typeof item.id === "string" && KEBAB_NAME.test(item.id) && !levels.has(item.id)) {
      levels.set(item.id, item.level);
    }
  }
  return levels;
}

// The check id a custom-<id> code names.
export function customCodeId(code) {
  return code.slice(CUSTOM_CODE_PREFIX.length);
}

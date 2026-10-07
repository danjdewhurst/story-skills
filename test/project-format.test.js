import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { BUILD_STYLE_PRESETS, HEADING_STYLES, PARAGRAPH_STYLES } from "../src/build-style.js";
import { ERA_DIRECTIONS } from "../src/calendar.js";
import { SEVERITY_LEVELS } from "../src/config.js";
import { COUNT_UNITS, STORY_FORMS } from "../src/forms.js";
import { SCENE_SETTINGS } from "../src/fountain.js";
import { CHAPTER_NUMERALS } from "../src/numerals.js";
import { CHAPTER_HOOKS, SCENE_OUTCOMES } from "../src/pacing.js";
import { PASS_STATUSES } from "../src/passes.js";
import { WEEKDAYS } from "../src/progress.js";
import * as scan from "../src/scan.js";
import { WRITING_MODES } from "../src/typesetting.js";

// docs/project-format.md is written by hand, so these tests keep its
// Allowed values table in step with the lists story validate checks
// values against.
const repoRoot = path.join(import.meta.dir, "..");
const formatDoc = fs.readFileSync(path.join(repoRoot, "docs", "project-format.md"), "utf8");
const validateSource = fs.readFileSync(path.join(repoRoot, "src", "validate.js"), "utf8");

const CONSTANTS = {
  ...scan,
  BUILD_STYLE_PRESETS,
  HEADING_STYLES,
  PARAGRAPH_STYLES,
  ERA_DIRECTIONS,
  SEVERITY_LEVELS,
  COUNT_UNITS,
  STORY_FORMS,
  SCENE_SETTINGS,
  CHAPTER_NUMERALS,
  CHAPTER_HOOKS,
  SCENE_OUTCOMES,
  PASS_STATUSES,
  WEEKDAYS,
  WRITING_MODES
};

// Each row of the Allowed values table, by its Field cell, and the lists
// whose values it gives. The rows validate.js does not check (build-style,
// severity, calendar, and revision passes) are checked in build-style.js,
// config.js, calendar.js, and passes.js.
const ALLOWED = {
  "Story `status`": ["STORY_STATUSES"],
  "Story `tense`": ["STORY_TENSES"],
  "Story `form`": ["STORY_FORMS"],
  "Story `count-unit`": ["COUNT_UNITS"],
  "Story `draft-mode`": ["DRAFT_MODES"],
  "Story `writing-mode`": ["WRITING_MODES"],
  "Story `chapter-numerals`": ["CHAPTER_NUMERALS"],
  "Story `writing-days` (list)": ["WEEKDAYS"],
  "Story `build-style` `preset`": ["BUILD_STYLE_PRESETS"],
  "Story `build-style` `heading-style`": ["HEADING_STYLES"],
  "Story `build-style` `paragraphs`": ["PARAGRAPH_STYLES"],
  "Story `severity` `level`": ["SEVERITY_LEVELS"],
  "Story `calendar` era `direction`": ["ERA_DIRECTIONS"],
  "Revision pass `status`": ["PASS_STATUSES"],
  "Character `role`": ["CHARACTER_ROLES"],
  "Character `status`": ["CHARACTER_STATUSES"],
  "Character `arc-type`": ["CHARACTER_ARC_TYPES"],
  "Location and scene `setting`": ["SCENE_SETTINGS"],
  "Faction `type`": ["FACTION_TYPES"],
  "Faction `status`": ["FACTION_STATUSES"],
  "Artifact `type`": ["ARTIFACT_TYPES"],
  "Artifact `status`": ["ARTIFACT_STATUSES"],
  "State file `object-state` `status`": ["ARTIFACT_STATUSES"],
  "Arc `type`": ["ARC_TYPES"],
  "Arc `status`": ["ARC_STATUSES"],
  "Chapter and scene `status`": ["CHAPTER_STATUSES", "SCENE_STATUSES"],
  "Chapter `mode`": ["DRAFT_MODES"],
  "Chapter `hook`": ["CHAPTER_HOOKS"],
  "Scene `outcome`": ["SCENE_OUTCOMES"],
  "Question `status`": ["QUESTION_STATUSES"],
  "Promise and clue `status`": ["PROMISE_STATUSES", "CLUE_STATUSES"],
  "Glossary `category`": ["TERM_CATEGORIES"],
  "Matter `placement`": ["MATTER_PLACEMENTS"],
  "Matter `permission`": ["MATTER_PERMISSIONS"],
  "Research `status`": ["RESEARCH_STATUSES"],
  "Research `accuracy`": ["RESEARCH_ACCURACY"],
  "Research `confidence`": ["RESEARCH_CONFIDENCE"],
  "Research `method`": ["RESEARCH_METHODS"],
  "Research `risk` (list)": ["RESEARCH_RISKS"],
  "Style sheet `dialect`": ["STYLE_DIALECTS"]
};

// The kind each validate.js function checks, as the Allowed values table
// names it, and the heading of that kind's field table.
const KINDS = {
  validateStoryFrontmatter: "story",
  validateDailyTarget: "story",
  validateCharacters: "character",
  validateLocations: "location",
  validateFactions: "faction",
  validateArtifacts: "artifact",
  validateArcs: "arc",
  validateChapters: "chapter",
  validateScenes: "scene",
  validateContinuityState: "state file",
  validateQuestions: "question",
  validatePromises: "promise",
  validateClues: "clue",
  validateGlossaryTerms: "glossary",
  validateStyleSheet: "style sheet",
  validateResearch: "research",
  validateMatter: "matter"
};

const FIELD_TABLES = {
  story: "## Story file",
  character: "## Characters",
  location: "### Locations",
  faction: "### Factions",
  artifact: "### Artifacts",
  arc: "### Arcs",
  chapter: "## Chapters",
  scene: "## Scenes",
  "state file": "### State file",
  question: "### Questions",
  promise: "### Promises",
  clue: "### Clues",
  glossary: "## Glossary",
  "style sheet": "### Style sheet",
  research: "### Research notes",
  matter: "### Front and back matter"
};

// The checks that report unsupported-value without a list .has() on the
// line before, by function: writing-days reads its weekdays through
// weekdayName.
const OTHER_CHECKS = {
  validateDailyTarget: { field: "writing-days", list: "WEEKDAYS" }
};

// Every value check in validate.js, as { kind, field, list }: each
// validateEnum call, each PROGRESSION_RULES enum, and each unsupported-value
// error raised after a `!LIST.has(value)` test.
function enumChecks() {
  const checks = [];
  let fn = null;
  let key = null;
  const lines = validateSource.split("\n");
  lines.forEach((line, index) => {
    fn = line.match(/^(?:export )?function (\w+)/)?.[1] ?? fn;
    key = line.match(/^ {2}([a-z]+): \{$/)?.[1] ?? key;
    const where = { fn, line: index + 1 };
    for (const match of line.matchAll(/validateEnum\([^,]+, "([^"]+)", ([A-Z][A-Z_]+),/g)) {
      checks.push({ ...where, kind: KINDS[fn], field: match[1], list: match[2] });
    }
    if (line.includes("enums: new Map(")) {
      for (const match of line.matchAll(/\["([^"]+)", ([A-Z][A-Z_]+)\]/g)) {
        checks.push({ ...where, kind: key, field: match[1], list: match[2] });
      }
    }
    if (line.includes('err("unsupported-value"') && fn !== "validateEnum") {
      const has = lines[index - 1].match(/!([A-Z][A-Z_]+)\.has\(([\w.]+)\)/);
      const other = OTHER_CHECKS[fn];
      expect({ ...where, recognised: has !== null || other !== undefined }).toEqual({ ...where, recognised: true });
      checks.push(has === null ? { ...where, kind: KINDS[fn], ...other } : { ...where, kind: KINDS[fn], field: has[2].split(".").pop(), list: has[1] });
    }
  });
  return checks;
}

// The kinds and field an Allowed values row names: "Chapter and scene
// `status`" is chapter and scene, status.
function rowKey(label) {
  return {
    kinds: label.slice(0, label.indexOf("`")).trim().toLowerCase().split(" and "),
    field: [...label.matchAll(/`([^`]+)`/g)].pop()[1]
  };
}

function values(name) {
  const list = CONSTANTS[name];
  expect({ name, defined: list !== undefined }).toEqual({ name, defined: true });
  return [...(list instanceof Map ? list.keys() : list)].sort();
}

// The text under a heading, up to the next heading of the same or a higher
// level.
function section(heading) {
  const level = heading.match(/^#+/)[0].length;
  const lines = formatDoc.split("\n");
  const start = lines.indexOf(heading);
  expect({ heading, start: start >= 0 }).toEqual({ heading, start: true });
  const end = lines.findIndex((line, index) => index > start && /^#+ /.test(line) && line.match(/^#+/)[0].length <= level);
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

// The rows of the Allowed values table, before the status meanings below it.
function allowedRows() {
  return section("## Allowed values").split("\n### ")[0].split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Field |"))
    .map((line) => line.slice(2, -2).split(" | "));
}

describe("docs/project-format.md", () => {
  test("every value check in validate has an Allowed values row for its kind and field that gives its list", () => {
    const checks = enumChecks();
    expect(checks.length).toBeGreaterThan(35);
    for (const check of checks) {
      const rows = Object.keys(ALLOWED).filter((label) => {
        const { kinds, field } = rowKey(label);
        return kinds.includes(check.kind) && field === check.field && ALLOWED[label].includes(check.list);
      });
      expect({ ...check, rows: rows.length }).toEqual({ ...check, rows: 1 });
    }
  });

  test("the Allowed values table gives each list's values, and has no other rows", () => {
    const rows = allowedRows();
    expect(rows.map(([field]) => field)).toEqual(Object.keys(ALLOWED));
    for (const [field, cell] of rows) {
      const shown = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]).sort();
      for (const name of ALLOWED[field]) {
        expect({ field, name, values: shown }).toEqual({ field, name, values: values(name) });
      }
    }
  });

  // A field validate checks against a list is typed enum (or by its values)
  // in its kind's field table, never string.
  test("the field tables do not type a field validate checks against a list as a string", () => {
    for (const { kind, field } of enumChecks()) {
      expect({ kind, table: FIELD_TABLES[kind] !== undefined }).toEqual({ kind, table: true });
      const stringRows = section(FIELD_TABLES[kind]).split("\n").filter((line) => line.startsWith(`| \`${field}\` | string |`));
      expect({ kind, field, stringRows }).toEqual({ kind, field, stringRows: [] });
    }
  });
});

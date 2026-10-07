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
// whose values it gives. Most are the lists validateEnum checks a field
// against; the rest are checked in their own code: object-state status and
// research risk in validate.js, writing-days through progress.js, pass
// status in passes.js, severity level in config.js, build-style in
// build-style.js, and era direction in calendar.js.
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

// The fields validate.js checks with validateEnum, and the list each is
// checked against: [["status", "STORY_STATUSES"], ...].
function enumChecks() {
  return [...validateSource.matchAll(/validateEnum\([^,]+, "([^"]+)", ([A-Z][A-Z_]+),/g)].map((match) => [match[1], match[2]]);
}

function values(name) {
  const list = CONSTANTS[name];
  expect({ name, defined: list !== undefined }).toEqual({ name, defined: true });
  return [...(list instanceof Map ? list.keys() : list)].sort();
}

function allowedRows() {
  const text = formatDoc.slice(formatDoc.indexOf("\n## Allowed values\n"), formatDoc.indexOf("\n### What the status values mean\n"));
  return text.split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Field |"))
    .map((line) => line.slice(2, -2).split(" | "));
}

describe("docs/project-format.md", () => {
  test("every list validate checks a field against has a row in the Allowed values table", () => {
    const checks = enumChecks();
    expect(checks.length).toBeGreaterThan(30);
    const listed = new Set(Object.values(ALLOWED).flat());
    expect(checks.filter(([, name]) => !listed.has(name))).toEqual([]);
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
  // in the field tables, never string. `status` and `type` are left out:
  // they are free text on locations and systems.
  test("the field tables do not type an enum field as a string", () => {
    const fields = [...new Set(enumChecks().map(([field]) => field))].filter((field) => field !== "status" && field !== "type");
    const stringRows = formatDoc.split("\n").filter((line) => fields.some((field) => line.startsWith(`| \`${field}\` | string |`)));
    expect(stringRows).toEqual([]);
  });
});

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFrontmatter } from "../src/frontmatter.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SCHEMA_PATH = path.join(repoRoot, "schemas", "story.schema.json");

const ENTITY_DIRS = [
  ["characters", "characters"],
  ["worldbuilding.locations", "worldbuilding/locations"],
  ["worldbuilding.systems", "worldbuilding/systems"],
  ["worldbuilding.factions", "worldbuilding/factions"],
  ["worldbuilding.artifacts", "worldbuilding/artifacts"],
  ["plot.arcs", "plot/arcs"],
  ["chapters", "chapters"],
  ["scenes", "scenes"],
  ["continuity.questions", "continuity/questions"],
  ["continuity.promises", "continuity/promises"],
  ["continuity.clues", "continuity/clues"],
  ["glossary", "glossary/terms"],
  ["matter", "matter"],
  ["research", "research"]
];

const STATE_KEYS = ["current-chapter", "character-state", "object-state", "knowledge-state"];

function readFrontmatter(filePath) {
  return parseFrontmatter(fs.readFileSync(filePath, "utf8"), filePath).data;
}

function setPath(target, dotted, value) {
  const keys = dotted.split(".");
  let current = target;
  for (const key of keys.slice(0, -1)) {
    current[key] ??= {};
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

// The schema describes one aggregate document rather than individual files:
// story.md frontmatter under `story`, each entity directory as an array of
// frontmatter objects carrying their filename-derived `id`, and the durable
// state from continuity/state.md and continuity/exemptions.md under `continuity`,
// plus the optional style-sheet.md frontmatter under `styleSheet`.
export function buildSchemaDocument(root) {
  const document = {
    story: readFrontmatter(path.join(root, "story.md")),
    characters: [],
    worldbuilding: {},
    plot: {},
    chapters: [],
    scenes: [],
    continuity: {},
    glossary: []
  };

  for (const [key, relativeDir] of ENTITY_DIRS) {
    const directory = path.join(root, relativeDir);
    const entities = !fs.existsSync(directory)
      ? []
      : fs.readdirSync(directory)
          .filter((name) => name.endsWith(".md") && name !== "_index.md")
          .sort()
          // Ids are filename-derived, so a stray frontmatter id never wins.
          .map((name) => ({ ...readFrontmatter(path.join(directory, name)), id: path.basename(name, ".md") }));
    setPath(document, key, entities);
  }

  const statePath = path.join(root, "continuity", "state.md");
  if (fs.existsSync(statePath)) {
    const state = readFrontmatter(statePath);
    for (const key of STATE_KEYS) {
      if (state[key] !== undefined) {
        document.continuity[key] = state[key];
      }
    }
  }

  const exemptionsPath = path.join(root, "continuity", "exemptions.md");
  if (fs.existsSync(exemptionsPath)) {
    const { exemptions } = readFrontmatter(exemptionsPath);
    if (exemptions !== undefined) {
      document.continuity.exemptions = exemptions;
    }
  }

  // The style sheet is optional, so the schema only sees it when present.
  const styleSheetPath = path.join(root, "style-sheet.md");
  if (fs.existsSync(styleSheetPath)) {
    document.styleSheet = readFrontmatter(styleSheetPath);
  }

  return document;
}

function typeOf(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (Number.isInteger(value)) {
    return "integer";
  }
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

function resolveRef(schema, ref) {
  const target = ref.startsWith("#/") ? ref.slice(2).split("/").reduce((node, key) => node?.[key], schema) : undefined;
  if (!target || typeof target !== "object") {
    throw new Error(`Unsupported $ref ${ref}`);
  }
  return target;
}

// Dependency-free validator for the JSON Schema keywords story.schema.json
// uses. Unknown keywords throw so the schema cannot quietly outgrow it.
const SUPPORTED = new Set([
  "$schema", "$id", "$comment", "$defs", "title", "description",
  "$ref", "type", "required", "properties", "items", "enum", "const", "pattern", "minimum", "minLength"
]);

// Walks the whole schema up front, so an unsupported keyword fails even
// under a property or definition that no project data reaches.
export function assertSupportedSchema(schema, root = schema, at = "#") {
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED.has(keyword)) {
      throw new Error(`Unsupported schema keyword ${keyword} at ${at}`);
    }
  }
  if (schema.$ref) {
    resolveRef(root, schema.$ref);
  }
  for (const group of ["$defs", "properties"]) {
    for (const [key, child] of Object.entries(schema[group] ?? {})) {
      assertSupportedSchema(child, root, `${at}/${group}/${key}`);
    }
  }
  if (schema.items) {
    assertSupportedSchema(schema.items, root, `${at}/items`);
  }
}

export function validateAgainstSchema(value, schema, root = schema, at = "$") {
  if (schema === root) {
    assertSupportedSchema(root);
  }
  const errors = [];
  if (schema.$ref) {
    // Keywords beside $ref still apply (draft 2020-12), so keep going.
    errors.push(...validateAgainstSchema(value, resolveRef(root, schema.$ref), root, at));
  }
  if (schema.type && !matchesType(value, schema.type)) {
    return [...errors, `${at}: expected ${schema.type}, got ${typeOf(value)}`];
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${at}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
  }
  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${at}: "${value}" does not match ${schema.pattern}`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: shorter than ${schema.minLength} characters`);
    }
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${at}: ${value} is below the minimum ${schema.minimum}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      const label = item && typeof item === "object" && typeof item.id === "string" ? `${at}[${item.id}]` : `${at}[${index}]`;
      errors.push(...validateAgainstSchema(item, schema.items, root, label));
    });
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) {
        errors.push(`${at}: missing required ${key}`);
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (value[key] !== undefined) {
        errors.push(...validateAgainstSchema(value[key], propertySchema, root, `${at}.${key}`));
      }
    }
  }
  return errors;
}

export function checkProjectSchema(root, schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"))) {
  return validateAgainstSchema(buildSchemaDocument(root), schema);
}

function main() {
  const examplesRoot = path.join(repoRoot, "examples");
  const failures = [];
  const names = fs.readdirSync(examplesRoot).sort()
    .filter((name) => fs.existsSync(path.join(examplesRoot, name, "story.md")));
  for (const name of names) {
    for (const error of checkProjectSchema(path.join(examplesRoot, name))) {
      failures.push(`${name} ${error}`);
    }
  }

  if (failures.length > 0) {
    console.error(`Schema check failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`Examples match schemas/story.schema.json: ${names.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

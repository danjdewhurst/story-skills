// Frontmatter field checks for story validate: the helpers each kind's
// check calls, and the checks of a field across every kind.
import { storyDateError } from "./continuity.js";
import { scalarText } from "./frontmatter.js";
import { nearMissKeys } from "./frontmatter-keys.js";
import { kebabCase } from "./markdown.js";
import { err, warn } from "./findings.js";
import { MULTI_KIND_REFERENCE_FIELDS, relative } from "./scan.js";

// Whether a finding with this text was already reported, so a file that
// fails to parse is not reported twice.
export function hasMessage(findings, message) {
  return findings.some((finding) => finding.message === message);
}

// Free-text and id fields the schema types as strings. An unquoted `1984`
// or `true` parses as a number or boolean, which other YAML tools read as
// such, so validate asks for quotes.
const TEXT_FIELDS = {
  characters: ["pronunciation", "name", "died-in", "revived-in", "arc", "lie", "truth", "ghost-wound"],
  locations: ["pronunciation", "name", "type", "region", "controlled-by", "status"],
  systems: ["pronunciation", "name", "type", "prevalence"],
  factions: ["pronunciation", "name"],
  artifacts: ["pronunciation", "name", "owner", "location"],
  arcs: ["name"],
  chapters: ["title", "pov", "mode", "date", "time", "episode-question", "release-date", "time-skip", "strand", "beat"],
  scenes: ["title", "chapter", "pov", "location", "date", "time", "dilemma", "flashback-to"],
  questions: ["title", "introduced", "resolved"],
  promises: ["title", "planted", "payoff"],
  clues: ["title", "planted", "payoff"],
  glossaryTerms: ["pronunciation", "term"],
  research: ["title"],
  matter: ["title", "rights-holder", "credit"]
};

const STORY_TEXT_FIELDS = ["title", "series", "series-title", "genre", "sub-genre", "setting-era", "pov", "premise", "counter-premise", "author", "surname", "short-title", "season-goal", "language", "publisher", "publication-date", "description", "copyright", "cover-alt", "ai-disclosure", "draft-mode", "cover", "deadline", "release-start"];

export function validateTextFields(project, errors) {
  const check = (label, data, fields) => {
    for (const field of fields) {
      const value = data?.[field];
      if (typeof value === "number" || typeof value === "boolean") {
        // Quote the value as written: `title: True` becomes "True", not "true".
        errors.push(err("field-not-text", `${label} frontmatter field ${field} must be text: quote it as ${field}: "${scalarText(data, field) ?? value}"`, label));
      } else if (Array.isArray(value) && !errors.some((error) => error.file === label && error.message.includes(` ${field} `))) {
        // Another check may already have said the field cannot be a list.
        errors.push(err("field-not-text", `${label} frontmatter field ${field} must be text, not a list`, label));
      }
    }
  };
  if (!project.story.unreadable) {
    check("story.md", project.story.data, STORY_TEXT_FIELDS);
  }
  for (const [collection, fields] of Object.entries(TEXT_FIELDS)) {
    for (const entity of project[collection] ?? []) {
      check(relative(project, entity.file), entity.frontmatter, fields);
    }
  }
}

// Two kinds a reference field can both name (owner: a character or a
// faction) must not share an id, or the reference could mean either one.
// add refuses such an id, so it comes from a file made by hand. `entities`
// holds every kind MULTI_KIND_REFERENCE_FIELDS names.
export function validateSharedIds(project, warnings) {
  const entities = { character: project.characters, faction: project.factions, artifact: project.artifacts };
  const order = Object.keys(entities);
  const pairs = new Map();
  for (const [field, kinds] of Object.entries(MULTI_KIND_REFERENCE_FIELDS)) {
    const named = order.filter((kind) => kinds.includes(kind));
    named.forEach((first, index) => {
      for (const second of named.slice(index + 1)) {
        const key = `${first} ${second}`;
        pairs.set(key, (pairs.get(key) ?? []).concat(field));
      }
    });
  }
  for (const [key, fields] of pairs) {
    const [first, second] = key.split(" ");
    const others = new Map(entities[second].map((entity) => [entity.id, entity]));
    for (const entity of entities[first].filter((item) => others.has(item.id))) {
      const file = relative(project, entity.file);
      warnings.push(warn("shared-id", `${file} and ${relative(project, others.get(entity.id).file)} share the id ${entity.id}, so ${fields.join(" and ")} references to it could mean either, and rename and remove leave them alone: give one of them another id with story rename`, file));
    }
  }
}

export function validatePronunciations(project, errors) {
  const entities = [project.characters, project.locations, project.systems, project.factions, project.artifacts, project.glossaryTerms].flat();
  for (const entity of entities) {
    // A number or boolean is reported by validateTextFields, with the quoted
    // value to write, so it is not reported twice here.
    const value = entity.pronunciation;
    if (value !== undefined && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      errors.push(err("field-not-text", `${relative(project, entity.file)} frontmatter field pronunciation must be text`, relative(project, entity.file)));
    }
  }
}

export function validateEntityId(id, label, errors) {
  if (id !== kebabCase(id)) {
    errors.push(err("id-not-kebab", `${label} filename id must be kebab-case`, label));
  }
}

// A chapter or scene date shaped like YYYY-MM-DD must be a real calendar
// day, or, under a story.md calendar, one that starts with a digit or a
// weekday must be a day of that calendar; story continuity warns about
// other text.
export function validateUnitDate(data, label, calendar, errors) {
  if (typeof data.date !== "string") {
    return;
  }
  const dateError = storyDateError(data.date, { freeText: true, calendar });
  if (dateError !== "") {
    errors.push(err("invalid-date", `${label} ${dateError}`, label));
  }
}

export function requireScalar(data, field, label, errors, file = label) {
  if (data[field] !== undefined && (Array.isArray(data[field]) || typeof data[field] === "object")) {
    errors.push(err("field-not-scalar", `${label} frontmatter field ${field} must be a scalar`, file));
  }
}

export function requireInteger(data, field, label, errors, minimum) {
  if (data[field] === undefined) {
    return;
  }
  if (!Number.isInteger(data[field])) {
    errors.push(err("field-not-integer", `${label} frontmatter field ${field} must be an integer`, label));
  } else if (minimum !== undefined && data[field] < minimum) {
    errors.push(err("field-below-minimum", `${label} frontmatter field ${field} must be at least ${minimum}`, label));
  }
}

export function validateStringArray(data, field, label, errors) {
  if (data[field] === undefined) {
    return;
  }

  if (!Array.isArray(data[field])) {
    errors.push(err("field-not-list", `${label} frontmatter field ${field} must be a list`, label));
    return;
  }

  for (const item of data[field]) {
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(err("field-invalid-items", `${label} frontmatter field ${field} must contain only non-empty strings`, label));
    }
  }
}

// Warns about a key that is a near miss for a known one, such as
// `learned_in`, `Learned-In`, `since_chapter`, or `stauts`, which would
// otherwise be ignored. Keys far from every known one stay allowed as
// custom fields, and so does a near miss whose intended key is also set;
// of several equally close keys, those not set are named.
export function warnNearMissKeys(data, keys, label, warnings, file = label) {
  for (const key of Object.keys(data)) {
    const intended = nearMissKeys(key, keys).filter((candidate) => !Object.hasOwn(data, candidate));
    if (intended.length > 0) {
      warnings.push(warn("near-miss-key", `${label} has ${key}; did you mean ${intended.join(" or ")}?`, file));
    }
  }
}

export function validateObjectArray(data, field, label, errors) {
  if (data[field] === undefined) {
    return;
  }

  if (!Array.isArray(data[field])) {
    errors.push(err("field-not-list", `${label} frontmatter field ${field} must be a list`, label));
    return;
  }

  for (const item of data[field]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(err("field-invalid-items", `${label} frontmatter field ${field} must contain objects`, label));
    }
  }
}

export function validateRelationships(data, label, errors) {
  if (data.relationships === undefined) {
    return;
  }

  if (!Array.isArray(data.relationships)) {
    errors.push(err("field-not-list", `${label} frontmatter field relationships must be a list`, label));
    return;
  }

  for (const relationship of data.relationships) {
    if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
      errors.push(err("field-invalid-items", `${label} frontmatter field relationships must contain objects`, label));
      continue;
    }

    if (typeof relationship.character !== "string" || relationship.character.trim() === "") {
      errors.push(err("missing-field", `${label} relationship is missing character`, label));
    } else if (relationship.character !== kebabCase(relationship.character)) {
      errors.push(err("id-not-kebab", `${label} relationship character ${relationship.character} must be kebab-case`, label));
    }

    if (typeof relationship.type !== "string" || relationship.type.trim() === "") {
      errors.push(err("missing-field", `${label} relationship to ${relationship.character ?? "unknown"} is missing type`, label));
    }
  }
}

export function validateEnum(data, field, allowed, label, errors) {
  if (Array.isArray(data[field])) {
    // requireScalar may already have reported the same field.
    const scalar = `${label} frontmatter field ${field} must be a scalar`;
    if (!hasMessage(errors, scalar)) {
      errors.push(err("field-not-scalar", `${label} frontmatter field ${field} must be a single value, not a list`, label));
    }
  } else if (data[field] !== undefined && !allowed.has(data[field])) {
    errors.push(err("unsupported-value", `${label} frontmatter field ${field} has unsupported value ${data[field]}`, label));
  }
}

export function requireFields(data, fields, label, errors) {
  for (const field of fields) {
    if (data[field] === undefined || (typeof data[field] === "string" && data[field].trim() === "")) {
      errors.push(err("missing-field", `${label} is missing frontmatter field ${field}`, label));
    }
  }
}

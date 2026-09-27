import { idText } from "./continuity.js";
import { kebabCase } from "./markdown.js";

// Timeline-scoped changes to a character, location, or faction. The
// frontmatter describes the entity as the story opens; each `progressions`
// entry says that from a chapter on, `field` holds `value` instead:
//
//   progressions:
//     - from: chapter-07
//       field: status
//       value: missing
//
// So a change in chapter 20 stays out of the picture while chapter 5 is
// drafted. Chapters compare in story time (see chronology.js), the same order
// knowledge-state uses.

// Entity kinds whose frontmatter may carry progressions.
export const PROGRESSION_KINDS = ["character", "location", "faction"];

// Fields a progression may not change: the list itself, the filename id, and
// the character death fields, which continuity reads as chapter references.
const RESERVED_FIELDS = new Set(["progressions", "id", "died-in", "revived-in"]);

// A plain `field` / `value` pair, with the chapter it takes effect from.
function progressionEntry(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const from = idText(item.from);
  const field = typeof item.field === "string" ? item.field : "";
  if (from === "" || field === "" || item.value === undefined || item.value === null) {
    return null;
  }
  return { from, field, value: item.value };
}

function setOwn(target, key, value) {
  // A `__proto__` field stays an own property instead of changing the
  // prototype.
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

// A chapter's place in the story: a written chapter's number, or for a
// chapter not written yet, the number in its planned `chapter-NN` id. NaN
// for anything else.
function chapterPosition(chronology, id) {
  if (chronology.numbers.has(id)) {
    return chronology.numbers.get(id);
  }
  const match = /^chapter-(\d+)$/.exec(id);
  return match && Number(match[1]) > 0 ? Number(match[1]) : Number.NaN;
}

// True when chapter `later` comes strictly after `earlier` in story time.
// Two written chapters use the chronology (dates first, then numbers); a
// planned chapter compares by number, as an undated chapter does, so a change
// planned for chapter 20 stays out of chapter 5 before chapter 20 exists.
function happensAfter(chronology, later, earlier) {
  if (chronology.numbers.has(later) && chronology.numbers.has(earlier)) {
    return chronology.after(later, earlier);
  }
  return chapterPosition(chronology, later) > chapterPosition(chronology, earlier);
}

// Resolves an entity's state at a chapter. `data` is the entity's frontmatter;
// `chronology` is chapterChronology(project). `atChapterId` is a written
// chapter or a planned `chapter-NN`. Every progression taking effect at or
// before it in story time is applied in story order, so a progression from
// the target chapter itself counts. Returns `state`, the frontmatter with
// those values applied and `progressions` left out, and `changes`, one
// { field, value, from, previous } per applied entry, oldest first. Entries
// whose `from` is neither a written nor a planned chapter are skipped
// (`story links` reports them).
export function entityStateAt(data, atChapterId, chronology) {
  if (Number.isNaN(chapterPosition(chronology, atChapterId))) {
    throw new Error(`Unknown chapter ${atChapterId}`);
  }
  const state = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (key !== "progressions") {
      setOwn(state, key, value);
    }
  }
  const entries = (Array.isArray(data?.progressions) ? data.progressions : [])
    .map(progressionEntry)
    .filter((entry) => entry !== null && !Number.isNaN(chapterPosition(chronology, entry.from)) && !happensAfter(chronology, entry.from, atChapterId));
  // Stable, so entries from the same chapter keep their file order.
  entries.sort((left, right) => (happensAfter(chronology, left.from, right.from) ? 1 : happensAfter(chronology, right.from, left.from) ? -1 : 0));
  const changes = [];
  for (const entry of entries) {
    changes.push({ field: entry.field, value: entry.value, from: entry.from, previous: Object.hasOwn(state, entry.field) ? state[entry.field] : undefined });
    setOwn(state, entry.field, entry.value);
  }
  return { state, changes };
}

// Structural checks for one entity's `progressions` list. `rules.lists` names
// the fields that hold lists (a progression value is a single value) and
// `rules.enums` maps a field to its allowed values. Order is checked in story
// time with `chronology`, a planned chapter by its number; whether each
// chapter exists is left to `story links`.
export function validateProgressions(data, label, rules, chronology, errors) {
  if (data.progressions === undefined) {
    return;
  }
  if (!Array.isArray(data.progressions)) {
    errors.push(`${label} frontmatter field progressions must be a list`);
    return;
  }
  const seen = new Map();
  let latest = null;
  for (const [index, item] of data.progressions.entries()) {
    const entryLabel = `${label} progressions[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${entryLabel} must be a mapping with from, field, and value`);
      continue;
    }
    const from = idText(item.from);
    if (from === "") {
      errors.push(`${entryLabel} is missing from (the chapter the change takes effect)`);
    }
    const field = item.field;
    let fieldOk = false;
    if (typeof field !== "string" || field.trim() === "") {
      errors.push(`${entryLabel} is missing field`);
    } else if (field !== kebabCase(field)) {
      errors.push(`${entryLabel} field ${field} must be kebab-case`);
    } else if (RESERVED_FIELDS.has(field)) {
      errors.push(`${entryLabel} cannot change ${field}${field === "died-in" || field === "revived-in" ? "; set it on the character and story continuity reads it by chapter" : ""}`);
    } else if (rules.lists.has(field)) {
      errors.push(`${entryLabel} cannot change ${field}, which is a list; a progression holds a single value`);
    } else {
      fieldOk = true;
    }
    const value = item.value;
    if (value === undefined || value === null) {
      errors.push(`${entryLabel} is missing value`);
    } else if (typeof value === "object") {
      errors.push(`${entryLabel} value must be a single value, not a list or mapping`);
    } else if (fieldOk && rules.enums.has(field) && !rules.enums.get(field).has(value)) {
      errors.push(`${entryLabel} ${field} has unsupported value ${value}`);
    }

    if (from !== "" && fieldOk) {
      const key = `${from}\u0000${field}`;
      if (seen.has(key)) {
        errors.push(`${entryLabel} repeats ${field} from ${from} (progressions[${seen.get(key)}])`);
      } else {
        seen.set(key, index);
      }
    }
    if (Number.isNaN(chapterPosition(chronology, from))) {
      continue;
    }
    if (latest && happensAfter(chronology, latest.from, from)) {
      errors.push(`${entryLabel} from ${from} comes before progressions[${latest.index}] from ${latest.from} in the story; list progressions in story order`);
      continue;
    }
    latest = { from, index };
  }
}

// One line per applied progression, for `story knowledge --at`.
export function formatStateChanges(changes, atChapterId) {
  if (changes.length === 0) {
    return "";
  }
  const lines = [`State at ${atChapterId}:`];
  for (const change of changes) {
    const previous = change.previous === undefined ? "" : `, was ${change.previous}`;
    lines.push(`- ${change.field}: ${change.value === "" ? "(cleared)" : change.value} (from ${change.from}${previous})`);
  }
  return `${lines.join("\n")}\n`;
}

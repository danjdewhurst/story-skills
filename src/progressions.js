import { plannedChapterNumber } from "./chronology.js";
import { idText } from "./continuity.js";
import { usageError } from "./exit-codes.js";
import { err } from "./findings.js";
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
export function progressionEntry(item) {
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
  return chronology.numbers.has(id) ? chronology.numbers.get(id) : plannedChapterNumber(id);
}

// True when chapter `later` comes strictly after `earlier` in story time.
// Two written chapters use the chronology (dates first, then numbers); a
// planned chapter compares by number, as an undated chapter does, so a change
// planned for chapter 20 stays out of chapter 5 before chapter 20 exists.
export function happensAfter(chronology, later, earlier) {
  if (chronology.numbers.has(later) && chronology.numbers.has(earlier)) {
    return chronology.after(later, earlier);
  }
  return chapterPosition(chronology, later) > chapterPosition(chronology, earlier);
}

// Whether chapter `earlier` happens at or before `later` in story time. In a
// branching book two chapters on sibling branches are neither, so a change
// on one branch stays off the other.
export function happensAtOrBefore(chronology, earlier, later) {
  if (chronology.numbers.has(later) && chronology.numbers.has(earlier) && chronology.atOrBefore) {
    return chronology.atOrBefore(earlier, later);
  }
  return !happensAfter(chronology, earlier, later);
}

// A `progressions` list in story order, stable, so entries from the same
// chapter keep their file order. Entries with no known chapter keep their
// place relative to each other at the end. Used by `story move chapter`,
// which can move a chapter past another entry's.
export function sortProgressions(list, chronology) {
  const known = [];
  const unknown = [];
  for (const item of list) {
    const from = item && typeof item === "object" && !Array.isArray(item) ? idText(item.from) : "";
    (Number.isNaN(chapterPosition(chronology, from)) ? unknown : known).push({ item, from });
  }
  known.sort((left, right) => chronology.compare(left.from, right.from));
  return [...known, ...unknown].map((entry) => entry.item);
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
    throw usageError(`Unknown chapter ${atChapterId}`);
  }
  const state = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (key !== "progressions") {
      setOwn(state, key, value);
    }
  }
  const entries = (Array.isArray(data?.progressions) ? data.progressions : [])
    .map(progressionEntry)
    .filter((entry) => entry !== null && !Number.isNaN(chapterPosition(chronology, entry.from)) && happensAtOrBefore(chronology, entry.from, atChapterId));
  // Stable, so entries from the same chapter keep their file order.
  entries.sort((left, right) => chronology.compare(left.from, right.from));
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
    errors.push(err("field-not-list", `${label} frontmatter field progressions must be a list`, label));
    return;
  }
  const seen = new Map();
  let latest = null;
  for (const [index, item] of data.progressions.entries()) {
    const entryLabel = `${label} progressions[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(err("entry-not-mapping", `${entryLabel} must be a mapping with from, field, and value`, label));
      continue;
    }
    const from = idText(item.from);
    if (from === "") {
      errors.push(err("missing-field", `${entryLabel} is missing from (the chapter the change takes effect)`, label));
    }
    const field = item.field;
    let fieldOk = false;
    if (typeof field !== "string" || field.trim() === "") {
      errors.push(err("missing-field", `${entryLabel} is missing field`, label));
    } else if (field !== kebabCase(field)) {
      errors.push(err("id-not-kebab", `${entryLabel} field ${field} must be kebab-case`, label));
    } else if (RESERVED_FIELDS.has(field)) {
      errors.push(err("progression-fixed-field", `${entryLabel} cannot change ${field}${field === "died-in" || field === "revived-in" ? "; set it on the character and story continuity reads it by chapter" : ""}`, label));
    } else if (rules.lists.has(field)) {
      errors.push(err("progression-list-field", `${entryLabel} cannot change ${field}, which is a list; a progression holds a single value`, label));
    } else {
      fieldOk = true;
    }
    const value = item.value;
    if (value === undefined || value === null) {
      errors.push(err("missing-field", `${entryLabel} is missing value`, label));
    } else if (typeof value === "object") {
      errors.push(err("field-not-scalar", `${entryLabel} value must be a single value, not a list or mapping`, label));
    } else if (fieldOk && rules.enums.has(field) && !rules.enums.get(field).has(value)) {
      errors.push(err("unsupported-value", `${entryLabel} ${field} has unsupported value ${value}`, label));
    }

    if (from !== "" && fieldOk) {
      const key = `${from}\u0000${field}`;
      if (seen.has(key)) {
        errors.push(err("progression-duplicate", `${entryLabel} repeats ${field} from ${from} (progressions[${seen.get(key)}])`, label));
      } else {
        seen.set(key, index);
      }
    }
    if (Number.isNaN(chapterPosition(chronology, from))) {
      continue;
    }
    // The list is checked in the book's number order: in a branching book
    // that is the order `story move` sorts it into.
    if (latest && happensAfter(chronology.linear ?? chronology, latest.from, from)) {
      errors.push(err("progression-out-of-order", `${entryLabel} from ${from} comes before progressions[${latest.index}] from ${latest.from} in the story; list progressions in story order`, label));
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

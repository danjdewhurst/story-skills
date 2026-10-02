import base from "./base.js";
import en from "./en.js";

// Language packs: the conventions and word lists the analysis commands use
// for a story's language, from story.md `language`. A pack is plain data
// (./en.js); languagePack() resolves a BCP 47 tag to one, layering the base
// pack, the language's pack, and any more specific packs (fr, then fr-CA).
// A check whose word list the resolved pack lacks is skipped and reported,
// never run with another language's words.

export const DEFAULT_LANGUAGE = "en";

// Every pack, by code. A regional pack (en-GB) is keyed by its full tag in
// lower case and holds only what differs from its language's pack.
const PACKS = new Map([en].map((pack) => [pack.code, pack]));

const TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function isLanguageTag(value) {
  return typeof value === "string" && TAG_PATTERN.test(value.trim());
}

// The language a project's story.md names, or the default when it names
// none or a value that is not a tag (validate reports that one).
export function projectLanguage(storyData) {
  const value = storyData?.language;
  return isLanguageTag(value) ? value.trim() : DEFAULT_LANGUAGE;
}

const RESOLVED = new Map();

// The pack for a BCP 47 tag: `tag` is the tag as given (the skip notes name
// it), `code` the most specific pack found ("und" for the base pack alone).
// Fields of later layers replace earlier ones; `checks` and `labels` merge
// by key. The result is frozen and the same object for the same tag.
export function languagePack(tag = DEFAULT_LANGUAGE) {
  const language = isLanguageTag(tag) ? tag.trim() : DEFAULT_LANGUAGE;
  if (!RESOLVED.has(language)) {
    RESOLVED.set(language, resolvePack(language));
  }
  return RESOLVED.get(language);
}

function resolvePack(language) {
  const subtags = language.toLowerCase().split("-");
  const layers = [base];
  for (let length = 1; length <= subtags.length; length += 1) {
    const pack = PACKS.get(subtags.slice(0, length).join("-"));
    if (pack !== undefined) {
      layers.push(pack);
    }
  }
  const pack = {};
  for (const layer of layers) {
    Object.assign(pack, layer, {
      checks: { ...pack.checks, ...layer.checks },
      labels: { ...pack.labels, ...layer.labels }
    });
  }
  pack.tag = language;
  return deepFreeze(pack);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

// A word list (or other check data) from the pack, or null when the pack has
// none. An empty list is still a list: the check runs and matches nothing.
export function checkList(pack, name) {
  return pack.checks[name] ?? null;
}

export function hasLists(pack, names) {
  return names.every((name) => checkList(pack, name) !== null);
}

const SETS = new WeakMap();

// A word list as a Set, built once per pack, or null when the pack has none.
export function checkSet(pack, name) {
  if (!SETS.has(pack)) {
    SETS.set(pack, new Map());
  }
  const sets = SETS.get(pack);
  if (!sets.has(name)) {
    const list = checkList(pack, name);
    sets.set(name, list === null ? null : new Set(list));
  }
  return sets.get(name);
}

// The checks in `definitions` ({ check, label, lists }) the pack cannot run,
// as skipped-check entries: [] when it has every list.
export function skippedChecks(pack, definitions) {
  return definitions.filter((definition) => !hasLists(pack, definition.lists)).map((definition) => skippedCheck(pack, definition));
}

// One skipped check: its name, the project's language, the lists the pack
// lacks, and the note the text output prints.
export function skippedCheck(pack, { check, label, lists }) {
  const missing = lists.filter((name) => checkList(pack, name) === null);
  const names = missing.length < 3 ? missing.join(" or ") : `${missing.slice(0, -1).join(", ")}, or ${missing[missing.length - 1]}`;
  return {
    check,
    language: pack.tag,
    missing,
    message: `${label} skipped: no ${names} list for language ${pack.tag}`
  };
}

// The text output's notes for skipped checks, one line each.
export function skippedLines(skipped) {
  return skipped.map((entry) => `Note: ${entry.message}`);
}

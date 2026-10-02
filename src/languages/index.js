import ar from "./ar.js";
import base from "./base.js";
import en from "./en.js";
import he from "./he.js";
import hi from "./hi.js";
import ja from "./ja.js";
import ko from "./ko.js";
import th from "./th.js";
import zh from "./zh.js";

// Language packs: the conventions and word lists the analysis commands use
// for a story's language, from story.md `language`. A pack is plain data
// (./en.js); languagePack() resolves a BCP 47 tag to one, layering the base
// pack, the language's pack, and any more specific packs (fr, then fr-CA).
// A check whose word list the resolved pack lacks is skipped and reported,
// never run with another language's words.

export const DEFAULT_LANGUAGE = "en";

// Every pack, by code. A regional pack (en-GB) is keyed by its canonical
// tag in lower case and holds only what differs from its language's pack.
const PACKS = new Map([ar, en, he, hi, ja, ko, th, zh].map((pack) => [pack.code, pack]));

// The shape story.schema.json also checks; Intl then checks the subtags
// (no repeated region, say).
const TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

// The canonical form of a BCP 47 tag ("eng" is en, "iw" is he, "zh-hant-tw"
// is zh-Hant-TW), safe to pass to Intl, or null when it is not a tag.
export function canonicalTag(value) {
  if (typeof value !== "string" || !TAG_PATTERN.test(value.trim())) {
    return null;
  }
  try {
    return Intl.getCanonicalLocales(value.trim())[0];
  } catch {
    return null;
  }
}

export function isLanguageTag(value) {
  return canonicalTag(value) !== null;
}

// The language story.md names, as written: English only when `language` is
// unset (missing, blank, or a [TODO] placeholder). A value that is set but
// not a tag is kept, so its pack comes from its first subtag or the base
// pack, never from English; validate reports it.
export function projectLanguage(storyData) {
  const value = storyData?.language;
  if (value === undefined || value === null || (typeof value === "string" && (value.trim() === "" || /^\[TODO\b/i.test(value.trim())))) {
    return DEFAULT_LANGUAGE;
  }
  return String(value).trim();
}

const RESOLVED = new Map();

// The pack for a language tag. `tag` is the tag as written (the skip notes
// name it); `locale` its canonical form for Intl, or for a tag that is not
// valid, the canonical form of its first subtag (fr_FR is fr) or "und"; and
// `code` the most specific pack found ("und" for the base pack alone).
// Fields of later layers replace earlier ones; `checks` and `labels` merge
// by key. The result is frozen and the same object for the same tag.
export function languagePack(tag = DEFAULT_LANGUAGE) {
  const language = String(tag ?? "").trim() || DEFAULT_LANGUAGE;
  if (!RESOLVED.has(language)) {
    RESOLVED.set(language, resolvePack(language));
  }
  return RESOLVED.get(language);
}

function resolveLocale(language) {
  return canonicalTag(language) ?? canonicalTag(language.split(/[-_]/)[0]) ?? "und";
}

function resolvePack(language) {
  const locale = resolveLocale(language);
  const subtags = locale.toLowerCase().split("-");
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
  pack.locale = locale;
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

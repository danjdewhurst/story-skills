import ar from "./ar.js";
import base from "./base.js";
import da from "./da.js";
import deCh from "./de-ch.js";
import de from "./de.js";
import en from "./en.js";
import es from "./es.js";
import fa from "./fa.js";
import fi from "./fi.js";
import fr from "./fr.js";
import he from "./he.js";
import hi from "./hi.js";
import it from "./it.js";
import ja from "./ja.js";
import ko from "./ko.js";
import nl from "./nl.js";
import pl from "./pl.js";
import ptPt from "./pt-pt.js";
import pt from "./pt.js";
import ru from "./ru.js";
import sv from "./sv.js";
import th from "./th.js";
import tr from "./tr.js";
import uk from "./uk.js";
import zh from "./zh.js";
import zhHant from "./zh-hant.js";

// Language packs: the conventions and word lists the analysis commands use
// for a story's language, from story.md `language`. A pack is plain data
// (./en.js); languagePack() resolves a BCP 47 tag to one, layering the base
// pack, the language's pack, and any more specific packs (fr, then fr-CA).
// A check whose word list the resolved pack lacks is skipped and reported,
// never run with another language's words.

export const DEFAULT_LANGUAGE = "en";

// Every pack, by code. A regional pack (en-GB) is keyed by its tag in lower
// case and holds only what differs from its language's pack.
export const PACKS = new Map([ar, da, de, deCh, en, es, fa, fi, fr, he, hi, it, ja, ko, nl, pl, pt, ptPt, ru, sv, th, tr, uk, zh, ...zhHant].map((pack) => [pack.code, pack]));

// The shape of a language tag, as story.schema.json checks it. Validity
// depends on this alone, never on the runtime's Intl data, so extlang tags
// (zh-yue) and grandfathered tags (en-GB-oed) stay valid everywhere.
const TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

export function isLanguageTag(value) {
  return typeof value === "string" && TAG_PATTERN.test(value.trim());
}

// Language subtags written another way: deprecated codes (iw, in) and
// three-letter codes for languages that have a two-letter one (eng).
export const LANGUAGE_ALIASES = {
  iw: "he", in: "id", ji: "yi", jw: "jv", mo: "ro",
  ara: "ar", chi: "zh", zho: "zh", deu: "de", ger: "de", eng: "en", spa: "es", fra: "fr", fre: "fr",
  fas: "fa", per: "fa", heb: "he", hin: "hi", ita: "it", jpn: "ja", kor: "ko", nld: "nl", dut: "nl", pol: "pl", por: "pt", rus: "ru",
  swe: "sv", tha: "th", tur: "tr", ukr: "uk"
};

// Grandfathered tags with a modern form, in lower case, as [tag, macrolanguage].
export const GRANDFATHERED = {
  "en-gb-oed": ["en-gb-oxendict", null],
  "i-klingon": ["tlh", null],
  "no-bok": ["nb", "no"],
  "no-nyn": ["nn", "no"],
  "sgn-be-fr": ["sfb", null],
  "sgn-be-nl": ["vgt", null],
  "sgn-ch-de": ["sgg", null],
  "zh-guoyu": ["cmn", "zh"],
  "zh-hakka": ["hak", "zh"],
  "zh-min-nan": ["nan", "zh"],
  "zh-xiang": ["hsn", "zh"]
};

// The tag packs are looked up by, in lower case, and its macrolanguage, or
// null. Worked out from the tables above, not from Intl, so the same tag
// finds the same pack on every runtime. An extlang tag drops its
// macrolanguage (zh-yue is yue, under zh); a tag that is not valid keeps
// only a first subtag that is a language (fr_FR is fr), else it is und.
export function lookupTag(language) {
  const lower = language.toLowerCase();
  if (GRANDFATHERED[lower] !== undefined) {
    return GRANDFATHERED[lower];
  }
  const subtags = TAG_PATTERN.test(language) ? lower.split("-") : [lower.split(/[-_]/)[0]].filter((subtag) => /^[a-z]{2,3}$/.test(subtag));
  if (subtags.length === 0) {
    return ["und", null];
  }
  subtags[0] = LANGUAGE_ALIASES[subtags[0]] ?? subtags[0];
  if (subtags.length > 1 && /^[a-z]{3}$/.test(subtags[1])) {
    return [subtags.slice(1).join("-"), subtags[0]];
  }
  return [subtags.join("-"), null];
}

// A language tag read as lookupTag reads it: { primary, macrolanguage,
// script, region, subtags }, with the script in title case (Latn) or null.
// Only the subtag after the language can be a script and only the one
// after that (or after the language) a region, so a private-use or
// extension subtag (en-x-hani, ar-u-nu-latn) never counts.
export function parseTag(language) {
  const [lookup, macrolanguage] = lookupTag(String(language ?? "").trim() || DEFAULT_LANGUAGE);
  const subtags = lookup.split("-");
  const [primary, ...rest] = subtags;
  const script = /^[a-z]{4}$/.test(rest[0] ?? "") ? `${rest[0][0].toUpperCase()}${rest[0].slice(1)}` : null;
  const region = rest[script === null ? 0 : 1] ?? "";
  return { primary, macrolanguage, script, region: /^(?:[a-z]{2}|\d{3})$/.test(region) ? region : null, subtags };
}

// The Chinese languages, with the script each is written in when the tag
// names none: Mandarin (cmn) and the other spoken varieties in Simplified
// characters, Cantonese (yue) and Classical Chinese (lzh) in Traditional.
// Any extlang under zh (zh-yue, zh-min-nan) is Chinese too.
export const CHINESE_SCRIPTS = {
  zh: "Hans", cmn: "Hans", wuu: "Hans", hak: "Hans", nan: "Hans", gan: "Hans", hsn: "Hans", cjy: "Hans",
  cdo: "Hans", cpx: "Hans", czh: "Hans", czo: "Hans", mnp: "Hans",
  yue: "Hant", lzh: "Hant"
};

// Regions that decide the script when the tag names none: Traditional in
// Taiwan, Hong Kong, and Macau, Simplified in mainland China and Singapore,
// whatever the language's usual script (yue-CN and lzh-CN are Simplified).
export const REGION_SCRIPTS = { tw: "Hant", hk: "Hant", mo: "Hant", cn: "Hans", sg: "Hans" };

// Which Chinese characters, Simplified (Hans) or Traditional (Hant), a tag
// is written in: its script subtag when that is one of the two (Bopomofo,
// zh-Bopo, counts as Traditional, as its fonts do), else the region's
// script, else the language's usual script, else Simplified. The Chinese
// packs and the builds' fonts both come from this, so labels and
// typesetting always agree.
export function hanScript(language) {
  const { primary, script, region } = parseTag(language);
  if (script === "Hans" || script === "Hant") {
    return script;
  }
  if (script === "Bopo") {
    return "Hant";
  }
  return REGION_SCRIPTS[region] ?? CHINESE_SCRIPTS[primary] ?? "Hans";
}

// hanScript for a Chinese language (zh, cmn, yue, zh-yue), else null.
export function chineseScript(language) {
  const { primary, macrolanguage } = parseTag(language);
  return CHINESE_SCRIPTS[primary] !== undefined || macrolanguage === "zh" ? hanScript(language) : null;
}

// The tag in the runtime's canonical form ("zh-hant-tw" is zh-Hant-TW), or
// null when Intl rejects it.
export function canonicalTag(value) {
  try {
    return typeof value === "string" ? Intl.getCanonicalLocales(value)[0] ?? null : null;
  } catch {
    return null;
  }
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

// The pack for a language tag: the base pack, then the packs for the
// macrolanguage (zh for zh-yue) and each prefix of the lookup tag (fr, then
// fr-ca), whichever exist. A Chinese language (cmn, yue, zh-yue) layers zh,
// then zh-hant when chineseScript says Traditional, before its own pack. `tag` is the tag as written (the skip notes name
// it) and `code` the most specific pack found ("und" for the base pack
// alone). Fields of later layers replace earlier ones; `checks` and
// `labels` merge by key. The result is frozen and the same object for the
// same tag.
export function languagePack(tag = DEFAULT_LANGUAGE) {
  const language = String(tag ?? "").trim() || DEFAULT_LANGUAGE;
  if (!RESOLVED.has(language)) {
    RESOLVED.set(language, resolvePack(language));
  }
  return RESOLVED.get(language);
}

function resolvePack(language) {
  const [lookup, macrolanguage] = lookupTag(language);
  const subtags = lookup.split("-");
  const chinese = chineseScript(language);
  const keys = new Set([
    chinese === null ? macrolanguage : "zh",
    chinese === "Hant" ? "zh-hant" : null,
    ...subtags.map((_, index) => subtags.slice(0, index + 1).join("-"))
  ]);
  const layers = [base, ...[...keys].map((key) => PACKS.get(key)).filter((pack) => pack !== undefined)];
  const pack = {};
  for (const layer of layers) {
    Object.assign(pack, layer, {
      checks: { ...pack.checks, ...layer.checks },
      labels: { ...pack.labels, ...layer.labels }
    });
  }
  pack.tag = language;
  // Only for passing to Intl APIs (collation, plural rules, segmenting): the
  // lookup tag in the runtime's canonical form, so it never makes Intl
  // throw. Runtimes can differ here (Node writes en-UK as en-GB, Bun keeps
  // it), so nothing else may depend on it.
  pack.locale = canonicalTag(lookup) ?? canonicalTag(subtags[0]) ?? "und";
  return deepFreeze(pack);
}

export function deepFreeze(value) {
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

// Every build label's key, as the English pack lists them.
export const LABEL_KEYS = Object.freeze(Object.keys(en.labels));

// A build label with each `{name}` replaced from `values`, in one pass so a
// value is never read as a placeholder. `labels` is a pack's or a book's
// labels; a key they lack is English. `escape` applies to the label's own
// text and not to the values, so a value can be markup.
export function fillLabel(labels, key, values = {}, escape = (text) => text) {
  const template = String(labels?.[key] ?? en.labels[key] ?? "");
  let text = "";
  let last = 0;
  for (const match of template.matchAll(/\{([a-z]+)\}/g)) {
    if (values[match[1]] !== undefined) {
      text += `${escape(template.slice(last, match.index))}${values[match[1]]}`;
      last = match.index + match[0].length;
    }
  }
  return `${text}${escape(template.slice(last))}`;
}

// Names joined pair by pair with the `and` label: "A and B and C". An `and`
// label that leaves out {a} or {b} would drop a name, so names are then
// joined with a comma instead: a byline never loses an author.
export function joinNames(names, labels) {
  const template = String(labels?.and ?? en.labels.and);
  const joiner = template.includes("{a}") && template.includes("{b}") ? labels : { and: "{a}, {b}" };
  return names.length === 0 ? "" : names.reduce((joined, name) => fillLabel(joiner, "and", { a: joined, b: name }));
}

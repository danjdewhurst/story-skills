import { deepFreeze } from "./index.js";
import { lowerCase } from "./locale.js";

// The word lists a style sheet can change. style-sheet.md `replace-words`
// and `add-words` are lists of `- list-name: word, word` entries, the shape
// story.md `labels` takes, since frontmatter has no nested maps.
// `replace-words` swaps a pack's list for the words given (`[]` empties
// it), and `add-words` adds to it. Either can supply a list the pack lacks,
// which turns on the check that needs it, so a style sheet can cover a
// language with no pack of its own.

// Each list by its style-sheet name: the pack list it changes, and whether
// it is matched as written (`cased`) rather than in lower case. Words for
// the other lists are lower-cased in the book's language.
export const STYLE_LISTS = {
  "filter-words": { list: "filterWords" },
  "said-bookisms": { list: "saidBookisms" },
  "plain-tags": { list: "plainTags" },
  "beat-pronouns": { list: "beatPronouns" },
  "inversion-links": { list: "inversionLinks" },
  "adverb-suffixes": { list: "adverbSuffixes" },
  "adverb-exceptions": { list: "adverbExceptions" },
  "echo-stopwords": { list: "echoStopwords" },
  "phrase-stopwords": { list: "phraseStopwords" },
  // british/american pairs: colour/color.
  "dialect-pairs": { list: "dialectPairs" },
  "speech-verbs": { list: "speechVerbs" },
  "speech-pronouns": { list: "speechPronouns" },
  "contraction-suffixes": { list: "contractionSuffixes" },
  "contracted-is": { list: "contractedIs" },
  "elisions": { list: "elisions" },
  "voice-stopwords": { list: "voiceStopwords" },
  "title-abbreviations": { list: "titleAbbreviations", cased: true },
  "context-abbreviations": { list: "contextAbbreviations", cased: true },
  "calendar-words": { list: "calendarWords", cased: true },
  "chapter-words": { list: "chapterWords" },
  "section-words": { list: "sectionWords" },
  "part-words": { list: "partWords" },
  "front-matter-words": { list: "frontMatterWords" },
  // The `words` and `joiners` of numberWords; see wordNumeral in ../import.js.
  "number-words": { list: "numberWords", part: "words" },
  "number-joiners": { list: "numberWords", part: "joiners" },
  "candidate-stopwords": { list: "candidateStopwords", cased: true },
  "determiners": { list: "determiners" },
  "noun-suffixes": { list: "nounSuffixes" },
  "title-words": { list: "titleWords" }
};

export const STYLE_LIST_FIELDS = ["replace-words", "add-words"];

// The `key: value` pairs of a `- key: value` list, or [] when the field is
// not a list. Items that are not entries are left to validate.
export function styleListEntries(value) {
  return Array.isArray(value) ? value.filter(isEntry).flatMap((entry) => Object.entries(entry)) : [];
}

function isEntry(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The words an entry's value gives: comma-separated text, or [] for none.
// Null for a value of another type, which validate reports.
export function styleWords(value) {
  if (Array.isArray(value) && value.length === 0) {
    return [];
  }
  if (typeof value !== "string") {
    return null;
  }
  return value.split(",").map((word) => word.trim()).filter((word) => word !== "");
}

// The pack with the style sheet's `replace-words` and `add-words` applied,
// or the pack itself when the style sheet changes no list, so a book
// without them keeps the shared, cached pack. Entries naming no list, or
// with a value that is not text, are skipped; validate reports them.
export function withStyleLists(pack, styleData) {
  const changes = STYLE_LIST_FIELDS.flatMap((field) => styleListEntries(styleData?.[field])
    .filter(([key, value]) => Object.prototype.hasOwnProperty.call(STYLE_LISTS, key) && styleWords(value) !== null)
    .map(([key, value]) => ({ replace: field === "replace-words", key, words: styleWords(value) })));
  if (changes.length === 0) {
    return pack;
  }
  const checks = { ...pack.checks };
  const cleared = new Set();
  for (const { replace, key, words } of changes) {
    const { list, part, cased = false } = STYLE_LISTS[key];
    const written = words.map((word) => {
      const straight = word.replace(/’/g, "'");
      return cased ? straight : lowerCase(straight, pack);
    });
    const fresh = replace && !cleared.has(key);
    cleared.add(key);
    if (part !== undefined) {
      // Replacing number words drops the spelled-out English units, teens,
      // and tens too, so the style sheet's words are the only numbers.
      const current = fresh && part === "words" ? { joiners: checks.numberWords?.joiners ?? [] } : { ...checks.numberWords };
      checks.numberWords = { ...current, [part]: unique([...(fresh ? [] : current[part] ?? []), ...written]) };
    } else if (list === "dialectPairs") {
      const pairs = written.map((pair) => pair.split("/").map((word) => word.trim())).filter((pair) => pair.length === 2 && pair.every((word) => word !== ""));
      checks.dialectPairs = [...(fresh ? [] : checks.dialectPairs ?? []), ...pairs];
    } else {
      checks[list] = unique([...(fresh ? [] : checks[list] ?? []), ...written]);
    }
  }
  return deepFreeze({ ...pack, checks });
}

function unique(words) {
  return [...new Set(words)];
}

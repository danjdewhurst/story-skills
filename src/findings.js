// Every error and warning a command reports is a finding: `code` is its
// stable kebab-case rule name, `message` the line the text output prints
// after `error:` or `warning:`, and `file` the project file it is about, as
// the message spells it, or null. Build findings with err and warn where the
// rule is checked, passing the code as a string literal.
//
// Codes are part of the CLI's interface: story.md `severity` entries and
// --json consumers name them, so a code is never renamed or reused for a
// different rule. FINDING_CODES lists each one with its level, and
// docs/cli-reference.md documents it; test/finding-codes.test.js fails when a
// code is raised but not listed or documented, or listed but never raised.

export function err(code, message, file = null) {
  return { code, message, file };
}

// The same shape as err: the level is where the finding is pushed. The two
// names let the finding-codes test check each code's level in the source.
export function warn(code, message, file = null) {
  return { code, message, file };
}

// Transitional: a finding raised as a bare string, before its check was
// given codes.
export function asFinding(value) {
  return typeof value === "string" ? { code: null, message: value, file: null } : value;
}

export const FINDING_CODES = {
  // story validate
  "todo-markers": "warning",
  "stale-registry": "warning",
  "stale-word-count": "warning",
  // story prose
  "prose-filter-words": "warning",
  "prose-adverbs": "warning",
  "prose-bookisms": "warning",
  "prose-avoided-spelling": "warning",
  // story pacing
  "pacing-no-hook": "warning",
  // story clues
  "clue-unplanted": "warning",
  "clue-late-plant": "warning",
  // story voices
  "voice-avoid": "warning"
};

export function codesAt(level) {
  return Object.keys(FINDING_CODES).filter((code) => FINDING_CODES[code] === level);
}

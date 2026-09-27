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
  "prose-uniform-sentences": "warning",
  "prose-similar-names": "warning",
  // story pacing
  "pacing-no-hook": "warning",
  "pacing-no-sequel": "warning",
  "pacing-easy-wins": "warning",
  "pacing-resolution-run": "warning",
  "pacing-long-chapter": "warning",
  "pacing-short-chapter": "warning",
  // story clues
  "clue-unplanted": "warning",
  "clue-late-plant": "warning",
  "clue-no-characters": "warning",
  "clue-herring-unresolved": "warning",
  "clue-none-delayed": "warning",
  // story voices
  "voice-avoid": "warning",
  "voice-words-unused": "warning",
  "voice-sound-alike": "warning",
  // story names
  "name-clash": "error",
  "name-look-alike": "warning",
  "name-shared-initial": "warning",
  // story continuity
  "revived-without-death": "error",
  "deceased-in-cast": "warning",
  "died-in-missing-chapter": "error",
  "revived-in-missing-chapter": "error",
  "revival-before-death": "error",
  "death-status-mismatch": "error",
  "revival-status-mismatch": "error",
  "posthumous-appearance": "error",
  "pov-not-in-cast": "warning",
  "pov-scene-mismatch": "warning",
  "scene-cast-not-in-chapter": "warning",
  "scene-location-not-in-chapter": "warning",
  "cut-character-in-cast": "warning",
  "cut-character-in-arc": "warning",
  "cut-character-relationship": "warning",
  "chapter-numbering-start": "warning",
  "chapter-numbering-gap": "warning",
  "promise-payoff-before-plant": "error",
  "promise-payoff-missing": "error",
  "promise-plant-missing": "error",
  "promise-stale-planned": "warning",
  "promise-payoff-passed": "warning",
  "promise-unpaid": "warning",
  "question-resolved-before-introduced": "error",
  "question-resolution-missing": "error",
  "question-open-but-resolved": "error",
  "complete-with-open-promise": "error",
  "complete-with-open-question": "error",
  "complete-with-open-clue": "error",
  "clue-payoff-before-plant": "error",
  "clue-payoff-missing": "error",
  "clue-plant-missing": "error",
  "clue-stale-planned": "warning",
  "clue-payoff-passed": "warning",
  "clue-unpaid": "warning",
  "current-chapter-ahead": "error",
  "current-chapter-behind": "warning",
  "state-missing-character": "error",
  "state-duplicate-character": "warning",
  "state-missing-location": "error",
  "state-fact-not-kebab": "error",
  "state-duplicate-fact": "error",
  "state-missing-knows": "error",
  "state-missing-chapter": "error",
  "state-missing-artifact": "error",
  "state-duplicate-artifact": "warning",
  "state-missing-owner": "error",
  "state-status-conflict": "warning",
  "deceased-learning": "warning",
  "posthumous-learning": "error",
  "learner-not-in-cast": "warning",
  "knowledge-not-recorded": "warning",
  "state-tracks-dead-character": "warning",
  "state-location-drift": "warning",
  "object-not-recorded": "warning",
  "state-object-drift": "warning",
  "state-entry-not-mapping": "error",
  "gone-artifact-used": "error",
  "gone-artifact-mentioned": "error",
  "malformed-date": "warning",
  "malformed-time": "warning",
  "negative-travel-hours": "warning",
  "travel-hours-undated": "warning",
  "clock-backward": "warning",
  "travel-too-fast": "error",
  "route-same-time": "error",
  "route-too-fast": "error"
};

export function codesAt(level) {
  return Object.keys(FINDING_CODES).filter((code) => FINDING_CODES[code] === level);
}

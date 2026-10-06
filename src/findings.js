import { portablePath } from "./files.js";

// Every error and warning a command reports is a finding: `code` is its
// stable kebab-case rule name, `message` the line the text output prints
// after `error:` or `warning:`, `file` the project file it is about, as the
// message spells it, or null, and `chapter` the id of the chapter the
// problem shows up in, when the rule knows it (see CHAPTER_CODES), or null.
// Build findings with err and warn where the rule is checked, passing the
// code as a string literal.
//
// Codes are part of the CLI's interface: story.md `severity` entries and
// --json consumers name them, so a code is never renamed or reused for a
// different rule. FINDING_CODES lists each one with its level, and
// docs/cli-reference.md documents it; test/finding-codes.test.js fails when a
// code is raised but not listed or documented, or listed but never raised.

export function err(code, message, file = null, chapter = null) {
  return { code, message, file: portablePath(file), chapter };
}

// The same shape as err: the level is where the finding is pushed. The two
// names let the finding-codes test check each code's level in the source.
export function warn(code, message, file = null, chapter = null) {
  return { code, message, file: portablePath(file), chapter };
}

export const FINDING_CODES = {
  // Any command that reads a project: a file that cannot be read or parsed
  "unreadable-file": "error",
  // story validate, and the validate check of report, next, and doctor
  "missing-required-path": "error",
  "windows-reserved-name": "warning",
  "stray-file": "warning",
  "nested-file": "warning",
  "symlinked-file": "warning",
  "interrupted-write": "warning",
  "stale-registry": "warning",
  "stale-word-count": "warning",
  "todo-markers": "warning",
  "unclosed-comment": "warning",
  "no-scene-records": "warning",
  "empty-chapter": "warning",
  "missing-field": "error",
  "field-not-scalar": "error",
  "field-not-list": "error",
  "field-invalid-items": "error",
  "field-not-integer": "error",
  "field-not-number": "error",
  "field-not-boolean": "error",
  "field-not-text": "error",
  "field-below-minimum": "error",
  "unsupported-value": "error",
  "id-not-kebab": "error",
  "near-miss-key": "warning",
  "wrong-type": "error",
  "story-id-mismatch": "error",
  "entry-not-mapping": "error",
  "schema-too-new": "error",
  "schema-version-mismatch": "error",
  "invalid-book-number": "error",
  "invalid-ifid": "error",
  "invalid-cover": "error",
  "invalid-date": "error",
  "invalid-cli-config": "error",
  "invalid-filename": "error",
  "filename-number-mismatch": "error",
  "duplicate-chapter-number": "error",
  "duplicate-scene-number": "error",
  "unnumbered-without-title": "error",
  "invalid-choice": "error",
  "invalid-route-hours": "error",
  "duplicate-route": "warning",
  "deceased-without-died-in": "warning",
  "progression-fixed-field": "error",
  "progression-list-field": "error",
  "progression-duplicate": "error",
  "progression-out-of-order": "error",
  "duplicate-pass": "error",
  "exemption-pattern-too-short": "error",
  "exemption-unknown-code": "error",
  "exemption-code-not-dismissible": "error",
  "exemption-file-not-relative": "error",
  "exemption-too-broad": "error",
  "exemption-misspelled-key": "error",
  "exemption-chapter-not-carried": "error",
  "style-use-equals-avoid": "error",
  "style-sample-missing": "warning",
  "style-sample-own-chapters": "warning",
  "unknown-word-list": "warning",
  "duplicate-session-date": "error",
  "research-no-sources": "warning",
  "research-unsettled": "warning",
  "research-unreviewed": "warning",
  "empty-matter": "warning",
  "permission-pending": "warning",
  "permission-no-rights-holder": "warning",
  "backslash-path": "warning",
  "form-length-range": "warning",
  "unused-target": "warning",
  "session-without-characters": "warning",
  "invalid-language": "error",
  "unsupported-writing-mode": "error",
  "unsupported-chapter-numerals": "error",
  "invalid-isbn": "error",
  "invalid-subject": "error",
  "too-many-keywords": "warning",
  "todo-placeholder": "warning",
  "author-and-authors": "warning",
  "unknown-label": "warning",
  "blank-label": "warning",
  // story links
  "missing-reference": "error",
  "missing-backlink": "error",
  "backlink-type-mismatch": "error",
  "legacy-backlink-type": "warning",
  "route-to-self": "error",
  "broken-link": "error",
  "link-backslash": "error",
  "link-not-kebab": "error",
  "link-outside-project": "error",
  "unreachable-chapter": "warning",
  "series-link-backslash": "error",
  "series-link-self": "error",
  "series-link-unreadable": "error",
  "series-link-not-project": "error",
  "series-link-not-sibling": "error",
  "series-missing-backlink": "error",
  "series-link-other-series": "error",
  // story continuity
  "revived-without-death": "error",
  "died-in-missing-chapter": "error",
  "revived-in-missing-chapter": "error",
  "revival-before-death": "error",
  "death-status-mismatch": "error",
  "revival-status-mismatch": "error",
  "posthumous-appearance": "error",
  "deceased-in-cast": "warning",
  "progression-deceased-in-cast": "warning",
  "progression-death-conflict": "warning",
  "pov-not-in-cast": "warning",
  "pov-scene-mismatch": "warning",
  "named-not-listed": "warning",
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
  "question-unanswered": "warning",
  "clue-payoff-before-plant": "error",
  "clue-payoff-missing": "error",
  "clue-plant-missing": "error",
  "clue-stale-planned": "warning",
  "clue-payoff-passed": "warning",
  "clue-unpaid": "warning",
  "complete-with-open-promise": "error",
  "complete-with-open-question": "error",
  "complete-with-open-clue": "error",
  "current-chapter-ahead": "error",
  "current-chapter-behind": "warning",
  "state-missing-character": "error",
  "state-missing-location": "error",
  "state-missing-artifact": "error",
  "state-missing-owner": "error",
  "state-missing-chapter": "error",
  "state-missing-knows": "error",
  "state-fact-not-kebab": "error",
  "state-duplicate-fact": "error",
  "state-duplicate-character": "warning",
  "state-duplicate-artifact": "warning",
  "state-status-conflict": "warning",
  "posthumous-learning": "error",
  "deceased-learning": "warning",
  "progression-deceased-learning": "warning",
  "learner-not-in-cast": "warning",
  "knowledge-not-recorded": "warning",
  "state-tracks-dead-character": "warning",
  "state-location-drift": "warning",
  "object-not-recorded": "warning",
  "state-object-drift": "warning",
  "state-differs-by-path": "warning",
  "gone-artifact-used": "error",
  "gone-artifact-mentioned": "error",
  "malformed-date": "warning",
  "malformed-time": "warning",
  "negative-travel-hours": "warning",
  "travel-hours-undated": "warning",
  "clock-backward": "warning",
  "travel-too-fast": "error",
  "route-same-time": "error",
  "route-too-fast": "error",
  // story series
  "series-link-outside": "error",
  "series-too-many-books": "error",
  "series-conflict": "error",
  "series-id-missing": "warning",
  "series-title-mismatch": "warning",
  "series-cycle": "error",
  "duplicate-book-number": "error",
  "canon-name-mismatch": "warning",
  "canon-pronunciation-mismatch": "warning",
  "canon-death-status": "error",
  "canon-posthumous-appearance": "error",
  "canon-posthumous-learning": "error",
  "canon-destroyed-status": "warning",
  "canon-destroyed-artifact-used": "error",
  "canon-fact-relearned": "error",
  // story prose
  "prose-filter-words": "warning",
  "prose-adverbs": "warning",
  "prose-bookisms": "warning",
  "prose-avoided-spelling": "warning",
  "prose-uniform-sentences": "warning",
  "prose-similar-names": "warning",
  "prose-baseline-sentences": "warning",
  "prose-baseline-paragraphs": "warning",
  "prose-baseline-dialogue": "warning",
  "prose-baseline-filter-words": "warning",
  "prose-baseline-adverbs": "warning",
  "prose-baseline-small": "warning",
  "style-sample-unreadable": "warning",
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
  // story mentions
  "mention-not-named": "warning",
  // story names
  "name-clash": "error",
  "name-look-alike": "warning",
  "name-shared-initial": "warning",
  // story context
  "context-file-skipped": "warning",
  // story compare
  "story-missing-at-ref": "warning",
  // story similarity
  "similarity-shared-passage": "warning",
  "similarity-no-reference-text": "warning",
  // story build and story export
  "derived-ifid": "warning",
  "scene-outside-book": "warning",
  "scene-no-location": "warning",
  "scene-unknown-location": "warning",
  "chapter-no-scenes": "warning",
  "scene-no-setting": "warning",
  // story add, rename, move, and remove
  "unknown-reference": "warning",
  "adopted-references": "warning",
  "linked-book-id": "warning",
  "choices-dropped": "warning",
  "leftover-references": "warning",
  "stale-exemption": "warning",
  // story split and story merge
  "split-references": "warning",
  "split-scenes": "warning",
  "merge-conflicts": "warning",
  // story init and story import
  "kept-story-options": "warning",
  "unsplit-chapter-lines": "warning",
  // Any command with --json, when it fails before producing a result
  "usage-error": "error",
  "unusable-project": "error",
  "write-refused": "error",
  "command-failed": "error"
};

export function codesAt(level) {
  return Object.keys(FINDING_CODES).filter((code) => FINDING_CODES[code] === level);
}

// Warnings that story init and story import report while making a project,
// before any story.md or exemption log is read, so neither can change them.
export const PROJECTLESS_CODES = ["kept-story-options", "unsplit-chapter-lines"];

// The warning codes a story.md severity entry can name.
export function severityCodes() {
  return codesAt("warning").filter((code) => !PROJECTLESS_CODES.includes(code));
}

// The errors story continuity reports: an exemption can dismiss these, where
// every other error means the project is broken and stays an error.
// test/finding-codes.test.js checks the list against src/continuity.js.
export const CONTINUITY_ERROR_CODES = [
  "unreadable-file",
  "entry-not-mapping",
  "revived-without-death",
  "died-in-missing-chapter",
  "revived-in-missing-chapter",
  "revival-before-death",
  "death-status-mismatch",
  "revival-status-mismatch",
  "posthumous-appearance",
  "promise-payoff-before-plant",
  "promise-payoff-missing",
  "promise-plant-missing",
  "question-resolved-before-introduced",
  "question-resolution-missing",
  "question-open-but-resolved",
  "clue-payoff-before-plant",
  "clue-payoff-missing",
  "clue-plant-missing",
  "complete-with-open-promise",
  "complete-with-open-question",
  "complete-with-open-clue",
  "current-chapter-ahead",
  "state-missing-character",
  "state-missing-location",
  "state-missing-artifact",
  "state-missing-owner",
  "state-missing-chapter",
  "state-missing-knows",
  "state-fact-not-kebab",
  "state-duplicate-fact",
  "posthumous-learning",
  "gone-artifact-used",
  "gone-artifact-mentioned",
  "travel-too-fast",
  "route-same-time",
  "route-too-fast"
];

// The codes a continuity/exemptions.md entry can name: any warning a
// severity entry can name, and the errors story continuity reports.
export function exemptionCodes() {
  return [...severityCodes(), ...CONTINUITY_ERROR_CODES];
}

// The continuity findings that carry a `chapter`: each is about something
// placed in one chapter (a cast, a scene, a learning event, a dated unit), so
// an exemption's `chapter` key can match it. docs/continuity.md lists them,
// and test/finding-codes.test.js checks the list against the source.
export const CHAPTER_CODES = [
  "posthumous-appearance",
  "deceased-in-cast",
  "progression-deceased-in-cast",
  "progression-death-conflict",
  "pov-not-in-cast",
  "pov-scene-mismatch",
  "named-not-listed",
  "mention-not-named",
  "scene-cast-not-in-chapter",
  "scene-location-not-in-chapter",
  "cut-character-in-cast",
  "posthumous-learning",
  "deceased-learning",
  "progression-deceased-learning",
  "learner-not-in-cast",
  "knowledge-not-recorded",
  "state-tracks-dead-character",
  "state-location-drift",
  "object-not-recorded",
  "state-object-drift",
  "state-differs-by-path",
  "gone-artifact-used",
  "gone-artifact-mentioned",
  "malformed-date",
  "malformed-time",
  "negative-travel-hours",
  "travel-hours-undated",
  "clock-backward",
  "travel-too-fast",
  "route-same-time",
  "route-too-fast"
];

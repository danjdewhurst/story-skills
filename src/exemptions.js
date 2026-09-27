import path from "node:path";
import { readTextFile } from "./files.js";
import { CHAPTER_CODES, FINDING_CODES, PROJECTLESS_CODES, err, exemptionCodes } from "./findings.js";
import { parseFrontmatter } from "./frontmatter.js";
import { kebabCase } from "./markdown.js";
import { suggestion } from "./options.js";

// continuity/exemptions.md records findings a writer has decided are
// intentional. Each entry sets one or more matching keys and a reason:
//
//   exemptions:
//     - code: clock-backward              the finding's code
//       file: scenes/chapter-06-scene-01.md  the file it is about
//       chapter: chapter-06               the chapter it shows up in
//       pattern: "timestamp runs"         text the message contains
//       reason: Chapter 6 is the other ending.
//
// An entry matches a finding when every key it sets matches. story
// continuity dismisses its errors and warnings with every usable entry; an
// entry that names a code also dismisses that warning wherever another
// command reports it (see applySeverity in config.js).

export const EXEMPTIONS_FILE = path.join("continuity", "exemptions.md");

// The keys that say which findings an entry dismisses.
export const MATCH_KEYS = ["pattern", "code", "file", "chapter"];

const MIN_PATTERN_LENGTH = 4;

// Paths in findings use the platform separator, so an entry written on one
// system (`continuity/promises/x.md`) matches on another.
function portable(text) {
  return text.replace(/\\/g, "/");
}

// An entry's file as findings name it, or null when it is not a relative
// path that stays inside the project: `./a/b.md` and `a\b.md` both give
// `a/b.md`, and an absolute path, one with a `..` segment, or one with a
// NUL (which no file system takes) is refused.
// schemas/story.schema.json spells the same rule as a pattern.
export function exemptionFile(value) {
  const text = portable(value);
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text) || text.split("/").includes("..") || text.includes("\0")) {
    return null;
  }
  const normalized = path.posix.normalize(text).replace(/\/$/, "");
  return normalized === "." ? null : normalized;
}

// The errors that stop an entry from taking effect, labelled `label` (such
// as `continuity/exemptions.md exemptions[2]`). Continuity and story
// validate share this check, so an entry validate rejects never dismisses
// anything: dropping only its bad key would widen what it matches.
export function exemptionProblems(entry, label = "exemption") {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return [err("entry-not-mapping", `${label} must be a mapping`, EXEMPTIONS_FILE)];
  }
  const problems = [];
  // A misspelled key (`Code`, `files`) would be ignored, widening the entry
  // to whatever its other keys match, so it stops the entry.
  for (const key of Object.keys(entry)) {
    const intended = [...MATCH_KEYS, "reason"].find((known) => {
      const normalized = key.trim().toLowerCase().replace(/[\s_]+/g, "-");
      return key !== known && (normalized === known || normalized === `${known}s`);
    });
    if (intended !== undefined) {
      problems.push(err("exemption-misspelled-key", `${label} has ${key}; did you mean ${intended}?`, EXEMPTIONS_FILE));
    }
  }
  if (MATCH_KEYS.every((key) => entry[key] === undefined)) {
    problems.push(err("missing-field", `${label} sets none of ${MATCH_KEYS.join(", ")}: set at least one to say which findings it dismisses`, EXEMPTIONS_FILE));
  }
  if (entry.pattern !== undefined) {
    // The pattern matches as written, so a leading space can mark a word
    // boundary; trimming only measures it.
    if (typeof entry.pattern !== "string" || entry.pattern.trim() === "") {
      problems.push(err("missing-field", `${label} is missing a non-empty pattern`, EXEMPTIONS_FILE));
    } else if (entry.pattern.trim().length < MIN_PATTERN_LENGTH) {
      problems.push(err("exemption-pattern-too-short", `${label} pattern must be at least ${MIN_PATTERN_LENGTH} characters to avoid blanket exemptions`, EXEMPTIONS_FILE));
    }
  }
  const codeProblem = entry.code === undefined ? null : codeError(entry.code, label);
  if (codeProblem) {
    problems.push(codeProblem);
  }
  if (entry.file !== undefined) {
    if (typeof entry.file !== "string" || entry.file.trim() === "") {
      problems.push(err("field-not-text", `${label} file must be a project file path, such as chapters/chapter-03.md`, EXEMPTIONS_FILE));
    } else if (exemptionFile(entry.file) === null) {
      problems.push(err("exemption-file-not-relative", `${label} file ${entry.file} must be a path inside the project, relative to story.md, such as chapters/chapter-03.md`, EXEMPTIONS_FILE));
    }
  }
  if (entry.chapter !== undefined && !isChapterId(entry.chapter)) {
    problems.push(err("id-not-kebab", `${label} chapter must be a kebab-case chapter id, such as chapter-03, got ${JSON.stringify(entry.chapter)}`, EXEMPTIONS_FILE));
  } else if (entry.chapter !== undefined && codeProblem === null && entry.code !== undefined && !CHAPTER_CODES.includes(entry.code)) {
    problems.push(err("exemption-chapter-not-carried", `${label} sets chapter, but ${entry.code} findings carry no chapter, so it would never match: use file instead`, EXEMPTIONS_FILE));
  }
  // An entry must say which rule it dismisses, by code or by the text of
  // the finding, and a code needs a file, chapter, or pattern with it. A
  // code alone dismisses every finding of that rule (for a warning that is
  // what severity off in story.md is for, and for an error it would hide
  // every later contradiction of its kind); a file or chapter alone
  // dismisses every error and warning about that file or chapter.
  const narrowed = ["pattern", "file", "chapter"].some((key) => entry[key] !== undefined);
  if (entry.code !== undefined && codeProblem === null && !narrowed) {
    const severity = FINDING_CODES[entry.code] === "warning" ? `, or set severity ${entry.code} to off in story.md` : "";
    problems.push(err("exemption-too-broad", `${label} sets only code, which would dismiss every ${entry.code} finding: add file, chapter, or pattern to narrow it${severity}`, EXEMPTIONS_FILE));
  } else if (entry.code === undefined && entry.pattern === undefined && narrowed) {
    problems.push(err("exemption-too-broad", `${label} sets ${entry.file === undefined ? "chapter" : entry.chapter === undefined ? "file" : "file and chapter"} without code or pattern, which would dismiss every finding about it: add the finding's code`, EXEMPTIONS_FILE));
  }
  if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
    problems.push(err("missing-field", `${label} is missing a non-empty reason`, EXEMPTIONS_FILE));
  }
  return problems;
}

export function isChapterId(value) {
  return typeof value === "string" && value !== "" && kebabCase(value) === value;
}

function codeError(code, label) {
  if (typeof code !== "string" || code.trim() === "") {
    return err("field-not-text", `${label} code must be a finding code, such as clock-backward`, EXEMPTIONS_FILE);
  }
  if (!Object.hasOwn(FINDING_CODES, code)) {
    return err("exemption-unknown-code", `${label} code ${code} is not a finding code${suggestion(code, Object.keys(FINDING_CODES))}`, EXEMPTIONS_FILE);
  }
  if (!exemptionCodes().includes(code)) {
    const why = PROJECTLESS_CODES.includes(code)
      ? "story init or story import reports it before there is an exemption log to read"
      : "it is an error outside story continuity, which means the project is broken: only continuity errors and warnings can be exempted";
    return err("exemption-code-not-dismissible", `${label} code ${code} cannot be exempted: ${why}`, EXEMPTIONS_FILE);
  }
  return null;
}

// The usable entries of a parsed exemptions list, each with its index in
// the list, so a dismissal can say which entry matched.
export function parseExemptions(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const exemptions = [];
  entries.forEach((entry, index) => {
    if (exemptionProblems(entry).length > 0) {
      return;
    }
    const exemption = { index, reason: entry.reason.trim() };
    if (entry.pattern !== undefined) {
      exemption.pattern = entry.pattern;
    }
    if (entry.code !== undefined) {
      exemption.code = entry.code;
    }
    if (entry.file !== undefined) {
      exemption.file = exemptionFile(entry.file);
    }
    if (entry.chapter !== undefined) {
      exemption.chapter = entry.chapter;
    }
    exemptions.push(exemption);
  });
  return exemptions;
}

// The project's usable exemptions, or none when the log is missing or
// cannot be read or parsed. story continuity reports a log it cannot read;
// story validate reports one that does not parse.
export function readExemptionLog(root) {
  try {
    return parseExemptions(parseFrontmatter(readTextFile(path.join(root, EXEMPTIONS_FILE))).data.exemptions);
  } catch {
    return [];
  }
}

// Whether every key an exemption sets matches the finding. A finding with
// no file or chapter never matches an entry that sets one.
export function exemptionMatches(exemption, finding) {
  return (exemption.pattern === undefined || portable(finding.message).includes(portable(exemption.pattern)))
    && (exemption.code === undefined || finding.code === exemption.code)
    && (exemption.file === undefined || (typeof finding.file === "string" && portable(finding.file) === exemption.file))
    && (exemption.chapter === undefined || finding.chapter === exemption.chapter);
}

// Moves the findings an exemption matches into `dismissed`, with the first
// matching entry's reason and index. Warnings always; errors only when
// `errors` is set, as story continuity does. `ok` reflects only the errors
// that remain.
export function dismissByExemptions(result, exemptions, { errors: withErrors }) {
  if (exemptions.length === 0) {
    return result;
  }
  const dismissed = [...(result.dismissed ?? [])];
  const keep = (findings) => findings.filter((finding) => {
    const match = exemptions.find((exemption) => exemptionMatches(exemption, finding));
    if (match) {
      dismissed.push({ finding, reason: match.reason, index: match.index });
    }
    return !match;
  });
  const errors = withErrors ? keep(result.errors) : result.errors;
  const warnings = keep(result.warnings);
  if (dismissed.length === (result.dismissed ?? []).length) {
    return result;
  }
  return { ...result, ok: withErrors ? errors.length === 0 : result.ok, errors, warnings, dismissed };
}

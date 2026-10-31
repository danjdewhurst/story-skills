// Checks for the progress.md writing log and the exemptions log.
import fs from "node:fs";
import path from "node:path";
import { storyDateError } from "./continuity.js";
import { lstatIfExists } from "./files.js";
import { PROGRESS_FILE, cleanSessions } from "./progress.js";
import { err, warn } from "./findings.js";
import { EXEMPTIONS_FILE, exemptionFile, exemptionProblems, isChapterId } from "./exemptions.js";
import { asArray } from "./scan.js";
import { validateObjectArray } from "./validate-fields.js";
import { readValidationData } from "./validate-files.js";

// In a book counted in characters, the progress.md sessions logged with no
// `characters` (before the book counted them), which progress leaves out of
// its pace, as one warning.
export function sessionsWithoutCharacters(project) {
  if (project.unit.name !== "characters" || project.progressLog === null) {
    return [];
  }
  // A malformed `characters` is a validate error instead.
  const unlogged = new Set(asArray(project.progressLog.data.sessions).filter((entry) => entry && typeof entry === "object" && entry.characters === undefined).map((entry) => String(entry.date ?? "").trim()));
  const dates = cleanSessions(project.progressLog.data.sessions).filter((session) => unlogged.has(session.date)).map((session) => session.date);
  if (dates.length === 0) {
    return [];
  }
  return [warn("session-without-characters", `${PROGRESS_FILE} ${dates.length === 1 ? "session" : "sessions"} ${dates.join(", ")} ${dates.length === 1 ? "has" : "have"} no characters, so story progress leaves ${dates.length === 1 ? "it" : "them"} out of the pace: this book counts characters, so add characters by hand or remove ${dates.length === 1 ? "it" : "them"}`, PROGRESS_FILE)];
}

export function validateExemptions(project, errors, warnings) {
  const exemptionsPath = path.join(project.root, EXEMPTIONS_FILE);
  if (!fs.existsSync(exemptionsPath)) {
    return;
  }

  const label = EXEMPTIONS_FILE;
  const data = readValidationData(exemptionsPath, project.root, label, errors);
  if (!data) {
    return;
  }

  if (data.type !== "exemption-log") {
    errors.push(err("wrong-type", `${label} type must be exemption-log`, label));
  }

  const entries = data.exemptions;
  if (entries === undefined) {
    errors.push(err("missing-field", `${label} is missing frontmatter field exemptions`, label));
    return;
  }
  if (!Array.isArray(entries)) {
    errors.push(err("field-not-list", `${label} frontmatter field exemptions must be a list`, label));
    return;
  }

  const chapters = new Set(project.chapters.map((chapter) => chapter.id));
  for (const [index, entry] of entries.entries()) {
    const entryLabel = `${label} exemptions[${index}]`;
    errors.push(...exemptionProblems(entry, entryLabel));
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    // A file or chapter that is gone can match nothing: usually a leftover
    // from a remove, or a typo.
    const file = typeof entry.file === "string" ? exemptionFile(entry.file) : null;
    if (file !== null && !lstatIfExists(path.join(project.root, file))?.isFile()) {
      warnings.push(warn("stale-exemption", `${entryLabel} file ${entry.file} is not a file in the project, so the entry matches nothing`, label));
    }
    if (isChapterId(entry.chapter) && !chapters.has(entry.chapter)) {
      warnings.push(warn("stale-exemption", `${entryLabel} chapter ${entry.chapter} is not a chapter in chapters/, so the entry matches nothing`, label));
    }
  }
}

export function validateProgressLog(project, errors) {
  if (project.progressLog === null) {
    return;
  }
  const data = project.progressLog.data;
  if (data.type !== "progress-log") {
    errors.push(err("wrong-type", `${PROGRESS_FILE} type must be progress-log`, PROGRESS_FILE));
  }
  validateObjectArray(data, "sessions", PROGRESS_FILE, errors);
  const seen = new Set();
  asArray(data.sessions).forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }
    const label = `${PROGRESS_FILE} sessions[${index}]`;
    // A blank date is no date, and a list is not one, though String would
    // flatten [2024-01-05] into one: story progress leaves both out.
    const blank = entry.date === undefined || entry.date === null || (typeof entry.date === "string" && entry.date.trim() === "");
    const dateError = blank ? "requires a date" : typeof entry.date === "string" ? storyDateError(entry.date) : "date must be a YYYY-MM-DD date";
    if (dateError !== "") {
      errors.push(err("invalid-date", `${label} ${dateError}`, PROGRESS_FILE));
    } else if (seen.has(String(entry.date).trim())) {
      errors.push(err("duplicate-session-date", `${label} repeats date ${String(entry.date).trim()}`, PROGRESS_FILE));
    } else {
      seen.add(String(entry.date).trim());
    }
    if (!Number.isInteger(entry.words) || entry.words < 0) {
      errors.push(err("field-not-integer", `${label} words must be a non-negative integer`, PROGRESS_FILE));
    }
    if (entry.characters !== undefined && (!Number.isInteger(entry.characters) || entry.characters < 0)) {
      errors.push(err("field-not-integer", `${label} characters must be a non-negative integer`, PROGRESS_FILE));
    }
  });
}

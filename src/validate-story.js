// story.md checks for story validate: the story id registries record,
// paths, cover, deadline and release dates, the release cadence, and the
// daily and length targets.
import { storyDateError } from "./continuity.js";
import { kebabCase } from "./markdown.js";
import { COUNT_UNITS, formRangeWarning, formRanges } from "./forms.js";
import { WEEKDAYS, weekdayName } from "./progress.js";
import { MAX_RELEASE_MONTHS, releaseMonths } from "./release-schedule.js";
import { err, warn } from "./findings.js";
import { coverImage, asciiStoryId } from "./scan.js";
import { requireInteger } from "./validate-fields.js";

// Every registry records the story id, which follows the story.md title, so
// a retitled story leaves them all stale until `story reindex` rewrites them.
export function storyIdMismatch(label, project) {
  return err("story-id-mismatch", `${label} story must be ${project.storyId} (run story reindex after changing the story.md title)`, label);
}

// With story.md unreadable or untitled, or a title with no ASCII letters or
// digits in a folder with some, the story id is only the folder name, so
// comparing every registry's `story` with it would repeat one problem. A
// substitute id is hashed from the title, so it is checked like a title's.
export function storyIdIsFallback(project) {
  const title = project.story.data.title;
  return Boolean(project.story.unreadable)
    || String(title ?? "").trim() === ""
    || (kebabCase(String(title), { transliterate: false }) === "" && asciiStoryId(title, project.root) !== "");
}

// A path written with Windows separators resolves on Windows and fails on
// Linux and macOS (a CI runner, say), so warn on every platform.
export function validatePortablePaths(project, warnings) {
  if (project.story.unreadable) {
    return;
  }
  const data = project.story.data;
  for (const field of ["follows", "precedes", "cover"]) {
    const values = Array.isArray(data[field]) ? data[field] : [data[field]];
    for (const value of values.filter((item) => typeof item === "string" && item.includes("\\"))) {
      warnings.push(warn("backslash-path", `story.md ${field} ${value} uses a backslash; write ${portableSlashes(value)} so the path works on every system`, "story.md"));
    }
  }
}

export function portableSlashes(value) {
  return String(value).replace(/\\/g, "/");
}

// The target and, once the book is complete, the manuscript, against the
// form's usual range in the count unit. A language counted in characters
// without ranges of its own is not checked.
export function validateFormRange(project, warnings) {
  const data = project.story.data;
  const { unit } = project;
  const ranges = formRanges(unit, project.pack);
  const targetWarning = formRangeWarning(data.form, data[unit.targetField], `story.md ${unit.targetField}`, ranges, unit);
  if (targetWarning !== "") {
    warnings.push(warn("form-length-range", targetWarning, "story.md"));
  }
  if (data.status === "complete") {
    const length = project.chapters.reduce((sum, chapter) => sum + chapter.count, 0);
    const lengthWarning = formRangeWarning(data.form, length, "Manuscript length", ranges, unit);
    if (lengthWarning !== "") {
      warnings.push(warn("form-length-range", lengthWarning));
    }
  }
}

// A target in the other unit is never measured: progress, report, and the
// form range read only the count unit's target field.
export function unusedTargetWarnings(project, label, data, warnings) {
  const { unit } = project;
  const other = [...COUNT_UNITS.values()].find((entry) => entry !== unit);
  for (const field of ["targetField", "dailyTargetField"]) {
    if (data[other[field]] !== undefined && data[unit[field]] === undefined) {
      const why = project.story.data["count-unit"] === undefined ? `language ${project.language}` : "count-unit";
      warnings.push(warn("unused-target", `${label} ${other[field]} is not measured: this book counts ${unit.name} (${why}), so set ${unit[field]}`, label));
    }
  }
}

export function validateDeadline(data, errors) {
  if (data.deadline !== undefined) {
    // progress reads only string deadlines, so anything else must fail here
    // rather than silently switching the deadline off.
    const deadlineError = typeof data.deadline === "string" && data.deadline.trim() !== "" ? storyDateError(data.deadline) : "must be a YYYY-MM-DD date";
    if (deadlineError !== "") {
      errors.push(err("invalid-date", `story.md deadline ${deadlineError}`, "story.md"));
    }
  }
}

// The serial release cadence: an episode every `release-every` days, or
// months such as `1 month`, from `release-start`. Each needs the other, and
// the start is a real-world day, YYYY-MM-DD even in a book with a story
// calendar. `release-warn-days`, the days before a release that an
// undrafted episode is warned about, can be 0: only on the day and after.
export function validateReleaseCadence(data, errors) {
  const every = data["release-every"];
  const start = data["release-start"];
  const months = releaseMonths(every);
  if (Number.isInteger(every)) {
    requireInteger(data, "release-every", "story.md", errors, 1);
  } else if (months === 0) {
    errors.push(err("field-below-minimum", "story.md frontmatter field release-every must be at least 1 month", "story.md"));
  } else if (months > MAX_RELEASE_MONTHS) {
    errors.push(err("unsupported-value", `story.md frontmatter field release-every must be at most ${MAX_RELEASE_MONTHS} months`, "story.md"));
  } else if (every !== undefined && months === null) {
    // One rule for both forms, so a blank or non-integer value is
    // unsupported-value too, naming both.
    const got = every === null || (typeof every === "string" && every.trim() === "") ? "" : `, got ${JSON.stringify(every)}`;
    errors.push(err("unsupported-value", `story.md frontmatter field release-every must be a number of days, such as 7, or of months, such as 1 month${got}`, "story.md"));
  }
  requireInteger(data, "release-warn-days", "story.md", errors, 0);
  validateReleaseDate(start, "story.md release-start", "story.md", errors);
  if ((every === undefined) !== (start === undefined)) {
    const [set, unset] = every === undefined ? ["release-start", "release-every"] : ["release-every", "release-start"];
    errors.push(err("missing-field", `story.md ${set} needs ${unset} too: an episode every release-every days or months from release-start`, "story.md"));
  }
}

// A release date is a real-world day, so it is never read in the story.md
// calendar. progress and next read only string dates, so anything else is
// an error here rather than a silently unscheduled episode.
export function validateReleaseDate(value, name, label, errors) {
  if (value === undefined) {
    return;
  }
  const problem = typeof value === "string" && value.trim() !== "" ? storyDateError(value) : "must be a YYYY-MM-DD date";
  if (problem !== "") {
    errors.push(err("invalid-date", `${name} ${problem}`, label));
  }
}

// The daily targets, in either unit, and writing-days: the weekdays the
// streak expects writing on. An empty list, like none, means every day.
export function validateDailyTarget(data, errors) {
  for (const unit of COUNT_UNITS.values()) {
    requireInteger(data, unit.dailyTargetField, "story.md", errors, 1);
  }
  const days = data["writing-days"];
  if (days === undefined) {
    return;
  }
  if (!Array.isArray(days) || days.some((day) => weekdayName(day) === null)) {
    errors.push(err("unsupported-value", `story.md frontmatter field writing-days must be a list of weekdays (${WEEKDAYS.join(", ")}, or full names), got ${Array.isArray(days) ? `[${days.join(", ")}]` : days}`, "story.md"));
  }
}

export function validateCover(project, errors) {
  const cover = project.story.data.cover;
  if (cover === undefined) {
    return;
  }
  if (typeof cover !== "string" || cover.trim() === "") {
    errors.push(err("invalid-cover", "story.md cover must be a path to an image file", "story.md"));
    return;
  }
  try {
    coverImage(project);
  } catch (error) {
    errors.push(err("invalid-cover", error.message, "story.md"));
  }
}

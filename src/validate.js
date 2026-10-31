// Schema and link checks over a scanned project.
import fs from "node:fs";
import path from "node:path";
import { parseCalendar } from "./calendar.js";
import { FRONTMATTER_KEYS } from "./frontmatter-keys.js";
import { portablePath, projectPath, UNDO_LOG } from "./files.js";
import { interruptedChange } from "./undo.js";
import { COUNT_UNITS, STORY_FORMS } from "./forms.js";
import { validatePublishing } from "./publishing.js";
import { isIfid } from "./twee.js";
import { CHAPTER_NUMERALS, validateChapterNumerals } from "./numerals.js";
import { validateWritingMode, WRITING_MODES } from "./typesetting.js";
import { validateBuildStyle } from "./build-style.js";
import { validateCliConfig } from "./config.js";
import { validatePasses } from "./passes.js";
import { queryFindings } from "./list.js";
import { plural } from "./plural.js";
import { isBookNumber } from "./series.js";
import { err, warn } from "./findings.js";
import {
  STORY_SCHEMA_VERSION,
  REQUIRED_PATHS,
  INDEX_SCHEMAS,
  STORY_STATUSES,
  STORY_TENSES,
  DRAFT_MODES,
  MATTER_DIR,
  RESEARCH_DIR,
  scanProject,
  newerSchemaVersion,
  newerSchemaMessage,
  WINDOWS_RESERVED_ID,
  isKebabId,
  safeRead,
  ENTITY_SCAN_DIRS,
  substituteStoryIdWarnings
} from "./scan.js";
import {
  validateTextFields,
  validateSharedIds,
  validatePronunciations,
  requireScalar,
  requireInteger,
  validateStringArray,
  warnNearMissKeys,
  validateEnum,
  requireFields
} from "./validate-fields.js";
import { readRegistryValidationData, entityFileNames, collectStrayFileWarnings } from "./validate-files.js";
import {
  storyIdMismatch,
  storyIdIsFallback,
  validatePortablePaths,
  validateFormRange,
  unusedTargetWarnings,
  validateDeadline,
  validateReleaseCadence,
  validateDailyTarget,
  validateCover
} from "./validate-story.js";
import { sessionsWithoutCharacters, validateExemptions, validateProgressLog } from "./validate-logs.js";
import {
  validateCharacters,
  validateLocations,
  validateSystems,
  validateFactions,
  validateArtifacts,
  validateArcs,
  validateChapters,
  validateScenes,
  validateContinuityState,
  validateQuestions,
  validatePromises,
  validateClues,
  validateGlossaryTerms,
  validateStyleSheet,
  validateResearch,
  validateMatter
} from "./validate-entities.js";

export { requireInteger } from "./validate-fields.js";
export { sampleProblem, sampleDuplicate, samplePath } from "./validate-files.js";
export { validateDeadline, validateReleaseCadence, validateReleaseDate, validateDailyTarget } from "./validate-story.js";
export { sessionsWithoutCharacters, validateProgressLog } from "./validate-logs.js";
export { validateLinks, validateLinksOf } from "./validate-links.js";

export function validateProject(root) {
  return validateProjectOf(scanProject(root));
}

export function validateProjectOf(project) {
  const errors = [];
  const warnings = [];
  const projectRoot = project.root;
  for (const requiredPath of REQUIRED_PATHS) {
    if (!fs.existsSync(path.join(projectRoot, requiredPath))) {
      errors.push(err("missing-required-path", `Missing required path: ${requiredPath} (story migrate adds missing registries)`));
    }
  }
  for (const scanError of project.fileErrors ?? []) {
    errors.push(scanError);
  }
  validateStoryFrontmatter(project, errors, warnings);
  validateIndexFrontmatter(project, errors);
  validateCharacters(project, errors, warnings);
  validateLocations(project, errors, warnings);
  validateSystems(project, errors, warnings);
  validateFactions(project, errors, warnings);
  validateArtifacts(project, errors, warnings);
  validateArcs(project, errors, warnings);
  validateChapters(project, errors, warnings);
  validateScenes(project, errors, warnings);
  validateContinuityState(project, errors, warnings);
  validateQuestions(project, errors, warnings);
  validatePromises(project, errors, warnings);
  validateClues(project, errors, warnings);
  validateExemptions(project, errors, warnings);
  validateGlossaryTerms(project, errors, warnings);
  validateStyleSheet(project, errors, warnings);
  validateMatter(project, errors, warnings);
  validateResearch(project, errors, warnings);
  validateProgressLog(project, errors);
  warnings.push(...sessionsWithoutCharacters(project));
  validateFormRange(project, warnings);
  if (!project.story.unreadable) {
    unusedTargetWarnings(project, "story.md", project.story.data, warnings);
  }
  validatePublishing(project.story.data, errors, warnings);
  validatePronunciations(project, errors);
  validateTextFields(project, errors);
  validatePortablePaths(project, warnings);
  warnings.push(...substituteStoryIdWarnings(project));
  collectStrayFileWarnings(project, warnings);
  // A split, merge, move, rename, or remove that stopped part way left its
  // undo log, so the project holds only part of that change (see undo.js).
  // The log of one still running is its own.
  const interrupted = interruptedChange(projectRoot);
  if (interrupted !== null) {
    errors.push(err("interrupted-change", `${interrupted.command} stopped part way, and ${UNDO_LOG} holds what it changed: run story doctor --fix to put those files back, or run ${interrupted.command} again to finish it`, UNDO_LOG));
  }
  for (const file of ENTITY_SCAN_DIRS.flatMap((dir) => entityFileNames(projectRoot, dir))) {
    if (WINDOWS_RESERVED_ID.test(path.basename(file, ".md").toLowerCase())) {
      warnings.push(warn("windows-reserved-name", `${file} uses a file name Windows reserves, so the project cannot be checked out on Windows; rename the entity`, file));
    }
  }
  validateSharedIds(project, warnings);

  // Each registry link as [needle, file]: the needle is the link target the
  // registry must contain, the file is what the warning names.
  const linksFor = (items, prefix = "") => items.map((item) => [`](${prefix}${path.basename(item.file)})`, projectPath(projectRoot, item.file)]);
  const indexChecks = [
    ["characters/_index.md", linksFor(project.characters)],
    ["worldbuilding/_index.md", linksFor(project.locations, "locations/")
      .concat(linksFor(project.systems, "systems/"))
      .concat(linksFor(project.factions, "factions/"))
      .concat(linksFor(project.artifacts, "artifacts/"))],
    ["plot/_index.md", linksFor(project.arcs, "arcs/")],
    ["chapters/_index.md", linksFor(project.chapters)],
    ["scenes/_index.md", linksFor(project.scenes)],
    ["continuity/questions/_index.md", linksFor(project.questions)],
    ["continuity/promises/_index.md", linksFor(project.promises)],
    ["continuity/clues/_index.md", linksFor(project.clues)],
    ["glossary/_index.md", linksFor(project.glossaryTerms, "terms/")],
    // The matter and research registries are optional; reindex creates each
    // one alongside its folder.
    ...(fs.existsSync(path.join(projectRoot, MATTER_DIR, "_index.md"))
      ? [[path.posix.join(MATTER_DIR, "_index.md"), linksFor(project.matter)]]
      : []),
    ...(fs.existsSync(path.join(projectRoot, RESEARCH_DIR, "_index.md"))
      ? [[path.posix.join(RESEARCH_DIR, "_index.md"), linksFor(project.research)]]
      : [])
  ];

  for (const [indexPath, links] of indexChecks) {
    let markdown;
    try {
      markdown = safeRead(path.join(projectRoot, indexPath), projectRoot);
    } catch {
      // The registry frontmatter check reads each of these files the same
      // way and has already reported one it could not read.
      continue;
    }
    for (const [link, file] of links) {
      if (!markdown.includes(link)) {
        warnings.push(warn("stale-registry", `${portablePath(indexPath)} does not list ${file}; run story reindex`, indexPath));
      }
    }
  }

  for (const chapter of project.chapters) {
    const file = projectPath(projectRoot, chapter.file);
    if (chapter.declaredWordCount !== null && chapter.declaredWordCount !== chapter.wordCount) {
      warnings.push(warn("stale-word-count", chapter.wordCountMissing
        ? `${file} has no word-count (contains ${chapter.wordCount})`
        : `${file} declares ${plural(chapter.declaredWordCount, "word")} but contains ${chapter.wordCount}`, file));
    }
    // A project counted in characters records both counts; the same code
    // covers both, since story wordcount --write fixes both.
    if (project.unit.name === "characters" && chapter.declaredCount !== null && chapter.declaredCount !== chapter.count) {
      warnings.push(warn("stale-word-count", chapter.countMissing
        ? `${file} has no ${project.unit.countField} (contains ${chapter.count})`
        : `${file} declares ${plural(chapter.declaredCount, project.unit.noun)} but contains ${chapter.count}`, file));
    }

    if (chapter.todoMarkers > 0) {
      warnings.push(warn("todo-markers", `${file} has ${plural(chapter.todoMarkers, "[TODO marker")} in its prose, which every build prints: resolve ${chapter.todoMarkers === 1 ? "it" : "them"} or move ${chapter.todoMarkers === 1 ? "it" : "them"} into an HTML comment`, file));
    }

    if (chapter.unclosedComment) {
      warnings.push(warn("unclosed-comment", `${file} opens an HTML comment (<!--) that never closes, so the text after it shows in builds and word counts`, file));
    }

    if (chapter.outlineRunsOn) {
      warnings.push(warn("outline-without-chapter-text", `${file} has an ## Outline with no ## Chapter Text heading and no --- line below it, so builds read the prose as starting after the outline's last list item: put ## Chapter Text above the prose`, file));
    }

    if (chapter.setextBreaks.length > 0) {
      const one = chapter.setextBreaks.length === 1;
      warnings.push(warn("ambiguous-scene-break", `${file} has ${one ? "a --- scene break" : `${chapter.setextBreaks.length} --- scene breaks`} right under a line of text (${one ? "line" : "lines"} ${chapter.setextBreaks.join(", ")}): builds print ${one ? "a scene break" : "scene breaks"}, but markdown viewers read ${one ? "it as a heading underline" : "them as heading underlines"}, so put a blank line above ${one ? "it" : "each"}`, file));
    }

    if (chapter.footnotes.length > 0) {
      const one = chapter.footnotes.length === 1;
      warnings.push(warn("unsupported-footnote", `${file} has ${one ? "a footnote" : `${chapter.footnotes.length} footnotes`} (${one ? "line" : "lines"} ${chapter.footnotes.join(", ")}): builds print footnote markers ([^1]) and notes as written, where markdown viewers show footnotes, so work ${one ? "the note" : "each note"} into the prose or a back-matter page`, file));
    }

    if (!project.scenes.some((scene) => scene.chapter === chapter.id)) {
      warnings.push(warn("no-scene-records", `${file} has no machine-readable scene records`, file));
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateStoryFrontmatter(project, errors, warnings) {
  // An unreadable story.md is already reported; checking the stand-in data
  // would only add a missing-field error per field.
  if (project.story.unreadable) {
    return;
  }
  const data = project.story.data;
  warnNearMissKeys(data, FRONTMATTER_KEYS.story, "story.md", warnings);
  requireFields(data, ["title", "schema-version", "genre", "status", "themes", "pov", "tense"], "story.md", errors);
  requireScalar(data, "title", "story.md", errors);
  requireScalar(data, "genre", "story.md", errors);
  requireScalar(data, "status", "story.md", errors);
  validateStringArray(data, "themes", "story.md", errors);
  validateStringArray(data, "contact", "story.md", errors);
  validateStringArray(data, "authors", "story.md", errors);
  validateStringArray(data, "keywords", "story.md", errors);
  requireScalar(data, "pov", "story.md", errors);
  requireScalar(data, "tense", "story.md", errors);
  validateEnum(data, "status", STORY_STATUSES, "story.md", errors);
  validateEnum(data, "tense", STORY_TENSES, "story.md", errors);
  requireScalar(data, "series", "story.md", errors);
  if (data.series !== undefined && !isKebabId(data.series)) {
    errors.push(err("id-not-kebab", "story.md series must be a kebab-case id", "story.md"));
  }
  if (data["book-number"] !== undefined && !isBookNumber(data["book-number"])) {
    errors.push(err("invalid-book-number", "story.md book-number must be a number 0 or more, such as 2, 0 for a prequel, or 1.5 for a novella", "story.md"));
  }
  validateStringArray(data, "follows", "story.md", errors);
  validateStringArray(data, "precedes", "story.md", errors);
  if (data["season-goal"] !== undefined) {
    requireScalar(data, "season-goal", "story.md", errors);
  }
  if (data["target-words"] !== undefined) {
    requireInteger(data, "target-words", "story.md", errors, 1);
  }
  if (data["target-characters"] !== undefined) {
    requireInteger(data, "target-characters", "story.md", errors, 1);
  }
  validateEnum(data, "count-unit", COUNT_UNITS, "story.md", errors);
  validateEnum(data, "form", STORY_FORMS, "story.md", errors);
  if (data["draft-mode"] !== undefined) {
    requireScalar(data, "draft-mode", "story.md", errors);
    validateEnum(data, "draft-mode", DRAFT_MODES, "story.md", errors);
  }
  if (data["writing-mode"] !== undefined) {
    requireScalar(data, "writing-mode", "story.md", errors);
    validateEnum(data, "writing-mode", WRITING_MODES, "story.md", errors);
    validateWritingMode(data, errors);
  }
  if (data["chapter-numerals"] !== undefined) {
    requireScalar(data, "chapter-numerals", "story.md", errors);
    validateEnum(data, "chapter-numerals", CHAPTER_NUMERALS, "story.md", errors);
    validateChapterNumerals(data, errors);
  }
  validateCover(project, errors);
  validateBuildStyle(data, errors, project.root);
  validatePasses(data, "story.md", errors);
  validateCliConfig(data, errors);
  const queries = queryFindings(project);
  errors.push(...queries.errors);
  warnings.push(...queries.warnings);
  validateDeadline(data, errors);
  validateDailyTarget(data, errors);
  validateReleaseCadence(data, errors);
  for (const problem of parseCalendar(data.calendar).problems) {
    errors.push(err("invalid-calendar", `story.md calendar ${problem}`, "story.md"));
  }
  if (data.ifid !== undefined && !isIfid(data.ifid)) {
    errors.push(err("invalid-ifid", "story.md ifid must be a version 4 UUID, such as 3F2C9A61-7B1D-4E8A-9C3B-2A6D5E4F1B07", "story.md"));
  }

  if (newerSchemaVersion(data["schema-version"]) !== null) {
    errors.push(err("schema-too-new", newerSchemaMessage(newerSchemaVersion(data["schema-version"])), "story.md"));
  } else if (data["schema-version"] !== undefined && data["schema-version"] !== STORY_SCHEMA_VERSION) {
    errors.push(err("schema-version-mismatch", `story.md schema-version must be ${STORY_SCHEMA_VERSION}`, "story.md"));
  }
}

function validateIndexFrontmatter(project, errors) {
  for (const [relativePath, expectedType] of INDEX_SCHEMAS) {
    const label = relativePath;
    // A missing registry is already reported as a missing required path.
    if (!fs.existsSync(path.join(project.root, relativePath))) {
      continue;
    }
    const data = readRegistryValidationData(path.join(project.root, relativePath), project.root, label, errors);
    if (!data) {
      continue;
    }
    requireFields(data, ["type", "story"], label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "story", label, errors);

    if (data.type !== undefined && data.type !== expectedType) {
      errors.push(err("wrong-type", `${label} type must be ${expectedType}`, label));
    }

    if (data.story !== undefined && data.story !== project.storyId && !storyIdIsFallback(project)) {
      errors.push(storyIdMismatch(label, project));
    }

    if (relativePath === "plot/_index.md") {
      requireFields(data, ["structure"], label, errors);
      requireScalar(data, "structure", label, errors);
    }
  }
}

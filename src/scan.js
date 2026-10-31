// Project scan: read a story project into memory. This is the public entry
// for the scanner: the helpers it shares with the rest of the CLI, and the
// markdown new records are written from, live in the scan-*.js modules and
// are re-exported here, so importers keep using ./scan.js.
import fs from "node:fs";
import path from "node:path";
import { parseCalendar } from "./calendar.js";
import { parseFrontmatter } from "./frontmatter.js";
import { assertSafeProjectDirectory, lstatIfExists, readTextFile } from "./files.js";
import {
  chapterProse,
  countTodoMarkers,
  footnoteLines,
  hasUnclosedComment,
  outlineRunsIntoProse,
  setextSceneBreakLines,
  titleCaseSlug
} from "./markdown.js";
import { countUnit } from "./forms.js";
import { PROGRESS_FILE } from "./progress-file.js";
import { languagePack, projectLanguage } from "./languages/index.js";
import { withStyleLists } from "./languages/style.js";
import { readBookFrontmatter } from "./series.js";
import { err } from "./findings.js";
import { parseExemptions } from "./exemptions.js";
import { projectError } from "./exit-codes.js";
import { STYLE_SHEET_FILE, MATTER_DIR, RESEARCH_DIR } from "./scan-schema.js";
import { deriveStoryId } from "./scan-ids.js";
import {
  MAX_SCAN_FILES,
  requireStoryFile,
  readMarkdown,
  relativePathError,
  fileErrorMessage
} from "./scan-files.js";
import {
  chapterLength,
  fileLines,
  hasPostHocNotes,
  scanId,
  asIdArray,
  asArray,
  isPositiveIntegerValue,
  chapterNumber,
  sceneNumberFromFile,
  sceneChapterFromFile
} from "./scan-fields.js";
import { beatText } from "./scan-entity-files.js";

export {
  STORY_SCHEMA_VERSION,
  REQUIRED_PATHS,
  PROJECT_DIRECTORIES,
  INDEX_SCHEMAS,
  STORY_STATUSES,
  STORY_TENSES,
  CHARACTER_ROLES,
  CHARACTER_STATUSES,
  ARC_TYPES,
  ARC_STATUSES,
  CHAPTER_STATUSES,
  CHARACTER_ARC_TYPES,
  DRAFT_MODES,
  SCENE_STATUSES,
  FACTION_TYPES,
  FACTION_STATUSES,
  ARTIFACT_TYPES,
  ARTIFACT_STATUSES,
  QUESTION_STATUSES,
  PROMISE_STATUSES,
  CLUE_STATUSES,
  mayScheduleChapter,
  TERM_CATEGORIES,
  STYLE_DIALECTS,
  STYLE_SHEET_FILE,
  MATTER_PLACEMENTS,
  MATTER_PERMISSIONS,
  MATTER_DIR,
  RESEARCH_STATUSES,
  RESEARCH_ACCURACY,
  RESEARCH_CONFIDENCE,
  RESEARCH_METHODS,
  RESEARCH_RISKS,
  RESEARCH_DIR,
  SETTLED_CHAPTER_STATUSES,
  WRITTEN_CHAPTER_STATUSES,
  newerSchemaVersion,
  newerSchemaMessage,
  entityConfig,
  MULTI_KIND_REFERENCE_FIELDS,
  KIND_ALIASES,
  normalizeKind,
  REGISTRY_HINT,
  ENTITY_SCAN_DIRS,
  SOURCE_ROOT_FILES,
  SOURCE_DIRECTORIES
} from "./scan-schema.js";

export {
  deriveStoryId,
  asciiStoryId,
  substituteStoryIdWarnings,
  PATH_CONTROL_CHARACTERS,
  controlCharacterError,
  canonicalChapterId,
  requireSingleLineName,
  WINDOWS_RESERVED_ID,
  assertPortableFolderName,
  assertPortableId,
  requireKebabId,
  requestedEntityId,
  undeducibleIdMessage,
  parseDecimalInteger,
  requireBookNumber,
  requirePositiveInteger,
  isKebabId,
  fileStem
} from "./scan-ids.js";

export {
  SKIPPED_SCAN_DIRECTORIES,
  markdownFiles,
  MAX_SCAN_FILE_BYTES,
  MAX_SCAN_FILES,
  MAX_SCAN_DEPTH,
  requireStoryFile,
  readMarkdown,
  relativePathError,
  fileErrorMessage,
  safeRead,
  relative
} from "./scan-files.js";

export {
  asArray,
  CHAPTER_FILENAME_PATTERN,
  SCENE_FILENAME_PATTERN,
  chapterNumberFromFile
} from "./scan-fields.js";

export {
  mapOutsideLinks,
  LINK_DEFINITION_PATTERN,
  extractMarkdownLinkTargets
} from "./scan-links.js";

export {
  coverIsReady,
  coverImage,
  IMAGE_SIGNATURE_BYTES
} from "./scan-cover.js";

export {
  chapterChoices,
  CONTINUE_CHOICE,
  branchGraph
} from "./scan-branches.js";

export {
  storyBible,
  characterIndex,
  worldIndex,
  plotIndex,
  chapterIndex,
  timeline,
  sceneIndex,
  continuityState,
  questionIndex,
  promiseIndex,
  clueIndex,
  glossaryIndex,
  matterIndex,
  researchIndex,
  styleSheet
} from "./scan-registries.js";

export {
  buildEntity,
  BEAT_MAX_LENGTH,
  beatText,
  chapterFile,
  nextSceneNumber
} from "./scan-entity-files.js";

// The language of the story.md already at `root`, or null when there is
// none, so import into an existing project reads it as that book's language.
export function existingStoryLanguage(root) {
  const data = existingStoryData(root);
  return data === null ? null : projectLanguage(data);
}

// The style-sheet.md frontmatter in `root`, or null when there is none or
// it cannot be read (validate reports that). Read on its own, so a style
// sheet in a folder without story.md still counts.
export function existingStyleData(root) {
  try {
    return readStyleSheet(root, [])?.data ?? null;
  } catch {
    // `root` is a file, say: the import refuses it later, with its own message.
    return null;
  }
}

// The frontmatter of an existing story.md, {} when it does not parse, or
// null when there is none.
export function existingStoryData(root) {
  if (!lstatIfExists(path.join(root, "story.md"))) {
    return null;
  }
  try {
    return readBookFrontmatter(root) ?? {};
  } catch {
    return {};
  }
}

export function scanProject(root) {
  const projectRoot = path.resolve(root);
  const scanErrors = [];
  const storyPath = requireStoryFile(projectRoot);
  let story;
  try {
    story = readMarkdown(storyPath, projectRoot);
  } catch (error) {
    scanErrors.push(err("unreadable-file", fileErrorMessage("story.md", error), "story.md"));
    story = { data: { title: path.basename(projectRoot) }, body: "", rawMarkdown: "", unreadable: true };
  }
  const storyId = deriveStoryId(story.data.title, projectRoot);
  const titleText = typeof story.data.title === "string" || typeof story.data.title === "number" ? String(story.data.title).trim() : "";

  let continuity = null;
  const continuityPath = path.join(projectRoot, "continuity", "state.md");
  if (fs.existsSync(continuityPath)) {
    try {
      continuity = readMarkdown(continuityPath, projectRoot);
    } catch (error) {
      scanErrors.push(err("unreadable-file", fileErrorMessage("continuity/state.md", error), "continuity/state.md"));
      continuity = null;
    }
  }

  const language = projectLanguage(story.data);
  const pack = languagePack(language);
  const unit = countUnit(story.data, pack);
  const project = {
    root: projectRoot,
    story,
    storyId,
    // Display title: story.md `title`, else the folder name.
    title: titleText || path.basename(projectRoot),
    // story.md `language` (en when unset) and its language pack, which the
    // analysis commands take their word lists from, with the style sheet's
    // `replace-words` and `add-words` applied (below, once it is read).
    language,
    pack,
    // The unit lengths are counted in (see forms.js): words, or characters
    // for Chinese and Japanese.
    unit,
    // The story.md calendar (see calendar.js) chapter and scene dates are
    // read under: null for YYYY-MM-DD dates, `{ invalid: true }` when the
    // calendar has problems, which validate reports.
    calendar: parseCalendar(story.data.calendar).calendar,
    fileErrors: scanErrors,
    characters: readEntityFiles(projectRoot, "characters", (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      role: data.role ?? "",
      status: data.status ?? "",
      arc: String(data.arc ?? ""),
      diedIn: String(data["died-in"] ?? ""),
      revivedIn: String(data["revived-in"] ?? ""),
      relationships: asArray(data.relationships),
      locations: asArray(data.locations),
      aliases: asArray(data.aliases),
      voiceWords: asArray(data["voice-words"]),
      voiceAvoid: asArray(data["voice-avoid"]),
      pronunciation: data.pronunciation
    }), scanErrors),
    locations: readEntityFiles(projectRoot, "worldbuilding/locations", (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      region: data.region ?? "",
      notableCharacters: asArray(data["notable-characters"]),
      routes: asArray(data.routes),
      setting: typeof data.setting === "string" ? data.setting : "",
      pronunciation: data.pronunciation
    }), scanErrors),
    systems: readEntityFiles(projectRoot, "worldbuilding/systems", (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      pronunciation: data.pronunciation
    }), scanErrors),
    factions: readEntityFiles(projectRoot, "worldbuilding/factions", (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      members: asArray(data.members),
      locations: asArray(data.locations),
      pronunciation: data.pronunciation
    }), scanErrors),
    artifacts: readEntityFiles(projectRoot, "worldbuilding/artifacts", (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      owner: data.owner ?? "",
      location: data.location ?? "",
      pronunciation: data.pronunciation
    }), scanErrors),
    arcs: readEntityFiles(projectRoot, "plot/arcs", (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      characters: asArray(data.characters),
      themes: asArray(data.themes)
    }), scanErrors),
    chapters: readEntityFiles(projectRoot, "chapters", (id, file, data, markdown) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      // validate reports a number that is not a positive integer; views use
      // the file name's number instead of printing NaN, and builds refuse.
      number: chapterNumber(data.number, file),
      numberValid: data.number === undefined || isPositiveIntegerValue(data.number),
      // False for an unnumbered chapter (a prologue), which takes no printed
      // number (see printedChapterNumbers).
      numbered: data.numbered !== false,
      pov: scanId(data.pov),
      status: data.status ?? "",
      characters: asIdArray(data.characters),
      mentions: asIdArray(data.mentions),
      locations: asIdArray(data.locations),
      arcsAdvanced: asArray(data["arcs-advanced"]),
      // A non-integer count is a validate error; null keeps it out of the
      // declared-versus-actual comparison instead of printing NaN.
      declaredWordCount: data["word-count"] === undefined ? 0 : Number.isInteger(data["word-count"]) ? data["word-count"] : null,
      wordCountMissing: data["word-count"] === undefined,
      targetWords: Number.isInteger(data["target-words"]) && data["target-words"] > 0 ? data["target-words"] : 0,
      // wordCount, and the length in the project's count unit, which every
      // measure (progress, pacing, form ranges, registries) uses.
      ...chapterLength(unit, data, markdown),
      unclosedComment: hasUnclosedComment(chapterProse(markdown.body)),
      outlineRunsOn: outlineRunsIntoProse(markdown.body),
      todoMarkers: countTodoMarkers(chapterProse(markdown.body)),
      setextBreaks: fileLines(markdown, setextSceneBreakLines(markdown.body)),
      footnotes: fileLines(markdown, footnoteLines(markdown.body)),
      date: String(data.date ?? ""),
      time: String(data.time ?? ""),
      // Raw: a real-world YYYY-MM-DD day, or undefined; validate reports
      // anything else, and the release schedule leaves that episode out.
      releaseDate: data["release-date"],
      mode: String(data.mode ?? ""),
      strand: String(data.strand ?? ""),
      hasPostHocNotes: hasPostHocNotes(markdown.body),
      hook: typeof data.hook === "string" ? data.hook : "",
      // One line, as the grid, context, and codex show it; validate reports
      // a beat that is not text.
      beat: typeof data.beat === "string" ? beatText(data.beat) : "",
      // Raw: validate reports a malformed list, and chapterChoices keeps
      // only the usable entries.
      choices: data.choices
    }), scanErrors).sort((left, right) => left.number - right.number || left.file.localeCompare(right.file, "en")),
    scenes: readEntityFiles(projectRoot, "scenes", (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      // Coerce before the localeCompare sort below: a hand-written
      // `chapter: 3` parses as a number and must surface as a link error,
      // not a crash. Fall back to the chapter encoded in the filename.
      chapter: String(data.chapter ?? sceneChapterFromFile(file) ?? ""),
      scene: Number(data.scene ?? sceneNumberFromFile(file) ?? 0),
      pov: scanId(data.pov),
      location: scanId(data.location),
      status: data.status ?? "",
      characters: asIdArray(data.characters),
      mentions: asIdArray(data.mentions),
      arcsAdvanced: asArray(data["arcs-advanced"]),
      stateChanges: asArray(data["state-changes"]),
      date: String(data.date ?? ""),
      time: String(data.time ?? ""),
      travelHours: typeof data["travel-hours"] === "number" ? data["travel-hours"] : 0,
      sequel: typeof data.sequel === "boolean" ? data.sequel : false,
      outcome: typeof data.outcome === "string" ? data.outcome : "",
      dilemma: String(data.dilemma ?? ""),
      flashbackTo: String(data["flashback-to"] ?? ""),
      setting: typeof data.setting === "string" ? data.setting : ""
    }), scanErrors),
    questions: readEntityFiles(projectRoot, "continuity/questions", (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      introduced: String(data.introduced ?? ""),
      resolved: String(data.resolved ?? ""),
      characters: asArray(data.characters)
    }), scanErrors),
    promises: readEntityFiles(projectRoot, "continuity/promises", (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      planted: String(data.planted ?? ""),
      payoff: String(data.payoff ?? ""),
      arcs: asArray(data.arcs),
      characters: asArray(data.characters)
    }), scanErrors),
    clues: readEntityFiles(projectRoot, "continuity/clues", (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      planted: String(data.planted ?? ""),
      payoff: String(data.payoff ?? ""),
      significanceDelayed: data["significance-delayed"] === true,
      redHerring: data["red-herring"] === true,
      characters: asArray(data.characters),
      arcs: asArray(data.arcs)
    }), scanErrors),
    glossaryTerms: readEntityFiles(projectRoot, "glossary/terms", (id, file, data) => ({
      id,
      file,
      term: data.term ?? titleCaseSlug(id),
      category: data.category ?? "",
      aliases: asArray(data.aliases),
      pronunciation: data.pronunciation
    }), scanErrors),
    research: readEntityFiles(projectRoot, RESEARCH_DIR, (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      sources: asArray(data.sources),
      usedIn: asArray(data["used-in"]),
      accuracy: typeof data.accuracy === "string" ? data.accuracy : "",
      risk: asArray(data.risk),
      reviewedBy: asArray(data["reviewed-by"])
    }), scanErrors),
    matter: readEntityFiles(projectRoot, MATTER_DIR, (id, file, data, markdown) => {
      const title = String(data.title ?? titleCaseSlug(id));
      const prose = chapterProse(markdown.body);
      const empty = prose.trim() === "";
      return {
        id,
        file,
        title,
        placement: String(data.placement ?? ""),
        order: Number.isInteger(data.order) ? data.order : 0,
        heading: data.heading !== false,
        permission: typeof data.permission === "string" ? data.permission : "",
        empty,
        // Such as the `[TODO: author to supply]` the publishing skill leaves
        // on a copyright page's ISBN line, which builds print as written. The
        // title counts too: the EPUB contents name a page without a heading.
        // Builds leave out an empty page, markers and all.
        todoMarkers: empty ? 0 : countTodoMarkers(prose) + countTodoMarkers(title)
      };
    }, scanErrors).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, "en")),
    exemptions: readExemptions(projectRoot, scanErrors),
    styleSheet: readStyleSheet(projectRoot, scanErrors),
    progressLog: readOptionalRootFile(projectRoot, PROGRESS_FILE, scanErrors),
    continuity
  };
  project.pack = withStyleLists(project.pack, project.styleSheet?.data);
  sortScenesByChapter(project);
  return project;
}

// Scenes follow their chapters' numbers, so chapter-100 comes after
// chapter-99. A scene whose chapter is unknown falls back to the number in
// its chapter id, then to the id itself.
function sortScenesByChapter(project) {
  const numbers = new Map(project.chapters.map((chapter) => [chapter.id, chapter.number]));
  const chapterOrder = (id) => {
    const number = numbers.get(id);
    if (Number.isFinite(number)) {
      return number;
    }
    const match = /-(\d+)$/.exec(id);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
  };
  project.scenes.sort((left, right) => {
    const leftOrder = chapterOrder(left.chapter);
    const rightOrder = chapterOrder(right.chapter);
    return (leftOrder === rightOrder ? 0 : leftOrder < rightOrder ? -1 : 1)
      || left.chapter.localeCompare(right.chapter, "en")
      || left.scene - right.scene
      || left.file.localeCompare(right.file, "en");
  });
}

// Commands that rewrite registries or aggregate chapters would silently drop
// a file that fails to parse, so they stop and name it instead.
export function assertProjectParses(project, action, ignore = () => false) {
  // The style sheet, progress log, and exemptions never feed registries or
  // chapters.
  const ignored = [STYLE_SHEET_FILE, PROGRESS_FILE, "continuity/exemptions.md"];
  const errors = (project.fileErrors ?? []).filter((error) => !ignored.includes(error.file) && !ignore(error));
  if (errors.length > 0) {
    throw projectError(`Cannot ${action}: fix ${errors.length === 1 ? "this file first (story validate reports it)" : "these files first (story validate reports them)"}:\n${errors.map((error) => `- ${error.message}`).join("\n")}`);
  }
}

function readEntityFiles(root, relativeDir, mapEntity, scanErrors) {
  const directory = path.join(root, relativeDir);
  if (!fs.existsSync(directory)) {
    return [];
  }

  assertSafeProjectDirectory(directory, root);
  const entities = [];
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.') && entry.name !== '_index.md')
    .map((entry) => entry.name)
    .sort();
  if (files.length > MAX_SCAN_FILES) {
    throw projectError('Too many files in ' + relativeDir + ': ' + files.length + ' exceeds the ' + MAX_SCAN_FILES + ' file limit');
  }
  for (const file of files) {
    const fullPath = path.join(directory, file);
    const label = path.posix.join(relativeDir, file);
    try {
      const markdown = readMarkdown(fullPath, root);
      const entity = mapEntity(path.basename(file, ".md"), fullPath, markdown.data, markdown);
      // The parsed frontmatter, for checks on fields the entity does not map.
      // Not enumerable, so JSON reports stay as they were.
      Object.defineProperty(entity, "frontmatter", { value: markdown.data, enumerable: false });
      entities.push(entity);
    } catch (error) {
      // Every caller passes a scanErrors array, so per-file failures are
      // always collected instead of thrown.
      scanErrors.push(err("unreadable-file", fileErrorMessage(label, error), label));
    }
  }
  return entities;
}

// Reads continuity/exemptions.md when present. A missing or unparsable file
// means no exemptions; strict shape validation lives in validateExemptions.
function readExemptions(root, scanErrors) {
  const exemptionsPath = path.join(root, "continuity", "exemptions.md");
  if (!lstatIfExists(exemptionsPath)) {
    return [];
  }
  let raw;
  try {
    raw = readTextFile(exemptionsPath);
  } catch (error) {
    // A refused file (a symlink, say) must not silently drop every
    // exemption, so continuity reports it like a parse error.
    scanErrors.push(err("unreadable-file", fileErrorMessage("continuity/exemptions.md", relativePathError(error, exemptionsPath, root)), "continuity/exemptions.md"));
    return [];
  }

  let data;
  try {
    data = parseFrontmatter(raw, exemptionsPath).data;
  } catch {
    return [];
  }

  // Entries story validate rejects never take effect, so a bad entry
  // cannot blanket-exempt findings.
  return parseExemptions(data.exemptions);
}

// Reads an optional project-root markdown file such as progress.md. A
// missing file means null; a parse error is collected for validate.
function readOptionalRootFile(root, name, scanErrors) {
  const filePath = path.join(root, name);
  if (!lstatIfExists(filePath)) {
    return null;
  }
  try {
    const markdown = readMarkdown(filePath, root);
    return { file: filePath, data: markdown.data, rawMarkdown: markdown.rawMarkdown };
  } catch (error) {
    scanErrors.push(err("unreadable-file", fileErrorMessage(name, error), name));
    return null;
  }
}

// Reads the optional style-sheet.md. A missing file means no style sheet; a
// parse error is collected so validate reports it and callers see null.
function readStyleSheet(root, scanErrors) {
  const filePath = path.join(root, STYLE_SHEET_FILE);
  if (!lstatIfExists(filePath)) {
    return null;
  }
  try {
    const markdown = readMarkdown(filePath, root);
    return { file: filePath, data: markdown.data, body: markdown.body };
  } catch (error) {
    scanErrors.push(err("unreadable-file", fileErrorMessage(STYLE_SHEET_FILE, error), STYLE_SHEET_FILE));
    return null;
  }
}

// Project scan and entity records: read a story project into memory, and the markdown those records are written from.
import fs from "node:fs";
import path from "node:path";
import { storyDateError, storyTimeError } from "./continuity.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import {
  assertSafeProjectDirectory,
  assertSafeProjectPath,
  FILE_ERROR_REASONS,
  isPathInside,
  lstatIfExists,
  readTextFile
} from "./files.js";
import { isTruthy } from "./options.js";
import {
  chapterHeading,
  chapterProse,
  characterCount,
  countTodoMarkers,
  hasUnclosedComment,
  kebabCase,
  titleCaseSlug,
  wordCount
} from "./markdown.js";
import { COUNT_UNITS, countUnit, formRanges } from "./forms.js";
import { TWEE_LINK_UNSAFE } from "./twee.js";
import { PROGRESS_FILE } from "./progress.js";
import { languagePack, projectLanguage } from "./languages/index.js";
import { withStyleLists } from "./languages/style.js";
import { isBookNumber, readBookFrontmatter } from "./series.js";
import { err, warn } from "./findings.js";
import { parseExemptions } from "./exemptions.js";
import { projectError, usageError } from "./exit-codes.js";

export const STORY_SCHEMA_VERSION = 2;

// Only files are required. Entity folders such as worldbuilding/locations or
// plot/arcs start empty, and git does not keep empty directories, so a fresh
// clone of a new project would otherwise fail validation. Folders that hold a
// registry are implied by that registry file.
export const REQUIRED_PATHS = [
  "story.md",
  "characters/_index.md",
  "worldbuilding/_index.md",
  "plot/_index.md",
  "plot/timeline.md",
  "chapters/_index.md",
  "scenes/_index.md",
  "continuity/state.md",
  "continuity/questions/_index.md",
  "continuity/promises/_index.md",
  "continuity/clues/_index.md",
  "glossary/_index.md"
];

// Every folder init creates; migrate restores any that are missing.
export const PROJECT_DIRECTORIES = [
  "characters",
  path.join("worldbuilding", "locations"),
  path.join("worldbuilding", "systems"),
  path.join("worldbuilding", "factions"),
  path.join("worldbuilding", "artifacts"),
  path.join("plot", "arcs"),
  "chapters",
  "scenes",
  path.join("continuity", "questions"),
  path.join("continuity", "promises"),
  path.join("continuity", "clues"),
  path.join("glossary", "terms")
];

export const INDEX_SCHEMAS = [
  [path.join("characters", "_index.md"), "character-registry"],
  [path.join("worldbuilding", "_index.md"), "world-registry"],
  [path.join("plot", "_index.md"), "plot-registry"],
  [path.join("plot", "timeline.md"), "timeline"],
  [path.join("chapters", "_index.md"), "chapter-registry"],
  [path.join("scenes", "_index.md"), "scene-registry"],
  [path.join("continuity", "questions", "_index.md"), "question-registry"],
  [path.join("continuity", "promises", "_index.md"), "promise-registry"],
  [path.join("continuity", "clues", "_index.md"), "clue-registry"],
  [path.join("glossary", "_index.md"), "glossary-registry"]
];

export const STORY_STATUSES = new Set(["planning", "drafting", "in-progress", "revising", "complete", "abandoned"]);

export const STORY_TENSES = new Set(["past", "present", "future", "mixed"]);

export const CHARACTER_ROLES = new Set(["protagonist", "antagonist", "supporting", "minor", "narrator", "deuteragonist"]);

export const CHARACTER_STATUSES = new Set(["alive", "deceased", "unknown", "missing", "cut"]);

export const ARC_TYPES = new Set(["main", "subplot", "character", "thematic"]);

export const ARC_STATUSES = new Set(["planned", "in-progress", "resolved"]);

export const CHAPTER_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);

// A character's arc shape (theme-craft): which way the lie and truth move.
export const CHARACTER_ARC_TYPES = new Set(["change-positive", "change-negative", "flat"]);

// Chapter `mode` and story.md `draft-mode`: how the prose was written.
export const DRAFT_MODES = new Set(["discovered", "outlined"]);

export const SCENE_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);

export const FACTION_TYPES = new Set(["family", "guild", "government", "military", "religion", "company", "community", "criminal", "other"]);

export const FACTION_STATUSES = new Set(["active", "hidden", "declining", "defeated", "disbanded", "unknown"]);

export const ARTIFACT_TYPES = new Set(["object", "weapon", "document", "technology", "relic", "symbol", "resource", "other"]);

export const ARTIFACT_STATUSES = new Set(["active", "lost", "destroyed", "hidden", "transferred", "unknown"]);

export const QUESTION_STATUSES = new Set(["open", "answered", "resolved", "dropped", "abandoned"]);

export const PROMISE_STATUSES = new Set(["planned", "planted", "paid-off", "dropped", "abandoned"]);

export const CLUE_STATUSES = new Set(["planned", "planted", "paid-off", "dropped", "abandoned"]);

export const TERM_CATEGORIES = new Set(["person", "place", "faction", "artifact", "concept", "term", "other"]);

export const STYLE_DIALECTS = new Set(["british", "american", "unspecified"]);

export const STYLE_SHEET_FILE = "style-sheet.md";

export const MATTER_PLACEMENTS = new Set(["front", "back"]);

export const MATTER_PERMISSIONS = new Set(["not-needed", "pending", "granted", "public-domain"]);

export const MATTER_DIR = "matter";

export const RESEARCH_STATUSES = new Set(["open", "verified", "disputed"]);

export const RESEARCH_ACCURACY = new Set(["must-be-accurate", "blended", "invented"]);

export const RESEARCH_CONFIDENCE = new Set(["high", "medium", "low"]);

export const RESEARCH_METHODS = new Set(["fact", "interview", "site-visit", "expert-review", "reading"]);

export const RESEARCH_RISKS = new Set(["legal", "medical", "weapons", "safety", "cultural", "defamation", "technical"]);

export const RESEARCH_DIR = "research";

// Chapter statuses that mean the prose is settled, so it should not rest on
// research that is still open or disputed.
export const SETTLED_CHAPTER_STATUSES = new Set(["final", "complete"]);

export const WRITTEN_CHAPTER_STATUSES = new Set(["revised", "final", "complete"]);

// EPUB 3 core media types for a cover image, keyed by file extension.
const COVER_MEDIA_TYPES = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

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

// The story id is the kebab-case title, or the project folder name when the
// title is missing or has no ASCII letters or digits. Neither is
// transliterated: the id is recomputed on every run, so a Cyrillic or Greek
// title or folder name must give the id it always has.
export function deriveStoryId(title, root) {
  return kebabCase(String(title ?? ""), { transliterate: false }) || kebabCase(path.basename(root), { transliterate: false });
}

// A chapter's word count and its length in the count unit: `count`, the
// count its frontmatter declares in the unit's field (0 when missing, null
// when not an integer), and the target in the unit's target field (0 when
// unset). For a project counted in words these repeat the word fields.
function chapterLength(unit, data, markdown) {
  const prose = chapterProse(markdown.body);
  const words = wordCount(prose);
  const declared = data[unit.countField];
  const target = data[unit.targetField];
  return {
    wordCount: words,
    count: unit.name === "characters" ? characterCount(prose) : words,
    declaredCount: declared === undefined ? 0 : Number.isInteger(declared) ? declared : null,
    countMissing: declared === undefined,
    targetCount: Number.isInteger(target) && target > 0 ? target : 0
  };
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
      scanErrors.push(err("unreadable-file", fileErrorMessage(path.join("continuity", "state.md"), error), path.join("continuity", "state.md")));
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
    locations: readEntityFiles(projectRoot, path.join("worldbuilding", "locations"), (id, file, data) => ({
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
    systems: readEntityFiles(projectRoot, path.join("worldbuilding", "systems"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      pronunciation: data.pronunciation
    }), scanErrors),
    factions: readEntityFiles(projectRoot, path.join("worldbuilding", "factions"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      members: asArray(data.members),
      locations: asArray(data.locations),
      pronunciation: data.pronunciation
    }), scanErrors),
    artifacts: readEntityFiles(projectRoot, path.join("worldbuilding", "artifacts"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      owner: data.owner ?? "",
      location: data.location ?? "",
      pronunciation: data.pronunciation
    }), scanErrors),
    arcs: readEntityFiles(projectRoot, path.join("plot", "arcs"), (id, file, data) => ({
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
      todoMarkers: countTodoMarkers(chapterProse(markdown.body)),
      date: String(data.date ?? ""),
      time: String(data.time ?? ""),
      mode: String(data.mode ?? ""),
      strand: String(data.strand ?? ""),
      hasPostHocNotes: hasPostHocNotes(markdown.body),
      hook: typeof data.hook === "string" ? data.hook : "",
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
    questions: readEntityFiles(projectRoot, path.join("continuity", "questions"), (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      introduced: String(data.introduced ?? ""),
      resolved: String(data.resolved ?? ""),
      characters: asArray(data.characters)
    }), scanErrors),
    promises: readEntityFiles(projectRoot, path.join("continuity", "promises"), (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      planted: String(data.planted ?? ""),
      payoff: String(data.payoff ?? ""),
      arcs: asArray(data.arcs),
      characters: asArray(data.characters)
    }), scanErrors),
    clues: readEntityFiles(projectRoot, path.join("continuity", "clues"), (id, file, data) => ({
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
    glossaryTerms: readEntityFiles(projectRoot, path.join("glossary", "terms"), (id, file, data) => ({
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
    matter: readEntityFiles(projectRoot, MATTER_DIR, (id, file, data, markdown) => ({
      id,
      file,
      title: String(data.title ?? titleCaseSlug(id)),
      placement: String(data.placement ?? ""),
      order: Number.isInteger(data.order) ? data.order : 0,
      heading: data.heading !== false,
      permission: typeof data.permission === "string" ? data.permission : "",
      empty: chapterProse(markdown.body).trim() === ""
    }), scanErrors).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, "en")),
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
  const ignored = [STYLE_SHEET_FILE, PROGRESS_FILE, path.join("continuity", "exemptions.md")];
  const errors = (project.fileErrors ?? []).filter((error) => !ignored.includes(error.file) && !ignore(error));
  if (errors.length > 0) {
    throw projectError(`Cannot ${action}: fix ${errors.length === 1 ? "this file first (story validate reports it)" : "these files first (story validate reports them)"}:\n${errors.map((error) => `- ${error.message}`).join("\n")}`);
  }
}

// A schema-version above the one this CLI writes belongs to a newer
// story-skills; returns it as a number, or null.
export function newerSchemaVersion(value) {
  const version = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof version === "number" && Number.isFinite(version) && version > STORY_SCHEMA_VERSION ? version : null;
}

export function newerSchemaMessage(version) {
  return `story.md uses schema-version ${version}, newer than this CLI (${STORY_SCHEMA_VERSION}); upgrade story-skills`;
}

export function canonicalChapterId(number) {
  return `chapter-${String(number).padStart(2, "0")}`;
}

// Markdown link destinations, autolinks, and bare URLs: text where a bare id
// token is part of a path or address, not a reference to this book's record.
const LINK_OR_URL_PATTERN = /(\]\([^)\n]*\)|<[a-z][a-z0-9+.-]*:[^>\s]*>|\b[a-z][a-z0-9+.-]*:\/\/[^\s<>)\]]*)/gi;

// Applies `transform` to the parts of `body` outside link destinations and
// URLs, leaving those untouched.
export function mapOutsideLinks(body, transform) {
  return body.split(LINK_OR_URL_PATTERN).map((part, index) => (index % 2 === 1 ? part : transform(part))).join("");
}

export function storyBible(options) {
  const data = {
    title: options.title,
    "schema-version": STORY_SCHEMA_VERSION
  };
  if (options.series !== undefined) {
    data.series = options.series;
  }
  if (options.inherited?.["series-title"] !== undefined) {
    data["series-title"] = options.inherited["series-title"];
  }
  if (options.bookNumber !== undefined) {
    data["book-number"] = options.bookNumber;
  }
  Object.assign(data, {
    genre: options.genre,
    "sub-genre": options.subGenre,
    "setting-era": options.settingEra,
    status: "planning",
    themes: options.themes,
    pov: options.pov,
    tense: options.tense
  });
  for (const field of ["author", "authors", "language", "count-unit"]) {
    if (options.inherited?.[field] !== undefined) {
      data[field] = options.inherited[field];
    }
  }
  if (options.form !== undefined) {
    data.form = options.form;
    // In the book's count unit: target-characters for Chinese or Japanese.
    const target = formRanges(options.unit, options.pack)?.get(options.form)?.target ?? null;
    if (target !== null) {
      data[options.unit.targetField] = target;
    }
  }
  for (const field of ["follows", "precedes"]) {
    if (options[field].length > 0) {
      data[field] = options[field];
    }
  }
  return `${stringifyFrontmatter(data)}# ${options.title}

## Synopsis

${options.synopsis}

## Tone & Style

Add notes on the story's voice, texture, and emotional register.

## Notes

`;
}

// A registry table cell: a `|` would start a new column and a newline would
// end the row, so escape the one and flatten the other. Backslashes are
// escaped first, so a `\|` in a name stays a backslash and a pipe. A block scalar's
// closing newline would leave a trailing space, so the cell is trimmed.
function cell(value) {
  return String(value ?? "").replace(/[ \t]*(?:\r?\n|\r)[ \t]*/g, " ").trim().replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

export function characterIndex(storyId, characters, relationshipMap, familyTrees) {
  const rows = characters.length === 0
    ? ["| *No characters yet* | | | |"]
    : characters.map((character) => `| ${cell(character.name)} | ${cell(character.role)} | ${cell(character.status)} | [${character.id}](${character.id}.md) |`);

  return `${stringifyFrontmatter({ type: "character-registry", story: storyId })}# Characters

## Registry

| Name | Role | Status | File |
|------|------|--------|------|
${rows.join("\n")}

## Relationship Map

${relationshipMap || "*No relationships defined yet.*"}

## Family Trees

${familyTrees || "*No family trees defined yet.*"}
`;
}

export function worldIndex(storyId, locations, systems, factions, artifacts, overview) {
  const locationRows = locations.length === 0
    ? ["| *No locations yet* | | | |"]
    : locations.map((location) => `| ${cell(location.name)} | ${cell(titleCaseSlug(location.type))} | ${cell(location.region)} | [${location.id}](locations/${location.id}.md) |`);
  const systemRows = systems.length === 0
    ? ["| *No systems yet* | | |"]
    : systems.map((system) => `| ${cell(system.name)} | ${cell(titleCaseSlug(system.type))} | [${system.id}](systems/${system.id}.md) |`);
  const factionRows = factions.length === 0
    ? ["| *No factions yet* | | | |"]
    : factions.map((faction) => `| ${cell(faction.name)} | ${cell(titleCaseSlug(faction.type))} | ${cell(faction.status)} | [${faction.id}](factions/${faction.id}.md) |`);
  const artifactRows = artifacts.length === 0
    ? ["| *No artifacts yet* | | | |"]
    : artifacts.map((artifact) => `| ${cell(artifact.name)} | ${cell(titleCaseSlug(artifact.type))} | ${cell(artifact.status)} | [${artifact.id}](artifacts/${artifact.id}.md) |`);

  return `${stringifyFrontmatter({ type: "world-registry", story: storyId })}# Worldbuilding

## World Overview

${overview || "*Describe the world at a high level here.*"}

## Locations

| Name | Type | Region | File |
|------|------|--------|------|
${locationRows.join("\n")}

## Systems

| Name | Type | File |
|------|------|------|
${systemRows.join("\n")}

## Factions

| Name | Type | Status | File |
|------|------|--------|------|
${factionRows.join("\n")}

## Artifacts

| Name | Type | Status | File |
|------|------|--------|------|
${artifactRows.join("\n")}
`;
}

export function plotIndex(storyId, structure, arcs, storyStructure, themeTracking) {
  const arcRows = arcs.length === 0
    ? ["| *No arcs yet* | | | |"]
    : arcs.map((arc) => `| ${cell(arc.name)} | ${cell(arc.type)} | ${cell(arc.status)} | [${arc.id}](arcs/${arc.id}.md) |`);

  return `${stringifyFrontmatter({ type: "plot-registry", story: storyId, structure })}# Plot Structure

## Story Structure

${storyStructure || "**Model:** Three-Act Structure (adjust as needed)"}

## Arcs

| Name | Type | Status | File |
|------|------|--------|------|
${arcRows.join("\n")}

## Theme Tracking

${themeTracking || `| Theme | Arcs | Chapters |
|-------|------|----------|
| *No themes tracked yet* | | |`}
`;
}

// The chapter registry, with each chapter's length in the count unit.
export function chapterIndex(storyId, chapters, unit = COUNT_UNITS.get("words")) {
  const rows = chapters.length === 0
    ? ["| *No chapters yet* | | | | | |"]
    : chapters.map((chapter) => `| ${cell(chapter.number)} | ${cell(chapter.title)} | ${cell(chapter.pov)} | ${cell(chapter.status)} | ${cell(chapter.count)} | [${chapter.id}](${path.basename(chapter.file)}) |`);
  const total = chapters.reduce((sum, chapter) => sum + chapter.count, 0);
  const heading = `${unit.noun[0].toUpperCase()}${unit.noun.slice(1)} Count`;

  return `${stringifyFrontmatter({ type: "chapter-registry", story: storyId })}# Chapters

## Registry

| # | Title | POV | Status | ${heading} | File |
|---|-------|-----|--------|${"-".repeat(heading.length + 2)}|------|
${rows.join("\n")}

## Total ${heading}: ${total}
`;
}

export function timeline(storyId) {
  return `${stringifyFrontmatter({ type: "timeline", story: storyId })}# Story Timeline

| When | Event | Arc | Chapter |
|------|-------|-----|---------|
| *No events yet* | | | |
`;
}

export function sceneIndex(storyId, scenes) {
  const rows = scenes.length === 0
    ? ["| *No scenes yet* | | | | | |"]
    : scenes.map((scene) => `| ${cell(scene.chapter)} | ${cell(scene.scene)} | ${cell(scene.title)} | ${cell(scene.pov)} | ${cell(scene.status)} | [${scene.id}](${scene.id}.md) |`);

  return `${stringifyFrontmatter({ type: "scene-registry", story: storyId })}# Scenes

## Registry

| Chapter | Scene | Title | POV | Status | File |
|---------|-------|-------|-----|--------|------|
${rows.join("\n")}
`;
}

export function continuityState(storyId) {
  return `${stringifyFrontmatter({
    type: "continuity-state",
    story: storyId,
    "current-chapter": 0,
    "character-state": [],
    "object-state": [],
    "knowledge-state": []
  })}# Continuity State

## Current Story State

Track facts that must carry forward between chapters. The CLI reads the
\`character-state\`, \`object-state\`, and \`knowledge-state\` lists in the
frontmatter above; the tables below are optional notes it does not read.

## Character State

| Character | Location | Physical State | Emotional State | Knowledge |
|-----------|----------|----------------|-----------------|-----------|
| *No state entries yet* | | | | |

## Object State

| Artifact | Owner | Location | Status |
|----------|-------|----------|--------|
| *No object state entries yet* | | | |

## Knowledge State

| Character | Knows | Learned In |
|-----------|-------|------------|
| *No knowledge entries yet* | | |
`;
}

export function questionIndex(storyId, questions) {
  const rows = questions.length === 0
    ? ["| *No questions yet* | | | |"]
    : questions.map((question) => `| ${cell(question.title)} | ${cell(question.status)} | ${cell(question.introduced)} | [${question.id}](${question.id}.md) |`);

  return `${stringifyFrontmatter({ type: "question-registry", story: storyId })}# Continuity Questions

## Registry

| Question | Status | Introduced | File |
|----------|--------|------------|------|
${rows.join("\n")}
`;
}

export function promiseIndex(storyId, promises) {
  const rows = promises.length === 0
    ? ["| *No promises yet* | | | |"]
    : promises.map((promise) => `| ${cell(promise.title)} | ${cell(promise.status)} | ${cell(promise.planted)} | [${promise.id}](${promise.id}.md) |`);

  return `${stringifyFrontmatter({ type: "promise-registry", story: storyId })}# Promises And Payoffs

## Registry

| Promise | Status | Planted | File |
|---------|--------|---------|------|
${rows.join("\n")}
`;
}

export function clueIndex(storyId, clues) {
  const rows = clues.length === 0
    ? ["| *No clues yet* | | | |"]
    : clues.map((clue) => `| ${cell(clue.title)} | ${cell(clue.status)} | ${cell(clue.planted)} | [${clue.id}](${clue.id}.md) |`);

  return `${stringifyFrontmatter({ type: "clue-registry", story: storyId })}# Clue Ledger

## Registry

| Clue | Status | Planted | File |
|------|--------|---------|------|
${rows.join("\n")}
`;
}

export function glossaryIndex(storyId, terms) {
  const rows = terms.length === 0
    ? ["| *No terms yet* | | |"]
    : terms.map((term) => `| ${cell(term.term)} | ${cell(term.category)} | [${term.id}](terms/${term.id}.md) |`);

  return `${stringifyFrontmatter({ type: "glossary-registry", story: storyId })}# Glossary

## Registry

| Term | Category | File |
|------|----------|------|
${rows.join("\n")}
`;
}

export function matterIndex(storyId, pages) {
  const rows = pages.length === 0
    ? ["| *No matter pages yet* | | | |"]
    : pages.map((page) => `| ${cell(page.title)} | ${cell(page.placement)} | ${cell(page.order)} | [${page.id}](${page.id}.md) |`);

  return `${stringifyFrontmatter({ type: "matter-registry", story: storyId })}# Front And Back Matter

## Registry

| Title | Placement | Order | File |
|-------|-----------|-------|------|
${rows.join("\n")}
`;
}

export function researchIndex(storyId, notes) {
  const rows = notes.length === 0
    ? ["| *No research notes yet* | | | |"]
    : notes.map((note) => `| ${cell(note.title)} | ${cell(note.status)} | ${cell(note.usedIn.join(", "))} | [${note.id}](${note.id}.md) |`);

  return `${stringifyFrontmatter({ type: "research-registry", story: storyId })}# Research

## Registry

| Title | Status | Used In | File |
|-------|--------|---------|------|
${rows.join("\n")}
`;
}

export function styleSheet() {
  return `${stringifyFrontmatter({
    type: "style-sheet",
    dialect: "unspecified",
    preferred: [],
    "watch-words": [],
    "allow-words": []
  })}# Style Sheet

The book's house decisions, kept the way a copyeditor keeps them. Read this before drafting or revising prose. \`story prose\` enforces the lists in the frontmatter: \`dialect\` (british, american, or unspecified) flags the other dialect's common spellings, each \`preferred\` entry flags its \`avoid\` form, \`watch-words\` are counted in every chapter, and \`allow-words\` silences a built-in filter word or adverb. Add a \`samples\` list of your own prose (\`../book-one\`, approved chapters) and \`story prose\` compares each chapter with it instead of fixed limits.

## Voice

Narrative distance, sentence rhythm, register, and what this prose never does. Quote two or three sentences that sound exactly right.

## Spelling And Usage

Record one \`preferred\` entry per variant (\`use: grey\`, \`avoid: gray\`) and note usage rules here.

## Capitalisation

Titles, ranks, institutions, invented terms, and deities. Invented terms also belong in the glossary.

## Hyphenation And Compounds

## Numbers, Dates, And Time

Spelled-out or numerals, and how in-world dates and times are written.

## Dialogue And Punctuation

Quote marks, dash style, ellipses, italics for thought or foreign words, and the default dialogue tags.

## Character Voices

One entry per POV character or major speaker: vocabulary, sentence length, verbal tics, and words they never use.

## Watch List

Why each \`watch-words\` entry is there.
`;
}

// A name is one line: a line break would split the entity's heading and its
// registry row.
export function requireSingleLineName(name, kind) {
  if (/[\r\n]/.test(name)) {
    throw usageError(`A ${kind} name must be a single line`);
  }
}

export function buildEntity(project, kind, name, options) {
  const requestedId = requestedEntityId(kind, options.id);

  if (kind === "chapter") {
    const number = options.number === undefined
      ? project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0) + 1
      : requirePositiveInteger(options.number, "chapter number");
    const id = `chapter-${String(number).padStart(2, "0")}`;
    return entityResult(project, kind, id, chapterFile(name, number, options, project.unit));
  }

  if (kind === "scene") {
    if (options.chapter === undefined && project.chapters.length === 0) {
      throw usageError("No chapters yet: add one with story add chapter before adding a scene");
    }
    const chapter = String(options.chapter ?? project.chapters.at(-1).id).trim();
    requireKebabId(chapter, "chapter id");
    if (!project.chapters.some((entry) => entry.id === chapter)) {
      throw usageError(`chapter ${chapter} does not exist: add it with story add chapter, or pass --chapter with an existing chapter id`);
    }
    const scene = options.scene === undefined
      ? nextSceneNumber(project, chapter)
      : requirePositiveInteger(options.scene, "scene number");
    const id = `${chapter}-scene-${String(scene).padStart(2, "0")}`;
    return entityResult(project, kind, id, sceneFile(name, chapter, scene, options));
  }

  const id = requestedId ?? kebabCase(name);
  if (!id) {
    throw usageError(undeducibleIdMessage(kind, name));
  }

  switch (kind) {
    case "character":
      return entityResult(project, kind, id, characterFile(name, options));
    case "location":
      return entityResult(project, kind, id, locationFile(name, options));
    case "system":
      return entityResult(project, kind, id, systemFile(name, options));
    case "faction":
      return entityResult(project, kind, id, factionFile(name, options));
    case "artifact":
      return entityResult(project, kind, id, artifactFile(name, options));
    case "arc":
      return entityResult(project, kind, id, arcFile(name, options));
    case "question":
      return entityResult(project, kind, id, questionFile(name, options));
    case "promise":
      return entityResult(project, kind, id, promiseFile(name, options));
    case "clue":
      return entityResult(project, kind, id, clueFile(name, options));
    case "term":
      return entityResult(project, kind, id, termFile(name, options));
    case "matter":
      return entityResult(project, kind, id, matterFile(project, name, options));
    case "research":
      return entityResult(project, kind, id, researchFile(name, options));
  }
}

function entityResult(project, kind, id, markdown) {
  const config = entityConfig(kind);
  return { id, markdown, file: path.join(project.root, config.dir, `${id}.md`) };
}

export function entityConfig(kind) {
  const configs = {
    character: { dir: "characters", titleField: "name" },
    location: { dir: path.join("worldbuilding", "locations"), titleField: "name" },
    system: { dir: path.join("worldbuilding", "systems"), titleField: "name" },
    faction: { dir: path.join("worldbuilding", "factions"), titleField: "name" },
    artifact: { dir: path.join("worldbuilding", "artifacts"), titleField: "name" },
    arc: { dir: path.join("plot", "arcs"), titleField: "name" },
    chapter: { dir: "chapters", titleField: "title" },
    scene: { dir: "scenes", titleField: "title" },
    question: { dir: path.join("continuity", "questions"), titleField: "title" },
    promise: { dir: path.join("continuity", "promises"), titleField: "title" },
    clue: { dir: path.join("continuity", "clues"), titleField: "title" },
    term: { dir: path.join("glossary", "terms"), titleField: "term" },
    matter: { dir: MATTER_DIR, titleField: "title" },
    research: { dir: RESEARCH_DIR, titleField: "title" }
  };
  // normalizeKind has already rejected unknown kinds.
  return configs[kind];
}

export const KIND_ALIASES = {
  character: 'character',
  characters: 'character',
  location: 'location',
  locations: 'location',
  system: 'system',
  systems: 'system',
  faction: 'faction',
  factions: 'faction',
  artifact: 'artifact',
  artifacts: 'artifact',
  arc: 'arc',
  arcs: 'arc',
  chapter: 'chapter',
  chapters: 'chapter',
  scene: 'scene',
  scenes: 'scene',
  question: 'question',
  questions: 'question',
  promise: 'promise',
  promises: 'promise',
  clue: 'clue',
  clues: 'clue',
  term: 'term',
  terms: 'term',
  'glossary-term': 'term',
  'glossary-terms': 'term',
  glossary: 'term',
  matter: 'matter',
  research: 'research',
  'research-note': 'research',
  'research-notes': 'research'
};

export function normalizeKind(kind) {
  const normalized = String(kind ?? '').trim().toLowerCase();
  const expected = [...new Set(Object.values(KIND_ALIASES))].join(', ');
  if (normalized === '') {
    throw usageError(`An entity kind is required: expected one of ${expected}`);
  }
  if (!Object.hasOwn(KIND_ALIASES, normalized)) {
    throw usageError(`Unsupported entity kind: ${kind}: expected one of ${expected}`);
  }
  return KIND_ALIASES[normalized];
}

// Windows reserves these file names with any extension, so `con.md` cannot
// be checked out there.
export const WINDOWS_RESERVED_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

// A folder name every platform can check out: Windows also refuses reserved
// device names with an extension (con.txt), a trailing dot or space, and the
// characters < > : " | ? * and control characters.
export function assertPortableFolderName(name) {
  if (WINDOWS_RESERVED_ID.test(name.split(".")[0].trim().toLowerCase())) {
    throw usageError(`Cannot use folder ${name}: Windows reserves that name. Choose another --dir`);
  }
  if (/[. ]$/.test(name)) {
    throw usageError(`Cannot use folder "${name}": Windows does not allow a folder name ending in a dot or space. Choose another --dir`);
  }
  if (/[<>:"|?*\x00-\x1f]/.test(name)) {
    throw usageError(`Cannot use folder "${name}": Windows does not allow < > : " | ? * or control characters in folder names. Choose another --dir`);
  }
}

export function assertPortableId(id, kind) {
  if (WINDOWS_RESERVED_ID.test(id)) {
    const file = kind === "story" ? id : `${id}.md`;
    throw usageError(`Cannot use ${kind} id ${id}: Windows reserves the file name ${file}. Choose a longer name, such as "${id} ${kind}"`);
  }
}

export function requireKebabId(id, label) {
  if (!isKebabId(id)) {
    throw usageError(`${label} must be a kebab-case id, got "${id}"`);
  }
}

// `--id` for add and rename. Ids stay ASCII kebab-case, so a name written in a
// script with no ASCII letters or digits (Cyrillic, CJK, Greek, Arabic,
// Hebrew, Devanagari) needs one given by hand; the name itself is kept as
// written. Returns undefined when the id should come from the name instead.
export function requestedEntityId(kind, value) {
  const id = String(value ?? "").trim();
  if (id === "") {
    return undefined;
  }
  // Chapter and scene ids encode their numbers, so an id given by hand would
  // contradict the file's own frontmatter.
  if (kind === "chapter" || kind === "scene") {
    throw usageError(`--id does not apply to a ${kind}: a ${kind} id comes from its number. Use --number for a chapter, or --chapter and --scene for a scene`);
  }
  requireKebabId(id, `${kind} id`);
  return id;
}

export function undeducibleIdMessage(kind, name) {
  return `Cannot derive a kebab-case id from ${kind} name "${name}": pass --id with a kebab-case id, or use a name containing ASCII letters or digits`;
}

// A plain decimal integer (`12`, not `0x10`, `1e3`, or `2.0`) within the
// safe-integer range, or null. Number() alone accepts all of those forms and
// silently rounds past 2^53, which creates files validate then rejects.
export function parseDecimalInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

// 0 (a prequel) and decimals (a 1.5 novella) are valid publication numbers.
export function requireBookNumber(value) {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  const number = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  if (!isBookNumber(number)) {
    throw usageError(`Book number must be 0 or a positive number, such as 2, 0 for a prequel, or 1.5 for a novella; got ${value}`);
  }
  return number;
}

export function requirePositiveInteger(value, label) {
  const number = parseDecimalInteger(value);
  if (number === null || number <= 0) {
    throw usageError(`${label} must be a positive integer, got ${value}`);
  }
  return number;
}

export function isKebabId(value) {
  const text = String(value ?? "").trim();
  return text !== "" && text === kebabCase(text);
}

function characterFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    role: options.role ?? "supporting",
    status: options.status ?? "alive",
    aliases: [],
    relationships: [],
    locations: listOption(options, "locations", "location"),
    tags: [],
    arc: options.arc ?? ""
  })}# ${name}

## Appearance

Add physical details that matter on the page.

## Personality & Traits

Add behavior, temperament, habits, and contradictions.

## Backstory

Add only story-relevant history.

## Motivations & Goals

External want, internal need, and the conflict between them.

## Voice & Speech Patterns

Add 2-3 example lines.

## Character Arc

- **Starting state:**
- **Key turning points:**
- **Ending state:**

## Timeline

| When | Event | Relevance |
|------|-------|-----------|
| | | |
`;
}

function locationFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "other",
    region: options.region ?? "",
    population: options.population ?? "",
    "controlled-by": options["controlled-by"] ?? "",
    "notable-characters": listOption(options, "characters", "character"),
    tags: [],
    status: options.status ?? "unknown"
  })}# ${name}

## Description

Add sensory details and first impressions.

## History

Add relevant history.

## Culture & Customs

Add social norms, rituals, or local patterns.

## Notable Features

Add landmarks or practical story elements.

## Current State

Add what is true at the current story moment.
`;
}

function systemFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "other",
    prevalence: options.prevalence ?? "uncommon"
  })}# ${name}

## Overview

Summarize the system and why it matters.

## Rules & Limitations

Define costs, limits, and exceptions.

## History

Add origin and changes over time.

## Practitioners

Add users, institutions, or gatekeepers.

## Impact on Society

Add consequences for daily life and conflict.
`;
}

function factionFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "other",
    status: options.status ?? "active",
    members: listOption(options, "members", "member", "characters", "character"),
    locations: listOption(options, "locations", "location"),
    tags: []
  })}# ${name}

## Purpose

What the faction wants and why it exists.

## Power Base

Resources, influence, territory, leverage, or rituals.

## Members

Important members and their roles.

## Conflicts

Internal and external pressures.
`;
}

function artifactFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "object",
    status: options.status ?? "active",
    owner: options.owner ?? "",
    location: options.location ?? "",
    tags: []
  })}# ${name}

## Description

What it is and how readers recognize it.

## Function

What it can do, cannot do, costs, and constraints.

## History

Where it came from and why it matters.

## Current State

Who has it, where it is, and what changed recently.
`;
}

function arcFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "subplot",
    status: options.status ?? "planned",
    characters: listOption(options, "characters", "character"),
    themes: listOption(options, "themes", "theme"),
    acts: listOption(options, "acts", "act")
  })}# ${name}

## Setup

Initial state and inciting pressure.

## Rising Action

1. First escalation
2. Second escalation
3. Reversal or complication

## Climax

Decision point or highest tension.

## Resolution

What changes because of this arc.

## Plot Points

| # | Plot Point | Act | Chapter | Status | Notes |
|---|------------|-----|---------|--------|-------|
| 1 | | | | planned | |

## Foreshadowing

| Planted | Payoff | Chapter Planted | Chapter Payoff | Status |
|---------|--------|-----------------|----------------|--------|
| | | | | planned |
`;
}

export function chapterFile(title, number, options, unit) {
  const dateError = storyDateError(options.date);
  if (dateError) {
    throw usageError(dateError);
  }
  const timeError = storyTimeError(options.time);
  if (timeError) {
    throw usageError(timeError);
  }
  return `${stringifyFrontmatter({
    title,
    number,
    pov: options.pov ?? "",
    locations: listOption(options, "locations", "location"),
    characters: castWithPov(options),
    mentions: listOption(options, "mentions", "mention"),
    "arcs-advanced": listOption(options, "arcs", "arc"),
    status: options.status ?? "outline",
    mode: options.mode ?? "",
    date: options.date ?? "",
    time: options.time ?? "",
    ...(options.hook === undefined ? {} : { hook: options.hook }),
    "word-count": 0,
    // A book counted in characters records character-count too.
    ...(unit.name === "characters" ? { "character-count": 0 } : {})
  })}# ${chapterHeading(number, title)}

## Outline

1. Opening beat
2. Escalation
3. Turn or decision

---

## Chapter Text

`;
}

function sceneFile(title, chapter, scene, options) {
  const dateError = storyDateError(options.date);
  if (dateError) {
    throw usageError(dateError);
  }
  const timeError = storyTimeError(options.time);
  if (timeError) {
    throw usageError(timeError);
  }
  const travelHoursOption = options["travel-hours"];
  let travelHours;
  if (travelHoursOption !== undefined && travelHoursOption !== "") {
    travelHours = Number(travelHoursOption);
    if (!Number.isFinite(travelHours)) {
      throw usageError(`travel-hours must be a number, got ${travelHoursOption}`);
    }
    if (travelHours < 0) {
      throw usageError(`travel-hours must be zero or positive, got ${travelHoursOption}`);
    }
  }
  const frontmatter = {
    title,
    chapter,
    scene,
    pov: options.pov ?? "",
    location: options.location ?? "",
    characters: castWithPov(options),
    mentions: listOption(options, "mentions", "mention"),
    "arcs-advanced": listOption(options, "arcs", "arc"),
    status: options.status ?? "outline",
    date: options.date ?? "",
    time: options.time ?? "",
    sequel: options.sequel ?? false,
    ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
    dilemma: options.dilemma ?? "",
    "state-changes": []
  };
  if (travelHours !== undefined) {
    frontmatter["travel-hours"] = travelHours;
  }
  return `${stringifyFrontmatter(frontmatter)}# ${title}

## Purpose

What this scene changes.

## Continuity Notes

Character state, object state, knowledge changes, and timeline facts.
`;
}

// The POV character is on the page, so it belongs in the cast; continuity
// warns about a POV missing from `characters`.
function castWithPov(options) {
  const characters = listOption(options, "characters", "character");
  const pov = String(options.pov ?? "").trim();
  return pov === "" || characters.includes(pov) ? characters : [pov, ...characters];
}

function questionFile(title, options) {
  const resolved = String(options.resolved ?? "").trim();
  if (resolved !== "" && options.status === "open") {
    throw usageError("A question with --resolved cannot have status open: use --status answered or resolved");
  }
  return `${stringifyFrontmatter({
    title,
    // A resolved chapter means the answer is on the page.
    status: options.status ?? (resolved === "" ? "open" : "answered"),
    introduced: options.introduced ?? "",
    resolved: options.resolved ?? "",
    characters: listOption(options, "characters", "character")
  })}# ${title}

## Question

What the reader or continuity tracker needs answered.

## Evidence

Known clues, constraints, and contradictions.

## Resolution Plan

How and when this should resolve.
`;
}

function promiseFile(title, options) {
  return `${stringifyFrontmatter({
    title,
    status: options.status ?? plantedDefaultStatus(options),
    planted: options.planted ?? "",
    payoff: options.payoff ?? "",
    arcs: listOption(options, "arcs", "arc"),
    characters: listOption(options, "characters", "character")
  })}# ${title}

## Setup

What is promised to the reader.

## Payoff

How the story should answer the setup.

## Tracking Notes

Keep planted and payoff chapters current.
`;
}

// A promise or clue created with --planted is already on the page, so its
// default status follows the chapter rather than contradicting it.
function plantedDefaultStatus(options) {
  return String(options.planted ?? "").trim() !== "" ? "planted" : "planned";
}

function clueFile(title, options) {
  return `${stringifyFrontmatter({
    title,
    status: options.status ?? plantedDefaultStatus(options),
    planted: options.planted ?? "",
    payoff: options.payoff ?? "",
    "significance-delayed": options["significance-delayed"] ?? false,
    ...(options["red-herring"] ? { "red-herring": true } : {}),
    characters: listOption(options, "characters", "character"),
    arcs: listOption(options, "arcs", "arc")
  })}# ${title}

## Clue

What the reader sees and why it matters.

## Planting Plan

How and when to plant it.

## Payoff Plan

How the payoff lands.

## Tracking Notes

Keep planted and payoff chapters current.
`;
}

function termFile(term, options) {
  return `${stringifyFrontmatter({
    term,
    category: options.category ?? "term",
    aliases: listOption(options, "aliases", "alias")
  })}# ${term}

## Definition

Define the term in story context.

## Usage Notes

How agents should use this term consistently.
`;
}

function researchFile(title, options) {
  return `${stringifyFrontmatter({
    title,
    status: options.status ?? "open",
    // Citations contain commas, so sources are kept whole, one per flag.
    sources: [...new Set(asArray(options.sources).concat(asArray(options.source)).map((source) => String(source).trim()).filter(Boolean))],
    "used-in": listOption(options, "used-in"),
    ...researchOptionalFields(options)
  })}# ${title}

## Question

What the story needs to get right.

## Findings

The facts, with the source for each.

## Story Use

How the chapters use these facts, and what was changed on purpose.
`;
}

function researchOptionalFields(options) {
  const fields = {};
  for (const key of ["accuracy", "confidence", "method"]) {
    if (options[key] !== undefined) {
      fields[key] = String(options[key]);
    }
  }
  const risks = listOption(options, "risk");
  for (const risk of risks) {
    if (!RESEARCH_RISKS.has(risk)) {
      throw usageError(`Unsupported risk "${risk}": expected one of ${[...RESEARCH_RISKS].join(", ")}`);
    }
  }
  if (risks.length > 0) {
    fields.risk = risks;
  }
  return fields;
}

function matterFile(project, title, options) {
  const placement = String(options.placement ?? "front");
  let order;
  if (options.order === undefined) {
    order = project.matter.filter((matter) => matter.placement === placement).reduce((max, matter) => Math.max(max, matter.order), 0) + 1;
  } else {
    order = parseDecimalInteger(options.order);
    if (order === null) {
      throw usageError(`matter order must be a non-negative integer, got ${options.order}`);
    }
  }
  // --heading false suits a dedication or epigraph, which prints no title.
  const heading = options.heading === undefined ? true : isTruthy(options.heading);
  return `${stringifyFrontmatter({ title, placement, order, heading })}# ${title}

`;
}

export function nextSceneNumber(project, chapter) {
  return project.scenes
    .filter((scene) => scene.chapter === chapter)
    .reduce((max, scene) => Math.max(max, scene.scene), 0) + 1;
}

// A reference-style link definition: indent, label, target.
export const LINK_DEFINITION_PATTERN = /^( {0,3}\[)([^\]\n]+)\]:[ \t]*(<[^>\n]*>|[^\s]+)/gm;

export const REGISTRY_HINT = " (it is a registry: run story reindex to rebuild it)";

// Folders that never hold project prose: build output, installed packages
// (a local story-skills install ships its own examples), and dot-folders.
export const SKIPPED_SCAN_DIRECTORIES = new Set(["dist", "node_modules"]);

// Markdown files a rename or remove may rewrite. Folders deeper than the
// scan limit are skipped rather than fatal, so an unrelated deep notes tree
// cannot block the command.
export function markdownFiles(root, { maxFiles = MAX_SCAN_FILES } = {}, depth = 0, collected = null) {
  const files = collected ?? [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory() && !SKIPPED_SCAN_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
      // A subfolder with its own story.md is another project: never rewrite it.
      if (depth < MAX_SCAN_DEPTH && !fs.existsSync(path.join(fullPath, "story.md"))) {
        markdownFiles(fullPath, { maxFiles }, depth + 1, files);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
      files.push(fullPath);
      if (files.length > maxFiles) {
        throw projectError(`Too many markdown files in the project: the scan exceeds the ${MAX_SCAN_FILES} file limit`);
      }
    }
  }
  if (depth === 0) {
    files.sort();
  }
  return files;
}

// A chapter's usable `choices` as { text, to } pairs, and the problems
// validate reports for the rest. The text becomes a Twine link, so it may not
// hold link syntax; `to` names the chapter the choice leads to.
export function chapterChoices(chapter, label) {
  const choices = [];
  const problems = [];
  if (chapter.choices === undefined) {
    return { choices, problems };
  }
  if (!Array.isArray(chapter.choices)) {
    problems.push(err("field-not-list", `${label} frontmatter field choices must be a list of { text, to } entries`, label));
    return { choices, problems };
  }
  chapter.choices.forEach((choice, index) => {
    const at = `${label} choices[${index}]`;
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
      problems.push(err("invalid-choice", `${at} must have text and to, such as { text: Follow the light, to: chapter-02 }`, label));
      return;
    }
    const text = typeof choice.text === "string" ? choice.text.trim() : "";
    // Not trimmed: move and remove match the id exactly, so a padded
    // `to: "chapter-03 "` would be left behind by them.
    const to = typeof choice.to === "string" ? choice.to : "";
    const before = problems.length;
    if (text === "") {
      problems.push(err("invalid-choice", `${at} needs text: the words the reader picks, quoted if they look like a number`, label));
    } else if (TWEE_LINK_UNSAFE.test(text)) {
      problems.push(err("invalid-choice", `${at} text cannot contain [, ], |, ->, <-, or a line break, or end in <, which Twine reads as link syntax`, label));
    }
    if (to.trim() === "") {
      problems.push(err("invalid-choice", `${at} needs to: the id of the chapter it leads to, such as chapter-02`, label));
    } else if (to !== kebabCase(to)) {
      problems.push(err("id-not-kebab", `${at} to ${to} must be a kebab-case chapter id`, label));
    }
    if (problems.length === before) {
      choices.push({ text, to, index });
    }
  });
  return { choices, problems };
}

// The chapters as passages of a branching story. With no choices anywhere
// the book is linear and each chapter continues to the next; once any
// chapter has choices, a chapter's links are exactly its choices and one
// without them is an ending. Errors name choices that lead nowhere; warnings
// name chapters no path from the first chapter reaches. `problems` are the
// malformed choices validate reports, and `missing` the choices whose chapter
// does not exist.
export function branchGraph(project) {
  const ids = new Set(project.chapters.map((chapter) => chapter.id));
  const parsed = project.chapters.map((chapter) => {
    const label = relative(project, chapter.file);
    return { chapter, label, ...chapterChoices(chapter, label) };
  });
  const branching = parsed.some((entry) => entry.choices.length > 0);
  const problems = parsed.flatMap((entry) => entry.problems);
  const missing = [];
  const warnings = [];
  const passages = parsed.map((entry, position) => {
    if (!branching) {
      const next = project.chapters[position + 1];
      return { chapter: entry.chapter, links: next ? [{ text: "Continue", to: next.id }] : [] };
    }
    for (const choice of entry.choices) {
      if (!ids.has(choice.to)) {
        missing.push({ to: choice.to, finding: err("missing-reference", `${entry.label} choices[${choice.index}] references missing chapter ${choice.to}`, entry.label) });
      }
    }
    return { chapter: entry.chapter, links: entry.choices.filter((choice) => ids.has(choice.to)).map(({ text, to }) => ({ text, to })) };
  });
  if (branching) {
    const byId = new Map(passages.map((passage) => [passage.chapter.id, passage]));
    const start = passages[0].chapter.id;
    const reached = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      for (const link of byId.get(queue.shift()).links) {
        if (!reached.has(link.to)) {
          reached.add(link.to);
          queue.push(link.to);
        }
      }
    }
    for (const passage of passages) {
      if (!reached.has(passage.chapter.id)) {
        warnings.push(warn("unreachable-chapter", `${relative(project, passage.chapter.file)} cannot be reached: no choice path from ${start} leads to it`, relative(project, passage.chapter.file)));
      }
    }
  }
  return { branching, passages, problems, missing, warnings };
}

export const MAX_SCAN_FILE_BYTES = 5 * 1024 * 1024;

export const MAX_SCAN_FILES = 5000;

export const MAX_SCAN_DEPTH = 10;

// Retail cover images run larger than any text file; 50 MiB matches the
// largest cover upload the main retailers take.
const MAX_COVER_BYTES = 50 * 1024 * 1024;

// For binary files such as the cover; text files go through readTextFile.
function assertFileSizeWithinLimit(filePath, limit = MAX_SCAN_FILE_BYTES) {
  const size = fs.statSync(filePath).size;
  if (size > limit) {
    throw projectError('Refusing to read oversized file ' + filePath + ': ' + size + ' bytes exceeds the ' + limit + ' byte limit');
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
    const label = path.join(relativeDir, file);
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

// Commands never search parent folders for story.md (see
// docs/project-format.md), but a run from inside a project, such as its
// chapters/ folder, gets a hint naming the nearest project root above it.
// Post-hoc notes count only above `## Chapter Text`: everything below that
// heading is prose, counted and exported as part of the book.
function hasPostHocNotes(body) {
  const chapterText = /^## Chapter Text\s*$/im.exec(body);
  return chapterText !== null && /^## Chapter Notes \(post-hoc\)\s*$/m.test(body.slice(0, chapterText.index));
}

function parentProjectHint(projectRoot) {
  let current = path.dirname(projectRoot);
  while (!fs.existsSync(path.join(current, "story.md"))) {
    if (path.dirname(current) === current) {
      return "";
    }
    current = path.dirname(current);
  }
  const relative = path.relative(process.cwd(), current) || ".";
  const shown = relative.length < current.length ? relative : current;
  return ` (the project root looks like ${shown}; pass that path instead)`;
}

export function requireStoryFile(projectRoot) {
  const storyPath = path.join(projectRoot, "story.md");
  if (!fs.existsSync(storyPath)) {
    // Tab completion often lands on story.md itself; name the folder instead.
    if (fs.statSync(projectRoot, { throwIfNoEntry: false })?.isFile()) {
      throw projectError(`${projectRoot} is a file; pass the folder that contains it`);
    }
    const hint = path.basename(projectRoot).startsWith("-") ? `; ${path.basename(projectRoot)} is not an option (run story help)` : parentProjectHint(projectRoot);
    throw projectError(`${projectRoot} is not a story project: missing story.md${hint}`);
  }
  return storyPath;
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
    scanErrors.push(err("unreadable-file", fileErrorMessage(path.join("continuity", "exemptions.md"), relativePathError(error, exemptionsPath, root)), path.join("continuity", "exemptions.md")));
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

export function readMarkdown(filePath, root) {
  let rawMarkdown;
  try {
    if (root) {
      assertSafeProjectPath(filePath, root);
    }
    rawMarkdown = readTextFile(filePath);
  } catch (error) {
    throw root ? relativePathError(error, filePath, root) : error;
  }
  try {
    return { ...parseFrontmatter(rawMarkdown, filePath), rawMarkdown };
  } catch (error) {
    // Callers label the file with its project-relative path, so drop the
    // absolute one the parser puts in front.
    throw projectError(error.message.startsWith(`${filePath} `) ? error.message.slice(filePath.length + 1) : error.message);
  }
}

// A refusal to read a project file (a symlink, a directory) names the file by
// its path inside the project, so CI logs do not show home directories. A
// file-system error (permission denied) is put in plain words after the path
// rather than Node's "EACCES: ..., open '<path>'".
export function relativePathError(error, filePath, root) {
  const relativePath = path.relative(root, filePath);
  const reason = typeof error.code === "string" && error.path === filePath ? FILE_ERROR_REASONS[error.code] : undefined;
  if (reason) {
    return projectError(`${relativePath}: Cannot read: ${reason}`);
  }
  return projectError(error.message.split(filePath).join(relativePath).split(path.resolve(root, relativePath)).join(relativePath));
}

// Labels a scan error with the file's project-relative path, once: a message
// that already starts with that path (a read refusal, a non-UTF-8 file) drops
// it rather than print it twice.
export function fileErrorMessage(label, error) {
  for (const prefix of [`${label}: `, `${label} `]) {
    if (error.message.startsWith(prefix)) {
      return `${label}: ${error.message.slice(prefix.length)}`;
    }
  }
  return `${label}: ${error.message}`;
}

export function safeRead(filePath, root) {
  if (!fs.existsSync(filePath)) {
    return "";
  }

  if (root) {
    assertSafeProjectPath(filePath, root);
  }
  return readTextFile(filePath);
}

export const ENTITY_SCAN_DIRS = [
  "characters",
  "chapters",
  "scenes",
  path.join("worldbuilding", "locations"),
  path.join("worldbuilding", "systems"),
  path.join("worldbuilding", "factions"),
  path.join("worldbuilding", "artifacts"),
  path.join("plot", "arcs"),
  path.join("continuity", "questions"),
  path.join("continuity", "promises"),
  path.join("continuity", "clues"),
  path.join("glossary", "terms"),
  MATTER_DIR,
  RESEARCH_DIR
];

// Build artifacts are named after the story id; keep the name well inside
// file-system limits (255 bytes) for very long titles.
export function fileStem(storyId) {
  if (storyId.length <= 100) {
    return storyId;
  }
  const cut = storyId.slice(0, 100);
  return cut.slice(0, cut.lastIndexOf("-") > 0 ? cut.lastIndexOf("-") : 100);
}

// Paths that hold project source. Generated output must never land there:
// an --out pointing at a chapter would silently replace the prose.
export const SOURCE_ROOT_FILES = new Set(["story.md", STYLE_SHEET_FILE, PROGRESS_FILE]);

export const SOURCE_DIRECTORIES = ["characters", "chapters", "scenes", "worldbuilding", "plot", "continuity", "glossary", MATTER_DIR, RESEARCH_DIR];

// Hand-written ids such as `47` or `true` parse as numbers or booleans; read
// them as the string ids they name. Anything else is left for validate.
function scanId(value) {
  return typeof value === "number" || typeof value === "boolean" ? String(value) : value ?? "";
}

function asIdArray(value) {
  return asArray(value).map((item) => (typeof item === "number" || typeof item === "boolean" ? String(item) : item));
}

export function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [value];
}

// A list option with its singular and plural flags merged, duplicates
// dropped: `--character a --characters b` keeps both.
function listOption(options, ...names) {
  const list = [];
  for (const name of names) {
    for (const value of normalizeList(options[name], [])) {
      if (!list.includes(value)) {
        list.push(value);
      }
    }
  }
  return list;
}

export function normalizeList(value, fallback) {
  const values = value === undefined || value === true ? [] : Array.isArray(value) ? value : [value];
  const list = [];
  for (const valueItem of values) {
    for (const part of String(valueItem).split(",")) {
      const trimmed = part.trim();
      if (trimmed) {
        list.push(trimmed);
      }
    }
  }
  return list.length > 0 ? list : fallback;
}

// Whether story.md names a cover the EPUB build would accept.
export function coverIsReady(project) {
  if (project.story.data.cover === undefined) {
    return false;
  }
  try {
    coverImage(project);
    return true;
  } catch {
    return false;
  }
}

// Resolves story.md `cover` to an image inside the project. Throws with a
// story.md-prefixed message so validate and build report the same problem.
export function coverImage(project) {
  const cover = String(project.story.data.cover).trim();
  const mediaType = COVER_MEDIA_TYPES[path.extname(cover).toLowerCase()];
  if (mediaType === undefined) {
    throw projectError(`story.md cover ${cover} must be a ${Object.keys(COVER_MEDIA_TYPES).join(", ")} image`);
  }
  const filePath = path.resolve(project.root, cover);
  if (!isPathInside(project.root, filePath)) {
    throw projectError(`story.md cover ${cover} must be inside the project`);
  }
  const stats = lstatIfExists(filePath);
  if (!stats) {
    throw projectError(`story.md cover ${cover} does not exist`);
  }
  // The symlink check comes before the file check so a linked cover gets
  // the usual refusal rather than reading as missing.
  assertSafeProjectPath(filePath, project.root);
  if (!stats.isFile()) {
    throw projectError(`story.md cover ${cover} is not a file`);
  }
  assertFileSizeWithinLimit(filePath, MAX_COVER_BYTES);
  return { filePath, mediaType, extension: mediaType === "image/jpeg" ? "jpg" : path.extname(cover).slice(1).toLowerCase() };
}

export const CHAPTER_FILENAME_PATTERN = /^chapter-(\d+)\.md$/;

export const SCENE_FILENAME_PATTERN = /^(.+)-scene-(\d+)\.md$/;

function isPositiveIntegerValue(value) {
  const number = Number(value);
  return value !== "" && value !== null && typeof value !== "boolean" && Number.isInteger(number) && number > 0;
}

function chapterNumber(value, file) {
  return value !== undefined && isPositiveIntegerValue(value) ? Number(value) : chapterNumberFromFile(file);
}

export function chapterNumberFromFile(file) {
  const match = CHAPTER_FILENAME_PATTERN.exec(path.basename(file));
  return match ? Number.parseInt(match[1], 10) : 0;
}

function sceneNumberFromFile(file) {
  const match = SCENE_FILENAME_PATTERN.exec(path.basename(file));
  return match ? Number.parseInt(match[2], 10) : 0;
}

function sceneChapterFromFile(file) {
  const match = SCENE_FILENAME_PATTERN.exec(path.basename(file));
  return match ? match[1] : "";
}

export function relative(project, file) {
  return path.relative(project.root, file);
}

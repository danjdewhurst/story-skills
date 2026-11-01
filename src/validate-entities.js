// Per-kind checks for story validate: each entity file's frontmatter
// fields, and its values against the lists the schema allows.
import path from "node:path";
import { idText } from "./continuity.js";
import { chapterChronology } from "./chronology.js";
import { characterLifeline, diesAgainIn } from "./deaths.js";
import { validateProgressions } from "./progressions.js";
import { FRONTMATTER_KEYS } from "./frontmatter-keys.js";
import { foldMode, locationCoordinates } from "./geography.js";
import { copyrightPageTodos, isCopyrightMatter, isPlaceholder, publishingMeta, validateNames } from "./publishing.js";
import { SCENE_SETTINGS } from "./fountain.js";
import { CHAPTER_HOOKS, SCENE_OUTCOMES } from "./pacing.js";
import { plural } from "./plural.js";
import { STYLE_LISTS, STYLE_LIST_FIELDS, styleListEntries, styleWords } from "./languages/style.js";
import { lowerCase } from "./languages/locale.js";
import { graphemeCount, nfc } from "./unicode.js";
import { err, warn } from "./findings.js";
import {
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
  BEAT_MAX_LENGTH,
  beatText,
  SETTLED_CHAPTER_STATUSES,
  WRITTEN_CHAPTER_STATUSES,
  chapterChoices,
  asArray,
  SCENE_FILENAME_PATTERN,
  chapterNumberFromFile,
  relative
} from "./scan.js";
import {
  validateEntityId,
  validateUnitDate,
  requireScalar,
  requireInteger,
  validateStringArray,
  warnNearMissKeys,
  validateObjectArray,
  validateRelationships,
  validateEnum,
  requireFields
} from "./validate-fields.js";
import { sampleProblem, sampleDuplicate, readEntityData, validateOptionalRegistry } from "./validate-files.js";
import { storyIdMismatch, storyIdIsFallback, unusedTargetWarnings, validateReleaseDate } from "./validate-story.js";

// Per kind, the fields a progression may not change because they hold lists,
// and the fields whose values are checked against an allowed set.
const PROGRESSION_RULES = {
  character: {
    lists: new Set(["aliases", "relationships", "locations", "tags", "voice-words", "voice-avoid"]),
    enums: new Map([["role", CHARACTER_ROLES], ["status", CHARACTER_STATUSES]])
  },
  location: {
    lists: new Set(["notable-characters", "tags", "routes", "coordinates", "distances"]),
    enums: new Map([["setting", SCENE_SETTINGS]])
  },
  faction: {
    lists: new Set(["members", "locations", "tags"]),
    enums: new Map([["type", FACTION_TYPES], ["status", FACTION_STATUSES]])
  }
};

export function validateCharacters(project, errors, warnings) {
  const chronology = chapterChronology(project);
  for (const character of project.characters) {
    const label = relative(project, character.file);
    const data = readEntityData(character.file, project.root, label, errors, warnings, "character");
    if (!data) {
      continue;
    }
    validateEntityId(character.id, label, errors);
    requireFields(data, ["name", "role", "status"], label, errors);
    validateEnum(data, "arc-type", CHARACTER_ARC_TYPES, label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "role", label, errors);
    requireScalar(data, "status", label, errors);
    validateEnum(data, "role", CHARACTER_ROLES, label, errors);
    validateEnum(data, "status", CHARACTER_STATUSES, label, errors);
    if (data["died-in"] !== undefined) {
      requireScalar(data, "died-in", label, errors);
    }
    if (data["revived-in"] !== undefined) {
      requireScalar(data, "revived-in", label, errors);
    }
    if (data.arc !== undefined) {
      requireScalar(data, "arc", label, errors);
    }
    validateStringArray(data, "aliases", label, errors);
    validateStringArray(data, "locations", label, errors);
    validateStringArray(data, "tags", label, errors);
    validateStringArray(data, "voice-words", label, errors);
    validateStringArray(data, "voice-avoid", label, errors);
    validateRelationships(data, label, errors);
    validateProgressions(data, label, PROGRESSION_RULES.character, chronology, errors);
    // Continuity checks a death from died-in fully (errors, state, series);
    // a progression alone raises only warnings. A progression death after
    // the character died and came back is a second death, which died-in
    // cannot record, so it is not asked for.
    let lifeline = null;
    for (const [index, item] of asArray(data.progressions).entries()) {
      if (item && typeof item === "object" && item.field === "status" && item.value === "deceased" && idText(item.from) !== character.diedIn) {
        lifeline ??= characterLifeline(character, chronology);
        if (diesAgainIn(lifeline, idText(item.from), chronology)) {
          continue;
        }
        warnings.push(warn("deceased-without-died-in", `${label} progressions[${index}] makes ${character.id} deceased from ${idText(item.from) || "?"}; set died-in: ${idText(item.from) || "<chapter>"} too so story continuity treats appearances after the death as errors`, label));
      }
    }
  }
}

export function validateLocations(project, errors, warnings) {
  const chronology = chapterChronology(project);
  for (const location of project.locations) {
    const label = relative(project, location.file);
    const data = readEntityData(location.file, project.root, label, errors, warnings, "location");
    if (!data) {
      continue;
    }
    // A head count or a description ("about 300"), but one value.
    requireScalar(data, "population", label, errors);
    if (typeof data.population === "boolean" || (typeof data.population === "number" && !Number.isInteger(data.population))) {
      errors.push(err("field-not-integer", `${label} frontmatter field population must be a whole number or text, such as 300 or "about 300"`, label));
    }
    validateEntityId(location.id, label, errors);
    requireFields(data, ["name", "type"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    validateStringArray(data, "notable-characters", label, errors);
    validateStringArray(data, "tags", label, errors);
    validateObjectArray(data, "routes", label, errors);
    validateEnum(data, "setting", SCENE_SETTINGS, label, errors);
    const destinations = new Set();
    for (const route of Array.isArray(data.routes) ? data.routes : []) {
      if (!route || typeof route !== "object" || Array.isArray(route)) {
        continue;
      }
      const to = idText(route.to);
      if (to === "") {
        errors.push(err("missing-field", `${label} route is missing to`, label));
      } else if (destinations.has(to)) {
        warnings.push(warn("duplicate-route", `${label} lists more than one route to ${to}; the travel check and story diagram use only the fastest`, label));
      } else {
        destinations.add(to);
      }
      if (typeof route.hours !== "number" || !Number.isFinite(route.hours) || route.hours <= 0) {
        errors.push(err("invalid-route-hours", `${label} route to ${route.to ?? "?"} hours must be a positive number`, label));
      }
      requireScalar(route, "mode", `${label} route to ${route.to ?? "?"}`, errors, label);
      // mode is free text (ferry, on foot), and the codex and travel
      // messages show it only when it is text, so ask for quotes as for
      // other text fields.
      if (typeof route.mode === "number" || typeof route.mode === "boolean") {
        errors.push(err("field-not-text", `${label} route to ${route.to ?? "?"} mode must be text: quote it as mode: "${route.mode}"`, label));
      }
    }
    validateLocationGeography(data, label, errors, warnings);
    validateProgressions(data, label, PROGRESSION_RULES.location, chronology, errors);
  }
}

// `coordinates` on the story's own map and `distances` to other locations,
// which the distance travel check reads (see geography.js).
function validateLocationGeography(data, label, errors, warnings) {
  if (data.coordinates !== undefined && locationCoordinates(data.coordinates) === undefined) {
    errors.push(err("invalid-coordinates", `${label} coordinates must be two numbers, the place on the story's map, such as [12, 40]`, label));
  }
  validateObjectArray(data, "distances", label, errors);
  const destinations = new Set();
  for (const entry of Array.isArray(data.distances) ? data.distances : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const to = idText(entry.to);
    if (to === "") {
      errors.push(err("missing-field", `${label} distance is missing to`, label));
    } else if (destinations.has(to)) {
      warnings.push(warn("duplicate-distance", `${label} lists more than one distance to ${to}; the distance check uses only the shortest`, label));
    } else {
      destinations.add(to);
    }
    if (typeof entry.distance !== "number" || !Number.isFinite(entry.distance) || entry.distance <= 0) {
      errors.push(err("invalid-distance", `${label} distance to ${entry.to ?? "?"} must be a positive number`, label));
    }
  }
}

export function validateSystems(project, errors, warnings) {
  for (const system of project.systems) {
    const label = relative(project, system.file);
    const data = readEntityData(system.file, project.root, label, errors, warnings, "system");
    if (!data) {
      continue;
    }
    validateEntityId(system.id, label, errors);
    requireFields(data, ["name", "type"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    if (data.prevalence !== undefined) {
      requireScalar(data, "prevalence", label, errors);
    }
  }
}

export function validateFactions(project, errors, warnings) {
  const chronology = chapterChronology(project);
  for (const faction of project.factions) {
    const label = relative(project, faction.file);
    const data = readEntityData(faction.file, project.root, label, errors, warnings, "faction");
    if (!data) {
      continue;
    }
    validateEntityId(faction.id, label, errors);
    requireFields(data, ["name", "type", "status"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "status", label, errors);
    validateEnum(data, "type", FACTION_TYPES, label, errors);
    validateEnum(data, "status", FACTION_STATUSES, label, errors);
    validateStringArray(data, "members", label, errors);
    validateStringArray(data, "locations", label, errors);
    validateStringArray(data, "tags", label, errors);
    validateProgressions(data, label, PROGRESSION_RULES.faction, chronology, errors);
  }
}

export function validateArtifacts(project, errors, warnings) {
  for (const artifact of project.artifacts) {
    const label = relative(project, artifact.file);
    const data = readEntityData(artifact.file, project.root, label, errors, warnings, "artifact");
    if (!data) {
      continue;
    }
    validateEntityId(artifact.id, label, errors);
    requireFields(data, ["name", "type", "status"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "status", label, errors);
    requireScalar(data, "owner", label, errors);
    requireScalar(data, "location", label, errors);
    validateEnum(data, "type", ARTIFACT_TYPES, label, errors);
    validateEnum(data, "status", ARTIFACT_STATUSES, label, errors);
    validateStringArray(data, "tags", label, errors);
  }
}

export function validateArcs(project, errors, warnings) {
  for (const arc of project.arcs) {
    const label = relative(project, arc.file);
    const data = readEntityData(arc.file, project.root, label, errors, warnings, "arc");
    if (!data) {
      continue;
    }
    validateStringArray(data, "mice-threads", label, errors);
    validateEntityId(arc.id, label, errors);
    requireFields(data, ["name", "type", "status"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "status", label, errors);
    validateEnum(data, "type", ARC_TYPES, label, errors);
    validateEnum(data, "status", ARC_STATUSES, label, errors);
    validateStringArray(data, "characters", label, errors);
    validateStringArray(data, "themes", label, errors);
    validateStringArray(data, "acts", label, errors);
  }
}

export function validateChapters(project, errors, warnings) {
  const seenNumbers = new Map();

  for (const chapter of project.chapters) {
    const label = relative(project, chapter.file);
    const data = readEntityData(chapter.file, project.root, label, errors, warnings, "chapter");
    if (!data) {
      continue;
    }
    const filenameNumber = chapterNumberFromFile(chapter.file);

    validateEntityId(chapter.id, label, errors);
    requireFields(data, ["title", "number", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "status", label, errors);
    requireInteger(data, "number", label, errors);
    validateEnum(data, "status", CHAPTER_STATUSES, label, errors);
    validateStringArray(data, "locations", label, errors);
    validateStringArray(data, "characters", label, errors);
    validateStringArray(data, "mentions", label, errors);
    validateStringArray(data, "arcs-advanced", label, errors);
    if (data.pov !== undefined) {
      requireScalar(data, "pov", label, errors);
    }
    if (data["word-count"] !== undefined) {
      requireInteger(data, "word-count", label, errors, 0);
    }
    if (data["character-count"] !== undefined) {
      requireInteger(data, "character-count", label, errors, 0);
    }
    if (data["target-words"] !== undefined) {
      requireInteger(data, "target-words", label, errors, 1);
    }
    if (data["target-characters"] !== undefined) {
      requireInteger(data, "target-characters", label, errors, 1);
    }
    unusedTargetWarnings(project, label, data, warnings);
    if (data.date !== undefined) {
      requireScalar(data, "date", label, errors);
      validateUnitDate(data, label, project.calendar, errors);
    }
    if (data.time !== undefined) {
      requireScalar(data, "time", label, errors);
    }
    if (data.mode !== undefined) {
      requireScalar(data, "mode", label, errors);
      // `story add chapter` writes an empty mode when none is given.
      if (data.mode !== "" && data.mode !== null) {
        validateEnum(data, "mode", DRAFT_MODES, label, errors);
      }
    }
    if (data["episode-question"] !== undefined) {
      requireScalar(data, "episode-question", label, errors);
    }
    if (data["time-skip"] !== undefined) {
      requireScalar(data, "time-skip", label, errors);
    }
    validateReleaseDate(data["release-date"], `${label} release-date`, label, errors);
    validateEnum(data, "hook", CHAPTER_HOOKS, label, errors);
    // Free text: beat sheets name their beats differently, and writers adapt
    // them, so any label is accepted. Only its type and length are checked.
    if (data.beat !== undefined) {
      requireScalar(data, "beat", label, errors);
      const length = typeof data.beat === "string" ? graphemeCount(beatText(data.beat)) : 0;
      if (length > BEAT_MAX_LENGTH) {
        warnings.push(warn("beat-too-long", `${label} beat is ${length} characters long: keep it to a short label of at most ${BEAT_MAX_LENGTH} characters, such as Midpoint, and put the detail in the chapter outline`, label));
      }
    }
    validateNames(data, "author", label, errors);
    if ((Array.isArray(data.author) ? data.author : [data.author]).some(isPlaceholder)) {
      warnings.push(warn("todo-placeholder", `${label} author is still a [TODO] placeholder; builds leave it out`, label));
    }
    errors.push(...chapterChoices(chapter, label).problems);
    if (data.numbered !== undefined && typeof data.numbered !== "boolean") {
      errors.push(err("field-not-boolean", `${label} numbered must be true or false`, label));
    } else if (data.numbered === false && (typeof data.title !== "string" || data.title.trim() === "")) {
      errors.push(err("unnumbered-without-title", `${label} is unnumbered (numbered: false), so it needs a title to print as its heading`, label));
    }
    // A planned chapter with no prose yet would ship as a heading-only page.
    // While drafting that is normal, so validate says so only once the book
    // or the chapter claims to be finished; build and export always say so.
    if (chapter.wordCount === 0 && (project.story.data.status === "complete" || WRITTEN_CHAPTER_STATUSES.has(chapter.status))) {
      warnings.push(warn("empty-chapter", `${label} has no prose yet, so export and build print it as a heading-only page`, label));
    }

    if (filenameNumber === 0) {
      errors.push(err("invalid-filename", `${label} filename must match chapter-{NN}.md`, label));
    } else if (Number.isInteger(data.number) && data.number !== filenameNumber) {
      errors.push(err("filename-number-mismatch", `${label} number must match filename chapter number ${filenameNumber}`, label));
    }

    if (Number.isInteger(data.number)) {
      if (data.number <= 0) {
        errors.push(err("field-below-minimum", `${label} number must be greater than 0`, label));
      }

      const existing = seenNumbers.get(data.number);
      if (existing) {
        errors.push(err("duplicate-chapter-number", `${label} duplicates chapter number ${data.number} from ${existing}`, label));
      } else {
        seenNumbers.set(data.number, label);
      }
    }
  }
}

export function validateScenes(project, errors, warnings) {
  const seenKeys = new Map();
  for (const scene of project.scenes) {
    const label = relative(project, scene.file);
    const data = readEntityData(scene.file, project.root, label, errors, warnings, "scene");
    if (!data) {
      continue;
    }
    validateEntityId(scene.id, label, errors);
    requireFields(data, ["title", "chapter", "scene", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "chapter", label, errors);
    requireScalar(data, "status", label, errors);
    requireInteger(data, "scene", label, errors);
    validateEnum(data, "status", SCENE_STATUSES, label, errors);
    validateStringArray(data, "characters", label, errors);
    validateStringArray(data, "mentions", label, errors);
    validateStringArray(data, "arcs-advanced", label, errors);
    validateObjectArray(data, "state-changes", label, errors);
    if (data.pov !== undefined) {
      requireScalar(data, "pov", label, errors);
    }
    if (data.location !== undefined) {
      requireScalar(data, "location", label, errors);
    }
    if (data.date !== undefined) {
      requireScalar(data, "date", label, errors);
      validateUnitDate(data, label, project.calendar, errors);
    }
    if (data.time !== undefined) {
      requireScalar(data, "time", label, errors);
    }
    if (data.dilemma !== undefined) {
      requireScalar(data, "dilemma", label, errors);
    }
    if (data["travel-hours"] !== undefined && typeof data["travel-hours"] !== "number") {
      errors.push(err("field-not-number", `${label} frontmatter field travel-hours must be a number`, label));
    }
    validateTravelMode(project, data, label, errors, warnings);
    if (data.sequel !== undefined && typeof data.sequel !== "boolean") {
      errors.push(err("field-not-boolean", `${label} frontmatter field sequel must be a boolean`, label));
    }
    validateEnum(data, "outcome", SCENE_OUTCOMES, label, errors);
    validateEnum(data, "setting", SCENE_SETTINGS, label, errors);
    if (data["flashback-to"] !== undefined) {
      requireScalar(data, "flashback-to", label, errors);
    }
    if (Number.isInteger(data.scene) && data.scene <= 0) {
      errors.push(err("field-below-minimum", `${label} scene must be greater than 0`, label));
    }

    const filenameMatch = SCENE_FILENAME_PATTERN.exec(path.basename(scene.file));
    if (!filenameMatch) {
      errors.push(err("invalid-filename", `${label} filename must match {chapter}-scene-{NN}.md`, label));
    } else {
      const [, filenameChapter, filenameSceneText] = filenameMatch;
      const filenameScene = Number.parseInt(filenameSceneText, 10);
      if (typeof data.chapter === "string" && data.chapter !== "" && data.chapter !== filenameChapter) {
        errors.push(err("filename-number-mismatch", `${label} chapter must match filename chapter ${filenameChapter}`, label));
      }
      if (Number.isInteger(data.scene) && data.scene !== filenameScene) {
        errors.push(err("filename-number-mismatch", `${label} scene must match filename scene number ${filenameScene}`, label));
      }
    }

    if (typeof data.chapter === "string" && data.chapter !== "" && Number.isInteger(data.scene)) {
      const key = `${data.chapter}::${data.scene}`;
      const existing = seenKeys.get(key);
      if (existing) {
        errors.push(err("duplicate-scene-number", `${label} duplicates scene ${data.scene} of ${data.chapter} from ${existing}`, label));
      } else {
        seenKeys.set(key, label);
      }
    }
  }
}

// A scene's `travel-mode` is free text, matched against the story.md
// travel-modes ignoring case and spacing. An unlisted mode is only a
// warning: the distance check then uses the fastest mode.
function validateTravelMode(project, data, label, errors, warnings) {
  const mode = data["travel-mode"];
  if (mode === undefined) {
    return;
  }
  requireScalar(data, "travel-mode", label, errors);
  if (typeof mode === "number" || typeof mode === "boolean") {
    errors.push(err("field-not-text", `${label} frontmatter field travel-mode must be text: quote it as travel-mode: "${mode}"`, label));
    return;
  }
  if (typeof mode !== "string" || mode.trim() === "") {
    return;
  }
  const modes = project.geography?.modes ?? [];
  if (!modes.some((entry) => entry.key === foldMode(mode))) {
    const listed = modes.length === 0 ? "story.md lists no travel-modes" : `story.md travel-modes lists ${modes.map((entry) => entry.mode).join(", ")}`;
    warnings.push(warn("unknown-travel-mode", `${label} travel-mode ${mode.trim()} is not a travel mode (${listed}), so the distance check uses the fastest one`, label));
  }
}

// Keys whose absence changes the meaning of an entry (no `learned-in` means
// known before the story), so a misspelling asserts the opposite of what
// was meant.
const STATE_ENTRY_KEYS = {
  "character-state": FRONTMATTER_KEYS.characterState,
  "object-state": FRONTMATTER_KEYS.objectState,
  "knowledge-state": FRONTMATTER_KEYS.knowledgeState
};

export function validateContinuityState(project, errors, warnings) {
  const label = "continuity/state.md";
  if (!project.continuity) {
    return;
  }
  const data = project.continuity.data;
  requireFields(data, ["type", "story", "current-chapter"], label, errors);
  requireScalar(data, "type", label, errors);
  requireScalar(data, "story", label, errors);
  requireInteger(data, "current-chapter", label, errors, 0);
  validateObjectArray(data, "character-state", label, errors);
  validateObjectArray(data, "object-state", label, errors);
  validateObjectArray(data, "knowledge-state", label, errors);
  for (const [list, keys] of Object.entries(STATE_ENTRY_KEYS)) {
    for (const [index, entry] of (Array.isArray(data[list]) ? data[list] : []).entries()) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      warnNearMissKeys(entry, keys, `${label} ${list}[${index}]`, warnings, label);
      // Each value is one id or one piece of text; `[]` is the only list the
      // frontmatter can hold here, and it names nothing.
      for (const [key, value] of Object.entries(entry)) {
        if (keys.includes(key) && Array.isArray(value)) {
          errors.push(err("field-not-scalar", `${label} ${list}[${index}] ${key} must be a single value, not a list`, label));
        }
      }
      if (list === "object-state" && entry.status !== undefined && !ARTIFACT_STATUSES.has(entry.status)) {
        errors.push(err("unsupported-value", `${label} ${list}[${index}] status must be one of ${[...ARTIFACT_STATUSES].join(", ")}, got ${entry.status}`, label));
      }
    }
  }
  if (data.type !== undefined && data.type !== "continuity-state") {
    errors.push(err("wrong-type", `${label} type must be continuity-state`, label));
  }
  if (data.story !== undefined && data.story !== project.storyId && !storyIdIsFallback(project)) {
    errors.push(storyIdMismatch(label, project));
  }
}

export function validateQuestions(project, errors, warnings) {
  for (const question of project.questions) {
    const label = relative(project, question.file);
    const data = readEntityData(question.file, project.root, label, errors, warnings, "question");
    if (!data) {
      continue;
    }
    validateEntityId(question.id, label, errors);
    requireFields(data, ["title", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "status", label, errors);
    requireScalar(data, "introduced", label, errors);
    requireScalar(data, "resolved", label, errors);
    validateEnum(data, "status", QUESTION_STATUSES, label, errors);
    validateStringArray(data, "characters", label, errors);
  }
}

export function validatePromises(project, errors, warnings) {
  for (const promise of project.promises) {
    const label = relative(project, promise.file);
    const data = readEntityData(promise.file, project.root, label, errors, warnings, "promise");
    if (!data) {
      continue;
    }
    validateEntityId(promise.id, label, errors);
    requireFields(data, ["title", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "status", label, errors);
    requireScalar(data, "planted", label, errors);
    requireScalar(data, "payoff", label, errors);
    validateEnum(data, "status", PROMISE_STATUSES, label, errors);
    validateStringArray(data, "arcs", label, errors);
    validateStringArray(data, "characters", label, errors);
  }
}

export function validateClues(project, errors, warnings) {
  for (const clue of project.clues) {
    const label = relative(project, clue.file);
    const data = readEntityData(clue.file, project.root, label, errors, warnings, "clue");
    if (!data) {
      continue;
    }
    validateEntityId(clue.id, label, errors);
    requireFields(data, ["title", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "status", label, errors);
    requireScalar(data, "planted", label, errors);
    requireScalar(data, "payoff", label, errors);
    validateEnum(data, "status", CLUE_STATUSES, label, errors);
    validateStringArray(data, "arcs", label, errors);
    validateStringArray(data, "characters", label, errors);
    for (const field of ["significance-delayed", "red-herring"]) {
      if (data[field] !== undefined && typeof data[field] !== "boolean") {
        errors.push(err("field-not-boolean", `${label} frontmatter field ${field} must be a boolean`, label));
      }
    }
  }
}

export function validateGlossaryTerms(project, errors, warnings) {
  for (const term of project.glossaryTerms) {
    const label = relative(project, term.file);
    const data = readEntityData(term.file, project.root, label, errors, warnings, "term");
    if (!data) {
      continue;
    }
    validateEntityId(term.id, label, errors);
    requireFields(data, ["term", "category"], label, errors);
    requireScalar(data, "term", label, errors);
    requireScalar(data, "category", label, errors);
    validateEnum(data, "category", TERM_CATEGORIES, label, errors);
    validateStringArray(data, "aliases", label, errors);
  }
}

export function validateStyleSheet(project, errors, warnings) {
  if (project.styleSheet === null) {
    return;
  }
  const data = project.styleSheet.data;
  const label = STYLE_SHEET_FILE;
  if (data.type !== "style-sheet") {
    errors.push(err("wrong-type", `${label} type must be style-sheet`, label));
  }
  requireScalar(data, "dialect", label, errors);
  validateEnum(data, "dialect", STYLE_DIALECTS, label, errors);
  validateObjectArray(data, "preferred", label, errors);
  asArray(data.preferred).forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }
    const entryLabel = `${label} preferred[${index}]`;
    for (const field of ["use", "avoid"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        errors.push(err("missing-field", `${entryLabel} requires a non-empty ${field}`, label));
      }
    }
    if (typeof entry.use === "string" && typeof entry.avoid === "string"
      && lowerCase(nfc(entry.use.trim()), project.pack) === lowerCase(nfc(entry.avoid.trim()), project.pack)) {
      errors.push(err("style-use-equals-avoid", `${entryLabel} use and avoid must differ`, label));
    }
  });
  validateStringArray(data, "watch-words", label, errors);
  validateStringArray(data, "allow-words", label, errors);
  for (const field of STYLE_LIST_FIELDS) {
    validateStyleLists(data, field, label, errors, warnings);
  }
  validateStringArray(data, "samples", label, errors);
  const seen = new Map();
  for (const entry of asArray(data.samples)) {
    if (typeof entry !== "string" || entry.trim() === "") {
      continue;
    }
    const sample = entry.trim();
    if (path.isAbsolute(sample) || /^[A-Za-z]:/.test(sample)) {
      errors.push(err("field-invalid-items", `${label} samples entry ${sample} must be a path relative to the project folder, such as ../book-one`, label));
    } else {
      const problem = sampleProblem(project, sample) ?? sampleDuplicate(project, sample, seen);
      if (problem !== null) {
        warnings.push(problem);
      }
    }
  }
}

// `replace-words` and `add-words`: a list of `- list-name: word, word`
// entries naming the language pack's lists.
function validateStyleLists(data, field, label, errors, warnings) {
  const value = data[field];
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || !value.every((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))) {
    errors.push(err("field-not-list", `${label} frontmatter field ${field} must be a list of list: words entries, such as - filter-words: sintió, vio`, label));
    return;
  }
  for (const [key, words] of styleListEntries(value)) {
    if (!Object.prototype.hasOwnProperty.call(STYLE_LISTS, key)) {
      warnings.push(warn("unknown-word-list", `${label} ${field} entry ${key} is not a word list; the checks ignore it (see docs/project-format.md#word-lists)`, label));
    } else if (styleWords(words) === null) {
      errors.push(err("field-not-text", `${label} ${field} entry ${key} must be text: words separated by commas, or [] for none`, label));
    }
  }
}

export function validateResearch(project, errors, warnings) {
  validateOptionalRegistry(project, RESEARCH_DIR, "research-registry", errors);
  const chapterStatus = new Map(project.chapters.map((chapter) => [chapter.id, chapter.status]));
  for (const note of project.research) {
    const label = relative(project, note.file);
    const data = readEntityData(note.file, project.root, label, errors, warnings, "research");
    if (!data) {
      continue;
    }
    validateEntityId(note.id, label, errors);
    requireFields(data, ["title", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    validateEnum(data, "status", RESEARCH_STATUSES, label, errors);
    validateStringArray(data, "sources", label, errors);
    validateStringArray(data, "used-in", label, errors);
    validateEnum(data, "accuracy", RESEARCH_ACCURACY, label, errors);
    validateEnum(data, "confidence", RESEARCH_CONFIDENCE, label, errors);
    validateEnum(data, "method", RESEARCH_METHODS, label, errors);
    validateStringArray(data, "risk", label, errors);
    validateStringArray(data, "reviewed-by", label, errors);
    for (const risk of Array.isArray(data.risk) ? data.risk : []) {
      if (typeof risk === "string" && !RESEARCH_RISKS.has(risk)) {
        errors.push(err("unsupported-value", `${label} risk has unsupported value ${risk}`, label));
      }
    }
    // Invented facts are the author's to decide, so they need no sources and
    // never hold up a final chapter.
    const invented = note.accuracy === "invented";
    if (!invented && note.status === "verified" && note.sources.length === 0) {
      warnings.push(warn("research-no-sources", `${label} is verified but lists no sources`, label));
    }
    const settled = note.usedIn.filter((chapterId) => SETTLED_CHAPTER_STATUSES.has(chapterStatus.get(chapterId)));
    if (!invented && (note.status === "open" || note.status === "disputed")) {
      for (const chapterId of settled) {
        warnings.push(warn("research-unsettled", `${label} is ${note.status} but ${chapterId} relies on it and is ${chapterStatus.get(chapterId)}`, label));
      }
    }
    if (note.risk.length > 0 && note.reviewedBy.length === 0 && settled.length > 0) {
      warnings.push(warn("research-unreviewed", `${label} carries ${note.risk.join(", ")} risk but has no reviewed-by, and ${settled.join(", ")} relies on it`, label));
    }
  }
}

export function validateMatter(project, errors, warnings) {
  validateOptionalRegistry(project, MATTER_DIR, "matter-registry", errors);
  for (const matter of project.matter) {
    const label = relative(project, matter.file);
    if (matter.empty) {
      warnings.push(warn("empty-matter", `${label} has no text and is left out of export and build`, label));
    }
    // A placeholder stands for text only the author can supply, such as an
    // ISBN, so the fix is to ask them, never to invent or hide it.
    if (matter.todoMarkers > 0) {
      warnings.push(warn("matter-todo-markers", `${label} has ${plural(matter.todoMarkers, "[TODO marker")}, which export and build print: ask the author to supply the text`, label));
    }
    const data = readEntityData(matter.file, project.root, label, errors, warnings, "matter");
    if (!data) {
      continue;
    }
    validateEntityId(matter.id, label, errors);
    requireFields(data, ["title", "placement"], label, errors);
    requireScalar(data, "title", label, errors);
    validateEnum(data, "placement", MATTER_PLACEMENTS, label, errors);
    if (data.order !== undefined) {
      requireInteger(data, "order", label, errors, 0);
    }
    if (data.heading !== undefined && typeof data.heading !== "boolean") {
      errors.push(err("field-not-boolean", `${label} heading must be true or false`, label));
    }
    // Quoted material (an epigraph, lyrics, a poem) needs the rights
    // holder's permission before the book is published.
    validateEnum(data, "permission", MATTER_PERMISSIONS, label, errors);
    requireScalar(data, "rights-holder", label, errors);
    requireScalar(data, "credit", label, errors);
    if (data.permission === "pending" && project.story.data.status === "complete") {
      warnings.push(warn("permission-pending", `${label} permission is still pending and the story is complete`, label));
    }
    if (data.permission === "granted" && (typeof data["rights-holder"] !== "string" || data["rights-holder"].trim() === "")) {
      warnings.push(warn("permission-no-rights-holder", `${label} permission is granted but no rights-holder is recorded`, label));
    }
  }
  // Without a written copyright page, builds generate one from story.md,
  // which prints a marker inside these fields as written.
  const meta = publishingMeta(project.story.data);
  if (meta.copyright !== "" && !project.matter.some((matter) => !matter.empty && MATTER_PLACEMENTS.has(matter.placement) && isCopyrightMatter(matter))) {
    for (const { field, markers } of copyrightPageTodos(meta)) {
      warnings.push(warn("matter-todo-markers", `story.md ${field} has ${plural(markers, "[TODO marker")}, which export and build print on the generated copyright page: ask the author to supply the text`, "story.md"));
    }
  }
}

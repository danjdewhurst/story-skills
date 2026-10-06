// Schema and link checks over a scanned project.
import fs from "node:fs";
import path from "node:path";
import { idText, storyDateError } from "./continuity.js";
import { chapterChronology } from "./chronology.js";
import { validateProgressions } from "./progressions.js";
import { parseFrontmatter } from "./frontmatter.js";
import { FRONTMATTER_KEYS, nearMissKeys } from "./frontmatter-keys.js";
import { isPathInside, lstatIfExists, portablePath, projectPath, readTextFile, TEMPORARY_FILE_PATTERN } from "./files.js";
import { kebabCase } from "./markdown.js";
import { COUNT_UNITS, STORY_FORMS, formRangeWarning, formRanges } from "./forms.js";
import { validatePublishing } from "./publishing.js";
import { SCENE_SETTINGS } from "./fountain.js";
import { isIfid } from "./twee.js";
import { CHAPTER_NUMERALS, validateChapterNumerals } from "./numerals.js";
import { validateWritingMode, WRITING_MODES } from "./typesetting.js";
import { validateCliConfig } from "./config.js";
import { validatePasses } from "./passes.js";
import { CHAPTER_HOOKS, SCENE_OUTCOMES } from "./pacing.js";
import { PROGRESS_FILE, WEEKDAYS, cleanSessions, weekdayName } from "./progress.js";
import { plural } from "./plural.js";
import { STYLE_LISTS, STYLE_LIST_FIELDS, styleListEntries, styleWords } from "./languages/style.js";
import { lowerCase } from "./languages/locale.js";
import { canonicalPath, isBookNumber, seriesLinks, validateSeriesLinks } from "./series.js";
import { err, warn } from "./findings.js";
import { EXEMPTIONS_FILE, exemptionFile, exemptionProblems, isChapterId } from "./exemptions.js";
import {
  STORY_SCHEMA_VERSION,
  REQUIRED_PATHS,
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
  scanProject,
  newerSchemaVersion,
  newerSchemaMessage,
  canonicalChapterId,
  mapOutsideLinks,
  WINDOWS_RESERVED_ID,
  isKebabId,
  LINK_DEFINITION_PATTERN,
  REGISTRY_HINT,
  SKIPPED_SCAN_DIRECTORIES,
  markdownFiles,
  chapterChoices,
  branchGraph,
  MAX_SCAN_DEPTH,
  readMarkdown,
  safeRead,
  fileErrorMessage,
  relativePathError,
  ENTITY_SCAN_DIRS,
  asArray,
  coverImage,
  SCENE_FILENAME_PATTERN,
  chapterNumberFromFile,
  relative
} from "./scan.js";

// Aunt, uncle, niece, and nephew are gendered on both sides, so either
// gendered inverse is a valid backlink.
const RELATIONSHIP_INVERSES = new Map([
  ["parent", ["child"]],
  ["child", ["parent"]],
  ["grandparent", ["grandchild"]],
  ["grandchild", ["grandparent"]],
  ["uncle", ["nephew", "niece"]],
  ["aunt", ["nephew", "niece"]],
  ["nephew", ["uncle", "aunt"]],
  ["niece", ["uncle", "aunt"]],
  ["mentor", ["student"]],
  ["student", ["mentor"]],
  ["employer", ["subordinate"]],
  ["subordinate", ["employer"]],
  ["former-supervisor", ["former-subordinate"]],
  ["former-subordinate", ["former-supervisor"]]
]);

// Backlinks the pre-0.10.0 reference allowed: former-supervisor both ways,
// and adversary answered by antagonist.
const LEGACY_RELATIONSHIP_PAIRS = new Set([
  "former-supervisor>former-supervisor",
  "adversary>antagonist"
]);

const SYMMETRIC_RELATIONSHIPS = new Set([
  "sibling",
  "spouse",
  "partner",
  "friend",
  "ally",
  "rival",
  "enemy",
  "adversary",
  "cousin",
  "in-law",
  "colleague",
  "foil",
  "confidant",
  "love-interest"
]);

// Every registry records the story id, which follows the story.md title, so
// a retitled story leaves them all stale until `story reindex` rewrites them.
function storyIdMismatch(label, project) {
  return err("story-id-mismatch", `${label} story must be ${project.storyId} (run story reindex after changing the story.md title)`, label);
}

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
  collectStrayFileWarnings(project, warnings);
  for (const file of ENTITY_SCAN_DIRS.flatMap((dir) => entityFileNames(projectRoot, dir))) {
    if (WINDOWS_RESERVED_ID.test(path.basename(file, ".md").toLowerCase())) {
      warnings.push(warn("windows-reserved-name", `${file} uses a file name Windows reserves, so the project cannot be checked out on Windows; rename the entity`, file));
    }
  }

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

    if (!project.scenes.some((scene) => scene.chapter === chapter.id)) {
      warnings.push(warn("no-scene-records", `${file} has no machine-readable scene records`, file));
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateLinks(root) {
  return validateLinksOf(scanProject(root));
}

export function validateLinksOf(project) {
  const errors = [];
  const warnings = [];
  for (const scanError of project.fileErrors ?? []) {
    errors.push(scanError);
  }
  const characters = new Map(project.characters.map((item) => [item.id, item]));
  const locations = new Map(project.locations.map((item) => [item.id, item]));
  const chapters = new Map(project.chapters.map((item) => [item.id, item]));
  const arcs = new Map(project.arcs.map((item) => [item.id, item]));
  const factions = new Map(project.factions.map((item) => [item.id, item]));
  const hasCharacter = (id) => characters.has(id);
  const hasLocation = (id) => locations.has(id);
  const hasChapter = (id) => chapters.has(id);
  // A promise or clue may schedule its chapters ahead of drafting: a
  // `chapter-NN` with no file yet is a plan, not a broken link, until the
  // status says the setup or payoff is already on the page. `continuity`
  // reads the same ids by their number.
  // An id whose number belongs to an existing chapter (`chapter-1` beside
  // `chapter-01`) is a typo, and chapter numbers start at 1.
  // A scheduled id must also use the spelling story add chapter writes
  // (chapter-01, not chapter-1), or it breaks once the chapter is added.
  const existingNumbers = new Set(project.chapters.map((chapter) => chapter.number));
  const hasScheduledChapter = (id) => {
    if (chapters.has(id)) {
      return true;
    }
    const match = /^chapter-(\d+)$/.exec(id);
    const number = match ? Number.parseInt(match[1], 10) : 0;
    return number > 0 && !existingNumbers.has(number) && id === canonicalChapterId(number);
  };
  const hasArc = (id) => arcs.has(id);
  // `mentions` may name characters or artifacts; prop custody checks read
  // artifact ids there.
  const artifactIds = new Set(project.artifacts.map((item) => item.id));
  const hasMention = (id) => characters.has(id) || artifactIds.has(id);

  for (const character of project.characters) {
    const label = relative(project, character.file);
    for (const relationship of character.relationships) {
      if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
        continue;
      }
      const target = relationship.character;
      if (typeof target !== "string" || target === "") {
        continue;
      }
      if (target !== kebabCase(target)) {
        errors.push(err("id-not-kebab", `${label} relationship character ${target} must be kebab-case`, label));
        continue;
      }
      if (!characters.has(target)) {
        errors.push(err("missing-reference", `${label} references missing character ${target}`, label));
      } else {
        const backlinks = [];
        for (const entry of characters.get(target).relationships) {
          if (entry && typeof entry === "object" && !Array.isArray(entry) && entry.character === character.id) {
            backlinks.push(entry);
          }
        }
        if (backlinks.length === 0) {
          errors.push(err("missing-backlink", `${label} relationship to ${target} is missing backlink`, label));
        } else {
          const expectedTypes = inverseRelationshipTypes(relationship.type);
          let matched = expectedTypes.length === 0;
          const types = [];
          for (const entry of backlinks) {
            if (entry.type) {
              types.push(entry.type);
            }
            if (expectedTypes.includes(entry.type)) {
              matched = true;
            }
          }
          const legacy = !matched && types.some((type) => LEGACY_RELATIONSHIP_PAIRS.has(`${relationship.type}>${type}`));
          if (legacy) {
            // Pairings the relationship reference recommended before 0.10.0
            // warn rather than fail, so an upgrade does not break CI.
            warnings.push(warn("legacy-backlink-type", `${label} relationship ${relationship.type} to ${target} has backlink ${types.join(", ")}, a pairing from before story-skills 0.10.0; change the backlink to ${expectedTypes.join(" or ")}`, label));
          } else if (!matched) {
            errors.push(err("backlink-type-mismatch", `${label} relationship ${relationship.type} to ${target} expects backlink type ${expectedTypes.join(" or ")}, got ${types.join(", ") || "none"}`, label));
          }
        }
      }
    }

    for (const locationId of character.locations) {
      checkIdReference(errors, label, locationId, "location", hasLocation);
      if (typeof locationId === "string" && locationId !== "" && locationId === kebabCase(locationId) && locations.has(locationId) && !locations.get(locationId).notableCharacters.includes(character.id)) {
        errors.push(err("missing-backlink", `${label} location ${locationId} is missing notable-character backlink`, label));
      }
    }

    if (character.diedIn) {
      checkIdReference(errors, label, character.diedIn, "chapter", hasChapter);
    }
    if (character.revivedIn) {
      checkIdReference(errors, label, character.revivedIn, "chapter", hasChapter);
    }
  }

  // A progression takes effect from a chapter, which may be one planned but
  // not written yet (`chapter-20` while drafting chapter 5).
  for (const entity of [...project.characters, ...project.locations, ...project.factions]) {
    for (const [index, item] of asArray(entity.frontmatter.progressions).entries()) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        checkIdReference(errors, `${relative(project, entity.file)} progressions[${index}]`, idText(item.from), "chapter", hasScheduledChapter, relative(project, entity.file));
      }
    }
  }

  for (const location of project.locations) {
    const label = relative(project, location.file);
    for (const route of location.routes) {
      const to = route && typeof route === "object" && !Array.isArray(route) ? idText(route.to) : "";
      if (to === "") {
        continue;
      }
      if (to === location.id) {
        errors.push(err("route-to-self", `${label} route points at itself`, label));
        continue;
      }
      checkIdReference(errors, `${label} route`, to, "location", hasLocation, label);
    }
    for (const characterId of location.notableCharacters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
      if (typeof characterId === "string" && characterId !== "" && characterId === kebabCase(characterId) && characters.has(characterId) && !characters.get(characterId).locations.includes(location.id)) {
        errors.push(err("missing-backlink", `${label} notable character ${characterId} is missing location backlink`, label));
      }
    }
  }

  for (const arc of project.arcs) {
    const label = relative(project, arc.file);
    for (const characterId of arc.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }

  for (const chapter of project.chapters) {
    const label = relative(project, chapter.file);
    if (chapter.pov) {
      const povText = String(chapter.pov);
      if (povText !== kebabCase(povText)) {
        errors.push(err("id-not-kebab", `${label} references POV character ${povText} which must be kebab-case`, label));
      } else if (!characters.has(chapter.pov)) {
        errors.push(err("missing-reference", `${label} references missing POV character ${chapter.pov}`, label));
      }
    }

    for (const characterId of chapter.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
    for (const mentionId of chapter.mentions) {
      checkIdReference(errors, label, mentionId, "character or artifact", hasMention);
    }
    for (const locationId of chapter.locations) {
      checkIdReference(errors, label, locationId, "location", hasLocation);
    }
    for (const arcId of chapter.arcsAdvanced) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
  }

  for (const faction of project.factions) {
    const label = relative(project, faction.file);
    for (const characterId of faction.members) {
      checkIdReference(errors, label, characterId, "member", hasCharacter);
    }
    for (const locationId of faction.locations) {
      checkIdReference(errors, label, locationId, "location", hasLocation);
    }
  }

  for (const artifact of project.artifacts) {
    const label = relative(project, artifact.file);
    if (artifact.owner) {
      const ownerText = String(artifact.owner);
      if (ownerText !== kebabCase(ownerText)) {
        errors.push(err("id-not-kebab", `${label} references owner ${ownerText} which must be kebab-case`, label));
      } else if (!characters.has(artifact.owner) && !factions.has(artifact.owner)) {
        errors.push(err("missing-reference", `${label} references missing owner ${artifact.owner}`, label));
      }
    }
    if (artifact.location) {
      checkIdReference(errors, label, artifact.location, "location", hasLocation);
    }
  }

  for (const scene of project.scenes) {
    const label = relative(project, scene.file);
    if (scene.chapter) {
      const chapterText = String(scene.chapter);
      if (chapterText !== kebabCase(chapterText)) {
        errors.push(err("id-not-kebab", `${label} references chapter ${chapterText} which must be kebab-case`, label));
      } else if (!chapters.has(scene.chapter)) {
        errors.push(err("missing-reference", `${label} references missing chapter ${scene.chapter}`, label));
      }
    }
    if (scene.pov) {
      const povText = String(scene.pov);
      if (povText !== kebabCase(povText)) {
        errors.push(err("id-not-kebab", `${label} references POV character ${povText} which must be kebab-case`, label));
      } else if (!characters.has(scene.pov)) {
        errors.push(err("missing-reference", `${label} references missing POV character ${scene.pov}`, label));
      }
    }
    if (scene.location) {
      checkIdReference(errors, label, scene.location, "location", hasLocation);
    }
    for (const characterId of scene.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
    for (const mentionId of scene.mentions) {
      checkIdReference(errors, label, mentionId, "character or artifact", hasMention);
    }
    for (const arcId of scene.arcsAdvanced) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
  }

  for (const note of project.research) {
    const label = relative(project, note.file);
    // Research is often done before the chapter that needs it is written.
    for (const chapterId of note.usedIn) {
      checkIdReference(errors, label, chapterId, "chapter", hasScheduledChapter);
    }
  }

  for (const question of project.questions) {
    const label = relative(project, question.file);
    // A question can be planned for a chapter not written yet; its answer
    // must be on the page before `resolved` names a chapter.
    checkIdReference(errors, label, question.introduced, "chapter", question.status === "open" ? hasScheduledChapter : hasChapter);
    checkIdReference(errors, label, question.resolved, "chapter", hasChapter);
    for (const characterId of question.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }

  for (const promise of project.promises) {
    const label = relative(project, promise.file);
    checkIdReference(errors, label, promise.planted, "chapter", promise.status === "planned" ? hasScheduledChapter : hasChapter);
    checkIdReference(errors, label, promise.payoff, "chapter", promise.status === "paid-off" ? hasChapter : hasScheduledChapter);
    for (const arcId of promise.arcs) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
    for (const characterId of promise.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }

  for (const clue of project.clues) {
    const label = relative(project, clue.file);
    checkIdReference(errors, label, clue.planted, "chapter", clue.status === "planned" ? hasScheduledChapter : hasChapter);
    checkIdReference(errors, label, clue.payoff, "chapter", clue.status === "paid-off" ? hasChapter : hasScheduledChapter);
    for (const arcId of clue.arcs) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
    for (const characterId of clue.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }

  // Like a promise's payoff, a choice may lead to a chapter not written yet;
  // the Twee build still needs it.
  const branches = branchGraph(project);
  errors.push(...branches.missing.filter((choice) => !hasScheduledChapter(choice.to)).map((choice) => choice.finding));
  warnings.push(...branches.warnings);
  validateTimelineAndArcBodyRefs(project, chapters, errors, hasScheduledChapter);
  validateMatterBodyLinks(project, errors);
  validateSeriesLinks(project.root, project.story.data, errors);

  return { ok: errors.length === 0, errors, warnings };
}

// Arc bodies plan ahead (Plot Points and Foreshadowing rows for chapters not
// yet written), so they accept a scheduled chapter-NN like promises do; the
// timeline records what happened and needs chapters that exist.
function validateTimelineAndArcBodyRefs(project, chapters, errors, hasScheduledChapter) {
  const chapterIds = new Set(chapters.keys());
  const sceneIds = new Set(project.scenes.map((scene) => scene.id));
  const checkTokens = (label, body, hasChapterToken = (token) => chapterIds.has(token)) => {
    for (const token of extractChapterIdTokens(body)) {
      if (!hasChapterToken(token)) {
        errors.push(err("missing-reference", `${label} references missing chapter ${token}`, label));
      }
    }
    for (const token of extractSceneIdTokens(body)) {
      if (!sceneIds.has(token)) {
        errors.push(err("missing-reference", `${label} references missing scene ${token}`, label));
      }
    }
  };
  const timelinePath = path.join(project.root, "plot", "timeline.md");
  if (fs.existsSync(timelinePath)) {
    try {
      const raw = readTextFile(timelinePath);
      const body = parseFrontmatter(raw, timelinePath).body ?? raw;
      checkTokens("plot/timeline.md", body);
      for (const target of extractMarkdownLinkTargets(body)) {
        checkBodyLinkTarget(project, "plot/timeline.md", target, errors);
      }
    } catch (error) {
      const message = fileErrorMessage("plot/timeline.md", relativePathError(error, timelinePath, project.root));
      if (!hasMessage(errors, message)) {
        errors.push(err("unreadable-file", message, "plot/timeline.md"));
      }
    }
  }

  for (const arc of project.arcs) {
    const label = relative(project, arc.file);
    let body = '';
    try {
      body = readMarkdown(arc.file, project.root).body ?? '';
    } catch (error) {
      const message = fileErrorMessage(label, error);
      if (!hasMessage(errors, message)) {
        errors.push(err("unreadable-file", message, label));
      }
      continue;
    }
    checkTokens(label, body, hasScheduledChapter);
    for (const target of extractMarkdownLinkTargets(body)) {
      checkBodyLinkTarget(project, label, target, errors);
    }
  }
}

// Matter pages (an epigraph's credit, an also-by list) can link to project
// files; builds print only the link text, so a broken target goes unseen.
function validateMatterBodyLinks(project, errors) {
  for (const matter of project.matter) {
    const label = relative(project, matter.file);
    let body = "";
    try {
      body = readMarkdown(matter.file, project.root).body ?? "";
    } catch (error) {
      // The file changed or went missing after the scan.
      const message = fileErrorMessage(label, error);
      if (!hasMessage(errors, message)) {
        errors.push(err("unreadable-file", message, label));
      }
      continue;
    }
    for (const target of extractMarkdownLinkTargets(body)) {
      checkBodyLinkTarget(project, label, target, errors);
    }
  }
}

function checkBodyLinkTarget(project, label, target, errors) {
  const cleaned = String(target).trim();
  if (!cleaned || /^(https?:|mailto:|#)/i.test(cleaned)) {
    return;
  }
  const pathOnly = cleaned.split("#")[0].split("?")[0];
  // Checked before the id: on Linux a backslash is part of the file name, so
  // the kebab-case message below would hide the real problem.
  if (pathOnly.includes("\\") && /\.md$/i.test(pathOnly)) {
    errors.push(err("link-backslash", `${label} links to ${cleaned} with a backslash; write ${portableSlashes(cleaned)} so the link works on every system`, label));
    return;
  }
  const base = path.basename(pathOnly);
  if (!base.endsWith(".md")) {
    return;
  }
  const id = base.slice(0, -3);
  if (!id || id === "_index" || id.includes("*")) {
    return;
  }
  if (id !== kebabCase(id)) {
    errors.push(err("link-not-kebab", `${label} links to ${cleaned} which must be kebab-case`, label));
    return;
  }
  const resolved = path.resolve(path.dirname(path.join(project.root, label)), pathOnly);
  if (!isPathInside(path.resolve(project.root), resolved)) {
    // A link into a book this one follows or precedes cites that book's
    // record (a Backstory Events row, say): accept it when the file exists.
    const linkedBook = ["follows", "precedes"]
      .flatMap((field) => seriesLinks(project.root, project.story.data, field))
      .find((bookRoot) => isPathInside(bookRoot, resolved));
    if (linkedBook && fs.existsSync(resolved) && fs.statSync(resolved).isFile()
      && isPathInside(canonicalPath(linkedBook), canonicalPath(resolved))) {
      return;
    }
    errors.push(linkedBook || !fs.existsSync(resolved)
      ? err("broken-link", `${label} links to missing file ${cleaned}`, label)
      : err("link-outside-project", `${label} links to ${cleaned} which resolves outside the project`, label));
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    errors.push(err("broken-link", `${label} links to missing file ${cleaned}`, label));
    return;
  }
  // existsSync and statSync follow symlinks, so a link can pass the lexical
  // check above and still land outside the project.
  if (!isPathInside(fs.realpathSync(project.root), fs.realpathSync(resolved))) {
    errors.push(err("link-outside-project", `${label} links to ${cleaned} which resolves outside the project`, label));
    return;
  }
  const known = new Set();
  for (const collection of [
    project.characters,
    project.locations,
    project.systems,
    project.factions,
    project.artifacts,
    project.arcs,
    project.chapters,
    project.scenes,
    project.questions,
    project.promises,
    project.clues,
    project.glossaryTerms,
    project.research,
    project.matter
  ]) {
    for (const item of collection) {
      known.add(item.id);
    }
  }
  if (!known.has(id)) {
    errors.push(err("broken-link", `${label} links to missing file ${cleaned}`, label));
  }
}

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

// Why a style-sheet samples entry cannot be used, as a warning, or null.
// validate and prose share it, so both say the same thing.
// Callers refuse an absolute path first, each in its own words.
export function sampleProblem(project, sample) {
  const target = path.resolve(project.root, sample);
  if (lstatIfExists(target) === null) {
    return warn("style-sample-missing", `${STYLE_SHEET_FILE} samples entry ${sample} names no file or folder in reach of the project`, STYLE_SHEET_FILE);
  }
  const real = canonicalPath(target);
  const self = canonicalPath(project.root);
  const chapters = path.join(self, "chapters");
  if (real === self || real === chapters || isPathInside(chapters, real)) {
    return warn("style-sample-own-chapters", `${STYLE_SHEET_FILE} samples entry ${sample} names this project's own chapters, which are what the samples are compared with: list an earlier book or approved drafts kept elsewhere`, STYLE_SHEET_FILE);
  }
  return null;
}

function readRegistryValidationData(file, root, label, errors) {
  const count = errors.length;
  const data = readValidationData(file, root, label, errors);
  if (data === null && errors.length > count) {
    const last = errors[errors.length - 1];
    errors[errors.length - 1] = { ...last, message: `${last.message}${REGISTRY_HINT}` };
  }
  return data;
}

function readValidationData(file, root, label, errors) {
  try {
    return readMarkdown(file, root).data;
  } catch (error) {
    const message = fileErrorMessage(label, error);
    if (!hasMessage(errors, message)) {
      errors.push(err("unreadable-file", message, label));
    }
    return null;
  }
}

// An entity file's frontmatter, with a warning for each key that looks like a
// misspelling of one its kind defines.
function readEntityData(file, root, label, errors, warnings, kind) {
  const data = readValidationData(file, root, label, errors);
  if (data) {
    warnNearMissKeys(data, FRONTMATTER_KEYS[kind], label, warnings);
  }
  return data;
}

// Whether a finding with this text was already reported, so a file that
// fails to parse is not reported twice.
function hasMessage(findings, message) {
  return findings.some((finding) => finding.message === message);
}

function entityFileNames(root, relativeDir) {
  const directory = path.join(root, relativeDir);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory).filter((name) => name.endsWith(".md") && !name.startsWith(".") && name !== "_index.md").sort().map((name) => path.posix.join(relativeDir, name));
}

function collectStrayFileWarnings(project, warnings) {
  const root = project.root;
  // The root was already proven readable by the scan, so this cannot fail.
  const topEntries = fs.readdirSync(root, { withFileTypes: true });
  const strayTop = [];
  for (const entry of topEntries) {
    if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".") && entry.name !== "story.md" && entry.name !== STYLE_SHEET_FILE && entry.name !== PROGRESS_FILE) {
      strayTop.push(entry.name);
    }
  }
  strayTop.sort();
  for (const name of strayTop) {
    warnings.push(warn("stray-file", `${name} is not part of the story project model and is ignored`, name));
  }

  const nested = [];
  for (const relativeDir of ENTITY_SCAN_DIRS) {
    const directory = path.join(root, relativeDir);
    if (!fs.existsSync(directory)) {
      continue;
    }
    for (const file of markdownFiles(directory)) {
      const relativePath = path.relative(directory, file);
      if (relativePath.includes(path.sep) || path.dirname(relativePath) !== ".") {
        nested.push(portablePath(path.join(relativeDir, relativePath)));
      }
    }
  }
  nested.sort();
  for (const nestedPath of nested) {
    warnings.push(warn("nested-file", `${nestedPath} is nested inside an entity directory and is ignored`, nestedPath));
  }

  // The scan never reads through a symlink, so a linked chapter would drop
  // out of registries, counts, and builds without a word.
  for (const relativeDir of ENTITY_SCAN_DIRS) {
    const directory = path.join(root, relativeDir);
    if (!lstatIfExists(directory)?.isDirectory()) {
      continue;
    }
    const linked = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isSymbolicLink() && entry.name.endsWith(".md") && !entry.name.startsWith(".") && entry.name !== "_index.md")
      .map((entry) => path.posix.join(relativeDir, entry.name))
      .sort();
    for (const linkPath of linked) {
      warnings.push(warn("symlinked-file", `${linkPath} is a symlink and is ignored: replace it with the file itself`, linkPath));
    }
  }

  for (const leftover of temporaryFiles(root).map((file) => portablePath(file)).sort()) {
    const name = TEMPORARY_FILE_PATTERN.exec(path.posix.basename(leftover))?.[1];
    const target = name ? ` to ${path.posix.join(path.posix.dirname(leftover), name)}` : "";
    warnings.push(warn("interrupted-write", `${leftover} was left by an interrupted write${target}; delete it once the files beside it look right`, leftover));
  }
}

// Temporary files writeFile leaves when a process is killed before its
// rename; `.story-<pid>.tmp` is the older name without the target.
function temporaryFiles(root, depth = 0, relativeDir = "") {
  const found = [];
  for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory() && !SKIPPED_SCAN_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
      if (depth < MAX_SCAN_DEPTH) {
        found.push(...temporaryFiles(root, depth + 1, relativePath));
      }
    } else if (entry.isFile() && (TEMPORARY_FILE_PATTERN.test(entry.name) || /^\.story-\d+\.tmp$/.test(entry.name))) {
      found.push(relativePath);
    }
  }
  return found;
}

function checkIdReference(errors, label, value, kind, exists, file = label) {
  const text = String(value ?? "");
  if (text === "") {
    return;
  }
  if (text !== kebabCase(text)) {
    errors.push(err("id-not-kebab", `${label} references ${kind} ${text} which must be kebab-case`, file));
    return;
  }
  if (!exists(text)) {
    errors.push(err("missing-reference", `${label} references missing ${kind} ${text}`, file));
  }
}

// Bare chapter and scene ids, with the boundaries move uses when it rewrites
// them: `chapter-01-draft` and `pre-chapter-01` are not ids. Link destinations
// and URLs are skipped: links are checked as files, and a URL or a path into
// another book does not name this book's chapter.
function extractChapterIdTokens(body) {
  return idTokensOutsideLinks(body, /(?<![\w-])chapter-\d+(?![\w-])/g);
}

function extractSceneIdTokens(body) {
  return idTokensOutsideLinks(body, /(?<![\w-])chapter-\d+-scene-\d+(?![\w-])/g);
}

function idTokensOutsideLinks(body, pattern) {
  const found = [];
  mapOutsideLinks(body, (text) => {
    found.push(...(text.match(pattern) ?? []));
    return text;
  });
  return found;
}

function extractMarkdownLinkTargets(body) {
  const targets = [];
  const pattern = /\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    // `[x](<a.md>)` and `[x](a.md "Title")` both link to a.md. An unquoted
    // space stays in the target so `(Bad Name.md)` is still reported.
    const inner = match[1].trim();
    const bracketed = /^<([^>]*)>/.exec(inner);
    const target = (bracketed ? bracketed[1] : inner.replace(/\s+(?:"[^"]*"|'[^']*')$/, "")).trim();
    if (target && !/^(https?:|mailto:|#)/i.test(target)) {
      targets.push(target.split("#")[0].split("?")[0]);
    }
  }
  // Reference-style definitions: `[label]: ../characters/bo.md`.
  for (const definition of body.matchAll(LINK_DEFINITION_PATTERN)) {
    const target = definition[3].replace(/^<|>$/g, "").trim();
    if (target && !/^(https?:|mailto:|#)/i.test(target)) {
      targets.push(target.split("#")[0].split("?")[0]);
    }
  }
  return targets;
}

// With story.md unreadable or untitled, the story id is only the folder name,
// so comparing every registry's `story` with it would repeat one problem.
function storyIdIsFallback(project) {
  return Boolean(project.story.unreadable) || kebabCase(String(project.story.data.title ?? ""), { transliterate: false }) === "";
}

// Free-text and id fields the schema types as strings. An unquoted `1984`
// or `true` parses as a number or boolean, which other YAML tools read as
// such, so validate asks for quotes.
const TEXT_FIELDS = {
  characters: ["pronunciation", "name", "died-in", "revived-in", "arc", "lie", "truth", "ghost-wound"],
  locations: ["pronunciation", "name", "type", "region", "controlled-by", "status"],
  systems: ["pronunciation", "name", "type", "prevalence"],
  factions: ["pronunciation", "name"],
  artifacts: ["pronunciation", "name", "owner", "location"],
  arcs: ["name"],
  chapters: ["title", "pov", "mode", "date", "time", "episode-question", "time-skip", "strand"],
  scenes: ["title", "chapter", "pov", "location", "date", "time", "dilemma", "flashback-to"],
  questions: ["title", "introduced", "resolved"],
  promises: ["title", "planted", "payoff"],
  clues: ["title", "planted", "payoff"],
  glossaryTerms: ["pronunciation", "term"],
  research: ["title"],
  matter: ["title", "rights-holder", "credit"]
};

const STORY_TEXT_FIELDS = ["title", "series", "series-title", "genre", "sub-genre", "setting-era", "pov", "premise", "counter-premise", "author", "season-goal", "language", "publisher", "publication-date", "description", "copyright", "cover-alt", "ai-disclosure", "draft-mode", "cover", "deadline"];

function validateTextFields(project, errors) {
  const check = (label, data, fields) => {
    for (const field of fields) {
      const value = data?.[field];
      if (typeof value === "number" || typeof value === "boolean") {
        errors.push(err("field-not-text", `${label} frontmatter field ${field} must be text: quote it as ${field}: "${value}"`, label));
      } else if (Array.isArray(value) && !errors.some((error) => error.file === label && error.message.includes(` ${field} `))) {
        // Another check may already have said the field cannot be a list.
        errors.push(err("field-not-text", `${label} frontmatter field ${field} must be text, not a list`, label));
      }
    }
  };
  if (!project.story.unreadable) {
    check("story.md", project.story.data, STORY_TEXT_FIELDS);
  }
  for (const [collection, fields] of Object.entries(TEXT_FIELDS)) {
    for (const entity of project[collection] ?? []) {
      check(relative(project, entity.file), entity.frontmatter, fields);
    }
  }
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
  validatePasses(data, "story.md", errors);
  validateCliConfig(data, errors);
  validateDeadline(data, errors);
  validateDailyTarget(data, errors);
  if (data.ifid !== undefined && !isIfid(data.ifid)) {
    errors.push(err("invalid-ifid", "story.md ifid must be a version 4 UUID, such as 3F2C9A61-7B1D-4E8A-9C3B-2A6D5E4F1B07", "story.md"));
  }

  if (newerSchemaVersion(data["schema-version"]) !== null) {
    errors.push(err("schema-too-new", newerSchemaMessage(newerSchemaVersion(data["schema-version"])), "story.md"));
  } else if (data["schema-version"] !== undefined && data["schema-version"] !== STORY_SCHEMA_VERSION) {
    errors.push(err("schema-version-mismatch", `story.md schema-version must be ${STORY_SCHEMA_VERSION}`, "story.md"));
  }
}

// A path written with Windows separators resolves on Windows and fails on
// Linux and macOS (a CI runner, say), so warn on every platform.
function validatePortablePaths(project, warnings) {
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

function portableSlashes(value) {
  return String(value).replace(/\\/g, "/");
}

function validatePronunciations(project, errors) {
  const entities = [project.characters, project.locations, project.systems, project.factions, project.artifacts, project.glossaryTerms].flat();
  for (const entity of entities) {
    if (entity.pronunciation !== undefined && typeof entity.pronunciation !== "string") {
      errors.push(err("field-not-text", `${relative(project, entity.file)} frontmatter field pronunciation must be text`, relative(project, entity.file)));
    }
  }
}

// The target and, once the book is complete, the manuscript, against the
// form's usual range in the count unit. A language counted in characters
// without ranges of its own is not checked.
function validateFormRange(project, warnings) {
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
function unusedTargetWarnings(project, label, data, warnings) {
  const { unit } = project;
  const other = [...COUNT_UNITS.values()].find((entry) => entry !== unit);
  for (const field of ["targetField", "dailyTargetField"]) {
    if (data[other[field]] !== undefined && data[unit[field]] === undefined) {
      const why = project.story.data["count-unit"] === undefined ? `language ${project.language}` : "count-unit";
      warnings.push(warn("unused-target", `${label} ${other[field]} is not measured: this book counts ${unit.name} (${why}), so set ${unit[field]}`, label));
    }
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

// Per kind, the fields a progression may not change because they hold lists,
// and the fields whose values are checked against an allowed set.
const PROGRESSION_RULES = {
  character: {
    lists: new Set(["aliases", "relationships", "locations", "tags", "voice-words", "voice-avoid"]),
    enums: new Map([["role", CHARACTER_ROLES], ["status", CHARACTER_STATUSES]])
  },
  location: {
    lists: new Set(["notable-characters", "tags", "routes"]),
    enums: new Map([["setting", SCENE_SETTINGS]])
  },
  faction: {
    lists: new Set(["members", "locations", "tags"]),
    enums: new Map([["type", FACTION_TYPES], ["status", FACTION_STATUSES]])
  }
};

function validateCharacters(project, errors, warnings) {
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
    // a progression alone raises only warnings.
    for (const [index, item] of asArray(data.progressions).entries()) {
      if (item && typeof item === "object" && item.field === "status" && item.value === "deceased" && idText(item.from) !== character.diedIn) {
        warnings.push(warn("deceased-without-died-in", `${label} progressions[${index}] makes ${character.id} deceased from ${idText(item.from) || "?"}; set died-in: ${idText(item.from) || "<chapter>"} too so story continuity treats appearances after the death as errors`, label));
      }
    }
  }
}

function validateLocations(project, errors, warnings) {
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
    }
    validateProgressions(data, label, PROGRESSION_RULES.location, chronology, errors);
  }
}

function validateSystems(project, errors, warnings) {
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

function validateFactions(project, errors, warnings) {
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

function validateArtifacts(project, errors, warnings) {
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

function validateArcs(project, errors, warnings) {
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

function validateChapters(project, errors, warnings) {
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
      validateUnitDate(data, label, errors);
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
    validateEnum(data, "hook", CHAPTER_HOOKS, label, errors);
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

function validateScenes(project, errors, warnings) {
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
      validateUnitDate(data, label, errors);
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

// Keys whose absence changes the meaning of an entry (no `learned-in` means
// known before the story), so a misspelling asserts the opposite of what
// was meant.
const STATE_ENTRY_KEYS = {
  "character-state": FRONTMATTER_KEYS.characterState,
  "object-state": FRONTMATTER_KEYS.objectState,
  "knowledge-state": FRONTMATTER_KEYS.knowledgeState
};

function validateContinuityState(project, errors, warnings) {
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

function validateQuestions(project, errors, warnings) {
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

function validatePromises(project, errors, warnings) {
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

function validateClues(project, errors, warnings) {
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

function validateExemptions(project, errors, warnings) {
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

function validateGlossaryTerms(project, errors, warnings) {
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

function validateStyleSheet(project, errors, warnings) {
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
      && lowerCase(entry.use.trim(), project.pack) === lowerCase(entry.avoid.trim(), project.pack)) {
      errors.push(err("style-use-equals-avoid", `${entryLabel} use and avoid must differ`, label));
    }
  });
  validateStringArray(data, "watch-words", label, errors);
  validateStringArray(data, "allow-words", label, errors);
  for (const field of STYLE_LIST_FIELDS) {
    validateStyleLists(data, field, label, errors, warnings);
  }
  validateStringArray(data, "samples", label, errors);
  for (const entry of asArray(data.samples)) {
    if (typeof entry !== "string" || entry.trim() === "") {
      continue;
    }
    const sample = entry.trim();
    if (path.isAbsolute(sample) || /^[A-Za-z]:/.test(sample)) {
      errors.push(err("field-invalid-items", `${label} samples entry ${sample} must be a path relative to the project folder, such as ../book-one`, label));
    } else {
      const problem = sampleProblem(project, sample);
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
    const dateError = storyDateError(entry.date);
    if (entry.date === undefined || dateError !== "") {
      errors.push(err("invalid-date", `${label} ${dateError || "requires a date"}`, PROGRESS_FILE));
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

function validateOptionalRegistry(project, directory, expectedType, errors) {
  const indexPath = path.join(project.root, directory, "_index.md");
  if (fs.existsSync(indexPath)) {
    const label = path.join(directory, "_index.md");
    const data = readRegistryValidationData(indexPath, project.root, label, errors);
    if (data && data.type !== expectedType) {
      errors.push(err("wrong-type", `${label} type must be ${expectedType}`, label));
    }
  }
}

function validateResearch(project, errors, warnings) {
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

function validateMatter(project, errors, warnings) {
  validateOptionalRegistry(project, MATTER_DIR, "matter-registry", errors);
  for (const matter of project.matter) {
    const label = relative(project, matter.file);
    if (matter.empty) {
      warnings.push(warn("empty-matter", `${label} has no text and is left out of export and build`, label));
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
}

function validateCover(project, errors) {
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

function validateEntityId(id, label, errors) {
  if (id !== kebabCase(id)) {
    errors.push(err("id-not-kebab", `${label} filename id must be kebab-case`, label));
  }
}

// A chapter or scene date shaped like YYYY-MM-DD must be a real calendar
// day; story continuity warns about other text.
function validateUnitDate(data, label, errors) {
  if (typeof data.date !== "string") {
    return;
  }
  const dateError = storyDateError(data.date, { freeText: true });
  if (dateError !== "") {
    errors.push(err("invalid-date", `${label} ${dateError}`, label));
  }
}

function requireScalar(data, field, label, errors, file = label) {
  if (data[field] !== undefined && (Array.isArray(data[field]) || typeof data[field] === "object")) {
    errors.push(err("field-not-scalar", `${label} frontmatter field ${field} must be a scalar`, file));
  }
}

export function requireInteger(data, field, label, errors, minimum) {
  if (data[field] === undefined) {
    return;
  }
  if (!Number.isInteger(data[field])) {
    errors.push(err("field-not-integer", `${label} frontmatter field ${field} must be an integer`, label));
  } else if (minimum !== undefined && data[field] < minimum) {
    errors.push(err("field-below-minimum", `${label} frontmatter field ${field} must be at least ${minimum}`, label));
  }
}

function validateStringArray(data, field, label, errors) {
  if (data[field] === undefined) {
    return;
  }

  if (!Array.isArray(data[field])) {
    errors.push(err("field-not-list", `${label} frontmatter field ${field} must be a list`, label));
    return;
  }

  for (const item of data[field]) {
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(err("field-invalid-items", `${label} frontmatter field ${field} must contain only non-empty strings`, label));
    }
  }
}

// Warns about a key that is a near miss for a known one, such as
// `learned_in`, `Learned-In`, `since_chapter`, or `stauts`, which would
// otherwise be ignored. Keys far from every known one stay allowed as
// custom fields, and so does a near miss whose intended key is also set;
// of several equally close keys, those not set are named.
function warnNearMissKeys(data, keys, label, warnings, file = label) {
  for (const key of Object.keys(data)) {
    const intended = nearMissKeys(key, keys).filter((candidate) => !Object.hasOwn(data, candidate));
    if (intended.length > 0) {
      warnings.push(warn("near-miss-key", `${label} has ${key}; did you mean ${intended.join(" or ")}?`, file));
    }
  }
}

function validateObjectArray(data, field, label, errors) {
  if (data[field] === undefined) {
    return;
  }

  if (!Array.isArray(data[field])) {
    errors.push(err("field-not-list", `${label} frontmatter field ${field} must be a list`, label));
    return;
  }

  for (const item of data[field]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(err("field-invalid-items", `${label} frontmatter field ${field} must contain objects`, label));
    }
  }
}

function validateRelationships(data, label, errors) {
  if (data.relationships === undefined) {
    return;
  }

  if (!Array.isArray(data.relationships)) {
    errors.push(err("field-not-list", `${label} frontmatter field relationships must be a list`, label));
    return;
  }

  for (const relationship of data.relationships) {
    if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
      errors.push(err("field-invalid-items", `${label} frontmatter field relationships must contain objects`, label));
      continue;
    }

    if (typeof relationship.character !== "string" || relationship.character.trim() === "") {
      errors.push(err("missing-field", `${label} relationship is missing character`, label));
    } else if (relationship.character !== kebabCase(relationship.character)) {
      errors.push(err("id-not-kebab", `${label} relationship character ${relationship.character} must be kebab-case`, label));
    }

    if (typeof relationship.type !== "string" || relationship.type.trim() === "") {
      errors.push(err("missing-field", `${label} relationship to ${relationship.character ?? "unknown"} is missing type`, label));
    }
  }
}

function validateEnum(data, field, allowed, label, errors) {
  if (Array.isArray(data[field])) {
    // requireScalar may already have reported the same field.
    const scalar = `${label} frontmatter field ${field} must be a scalar`;
    if (!hasMessage(errors, scalar)) {
      errors.push(err("field-not-scalar", `${label} frontmatter field ${field} must be a single value, not a list`, label));
    }
  } else if (data[field] !== undefined && !allowed.has(data[field])) {
    errors.push(err("unsupported-value", `${label} frontmatter field ${field} has unsupported value ${data[field]}`, label));
  }
}

function inverseRelationshipTypes(type) {
  if (RELATIONSHIP_INVERSES.has(type)) {
    return RELATIONSHIP_INVERSES.get(type);
  }

  return SYMMETRIC_RELATIONSHIPS.has(type) ? [type] : [];
}

function requireFields(data, fields, label, errors) {
  for (const field of fields) {
    if (data[field] === undefined || (typeof data[field] === "string" && data[field].trim() === "")) {
      errors.push(err("missing-field", `${label} is missing frontmatter field ${field}`, label));
    }
  }
}

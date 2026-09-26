import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkContinuity, storyDateError, storyTimeError } from "./continuity.js";
import { FRONTMATTER_PATTERN, parseFrontmatter, replaceFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { readTextFile } from "./files.js";
import { isTruthy } from "./options.js";
import { chapterHeading, chapterProse, escapeRegExp, extractSection, fencedLineIndexes, hasUnclosedComment, isSceneBreak, kebabCase, titleCaseSlug, wordCount } from "./markdown.js";
import { buildTimeline } from "./timeline.js";
import { buildClueMatrix } from "./clues.js";
import { buildDiagram } from "./diagram.js";
import { buildVoices } from "./voices.js";
import { checkNames, existingNames } from "./names.js";
import { STORY_FORMS, formRangeWarning } from "./forms.js";
import { copyrightPage, metadataSheet, publishingMeta, validatePublishing } from "./publishing.js";
import { DEFAULT_TRIM, escapeHtml, estimatePages, printHtml, reviewHtml } from "./html.js";
import { narrationScript, pronunciationGuide } from "./narration.js";
import { DEFAULT_PASSES, addedPassNotes, nextPass, readPasses, updatePasses, validatePasses } from "./passes.js";
import { CHAPTER_HOOKS, SCENE_OUTCOMES, buildPacing } from "./pacing.js";
import { compareChapters, proseParagraphs } from "./compare.js";
import { PROGRESS_FILE, cleanSessions, computeProgress, localDate, withSession } from "./progress.js";
import { analyzeChapter, chapterFindings, proseRules, repeatedPhrases, similarNames } from "./prose.js";
import { buildSeries, readBookFrontmatter, seriesLinkPath, validateSeriesLinks, withSeriesBacklink } from "./series.js";

export const STORY_SCHEMA_VERSION = 2;

// Only files are required. Entity folders such as worldbuilding/locations or
// plot/arcs start empty, and git does not keep empty directories, so a fresh
// clone of a new project would otherwise fail validation. Folders that hold a
// registry are implied by that registry file.
const REQUIRED_PATHS = [
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
const PROJECT_DIRECTORIES = [
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

const INDEX_SCHEMAS = [
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

const STORY_STATUSES = new Set(["planning", "drafting", "in-progress", "revising", "complete", "abandoned"]);
const STORY_TENSES = new Set(["past", "present", "future", "mixed"]);
const CHARACTER_ROLES = new Set(["protagonist", "antagonist", "supporting", "minor", "narrator", "deuteragonist"]);
const CHARACTER_STATUSES = new Set(["alive", "deceased", "unknown", "missing", "cut"]);
const ARC_TYPES = new Set(["main", "subplot", "character", "thematic"]);
const ARC_STATUSES = new Set(["planned", "in-progress", "resolved"]);
const CHAPTER_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);
const SCENE_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);
const FACTION_TYPES = new Set(["family", "guild", "government", "military", "religion", "company", "community", "criminal", "other"]);
const FACTION_STATUSES = new Set(["active", "hidden", "declining", "defeated", "disbanded", "unknown"]);
const ARTIFACT_TYPES = new Set(["object", "weapon", "document", "technology", "relic", "symbol", "resource", "other"]);
const ARTIFACT_STATUSES = new Set(["active", "lost", "destroyed", "hidden", "transferred", "unknown"]);
const QUESTION_STATUSES = new Set(["open", "answered", "resolved", "dropped", "abandoned"]);
const PROMISE_STATUSES = new Set(["planned", "planted", "paid-off", "dropped", "abandoned"]);
const CLUE_STATUSES = new Set(["planned", "planted", "paid-off", "dropped", "abandoned"]);
const TERM_CATEGORIES = new Set(["person", "place", "faction", "artifact", "concept", "term", "other"]);
export const STYLE_DIALECTS = new Set(["british", "american", "unspecified"]);
export const STYLE_SHEET_FILE = "style-sheet.md";
const MATTER_PLACEMENTS = new Set(["front", "back"]);
const MATTER_PERMISSIONS = new Set(["not-needed", "pending", "granted", "public-domain"]);
const MATTER_DIR = "matter";
const RESEARCH_STATUSES = new Set(["open", "verified", "disputed"]);
const RESEARCH_ACCURACY = new Set(["must-be-accurate", "blended", "invented"]);
const RESEARCH_CONFIDENCE = new Set(["high", "medium", "low"]);
const RESEARCH_METHODS = new Set(["fact", "interview", "site-visit", "expert-review", "reading"]);
const RESEARCH_RISKS = new Set(["legal", "medical", "weapons", "safety", "cultural", "defamation", "technical"]);
const RESEARCH_DIR = "research";
// Chapter statuses that mean the prose is settled, so it should not rest on
// research that is still open or disputed.
const SETTLED_CHAPTER_STATUSES = new Set(["final", "complete"]);
// EPUB 3 core media types for a cover image, keyed by file extension.
const COVER_MEDIA_TYPES = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

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

export function createStoryProject(options) {
  const title = String(options.title ?? "").trim();
  if (!title) {
    throw new Error("A story title is required");
  }

  const cwd = options.cwd ?? process.cwd();
  // A title with no ASCII letters or digits (a translated edition, say) takes
  // its story id from the project folder, as scanProject does.
  const titleId = kebabCase(title);
  if (!titleId && options.dir === undefined) {
    throw new Error('Cannot derive a story id from title "' + title + '": pass --dir with an ASCII folder name, or use a title containing ASCII letters or digits');
  }
  const root = path.resolve(cwd, options.dir ?? titleId);
  const storyId = deriveStoryId(title, root);
  // The story id names the default folder and every build file.
  assertPortableId(storyId, "story");
  if (WINDOWS_RESERVED_ID.test(path.basename(root).toLowerCase())) {
    throw new Error(`Cannot use folder ${path.basename(root)}: Windows reserves that name. Choose another --dir`);
  }
  if (!storyId) {
    throw new Error('Cannot derive a story id from title "' + title + '" or folder "' + path.basename(root) + '": use an ASCII folder name with --dir');
  }
  // --force overwrites starter files and import --force deletes chapter
  // files, so never follow a symlinked project root to another directory.
  if (lstatIfExists(root)?.isSymbolicLink()) {
    throw new Error(`Refusing to use symlinked project directory: ${root}`);
  }
  if (fs.existsSync(root) && !options.force) {
    throw new Error(`${root} already exists. Use --force to add missing starter files; existing files are never overwritten.`);
  }

  if (options.tense !== undefined && options.tense !== "" && !STORY_TENSES.has(options.tense)) {
    throw new Error(`Unsupported tense "${options.tense}": expected one of ${[...STORY_TENSES].join(", ")}`);
  }
  if (options.form !== undefined && !STORY_FORMS.has(options.form)) {
    throw new Error(`Unsupported form "${options.form}": expected one of ${[...STORY_FORMS.keys()].join(", ")}`);
  }

  const series = resolveSeriesOptions(root, cwd, options);
  const inherited = series.linked[0]?.data ?? {};
  const themes = normalizeList(options.themes, ["change"]);
  for (const directory of PROJECT_DIRECTORIES) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }

  const storyWritten = writeStarterFile(path.join(root, "story.md"), storyBible({
    title,
    storyId,
    series: series.series,
    bookNumber: series.bookNumber,
    follows: series.follows,
    precedes: series.precedes,
    genre: options.genre ?? inherited.genre ?? "fiction",
    subGenre: options.subGenre ?? inherited["sub-genre"] ?? "general",
    settingEra: options.settingEra ?? "unspecified",
    themes,
    pov: options.pov ?? inherited.pov ?? "third-person-limited",
    tense: options.tense ?? inherited.tense ?? "past",
    form: options.form,
    synopsis: options.synopsis ?? "Add a 2-3 sentence synopsis here."
  }), { root });
  writeStarterFile(path.join(root, "characters", "_index.md"), characterIndex(storyId, [], "", ""), { root });
  writeStarterFile(path.join(root, "worldbuilding", "_index.md"), worldIndex(storyId, [], [], [], [], ""), { root });
  writeStarterFile(path.join(root, "plot", "_index.md"), plotIndex(storyId, "three-act", [], "", ""), { root });
  writeStarterFile(path.join(root, "plot", "timeline.md"), timeline(storyId), { root });
  writeStarterFile(path.join(root, "chapters", "_index.md"), chapterIndex(storyId, []), { root });
  writeStarterFile(path.join(root, "scenes", "_index.md"), sceneIndex(storyId, []), { root });
  writeStarterFile(path.join(root, "continuity", "state.md"), continuityState(storyId), { root });
  writeStarterFile(path.join(root, "continuity", "questions", "_index.md"), questionIndex(storyId, []), { root });
  writeStarterFile(path.join(root, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), { root });
  writeStarterFile(path.join(root, "continuity", "clues", "_index.md"), clueIndex(storyId, []), { root });
  writeStarterFile(path.join(root, "glossary", "_index.md"), glossaryIndex(storyId, []), { root });
  writeStarterFile(path.join(root, STYLE_SHEET_FILE), styleSheet(), { root });

  const linkedBooks = [];
  // An existing story.md is preserved under --force, so only add backlinks
  // when this run wrote the forward links they must mirror.
  for (const book of storyWritten ? series.linked : []) {
    const updated = withSeriesBacklink(book.root, book.inverse, root, series.series);
    if (updated !== null) {
      writeFile(path.join(book.root, "story.md"), updated, { root: book.root });
      linkedBooks.push(book.root);
    }
  }

  return { root, storyId, linkedBooks, files: REQUIRED_PATHS.filter((entry) => entry.endsWith(".md")) };
}

// Writes a scaffold file only when nothing exists at the path, so `init
// --force` fills gaps in an existing project without clobbering user work.
function writeStarterFile(filePath, contents, options) {
  if (lstatIfExists(filePath)) {
    // A preserved file must still sit inside the project, so a symlinked
    // directory (chapters/, say) cannot redirect later writes elsewhere.
    assertSafeProjectPath(filePath, options.root);
    return false;
  }
  writeFile(filePath, contents, options);
  return true;
}

// Resolves --follows/--precedes against the working directory, confirms each
// target is a story project, and inherits the series id and next publication
// number from the linked books when the caller did not set them.
function resolveSeriesOptions(root, cwd, options) {
  const linked = [];
  for (const [field, inverse] of [["follows", "precedes"], ["precedes", "follows"]]) {
    for (const value of asArray(options[field]).filter((item) => typeof item === "string" && item.trim() !== "")) {
      const bookRoot = path.resolve(cwd, value);
      if (bookRoot === root) {
        throw new Error(`--${field} ${value} points at the new story itself`);
      }
      const data = readBookFrontmatter(bookRoot);
      if (!data) {
        throw new Error(`--${field} ${value} is not a story project: missing story.md`);
      }
      linked.push({ field, inverse, root: bookRoot, data });
    }
  }

  const series = options.series ?? linked.map((book) => book.data.series).find((value) => value !== undefined);
  if (series !== undefined && !isKebabId(String(series))) {
    throw new Error(`Series id must be kebab-case: ${series}`);
  }

  let bookNumber;
  if (options.bookNumber !== undefined) {
    bookNumber = requirePositiveInteger(options.bookNumber, "Book number");
  } else if (linked.length > 0) {
    const numbers = linked.map((book) => book.data["book-number"]).filter((value) => Number.isInteger(value));
    // Publication order: the new book comes after every numbered book already
    // in the series, not just the directly linked ones, so it never collides.
    const all = numbers.concat(seriesBookNumbers(linked));
    bookNumber = all.length > 0 ? Math.max(...all) + 1 : undefined;
  }

  const linkPaths = (field) => linked.filter((book) => book.field === field).map((book) => seriesLinkPath(root, book.root));
  return { linked, series, bookNumber, follows: linkPaths("follows"), precedes: linkPaths("precedes") };
}

function seriesBookNumbers(linked) {
  const numbers = [];
  for (const book of linked) {
    try {
      for (const entry of buildSeries(book.root, scanProject).books) {
        if (Number.isInteger(entry.bookNumber)) {
          numbers.push(entry.bookNumber);
        }
      }
    } catch {
      // Fall back to the directly linked numbers when the series cannot be read.
    }
  }
  return numbers;
}

// The story id is the kebab-case title, or the project folder name when the
// title is missing or has no ASCII letters or digits.
function deriveStoryId(title, root) {
  return kebabCase(String(title ?? "")) || kebabCase(path.basename(root));
}

export function scanProject(root) {
  const projectRoot = path.resolve(root);
  const scanErrors = [];
  const storyPath = requireStoryFile(projectRoot);
  let story;
  try {
    story = readMarkdown(storyPath, projectRoot);
  } catch (error) {
    scanErrors.push(`story.md: ${error.message}`);
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
      scanErrors.push(`${path.join("continuity", "state.md")}: ${error.message}`);
      continuity = null;
    }
  }

  return {
    root: projectRoot,
    story,
    storyId,
    // Display title: story.md `title`, else the folder name.
    title: titleText || path.basename(projectRoot),
    fileErrors: scanErrors,
    characters: readEntityFiles(projectRoot, "characters", (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      role: data.role ?? "",
      status: data.status ?? "",
      arc: String(data.arc ?? ""),
      diedIn: String(data["died-in"] ?? ""),
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
      pronunciation: data.pronunciation
    }), scanErrors),
    systems: readEntityFiles(projectRoot, path.join("worldbuilding", "systems"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? ""
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
      pov: data.pov ?? "",
      status: data.status ?? "",
      characters: asArray(data.characters),
      mentions: asArray(data.mentions),
      locations: asArray(data.locations),
      arcsAdvanced: asArray(data["arcs-advanced"]),
      // A non-integer count is a validate error; null keeps it out of the
      // declared-versus-actual comparison instead of printing NaN.
      declaredWordCount: data["word-count"] === undefined ? 0 : Number.isInteger(data["word-count"]) ? data["word-count"] : null,
      targetWords: Number.isInteger(data["target-words"]) && data["target-words"] > 0 ? data["target-words"] : 0,
      wordCount: wordCount(chapterProse(markdown.body)),
      unclosedComment: hasUnclosedComment(chapterProse(markdown.body)),
      date: String(data.date ?? ""),
      time: String(data.time ?? ""),
      mode: String(data.mode ?? ""),
      hasPostHocNotes: /^## Chapter Notes \(post-hoc\)\s*$/m.test(markdown.body),
      hook: typeof data.hook === "string" ? data.hook : ""
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
      pov: data.pov ?? "",
      location: data.location ?? "",
      status: data.status ?? "",
      characters: asArray(data.characters),
      mentions: asArray(data.mentions),
      arcsAdvanced: asArray(data["arcs-advanced"]),
      stateChanges: asArray(data["state-changes"]),
      date: String(data.date ?? ""),
      time: String(data.time ?? ""),
      travelHours: typeof data["travel-hours"] === "number" ? data["travel-hours"] : 0,
      sequel: typeof data.sequel === "boolean" ? data.sequel : false,
      outcome: typeof data.outcome === "string" ? data.outcome : "",
      dilemma: String(data.dilemma ?? ""),
      flashbackTo: String(data["flashback-to"] ?? "")
    }), scanErrors).sort((left, right) => left.chapter.localeCompare(right.chapter, "en") || left.scene - right.scene || left.file.localeCompare(right.file, "en")),
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
      errors.push(`Missing required path: ${requiredPath} (story migrate adds missing registries)`);
    }
  }
  for (const scanError of project.fileErrors ?? []) {
    errors.push(scanError);
  }
  validateStoryFrontmatter(project, errors);
  validateIndexFrontmatter(project, errors);
  validateCharacters(project, errors);
  validateLocations(project, errors);
  validateSystems(project, errors);
  validateFactions(project, errors);
  validateArtifacts(project, errors);
  validateArcs(project, errors);
  validateChapters(project, errors);
  validateScenes(project, errors);
  validateContinuityState(project, errors);
  validateQuestions(project, errors);
  validatePromises(project, errors);
  validateClues(project, errors);
  validateExemptions(project, errors);
  validateGlossaryTerms(project, errors);
  validateStyleSheet(project, errors);
  validateMatter(project, errors, warnings);
  validateResearch(project, errors, warnings);
  validateProgressLog(project, errors);
  validateFormRange(project, warnings);
  validatePublishing(project.story.data, errors, warnings);
  validatePronunciations(project, errors);
  collectStrayFileWarnings(project, warnings);
  for (const file of ENTITY_SCAN_DIRS.flatMap((dir) => entityFileNames(projectRoot, dir))) {
    if (WINDOWS_RESERVED_ID.test(path.basename(file, ".md").toLowerCase())) {
      warnings.push(`${file} uses a file name Windows reserves, so the project cannot be checked out on Windows; rename the entity`);
    }
  }

  const indexChecks = [
    [path.join("characters", "_index.md"), project.characters.map((item) => `](${item.id}.md)`)],
    [path.join("worldbuilding", "_index.md"), project.locations.map((item) => `](locations/${item.id}.md)`)
      .concat(project.systems.map((item) => `](systems/${item.id}.md)`))
      .concat(project.factions.map((item) => `](factions/${item.id}.md)`))
      .concat(project.artifacts.map((item) => `](artifacts/${item.id}.md)`))],
    [path.join("plot", "_index.md"), project.arcs.map((item) => `](arcs/${item.id}.md)`)],
    [path.join("chapters", "_index.md"), project.chapters.map((item) => `](${path.basename(item.file)})`)],
    [path.join("scenes", "_index.md"), project.scenes.map((item) => `](${item.id}.md)`)],
    [path.join("continuity", "questions", "_index.md"), project.questions.map((item) => `](${item.id}.md)`)],
    [path.join("continuity", "promises", "_index.md"), project.promises.map((item) => `](${item.id}.md)`)],
    [path.join("continuity", "clues", "_index.md"), project.clues.map((item) => `](${item.id}.md)`)],
    [path.join("glossary", "_index.md"), project.glossaryTerms.map((item) => `](terms/${item.id}.md)`)],
    // The matter and research registries are optional; reindex creates each
    // one alongside its folder.
    ...(fs.existsSync(path.join(projectRoot, MATTER_DIR, "_index.md"))
      ? [[path.join(MATTER_DIR, "_index.md"), project.matter.map((item) => `](${item.id}.md)`)]]
      : []),
    ...(fs.existsSync(path.join(projectRoot, RESEARCH_DIR, "_index.md"))
      ? [[path.join(RESEARCH_DIR, "_index.md"), project.research.map((item) => `](${item.id}.md)`)]]
      : [])
  ];

  for (const [indexPath, links] of indexChecks) {
    let markdown;
    try {
      markdown = safeRead(path.join(projectRoot, indexPath), projectRoot);
    } catch (error) {
      errors.push(`${indexPath}: ${error.message}`);
      continue;
    }
    for (const link of links) {
      if (!markdown.includes(link)) {
        warnings.push(`${indexPath} is missing registry link ${link}`);
      }
    }
  }

  for (const chapter of project.chapters) {
    if (chapter.declaredWordCount !== null && chapter.declaredWordCount !== chapter.wordCount) {
      warnings.push(`${path.relative(projectRoot, chapter.file)} declares ${chapter.declaredWordCount} words but contains ${chapter.wordCount}`);
    }

    if (chapter.unclosedComment) {
      warnings.push(`${path.relative(projectRoot, chapter.file)} opens an HTML comment (<!--) that never closes, so the text after it shows in builds and word counts`);
    }

    if (!project.scenes.some((scene) => scene.chapter === chapter.id)) {
      warnings.push(`${path.relative(projectRoot, chapter.file)} has no machine-readable scene records`);
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
  const existingNumbers = new Set(project.chapters.map((chapter) => chapter.number));
  const hasScheduledChapter = (id) => {
    if (chapters.has(id)) {
      return true;
    }
    const match = /^chapter-(\d+)$/.exec(id);
    const number = match ? Number.parseInt(match[1], 10) : 0;
    return number > 0 && !existingNumbers.has(number);
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
        errors.push(`${label} relationship character ${target} must be kebab-case`);
        continue;
      }
      if (!characters.has(target)) {
        errors.push(`${label} references missing character ${target}`);
      } else {
        const backlinks = [];
        for (const entry of characters.get(target).relationships) {
          if (entry && typeof entry === "object" && !Array.isArray(entry) && entry.character === character.id) {
            backlinks.push(entry);
          }
        }
        if (backlinks.length === 0) {
          errors.push(`${label} relationship to ${target} is missing backlink`);
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
            warnings.push(`${label} relationship ${relationship.type} to ${target} has backlink ${types.join(", ")}, a pairing from before story-skills 0.10.0; change the backlink to ${expectedTypes.join(" or ")}`);
          } else if (!matched) {
            errors.push(`${label} relationship ${relationship.type} to ${target} expects backlink type ${expectedTypes.join(" or ")}, got ${types.join(", ") || "none"}`);
          }
        }
      }
    }

    for (const locationId of character.locations) {
      checkIdReference(errors, label, locationId, "location", hasLocation);
      if (typeof locationId === "string" && locationId !== "" && locationId === kebabCase(locationId) && locations.has(locationId) && !locations.get(locationId).notableCharacters.includes(character.id)) {
        errors.push(`${label} location ${locationId} is missing notable-character backlink`);
      }
    }

    if (character.diedIn) {
      checkIdReference(errors, label, character.diedIn, "chapter", hasChapter);
    }
  }

  for (const location of project.locations) {
    const label = relative(project, location.file);
    for (const route of location.routes) {
      if (!route || typeof route !== "object" || Array.isArray(route) || typeof route.to !== "string" || route.to === "") {
        continue;
      }
      if (route.to === location.id) {
        errors.push(`${label} route points at itself`);
        continue;
      }
      checkIdReference(errors, `${label} route`, route.to, "location", hasLocation);
    }
    for (const characterId of location.notableCharacters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
      if (typeof characterId === "string" && characterId !== "" && characterId === kebabCase(characterId) && characters.has(characterId) && !characters.get(characterId).locations.includes(location.id)) {
        errors.push(`${label} notable character ${characterId} is missing location backlink`);
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
        errors.push(`${label} references POV character ${povText} which must be kebab-case`);
      } else if (!characters.has(chapter.pov)) {
        errors.push(`${label} references missing POV character ${chapter.pov}`);
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
        errors.push(`${label} references owner ${ownerText} which must be kebab-case`);
      } else if (!characters.has(artifact.owner) && !factions.has(artifact.owner)) {
        errors.push(`${label} references missing owner ${artifact.owner}`);
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
        errors.push(`${label} references chapter ${chapterText} which must be kebab-case`);
      } else if (!chapters.has(scene.chapter)) {
        errors.push(`${label} references missing chapter ${scene.chapter}`);
      }
    }
    if (scene.pov) {
      const povText = String(scene.pov);
      if (povText !== kebabCase(povText)) {
        errors.push(`${label} references POV character ${povText} which must be kebab-case`);
      } else if (!characters.has(scene.pov)) {
        errors.push(`${label} references missing POV character ${scene.pov}`);
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

  validateTimelineAndArcBodyRefs(project, chapters, errors);
  validateSeriesLinks(project.root, project.story.data, errors);

  return { ok: errors.length === 0, errors, warnings };
}

function validateTimelineAndArcBodyRefs(project, chapters, errors) {
  const chapterIds = new Set(chapters.keys());
  const timelinePath = path.join(project.root, "plot", "timeline.md");
  if (fs.existsSync(timelinePath)) {
    try {
      const raw = readTextFile(timelinePath);
      const body = parseFrontmatter(raw, timelinePath).body ?? raw;
      for (const token of extractChapterIdTokens(body)) {
        if (!chapterIds.has(token)) {
          errors.push(`${path.join("plot", "timeline.md")} references missing chapter ${token}`);
        }
      }
      for (const target of extractMarkdownLinkTargets(body)) {
        checkBodyLinkTarget(project, path.join("plot", "timeline.md"), target, errors);
      }
    } catch (error) {
      const message = `${path.join("plot", "timeline.md")}: ${error.message}`;
      if (!errors.includes(message)) {
        errors.push(message);
      }
    }
  }

  for (const arc of project.arcs) {
    const label = relative(project, arc.file);
    let body = '';
    try {
      body = readMarkdown(arc.file, project.root).body ?? '';
    } catch (error) {
      const message = label + ': ' + error.message;
      if (!errors.includes(message)) {
        errors.push(message);
      }
      continue;
    }
    for (const token of extractChapterIdTokens(body)) {
      if (!chapterIds.has(token)) {
        errors.push(`${label} references missing chapter ${token}`);
      }
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
  const base = path.basename(pathOnly);
  if (!base.endsWith(".md")) {
    return;
  }
  const id = base.slice(0, -3);
  if (!id || id === "_index" || id.includes("*")) {
    return;
  }
  if (id !== kebabCase(id)) {
    errors.push(`${label} links to ${cleaned} which must be kebab-case`);
    return;
  }
  const resolved = path.resolve(path.dirname(path.join(project.root, label)), pathOnly);
  if (!isPathInside(path.resolve(project.root), resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    errors.push(`${label} links to missing file ${cleaned}`);
    return;
  }
  // existsSync and statSync follow symlinks, so a link can pass the lexical
  // check above and still land outside the project.
  if (!isPathInside(fs.realpathSync(project.root), fs.realpathSync(resolved))) {
    errors.push(`${label} links to ${cleaned} which resolves outside the project`);
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
    errors.push(`${label} links to missing file ${cleaned}`);
  }
}

export function checkProjectContinuity(root) {
  return checkContinuity(scanProject(root));
}

// Returns knowledge-state entries for a character that the character knew at
// (or before) a chapter: entries without learned-in are pre-existing
// knowledge, the rest must be learned in a chapter numbered at or before the
// target. File order is preserved.
export function knowledgeAtChapter(root, characterId, atChapterId) {
  const project = scanProject(root);
  const characters = new Map(project.characters.map((character) => [character.id, character]));
  if (!characters.has(characterId)) {
    // A character whose file fails to parse exists; say why it cannot be read.
    const parseError = project.fileErrors.find((error) => error.startsWith(`${path.join("characters", `${characterId}.md`)}:`));
    throw new Error(parseError ?? `Unknown character ${characterId}`);
  }

  const chapterNumbers = new Map(project.chapters.map((chapter) => [chapter.id, chapter.number]));
  const atNumber = chapterNumbers.get(atChapterId);
  if (atNumber === undefined) {
    throw new Error(`Unknown chapter ${atChapterId}`);
  }

  let stateError = "";
  for (const error of project.fileErrors ?? []) {
    if (!stateError && String(error).startsWith(`${path.join("continuity", "state.md")}:`)) {
      stateError = error;
    }
  }
  if (stateError) {
    throw new Error(stateError);
  }

  const entries = [];
  const knowledge = project.continuity ? asArray(project.continuity.data["knowledge-state"]) : [];
  for (const entry of knowledge) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry) || entry.character !== characterId) {
      continue;
    }
    const learnedIn = entry["learned-in"] === undefined || entry["learned-in"] === null || entry["learned-in"] === ""
      ? ""
      : String(entry["learned-in"]);
    if (learnedIn === "") {
      entries.push({ knows: String(entry.knows ?? ""), learnedIn: "" });
      continue;
    }
    const learnedNumber = chapterNumbers.get(learnedIn);
    if (learnedNumber !== undefined && learnedNumber <= atNumber) {
      entries.push({ knows: String(entry.knows ?? ""), learnedIn });
    }
  }
  return entries;
}

export function seriesReport(root) {
  const projectRoot = path.resolve(root);
  requireStoryFile(projectRoot);
  // Linked books resolve relative to the real folder, so a book reached
  // through a symlinked path finds its siblings.
  return buildSeries(fs.realpathSync(projectRoot), scanProject);
}

export function projectReport(root, options = {}) {
  const project = scanProject(root);
  const validation = validateProjectOf(project);
  const links = validateLinksOf(project);
  const continuity = checkContinuity(project);
  const totalWords = project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);

  return {
    root: project.root,
    title: project.title,
    storyId: project.storyId,
    schemaVersion: project.story.data["schema-version"],
    series: project.story.data.series,
    bookNumber: project.story.data["book-number"],
    genre: project.story.data.genre,
    subGenre: project.story.data["sub-genre"],
    form: typeof project.story.data.form === "string" ? project.story.data.form : "",
    status: project.story.data.status,
    pov: project.story.data.pov,
    tense: project.story.data.tense,
    targetWords: Number.isInteger(project.story.data["target-words"]) ? project.story.data["target-words"] : null,
    counts: {
      characters: project.characters.length,
      locations: project.locations.length,
      systems: project.systems.length,
      factions: project.factions.length,
      artifacts: project.artifacts.length,
      arcs: project.arcs.length,
      chapters: project.chapters.length,
      scenes: project.scenes.length,
      questions: project.questions.length,
      promises: project.promises.length,
      clues: project.clues.length,
      glossaryTerms: project.glossaryTerms.length,
      research: project.research.length,
      words: totalWords
    },
    chapters: project.chapters.map((chapter) => ({
      number: chapter.number,
      title: chapter.title,
      status: chapter.status,
      pov: chapter.pov,
      wordCount: chapter.wordCount
    })),
    arcs: project.arcs.map((arc) => ({
      name: arc.name,
      type: arc.type,
      status: arc.status,
      characters: arc.characters.length
    })),
    validation,
    links,
    continuity,
    actions: buildProjectActions(project, validation, links, continuity, options.displayPath)
  };
}

export function formatProjectReport(report, options = {}) {
  const lines = [
    `# ${report.title}`,
    "",
    `Story ID: ${report.storyId}`,
    `Schema version: ${report.schemaVersion ?? "unset"}`,
    ...(report.series === undefined ? [] : [`Series: ${report.series}${report.bookNumber === undefined ? "" : ` (book ${report.bookNumber})`}`]),
    `Status: ${report.status ?? "unset"}`,
    `Genre: ${[report.genre, report.subGenre].filter(Boolean).join(" / ") || "unset"}`,
    ...(report.form ? [`Form: ${report.form}`] : []),
    `POV/Tense: ${report.pov ?? "unset"} / ${report.tense ?? "unset"}`,
    "",
    "Inventory:",
    `- Characters: ${report.counts.characters}`,
    `- Locations: ${report.counts.locations}`,
    `- Systems: ${report.counts.systems}`,
    `- Factions: ${report.counts.factions}`,
    `- Artifacts: ${report.counts.artifacts}`,
    `- Arcs: ${report.counts.arcs}`,
    `- Chapters: ${report.counts.chapters}`,
    `- Scenes: ${report.counts.scenes}`,
    `- Questions: ${report.counts.questions}`,
    `- Promises: ${report.counts.promises}`,
    `- Clues: ${report.counts.clues}`,
    `- Glossary terms: ${report.counts.glossaryTerms}`,
    ...(report.counts.research === 0 ? [] : [`- Research notes: ${report.counts.research}`]),
    `- Total words: ${report.counts.words}`,
    ...(report.targetWords > 0 ? [`- Target words: ${report.targetWords} (${Math.round((report.counts.words * 100) / report.targetWords)}%)`] : []),
    "",
    "Chapters:"
  ];

  if (report.chapters.length === 0) {
    lines.push("- None");
  } else {
    for (const chapter of report.chapters) {
      lines.push(`- ${chapter.number}. ${chapter.title} (${chapter.status}, ${chapter.wordCount} words, POV: ${chapter.pov || "unspecified"})`);
    }
  }

  lines.push("", "Arcs:");
  if (report.arcs.length === 0) {
    lines.push("- None");
  } else {
    for (const arc of report.arcs) {
      lines.push(`- ${arc.name} (${arc.type}, ${arc.status}, ${arc.characters} characters)`);
    }
  }

  lines.push(
    "",
    "Checks:",
    `- Validate: ${formatCheck(report.validation)}`,
    `- Links: ${formatCheck(report.links)}`,
    `- Continuity: ${formatCheck(report.continuity)}`
  );

  if (options.actionable) {
    lines.push("", "Next Actions:");
    appendActionLines(lines, report.actions);
  }

  return `${lines.join("\n")}\n`;
}

export function projectActions(root, options = {}) {
  const project = scanProject(root);
  const validation = validateProjectOf(project);
  const links = validateLinksOf(project);
  const continuity = checkContinuity(project);
  return {
    root: project.root,
    title: project.title,
    storyId: project.storyId,
    actions: buildProjectActions(project, validation, links, continuity, options.displayPath),
    validation,
    links,
    continuity
  };
}

export function formatActionReport(report) {
  const lines = [
    `# Next Writing Actions: ${report.title}`,
    "",
    `Checks: validate ${formatCheck(report.validation)}, links ${formatCheck(report.links)}, continuity ${formatCheck(report.continuity)}`,
    "",
    "Actions:"
  ];
  appendActionLines(lines, report.actions);
  return `${lines.join("\n")}\n`;
}

export function formatDoctorReport(report) {
  const lines = [
    `# Story Doctor: ${report.title}`,
    "",
    `Root: ${report.root}`,
    "",
    "Checks:",
    `- Validate: ${formatCheck(report.validation)}`,
    `- Links: ${formatCheck(report.links)}`,
    `- Continuity: ${formatCheck(report.continuity)}`,
    "",
    "Actions:"
  ];
  appendActionLines(lines, report.actions);
  return `${lines.join("\n")}\n`;
}

export function reindexProject(root) {
  const project = scanProject(root);
  assertProjectParses(project, "reindex");
  const changed = [];
  const at = (...parts) => path.join(project.root, ...parts);
  const existingPlot = readRegistrySource(at("plot", "_index.md"), project.root);
  let plotStructure = "three-act";
  if (fs.existsSync(at("plot", "_index.md"))) {
    plotStructure = parseFrontmatter(existingPlot, "plot/_index.md").data.structure ?? "three-act";
  }

  writeRegistry(at("characters", "_index.md"), (existing) => characterIndex(
    project.storyId,
    project.characters,
    extractSection(existing, "Relationship Map"),
    extractSection(existing, "Family Trees")
  ), changed, project.root);
  writeRegistry(at("worldbuilding", "_index.md"), (existing) => worldIndex(
    project.storyId,
    project.locations,
    project.systems,
    project.factions,
    project.artifacts,
    extractSection(existing, "World Overview")
  ), changed, project.root);
  writeRegistry(at("plot", "_index.md"), (existing) => plotIndex(
    project.storyId,
    plotStructure,
    project.arcs,
    extractSection(existing, "Story Structure"),
    extractSection(existing, "Theme Tracking")
  ), changed, project.root);
  writeRegistry(at("chapters", "_index.md"), () => chapterIndex(project.storyId, project.chapters), changed, project.root);
  writeRegistry(at("scenes", "_index.md"), () => sceneIndex(project.storyId, project.scenes), changed, project.root);
  writeRegistry(at("continuity", "questions", "_index.md"), () => questionIndex(project.storyId, project.questions), changed, project.root);
  writeRegistry(at("continuity", "promises", "_index.md"), () => promiseIndex(project.storyId, project.promises), changed, project.root);
  writeRegistry(at("continuity", "clues", "_index.md"), () => clueIndex(project.storyId, project.clues), changed, project.root);
  writeRegistry(at("glossary", "_index.md"), () => glossaryIndex(project.storyId, project.glossaryTerms), changed, project.root);
  if (fs.existsSync(at(MATTER_DIR))) {
    writeRegistry(at(MATTER_DIR, "_index.md"), () => matterIndex(project.storyId, project.matter), changed, project.root);
  }
  if (fs.existsSync(at(RESEARCH_DIR))) {
    writeRegistry(at(RESEARCH_DIR, "_index.md"), () => researchIndex(project.storyId, project.research), changed, project.root);
  }
  refreshStoryField(at("plot", "timeline.md"), project.storyId, changed, project.root);
  refreshStoryField(at("continuity", "state.md"), project.storyId, changed, project.root);

  return { changed };
}

// Commands that rewrite registries or aggregate chapters would silently drop
// a file that fails to parse, so they stop and name it instead.
function assertProjectParses(project, action) {
  // The style sheet, progress log, and exemptions never feed registries or
  // chapters.
  const ignored = [STYLE_SHEET_FILE, PROGRESS_FILE, path.join("continuity", "exemptions.md")];
  const errors = (project.fileErrors ?? []).filter((error) => !ignored.some((file) => error.startsWith(`${file}:`)));
  if (errors.length > 0) {
    throw new Error(`Cannot ${action}: fix ${errors.length === 1 ? "this file first (story validate reports it)" : "these files first (story validate reports them)"}:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function readRegistrySource(filePath, root) {
  return safeRead(filePath, root).replace(/\r\n/g, "\n");
}

// Regenerates a registry from its entity files. `build` receives the current
// registry (LF line endings) to carry over its hand-written sections; any
// other `## ` section the generator does not produce is appended unchanged,
// and a CRLF registry stays CRLF.
function writeRegistry(filePath, build, changed, root) {
  const raw = safeRead(filePath, root);
  const existing = raw.replace(/\r\n/g, "\n");
  const generated = build(existing);
  const custom = customSections(existing, generated);
  const contents = custom.length === 0 ? generated : `${generated.replace(/\n*$/, "\n")}\n${custom.join("\n\n")}\n`;
  writeChanged(filePath, raw.includes("\r\n") ? contents.replace(/\n/g, "\r\n") : contents, changed, root);
}

function customSections(existing, generated) {
  // Only a generated heading that carries a value (`## Total Word Count: 993`)
  // is matched without it; every other heading must match exactly, so a
  // hand-written `## Registry: 2` stays custom. Each generated heading claims
  // one existing section, and stale copies of a value heading (left by
  // 0.10.0) are dropped.
  const valuePattern = /:\s*\d[\d,]*$/;
  const valueHeadings = new Set();
  const unclaimed = new Map();
  for (const heading of markdownHeadings(generated).filter((entry) => entry.level === 2)) {
    const hasValue = valuePattern.test(heading.text);
    const key = hasValue ? heading.text.replace(valuePattern, "") : heading.text;
    if (hasValue) {
      valueHeadings.add(key);
    }
    unclaimed.set(key, (unclaimed.get(key) ?? 0) + 1);
  }
  const body = existing.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = body.split("\n");
  // A section runs to the next heading of level 1 or 2 outside a code
  // fence, so a section above the title never swallows the `# Title` line.
  const headings = markdownHeadings(body);
  const sections = [];
  for (const [index, heading] of headings.entries()) {
    if (heading.level !== 2) {
      continue;
    }
    const stripped = heading.text.replace(valuePattern, "");
    const key = valueHeadings.has(stripped) ? stripped : heading.text;
    const claimed = (unclaimed.get(key) ?? 0) > 0;
    if (claimed) {
      unclaimed.set(key, unclaimed.get(key) - 1);
    }
    const stale = key !== heading.text;
    if (!claimed && !stale) {
      const end = index + 1 < headings.length ? headings[index + 1].line : lines.length;
      sections.push(lines.slice(heading.line, end).join("\n").trim());
    }
  }
  return sections;
}

// Level 1 and 2 ATX headings with their line numbers, skipping closed
// fenced code (see fencedLineIndexes).
function markdownHeadings(markdown) {
  const lines = markdown.split("\n");
  const fenced = fencedLineIndexes(lines);
  const headings = [];
  for (const [line, text] of lines.entries()) {
    const heading = fenced.has(line) ? null : /^(#{1,2}) +(.+?)[ \t]*$/.exec(text);
    if (heading) {
      headings.push({ level: heading[1].length, text: heading[2], line });
    }
  }
  return headings;
}

function refreshStoryField(filePath, storyId, changed, root) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  let raw;
  try {
    raw = readTextFile(filePath);
  } catch {
    return;
  }
  let parsed;
  try {
    parsed = parseFrontmatter(raw, filePath);
  } catch {
    return;
  }
  if (parsed.data.story === storyId) {
    return;
  }
  writeChanged(filePath, replaceFrontmatter(raw, {
    ...parsed.data,
    story: storyId
  }), changed, root);
}

export function computeWordCounts(root, options = {}) {
  const project = scanProject(root);
  assertProjectParses(project, "count words");
  const chapters = [];

  for (const chapter of project.chapters) {
    chapters.push({
      number: chapter.number,
      title: chapter.title,
      file: path.relative(project.root, chapter.file),
      wordCount: chapter.wordCount
    });

    if (options.write && chapter.declaredWordCount !== chapter.wordCount) {
      const markdown = readMarkdown(chapter.file, project.root);
      writeFile(chapter.file, replaceFrontmatter(markdown.rawMarkdown, {
        ...markdown.data,
        "word-count": chapter.wordCount
      }), { root: project.root });
    }
  }

  if (options.write) {
    reindexProject(project.root);
  }

  return {
    chapters,
    total: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  };
}

// Compares the current chapters with an earlier draft: a git ref (read with
// git show; nothing is written to the repository) or another copy of the
// project on disk.
export function compareProject(root, options = {}) {
  const hasRef = typeof options.ref === "string" && options.ref !== "";
  const hasAgainst = typeof options.against === "string" && options.against !== "";
  if (hasRef === hasAgainst) {
    throw new Error("compare needs exactly one of --ref <git-ref> or --against <project-path>");
  }
  const project = scanProject(root);
  const current = project.chapters.map((chapter) => comparableChapter(chapter.id, readMarkdown(chapter.file, project.root)));
  let previous;
  let label;
  if (hasRef) {
    previous = chaptersAtGitRef(project.root, options.ref);
    label = `git ref ${options.ref}`;
  } else {
    const otherRoot = path.resolve(options.cwd ?? process.cwd(), options.against);
    const other = scanProject(otherRoot);
    if (other.fileErrors.length > 0) {
      throw new Error(`Cannot read ${otherRoot}: ${other.fileErrors[0]}`);
    }
    previous = other.chapters.map((chapter) => comparableChapter(chapter.id, readMarkdown(chapter.file, other.root)));
    label = otherRoot;
  }
  return {
    ok: project.fileErrors.length === 0,
    errors: [...project.fileErrors],
    warnings: [],
    label,
    ...compareChapters(previous, current)
  };
}

function comparableChapter(id, markdown) {
  const prose = chapterProse(markdown.body);
  return {
    id,
    title: String(markdown.data.title ?? titleCaseSlug(id)),
    words: wordCount(prose),
    paragraphs: proseParagraphs(prose)
  };
}

// A ref may name a branch, tag, or commit with ~ and ^ suffixes, but never
// starts with "-", so it cannot be read as a git option.
const GIT_REF_PATTERN = /^[A-Za-z0-9._/@{}~^][A-Za-z0-9._/@{}~^-]*$/;

function chaptersAtGitRef(root, ref) {
  if (!GIT_REF_PATTERN.test(ref)) {
    throw new Error(`Unsupported git ref: ${ref}`);
  }
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  let prefix;
  try {
    prefix = git(["rev-parse", "--show-prefix"]).trim();
  } catch {
    throw new Error("compare --ref needs the project inside a git repository");
  }
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    throw new Error(`Unknown git ref: ${ref}`);
  }
  // ls-tree paths are relative to the working directory (-C root); git show
  // paths are relative to the repository root, hence the prefix there.
  const names = git(["ls-tree", "--name-only", ref, "--", "chapters/"])
    .split("\n")
    .map((name) => path.posix.basename(name.trim()))
    .filter((name) => CHAPTER_FILENAME_PATTERN.test(name))
    .sort();
  return names.map((name) => {
    const id = path.basename(name, ".md");
    const raw = git(["show", `${ref}:${prefix}chapters/${name}`]);
    try {
      return comparableChapter(id, parseFrontmatter(raw, name));
    } catch {
      // An old draft may predate frontmatter; compare its prose anyway.
      return comparableChapter(id, { data: {}, body: raw });
    }
  });
}

// Word-count progress against story.md target-words and deadline, chapter
// target-words, and the progress.md session log. With `log`, records the
// day's total in progress.md first (replacing an entry for the same date).
export function projectProgress(root, options = {}) {
  const today = options.date === undefined ? localDate() : String(options.date);
  const dateError = storyDateError(today);
  if (dateError !== "" || today.trim() === "") {
    throw new Error(`progress --date ${dateError || "must be a YYYY-MM-DD date"}`);
  }
  let project = scanProject(root);
  const words = project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  let logged = null;
  if (options.log) {
    // A chapter that fails to parse would be left out of the logged total.
    assertProjectParses(project, "log progress");
    if (project.fileErrors.some((error) => error.startsWith(`${PROGRESS_FILE}:`))) {
      throw new Error(`Cannot log progress: ${PROGRESS_FILE} does not parse`);
    }
    // Rewriting the log keeps only well-formed sessions, so refuse to log
    // over entries that would be dropped; validate names each problem.
    const logErrors = [];
    validateProgressLog(project, logErrors);
    if (logErrors.length > 0) {
      throw new Error(`Cannot log progress until ${PROGRESS_FILE} is fixed: ${logErrors.join("; ")}`);
    }
    const filePath = path.join(project.root, PROGRESS_FILE);
    const existing = project.progressLog;
    const sessions = withSession(cleanSessions(existing?.data.sessions), today, words);
    const contents = existing === null
      ? progressLogFile(sessions)
      : replaceFrontmatter(existing.rawMarkdown, { ...existing.data, sessions });
    writeFile(filePath, contents, { root: project.root });
    logged = { file: filePath, date: today, words };
    project = scanProject(root);
  }
  const data = project.story.data;
  return {
    ok: project.fileErrors.length === 0,
    errors: [...project.fileErrors],
    warnings: [],
    logged,
    ...computeProgress({
      words,
      target: Number.isInteger(data["target-words"]) && data["target-words"] > 0 ? data["target-words"] : null,
      deadline: typeof data.deadline === "string" ? data.deadline : null,
      today,
      chapters: project.chapters.map((chapter) => ({ id: chapter.id, words: chapter.wordCount, target: chapter.targetWords })),
      sessions: cleanSessions(project.progressLog?.data.sessions)
    })
  };
}

function progressLogFile(sessions) {
  return `${stringifyFrontmatter({ type: "progress-log", sessions })}# Progress Log

\`story progress --log\` records the manuscript word count for the day in the frontmatter above. Set \`target-words\` and \`deadline\` in \`story.md\`, and \`target-words\` on chapters, to measure against them.
`;
}

// Read-only chronology, POV balance, and character presence. Parse errors are
// reported like the other checks; the views never add findings of their own.
export function storyTimeline(root) {
  const project = scanProject(root);
  return {
    ok: project.fileErrors.length === 0,
    errors: [...project.fileErrors],
    warnings: [],
    totalChapters: project.chapters.length,
    ...buildTimeline(project)
  };
}

// Read-only fair-play grid over the clue registry. Findings are advisory.
export function clueReport(root) {
  const project = scanProject(root);
  const matrix = buildClueMatrix(project);
  return { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], ...matrix };
}

// Mermaid source for one diagram kind, printed or written to --out.
export function diagramProject(root, options = {}) {
  const project = scanProject(root);
  const text = buildDiagram(project, options.kind);
  const result = { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], warnings: [], text };
  // A diagram drawn from a partly unreadable project would silently drop
  // entities, so nothing is written until the scan is clean.
  if (options.out === undefined || !result.ok) {
    return result;
  }
  const output = resolveOutputPath(project, options.out, "");
  writeFile(output.outFile, text, output.writeOptions);
  return { ...result, outFile: output.outFile };
}

// Reads, and with init/start/done updates, story.md revision-passes. Only
// the revision-passes entry is rewritten; the rest of story.md is kept.
export function projectPasses(root, change = {}) {
  const project = scanProject(root);
  const storyPath = path.join(project.root, "story.md");
  const passes = readPasses(project.story.data);
  const wantsChange = Boolean(change.init) || change.start !== undefined || change.done !== undefined;
  if (!wantsChange) {
    return { passes, changed: false };
  }
  if (project.fileErrors.some((error) => error.startsWith("story.md"))) {
    throw new Error("story.md cannot be parsed; fix it before recording revision passes");
  }
  const passErrors = [];
  validatePasses(project.story.data, "story.md", passErrors);
  if (passErrors.length > 0) {
    throw new Error(`Fix revision-passes in story.md before changing it: ${passErrors.join("; ")}`);
  }
  const current = asArray(project.story.data["revision-passes"]);
  const next = updatePasses(current, change);
  const notes = addedPassNotes(readPasses({ "revision-passes": current }), readPasses({ "revision-passes": next }));
  const raw = safeRead(storyPath, project.root);
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  if (changed) {
    writeFile(storyPath, replaceFrontmatter(raw, { ...parseFrontmatter(raw, storyPath).data, "revision-passes": next }), { root: project.root });
  }
  return { passes: readPasses({ "revision-passes": next }), changed, notes };
}

// Collision check for candidate names against every name in the bible.
export function namesReport(root, candidates) {
  const list = asArray(candidates).map((name) => String(name).trim()).filter(Boolean);
  if (list.length === 0) {
    throw new Error("Usage: story names <name...> [--path <project>]");
  }
  const project = scanProject(root);
  const result = checkNames(list, existingNames(project));
  const errors = [...project.fileErrors, ...result.errors];
  return { ok: errors.length === 0, errors, warnings: result.warnings, results: result.results };
}

// Dialogue fingerprints per character from attributed speech. Advisory.
export function voicesReport(root) {
  const project = scanProject(root);
  const chapters = project.chapters.map((chapter) => ({
    id: chapter.id,
    paragraphs: proseParagraphs(chapterProse(readMarkdown(chapter.file, project.root).body, " "))
  }));
  return { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], ...buildVoices(project, chapters) };
}

// Pacing dashboard over chapters and scene records. Findings are advisory.
export function pacingReport(root) {
  const project = scanProject(root);
  return { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], ...buildPacing(project) };
}

// Advisory prose lint: counts per chapter plus manuscript-wide repeats.
// Findings are warnings, never errors, so the command always exits 0 on a
// readable project.
export function proseReport(root) {
  const project = scanProject(root);
  const errors = [...project.fileErrors];
  const warnings = [];
  const rules = proseRules(project.styleSheet?.data, project.characters.map((character) => character.name));
  const chapters = [];
  for (const chapter of project.chapters) {
    // Chapters that failed to parse are already in fileErrors, not here.
    const label = relative(project, chapter.file);
    const analysis = analyzeChapter(chapterProse(readMarkdown(chapter.file, project.root).body, " "), rules);
    chapters.push({ file: label, title: chapter.title, analysis });
    warnings.push(...chapterFindings(label, analysis));
  }
  const phrases = repeatedPhrases(chapters.map((chapter) => chapter.analysis));
  const names = similarNames(project.characters);
  for (const [left, right] of names) {
    warnings.push(`characters ${left.id} and ${right.id} have similar first names (${left.name} / ${right.name})`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    styleSheet: project.styleSheet !== null,
    words: chapters.reduce((sum, chapter) => sum + chapter.analysis.words, 0),
    chapters,
    phrases,
    similarNames: names
  };
}

export function exportManuscript(root, options = {}) {
  const project = scanProject(root);
  const manuscript = manuscriptParts(project, options.generatedBy === undefined ? "export" : "build");
  const output = resolveOutputPath(project, options.out, path.join("dist", "manuscript.md"), options.enforceRoot);
  const generatedBy = options.generatedBy ?? "story export";
  const lines = [`# ${manuscript.title}`, "", `<!-- Generated by ${generatedBy}. -->`, ""];
  const pushMatter = (entry) => {
    if (entry.heading) {
      lines.push(`# ${entry.title}`, "");
    }
    lines.push(entry.body, "");
  };

  manuscript.front.forEach(pushMatter);
  for (const chapter of manuscript.chapters) {
    lines.push(`# ${chapterHeading(chapter.number, chapter.title)}`, "", chapter.body, "");
  }
  manuscript.back.forEach(pushMatter);

  writeFile(output.outFile, `${lines.join("\n").trimEnd()}\n`, output.writeOptions);
  return { outFile: output.outFile, chapters: project.chapters.length };
}

export function buildBook(root, options = {}) {
  const format = normalizeBuildFormat(options.format ?? "markdown");
  if (options.trim !== undefined && format !== "print") {
    throw new Error("--trim applies only to --format print");
  }
  if (options.shunn && format !== "docx") {
    throw new Error("--shunn applies only to --format docx (use --format shunn for a Shunn markdown manuscript)");
  }
  const project = scanProject(root);
  const extension = BUILD_EXTENSIONS[format];
  const output = resolveOutputPath(project, options.out, path.join("dist", `${fileStem(project.storyId)}.${extension}`));

  if (format === "markdown") {
    const result = exportManuscript(project.root, {
      out: output.outFile,
      generatedBy: "story build",
      enforceRoot: output.enforceRoot
    });
    return { ...result, format };
  }

  const manuscript = manuscriptParts(project);
  if (format === "metadata") {
    const words = manuscript.chapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0);
    writeFile(output.outFile, metadataSheet({
      title: manuscript.title,
      data: project.story.data,
      meta: manuscript.meta,
      words,
      pages: { "5.5x8.5": estimatePages(words, "5.5x8.5"), "6x9": estimatePages(words, "6x9") },
      hasCopyrightPage: manuscript.front.concat(manuscript.back).some((entry) => entry.copyright),
      pendingPermissions: project.matter.filter((entry) => entry.permission === "pending").map((entry) => entry.id)
    }), output.writeOptions);
  } else if (format === "narration") {
    writeFile(output.outFile, narrationScript(manuscript, pronunciationGuide(project)), output.writeOptions);
  } else if (format === "html" || format === "print") {
    const book = htmlBook(manuscript);
    const text = format === "html" ? reviewHtml(book) : printHtml(book, options.trim === undefined ? DEFAULT_TRIM : String(options.trim));
    writeFile(output.outFile, text, output.writeOptions);
  } else if (format === "shunn") {
    writeShunnMarkdown(output.outFile, manuscript, shunnMeta(project), output.writeOptions);
  } else if (format === "epub") {
    const cover = project.story.data.cover === undefined ? null : coverImage(project);
    writeEpub(output.outFile, project.storyId, { ...manuscript, cover }, output.writeOptions);
  } else if (options.shunn) {
    writeShunnDocx(output.outFile, manuscript, shunnMeta(project), output.writeOptions);
  } else {
    writeDocx(output.outFile, manuscript, output.writeOptions);
  }

  return { outFile: output.outFile, chapters: manuscript.chapters.length, format };
}

// Deterministic synopsis. Budgets are 500 words (1 page) and 1500 (3 pages).
// Level 0 keeps setup (2 sentences), rising action (2), and a Because line
// of climax plus resolution. Level 1 drops rising action. Level 2 also drops
// resolution. The last resort truncates with the same word rules as wordCount.
export function synopsisBook(root, options = {}) {
  const pages = options.pages === undefined ? 1 : Number(options.pages);
  if (pages !== 1 && pages !== 3) {
    throw new Error(`Unsupported synopsis length: ${options.pages}. Supported pages: 1, 3`);
  }

  const project = scanProject(root);
  assertProjectParses(project, "build a synopsis");
  const budget = pages === 1 ? 500 : 1500;
  const title = project.title;
  const premise = synopsisPremise(project);
  // Three pages carry more of each arc than one, so the longer scaffold has
  // more to work from.
  const detail = pages === 1 ? { setup: 2, rising: 2, climax: 1, resolution: 1 } : { setup: 4, rising: 8, climax: 2, resolution: 2 };

  let text = renderSynopsis(title, premise, project, 0, detail);
  if (wordCount(text) > budget) {
    text = renderSynopsis(title, premise, project, 1, detail);
  }
  if (wordCount(text) > budget) {
    text = renderSynopsis(title, premise, project, 2, detail);
  }
  if (wordCount(text) > budget) {
    text = truncateWords(text, budget);
  }

  if (options.out === undefined) {
    return { text };
  }
  const output = resolveOutputPath(project, options.out, path.join("dist", `${fileStem(project.storyId)}.synopsis.md`));
  writeFile(output.outFile, text, output.writeOptions);
  return { text, outFile: output.outFile };
}

// Starter text that init, import, and add arc write. A synopsis must never
// quote it as if it were the story.
const SCAFFOLD_SENTENCES = new Set([
  "Add a 2-3 sentence synopsis here.",
  "Replace with a 2-3 sentence synopsis.",
  "Initial state and inciting pressure.",
  "First escalation.",
  "Second escalation.",
  "Reversal or complication.",
  "Decision point or highest tension.",
  "What changes because of this arc."
]);

function synopsisPremise(project) {
  const sentences = synopsisSentences(extractSection(project.story.body, "Synopsis"))
    .filter((sentence) => !/^Imported from .+\.$/.test(sentence));
  return sentences.length > 0 ? sentences[0] : "No logline recorded.";
}

// Sentences of a synopsis section: list markers are dropped and each list
// item ends as a sentence, and scaffold text is skipped.
function synopsisSentences(section) {
  const text = String(section)
    .split(/\r?\n/)
    .map((line) => {
      const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (!item) {
        return line;
      }
      const content = item[1].trim();
      return /[.!?]$/.test(content) ? content : `${content}.`;
    })
    .join("\n");
  return splitSentences(text).filter((sentence) => !SCAFFOLD_SENTENCES.has(sentence));
}

// Words that end in a full stop without ending the sentence: titles and
// initials (Dr. Hale, J. Smith, the U.S. Navy) never end one. Words that
// often close a sentence too (etc., No., a.m.) end it unless the next word
// starts in lower case or with a digit (No. 5, 9 a.m. sharp).
const TITLE_ABBREVIATIONS = /(?:^|[\s(“"‘'])(?:Dr|Mr|Mrs|Ms|St|Mt|Jr|Sr|Prof|Capt|Gen|Col|Lt|Sgt|Rev|Fr|e\.g|i\.e|(?:[A-Za-z]\.)*[A-Za-z])$/;
const CONTEXT_ABBREVIATIONS = /(?:^|[\s(“"‘'])(?:No|vs|etc|a\.m|p\.m)$/;
// A sentence ends at . ! ? or … plus any closing quotes or brackets, before
// a space or the end of the text.
const SENTENCE_END = /[.!?…]["”’')\]]*(?= |$)/g;

function splitSentences(text) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (normalized === "") {
    return [];
  }
  const sentences = [];
  let start = 0;
  for (const match of normalized.matchAll(SENTENCE_END)) {
    const before = normalized.slice(start, match.index);
    const end = match.index + match[0].length;
    const nextWord = normalized.slice(end + 1, end + 2);
    const continues = /^[\p{Ll}\p{N}]/u.test(nextWord);
    const abbreviation = CONTEXT_ABBREVIATIONS.test(before) ? continues : TITLE_ABBREVIATIONS.test(before);
    if (match[0] === "." && abbreviation) {
      continue;
    }
    sentences.push(normalized.slice(start, end).trim());
    start = end;
  }
  const tail = normalized.slice(start).trim();
  if (tail !== "") {
    sentences.push(/[.!?…]["”’')\]]*$/.test(tail) ? tail : `${tail}.`);
  }
  return sentences.filter((sentence) => sentence !== "");
}

function takeSentences(text, count) {
  return synopsisSentences(text).slice(0, count);
}

// The logline is the first sentence of story.md's ## Synopsis; the skills
// keep the controlling idea in the `premise` field, so the line is labelled
// as the logline.
function renderSynopsis(title, premise, project, level, detail) {
  const lines = [`# Synopsis: ${title}`, "", `Logline: ${premise}`, ""];
  for (const arc of project.arcs) {
    const markdown = readMarkdown(arc.file, project.root);
    lines.push(`## ${arc.name}`, "");
    const setup = takeSentences(extractSection(markdown.body, "Setup"), detail.setup);
    if (setup.length > 0) {
      lines.push(setup.join(" "), "");
    }
    if (level === 0) {
      const rising = takeSentences(extractSection(markdown.body, "Rising Action"), detail.rising);
      if (rising.length > 0) {
        lines.push(rising.join(" "), "");
      }
    }
    const climax = takeSentences(extractSection(markdown.body, "Climax"), detail.climax);
    const resolution = level < 2 ? takeSentences(extractSection(markdown.body, "Resolution"), detail.resolution) : [];
    const chain = climax.concat(resolution);
    if (chain.length > 0) {
      lines.push(`Because ${lowercaseCommonStart(chain.join(" "))}`, "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// Sentence openers that are not names, so "Because She chooses" reads
// "Because she chooses"; a name keeps its capital.
const COMMON_OPENERS = new Set([
  "a", "an", "the", "he", "she", "they", "it", "we", "you", "his", "her", "their", "its", "our", "my", "your",
  "this", "that", "these", "those", "when", "after", "before", "once", "in", "at", "on", "with", "without", "by",
  "as", "if", "even", "every", "all", "both", "no", "none", "only", "then", "there", "here", "one", "each"
]);

function lowercaseCommonStart(text) {
  // A whole word only, so "A.J." and "He-Man" keep their capitals.
  const first = /^[A-Za-z]+(?=\s)/.exec(text)?.[0] ?? "";
  return COMMON_OPENERS.has(first.toLowerCase()) ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
}

// Cuts the synopsis at the word budget line by line, so headings and
// paragraph breaks survive and only the last paragraph is cut short.
function truncateWords(text, budget) {
  const kept = [];
  let used = 0;
  for (const line of text.trimEnd().split("\n")) {
    const words = wordCount(line);
    if (used + words <= budget) {
      kept.push(line);
      used += words;
      continue;
    }
    const tokens = [];
    for (const token of line.split(/\s+/).filter((part) => part !== "")) {
      const tokenWords = wordCount(token);
      if (used + tokenWords > budget) {
        break;
      }
      tokens.push(token);
      used += tokenWords;
    }
    if (tokens.length > 0 && !/^#/.test(line)) {
      kept.push(tokens.join(" "));
    }
    break;
  }
  // Never end on a blank line or a heading with nothing under it.
  return `${kept.join("\n").replace(/(?:\n(?:#[^\n]*)?[ \t]*)+$/, "")}…\n`;
}

function shunnMeta(project) {
  const data = project.story.data;
  return {
    title: project.title,
    // Like every other build, `authors` wins over `author`, so a co-written
    // book gets a full byline.
    author: publishingMeta(data).authors.join(" and "),
    contact: asArray(data.contact),
    words: project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  };
}

export function migrateProject(root) {
  const projectRoot = path.resolve(root);
  const storyPath = requireStoryFile(projectRoot);
  const story = readMarkdown(storyPath, projectRoot);
  assertProjectParses(scanProject(projectRoot), "migrate");
  const storyId = deriveStoryId(story.data.title, projectRoot);
  const changed = [];

  for (const directory of PROJECT_DIRECTORIES) {
    ensureDirectory(path.join(projectRoot, directory), changed, projectRoot);
  }

  ensureFile(path.join(projectRoot, "scenes", "_index.md"), sceneIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "state.md"), continuityState(storyId), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "questions", "_index.md"), questionIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "clues", "_index.md"), clueIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "glossary", "_index.md"), glossaryIndex(storyId, []), changed, projectRoot);

  if (story.data["schema-version"] !== STORY_SCHEMA_VERSION) {
    writeFile(storyPath, replaceFrontmatter(story.rawMarkdown, {
      ...story.data,
      "schema-version": STORY_SCHEMA_VERSION
    }), { root: projectRoot });
    changed.push(storyPath);
  }

  const reindexed = reindexProject(projectRoot);
  return { root: projectRoot, changed: changed.concat(reindexed.changed) };
}

const ENTITY_ENUM_OPTIONS = {
  character: [["role", CHARACTER_ROLES], ["status", CHARACTER_STATUSES]],
  faction: [["type", FACTION_TYPES], ["status", FACTION_STATUSES]],
  artifact: [["type", ARTIFACT_TYPES], ["status", ARTIFACT_STATUSES]],
  arc: [["type", ARC_TYPES], ["status", ARC_STATUSES]],
  chapter: [["status", CHAPTER_STATUSES], ["hook", CHAPTER_HOOKS]],
  scene: [["status", SCENE_STATUSES], ["outcome", SCENE_OUTCOMES]],
  question: [["status", QUESTION_STATUSES]],
  promise: [["status", PROMISE_STATUSES]],
  clue: [["status", CLUE_STATUSES]],
  term: [["category", TERM_CATEGORIES]],
  matter: [["placement", MATTER_PLACEMENTS]],
  research: [["status", RESEARCH_STATUSES], ["accuracy", RESEARCH_ACCURACY], ["confidence", RESEARCH_CONFIDENCE], ["method", RESEARCH_METHODS]]
};

function requireEntityEnumOptions(kind, options) {
  for (const [field, allowed] of ENTITY_ENUM_OPTIONS[kind] ?? []) {
    const value = options[field];
    if (value !== undefined && !allowed.has(String(value))) {
      throw new Error(`Unsupported ${kind} ${field} "${value}": expected one of ${[...allowed].join(", ")}`);
    }
  }
}

// Options whose values are entity or chapter ids; a value that is not a
// kebab-case id can never resolve, so add refuses it up front.
const REFERENCE_OPTIONS = ["chapter", "planted", "payoff", "introduced", "resolved", "used-in", "location", "locations", "character", "characters", "mention", "mentions", "member", "members", "owner", "arc", "arcs", "controlled-by"];

const REFERENCE_EXAMPLES = {
  chapter: "chapter-01", planted: "chapter-01", payoff: "chapter-01", introduced: "chapter-01", resolved: "chapter-01", "used-in": "chapter-01",
  location: "port-kestrel", locations: "port-kestrel", arc: "the-long-road", arcs: "the-long-road", "controlled-by": "harbor-council",
  owner: "mara-quill or harbor-council"
};

function assertReferenceOptions(kind, options) {
  for (const option of REFERENCE_OPTIONS) {
    // A character's --arc is its free-text arc theme, not an arc id.
    if (kind === "character" && (option === "arc" || option === "arcs")) {
      continue;
    }
    for (const value of normalizeList(options[option], [])) {
      if (!isKebabId(value)) {
        throw new Error(`--${option} "${value}" must be a kebab-case id (such as ${REFERENCE_EXAMPLES[option] ?? "mara-quill"})`);
      }
    }
  }
  if ((kind === "chapter" || kind === "scene") && options.pov !== undefined && String(options.pov).trim() !== "" && !isKebabId(String(options.pov).trim())) {
    throw new Error(`--pov "${options.pov}" must be a character id (such as mara-quill)`);
  }
}

const CHAPTER_REFERENCE_OPTIONS = ["chapter", "planted", "payoff", "introduced", "resolved", "used-in"];

// The same rule links applies to scheduled chapters: chapter-00 never
// exists, and chapter-1 beside chapter-01 is a typo.
function assertChapterReferences(project, options) {
  const byNumber = new Map(project.chapters.map((chapter) => [chapter.number, chapter.id]));
  for (const option of CHAPTER_REFERENCE_OPTIONS) {
    for (const value of normalizeList(options[option], [])) {
      const match = /^chapter-(\d+)$/.exec(value);
      if (!match || project.chapters.some((chapter) => chapter.id === value)) {
        continue;
      }
      const number = Number.parseInt(match[1], 10);
      if (number === 0) {
        throw new Error(`--${option} ${value}: chapter numbers start at 1`);
      }
      if (byNumber.has(number)) {
        throw new Error(`--${option} ${value}: did you mean ${byNumber.get(number)}?`);
      }
    }
  }
}

export function createEntity(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "add");
  const kind = normalizeKind(options.kind);
  requireEntityEnumOptions(kind, options);
  assertReferenceOptions(kind, options);
  assertChapterReferences(project, options);
  // A promise or clue planted in a chapter not written yet is still a plan.
  if ((kind === "promise" || kind === "clue") && options.status === undefined && options.planted !== undefined
    && !project.chapters.some((chapter) => chapter.id === String(options.planted).trim())) {
    options = { ...options, status: "planned" };
  }
  const name = String(options.name ?? "").trim();
  if (!name) {
    throw new Error(`A ${kind} name is required`);
  }

  const entity = buildEntity(project, kind, name, options);
  assertPortableId(entity.id, kind);
  if (fs.existsSync(entity.file)) {
    throw new Error(`${relative(project, entity.file)} already exists`);
  }

  writeFile(entity.file, entity.markdown, { root: project.root });
  applyEntityBacklinks(project.root, kind, entity.id, readMarkdown(entity.file, project.root).data);
  const reindexed = reindexProject(project.root);
  return { kind, id: entity.id, file: entity.file, changed: [entity.file].concat(reindexed.changed) };
}

export function renameEntity(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "rename");
  const kind = normalizeKind(options.kind);
  const oldId = String(options.id ?? "").trim();
  const name = String(options.name ?? "").trim();
  if (!oldId || !name) {
    throw new Error("rename requires an entity id and a new name");
  }

  const config = entityConfig(kind);
  const oldFile = path.join(project.root, config.dir, `${oldId}.md`);
  requireKebabId(oldId, `${kind} id`);
  assertSafeProjectPath(oldFile, project.root);
  // Chapter and scene ids derive from their numbers ({chapter}-scene-NN), so
  // renaming them changes only the title.
  const newId = kind === "chapter" || kind === "scene" ? oldId : kebabCase(name);
  if (!isKebabId(newId)) {
    throw new Error(`Cannot derive a kebab-case id from ${kind} name "${name}"`);
  }
  assertPortableId(newId, kind);
  const newFile = path.join(project.root, config.dir, `${newId}.md`);
  assertSafeProjectPath(newFile, project.root);
  if (!fs.existsSync(oldFile)) {
    // An interrupted rename already moved the entity file: finish rewriting
    // the references that still use the old id. (The target's own name must
    // match, so an unrelated entity is never treated as the moved one.)
    if (newFile !== oldFile && fs.existsSync(newFile) && readMarkdown(newFile, project.root).data[config.titleField] === name) {
      writeReferencePlan(project.root, replaceEntityReferences(project.root, kind, oldId, newId, new Map()));
      const reindexed = reindexProject(project.root);
      return { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed), resumed: true };
    }
    throw new Error(`${kind} ${oldId} does not exist`);
  }
  if (newFile !== oldFile && fs.existsSync(newFile)) {
    throw new Error(`${kind} ${newId} already exists`);
  }

  const markdown = readMarkdown(oldFile, project.root);

  const data = { ...markdown.data, [config.titleField]: name };
  const retitled = retitleHeading(replaceFrontmatter(markdown.rawMarkdown, data), markdown.data[config.titleField], name);
  if (newFile === oldFile) {
    writeFile(oldFile, retitled, { root: project.root });
  } else {
    // Plan every rewrite before touching disk so a parse failure leaves the
    // project unchanged.
    const plan = replaceEntityReferences(project.root, kind, oldId, newId, new Map([[oldFile, retitled]]));
    const renamedContents = plan.get(oldFile);
    plan.delete(oldFile);

    // References first, the entity file last: if the command is killed
    // partway, the old file still exists and a rerun finishes the job.
    writeReferencePlan(project.root, plan);
    writeFile(newFile, renamedContents, { root: project.root });
    fs.rmSync(oldFile);
  }

  const reindexed = reindexProject(project.root);
  return { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed) };
}

// Updates the first heading that shows the old name (`# Old Name`, or
// `# Chapter 3: Old Name`) so the file body matches its new frontmatter.
function retitleHeading(markdown, oldName, newName) {
  const oldText = String(oldName ?? "").trim();
  const match = FRONTMATTER_PATTERN.exec(markdown);
  const header = match ? match[0] : "";
  const body = markdown.slice(header.length);
  const heading = new RegExp(`^(#[ \\t]+(?:Chapter \\d+:[ \\t]+)?)${escapeRegExp(oldText)}([ \\t]*)(?=\\r?$)`, "m");
  return `${header}${body.replace(heading, (whole, prefix, trailing) => `${prefix}${newName}${trailing}`)}`;
}

export function removeEntity(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "remove");
  const kind = normalizeKind(options.kind);
  const id = String(options.id ?? "").trim();
  if (!id) {
    throw new Error("remove requires an entity id");
  }

  const config = entityConfig(kind);
  const file = path.join(project.root, config.dir, `${id}.md`);
  requireKebabId(id, `${kind} id`);
  assertSafeProjectPath(file, project.root);
  if (!fs.existsSync(file)) {
    throw new Error(`${kind} ${id} does not exist`);
  }

  if (kind === "chapter") {
    // A scene's chapter is required, so scrubbing it would leave the scene
    // invalid; the scenes go first.
    const scenes = project.scenes.filter((scene) => scene.chapter === id);
    if (scenes.length > 0) {
      throw new Error(`chapter ${id} still has scenes: ${scenes.map((scene) => scene.id).join(", ")}. Remove them first with story remove scene <id>`);
    }
  }

  const plan = removeEntityReferences(project.root, kind, id, new Map([[file, null]]));
  // References first, the file last, so an interrupted remove can be rerun.
  writeReferencePlan(project.root, plan);
  fs.rmSync(file);
  const reindexed = reindexProject(project.root);
  return { kind, id, file, changed: [file].concat(reindexed.changed) };
}

// Moves a chapter to another number, or a scene to another chapter or
// position. Chapter and scene ids encode their numbers, so a move renames the
// files and rewrites every reference: scene `chapter` fields, promise, clue,
// question, and research chapters, died-in, continuity state, links, and
// bare ids in plot/timeline.md and arc files. References are written first
// and the moved files last, so an interrupted move can be rerun.
export function moveEntity(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "move");
  const kind = normalizeKind(options.kind);
  const id = String(options.id ?? "").trim();
  if (!id) {
    throw new Error("move requires a chapter or scene id");
  }
  requireKebabId(id, `${kind} id`);
  if (kind === "chapter") {
    return moveChapter(project, id, options);
  }
  if (kind === "scene") {
    return moveScene(project, id, options);
  }
  throw new Error(`story move works on chapters and scenes, not ${kind}s; use story rename to change other ids`);
}

function moveChapter(project, oldId, options) {
  const chapter = project.chapters.find((entry) => entry.id === oldId);
  if (!chapter) {
    throw new Error(`chapter ${oldId} does not exist`);
  }
  if (options.number === undefined) {
    throw new Error("move chapter requires --number <n>");
  }
  const number = requirePositiveInteger(options.number, "chapter number");
  const newId = `chapter-${String(number).padStart(2, "0")}`;
  const newFile = path.join(project.root, "chapters", `${newId}.md`);
  if (newId === oldId) {
    throw new Error(`${oldId} is already chapter ${number}`);
  }
  const taken = project.chapters.find((entry) => entry.number === number && entry.id !== oldId);

  const markdown = readMarkdown(chapter.file, project.root);
  const renumbered = replaceFrontmatter(markdown.rawMarkdown, { ...markdown.data, number })
    .replace(/^(#[ \t]+Chapter[ \t]+)\d+(?=[ \t]*(?::|$))/m, `$1${number}`);
  const scenes = project.scenes.filter((scene) => scene.chapter === oldId);
  const sceneMoves = scenes.map((scene) => ({
    oldFile: scene.file,
    newFile: path.join(project.root, "scenes", `${newId}-scene-${String(scene.scene).padStart(2, "0")}.md`)
  }));
  const context = entityReferenceContext(project.root, "chapter", oldId);
  // Links to the chapter's scene files follow the scenes too.
  const sceneContexts = scenes.map((scene) => ({ context: entityReferenceContext(project.root, "scene", scene.id), newId: `${newId}-scene-${String(scene.scene).padStart(2, "0")}` }));
  const plan = planReferenceRewrites(project.root, context, new Map([[chapter.file, renumbered]]),
    idRenamer(oldId, newId),
    (body, file) => renameIdTokens(project.root, file, sceneContexts.reduce(
      (text, entry) => renameLinkTargets(project.root, file, text, entry.context, entry.newId),
      renameLinkTargets(project.root, file, body, context, newId)
    ), oldId, newId));
  // current-chapter is a number: follow the chapter it pointed at.
  const statePath = path.join(project.root, "continuity", "state.md");
  if (fs.existsSync(statePath)) {
    const stateText = plan.get(statePath) ?? readTextFile(statePath);
    const stateData = parseFrontmatter(stateText, statePath).data;
    if (stateData["current-chapter"] === chapter.number) {
      plan.set(statePath, replaceFrontmatter(stateText, { ...stateData, "current-chapter": number }));
    }
  }
  // The number is taken, unless the chapter there is exactly what this move
  // writes (an earlier run was interrupted after writing it).
  if (taken && readTextFile(taken.file) !== plan.get(chapter.file)) {
    throw new Error(`${newId} already exists: move it first. To make room, renumber from the highest chapter down`);
  }
  const moves = [{ oldFile: chapter.file, newFile }, ...sceneMoves];
  commitMoves(project.root, plan, moves);
  const reindexed = reindexProject(project.root);
  return { kind: "chapter", oldId, id: newId, file: newFile, moved: moves.length, changed: moves.map((move) => move.newFile).concat(reindexed.changed) };
}

function moveScene(project, oldId, options) {
  const scene = project.scenes.find((entry) => entry.id === oldId);
  if (!scene) {
    throw new Error(`scene ${oldId} does not exist`);
  }
  if (options.chapter === undefined && options.scene === undefined) {
    throw new Error("move scene requires --chapter <id>, --scene <n>, or both");
  }
  const chapterId = String(options.chapter ?? scene.chapter).trim();
  requireKebabId(chapterId, "chapter id");
  if (!project.chapters.some((entry) => entry.id === chapterId)) {
    throw new Error(`chapter ${chapterId} does not exist`);
  }
  const number = options.scene === undefined ? nextSceneNumber(project, chapterId) : requirePositiveInteger(options.scene, "scene number");
  const newId = `${chapterId}-scene-${String(number).padStart(2, "0")}`;
  const newFile = path.join(project.root, "scenes", `${newId}.md`);
  if (newId === oldId) {
    throw new Error(`${oldId} is already scene ${number} of ${chapterId}`);
  }
  const markdown = readMarkdown(scene.file, project.root);
  const moved = replaceFrontmatter(markdown.rawMarkdown, { ...markdown.data, chapter: chapterId, scene: number });
  const context = entityReferenceContext(project.root, "scene", oldId);
  // No frontmatter field names a scene, so only links and bare ids change.
  const plan = planReferenceRewrites(project.root, context, new Map([[scene.file, moved]]),
    idRenamer(oldId, newId),
    (body, file) => renameIdTokens(project.root, file, renameLinkTargets(project.root, file, body, context, newId), oldId, newId));
  const existing = project.scenes.find((entry) => entry.id === newId);
  if (existing && readTextFile(existing.file) !== plan.get(scene.file)) {
    throw new Error(`${newId} already exists: move it first`);
  }
  commitMoves(project.root, plan, [{ oldFile: scene.file, newFile }]);
  applyEntityBacklinks(project.root, "scene", newId, readMarkdown(newFile, project.root).data);
  const reindexed = reindexProject(project.root);
  return { kind: "scene", oldId, id: newId, file: newFile, moved: 1, changed: [newFile].concat(reindexed.changed) };
}

function idRenamer(oldId, newId) {
  return (value) => (value === oldId ? newId : value);
}

// Bare chapter and scene ids in plot/timeline.md and arc bodies, which links
// checks, follow the move. `chapter-03` never matches inside `chapter-03-scene-01`
// unless the whole scene id is the one moving, and scene ids of a moved chapter
// (`chapter-03-scene-02`) follow it too.
function renameIdTokens(root, file, body, oldId, newId) {
  const relativePath = path.relative(root, file);
  if (relativePath !== path.join("plot", "timeline.md") && path.dirname(relativePath) !== path.join("plot", "arcs")) {
    return body;
  }
  return body
    .replace(new RegExp(`(?<![\\w-])${escapeRegExp(oldId)}-scene-(\\d+)(?![\\w-])`, "g"), `${newId}-scene-$1`)
    .replace(new RegExp(`(?<![\\w-])${escapeRegExp(oldId)}(?![\\w-])`, "g"), newId);
}

// Writes every rewritten reference, then each moved file at its new path,
// then deletes the old paths. A file already at a new path is refused unless
// it is byte for byte what this move writes there: then an earlier run was
// interrupted after writing it, and this run finishes the job.
function commitMoves(root, plan, moves) {
  const contents = moves.map((move) => plan.get(move.oldFile) ?? readTextFile(move.oldFile));
  moves.forEach((move, index) => {
    if (fs.existsSync(move.newFile) && readTextFile(move.newFile) !== contents[index]) {
      throw new Error(`${path.relative(root, move.newFile)} already exists; nothing was changed`);
    }
  });
  for (const move of moves) {
    plan.delete(move.oldFile);
  }
  writeReferencePlan(root, plan);
  moves.forEach((move, index) => writeFile(move.newFile, contents[index], { root }));
  for (const move of moves) {
    fs.rmSync(move.oldFile);
  }
}

function storyBible(options) {
  const data = {
    title: options.title,
    "schema-version": STORY_SCHEMA_VERSION
  };
  if (options.series !== undefined) {
    data.series = options.series;
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
  if (options.form !== undefined) {
    data.form = options.form;
    const target = STORY_FORMS.get(options.form).target;
    if (target !== null) {
      data["target-words"] = target;
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

function characterIndex(storyId, characters, relationshipMap, familyTrees) {
  const rows = characters.length === 0
    ? ["| *No characters yet* | | | |"]
    : characters.map((character) => `| ${character.name} | ${character.role} | ${character.status} | [${character.id}](${character.id}.md) |`);

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

function worldIndex(storyId, locations, systems, factions, artifacts, overview) {
  const locationRows = locations.length === 0
    ? ["| *No locations yet* | | | |"]
    : locations.map((location) => `| ${location.name} | ${titleCaseSlug(location.type)} | ${location.region} | [${location.id}](locations/${location.id}.md) |`);
  const systemRows = systems.length === 0
    ? ["| *No systems yet* | | |"]
    : systems.map((system) => `| ${system.name} | ${titleCaseSlug(system.type)} | [${system.id}](systems/${system.id}.md) |`);
  const factionRows = factions.length === 0
    ? ["| *No factions yet* | | | |"]
    : factions.map((faction) => `| ${faction.name} | ${titleCaseSlug(faction.type)} | ${faction.status} | [${faction.id}](factions/${faction.id}.md) |`);
  const artifactRows = artifacts.length === 0
    ? ["| *No artifacts yet* | | | |"]
    : artifacts.map((artifact) => `| ${artifact.name} | ${titleCaseSlug(artifact.type)} | ${artifact.status} | [${artifact.id}](artifacts/${artifact.id}.md) |`);

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

function plotIndex(storyId, structure, arcs, storyStructure, themeTracking) {
  const arcRows = arcs.length === 0
    ? ["| *No arcs yet* | | | |"]
    : arcs.map((arc) => `| ${arc.name} | ${arc.type} | ${arc.status} | [${arc.id}](arcs/${arc.id}.md) |`);

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

function chapterIndex(storyId, chapters) {
  const rows = chapters.length === 0
    ? ["| *No chapters yet* | | | | | |"]
    : chapters.map((chapter) => `| ${chapter.number} | ${chapter.title} | ${chapter.pov} | ${chapter.status} | ${chapter.wordCount} | [${chapter.id}](${path.basename(chapter.file)}) |`);
  const total = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);

  return `${stringifyFrontmatter({ type: "chapter-registry", story: storyId })}# Chapters

## Registry

| # | Title | POV | Status | Word Count | File |
|---|-------|-----|--------|------------|------|
${rows.join("\n")}

## Total Word Count: ${total}
`;
}

function timeline(storyId) {
  return `${stringifyFrontmatter({ type: "timeline", story: storyId })}# Story Timeline

| When | Event | Arc | Chapter |
|------|-------|-----|---------|
| *No events yet* | | | |
`;
}

function sceneIndex(storyId, scenes) {
  const rows = scenes.length === 0
    ? ["| *No scenes yet* | | | | | |"]
    : scenes.map((scene) => `| ${scene.chapter} | ${scene.scene} | ${scene.title} | ${scene.pov} | ${scene.status} | [${scene.id}](${scene.id}.md) |`);

  return `${stringifyFrontmatter({ type: "scene-registry", story: storyId })}# Scenes

## Registry

| Chapter | Scene | Title | POV | Status | File |
|---------|-------|-------|-----|--------|------|
${rows.join("\n")}
`;
}

function continuityState(storyId) {
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

function questionIndex(storyId, questions) {
  const rows = questions.length === 0
    ? ["| *No questions yet* | | | |"]
    : questions.map((question) => `| ${question.title} | ${question.status} | ${question.introduced} | [${question.id}](${question.id}.md) |`);

  return `${stringifyFrontmatter({ type: "question-registry", story: storyId })}# Continuity Questions

## Registry

| Question | Status | Introduced | File |
|----------|--------|------------|------|
${rows.join("\n")}
`;
}

function promiseIndex(storyId, promises) {
  const rows = promises.length === 0
    ? ["| *No promises yet* | | | |"]
    : promises.map((promise) => `| ${promise.title} | ${promise.status} | ${promise.planted} | [${promise.id}](${promise.id}.md) |`);

  return `${stringifyFrontmatter({ type: "promise-registry", story: storyId })}# Promises And Payoffs

## Registry

| Promise | Status | Planted | File |
|---------|--------|---------|------|
${rows.join("\n")}
`;
}

function clueIndex(storyId, clues) {
  const rows = clues.length === 0
    ? ["| *No clues yet* | | | |"]
    : clues.map((clue) => `| ${clue.title} | ${clue.status} | ${clue.planted} | [${clue.id}](${clue.id}.md) |`);

  return `${stringifyFrontmatter({ type: "clue-registry", story: storyId })}# Clue Ledger

## Registry

| Clue | Status | Planted | File |
|------|--------|---------|------|
${rows.join("\n")}
`;
}

function glossaryIndex(storyId, terms) {
  const rows = terms.length === 0
    ? ["| *No terms yet* | | |"]
    : terms.map((term) => `| ${term.term} | ${term.category} | [${term.id}](terms/${term.id}.md) |`);

  return `${stringifyFrontmatter({ type: "glossary-registry", story: storyId })}# Glossary

## Registry

| Term | Category | File |
|------|----------|------|
${rows.join("\n")}
`;
}

function matterIndex(storyId, pages) {
  const rows = pages.length === 0
    ? ["| *No matter pages yet* | | | |"]
    : pages.map((page) => `| ${page.title} | ${page.placement} | ${page.order} | [${page.id}](${page.id}.md) |`);

  return `${stringifyFrontmatter({ type: "matter-registry", story: storyId })}# Front And Back Matter

## Registry

| Title | Placement | Order | File |
|-------|-----------|-------|------|
${rows.join("\n")}
`;
}

function researchIndex(storyId, notes) {
  const rows = notes.length === 0
    ? ["| *No research notes yet* | | | |"]
    : notes.map((note) => `| ${note.title} | ${note.status} | ${note.usedIn.join(", ")} | [${note.id}](${note.id}.md) |`);

  return `${stringifyFrontmatter({ type: "research-registry", story: storyId })}# Research

## Registry

| Title | Status | Used In | File |
|-------|--------|---------|------|
${rows.join("\n")}
`;
}

function styleSheet() {
  return `${stringifyFrontmatter({
    type: "style-sheet",
    dialect: "unspecified",
    preferred: [],
    "watch-words": [],
    "allow-words": []
  })}# Style Sheet

The book's house decisions, kept the way a copyeditor keeps them. Read this before drafting or revising prose. \`story prose\` enforces the lists in the frontmatter: \`dialect\` (british, american, or unspecified) flags the other dialect's common spellings, each \`preferred\` entry flags its \`avoid\` form, \`watch-words\` are counted in every chapter, and \`allow-words\` silences a built-in filter word or adverb.

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

// `displayPath` is the project path as the user typed it, so suggested
// commands run from where the user is; it defaults to ".".
function buildProjectActions(project, validation, links, continuity, displayPath = ".") {
  const where = shellWord(displayPath);
  const passesCommand = where === "." ? "story passes" : `story passes ${where}`;
  const actions = [];
  if (validation.errors.length > 0) {
    actions.push(action("P0", "Fix validation errors", `Run story validate ${where} and repair ${validation.errors.length} schema or registry errors.`));
  }
  if (links.errors.length > 0) {
    actions.push(action("P0", "Fix broken references", `Run story links ${where} and repair ${links.errors.length} missing references or backlinks.`));
  }
  if (continuity.errors.length > 0) {
    actions.push(action("P0", "Fix continuity contradictions", `Run story continuity ${where} and repair ${continuity.errors.length} deterministic continuity errors.`));
  }
  if (continuity.warnings.length > 0) {
    actions.push(action("P1", "Review continuity warnings", `Run story continuity ${where} and review ${continuity.warnings.length} continuity warnings.`));
  }
  const staleChapters = [];
  const chaptersWithoutScenes = [];
  let nextNumber = 1;
  for (const chapter of project.chapters) {
    if (chapter.declaredWordCount !== chapter.wordCount) {
      staleChapters.push(chapter);
    }
    let hasScene = false;
    for (const scene of project.scenes) {
      if (scene.chapter === chapter.id) {
        hasScene = true;
      }
    }
    if (!hasScene) {
      chaptersWithoutScenes.push(chapter);
    }
    if (Number.isInteger(chapter.number) && chapter.number > 0) {
      nextNumber = Math.max(nextNumber, chapter.number + 1);
    }
  }
  if (staleChapters.length > 0) {
    actions.push(action("P1", "Refresh word counts", `Run story wordcount ${where} --write for ${staleChapters.length} chapters with stale counts.`));
  }
  if (chaptersWithoutScenes.length > 0) {
    actions.push(action("P1", "Add scene records", `Create machine-readable scene files for ${chaptersWithoutScenes.length} chapters so continuity has durable state.`));
  }
  // The discovery-drafting reconcile loop ends with post-hoc notes; a
  // discovered chapter without them has not been reconciled.
  const unreconciled = project.chapters.filter((chapter) => chapter.mode === "discovered" && !chapter.hasPostHocNotes);
  if (unreconciled.length > 0) {
    actions.push(action("P1", "Reconcile discovered chapters", `Run the discovery-drafting reconcile loop and add ## Chapter Notes (post-hoc) for ${unreconciled.map((chapter) => chapter.id).join(", ")}.`));
  }
  const openQuestions = [];
  for (const question of project.questions) {
    if (question.status === "open") {
      openQuestions.push(question);
    }
  }
  if (openQuestions.length > 0) {
    actions.push(action("P2", "Track open questions", `${openQuestions.length} mysteries or continuity questions are still open.`));
  }
  const pendingPromises = [];
  for (const promise of project.promises) {
    if (promise.status === "planned" || promise.status === "planted") {
      pendingPromises.push(promise);
    }
  }
  if (pendingPromises.length > 0) {
    actions.push(action("P2", "Review promises and payoffs", `${pendingPromises.length} setup/payoff promises need planting or payoff decisions.`));
  }
  const openClues = [];
  for (const clue of project.clues) {
    if (clue.status === "planned" || clue.status === "planted") {
      openClues.push(clue);
    }
  }
  if (openClues.length > 0) {
    actions.push(action("P2", "Review open clues", `${openClues.length} clues are still planned or planted.`));
  }
  if (project.story.data.status === "revising") {
    const passes = readPasses(project.story.data);
    const upcoming = nextPass(passes);
    if (passes.length === 0) {
      actions.push(action("P1", "Plan revision passes", `Run ${passesCommand} --init to record the structure-to-proof pass ladder, then work one pass at a time.`));
    } else if (upcoming !== null) {
      const known = DEFAULT_PASSES.find((entry) => entry.pass === upcoming.pass);
      const checks = known ? ` Run ${known.checks.join(", ")}.` : "";
      actions.push(action("P1", `Revision pass: ${upcoming.pass}`, `${known ? `${known.focus}.` : "Work through this pass."}${checks} Mark it with ${passesCommand} --done ${upcoming.pass}.`));
    }
  }
  const activeArcNames = [];
  for (const arc of project.arcs) {
    if (arc.status !== "resolved" && activeArcNames.length < 3) {
      activeArcNames.push(arc.name);
    }
  }
  const nextLabel = activeArcNames.length > 0
    ? `advance ${activeArcNames.join(", ")}`
    : "establish the next story beat";
  const maintenanceCount = actions.length;
  // A book under revision or finished, or whose arcs are all resolved, needs
  // no new chapter.
  const storyStatus = project.story.data.status;
  const drafting = !["revising", "complete", "abandoned"].includes(storyStatus)
    && !(project.arcs.length > 0 && project.arcs.every((arc) => arc.status === "resolved"));
  if (drafting) {
    actions.push(action("P2", `Draft chapter ${nextNumber}`, `Use story add chapter "Chapter ${nextNumber}" --number ${nextNumber}${where === "." ? "" : ` --path ${where}`}, then outline scenes to ${nextLabel}.`));
  }
  if (project.characters.length === 0) {
    actions.push(action("P2", "Create first character", `Use story add character "Name" --role protagonist${where === "." ? "" : ` --path ${where}`} before drafting prose.`));
  }
  // Array#sort is stable (ES2019+), so actions sharing a priority keep their insertion order.
  actions.sort((left, right) => left.priority.localeCompare(right.priority, "en"));
  if (maintenanceCount === 0 && validation.ok && links.ok && continuity.ok && continuity.warnings.length === 0 && staleChapters.length === 0 && chaptersWithoutScenes.length === 0) {
    actions.push(action("P3", "Project is mechanically healthy", "No deterministic maintenance issues are blocking the next writing pass."));
  }
  return actions;
}

export function shellWord(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./~:@%+=,-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
}

function action(priority, title, detail) {
  return { priority, title, detail };
}

function appendActionLines(lines, actions) {
  if (actions.length === 0) {
    lines.push("- No actions found");
    return;
  }

  for (const item of actions) {
    lines.push(`- [${item.priority}] ${item.title}: ${item.detail}`);
  }
}

function buildEntity(project, kind, name, options) {
  if (kind === "chapter") {
    const number = options.number === undefined
      ? project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0) + 1
      : requirePositiveInteger(options.number, "chapter number");
    const id = `chapter-${String(number).padStart(2, "0")}`;
    return entityResult(project, kind, id, chapterFile(name, number, options));
  }

  if (kind === "scene") {
    if (options.chapter === undefined && project.chapters.length === 0) {
      throw new Error("No chapters yet: add one with story add chapter before adding a scene");
    }
    const chapter = String(options.chapter ?? project.chapters.at(-1).id).trim();
    requireKebabId(chapter, "chapter id");
    if (!project.chapters.some((entry) => entry.id === chapter)) {
      throw new Error(`chapter ${chapter} does not exist: add it with story add chapter, or pass --chapter with an existing chapter id`);
    }
    const scene = options.scene === undefined
      ? nextSceneNumber(project, chapter)
      : requirePositiveInteger(options.scene, "scene number");
    const id = `${chapter}-scene-${String(scene).padStart(2, "0")}`;
    return entityResult(project, kind, id, sceneFile(name, chapter, scene, options));
  }

  const id = kebabCase(name);
  if (!id) {
    throw new Error(`Cannot derive a kebab-case id from ${kind} name "${name}"`);
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

function entityConfig(kind) {
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

const KIND_ALIASES = {
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

function normalizeKind(kind) {
  const normalized = String(kind ?? '').trim().toLowerCase();
  const expected = [...new Set(Object.values(KIND_ALIASES))].join(', ');
  if (normalized === '') {
    throw new Error(`An entity kind is required: expected one of ${expected}`);
  }
  if (!Object.hasOwn(KIND_ALIASES, normalized)) {
    throw new Error(`Unsupported entity kind: ${kind}: expected one of ${expected}`);
  }
  return KIND_ALIASES[normalized];
}

// Windows reserves these file names with any extension, so `con.md` cannot
// be checked out there.
const WINDOWS_RESERVED_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

function assertPortableId(id, kind) {
  if (WINDOWS_RESERVED_ID.test(id)) {
    const file = kind === "story" ? id : `${id}.md`;
    throw new Error(`Cannot use ${kind} id ${id}: Windows reserves the file name ${file}. Choose a longer name, such as "${id} ${kind}"`);
  }
}

function requireKebabId(id, label) {
  if (!isKebabId(id)) {
    throw new Error(`${label} must be a kebab-case id, got "${id}"`);
  }
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer, got ${value}`);
  }
  return number;
}

function isKebabId(value) {
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
    locations: normalizeList(options.locations ?? options.location, []),
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
    "notable-characters": normalizeList(options.characters ?? options.character, []),
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
    members: normalizeList(options.members ?? options.member ?? options.characters ?? options.character, []),
    locations: normalizeList(options.locations ?? options.location, []),
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
    characters: normalizeList(options.characters ?? options.character, []),
    themes: normalizeList(options.themes ?? options.theme, []),
    acts: normalizeList(options.acts ?? options.act, [])
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

function chapterFile(title, number, options) {
  const dateError = storyDateError(options.date);
  if (dateError) {
    throw new Error(dateError);
  }
  const timeError = storyTimeError(options.time);
  if (timeError) {
    throw new Error(timeError);
  }
  return `${stringifyFrontmatter({
    title,
    number,
    pov: options.pov ?? "",
    locations: normalizeList(options.locations ?? options.location, []),
    characters: castWithPov(options),
    mentions: normalizeList(options.mentions ?? options.mention, []),
    "arcs-advanced": normalizeList(options.arcs ?? options.arc, []),
    status: options.status ?? "outline",
    mode: options.mode ?? "",
    date: options.date ?? "",
    time: options.time ?? "",
    ...(options.hook === undefined ? {} : { hook: options.hook }),
    "word-count": 0
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
    throw new Error(dateError);
  }
  const timeError = storyTimeError(options.time);
  if (timeError) {
    throw new Error(timeError);
  }
  const travelHoursOption = options["travel-hours"];
  let travelHours;
  if (travelHoursOption !== undefined && travelHoursOption !== "") {
    travelHours = Number(travelHoursOption);
    if (!Number.isFinite(travelHours)) {
      throw new Error(`travel-hours must be a number, got ${travelHoursOption}`);
    }
    if (travelHours < 0) {
      throw new Error(`travel-hours must be zero or positive, got ${travelHoursOption}`);
    }
  }
  const frontmatter = {
    title,
    chapter,
    scene,
    pov: options.pov ?? "",
    location: options.location ?? "",
    characters: castWithPov(options),
    mentions: normalizeList(options.mentions ?? options.mention, []),
    "arcs-advanced": normalizeList(options.arcs ?? options.arc, []),
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
  const characters = normalizeList(options.characters ?? options.character, []);
  const pov = String(options.pov ?? "").trim();
  return pov === "" || characters.includes(pov) ? characters : [pov, ...characters];
}

function questionFile(title, options) {
  const resolved = String(options.resolved ?? "").trim();
  if (resolved !== "" && options.status === "open") {
    throw new Error("A question with --resolved cannot have status open: use --status answered or resolved");
  }
  return `${stringifyFrontmatter({
    title,
    // A resolved chapter means the answer is on the page.
    status: options.status ?? (resolved === "" ? "open" : "answered"),
    introduced: options.introduced ?? "",
    resolved: options.resolved ?? "",
    characters: normalizeList(options.characters ?? options.character, [])
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
    arcs: normalizeList(options.arcs ?? options.arc, []),
    characters: normalizeList(options.characters ?? options.character, [])
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
    characters: normalizeList(options.characters ?? options.character, []),
    arcs: normalizeList(options.arcs ?? options.arc, [])
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
    aliases: normalizeList(options.aliases ?? options.alias, [])
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
    sources: asArray(options.sources ?? options.source).map((source) => String(source).trim()).filter(Boolean),
    "used-in": normalizeList(options["used-in"], []),
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
  const risks = normalizeList(options.risk, []);
  for (const risk of risks) {
    if (!RESEARCH_RISKS.has(risk)) {
      throw new Error(`Unsupported risk "${risk}": expected one of ${[...RESEARCH_RISKS].join(", ")}`);
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
    order = Number(options.order);
    if (!Number.isInteger(order) || order < 0) {
      throw new Error(`matter order must be a non-negative integer, got ${options.order}`);
    }
  }
  // --heading false suits a dedication or epigraph, which prints no title.
  const heading = options.heading === undefined ? true : isTruthy(options.heading);
  return `${stringifyFrontmatter({ title, placement, order, heading })}# ${title}

`;
}

function nextSceneNumber(project, chapter) {
  return project.scenes
    .filter((scene) => scene.chapter === chapter)
    .reduce((max, scene) => Math.max(max, scene.scene), 0) + 1;
}

function ensureDirectory(directory, changed, root) {
  if (!fs.existsSync(directory)) {
    assertLexicallyInsideRoot(directory, root);
    assertExistingAncestorInsideRoot(directory, root);
    fs.mkdirSync(directory, { recursive: true });
    assertSafeProjectDirectory(directory, root);
    changed.push(directory);
    return;
  }

  assertSafeProjectDirectory(directory, root);
}

function ensureFile(filePath, contents, changed, root) {
  if (!fs.existsSync(filePath)) {
    writeFile(filePath, contents, { root });
    changed.push(filePath);
    return;
  }

  assertSafeProjectPath(filePath, root);
}

// Frontmatter keys whose values are entity ids, mapped to the entity kinds
// each key may point at. rename and remove touch only these keys (and only
// when the key can point at the kind being changed) plus markdown link targets
// that resolve to the entity's file, never prose or unrelated fields such as
// status or tense that may happen to equal an id.
const REFERENCE_FIELD_KINDS = {
  arc: ["arc"],
  arcs: ["arc"],
  "arcs-advanced": ["arc"],
  artifact: ["artifact"],
  chapter: ["chapter"],
  character: ["character"],
  characters: ["character"],
  "controlled-by": ["faction", "character"],
  "died-in": ["chapter"],
  introduced: ["chapter"],
  "learned-in": ["chapter"],
  "used-in": ["chapter"],
  location: ["location"],
  locations: ["location"],
  members: ["character"],
  mentions: ["character", "artifact"],
  "notable-characters": ["character"],
  owner: ["character", "faction"],
  payoff: ["chapter"],
  planted: ["chapter"],
  pov: ["character"],
  resolved: ["chapter"],
  since: ["chapter"]
};

// Nested mapping lists whose entries are identified by one reference key.
// Removing the entity named by that key drops the whole entry; removing an
// entity named by any other key only clears that field.
const ENTRY_IDENTITY_FIELDS = {
  relationships: "character",
  "character-state": "character",
  "knowledge-state": "character",
  "object-state": "artifact",
  routes: "to"
};

// Describes the entity being renamed or removed. A frontmatter key counts as
// a reference to it only when the key can point at its kind. A key that may
// point at several kinds (owner, controlled-by) is left alone when another of
// those kinds has an entity with the same id, because the reference is then
// ambiguous.
function entityReferenceContext(root, kind, id) {
  const otherExists = new Map();
  const existsAs = (other) => {
    if (!otherExists.has(other)) {
      otherExists.set(other, fs.existsSync(path.join(root, entityConfig(other).dir, `${id}.md`)));
    }
    return otherExists.get(other);
  };
  return {
    id,
    kind,
    entityFile: path.resolve(root, entityConfig(kind).dir, `${id}.md`),
    isReferenceKey: (key) => {
      const kinds = Object.hasOwn(REFERENCE_FIELD_KINDS, key) ? REFERENCE_FIELD_KINDS[key] : [];
      return kinds.includes(kind) && !kinds.some((other) => other !== kind && existsAs(other));
    }
  };
}

// Resolves a markdown link target in `file` to an absolute path, or null for
// external links and bare anchors.
function resolveLinkTarget(root, file, target) {
  const cleaned = String(target).trim().split(/\s+/)[0].replace(/^<|>$/g, "").split("#")[0].split("?")[0];
  // A URL with a scheme, or a protocol-relative one, is not a project file.
  if (cleaned === "" || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(cleaned)) {
    return null;
  }
  let decoded = cleaned;
  try {
    decoded = decodeURIComponent(cleaned);
  } catch {
    decoded = cleaned;
  }
  return decoded.startsWith("/")
    ? path.resolve(root, `.${decoded}`)
    : path.resolve(path.dirname(file), decoded);
}

function renameLinkTargets(root, file, body, context, newId) {
  return body.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, (match, text, target) => {
    if (resolveLinkTarget(root, file, target) !== context.entityFile) {
      return match;
    }
    const nextTarget = target.replace(new RegExp(`(^|/|<)${escapeRegExp(context.id)}\\.md(?=$|[#?>\\s])`), `$1${newId}.md`);
    const nextText = text === context.id ? newId : text;
    return `[${nextText}](${nextTarget})`;
  });
}

function replaceEntityReferences(root, kind, oldId, newId, overrides) {
  const context = entityReferenceContext(root, kind, oldId);
  return planReferenceRewrites(root, context, overrides,
    (value) => (value === oldId ? newId : value),
    (body, file) => renameLinkTargets(root, file, body, context, newId));
}

function removeEntityReferences(root, kind, id, overrides) {
  const context = entityReferenceContext(root, kind, id);
  return planReferenceRewrites(root, context, overrides, (value) => (value === id ? null : value), (body) => body);
}

// Reads and rewrites every markdown file in memory before anything is written,
// so an unparsable file aborts the command with the project untouched. Returns
// a Map of file path to new contents; `overrides` supplies in-memory contents
// for files that are about to change (or null for files about to be deleted).
function planReferenceRewrites(root, context, overrides, transform, transformBody) {
  const plan = new Map();
  const storyFile = path.join(root, "story.md");
  for (const file of markdownFiles(root)) {
    const override = overrides?.has(file) ? overrides.get(file) : undefined;
    if (override === null) {
      continue;
    }
    let text = override;
    if (text === undefined) {
      assertSafeProjectPath(file, root);
      text = readTextFile(file);
    }
    const match = FRONTMATTER_PATTERN.exec(text);
    if (!match && isProjectSourceFile(root, file)) {
      throw new Error(`${path.relative(root, file)} is missing YAML frontmatter; nothing was changed`);
    }
    let header = "";
    let body = text;
    if (match) {
      header = match[0];
      body = text.slice(match[0].length);
      // story.md pov is a narrative mode (first, third-limited), not an id.
      if (file !== storyFile) {
        let data;
        try {
          data = parseFrontmatter(text, file).data;
        } catch (error) {
          throw new Error(`${path.relative(root, file)}: ${error.message}; nothing was changed`);
        }
        let nextData = transformReferences(data, transform, context);
        if (context.kind === "chapter") {
          nextData = reconcileChapterStatuses(data, nextData);
        }
        if (JSON.stringify(nextData) !== JSON.stringify(data)) {
          header = replaceFrontmatter(header, nextData);
        }
      }
    }
    const next = `${header}${transformBody(body, file)}`;
    if (next !== text || override !== undefined) {
      plan.set(file, next);
    }
  }
  return plan;
}

// Entity files and registries always carry frontmatter, so one without it is
// broken and must not be skipped. Other markdown (a README, drafts) may be
// plain.
// Only entity files, registries, and the fixed project files count: notes
// a skill keeps beside them (continuity/motifs.md, continuity/theme-audit.md)
// may be plain markdown.
const FRONTMATTER_FILES = new Set([
  path.join("plot", "timeline.md"),
  path.join("continuity", "state.md"),
  path.join("continuity", "exemptions.md")
]);

// The registries the CLI writes; an `_index.md` elsewhere (a notes site,
// say) may be plain markdown.
const REGISTRY_FILES = new Set([
  ...INDEX_SCHEMAS.map(([relativePath]) => relativePath),
  path.join(MATTER_DIR, "_index.md"),
  path.join(RESEARCH_DIR, "_index.md")
]);

function isProjectSourceFile(root, file) {
  const relativePath = path.relative(root, file);
  return SOURCE_ROOT_FILES.has(relativePath)
    || FRONTMATTER_FILES.has(relativePath)
    || REGISTRY_FILES.has(relativePath)
    || ENTITY_SCAN_DIRS.includes(path.dirname(relativePath));
}

// Clearing a removed chapter from a promise, clue, or question also walks
// back a status that claimed the cleared chapter had happened.
function reconcileChapterStatuses(before, after) {
  const next = { ...after };
  if (before.planted && !next.planted && (next.status === "planted" || next.status === "paid-off")) {
    next.status = "planned";
  }
  if (before.payoff && !next.payoff && next.status === "paid-off") {
    next.status = "planted";
  }
  if (before.resolved && !next.resolved && (next.status === "answered" || next.status === "resolved")) {
    next.status = "open";
  }
  return next;
}

function writeReferencePlan(root, plan) {
  for (const [file, contents] of plan) {
    writeFile(file, contents, { root });
  }
}

function transformReferences(data, transform, context, identityKey = null) {
  const next = {};
  // A route's `to` names a location; `to` anywhere else is left alone.
  const isReference = (key) => context.isReferenceKey(key) || (key === "to" && identityKey === "to" && context.kind === "location");
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      const items = [];
      const childIdentity = ENTRY_IDENTITY_FIELDS[key] ?? null;
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const mapped = transformReferences(item, transform, context, childIdentity);
          if (mapped !== null) {
            items.push(mapped);
          }
        } else if (isReference(key)) {
          const mapped = transform(item);
          if (mapped !== null) {
            items.push(mapped);
          }
        } else {
          items.push(item);
        }
      }
      next[key] = items;
      continue;
    }

    if (isReference(key)) {
      const mapped = transform(value);
      if (mapped === null) {
        // A removed id that identifies a nested entry (a relationship's
        // character, a state entry's character or artifact) drops the whole
        // entry; any other reference field is cleared in place.
        if (identityKey !== null && key === identityKey) {
          return null;
        }
        next[key] = "";
        continue;
      }
      next[key] = mapped;
      continue;
    }

    next[key] = value;
  }
  return next;
}

function applyEntityBacklinks(root, kind, id, data) {
  if (kind === "location") {
    for (const characterId of asArray(data["notable-characters"])) {
      if (isKebabId(characterId)) {
        addFrontmatterListValue(root, path.join("characters", `${characterId}.md`), "locations", id);
      }
    }
  }

  if (kind === "scene" && isKebabId(data.chapter)) {
    // The chapter lists everyone and everywhere its scenes use; continuity
    // warns when it does not. Unknown ids stay on the scene only, where
    // links reports them once.
    const chapterFile = path.join("chapters", `${data.chapter}.md`);
    const exists = (dir, id) => fs.existsSync(path.join(root, dir, `${id}.md`));
    if (isKebabId(data.location) && exists(path.join("worldbuilding", "locations"), data.location)) {
      addFrontmatterListValue(root, chapterFile, "locations", data.location);
    }
    const chapterPath = path.join(root, chapterFile);
    const mentions = fs.existsSync(chapterPath) ? asArray(readMarkdown(chapterPath, root).data.mentions) : [];
    for (const characterId of asArray(data.characters)) {
      if (isKebabId(characterId) && exists("characters", characterId) && !mentions.includes(characterId)) {
        addFrontmatterListValue(root, chapterFile, "characters", characterId);
      }
    }
  }

  if (kind === "character") {
    for (const locationId of asArray(data.locations)) {
      if (isKebabId(locationId)) {
        addFrontmatterListValue(root, path.join("worldbuilding", "locations", `${locationId}.md`), "notable-characters", id);
      }
    }
  }
}

function addFrontmatterListValue(root, relativePath, field, value) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath) || !value) {
    return;
  }

  assertSafeProjectPath(filePath, root);
  const markdown = readMarkdown(filePath, root);
  const list = asArray(markdown.data[field]);
  if (!list.includes(value)) {
    writeFile(filePath, replaceFrontmatter(markdown.rawMarkdown, {
      ...markdown.data,
      [field]: list.concat(value)
    }), { root });
  }
}

// Folders that never hold project prose: build output, installed packages
// (a local story-skills install ships its own examples), and dot-folders.
const SKIPPED_SCAN_DIRECTORIES = new Set(["dist", "node_modules"]);

// Markdown files a rename or remove may rewrite. Folders deeper than the
// scan limit are skipped rather than fatal, so an unrelated deep notes tree
// cannot block the command.
function markdownFiles(root, depth = 0, collected = null) {
  const files = collected ?? [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory() && !SKIPPED_SCAN_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
      if (depth < MAX_SCAN_DEPTH) {
        markdownFiles(fullPath, depth + 1, files);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
      if (files.length > MAX_SCAN_FILES) {
        throw new Error(`Too many markdown files in the project: the scan exceeds the ${MAX_SCAN_FILES} file limit`);
      }
    }
  }
  if (depth === 0) {
    files.sort();
  }
  return files;
}

function manuscriptParts(project, action = "build") {
  assertProjectParses(project, action);
  if (project.chapters.length === 0) {
    throw new Error("No chapters found to export");
  }

  for (const chapter of project.chapters) {
    if (!chapter.numberValid || chapter.number <= 0) {
      throw new Error(`${relative(project, chapter.file)}: chapter number must be a positive integer to build`);
    }
  }

  const seenNumbers = new Set();
  for (const chapter of project.chapters) {
    if (seenNumbers.has(chapter.number)) {
      throw new Error(`Duplicate chapter number ${chapter.number}: refusing to build with colliding EPUB ids`);
    }
    seenNumbers.add(chapter.number);
  }

  const chapters = [];
  for (const chapter of project.chapters) {
    const markdown = readMarkdown(chapter.file, project.root);
    chapters.push({
      number: chapter.number,
      title: chapter.title,
      // LF only, so a CRLF checkout builds the same bytes as an LF one.
      body: chapterProse(markdown.body).replace(/\r\n?/g, "\n").trim()
    });
  }

  // Matter ids become EPUB manifest ids and file names, so they must be safe.
  for (const entry of project.matter) {
    if (!isKebabId(entry.id)) {
      throw new Error(`${relative(project, entry.file)}: matter file names must be kebab-case to build`);
    }
  }
  // Unwritten matter (a scaffold with only its heading) stays out of the book.
  const matter = (placement) => project.matter
    .filter((entry) => entry.placement === placement && !entry.empty)
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      heading: entry.heading,
      copyright: isCopyrightMatter(entry),
      body: chapterProse(readMarkdown(entry.file, project.root).body).replace(/\r\n?/g, "\n").trim()
    }));

  const meta = publishingMeta(project.story.data);
  const front = matter("front");
  // A copyright line in story.md becomes the copyright page unless a matter
  // page already provides one.
  const back = matter("back");
  const hasCopyrightPage = [...front, ...back].some((entry) => entry.copyright);
  if (meta.copyright !== "" && !hasCopyrightPage) {
    front.unshift({ id: "copyright", title: "Copyright", heading: false, copyright: true, body: copyrightPage(meta) });
  }

  return {
    title: project.title,
    author: meta.authors.join(" and "),
    meta,
    front,
    chapters,
    back
  };
}

// A copyright page is found by its id or its title, once, and every build
// format reads the flag.
function isCopyrightMatter(entry) {
  return entry.id === "copyright" || /copyright/i.test(entry.title);
}

function epubModifiedTimestamp() {
  // Deterministic builds: identical sources must produce byte-identical
  // output. Honor SOURCE_DATE_EPOCH when set (seconds since epoch, per the
  // reproducible-builds spec); otherwise fall back to a stable default
  // instead of the current time so local builds are deterministic too.
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (raw !== undefined && raw !== "") {
    // Only whole seconds that give a four-digit year are used; anything else
    // (a fraction, 1e20) falls back to the default like a non-number does.
    const date = /^\d+$/.test(raw.trim()) ? new Date(Number(raw.trim()) * 1000) : null;
    if (date !== null && !Number.isNaN(date.getTime()) && date.getUTCFullYear() <= 9999) {
      return date.toISOString().replace(/\.\d{3}Z$/, "Z");
    }
  }
  return "2000-01-01T00:00:00Z";
}

function writeEpub(outFile, storyId, manuscript, writeOptions = {}) {
  const meta = manuscript.meta ?? publishingMeta({});
  const lang = xmlEscape(meta.language);
  const documents = [];
  const pushMatter = (placement) => (entry) => documents.push({
    id: `${placement}-${entry.id}`,
    label: entry.title,
    content: matterXhtml(entry, placement, lang)
  });
  manuscript.front.forEach(pushMatter("front"));
  // Duplicate chapter numbers are refused up front in manuscriptParts, so ids
  // here are unique by construction. Matter ids carry a front- or back-
  // prefix, so they cannot collide with chapter-NN.
  for (const chapter of manuscript.chapters) {
    documents.push({
      id: `chapter-${String(chapter.number).padStart(2, "0")}`,
      label: chapterHeading(chapter.number, chapter.title),
      content: chapterXhtml(chapter, lang),
      bodymatter: true
    });
  }
  manuscript.back.forEach(pushMatter("back"));

  const coverEntries = [];
  const coverItems = [];
  const coverMeta = [];
  const coverSpine = [];
  if (manuscript.cover) {
    const href = `images/cover.${manuscript.cover.extension}`;
    const alt = meta.coverAlt === "" ? `Cover of ${manuscript.title}` : meta.coverAlt;
    coverEntries.push(
      { name: `OEBPS/${href}`, content: fs.readFileSync(manuscript.cover.filePath) },
      { name: "OEBPS/cover.xhtml", content: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><title>${xmlEscape(manuscript.title)}</title></head><body epub:type="cover"><img src="${href}" alt="${xmlEscape(alt)}"/></body></html>` }
    );
    coverItems.push(`<item id="cover-image" href="${href}" media-type="${manuscript.cover.mediaType}" properties="cover-image"/>`, `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    coverMeta.push(`<meta name="cover" content="cover-image"/>`);
    coverSpine.push(`<itemref idref="cover"/>`);
  }

  const creator = meta.authors.map((name) => `<dc:creator>${xmlEscape(name)}</dc:creator>`).join("");
  const identifier = meta.isbn === "" ? xmlEscape(storyId) : `urn:isbn:${meta.isbn}`;
  const optional = [
    meta.publisher === "" ? "" : `<dc:publisher>${xmlEscape(meta.publisher)}</dc:publisher>`,
    meta.publicationDate === "" ? "" : `<dc:date>${xmlEscape(meta.publicationDate)}</dc:date>`,
    meta.description === "" ? "" : `<dc:description>${xmlEscape(meta.description)}</dc:description>`,
    ...meta.subjects.map((subject) => `<dc:subject>${xmlEscape(subject)}</dc:subject>`),
    meta.copyright === "" ? "" : `<dc:rights>${xmlEscape(meta.copyright)}</dc:rights>`
  ].join("");
  const accessibility = epubAccessibilityMeta(Boolean(manuscript.cover));
  const items = documents.map((doc) => `<item id="${doc.id}" href="${doc.id}.xhtml" media-type="application/xhtml+xml"/>`);
  const spine = documents.map((doc) => `<itemref idref="${doc.id}"/>`);
  const modified = epubModifiedTimestamp();
  writeZip(outFile, [
    { name: "mimetype", content: "application/epub+zip" },
    { name: "META-INF/container.xml", content: `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: "OEBPS/content.opf", content: `<?xml version="1.0" encoding="UTF-8"?><package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${xmlEscape(manuscript.title)}</dc:title>${creator}<dc:language>${lang}</dc:language>${optional}<meta property="dcterms:modified">${modified}</meta>${accessibility}${coverMeta.join("")}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${coverItems.join("")}${items.join("")}</manifest><spine>${coverSpine.join("")}${spine.join("")}</spine></package>` },
    { name: "OEBPS/nav.xhtml", content: navXhtml(manuscript.title, documents, lang) },
    ...coverEntries,
    ...documents.map((doc) => ({ name: `OEBPS/${doc.id}.xhtml`, content: doc.content }))
  ], writeOptions);
}

function navXhtml(title, documents, lang = "en") {
  const links = documents.map((doc) => `<li><a href="${doc.id}.xhtml">${xmlEscape(doc.label)}</a></li>`);
  const start = documents.find((doc) => doc.bodymatter);
  // The nav document is not in the spine, so landmarks point only at spine
  // documents (EPUBCheck RSC-011); reading systems find the toc themselves.
  const landmarks = start ? `<nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="bodymatter" href="${start.id}.xhtml">Start of Content</a></li></ol></nav>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><title>${xmlEscape(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${links.join("")}</ol></nav>${landmarks}</body></html>`;
}

// EPUB Accessibility 1.1 discovery metadata for a text-only book with a
// table of contents and a single reading order.
function epubAccessibilityMeta(hasCover) {
  const features = ["tableOfContents", "readingOrder", "structuralNavigation", ...(hasCover ? ["alternativeText"] : [])];
  const summary = hasCover
    ? "Text book with a described cover image, a navigable table of contents, headings for each chapter, and a single logical reading order."
    : "Text-only book with a navigable table of contents, headings for each chapter, and a single logical reading order.";
  return [
    `<meta property="schema:accessMode">textual</meta>`,
    ...(hasCover ? [`<meta property="schema:accessMode">visual</meta>`] : []),
    `<meta property="schema:accessModeSufficient">textual</meta>`,
    ...features.map((feature) => `<meta property="schema:accessibilityFeature">${feature}</meta>`),
    `<meta property="schema:accessibilityHazard">none</meta>`,
    `<meta property="schema:accessibilitySummary">${summary}</meta>`
  ].join("");
}

function xhtmlParagraphs(body) {
  const paragraphs = [];
  for (const paragraph of markdownParagraphs(body)) {
    const runs = inlineRuns(paragraph).map((run) => runMarkup(run, xmlEscape));
    paragraphs.push(`<p>${runs.join("")}</p>`);
  }
  return paragraphs.join("");
}

function xhtmlDocument(title, lang, bodyType, content) {
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><title>${xmlEscape(title)}</title></head><body epub:type="${bodyType}">${content}</body></html>`;
}

function chapterXhtml(chapter, lang = "en") {
  return xhtmlDocument(chapter.title, lang, "bodymatter chapter", `<h1>${xmlEscape(chapterHeading(chapter.number, chapter.title))}</h1>${xhtmlParagraphs(chapter.body)}`);
}

function matterXhtml(entry, placement = "front", lang = "en") {
  const heading = entry.heading ? `<h1>${xmlEscape(entry.title)}</h1>` : "";
  const bodyType = entry.copyright ? `${placement}matter copyright-page` : `${placement}matter`;
  return xhtmlDocument(entry.title, lang, bodyType, `${heading}${xhtmlParagraphs(entry.body)}`);
}

// The manuscript as HTML parts for the review and print builds. Paragraph
// anchors are keyed by chapter number (ch03) or matter id (front-dedication),
// so they stay stable while other chapters change.
function htmlBook(manuscript) {
  const paragraphs = (body) => markdownParagraphs(body).map((paragraph) => (paragraph === "* * *"
    ? null
    : inlineRuns(paragraph).map((run) => runMarkup(run, escapeHtml)).join("")));
  const matter = (placement) => (entry) => ({
    key: `${placement}-${entry.id}`,
    kind: entry.copyright ? `${placement} copyright-page` : placement,
    copyright: Boolean(entry.copyright),
    placement,
    title: entry.title,
    heading: entry.heading,
    paragraphs: paragraphs(entry.body)
  });
  const parts = [
    ...manuscript.front.map(matter("front")),
    ...manuscript.chapters.map((chapter) => ({
      key: `ch${String(chapter.number).padStart(2, "0")}`,
      kind: "chapter",
      placement: "body",
      title: chapterHeading(chapter.number, chapter.title),
      heading: true,
      paragraphs: paragraphs(chapter.body)
    })),
    ...manuscript.back.map(matter("back"))
  ];
  return {
    title: manuscript.title,
    authors: manuscript.meta.authors,
    language: manuscript.meta.language,
    words: manuscript.chapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0),
    parts
  };
}

function writeDocx(outFile, manuscript, writeOptions = {}) {
  const bodyParts = [paragraphXml(manuscript.title, "Title")];
  const pushSection = (heading, body) => {
    if (heading !== null) {
      bodyParts.push(paragraphXml(heading, "Heading1"));
    }
    for (const paragraph of markdownParagraphs(body)) {
      bodyParts.push(paragraphXml(paragraph, "", inlineRuns(paragraph)));
    }
  };
  const pushMatter = (entry) => pushSection(entry.heading ? entry.title : null, entry.body);
  manuscript.front.forEach(pushMatter);
  for (const chapter of manuscript.chapters) {
    pushSection(chapterHeading(chapter.number, chapter.title), chapter.body);
  }
  manuscript.back.forEach(pushMatter);

  writeZip(outFile, docxPackageEntries(bodyParts.join("")), writeOptions);
}

function docxPackageEntries(body) {
  return [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/styles.xml", content: `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="480" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>` },
    { name: "word/document.xml", content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>` }
  ];
}

// Shunn manuscript format: Courier New 12pt, double spacing, page break
// before each chapter heading, and a title page with contact and word count.
const SHUNN_RUN_FONTS = `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/>`;
const SHUNN_PARAGRAPH_SPACING = `<w:spacing w:line="480" w:lineRule="auto"/>`;

function shunnRunXml(text, decoration) {
  return `<w:r><w:rPr>${SHUNN_RUN_FONTS}${decoration}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function shunnTextRunXml(run) {
  return shunnRunXml(run.text, `${run.strong ? "<w:b/>" : ""}${run.em ? "<w:i/>" : ""}`);
}

function shunnParagraphXml(runXml, centered) {
  const alignment = centered ? `<w:jc w:val="center"/>` : "";
  return `<w:p><w:pPr>${SHUNN_PARAGRAPH_SPACING}${alignment}</w:pPr>${runXml}</w:p>`;
}

function shunnChapterHeadingXml(text) {
  return `<w:p><w:pPr>${SHUNN_PARAGRAPH_SPACING}</w:pPr><w:r><w:br w:type="page"/></w:r>${shunnRunXml(text, "<w:b/>")}</w:p>`;
}

function shunnTitlePageXml(meta) {
  const lines = [
    shunnParagraphXml(shunnRunXml(meta.title, "<w:b/>"), true),
    shunnParagraphXml(shunnRunXml("by", ""), true)
  ];
  if (meta.author) {
    lines.push(shunnParagraphXml(shunnRunXml(meta.author, ""), true));
  }
  lines.push(shunnParagraphXml(shunnRunXml(`Approximately ${meta.words} words`, ""), true));
  for (const contactLine of meta.contact) {
    lines.push(shunnParagraphXml(shunnRunXml(String(contactLine), ""), true));
  }
  return lines;
}

function writeShunnDocx(outFile, manuscript, meta, writeOptions = {}) {
  const paragraphs = [...shunnTitlePageXml(meta)];
  for (const chapter of manuscript.chapters) {
    paragraphs.push(shunnChapterHeadingXml(chapterHeading(chapter.number, chapter.title)));
    for (const paragraph of markdownParagraphs(chapter.body)) {
      paragraphs.push(shunnParagraphXml(inlineRuns(paragraph).map(shunnTextRunXml).join(""), false));
    }
  }

  writeZip(outFile, docxPackageEntries(paragraphs.join("")), writeOptions);
}

function writeShunnMarkdown(outFile, manuscript, meta, writeOptions = {}) {
  const lines = [meta.title, "by"];
  if (meta.author) {
    lines.push(meta.author);
  }
  lines.push("", `Approximately ${meta.words} words`, "");
  for (const contactLine of meta.contact) {
    lines.push(String(contactLine));
  }
  for (const chapter of manuscript.chapters) {
    lines.push("\f", `# ${chapterHeading(chapter.number, chapter.title)}`, "");
    for (const paragraph of markdownParagraphs(chapter.body)) {
      lines.push(paragraph, "");
    }
  }

  writeFile(outFile, `${lines.join("\n").trimEnd()}\n`, writeOptions);
}

function paragraphXml(text, style = "", runs = [{ text }]) {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  const runXml = runs.map((run) => {
    const decoration = `${run.strong ? "<w:b/>" : ""}${run.em ? "<w:i/>" : ""}`;
    const runStyle = decoration === "" ? "" : `<w:rPr>${decoration}</w:rPr>`;
    return `<w:r>${runStyle}<w:t xml:space="preserve">${xmlEscape(run.text)}</w:t></w:r>`;
  });
  return `<w:p>${styleXml}${runXml.join("")}</w:p>`;
}

// Markdown emphasis: **bold** / __bold__, *italic* / _italic_, and both
// nested (***both***, *a **b** c*), following the CommonMark delimiter rules:
// a run opens when it is left-flanking and closes when right-flanking, an
// underscore inside a word is literal, and a backslash escapes punctuation.
// Returns runs of { text, strong, em }.
function inlineRuns(text) {
  const nodes = [];
  let buffer = "";
  const isSpace = (char) => char === undefined || /\s/u.test(char);
  const isPunct = (char) => char !== undefined && /[\p{P}\p{S}]/u.test(char);
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (char === "\\" && /[!-/:-@[-`{-~]/.test(text[index + 1] ?? "")) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }
    if (char !== "*" && char !== "_") {
      buffer += char;
      index += 1;
      continue;
    }
    let end = index;
    while (text[end] === char) {
      end += 1;
    }
    if (buffer !== "") {
      nodes.push({ text: buffer });
      buffer = "";
    }
    const before = text[index - 1];
    const after = text[end];
    const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
    const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
    nodes.push({
      delimiter: char,
      count: end - index,
      original: end - index,
      open: char === "*" ? left : left && (!right || isPunct(before)),
      close: char === "*" ? right : right && (!left || isPunct(after)),
      strong: 0,
      em: 0
    });
    index = end;
  }
  if (buffer !== "") {
    nodes.push({ text: buffer });
  }

  // The CommonMark delimiter stack: openers wait on `stack`; a closer pairs
  // with the nearest usable opener and drops every delimiter between them.
  // `bottom` remembers, per kind of closer, how far down a search already
  // failed, so unmatched delimiters are not rescanned. Emphasis depth is
  // recorded as +1/-1 marks and summed once, so each pair costs O(1).
  const stack = [];
  const bottom = new Map();
  const depth = { strong: new Array(nodes.length + 1).fill(0), em: new Array(nodes.length + 1).fill(0) };
  for (const [closeIndex, closer] of nodes.entries()) {
    if (!closer.delimiter) {
      continue;
    }
    const key = `${closer.delimiter}${closer.open ? 1 : 0}${closer.original % 3}`;
    while (closer.close && closer.count > 0) {
      const floor = bottom.get(key) ?? 0;
      let position = stack.length - 1;
      while (position >= floor && !canPairEmphasis(nodes[stack[position]], closer)) {
        position -= 1;
      }
      if (position < floor) {
        bottom.set(key, stack.length);
        break;
      }
      const openIndex = stack[position];
      const opener = nodes[openIndex];
      const used = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
      opener.count -= used;
      closer.count -= used;
      const marks = depth[used === 2 ? "strong" : "em"];
      marks[openIndex + 1] += 1;
      marks[closeIndex] -= 1;
      // Delimiters between the pair can no longer pair outward.
      stack.length = opener.count > 0 ? position + 1 : position;
      for (const [other, value] of bottom) {
        if (value > stack.length) {
          bottom.set(other, stack.length);
        }
      }
    }
    if (closer.open && closer.count > 0) {
      stack.push(closeIndex);
    }
  }
  let strongDepth = 0;
  let emDepth = 0;
  for (const [index, node] of nodes.entries()) {
    strongDepth += depth.strong[index];
    emDepth += depth.em[index];
    node.strong = strongDepth;
    node.em = emDepth;
  }

  const runs = [];
  for (const node of nodes) {
    const value = node.delimiter ? node.delimiter.repeat(node.count) : node.text;
    if (value === "") {
      continue;
    }
    const strong = (node.strong ?? 0) > 0;
    const em = (node.em ?? 0) > 0;
    const previous = runs[runs.length - 1];
    if (previous && previous.strong === strong && previous.em === em) {
      previous.text += value;
    } else {
      runs.push({ text: value, strong, em });
    }
  }
  return runs;
}

// Openers on the stack can open and have characters left, so only the
// delimiter and CommonMark's rule of three decide: in *foo**bar* the **
// cannot close the *.
function canPairEmphasis(opener, closer) {
  const both = opener.close || closer.open;
  const ruleOfThree = both && (opener.original + closer.original) % 3 === 0 && !(opener.original % 3 === 0 && closer.original % 3 === 0);
  return opener.delimiter === closer.delimiter && !ruleOfThree;
}

// HTML or XHTML markup for one run; `escape` is the matching text escaper.
function runMarkup(run, escape) {
  let markup = escape(run.text);
  if (run.em) {
    markup = `<em>${markup}</em>`;
  }
  if (run.strong) {
    markup = `<strong>${markup}</strong>`;
  }
  return markup;
}

// A thematic break: three or more of the same marker, optionally spaced.
function markdownParagraphs(markdown) {
  const paragraphs = [];
  // Normalize CRLF and treat whitespace-only lines as blank, matching
  // CommonMark paragraph breaks.
  for (const paragraph of markdown
    .replace(/\r\n?/g, "\n")
    // A backslash at a line end is a hard line break; the lines join.
    .replace(/\\\n/g, "\n")
    .replace(/^#+[ \t]+/gm, "")
    // Blockquote markers flatten like headings, so a quoted epigraph or
    // letter reads as text rather than a literal ">".
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .split(/\n[ \t]*\n\s*/)) {
    const trimmed = paragraph.replace(/\s+/g, " ").trim();
    if (trimmed) {
      paragraphs.push(isSceneBreak(trimmed) ? "* * *" : trimmed);
    }
  }
  return paragraphs;
}

// Every entry is stamped 1980-01-01 00:00, the earliest valid MS-DOS date
// (day and month are 1-based, so an all-zero field is invalid), which keeps
// builds byte-identical.
const ZIP_DOS_DATE = (0 << 9) | (1 << 5) | 1;

function writeZip(outFile, entries, writeOptions = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const crc = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(ZIP_DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(ZIP_DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + content.length;
  }

  let centralSize = 0;
  for (const part of centralParts) {
    centralSize += part.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  writeFile(outFile, Buffer.concat(localParts.concat(centralParts, end)), writeOptions);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = [];
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE.push(value >>> 0);
}

// XML 1.0 forbids most C0 control characters, U+FFFE, U+FFFF, and unpaired
// surrogates even when escaped, so they are dropped.
const XML_INVALID_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function xmlEscape(value) {
  return String(value)
    .replace(XML_INVALID_CHARACTERS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MAX_SCAN_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SCAN_FILES = 5000;
const MAX_SCAN_DEPTH = 10;

// For binary files such as the cover; text files go through readTextFile.
function assertFileSizeWithinLimit(filePath) {
  const size = fs.statSync(filePath).size;
  if (size > MAX_SCAN_FILE_BYTES) {
    throw new Error('Refusing to read oversized file ' + filePath + ': ' + size + ' bytes exceeds the ' + MAX_SCAN_FILE_BYTES + ' byte limit');
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
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== '_index.md')
    .map((entry) => entry.name)
    .sort();
  if (files.length > MAX_SCAN_FILES) {
    throw new Error('Too many files in ' + relativeDir + ': ' + files.length + ' exceeds the ' + MAX_SCAN_FILES + ' file limit');
  }
  for (const file of files) {
    const fullPath = path.join(directory, file);
    const label = path.join(relativeDir, file);
    try {
      const markdown = readMarkdown(fullPath, root);
      entities.push(mapEntity(path.basename(file, ".md"), fullPath, markdown.data, markdown));
    } catch (error) {
      // Every caller passes a scanErrors array, so per-file failures are
      // always collected instead of thrown.
      // Parse errors name the absolute path; the label already names the file.
      const message = error.message.startsWith(`${fullPath} `) ? error.message.slice(fullPath.length + 1) : error.message;
      scanErrors.push(`${label}: ${message}`);
    }
  }
  return entities;
}

function requireStoryFile(projectRoot) {
  const storyPath = path.join(projectRoot, "story.md");
  if (!fs.existsSync(storyPath)) {
    const hint = path.basename(projectRoot).startsWith("-") ? `; ${path.basename(projectRoot)} is not an option (run story help)` : "";
    throw new Error(`${projectRoot} is not a story project: missing story.md${hint}`);
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
    scanErrors.push(`${path.join("continuity", "exemptions.md")}: ${error.message}`);
    return [];
  }

  let data;
  try {
    data = parseFrontmatter(raw, exemptionsPath).data;
  } catch {
    return [];
  }

  if (!Array.isArray(data.exemptions)) {
    return [];
  }

  const exemptions = [];
  for (const entry of data.exemptions) {
    const pattern = entry && typeof entry === "object" && !Array.isArray(entry)
      ? String(entry.pattern ?? "").trim()
      : "";
    // Mirror the validate floor: sub-minimum patterns never take effect at
    // runtime, so a short pattern cannot blanket-exempt findings. validate
    // still reports the entry as an error so the user removes or extends it.
    if (pattern === "" || pattern.length < 4) {
      continue;
    }
    exemptions.push({ pattern, reason: String(entry.reason ?? "") });
  }
  return exemptions;
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
    scanErrors.push(`${name}: ${error.message}`);
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
    scanErrors.push(`${STYLE_SHEET_FILE}: ${error.message}`);
    return null;
  }
}

function readMarkdown(filePath, root) {
  if (root) {
    assertSafeProjectPath(filePath, root);
  }
  const rawMarkdown = readTextFile(filePath);
  try {
    return { ...parseFrontmatter(rawMarkdown, filePath), rawMarkdown };
  } catch (error) {
    // Callers label the file with its project-relative path, so drop the
    // absolute one the parser puts in front.
    throw new Error(error.message.startsWith(`${filePath} `) ? error.message.slice(filePath.length + 1) : error.message);
  }
}

export function writeFile(filePath, contents, options = {}) {
  const target = prepareWriteTarget(filePath, options.root);
  const existing = lstatIfExists(target);
  if (!existing || existing.nlink <= 1) {
    // In place, so the file keeps its permissions and a read-only file
    // stays refused.
    fs.writeFileSync(target, contents, "utf8");
    return;
  }
  // A hard link (to a chapter, say) is replaced with a new file rather than
  // written through, keeping the old file's permissions.
  fs.accessSync(target, fs.constants.W_OK);
  const temporary = path.join(path.dirname(target), `.story-${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporary, contents, { encoding: "utf8", mode: existing.mode & 0o777 });
    fs.chmodSync(temporary, existing.mode & 0o777);
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    // Name the file the user asked for, not the temporary one.
    throw Object.assign(new Error(`Cannot replace hard-linked ${target}: ${error.code ?? error.message}`), { code: error.code, path: target, syscall: "rename" });
  }
}

function writeChanged(filePath, contents, changed, root) {
  if (safeRead(filePath, root) !== contents) {
    writeFile(filePath, contents, { root });
    changed.push(filePath);
  }
}

function safeRead(filePath, root) {
  if (!fs.existsSync(filePath)) {
    return "";
  }

  if (root) {
    assertSafeProjectPath(filePath, root);
  }
  return readTextFile(filePath);
}

function readValidationData(file, root, label, errors) {
  try {
    return readMarkdown(file, root).data;
  } catch (error) {
    const message = `${label}: ${error.message}`;
    if (!errors.includes(message)) {
      errors.push(message);
    }
    return null;
  }
}

const ENTITY_SCAN_DIRS = [
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

function entityFileNames(root, relativeDir) {
  const directory = path.join(root, relativeDir);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory).filter((name) => name.endsWith(".md") && name !== "_index.md").sort().map((name) => path.join(relativeDir, name));
}

function collectStrayFileWarnings(project, warnings) {
  const root = project.root;
  // The root was already proven readable by the scan, so this cannot fail.
  const topEntries = fs.readdirSync(root, { withFileTypes: true });
  const strayTop = [];
  for (const entry of topEntries) {
    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "story.md" && entry.name !== STYLE_SHEET_FILE && entry.name !== PROGRESS_FILE) {
      strayTop.push(entry.name);
    }
  }
  strayTop.sort();
  for (const name of strayTop) {
    warnings.push(`${name} is not part of the story project model and is ignored`);
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
        nested.push(path.join(relativeDir, relativePath));
      }
    }
  }
  nested.sort();
  for (const nestedPath of nested) {
    warnings.push(`${nestedPath} is nested inside an entity directory and is ignored`);
  }
}

function checkIdReference(errors, label, value, kind, exists) {
  const text = String(value ?? "");
  if (text === "") {
    return;
  }
  if (text !== kebabCase(text)) {
    errors.push(`${label} references ${kind} ${text} which must be kebab-case`);
    return;
  }
  if (!exists(text)) {
    errors.push(`${label} references missing ${kind} ${text}`);
  }
}

function extractChapterIdTokens(body) {
  const found = [];
  const pattern = /\bchapter-\d+\b/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    found.push(match[0]);
  }
  return found;
}

function extractMarkdownLinkTargets(body) {
  const targets = [];
  const pattern = /\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const target = match[1].trim();
    if (target && !/^(https?:|mailto:|#)/i.test(target)) {
      targets.push(target.split("#")[0].split("?")[0]);
    }
  }
  return targets;
}

// Build artifacts are named after the story id; keep the name well inside
// file-system limits (255 bytes) for very long titles.
function fileStem(storyId) {
  if (storyId.length <= 100) {
    return storyId;
  }
  const cut = storyId.slice(0, 100);
  return cut.slice(0, cut.lastIndexOf("-") > 0 ? cut.lastIndexOf("-") : 100);
}

// Paths that hold project source. Generated output must never land there:
// an --out pointing at a chapter would silently replace the prose.
const SOURCE_ROOT_FILES = new Set(["story.md", STYLE_SHEET_FILE, PROGRESS_FILE]);
const SOURCE_DIRECTORIES = ["characters", "chapters", "scenes", "worldbuilding", "plot", "continuity", "glossary", MATTER_DIR, RESEARCH_DIR];

function assertNotProjectSource(project, outFile) {
  // Check the path as typed and the real path behind any symlinked folder
  // (`lnk -> chapters`), case-insensitively for case-insensitive disks,
  // where `/users/me/book` can name the project at `/Users/me/Book`.
  const realRoot = fs.realpathSync.native(project.root);
  const realTarget = realPathThroughAncestors(outFile);
  const candidates = [[project.root, outFile], [realRoot, realTarget], [realRoot.toLowerCase(), realTarget.toLowerCase()]];
  for (const [root, target] of candidates) {
    const relativePath = path.relative(root, target);
    if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      continue;
    }
    const lower = relativePath.toLowerCase();
    const [first] = lower.split(path.sep);
    if (SOURCE_ROOT_FILES.has(lower) || SOURCE_DIRECTORIES.includes(first)) {
      throw new Error(`Refusing to write generated output to ${path.relative(project.root, outFile)}: it is project source. Use a path such as dist/ instead`);
    }
  }
}

// The real path of the nearest existing ancestor, with the missing tail
// appended, so a new file under a symlinked folder resolves to its target.
// The walk stops at the latest at the filesystem root, which always exists.
function realPathThroughAncestors(target) {
  const missing = [];
  let current = target;
  while (!fs.existsSync(current)) {
    missing.unshift(path.basename(current));
    current = path.dirname(current);
  }
  return path.join(fs.realpathSync.native(current), ...missing);
}

function resolveOutputPath(project, out, defaultRelativePath, enforceRoot) {
  const rawOut = out ?? defaultRelativePath;
  const outFile = path.resolve(project.root, rawOut);
  const shouldEnforceRoot = enforceRoot ?? !path.isAbsolute(String(rawOut));
  assertNotProjectSource(project, outFile);
  if (lstatIfExists(outFile)?.isDirectory() || outFile === path.join(project.root, "dist")) {
    throw new Error(`--out ${rawOut} is a directory: give a file path`);
  }
  return {
    outFile,
    enforceRoot: shouldEnforceRoot,
    writeOptions: shouldEnforceRoot ? { root: project.root } : {}
  };
}

function prepareWriteTarget(filePath, root) {
  const target = path.resolve(filePath);
  if (root) {
    assertLexicallyInsideRoot(target, root);
    assertExistingAncestorInsideRoot(path.dirname(target), root);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (root) {
    assertSafeProjectParent(target, root);
  }

  rejectSymlinkTarget(target, "write");
  return target;
}

function assertSafeProjectPath(filePath, root) {
  const target = path.resolve(filePath);
  assertLexicallyInsideRoot(target, root);
  assertSafeProjectParent(target, root);
  rejectSymlinkTarget(target, "read");
}

function assertSafeProjectDirectory(directory, root) {
  const target = path.resolve(directory);
  assertLexicallyInsideRoot(target, root);
  const stats = lstatIfExists(target);

  if (stats) {
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to use symlinked project directory: ${target}`);
    }

    if (!stats.isDirectory()) {
      throw new Error(`Project path is not a directory: ${target}`);
    }
  }

  const rootReal = fs.realpathSync(path.resolve(root));
  const directoryReal = fs.realpathSync(target);
  if (!isPathInside(rootReal, directoryReal)) {
    throw new Error(`Refusing to use project directory outside root: ${target}`);
  }
}

function assertSafeProjectParent(filePath, root) {
  const rootReal = fs.realpathSync(path.resolve(root));
  const parentReal = fs.realpathSync(path.dirname(path.resolve(filePath)));
  if (!isPathInside(rootReal, parentReal)) {
    throw new Error(`Refusing to access project path outside root: ${filePath}`);
  }
}

// Resolves the nearest existing ancestor of a path that may not exist yet and
// confirms it stays inside the root, so a symlinked intermediate directory
// cannot make a recursive mkdir create directories outside the project.
function assertExistingAncestorInsideRoot(target, root) {
  let current = path.resolve(target);
  while (!lstatIfExists(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  let rootReal;
  let currentReal;
  try {
    rootReal = fs.realpathSync(path.resolve(root));
    currentReal = fs.realpathSync(current);
  } catch {
    throw new Error(`Refusing to access project path outside root: ${target}`);
  }
  if (!isPathInside(rootReal, currentReal)) {
    throw new Error(`Refusing to access project path outside root: ${target}`);
  }
}

function assertLexicallyInsideRoot(filePath, root) {
  const rootPath = path.resolve(root);
  const target = path.resolve(filePath);
  if (!isPathInside(rootPath, target)) {
    throw new Error(`Refusing to access path outside project root: ${target}`);
  }
}

function rejectSymlinkTarget(filePath, action) {
  if (lstatIfExists(filePath)?.isSymbolicLink()) {
    throw new Error(`Refusing to ${action} through symlink: ${filePath}`);
  }
}

function lstatIfExists(filePath) {
  return fs.lstatSync(filePath, { throwIfNoEntry: false }) ?? null;
}

function isPathInside(root, target) {
  const relativePath = path.relative(root, target);
  return !path.isAbsolute(relativePath) && (relativePath === "" || !relativePath.split(path.sep).includes(".."));
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [value];
}

function normalizeList(value, fallback) {
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

const BUILD_EXTENSIONS = {
  markdown: "md",
  epub: "epub",
  docx: "docx",
  shunn: "shunn.md",
  html: "html",
  print: "print.html",
  narration: "narration.md",
  metadata: "metadata.md"
};

function normalizeBuildFormat(value) {
  const format = String(value).trim().toLowerCase();
  if (format === "markdown" || format === "md") {
    return "markdown";
  }

  if (Object.prototype.hasOwnProperty.call(BUILD_EXTENSIONS, format)) {
    return format;
  }

  throw new Error(`Unsupported build format: ${value === "" ? "(empty)" : value}. Supported formats: ${Object.keys(BUILD_EXTENSIONS).join(", ")}`);
}

// With story.md unreadable or untitled, the story id is only the folder name,
// so comparing every registry's `story` with it would repeat one problem.
function storyIdIsFallback(project) {
  return Boolean(project.story.unreadable) || kebabCase(String(project.story.data.title ?? "")) === "";
}

function validateStoryFrontmatter(project, errors) {
  // An unreadable story.md is already reported; checking the stand-in data
  // would only add a missing-field error per field.
  if (project.story.unreadable) {
    return;
  }
  const data = project.story.data;
  requireFields(data, ["title", "schema-version", "genre", "status", "themes", "pov", "tense"], "story.md", errors);
  requireScalar(data, "title", "story.md", errors);
  requireScalar(data, "genre", "story.md", errors);
  requireScalar(data, "status", "story.md", errors);
  requireArray(data, "themes", "story.md", errors);
  requireScalar(data, "pov", "story.md", errors);
  requireScalar(data, "tense", "story.md", errors);
  validateEnum(data, "status", STORY_STATUSES, "story.md", errors);
  validateEnum(data, "tense", STORY_TENSES, "story.md", errors);
  requireScalar(data, "series", "story.md", errors);
  if (data.series !== undefined && !isKebabId(data.series)) {
    errors.push("story.md series must be a kebab-case id");
  }
  if (data["book-number"] !== undefined && (!Number.isInteger(data["book-number"]) || data["book-number"] <= 0)) {
    errors.push("story.md book-number must be a positive integer");
  }
  validateStringArray(data, "follows", "story.md", errors);
  validateStringArray(data, "precedes", "story.md", errors);
  if (data["season-goal"] !== undefined) {
    requireScalar(data, "season-goal", "story.md", errors);
  }
  if (data["target-words"] !== undefined) {
    requireInteger(data, "target-words", "story.md", errors, 1);
  }
  validateEnum(data, "form", STORY_FORMS, "story.md", errors);
  if (data["draft-mode"] !== undefined) {
    requireScalar(data, "draft-mode", "story.md", errors);
  }
  validateCover(project, errors);
  validatePasses(data, "story.md", errors);
  if (data.deadline !== undefined) {
    // progress reads only string deadlines, so anything else must fail here
    // rather than silently switching the deadline off.
    const deadlineError = typeof data.deadline === "string" && data.deadline.trim() !== "" ? storyDateError(data.deadline) : "must be a YYYY-MM-DD date";
    if (deadlineError !== "") {
      errors.push(`story.md deadline ${deadlineError}`);
    }
  }

  if (data["schema-version"] !== undefined && data["schema-version"] !== STORY_SCHEMA_VERSION) {
    errors.push(`story.md schema-version must be ${STORY_SCHEMA_VERSION}`);
  }
}

function validatePronunciations(project, errors) {
  const entities = [project.characters, project.locations, project.factions, project.artifacts, project.glossaryTerms].flat();
  for (const entity of entities) {
    if (entity.pronunciation !== undefined && typeof entity.pronunciation !== "string") {
      errors.push(`${relative(project, entity.file)} frontmatter field pronunciation must be text`);
    }
  }
}

function validateFormRange(project, warnings) {
  const data = project.story.data;
  const targetWarning = formRangeWarning(data.form, data["target-words"], "story.md target-words");
  if (targetWarning !== "") {
    warnings.push(targetWarning);
  }
  if (data.status === "complete") {
    const words = project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
    const wordsWarning = formRangeWarning(data.form, words, "Manuscript length");
    if (wordsWarning !== "") {
      warnings.push(wordsWarning);
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
    const data = readValidationData(path.join(project.root, relativePath), project.root, label, errors);
    if (!data) {
      continue;
    }
    requireFields(data, ["type", "story"], label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "story", label, errors);

    if (data.type !== undefined && data.type !== expectedType) {
      errors.push(`${label} type must be ${expectedType}`);
    }

    if (data.story !== undefined && data.story !== project.storyId && !storyIdIsFallback(project)) {
      errors.push(`${label} story must be ${project.storyId}`);
    }

    if (relativePath === path.join("plot", "_index.md")) {
      requireFields(data, ["structure"], label, errors);
      requireScalar(data, "structure", label, errors);
    }
  }
}

function validateCharacters(project, errors) {
  for (const character of project.characters) {
    const label = relative(project, character.file);
    const data = readValidationData(character.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(character.id, label, errors);
    requireFields(data, ["name", "role", "status"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "role", label, errors);
    requireScalar(data, "status", label, errors);
    validateEnum(data, "role", CHARACTER_ROLES, label, errors);
    validateEnum(data, "status", CHARACTER_STATUSES, label, errors);
    if (data["died-in"] !== undefined) {
      requireScalar(data, "died-in", label, errors);
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
  }
}

function validateLocations(project, errors) {
  for (const location of project.locations) {
    const label = relative(project, location.file);
    const data = readValidationData(location.file, project.root, label, errors);
    if (!data) {
      continue;
    }
    validateEntityId(location.id, label, errors);
    requireFields(data, ["name", "type"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    validateStringArray(data, "notable-characters", label, errors);
    validateStringArray(data, "tags", label, errors);
    validateObjectArray(data, "routes", label, errors);
    for (const route of Array.isArray(data.routes) ? data.routes : []) {
      if (!route || typeof route !== "object" || Array.isArray(route)) {
        continue;
      }
      if (typeof route.to !== "string" || route.to === "") {
        errors.push(`${label} route is missing to`);
      }
      if (typeof route.hours !== "number" || !Number.isFinite(route.hours) || route.hours <= 0) {
        errors.push(`${label} route to ${route.to ?? "?"} hours must be a positive number`);
      }
      requireScalar(route, "mode", `${label} route to ${route.to ?? "?"}`, errors);
    }
  }
}

function validateSystems(project, errors) {
  for (const system of project.systems) {
    const label = relative(project, system.file);
    const data = readValidationData(system.file, project.root, label, errors);
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

function validateFactions(project, errors) {
  for (const faction of project.factions) {
    const label = relative(project, faction.file);
    const data = readValidationData(faction.file, project.root, label, errors);
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
  }
}

function validateArtifacts(project, errors) {
  for (const artifact of project.artifacts) {
    const label = relative(project, artifact.file);
    const data = readValidationData(artifact.file, project.root, label, errors);
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

function validateArcs(project, errors) {
  for (const arc of project.arcs) {
    const label = relative(project, arc.file);
    const data = readValidationData(arc.file, project.root, label, errors);
    if (!data) {
      continue;
    }
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

function validateChapters(project, errors) {
  const seenNumbers = new Map();

  for (const chapter of project.chapters) {
    const label = relative(project, chapter.file);
    const data = readValidationData(chapter.file, project.root, label, errors);
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
    if (data["target-words"] !== undefined) {
      requireInteger(data, "target-words", label, errors, 1);
    }
    if (data.date !== undefined) {
      requireScalar(data, "date", label, errors);
    }
    if (data.time !== undefined) {
      requireScalar(data, "time", label, errors);
    }
    if (data.mode !== undefined) {
      requireScalar(data, "mode", label, errors);
    }
    if (data["episode-question"] !== undefined) {
      requireScalar(data, "episode-question", label, errors);
    }
    if (data["time-skip"] !== undefined) {
      requireScalar(data, "time-skip", label, errors);
    }
    validateEnum(data, "hook", CHAPTER_HOOKS, label, errors);

    if (filenameNumber === 0) {
      errors.push(`${label} filename must match chapter-{NN}.md`);
    } else if (Number.isInteger(data.number) && data.number !== filenameNumber) {
      errors.push(`${label} number must match filename chapter number ${filenameNumber}`);
    }

    if (Number.isInteger(data.number)) {
      if (data.number <= 0) {
        errors.push(`${label} number must be greater than 0`);
      }

      const existing = seenNumbers.get(data.number);
      if (existing) {
        errors.push(`${label} duplicates chapter number ${data.number} from ${existing}`);
      } else {
        seenNumbers.set(data.number, label);
      }
    }
  }
}

function validateScenes(project, errors) {
  const seenKeys = new Map();
  for (const scene of project.scenes) {
    const label = relative(project, scene.file);
    const data = readValidationData(scene.file, project.root, label, errors);
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
    }
    if (data.time !== undefined) {
      requireScalar(data, "time", label, errors);
    }
    if (data.dilemma !== undefined) {
      requireScalar(data, "dilemma", label, errors);
    }
    if (data["travel-hours"] !== undefined && typeof data["travel-hours"] !== "number") {
      errors.push(`${label} frontmatter field travel-hours must be a number`);
    }
    if (data.sequel !== undefined && typeof data.sequel !== "boolean") {
      errors.push(`${label} frontmatter field sequel must be a boolean`);
    }
    validateEnum(data, "outcome", SCENE_OUTCOMES, label, errors);
    if (data["flashback-to"] !== undefined) {
      requireScalar(data, "flashback-to", label, errors);
    }
    if (Number.isInteger(data.scene) && data.scene <= 0) {
      errors.push(`${label} scene must be greater than 0`);
    }

    const filenameMatch = SCENE_FILENAME_PATTERN.exec(path.basename(scene.file));
    if (!filenameMatch) {
      errors.push(`${label} filename must match {chapter}-scene-{NN}.md`);
    } else {
      const [, filenameChapter, filenameSceneText] = filenameMatch;
      const filenameScene = Number.parseInt(filenameSceneText, 10);
      if (typeof data.chapter === "string" && data.chapter !== "" && data.chapter !== filenameChapter) {
        errors.push(`${label} chapter must match filename chapter ${filenameChapter}`);
      }
      if (Number.isInteger(data.scene) && data.scene !== filenameScene) {
        errors.push(`${label} scene must match filename scene number ${filenameScene}`);
      }
    }

    if (typeof data.chapter === "string" && data.chapter !== "" && Number.isInteger(data.scene)) {
      const key = `${data.chapter}::${data.scene}`;
      const existing = seenKeys.get(key);
      if (existing) {
        errors.push(`${label} duplicates scene ${data.scene} of ${data.chapter} from ${existing}`);
      } else {
        seenKeys.set(key, label);
      }
    }
  }
}

function validateContinuityState(project, errors) {
  const label = path.join("continuity", "state.md");
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
  if (data.type !== undefined && data.type !== "continuity-state") {
    errors.push(`${label} type must be continuity-state`);
  }
  if (data.story !== undefined && data.story !== project.storyId && !storyIdIsFallback(project)) {
    errors.push(`${label} story must be ${project.storyId}`);
  }
}

function validateQuestions(project, errors) {
  for (const question of project.questions) {
    const label = relative(project, question.file);
    const data = readValidationData(question.file, project.root, label, errors);
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

function validatePromises(project, errors) {
  for (const promise of project.promises) {
    const label = relative(project, promise.file);
    const data = readValidationData(promise.file, project.root, label, errors);
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

function validateClues(project, errors) {
  for (const clue of project.clues) {
    const label = relative(project, clue.file);
    const data = readValidationData(clue.file, project.root, label, errors);
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
        errors.push(`${label} frontmatter field ${field} must be a boolean`);
      }
    }
  }
}

function validateExemptions(project, errors) {
  const exemptionsPath = path.join(project.root, "continuity", "exemptions.md");
  if (!fs.existsSync(exemptionsPath)) {
    return;
  }

  const label = path.join("continuity", "exemptions.md");
  const data = readValidationData(exemptionsPath, project.root, label, errors);
  if (!data) {
    return;
  }

  if (data.type !== "exemption-log") {
    errors.push(`${label} type must be exemption-log`);
  }

  const entries = data.exemptions;
  if (entries === undefined) {
    errors.push(`${label} is missing frontmatter field exemptions`);
    return;
  }
  if (!Array.isArray(entries)) {
    errors.push(`${label} frontmatter field exemptions must be a list`);
    return;
  }

  for (const [index, entry] of entries.entries()) {
    const entryLabel = `${label} exemptions[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${entryLabel} must be a mapping`);
      continue;
    }
    if (typeof entry.pattern !== "string" || entry.pattern.trim() === "") {
      errors.push(`${entryLabel} is missing a non-empty pattern`);
    } else if (entry.pattern.trim().length < 4) {
      errors.push(`${entryLabel} pattern must be at least 4 characters to avoid blanket exemptions`);
    }
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      errors.push(`${entryLabel} is missing a non-empty reason`);
    }
  }
}

function validateGlossaryTerms(project, errors) {
  for (const term of project.glossaryTerms) {
    const label = relative(project, term.file);
    const data = readValidationData(term.file, project.root, label, errors);
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

function validateStyleSheet(project, errors) {
  if (project.styleSheet === null) {
    return;
  }
  const data = project.styleSheet.data;
  const label = STYLE_SHEET_FILE;
  if (data.type !== "style-sheet") {
    errors.push(`${label} type must be style-sheet`);
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
        errors.push(`${entryLabel} requires a non-empty ${field}`);
      }
    }
    if (typeof entry.use === "string" && typeof entry.avoid === "string"
      && entry.use.trim().toLowerCase() === entry.avoid.trim().toLowerCase()) {
      errors.push(`${entryLabel} use and avoid must differ`);
    }
  });
  validateStringArray(data, "watch-words", label, errors);
  validateStringArray(data, "allow-words", label, errors);
}

function validateProgressLog(project, errors) {
  if (project.progressLog === null) {
    return;
  }
  const data = project.progressLog.data;
  if (data.type !== "progress-log") {
    errors.push(`${PROGRESS_FILE} type must be progress-log`);
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
      errors.push(`${label} ${dateError || "requires a date"}`);
    } else if (seen.has(String(entry.date))) {
      errors.push(`${label} repeats date ${entry.date}`);
    } else {
      seen.add(String(entry.date));
    }
    if (!Number.isInteger(entry.words) || entry.words < 0) {
      errors.push(`${label} words must be a non-negative integer`);
    }
  });
}

function validateOptionalRegistry(project, directory, expectedType, errors) {
  const indexPath = path.join(project.root, directory, "_index.md");
  if (fs.existsSync(indexPath)) {
    const label = path.join(directory, "_index.md");
    const data = readValidationData(indexPath, project.root, label, errors);
    if (data && data.type !== expectedType) {
      errors.push(`${label} type must be ${expectedType}`);
    }
  }
}

function validateResearch(project, errors, warnings) {
  validateOptionalRegistry(project, RESEARCH_DIR, "research-registry", errors);
  const chapterStatus = new Map(project.chapters.map((chapter) => [chapter.id, chapter.status]));
  for (const note of project.research) {
    const label = relative(project, note.file);
    const data = readValidationData(note.file, project.root, label, errors);
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
        errors.push(`${label} risk has unsupported value ${risk}`);
      }
    }
    // Invented facts are the author's to decide, so they need no sources and
    // never hold up a final chapter.
    const invented = note.accuracy === "invented";
    if (!invented && note.status === "verified" && note.sources.length === 0) {
      warnings.push(`${label} is verified but lists no sources`);
    }
    const settled = note.usedIn.filter((chapterId) => SETTLED_CHAPTER_STATUSES.has(chapterStatus.get(chapterId)));
    if (!invented && (note.status === "open" || note.status === "disputed")) {
      for (const chapterId of settled) {
        warnings.push(`${label} is ${note.status} but ${chapterId} relies on it and is ${chapterStatus.get(chapterId)}`);
      }
    }
    if (note.risk.length > 0 && note.reviewedBy.length === 0 && settled.length > 0) {
      warnings.push(`${label} carries ${note.risk.join(", ")} risk but has no reviewed-by, and ${settled.join(", ")} relies on it`);
    }
  }
}

function validateMatter(project, errors, warnings) {
  validateOptionalRegistry(project, MATTER_DIR, "matter-registry", errors);
  for (const matter of project.matter) {
    const label = relative(project, matter.file);
    if (matter.empty) {
      warnings.push(`${label} has no text and is left out of export and build`);
    }
    const data = readValidationData(matter.file, project.root, label, errors);
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
      errors.push(`${label} heading must be true or false`);
    }
    // Quoted material (an epigraph, lyrics, a poem) needs the rights
    // holder's permission before the book is published.
    validateEnum(data, "permission", MATTER_PERMISSIONS, label, errors);
    requireScalar(data, "rights-holder", label, errors);
    requireScalar(data, "credit", label, errors);
    if (data.permission === "pending" && project.story.data.status === "complete") {
      warnings.push(`${label} permission is still pending and the story is complete`);
    }
    if (data.permission === "granted" && (typeof data["rights-holder"] !== "string" || data["rights-holder"].trim() === "")) {
      warnings.push(`${label} permission is granted but no rights-holder is recorded`);
    }
  }
}

function validateCover(project, errors) {
  const cover = project.story.data.cover;
  if (cover === undefined) {
    return;
  }
  if (typeof cover !== "string" || cover.trim() === "") {
    errors.push("story.md cover must be a path to an image file");
    return;
  }
  try {
    coverImage(project);
  } catch (error) {
    errors.push(error.message);
  }
}

// Resolves story.md `cover` to an image inside the project. Throws with a
// story.md-prefixed message so validate and build report the same problem.
function coverImage(project) {
  const cover = String(project.story.data.cover).trim();
  const mediaType = COVER_MEDIA_TYPES[path.extname(cover).toLowerCase()];
  if (mediaType === undefined) {
    throw new Error(`story.md cover ${cover} must be a ${Object.keys(COVER_MEDIA_TYPES).join(", ")} image`);
  }
  const filePath = path.resolve(project.root, cover);
  if (!isPathInside(project.root, filePath)) {
    throw new Error(`story.md cover ${cover} must be inside the project`);
  }
  if (!lstatIfExists(filePath)?.isFile()) {
    throw new Error(`story.md cover ${cover} does not exist`);
  }
  assertSafeProjectPath(filePath, project.root);
  assertFileSizeWithinLimit(filePath);
  return { filePath, mediaType, extension: mediaType === "image/jpeg" ? "jpg" : path.extname(cover).slice(1).toLowerCase() };
}

function validateEntityId(id, label, errors) {
  if (id !== kebabCase(id)) {
    errors.push(`${label} filename id must be kebab-case`);
  }
}

function requireScalar(data, field, label, errors) {
  if (data[field] !== undefined && (Array.isArray(data[field]) || typeof data[field] === "object")) {
    errors.push(`${label} frontmatter field ${field} must be a scalar`);
  }
}

function requireArray(data, field, label, errors) {
  if (data[field] !== undefined && !Array.isArray(data[field])) {
    errors.push(`${label} frontmatter field ${field} must be a list`);
  }
}

function requireInteger(data, field, label, errors, minimum) {
  if (data[field] === undefined) {
    return;
  }
  if (!Number.isInteger(data[field])) {
    errors.push(`${label} frontmatter field ${field} must be an integer`);
  } else if (minimum !== undefined && data[field] < minimum) {
    errors.push(`${label} frontmatter field ${field} must be at least ${minimum}`);
  }
}

function validateStringArray(data, field, label, errors) {
  if (data[field] === undefined) {
    return;
  }

  if (!Array.isArray(data[field])) {
    errors.push(`${label} frontmatter field ${field} must be a list`);
    return;
  }

  for (const item of data[field]) {
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(`${label} frontmatter field ${field} must contain only non-empty strings`);
    }
  }
}

function validateObjectArray(data, field, label, errors) {
  if (data[field] === undefined) {
    return;
  }

  if (!Array.isArray(data[field])) {
    errors.push(`${label} frontmatter field ${field} must be a list`);
    return;
  }

  for (const item of data[field]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${label} frontmatter field ${field} must contain objects`);
    }
  }
}

function validateRelationships(data, label, errors) {
  if (data.relationships === undefined) {
    return;
  }

  if (!Array.isArray(data.relationships)) {
    errors.push(`${label} frontmatter field relationships must be a list`);
    return;
  }

  for (const relationship of data.relationships) {
    if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
      errors.push(`${label} frontmatter field relationships must contain objects`);
      continue;
    }

    if (typeof relationship.character !== "string" || relationship.character.trim() === "") {
      errors.push(`${label} relationship is missing character`);
    } else if (relationship.character !== kebabCase(relationship.character)) {
      errors.push(`${label} relationship character ${relationship.character} must be kebab-case`);
    }

    if (typeof relationship.type !== "string" || relationship.type.trim() === "") {
      errors.push(`${label} relationship to ${relationship.character ?? "unknown"} is missing type`);
    }
  }
}

function validateEnum(data, field, allowed, label, errors) {
  if (Array.isArray(data[field])) {
    // requireScalar may already have reported the same field.
    const message = `${label} frontmatter field ${field} must be a single value, not a list`;
    if (!errors.includes(`${label} frontmatter field ${field} must be a scalar`)) {
      errors.push(message);
    }
  } else if (data[field] !== undefined && !allowed.has(data[field])) {
    errors.push(`${label} frontmatter field ${field} has unsupported value ${data[field]}`);
  }
}

function inverseRelationshipTypes(type) {
  if (RELATIONSHIP_INVERSES.has(type)) {
    return RELATIONSHIP_INVERSES.get(type);
  }

  return SYMMETRIC_RELATIONSHIPS.has(type) ? [type] : [];
}

function formatCheck(result) {
  const status = result.ok ? "ok" : "failed";
  return `${status} (${result.errors.length} errors, ${result.warnings.length} warnings)`;
}

function requireFields(data, fields, label, errors) {
  for (const field of fields) {
    if (data[field] === undefined || data[field] === "") {
      errors.push(`${label} is missing frontmatter field ${field}`);
    }
  }
}

const CHAPTER_FILENAME_PATTERN = /^chapter-(\d+)\.md$/;
const SCENE_FILENAME_PATTERN = /^(.+)-scene-(\d+)\.md$/;

function isPositiveIntegerValue(value) {
  const number = Number(value);
  return value !== "" && value !== null && typeof value !== "boolean" && Number.isInteger(number) && number > 0;
}

function chapterNumber(value, file) {
  return value !== undefined && isPositiveIntegerValue(value) ? Number(value) : chapterNumberFromFile(file);
}

function chapterNumberFromFile(file) {
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

function relative(project, file) {
  return path.relative(project.root, file);
}

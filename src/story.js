import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkContinuity, storyDateError, storyTimeError } from "./continuity.js";
import { FRONTMATTER_PATTERN, parseFrontmatter, replaceFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { chapterProse, escapeRegExp, extractSection, kebabCase, titleCaseSlug, wordCount } from "./markdown.js";
import { buildTimeline } from "./timeline.js";
import { buildClueMatrix } from "./clues.js";
import { buildDiagram } from "./diagram.js";
import { buildVoices } from "./voices.js";
import { checkNames, existingNames } from "./names.js";
import { STORY_FORMS, formRangeWarning } from "./forms.js";
import { copyrightPage, metadataSheet, publishingMeta, validatePublishing } from "./publishing.js";
import { DEFAULT_TRIM, escapeHtml, estimatePages, printHtml, reviewHtml } from "./html.js";
import { narrationScript, pronunciationGuide } from "./narration.js";
import { DEFAULT_PASSES, nextPass, readPasses, updatePasses, validatePasses } from "./passes.js";
import { CHAPTER_HOOKS, SCENE_OUTCOMES, buildPacing } from "./pacing.js";
import { compareChapters, proseParagraphs } from "./compare.js";
import { PROGRESS_FILE, cleanSessions, computeProgress, localDate, withSession } from "./progress.js";
import { analyzeChapter, chapterFindings, proseRules, repeatedPhrases, similarNames } from "./prose.js";
import { buildSeries, readBookFrontmatter, seriesLinkPath, validateSeriesLinks, withSeriesBacklink } from "./series.js";

export const STORY_SCHEMA_VERSION = 2;

const REQUIRED_PATHS = [
  "story.md",
  "characters/_index.md",
  "worldbuilding/_index.md",
  "worldbuilding/locations",
  "worldbuilding/systems",
  "worldbuilding/factions",
  "worldbuilding/artifacts",
  "plot/_index.md",
  "plot/arcs",
  "plot/timeline.md",
  "chapters/_index.md",
  "scenes/_index.md",
  "continuity/state.md",
  "continuity/questions/_index.md",
  "continuity/questions",
  "continuity/promises/_index.md",
  "continuity/promises",
  "continuity/clues/_index.md",
  "continuity/clues",
  "glossary/_index.md",
  "glossary/terms"
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
  ["subordinate", ["employer"]]
]);

const SYMMETRIC_RELATIONSHIPS = new Set([
  "sibling",
  "spouse",
  "partner",
  "friend",
  "ally",
  "rival",
  "enemy",
  "cousin",
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

  const storyId = kebabCase(title);
  const cwd = options.cwd ?? process.cwd();
  if (!storyId) {
    // Registries record the story id derived from the title, so a title with
    // no kebab-case form can never validate, even with an explicit --dir.
    throw new Error('Cannot derive a story id from title "' + title + '": use a title containing ASCII letters or digits');
  }
  const root = path.resolve(cwd, options.dir ?? storyId);
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
  fs.mkdirSync(path.join(root, "characters"), { recursive: true });
  fs.mkdirSync(path.join(root, "worldbuilding", "locations"), { recursive: true });
  fs.mkdirSync(path.join(root, "worldbuilding", "systems"), { recursive: true });
  fs.mkdirSync(path.join(root, "worldbuilding", "factions"), { recursive: true });
  fs.mkdirSync(path.join(root, "worldbuilding", "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(root, "plot", "arcs"), { recursive: true });
  fs.mkdirSync(path.join(root, "chapters"), { recursive: true });
  fs.mkdirSync(path.join(root, "scenes"), { recursive: true });
  fs.mkdirSync(path.join(root, "continuity", "questions"), { recursive: true });
  fs.mkdirSync(path.join(root, "continuity", "promises"), { recursive: true });
  fs.mkdirSync(path.join(root, "continuity", "clues"), { recursive: true });
  fs.mkdirSync(path.join(root, "glossary", "terms"), { recursive: true });

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
    const updated = withSeriesBacklink(book.root, book.inverse, root);
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

export function scanProject(root) {
  const projectRoot = path.resolve(root);
  const scanErrors = [];
  const storyPath = requireStoryFile(projectRoot);
  let story;
  try {
    story = readMarkdown(storyPath, projectRoot);
  } catch (error) {
    scanErrors.push(`story.md: ${error.message}`);
    story = { data: { title: path.basename(projectRoot) }, body: "", rawMarkdown: "" };
  }
  const storyId = kebabCase(story.data.title ?? path.basename(projectRoot));

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
      number: Number(data.number ?? chapterNumberFromFile(file) ?? 0),
      pov: data.pov ?? "",
      status: data.status ?? "",
      characters: asArray(data.characters),
      mentions: asArray(data.mentions),
      locations: asArray(data.locations),
      arcsAdvanced: asArray(data["arcs-advanced"]),
      declaredWordCount: Number(data["word-count"] ?? 0),
      targetWords: Number.isInteger(data["target-words"]) && data["target-words"] > 0 ? data["target-words"] : 0,
      wordCount: wordCount(chapterProse(markdown.body)),
      date: String(data.date ?? ""),
      time: String(data.time ?? ""),
      mode: String(data.mode ?? ""),
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
      significanceDelayed: Boolean(data["significance-delayed"] ?? false),
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
      empty: chapterProse(markdown.body).trim() === ""
    }), scanErrors).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, "en")),
    exemptions: readExemptions(projectRoot),
    styleSheet: readStyleSheet(projectRoot, scanErrors),
    progressLog: readOptionalRootFile(projectRoot, PROGRESS_FILE, scanErrors),
    continuity
  };
}

export function validateProject(root) {
  const projectRoot = path.resolve(root);
  const errors = [];
  const warnings = [];

  for (const requiredPath of REQUIRED_PATHS) {
    if (!fs.existsSync(path.join(projectRoot, requiredPath))) {
      errors.push(`Missing required path: ${requiredPath}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  return validateProjectOf(scanProject(projectRoot));
}

export function validateProjectOf(project) {
  const errors = [];
  const warnings = [];
  const projectRoot = project.root;
  for (const requiredPath of REQUIRED_PATHS) {
    if (!fs.existsSync(path.join(projectRoot, requiredPath))) {
      errors.push(`Missing required path: ${requiredPath}`);
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
    if (chapter.declaredWordCount !== chapter.wordCount) {
      warnings.push(`${path.relative(projectRoot, chapter.file)} declares ${chapter.declaredWordCount} words but contains ${chapter.wordCount}`);
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
          if (!matched) {
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
    for (const chapterId of note.usedIn) {
      checkIdReference(errors, label, chapterId, "chapter", hasChapter);
    }
  }

  for (const question of project.questions) {
    const label = relative(project, question.file);
    for (const chapterId of [question.introduced, question.resolved].filter(Boolean)) {
      checkIdReference(errors, label, chapterId, "chapter", hasChapter);
    }
    for (const characterId of question.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }

  for (const promise of project.promises) {
    const label = relative(project, promise.file);
    for (const chapterId of [promise.planted, promise.payoff].filter(Boolean)) {
      checkIdReference(errors, label, chapterId, "chapter", hasChapter);
    }
    for (const arcId of promise.arcs) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
    for (const characterId of promise.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }

  for (const clue of project.clues) {
    const label = relative(project, clue.file);
    for (const chapterId of [clue.planted, clue.payoff].filter(Boolean)) {
      checkIdReference(errors, label, chapterId, "chapter", hasChapter);
    }
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
      assertFileSizeWithinLimit(timelinePath);
      const raw = fs.readFileSync(timelinePath, "utf8");
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
    throw new Error(`Unknown character ${characterId}`);
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
  return buildSeries(projectRoot, scanProject);
}

export function projectReport(root) {
  const project = scanProject(root);
  const validation = validateProjectOf(project);
  const links = validateLinksOf(project);
  const continuity = checkContinuity(project);
  const totalWords = project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);

  return {
    root: project.root,
    title: project.story.data.title,
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
    actions: buildProjectActions(project, validation, links, continuity)
  };
}

export function formatProjectReport(report, options = {}) {
  const lines = [
    `# ${report.title}`,
    "",
    `Story ID: ${report.storyId}`,
    `Schema version: ${report.schemaVersion}`,
    ...(report.series === undefined ? [] : [`Series: ${report.series}${report.bookNumber === undefined ? "" : ` (book ${report.bookNumber})`}`]),
    `Status: ${report.status}`,
    `Genre: ${[report.genre, report.subGenre].filter(Boolean).join(" / ")}`,
    ...(report.form ? [`Form: ${report.form}`] : []),
    `POV/Tense: ${report.pov} / ${report.tense}`,
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

export function projectActions(root) {
  const project = scanProject(root);
  const validation = validateProjectOf(project);
  const links = validateLinksOf(project);
  const continuity = checkContinuity(project);
  return {
    root: project.root,
    title: project.story.data.title,
    storyId: project.storyId,
    actions: buildProjectActions(project, validation, links, continuity),
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
  const changed = [];
  const charactersIndexPath = path.join(project.root, "characters", "_index.md");
  const worldIndexPath = path.join(project.root, "worldbuilding", "_index.md");
  const plotIndexPath = path.join(project.root, "plot", "_index.md");
  const chaptersIndexPath = path.join(project.root, "chapters", "_index.md");
  const scenesIndexPath = path.join(project.root, "scenes", "_index.md");
  const questionsIndexPath = path.join(project.root, "continuity", "questions", "_index.md");
  const promisesIndexPath = path.join(project.root, "continuity", "promises", "_index.md");
  const cluesIndexPath = path.join(project.root, "continuity", "clues", "_index.md");
  const glossaryIndexPath = path.join(project.root, "glossary", "_index.md");
  const existingCharacters = safeRead(charactersIndexPath, project.root);
  const existingWorld = safeRead(worldIndexPath, project.root);
  const existingPlot = safeRead(plotIndexPath, project.root);
  let plotStructure = 'three-act';
  if (fs.existsSync(plotIndexPath)) {
    plotStructure = parseFrontmatter(existingPlot, 'plot/_index.md').data.structure ?? 'three-act';
  }

  writeChanged(charactersIndexPath, characterIndex(
    project.storyId,
    project.characters,
    extractSection(existingCharacters, "Relationship Map"),
    extractSection(existingCharacters, "Family Trees")
  ), changed, project.root);
  writeChanged(worldIndexPath, worldIndex(
    project.storyId,
    project.locations,
    project.systems,
    project.factions,
    project.artifacts,
    extractSection(existingWorld, "World Overview")
  ), changed, project.root);
  writeChanged(plotIndexPath, plotIndex(
    project.storyId,
    plotStructure,
    project.arcs,
    extractSection(existingPlot, "Story Structure"),
    extractSection(existingPlot, "Theme Tracking")
  ), changed, project.root);
  writeChanged(chaptersIndexPath, chapterIndex(project.storyId, project.chapters), changed, project.root);
  writeChanged(scenesIndexPath, sceneIndex(project.storyId, project.scenes), changed, project.root);
  writeChanged(questionsIndexPath, questionIndex(project.storyId, project.questions), changed, project.root);
  writeChanged(promisesIndexPath, promiseIndex(project.storyId, project.promises), changed, project.root);
  writeChanged(cluesIndexPath, clueIndex(project.storyId, project.clues), changed, project.root);
  writeChanged(glossaryIndexPath, glossaryIndex(project.storyId, project.glossaryTerms), changed, project.root);
  if (fs.existsSync(path.join(project.root, MATTER_DIR))) {
    writeChanged(path.join(project.root, MATTER_DIR, "_index.md"), matterIndex(project.storyId, project.matter), changed, project.root);
  }
  if (fs.existsSync(path.join(project.root, RESEARCH_DIR))) {
    writeChanged(path.join(project.root, RESEARCH_DIR, "_index.md"), researchIndex(project.storyId, project.research), changed, project.root);
  }
  refreshStoryField(path.join(project.root, "plot", "timeline.md"), project.storyId, changed, project.root);
  refreshStoryField(path.join(project.root, "continuity", "state.md"), project.storyId, changed, project.root);

  return { changed };
}

function refreshStoryField(filePath, storyId, changed, root) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
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
  if (options.out === undefined) {
    return { text };
  }
  const output = resolveOutputPath(project, options.out, "");
  writeFile(output.outFile, text, output.writeOptions);
  return { text, outFile: output.outFile };
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
  const next = updatePasses(passes, change);
  const raw = safeRead(storyPath, project.root);
  const changed = JSON.stringify(next) !== JSON.stringify(passes);
  if (changed) {
    writeFile(storyPath, replaceFrontmatter(raw, { ...parseFrontmatter(raw, storyPath).data, "revision-passes": next }), { root: project.root });
  }
  return { passes: next, changed };
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
    paragraphs: proseParagraphs(chapterProse(readMarkdown(chapter.file, project.root).body))
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
    const analysis = analyzeChapter(chapterProse(readMarkdown(chapter.file, project.root).body), rules);
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
  if (project.chapters.length === 0) {
    throw new Error("No chapters found to export");
  }

  const output = resolveOutputPath(project, options.out, "manuscript.md", options.enforceRoot);
  const generatedBy = options.generatedBy ?? "story export";
  const manuscript = manuscriptParts(project);
  const lines = [`# ${manuscript.title}`, "", `<!-- Generated by ${generatedBy}. -->`, ""];
  const pushMatter = (entry) => {
    if (entry.heading) {
      lines.push(`# ${entry.title}`, "");
    }
    lines.push(entry.body, "");
  };

  manuscript.front.forEach(pushMatter);
  for (const chapter of manuscript.chapters) {
    lines.push(`# Chapter ${chapter.number}: ${chapter.title}`, "", chapter.body, "");
  }
  manuscript.back.forEach(pushMatter);

  writeFile(output.outFile, `${lines.join("\n").trimEnd()}\n`, output.writeOptions);
  return { outFile: output.outFile, chapters: project.chapters.length };
}

export function buildBook(root, options = {}) {
  const format = normalizeBuildFormat(options.format ?? "markdown");
  const project = scanProject(root);
  const extension = BUILD_EXTENSIONS[format];
  const output = resolveOutputPath(project, options.out, path.join("dist", `${project.storyId}.${extension}`));

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
      hasCopyrightPage: manuscript.front.some((entry) => entry.id === "copyright" || /copyright/i.test(entry.title))
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
  const budget = pages === 1 ? 500 : 1500;
  const title = project.story.data.title ?? project.storyId;
  const premise = synopsisPremise(project);

  let text = renderSynopsis(title, premise, project, 0);
  if (wordCount(text) > budget) {
    text = renderSynopsis(title, premise, project, 1);
  }
  if (wordCount(text) > budget) {
    text = renderSynopsis(title, premise, project, 2);
  }
  if (wordCount(text) > budget) {
    text = truncateWords(text, budget);
  }

  if (options.out === undefined) {
    return { text };
  }
  const output = resolveOutputPath(project, options.out, path.join("dist", `${project.storyId}.synopsis.md`));
  writeFile(output.outFile, text, output.writeOptions);
  return { text, outFile: output.outFile };
}

function synopsisPremise(project) {
  const sentences = splitSentences(extractSection(project.story.body, "Synopsis"));
  return sentences.length > 0 ? sentences[0] : "No premise recorded.";
}

function splitSentences(text) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (normalized === "") {
    return [];
  }
  const sentences = [];
  let start = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    const boundary = (char === "." || char === "?" || char === "!") && (next === undefined || next === " ");
    const token = char === "." ? /([A-Za-z]+)$/.exec(normalized.slice(0, index)) : null;
    const abbreviation = token !== null && (/^(Dr|Mr|Mrs|Ms|St)$/.test(token[1]) || /^[A-Z]$/.test(token[1]));
    if (!boundary || abbreviation) {
      continue;
    }
    sentences.push(normalized.slice(start, index + 1));
    start = index + 1;
  }
  const tail = normalized.slice(start).trim();
  if (tail !== "") {
    sentences.push(/[.!?]$/.test(tail) ? tail : `${tail}.`);
  }
  return sentences;
}

function takeSentences(text, count) {
  return splitSentences(text).slice(0, count);
}

function renderSynopsis(title, premise, project, level) {
  const lines = [`# Synopsis: ${title}`, "", `Premise: ${premise}`, ""];
  for (const arc of project.arcs) {
    const markdown = readMarkdown(arc.file, project.root);
    lines.push(`## ${arc.name}`, "");
    const setup = takeSentences(extractSection(markdown.body, "Setup"), 2);
    if (setup.length > 0) {
      lines.push(setup.join(" "), "");
    }
    if (level === 0) {
      const rising = takeSentences(extractSection(markdown.body, "Rising Action"), 2);
      if (rising.length > 0) {
        lines.push(rising.join(" "), "");
      }
    }
    const climax = takeSentences(extractSection(markdown.body, "Climax"), 1);
    const resolution = level < 2 ? takeSentences(extractSection(markdown.body, "Resolution"), 1) : [];
    const chain = climax.concat(resolution);
    if (chain.length > 0) {
      lines.push(`Because ${chain.join(" ")}`, "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function truncateWords(text, budget) {
  const tokens = text.split(/\s+/).filter((word) => word !== "");
  const kept = [];
  for (const token of tokens) {
    if (wordCount(kept.concat(token).join(" ")) > budget) {
      break;
    }
    kept.push(token);
  }
  return `${kept.join(" ")}…\n`;
}

function shunnMeta(project) {
  const data = project.story.data;
  return {
    title: data.title ?? project.storyId,
    author: data.author === undefined ? "" : String(data.author),
    contact: asArray(data.contact),
    words: project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  };
}

export function migrateProject(root) {
  const projectRoot = path.resolve(root);
  const storyPath = requireStoryFile(projectRoot);
  const story = readMarkdown(storyPath, projectRoot);
  const storyId = kebabCase(story.data.title ?? path.basename(projectRoot));
  const changed = [];

  for (const directory of [
    path.join("worldbuilding", "factions"),
    path.join("worldbuilding", "artifacts"),
    "scenes",
    path.join("continuity", "questions"),
    path.join("continuity", "promises"),
    path.join("continuity", "clues"),
    path.join("glossary", "terms")
  ]) {
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

export function createEntity(root, options) {
  const project = scanProject(root);
  const kind = normalizeKind(options.kind);
  requireEntityEnumOptions(kind, options);
  const name = String(options.name ?? "").trim();
  if (!name) {
    throw new Error(`A ${kind} name is required`);
  }

  const entity = buildEntity(project, kind, name, options);
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
  if (!fs.existsSync(oldFile)) {
    throw new Error(`${kind} ${oldId} does not exist`);
  }

  const markdown = readMarkdown(oldFile, project.root);
  // Chapter and scene ids derive from their numbers ({chapter}-scene-NN), so
  // renaming them changes only the title.
  const newId = kind === "chapter" || kind === "scene" ? oldId : kebabCase(name);
  if (!isKebabId(newId)) {
    throw new Error(`Cannot derive a kebab-case id from ${kind} name "${name}"`);
  }
  const newFile = path.join(project.root, config.dir, `${newId}.md`);
  assertSafeProjectPath(newFile, project.root);
  if (newFile !== oldFile && fs.existsSync(newFile)) {
    throw new Error(`${kind} ${newId} already exists`);
  }

  const data = { ...markdown.data, [config.titleField]: name };
  const retitled = replaceFrontmatter(markdown.rawMarkdown, data);
  if (newFile === oldFile) {
    writeFile(oldFile, retitled, { root: project.root });
  } else {
    // Plan every rewrite before touching disk so a parse failure leaves the
    // project unchanged.
    const plan = replaceEntityReferences(project.root, kind, oldId, newId, new Map([[oldFile, retitled]]));
    const renamedContents = plan.get(oldFile);
    plan.delete(oldFile);
    writeFile(newFile, renamedContents, { root: project.root });
    fs.rmSync(oldFile);
    writeReferencePlan(project.root, plan);
  }

  const reindexed = reindexProject(project.root);
  return { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed) };
}

export function removeEntity(root, options) {
  const project = scanProject(root);
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

  const plan = removeEntityReferences(project.root, kind, id, new Map([[file, null]]));
  fs.rmSync(file);
  writeReferencePlan(project.root, plan);
  const reindexed = reindexProject(project.root);
  return { kind, id, file, changed: [file].concat(reindexed.changed) };
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

Track facts that must carry forward between chapters.

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

function buildProjectActions(project, validation, links, continuity) {
  const actions = [];
  if (validation.errors.length > 0) {
    actions.push(action("P0", "Fix validation errors", `Run story validate . and repair ${validation.errors.length} schema or registry errors.`));
  }
  if (links.errors.length > 0) {
    actions.push(action("P0", "Fix broken references", `Run story links . and repair ${links.errors.length} missing references or backlinks.`));
  }
  if (continuity.errors.length > 0) {
    actions.push(action("P0", "Fix continuity contradictions", `Run story continuity . and repair ${continuity.errors.length} deterministic continuity errors.`));
  }
  if (continuity.warnings.length > 0) {
    actions.push(action("P1", "Review continuity warnings", `Run story continuity . and review ${continuity.warnings.length} continuity warnings.`));
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
    actions.push(action("P1", "Refresh word counts", `Run story wordcount . --write for ${staleChapters.length} chapters with stale counts.`));
  }
  if (chaptersWithoutScenes.length > 0) {
    actions.push(action("P1", "Add scene records", `Create machine-readable scene files for ${chaptersWithoutScenes.length} chapters so continuity has durable state.`));
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
      actions.push(action("P1", "Plan revision passes", "Run story passes --init to record the structure-to-proof pass ladder, then work one pass at a time."));
    } else if (upcoming !== null) {
      const known = DEFAULT_PASSES.find((entry) => entry.pass === upcoming.pass);
      const checks = known ? ` Run ${known.checks.join(", ")}.` : "";
      actions.push(action("P1", `Revision pass: ${upcoming.pass}`, `${known ? `${known.focus}.` : "Work through this pass."}${checks} Mark it with story passes --done ${upcoming.pass}.`));
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
  actions.push(action("P2", `Draft chapter ${nextNumber}`, `Use story add chapter "Chapter ${nextNumber}" --number ${nextNumber}, then outline scenes to ${nextLabel}.`));
  if (project.characters.length === 0) {
    actions.push(action("P2", "Create first character", "Use story add character \"Name\" --role protagonist before drafting prose."));
  }
  if (actions.length === 1 && validation.ok && links.ok && continuity.ok && continuity.warnings.length === 0 && staleChapters.length === 0 && chaptersWithoutScenes.length === 0) {
    actions.unshift(action("P3", "Project is mechanically healthy", "No deterministic maintenance issues are blocking the next writing pass."));
  }
  return actions;
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
    const chapter = String(options.chapter ?? project.chapters.at(-1)?.id ?? "chapter-01").trim();
    requireKebabId(chapter, "chapter id");
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
    default:
      entityConfig(kind);
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
  const config = configs[kind];
  if (!config) {
    throw new Error(`Unsupported entity kind: ${kind}`);
  }
  return config;
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
  return KIND_ALIASES[normalized] ?? normalized;
}

function requireKebabId(id, label) {
  if (!isKebabId(id)) {
    throw new Error(`${label} must be a kebab-case id`);
  }
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer`);
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
    characters: normalizeList(options.characters ?? options.character, []),
    mentions: normalizeList(options.mentions ?? options.mention, []),
    "arcs-advanced": normalizeList(options.arcs ?? options.arc, []),
    status: options.status ?? "outline",
    mode: options.mode ?? "",
    date: options.date ?? "",
    time: options.time ?? "",
    ...(options.hook === undefined ? {} : { hook: options.hook }),
    "word-count": 0
  })}# Chapter ${number}: ${title}

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
    characters: normalizeList(options.characters ?? options.character, []),
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

function questionFile(title, options) {
  return `${stringifyFrontmatter({
    title,
    status: options.status ?? "open",
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
  return `${stringifyFrontmatter({ title, placement, order, heading: true })}# ${title}

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
  since: ["chapter"],
  to: ["location"]
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
      assertFileSizeWithinLimit(file);
      text = fs.readFileSync(file, "utf8");
    }
    const match = FRONTMATTER_PATTERN.exec(text);
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
        const nextData = transformReferences(data, transform, context);
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

function writeReferencePlan(root, plan) {
  for (const [file, contents] of plan) {
    writeFile(file, contents, { root });
  }
}

function transformReferences(data, transform, context, identityKey = null) {
  const next = {};
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
        } else if (context.isReferenceKey(key)) {
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

    if (context.isReferenceKey(key)) {
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

function markdownFiles(root, depth = 0, collected = null) {
  const files = collected ?? [];
  if (depth > MAX_SCAN_DEPTH) {
    throw new Error('Refusing to scan beyond depth ' + MAX_SCAN_DEPTH + ' under ' + root);
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory() && entry.name !== 'dist' && !entry.name.startsWith('.')) {
      markdownFiles(fullPath, depth + 1, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
      if (files.length > MAX_SCAN_FILES) {
        throw new Error('Too many markdown files under ' + root + ': exceeds the ' + MAX_SCAN_FILES + ' file limit');
      }
    }
  }
  if (depth === 0) {
    files.sort();
  }
  return files;
}

function manuscriptParts(project) {
  if (project.chapters.length === 0) {
    throw new Error("No chapters found to export");
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
      body: chapterProse(markdown.body).trim()
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
      body: chapterProse(readMarkdown(entry.file, project.root).body).trim()
    }));

  const meta = publishingMeta(project.story.data);
  const front = matter("front");
  // A copyright line in story.md becomes the copyright page unless a matter
  // page already provides one.
  const hasCopyrightPage = project.matter.some((entry) => entry.id === "copyright" || /copyright/i.test(entry.title));
  if (meta.copyright !== "" && !hasCopyrightPage) {
    front.unshift({ id: "copyright", title: "Copyright", heading: false, body: copyrightPage(meta) });
  }

  return {
    title: project.story.data.title,
    author: meta.authors.join(" and "),
    meta,
    front,
    chapters,
    back: matter("back")
  };
}

function epubModifiedTimestamp() {
  // Deterministic builds: identical sources must produce byte-identical
  // output. Honor SOURCE_DATE_EPOCH when set (seconds since epoch, per the
  // reproducible-builds spec); otherwise fall back to a stable default
  // instead of the current time so local builds are deterministic too.
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (raw !== undefined && raw !== "") {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) {
      return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
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
      label: `Chapter ${chapter.number}: ${chapter.title}`,
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
  const landmarks = [`<li><a epub:type="toc" href="nav.xhtml">Table of Contents</a></li>`];
  if (start) {
    landmarks.push(`<li><a epub:type="bodymatter" href="${start.id}.xhtml">Start of Content</a></li>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><title>${xmlEscape(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${links.join("")}</ol></nav><nav epub:type="landmarks" hidden="hidden"><ol>${landmarks.join("")}</ol></nav></body></html>`;
}

// EPUB Accessibility 1.1 discovery metadata for a text-only book with a
// table of contents and a single reading order.
function epubAccessibilityMeta(hasCover) {
  const features = ["tableOfContents", "readingOrder", "structuralNavigation", ...(hasCover ? ["alternativeText"] : [])];
  const summary = "Text-only book with a navigable table of contents, headings for each chapter, and a single logical reading order.";
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
    const runs = inlineRuns(paragraph).map((run) => {
      const text = xmlEscape(run.text);
      return run.style ? `<${run.style}>${text}</${run.style}>` : text;
    });
    paragraphs.push(`<p>${runs.join("")}</p>`);
  }
  return paragraphs.join("");
}

function xhtmlDocument(title, lang, bodyType, content) {
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><title>${xmlEscape(title)}</title></head><body epub:type="${bodyType}">${content}</body></html>`;
}

function chapterXhtml(chapter, lang = "en") {
  return xhtmlDocument(chapter.title, lang, "bodymatter chapter", `<h1>Chapter ${chapter.number}: ${xmlEscape(chapter.title)}</h1>${xhtmlParagraphs(chapter.body)}`);
}

function matterXhtml(entry, placement = "front", lang = "en") {
  const heading = entry.heading ? `<h1>${xmlEscape(entry.title)}</h1>` : "";
  const bodyType = entry.id === "copyright" ? `${placement}matter copyright-page` : `${placement}matter`;
  return xhtmlDocument(entry.title, lang, bodyType, `${heading}${xhtmlParagraphs(entry.body)}`);
}

// The manuscript as HTML parts for the review and print builds. Paragraph
// anchors are keyed by chapter number (ch03) or matter id (front-dedication),
// so they stay stable while other chapters change.
function htmlBook(manuscript) {
  const paragraphs = (body) => markdownParagraphs(body).map((paragraph) => (paragraph === "* * *"
    ? null
    : inlineRuns(paragraph).map((run) => (run.style ? `<${run.style}>${escapeHtml(run.text)}</${run.style}>` : escapeHtml(run.text))).join("")));
  const matter = (placement) => (entry) => ({
    key: `${placement}-${entry.id}`,
    kind: entry.id === "copyright" ? "front copyright-page" : placement,
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
      title: `Chapter ${chapter.number}: ${chapter.title}`,
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
    pushSection(`Chapter ${chapter.number}: ${chapter.title}`, chapter.body);
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
  if (run.style === "strong") {
    return shunnRunXml(run.text, "<w:b/>");
  }
  if (run.style === "em") {
    return shunnRunXml(run.text, "<w:i/>");
  }
  return shunnRunXml(run.text, "");
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
    paragraphs.push(shunnChapterHeadingXml(`Chapter ${chapter.number}: ${chapter.title}`));
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
    lines.push("\f", `# Chapter ${chapter.number}: ${chapter.title}`, "");
    for (const paragraph of markdownParagraphs(chapter.body)) {
      lines.push(paragraph, "");
    }
  }

  writeFile(outFile, `${lines.join("\n").trimEnd()}\n`, writeOptions);
}

function paragraphXml(text, style = "", runs = [{ text, style: "" }]) {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  const runXml = runs.map((run) => {
    const runStyle = run.style === "strong" ? "<w:rPr><w:b/></w:rPr>" : run.style === "em" ? "<w:rPr><w:i/></w:rPr>" : "";
    return `<w:r>${runStyle}<w:t xml:space="preserve">${xmlEscape(run.text)}</w:t></w:r>`;
  });
  return `<w:p>${styleXml}${runXml.join("")}</w:p>`;
}

// Markdown emphasis: **bold** / __bold__ and *italic* / _italic_. The marked
// text must start and end with a non-space character, as in CommonMark.
const INLINE_EMPHASIS_PATTERN = /(\*\*|__)(\S(?:[\s\S]*?\S)?)\1|(\*|_)(\S(?:[^*_]*?\S)?)\3/g;

// Underscores inside a word (snake_case_word) are literal, as in CommonMark.
function isIntrawordUnderscore(text, match) {
  const delimiter = match[1] ?? match[3];
  if (!delimiter.startsWith("_")) {
    return false;
  }
  const before = text[match.index - 1] ?? " ";
  const after = text[match.index + match[0].length] ?? " ";
  return /[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after);
}

function inlineRuns(text) {
  const runs = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_EMPHASIS_PATTERN)) {
    if (isIntrawordUnderscore(text, match)) {
      continue;
    }
    if (match.index > last) {
      runs.push({ text: text.slice(last, match.index), style: "" });
    }
    runs.push(match[1] ? { text: match[2], style: "strong" } : { text: match[4], style: "em" });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    runs.push({ text: text.slice(last), style: "" });
  }
  return runs;
}

// A thematic break: three or more of the same marker, optionally spaced.
const SCENE_BREAK_PATTERN = /^([*_-])( ?\1){2,}$/;

function markdownParagraphs(markdown) {
  const paragraphs = [];
  // Normalize CRLF and treat whitespace-only lines as blank, matching
  // CommonMark paragraph breaks.
  for (const paragraph of markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^#+[ \t]+/gm, "")
    // Blockquote markers flatten like headings, so a quoted epigraph or
    // letter reads as text rather than a literal ">".
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .split(/\n[ \t]*\n\s*/)) {
    const trimmed = paragraph.replace(/\s+/g, " ").trim();
    if (trimmed) {
      paragraphs.push(SCENE_BREAK_PATTERN.test(trimmed) ? "* * *" : trimmed);
    }
  }
  return paragraphs;
}

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
    localHeader.writeUInt16LE(0, 12);
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
    centralHeader.writeUInt16LE(0, 14);
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

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MAX_SCAN_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SCAN_FILES = 5000;
const MAX_SCAN_DEPTH = 10;

function assertFileSizeWithinLimit(filePath) {
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return;
  }
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
      scanErrors.push(`${label}: ${error.message}`);
    }
  }
  return entities;
}

function requireStoryFile(projectRoot) {
  const storyPath = path.join(projectRoot, "story.md");
  if (!fs.existsSync(storyPath)) {
    throw new Error(`${projectRoot} is not a story project: missing story.md`);
  }
  return storyPath;
}

// Reads continuity/exemptions.md when present. A missing or unparsable file
// means no exemptions; strict shape validation lives in validateExemptions.
function readExemptions(root) {
  const exemptionsPath = path.join(root, "continuity", "exemptions.md");
  let raw;
  try {
    raw = fs.readFileSync(exemptionsPath, "utf8");
  } catch {
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
  assertFileSizeWithinLimit(filePath);
  const rawMarkdown = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(rawMarkdown, filePath);
  return { ...parsed, rawMarkdown };
}

export function writeFile(filePath, contents, options = {}) {
  const target = prepareWriteTarget(filePath, options.root);
  fs.writeFileSync(target, contents, "utf8");
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
  assertFileSizeWithinLimit(filePath);
  return fs.readFileSync(filePath, "utf8");
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

function resolveOutputPath(project, out, defaultRelativePath, enforceRoot) {
  const rawOut = out ?? defaultRelativePath;
  const outFile = path.resolve(project.root, rawOut);
  const shouldEnforceRoot = enforceRoot ?? !path.isAbsolute(String(rawOut));
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

  rejectSymlinkTarget(target);
  return target;
}

function assertSafeProjectPath(filePath, root) {
  const target = path.resolve(filePath);
  assertLexicallyInsideRoot(target, root);
  assertSafeProjectParent(target, root);
  rejectSymlinkTarget(target);
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

function rejectSymlinkTarget(filePath) {
  if (lstatIfExists(filePath)?.isSymbolicLink()) {
    throw new Error(`Refusing to write through symlink: ${filePath}`);
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

  throw new Error(`Unsupported build format: ${value}. Supported formats: ${Object.keys(BUILD_EXTENSIONS).join(", ")}`);
}

function validateStoryFrontmatter(project, errors) {
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

    if (data.story !== undefined && data.story !== project.storyId) {
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
  if (data.story !== undefined && data.story !== project.storyId) {
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
  if (data[field] !== undefined && !allowed.has(data[field])) {
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

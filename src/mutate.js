// Commands that write the project: init, add, rename, remove, move, reindex, wordcount, and migrate.
// They do not take the project lock themselves: runCli holds it around every
// command whose registry entry declares `writes` (see commands.js), and
// createStoryProject locks the folders init and import fill. A caller
// outside the CLI wraps them in withProjectLock.
import fs from "node:fs";
import path from "node:path";
import { idText } from "./continuity.js";
import { chapterChronology, renumberedChronology } from "./chronology.js";
import { PROGRESSION_KINDS, sortProgressions } from "./progressions.js";
import { FRONTMATTER_PATTERN, parseFrontmatter, replaceFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import {
  assertExistingAncestorInsideRoot,
  assertLexicallyInsideRoot,
  assertSafeProjectDirectory,
  assertSafeProjectPath,
  assertWriteAllowed,
  isInsideGitDirectory,
  lstatIfExists,
  makeDirectories,
  portablePath,
  projectPath,
  RENAME_MARKER,
  readTextFile,
  recordChanges,
  removeFile,
  writeFile
} from "./files.js";
import { withProjectLocks } from "./lock.js";
import { optionValues } from "./options.js";
import {
  breaksParagraph,
  chapterHeading,
  chapterProse,
  characterCount,
  escapeRegExp,
  extractSection,
  isSceneBreakLine,
  kebabCase,
  maskMarkup,
  proseStart,
  wordCount
} from "./markdown.js";
import { COUNT_UNITS, STORY_FORMS, countUnit } from "./forms.js";
import { CHAPTER_HOOKS, SCENE_OUTCOMES } from "./pacing.js";
import { isLanguageTag, languagePack, projectLanguage } from "./languages/index.js";
import {
  areSiblingBooks,
  canonicalPath,
  discoverSeriesBooks,
  isBookNumber,
  linksInclude,
  readBookFrontmatter,
  seriesId,
  seriesLinkPath,
  seriesLinks,
  withSeriesBacklink
} from "./series.js";
import { warn } from "./findings.js";
import { EXEMPTIONS_FILE, exemptionFile } from "./exemptions.js";
import { queryFiltersNaming, retargetFilter, shownFilter, shownQuery } from "./list.js";
import { EXIT_CODES, projectError, refusedError, usageError } from "./exit-codes.js";
import { projectActions } from "./report.js";
import { MENTION_KINDS, proseRenames } from "./mentions.js";
import {
  STORY_SCHEMA_VERSION,
  REQUIRED_PATHS,
  PROJECT_DIRECTORIES,
  INDEX_SCHEMAS,
  STORY_TENSES,
  CHARACTER_ROLES,
  CHARACTER_STATUSES,
  ARC_TYPES,
  ARC_STATUSES,
  CHAPTER_STATUSES,
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
  STYLE_SHEET_FILE,
  MATTER_PLACEMENTS,
  MATTER_DIR,
  RESEARCH_STATUSES,
  RESEARCH_ACCURACY,
  RESEARCH_CONFIDENCE,
  RESEARCH_METHODS,
  RESEARCH_DIR,
  existingStoryData,
  asciiStoryId,
  deriveStoryId,
  scanProject,
  assertProjectParses,
  newerSchemaVersion,
  newerSchemaMessage,
  canonicalChapterId,
  mayScheduleChapter,
  mapOutsideLinks,
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
  styleSheet,
  requireSingleLineName,
  buildEntity,
  entityConfig,
  MULTI_KIND_REFERENCE_FIELDS,
  KIND_ALIASES,
  normalizeKind,
  assertPortableFolderName,
  assertPortableId,
  requireKebabId,
  requestedEntityId,
  undeducibleIdMessage,
  requireBookNumber,
  requirePositiveInteger,
  isKebabId,
  chapterFile,
  nextSceneNumber,
  LINK_DEFINITION_PATTERN,
  REGISTRY_HINT,
  markdownFiles,
  chapterChoices,
  branchGraph,
  CONTINUE_CHOICE,
  MAX_SCAN_FILE_BYTES,
  MAX_SCAN_FILES,
  requireStoryFile,
  readMarkdown,
  safeRead,
  ENTITY_SCAN_DIRS,
  SOURCE_ROOT_FILES,
  asArray,
  relative
} from "./scan.js";

// The folder init and import make a project in: --dir, else the story id.
// A title with no ASCII letters or digits (a translated edition, say) takes
// its story id from the project folder, as scanProject does. The default
// folder is the story id: the title's ASCII slug when it has one (Война и
// мир 2 goes in 2/, matching its id), else the transliterated title (Война
// и мир goes in voyna-i-mir/), which the id then comes from. Null when
// neither gives a folder.
export function newProjectRoot({ title, cwd = process.cwd(), dir }) {
  const text = String(title ?? "").trim();
  const titleId = kebabCase(text, { transliterate: false }) || kebabCase(text);
  return !titleId && dir === undefined ? null : path.resolve(cwd, dir ?? titleId);
}

export function createStoryProject(options) {
  const title = String(options.title ?? "").trim();
  if (!title) {
    throw usageError("A story title is required");
  }
  requireSingleLineName(title, "story", "title");

  const cwd = options.cwd ?? process.cwd();
  const root = newProjectRoot({ title, cwd, dir: options.dir });
  if (root === null) {
    throw usageError('Cannot derive a story id from title "' + title + '": pass --dir with an ASCII folder name, or use a title containing ASCII letters or digits');
  }
  if (options.language !== undefined && !isLanguageTag(options.language)) {
    throw usageError(`--language ${options.language} must be a BCP 47 tag such as en, en-GB, or fr`);
  }
  // The books --follows and --precedes link to get a backlink in their
  // story.md, so their locks are held for the whole run. --force fills an
  // existing folder, which is locked too, whether or not it is a project
  // yet. A symlinked folder is refused below, so its lock is not taken
  // through it.
  const locks = ["follows", "precedes"]
    .flatMap((field) => asArray(options[field]).filter((value) => typeof value === "string" && value.trim() !== ""))
    .map((value) => ({ root: path.resolve(cwd, value) }));
  if (options.force && lstatIfExists(root)?.isDirectory()) {
    locks.push({ root, folder: true });
  }
  return withProjectLocks(locks, () => fillStoryProject(root, title, cwd, options));
}

function fillStoryProject(root, title, cwd, options) {
  // `--force` keeps an existing story.md, so new registries take the story id
  // from its title, and the options it would have set are reported unused.
  const existingStory = existingStoryData(root);
  // A new project gets an id from its title or folder name, never the
  // substitute scanProject falls back to for a folder renamed later.
  const storyId = asciiStoryId(existingStory ? existingStory.title : title, root);
  // The story id names the default folder and every build file.
  assertPortableId(storyId, "story");
  assertPortableFolderName(path.basename(root));
  if (!storyId) {
    throw usageError('Cannot derive a story id from title "' + title + '" or folder "' + path.basename(root) + '": use an ASCII folder name with --dir');
  }
  // --force overwrites starter files and import --force deletes chapter
  // files, so never follow a symlinked project root to another directory.
  if (lstatIfExists(root)?.isSymbolicLink()) {
    throw refusedError(`Refusing to use symlinked project directory: ${root}`);
  }
  if (isInsideGitDirectory(root, cwd)) {
    throw refusedError(`Refusing to create a story project inside a .git folder: ${root}`);
  }
  if (fs.existsSync(root) && !options.force) {
    // import --force does more than init --force, so it says what.
    throw refusedError(`${root} already exists. ${options.forceHint ?? "Use --force to add missing starter files; existing files are never overwritten."}`);
  }
  // A project inside another project would be scanned, renamed, and removed
  // through by the outer one, so books sit side by side instead.
  const enclosing = enclosingStoryProject(root);
  if (enclosing) {
    throw refusedError(`Cannot create a story project inside another story project (${enclosing}); run init from the folder that contains it, or pass --dir ../<folder>`);
  }
  const ignoredOptions = existingStory ? unappliedStoryOptions(existingStory, title, options) : [];

  // An empty value (`--tense=` from an unset shell variable) would write a
  // field validate rejects; leave the flag out to use the default.
  for (const option of ["tense", "pov", "genre"]) {
    if (options[option] !== undefined && String(options[option]).trim() === "") {
      throw usageError(`--${option} cannot be empty: leave it out to use the default`);
    }
  }
  if (options.tense !== undefined && !STORY_TENSES.has(options.tense)) {
    throw usageError(`Unsupported tense "${options.tense}": expected one of ${[...STORY_TENSES].join(", ")}`);
  }
  if (options.form !== undefined && !STORY_FORMS.has(options.form)) {
    throw usageError(`Unsupported form "${options.form}": expected one of ${[...STORY_FORMS.keys()].join(", ")}`);
  }

  const series = resolveSeriesOptions(root, cwd, options);
  const inherited = series.linked[0]?.data ?? {};
  // Compute every backlink and confirm each linked story.md is writable
  // before creating anything, so a failure cannot leave a half-linked book.
  const backlinks = planSeriesBacklinks(root, series);
  // The CLI has already split --themes on commas and kept each --theme whole.
  const givenThemes = asArray(options.themes).map((theme) => String(theme).trim()).filter(Boolean);
  const themes = givenThemes.length > 0 ? givenThemes : ["change"];
  // A last check before anything is written, such as the parse check import
  // runs on an existing project.
  options.beforeWrite?.(root, existingStory !== null);
  for (const directory of PROJECT_DIRECTORIES) {
    makeDirectories(path.join(root, directory));
  }

  // An explicit --language replaces one inherited from a linked book.
  const storyInherited = { ...inheritedStoryFields(inherited), ...(options.language === undefined ? {} : { language: options.language.trim() }) };
  const pack = languagePack(projectLanguage(storyInherited));
  const unit = countUnit(storyInherited, pack);
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
    unit,
    pack,
    inherited: storyInherited,
    synopsis: options.synopsis ?? options.defaultSynopsis ?? "Add a 2-3 sentence synopsis here."
  }), { root });
  writeStarterFile(path.join(root, "characters", "_index.md"), characterIndex(storyId, [], "", ""), { root });
  writeStarterFile(path.join(root, "worldbuilding", "_index.md"), worldIndex(storyId, [], [], [], [], ""), { root });
  writeStarterFile(path.join(root, "plot", "_index.md"), plotIndex(storyId, "three-act", [], "", ""), { root });
  writeStarterFile(path.join(root, "plot", "timeline.md"), timeline(storyId), { root });
  writeStarterFile(path.join(root, "chapters", "_index.md"), chapterIndex(storyId, [], unit), { root });
  writeStarterFile(path.join(root, "scenes", "_index.md"), sceneIndex(storyId, []), { root });
  writeStarterFile(path.join(root, "continuity", "state.md"), continuityState(storyId), { root });
  writeStarterFile(path.join(root, "continuity", "questions", "_index.md"), questionIndex(storyId, []), { root });
  writeStarterFile(path.join(root, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), { root });
  writeStarterFile(path.join(root, "continuity", "clues", "_index.md"), clueIndex(storyId, []), { root });
  writeStarterFile(path.join(root, "glossary", "_index.md"), glossaryIndex(storyId, []), { root });
  writeStarterFile(path.join(root, STYLE_SHEET_FILE), styleSheet(), { root });
  const gitignore = writeStarterGitignore(root);

  const linkedBooks = [];
  // An existing story.md is preserved under --force, so only add backlinks
  // it mirrors: all of them when this run wrote it, otherwise those whose
  // forward link the existing story.md already has (a rerun after a failed
  // backlink write, say).
  const existingLinks = storyWritten ? null : existingSeriesLinks(root);
  for (const { book, original, updated } of backlinks) {
    if (existingLinks && !linksInclude(existingLinks[book.field], book.root)) {
      continue;
    }
    const storyPath = path.join(book.root, "story.md");
    try {
      writeFile(storyPath, updated, { root: book.root, unchangedFrom: original });
    } catch (error) {
      // The new book is made by now, so a plain rerun is refused.
      if (error.changedOnDisk) {
        error.message = `${storyPath} changed on disk while story was adding the series backlink, so it was left as it is. The new book in ${root} was made without it: run the same story init with --force to add it`;
      }
      throw error;
    }
    linkedBooks.push(book.root);
  }

  return {
    root,
    storyId,
    linkedBooks,
    keptStory: existingStory !== null,
    ignoredOptions,
    gitignore,
    files: REQUIRED_PATHS.filter((entry) => entry.endsWith(".md"))
  };
}

// Builds land in dist/ and are regenerated from the markdown, so a new
// project ignores them, along with files an interrupted story command or an
// editor leaves behind.
const STARTER_GITIGNORE = `# Build output: story build and story export regenerate it from the markdown
dist/

# Left behind when a story command is interrupted
.story.lock
.*.story-*.tmp
.story-*.tmp

# OS and editor files
.DS_Store
Thumbs.db
*.swp
*.swo
*~
`;

// Writes .gitignore when the project has none and never touches an existing
// one (a symlink to a shared file included). Returns "created", "kept", or
// "missing-dist" when a kept regular file does not ignore dist/.
function writeStarterGitignore(root) {
  const filePath = path.join(root, ".gitignore");
  const existing = lstatIfExists(filePath);
  if (!existing) {
    writeFile(filePath, STARTER_GITIGNORE, { root, unchangedFrom: null });
    return "created";
  }
  if (!existing.isFile()) {
    return "kept";
  }
  let text;
  try {
    text = readTextFile(filePath);
  } catch {
    // One that is not UTF-8 text, or is oversized, is kept without a check
    // rather than failing a run that has already written starter files.
    return "kept";
  }
  // The last rule about dist wins, so a later negation such as
  // `!dist/book.epub` counts as not ignoring the builds.
  let ignoresDist = false;
  for (const line of text.split(/\r?\n/).map((entry) => entry.trim())) {
    if (/^(?:\*\*\/|\/)?dist(?:\/(?:\*{1,2})?)?$/.test(line)) {
      ignoresDist = true;
    } else if (/^!(?:\*\*\/|\/)?dist(?:\/|$)/.test(line)) {
      ignoresDist = false;
    }
  }
  return ignoresDist ? "kept" : "missing-dist";
}

// Fields a linked book passes to a new book in its series: the retail series
// name, the byline, and the language. Values of the wrong shape are left
// behind rather than copied into a fresh story.md that validate rejects.
function inheritedStoryFields(data) {
  const fields = {};
  const text = (value) => typeof value === "string" && value.trim() !== "";
  if (text(data["series-title"])) {
    fields["series-title"] = data["series-title"];
  }
  if (text(data.author)) {
    fields.author = data.author;
  }
  if (Array.isArray(data.authors) && data.authors.length > 0 && data.authors.every(text)) {
    fields.authors = data.authors;
  }
  if (text(data.language)) {
    fields.language = data.language;
  }
  if (COUNT_UNITS.has(data["count-unit"])) {
    fields["count-unit"] = data["count-unit"];
  }
  return fields;
}

// The story.md options a kept story.md did not take: the title when it
// differs, and every other story.md option the caller passed.
function unappliedStoryOptions(existing, title, options) {
  const ignored = [];
  const existingTitle = typeof existing.title === "string" || typeof existing.title === "number" ? String(existing.title).trim() : "";
  if (existingTitle !== "" && existingTitle !== title) {
    ignored.push("title");
  }
  const flags = [
    ["genre", "--genre"], ["subGenre", "--sub-genre"], ["settingEra", "--setting-era"], ["themes", "--themes"],
    ["pov", "--pov"], ["tense", "--tense"], ["form", "--form"], ["synopsis", "--synopsis"], ["series", "--series"],
    ["bookNumber", "--book-number"], ["follows", "--follows"], ["precedes", "--precedes"]
  ];
  for (const [key, flag] of flags) {
    const value = options[key];
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) {
      ignored.push(flag);
    }
  }
  // A --language that matches the kept story.md is not lost.
  if (options.language !== undefined && options.language.trim() !== projectLanguage(existing)) {
    ignored.push("--language");
  }
  return ignored;
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
  writeFile(filePath, contents, { ...options, unchangedFrom: null });
  return true;
}

// Resolves --follows/--precedes against the working directory, confirms each
// target is a story project, and inherits the series id and next publication
// number from the linked books when the caller did not set them.
function resolveSeriesOptions(root, cwd, options) {
  const linked = [];
  const rootKey = canonicalPath(root);
  for (const [field, inverse] of [["follows", "precedes"], ["precedes", "follows"]]) {
    for (const value of asArray(options[field]).filter((item) => typeof item === "string" && item.trim() !== "")) {
      const bookRoot = path.resolve(cwd, value);
      const key = canonicalPath(bookRoot);
      if (bookRoot === root || key === rootKey) {
        throw usageError(`--${field} ${value} points at the new story itself`);
      }
      const earlier = linked.find((book) => book.key === key);
      if (earlier) {
        if (earlier.field === field) {
          continue;
        }
        throw usageError(`--${earlier.field} ${earlier.value} and --${field} ${value} name the same book; a book cannot be both earlier and later`);
      }
      let data;
      try {
        data = readBookFrontmatter(bookRoot);
      } catch (error) {
        throw projectError(`--${field} ${value}: ${path.posix.join(portablePath(value), "story.md")}: ${error.message}`);
      }
      if (!data) {
        throw projectError(`--${field} ${value} is not a story project: missing story.md`);
      }
      if (!areSiblingBooks(bookRoot, root)) {
        throw usageError(`--${field} ${value} is not in the same parent folder as the new book; story series only follows links between sibling book folders, so create the book beside it`);
      }
      linked.push({ field, inverse, value, key, root: bookRoot, data });
    }
  }

  const linkedSeries = [...new Set(linked.map((book) => seriesId(book.data)).filter((value) => value !== undefined))];
  if (options.series !== undefined) {
    const conflict = linked.find((book) => seriesId(book.data) !== undefined && seriesId(book.data) !== options.series);
    if (conflict) {
      throw usageError(`--series ${options.series} conflicts with --${conflict.field} ${conflict.value}, which belongs to series ${seriesId(conflict.data)}`);
    }
  } else if (linkedSeries.length > 1) {
    throw usageError(`Linked books belong to different series: ${linkedSeries.sort().join(", ")}`);
  }
  const series = options.series ?? linkedSeries[0];
  if (series !== undefined && !isKebabId(String(series))) {
    throw usageError(`Series id must be kebab-case: ${series}`);
  }

  let bookNumber;
  if (options.bookNumber !== undefined) {
    bookNumber = requireBookNumber(options.bookNumber);
    if (linked.length > 0) {
      const taken = seriesBookNumbers(linked).find((entry) => entry.bookNumber === bookNumber && canonicalPath(entry.root) !== rootKey);
      if (taken) {
        throw usageError(`Book number ${bookNumber} is already used by ${seriesLinkPath(cwd, taken.root) || "."}; book-number is publication order and must be unique in the series`);
      }
    }
  } else if (linked.length > 0) {
    // Publication order: the new book comes after every numbered book already
    // in the series, not just the directly linked ones, so it never collides.
    const entries = seriesBookNumbers(linked, true);
    const all = linked.map((book) => book.data["book-number"]).concat(entries.map((entry) => entry.bookNumber)).filter(isBookNumber);
    // After a novella numbered 2.5 the next full book is 3.
    bookNumber = all.length > 0 ? Math.floor(Math.max(...all)) + 1 : undefined;
  }

  const linkPaths = (field) => linked.filter((book) => book.field === field).map((book) => seriesLinkPath(root, book.root));
  return { linked, series, bookNumber, follows: linkPaths("follows"), precedes: linkPaths("precedes") };
}

// Every numbered book reachable from the linked books. With `requireComplete`,
// a series that cannot be fully read is refused, since a missed book-number
// would be silently reused.
function seriesBookNumbers(linked, requireComplete = false) {
  const entries = [];
  for (const book of linked) {
    const { books, complete, errors } = discoverSeriesBooks(book.root, scanProject);
    if (requireComplete && !complete) {
      throw projectError(`Cannot compute the next book-number: part of the series linked from --${book.field} ${book.value} could not be read (${errors[0].message}); fix it or pass --book-number`);
    }
    for (const entry of books) {
      if (isBookNumber(entry.bookNumber)) {
        entries.push({ bookNumber: entry.bookNumber, root: entry.root });
      }
    }
  }
  return entries;
}

// Each linked book's story.md with the backlink added, and the text it was
// made from, checked writable. Books that already link back and share the
// series id are left out.
function planSeriesBacklinks(root, series) {
  const planned = [];
  for (const book of series.linked) {
    const storyPath = path.join(book.root, "story.md");
    const original = readTextFile(storyPath);
    const updated = withSeriesBacklink(book.root, book.inverse, root, series.series, original);
    if (updated === null) {
      continue;
    }
    try {
      fs.accessSync(storyPath, fs.constants.W_OK);
    } catch {
      throw refusedError(`Cannot add the series backlink to ${storyPath}: the file is not writable; nothing was created`);
    }
    // The book's lock could not be made, so its backlink would be refused
    // after the new book is made.
    try {
      assertWriteAllowed(storyPath);
    } catch (error) {
      throw refusedError(`Cannot add the series backlink to ${storyPath}: ${error.message}`);
    }
    planned.push({ book, original, updated });
  }
  return planned;
}

// The follows/precedes links of an existing story.md, or empty lists when it
// cannot be read.
function existingSeriesLinks(root) {
  let data = {};
  try {
    data = readBookFrontmatter(root) ?? {};
  } catch {
    data = {};
  }
  return { follows: seriesLinks(root, data, "follows"), precedes: seriesLinks(root, data, "precedes") };
}

// The nearest folder above `root` whose story.md has frontmatter (a story
// project, not a manuscript that happens to be called story.md), or null.
function enclosingStoryProject(root) {
  let current = path.dirname(path.resolve(root));
  let previous = null;
  // path.dirname of the filesystem root is the root itself, so the walk
  // stops after checking it.
  while (current !== previous) {
    const storyPath = path.join(current, "story.md");
    let isProject = false;
    try {
      isProject = fs.statSync(storyPath).isFile() && /^﻿?---\r?\n/.test(readTextFile(storyPath).slice(0, 8));
    } catch {
      isProject = false;
    }
    if (isProject) {
      return current;
    }
    previous = current;
    current = path.dirname(current);
  }
  return null;
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
  writeRegistry(at("chapters", "_index.md"), () => chapterIndex(project.storyId, project.chapters, project.unit), changed, project.root);
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

function readRegistrySource(filePath, root) {
  return safeRead(filePath, root).replace(/\r\n/g, "\n");
}

// Regenerates a registry from its entity files. `build` receives the current
// registry (LF line endings) to carry over its hand-written sections; any
// other `## ` section the generator does not produce is appended unchanged,
// and a CRLF registry stays CRLF.
function writeRegistry(filePath, build, changed, root) {
  const raw = fs.existsSync(filePath) ? safeRead(filePath, root) : null;
  const existing = (raw ?? "").replace(/\r\n/g, "\n");
  const generated = build(existing);
  let contents = keepRegistryText(existing, generated, build);
  contents = keepRegistryFrontmatter(existing, contents);
  writeChanged(filePath, raw?.includes("\r\n") ? contents.replace(/\n/g, "\r\n") : contents, raw, changed, root);
}

// The generator owns only the frontmatter fields it writes; other fields and
// comment lines in the existing registry frontmatter are kept verbatim.
function keepRegistryFrontmatter(existing, contents) {
  let current;
  let next;
  try {
    current = parseFrontmatter(existing).data;
    next = parseFrontmatter(contents);
  } catch {
    return contents;
  }
  return replaceFrontmatter(existing, { ...current, ...next.data }, next.body);
}

// Generated value headings that replace each other: the chapter registry's
// total is in the book's count unit, so switching units must not keep the
// old total as a hand-written section.
const VALUE_HEADING_ALIASES = [["Total Word Count", "Total Character Count"]];

// The hand-written sections the generators carry over from the existing
// registry (see reindexProjectUnlocked), in lower case.
const CARRIED_SECTIONS = new Set(["relationship map", "family trees", "world overview", "story structure", "theme tracking"]);

// The generated registry with the existing registry's own text kept, so a
// reindex never drops a note. The generator owns its `## ` headings, the
// hand-written sections it carries over (kept as this split reads them, so
// a section above the title never takes the title with it), and its
// tables: every table with a generated header row (see
// registryTableLines) under the title, above it, or in a section it
// writes. Everything else stays where it was: the title line and the text
// under it, text above the title, and text before or after a generated
// table, `#` and `###` headings and other tables included. A `## ` section
// the generator does not write is appended after the generated ones.
// `build("")` gives the default text of an empty carried section.
function keepRegistryText(existing, generated, build) {
  // Headings match without regard to case, as extractSection reads them.
  // Only a generated heading that carries a value (`## Total Word Count:
  // 993`) is matched without it; every other heading must match in full, so
  // a hand-written `## Registry: 2` stays custom. Each generated heading
  // claims one existing section. A stale copy of a value heading (left by
  // 0.10.0) loses its heading, and its text joins the generated total.
  const valuePattern = /:\s*\d[\d,]*$/;
  const frontmatter = FRONTMATTER_PATTERN.exec(generated)[0];
  const fresh = registryParts(generated.slice(frontmatter.length));
  const freshTitle = fresh.sections.find((section) => section.title);
  const old = registryParts(existing.replace(FRONTMATTER_PATTERN, ""), freshTitle.text);
  const defaults = new Map(registryParts(build("").replace(FRONTMATTER_PATTERN, "")).sections.map((section) => [section.text.toLowerCase(), section.body]));
  const carried = (section) => section.level === 2 && CARRIED_SECTIONS.has(section.text.toLowerCase());
  const headers = fresh.sections.filter((section) => !carried(section)).map((section) => tableHeader(section.body)).filter((header) => header !== null);
  const valueKeys = new Map();
  const unclaimed = new Map();
  const kept = new Map();
  for (const section of fresh.sections) {
    kept.set(section, { body: carried(section) ? defaults.get(section.text.toLowerCase()) ?? section.body : section.body, before: [], after: [] });
    const text = section.text.toLowerCase();
    const hasValue = valuePattern.test(text);
    const key = hasValue ? text.replace(valuePattern, "") : text;
    if (hasValue) {
      const aliases = VALUE_HEADING_ALIASES.map((group) => group.map((alias) => alias.toLowerCase())).find((group) => group.includes(key)) ?? [key];
      aliases.forEach((alias) => valueKeys.set(alias, section));
    }
    if (section.level === 2) {
      unclaimed.set(key, [...(unclaimed.get(key) ?? []), section]);
    }
  }
  const custom = [];
  for (const section of old.sections) {
    const text = section.text.toLowerCase();
    const stripped = text.replace(valuePattern, "");
    const key = valueKeys.has(stripped) ? stripped : text;
    const target = section.title ? freshTitle : unclaimed.get(key)?.shift();
    if (target && carried(target)) {
      kept.get(target).body = section.body || kept.get(target).body;
    } else if (target || key !== text) {
      const { before, after } = withoutRegistryTables(section, headers);
      const place = kept.get(target ?? valueKeys.get(key));
      (target ? place.before : place.after).push(before);
      place.after.push(after);
    } else {
      custom.push(section.whole);
    }
  }
  const oldTitle = old.sections.find((section) => section.title);
  const preamble = withoutRegistryTables(old.preamble, headers);
  const blocks = fresh.sections.map((section) => {
    const { body, before, after } = kept.get(section);
    return [section.title && oldTitle ? oldTitle.heading : section.heading, ...before, body, ...after].filter((block) => block !== "").join("\n\n");
  });
  return `${frontmatter}\n${[preamble.before, preamble.after, ...blocks, ...custom].filter((block) => block !== "").join("\n\n")}\n`;
}

// A registry body split at its `## ` headings and its title: the first
// level 1 heading (`# ` or `===` underlined) reading `titleText`, else the
// first one. Any other level 1 heading belongs to the section it is in.
// Each part keeps its lines, and the same lines with comments and code
// fences masked, for withoutRegistryTables.
function registryParts(body, titleText) {
  const lines = body.split("\n");
  const masked = maskMarkup(body).split("\n");
  const headings = markdownHeadings(masked);
  const title = headings.find((heading) => heading.level === 1 && heading.text.toLowerCase() === titleText?.toLowerCase())
    ?? headings.find((heading) => heading.level === 1);
  const starts = headings.filter((heading) => heading.level === 2 || heading === title);
  const part = (from, to) => ({ body: linesText(lines, from, to), lines: lines.slice(from, to), masked: masked.slice(from, to) });
  return {
    preamble: part(0, starts[0]?.line ?? lines.length),
    sections: starts.map((heading, index) => {
      const end = starts[index + 1]?.line ?? lines.length;
      return {
        level: heading.level,
        text: heading.text,
        title: heading === title,
        heading: lines.slice(heading.line, heading.last + 1).join("\n"),
        whole: linesText(lines, heading.line, end),
        ...part(heading.last + 1, end)
      };
    })
  };
}

// Lines `from` to `to` without the blank lines around them.
function linesText(lines, from, to) {
  return lines.slice(from, to).join("\n").replace(/^(?:[ \t]*\n)+/, "").trimEnd();
}

// A part of a registry split around its registry tables: the text before
// the first, and the text after it with the others taken out.
function withoutRegistryTables(part, headers) {
  const { lines } = part;
  const owned = registryTableLines(lines, part.masked, headers);
  const first = lines.findIndex((line, index) => owned.has(index));
  if (first === -1) {
    return { before: "", after: part.body };
  }
  const gaps = [];
  for (let line = first; line < lines.length; line += 1) {
    if (owned.has(line)) {
      gaps.push([]);
    } else {
      gaps[gaps.length - 1].push(lines[line]);
    }
  }
  const after = gaps.map((gap) => linesText(gap, 0, gap.length)).filter((gap) => gap !== "");
  return { before: linesText(lines, 0, first), after: after.join("\n\n") };
}

// The table header row's cells at the start of a generated section, or null.
function tableHeader(body) {
  const lines = body.split("\n");
  return lines.length > 1 && isDelimiterRow(lines[1]) ? tableCells(lines[0]) : null;
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim().toLowerCase());
}

function isDelimiterRow(line) {
  return /^ {0,3}\|?[ \t:|-]*$/.test(line) && line.includes("-") && line.includes("|");
}

// The lines of the registry tables in `lines` (`masked` hides comments and
// fences): each table whose header row is one of `headers`, or differs
// from one in a single column name (`Word Count` that became `Character
// Count`), with or without its outer pipes. A table runs over the lines
// with a `|` after it; rows a blank line cut off, and a second registry
// table on the far side of a git conflict, belong to it, as do the
// conflict's markers when the conflict starts and ends among them. Any
// other table, such as one with a column added by hand, is left as text.
function registryTableLines(lines, masked, headers) {
  const blank = (index) => lines[index].trim() === "";
  const marker = (index) => /^(?:<{7}|={7}|>{7}|\|{7})(?:[ \t]|$)/.test(masked[index]);
  const piped = (index) => !blank(index) && !marker(index) && masked[index].includes("|");
  const starts = (index) => piped(index) && index + 1 < lines.length && isDelimiterRow(masked[index + 1]);
  const registry = (index) => starts(index) && headers.some((header) => sameHeader(tableCells(masked[index]), header));
  const runEnd = (index) => {
    let end = index + 1;
    while (end < lines.length && piped(end)) {
      end += 1;
    }
    return end;
  };
  const owned = new Set();
  let done = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!starts(index)) {
      continue;
    }
    let end = runEnd(index);
    if (!registry(index)) {
      index = end - 1;
      continue;
    }
    let first = index;
    for (let above = index - 1; above >= done && (blank(above) || marker(above)); above -= 1) {
      first = marker(above) ? above : first;
    }
    for (;;) {
      let next = end;
      while (next < lines.length && (blank(next) || marker(next))) {
        next += 1;
      }
      if (next === lines.length || !(registry(next) || (/^ {0,3}\|/.test(masked[next]) && piped(next) && !starts(next)))) {
        break;
      }
      end = runEnd(next);
    }
    let depth = 0;
    let balanced = true;
    for (let line = first; line < lines.length && (line < end || (depth > 0 && (blank(line) || marker(line)))); line += 1) {
      if (marker(line)) {
        depth += { "<": 1, ">": -1 }[masked[line][0]] ?? 0;
        balanced &&= depth >= 0 && (depth > 0 || masked[line][0] !== "=" && masked[line][0] !== "|");
        end = Math.max(end, line + 1);
      }
    }
    for (let line = first; line < end; line += 1) {
      if (!marker(line) || (balanced && depth === 0)) {
        owned.add(line);
      }
    }
    done = end;
    index = end - 1;
  }
  return owned;
}

function sameHeader(cells, header) {
  return cells.length === header.length && cells.filter((cell, index) => cell !== header[index]).length <= 1;
}

// Level 1 and 2 headings in masked lines, with their first and last line
// numbers and their text, found as extractSection finds them: ATX headings
// with up to three spaces of indent and no closing run of `#`, none inside
// a closed code fence or an HTML comment. A paragraph underlined with `=`
// is a level 1 heading too, but not above the `=======` between the two
// sides of a git conflict.
function markdownHeadings(lines) {
  const atx = (line) => /^ {0,3}(#{1,6})(?=[ \t]|$)/.exec(line);
  let conflict = false;
  const underline = (line) => /^ {0,3}=+[ \t]*$/.test(line) && !(conflict && /^={7}[ \t]*$/.test(line));
  const headings = [];
  let paragraph = null;
  for (const [index, line] of lines.entries()) {
    conflict = /^<{7}(?:[ \t]|$)/.test(line) || (conflict && !/^>{7}(?:[ \t]|$)/.test(line));
    const heading = atx(line);
    if (heading && heading[1].length <= 2) {
      headings.push({ level: heading[1].length, text: headingText(line.slice(heading[0].length)), line: index, last: index });
    } else if (paragraph !== null && underline(line)) {
      headings.push({ level: 1, text: lines.slice(paragraph, index).map((text) => text.trim()).join(" "), line: paragraph, last: index });
    }
    const prose = line.trim() !== "" && !heading && !underline(line) && !/^ {0,3}\|/.test(line);
    paragraph = prose ? paragraph ?? index : null;
  }
  return headings;
}

// An ATX heading's text without its closing run of `#`.
function headingText(rest) {
  const text = rest.trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") {
    end -= 1;
  }
  return end === 0 || text[end - 1] === " " || text[end - 1] === "\t" ? text.slice(0, end).trim() : text;
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
  }), raw, changed, root);
}

export function computeWordCounts(root, options = {}) {
  const project = scanProject(root);
  assertProjectParses(project, "count words");
  const characters = project.unit.name === "characters";
  const chapters = [];

  for (const chapter of project.chapters) {
    chapters.push({
      number: chapter.number,
      title: chapter.title,
      file: projectPath(project.root, chapter.file),
      wordCount: chapter.wordCount,
      ...(characters ? { characterCount: chapter.count } : {})
    });

    // A project counted in characters records character-count beside
    // word-count.
    if (options.write && (chapter.declaredWordCount !== chapter.wordCount || chapter.declaredCount !== chapter.count)) {
      const markdown = readMarkdown(chapter.file, project.root);
      const prose = chapterProse(markdown.body);
      // An editor saving the chapter meanwhile keeps its save.
      writeFile(chapter.file, replaceFrontmatter(markdown.rawMarkdown, {
        ...markdown.data,
        "word-count": wordCount(prose),
        ...(characters ? { "character-count": characterCount(prose) } : {})
      }), { root: project.root, unchangedFrom: markdown.rawMarkdown });
    }
  }

  if (options.write) {
    reindexProject(project.root);
  }

  // `total` is in the count unit: a book counted in characters says so with
  // `unit`, and its chapters carry characterCount.
  return {
    ...(characters ? { unit: "characters" } : {}),
    chapters,
    total: chapters.reduce((sum, chapter) => sum + (characters ? chapter.characterCount : chapter.wordCount), 0)
  };
}

export function migrateProject(root) {
  const projectRoot = path.resolve(root);
  const storyPath = requireStoryFile(projectRoot);
  // Scan first, so an unparseable story.md is reported by name like any other
  // file that stops migrate.
  assertProjectParses(scanProject(projectRoot), "migrate");
  const story = readMarkdown(storyPath, projectRoot);
  const newerVersion = newerSchemaVersion(story.data["schema-version"]);
  if (newerVersion !== null) {
    throw projectError(newerSchemaMessage(newerVersion));
  }
  const storyId = deriveStoryId(story.data.title, projectRoot);
  const upgrading = story.data["schema-version"] !== STORY_SCHEMA_VERSION;
  const changed = [];

  // Entity folders start empty and git does not keep empty folders, so a
  // clone of a current project lacks some. validate does not require them
  // and add makes the one it writes into, so only an upgrade restores them.
  for (const directory of upgrading ? PROJECT_DIRECTORIES : []) {
    ensureDirectory(path.join(projectRoot, directory), changed, projectRoot);
  }

  ensureFile(path.join(projectRoot, "plot", "timeline.md"), timeline(storyId), changed, projectRoot);
  ensureFile(path.join(projectRoot, "scenes", "_index.md"), sceneIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "state.md"), continuityState(storyId), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "questions", "_index.md"), questionIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "clues", "_index.md"), clueIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "glossary", "_index.md"), glossaryIndex(storyId, []), changed, projectRoot);

  if (upgrading) {
    writeFile(storyPath, replaceFrontmatter(story.rawMarkdown, {
      ...story.data,
      "schema-version": STORY_SCHEMA_VERSION
    }), { root: projectRoot, unchangedFrom: story.rawMarkdown });
    changed.push(storyPath);
  }

  const reindexed = reindexProject(projectRoot);
  return { root: projectRoot, changed: changed.concat(reindexed.changed) };
}

// The repairs `story doctor --fix` applies, in order. Each runs only when
// the diagnosis raised one of its codes (a warning story.md severity turned
// off is not raised), rewrites only registries and frontmatter the CLI
// maintains, never prose, and changes nothing when run again. migrate only
// adds missing folders and starter files and sets schema-version, so it is
// safe; it and wordcount --write both reindex when they finish, so reindex
// runs on its own only when neither did.
const DOCTOR_REPAIRS = [
  { command: "migrate", codes: ["schema-version-mismatch", "missing-required-path"], run: (root) => migrateProject(root) },
  { command: "wordcount --write", codes: ["stale-word-count"], run: (root) => computeWordCounts(root, { write: true }) },
  { command: "reindex", codes: ["stale-registry", "story-id-mismatch"], run: (root) => reindexProject(root) }
];

// story doctor --fix: diagnoses the project, applies the safe repairs the
// findings call for, and diagnoses it again, all under the project lock
// runCli holds, so the report is what remains for the writer to do.
// Returns that second diagnosis (see projectActions) with `repairs`, one {
// command, codes, changes } per repair run, and `stopped`, the message of
// the error that stopped a repair (a file that does not parse), after
// which none of the later ones is tried; null when every due repair ran.
export function fixProject(root, options = {}) {
  const before = projectActions(root, options);
  const raised = new Set([...before.validation.errors, ...before.validation.warnings].map((finding) => finding.code));
  const due = DOCTOR_REPAIRS
    .map((repair) => ({ ...repair, codes: repair.codes.filter((code) => raised.has(code)) }))
    .filter((repair) => repair.codes.length > 0);
  const repairs = [];
  let stopped = null;
  try {
    if (due.length > 0) {
      assertRepairable(root);
    }
  } catch (error) {
    stopped = projectErrorMessage(error);
  }
  for (const repair of stopped === null ? due : []) {
    if (repair.command === "reindex" && repairs.length > 0) {
      continue;
    }
    // The changes are kept even when the repair stops part way, so the
    // report lists every file written.
    const { result: error, changes } = recordChanges(root, () => {
      try {
        repair.run(root);
        return null;
      } catch (caught) {
        return caught;
      }
    });
    if (error !== null) {
      stopped = projectErrorMessage(error);
    }
    if (error === null || changes.length > 0) {
      repairs.push({ command: repair.command, codes: repair.codes, changes });
    }
    if (error !== null) {
      break;
    }
  }
  const after = repairs.length > 0 ? projectActions(root, options) : before;
  return { ...after, repairs, stopped };
}

// Every repair ends in a reindex, which needs each entity file and the plot
// registry to parse. Checking them first means a repair does not stop on
// one after it has already written.
function assertRepairable(root) {
  const project = scanProject(root);
  assertProjectParses(project, "fix");
  const plotPath = path.join(project.root, "plot", "_index.md");
  if (fs.existsSync(plotPath)) {
    const label = "plot/_index.md";
    const source = readRegistrySource(plotPath, project.root);
    try {
      parseFrontmatter(source, label);
    } catch (error) {
      const message = String(error?.message);
      throw projectError(`Cannot fix: fix this file first (story validate reports it):\n- ${message.startsWith(label) ? message : `${label}: ${message}`}`);
    }
  }
}

// A project error (a file that does not parse) stops the repairs and is
// reported; any other error (a refused write, a lock) stops the command.
function projectErrorMessage(error) {
  if (error?.exitCode !== EXIT_CODES.project) {
    throw error;
  }
  return error.message;
}

const ENTITY_ENUM_OPTIONS = {
  character: [["role", CHARACTER_ROLES], ["status", CHARACTER_STATUSES]],
  faction: [["type", FACTION_TYPES], ["status", FACTION_STATUSES]],
  artifact: [["type", ARTIFACT_TYPES], ["status", ARTIFACT_STATUSES]],
  arc: [["type", ARC_TYPES], ["status", ARC_STATUSES]],
  chapter: [["status", CHAPTER_STATUSES], ["hook", CHAPTER_HOOKS], ["mode", DRAFT_MODES]],
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
      throw usageError(`Unsupported ${kind} ${field} "${value}": expected one of ${[...allowed].join(", ")}`);
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
    for (const value of optionValues(options, option)) {
      if (!isKebabId(value)) {
        throw usageError(`--${option} "${value}" must be a kebab-case id (such as ${REFERENCE_EXAMPLES[option] ?? "mara-quill"})`);
      }
    }
  }
  if ((kind === "chapter" || kind === "scene") && options.pov !== undefined && String(options.pov).trim() !== "" && !isKebabId(String(options.pov).trim())) {
    throw usageError(`--pov "${options.pov}" must be a character id (such as mara-quill)`);
  }
}

// Fields that hold one id: a repeated flag cannot fit.
const SCALAR_REFERENCE_OPTIONS = {
  scene: ["chapter", "location", "pov"],
  chapter: ["pov"],
  artifact: ["owner", "location"],
  location: ["controlled-by"],
  promise: ["planted", "payoff"],
  clue: ["planted", "payoff"],
  question: ["introduced", "resolved"]
};

function normalizeScalarOptions(kind, options) {
  const next = { ...options };
  for (const option of SCALAR_REFERENCE_OPTIONS[kind] ?? []) {
    if (options[option] === undefined || options[option] === true) {
      continue;
    }
    const values = optionValues(options, option);
    if (values.length > 1) {
      throw usageError(`--${option} takes one id for ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind}, got ${values.join(", ")}`);
    }
    next[option] = values[0] ?? "";
  }
  return next;
}

// Kinds that share a reference field with `kind` (owner and controlled-by
// name a character or a faction; mentions a character or an artifact).
function kindsSharingFields(kind) {
  const shared = new Map();
  for (const [field, kinds] of Object.entries(REFERENCE_FIELD_KINDS)) {
    if (!kinds.includes(kind)) {
      continue;
    }
    for (const other of kinds) {
      if (other !== kind) {
        shared.set(other, (shared.get(other) ?? []).concat(field));
      }
    }
  }
  return shared;
}

// An id already used by a kind that shares a reference field would make
// those references ambiguous, and rename and remove skip ambiguous
// references, so a later rename or its undo would leave them on the other
// entity, with only a warning.
function assertUnambiguousId(root, kind, id) {
  for (const [other, fields] of kindsSharingFields(kind)) {
    if (fs.existsSync(path.join(root, entityConfig(other).dir, `${id}.md`))) {
      throw usageError(`${id} is already a ${other} id, and ${fields.join(" and ")} references could not tell the ${kind} from the ${other}. Choose another name, or pass --id`);
    }
  }
}

const CHAPTER_REFERENCE_OPTIONS = ["chapter", "planted", "payoff", "introduced", "resolved", "used-in"];

// Options that may name a chapter not written yet. A scene's --chapter and a
// question's --resolved must exist, which add reports in their own words.
const SCHEDULED_CHAPTER_OPTIONS = new Set(["planted", "payoff", "introduced", "used-in"]);

// The same rule links applies to scheduled chapters: a chapter not written
// yet is named chapter-NN, chapter-00 never exists, and chapter-1 beside
// chapter-01 is a typo.
function assertChapterReferences(project, options) {
  const byNumber = new Map(project.chapters.map((chapter) => [chapter.number, chapter.id]));
  for (const option of CHAPTER_REFERENCE_OPTIONS) {
    for (const value of optionValues(options, option)) {
      if (project.chapters.some((chapter) => chapter.id === value)) {
        continue;
      }
      const match = /^chapter-(\d+)$/.exec(value);
      if (!match) {
        if (SCHEDULED_CHAPTER_OPTIONS.has(option)) {
          throw usageError(`--${option} ${value} names no chapter: a chapter not written yet must be named chapter-NN, as story add chapter names it`);
        }
        continue;
      }
      const number = Number.parseInt(match[1], 10);
      if (number === 0) {
        throw usageError(`--${option} ${value}: chapter numbers start at 1`);
      }
      if (byNumber.has(number)) {
        throw usageError(`--${option} ${value}: did you mean ${byNumber.get(number)}?`);
      }
      // story add chapter writes chapter-01, so chapter-1 could never resolve.
      if (value !== canonicalChapterId(number)) {
        throw usageError(`--${option} ${value}: did you mean ${canonicalChapterId(number)}?`);
      }
    }
  }
}

const STATUS_CHAPTER_FIELDS = {
  promise: ["planted", "payoff"],
  clue: ["planted", "payoff"],
  question: ["resolved", "introduced"]
};

// A status that says a chapter is on the page needs that chapter written:
// links applies the same rule (mayScheduleChapter), so add refuses what links
// would reject.
function assertStatusChapters(project, kind, options) {
  const fields = STATUS_CHAPTER_FIELDS[kind];
  if (fields === undefined) {
    return;
  }
  const written = (value) => project.chapters.some((chapter) => chapter.id === String(value ?? "").trim());
  const given = (value) => String(value ?? "").trim() !== "";
  // Without --status, a question is answered with --resolved and open
  // without. A promise or clue is then planted only when --planted names a
  // written chapter (createEntity makes it planned otherwise), and planted
  // and planned allow the same unwritten payoff, so planned stands for both.
  const status = String(options.status ?? (kind !== "question" ? "planned" : given(options.resolved) ? "answered" : "open"));
  const article = /^[aeiou]/.test(status) ? "an" : "a";
  const reasons = {
    planted: status === "dropped"
      ? `a dropped ${kind} stays in the book, so its setup must be on the page. Use --status abandoned for a setup that was cut`
      : `${article} ${status} ${kind} needs its planted chapter. Leave --status unset to record it as planned`,
    payoff: `a paid-off ${kind} needs its payoff chapter. Use --status planted until the payoff is drafted`,
    resolved: "a question's resolved chapter must exist. Add --resolved once the answer is drafted",
    introduced: `${article} ${status} question needs its introduced chapter`
  };
  for (const field of fields) {
    if (given(options[field]) && !written(options[field]) && !mayScheduleChapter(kind, field, status)) {
      throw usageError(`--${field} ${String(options[field]).trim()} is not written yet: ${reasons[field]}`);
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
  options = normalizeScalarOptions(kind, options);
  if ((kind === "location" || kind === "system") && options.type !== undefined && String(options.type).trim() === "") {
    throw usageError(`--type cannot be empty: leave it out to use "other"`);
  }
  // A promise or clue planted in a chapter not written yet is still a plan.
  if ((kind === "promise" || kind === "clue") && options.status === undefined && options.planted !== undefined
    && !project.chapters.some((chapter) => chapter.id === String(options.planted).trim())) {
    options = { ...options, status: "planned" };
  }
  assertStatusChapters(project, kind, options);
  const name = String(options.name ?? "").trim();
  if (!name) {
    throw usageError(`A ${kind} name is required`);
  }
  requireSingleLineName(name, kind);

  let entity = buildEntity(project, kind, name, options);
  assertPortableId(entity.id, kind);
  assertUnambiguousId(project.root, kind, entity.id);
  // An add interrupted after writing the entity file (before its backlinks
  // and the reindex) left a file that is exactly what this run writes and
  // that no registry lists yet: a rerun finishes the job. An unnumbered
  // chapter or scene looks at the number the interrupted run took rather than
  // adding a second copy at the next one.
  const interrupted = (candidate) => fs.existsSync(candidate.file)
    && readTextFile(candidate.file) === candidate.markdown
    && !registryLists(project.root, kind, candidate.file);
  const numberOption = { chapter: "number", scene: "scene" }[kind];
  let resumed = false;
  if (numberOption && options[numberOption] === undefined) {
    const taken = kind === "chapter"
      ? project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0)
      : nextSceneNumber(project, entity.id.replace(/-scene-\d+$/, "")) - 1;
    if (taken >= 1) {
      const earlier = buildEntity(project, kind, name, { ...options, [numberOption]: taken });
      if (interrupted(earlier)) {
        entity = earlier;
        resumed = true;
      }
    }
  }
  if (!resumed && fs.existsSync(entity.file)) {
    if (!interrupted(entity)) {
      throw refusedError(`${relative(project, entity.file)} already exists`);
    }
    resumed = true;
  }

  if (!resumed) {
    writeFile(entity.file, entity.markdown, { root: project.root, unchangedFrom: null });
  }
  const data = readMarkdown(entity.file, project.root).data;
  applyEntityBacklinks(project.root, kind, entity.id, data);
  const reindexed = reindexProject(project.root);
  const warnings = missingReferenceWarnings(project.root, kind, data);
  if (kind === "chapter") {
    warnings.push(...abandonedThreadWarnings(project, entity.id));
  }
  return { kind, id: entity.id, file: entity.file, changed: [entity.file].concat(reindexed.changed), resumed, warnings };
}

// Fields whose references add writes a backlink for, by kind.
const BACKLINKED_FIELDS = { character: ["locations"], location: ["notable-characters"], scene: ["location", "characters"] };

// An id in a reference option that names no entity may be a forward
// reference for planning, so add keeps it, but says so: story links reports
// it, and no backlink was written. Chapter fields are left out: a promise
// planted in a chapter not written yet is normal, and scenes check theirs.
function missingReferenceWarnings(root, kind, data) {
  const warnings = [];
  for (const [key, value] of Object.entries(data)) {
    // A character's arc is a free-text theme label, not an arc id.
    if (!Object.hasOwn(REFERENCE_FIELD_KINDS, key) || (kind === "character" && key === "arc")) {
      continue;
    }
    const kinds = REFERENCE_FIELD_KINDS[key].filter((other) => other !== "chapter");
    if (kinds.length === 0) {
      continue;
    }
    for (const item of asArray(value)) {
      const id = typeof item === "string" ? item.trim() : "";
      if (!isKebabId(id) || kinds.some((other) => fs.existsSync(path.join(root, entityConfig(other).dir, `${id}.md`)))) {
        continue;
      }
      const backlink = BACKLINKED_FIELDS[kind]?.includes(key) ? ", so no backlink was written" : "";
      warnings.push(warn("unknown-reference", `${kinds.join(" or ")} ${id} (${key}) does not exist${backlink}; story links reports it until you add it`));
    }
  }
  return warnings;
}

// Whether the registry for this kind links the file (reindex writes the
// link, so an entity added by a finished `story add` is always listed).
function registryLists(root, kind, file) {
  const dir = entityConfig(kind).dir;
  const registry = [dir, path.posix.dirname(dir)].map((entry) => path.posix.join(entry, "_index.md")).find((entry) => REGISTRY_FILES.has(entry));
  const registryPath = registry && path.join(root, registry);
  if (!registryPath || !fs.existsSync(registryPath)) {
    return false;
  }
  const link = projectPath(path.dirname(registryPath), file);
  return safeRead(registryPath, root).includes(`](${link})`);
}

export function renameEntity(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "rename");
  const kind = normalizeKind(options.kind);
  const oldId = String(options.id ?? "").trim();
  const name = String(options.name ?? "").trim();
  if (!oldId || !name) {
    throw usageError("rename requires an entity id and a new name");
  }
  requireSingleLineName(name, kind);
  const requestedId = requestedEntityId(kind, options.newId);

  const config = entityConfig(kind);
  const oldFile = path.join(project.root, config.dir, `${oldId}.md`);
  requireKebabId(oldId, `${kind} id`);
  assertSafeProjectPath(oldFile, project.root);
  // Chapter and scene ids derive from their numbers ({chapter}-scene-NN), so
  // renaming them changes only the title.
  const newId = kind === "chapter" || kind === "scene" ? oldId : (requestedId ?? kebabCase(name));
  if (!isKebabId(newId)) {
    throw usageError(undeducibleIdMessage(kind, name));
  }
  assertPortableId(newId, kind);
  const newFile = path.join(project.root, config.dir, `${newId}.md`);
  assertSafeProjectPath(newFile, project.root);
  if (!fs.existsSync(oldFile)) {
    // A rename killed after deleting the old file missed at most its
    // reindex: every reference was rewritten before the file moved. Its
    // marker says which rename it was, so resume only when the marker names
    // this one, the new file exists, and nothing still names the old id;
    // otherwise the old id is simply missing (a typo, or a rename that
    // already finished), and an unrelated entity that happens to have this
    // name must not absorb its references.
    const marker = renameMarker(project.root);
    if (marker?.kind === kind && marker.id === oldId && marker.newId === newId && marker.name === name && fs.existsSync(newFile)
      && replaceEntityReferences(project.root, kind, oldId, newId, new Map()).size === 0) {
      const reindexed = reindexProject(project.root);
      // The killed run never printed its warnings.
      const warnings = ambiguousReferenceWarnings(project.root, kind, oldId, newFile, newId);
      removeFile(path.join(project.root, RENAME_MARKER), { force: true });
      return { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed), resumed: true, warnings };
    }
    throw usageError(`${kind} ${oldId} does not exist`);
  }
  let warnings = [];
  const prose = options.prose ? planProseRename(project, kind, oldId, name) : null;
  const proseFiles = prose?.files ?? new Map();

  const markdown = readMarkdown(oldFile, project.root);

  const data = { ...markdown.data, [config.titleField]: name };
  const retitled = retitleHeading(replaceFrontmatter(markdown.rawMarkdown, data), markdown.data[config.titleField], name);
  if (newFile === oldFile) {
    assertWritable(project.root, [oldFile, ...proseFiles.keys()]);
    commitWrites(() => {
      for (const [file, { original, next }] of proseFiles) {
        writeFile(file, next, { root: project.root, unchangedFrom: original });
      }
      writeFile(oldFile, retitled, { root: project.root, unchangedFrom: markdown.rawMarkdown });
    });
  } else {
    // Plan every rewrite before touching disk so a parse failure leaves the
    // project unchanged. Chapters renamed in prose are planned from their
    // new text, and written only if they still hold the text it came from.
    const overrides = new Map([[oldFile, retitled]]);
    for (const [file, { next }] of proseFiles) {
      overrides.set(file, next);
    }
    const plan = replaceEntityReferences(project.root, kind, oldId, newId, overrides);
    for (const [file, { original }] of proseFiles) {
      plan.originals.set(file, original);
    }
    followExemptionPatterns(project.root, plan, kind, oldId, newId);
    followQueryFilters(project.root, plan, kind, oldId, newId);
    const renamedContents = plan.get(oldFile);
    plan.delete(oldFile);
    // The new id is taken, unless an earlier run was killed after writing
    // the new file: then every reference already names the new id and the
    // file holds exactly what this rename writes, and only the old file is
    // left to delete.
    const interrupted = fs.existsSync(newFile) && plan.size === 0 && readTextFile(newFile) === renamedContents;
    if (fs.existsSync(newFile) && !interrupted) {
      throw refusedError(`${kind} ${newId} already exists`);
    }
    if (!interrupted) {
      assertUnambiguousId(project.root, kind, newId);
      warnings = adoptedReferenceWarnings(project.root, kind, newId, oldFile, "rename");
    }
    warnings = warnings.concat(ambiguousReferenceWarnings(project.root, kind, oldId, oldFile, newId));

    assertWritable(project.root, [...plan.keys(), oldFile], interrupted ? [] : [newFile]);
    // Before the first change, so a rerun can finish the rename even once
    // the old file is gone (see renameMarker). A marker an earlier rename
    // left is replaced, so it passes no unchangedFrom.
    writeFile(path.join(project.root, RENAME_MARKER), `${JSON.stringify({ kind, id: oldId, newId, name })}\n`, { root: project.root });
    // References first, the entity file last: if the command is killed
    // partway, the old file still exists and a rerun finishes the job.
    commitWrites(() => {
      writeReferencePlan(project.root, plan);
      if (!interrupted) {
        writeFile(newFile, renamedContents, { root: project.root, unchangedFrom: null });
      }
      removeMovedFile(project.root, { oldFile, original: markdown.rawMarkdown, newFile, written: renamedContents });
    });
  }

  if (newFile !== oldFile) {
    warnings = warnings.concat(linkedBookIdWarnings(project, kind, oldId, newId));
  }
  const reindexed = reindexProject(project.root);
  if (newFile !== oldFile) {
    // Finished, so a rerun reports the old id as missing.
    removeFile(path.join(project.root, RENAME_MARKER), { force: true });
  }
  const result = { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed), warnings };
  if (prose) {
    result.prose = { edits: prose.edits, aliases: prose.aliases, shared: prose.shared.length, review: prose.review };
    result.warnings = warnings.concat(prose.warnings);
  }
  return result;
}

// The rename the marker at the project root names, as { kind, id, newId,
// name }, or null when there is none or it cannot be read. renameEntity
// writes it before its first change and deletes it after its reindex.
function renameMarker(root) {
  const file = path.join(root, RENAME_MARKER);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(safeRead(file, root));
  } catch {
    return null;
  }
}

// A field that can name another kind too (mentions, owner, controlled-by)
// is left alone by rename and remove when an entity of that kind has the
// same id, since the reference could mean either. Lists each file that holds
// such references, with the fields they are in, so the writer can check
// which entity each one meant; `newId` is the rename's new id, or null for a
// remove. Values match as rename and remove match them, so an unquoted
// `owner: 1984` counts.
function ambiguousReferenceWarnings(root, kind, id, excludedFile, newId = null) {
  const warnings = [];
  const probe = `${id}-ambiguous-probe`;
  for (const [other, fields] of kindsSharingFields(kind)) {
    if (!fs.existsSync(path.join(root, entityConfig(other).dir, `${id}.md`))) {
      continue;
    }
    const found = new Map();
    for (const field of fields) {
      const context = { ...entityReferenceContext(root, kind, id), isReferenceKey: (key) => key === field };
      const plan = planReferenceRewrites(root, context, new Map([[excludedFile, null]]), (value) => (idText(value) === id ? probe : value), (body) => body);
      for (const file of plan.keys()) {
        const shown = projectPath(root, file);
        found.set(shown, (found.get(shown) ?? []).concat(field));
      }
    }
    if (found.size === 0) {
      continue;
    }
    const files = [...found.keys()].sort();
    const listed = files.map((file) => `${file} (${found.get(file).join(", ")})`).join(", ");
    const action = newId === null ? `remove left them alone, so they now name the ${other}: delete any that meant the ${kind}` : `rename left them alone, so they now name the ${other}: change any that meant the ${kind} to ${newId}`;
    warnings.push(warn("ambiguous-references", `references to ${id} in ${listed} could mean the ${kind} or ${other} ${id}, and ${action}`, files.length === 1 ? files[0] : null));
  }
  return warnings;
}

// rename --prose: the chapter prose edits for the new name (see
// proseRenames), after refusing a kind with no name in prose and a new name
// that is already another entity's, which would merge the two in the text.
function planProseRename(project, kind, id, name) {
  if (!MENTION_KINDS.includes(kind)) {
    throw usageError(`--prose does not apply to a ${kind}: it renames a character, location, faction, artifact, system, or term in chapter prose`);
  }
  const found = proseRenames(project, kind, id, name);
  if (found.clash) {
    const { clash } = found;
    throw refusedError(`"${clash.name}" is already a name of ${clash.kind} ${clash.id}, so --prose would give two entities one name in the text; choose another name, or rename without --prose`);
  }
  const warnings = found.shared.length === 0 ? [] : [warn("prose-name-shared", `--prose left ${found.shared.length} ${found.shared.length === 1 ? "name" : "names"} that ${kind} ${id} shares with another entity as written: ${found.shared.map((entry) => `${entry.file}:${entry.line}:${entry.column}`).join(", ")}. Check them`)];
  return { ...found, warnings };
}

const SERIES_CANON_COLLECTIONS = {
  character: "characters",
  location: "locations",
  system: "systems",
  faction: "factions",
  artifact: "artifacts",
  term: "glossaryTerms"
};

// `story series` matches shared canon by id, so renaming an id that a linked
// book also defines detaches the entity from every cross-book check.
function linkedBookIdWarnings(project, kind, oldId, newId) {
  const collection = SERIES_CANON_COLLECTIONS[kind];
  const data = project.story.data ?? {};
  const root = project.root;
  if (!collection || (seriesLinks(root, data, "follows").length === 0 && seriesLinks(root, data, "precedes").length === 0)) {
    return [];
  }
  const own = canonicalPath(root);
  const { books } = discoverSeriesBooks(root, scanProject);
  return books
    .filter((book) => book.key !== own && book.project[collection].some((entity) => entity.id === oldId))
    .map((book) => warn("linked-book-id", `${kind} ${oldId} is also defined in linked book ${book.title} (${seriesLinkPath(root, book.root)}); story series matches shared canon by id, so rename it there to ${newId} too, or keep the old id`));
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
    throw usageError("remove requires an entity id");
  }

  const config = entityConfig(kind);
  const file = path.join(project.root, config.dir, `${id}.md`);
  requireKebabId(id, `${kind} id`);
  assertSafeProjectPath(file, project.root);
  // A file already deleted by hand (or lost in a merge) can leave references
  // behind; remove still scrubs them, so a later entity with this id does
  // not silently adopt them. With no file and no references, the id is
  // simply unknown.
  const alreadyGone = !fs.existsSync(file);
  if (alreadyGone && removeEntityReferences(project.root, kind, id, new Map()).size === 0) {
    throw usageError(`${kind} ${id} does not exist`);
  }

  if (kind === "chapter") {
    // A scene's chapter is required, so scrubbing it would leave the scene
    // invalid; the scenes go first.
    const scenes = project.scenes.filter((scene) => scene.chapter === id);
    if (scenes.length > 0) {
      throw refusedError(`chapter ${id} still has scenes: ${scenes.map((scene) => scene.id).join(", ")}. Remove them first with story remove scene <id>`);
    }
  }

  if (kind === "chapter") {
    // An empty died-in, since, or learned-in means "before the story", so
    // clearing them would move a death, a loss, or a discovery to before
    // chapter 1. A progression's `from` is matched too (transformReferences
    // reads it for any chapter context): dropping the entry would lose the
    // change it records.
    const context = { ...entityReferenceContext(project.root, "chapter", id), isReferenceKey: (key) => BEFORE_STORY_FIELDS.includes(key) };
    const named = [...planReferenceRewrites(project.root, context, new Map([[file, null]]), idRenamer(id, `${id}-removed`), (body) => body).keys()];
    if (named.length > 0) {
      throw refusedError(`chapter ${id} is still named by ${BEFORE_STORY_FIELDS.join(", ")}, or a progression's from in ${named.map((entry) => projectPath(project.root, entry)).join(", ")}; an empty value there means before the story, and a progression needs the chapter it starts in, so point them at another chapter first`);
    }
  }

  // Dropping the choices that led here can leave a chapter with none, which
  // makes it an ending, so remove says which chapters lost one.
  const choosers = kind === "chapter"
    ? project.chapters.filter((chapter) => chapter.id !== id && chapterChoices(chapter, "").choices.some((choice) => choice.to === id)).map((chapter) => relative(project, chapter.file))
    : [];
  const wasBranching = choosers.length > 0 && branchGraph(project).branching;
  const plan = removeEntityReferences(project.root, kind, id, new Map([[file, null]]));
  assertWritable(project.root, [...plan.keys(), file]);
  // An edit saved after this read keeps the file.
  const original = alreadyGone ? undefined : readTextFile(file);
  // References first, the file last, so an interrupted remove can be rerun.
  commitWrites(() => {
    writeReferencePlan(project.root, plan);
    removeFile(file, { force: true, root: project.root, unchangedFrom: original });
  });
  const reindexed = reindexProject(project.root);
  // remove never rewrites story.md's frontmatter, so its queries are as
  // scanned.
  const warnings = leftoverReferenceWarnings(project.root, kind, id, project.story.data.queries);
  if (choosers.length > 0) {
    // With the last choice gone the book is linear again: every chapter
    // continues to the next, endings included.
    warnings.push(warn("choices-dropped", branchGraph(scanProject(project.root)).branching || !wasBranching
      ? `${choosers.join(", ")} had choices leading to ${id}, which remove dropped; a chapter left with no choices is an ending, so check where ${choosers.length === 1 ? "it leads" : "they lead"} now`
      : `${choosers.join(", ")} had the last choices in the book, leading to ${id}, which remove dropped; with no choices left the book is linear again and each chapter continues to the next, so add choices back to keep it branching`, choosers.length === 1 ? choosers[0] : null));
  }
  return { kind, id, file, alreadyGone, changed: [file].concat(reindexed.changed), warnings };
}

// What remove leaves for the author: body links and bare chapter or scene ids
// (the ones `story links` checks, plus links in a registry's own sections),
// which it never edits; story.md `queries` filters naming the id; exemption
// patterns naming it, which no longer match anything; and references another
// kind's entity with the id may mean (see ambiguousReferenceWarnings).
function leftoverReferenceWarnings(root, kind, id, queries) {
  const warnings = [];
  const context = entityReferenceContext(root, kind, id);
  const probe = `${id}-leftover-probe`;
  const numbered = kind === "chapter" || kind === "scene";
  let files = [];
  let ambiguous = [];
  try {
    files = [...planReferenceRewrites(root, context, new Map(), (value) => value, (body, file) => {
      const relinked = renameLinkTargets(root, file, body, context, probe);
      return numbered ? renameIdTokens(root, file, relinked, id, probe) : relinked;
    }).keys()].map((file) => projectPath(root, file)).sort();
    ambiguous = ambiguousReferenceWarnings(root, kind, id, context.entityFile);
  } catch {
    // Every file parsed before the remove; a file broken since is reported
    // by validate.
  }
  if (files.length > 0) {
    warnings.push(warn("leftover-references", `${files.join(", ")} still ${files.length === 1 ? "mentions" : "mention"} ${kind} ${id} in ${numbered ? "links or ids" : "links"} in the text, which remove does not change: edit ${files.length === 1 ? "it" : "them"}, then run story links`, files.length === 1 ? files[0] : null));
  }
  const stale = exemptionEntries(root)
    .map(({ entry, index }) => {
      const followed = followExemptionEntry(entry, kind, id, probe);
      return { index, keys: EXEMPTION_TEXT_KEYS.filter((key) => followed[key] !== entry[key]).map((key) => `${key} ${JSON.stringify(entry[key])}`) };
    })
    .filter(({ keys }) => keys.length > 0);
  const named = queryFiltersNaming(queries, context.isReferenceKey, id);
  if (named.length > 0) {
    const listed = named.map((entry) => `${shownQuery(entry)} (${entry.positions.map((position) => shownFilter(entry.item.where[position])).join(", ")})`).join(", ");
    warnings.push(warn("stale-query", `story.md ${named.length === 1 ? "query" : "queries"} ${listed} still ${named.length === 1 ? "filters" : "filter"} on ${kind} ${id}, which remove does not change: update or delete ${named.length === 1 ? "that filter" : "those filters"}`, "story.md"));
  }
  if (stale.length > 0) {
    const values = stale.flatMap(({ keys }) => keys);
    warnings.push(warn("stale-exemption", `continuity/exemptions.md has ${stale.length === 1 ? "an entry" : `${stale.length} entries`} naming ${id} (${stale.map(({ index }) => `exemptions[${index}]`).join(", ")}), which ${stale.length === 1 ? "no longer matches" : "no longer match"} anything: ${values.join(", ")}. Delete or update ${stale.length === 1 ? "it" : "them"}`, EXEMPTIONS_FILE));
  }
  return warnings.concat(ambiguous);
}

// The exemption keys that name ids and paths as text: a pattern quotes
// finding text, file is a path, and chapter is a chapter id.
const EXEMPTION_TEXT_KEYS = ["pattern", "file", "chapter"];

// The mapping entries of the exemptions log, with their indexes.
function exemptionEntries(root) {
  const filePath = path.join(root, EXEMPTIONS_FILE);
  try {
    const entries = readMarkdown(filePath, root).data.exemptions;
    return Array.isArray(entries)
      ? entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry && typeof entry === "object" && !Array.isArray(entry))
      : [];
  } catch {
    return [];
  }
}

// An exemption entry with the ids of a renamed or moved `kind` entity
// changed. A pattern changes wherever it names the id as a whole token, as
// it quotes finding text. A file changes only when it is that entity's own
// file (or, for a chapter, one of its scene files), so a location sharing a
// character's id keeps its path. `chapter` is a reference field, so the
// reference rewrites already follow a moved chapter and scrub a removed
// one; here it follows a scene the entry names to its new chapter.
function followExemptionEntry(entry, kind, oldId, newId) {
  const renamed = { ...entry };
  if (typeof entry.pattern === "string") {
    renamed.pattern = renameIdText(entry.pattern, oldId, newId);
  }
  const file = typeof entry.file === "string" ? exemptionFile(entry.file) : null;
  const dir = entityConfig(kind).dir.replace(/\\/g, "/");
  const ownScene = kind === "chapter" && file !== null && new RegExp(`^scenes/${escapeRegExp(oldId)}-scene-\\d+\\.md$`).test(file);
  if (file !== null && (file === `${dir}/${oldId}.md` || ownScene)) {
    renamed.file = renameIdText(file, oldId, newId);
  }
  const sceneChapter = (id) => /^(.+)-scene-\d+$/.exec(id)?.[1];
  if (kind === "scene" && renamed.file !== entry.file && entry.chapter === sceneChapter(oldId) && sceneChapter(newId) !== undefined) {
    renamed.chapter = sceneChapter(newId);
  }
  return renamed;
}

// Exemption patterns quote finding text, which names ids and file paths
// (`chapters/chapter-01.md has POV ann`), and file and chapter keys name
// them outright. When rename or move changes an id, the entries naming it
// follow, so a dismissal stays with its finding instead of resurfacing, or
// later dismissing whatever takes the old id.
function followExemptionPatterns(root, plan, kind, oldId, newId) {
  const filePath = path.join(root, EXEMPTIONS_FILE);
  if (!plan.has(filePath) && !lstatIfExists(filePath)) {
    return;
  }
  const text = plan.get(filePath) ?? readTextFile(filePath);
  // The plan already parsed it: a broken exemptions file stops the command.
  const data = parseFrontmatter(text, filePath).data;
  if (!Array.isArray(data.exemptions)) {
    return;
  }
  let changed = false;
  const exemptions = data.exemptions.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }
    const renamed = followExemptionEntry(entry, kind, oldId, newId);
    changed ||= EXEMPTION_TEXT_KEYS.some((key) => renamed[key] !== entry[key]);
    return renamed;
  });
  if (changed) {
    if (!plan.has(filePath)) {
      plan.originals?.set(filePath, text);
    }
    plan.set(filePath, replaceFrontmatter(text, { ...data, exemptions }));
  }
}

// Saved story.md queries filter on ids (`pov=mara-quill`), so when rename,
// move, or merge changes an id, the filters comparing a key that can name
// the entity with the old id follow it, as its frontmatter references do;
// the rest of each filter stays as written. No key names a scene, so a scene
// move has none to follow.
function followQueryFilters(root, plan, kind, oldId, newId) {
  const filePath = path.join(root, "story.md");
  const text = plan.get(filePath) ?? readTextFile(filePath);
  // The plan already parsed it: a broken story.md stops the command.
  const data = parseFrontmatter(text, filePath).data;
  const found = queryFiltersNaming(data.queries, entityReferenceContext(root, kind, oldId).isReferenceKey, oldId);
  if (found.length === 0) {
    return;
  }
  const queries = [...data.queries];
  for (const { index, item, positions } of found) {
    queries[index] = { ...item, where: item.where.map((filter, position) => (positions.includes(position) ? retargetFilter(filter, newId) : filter)) };
  }
  if (!plan.has(filePath)) {
    plan.originals?.set(filePath, text);
  }
  plan.set(filePath, replaceFrontmatter(text, { ...data, queries }));
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
  const kind = normalizeMoveKind(options.kind);
  const id = String(options.id ?? "").trim();
  if (!id) {
    throw usageError("move requires a chapter or scene id");
  }
  requireKebabId(id, `${kind} id`);
  return kind === "chapter" ? moveChapter(project, id, options) : moveScene(project, id, options);
}

// Plural labels for the kinds move refuses.
const KIND_PLURALS = {
  character: "characters", location: "locations", system: "systems", faction: "factions", artifact: "artifacts",
  arc: "arcs", question: "questions", promise: "promises", clue: "clues", term: "glossary terms",
  matter: "matter pages", research: "research notes"
};

function normalizeMoveKind(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "") {
    throw usageError("An entity kind is required: expected one of chapter, scene");
  }
  if (!Object.hasOwn(KIND_ALIASES, text)) {
    throw usageError(`Unsupported entity kind: ${value}: expected one of chapter, scene`);
  }
  const kind = KIND_ALIASES[text];
  if (kind !== "chapter" && kind !== "scene") {
    throw usageError(`story move works on chapters and scenes, not ${KIND_PLURALS[kind]}; use story rename to change other ids`);
  }
  return kind;
}

// `action` names the command for the adopted-references warning: split and
// merge renumber chapters through here too.
function moveChapter(project, oldId, options, action = "move") {
  const chapter = project.chapters.find((entry) => entry.id === oldId);
  if (!chapter) {
    throw usageError(`chapter ${oldId} does not exist`);
  }
  if (options.number === undefined) {
    throw usageError("move chapter requires --number <n>");
  }
  const number = requirePositiveInteger(options.number, "chapter number");
  const newId = `chapter-${String(number).padStart(2, "0")}`;
  const newFile = path.join(project.root, "chapters", `${newId}.md`);
  if (newId === oldId) {
    throw usageError(`${oldId} is already chapter ${number}`);
  }
  const taken = project.chapters.find((entry) => entry.number === number && entry.id !== oldId);

  const markdown = readMarkdown(chapter.file, project.root);
  const renumbered = replaceFrontmatter(markdown.rawMarkdown, { ...markdown.data, number }, renumberedHeading(markdown.body, number));
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
  plan.originals.set(chapter.file, markdown.rawMarkdown);
  // current-chapter is a number: follow the chapter it pointed at.
  const statePath = path.join(project.root, "continuity", "state.md");
  if (fs.existsSync(statePath)) {
    const stateText = plan.get(statePath) ?? readTextFile(statePath);
    const stateData = parseFrontmatter(stateText, statePath).data;
    if (stateData["current-chapter"] === chapter.number) {
      if (!plan.has(statePath)) {
        plan.originals.set(statePath, stateText);
      }
      plan.set(statePath, replaceFrontmatter(stateText, { ...stateData, "current-chapter": number }));
    }
  }
  followExemptionPatterns(project.root, plan, "chapter", oldId, newId);
  followQueryFilters(project.root, plan, "chapter", oldId, newId);
  reorderProgressions(project, plan, renumberedChronology(chapterChronology(project), oldId, newId, number));
  const moves = [{ oldFile: chapter.file, newFile }, ...sceneMoves];
  // The number is taken, unless an earlier run of this move was interrupted
  // after writing the chapter there.
  if (taken && !interruptedMove(plan, moves)) {
    throw refusedError(`${newId} already exists: move it first. To make room, renumber from the highest chapter down`);
  }
  const warnings = taken ? [] : adoptedReferenceWarnings(project.root, "chapter", newId, chapter.file, action);
  commitMoves(project.root, plan, moves);
  const reindexed = reindexProject(project.root);
  return { kind: "chapter", oldId, id: newId, file: newFile, moved: moves.length, changed: moves.map((move) => move.newFile).concat(reindexed.changed), warnings };
}

// A level-1 ATX heading line, found in masked text.
const LEVEL_ONE_HEADING = /^[ \t]{0,3}#(?!#)[ \t]+[^\r\n]*(?:\r?\n|$)/gm;
// A heading line that reads `# Chapter N`, with or without a title after a
// colon; the number is the second group.
const CHAPTER_NUMBER_HEADING = /^([ \t]{0,3}#[ \t]+Chapter[ \t]+)(\d+)(?=[ \t]*(?::|\r?\n|$))/;

// The level-1 headings of a body that a comment or code fence does not
// hide, each with its line as written.
function levelOneHeadings(body, masked, limit = masked.length) {
  return [...masked.slice(0, limit).matchAll(LEVEL_ONE_HEADING)].map((match) => ({ index: match.index, end: match.index + match[0].length, line: body.slice(match.index, match.index + match[0].length) }));
}

// The chapter body with its heading renumbered: the body's first level-1
// heading that reads `# Chapter N`. One in a comment or code fence never
// counts, and the frontmatter is never touched, so a `# Chapter 1: ...`
// comment line there keeps its number, as does a later heading in the text.
function renumberedHeading(body, number) {
  const heading = levelOneHeadings(body, maskMarkup(body)).find((entry) => CHAPTER_NUMBER_HEADING.test(entry.line));
  if (heading === undefined) {
    return body;
  }
  return `${body.slice(0, heading.index)}${body.slice(heading.index).replace(CHAPTER_NUMBER_HEADING, `$1${number}`)}`;
}

// A renumbered chapter can move past another progression's chapter, so the
// progressions of every character, location, and faction the move rewrote
// are put back in story order, which validate requires.
function reorderProgressions(project, plan, chronology) {
  const dirs = PROGRESSION_KINDS.map((kind) => entityConfig(kind).dir);
  for (const [file, text] of plan) {
    if (!dirs.includes(projectPath(project.root, path.dirname(file)))) {
      continue;
    }
    const data = parseFrontmatter(text, file).data;
    if (!Array.isArray(data.progressions)) {
      continue;
    }
    const sorted = sortProgressions(data.progressions, chronology);
    if (sorted.some((item, index) => item !== data.progressions[index])) {
      plan.set(file, replaceFrontmatter(text, { ...data, progressions: sorted }));
    }
  }
}

function moveScene(project, oldId, options, action = "move") {
  const scene = project.scenes.find((entry) => entry.id === oldId);
  if (!scene) {
    throw usageError(`scene ${oldId} does not exist`);
  }
  if (options.chapter === undefined && options.scene === undefined) {
    throw usageError("move scene requires --chapter <id>, --scene <n>, or both");
  }
  const chapterId = String(options.chapter ?? scene.chapter).trim();
  requireKebabId(chapterId, "chapter id");
  if (!project.chapters.some((entry) => entry.id === chapterId)) {
    throw usageError(`chapter ${chapterId} does not exist`);
  }
  const markdown = readMarkdown(scene.file, project.root);
  const context = entityReferenceContext(project.root, "scene", oldId);
  const planMove = (number) => {
    const newId = `${chapterId}-scene-${String(number).padStart(2, "0")}`;
    const moved = replaceFrontmatter(markdown.rawMarkdown, { ...markdown.data, chapter: chapterId, scene: number });
    // No frontmatter field names a scene, so only links and bare ids change.
    const plan = planReferenceRewrites(project.root, context, new Map([[scene.file, moved]]),
      idRenamer(oldId, newId),
      (body, file) => renameIdTokens(project.root, file, renameLinkTargets(project.root, file, body, context, newId), oldId, newId));
    plan.originals.set(scene.file, markdown.rawMarkdown);
    followExemptionPatterns(project.root, plan, "scene", oldId, newId);
    return { number, newId, plan, moves: [{ oldFile: scene.file, newFile: path.join(project.root, "scenes", `${newId}.md`) }] };
  };
  let target;
  if (options.scene === undefined) {
    // Without --scene, a rerun of an interrupted move finds the copy the
    // earlier run wrote instead of moving the scene again to the next free
    // number.
    target = project.scenes
      .filter((entry) => entry.chapter === chapterId && entry.id !== oldId && entry.title === scene.title)
      .map((entry) => planMove(entry.scene))
      .find((candidate) => interruptedMove(candidate.plan, candidate.moves));
  }
  // Without --scene a scene keeps its number in its own chapter and goes to
  // the end of another one.
  target ??= planMove(options.scene !== undefined ? requirePositiveInteger(options.scene, "scene number")
    : chapterId === scene.chapter ? scene.scene : nextSceneNumber(project, chapterId));
  const { number, newId, plan, moves } = target;
  const newFile = moves[0].newFile;
  if (newId === oldId) {
    throw usageError(`${oldId} is already scene ${number} of ${chapterId}`);
  }
  if (project.scenes.some((entry) => entry.id === newId) && !interruptedMove(plan, moves)) {
    throw refusedError(`${newId} already exists: move it first`);
  }
  const warnings = project.scenes.some((entry) => entry.id === newId) ? [] : adoptedReferenceWarnings(project.root, "scene", newId, scene.file, action);
  // The chapter gains the scene's cast before the old scene is deleted, so a
  // move interrupted at that step can still be rerun.
  commitMoves(project.root, plan, moves, () => applyEntityBacklinks(project.root, "scene", newId, readMarkdown(newFile, project.root).data),
    [path.join(project.root, "chapters", `${chapterId}.md`)]);
  const reindexed = reindexProject(project.root);
  return { kind: "scene", oldId, id: newId, file: newFile, moved: 1, changed: [newFile].concat(reindexed.changed), warnings };
}

// story split and story merge restructure chapters with the machinery move
// uses: the chapters after the change are renumbered with moveChapter, scene
// records follow their text with moveScene, and references to a merged
// chapter are rewritten as move rewrites them. Every check runs before the
// first write. The steps each write references before files, but a split or
// merge is several of them, so one stopped part way is finished by hand
// rather than by a rerun.
const RESTRUCTURE_HINT = "Some files were already changed, so a rerun cannot finish the job: run story validate and story links to see what is left, or restore the project from git and run the command again";

// Runs the writes of a split or merge. When a step fails after earlier ones
// wrote, the error says so in place of any rerun hint the step gave, since
// rerunning the whole command would not resume it, unless the error is
// marked `resumable` (a merge that put its last step back). The checks before it
// leave little that can fail (a full disk, a file saved meanwhile), so it is
// exported for tests.
export function restructureWrites(root, write) {
  const { result: error, changes } = recordChanges(root, () => {
    try {
      write();
      return null;
    } catch (caught) {
      return caught;
    }
  });
  if (error !== null) {
    if (changes.length > 0 && !error.resumable) {
      error.hint = RESTRUCTURE_HINT;
    }
    throw error;
  }
}

function existingChapter(project, value, missing) {
  const id = String(value ?? "").trim();
  if (!id) {
    throw usageError(missing);
  }
  requireKebabId(id, "chapter id");
  const chapter = project.chapters.find((entry) => entry.id === id);
  if (!chapter) {
    throw usageError(`chapter ${id} does not exist`);
  }
  return chapter;
}

// The usable choices of every chapter, each with its chapter: none in a
// linear book.
function bookChoices(project) {
  return project.chapters.flatMap((chapter) => chapterChoices(chapter, "").choices.map((choice) => ({ ...choice, chapter })));
}

// A choice as a refusal names it: its file and index.
function choiceLabel(project, chapter, index) {
  return `${relative(project, chapter.file)} choices[${index}]`;
}

// In a branching book a chapter's place comes from the choices that lead to
// it, and its own choices end it. A split or merge there is safe only when
// it changes where no choice leads and what text a choice ends: the
// chapters it splits or joins have no choices (a malformed one counts), and
// no choice leads to `folded`, the chapter a merge folds into the one
// before, since a reader who took it would land at the start of that one
// instead. The renumbering rewrites every other `to`, as move does. Returns
// the book's choices: none in a linear book.
function refuseUnsafeBranching(project, command, chapters, folded = null) {
  const choices = bookChoices(project);
  if (choices.length === 0) {
    return choices;
  }
  const own = chapters.flatMap((chapter) => asArray(chapter.choices).map((choice, index) => `${choiceLabel(project, chapter, index)}${typeof choice?.to === "string" ? ` (to ${choice.to})` : ""}`));
  if (own.length > 0) {
    throw refusedError(`story ${command} works on a branching book only when ${command === "split" ? "the chapter it splits has" : "the chapters it merges have"} no choices, since a chapter's choices end it and a ${command} would change the passage they end: ${own.join(", ")}. Restructure the book by hand with story add chapter, story move, and story remove`);
  }
  const leading = choices.filter((choice) => choice.to === folded?.id).map((choice) => choiceLabel(project, choice.chapter, choice.index));
  if (leading.length > 0) {
    const [it, leads] = leading.length === 1 ? ["it", "leads"] : ["them", "lead"];
    throw refusedError(`story merge works on a branching book only when no choice leads to the chapter it folds into the one before, since a reader who took it would land at the start of ${chapters[0].id} instead: ${leading.join(", ")} ${leads} to ${folded.id}. Point ${it} at another chapter first, or restructure the book by hand with story add chapter, story move, and story remove`);
  }
  return choices;
}

// The choices whose `to` the renumbering of `run` by `step` rewrites, as
// { file, index, text, from, to }: each in its chapter's file after the
// renumbering, for the split or merge to list.
function retargetedChoices(project, choices, run, step) {
  const renumbered = new Map(run.map((entry) => [entry.id, canonicalChapterId(entry.number + step)]));
  return choices.filter((choice) => renumbered.has(choice.to)).map((choice) => ({
    file: renumbered.has(choice.chapter.id) ? `chapters/${renumbered.get(choice.chapter.id)}.md` : relative(project, choice.chapter.file),
    index: choice.index,
    text: choice.text,
    from: choice.to,
    to: renumbered.get(choice.to)
  }));
}

// The chapters numbered `number`, `number + 1`, and so on up to the first
// gap: the run a split or merge renumbers by one. A gap stops it, so the
// rest of the book keeps its numbers.
function followingRun(project, number) {
  const run = [];
  const numbered = (next) => project.chapters.filter((entry) => entry.number === next);
  for (let chapters = numbered(number); chapters.length > 0; chapters = numbered(number + run.length)) {
    if (chapters.length > 1) {
      throw refusedError(`${chapters.map((chapter) => relative(project, chapter.file)).join(" and ")} share chapter number ${chapters[0].number}: give each its own number first (story validate reports it)`);
    }
    run.push(chapters[0]);
  }
  return run;
}

// A split gives one chapter a number no chapter has: the last chapter of
// the run it renumbers moves to the number after the run, or, when no
// chapter follows, the new chapter takes the next number. A file may
// already name that id: a payoff scheduled for a chapter not written yet,
// say. Those references were planned for another chapter, and once they
// named this one a later merge would carry them back with it. A split
// cannot tell what they mean, so it refuses, and the writer points them at
// the chapter they mean first. Every file counts, the renumbered chapter's
// own included, but only the chapter id: a scene id under it is left to the
// adopted-references warning of the move. An abandoned thread may keep the
// id a new chapter takes, as add chapter allows, so it only warns
// (abandonedThreadWarnings). A choice that leads to the id is named by its
// index, since the chapter would take over where it leads.
function refuseSplitAdoption(project, chapter, run) {
  const last = run.at(-1);
  const number = (last ?? chapter).number + 1;
  const target = canonicalChapterId(number);
  const abandoned = new Set(last === undefined ? abandonedThreadFiles(project, target) : []);
  // Registries are left out, since reindex rewrites them, but not the ids
  // written in the timeline and the plot registry's tables.
  const files = adoptedReferenceFiles(project.root, "chapter", target, null, renameChapterIdText)
    .filter((file) => (!REGISTRY_FILES.has(file) || ID_TOKEN_REGISTRIES.has(file)) && !abandoned.has(file));
  if (files.length === 0) {
    return;
  }
  const choices = bookChoices(project).filter((choice) => choice.to === target);
  const named = files.flatMap((file) => {
    const leading = choices.filter((choice) => relative(project, choice.chapter.file) === file);
    return leading.length === 0 ? [file] : leading.map((choice) => choiceLabel(project, choice.chapter, choice.index));
  });
  const [it, them, means, belongs] = named.length === 1 ? ["it", "it", "it means", "it belongs"] : ["they", "them", "they mean", "they belong"];
  const change = last === undefined
    ? `this split would give that id to its new chapter, the rest of ${chapter.id}`
    : `this split would renumber ${last.id} to ${target}`;
  const keep = last === undefined
    ? `${chapter.id} if ${belongs} in the text that moves (then point ${them} at ${target} after the split)`
    : `${last.id} if ${belongs} there (the split then carries ${them} to ${target})`;
  throw refusedError(`${named.join(", ")} ${named.length === 1 ? "names" : "name"} ${target}, which has no file yet, and ${change}, so ${it} would point at that chapter. Point ${them} at the chapter ${means} first: ${keep}, or ${canonicalChapterId(number + 1)} for the chapter after it; nothing was changed`);
}

// Renumbers each chapter of `run` by `step` with move chapter: from the
// highest down when making room, from the lowest up when closing a gap, so
// no number is ever taken twice. `action` is the command, split or merge.
function shiftChapters(root, run, step, warnings, action) {
  for (const chapter of step > 0 ? [...run].reverse() : run) {
    const result = moveChapter(scanProject(root), chapter.id, { number: String(chapter.number + step) }, action);
    warnings.push(...result.warnings);
  }
}

// The files a run of chapters and their scenes occupies.
function chapterRunFiles(project, run) {
  const ids = new Set(run.map((chapter) => chapter.id));
  return [...run.map((chapter) => chapter.file), ...project.scenes.filter((scene) => ids.has(scene.chapter)).map((scene) => scene.file)];
}

// The length frontmatter for a chapter body: word-count, and character-count
// in a book counted in characters.
function chapterLengthFields(body, unit) {
  const prose = chapterProse(body);
  return { "word-count": wordCount(prose), ...(unit.name === "characters" ? { "character-count": characterCount(prose) } : {}) };
}

// A file's own line ending for text the command generates.
function withLineEndings(text, sample) {
  return sample.includes("\r\n") ? text.replace(/\r?\n/g, "\r\n") : text;
}

// The paragraphs of a chapter's prose: runs of lines that are not blank once
// comments and code fences are masked, so a scene break or a marker inside
// either never counts, and each scene-break line on its own, as builds read
// one even with text right above or below it (see breaksParagraph). Each
// has its offsets in the body, its first line's index in the body, its
// masked lines, and whether it is a scene break.
function proseParagraphs(body) {
  const masked = maskMarkup(body);
  const start = proseStart(body, masked);
  const paragraphs = [];
  let offset = 0;
  let line = 0;
  let current = null;
  for (const text of masked.split("\n")) {
    const lineStart = offset;
    offset += text.length + 1;
    if (lineStart >= start && text.trim() !== "" && breaksParagraph(text)) {
      if (current) {
        paragraphs.push(current);
      }
      paragraphs.push({ start: lineStart, line, lines: [{ text, line }], end: lineStart + text.length });
      current = null;
    } else if (lineStart >= start && text.trim() !== "") {
      current ??= { start: lineStart, line, lines: [] };
      current.lines.push({ text, line });
      current.end = lineStart + text.length;
    } else if (current) {
      paragraphs.push(current);
      current = null;
    }
    line += 1;
  }
  if (current) {
    paragraphs.push(current);
  }
  for (const paragraph of paragraphs) {
    paragraph.sceneBreak = isSceneBreakLine(paragraph.lines.map((entry) => entry.text).join("\n"));
  }
  return paragraphs;
}

// Where `--at` splits a chapter body. A number is a scene break, counted from
// 1, and the break itself is dropped. Any other marker names a line of the
// prose: first a line whose text, without heading hashes, is exactly the
// marker, else the one line that contains it; the split falls at the start of
// its paragraph, dropping a scene break just before it. Returns the offset
// the first chapter ends at (`cut`), where the second starts (`start`), how
// many scene breaks come before the split, and whether it falls on one.
function splitPoint(body, marker, chapterId, headerLines) {
  const paragraphs = proseParagraphs(body);
  const breaks = paragraphs.filter((paragraph) => paragraph.sceneBreak);
  let index;
  if (/^\d+$/.test(marker)) {
    const number = Number(marker);
    if (number < 1 || number > breaks.length) {
      throw usageError(breaks.length === 0
        ? `chapter ${chapterId} has no scene breaks in its chapter text: pass --at with a heading or a line of the text instead`
        : `--at ${marker}: chapter ${chapterId} has ${breaks.length} scene ${breaks.length === 1 ? "break" : "breaks"}, so give a number from 1 to ${breaks.length}, or a heading or a line of the text`);
    }
    index = paragraphs.indexOf(breaks[number - 1]) + 1;
  } else {
    const lines = paragraphs.filter((paragraph) => !paragraph.sceneBreak).flatMap((paragraph) => paragraph.lines.map((entry) => ({ ...entry, paragraph })));
    const plain = (text) => text.trim().replace(/^#{1,6}[ \t]+/, "").replace(/[ \t]+#+$/, "").trim();
    let matches = lines.filter((entry) => plain(entry.text) === marker);
    if (matches.length === 0) {
      matches = lines.filter((entry) => entry.text.includes(marker));
    }
    if (matches.length === 0) {
      throw usageError(`--at "${marker}" matches no line in the chapter text of ${chapterId}: give a scene break number, a heading, or a line of the text`);
    }
    if (matches.length > 1) {
      throw usageError(`--at "${marker}" matches ${matches.length} lines in ${chapterId} (lines ${matches.map((entry) => entry.line + headerLines + 1).join(", ")}): quote more of the line so it matches only one`);
    }
    index = paragraphs.indexOf(matches[0].paragraph);
  }
  return splitAt(paragraphs, index, marker, chapterId);
}

// The split before paragraph `index` (see splitPoint), which also locates
// it again after the renumbering has rewritten links in the chapter.
function splitAt(paragraphs, index, marker, chapterId) {
  const breaks = paragraphs.filter((paragraph) => paragraph.sceneBreak);
  const before = paragraphs.slice(0, index);
  const after = paragraphs.slice(index);
  const atBreak = before.length > 0 && before.at(-1).sceneBreak;
  if (!before.some((paragraph) => !paragraph.sceneBreak)) {
    throw usageError(`--at "${marker}" is at the start of the chapter text of ${chapterId}, so nothing would stay in it: split at a later point`);
  }
  if (!after.some((paragraph) => !paragraph.sceneBreak)) {
    throw usageError(`--at "${marker}" is at the end of the chapter text of ${chapterId}, so the new chapter would be empty: split at an earlier point`);
  }
  return {
    index,
    cut: atBreak ? before.at(-1).start : after[0].start,
    start: after[0].start,
    breaksBefore: before.filter((paragraph) => paragraph.sceneBreak).length,
    atBreak,
    sections: breaks.length + 1
  };
}

// The files besides `excluded` that name `chapterId` in a reference field, a
// link to its file, or a bare id in the timeline and arc bodies. Registries
// are left out, since reindex rewrites them, and so are choices: one that
// leads to the chapter leads to its start, which stays in it.
function chapterReferenceFiles(root, chapterId, excluded) {
  const named = entityReferenceContext(root, "chapter", chapterId);
  const context = { ...named, isReferenceKey: (key, listKey) => key !== "to" && named.isReferenceKey(key, listKey) };
  const probe = `${chapterId}-reference-probe`;
  // Only the chapter id itself: its scene ids follow their scenes.
  const plan = planReferenceRewrites(root, context, new Map(excluded.map((file) => [file, null])), idRenamer(chapterId, probe),
    (body, file) => renameIdTokens(root, file, renameLinkTargets(root, file, body, context, probe), chapterId, probe, renameChapterIdText));
  return [...plan.keys()].map((file) => projectPath(root, file)).filter((file) => !REGISTRY_FILES.has(file)).sort();
}

// Chapter fields the new chapter of a split copies from the one it came
// from, the story's own `author` among them, so both halves keep its
// byline. Its hook goes with it too, since the new chapter now ends where the
// old one did; arcs-advanced stays behind, since the arc beat could be in
// either half.
const SPLIT_COPIED_FIELDS = ["numbered", "author", "pov", "locations", "characters", "mentions", "status", "mode", "date", "time", "strand"];

// Every file a rename of these chapter or scene ids rewrites: the reference
// fields, links, and bare ids move rewrites.
function rewrittenFiles(root, kind, ids) {
  const files = new Set();
  for (const id of ids) {
    const context = entityReferenceContext(root, kind, id);
    const probe = `${id}-restructure-probe`;
    const plan = planReferenceRewrites(root, context, new Map(), idRenamer(id, probe),
      (body, file) => renameIdTokens(root, file, renameLinkTargets(root, file, body, context, probe), id, probe));
    plan.forEach((text, file) => files.add(file));
  }
  return [...files];
}

// The checks a split or merge runs before its first write, since a step
// that fails after an earlier one wrote cannot be finished by a rerun:
// every file a step rewrites (the references to each renamed chapter and
// scene, continuity/state.md, the exemptions log, and the registries) must
// be writable, the files it creates must not exist (`chapterTargets`, the
// chapter files the renumbering writes, unless a chapter that moves away
// holds one now), and every scene file of the chapters involved must be
// named for its chapter and scene fields, or the renumbering could collide
// with it part way.
function assertRestructurable(project, { chapters, scenes, changed, created, chapterTargets }) {
  const root = project.root;
  const vacated = new Set(project.chapters.filter((chapter) => chapters.includes(chapter.id)).map((chapter) => chapter.file));
  const occupied = chapterTargets.find((file) => fs.existsSync(file) && !vacated.has(file));
  if (occupied) {
    throw refusedError(`${relative(project, occupied)} already exists and is not a chapter this command renumbers: fix it first (story validate reports it)`);
  }
  const ids = new Set([...chapters, ...chapterTargets.map((file) => path.basename(file, ".md"))]);
  for (const scene of project.scenes) {
    const named = /^(.+)-scene-\d+$/.exec(scene.id)?.[1];
    const expected = `${scene.chapter}-scene-${String(scene.scene).padStart(2, "0")}`;
    if (named !== undefined && (ids.has(scene.chapter) || ids.has(named)) && scene.id !== expected) {
      throw refusedError(`${relative(project, scene.file)} is scene ${scene.scene} of ${scene.chapter} by its frontmatter but not by its file name, so renumbering could collide with it: rename it to scenes/${expected}.md, or fix its chapter and scene fields, first`);
    }
  }
  const fixed = [path.join("continuity", "state.md"), EXEMPTIONS_FILE, ...REGISTRY_FILES].map((file) => path.join(root, file));
  assertWritable(root, [...changed, ...rewrittenFiles(root, "chapter", chapters), ...rewrittenFiles(root, "scene", scenes), ...fixed], created);
}

export function splitChapter(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "split");
  const chapter = existingChapter(project, options.id, "split requires a chapter id");
  const marker = options.at === undefined || options.at === true ? "" : String(options.at).trim();
  if (marker === "") {
    throw usageError("split requires --at <marker>: a scene break number, a heading, or a line of the chapter text");
  }
  let title = `${chapter.title} (continued)`;
  if (options.title !== undefined) {
    title = options.title === true ? "" : String(options.title).trim();
    if (title === "") {
      throw usageError("--title cannot be empty: leave it out to use the chapter's title with (continued)");
    }
    requireSingleLineName(title, "chapter", "title");
  }
  const choices = refuseUnsafeBranching(project, "split", [chapter]);

  const original = readMarkdown(chapter.file, project.root);
  const headerLines = original.rawMarkdown.slice(0, original.rawMarkdown.length - original.body.length).split("\n").length - 1;
  const point = splitPoint(original.body, marker, chapter.id, headerLines);
  const number = chapter.number + 1;
  const newId = canonicalChapterId(number);
  const newFile = path.join(project.root, "chapters", `${newId}.md`);
  const run = followingRun(project, number);
  // In a branching book a chapter with no choices is an ending, so the
  // first half gets one choice, leading on to the rest: without it the
  // reader would stop there, and no choice would lead to the new chapter.
  const added = choices.length === 0 ? null : { file: relative(project, chapter.file), index: 0, text: CONTINUE_CHOICE, to: newId };

  // Scene records have no place in the text, so they follow it in order: the
  // records of the scenes before the split stay, the rest move.
  const scenes = project.scenes.filter((scene) => scene.chapter === chapter.id).sort((left, right) => left.scene - right.scene);
  const keep = point.atBreak ? point.breaksBefore : point.breaksBefore + 1;
  const moving = scenes.slice(keep);
  const label = relative(project, chapter.file);
  const warnings = [];
  if (scenes.length > 0 && scenes.length !== point.sections) {
    warnings.push(warn("split-scenes", `${label} has ${scenes.length} scene ${scenes.length === 1 ? "record" : "records"} but ${point.sections} ${point.sections === 1 ? "scene" : "scenes"} of text between scene breaks, so split kept the first ${Math.min(keep, scenes.length)} in ${chapter.id} and moved ${moving.length === 0 ? "none" : moving.map((scene) => scene.id).join(", ")} to ${newId} by order. Check them, and fix any with story move scene`, label));
  } else if (!point.atBreak && scenes[keep - 1] !== undefined) {
    warnings.push(warn("split-scenes", `--at "${marker}" falls inside the text of ${scenes[keep - 1].id}, whose record stays in ${chapter.id}; if the scene now belongs to ${newId}, or needs a record in each, use story move scene and story add scene`, label));
  }
  // With no chapter after it, the new half takes a number no chapter had.
  if (run.length === 0) {
    warnings.push(...abandonedThreadWarnings(project, newId));
  }
  const referencing = chapterReferenceFiles(project.root, chapter.id, [chapter.file, ...scenes.map((scene) => scene.file)]);
  if (referencing.length > 0) {
    warnings.push(warn("split-references", `${referencing.join(", ")} still ${referencing.length === 1 ? "names" : "name"} ${chapter.id}, which now holds only the text before the split: check whether ${referencing.length === 1 ? "it" : "any of them"} should name ${newId} instead`, referencing.length === 1 ? referencing[0] : null));
  }
  const runIds = new Set(run.map((entry) => entry.id));
  const chapterTargets = [newFile, ...run.map((entry) => path.join(project.root, "chapters", `${canonicalChapterId(entry.number + 1)}.md`))];
  assertRestructurable(project, {
    chapters: [chapter.id, ...runIds],
    scenes: [...moving, ...project.scenes.filter((scene) => runIds.has(scene.chapter))].map((scene) => scene.id),
    changed: [chapter.file, ...chapterRunFiles(project, run), ...moving.map((scene) => scene.file)],
    created: [...chapterTargets, ...moving.map((scene, index) => path.join(project.root, "scenes", `${newId}-scene-${String(index + 1).padStart(2, "0")}.md`))],
    chapterTargets
  });
  refuseSplitAdoption(project, chapter, run);
  // A character who dies in the chapter cannot be in the cast of a later
  // one, so the new chapter only mentions them; split-references lists the
  // death to check.
  const dead = new Set(project.characters.filter((character) => character.diedIn === chapter.id).map((character) => character.id));

  restructureWrites(project.root, () => {
    shiftChapters(project.root, run, 1, warnings, "split");
    // The renumbering can rewrite link targets in the chapter, which moves
    // offsets but never paragraphs, so split what it holds now at the same
    // paragraph.
    const current = scanProject(project.root);
    const markdown = readMarkdown(chapter.file, project.root);
    const split = splitAt(proseParagraphs(markdown.body), point.index, marker, chapter.id);
    const firstBody = withLineEndings(`${markdown.body.slice(0, split.cut).trimEnd()}\n`, markdown.rawMarkdown);
    const secondProse = `${markdown.body.slice(split.start).trimEnd()}\n`;
    const { hook, ...kept } = markdown.data;
    const copied = Object.fromEntries(SPLIT_COPIED_FIELDS.filter((key) => Object.hasOwn(markdown.data, key)).map((key) => [key, markdown.data[key]]));
    const departed = asArray(copied.characters).filter((id) => dead.has(id));
    if (departed.length > 0) {
      copied.characters = asArray(copied.characters).filter((id) => !dead.has(id));
      copied.mentions = [...new Set([...asArray(copied.mentions), ...departed])];
    }
    // An unnumbered chapter (a prologue) is headed by its title alone.
    const secondBody = `# ${markdown.data.numbered === false ? title : chapterHeading(number, title)}\n\n## Chapter Text\n\n${secondProse}`;
    const secondData = {
      title,
      number,
      ...copied,
      "arcs-advanced": [],
      ...(hook === undefined ? {} : { hook }),
      ...chapterLengthFields(secondBody, current.unit)
    };
    writeFile(newFile, withLineEndings(`${stringifyFrontmatter(secondData)}${secondBody}`, markdown.rawMarkdown), { root: project.root, unchangedFrom: null });
    const leadOn = added === null ? {} : { choices: [{ text: added.text, to: added.to }] };
    writeFile(chapter.file, replaceFrontmatter(markdown.rawMarkdown, { ...kept, ...leadOn, ...chapterLengthFields(firstBody, current.unit) }, firstBody),
      { root: project.root, unchangedFrom: markdown.rawMarkdown });
    // The latest drafted chapter is now the second half.
    setCurrentChapter(project.root, chapter.number, number);
    for (const [index, scene] of moving.entries()) {
      warnings.push(...moveScene(scanProject(project.root), scene.id, { chapter: newId, scene: String(index + 1) }, "split").warnings);
    }
  });
  const reindexed = reindexProject(project.root);
  return {
    kind: "chapter",
    id: chapter.id,
    newId,
    title,
    file: newFile,
    scenesMoved: moving.length,
    renumbered: run.length,
    choiceAdded: added,
    choicesRetargeted: retargetedChoices(project, choices, run, 1),
    changed: [chapter.file, newFile].concat(reindexed.changed),
    warnings
  };
}

// Sets continuity/state.md current-chapter to `to` when it holds `from`.
function setCurrentChapter(root, from, to, plan = null) {
  const statePath = path.join(root, "continuity", "state.md");
  if (!fs.existsSync(statePath)) {
    return;
  }
  const text = plan?.get(statePath) ?? readTextFile(statePath);
  const data = parseFrontmatter(text, statePath).data;
  if (data["current-chapter"] !== from) {
    return;
  }
  const next = replaceFrontmatter(text, { ...data, "current-chapter": to });
  if (plan) {
    if (!plan.has(statePath)) {
      plan.originals.set(statePath, text);
    }
    plan.set(statePath, next);
  } else {
    writeFile(statePath, next, { root, unchangedFrom: text });
  }
}

export function mergeChapters(root, options) {
  const project = scanProject(root);
  assertProjectParses(project, "merge");
  const missing = "merge requires two chapter ids: the chapter to keep, then the one after it";
  const first = existingChapter(project, options.id, missing);
  const second = existingChapter(project, options.next, missing);
  if (first === second) {
    throw usageError(`merge needs two different chapters, got ${first.id} twice`);
  }
  const position = project.chapters.indexOf(first);
  if (project.chapters[position + 1] !== second) {
    const secondPosition = project.chapters.indexOf(second);
    if (secondPosition < position) {
      throw usageError(`${second.id} comes before ${first.id}: name the earlier chapter first (story merge ${second.id} ${first.id})`);
    }
    const between = project.chapters.slice(position + 1, secondPosition).map((chapter) => chapter.id);
    throw usageError(`${second.id} does not follow ${first.id}: merge takes neighbouring chapters, and ${between.join(", ")} ${between.length === 1 ? "comes" : "come"} between them`);
  }
  const choices = refuseUnsafeBranching(project, "merge", [first, second], second);

  const scenes = project.scenes.filter((scene) => scene.chapter === second.id).sort((left, right) => left.scene - right.scene);
  const firstScene = nextSceneNumber(project, first.id);
  const sceneFiles = scenes.map((scene, index) => path.join(project.root, "scenes", `${first.id}-scene-${String(firstScene + index).padStart(2, "0")}.md`));
  const taken = sceneFiles.find((file) => fs.existsSync(file));
  if (taken) {
    throw refusedError(`${relative(project, taken)} already exists; nothing was changed`);
  }
  const run = followingRun(project, second.number + 1);
  const runIds = new Set(run.map((entry) => entry.id));
  assertRestructurable(project, {
    chapters: [first.id, second.id, ...runIds],
    scenes: [...scenes, ...project.scenes.filter((scene) => runIds.has(scene.chapter))].map((scene) => scene.id),
    changed: [first.file, second.file, ...scenes.map((scene) => scene.file), ...chapterRunFiles(project, run)],
    created: sceneFiles,
    chapterTargets: run.map((entry) => path.join(project.root, "chapters", `${canonicalChapterId(entry.number - 1)}.md`))
  });

  const warnings = [];
  restructureWrites(project.root, () => {
    // The scenes go first, so the chapter they leave is the only file that
    // still names it by id.
    for (const [index, scene] of scenes.entries()) {
      warnings.push(...moveScene(scanProject(project.root), scene.id, { chapter: first.id, scene: String(firstScene + index) }, "merge").warnings);
    }
    const current = scanProject(project.root);
    const kept = readMarkdown(first.file, project.root);
    const gone = readMarkdown(second.file, project.root);
    const merged = mergedChapter(kept, gone, current.unit, first.id, second.id);
    warnings.push(...merged.warnings);
    const context = entityReferenceContext(project.root, "chapter", second.id);
    const plan = planReferenceRewrites(project.root, context, new Map([[first.file, merged.text], [second.file, null]]),
      idRenamer(second.id, first.id),
      (body, file) => renameIdTokens(project.root, file, renameLinkTargets(project.root, file, body, context, first.id), second.id, first.id));
    plan.originals.set(first.file, kept.rawMarkdown);
    setCurrentChapter(project.root, second.number, first.number, plan);
    followExemptionPatterns(project.root, plan, "chapter", second.id, first.id);
    followQueryFilters(project.root, plan, "chapter", second.id, first.id);
    reorderProgressions(current, plan, chapterChronology(current));
    warnings.push(...mergeProgressions(project.root, plan, first.id));
    assertWritable(project.root, [...plan.keys(), second.file]);
    writeReferencePlan(project.root, plan);
    try {
      removeFile(second.file, { root: project.root, unchangedFrom: gone.rawMarkdown });
    } catch (error) {
      // Saved since it was read: the merged text lacks the save, so this
      // step is put back. The scenes already moved stay with the first
      // chapter, and a rerun merges the rest.
      if (error.changedOnDisk) {
        undoReferencePlan(project.root, plan);
        Object.assign(error, {
          message: `${relative(project, second.file)} changed on disk while story was merging it into ${first.id}, so it was left as it is and ${relative(project, first.file)} was put back`,
          hint: "Run the same command again to merge it with the change",
          resumable: true
        });
      }
      throw error;
    }
    shiftChapters(project.root, run, -1, warnings, "merge");
  });
  const reindexed = reindexProject(project.root);
  return {
    kind: "chapter",
    id: first.id,
    mergedId: second.id,
    file: first.file,
    scenesMoved: scenes.length,
    renumbered: run.length,
    choicesRetargeted: retargetedChoices(project, choices, run, -1),
    changed: [first.file].concat(reindexed.changed),
    warnings
  };
}

// After a merge, two progressions of one field can start in the kept
// chapter: one from each half. The later one is the value the chapter ends
// with, so it is kept and the earlier dropped, which validate would
// otherwise reject as a repeat.
function mergeProgressions(root, plan, chapterId) {
  const dirs = PROGRESSION_KINDS.map((kind) => entityConfig(kind).dir);
  const warnings = [];
  for (const [file, text] of plan) {
    if (text === null || !dirs.includes(projectPath(root, path.dirname(file)))) {
      continue;
    }
    const data = parseFrontmatter(text, file).data;
    if (!Array.isArray(data.progressions)) {
      continue;
    }
    const last = new Map();
    data.progressions.forEach((item, index) => {
      if (item && typeof item === "object" && !Array.isArray(item) && idText(item.from) === chapterId && typeof item.field === "string") {
        last.set(item.field, index);
      }
    });
    const dropped = [];
    const progressions = data.progressions.filter((item, index) => {
      const repeated = item && typeof item === "object" && !Array.isArray(item) && idText(item.from) === chapterId
        && typeof item.field === "string" && last.get(item.field) !== index;
      if (repeated) {
        dropped.push(`${item.field} ${JSON.stringify(item.value)}`);
      }
      return !repeated;
    });
    if (dropped.length > 0) {
      plan.set(file, replaceFrontmatter(text, { ...data, progressions }));
      const label = projectPath(root, file);
      warnings.push(warn("merge-conflicts", `${label} changed the same ${dropped.length === 1 ? "field" : "fields"} in both merged chapters; the earlier ${dropped.length === 1 ? "progression" : "progressions"} (${dropped.join(", ")}) ${dropped.length === 1 ? "was" : "were"} dropped and the later value kept from ${chapterId}`, label));
    }
  }
  return warnings;
}

const BLANK_VALUES = [undefined, null, ""];

function isBlankValue(value) {
  return BLANK_VALUES.includes(value) || (Array.isArray(value) && value.length === 0);
}

// Chapter fields a merge never takes from the second chapter: it works them
// out, or keeps the first chapter's `numbered`, since a missing one means
// true (mergedChapter warns when the two differ).
const MERGE_DERIVED_FIELDS = new Set(["title", "number", "word-count", "character-count", "hook", "numbered"]);
const MERGE_SUMMED_FIELDS = new Set(["target-words", "target-characters"]);

// The frontmatter of two merged chapters: the first chapter's, with lists
// joined (each item once), a field only the second sets added, targets
// summed, the earlier status of the two, and the second chapter's hook, since
// the merged chapter ends where the second did. Any other field the two set
// differently keeps the first chapter's value and is listed in `conflicts`.
function mergedChapterData(firstData, secondData) {
  const data = { ...firstData };
  const conflicts = [];
  const statuses = [...CHAPTER_STATUSES];
  for (const [key, value] of Object.entries(secondData)) {
    if (MERGE_DERIVED_FIELDS.has(key) || isBlankValue(value)) {
      continue;
    }
    const current = firstData[key];
    if (!Object.hasOwn(firstData, key) || isBlankValue(current)) {
      data[key] = value;
    } else if (Array.isArray(current) && Array.isArray(value)) {
      const seen = new Set(current.map((item) => JSON.stringify(item)));
      data[key] = current.concat(value.filter((item) => !seen.has(JSON.stringify(item)) && seen.add(JSON.stringify(item))));
    } else if (MERGE_SUMMED_FIELDS.has(key) && Number.isInteger(current) && Number.isInteger(value)) {
      data[key] = current + value;
    } else if (key === "status" && statuses.includes(current) && statuses.includes(value)) {
      data[key] = statuses[Math.min(statuses.indexOf(current), statuses.indexOf(value))];
    } else if (JSON.stringify(current) !== JSON.stringify(value)) {
      conflicts.push(`${key} ${JSON.stringify(value)}`);
    }
  }
  if (!isBlankValue(secondData.hook)) {
    data.hook = secondData.hook;
  } else if (Object.hasOwn(data, "hook")) {
    delete data.hook;
  }
  const droppedHook = isBlankValue(secondData.hook) && !isBlankValue(firstData.hook) ? firstData.hook : null;
  return { data, conflicts, droppedHook };
}

const CHAPTER_TEXT_HEADING = /^ {0,3}##[ \t]+Chapter Text(?:[ \t]+#+)?[ \t]*\r?$/i;
const NOTE_SECTION_HEADING = /^ {0,3}##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*\r?$/gm;

// The lines that close a chapter's notes: the outline divider and the
// `## Chapter Text` heading, as masked text.
function closesNotes(line) {
  const text = line.trim();
  return text === "---" || CHAPTER_TEXT_HEADING.test(text);
}

// The chapter's own `# heading` before `limit`: its first level-1 heading
// when no `##` section comes before it, else its first `# Chapter N`. So a
// level-1 heading among the notes (`# Ideas` under `## Outline`) is not
// taken for it.
function ownHeading(body, masked, limit) {
  const headings = levelOneHeadings(body, masked, limit);
  const section = /^ {0,3}#{2,6}(?:[ \t]|\r?$)/m.exec(masked.slice(0, limit));
  if (headings.length > 0 && (section === null || headings[0].index < section.index)) {
    return headings[0];
  }
  return headings.find((entry) => CHAPTER_NUMBER_HEADING.test(entry.line)) ?? null;
}

// The planning notes of a chapter body: what lies between its `# heading`
// and its prose (the outline and any other `##` sections), as offsets in the
// body, without the blank lines, comments, outline divider, and `## Chapter
// Text` heading that close them. `lead` is where the heading starts.
function chapterNotesRange(body, masked, proseOffset) {
  const heading = ownHeading(body, masked, proseOffset);
  const lead = heading ? heading.index : 0;
  const start = heading ? heading.end : 0;
  const lines = masked.slice(start, proseOffset).split("\n");
  let offset = start;
  const starts = lines.map((line) => {
    const lineStart = offset;
    offset += line.length + 1;
    return lineStart;
  });
  let end = proseOffset;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() !== "" && !closesNotes(lines[index])) {
      break;
    }
    end = starts[index];
  }
  // The notes end after the last text masked text shows, and after any
  // comment that opens on that line, so the comment stays on its line and
  // the notes never end inside it.
  let cut = start + masked.slice(start, end).trimEnd().length;
  for (let open = cut > start ? commentOnLine(body, cut) : -1; open !== -1; open = commentOnLine(body, cut)) {
    cut = body.indexOf("-->", open + 4) + 3;
  }
  return { lead, start, end: cut };
}

// Where a comment opens on the rest of the line at `offset`, if only blanks
// come before it, or -1.
function commentOnLine(body, offset) {
  const lineEnd = body.indexOf("\n", offset);
  const rest = body.slice(offset, lineEnd === -1 ? body.length : lineEnd);
  const open = offset + rest.search(/\S|$/);
  return body.startsWith("<!--", open) ? open : -1;
}

// The notes of the chapter a merge folds in, as its text and masked text:
// everything before its prose but its `# heading`, the outline divider, and
// the `## Chapter Text` heading. So text above the heading and a comment
// after the notes, which masked text shows as blank, are kept.
function foldedNotes(body, masked, proseOffset) {
  const range = chapterNotesRange(body, masked, proseOffset);
  const lines = body.slice(range.end, proseOffset).split("\n");
  const closing = masked.slice(range.end, proseOffset).split("\n").map(closesNotes);
  // A closing line goes with the blank line after it.
  const dropped = lines.map((line, index) => closing[index] || (index > 0 && closing[index - 1] && line.trim() === ""));
  const after = (text) => text.slice(range.end, proseOffset).split("\n").filter((line, index) => !dropped[index]).join("\n");
  const tail = after(body);
  const from = tail.length - tail.trimStart().length;
  const to = tail.trimEnd().length;
  const notes = (text) => `${text.slice(0, range.lead)}${text.slice(range.start, range.end)}${to > from ? `\n\n${after(text).slice(from, to)}` : ""}`;
  return { text: notes(body), masked: notes(masked) };
}

// Notes as a preamble and `##` sections, each { key, heading, body }.
function noteSections(text, masked) {
  const headings = [...masked.matchAll(NOTE_SECTION_HEADING)];
  const sections = headings.map((match, index) => {
    const lineEnd = match.index + match[0].length;
    return {
      key: match[1].trim().toLowerCase(),
      heading: text.slice(match.index, lineEnd).replace(/\r$/, ""),
      body: text.slice(lineEnd, index + 1 < headings.length ? headings[index + 1].index : text.length)
    };
  });
  return { preamble: text.slice(0, headings[0]?.index ?? text.length), sections };
}

// Joins two blocks of notes: a list continues on the next line, anything
// else after a blank line.
function joinNotes(first, second) {
  const left = first.trimEnd();
  const right = second.trim();
  if (left.trim() === "" || right === "") {
    return left.trim() === "" ? right : left;
  }
  const listItem = /^\s*(?:[-*+]|\d+[.)])[ \t]/;
  return `${left}${listItem.test(left.split("\n").at(-1)) && listItem.test(right.split("\n")[0]) ? "\n" : "\n\n"}${right}`;
}

// The body of two merged chapters: the first chapter's heading and notes,
// with the second chapter's notes added section by section (its outline
// beats after the first one's, a section only it has at the end), then the
// first chapter's prose, a scene break, and the second chapter's prose. The
// scene break is the first one either chapter already uses, else `* * *`.
// Of the second chapter's text, only its heading, outline divider, and
// `## Chapter Text` heading are dropped.
function mergedChapterBody(firstBody, secondBody, firstNumber, secondNumber) {
  const firstMasked = maskMarkup(firstBody);
  const secondMasked = maskMarkup(secondBody);
  const firstStart = mergedProseStart(firstBody, firstMasked, firstNumber);
  const secondStart = mergedProseStart(secondBody, secondMasked, secondNumber);
  let head = firstBody.slice(0, firstStart);
  let firstProse = firstBody.slice(firstStart);
  const secondNotes = foldedNotes(secondBody, secondMasked, secondStart);
  if (secondNotes.text.trim() !== "") {
    const firstRange = chapterNotesRange(firstBody, firstMasked, firstStart);
    const notes = noteSections(firstBody.slice(firstRange.start, firstRange.end), firstMasked.slice(firstRange.start, firstRange.end));
    const added = noteSections(secondNotes.text, secondNotes.masked);
    notes.preamble = joinNotes(notes.preamble, added.preamble);
    for (const section of added.sections) {
      const match = notes.sections.find((entry) => entry.key === section.key);
      if (match) {
        match.body = joinNotes(match.body, section.body);
      } else {
        notes.sections.push(section);
      }
    }
    const text = [notes.preamble.trim(), ...notes.sections.map((section) => joinNotes(section.heading, section.body))].filter((part) => part !== "").join("\n\n");
    const tail = head.slice(firstRange.end);
    head = `${head.slice(0, firstRange.start)}\n${text}${firstRange.end === firstRange.start ? "\n" : ""}${tail}`;
    // The notes need a `## Chapter Text` heading after them to stay out of
    // the prose.
    if (!firstMasked.slice(0, firstStart).split("\n").some((line) => CHAPTER_TEXT_HEADING.test(line))) {
      head = `${head.trimEnd()}\n\n## Chapter Text\n\n`;
      firstProse = firstProse.replace(/^(?:[ \t]*\r?\n)+/, "");
    }
  }
  const blankLines = /^(?:[ \t]*\r?\n)*/;
  const lead = firstProse.match(blankLines)[0] || (head === "" || head.endsWith("\n") ? "" : "\n\n");
  const firstText = firstProse.replace(blankLines, "").trimEnd();
  const secondProse = secondBody.slice(secondStart).replace(blankLines, "").trimEnd();
  const parts = [firstText];
  if (firstText !== "" && secondProse !== "") {
    parts.push(sceneBreakLine(firstBody) ?? sceneBreakLine(secondBody) ?? "* * *");
  }
  parts.push(secondProse);
  return `${head}${lead}${parts.filter((part) => part !== "").join("\n\n")}\n`;
}

// Where a merge takes a chapter's prose to start. A chapter with no
// `## Chapter Text` or outline and text above its heading reads as prose
// from the top, heading and all; a merge still ends the part above the
// prose at its heading, when that is its first level-1 heading and reads
// `# Chapter N` with its own number.
function mergedProseStart(body, masked, number) {
  const start = proseStart(body, masked);
  const heading = start === 0 ? levelOneHeadings(body, masked)[0] : undefined;
  const match = heading === undefined ? null : CHAPTER_NUMBER_HEADING.exec(heading.line);
  return match !== null && Number(match[2]) === number ? heading.end : start;
}

// The first scene break line a chapter body's prose uses, or null.
function sceneBreakLine(body) {
  const paragraph = proseParagraphs(body).find((entry) => entry.sceneBreak);
  return paragraph ? body.slice(paragraph.start, paragraph.end).trim() : null;
}

// The merged chapter file, from the first chapter's markdown, with the
// warnings for fields the second set differently.
function mergedChapter(first, second, unit, firstId, secondId) {
  const body = withLineEndings(mergedChapterBody(first.body, second.body, first.data.number, second.data.number), first.rawMarkdown);
  const { data, conflicts, droppedHook } = mergedChapterData(first.data, second.data);
  const label = `chapters/${firstId}.md`;
  const warnings = [];
  if (conflicts.length > 0) {
    warnings.push(warn("merge-conflicts", `${secondId} set ${conflicts.join(", ")}, which the merged ${firstId} does not take: it keeps ${firstId}'s values. Check them`, label));
  }
  if (droppedHook !== null) {
    warnings.push(warn("merge-conflicts", `${firstId}'s hook ${JSON.stringify(droppedHook)} was dropped: the merged chapter ends where ${secondId} did, and ${secondId} had no hook. Set one if it needs it`, label));
  }
  // The merged chapter keeps the first chapter's numbering, so a merge with
  // an unnumbered chapter (a prologue, an interlude) never changes which
  // chapters the builds number without saying so.
  const numbered = (data) => data.numbered !== false;
  if (numbered(first.data) !== numbered(second.data)) {
    warnings.push(warn("merge-conflicts", numbered(first.data)
      ? `${secondId} is unnumbered (numbered: false) but ${firstId} is not: the merged ${firstId} stays numbered. Set numbered: false on it if it should not be`
      : `${firstId} is unnumbered (numbered: false) but ${secondId} is not: the merged ${firstId} stays unnumbered. Remove numbered: false from it if it should be numbered`, label));
  }
  return { text: replaceFrontmatter(first.rawMarkdown, { ...data, ...chapterLengthFields(body, unit) }, body), warnings };
}

const BEFORE_STORY_FIELDS = ["died-in", "since", "learned-in"];

// The files besides `excludedFile` (when not null) that already reference
// `id` (a scheduled chapter, a planned character, a link left by remove): an
// entity given that id takes them over. `rename` finds bare ids.
function adoptedReferenceFiles(root, kind, id, excludedFile, rename = renameIdText) {
  const context = entityReferenceContext(root, kind, id);
  const probe = `${id}-adopted-probe`;
  const numbered = kind === "chapter" || kind === "scene";
  const plan = planReferenceRewrites(root, context, new Map(excludedFile === null ? [] : [[excludedFile, null]]), idRenamer(id, probe), (body, file) => {
    const relinked = renameLinkTargets(root, file, body, context, probe);
    return numbered ? renameIdTokens(root, file, relinked, id, probe, rename) : relinked;
  });
  return [...plan.keys()].map((file) => projectPath(root, file)).sort();
}

// Before a rename or move gives an entity `id`, warns about the references
// it takes over. `action` names the command: rename, move, or split or merge,
// which move chapters and scenes as move does. Only a warning, since an
// interrupted run that is rerun leaves the same references.
function adoptedReferenceWarnings(root, kind, id, excludedFile, action) {
  const files = adoptedReferenceFiles(root, kind, id, excludedFile);
  if (files.length === 0) {
    return [];
  }
  return [warn("adopted-references", `${id} was already referenced before this ${action}, and those references now point at the ${action === "rename" ? "renamed" : "moved"} ${kind}: ${files.join(", ")}. Check them`)];
}

// links lets an abandoned promise, clue, or question keep the chapter-NN it
// was planned for, so a new chapter with that id adopts the cut thread. move
// and rename report every adopted reference; add chapter and split's new
// chapter report these (split refuses any other reference to the id).
function abandonedThreadFiles(project, chapterId) {
  return [...project.promises, ...project.clues, ...project.questions]
    .filter((entry) => entry.status === "abandoned" && [entry.planted, entry.payoff, entry.introduced].includes(chapterId))
    .map((entry) => projectPath(project.root, entry.file))
    .sort();
}

function abandonedThreadWarnings(project, chapterId) {
  const files = abandonedThreadFiles(project, chapterId);
  if (files.length === 0) {
    return [];
  }
  return [warn("adopted-references", `${chapterId} was already named by abandoned threads, and those references now point at the new chapter: ${files.join(", ")}. Clear them if the cut threads do not belong there`)];
}

function idRenamer(oldId, newId) {
  return (value) => (value === oldId ? newId : value);
}

// Bare chapter and scene ids in plot/timeline.md and arc bodies, which links
// checks, and in the plot/_index.md theme tracking table follow the move. `chapter-03` never matches inside `chapter-03-scene-01`
// unless the whole scene id is the one moving, and scene ids of a moved chapter
// (`chapter-03-scene-02`) follow it too.
// The registries whose bodies hold bare ids that people write.
const ID_TOKEN_REGISTRIES = new Set(["plot/timeline.md", "plot/_index.md"]);

function renameIdTokens(root, file, body, oldId, newId, rename = renameIdText) {
  const relativePath = projectPath(root, file);
  if (!ID_TOKEN_REGISTRIES.has(relativePath) && path.posix.dirname(relativePath) !== "plot/arcs") {
    return body;
  }
  // Link destinations were already handled by renameLinkTargets, and a URL
  // or a path into another book is not this book's id.
  return mapOutsideLinks(body, (text) => rename(text, oldId, newId));
}

// Replaces whole-token chapter id `oldId` in text, but not the scene ids
// that start with it.
function renameChapterIdText(text, oldId, newId) {
  return text.replace(new RegExp(`(?<![\\w-])${escapeRegExp(oldId)}(?![\\w-])`, "g"), newId);
}

// Replaces whole-token `oldId` in text, and the scene ids of a chapter id.
function renameIdText(text, oldId, newId) {
  return text
    .replace(new RegExp(`(?<![\\w-])${escapeRegExp(oldId)}-scene-(\\d+)(?![\\w-])`, "g"), `${newId}-scene-$1`)
    .replace(new RegExp(`(?<![\\w-])${escapeRegExp(oldId)}(?![\\w-])`, "g"), newId);
}

// Writes every rewritten reference, then each moved file at its new path,
// then deletes the old paths. A file already at a new path is refused unless
// it is byte for byte what this move writes there: then an earlier run was
// interrupted after writing it, and this run finishes the job. The text of
// each moving file is the one the plan read (plan.originals), so an edit
// saved since is never lost with the old path.
function commitMoves(root, plan, moves, beforeDelete = () => {}, alsoChanged = []) {
  const originals = moves.map((move) => plan.originals?.get(move.oldFile) ?? readTextFile(move.oldFile));
  const contents = moves.map((move, index) => plan.get(move.oldFile) ?? originals[index]);
  const interrupted = interruptedMove(plan, moves);
  const present = moves.map((move) => fs.existsSync(move.newFile));
  moves.forEach((move, index) => {
    if (present[index] && !interrupted) {
      throw refusedError(`${projectPath(root, move.newFile)} already exists; nothing was changed`);
    }
  });
  for (const move of moves) {
    plan.delete(move.oldFile);
  }
  assertWritable(root, [...plan.keys(), ...moves.map((move) => move.oldFile), ...alsoChanged], moves.map((move) => move.newFile));
  commitWrites(() => {
    writeReferencePlan(root, plan);
    // A file an interrupted run wrote already holds these contents.
    moves.forEach((move, index) => writeFile(move.newFile, contents[index], { root, unchangedFrom: present[index] ? contents[index] : null }));
    beforeDelete();
    // A chapter's scenes go before the chapter, so a rerun still finds the
    // chapter and its remaining scenes.
    for (const index of [...moves.keys()].reverse()) {
      removeMovedFile(root, { ...moves[index], original: originals[index], written: contents[index] });
    }
  });
}

// Deletes the old file of a renamed or moved entity, unless it changed on
// disk after the command read it: then the copy just written at the new
// path is deleted instead, so the change is kept and a rerun moves the file
// with it.
function removeMovedFile(root, { oldFile, original, newFile, written }) {
  try {
    removeFile(oldFile, { root, unchangedFrom: original });
  } catch (error) {
    if (error.changedOnDisk) {
      removeFile(newFile, { root, unchangedFrom: written });
      error.message = `${error.message}, and the copy written at ${projectPath(root, newFile)} was removed`;
      error.hint = "Run the same command again to finish with the change";
    }
    throw error;
  }
}

// An earlier run of this move was killed after writing the new files when
// every file already at a new path is byte for byte what this move writes
// there, and nothing but the moving files still names the old ids: the
// references, registries included, were rewritten first. Two placeholder
// chapters that happen to match still differ there, as the registry lists
// the old one.
function interruptedMove(plan, moves) {
  const moving = new Set(moves.map((move) => move.oldFile));
  if ([...plan.keys()].some((file) => !moving.has(file))) {
    return false;
  }
  return moves.every((move) => !fs.existsSync(move.newFile)
    || readTextFile(move.newFile) === (plan.get(move.oldFile) ?? readTextFile(move.oldFile)));
}

function ensureDirectory(directory, changed, root) {
  if (!fs.existsSync(directory)) {
    assertLexicallyInsideRoot(directory, root);
    assertExistingAncestorInsideRoot(directory, root);
    makeDirectories(directory);
    assertSafeProjectDirectory(directory, root);
    changed.push(directory);
    return;
  }

  assertSafeProjectDirectory(directory, root);
}

function ensureFile(filePath, contents, changed, root) {
  if (!fs.existsSync(filePath)) {
    writeFile(filePath, contents, { root, unchangedFrom: null });
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
  "controlled-by": MULTI_KIND_REFERENCE_FIELDS["controlled-by"],
  "died-in": ["chapter"],
  "revived-in": ["chapter"],
  introduced: ["chapter"],
  "learned-in": ["chapter"],
  "used-in": ["chapter"],
  location: ["location"],
  locations: ["location"],
  members: ["character"],
  mentions: MULTI_KIND_REFERENCE_FIELDS.mentions,
  "notable-characters": ["character"],
  owner: MULTI_KIND_REFERENCE_FIELDS.owner,
  payoff: ["chapter"],
  planted: ["chapter"],
  pov: ["character"],
  resolved: ["chapter"],
  since: ["chapter"],
  // A scene's state-changes `target` names the artifact the prop custody
  // check follows.
  target: ["artifact"]
};

// Nested mapping lists whose entries are identified by one reference key.
// Removing the entity named by that key drops the whole entry; removing an
// entity named by any other key only clears that field.
const ENTRY_IDENTITY_FIELDS = {
  relationships: "character",
  "character-state": "character",
  "knowledge-state": "character",
  "object-state": "artifact",
  // A progression takes effect from a chapter; see transformReferences.
  progressions: "from",
  routes: "to",
  choices: "to"
};

// The kind a nested `to` names, by the list it sits in: a location's route
// leads to a location, a chapter's choice to a chapter.
const NESTED_TO_KINDS = { routes: "location", choices: "chapter" };

// Describes the entity being renamed or removed. A frontmatter key counts as
// a reference to it only when the key can point at its kind. A key that may
// point at several kinds (owner, controlled-by, mentions) is left alone when
// another of those kinds has an entity with the same id, because the
// reference is then ambiguous (see ambiguousReferenceWarnings).
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
    isReferenceKey: (key, listKey = null) => {
      if (key === "to") {
        return listKey !== null && Object.hasOwn(NESTED_TO_KINDS, listKey) && NESTED_TO_KINDS[listKey] === kind;
      }
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
  const retarget = (target) => target.replace(new RegExp(`(^|/|<)${escapeRegExp(context.id)}\\.md(?=$|[#?>\\s])`), `$1${newId}.md`);
  return body.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, (match, text, target) => {
    if (resolveLinkTarget(root, file, target) !== context.entityFile) {
      return match;
    }
    const nextText = text === context.id ? newId : text;
    return `[${nextText}](${retarget(target)})`;
  }).replace(LINK_DEFINITION_PATTERN, (match, open, label, target) => {
    if (resolveLinkTarget(root, file, target) !== context.entityFile) {
      return match;
    }
    return `${match.slice(0, match.length - target.length)}${retarget(target)}`;
  });
}

function replaceEntityReferences(root, kind, oldId, newId, overrides) {
  const context = entityReferenceContext(root, kind, oldId);
  return planReferenceRewrites(root, context, overrides,
    (value) => (idText(value) === oldId ? newId : value),
    (body, file) => renameLinkTargets(root, file, body, context, newId));
}

function removeEntityReferences(root, kind, id, overrides) {
  const context = entityReferenceContext(root, kind, id);
  return planReferenceRewrites(root, context, overrides, (value) => (idText(value) === id ? null : value), (body) => body);
}

// Reads and rewrites every markdown file in memory before anything is written,
// so an unparsable file aborts the command with the project untouched. Returns
// a Map of file path to new contents; `overrides` supplies in-memory contents
// for files that are about to change (or null for files about to be deleted).
function planReferenceRewrites(root, context, overrides, transform, transformBody) {
  const plan = new Map();
  // The text each rewrite was planned from, so a file saved meanwhile is not
  // overwritten.
  plan.originals = new Map();
  const storyFile = path.join(root, "story.md");
  let otherFiles = 0;
  for (const file of markdownFiles(root, { maxFiles: Infinity })) {
    const override = overrides?.has(file) ? overrides.get(file) : undefined;
    if (override === null) {
      continue;
    }
    const sourceFile = isProjectSourceFile(root, file);
    let text = override;
    if (text === undefined) {
      assertSafeProjectPath(file, root);
      // Notes outside the project model past the scan limits (an oversized
      // clipping, a huge research dump) are skipped, as validate ignores them.
      if (!sourceFile) {
        otherFiles += 1;
        if (otherFiles > MAX_SCAN_FILES || fs.lstatSync(file).size > MAX_SCAN_FILE_BYTES) {
          continue;
        }
      }
      text = readTextFile(file);
      plan.originals.set(file, text);
    }
    const match = FRONTMATTER_PATTERN.exec(text);
    if (!match && sourceFile) {
      throw projectError(`${projectPath(root, file)} is missing YAML frontmatter${registryHint(root, file)}; nothing was changed`);
    }
    let header = "";
    let body = text;
    if (match) {
      header = match[0];
      body = text.slice(match[0].length);
      // story.md pov is a narrative mode (first, third-limited), not an id.
      if (file !== storyFile) {
        let data = null;
        try {
          data = parseFrontmatter(text, file).data;
        } catch (error) {
          // A note outside the project model may use YAML the CLI does not
          // parse; only its body links are rewritten.
          if (sourceFile) {
            throw projectError(`${projectPath(root, file)}: ${error.message}${registryHint(root, file)}; nothing was changed`);
          }
        }
        if (data !== null) {
          let nextData = transformReferences(data, transform, context);
          if (context.kind === "chapter") {
            nextData = reconcileChapterStatuses(data, nextData);
          }
          if (JSON.stringify(nextData) !== JSON.stringify(data)) {
            header = replaceFrontmatter(header, nextData);
          }
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
  "plot/timeline.md",
  "continuity/state.md",
  "continuity/exemptions.md"
]);

// The registries the CLI writes; an `_index.md` elsewhere (a notes site,
// say) may be plain markdown.
const REGISTRY_FILES = new Set([
  ...INDEX_SCHEMAS.map(([relativePath]) => relativePath),
  path.posix.join(MATTER_DIR, "_index.md"),
  path.posix.join(RESEARCH_DIR, "_index.md")
]);

// Registries are generated, so a damaged one is rebuilt rather than fixed.
function registryHint(root, file) {
  return REGISTRY_FILES.has(projectPath(root, file)) ? REGISTRY_HINT : "";
}

function isProjectSourceFile(root, file) {
  const relativePath = projectPath(root, file);
  return SOURCE_ROOT_FILES.has(relativePath)
    || FRONTMATTER_FILES.has(relativePath)
    || REGISTRY_FILES.has(relativePath)
    || ENTITY_SCAN_DIRS.includes(path.posix.dirname(relativePath));
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
    writeFile(file, contents, { root, unchangedFrom: plan.originals?.get(file) });
  }
}

// Puts back every file writeReferencePlan rewrote, each only while it still
// holds what was written.
function undoReferencePlan(root, plan) {
  for (const [file, contents] of plan) {
    writeFile(file, plan.originals.get(file), { root, unchangedFrom: contents });
  }
}

const UNWRITABLE_REASONS = { EACCES: "permission denied", EPERM: "permission denied", EROFS: "the file system is read-only" };

// Before a rename, remove, or move writes anything, checks that every file it
// will rewrite or delete, and every folder it writes into, can be written, so
// a read-only file stops the command with the project unchanged instead of
// half renamed. `changed` lists files rewritten or deleted, `created` new
// files. Writes replace files through a temporary file in the same folder,
// so the folder must be writable too.
function assertWritable(root, changed, created = []) {
  const problems = new Map();
  const check = (target, label) => {
    try {
      fs.accessSync(target, fs.constants.W_OK);
    } catch (error) {
      if (!problems.has(label)) {
        problems.set(label, UNWRITABLE_REASONS[error.code] ?? error.code ?? error.message);
      }
    }
  };
  // A folder that does not exist yet is made by the write itself.
  const folder = (file) => {
    const directory = path.dirname(file);
    const shown = projectPath(root, directory);
    if (fs.existsSync(directory)) {
      check(directory, shown === "" ? "the project folder" : `${shown}/`);
    }
  };
  for (const file of changed) {
    if (fs.existsSync(file)) {
      check(file, projectPath(root, file));
    }
    folder(file);
  }
  for (const file of created) {
    folder(file);
  }
  if (problems.size > 0) {
    const list = [...problems].map(([label, reason]) => `${label} (${reason})`).join(", ");
    throw refusedError(`Cannot write to ${list}; nothing was changed. Fix ${problems.size === 1 ? "it" : "them"} and run the command again`);
  }
}

// Runs the writes of a rename, remove, or move. The preflight catches
// unwritable files, but a write can still fail partway (a full disk, a file
// an editor saved meanwhile): then some references already name the new id,
// so the error says to rerun, which finishes the job. A failure before any
// write (a project whose lock could not be made) changed nothing, and an
// error that already says what to do next keeps its hint.
function commitWrites(write) {
  const { result: error, changes } = recordChanges(process.cwd(), () => {
    try {
      write();
      return null;
    } catch (caught) {
      return caught;
    }
  });
  if (error !== null) {
    if (changes.length > 0 && error.hint === undefined) {
      error.hint = "Some files were already updated: fix the problem and run the same command again to finish";
    }
    throw error;
  }
}

function transformReferences(data, transform, context, identityKey = null, listKey = null) {
  const next = {};
  // A `__proto__:` key is kept as an own property, as the parser keeps it.
  const set = (key, value) => Object.defineProperty(next, key, { value, enumerable: true, configurable: true, writable: true });
  // A route's `to` names a location and a choice's `to` a chapter; `to`
  // anywhere else is left alone. A progression's `from` names a chapter, and
  // its `value` is a reference when the field it changes is one (a
  // character's arc, a location's controlled-by).
  const progression = identityKey === "from";
  const isReference = (key) => (progression && key === "value" ? typeof data.field === "string" && context.isReferenceKey(data.field) : context.isReferenceKey(key, listKey))
    || (key === "from" && progression && context.kind === "chapter");
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      const items = [];
      const childIdentity = Object.hasOwn(ENTRY_IDENTITY_FIELDS, key) ? ENTRY_IDENTITY_FIELDS[key] : null;
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const mapped = transformReferences(item, transform, context, childIdentity, key);
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
      set(key, items);
      continue;
    }

    if (isReference(key)) {
      const mapped = transform(value);
      if (mapped === null) {
        // A removed id that identifies a nested entry (a relationship's
        // character, a state entry's character or artifact) drops the whole
        // entry; any other reference field is cleared in place, a
        // progression's value included, so the change stays on record.
        if (identityKey !== null && key === identityKey) {
          return null;
        }
        set(key, "");
        continue;
      }
      set(key, mapped);
      continue;
    }

    set(key, value);
  }
  return next;
}

function applyEntityBacklinks(root, kind, id, data) {
  if (kind === "location") {
    for (const characterId of asArray(data["notable-characters"])) {
      if (isKebabId(characterId)) {
        addFrontmatterListValue(root, `characters/${characterId}.md`, "locations", id);
      }
    }
  }

  if (kind === "scene" && isKebabId(data.chapter)) {
    // The chapter lists everyone and everywhere its scenes use; continuity
    // warns when it does not. Unknown ids stay on the scene only, where
    // links reports them once.
    const chapterFile = `chapters/${data.chapter}.md`;
    const exists = (dir, id) => fs.existsSync(path.join(root, dir, `${id}.md`));
    if (isKebabId(data.location) && exists("worldbuilding/locations", data.location)) {
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
    }), { root, unchangedFrom: markdown.rawMarkdown });
  }
}

// Writes `contents` when they differ from `original`, the text they were
// made from (null for a file that did not exist), and only while the file
// still holds it, so a registry saved meanwhile keeps the save.
function writeChanged(filePath, contents, original, changed, root) {
  if (original !== contents) {
    writeFile(filePath, contents, { root, unchangedFrom: original });
    changed.push(filePath);
  }
}

// Commands that write the project: init, add, rename, remove, move, reindex, wordcount, and migrate.
import fs from "node:fs";
import path from "node:path";
import { idText } from "./continuity.js";
import { chapterChronology, renumberedChronology } from "./chronology.js";
import { PROGRESSION_KINDS, sortProgressions } from "./progressions.js";
import { FRONTMATTER_PATTERN, parseFrontmatter, replaceFrontmatter } from "./frontmatter.js";
import {
  assertExistingAncestorInsideRoot,
  assertLexicallyInsideRoot,
  assertSafeProjectDirectory,
  assertSafeProjectPath,
  lstatIfExists,
  makeDirectories,
  readTextFile,
  recordChanges,
  removeFile,
  writeFile
} from "./files.js";
import { withProjectLock } from "./lock.js";
import { sourceRoot } from "./preview.js";
import {
  chapterProse,
  characterCount,
  escapeRegExp,
  extractSection,
  fencedLineIndexes,
  kebabCase,
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
import { EXIT_CODES, projectError, refusedError, usageError } from "./exit-codes.js";
import { projectActions } from "./report.js";
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
  deriveStoryId,
  scanProject,
  assertProjectParses,
  newerSchemaVersion,
  newerSchemaMessage,
  canonicalChapterId,
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
  MAX_SCAN_FILE_BYTES,
  MAX_SCAN_FILES,
  requireStoryFile,
  readMarkdown,
  safeRead,
  ENTITY_SCAN_DIRS,
  SOURCE_ROOT_FILES,
  asArray,
  normalizeList,
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

  const cwd = options.cwd ?? process.cwd();
  const root = newProjectRoot({ title, cwd, dir: options.dir });
  if (root === null) {
    throw usageError('Cannot derive a story id from title "' + title + '": pass --dir with an ASCII folder name, or use a title containing ASCII letters or digits');
  }
  if (options.language !== undefined && !isLanguageTag(options.language)) {
    throw usageError(`--language ${options.language} must be a BCP 47 tag such as en, en-GB, or fr`);
  }
  // `--force` keeps an existing story.md, so new registries take the story id
  // from its title, and the options it would have set are reported unused.
  const existingStory = existingStoryData(root);
  const storyId = deriveStoryId(existingStory ? existingStory.title : title, root);
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
  if (fs.existsSync(root) && !options.force) {
    throw refusedError(`${root} already exists. Use --force to add missing starter files; existing files are never overwritten.`);
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
  const themes = normalizeList(options.themes, ["change"]);
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
  for (const { book, updated } of backlinks) {
    if (existingLinks && !linksInclude(existingLinks[book.field], book.root)) {
      continue;
    }
    writeFile(path.join(book.root, "story.md"), updated, { root: book.root });
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
    writeFile(filePath, STARTER_GITIGNORE, { root });
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
  writeFile(filePath, contents, options);
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
        throw projectError(`--${field} ${value}: ${path.join(value, "story.md")}: ${error.message}`);
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

// Each linked book's story.md with the backlink added, checked writable.
// Books that already link back and share the series id are left out.
function planSeriesBacklinks(root, series) {
  const planned = [];
  for (const book of series.linked) {
    const storyPath = path.join(book.root, "story.md");
    const updated = withSeriesBacklink(book.root, book.inverse, root, series.series);
    if (updated === null) {
      continue;
    }
    try {
      fs.accessSync(storyPath, fs.constants.W_OK);
    } catch {
      throw refusedError(`Cannot add the series backlink to ${storyPath}: the file is not writable; nothing was created`);
    }
    planned.push({ book, updated });
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
  return withProjectLock(root, () => reindexProjectUnlocked(root));
}

function reindexProjectUnlocked(root) {
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
  const raw = safeRead(filePath, root);
  const existing = raw.replace(/\r\n/g, "\n");
  const generated = build(existing);
  const custom = customSections(existing, generated);
  let contents = custom.length === 0 ? generated : `${generated.replace(/\n*$/, "\n")}\n${custom.join("\n\n")}\n`;
  contents = keepRegistryFrontmatter(existing, contents);
  writeChanged(filePath, raw.includes("\r\n") ? contents.replace(/\n/g, "\r\n") : contents, changed, root);
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
      VALUE_HEADING_ALIASES.filter((aliases) => aliases.includes(key)).flat().forEach((alias) => valueHeadings.add(alias));
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
  return options.write ? withProjectLock(root, () => computeWordCountsUnlocked(root, options)) : computeWordCountsUnlocked(root, options);
}

function computeWordCountsUnlocked(root, options = {}) {
  const project = scanProject(root);
  assertProjectParses(project, "count words");
  const characters = project.unit.name === "characters";
  const chapters = [];

  for (const chapter of project.chapters) {
    chapters.push({
      number: chapter.number,
      title: chapter.title,
      file: path.relative(project.root, chapter.file),
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
  return withProjectLock(root, () => migrateProjectUnlocked(root));
}

function migrateProjectUnlocked(root) {
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
  const changed = [];

  for (const directory of PROJECT_DIRECTORIES) {
    ensureDirectory(path.join(projectRoot, directory), changed, projectRoot);
  }

  ensureFile(path.join(projectRoot, "plot", "timeline.md"), timeline(storyId), changed, projectRoot);
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
// findings call for, and diagnoses it again, all under the project lock, so
// the report is what remains for the writer to do. Returns that second
// diagnosis (see projectActions) with `repairs`, one { command, codes,
// changes } per repair run, and `stopped`, the message of the error that
// stopped a repair (a file that does not parse), after which none of the
// later ones is tried; null when every due repair ran.
export function fixProject(root, options = {}) {
  return withProjectLock(root, () => {
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
  });
}

// Every repair ends in a reindex, which needs each entity file and the plot
// registry to parse. Checking them first means a repair does not stop on
// one after it has already written.
function assertRepairable(root) {
  const project = scanProject(root);
  assertProjectParses(project, "fix");
  const plotPath = path.join(project.root, "plot", "_index.md");
  if (fs.existsSync(plotPath)) {
    const label = path.join("plot", "_index.md");
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
    for (const value of normalizeList(options[option], [])) {
      if (!isKebabId(value)) {
        throw usageError(`--${option} "${value}" must be a kebab-case id (such as ${REFERENCE_EXAMPLES[option] ?? "mara-quill"})`);
      }
    }
  }
  if ((kind === "chapter" || kind === "scene") && options.pov !== undefined && String(options.pov).trim() !== "" && !isKebabId(String(options.pov).trim())) {
    throw usageError(`--pov "${options.pov}" must be a character id (such as mara-quill)`);
  }
}

// Fields that hold one id: a repeated flag or a comma list cannot fit.
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
    const values = normalizeList(options[option], []);
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
// references, so a later rename or its undo would silently leave them on
// the other entity.
function assertUnambiguousId(root, kind, id) {
  for (const [other, fields] of kindsSharingFields(kind)) {
    if (fs.existsSync(path.join(root, entityConfig(other).dir, `${id}.md`))) {
      throw usageError(`${id} is already a ${other} id, and ${fields.join(" and ")} references could not tell the ${kind} from the ${other}. Choose another name, or pass --id`);
    }
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

// A status that says a chapter is on the page needs that chapter written:
// links applies the same rule, so add refuses what links would reject.
function assertStatusChapters(project, kind, options) {
  const written = (value) => project.chapters.some((chapter) => chapter.id === String(value ?? "").trim());
  const given = (value) => String(value ?? "").trim() !== "";
  const status = String(options.status ?? "");
  const refuse = (option, value, reason) => {
    throw usageError(`--${option} ${String(value).trim()} is not written yet: ${reason}`);
  };
  if (kind === "promise" || kind === "clue") {
    if ((status === "planted" || status === "paid-off") && given(options.planted) && !written(options.planted)) {
      refuse("planted", options.planted, `a ${status} ${kind} needs its planted chapter. Leave --status unset to record it as planned`);
    }
    if (status === "paid-off" && given(options.payoff) && !written(options.payoff)) {
      refuse("payoff", options.payoff, `a paid-off ${kind} needs its payoff chapter. Use --status planted until the payoff is drafted`);
    }
  }
  if (kind === "question") {
    if (given(options.resolved) && !written(options.resolved)) {
      refuse("resolved", options.resolved, "a question's resolved chapter must exist. Add --resolved once the answer is drafted");
    }
    if (status !== "" && status !== "open" && given(options.introduced) && !written(options.introduced)) {
      refuse("introduced", options.introduced, `a ${status} question needs its introduced chapter`);
    }
  }
}

export function createEntity(root, options) {
  return withProjectLock(root, () => createEntityUnlocked(root, options));
}

function createEntityUnlocked(root, options) {
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
    writeFile(entity.file, entity.markdown, { root: project.root });
  }
  const data = readMarkdown(entity.file, project.root).data;
  applyEntityBacklinks(project.root, kind, entity.id, data);
  const reindexed = reindexProject(project.root);
  return { kind, id: entity.id, file: entity.file, changed: [entity.file].concat(reindexed.changed), resumed, warnings: missingReferenceWarnings(project.root, kind, data) };
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
  const registry = [dir, path.dirname(dir)].map((entry) => path.join(entry, "_index.md")).find((entry) => REGISTRY_FILES.has(entry));
  const registryPath = registry && path.join(root, registry);
  if (!registryPath || !fs.existsSync(registryPath)) {
    return false;
  }
  const link = path.relative(path.dirname(registryPath), file).split(path.sep).join("/");
  return safeRead(registryPath, root).includes(`](${link})`);
}

export function renameEntity(root, options) {
  return withProjectLock(root, () => renameEntityUnlocked(root, options));
}

function renameEntityUnlocked(root, options) {
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
    // A rename killed after deleting the old file missed only the reindex:
    // every reference was rewritten before the file moved. So resume only
    // when the target has the requested name and nothing still names the old
    // id; otherwise the old id is simply missing, and an unrelated entity
    // that happens to have this name must not absorb its references.
    if (newFile !== oldFile && fs.existsSync(newFile) && readMarkdown(newFile, project.root).data[config.titleField] === name
      && replaceEntityReferences(project.root, kind, oldId, newId, new Map()).size === 0) {
      const reindexed = reindexProject(project.root);
      return { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed), resumed: true };
    }
    throw usageError(`${kind} ${oldId} does not exist`);
  }
  let warnings = [];

  const markdown = readMarkdown(oldFile, project.root);

  const data = { ...markdown.data, [config.titleField]: name };
  const retitled = retitleHeading(replaceFrontmatter(markdown.rawMarkdown, data), markdown.data[config.titleField], name);
  if (newFile === oldFile) {
    writeFile(oldFile, retitled, { root: project.root, unchangedFrom: markdown.rawMarkdown });
  } else {
    // Plan every rewrite before touching disk so a parse failure leaves the
    // project unchanged.
    const plan = replaceEntityReferences(project.root, kind, oldId, newId, new Map([[oldFile, retitled]]));
    followExemptionPatterns(project.root, plan, kind, oldId, newId);
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

    assertWritable(project.root, [...plan.keys(), oldFile], interrupted ? [] : [newFile]);
    // References first, the entity file last: if the command is killed
    // partway, the old file still exists and a rerun finishes the job.
    commitWrites(() => {
      writeReferencePlan(project.root, plan);
      if (!interrupted) {
        writeFile(newFile, renamedContents, { root: project.root });
      }
      removeFile(oldFile);
    });
  }

  if (newFile !== oldFile) {
    warnings = warnings.concat(linkedBookIdWarnings(project, kind, oldId, newId));
  }
  const reindexed = reindexProject(project.root);
  return { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed), warnings };
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
  // A --dry-run runs on a copy; the linked books sit beside the project.
  const root = sourceRoot(project.root);
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
  return withProjectLock(root, () => removeEntityUnlocked(root, options));
}

function removeEntityUnlocked(root, options) {
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
      throw refusedError(`chapter ${id} is still named by ${BEFORE_STORY_FIELDS.join(", ")}, or a progression's from in ${named.map((entry) => path.relative(project.root, entry)).join(", ")}; an empty value there means before the story, and a progression needs the chapter it starts in, so point them at another chapter first`);
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
  // References first, the file last, so an interrupted remove can be rerun.
  commitWrites(() => {
    writeReferencePlan(project.root, plan);
    removeFile(file, { force: true });
  });
  const reindexed = reindexProject(project.root);
  const warnings = leftoverReferenceWarnings(project.root, kind, id);
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
// which it never edits, and exemption patterns naming the id, which no longer
// match anything.
function leftoverReferenceWarnings(root, kind, id) {
  const warnings = [];
  const context = entityReferenceContext(root, kind, id);
  const probe = `${id}-leftover-probe`;
  const numbered = kind === "chapter" || kind === "scene";
  let files = [];
  try {
    files = [...planReferenceRewrites(root, context, new Map(), (value) => value, (body, file) => {
      const relinked = renameLinkTargets(root, file, body, context, probe);
      return numbered ? renameIdTokens(root, file, relinked, id, probe) : relinked;
    }).keys()].map((file) => path.relative(root, file)).sort();
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
  if (stale.length > 0) {
    const values = stale.flatMap(({ keys }) => keys);
    warnings.push(warn("stale-exemption", `continuity/exemptions.md has ${stale.length === 1 ? "an entry" : `${stale.length} entries`} naming ${id} (${stale.map(({ index }) => `exemptions[${index}]`).join(", ")}), which ${stale.length === 1 ? "no longer matches" : "no longer match"} anything: ${values.join(", ")}. Delete or update ${stale.length === 1 ? "it" : "them"}`, EXEMPTIONS_FILE));
  }
  return warnings;
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

// Moves a chapter to another number, or a scene to another chapter or
// position. Chapter and scene ids encode their numbers, so a move renames the
// files and rewrites every reference: scene `chapter` fields, promise, clue,
// question, and research chapters, died-in, continuity state, links, and
// bare ids in plot/timeline.md and arc files. References are written first
// and the moved files last, so an interrupted move can be rerun.
export function moveEntity(root, options) {
  return withProjectLock(root, () => moveEntityUnlocked(root, options));
}

function moveEntityUnlocked(root, options) {
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

function moveChapter(project, oldId, options) {
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
      if (!plan.has(statePath)) {
        plan.originals.set(statePath, stateText);
      }
      plan.set(statePath, replaceFrontmatter(stateText, { ...stateData, "current-chapter": number }));
    }
  }
  followExemptionPatterns(project.root, plan, "chapter", oldId, newId);
  reorderProgressions(project, plan, renumberedChronology(chapterChronology(project), oldId, newId, number));
  const moves = [{ oldFile: chapter.file, newFile }, ...sceneMoves];
  // The number is taken, unless an earlier run of this move was interrupted
  // after writing the chapter there.
  if (taken && !interruptedMove(plan, moves)) {
    throw refusedError(`${newId} already exists: move it first. To make room, renumber from the highest chapter down`);
  }
  const warnings = taken ? [] : adoptedReferenceWarnings(project.root, "chapter", newId, chapter.file, "move");
  commitMoves(project.root, plan, moves);
  const reindexed = reindexProject(project.root);
  return { kind: "chapter", oldId, id: newId, file: newFile, moved: moves.length, changed: moves.map((move) => move.newFile).concat(reindexed.changed), warnings };
}

// A renumbered chapter can move past another progression's chapter, so the
// progressions of every character, location, and faction the move rewrote
// are put back in story order, which validate requires.
function reorderProgressions(project, plan, chronology) {
  const dirs = PROGRESSION_KINDS.map((kind) => entityConfig(kind).dir);
  for (const [file, text] of plan) {
    if (!dirs.includes(path.relative(project.root, path.dirname(file)))) {
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

function moveScene(project, oldId, options) {
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
  const warnings = project.scenes.some((entry) => entry.id === newId) ? [] : adoptedReferenceWarnings(project.root, "scene", newId, scene.file, "move");
  // The chapter gains the scene's cast before the old scene is deleted, so a
  // move interrupted at that step can still be rerun.
  commitMoves(project.root, plan, moves, () => applyEntityBacklinks(project.root, "scene", newId, readMarkdown(newFile, project.root).data),
    [path.join(project.root, "chapters", `${chapterId}.md`)]);
  const reindexed = reindexProject(project.root);
  return { kind: "scene", oldId, id: newId, file: newFile, moved: 1, changed: [newFile].concat(reindexed.changed), warnings };
}

const BEFORE_STORY_FIELDS = ["died-in", "since", "learned-in"];

// Before a rename or move gives an entity `id`, lists the files that already
// reference that id (a scheduled chapter, a planned character, a link left
// by remove): after the command they point at the entity. Only a warning,
// since an interrupted run that is rerun leaves the same references.
function adoptedReferenceWarnings(root, kind, id, excludedFile, action) {
  const context = entityReferenceContext(root, kind, id);
  const probe = `${id}-adopted-probe`;
  const numbered = kind === "chapter" || kind === "scene";
  const plan = planReferenceRewrites(root, context, new Map([[excludedFile, null]]), idRenamer(id, probe), (body, file) => {
    const relinked = renameLinkTargets(root, file, body, context, probe);
    return numbered ? renameIdTokens(root, file, relinked, id, probe) : relinked;
  });
  if (plan.size === 0) {
    return [];
  }
  const files = [...plan.keys()].map((file) => path.relative(root, file)).sort();
  return [warn("adopted-references", `${id} was already referenced before this ${action}, and those references now point at the ${action === "move" ? "moved" : "renamed"} ${kind}: ${files.join(", ")}. Check them`)];
}

function idRenamer(oldId, newId) {
  return (value) => (value === oldId ? newId : value);
}

// Bare chapter and scene ids in plot/timeline.md and arc bodies, which links
// checks, and in the plot/_index.md theme tracking table follow the move. `chapter-03` never matches inside `chapter-03-scene-01`
// unless the whole scene id is the one moving, and scene ids of a moved chapter
// (`chapter-03-scene-02`) follow it too.
function renameIdTokens(root, file, body, oldId, newId) {
  const relativePath = path.relative(root, file);
  if (relativePath !== path.join("plot", "timeline.md") && relativePath !== path.join("plot", "_index.md") && path.dirname(relativePath) !== path.join("plot", "arcs")) {
    return body;
  }
  // Link destinations were already handled by renameLinkTargets, and a URL
  // or a path into another book is not this book's id.
  return mapOutsideLinks(body, (text) => renameIdText(text, oldId, newId));
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
// interrupted after writing it, and this run finishes the job.
function commitMoves(root, plan, moves, beforeDelete = () => {}, alsoChanged = []) {
  const contents = moves.map((move) => plan.get(move.oldFile) ?? readTextFile(move.oldFile));
  const interrupted = interruptedMove(plan, moves);
  moves.forEach((move) => {
    if (fs.existsSync(move.newFile) && !interrupted) {
      throw refusedError(`${path.relative(root, move.newFile)} already exists; nothing was changed`);
    }
  });
  for (const move of moves) {
    plan.delete(move.oldFile);
  }
  assertWritable(root, [...plan.keys(), ...moves.map((move) => move.oldFile), ...alsoChanged], moves.map((move) => move.newFile));
  commitWrites(() => {
    writeReferencePlan(root, plan);
    moves.forEach((move, index) => writeFile(move.newFile, contents[index], { root }));
    beforeDelete();
    // A chapter's scenes go before the chapter, so a rerun still finds the
    // chapter and its remaining scenes.
    for (const move of [...moves].reverse()) {
      removeFile(move.oldFile);
    }
  });
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
  "revived-in": ["chapter"],
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
      throw projectError(`${path.relative(root, file)} is missing YAML frontmatter${registryHint(root, file)}; nothing was changed`);
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
            throw projectError(`${path.relative(root, file)}: ${error.message}${registryHint(root, file)}; nothing was changed`);
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

// Registries are generated, so a damaged one is rebuilt rather than fixed.
function registryHint(root, file) {
  return REGISTRY_FILES.has(path.relative(root, file)) ? REGISTRY_HINT : "";
}

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
    writeFile(file, contents, { root, unchangedFrom: plan.originals?.get(file) });
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
    const shown = path.relative(root, directory);
    if (fs.existsSync(directory)) {
      check(directory, shown === "" ? "the project folder" : `${shown}/`);
    }
  };
  for (const file of changed) {
    if (fs.existsSync(file)) {
      check(file, path.relative(root, file));
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
// so the error says to rerun, which finishes the job.
function commitWrites(write) {
  try {
    return write();
  } catch (error) {
    throw Object.assign(error, { hint: "Some files were already updated: fix the problem and run the same command again to finish" });
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

function writeChanged(filePath, contents, changed, root) {
  if (safeRead(filePath, root) !== contents) {
    writeFile(filePath, contents, { root });
    changed.push(filePath);
  }
}

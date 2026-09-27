import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkContinuity, idText, storyDateError, storyTimeError } from "./continuity.js";
import { chapterChronology, renumberedChronology } from "./chronology.js";
import { PROGRESSION_KINDS, entityStateAt, sortProgressions, validateProgressions } from "./progressions.js";
import { FRONTMATTER_PATTERN, parseFrontmatter, replaceFrontmatter, stringifyFrontmatter, withoutLeadingFrontmatter } from "./frontmatter.js";
import { buildContext, DEFAULT_CONTEXT_BUDGET, DEFAULT_CONTEXT_SCENES } from "./context.js";
import { assertExistingAncestorInsideRoot, assertLexicallyInsideRoot, assertSafeProjectDirectory, assertSafeProjectPath, isPathInside, lstatIfExists, makeDirectories, nearestExistingAncestor, readTextFile, TEMPORARY_FILE_PATTERN, writeFile } from "./files.js";
import { isTruthy } from "./options.js";
import { withProjectLock } from "./lock.js";
import { chapterHeading, chapterProse, countTodoMarkers, escapeRegExp, extractSection, fencedLineIndexes, hasUnclosedComment, kebabCase, scanComments, titleCaseSlug, wordCount } from "./markdown.js";
import { buildTimeline } from "./timeline.js";
import { buildClueMatrix } from "./clues.js";
import { buildDiagram } from "./diagram.js";
import { buildVoices } from "./voices.js";
import { checkNames, existingNames } from "./names.js";
import { STORY_FORMS, formRangeWarning } from "./forms.js";
import { copyrightPage, metadataSheet, publishingMeta, validatePublishing } from "./publishing.js";
import { DEFAULT_TRIM, estimateBookPages, paragraphLabels, printHtml, reviewHtml, TRIM_SIZES } from "./html.js";
import { narrationScript, pronunciationGuide } from "./narration.js";
import { SCENE_SETTINGS, fountainScript } from "./fountain.js";
import { TWEE_LINK_UNSAFE, derivedIfid, isIfid, tweeSource } from "./twee.js";
import { htmlBook, writeDocx, writeEpub, writeShunnDocx, writeShunnMarkdown } from "./packaging.js";
import { validateCliConfig } from "./config.js";
import { DEFAULT_PASSES, addedPassNotes, nextPass, passChecks, readPasses, updatePasses, validatePasses } from "./passes.js";
import { CHAPTER_HOOKS, SCENE_OUTCOMES, buildPacing } from "./pacing.js";
import { compareChapters, mapLabels, proseParagraphs } from "./compare.js";
import { PROGRESS_FILE, cleanSessions, computeProgress, formatPercent, localDate, withSession } from "./progress.js";
import { plural } from "./plural.js";
import { analyzeChapter, chapterFindings, proseRules, proseThresholds, repeatedPhrases, similarNames } from "./prose.js";
import { splitSentences } from "./sentences.js";
import { areSiblingBooks, buildSeries, canonicalPath, discoverSeriesBooks, isBookNumber, linksInclude, readBookFrontmatter, seriesId, seriesLinkPath, seriesLinks, validateSeriesLinks, withSeriesBacklink } from "./series.js";
import { asFinding, err, warn } from "./findings.js";
import { EXIT_CODES, projectError, refusedError, usageError, withDefaultExitCode } from "./exit-codes.js";

// writeFile moved to files.js with the rest of the write path guards; it is
// re-exported because src/import.js imports it from here.
export { writeFile };

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
// Chapter `mode` and story.md `draft-mode`: how the prose was written.
const DRAFT_MODES = new Set(["discovered", "outlined"]);
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
const WRITTEN_CHAPTER_STATUSES = new Set(["revised", "final", "complete"]);
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
    throw usageError("A story title is required");
  }

  const cwd = options.cwd ?? process.cwd();
  // A title with no ASCII letters or digits (a translated edition, say) takes
  // its story id from the project folder, as scanProject does.
  const titleId = kebabCase(title);
  if (!titleId && options.dir === undefined) {
    throw usageError('Cannot derive a story id from title "' + title + '": pass --dir with an ASCII folder name, or use a title containing ASCII letters or digits');
  }
  const root = path.resolve(cwd, options.dir ?? titleId);
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
    inherited: inheritedStoryFields(inherited),
    synopsis: options.synopsis ?? options.defaultSynopsis ?? "Add a 2-3 sentence synopsis here."
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
  return fields;
}

// The frontmatter of an existing story.md, {} when it does not parse, or
// null when there is none.
function existingStoryData(root) {
  if (!lstatIfExists(path.join(root, "story.md"))) {
    return null;
  }
  try {
    return readBookFrontmatter(root) ?? {};
  } catch {
    return {};
  }
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
      throw projectError(`Cannot compute the next book-number: part of the series linked from --${book.field} ${book.value} could not be read (${errors[0]}); fix it or pass --book-number`);
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

// The story id is the kebab-case title, or the project folder name when the
// title is missing or has no ASCII letters or digits.
function deriveStoryId(title, root) {
  return kebabCase(String(title ?? "")) || kebabCase(path.basename(root));
}

// Every registry records the story id, which follows the story.md title, so
// a retitled story leaves them all stale until `story reindex` rewrites them.
function storyIdMismatch(label, project) {
  return `${label} story must be ${project.storyId} (run story reindex after changing the story.md title)`;
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

  const project = {
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
      wordCount: wordCount(chapterProse(markdown.body)),
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
  validateCharacters(project, errors, warnings);
  validateLocations(project, errors, warnings);
  validateSystems(project, errors);
  validateFactions(project, errors);
  validateArtifacts(project, errors);
  validateArcs(project, errors);
  validateChapters(project, errors, warnings);
  validateScenes(project, errors);
  validateContinuityState(project, errors, warnings);
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
  validateTextFields(project, errors);
  validatePortablePaths(project, warnings);
  collectStrayFileWarnings(project, warnings);
  for (const file of ENTITY_SCAN_DIRS.flatMap((dir) => entityFileNames(projectRoot, dir))) {
    if (WINDOWS_RESERVED_ID.test(path.basename(file, ".md").toLowerCase())) {
      warnings.push(`${file} uses a file name Windows reserves, so the project cannot be checked out on Windows; rename the entity`);
    }
  }

  // Each registry link as [needle, file]: the needle is the link target the
  // registry must contain, the file is what the warning names.
  const linksFor = (items, prefix = "") => items.map((item) => [`](${prefix}${path.basename(item.file)})`, path.relative(projectRoot, item.file)]);
  const indexChecks = [
    [path.join("characters", "_index.md"), linksFor(project.characters)],
    [path.join("worldbuilding", "_index.md"), linksFor(project.locations, "locations/")
      .concat(linksFor(project.systems, "systems/"))
      .concat(linksFor(project.factions, "factions/"))
      .concat(linksFor(project.artifacts, "artifacts/"))],
    [path.join("plot", "_index.md"), linksFor(project.arcs, "arcs/")],
    [path.join("chapters", "_index.md"), linksFor(project.chapters)],
    [path.join("scenes", "_index.md"), linksFor(project.scenes)],
    [path.join("continuity", "questions", "_index.md"), linksFor(project.questions)],
    [path.join("continuity", "promises", "_index.md"), linksFor(project.promises)],
    [path.join("continuity", "clues", "_index.md"), linksFor(project.clues)],
    [path.join("glossary", "_index.md"), linksFor(project.glossaryTerms, "terms/")],
    // The matter and research registries are optional; reindex creates each
    // one alongside its folder.
    ...(fs.existsSync(path.join(projectRoot, MATTER_DIR, "_index.md"))
      ? [[path.join(MATTER_DIR, "_index.md"), linksFor(project.matter)]]
      : []),
    ...(fs.existsSync(path.join(projectRoot, RESEARCH_DIR, "_index.md"))
      ? [[path.join(RESEARCH_DIR, "_index.md"), linksFor(project.research)]]
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
    for (const [link, file] of links) {
      if (!markdown.includes(link)) {
        warnings.push(warn("stale-registry", `${indexPath} does not list ${file}; run story reindex`, indexPath));
      }
    }
  }

  for (const chapter of project.chapters) {
    const file = path.relative(projectRoot, chapter.file);
    if (chapter.declaredWordCount !== null && chapter.declaredWordCount !== chapter.wordCount) {
      warnings.push(warn("stale-word-count", chapter.wordCountMissing
        ? `${file} has no word-count (contains ${chapter.wordCount})`
        : `${file} declares ${plural(chapter.declaredWordCount, "word")} but contains ${chapter.wordCount}`, file));
    }

    if (chapter.todoMarkers > 0) {
      warnings.push(warn("todo-markers", `${file} has ${plural(chapter.todoMarkers, "[TODO marker")} in its prose, which every build prints: resolve ${chapter.todoMarkers === 1 ? "it" : "them"} or move ${chapter.todoMarkers === 1 ? "it" : "them"} into an HTML comment`, file));
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
    if (character.revivedIn) {
      checkIdReference(errors, label, character.revivedIn, "chapter", hasChapter);
    }
  }

  // A progression takes effect from a chapter, which may be one planned but
  // not written yet (`chapter-20` while drafting chapter 5).
  for (const entity of [...project.characters, ...project.locations, ...project.factions]) {
    for (const [index, item] of asArray(entity.frontmatter.progressions).entries()) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        checkIdReference(errors, `${relative(project, entity.file)} progressions[${index}]`, idText(item.from), "chapter", hasScheduledChapter);
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
        errors.push(`${label} route points at itself`);
        continue;
      }
      checkIdReference(errors, `${label} route`, to, "location", hasLocation);
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

  // Like a promise's payoff, a choice may lead to a chapter not written yet;
  // the Twee build still needs it.
  const branches = branchGraph(project);
  errors.push(...branches.missing.filter((choice) => !hasScheduledChapter(choice.to)).map((choice) => choice.message));
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
        errors.push(`${label} references missing chapter ${token}`);
      }
    }
    for (const token of extractSceneIdTokens(body)) {
      if (!sceneIds.has(token)) {
        errors.push(`${label} references missing scene ${token}`);
      }
    }
  };
  const timelinePath = path.join(project.root, "plot", "timeline.md");
  if (fs.existsSync(timelinePath)) {
    try {
      const raw = readTextFile(timelinePath);
      const body = parseFrontmatter(raw, timelinePath).body ?? raw;
      checkTokens(path.join("plot", "timeline.md"), body);
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
      const message = `${label}: ${error.message}`;
      if (!errors.includes(message)) {
        errors.push(message);
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
    errors.push(`${label} links to ${cleaned} with a backslash; write ${portableSlashes(cleaned)} so the link works on every system`);
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
    errors.push(`${label} links to ${cleaned} which must be kebab-case`);
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
      ? `${label} links to missing file ${cleaned}`
      : `${label} links to ${cleaned} which resolves outside the project`);
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
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
// knowledge, the rest must be learned in a chapter at or before the target in
// story time (by date when both chapters are dated, else by number). File
// order is preserved. `project` skips the scan for a command that has one.
export function knowledgeAtChapter(root, characterId, atChapterId, project = scanProject(root)) {
  const characters = new Map(project.characters.map((character) => [character.id, character]));
  if (!characters.has(characterId)) {
    // A character whose file fails to parse exists; say why it cannot be read.
    const parseError = project.fileErrors.find((error) => error.startsWith(`${path.join("characters", `${characterId}.md`)}:`));
    throw parseError ? projectError(parseError) : usageError(`Unknown character ${characterId}`);
  }

  // Knowledge is dated by chapter, so a chapter that fails to parse would
  // silently drop what was learned in it.
  const chapterError = project.fileErrors.find((error) => error.startsWith(`chapters${path.sep}`));
  if (chapterError) {
    throw projectError(chapterError);
  }

  const chronology = chapterChronology(project);
  const chapterNumbers = chronology.numbers;
  if (!chapterNumbers.has(atChapterId)) {
    throw usageError(`Unknown chapter ${atChapterId}`);
  }

  let stateError = "";
  for (const error of project.fileErrors ?? []) {
    if (!stateError && String(error).startsWith(`${path.join("continuity", "state.md")}:`)) {
      stateError = error;
    }
  }
  if (stateError) {
    throw projectError(stateError);
  }

  const entries = [];
  const knowledge = project.continuity ? asArray(project.continuity.data["knowledge-state"]) : [];
  for (const [index, entry] of knowledge.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry) || idText(entry.character) !== characterId) {
      continue;
    }
    if (entry.knows === undefined || entry.knows === null || String(entry.knows).trim() === "") {
      throw projectError(`${path.join("continuity", "state.md")} knowledge-state[${index}] is missing knows`);
    }
    const learnedIn = idText(entry["learned-in"]);
    if (learnedIn === "") {
      entries.push({ knows: String(entry.knows ?? ""), learnedIn: "" });
      continue;
    }
    // Story time, not reading order: when both chapters are dated, a 2034
    // prologue read first is learned after a 2024 chapter 2.
    if (chapterNumbers.has(learnedIn) && !chronology.after(learnedIn, atChapterId)) {
      entries.push({ knows: String(entry.knows ?? ""), learnedIn });
    }
  }
  return entries;
}

// Resolves a character, location, or faction at a chapter by applying its
// progressions (see progressions.js): { state, changes }. A project already
// scanned is passed as `project`, so a command reads the files once.
export function entityStateAtChapter(root, kind, id, atChapterId, project = scanProject(root)) {
  const entityKind = normalizeKind(kind);
  if (!PROGRESSION_KINDS.includes(entityKind)) {
    throw usageError(`Only ${PROGRESSION_KINDS.join(", ")} records carry progressions, not ${entityKind}`);
  }
  const collection = { character: project.characters, location: project.locations, faction: project.factions }[entityKind];
  const entity = collection.find((entry) => entry.id === id);
  if (!entity) {
    const entityFile = path.join(entityConfig(entityKind).dir, `${id}.md`);
    const parseError = project.fileErrors.find((error) => error.startsWith(`${entityFile}:`));
    throw parseError ? projectError(parseError) : usageError(`Unknown ${entityKind} ${id}`);
  }
  // Progressions are ordered by chapter, so a chapter that fails to parse
  // would silently misplace them.
  const chapterError = project.fileErrors.find((error) => error.startsWith(`chapters${path.sep}`));
  if (chapterError) {
    throw projectError(chapterError);
  }
  return entityStateAt(entity.frontmatter, atChapterId, chapterChronology(project));
}

// `story context`: the drafting context for one chapter or scene, packed to a
// token budget. Knowledge and thread dating depend on the chapters and the
// state file, so an unreadable one stops the command rather than risk a
// spoiler; other unreadable files are reported as warnings.
export function draftingContext(root, targetId, options = {}) {
  const budget = options.budget === undefined ? DEFAULT_CONTEXT_BUDGET : requirePositiveInteger(options.budget, "Budget");
  const scenes = options.scenes === undefined ? DEFAULT_CONTEXT_SCENES : parseDecimalInteger(options.scenes);
  if (scenes === null) {
    throw usageError(`Scenes must be 0 or a positive integer, got ${options.scenes}`);
  }
  const project = scanProject(root);
  // A target scene that fails to parse reports why, not "Unknown scene".
  const blocking = project.fileErrors.find((error) => error.startsWith(`chapters${path.sep}`)
    || error.startsWith(`${path.join("continuity", "state.md")}:`)
    || error.startsWith(`${path.join("scenes", `${targetId}.md`)}:`));
  if (blocking) {
    throw projectError(blocking);
  }
  return buildContext(project, targetId, (file) => readMarkdown(file, project.root).body, { budget, scenes });
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
    ...(report.targetWords > 0 ? [`- Target words: ${report.targetWords} (${formatPercent((report.counts.words * 100) / report.targetWords, 0)}%)`] : []),
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
export function assertProjectParses(project, action, ignore = () => false) {
  // The style sheet, progress log, and exemptions never feed registries or
  // chapters.
  const ignored = [STYLE_SHEET_FILE, PROGRESS_FILE, path.join("continuity", "exemptions.md")];
  const errors = (project.fileErrors ?? []).filter((error) => !ignored.some((file) => error.startsWith(`${file}:`)) && !ignore(error));
  if (errors.length > 0) {
    throw projectError(`Cannot ${action}: fix ${errors.length === 1 ? "this file first (story validate reports it)" : "these files first (story validate reports them)"}:\n${errors.map((error) => `- ${error}`).join("\n")}`);
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
  return options.write ? withProjectLock(root, () => computeWordCountsUnlocked(root, options)) : computeWordCountsUnlocked(root, options);
}

function computeWordCountsUnlocked(root, options = {}) {
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
      // An editor saving the chapter meanwhile keeps its save.
      writeFile(chapter.file, replaceFrontmatter(markdown.rawMarkdown, {
        ...markdown.data,
        "word-count": wordCount(chapterProse(markdown.body))
      }), { root: project.root, unchangedFrom: markdown.rawMarkdown });
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
// project on disk. With `anchors`, maps those review-copy labels from the
// earlier draft to the current text instead.
export function compareProject(root, options = {}) {
  const hasRef = typeof options.ref === "string" && options.ref !== "";
  const hasAgainst = typeof options.against === "string" && options.against !== "";
  if (hasRef === hasAgainst) {
    throw usageError("compare needs exactly one of --ref <git-ref> or --against <project-path>");
  }
  const project = scanProject(root);
  // A chapter that fails to parse would be reported as removed.
  assertProjectParses(project, "compare");
  const anchors = [].concat(options.anchors ?? []);
  if (anchors.length > 0) {
    return mapProjectLabels(project, anchors, { hasRef, ...options });
  }
  const current = project.chapters.map((chapter) => comparableChapter(chapter.id, readMarkdown(chapter.file, project.root)));
  const warnings = [];
  let previous;
  let label;
  if (hasRef) {
    previous = chaptersAtGitRef(project.root, options.ref, warnings);
    label = `git ref ${options.ref}`;
  } else {
    const otherRoot = path.resolve(options.cwd ?? process.cwd(), options.against);
    const other = scanProject(otherRoot);
    if (other.fileErrors.length > 0) {
      throw projectError(`Cannot read ${otherRoot}: ${other.fileErrors[0]}`);
    }
    previous = other.chapters.map((chapter) => comparableChapter(chapter.id, readMarkdown(chapter.file, other.root)));
    label = otherRoot;
  }
  return {
    ok: project.fileErrors.length === 0,
    errors: [...project.fileErrors],
    warnings,
    label,
    ...compareChapters(previous, current)
  };
}

// Review-copy labels, as `story compare --anchor` reads them: "#CH03-P12"
// and "ch03-p12" name the same paragraph.
function normaliseAnchor(value) {
  const anchor = String(value).trim().replace(/^#/, "").toLowerCase();
  if (anchor === "") {
    throw usageError("--anchor needs a paragraph label from the review copy, such as ch03-p12");
  }
  return anchor;
}

function mapProjectLabels(project, anchors, options) {
  const labels = anchors.map(normaliseAnchor);
  const current = paragraphLabels(htmlBook(manuscriptParts(project, "map labels")));
  let previous;
  let label;
  if (options.hasRef) {
    label = `git ref ${options.ref}`;
    previous = withProjectAtGitRef(project.root, options.ref, (oldRoot) => labelsIn(oldRoot, label));
  } else {
    label = path.resolve(options.cwd ?? process.cwd(), options.against);
    previous = labelsIn(label, label);
  }
  return { ok: true, errors: [], warnings: [], label, anchors: mapLabels(previous, current, labels) };
}

// The paragraph labels a review copy built from this project would carry.
function labelsIn(root, label) {
  // Checked here so the error names the ref, not the temporary copy.
  if (!fs.existsSync(path.join(root, "story.md"))) {
    throw projectError(`No story project (story.md) in ${label}`);
  }
  const project = scanProject(root);
  return paragraphLabels(htmlBook(manuscriptParts(project, `read labels from ${label}`)));
}

// Runs `read` on the project's markdown as it was at `ref`, copied into a
// temporary directory that is removed afterwards. Nothing is written to the
// repository or its working tree.
function withProjectAtGitRef(root, ref, read) {
  const { git } = gitAtRef(root, ref);
  // -z keeps names unquoted; each record is "<mode> <type> <hash>\t<path>",
  // the path relative to the project folder (-C root).
  const blobs = git(["ls-tree", "-r", "-z", ref, "--", "."])
    .split("\0")
    .filter((record) => record !== "")
    .map((record) => {
      const tab = record.indexOf("\t");
      const [mode, type, hash] = record.slice(0, tab).split(" ");
      return { mode, type, hash, name: record.slice(tab + 1) };
    })
    // Regular files only (not symlinks or submodules), and only markdown,
    // which is all a manuscript is built from.
    .filter((entry) => entry.type === "blob" && entry.mode.startsWith("100") && entry.name.endsWith(".md"));
  const contents = catBlobs(root, blobs.map((entry) => entry.hash));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-compare-"));
  try {
    blobs.forEach((entry, index) => {
      // Git refuses tree entries named "." or "..", but a name holding a
      // backslash or drive colon could still escape on Windows, so skip any
      // entry that does not resolve inside the temporary directory.
      const target = path.join(dir, ...entry.name.split("/"));
      if (/[\\:]/.test(entry.name) || !isPathInside(dir, target)) {
        return;
      }
      makeDirectories(path.dirname(target));
      fs.writeFileSync(target, contents[index]);
    });
    return read(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Blob contents for these hashes, read with one git cat-file process.
function catBlobs(root, hashes) {
  const output = execFileSync("git", ["-C", root, "cat-file", "--batch"], { input: `${hashes.join("\n")}\n`, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  const contents = [];
  let cursor = 0;
  for (let index = 0; index < hashes.length; index += 1) {
    const headerEnd = output.indexOf(10, cursor);
    const size = Number(output.toString("utf8", cursor, headerEnd).split(" ")[2]);
    contents.push(output.subarray(headerEnd + 1, headerEnd + 1 + size));
    cursor = headerEnd + 1 + size + 1;
  }
  return contents;
}

function gitFailure(error) {
  if (error && error.code === "ENOENT") {
    return "compare --ref needs git, which was not found on PATH";
  }
  const stderr = String(error?.stderr ?? "").trim();
  if (stderr === "" || /not a git repository/i.test(stderr)) {
    return "compare --ref needs the project inside a git repository";
  }
  return `compare --ref could not run git: ${stderr.split(/\r?\n/)[0]}`;
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

// Git decides which ref names are valid (branch names may hold accents, +,
// or #); a ref only must not start with "-", so it cannot be read as an
// option, and must not hold control characters or a colon, which would name
// a path instead.
const UNSAFE_GIT_REF = /^-|[\u0000-\u001f\u007f:]/u;

// Checks that `ref` names a commit holding the project folder, and returns a
// git runner for the project folder plus the folder's path in the repository.
function gitAtRef(root, ref) {
  if (UNSAFE_GIT_REF.test(ref)) {
    throw usageError(`Unsupported git ref: ${ref}`);
  }
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  let prefix;
  try {
    prefix = git(["rev-parse", "--show-prefix"]).trim();
  } catch (error) {
    throw projectError(gitFailure(error));
  }
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    throw usageError(`Unknown git ref: ${ref}`);
  }
  // A project folder that was renamed or did not exist yet has no tree at
  // the ref; comparing against nothing would report every chapter as added.
  if (prefix !== "") {
    try {
      git(["rev-parse", "--verify", "--quiet", `${ref}:${prefix.replace(/\/$/, "")}`]);
    } catch {
      throw projectError(`${prefix} does not exist at git ref ${ref}`);
    }
  }
  return { git, prefix };
}

function chaptersAtGitRef(root, ref, warnings) {
  const { git, prefix } = gitAtRef(root, ref);
  if (git(["ls-tree", "--name-only", ref, "--", "story.md"]).trim() === "") {
    warnings.push(`story.md does not exist at git ref ${ref}: the project may not have existed then`);
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
  const today = options.date === undefined ? localDate() : String(options.date).trim();
  const dateError = storyDateError(today);
  if (dateError !== "" || today.trim() === "") {
    throw usageError(`progress --date ${dateError || "must be a YYYY-MM-DD date"}`);
  }
  let project = scanProject(root);
  const words = project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  let logged = null;
  if (options.log) {
    // A chapter that fails to parse would be left out of the logged total.
    assertProjectParses(project, "log progress");
    if (project.fileErrors.some((error) => error.startsWith(`${PROGRESS_FILE}:`))) {
      throw projectError(`Cannot log progress: ${PROGRESS_FILE} does not parse`);
    }
    // Rewriting the log keeps only well-formed sessions, so refuse to log
    // over entries that would be dropped; validate names each problem.
    const logErrors = [];
    validateProgressLog(project, logErrors);
    if (logErrors.length > 0) {
      throw projectError(`Cannot log progress until ${PROGRESS_FILE} is fixed: ${logErrors.join("; ")}`);
    }
    const filePath = path.join(project.root, PROGRESS_FILE);
    const existing = project.progressLog;
    const sessions = withSession(asArray(existing?.data.sessions), today, words);
    const contents = existing === null
      ? progressLogFile(sessions)
      : replaceFrontmatter(existing.rawMarkdown, { ...existing.data, sessions });
    writeFile(filePath, contents, { root: project.root });
    logged = { file: filePath, date: today, words };
    project = scanProject(root);
  }
  const data = project.story.data;
  // An invalid target or deadline would otherwise read as none at all.
  const errors = [...project.fileErrors];
  if (data["target-words"] !== undefined) {
    requireInteger(data, "target-words", "story.md", errors, 1);
  }
  validateDeadline(data, errors);
  return {
    ok: errors.length === 0,
    errors,
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
    throw projectError("story.md cannot be parsed; fix it before recording revision passes");
  }
  const passErrors = [];
  validatePasses(project.story.data, "story.md", passErrors);
  if (passErrors.length > 0) {
    throw projectError(`Fix revision-passes in story.md before changing it: ${passErrors.join("; ")}`);
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
    throw usageError("Usage: story names <name...> [--path <project>]");
  }
  const project = scanProject(root);
  const result = checkNames(list, existingNames(project));
  const errors = [...project.fileErrors, ...result.errors];
  return { ok: errors.length === 0, errors, warnings: result.warnings, results: result.results };
}

// Dialogue fingerprints per character from attributed speech. Advisory.
// With `passage` (text piped to `story voices -`), that text stands in for
// the chapters, attributed against the project's characters.
export function voicesReport(root, options = {}) {
  const project = scanProject(root);
  const chapters = options.passage === undefined
    ? project.chapters.map((chapter) => ({
      id: chapter.id,
      paragraphs: proseParagraphs(chapterProse(readMarkdown(chapter.file, project.root).body, " "))
    }))
    : [{ id: PASSAGE_LABEL, paragraphs: proseParagraphs(passageProse(options.passage)) }];
  const errors = options.passage === undefined ? [...project.fileErrors] : passageErrors(project);
  return { ok: errors.length === 0, errors, ...buildVoices(project, chapters) };
}

// Pacing dashboard over chapters and scene records. Findings are advisory.
export function pacingReport(root) {
  const project = scanProject(root);
  return { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], ...buildPacing(project) };
}

// The label a passage piped to `story prose -` or `story voices -` goes by
// in findings, in place of a chapter file or id.
const PASSAGE_LABEL = "stdin";

// The prose of a piped passage: a whole chapter file (frontmatter and
// outline included) lints as its chapter text, as the chapter itself would.
function passageProse(text) {
  return chapterProse(withoutLeadingFrontmatter(String(text).replace(/\r\n?/g, "\n")), " ");
}

// A piped passage stands in for the chapters and scenes, so a broken
// chapter or scene file does not fail its check; a broken style sheet or
// character file, which the check reads, still does.
function passageErrors(project) {
  return project.fileErrors.filter((error) => !/^(?:chapters|scenes)[\\/]/.test(error));
}

// Advisory prose lint: counts per chapter plus manuscript-wide repeats.
// Findings are warnings, never errors, so the command exits 0 on a readable
// project unless story.md severity promotes one. `thresholds` in the result
// are the warning limits the run used, after any --max-* flags.
export function proseReport(root, options = {}) {
  const thresholds = proseThresholds(options);
  if (options.passage !== undefined) {
    return prosePassageReport(root, options.passage, thresholds);
  }
  const project = scanProject(root);
  const errors = [...project.fileErrors];
  const warnings = [];
  const names = [...project.characters.map((character) => character.name), ...existingNames(project).map((entry) => entry.name)];
  const rules = proseRules(project.styleSheet?.data, names);
  const chapters = [];
  for (const chapter of project.chapters) {
    // Chapters that failed to parse are already in fileErrors, not here.
    const label = relative(project, chapter.file);
    const analysis = analyzeChapter(chapterProse(readMarkdown(chapter.file, project.root).body, " "), rules);
    chapters.push({ file: label, title: chapter.title, analysis });
    warnings.push(...chapterFindings(label, analysis, thresholds));
  }
  const phrases = repeatedPhrases(chapters.map((chapter) => chapter.analysis));
  const similar = similarNames(project.characters);
  for (const [left, right] of similar) {
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
    similarNames: similar,
    thresholds: thresholdSummary(thresholds)
  };
}

// The limits the --max-* flags set, named as the flags are.
function thresholdSummary(thresholds) {
  return { maxFilterWords: thresholds.filterPerThousand, maxAdverbs: thresholds.adverbsPerThousand, maxBookisms: thresholds.maxBookisms };
}

// `story prose -`: the same per-chapter lint over one piped passage, with
// the project's style sheet and character names when `root` names a
// project, and the default rules when it is null. Similar character names
// are a bible finding, not a passage one, so they are left out.
function prosePassageReport(root, passage, thresholds) {
  const project = root === null ? null : scanProject(root);
  const errors = project === null ? [] : passageErrors(project);
  const names = project === null ? [] : [...project.characters.map((character) => character.name), ...existingNames(project).map((entry) => entry.name)];
  const analysis = analyzeChapter(passageProse(passage), proseRules(project?.styleSheet?.data, names));
  return {
    ok: errors.length === 0,
    errors,
    warnings: chapterFindings(PASSAGE_LABEL, analysis, thresholds),
    passage: true,
    styleSheet: Boolean(project?.styleSheet),
    words: analysis.words,
    chapters: [{ file: PASSAGE_LABEL, title: "passage", analysis }],
    phrases: repeatedPhrases([analysis]),
    similarNames: [],
    thresholds: thresholdSummary(thresholds)
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
    lines.push(`# ${chapter.heading}`, "", chapter.body, "");
  }
  manuscript.back.forEach(pushMatter);

  writeFile(output.outFile, `${lines.join("\n").trimEnd()}\n`, output.writeOptions);
  return { outFile: output.outFile, chapters: project.chapters.length, warnings: manuscript.warnings };
}

export function buildBook(root, options = {}) {
  const format = normalizeBuildFormat(options.format ?? "markdown");
  if (options.trim !== undefined && format !== "print") {
    throw usageError("--trim applies only to --format print");
  }
  // Like --format, the trim name is case-insensitive (A5, 6X9), and an
  // unknown one fails before the manuscript is assembled.
  const trim = options.trim === undefined ? DEFAULT_TRIM : String(options.trim).trim().toLowerCase();
  if (!TRIM_SIZES.has(trim)) {
    throw usageError(`Unsupported trim size: ${options.trim}. Supported sizes: ${[...TRIM_SIZES.keys()].join(", ")}`);
  }
  if (options.stamp !== undefined && format !== "html") {
    throw usageError("--stamp applies only to --format html");
  }
  // A build label printed in the review copy: one line, no control characters.
  const stamp = options.stamp === undefined ? "" : String(options.stamp).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (options.stamp !== undefined && stamp === "") {
    throw usageError("--stamp needs a label, such as a date, commit, or round name");
  }
  if (options.noteUrl !== undefined && format !== "html") {
    throw usageError("--note-url applies only to --format html");
  }
  // The note form each paragraph label links to: an http(s) address, so a
  // label can never carry a script.
  const noteUrl = options.noteUrl === undefined ? "" : String(options.noteUrl).replace(/[\u0000-\u0020\u007f]+/g, "");
  if (options.noteUrl !== undefined && !/^https?:\/\/[^/?#]/i.test(noteUrl)) {
    throw usageError("--note-url needs an http or https address, such as a GitHub new-issue link");
  }
  if (options.shunn && format !== "docx") {
    throw usageError("--shunn applies only to --format docx (use --format shunn for a Shunn markdown manuscript)");
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

  // The screenplay skeleton reads chapters and scene records, not matter
  // or prose, so a matter problem cannot stop it.
  if (format === "fountain") {
    const screenplay = screenplayOutline(project, bookChapters(project));
    writeFile(output.outFile, fountainScript(screenplay), output.writeOptions);
    return { outFile: output.outFile, chapters: project.chapters.length, format, warnings: screenplay.warnings };
  }

  const manuscript = manuscriptParts(project);
  if (format === "metadata") {
    const book = htmlBook(manuscript);
    const words = manuscript.chapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0);
    writeFile(output.outFile, metadataSheet({
      title: manuscript.title,
      data: project.story.data,
      meta: manuscript.meta,
      words,
      pages: { "5.5x8.5": estimateBookPages(book, "5.5x8.5"), "6x9": estimateBookPages(book, "6x9") },
      hasCopyrightPage: manuscript.front.concat(manuscript.back).some((entry) => entry.copyright),
      coverReady: coverIsReady(project),
      pendingPermissions: project.matter.filter((entry) => entry.permission === "pending").map((entry) => entry.id),
      todoChapters: project.chapters.filter((chapter) => chapter.todoMarkers > 0).map((chapter) => chapter.id)
    }), output.writeOptions);
  } else if (format === "twee") {
    const branches = branchGraph(project);
    const pinned = project.story.data.ifid;
    // Chapter ids name the passages, so they must be safe in a passage header
    // and a link target.
    const problems = [
      ...project.chapters.filter((chapter) => !isKebabId(chapter.id)).map((chapter) => `${relative(project, chapter.file)}: chapter file names must be kebab-case to name a passage`),
      ...branches.problems,
      ...branches.missing.map((choice) => choice.message),
      ...(pinned === undefined || isIfid(pinned) ? [] : ["story.md ifid must be a version 4 UUID, such as 3F2C9A61-7B1D-4E8A-9C3B-2A6D5E4F1B07"])
    ];
    if (problems.length > 0) {
      throw projectError(`Cannot build twee until these are fixed:\n${problems.join("\n")}`);
    }
    // A derived IFID changes with the title, and two books with one title
    // share it, so the build says how to pin it.
    const ifid = pinned ?? derivedIfid(project.storyId);
    if (pinned === undefined) {
      manuscript.warnings.push(`story.md has no ifid, so the build derived ${ifid} from the story id; add ifid: ${ifid} to story.md to keep it if the title changes`);
    }
    writeFile(output.outFile, tweeSource({
      title: manuscript.title,
      ifid,
      start: branches.passages[0].chapter.id,
      passages: branches.passages.map((passage, position) => ({ name: passage.chapter.id, body: manuscript.chapters[position].body, links: passage.links }))
    }), output.writeOptions);
    manuscript.warnings.push(...branches.warnings);
  } else if (format === "narration") {
    writeFile(output.outFile, narrationScript(manuscript, pronunciationGuide(project)), output.writeOptions);
  } else if (format === "html" || format === "print") {
    const book = htmlBook(manuscript);
    const text = format === "html" ? reviewHtml(book, { stamp, noteUrl }) : printHtml(book, trim);
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

  return { outFile: output.outFile, chapters: manuscript.chapters.length, format, warnings: manuscript.warnings };
}

// The scene records behind `build --format fountain`, in reading order: each
// book chapter with its scenes by scene number, each scene resolved to its
// location name, setting (the scene's own, else its location's), time (the
// scene's, else its chapter's), and cast (the pov unless only mentioned,
// then characters), by character name. Missing records are warnings, since
// the script still builds with forced headings and notes in their place.
function screenplayOutline(project, book) {
  const warnings = [];
  const locations = new Map(project.locations.map((location) => [location.id, location]));
  const characters = new Map(project.characters.map((character) => [character.id, character]));
  const bookChapters = new Set(project.chapters.map((chapter) => chapter.id));
  const unset = new Set();
  const noScenes = [];
  const chronology = chapterChronology(project);
  for (const scene of project.scenes) {
    if (!bookChapters.has(scene.chapter)) {
      warnings.push(`${relative(project, scene.file)} names chapter ${scene.chapter || "(none)"}, which is not in the book, and is left out of the screenplay`);
    }
  }
  const chapters = project.chapters.map((chapter, index) => {
    const scenes = project.scenes
      .filter((scene) => scene.chapter === chapter.id)
      .sort((left, right) => left.scene - right.scene || left.file.localeCompare(right.file, "en"))
      .map((scene) => {
        const location = locations.get(scene.location);
        // The location as it stands in this chapter: a progression can
        // rename it or change its setting (a house that burns down).
        const place = location === undefined ? {} : entityStateAt(location.frontmatter, chapter.id, chronology).state;
        const setting = scene.setting || (typeof place.setting === "string" ? place.setting : "");
        const notes = [];
        if (scene.location === "") {
          notes.push("No location on the scene record: set location for the heading.");
          warnings.push(`${relative(project, scene.file)} has no location; its screenplay heading reads LOCATION TBD`);
        } else if (location === undefined) {
          notes.push(`No location record for ${scene.location}: fix the scene's location or add the location.`);
          warnings.push(`${relative(project, scene.file)} names location ${scene.location}, which has no record; run story links`);
        }
        if (scene.location !== "" && !SCENE_SETTINGS.has(setting)) {
          notes.push(`No setting: add setting (interior, exterior, or both) to ${location ? `${relative(project, location.file)} or the scene` : "the scene"} for INT. or EXT.`);
          if (location !== undefined) {
            unset.add(scene.location);
          }
        }
        const cast = [];
        for (const id of [scene.mentions.includes(scene.pov) ? "" : scene.pov, ...scene.characters]) {
          const name = id === "" ? "" : String(characters.get(id)?.name ?? titleCaseSlug(id));
          if (name !== "" && !cast.includes(name)) {
            cast.push(name);
          }
        }
        return {
          id: scene.id,
          title: String(scene.title),
          locationName: scene.location === "" ? "" : String(place.name ?? titleCaseSlug(scene.location)),
          setting,
          date: scene.date,
          time: scene.time || chapter.time,
          cast,
          dilemma: scene.dilemma,
          outcome: scene.outcome,
          flashbackTo: scene.flashbackTo,
          notes
        };
      });
    if (scenes.length === 0) {
      noScenes.push(chapter.id);
    }
    return { id: chapter.id, heading: book.chapters[index].heading, scenes };
  });
  if (noScenes.length > 0) {
    warnings.push(`No scene records for ${noScenes.join(", ")}: the screenplay has no headings for ${noScenes.length === 1 ? "that chapter" : "those chapters"}`);
  }
  if (unset.size > 0) {
    warnings.push(`No setting (interior, exterior, or both) for ${[...unset].sort().join(", ")}: their scene headings are forced without INT. or EXT.`);
  }
  return {
    title: project.title,
    authors: book.meta.authors,
    form: typeof project.story.data.form === "string" ? project.story.data.form : "",
    chapters,
    warnings
  };
}

// Deterministic synopsis. Budgets are 500 words (1 page) and 1500 (3 pages).
// Level 0 keeps setup (2 sentences), rising action (2), and a Because line
// of climax plus resolution. Level 1 drops rising action. Level 2 also drops
// resolution. The last resort truncates with the same word rules as wordCount.
export function synopsisBook(root, options = {}) {
  const pages = options.pages === undefined ? 1 : parseDecimalInteger(options.pages);
  if (pages !== 1 && pages !== 3) {
    throw usageError(`Unsupported synopsis length: ${options.pages}. Supported pages: 1, 3`);
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
// item ends as a sentence, and scaffold text and HTML comments are skipped.
function synopsisSentences(section) {
  const text = scanComments(String(section), " ").text
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
  return splitSentences(text, { capitalStart: false }).filter((sentence) => !SCAFFOLD_SENTENCES.has(sentence));
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
    words: project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    // Short fiction runs as one text with `#` between sections rather than
    // as chapters on new pages.
    shortForm: data.form === "short-story" || data.form === "flash"
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

// A schema-version above the one this CLI writes belongs to a newer
// story-skills; returns it as a number, or null.
function newerSchemaVersion(value) {
  const version = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof version === "number" && Number.isFinite(version) && version > STORY_SCHEMA_VERSION ? version : null;
}

function newerSchemaMessage(version) {
  return `story.md uses schema-version ${version}, newer than this CLI (${STORY_SCHEMA_VERSION}); upgrade story-skills`;
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

function canonicalChapterId(number) {
  return `chapter-${String(number).padStart(2, "0")}`;
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
      warnings.push(`${kinds.join(" or ")} ${id} (${key}) does not exist${backlink}; story links reports it until you add it`);
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
    followExemptionPatterns(project.root, plan, oldId, newId);
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
      fs.rmSync(oldFile);
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
  if (!collection || (seriesLinks(project.root, data, "follows").length === 0 && seriesLinks(project.root, data, "precedes").length === 0)) {
    return [];
  }
  const own = canonicalPath(project.root);
  const { books } = discoverSeriesBooks(project.root, scanProject);
  return books
    .filter((book) => book.key !== own && book.project[collection].some((entity) => entity.id === oldId))
    .map((book) => `${kind} ${oldId} is also defined in linked book ${book.title} (${seriesLinkPath(project.root, book.root)}); story series matches shared canon by id, so rename it there to ${newId} too, or keep the old id`);
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
    fs.rmSync(file, { force: true });
  });
  const reindexed = reindexProject(project.root);
  const warnings = leftoverReferenceWarnings(project.root, kind, id);
  if (choosers.length > 0) {
    // With the last choice gone the book is linear again: every chapter
    // continues to the next, endings included.
    warnings.push(branchGraph(scanProject(project.root)).branching || !wasBranching
      ? `${choosers.join(", ")} had choices leading to ${id}, which remove dropped; a chapter left with no choices is an ending, so check where ${choosers.length === 1 ? "it leads" : "they lead"} now`
      : `${choosers.join(", ")} had the last choices in the book, leading to ${id}, which remove dropped; with no choices left the book is linear again and each chapter continues to the next, so add choices back to keep it branching`);
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
    warnings.push(`${files.join(", ")} still ${files.length === 1 ? "mentions" : "mention"} ${kind} ${id} in ${numbered ? "links or ids" : "links"} in the text, which remove does not change: edit ${files.length === 1 ? "it" : "them"}, then run story links`);
  }
  const patterns = exemptionPatterns(root).filter((pattern) => renameIdText(pattern, id, probe) !== pattern);
  if (patterns.length > 0) {
    warnings.push(`continuity/exemptions.md has ${patterns.length === 1 ? "a pattern" : `${patterns.length} patterns`} naming ${id}, which ${patterns.length === 1 ? "no longer matches" : "no longer match"} anything: ${patterns.map((pattern) => JSON.stringify(pattern)).join(", ")}. Delete or update ${patterns.length === 1 ? "it" : "them"}`);
  }
  return warnings;
}

const EXEMPTIONS_FILE = path.join("continuity", "exemptions.md");

function exemptionPatterns(root) {
  const filePath = path.join(root, EXEMPTIONS_FILE);
  try {
    const entries = readMarkdown(filePath, root).data.exemptions;
    return Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry.pattern === "string").map((entry) => entry.pattern) : [];
  } catch {
    return [];
  }
}

// Exemption patterns quote finding text, which names ids and file paths
// (`chapters/chapter-01.md has POV ann`). When rename or move changes an id,
// the patterns naming it follow, so a dismissal stays with its finding
// instead of resurfacing, or later dismissing whatever takes the old id.
function followExemptionPatterns(root, plan, oldId, newId) {
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
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.pattern !== "string") {
      return entry;
    }
    const pattern = renameIdText(entry.pattern, oldId, newId);
    if (pattern === entry.pattern) {
      return entry;
    }
    changed = true;
    return { ...entry, pattern };
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
  followExemptionPatterns(project.root, plan, oldId, newId);
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
    followExemptionPatterns(project.root, plan, oldId, newId);
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
  return [`${id} was already referenced before this ${action}, and those references now point at the ${action === "move" ? "moved" : "renamed"} ${kind}: ${files.join(", ")}. Check them`];
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

// Markdown link destinations, autolinks, and bare URLs: text where a bare id
// token is part of a path or address, not a reference to this book's record.
const LINK_OR_URL_PATTERN = /(\]\([^)\n]*\)|<[a-z][a-z0-9+.-]*:[^>\s]*>|\b[a-z][a-z0-9+.-]*:\/\/[^\s<>)\]]*)/gi;

// Applies `transform` to the parts of `body` outside link destinations and
// URLs, leaving those untouched.
function mapOutsideLinks(body, transform) {
  return body.split(LINK_OR_URL_PATTERN).map((part, index) => (index % 2 === 1 ? part : transform(part))).join("");
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
      fs.rmSync(move.oldFile);
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

function storyBible(options) {
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
  for (const field of ["author", "authors", "language"]) {
    if (options.inherited?.[field] !== undefined) {
      data[field] = options.inherited[field];
    }
  }
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

// A registry table cell: a `|` would start a new column and a newline would
// end the row, so escape the one and flatten the other.
function cell(value) {
  return String(value ?? "").replace(/\r?\n|\r/g, " ").replace(/\|/g, "\\|");
}

function characterIndex(storyId, characters, relationshipMap, familyTrees) {
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

function worldIndex(storyId, locations, systems, factions, artifacts, overview) {
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

function plotIndex(storyId, structure, arcs, storyStructure, themeTracking) {
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

function chapterIndex(storyId, chapters) {
  const rows = chapters.length === 0
    ? ["| *No chapters yet* | | | | | |"]
    : chapters.map((chapter) => `| ${cell(chapter.number)} | ${cell(chapter.title)} | ${cell(chapter.pov)} | ${cell(chapter.status)} | ${cell(chapter.wordCount)} | [${chapter.id}](${path.basename(chapter.file)}) |`);
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
    : scenes.map((scene) => `| ${cell(scene.chapter)} | ${cell(scene.scene)} | ${cell(scene.title)} | ${cell(scene.pov)} | ${cell(scene.status)} | [${scene.id}](${scene.id}.md) |`);

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
    : questions.map((question) => `| ${cell(question.title)} | ${cell(question.status)} | ${cell(question.introduced)} | [${question.id}](${question.id}.md) |`);

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
    : promises.map((promise) => `| ${cell(promise.title)} | ${cell(promise.status)} | ${cell(promise.planted)} | [${promise.id}](${promise.id}.md) |`);

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
    : clues.map((clue) => `| ${cell(clue.title)} | ${cell(clue.status)} | ${cell(clue.planted)} | [${clue.id}](${clue.id}.md) |`);

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
    : terms.map((term) => `| ${cell(term.term)} | ${cell(term.category)} | [${term.id}](terms/${term.id}.md) |`);

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
    : pages.map((page) => `| ${cell(page.title)} | ${cell(page.placement)} | ${cell(page.order)} | [${page.id}](${page.id}.md) |`);

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
    : notes.map((note) => `| ${cell(note.title)} | ${cell(note.status)} | ${cell(note.usedIn.join(", "))} | [${note.id}](${note.id}.md) |`);

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
  // Stale word counts and chapters without scenes get their own actions
  // below; every other validate warning (open research a final chapter relies
  // on, an empty matter page) is reviewed here.
  const otherWarnings = validation.warnings.filter((warning) => !/ declares \S+ words but contains \d+$| has no machine-readable scene records$/.test(asFinding(warning).message));
  if (otherWarnings.length > 0) {
    actions.push(action("P1", "Review validation warnings", `Run story validate ${where} and review ${otherWarnings.length} warning${otherWarnings.length === 1 ? "" : "s"}.`));
  }
  if (continuity.warnings.length > 0) {
    actions.push(action("P1", "Review continuity warnings", `Run story continuity ${where} and review ${plural(continuity.warnings.length, "continuity warning")}.`));
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
    actions.push(action("P1", "Refresh word counts", `Run story wordcount ${where} --write for ${plural(staleChapters.length, "chapter")} with stale counts.`));
  }
  if (chaptersWithoutScenes.length > 0) {
    actions.push(action("P1", "Add scene records", `Create machine-readable scene files for ${chaptersWithoutScenes.length} chapters so continuity has durable state.`));
  }
  // The discovery-drafting reconcile loop ends with post-hoc notes; a
  // discovered chapter without them has not been reconciled. In a
  // `draft-mode: discovered` project, a drafted chapter with no mode of its
  // own counts as discovered too.
  const projectDiscovered = project.story.data["draft-mode"] === "discovered";
  const unreconciled = project.chapters.filter((chapter) => !chapter.hasPostHocNotes
    && (chapter.mode === "discovered" || (projectDiscovered && chapter.mode === "" && chapter.wordCount > 0)));
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
    actions.push(action("P2", "Track open questions", openQuestions.length === 1 ? "1 mystery or continuity question is still open." : `${openQuestions.length} mysteries or continuity questions are still open.`));
  }
  const pendingPromises = [];
  for (const promise of project.promises) {
    if (promise.status === "planned" || promise.status === "planted") {
      pendingPromises.push(promise);
    }
  }
  if (pendingPromises.length > 0) {
    actions.push(action("P2", "Review promises and payoffs", pendingPromises.length === 1 ? "1 setup/payoff promise needs planting or a payoff decision." : `${pendingPromises.length} setup/payoff promises need planting or payoff decisions.`));
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
      const checks = known ? ` Run ${passChecks(known, where).join(", ")}.` : "";
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
  // A chapter that exists but has no prose yet (an outline) comes before a
  // new one.
  const undrafted = project.chapters.find((chapter) => chapter.wordCount === 0 && Number.isInteger(chapter.number) && chapter.number > 0);
  if (drafting && undrafted) {
    actions.push(action("P2", `Draft chapter ${undrafted.number}`, `${path.relative(project.root, undrafted.file)} has no prose yet${undrafted.status === "" ? "" : ` (status ${undrafted.status})`}: draft it under ## Chapter Text to ${nextLabel}, then run story wordcount ${where} --write.`));
  } else if (drafting) {
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

// A name is one line: a line break would split the entity's heading and its
// registry row.
function requireSingleLineName(name, kind) {
  if (/[\r\n]/.test(name)) {
    throw usageError(`A ${kind} name must be a single line`);
  }
}

function buildEntity(project, kind, name, options) {
  const requestedId = requestedEntityId(kind, options.id);

  if (kind === "chapter") {
    const number = options.number === undefined
      ? project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0) + 1
      : requirePositiveInteger(options.number, "chapter number");
    const id = `chapter-${String(number).padStart(2, "0")}`;
    return entityResult(project, kind, id, chapterFile(name, number, options));
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
    throw usageError(`An entity kind is required: expected one of ${expected}`);
  }
  if (!Object.hasOwn(KIND_ALIASES, normalized)) {
    throw usageError(`Unsupported entity kind: ${kind}: expected one of ${expected}`);
  }
  return KIND_ALIASES[normalized];
}

// Windows reserves these file names with any extension, so `con.md` cannot
// be checked out there.
const WINDOWS_RESERVED_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

// A folder name every platform can check out: Windows also refuses reserved
// device names with an extension (con.txt), a trailing dot or space, and the
// characters < > : " | ? * and control characters.
function assertPortableFolderName(name) {
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

function assertPortableId(id, kind) {
  if (WINDOWS_RESERVED_ID.test(id)) {
    const file = kind === "story" ? id : `${id}.md`;
    throw usageError(`Cannot use ${kind} id ${id}: Windows reserves the file name ${file}. Choose a longer name, such as "${id} ${kind}"`);
  }
}

function requireKebabId(id, label) {
  if (!isKebabId(id)) {
    throw usageError(`${label} must be a kebab-case id, got "${id}"`);
  }
}

// `--id` for add and rename. Ids stay ASCII kebab-case, so a name written in a
// script with no ASCII letters or digits (Cyrillic, CJK, Greek, Arabic,
// Hebrew, Devanagari) needs one given by hand; the name itself is kept as
// written. Returns undefined when the id should come from the name instead.
function requestedEntityId(kind, value) {
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

function undeducibleIdMessage(kind, name) {
  return `Cannot derive a kebab-case id from ${kind} name "${name}": pass --id with a kebab-case id, or use a name containing ASCII letters or digits`;
}

// A plain decimal integer (`12`, not `0x10`, `1e3`, or `2.0`) within the
// safe-integer range, or null. Number() alone accepts all of those forms and
// silently rounds past 2^53, which creates files validate then rejects.
function parseDecimalInteger(value) {
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
function requireBookNumber(value) {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  const number = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  if (!isBookNumber(number)) {
    throw usageError(`Book number must be 0 or a positive number, such as 2, 0 for a prequel, or 1.5 for a novella; got ${value}`);
  }
  return number;
}

function requirePositiveInteger(value, label) {
  const number = parseDecimalInteger(value);
  if (number === null || number <= 0) {
    throw usageError(`${label} must be a positive integer, got ${value}`);
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

function chapterFile(title, number, options) {
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

function nextSceneNumber(project, chapter) {
  return project.scenes
    .filter((scene) => scene.chapter === chapter)
    .reduce((max, scene) => Math.max(max, scene.scene), 0) + 1;
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

// A reference-style link definition: indent, label, target.
const LINK_DEFINITION_PATTERN = /^( {0,3}\[)([^\]\n]+)\]:[ \t]*(<[^>\n]*>|[^\s]+)/gm;

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

const REGISTRY_HINT = " (it is a registry: run story reindex to rebuild it)";

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

// Folders that never hold project prose: build output, installed packages
// (a local story-skills install ships its own examples), and dot-folders.
const SKIPPED_SCAN_DIRECTORIES = new Set(["dist", "node_modules"]);

// Markdown files a rename or remove may rewrite. Folders deeper than the
// scan limit are skipped rather than fatal, so an unrelated deep notes tree
// cannot block the command.
function markdownFiles(root, { maxFiles = MAX_SCAN_FILES } = {}, depth = 0, collected = null) {
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

// The book's chapters in order, with their headings and prose, and the
// publishing metadata: the part of the manuscript every build shares,
// including the screenplay skeleton, which reads no matter.
function bookChapters(project, action = "build") {
  assertProjectParses(project, action);
  if (project.chapters.length === 0) {
    throw projectError("No chapters found to export");
  }

  for (const chapter of project.chapters) {
    if (!chapter.numberValid || chapter.number <= 0) {
      throw projectError(`${relative(project, chapter.file)}: chapter number must be a positive integer to build`);
    }
  }

  const seenNumbers = new Set();
  for (const chapter of project.chapters) {
    if (seenNumbers.has(chapter.number)) {
      throw projectError(`Duplicate chapter number ${chapter.number}: refusing to build with colliding EPUB ids`);
    }
    seenNumbers.add(chapter.number);
  }

  const meta = publishingMeta(project.story.data);
  const chapters = [];
  const warnings = [];
  // An unnumbered chapter (a Prologue, `numbered: false`) prints its title
  // alone and takes no number, so the chapters after it keep the author's
  // numbering: Prologue, Chapter 1, Chapter 2.
  let unnumberedSoFar = 0;
  const keys = new Set();
  for (const chapter of project.chapters) {
    const markdown = readMarkdown(chapter.file, project.root);
    // Only a real title reaches the book: a missing or blank one leaves the
    // heading as plain "Chapter 2", not "Chapter 2: Chapter 02".
    const rawTitle = markdown.data.title;
    const title = rawTitle === undefined || rawTitle === null ? "" : String(rawTitle).trim();
    const numbered = markdown.data.numbered !== false;
    if (!numbered && title === "") {
      throw projectError(`${relative(project, chapter.file)}: an unnumbered chapter needs a title to build`);
    }
    unnumberedSoFar += numbered ? 0 : 1;
    const displayNumber = numbered ? chapter.number - unnumberedSoFar : null;
    const entry = {
      number: chapter.number,
      title,
      numbered,
      displayNumber,
      heading: numbered ? chapterHeading(displayNumber, title, meta.chapterLabel) : title,
      // LF only, so a CRLF checkout builds the same bytes as an LF one.
      body: chapterProse(markdown.body).replace(/\r\n?/g, "\n").trim()
    };
    chapters.push({ ...entry, key: chapterKey(entry, keys) });
    if (wordCount(entry.body) === 0) {
      warnings.push(`${relative(project, chapter.file)} has no prose yet and is built as a heading-only page`);
    }
  }
  return { meta, chapters, warnings };
}

function manuscriptParts(project, action = "build") {
  const { meta, chapters, warnings } = bookChapters(project, action);

  // Matter ids become EPUB manifest ids and file names, so they must be safe.
  for (const entry of project.matter) {
    if (!isKebabId(entry.id)) {
      throw projectError(`${relative(project, entry.file)}: matter file names must be kebab-case to build`);
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
    back,
    warnings
  };
}

// A chapter's usable `choices` as { text, to } pairs, and the problems
// validate reports for the rest. The text becomes a Twine link, so it may not
// hold link syntax; `to` names the chapter the choice leads to.
function chapterChoices(chapter, label) {
  const choices = [];
  const problems = [];
  if (chapter.choices === undefined) {
    return { choices, problems };
  }
  if (!Array.isArray(chapter.choices)) {
    problems.push(`${label} frontmatter field choices must be a list of { text, to } entries`);
    return { choices, problems };
  }
  chapter.choices.forEach((choice, index) => {
    const at = `${label} choices[${index}]`;
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
      problems.push(`${at} must have text and to, such as { text: Follow the light, to: chapter-02 }`);
      return;
    }
    const text = typeof choice.text === "string" ? choice.text.trim() : "";
    // Not trimmed: move and remove match the id exactly, so a padded
    // `to: "chapter-03 "` would be left behind by them.
    const to = typeof choice.to === "string" ? choice.to : "";
    const before = problems.length;
    if (text === "") {
      problems.push(`${at} needs text: the words the reader picks, quoted if they look like a number`);
    } else if (TWEE_LINK_UNSAFE.test(text)) {
      problems.push(`${at} text cannot contain [, ], |, ->, <-, or a line break, or end in <, which Twine reads as link syntax`);
    }
    if (to.trim() === "") {
      problems.push(`${at} needs to: the id of the chapter it leads to, such as chapter-02`);
    } else if (to !== kebabCase(to)) {
      problems.push(`${at} to ${to} must be a kebab-case chapter id`);
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
function branchGraph(project) {
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
        missing.push({ to: choice.to, message: `${entry.label} choices[${choice.index}] references missing chapter ${choice.to}` });
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
        warnings.push(`${relative(project, passage.chapter.file)} cannot be reached: no choice path from ${start} leads to it`);
      }
    }
  }
  return { branching, passages, problems, missing, warnings };
}

// The review copy's paragraph-label prefix: ch03 for Chapter 3, or the
// title's slug (prologue) for an unnumbered chapter. A slug that is blank,
// looks like another label, or repeats one takes the file number instead.
function chapterKey(chapter, keys) {
  if (chapter.numbered) {
    return `ch${String(chapter.displayNumber).padStart(2, "0")}`;
  }
  let key = kebabCase(chapter.title);
  if (key === "" || keys.has(key) || /^(?:ch\d+$|front-|back-|matter-|unnumbered-)/.test(key)) {
    key = `unnumbered-${String(chapter.number).padStart(2, "0")}`;
  }
  keys.add(key);
  return key;
}

// A copyright page is found by its id or its title, once, and every build
// format reads the flag.
function isCopyrightMatter(entry) {
  return entry.id === "copyright" || /copyright/i.test(entry.title);
}

const MAX_SCAN_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SCAN_FILES = 5000;
const MAX_SCAN_DEPTH = 10;

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
      // Parse errors name the absolute path; the label already names the file.
      const message = error.message.startsWith(`${fullPath} `) ? error.message.slice(fullPath.length + 1) : error.message;
      scanErrors.push(`${label}: ${message}`);
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

function requireStoryFile(projectRoot) {
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
    scanErrors.push(`${path.join("continuity", "exemptions.md")}: ${relativePathError(error, exemptionsPath, root).message}`);
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
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    // The pattern matches as written, so a leading space can mark a word
    // boundary; trimming only measures it. Mirror the validate rules: an
    // entry with a sub-minimum pattern or no reason never takes effect, so it
    // cannot blanket-exempt findings. validate still reports it as an error.
    const pattern = String(entry.pattern ?? "");
    const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
    if (pattern.trim().length < 4 || reason === "") {
      continue;
    }
    exemptions.push({ pattern, reason });
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
// its path inside the project, so CI logs do not show home directories.
function relativePathError(error, filePath, root) {
  const relativePath = path.relative(root, filePath);
  return projectError(error.message.split(filePath).join(relativePath).split(path.resolve(root, relativePath)).join(relativePath));
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

function readRegistryValidationData(file, root, label, errors) {
  const count = errors.length;
  const data = readValidationData(file, root, label, errors);
  if (data === null && errors.length > count) {
    errors[errors.length - 1] += REGISTRY_HINT;
  }
  return data;
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
  return fs.readdirSync(directory).filter((name) => name.endsWith(".md") && !name.startsWith(".") && name !== "_index.md").sort().map((name) => path.join(relativeDir, name));
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

  // The scan never reads through a symlink, so a linked chapter would drop
  // out of registries, counts, and builds without a word.
  for (const relativeDir of ENTITY_SCAN_DIRS) {
    const directory = path.join(root, relativeDir);
    if (!lstatIfExists(directory)?.isDirectory()) {
      continue;
    }
    const linked = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isSymbolicLink() && entry.name.endsWith(".md") && !entry.name.startsWith(".") && entry.name !== "_index.md")
      .map((entry) => path.join(relativeDir, entry.name))
      .sort();
    for (const linkPath of linked) {
      warnings.push(`${linkPath} is a symlink and is ignored: replace it with the file itself`);
    }
  }

  for (const leftover of temporaryFiles(root).sort()) {
    const name = TEMPORARY_FILE_PATTERN.exec(path.basename(leftover))?.[1];
    const target = name ? ` to ${path.join(path.dirname(leftover), name)}` : "";
    warnings.push(`${leftover} was left by an interrupted write${target}; delete it once the files beside it look right`);
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
// Skill-owned folders: generated drafts start here (a synopsis in
// submission/, a narration script in adaptations/), but the files are then
// edited by hand, and reader notes exist nowhere else, so --out may add a
// file but never replace one.
const HAND_EDITED_DIRECTORIES = ["feedback", "submission", "publishing", "adaptations"];

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
      throw refusedError(`Refusing to write generated output to ${path.relative(project.root, outFile)}: it is project source. Use a path such as dist/ instead`);
    }
    if (HAND_EDITED_DIRECTORIES.includes(first) && relativePath.includes(path.sep) && lstatIfExists(outFile) !== null) {
      throw refusedError(`Refusing to overwrite ${path.relative(project.root, outFile)}: files in ${HAND_EDITED_DIRECTORIES.map((dir) => `${dir}/`).join(", ")} may hold hand-written work. Delete it first to regenerate it, or use a path such as dist/ instead`);
    }
  }
}

// The real path of the nearest existing ancestor, with the missing tail
// appended, so a new file under a symlinked folder resolves to its target.
// The walk stops at the latest at the filesystem root, which always exists.
function realPathThroughAncestors(target) {
  const { ancestor, missing } = nearestExistingAncestor(target, fs.existsSync);
  return path.join(fs.realpathSync.native(ancestor), ...missing);
}

function resolveOutputPath(project, out, defaultRelativePath, enforceRoot) {
  const rawOut = out ?? defaultRelativePath;
  if (String(rawOut).trim() === "") {
    throw usageError("--out needs a file path");
  }
  const outFile = path.resolve(project.root, rawOut);
  const shouldEnforceRoot = enforceRoot ?? !path.isAbsolute(String(rawOut));
  let stats;
  try {
    assertNotProjectSource(project, outFile);
    stats = lstatIfExists(outFile);
  } catch (error) {
    // A target that cannot be checked (a path through a file) is a write
    // that cannot happen.
    throw withDefaultExitCode(error, EXIT_CODES.refused);
  }
  // path.resolve drops a trailing slash, so `--out newdir/` is caught here
  // rather than writing a file named newdir.
  // `dist` is the build folder even before it exists; a stray file there is
  // named as such rather than called a directory.
  const isDist = outFile === path.join(project.root, "dist");
  if (stats?.isDirectory() || /[\\/]$/.test(String(rawOut)) || (isDist && !stats)) {
    throw usageError(`--out ${rawOut} is a directory: give a file path`);
  }
  if (isDist) {
    throw usageError(`--out ${rawOut} is reserved for the build folder: give a file path such as dist/book.md`);
  }
  return {
    outFile,
    enforceRoot: shouldEnforceRoot,
    writeOptions: shouldEnforceRoot ? { root: project.root } : {}
  };
}

// Hand-written ids such as `47` or `true` parse as numbers or booleans; read
// them as the string ids they name. Anything else is left for validate.
function scanId(value) {
  return typeof value === "number" || typeof value === "boolean" ? String(value) : value ?? "";
}

function asIdArray(value) {
  return asArray(value).map((item) => (typeof item === "number" || typeof item === "boolean" ? String(item) : item));
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
  metadata: "metadata.md",
  fountain: "fountain",
  twee: "twee"
};

function normalizeBuildFormat(value) {
  const format = String(value).trim().toLowerCase();
  if (format === "markdown" || format === "md") {
    return "markdown";
  }

  if (Object.prototype.hasOwnProperty.call(BUILD_EXTENSIONS, format)) {
    return format;
  }

  throw usageError(`Unsupported build format: ${value === "" ? "(empty)" : value}. Supported formats: ${Object.keys(BUILD_EXTENSIONS).join(", ")}`);
}

// With story.md unreadable or untitled, the story id is only the folder name,
// so comparing every registry's `story` with it would repeat one problem.
function storyIdIsFallback(project) {
  return Boolean(project.story.unreadable) || kebabCase(String(project.story.data.title ?? "")) === "";
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
        errors.push(`${label} frontmatter field ${field} must be text: quote it as ${field}: "${value}"`);
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
  if (data["book-number"] !== undefined && !isBookNumber(data["book-number"])) {
    errors.push("story.md book-number must be a number 0 or more, such as 2, 0 for a prequel, or 1.5 for a novella");
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
    validateEnum(data, "draft-mode", DRAFT_MODES, "story.md", errors);
  }
  validateCover(project, errors);
  validatePasses(data, "story.md", errors);
  validateCliConfig(data, errors);
  validateDeadline(data, errors);
  if (data.ifid !== undefined && !isIfid(data.ifid)) {
    errors.push("story.md ifid must be a version 4 UUID, such as 3F2C9A61-7B1D-4E8A-9C3B-2A6D5E4F1B07");
  }

  if (newerSchemaVersion(data["schema-version"]) !== null) {
    errors.push(newerSchemaMessage(newerSchemaVersion(data["schema-version"])));
  } else if (data["schema-version"] !== undefined && data["schema-version"] !== STORY_SCHEMA_VERSION) {
    errors.push(`story.md schema-version must be ${STORY_SCHEMA_VERSION}`);
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
      warnings.push(`story.md ${field} ${value} uses a backslash; write ${portableSlashes(value)} so the path works on every system`);
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
    const data = readRegistryValidationData(path.join(project.root, relativePath), project.root, label, errors);
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
      errors.push(storyIdMismatch(label, project));
    }

    if (relativePath === path.join("plot", "_index.md")) {
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
    warnNearMissKeys(data, ["died-in", "revived-in"], label, warnings);
    validateProgressions(data, label, PROGRESSION_RULES.character, chronology, errors);
    // Continuity reads a death from died-in, not from status.
    for (const [index, item] of asArray(data.progressions).entries()) {
      if (item && typeof item === "object" && item.field === "status" && item.value === "deceased" && idText(item.from) !== character.diedIn) {
        warnings.push(`${label} progressions[${index}] makes ${character.id} deceased from ${idText(item.from) || "?"}; set died-in: ${idText(item.from) || "<chapter>"} too so story continuity checks appearances after the death`);
      }
    }
  }
}

function validateLocations(project, errors, warnings) {
  const chronology = chapterChronology(project);
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
    validateEnum(data, "setting", SCENE_SETTINGS, label, errors);
    const destinations = new Set();
    for (const route of Array.isArray(data.routes) ? data.routes : []) {
      if (!route || typeof route !== "object" || Array.isArray(route)) {
        continue;
      }
      const to = idText(route.to);
      if (to === "") {
        errors.push(`${label} route is missing to`);
      } else if (destinations.has(to)) {
        warnings.push(`${label} lists more than one route to ${to}; the travel check and story diagram use only the fastest`);
      } else {
        destinations.add(to);
      }
      if (typeof route.hours !== "number" || !Number.isFinite(route.hours) || route.hours <= 0) {
        errors.push(`${label} route to ${route.to ?? "?"} hours must be a positive number`);
      }
      requireScalar(route, "mode", `${label} route to ${route.to ?? "?"}`, errors);
    }
    validateProgressions(data, label, PROGRESSION_RULES.location, chronology, errors);
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
  const chronology = chapterChronology(project);
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
    validateProgressions(data, label, PROGRESSION_RULES.faction, chronology, errors);
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

function validateChapters(project, errors, warnings) {
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
      errors.push(`${label} numbered must be true or false`);
    } else if (data.numbered === false && (typeof data.title !== "string" || data.title.trim() === "")) {
      errors.push(`${label} is unnumbered (numbered: false), so it needs a title to print as its heading`);
    }
    // A planned chapter with no prose yet would ship as a heading-only page.
    // While drafting that is normal, so validate says so only once the book
    // or the chapter claims to be finished; build and export always say so.
    if (chapter.wordCount === 0 && (project.story.data.status === "complete" || WRITTEN_CHAPTER_STATUSES.has(chapter.status))) {
      warnings.push(`${label} has no prose yet, so export and build print it as a heading-only page`);
    }

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
    validateEnum(data, "setting", SCENE_SETTINGS, label, errors);
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

// Keys whose absence changes the meaning of an entry (no `learned-in` means
// known before the story), so a misspelling asserts the opposite of what
// was meant.
const STATE_ENTRY_KEYS = {
  "character-state": ["character", "location"],
  "object-state": ["artifact", "owner", "location", "status", "since"],
  "knowledge-state": ["character", "knows", "learned-in", "fact"]
};

function validateContinuityState(project, errors, warnings) {
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
  for (const [list, keys] of Object.entries(STATE_ENTRY_KEYS)) {
    for (const [index, entry] of (Array.isArray(data[list]) ? data[list] : []).entries()) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      warnNearMissKeys(entry, keys, `${label} ${list}[${index}]`, warnings);
      if (list === "object-state" && entry.status !== undefined && !ARTIFACT_STATUSES.has(entry.status)) {
        errors.push(`${label} ${list}[${index}] status must be one of ${[...ARTIFACT_STATUSES].join(", ")}, got ${entry.status}`);
      }
    }
  }
  if (data.type !== undefined && data.type !== "continuity-state") {
    errors.push(`${label} type must be continuity-state`);
  }
  if (data.story !== undefined && data.story !== project.storyId && !storyIdIsFallback(project)) {
    errors.push(storyIdMismatch(label, project));
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

function validateDeadline(data, errors) {
  if (data.deadline !== undefined) {
    // progress reads only string deadlines, so anything else must fail here
    // rather than silently switching the deadline off.
    const deadlineError = typeof data.deadline === "string" && data.deadline.trim() !== "" ? storyDateError(data.deadline) : "must be a YYYY-MM-DD date";
    if (deadlineError !== "") {
      errors.push(`story.md deadline ${deadlineError}`);
    }
  }
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
    } else if (seen.has(String(entry.date).trim())) {
      errors.push(`${label} repeats date ${String(entry.date).trim()}`);
    } else {
      seen.add(String(entry.date).trim());
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
    const data = readRegistryValidationData(indexPath, project.root, label, errors);
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

// Whether story.md names a cover the EPUB build would accept.
function coverIsReady(project) {
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
function coverImage(project) {
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

// Warns about a key that is a near miss for a checked one, such as
// `learned_in`, `Learned-In`, or `since_chapter`. Free-form keys stay allowed.
const PREFIX_KEYS = new Set(["since", "learned-in", "died-in"]);

function warnNearMissKeys(data, keys, label, warnings) {
  for (const key of Object.keys(data)) {
    if (keys.includes(key)) {
      continue;
    }
    const normalized = key.trim().toLowerCase().replace(/[\s_]+/g, "-");
    const intended = keys.find((known) => normalized === known || (PREFIX_KEYS.has(known) && normalized.startsWith(`${known}-`)) || normalized === known.replace(/-/g, ""));
    if (intended !== undefined && !Object.hasOwn(data, intended)) {
      warnings.push(`${label} has ${key}; did you mean ${intended}?`);
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
    if (data[field] === undefined || (typeof data[field] === "string" && data[field].trim() === "")) {
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

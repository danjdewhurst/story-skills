// story init: a new project folder, its starter files, and its series links.
import fs from "node:fs";
import path from "node:path";
import {
  assertSafeProjectPath,
  assertWriteAllowed,
  isInsideGitDirectory,
  lstatIfExists,
  makeDirectories,
  portablePath,
  readTextFile,
  writeFile
} from "./files.js";
import { withProjectLocks } from "./lock.js";
import { kebabCase } from "./markdown.js";
import { COUNT_UNITS, STORY_FORMS, countUnit } from "./forms.js";
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
import { projectError, refusedError, usageError } from "./exit-codes.js";
import { assertNoInterruptedChange } from "./undo.js";
import {
  REQUIRED_PATHS,
  PROJECT_DIRECTORIES,
  STORY_TENSES,
  STYLE_SHEET_FILE,
  existingStoryData,
  asciiStoryId,
  scanProject,
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
  styleSheet,
  requireSingleLineName,
  assertPortableFolderName,
  assertPortableId,
  requireBookNumber,
  isKebabId,
  asArray
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
  // A folder a split, merge, move, rename, or remove stopped part way in
  // holds only part of that change, so --force does not build on it (see
  // undo.js). `command` names the run in the refusal.
  if (options.force) {
    assertNoInterruptedChange(root, options.command ?? "story init --force");
  }
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

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkContinuity, idText, storyDateError } from "./continuity.js";
import { chapterChronology, knowledgeAudience } from "./chronology.js";
import { PROGRESSION_KINDS, entityStateAt } from "./progressions.js";
import {
  parseFrontmatter,
  replaceFrontmatter,
  stringifyFrontmatter,
  withoutLeadingFrontmatter
} from "./frontmatter.js";
import { buildContext, DEFAULT_CONTEXT_BUDGET, DEFAULT_CONTEXT_SCENES } from "./context.js";
import { isPathInside, lstatIfExists, makeDirectories, projectPath, readTextFile, writeFile } from "./files.js";
import { isTruthy } from "./options.js";
import { chapterProse, characterCount, titleCaseSlug, wordCount } from "./markdown.js";
import { buildTimeline } from "./timeline.js";
import { buildClueMatrix } from "./clues.js";
import { buildGrid } from "./grid.js";
import { buildList } from "./list.js";
import { buildDiagram } from "./diagram.js";
import { buildVoices } from "./voices.js";
import { checkNames, existingNames } from "./names.js";
import { MENTION_KINDS, auditMentions, entityMentions, mentionNames } from "./mentions.js";
import { labelledParagraphs, paragraphLabels } from "./html.js";
import { htmlBook } from "./packaging.js";
import { addedPassNotes, readPasses, updatePasses, validatePasses } from "./passes.js";
import { buildPacing } from "./pacing.js";
import { compareChapters, mapLabels, proseParagraphs } from "./compare.js";
import { compareSimilarity, similarityOptions } from "./similarity.js";
import { existingSnapshot } from "./snapshots.js";
import { PROGRESS_FILE, cleanSessions, computeProgress, historyWeeks, localDate, withSession, writingDays } from "./progress.js";
import {
  BASELINE_CHECKS,
  PROSE_THRESHOLDS,
  analyzeChapter,
  baselineFigures,
  baselineFindings,
  baselineProfile,
  chapterFindings,
  contentWords,
  proseRules,
  proseThresholds,
  repeatedPhrases,
  sentenceLengths,
  similarNames
} from "./prose.js";
import { skippedChecks } from "./languages/index.js";
import { buildSeries, canonicalPath } from "./series.js";
import { warn } from "./findings.js";
import { EXIT_CODES, projectError, usageError } from "./exit-codes.js";
import {
  STYLE_SHEET_FILE,
  scanProject,
  assertProjectParses,
  styleSheet,
  entityConfig,
  normalizeKind,
  parseDecimalInteger,
  requirePositiveInteger,
  SKIPPED_SCAN_DIRECTORIES,
  MAX_SCAN_FILES,
  MAX_SCAN_DEPTH,
  requireStoryFile,
  readMarkdown,
  safeRead,
  asArray,
  CHAPTER_FILENAME_PATTERN,
  relative
} from "./scan.js";
import {
  sessionsWithoutCharacters,
  sampleProblem,
  validateDailyTarget,
  validateDeadline,
  validateProgressLog,
  requireInteger
} from "./validate.js";
import {
  bookChapters,
  manuscriptParts,
  resolveOutputPath
} from "./build.js";

export {
  STORY_SCHEMA_VERSION,
  STYLE_DIALECTS,
  STYLE_SHEET_FILE,
  existingStoryLanguage,
  existingStyleData,
  existingStoryData,
  scanProject,
  assertProjectParses
} from "./scan.js";
export {
  validateProject,
  validateProjectOf,
  validateLinks,
  validateLinksOf
} from "./validate.js";
export {
  newProjectRoot,
  createStoryProject,
  reindexProject,
  computeWordCounts,
  migrateProject,
  fixProject,
  createEntity,
  renameEntity,
  removeEntity,
  moveEntity,
  splitChapter,
  mergeChapters
} from "./mutate.js";
export {
  projectCheck,
  projectReport,
  formatProjectReport,
  projectActions,
  formatActionReport,
  formatDoctorReport,
  shellWord,
  uniqueCheckFindings
} from "./report.js";
export {
  exportManuscript,
  buildBook,
  synopsisBook
} from "./build.js";

// writeFile moved to files.js with the rest of the write path guards; it is
// re-exported because src/import.js imports it from here.
export { writeFile };

export function checkProjectContinuity(root) {
  return checkContinuity(scanProject(root));
}

// Returns knowledge-state entries the character knows at a chapter, in file
// order. Story time decides (by date when both chapters are dated, else by
// number), the same clock as deaths. Each entry has `audience`: "reader"
// when that chapter has been read or the fact is pre-existing, "character"
// when it comes from a flashback the reader has not reached. `project`
// skips the scan for a command that has one.
export function knowledgeAtChapter(root, characterId, atChapterId, project = scanProject(root)) {
  const characters = new Map(project.characters.map((character) => [character.id, character]));
  if (!characters.has(characterId)) {
    // A character whose file fails to parse exists; say why it cannot be read.
    const parseError = project.fileErrors.find((error) => error.file === `characters/${characterId}.md`);
    throw parseError ? projectError(parseError.message) : usageError(`Unknown character ${characterId}`);
  }

  // Knowledge is dated by chapter, so a chapter that fails to parse would
  // silently drop what was learned in it.
  const chapterError = project.fileErrors.find((error) => error.file.startsWith("chapters/"));
  if (chapterError) {
    throw projectError(chapterError.message);
  }

  const chronology = chapterChronology(project);
  const chapterNumbers = chronology.numbers;
  if (!chapterNumbers.has(atChapterId)) {
    throw usageError(`Unknown chapter ${atChapterId}`);
  }

  const stateError = project.fileErrors.find((error) => error.file === "continuity/state.md");
  if (stateError) {
    throw projectError(stateError.message);
  }

  const entries = [];
  const knowledge = project.continuity ? asArray(project.continuity.data["knowledge-state"]) : [];
  for (const [index, entry] of knowledge.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry) || idText(entry.character) !== characterId) {
      continue;
    }
    if (entry.knows === undefined || entry.knows === null || String(entry.knows).trim() === "") {
      throw projectError(`${"continuity/state.md"} knowledge-state[${index}] is missing knows`);
    }
    const learnedIn = idText(entry["learned-in"]);
    const audience = knowledgeAudience(chronology, learnedIn, atChapterId);
    if (audience !== null) {
      entries.push({ knows: String(entry.knows ?? ""), learnedIn, audience });
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
    const entityFile = `${entityConfig(entityKind).dir}/${id}.md`;
    const parseError = project.fileErrors.find((error) => error.file === entityFile);
    throw parseError ? projectError(parseError.message) : usageError(`Unknown ${entityKind} ${id}`);
  }
  // Progressions are ordered by chapter, so a chapter that fails to parse
  // would silently misplace them.
  const chapterError = project.fileErrors.find((error) => error.file.startsWith("chapters/"));
  if (chapterError) {
    throw projectError(chapterError.message);
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
  const blocking = project.fileErrors.find((error) => error.file.startsWith("chapters/")
    || error.file === "continuity/state.md"
    || error.file === `scenes/${targetId}.md`);
  if (blocking) {
    throw projectError(blocking.message);
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

// Compares the current chapters with an earlier draft: a git ref (read with
// git show; nothing is written to the repository), another copy of the
// project on disk, or a named snapshot in .snapshots/ (see snapshots.js).
// --ref is always a git ref and --snapshot always a snapshot, so a branch and
// a snapshot with the same name are never confused. With `anchors`, maps
// those review-copy labels from the earlier draft to the current text
// instead.
export function compareProject(root, options = {}) {
  const given = (value) => typeof value === "string" && value !== "";
  const hasRef = given(options.ref);
  const sources = [hasRef, given(options.against), given(options.snapshot)].filter(Boolean).length;
  if (sources !== 1) {
    throw usageError("compare needs exactly one of --ref <git-ref>, --against <project-path>, or --snapshot <name>");
  }
  const project = scanProject(root);
  // A chapter that fails to parse would be reported as removed.
  assertProjectParses(project, "compare");
  // The earlier draft on disk, for --against and --snapshot.
  const snapshot = given(options.snapshot) ? existingSnapshot(project.root, options.snapshot) : null;
  const other = hasRef ? null : snapshot !== null
    ? { root: snapshot.directory, label: `snapshot ${snapshot.id}` }
    : { root: path.resolve(options.cwd ?? process.cwd(), options.against) };
  const anchors = [].concat(options.anchors ?? []);
  if (anchors.length > 0) {
    return mapProjectLabels(project, anchors, { ...options, other });
  }
  const current = project.chapters.map((chapter) => comparableChapter(chapter.id, readMarkdown(chapter.file, project.root)));
  const warnings = [];
  let previous;
  let label;
  if (hasRef) {
    previous = chaptersAtGitRef(project.root, options.ref, warnings);
    label = `git ref ${options.ref}`;
  } else {
    const scanned = scanProject(other.root);
    if (scanned.fileErrors.length > 0) {
      throw projectError(`Cannot read ${other.label ?? other.root}: ${scanned.fileErrors[0].message}`);
    }
    previous = scanned.chapters.map((chapter) => comparableChapter(chapter.id, readMarkdown(chapter.file, scanned.root)));
    label = other.label ?? other.root;
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
  if (options.other === null) {
    label = `git ref ${options.ref}`;
    previous = withProjectAtGitRef(project.root, options.ref, (oldRoot) => labelsIn(oldRoot, label));
  } else {
    label = options.other.label ?? options.other.root;
    previous = labelsIn(options.other.root, label);
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
function withProjectAtGitRef(root, ref, read, flag = "compare --ref") {
  const { git } = gitAtRef(root, ref, flag);
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

function gitFailure(error, flag) {
  if (error && error.code === "ENOENT") {
    return `${flag} needs git, which was not found on PATH`;
  }
  const stderr = String(error?.stderr ?? "").trim();
  if (stderr === "" || /not a git repository/i.test(stderr)) {
    return `${flag} needs the project inside a git repository`;
  }
  return `${flag} could not run git: ${stderr.split(/\r?\n/)[0]}`;
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
function gitAtRef(root, ref, flag = "compare --ref") {
  if (UNSAFE_GIT_REF.test(ref)) {
    throw usageError(`Unsupported git ref: ${ref}`);
  }
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  let prefix;
  try {
    prefix = git(["rev-parse", "--show-prefix"]).trim();
  } catch (error) {
    throw projectError(gitFailure(error, flag));
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
    warnings.push(warn("story-missing-at-ref", `story.md does not exist at git ref ${ref}: the project may not have existed then`, "story.md"));
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

// story similarity: chapter prose against reference text named by
// --against. An existing file is read as text; a folder contributes the
// chapters of each story project in it (itself, or one nested inside) and
// every other .md, .markdown, and .txt file; anything else is tried as a
// git ref, and the project's own chapters at that commit are the reference.
// --snapshot <name> instead reads the chapters of a snapshot in .snapshots/.
// This project's own files are never a reference. A relative --against from
// story.md cli-defaults is read from the project folder, where the entry is
// written; one on the command line from the current directory.
export function similarityReport(root, options = {}) {
  const against = typeof options.against === "string" ? options.against.trim() : "";
  const snapshotName = typeof options.snapshot === "string" ? options.snapshot.trim() : "";
  if (against === "" && snapshotName === "") {
    throw usageError("similarity needs --against <file|folder|git-ref> or --snapshot <name>: the text to compare the chapters with");
  }
  if (against !== "" && snapshotName !== "") {
    throw usageError("similarity takes one of --against <file|folder|git-ref> or --snapshot <name>, not both");
  }
  const { minWords } = similarityOptions(options);
  const project = scanProject(root);
  // A chapter that fails to parse would be left out of the comparison.
  assertProjectParses(project, "check similarity");
  const chapters = labelledChapters(project, (file) => relative(project, file));
  if (snapshotName !== "") {
    // A snapshot in .snapshots/, found as compare --snapshot finds it; its
    // files are named by their place in the project folder.
    const snapshot = existingSnapshot(project.root, snapshotName);
    const label = `snapshot ${snapshot.id}`;
    // Without story.md its notes and registries would be read as reference
    // text, not just its chapters.
    if (lstatIfExists(path.join(snapshot.directory, "story.md"))?.isFile() !== true) {
      throw projectError(`Cannot check similarity with ${label}: .snapshots/${snapshot.id} has no story.md, so it is not a whole project`);
    }
    const self = canonicalPath(project.root);
    const references = referenceDocuments(canonicalPath(snapshot.directory), (file) => projectPath(self, file), self);
    const report = compareSimilarity(chapters, references, { minWords, label });
    const warnings = report.reference.words === 0 ? [warn("similarity-no-reference-text", `${label} has no chapter text to compare with`)] : [];
    return { ...report, warnings: [...warnings, ...report.warnings] };
  }
  const cwd = options.cwd ?? process.cwd();
  const target = path.resolve(options.againstFromProject ? project.root : cwd, against);
  const warnings = [];
  let references;
  let label;
  if (lstatIfExists(target) !== null) {
    // A path the user names is followed, even through a symlink.
    const real = canonicalPath(target);
    const self = canonicalPath(project.root);
    if (real === self) {
      throw usageError(`similarity --against ${against} is this project: point it at other text, or at a git ref for an earlier draft`);
    }
    label = against;
    // A folder inside the project (research/, say) can hold reference text,
    // but never the chapters being checked.
    const own = new Set(project.chapters.map((chapter) => canonicalPath(chapter.file)));
    references = referenceDocuments(real, (file) => displayPath(cwd, target, real, file), self)
      .filter((reference) => !own.has(canonicalPath(reference.path)));
  } else {
    label = `git ref ${against}`;
    try {
      references = withProjectAtGitRef(project.root, against, (oldRoot) => {
        if (!fs.existsSync(path.join(oldRoot, "story.md"))) {
          throw projectError(`No story project (story.md) at git ref ${against}`);
        }
        const old = scanProject(oldRoot);
        assertProjectParses(old, `read chapters at git ref ${against}`);
        return labelledChapters(old, (file) => `${against}:${projectPath(oldRoot, file)}`);
      }, "similarity --against");
    } catch (error) {
      // A mistyped path is far likelier than a mistyped ref, so say both,
      // and why it could not be a ref.
      const reason = error.exitCode === EXIT_CODES.usage
        ? "no git ref has that name"
        : /needs the project inside a git repository/.test(error.message)
          ? "the project is not in a git repository, so it cannot be a git ref"
          : /not found on PATH/.test(error.message)
            ? "git was not found on PATH to read it as a git ref"
            : null;
      if (reason !== null) {
        throw usageError(`similarity --against ${against} is not a file or folder, and ${reason}`);
      }
      throw error;
    }
  }
  const report = compareSimilarity(chapters, references, { minWords, label });
  if (report.reference.words === 0) {
    warnings.push(warn("similarity-no-reference-text", `${label} has no text to compare with: check --against names the files you meant`));
  }
  return { ...report, warnings: [...warnings, ...report.warnings] };
}

// A reference file as the user will recognise it: the path they typed, with
// the rest of the way to the file, from the current directory.
function displayPath(cwd, typed, real, file) {
  const inside = path.relative(real, file);
  const shown = path.relative(cwd, inside === "" ? typed : path.join(typed, inside));
  return shown.split(path.sep).join("/") || path.basename(file);
}

// The project's chapters as the review copy labels their paragraphs, so a
// passage's label is the one a reader's note would cite. Matter is left
// out: an epigraph or a quoted song is not chapter prose. A project that
// cannot build (two chapters numbered 3, say) is still compared, with each
// chapter's paragraphs numbered p1, p2, ... instead.
function labelledChapters(project, fileName) {
  if (project.chapters.length === 0) {
    return [];
  }
  let book;
  try {
    book = bookChapters(project, "check similarity");
  } catch {
    return project.chapters.map((chapter) => ({
      ...textDocument(chapter.file, fileName(chapter.file), chapterProse(readMarkdown(chapter.file, project.root).body)),
      title: chapter.title ?? ""
    }));
  }
  const { meta, chapters } = book;
  const html = htmlBook({ title: project.title, meta, front: [], chapters, back: [] });
  return html.parts.map((part, index) => ({
    file: fileName(project.chapters[index].file),
    path: project.chapters[index].file,
    title: chapters[index].title,
    paragraphs: labelledParagraphs(part)
      .filter((entry) => entry !== null)
      .map((entry) => ({ label: entry.label, text: entry.paragraph.text }))
  }));
}

const REFERENCE_TEXT_FILE = /\.(?:md|markdown|txt)$/i;

// The reference text at a real (symlink-free) file or folder, one document
// per chapter or file. `self` is this project's folder, never read.
function referenceDocuments(target, display, self) {
  if (!fs.statSync(target).isDirectory()) {
    return [textDocument(target, display(target))];
  }
  const documents = [];
  for (const entry of referenceEntries(target, self)) {
    if (entry.project) {
      const other = scanProject(entry.path);
      assertProjectParses(other, `read chapters in ${display(entry.path)}`);
      documents.push(...labelledChapters(other, display));
    } else {
      documents.push(textDocument(entry.path, display(entry.path)));
    }
  }
  return documents;
}

// The story projects and text files under a folder, in name order,
// skipping hidden entries (and macOS ._ files), symlinks, `self`, and
// anything deeper than the scan limit. A folder with story.md is a
// project, read by its chapters rather than file by file.
function referenceEntries(dir, self, depth = 0, collected = []) {
  if (fs.existsSync(path.join(dir, "story.md"))) {
    if (canonicalPath(dir) !== self) {
      collected.push({ project: true, path: dir });
    }
    return collected;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    // Hidden entries, build output, and _index.md registry tables, which
    // are not prose.
    if (entry.name.startsWith(".") || SKIPPED_SCAN_DIRECTORIES.has(entry.name) || entry.name === "_index.md") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && depth < MAX_SCAN_DEPTH) {
      referenceEntries(fullPath, self, depth + 1, collected);
    } else if (entry.isFile() && REFERENCE_TEXT_FILE.test(entry.name)) {
      collected.push({ project: false, path: fullPath });
      if (collected.length > MAX_SCAN_FILES) {
        throw projectError(`Too many text files in ${dir}: the reference exceeds the ${MAX_SCAN_FILES} file limit`);
      }
    }
  }
  return collected;
}

// A plain reference file as paragraphs labelled p1, p2, ... A markdown file
// loses its frontmatter, and a Story Skills chapter file keeps only its
// ## Chapter Text section. `prose` stands in for the file's text when the
// caller has already read it.
function textDocument(file, name, prose = null) {
  let text = prose ?? readTextFile(file).replace(/^﻿/, "");
  text = text.replace(/\r\n?/g, "\n");
  if (prose === null && /\.(?:md|markdown)$/i.test(file)) {
    text = chapterProse(withoutLeadingFrontmatter(text));
  }
  const paragraphs = text.split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph !== "")
    .map((paragraph, index) => ({ label: `p${index + 1}`, text: paragraph }));
  return { file: name, path: file, paragraphs };
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
  const weeks = historyWeeks(options);
  let project = scanProject(root);
  const words = project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  // A project counted in characters logs its characters beside its words
  // and measures progress in characters.
  const unit = project.unit;
  const characters = unit.name === "characters";
  const counts = characters ? { words, characters: project.chapters.reduce((sum, chapter) => sum + chapter.count, 0) } : { words };
  let logged = null;
  if (options.log) {
    // A chapter that fails to parse would be left out of the logged total.
    assertProjectParses(project, "log progress");
    if (project.fileErrors.some((error) => error.file === PROGRESS_FILE)) {
      throw projectError(`Cannot log progress: ${PROGRESS_FILE} does not parse`);
    }
    // Rewriting the log keeps only well-formed sessions, so refuse to log
    // over entries that would be dropped; validate names each problem.
    const logErrors = [];
    validateProgressLog(project, logErrors);
    if (logErrors.length > 0) {
      throw projectError(`Cannot log progress until ${PROGRESS_FILE} is fixed: ${logErrors.map((error) => error.message).join("; ")}`);
    }
    const filePath = path.join(project.root, PROGRESS_FILE);
    const existing = project.progressLog;
    const sessions = withSession(asArray(existing?.data.sessions), today, counts);
    const contents = existing === null
      ? progressLogFile(sessions, unit)
      : replaceFrontmatter(existing.rawMarkdown, { ...existing.data, sessions });
    writeFile(filePath, contents, { root: project.root });
    logged = { file: filePath, date: today, words, characterCount: counts.characters ?? null };
    project = scanProject(root);
  }
  const data = project.story.data;
  // An invalid target or deadline would otherwise read as none at all.
  const errors = [...project.fileErrors];
  if (data[unit.targetField] !== undefined) {
    requireInteger(data, unit.targetField, "story.md", errors, 1);
  }
  validateDeadline(data, errors);
  validateDailyTarget(data, errors);
  const target = data[unit.targetField];
  const dailyTarget = data[unit.dailyTargetField];
  return {
    ok: errors.length === 0,
    errors,
    warnings: sessionsWithoutCharacters(project),
    logged,
    ...computeProgress({
      unit: unit.name,
      words,
      characters: counts.characters ?? null,
      target: Number.isInteger(target) && target > 0 ? target : null,
      deadline: typeof data.deadline === "string" ? data.deadline : null,
      today,
      dailyTarget: Number.isInteger(dailyTarget) && dailyTarget > 0 ? dailyTarget : null,
      writingDays: writingDays(data["writing-days"]),
      weeks,
      chapters: project.chapters.map((chapter) => ({ id: chapter.id, words: chapter.wordCount, characters: chapter.count, target: chapter.targetCount })),
      sessions: cleanSessions(project.progressLog?.data.sessions)
    })
  };
}

function progressLogFile(sessions, unit) {
  const counts = unit.name === "characters" ? "word and character counts" : "word count";
  return `${stringifyFrontmatter({ type: "progress-log", sessions })}# Progress Log

\`story progress --log\` records the manuscript ${counts} for the day in the frontmatter above. Set \`${unit.targetField}\` and \`deadline\` in \`story.md\`, and \`${unit.targetField}\` on chapters, to measure against them.
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

// The plot grid: arcs by chapter, with each chapter's hook and scene
// outcomes. `from` and `to` narrow the chapters shown. A chapter that fails
// to parse is missing from the scan, so while any file does, the range is
// not resolved: the parse error, not an unknown --from, is the failure.
export function gridReport(root, options = {}) {
  const project = scanProject(root);
  const ok = project.fileErrors.length === 0;
  return { ok, errors: [...project.fileErrors], warnings: [], ...buildGrid(project, ok ? options : {}) };
}

// The files of one entity kind whose frontmatter matches every --where
// filter.
export function listReport(root, kind, where = []) {
  const project = scanProject(root);
  return { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], warnings: [], ...buildList(project, kind, where) };
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
  if (project.fileErrors.some((error) => error.file === "story.md")) {
    throw projectError("story.md cannot be parsed; fix it before recording revision passes");
  }
  const passErrors = [];
  validatePasses(project.story.data, "story.md", passErrors);
  if (passErrors.length > 0) {
    throw projectError(`Fix revision-passes in story.md before changing it: ${passErrors.map((error) => error.message).join("; ")}`);
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
  const result = checkNames(list, existingNames(project), project.pack);
  const errors = [...project.fileErrors, ...result.errors];
  return { ok: errors.length === 0, errors, warnings: result.warnings, results: result.results };
}

// Where chapter prose names one entity (`kind` and `id`), or, with neither,
// each drafted chapter's unlisted names and unnamed mentions as warnings.
export function mentionsReport(root, { kind, id } = {}) {
  if ((kind === undefined) !== (id === undefined)) {
    throw usageError("Usage: story mentions [<kind> <id>] [--path <project>]");
  }
  const project = scanProject(root);
  const errors = [...project.fileErrors];
  if (kind === undefined) {
    const warnings = auditMentions(project, { unnamed: true });
    return { ok: errors.length === 0, errors, warnings, mode: "audit", kind: null, id: null, names: null, chapters: null, matches: null };
  }
  const entityKind = normalizeKind(kind);
  if (!MENTION_KINDS.includes(entityKind)) {
    throw usageError(`story mentions looks for names, so it takes ${MENTION_KINDS.join(", ")}, not ${entityKind}`);
  }
  const entityId = String(id).trim();
  if (!mentionNames(project).some((entry) => entry.kind === entityKind && entry.id === entityId)) {
    throw usageError(`${entityKind} ${entityId} does not exist`);
  }
  return { ok: errors.length === 0, errors, warnings: [], mode: "entity", kind: entityKind, id: entityId, ...entityMentions(project, entityKind, entityId) };
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
  return project.fileErrors.filter((error) => !/^(?:chapters|scenes)[\\/]/.test(error.file));
}

// Advisory prose lint: counts per chapter plus manuscript-wide repeats.
// Findings are warnings, never errors, so the command exits 0 on a readable
// project unless story.md severity promotes one. `thresholds` in the result
// are the warning limits the run used, after any --max-* flags.
export function proseReport(root, options = {}) {
  const thresholds = proseThresholds(options);
  if (options.passage !== undefined) {
    return prosePassageReport(root, options.passage, thresholds, options);
  }
  const project = scanProject(root);
  const errors = [...project.fileErrors];
  const warnings = [];
  const names = [...project.characters.map((character) => character.name), ...existingNames(project).map((entry) => entry.name)];
  const rules = proseRules(project.styleSheet?.data, names, project.pack);
  const profile = proseBaseline(project, rules, options, warnings);
  const chapters = [];
  for (const chapter of project.chapters) {
    // Chapters that failed to parse are already in fileErrors, not here.
    const label = relative(project, chapter.file);
    const prose = chapterProse(readMarkdown(chapter.file, project.root).body, " ");
    chapters.push(lintProse(label, chapter.title, prose, rules, thresholds, profile, warnings));
  }
  const phrases = repeatedPhrases(chapters.map((chapter) => chapter.analysis), PROSE_THRESHOLDS, project.pack);
  const similar = similarNames(project.characters, project.pack);
  for (const [left, right] of similar) {
    warnings.push(warn("prose-similar-names", `characters ${left.id} and ${right.id} have similar first names (${left.name} / ${right.name})`));
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
    thresholds: thresholdSummary(thresholds),
    baseline: profile,
    language: rules.pack.tag,
    skipped: proseSkipped(rules, profile)
  };
}

// One chapter's (or passage's) analysis and findings, measured against the
// baseline when there is one.
function lintProse(label, title, prose, rules, thresholds, profile, warnings) {
  const analysis = analyzeChapter(prose, rules);
  const compared = profile !== null && profile.usable;
  warnings.push(...chapterFindings(label, analysis, thresholds, { baseline: compared, pack: rules.pack }));
  if (profile === null) {
    return { file: label, title, analysis };
  }
  const figures = baselineFigures(analysis, profile, contentWords(prose, rules));
  warnings.push(...baselineFindings(label, analysis, figures, profile, undefined, rules.pack));
  return { file: label, title, analysis, baseline: figures };
}

// The profile of the author's own prose, from the style sheet's `samples`:
// on whenever samples are listed, unless --baseline false turns it off.
// --baseline with no samples is a usage error, since there is nothing to
// compare with.
function proseBaseline(project, rules, options, warnings) {
  const listed = asArray(project?.styleSheet?.data?.samples).filter((entry) => typeof entry === "string" && entry.trim() !== "");
  const wanted = options.baseline === undefined ? listed.length > 0 : isTruthy(options.baseline);
  if (!wanted) {
    return null;
  }
  if (listed.length === 0) {
    throw usageError(`prose --baseline needs samples in ${STYLE_SHEET_FILE}: list files or folders of your own prose, such as samples: [../book-one]`);
  }
  const samples = [];
  const self = canonicalPath(project.root);
  const own = new Set(project.chapters.map((chapter) => canonicalPath(chapter.file)));
  for (const entry of listed) {
    const sample = entry.trim();
    if (path.isAbsolute(sample) || /^[A-Za-z]:/.test(sample)) {
      warnings.push(warn("style-sample-missing", `${STYLE_SHEET_FILE} samples entry ${sample} must be a path relative to the project folder, such as ../book-one, so it is left out`, STYLE_SHEET_FILE));
      continue;
    }
    const problem = sampleProblem(project, sample);
    if (problem !== null) {
      warnings.push(problem);
      continue;
    }
    const target = path.resolve(project.root, sample);
    const real = canonicalPath(target);
    let documents;
    try {
      // This project's chapters are what is being compared, never a sample.
      documents = referenceDocuments(real, (file) => displayPath(project.root, target, real, file), self)
        .filter((document) => !own.has(canonicalPath(document.path)));
    } catch (error) {
      // prose is advisory: one sample it cannot read is reported, not fatal.
      warnings.push(warn("style-sample-unreadable", `${STYLE_SHEET_FILE} samples entry ${sample} cannot be read, so it is left out: ${error.message}`, STYLE_SHEET_FILE));
      continue;
    }
    for (const document of documents) {
      const prose = document.paragraphs.map((paragraph) => paragraph.text).join("\n\n");
      samples.push({ file: document.file, analysis: analyzeChapter(prose, rules), sentenceLengths: sentenceLengths(prose, rules.pack), contentWords: contentWords(prose, rules) });
    }
  }
  const profile = baselineProfile(samples, rules.pack);
  if (!profile.usable) {
    // Name only the fixed limits the language pack runs.
    const limits = [rules.filterWords === null ? null : "filter-word", rules.adverbSuffixes === null ? null : "adverb"].filter(Boolean);
    const fallback = limits.length === 0 ? "" : `: the fixed ${limits.join(" and ")} ${limits.length === 1 ? "limit applies" : "limits apply"} instead`;
    warnings.push(warn("prose-baseline-small", `${STYLE_SHEET_FILE} samples hold ${profile.narrationWords} narration words, too few to compare with (at least 2000)${fallback}`, STYLE_SHEET_FILE));
  }
  return profile;
}

// The prose checks the story's language pack cannot run, with the baseline's
// own when a baseline is on.
function proseSkipped(rules, profile) {
  return profile === null ? rules.skipped : [...rules.skipped, ...skippedChecks(rules.pack, BASELINE_CHECKS)];
}

// The limits the --max-* flags set, named as the flags are.
function thresholdSummary(thresholds) {
  return { maxFilterWords: thresholds.filterPerThousand, maxAdverbs: thresholds.adverbsPerThousand, maxBookisms: thresholds.maxBookisms };
}

// `story prose -`: the same per-chapter lint over one piped passage, with
// the project's style sheet, samples, and character names when `root` names
// a project, and the default rules when it is null. Similar character names
// are a bible finding, not a passage one, so they are left out.
function prosePassageReport(root, passage, thresholds, options = {}) {
  const project = root === null ? null : scanProject(root);
  const errors = project === null ? [] : passageErrors(project);
  const names = project === null ? [] : [...project.characters.map((character) => character.name), ...existingNames(project).map((entry) => entry.name)];
  const rules = proseRules(project?.styleSheet?.data, names, project?.pack);
  const warnings = [];
  const profile = project === null ? null : proseBaseline(project, rules, options, warnings);
  const chapter = lintProse(PASSAGE_LABEL, "passage", passageProse(passage), rules, thresholds, profile, warnings);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    passage: true,
    styleSheet: Boolean(project?.styleSheet),
    words: chapter.analysis.words,
    chapters: [chapter],
    phrases: repeatedPhrases([chapter.analysis], PROSE_THRESHOLDS, rules.pack),
    similarNames: [],
    thresholds: thresholdSummary(thresholds),
    baseline: profile,
    language: rules.pack.tag,
    skipped: proseSkipped(rules, profile)
  };
}

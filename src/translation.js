import crypto from "node:crypto";
import path from "node:path";
import { proseParagraphs } from "./compare.js";
import { projectError, usageError } from "./exit-codes.js";
import { portablePath, projectPath, writeFile } from "./files.js";
import { err, warn } from "./findings.js";
import { parseFrontmatter, replaceFrontmatter } from "./frontmatter.js";
import { chapterProse } from "./markdown.js";
import { assertWritable } from "./mutate-writes.js";
import { assertProjectParses } from "./scan.js";
import { readMarkdown } from "./scan-files.js";
import { canonicalPath, readBookFrontmatter } from "./series.js";
import { nfc } from "./unicode.js";

// A translated edition is its own story project with the source's ids (see
// the adaptation skill). story.md `translation-of` names the source project,
// and a translated chapter's `source-hash` records which version of the
// source chapter it was made from. story translation compares the two
// projects' structure: the chapters, scenes, and entity ids each has, the
// paragraph count of each chapter, and whether a source chapter changed
// since its hash was recorded. It never reads meaning into the text.

export const TRANSLATION_FIELD = "translation-of";
export const SOURCE_HASH_FIELD = "source-hash";

// Hex digits of the sha256 a source-hash keeps: enough to tell versions of
// one chapter apart, short enough to read in frontmatter.
const SOURCE_HASH_LENGTH = 12;

// The entity kinds compared by id, with the name a finding gives each.
// Research notes are about the source's sources, not the book, so a
// translation may leave them out.
const COMPARED_KINDS = [
  ["chapters", "chapter"],
  ["scenes", "scene"],
  ["characters", "character"],
  ["locations", "location"],
  ["systems", "system"],
  ["factions", "faction"],
  ["artifacts", "artifact"],
  ["arcs", "arc"],
  ["questions", "question"],
  ["promises", "promise"],
  ["clues", "clue"],
  ["glossaryTerms", "term"],
  ["matter", "matter"]
];

// story.md `translation-of` as written, or undefined when unset or blank.
export function translationOf(data) {
  const value = data?.[TRANSLATION_FIELD];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

// The source project's path as findings and the report name it: the link
// as written, with forward slashes and no trailing slash, so it is the same
// however the command was started.
export function translationLabel(value) {
  return path.posix.normalize(portablePath(value)).replace(/(.)\/$/, "$1");
}

// Checks story.md `translation-of` the way validateSeriesLinks checks
// `follows` and `precedes`: a relative path with forward slashes to another
// story project. Returns the source project's root, or null when the field
// is unset or the link cannot be followed (the reason is in `errors`).
export function validateTranslationLink(root, data, errors) {
  const value = translationOf(data);
  if (value === undefined) {
    return null;
  }
  const label = `story.md ${TRANSLATION_FIELD} ${value}`;
  // A Windows separator resolves on Windows and nowhere else, so it is
  // reported by name on every platform instead of as a missing project.
  if (value.includes("\\")) {
    errors.push(err("translation-of-backslash", `${label} uses a backslash; write ${value.replace(/\\/g, "/")} so the link works on every system`, "story.md"));
    return null;
  }
  // An absolute path names one machine's folders, so the link breaks for a
  // co-author or a CI runner.
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    errors.push(err("translation-of-absolute", `${label} is an absolute path; write the path from this project's folder, such as ../book-en`, "story.md"));
    return null;
  }
  const target = path.resolve(root, value);
  if (target === root || canonicalPath(target) === canonicalPath(root)) {
    errors.push(err("translation-of-self", `${label} points at this project`, "story.md"));
    return null;
  }
  let source;
  try {
    source = readBookFrontmatter(target);
  } catch (error) {
    errors.push(err("translation-of-unreadable", `${label}: ${error.message}`, "story.md"));
    return null;
  }
  if (!source) {
    errors.push(err("translation-of-not-project", `${label} is not a story project: missing story.md`, "story.md"));
    return null;
  }
  return target;
}

// The source-hash of a chapter: its title and prose paragraphs, as
// proseParagraphs reads them, so rewrapping a paragraph or editing the
// outline or an HTML comment does not count as a change to translate.
export function sourceHash(title, paragraphs) {
  const text = nfc([String(title ?? ""), ...paragraphs].join("\n\n"));
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, SOURCE_HASH_LENGTH);
}

// Compares the translation at `root` with the project its story.md
// `translation-of` names. A --dry-run runs on a copy that holds a copy of
// the source beside it (see preview.js). With `record`, writes each paired
// chapter's current source-hash (only `chapter`'s, when given) into the
// translation.
export function buildTranslation(root, scan, options = {}) {
  const { record = false, chapter } = options;
  const project = scan(root);
  const errors = [...project.fileErrors];
  const warnings = [];
  const empty = (source = null) => ({
    root,
    title: project.title,
    language: project.language,
    source,
    sourceTitle: null,
    sourceLanguage: null,
    chapters: [],
    missing: [],
    extra: [],
    recorded: [],
    ok: false,
    errors,
    warnings
  });
  if (project.story.unreadable) {
    if (record) {
      assertProjectParses(project, "record source hashes");
    }
    return empty();
  }
  const value = translationOf(project.story.data);
  if (value === undefined) {
    throw projectError(`story.md sets no ${TRANSLATION_FIELD}; add ${TRANSLATION_FIELD}: <path to the source project>, such as ../book-en, to compare this translation with its source`);
  }
  const label = translationLabel(value);
  const linkErrors = [];
  const sourceRoot = validateTranslationLink(root, project.story.data, linkErrors);
  errors.push(...linkErrors);
  if (sourceRoot === null) {
    if (record) {
      throw projectError(`Cannot record source hashes: ${linkErrors.map((error) => error.message).join("; ")}`);
    }
    return empty(label);
  }

  let source;
  try {
    source = scan(sourceRoot);
  } catch (error) {
    errors.push(err("translation-of-unreadable", `story.md ${TRANSLATION_FIELD} ${value}: ${error.message}`, "story.md"));
    if (record) {
      throw projectError(`Cannot record source hashes: ${error.message}`);
    }
    return empty(label);
  }
  const sourceFile = (file) => path.posix.join(label, projectPath(source.root, file));
  const ownFile = (file) => projectPath(project.root, file);
  // The source's file errors keep their codes, and name its folder.
  for (const scanError of source.fileErrors) {
    errors.push({ ...scanError, message: `${label}: ${scanError.message}`, file: path.posix.join(label, scanError.file) });
  }
  if (record) {
    assertProjectParses(project, "record source hashes");
    assertProjectParses({ fileErrors: source.fileErrors.map((error) => ({ ...error, message: `${label}: ${error.message}` })) }, "record source hashes");
  }

  const missing = [];
  const extra = [];
  for (const [key, kind] of COMPARED_KINDS) {
    const ownIds = new Map(project[key].map((entity) => [entity.id, entity]));
    const sourceIds = new Map(source[key].map((entity) => [entity.id, entity]));
    for (const [id, entity] of sourceIds) {
      if (!ownIds.has(id)) {
        const file = sourceFile(entity.file);
        missing.push({ kind, id, file });
        errors.push(err("translation-missing", `${kind} ${id} is in the source (${file}) but not in the translation; copy it across and translate it`, file));
      }
    }
    for (const [id, entity] of ownIds) {
      if (!sourceIds.has(id)) {
        const file = ownFile(entity.file);
        extra.push({ kind, id, file });
        errors.push(err("translation-extra", `${file} has ${kind} ${id}, which the source ${label} does not; give it the source's id, or add it to the source first`, file));
      }
    }
  }

  const sourceChapters = new Map(source.chapters.map((entry) => [entry.id, entry]));
  const paired = project.chapters.filter((entry) => sourceChapters.has(entry.id));
  if (chapter !== undefined && !paired.some((entry) => entry.id === chapter)) {
    throw usageError(`Chapter ${chapter} is not in both the translation and its source ${label}; --chapter takes a chapter id that both have`, "chapter");
  }

  const chapters = paired.map((own) => {
    const original = sourceChapters.get(own.id);
    const markdown = readMarkdown(own.file, project.root);
    const ownParagraphs = proseParagraphs(chapterProse(markdown.body));
    const sourceParagraphs = proseParagraphs(chapterProse(readMarkdown(original.file, source.root).body));
    const recorded = recordedHash(markdown.data);
    return {
      own,
      markdown,
      entry: {
        id: own.id,
        file: ownFile(own.file),
        sourceFile: sourceFile(original.file),
        paragraphs: ownParagraphs.length,
        sourceParagraphs: sourceParagraphs.length,
        sourceHash: sourceHash(original.title, sourceParagraphs),
        recordedHash: recorded
      }
    };
  });

  const recorded = [];
  if (record) {
    const targets = chapters.filter(({ entry }) => (chapter === undefined || entry.id === chapter) && entry.recordedHash !== entry.sourceHash);
    assertWritable(project.root, targets.map(({ own }) => own.file));
    for (const { own, markdown, entry } of targets) {
      // An editor saving the chapter meanwhile keeps its save.
      writeFile(own.file, replaceFrontmatter(markdown.rawMarkdown, {
        ...parseFrontmatter(markdown.rawMarkdown, own.file).data,
        [SOURCE_HASH_FIELD]: entry.sourceHash
      }), { root: project.root, unchangedFrom: markdown.rawMarkdown });
      entry.recordedHash = entry.sourceHash;
      recorded.push(entry.id);
    }
  }

  for (const { entry } of chapters) {
    // A chapter with no prose yet has nothing to count.
    if (entry.paragraphs > 0 && entry.paragraphs !== entry.sourceParagraphs) {
      warnings.push(warn("translation-paragraph-count", `${entry.file} has ${entry.paragraphs} ${entry.paragraphs === 1 ? "paragraph" : "paragraphs"}; the source ${entry.sourceFile} has ${entry.sourceParagraphs}`, entry.file));
    }
    entry.sourceChanged = entry.recordedHash === null ? null : entry.recordedHash !== entry.sourceHash;
    if (entry.sourceChanged) {
      warnings.push(warn("translation-source-changed", `${entry.sourceFile} changed since ${entry.file} was translated (${SOURCE_HASH_FIELD} ${entry.recordedHash}, now ${entry.sourceHash}); carry the change across, then run story translation --record --chapter ${entry.id}`, entry.file));
    }
  }

  return {
    root,
    title: project.title,
    language: project.language,
    source: label,
    sourceTitle: source.title,
    sourceLanguage: source.language,
    chapters: chapters.map(({ entry }) => entry),
    missing,
    extra,
    recorded,
    ok: errors.length === 0,
    errors,
    warnings
  };
}

// A chapter's `source-hash` as written, or null when unset or not text
// (validate reports a value that is not text).
function recordedHash(data) {
  const value = data?.[SOURCE_HASH_FIELD];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function formatTranslationReport(report) {
  const lines = [
    `# Translation: ${report.title} (${report.language})`,
    "",
    `Source: ${report.source ?? "unknown"}${report.sourceTitle === null ? "" : ` - ${report.sourceTitle} (${report.sourceLanguage})`}`
  ];
  if (report.recorded.length > 0) {
    lines.push(`Recorded ${SOURCE_HASH_FIELD} in ${report.recorded.length} ${report.recorded.length === 1 ? "chapter" : "chapters"}: ${report.recorded.join(", ")}`);
  }
  lines.push("", "Chapters:");
  if (report.chapters.length === 0) {
    lines.push("- None in both projects");
  }
  for (const entry of report.chapters) {
    const state = entry.sourceChanged === null ? `no ${SOURCE_HASH_FIELD}` : entry.sourceChanged ? "source changed" : "source unchanged";
    lines.push(`- ${entry.id}: ${entry.paragraphs} ${entry.paragraphs === 1 ? "paragraph" : "paragraphs"} (source ${entry.sourceParagraphs}), ${state}`);
  }
  lines.push("", "Only in the source:");
  lines.push(...listed(report.missing));
  lines.push("", "Only in the translation:");
  lines.push(...listed(report.extra));
  return `${lines.join("\n")}\n\n`;
}

function listed(entries) {
  return entries.length === 0 ? ["- None"] : entries.map((entry) => `- ${entry.kind} ${entry.id} (${entry.file})`);
}

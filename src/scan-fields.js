// Record fields read from frontmatter values and file names: ids and lists as
// written by hand, chapter and scene numbers, a chapter's length, and line
// numbers in the file.
import path from "node:path";
import { chapterProse, characterCount, wordCount } from "./markdown.js";

// A chapter's word count and its length in the count unit: `count`, the
// count its frontmatter declares in the unit's field (0 when missing, null
// when not an integer), and the target in the unit's target field (0 when
// unset). For a project counted in words these repeat the word fields.
export function chapterLength(unit, data, markdown) {
  const prose = chapterProse(markdown.body);
  const words = wordCount(prose);
  const declared = data[unit.countField];
  const target = data[unit.targetField];
  return {
    wordCount: words,
    count: unit.name === "characters" ? characterCount(prose) : words,
    declaredCount: declared === undefined ? 0 : Number.isInteger(declared) ? declared : null,
    countMissing: declared === undefined,
    targetCount: Number.isInteger(target) && target > 0 ? target : 0
  };
}

// File line numbers of body line indexes (counted from 0), such as those of
// the `---` scene breaks markdown viewers read as heading underlines (see
// setextSceneBreakLines) and of footnote definitions (see footnoteLines).
// The body is the end of the raw file, so the lines above it are the
// frontmatter's.
export function fileLines(markdown, indexes) {
  const frontmatterLines = markdown.rawMarkdown.slice(0, markdown.rawMarkdown.length - markdown.body.length).split("\n").length - 1;
  return indexes.map((index) => frontmatterLines + index + 1);
}

// Post-hoc notes count only above `## Chapter Text`: everything below that
// heading is prose, counted and exported as part of the book.
export function hasPostHocNotes(body) {
  const chapterText = /^## Chapter Text\s*$/im.exec(body);
  return chapterText !== null && /^## Chapter Notes \(post-hoc\)\s*$/m.test(body.slice(0, chapterText.index));
}

// Hand-written ids such as `47` or `true` parse as numbers or booleans; read
// them as the string ids they name. Anything else is left for validate.
export function scanId(value) {
  return typeof value === "number" || typeof value === "boolean" ? String(value) : value ?? "";
}

export function asIdArray(value) {
  return asArray(value).map((item) => (typeof item === "number" || typeof item === "boolean" ? String(item) : item));
}

export function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [value];
}

export const CHAPTER_FILENAME_PATTERN = /^chapter-(\d+)\.md$/;

export const SCENE_FILENAME_PATTERN = /^(.+)-scene-(\d+)\.md$/;

export function isPositiveIntegerValue(value) {
  const number = Number(value);
  return value !== "" && value !== null && typeof value !== "boolean" && Number.isInteger(number) && number > 0;
}

export function chapterNumber(value, file) {
  return value !== undefined && isPositiveIntegerValue(value) ? Number(value) : chapterNumberFromFile(file);
}

export function chapterNumberFromFile(file) {
  const match = CHAPTER_FILENAME_PATTERN.exec(path.basename(file));
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function sceneNumberFromFile(file) {
  const match = SCENE_FILENAME_PATTERN.exec(path.basename(file));
  return match ? Number.parseInt(match[2], 10) : 0;
}

export function sceneChapterFromFile(file) {
  const match = SCENE_FILENAME_PATTERN.exec(path.basename(file));
  return match ? match[1] : "";
}

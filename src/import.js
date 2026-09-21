import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { titleCaseSlug, wordCount } from "./markdown.js";
import { createStoryProject, reindexProject, writeFile } from "./story.js";

const CHAPTER_HEADING_PATTERN = /^chapter(?![A-Za-z])\s*(?:(?:\d+(?=[\s:.\-–—]|$)|[ivxlc]+(?=[:.\-–—])))?\s*[:.\-–—]*\s*(.*)$/i;
const CANDIDATE_THRESHOLD = 3;
const CANDIDATE_LIMIT = 25;
const CANDIDATE_STOPWORDS = new Set([
  "A", "An", "And", "At", "But", "By", "Dr", "For", "He", "Her", "His", "I", "If", "In", "It", "Its",
  "Mr", "Mrs", "Ms", "No", "Not", "Of", "On", "Or", "She", "That", "The", "Then", "They", "Their",
  "This", "To", "We", "When", "While", "With", "Yes", "You"
]);

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_FILES = 500;

function rejectSymlinkedSource(filePath) {
  if (fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error('Refusing to import symlinked source: ' + filePath);
  }
}

function assertImportFileSize(filePath) {
  const size = fs.statSync(filePath).size;
  if (size > MAX_IMPORT_FILE_BYTES) {
    throw new Error('Refusing to import oversized file ' + filePath + ': ' + size + ' bytes exceeds the ' + MAX_IMPORT_FILE_BYTES + ' byte limit');
  }
}

export function importManuscript(options) {
  const rawSource = String(options.source ?? "").trim();
  if (!rawSource) {
    throw new Error("An import source file or directory is required");
  }

  const cwd = options.cwd ?? process.cwd();
  const source = path.resolve(cwd, rawSource);
  if (!fs.existsSync(source)) {
    throw new Error(`Import source not found: ${source}`);
  }

  const chapters = splitChapters(readSourceDocuments(source));
  if (chapters.length === 0) {
    throw new Error("No chapter content found in import source");
  }

  const created = createStoryProject({
    title: options.title,
    cwd,
    dir: options.dir,
    genre: options.genre,
    subGenre: options.subGenre,
    settingEra: options.settingEra,
    themes: options.themes,
    pov: options.pov,
    tense: options.tense,
    synopsis: options.synopsis ?? `Imported from ${path.basename(source)}. Replace with a 2-3 sentence synopsis.`,
    force: options.force
  });

  const chaptersDir = path.join(created.root, "chapters");
  for (const name of fs.readdirSync(chaptersDir)) {
    if (!/^chapter-\d+\.md$/i.test(name)) {
      continue;
    }
    fs.unlinkSync(path.join(chaptersDir, name));
  }

  let totalWords = 0;
  chapters.forEach((chapter, index) => {
    const number = index + 1;
    const words = wordCount(chapter.prose);
    totalWords += words;
    const file = path.join(chaptersDir, `chapter-${String(number).padStart(2, "0")}.md`);
    writeFile(file, chapterMarkdown(chapter.title, number, words, chapter.prose), { root: created.root });
  });

  reindexProject(created.root);

  return {
    root: created.root,
    storyId: created.storyId,
    chapters: chapters.length,
    words: totalWords,
    candidates: extractNameCandidates(chapters.map((chapter) => chapter.prose).join("\n\n"))
  };
}

export function extractNameCandidates(prose) {
  const counts = new Map();

  for (const match of prose.matchAll(/\b[A-Z][a-z']+(?:\s+[A-Z][a-z']+)+\b/g)) {
    const words = match[0].replace(/\s+/g, " ").split(" ");
    while (words.length > 0 && CANDIDATE_STOPWORDS.has(words[0])) {
      words.shift();
    }
    if (words.length > 0) {
      addCandidate(counts, words.join(" "));
    }
  }

  for (const match of prose.matchAll(/(?<=[a-z][,;:]?\s)(?<![A-Z][a-z']*\s)[A-Z][a-z']+\b(?!\s+[A-Z][a-z'])/g)) {
    if (!CANDIDATE_STOPWORDS.has(match[0])) {
      addCandidate(counts, match[0]);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= CANDIDATE_THRESHOLD)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, CANDIDATE_LIMIT)
    .map(([name, count]) => ({ name, count }));
}

function addCandidate(counts, name) {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

function readSourceDocuments(source) {
  rejectSymlinkedSource(source);
  if (fs.statSync(source).isFile()) {
    assertImportFileSize(source);
    return [{ name: path.basename(source), text: fs.readFileSync(source, "utf8") }];
  }

  const names = [];
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const fullPath = path.join(source, entry.name);
    if (fs.lstatSync(fullPath).isSymbolicLink()) {
      // Never follow symlinks during import. A symlink that resolves to an
      // importable document is rejected loudly; anything else (subdirectory
      // links, dangling links) is skipped so stray links cannot block a
      // safe import.
      let targetIsDocument = false;
      try {
        targetIsDocument = fs.statSync(fullPath).isFile();
      } catch {
        targetIsDocument = false;
      }
      if (targetIsDocument && /\.(md|markdown|txt)$/i.test(entry.name)) {
        rejectSymlinkedSource(fullPath);
      }
      continue;
    }
    if (entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name)) {
      names.push(entry.name);
    }
  }
  names.sort(compareImportNames);
  if (names.length > MAX_IMPORT_FILES) {
    throw new Error('Too many import files in ' + source + ': ' + names.length + ' exceeds the ' + MAX_IMPORT_FILES + ' file limit');
  }
  const documents = names.map((name) => {
    const fullPath = path.join(source, name);
    assertImportFileSize(fullPath);
    return { name, text: fs.readFileSync(fullPath, "utf8") };
  });

  if (documents.length === 0) {
    throw new Error(`No markdown or text files found in ${source}`);
  }

  return documents;
}

export function compareImportNames(left, right) {
  const leftNums = [...left.matchAll(/\d+/g)].map((match) => Number(match[0]));
  const rightNums = [...right.matchAll(/\d+/g)].map((match) => Number(match[0]));
  const length = Math.max(leftNums.length, rightNums.length);
  for (let index = 0; index < length; index += 1) {
    const leftNum = leftNums[index];
    const rightNum = rightNums[index];
    if (leftNum === undefined) {
      return -1;
    }
    if (rightNum === undefined) {
      return 1;
    }
    if (leftNum !== rightNum) {
      return leftNum - rightNum;
    }
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function withoutLeadingFrontmatter(text) {
  try {
    return parseFrontmatter(text).body;
  } catch {
    return text;
  }
}

function splitChapters(documents) {
  const chapters = [];

  for (const document of documents) {
    const text = withoutLeadingFrontmatter(document.text).replace(/\r\n/g, "\n");
    const sections = splitByChapterHeadings(text);
    if (sections.length > 0) {
      chapters.push(...sections);
    } else {
      chapters.push(singleChapter(text, document.name));
    }
  }

  return chapters.filter((chapter) => chapter.prose !== "");
}

function splitByChapterHeadings(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = null;
  const preamble = [];

  for (const line of lines) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const chapterMatch = heading ? CHAPTER_HEADING_PATTERN.exec(heading[1].trim()) : null;
    if (chapterMatch) {
      if (current) {
        sections.push(finishChapter(current));
      }
      current = { title: chapterMatch[1].trim() || heading[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }

  if (!current) {
    return [];
  }

  sections.push(finishChapter(current));
  const opening = stripTitleHeading(preamble.join("\n")).trim();
  if (opening !== "") {
    sections.unshift({ title: "Opening", prose: opening });
  }

  return sections;
}

function finishChapter(section) {
  return { title: section.title, prose: section.lines.join("\n").trim() };
}

function singleChapter(text, fileName) {
  const headingMatch = /^#\s+(.*)$/m.exec(text);
  if (headingMatch) {
    const before = text.slice(0, headingMatch.index).trim();
    const after = text.slice(headingMatch.index + headingMatch[0].length).trim();
    return {
      title: headingMatch[1].trim(),
      prose: [before, after].filter((part) => part !== "").join("\n\n")
    };
  }

  return {
    title: titleCaseSlug(path.basename(fileName, path.extname(fileName))),
    prose: text.trim()
  };
}

function stripTitleHeading(text) {
  return text.replace(/^\s*#\s+[^\n]*\n?/, "");
}

function chapterMarkdown(title, number, words, prose) {
  return `${stringifyFrontmatter({
    title,
    number,
    pov: "",
    locations: [],
    characters: [],
    "arcs-advanced": [],
    status: "draft",
    "word-count": words
  })}# Chapter ${number}: ${title}

## Chapter Text

${prose}
`;
}

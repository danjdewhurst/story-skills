#!/usr/bin/env node

// src/cli.js
import path7 from "node:path";

// src/commands.js
import path6 from "node:path";

// src/clues.js
var LIVE_STATUSES = new Set(["planned", "planted", "paid-off"]);
function buildClueMatrix(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const position = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  const warnings = [];
  const rows = [];
  const clues = [...project.clues].sort((left, right) => {
    const leftPlant = position.get(left.planted) ?? Infinity;
    const rightPlant = position.get(right.planted) ?? Infinity;
    return leftPlant - rightPlant || left.id.localeCompare(right.id, "en");
  });
  for (const clue of clues) {
    const label = `clue ${clue.id}`;
    const plantAt = position.get(clue.planted);
    const payoffAt = position.get(clue.payoff);
    rows.push({
      id: clue.id,
      title: clue.title,
      status: clue.status,
      redHerring: clue.redHerring,
      significanceDelayed: clue.significanceDelayed,
      cells: chapters.map((chapter, index) => cell(index === plantAt, index === payoffAt))
    });
    if (!LIVE_STATUSES.has(clue.status)) {
      continue;
    }
    if (clue.payoff !== "" && clue.planted === "") {
      warnings.push(`${label} is revealed in ${clue.payoff} but never planted: readers cannot play fair`);
    }
    if (plantAt !== undefined && payoffAt !== undefined && payoffAt - plantAt >= 0 && payoffAt - plantAt < 2) {
      const where = payoffAt === plantAt ? "the same chapter as" : "the chapter before";
      warnings.push(`${label} is planted in ${where} its reveal (${clue.planted} -> ${clue.payoff}): late plant gives readers no time to notice it`);
    }
    if (clue.characters.length === 0) {
      warnings.push(`${label} lists no characters: record who could notice it`);
    }
    if (clue.redHerring && clue.payoff === "") {
      warnings.push(`${label} is a red herring with no payoff: record the chapter that debunks it`);
    }
  }
  const live = project.clues.filter((clue) => LIVE_STATUSES.has(clue.status));
  const genuine = live.filter((clue) => !clue.redHerring);
  if (genuine.length >= 3 && !genuine.some((clue) => clue.significanceDelayed)) {
    warnings.push("no clue is significance-delayed: every clue announces its meaning when planted");
  }
  return {
    chapters: chapters.map((chapter) => ({ id: chapter.id, number: chapter.number })),
    rows,
    totals: {
      clues: live.length,
      redHerrings: live.filter((clue) => clue.redHerring).length,
      planted: live.filter((clue) => clue.planted !== "").length,
      revealed: live.filter((clue) => clue.payoff !== "").length
    },
    warnings
  };
}
function cell(planted, revealed) {
  if (planted && revealed) {
    return "x";
  }
  if (planted) {
    return "P";
  }
  if (revealed) {
    return "R";
  }
  return ".";
}
function formatClueMatrix(matrix) {
  const { totals } = matrix;
  const herrings = `${totals.redHerrings} red herring${totals.redHerrings === 1 ? "" : "s"}`;
  const lines = [`Clues: ${totals.clues} live (${herrings}), ${totals.planted} planted, ${totals.revealed} revealed`];
  if (matrix.rows.length === 0) {
    lines.push("", '- None: add clues with story add clue "Name" --planted chapter-02 --payoff chapter-09');
    return `${lines.join(`
`)}
`;
  }
  const width = Math.max(...matrix.rows.map((row) => row.id.length + (row.redHerring ? 2 : 0)), 4);
  const header = matrix.chapters.map((chapter) => String(chapter.number).padStart(3)).join("");
  lines.push("", `${"Clue".padEnd(width)} ${header}`);
  for (const row of matrix.rows) {
    const name = row.redHerring ? `${row.id} ~` : row.id;
    const flags = [row.status];
    if (row.significanceDelayed) {
      flags.push("delayed");
    }
    lines.push(`${name.padEnd(width)} ${row.cells.map((value) => value.padStart(3)).join("")}  ${flags.join(", ")}`);
  }
  lines.push("", "P planted, R revealed, x both, ~ red herring");
  return `${lines.join(`
`)}
`;
}

// src/compare.js
function compareChapters(previous, current) {
  const before = new Map(previous.map((chapter) => [chapter.id, chapter]));
  const after = new Map(current.map((chapter) => [chapter.id, chapter]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const chapters = ids.map((id) => {
    const old = before.get(id);
    const now = after.get(id);
    if (!old) {
      return { id, title: now.title, status: "added", before: 0, after: now.words, unchanged: 0 };
    }
    if (!now) {
      return { id, title: old.title, status: "removed", before: old.words, after: 0, unchanged: 0 };
    }
    const unchanged = unchangedShare(old.paragraphs, now.paragraphs);
    return {
      id,
      title: now.title,
      status: unchanged === 1 && old.paragraphs.length === now.paragraphs.length ? "unchanged" : "changed",
      before: old.words,
      after: now.words,
      unchanged
    };
  });
  const total = (list) => list.reduce((sum, chapter) => sum + chapter.words, 0);
  return {
    chapters,
    beforeChapters: previous.length,
    afterChapters: current.length,
    beforeWords: total(previous),
    afterWords: total(current)
  };
}
function proseParagraphs(prose) {
  return String(prose).split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter(Boolean);
}
function unchangedShare(oldParagraphs, newParagraphs) {
  if (newParagraphs.length === 0) {
    return oldParagraphs.length === 0 ? 1 : 0;
  }
  const remaining = new Map;
  for (const paragraph of oldParagraphs) {
    remaining.set(paragraph, (remaining.get(paragraph) ?? 0) + 1);
  }
  let kept = 0;
  for (const paragraph of newParagraphs) {
    const count = remaining.get(paragraph) ?? 0;
    if (count > 0) {
      kept += 1;
      remaining.set(paragraph, count - 1);
    }
  }
  return kept / newParagraphs.length;
}
function formatComparison(comparison, label) {
  const added = comparison.chapters.filter((chapter) => chapter.status === "added").length;
  const removed = comparison.chapters.filter((chapter) => chapter.status === "removed").length;
  const lines = [
    `Compared with ${label}`,
    `Chapters: ${comparison.beforeChapters} then, ${comparison.afterChapters} now (${added} added, ${removed} removed)`,
    `Words: ${formatNumber(comparison.beforeWords)} then, ${formatNumber(comparison.afterWords)} now (${signed(comparison.afterWords - comparison.beforeWords)})`,
    ""
  ];
  if (comparison.chapters.length === 0) {
    lines.push("- No chapters in either version");
  }
  for (const chapter of comparison.chapters) {
    const name = `${chapter.id} ${chapter.title}`;
    if (chapter.status === "added") {
      lines.push(`- ${name}: added (${formatNumber(chapter.after)} words)`);
    } else if (chapter.status === "removed") {
      lines.push(`- ${name}: removed (was ${formatNumber(chapter.before)} words)`);
    } else if (chapter.status === "unchanged") {
      lines.push(`- ${name}: unchanged (${formatNumber(chapter.after)} words)`);
    } else {
      lines.push(`- ${name}: ${formatNumber(chapter.before)} -> ${formatNumber(chapter.after)} words (${signed(chapter.after - chapter.before)}), ${Math.round(chapter.unchanged * 100)}% of paragraphs unchanged`);
    }
  }
  return `${lines.join(`
`)}
`;
}
function signed(value) {
  return `${value > 0 ? "+" : value < 0 ? "-" : "±"}${formatNumber(Math.abs(value))}`;
}
function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// src/import.js
import fs3 from "node:fs";
import path5 from "node:path";

// src/frontmatter.js
var FRONTMATTER_PATTERN = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;
function parseFrontmatter(markdown, filePath = "markdown") {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) {
    throw new Error(`${filePath} is missing YAML frontmatter`);
  }
  return {
    data: parseYaml(match[1]),
    body: markdown.slice(match[0].length),
    raw: match[1]
  };
}
function stringifyFrontmatter(data) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(...stringifyItem(key, item));
      }
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }
  lines.push("---", "", "");
  return lines.join(`
`);
}
function replaceFrontmatter(markdown, data, bodyOverride) {
  const match = FRONTMATTER_PARTS_PATTERN.exec(markdown);
  if (!match) {
    throw new Error("Cannot replace missing YAML frontmatter");
  }
  const [whole, opening, raw, closing] = match;
  const eol = opening.endsWith(`\r
`) ? `\r
` : `
`;
  const { data: original, blocks } = parseYamlBlocks(raw);
  const lines = [];
  const written = new Set;
  for (const block of blocks) {
    if (block.key === undefined) {
      lines.push(block.line);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(data, block.key)) {
      continue;
    }
    written.add(block.key);
    const value = data[block.key];
    if (isDeepEqual(original[block.key], value)) {
      lines.push(...block.lines);
    } else {
      lines.push(...stringifyEntry(block.key, value, block.items));
    }
  }
  for (const [key, value] of Object.entries(data)) {
    if (!written.has(key)) {
      lines.push(...stringifyEntry(key, value));
    }
  }
  const body = lines.length > 0 ? `${lines.join(eol)}` : "";
  const rest = bodyOverride === undefined ? markdown.slice(whole.length) : String(bodyOverride);
  return `${opening}${body}${closing}${rest}`;
}
var FRONTMATTER_PARTS_PATTERN = /^((?:\uFEFF)?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n)?)/;
function stringifyEntry(key, value, originalItems = []) {
  if (!Array.isArray(value)) {
    return [`${key}: ${formatScalar(value)}`];
  }
  if (value.length === 0) {
    return [`${key}: []`];
  }
  const lines = [`${key}:`];
  const unused = originalItems.slice();
  for (const item of value) {
    const reuse = unused.findIndex((candidate) => isDeepEqual(candidate.value, item));
    if (reuse !== -1) {
      lines.push(...unused[reuse].lines);
      unused.splice(reuse, 1);
    } else {
      lines.push(...stringifyItem(key, item));
    }
  }
  return lines;
}
function stringifyItem(key, item) {
  if (!isPlainObject(item)) {
    return [`  - ${formatScalar(item)}`];
  }
  const entries = Object.entries(item);
  if (entries.length === 0) {
    throw new Error("Cannot stringify empty mapping in " + key);
  }
  const [firstKey, firstValue] = entries[0];
  const lines = [`  - ${firstKey}: ${formatScalar(firstValue)}`];
  for (const [childKey, childValue] of entries.slice(1)) {
    lines.push(`    ${childKey}: ${formatScalar(childValue)}`);
  }
  return lines;
}
function isDeepEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((entry, index) => isDeepEqual(entry, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && isDeepEqual(left[key], right[key]));
  }
  return false;
}
function parseYaml(source) {
  return parseYamlBlocks(source).data;
}
function parseYamlBlocks(source) {
  const lines = source === "" ? [] : source.split(/\r?\n/);
  const data = Object.create(null);
  const blocks = [];
  for (let index = 0;index < lines.length; ) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      blocks.push({ line });
      index += 1;
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!pair) {
      throw new Error(`Unsupported frontmatter line: ${line}`);
    }
    const [, key, rest = ""] = pair;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      throw new Error(`Duplicate frontmatter key: ${key}`);
    }
    if (rest !== "") {
      data[key] = parseScalar(rest);
      blocks.push({ key, lines: [line], items: [] });
      index += 1;
      continue;
    }
    const parsed = parseArray(lines, index + 1);
    if (parsed.nextIndex === index + 1) {
      data[key] = "";
      blocks.push({ key, lines: [line], items: [] });
      index += 1;
      continue;
    }
    data[key] = parsed.items;
    blocks.push({
      key,
      lines: lines.slice(index, parsed.nextIndex),
      items: parsed.items.map((item, itemIndex) => ({
        value: toPlainObject(item),
        lines: lines.slice(parsed.starts[itemIndex], parsed.starts[itemIndex + 1] ?? parsed.nextIndex)
      }))
    });
    index = parsed.nextIndex;
  }
  return { data: toPlainObject(data), blocks };
}
function toPlainObject(value) {
  if (Array.isArray(value)) {
    return value.map(toPlainObject);
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "__proto__") {
        Object.defineProperty(out, key, {
          value: toPlainObject(entry),
          enumerable: true,
          configurable: true,
          writable: true
        });
      } else {
        out[key] = toPlainObject(entry);
      }
    }
    return out;
  }
  return value;
}
function parseArray(lines, startIndex) {
  const items = [];
  const starts = [];
  let index = startIndex;
  while (index < lines.length) {
    const itemMatch = /^  -(?:\s+(.*))?$/.exec(lines[index]);
    if (!itemMatch) {
      break;
    }
    starts.push(index);
    const itemText = itemMatch[1] ?? "";
    const objectMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(itemText);
    if (!objectMatch) {
      items.push(parseScalar(itemText));
      index += 1;
      continue;
    }
    const item = Object.create(null);
    item[objectMatch[1]] = parseScalar(objectMatch[2]);
    index += 1;
    while (index < lines.length) {
      const childMatch = /^    ([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[index]);
      if (!childMatch) {
        break;
      }
      if (Object.prototype.hasOwnProperty.call(item, childMatch[1])) {
        throw new Error(`Duplicate frontmatter key: ${childMatch[1]}`);
      }
      item[childMatch[1]] = parseScalar(childMatch[2]);
      index += 1;
    }
    items.push(item);
  }
  return { items, starts, nextIndex: index };
}
function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "[]") {
    return [];
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return Number.parseFloat(trimmed);
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
function formatScalar(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    throw new Error("Cannot stringify a nested non-empty list");
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (text === "" || text === "[]" || /^(true|false|null|-?\d+(\.\d+)?)$/.test(text) || /^\s|\s$/.test(text) || /[:#\n"']/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// src/markdown.js
function kebabCase(value) {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/['\u2018\u2019]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function titleCaseSlug(slug) {
  return String(slug).split("-").filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}
var WORD_PATTERN = /[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu;
function splitWords(markdown) {
  const normalized = String(markdown).replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ").replace(/[#>*_~|:]/g, " ");
  return normalized.match(WORD_PATTERN) ?? [];
}
function wordCount(markdown) {
  return splitWords(markdown).length;
}
function chapterProse(markdownBody) {
  const chapterTextMatch = /^## Chapter Text\s*$/im.exec(markdownBody);
  if (chapterTextMatch) {
    return markdownBody.slice(chapterTextMatch.index + chapterTextMatch[0].length);
  }
  const outlineMatch = /^## Outline\s*$/im.exec(markdownBody);
  if (!outlineMatch) {
    return stripLeadingH1(markdownBody);
  }
  const afterOutline = markdownBody.slice(outlineMatch.index + outlineMatch[0].length);
  const dividerMatch = /^\s*---\s*$/m.exec(afterOutline);
  return dividerMatch ? afterOutline.slice(dividerMatch.index + dividerMatch[0].length) : afterOutline;
}
function extractSection(markdown, heading) {
  const escaped = escapeRegExp(heading);
  const pattern = new RegExp(`^## ${escaped}\\s*$`, "im");
  const match = pattern.exec(markdown);
  if (!match) {
    return "";
  }
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function stripLeadingH1(markdownBody) {
  const match = /^(?:[ \t]*\r?\n)*[ \t]{0,3}#(?!#)[ \t]+[^\r\n]*(?:\r?\n|$)/.exec(markdownBody);
  return match ? markdownBody.slice(match[0].length) : markdownBody;
}

// src/story.js
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import fs2 from "node:fs";
import path4 from "node:path";

// src/continuity.js
import path from "node:path";
var CHEKHOV_CHAPTER_GAP = 3;
function checkContinuity(project) {
  const errors = [];
  const warnings = [];
  for (const scanError of project.fileErrors ?? []) {
    errors.push(scanError);
  }
  const context = {
    chapterNumbers: new Map(project.chapters.map((chapter) => [chapter.id, chapter.number])),
    characters: new Map(project.characters.map((character) => [character.id, character])),
    locations: new Set(project.locations.map((location) => location.id)),
    artifacts: new Map(project.artifacts.map((artifact) => [artifact.id, artifact])),
    factions: new Set(project.factions.map((faction) => faction.id)),
    latestChapter: project.chapters.filter((chapter) => chapter.status !== "outline").reduce((max, chapter) => Math.max(max, chapter.number), 0),
    highestChapter: project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0)
  };
  checkCharacterDeaths(project, context, errors);
  checkChapterCasts(project, warnings);
  checkSceneCasts(project, warnings);
  checkChapterSequence(project, warnings);
  checkPromises(project, context, errors, warnings);
  checkQuestions(project, context, errors);
  checkClues(project, context, errors, warnings);
  checkStoryCompletion(project, errors);
  checkContinuityState(project, context, errors, warnings);
  checkPropCustody(project, context, errors, warnings);
  checkClock(project, errors, warnings);
  return withExemptions(project, { ok: errors.length === 0, errors, warnings });
}
function withExemptions(project, result) {
  const exemptions = project.exemptions ?? [];
  const keptErrors = [];
  const keptWarnings = [];
  const dismissed = [];
  for (const error of result.errors) {
    dismissFinding(error, exemptions, keptErrors, dismissed);
  }
  for (const warning of result.warnings) {
    dismissFinding(warning, exemptions, keptWarnings, dismissed);
  }
  return { ok: keptErrors.length === 0, errors: keptErrors, warnings: keptWarnings, dismissed };
}
function dismissFinding(finding, exemptions, kept, dismissed) {
  const match = exemptions.find((exemption) => finding.includes(exemption.pattern));
  if (match) {
    dismissed.push({ finding, reason: match.reason });
  } else {
    kept.push(finding);
  }
}
function checkCharacterDeaths(project, context, errors) {
  for (const character of project.characters) {
    if (!character.diedIn) {
      continue;
    }
    const label = relative(project, character.file);
    if (character.status !== "deceased") {
      errors.push(`${label} has died-in ${character.diedIn} but status ${character.status || "unset"}; set status: deceased`);
    }
    const deathNumber = context.chapterNumbers.get(character.diedIn);
    if (deathNumber === undefined) {
      errors.push(`${label} died-in references missing chapter ${character.diedIn}`);
      continue;
    }
    for (const chapter of project.chapters) {
      if (chapter.number > deathNumber && castIncludes(chapter, character.id)) {
        errors.push(`${relative(project, chapter.file)} lists ${character.id}, who died in ${character.diedIn}; move posthumous appearances to mentions`);
      }
    }
    for (const scene of project.scenes) {
      const sceneChapterNumber = context.chapterNumbers.get(scene.chapter);
      if (sceneChapterNumber !== undefined && sceneChapterNumber > deathNumber && castIncludes(scene, character.id)) {
        errors.push(`${relative(project, scene.file)} lists ${character.id}, who died in ${character.diedIn}; move posthumous appearances to mentions`);
      }
    }
  }
}
function checkChapterCasts(project, warnings) {
  for (const chapter of project.chapters) {
    if (chapter.pov && !chapter.characters.includes(chapter.pov)) {
      warnings.push(`${relative(project, chapter.file)} POV character ${chapter.pov} is not listed in characters`);
    }
  }
}
function checkSceneCasts(project, warnings) {
  const chapters = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
  for (const scene of project.scenes) {
    const label = relative(project, scene.file);
    if (scene.pov && !scene.characters.includes(scene.pov)) {
      warnings.push(`${label} POV character ${scene.pov} is not listed in characters`);
    }
    const chapter = chapters.get(scene.chapter);
    if (!chapter) {
      continue;
    }
    for (const characterId of scene.characters) {
      if (!chapter.characters.includes(characterId) && !chapter.mentions.includes(characterId)) {
        warnings.push(`${label} lists ${characterId} but ${relative(project, chapter.file)} does not list them in characters or mentions`);
      }
    }
    if (scene.location && !chapter.locations.includes(scene.location)) {
      warnings.push(`${label} is set in ${scene.location} but ${relative(project, chapter.file)} does not list that location`);
    }
  }
}
function checkChapterSequence(project, warnings) {
  const numbers = project.chapters.map((chapter) => chapter.number).filter((number) => Number.isInteger(number) && number > 0).sort((left, right) => left - right);
  for (let index = 1;index < numbers.length; index += 1) {
    if (numbers[index] > numbers[index - 1] + 1) {
      warnings.push(`Chapter numbering skips from ${numbers[index - 1]} to ${numbers[index]}`);
    }
  }
}
function checkPromises(project, context, errors, warnings) {
  for (const promise of project.promises) {
    if (promise.status === "abandoned") {
      continue;
    }
    const label = relative(project, promise.file);
    const plantedNumber = context.chapterNumbers.get(promise.planted);
    const payoffNumber = context.chapterNumbers.get(promise.payoff);
    if (plantedNumber !== undefined && payoffNumber !== undefined && payoffNumber < plantedNumber) {
      errors.push(`${label} pays off in ${promise.payoff} before it is planted in ${promise.planted}`);
    }
    if (promise.status === "paid-off" && !promise.payoff) {
      errors.push(`${label} is paid-off but has no payoff chapter`);
    }
    if (promise.status === "planted" && !promise.planted) {
      errors.push(`${label} is planted but has no planted chapter`);
    }
    if (promise.status === "planned" && promise.planted) {
      warnings.push(`${label} records planted chapter ${promise.planted} but status is still planned`);
    }
    const chekhov = chekhovWarning(label, promise.planted, plantedNumber, promise.payoff, referencedChapterNumber(context.chapterNumbers, promise.payoff), context.latestChapter);
    if (promise.status === "planted" && chekhov) {
      warnings.push(chekhov);
    }
  }
}
function checkQuestions(project, context, errors) {
  for (const question of project.questions) {
    if (question.status === "abandoned") {
      continue;
    }
    const label = relative(project, question.file);
    const introducedNumber = context.chapterNumbers.get(question.introduced);
    const resolvedNumber = context.chapterNumbers.get(question.resolved);
    if (introducedNumber !== undefined && resolvedNumber !== undefined && resolvedNumber < introducedNumber) {
      errors.push(`${label} resolves in ${question.resolved} before it is introduced in ${question.introduced}`);
    }
    if ((question.status === "answered" || question.status === "resolved") && !question.resolved) {
      errors.push(`${label} is ${question.status} but has no resolved chapter`);
    }
    if (question.status === "open" && question.resolved) {
      errors.push(`${label} records resolved chapter ${question.resolved} but status is still open`);
    }
  }
}
function checkStoryCompletion(project, errors) {
  if (project.story.data.status !== "complete") {
    return;
  }
  for (const promise of project.promises) {
    if (promise.status === "planned" || promise.status === "planted") {
      errors.push(`story.md is complete but ${relative(project, promise.file)} is still ${promise.status}`);
    }
  }
  for (const question of project.questions) {
    if (question.status === "open") {
      errors.push(`story.md is complete but ${relative(project, question.file)} is still open`);
    }
  }
  for (const clue of project.clues) {
    if (clue.status === "planned" || clue.status === "planted") {
      errors.push(`story.md is complete but ${relative(project, clue.file)} is still ${clue.status}`);
    }
  }
}
function checkClues(project, context, errors, warnings) {
  for (const clue of project.clues) {
    if (clue.status === "abandoned") {
      continue;
    }
    const label = relative(project, clue.file);
    const plantedNumber = context.chapterNumbers.get(clue.planted);
    const payoffNumber = context.chapterNumbers.get(clue.payoff);
    if (plantedNumber !== undefined && payoffNumber !== undefined && payoffNumber < plantedNumber) {
      errors.push(`${label} pays off in ${clue.payoff} before it is planted in ${clue.planted}`);
    }
    if (clue.status === "paid-off" && !clue.payoff) {
      errors.push(`${label} has status paid-off but no payoff chapter recorded`);
    }
    if (clue.status === "planted" && !clue.planted) {
      errors.push(`${label} is planted but no plant chapter recorded`);
    }
    const chekhov = chekhovWarning(label, clue.planted, plantedNumber, clue.payoff, referencedChapterNumber(context.chapterNumbers, clue.payoff), context.latestChapter);
    if (clue.status === "planted" && chekhov) {
      warnings.push(chekhov);
    }
  }
}
function referencedChapterNumber(chapterNumbers, id) {
  if (typeof id !== "string" || id === "") {
    return;
  }
  if (chapterNumbers.has(id)) {
    return chapterNumbers.get(id);
  }
  const match = /^chapter-(\d+)$/.exec(id);
  return match ? Number.parseInt(match[1], 10) : undefined;
}
function chekhovWarning(label, planted, plantedNumber, payoff, payoffNumber, latestChapter) {
  if (plantedNumber === undefined || latestChapter - plantedNumber < CHEKHOV_CHAPTER_GAP) {
    return "";
  }
  if (payoff && payoffNumber !== undefined && payoffNumber > latestChapter) {
    return "";
  }
  if (payoff && payoffNumber !== undefined && payoffNumber <= latestChapter) {
    return `${label} payoff chapter ${payoff} has passed and status is still planted`;
  }
  return `${label} was planted in ${planted}, ${latestChapter - plantedNumber} chapters ago, and has no payoff yet`;
}
function checkContinuityState(project, context, errors, warnings) {
  if (!project.continuity) {
    return;
  }
  const label = path.join("continuity", "state.md");
  const data = project.continuity.data;
  const currentChapter = data["current-chapter"];
  if (Number.isInteger(currentChapter)) {
    if (currentChapter > context.highestChapter) {
      errors.push(`${label} current-chapter ${currentChapter} is ahead of the latest chapter ${context.highestChapter}`);
    } else if (currentChapter < context.latestChapter) {
      warnings.push(`${label} current-chapter ${currentChapter} is behind the latest chapter ${context.latestChapter}; update continuity state after drafting`);
    }
  }
  for (const [index, entry] of stateEntries(data["character-state"]).entries()) {
    const entryLabel = `${label} character-state[${index}]`;
    if (!requireMapping(entry, entryLabel, errors)) {
      continue;
    }
    if (!entry.character || !context.characters.has(entry.character)) {
      errors.push(`${entryLabel} references missing character ${entry.character || "(unset)"}`);
    }
    if (entry.location && !context.locations.has(entry.location)) {
      errors.push(`${entryLabel} references missing location ${entry.location}`);
    }
  }
  const knownFacts = new Map;
  for (const [index, entry] of stateEntries(data["knowledge-state"]).entries()) {
    const entryLabel = `${label} knowledge-state[${index}]`;
    if (!requireMapping(entry, entryLabel, errors)) {
      continue;
    }
    if (entry.fact !== undefined) {
      const fact = String(entry.fact);
      if (!isKebabId(fact)) {
        errors.push(`${entryLabel} fact ${fact || "(empty)"} must be a kebab-case id`);
      } else {
        const key = `${entry.character}\x00${fact}`;
        if (knownFacts.has(key)) {
          errors.push(`${entryLabel} repeats fact ${fact} for ${entry.character} from knowledge-state[${knownFacts.get(key)}]`);
        } else {
          knownFacts.set(key, index);
        }
      }
    }
    if (!entry.character || !context.characters.has(entry.character)) {
      errors.push(`${entryLabel} references missing character ${entry.character || "(unset)"}`);
    }
    if (!entry.knows) {
      errors.push(`${entryLabel} is missing knows`);
    }
    if (entry["learned-in"] && !context.chapterNumbers.has(entry["learned-in"])) {
      errors.push(`${entryLabel} references missing chapter ${entry["learned-in"]}`);
    }
  }
  for (const [index, entry] of stateEntries(data["object-state"]).entries()) {
    const entryLabel = `${label} object-state[${index}]`;
    if (!requireMapping(entry, entryLabel, errors)) {
      continue;
    }
    const artifact = context.artifacts.get(entry.artifact);
    if (!entry.artifact || !artifact) {
      errors.push(`${entryLabel} references missing artifact ${entry.artifact || "(unset)"}`);
    }
    if (entry.owner && !context.characters.has(entry.owner) && !context.factions.has(entry.owner)) {
      errors.push(`${entryLabel} references missing owner ${entry.owner}`);
    }
    if (entry.location && !context.locations.has(entry.location)) {
      errors.push(`${entryLabel} references missing location ${entry.location}`);
    }
    if (entry.status && artifact && artifact.status && entry.status !== artifact.status) {
      warnings.push(`${entryLabel} status ${entry.status} conflicts with ${relative(project, artifact.file)} status ${artifact.status}`);
    }
  }
}
function castIncludes(record, characterId) {
  return record.pov === characterId || record.characters.includes(characterId);
}
function stateEntries(value) {
  return Array.isArray(value) ? value : [];
}
function isKebabId(value) {
  return value !== "" && value === kebabCase(value);
}
function requireMapping(entry, entryLabel, errors) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`${entryLabel} must be a mapping`);
    return false;
  }
  return true;
}
function relative(project, file) {
  return path.relative(project.root, file);
}
function checkPropCustody(project, context, errors, warnings) {
  const destroyed = [];
  if (project.continuity) {
    const label = path.join("continuity", "state.md");
    for (const [index, entry] of stateEntries(project.continuity.data["object-state"]).entries()) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const status = String(entry.status ?? "");
      if (status !== "destroyed" && status !== "lost") {
        continue;
      }
      const entryLabel = `${label} object-state[${index}]`;
      const artifact = String(entry.artifact ?? "");
      const since = entry.since === undefined || entry.since === null ? "" : String(entry.since);
      if (since === "") {
        warnings.push(`${entryLabel} is destroyed/lost with no since chapter; custody cannot be checked`);
        continue;
      }
      const sinceNumber = context.chapterNumbers.get(since);
      if (sinceNumber === undefined) {
        errors.push(`${entryLabel} references missing since chapter ${since}`);
        continue;
      }
      destroyed.push({ artifact, since, sinceNumber });
    }
  }
  for (const { artifact, since, sinceNumber } of destroyed) {
    if (artifact === "") {
      continue;
    }
    for (const scene of project.scenes) {
      const sceneNumber = context.chapterNumbers.get(scene.chapter);
      if (sceneNumber === undefined || sceneNumber <= sinceNumber) {
        continue;
      }
      const sceneLabel = relative(project, scene.file);
      if (scene.stateChanges.some((change) => stateChangeTargets(change, artifact))) {
        errors.push(`${sceneLabel} uses ${artifact}, destroyed/lost since ${since}`);
      }
      if (scene.mentions.includes(artifact)) {
        errors.push(`${sceneLabel} mentions ${artifact}, destroyed/lost since ${since}`);
      }
    }
    for (const chapter of project.chapters) {
      if (chapter.number <= sinceNumber) {
        continue;
      }
      if (chapter.mentions.includes(artifact)) {
        errors.push(`${relative(project, chapter.file)} mentions ${artifact}, destroyed/lost since ${since}`);
      }
    }
  }
}
function stateChangeTargets(change, artifact) {
  if (!change || typeof change !== "object" || Array.isArray(change)) {
    return false;
  }
  return change.target === artifact;
}
var TIME_RANKS = new Map([
  ["dawn", 300],
  ["morning", 420],
  ["midday", 720],
  ["afternoon", 900],
  ["evening", 1140],
  ["night", 1380]
]);
function checkClock(project, errors, warnings) {
  if (!project.scenes.some((scene) => scene.date !== "") && !project.chapters.some((chapter) => chapter.date !== "")) {
    return;
  }
  const scenesByChapter = new Map;
  for (const scene of project.scenes) {
    if (scene.date === "") {
      continue;
    }
    const label = relative(project, scene.file);
    const parsed = parseClockDate(scene.date);
    if (!parsed) {
      warnings.push(`${label} has malformed date "${scene.date}"`);
      continue;
    }
    const minutes = parseClockTime(scene.time);
    if (scene.time !== "" && minutes === undefined) {
      warnings.push(`${label} has malformed time "${scene.time}"`);
    }
    if (scene.travelHours < 0) {
      warnings.push(`${label} has negative travel-hours ${scene.travelHours}`);
    }
    const dated = scenesByChapter.get(scene.chapter);
    if (dated) {
      dated.push({ scene, label, days: parsed.days, minutes });
    } else {
      scenesByChapter.set(scene.chapter, [{ scene, label, days: parsed.days, minutes }]);
    }
  }
  for (const dated of scenesByChapter.values()) {
    dated.sort((left, right) => left.scene.scene - right.scene.scene);
    checkSceneSequence(dated, errors, warnings);
  }
  checkCrossChapterSceneClock(project, scenesByChapter, errors, warnings);
  checkChapterDates(project, warnings);
  checkRouteTravel(project, errors);
}
var TIME_RANGES = new Map([
  ["dawn", [240, 419]],
  ["morning", [300, 719]],
  ["midday", [660, 839]],
  ["afternoon", [720, 1079]],
  ["evening", [1020, 1319]],
  ["night", [1200, 1439]]
]);
function sceneWindow(days, time) {
  const text = String(time ?? "").trim().toLowerCase();
  const named = TIME_RANGES.get(text);
  const exact = named === undefined ? parseClockTime(text) : undefined;
  const [from, to] = named ?? (exact === undefined ? [0, 1439] : [exact, exact]);
  return { earliest: days * 1440 + from, latest: days * 1440 + to, exact: exact !== undefined };
}
function checkRouteTravel(project, errors) {
  const graph = routeGraph(project.locations);
  if (graph.size === 0) {
    return;
  }
  const sightings = new Map;
  for (const scene of project.scenes) {
    const parsed = parseClockDate(scene.date);
    if (!parsed || scene.location === "" || !graph.has(scene.location)) {
      continue;
    }
    const window = sceneWindow(parsed.days, scene.time);
    const present = new Set(scene.characters.filter((id) => typeof id === "string"));
    if (typeof scene.pov === "string" && scene.pov !== "") {
      present.add(scene.pov);
    }
    for (const characterId of present) {
      const list = sightings.get(characterId) ?? [];
      list.push({ scene, label: relative(project, scene.file), ...window });
      sightings.set(characterId, list);
    }
  }
  const distances = new Map;
  const distance = (from, to) => {
    const key = `${from}>${to}`;
    if (!distances.has(key)) {
      distances.set(key, shortestRouteHours(graph, from, to));
    }
    return distances.get(key);
  };
  for (const [characterId, list] of [...sightings.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    list.sort((left, right) => left.earliest - right.earliest || left.latest - right.latest || left.label.localeCompare(right.label, "en"));
    for (let index = 1;index < list.length; index += 1) {
      const current = list[index];
      for (let back = index - 1;back >= 0; back -= 1) {
        const previous = list[back];
        if (previous.scene.location === current.scene.location) {
          continue;
        }
        const needed = distance(previous.scene.location, current.scene.location);
        const elapsed = Math.max(current.latest - previous.earliest, previous.latest - current.earliest) / 60;
        if (needed !== undefined && elapsed < needed) {
          const gap = previous.exact && current.exact ? formatHours(elapsed) : `at most ${formatHours(elapsed)}`;
          errors.push(`${current.label} puts ${characterId} at ${current.scene.location} ${gap} after ${previous.label} at ${previous.scene.location}, but the fastest route takes ${formatHours(needed)}`);
          break;
        }
      }
    }
  }
}
function routeGraph(locations) {
  const graph = new Map;
  const declared = new Set;
  const addEdge = (from, to, hours) => {
    if (!graph.has(from)) {
      graph.set(from, new Map);
    }
    const edges = graph.get(from);
    if (!edges.has(to) || edges.get(to) > hours) {
      edges.set(to, hours);
    }
  };
  const valid = [];
  const known = new Set(locations.map((location) => location.id));
  for (const location of locations) {
    for (const route of location.routes ?? []) {
      if (route && typeof route === "object" && typeof route.to === "string" && known.has(route.to) && route.to !== location.id && typeof route.hours === "number" && Number.isFinite(route.hours) && route.hours > 0) {
        valid.push([location.id, route.to, route.hours]);
        declared.add(`${location.id}>${route.to}`);
      }
    }
  }
  for (const [from, to, hours] of valid) {
    addEdge(from, to, hours);
    if (!declared.has(`${to}>${from}`)) {
      addEdge(to, from, hours);
    }
  }
  return graph;
}
function shortestRouteHours(graph, from, to) {
  const distances = new Map([[from, 0]]);
  const settled = new Set;
  let current = from;
  while (current !== undefined) {
    const best = distances.get(current);
    if (current === to) {
      return best;
    }
    settled.add(current);
    for (const [next, hours] of graph.get(current) ?? []) {
      if (!distances.has(next) || best + hours < distances.get(next)) {
        distances.set(next, best + hours);
      }
    }
    current = undefined;
    let nearest = Infinity;
    for (const [node, distance] of distances) {
      if (!settled.has(node) && distance < nearest) {
        nearest = distance;
        current = node;
      }
    }
  }
  return;
}
function formatHours(hours) {
  return `${Math.round(hours * 10) / 10}h`;
}
function checkCrossChapterSceneClock(project, scenesByChapter, errors, warnings) {
  const ordered = [...project.chapters].sort((left, right) => left.number - right.number);
  let previous = null;
  for (const chapter of ordered) {
    const dated = scenesByChapter.get(chapter.id);
    if (!dated || dated.length === 0) {
      continue;
    }
    const sorted = [...dated].sort((left, right) => left.scene.scene - right.scene.scene);
    if (previous) {
      checkSceneSequence([previous, sorted[0]], errors, warnings);
    }
    previous = sorted[sorted.length - 1];
  }
}
function checkSceneSequence(dated, errors, warnings) {
  for (let index = 1;index < dated.length; index += 1) {
    const previous = dated[index - 1];
    const current = dated[index];
    if (timestampBefore(current, previous)) {
      warnings.push(`${current.label} timestamp runs backward`);
      continue;
    }
    if (current.scene.travelHours > 0 && previous.minutes !== undefined && current.minutes !== undefined) {
      const elapsedHours = (timestampMinutes(current) - timestampMinutes(previous)) / 60;
      if (elapsedHours < current.scene.travelHours) {
        errors.push(`${current.label} allows only ${elapsedHours}h for travel of ${current.scene.travelHours}h`);
      }
    }
  }
}
function timestampBefore(current, previous) {
  if (current.days !== previous.days) {
    return current.days < previous.days;
  }
  if (current.minutes === undefined || previous.minutes === undefined) {
    return false;
  }
  return current.minutes < previous.minutes;
}
function timestampMinutes(stamp) {
  return stamp.days * 1440 + stamp.minutes;
}
function storyDateError(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "";
  }
  if (!parseClockDate(String(value))) {
    return `date must be a real YYYY-MM-DD calendar day, got ${value}`;
  }
  return "";
}
function storyTimeError(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "";
  }
  if (parseClockTime(String(value)) === undefined) {
    return `time must be HH:MM or a named part of day (dawn, morning, midday, afternoon, evening, night), got ${value}`;
  }
  return "";
}
function parseClockDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year, month - 1, day);
  const days = date.getTime() / 86400000;
  const roundtrip = new Date(days * 86400000);
  if (roundtrip.getUTCFullYear() !== year || roundtrip.getUTCMonth() !== month - 1 || roundtrip.getUTCDate() !== day) {
    return;
  }
  return { text: value.trim(), days };
}
function parseClockTime(value) {
  const text = value.trim().toLowerCase();
  if (text === "") {
    return;
  }
  const named = TIME_RANKS.get(text);
  if (named !== undefined) {
    return named;
  }
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) {
    return;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return;
  }
  return hours * 60 + minutes;
}
function checkChapterDates(project, warnings) {
  let latestDate = "";
  let latestNumber = 0;
  for (const chapter of project.chapters) {
    if (chapter.date === "") {
      continue;
    }
    const parsed = parseClockDate(chapter.date);
    if (!parsed) {
      warnings.push(`Chapter ${chapter.number} has malformed date "${chapter.date}"`);
      continue;
    }
    if (chapter.time !== "") {
      if (parseClockTime(chapter.time) === undefined) {
        warnings.push(`Chapter ${chapter.number} has malformed time "${chapter.time}"`);
      }
    }
    if (latestDate !== "" && parsed.text < latestDate) {
      warnings.push(`Chapter ${chapter.number} date ${parsed.text} is earlier than Chapter ${latestNumber} date ${latestDate}`);
    }
    if (parsed.text > latestDate) {
      latestDate = parsed.text;
      latestNumber = chapter.number;
    }
  }
}

// src/timeline.js
import path2 from "node:path";
function buildTimeline(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const entries = [];
  for (const chapter of chapters) {
    const scenes = project.scenes.filter((scene) => scene.chapter === chapter.id).sort((left, right) => left.scene - right.scene || left.id.localeCompare(right.id, "en"));
    const units = scenes.length === 0 ? [{ ...chapter, isChapter: true }] : scenes;
    for (const unit of units) {
      entries.push(timelineEntry(project, unit, chapter, entries.length));
    }
  }
  const dated = entries.filter((entry) => entry.days !== undefined).sort((left, right) => left.days - right.days || left.minutes - right.minutes || left.reading - right.reading);
  let earliestLaterReading = Infinity;
  for (let index = dated.length - 1;index >= 0; index -= 1) {
    const entry = dated[index];
    entry.toldLate = entry.reading > earliestLaterReading;
    earliestLaterReading = Math.min(earliestLaterReading, entry.reading);
  }
  return {
    chronology: dated,
    undated: entries.filter((entry) => entry.days === undefined),
    pov: povBalance(chapters),
    presence: characterPresence(project, chapters, chapterById)
  };
}
function timelineEntry(project, unit, chapter, reading) {
  const parsedDate = parseClockDate(unit.date || "");
  const time = unit.time;
  const minutes = parseClockTime(time || "");
  return {
    id: unit.id,
    file: path2.relative(project.root, unit.file),
    title: unit.title,
    chapterNumber: chapter.number,
    pov: unit.pov || chapter.pov || "",
    location: unit.isChapter ? chapter.locations[0] ?? "" : unit.location,
    date: parsedDate?.text ?? "",
    time: minutes === undefined ? "" : time.trim(),
    days: parsedDate?.days,
    minutes: minutes ?? 0,
    flashbackTo: unit.isChapter ? "" : unit.flashbackTo,
    reading
  };
}
function povBalance(chapters) {
  const totals = new Map;
  let words = 0;
  for (const chapter of chapters) {
    const key = chapter.pov || "unspecified";
    const entry = totals.get(key) ?? { pov: key, chapters: 0, words: 0 };
    entry.chapters += 1;
    entry.words += chapter.wordCount;
    words += chapter.wordCount;
    totals.set(key, entry);
  }
  return [...totals.values()].map((entry) => ({ ...entry, share: words === 0 ? 0 : entry.words * 100 / words })).sort((left, right) => right.words - left.words || right.chapters - left.chapters || left.pov.localeCompare(right.pov, "en"));
}
function characterPresence(project, chapters, chapterById) {
  const present = new Map(project.characters.map((character) => [character.id, new Set]));
  const mark = (characterId, chapterId) => {
    if (present.has(characterId) && chapterById.has(chapterId)) {
      present.get(characterId).add(chapterId);
    }
  };
  for (const chapter of chapters) {
    chapter.characters.forEach((characterId) => mark(characterId, chapter.id));
  }
  for (const scene of project.scenes) {
    scene.characters.forEach((characterId) => mark(characterId, scene.chapter));
  }
  const positions = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  return project.characters.map((character) => {
    const seen = [...present.get(character.id)].map((id) => positions.get(id)).sort((left, right) => left - right);
    let longestGap = 0;
    let gapAfter = null;
    for (let index = 1;index < seen.length; index += 1) {
      const gap = seen[index] - seen[index - 1] - 1;
      if (gap > longestGap) {
        longestGap = gap;
        gapAfter = chapters[seen[index - 1]].number;
      }
    }
    const trailing = seen.length === 0 ? 0 : chapters.length - 1 - seen[seen.length - 1];
    return {
      id: character.id,
      chapters: seen.length,
      first: seen.length === 0 ? null : chapters[seen[0]].number,
      last: seen.length === 0 ? null : chapters[seen[seen.length - 1]].number,
      longestGap,
      gapAfter,
      trailing
    };
  }).sort((left, right) => right.chapters - left.chapters || left.id.localeCompare(right.id, "en"));
}
function formatTimeline(timeline, totalChapters) {
  const lines = [`Timeline: ${timeline.chronology.length} dated, ${timeline.undated.length} undated`];
  lines.push("", "Chronology (story order):");
  if (timeline.chronology.length === 0) {
    lines.push("- None: add date (YYYY-MM-DD) and time to scenes or chapters to order them");
  }
  for (const entry of timeline.chronology) {
    const when = [entry.date, entry.time].filter(Boolean).join(" ");
    const notes = [];
    if (entry.toldLate) {
      notes.push(`told in chapter ${entry.chapterNumber}, after later events`);
    }
    if (entry.flashbackTo) {
      notes.push(`flashback to ${entry.flashbackTo}`);
    }
    lines.push(`- ${when}  ${entry.id}: ${entry.title}${describe(entry)}${notes.length === 0 ? "" : ` [${notes.join("; ")}]`}`);
  }
  if (timeline.undated.length > 0) {
    lines.push("", "Undated (reading order):");
    for (const entry of timeline.undated) {
      lines.push(`- ${entry.id}: ${entry.title}${describe(entry)}`);
    }
  }
  lines.push("", "POV balance:");
  if (timeline.pov.length === 0) {
    lines.push("- None");
  }
  for (const entry of timeline.pov) {
    lines.push(`- ${entry.pov}: ${plural(entry.chapters, "chapter")}, ${formatNumber2(entry.words)} words (${Math.round(entry.share)}%)`);
  }
  lines.push("", "Character presence:");
  if (timeline.presence.length === 0) {
    lines.push("- None");
  }
  for (const entry of timeline.presence) {
    if (entry.chapters === 0) {
      lines.push(`- ${entry.id}: not present in any chapter`);
      continue;
    }
    const span = entry.first === entry.last ? `chapter ${entry.first}` : `chapters ${entry.first}-${entry.last}`;
    const details = [`${entry.chapters} of ${totalChapters} chapters`, span];
    if (entry.longestGap > 0) {
      details.push(`longest absence ${plural(entry.longestGap, "chapter")} after chapter ${entry.gapAfter}`);
    }
    if (entry.trailing > 0) {
      details.push(`absent from the last ${plural(entry.trailing, "chapter")}`);
    }
    lines.push(`- ${entry.id}: ${details.join(", ")}`);
  }
  return `${lines.join(`
`)}
`;
}
function describe(entry) {
  const parts = [];
  if (entry.pov) {
    parts.push(`POV ${entry.pov}`);
  }
  if (entry.location) {
    parts.push(`at ${entry.location}`);
  }
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}
function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function formatNumber2(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// src/diagram.js
var DIAGRAM_KINDS = ["relationships", "locations", "timeline", "clues", "arcs"];
var FAMILY_TYPES = new Set([
  "parent",
  "child",
  "sibling",
  "spouse",
  "partner",
  "grandparent",
  "grandchild",
  "aunt",
  "uncle",
  "niece",
  "nephew",
  "cousin"
]);
var ELDER_TYPES = new Set(["parent", "grandparent", "aunt", "uncle"]);
var YOUNGER_TYPES = new Set(["child", "grandchild", "niece", "nephew"]);
function buildDiagram(project, kind) {
  switch (kind) {
    case "relationships":
      return relationshipDiagram(project);
    case "locations":
      return locationDiagram(project);
    case "timeline":
      return timelineDiagram(project);
    case "clues":
      return clueDiagram(project);
    case "arcs":
      return arcDiagram(project);
    default:
      throw new Error(`Unknown diagram kind: ${kind ?? "(none)"}. Supported kinds: ${DIAGRAM_KINDS.join(", ")}`);
  }
}
function relationshipDiagram(project) {
  const characters = [...project.characters].sort(byId);
  const known = new Set(characters.map((character) => character.id));
  const lines = ["flowchart LR"];
  for (const character of characters) {
    lines.push(`  ${nodeId(character.id)}["${label(character.name)}"]`);
  }
  const drawn = new Set;
  for (const character of characters) {
    for (const relationship of character.relationships) {
      if (!relationship || typeof relationship !== "object" || typeof relationship.character !== "string") {
        continue;
      }
      const other = relationship.character;
      const type = String(relationship.type ?? "");
      if (!known.has(other) || YOUNGER_TYPES.has(type)) {
        continue;
      }
      const pair = [character.id, other].sort().join(" ");
      if (!ELDER_TYPES.has(type) && drawn.has(pair)) {
        continue;
      }
      drawn.add(pair);
      const from = nodeId(character.id);
      const to = nodeId(other);
      if (ELDER_TYPES.has(type)) {
        lines.push(`  ${from} ==>|${label(type)}| ${to}`);
      } else if (FAMILY_TYPES.has(type)) {
        lines.push(`  ${from} ===|${label(type)}| ${to}`);
      } else {
        lines.push(`  ${from} -.-|${label(type || "related")}| ${to}`);
      }
    }
  }
  const deceased = characters.filter((character) => character.status === "deceased").map((character) => nodeId(character.id));
  if (deceased.length > 0) {
    lines.push("  classDef deceased stroke-dasharray: 4 4,color:#888", `  class ${deceased.join(",")} deceased`);
  }
  return `${lines.join(`
`)}
`;
}
function locationDiagram(project) {
  const locations = [...project.locations].sort(byId);
  const known = new Set(locations.map((location) => location.id));
  const lines = ["flowchart LR"];
  for (const location of locations) {
    const region = location.region ? `<br/>${label(location.region)}` : "";
    lines.push(`  ${nodeId(location.id)}["${label(location.name)}${region}"]`);
  }
  const routes = [];
  for (const location of locations) {
    for (const route of location.routes ?? []) {
      if (route && typeof route === "object" && known.has(route.to) && route.to !== location.id && typeof route.hours === "number") {
        routes.push({ from: location.id, to: route.to, hours: route.hours, mode: typeof route.mode === "string" ? route.mode : "" });
      }
    }
  }
  const declared = new Set(routes.map((route) => `${route.from}>${route.to}`));
  for (const route of routes) {
    const text = label([`${route.hours}h`, route.mode].filter(Boolean).join(" "));
    if (declared.has(`${route.to}>${route.from}`)) {
      lines.push(`  ${nodeId(route.from)} -->|${text}| ${nodeId(route.to)}`);
    } else {
      lines.push(`  ${nodeId(route.from)} ---|${text}| ${nodeId(route.to)}`);
    }
  }
  return `${lines.join(`
`)}
`;
}
function timelineDiagram(project) {
  const { chronology } = buildTimeline(project);
  const lines = ["timeline", `  title ${timelineText(project.story.data.title ?? "Timeline")}`];
  let section = null;
  for (const entry of chronology) {
    if (entry.date !== section) {
      section = entry.date;
      lines.push(`  section ${entry.date}`);
    }
    const when = entry.time || "day";
    const note = entry.toldLate ? ` (told in chapter ${entry.chapterNumber})` : "";
    lines.push(`    ${timelineText(when)} : ${timelineText(`${entry.title}${note}`)}`);
  }
  return `${lines.join(`
`)}
`;
}
function clueDiagram(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || byId(left, right));
  const known = new Set(chapters.map((chapter) => chapter.id));
  const lines = ["flowchart LR"];
  for (const chapter of chapters) {
    lines.push(`  ${nodeId(chapter.id)}["${chapter.number}. ${label(chapter.title)}"]`);
  }
  for (let index = 1;index < chapters.length; index += 1) {
    lines.push(`  ${nodeId(chapters[index - 1].id)} ~~~ ${nodeId(chapters[index].id)}`);
  }
  let unrevealed = false;
  for (const clue of [...project.clues].sort(byId)) {
    if (!known.has(clue.planted) || clue.status === "dropped" || clue.status === "abandoned") {
      continue;
    }
    const arrow = clue.redHerring ? "-.->" : "-->";
    const text = label(clue.redHerring ? `${clue.title} (red herring)` : clue.title);
    if (known.has(clue.payoff)) {
      lines.push(`  ${nodeId(clue.planted)} ${arrow}|${text}| ${nodeId(clue.payoff)}`);
    } else {
      unrevealed = true;
      lines.push(`  ${nodeId(clue.planted)} ${arrow}|${text}| unrevealed(("not yet revealed"))`);
    }
  }
  if (unrevealed) {
    lines.push("  classDef open stroke-dasharray: 4 4", "  class unrevealed open");
  }
  return `${lines.join(`
`)}
`;
}
function arcDiagram(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || byId(left, right));
  const arcs = [...project.arcs].sort(byId);
  const knownArcs = new Set(arcs.map((arc) => arc.id));
  const lines = ["flowchart LR"];
  for (const arc of arcs) {
    lines.push(`  ${arcNodeId(arc.id)}(["${label(arc.name)}"])`);
  }
  for (const chapter of chapters) {
    lines.push(`  ${nodeId(chapter.id)}["${chapter.number}. ${label(chapter.title)}"]`);
  }
  for (const chapter of chapters) {
    const advanced = new Set(chapter.arcsAdvanced);
    for (const scene of project.scenes) {
      if (scene.chapter === chapter.id) {
        scene.arcsAdvanced.forEach((arcId) => advanced.add(arcId));
      }
    }
    for (const arcId of [...advanced].filter((id) => knownArcs.has(id)).sort()) {
      lines.push(`  ${arcNodeId(arcId)} --> ${nodeId(chapter.id)}`);
    }
  }
  return `${lines.join(`
`)}
`;
}
function byId(left, right) {
  return left.id.localeCompare(right.id, "en");
}
function nodeId(id) {
  return String(id).replace(/[^A-Za-z0-9]/g, "_");
}
function arcNodeId(id) {
  return `arc__${nodeId(id)}`;
}
function label(text) {
  return String(text).replace(/&/g, "&amp;").replace(/"/g, "#quot;").replace(/\|/g, "#124;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\s+/g, " ").trim();
}
function timelineText(text) {
  return String(text).replace(/:/g, "∶").replace(/\s+/g, " ").trim();
}

// src/prose.js
var FILTER_WORDS = [
  "felt",
  "saw",
  "heard",
  "noticed",
  "realized",
  "realised",
  "wondered",
  "seemed",
  "watched",
  "knew",
  "decided",
  "thought",
  "sensed"
];
var SAID_BOOKISMS = [
  "barked",
  "bellowed",
  "breathed",
  "chuckled",
  "cooed",
  "declared",
  "exclaimed",
  "gasped",
  "grinned",
  "groaned",
  "growled",
  "grunted",
  "hissed",
  "inquired",
  "interjected",
  "intoned",
  "laughed",
  "opined",
  "purred",
  "queried",
  "quipped",
  "retorted",
  "shrieked",
  "sighed",
  "smiled",
  "smirked",
  "snapped",
  "snarled",
  "sneered",
  "spat",
  "stated"
];
var PLAIN_TAGS = ["said", "asked", "says", "asks"];
var NOT_ADVERBS = new Set([
  "ally",
  "anomaly",
  "apply",
  "assembly",
  "belly",
  "bully",
  "burly",
  "butterfly",
  "chilly",
  "comply",
  "costly",
  "curly",
  "daily",
  "deadly",
  "dolly",
  "dragonfly",
  "early",
  "elderly",
  "family",
  "fly",
  "folly",
  "friendly",
  "ghastly",
  "ghostly",
  "gully",
  "holly",
  "holy",
  "homely",
  "hourly",
  "imply",
  "italy",
  "jelly",
  "jolly",
  "july",
  "lily",
  "likely",
  "lively",
  "lonely",
  "lovely",
  "melancholy",
  "monopoly",
  "monthly",
  "multiply",
  "oily",
  "only",
  "orderly",
  "prickly",
  "rally",
  "rely",
  "reply",
  "sickly",
  "silly",
  "sly",
  "smelly",
  "stately",
  "supply",
  "surly",
  "tally",
  "ugly",
  "unlikely",
  "weekly",
  "wobbly",
  "woolly",
  "yearly"
]);
var ECHO_STOPWORDS = new Set([
  "about",
  "above",
  "after",
  "again",
  "against",
  "along",
  "always",
  "among",
  "another",
  "around",
  "because",
  "before",
  "behind",
  "being",
  "below",
  "between",
  "could",
  "couldn't",
  "didn't",
  "doesn't",
  "don't",
  "every",
  "first",
  "hadn't",
  "haven't",
  "isn't",
  "might",
  "never",
  "other",
  "right",
  "should",
  "since",
  "something",
  "still",
  "their",
  "there",
  "these",
  "thing",
  "things",
  "those",
  "though",
  "three",
  "through",
  "until",
  "wasn't",
  "where",
  "which",
  "while",
  "without",
  "would",
  "wouldn't",
  "you're",
  "they're",
  "we're"
]);
var PHRASE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "not",
  "of",
  "on",
  "or",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "then",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "with",
  "you"
]);
var DIALECT_PAIRS = [
  ["armour", "armor"],
  ["armoured", "armored"],
  ["centre", "center"],
  ["centres", "centers"],
  ["centred", "centered"],
  ["colour", "color"],
  ["colours", "colors"],
  ["coloured", "colored"],
  ["colourful", "colorful"],
  ["defence", "defense"],
  ["defences", "defenses"],
  ["favour", "favor"],
  ["favours", "favors"],
  ["favoured", "favored"],
  ["favourite", "favorite"],
  ["grey", "gray"],
  ["greying", "graying"],
  ["harbour", "harbor"],
  ["harbours", "harbors"],
  ["honour", "honor"],
  ["honours", "honors"],
  ["honoured", "honored"],
  ["honourable", "honorable"],
  ["jewellery", "jewelry"],
  ["labour", "labor"],
  ["mould", "mold"],
  ["mouldy", "moldy"],
  ["neighbour", "neighbor"],
  ["neighbours", "neighbors"],
  ["odour", "odor"],
  ["offence", "offense"],
  ["plough", "plow"],
  ["rumour", "rumor"],
  ["rumours", "rumors"],
  ["sceptic", "skeptic"],
  ["sceptical", "skeptical"],
  ["smoulder", "smolder"],
  ["smouldering", "smoldering"],
  ["theatre", "theater"],
  ["towards", "toward"],
  ["travelled", "traveled"],
  ["travelling", "traveling"],
  ["traveller", "traveler"],
  ["cancelled", "canceled"],
  ["vapour", "vapor"],
  ["whisky", "whiskey"]
];
var PROSE_THRESHOLDS = {
  filterPerThousand: 10,
  adverbsPerThousand: 12,
  minRateWords: 300,
  bookismsPerChapter: 3,
  echoWindow: 30,
  echoMinLength: 5,
  uniformMinSentences: 20,
  uniformSpread: 5,
  phraseLength: 4,
  phraseMinCount: 3,
  phraseLimit: 10
};
function proseRules(styleData, characterNames) {
  const data = styleData ?? {};
  const allow = new Set(stringList(data["allow-words"]).map((word) => word.toLowerCase()));
  const variants = [];
  for (const entry of Array.isArray(data.preferred) ? data.preferred : []) {
    if (entry && typeof entry.use === "string" && typeof entry.avoid === "string" && entry.use.trim() !== "" && entry.avoid.trim() !== "") {
      variants.push({ use: entry.use.trim(), avoid: entry.avoid.trim(), source: "style sheet" });
    }
  }
  const dialect = typeof data.dialect === "string" ? data.dialect : "unspecified";
  if (dialect === "british" || dialect === "american") {
    const claimed = new Set(variants.flatMap((variant) => [variant.use.toLowerCase(), variant.avoid.toLowerCase()]).concat([...allow]));
    for (const [british, american] of DIALECT_PAIRS) {
      const [use, avoid] = dialect === "british" ? [british, american] : [american, british];
      if (!claimed.has(use) && !claimed.has(avoid)) {
        variants.push({ use, avoid, source: `${dialect} dialect` });
      }
    }
  }
  const nameTokens = new Set;
  for (const name of characterNames) {
    for (const token of splitWords(name)) {
      nameTokens.add(token.toLowerCase());
    }
  }
  return {
    allow,
    variants: variants.map((variant) => ({ ...variant, pattern: phrasePattern(variant.avoid) })),
    watch: stringList(data["watch-words"]).map((word) => ({ word, pattern: phrasePattern(word) })),
    filterWords: new Set(FILTER_WORDS.filter((word) => !allow.has(word))),
    bookisms: new Set(SAID_BOOKISMS.filter((word) => !allow.has(word))),
    nameTokens
  };
}
function analyzeChapter(prose, rules) {
  const paragraphs = proseParagraphs2(prose);
  const text = paragraphs.join(`

`);
  const words = splitWords(text);
  const narration = splitWords(paragraphs.map(stripDialogue).join(`

`));
  const sentences = paragraphs.flatMap(splitSentences).map((sentence) => splitWords(sentence).length).filter((count) => count > 0);
  const filterWords = countMatching(narration, (word) => rules.filterWords.has(word));
  const adverbs = countMatching(narration, (word) => isAdverb(word, rules));
  const tags = dialogueTags(paragraphs, rules);
  return {
    words: words.length,
    narrationWords: narration.length,
    sentences: sentenceStats(sentences),
    filterWords,
    adverbs,
    plainTags: tags.plain,
    bookisms: tags.bookisms,
    echoes: echoes(words, rules),
    watch: rules.watch.map(({ word, pattern }) => ({ word, count: countPattern(text, pattern) })).filter((entry) => entry.count > 0),
    variants: rules.variants.map(({ use, avoid, source, pattern }) => ({ use, avoid, source, count: countPattern(text, pattern) })).filter((entry) => entry.count > 0),
    phraseSentences: paragraphs.flatMap(splitSentences).map((sentence) => splitWords(sentence).map((word) => word.toLowerCase()))
  };
}
function chapterFindings(label2, analysis, thresholds = PROSE_THRESHOLDS) {
  const findings = [];
  for (const variant of analysis.variants) {
    findings.push(`${label2} uses "${variant.avoid}" ${times(variant.count)}; ${variant.source} prefers "${variant.use}"`);
  }
  const rated = analysis.narrationWords >= thresholds.minRateWords;
  const filterRate = perThousand(total(analysis.filterWords), analysis.narrationWords);
  if (rated && filterRate > thresholds.filterPerThousand) {
    findings.push(`${label2} has ${formatRate(filterRate)} filter words per 1,000 narration words (over ${thresholds.filterPerThousand}): ${formatCounts(analysis.filterWords, 5)}`);
  }
  const adverbRate = perThousand(total(analysis.adverbs), analysis.narrationWords);
  if (rated && adverbRate > thresholds.adverbsPerThousand) {
    findings.push(`${label2} has ${formatRate(adverbRate)} -ly adverbs per 1,000 narration words (over ${thresholds.adverbsPerThousand}): ${formatCounts(analysis.adverbs, 5)}`);
  }
  const bookisms = total(analysis.bookisms);
  if (bookisms >= thresholds.bookismsPerChapter) {
    findings.push(`${label2} has ${bookisms} said-bookism dialogue tags: ${formatCounts(analysis.bookisms, 5)}`);
  }
  const stats = analysis.sentences;
  if (stats.count >= thresholds.uniformMinSentences && stats.spread < thresholds.uniformSpread) {
    findings.push(`${label2} sentence lengths are uniform (spread ${formatRate(stats.spread)} words over ${stats.count} sentences); vary the rhythm`);
  }
  return findings;
}
function repeatedPhrases(analyses, thresholds = PROSE_THRESHOLDS) {
  const counts = new Map;
  const size = thresholds.phraseLength;
  for (const analysis of analyses) {
    for (const sentence of analysis.phraseSentences) {
      for (let index = 0;index + size <= sentence.length; index += 1) {
        const gram = sentence.slice(index, index + size);
        if (gram.every((word) => PHRASE_STOPWORDS.has(word))) {
          continue;
        }
        const key = gram.join(" ");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return sortCounts(counts).filter((entry) => entry.count >= thresholds.phraseMinCount).slice(0, thresholds.phraseLimit).map((entry) => ({ phrase: entry.word, count: entry.count }));
}
function similarNames(characters) {
  const firsts = characters.map((character) => ({ id: character.id, name: String(character.name), first: (splitWords(character.name)[0] ?? "").toLowerCase() })).filter((entry) => entry.first.length >= 3).sort((left, right) => left.id.localeCompare(right.id, "en"));
  const pairs = [];
  for (let left = 0;left < firsts.length; left += 1) {
    for (let right = left + 1;right < firsts.length; right += 1) {
      const a = firsts[left].first;
      const b = firsts[right].first;
      const limit = Math.min(a.length, b.length) >= 5 ? 2 : 1;
      if (a === b || a.slice(0, 3) === b.slice(0, 3) || editDistance(a, b) <= limit) {
        pairs.push([firsts[left], firsts[right]]);
      }
    }
  }
  return pairs;
}
function formatProseReport(report) {
  const chapterCount = `${report.chapters.length} ${report.chapters.length === 1 ? "chapter" : "chapters"}`;
  const lines = [`Prose report: ${chapterCount}, ${report.words} words`];
  if (!report.styleSheet) {
    lines.push("No style-sheet.md: spelling and watch-word checks are off");
  }
  for (const chapter of report.chapters) {
    const analysis = chapter.analysis;
    const stats = analysis.sentences;
    lines.push("", `${chapter.file}: ${chapter.title} (${analysis.words} words)`);
    lines.push(`  Sentences: ${stats.count}, average ${formatRate(stats.mean)} words, longest ${stats.longest}, spread ${formatRate(stats.spread)}`);
    lines.push(`  Filter words: ${formatRate(perThousand(total(analysis.filterWords), analysis.narrationWords))} per 1k narration words${countSuffix(analysis.filterWords)}`);
    lines.push(`  -ly adverbs: ${formatRate(perThousand(total(analysis.adverbs), analysis.narrationWords))} per 1k narration words${countSuffix(analysis.adverbs)}`);
    lines.push(`  Dialogue tags: ${formatCounts(analysis.plainTags, 4) || "none plain"}; said-bookisms: ${formatCounts(analysis.bookisms, 5) || "none"}`);
    lines.push(`  Echoes within ${PROSE_THRESHOLDS.echoWindow} words: ${formatCounts(analysis.echoes, 5) || "none"}`);
    if (analysis.watch.length > 0) {
      lines.push(`  Watch words: ${analysis.watch.map((entry) => `${entry.word} ${entry.count}`).join(", ")}`);
    }
    if (analysis.variants.length > 0) {
      lines.push(`  Spelling: ${analysis.variants.map((entry) => `${entry.avoid} ${entry.count} (use ${entry.use})`).join(", ")}`);
    }
  }
  lines.push("", "Manuscript:");
  lines.push(`  Repeated ${PROSE_THRESHOLDS.phraseLength}-word phrases: ${report.phrases.map((entry) => `"${entry.phrase}" ${entry.count}`).join(", ") || "none"}`);
  lines.push(`  Similar character names: ${report.similarNames.map(([a, b]) => `${a.name} / ${b.name}`).join(", ") || "none"}`);
  return `${lines.join(`
`)}
`;
}
function proseParagraphs2(prose) {
  return String(prose).replace(/<!--[\s\S]*?-->/g, " ").split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter((paragraph) => paragraph !== "" && !paragraph.startsWith("#") && !/^([*_-])( ?\1){2,}$/.test(paragraph));
}
function splitSentences(paragraph) {
  return paragraph.split(/(?<=[.!?…]["'”’)\]*_]*)\s+(?=["'“‘(*_]*[\p{Lu}\p{N}])/u);
}
function stripDialogue(paragraph) {
  return paragraph.replace(/“[^”]*(”|$)/g, " ").replace(/"[^"]*("|$)/g, " ");
}
function dialogueTags(paragraphs, rules) {
  const plain = new Map;
  const bookisms = new Map;
  for (const paragraph of paragraphs) {
    for (const closing of closingQuoteIndexes(paragraph)) {
      const after = splitWords(paragraph.slice(closing + 1).split(/[.!?;:“"]/)[0]).slice(0, 3);
      for (const raw of after) {
        const word = raw.toLowerCase();
        if (PLAIN_TAGS.includes(word)) {
          increment(plain, word);
          break;
        }
        if (rules.bookisms.has(word)) {
          increment(bookisms, word);
          break;
        }
      }
    }
  }
  return { plain: sortCounts(plain), bookisms: sortCounts(bookisms) };
}
function closingQuoteIndexes(paragraph) {
  const indexes = [];
  let straight = 0;
  for (let index = 0;index < paragraph.length; index += 1) {
    const char = paragraph[index];
    if (char === "”") {
      indexes.push(index);
    } else if (char === '"') {
      straight += 1;
      if (straight % 2 === 0) {
        indexes.push(index);
      }
    }
  }
  return indexes;
}
function isAdverb(word, rules) {
  return word.length > 4 && word.endsWith("ly") && !NOT_ADVERBS.has(word) && !rules.allow.has(word) && !rules.nameTokens.has(word);
}
function echoes(words, rules) {
  const lastSeen = new Map;
  const counts = new Map;
  words.forEach((raw, index) => {
    const word = raw.toLowerCase();
    if (word.length < PROSE_THRESHOLDS.echoMinLength || ECHO_STOPWORDS.has(word) || rules.nameTokens.has(word) || rules.allow.has(word) || /^\p{N}+$/u.test(word)) {
      return;
    }
    if (lastSeen.has(word) && index - lastSeen.get(word) <= PROSE_THRESHOLDS.echoWindow) {
      increment(counts, word);
    }
    lastSeen.set(word, index);
  });
  return sortCounts(counts);
}
function sentenceStats(lengths) {
  if (lengths.length === 0) {
    return { count: 0, mean: 0, longest: 0, spread: 0 };
  }
  const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
  return { count: lengths.length, mean, longest: Math.max(...lengths), spread: Math.sqrt(variance) };
}
function countMatching(words, predicate) {
  const counts = new Map;
  for (const raw of words) {
    const word = raw.toLowerCase();
    if (predicate(word)) {
      increment(counts, word);
    }
  }
  return sortCounts(counts);
}
function phrasePattern(phrase) {
  const body = phrase.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}
function countPattern(text, pattern) {
  return (text.match(pattern) ?? []).length;
}
function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1;i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1;j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}
function increment(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
function sortCounts(counts) {
  return [...counts.entries()].map(([word, count]) => ({ word, count })).sort((left, right) => right.count - left.count || left.word.localeCompare(right.word, "en"));
}
function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
}
function total(counts) {
  return counts.reduce((sum, entry) => sum + entry.count, 0);
}
function perThousand(count, words) {
  return words === 0 ? 0 : count * 1000 / words;
}
function formatRate(value) {
  return value.toFixed(1);
}
function formatCounts(counts, limit) {
  return counts.slice(0, limit).map((entry) => `${entry.word} ${entry.count}`).join(", ");
}
function countSuffix(counts) {
  return counts.length === 0 ? "" : ` (${formatCounts(counts, 5)})`;
}
function times(count) {
  return count === 1 ? "once" : `${count} times`;
}

// src/names.js
var MAJOR_ROLES = new Set(["protagonist", "antagonist", "deuteragonist", "narrator"]);
var TITLE_WORDS = new Set([
  "the",
  "a",
  "an",
  "lord",
  "lady",
  "sir",
  "dame",
  "dr",
  "doctor",
  "mr",
  "mrs",
  "ms",
  "miss",
  "master",
  "mistress",
  "captain",
  "capt",
  "king",
  "queen",
  "prince",
  "princess",
  "duke",
  "duchess",
  "count",
  "countess",
  "baron",
  "baroness",
  "father",
  "mother",
  "sister",
  "brother",
  "uncle",
  "aunt",
  "councillor",
  "councilor",
  "general",
  "colonel",
  "major",
  "sergeant",
  "lieutenant",
  "commander",
  "professor",
  "prof",
  "saint",
  "st",
  "old",
  "young",
  "little"
]);
function givenName(name) {
  const words = splitWords(String(name));
  const index = words.findIndex((word) => !TITLE_WORDS.has(word.toLowerCase().replace(/[.’']/g, "")));
  return index === -1 ? "" : words[index];
}
function existingNames(project) {
  const names = [];
  const add = (kind, id, name, role = "", given = false, full = name) => {
    if (typeof name === "string" && name.trim() !== "") {
      names.push({ kind, id, name: name.trim(), full: String(full).trim(), role, given });
    }
  };
  for (const character of project.characters) {
    if (character.status === "cut") {
      continue;
    }
    const first = givenName(character.name);
    const single = first !== "" && first === String(character.name).trim();
    add("character", character.id, String(character.name), character.role, single);
    if (first !== "" && !single) {
      add("character", character.id, first, character.role, true, character.name);
    }
    for (const alias of character.aliases ?? []) {
      add("character", character.id, alias, character.role);
    }
  }
  for (const [kind, list] of [["location", project.locations], ["faction", project.factions], ["artifact", project.artifacts], ["system", project.systems]]) {
    for (const entity of list) {
      add(kind, entity.id, String(entity.name));
    }
  }
  for (const term of project.glossaryTerms) {
    add("term", term.id, String(term.term));
    for (const alias of term.aliases ?? []) {
      add("term", term.id, alias);
    }
  }
  return names;
}
function checkNames(candidates, names) {
  const errors = [];
  const warnings = [];
  const results = [];
  for (const raw of candidates) {
    const candidate = String(raw).trim();
    if (candidate === "") {
      continue;
    }
    const key = normalize(candidate);
    const first = normalize(givenName(candidate));
    const clashes = [];
    const lookalikes = [];
    const initials = [];
    const seen = new Set;
    for (const entry of names) {
      const tag = `${entry.kind} ${entry.id}`;
      const existing = normalize(entry.name);
      if (existing === key || entry.given && existing === first) {
        if (!seen.has(`clash ${tag}`)) {
          clashes.push(entry);
          seen.add(`clash ${tag}`);
        }
        continue;
      }
      const alike = entry.given ? looksAlike(first, existing) : !existing.includes(" ") && !key.includes(" ") && looksAlike(key, existing);
      if (alike && !seen.has(`like ${tag}`)) {
        lookalikes.push(entry);
        seen.add(`like ${tag}`);
      } else if (entry.given && MAJOR_ROLES.has(entry.role) && first !== "" && first[0] === existing[0] && !seen.has(`initial ${entry.id}`)) {
        initials.push(entry);
        seen.add(`initial ${entry.id}`);
      }
    }
    for (const entry of clashes) {
      errors.push(`"${candidate}" clashes with ${entry.kind} ${entry.id} (${entry.name})`);
    }
    for (const entry of lookalikes) {
      if (!clashes.some((clash) => clash.kind === entry.kind && clash.id === entry.id)) {
        warnings.push(`"${candidate}" looks like ${entry.kind} ${entry.id} (${entry.full})`);
      }
    }
    for (const entry of initials) {
      if (!clashes.concat(lookalikes).some((other) => other.kind === "character" && other.id === entry.id)) {
        warnings.push(`"${candidate}" shares an initial with ${entry.role} ${entry.id} (${entry.full})`);
      }
    }
    results.push({ name: candidate, clashes: clashes.length, lookalikes: lookalikes.length, initials: initials.length });
  }
  return { results, errors, warnings };
}
function looksAlike(left, right) {
  if (left.length < 3 || right.length < 3) {
    return false;
  }
  if (left.slice(0, 4) === right.slice(0, 4) && Math.min(left.length, right.length) >= 4) {
    return true;
  }
  const limit = Math.min(left.length, right.length) >= 5 ? 2 : 1;
  return left[0] === right[0] && editDistance(left, right) <= limit;
}
function normalize(value) {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function formatNames(report) {
  const lines = [];
  for (const result of report.results) {
    const status = result.clashes > 0 ? "taken" : result.lookalikes + result.initials > 0 ? "check" : "clear";
    lines.push(`${result.name}: ${status}`);
  }
  return `${lines.join(`
`)}
`;
}

// src/voices.js
var SPEECH_VERBS = [
  "said",
  "says",
  "asked",
  "asks",
  "replied",
  "replies",
  "answered",
  "answers",
  "whispered",
  "whispers",
  "shouted",
  "shouts",
  "called",
  "calls",
  "muttered",
  "mutters",
  "murmured",
  "murmurs",
  "cried",
  "cries",
  "yelled",
  "yells",
  "added",
  "adds",
  "told",
  "tells",
  "snapped",
  "snaps",
  "admitted",
  "admits",
  "insisted",
  "insists",
  "demanded",
  "demands",
  "continued",
  "continues",
  "began",
  "begins",
  "went on",
  "goes on"
];
var CONTRACTION_PATTERN = /[\p{L}](?:n['’]t|['’](?:re|ll|ve|m|d))\b/giu;
var STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "have",
  "what",
  "from",
  "they",
  "there",
  "their",
  "them",
  "then",
  "than",
  "were",
  "would",
  "could",
  "should",
  "your",
  "yours",
  "just",
  "know",
  "been",
  "will",
  "when",
  "where",
  "which",
  "about",
  "into",
  "some",
  "because",
  "want",
  "like",
  "only",
  "here",
  "does",
  "didn't",
  "don't",
  "it's",
  "can't",
  "won't",
  "i'm",
  "you're",
  "we're",
  "that's",
  "there's",
  "what's",
  "going",
  "come",
  "back",
  "over",
  "tell",
  "said",
  "more",
  "very",
  "also"
]);
var VOICE_THRESHOLDS = {
  minLines: 5,
  sentenceLength: 1.5,
  contractions: 1.5,
  questions: 0.1,
  exclamations: 0.1
};
function buildVoices(project, chapters) {
  const speakers = speakerPatterns(project.characters);
  const lines = new Map(project.characters.map((character) => [character.id, []]));
  let unattributed = 0;
  for (const chapter of chapters) {
    for (const paragraph of chapter.paragraphs) {
      const quotes = quotedSpans(paragraph);
      if (quotes.length === 0) {
        continue;
      }
      const speaker = attribute(paragraph, speakers);
      if (speaker === null) {
        unattributed += quotes.length;
        continue;
      }
      for (const text of quotes) {
        lines.get(speaker).push({ chapter: chapter.id, text });
      }
    }
  }
  const profiles = project.characters.map((character) => profile(character, lines.get(character.id))).filter((entry) => entry.lines > 0);
  signatureWords(profiles);
  const warnings = [];
  for (const character of project.characters) {
    const said = lines.get(character.id);
    for (const phrase of stringList2(character.voiceAvoid)) {
      const pattern = phrasePattern2(phrase);
      const chaptersUsing = [...new Set(said.filter((line) => pattern.test(line.text)).map((line) => line.chapter))];
      if (chaptersUsing.length > 0) {
        warnings.push(`${character.id} says "${phrase}", which is in their voice-avoid list (${chaptersUsing.join(", ")})`);
      }
    }
    if (said.length >= VOICE_THRESHOLDS.minLines) {
      for (const phrase of stringList2(character.voiceWords)) {
        const pattern = phrasePattern2(phrase);
        if (!said.some((line) => pattern.test(line.text))) {
          warnings.push(`${character.id} never says "${phrase}" from their voice-words list in ${said.length} lines of dialogue`);
        }
      }
    }
  }
  const eligible = profiles.filter((entry) => entry.lines >= VOICE_THRESHOLDS.minLines);
  for (let left = 0;left < eligible.length; left += 1) {
    for (let right = left + 1;right < eligible.length; right += 1) {
      if (similarVoices(eligible[left], eligible[right])) {
        warnings.push(`${eligible[left].id} and ${eligible[right].id} may sound alike: similar sentence length, contractions, questions, and exclamations`);
      }
    }
  }
  return {
    profiles: profiles.sort((left, right) => right.words - left.words || left.id.localeCompare(right.id, "en")),
    unattributed,
    warnings
  };
}
function speakerPatterns(characters) {
  const verbs = SPEECH_VERBS.flatMap((verb) => [verb, `${verb[0].toUpperCase()}${verb.slice(1)}`]).map((verb) => verb.replace(/ /g, "\\s+")).join("|");
  return characters.filter((character) => character.status !== "cut").map((character) => {
    const names = new Set;
    const full = String(character.name ?? "").trim();
    if (full !== "") {
      names.add(full);
      const first = givenName(full);
      if (first.length >= 2) {
        names.add(first);
      }
    }
    for (const alias of stringList2(character.aliases)) {
      names.add(alias);
    }
    const alternatives = [...names].sort((left, right) => right.length - left.length).map(escape).join("|");
    if (alternatives === "") {
      return null;
    }
    return {
      id: character.id,
      name: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "u"),
      subject: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})\\s+(?:${verbs})(?![\\p{L}\\p{N}])`, "u"),
      inverted: new RegExp(`(?<![\\p{L}\\p{N}])(?:${verbs})\\s+(?:${alternatives})(?![\\p{L}\\p{N}])`, "u")
    };
  }).filter(Boolean);
}
function attribute(paragraph, speakers) {
  const narration = stripQuotes(paragraph);
  for (const form of ["subject", "inverted"]) {
    const tagged = speakers.filter((speaker) => speaker[form].test(narration));
    if (tagged.length === 1) {
      return tagged[0].id;
    }
    if (tagged.length > 1) {
      return null;
    }
  }
  const named = speakers.filter((speaker) => speaker.name.test(narration));
  return named.length === 1 ? named[0].id : null;
}
var SINGLE_QUOTE = "(?<![\\p{L}\\p{N}])‘((?:[^‘’]|’(?=[\\p{L}\\p{N}]))*)’(?![\\p{L}\\p{N}])";
var QUOTE_PATTERN = new RegExp(`“([^”]*)”|"([^"]*)"|${SINGLE_QUOTE}`, "gu");
function quotedSpans(paragraph) {
  const spans = [];
  for (const match of paragraph.matchAll(QUOTE_PATTERN)) {
    const text = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (text !== "") {
      spans.push(text);
    }
  }
  return spans;
}
function stripQuotes(paragraph) {
  return paragraph.replace(QUOTE_PATTERN, " ").replace(/“[^”]*$/g, " ").replace(/"[^"]*$/g, " ");
}
function profile(character, said) {
  const text = said.map((line) => line.text).join(" ");
  const words = splitWords(text);
  const sentences = said.flatMap((line) => line.text.split(/(?<=[.!?…])\s+/).filter((sentence) => splitWords(sentence).length > 0));
  const questions = sentences.filter((sentence) => /\?["'”’)]*$/.test(sentence.trim())).length;
  const exclamations = sentences.filter((sentence) => /!["'”’)]*$/.test(sentence.trim())).length;
  return {
    id: character.id,
    lines: said.length,
    words: words.length,
    sentenceLength: sentences.length === 0 ? 0 : words.length / sentences.length,
    contractions: words.length === 0 ? 0 : (text.match(CONTRACTION_PATTERN) ?? []).length * 100 / words.length,
    questions: sentences.length === 0 ? 0 : questions / sentences.length,
    exclamations: sentences.length === 0 ? 0 : exclamations / sentences.length,
    counts: wordCounts(words),
    signature: []
  };
}
function wordCounts(words) {
  const counts = new Map;
  for (const raw of words) {
    const word = raw.toLowerCase().replace(/’/g, "'");
    if (word.length >= 4 && !STOPWORDS.has(word) && !/^\d+$/.test(word)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return counts;
}
function signatureWords(profiles) {
  const totals = new Map;
  let allWords = 0;
  for (const entry of profiles) {
    allWords += entry.words;
    for (const [word, count] of entry.counts) {
      totals.set(word, (totals.get(word) ?? 0) + count);
    }
  }
  for (const entry of profiles) {
    const otherWords = allWords - entry.words;
    const scored = [];
    for (const [word, count] of entry.counts) {
      if (count < 2) {
        continue;
      }
      const own = count / entry.words;
      const others = otherWords === 0 ? 0 : (totals.get(word) - count) / otherWords;
      if (own > others * 2) {
        scored.push({ word, count, score: own - others });
      }
    }
    entry.signature = scored.sort((left, right) => right.score - left.score || right.count - left.count || left.word.localeCompare(right.word, "en")).slice(0, 5).map((item) => item.word);
    delete entry.counts;
  }
}
function similarVoices(left, right) {
  const limits = VOICE_THRESHOLDS;
  return Math.abs(left.sentenceLength - right.sentenceLength) < limits.sentenceLength && Math.abs(left.contractions - right.contractions) < limits.contractions && Math.abs(left.questions - right.questions) < limits.questions && Math.abs(left.exclamations - right.exclamations) < limits.exclamations;
}
function phrasePattern2(phrase) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(String(phrase).trim()).replace(/['’]/g, "['’]")}(?![\\p{L}\\p{N}])`, "iu");
}
function escape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function stringList2(value) {
  return (Array.isArray(value) ? value : []).filter((item) => typeof item === "string" && item.trim() !== "");
}
function formatVoices(report) {
  const lines = [`Voices: ${report.profiles.length} speaking characters, ${report.unattributed} unattributed lines`];
  if (report.profiles.length === 0) {
    lines.push("", `- None: tag dialogue with a character's name and a speech verb ("...," Mara said)`);
    return `${lines.join(`
`)}
`;
  }
  for (const entry of report.profiles) {
    lines.push("", `${entry.id}: ${entry.lines} lines, ${entry.words} words`, `  Sentence length ${entry.sentenceLength.toFixed(1)}, contractions ${entry.contractions.toFixed(1)} per 100 words, questions ${Math.round(entry.questions * 100)}%, exclamations ${Math.round(entry.exclamations * 100)}%`, `  Signature words: ${entry.signature.join(", ") || "none yet"}`);
  }
  return `${lines.join(`
`)}
`;
}

// src/forms.js
var STORY_FORMS = new Map([
  ["flash", { min: 1, max: 1500, target: 1000 }],
  ["short-story", { min: 1000, max: 7500, target: 5000 }],
  ["novelette", { min: 7500, max: 17500, target: 12000 }],
  ["novella", { min: 17500, max: 40000, target: 30000 }],
  ["novel", { min: 40000, max: 200000, target: 80000 }],
  ["serial", { min: null, max: null, target: null }],
  ["picture-book", { min: 1, max: 1000, target: 500 }],
  ["chapter-book", { min: 4000, max: 15000, target: 1e4 }]
]);
function formRangeWarning(form, words, label2) {
  const range = STORY_FORMS.get(form);
  if (!range || range.min === null || !Number.isInteger(words) || words <= 0) {
    return "";
  }
  if (words < range.min || words > range.max) {
    return `${label2} ${words} is outside the usual ${form} range of ${range.min}-${range.max} words`;
  }
  return "";
}

// src/publishing.js
var MAX_KEYWORDS = 7;
var BISAC_PATTERN = /^[A-Z]{3}\d{6}$/;
var LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
var SCALAR_FIELDS = ["author", "language", "isbn", "publisher", "publication-date", "description", "copyright", "cover-alt", "ai-disclosure"];
function publishingMeta(data) {
  const text = (field) => typeof data[field] === "string" ? data[field].trim() : "";
  const list = (field) => Array.isArray(data[field]) ? data[field].filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
  const authors = list("authors");
  const author = text("author");
  return {
    authors: authors.length > 0 ? authors : author === "" ? [] : [author],
    language: text("language") || "en",
    isbn: normalizeIsbn(typeof data.isbn === "number" ? String(data.isbn) : text("isbn")),
    publisher: text("publisher"),
    publicationDate: text("publication-date"),
    description: text("description"),
    keywords: list("keywords"),
    subjects: list("subjects"),
    copyright: text("copyright"),
    coverAlt: text("cover-alt"),
    aiDisclosure: text("ai-disclosure")
  };
}
function validatePublishing(data, errors, warnings) {
  for (const field of SCALAR_FIELDS) {
    if (data[field] !== undefined && typeof data[field] !== "string" && !(field === "isbn" && typeof data[field] === "number")) {
      errors.push(`story.md frontmatter field ${field} must be text`);
    }
  }
  for (const field of ["keywords", "subjects", "authors"]) {
    if (data[field] !== undefined && (!Array.isArray(data[field]) || data[field].some((item) => typeof item !== "string"))) {
      errors.push(`story.md frontmatter field ${field} must be a list of text`);
    }
  }
  if (typeof data.language === "string" && !LANGUAGE_PATTERN.test(data.language.trim())) {
    errors.push(`story.md language ${data.language} must be a BCP 47 tag such as en, en-GB, or fr`);
  }
  const isbn = typeof data.isbn === "number" ? String(data.isbn) : data.isbn;
  if (typeof isbn === "string" && isbn.trim() !== "" && normalizeIsbn(isbn) === "") {
    const hint = typeof data.isbn === "number" ? "; quote it so leading zeros survive" : "";
    errors.push(`story.md isbn ${isbn} is not a valid ISBN-13 or ISBN-10 (check the digits and checksum${hint})`);
  }
  if (typeof data["publication-date"] === "string") {
    const dateError = storyDateError(data["publication-date"]);
    if (dateError !== "") {
      errors.push(`story.md publication-date ${dateError}`);
    }
  }
  if (Array.isArray(data.subjects)) {
    for (const subject of data.subjects) {
      if (typeof subject === "string" && !BISAC_PATTERN.test(subject.trim())) {
        errors.push(`story.md subject ${subject} must be a BISAC code such as FIC022000`);
      }
    }
  }
  if (Array.isArray(data.keywords) && data.keywords.length > MAX_KEYWORDS) {
    warnings.push(`story.md lists ${data.keywords.length} keywords; most retailers accept ${MAX_KEYWORDS}`);
  }
  if (data.author !== undefined && data.authors !== undefined) {
    warnings.push("story.md sets both author and authors; builds use authors");
  }
}
function normalizeIsbn(value) {
  const compact = String(value ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (/^97[89]\d{10}$/.test(compact)) {
    const sum = [...compact.slice(0, 12)].reduce((total2, digit, index) => total2 + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
    return (10 - sum % 10) % 10 === Number(compact[12]) ? compact : "";
  }
  if (/^\d{9}[\dX]$/.test(compact)) {
    const sum = [...compact].reduce((total2, char, index) => total2 + (char === "X" ? 10 : Number(char)) * (10 - index), 0);
    return sum % 11 === 0 ? compact : "";
  }
  return "";
}
function copyrightPage(meta) {
  const lines = [meta.copyright, "", "All rights reserved."];
  if (meta.publisher !== "") {
    lines.push("", `Published by ${meta.publisher}`);
  }
  if (meta.isbn !== "") {
    lines.push("", `ISBN ${meta.isbn}`);
  }
  if (meta.aiDisclosure !== "") {
    lines.push("", meta.aiDisclosure);
  }
  return lines.join(`
`);
}
var DESCRIPTION_LIMIT = 4000;
function metadataSheet(input) {
  const { title, data, meta, words, pages } = input;
  const series = typeof data.series === "string" ? `${data.series}${Number.isInteger(data["book-number"]) ? `, book ${data["book-number"]}` : ""}` : "";
  const rows = [
    ["Title", title],
    ["Series", series],
    ["Author(s)", meta.authors.join("; ")],
    ["ISBN", meta.isbn],
    ["Publisher", meta.publisher],
    ["Publication date", meta.publicationDate],
    ["Language", meta.language],
    ["Genre", [data.genre, data["sub-genre"]].filter((value) => typeof value === "string" && value !== "").join(" / ")],
    ["Form", typeof data.form === "string" ? data.form : ""],
    ["Word count", String(words)],
    ["Estimated print pages", Object.entries(pages).map(([trim, count]) => `${count} at ${trim}`).join(", ")],
    ["Description", meta.description === "" ? "" : `${meta.description.length} characters (limit ${DESCRIPTION_LIMIT})`],
    ["Keywords", meta.keywords.length === 0 ? "" : `${meta.keywords.length} of ${MAX_KEYWORDS}: ${meta.keywords.join("; ")}`],
    ["BISAC subjects", meta.subjects.join("; ")],
    ["Copyright", meta.copyright],
    ["Cover", typeof data.cover === "string" ? data.cover : ""],
    ["Cover alt text", meta.coverAlt],
    ["AI disclosure", meta.aiDisclosure]
  ];
  const checks = [
    ["Author named (`author` or `authors`)", meta.authors.length > 0],
    ["ISBN for this edition (`isbn`), or a retailer-assigned identifier", meta.isbn !== ""],
    ["Publisher or imprint (`publisher`)", meta.publisher !== ""],
    ["Publication date (`publication-date`)", meta.publicationDate !== ""],
    [`Description under ${DESCRIPTION_LIMIT} characters (\`description\`)`, meta.description !== "" && meta.description.length <= DESCRIPTION_LIMIT],
    [`Keywords, up to ${MAX_KEYWORDS} (\`keywords\`)`, meta.keywords.length > 0 && meta.keywords.length <= MAX_KEYWORDS],
    ["BISAC subjects (`subjects`)", meta.subjects.length > 0],
    ["Copyright line (`copyright`) or copyright matter page", meta.copyright !== "" || input.hasCopyrightPage],
    ["Cover image (`cover`)", typeof data.cover === "string" && data.cover !== ""],
    ["Cover alt text (`cover-alt`)", meta.coverAlt !== ""],
    ["AI-use statement decided (`ai-disclosure`)", meta.aiDisclosure !== ""],
    ["Story status is complete", data.status === "complete"]
  ];
  return [
    `# ${title}: Retailer Metadata`,
    "",
    "Generated from story.md. Retailer limits change; check each retailer's current requirements before upload.",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...rows.map(([field, value]) => `| ${field} | ${value === "" ? "(missing)" : tableCell(value)} |`),
    "",
    "## Description",
    "",
    meta.description === "" ? "(missing)" : meta.description,
    "",
    "## Readiness",
    "",
    ...checks.map(([label2, ok]) => `- [${ok ? "x" : " "}] ${label2}`),
    ""
  ].join(`
`);
}
function tableCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// src/html.js
var TRIM_SIZES = new Map([
  ["5x8", { width: "5in", height: "8in", wordsPerPage: 230 }],
  ["5.25x8", { width: "5.25in", height: "8in", wordsPerPage: 250 }],
  ["5.5x8.5", { width: "5.5in", height: "8.5in", wordsPerPage: 275 }],
  ["6x9", { width: "6in", height: "9in", wordsPerPage: 300 }],
  ["a5", { width: "148mm", height: "210mm", wordsPerPage: 270 }]
]);
var DEFAULT_TRIM = "5.5x8.5";
function reviewHtml(book) {
  const toc = [];
  const sections = [];
  for (const part of book.parts) {
    const sectionId = part.kind === "chapter" ? part.key : `matter-${part.key}`;
    toc.push(`<li><a href="#${sectionId}">${escapeHtml(part.title)}</a></li>`);
    const body = [];
    let count = 0;
    for (const paragraph of part.paragraphs) {
      if (paragraph === null) {
        body.push(`<hr class="scene-break" aria-label="Scene break">`);
        continue;
      }
      count += 1;
      const anchor = `${part.key}-p${count}`;
      body.push(`<p id="${anchor}"><a class="anchor" href="#${anchor}" title="Link to ${anchor}">${anchor}</a>${paragraph}</p>`);
    }
    const heading = part.heading ? `<h2>${escapeHtml(part.title)}</h2>` : `<h2 class="visually-hidden">${escapeHtml(part.title)}</h2>`;
    sections.push(`<section id="${sectionId}" class="${part.kind}">${heading}
${body.join(`
`)}
</section>`);
  }
  const byline = book.authors.length === 0 ? "" : `<p class="byline">${escapeHtml(book.authors.join(" and "))}</p>`;
  return `<!DOCTYPE html>
<html lang="${escapeHtml(book.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(book.title)}: review copy</title>
<style>
:root { --bg: #fdfcf8; --fg: #1d1b16; --muted: #6b665c; --rule: #ddd6c8; --accent: #7c3aed; }
@media (prefers-color-scheme: dark) { :root { --bg: #16150f; --fg: #ece8dd; --muted: #a39e92; --rule: #3a372f; --accent: #b794f4; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 1.1rem/1.65 Georgia, "Iowan Old Style", "Palatino Linotype", serif; }
main { max-width: 38rem; margin: 0 auto; padding: 2rem 1rem 6rem; }
header h1 { font-size: 2rem; line-height: 1.2; margin: 2rem 0 0.25rem; }
.byline, .note { color: var(--muted); margin: 0 0 1rem; }
.note { font: 0.9rem/1.5 system-ui, sans-serif; border-left: 3px solid var(--accent); padding-left: 0.75rem; }
nav ol { padding-left: 1.25rem; }
nav a, .anchor { color: var(--accent); }
section { border-top: 1px solid var(--rule); margin-top: 3rem; padding-top: 1rem; }
h2 { font-size: 1.4rem; margin: 1rem 0 1.5rem; }
p { position: relative; margin: 0 0 1rem; }
.anchor { position: absolute; left: -5.5rem; width: 5rem; text-align: right; font: 0.7rem/2.2 system-ui, sans-serif; text-decoration: none; opacity: 0.35; }
p:hover .anchor, p:target .anchor, .anchor:focus { opacity: 1; }
p:target { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.scene-break { border: 0; text-align: center; margin: 2rem 0; }
.scene-break::after { content: "* * *"; color: var(--muted); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 52rem) { .anchor { position: static; display: block; width: auto; text-align: left; line-height: 1.4; opacity: 0.6; } }
</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(book.title)}</h1>
${byline}
<p class="note">Review copy. Every paragraph has a label such as <code>ch03-p12</code> (chapter 3, paragraph 12). Quote the label with each note so the author can find the exact spot.</p>
</header>
<nav aria-label="Contents"><h2>Contents</h2><ol>
${toc.join(`
`)}
</ol></nav>
${sections.join(`
`)}
</main>
</body>
</html>
`;
}
function printHtml(book, trimName = DEFAULT_TRIM) {
  const trim = TRIM_SIZES.get(trimName);
  if (!trim) {
    throw new Error(`Unsupported trim size: ${trimName}. Supported sizes: ${[...TRIM_SIZES.keys()].join(", ")}`);
  }
  const pages = estimatePages(book.words, trimName);
  const inside = insideMargin(pages);
  const author = book.authors.join(" and ");
  const toc = [];
  const sections = [];
  for (const part of book.parts) {
    const paragraphs = [];
    let first = true;
    for (const paragraph of part.paragraphs) {
      if (paragraph === null) {
        paragraphs.push(`<p class="scene-break" aria-label="Scene break">*&#8195;*&#8195;*</p>`);
        first = true;
        continue;
      }
      paragraphs.push(first ? `<p class="first">${paragraph}</p>` : `<p>${paragraph}</p>`);
      first = false;
    }
    if (part.kind === "chapter") {
      toc.push(`<li><a href="#${part.key}">${escapeHtml(part.title)}</a></li>`);
    }
    const heading = part.heading ? `<h1>${escapeHtml(part.title)}</h1>` : "";
    sections.push(`<section id="${part.key}" class="${part.kind}${part.kind === "chapter" ? "" : ` ${part.placement}`}">${heading}
${paragraphs.join(`
`)}
</section>`);
  }
  const copyrightIndex = book.parts.findIndex((part) => part.copyright && part.placement === "front");
  const beforeToc = copyrightIndex === -1 ? [] : sections.slice(0, copyrightIndex + 1);
  const afterToc = copyrightIndex === -1 ? sections : sections.slice(copyrightIndex + 1);
  return `<!DOCTYPE html>
<html lang="${escapeHtml(book.language)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(book.title)}</title>
<!-- Print interior for ${trimName} trim (${trim.width} x ${trim.height}), about ${pages} pages.
     Render to PDF with a CSS paged-media engine, for example:
       npx pagedjs-cli book.print.html -o book.pdf
       weasyprint book.print.html book.pdf
       prince book.print.html -o book.pdf
     Check the printer's current specs for margins, bleed, and fonts before upload. -->
<style>
@page { size: ${trim.width} ${trim.height}; margin: 0.75in 0.5in 0.75in ${inside}; }
@page :left { margin-left: 0.5in; margin-right: ${inside};
  @top-center { content: "${cssString(author || book.title)}"; font: italic 9pt Georgia, serif; } }
@page :right {
  @top-center { content: string(chapter-title, first-except); font: italic 9pt Georgia, serif; } }
@page chapter { @bottom-center { content: counter(page); font: 9pt Georgia, serif; } }
@page :blank { @top-center { content: none; } @bottom-center { content: none; } }
@page front { @top-center { content: none; } @bottom-center { content: none; } }
html { font: 11pt/1.4 Georgia, "Iowan Old Style", "Palatino Linotype", serif; }
body { margin: 0; hyphens: auto; }
.title-page, .toc, section.front { page: front; break-before: right; }
section.front.copyright-page { break-before: page; font-size: 9pt; }
.title-page { text-align: center; padding-top: 30%; }
.title-page h1 { font-size: 26pt; font-weight: normal; margin: 0 0 1em; }
.title-page .author { font-size: 14pt; font-variant: small-caps; letter-spacing: 0.05em; }
.toc h1 { font-size: 14pt; font-weight: normal; text-align: center; font-variant: small-caps; }
.toc ol { list-style: none; padding: 0; }
.toc a { color: inherit; text-decoration: none; }
.toc a::after { content: " " target-counter(attr(href), page); float: right; }
section.chapter, section.back { page: chapter; break-before: right; }
section.chapter > h1, section.back > h1 { string-set: chapter-title content(text); }
h1 { font-size: 16pt; font-weight: normal; text-align: center; margin: 1.5in 0 0.5in; break-after: avoid; }
p { margin: 0; text-indent: 1.5em; text-align: justify; widows: 2; orphans: 2; }
p.first, p.scene-break + p { text-indent: 0; }
/* A raised initial: floated drop caps render inconsistently across engines. */
section.chapter > h1 + p.first::first-letter { font-size: 2.4em; line-height: 1; }
p.scene-break { text-align: center; text-indent: 0; margin: 0.8em 0; break-after: avoid; }
section.front p, section.back p { text-indent: 0; margin-bottom: 0.6em; text-align: left; }
section.front:not(.copyright-page) p { text-align: center; }
@media screen { body { max-width: ${trim.width}; margin: 2rem auto; padding: 0 1rem; } section { margin-top: 3rem; } }
</style>
</head>
<body>
<section class="title-page"><h1>${escapeHtml(book.title)}</h1>${author === "" ? "" : `<p class="author">${escapeHtml(author)}</p>`}</section>
${beforeToc.join(`
`)}
<nav class="toc"><h1>Contents</h1><ol>
${toc.join(`
`)}
</ol></nav>
${afterToc.join(`
`)}
</body>
</html>
`;
}
function estimatePages(words, trimName = DEFAULT_TRIM) {
  const trim = TRIM_SIZES.get(trimName) ?? TRIM_SIZES.get(DEFAULT_TRIM);
  return Math.max(1, Math.ceil(words / trim.wordsPerPage));
}
function insideMargin(pages) {
  if (pages <= 150) {
    return "0.625in";
  }
  if (pages <= 300) {
    return "0.75in";
  }
  if (pages <= 500) {
    return "0.875in";
  }
  return "1in";
}
function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function cssString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/</g, "\\3C ").replace(/>/g, "\\3E ").replace(/&/g, "\\26 ").replace(/[\r\n]+/g, " ");
}

// src/narration.js
var NARRATION_WORDS_PER_MINUTE = 155;
function narrationScript(manuscript, guide) {
  const authors = manuscript.meta.authors.join(" and ");
  const sections = [
    ...manuscript.front.filter((entry) => !entry.copyright).map((entry) => ({ title: entry.title, body: entry.body })),
    ...manuscript.chapters.map((chapter) => ({ title: `Chapter ${chapter.number}: ${chapter.title}`, body: chapter.body })),
    ...manuscript.back.map((entry) => ({ title: entry.title, body: entry.body }))
  ].map((section) => ({ ...section, words: wordCount(section.body) }));
  const totalWords = sections.reduce((sum, section) => sum + section.words, 0);
  const lines = [
    `# ${manuscript.title}: Narration Script`,
    "",
    `Estimated finished runtime: ${formatRuntime(totalWords)} at ${NARRATION_WORDS_PER_MINUTE} words per minute (${totalWords} words). Narration pace varies; time a sample chapter and rescale.`,
    "",
    "## Pronunciation Guide",
    ""
  ];
  if (guide.length === 0) {
    lines.push("No pronunciations recorded. Add `pronunciation:` to character, location, faction, artifact, and glossary term files.");
  } else {
    lines.push("| Name | Say it | Kind |", "| --- | --- | --- |");
    for (const entry of guide) {
      lines.push(`| ${cell2(entry.name)} | ${cell2(entry.pronunciation)} | ${entry.kind} |`);
    }
  }
  lines.push("", "## Opening Credits", "", `${manuscript.title}.${authors === "" ? "" : ` Written by ${authors}.`} Narrated by [narrator].`);
  for (const section of sections) {
    lines.push("", `## ${section.title}`, "", `[${formatMinutes(section.words)}]`, "", narrationBody(section.body));
  }
  lines.push("", "## Closing Credits", "", `The end. You have been listening to ${manuscript.title}${authors === "" ? "" : `, written by ${authors}`}, narrated by [narrator].`, "");
  return lines.join(`
`);
}
function pronunciationGuide(project) {
  const guide = [];
  const add = (kind, name, pronunciation) => {
    if (typeof pronunciation === "string" && pronunciation.trim() !== "") {
      guide.push({ kind, name: String(name), pronunciation: pronunciation.trim() });
    }
  };
  project.characters.filter((character) => character.status !== "cut").forEach((character) => add("character", character.name, character.pronunciation));
  project.locations.forEach((location) => add("location", location.name, location.pronunciation));
  project.factions.forEach((faction) => add("faction", faction.name, faction.pronunciation));
  project.artifacts.forEach((artifact) => add("artifact", artifact.name, artifact.pronunciation));
  project.glossaryTerms.forEach((term) => add("term", term.term, term.pronunciation));
  return guide.sort((left, right) => left.name.localeCompare(right.name, "en") || left.kind.localeCompare(right.kind, "en"));
}
function narrationBody(body) {
  return String(body).replace(/\r\n?/g, `
`).split(/\n[ \t]*\n\s*/).map((paragraph) => paragraph.trim()).filter(Boolean).map((paragraph) => /^([*_-])( ?\1){2,}$/.test(paragraph) ? "[pause]" : paragraph).join(`

`);
}
function formatRuntime(words) {
  const minutes = Math.round(words / NARRATION_WORDS_PER_MINUTE);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
function formatMinutes(words) {
  const minutes = words / NARRATION_WORDS_PER_MINUTE;
  return minutes < 1 ? "under 1 min" : `about ${Math.round(minutes)} min`;
}
function cell2(value) {
  return String(value).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

// src/passes.js
var PASS_STATUSES = new Set(["pending", "in-progress", "done"]);
var DEFAULT_PASSES = [
  { pass: "structure", focus: "Order of events, act turns, scenes that do not change anything", checks: ["story timeline", "story pacing", "story diagram arcs"] },
  { pass: "character", focus: "Wants, arcs, motivation, and who knows what when", checks: ["story voices", "story knowledge <id> --at <chapter>", "story diagram relationships"] },
  { pass: "theme", focus: "Premise, counter-premise, motifs, and the lie/truth arc", checks: ["story report"] },
  { pass: "continuity", focus: "Deaths, props, travel, promises, clues, and backlinks", checks: ["story continuity", "story clues", "story links"] },
  { pass: "pacing", focus: "Scene outcomes, sequels, chapter hooks, and chapter lengths", checks: ["story pacing"] },
  { pass: "line", focus: "Sentence-level clarity, rhythm, and distinct voices", checks: ["story prose", "story voices"] },
  { pass: "copyedit", focus: "Spelling, usage, and consistency against the style sheet", checks: ["story prose"] },
  { pass: "proof", focus: "Typos and layout in the built book", checks: ["story build --format print", "story build --format html"] }
];
var DEFAULTS = new Map(DEFAULT_PASSES.map((entry) => [entry.pass, entry]));
function readPasses(storyData) {
  const raw = storyData["revision-passes"];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.pass === "string").map((entry) => ({ pass: entry.pass, status: typeof entry.status === "string" ? entry.status : "pending" }));
}
function validatePasses(data, label2, errors) {
  const raw = data["revision-passes"];
  if (raw === undefined) {
    return;
  }
  if (!Array.isArray(raw)) {
    errors.push(`${label2} frontmatter field revision-passes must be a list`);
    return;
  }
  const seen = new Set;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${label2} frontmatter field revision-passes must contain objects`);
      continue;
    }
    if (typeof entry.pass !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.pass)) {
      errors.push(`${label2} revision pass ${entry.pass ?? "(missing)"} must be a kebab-case name`);
      continue;
    }
    if (seen.has(entry.pass)) {
      errors.push(`${label2} lists revision pass ${entry.pass} more than once`);
    }
    seen.add(entry.pass);
    if (entry.status !== undefined && !PASS_STATUSES.has(entry.status)) {
      errors.push(`${label2} revision pass ${entry.pass} has unsupported status ${entry.status}`);
    }
  }
}
function updatePasses(passes, change) {
  const next = passes.map((entry) => ({ ...entry }));
  if (change.init) {
    for (const entry of DEFAULT_PASSES) {
      if (!next.some((existing) => existing.pass === entry.pass)) {
        next.push({ pass: entry.pass, status: "pending" });
      }
    }
  }
  for (const [name, status] of [[change.start, "in-progress"], [change.done, "done"]]) {
    if (name === undefined) {
      continue;
    }
    if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw new Error(`Revision pass names must be kebab-case, got ${name}`);
    }
    const existing = next.find((entry) => entry.pass === name);
    if (existing) {
      existing.status = status;
    } else {
      next.push({ pass: name, status });
    }
  }
  return next;
}
function nextPass(passes) {
  return passes.find((entry) => entry.status === "in-progress") ?? passes.find((entry) => entry.status !== "done") ?? null;
}
function formatPasses(passes) {
  const lines = [];
  if (passes.length === 0) {
    lines.push("Revision passes: none recorded. Run story passes --init to add the default ladder:", "");
    for (const entry of DEFAULT_PASSES) {
      lines.push(`- ${entry.pass}: ${entry.focus} (${entry.checks.join(", ")})`);
    }
    return `${lines.join(`
`)}
`;
  }
  const done = passes.filter((entry) => entry.status === "done").length;
  lines.push(`Revision passes: ${done} of ${passes.length} done`, "");
  for (const entry of passes) {
    const mark = entry.status === "done" ? "[x]" : entry.status === "in-progress" ? "[~]" : "[ ]";
    const known = DEFAULTS.get(entry.pass);
    const detail = known ? ` - ${known.focus} (${known.checks.join(", ")})` : "";
    lines.push(`${mark} ${entry.pass}${detail}`);
  }
  const upcoming = nextPass(passes);
  lines.push("", upcoming === null ? "All passes done." : `Next: ${upcoming.pass}${upcoming.status === "in-progress" ? " (in progress)" : ""}; mark it with story passes --done ${upcoming.pass}`);
  return `${lines.join(`
`)}
`;
}

// src/pacing.js
var SCENE_OUTCOMES = new Set(["yes", "no", "yes-but", "no-and"]);
var CHAPTER_HOOKS = new Set(["cliffhanger", "question", "revelation", "reversal", "decision", "emotional", "resolution"]);
var DRAFTED_STATUSES = new Set(["draft", "revised", "final", "complete"]);
var EASY_WIN_RUN = 3;
var NO_SEQUEL_RUN = 4;
var RESOLUTION_RUN = 3;
function buildPacing(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const warnings = [];
  const rows = [];
  const units = [];
  for (const chapter of chapters) {
    const scenes = project.scenes.filter((scene) => scene.chapter === chapter.id).sort((left, right) => left.scene - right.scene || left.id.localeCompare(right.id, "en"));
    const outcomes = { yes: 0, no: 0, "yes-but": 0, "no-and": 0 };
    for (const scene of scenes) {
      if (!scene.sequel && SCENE_OUTCOMES.has(scene.outcome)) {
        outcomes[scene.outcome] += 1;
      }
      units.push(scene);
    }
    rows.push({
      id: chapter.id,
      number: chapter.number,
      words: chapter.wordCount,
      scenes: scenes.filter((scene) => !scene.sequel).length,
      sequels: scenes.filter((scene) => scene.sequel).length,
      outcomes,
      hook: chapter.hook,
      status: chapter.status
    });
    if (chapter.hook === "" && DRAFTED_STATUSES.has(chapter.status)) {
      warnings.push(`${chapter.id} has no hook: record how the chapter ending pulls the reader on`);
    }
  }
  let easyWins = [];
  let withoutSequel = [];
  for (const unit of units) {
    if (unit.sequel) {
      flushRun(withoutSequel, NO_SEQUEL_RUN, warnings, (run) => `${run.length} scene units in a row with no sequel (${span(run)}): give the POV character room to react and decide`);
      withoutSequel = [];
      continue;
    }
    withoutSequel.push(unit);
    if (unit.outcome === "yes") {
      easyWins.push(unit);
    } else {
      flushRun(easyWins, EASY_WIN_RUN, warnings, (run) => `${run.length} scenes in a row end in an outright yes (${span(run)}): raise the cost with yes-but or no-and`);
      easyWins = [];
    }
  }
  flushRun(easyWins, EASY_WIN_RUN, warnings, (run) => `${run.length} scenes in a row end in an outright yes (${span(run)}): raise the cost with yes-but or no-and`);
  flushRun(withoutSequel, NO_SEQUEL_RUN, warnings, (run) => `${run.length} scene units in a row with no sequel (${span(run)}): give the POV character room to react and decide`);
  let resolutions = [];
  for (const row of rows) {
    if (row.hook === "resolution") {
      resolutions.push(row);
    } else {
      flushRun(resolutions, RESOLUTION_RUN, warnings, (run) => `${run.length} chapters in a row end on resolution (${span(run)}): readers can put the book down`);
      resolutions = [];
    }
  }
  flushRun(resolutions, RESOLUTION_RUN, warnings, (run) => `${run.length} chapters in a row end on resolution (${span(run)}): readers can put the book down`);
  const written = rows.filter((row) => row.words > 0);
  const median = medianOf(written.map((row) => row.words));
  if (written.length >= 3) {
    for (const row of written) {
      if (row.words > median * 2) {
        warnings.push(`${row.id} runs ${row.words} words, over twice the median chapter (${median}): consider splitting it`);
      } else if (row.words < median / 2) {
        warnings.push(`${row.id} runs ${row.words} words, under half the median chapter (${median}): check it earns its place`);
      }
    }
  }
  const recorded = units.filter((unit) => !unit.sequel && SCENE_OUTCOMES.has(unit.outcome));
  return {
    rows,
    medianWords: median,
    totals: {
      scenes: units.filter((unit) => !unit.sequel).length,
      sequels: units.filter((unit) => unit.sequel).length,
      outcomesRecorded: recorded.length,
      setbacks: recorded.filter((unit) => unit.outcome !== "yes").length,
      hooks: rows.filter((row) => row.hook !== "").length
    },
    warnings
  };
}
function flushRun(run, minimum, warnings, message) {
  if (run.length >= minimum) {
    warnings.push(message(run));
  }
}
function span(run) {
  const first = run[0].id;
  const last = run[run.length - 1].id;
  return first === last ? first : `${first} to ${last}`;
}
function medianOf(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
function formatPacing(pacing) {
  const { totals } = pacing;
  const setbackShare = totals.outcomesRecorded === 0 ? "no outcomes recorded" : `${Math.round(totals.setbacks * 100 / totals.outcomesRecorded)}% of recorded outcomes are setbacks or complications`;
  const lines = [
    `Pacing: ${totals.scenes} scenes, ${totals.sequels} sequels, ${totals.hooks} of ${pacing.rows.length} chapters with hooks`,
    `Outcomes: ${setbackShare}`,
    `Median chapter: ${pacing.medianWords} words`,
    ""
  ];
  if (pacing.rows.length === 0) {
    lines.push("- None: add chapters with story add chapter");
    return `${lines.join(`
`)}
`;
  }
  lines.push("Ch  Words  Scenes  Sequels  Outcomes (yes/no/yes-but/no-and)  Hook");
  for (const row of pacing.rows) {
    const outcomes = `${row.outcomes.yes}/${row.outcomes.no}/${row.outcomes["yes-but"]}/${row.outcomes["no-and"]}`;
    lines.push(`${String(row.number).padStart(2)}  ${String(row.words).padStart(5)}  ${String(row.scenes).padStart(6)}  ${String(row.sequels).padStart(7)}  ${outcomes.padEnd(32)}  ${row.hook || "-"}`);
  }
  return `${lines.join(`
`)}
`;
}

// src/progress.js
var PROGRESS_FILE = "progress.md";
var PACE_SESSIONS = 7;
function withSession(sessions, date, words) {
  const kept = sessions.filter((session) => session.date !== date);
  kept.push({ date, words });
  return kept.sort((left, right) => left.date.localeCompare(right.date, "en"));
}
function cleanSessions(value) {
  const sessions = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (entry && typeof entry === "object" && parseClockDate(String(entry.date ?? "")) && Number.isInteger(entry.words) && entry.words >= 0) {
      sessions.push({ date: String(entry.date), words: entry.words });
    }
  }
  return sessions.sort((left, right) => left.date.localeCompare(right.date, "en"));
}
function computeProgress({ words, target, deadline, today, chapters, sessions }) {
  const todayDays = parseClockDate(today).days;
  const result = {
    words,
    target: target ?? null,
    percent: target ? words * 100 / target : null,
    remaining: target ? Math.max(0, target - words) : null,
    deadline: null,
    chapters: chapters.filter((chapter) => chapter.target > 0).map((chapter) => ({ ...chapter, percent: chapter.words * 100 / chapter.target })),
    sessions: sessions.length,
    lastSession: null,
    pace: null,
    projected: null
  };
  const deadlineDate = deadline ? parseClockDate(deadline) : undefined;
  if (deadlineDate) {
    const daysLeft = deadlineDate.days - todayDays;
    result.deadline = {
      date: deadlineDate.text,
      daysLeft,
      perDay: result.remaining !== null && daysLeft > 0 ? Math.ceil(result.remaining / daysLeft) : null
    };
  }
  if (sessions.length > 0) {
    const last = sessions[sessions.length - 1];
    result.lastSession = { date: last.date, words: last.words, since: words - last.words };
    const recent = sessions.slice(-PACE_SESSIONS);
    const span2 = parseClockDate(recent[recent.length - 1].date).days - parseClockDate(recent[0].date).days;
    if (recent.length > 1 && span2 > 0) {
      result.pace = (recent[recent.length - 1].words - recent[0].words) / span2;
      if (result.remaining > 0 && result.pace > 0) {
        result.projected = formatDate(todayDays + Math.ceil(result.remaining / result.pace));
      }
    }
  }
  return result;
}
function formatProgress(progress) {
  const lines = [];
  if (progress.target === null) {
    lines.push(`Progress: ${formatNumber3(progress.words)} words (no target-words in story.md)`);
  } else {
    lines.push(`Progress: ${formatNumber3(progress.words)} of ${formatNumber3(progress.target)} words (${progress.percent.toFixed(1)}%)`);
    lines.push(`Remaining: ${formatNumber3(progress.remaining)} words`);
  }
  if (progress.deadline) {
    const { date, daysLeft, perDay } = progress.deadline;
    if (daysLeft < 0) {
      lines.push(`Deadline: ${date} passed ${plural2(-daysLeft, "day")} ago`);
    } else if (perDay === null) {
      lines.push(`Deadline: ${date} (${plural2(daysLeft, "day")} left)`);
    } else {
      lines.push(`Deadline: ${date} (${plural2(daysLeft, "day")} left): ${formatNumber3(perDay)} words a day needed`);
    }
  }
  if (progress.lastSession) {
    const { date, since } = progress.lastSession;
    lines.push(`Sessions: ${progress.sessions} logged; last ${date} (${since >= 0 ? "+" : ""}${formatNumber3(since)} words since)`);
  } else {
    lines.push("Sessions: none logged (run story progress --log after a writing session)");
  }
  if (progress.pace !== null) {
    lines.push(`Pace: ${formatNumber3(Math.round(progress.pace))} words a day over the last ${Math.min(progress.sessions, PACE_SESSIONS)} sessions`);
  }
  if (progress.projected) {
    lines.push(`Projected finish at this pace: ${progress.projected}`);
  }
  if (progress.chapters.length > 0) {
    lines.push("", "Chapter targets:");
    for (const chapter of progress.chapters) {
      lines.push(`- ${chapter.id}: ${formatNumber3(chapter.words)} of ${formatNumber3(chapter.target)} words (${Math.round(chapter.percent)}%)`);
    }
  }
  return `${lines.join(`
`)}
`;
}
function localDate(now = new Date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function formatDate(days) {
  return new Date(days * 86400000).toISOString().slice(0, 10);
}
function plural2(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function formatNumber3(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// src/series.js
import fs from "node:fs";
import path3 from "node:path";
var SERIES_LINK_INVERSES = [["follows", "precedes"], ["precedes", "follows"]];
var MAX_SERIES_BOOKS = 100;
var MAX_SERIES_DEPTH = 10;
var SHARED_CANON = [
  ["characters", "Characters", "name"],
  ["locations", "Locations", "name"],
  ["systems", "Systems", "name"],
  ["factions", "Factions", "name"],
  ["artifacts", "Artifacts", "name"],
  ["glossaryTerms", "Glossary terms", "term"]
];
function seriesLinkPath(fromRoot, toRoot) {
  return path3.relative(fromRoot, toRoot).split(path3.sep).join("/");
}
function seriesLinks(root, data, field) {
  const raw = data[field];
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return values.filter((value) => typeof value === "string" && value.trim() !== "").map((value) => path3.resolve(root, value));
}
function readBookFrontmatter(root) {
  const storyPath = path3.join(root, "story.md");
  if (!fs.existsSync(storyPath)) {
    return null;
  }
  return parseFrontmatter(fs.readFileSync(storyPath, "utf8"), storyPath).data;
}
function validateSeriesLinks(root, data, errors) {
  for (const [field, inverse] of SERIES_LINK_INVERSES) {
    for (const target of seriesLinks(root, data, field)) {
      const label2 = `story.md ${field} ${seriesLinkPath(root, target)}`;
      if (target === root) {
        errors.push(`${label2} points at this book`);
        continue;
      }
      let other;
      try {
        other = readBookFrontmatter(target);
      } catch (error) {
        errors.push(`${label2}: ${error.message}`);
        continue;
      }
      if (!other) {
        errors.push(`${label2} is not a story project: missing story.md`);
        continue;
      }
      if (!seriesLinks(target, other, inverse).includes(root)) {
        errors.push(`${label2} is missing backlink: add ${seriesLinkPath(target, root)} to its ${inverse}`);
      }
      if (data.series !== undefined && other.series !== undefined && data.series !== other.series) {
        errors.push(`${label2} belongs to series ${other.series}, not ${data.series}`);
      }
    }
  }
}
function withSeriesBacklink(targetRoot, field, linkedRoot) {
  const storyPath = path3.join(targetRoot, "story.md");
  const markdown = fs.readFileSync(storyPath, "utf8");
  const { data } = parseFrontmatter(markdown, storyPath);
  const current = data[field];
  const existing = Array.isArray(current) ? current : typeof current === "string" && current.trim() !== "" ? [current] : [];
  if (seriesLinks(targetRoot, { [field]: existing }, field).includes(linkedRoot)) {
    return null;
  }
  return replaceFrontmatter(markdown, { ...data, [field]: existing.concat(seriesLinkPath(targetRoot, linkedRoot)) });
}
function buildSeries(startRoot, scan) {
  const errors = [];
  const warnings = [];
  const books = discoverBooks(startRoot, scan, errors);
  if (books.length === 0) {
    return {
      root: startRoot,
      series: null,
      books: [],
      ordered: false,
      shared: [],
      ok: false,
      errors,
      warnings
    };
  }
  const seriesIds = [...new Set(books.map((book) => book.series).filter((series) => series !== undefined))].sort();
  if (seriesIds.length > 1) {
    errors.push(`Linked books belong to different series: ${seriesIds.join(", ")}`);
  }
  checkDuplicateBookNumbers(books, errors);
  const chronology = chronologicalOrder(books, errors);
  if (chronology) {
    checkSharedCanon(chronology, errors, warnings);
  }
  return {
    root: startRoot,
    series: books[0]?.series ?? seriesIds[0] ?? null,
    books: (chronology ? chronology.order : books).map((book) => ({
      title: book.title,
      label: book.label,
      bookNumber: book.bookNumber,
      status: book.status
    })),
    ordered: Boolean(chronology),
    shared: sharedCanon(books),
    ok: errors.length === 0,
    errors,
    warnings
  };
}
function formatSeriesReport(report) {
  const lines = [
    `# Series: ${report.series ?? "Unnamed series"}`,
    "",
    report.ordered ? "Chronological order:" : "Books (unordered):"
  ];
  report.books.forEach((book, index) => {
    const details = [book.bookNumber === null ? "unnumbered" : `book ${book.bookNumber}`, book.status || "no status"];
    lines.push(`${index + 1}. ${book.title} (${details.join(", ")}) - ${book.label}`);
  });
  lines.push("", "Shared canon:");
  if (report.shared.length === 0) {
    lines.push("- None");
  }
  for (const entry of report.shared) {
    lines.push(`- ${entry.label}: ${entry.ids.join(", ")}`);
  }
  return `${lines.join(`
`)}

`;
}
function canonicalPath(target) {
  const resolved = path3.resolve(target);
  const tail = [];
  let current = resolved;
  while (current !== path3.dirname(current)) {
    try {
      const real = fs.realpathSync(current);
      return tail.length === 0 ? real : path3.join(real, ...tail.reverse());
    } catch {
      tail.push(path3.basename(current));
      current = path3.dirname(current);
    }
  }
  try {
    return path3.join(fs.realpathSync(current), ...tail.reverse());
  } catch {
    return path3.join(current, ...tail.reverse());
  }
}
function discoverBooks(startRoot, scan, errors) {
  const startResolved = path3.resolve(startRoot);
  const scopeRoot = path3.dirname(startResolved);
  const scopeReal = canonicalPath(scopeRoot);
  const visited = new Map;
  const queue = [{ root: startResolved, depth: 0 }];
  while (queue.length > 0) {
    const { root, depth } = queue.shift();
    const resolved = path3.resolve(root);
    const effective = canonicalPath(resolved);
    if (visited.has(effective)) {
      continue;
    }
    if (visited.size >= MAX_SERIES_BOOKS) {
      errors.push("Series links exceed the " + MAX_SERIES_BOOKS + " book limit; refusing to traverse further");
      break;
    }
    const label2 = seriesLinkPath(startRoot, root) || ".";
    if (!isPathInside(scopeRoot, resolved) || !isPathInside(scopeReal, effective)) {
      errors.push(label2 + " points outside the series directory " + scopeRoot + "; refusing to follow");
      visited.set(effective, null);
      continue;
    }
    if (depth > MAX_SERIES_DEPTH) {
      errors.push(label2 + " exceeds the series traversal depth of " + MAX_SERIES_DEPTH + "; refusing to follow further links");
      visited.set(effective, null);
      continue;
    }
    if (!fs.existsSync(path3.join(root, "story.md"))) {
      errors.push(`${label2} is not a story project: missing story.md`);
      visited.set(effective, null);
      continue;
    }
    let project;
    try {
      project = scan(root);
    } catch (error) {
      errors.push(`${label2}: ${error.message}`);
      visited.set(effective, null);
      continue;
    }
    for (const scanError of project.fileErrors ?? []) {
      errors.push(`${label2}: ${scanError}`);
    }
    const data = project.story.data;
    const book = {
      root,
      key: effective,
      label: label2,
      project,
      title: String(data.title ?? path3.basename(root)),
      series: data.series,
      status: data.status,
      bookNumber: Number.isInteger(data["book-number"]) ? data["book-number"] : null,
      follows: seriesLinks(root, data, "follows"),
      precedes: seriesLinks(root, data, "precedes")
    };
    visited.set(effective, book);
    for (const next of book.follows.concat(book.precedes)) {
      queue.push({ root: next, depth: depth + 1 });
    }
  }
  return [...visited.values()].filter(Boolean);
}
function isPathInside(root, target) {
  const relativePath = path3.relative(root, target);
  return !path3.isAbsolute(relativePath) && (relativePath === "" || !relativePath.split(path3.sep).includes(".."));
}
function chronologicalOrder(books, errors) {
  const byKey = new Map(books.map((book) => [book.key, book]));
  const later = new Map(books.map((book) => [book.key, new Set]));
  for (const book of books) {
    for (const earlier of book.follows.map(canonicalPath)) {
      if (byKey.has(earlier) && earlier !== book.key) {
        later.get(earlier).add(book.key);
      }
    }
    for (const next of book.precedes.map(canonicalPath)) {
      if (byKey.has(next) && next !== book.key) {
        later.get(book.key).add(next);
      }
    }
  }
  const indegree = new Map(books.map((book) => [book.key, 0]));
  for (const targets of later.values()) {
    for (const target of targets) {
      indegree.set(target, indegree.get(target) + 1);
    }
  }
  const order = [];
  const ready = books.filter((book) => indegree.get(book.key) === 0);
  while (ready.length > 0) {
    ready.sort(compareBooks);
    const book = ready.shift();
    order.push(book);
    for (const target of later.get(book.key)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) {
        ready.push(byKey.get(target));
      }
    }
  }
  if (order.length < books.length) {
    const cycle = books.filter((book) => !order.includes(book)).map((book) => book.title);
    errors.push(`Series chronology has a cycle between ${cycle.join(", ")}; check follows and precedes`);
    return null;
  }
  return { order, later };
}
function checkDuplicateBookNumbers(books, errors) {
  const byNumber = new Map;
  for (const book of books) {
    if (book.bookNumber !== null) {
      byNumber.set(book.bookNumber, (byNumber.get(book.bookNumber) ?? []).concat(book.label));
    }
  }
  for (const [number, labels] of [...byNumber].sort((left, right) => left[0] - right[0])) {
    if (labels.length > 1) {
      errors.push(`Books ${labels.join(", ")} share book-number ${number}; book-number is publication order and must be unique`);
    }
  }
}
function compareBooks(left, right) {
  return (left.bookNumber ?? Infinity) - (right.bookNumber ?? Infinity) || left.title.localeCompare(right.title);
}
function checkSharedCanon({ order, later }, errors, warnings) {
  const reachable = new Map(order.map((book) => [book.key, collectLater(book.key, later, new Set)]));
  for (const book of order) {
    const earlierBooks = order.filter((candidate) => reachable.get(candidate.key).has(book.key));
    checkCanonNames(book, earlierBooks, warnings);
    checkCanonDeaths(book, earlierBooks, errors);
    checkDestroyedArtifacts(book, earlierBooks, warnings);
    checkKnownFacts(book, earlierBooks, errors);
  }
}
function collectLater(root, later, seen) {
  for (const next of later.get(root)) {
    if (!seen.has(next)) {
      seen.add(next);
      collectLater(next, later, seen);
    }
  }
  return seen;
}
function checkCanonNames(book, earlierBooks, warnings) {
  for (const [key, , field] of SHARED_CANON) {
    const canon = new Map;
    for (const earlier of earlierBooks) {
      for (const entity of earlier.project[key]) {
        canon.set(entity.id, { book: earlier, entity });
      }
    }
    for (const entity of book.project[key]) {
      const match = canon.get(entity.id);
      if (match && entity[field] !== match.entity[field]) {
        warnings.push(`${bookFile(book, entity.file)} ${field} "${entity[field]}" differs from "${match.entity[field]}" in ${bookFile(match.book, match.entity.file)}`);
      }
    }
  }
}
function checkCanonDeaths(book, earlierBooks, errors) {
  const deaths = firstMatching(earlierBooks, "characters", (character) => character.status === "deceased");
  for (const character of book.project.characters) {
    const death = deaths.get(character.id);
    if (!death) {
      continue;
    }
    if (character.status !== "deceased") {
      errors.push(`${bookFile(book, character.file)} has status ${character.status || "unset"}, but ${character.id} is deceased in earlier book ${death.title}; set status: deceased`);
    }
  }
  for (const record of book.project.chapters.concat(book.project.scenes)) {
    for (const [id, death] of deaths) {
      if (record.pov === id || record.characters.includes(id)) {
        errors.push(`${bookFile(book, record.file)} lists ${id}, who died in earlier book ${death.title}; move appearances to mentions`);
      }
    }
  }
}
function checkDestroyedArtifacts(book, earlierBooks, warnings) {
  const destroyed = firstMatching(earlierBooks, "artifacts", (artifact) => artifact.status === "destroyed");
  for (const artifact of book.project.artifacts) {
    const earlier = destroyed.get(artifact.id);
    if (earlier && artifact.status !== "destroyed") {
      warnings.push(`${bookFile(book, artifact.file)} has status ${artifact.status || "unset"}, but ${artifact.id} was destroyed in earlier book ${earlier.title}`);
    }
  }
}
function checkKnownFacts(book, earlierBooks, errors) {
  const known = new Map;
  for (const earlier of earlierBooks) {
    for (const entry of knowledgeFacts(earlier)) {
      if (!known.has(entry.key)) {
        known.set(entry.key, { book: earlier, entry });
      }
    }
  }
  for (const entry of knowledgeFacts(book)) {
    const prior = known.get(entry.key);
    if (prior && entry.learnedIn) {
      errors.push(`${bookFile(book, entry.file)} knowledge-state[${entry.index}] has ${entry.character} learn ${entry.fact} in ${entry.learnedIn}, but they already know it in earlier book ${prior.book.title} (${bookFile(prior.book, prior.entry.file)} knowledge-state[${prior.entry.index}])`);
    }
  }
}
function knowledgeFacts(book) {
  const continuity = book.project.continuity;
  const entries = continuity && Array.isArray(continuity.data["knowledge-state"]) ? continuity.data["knowledge-state"] : [];
  const file = path3.join(book.root, "continuity", "state.md");
  const facts = [];
  entries.forEach((entry, index) => {
    const fact = entry && typeof entry === "object" ? String(entry.fact ?? "") : "";
    if (fact !== "" && typeof entry.character === "string") {
      facts.push({
        index,
        file,
        character: entry.character,
        fact,
        key: `${entry.character}\x00${fact}`,
        learnedIn: entry["learned-in"] ? String(entry["learned-in"]) : ""
      });
    }
  });
  return facts;
}
function firstMatching(books, key, predicate) {
  const matches = new Map;
  for (const book of books) {
    for (const entity of book.project[key]) {
      if (!matches.has(entity.id) && predicate(entity)) {
        matches.set(entity.id, book);
      }
    }
  }
  return matches;
}
function sharedCanon(books) {
  const shared = [];
  for (const [key, label2] of SHARED_CANON) {
    const counts = new Map;
    for (const book of books) {
      for (const entity of book.project[key]) {
        counts.set(entity.id, (counts.get(entity.id) ?? 0) + 1);
      }
    }
    const ids = [...counts].filter(([, count]) => count > 1).map(([id]) => id).sort();
    if (ids.length > 0) {
      shared.push({ label: label2, ids });
    }
  }
  const factBooks = new Map;
  for (const book of books) {
    for (const entry of knowledgeFacts(book)) {
      factBooks.set(entry.fact, (factBooks.get(entry.fact) ?? new Set).add(book.root));
    }
  }
  const facts = [...factBooks].filter(([, roots]) => roots.size > 1).map(([fact]) => fact).sort();
  if (facts.length > 0) {
    shared.push({ label: "Facts", ids: facts });
  }
  return shared;
}
function bookFile(book, file) {
  return path3.join(book.label, path3.relative(book.root, file));
}

// src/story.js
var STORY_SCHEMA_VERSION = 2;
var REQUIRED_PATHS = [
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
var INDEX_SCHEMAS = [
  [path4.join("characters", "_index.md"), "character-registry"],
  [path4.join("worldbuilding", "_index.md"), "world-registry"],
  [path4.join("plot", "_index.md"), "plot-registry"],
  [path4.join("plot", "timeline.md"), "timeline"],
  [path4.join("chapters", "_index.md"), "chapter-registry"],
  [path4.join("scenes", "_index.md"), "scene-registry"],
  [path4.join("continuity", "questions", "_index.md"), "question-registry"],
  [path4.join("continuity", "promises", "_index.md"), "promise-registry"],
  [path4.join("continuity", "clues", "_index.md"), "clue-registry"],
  [path4.join("glossary", "_index.md"), "glossary-registry"]
];
var STORY_STATUSES = new Set(["planning", "drafting", "in-progress", "revising", "complete", "abandoned"]);
var STORY_TENSES = new Set(["past", "present", "future", "mixed"]);
var CHARACTER_ROLES = new Set(["protagonist", "antagonist", "supporting", "minor", "narrator", "deuteragonist"]);
var CHARACTER_STATUSES = new Set(["alive", "deceased", "unknown", "missing", "cut"]);
var ARC_TYPES = new Set(["main", "subplot", "character", "thematic"]);
var ARC_STATUSES = new Set(["planned", "in-progress", "resolved"]);
var CHAPTER_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);
var SCENE_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);
var FACTION_TYPES = new Set(["family", "guild", "government", "military", "religion", "company", "community", "criminal", "other"]);
var FACTION_STATUSES = new Set(["active", "hidden", "declining", "defeated", "disbanded", "unknown"]);
var ARTIFACT_TYPES = new Set(["object", "weapon", "document", "technology", "relic", "symbol", "resource", "other"]);
var ARTIFACT_STATUSES = new Set(["active", "lost", "destroyed", "hidden", "transferred", "unknown"]);
var QUESTION_STATUSES = new Set(["open", "answered", "resolved", "dropped", "abandoned"]);
var PROMISE_STATUSES = new Set(["planned", "planted", "paid-off", "dropped", "abandoned"]);
var CLUE_STATUSES = new Set(["planned", "planted", "paid-off", "dropped", "abandoned"]);
var TERM_CATEGORIES = new Set(["person", "place", "faction", "artifact", "concept", "term", "other"]);
var STYLE_DIALECTS = new Set(["british", "american", "unspecified"]);
var STYLE_SHEET_FILE = "style-sheet.md";
var MATTER_PLACEMENTS = new Set(["front", "back"]);
var MATTER_PERMISSIONS = new Set(["not-needed", "pending", "granted", "public-domain"]);
var MATTER_DIR = "matter";
var RESEARCH_STATUSES = new Set(["open", "verified", "disputed"]);
var RESEARCH_ACCURACY = new Set(["must-be-accurate", "blended", "invented"]);
var RESEARCH_CONFIDENCE = new Set(["high", "medium", "low"]);
var RESEARCH_METHODS = new Set(["fact", "interview", "site-visit", "expert-review", "reading"]);
var RESEARCH_RISKS = new Set(["legal", "medical", "weapons", "safety", "cultural", "defamation", "technical"]);
var RESEARCH_DIR = "research";
var SETTLED_CHAPTER_STATUSES = new Set(["final", "complete"]);
var COVER_MEDIA_TYPES = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};
var RELATIONSHIP_INVERSES = new Map([
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
var SYMMETRIC_RELATIONSHIPS = new Set([
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
function createStoryProject(options) {
  const title = String(options.title ?? "").trim();
  if (!title) {
    throw new Error("A story title is required");
  }
  const storyId = kebabCase(title);
  const cwd = options.cwd ?? process.cwd();
  if (!storyId) {
    throw new Error('Cannot derive a story id from title "' + title + '": use a title containing ASCII letters or digits');
  }
  const root = path4.resolve(cwd, options.dir ?? storyId);
  if (lstatIfExists(root)?.isSymbolicLink()) {
    throw new Error(`Refusing to use symlinked project directory: ${root}`);
  }
  if (fs2.existsSync(root) && !options.force) {
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
  fs2.mkdirSync(path4.join(root, "characters"), { recursive: true });
  fs2.mkdirSync(path4.join(root, "worldbuilding", "locations"), { recursive: true });
  fs2.mkdirSync(path4.join(root, "worldbuilding", "systems"), { recursive: true });
  fs2.mkdirSync(path4.join(root, "worldbuilding", "factions"), { recursive: true });
  fs2.mkdirSync(path4.join(root, "worldbuilding", "artifacts"), { recursive: true });
  fs2.mkdirSync(path4.join(root, "plot", "arcs"), { recursive: true });
  fs2.mkdirSync(path4.join(root, "chapters"), { recursive: true });
  fs2.mkdirSync(path4.join(root, "scenes"), { recursive: true });
  fs2.mkdirSync(path4.join(root, "continuity", "questions"), { recursive: true });
  fs2.mkdirSync(path4.join(root, "continuity", "promises"), { recursive: true });
  fs2.mkdirSync(path4.join(root, "continuity", "clues"), { recursive: true });
  fs2.mkdirSync(path4.join(root, "glossary", "terms"), { recursive: true });
  const storyWritten = writeStarterFile(path4.join(root, "story.md"), storyBible({
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
  writeStarterFile(path4.join(root, "characters", "_index.md"), characterIndex(storyId, [], "", ""), { root });
  writeStarterFile(path4.join(root, "worldbuilding", "_index.md"), worldIndex(storyId, [], [], [], [], ""), { root });
  writeStarterFile(path4.join(root, "plot", "_index.md"), plotIndex(storyId, "three-act", [], "", ""), { root });
  writeStarterFile(path4.join(root, "plot", "timeline.md"), timeline(storyId), { root });
  writeStarterFile(path4.join(root, "chapters", "_index.md"), chapterIndex(storyId, []), { root });
  writeStarterFile(path4.join(root, "scenes", "_index.md"), sceneIndex(storyId, []), { root });
  writeStarterFile(path4.join(root, "continuity", "state.md"), continuityState(storyId), { root });
  writeStarterFile(path4.join(root, "continuity", "questions", "_index.md"), questionIndex(storyId, []), { root });
  writeStarterFile(path4.join(root, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), { root });
  writeStarterFile(path4.join(root, "continuity", "clues", "_index.md"), clueIndex(storyId, []), { root });
  writeStarterFile(path4.join(root, "glossary", "_index.md"), glossaryIndex(storyId, []), { root });
  writeStarterFile(path4.join(root, STYLE_SHEET_FILE), styleSheet(), { root });
  const linkedBooks = [];
  for (const book of storyWritten ? series.linked : []) {
    const updated = withSeriesBacklink(book.root, book.inverse, root);
    if (updated !== null) {
      writeFile(path4.join(book.root, "story.md"), updated, { root: book.root });
      linkedBooks.push(book.root);
    }
  }
  return { root, storyId, linkedBooks, files: REQUIRED_PATHS.filter((entry) => entry.endsWith(".md")) };
}
function writeStarterFile(filePath, contents, options) {
  if (lstatIfExists(filePath)) {
    assertSafeProjectPath(filePath, options.root);
    return false;
  }
  writeFile(filePath, contents, options);
  return true;
}
function resolveSeriesOptions(root, cwd, options) {
  const linked = [];
  for (const [field, inverse] of [["follows", "precedes"], ["precedes", "follows"]]) {
    for (const value of asArray(options[field]).filter((item) => typeof item === "string" && item.trim() !== "")) {
      const bookRoot = path4.resolve(cwd, value);
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
  if (series !== undefined && !isKebabId2(String(series))) {
    throw new Error(`Series id must be kebab-case: ${series}`);
  }
  let bookNumber;
  if (options.bookNumber !== undefined) {
    bookNumber = requirePositiveInteger(options.bookNumber, "Book number");
  } else if (linked.length > 0) {
    const numbers = linked.map((book) => book.data["book-number"]).filter((value) => Number.isInteger(value));
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
    } catch {}
  }
  return numbers;
}
function scanProject(root) {
  const projectRoot = path4.resolve(root);
  const scanErrors = [];
  const storyPath = requireStoryFile(projectRoot);
  let story;
  try {
    story = readMarkdown(storyPath, projectRoot);
  } catch (error) {
    scanErrors.push(`story.md: ${error.message}`);
    story = { data: { title: path4.basename(projectRoot) }, body: "", rawMarkdown: "" };
  }
  const storyId = kebabCase(story.data.title ?? path4.basename(projectRoot));
  let continuity = null;
  const continuityPath = path4.join(projectRoot, "continuity", "state.md");
  if (fs2.existsSync(continuityPath)) {
    try {
      continuity = readMarkdown(continuityPath, projectRoot);
    } catch (error) {
      scanErrors.push(`${path4.join("continuity", "state.md")}: ${error.message}`);
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
    locations: readEntityFiles(projectRoot, path4.join("worldbuilding", "locations"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      region: data.region ?? "",
      notableCharacters: asArray(data["notable-characters"]),
      routes: asArray(data.routes),
      pronunciation: data.pronunciation
    }), scanErrors),
    systems: readEntityFiles(projectRoot, path4.join("worldbuilding", "systems"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? ""
    }), scanErrors),
    factions: readEntityFiles(projectRoot, path4.join("worldbuilding", "factions"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      members: asArray(data.members),
      locations: asArray(data.locations),
      pronunciation: data.pronunciation
    }), scanErrors),
    artifacts: readEntityFiles(projectRoot, path4.join("worldbuilding", "artifacts"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      owner: data.owner ?? "",
      location: data.location ?? "",
      pronunciation: data.pronunciation
    }), scanErrors),
    arcs: readEntityFiles(projectRoot, path4.join("plot", "arcs"), (id, file, data) => ({
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
    questions: readEntityFiles(projectRoot, path4.join("continuity", "questions"), (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      introduced: String(data.introduced ?? ""),
      resolved: String(data.resolved ?? ""),
      characters: asArray(data.characters)
    }), scanErrors),
    promises: readEntityFiles(projectRoot, path4.join("continuity", "promises"), (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      planted: String(data.planted ?? ""),
      payoff: String(data.payoff ?? ""),
      arcs: asArray(data.arcs),
      characters: asArray(data.characters)
    }), scanErrors),
    clues: readEntityFiles(projectRoot, path4.join("continuity", "clues"), (id, file, data) => ({
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
    glossaryTerms: readEntityFiles(projectRoot, path4.join("glossary", "terms"), (id, file, data) => ({
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
function validateProject(root) {
  const projectRoot = path4.resolve(root);
  const errors = [];
  const warnings = [];
  for (const requiredPath of REQUIRED_PATHS) {
    if (!fs2.existsSync(path4.join(projectRoot, requiredPath))) {
      errors.push(`Missing required path: ${requiredPath}`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return validateProjectOf(scanProject(projectRoot));
}
function validateProjectOf(project) {
  const errors = [];
  const warnings = [];
  const projectRoot = project.root;
  for (const requiredPath of REQUIRED_PATHS) {
    if (!fs2.existsSync(path4.join(projectRoot, requiredPath))) {
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
    [path4.join("characters", "_index.md"), project.characters.map((item) => `](${item.id}.md)`)],
    [path4.join("worldbuilding", "_index.md"), project.locations.map((item) => `](locations/${item.id}.md)`).concat(project.systems.map((item) => `](systems/${item.id}.md)`)).concat(project.factions.map((item) => `](factions/${item.id}.md)`)).concat(project.artifacts.map((item) => `](artifacts/${item.id}.md)`))],
    [path4.join("plot", "_index.md"), project.arcs.map((item) => `](arcs/${item.id}.md)`)],
    [path4.join("chapters", "_index.md"), project.chapters.map((item) => `](${path4.basename(item.file)})`)],
    [path4.join("scenes", "_index.md"), project.scenes.map((item) => `](${item.id}.md)`)],
    [path4.join("continuity", "questions", "_index.md"), project.questions.map((item) => `](${item.id}.md)`)],
    [path4.join("continuity", "promises", "_index.md"), project.promises.map((item) => `](${item.id}.md)`)],
    [path4.join("continuity", "clues", "_index.md"), project.clues.map((item) => `](${item.id}.md)`)],
    [path4.join("glossary", "_index.md"), project.glossaryTerms.map((item) => `](terms/${item.id}.md)`)],
    ...fs2.existsSync(path4.join(projectRoot, MATTER_DIR, "_index.md")) ? [[path4.join(MATTER_DIR, "_index.md"), project.matter.map((item) => `](${item.id}.md)`)]] : [],
    ...fs2.existsSync(path4.join(projectRoot, RESEARCH_DIR, "_index.md")) ? [[path4.join(RESEARCH_DIR, "_index.md"), project.research.map((item) => `](${item.id}.md)`)]] : []
  ];
  for (const [indexPath, links] of indexChecks) {
    let markdown;
    try {
      markdown = safeRead(path4.join(projectRoot, indexPath), projectRoot);
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
      warnings.push(`${path4.relative(projectRoot, chapter.file)} declares ${chapter.declaredWordCount} words but contains ${chapter.wordCount}`);
    }
    if (!project.scenes.some((scene) => scene.chapter === chapter.id)) {
      warnings.push(`${path4.relative(projectRoot, chapter.file)} has no machine-readable scene records`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
function validateLinks(root) {
  return validateLinksOf(scanProject(root));
}
function validateLinksOf(project) {
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
  const artifactIds = new Set(project.artifacts.map((item) => item.id));
  const hasMention = (id) => characters.has(id) || artifactIds.has(id);
  for (const character of project.characters) {
    const label2 = relative2(project, character.file);
    for (const relationship of character.relationships) {
      if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
        continue;
      }
      const target = relationship.character;
      if (typeof target !== "string" || target === "") {
        continue;
      }
      if (target !== kebabCase(target)) {
        errors.push(`${label2} relationship character ${target} must be kebab-case`);
        continue;
      }
      if (!characters.has(target)) {
        errors.push(`${label2} references missing character ${target}`);
      } else {
        const backlinks = [];
        for (const entry of characters.get(target).relationships) {
          if (entry && typeof entry === "object" && !Array.isArray(entry) && entry.character === character.id) {
            backlinks.push(entry);
          }
        }
        if (backlinks.length === 0) {
          errors.push(`${label2} relationship to ${target} is missing backlink`);
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
            errors.push(`${label2} relationship ${relationship.type} to ${target} expects backlink type ${expectedTypes.join(" or ")}, got ${types.join(", ") || "none"}`);
          }
        }
      }
    }
    for (const locationId of character.locations) {
      checkIdReference(errors, label2, locationId, "location", hasLocation);
      if (typeof locationId === "string" && locationId !== "" && locationId === kebabCase(locationId) && locations.has(locationId) && !locations.get(locationId).notableCharacters.includes(character.id)) {
        errors.push(`${label2} location ${locationId} is missing notable-character backlink`);
      }
    }
    if (character.diedIn) {
      checkIdReference(errors, label2, character.diedIn, "chapter", hasChapter);
    }
  }
  for (const location of project.locations) {
    const label2 = relative2(project, location.file);
    for (const route of location.routes) {
      if (!route || typeof route !== "object" || Array.isArray(route) || typeof route.to !== "string" || route.to === "") {
        continue;
      }
      if (route.to === location.id) {
        errors.push(`${label2} route points at itself`);
        continue;
      }
      checkIdReference(errors, `${label2} route`, route.to, "location", hasLocation);
    }
    for (const characterId of location.notableCharacters) {
      checkIdReference(errors, label2, characterId, "character", hasCharacter);
      if (typeof characterId === "string" && characterId !== "" && characterId === kebabCase(characterId) && characters.has(characterId) && !characters.get(characterId).locations.includes(location.id)) {
        errors.push(`${label2} notable character ${characterId} is missing location backlink`);
      }
    }
  }
  for (const arc of project.arcs) {
    const label2 = relative2(project, arc.file);
    for (const characterId of arc.characters) {
      checkIdReference(errors, label2, characterId, "character", hasCharacter);
    }
  }
  for (const chapter of project.chapters) {
    const label2 = relative2(project, chapter.file);
    if (chapter.pov) {
      const povText = String(chapter.pov);
      if (povText !== kebabCase(povText)) {
        errors.push(`${label2} references POV character ${povText} which must be kebab-case`);
      } else if (!characters.has(chapter.pov)) {
        errors.push(`${label2} references missing POV character ${chapter.pov}`);
      }
    }
    for (const characterId of chapter.characters) {
      checkIdReference(errors, label2, characterId, "character", hasCharacter);
    }
    for (const mentionId of chapter.mentions) {
      checkIdReference(errors, label2, mentionId, "character or artifact", hasMention);
    }
    for (const locationId of chapter.locations) {
      checkIdReference(errors, label2, locationId, "location", hasLocation);
    }
    for (const arcId of chapter.arcsAdvanced) {
      checkIdReference(errors, label2, arcId, "arc", hasArc);
    }
  }
  for (const faction of project.factions) {
    const label2 = relative2(project, faction.file);
    for (const characterId of faction.members) {
      checkIdReference(errors, label2, characterId, "member", hasCharacter);
    }
    for (const locationId of faction.locations) {
      checkIdReference(errors, label2, locationId, "location", hasLocation);
    }
  }
  for (const artifact of project.artifacts) {
    const label2 = relative2(project, artifact.file);
    if (artifact.owner) {
      const ownerText = String(artifact.owner);
      if (ownerText !== kebabCase(ownerText)) {
        errors.push(`${label2} references owner ${ownerText} which must be kebab-case`);
      } else if (!characters.has(artifact.owner) && !factions.has(artifact.owner)) {
        errors.push(`${label2} references missing owner ${artifact.owner}`);
      }
    }
    if (artifact.location) {
      checkIdReference(errors, label2, artifact.location, "location", hasLocation);
    }
  }
  for (const scene of project.scenes) {
    const label2 = relative2(project, scene.file);
    if (scene.chapter) {
      const chapterText = String(scene.chapter);
      if (chapterText !== kebabCase(chapterText)) {
        errors.push(`${label2} references chapter ${chapterText} which must be kebab-case`);
      } else if (!chapters.has(scene.chapter)) {
        errors.push(`${label2} references missing chapter ${scene.chapter}`);
      }
    }
    if (scene.pov) {
      const povText = String(scene.pov);
      if (povText !== kebabCase(povText)) {
        errors.push(`${label2} references POV character ${povText} which must be kebab-case`);
      } else if (!characters.has(scene.pov)) {
        errors.push(`${label2} references missing POV character ${scene.pov}`);
      }
    }
    if (scene.location) {
      checkIdReference(errors, label2, scene.location, "location", hasLocation);
    }
    for (const characterId of scene.characters) {
      checkIdReference(errors, label2, characterId, "character", hasCharacter);
    }
    for (const mentionId of scene.mentions) {
      checkIdReference(errors, label2, mentionId, "character or artifact", hasMention);
    }
    for (const arcId of scene.arcsAdvanced) {
      checkIdReference(errors, label2, arcId, "arc", hasArc);
    }
  }
  for (const note of project.research) {
    const label2 = relative2(project, note.file);
    for (const chapterId of note.usedIn) {
      checkIdReference(errors, label2, chapterId, "chapter", hasChapter);
    }
  }
  for (const question of project.questions) {
    const label2 = relative2(project, question.file);
    for (const chapterId of [question.introduced, question.resolved].filter(Boolean)) {
      checkIdReference(errors, label2, chapterId, "chapter", hasChapter);
    }
    for (const characterId of question.characters) {
      checkIdReference(errors, label2, characterId, "character", hasCharacter);
    }
  }
  for (const promise of project.promises) {
    const label2 = relative2(project, promise.file);
    for (const chapterId of [promise.planted, promise.payoff].filter(Boolean)) {
      checkIdReference(errors, label2, chapterId, "chapter", hasChapter);
    }
    for (const arcId of promise.arcs) {
      checkIdReference(errors, label2, arcId, "arc", hasArc);
    }
    for (const characterId of promise.characters) {
      checkIdReference(errors, label2, characterId, "character", hasCharacter);
    }
  }
  for (const clue of project.clues) {
    const label2 = relative2(project, clue.file);
    for (const chapterId of [clue.planted, clue.payoff].filter(Boolean)) {
      checkIdReference(errors, label2, chapterId, "chapter", hasChapter);
    }
    for (const arcId of clue.arcs) {
      checkIdReference(errors, label2, arcId, "arc", hasArc);
    }
    for (const characterId of clue.characters) {
      checkIdReference(errors, label2, characterId, "character", hasCharacter);
    }
  }
  validateTimelineAndArcBodyRefs(project, chapters, errors);
  validateSeriesLinks(project.root, project.story.data, errors);
  return { ok: errors.length === 0, errors, warnings };
}
function validateTimelineAndArcBodyRefs(project, chapters, errors) {
  const chapterIds = new Set(chapters.keys());
  const timelinePath = path4.join(project.root, "plot", "timeline.md");
  if (fs2.existsSync(timelinePath)) {
    try {
      assertFileSizeWithinLimit(timelinePath);
      const raw = fs2.readFileSync(timelinePath, "utf8");
      const body = parseFrontmatter(raw, timelinePath).body ?? raw;
      for (const token of extractChapterIdTokens(body)) {
        if (!chapterIds.has(token)) {
          errors.push(`${path4.join("plot", "timeline.md")} references missing chapter ${token}`);
        }
      }
      for (const target of extractMarkdownLinkTargets(body)) {
        checkBodyLinkTarget(project, path4.join("plot", "timeline.md"), target, errors);
      }
    } catch (error) {
      const message = `${path4.join("plot", "timeline.md")}: ${error.message}`;
      if (!errors.includes(message)) {
        errors.push(message);
      }
    }
  }
  for (const arc of project.arcs) {
    const label2 = relative2(project, arc.file);
    let body = "";
    try {
      body = readMarkdown(arc.file, project.root).body ?? "";
    } catch (error) {
      const message = label2 + ": " + error.message;
      if (!errors.includes(message)) {
        errors.push(message);
      }
      continue;
    }
    for (const token of extractChapterIdTokens(body)) {
      if (!chapterIds.has(token)) {
        errors.push(`${label2} references missing chapter ${token}`);
      }
    }
    for (const target of extractMarkdownLinkTargets(body)) {
      checkBodyLinkTarget(project, label2, target, errors);
    }
  }
}
function checkBodyLinkTarget(project, label2, target, errors) {
  const cleaned = String(target).trim();
  if (!cleaned || /^(https?:|mailto:|#)/i.test(cleaned)) {
    return;
  }
  const pathOnly = cleaned.split("#")[0].split("?")[0];
  const base = path4.basename(pathOnly);
  if (!base.endsWith(".md")) {
    return;
  }
  const id = base.slice(0, -3);
  if (!id || id === "_index" || id.includes("*")) {
    return;
  }
  if (id !== kebabCase(id)) {
    errors.push(`${label2} links to ${cleaned} which must be kebab-case`);
    return;
  }
  const resolved = path4.resolve(path4.dirname(path4.join(project.root, label2)), pathOnly);
  if (!isPathInside2(path4.resolve(project.root), resolved) || !fs2.existsSync(resolved) || !fs2.statSync(resolved).isFile()) {
    errors.push(`${label2} links to missing file ${cleaned}`);
    return;
  }
  if (!isPathInside2(fs2.realpathSync(project.root), fs2.realpathSync(resolved))) {
    errors.push(`${label2} links to ${cleaned} which resolves outside the project`);
    return;
  }
  const known = new Set;
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
    errors.push(`${label2} links to missing file ${cleaned}`);
  }
}
function checkProjectContinuity(root) {
  return checkContinuity(scanProject(root));
}
function knowledgeAtChapter(root, characterId, atChapterId) {
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
    if (!stateError && String(error).startsWith(`${path4.join("continuity", "state.md")}:`)) {
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
    const learnedIn = entry["learned-in"] === undefined || entry["learned-in"] === null || entry["learned-in"] === "" ? "" : String(entry["learned-in"]);
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
function seriesReport(root) {
  const projectRoot = path4.resolve(root);
  requireStoryFile(projectRoot);
  return buildSeries(projectRoot, scanProject);
}
function projectReport(root) {
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
function formatProjectReport(report, options = {}) {
  const lines = [
    `# ${report.title}`,
    "",
    `Story ID: ${report.storyId}`,
    `Schema version: ${report.schemaVersion}`,
    ...report.series === undefined ? [] : [`Series: ${report.series}${report.bookNumber === undefined ? "" : ` (book ${report.bookNumber})`}`],
    `Status: ${report.status}`,
    `Genre: ${[report.genre, report.subGenre].filter(Boolean).join(" / ")}`,
    ...report.form ? [`Form: ${report.form}`] : [],
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
    ...report.counts.research === 0 ? [] : [`- Research notes: ${report.counts.research}`],
    `- Total words: ${report.counts.words}`,
    ...report.targetWords > 0 ? [`- Target words: ${report.targetWords} (${Math.round(report.counts.words * 100 / report.targetWords)}%)`] : [],
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
  lines.push("", "Checks:", `- Validate: ${formatCheck(report.validation)}`, `- Links: ${formatCheck(report.links)}`, `- Continuity: ${formatCheck(report.continuity)}`);
  if (options.actionable) {
    lines.push("", "Next Actions:");
    appendActionLines(lines, report.actions);
  }
  return `${lines.join(`
`)}
`;
}
function projectActions(root) {
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
function formatActionReport(report) {
  const lines = [
    `# Next Writing Actions: ${report.title}`,
    "",
    `Checks: validate ${formatCheck(report.validation)}, links ${formatCheck(report.links)}, continuity ${formatCheck(report.continuity)}`,
    "",
    "Actions:"
  ];
  appendActionLines(lines, report.actions);
  return `${lines.join(`
`)}
`;
}
function formatDoctorReport(report) {
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
  return `${lines.join(`
`)}
`;
}
function reindexProject(root) {
  const project = scanProject(root);
  const changed = [];
  const charactersIndexPath = path4.join(project.root, "characters", "_index.md");
  const worldIndexPath = path4.join(project.root, "worldbuilding", "_index.md");
  const plotIndexPath = path4.join(project.root, "plot", "_index.md");
  const chaptersIndexPath = path4.join(project.root, "chapters", "_index.md");
  const scenesIndexPath = path4.join(project.root, "scenes", "_index.md");
  const questionsIndexPath = path4.join(project.root, "continuity", "questions", "_index.md");
  const promisesIndexPath = path4.join(project.root, "continuity", "promises", "_index.md");
  const cluesIndexPath = path4.join(project.root, "continuity", "clues", "_index.md");
  const glossaryIndexPath = path4.join(project.root, "glossary", "_index.md");
  const existingCharacters = safeRead(charactersIndexPath, project.root);
  const existingWorld = safeRead(worldIndexPath, project.root);
  const existingPlot = safeRead(plotIndexPath, project.root);
  let plotStructure = "three-act";
  if (fs2.existsSync(plotIndexPath)) {
    plotStructure = parseFrontmatter(existingPlot, "plot/_index.md").data.structure ?? "three-act";
  }
  writeChanged(charactersIndexPath, characterIndex(project.storyId, project.characters, extractSection(existingCharacters, "Relationship Map"), extractSection(existingCharacters, "Family Trees")), changed, project.root);
  writeChanged(worldIndexPath, worldIndex(project.storyId, project.locations, project.systems, project.factions, project.artifacts, extractSection(existingWorld, "World Overview")), changed, project.root);
  writeChanged(plotIndexPath, plotIndex(project.storyId, plotStructure, project.arcs, extractSection(existingPlot, "Story Structure"), extractSection(existingPlot, "Theme Tracking")), changed, project.root);
  writeChanged(chaptersIndexPath, chapterIndex(project.storyId, project.chapters), changed, project.root);
  writeChanged(scenesIndexPath, sceneIndex(project.storyId, project.scenes), changed, project.root);
  writeChanged(questionsIndexPath, questionIndex(project.storyId, project.questions), changed, project.root);
  writeChanged(promisesIndexPath, promiseIndex(project.storyId, project.promises), changed, project.root);
  writeChanged(cluesIndexPath, clueIndex(project.storyId, project.clues), changed, project.root);
  writeChanged(glossaryIndexPath, glossaryIndex(project.storyId, project.glossaryTerms), changed, project.root);
  if (fs2.existsSync(path4.join(project.root, MATTER_DIR))) {
    writeChanged(path4.join(project.root, MATTER_DIR, "_index.md"), matterIndex(project.storyId, project.matter), changed, project.root);
  }
  if (fs2.existsSync(path4.join(project.root, RESEARCH_DIR))) {
    writeChanged(path4.join(project.root, RESEARCH_DIR, "_index.md"), researchIndex(project.storyId, project.research), changed, project.root);
  }
  refreshStoryField(path4.join(project.root, "plot", "timeline.md"), project.storyId, changed, project.root);
  refreshStoryField(path4.join(project.root, "continuity", "state.md"), project.storyId, changed, project.root);
  return { changed };
}
function refreshStoryField(filePath, storyId, changed, root) {
  if (!fs2.existsSync(filePath)) {
    return;
  }
  let raw;
  try {
    raw = fs2.readFileSync(filePath, "utf8");
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
function computeWordCounts(root, options = {}) {
  const project = scanProject(root);
  const chapters = [];
  for (const chapter of project.chapters) {
    chapters.push({
      number: chapter.number,
      title: chapter.title,
      file: path4.relative(project.root, chapter.file),
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
function compareProject(root, options = {}) {
  const hasRef = typeof options.ref === "string" && options.ref !== "";
  const hasAgainst = typeof options.against === "string" && options.against !== "";
  if (hasRef === hasAgainst) {
    throw new Error("compare needs exactly one of --ref <git-ref> or --against <project-path>");
  }
  const project = scanProject(root);
  const current = project.chapters.map((chapter) => comparableChapter(chapter.id, readMarkdown(chapter.file, project.root)));
  let previous;
  let label2;
  if (hasRef) {
    previous = chaptersAtGitRef(project.root, options.ref);
    label2 = `git ref ${options.ref}`;
  } else {
    const otherRoot = path4.resolve(options.cwd ?? process.cwd(), options.against);
    const other = scanProject(otherRoot);
    if (other.fileErrors.length > 0) {
      throw new Error(`Cannot read ${otherRoot}: ${other.fileErrors[0]}`);
    }
    previous = other.chapters.map((chapter) => comparableChapter(chapter.id, readMarkdown(chapter.file, other.root)));
    label2 = otherRoot;
  }
  return {
    ok: project.fileErrors.length === 0,
    errors: [...project.fileErrors],
    warnings: [],
    label: label2,
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
var GIT_REF_PATTERN = /^[A-Za-z0-9._/@{}~^][A-Za-z0-9._/@{}~^-]*$/;
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
  const names = git(["ls-tree", "--name-only", ref, "--", "chapters/"]).split(`
`).map((name) => path4.posix.basename(name.trim())).filter((name) => CHAPTER_FILENAME_PATTERN.test(name)).sort();
  return names.map((name) => {
    const id = path4.basename(name, ".md");
    const raw = git(["show", `${ref}:${prefix}chapters/${name}`]);
    try {
      return comparableChapter(id, parseFrontmatter(raw, name));
    } catch {
      return comparableChapter(id, { data: {}, body: raw });
    }
  });
}
function projectProgress(root, options = {}) {
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
    const logErrors = [];
    validateProgressLog(project, logErrors);
    if (logErrors.length > 0) {
      throw new Error(`Cannot log progress until ${PROGRESS_FILE} is fixed: ${logErrors.join("; ")}`);
    }
    const filePath = path4.join(project.root, PROGRESS_FILE);
    const existing = project.progressLog;
    const sessions = withSession(cleanSessions(existing?.data.sessions), today, words);
    const contents = existing === null ? progressLogFile(sessions) : replaceFrontmatter(existing.rawMarkdown, { ...existing.data, sessions });
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
function storyTimeline(root) {
  const project = scanProject(root);
  return {
    ok: project.fileErrors.length === 0,
    errors: [...project.fileErrors],
    warnings: [],
    totalChapters: project.chapters.length,
    ...buildTimeline(project)
  };
}
function clueReport(root) {
  const project = scanProject(root);
  const matrix = buildClueMatrix(project);
  return { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], ...matrix };
}
function diagramProject(root, options = {}) {
  const project = scanProject(root);
  const text = buildDiagram(project, options.kind);
  const result = { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], warnings: [], text };
  if (options.out === undefined || !result.ok) {
    return result;
  }
  const output = resolveOutputPath(project, options.out, "");
  writeFile(output.outFile, text, output.writeOptions);
  return { ...result, outFile: output.outFile };
}
function projectPasses(root, change = {}) {
  const project = scanProject(root);
  const storyPath = path4.join(project.root, "story.md");
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
  const raw = safeRead(storyPath, project.root);
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  if (changed) {
    writeFile(storyPath, replaceFrontmatter(raw, { ...parseFrontmatter(raw, storyPath).data, "revision-passes": next }), { root: project.root });
  }
  return { passes: readPasses({ "revision-passes": next }), changed };
}
function namesReport(root, candidates) {
  const list = asArray(candidates).map((name) => String(name).trim()).filter(Boolean);
  if (list.length === 0) {
    throw new Error("Usage: story names <name...> [--path <project>]");
  }
  const project = scanProject(root);
  const result = checkNames(list, existingNames(project));
  const errors = [...project.fileErrors, ...result.errors];
  return { ok: errors.length === 0, errors, warnings: result.warnings, results: result.results };
}
function voicesReport(root) {
  const project = scanProject(root);
  const chapters = project.chapters.map((chapter) => ({
    id: chapter.id,
    paragraphs: proseParagraphs(chapterProse(readMarkdown(chapter.file, project.root).body))
  }));
  return { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], ...buildVoices(project, chapters) };
}
function pacingReport(root) {
  const project = scanProject(root);
  return { ok: project.fileErrors.length === 0, errors: [...project.fileErrors], ...buildPacing(project) };
}
function proseReport(root) {
  const project = scanProject(root);
  const errors = [...project.fileErrors];
  const warnings = [];
  const rules = proseRules(project.styleSheet?.data, project.characters.map((character) => character.name));
  const chapters = [];
  for (const chapter of project.chapters) {
    const label2 = relative2(project, chapter.file);
    const analysis = analyzeChapter(chapterProse(readMarkdown(chapter.file, project.root).body), rules);
    chapters.push({ file: label2, title: chapter.title, analysis });
    warnings.push(...chapterFindings(label2, analysis));
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
function exportManuscript(root, options = {}) {
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
  writeFile(output.outFile, `${lines.join(`
`).trimEnd()}
`, output.writeOptions);
  return { outFile: output.outFile, chapters: project.chapters.length };
}
function buildBook(root, options = {}) {
  const format = normalizeBuildFormat(options.format ?? "markdown");
  const project = scanProject(root);
  const extension = BUILD_EXTENSIONS[format];
  const output = resolveOutputPath(project, options.out, path4.join("dist", `${project.storyId}.${extension}`));
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
      hasCopyrightPage: manuscript.front.concat(manuscript.back).some((entry) => entry.copyright)
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
function synopsisBook(root, options = {}) {
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
  const output = resolveOutputPath(project, options.out, path4.join("dist", `${project.storyId}.synopsis.md`));
  writeFile(output.outFile, text, output.writeOptions);
  return { text, outFile: output.outFile };
}
function synopsisPremise(project) {
  const sentences = splitSentences2(extractSection(project.story.body, "Synopsis"));
  return sentences.length > 0 ? sentences[0] : "No premise recorded.";
}
function splitSentences2(text) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (normalized === "") {
    return [];
  }
  const sentences = [];
  let start = 0;
  for (let index = 0;index < normalized.length; index += 1) {
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
  return splitSentences2(text).slice(0, count);
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
  return `${lines.join(`
`).trimEnd()}
`;
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
  return `${kept.join(" ")}…
`;
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
function migrateProject(root) {
  const projectRoot = path4.resolve(root);
  const storyPath = requireStoryFile(projectRoot);
  const story = readMarkdown(storyPath, projectRoot);
  const storyId = kebabCase(story.data.title ?? path4.basename(projectRoot));
  const changed = [];
  for (const directory of [
    path4.join("worldbuilding", "factions"),
    path4.join("worldbuilding", "artifacts"),
    "scenes",
    path4.join("continuity", "questions"),
    path4.join("continuity", "promises"),
    path4.join("continuity", "clues"),
    path4.join("glossary", "terms")
  ]) {
    ensureDirectory(path4.join(projectRoot, directory), changed, projectRoot);
  }
  ensureFile(path4.join(projectRoot, "scenes", "_index.md"), sceneIndex(storyId, []), changed, projectRoot);
  ensureFile(path4.join(projectRoot, "continuity", "state.md"), continuityState(storyId), changed, projectRoot);
  ensureFile(path4.join(projectRoot, "continuity", "questions", "_index.md"), questionIndex(storyId, []), changed, projectRoot);
  ensureFile(path4.join(projectRoot, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), changed, projectRoot);
  ensureFile(path4.join(projectRoot, "continuity", "clues", "_index.md"), clueIndex(storyId, []), changed, projectRoot);
  ensureFile(path4.join(projectRoot, "glossary", "_index.md"), glossaryIndex(storyId, []), changed, projectRoot);
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
var ENTITY_ENUM_OPTIONS = {
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
function createEntity(root, options) {
  const project = scanProject(root);
  const kind = normalizeKind(options.kind);
  requireEntityEnumOptions(kind, options);
  const name = String(options.name ?? "").trim();
  if (!name) {
    throw new Error(`A ${kind} name is required`);
  }
  const entity = buildEntity(project, kind, name, options);
  if (fs2.existsSync(entity.file)) {
    throw new Error(`${relative2(project, entity.file)} already exists`);
  }
  writeFile(entity.file, entity.markdown, { root: project.root });
  applyEntityBacklinks(project.root, kind, entity.id, readMarkdown(entity.file, project.root).data);
  const reindexed = reindexProject(project.root);
  return { kind, id: entity.id, file: entity.file, changed: [entity.file].concat(reindexed.changed) };
}
function renameEntity(root, options) {
  const project = scanProject(root);
  const kind = normalizeKind(options.kind);
  const oldId = String(options.id ?? "").trim();
  const name = String(options.name ?? "").trim();
  if (!oldId || !name) {
    throw new Error("rename requires an entity id and a new name");
  }
  const config = entityConfig(kind);
  const oldFile = path4.join(project.root, config.dir, `${oldId}.md`);
  requireKebabId(oldId, `${kind} id`);
  assertSafeProjectPath(oldFile, project.root);
  if (!fs2.existsSync(oldFile)) {
    throw new Error(`${kind} ${oldId} does not exist`);
  }
  const markdown = readMarkdown(oldFile, project.root);
  const newId = kind === "chapter" || kind === "scene" ? oldId : kebabCase(name);
  if (!isKebabId2(newId)) {
    throw new Error(`Cannot derive a kebab-case id from ${kind} name "${name}"`);
  }
  const newFile = path4.join(project.root, config.dir, `${newId}.md`);
  assertSafeProjectPath(newFile, project.root);
  if (newFile !== oldFile && fs2.existsSync(newFile)) {
    throw new Error(`${kind} ${newId} already exists`);
  }
  const data = { ...markdown.data, [config.titleField]: name };
  const retitled = replaceFrontmatter(markdown.rawMarkdown, data);
  if (newFile === oldFile) {
    writeFile(oldFile, retitled, { root: project.root });
  } else {
    const plan = replaceEntityReferences(project.root, kind, oldId, newId, new Map([[oldFile, retitled]]));
    const renamedContents = plan.get(oldFile);
    plan.delete(oldFile);
    writeFile(newFile, renamedContents, { root: project.root });
    fs2.rmSync(oldFile);
    writeReferencePlan(project.root, plan);
  }
  const reindexed = reindexProject(project.root);
  return { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed) };
}
function removeEntity(root, options) {
  const project = scanProject(root);
  const kind = normalizeKind(options.kind);
  const id = String(options.id ?? "").trim();
  if (!id) {
    throw new Error("remove requires an entity id");
  }
  const config = entityConfig(kind);
  const file = path4.join(project.root, config.dir, `${id}.md`);
  requireKebabId(id, `${kind} id`);
  assertSafeProjectPath(file, project.root);
  if (!fs2.existsSync(file)) {
    throw new Error(`${kind} ${id} does not exist`);
  }
  const plan = removeEntityReferences(project.root, kind, id, new Map([[file, null]]));
  fs2.rmSync(file);
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
  const rows = characters.length === 0 ? ["| *No characters yet* | | | |"] : characters.map((character) => `| ${character.name} | ${character.role} | ${character.status} | [${character.id}](${character.id}.md) |`);
  return `${stringifyFrontmatter({ type: "character-registry", story: storyId })}# Characters

## Registry

| Name | Role | Status | File |
|------|------|--------|------|
${rows.join(`
`)}

## Relationship Map

${relationshipMap || "*No relationships defined yet.*"}

## Family Trees

${familyTrees || "*No family trees defined yet.*"}
`;
}
function worldIndex(storyId, locations, systems, factions, artifacts, overview) {
  const locationRows = locations.length === 0 ? ["| *No locations yet* | | | |"] : locations.map((location) => `| ${location.name} | ${titleCaseSlug(location.type)} | ${location.region} | [${location.id}](locations/${location.id}.md) |`);
  const systemRows = systems.length === 0 ? ["| *No systems yet* | | |"] : systems.map((system) => `| ${system.name} | ${titleCaseSlug(system.type)} | [${system.id}](systems/${system.id}.md) |`);
  const factionRows = factions.length === 0 ? ["| *No factions yet* | | | |"] : factions.map((faction) => `| ${faction.name} | ${titleCaseSlug(faction.type)} | ${faction.status} | [${faction.id}](factions/${faction.id}.md) |`);
  const artifactRows = artifacts.length === 0 ? ["| *No artifacts yet* | | | |"] : artifacts.map((artifact) => `| ${artifact.name} | ${titleCaseSlug(artifact.type)} | ${artifact.status} | [${artifact.id}](artifacts/${artifact.id}.md) |`);
  return `${stringifyFrontmatter({ type: "world-registry", story: storyId })}# Worldbuilding

## World Overview

${overview || "*Describe the world at a high level here.*"}

## Locations

| Name | Type | Region | File |
|------|------|--------|------|
${locationRows.join(`
`)}

## Systems

| Name | Type | File |
|------|------|------|
${systemRows.join(`
`)}

## Factions

| Name | Type | Status | File |
|------|------|--------|------|
${factionRows.join(`
`)}

## Artifacts

| Name | Type | Status | File |
|------|------|--------|------|
${artifactRows.join(`
`)}
`;
}
function plotIndex(storyId, structure, arcs, storyStructure, themeTracking) {
  const arcRows = arcs.length === 0 ? ["| *No arcs yet* | | | |"] : arcs.map((arc) => `| ${arc.name} | ${arc.type} | ${arc.status} | [${arc.id}](arcs/${arc.id}.md) |`);
  return `${stringifyFrontmatter({ type: "plot-registry", story: storyId, structure })}# Plot Structure

## Story Structure

${storyStructure || "**Model:** Three-Act Structure (adjust as needed)"}

## Arcs

| Name | Type | Status | File |
|------|------|--------|------|
${arcRows.join(`
`)}

## Theme Tracking

${themeTracking || `| Theme | Arcs | Chapters |
|-------|------|----------|
| *No themes tracked yet* | | |`}
`;
}
function chapterIndex(storyId, chapters) {
  const rows = chapters.length === 0 ? ["| *No chapters yet* | | | | | |"] : chapters.map((chapter) => `| ${chapter.number} | ${chapter.title} | ${chapter.pov} | ${chapter.status} | ${chapter.wordCount} | [${chapter.id}](${path4.basename(chapter.file)}) |`);
  const total2 = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  return `${stringifyFrontmatter({ type: "chapter-registry", story: storyId })}# Chapters

## Registry

| # | Title | POV | Status | Word Count | File |
|---|-------|-----|--------|------------|------|
${rows.join(`
`)}

## Total Word Count: ${total2}
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
  const rows = scenes.length === 0 ? ["| *No scenes yet* | | | | | |"] : scenes.map((scene) => `| ${scene.chapter} | ${scene.scene} | ${scene.title} | ${scene.pov} | ${scene.status} | [${scene.id}](${scene.id}.md) |`);
  return `${stringifyFrontmatter({ type: "scene-registry", story: storyId })}# Scenes

## Registry

| Chapter | Scene | Title | POV | Status | File |
|---------|-------|-------|-----|--------|------|
${rows.join(`
`)}
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
  const rows = questions.length === 0 ? ["| *No questions yet* | | | |"] : questions.map((question) => `| ${question.title} | ${question.status} | ${question.introduced} | [${question.id}](${question.id}.md) |`);
  return `${stringifyFrontmatter({ type: "question-registry", story: storyId })}# Continuity Questions

## Registry

| Question | Status | Introduced | File |
|----------|--------|------------|------|
${rows.join(`
`)}
`;
}
function promiseIndex(storyId, promises) {
  const rows = promises.length === 0 ? ["| *No promises yet* | | | |"] : promises.map((promise) => `| ${promise.title} | ${promise.status} | ${promise.planted} | [${promise.id}](${promise.id}.md) |`);
  return `${stringifyFrontmatter({ type: "promise-registry", story: storyId })}# Promises And Payoffs

## Registry

| Promise | Status | Planted | File |
|---------|--------|---------|------|
${rows.join(`
`)}
`;
}
function clueIndex(storyId, clues) {
  const rows = clues.length === 0 ? ["| *No clues yet* | | | |"] : clues.map((clue) => `| ${clue.title} | ${clue.status} | ${clue.planted} | [${clue.id}](${clue.id}.md) |`);
  return `${stringifyFrontmatter({ type: "clue-registry", story: storyId })}# Clue Ledger

## Registry

| Clue | Status | Planted | File |
|------|--------|---------|------|
${rows.join(`
`)}
`;
}
function glossaryIndex(storyId, terms) {
  const rows = terms.length === 0 ? ["| *No terms yet* | | |"] : terms.map((term) => `| ${term.term} | ${term.category} | [${term.id}](terms/${term.id}.md) |`);
  return `${stringifyFrontmatter({ type: "glossary-registry", story: storyId })}# Glossary

## Registry

| Term | Category | File |
|------|----------|------|
${rows.join(`
`)}
`;
}
function matterIndex(storyId, pages) {
  const rows = pages.length === 0 ? ["| *No matter pages yet* | | | |"] : pages.map((page) => `| ${page.title} | ${page.placement} | ${page.order} | [${page.id}](${page.id}.md) |`);
  return `${stringifyFrontmatter({ type: "matter-registry", story: storyId })}# Front And Back Matter

## Registry

| Title | Placement | Order | File |
|-------|-----------|-------|------|
${rows.join(`
`)}
`;
}
function researchIndex(storyId, notes) {
  const rows = notes.length === 0 ? ["| *No research notes yet* | | | |"] : notes.map((note) => `| ${note.title} | ${note.status} | ${note.usedIn.join(", ")} | [${note.id}](${note.id}.md) |`);
  return `${stringifyFrontmatter({ type: "research-registry", story: storyId })}# Research

## Registry

| Title | Status | Used In | File |
|-------|--------|---------|------|
${rows.join(`
`)}
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
  const nextLabel = activeArcNames.length > 0 ? `advance ${activeArcNames.join(", ")}` : "establish the next story beat";
  actions.push(action("P2", `Draft chapter ${nextNumber}`, `Use story add chapter "Chapter ${nextNumber}" --number ${nextNumber}, then outline scenes to ${nextLabel}.`));
  if (project.characters.length === 0) {
    actions.push(action("P2", "Create first character", 'Use story add character "Name" --role protagonist before drafting prose.'));
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
    const number = options.number === undefined ? project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0) + 1 : requirePositiveInteger(options.number, "chapter number");
    const id2 = `chapter-${String(number).padStart(2, "0")}`;
    return entityResult(project, kind, id2, chapterFile(name, number, options));
  }
  if (kind === "scene") {
    const chapter = String(options.chapter ?? project.chapters.at(-1)?.id ?? "chapter-01").trim();
    requireKebabId(chapter, "chapter id");
    const scene = options.scene === undefined ? nextSceneNumber(project, chapter) : requirePositiveInteger(options.scene, "scene number");
    const id2 = `${chapter}-scene-${String(scene).padStart(2, "0")}`;
    return entityResult(project, kind, id2, sceneFile(name, chapter, scene, options));
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
  return { id, markdown, file: path4.join(project.root, config.dir, `${id}.md`) };
}
function entityConfig(kind) {
  const configs = {
    character: { dir: "characters", titleField: "name" },
    location: { dir: path4.join("worldbuilding", "locations"), titleField: "name" },
    system: { dir: path4.join("worldbuilding", "systems"), titleField: "name" },
    faction: { dir: path4.join("worldbuilding", "factions"), titleField: "name" },
    artifact: { dir: path4.join("worldbuilding", "artifacts"), titleField: "name" },
    arc: { dir: path4.join("plot", "arcs"), titleField: "name" },
    chapter: { dir: "chapters", titleField: "title" },
    scene: { dir: "scenes", titleField: "title" },
    question: { dir: path4.join("continuity", "questions"), titleField: "title" },
    promise: { dir: path4.join("continuity", "promises"), titleField: "title" },
    clue: { dir: path4.join("continuity", "clues"), titleField: "title" },
    term: { dir: path4.join("glossary", "terms"), titleField: "term" },
    matter: { dir: MATTER_DIR, titleField: "title" },
    research: { dir: RESEARCH_DIR, titleField: "title" }
  };
  const config = configs[kind];
  if (!config) {
    throw new Error(`Unsupported entity kind: ${kind}`);
  }
  return config;
}
var KIND_ALIASES = {
  character: "character",
  characters: "character",
  location: "location",
  locations: "location",
  system: "system",
  systems: "system",
  faction: "faction",
  factions: "faction",
  artifact: "artifact",
  artifacts: "artifact",
  arc: "arc",
  arcs: "arc",
  chapter: "chapter",
  chapters: "chapter",
  scene: "scene",
  scenes: "scene",
  question: "question",
  questions: "question",
  promise: "promise",
  promises: "promise",
  clue: "clue",
  clues: "clue",
  term: "term",
  terms: "term",
  "glossary-term": "term",
  "glossary-terms": "term",
  glossary: "term",
  matter: "matter",
  research: "research",
  "research-note": "research",
  "research-notes": "research"
};
function normalizeKind(kind) {
  const normalized = String(kind ?? "").trim().toLowerCase();
  return KIND_ALIASES[normalized] ?? normalized;
}
function requireKebabId(id, label2) {
  if (!isKebabId2(id)) {
    throw new Error(`${label2} must be a kebab-case id`);
  }
}
function requirePositiveInteger(value, label2) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label2} must be a positive integer`);
  }
  return number;
}
function isKebabId2(value) {
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
    ...options.hook === undefined ? {} : { hook: options.hook },
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
    ...options.outcome === undefined ? {} : { outcome: options.outcome },
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
    ...options["red-herring"] ? { "red-herring": true } : {},
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
  return project.scenes.filter((scene) => scene.chapter === chapter).reduce((max, scene) => Math.max(max, scene.scene), 0) + 1;
}
function ensureDirectory(directory, changed, root) {
  if (!fs2.existsSync(directory)) {
    assertLexicallyInsideRoot(directory, root);
    assertExistingAncestorInsideRoot(directory, root);
    fs2.mkdirSync(directory, { recursive: true });
    assertSafeProjectDirectory(directory, root);
    changed.push(directory);
    return;
  }
  assertSafeProjectDirectory(directory, root);
}
function ensureFile(filePath, contents, changed, root) {
  if (!fs2.existsSync(filePath)) {
    writeFile(filePath, contents, { root });
    changed.push(filePath);
    return;
  }
  assertSafeProjectPath(filePath, root);
}
var REFERENCE_FIELD_KINDS = {
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
var ENTRY_IDENTITY_FIELDS = {
  relationships: "character",
  "character-state": "character",
  "knowledge-state": "character",
  "object-state": "artifact",
  routes: "to"
};
function entityReferenceContext(root, kind, id) {
  const otherExists = new Map;
  const existsAs = (other) => {
    if (!otherExists.has(other)) {
      otherExists.set(other, fs2.existsSync(path4.join(root, entityConfig(other).dir, `${id}.md`)));
    }
    return otherExists.get(other);
  };
  return {
    id,
    kind,
    entityFile: path4.resolve(root, entityConfig(kind).dir, `${id}.md`),
    isReferenceKey: (key) => {
      const kinds = Object.hasOwn(REFERENCE_FIELD_KINDS, key) ? REFERENCE_FIELD_KINDS[key] : [];
      return kinds.includes(kind) && !kinds.some((other) => other !== kind && existsAs(other));
    }
  };
}
function resolveLinkTarget(root, file, target) {
  const cleaned = String(target).trim().split(/\s+/)[0].replace(/^<|>$/g, "").split("#")[0].split("?")[0];
  if (cleaned === "" || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(cleaned)) {
    return null;
  }
  let decoded = cleaned;
  try {
    decoded = decodeURIComponent(cleaned);
  } catch {
    decoded = cleaned;
  }
  return decoded.startsWith("/") ? path4.resolve(root, `.${decoded}`) : path4.resolve(path4.dirname(file), decoded);
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
  return planReferenceRewrites(root, context, overrides, (value) => value === oldId ? newId : value, (body, file) => renameLinkTargets(root, file, body, context, newId));
}
function removeEntityReferences(root, kind, id, overrides) {
  const context = entityReferenceContext(root, kind, id);
  return planReferenceRewrites(root, context, overrides, (value) => value === id ? null : value, (body) => body);
}
function planReferenceRewrites(root, context, overrides, transform, transformBody) {
  const plan = new Map;
  const storyFile = path4.join(root, "story.md");
  for (const file of markdownFiles(root)) {
    const override = overrides?.has(file) ? overrides.get(file) : undefined;
    if (override === null) {
      continue;
    }
    let text = override;
    if (text === undefined) {
      assertSafeProjectPath(file, root);
      assertFileSizeWithinLimit(file);
      text = fs2.readFileSync(file, "utf8");
    }
    const match = FRONTMATTER_PATTERN.exec(text);
    let header = "";
    let body = text;
    if (match) {
      header = match[0];
      body = text.slice(match[0].length);
      if (file !== storyFile) {
        let data;
        try {
          data = parseFrontmatter(text, file).data;
        } catch (error) {
          throw new Error(`${path4.relative(root, file)}: ${error.message}; nothing was changed`);
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
  const isReference = (key) => context.isReferenceKey(key) || key === "to" && identityKey === "to" && context.kind === "location";
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
      if (isKebabId2(characterId)) {
        addFrontmatterListValue(root, path4.join("characters", `${characterId}.md`), "locations", id);
      }
    }
  }
  if (kind === "character") {
    for (const locationId of asArray(data.locations)) {
      if (isKebabId2(locationId)) {
        addFrontmatterListValue(root, path4.join("worldbuilding", "locations", `${locationId}.md`), "notable-characters", id);
      }
    }
  }
}
function addFrontmatterListValue(root, relativePath, field, value) {
  const filePath = path4.join(root, relativePath);
  if (!fs2.existsSync(filePath) || !value) {
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
    throw new Error("Refusing to scan beyond depth " + MAX_SCAN_DEPTH + " under " + root);
  }
  for (const entry of fs2.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path4.join(root, entry.name);
    if (entry.isDirectory() && entry.name !== "dist" && !entry.name.startsWith(".")) {
      markdownFiles(fullPath, depth + 1, files);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
      if (files.length > MAX_SCAN_FILES) {
        throw new Error("Too many markdown files under " + root + ": exceeds the " + MAX_SCAN_FILES + " file limit");
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
  const seenNumbers = new Set;
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
  for (const entry of project.matter) {
    if (!isKebabId2(entry.id)) {
      throw new Error(`${relative2(project, entry.file)}: matter file names must be kebab-case to build`);
    }
  }
  const matter = (placement) => project.matter.filter((entry) => entry.placement === placement && !entry.empty).map((entry) => ({
    id: entry.id,
    title: entry.title,
    heading: entry.heading,
    copyright: isCopyrightMatter(entry),
    body: chapterProse(readMarkdown(entry.file, project.root).body).trim()
  }));
  const meta = publishingMeta(project.story.data);
  const front = matter("front");
  const back = matter("back");
  const hasCopyrightPage = [...front, ...back].some((entry) => entry.copyright);
  if (meta.copyright !== "" && !hasCopyrightPage) {
    front.unshift({ id: "copyright", title: "Copyright", heading: false, copyright: true, body: copyrightPage(meta) });
  }
  return {
    title: project.story.data.title,
    author: meta.authors.join(" and "),
    meta,
    front,
    chapters,
    back
  };
}
function isCopyrightMatter(entry) {
  return entry.id === "copyright" || /copyright/i.test(entry.title);
}
function epubModifiedTimestamp() {
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
    coverEntries.push({ name: `OEBPS/${href}`, content: fs2.readFileSync(manuscript.cover.filePath) }, { name: "OEBPS/cover.xhtml", content: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><title>${xmlEscape(manuscript.title)}</title></head><body epub:type="cover"><img src="${href}" alt="${xmlEscape(alt)}"/></body></html>` });
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
  const landmarks = start ? `<nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="bodymatter" href="${start.id}.xhtml">Start of Content</a></li></ol></nav>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><title>${xmlEscape(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${links.join("")}</ol></nav>${landmarks}</body></html>`;
}
function epubAccessibilityMeta(hasCover) {
  const features = ["tableOfContents", "readingOrder", "structuralNavigation", ...hasCover ? ["alternativeText"] : []];
  const summary = hasCover ? "Text book with a described cover image, a navigable table of contents, headings for each chapter, and a single logical reading order." : "Text-only book with a navigable table of contents, headings for each chapter, and a single logical reading order.";
  return [
    `<meta property="schema:accessMode">textual</meta>`,
    ...hasCover ? [`<meta property="schema:accessMode">visual</meta>`] : [],
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
  const bodyType = entry.copyright ? `${placement}matter copyright-page` : `${placement}matter`;
  return xhtmlDocument(entry.title, lang, bodyType, `${heading}${xhtmlParagraphs(entry.body)}`);
}
function htmlBook(manuscript) {
  const paragraphs = (body) => markdownParagraphs(body).map((paragraph) => paragraph === "* * *" ? null : inlineRuns(paragraph).map((run) => run.style ? `<${run.style}>${escapeHtml(run.text)}</${run.style}>` : escapeHtml(run.text)).join(""));
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
var SHUNN_RUN_FONTS = `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/>`;
var SHUNN_PARAGRAPH_SPACING = `<w:spacing w:line="480" w:lineRule="auto"/>`;
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
  writeFile(outFile, `${lines.join(`
`).trimEnd()}
`, writeOptions);
}
function paragraphXml(text, style = "", runs = [{ text, style: "" }]) {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  const runXml = runs.map((run) => {
    const runStyle = run.style === "strong" ? "<w:rPr><w:b/></w:rPr>" : run.style === "em" ? "<w:rPr><w:i/></w:rPr>" : "";
    return `<w:r>${runStyle}<w:t xml:space="preserve">${xmlEscape(run.text)}</w:t></w:r>`;
  });
  return `<w:p>${styleXml}${runXml.join("")}</w:p>`;
}
var INLINE_EMPHASIS_PATTERN = /(\*\*|__)(\S(?:[\s\S]*?\S)?)\1|(\*|_)(\S(?:[^*_]*?\S)?)\3/g;
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
var SCENE_BREAK_PATTERN = /^([*_-])( ?\1){2,}$/;
function markdownParagraphs(markdown) {
  const paragraphs = [];
  for (const paragraph of markdown.replace(/\r\n?/g, `
`).replace(/^#+[ \t]+/gm, "").replace(/^[ \t]*>[ \t]?/gm, "").split(/\n[ \t]*\n\s*/)) {
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
    localHeader.writeUInt32LE(67324752, 0);
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
    centralHeader.writeUInt32LE(33639248, 0);
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
  end.writeUInt32LE(101010256, 0);
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
  let crc = 4294967295;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}
var CRC_TABLE = [];
for (let index = 0;index < 256; index += 1) {
  let value = index;
  for (let bit = 0;bit < 8; bit += 1) {
    value = value & 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
  }
  CRC_TABLE.push(value >>> 0);
}
function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
var MAX_SCAN_FILE_BYTES = 5 * 1024 * 1024;
var MAX_SCAN_FILES = 5000;
var MAX_SCAN_DEPTH = 10;
function assertFileSizeWithinLimit(filePath) {
  let size = 0;
  try {
    size = fs2.statSync(filePath).size;
  } catch {
    return;
  }
  if (size > MAX_SCAN_FILE_BYTES) {
    throw new Error("Refusing to read oversized file " + filePath + ": " + size + " bytes exceeds the " + MAX_SCAN_FILE_BYTES + " byte limit");
  }
}
function readEntityFiles(root, relativeDir, mapEntity, scanErrors) {
  const directory = path4.join(root, relativeDir);
  if (!fs2.existsSync(directory)) {
    return [];
  }
  assertSafeProjectDirectory(directory, root);
  const entities = [];
  const files = fs2.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "_index.md").map((entry) => entry.name).sort();
  if (files.length > MAX_SCAN_FILES) {
    throw new Error("Too many files in " + relativeDir + ": " + files.length + " exceeds the " + MAX_SCAN_FILES + " file limit");
  }
  for (const file of files) {
    const fullPath = path4.join(directory, file);
    const label2 = path4.join(relativeDir, file);
    try {
      const markdown = readMarkdown(fullPath, root);
      entities.push(mapEntity(path4.basename(file, ".md"), fullPath, markdown.data, markdown));
    } catch (error) {
      scanErrors.push(`${label2}: ${error.message}`);
    }
  }
  return entities;
}
function requireStoryFile(projectRoot) {
  const storyPath = path4.join(projectRoot, "story.md");
  if (!fs2.existsSync(storyPath)) {
    throw new Error(`${projectRoot} is not a story project: missing story.md`);
  }
  return storyPath;
}
function readExemptions(root) {
  const exemptionsPath = path4.join(root, "continuity", "exemptions.md");
  let raw;
  try {
    raw = fs2.readFileSync(exemptionsPath, "utf8");
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
    const pattern = entry && typeof entry === "object" && !Array.isArray(entry) ? String(entry.pattern ?? "").trim() : "";
    if (pattern === "" || pattern.length < 4) {
      continue;
    }
    exemptions.push({ pattern, reason: String(entry.reason ?? "") });
  }
  return exemptions;
}
function readOptionalRootFile(root, name, scanErrors) {
  const filePath = path4.join(root, name);
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
function readStyleSheet(root, scanErrors) {
  const filePath = path4.join(root, STYLE_SHEET_FILE);
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
  const rawMarkdown = fs2.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(rawMarkdown, filePath);
  return { ...parsed, rawMarkdown };
}
function writeFile(filePath, contents, options = {}) {
  const target = prepareWriteTarget(filePath, options.root);
  fs2.writeFileSync(target, contents, "utf8");
}
function writeChanged(filePath, contents, changed, root) {
  if (safeRead(filePath, root) !== contents) {
    writeFile(filePath, contents, { root });
    changed.push(filePath);
  }
}
function safeRead(filePath, root) {
  if (!fs2.existsSync(filePath)) {
    return "";
  }
  if (root) {
    assertSafeProjectPath(filePath, root);
  }
  assertFileSizeWithinLimit(filePath);
  return fs2.readFileSync(filePath, "utf8");
}
function readValidationData(file, root, label2, errors) {
  try {
    return readMarkdown(file, root).data;
  } catch (error) {
    const message = `${label2}: ${error.message}`;
    if (!errors.includes(message)) {
      errors.push(message);
    }
    return null;
  }
}
var ENTITY_SCAN_DIRS = [
  "characters",
  "chapters",
  "scenes",
  path4.join("worldbuilding", "locations"),
  path4.join("worldbuilding", "systems"),
  path4.join("worldbuilding", "factions"),
  path4.join("worldbuilding", "artifacts"),
  path4.join("plot", "arcs"),
  path4.join("continuity", "questions"),
  path4.join("continuity", "promises"),
  path4.join("continuity", "clues"),
  path4.join("glossary", "terms"),
  MATTER_DIR,
  RESEARCH_DIR
];
function collectStrayFileWarnings(project, warnings) {
  const root = project.root;
  const topEntries = fs2.readdirSync(root, { withFileTypes: true });
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
    const directory = path4.join(root, relativeDir);
    if (!fs2.existsSync(directory)) {
      continue;
    }
    for (const file of markdownFiles(directory)) {
      const relativePath = path4.relative(directory, file);
      if (relativePath.includes(path4.sep) || path4.dirname(relativePath) !== ".") {
        nested.push(path4.join(relativeDir, relativePath));
      }
    }
  }
  nested.sort();
  for (const nestedPath of nested) {
    warnings.push(`${nestedPath} is nested inside an entity directory and is ignored`);
  }
}
function checkIdReference(errors, label2, value, kind, exists) {
  const text = String(value ?? "");
  if (text === "") {
    return;
  }
  if (text !== kebabCase(text)) {
    errors.push(`${label2} references ${kind} ${text} which must be kebab-case`);
    return;
  }
  if (!exists(text)) {
    errors.push(`${label2} references missing ${kind} ${text}`);
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
  const outFile = path4.resolve(project.root, rawOut);
  const shouldEnforceRoot = enforceRoot ?? !path4.isAbsolute(String(rawOut));
  return {
    outFile,
    enforceRoot: shouldEnforceRoot,
    writeOptions: shouldEnforceRoot ? { root: project.root } : {}
  };
}
function prepareWriteTarget(filePath, root) {
  const target = path4.resolve(filePath);
  if (root) {
    assertLexicallyInsideRoot(target, root);
    assertExistingAncestorInsideRoot(path4.dirname(target), root);
  }
  fs2.mkdirSync(path4.dirname(target), { recursive: true });
  if (root) {
    assertSafeProjectParent(target, root);
  }
  rejectSymlinkTarget(target);
  return target;
}
function assertSafeProjectPath(filePath, root) {
  const target = path4.resolve(filePath);
  assertLexicallyInsideRoot(target, root);
  assertSafeProjectParent(target, root);
  rejectSymlinkTarget(target);
}
function assertSafeProjectDirectory(directory, root) {
  const target = path4.resolve(directory);
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
  const rootReal = fs2.realpathSync(path4.resolve(root));
  const directoryReal = fs2.realpathSync(target);
  if (!isPathInside2(rootReal, directoryReal)) {
    throw new Error(`Refusing to use project directory outside root: ${target}`);
  }
}
function assertSafeProjectParent(filePath, root) {
  const rootReal = fs2.realpathSync(path4.resolve(root));
  const parentReal = fs2.realpathSync(path4.dirname(path4.resolve(filePath)));
  if (!isPathInside2(rootReal, parentReal)) {
    throw new Error(`Refusing to access project path outside root: ${filePath}`);
  }
}
function assertExistingAncestorInsideRoot(target, root) {
  let current = path4.resolve(target);
  while (!lstatIfExists(current)) {
    const parent = path4.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  let rootReal;
  let currentReal;
  try {
    rootReal = fs2.realpathSync(path4.resolve(root));
    currentReal = fs2.realpathSync(current);
  } catch {
    throw new Error(`Refusing to access project path outside root: ${target}`);
  }
  if (!isPathInside2(rootReal, currentReal)) {
    throw new Error(`Refusing to access project path outside root: ${target}`);
  }
}
function assertLexicallyInsideRoot(filePath, root) {
  const rootPath = path4.resolve(root);
  const target = path4.resolve(filePath);
  if (!isPathInside2(rootPath, target)) {
    throw new Error(`Refusing to access path outside project root: ${target}`);
  }
}
function rejectSymlinkTarget(filePath) {
  if (lstatIfExists(filePath)?.isSymbolicLink()) {
    throw new Error(`Refusing to write through symlink: ${filePath}`);
  }
}
function lstatIfExists(filePath) {
  return fs2.lstatSync(filePath, { throwIfNoEntry: false }) ?? null;
}
function isPathInside2(root, target) {
  const relativePath = path4.relative(root, target);
  return !path4.isAbsolute(relativePath) && (relativePath === "" || !relativePath.split(path4.sep).includes(".."));
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
var BUILD_EXTENSIONS = {
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
  if (data.series !== undefined && !isKebabId2(data.series)) {
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
      errors.push(`${relative2(project, entity.file)} frontmatter field pronunciation must be text`);
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
    const label2 = relativePath;
    const data = readValidationData(path4.join(project.root, relativePath), project.root, label2, errors);
    if (!data) {
      continue;
    }
    requireFields(data, ["type", "story"], label2, errors);
    requireScalar(data, "type", label2, errors);
    requireScalar(data, "story", label2, errors);
    if (data.type !== undefined && data.type !== expectedType) {
      errors.push(`${label2} type must be ${expectedType}`);
    }
    if (data.story !== undefined && data.story !== project.storyId) {
      errors.push(`${label2} story must be ${project.storyId}`);
    }
    if (relativePath === path4.join("plot", "_index.md")) {
      requireFields(data, ["structure"], label2, errors);
      requireScalar(data, "structure", label2, errors);
    }
  }
}
function validateCharacters(project, errors) {
  for (const character of project.characters) {
    const label2 = relative2(project, character.file);
    const data = readValidationData(character.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(character.id, label2, errors);
    requireFields(data, ["name", "role", "status"], label2, errors);
    requireScalar(data, "name", label2, errors);
    requireScalar(data, "role", label2, errors);
    requireScalar(data, "status", label2, errors);
    validateEnum(data, "role", CHARACTER_ROLES, label2, errors);
    validateEnum(data, "status", CHARACTER_STATUSES, label2, errors);
    if (data["died-in"] !== undefined) {
      requireScalar(data, "died-in", label2, errors);
    }
    if (data.arc !== undefined) {
      requireScalar(data, "arc", label2, errors);
    }
    validateStringArray(data, "aliases", label2, errors);
    validateStringArray(data, "locations", label2, errors);
    validateStringArray(data, "tags", label2, errors);
    validateStringArray(data, "voice-words", label2, errors);
    validateStringArray(data, "voice-avoid", label2, errors);
    validateRelationships(data, label2, errors);
  }
}
function validateLocations(project, errors) {
  for (const location of project.locations) {
    const label2 = relative2(project, location.file);
    const data = readValidationData(location.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(location.id, label2, errors);
    requireFields(data, ["name", "type"], label2, errors);
    requireScalar(data, "name", label2, errors);
    requireScalar(data, "type", label2, errors);
    validateStringArray(data, "notable-characters", label2, errors);
    validateStringArray(data, "tags", label2, errors);
    validateObjectArray(data, "routes", label2, errors);
    for (const route of Array.isArray(data.routes) ? data.routes : []) {
      if (!route || typeof route !== "object" || Array.isArray(route)) {
        continue;
      }
      if (typeof route.to !== "string" || route.to === "") {
        errors.push(`${label2} route is missing to`);
      }
      if (typeof route.hours !== "number" || !Number.isFinite(route.hours) || route.hours <= 0) {
        errors.push(`${label2} route to ${route.to ?? "?"} hours must be a positive number`);
      }
      requireScalar(route, "mode", `${label2} route to ${route.to ?? "?"}`, errors);
    }
  }
}
function validateSystems(project, errors) {
  for (const system of project.systems) {
    const label2 = relative2(project, system.file);
    const data = readValidationData(system.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(system.id, label2, errors);
    requireFields(data, ["name", "type"], label2, errors);
    requireScalar(data, "name", label2, errors);
    requireScalar(data, "type", label2, errors);
    if (data.prevalence !== undefined) {
      requireScalar(data, "prevalence", label2, errors);
    }
  }
}
function validateFactions(project, errors) {
  for (const faction of project.factions) {
    const label2 = relative2(project, faction.file);
    const data = readValidationData(faction.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(faction.id, label2, errors);
    requireFields(data, ["name", "type", "status"], label2, errors);
    requireScalar(data, "name", label2, errors);
    requireScalar(data, "type", label2, errors);
    requireScalar(data, "status", label2, errors);
    validateEnum(data, "type", FACTION_TYPES, label2, errors);
    validateEnum(data, "status", FACTION_STATUSES, label2, errors);
    validateStringArray(data, "members", label2, errors);
    validateStringArray(data, "locations", label2, errors);
    validateStringArray(data, "tags", label2, errors);
  }
}
function validateArtifacts(project, errors) {
  for (const artifact of project.artifacts) {
    const label2 = relative2(project, artifact.file);
    const data = readValidationData(artifact.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(artifact.id, label2, errors);
    requireFields(data, ["name", "type", "status"], label2, errors);
    requireScalar(data, "name", label2, errors);
    requireScalar(data, "type", label2, errors);
    requireScalar(data, "status", label2, errors);
    requireScalar(data, "owner", label2, errors);
    requireScalar(data, "location", label2, errors);
    validateEnum(data, "type", ARTIFACT_TYPES, label2, errors);
    validateEnum(data, "status", ARTIFACT_STATUSES, label2, errors);
    validateStringArray(data, "tags", label2, errors);
  }
}
function validateArcs(project, errors) {
  for (const arc of project.arcs) {
    const label2 = relative2(project, arc.file);
    const data = readValidationData(arc.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(arc.id, label2, errors);
    requireFields(data, ["name", "type", "status"], label2, errors);
    requireScalar(data, "name", label2, errors);
    requireScalar(data, "type", label2, errors);
    requireScalar(data, "status", label2, errors);
    validateEnum(data, "type", ARC_TYPES, label2, errors);
    validateEnum(data, "status", ARC_STATUSES, label2, errors);
    validateStringArray(data, "characters", label2, errors);
    validateStringArray(data, "themes", label2, errors);
    validateStringArray(data, "acts", label2, errors);
  }
}
function validateChapters(project, errors) {
  const seenNumbers = new Map;
  for (const chapter of project.chapters) {
    const label2 = relative2(project, chapter.file);
    const data = readValidationData(chapter.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    const filenameNumber = chapterNumberFromFile(chapter.file);
    validateEntityId(chapter.id, label2, errors);
    requireFields(data, ["title", "number", "status"], label2, errors);
    requireScalar(data, "title", label2, errors);
    requireScalar(data, "status", label2, errors);
    requireInteger(data, "number", label2, errors);
    validateEnum(data, "status", CHAPTER_STATUSES, label2, errors);
    validateStringArray(data, "locations", label2, errors);
    validateStringArray(data, "characters", label2, errors);
    validateStringArray(data, "mentions", label2, errors);
    validateStringArray(data, "arcs-advanced", label2, errors);
    if (data.pov !== undefined) {
      requireScalar(data, "pov", label2, errors);
    }
    if (data["word-count"] !== undefined) {
      requireInteger(data, "word-count", label2, errors, 0);
    }
    if (data["target-words"] !== undefined) {
      requireInteger(data, "target-words", label2, errors, 1);
    }
    if (data.date !== undefined) {
      requireScalar(data, "date", label2, errors);
    }
    if (data.time !== undefined) {
      requireScalar(data, "time", label2, errors);
    }
    if (data.mode !== undefined) {
      requireScalar(data, "mode", label2, errors);
    }
    if (data["episode-question"] !== undefined) {
      requireScalar(data, "episode-question", label2, errors);
    }
    if (data["time-skip"] !== undefined) {
      requireScalar(data, "time-skip", label2, errors);
    }
    validateEnum(data, "hook", CHAPTER_HOOKS, label2, errors);
    if (filenameNumber === 0) {
      errors.push(`${label2} filename must match chapter-{NN}.md`);
    } else if (Number.isInteger(data.number) && data.number !== filenameNumber) {
      errors.push(`${label2} number must match filename chapter number ${filenameNumber}`);
    }
    if (Number.isInteger(data.number)) {
      if (data.number <= 0) {
        errors.push(`${label2} number must be greater than 0`);
      }
      const existing = seenNumbers.get(data.number);
      if (existing) {
        errors.push(`${label2} duplicates chapter number ${data.number} from ${existing}`);
      } else {
        seenNumbers.set(data.number, label2);
      }
    }
  }
}
function validateScenes(project, errors) {
  const seenKeys = new Map;
  for (const scene of project.scenes) {
    const label2 = relative2(project, scene.file);
    const data = readValidationData(scene.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(scene.id, label2, errors);
    requireFields(data, ["title", "chapter", "scene", "status"], label2, errors);
    requireScalar(data, "title", label2, errors);
    requireScalar(data, "chapter", label2, errors);
    requireScalar(data, "status", label2, errors);
    requireInteger(data, "scene", label2, errors);
    validateEnum(data, "status", SCENE_STATUSES, label2, errors);
    validateStringArray(data, "characters", label2, errors);
    validateStringArray(data, "mentions", label2, errors);
    validateStringArray(data, "arcs-advanced", label2, errors);
    validateObjectArray(data, "state-changes", label2, errors);
    if (data.pov !== undefined) {
      requireScalar(data, "pov", label2, errors);
    }
    if (data.location !== undefined) {
      requireScalar(data, "location", label2, errors);
    }
    if (data.date !== undefined) {
      requireScalar(data, "date", label2, errors);
    }
    if (data.time !== undefined) {
      requireScalar(data, "time", label2, errors);
    }
    if (data.dilemma !== undefined) {
      requireScalar(data, "dilemma", label2, errors);
    }
    if (data["travel-hours"] !== undefined && typeof data["travel-hours"] !== "number") {
      errors.push(`${label2} frontmatter field travel-hours must be a number`);
    }
    if (data.sequel !== undefined && typeof data.sequel !== "boolean") {
      errors.push(`${label2} frontmatter field sequel must be a boolean`);
    }
    validateEnum(data, "outcome", SCENE_OUTCOMES, label2, errors);
    if (data["flashback-to"] !== undefined) {
      requireScalar(data, "flashback-to", label2, errors);
    }
    if (Number.isInteger(data.scene) && data.scene <= 0) {
      errors.push(`${label2} scene must be greater than 0`);
    }
    const filenameMatch = SCENE_FILENAME_PATTERN.exec(path4.basename(scene.file));
    if (!filenameMatch) {
      errors.push(`${label2} filename must match {chapter}-scene-{NN}.md`);
    } else {
      const [, filenameChapter, filenameSceneText] = filenameMatch;
      const filenameScene = Number.parseInt(filenameSceneText, 10);
      if (typeof data.chapter === "string" && data.chapter !== "" && data.chapter !== filenameChapter) {
        errors.push(`${label2} chapter must match filename chapter ${filenameChapter}`);
      }
      if (Number.isInteger(data.scene) && data.scene !== filenameScene) {
        errors.push(`${label2} scene must match filename scene number ${filenameScene}`);
      }
    }
    if (typeof data.chapter === "string" && data.chapter !== "" && Number.isInteger(data.scene)) {
      const key = `${data.chapter}::${data.scene}`;
      const existing = seenKeys.get(key);
      if (existing) {
        errors.push(`${label2} duplicates scene ${data.scene} of ${data.chapter} from ${existing}`);
      } else {
        seenKeys.set(key, label2);
      }
    }
  }
}
function validateContinuityState(project, errors) {
  const label2 = path4.join("continuity", "state.md");
  if (!project.continuity) {
    return;
  }
  const data = project.continuity.data;
  requireFields(data, ["type", "story", "current-chapter"], label2, errors);
  requireScalar(data, "type", label2, errors);
  requireScalar(data, "story", label2, errors);
  requireInteger(data, "current-chapter", label2, errors, 0);
  validateObjectArray(data, "character-state", label2, errors);
  validateObjectArray(data, "object-state", label2, errors);
  validateObjectArray(data, "knowledge-state", label2, errors);
  if (data.type !== undefined && data.type !== "continuity-state") {
    errors.push(`${label2} type must be continuity-state`);
  }
  if (data.story !== undefined && data.story !== project.storyId) {
    errors.push(`${label2} story must be ${project.storyId}`);
  }
}
function validateQuestions(project, errors) {
  for (const question of project.questions) {
    const label2 = relative2(project, question.file);
    const data = readValidationData(question.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(question.id, label2, errors);
    requireFields(data, ["title", "status"], label2, errors);
    requireScalar(data, "title", label2, errors);
    requireScalar(data, "status", label2, errors);
    requireScalar(data, "introduced", label2, errors);
    requireScalar(data, "resolved", label2, errors);
    validateEnum(data, "status", QUESTION_STATUSES, label2, errors);
    validateStringArray(data, "characters", label2, errors);
  }
}
function validatePromises(project, errors) {
  for (const promise of project.promises) {
    const label2 = relative2(project, promise.file);
    const data = readValidationData(promise.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(promise.id, label2, errors);
    requireFields(data, ["title", "status"], label2, errors);
    requireScalar(data, "title", label2, errors);
    requireScalar(data, "status", label2, errors);
    requireScalar(data, "planted", label2, errors);
    requireScalar(data, "payoff", label2, errors);
    validateEnum(data, "status", PROMISE_STATUSES, label2, errors);
    validateStringArray(data, "arcs", label2, errors);
    validateStringArray(data, "characters", label2, errors);
  }
}
function validateClues(project, errors) {
  for (const clue of project.clues) {
    const label2 = relative2(project, clue.file);
    const data = readValidationData(clue.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(clue.id, label2, errors);
    requireFields(data, ["title", "status"], label2, errors);
    requireScalar(data, "title", label2, errors);
    requireScalar(data, "status", label2, errors);
    requireScalar(data, "planted", label2, errors);
    requireScalar(data, "payoff", label2, errors);
    validateEnum(data, "status", CLUE_STATUSES, label2, errors);
    validateStringArray(data, "arcs", label2, errors);
    validateStringArray(data, "characters", label2, errors);
    for (const field of ["significance-delayed", "red-herring"]) {
      if (data[field] !== undefined && typeof data[field] !== "boolean") {
        errors.push(`${label2} frontmatter field ${field} must be a boolean`);
      }
    }
  }
}
function validateExemptions(project, errors) {
  const exemptionsPath = path4.join(project.root, "continuity", "exemptions.md");
  if (!fs2.existsSync(exemptionsPath)) {
    return;
  }
  const label2 = path4.join("continuity", "exemptions.md");
  const data = readValidationData(exemptionsPath, project.root, label2, errors);
  if (!data) {
    return;
  }
  if (data.type !== "exemption-log") {
    errors.push(`${label2} type must be exemption-log`);
  }
  const entries = data.exemptions;
  if (entries === undefined) {
    errors.push(`${label2} is missing frontmatter field exemptions`);
    return;
  }
  if (!Array.isArray(entries)) {
    errors.push(`${label2} frontmatter field exemptions must be a list`);
    return;
  }
  for (const [index, entry] of entries.entries()) {
    const entryLabel = `${label2} exemptions[${index}]`;
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
    const label2 = relative2(project, term.file);
    const data = readValidationData(term.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(term.id, label2, errors);
    requireFields(data, ["term", "category"], label2, errors);
    requireScalar(data, "term", label2, errors);
    requireScalar(data, "category", label2, errors);
    validateEnum(data, "category", TERM_CATEGORIES, label2, errors);
    validateStringArray(data, "aliases", label2, errors);
  }
}
function validateStyleSheet(project, errors) {
  if (project.styleSheet === null) {
    return;
  }
  const data = project.styleSheet.data;
  const label2 = STYLE_SHEET_FILE;
  if (data.type !== "style-sheet") {
    errors.push(`${label2} type must be style-sheet`);
  }
  requireScalar(data, "dialect", label2, errors);
  validateEnum(data, "dialect", STYLE_DIALECTS, label2, errors);
  validateObjectArray(data, "preferred", label2, errors);
  asArray(data.preferred).forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }
    const entryLabel = `${label2} preferred[${index}]`;
    for (const field of ["use", "avoid"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        errors.push(`${entryLabel} requires a non-empty ${field}`);
      }
    }
    if (typeof entry.use === "string" && typeof entry.avoid === "string" && entry.use.trim().toLowerCase() === entry.avoid.trim().toLowerCase()) {
      errors.push(`${entryLabel} use and avoid must differ`);
    }
  });
  validateStringArray(data, "watch-words", label2, errors);
  validateStringArray(data, "allow-words", label2, errors);
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
  const seen = new Set;
  asArray(data.sessions).forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }
    const label2 = `${PROGRESS_FILE} sessions[${index}]`;
    const dateError = storyDateError(entry.date);
    if (entry.date === undefined || dateError !== "") {
      errors.push(`${label2} ${dateError || "requires a date"}`);
    } else if (seen.has(String(entry.date))) {
      errors.push(`${label2} repeats date ${entry.date}`);
    } else {
      seen.add(String(entry.date));
    }
    if (!Number.isInteger(entry.words) || entry.words < 0) {
      errors.push(`${label2} words must be a non-negative integer`);
    }
  });
}
function validateOptionalRegistry(project, directory, expectedType, errors) {
  const indexPath = path4.join(project.root, directory, "_index.md");
  if (fs2.existsSync(indexPath)) {
    const label2 = path4.join(directory, "_index.md");
    const data = readValidationData(indexPath, project.root, label2, errors);
    if (data && data.type !== expectedType) {
      errors.push(`${label2} type must be ${expectedType}`);
    }
  }
}
function validateResearch(project, errors, warnings) {
  validateOptionalRegistry(project, RESEARCH_DIR, "research-registry", errors);
  const chapterStatus = new Map(project.chapters.map((chapter) => [chapter.id, chapter.status]));
  for (const note of project.research) {
    const label2 = relative2(project, note.file);
    const data = readValidationData(note.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(note.id, label2, errors);
    requireFields(data, ["title", "status"], label2, errors);
    requireScalar(data, "title", label2, errors);
    validateEnum(data, "status", RESEARCH_STATUSES, label2, errors);
    validateStringArray(data, "sources", label2, errors);
    validateStringArray(data, "used-in", label2, errors);
    validateEnum(data, "accuracy", RESEARCH_ACCURACY, label2, errors);
    validateEnum(data, "confidence", RESEARCH_CONFIDENCE, label2, errors);
    validateEnum(data, "method", RESEARCH_METHODS, label2, errors);
    validateStringArray(data, "risk", label2, errors);
    validateStringArray(data, "reviewed-by", label2, errors);
    for (const risk of Array.isArray(data.risk) ? data.risk : []) {
      if (typeof risk === "string" && !RESEARCH_RISKS.has(risk)) {
        errors.push(`${label2} risk has unsupported value ${risk}`);
      }
    }
    const invented = note.accuracy === "invented";
    if (!invented && note.status === "verified" && note.sources.length === 0) {
      warnings.push(`${label2} is verified but lists no sources`);
    }
    const settled = note.usedIn.filter((chapterId) => SETTLED_CHAPTER_STATUSES.has(chapterStatus.get(chapterId)));
    if (!invented && (note.status === "open" || note.status === "disputed")) {
      for (const chapterId of settled) {
        warnings.push(`${label2} is ${note.status} but ${chapterId} relies on it and is ${chapterStatus.get(chapterId)}`);
      }
    }
    if (note.risk.length > 0 && note.reviewedBy.length === 0 && settled.length > 0) {
      warnings.push(`${label2} carries ${note.risk.join(", ")} risk but has no reviewed-by, and ${settled.join(", ")} relies on it`);
    }
  }
}
function validateMatter(project, errors, warnings) {
  validateOptionalRegistry(project, MATTER_DIR, "matter-registry", errors);
  for (const matter of project.matter) {
    const label2 = relative2(project, matter.file);
    if (matter.empty) {
      warnings.push(`${label2} has no text and is left out of export and build`);
    }
    const data = readValidationData(matter.file, project.root, label2, errors);
    if (!data) {
      continue;
    }
    validateEntityId(matter.id, label2, errors);
    requireFields(data, ["title", "placement"], label2, errors);
    requireScalar(data, "title", label2, errors);
    validateEnum(data, "placement", MATTER_PLACEMENTS, label2, errors);
    if (data.order !== undefined) {
      requireInteger(data, "order", label2, errors, 0);
    }
    if (data.heading !== undefined && typeof data.heading !== "boolean") {
      errors.push(`${label2} heading must be true or false`);
    }
    validateEnum(data, "permission", MATTER_PERMISSIONS, label2, errors);
    requireScalar(data, "rights-holder", label2, errors);
    requireScalar(data, "credit", label2, errors);
    if (data.permission === "pending" && project.story.data.status === "complete") {
      warnings.push(`${label2} permission is still pending and the story is complete`);
    }
    if (data.permission === "granted" && (typeof data["rights-holder"] !== "string" || data["rights-holder"].trim() === "")) {
      warnings.push(`${label2} permission is granted but no rights-holder is recorded`);
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
function coverImage(project) {
  const cover = String(project.story.data.cover).trim();
  const mediaType = COVER_MEDIA_TYPES[path4.extname(cover).toLowerCase()];
  if (mediaType === undefined) {
    throw new Error(`story.md cover ${cover} must be a ${Object.keys(COVER_MEDIA_TYPES).join(", ")} image`);
  }
  const filePath = path4.resolve(project.root, cover);
  if (!isPathInside2(project.root, filePath)) {
    throw new Error(`story.md cover ${cover} must be inside the project`);
  }
  if (!lstatIfExists(filePath)?.isFile()) {
    throw new Error(`story.md cover ${cover} does not exist`);
  }
  assertSafeProjectPath(filePath, project.root);
  assertFileSizeWithinLimit(filePath);
  return { filePath, mediaType, extension: mediaType === "image/jpeg" ? "jpg" : path4.extname(cover).slice(1).toLowerCase() };
}
function validateEntityId(id, label2, errors) {
  if (id !== kebabCase(id)) {
    errors.push(`${label2} filename id must be kebab-case`);
  }
}
function requireScalar(data, field, label2, errors) {
  if (data[field] !== undefined && (Array.isArray(data[field]) || typeof data[field] === "object")) {
    errors.push(`${label2} frontmatter field ${field} must be a scalar`);
  }
}
function requireArray(data, field, label2, errors) {
  if (data[field] !== undefined && !Array.isArray(data[field])) {
    errors.push(`${label2} frontmatter field ${field} must be a list`);
  }
}
function requireInteger(data, field, label2, errors, minimum) {
  if (data[field] === undefined) {
    return;
  }
  if (!Number.isInteger(data[field])) {
    errors.push(`${label2} frontmatter field ${field} must be an integer`);
  } else if (minimum !== undefined && data[field] < minimum) {
    errors.push(`${label2} frontmatter field ${field} must be at least ${minimum}`);
  }
}
function validateStringArray(data, field, label2, errors) {
  if (data[field] === undefined) {
    return;
  }
  if (!Array.isArray(data[field])) {
    errors.push(`${label2} frontmatter field ${field} must be a list`);
    return;
  }
  for (const item of data[field]) {
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(`${label2} frontmatter field ${field} must contain only non-empty strings`);
    }
  }
}
function validateObjectArray(data, field, label2, errors) {
  if (data[field] === undefined) {
    return;
  }
  if (!Array.isArray(data[field])) {
    errors.push(`${label2} frontmatter field ${field} must be a list`);
    return;
  }
  for (const item of data[field]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${label2} frontmatter field ${field} must contain objects`);
    }
  }
}
function validateRelationships(data, label2, errors) {
  if (data.relationships === undefined) {
    return;
  }
  if (!Array.isArray(data.relationships)) {
    errors.push(`${label2} frontmatter field relationships must be a list`);
    return;
  }
  for (const relationship of data.relationships) {
    if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
      errors.push(`${label2} frontmatter field relationships must contain objects`);
      continue;
    }
    if (typeof relationship.character !== "string" || relationship.character.trim() === "") {
      errors.push(`${label2} relationship is missing character`);
    } else if (relationship.character !== kebabCase(relationship.character)) {
      errors.push(`${label2} relationship character ${relationship.character} must be kebab-case`);
    }
    if (typeof relationship.type !== "string" || relationship.type.trim() === "") {
      errors.push(`${label2} relationship to ${relationship.character ?? "unknown"} is missing type`);
    }
  }
}
function validateEnum(data, field, allowed, label2, errors) {
  if (data[field] !== undefined && !allowed.has(data[field])) {
    errors.push(`${label2} frontmatter field ${field} has unsupported value ${data[field]}`);
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
function requireFields(data, fields, label2, errors) {
  for (const field of fields) {
    if (data[field] === undefined || data[field] === "") {
      errors.push(`${label2} is missing frontmatter field ${field}`);
    }
  }
}
var CHAPTER_FILENAME_PATTERN = /^chapter-(\d+)\.md$/;
var SCENE_FILENAME_PATTERN = /^(.+)-scene-(\d+)\.md$/;
function chapterNumberFromFile(file) {
  const match = CHAPTER_FILENAME_PATTERN.exec(path4.basename(file));
  return match ? Number.parseInt(match[1], 10) : 0;
}
function sceneNumberFromFile(file) {
  const match = SCENE_FILENAME_PATTERN.exec(path4.basename(file));
  return match ? Number.parseInt(match[2], 10) : 0;
}
function sceneChapterFromFile(file) {
  const match = SCENE_FILENAME_PATTERN.exec(path4.basename(file));
  return match ? match[1] : "";
}
function relative2(project, file) {
  return path4.relative(project.root, file);
}

// src/import.js
var ROMAN_NUMERAL = "(?!i\\s+\\S)(?=[ivxlc])c{0,3}(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})";
var CHAPTER_HEADING_PATTERN = new RegExp(`^chapter(?![A-Za-z])\\s*(?:(?:\\d+|${ROMAN_NUMERAL})(?=[\\s:.\\-–—]|$))?\\s*[:.\\-–—]*\\s*(.*)$`, "i");
var FRONTMATTER_BLOCK_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
var YAML_LINE_PATTERN = /^(?:\s*$|\s*#|\s*-\s|\s*-$|\s+\S|[A-Za-z0-9_"'][^:]*:(?:\s|$))/;
var FRONT_MATTER_NAMES = /^(?:prologue|preface|foreword|introduction|prelude)\b/i;
var CANDIDATE_THRESHOLD = 3;
var CANDIDATE_LIMIT = 25;
var CANDIDATE_STOPWORDS = new Set([
  "A",
  "An",
  "And",
  "At",
  "But",
  "By",
  "Dr",
  "For",
  "He",
  "Her",
  "His",
  "I",
  "If",
  "In",
  "It",
  "Its",
  "Mr",
  "Mrs",
  "Ms",
  "No",
  "Not",
  "Of",
  "On",
  "Or",
  "She",
  "That",
  "The",
  "Then",
  "They",
  "Their",
  "This",
  "To",
  "We",
  "When",
  "While",
  "With",
  "Yes",
  "You"
]);
var MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
var MAX_IMPORT_FILES = 500;
function rejectSymlinkedSource(filePath) {
  if (fs3.lstatSync(filePath).isSymbolicLink()) {
    throw new Error("Refusing to import symlinked source: " + filePath);
  }
}
function assertImportFileSize(filePath) {
  const size = fs3.statSync(filePath).size;
  if (size > MAX_IMPORT_FILE_BYTES) {
    throw new Error("Refusing to import oversized file " + filePath + ": " + size + " bytes exceeds the " + MAX_IMPORT_FILE_BYTES + " byte limit");
  }
}
function importManuscript(options) {
  const rawSource = String(options.source ?? "").trim();
  if (!rawSource) {
    throw new Error("An import source file or directory is required");
  }
  const cwd = options.cwd ?? process.cwd();
  const source = path5.resolve(cwd, rawSource);
  if (!fs3.existsSync(source)) {
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
    synopsis: options.synopsis ?? `Imported from ${path5.basename(source)}. Replace with a 2-3 sentence synopsis.`,
    force: options.force
  });
  const chaptersDir = path5.join(created.root, "chapters");
  for (const name of fs3.readdirSync(chaptersDir)) {
    if (!/^chapter-\d+\.md$/i.test(name)) {
      continue;
    }
    fs3.unlinkSync(path5.join(chaptersDir, name));
  }
  let totalWords = 0;
  chapters.forEach((chapter, index) => {
    const number = index + 1;
    const words = wordCount(chapter.prose);
    totalWords += words;
    const file = path5.join(chaptersDir, `chapter-${String(number).padStart(2, "0")}.md`);
    writeFile(file, chapterMarkdown(chapter.title, number, words, chapter.prose), { root: created.root });
  });
  reindexProject(created.root);
  return {
    root: created.root,
    storyId: created.storyId,
    chapters: chapters.length,
    words: totalWords,
    candidates: extractNameCandidates(chapters.map((chapter) => chapter.prose).join(`

`))
  };
}
function extractNameCandidates(prose) {
  const counts = new Map;
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
  return [...counts.entries()].filter(([, count]) => count >= CANDIDATE_THRESHOLD).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, CANDIDATE_LIMIT).map(([name, count]) => ({ name, count }));
}
function addCandidate(counts, name) {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}
function readSourceDocuments(source) {
  rejectSymlinkedSource(source);
  if (fs3.statSync(source).isFile()) {
    assertImportFileSize(source);
    return [{ name: path5.basename(source), text: fs3.readFileSync(source, "utf8") }];
  }
  const names = [];
  for (const entry of fs3.readdirSync(source, { withFileTypes: true })) {
    const fullPath = path5.join(source, entry.name);
    if (fs3.lstatSync(fullPath).isSymbolicLink()) {
      let targetIsDocument = false;
      try {
        targetIsDocument = fs3.statSync(fullPath).isFile();
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
    throw new Error("Too many import files in " + source + ": " + names.length + " exceeds the " + MAX_IMPORT_FILES + " file limit");
  }
  const documents = names.map((name) => {
    const fullPath = path5.join(source, name);
    assertImportFileSize(fullPath);
    return { name, text: fs3.readFileSync(fullPath, "utf8") };
  });
  if (documents.length === 0) {
    throw new Error(`No markdown or text files found in ${source}`);
  }
  return documents;
}
function importNameRank(name, nums) {
  if (nums.length > 0) {
    return 1;
  }
  return FRONT_MATTER_NAMES.test(name) ? 0 : 2;
}
function compareImportNames(left, right) {
  const leftNums = [...left.matchAll(/\d+/g)].map((match) => Number(match[0]));
  const rightNums = [...right.matchAll(/\d+/g)].map((match) => Number(match[0]));
  const rankDiff = importNameRank(left, leftNums) - importNameRank(right, rightNums);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  const length = Math.max(leftNums.length, rightNums.length);
  for (let index = 0;index < length; index += 1) {
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
    const match = FRONTMATTER_BLOCK_PATTERN.exec(text);
    if (match && match[1].split(/\r?\n/).every((line) => YAML_LINE_PATTERN.test(line))) {
      return text.slice(match[0].length);
    }
    return text;
  }
}
function splitChapters(documents) {
  const chapters = [];
  for (const document of documents) {
    const text = withoutLeadingFrontmatter(document.text).replace(/\r\n/g, `
`);
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
  const lines = text.split(`
`);
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
  const opening = stripTitleHeading(preamble.join(`
`)).trim();
  if (opening !== "") {
    sections.unshift({ title: "Opening", prose: opening });
  }
  return sections;
}
function finishChapter(section) {
  return { title: section.title, prose: section.lines.join(`
`).trim() };
}
function singleChapter(text, fileName) {
  const headingMatch = /^#\s+(.*)$/m.exec(text);
  if (headingMatch) {
    const before = text.slice(0, headingMatch.index).trim();
    const after = text.slice(headingMatch.index + headingMatch[0].length).trim();
    return {
      title: headingMatch[1].trim(),
      prose: [before, after].filter((part) => part !== "").join(`

`)
    };
  }
  return {
    title: titleCaseSlug(path5.basename(fileName, path5.extname(fileName))),
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

// src/options.js
var OPTIONS = [
  { name: "title", value: "<name>", help: ["Story title for import"] },
  { name: "dir", value: "<path>", help: ["Target directory for init or import"] },
  { name: "genre", value: "<name>", help: ["Story genre for init"] },
  { name: "sub-genre", value: "<name>", help: ["Story sub-genre for init"] },
  { name: "setting-era", value: "<name>", help: ["Setting era for init"] },
  { name: "theme", value: "<name>", repeatable: true, help: ["Theme for init or add arc; repeatable"] },
  { name: "themes", value: "<a,b>", repeatable: true, help: ["Comma-separated themes for init or add arc"] },
  { name: "pov", value: "<style>", help: ["POV style for init or add chapter/scene"] },
  { name: "tense", value: "<tense>", help: ["Narrative tense for init"] },
  { name: "form", value: "<form>", help: ["Story form for init (novel, novella, novelette,", "short-story, flash, serial, picture-book,", "chapter-book); sets a default target-words"] },
  { name: "synopsis", value: "<text>", help: ["Starter synopsis for init"] },
  { name: "series", value: "<id>", help: ["Series id for init"] },
  { name: "book-number", value: "<n>", help: ["Publication order for init"] },
  { name: "follows", value: "<path>", repeatable: true, help: ["Init a sequel set after this story project;", "repeatable"] },
  { name: "precedes", value: "<path>", repeatable: true, help: ["Init a prequel set before this story project;", "repeatable"] },
  {
    name: "force",
    help: [
      "Let init/import use an existing directory: add",
      "missing starter files, never overwrite existing",
      "ones; import also replaces every chapter-NN.md file"
    ]
  },
  { name: "write", help: ["Update chapter word-count frontmatter"] },
  { name: "log", help: ["Record today's word count in progress.md"] },
  { name: "ref", value: "<git-ref>", help: ["Earlier draft as a git branch, tag, or commit", "for compare"] },
  { name: "against", value: "<path>", help: ["Earlier draft as another project folder for compare"] },
  { name: "path", value: "<path>", help: ["Project root for every command except init and", "import"] },
  { name: "out", value: "<file>", help: ["Output path for export/build/synopsis/diagram"] },
  { name: "format", value: "<name>", help: ["Output format for build (markdown, epub, docx,", "shunn, html, print, narration, metadata)"] },
  { name: "trim", value: "<size>", help: ["Trim size for build --format print (5x8,", "5.25x8, 5.5x8.5, 6x9, a5; default 5.5x8.5)"] },
  { name: "shunn", help: ["Apply Shunn manuscript formatting (with --format", "docx)"] },
  { name: "at", value: "<chapter-id>", help: ["Chapter id for knowledge"] },
  { name: "init", help: ["Add the default revision passes for passes"] },
  { name: "start", value: "<pass>", help: ["Mark a revision pass in progress for passes"] },
  { name: "done", value: "<pass>", help: ["Mark a revision pass done for passes"] },
  { name: "pages", value: "<n>", help: ["Synopsis length for synopsis (1 or 3)"] },
  { name: "actionable", help: ["Include next actions in report"] },
  { name: "number", value: "<n>", help: ["Chapter number for add chapter"] },
  { name: "chapter", value: "<id>", help: ["Chapter id for add scene"] },
  { name: "scene", value: "<n>", help: ["Scene number for add scene"] },
  { name: "type", value: "<name>", help: ["Entity type for add"] },
  { name: "role", value: "<name>", help: ["Character role for add character"] },
  { name: "status", value: "<name>", help: ["Entity status for add"] },
  { name: "mode", value: "<name>", help: ["Mode for add chapter (e.g. discovered)"] },
  { name: "date", value: "<date>", help: ["Story date (YYYY-MM-DD) for add chapter/scene;", "the session date for progress (default today)"] },
  { name: "time", value: "<time>", help: ["Story time (HH:MM or dawn, morning, midday,", "afternoon, evening, night) for add chapter/scene"] },
  { name: "travel-hours", value: "<n>", help: ["Travel hours for add scene"] },
  { name: "dilemma", value: "<text>", help: ["Dilemma for add scene sequel unit"] },
  { name: "sequel", help: ["Mark scene as sequel unit for add scene"] },
  { name: "outcome", value: "<name>", help: ["Scene outcome for add scene (yes, no, yes-but,", "no-and)"] },
  { name: "hook", value: "<name>", help: ["Chapter-ending hook for add chapter (cliffhanger,", "question, revelation, reversal, decision,", "emotional, resolution)"] },
  { name: "location", value: "<id>", repeatable: true, help: ["Location reference for add"] },
  { name: "locations", value: "<ids>", repeatable: true },
  { name: "character", value: "<id>", repeatable: true, help: ["Character reference for add; repeatable"] },
  { name: "characters", value: "<ids>", repeatable: true },
  { name: "mention", value: "<id>", repeatable: true, help: ["Mentioned character for add chapter/scene;", "repeatable"] },
  { name: "mentions", value: "<ids>", repeatable: true },
  { name: "member", value: "<id>", repeatable: true, help: ["Faction member reference for add faction; repeatable"] },
  { name: "members", value: "<ids>", repeatable: true },
  { name: "owner", value: "<id>", help: ["Owner reference for add artifact"] },
  { name: "arc", value: "<id>", repeatable: true, help: ["Arc reference for add (arc theme for add", "character); repeatable"] },
  { name: "arcs", value: "<ids>", repeatable: true },
  { name: "introduced", value: "<id>", help: ["Chapter id for add question"] },
  { name: "resolved", value: "<id>", help: ["Chapter id for add question"] },
  { name: "planted", value: "<id>", help: ["Chapter id for add promise/clue"] },
  { name: "payoff", value: "<id>", help: ["Chapter id for add promise/clue"] },
  { name: "significance-delayed", help: ["Significance is delayed for add clue"] },
  { name: "red-herring", help: ["Mark add clue as a red herring"] },
  { name: "category", value: "<name>", help: ["Category for add term"] },
  { name: "alias", value: "<name>", repeatable: true, help: ["Alias for add term; repeatable"] },
  { name: "aliases", value: "<names>", repeatable: true },
  { name: "region", value: "<name>", help: ["Region for add location"] },
  { name: "population", value: "<name>", help: ["Population for add location"] },
  { name: "controlled-by", value: "<id>", help: ["Controlling faction for add location"] },
  { name: "prevalence", value: "<name>", help: ["Prevalence for add system"] },
  { name: "acts", value: "<a,b>", repeatable: true, help: ["Comma-separated acts for add arc; repeatable"] },
  { name: "act", value: "<name>", repeatable: true },
  { name: "placement", value: "<front|back>", help: ["Placement for add matter (default front)"] },
  { name: "order", value: "<n>", help: ["Order within its placement for add matter"] },
  { name: "source", value: "<text>", repeatable: true, help: ["Source for add research; repeatable"] },
  { name: "sources", value: "<texts>", repeatable: true },
  { name: "used-in", value: "<chapter-id>", repeatable: true, help: ["Chapter that relies on add research; repeatable"] },
  { name: "accuracy", value: "<level>", help: ["Accuracy for add research (must-be-accurate,", "blended, invented)"] },
  { name: "confidence", value: "<level>", help: ["Confidence for add research (high, medium, low)"] },
  { name: "method", value: "<name>", help: ["Research method for add research (fact, interview,", "site-visit, expert-review, reading)"] },
  { name: "risk", value: "<name>", repeatable: true, help: ["Risk area for add research (legal, medical,", "weapons, safety, cultural, defamation,", "technical); repeatable"] }
];
var BOOLEAN_OPTIONS = new Set(OPTIONS.filter((option) => option.value === undefined).map((option) => option.name));
var VALUE_OPTIONS = new Set(OPTIONS.filter((option) => option.value !== undefined).map((option) => option.name));
var REPEATABLE_OPTIONS = new Set(OPTIONS.filter((option) => option.repeatable).map((option) => option.name));
var OPTION_COLUMN = 28;
function formatOptionsHelp() {
  const rows = OPTIONS.filter((option) => option.help).map((option) => ({ flag: `--${option.name}${option.value ? ` ${option.value}` : ""}`, help: option.help })).concat([
    { flag: "-h, --help", help: ["Show this help"] },
    { flag: "-v, --version", help: ["Show the story CLI version"] }
  ]);
  const lines = [];
  for (const row of rows) {
    const head = `  ${row.flag}`;
    const [first, ...rest] = row.help;
    lines.push(head.length < OPTION_COLUMN ? `${head.padEnd(OPTION_COLUMN)}${first}` : `${head}  ${first}`);
    for (const line of rest) {
      lines.push(`${" ".repeat(OPTION_COLUMN)}${line}`);
    }
  }
  return lines;
}
function isKnownOptionToken(token) {
  if (token === "-h" || token === "-v") {
    return true;
  }
  if (!token.startsWith("--")) {
    return false;
  }
  const equalIndex = token.indexOf("=");
  const key = token.slice(2, equalIndex === -1 ? undefined : equalIndex);
  return key === "help" || key === "version" || BOOLEAN_OPTIONS.has(key) || VALUE_OPTIONS.has(key);
}
function addOption(options, key, value) {
  const stored = BOOLEAN_OPTIONS.has(key) ? normalizeBooleanValue(key, value) : value;
  if (options[key] === undefined || !REPEATABLE_OPTIONS.has(key)) {
    options[key] = stored;
  } else {
    options[key] = Array.isArray(options[key]) ? options[key].concat(stored) : [options[key], stored];
  }
}
function normalizeBooleanValue(key, value) {
  if (typeof value !== "string") {
    return Boolean(value);
  }
  const lower = value.trim().toLowerCase();
  if (lower === "false" || lower === "0" || lower === "no" || lower === "off") {
    return false;
  }
  if (lower === "true" || lower === "1" || lower === "yes" || lower === "on") {
    return true;
  }
  throw new Error(`Unknown value "${value}" for --${key}: expected true or false`);
}
function isTruthy(value) {
  const current = Array.isArray(value) ? value[value.length - 1] : value;
  if (typeof current === "string") {
    const lower = current.trim().toLowerCase();
    if (lower === "false" || lower === "0" || lower === "no" || lower === "off" || lower === "") {
      return false;
    }
    return true;
  }
  return Boolean(current);
}
function isBooleanLiteralToken(token) {
  return typeof token === "string" && /^(true|false|0|1|yes|no|on|off)$/i.test(token);
}
function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0;index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      options.version = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equalIndex = arg.indexOf("=");
    const key = arg.slice(2, equalIndex === -1 ? undefined : equalIndex);
    const inlineValue = equalIndex === -1 ? undefined : arg.slice(equalIndex + 1);
    if (BOOLEAN_OPTIONS.has(key)) {
      if (inlineValue !== undefined) {
        addOption(options, key, inlineValue);
        continue;
      }
      const nextToken = argv[index + 1];
      if (isBooleanLiteralToken(nextToken)) {
        addOption(options, key, nextToken);
        index += 1;
        continue;
      }
      addOption(options, key, true);
      continue;
    }
    if (VALUE_OPTIONS.has(key)) {
      if (inlineValue !== undefined) {
        addOption(options, key, inlineValue);
        continue;
      }
      const nextValue = argv[index + 1];
      if (nextValue === undefined || isKnownOptionToken(nextValue) || nextValue.startsWith("--")) {
        throw new Error(`Missing value for --${key}: expected a value`);
      }
      addOption(options, key, nextValue);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option --${key}`);
  }
  return { positionals, options };
}

// src/commands.js
var COMMANDS = [
  {
    name: "init",
    usage: "init <title>",
    summary: ["Scaffold a story project"],
    project: "none",
    run({ parsed, io, cwd }) {
      const result = createStoryProject({
        title: parsed.positionals.slice(1).join(" "),
        cwd,
        dir: parsed.options.dir,
        genre: parsed.options.genre,
        subGenre: parsed.options["sub-genre"],
        settingEra: parsed.options["setting-era"],
        themes: collectThemes(parsed.options),
        pov: parsed.options.pov,
        tense: parsed.options.tense,
        form: parsed.options.form,
        synopsis: parsed.options.synopsis,
        series: parsed.options.series,
        bookNumber: parsed.options["book-number"],
        follows: parsed.options.follows,
        precedes: parsed.options.precedes,
        force: isTruthy(parsed.options.force)
      });
      io.stdout.write(`Created story project: ${result.root}
`);
      for (const linkedBook of result.linkedBooks) {
        io.stdout.write(`Linked series backlink in ${path6.join(linkedBook, "story.md")}
`);
      }
      return 0;
    }
  },
  {
    name: "import",
    usage: "import <source>",
    summary: ["Split an existing manuscript into a new story project"],
    project: "none",
    run({ parsed, io, cwd }) {
      const result = importManuscript({
        source: parsed.positionals[1],
        title: parsed.options.title,
        cwd,
        dir: parsed.options.dir,
        genre: parsed.options.genre,
        subGenre: parsed.options["sub-genre"],
        settingEra: parsed.options["setting-era"],
        themes: collectThemes(parsed.options),
        pov: parsed.options.pov,
        tense: parsed.options.tense,
        synopsis: parsed.options.synopsis,
        force: isTruthy(parsed.options.force)
      });
      io.stdout.write(`Imported ${result.chapters} chapters (${result.words} words) into ${result.root}
`);
      if (result.candidates.length > 0) {
        io.stdout.write(`Entity candidates (review, then create with story add):
`);
        for (const candidate of result.candidates) {
          io.stdout.write(`- ${candidate.name} (${candidate.count} mentions)
`);
        }
      }
      return 0;
    }
  },
  {
    name: "validate",
    usage: "validate [path]",
    summary: ["Check project structure, frontmatter, and registries"],
    project: "positional",
    run: ({ io, root }) => reportResult(io, validateProject(root()), "Project is valid", "Project validation failed")
  },
  {
    name: "reindex",
    usage: "reindex [path]",
    summary: ["Rebuild registry tables from markdown files"],
    project: "positional",
    run({ io, root }) {
      const result = reindexProject(root());
      io.stdout.write(result.changed.length === 0 ? `Registries already up to date
` : `Updated ${result.changed.length} registries
`);
      return 0;
    }
  },
  {
    name: "wordcount",
    usage: "wordcount [path]",
    summary: ["Count chapter prose words"],
    project: "positional",
    run({ parsed, io, root }) {
      const result = computeWordCounts(root(), { write: isTruthy(parsed.options.write) });
      for (const chapter of result.chapters) {
        io.stdout.write(`${chapter.file}: ${chapter.wordCount}
`);
      }
      io.stdout.write(`Total: ${result.total}
`);
      return 0;
    }
  },
  {
    name: "links",
    usage: "links [path]",
    summary: ["Check cross-reference targets and backlinks"],
    project: "positional",
    run: ({ io, root }) => reportResult(io, validateLinks(root()), "Links are valid", "Link check failed")
  },
  {
    name: "continuity",
    usage: "continuity [path]",
    summary: [
      "Check deterministic continuity contracts: deaths,",
      "promises, questions, casts, and durable state.",
      "Findings matching continuity/exemptions.md are",
      "reported as dismissed"
    ],
    project: "positional",
    run: ({ io, root }) => reportResult(io, checkProjectContinuity(root()), "Continuity is consistent", "Continuity check failed")
  },
  {
    name: "knowledge",
    usage: "knowledge <id>",
    summary: ["List what a character knew at a chapter; requires --at"],
    project: "flag",
    run({ parsed, io, root }) {
      const characterId = parsed.positionals[1];
      const atChapterId = parsed.options.at;
      if (!characterId || typeof atChapterId !== "string") {
        io.stderr.write(`Usage: story knowledge <character-id> --at <chapter-id> [--path <project>]
`);
        return 1;
      }
      const entries = knowledgeAtChapter(root(), characterId, atChapterId);
      if (entries.length === 0) {
        io.stdout.write(`No recorded knowledge for ${characterId} at ${atChapterId}
`);
        return 0;
      }
      for (const entry of entries) {
        const source = entry.learnedIn === "" ? "pre-existing knowledge" : `learned in ${entry.learnedIn}`;
        io.stdout.write(`- ${entry.knows} (${source})
`);
      }
      return 0;
    }
  },
  {
    name: "compare",
    usage: "compare [path]",
    summary: [
      "Compare chapters with an earlier draft: word changes,",
      "added and removed chapters, and unchanged paragraphs;",
      "requires --ref or --against"
    ],
    project: "positional",
    run({ parsed, io, cwd, root }) {
      const comparison = compareProject(root(), { ref: parsed.options.ref, against: parsed.options.against, cwd });
      io.stdout.write(formatComparison(comparison, comparison.label));
      return reportResult(io, comparison, "Comparison complete", "Comparison failed");
    }
  },
  {
    name: "progress",
    usage: "progress [path]",
    summary: [
      "Show words against target-words, deadline, chapter",
      "targets, and logged sessions; --log records today"
    ],
    project: "positional",
    run({ parsed, io, root }) {
      const progress = projectProgress(root(), { log: isTruthy(parsed.options.log), date: parsed.options.date });
      if (progress.logged) {
        io.stdout.write(`Logged ${progress.logged.words} words for ${progress.logged.date} in ${progress.logged.file}
`);
      }
      io.stdout.write(formatProgress(progress));
      return reportResult(io, progress, "Progress checked", "Progress check failed");
    }
  },
  {
    name: "timeline",
    usage: "timeline [path]",
    summary: [
      "Show scenes in story-time order (marking scenes told",
      "out of order), POV balance, and character presence"
    ],
    project: "positional",
    run({ io, root }) {
      const timeline2 = storyTimeline(root());
      io.stdout.write(formatTimeline(timeline2, timeline2.totalChapters));
      return reportResult(io, timeline2, "Timeline built", "Timeline failed");
    }
  },
  {
    name: "prose",
    usage: "prose [path]",
    summary: [
      "Lint chapter prose: filter words, adverbs, dialogue",
      "tags, echoes, rhythm, repeated phrases, similar",
      "names, and style-sheet.md spellings and watch words"
    ],
    project: "positional",
    run({ io, root }) {
      const report = proseReport(root());
      io.stdout.write(formatProseReport(report));
      return reportResult(io, report, "Prose check complete", "Prose check failed");
    }
  },
  {
    name: "diagram",
    usage: "diagram <kind>",
    summary: [
      "Print Mermaid source for relationships (family",
      "tree), locations (route map), timeline, clues, or",
      "arcs; --out writes it to a file"
    ],
    project: "flag",
    run({ parsed, io, root }) {
      const result = diagramProject(root(), { kind: parsed.positionals[1], out: parsed.options.out });
      if (result.ok) {
        io.stdout.write(result.outFile === undefined ? result.text : `Wrote ${parsed.positionals[1]} diagram to ${result.outFile}
`);
        return 0;
      }
      return reportResult(io, result, "Diagram built", "Diagram failed");
    }
  },
  {
    name: "names",
    usage: "names <name...>",
    summary: [
      "Check candidate names against characters, places,",
      "factions, artifacts, systems, and glossary terms:",
      "clashes are errors, look-alikes are warnings"
    ],
    project: "flag",
    run({ parsed, io, root }) {
      const report = namesReport(root(), parsed.positionals.slice(1));
      io.stdout.write(formatNames(report));
      return reportResult(io, report, "Names checked", "Name check failed");
    }
  },
  {
    name: "pacing",
    usage: "pacing [path]",
    summary: [
      "Show words, scenes, sequels, scene outcomes, and",
      "chapter hooks per chapter; flag easy-win runs,",
      "missing sequels, and length outliers"
    ],
    project: "positional",
    run({ io, root }) {
      const report = pacingReport(root());
      io.stdout.write(formatPacing(report));
      return reportResult(io, report, "Pacing check complete", "Pacing check failed");
    }
  },
  {
    name: "clues",
    usage: "clues [path]",
    summary: [
      "Show the clue plant/reveal grid by chapter and flag",
      "fair-play problems: late plants, unplanted reveals,",
      "and red herrings never debunked"
    ],
    project: "positional",
    run({ io, root }) {
      const report = clueReport(root());
      io.stdout.write(formatClueMatrix(report));
      return reportResult(io, report, "Clue check complete", "Clue check failed");
    }
  },
  {
    name: "voices",
    usage: "voices [path]",
    summary: [
      "Fingerprint each character's tagged dialogue and flag",
      "voice-avoid words, unused voice-words, and",
      "characters who sound alike"
    ],
    project: "positional",
    run({ io, root }) {
      const report = voicesReport(root());
      io.stdout.write(formatVoices(report));
      return reportResult(io, report, "Voice check complete", "Voice check failed");
    }
  },
  {
    name: "series",
    usage: "series [path]",
    summary: ["Order linked prequels and sequels and check shared", "canon across books"],
    project: "positional",
    run({ io, root }) {
      const report = seriesReport(root());
      io.stdout.write(formatSeriesReport(report));
      return reportResult(io, report, "Series is consistent", "Series check failed");
    }
  },
  {
    name: "passes",
    usage: "passes [path]",
    summary: [
      "Show the named revision passes in story.md;",
      "--init adds the default ladder, --start and --done",
      "mark a pass"
    ],
    project: "positional",
    run({ parsed, io, root }) {
      const result = projectPasses(root(), {
        init: isTruthy(parsed.options.init),
        start: parsed.options.start,
        done: parsed.options.done
      });
      if (result.changed) {
        io.stdout.write(`Updated revision-passes in story.md
`);
      }
      io.stdout.write(formatPasses(result.passes));
      return 0;
    }
  },
  {
    name: "report",
    usage: "report [path]",
    summary: ["Summarize project inventory, progress, and checks"],
    project: "positional",
    run({ parsed, io, root }) {
      io.stdout.write(formatProjectReport(projectReport(root()), { actionable: isTruthy(parsed.options.actionable) }));
      return 0;
    }
  },
  {
    name: "next",
    usage: "next [path]",
    summary: ["Recommend the next writing and maintenance actions"],
    project: "positional",
    run({ io, root }) {
      io.stdout.write(formatActionReport(projectActions(root())));
      return 0;
    }
  },
  {
    name: "doctor",
    usage: "doctor [path]",
    summary: ["Show health checks plus actionable repair steps"],
    project: "positional",
    run({ io, root }) {
      io.stdout.write(formatDoctorReport(projectActions(root())));
      return 0;
    }
  },
  {
    name: "migrate",
    usage: "migrate [path]",
    summary: ["Upgrade a project to the current schema"],
    project: "positional",
    run({ io, root }) {
      const result = migrateProject(root());
      io.stdout.write(result.changed.length === 0 ? `Project already uses the current schema
` : `Migrated project to current schema: ${result.changed.length} changes
`);
      return 0;
    }
  },
  {
    name: "add",
    usage: "add <kind> <name>",
    summary: ["Create an entity file and reindex registries"],
    project: "flag",
    run({ parsed, io, root }) {
      const result = createEntity(root(), {
        ...parsed.options,
        kind: parsed.positionals[1],
        name: parsed.positionals.slice(2).join(" ")
      });
      io.stdout.write(`Created ${result.kind} ${result.id}: ${result.file}
`);
      return 0;
    }
  },
  {
    name: "rename",
    usage: "rename <kind> <id> <name>",
    summary: ["Rename an entity and update id references"],
    project: "flag",
    run({ parsed, io, root }) {
      const result = renameEntity(root(), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2],
        name: parsed.positionals.slice(3).join(" ")
      });
      io.stdout.write(`Renamed ${result.kind} ${result.oldId} to ${result.id}: ${result.file}
`);
      return 0;
    }
  },
  {
    name: "remove",
    usage: "remove <kind> <id>",
    summary: ["Remove an entity and scrub id references"],
    project: "flag",
    run({ parsed, io, root }) {
      const result = removeEntity(root(), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2]
      });
      io.stdout.write(`Removed ${result.kind} ${result.id}: ${result.file}
`);
      return 0;
    }
  },
  {
    name: "export",
    usage: "export [path]",
    summary: ["Combine front matter, chapters, and back matter into a", "manuscript markdown file"],
    project: "positional",
    run({ parsed, io, root }) {
      const result = exportManuscript(root(), { out: parsed.options.out });
      io.stdout.write(`Exported ${result.chapters} chapters to ${result.outFile}
`);
      return 0;
    }
  },
  {
    name: "build",
    usage: "build [path]",
    summary: [
      "Build a disposable book artifact in dist/: markdown,",
      "epub, docx, shunn, html (review copy with paragraph",
      "anchors), print (paged-media interior),",
      "narration (audiobook script), or metadata",
      "(retailer sheet)"
    ],
    project: "positional",
    run({ parsed, io, root }) {
      const result = buildBook(root(), {
        out: parsed.options.out,
        format: parsed.options.format,
        shunn: isTruthy(parsed.options.shunn),
        trim: parsed.options.trim
      });
      io.stdout.write(`Built ${result.chapters} chapters as ${result.format} to ${result.outFile}
`);
      return 0;
    }
  },
  {
    name: "synopsis",
    usage: "synopsis [path]",
    summary: ["Build a deterministic 1- or 3-page synopsis from arcs"],
    project: "positional",
    run({ parsed, io, root }) {
      const result = synopsisBook(root(), { pages: parsed.options.pages, out: parsed.options.out });
      if (result.outFile === undefined) {
        io.stdout.write(result.text);
      } else {
        io.stdout.write(`Wrote synopsis to ${result.outFile}
`);
      }
      return 0;
    }
  }
];
function collectThemes(options) {
  return [].concat(options.theme ?? []).concat(options.themes ?? []).filter((value) => value !== undefined && value !== true);
}
function reportResult(io, result, successMessage, failureMessage) {
  const dismissed = result.dismissed ?? [];
  io.stderr.write(`${result.ok ? successMessage : failureMessage}: ${result.errors.length} errors, ${result.warnings.length} warnings, ${dismissed.length} dismissed
`);
  for (const error of result.errors) {
    io.stderr.write(`error: ${error}
`);
  }
  for (const warning of result.warnings) {
    io.stderr.write(`warning: ${warning}
`);
  }
  for (const entry of dismissed) {
    io.stderr.write(`dismissed: ${entry.finding} (exemption: ${entry.reason})
`);
  }
  return result.ok ? 0 : 1;
}

// src/version.js
var VERSION = "0.8.2";

// src/cli.js
var COMMANDS_BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));
var COMMAND_COLUMN = 21;
var HELP = [
  "Usage: story <command> [options]",
  "",
  "Commands:",
  ...formatCommandsHelp(),
  "",
  "Options:",
  ...formatOptionsHelp(),
  "",
  "Values beginning with a dash may also use the --option=value form.",
  ""
].join(`
`);
function formatCommandsHelp() {
  const lines = [];
  for (const command of COMMANDS) {
    const head = `  ${command.usage}`;
    const [first, ...rest] = command.summary;
    if (head.length < COMMAND_COLUMN - 1) {
      lines.push(`${head.padEnd(COMMAND_COLUMN)}${first}`);
    } else {
      lines.push(head, `${" ".repeat(COMMAND_COLUMN)}${first}`);
    }
    for (const line of rest) {
      lines.push(`${" ".repeat(COMMAND_COLUMN)}${line}`);
    }
  }
  return lines;
}
function runCli(argv, io) {
  try {
    const parsed = parseArgs(argv);
    const cwd = io.cwd ?? process.cwd();
    const name = parsed.positionals[0];
    if (parsed.options.version) {
      io.stdout.write(`${VERSION}
`);
      return 0;
    }
    if (!name || name === "help" || parsed.options.help) {
      io.stdout.write(HELP);
      return 0;
    }
    const command = COMMANDS_BY_NAME.get(name);
    if (!command) {
      io.stderr.write(`Unknown command: ${name}

${HELP}`);
      return 1;
    }
    if (command.project === "none" && parsed.options.path !== undefined) {
      io.stderr.write(`${name} uses --dir for the target directory. --path is the project root for other commands.
`);
      return 1;
    }
    return command.run({ parsed, io, cwd, root: () => resolveRoot(cwd, parsed, name) });
  } catch (error) {
    io.stderr.write(`${error.message}
`);
    return 1;
  }
}
function lastOptionValue(value) {
  return Array.isArray(value) ? value[value.length - 1] : value;
}
function resolveRoot(cwd, parsed, name) {
  const flagPath = lastOptionValue(parsed.options.path);
  if (COMMANDS_BY_NAME.get(name)?.project !== "positional") {
    return path7.resolve(cwd, flagPath ?? ".");
  }
  const positionalPath = parsed.positionals[1];
  if (positionalPath !== undefined && flagPath !== undefined) {
    const resolvedPositional = path7.resolve(cwd, positionalPath);
    const resolvedFlag = path7.resolve(cwd, flagPath);
    if (resolvedPositional !== resolvedFlag) {
      throw new Error(`Conflicting project paths: ${positionalPath} and --path ${flagPath}. Use either a positional path or --path, not both.`);
    }
    return resolvedFlag;
  }
  return path7.resolve(cwd, flagPath ?? positionalPath ?? ".");
}

// bin/story.js
process.exitCode = runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr
});

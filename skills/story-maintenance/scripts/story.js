#!/usr/bin/env node

// src/cli.js
import path5 from "node:path";

// src/import.js
import fs3 from "node:fs";
import path4 from "node:path";

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
        if (isPlainObject(item)) {
          const entries = Object.entries(item);
          const [firstKey, firstValue] = entries[0];
          lines.push(`  - ${firstKey}: ${formatScalar(firstValue)}`);
          for (const [childKey, childValue] of entries.slice(1)) {
            lines.push(`    ${childKey}: ${formatScalar(childValue)}`);
          }
        } else {
          lines.push(`  - ${formatScalar(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }
  lines.push("---", "", "");
  return lines.join(`
`);
}
function replaceFrontmatter(markdown, data) {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) {
    throw new Error("Cannot replace missing YAML frontmatter");
  }
  return `${stringifyFrontmatter(data)}${markdown.slice(match[0].length)}`;
}
function parseYaml(source) {
  const lines = source.split(/\r?\n/);
  const data = {};
  for (let index = 0;index < lines.length; ) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
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
      index += 1;
      continue;
    }
    const parsed = parseArray(lines, index + 1);
    if (parsed.nextIndex === index + 1) {
      data[key] = "";
      index += 1;
      continue;
    }
    data[key] = parsed.items;
    index = parsed.nextIndex;
  }
  return data;
}
function parseArray(lines, startIndex) {
  const items = [];
  let index = startIndex;
  while (index < lines.length) {
    const itemMatch = /^  -(?:\s+(.*))?$/.exec(lines[index]);
    if (!itemMatch) {
      break;
    }
    const itemText = itemMatch[1] ?? "";
    const objectMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(itemText);
    if (!objectMatch) {
      items.push(parseScalar(itemText));
      index += 1;
      continue;
    }
    const item = {
      [objectMatch[1]]: parseScalar(objectMatch[2])
    };
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
  return { items, nextIndex: index };
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
  if (typeof value === "number") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (text === "" || text === "[]" || /^-?\d+(\.\d+)?$/.test(text) || /^\s|\s$/.test(text) || /[:#\n"']/.test(text)) {
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
function wordCount(markdown) {
  const normalized = markdown.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/\[[^\]]+\]\([^)]+\)/g, " ").replace(/[#>*_~|:]/g, " ");
  const words = normalized.match(/[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu);
  return words ? words.length : 0;
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
import fs2 from "node:fs";
import path3 from "node:path";

// src/continuity.js
import path from "node:path";
var CHEKHOV_CHAPTER_GAP = 3;
function checkContinuity(project) {
  const errors = [];
  const warnings = [];
  const context = {
    chapterNumbers: new Map(project.chapters.map((chapter) => [chapter.id, chapter.number])),
    characters: new Map(project.characters.map((character) => [character.id, character])),
    locations: new Set(project.locations.map((location) => location.id)),
    artifacts: new Map(project.artifacts.map((artifact) => [artifact.id, artifact])),
    factions: new Set(project.factions.map((faction) => faction.id)),
    latestChapter: project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0)
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
    if (promise.status === "planted" && plantedNumber !== undefined && context.latestChapter - plantedNumber >= CHEKHOV_CHAPTER_GAP) {
      warnings.push(`${label} was planted in ${promise.planted}, ${context.latestChapter - plantedNumber} chapters ago, and has no payoff yet`);
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
    if (clue.status === "planted" && plantedNumber !== undefined && context.latestChapter - plantedNumber >= CHEKHOV_CHAPTER_GAP) {
      warnings.push(`${label} was planted in ${clue.planted}, ${context.latestChapter - plantedNumber} chapters ago, and has no payoff yet`);
    }
  }
}
function checkContinuityState(project, context, errors, warnings) {
  if (!project.continuity) {
    return;
  }
  const label = path.join("continuity", "state.md");
  const data = project.continuity.data;
  const currentChapter = data["current-chapter"];
  if (Number.isInteger(currentChapter)) {
    if (currentChapter > context.latestChapter) {
      errors.push(`${label} current-chapter ${currentChapter} is ahead of the latest chapter ${context.latestChapter}`);
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
      if (scene.mentions.includes(artifact) || scene.characters.includes(artifact)) {
        errors.push(`${sceneLabel} mentions ${artifact}, destroyed/lost since ${since}`);
      }
    }
    for (const chapter of project.chapters) {
      if (chapter.number <= sinceNumber) {
        continue;
      }
      if (chapter.mentions.includes(artifact) || chapter.characters.includes(artifact)) {
        errors.push(`Chapter ${chapter.number} mentions ${artifact}, destroyed/lost since ${since}`);
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
  checkChapterDates(project, warnings);
}
function checkSceneSequence(dated, errors, warnings) {
  for (let index = 1;index < dated.length; index += 1) {
    const previous = dated[index - 1];
    const current = dated[index];
    if (timestampBefore(current, previous)) {
      warnings.push(`${current.label} timestamp runs backward`);
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
function parseClockDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const days = Date.UTC(year, month - 1, day) / 86400000;
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
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
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

// src/series.js
import fs from "node:fs";
import path2 from "node:path";
var SERIES_LINK_INVERSES = [["follows", "precedes"], ["precedes", "follows"]];
var SHARED_CANON = [
  ["characters", "Characters", "name"],
  ["locations", "Locations", "name"],
  ["systems", "Systems", "name"],
  ["factions", "Factions", "name"],
  ["artifacts", "Artifacts", "name"],
  ["glossaryTerms", "Glossary terms", "term"]
];
function seriesLinkPath(fromRoot, toRoot) {
  return path2.relative(fromRoot, toRoot).split(path2.sep).join("/");
}
function seriesLinks(root, data, field) {
  const values = Array.isArray(data[field]) ? data[field] : [];
  return values.filter((value) => typeof value === "string" && value.trim() !== "").map((value) => path2.resolve(root, value));
}
function readBookFrontmatter(root) {
  const storyPath = path2.join(root, "story.md");
  if (!fs.existsSync(storyPath)) {
    return null;
  }
  return parseFrontmatter(fs.readFileSync(storyPath, "utf8"), storyPath).data;
}
function validateSeriesLinks(root, data, errors) {
  for (const [field, inverse] of SERIES_LINK_INVERSES) {
    for (const target of seriesLinks(root, data, field)) {
      const label = `story.md ${field} ${seriesLinkPath(root, target)}`;
      if (target === root) {
        errors.push(`${label} points at this book`);
        continue;
      }
      let other;
      try {
        other = readBookFrontmatter(target);
      } catch (error) {
        errors.push(`${label}: ${error.message}`);
        continue;
      }
      if (!other) {
        errors.push(`${label} is not a story project: missing story.md`);
        continue;
      }
      if (!seriesLinks(target, other, inverse).includes(root)) {
        errors.push(`${label} is missing backlink: add ${seriesLinkPath(target, root)} to its ${inverse}`);
      }
      if (data.series !== undefined && other.series !== undefined && data.series !== other.series) {
        errors.push(`${label} belongs to series ${other.series}, not ${data.series}`);
      }
    }
  }
}
function withSeriesBacklink(targetRoot, field, linkedRoot) {
  const storyPath = path2.join(targetRoot, "story.md");
  const markdown = fs.readFileSync(storyPath, "utf8");
  const { data } = parseFrontmatter(markdown, storyPath);
  if (seriesLinks(targetRoot, data, field).includes(linkedRoot)) {
    return null;
  }
  const existing = Array.isArray(data[field]) ? data[field] : [];
  return replaceFrontmatter(markdown, { ...data, [field]: existing.concat(seriesLinkPath(targetRoot, linkedRoot)) });
}
function buildSeries(startRoot, scan) {
  const errors = [];
  const warnings = [];
  const books = discoverBooks(startRoot, scan, errors);
  const seriesIds = [...new Set(books.map((book) => book.series).filter((series) => series !== undefined))].sort();
  if (seriesIds.length > 1) {
    errors.push(`Linked books belong to different series: ${seriesIds.join(", ")}`);
  }
  const chronology = chronologicalOrder(books, errors);
  if (chronology) {
    checkSharedCanon(chronology, errors, warnings);
  }
  return {
    root: startRoot,
    series: books[0].series ?? seriesIds[0] ?? null,
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
function discoverBooks(startRoot, scan, errors) {
  const visited = new Map;
  const queue = [startRoot];
  while (queue.length > 0) {
    const root = queue.shift();
    if (visited.has(root)) {
      continue;
    }
    const label = seriesLinkPath(startRoot, root) || ".";
    if (!fs.existsSync(path2.join(root, "story.md"))) {
      errors.push(`${label} is not a story project: missing story.md`);
      visited.set(root, null);
      continue;
    }
    const project = scan(root);
    const data = project.story.data;
    const book = {
      root,
      label,
      project,
      title: String(data.title ?? path2.basename(root)),
      series: data.series,
      status: data.status,
      bookNumber: Number.isInteger(data["book-number"]) ? data["book-number"] : null,
      follows: seriesLinks(root, data, "follows"),
      precedes: seriesLinks(root, data, "precedes")
    };
    visited.set(root, book);
    queue.push(...book.follows, ...book.precedes);
  }
  return [...visited.values()].filter(Boolean);
}
function chronologicalOrder(books, errors) {
  const byRoot = new Map(books.map((book) => [book.root, book]));
  const later = new Map(books.map((book) => [book.root, new Set]));
  for (const book of books) {
    for (const earlier of book.follows) {
      if (byRoot.has(earlier) && earlier !== book.root) {
        later.get(earlier).add(book.root);
      }
    }
    for (const next of book.precedes) {
      if (byRoot.has(next) && next !== book.root) {
        later.get(book.root).add(next);
      }
    }
  }
  const indegree = new Map(books.map((book) => [book.root, 0]));
  for (const targets of later.values()) {
    for (const target of targets) {
      indegree.set(target, indegree.get(target) + 1);
    }
  }
  const order = [];
  const ready = books.filter((book) => indegree.get(book.root) === 0);
  while (ready.length > 0) {
    ready.sort(compareBooks);
    const book = ready.shift();
    order.push(book);
    for (const target of later.get(book.root)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) {
        ready.push(byRoot.get(target));
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
function compareBooks(left, right) {
  return (left.bookNumber ?? Infinity) - (right.bookNumber ?? Infinity) || left.title.localeCompare(right.title);
}
function checkSharedCanon({ order, later }, errors, warnings) {
  const reachable = new Map(order.map((book) => [book.root, collectLater(book.root, later, new Set)]));
  for (const book of order) {
    const earlierBooks = order.filter((candidate) => reachable.get(candidate.root).has(book.root));
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
  const file = path2.join(book.root, "continuity", "state.md");
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
  for (const [key, label] of SHARED_CANON) {
    const counts = new Map;
    for (const book of books) {
      for (const entity of book.project[key]) {
        counts.set(entity.id, (counts.get(entity.id) ?? 0) + 1);
      }
    }
    const ids = [...counts].filter(([, count]) => count > 1).map(([id]) => id).sort();
    if (ids.length > 0) {
      shared.push({ label, ids });
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
  return path2.join(book.label, path2.relative(book.root, file));
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
  [path3.join("characters", "_index.md"), "character-registry"],
  [path3.join("worldbuilding", "_index.md"), "world-registry"],
  [path3.join("plot", "_index.md"), "plot-registry"],
  [path3.join("plot", "timeline.md"), "timeline"],
  [path3.join("chapters", "_index.md"), "chapter-registry"],
  [path3.join("scenes", "_index.md"), "scene-registry"],
  [path3.join("continuity", "questions", "_index.md"), "question-registry"],
  [path3.join("continuity", "promises", "_index.md"), "promise-registry"],
  [path3.join("continuity", "clues", "_index.md"), "clue-registry"],
  [path3.join("glossary", "_index.md"), "glossary-registry"]
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
var RELATIONSHIP_INVERSES = new Map([
  ["parent", "child"],
  ["child", "parent"],
  ["grandparent", "grandchild"],
  ["grandchild", "grandparent"],
  ["uncle", "nephew"],
  ["aunt", "niece"],
  ["nephew", "uncle"],
  ["niece", "aunt"],
  ["mentor", "student"],
  ["student", "mentor"],
  ["employer", "subordinate"],
  ["subordinate", "employer"]
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
  const root = path3.resolve(cwd, options.dir ?? storyId);
  if (fs2.existsSync(root) && !options.force) {
    throw new Error(`${root} already exists. Use --force to overwrite starter files.`);
  }
  const series = resolveSeriesOptions(root, cwd, options);
  const inherited = series.linked[0]?.data ?? {};
  const themes = normalizeList(options.themes, ["change"]);
  fs2.mkdirSync(path3.join(root, "characters"), { recursive: true });
  fs2.mkdirSync(path3.join(root, "worldbuilding", "locations"), { recursive: true });
  fs2.mkdirSync(path3.join(root, "worldbuilding", "systems"), { recursive: true });
  fs2.mkdirSync(path3.join(root, "worldbuilding", "factions"), { recursive: true });
  fs2.mkdirSync(path3.join(root, "worldbuilding", "artifacts"), { recursive: true });
  fs2.mkdirSync(path3.join(root, "plot", "arcs"), { recursive: true });
  fs2.mkdirSync(path3.join(root, "chapters"), { recursive: true });
  fs2.mkdirSync(path3.join(root, "scenes"), { recursive: true });
  fs2.mkdirSync(path3.join(root, "continuity", "questions"), { recursive: true });
  fs2.mkdirSync(path3.join(root, "continuity", "promises"), { recursive: true });
  fs2.mkdirSync(path3.join(root, "continuity", "clues"), { recursive: true });
  fs2.mkdirSync(path3.join(root, "glossary", "terms"), { recursive: true });
  writeFile(path3.join(root, "story.md"), storyBible({
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
    synopsis: options.synopsis ?? "Add a 2-3 sentence synopsis here."
  }), { root });
  writeFile(path3.join(root, "characters", "_index.md"), characterIndex(storyId, [], "", ""), { root });
  writeFile(path3.join(root, "worldbuilding", "_index.md"), worldIndex(storyId, [], [], [], [], ""), { root });
  writeFile(path3.join(root, "plot", "_index.md"), plotIndex(storyId, "three-act", [], "", ""), { root });
  writeFile(path3.join(root, "plot", "timeline.md"), timeline(storyId), { root });
  writeFile(path3.join(root, "chapters", "_index.md"), chapterIndex(storyId, []), { root });
  writeFile(path3.join(root, "scenes", "_index.md"), sceneIndex(storyId, []), { root });
  writeFile(path3.join(root, "continuity", "state.md"), continuityState(storyId), { root });
  writeFile(path3.join(root, "continuity", "questions", "_index.md"), questionIndex(storyId, []), { root });
  writeFile(path3.join(root, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), { root });
  writeFile(path3.join(root, "continuity", "clues", "_index.md"), clueIndex(storyId, []), { root });
  writeFile(path3.join(root, "glossary", "_index.md"), glossaryIndex(storyId, []), { root });
  const linkedBooks = [];
  for (const book of series.linked) {
    const updated = withSeriesBacklink(book.root, book.inverse, root);
    if (updated !== null) {
      writeFile(path3.join(book.root, "story.md"), updated, { root: book.root });
      linkedBooks.push(book.root);
    }
  }
  return { root, storyId, linkedBooks, files: REQUIRED_PATHS.filter((entry) => entry.endsWith(".md")) };
}
function resolveSeriesOptions(root, cwd, options) {
  const linked = [];
  for (const [field, inverse] of [["follows", "precedes"], ["precedes", "follows"]]) {
    for (const value of asArray(options[field]).filter((item) => typeof item === "string" && item.trim() !== "")) {
      const bookRoot = path3.resolve(cwd, value);
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
    bookNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : undefined;
  }
  const linkPaths = (field) => linked.filter((book) => book.field === field).map((book) => seriesLinkPath(root, book.root));
  return { linked, series, bookNumber, follows: linkPaths("follows"), precedes: linkPaths("precedes") };
}
function scanProject(root) {
  const projectRoot = path3.resolve(root);
  const scanErrors = [];
  const storyPath = requireStoryFile(projectRoot);
  let story;
  try {
    story = readMarkdown(storyPath, projectRoot);
  } catch (error) {
    scanErrors.push(`story.md: ${error.message}`);
    story = { data: { title: path3.basename(projectRoot) }, body: "", rawMarkdown: "" };
  }
  const storyId = kebabCase(story.data.title ?? path3.basename(projectRoot));
  let continuity = null;
  const continuityPath = path3.join(projectRoot, "continuity", "state.md");
  if (fs2.existsSync(continuityPath)) {
    try {
      continuity = readMarkdown(continuityPath, projectRoot);
    } catch (error) {
      scanErrors.push(`${path3.join("continuity", "state.md")}: ${error.message}`);
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
      locations: asArray(data.locations)
    }), scanErrors),
    locations: readEntityFiles(projectRoot, path3.join("worldbuilding", "locations"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      region: data.region ?? "",
      notableCharacters: asArray(data["notable-characters"])
    }), scanErrors),
    systems: readEntityFiles(projectRoot, path3.join("worldbuilding", "systems"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? ""
    }), scanErrors),
    factions: readEntityFiles(projectRoot, path3.join("worldbuilding", "factions"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      members: asArray(data.members),
      locations: asArray(data.locations)
    }), scanErrors),
    artifacts: readEntityFiles(projectRoot, path3.join("worldbuilding", "artifacts"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      owner: data.owner ?? "",
      location: data.location ?? ""
    }), scanErrors),
    arcs: readEntityFiles(projectRoot, path3.join("plot", "arcs"), (id, file, data) => ({
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
      wordCount: wordCount(chapterProse(markdown.body)),
      date: String(data.date ?? ""),
      time: String(data.time ?? ""),
      mode: String(data.mode ?? "")
    }), scanErrors).sort((left, right) => left.number - right.number || left.file.localeCompare(right.file)),
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
      dilemma: String(data.dilemma ?? ""),
      flashbackTo: String(data["flashback-to"] ?? "")
    }), scanErrors).sort((left, right) => left.chapter.localeCompare(right.chapter) || left.scene - right.scene || left.file.localeCompare(right.file)),
    questions: readEntityFiles(projectRoot, path3.join("continuity", "questions"), (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      introduced: String(data.introduced ?? ""),
      resolved: String(data.resolved ?? ""),
      characters: asArray(data.characters)
    }), scanErrors),
    promises: readEntityFiles(projectRoot, path3.join("continuity", "promises"), (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      planted: String(data.planted ?? ""),
      payoff: String(data.payoff ?? ""),
      arcs: asArray(data.arcs),
      characters: asArray(data.characters)
    }), scanErrors),
    clues: readEntityFiles(projectRoot, path3.join("continuity", "clues"), (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      planted: String(data.planted ?? ""),
      payoff: String(data.payoff ?? ""),
      significanceDelayed: Boolean(data["significance-delayed"] ?? false),
      characters: asArray(data.characters),
      arcs: asArray(data.arcs)
    }), scanErrors),
    glossaryTerms: readEntityFiles(projectRoot, path3.join("glossary", "terms"), (id, file, data) => ({
      id,
      file,
      term: data.term ?? titleCaseSlug(id),
      category: data.category ?? "",
      aliases: asArray(data.aliases)
    }), scanErrors),
    exemptions: readExemptions(projectRoot),
    continuity
  };
}
function validateProject(root) {
  const projectRoot = path3.resolve(root);
  const errors = [];
  const warnings = [];
  for (const requiredPath of REQUIRED_PATHS) {
    if (!fs2.existsSync(path3.join(projectRoot, requiredPath))) {
      errors.push(`Missing required path: ${requiredPath}`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  const project = scanProject(projectRoot);
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
  collectStrayFileWarnings(project, warnings);
  const indexChecks = [
    [path3.join("characters", "_index.md"), project.characters.map((item) => `](${item.id}.md)`)],
    [path3.join("worldbuilding", "_index.md"), project.locations.map((item) => `](locations/${item.id}.md)`).concat(project.systems.map((item) => `](systems/${item.id}.md)`)).concat(project.factions.map((item) => `](factions/${item.id}.md)`)).concat(project.artifacts.map((item) => `](artifacts/${item.id}.md)`))],
    [path3.join("plot", "_index.md"), project.arcs.map((item) => `](arcs/${item.id}.md)`)],
    [path3.join("chapters", "_index.md"), project.chapters.map((item) => `](${path3.basename(item.file)})`)],
    [path3.join("scenes", "_index.md"), project.scenes.map((item) => `](${item.id}.md)`)],
    [path3.join("continuity", "questions", "_index.md"), project.questions.map((item) => `](${item.id}.md)`)],
    [path3.join("continuity", "promises", "_index.md"), project.promises.map((item) => `](${item.id}.md)`)],
    [path3.join("continuity", "clues", "_index.md"), project.clues.map((item) => `](${item.id}.md)`)],
    [path3.join("glossary", "_index.md"), project.glossaryTerms.map((item) => `](terms/${item.id}.md)`)]
  ];
  for (const [indexPath, links] of indexChecks) {
    const markdown = safeRead(path3.join(projectRoot, indexPath), projectRoot);
    for (const link of links) {
      if (!markdown.includes(link)) {
        warnings.push(`${indexPath} is missing registry link ${link}`);
      }
    }
  }
  for (const chapter of project.chapters) {
    if (chapter.declaredWordCount !== chapter.wordCount) {
      warnings.push(`${path3.relative(projectRoot, chapter.file)} declares ${chapter.declaredWordCount} words but contains ${chapter.wordCount}`);
    }
    if (!project.scenes.some((scene) => scene.chapter === chapter.id)) {
      warnings.push(`${path3.relative(projectRoot, chapter.file)} has no machine-readable scene records`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
function validateLinks(root) {
  const project = scanProject(root);
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
  for (const character of project.characters) {
    const label = relative2(project, character.file);
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
      } else if (!characters.get(target).relationships.some((entry) => entry && typeof entry === "object" && entry.character === character.id)) {
        errors.push(`${label} relationship to ${target} is missing backlink`);
      } else {
        const backlink = characters.get(target).relationships.find((entry) => entry && typeof entry === "object" && entry.character === character.id);
        const expectedType = inverseRelationshipType(relationship.type);
        if (expectedType && backlink.type !== expectedType) {
          errors.push(`${label} relationship ${relationship.type} to ${target} expects backlink type ${expectedType}, got ${backlink.type}`);
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
    const label = relative2(project, location.file);
    for (const characterId of location.notableCharacters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
      if (typeof characterId === "string" && characterId !== "" && characterId === kebabCase(characterId) && characters.has(characterId) && !characters.get(characterId).locations.includes(location.id)) {
        errors.push(`${label} notable character ${characterId} is missing location backlink`);
      }
    }
  }
  for (const arc of project.arcs) {
    const label = relative2(project, arc.file);
    for (const characterId of arc.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }
  for (const chapter of project.chapters) {
    const label = relative2(project, chapter.file);
    if (chapter.pov) {
      const povText = String(chapter.pov);
      if (povText !== kebabCase(povText)) {
        errors.push(`${label} references POV character ${povText} which must be kebab-case`);
      } else if (!characters.has(chapter.pov)) {
        errors.push(`${label} references missing POV character ${chapter.pov}`);
      }
    }
    for (const characterId of chapter.characters.concat(chapter.mentions)) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
    for (const locationId of chapter.locations) {
      checkIdReference(errors, label, locationId, "location", hasLocation);
    }
    for (const arcId of chapter.arcsAdvanced) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
  }
  for (const faction of project.factions) {
    const label = relative2(project, faction.file);
    for (const characterId of faction.members) {
      checkIdReference(errors, label, characterId, "member", hasCharacter);
    }
    for (const locationId of faction.locations) {
      checkIdReference(errors, label, locationId, "location", hasLocation);
    }
  }
  for (const artifact of project.artifacts) {
    const label = relative2(project, artifact.file);
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
    const label = relative2(project, scene.file);
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
    for (const characterId of scene.characters.concat(scene.mentions)) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
    for (const arcId of scene.arcsAdvanced) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
  }
  for (const question of project.questions) {
    const label = relative2(project, question.file);
    for (const chapterId of [question.introduced, question.resolved].filter(Boolean)) {
      checkIdReference(errors, label, chapterId, "chapter", hasChapter);
    }
    for (const characterId of question.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }
  for (const promise of project.promises) {
    const label = relative2(project, promise.file);
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
    const label = relative2(project, clue.file);
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
  const timelinePath = path3.join(project.root, "plot", "timeline.md");
  if (fs2.existsSync(timelinePath)) {
    try {
      const raw = fs2.readFileSync(timelinePath, "utf8");
      const body = parseFrontmatter(raw, timelinePath).body ?? raw;
      for (const token of extractChapterIdTokens(body)) {
        if (!chapterIds.has(token)) {
          errors.push(`${path3.join("plot", "timeline.md")} references missing chapter ${token}`);
        }
      }
      for (const target of extractMarkdownLinkTargets(body)) {
        checkBodyLinkTarget(project, path3.join("plot", "timeline.md"), target, errors);
      }
    } catch (error) {
      const message = `${path3.join("plot", "timeline.md")}: ${error.message}`;
      if (!errors.includes(message)) {
        errors.push(message);
      }
    }
  }
  for (const arc of project.arcs) {
    const label = relative2(project, arc.file);
    const body = readMarkdown(arc.file, project.root).body ?? "";
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
  const base = path3.basename(cleaned.split("#")[0].split("?")[0]);
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
  const known = new Set([
    ...project.characters.map((item) => item.id),
    ...project.locations.map((item) => item.id),
    ...project.systems.map((item) => item.id),
    ...project.factions.map((item) => item.id),
    ...project.artifacts.map((item) => item.id),
    ...project.arcs.map((item) => item.id),
    ...project.chapters.map((item) => item.id),
    ...project.scenes.map((item) => item.id),
    ...project.questions.map((item) => item.id),
    ...project.promises.map((item) => item.id),
    ...project.clues.map((item) => item.id),
    ...project.glossaryTerms.map((item) => item.id)
  ]);
  if (!known.has(id)) {
    errors.push(`${label} links to missing file ${cleaned}`);
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
  const projectRoot = path3.resolve(root);
  requireStoryFile(projectRoot);
  return buildSeries(projectRoot, scanProject);
}
function projectReport(root) {
  const project = scanProject(root);
  const validation = validateProject(project.root);
  const links = validateLinks(project.root);
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
    status: project.story.data.status,
    pov: project.story.data.pov,
    tense: project.story.data.tense,
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
      glossaryTerms: project.glossaryTerms.length,
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
    `- Glossary terms: ${report.counts.glossaryTerms}`,
    `- Total words: ${report.counts.words}`,
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
  const validation = validateProject(project.root);
  const links = validateLinks(project.root);
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
  const charactersIndexPath = path3.join(project.root, "characters", "_index.md");
  const worldIndexPath = path3.join(project.root, "worldbuilding", "_index.md");
  const plotIndexPath = path3.join(project.root, "plot", "_index.md");
  const chaptersIndexPath = path3.join(project.root, "chapters", "_index.md");
  const scenesIndexPath = path3.join(project.root, "scenes", "_index.md");
  const questionsIndexPath = path3.join(project.root, "continuity", "questions", "_index.md");
  const promisesIndexPath = path3.join(project.root, "continuity", "promises", "_index.md");
  const cluesIndexPath = path3.join(project.root, "continuity", "clues", "_index.md");
  const glossaryIndexPath = path3.join(project.root, "glossary", "_index.md");
  const existingCharacters = safeRead(charactersIndexPath, project.root);
  const existingWorld = safeRead(worldIndexPath, project.root);
  const existingPlot = safeRead(plotIndexPath, project.root);
  let plotStructure = "three-act";
  try {
    plotStructure = parseFrontmatter(existingPlot, "plot/_index.md").data.structure ?? "three-act";
  } catch {
    plotStructure = "three-act";
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
  refreshStoryField(path3.join(project.root, "plot", "timeline.md"), project.storyId, changed, project.root);
  refreshStoryField(path3.join(project.root, "continuity", "state.md"), project.storyId, changed, project.root);
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
      file: path3.relative(project.root, chapter.file),
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
function exportManuscript(root, options = {}) {
  const project = scanProject(root);
  if (project.chapters.length === 0) {
    throw new Error("No chapters found to export");
  }
  const output = resolveOutputPath(project, options.out, "manuscript.md", options.enforceRoot);
  const generatedBy = options.generatedBy ?? "story export";
  const manuscript = manuscriptParts(project);
  const lines = [`# ${manuscript.title}`, "", `<!-- Generated by ${generatedBy}. -->`, ""];
  for (const chapter of manuscript.chapters) {
    lines.push(`# Chapter ${chapter.number}: ${chapter.title}`, "", chapter.body, "");
  }
  writeFile(output.outFile, `${lines.join(`
`).trimEnd()}
`, output.writeOptions);
  return { outFile: output.outFile, chapters: project.chapters.length };
}
function buildBook(root, options = {}) {
  const format = normalizeBuildFormat(options.format ?? "markdown");
  const project = scanProject(root);
  const extension = format === "markdown" ? "md" : format === "shunn" ? "shunn.md" : format;
  const output = resolveOutputPath(project, options.out, path3.join("dist", `${project.storyId}.${extension}`));
  if (format === "markdown") {
    const result = exportManuscript(project.root, {
      out: output.outFile,
      generatedBy: "story build",
      enforceRoot: output.enforceRoot
    });
    return { ...result, format };
  }
  const manuscript = manuscriptParts(project);
  if (format === "shunn") {
    writeShunnMarkdown(output.outFile, manuscript, shunnMeta(project), output.writeOptions);
  } else if (format === "epub") {
    writeEpub(output.outFile, project.storyId, manuscript, output.writeOptions);
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
  const output = resolveOutputPath(project, options.out, path3.join("dist", `${project.storyId}.synopsis.md`));
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
  for (let index = 0;index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "." || char === "?" || char === "!") {
      const next = normalized[index + 1];
      if (next === undefined || next === " ") {
        sentences.push(normalized.slice(start, index + 1));
        start = index + 1;
      }
    }
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
  return `${lines.join(`
`).trimEnd()}
`;
}
function truncateWords(text, budget) {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const kept = words.slice(0, budget - 1);
  kept.push(`${words[budget - 1]}…`);
  return kept.join(" ");
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
  const projectRoot = path3.resolve(root);
  const storyPath = requireStoryFile(projectRoot);
  const story = readMarkdown(storyPath, projectRoot);
  const storyId = kebabCase(story.data.title ?? path3.basename(projectRoot));
  const changed = [];
  for (const directory of [
    path3.join("worldbuilding", "factions"),
    path3.join("worldbuilding", "artifacts"),
    "scenes",
    path3.join("continuity", "questions"),
    path3.join("continuity", "promises"),
    path3.join("continuity", "clues"),
    path3.join("glossary", "terms")
  ]) {
    ensureDirectory(path3.join(projectRoot, directory), changed, projectRoot);
  }
  ensureFile(path3.join(projectRoot, "scenes", "_index.md"), sceneIndex(storyId, []), changed, projectRoot);
  ensureFile(path3.join(projectRoot, "continuity", "state.md"), continuityState(storyId), changed, projectRoot);
  ensureFile(path3.join(projectRoot, "continuity", "questions", "_index.md"), questionIndex(storyId, []), changed, projectRoot);
  ensureFile(path3.join(projectRoot, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), changed, projectRoot);
  ensureFile(path3.join(projectRoot, "continuity", "clues", "_index.md"), clueIndex(storyId, []), changed, projectRoot);
  ensureFile(path3.join(projectRoot, "glossary", "_index.md"), glossaryIndex(storyId, []), changed, projectRoot);
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
function createEntity(root, options) {
  const project = scanProject(root);
  const kind = normalizeKind(options.kind);
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
  const oldFile = path3.join(project.root, config.dir, `${oldId}.md`);
  requireKebabId(oldId, `${kind} id`);
  assertSafeProjectPath(oldFile, project.root);
  if (!fs2.existsSync(oldFile)) {
    throw new Error(`${kind} ${oldId} does not exist`);
  }
  const markdown = readMarkdown(oldFile, project.root);
  const newId = kind === "chapter" ? oldId : kebabCase(name);
  const newFile = path3.join(project.root, config.dir, `${newId}.md`);
  assertSafeProjectPath(newFile, project.root);
  if (newFile !== oldFile && fs2.existsSync(newFile)) {
    throw new Error(`${kind} ${newId} already exists`);
  }
  const data = { ...markdown.data, [config.titleField]: name };
  writeFile(oldFile, replaceFrontmatter(markdown.rawMarkdown, data), { root: project.root });
  if (newFile !== oldFile) {
    fs2.renameSync(oldFile, newFile);
    replaceEntityReferences(project.root, oldId, newId);
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
  const file = path3.join(project.root, config.dir, `${id}.md`);
  requireKebabId(id, `${kind} id`);
  assertSafeProjectPath(file, project.root);
  if (!fs2.existsSync(file)) {
    throw new Error(`${kind} ${id} does not exist`);
  }
  fs2.rmSync(file);
  removeEntityReferences(project.root, id);
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
  const rows = chapters.length === 0 ? ["| *No chapters yet* | | | | | |"] : chapters.map((chapter) => `| ${chapter.number} | ${chapter.title} | ${chapter.pov} | ${chapter.status} | ${chapter.wordCount} | [${chapter.id}](${path3.basename(chapter.file)}) |`);
  const total = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  return `${stringifyFrontmatter({ type: "chapter-registry", story: storyId })}# Chapters

## Registry

| # | Title | POV | Status | Word Count | File |
|---|-------|-----|--------|------------|------|
${rows.join(`
`)}

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
    default:
      entityConfig(kind);
  }
}
function entityResult(project, kind, id, markdown) {
  const config = entityConfig(kind);
  return { id, markdown, file: path3.join(project.root, config.dir, `${id}.md`) };
}
function entityConfig(kind) {
  const configs = {
    character: { dir: "characters", titleField: "name" },
    location: { dir: path3.join("worldbuilding", "locations"), titleField: "name" },
    system: { dir: path3.join("worldbuilding", "systems"), titleField: "name" },
    faction: { dir: path3.join("worldbuilding", "factions"), titleField: "name" },
    artifact: { dir: path3.join("worldbuilding", "artifacts"), titleField: "name" },
    arc: { dir: path3.join("plot", "arcs"), titleField: "name" },
    chapter: { dir: "chapters", titleField: "title" },
    scene: { dir: "scenes", titleField: "title" },
    question: { dir: path3.join("continuity", "questions"), titleField: "title" },
    promise: { dir: path3.join("continuity", "promises"), titleField: "title" },
    clue: { dir: path3.join("continuity", "clues"), titleField: "title" },
    term: { dir: path3.join("glossary", "terms"), titleField: "term" }
  };
  const config = configs[kind];
  if (!config) {
    throw new Error(`Unsupported entity kind: ${kind}`);
  }
  return config;
}
function normalizeKind(kind) {
  const normalized = String(kind ?? "").trim().toLowerCase().replace(/s$/, "");
  if (normalized === "glossary" || normalized === "glossary-term") {
    return "term";
  }
  return normalized;
}
function requireKebabId(id, label) {
  if (!isKebabId2(id)) {
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
  const travelHoursOption = options["travel-hours"];
  let travelHours;
  if (travelHoursOption !== undefined && travelHoursOption !== "") {
    travelHours = Number(travelHoursOption);
    if (!Number.isFinite(travelHours)) {
      throw new Error(`travel-hours must be a number, got ${travelHoursOption}`);
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
    status: options.status ?? "planned",
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
function clueFile(title, options) {
  return `${stringifyFrontmatter({
    title,
    status: options.status ?? "planned",
    planted: options.planted ?? "",
    payoff: options.payoff ?? "",
    "significance-delayed": options["significance-delayed"] ?? false,
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
function nextSceneNumber(project, chapter) {
  return project.scenes.filter((scene) => scene.chapter === chapter).reduce((max, scene) => Math.max(max, scene.scene), 0) + 1;
}
function ensureDirectory(directory, changed, root) {
  if (!fs2.existsSync(directory)) {
    assertLexicallyInsideRoot(directory, root);
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
var REFERENCE_FIELDS = new Set([
  "arc",
  "arcs",
  "arcs-advanced",
  "artifact",
  "chapter",
  "character",
  "characters",
  "controlled-by",
  "died-in",
  "introduced",
  "learned-in",
  "location",
  "locations",
  "members",
  "mentions",
  "notable-characters",
  "owner",
  "payoff",
  "planted",
  "pov",
  "resolved"
]);
function replaceEntityReferences(root, oldId, newId) {
  const targetPattern = new RegExp(`(^|/)${escapeRegExp(oldId)}\\.md$`);
  const textPattern = new RegExp(`\\[${escapeRegExp(oldId)}\\](?=\\()`, "g");
  rewriteReferences(root, (value) => value === oldId ? newId : value, (body) => body.replace(/\]\(([^)]*)\)/g, (match, target) => targetPattern.test(target) ? `](${target.replace(targetPattern, `$1${newId}.md`)})` : match).replace(textPattern, `[${newId}]`));
}
function removeEntityReferences(root, id) {
  rewriteReferences(root, (value) => value === id ? null : value, (body) => body);
}
function rewriteReferences(root, transform, transformBody) {
  for (const file of markdownFiles(root)) {
    assertSafeProjectPath(file, root);
    const text = fs2.readFileSync(file, "utf8");
    const match = FRONTMATTER_PATTERN.exec(text);
    if (!match) {
      continue;
    }
    const data = parseFrontmatter(text, file).data;
    const body = text.slice(match[0].length);
    const nextData = transformReferences(data, transform);
    const nextBody = transformBody(body);
    const dataChanged = JSON.stringify(nextData) !== JSON.stringify(data);
    if (dataChanged || nextBody !== body) {
      writeFile(file, `${dataChanged ? stringifyFrontmatter(nextData) : match[0]}${nextBody}`, { root });
    }
  }
}
function transformReferences(data, transform, nested = false) {
  const next = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      const items = [];
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const mapped = transformReferences(item, transform, true);
          if (mapped !== null) {
            items.push(mapped);
          }
        } else if (REFERENCE_FIELDS.has(key)) {
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
    if (REFERENCE_FIELDS.has(key)) {
      const mapped = transform(value);
      if (mapped === null) {
        if (nested) {
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
        addFrontmatterListValue(root, path3.join("characters", `${characterId}.md`), "locations", id);
      }
    }
  }
  if (kind === "character") {
    for (const locationId of asArray(data.locations)) {
      if (isKebabId2(locationId)) {
        addFrontmatterListValue(root, path3.join("worldbuilding", "locations", `${locationId}.md`), "notable-characters", id);
      }
    }
  }
}
function addFrontmatterListValue(root, relativePath, field, value) {
  const filePath = path3.join(root, relativePath);
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
function markdownFiles(root) {
  const files = [];
  for (const entry of fs2.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path3.join(root, entry.name);
    if (entry.isDirectory() && entry.name !== "dist" && !entry.name.startsWith(".")) {
      files.push(...markdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files.sort();
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
  return {
    title: project.story.data.title,
    chapters
  };
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
  const chapterEntries = [];
  const chapterItems = [];
  const spineItems = [];
  for (const chapter of manuscript.chapters) {
    const id = `chapter-${String(chapter.number).padStart(2, "0")}`;
    chapterEntries.push({
      name: `OEBPS/${id}.xhtml`,
      content: chapterXhtml(chapter)
    });
    chapterItems.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${id}"/>`);
  }
  const modified = epubModifiedTimestamp();
  writeZip(outFile, [
    { name: "mimetype", content: "application/epub+zip" },
    { name: "META-INF/container.xml", content: `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: "OEBPS/content.opf", content: `<?xml version="1.0" encoding="UTF-8"?><package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${xmlEscape(storyId)}</dc:identifier><dc:title>${xmlEscape(manuscript.title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapterItems.join("")}</manifest><spine>${spineItems.join("")}</spine></package>` },
    { name: "OEBPS/nav.xhtml", content: navXhtml(manuscript) },
    ...chapterEntries
  ], writeOptions);
}
function navXhtml(manuscript) {
  const links = [];
  for (const chapter of manuscript.chapters) {
    links.push(`<li><a href="chapter-${String(chapter.number).padStart(2, "0")}.xhtml">Chapter ${chapter.number}: ${xmlEscape(chapter.title)}</a></li>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xmlEscape(manuscript.title)}</title></head><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol>${links.join("")}</ol></nav></body></html>`;
}
function chapterXhtml(chapter) {
  const paragraphs = [];
  for (const paragraph of markdownParagraphs(chapter.body)) {
    const runs = inlineRuns(paragraph).map((run) => {
      const text = xmlEscape(run.text);
      return run.style ? `<${run.style}>${text}</${run.style}>` : text;
    });
    paragraphs.push(`<p>${runs.join("")}</p>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xmlEscape(chapter.title)}</title></head><body><h1>Chapter ${chapter.number}: ${xmlEscape(chapter.title)}</h1>${paragraphs.join("")}</body></html>`;
}
function writeDocx(outFile, manuscript, writeOptions = {}) {
  const bodyParts = [paragraphXml(manuscript.title, "Title")];
  for (const chapter of manuscript.chapters) {
    bodyParts.push(paragraphXml(`Chapter ${chapter.number}: ${chapter.title}`, "Heading1"));
    for (const paragraph of markdownParagraphs(chapter.body)) {
      bodyParts.push(paragraphXml(paragraph, "", inlineRuns(paragraph)));
    }
  }
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
  for (const paragraph of markdown.replace(/^#+\s+/gm, "").split(/\n{2,}/)) {
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
function readEntityFiles(root, relativeDir, mapEntity, scanErrors) {
  const directory = path3.join(root, relativeDir);
  if (!fs2.existsSync(directory)) {
    return [];
  }
  assertSafeProjectDirectory(directory, root);
  const entities = [];
  const files = fs2.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "_index.md").map((entry) => entry.name).sort();
  for (const file of files) {
    const fullPath = path3.join(directory, file);
    const label = path3.join(relativeDir, file);
    try {
      const markdown = readMarkdown(fullPath, root);
      entities.push(mapEntity(path3.basename(file, ".md"), fullPath, markdown.data, markdown));
    } catch (error) {
      scanErrors.push(`${label}: ${error.message}`);
    }
  }
  return entities;
}
function requireStoryFile(projectRoot) {
  const storyPath = path3.join(projectRoot, "story.md");
  if (!fs2.existsSync(storyPath)) {
    throw new Error(`${projectRoot} is not a story project: missing story.md`);
  }
  return storyPath;
}
function readExemptions(root) {
  const exemptionsPath = path3.join(root, "continuity", "exemptions.md");
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
    if (pattern === "") {
      continue;
    }
    exemptions.push({ pattern, reason: String(entry.reason ?? "") });
  }
  return exemptions;
}
function readMarkdown(filePath, root) {
  if (root) {
    assertSafeProjectPath(filePath, root);
  }
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
  return fs2.readFileSync(filePath, "utf8");
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
var ENTITY_SCAN_DIRS = [
  "characters",
  "chapters",
  "scenes",
  path3.join("worldbuilding", "locations"),
  path3.join("worldbuilding", "systems"),
  path3.join("worldbuilding", "factions"),
  path3.join("worldbuilding", "artifacts"),
  path3.join("plot", "arcs"),
  path3.join("continuity", "questions"),
  path3.join("continuity", "promises"),
  path3.join("continuity", "clues"),
  path3.join("glossary", "terms")
];
function collectStrayFileWarnings(project, warnings) {
  const root = project.root;
  const topEntries = fs2.readdirSync(root, { withFileTypes: true });
  const strayTop = [];
  for (const entry of topEntries) {
    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "story.md") {
      strayTop.push(entry.name);
    }
  }
  strayTop.sort();
  for (const name of strayTop) {
    warnings.push(`${name} is not part of the story project model and is ignored`);
  }
  const nested = [];
  for (const relativeDir of ENTITY_SCAN_DIRS) {
    const directory = path3.join(root, relativeDir);
    if (!fs2.existsSync(directory)) {
      continue;
    }
    for (const file of markdownFiles(directory)) {
      const relativePath = path3.relative(directory, file);
      if (relativePath.includes(path3.sep) || path3.dirname(relativePath) !== ".") {
        nested.push(path3.join(relativeDir, relativePath));
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
  const outFile = path3.resolve(project.root, rawOut);
  const shouldEnforceRoot = enforceRoot ?? !path3.isAbsolute(String(rawOut));
  return {
    outFile,
    enforceRoot: shouldEnforceRoot,
    writeOptions: shouldEnforceRoot ? { root: project.root } : {}
  };
}
function prepareWriteTarget(filePath, root) {
  const target = path3.resolve(filePath);
  if (root) {
    assertLexicallyInsideRoot(target, root);
  }
  fs2.mkdirSync(path3.dirname(target), { recursive: true });
  if (root) {
    assertSafeProjectParent(target, root);
  }
  rejectSymlinkTarget(target);
  return target;
}
function assertSafeProjectPath(filePath, root) {
  const target = path3.resolve(filePath);
  assertLexicallyInsideRoot(target, root);
  assertSafeProjectParent(target, root);
  rejectSymlinkTarget(target);
}
function assertSafeProjectDirectory(directory, root) {
  const target = path3.resolve(directory);
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
  const rootReal = fs2.realpathSync(path3.resolve(root));
  const directoryReal = fs2.realpathSync(target);
  if (!isPathInside(rootReal, directoryReal)) {
    throw new Error(`Refusing to use project directory outside root: ${target}`);
  }
}
function assertSafeProjectParent(filePath, root) {
  const rootReal = fs2.realpathSync(path3.resolve(root));
  const parentReal = fs2.realpathSync(path3.dirname(path3.resolve(filePath)));
  if (!isPathInside(rootReal, parentReal)) {
    throw new Error(`Refusing to access project path outside root: ${filePath}`);
  }
}
function assertLexicallyInsideRoot(filePath, root) {
  const rootPath = path3.resolve(root);
  const target = path3.resolve(filePath);
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
  return fs2.lstatSync(filePath, { throwIfNoEntry: false }) ?? null;
}
function isPathInside(root, target) {
  const relativePath = path3.relative(root, target);
  return relativePath === "" || !relativePath.startsWith("..") && !path3.isAbsolute(relativePath);
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
function normalizeBuildFormat(value) {
  const format = String(value).trim().toLowerCase();
  if (format === "markdown" || format === "md") {
    return "markdown";
  }
  if (format === "epub" || format === "docx" || format === "shunn") {
    return format;
  }
  throw new Error(`Unsupported build format: ${value}. Supported formats: markdown, epub, docx, shunn`);
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
    requireInteger(data, "target-words", "story.md", errors);
  }
  if (data["draft-mode"] !== undefined) {
    requireScalar(data, "draft-mode", "story.md", errors);
  }
  if (data["schema-version"] !== undefined && data["schema-version"] !== STORY_SCHEMA_VERSION) {
    errors.push(`story.md schema-version must be ${STORY_SCHEMA_VERSION}`);
  }
}
function validateIndexFrontmatter(project, errors) {
  for (const [relativePath, expectedType] of INDEX_SCHEMAS) {
    const label = relativePath;
    const data = readValidationData(path3.join(project.root, relativePath), project.root, label, errors);
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
    if (relativePath === path3.join("plot", "_index.md")) {
      requireFields(data, ["structure"], label, errors);
      requireScalar(data, "structure", label, errors);
    }
  }
}
function validateCharacters(project, errors) {
  for (const character of project.characters) {
    const label = relative2(project, character.file);
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
    validateRelationships(data, label, errors);
  }
}
function validateLocations(project, errors) {
  for (const location of project.locations) {
    const label = relative2(project, location.file);
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
  }
}
function validateSystems(project, errors) {
  for (const system of project.systems) {
    const label = relative2(project, system.file);
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
    const label = relative2(project, faction.file);
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
    const label = relative2(project, artifact.file);
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
    const label = relative2(project, arc.file);
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
  const seenNumbers = new Map;
  for (const chapter of project.chapters) {
    const label = relative2(project, chapter.file);
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
      requireInteger(data, "word-count", label, errors);
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
  const seenKeys = new Map;
  for (const scene of project.scenes) {
    const label = relative2(project, scene.file);
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
    if (data["flashback-to"] !== undefined) {
      requireScalar(data, "flashback-to", label, errors);
    }
    if (Number.isInteger(data.scene) && data.scene <= 0) {
      errors.push(`${label} scene must be greater than 0`);
    }
    const filenameMatch = SCENE_FILENAME_PATTERN.exec(path3.basename(scene.file));
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
  const label = path3.join("continuity", "state.md");
  if (!project.continuity) {
    return;
  }
  const data = project.continuity.data;
  requireFields(data, ["type", "story", "current-chapter"], label, errors);
  requireScalar(data, "type", label, errors);
  requireScalar(data, "story", label, errors);
  requireInteger(data, "current-chapter", label, errors);
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
    const label = relative2(project, question.file);
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
    const label = relative2(project, promise.file);
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
    const label = relative2(project, clue.file);
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
    if (data["significance-delayed"] !== undefined && typeof data["significance-delayed"] !== "boolean") {
      errors.push(`${label} frontmatter field significance-delayed must be a boolean`);
    }
  }
}
function validateExemptions(project, errors) {
  const exemptionsPath = path3.join(project.root, "continuity", "exemptions.md");
  if (!fs2.existsSync(exemptionsPath)) {
    return;
  }
  const label = path3.join("continuity", "exemptions.md");
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
    const label = relative2(project, term.file);
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
function requireInteger(data, field, label, errors) {
  if (data[field] !== undefined && !Number.isInteger(data[field])) {
    errors.push(`${label} frontmatter field ${field} must be an integer`);
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
function inverseRelationshipType(type) {
  if (RELATIONSHIP_INVERSES.has(type)) {
    return RELATIONSHIP_INVERSES.get(type);
  }
  return SYMMETRIC_RELATIONSHIPS.has(type) ? type : "";
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
var CHAPTER_FILENAME_PATTERN = /^chapter-(\d+)\.md$/;
var SCENE_FILENAME_PATTERN = /^(.+)-scene-(\d+)\.md$/;
function chapterNumberFromFile(file) {
  const match = CHAPTER_FILENAME_PATTERN.exec(path3.basename(file));
  return match ? Number.parseInt(match[1], 10) : 0;
}
function sceneNumberFromFile(file) {
  const match = SCENE_FILENAME_PATTERN.exec(path3.basename(file));
  return match ? Number.parseInt(match[2], 10) : 0;
}
function sceneChapterFromFile(file) {
  const match = SCENE_FILENAME_PATTERN.exec(path3.basename(file));
  return match ? match[1] : "";
}
function relative2(project, file) {
  return path3.relative(project.root, file);
}

// src/import.js
var CHAPTER_HEADING_PATTERN = /^chapter(?![A-Za-z])\s*(?:(?:\d+|[ivxlc]+)(?=[\s:.\-–—]|$))?\s*[:.\-–—]*\s*(.*)$/i;
var FRONTMATTER_PATTERN2 = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
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
function importManuscript(options) {
  const rawSource = String(options.source ?? "").trim();
  if (!rawSource) {
    throw new Error("An import source file or directory is required");
  }
  const cwd = options.cwd ?? process.cwd();
  const source = path4.resolve(cwd, rawSource);
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
    synopsis: options.synopsis ?? `Imported from ${path4.basename(source)}. Replace with a 2-3 sentence synopsis.`,
    force: options.force
  });
  let totalWords = 0;
  chapters.forEach((chapter, index) => {
    const number = index + 1;
    const words = wordCount(chapter.prose);
    totalWords += words;
    const file = path4.join(created.root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`);
    fs3.writeFileSync(file, chapterMarkdown(chapter.title, number, words, chapter.prose), "utf8");
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
  if (fs3.statSync(source).isFile()) {
    return [{ name: path4.basename(source), text: fs3.readFileSync(source, "utf8") }];
  }
  const documents = fs3.readdirSync(source, { withFileTypes: true }).filter((entry) => entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name)).map((entry) => entry.name).sort().map((name) => ({ name, text: fs3.readFileSync(path4.join(source, name), "utf8") }));
  if (documents.length === 0) {
    throw new Error(`No markdown or text files found in ${source}`);
  }
  return documents;
}
function splitChapters(documents) {
  const chapters = [];
  for (const document of documents) {
    const text = document.text.replace(FRONTMATTER_PATTERN2, "").replace(/\r\n/g, `
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
    title: titleCaseSlug(path4.basename(fileName, path4.extname(fileName))),
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

// src/cli.js
var HELP = `Usage: story <command> [options]

Commands:
  init <title>       Scaffold a story project
  import <source>    Split an existing manuscript into a new story project
  validate [path]    Check project structure, frontmatter, and registries
  reindex [path]     Rebuild registry tables from markdown files
  wordcount [path]   Count chapter prose words
  links [path]       Check cross-reference targets and backlinks
  continuity [path]  Check deterministic continuity contracts: deaths,
                    promises, questions, casts, and durable state.
                    Findings matching continuity/exemptions.md are
                    reported as dismissed
  knowledge <id>    List what a character knew at a chapter; requires --at
  series [path]      Order linked prequels and sequels and check shared
                    canon across books
  report [path]      Summarize project inventory, progress, and checks
  next [path]        Recommend the next writing and maintenance actions
  doctor [path]      Show health checks plus actionable repair steps
  migrate [path]     Upgrade a project to the current schema
  add <kind> <name>  Create an entity file and reindex registries
  rename <kind> <id> <name>
                    Rename an entity and update id references
  remove <kind> <id>
                    Remove an entity and scrub id references
  export [path]      Combine chapters into a manuscript markdown file
  build [path]       Build a disposable book artifact in dist/
  synopsis [path]    Build a deterministic 1- or 3-page synopsis from arcs

Options:
  --title <name>            Story title for import
  --dir <path>              Target directory for init or import
  --genre <name>            Story genre for init
  --sub-genre <name>        Story sub-genre for init
  --setting-era <name>      Setting era for init
  --theme <name>            Theme for init or add arc; repeatable
  --themes <a,b>            Comma-separated themes for init or add arc
  --pov <style>             POV style for init or add chapter/scene
  --tense <tense>           Narrative tense for init
  --synopsis <text>         Starter synopsis for init
  --series <id>             Series id for init
  --book-number <n>         Publication order for init
  --follows <path>          Init a sequel set after this story project;
                            repeatable
  --precedes <path>         Init a prequel set before this story project;
                            repeatable
  --force                   Allow init to overwrite starter files
  --write                   Update chapter word-count frontmatter
  --path <path>             Target story root for add/rename/remove
  --out <file>              Output path for export/build/synopsis
  --format <name>           Output format for build (markdown, epub, docx, shunn)
  --shunn                   Apply Shunn manuscript formatting (with --format docx)
  --at <chapter-id>         Chapter id for knowledge
  --pages <n>               Synopsis length for synopsis (1 or 3)
  --actionable              Include next actions in report
  --number <n>              Chapter number for add chapter
  --chapter <id>            Chapter id for add scene
  --scene <n>               Scene number for add scene
  --type <name>             Entity type for add
  --role <name>             Character role for add character
  --status <name>           Entity status for add
  --mode <name>             Mode for add chapter (e.g. discovered)
  --date <date>             Story date (YYYY-MM-DD) for add chapter/scene
  --time <time>             Story time for add chapter/scene
  --travel-hours <n>        Travel hours for add scene
  --dilemma <text>          Dilemma for add scene sequel unit
  --sequel                  Mark scene as sequel unit for add scene
  --location <id>           Location reference for add
  --character <id>          Character reference for add; repeatable
  --mention <id>            Mentioned character for add chapter/scene; repeatable
  --member <id>             Faction member reference for add faction; repeatable
  --owner <id>              Owner reference for add artifact
  --arc <id>                Arc reference for add (arc theme for add character); repeatable
  --introduced <id>         Chapter id for add question
  --resolved <id>           Chapter id for add question
  --planted <id>            Chapter id for add promise/clue
  --payoff <id>             Chapter id for add promise/clue
  --significance-delayed    Significance is delayed for add clue
  --category <name>         Category for add term
  --alias <name>            Alias for add term; repeatable
  --region <name>           Region for add location
  --population <name>       Population for add location
  --controlled-by <id>      Controlling faction for add location
  --prevalence <name>       Prevalence for add system
  --acts <a,b>              Comma-separated acts for add arc; repeatable
  -h, --help                Show this help

Values beginning with a dash may also use the --option=value form.
`;
function runCli(argv, io) {
  try {
    const parsed = parseArgs(argv);
    const cwd = io.cwd ?? process.cwd();
    const command = parsed.positionals[0];
    if (!command || command === "help" || parsed.options.help) {
      io.stdout.write(HELP);
      return 0;
    }
    if (command === "init") {
      const title = parsed.positionals.slice(1).join(" ");
      const result = createStoryProject({
        title,
        cwd,
        dir: parsed.options.dir,
        genre: parsed.options.genre,
        subGenre: parsed.options["sub-genre"],
        settingEra: parsed.options["setting-era"],
        themes: collectThemes(parsed.options),
        pov: parsed.options.pov,
        tense: parsed.options.tense,
        synopsis: parsed.options.synopsis,
        series: parsed.options.series,
        bookNumber: parsed.options["book-number"],
        follows: parsed.options.follows,
        precedes: parsed.options.precedes,
        force: Boolean(parsed.options.force)
      });
      io.stdout.write(`Created story project: ${result.root}
`);
      for (const linkedBook of result.linkedBooks) {
        io.stdout.write(`Linked series backlink in ${path5.join(linkedBook, "story.md")}
`);
      }
      return 0;
    }
    if (command === "import") {
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
        force: Boolean(parsed.options.force)
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
    const root = path5.resolve(cwd, parsed.positionals[1] ?? ".");
    if (command === "validate") {
      return reportResult(io, validateProject(root), "Project is valid", "Project validation failed");
    }
    if (command === "links") {
      return reportResult(io, validateLinks(root), "Links are valid", "Link check failed");
    }
    if (command === "continuity") {
      return reportResult(io, checkProjectContinuity(root), "Continuity is consistent", "Continuity check failed");
    }
    if (command === "knowledge") {
      const characterId = parsed.positionals[1];
      const atChapterId = parsed.options.at;
      if (!characterId || typeof atChapterId !== "string") {
        io.stderr.write(`Usage: story knowledge <character-id> --at <chapter-id> [--path <project>]
`);
        return 1;
      }
      const entries = knowledgeAtChapter(targetRoot(cwd, parsed), characterId, atChapterId);
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
    if (command === "series") {
      const report = seriesReport(root);
      io.stdout.write(formatSeriesReport(report));
      return reportResult(io, report, "Series is consistent", "Series check failed");
    }
    if (command === "report") {
      io.stdout.write(formatProjectReport(projectReport(root), { actionable: Boolean(parsed.options.actionable) }));
      return 0;
    }
    if (command === "next") {
      io.stdout.write(formatActionReport(projectActions(root)));
      return 0;
    }
    if (command === "doctor") {
      io.stdout.write(formatDoctorReport(projectActions(root)));
      return 0;
    }
    if (command === "migrate") {
      const result = migrateProject(root);
      io.stdout.write(result.changed.length === 0 ? `Project already uses the current schema
` : `Migrated project to current schema: ${result.changed.length} changes
`);
      return 0;
    }
    if (command === "add") {
      const result = createEntity(targetRoot(cwd, parsed), {
        ...parsed.options,
        kind: parsed.positionals[1],
        name: parsed.positionals.slice(2).join(" ")
      });
      io.stdout.write(`Created ${result.kind} ${result.id}: ${result.file}
`);
      return 0;
    }
    if (command === "rename") {
      const result = renameEntity(targetRoot(cwd, parsed), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2],
        name: parsed.positionals.slice(3).join(" ")
      });
      io.stdout.write(`Renamed ${result.kind} ${result.oldId} to ${result.id}: ${result.file}
`);
      return 0;
    }
    if (command === "remove") {
      const result = removeEntity(targetRoot(cwd, parsed), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2]
      });
      io.stdout.write(`Removed ${result.kind} ${result.id}: ${result.file}
`);
      return 0;
    }
    if (command === "reindex") {
      const result = reindexProject(root);
      io.stdout.write(result.changed.length === 0 ? `Registries already up to date
` : `Updated ${result.changed.length} registries
`);
      return 0;
    }
    if (command === "wordcount") {
      const result = computeWordCounts(root, { write: Boolean(parsed.options.write) });
      for (const chapter of result.chapters) {
        io.stdout.write(`${chapter.file}: ${chapter.wordCount}
`);
      }
      io.stdout.write(`Total: ${result.total}
`);
      return 0;
    }
    if (command === "export") {
      const result = exportManuscript(root, { out: parsed.options.out });
      io.stdout.write(`Exported ${result.chapters} chapters to ${result.outFile}
`);
      return 0;
    }
    if (command === "build") {
      const result = buildBook(root, {
        out: parsed.options.out,
        format: parsed.options.format,
        shunn: Boolean(parsed.options.shunn)
      });
      io.stdout.write(`Built ${result.chapters} chapters as ${result.format} to ${result.outFile}
`);
      return 0;
    }
    if (command === "synopsis") {
      const result = synopsisBook(root, { pages: parsed.options.pages, out: parsed.options.out });
      if (result.outFile === undefined) {
        io.stdout.write(result.text);
      } else {
        io.stdout.write(`Wrote synopsis to ${result.outFile}
`);
      }
      return 0;
    }
    io.stderr.write(`Unknown command: ${command}

${HELP}`);
    return 1;
  } catch (error) {
    io.stderr.write(`${error.message}
`);
    return 1;
  }
}
var BOOLEAN_OPTIONS = new Set(["force", "write", "actionable", "significance-delayed", "shunn", "sequel"]);
var VALUE_OPTIONS = new Set([
  "title",
  "dir",
  "genre",
  "sub-genre",
  "setting-era",
  "theme",
  "themes",
  "pov",
  "tense",
  "synopsis",
  "series",
  "book-number",
  "follows",
  "precedes",
  "path",
  "out",
  "format",
  "at",
  "pages",
  "number",
  "chapter",
  "scene",
  "type",
  "role",
  "status",
  "mode",
  "date",
  "time",
  "travel-hours",
  "dilemma",
  "location",
  "locations",
  "character",
  "characters",
  "mention",
  "mentions",
  "member",
  "members",
  "owner",
  "arc",
  "arcs",
  "introduced",
  "resolved",
  "planted",
  "payoff",
  "category",
  "alias",
  "aliases",
  "region",
  "population",
  "controlled-by",
  "prevalence",
  "acts",
  "act"
]);
function isKnownOptionToken(token) {
  if (token === "-h") {
    return true;
  }
  if (!token.startsWith("--")) {
    return false;
  }
  const equalIndex = token.indexOf("=");
  const key = token.slice(2, equalIndex === -1 ? undefined : equalIndex);
  return key === "help" || BOOLEAN_OPTIONS.has(key) || VALUE_OPTIONS.has(key);
}
function addOption(options, key, value) {
  if (options[key] === undefined) {
    options[key] = value;
  } else {
    options[key] = Array.isArray(options[key]) ? options[key].concat(value) : [options[key], value];
  }
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
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equalIndex = arg.indexOf("=");
    const key = arg.slice(2, equalIndex === -1 ? undefined : equalIndex);
    const inlineValue = equalIndex === -1 ? undefined : arg.slice(equalIndex + 1);
    if (BOOLEAN_OPTIONS.has(key)) {
      addOption(options, key, inlineValue ?? true);
      continue;
    }
    if (VALUE_OPTIONS.has(key)) {
      if (inlineValue !== undefined) {
        addOption(options, key, inlineValue);
        continue;
      }
      const nextValue2 = argv[index + 1];
      if (nextValue2 === undefined || isKnownOptionToken(nextValue2)) {
        throw new Error(`Missing value for --${key}: expected a value`);
      }
      addOption(options, key, nextValue2);
      index += 1;
      continue;
    }
    const nextValue = argv[index + 1];
    const hasSeparateValue = inlineValue === undefined && nextValue !== undefined && !nextValue.startsWith("-");
    const value = inlineValue ?? (hasSeparateValue ? nextValue : true);
    if (hasSeparateValue) {
      index += 1;
    }
    addOption(options, key, value);
  }
  return { positionals, options };
}
function collectThemes(options) {
  return [].concat(options.theme ?? []).concat(options.themes ?? []).filter((value) => value !== undefined && value !== true);
}
function targetRoot(cwd, parsed) {
  return path5.resolve(cwd, parsed.options.path ?? ".");
}
function reportResult(io, result, successMessage, failureMessage) {
  const output = result.ok ? io.stdout : io.stderr;
  const dismissed = result.dismissed ?? [];
  output.write(`${result.ok ? successMessage : failureMessage}: ${result.errors.length} errors, ${result.warnings.length} warnings, ${dismissed.length} dismissed
`);
  for (const error of result.errors) {
    io.stderr.write(`error: ${error}
`);
  }
  for (const warning of result.warnings) {
    output.write(`warning: ${warning}
`);
  }
  for (const entry of dismissed) {
    io.stdout.write(`dismissed: ${entry.finding} (exemption: ${entry.reason})
`);
  }
  return result.ok ? 0 : 1;
}

// bin/story.js
process.exitCode = runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr
});

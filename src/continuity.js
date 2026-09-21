import path from "node:path";
import { kebabCase } from "./markdown.js";

const CHEKHOV_CHAPTER_GAP = 3;

export function checkContinuity(project) {
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

// Applies continuity/exemptions.md: findings whose text contains an exemption
// pattern are moved out of errors/warnings and reported as dismissed. `ok`
// reflects only the errors that remain.
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
  const numbers = project.chapters
    .map((chapter) => chapter.number)
    .filter((number) => Number.isInteger(number) && number > 0)
    .sort((left, right) => left - right);

  for (let index = 1; index < numbers.length; index += 1) {
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
    return undefined;
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

  const knownFacts = new Map();
  for (const [index, entry] of stateEntries(data["knowledge-state"]).entries()) {
    const entryLabel = `${label} knowledge-state[${index}]`;
    if (!requireMapping(entry, entryLabel, errors)) {
      continue;
    }
    // `fact` is an optional stable id so the same knowledge can be matched
    // across entries and across books in a series.
    if (entry.fact !== undefined) {
      const fact = String(entry.fact);
      if (!isKebabId(fact)) {
        errors.push(`${entryLabel} fact ${fact || "(empty)"} must be a kebab-case id`);
      } else {
        const key = `${entry.character} ${fact}`;
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

// Prop custody: artifacts with destroyed/lost object-state must not appear in
// later chapters or scenes. The destruction chapter is recorded in
// object-state `since`; later scenes whose state-changes target the artifact
// are errors, and later chapters/scenes listing it in mentions or characters
// are errors. Entries with no `since` cannot be checked and warn instead.
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

// Clock/time plausibility. Only active when at least one scene carries a
// date; with no scene dates there are no time findings. Scene timestamps run
// backward when a dated scene is earlier than the preceding dated scene in
// the same chapter, and scene travel-hours asserts a minimum travel time.
const TIME_RANKS = new Map([
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

  const scenesByChapter = new Map();
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
  for (let index = 1; index < dated.length; index += 1) {
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

export function storyDateError(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "";
  }
  if (!parseClockDate(String(value))) {
    return `date must be a real YYYY-MM-DD calendar day, got ${value}`;
  }
  return "";
}

export function storyTimeError(value) {
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
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const days = Date.UTC(year, month - 1, day) / 86400000;
  const roundtrip = new Date(days * 86400000);
  if (roundtrip.getUTCFullYear() !== year || roundtrip.getUTCMonth() !== month - 1 || roundtrip.getUTCDate() !== day) {
    return undefined;
  }
  return { text: value.trim(), days };
}

function parseClockTime(value) {
  const text = value.trim().toLowerCase();
  if (text === "") {
    return undefined;
  }
  const named = TIME_RANKS.get(text);
  if (named !== undefined) {
    return named;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) {
    return undefined;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return undefined;
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

import path from "node:path";

const CHEKHOV_CHAPTER_GAP = 3;

export function checkContinuity(project) {
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
  checkStoryCompletion(project, errors);
  checkContinuityState(project, context, errors, warnings);

  return { ok: errors.length === 0, errors, warnings };
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

    if (scene.location && chapter.locations.length > 0 && !chapter.locations.includes(scene.location)) {
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

  for (const [index, entry] of stateEntries(data["knowledge-state"]).entries()) {
    const entryLabel = `${label} knowledge-state[${index}]`;
    if (!requireMapping(entry, entryLabel, errors)) {
      continue;
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

import path from "node:path";
import { dismissByExemptions } from "./exemptions.js";
import { err, warn } from "./findings.js";
import { projectPath } from "./files.js";
import { kebabCase } from "./markdown.js";
import { chapterChronology, deathWindow } from "./chronology.js";
import { progressionDeathAt, progressionDeathFrom, progressionStatusAt, statusProgressions } from "./deaths.js";
import { auditMentions } from "./mentions.js";
import { happensAfter } from "./progressions.js";

const CHEKHOV_CHAPTER_GAP = 3;
// A mystery's central question is often the book, so the same three-chapter
// gap used for promises and clues would warn on it almost as soon as it is
// asked. Twelve drafted chapters is wide enough that the question can run
// through a long stretch of the draft, and still leaves a warning to exempt
// when the hold is deliberate. It stays a warning: an open question is an
// error only once story.md is complete.
export const QUESTION_CHAPTER_GAP = 12;

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
    // Chekhov gaps, the open-question gap, and the stale-state warning
    // measure against chapters that have prose; outline-only chapters
    // scaffolded ahead of drafting do not count. `highestChapter` still
    // bounds current-chapter from above.
    latestChapter: project.chapters
      .filter((chapter) => chapter.status !== "outline")
      .reduce((max, chapter) => Math.max(max, chapter.number), 0),
    highestChapter: project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0),
    chapterNumberList: project.chapters.map((chapter) => chapter.number),
    // Chapters with prose: a setup or payoff is on the page only once its
    // own chapter is past outline, even when later chapters are drafted.
    draftedChapters: new Set(project.chapters.filter((chapter) => chapter.status !== "outline").map((chapter) => chapter.id)),
    chronology: chapterChronology(project)
  };

  checkCharacterDeaths(project, context, errors, warnings);
  checkChapterCasts(project, warnings);
  checkSceneCasts(project, warnings);
  checkCutCharacters(project, warnings);
  warnings.push(...auditMentions(project));
  checkChapterSequence(project, warnings);
  checkPromises(project, context, errors, warnings);
  checkQuestions(project, context, errors, warnings);
  checkClues(project, context, errors, warnings);
  checkStoryCompletion(project, errors);
  checkContinuityState(project, context, errors, warnings);
  checkSceneLearning(project, context, errors, warnings);
  checkStateAgainstStory(project, context, warnings);
  checkPropCustody(project, context, errors);
  checkClock(project, errors, warnings);

  return withExemptions(project, { ok: errors.length === 0, errors, warnings });
}

// Applies continuity/exemptions.md: findings an entry matches are moved out
// of errors/warnings and reported as dismissed. `ok` reflects only the
// errors that remain.
function withExemptions(project, result) {
  return dismissByExemptions({ ...result, dismissed: [] }, project.exemptions ?? [], { errors: true });
}

function checkCharacterDeaths(project, context, errors, warnings) {
  for (const character of project.characters) {
    const label = relative(project, character.file);
    if (character.revivedIn && !character.diedIn) {
      errors.push(err("revived-without-death", `${label} has revived-in ${character.revivedIn} but no died-in; set died-in or remove revived-in`, label));
    }
    if (!character.diedIn) {
      checkStatusAppearances(project, character, context.chronology, warnings);
      continue;
    }

    const deathNumber = context.chapterNumbers.get(character.diedIn);
    if (deathNumber === undefined) {
      errors.push(err("died-in-missing-chapter", `${label} died-in references missing chapter ${character.diedIn}`, label));
      continue;
    }
    if (character.revivedIn) {
      if (!context.chapterNumbers.has(character.revivedIn)) {
        errors.push(err("revived-in-missing-chapter", `${label} revived-in references missing chapter ${character.revivedIn}`, label));
        continue;
      }
      if (!context.chronology.after(character.revivedIn, character.diedIn)) {
        errors.push(err("revival-before-death", `${label} is revived in ${character.revivedIn}, not after dying in ${character.diedIn}`, label));
        continue;
      }
    }

    // A death or revival in an outline chapter is planned, not yet written,
    // so the status keeps describing the character as drafted so far.
    const deathWritten = !context.chronology.outline.has(character.diedIn);
    const revivalWritten = character.revivedIn !== "" && !context.chronology.outline.has(character.revivedIn);
    if (deathWritten && !revivalWritten && character.status !== "deceased") {
      errors.push(err("death-status-mismatch", `${label} has died-in ${character.diedIn} but status ${character.status || "unset"}; set status: deceased`, label));
    }
    if (revivalWritten && character.status === "deceased") {
      errors.push(err("revival-status-mismatch", `${label} has revived-in ${character.revivedIn} but status deceased; set status: alive`, label));
    }

    checkProgressionDeath(character, label, context.chronology, warnings);
    checkStatusAppearances(project, character, context.chronology, warnings);

    // Outline deaths are not in force: deathWindow returns null, and a later
    // cast is not a posthumous appearance until the death chapter is drafted.
    const window = deathWindow(character, context.chronology);
    if (!window) {
      continue;
    }
    for (const chapter of project.chapters) {
      if (window.deadIn(chapter.id) && castIncludes(chapter, character.id)) {
        errors.push(err("posthumous-appearance", `${relative(project, chapter.file)} lists ${character.id}, who died in ${character.diedIn}; move posthumous appearances to mentions`, relative(project, chapter.file), chapter.id));
      }
    }

    for (const scene of project.scenes) {
      if (window.deadIn(scene.chapter) && castIncludes(scene, character.id)) {
        errors.push(err("posthumous-appearance", `${relative(project, scene.file)} lists ${character.id}, who died in ${character.diedIn}; move posthumous appearances to mentions`, relative(project, scene.file), chapterOf(scene)));
      }
    }
  }
}

// Casts read against the character's status, frontmatter and progressions
// together. Deceased with no died-in means dead before the story starts, so
// any appearance is a posthumous one until a status progression brings the
// character back. A progression to deceased works like died-in: the chapter
// it takes effect in is the death chapter, and later appearances are
// posthumous. With died-in, the died-in window covers the death, and only a
// progression death after revived-in is checked here.
function checkStatusAppearances(project, character, chronology, warnings) {
  if (statusProgressions(character).length === 0 && character.status !== "deceased") {
    return;
  }
  for (const entry of [...project.chapters, ...project.scenes]) {
    if (!castIncludes(entry, character.id)) {
      continue;
    }
    const chapterId = entry.chapter ?? entry.id;
    const death = progressionDeathAt(character, chapterId, chronology);
    const entryLabel = relative(project, entry.file);
    if (death?.from === "") {
      warnings.push(warn("deceased-in-cast", `${entryLabel} lists ${character.id}, who died before the story (deceased with no died-in); move appearances to mentions`, entryLabel, chapterOf(entry)));
    } else if (death) {
      warnings.push(warn("progression-deceased-in-cast", `${entryLabel} lists ${character.id}, whose progressions make them deceased from ${death.from}; move appearances after the death to mentions`, entryLabel, chapterOf(entry)));
    }
  }
}

// The status progression listed last among those taking effect in `from`.
function progressionIndex(character, from) {
  return statusProgressions(character).filter((entry) => entry.from === from).pop().index;
}

// Status progressions checked against died-in and revived-in, in story time:
// a status other than deceased still holding at the death chapter or taking
// effect while the character is dead, and a progression to deceased still
// holding at the revival. A progression to deceased from another chapter than
// died-in is left to story validate (deceased-without-died-in), which needs
// no chronology.
function checkProgressionDeath(character, label, chronology, warnings) {
  const died = character.diedIn;
  const revived = character.revivedIn;
  const atDeath = progressionStatusAt(character, died, chronology);
  if (atDeath.status !== "deceased" && atDeath.from !== "") {
    warnings.push(warn("progression-death-conflict", `${label} progressions[${progressionIndex(character, atDeath.from)}] leaves ${character.id} ${atDeath.status} when they die in ${died}; add a status progression to deceased from ${died}`, label, died));
  }
  // In a branching book the death window decides, so a revival on another
  // branch does not end the death on this one.
  const window = chronology.branching ? deathWindow(character, chronology, { planned: true }) : null;
  const deadAt = (from) => (window && chronology.numbers.has(from)
    ? window.deadIn(from)
    : happensAfter(chronology, from, died) && (revived === "" || happensAfter(chronology, revived, from)));
  for (const { index, from, value } of statusProgressions(character)) {
    if (value !== "deceased" && deadAt(from)) {
      const fix = revived === "" ? `set revived-in: ${from} if they come back` : `move it to ${revived}, when they are revived`;
      warnings.push(warn("progression-death-conflict", `${label} progressions[${index}] sets status ${value} from ${from}, while ${character.id} is dead after dying in ${died}; ${fix}`, label, from));
    }
  }
  if (revived === "") {
    return;
  }
  const atRevival = progressionStatusAt(character, revived, chronology);
  if (atRevival.status === "deceased" && atRevival.from !== "") {
    warnings.push(warn("progression-death-conflict", `${label} progressions[${progressionIndex(character, atRevival.from)}] makes ${character.id} deceased from ${atRevival.from}, which still holds when they are revived in ${revived}; add a status progression from ${revived}`, label, revived));
  }
}

function checkChapterCasts(project, warnings) {
  for (const chapter of project.chapters) {
    if (chapter.pov && !chapter.characters.includes(chapter.pov) && !chapter.mentions.includes(chapter.pov)) {
      warnings.push(warn("pov-not-in-cast", `${relative(project, chapter.file)} POV character ${chapter.pov} is not listed in characters`, relative(project, chapter.file), chapter.id));
    }
    // A chapter's POV should be the POV of at least one of its scenes.
    const scenePovs = [...new Set(project.scenes.filter((scene) => scene.chapter === chapter.id && scene.pov).map((scene) => scene.pov))];
    if (chapter.pov && scenePovs.length > 0 && !scenePovs.includes(chapter.pov)) {
      warnings.push(warn("pov-scene-mismatch", `${relative(project, chapter.file)} has POV ${chapter.pov} but its scenes are told by ${scenePovs.join(", ")}`, relative(project, chapter.file), chapter.id));
    }
  }
}

function checkSceneCasts(project, warnings) {
  const chapters = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));

  for (const scene of project.scenes) {
    const label = relative(project, scene.file);
    if (scene.pov && !scene.characters.includes(scene.pov) && !scene.mentions.includes(scene.pov)) {
      warnings.push(warn("pov-not-in-cast", `${label} POV character ${scene.pov} is not listed in characters`, label, chapterOf(scene)));
    }

    const chapter = chapters.get(scene.chapter);
    if (!chapter) {
      continue;
    }

    for (const characterId of scene.characters) {
      if (!chapter.characters.includes(characterId) && !chapter.mentions.includes(characterId)) {
        warnings.push(warn("scene-cast-not-in-chapter", `${label} lists ${characterId} but ${relative(project, chapter.file)} does not list them in characters or mentions`, label, chapterOf(scene)));
      }
    }

    if (scene.location && !chapter.locations.includes(scene.location)) {
      warnings.push(warn("scene-location-not-in-chapter", `${label} is set in ${scene.location} but ${relative(project, chapter.file)} does not list that location`, label, chapterOf(scene)));
    }
  }
}

// A character cut with `status: cut` keeps their file, but every cast, arc,
// and relationship should drop them, so an unfinished cut is reported.
function checkCutCharacters(project, warnings) {
  const cut = new Set(project.characters.filter((character) => character.status === "cut").map((character) => character.id));
  if (cut.size === 0) {
    return;
  }
  for (const entry of [...project.chapters, ...project.scenes]) {
    const listed = [...new Set([idText(entry.pov), ...entry.characters.map(idText)])].filter((id) => cut.has(id));
    for (const id of listed) {
      warnings.push(warn("cut-character-in-cast", `${relative(project, entry.file)} lists ${id}, who has status: cut; drop them from pov and characters`, relative(project, entry.file), chapterOf(entry)));
    }
  }
  for (const arc of project.arcs) {
    for (const id of new Set(arc.characters.map(idText))) {
      if (cut.has(id)) {
        warnings.push(warn("cut-character-in-arc", `${relative(project, arc.file)} lists ${id}, who has status: cut; drop them from characters`, relative(project, arc.file)));
      }
    }
  }
  // A relationship between two cut characters is left alone.
  for (const character of project.characters) {
    for (const relationship of character.relationships) {
      if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
        continue;
      }
      const target = idText(relationship.character);
      if (target === "" || cut.has(target) === cut.has(character.id)) {
        continue;
      }
      const who = cut.has(target) ? target : character.id;
      warnings.push(warn("cut-character-relationship", `${relative(project, character.file)} has a relationship with ${target}, but ${who} has status: cut; drop the relationship on both sides`, relative(project, character.file)));
    }
  }
}

function checkChapterSequence(project, warnings) {
  const numbers = project.chapters
    .map((chapter) => chapter.number)
    .filter((number) => Number.isInteger(number) && number > 0)
    .sort((left, right) => left - right);

  // Chapters missing before the first usually mean a removed chapter or an
  // unfinished move.
  if (numbers.length > 0 && numbers[0] > 1) {
    warnings.push(warn("chapter-numbering-start", `Chapter numbering starts at ${numbers[0]}, not 1`));
  }
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] > numbers[index - 1] + 1) {
      warnings.push(warn("chapter-numbering-gap", `Chapter numbering skips from ${numbers[index - 1]} to ${numbers[index]}`));
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

    if (scheduledOutOfOrder(context, promise.planted, promise.payoff)) {
      errors.push(err("promise-payoff-before-plant", `${label} pays off in ${promise.payoff} before it is planted in ${promise.planted}`, label));
    }

    if (promise.status === "paid-off" && !promise.payoff) {
      errors.push(err("promise-payoff-missing", `${label} is paid-off but has no payoff chapter`, label));
    }

    if (promise.status === "planted" && !promise.planted) {
      errors.push(err("promise-plant-missing", `${label} is planted but has no planted chapter`, label));
    }

    const stale = stalePlannedWarning(label, promise, context);
    if (stale) {
      warnings.push(warn("promise-stale-planned", stale, label));
    }

    const chekhov = chekhovWarning(label, promise.planted, plantedNumber, promise.payoff, referencedChapterNumber(context.chapterNumbers, promise.payoff), context);
    if (promise.status === "planted" && chekhov) {
      warnings.push(warn(chekhov.passed ? "promise-payoff-passed" : "promise-unpaid", chekhov.message, label));
    }
  }
}

function checkQuestions(project, context, errors, warnings) {
  for (const question of project.questions) {
    if (question.status === "abandoned") {
      continue;
    }
    const label = relative(project, question.file);
    if (scheduledOutOfOrder(context, question.introduced, question.resolved)) {
      errors.push(err("question-resolved-before-introduced", `${label} resolves in ${question.resolved} before it is introduced in ${question.introduced}`, label));
    }

    if ((question.status === "answered" || question.status === "resolved") && !question.resolved) {
      errors.push(err("question-resolution-missing", `${label} is ${question.status} but has no resolved chapter`, label));
    }

    if (question.status === "open" && question.resolved) {
      errors.push(err("question-open-but-resolved", `${label} records resolved chapter ${question.resolved} but status is still open`, label));
    }

    // A recorded resolved chapter is already an error while the question is
    // open, so the gap warning covers only a question with nowhere to land.
    // An open question may be introduced in a chapter still in outline; it is
    // not on the page yet, so it does not age until that chapter is drafted.
    if (question.status === "open" && !question.resolved && context.draftedChapters.has(question.introduced)) {
      const unanswered = unansweredQuestionWarning(label, question.introduced, context.chapterNumbers.get(question.introduced), context);
      if (unanswered) {
        warnings.push(warn("question-unanswered", unanswered, label));
      }
    }
  }
}

function checkStoryCompletion(project, errors) {
  if (project.story.data.status !== "complete") {
    return;
  }

  for (const promise of project.promises) {
    if (promise.status === "planned" || promise.status === "planted") {
      errors.push(err("complete-with-open-promise", `story.md is complete but ${relative(project, promise.file)} is still ${promise.status}`, "story.md"));
    }
  }

  for (const question of project.questions) {
    if (question.status === "open") {
      errors.push(err("complete-with-open-question", `story.md is complete but ${relative(project, question.file)} is still open`, "story.md"));
    }
  }

  for (const clue of project.clues) {
    if (clue.status === "planned" || clue.status === "planted") {
      errors.push(err("complete-with-open-clue", `story.md is complete but ${relative(project, clue.file)} is still ${clue.status}`, "story.md"));
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

    if (scheduledOutOfOrder(context, clue.planted, clue.payoff)) {
      errors.push(err("clue-payoff-before-plant", `${label} pays off in ${clue.payoff} before it is planted in ${clue.planted}`, label));
    }

    if (clue.status === "paid-off" && !clue.payoff) {
      errors.push(err("clue-payoff-missing", `${label} has status paid-off but no payoff chapter recorded`, label));
    }

    if (clue.status === "planted" && !clue.planted) {
      errors.push(err("clue-plant-missing", `${label} is planted but no plant chapter recorded`, label));
    }

    const stale = stalePlannedWarning(label, clue, context);
    if (stale) {
      warnings.push(warn("clue-stale-planned", stale, label));
    }

    const chekhov = chekhovWarning(label, clue.planted, plantedNumber, clue.payoff, referencedChapterNumber(context.chapterNumbers, clue.payoff), context);
    if (clue.status === "planted" && chekhov) {
      warnings.push(warn(chekhov.passed ? "clue-payoff-passed" : "clue-unpaid", chekhov.message, label));
    }
  }
}

// `status: planned` with a `planted` chapter records where a setup will go.
// Once that chapter has prose, the setup should be on the page.
function stalePlannedWarning(label, entry, context) {
  if (entry.status !== "planned" || !entry.planted || !context.draftedChapters.has(entry.planted)) {
    return "";
  }
  return `${label} records planted chapter ${entry.planted} but status is still planned`;
}

// A setup and its payoff are ordered by chapter number, including a
// scheduled `chapter-NN` that has no chapter file yet.
function scheduledOutOfOrder(context, first, second) {
  const firstNumber = referencedChapterNumber(context.chapterNumbers, first);
  const secondNumber = referencedChapterNumber(context.chapterNumbers, second);
  return firstNumber !== undefined && secondNumber !== undefined && secondNumber < firstNumber;
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

// The gap since a plant or an introduction counts chapter positions, not
// chapter numbers, so gaps in the numbering do not inflate it. Outline
// chapters past the latest drafted chapter do not count.
function chaptersSince(fromNumber, context) {
  if (fromNumber === undefined) {
    return null;
  }
  return context.chapterNumberList.filter((number) => number > fromNumber && number <= context.latestChapter).length;
}

function chekhovWarning(label, planted, plantedNumber, payoff, payoffNumber, context) {
  const since = chaptersSince(plantedNumber, context);
  if (since === null) {
    return null;
  }
  const latestChapter = context.latestChapter;
  // A recorded payoff chapter that has been drafted should have paid off,
  // however soon after the plant it came. A payoff chapter with no file is
  // judged by its number against the latest drafted chapter.
  if (payoff && payoffNumber !== undefined) {
    const drafted = context.chapterNumbers.has(payoff) ? context.draftedChapters.has(payoff) : payoffNumber <= latestChapter;
    return drafted ? { passed: true, message: `${label} payoff chapter ${payoff} has passed and status is still planted` } : null;
  }
  if (since < CHEKHOV_CHAPTER_GAP) {
    return null;
  }
  return { passed: false, message: `${label} was planted in ${planted}, ${since} chapters ago, and has no payoff yet` };
}

function unansweredQuestionWarning(label, introduced, introducedNumber, context) {
  const since = chaptersSince(introducedNumber, context);
  if (since === null || since < QUESTION_CHAPTER_GAP) {
    return "";
  }
  return `${label} was introduced in ${introduced}, ${since} chapters ago, and has no resolution yet`;
}

function checkContinuityState(project, context, errors, warnings) {
  if (!project.continuity) {
    return;
  }

  const label = "continuity/state.md";
  const data = project.continuity.data;
  const currentChapter = data["current-chapter"];

  if (Number.isInteger(currentChapter)) {
    if (currentChapter > context.highestChapter) {
      errors.push(err("current-chapter-ahead", `${label} current-chapter ${currentChapter} is ahead of the latest chapter ${context.highestChapter}`, label));
    } else if (currentChapter < context.latestChapter) {
      warnings.push(warn("current-chapter-behind", `${label} current-chapter ${currentChapter} is behind the latest chapter ${context.latestChapter}; update continuity state after drafting`, label));
    }
  }

  const seenCharacters = new Map();
  for (const [index, entry] of stateEntries(data["character-state"]).entries()) {
    const entryLabel = `${label} character-state[${index}]`;
    if (!requireMapping(entry, entryLabel, label, errors)) {
      continue;
    }
    const character = idText(entry.character);
    if (!character || !context.characters.has(character)) {
      errors.push(err("state-missing-character", `${entryLabel} references missing character ${character || "(unset)"}`, label));
    }
    if (character) {
      if (seenCharacters.has(character)) {
        warnings.push(warn("state-duplicate-character", `${entryLabel} repeats character ${character} from character-state[${seenCharacters.get(character)}]; keep one entry per character`, label));
      } else {
        seenCharacters.set(character, index);
      }
    }
    const location = idText(entry.location);
    if (location && !context.locations.has(location)) {
      errors.push(err("state-missing-location", `${entryLabel} references missing location ${location}`, label));
    }
  }

  const knownFacts = new Map();
  for (const [index, entry] of stateEntries(data["knowledge-state"]).entries()) {
    const entryLabel = `${label} knowledge-state[${index}]`;
    if (!requireMapping(entry, entryLabel, label, errors)) {
      continue;
    }
    const character = idText(entry.character);
    // `fact` is an optional stable id so the same knowledge can be matched
    // across entries and across books in a series.
    if (entry.fact !== undefined) {
      const fact = String(entry.fact);
      if (!isKebabId(fact)) {
        errors.push(err("state-fact-not-kebab", `${entryLabel} fact ${fact || "(empty)"} must be a kebab-case id`, label));
      } else if (character) {
        // With no character the entry is already reported as missing one.
        // In a branching book a character may learn the same fact on two
        // branches, one entry each, when neither learning chapter leads to
        // the other.
        const key = `${character}\u0000${fact}`;
        const learnedIn = idText(entry["learned-in"]);
        const earlier = (knownFacts.get(key) ?? []).find((other) => !onSeparateBranches(context.chronology, other.learnedIn, learnedIn));
        if (earlier) {
          errors.push(err("state-duplicate-fact", `${entryLabel} repeats fact ${fact} for ${character} from knowledge-state[${earlier.index}]`, label));
        } else {
          knownFacts.set(key, [...(knownFacts.get(key) ?? []), { index, learnedIn }]);
        }
      }
    }
    if (!character || !context.characters.has(character)) {
      errors.push(err("state-missing-character", `${entryLabel} references missing character ${character || "(unset)"}`, label));
    }
    if (!entry.knows) {
      errors.push(err("state-missing-knows", `${entryLabel} is missing knows`, label));
    }
    const learnedIn = idText(entry["learned-in"]);
    if (learnedIn && !context.chapterNumbers.has(learnedIn)) {
      errors.push(err("state-missing-chapter", `${entryLabel} references missing chapter ${learnedIn}`, label));
    }
    checkPosthumousLearning(context.characters.get(character), learnedIn, entryLabel, label, context, errors, warnings);
  }

  const seenArtifacts = new Map();
  for (const [index, entry] of stateEntries(data["object-state"]).entries()) {
    const entryLabel = `${label} object-state[${index}]`;
    if (!requireMapping(entry, entryLabel, label, errors)) {
      continue;
    }
    const artifactId = idText(entry.artifact);
    const artifact = context.artifacts.get(artifactId);
    if (!artifactId || !artifact) {
      errors.push(err("state-missing-artifact", `${entryLabel} references missing artifact ${artifactId || "(unset)"}`, label));
    }
    // Entries with different `since` chapters are the artifact's history;
    // two for the same chapter contradict each other.
    const since = idText(entry.since);
    if (artifactId) {
      const key = `${artifactId}\u0000${since}`;
      if (seenArtifacts.has(key)) {
        warnings.push(warn("state-duplicate-artifact", `${entryLabel} repeats artifact ${artifactId} from object-state[${seenArtifacts.get(key)}]; keep one entry per artifact${since ? ` per since chapter` : ""}`, label));
      } else {
        seenArtifacts.set(key, index);
      }
    }
    const owner = idText(entry.owner);
    if (owner && !context.characters.has(owner) && !context.factions.has(owner)) {
      errors.push(err("state-missing-owner", `${entryLabel} references missing owner ${owner}`, label));
    }
    const location = idText(entry.location);
    if (location && !context.locations.has(location)) {
      errors.push(err("state-missing-location", `${entryLabel} references missing location ${location}`, label));
    }
    if (since && !context.chapterNumbers.has(since)) {
      errors.push(err("state-missing-chapter", `${entryLabel} references missing since chapter ${since}`, label));
    }
    // Only the artifact's latest entry describes it now.
    if (entry.status && artifact && artifact.status && entry.status !== artifact.status && latestObjectEntry(data, artifactId, context) === entry) {
      warnings.push(warn("state-status-conflict", `${entryLabel} status ${entry.status} conflicts with ${relative(project, artifact.file)} status ${artifact.status}`, label));
    }
  }
}

// Whether two chapters lie on separate branches of a branching book: both
// written and on paths of choices, with neither at or before the other.
function onSeparateBranches(chronology, left, right) {
  return Boolean(chronology.branching) && chronology.numbers.has(left) && chronology.numbers.has(right)
    && chronology.placed(left) && chronology.placed(right)
    && !chronology.atOrBefore(left, right) && !chronology.atOrBefore(right, left);
}

// Learning a fact is an on-page event: a character cannot learn one after
// their death chapter, and one dead before the story (deceased with no
// died-in) cannot learn one at all.
function checkPosthumousLearning(character, learnedIn, entryLabel, file, context, errors, warnings) {
  if (!character || !context.chapterNumbers.has(learnedIn)) {
    return;
  }
  // Status progressions apply as they do to cast appearances.
  const death = progressionDeathAt(character, learnedIn, context.chronology);
  if (death?.from === "") {
    warnings.push(warn("deceased-learning", `${entryLabel} has ${character.id} learn something in ${learnedIn}, but ${character.id} died before the story (deceased with no died-in)`, file, learnedIn));
  } else if (death) {
    warnings.push(warn("progression-deceased-learning", `${entryLabel} has ${character.id} learn something in ${learnedIn}, but their progressions make them deceased from ${death.from}`, file, learnedIn));
  }
  if (!character.diedIn) {
    return;
  }
  // Like a cast appearance, learning is checked against the dead window, which
  // a revival ends and which stays closed while the death chapter is still an
  // outline. Whether a `learned-in` on an outline chapter counts as known is a
  // separate question (story knowledge) and is unchanged here.
  const window = deathWindow(character, context.chronology);
  if (window && window.deadIn(learnedIn)) {
    errors.push(err("posthumous-learning", `${entryLabel} has ${character.id} learn something in ${learnedIn}, after they died in ${character.diedIn}`, file, learnedIn));
  }
}

// A scene knowledge change is a learning event in the scene's chapter, so it
// gets the same posthumous check as a knowledge-state entry, whether or not
// an earlier entry already records the fact.
function checkSceneLearning(project, context, errors, warnings) {
  for (const scene of project.scenes) {
    for (const change of scene.stateChanges) {
      if (!change || typeof change !== "object" || Array.isArray(change) || change.knowledge === undefined) {
        continue;
      }
      const character = context.characters.get(idText(change.character));
      checkPosthumousLearning(character, scene.chapter, `${relative(project, scene.file)} state-change`, relative(project, scene.file), context, errors, warnings);
    }
  }
}

// Cross-checks continuity/state.md with the scene records and deaths it
// summarises: scene knowledge changes need a knowledge-state entry, nobody
// learns or is tracked after dying, a learner is in the cast of the chapter
// they learn in, and character and object locations and owners agree with
// the scenes up to current-chapter. All are warnings, since state.md may
// knowingly summarise differently.
function checkStateAgainstStory(project, context, warnings) {
  if (!project.continuity) {
    return;
  }
  const label = "continuity/state.md";
  const data = project.continuity.data;
  const { chronology } = context;
  const currentChapter = Number.isInteger(data["current-chapter"]) ? data["current-chapter"] : -Infinity;
  const current = project.chapters.find((chapter) => chapter.number === currentChapter);
  // Up to current-chapter: in a branching book, only the chapters on a path
  // of choices that leads to it.
  const byPath = Boolean(chronology.branching && current);
  const tracked = byPath
    ? (chapterId) => chronology.readBy(chapterId, current.id)
    : (chapterId) => (context.chapterNumbers.get(chapterId) ?? Infinity) <= currentChapter;
  const windows = new Map();
  for (const character of project.characters) {
    const window = character.diedIn && !chronology.outline.has(character.diedIn) ? deathWindow(character, chronology) : null;
    if (window) {
      windows.set(character.id, window);
    }
  }
  const chaptersById = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
  const scenesOf = (chapterId) => project.scenes
    .filter((scene) => scene.chapter === chapterId)
    .sort((left, right) => left.scene - right.scene || left.id.localeCompare(right.id, "en"));
  const inCast = (record, characterId) => record.characters.includes(characterId) || record.pov === characterId;

  const knowledge = [];
  for (const [index, entry] of stateEntries(data["knowledge-state"]).entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const character = idText(entry.character);
    const learnedIn = idText(entry["learned-in"]);
    knowledge.push({ index, character, learnedIn, fact: entry.fact === undefined ? "" : String(entry.fact), knows: normalizeKnowledge(entry.knows) });
    if (!character || !chaptersById.has(learnedIn)) {
      continue;
    }
    const entryLabel = `${label} knowledge-state[${index}]`;
    const chapter = chaptersById.get(learnedIn);
    if (chapter.status !== "outline" && !inCast(chapter, character) && !scenesOf(learnedIn).some((scene) => inCast(scene, character))) {
      warnings.push(warn("learner-not-in-cast", `${entryLabel} has ${character} learn something in ${learnedIn}, which does not list ${character} in characters or pov`, label, learnedIn));
    }
  }

  // Each scene knowledge change needs its own knowledge-state entry learned
  // by that chapter: matched by fact id or by text first, then paired with an
  // entry learned in that same chapter that nothing else matched.
  const unmatched = [];
  const used = new Set();
  for (const { unit: scene, isChapter } of readingUnits(project)) {
    if (isChapter || !tracked(scene.chapter)) {
      continue;
    }
    for (const change of scene.stateChanges) {
      if (!change || typeof change !== "object" || Array.isArray(change) || change.knowledge === undefined) {
        continue;
      }
      const character = idText(change.character);
      if (!character) {
        continue;
      }
      const known = knowledge.filter((entry) => entry.character === character
        && (entry.learnedIn === "" || (context.chapterNumbers.has(entry.learnedIn) && chronology.atOrBefore(entry.learnedIn, scene.chapter))));
      const fact = change.fact === undefined ? "" : String(change.fact);
      const text = normalizeKnowledge(change.knowledge);
      const matches = known.filter((entry) => (fact !== "" && entry.fact === fact) || (text !== "" && entry.knows === text));
      if (matches.length > 0) {
        matches.forEach((entry) => used.add(entry.index));
        continue;
      }
      unmatched.push({ scene, change, character, known });
    }
  }
  for (const { scene, change, character, known } of unmatched) {
    const pair = known.find((entry) => entry.learnedIn === scene.chapter && !used.has(entry.index));
    if (pair) {
      used.add(pair.index);
      continue;
    }
    warnings.push(warn("knowledge-not-recorded", `${relative(project, scene.file)} state-changes record ${character} learning "${String(change.knowledge).trim()}" but ${label} has no knowledge-state entry for it learned by ${scene.chapter}`, relative(project, scene.file), chapterOf(scene)));
  }

  for (const [index, entry] of stateEntries(data["character-state"]).entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const character = idText(entry.character);
    const entryLabel = `${label} character-state[${index}]`;
    // Dead at current-chapter in story time: from the death chapter itself
    // until a revival.
    const window = windows.get(character);
    if (window && current && (current.id === window.died || window.deadIn(current.id))) {
      warnings.push(warn("state-tracks-dead-character", `${entryLabel} tracks ${character}, who died in ${window.died}; remove the entry once they are dead`, label, current.id));
      continue;
    }
    // The same for a death by status progression, once its chapter is
    // written; a character dead since before the story is left alone.
    const deadFrom = context.characters.has(character) && current ? progressionDeathFrom(context.characters.get(character), current.id, chronology) : null;
    if (deadFrom && !chronology.outline.has(deadFrom) && chronology.numbers.has(deadFrom)) {
      warnings.push(warn("state-tracks-dead-character", `${entryLabel} tracks ${character}, whose progressions make them deceased from ${deadFrom}; remove the entry once they are dead`, label, current.id));
      continue;
    }
    const location = idText(entry.location);
    if (!current || !location) {
      continue;
    }
    // The chapter can move them on after their last scene, so any place the
    // chapter lists will do; a place it never visits is drift.
    const last = scenesOf(current.id).filter((scene) => inCast(scene, character) && scene.location).pop();
    if (last && last.location !== location && !current.locations.includes(location)) {
      warnings.push(warn("state-location-drift", `${entryLabel} puts ${character} at ${location}, but their last scene in ${current.id}, ${relative(project, last.file)}, is at ${last.location} and the chapter does not list ${location}`, label, current.id));
    }
  }

  // The latest scene state change that sets an artifact's owner or location,
  // up to current-chapter, should match the artifact's latest entry.
  // In a branching book each chapter keeps its own last change, and a change
  // still holds at current-chapter when some path from it gets there
  // without passing another chapter that changes the same field.
  const lastSet = new Map();
  for (const { unit: scene, isChapter } of readingUnits(project)) {
    if (isChapter || !tracked(scene.chapter)) {
      continue;
    }
    for (const change of scene.stateChanges) {
      if (!change || typeof change !== "object" || Array.isArray(change)) {
        continue;
      }
      const artifact = idText(change.target);
      for (const field of ["owner", "location"]) {
        if (artifact && context.artifacts.has(artifact) && idText(change[field]) !== "") {
          const key = byPath ? `${artifact}\u0000${field}\u0000${scene.chapter}` : `${artifact}\u0000${field}`;
          lastSet.set(key, { artifact, field, value: idText(change[field]), scene });
        }
      }
    }
  }
  const latestSets = [...lastSet.values()].filter((set, _, all) => {
    if (!byPath || set.scene.chapter === current.id) {
      return true;
    }
    const others = all.filter((other) => other.artifact === set.artifact && other.field === set.field && other.scene.chapter !== set.scene.chapter);
    // A chapter no path reaches is superseded by any chapter read after it.
    if (!chronology.placed(set.scene.chapter) || !chronology.placed(current.id)) {
      return !others.some((other) => chronology.readAfter(other.scene.chapter, set.scene.chapter));
    }
    return chronology.reachesAvoiding(set.scene.chapter, current.id, new Set(others.map((other) => other.scene.chapter)));
  });
  const byField = new Map();
  for (const set of latestSets) {
    const key = `${set.artifact}\u0000${set.field}`;
    byField.set(key, [...(byField.get(key) ?? []), set]);
  }
  const settled = [];
  for (const sets of byField.values()) {
    const values = [...new Set(sets.map((set) => set.value))];
    // With no object-state entry, object-not-recorded is the finding.
    const entry = latestObjectEntry(data, sets[0].artifact, context);
    if (values.length === 1 || !entry) {
      settled.push(sets[sets.length - 1]);
      continue;
    }
    // An entry recorded after every branch's change, where they rejoin,
    // settles the difference, as a newer entry does for one change.
    const since = idText(entry.since);
    if (since !== "" && context.chapterNumbers.has(since) && sets.every((set) => chronology.after(since, set.scene.chapter))) {
      continue;
    }
    // Branches that lead to current-chapter leave it in different states,
    // so no one snapshot matches every path.
    const { artifact, field } = sets[0];
    const where = sets.map((set) => `${relative(project, set.scene.file)} sets ${set.value}`).join(", ");
    warnings.push(warn("state-differs-by-path", `${label} object-state for ${artifact} cannot match every path to ${current.id}: ${where}; set ${artifact} ${field} again in a chapter the branches share, or check each path by hand`, label, current.id));
  }
  for (const { artifact, field, value, scene } of settled) {
    const entry = latestObjectEntry(data, artifact, context);
    if (!entry) {
      warnings.push(warn("object-not-recorded", `${relative(project, scene.file)} state-changes set ${artifact} ${field} ${value} but ${label} has no object-state entry for ${artifact}`, relative(project, scene.file), chapterOf(scene)));
      continue;
    }
    // An entry recorded after the scene's chapter is newer than the scene.
    const since = idText(entry.since);
    const newer = since !== "" && context.chapterNumbers.has(since) && chronology.after(since, scene.chapter);
    const stated = idText(entry[field]);
    if (!newer && stated !== value) {
      const index = stateEntries(data["object-state"]).indexOf(entry);
      warnings.push(warn("state-object-drift", `${label} object-state[${index}] gives ${artifact} ${field} ${stated || "(unset)"}, but ${relative(project, scene.file)} state-changes last set it to ${value}`, label, chapterOf(scene)));
    }
  }
}

// Folds a knowledge text for matching: case, spacing, and a trailing full
// stop or exclamation mark are ignored. `story context` matches the same way.
export function normalizeKnowledge(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, "") : "";
}

// The object-state entry with the latest `since` in story time for an
// artifact (no `since`, or a missing chapter, counts as before the story;
// ties go to the later entry in the file).
function latestObjectEntry(data, artifactId, context) {
  let latest = null;
  let latestSince = "";
  for (const entry of stateEntries(data["object-state"])) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || idText(entry.artifact) !== artifactId) {
      continue;
    }
    const since = context.chapterNumbers.has(idText(entry.since)) ? idText(entry.since) : "";
    if (latest === null || compareSince(since, latestSince, context) >= 0) {
      latest = entry;
      latestSince = since;
    }
  }
  return latest;
}

// Orders two object-state `since` chapters in story time; "" (before the
// story) comes first, and chapters neither before nor after tie at 0.
function compareSince(left, right, context) {
  if (left === "" || right === "") {
    return (left === "" ? 0 : 1) - (right === "" ? 0 : 1);
  }
  const { after } = context.chronology;
  return after(left, right) ? 1 : after(right, left) ? -1 : 0;
}

// Hand-written ids such as `47` or `true` parse as numbers or booleans; they
// name the same entity as the string id.
export function idText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

// A pov also listed in mentions narrates without appearing, as a ghost or a
// narrator looking back after their death does.
function castIncludes(record, characterId) {
  return record.characters.includes(characterId) || (record.pov === characterId && !record.mentions.includes(characterId));
}

function stateEntries(value) {
  return Array.isArray(value) ? value : [];
}

function isKebabId(value) {
  return value !== "" && value === kebabCase(value);
}

function requireMapping(entry, entryLabel, file, errors) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(err("entry-not-mapping", `${entryLabel} must be a mapping`, file));
    return false;
  }
  return true;
}

function relative(project, file) {
  return projectPath(project.root, file);
}

// The chapter a chapter or scene record is in, for a finding's `chapter`: a
// scene's `chapter` field, or a chapter's own id. A scene with no chapter
// gives null.
function chapterOf(record) {
  const id = record.chapter !== undefined ? idText(record.chapter) : record.id;
  return id === "" ? null : id;
}

// Prop custody: artifacts with destroyed/lost object-state must not appear in
// later chapters or scenes. The destruction chapter is recorded in
// object-state `since`; later scenes whose state-changes target the artifact
// are errors, and later chapters/scenes listing it in mentions or characters
// are errors. An entry with no `since` was destroyed or lost before this book
// (carried from an earlier one), so any scene that uses it is an error;
// mentions stay allowed, since characters remember it. Several entries for one
// artifact with different `since` chapters are its history, ordered in story
// time: a later entry with another status (`active` since chapter-04) ends a
// loss, and the recovery chapter itself may use the artifact again. Nothing
// ends a destruction. A destroyed artifact stays destroyed.
function checkPropCustody(project, context, errors) {
  const { after } = context.chronology;
  for (const { artifact, since, beforeStory, until } of goneWindows(project, context)) {
    const inWindow = (chapterId) => context.chapterNumbers.has(chapterId)
      && (beforeStory || after(chapterId, since))
      && (until === "" || after(until, chapterId));
    for (const scene of project.scenes) {
      if (!inWindow(scene.chapter)) {
        continue;
      }
      const sceneLabel = relative(project, scene.file);
      if (scene.stateChanges.some((change) => stateChangeTargets(change, artifact))) {
        errors.push(err("gone-artifact-used", `${sceneLabel} uses ${artifact}, destroyed/lost ${beforeStory ? "before the story" : `since ${since}`}`, sceneLabel, chapterOf(scene)));
      }
      if (!beforeStory && scene.mentions.includes(artifact)) {
        errors.push(err("gone-artifact-mentioned", `${sceneLabel} mentions ${artifact}, destroyed/lost since ${since}`, sceneLabel, chapterOf(scene)));
      }
    }
    for (const chapter of project.chapters) {
      if (beforeStory || !inWindow(chapter.id)) {
        continue;
      }
      if (chapter.mentions.includes(artifact)) {
        errors.push(err("gone-artifact-mentioned", `${relative(project, chapter.file)} mentions ${artifact}, destroyed/lost since ${since}`, relative(project, chapter.file), chapter.id));
      }
    }
  }
}

// Each artifact's object-state entries in story-time `since` order (no
// `since` first), as windows in which it is gone: from a destroyed/lost entry
// to the next entry with another status, or for good once it is destroyed.
// Consecutive gone entries form one window that starts at the earliest, so
// each late reference is reported once.
function goneWindows(project, context) {
  const histories = new Map();
  for (const entry of project.continuity ? stateEntries(project.continuity.data["object-state"]) : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const artifact = idText(entry.artifact);
    const since = idText(entry.since);
    // checkContinuityState reports a since chapter that does not exist.
    if (artifact === "" || (since !== "" && !context.chapterNumbers.has(since))) {
      continue;
    }
    const status = String(entry.status ?? "").trim().toLowerCase();
    const list = histories.get(artifact) ?? [];
    list.push({ since, destroyed: status === "destroyed", gone: status === "destroyed" || status === "lost" });
    histories.set(artifact, list);
  }

  const windows = [];
  for (const [artifact, history] of histories) {
    history.sort((left, right) => compareSince(left.since, right.since, context));
    let open = null;
    for (const entry of history) {
      if (entry.gone && open === null) {
        open = { artifact, since: entry.since, beforeStory: entry.since === "", until: "", destroyed: entry.destroyed };
        windows.push(open);
      } else if (entry.gone) {
        open.destroyed ||= entry.destroyed;
      } else if (open !== null && !open.destroyed && compareSince(entry.since, open.since, context) > 0) {
        open.until = entry.since;
        open = null;
      }
    }
  }
  return windows;
}

function stateChangeTargets(change, artifact) {
  if (!change || typeof change !== "object" || Array.isArray(change)) {
    return false;
  }
  return idText(change.target) === artifact;
}

// Clock/time plausibility. Malformed dates and times are always reported;
// the ordering checks run over dated units in reading order (see
// readingUnits). A unit runs backward when it is earlier than the latest
// moment the story has reached, and scene travel-hours asserts a minimum
// time since that moment. Named times are windows (see sceneWindow), as in
// the route check, so only what is impossible on every reading is reported.
const TIME_RANKS = new Map([
  ["dawn", 300],
  ["morning", 420],
  ["midday", 720],
  ["afternoon", 900],
  ["evening", 1140],
  ["night", 1380]
]);

function checkClock(project, errors, warnings) {
  for (const scene of project.scenes) {
    const label = relative(project, scene.file);
    if (scene.date !== "" && !parseClockDate(scene.date)) {
      warnings.push(warn("malformed-date", `${label} has malformed date "${scene.date}"`, label, chapterOf(scene)));
    }
    if (scene.time !== "" && parseClockTime(scene.time) === undefined) {
      warnings.push(warn("malformed-time", `${label} has malformed time "${scene.time}"`, label, chapterOf(scene)));
    }
    if (scene.travelHours < 0) {
      warnings.push(warn("negative-travel-hours", `${label} has negative travel-hours ${scene.travelHours}`, label, chapterOf(scene)));
    }
    if (scene.date === "" && scene.travelHours > 0) {
      warnings.push(warn("travel-hours-undated", `${label} has travel-hours but no date, so the clock check skips it`, label, chapterOf(scene)));
    }
  }
  for (const chapter of project.chapters) {
    if (chapter.date !== "" && !parseClockDate(chapter.date)) {
      warnings.push(warn("malformed-date", `Chapter ${chapter.number} has malformed date "${chapter.date}"`, relative(project, chapter.file), chapter.id));
    }
    if (chapter.time !== "" && parseClockTime(chapter.time) === undefined) {
      warnings.push(warn("malformed-time", `Chapter ${chapter.number} has malformed time "${chapter.time}"`, relative(project, chapter.file), chapter.id));
    }
  }

  // Each chapter `strand` (a dual-timeline book's 1990 and 2020 threads)
  // keeps its own clock, so switching strands does not run backward.
  const strands = new Map();
  for (const { unit, chapter, isChapter } of readingUnits(project)) {
    const strand = String(chapter.strand ?? "");
    if (!strands.has(strand)) {
      strands.set(strand, []);
    }
    const stamps = strands.get(strand);
    const parsed = unit.date === "" ? undefined : parseClockDate(unit.date);
    if (!parsed) {
      continue;
    }
    const minutes = parseClockTime(unit.time);
    stamps.push({
      label: isChapter ? `Chapter ${unit.number}` : relative(project, unit.file),
      file: relative(project, unit.file),
      chapter: chapter.id || null,
      isChapter,
      date: parsed.text,
      time: minutes === undefined ? "" : unit.time.trim(),
      days: parsed.days,
      minutes,
      ...sceneWindow(parsed.days, unit.time),
      travelHours: isChapter ? 0 : unit.travelHours,
      flashback: !isChapter && unit.flashbackTo !== ""
    });
  }
  for (const stamps of strands.values()) {
    checkClockOrder(stamps, errors, warnings);
  }
  checkRouteTravel(project, errors);
}

// Story-order units shared by story timeline and the continuity clock: each
// chapter's scenes in scene order, or the chapter itself when it has no scene
// records. Scenes whose chapter matches no chapter file are kept, placed by
// the number in their chapter id (chapter-07 after chapter 6), else last.
export function readingUnits(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  const scenesByChapter = new Map();
  for (const scene of project.scenes) {
    const list = scenesByChapter.get(scene.chapter) ?? [];
    list.push(scene);
    scenesByChapter.set(scene.chapter, list);
  }
  const groups = chapters.map((chapter) => ({ chapter, orphan: false }));
  const known = new Set(chapters.map((chapter) => chapter.id));
  for (const chapterId of scenesByChapter.keys()) {
    if (!known.has(chapterId)) {
      const match = /^chapter-(\d+)$/.exec(chapterId);
      const number = match ? Number.parseInt(match[1], 10) : Infinity;
      groups.push({ chapter: { id: chapterId, number, title: chapterId, pov: "", locations: [] }, orphan: true });
    }
  }
  // Infinity - Infinity is NaN, which falls through to the next key.
  groups.sort((left, right) => (left.chapter.number - right.chapter.number || 0)
    || Number(left.orphan) - Number(right.orphan)
    || left.chapter.id.localeCompare(right.chapter.id, "en"));

  const units = [];
  for (const { chapter, orphan } of groups) {
    const scenes = (scenesByChapter.get(chapter.id) ?? [])
      .sort((left, right) => left.scene - right.scene || left.id.localeCompare(right.id, "en"));
    if (scenes.length === 0) {
      units.push({ unit: chapter, chapter, isChapter: true, orphan });
    }
    for (const scene of scenes) {
      units.push({ unit: scene, chapter, isChapter: false, orphan });
    }
  }
  return units;
}

// Walks dated units in reading order against a reference: the latest moment
// reached so far, with the latest known time on that day. A unit that runs
// backward (a flashback, or a misdated unit) is reported once and does not
// become the reference, so later units are still checked against the main
// line. When the reference itself was the outlier (a flash-forward prologue
// that the next units all fall before), the story continues from the units
// after it instead of reporting each of them.
function checkClockOrder(stamps, errors, warnings) {
  let reference = null;
  let preceding = null;
  let candidate = null;
  for (const current of stamps) {
    if (reference === null) {
      reference = current;
      continue;
    }
    if (!runsBackward(current, reference)) {
      checkTravelHours(current, reference, errors);
      const next = advanceClock(reference, current);
      if (next !== reference) {
        preceding = reference;
        reference = next;
      }
      candidate = null;
      continue;
    }
    if (candidate && !current.flashback && !runsBackward(current, candidate)
      && (preceding === null || !runsBackward(candidate, preceding))) {
      checkTravelHours(current, candidate, errors);
      preceding = candidate;
      reference = advanceClock(candidate, current);
      candidate = null;
      continue;
    }
    warnings.push(backwardFinding(current, reference));
    if (!current.flashback) {
      candidate = current;
    }
  }
}

// Backward only when the latest reading of this unit is still before the
// earliest moment the story has reached.
function runsBackward(current, reference) {
  return current.latest < reference.earliest;
}

// The story has reached at least the later of the two earliest readings. An
// untimed unit, or a named time that starts before the reference's known
// time, could fall after it, so the reference stays.
function advanceClock(reference, current) {
  return current.earliest <= reference.earliest ? reference : current;
}

function backwardFinding(current, reference) {
  if (!current.isChapter) {
    return warn("clock-backward", `${current.label} timestamp runs backward`, current.file, current.chapter);
  }
  const sameDay = current.days === reference.days;
  const when = (stamp) => (sameDay && stamp.time ? `${stamp.date} ${stamp.time}` : stamp.date);
  return warn("clock-backward", `${current.label} date ${when(current)} is earlier than ${reference.label} date ${when(reference)}`, current.file, current.chapter);
}

// The gap is taken at its most generous reading: the latest this unit can
// be against the earliest moment the story has reached.
function checkTravelHours(current, reference, errors) {
  if (!(current.travelHours > 0) || current.minutes === undefined || reference.minutes === undefined) {
    return;
  }
  const elapsedHours = (current.latest - reference.earliest) / 60;
  if (elapsedHours < current.travelHours - 1e-9) {
    const gap = current.exact && reference.exact ? `only ${formatHours(elapsedHours, Math.floor)}` : `at most ${formatHours(elapsedHours, Math.floor)}`;
    errors.push(err("travel-too-fast", `${current.label} allows ${gap} for travel of ${current.travelHours}h`, current.file, current.chapter));
  }
}

// Named parts of the day cover a span of clock time, so a journey is judged
// against the widest reading of each.
const TIME_RANGES = new Map([
  ["dawn", [240, 419]],
  ["morning", [300, 719]],
  ["midday", [660, 839]],
  ["afternoon", [720, 1079]],
  ["evening", [1020, 1319]],
  ["night", [1200, 1439]]
]);

// The earliest and latest minute a dated scene can happen: an exact time is
// a point, a named time its span, and no time the whole day.
function sceneWindow(days, time) {
  const text = String(time ?? "").trim().toLowerCase();
  const named = TIME_RANGES.get(text);
  const exact = named === undefined ? parseClockTime(text) : undefined;
  const [from, to] = named ?? (exact === undefined ? [0, 1439] : [exact, exact]);
  return { earliest: days * 1440 + from, latest: days * 1440 + to, exact: exact !== undefined };
}

// Location routes give the fastest journey between places. A character seen
// at two different places in the same chapter strand needs at least the
// shortest route time between the sightings, which may pass through other
// places. Strands partition sightings the way the clock does: chapters
// without `strand` share one strand, and a sighting in another strand is a
// different timeline, not the other end of a journey. The scene schema has
// no field that says a character crossed strands, so a real crossing is not
// inferred; it stays one strand, or an exemption when a finding is
// intentional. Every earlier sighting in the strand is checked, not just
// the last one, and each gap is taken at its most generous reading of the
// scene times, so only journeys impossible on any reading are reported,
// once per scene. Two different places at the same exact minute are
// reported whatever the routes say, since no journey takes no time.
function checkRouteTravel(project, errors) {
  const graph = routeGraph(project.locations);
  // A scene with no pov of its own is told by its chapter's POV, as story
  // timeline shows it. Strand is the chapter's, as the clock reads it.
  const chapterPov = new Map(project.chapters.map((chapter) => [chapter.id, idText(chapter.pov)]));
  const chapterStrand = new Map(project.chapters.map((chapter) => [chapter.id, String(chapter.strand ?? "")]));
  const sightings = new Map();
  for (const scene of project.scenes) {
    const parsed = parseClockDate(scene.date);
    if (!parsed || scene.location === "") {
      continue;
    }
    const window = sceneWindow(parsed.days, scene.time);
    const present = new Set(scene.characters.map(idText).filter((id) => id !== ""));
    const pov = idText(scene.pov) || chapterPov.get(scene.chapter) || "";
    if (pov !== "") {
      present.add(pov);
    }
    const strand = chapterStrand.get(scene.chapter) ?? "";
    for (const characterId of present) {
      const byStrand = sightings.get(characterId) ?? new Map();
      const list = byStrand.get(strand) ?? [];
      list.push({ scene, label: relative(project, scene.file), ...window });
      byStrand.set(strand, list);
      sightings.set(characterId, byStrand);
    }
  }

  // One shortest-path search per starting location, reused for every
  // destination, keeps large route maps fast.
  const routesFrom = new Map();
  const distance = (from, to) => {
    if (!routesFrom.has(from)) {
      routesFrom.set(from, shortestRoutesFrom(graph, from));
    }
    return routesFrom.get(from).get(to);
  };
  // No route is longer than every leg added together, so once the gap
  // reaches that, earlier sightings cannot conflict.
  let longestRoute = 0;
  for (const edges of graph.values()) {
    for (const hours of edges.values()) {
      longestRoute += hours;
    }
  }
  for (const [characterId, byStrand] of [...sightings.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const strands = [...byStrand.keys()].sort((left, right) => left.localeCompare(right, "en"));
    for (const strand of strands) {
      checkStrandRoutes(characterId, byStrand.get(strand), errors, graph, distance, longestRoute);
    }
  }
}

// One strand's sightings of one character, in time order. The comparison is
// the same inside every strand.
function checkStrandRoutes(characterId, list, errors, graph, distance, longestRoute) {
  list.sort((left, right) => left.earliest - right.earliest || left.latest - right.latest || left.label.localeCompare(right.label, "en"));
  for (let index = 1; index < list.length; index += 1) {
    const current = list[index];
    for (let back = index - 1; back >= 0; back -= 1) {
      const previous = list[back];
      // Sightings are sorted by earliest time, so this part of the gap only
      // grows as the search moves back; once it passes every route, no
      // earlier sighting can conflict. The other reading below can jump
      // for a wide window (an untimed day, `night`), so it must not stop
      // the search.
      const forwardGap = (current.latest - previous.earliest) / 60;
      if (forwardGap > 0 && forwardGap >= longestRoute) {
        break;
      }
      const from = previous.scene.location;
      const to = current.scene.location;
      if (from === to) {
        continue;
      }
      // Overlapping windows (an untimed day and a time on it) could fall in
      // either order, so the gap is the larger of the two readings.
      const elapsed = Math.max(forwardGap, (previous.latest - current.earliest) / 60);
      const needed = graph.has(from) && graph.has(to) ? distance(from, to) : undefined;
      if (needed === undefined && elapsed === 0 && previous.exact && current.exact) {
        errors.push(err("route-same-time", `${current.label} puts ${characterId} at ${to} at the same time as ${previous.label} at ${from}`, current.label, chapterOf(current.scene)));
        break;
      }
      // Route legs are decimal hours, so their float sum can overshoot an
      // exact fit (0.1h + 0.2h against 18 minutes) by a rounding error.
      if (needed !== undefined && elapsed < needed - 1e-9) {
        // Round the gap down and the route up so a near miss (10.98h
        // against 11h) never reads as equal.
        const gap = previous.exact && current.exact ? formatHours(elapsed, Math.floor) : `at most ${formatHours(elapsed, Math.floor)}`;
        errors.push(err("route-too-fast", `${current.label} puts ${characterId} at ${to} ${gap} after ${previous.label} at ${from}, but the fastest route takes ${formatHours(needed, Math.ceil)}`, current.label, chapterOf(current.scene)));
        break;
      }
    }
  }
}

// The routes the travel check uses, one per declared direction: routes to a
// known other location with a positive number of hours, keeping the fastest
// when a location lists the same destination twice. story diagram draws
// these same routes.
export function usableRoutes(locations) {
  const known = new Set(locations.map((location) => location.id));
  const fastest = new Map();
  for (const location of locations) {
    for (const route of location.routes ?? []) {
      if (!route || typeof route !== "object" || Array.isArray(route)) {
        continue;
      }
      const to = idText(route.to);
      if (!known.has(to) || to === location.id || typeof route.hours !== "number" || !Number.isFinite(route.hours) || route.hours <= 0) {
        continue;
      }
      const key = `${location.id}>${to}`;
      if (!fastest.has(key) || fastest.get(key).hours > route.hours) {
        fastest.set(key, { from: location.id, to, hours: route.hours, mode: typeof route.mode === "string" ? route.mode : "" });
      }
    }
  }
  return [...fastest.values()];
}

// Routes are two-way unless the destination declares its own route back.
function routeGraph(locations) {
  const graph = new Map();
  const addEdge = (from, to, hours) => {
    if (!graph.has(from)) {
      graph.set(from, new Map());
    }
    const edges = graph.get(from);
    if (!edges.has(to) || edges.get(to) > hours) {
      edges.set(to, hours);
    }
  };
  const routes = usableRoutes(locations);
  const declared = new Set(routes.map((route) => `${route.from}>${route.to}`));
  for (const { from, to, hours } of routes) {
    addEdge(from, to, hours);
    if (!declared.has(`${to}>${from}`)) {
      addEdge(to, from, hours);
    }
  }
  return graph;
}

// Dijkstra from one location with a binary heap: the fewest hours to every
// reachable location.
function shortestRoutesFrom(graph, from) {
  const distances = new Map([[from, 0]]);
  const heap = [[0, from]];
  const push = (entry) => {
    heap.push(entry);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent][0] <= heap[index][0]) {
        break;
      }
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < heap.length && heap[left][0] < heap[smallest][0]) {
          smallest = left;
        }
        if (right < heap.length && heap[right][0] < heap[smallest][0]) {
          smallest = right;
        }
        if (smallest === index) {
          break;
        }
        [heap[smallest], heap[index]] = [heap[index], heap[smallest]];
        index = smallest;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [best, current] = pop();
    if (best > distances.get(current)) {
      continue;
    }
    for (const [next, hours] of graph.get(current) ?? []) {
      if (!distances.has(next) || best + hours < distances.get(next)) {
        distances.set(next, best + hours);
        push([best + hours, next]);
      }
    }
  }
  return distances;
}

function formatHours(hours, round = Math.round) {
  return `${round(Math.round(hours * 1e6) / 1e5) / 10}h`;
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

// The one check of a story date. `deadline`, `publication-date`, and
// progress sessions must be a real YYYY-MM-DD day. A chapter or scene `date`
// passes `freeText`: a value shaped like YYYY-MM-DD must still be a real day
// (2024-13-45 and 2023-02-29 are errors), but other text is left to story
// continuity, which warns about it as malformed-date.
export function storyDateError(value, { freeText = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "";
  }
  if (freeText && !DATE_SHAPE.test(String(value).trim())) {
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

export function parseClockDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Date.UTC maps years 0-99 to 1900-1999, so set the full year explicitly.
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year, month - 1, day);
  const days = date.getTime() / 86400000;
  const roundtrip = new Date(days * 86400000);
  if (roundtrip.getUTCFullYear() !== year || roundtrip.getUTCMonth() !== month - 1 || roundtrip.getUTCDate() !== day) {
    return undefined;
  }
  return { text: value.trim(), days };
}

export function parseClockTime(value) {
  const text = value.trim().toLowerCase();
  if (text === "") {
    return undefined;
  }
  const named = TIME_RANKS.get(text);
  if (named !== undefined) {
    return named;
  }
  const match = /^(\d{2}):(\d{2})$/.exec(text);
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

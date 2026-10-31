// The markdown story add writes for a new entity record, one template per
// kind.
import path from "node:path";
import { storyDateError, storyTimeError } from "./continuity.js";
import { stringifyFrontmatter } from "./frontmatter.js";
import { isTruthy, optionValues } from "./options.js";
import { chapterHeading, kebabCase } from "./markdown.js";
import { usageError } from "./exit-codes.js";
import { oneLine } from "./unicode.js";
import { RESEARCH_RISKS, entityConfig } from "./scan-schema.js";
import {
  requireKebabId,
  requestedEntityId,
  undeducibleIdMessage,
  parseDecimalInteger,
  requirePositiveInteger
} from "./scan-ids.js";
import { asArray } from "./scan-fields.js";

export function buildEntity(project, kind, name, options) {
  const requestedId = requestedEntityId(kind, options.id);

  if (kind === "chapter") {
    const number = options.number === undefined
      ? project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0) + 1
      : requirePositiveInteger(options.number, "chapter number");
    const id = `chapter-${String(number).padStart(2, "0")}`;
    return entityResult(project, kind, id, chapterFile(name, number, options, project.unit, project.calendar));
  }

  if (kind === "scene") {
    if (options.chapter === undefined && project.chapters.length === 0) {
      throw usageError("No chapters yet: add one with story add chapter before adding a scene");
    }
    const chapter = String(options.chapter ?? project.chapters.at(-1).id).trim();
    requireKebabId(chapter, "chapter id");
    if (!project.chapters.some((entry) => entry.id === chapter)) {
      throw usageError(`chapter ${chapter} does not exist: add it with story add chapter, or pass --chapter with an existing chapter id`);
    }
    const scene = options.scene === undefined
      ? nextSceneNumber(project, chapter)
      : requirePositiveInteger(options.scene, "scene number");
    const id = `${chapter}-scene-${String(scene).padStart(2, "0")}`;
    return entityResult(project, kind, id, sceneFile(name, chapter, scene, options, project.calendar));
  }

  const id = requestedId ?? kebabCase(name);
  if (!id) {
    throw usageError(undeducibleIdMessage(kind, name));
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
  }
}

function entityResult(project, kind, id, markdown) {
  const config = entityConfig(kind);
  return { id, markdown, file: path.join(project.root, config.dir, `${id}.md`) };
}

function characterFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    role: options.role ?? "supporting",
    status: options.status ?? "alive",
    aliases: [],
    relationships: [],
    locations: listOption(options, "locations", "location"),
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
    "notable-characters": listOption(options, "characters", "character"),
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
    members: listOption(options, "members", "member", "characters", "character"),
    locations: listOption(options, "locations", "location"),
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
    characters: listOption(options, "characters", "character"),
    themes: listOption(options, "themes", "theme"),
    acts: listOption(options, "acts", "act")
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

// A chapter beat is a short label, such as Midpoint or All Is Lost, from a
// beat sheet or the writer's own: validate warns above this many characters
// as a reader counts them (grapheme clusters), since a sentence would
// stretch the grid and belongs in the outline.
export const BEAT_MAX_LENGTH = 60;

// A chapter beat as one line, as a label reads: a line break in a
// hand-written value, and the spaces around it, become one space, a tab a
// space, and any other control character U+FFFD, so an escape sequence
// cannot drive the terminal `story grid` or `story context` prints to.
export function beatText(value) {
  return oneLine(value).replace(/\t/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "\ufffd");
}

export function chapterFile(title, number, options, unit, calendar = null) {
  const dateError = storyDateError(options.date, { calendar });
  if (dateError) {
    throw usageError(dateError);
  }
  const timeError = storyTimeError(options.time, { calendar });
  if (timeError) {
    throw usageError(timeError);
  }
  // A blank --beat sets none.
  const beat = options.beat === undefined ? "" : beatText(options.beat);
  return `${stringifyFrontmatter({
    title,
    number,
    pov: options.pov ?? "",
    locations: listOption(options, "locations", "location"),
    characters: castWithPov(options),
    mentions: listOption(options, "mentions", "mention"),
    "arcs-advanced": listOption(options, "arcs", "arc"),
    status: options.status ?? "outline",
    mode: options.mode ?? "",
    date: options.date ?? "",
    time: options.time ?? "",
    ...(options.hook === undefined ? {} : { hook: options.hook }),
    ...(beat === "" ? {} : { beat }),
    "word-count": 0,
    // A book counted in characters records character-count too.
    ...(unit.name === "characters" ? { "character-count": 0 } : {})
  })}# ${chapterHeading(number, title)}

## Outline

1. Opening beat
2. Escalation
3. Turn or decision

---

## Chapter Text

`;
}

function sceneFile(title, chapter, scene, options, calendar = null) {
  const dateError = storyDateError(options.date, { calendar });
  if (dateError) {
    throw usageError(dateError);
  }
  const timeError = storyTimeError(options.time, { calendar });
  if (timeError) {
    throw usageError(timeError);
  }
  const travelHoursOption = options["travel-hours"];
  let travelHours;
  if (travelHoursOption !== undefined && travelHoursOption !== "") {
    travelHours = Number(travelHoursOption);
    if (!Number.isFinite(travelHours)) {
      throw usageError(`travel-hours must be a number, got ${travelHoursOption}`);
    }
    if (travelHours < 0) {
      throw usageError(`travel-hours must be zero or positive, got ${travelHoursOption}`);
    }
  }
  const frontmatter = {
    title,
    chapter,
    scene,
    pov: options.pov ?? "",
    location: options.location ?? "",
    characters: castWithPov(options),
    mentions: listOption(options, "mentions", "mention"),
    "arcs-advanced": listOption(options, "arcs", "arc"),
    status: options.status ?? "outline",
    date: options.date ?? "",
    time: options.time ?? "",
    sequel: options.sequel ?? false,
    ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
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

// The POV character is on the page, so it belongs in the cast; continuity
// warns about a POV missing from `characters`.
function castWithPov(options) {
  const characters = listOption(options, "characters", "character");
  const pov = String(options.pov ?? "").trim();
  return pov === "" || characters.includes(pov) ? characters : [pov, ...characters];
}

function questionFile(title, options) {
  const resolved = String(options.resolved ?? "").trim();
  if (resolved !== "" && options.status === "open") {
    throw usageError("A question with --resolved cannot have status open: use --status answered or resolved");
  }
  return `${stringifyFrontmatter({
    title,
    // A resolved chapter means the answer is on the page.
    status: options.status ?? (resolved === "" ? "open" : "answered"),
    introduced: options.introduced ?? "",
    resolved: options.resolved ?? "",
    characters: listOption(options, "characters", "character")
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
    arcs: listOption(options, "arcs", "arc"),
    characters: listOption(options, "characters", "character")
  })}# ${title}

## Setup

What is promised to the reader.

## Payoff

How the story should answer the setup.

## Tracking Notes

Keep planted and payoff chapters current.
`;
}

// A promise or clue created with --planted is already on the page, so its
// default status follows the chapter rather than contradicting it.
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
    ...(options["red-herring"] ? { "red-herring": true } : {}),
    characters: listOption(options, "characters", "character"),
    arcs: listOption(options, "arcs", "arc")
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
    aliases: listOption(options, "aliases", "alias")
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
    // Citations contain commas, so sources are kept whole, one per flag.
    sources: [...new Set(asArray(options.sources).concat(asArray(options.source)).map((source) => String(source).trim()).filter(Boolean))],
    "used-in": listOption(options, "used-in"),
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
  const risks = listOption(options, "risk");
  for (const risk of risks) {
    if (!RESEARCH_RISKS.has(risk)) {
      throw usageError(`Unsupported risk "${risk}": expected one of ${[...RESEARCH_RISKS].join(", ")}`);
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
    order = parseDecimalInteger(options.order);
    if (order === null) {
      throw usageError(`matter order must be a non-negative integer, got ${options.order}`);
    }
  }
  // --heading=false suits a dedication or epigraph, which prints no title.
  const heading = options.heading === undefined ? true : isTruthy(options.heading);
  return `${stringifyFrontmatter({ title, placement, order, heading })}# ${title}

`;
}

export function nextSceneNumber(project, chapter) {
  return project.scenes
    .filter((scene) => scene.chapter === chapter)
    .reduce((max, scene) => Math.max(max, scene.scene), 0) + 1;
}

// A list option with its singular and plural flags merged, duplicates
// dropped: `--character a --characters b` keeps both. Only the plural flag
// splits on commas (see optionValues).
function listOption(options, ...names) {
  const list = [];
  for (const name of names) {
    for (const value of optionValues(options, name)) {
      if (!list.includes(value)) {
        list.push(value);
      }
    }
  }
  return list;
}

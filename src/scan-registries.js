// The markdown init and reindex write for story.md, the registries (_index.md
// files), the timeline, the continuity state, and the style sheet.
import path from "node:path";
import { stringifyFrontmatter } from "./frontmatter.js";
import { titleCaseSlug } from "./markdown.js";
import { COUNT_UNITS, formRanges } from "./forms.js";
import { STORY_SCHEMA_VERSION } from "./scan-schema.js";

export function storyBible(options) {
  const data = {
    title: options.title,
    "schema-version": STORY_SCHEMA_VERSION
  };
  if (options.series !== undefined) {
    data.series = options.series;
  }
  if (options.inherited?.["series-title"] !== undefined) {
    data["series-title"] = options.inherited["series-title"];
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
  for (const field of ["author", "authors", "language", "count-unit"]) {
    if (options.inherited?.[field] !== undefined) {
      data[field] = options.inherited[field];
    }
  }
  if (options.form !== undefined) {
    data.form = options.form;
    // In the book's count unit: target-characters for Chinese or Japanese.
    const target = formRanges(options.unit, options.pack)?.get(options.form)?.target ?? null;
    if (target !== null) {
      data[options.unit.targetField] = target;
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

// A registry table cell: a `|` would start a new column and a newline would
// end the row, so escape the one and flatten the other. Backslashes just
// before a `|` are doubled too, or `\|` in a name would leave the pipe
// unescaped (or lose the backslash); other markdown escapes are kept. A
// block scalar's closing newline would leave a trailing space, so the cell
// is trimmed. Each run of spaces or backslashes matches only from its
// start, so a long run with no newline or `|` after it stays linear.
function cell(value) {
  return String(value ?? "").replace(/(?:(?<![ \t])[ \t]+)?(?:\r?\n|\r)[ \t]*/g, " ").trim().replace(/(?<!\\)(\\*)\|/g, "$1$1\\|");
}

export function characterIndex(storyId, characters, relationshipMap, familyTrees) {
  const rows = characters.length === 0
    ? ["| *No characters yet* | | | |"]
    : characters.map((character) => `| ${cell(character.name)} | ${cell(character.role)} | ${cell(character.status)} | [${character.id}](${character.id}.md) |`);

  return `${stringifyFrontmatter({ type: "character-registry", story: storyId })}# Characters

## Registry

| Name | Role | Status | File |
|------|------|--------|------|
${rows.join("\n")}

## Relationship Map

${relationshipMap || "*No relationships defined yet.*"}

## Family Trees

${familyTrees || "*No family trees defined yet.*"}
`;
}

export function worldIndex(storyId, locations, systems, factions, artifacts, overview) {
  const locationRows = locations.length === 0
    ? ["| *No locations yet* | | | |"]
    : locations.map((location) => `| ${cell(location.name)} | ${cell(titleCaseSlug(location.type))} | ${cell(location.region)} | [${location.id}](locations/${location.id}.md) |`);
  const systemRows = systems.length === 0
    ? ["| *No systems yet* | | |"]
    : systems.map((system) => `| ${cell(system.name)} | ${cell(titleCaseSlug(system.type))} | [${system.id}](systems/${system.id}.md) |`);
  const factionRows = factions.length === 0
    ? ["| *No factions yet* | | | |"]
    : factions.map((faction) => `| ${cell(faction.name)} | ${cell(titleCaseSlug(faction.type))} | ${cell(faction.status)} | [${faction.id}](factions/${faction.id}.md) |`);
  const artifactRows = artifacts.length === 0
    ? ["| *No artifacts yet* | | | |"]
    : artifacts.map((artifact) => `| ${cell(artifact.name)} | ${cell(titleCaseSlug(artifact.type))} | ${cell(artifact.status)} | [${artifact.id}](artifacts/${artifact.id}.md) |`);

  return `${stringifyFrontmatter({ type: "world-registry", story: storyId })}# Worldbuilding

## World Overview

${overview || "*Describe the world at a high level here.*"}

## Locations

| Name | Type | Region | File |
|------|------|--------|------|
${locationRows.join("\n")}

## Systems

| Name | Type | File |
|------|------|------|
${systemRows.join("\n")}

## Factions

| Name | Type | Status | File |
|------|------|--------|------|
${factionRows.join("\n")}

## Artifacts

| Name | Type | Status | File |
|------|------|--------|------|
${artifactRows.join("\n")}
`;
}

export function plotIndex(storyId, structure, arcs, storyStructure, themeTracking) {
  const arcRows = arcs.length === 0
    ? ["| *No arcs yet* | | | |"]
    : arcs.map((arc) => `| ${cell(arc.name)} | ${cell(arc.type)} | ${cell(arc.status)} | [${arc.id}](arcs/${arc.id}.md) |`);

  return `${stringifyFrontmatter({ type: "plot-registry", story: storyId, structure })}# Plot Structure

## Story Structure

${storyStructure || "**Model:** Three-Act Structure (adjust as needed)"}

## Arcs

| Name | Type | Status | File |
|------|------|--------|------|
${arcRows.join("\n")}

## Theme Tracking

${themeTracking || `| Theme | Arcs | Chapters |
|-------|------|----------|
| *No themes tracked yet* | | |`}
`;
}

// The chapter registry, with each chapter's length in the count unit.
export function chapterIndex(storyId, chapters, unit = COUNT_UNITS.get("words")) {
  const rows = chapters.length === 0
    ? ["| *No chapters yet* | | | | | |"]
    : chapters.map((chapter) => `| ${cell(chapter.number)} | ${cell(chapter.title)} | ${cell(chapter.pov)} | ${cell(chapter.status)} | ${cell(chapter.count)} | [${chapter.id}](${path.basename(chapter.file)}) |`);
  const total = chapters.reduce((sum, chapter) => sum + chapter.count, 0);
  const heading = `${unit.noun[0].toUpperCase()}${unit.noun.slice(1)} Count`;

  return `${stringifyFrontmatter({ type: "chapter-registry", story: storyId })}# Chapters

## Registry

| # | Title | POV | Status | ${heading} | File |
|---|-------|-----|--------|${"-".repeat(heading.length + 2)}|------|
${rows.join("\n")}

## Total ${heading}: ${total}
`;
}

export function timeline(storyId) {
  return `${stringifyFrontmatter({ type: "timeline", story: storyId })}# Story Timeline

| When | Event | Arc | Chapter |
|------|-------|-----|---------|
| *No events yet* | | | |
`;
}

export function sceneIndex(storyId, scenes) {
  const rows = scenes.length === 0
    ? ["| *No scenes yet* | | | | | |"]
    : scenes.map((scene) => `| ${cell(scene.chapter)} | ${cell(scene.scene)} | ${cell(scene.title)} | ${cell(scene.pov)} | ${cell(scene.status)} | [${scene.id}](${scene.id}.md) |`);

  return `${stringifyFrontmatter({ type: "scene-registry", story: storyId })}# Scenes

## Registry

| Chapter | Scene | Title | POV | Status | File |
|---------|-------|-------|-----|--------|------|
${rows.join("\n")}
`;
}

export function continuityState(storyId) {
  return `${stringifyFrontmatter({
    type: "continuity-state",
    story: storyId,
    "current-chapter": 0,
    "character-state": [],
    "object-state": [],
    "knowledge-state": []
  })}# Continuity State

## Current Story State

Track facts that must carry forward between chapters. The CLI reads the
\`character-state\`, \`object-state\`, and \`knowledge-state\` lists in the
frontmatter above; the tables below are optional notes it does not read.

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

export function questionIndex(storyId, questions) {
  const rows = questions.length === 0
    ? ["| *No questions yet* | | | |"]
    : questions.map((question) => `| ${cell(question.title)} | ${cell(question.status)} | ${cell(question.introduced)} | [${question.id}](${question.id}.md) |`);

  return `${stringifyFrontmatter({ type: "question-registry", story: storyId })}# Continuity Questions

## Registry

| Question | Status | Introduced | File |
|----------|--------|------------|------|
${rows.join("\n")}
`;
}

export function promiseIndex(storyId, promises) {
  const rows = promises.length === 0
    ? ["| *No promises yet* | | | |"]
    : promises.map((promise) => `| ${cell(promise.title)} | ${cell(promise.status)} | ${cell(promise.planted)} | [${promise.id}](${promise.id}.md) |`);

  return `${stringifyFrontmatter({ type: "promise-registry", story: storyId })}# Promises And Payoffs

## Registry

| Promise | Status | Planted | File |
|---------|--------|---------|------|
${rows.join("\n")}
`;
}

export function clueIndex(storyId, clues) {
  const rows = clues.length === 0
    ? ["| *No clues yet* | | | |"]
    : clues.map((clue) => `| ${cell(clue.title)} | ${cell(clue.status)} | ${cell(clue.planted)} | [${clue.id}](${clue.id}.md) |`);

  return `${stringifyFrontmatter({ type: "clue-registry", story: storyId })}# Clue Ledger

## Registry

| Clue | Status | Planted | File |
|------|--------|---------|------|
${rows.join("\n")}
`;
}

export function glossaryIndex(storyId, terms) {
  const rows = terms.length === 0
    ? ["| *No terms yet* | | |"]
    : terms.map((term) => `| ${cell(term.term)} | ${cell(term.category)} | [${term.id}](terms/${term.id}.md) |`);

  return `${stringifyFrontmatter({ type: "glossary-registry", story: storyId })}# Glossary

## Registry

| Term | Category | File |
|------|----------|------|
${rows.join("\n")}
`;
}

export function matterIndex(storyId, pages) {
  const rows = pages.length === 0
    ? ["| *No matter pages yet* | | | |"]
    : pages.map((page) => `| ${cell(page.title)} | ${cell(page.placement)} | ${cell(page.order)} | [${page.id}](${page.id}.md) |`);

  return `${stringifyFrontmatter({ type: "matter-registry", story: storyId })}# Front And Back Matter

## Registry

| Title | Placement | Order | File |
|-------|-----------|-------|------|
${rows.join("\n")}
`;
}

export function researchIndex(storyId, notes) {
  const rows = notes.length === 0
    ? ["| *No research notes yet* | | | |"]
    : notes.map((note) => `| ${cell(note.title)} | ${cell(note.status)} | ${cell(note.usedIn.join(", "))} | [${note.id}](${note.id}.md) |`);

  return `${stringifyFrontmatter({ type: "research-registry", story: storyId })}# Research

## Registry

| Title | Status | Used In | File |
|-------|--------|---------|------|
${rows.join("\n")}
`;
}

export function styleSheet() {
  return `${stringifyFrontmatter({
    type: "style-sheet",
    dialect: "unspecified",
    preferred: [],
    "watch-words": [],
    "allow-words": []
  })}# Style Sheet

The book's house decisions, kept the way a copyeditor keeps them. Read this before drafting or revising prose. \`story prose\` enforces the lists in the frontmatter: \`dialect\` (british, american, or unspecified) flags the other dialect's common spellings, each \`preferred\` entry flags its \`avoid\` form, \`watch-words\` are counted in every chapter, and \`allow-words\` silences a built-in filter word or adverb. Add a \`samples\` list of your own prose (\`../book-one\`, approved chapters) and \`story prose\` compares each chapter with it instead of fixed limits.

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

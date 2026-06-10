---
name: story-init
description: This skill should be used when the user asks to "start a new story", "initialize a story project", "create a story", "new book", "set up a story", or wants to begin a new fiction writing project from scratch.
---

# Story Initialization

## Overview

Initialize a new story project with a structured markdown folder layout. Creates the story bible, registries, scene tracking, continuity state, glossary, worldbuilding folders, plot structure, and chapter tracker - all as cross-referenced markdown files with YAML frontmatter.

## When to Use

- Starting a new story, book, or fiction project
- Setting up the folder structure for an existing story idea
- NOT for adding to an existing story project (use the domain-specific skills instead)
- NOT for converting an existing manuscript or chapter drafts: run `story import <source> --title "{Title}"` instead, then build out the bible from the entity candidates it prints

## Workflow

1. Ask for basic story information:
   - Title
   - Genre and sub-genre
   - Brief synopsis (2-3 sentences)
   - Setting era/time period
   - Key themes (2-4)
   - POV style (first-person, third-person-limited, third-person-omniscient)
   - Tense (past, present)

If the Story CLI is available, prefer using it to create the starter project, then inspect and refine the generated files as needed:

```shell
story init "{Title}" --genre "{genre}" --sub-genre "{sub-genre}" --setting-era "{era}" --pov "{pov-style}" --tense "{tense}" --synopsis "{synopsis}" --theme "{theme-1}" --theme "{theme-2}"
```

If `story` is not installed, use the bundled maintenance fallback when available, resolving the script path relative to the `story-maintenance` skill:

```shell
node ../story-maintenance/scripts/story.js init "{Title}"
```

If neither command is available, create the files manually using the steps below.

2. Create the folder structure at the current working directory:

```
{story-title-kebab}/
├── story.md
├── characters/
│   └── _index.md
├── worldbuilding/
│   ├── _index.md
│   ├── locations/
│   ├── systems/
│   ├── factions/
│   └── artifacts/
├── plot/
│   ├── _index.md
│   ├── arcs/
│   └── timeline.md
├── scenes/
│   └── _index.md
├── continuity/
│   ├── state.md
│   ├── questions/
│   │   └── _index.md
│   └── promises/
│       └── _index.md
├── glossary/
│   ├── _index.md
│   └── terms/
└── chapters/
    └── _index.md
```

3. Populate `story.md` with the story bible:

```yaml
---
title: "{Title}"
schema-version: 2
genre: {genre}
sub-genre: {sub-genre}
setting-era: {era}
status: planning
themes:
  - {theme-1}
  - {theme-2}
pov: {pov-style}
tense: {tense}
---
```

Below the frontmatter, include sections:
- **Synopsis** - the 2-3 sentence synopsis provided
- **Tone & Style** - brief notes on the story's voice (derive from genre/themes)
- **Notes** - empty section for the user to fill in

4. Populate each `_index.md` with an empty registry:

**`characters/_index.md`:**
```markdown
---
type: character-registry
story: {story-title-kebab}
---

# Characters

## Registry

| Name | Role | Status | File |
|------|------|--------|------|
| *No characters yet* | | | |

## Family Trees

*No family trees defined yet.*

## Relationship Map

*No relationships defined yet.*
```

**`worldbuilding/_index.md`:**
```markdown
---
type: world-registry
story: {story-title-kebab}
---

# Worldbuilding

## World Overview

*Describe the world at a high level here.*

## Locations

| Name | Type | Region | File |
|------|------|--------|------|
| *No locations yet* | | | |

## Systems

| Name | Type | File |
|------|------|------|
| *No systems yet* | | |
```

**`plot/_index.md`:**
```markdown
---
type: plot-registry
story: {story-title-kebab}
structure: three-act
---

# Plot Structure

## Story Structure

**Model:** Three-Act Structure (adjust as needed)

## Arcs

| Name | Type | Status | File |
|------|------|--------|------|
| *No arcs yet* | | | |

## Theme Tracking

| Theme | Arcs | Chapters |
|-------|------|----------|
| *No themes tracked yet* | | |
```

**`plot/timeline.md`:**
```markdown
---
type: timeline
story: {story-title-kebab}
---

# Story Timeline

| When | Event | Arc | Chapter |
|------|-------|-----|---------|
| *No events yet* | | | |
```

**`chapters/_index.md`:**
```markdown
---
type: chapter-registry
story: {story-title-kebab}
---

# Chapters

## Registry

| # | Title | POV | Status | Word Count | File |
|---|-------|-----|--------|------------|------|
| *No chapters yet* | | | | | |

## Total Word Count: 0
```

Also create the v2 support files:

- `scenes/_index.md` with frontmatter `type: scene-registry`
- `continuity/state.md` with frontmatter `type: continuity-state`, `current-chapter: 0`, and empty `character-state`, `object-state`, and `knowledge-state` lists
- `continuity/questions/_index.md` with frontmatter `type: question-registry`
- `continuity/promises/_index.md` with frontmatter `type: promise-registry`
- `glossary/_index.md` with frontmatter `type: glossary-registry`

If manual initialization gets tedious, stop and ask the user to install or run the Story CLI rather than inventing a different project shape.

5. Present a summary of what was created and suggest next steps:
   - "Add your first character" (triggers character-management skill)
   - "Start worldbuilding" (triggers worldbuilding skill)
   - "Define your plot structure" (triggers plot-structure skill)
   - "Run `story next .`" to show deterministic next actions

6. When CLI access is available, run a final maintenance check:

```shell
story validate {story-title-kebab}
```

If using the bundled fallback, replace `story` with `node ../story-maintenance/scripts/story.js`, resolving the path relative to this skill folder.

## Conventions

These conventions apply across ALL story skills:

- **Kebab-case filenames** for all entity files (e.g., `sera-voss.md`, `ashen-citadel.md`)
- **YAML frontmatter** on every file for structured metadata
- **Schema version** - `story.md` frontmatter includes `schema-version: 2`
- **`_index.md`** files are authoritative registries for each domain
- **`story.md`** is the top-level bible read by all skills for context
- **Bidirectional cross-links** - when referencing another entity, update both files
- **Character identifiers** use the kebab-case filename without extension (e.g., `sera-voss`)
- **Death tracking** - when a character dies on the page, set `status: deceased` and `died-in: chapter-{NN}` so `story continuity` can flag posthumous appearances
- **`mentions` vs `characters`** - chapter and scene frontmatter lists characters present in-scene under `characters`; characters who are only referenced, remembered, recorded, or seen in flashback go under `mentions`
- **Scene identifiers** use `chapter-{NN}-scene-{NN}` and live in `scenes/`
- **Continuity state** lives in `continuity/state.md`, with open questions and promises tracked under `continuity/questions/` and `continuity/promises/`
- **Markdown-first artifacts** - create and edit story content directly in the target `.md` files. Do not create project-local build scripts, generator scripts, or bulk writer scripts (for example `build-*.js`) to emit story files.
- **CLI helpers stay external** - the only JavaScript helper agents should run is the installed or bundled Story CLI (`story`, `bun run story --`, or `story-maintenance/scripts/story.js`) for deterministic maintenance. Do not copy it into the user's story project, and remove any unavoidable scratch helper before finishing.

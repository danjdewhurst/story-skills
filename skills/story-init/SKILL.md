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
- NOT for a sequel, prequel, or companion to an existing book: use `series-continuity`, which links the projects and carries canon across
- NOT for finding the idea itself: when the user has only a vague notion ("something about lighthouses"), several competing ideas, or no premise yet, run the `premise-workshop` skill first, then return here with the chosen premise, form, and genre
- NOT for converting an existing manuscript or chapter drafts: run `story import <source> --title "{Title}"` instead, then build out the bible from the entity candidates it prints

## Workflow

1. Ask for basic story information (if a `premise-workshop` session produced a premise, logline, genre, and form, reuse them rather than asking again):
   - Title
   - Form: `novel`, `novella`, `novelette`, `short-story`, `flash`, `serial`, `picture-book`, or `chapter-book`. Without `--form`, `story init` writes no `form` and no `target-words`, so if the user doesn't choose, pass `--form novel`
   - Genre and sub-genre
   - Brief synopsis (2-3 sentences)
   - Setting era/time period
   - Key themes (2-4)
   - POV style (first-person, third-person-limited, third-person-omniscient)
   - Tense (past, present, future, mixed)

If the Story CLI is available, prefer using it to create the starter project, then inspect and refine the generated files as needed:

```shell
story init "{Title}" --form "{form}" --genre "{genre}" --sub-genre "{sub-genre}" --setting-era "{era}" --pov "{pov-style}" --tense "{tense}" --synopsis "{synopsis}" --theme "{theme-1}" --theme "{theme-2}"
```

`--form` records `form` in `story.md` and, when no target is given, sets a default `target-words` for the form (novel 80,000, novella 30,000, novelette 12,000, short story 5,000, flash 1,000, chapter book 10,000, picture book 500; serials get no book-level default). `story validate` then warns when `target-words` is outside the form's usual range. For short forms, point the user to `references/short-story-form.md` in the `plot-structure` skill.

Publishing metadata (`isbn`, `publisher`, `publication-date`, `description`, `keywords`, `subjects`, `copyright`, `cover-alt`, `ai-disclosure`, `language`) is optional and can wait until the book is ready to publish; the `publishing` skill fills it in. Do not ask for it at init.

The title must contain ASCII letters or digits, because the story id recorded in every registry is derived from it (`--dir` sets only the directory). `init` refuses an existing directory unless you pass `--force`; with `--force` it only creates missing starter files and never overwrites an existing `story.md`, registry, timeline, or `continuity/state.md`.

If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder:

```shell
node ../story-maintenance/scripts/story.js init "{Title}"
```

If neither command is available, create the files manually using the steps below.

2. Create the folder structure at the current working directory:

```
{story-title-kebab}/
├── story.md
├── style-sheet.md
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
│   ├── promises/
│   │   └── _index.md
│   └── clues/
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
form: {form}
themes:
  - {theme-1}
  - {theme-2}
premise: "{One-sentence controlling idea: value + cause, e.g. justice triumphs because the hero outsmarts the system}"
counter-premise: "{The antagonist's embodied argument}"
pov: {pov-style}
tense: {tense}
---
```

Below the frontmatter, include sections:
- **Synopsis** - the 2-3 sentence synopsis provided
- **Tone & Style** - brief notes on the story's voice (derive from genre/themes)
- **Notes** - empty section for the user to fill in

4. Draft a working premise:

Fill in the `premise:` and `counter-premise:` fields as hypotheses, not commitments. The premise is a one-sentence controlling idea — value + cause, e.g. "justice triumphs because the hero outsmarts the system". The counter-premise is the antagonist's embodied argument: the story's opposing value, stated as the antagonist would believe it. Draft both early, alongside the synopsis, but do not force theme — a working premise is a guess to be audited, not a conclusion to be imposed. Revisit it during revision: the `revision-continuity` theme audit pass (see the `theme-craft` skill for the deep pass) checks whether the ending actually dramatizes the premise through consequence. If the draft argues a different premise, update the premise, not the draft.

5. Populate each `_index.md` with an empty registry:

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

## Relationship Map

*No relationships defined yet.*

## Family Trees

*No family trees defined yet.*
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

## Factions

| Name | Type | Status | File |
|------|------|--------|------|
| *No factions yet* | | | |

## Artifacts

| Name | Type | Status | File |
|------|------|--------|------|
| *No artifacts yet* | | | |
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

Also create the v2 support files. Every registry and `continuity/state.md` needs `story: {story-title-kebab}` in addition to its `type`, or `story validate` reports a missing `story` field:

- `scenes/_index.md` with frontmatter `type: scene-registry` and `story: {story-title-kebab}`
- `continuity/state.md` with frontmatter `type: continuity-state`, `story: {story-title-kebab}`, `current-chapter: 0`, and empty `character-state`, `object-state`, and `knowledge-state` lists
- `continuity/questions/_index.md` with frontmatter `type: question-registry` and `story: {story-title-kebab}`
- `continuity/promises/_index.md` with frontmatter `type: promise-registry` and `story: {story-title-kebab}`
- `continuity/clues/_index.md` with frontmatter `type: clue-registry` and `story: {story-title-kebab}`
- `glossary/_index.md` with frontmatter `type: glossary-registry` and `story: {story-title-kebab}`
- `style-sheet.md` (optional) with frontmatter `type: style-sheet`, `dialect: unspecified`, and empty `preferred`, `watch-words`, and `allow-words` lists, plus the body sections described in the `voice-style` skill

If manual initialization gets tedious, stop and ask the user to install or run the Story CLI rather than inventing a different project shape.

6. Present a summary of what was created and suggest next steps:
   - "Workshop the premise" (triggers premise-workshop skill) if the premise is still a guess
   - "Add your first character" (triggers character-management skill)
   - "Start worldbuilding" (triggers worldbuilding skill)
   - "Define your plot structure" (triggers plot-structure skill)
   - "Set up the style sheet" (triggers voice-style skill) once there is a writing sample
   - "Run `story next .`" to show deterministic next actions

7. When CLI access is available, run a final maintenance check:

```shell
story validate {story-title-kebab}
```

If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder.

## Reference Files

- **`references/title-logline.md`** - Title craft (comps, hook phrasing, title as promise) and the logline recipe

## Conventions

These conventions apply across ALL story skills:

- **Kebab-case filenames** for all entity files (e.g., `sera-voss.md`, `ashen-citadel.md`)
- **YAML frontmatter** on every file for structured metadata
- **Schema version** - `story.md` frontmatter includes `schema-version: 2`
- **`_index.md`** files are authoritative registries for each domain
- **`story.md`** is the top-level bible read by all skills for context
- **`style-sheet.md`** records voice and house style; skills that write or revise prose read it
- **Bidirectional cross-links** - when referencing another entity, update both files
- **Character identifiers** use the kebab-case filename without extension (e.g., `sera-voss`)
- **Death tracking** - when a character dies on the page, set `status: deceased` and `died-in: chapter-{NN}` so `story continuity` can flag posthumous appearances
- **`mentions` vs `characters`** - chapter and scene frontmatter lists characters present in-scene under `characters`; characters who are only referenced, remembered, recorded, or seen in flashback go under `mentions`
- **Scene identifiers** use `chapter-{NN}-scene-{NN}` and live in `scenes/`
- **Continuity state** lives in `continuity/state.md`, with open questions, promises, and clues tracked under `continuity/questions/`, `continuity/promises/`, and `continuity/clues/`
- **Markdown-first artifacts** - create and edit story content directly in the target `.md` files. Do not create project-local build scripts, generator scripts, or bulk writer scripts (for example `build-*.js`) to emit story files.
- **CLI helpers stay external** - the only JavaScript helper agents should run is the installed or bundled Story CLI (`story`, `bun run story --`, or `story-maintenance/scripts/story.js`) for deterministic maintenance. Do not copy it into the user's story project, and remove any unavoidable scratch helper before finishing.

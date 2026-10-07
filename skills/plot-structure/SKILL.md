---
name: plot-structure
description: This skill should be used when the user asks to "create a plot arc", "story structure", "add a plot point", "story timeline", "track foreshadowing", "pacing", "sagging middle", "act structure", "story arc", "plot outline", "snowflake method", or wants to plan and manage the narrative structure of a story. It owns book-level pacing; NOT for scene outcomes or writing a chapter hook (use scene-craft), or a pacing check as a revision pass (use revision-continuity).
---

# Plot Structure

## Overview

Plan and manage story arcs, plot points, foreshadowing, and narrative timeline. Each arc is a markdown file in `plot/arcs/` with a chronological timeline maintained in `plot/timeline.md`. The plot index tracks all arcs, their status, and theme coverage.

## Prerequisites

A story project must already exist (created via the story-init skill). Verify by checking for `story.md` in the project root.

## Choosing a Story Structure

1. Read `story.md` for genre, themes, and `form` (`novel`, `novella`, `novelette`, `short-story`, `flash`, `serial`, `picture-book`, `chapter-book`). For `short-story` and `flash`, use `references/short-story-form.md` instead of a multi-act beat sheet
2. Consult `references/structure-models.md` for available structures
3. Recommend a structure based on genre (default to three-act if unclear). If the user wants to design the whole book top-down before drafting, or asks for the Snowflake Method, follow `references/snowflake.md` on top of the chosen structure
4. Update `plot/_index.md` frontmatter `structure` field
5. Populate the story structure section with the beat sheet
6. When CLI access is available, run `story reindex .`, `story wordcount . --write`, and `story check .`

## Creating an Arc

1. Read `story.md` for themes
2. Read `plot/_index.md` for existing arcs
3. Read `characters/_index.md` to understand available characters
4. Ask for:
   - Arc name
   - Type (main, subplot, character, thematic)
   - Which characters are involved
   - Which themes it serves
   - Which MICE threads the arc carries (optional `mice-threads:` frontmatter, written as a block list with one `- event` or `- character` item per line, or as a `[event, character]` flow list; see `references/mice-quotient.md`)
5. Build the arc through conversation: setup, escalations, climax, resolution
6. Write the file using `references/arc-template.md` (or scaffold it with `story add arc '{Name}' --type main --character {id} --theme {theme}`, then fill in the sections)
7. Save to `plot/arcs/{arc-name-kebab}.md`
8. Update `plot/_index.md` arcs table
9. Update theme tracking in `plot/_index.md`
10. If characters are referenced, verify they exist in `characters/`
11. When CLI access is available, run `story reindex .`, `story wordcount . --write`, and `story check .`

## Managing Plot Points

Plot points live within arc files in the "Plot Points" table. When adding a plot point:

1. Read the relevant arc file
2. Add the plot point to the table with chapter reference (if known)
3. Add the event to `plot/timeline.md` in chronological order
4. If the plot point involves foreshadowing, add it to the arc's foreshadowing table
5. If the plot point creates a reader promise or mystery, create or update a record in `continuity/promises/` or `continuity/questions/`
6. When CLI access is available, run `story reindex .`, `story wordcount . --write`, and `story check .`

## Timeline Management

The timeline at `plot/timeline.md` is a chronological master list of all story events across all arcs.

When adding events:
- Insert in chronological order
- Keep entries concise (one line per event)
- Use the `| When | Event | Arc | Chapter |` table with these cell formats:
  - **When:** story-relative time for story events (e.g. `Day 1, morning`), or how long ago for backstory (e.g. `12 years ago`, `~300 years ago`)
  - **Event:** one concise line describing what happened
  - **Arc:** the arc's display name as written in its file (e.g. `The Drowned Witness`), or `-` when the event belongs to no arc. `story rename arc` rewrites ids but not display names, and nothing checks this cell, so after renaming an arc search for the old name (`grep -rn "Old Name" .`) and update each hit by hand, including the timeline rows
  - **Chapter:** `Ch {N}` once the event is written (e.g. `Ch 1`), or `-` for backstory and unwritten events

When reviewing the timeline:
- Run `story timeline .` to see written scenes in story-time order from their `date`/`time` fields, with scenes told out of order marked, and compare it with `plot/timeline.md`
- Run `story diagram timeline` for a Mermaid timeline of dated scenes and chapters, and `story diagram arcs` for which chapters advance each arc (add `--out dist/<name>.mmd` to save either; keep generated diagrams out of entity folders)
- Run `story grid .` for the plot grid: arcs as rows, chapters as columns, an `x` where a chapter or its scenes list the arc in `arcs-advanced`, plus each chapter's hook and scene outcomes. Use `--format csv` for a spreadsheet and `--from`/`--to` for a range of chapters. An empty row is an arc no chapter advances, a long gap is an arc the reader may forget, and an `(unknown)` row is an `arcs-advanced` id with no arc file
- Check for chronological consistency
- Identify pacing issues (too many events clustered, long gaps)
- Flag arcs that haven't progressed

## Pacing, Outcomes, and Hooks

Two optional fields make pacing checkable:

- Scene `outcome`: `yes`, `no`, `yes-but`, or `no-and` — whether the POV character got what they wanted in the scene. `yes-but` and `no-and` are the complicating outcomes that drive a plot forward (see the `scene-craft` skill).
- Chapter `hook`: how the chapter ends — `cliffhanger`, `question`, `revelation`, `reversal`, `decision`, `emotional`, or `resolution`.

Plan both in the outline, then run `story pacing .` for a per-chapter dashboard of words, scene and sequel counts, scene outcomes, and hooks. It warns about three or more consecutive `yes` outcomes (no pressure), four or more scene units with no sequel (no breath), chapter length outliers (over twice or under half the median once three chapters have prose), three or more consecutive chapters ending on `resolution`, and drafted chapters with no `hook`. Treat the warnings as prompts to reread, not rules: a quiet `resolution` chapter after the climax is right.

## Foreshadowing Tracking

Each arc tracks its own foreshadowing in the "Foreshadowing" table:
- **Planted:** What hint or setup is placed
- **Payoff:** What the payoff will be
- **Chapter Planted / Chapter Payoff:** Where each occurs
- **Status:** `planned`, `planted`, or `paid-off`

During chapter writing, flag any `planted` items that haven't been paid off as reminders.

For mystery clues, `story clues .` prints a clue-by-chapter fair-play matrix and `story diagram clues` the plant-to-reveal flow (see the `genre-craft` skill).

For durable cross-arc setup/payoff tracking, also maintain `continuity/promises/{promise-kebab}.md` with `status`, `planted`, `payoff`, `arcs`, and `characters`. For mystery or open-continuity tracking, maintain `continuity/questions/{question-kebab}.md`.

Scaffold chapters and scenes with `story add chapter '{Title}' --number {N} --pov {id} --arc {arc-id}` and `story add scene '{Title}' --chapter chapter-{NN} --scene {M} --pov {id} --location {id}`, then write the prose and outline content into the created files. Set `outcome` on scene records and `hook` on chapters as the outline settles them, then run `story reindex .`, `story wordcount . --write`, and `story check .`, then `story pacing .`.

When pacing or the outline calls for reordering, move the files with the CLI rather than renaming them, because chapter and scene ids encode their numbers and clues, promises, questions, and the timeline point at them:

- Move a scene to another chapter with `story move scene chapter-{NN}-scene-{MM} --chapter chapter-{NN} --path .` (next free number; add `--scene {M}` to place it), or reorder within its chapter with `--scene {M}` alone
- Renumber a chapter with `story move chapter chapter-{NN} --number {N} --path .`. A taken number is refused, so to open a gap move the later chapters up one, highest first, then `story add chapter '{Title}' --number {N}`
- `move` rewrites ids, links, and bare ids in `plot/timeline.md`, arc files, and the `plot/_index.md` Theme Tracking table, but not `Ch {N}` cells, prose, or outline beats: update those by hand, then run `story reindex .`, `story wordcount . --write`, and `story check .`, then `story pacing .`

For splits, merges, and the full checklist, follow the `revision-continuity` skill's Structural Edits section.

## Cross-Referencing

- Arcs reference characters via frontmatter `characters` field
- Arcs reference themes via frontmatter `themes` field
- Plot points reference chapters
- Timeline entries link arcs and chapters
- Theme tracking in `plot/_index.md` maps themes to arcs and chapters
- Promises and questions reference chapters, arcs, and characters where relevant

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments. Use `node <checkout>/bin/story.js` instead only when the user names a Story Skills repository checkout or you are working in one. Write the script as an absolute path (resolve the fallback relative to this skill folder) and run it from the folder you would run `story` from, so `.` and other relative paths keep their meaning. Use Node, not Bun or a package script: Bun would load that folder's `bunfig.toml` (which can run code) and `.env`, and a package script runs from the checkout's root. If no CLI is available, perform the registry, backlink, and word-count checks manually.

## Reference Files

- **`references/arc-template.md`** - Template for arc files with frontmatter and sections
- **`references/question-template.md`** - Template for continuity questions and mysteries
- **`references/promise-template.md`** - Template for setup/payoff tracking
- **`references/structure-models.md`** - Story structure models (three-act, hero's journey, save the cat, kishotenketsu, five-act, Fichtean curve, Harmon's story circle) with beat sheets
- **`references/mice-quotient.md`** - MICE threading: milieu/inquiry/character/event threads, start/end rules, and the optional `mice-threads:` arc frontmatter
- **`references/short-story-form.md`** - Short fiction form: one dominant change, single effect, narrow scope, and the `form` field (`story init --form short-story` or `flash`)
- **`references/outlining-ladder.md`** - Premise → beat sheet → step outline → full outline, with exit criteria per rung (cross-links discovery-drafting)
- **`references/snowflake.md`** - Snowflake Method: ten top-down design steps from one-sentence summary to first draft, each mapped to `story.md`, character, arc, and scene files and the CLI commands that scaffold them

## Shared Conventions

Every story skill follows the shared conventions in [`../story-maintenance/references/conventions.md`](../story-maintenance/references/conventions.md), resolved relative to this skill folder. Read it before creating, renaming, or linking story files. If that file is missing because this skill was installed without `story-maintenance`, the essentials are: kebab-case ids and filenames, YAML frontmatter on every story-project file, `_index.md` files as the authoritative registries, bidirectional links between entities, `characters` for who is on the page and `mentions` for who is only referred to, `status: deceased` plus `died-in: chapter-{NN}` for deaths, and no project-local generator or build scripts (run only the installed or bundled Story CLI).

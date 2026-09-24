---
name: scene-craft
description: This skill should be used when the user asks to "plan a scene", "scene structure", "sequel scene", "dialogue subtext", "deep POV", "psychic distance", "try fail", "scene cards", "exposition", "info dump", "flashback", "time skip", "story opening", "first page hook", "introduce a character", "scene outcome", "yes-but no-and", "chapter hook", or wants scene-level craft for drafting or revision. NOT for book-level pacing or act structure (use plot-structure).
---

# Scene Craft

## Overview

Plan and check scenes at the scene grain — the layer between plot beats and
chapter prose. Covers the missing half of the chapter-writing scene model
(Scene **and** Sequel), try/fail escalation, scene cards, dialogue subtext,
deep POV and psychic distance, exposition handling, flashbacks and time
skips, and openings. Use during chapter planning, before drafting, and in
revision when a scene feels flat.

## Prerequisites

A story project must already exist (created via the story-init skill), with
characters defined (character-management) and a plot structure in place
(plot-structure). This skill extends chapter-writing; it does not replace the
outline-first drafting workflow.

## Workflow

1. **Choose the craft layer.** Identify which scene-grain problem this is:
   - Scene feels like incidents with no breathing room → `references/scene-sequel.md`
   - Middle of the chapter sags or resolves too easily → `references/try-fail.md`
   - Chapter has multiple POVs/timelines to order → `references/scene-cards.md`
   - Conversation reads flat or voices blur → `references/dialogue-subtext.md`
   - Narration feels distant or head-hops → `references/deep-pov.md`
   - Worldbuilding facts are piling up undelivered → `references/exposition.md`
   - Past events or a time jump are needed → `references/flashbacks-time.md`
   - Starting the book or a chapter, or introducing a character → `references/openings.md`
2. **Read the relevant reference(s).** Each file carries its own checklists
   and planning fields; apply them, don't paraphrase them.
3. **Clarify missing inputs before planning or editing.** Ask the user for
   any required inputs you cannot establish from the project files — scene
   purpose, viewpoint, location, canon-changing intent, and the applicable
   craft layer. Never guess at these or proceed on assumptions; a wrong
   guess edits canon. Only continue to step 4 once every required input
   is known.
4. **Plan before prose.** For the scene in question, write the planning
   inputs the reference requires (sequel beats, try/fail positions, subtext
   wants, zoom level, exposition audit, flashback trigger, hook check) into
   the chapter outline or the scene's planning notes before drafting or
   revising.
5. **Record machine-readable state.** Update the scene file in `scenes/`:
   - Set `outcome:` to how the scene's goal resolves for the POV
     character: `yes`, `no`, `yes-but`, or `no-and` (see
     `references/try-fail.md`). Prefer the complicating `yes-but` and
     `no-and`; a run of clean `yes` outcomes drains tension
   - Set `sequel: true/false` and fill the `dilemma:` field plus the
     `## Sequel` section (reaction/dilemma/decision) for scenes with
     sequel content (see `references/scene-sequel.md`)
    - Add `flashback-to:` (freeform note of the flashed-back moment,
      validated as a scalar by `story validate` but not used by continuity
      checks) and move flashback-only characters to `mentions`
      (see `references/flashbacks-time.md`)
   - Keep `state-changes` current for every change the scene makes
   - When the scene ends its chapter, set the chapter's `hook:` to how the
     chapter ends: `cliffhanger`, `question`, `revelation`, `reversal`,
     `decision`, `emotional`, or `resolution` (see `references/openings.md`
     for the first-page counterpart)
6. **Run the reference's checklist** against the draft or the revision plan
   (try/fail checklist, deep-POV filter-word scan, tag-swap test, first-page
   hook check). Run `story pacing .` to see scene outcomes, sequel counts,
   and chapter hooks across the book: it warns after three or more
   consecutive `yes` outcomes, four or more scene units without a sequel,
   and three or more chapters in a row ending on `resolution`.
7. **Hand off cleanly.** Scene/sequel planning feeds the chapter-writing
   drafting workflow; theme-audit findings feed revision-continuity. When a
   scene decision changes canon (new knowledge, moved objects, changed
   relationships), update `continuity/state.md` and the affected entity
   files (bidirectional links, per the story-init conventions).

## Conventions

- Scene ids stay `chapter-{NN}-scene-{NN}`; scene files live in `scenes/`
  with kebab-case filenames.
- All planning metadata (dilemma, decision, subtext wants, psychic-distance
  level) lives in frontmatter or a `## Planning` / `## Scene Card` section
  of the scene file — never only in chat.
- `characters` vs `mentions` follows the story-init rule: characters present
  in-scene under `characters`; remembered, recorded, or flashback-only
  characters under `mentions`.
- Do not overwrite chapter prose merely to satisfy a craft checklist. Flag
  intentional deviations (e.g. a deliberate info dump as a stylistic device)
  in the scene file's planning notes so a later audit doesn't "fix" them.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder. If no CLI is available, perform the registry, backlink, and word-count checks manually.

After adding or revising scene records:

```shell
story reindex .
story links .
story validate .
story continuity .
story pacing .
```

## Reference Files

- **`references/scene-sequel.md`** - Sequel mechanics: reaction → dilemma → decision (Dwight Swain's scene framework)
- **`references/try-fail.md`** - Try/fail escalation cycles, scene `outcome` values (yes/no/yes-but/no-and), and the Five Commandments scene shape
- **`references/scene-cards.md`** - Scene card unit (start state → change → end state), reordering, POV braiding
- **`references/dialogue-subtext.md`** - Subtext as planning input, dialogue-as-negotiation, voice differentiation, tag-swap test
- **`references/deep-pov.md`** - Psychic distance zoom levels and checkable deep-POV rules
- **`references/exposition.md`** - Drip-feed, conflict-carried exposition, in-world documents, info-dump warning
- **`references/flashbacks-time.md`** - Flashback entry/exit mechanics, tension-cheat warning, time-skip conventions
- **`references/openings.md`** - In medias res, "enter late, leave early", first-page hook check, character introduction technique

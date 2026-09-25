---
name: revision-continuity
description: This skill should be used when the user asks to revise a chapter, continuity check, find inconsistencies, audit character state, check timeline consistency, developmental edit, structural revision, "revision passes", "what pass next", "pacing check" as a revision pass, "clue check", or prepare existing story material for the next revision pass. NOT for planning book structure (use plot-structure), scene-level craft (use scene-craft), or voice consistency (use voice-style).
---

# Revision Continuity

## Overview

Revise existing Story Skills projects without losing continuity. Use this skill for targeted chapter edits, continuity audits, developmental revision, line edits, and pre-flight checks before drafting the next chapter.

## Prerequisites

A story project must already exist. Verify by checking for `story.md` in the project root, then run or inspect `story report .` when CLI access is available.

## Named Revision Passes

Track a full revision as a ladder of named passes in `story.md`
`revision-passes`, so the work happens in order (big structural changes
before polishing sentences that may be cut) and survives between sessions:

```shell
story passes . --init            # writes the default ladder, keeping existing entries
story passes .                   # checklist with the checks each pass runs
story passes . --start pacing    # mark a pass in-progress
story passes . --done pacing     # mark it done
story next .                     # with story status revising, recommends the next unfinished pass
```

The default ladder is `structure`, `character`, `theme`, `continuity`,
`pacing`, `line`, `copyedit`, `proof`. Each entry is `{pass, status}` with
status `pending`, `in-progress`, or `done`; add a custom kebab-case pass
(`fact-check`, `sensitivity`) with `story passes . --start <name>`, which
appends it as `in-progress`. The checks per pass, as `story passes .`
prints them:

| Pass | Checks | Workflow below |
|------|--------|----------------|
| `structure` | `story timeline .`, `story pacing .`, `story diagram arcs` | Reverse outline, pacing waveform, removability audit |
| `character` | `story voices .`, `story knowledge <id> --at <chapter>`, `story diagram relationships` | Developmental revision (motivation, arcs) |
| `theme` | `story report .` | Theme audit |
| `continuity` | `story continuity .`, `story clues .`, `story links .` | Continuity audit, reveal economy, fact check |
| `pacing` | `story pacing .` | Pacing waveform |
| `line` | `story prose .`, `story voices .` | Line edit (the `line-editing` skill) |
| `copyedit` | `story prose .` + `style-sheet.md` | Copyedit (the `line-editing` skill) |
| `proof` | `story build --format print`, `story build --format html` | Proof (the `line-editing` skill) |

Mark a pass `--start` when beginning it and `--done` only when its checks
are clean or every remaining finding is a recorded decision. Set story
`status: revising` so `story next .` points at the next pass.

## Revision Workflow

1. Clarify the pass type unless the user already specified it:
   - **Continuity audit** - find contradictions, stale references, timeline problems, missing backlinks, or word-count drift
   - **Developmental revision** - improve structure, scene purpose, character motivation, pacing, stakes, and arc progression
   - **Reverse outline** - extract what each chapter actually does in one line per chapter, without looking at the outline or arc files, then diff that against what the plot files say it should do. Reorder, merge, split, or cut where they disagree. Read: every chapter in `chapters/`, `plot/timeline.md`, active arc files. Update: `plot/timeline.md`, arc plot-point tables, `chapters/_index.md` when chapters move, merge, or split.
   - **Theme audit** - check whether the ending engages the opening's value-question and whether the theme is dramatized through consequence rather than commentary. Verify every motif introduced early is paid off by the end. Read: `story.md` premise and themes, the opening and closing chapters, theme-tracked arcs in `plot/_index.md`. Update: `story.md` premise if the draft argues a different idea, arc `themes` tags. See the `theme-craft` skill for the deep pass.
   - **Pacing waveform** - map tension per chapter to find dead zones: chapters that neither raise nor vary the tension level. Two peaks back-to-back dilute each other; a flat middle means escalation is missing. Run `story pacing .` for the per-chapter dashboard (words, scene and sequel counts, scene `outcome`s, chapter `hook`) and its warnings: three or more consecutive `yes` outcomes (no pressure), four or more scene units without a sequel (no breath), chapter length outliers, three or more chapters in a row ending on `resolution`, and drafted chapters with no `hook`. Run `story timeline .` for POV balance and characters who vanish for long stretches. Read: the chapters, `scenes/` state-changes, arc climax points. Update: chapter or scene order, or add escalation where the map goes flat.
   - **Reveal economy** - check that every reveal is earned by planted setup and that reveals are spaced rather than dumped in clusters. Unplanted twists and reveal dumps both read as cheap. Run `story clues .` for the clue-by-chapter matrix and its fair-play warnings (late plants, unplanted payoffs, clues nobody can notice, undebunked red herrings); `story diagram clues` draws the plant-to-reveal flow. Read: `continuity/promises/`, arc foreshadowing tables, `knowledge-state` in `continuity/state.md`. Update: promise/question `status` and chapter fields, foreshadowing rows.
   - **Removability audit (darling-killing)** - find scenes whose removal would change nothing downstream: no state changes, no causality, no payoff. Wire such scenes in (give them consequence), fold them into an adjacent scene, or cut them — then record the decision so nobody re-litigates it. Read: `scenes/` state-changes, `continuity/state.md`, `continuity/promises/`. Update: scene `state-changes`, promise/question status, `plot/timeline.md`.
   - **Voice differentiation** - check that each speaker sounds like themselves. Run `story voices .` for per-character dialogue fingerprints: it warns when two characters' fingerprints are near-identical, when a character says a word from their `voice-avoid` list, and when a `voice-words` entry never appears. Update: dialogue in chapters, or the character's `voice-words`/`voice-avoid` when the draft has found a better voice.
   - **Line edit** - improve clarity, voice, rhythm, dialogue, and sensory specificity without changing plot facts. Read `style-sheet.md` for the recorded voice, and use `story prose .` to find filter words, adverb clusters, said-bookisms, echoes, uniform rhythm, and repeated phrases worth rereading. For a full prose-quality pass, follow the `line-editing` skill
   - **Copyedit** - distinct from proof/polish: enforce a style baseline (hyphenation, capitalization, naming, numbers) and continuity of surface detail (hair color, room layouts, name spellings). This pass is mechanical consistency, not prose quality — prose quality belongs to the line edit. Read: `style-sheet.md` (create it with the `voice-style` skill if missing), `glossary/`, character and location files. Run `story prose .` and fix every avoided spelling it reports. Update: chapters, `style-sheet.md` when a new convention is settled, `glossary/`, character files where details drifted. The `line-editing` skill has the full copyedit procedure.
   - **Fact check** - verify real-world details the chapter relies on. Read: `research/` notes whose `used-in` lists the chapter. Update: research notes and their status, and the chapter where it contradicts verified findings. See the `research` skill
   - **Proof/polish** - fix small wording, grammar, repetition, and formatting issues. Proof a built copy, not the source: `story build . --format print` or `--format html`. See the `line-editing` skill
2. Snapshot the draft before any multi-chapter pass (see Draft Snapshots below), so the pass can be compared and undone.
3. Read the relevant context:
   - `story.md`
   - `chapters/_index.md`
   - The target chapter(s)
   - Previous and next chapters when present
   - Relevant character, location, system, and arc files referenced by the chapter frontmatter
   - Matching scene files in `scenes/`
   - `continuity/state.md`, open questions, and promises/payoffs
   - `plot/timeline.md` and active arc files for continuity-sensitive edits
4. Create a concise revision plan:
   - What will change
   - What must stay fixed for continuity
   - Which files may need updates beyond the chapter
5. Make targeted edits directly in markdown files. Do not create project-local scripts to rewrite prose.
6. Update dependent metadata:
   - Chapter frontmatter `status` (`draft` -> `revised`, `revised` -> `final` only when appropriate)
   - Chapter `word-count` via CLI when available
   - `plot/timeline.md` if events changed
   - `scenes/` records if POV, location, participants, or state changes moved
   - `continuity/state.md`, `continuity/questions/`, or `continuity/promises/` when knowledge, object ownership, mystery state, or payoffs changed
   - Arc plot points or foreshadowing status if the revision changes setup/payoff
   - Character or location files when state, relationship, or location references changed
7. Run maintenance:

```shell
story wordcount . --write
story reindex .
story links .
story validate .
story continuity .
story doctor .
```

For structural or reveal passes, also run `story pacing .` and `story clues .`; after dialogue changes, `story voices .`. When working through named passes, finish with `story passes . --done <pass>`.

If `story.md` links other books through `follows` or `precedes`, also run `story series .` so the revision does not break canon shared with sequels or prequels. See the `series-continuity` skill.

`story continuity` deterministically checks death ordering (`died-in` vs later appearances, and characters `deceased` with no `died-in` listed in any cast), promise/question chapter ordering, unfired setups, POV/cast consistency, and `continuity/state.md` references. For intentional flashbacks, memories, or recordings of dead characters, list them under chapter or scene `mentions` instead of `characters`.

If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder.

## Draft Snapshots

Take a snapshot before a revision pass that touches more than one chapter, and name it after the draft it preserves (`draft-1`, `pre-beta-edit`).

- **Git projects:** check `git status`. Ask the user before committing anything; with approval, commit the current state and tag it: `git add -A && git commit -m "Draft 1 before developmental pass" && git tag draft-1`. Never push, rewrite history, or delete tags without explicit approval.
- **Projects without git:** offer to run `git init` first. If the user declines, copy the whole project folder beside it (`../the-tide-room-draft-1`), never into the project, where `story` commands would scan the copy.

After the pass, compare with the snapshot and report the result:

```shell
story compare . --ref draft-1
story compare . --against ../the-tide-room-draft-1
```

`story compare` lists each chapter's word change, added and removed chapters, and the share of paragraphs left unchanged, so the user can see how deep the pass went. Chapters are matched by id, so after a renumber the same id holds different prose, and a chapter whose prose did not change can read as rewritten. In that case, compare the moved chapters by content (read the old and new text side by side) rather than trusting the per-chapter figures. It only reads git; it never commits or tags.

## Structural Edits

Chapter ids come from `number` (`chapter-07`), and scene ids embed the chapter id (`chapter-07-scene-02`), so moving a scene or renumbering a chapter changes ids. Use `story move`, never a hand rename: it renames the chapter and its scene files, updates `number`, the `# Chapter N:` heading, and scene `chapter`/`scene` fields, and rewrites every reference to the old id (clue and promise `planted`/`payoff`, question `introduced`/`resolved`, research `used-in`, `died-in`, `continuity/state.md` including `current-chapter`, links, and bare ids in `plot/timeline.md` and arc files).

1. Snapshot the draft first (see Draft Snapshots above)
2. Make the change:
   - **Insert a chapter:** move each later chapter up one, highest first, because `move` refuses a number that is taken: `story move chapter chapter-09 --number 10 --path .`, then `story move chapter chapter-08 --number 9 --path .`, and so on down to the gap. Then `story add chapter "<Title>" --number 8 --path .`
   - **Move a scene:** `story move scene chapter-03-scene-02 --chapter chapter-05 --path .` puts it at the next free number in chapter 5. Add `--scene <n>` to choose the position, or use `--scene` alone to reorder within its chapter. It adds the scene's location and characters to the new chapter; trim the old chapter's `locations` and `characters` by hand if the scene was the only reason for an entry
   - **Split a chapter:** add the new chapter (making room first as above), move the scenes that belong to it with `story move scene`, then move their prose between the chapter files by hand
   - **Merge chapters:** move the scenes into the chapter you keep with `story move scene`, then move the prose by hand. Remove the emptied chapter with `story remove chapter <id> --path .` only after checking that no clue, promise, or question still points at it (`grep -rn "chapter-NN" continuity/`): `remove` clears those references and walks statuses back instead of pointing them at the kept chapter, so repoint them to the kept chapter first. Close any numbering gap left behind with `story move chapter`, lowest first
3. `move` never edits prose. Reread for chapter numbers mentioned in the text ("back in Chapter 2") and for outline beats in the chapter bodies that no longer match
4. Run maintenance, then fix what it reports:

```shell
story reindex .
story wordcount . --write
story validate .
story links .
story continuity .
```

`grep -rn "chapter-NN" .` finds references to an old id that the checks do not cover, such as ids in prose notes.

## Continuity Audit Checklist

Run `story continuity .` first to collect the deterministic findings, then check for what the CLI cannot judge:

- Character knowledge: no one acts on information they have not learned
- Character state: injuries, emotions, alliances, location, and status carry forward
- Timeline: time of day, travel time, sequence, and cause/effect stay coherent. `story timeline .` shows dated scenes in story order and marks flashbacks; check each marked scene is meant to be one. `story diagram timeline` prints the same order as a Mermaid timeline. `story continuity .` errors when a character moves between locations joined by `routes` faster than the route's `hours` allow
- Plot arcs: each changed scene still advances or intentionally pauses an arc
- Foreshadowing: planted and paid-off items match arc files; `story clues .` shows every clue's plant and payoff chapter
- Promises/questions: durable continuity records match what the chapter now reveals or withholds
- Scene state: every chapter scene has machine-readable POV, location, participants, arcs, and state-change notes
- World rules: magic, technology, politics, and geography stay consistent with worldbuilding files
- References: chapter frontmatter lists every major character, location, and arc advanced in the prose. A chapter with no references is fine by design (a quiet two-hander advances nothing on paper) — only flag missing references, never empty ones.
- Registries: indexes, word counts, and links are current after edits

## Reporting

When the user asks for an audit rather than direct edits, return findings ordered by severity with file references and concrete fixes. When the user asks for revision, summarize the edited files, changed continuity facts, and maintenance results.

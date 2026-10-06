---
name: chapter-writing
description: This skill should be used when the user asks to "write a chapter", "next chapter", "chapter outline", "draft chapter", "continue the story", "write a scene", "outline a chapter", or wants to write prose for a story project. NOT for planning a scene's structure, subtext, or outcome (use scene-craft), drafting without an outline (use discovery-drafting), or revising existing chapters (use revision-continuity).
---

# Chapter Writing

## Overview

Write story chapters using an outline-first workflow. Gathers context with `story context`, which keeps later chapters out, builds a beat-by-beat outline for approval, then writes full prose. After writing, updates the timeline, continuity state, and foreshadowing in the entity files, and rebuilds registries with `story reindex`.

## Prerequisites

A story project must already exist with at least:
- `story.md` (story bible)
- At least one character in `characters/`
- A plot structure in `plot/_index.md` (recommended but not required for first chapters)

## Prose Pass and Companion Skill

The in-repo `line-editing` skill owns the prose-quality pass (line edit, voice differentiation, copyedit, read-aloud, proof). It ships with Story Skills, so it is always available: run it on a drafted chapter before marking it `revised`.

The external `better-writing` skill is an optional complement for general prose quality and anti-generic writing checks. Before drafting or revising chapter prose, check whether it is available in the active agent environment. Detect it by looking for its skill directory in the configured skills paths:

```shell
ls -d ~/.claude/skills/better-writing .claude/skills/better-writing ~/.agents/skills/better-writing .agents/skills/better-writing skills/better-writing 2>/dev/null
```

- If a `better-writing` directory exists (containing `SKILL.md`), use it for prose quality, voice calibration, anti-generic writing checks, and the final pre-flight pass before saving the chapter.
- If `better-writing` is not installed, point the user at [forjd/better-writing](https://github.com/forjd/better-writing) and ask whether they want to install it; do not run any installer without explicit approval. Then continue with this skill's built-in writing guidelines (`references/writing-guidelines.md`) if the user does not install it.

## Outline-First Workflow

### 1. Gather Context

If the chapter you are drafting already has a file with its `pov` and `characters` set (for example a planned chapter that `story next` names), start with its packed context:

```shell
story context chapter-{NN} --path .
```

It prints, within a token budget (`--budget`, default 6000), the chapter's outline and cast, the `story.md` essentials (including the book's language, writing mode, chapter numerals, and count unit) and `style-sheet.md` rules, the POV character's knowledge and state at that point, cards for the characters on the page and the chapter's locations (with their `progressions` applied at this chapter), open promises, clues, and questions, and summaries of the previous scenes. Knowledge uses the same rule as `story knowledge`: the character knows a fact when its `learned-in` chapter is not after the target in story time (by date when both chapters are dated, otherwise by chapter number). A line marked `reader-knowledge` may be used in the prose. A line marked `character-knowledge` and `do not reveal` is known to the POV from a flashback the reader has not reached; write them as knowing it, and do not put the fact on the page. Everything else from a later chapter is left out. Add `--json` if you would rather read the items as data. For a new chapter, run it after step 2 instead.

Draft from that output, and do not open project files for background. If it ends with "Left out to fit the budget", do not open the files that list names, even though the line under it says to read them: they are whole files, and context filtered their items to the target. `continuity/state.md` holds knowledge learned later, character and location files hold later `progressions`, and promise and clue files hold their payoffs. Instead rerun with a larger `--budget`, or run with `--json` and use the `text` of each item in `sections` whose `included` is `false`, which is already filtered. Context already left out anything past the target: `continuity/state.md` is the full current snapshot, and a character's state from it is included only when `current-chapter` is before the target. `plot/timeline.md`, `continuity/questions/_index.md`, `continuity/promises/_index.md`, `plot/_index.md`, active arc files in `plot/arcs/`, and the other `_index.md` registries hold later beats or whole-book state, and the previous chapter is already covered by the recent scene summaries. Do not open them while drafting.

The packed context's Story essentials give the book's `language` (a BCP 47 tag; `en` when unset), writing mode, chapter numerals, and count unit, so you do not need to open `story.md`. Draft in that language, with its dialogue punctuation as the style sheet records it. If the style sheet records none and the book is not in English, settle it with the user first (see `../line-editing/references/language-conventions.md`). If the packed context has no style-sheet section and no left-out item names `style-sheet.md`, the file is missing: draft normally and suggest the `voice-style` skill once a chapter exists.

### 2. Determine Chapter Scope

Ask the user:
- What should this chapter cover?
- Whose POV?
- Which location(s)?

For a planned chapter, suggest the next beats from its packed context: its outline, the arcs it advances, and the open promises, clues, and questions. For a new chapter there is no packed context yet, so take the scope from the user and the `story next` suggestion. Do not open arc files or `plot/_index.md` to find beats.

Once the scope is agreed, give the chapter its POV and cast so the packed context can include them: create a new chapter with `story add chapter "Title" --pov <character-id> --character <character-id> --location <location-id>`, or set `pov`, `characters`, and `locations` in an existing chapter's frontmatter. Then run `story context chapter-{NN} --path .` (or pass a scene id, `chapter-{NN}-scene-{NN}`, to draft one scene) and build the outline and prose from it.

### 3. Build the Outline

Create a beat-by-beat outline listing:
- Each scene/beat and what it accomplishes
- POV character and location for each beat
- Which arc plot points are advanced
- Any foreshadowing to plant or pay off
- Any machine-readable state changes the scene should record
- Each scene's intended `outcome` (`yes`, `no`, `yes-but`, `no-and`) and how the chapter ends (`hook`)

Use the POV character card and the location cards from the packed context for voice and setting. If a card was left out to fit the budget, get it from a larger `--budget` or its `--json` item text, not from the character or location file.

Present the outline to the user for approval. Revise until approved.

### 4. Write the Chapter

With the approved outline, write the full prose:

- Write in the book's `language` and follow the POV and tense from the packed context (they come from `story.md`). The craft advice in `references/writing-guidelines.md` and `scene-craft` is written for English; in another language keep its aims and use that language's own conventions
- Use the POV character's voice and speech patterns from their packed card
- Ground scenes in the location details from the packed context
- Consult `references/writing-guidelines.md` for quick prose craft guidance. For the deep reference — the Scene/Sequel unit, dialogue subtext and voice-differentiation, deep POV and psychic distance — use the `scene-craft` skill.
- Give each speaker their recorded voice, using `voice-words` and avoiding `voice-avoid` from their packed character card
- When available, apply the `better-writing` skill before finalizing prose; the `line-editing` skill handles the fuller prose pass afterwards
- To check a drafted scene before saving it, pipe it to `story prose -` (style sheet, filter words, echoes) and `story voices -` (`voice-avoid` words) from the project folder. If either reports a check skipped for the book's language, reread the scene for that check instead
- Use the chapter template from `references/chapter-template.md`
- Include the approved outline in the file above `## Chapter Text` (for reference). CLI word counts start at that heading, so an outline kept above it never inflates `word-count`: run `story wordcount . --write` after writing to record counts.

Save to `chapters/chapter-{NN}.md` with appropriate frontmatter.

Create or update a matching scene file in `scenes/chapter-{NN}-scene-{NN}.md` for each scene. Scene frontmatter should include `title`, `chapter`, `scene`, `pov`, `location`, `characters`, `mentions`, `arcs-advanced`, `status`, `date`, `time`, and `state-changes` so continuity survives beyond prose. Set `date` (`YYYY-MM-DD`, or a date in the book's `calendar` when `story.md` has one, such as `3 Thaw 412 AF`) and `time` (`"HH:MM"` or `dawn`, `morning`, `midday`, `afternoon`, `evening`, `night`) on every scene as its moment settles, and `travel-hours` (a number) when the POV character had to travel since the previous scene: undated scenes silently switch off the clock and route checks in `story continuity`, and `story timeline` lists them as undated. Set `outcome` on each goal-driven scene record to what actually happened on the page (`yes`, `no`, `yes-but`, `no-and`), and set the chapter's `hook` to how it actually ends (`cliffhanger`, `question`, `revelation`, `reversal`, `decision`, `emotional`, `resolution`).

Write chapter prose directly into the chapter markdown file. Do not stage prose in project-local build scripts, generator scripts, or bulk writer scripts (for example `build-*.js`) to emit chapters. If a temporary helper is truly unavoidable for mechanical file operations, keep it outside the story project and remove it before finishing.

### 5. Post-Write Updates

After the chapter is written:

1. **Leave the registries alone.** Every `_index.md` registry, including `chapters/_index.md` and the question, promise, and clue indexes, is generated. `story reindex` rebuilds those tables from the entity files, and `story wordcount . --write` refreshes the chapter word counts and then reindexes. Do not add or edit registry rows by hand.
2. **Update `plot/timeline.md`** - add events from this chapter in chronological order
3. **Update arc files** - mark advanced plot points with chapter reference
4. **Update scene records** - make sure every scene has a corresponding `scenes/` file
5. **Update continuity** - after the prose is saved, carry forward character state, object ownership, knowledge, open questions, and promises/payoffs. This is the one time to open `continuity/state.md`: recording the new state, not reading it for drafting context. The CLI reads its frontmatter, not its body tables (those are optional notes), so record state there:

   ```yaml
   current-chapter: 3
   character-state:
     - character: mara-quill
       location: port-kestrel
       physical: bruised ribs
       emotional: wary
   object-state:
     - artifact: brass-key
       owner: mara-quill
       status: active
       since: chapter-03
   knowledge-state:
     - character: mara-quill
       knows: The ledger was forged
       learned-in: chapter-03
   ```

   `story continuity` checks these entries and `story knowledge <id> --at <chapter>` reads `knowledge-state`. When `story.md` links other books through `follows` or `precedes`, give reveals the series depends on a stable `fact` id in `knowledge-state` (see `series-continuity`)
6. **Update foreshadowing** - mark any items as `planted` or `paid-off` with chapter reference
7. **Note character changes** - if a character's status changed (injury, revelation, relationship shift), flag for the user to update the character file
8. **Run CLI maintenance when available:**

```shell
story wordcount . --write
story reindex .
story links .
story validate .
story continuity .
story next .
story pacing .
story progress . --log
```

`story continuity .` is the continuity check, in the same place discovery-drafting runs it, after `story validate`. It prints each finding and exits non-zero when there are errors. Repair those errors before treating the chapter as done. `story next .` can name the same errors as a P0 line and still exit 0, without printing the findings, so its exit code is not a continuity result.

`story pacing .` shows the new chapter's words, scene outcomes, and hook alongside the rest of the book, and warns about runs of `yes` outcomes, missing sequels, length outliers, or a missing `hook`.

`story progress . --log` records the session in `progress.md` and reports words against `target-words`, the `deadline`, and chapter `target-words`, plus today's words against `daily-target-words`, the writing streak (which skips days not in `writing-days`), and the last four weeks; report the streak from it rather than counting by hand. Skip the `--log` flag when the user does not keep a log.

Present a summary of all updates made.

## Scene Breaks

Within a chapter, separate scenes with `---`. Each scene should have a clear POV character (even if the same as the previous scene) and location.

## Branching Books

When any chapter has `choices` in its frontmatter, the book branches: a chapter may be reached by more than one path, and its prose must hold on each. Draft it with the `interactive-fiction` skill, which follows this workflow and adds the rules for branches, rejoins, endings, and path continuity.

## Revision Handoff

When asked to revise or continuity-check an existing chapter, use the `revision-continuity` skill; for line edits, copyedits, and proofing, use the `line-editing` skill. This skill owns new drafting and chapter creation; `revision-continuity` owns targeted edits, continuity audits, and post-draft cleanup.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder. Registry updates go through `story reindex` only. If no CLI is available, perform the registry, backlink, word-count, and continuity checks manually, and still do not hand-edit generated `_index.md` tables.

## Reference Files

- **`references/chapter-template.md`** - Frontmatter and structure template for chapter files
- **`references/scene-template.md`** - Machine-readable continuity template for scenes
- **`references/writing-guidelines.md`** - Quick-reference prose craft: show-don't-tell, POV, dialogue, pacing, scene structure, continuity. For the deep reference — the Scene/Sequel unit, dialogue subtext and voice-differentiation, deep POV and psychic distance — use the `scene-craft` skill.

## Shared Conventions

Every story skill follows the shared conventions in [`../story-maintenance/references/conventions.md`](../story-maintenance/references/conventions.md), resolved relative to this skill folder. Read it before creating, renaming, or linking story files. If that file is missing because this skill was installed without `story-maintenance`, the essentials are: kebab-case ids and filenames, YAML frontmatter on every story-project file, `_index.md` files as the authoritative registries, bidirectional links between entities, `characters` for who is on the page and `mentions` for who is only referred to, `status: deceased` plus `died-in: chapter-{NN}` for deaths, and no project-local generator or build scripts (run only the installed or bundled Story CLI).

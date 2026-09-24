---
name: chapter-writing
description: This skill should be used when the user asks to "write a chapter", "next chapter", "chapter outline", "draft chapter", "continue the story", "write a scene", "outline a chapter", or wants to write prose for a story project.
---

# Chapter Writing

## Overview

Write story chapters using an outline-first workflow. Gathers context from all other story elements (characters, world, plot) to maintain consistency, builds a beat-by-beat outline for approval, then writes full prose. After writing, updates all cross-references (chapter index, timeline, foreshadowing).

## Prerequisites

A story project must already exist with at least:
- `story.md` (story bible)
- At least one character in `characters/`
- A plot structure in `plot/_index.md` (recommended but not required for first chapters)

## Prose Pass and Companion Skill

The in-repo `line-editing` skill owns the prose-quality pass (line edit, voice differentiation, copyedit, read-aloud, proof). It ships with Story Skills, so it is always available: run it on a drafted chapter before marking it `revised`.

The external `better-writing` skill is an optional complement for general prose quality and anti-generic writing checks. Before drafting or revising chapter prose, check whether it is available in the active agent environment. Detect it by looking for its skill directory in the configured skills paths:

```shell
ls -d ~/.claude/skills/better-writing .claude/skills/better-writing skills/better-writing 2>/dev/null
```

- If a `better-writing` directory exists (containing `SKILL.md`), use it for prose quality, voice calibration, anti-generic writing checks, and the final pre-flight pass before saving the chapter.
- If `better-writing` is not installed, point the user at [forjd/better-writing](https://github.com/forjd/better-writing) and ask whether they want to install it; do not run any installer without explicit approval. Then continue with this skill's built-in writing guidelines (`references/writing-guidelines.md`) if the user does not install it.

## Outline-First Workflow

### 1. Gather Context

Read these files to understand the current story state:

- `story.md` - genre, themes, POV, tense
- `style-sheet.md`, when present - voice, house spellings, dialogue punctuation, character voices, and watch words. If it is missing, draft normally and suggest the `voice-style` skill once a chapter exists
- `chapters/_index.md` - what's been written, current word count
- `plot/_index.md` - arc status, what needs to happen next
- `plot/timeline.md` - chronological position
- `scenes/_index.md` - scene state already recorded
- `continuity/state.md` - character, object, and knowledge state
- `continuity/questions/_index.md` and `continuity/promises/_index.md` - unresolved mysteries and setup/payoff commitments

If this isn't the first chapter, also read:
- The previous chapter file - for continuity (ending state, cliffhangers, emotional tone)
- Active arc files in `plot/arcs/` - for upcoming plot beats

### 2. Determine Chapter Scope

Ask the user:
- What should this chapter cover? (or suggest based on plot arcs)
- Whose POV?
- Which location(s)?

If plot arcs exist, suggest the next logical beats to advance.

### 3. Build the Outline

Create a beat-by-beat outline listing:
- Each scene/beat and what it accomplishes
- POV character and location for each beat
- Which arc plot points are advanced
- Any foreshadowing to plant or pay off
- Any machine-readable state changes the scene should record
- Each scene's intended `outcome` (`yes`, `no`, `yes-but`, `no-and`) and how the chapter ends (`hook`)

Load the POV character's file for voice reference. Load relevant location files for setting details.

Present the outline to the user for approval. Revise until approved.

### 4. Write the Chapter

With the approved outline, write the full prose:

- Follow the POV and tense from `story.md`
- Use the POV character's voice and speech patterns from their profile
- Ground scenes in location details from worldbuilding files
- Consult `references/writing-guidelines.md` for quick prose craft guidance. For the deep reference — the Scene/Sequel unit, dialogue subtext and voice-differentiation, deep POV and psychic distance — use the `scene-craft` skill.
- Give each speaker their recorded voice, using `voice-words` and avoiding `voice-avoid` from their character file
- When available, apply the `better-writing` skill before finalizing prose; the `line-editing` skill handles the fuller prose pass afterwards
- Use the chapter template from `references/chapter-template.md`
- Include the approved outline in the file above `## Chapter Text` (for reference). CLI word counts start at that heading, so an outline kept above it never inflates `word-count`: run `story wordcount . --write` after writing to record counts.

Save to `chapters/chapter-{NN}.md` with appropriate frontmatter.

Create or update a matching scene file in `scenes/chapter-{NN}-scene-{NN}.md` for each scene. Scene frontmatter should include `title`, `chapter`, `scene`, `pov`, `location`, `characters`, `mentions`, `arcs-advanced`, `status`, and `state-changes` so continuity survives beyond prose. Set `outcome` on each goal-driven scene record to what actually happened on the page (`yes`, `no`, `yes-but`, `no-and`), and set the chapter's `hook` to how it actually ends (`cliffhanger`, `question`, `revelation`, `reversal`, `decision`, `emotional`, `resolution`).

Write chapter prose directly into the chapter markdown file. Do not stage prose in project-local build scripts, generator scripts, or bulk writer scripts (for example `build-*.js`) to emit chapters. If a temporary helper is truly unavoidable for mechanical file operations, keep it outside the story project and remove it before finishing.

### 5. Post-Write Updates

After the chapter is written:

1. **Update `chapters/_index.md`** - add chapter to registry, update total word count
2. **Update `plot/timeline.md`** - add events from this chapter in chronological order
3. **Update arc files** - mark advanced plot points with chapter reference
4. **Update scene records** - make sure every scene has a corresponding `scenes/` file
5. **Update continuity** - carry forward character state, object ownership, knowledge, open questions, and promises/payoffs. When `story.md` links other books through `follows` or `precedes`, give reveals the series depends on a stable `fact` id in `knowledge-state` (see `series-continuity`)
6. **Update foreshadowing** - mark any items as `planted` or `paid-off` with chapter reference
7. **Note character changes** - if a character's status changed (injury, revelation, relationship shift), flag for the user to update the character file
8. **Run CLI maintenance when available:**

```shell
story wordcount . --write
story reindex .
story links .
story validate .
story next .
story pacing .
story progress . --log
```

`story pacing .` shows the new chapter's words, scene outcomes, and hook alongside the rest of the book, and warns about runs of `yes` outcomes, missing sequels, length outliers, or a missing `hook`.

`story progress . --log` records the session in `progress.md` and reports words against `target-words`, the `deadline`, and chapter `target-words`; skip the `--log` flag when the user does not keep a log.

Present a summary of all updates made.

## Scene Breaks

Within a chapter, separate scenes with `---`. Each scene should have a clear POV character (even if the same as the previous scene) and location.

## Revision Handoff

When asked to revise or continuity-check an existing chapter, use the `revision-continuity` skill; for line edits, copyedits, and proofing, use the `line-editing` skill. This skill owns new drafting and chapter creation; `revision-continuity` owns targeted edits, continuity audits, and post-draft cleanup.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder. If no CLI is available, perform the registry, backlink, and word-count checks manually.

## Reference Files

- **`references/chapter-template.md`** - Frontmatter and structure template for chapter files
- **`references/scene-template.md`** - Machine-readable continuity template for scenes
- **`references/writing-guidelines.md`** - Quick-reference prose craft: show-don't-tell, POV, dialogue, pacing, scene structure, continuity. For the deep reference — the Scene/Sequel unit, dialogue subtext and voice-differentiation, deep POV and psychic distance — use the `scene-craft` skill.

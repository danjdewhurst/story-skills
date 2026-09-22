---
name: voice-style
description: This skill should be used when the user asks to "create a style sheet", "style guide", "house style", "keep the voice consistent", "voice drift", "British or American spelling", "character voices", "lint the prose", "prose check", "filter words", "said-bookisms", "overused words", "repeated phrases", "similar character names", or wants to record and enforce the voice and surface conventions of a story project.
---

# Voice & Style

## Overview

Record the book's voice and surface conventions in `style-sheet.md`, then
enforce them. The style sheet is the copyeditor's record: dialect and
spelling choices, capitalisation, hyphenation, numbers, dialogue
punctuation, a one-line voice summary per major speaker, and a watch list.
Its frontmatter is machine-readable, and `story prose` counts violations
and prose tics in every chapter. Use this skill so voice stays the same
across chapters, drafting sessions, and agents.

## Prerequisites

A story project with `story.md` in the root. `story init` scaffolds
`style-sheet.md`; older projects can add it with `story init "<title>" --dir
. --force`, which only adds missing files, or by copying
`references/style-sheet-guide.md`'s frontmatter block by hand.

## When to Use

- Starting a project, once the first chapter or a writing sample exists
- Before drafting when voice has drifted between chapters or sessions
- During a copyedit pass (`revision-continuity` reads this file)
- When the user wants a mechanical prose check before sharing a draft
- NOT for character personality or arc (use `character-management`)
- NOT for scene-level craft such as deep POV or subtext (use `scene-craft`)

## Workflow

### 1. Build or update the style sheet

1. Read `story.md` (genre, POV, tense, Tone & Style), `style-sheet.md`,
   and two or three drafted chapters or a sample the user supplies. If
   there is no prose yet, ask the user for a paragraph that sounds right or
   three published books whose voice is close.
2. Fill the sections in `style-sheet.md` following
   `references/style-sheet-guide.md`. Record decisions the prose already
   makes; do not invent new ones silently. When the draft is inconsistent
   (both *grey* and *gray*), ask the user which form wins.
3. Set the frontmatter:
   - `dialect: british | american | unspecified`
   - one `preferred` entry per variant: `use` is the house form, `avoid`
     the form to flag. Repeat entries for several variants of one word.
   - `watch-words`: words or phrases this book overuses
   - `allow-words`: built-in filter words, adverbs, or dialect spellings
     this book uses on purpose (a proper noun like *Harbor Street* in a
     British book)
4. Character Voices entries summarise each character file's Voice & Speech
   Patterns section in one line and link to it. The character file is
   canon; if the two disagree, fix the style sheet, or ask the user before
   changing the character.

### 2. Draft and revise against it

- `chapter-writing` and `discovery-drafting` read `style-sheet.md` before
  drafting. Write in the recorded voice, use the house spellings, and give
  each speaker the recorded patterns.
- When a new convention appears mid-draft (a new invented term, a number
  style), add it to the style sheet in the same change.

### 3. Run the prose check

```shell
story prose .
```

The report lists, per chapter: sentence count, average and longest length,
and spread; filter words and -ly adverbs per 1,000 narration words
(dialogue is excluded); plain and said-bookism dialogue tags; words echoed
within 30 words; watch-word counts; and avoided spellings. Across the
manuscript it lists repeated 4-word phrases and character first names that
readers could confuse. Warnings are advisory and the command exits 0 unless
a file cannot be read. See `references/prose-checks.md` for what each
count means and how to respond.

### 4. Act on the findings

1. Fix avoided spellings everywhere; they are always errors of consistency.
2. Treat rates, echoes, and repeated phrases as prompts to reread the
   passage, not orders. Keep a flagged word when it is the right word, and
   add it to `allow-words` when the book uses it deliberately.
3. For uniform-rhythm warnings, revise sentence length by intent (short for
   impact, long for flow), not by formula.
4. For similar names, ask the user before renaming; then use
   `story rename character <id> "<New Name>"` so references follow.
5. Present a summary: what changed, what was kept on purpose, and any
   style-sheet updates.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use
`bun run story --` from the Story Skills repository checkout or the bundled
fallback `node ../story-maintenance/scripts/story.js` with the same
arguments, resolving the path relative to this skill folder. If no CLI is
available, apply the checks in `references/prose-checks.md` by reading.

After editing the style sheet or revising prose:

```shell
story validate .
story prose .
story wordcount . --write
story links .
```

## Reference Files

- **`references/style-sheet-guide.md`** - What goes in each style-sheet section, the frontmatter format, and how to extract a voice description from sample prose
- **`references/prose-checks.md`** - What each `story prose` count measures, its threshold, and when to keep the flagged text

---
name: line-editing
description: This skill should be used when the user asks to "line edit", "edit my prose", "polish this chapter", "tighten the prose", "improve the sentences", "copyedit", "proofread", "proof pass", "check grammar and punctuation", "dialogue punctuation", "make the voices distinct", "everyone sounds the same", "read it aloud", "read-aloud pass", "text to speech", or wants a sentence-level quality pass on drafted chapters that preserves the author's voice. NOT for creating the style sheet or checking voice consistency (use voice-style).
---

# Line Editing

## Overview

Own the prose-quality passes that come after structure is settled: the
line edit (sentence clarity, rhythm, precision, voice), character-voice
differentiation, the copyedit against `style-sheet.md`, a read-aloud pass,
and a proof pass on a built copy. Every change is proposed with a
before/after and a one-line rationale so the author can accept or reject
it. The author's voice is the standard, not the agent's taste. The
`better-writing` skill, when installed, is an optional complement for
anti-generic checks; this skill does not depend on it.

## Prerequisites

A story project with `story.md` and drafted chapters (status `draft` or
later). Read `style-sheet.md` if present; if it is missing or thin, build
it first with the `voice-style` skill, because the copyedit checks against
it.

## When to Use

- A chapter's structure is settled and the prose needs polish
- Dialogue sounds the same from every speaker
- Preparing a manuscript for beta readers, an editor, or submission
- The `line`, `copyedit`, or `proof` revision pass is next in `story passes`
- NOT for structural, plot, or continuity revision (use `revision-continuity`; line-edit only after those passes, or the polish is wasted)
- NOT for setting house style or the voice description (use `voice-style`; this skill applies it)
- NOT for scene-level craft such as deep POV, subtext, or exposition strategy (use `scene-craft`)
- NOT for acting on external reader notes (use `feedback-triage`)

## Workflow

### 1. Scope and permission

1. Ask which chapters and which pass: line edit, voice differentiation,
   copyedit, read-aloud, or proof. Default order is the one below.
2. Ask how heavy the edit should be: **light** (errors and clear
   improvements only), **medium** (tighten and clarify), or **heavy**
   (restructure sentences and paragraphs). Default to light.
3. Never rewrite a passage wholesale without explicit permission. Propose
   edits; apply only what the author accepts, or apply all on explicit
   instruction.
4. Snapshot before a multi-chapter pass (see Draft Snapshots in the
   `revision-continuity` skill), and mark the pass in progress. If
   `story.md` has no `revision-passes` yet, `story passes . --init` writes
   the default ladder first; `story passes .` shows where the book is.

```shell
story passes . --start line
```

### 2. Line edit

1. Read `story.md` (POV, tense, Tone & Style), the style sheet's Voice
   section, and the chapter. Run `story prose .` for the chapter's counts.
2. Work paragraph by paragraph with `references/line-edit-checklist.md`:
   clarity, precision, economy, rhythm, POV distance, and voice.
3. Present edits in the format in `references/edit-note-format.md`:
   location, before, after, and one line of rationale. Group by
   paragraph; lead with the highest-impact changes; cap a batch at about
   20 so the author can review them.
4. Leave passages that are unusual but deliberate. When unsure whether a
   quirk is voice or error, ask.

### 3. Differentiate character voices

```shell
story voices .
```

The report fingerprints each character's attributed dialogue (sentence
length, contractions, questions, exclamations, signature words) and warns
when two voices are near-identical, when a character says a
`voice-avoid` word, and when a `voice-words` entry never appears.

1. For near-identical pairs, read both characters' Voice & Speech
   Patterns sections and propose line-level changes that follow them:
   vocabulary, sentence length, what each avoids saying, how each deflects.
   See the voice section of `references/line-edit-checklist.md`.
2. If a character file has no voice notes, propose `voice-words` and
   `voice-avoid` lists drawn from their best existing lines, and ask
   before adding them to the character file.
3. A line is attributed only when the narration names the speaker next
   to a speech verb or, failing that, names exactly one character in the
   paragraph. Pronoun tags (`she said`) and untagged lines are invisible
   to the report, so the POV character in close third is often
   under-counted; read those lines by hand, or name the tags in a sample
   chapter and rerun. The near-identical warning reads "X and Y may sound
   alike" and needs five or more lines from each character.

### 4. Copyedit

1. Mark the pass: `story passes . --start copyedit`.
2. Run `story prose .` and fix every avoided spelling. Then work through
   `references/copyedit-checklist.md` against `style-sheet.md`: grammar,
   punctuation, dialogue punctuation, capitalisation, hyphenation,
   numbers, and consistency of names and terms (check the glossary).
3. Record every new decision in `style-sheet.md` in the same change, so
   the next chapter follows it.
4. Tell the user plainly: this is a consistency and correctness pass, not
   a substitute for a professional copyeditor on a book going to print.

### 5. Read-aloud pass

Follow `references/read-aloud-guide.md`. Build the narration script:

```shell
story build . --format narration
```

Offer to play chapters with the system's text-to-speech if one is
installed (`say` on macOS; `espeak-ng` or `spd-say` on Linux). Check with
`command -v`; ask before installing anything. Listen for stumbles,
unintended rhymes, tongue-twisters, and runs of same-length sentences;
record them as edit notes.

### 6. Proof pass

1. Mark the pass: `story passes . --start proof`.
2. Build the copy the reader will see:

```shell
story build . --format html
story build . --format print --trim 6x9
```

3. Proof against `references/copyedit-checklist.md`'s proof section:
   typos introduced by editing, doubled or missing words, broken scene
   breaks, chapter headings, matter pages, widows and orphans in the print
   copy. Cite locations by the HTML copy's paragraph anchors (`ch03-p12`).
4. Rendering the print HTML to PDF needs a paged-media engine the user
   installs (Paged.js CLI, WeasyPrint, or Prince); ask before installing.

### 7. Close the pass

1. Summarise what changed, what was kept on purpose, and any style-sheet
   or character-file updates.
2. Update chapter `status` only when the author agrees (`draft` to
   `revised`).
3. Mark the pass done, for example `story passes . --done line`, and run
   CLI Maintenance.

## Conventions

- The author's voice wins. Edit toward what the prose is already trying
  to do, not toward a generic "good prose" standard.
- One rationale line per change, naming the effect (*clearer subject*,
  *cuts a filter word*, *restores past tense*), never "sounds better".
- Edits are made directly in the chapter markdown, below `## Chapter
  Text`; never through a script that rewrites prose in bulk.
- Style decisions go in `style-sheet.md`; voice decisions about a
  character go in the character file (`voice-words`, `voice-avoid`, Voice
  & Speech Patterns), which stays canon.
- A line edit does not change events, facts, or who knows what. If an
  edit would, stop and hand it to `revision-continuity`.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use
`bun run story --` from the Story Skills repository checkout or the bundled
fallback `node ../story-maintenance/scripts/story.js` with the same
arguments, resolving the path relative to this skill folder. If no CLI is
available, apply the checklists by reading and keep word counts current by
hand.

After editing chapters, character voice fields, or the style sheet:

```shell
story wordcount . --write
story prose .
story voices .
story links .
story validate .
```

## Reference Files

- **`references/line-edit-checklist.md`** - Paragraph-level line edit checks (clarity, precision, economy, rhythm, POV distance, voice) and character-voice differentiation levers
- **`references/copyedit-checklist.md`** - Copyedit and proof checks against the style sheet: grammar, punctuation, dialogue punctuation, consistency, and the proof pass on built copies
- **`references/read-aloud-guide.md`** - Running a read-aloud pass with the narration build and OS text-to-speech, and what to listen for
- **`references/edit-note-format.md`** - How to present edits to the author: before/after with rationale, batching, and recording accepted and rejected changes

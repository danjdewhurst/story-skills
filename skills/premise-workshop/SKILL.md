---
name: premise-workshop
description: This skill should be used when the user asks to "brainstorm a story idea", "I have an idea for a story", "what if", "develop a premise", "is this idea strong enough", "workshop my logline", "premise", "story concept", "what should I write", "short story or novel", "novella or novel", "name my book", "title ideas", or has a spark (an image, a character, a setting, a question) and wants to turn it into a tested premise before starting a story project.
---

# Premise Workshop

## Overview

Turn a spark into a premise that can carry a book, before `story init`
builds the project. The workshop generates what-ifs from the spark, tests
them as loglines, drafts the controlling idea and its counter-argument
(`premise` and `counter-premise` in `story.md`), names the stakes, chooses
a form (the `form` field), brainstorms titles, sanity-checks the idea
against comparable books, and hands a filled-in brief to the `story-init`
skill. The author owns the idea: offer options and tests, never decide for
them.

## Prerequisites

None. The workshop usually runs before a project exists. If the user wants
the work saved before `story init`, keep it in one `premise-notes.md` file
in the current directory (outside the future project folder) and move the
kept material into `story.md` after init.

## When to Use

- The user has a spark but no premise, or several ideas and cannot choose
- The user has a premise and wants to know whether it holds up
- Choosing between short story, novella, novel, serial, or a children's form
- Brainstorming a title, or checking a working title against the cast
- NOT for creating the project folder (use `story-init`; this skill hands off to it)
- NOT for refining the controlling idea of a drafted book, arc types, or the lie/truth machinery (use `theme-craft`)
- NOT for outlining once the premise is settled (use `plot-structure`, or `discovery-drafting` for pantsers)
- NOT for comp titles, pitch, or blurb for submission (use `submission`)

## Workflow

### 1. Capture the spark

Ask what the user has, in their words, and do not improve it yet. Sort it:
an **image** (a drowned bell tower), a **what-if** (what if grief could be
sold), a **character** (a lighthouse keeper who has never left the rock),
a **setting** (a city that moves every winter), or a **feeling** they want
a reader to have. Ask what drew them to it. The answer is often the book's
real subject and should survive every later change.

### 2. Generate what-ifs

Following `references/what-if-generation.md`, produce 8-12 short what-ifs
from the spark across different angles (invert it, raise the cost, move it
in time or place, give it to the wrong person). Present them as a numbered
list and ask the user to pick one to three, or to combine. Do not rank them
for the user unless asked; do say which ones already imply conflict.

### 3. Workshop the logline

For each chosen what-if, draft a logline with the recipe in
`../story-init/references/title-logline.md` (protagonist + want + obstacle
+ stakes). Then run the stress tests in `references/premise-tests.md`:
active protagonist, opposition that can win, a choice at the end, stakes
that are personal, and a situation that can sustain the chosen length.
Report each test as pass, weak, or fail with one sentence of why, and
offer one revision per weak or failed test.

### 4. Draft premise and counter-premise

`story.md`'s `premise` field is the controlling idea (value + cause), not
the logline. Draft it and the `counter-premise` as working hypotheses
using `../theme-craft/references/controlling-idea.md`. If the user wants
to discover theme in the draft, record `premise: tbd-discovery` and move
on. Keep the logline for the Synopsis section.

### 5. Name the stakes

Write the stakes on three levels (see `references/premise-tests.md`):
external (what is lost in the world), relational (who is lost or
betrayed), and internal (what the protagonist becomes if they fail). At
least two levels must be concrete and personal.

### 6. Choose the form

Use `references/form-choice.md` to match the idea's scope to a form:
`novel`, `novella`, `novelette`, `short-story`, `flash`, `serial`,
`picture-book`, or `chapter-book`. Count the idea's moving parts (POV
characters, threads, locations, time span) and recommend the form they
fit, with the trade-offs. The user decides.

### 7. Brainstorm titles

Follow `references/title-and-comps.md`: generate titles across the
families listed there, cut to a shortlist of five, and test each against
the logline and the genre shelf. The title craft principles live in
`../story-init/references/title-logline.md`; do not repeat them to the
user, apply them.

Once a project exists, check title words and new names against the story's
entities before adopting them:

```shell
story names "Bell Tower" "Maren" --path .
```

An exact clash exits 1 and must be resolved; look-alike warnings (same
initial and close spelling, or a shared initial with a major character)
are the user's call.

### 8. Sanity-check against comparable books

Ask the user for two or three recent books the idea sits beside. Use
`references/title-and-comps.md` to check whether the premise is
distinct from them and whether it fits the shelf they imply. Never invent
titles, authors, or sales claims; if web search is available, verify that
each named book exists and note what you checked. If not, mark the list
unverified.

### 9. Hand off to story-init

Present a one-screen brief: working title, logline, premise,
counter-premise, stakes, form, genre and sub-genre, POV and tense if
known, themes, and the comps. On approval, follow the `story-init` skill
with the brief:

```shell
story init "{Title}" --form novella --genre "{genre}" --sub-genre "{sub-genre}" --synopsis "{logline}" --theme "{theme}"
```

`--form` sets `form` in `story.md` and a default `target-words` for the
form when none is given (`serial` sets none; set per-episode chapter
`target-words` instead). Then hand-edit `premise` and `counter-premise`
into `story.md`, move the stakes, rejected what-ifs worth keeping, title
shortlist, and comps into its `## Notes` section, and delete
`premise-notes.md` if one was made.

## Conventions

- Present options, not verdicts. The user chooses the what-if, form, and
  title; record why when they reject a recommendation.
- Keep the spark's original wording in the notes. Premises drift during
  workshop; the spark is the check that the drift was chosen.
- `premise` in `story.md` is always the controlling idea (value + cause).
  The logline goes in the Synopsis section.
- Titles and names are provisional until `story names` passes. Rename a
  title freely before chapter one; after that, rename characters with
  `story rename` so references follow.
- Never present a comparable title, author, prize, or market fact as
  verified without a source.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use
`bun run story --` from the Story Skills repository checkout or the bundled
fallback `node ../story-maintenance/scripts/story.js` with the same
arguments, resolving the path relative to this skill folder. If no CLI is
available, create the project by hand as the `story-init` skill describes
and check names against the registries by reading them.

After `story init` and the hand edits to `story.md`:

```shell
story validate .
story report .
```

`story validate` warns when `target-words` sits outside the chosen form's
usual range; either adjust the target or confirm the choice with the user.

## Reference Files

- **`references/what-if-generation.md`** - Angles for turning an image, character, setting, or question into conflict-bearing what-ifs, with worked examples
- **`references/premise-tests.md`** - Logline stress tests, the three levels of stakes, and common premise failures with fixes
- **`references/form-choice.md`** - Matching an idea's scope to a form: moving-parts count, what each form does well, and the `form` values
- **`references/title-and-comps.md`** - Title brainstorming families, shortlist tests, `story names` checks, and the comparable-title sanity check

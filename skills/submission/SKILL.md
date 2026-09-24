---
name: submission
description: This skill should be used when the user asks to "write a query letter", "query", "querying", "pitch", "blurb", "back cover copy", "jacket copy", "comp titles", "comparable titles", "synopsis for agents", "submit to agents", "submission tracker", "self-publishing description", "retailer description", or wants to prepare and track a finished manuscript's submission to agents, publishers, or retailers.
---

# Submission

## Overview

Get a finished manuscript out the door. This skill checks submission
readiness, drafts the submission package (query letter, pitch, synopsis,
blurb, comp titles), builds the manuscript in submission format, and keeps a
tracker of where the book has gone. Package files live under `submission/`
in the story project. The author sends every submission themselves; this
skill prepares materials and records outcomes.

## Prerequisites

A story project with a complete or near-complete draft. Verify `story.md`
exists in the project root and read its `status`, `genre`, `sub-genre`,
`premise`, `author`, and `contact` fields. If `status` is not `complete` or
`revising`, tell the user the package can be drafted now but the readiness
check will fail until the draft is finished.

## When to Use

- Checking whether a manuscript is ready to submit
- Drafting or revising a query letter, pitch, synopsis, blurb, or comp list
- Building a Shunn-format manuscript for agents or magazines
- Writing a retailer or back-cover description for self-publishing
- Recording queries sent and responses received
- NOT for self-publishing production (ISBNs, retailer metadata, print
  interiors, launch, rights): use the `publishing` skill. This skill still
  drafts the blurb and retailer description it uses
- NOT for revising the manuscript itself (use `revision-continuity`)
- NOT for reader feedback rounds (use `feedback-triage`)

## Hard Rules

- Never invent the author's bio, credentials, awards, publication history,
  platform, or contact details. Ask the user, or leave a clearly marked
  `[TODO: author to supply]` placeholder.
- Never invent agent or publisher names, submission guidelines, dates, or
  responses. Tracker entries come from the user.
- Never send, email, or upload anything. The user submits.
- Never claim sales figures, bestseller status, awards, or endorsements for
  comp titles or the author that the user has not confirmed.
- Package copy describes the book as written. Read the manuscript and the
  bible; do not promise events, tone, or an ending the draft does not
  deliver.

## Workflow

### 1. Readiness check

Run the deterministic checks and report every finding before drafting:

```shell
story validate .
story links .
story continuity .
story prose .
story wordcount . --write
story report .
```

Then check what the CLI cannot:

1. Validate, links, and continuity have no errors. List warnings for the
   user to accept or fix.
2. `story prose .` shows no avoided spellings, and the user has reviewed
   the other findings. If `style-sheet.md` is missing or still the
   scaffold, suggest the `voice-style` skill first.
3. Every chapter has `status: revised`, `final`, or `complete`. List any
   still at `outline` or `draft`.
4. The total word count sits inside the range for the category in
   `references/word-count-norms.md`. Those ranges are rough conventions:
   state the number and the range, and ask the user to confirm current
   norms for their market. Never pad or cut to hit a number without the
   user's direction.
5. No `[TODO` markers remain in chapter prose.
6. Open questions and planted promises are resolved, or deliberately left
   for a sequel (check `story.md` `precedes`).

Give a verdict: `ready`, `ready-with-caveats` (list them), or `not-ready`
(list the blockers and hand them to `revision-continuity`).

### 2. Pitch and logline

1. Read `story.md` (premise, synopsis), the main arc files, and the
   protagonist's character file.
2. Draft a one-sentence pitch: protagonist + goal + obstacle + stakes, in
   under 35 words. `../story-init/references/title-logline.md` has the
   logline recipe.
3. Offer two or three variants; the user picks. Save the chosen pitch at
   the top of `submission/query.md`.

### 3. Comp titles

Follow `references/comp-titles.md`. Propose candidates with a one-line
reason each, mark every one unverified until the user confirms year,
category, and fit, and save the agreed list to `submission/comps.md`.

### 4. Query letter

Follow `references/query-letter.md`. Draft `submission/query.md` with the
hook, one or two book paragraphs, the metadata line (title, genre, word
count rounded to the nearest thousand, comps), and a bio placeholder the
author fills in. Keep the letter between 250 and 350 words. If the user
names a specific agent, add a personalization line only from facts the user
provides.

### 5. Synopsis

1. Generate the mechanical draft:

   ```shell
   story synopsis . --pages 1 --out submission/synopsis-1-page.md
   story synopsis . --pages 3 --out submission/synopsis-3-page.md
   ```

2. The CLI output is a scaffold stitched from the `story.md` synopsis and
   each arc's Setup, Rising Action, Climax, and Resolution sections.
   Rewrite it into polished prose: present tense, third person, main
   characters' names in capitals on first use, every major turn, and the
   ending revealed. Agents expect the ending; never withhold it.
3. Keep the 1-page version near 500 words and the 3-page version near
   1,500. Overwrite the generated files with the rewritten versions and add
   the frontmatter from Conventions below.
4. If the output is thin, the arc files are thin: fill the missing arc
   sections with the `plot-structure` skill, rerun, then rewrite.

### 6. Blurb and retailer description

Follow `references/blurb.md`. Draft `submission/blurb.md` with a tagline,
the back-cover copy (150-200 words), and, for self-publishing, a retailer
description with the same copy plus a comp line if the user wants one. The
blurb never reveals the ending.

### 7. Build the manuscript

For agents and short-fiction markets, build Shunn manuscript format:

```shell
story build . --format docx --shunn
story build . --format shunn
```

Confirm `story.md` has `author` and `contact` first; the title page uses
them. Shunn builds leave out `matter/` pages, as submissions expect. For
self-publishing, hand off to the `publishing` skill, which covers EPUB and
print builds (`story build . --format epub`, `--format print --trim 6x9`),
retailer metadata, and launch.

For a one-page metadata sheet to check the pitch facts against (title,
series, author, word count, description length against retailer limits,
keywords, BISAC subjects, and missing fields), run:

```shell
story build . --format metadata
```

Keep the retailer description in `submission/blurb.md` and the
`description` field in `story.md` in step when the user self-publishes.
If `story.md` has an `ai-disclosure`, check each agent's or market's
policy on AI-assisted work and disclose as they require; see the
`editorial-review` skill.
Tell the user which file in `dist/` to send, and remind them to check each
agent's or market's guidelines for format and attachment rules.

### 8. Track submissions

Create `submission/tracker.md` from `references/tracker-template.md` the
first time the user reports sending a submission. Add or update a row each
time the user reports a submission or a response, using only what they tell
you. On request, summarize: queries out, partial and full requests, offers,
declines, and entries with no response after the window the user sets.

## Conventions

- Package files: `submission/query.md`, `submission/comps.md`,
  `submission/synopsis-1-page.md`, `submission/synopsis-3-page.md`,
  `submission/blurb.md`, `submission/tracker.md`.
- Each file has YAML frontmatter with a `type` (`query`, `comps`,
  `synopsis`, `blurb`, `submission-tracker`) and `updated: YYYY-MM-DD`.
- `submission/` is outside the story model: the CLI does not validate it
  and builds never include it.
- Word counts in submission copy come from `story wordcount .`, rounded to
  the nearest thousand (`87,000 words`).
- Tracker statuses: `queried`, `requested-partial`, `requested-full`,
  `offer`, `declined`, `no-response`, `withdrawn`.
- When the manuscript changes after the package is drafted, reread the
  package and update anything the revision made untrue.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder. If no CLI is available, perform the readiness checks manually and write the synopsis from the arc files.

After the readiness check, or any manuscript change made for submission:

```shell
story wordcount . --write
story validate .
story continuity .
story prose .
```

## Reference Files

- **`references/query-letter.md`** - Query structure (hook, book paragraphs, metadata line, bio), length, personalization, and common mistakes
- **`references/blurb.md`** - Back-cover and retailer description formulas for genre fiction, length, and taglines
- **`references/comp-titles.md`** - How to choose comparable titles, how to phrase them, and the verification rule
- **`references/word-count-norms.md`** - Rough word-count ranges by category, to confirm with the user
- **`references/tracker-template.md`** - `submission/tracker.md` template and status definitions

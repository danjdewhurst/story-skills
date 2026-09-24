---
name: editorial-review
description: This skill should be used when the user asks for a "sensitivity reader", "authenticity reader", "cultural review", "is this portrayal okay", "real people in my novel", "defamation", "can I use song lyrics", "epigraph permission", "permissions", "quote permission", "fair use", "AI disclosure", "do I need to disclose AI", "send to my editor", "editorial round", "Word file for my editor", "editor review copy", "co-author", "collaborate on a book", "shared world", "back up my book", or wants to run human editorial, ethics, permissions, or collaboration workflows around a story project. NOT for contracts or selling rights (use publishing) or reader feedback rounds (use feedback-triage).
---

# Editorial Review

## Overview

Run the workflows that involve people outside the agent: briefing and
paying sensitivity and authenticity readers, a real-people and
defamation-risk pass, permissions for quoted material, an AI-use
disclosure statement, editorial rounds with human editors, and
collaboration between co-authors. The skill prepares materials, tracks
state in frontmatter, and flags risks. It does not give legal advice, it
does not contact anyone, and it never records a permission, review, or
disclosure the user has not confirmed.

## Prerequisites

A story project with `story.md` in the root and drafted chapters. Git is
needed for snapshot tags, `story compare --ref`, and the collaboration
workflow; offer `git init` if the project has none.

## When to Use

- A book portrays a culture, identity, disability, faith, trade, or
  experience the author does not share
- Fiction features or resembles real, identifiable people or organisations
- The manuscript quotes lyrics, poems, epigraphs, or other writers' prose
- The user needs an AI-use statement for a retailer, agent, or publisher
- Sending the manuscript to a human editor, or taking their edits back
- Two or more people write or maintain the same book or shared world
- NOT for synthesising reader notes into decisions (use `feedback-triage`; this skill hands notes to it)
- NOT for fact-checking real-world details (use `research`; this skill adds the review layer on top)
- NOT for the agent's own prose edit (use `line-editing`) or structural revision (use `revision-continuity`)
- NOT for query letters, synopses, or retailer copy (use `submission`)

## Workflow

### 1. Sensitivity and authenticity reads

1. Find what needs a read: characters, settings, and research notes that
   touch lived experience the author lacks. Mark the research notes that
   ground them with `risk: [cultural]` (add `medical`, `legal`, or others
   as they apply), or open one:

   ```shell
   story add research "Deaf community in 1980s Glasgow" --accuracy must-be-accurate --method expert-review --risk cultural --used-in chapter-04
   ```

2. Prepare the brief with `references/sensitivity-reader-brief.md`: which
   chapters, which characters, specific questions, the author's research
   so far, deadline, and fee. Sensitivity reading is paid professional
   work; help the user budget and find readers, never suggest asking
   community members to work for free.
3. Build what the reader receives: `story build . --format docx` for
   readers who comment in Word, or `story build . --format html` for
   paragraph-anchored notes.
4. Record the returned notes as a feedback round (`feedback/round-{N}/`)
   and synthesise them through the `feedback-triage` skill. When the
   reader's notes are incorporated, add them to the research note's
   `reviewed-by` (name or role, with their consent to be named).
5. `story validate .` warns when a note with any `risk` is used in a
   `final` or `complete` chapter and has no `reviewed-by`.

### 2. Real-people and defamation pass

For fiction that uses real people, real organisations, or recognisable
portraits, follow `references/real-people-and-permissions.md`: list every
real or recognisable person, classify each portrayal, and flag the risky
ones in a research note with `risk: [defamation]` (or `legal`). Say
plainly that this is a flagging exercise, not legal advice, and recommend
a publishing lawyer's review before publication whenever a living person
or a real organisation is shown doing something discreditable.

### 3. Permissions for quoted material

1. Find every quotation of someone else's work: epigraphs, lyrics,
   poems, extracts, and in-text quotes. Each epigraph or quoted page
   usually lives in `matter/`.
2. Record state in the matter file's frontmatter: `permission`
   (`not-needed`, `pending`, `granted`, `public-domain`), `rights-holder`,
   and `credit` (the exact credit line the rights-holder requires).
3. Apply the cautions in `references/real-people-and-permissions.md`:
   song lyrics almost always need permission, fair use is a narrow and
   uncertain defence, and public-domain status depends on country and
   date. Never set `granted` or `public-domain` without the user's
   confirmation and, for `granted`, the rights-holder's name.
4. `story validate .` warns when a matter page is `pending` and the story
   is `complete`, and when `granted` has no `rights-holder`.

### 4. AI-use disclosure

1. Ask the user how AI tools were used on this book: brainstorming,
   outlining, drafting prose, editing, research, cover or art, or
   translation, and roughly how much of the published text was generated
   rather than written or rewritten by the author.
2. Draft a short plain statement for `ai-disclosure` in `story.md`, for
   example: `Outlining and line-level editing suggestions used an AI
   assistant; all prose was written and revised by the author.` Use only
   what the user confirms; never minimise or inflate it.
3. Tell the user that disclosure expectations differ and change: some
   retailers ask at publication whether content is AI-generated or
   AI-assisted, many agents and publishers ask in submission guidelines
   or contracts, and some magazines do not accept AI-generated work. Ask
   the user to check the current terms of each retailer, agent, publisher,
   or market they submit to; do not quote policy text from memory.
4. `story build . --format metadata` includes the statement on the
   retailer metadata sheet.

### 5. Editorial rounds with a human editor

Follow `references/editor-rounds.md`:

1. Snapshot and tag the draft sent (`sent-to-editor-1`) with the user's
   approval, then build the file the editor wants:
   `story build . --format docx` (Word with Track Changes) or `story
   build . --format shunn` for manuscript format.
2. When edits come back, the author accepts or rejects them in Word; the
   agent transfers the accepted text into the chapter markdown, chapter
   by chapter, never by a bulk script. Queries that change events go to
   `revision-continuity`; editorial letters go through `feedback-triage`.
3. Show how deep the round went: `story compare . --ref sent-to-editor-1`.

### 6. Review copies for non-technical readers

For beta readers, editors, or agents who never open a terminal:

1. `story build . --format html` produces one file with a table of
   contents and a clickable paragraph label on every paragraph (`ch03-p12`), so
   comments can cite exact places in email, a doc, or an issue.
2. For a GitHub-hosted project, offer the templates from the Story Skills
   repository (https://github.com/danjdewhurst/story-skills,
   `templates/github/`): copy `review-copy.yml` into `.github/workflows/`
   to publish the HTML copy to GitHub Pages on every push to `main`, and
   `ISSUE_TEMPLATE/manuscript-note.yml` into `.github/ISSUE_TEMPLATE/` so
   readers file notes with an anchor and a type (typo, confusion,
   continuity, sensitivity, praise, other). Ask before creating files in
   `.github/`, and warn that a public Pages site makes the manuscript
   public unless the repository and Pages are private.
3. Collect issue notes into a feedback round and triage them with
   `feedback-triage`.

### 7. Collaboration and backups

Follow `references/collaboration.md` for co-authored books and shared
worlds: list every author under `authors` in `story.md`, one branch per
author or per chapter, pull requests to `main`, a `CODEOWNERS` file for
shared-world canon, and a remote pushed after every session as the
backup. Real-time collaborative editing (two people typing in one file at
once) is out of scope for the markdown model; recommend taking turns per
file through branches instead.

## Conventions

- Never record a review, permission, credit, or disclosure the user has
  not confirmed. Unknown values stay `pending` or unset.
- Flag risk; do not give legal advice. Recommend a qualified lawyer for
  defamation, privacy, or permission questions on a book going to
  publication.
- Reviewers are named in `reviewed-by` only with their consent;
  otherwise record their role (`sensitivity reader, Deaf culture`).
- Sensitivity notes are input to the author, not verdicts. The author
  decides, and `feedback-triage` records declined notes with a reason.
- Never send, email, upload, push, or publish anything without the
  user's instruction. The user contacts readers, editors, and
  rights-holders.
- Never commit, tag, push, or change branches without the user's approval.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use
`bun run story --` from the Story Skills repository checkout or the bundled
fallback `node ../story-maintenance/scripts/story.js` with the same
arguments, resolving the path relative to this skill folder. If no CLI is
available, keep `research/_index.md`, `matter/_index.md`, and the
frontmatter fields current by hand.

After adding or editing research notes, matter pages, `story.md`
metadata, or chapters:

```shell
story reindex .
story links .
story validate .
story wordcount . --write
```

## Reference Files

- **`references/sensitivity-reader-brief.md`** - When to hire a sensitivity or authenticity reader, finding and paying them, a brief template, and incorporating notes
- **`references/real-people-and-permissions.md`** - Real-people and defamation-risk pass, permissions for epigraphs, lyrics, and quotations, and the matter-file permission fields
- **`references/editor-rounds.md`** - Sending a manuscript to a human editor, snapshot tags, taking DOCX edits back into markdown, and HTML review copies with paragraph anchors
- **`references/collaboration.md`** - Multi-author projects, git branching per author, CODEOWNERS for shared worlds, and backups

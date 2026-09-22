---
name: research
description: This skill should be used when the user asks to "research", "fact-check", "check the history", "is this accurate", "research notes", "sources", "historical accuracy", "technical accuracy", "how would this really work", "verify a detail", or needs to record the real-world facts a story relies on and the chapters that use them.
---

# Research

## Overview

Keep the real-world facts a story depends on in `research/` notes: the
question, the findings with a source for each, and the chapters that rely
on them. The CLI tracks each note's status (`open`, `verified`,
`disputed`) and its `used-in` chapters, checks those chapter links, and
warns when a final chapter still rests on research that is open or
disputed.

## Prerequisites

A story project with `story.md` in the root. The `research/` folder and its
registry are created by the first `story add research`.

## When to Use

- A chapter depends on history, science, law, medicine, a trade, a real
  place, or any detail a knowledgeable reader could check
- The user asks whether something is accurate
- Before marking a chapter `final` in historical, technical, or
  contemporary fiction
- NOT for invented world facts (use `worldbuilding`) or story-internal
  continuity (use `revision-continuity`)

## Workflow

### 1. Open a note

```shell
story add research "Tidal bore timing" --used-in chapter-03
```

Fill the note's `## Question` with what the story needs to get right, in
one or two sentences.

### 2. Research

1. Use the research tools available in the session (web search or fetch,
   documents the user provides). If none are available, list what needs
   checking and ask the user to supply sources.
2. Record each finding under `## Findings` with its source beside it. Add
   every source to the `sources` frontmatter list, one full citation or URL
   per entry, with `--source` on `story add` or by editing the file.
3. **Never present unverified knowledge as verified.** A fact recalled
   without a source stays `status: open`. Only set `status: verified` when
   every finding the chapters rely on has a source. Set `status: disputed`
   when sources disagree, and record both sides.

### 3. Connect it to the story

1. List every chapter that relies on the note in `used-in`.
2. Under `## Story Use`, record how the prose uses the facts and any
   deliberate departure from them (compressed timelines, invented
   institutions). A recorded departure is a choice, not an error.
3. Revise the chapters if the findings contradict them, following the
   `revision-continuity` skill.

### 4. Before finalising

Run `story validate .`: it warns about a `final` or `complete` chapter that
uses open or disputed research, and about verified notes with no sources.
Resolve those before the chapter is marked final, or tell the user which
facts remain unverified.

## Conventions

- Note ids are kebab-case topics: `research/tidal-bore-timing.md`.
- `sources` entries are kept whole, so citations may contain commas.
- `used-in` lists chapter ids; `story rename` and `story remove` keep it
  current when chapters change.
- Sensitive or lived-experience topics need a human reader as well as
  sources. Suggest an authenticity read and record it through the
  `feedback-triage` skill.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use
`bun run story --` from the Story Skills repository checkout or the bundled
fallback `node ../story-maintenance/scripts/story.js` with the same
arguments, resolving the path relative to this skill folder. If no CLI is
available, keep `research/_index.md` and the `used-in` lists current by
hand.

After adding or editing research notes:

```shell
story reindex .
story links .
story validate .
```

## Reference Files

- **`references/research-practice.md`** - What to check, how to judge sources, and how to record findings and deliberate departures

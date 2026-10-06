---
name: interactive-fiction
description: This skill should be used when the user asks to "write a branching story", "plan the branches", "choice graph", "add a choice", "gamebook", "draft a branch", "where the branches rejoin", "add an ending", "unreachable chapter", "path continuity", "state-differs-by-path", or wants to plan, draft, or revise a story project whose chapters carry `choices`. NOT for converting a finished linear book into Ink or Twine (use adaptation).
---

# Interactive Fiction

## Overview

Plan, draft, and revise a branching book: a story project whose chapters
are passages joined by `choices` in their frontmatter. The chapters and
their choices are the source of truth. `story continuity` follows the paths
of choices, and `story build --format twee` or `--format ink` turns the
project into a playable Twine or ink story.

This skill owns books written to branch from the start. Turning an existing
linear book into an interactive edition (a branch map drawn from its scenes,
then a copied project) belongs to the `adaptation` skill; once that edition
project exists, draft and revise its chapters here.

## Prerequisites

A story project with `story.md` in the root. For a new book, start it with
the `story-init` skill first. Read `story.md` (`language`, `pov`, `tense`,
`form`, `status`, `ifid`) and `chapters/_index.md`, then the `choices` of
every chapter: together they are the graph. A small example is
[`examples/the-gull-rock-light`](../../examples/the-gull-rock-light/), a
branch-and-bottleneck story with two endings.

## When to Use

- Planning a choice graph: structure, branch points, rejoins, endings
- Writing or changing `choices` entries
- Drafting a chapter on a branch, at a rejoin, or at an ending
- Revising a branching book, and reading `state-differs-by-path`,
  `unreachable-chapter`, and the other branching findings
- Building the book as Twine or ink
- NOT for converting a linear book (use `adaptation`), drafting a linear
  chapter (use `chapter-writing`), or a linear continuity audit (use
  `revision-continuity`). Prose craft inside a passage still comes from
  `scene-craft` and `line-editing`

## How The Graph Works

- Each chapter is one passage. Its `choices` are where the reader can go:

  ```yaml
  choices:
    - text: Search the rocks for Tobias
      to: chapter-02
    - text: Climb the tower to the lamp
      to: chapter-03
  ```

- The lowest-numbered chapter is the start.
- Once any chapter has `choices`, the links are exactly the choices: a
  chapter with none is an ending, and a chapter that leads on to one place
  needs a single choice (`text: Continue`). With no choices anywhere the
  book is linear again.
- `text` becomes the link text: no `[`, `]`, `|`, `->`, `<-`, or line
  break, and no final `<`. Quote it if it looks like a number.
- `to` is a chapter id. It may be the chapter itself (a loop) or, while
  planning, a `chapter-NN` with no file yet; the builds need every target
  written.

## Workflow

### 1. Plan The Choice Graph

Agree the shape with the user before drafting; see
`references/choice-graph.md` for the structures, choice design, and
numbering. Then:

1. Draw the graph: every passage, every choice, every rejoin, every ending.
   Count passages and endings against `target-words` and the `form`.
2. Number chapters so each choice leads to a higher number, except a loop
   back. The promise, question, and clue ledgers, the clock and route
   checks, `story pacing`, and the `story diagram` and `story series`
   lifelines still read chapter numbers, so this keeps them close to the
   paths.
3. Scaffold each passage as an outline chapter with its POV and cast, then
   add its `choices` by hand (`story add` does not write them):

   ```shell
   story add chapter "The Landing" --number 1 --status outline --pov ada-fenn --character ada-fenn --hook decision --path .
   ```

4. Check the skeleton before writing prose. `story links .` errors on a
   choice to a missing chapter and warns `unreachable-chapter` for every
   chapter no path from the start reaches.
5. Record the state choices set that the CLI does not track (flags,
   trust, items the reader can carry down one branch) in
   `notes/branch-map.md`, a working file the CLI ignores: a table of each
   flag, the chapter that sets it, and the chapters that read it.

### 2. Draft A Passage

Draft with the `chapter-writing` workflow (outline, approval, prose,
post-write updates), with these differences:

- Run `story context chapter-NN --path .` for every passage. In a branching
  book it holds only what was drafted and learned on a path to that
  chapter, so a sibling branch never leaks in.
- **On a branch:** the passage may use everything on the paths that lead
  to it, and nothing from its sibling.
- **At a rejoin:** the context lists the scenes of every branch that leads
  there. Read each incoming chapter and write only what is true on every
  path: who is where, who is hurt, what the reader has seen. Facts are
  marked known when any incoming path teaches them, so check each fact the
  rejoin uses against every branch. A detail that differs by path stays out
  of the rejoin prose, or is carried by a flag in the built Twine or ink
  file (see Build).
- **At a branch point:** end on the decision (`hook: decision`) and make
  each choice meaningful, informed, and acknowledged in the passage it
  leads to.
- **At an ending:** no `choices`, `hook: resolution`, and an ending that
  pays off the path that reached it. Name it as an ending in the prose if
  the book's style does (`THE END.`).

After saving the passage, record continuity as `chapter-writing` does,
following `references/path-continuity.md` for the branching rules:
deaths and revivals, one `knowledge-state` entry per branch for a fact
learned on two branches, and the `continuity/state.md` snapshot.

### 3. Revise A Branching Book

Use `revision-continuity` for the passes, plus these checks:

- **Reachability:** fix every `unreachable-chapter` by adding a choice that
  leads there or by removing the chapter (`story remove chapter <id>
  --path .`, which drops the choices that led to it and warns which
  chapters became endings).
- **Endings:** list the chapters with no `choices`. Each should be a
  deliberate ending. A chapter that lost its last choice in a revision is
  an accidental ending: give it a choice.
- **Loops:** the CLI does not check that a loop has a way out. Trace every
  loop and confirm a choice leaves it.
- **Path continuity:** run `story continuity .` and read the branching
  findings in `references/path-continuity.md`. Then do the hand checks
  there for what the checker reads by chapter number.
- **Renumbering:** `story move chapter` rewrites every `to` that named the
  old id. It never edits prose, so reread the passages for chapter numbers
  in the text.
- **Rejoin prose:** after changing a branch, reread every rejoin it leads
  to and confirm the prose still holds on that path.

### 4. Build

```shell
story build . --format twee
story build . --format ink
```

Both write to `dist/` and refuse to build while a choice is malformed or
leads to a missing chapter. Without `ifid:` in `story.md`, they derive the
IFID from the story id and warn with the line to add; add it before
sharing the story, so a retitle keeps the same IFID.

The ink build escapes ink syntax in the prose, so flags and conditional
text (`VAR`, `~`, `{ }`) never go in chapters. Once the graph is settled,
build a working copy with `--out adaptations/interactive/{story-id}.ink`
and write that logic into it by hand. `--out` never replaces an existing
file, so a rebuild after changing `choices` means deleting the old copy and
carrying the hand-written logic into the new one: ask the author before
deleting a file that has hand-written logic in it. Ink and Twine syntax for
that layer is in the `adaptation` skill's
`references/interactive-fiction.md`.

## Maintenance

After adding, removing, renumbering, or rewriting chapters or their
`choices`, run:

```shell
story wordcount . --write
story reindex .
story links .
story validate .
story continuity .
```

Repair every error. Treat `unreachable-chapter` and `state-differs-by-path`
as findings to resolve or record. `story next .` suggests drafting the next
chapter number, as for a linear book: plan from the graph instead.

If `story` is not installed, use `bun run story --` from the Story Skills
repository checkout or the bundled fallback
`node ../story-maintenance/scripts/story.js` with the same arguments,
resolving the path relative to this skill folder.

## Hard Rules

- Never invent a branch, ending, or choice the user has not agreed; offer
  options instead.
- Never write rejoin prose that is true on only one incoming path.
- Never silence `state-differs-by-path` with an `object-state` entry the
  rejoin chapter's prose does not make true.
- Never put ink logic in chapter prose; keep it in the built copy under
  `adaptations/interactive/`. Write Twine macros in chapters only once the
  author has picked a story format (Harlowe, SugarCube, Chapbook).

## Reference Files

- **`references/choice-graph.md`** - Branching structures, designing
  choices, numbering, rejoins, endings, and scope
- **`references/path-continuity.md`** - What `story continuity` follows by
  path and what it still reads by number, the branching findings and their
  fixes, and the hand checklist

---
name: discovery-drafting
description: This skill should be used when the user asks to "pantsing", "discovery write", "write without an outline", "discovery draft", "write into the dark", "story kernel", "reconcile a chapter", "reverse outline", "cut a subplot", "dead end", "drafting sprint", "writing cadence", or wants to draft a story by discovery with retrospective bible reconciliation.
---

# Discovery Drafting

## Overview

Draft by discovery ("pantsing"): start from a one-paragraph story kernel
rather than a beat sheet, write forward, then reconcile each chapter back
into the story bible through a structured loop (extract entities → reverse
outline → diff against the bible → reconcile). This is the complement to
chapter-writing's outline-first workflow. The bible is maintained *after*
the prose, not before — which the repo's import-style entity extraction and
continuity checks already support.

## Prerequisites

A story project must already exist (created via the story-init skill), with
at least a `story.md` and one character. No plot structure is required to
start — arcs get built during reconciliation.

## When to Use

- The user wants to draft without outlining first, or identifies as a
  discovery writer
- Starting a project from a situation/character rather than a plot
- NOT for mysteries or other clue-dependent genres where setup must precede
  payoff (use chapter-writing; see `genre-craft`)
- NOT for revising existing chapters (use `revision-continuity`)
- The user can switch modes per project or per chapter; record the mode so
  audits know which discipline applies

## Workflow

1. **Write the story kernel.** Consult `references/story-kernel.md` and
   draft the one-paragraph kernel with the user (character in a situation,
   a want, an obstacle, a tone signal). Store it in `story.md` under
   `## Story Kernel` and set `draft-mode: discovered` in frontmatter.
2. **Draft forward.** Write the chapter from the kernel using the session
   shape in `references/drafting-cadence.md` (re-read → write → close with
   a next-session note). Write forward only; park bible questions as
   `[TODO: check bible]` inline rather than stopping. Follow the prose
   craft in `chapter-writing/references/writing-guidelines.md` and the
   scene-grain tools in the `scene-craft` skill as usual, and write in the
   voice and house style recorded in `style-sheet.md` — discovery changes
   *planning order*, not prose standards.
3. **Run the reconcile loop.** After each chapter, follow
   `references/reconcile-loop.md` exactly:
   - Extract new entity/promise candidates (import-style, user-approved)
   - Reverse-outline the chapter into the chapter file and `scenes/` records
   - Diff against the bible (new / contradiction / enrichment / dangling)
   - Reconcile: update the bible **or** revise the chapter — never neither
   - Append post-hoc chapter notes; set chapter frontmatter
     `mode: discovered`
4. **Batch review every 3–5 chapters.** Re-read post-hoc notes, sweep the
   promise/question ledgers for dangling setups, and cut dead ends per
   `references/dead-ends.md` (abandoned ledger entries keep a recorded
   reason; cut characters get `status: cut`, not deletion).
5. **Hold the cadence.** Keep the agreed target (see
   `references/drafting-cadence.md`) and log each session with
   `story progress . --log`; at midpoint and draft completion,
   hand the batch to `revision-continuity` for developmental checks before
   continuing.
6. **Close the loop on mode.** When the draft is complete, every
   `mode: discovered` chapter must have post-hoc notes and a completed
   diff — flag any that don't as unfinished maintenance, then hand the
   manuscript to `revision-continuity` for revision passes.

## Conventions

- `story.md` frontmatter `draft-mode: discovered` marks a discovery project;
  per-chapter `mode: discovered` / `mode: outlined` tracks mixed projects.
- Chapters carry a `## Chapter Notes (post-hoc)` section recording what was
  discovered, what was cut, and open questions — the project's memory of
  why the bible looks the way it does.
- Entity candidates extracted from prose are presented for user approval
  before bible files are created (same discipline as `story import`).
- Cut threads are logged, not erased: abandoned promises/questions keep
  `status: abandoned` with a reason; cut characters keep their file with
  `status: cut`.
- Bidirectional links and kebab-case ids follow the story-init conventions
  exactly — discovery changes when the bible is written, not how.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder. If no CLI is available, perform the registry, backlink, and word-count checks manually.

After each reconcile loop:

```shell
story wordcount . --write
story reindex .
story links .
story validate .
story continuity .
```

## Reference Files

- **`references/story-kernel.md`** - The one-paragraph kernel: character in a situation, want, obstacle, tone signal
- **`references/reconcile-loop.md`** - The core loop: extract entities/promises → reverse-outline → diff against the bible → reconcile; `mode: discovered` flag
- **`references/dead-ends.md`** - Recognizing and cutting dead ends: cut/fold/prune, abandoned ledger entries, the darling log
- **`references/drafting-cadence.md`** - Daily targets, batch reviews, session shape, recovering a broken cadence

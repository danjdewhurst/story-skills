---
name: genre-craft
description: This skill should be used when the user asks to "mystery", "fair play", "clue", "red herring", "romance beats", "HEA", "thriller", "ticking clock", "horror", "dread", "MG", "YA", "middle grade", "young adult", "science fiction", "sci-fi", "serial", "episodic", "web serial", "genre conventions", or wants genre-specific structural craft for a story project.
---

# Genre Craft

## Overview

Genre-specific structural packs: the codified craft each genre expects, as
checkable rules, ledgers, and audits. Packs cover mystery (fair play + clue
ledger), romance (beats + HEA contract), thriller (ticking clock, power
imbalance, set pieces), horror (dread/terror ordering, monster rules),
MG/YA (category constraints), science fiction (load-bearing speculative
elements), and serial/episodic structure. Use at story-init (pick the pack,
set the constraints) and in revision (run the pack's audit).

## Prerequisites

A story project must already exist (created via the story-init skill) with
its genre recorded in `story.md`. A plot structure (plot-structure) should
exist or be in progress.

## When to Use

- Starting or re-categorizing a story in one of the covered genres
- Planning genre load-bearing elements (clues, clocks, season goals)
- Auditing a draft against its genre's contract
- NOT for line-level genre voice (that belongs to the `better-writing`
  skill's genre work); these packs are structural
- NOT for literary fiction as a pack — its conventions resist deterministic
  encoding by design

## Workflow

1. **Pick the pack.** Read `story.md` for genre/sub-genre and load the
   matching reference:
   - Mystery / crime / detective → `references/mystery-fair-play.md`
   - Romance → `references/romance-beats.md`
   - Thriller / action / suspense → `references/thriller.md`
   - Horror → `references/horror.md`
   - Middle grade / young adult → `references/mg-ya.md`
   - Science fiction → `references/scifi-pipeline.md`
   - Serial / episodic / web serial → `references/serial-episodic.md`
   - Multi-genre stories: load each applicable pack; where packs conflict
     (e.g. horror's slow dread vs. thriller's cliffhangers), decide with
     the user which genre's contract dominates per section and record the
     decision in `story.md` notes.
2. **Set the constraints up front.** Apply the pack's structural
   requirements during planning:
   - Mystery: create `continuity/clues/` and ledger every clue and red
     herring via `story add clue "..." --planted chapter-NN --payoff
     chapter-NN`, with `significance-delayed` frontmatter where the reader
     sees the clue before understanding it and `red-herring: true` on
     misleading clues (`story add clue "..." --red-herring`; their
     `payoff` is the chapter that debunks them).
     Run `story clues .` for the fair-play matrix and `story diagram clues`
     for the plant-to-reveal flow.
   - Thriller: log every promised deadline in `continuity/promises/` and
     track story-time in `plot/timeline.md`.
   - Serial: record `season-goal:` in `story.md` and `episode-question:`
     in each installment's frontmatter.
   - MG/YA: record `target-words:` in `story.md` and check the category
     constraints (protagonist age, minimized adult involvement).
   - Sci-fi: write the speculative element's rules, costs, and limits in
     `worldbuilding/systems/` before the climax exploits them.
3. **Draft against the pack.** Use the pack's beat concepts and rules
   alongside the `chapter-writing` workflow and the `scene-craft`
   scene-grain tools. Cross-link thriller pacing to the Fichtean curve
   note in `references/thriller.md`, and check thriller and serial chapter
   endings with `story pacing .` (chapter `hook` values, and runs of
   `resolution` endings); cross-link serial book-level canon
   to the `series-continuity` skill.
4. **Run the pack audit in revision.** Each reference ends with an audit
   checklist. Run it as part of a developmental revision pass (see the
   `revision-continuity` skill) and record findings in the revision plan.
5. **Record genre decisions.** Any deliberate deviation from the pack (a
   romance without a black moment, a mystery that withholds) is a story
   decision: note it in `story.md` with the reason, so later audits don't
   "fix" it.

## Conventions

- Pack-specific entities use the project conventions: kebab-case ids,
  YAML frontmatter, `_index.md` registries where a collection exists
  (`continuity/clues/` follows the `continuity/promises/` pattern).
- Clue `planted` must precede `payoff` (`story continuity` flags payoff-before-
  plant as an error); deadline promises follow the same ordering logic as
  promise/question ordering.
- Bidirectional links apply: clues link suspects and chapters; suspects'
  character files link back to the clue ids that implicate or clear them.
- Genre audits live in the revision plan or `continuity/` audit files —
  never only in chat.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder. If no CLI is available, perform the registry, backlink, and word-count checks manually.

After adding or changing genre entities (clues, deadlines, season goals,
episode questions):

```shell
story reindex .
story links .
story validate .
story continuity .
story clues .     # mystery: fair-play matrix and warnings
```

## Reference Files

- **`references/mystery-fair-play.md`** - Fair-play doctrine, clue-planting techniques, red-herring discipline (`red-herring: true`), gather-suspects reveal, clue ledger convention, the `story clues` fair-play matrix and `story diagram clues`
- **`references/romance-beats.md`** - Widely-published romance beat concepts (paraphrased), HEA/HFN reader contract, the black moment
- **`references/thriller.md`** - Ticking clock honored once promised, power imbalance, set pieces, mini-cliffhanger endings, Fichtean curve pairing
- **`references/horror.md`** - Dread vs. terror vs. gross-out ordering, the uncanny, monster rules stated early, recovery periods
- **`references/mg-ya.md`** - Word-count norms, age-appropriate voice/stakes, minimized adult involvement, content boundaries
- **`references/scifi-pipeline.md`** - Speculative element must be load-bearing, rules stated before exploited, worldbuilding→plot pipeline
- **`references/serial-episodic.md`** - Season/volume goal, per-episode dramatic question, a reward in every installment, recap discipline

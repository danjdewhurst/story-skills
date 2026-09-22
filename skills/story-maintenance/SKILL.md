---
name: story-maintenance
description: This skill should be used when the user asks to validate, reindex, repair registries, check links, check continuity, count words, summarize a story project, import an existing manuscript, export a manuscript, run the story CLI, or perform deterministic maintenance on a Story Skills markdown project.
---

# Story Maintenance

## Overview

Run deterministic maintenance for Story Skills projects. Use the CLI for structure validation, registry rebuilds, word counts, link checks, continuity checks, project reports, next-action reports, schema migration, entity helpers, manuscript import, and manuscript export. The creative skills still own story decisions; this skill handles mechanical consistency.

## CLI Access

Prefer the first available command:

1. `story <command>` - when the package bin is installed
2. `bun run story -- <command>` - when working from this repository
3. `node scripts/story.js <command>` - bundled fallback, resolving `scripts/story.js` relative to this skill folder

If none of these are available, perform the requested maintenance manually using the conventions in `story-init`.

Run the installed or bundled CLI in place. Do not copy `scripts/story.js` into the user's story project, and do not create project-local build scripts, generator scripts, or bulk writer scripts to generate story content. Story projects should remain markdown-first, plus explicitly requested exports such as `manuscript.md`.

## Commands

Run commands from the story project root, or pass the story path explicitly.

```shell
story validate .
story reindex .
story wordcount . --write
story links .
story continuity .
story prose .
story timeline .
story progress . --log
story series .
story import draft.md --title "Title"
story report .
story report . --actionable
story next .
story doctor .
story migrate .
story add character "Name"
story add matter "Dedication"
story add research "Tidal bore timing" --source "Tide tables 2024" --used-in chapter-03
story add matter "Acknowledgments" --placement back
story rename character old-id "New Name"
story remove promise old-promise
story export . --out manuscript.md
story build . --format markdown
story build . --format epub
story build . --format docx
story build . --format shunn
story build . --format docx --shunn
story knowledge sera-voss --at chapter-04
story add clue "The silver locket" --planted chapter-02 --payoff chapter-05
story synopsis --pages 1
story synopsis --pages 3 --out synopsis.md
```

Use:

- `validate` after initialization and at the end of any multi-file edit
- `reindex` after adding, removing, or renaming any entity file. It rebuilds the character, location, system, faction, artifact, arc, chapter, scene, question, promise, clue, and glossary registries. `story add` reindexes itself; a hand-written file does not
- `wordcount --write` after writing or revising chapters
- `links` after changing character relationships, notable locations, arc participants, or chapter references
- `continuity` after drafting or revising a chapter, and whenever the user asks about contradictions, dead characters appearing, unfired setups, or stale state; it deterministically checks `died-in` ordering, promise/question chapter ordering, Chekhov gaps, POV/cast consistency, and `continuity/state.md` references. It reuses the promise-ordering machinery for the clue ledger (`continuity/clues/`): payoff before plant is an error, and a completed story with planned or planted clues is an error. The Chekhov warning (a clue or promise planted three or more chapters ago) requires `status: planted`. `story add clue --planted` records the chapter and leaves `status: planned`, so set `status: planted` when the clue is on the page. A recorded payoff chapter that is still ahead of the latest chapter suppresses the "no payoff yet" warning. It also checks prop custody — artifacts with `destroyed` or `lost` status must not be referenced after their destruction chapter (recorded in object-state `since: chapter-NN`; later scenes referencing them in `state-changes` or `mentions` are errors) — and clock/time plausibility when scenes or chapters carry `date: YYYY-MM-DD` / `time: HH:MM` frontmatter (time may be `dawn`, `morning`, `midday`, `afternoon`, `evening`, or `night`; scene `travel-hours: N` asserts minimum travel time). No dates means no time findings. Intentional exceptions go in `continuity/exemptions.md` (frontmatter `type: exemption-log`, entries with `pattern` + `reason`); exempted findings are reported as dismissed, not errors
- `progress` when the user asks how far along the book is, whether they will make a deadline, or after a writing session: it reports words against `story.md` `target-words`, days left to `deadline` and words a day needed, chapter `target-words`, and pace from `progress.md`. `--log` records today's total there (`--date YYYY-MM-DD` to backfill); only log when the user keeps a log or asks for it
- `timeline` when the user asks what happens when, how flashbacks sit against the main line, whose POV dominates, or where a character drops out: it orders dated scenes (and chapters without scene records) by `date` and `time`, marks entries told after later events, lists undated scenes in reading order, totals chapters and words per POV, and reports each character's chapter presence, longest absence, and absence from the final chapters. It is read-only; `continuity` owns clock errors
- `prose` when the user asks for a prose check or before sharing a draft: per chapter it counts sentence length and spread, filter words and -ly adverbs per 1,000 narration words, plain and said-bookism dialogue tags, echoed words, watch words, and avoided spellings from `style-sheet.md` (`dialect`, `preferred`, `watch-words`, `allow-words`); across the manuscript it lists repeated 4-word phrases and similar character first names. Findings are advisory warnings and the command exits 0. See the `voice-style` skill for acting on them
- `series` when `story.md` has `follows` or `precedes` links to other books; it orders the linked sequels and prequels by chronology and checks shared canon (characters deceased in an earlier book, cast listings, facts relearned across books, name drift, destroyed artifacts). Use `init --follows <path>` or `init --precedes <path>` to start a linked book, and see the `series-continuity` skill for carrying canon across
- `import` when the user has an existing manuscript or chapter drafts and wants a Story Skills project built from them; follow up by creating character and location files from the printed entity candidates. Directory sources import in natural file-name order (`chapter-2` before `chapter-10`). `import --force` into an existing directory deletes every `chapter-NN.md` in `chapters/` before writing the imported chapters, so confirm with the user before forcing an import over a project with drafted chapters
- `report` when the user asks for project status, inventory, progress, or a quick health summary
- `next` before a drafting session to identify the next deterministic action
- `doctor` when the user asks what is stale, broken, or inconsistent
- `migrate` when a project has an older schema version or missing v2 paths
- `add`, `rename`, and `remove` for deterministic entity file operations when they fit the requested change
- `add matter` when the user wants a dedication, epigraph, copyright page, acknowledgments, author's note, about-the-author, or also-by page. Pages live in `matter/` with `title`, `placement` (`front` or `back`), `order`, and `heading` (set `heading: false` for a dedication or epigraph). Write the page text directly in the file; unwritten pages are left out of builds and `validate` warns about them. Never invent acknowledgments, biographical facts, or copyright details: ask the user for them
- `add research` when the story relies on a real-world fact: notes live in `research/` with `status` (`open`, `verified`, `disputed`), whole-citation `sources`, and `used-in` chapter ids; `validate` warns when a final chapter relies on open or disputed research. See the `research` skill
- `export` only when the user asks for a combined manuscript at a specific path; it includes front and back matter
- `build` when the user asks to build the book artifact; supports markdown, EPUB, and DOCX outputs in `dist/`, with front and back matter. For EPUB, set `cover: path/to/cover.jpg` (inside the project) and `author` in `story.md` to embed a cover image and creator
- `build --format shunn` when the user wants Shunn manuscript-format markdown: title page, contact block, word count, chapter breaks, and double-spaced prose; `story build . --format docx --shunn` applies the same Shunn formatting to the DOCX output
- `knowledge` when the user asks what a character knew at a given chapter: `story knowledge <character-id> --at <chapter-id>` lists knowledge-state entries whose `learned-in` chapter is at or before that chapter, plus entries without `learned-in` as pre-existing knowledge
- `add clue` when the user plants a new clue: `story add clue "Name" --planted chapter-02 --payoff chapter-05` creates the clue ledger entity in `continuity/clues/` with `status: planned`; omit `--payoff` when the payoff is not yet known, and set `status: planted` when the clue is on the page
- `synopsis` when the user wants a mechanical synopsis: the first sentence of `story.md`'s `## Synopsis` section, then each arc's Setup, Rising Action, Climax, and Resolution. One page is 500 words and three pages is 1500. `story synopsis [--pages 1|3] [--out file]`. The output is a scaffold; the `submission` skill rewrites it into an agent-ready synopsis

## Failure Handling

- Treat CLI errors as actionable maintenance findings.
- Fix broken references, missing required files, stale registries, or incorrect word counts when the requested task implies doing so.
- Do not overwrite creative prose or story content merely to satisfy a mechanical check.
- If a validation warning reflects intentional user data, report it rather than silently changing it.
- If `story reindex` fails on a corrupt `plot/_index.md`, do not hand-edit story content to work around it: restore the index frontmatter from git, or delete `plot/_index.md` so reindex rebuilds it, then rerun.

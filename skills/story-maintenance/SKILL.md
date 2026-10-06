---
name: story-maintenance
description: This skill should be used when the user asks to validate, reindex, repair registries, check links, run the story CLI's continuity, pacing, clue, voice, or name checks, count words, summarize a story project, import an existing manuscript, export a manuscript, build a review copy or print interior, generate a diagram, record revision-pass status with `story passes`, run the story CLI, or perform deterministic maintenance on a Story Skills markdown project. It runs the CLI and reads its output; NOT for judging a finding or revising the story to fix it (use revision-continuity for continuity errors and revision passes, plot-structure for pacing, voice-style for voices and prose, genre-craft for clues and fair play).
---

# Story Maintenance

## Overview

Run deterministic maintenance for Story Skills projects. Use the CLI for structure validation, registry rebuilds, word counts, link checks, continuity checks, project reports, next-action reports, pacing, clue, voice, and name checks, revision-pass tracking, Mermaid diagrams, schema migration, entity helpers, manuscript import, and manuscript export and builds. The creative skills still own story decisions; this skill handles mechanical consistency. It runs a check and reports what it found, and fixes mechanical problems such as broken references and stale registries; deciding what a finding means for the story, and revising the story to fix it, belongs to revision-continuity, plot-structure, voice-style, or genre-craft.

## CLI Access

Prefer the first available command:

1. `story <command>` - when the package bin is installed
2. `bun run story -- <command>` - when working from this repository
3. `node scripts/story.js <command>` - bundled fallback, resolving `scripts/story.js` relative to this skill folder

If none of these are available, perform the requested maintenance manually using the shared conventions in `references/conventions.md`.

Run the installed or bundled CLI in place. Do not copy `scripts/story.js` into the user's story project, and do not create project-local build scripts, generator scripts, or bulk writer scripts to generate story content. Story projects should remain markdown-first, plus explicitly requested exports such as `dist/manuscript.md`.

## Commands

Run commands from the story project root, or pass the story path explicitly.

```shell
story validate .
story reindex .
story wordcount . --write
story links .
story continuity .
story prose .
story voices .
story pacing .
story clues .
story timeline .
story passes .
story passes . --init
story passes . --start structure
story passes . --done structure
story names "Mira" "Kelvos"
story diagram relationships
story diagram locations --out dist/locations.mmd
story diagram timeline
story diagram clues
story diagram arcs
story progress . --log
story compare . --ref draft-1
story compare . --against ../book-draft-1
story compare . --ref beta-round-1 --anchor ch03-p12
story similarity . --against ../book-one
story series .
story import draft.md --title "Title"
story report .
story report . --actionable
story next .
story doctor .
story migrate .
story add character "Name"
story add character "Пётр"
story add character "李明" --id li-ming
story add matter "Dedication"
story add research "Tidal bore timing" --source "Tide tables 2024" --used-in chapter-03
story add research "Night shift on a cardiac ward" --method interview --accuracy must-be-accurate --confidence medium --risk medical
story add matter "Acknowledgments" --placement back
story rename character old-id "New Name"
story rename character petr "Пётр Иванов"
story rename character li-ming "李明华" --id li-minghua
story move chapter chapter-04 --number 5
story move scene chapter-03-scene-02 --chapter chapter-05
story move scene chapter-03-scene-02 --scene 1
story remove promise old-promise
story export . --out dist/manuscript.md
story build . --format markdown
story build . --format epub
story build . --format docx
story build . --format shunn
story build . --format docx --shunn
story build . --format html
story build . --format print --trim 6x9
story build . --format narration
story build . --format metadata
story build . --format twee
story build . --format ink
story knowledge sera-voss --at chapter-04
story continuity . --json
story context chapter-04 --budget 6000
story add clue "The silver locket" --planted chapter-02 --payoff chapter-05
story synopsis --pages 1
story synopsis --pages 3 --out dist/synopsis.md
```

The check commands' detailed rules live in `references/continuity-checks.md`, one section per command. Read the matching section before explaining or acting on a finding.

Use:

- `validate` after initialization and at the end of any multi-file edit
- `reindex` after adding, removing, renaming, or moving any entity file. It rebuilds the character, location, system, faction, artifact, arc, chapter, scene, question, promise, clue, and glossary registries. `story add` reindexes itself; a hand-written file does not
- `wordcount --write` after writing or revising chapters
- `links` after changing character relationships, notable locations, arc participants, or chapter references
- `continuity` after drafting or revising a chapter, and whenever the user asks about contradictions, dead characters appearing, unfired setups, or stale state. It checks deaths and revivals, promise, question, and clue ordering, Chekhov gaps, casts and `status: cut` characters, `continuity/state.md`, prop custody, and clock and route plausibility; intentional exceptions go in `continuity/exemptions.md`. Rules: `references/continuity-checks.md` (continuity).
- `compare` after a revision pass, or when the user asks what changed since a draft: it needs exactly one of `--ref` (a git ref) or `--against` (another copy of the project), and `--anchor <label>` maps review-copy paragraph labels to the current text. Rules: `references/continuity-checks.md` (compare).
- `similarity` when the user asks whether a passage echoes another text too closely; it is advisory, so report what it found, never a verdict. Rules: `references/continuity-checks.md` (similarity).
- `progress` when the user asks how far along the book is, whether they will make a deadline, or after a writing session: it reports words against `story.md` `target-words`, days left to `deadline` and words a day needed, chapter `target-words`, and pace from `progress.md`. `--log` records today's total there (`--date YYYY-MM-DD` to backfill); only log when the user keeps a log or asks for it
- `pacing` when the user asks about pacing, sagging middles, or chapter endings, and after drafting or restructuring chapters: per-chapter words, scene outcomes, sequels, and hooks, with warnings for runs and outliers. Rules: `references/continuity-checks.md` (pacing).
- `clues` for mysteries and any story with a clue ledger: a clue-by-chapter matrix with fair-play warnings. Rules: `references/continuity-checks.md` (clues).
- `voices` when dialogue voices may blur or during a line pass: per-character dialogue fingerprints, with warnings for look-alike voices and `voice-avoid`/`voice-words` misses. Rules: `references/continuity-checks.md` (voices).
- `--json` when you need to read a result rather than show it to the user: `validate`, `links`, `continuity`, `series`, `report`, `next`, `doctor`, `knowledge`, `context`, `progress`, `timeline`, `prose`, `pacing`, `clues`, `voices`, and `similarity` then print one JSON object on stdout (`apiVersion`, `command`, `ok`, `data`, `diagnostics`, `writes`). `ok` is true exactly when the exit code is 0; each diagnostic has `severity`, `file`, `message`, `code` (the finding's rule, such as `stale-word-count`, the name a `story.md` `severity` entry takes), and `check` (the check that raised it). `report`, `next`, and `doctor` always have `ok: true`, so read their `data.checks` or error diagnostics instead
- `passes` to track named revision passes in `story.md` `revision-passes`: `--init` writes the default ladder, `--start`/`--done <pass>` update one, and no flag prints the checklist. Rules: `references/continuity-checks.md` (passes).
- `names` before naming a character, place, faction, artifact, system, or glossary term: `story names <name...>` reports exact clashes as errors and look-alikes as warnings. Rules: `references/continuity-checks.md` (names).
- `diagram` when the user wants a picture of the story's structure: `story diagram <kind>` prints Mermaid source generated from frontmatter, or writes it with `--out <file>` (`--path <project>` sets the project). Kinds: `relationships` (character graph, family edges styled distinctly: the family tree), `locations` (map-graph from location `routes`, edges labelled with hours), `timeline` (dated scenes and chapters in story-time order), `clues` (clue plant to reveal flow per chapter), and `arcs` (arcs to the chapters that advance them). GitHub, many editors, and mermaid.live render it; regenerate rather than hand-edit
- `timeline` when the user asks what happens when, how flashbacks sit against the main line, whose POV dominates, or where a character drops out. It is read-only; `continuity` owns clock errors. Rules: `references/continuity-checks.md` (timeline).
- `prose` when the user asks for a prose check or before sharing a draft: advisory per-chapter and manuscript-wide prose metrics against `style-sheet.md`. Rules: `references/continuity-checks.md` (prose).
- `series` when `story.md` has `follows` or `precedes` links to other books; it orders the linked sequels and prequels by chronology and checks shared canon (characters deceased in an earlier book, cast listings, facts relearned across books, dead characters learning facts, name and pronunciation drift, destroyed artifacts and their later use). Use `init --follows <path>` or `init --precedes <path>` to start a linked book, and see the `series-continuity` skill for carrying canon across
- `import` when the user has an existing manuscript or chapter drafts and wants a Story Skills project built from them; follow up by creating character and location files from the printed entity candidates, and by setting `form` and `target-words` in `story.md` (import refuses `--form`; without them `story validate` never checks length and `story progress` has no target). Directory sources import in natural file-name order (`chapter-2` before `chapter-10`). `import --force` into an existing directory deletes every `chapter-NN.md` in `chapters/` before writing the imported chapters, so confirm with the user before forcing an import over a project with drafted chapters
- `report` when the user asks for project status, inventory, progress, or a quick health summary
- `next` before a drafting session to identify the next deterministic action
- `doctor` when the user asks what is stale, broken, or inconsistent
- `migrate` when a project has an older schema version or missing v2 paths
- `add`, `rename`, `move`, and `remove` for deterministic entity file operations when they fit the requested change. `add` takes ids, not names, for reference options (`--planted chapter-01`, `--pov mara-quill`), and `add scene` needs its chapter to exist, so add the chapter first. Ids stay ASCII kebab-case. Cyrillic and Greek names are transliterated (`story add character "Пётр"` writes `characters/petr.md` and keeps `name: Пётр`), but a name in a script with no transliteration table (`李明`) needs the id by hand: `story add character "李明" --id li-ming` writes `characters/li-ming.md`, and `story rename <kind> <id> "<New Name>" --id <new-id>` does the same on a rename. `--id` is refused for chapters and scenes, whose ids come from their numbers. `remove chapter` refuses while scene files point at the chapter, so remove those scenes first; it walks back ledger statuses that relied on the chapter (planted to planned, paid-off to planted or planned, answered or resolved questions to open), so review the ledgers afterwards
- `move` whenever a chapter's number or a scene's chapter or position changes, never a hand rename: chapter and scene ids encode their numbers. `story move chapter <id> --number <n>` renames the chapter and its scene files, sets `number` and the `# Chapter N:` heading, and rewrites every reference to the old id (scene `chapter`, clue and promise `planted`/`payoff`, question `introduced`/`resolved`, research `used-in`, `died-in`, `continuity/state.md` `since`/`learned-in` and `current-chapter`, markdown links, and bare ids in `plot/timeline.md` and arc bodies). A taken number is refused (`chapter-05 already exists: move it first. To make room, renumber from the highest chapter down`), so to insert a chapter move the later chapters up one, highest first, then `add chapter --number <n>`. `story move scene <id> --chapter <chapter-id>` moves a scene to the next free number in that chapter (`--scene <n>` picks the number, and `--scene` alone reorders within the chapter) and adds its location and characters to the new chapter; give at least one of the two. `move` works only on chapters and scenes (use `rename` for other ids), never edits prose or outline beats that mention a chapter number, and reindexes. References are written before the files move, so rerun an interrupted move. See the `revision-continuity` skill for splits and merges
- `init --form <form>` records `form` in `story.md` (`novel`, `novella`, `novelette`, `short-story`, `flash`, `serial`, `picture-book`, `chapter-book`) and sets a default `target-words` when none is given; `validate` warns when `target-words` is outside the form's usual range and `report` shows the form
- `add matter` when the user wants a dedication, epigraph, copyright page, acknowledgments, author's note, about-the-author, or also-by page. Pages live in `matter/` (indexed in `matter/_index.md` by reindex) with `title`, `placement` (`front` or `back`), `order`, and `heading` (pass `--heading false` for a dedication or epigraph, or edit the scaffolded `heading:` key; never add a second one). Write the page text directly in the file; unwritten pages are left out of builds and `validate` warns about them. Never invent acknowledgments, biographical facts, or copyright details: ask the user for them. Matter pages that quote others' work (an epigraph, song lyrics) may record `permission` (`not-needed`, `pending`, `granted`, `public-domain`), `rights-holder`, and `credit`; `validate` warns when `permission: pending` remains on a complete story and when `granted` has no `rights-holder`. See the `editorial-review` skill
- `add research` when the story relies on a real-world fact: notes live in `research/` with `status` (`open`, `verified`, `disputed`), whole-citation `sources`, and `used-in` chapter ids, plus optional `--accuracy` (`must-be-accurate`, `blended`, `invented`), `--confidence` (`high`, `medium`, `low`), `--method` (`fact`, `interview`, `site-visit`, `expert-review`, `reading`), and repeatable `--risk` (`legal`, `medical`, `weapons`, `safety`, `cultural`, `defamation`, `technical`). `validate` warns when a final chapter relies on open or disputed research (invented notes never trigger this), and when a note with a `risk` is used in a final or complete chapter with no `reviewed-by`. See the `research` skill
- `export` only when the user asks for a combined manuscript at a specific path; it includes front and back matter
- `build` when the user asks to build the book artifact; supports markdown, EPUB, DOCX, Shunn, HTML, print, narration, metadata, Fountain, Twee, and ink outputs in `dist/`, with front and back matter. For EPUB, set `cover: path/to/cover.jpg` (inside the project) and `author` in `story.md` to embed a cover image and creator
- `build --format html` when the user wants a review or reading copy for people who never open a terminal: a single HTML file with a table of contents and a paragraph label on every paragraph, shown faintly in the margin as a link labelled `ch03-p12` (chapter 3, paragraph 12), that reviewers cite in notes. A label is the paragraph's position in that build, so any earlier edit renumbers it; add `--stamp <round or date>` so notes can name the build, and ask reviewers to quote each paragraph's first few words. `--note-url <url>` adds a Note link beside each label, prefilled with `title`, `anchor`, `build`, and `quote` query parameters for the `manuscript-note.yml` issue form. `templates/github/review-copy.yml` publishes it to GitHub Pages; see the `feedback-triage` skill
- `build --format print` for a print-ready interior: HTML with CSS paged media, trim size from `--trim` (`5x8`, `5.25x8`, `5.5x8.5`, `6x9`, `a5`; default `5.5x8.5`), mirrored margins with gutter, running heads (author on verso, chapter title on recto, blank on chapter openings), page numbers at the foot of chapter and back-matter pages, chapters on recto, a raised initial at each chapter opening, widow and orphan control, and a copyright page. Render it to PDF with a paged-media engine the user installs (Paged.js CLI `pagedjs-cli`, WeasyPrint, or Prince); the CLI does not bundle one. See the `publishing` skill
- `build --format narration` for an audiobook narration script: a pronunciation guide table from every `pronunciation` field, each chapter with an estimated finished runtime at the language's narration pace (155 words per minute in English), scene breaks as `[pause]`, and a total runtime. See the `adaptation` skill
- `build --format metadata` for a retailer metadata sheet from `story.md`: title, series, authors, ISBN, publisher, date, language, description with its character count against common limits (KDP 4,000), keywords, BISAC subjects, word count, estimated page count, AI disclosure, and a readiness checklist of missing fields. See the `publishing` skill
- `build --format twee` for a Twine story (Twee 3) of a branching book: one passage per chapter, named by its id, with a `[[text->chapter-NN]]` link for each entry in the chapter's `choices` frontmatter (`text` and `to`). The first chapter is the start; once any chapter has choices, a chapter without them is an ending, and with none anywhere each chapter links to the next. The IFID comes from `ifid` in `story.md`; without it the build derives one from the story id and warns with the `ifid:` line to add. It refuses to build while a choice is malformed or leads to a missing chapter; `story validate` and `story links` report the same problems, and `links` warns about chapters no choice path reaches. See the `adaptation` skill
- `build --format ink` for the same branching book as an ink story for Inky and inklecate: one knot per chapter (`chapter-03` becomes `chapter_03`), a sticky `+ [text] -> knot` choice for each entry in `choices`, `-> END` for a chapter without choices, the title, author, and IFID as global tags, and prose escaped so ink reads it as text. It shares the Twee build's rules, checks, and refusals. See the `adaptation` skill
- `build --format epub` also writes EPUB 3 accessibility metadata, language, semantic chapter and matter markup, and a landmarks nav, and uses the optional `story.md` publishing fields (`cover-alt`, `isbn`, `publisher`, `publication-date`, `description`, `subjects`, `language`, and `copyright`, which generates a copyright page when no copyright matter page exists)
- `build --format shunn` when the user wants Shunn manuscript-format markdown: title page, contact block, word count, chapter breaks, and double-spaced prose; `story build . --format docx --shunn` applies the same Shunn formatting to the DOCX output
- `knowledge` when the user asks what a character knew at a given chapter: `story knowledge <character-id> --at <chapter-id>`, marking each fact `reader-knowledge` or `character-knowledge` with `do not reveal`. Rules: `references/continuity-checks.md` (knowledge).
- `context` before drafting a chapter or scene: `story context <chapter-or-scene-id> [--budget <tokens>] [--scenes <n>]` prints what the target needs in priority order, leaving out later chapters. Rules: `references/continuity-checks.md` (context).
- `add clue` when the user plants a new clue: `story add clue "Name" --planted chapter-02 --payoff chapter-05`; omit `--payoff` when it is not yet known, and pass `--red-herring` for a clue meant to mislead. Rules: `references/continuity-checks.md` (add clue).
- `synopsis` when the user wants a mechanical synopsis: the first sentence of `story.md`'s `## Synopsis` section, then each arc's Setup, Rising Action, Climax, and Resolution. One page is 500 words and three pages is 1500. `story synopsis [--pages 1|3] [--out file]`. The output is a scaffold; the `submission` skill rewrites it into an agent-ready synopsis

## Project CLI Configuration

`story.md` may carry `cli-defaults` (default flags per command, such as `- command: build` with `format: html`) and `severity` (named warnings promoted with `level: error` or silenced with `level: off`, such as `- warning: todo-markers`). A flag on the command line always wins. Edit these fields only when the user asks for project-wide defaults or stricter checks, then run `story validate`: it rejects unknown commands, flags, warning codes, and levels, and while either field is invalid the other commands refuse to run. Every warning line ends with its code in brackets, such as `[todo-markers]`, which is the name a `severity` entry takes; an `error:` line ending in a code is a warning the project has promoted. Errors cannot be overridden. `docs/cli-reference.md` lists every code under Finding codes.

## Failure Handling

- Treat CLI errors as actionable maintenance findings.
- Read the exit code to decide what to do next: `1` means the check found `error:` findings to fix in the project; `2` means the command line was wrong (fix the command, not the project); `3` means the path is not a usable story project or a file it needs does not parse (repair that file, or point at the folder with `story.md`); `4` means a write was refused (the target exists, is project source, is locked by another story command, or is not writable), so resolve the conflict rather than forcing it.
- Fix broken references, missing required files, stale registries, or incorrect word counts when the requested task implies doing so.
- Do not overwrite creative prose or story content merely to satisfy a mechanical check.
- If a validation warning reflects intentional user data, report it rather than silently changing it.
- If a command stops with `Cannot reindex: fix these files first` (or `Cannot count words: ...`, `Cannot build: ...`), repair the frontmatter of each listed file, then rerun it. `rename`, `move`, and `remove` report `<file>: <error>; nothing was changed` for the same cause, and `<file> is missing YAML frontmatter; nothing was changed` when an entity file, a CLI registry (the `_index.md` in an entity folder, `matter/`, or `research/`), or fixed project file (`story.md`, `style-sheet.md`, `progress.md`, `plot/timeline.md`, `continuity/state.md`, `continuity/exemptions.md`) has none; plain skill notes such as `continuity/motifs.md`, or an `_index.md` in a folder of the user's own such as `notes/`, do not block them.
- A file-system failure reads `Cannot <open|list|check|replace|delete|write to> <path>: <reason>` (such as `permission denied`); fix the file or folder permissions, or the path, rather than the story content.
- If `story reindex` fails on a corrupt `plot/_index.md`, do not hand-edit story content to work around it: restore the index frontmatter from git, or delete `plot/_index.md` so reindex rebuilds it, then rerun.

## Shared Conventions

Every story skill follows the shared conventions in [`references/conventions.md`](references/conventions.md): kebab-case ids and filenames, YAML frontmatter on every story-project file, `_index.md` files as the authoritative registries, bidirectional links between entities, `characters` for who is on the page and `mentions` for who is only referred to, `status: deceased` plus `died-in: chapter-{NN}` for deaths, and no project-local generator or build scripts (run only the installed or bundled Story CLI). Other skills link to that file and repeat this summary, so update both together.

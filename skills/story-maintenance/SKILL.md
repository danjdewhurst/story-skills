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

After any change to story files, run the maintenance block, in this order:

```shell
story reindex .
story wordcount . --write
story check .
```

`reindex` rebuilds the registries, `wordcount --write` updates chapter counts (and reindexes again), and `check` then runs `validate`, `links`, and `continuity` over the settled files. `check` exits 1 only on errors; warnings print but do not fail it (`--strict` makes them fail). Every skill ends its edits with this block, followed by any skill-specific checks such as `story clues .` or `story pacing .`.

The full command set:

<!-- command-reference -->
```shell
story reindex .
story wordcount . --write
story check .
story check . --strict
story validate .
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
story snapshot draft-1 --path .
story snapshot --list --path .
story compare . --snapshot draft-1
story snapshot --restore draft-1 --dry-run --path .
story compare . --ref beta-round-1 --anchor ch03-p12
story similarity . --against ../book-one
story similarity . --snapshot draft-1
story series .
story import draft.md --title "Title"
story report .
story report . --actionable
story next .
story doctor .
story doctor . --fix --dry-run
story doctor . --fix
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
story move chapter chapter-04 --number 5 --dry-run
story move chapter chapter-04 --number 5
story move scene chapter-03-scene-02 --chapter chapter-05
story move scene chapter-03-scene-02 --scene 1
story split chapter-07 --at 2 --dry-run
story split chapter-07 --at "The ferry came at noon." --title "The Crossing"
story merge chapter-07 chapter-08
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

The check commands' detailed rules live in `references/continuity-checks.md`, one section per command. Read the matching section before explaining or acting on a finding. The editing commands' detail (`add`, `rename`, `move`, `remove`, `split`, `merge`) lives in `references/editing-commands.md`, and each build format's in `references/builds.md`.

Use:

- `check` at the end of an editing session, after `reindex` and `wordcount --write`, and before reporting the project clean: it runs `validate`, `links`, and `continuity` over one scan, lists each finding once, and exits 1 if any of them has an error (`--strict` also fails on warnings). Run the three separately when you want one check's findings
- `validate` after initialization and at the end of any multi-file edit
- `reindex` after adding, removing, renaming, or moving any entity file. It rebuilds the character, location, system, faction, artifact, arc, chapter, scene, question, promise, clue, and glossary registries. `story add` reindexes itself; a hand-written file does not
- `wordcount --write` after writing or revising chapters
- `links` after changing character relationships, notable locations, arc participants, or chapter references
- `continuity` after drafting or revising a chapter, and whenever the user asks about contradictions, dead characters appearing, unfired setups, or stale state. It checks deaths and revivals, promise, question, and clue ordering, Chekhov gaps, casts and `status: cut` characters, `continuity/state.md`, prop custody, and clock and route plausibility; intentional exceptions go in `continuity/exemptions.md`. In a book whose chapters carry `choices`, read Branching books there too. Rules: `references/continuity-checks.md` (continuity).
- `compare` after a revision pass, or when the user asks what changed since a draft: it needs exactly one of `--ref` (a git ref), `--against` (another copy of the project), or `--snapshot` (a snapshot saved with `story snapshot <name>`, for a project without git; `--list` shows them), and `--anchor <label>` maps review-copy paragraph labels to the current text. Rules: `references/continuity-checks.md` (compare).
- `snapshot --restore <name>` only when the user asks to go back to a snapshot. It deletes every project markdown file the snapshot lacks, so show them the `--dry-run` first and restore only with their approval. It saves the project as `before-restore-<id>-<n>` before changing anything and reindexes after; pass on the undo command it prints, then run `story validate`.
- `similarity` when the user asks whether a passage echoes another text too closely; it is advisory, so report what it found, never a verdict. `--against` takes a file, folder, or git ref, and `--snapshot` a saved snapshot. Rules: `references/continuity-checks.md` (similarity).
- `progress` when the user asks how far along the book is, whether they will make a deadline, or after a writing session: it reports words against `story.md` `target-words`, days left to `deadline` and words a day needed, chapter `target-words`, pace from `progress.md`, and, once a session is logged, today's words against `daily-target-words`, the current and longest streak (days outside `writing-days` never break it), and the words of the last four weeks (`--weeks <n>`, 1 to 52, for a longer or shorter history). For a serial with `release-every` and `release-start` in `story.md` (or a chapter `release-date`), `progress` and `next` print the next episode due, and warn `release-undrafted` when an episode due within three days, or past due, has no prose or no chapter yet; draft that episode first. Once `story.md` has `status: complete`, the cadence stops at the last chapter, so no episode past it is scheduled or warned about. `--log` records today's total there (`--date YYYY-MM-DD` to backfill); only log when the user keeps a log or asks for it
- `pacing` when the user asks about pacing, sagging middles, or chapter endings, and after drafting or restructuring chapters: per-chapter words, scene outcomes, sequels, and hooks, with warnings for runs and outliers. Rules: `references/continuity-checks.md` (pacing).
- `clues` for mysteries and any story with a clue ledger: a clue-by-chapter matrix with fair-play warnings. Rules: `references/continuity-checks.md` (clues).
- `voices` when dialogue voices may blur or during a line pass: per-character dialogue fingerprints, with warnings for look-alike voices and `voice-avoid`/`voice-words` misses. Rules: `references/continuity-checks.md` (voices).
- `list <kind>` when you need the files that match some frontmatter (the draft chapters, the scenes a character is in, the open questions) instead of reading every file: `story list chapters --where status=draft --where pov=ilse --path <project>`. `key=value` also matches a list that contains the value, `key!=value` is the opposite, `key` means set, and `'!key'` unset; repeated filters must all match. Add `--json` and read `data.items[].file`
- `--json` when you need to read a result rather than show it to the user: `validate`, `links`, `continuity`, `check`, `series`, `report`, `next`, `doctor`, `knowledge`, `context`, `list`, `progress`, `timeline`, `prose`, `pacing`, `clues`, `voices`, `similarity`, `names`, `mentions`, `compare`, `passes`, `diagram`, and `synopsis` then print one JSON object on stdout (`apiVersion`, `command`, `ok`, `data`, `diagnostics`, `writes`). `ok` is true exactly when the exit code is 0; each diagnostic has `severity`, `file`, `message`, `code` (the finding's rule, such as `stale-word-count`, the name a `story.md` `severity` entry takes), and `check` (the check that raised it). `report`, `next`, and `doctor` always have `ok: true`, so read their `data.checks` or error diagnostics instead (`doctor --fix` is the exception: its `ok` is false while a check still has an error, and `data.fix` lists the repairs it made)
- `passes` to track named revision passes in `story.md` `revision-passes`: `--init` writes the default ladder, `--start`/`--done <pass>` update one, and no flag prints the checklist. Rules: `references/continuity-checks.md` (passes).
- `names` before naming a character, place, faction, artifact, system, or glossary term: `story names <name...>` reports exact clashes as errors and look-alikes as warnings. Rules: `references/continuity-checks.md` (names).
- `mentions` before renaming or removing an entity, since neither changes prose: `story mentions <kind> <id> --path <project>` lists each place the chapter prose names it, with file and line, so you can update the text. With no entity it warns `named-not-listed` (prose names a character the chapter's `pov`, `characters`, and `mentions` leave out; `continuity` reports this too) and `mention-not-named` (a `mentions` entry the prose never names). Fix a true omission in the chapter frontmatter; when the chapter uses a name the bible lacks, add it to the entity's `aliases`; ask the user before dropping a mention. Rules: `references/continuity-checks.md` (mentions).
- `diagram` when the user wants a picture of the story's structure: `story diagram <kind>` prints Mermaid source generated from frontmatter, or writes it with `--out <file>` (`--path <project>` sets the project). Kinds: `relationships` (character graph, family edges styled distinctly: the family tree), `locations` (map-graph from location `routes`, edges labelled with hours), `timeline` (dated scenes and chapters in story-time order), `clues` (clue plant to reveal flow per chapter), and `arcs` (arcs to the chapters that advance them). GitHub, many editors, and mermaid.live render it; regenerate rather than hand-edit
- `timeline` when the user asks what happens when, how flashbacks sit against the main line, whose POV dominates, or where a character drops out. It is read-only; `continuity` owns clock errors. Rules: `references/continuity-checks.md` (timeline).
- `prose` when the user asks for a prose check or before sharing a draft: advisory per-chapter and manuscript-wide prose metrics against `style-sheet.md`. Rules: `references/continuity-checks.md` (prose).
- `series` when `story.md` has `follows` or `precedes` links to other books; it orders the linked sequels and prequels by chronology and checks shared canon (characters deceased in an earlier book, cast listings, facts relearned across books, dead characters learning facts, name and pronunciation drift, destroyed artifacts and their later use). Use `init --follows <path>` or `init --precedes <path>` to start a linked book, and see the `series-continuity` skill for carrying canon across
- `import` when the user has an existing manuscript or chapter drafts and wants a Story Skills project built from them; follow up by creating character and location files from the printed entity candidates, and by setting `form` and `target-words` in `story.md` (import refuses `--form`; without them `story validate` never checks length and `story progress` has no target). Directory sources import in natural file-name order (`chapter-2` before `chapter-10`). `import --force` into an existing directory deletes every `chapter-NN.md` in `chapters/` before writing the imported chapters, so confirm with the user before forcing an import over a project with drafted chapters
- `report` when the user asks for project status, inventory, progress, or a quick health summary
- `next` before a drafting session to identify the next deterministic action
- `doctor` when the user asks what is stale, broken, or inconsistent. `doctor --fix` applies only the mechanical repairs the checks call for (`migrate` for missing registries or an old `schema-version`, `wordcount --write` for stale counts, `reindex` for stale registries), never touches prose, then reports what remains; it exits 1 while any check still has an error. Use it to clear mechanical findings in one step, then work through the remaining actions yourself or with the user
- `migrate` when a project has an older schema version or missing v2 paths
- `--dry-run` on `add`, `rename`, `move`, `split`, `merge`, `remove`, `reindex`, `migrate`, `wordcount --write`, `doctor --fix`, `snapshot`, `passes`, `progress --log`, `diagram --out`, `synopsis --out`, `export`, `build`, `init`, or `import` before a change that touches many files, or when the user wants to see what a command will change first: it lists each file it would create, update, or delete and changes nothing (`--json` gives the list as `data.changes`). Show the user the list, then run the command without `--dry-run`
- `add`, `rename`, `move`, and `remove` for deterministic entity file operations when they fit the requested change. `add` takes ids, not names, for reference options, and ids stay ASCII kebab-case (`--id` sets one by hand). Rules: `references/editing-commands.md` (add, rename, and remove).
- `move` whenever a chapter's number or a scene's chapter or position changes, never a hand rename: chapter and scene ids encode their numbers. Rules: `references/editing-commands.md` (move).
- `split` and `merge` to split a chapter in two or join two neighbouring chapters, instead of moving prose and renumbering by hand. Run `--dry-run` first and show the user the list. Rules: `references/editing-commands.md` (split and merge).
- `init --form <form>` records `form` in `story.md` (`novel`, `novella`, `novelette`, `short-story`, `flash`, `serial`, `picture-book`, `chapter-book`) and sets a default `target-words` when none is given; `validate` warns when `target-words` is outside the form's usual range and `report` shows the form
- `add matter` when the user wants a dedication, epigraph, copyright page, acknowledgments, author's note, about-the-author, or also-by page. Never invent acknowledgments, biographical facts, or copyright details: ask the user for them. Rules: `references/editing-commands.md` (add matter).
- `add research` when the story relies on a real-world fact. Rules: `references/editing-commands.md` (add research).
- `export` only when the user asks for a combined manuscript at a specific path; it includes front and back matter
- `build` when the user asks to build the book artifact: markdown, EPUB, DOCX, Shunn, HTML, print, narration, metadata, Fountain, Twee, and ink outputs in `dist/`, and a codex site in `dist/codex/`, with front and back matter. Rules: `references/builds.md` (build).
- `build --format html` when the user wants a review or reading copy for people who never open a terminal. Rules: `references/builds.md` (html).
- `build --format print` for a print-ready interior; `--pdf` renders a PDF with an engine the user has installed. Rules: `references/builds.md` (print).
- `build --format narration` for an audiobook narration script, and `build --format metadata` for a retailer metadata sheet. Rules: `references/builds.md` (narration, metadata).
- `build --format twee` and `build --format ink` for a branching book. Rules: `references/builds.md` (twee, ink).
- `build --format codex` when the user wants a browsable story bible; add `--spoilers` only for the author's own copy. Rules: `references/builds.md` (codex).
- `build --format epub` and `build --format shunn` for an ebook or a Shunn manuscript. Rules: `references/builds.md` (epub, shunn).
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

---
name: story-maintenance
description: This skill should be used when the user asks to validate, reindex, repair registries, check links, check continuity, count words, summarize a story project, import an existing manuscript, export a manuscript, build a review copy or print interior, generate a diagram, check pacing, clues, voices, or names, track revision passes, run the story CLI, or perform deterministic maintenance on a Story Skills markdown project.
---

# Story Maintenance

## Overview

Run deterministic maintenance for Story Skills projects. Use the CLI for structure validation, registry rebuilds, word counts, link checks, continuity checks, project reports, next-action reports, pacing, clue, voice, and name checks, revision-pass tracking, Mermaid diagrams, schema migration, entity helpers, manuscript import, and manuscript export and builds. The creative skills still own story decisions; this skill handles mechanical consistency.

## CLI Access

Prefer the first available command:

1. `story <command>` - when the package bin is installed
2. `bun run story -- <command>` - when working from this repository
3. `node scripts/story.js <command>` - bundled fallback, resolving `scripts/story.js` relative to this skill folder

If none of these are available, perform the requested maintenance manually using the conventions in `story-init`.

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
story add research "Night shift on a cardiac ward" --method interview --accuracy must-be-accurate --confidence medium --risk medical
story add matter "Acknowledgments" --placement back
story rename character old-id "New Name"
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
story knowledge sera-voss --at chapter-04
story add clue "The silver locket" --planted chapter-02 --payoff chapter-05
story synopsis --pages 1
story synopsis --pages 3 --out dist/synopsis.md
```

Use:

- `validate` after initialization and at the end of any multi-file edit
- `reindex` after adding, removing, or renaming any entity file. It rebuilds the character, location, system, faction, artifact, arc, chapter, scene, question, promise, clue, and glossary registries. `story add` reindexes itself; a hand-written file does not
- `wordcount --write` after writing or revising chapters
- `links` after changing character relationships, notable locations, arc participants, or chapter references
- `continuity` after drafting or revising a chapter, and whenever the user asks about contradictions, dead characters appearing, unfired setups, or stale state; it deterministically checks `died-in` ordering, promise/question chapter ordering, Chekhov gaps, POV/cast consistency, and `continuity/state.md` references. It reuses the promise-ordering machinery for the clue ledger (`continuity/clues/`): payoff before plant is an error, and a completed story with planned or planted clues is an error. The Chekhov warning (a clue or promise planted three or more chapters ago) requires `status: planted`. `story add clue --planted` (and `story add promise --planted`) records the chapter and sets `status: planted`; without `--planted` the status is `planned`, and `--status` overrides either default. A promise or clue with `status: planned` and a `planted` chapter warns ("records planted chapter X but status is still planned") only once chapter X has prose, so `--status planned --planted chapter-NN` schedules a setup ahead. A recorded payoff chapter that is still ahead of the latest chapter suppresses the "no payoff yet" warning. `story links` accepts a scheduled `chapter-NN` that has no chapter file yet in `payoff`, and in `planted` while the status is `planned`, unless its number is 0 or belongs to an existing chapter under another id (`chapter-1` beside `chapter-01` is reported as missing); once the status is `planted` or `paid-off` the planted chapter must exist, and once `paid-off` the payoff chapter must too. It also checks prop custody — artifacts with `destroyed` or `lost` status must not be referenced after their destruction chapter (recorded in object-state `since: chapter-NN`; later scenes referencing them in `state-changes` or `mentions` are errors) — and clock/time plausibility when scenes or chapters carry `date: YYYY-MM-DD` / `time: HH:MM` frontmatter (time may be `dawn`, `morning`, `midday`, `afternoon`, `evening`, or `night`; scene `travel-hours: N` asserts the minimum time since the previous dated scene in chapter order; a character, by scene `characters` or `pov`, in two dated scenes at locations linked by location `routes`, with less story time between them than the fastest route, is an error. The route check reads scene `date`, `time`, and `location` only, not chapter dates; a named time is a span such as `morning` 05:00-11:59, an untimed scene spans its whole day, and only journeys impossible on every reading are reported). No dates means no time findings. Intentional exceptions go in `continuity/exemptions.md` (frontmatter `type: exemption-log`, entries with `pattern` + `reason`); exempted findings are reported as dismissed, not errors
- `compare` after a revision pass, or when the user asks what changed since a draft: `--ref` reads chapters at a git branch, tag, or commit with `git show` (it never writes to the repository), and `--against` reads another copy of the project. It reports per-chapter word changes, added and removed chapters, and the share of paragraphs unchanged. See Draft Snapshots in the `revision-continuity` skill for taking the snapshot
- `progress` when the user asks how far along the book is, whether they will make a deadline, or after a writing session: it reports words against `story.md` `target-words`, days left to `deadline` and words a day needed, chapter `target-words`, and pace from `progress.md`. `--log` records today's total there (`--date YYYY-MM-DD` to backfill); only log when the user keeps a log or asks for it
- `pacing` when the user asks about pacing, sagging middles, or chapter endings, and after drafting or restructuring chapters: per chapter it shows words, scene and sequel counts, scene `outcome`s (`yes`, `no`, `yes-but`, `no-and`), and the chapter `hook` (`cliffhanger`, `question`, `revelation`, `reversal`, `decision`, `emotional`, `resolution`). It warns about three or more consecutive `yes` outcomes, four or more scene units with no sequel, chapter length outliers (over 2x or under 0.5x the median once three chapters have prose), three or more consecutive chapters ending on `resolution`, and drafted chapters with no `hook`. See the `plot-structure` and `scene-craft` skills
- `clues` for mysteries and any story with a clue ledger: prints a clue-by-chapter matrix (`P` planted, `R` payoff, `x` both, `.` none; `~` after a clue name marks a red herring) and warns about a payoff with no plant, a late plant (same chapter as the payoff, or the one before), a clue with no `characters`, three or more genuine live clues (not red herrings) with none `significance-delayed`, and a `red-herring: true` clue with no `payoff`. See the `genre-craft` skill
- `voices` when dialogue voices may blur or during a line pass: attributes quoted lines (straight, curly, or British single quotes) to the character the narration names next to a speech verb (`"...," Mara said`, `said Mara`, `Mara asked`, aliases included; a name before the verb wins), or else to the only character the paragraph names (an action beat). Pronoun tags (`she said`) are never attributed, so a close-third POV character is often under-counted. It reports lines, words, mean sentence length, contraction, question, and exclamation rates, and signature words. It warns when a character says a `voice-avoid` word, when two characters with five or more lines have near-identical fingerprints ("X and Y may sound alike: ..."), and when a `voice-words` entry is never said. See the `voice-style` and `line-editing` skills
- `passes` to track named revision passes in `story.md` `revision-passes` (`{pass, status}`, status `pending`, `in-progress`, or `done`). `--init` writes the default ladder (`structure`, `character`, `theme`, `continuity`, `pacing`, `line`, `copyedit`, `proof`) and keeps existing entries; `--start <pass>` and `--done <pass>` update one; with no flag it prints the checklist and the checks each default pass runs. When the story `status` is `revising`, `next` recommends the next unfinished pass. See the `revision-continuity` skill
- `names` before naming a character, place, faction, artifact, system, or glossary term: `story names <name...>` checks candidates against every existing name and alias. A candidate's given name (first word that is not a title or article such as `the`, `lord`, or `captain`) is compared with each character's given name, and everything else as a whole name; an exact match with either is a clash, an error (exit 1). Look-alikes (the same first four letters, or the same initial within edit distance 1, or 2 when both words have five letters or more) and a given name sharing an initial with a protagonist, antagonist, deuteragonist, or narrator are warnings. Multi-word names are only checked for exact clashes, so pass a multi-word name's distinctive words separately. Pass `--path <project>` when not in the project root
- `diagram` when the user wants a picture of the story's structure: `story diagram <kind>` prints Mermaid source generated from frontmatter, or writes it with `--out <file>` (`--path <project>` sets the project). Kinds: `relationships` (character graph, family edges styled distinctly: the family tree), `locations` (map-graph from location `routes`, edges labelled with hours), `timeline` (dated scenes and chapters in story-time order), `clues` (clue plant to reveal flow per chapter), and `arcs` (arcs to the chapters that advance them). GitHub, many editors, and mermaid.live render it; regenerate rather than hand-edit
- `timeline` when the user asks what happens when, how flashbacks sit against the main line, whose POV dominates, or where a character drops out: it orders dated scenes (and chapters without scene records) by `date` and `time`, marks entries told after later events, lists undated scenes in reading order, totals chapters and words per POV, and reports each character's chapter presence, longest absence, and absence from the final chapters. It is read-only; `continuity` owns clock errors
- `prose` when the user asks for a prose check or before sharing a draft: per chapter it counts sentence length and spread, filter words and -ly adverbs per 1,000 narration words, plain and said-bookism dialogue tags, echoed words, watch words, and avoided spellings from `style-sheet.md` (`dialect`, `preferred`, `watch-words`, `allow-words`); across the manuscript it lists repeated 4-word phrases and similar character first names. Findings are advisory warnings and the command exits 0. See the `voice-style` skill for acting on them
- `series` when `story.md` has `follows` or `precedes` links to other books; it orders the linked sequels and prequels by chronology and checks shared canon (characters deceased in an earlier book, cast listings, facts relearned across books, name drift, destroyed artifacts). Use `init --follows <path>` or `init --precedes <path>` to start a linked book, and see the `series-continuity` skill for carrying canon across
- `import` when the user has an existing manuscript or chapter drafts and wants a Story Skills project built from them; follow up by creating character and location files from the printed entity candidates. Directory sources import in natural file-name order (`chapter-2` before `chapter-10`). `import --force` into an existing directory deletes every `chapter-NN.md` in `chapters/` before writing the imported chapters, so confirm with the user before forcing an import over a project with drafted chapters
- `report` when the user asks for project status, inventory, progress, or a quick health summary
- `next` before a drafting session to identify the next deterministic action
- `doctor` when the user asks what is stale, broken, or inconsistent
- `migrate` when a project has an older schema version or missing v2 paths
- `add`, `rename`, and `remove` for deterministic entity file operations when they fit the requested change. `remove chapter` refuses while scene files point at the chapter, so remove those scenes first; it walks back ledger statuses that relied on the chapter (planted to planned, paid-off to planted or planned, answered or resolved questions to open), so review the ledgers afterwards
- `init --form <form>` records `form` in `story.md` (`novel`, `novella`, `novelette`, `short-story`, `flash`, `serial`, `picture-book`, `chapter-book`) and sets a default `target-words` when none is given; `validate` warns when `target-words` is outside the form's usual range and `report` shows the form
- `add matter` when the user wants a dedication, epigraph, copyright page, acknowledgments, author's note, about-the-author, or also-by page. Pages live in `matter/` (indexed in `matter/_index.md` by reindex) with `title`, `placement` (`front` or `back`), `order`, and `heading` (set `heading: false` for a dedication or epigraph). Write the page text directly in the file; unwritten pages are left out of builds and `validate` warns about them. Never invent acknowledgments, biographical facts, or copyright details: ask the user for them. Matter pages that quote others' work (an epigraph, song lyrics) may record `permission` (`not-needed`, `pending`, `granted`, `public-domain`), `rights-holder`, and `credit`; `validate` warns when `permission: pending` remains on a complete story and when `granted` has no `rights-holder`. See the `editorial-review` skill
- `add research` when the story relies on a real-world fact: notes live in `research/` with `status` (`open`, `verified`, `disputed`), whole-citation `sources`, and `used-in` chapter ids, plus optional `--accuracy` (`must-be-accurate`, `blended`, `invented`), `--confidence` (`high`, `medium`, `low`), `--method` (`fact`, `interview`, `site-visit`, `expert-review`, `reading`), and repeatable `--risk` (`legal`, `medical`, `weapons`, `safety`, `cultural`, `defamation`, `technical`). `validate` warns when a final chapter relies on open or disputed research (invented notes never trigger this), and when a note with a `risk` is used in a final or complete chapter with no `reviewed-by`. See the `research` skill
- `export` only when the user asks for a combined manuscript at a specific path; it includes front and back matter
- `build` when the user asks to build the book artifact; supports markdown, EPUB, DOCX, Shunn, HTML, print, narration, and metadata outputs in `dist/`, with front and back matter. For EPUB, set `cover: path/to/cover.jpg` (inside the project) and `author` in `story.md` to embed a cover image and creator
- `build --format html` when the user wants a review or reading copy for people who never open a terminal: a single HTML file with a table of contents and a stable paragraph anchor on every paragraph, shown faintly in the margin as a link labelled `ch03-p12` (chapter 3, paragraph 12), that reviewers cite in notes. `templates/github/review-copy.yml` publishes it to GitHub Pages; see the `feedback-triage` skill
- `build --format print` for a print-ready interior: HTML with CSS paged media, trim size from `--trim` (`5x8`, `5.25x8`, `5.5x8.5`, `6x9`, `a5`; default `5.5x8.5`), mirrored margins with gutter, running heads (author on verso, chapter title on recto, blank on chapter openings), page numbers at the foot of chapter and back-matter pages, chapters on recto, a raised initial at each chapter opening, widow and orphan control, and a copyright page. Render it to PDF with a paged-media engine the user installs (Paged.js CLI `pagedjs-cli`, WeasyPrint, or Prince); the CLI does not bundle one. See the `publishing` skill
- `build --format narration` for an audiobook narration script: a pronunciation guide table from every `pronunciation` field, each chapter with an estimated finished runtime at 155 words per minute, scene breaks as `[pause]`, and a total runtime. See the `adaptation` skill
- `build --format metadata` for a retailer metadata sheet from `story.md`: title, series, authors, ISBN, publisher, date, language, description with its character count against common limits (KDP 4,000), keywords, BISAC subjects, word count, estimated page count, AI disclosure, and a readiness checklist of missing fields. See the `publishing` skill
- `build --format epub` also writes EPUB 3 accessibility metadata, language, semantic chapter and matter markup, and a landmarks nav, and uses the optional `story.md` publishing fields (`cover-alt`, `isbn`, `publisher`, `publication-date`, `description`, `subjects`, `language`, and `copyright`, which generates a copyright page when no copyright matter page exists)
- `build --format shunn` when the user wants Shunn manuscript-format markdown: title page, contact block, word count, chapter breaks, and double-spaced prose; `story build . --format docx --shunn` applies the same Shunn formatting to the DOCX output
- `knowledge` when the user asks what a character knew at a given chapter: `story knowledge <character-id> --at <chapter-id>` lists knowledge-state entries whose `learned-in` chapter is at or before that chapter, plus entries without `learned-in` as pre-existing knowledge
- `add clue` when the user plants a new clue: `story add clue "Name" --planted chapter-02 --payoff chapter-05` creates the clue ledger entity in `continuity/clues/` with `status: planted` (`planned` when `--planted` is omitted; pass `--status planned` if the clue is not on the page yet); omit `--payoff` when the payoff is not yet known, and pass `--red-herring` for a clue meant to mislead
- `synopsis` when the user wants a mechanical synopsis: the first sentence of `story.md`'s `## Synopsis` section, then each arc's Setup, Rising Action, Climax, and Resolution. One page is 500 words and three pages is 1500. `story synopsis [--pages 1|3] [--out file]`. The output is a scaffold; the `submission` skill rewrites it into an agent-ready synopsis

## Failure Handling

- Treat CLI errors as actionable maintenance findings.
- Fix broken references, missing required files, stale registries, or incorrect word counts when the requested task implies doing so.
- Do not overwrite creative prose or story content merely to satisfy a mechanical check.
- If a validation warning reflects intentional user data, report it rather than silently changing it.
- If a command stops with `Cannot reindex: fix these files first` (or `Cannot count words: ...`, `Cannot build: ...`), repair the frontmatter of each listed file, then rerun it. `rename` and `remove` report `<file>: <error>; nothing was changed` for the same cause, and `<file> is missing YAML frontmatter; nothing was changed` when an entity file or registry has none.
- If `story reindex` fails on a corrupt `plot/_index.md`, do not hand-edit story content to work around it: restore the index frontmatter from git, or delete `plot/_index.md` so reindex rebuilds it, then rerun.

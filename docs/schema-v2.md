# Story Skills Schema v2

Schema v2 keeps the markdown-first model and adds durable state for longer works. Every file remains plain markdown with YAML frontmatter. The CLI validates the mechanical contract; agents still own creative judgment.

## Required Layout

```text
story.md
characters/_index.md
worldbuilding/_index.md
worldbuilding/locations/
worldbuilding/systems/
worldbuilding/factions/
worldbuilding/artifacts/
plot/_index.md
plot/arcs/
plot/timeline.md
chapters/_index.md
scenes/_index.md
continuity/state.md
continuity/questions/_index.md
continuity/questions/
continuity/promises/_index.md
continuity/promises/
continuity/clues/_index.md
continuity/clues/
continuity/exemptions.md        # optional: decision log for dismissed findings
glossary/_index.md
glossary/terms/
style-sheet.md                  # optional: house style read by story prose
matter/                         # optional: front and back matter for export and build
research/                       # optional: research notes and their registry
```

## Core Rules

- `story.md` must include `schema-version: 2`.
- Entity filenames are kebab-case identifiers.
- Registries are deterministic and rebuilt with `story reindex .`.
- Chapter prose word counts are recalculated with `story wordcount . --write`. A word is a run of letters or digits in any script; straight or curly apostrophes and hyphens join a word, so `don’t` and `well-known` each count once.
- Frontmatter is machine-owned. Commands that change a value rewrite only the changed entries: comment lines, blank lines, unchanged entries (with their quoting and number formatting), and the body keep their original text. Files whose values do not change are left as they are.
- Cross-reference integrity is checked with `story links .`.
- Continuity contracts (deaths, promises/payoffs, questions, casts, durable state) are checked with `story continuity .`.
- Canon shared across linked sequels and prequels is checked with `story series .`.

## Entity Frontmatter

### Story

Required: `title`, `schema-version`, `genre`, `status`, `themes`, `pov`, `tense`.

Optional series fields link sequels, prequels, and companion books kept as separate projects:
- `series` - kebab-case series id, identical in every linked book
- `book-number` - positive integer publication order, unique across linked books (`story series` errors on duplicates)
- `follows` - list of paths, relative to this book's root, to books set earlier in the chronology
- `precedes` - list of paths to books set later in the chronology

Optional craft fields (hand-edit only — no CLI flags; edit `story.md` directly):

- `premise` - working controlling idea, one sentence of value + cause (e.g. "justice triumphs because the hero outsmarts the system"). Draft it early, audit it during revision.
- `counter-premise` - the antagonist's embodied counter-argument to the premise.
- `author` - author name, used on the Shunn title page by `story build --format shunn`.
- `contact` - contact block lines for the Shunn title page.
- `season-goal` - one-sentence season/volume goal for serial fiction (see the `genre-craft` skill).
- `target-words` - positive integer word-count target for MG/YA category contracts (see the `genre-craft` skill).
- `draft-mode` - `discovered` marks a discovery-drafted project; per-chapter `mode:` tracks mixed projects (see the `discovery-drafting` skill).
- `cover` - path, relative to the project root, to a `.jpg`, `.jpeg`, `.png`, `.gif`, or `.webp` cover image inside the project. `story validate` errors when the file is missing or outside the project; `story build --format epub` embeds it as the EPUB cover. `author` also becomes the EPUB `dc:creator`.

Every link needs a backlink: a book that `follows` another must appear in that book's `precedes`, and the reverse. `story links` checks that each path is a story project, has the backlink, and uses the same `series` id. `story series` orders the linked books by chronology and checks the canon they share. It errors when two linked books share a `book-number`, or when a character who is `deceased` in an earlier book is not deceased in a later one, or when a later book lists that character in a chapter or scene cast. It also errors when a later book has a character learn a `fact` (a `knowledge-state` entry with `learned-in`) that the same character already knows in an earlier book. It warns when a shared entity's name changes between books, or when an artifact destroyed in an earlier book has a different status in a later one. It also reports parse errors in linked books as errors.

### Characters

Required: `name`, `role`, `status`.

Optional lists: `aliases`, `relationships`, `locations`, `tags`.

Optional scalar: `died-in`, the chapter id in which the character dies on the page. Set it together with `status: deceased`; `story continuity` then errors on appearances in later chapters. Characters who died before chapter 1 should use `status: deceased` without `died-in`.

Optional freeform scalar: `arc`, a short theme label for the character's personal arc (e.g. `redemption`). It is not validated as an arc id, so it never triggers link errors; set it with `story add character --arc <theme>`.

`status: cut` keeps the file for a character removed in discovery drafting; the character stays out of canon but remains on record with a reason.

Optional arc-craft fields (hand-edit only — no CLI flags; edit the character file directly):

- `arc-type` - `change-positive` (lie → truth), `change-negative` (clings to the lie and spirals), or `flat` (holds their truth under pressure while the world changes; turning points are tests of steadfastness, not growth beats)
- `lie` - the character's false belief, generating flaw, fear, and wants
- `truth` - the belief that resolves the lie by the arc's end
- `ghost-wound` - the formative wound behind the lie

### Worldbuilding

Locations require `name` and `type`; they may list `region`, `population`, `controlled-by`, `notable-characters`, `tags`, and `status`. Systems require `name` and `type`; they may list `prevalence`.

Factions require `name`, `type`, and `status`; they may list `members`, `locations`, and `tags`.

Artifacts require `name`, `type`, and `status`; they may reference an `owner` character or faction and a `location`, and may list `tags`.

### Plot

Arcs require `name`, `type`, and `status`; they may list `characters`, `themes`, and `acts`.

Optional: `mice-threads`, the MICE threads the arc carries (`milieu`, `inquiry`, `character`, `event`). Each thread has its own start/end rule: a milieu thread ends when the character exits the place, an inquiry thread ends when the question is answered.

### Chapters And Scenes

Chapters require `title`, `number`, and `status`; they may list a `pov` character and a non-negative integer `word-count` maintained by `story wordcount --write`, plus optional reference lists `locations`, `characters`, `mentions`, and `arcs-advanced`.

Optional chapter fields:

- `mode` - `discovered` marks a discovery-drafted chapter; the reconciliation loop (extract entities → reverse-outline → diff vs bible → reconcile) is then a required step, not optional
- `date` - story date (`YYYY-MM-DD`); enables the clock/time checks in `story continuity`
- `time` - story time of day
- `episode-question` - the installment's dramatic question for serial fiction (see the `genre-craft` skill)
- `time-skip` - freeform `from → to` note recording a skipped interval (planning note; validated as a scalar, not checked by `story continuity`)

Scenes require `title`, `chapter`, `scene`, and `status`. Scenes carry machine-readable continuity fields: `pov`, `location`, `characters`, `mentions`, `arcs-advanced`, and `state-changes`.

Optional scene fields:

- `sequel` - `true` when the scene is a sequel unit (reaction → dilemma → decision) rather than a scene unit (goal → conflict → outcome)
- `dilemma` - the sequel unit's dilemma: the choice the POV character faces
- `date` - story date (`YYYY-MM-DD`)
- `time` - story time: `HH:MM` (24h) or `dawn`/`morning`/`midday`/`afternoon`/`evening`/`night`
- `travel-hours` - asserted travel time into this scene; `story continuity` errors when the timestamp allows less
- `flashback-to` - freeform note of the flashed-back moment (e.g. a date or `chapter-02`); validated as a scalar and preserved by the CLI, but continuity checks rely on `mentions`, not this field

`characters` means present in-scene. `mentions` means referenced, remembered, recorded, or seen in flashback; deceased characters may appear there without triggering continuity errors. `mentions` may also name artifacts, which the prop custody check reads; `story links` accepts character or artifact ids there.

### Continuity

`continuity/state.md` stores `current-chapter` (an integer, 0 or more), `character-state`, `object-state`, and `knowledge-state`.

State entries are lists of mappings checked by `story continuity`:

- `character-state` entries reference an existing `character` and optionally a `location`, plus free-form `physical`, `emotional`, and `knowledge` notes.
- `object-state` entries reference an existing `artifact`, an optional `owner` (character or faction), an optional `location`, and a `status` that must agree with the artifact file.
- `knowledge-state` entries reference an existing `character`, a non-empty `knows` fact, and an optional `learned-in` chapter id. An optional `fact` gives the knowledge a stable kebab-case id. A character may list each `fact` only once, and `story series` uses fact ids to match knowledge across books. An entry without `learned-in` means the character already knew it when the book began.

Questions require `title` and `status`; optional chapter references are `introduced` and `resolved`, plus an optional `characters` list. `status: abandoned` marks a thread cut in discovery drafting; abandoned questions, promises, and clues are skipped by continuity ordering checks.

Promises require `title` and `status`; optional chapter references are `planted` and `payoff`, plus optional `arcs` and `characters` lists. `story add promise` and `story add clue` default `status` to `planted` when `--planted` is given and to `planned` otherwise; pass `--status` to override.

Clues require `title` and `status`; optional chapter references are `planted` and `payoff`, plus optional `arcs` and `characters` lists. `significance-delayed: true` marks a clue whose meaning only lands later. `story continuity` reuses the promise-ordering machinery on clues: payoff before plant is an error, and a story marked `complete` with `planned` or `planted` clues is an error. The warning for a clue planted three or more chapters ago requires `status: planted`. `story add clue --planted` records the chapter and leaves `status: planned`, so set `status: planted` when the clue is on the page. Create them with `story add clue "Name" --planted chapter-02 --payoff chapter-05`.

`continuity/exemptions.md` is an optional decision log (frontmatter `type: exemption-log`). Each entry has a `pattern` (matched as a substring against finding text; minimum 4 non-blank characters so a 1–3 character pattern cannot blanket-exempt whole finding classes) and a `reason` recording why the finding is intentional. `story continuity` reports exempted findings as dismissed, not errors.

Prop custody: `object-state` entries for destroyed or lost artifacts should record `since: chapter-NN`, the chapter of destruction or loss. `story continuity` then errors when a later scene references the artifact in `state-changes` or lists it in `mentions`. Without `since`, custody cannot be checked and a warning is reported.

Clock and time: `story continuity` checks timestamps only when scenes or chapters carry `date` (and ideally `time`); with no dates there are no findings. Within a chapter, a scene timestamped earlier than the previous dated scene is a warning; a `travel-hours` assertion the timestamps cannot honor is an error; a higher-numbered chapter dated earlier than a lower-numbered one is a warning. Malformed dates or times are warnings, never crashes.

`story knowledge <character-id> --at <chapter-id>` answers what a character knew at a story point: `knowledge-state` entries for the character whose `learned-in` chapter is at or before the given chapter, plus entries without `learned-in` (pre-existing knowledge).

### Glossary

Glossary terms require `term` and `category`, plus optional `aliases`.

### Front And Back Matter

Files in `matter/` hold the pages around the chapters: dedication, epigraph, copyright page, acknowledgments, author's note, about the author, also-by. Create them with `story add matter "Dedication"` (front by default) or `story add matter "Acknowledgments" --placement back`.

- `title` (required) labels the page in the EPUB table of contents and, unless `heading: false`, is printed as its heading.
- `placement` (required) is `front` or `back`.
- `order` is a non-negative integer; pages sort by `order`, then by id. `story add matter` numbers new pages after the last one in their placement.
- `heading` defaults to `true`. Set `heading: false` for pages that print no title, such as a dedication or epigraph.

The body is the page text; a leading `# Heading` line is dropped, like a chapter's. `story export` and every `story build` format except Shunn place front matter after the book title and back matter after the last chapter. Shunn manuscripts are for submission and leave matter out. A matter file with no text is left out of export and build, and `story validate` warns about it.

### Research Notes

Files in `research/` record the real-world facts the story relies on. Create them with `story add research "Tidal bore timing" --source "..." --used-in chapter-03`; the first note creates `research/_index.md` (frontmatter `type: research-registry`), which `story reindex` keeps current once the folder exists.

- `title` (required).
- `status` (required) is `open`, `verified`, or `disputed`; `story add research` defaults to `open`.
- `sources` is a list of citations or URLs, kept whole (commas allowed). `--source` is repeatable.
- `used-in` lists the chapter ids that rely on the note. `story links` errors on missing chapters, and `story rename` and `story remove` keep the list current.

`story validate` warns when a `final` or `complete` chapter is in the `used-in` list of an `open` or `disputed` note, and when a `verified` note lists no sources. See the `research` skill.

### Style Sheet

`style-sheet.md` is optional. `story init` creates it, and `story validate` checks it when present:

- `type` must be `style-sheet`.
- `dialect` is `british`, `american`, or `unspecified`. British or American makes `story prose` flag the other dialect's common spellings (colour/color, grey/gray, defence/defense, travelled/traveled, and their inflections). -ise/-ize is not built in.
- `preferred` is a list of mappings, each with a non-empty `use` (the house form) and `avoid` (the form to flag); they must differ. A `preferred` entry naming either word of a built-in dialect pair replaces that pair.
- `watch-words` is a list of words or phrases `story prose` counts in every chapter.
- `allow-words` is a list of words `story prose` never flags as filter words, -ly adverbs, echoes, said-bookisms, or dialect spellings.

The body records the decisions a copyeditor tracks: voice, spelling and usage, capitalisation, hyphenation, numbers, dialogue punctuation, and one line per character voice linked to the character file. See the `voice-style` skill.

`story prose` is advisory: it reports counts per chapter and raises warnings for avoided spellings, filter words or -ly adverbs over 10 or 12 per 1,000 narration words (once a chapter has 300 narration words), three or more said-bookism tags in a chapter, uniform sentence lengths (spread under 5 words over 20 or more sentences), and similar character first names. It exits 0 unless a project file cannot be read.

## CLI Flag Values

`story add` validates `--role`, `--type`, `--status`, and `--category` against the same sets as `story validate` (see `src/story.js`). Accepted values:

- `--role` (character): `protagonist`, `antagonist`, `supporting`, `minor`, `narrator`, `deuteragonist`
- `--type` (faction): `family`, `guild`, `government`, `military`, `religion`, `company`, `community`, `criminal`, `other`
- `--type` (artifact): `object`, `weapon`, `document`, `technology`, `relic`, `symbol`, `resource`, `other`
- `--type` (arc): `main`, `subplot`, `character`, `thematic`
- `--type` (location, system): free-form text (defaults to `other` / `uncommon` prevalence for systems)
- `--status` (story): `planning`, `drafting`, `in-progress`, `revising`, `complete`, `abandoned`
- `--status` (character): `alive`, `deceased`, `unknown`, `missing`, `cut`
- `--status` (faction): `active`, `hidden`, `declining`, `defeated`, `disbanded`, `unknown`
- `--status` (artifact): `active`, `lost`, `destroyed`, `hidden`, `transferred`, `unknown`
- `--status` (arc): `planned`, `in-progress`, `resolved`
- `--status` (chapter, scene): `outline`, `draft`, `revised`, `final`, `complete`
- `--status` (question): `open`, `answered`, `resolved`, `dropped`, `abandoned`
- `--status` (promise, clue): `planned`, `planted`, `paid-off`, `dropped`, `abandoned`
- `--category` (term): `person`, `place`, `faction`, `artifact`, `concept`, `term`, `other`

`story init` accepts `--sub-genre <name>` and `--setting-era <name>` (free-form text, e.g. `--sub-genre coastal --setting-era near-future`). They are stored as `sub-genre` (default `general`) and `setting-era` (default `unspecified`) in `story.md` and shown in `story report` as `Genre: <genre> / <sub-genre>`.

## Migration

Run:

```shell
story migrate .
story reindex .
story validate .
```

Migration creates the v2 directories and registry files, upgrades `story.md` to `schema-version: 2`, and reindexes the project. It does not invent creative content.

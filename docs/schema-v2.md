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
- `form` - the story's form: `flash` (up to 1,500 words), `short-story` (1,000-7,500), `novelette` (7,500-17,500), `novella` (17,500-40,000), `novel` (40,000-200,000), `serial` (no range), `picture-book` (up to 1,000), or `chapter-book` (4,000-15,000). `story init --form <form>` records it with a default `target-words` (1,000, 5,000, 12,000, 30,000, 80,000, none, 500, and 10,000 respectively). `story validate` warns when `target-words` falls outside the form's range, and when a `complete` story's prose does; `story report` shows it.
- `target-words` - positive integer word-count target for the book (MG/YA category contracts rely on it; see the `genre-craft` skill). `story progress` and `story report` measure against it.
- `deadline` - due date as `YYYY-MM-DD`; `story progress` reports days left and the words a day needed.
- `draft-mode` - `discovered` marks a discovery-drafted project; per-chapter `mode:` tracks mixed projects (see the `discovery-drafting` skill).
- `revision-passes` - the named revision passes and their progress, a list of `{pass, status}` entries: `pass` is a kebab-case name, unique in the list, and `status` is `pending`, `in-progress`, or `done`. `story passes --init` writes the default ladder (`structure`, `character`, `theme`, `continuity`, `pacing`, `line`, `copyedit`, `proof`) after any passes already listed; `--start <pass>` and `--done <pass>` set one pass's status, adding it when it is new. Plain `story passes` prints the checklist with each default pass's focus and the commands it runs. While the story `status` is `revising`, `story next` recommends the pass in progress, or else the first pass not done, or `story passes --init` when none are recorded.
- `cover` - path, relative to the project root, to a `.jpg`, `.jpeg`, `.png`, `.gif`, or `.webp` cover image inside the project. `story validate` errors when the file is missing or outside the project; `story build --format epub` embeds it as the EPUB cover. `author` also becomes the EPUB `dc:creator`.

Optional publishing metadata (hand-edit; see the `publishing` skill), read by `story build`:

- `authors` - list of author names for a co-written book; builds use it in place of `author`, and `story validate` warns when both are set.
- `language` - BCP 47 language tag (`en`, `en-GB`, `fr`); default `en`. The EPUB package and every EPUB document declare it.
- `isbn` - ISBN-13 or ISBN-10, hyphens allowed; `story validate` checks the checksum. Quote an ISBN-10 that starts with 0, or YAML reads it as a number and drops the zero. The EPUB identifier becomes `urn:isbn:<digits>`. Use the ISBN of the edition being built.
- `publisher`, `publication-date` (`YYYY-MM-DD`), `description` (the retailer description) - written to the EPUB package.
- `keywords` - retailer search keywords; `story validate` warns over 7.
- `subjects` - BISAC subject codes such as `FIC022000`; written as EPUB subjects.
- `copyright` - the copyright line (`© 2026 Jane Doe`). Unless a matter page with id `copyright` or a title containing "Copyright" exists, every build except Shunn adds a copyright page as the first front matter: the line, "All rights reserved.", and the publisher, ISBN, and `ai-disclosure` when set.
- `cover-alt` - alt text for the EPUB cover image (default "Cover of <title>").
- `ai-disclosure` - a short statement of how AI tools were used, for retailer and agent disclosure forms.

EPUB builds also write EPUB Accessibility discovery metadata (access modes, features such as `tableOfContents` and `readingOrder`, no hazards, and a summary), mark each document with `epub:type` (`bodymatter chapter`, `frontmatter`, `backmatter`, `copyright-page`), and add a landmarks navigation list.

Every link needs a backlink: a book that `follows` another must appear in that book's `precedes`, and the reverse. `story links` checks that each path is a story project, has the backlink, and uses the same `series` id. `story series` orders the linked books by chronology and checks the canon they share. It errors when two linked books share a `book-number`, or when a character who is `deceased` in an earlier book is not deceased in a later one, or when a later book lists that character in a chapter or scene cast. It also errors when a later book has a character learn a `fact` (a `knowledge-state` entry with `learned-in`) that the same character already knows in an earlier book. It warns when a shared entity's name changes between books, or when an artifact destroyed in an earlier book has a different status in a later one. It also reports parse errors in linked books as errors.

### Characters

Required: `name`, `role`, `status`.

Optional lists: `aliases`, `relationships`, `locations`, `tags`.

Optional scalar: `died-in`, the chapter id in which the character dies on the page. Set it together with `status: deceased`; `story continuity` then errors on appearances in later chapters. Characters who died before chapter 1 should use `status: deceased` without `died-in`.

Optional freeform scalar: `arc`, a short theme label for the character's personal arc (e.g. `redemption`). It is not validated as an arc id, so it never triggers link errors; set it with `story add character --arc <theme>`.

Optional voice lists: `voice-words`, the words and phrases the character reaches for, and `voice-avoid`, the words they would never say. `story voices` reads both.

`status: cut` keeps the file for a character removed in discovery drafting; the character stays out of canon but remains on record with a reason.

Optional arc-craft fields (hand-edit only — no CLI flags; edit the character file directly):

- `arc-type` - `change-positive` (lie → truth), `change-negative` (clings to the lie and spirals), or `flat` (holds their truth under pressure while the world changes; turning points are tests of steadfastness, not growth beats)
- `lie` - the character's false belief, generating flaw, fear, and wants
- `truth` - the belief that resolves the lie by the arc's end
- `ghost-wound` - the formative wound behind the lie

### Worldbuilding

Locations require `name` and `type`; they may list `region`, `population`, `controlled-by`, `notable-characters`, `tags`, and `status`.

Locations may also list `routes`, the journeys to other locations: each entry has a `to` location id, `hours` (a positive number, the fastest the journey can be made), and an optional free-form `mode` (`cart`, `ferry`, `on foot`). A route is two-way unless the destination declares its own route back, which then sets the return time. `story links` checks each `to`, and `story rename` and `story remove` keep it current (removing a location drops the routes to it). `story diagram locations` draws the network. Systems require `name` and `type`; they may list `prevalence`.

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
- `target-words` - positive integer word target for the chapter; `story progress` reports each chapter against its target
- `time-skip` - freeform `from → to` note recording a skipped interval (planning note; validated as a scalar, not checked by `story continuity`)
- `hook` - how the chapter ending pulls the reader on: `cliffhanger`, `question`, `revelation`, `reversal`, `decision`, `emotional`, or `resolution`. Set it with `story add chapter --hook <name>`.

Scenes require `title`, `chapter`, `scene`, and `status`. Scenes carry machine-readable continuity fields: `pov`, `location`, `characters`, `mentions`, `arcs-advanced`, and `state-changes`.

Optional scene fields:

- `sequel` - `true` when the scene is a sequel unit (reaction → dilemma → decision) rather than a scene unit (goal → conflict → outcome)
- `dilemma` - the sequel unit's dilemma: the choice the POV character faces
- `outcome` - how a scene unit ends for the POV character's goal: `yes`, `no`, `yes-but` (they get it, at a cost), or `no-and` (they fail, and things get worse). Set it with `story add scene --outcome <name>`.
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

`red-herring: true` marks a clue planted to mislead; its `payoff` is the chapter that debunks it. `story add clue --red-herring` sets it.

`story clues` is the fair-play view of the clue registry: a grid of clues by chapter (`P` planted, `R` revealed, `x` both, `~` red herring), sorted by planting chapter. It warns, for clues that are `planned`, `planted`, or `paid-off`, when a clue is revealed but never planted, is planted in the same chapter as its reveal or the chapter before it, lists no `characters` who could notice it, or is a red herring with no `payoff`. It also warns when three or more genuine clues include none that is `significance-delayed`. Findings are advisory; the command exits 0 on a readable project.

`continuity/exemptions.md` is an optional decision log (frontmatter `type: exemption-log`). Each entry has a `pattern` (matched as a substring against finding text; minimum 4 non-blank characters so a 1–3 character pattern cannot blanket-exempt whole finding classes) and a `reason` recording why the finding is intentional. `story continuity` reports exempted findings as dismissed, not errors.

Prop custody: `object-state` entries for destroyed or lost artifacts should record `since: chapter-NN`, the chapter of destruction or loss. `story continuity` then errors when a later scene references the artifact in `state-changes` or lists it in `mentions`. Without `since`, custody cannot be checked and a warning is reported.

`story timeline` is the read-only view of the same fields: it orders dated scenes, and chapters without scene records, by `date` and `time` (a scene never inherits its chapter's date); marks entries read after events that happen later in story time; lists undated scenes in reading order; and reports POV balance by chapter words and each character's presence (chapter or scene `characters`, not `mentions`) with their longest absence.

`story pacing` is the read-only pacing dashboard: per chapter, prose words, scene units, sequel units, the count of each scene `outcome`, and the chapter `hook`, plus the median chapter length and the share of recorded outcomes that are setbacks (`no`, `yes-but`, `no-and`). It warns when a drafted chapter (`draft` or later) has no `hook`; when three or more scene units in a row, in reading order and skipping sequels, end in `yes`; when four or more scene units in a row have no sequel between them; when three or more chapters in a row end on `resolution`; and, once three chapters have prose, when a chapter is over twice or under half the median length. Findings are advisory; the command exits 0 on a readable project.

Clock and time: `story continuity` checks timestamps only when scenes or chapters carry `date` (and ideally `time`); with no dates there are no findings. Within a chapter, a scene timestamped earlier than the previous dated scene is a warning; a `travel-hours` assertion the timestamps cannot honor is an error; a higher-numbered chapter dated earlier than a lower-numbered one is a warning. Malformed dates or times are warnings, never crashes.

Route travel: when locations declare `routes`, `story continuity` follows each character (scene `characters` plus the scene `pov`) through their dated scenes in story-time order. When two consecutive sightings are at different locations joined by routes, the story time between them must be at least the fastest route, which may pass through other locations; otherwise it is an error. When either scene has no time of day, the gap is taken as the whole of both days, so only journeys that are impossible on any reading are reported.

`story knowledge <character-id> --at <chapter-id>` answers what a character knew at a story point: `knowledge-state` entries for the character whose `learned-in` chapter is at or before the given chapter, plus entries without `learned-in` (pre-existing knowledge).

### Diagrams

`story diagram <kind>` prints [Mermaid](https://mermaid.js.org) source built from frontmatter, or writes it with `--out` (for example `--out dist/family.mmd`). GitHub, most markdown editors, and mermaid.live render it. It reads the same fields the checks trust, so rebuild it after editing instead of hand-editing the output.

- `relationships` - every character, with one edge per related pair from `relationships`. Parent, grandparent, aunt, and uncle links are heavy arrows from the elder side; other family links (sibling, spouse, partner, cousin) are heavy lines; everything else is dotted. Deceased characters are drawn dashed. This is the family tree.
- `locations` - every location with its region, joined by `routes` labelled with hours and mode. A two-way route is a line; a pair that declares a route each way is two arrows.
- `timeline` - dated scenes and chapters in story-time order, grouped by day, noting entries told out of order (the same data as `story timeline`).
- `clues` - chapters in reading order with an arrow from each clue's planting chapter to its reveal; red herrings are dotted, and unrevealed clues point at a "not yet revealed" node. Dropped and abandoned clues are left out.
- `arcs` - each arc joined to the chapters whose chapter or scene `arcs-advanced` names it.

### Name Checks

`story names <name...>` checks candidate names before they are used, one name per argument (quote multi-word names). It compares each against character names, first names, and aliases (cut characters excepted), location, faction, artifact, and system names, and glossary terms and aliases, ignoring case, accents, and punctuation. A candidate, or its first word, equal to an existing name is a clash: an error, and the command exits 1. Warnings flag look-alikes (first words sharing their first four letters, or sharing an initial within an edit distance of 1, or 2 for words of five letters or more) and a shared initial with a protagonist, antagonist, deuteragonist, or narrator. Each name prints as `clear`, `check`, or `taken`.

### Glossary

Glossary terms require `term` and `category`, plus optional `aliases`.

### Front And Back Matter

Files in `matter/` hold the pages around the chapters: dedication, epigraph, copyright page, acknowledgments, author's note, about the author, also-by. Create them with `story add matter "Dedication"` (front by default) or `story add matter "Acknowledgments" --placement back`. `story reindex` keeps `matter/_index.md` (frontmatter `type: matter-registry`) current once the folder exists. File names must be kebab-case; builds refuse others because the id becomes an EPUB file name.

- `title` (required) labels the page in the EPUB table of contents and, unless `heading: false`, is printed as its heading.
- `placement` (required) is `front` or `back`.
- `order` is a non-negative integer; pages sort by `order`, then by id. `story add matter` numbers new pages after the last one in their placement.
- `heading` defaults to `true`. Set `heading: false` for pages that print no title, such as a dedication or epigraph.
- `permission` records the rights status of quoted material on the page (an epigraph, song lyrics, a poem): `not-needed`, `pending`, `granted`, or `public-domain`. `rights-holder` names who granted it and `credit` is the credit line the grant requires. `story validate` warns when permission is `pending` on a `complete` story, and when it is `granted` with no `rights-holder`. See the `editorial-review` skill.

The body is the page text; a leading `# Heading` line is dropped, like a chapter's. `story export` and every `story build` format except Shunn place front matter after the book title and back matter after the last chapter. Shunn manuscripts are for submission and leave matter out. A matter file with no text is left out of export and build, and `story validate` warns about it.

### Builds

`story build` writes a disposable artifact to `dist/<story-id>.<ext>` (or `--out`). Formats:

- `markdown` (default), `epub`, `docx`, and `shunn` (Shunn manuscript markdown; `--format docx --shunn` for Shunn DOCX).
- `html` - a single-file reading and review copy for people who never open a terminal. It has a contents list, and every paragraph carries a stable anchor shown beside it: `ch03-p12` is chapter 3, paragraph 12, and matter pages use their id (`front-dedication-p1`). Reviewers quote the anchor with each note, and `#ch03-p12` links straight to the paragraph. Scene breaks do not count as paragraphs.
- `print` - a print interior as HTML with CSS paged media, written to `dist/<story-id>.print.html`: a title page, the front matter with the copyright page before the contents, chapters opening on a recto with a raised initial, running heads (author on the verso, chapter title on the recto, blank on chapter openings), page numbers at the foot of chapter and back matter pages, justified text with widow and orphan control, and back matter. `--trim` sets the trim size: `5x8`, `5.25x8`, `5.5x8.5` (default), `6x9`, or `a5`. The inside margin grows with the estimated page count. Render it to PDF with a paged-media engine (`npx pagedjs-cli`, `weasyprint`, or `prince`); the CLI does not bundle one. Check the printer's current specifications for margins, bleed, and embedded fonts before upload.

- `narration` - an audiobook narration script, `dist/<story-id>.narration.md`: the estimated finished runtime at 155 words per minute, a pronunciation guide built from every `pronunciation` field, opening credits, each front matter page (except the copyright page), chapter, and back matter page with its own runtime estimate, scene breaks as `[pause]`, and closing credits. Emphasis stays marked so the narrator sees the stress. See the `adaptation` skill.

- `metadata` - a retailer metadata sheet, `dist/<story-id>.metadata.md`: a table of title, series, authors, ISBN, publisher, publication date, language, genre, form, word count, estimated print pages at 5.5x8.5 and 6x9, description length against a 4,000-character limit, keywords, BISAC subjects, copyright, cover, cover alt text, and AI disclosure (missing fields say so), the full description, and a readiness checklist. Retailer limits change, so check each retailer's current requirements before upload.

Characters, locations, factions, artifacts, and glossary terms may set `pronunciation`, a respelling such as `SHUR-sha`, for the narration guide; `story validate` checks it is text. Cut characters are left out of the guide.

### Research Notes

Files in `research/` record the real-world facts the story relies on. Create them with `story add research "Tidal bore timing" --source "..." --used-in chapter-03`; the first note creates `research/_index.md` (frontmatter `type: research-registry`), which `story reindex` keeps current once the folder exists.

- `title` (required).
- `status` (required) is `open`, `verified`, or `disputed`; `story add research` defaults to `open`.
- `sources` is a list of citations or URLs, kept whole (commas allowed). `--source` is repeatable.
- `used-in` lists the chapter ids that rely on the note. `story links` errors on missing chapters, and `story rename` and `story remove` keep the list current.

- `accuracy` is `must-be-accurate` (a knowledgeable reader will check it), `blended` (real facts bent on purpose, with the departure recorded under `## Story Use`), or `invented` (made up for the story).
- `confidence` is `high`, `medium`, or `low`.
- `method` is how the knowledge was gathered: `fact` (desk research), `interview`, `site-visit`, `expert-review`, or `reading`.
- `risk` lists the areas where getting it wrong could hurt a reader or the author: `legal`, `medical`, `weapons`, `safety`, `cultural`, `defamation`, `technical`.
- `reviewed-by` lists the qualified people, by name or role, who checked the note.

`story add research` accepts `--accuracy`, `--confidence`, `--method`, and a repeatable `--risk`.

`story validate` warns when a `final` or `complete` chapter is in the `used-in` list of an `open` or `disputed` note, when a `verified` note lists no sources, and when a note with any `risk` has no `reviewed-by` while a `final` or `complete` chapter relies on it. Notes with `accuracy: invented` need no sources and never raise the open-research warning. See the `research` skill.

### Progress Log

`progress.md` is optional and written by `story progress --log`: frontmatter `type: progress-log` and `sessions`, a list of `{date, words}` entries (one per day, `YYYY-MM-DD`, non-negative integer word count of the whole manuscript). Logging again on the same date replaces that day's entry; other frontmatter and the body are preserved. `--date` sets the session date, which defaults to today.

`story progress` reports words against `target-words`, the words remaining, days left to `deadline` and the words a day needed, chapters against their `target-words`, words since the last logged session, pace per day across the last seven sessions, and a projected finish date at that pace. `story validate` checks the `deadline` date, chapter `target-words`, and each session entry.

### Style Sheet

`style-sheet.md` is optional. `story init` creates it, and `story validate` checks it when present:

- `type` must be `style-sheet`.
- `dialect` is `british`, `american`, or `unspecified`. British or American makes `story prose` flag the other dialect's common spellings (colour/color, grey/gray, defence/defense, travelled/traveled, and their inflections). -ise/-ize is not built in.
- `preferred` is a list of mappings, each with a non-empty `use` (the house form) and `avoid` (the form to flag); they must differ. A `preferred` entry naming either word of a built-in dialect pair replaces that pair.
- `watch-words` is a list of words or phrases `story prose` counts in every chapter.
- `allow-words` is a list of words `story prose` never flags as filter words, -ly adverbs, echoes, said-bookisms, or dialect spellings.

The body records the decisions a copyeditor tracks: voice, spelling and usage, capitalisation, hyphenation, numbers, dialogue punctuation, and one line per character voice linked to the character file. See the `voice-style` skill.

`story prose` is advisory: it reports counts per chapter and raises warnings for avoided spellings, filter words or -ly adverbs over 10 or 12 per 1,000 narration words (once a chapter has 300 narration words), three or more said-bookism tags in a chapter, uniform sentence lengths (spread under 5 words over 20 or more sentences), and similar character first names. It exits 0 unless a project file cannot be read.

### Dialogue Voices

`story voices` fingerprints each character's dialogue. A quoted line is attributed when the paragraph's narration names the speaker next to a speech verb (`"...," Mara said`, `said Mara`, `Mara asked`) by full name, first name, or alias; otherwise, when the narration names exactly one character (an action beat), the line is theirs. Any other quoted line is counted as unattributed and never guessed. Cut characters are skipped.

For each speaking character it reports lines, words, mean sentence length, contractions per 100 words, the share of sentences that are questions and exclamations, and up to five signature words: words of four or more letters, used at least twice, and used more than twice as often per word spoken as in everyone else's dialogue. It warns when a character says a `voice-avoid` word; when a character with five or more lines never says one of their `voice-words`; and when two characters with five or more lines each have sentence lengths within 1.5 words, contraction rates within 1.5 per 100 words, and question and exclamation shares within 10 points ("may sound alike"). Findings are advisory; the command exits 0 on a readable project.

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

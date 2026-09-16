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
glossary/_index.md
glossary/terms/
```

## Core Rules

- `story.md` must include `schema-version: 2`.
- Entity filenames are kebab-case identifiers.
- Registries are deterministic and rebuilt with `story reindex .`.
- Chapter prose word counts are recalculated with `story wordcount . --write`. A word is a run of letters or digits in any script; straight or curly apostrophes and hyphens join a word, so `don’t` and `well-known` each count once.
- Frontmatter is machine-owned. Commands that change a value regenerate that file's frontmatter, which drops YAML comments; files whose values do not change are left as they are.
- Cross-reference integrity is checked with `story links .`.
- Continuity contracts (deaths, promises/payoffs, questions, casts, durable state) are checked with `story continuity .`.
- Canon shared across linked sequels and prequels is checked with `story series .`.

## Entity Frontmatter

### Story

Required: `title`, `schema-version`, `genre`, `status`, `themes`, `pov`, `tense`.

Optional series fields link sequels, prequels, and companion books kept as separate projects:

- `series` - kebab-case series id, identical in every linked book
- `book-number` - positive integer publication order
- `follows` - list of paths, relative to this book's root, to books set earlier in the chronology
- `precedes` - list of paths to books set later in the chronology

Every link needs a backlink: a book that `follows` another must appear in that book's `precedes`, and the reverse. `story links` checks that each path is a story project, has the backlink, and uses the same `series` id. `story series` orders the linked books by chronology and checks the canon they share. It errors when a character who is `deceased` in an earlier book is not deceased in a later one, or when a later book lists that character in a chapter or scene cast. It also errors when a later book has a character learn a `fact` (a `knowledge-state` entry with `learned-in`) that the same character already knows in an earlier book. It warns when a shared entity's name changes between books, or when an artifact destroyed in an earlier book has a different status in a later one.

### Characters

Required: `name`, `role`, `status`.

Optional lists: `aliases`, `relationships`, `locations`, `tags`.

Optional scalar: `died-in`, the chapter id in which the character dies on the page. Set it together with `status: deceased`; `story continuity` then errors on appearances in later chapters. Characters who died before chapter 1 should use `status: deceased` without `died-in`.

Optional freeform scalar: `arc`, a short theme label for the character's personal arc (e.g. `redemption`). It is not validated as an arc id, so it never triggers link errors; set it with `story add character --arc <theme>`.

### Worldbuilding

Locations require `name` and `type`; they may list `region`, `population`, `controlled-by`, `notable-characters`, `tags`, and `status`. Systems require `name` and `type`; they may list `prevalence`.

Factions require `name`, `type`, and `status`; they may list `members`, `locations`, and `tags`.

Artifacts require `name`, `type`, and `status`; they may reference an `owner` character or faction and a `location`, and may list `tags`.

### Plot

Arcs require `name`, `type`, and `status`; they may list `characters`, `themes`, and `acts`.

### Chapters And Scenes

Chapters require `title`, `number`, and `status`; they may list a `pov` character and a `word-count` maintained by `story wordcount --write`, plus optional reference lists `locations`, `characters`, `mentions`, and `arcs-advanced`.

Scenes require `title`, `chapter`, `scene`, and `status`. Scenes carry machine-readable continuity fields: `pov`, `location`, `characters`, `mentions`, `arcs-advanced`, and `state-changes`.

`characters` means present in-scene. `mentions` means referenced, remembered, recorded, or seen in flashback; deceased characters may appear there without triggering continuity errors.

### Continuity

`continuity/state.md` stores `current-chapter`, `character-state`, `object-state`, and `knowledge-state`.

State entries are lists of mappings checked by `story continuity`:

- `character-state` entries reference an existing `character` and optionally a `location`, plus free-form `physical`, `emotional`, and `knowledge` notes.
- `object-state` entries reference an existing `artifact`, an optional `owner` (character or faction), an optional `location`, and a `status` that must agree with the artifact file.
- `knowledge-state` entries reference an existing `character`, a non-empty `knows` fact, and an optional `learned-in` chapter id. An optional `fact` gives the knowledge a stable kebab-case id. A character may list each `fact` only once, and `story series` uses fact ids to match knowledge across books. An entry without `learned-in` means the character already knew it when the book began.

Questions require `title` and `status`; optional chapter references are `introduced` and `resolved`, plus an optional `characters` list.

Promises require `title` and `status`; optional chapter references are `planted` and `payoff`, plus optional `arcs` and `characters` lists.

### Glossary

Glossary terms require `term` and `category`, plus optional `aliases`.

## Migration

Run:

```shell
story migrate .
story reindex .
story validate .
```

Migration creates the v2 directories and registry files, upgrades `story.md` to `schema-version: 2`, and reindexes the project. It does not invent creative content.

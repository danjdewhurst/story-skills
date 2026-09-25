# Project format reference

This page is the file-format contract for a Story Skills project (schema v2): every file and directory, every frontmatter field the tools read, how registries and cross-references work, and how to upgrade an older project. Use it when you hand-edit project files, write tooling against them, or need to know exactly what `story validate`, `story links`, and `story continuity` enforce.

For the ideas behind the format, read [Core concepts](concepts.md). For command syntax, read the [CLI reference](cli-reference.md).

**On this page**

- [Principles](#principles)
- [Project layout](#project-layout)
- [Identifiers and filenames](#identifiers-and-filenames)
- [Frontmatter syntax](#frontmatter-syntax)
- [Markdown bodies and word counts](#markdown-bodies-and-word-counts)
- [Story file](#story-file)
- [Characters](#characters)
- [Worldbuilding](#worldbuilding)
- [Plot](#plot)
- [Chapters](#chapters)
- [Scenes](#scenes)
- [Continuity](#continuity)
- [Glossary](#glossary)
- [Optional files](#optional-files)
- [Registries](#registries)
- [References and backlinks](#references-and-backlinks)
- [Dates and times](#dates-and-times)
- [Analysis views](#analysis-views)
- [Allowed values](#allowed-values)
- [Scanning limits and safety](#scanning-limits-and-safety)
- [JSON schema](#json-schema)
- [Migrating older projects](#migrating-older-projects)

## Principles

- **Plain markdown.** Every file is markdown with a YAML frontmatter block. There is no database and no generated story content. Git, any editor, and any agent can read the project.
- **One entity per file.** Each character, location, chapter, scene, and so on is its own file. The filename (without `.md`) is the entity's id.
- **Frontmatter is the machine layer; the body is for people.** The CLI reads and checks frontmatter. Bodies hold prose and notes, and the CLI reads only a few named sections.
- **Registries are generated.** Each directory's `_index.md` table is rebuilt from the entity files with `story reindex`. Do not maintain registry rows by hand.
- **`story.md` marks the project root.** Every command except `init` and `import` expects it directly inside the project path (the current directory, a `[path]` argument, or `--path`); the CLI does not search parent directories. It must declare `schema-version: 2`.

## Project layout

A full project looks like this. Only the files in the [required-paths table](#required-paths) below must exist; entity folders, entity files, `dist/`, and paths marked optional can be absent. A missing required path makes `story validate` report `Missing required path`.

```text
story.md                          story bible and project metadata
style-sheet.md                    optional: house style, read by story prose
progress.md                       optional: word-count session log
characters/
  _index.md                       character registry
  <character-id>.md
worldbuilding/
  _index.md                       world registry
  locations/<location-id>.md
  systems/<system-id>.md
  factions/<faction-id>.md
  artifacts/<artifact-id>.md
plot/
  _index.md                       plot registry
  timeline.md                     story timeline
  arcs/<arc-id>.md
chapters/
  _index.md                       chapter registry
  chapter-01.md
scenes/
  _index.md                       scene registry
  chapter-01-scene-01.md
continuity/
  state.md                        durable character, object, and knowledge state
  exemptions.md                   optional: dismissed continuity findings
  motifs.md                       optional: skill-owned, not read by the CLI
  theme-audit.md                  optional: skill-owned, not read by the CLI
  questions/_index.md
  questions/<question-id>.md
  promises/_index.md
  promises/<promise-id>.md
  clues/_index.md
  clues/<clue-id>.md
glossary/
  _index.md                       glossary registry
  terms/<term-id>.md
matter/                           optional: front and back matter
  _index.md
  <matter-id>.md
research/                         optional: research notes
  _index.md
  <research-id>.md
feedback/round-<N>/*.md           optional: skill-owned, not read by the CLI
feedback/briefs/*.md              optional: skill-owned, not read by the CLI
submission/*.md                   optional: skill-owned, not read by the CLI
publishing/*.md                   optional: skill-owned, not read by the CLI
adaptations/                      optional: skill-owned, not read by the CLI
dist/                             optional: disposable output of story build
.github/                          optional: copied GitHub templates, not read by the CLI
```

`story init` creates every directory and registry above except `matter/`, `research/`, `feedback/`, `submission/`, `publishing/`, `adaptations/`, and `.github/`, plus `story.md`, `style-sheet.md`, `plot/timeline.md`, and `continuity/state.md`. It creates no entity files, and none of `progress.md`, `continuity/exemptions.md`, `continuity/motifs.md`, `continuity/theme-audit.md`, or `dist/`.

`story export` writes `dist/manuscript.md` by default. Like everything in `dist/`, it is disposable output, not part of the project.

### Required paths

`story validate` requires these files:

| Required file | Kind |
|---------------|------|
| `story.md` | project metadata |
| `characters/_index.md`, `worldbuilding/_index.md`, `plot/_index.md`, `chapters/_index.md`, `scenes/_index.md`, `glossary/_index.md` | registries |
| `continuity/questions/_index.md`, `continuity/promises/_index.md`, `continuity/clues/_index.md` | registries |
| `plot/timeline.md` | story timeline |
| `continuity/state.md` | continuity state |

Entity folders such as `worldbuilding/locations/`, `plot/arcs/`, and `glossary/terms/` are not required. Git does not track empty folders, so a fresh clone of a new project lacks them and still validates; `story add` creates a folder when it writes the first entity into it.

### Files the tools ignore

The CLI reads only the files described on this page. Two kinds of extra file produce a warning from `story validate`:

- A `.md` file at the project root other than `story.md`, `style-sheet.md`, and `progress.md`. This includes a `README.md`, and a `manuscript.md` written there with `story export --out manuscript.md`; the default export path, `dist/manuscript.md`, avoids the warning.
- A `.md` file in a subdirectory of an entity directory, such as `characters/minor/old-nell.md`. Entity directories are flat.

```text
warning: notes.md is not part of the story project model and is ignored
warning: characters/minor/old-nell.md is nested inside an entity directory and is ignored
```

Some skills keep their own working files in the project. The CLI ignores these without a warning:

- `continuity/motifs.md` and `continuity/theme-audit.md`, written by the [theme-craft skill](../skills/theme-craft/SKILL.md)
- `feedback/round-<N>/`, written by the [feedback-triage skill](../skills/feedback-triage/SKILL.md), and `feedback/briefs/`, where the [editorial-review skill](../skills/editorial-review/SKILL.md) saves sensitivity-reader briefs
- `submission/`, written by the [submission skill](../skills/submission/SKILL.md)
- `publishing/`, where the [publishing skill](../skills/publishing/SKILL.md) keeps `launch-plan.md`, `retailer-copy.md`, `rights.md`, and `one-sheet-<right>.md`
- `adaptations/`, where the [adaptation skill](../skills/adaptation/SKILL.md) keeps audiobook, screenplay, picture-book, comics, and interactive-fiction working files (`adaptations/audiobook/`, `adaptations/screenplay/`, and so on). Screenplay and interactive sources use their own extensions (`.fountain`, `.ink`, `.twee`).

Any other directory that is not an entity directory (for example `notes/` or `images/`) is ignored without a warning too. So is `.github/`, where you copy the workflows and the `ISSUE_TEMPLATE/manuscript-note.yml` issue form from [`templates/github/`](../templates/github/); recursive scans skip every directory whose name starts with `.`. [Automation](automation.md) covers those templates.

## Identifiers and filenames

An entity's id is its filename without `.md`. Frontmatter never carries a separate `id` field. Ids must be kebab-case: lowercase ASCII letters and digits in groups joined by single hyphens (`sera-voss`, `chapter-03`, `ember-magic`). `story validate` reports `filename id must be kebab-case` otherwise.

When `story add` or `story init` derives an id from a name, it:

1. strips accents (`Élan` becomes `elan`),
2. drops straight and curly apostrophes (`Sera's Reclamation` becomes `seras-reclamation`),
3. lowercases, and
4. replaces every run of other characters with one hyphen and trims hyphens from the ends.

The story id is derived the same way from the `title` in `story.md` (`The Last Ember` becomes `the-last-ember`), or from the project directory name when the title has no ASCII letters or digits. Registries and state files record it in their `story` field.

Chapters and scenes use fixed filename patterns instead of names:

| Entity | Filename | Rule |
|--------|----------|------|
| Chapter | `chapter-{NN}.md` | `NN` is the chapter number. `story add chapter` pads it to two digits (`chapter-07.md`); larger numbers grow (`chapter-112.md`). Frontmatter `number` must equal the filename number. |
| Scene | `{chapter-id}-scene-{NN}.md` | For example `chapter-03-scene-02.md`. `story add scene` pads `NN` to two digits. Frontmatter `chapter` and `scene` must equal the filename parts. |

Because chapter and scene ids come from their numbers, `story rename chapter` and `story rename scene` change only the `title`; the id and filename stay the same. Renaming any other entity derives a new id from the new name and renames the file.

## Frontmatter syntax

Every entity file, registry, and state file starts with a frontmatter block between two `---` lines. A file without one fails with `is missing YAML frontmatter`. A UTF-8 byte order mark and Windows line endings are accepted.

The CLI uses its own YAML parser, which supports a deliberate subset of YAML:

| Construct | Example | Parsed as |
|-----------|---------|-----------|
| Plain scalar | `status: draft` | the string `draft` |
| Integer | `number: 3`, `number: 007` | the number `3`, `7` |
| Decimal | `travel-hours: 1.5` | the number `1.5` |
| Boolean | `sequel: true` | `true` or `false` |
| Double-quoted string | `title: "Dawn: Part One"` | JSON-unescaped string |
| Single-quoted string | `title: 'Night'` | the text between the quotes |
| Empty value | `payoff:` or `payoff: ""` | an empty string |
| Empty list | `tags: []` | an empty list |
| Block list | `themes:` then `  - loyalty` | a list of scalars |
| List of mappings | `relationships:` then `  - character: kael-voss` and `    type: sibling` | a list of objects |
| Comment line | `# note` on its own line | ignored |

Keep to these rules, because anything else is either an error or parses differently from standard YAML:

- Keys contain only letters, digits, `_`, and `-`. A duplicate key is an error.
- List items are indented exactly two spaces (`  - item`). Mapping keys inside a list item are indented exactly four spaces. Deeper nesting, four-space list items, and block scalars (`>` or `|`) fail with `Unsupported frontmatter line`.
- Flow lists are not parsed: `themes: [a, b]` is stored as the single string `[a, b]`, and a field that must be a list then fails validation. Always use block lists.
- A list item that starts with a key-like word followed by a colon is read as a mapping. `  - https://example.com/tides` becomes `{https: //example.com/tides}` and fails as a list of strings. Quote such items: `  - "https://example.com/tides"`. (`story add research --source` quotes them for you.)
- `#` starts a comment only at the beginning of a line. `title: Ash # draft` keeps `# draft` as part of the title. A comment line or a blank line inside a list is an error: the next item fails with `Unsupported frontmatter line`. Keep comments and blank lines between top-level entries.
- Single-quoted strings are taken literally: `'it''s'` stays `it''s`. Use double quotes when you need escapes.
- `null` and `~` are plain strings, not null.
- Dates such as `2026-09-24` stay strings.

Fields the tools do not know are kept and ignored. The example character files carry an `age` field, for instance. Add your own fields freely, but stay within the syntax above.

### How the CLI rewrites frontmatter

Several commands edit frontmatter in place: `story wordcount --write`, `story add` (for backlinks), `story rename`, `story remove`, `story reindex` (for the `story` field), `story migrate`, `story progress --log` (which rewrites `progress.md`), `story passes` with `--init`, `--start`, or `--done` (which rewrites `revision-passes` in `story.md`), and `story init --follows` or `--precedes` (which adds the backlink to the linked book's `story.md`). They rewrite only the entries whose values changed:

- Comment lines, blank lines, unchanged entries (with their original quoting and number formatting), and unchanged list items keep their exact text.
- The body is untouched, except that `story rename` updates links to a renamed file.
- A file whose content does not change is not written at all.

When the CLI writes a new value, it double-quotes strings that would otherwise be misread: empty strings, strings that look like numbers, booleans, `null`, or `[]`, strings with leading or trailing spaces, and strings containing `:`, `#`, a quote, or a newline.

## Markdown bodies and word counts

The body is free markdown. Starter files from `story init` and `story add` contain headed sections as prompts; you can rewrite them. The CLI reads only these parts of bodies:

| File | What the CLI reads |
|------|--------------------|
| `chapters/*.md` | The chapter prose, for word counts, export, build, and prose checks (rules below) |
| `matter/*.md` | The page text, found the same way as chapter prose |
| `story.md` | The first sentence of `## Synopsis`, used as the premise by `story synopsis` |
| `plot/arcs/*.md` | `## Setup`, `## Rising Action`, `## Climax`, and `## Resolution`, used by `story synopsis`; also every `chapter-NN` token and `.md` link, checked by `story links` |
| `plot/timeline.md` | Every `chapter-NN` token and `.md` link, checked by `story links` |
| Registries | The preserved hand-written sections listed under [Registries](#registries) |

Section lookups match a `## Heading` line without regard to case and run to the next `##` heading.

### Where chapter prose starts

`story wordcount`, `story export`, `story build`, and `story prose` all find the prose in a chapter body the same way:

1. If the body has a `## Chapter Text` heading, the prose is everything after it.
2. Otherwise, if it has a `## Outline` heading, the prose is everything after the first `---` line that follows the outline. With no such divider, everything after the `## Outline` heading counts.
3. Otherwise the prose is the whole body, minus a leading `# Heading` line.

The chapter starter file from `story add chapter` uses the first layout:

```markdown
# Chapter 1: The First Frost

## Outline

1. Opening beat
2. Escalation
3. Turn or decision

---

## Chapter Text

```

### How words are counted

A word is a run of letters or digits in any script. Straight or curly apostrophes and hyphens join a word, so `don’t` and `well-known` each count once; `U.S.A` counts as three words. Before counting, the CLI removes HTML comments (`<!-- ... -->`), fenced code blocks, inline code, and images, keeps a link's visible text, and treats the markdown characters `# > * _ ~ | :` as spaces. A comment written inside an inline code span (`` `<!-- x -->` ``) is code, not a comment. A `<!--` with no closing `-->` removes nothing, so the text after it is counted and built; `story validate` warns:

```text
warning: chapters/chapter-01.md opens an HTML comment (<!--) that never closes, so the text after it shows in builds and word counts
```

`story wordcount . --write` stores the result in each chapter's `word-count`. `story validate` warns when the stored value differs from the prose:

```text
warning: chapters/chapter-01.md declares 1200 words but contains 993
```

## Story file

`story.md` holds project-wide metadata. Its body is the story bible: synopsis, tone, setting, and notes. A new project's file looks like this:

```yaml
---
title: The Glass Orchard
schema-version: 2
genre: fiction
sub-genre: general
setting-era: unspecified
status: planning
themes:
  - change
pov: third-person-limited
tense: past
---
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `title` | string | yes | Book title. The story id is derived from it, or from the project directory name when `title` is missing or has no ASCII letters or digits (`Война и мир`). Reports and builds show the directory name when `title` is missing. |
| `schema-version` | integer | yes | Must be `2`. `story migrate` sets it. |
| `genre` | string | yes | Free text, for example `fantasy`. `story init` defaults it to `fiction`. |
| `status` | enum | yes | `planning`, `drafting`, `in-progress`, `revising`, `complete`, or `abandoned`. `story init` sets `planning`. |
| `themes` | list of strings | yes | Themes as short labels, for example `power-and-corruption`. Set with `story init --theme` (repeatable) or `--themes a,b`; default `change`. |
| `pov` | string | yes | Narrative point of view, free text, for example `third-person-limited` (the `story init --pov` default). Not a character id. |
| `tense` | enum | yes | `past`, `present`, `future`, or `mixed`. `story init --tense` defaults to `past`. |
| `sub-genre` | string | no | Free text; `story init --sub-genre` sets it (default `general`). `story report` shows `Genre: <genre> / <sub-genre>`. |
| `setting-era` | string | no | Free text; `story init --setting-era` sets it (default `unspecified`). |
| `series` | kebab-case id | no | Series id, identical in every linked book. `story init --series` sets it. |
| `book-number` | integer ≥ 1 | no | Publication order within the series. `story series` errors when two linked books share a number. |
| `follows` | list of paths | no | Paths, relative to this project's root, to books set earlier in the chronology. |
| `precedes` | list of paths | no | Paths to books set later in the chronology. |
| `premise` | string | no | Controlling idea: one sentence of value plus cause. |
| `counter-premise` | string | no | The antagonist's counter-argument to the premise. |
| `author` | string | no | Author name, used on the Shunn title page and as the EPUB creator. |
| `contact` | list of strings | no | Contact block lines for the Shunn title page. |
| `season-goal` | string | no | One-sentence goal for a season or volume of serial fiction. |
| `form` | enum | no | The story's form: `flash`, `short-story`, `novelette`, `novella`, `novel`, `serial`, `picture-book`, or `chapter-book`. `story init --form` sets it with a default `target-words`. See [Story form](#story-form). `story report` shows it. |
| `target-words` | integer ≥ 1 | no | Word-count target for the book, used by `story progress` and `story report`. |
| `deadline` | `YYYY-MM-DD` | no | Due date; `story progress` reports days left and words a day needed. Must be a real calendar day. |
| `draft-mode` | string | no | `discovered` marks a discovery-drafted project. |
| `revision-passes` | list of mappings | no | Named revision passes and their progress. See [Revision passes](#revision-passes). |
| `cover` | path | no | Cover image inside the project: `.jpg`, `.jpeg`, `.png`, `.gif`, or `.webp`. `story build --format epub` embeds it. |
| `authors`, `language`, `isbn`, `publisher`, `publication-date`, `description`, `keywords`, `subjects`, `copyright`, `cover-alt`, `ai-disclosure` | various | no | Publishing metadata read by `story build`. See [Publishing metadata](#publishing-metadata). |

`story validate` errors when `cover` names a missing file, a file outside the project, or an unsupported extension. The craft fields `premise`, `counter-premise`, and `season-goal` have no CLI flags: edit `story.md` directly. See the [theme-craft](../skills/theme-craft/SKILL.md), [genre-craft](../skills/genre-craft/SKILL.md), and [discovery-drafting](../skills/discovery-drafting/SKILL.md) skills for how they are used.

### Story form

`form` names the kind of book, and each form has a usual word-count range. `story init --form <form>` writes `form` and a default `target-words`; a form with no range writes no target. Any other `--form` value is refused, and `story validate` reports an unsupported `form` as an error.

| `form` | Usual range (words) | Default `target-words` |
|--------|---------------------|------------------------|
| `flash` | up to 1,500 | 1,000 |
| `short-story` | 1,000 to 7,500 | 5,000 |
| `novelette` | 7,500 to 17,500 | 12,000 |
| `novella` | 17,500 to 40,000 | 30,000 |
| `novel` | 40,000 to 200,000 | 80,000 |
| `serial` | no range | none |
| `picture-book` | up to 1,000 | 500 |
| `chapter-book` | 4,000 to 15,000 | 10,000 |

The ranges are advisory. `story validate` warns when `target-words` falls outside the form's range, and, when the story `status` is `complete`, when the manuscript's prose does:

```text
warning: story.md target-words 30000 is outside the usual novel range of 40000-200000 words
```

The [premise-workshop skill](../skills/premise-workshop/SKILL.md) helps choose a form.

### Revision passes

`revision-passes` records a revision as separate named passes, each looking for one kind of problem. It is a list of mappings:

```yaml
revision-passes:
  - pass: structure
    status: done
  - pass: character
    status: in-progress
  - pass: sensitivity-read
    status: pending
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `revision-passes[].pass` | kebab-case name | yes | The pass name, unique in the list. Any kebab-case name is allowed. |
| `revision-passes[].status` | enum | no | `pending`, `in-progress`, or `done`. A missing status reads as `pending`. |

`story validate` errors when the field is not a list of mappings, when a pass name is not kebab-case or appears twice, and when a status is not one of the three values.

`story passes` reads and writes the field. Plain `story passes` prints the checklist, with each default pass's focus and the commands it runs. `--init` appends the default passes that are not already listed, after any passes you have; `--start <pass>` marks a pass `in-progress` and `--done <pass>` marks it `done`, adding the pass when it is new. Only the `revision-passes` entry of `story.md` is rewritten. The default ladder runs from the largest problems to the smallest:

| Pass | Focus | Commands |
|------|-------|----------|
| `structure` | Order of events, act turns, scenes that do not change anything | `story timeline`, `story pacing`, `story diagram arcs` |
| `character` | Wants, arcs, motivation, and who knows what when | `story voices`, `story knowledge`, `story diagram relationships` |
| `theme` | Premise, counter-premise, motifs, and the lie/truth arc | `story report` |
| `continuity` | Deaths, props, travel, promises, clues, and backlinks | `story continuity`, `story clues`, `story links` |
| `pacing` | Scene outcomes, sequels, chapter hooks, and chapter lengths | `story pacing` |
| `line` | Sentence-level clarity, rhythm, and distinct voices | `story prose`, `story voices` |
| `copyedit` | Spelling, usage, and consistency against the style sheet | `story prose` |
| `proof` | Typos and layout in the built book | `story build --format print`, `story build --format html` |

While the story `status` is `revising`, `story next` recommends the pass that is `in-progress`, or else the first pass that is not `done`, or `story passes --init` when no passes are recorded. The [revision-continuity skill](../skills/revision-continuity/SKILL.md) works through the passes.

### Publishing metadata

These optional fields describe the published edition. Edit them in `story.md` by hand (there are no flags); the [publishing skill](../skills/publishing/SKILL.md) covers what each one is for. `story build` reads them.

| Field | Type | Meaning and checks |
|-------|------|--------------------|
| `author` | string | A single author name (see the table above). |
| `authors` | list of strings | Author names for a co-written book. Builds use it in place of `author`; `story validate` warns when both are set. |
| `language` | string | BCP 47 language tag such as `en`, `en-GB`, or `fr-CA`. Default `en`. `story validate` errors on a value that is not a tag. The EPUB package and every EPUB document declare it. |
| `isbn` | string | ISBN-13 or ISBN-10 of the edition being built; hyphens and spaces are allowed. `story validate` checks the checksum. Quote an ISBN-10 that starts with `0`: unquoted, YAML reads it as a number and drops the zero, and validation then fails. The EPUB identifier becomes `urn:isbn:<digits>`. |
| `publisher` | string | Publisher name, written to the EPUB package and the copyright page. |
| `publication-date` | `YYYY-MM-DD` | Must be a real calendar day. Written to the EPUB package. |
| `description` | string | The retailer description, written to the EPUB package. The metadata sheet measures it against a 4,000-character limit. |
| `keywords` | list of strings | Retailer search keywords. `story validate` warns over 7. |
| `subjects` | list of strings | BISAC subject codes such as `FIC022000`. `story validate` errors on any other shape. Written as EPUB subjects. |
| `copyright` | string | The copyright line, such as `© 2026 Jane Doe`. See below. |
| `cover-alt` | string | Alt text for the EPUB cover image. Default `Cover of <title>`. |
| `ai-disclosure` | string | A short statement of how AI tools were used, for retailer and agent disclosure forms. |

The scalar fields must be text (an unquoted ISBN-13 is also accepted), and `authors`, `keywords`, and `subjects` must be lists of text; `story validate` errors otherwise:

```text
error: story.md language english must be a BCP 47 tag such as en, en-GB, or fr
error: story.md subject fiction must be a BISAC code such as FIC022000
warning: story.md lists 8 keywords; most retailers accept 7
```

When `copyright` is set and no matter page is a copyright page (one with id `copyright` or a title containing "Copyright"), the markdown export and the DOCX, EPUB, HTML, and print builds add a copyright page as the first front matter page. The Shunn builds and the narration script leave it out, and the metadata sheet only notes whether one exists. It holds the copyright line, "All rights reserved.", and the publisher, ISBN, and `ai-disclosure` when they are set.

EPUB builds also write EPUB Accessibility discovery metadata (access modes, features such as `tableOfContents` and `readingOrder`, no hazards, and a summary), mark each document with `epub:type` (`bodymatter chapter`, `frontmatter`, `backmatter`, or `copyright-page`), and add a landmarks navigation list. `story build --format metadata` writes a retailer metadata sheet from these fields, with `(missing)` for each field not set. [Import, export, and builds](manuscripts.md) describes every build format.

Series links need a backlink: a book that lists another in `follows` must appear in that book's `precedes`, and the reverse. `story links` checks that each path is a story project, carries the backlink, and uses the same `series` id. `story init --follows <path>` or `--precedes <path>` writes both sides for you and inherits the linked book's `series` id. [Series](series.md) covers linked books and the canon checks of `story series`.

## Characters

Files: `characters/<character-id>.md`. Created with `story add character "Name"`.

```yaml
---
name: "Sera Voss"
role: protagonist
status: alive
aliases:
  - "The Ember Queen"
relationships:
  - character: kael-voss
    type: sibling
  - character: lord-maren
    type: antagonist
locations:
  - whispering-vale
tags:
  - ember-bearer
arc: redemption
---
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `name` | string | yes | Display name. |
| `role` | enum | yes | `protagonist`, `antagonist`, `supporting`, `minor`, `narrator`, or `deuteragonist`. `story add` defaults to `supporting`. |
| `status` | enum | yes | `alive`, `deceased`, `unknown`, `missing`, or `cut`. `story add` defaults to `alive`. |
| `aliases` | list of strings | no | Other names and titles. |
| `relationships` | list of mappings | no | Each entry has `character` (a character id) and `type` (free text). See below. |
| `locations` | list of location ids | no | Places the character is tied to. Each location must list the character in `notable-characters`. |
| `tags` | list of strings | no | Free labels. |
| `died-in` | chapter id | no | Chapter in which the character dies on the page. Set it with `status: deceased`. |
| `arc` | string | no | Short theme label for the personal arc, such as `redemption`. Free text: `story links` does not check it as an arc id. Set it with `story add character --arc <theme>`. If the value happens to equal an arc id, `story rename arc` and `story remove arc` update or clear it. |
| `arc-type` | enum | no | `change-positive`, `change-negative`, or `flat`. |
| `lie` | string | no | The false belief that drives the character. |
| `truth` | string | no | The belief that resolves the lie. |
| `ghost-wound` | string | no | The formative wound behind the lie. |
| `voice-words` | list of strings | no | Words and phrases the character reaches for in dialogue. |
| `voice-avoid` | list of strings | no | Words the character would never say. |
| `pronunciation` | string | no | A respelling such as `SHUR-sha`, for the narration build's pronunciation guide. |

Status notes:

- `status: deceased` with `died-in` lets `story continuity` report the character in the cast of any later chapter or scene. `died-in` with any other status is an error. Characters who died before chapter 1 use `status: deceased` without `died-in`.
- `status: cut` keeps the file for a character removed during discovery drafting, out of canon but on record.

The arc-craft fields `arc-type`, `lie`, `truth`, and `ghost-wound` have no CLI flags and are not checked by the CLI. See the [character-management](../skills/character-management/SKILL.md) and [theme-craft](../skills/theme-craft/SKILL.md) skills.

`voice-words` and `voice-avoid` have no flags either. `story validate` errors when either is not a list of strings, and [`story voices`](#dialogue-voices) reads both. The [line-editing](../skills/line-editing/SKILL.md) and [voice-style](../skills/voice-style/SKILL.md) skills propose them.

`pronunciation` is also accepted on locations, factions, artifacts, and glossary terms. `story validate` errors when it is not text. `story build --format narration` gathers every `pronunciation` into the script's pronunciation guide, leaving out cut characters. See the [adaptation skill](../skills/adaptation/SKILL.md).

### Relationship types

Every relationship needs a backlink: if Sera lists Kael, Kael must list Sera. For the types below, `story links` also checks the backlink's type.

| Type | Backlink type |
|------|---------------|
| `parent` / `child` | `child` / `parent` |
| `grandparent` / `grandchild` | `grandchild` / `grandparent` |
| `uncle`, `aunt` | `nephew` or `niece` |
| `nephew`, `niece` | `uncle` or `aunt` |
| `mentor` / `student` | `student` / `mentor` |
| `employer` / `subordinate` | `subordinate` / `employer` |
| `former-supervisor` / `former-subordinate` | `former-subordinate` / `former-supervisor` |
| `sibling`, `spouse`, `partner`, `in-law`, `friend`, `ally`, `rival`, `enemy`, `adversary`, `cousin`, `colleague`, `foil`, `confidant`, `love-interest` | the same type |

Any other type (such as `antagonist`) is allowed, and the backlink may use any type.

## Worldbuilding

### Locations

Files: `worldbuilding/locations/<location-id>.md`. Created with `story add location "Name"`.

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `name` | string | yes | Display name. |
| `type` | string | yes | Free text, for example `city` or `forest` (default `other`). |
| `region` | string | no | Larger region the place belongs to. |
| `population` | string | no | Free text. |
| `controlled-by` | string | no | Faction or character id in control. Not checked by `story links`, but `story rename` and `story remove` keep it current. |
| `notable-characters` | list of character ids | no | Characters tied to the place. Each character must list the location in `locations`. |
| `tags` | list of strings | no | Free labels. |
| `status` | string | no | Free text (default `unknown`). |
| `routes` | list of mappings | no | Journeys to other locations, with travel times. See below. |
| `pronunciation` | string | no | Respelling for the narration build (see [Characters](#characters)). |

#### Routes

`routes` records how long it takes to get from this location to others, so `story continuity` can check travel:

```yaml
routes:
  - to: bellwether-reef
    hours: 0.5
    mode: dive skiff
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `routes[].to` | location id | yes | The destination. |
| `routes[].hours` | number > 0 | yes | The fastest the journey can be made, in hours. |
| `routes[].mode` | string | no | Free text, such as `cart`, `ferry`, or `on foot`. |

A route is two-way unless the destination declares its own route back, which then sets the return time. `story validate` errors when an entry has no `to`, when `hours` is not a positive number, and when `mode` is a list or mapping rather than a single value. `story links` errors when `to` names a missing location or the location itself. `story rename location` rewrites `to`, and `story remove location` drops the routes that lead to the removed location. [Route travel](#route-travel) describes the continuity check, and `story diagram locations` draws the network. The [worldbuilding skill](../skills/worldbuilding/SKILL.md) and its [maps and routes reference](../skills/worldbuilding/references/maps-and-routes.md) cover how to set travel times.

### Systems

Files: `worldbuilding/systems/<system-id>.md`, for magic, technology, religion, economics, and other rule sets. Created with `story add system "Name"`.

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `name` | string | yes | Display name. |
| `type` | string | yes | Free text, for example `magic` (default `other`). |
| `prevalence` | string | no | How common it is (default `uncommon`). |

### Factions

Files: `worldbuilding/factions/<faction-id>.md`. Created with `story add faction "Name"`.

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `name` | string | yes | Display name. |
| `type` | enum | yes | `family`, `guild`, `government`, `military`, `religion`, `company`, `community`, `criminal`, or `other` (default `other`). |
| `status` | enum | yes | `active`, `hidden`, `declining`, `defeated`, `disbanded`, or `unknown` (default `active`). |
| `members` | list of character ids | no | Members. |
| `locations` | list of location ids | no | Where the faction operates. |
| `tags` | list of strings | no | Free labels. |
| `pronunciation` | string | no | Respelling for the narration build. |

### Artifacts

Files: `worldbuilding/artifacts/<artifact-id>.md`, for objects that matter to the plot. Created with `story add artifact "Name"`.

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `name` | string | yes | Display name. |
| `type` | enum | yes | `object`, `weapon`, `document`, `technology`, `relic`, `symbol`, `resource`, or `other` (default `object`). |
| `status` | enum | yes | `active`, `lost`, `destroyed`, `hidden`, `transferred`, or `unknown` (default `active`). |
| `owner` | string | no | Character or faction id. |
| `location` | string | no | Location id. |
| `tags` | list of strings | no | Free labels. |
| `pronunciation` | string | no | Respelling for the narration build. |

The [worldbuilding skill](../skills/worldbuilding/SKILL.md) has body templates for each kind.

## Plot

### Arcs

Files: `plot/arcs/<arc-id>.md`. Created with `story add arc "Name"`.

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `name` | string | yes | Display name. |
| `type` | enum | yes | `main`, `subplot`, `character`, or `thematic` (default `subplot`). |
| `status` | enum | yes | `planned`, `in-progress`, or `resolved` (default `planned`). |
| `characters` | list of character ids | no | Characters the arc involves. |
| `themes` | list of strings | no | Themes the arc carries. |
| `acts` | list of strings | no | Acts the arc spans, for example `act-1`. |
| `mice-threads` | list of strings | no | MICE threads the arc carries: `milieu`, `inquiry`, `character`, `event`. Not read by the CLI. |

The arc body's `## Setup`, `## Rising Action`, `## Climax`, and `## Resolution` sections feed `story synopsis`. Any `chapter-NN` token in the body must name an existing chapter, and any relative `.md` link must point at an existing entity file (one named by a kebab-case entity id) inside the project. Links to other files, such as `story.md` or `style-sheet.md`, are reported as missing; `_index.md` and `*` wildcard targets are skipped (see [References and backlinks](#references-and-backlinks)). The [plot-structure skill](../skills/plot-structure/SKILL.md) covers arc design and MICE threading.

### Plot registry and timeline

`plot/_index.md` is the arc registry. Besides `type: plot-registry` and `story`, it requires a `structure` field naming the structure model; `story init` sets `three-act`, and `story reindex` keeps whatever value you set.

`plot/timeline.md` has frontmatter `type: timeline` and `story`. Its body is a hand-kept table of events:

```markdown
| When | Event | Arc | Chapter |
|------|-------|-----|---------|
```

`story reindex` never rewrites the timeline body; it only corrects the `story` field. `story links` checks every `chapter-NN` token and `.md` link in it, except links to an `_index.md` registry or containing a `*` wildcard. Each link must point at an existing entity file inside the project; a link to `story.md` or `style-sheet.md` is reported as missing. For a timeline computed from scene dates, use `story timeline` (see [Continuity and analysis](continuity.md#story-timeline)).

## Chapters

Files: `chapters/chapter-{NN}.md`. Created with `story add chapter "Title"`, which numbers it after the highest existing chapter unless you pass `--number`.

```yaml
---
title: The Bell Under the Reef
number: 1
pov: mara-quill
locations:
  - bellwether-reef
  - port-kestrel
characters:
  - mara-quill
mentions:
  - theo-quill
arcs-advanced:
  - the-drowned-witness
status: draft
hook: revelation
word-count: 1489
---
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `title` | string | yes | Chapter title. |
| `number` | integer ≥ 1 | yes | Must match the filename and be unique. When it is set to something other than a positive integer, `story validate` errors, the reports and diagrams use the number in the file name, and `story export` and `story build` refuse to run. |
| `status` | enum | yes | `outline`, `draft`, `revised`, `final`, or `complete` (default `outline`). |
| `pov` | character id | no | Point-of-view character. |
| `locations` | list of location ids | no | Where the chapter takes place. |
| `characters` | list of character ids | no | Characters present on the page. |
| `mentions` | list of character or artifact ids | no | Characters or artifacts referenced, remembered, recorded, or seen in flashback, but not present. |
| `arcs-advanced` | list of arc ids | no | Arcs the chapter moves forward. |
| `word-count` | integer ≥ 0 | no | Prose word count, maintained by `story wordcount --write`. |
| `target-words` | integer ≥ 1 | no | Word target for the chapter; `story progress` reports against it. |
| `mode` | string | no | `discovered` marks a discovery-drafted chapter that must go through the [discovery-drafting](../skills/discovery-drafting/SKILL.md) reconcile loop. Set it with `story add chapter --mode discovered`. |
| `date` | `YYYY-MM-DD` | no | Story date; enables clock checks. |
| `time` | string | no | Story time of day (see [Dates and times](#dates-and-times)). |
| `episode-question` | string | no | The installment's dramatic question, for serial fiction. |
| `time-skip` | string | no | Free-form `from → to` note of a skipped interval. Not checked. |
| `hook` | enum | no | How the chapter ending pulls the reader on: `cliffhanger`, `question`, `revelation`, `reversal`, `decision`, `emotional`, or `resolution`. Set it with `story add chapter --hook <name>`. Read by [`story pacing`](#pacing). |

`story continuity` treats `pov` and `characters` as the cast, so a deceased character who appears in a flashback or memory belongs in `mentions`, not `characters`. It also warns when the `pov` character is not listed in `characters`, and when chapter numbers skip. `story validate` warns when a chapter has no scene records in `scenes/`.

## Scenes

Files: `scenes/{chapter-id}-scene-{NN}.md`. Scene records carry the machine-readable continuity for each scene. Created with `story add scene "Title" --chapter chapter-03`, which numbers the scene after the chapter's last one unless you pass `--scene`.

```yaml
---
title: The Musicians' Gallery
chapter: chapter-01
scene: 1
pov: sera-voss
location: ashen-citadel
characters:
  - sera-voss
  - kael-voss
  - lord-maren
  - king-aldric
arcs-advanced:
  - the-coup
status: draft
state-changes:
  - character: sera-voss
    knowledge: Maren has asked the king to arm the ember well
  - character: sera-voss
    knowledge: A tunnel behind the gallery leads to the Whisper Gate
---
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `title` | string | yes | Scene title. |
| `chapter` | chapter id | yes | Owning chapter; must match the filename. |
| `scene` | integer ≥ 1 | yes | Position in the chapter; must match the filename and be unique within the chapter. |
| `status` | enum | yes | `outline`, `draft`, `revised`, `final`, or `complete` (default `outline`). |
| `pov` | character id | no | Point-of-view character. |
| `location` | location id | no | Where the scene happens. |
| `characters` | list of character ids | no | Characters present in the scene. |
| `mentions` | list of character or artifact ids | no | Referenced but not present. |
| `arcs-advanced` | list of arc ids | no | Arcs the scene moves forward. |
| `state-changes` | list of mappings | no | What the scene changes that must carry forward. See below. |
| `sequel` | boolean | no | `true` for a sequel unit (reaction, dilemma, decision) rather than a scene unit (goal, conflict, outcome). |
| `dilemma` | string | no | The choice the POV character faces in a sequel unit. |
| `outcome` | enum | no | How a scene unit ends for the POV character's goal: `yes`, `no`, `yes-but` (they get it, at a cost), or `no-and` (they fail, and things get worse). Set it with `story add scene --outcome <name>`. Read by [`story pacing`](#pacing), which ignores it on sequel units. |
| `date` | `YYYY-MM-DD` | no | Story date. A scene never inherits its chapter's date. |
| `time` | string | no | Story time (see [Dates and times](#dates-and-times)). |
| `travel-hours` | number | no | Minimum travel time into this scene; `story continuity` errors when the timestamps allow less. |
| `flashback-to` | string | no | Free-form note of the moment flashed back to. Kept but not checked; continuity checks use `mentions`. |

`state-changes` entries are free-form mappings: each must be a mapping, but the CLI does not require particular keys. Two shapes are in use. The [scene template](../skills/chapter-writing/references/scene-template.md) records `target` and `change`:

```yaml
state-changes:
  - target: moon-blade
    change: Cracked across the hilt in the fall
```

The examples also record `character` with `knowledge`, `physical`, or `emotional`, mirroring `continuity/state.md`. Use `target` for artifacts: the prop custody check in `story continuity` looks for `target: <artifact-id>` in scenes after an artifact was destroyed or lost, and also flags the artifact in a later scene's or chapter's `mentions`.

`story continuity` warns when a scene's cast or location is missing from its chapter's `characters`, `mentions`, or `locations`, and when a POV character is not in `characters`. The [scene-craft skill](../skills/scene-craft/SKILL.md) covers scene and sequel units.

## Continuity

The `continuity/` directory holds durable state and the three trackers for setups and answers. [Continuity and analysis](continuity.md#story-continuity) explains the checks that read them; this section is the field contract.

### State file

`continuity/state.md` records what is true at the current point in the story.

```yaml
---
type: continuity-state
story: harbor-of-second-light
current-chapter: 1
character-state:
  - character: mara-quill
    location: port-kestrel
    physical: unharmed after the reef dive
    emotional: shaken but resolved
  - character: ilya-venn
    location: port-kestrel
    physical: unharmed
    emotional: unaware the chamber is open
object-state:
  - artifact: archive-lantern
    owner: mara-quill
    location: port-kestrel
    status: hidden
knowledge-state:
  - character: mara-quill
    knows: the Afterimage Archive was active during the Blackout Night
    learned-in: chapter-01
---
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `type` | string | yes | Must be `continuity-state`. |
| `story` | string | yes | The story id. |
| `current-chapter` | integer ≥ 0 | yes | Chapter number the state describes. |
| `character-state` | list of mappings | no | Per-character state. |
| `object-state` | list of mappings | no | Per-artifact custody and condition. |
| `knowledge-state` | list of mappings | no | Who knows what, and since when. |

`story continuity` errors when `current-chapter` is higher than the highest chapter number, and warns when it is behind the latest chapter that is past `outline`.

Entry fields:

| List | Field | Meaning |
|------|-------|---------|
| `character-state` | `character` | Required. Character id. |
| | `location` | Location id. |
| | `physical`, `emotional`, `knowledge` | Free-form notes. |
| `object-state` | `artifact` | Required. Artifact id. |
| | `owner` | Character or faction id. |
| | `location` | Location id. |
| | `status` | Artifact status. A value that differs from the artifact file's `status` is a warning. |
| | `since` | Chapter id in which the artifact was destroyed or lost. Needed for prop custody checks; without it, a `destroyed` or `lost` entry is a warning. |
| `knowledge-state` | `character` | Required. Character id. |
| | `knows` | Required. The fact, as prose. |
| | `learned-in` | Chapter id. Leave it out when the character knew the fact before the book began. |
| | `fact` | Stable kebab-case id for the knowledge. A character may list each `fact` once. `story series` matches facts across books by this id. |

`story knowledge <character-id> --at <chapter-id>` lists the `knowledge-state` entries a character knew at that chapter: entries learned at or before it, plus entries with no `learned-in`.

The body holds human-readable tables of the same state. `story reindex` never rewrites the body; it only corrects the `story` field.

### Questions

Files: `continuity/questions/<question-id>.md`, for open questions the reader or the continuity tracker needs answered. Created with `story add question "Title"`.

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `title` | string | yes | The question. |
| `status` | enum | yes | `open`, `answered`, `resolved`, `dropped`, or `abandoned`. Default `open`. |
| `introduced` | chapter id | no | Chapter that raises the question. |
| `resolved` | chapter id | no | Chapter that answers it. |
| `characters` | list of character ids | no | Characters involved. |

`story continuity` errors when `resolved` comes before `introduced`, when an `answered` or `resolved` question has no `resolved` chapter, and when an `open` question already records one.

### Promises

Files: `continuity/promises/<promise-id>.md`, for setups the story owes the reader a payoff on. Created with `story add promise "Title"`.

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `title` | string | yes | The promise. |
| `status` | enum | yes | `planned`, `planted`, `paid-off`, `dropped`, or `abandoned`. |
| `planted` | chapter id | no | Chapter that plants the setup. |
| `payoff` | chapter id | no | Chapter that pays it off. |
| `arcs` | list of arc ids | no | Arcs the promise belongs to. |
| `characters` | list of character ids | no | Characters involved. |

### Clues

Files: `continuity/clues/<clue-id>.md`, a clue ledger for mysteries and fair-play reveals. Created with `story add clue "Title" --planted chapter-02 --payoff chapter-05`.

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `title` | string | yes | The clue. |
| `status` | enum | yes | `planned`, `planted`, `paid-off`, `dropped`, or `abandoned`. |
| `planted` | chapter id | no | Chapter where the clue appears. |
| `payoff` | chapter id | no | Chapter where its meaning lands. |
| `significance-delayed` | boolean | no | `true` when the clue's meaning only lands later. |
| `red-herring` | boolean | no | `true` for a clue planted to mislead. Its `payoff` is the chapter that debunks it. |
| `arcs` | list of arc ids | no | Arcs the clue belongs to. |
| `characters` | list of character ids | no | Characters involved; for [`story clues`](#clue-grid), the characters who could notice it. |

`story add promise` and `story add clue` set `status: planted` when you pass `--planted`, and `status: planned` otherwise; `--status` overrides both. To schedule a setup in a chapter you have not drafted, pass `--status planned` with `--planted`; `story continuity` warns once that chapter has prose and the status is still `planned`. `story add clue --significance-delayed` and `--red-herring` set those flags. `story validate` errors when either flag is not `true` or `false`.

For promises and clues, `story continuity` errors when `payoff` comes before `planted`, when a `paid-off` entry has no `payoff` chapter, and when a `planted` entry has no `planted` chapter. It warns when a `planted` entry was planted at least three chapters before the latest chapter past `outline` and its `payoff` is unset or already behind that chapter, and when a promise records a `planted` chapter but is still `planned`. When `story.md` has `status: complete`, any `open` question or `planned` or `planted` promise or clue is an error.

`status: abandoned` marks a thread cut during discovery drafting: `story continuity` skips abandoned questions, promises, and clues entirely. [What the status values mean](#what-the-status-values-mean) sets out how `abandoned` differs from `dropped`.

### Exemptions

`continuity/exemptions.md` is optional. It records continuity findings you have decided are intentional, so `story continuity` reports them as dismissed rather than as errors or warnings.

```yaml
---
type: exemption-log
exemptions:
  - pattern: "lists theo-quill, who died in chapter-02"
    reason: "Chapter 5 is a dream sequence; Theo appears on purpose."
---
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `type` | string | yes | Must be `exemption-log`. |
| `exemptions` | list of mappings | yes | One entry per dismissed finding. |
| `exemptions[].pattern` | string, at least 4 characters | yes | Matched as a substring of the finding text. The minimum length stops a short pattern from dismissing whole classes of findings. |
| `exemptions[].reason` | string | yes | Why the finding is intentional. |

## Glossary

Files: `glossary/terms/<term-id>.md`, for invented words, names, and concepts that must be used consistently. Created with `story add term "Term"`.

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `term` | string | yes | The term as it should appear. |
| `category` | enum | yes | `person`, `place`, `faction`, `artifact`, `concept`, `term`, or `other`. Default `term`. |
| `aliases` | list of strings | no | Accepted variants. |
| `pronunciation` | string | no | Respelling for the narration build. |

## Optional files

### Style sheet

`style-sheet.md` records house style. `story init` creates it; `story validate` checks it when present, and `story prose` enforces its lists.

```yaml
---
type: style-sheet
dialect: british
preferred:
  - use: toward
    avoid: towards
watch-words:
  - almost
allow-words:
  - quietly
---
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `type` | string | yes | Must be `style-sheet`. |
| `dialect` | enum | no | `british`, `american`, or `unspecified`. British or American makes `story prose` flag the other dialect's spelling from a built-in list of common pairs and their inflections, such as colour/color, centre/center, grey/gray, defence/defense, towards/toward, and travelled/traveled. `-ise`/`-ize` is not built in; record that choice as a `preferred` entry. |
| `preferred` | list of mappings | no | Each entry has a non-empty `use` (the house form) and `avoid` (the form to flag), which must differ. An entry naming either word of a built-in dialect pair replaces that pair. |
| `watch-words` | list of strings | no | Words or phrases `story prose` counts in every chapter. |
| `allow-words` | list of strings | no | Words `story prose` never flags as filter words, `-ly` adverbs, echoes, said-bookisms, or dialect spellings. Naming either word of a built-in dialect pair here also switches that pair off. |

The body holds the decisions a copyeditor tracks: voice, spelling and usage, capitalisation, hyphenation, numbers, dialogue punctuation, and character voices. See the [voice-style skill](../skills/voice-style/SKILL.md), [Writing workflows](writing-workflows.md#voice-and-house-style), and [Story prose](continuity.md#story-prose).

### Front and back matter

Files: `matter/<matter-id>.md`, for dedication, epigraph, copyright page, acknowledgments, author's note, about the author, and also-by pages. Create them with `story add matter "Dedication"` (front by default) or `story add matter "Acknowledgments" --placement back`. The first page creates `matter/_index.md`.

```yaml
---
title: Epigraph
placement: front
order: 1
heading: false
---
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `title` | string | yes | Labels the page in the EPUB table of contents and, unless `heading: false`, prints as its heading. |
| `placement` | enum | yes | `front` or `back`. |
| `order` | integer ≥ 0 | no | Sort position within the placement (missing counts as `0`); ties sort by id. `story add matter` numbers new pages after the last one in their placement unless you pass `--order`. |
| `heading` | boolean | no | Defaults to `true`. Set `false` for pages that print no title, such as a dedication. |
| `permission` | enum | no | Rights status of quoted material on the page (an epigraph, song lyrics, a poem): `not-needed`, `pending`, `granted`, or `public-domain`. |
| `rights-holder` | string | no | Who granted the permission. |
| `credit` | string | no | The credit line the grant requires. |

The body is the page text; a leading `# Heading` line is dropped, as for a chapter. Matter ids become EPUB file names, so builds refuse ids that are not kebab-case. A matter file with no text is left out of export and build, and `story validate` warns about it. [Import, export, and builds](manuscripts.md) explains where each format places matter.

`story validate` errors on an unsupported `permission` and when `rights-holder` or `credit` is a list or mapping rather than a single value. It warns when `permission` is `pending` and the story `status` is `complete`, and when `permission` is `granted` with no `rights-holder`. The [editorial-review skill](../skills/editorial-review/SKILL.md) covers permissions.

A matter page whose id is `copyright` or whose title contains "Copyright" is the book's copyright page. Builds use it in place of the page generated from the `story.md` `copyright` field (see [Publishing metadata](#publishing-metadata)); EPUB marks it `copyright-page`, and the narration build skips it when it is front matter.

### Research notes

Files: `research/<research-id>.md`, for the real-world facts the story relies on. Create them with `story add research "Tidal bore timing" --source "..." --used-in chapter-03`. The first note creates `research/_index.md`.

```yaml
---
title: Frost damage in orchards
status: open
sources:
  - RHS guide to frost protection
used-in:
  - chapter-01
---
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `title` | string | yes | What the note covers. |
| `status` | enum | yes | `open`, `verified`, or `disputed`. Default `open`. |
| `sources` | list of strings | no | Citations or URLs, each kept whole (commas allowed). `--source` is repeatable. |
| `used-in` | list of chapter ids | no | Chapters that rely on the note. |
| `accuracy` | enum | no | `must-be-accurate` (a knowledgeable reader will check it), `blended` (real facts bent on purpose, with the departure recorded under `## Story Use`), or `invented` (made up for the story). |
| `confidence` | enum | no | `high`, `medium`, or `low`. |
| `method` | enum | no | How the knowledge was gathered: `fact` (desk research), `interview`, `site-visit`, `expert-review`, or `reading`. |
| `risk` | list of enums | no | Areas where getting it wrong could hurt a reader or the author: `legal`, `medical`, `weapons`, `safety`, `cultural`, `defamation`, `technical`. |
| `reviewed-by` | list of strings | no | The qualified people, by name or role, who checked the note. |

`story add research` accepts `--accuracy`, `--confidence`, `--method`, and a repeatable `--risk`, and refuses values outside these lists. `reviewed-by` has no flag.

`story validate` errors on unsupported values. It warns when:

- a `verified` note lists no sources,
- a chapter with status `final` or `complete` relies on an `open` or `disputed` note, and
- a note with any `risk` has no `reviewed-by` while a `final` or `complete` chapter relies on it.

Notes with `accuracy: invented` need no sources and never raise the open-research warning. See the [research skill](../skills/research/SKILL.md).

```text
warning: research/tides.md carries legal, medical risk but has no reviewed-by, and chapter-07 relies on it
```

### Progress log

`progress.md` is written by `story progress --log`. Logging again on the same date replaces that day's entry; other frontmatter and the body are kept.

```yaml
---
type: progress-log
sessions:
  - date: 2026-09-24
    words: 0
---
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `type` | string | yes | Must be `progress-log`. |
| `sessions` | list of mappings | no | One entry per day, in date order. |
| `sessions[].date` | `YYYY-MM-DD` | yes | Session date; `--date` sets it (default today). Dates must be unique. |
| `sessions[].words` | integer ≥ 0 | yes | Word count of the whole manuscript on that date. |

`story progress` measures these against `target-words` and `deadline` in `story.md` and against chapter `target-words`. See [Continuity and analysis](continuity.md#story-progress).

## Registries

A registry is an `_index.md` file whose table lists the entities in its directory. `story reindex` rebuilds every registry from the entity files; `story add`, `story rename`, and `story remove` reindex for you. Run `story reindex .` after you add, rename, or delete entity files by hand.

Every registry has two frontmatter fields: `type` (fixed per file) and `story` (the story id). For the required registries, `story validate` errors when either is missing or wrong; for the optional matter and research registries it checks only `type`. It warns when a registry is missing the link to an entity file:

```text
warning: characters/_index.md is missing registry link ](sera-voss.md)
```

| File | `type` | Table columns | Hand-written sections kept by reindex |
|------|--------|---------------|----------------------------------------|
| `characters/_index.md` | `character-registry` | Name, Role, Status, File | `## Relationship Map`, `## Family Trees` |
| `worldbuilding/_index.md` | `world-registry` | Locations: Name, Type, Region, File. Systems: Name, Type, File. Factions and Artifacts: Name, Type, Status, File | `## World Overview` |
| `plot/_index.md` | `plot-registry` | Name, Type, Status, File | `## Story Structure`, `## Theme Tracking` |
| `chapters/_index.md` | `chapter-registry` | #, Title, POV, Status, Word Count, File, plus a total | none |
| `scenes/_index.md` | `scene-registry` | Chapter, Scene, Title, POV, Status, File | none |
| `continuity/questions/_index.md` | `question-registry` | Question, Status, Introduced, File | none |
| `continuity/promises/_index.md` | `promise-registry` | Promise, Status, Planted, File | none |
| `continuity/clues/_index.md` | `clue-registry` | Clue, Status, Planted, File | none |
| `glossary/_index.md` | `glossary-registry` | Term, Category, File | none |
| `matter/_index.md` | `matter-registry` | Title, Placement, Order, File | none |
| `research/_index.md` | `research-registry` | Title, Status, Used In, File | none |

`plot/_index.md` also requires `structure` (see [Plot registry and timeline](#plot-registry-and-timeline)). The matter and research registries are optional; `story reindex` keeps each one current once its directory exists.

Reindex regenerates the headings, tables, and totals it writes, and keeps the sections in the last column where they are. It also keeps any other `## ` section you add that it does not generate, such as `## Notes`, and appends it after the generated sections; a section written above the `# ` title moves there too. Generated headings are matched without a trailing `: <number>`, so each `## Total Word Count: N` counts as the generated total and extra copies are dropped, while a second section with a generated heading, such as a hand-written second `## Registry`, is kept as your own. Text outside a `## ` section, such as a line under the `# ` title, is replaced. A registry saved with CRLF line endings keeps them. Rows are ordered by filename, except chapters (by number), scenes (by chapter id, then scene number), and matter (by `order`, then id, with front and back pages interleaved). The chapter registry's word counts come from the prose, not from `word-count` frontmatter.

A registry looks like this:

```markdown
---
type: character-registry
story: the-last-ember
---

# Characters

## Registry

| Name | Role | Status | File |
|------|------|--------|------|
| Kael Voss | supporting | alive | [kael-voss](kael-voss.md) |
| Lord Maren | antagonist | alive | [lord-maren](lord-maren.md) |
| Sera Voss | protagonist | alive | [sera-voss](sera-voss.md) |

## Relationship Map

...
```

`plot/timeline.md` (`type: timeline`) and `continuity/state.md` (`type: continuity-state`) are not registries, but `story validate` checks their `type` and `story` fields the same way, and `story reindex` corrects `story` there too without touching the rest of the file. So after you change the book's `title`, `story reindex .` updates the story id everywhere.

## References and backlinks

Fields that name another entity hold its id. `story links` checks that each id is kebab-case and that the entity exists, and checks the backlinks the format requires. It also runs as part of `story report` and `story doctor`.

| File | Field | Must name |
|------|-------|-----------|
| `story.md` | `follows`, `precedes` | Another story project, with the matching backlink and `series` |
| Character | `relationships[].character` | Character, with a backlink (see [Relationship types](#relationship-types)) |
| Character | `locations` | Location that lists the character in `notable-characters` |
| Character | `died-in` | Chapter |
| Location | `notable-characters` | Character that lists the location in `locations` |
| Location | `routes[].to` | Another location (not the location itself) |
| Faction | `members` | Character |
| Faction | `locations` | Location |
| Artifact | `owner` | Character or faction |
| Artifact | `location` | Location |
| Arc | `characters` | Character |
| Chapter, scene | `pov`, `characters` | Character |
| Chapter, scene | `mentions` | Character or artifact |
| Chapter | `locations` | Location |
| Scene | `chapter` | Chapter |
| Scene | `location` | Location |
| Chapter, scene | `arcs-advanced` | Arc |
| Question | `introduced`, `resolved` | Chapter |
| Promise, clue | `planted`, `payoff` | Chapter; may be a scheduled `chapter-NN` with no chapter file yet (see below) |
| Question, promise, clue | `characters` | Character |
| Promise, clue | `arcs` | Arc |
| Research note | `used-in` | Chapter |
| `plot/timeline.md`, arc bodies | any `chapter-NN` token | Chapter |
| `plot/timeline.md`, arc bodies | relative links to `.md` files, except `_index.md` and `*` wildcard targets (links to non-entity files such as `story.md` are reported missing) | Existing entity file, named by its kebab-case id, inside the project |

A promise or clue can schedule its setup and payoff ahead of the drafted book: `payoff`, and `planted` while `status: planned`, may name a `chapter-NN` that has no file yet. Once the status is `planted` or `paid-off`, the `planted` chapter must exist, and once it is `paid-off`, so must the `payoff` chapter.

`story continuity`, not `story links`, checks the ids in `continuity/state.md`: `character`, `location`, `artifact`, `owner`, `learned-in`, and `since` must name existing entities, and `fact` must be kebab-case.

When you add a character with `--location`, or a location with `--character`, `story add` writes the backlink into the other file.

`story rename` and `story remove` keep ids consistent across every file's frontmatter (except `story.md`). They rewrite the entity-reference fields in the table above (including a location's `routes[].to`), plus `controlled-by`, the state-file fields (`character`, `location`, `artifact`, `owner`, `learned-in`, `since`), and any `character` key inside a scene's `state-changes`. A field that can name more than one kind (`owner`, `controlled-by`, `mentions`) is left alone when another kind has an entity with the same id. Beyond that:

- `story rename` also rewrites markdown links, in any project file, that point at the renamed file.
- `story remove` clears a scalar reference, drops the id from a list, and drops a whole `relationships`, `character-state`, `knowledge-state`, `object-state`, or `routes` entry whose identifying `character`, `artifact`, or `to` was removed. It does not edit bodies, so bare `chapter-NN` tokens and links to a removed file remain. `story links` reports them only in `plot/timeline.md` and arc bodies; find leftovers elsewhere (hand-written registry sections, `style-sheet.md`, other entity bodies) by hand.
- Neither command edits `follows` or `precedes`, which name other projects rather than entities.

The CLI reference covers [`rename`](cli-reference.md#rename) and [`remove`](cli-reference.md#remove).

A failed check names the file and the broken reference, and exits with status 1:

```text
Link check failed: 3 errors, 0 warnings, 0 dismissed
error: characters/ilya-venn.md relationship mentor to theo-quill expects backlink type student, got former-subordinate
error: characters/mara-quill.md relationship to theo-quill is missing backlink
error: characters/theo-quill.md relationship former-subordinate to ilya-venn expects backlink type former-supervisor, got mentor
```

## Dates and times

Chapters and scenes can carry a story `date` and `time`; `story continuity` and `story timeline` use them. With no dates anywhere, there are no clock findings.

| Field | Format |
|-------|--------|
| `date` | `YYYY-MM-DD`, and it must be a real calendar day (`2026-02-30` is rejected). |
| `time` | `HH:MM` on a 24-hour clock, or one of `dawn`, `morning`, `midday`, `afternoon`, `evening`, `night`. |
| `travel-hours` | A number of hours, zero or more. Scenes only. |

For ordering, named times count as 05:00 (`dawn`), 07:00 (`morning`), 12:00 (`midday`), 15:00 (`afternoon`), 19:00 (`evening`), and 23:00 (`night`). `story add chapter` and `story add scene` reject a malformed `--date` or `--time`. In hand-edited files, `story continuity` reports malformed values as warnings. The same date format applies to `deadline` and `publication-date` in `story.md` and to `sessions[].date` in `progress.md`.

### Route travel

When locations declare [`routes`](#routes), `story continuity` follows each character through the dated scenes they are in (the scene's `characters` plus its `pov`), in story-time order rather than reading order. When two sightings are at different locations joined by routes, the story time between them must be at least the fastest route, which may pass through other locations. Otherwise it is an error:

```text
error: scenes/chapter-01-scene-02.md puts mara-quill at town-b 2h after scenes/chapter-01-scene-01.md at port-a, but the fastest route takes 6h
```

Only scene `date`, `time`, and `location` count; chapter dates and undated scenes are not used. The gap is always read as generously as the times allow, so only journeys impossible on any reading are reported. An exact `HH:MM` is a single moment. A named time covers a span: `dawn` 04:00 to 06:59, `morning` 05:00 to 11:59, `midday` 11:00 to 13:59, `afternoon` 12:00 to 17:59, `evening` 17:00 to 21:59, and `night` 20:00 to 23:59. A scene with no time covers the whole day.

## Analysis views

Several read-only commands turn the fields above into views and advisory findings. They never write project files (except `story diagram --out`), and apart from `story names` they exit 0 on a readable project. This section records which fields each one reads and the rules it applies; [Continuity and analysis](continuity.md) shows them in use.

### Pacing

`story pacing` reads chapter `hook`, `status`, and prose word counts, and each scene record's `sequel` and `outcome`. Per chapter it shows prose words, scene units, sequel units, the count of each `outcome`, and the `hook`; overall it shows the median chapter length and the share of recorded outcomes that are setbacks (`no`, `yes-but`, `no-and`). It warns when:

- a chapter at `draft` or later has no `hook`,
- three or more scene units in a row, in reading order and skipping sequels, end in `yes`,
- four or more scene units in a row have no sequel between them,
- three or more chapters in a row end on `resolution`, and
- once three chapters have prose, a chapter is over twice or under half the median length.

The [scene-craft](../skills/scene-craft/SKILL.md) and [chapter-writing](../skills/chapter-writing/SKILL.md) skills set `outcome` and `hook`.

### Clue grid

`story clues` is the fair-play view of the clue registry: a grid of clues by chapter (`P` planted, `R` revealed, `x` both), with `~` after the name of a red herring, sorted by planting chapter. For clues that are `planned`, `planted`, or `paid-off`, it warns when a clue:

- is revealed but never planted,
- is planted in the same chapter as its reveal or the chapter before it,
- lists no `characters` who could notice it, or
- is a red herring with no `payoff`.

It also warns when three or more genuine (non-red-herring) clues include none that is `significance-delayed`. `story continuity` still owns the hard ordering errors described under [Clues](#clues).

### Dialogue voices

`story voices` fingerprints each character's dialogue from the chapter prose. A quoted line (straight `"..."`, curly `“...”`, or British `‘...’`) is attributed when the paragraph's narration names the speaker next to a speech verb (`"...," Mara said`, `said Mara`, `Mara asked`) by full name, given name, or alias. A name-before-verb tag wins over verb-before-name, so `Sera told Kael` gives the line to Sera. Otherwise, when the narration names exactly one character (an action beat), the line is theirs. Names match case-sensitively as proper nouns, and titles are skipped for the given name (`Lord Maren` also matches `Maren`). Pronoun tags (`she said`) are never attributed, so in close third person the POV character is often under-counted. Any other quoted line is counted as unattributed and never guessed. Cut characters are skipped.

For each speaking character it reports lines, words, mean sentence length, contractions per 100 words, the share of sentences that are questions and exclamations, and up to five signature words: words of four or more letters, used at least twice, and used more than twice as often per word spoken as in everyone else's dialogue. It warns when:

- a character says a `voice-avoid` word,
- a character with five or more lines never says one of their `voice-words`, and
- two characters with five or more lines each have sentence lengths within 1.5 words, contraction rates within 1.5 per 100 words, and question and exclamation shares within 10 points.

### Name checks

`story names <name...>` checks candidate names before you use them, one name per argument (quote multi-word names). The existing names are character names, given names, and aliases (cut characters excepted); location, faction, artifact, and system names; and glossary terms and aliases. Names are compared ignoring case, accents, and punctuation.

A character's given name is the first word of the name that is not a title or article (`the`, `a`, `lord`, `lady`, `sir`, `captain`, `king`, `queen`, `dr`, and similar), so `Lord Maren Vell` is known as Maren. The candidate's given name is found the same way and compared with each character's given name; everything else is compared as a whole name.

- A candidate equal to a whole name, or whose given name equals a character's given name, is a clash: an error, and the command exits 1.
- Warnings flag look-alikes: words sharing their first four letters, or sharing an initial within an edit distance of 1 (2 when both words have five letters or more), and a given name sharing an initial with a protagonist, antagonist, deuteragonist, or narrator.
- Multi-word whole names are only checked for exact clashes, so pass the distinctive word of a multi-word name as well (`story names "Ashen Reach" Ashen`) to check it for look-alikes.

Each name prints as `clear`, `check`, or `taken`:

```text
Sera Blythe: taken
Kaela: check
Orrin: clear
Name check failed: 1 errors, 1 warnings, 0 dismissed
error: "Sera Blythe" clashes with character sera-voss (Sera)
warning: "Kaela" looks like character kael-voss (Kael Voss)
```

### Diagrams

`story diagram <kind>` prints [Mermaid](https://mermaid.js.org) source built from frontmatter, or writes it with `--out` (for example `--out dist/family.mmd`). GitHub, most markdown editors, and mermaid.live render it. It reads the same fields the checks trust, so rebuild the diagram after editing rather than hand-editing the output. Nothing is written while a project file fails to parse.

| Kind | Reads | Draws |
|------|-------|-------|
| `relationships` | character `relationships` and `status` | Every character, with one edge per related pair. Parent, grandparent, aunt, and uncle links are heavy arrows from the elder side; other family links (sibling, spouse, partner, cousin) are heavy lines; everything else is dotted. Deceased characters are dashed. This is the family tree. |
| `locations` | location `region` and `routes` | Every location with its region, joined by routes labelled with hours and mode. A two-way route is a line; a pair that declares a route each way is two arrows. |
| `timeline` | chapter and scene `date` and `time` | Dated scenes and chapters in story-time order, grouped by day, noting entries told out of order (the same data as `story timeline`). |
| `clues` | clue `planted`, `payoff`, `red-herring`, and `status` | Chapters in reading order, with an arrow from each clue's planting chapter to its reveal. Red herrings are dotted, and unrevealed clues point at a "not yet revealed" node. Dropped and abandoned clues are left out. |
| `arcs` | chapter and scene `arcs-advanced` | Each arc joined to the chapters whose chapter or scene records advance it. |

## Allowed values

These enumerations are shared by `story validate` and by the flags that set them: `--role`, `--type`, `--status`, `--category`, `--placement`, `--hook`, `--outcome`, `--accuracy`, `--confidence`, `--method`, and `--risk` on `story add`, and `--tense` and `--form` on `story init`. A flag refuses any other value, with the accepted list, before writing a file.

| Field | Values |
|-------|--------|
| Story `status` | `planning`, `drafting`, `in-progress`, `revising`, `complete`, `abandoned` |
| Story `tense` | `past`, `present`, `future`, `mixed` |
| Story `form` | `flash`, `short-story`, `novelette`, `novella`, `novel`, `serial`, `picture-book`, `chapter-book` |
| Revision pass `status` | `pending`, `in-progress`, `done` |
| Character `role` | `protagonist`, `antagonist`, `supporting`, `minor`, `narrator`, `deuteragonist` |
| Character `status` | `alive`, `deceased`, `unknown`, `missing`, `cut` |
| Faction `type` | `family`, `guild`, `government`, `military`, `religion`, `company`, `community`, `criminal`, `other` |
| Faction `status` | `active`, `hidden`, `declining`, `defeated`, `disbanded`, `unknown` |
| Artifact `type` | `object`, `weapon`, `document`, `technology`, `relic`, `symbol`, `resource`, `other` |
| Artifact `status` | `active`, `lost`, `destroyed`, `hidden`, `transferred`, `unknown` |
| Arc `type` | `main`, `subplot`, `character`, `thematic` |
| Arc `status` | `planned`, `in-progress`, `resolved` |
| Chapter and scene `status` | `outline`, `draft`, `revised`, `final`, `complete` |
| Chapter `hook` | `cliffhanger`, `question`, `revelation`, `reversal`, `decision`, `emotional`, `resolution` |
| Scene `outcome` | `yes`, `no`, `yes-but`, `no-and` |
| Question `status` | `open`, `answered`, `resolved`, `dropped`, `abandoned` |
| Promise and clue `status` | `planned`, `planted`, `paid-off`, `dropped`, `abandoned` |
| Glossary `category` | `person`, `place`, `faction`, `artifact`, `concept`, `term`, `other` |
| Matter `placement` | `front`, `back` |
| Matter `permission` | `not-needed`, `pending`, `granted`, `public-domain` |
| Research `status` | `open`, `verified`, `disputed` |
| Research `accuracy` | `must-be-accurate`, `blended`, `invented` |
| Research `confidence` | `high`, `medium`, `low` |
| Research `method` | `fact`, `interview`, `site-visit`, `expert-review`, `reading` |
| Research `risk` (list) | `legal`, `medical`, `weapons`, `safety`, `cultural`, `defamation`, `technical` |
| Style sheet `dialect` | `british`, `american`, `unspecified` |

Location and system `type` are free text. `language` in `story.md` has no fixed list, but must be a BCP 47 tag, and `subjects` must be BISAC codes (see [Publishing metadata](#publishing-metadata)). The print build's `--trim` takes `5x8`, `5.25x8`, `5.5x8.5` (the default), `6x9`, or `a5`. An unsupported value fails validation with the file and field:

```text
Project validation failed: 1 errors, 0 warnings, 0 dismissed
error: characters/kael-voss.md frontmatter field status has unsupported value dead
```

### What the status values mean

Most status values are labels for you and the skills; the CLI only checks that they are allowed. The tables below define each workflow status and note where the CLI treats it specially. Where two values behave identically, pick one and use it consistently across the project.

**Story status** (`story.md`):

| Value | Meaning | CLI behaviour |
|-------|---------|---------------|
| `planning` | Building the bible, cast, and outline; little or no prose yet. | `story init` default. |
| `drafting`, `in-progress` | The first draft is being written. | None; the CLI treats the two the same. |
| `revising` | The draft is finished and under revision. | `story next` recommends the current [revision pass](#revision-passes), or `story passes --init` when none are recorded. The [submission skill](../skills/submission/SKILL.md) accepts `revising` or `complete`. |
| `complete` | The book is finished. | `story continuity` errors on any `open` question and any `planned` or `planted` promise or clue. `story validate` warns when the manuscript length is outside the `form` range and when a matter page's `permission` is still `pending`. |
| `abandoned` | The project is shelved. | None. |

**Chapter and scene status:**

| Value | Meaning | CLI behaviour |
|-------|---------|---------------|
| `outline` | Planned, with no prose yet. | `story add` default. `story continuity` measures promise and clue gaps and the staleness of `continuity/state.md` against the latest chapter past `outline`, so outline-only chapters do not count as drafted. |
| `draft` | Prose exists but has not been revised. | `story import` gives imported chapters this status. From `draft` on, `story pacing` warns about a chapter with no `hook`. |
| `revised` | Revised at least once. | None. |
| `final`, `complete` | The prose is settled. | For chapters, `story validate` warns when the chapter relies on an `open` or `disputed` research note, or on a note with a `risk` and no `reviewed-by`. The CLI treats the two the same. |

Scene status is not read by any check beyond validation; chapter status drives the behaviour above.

**Question status:**

| Value | Meaning | CLI behaviour |
|-------|---------|---------------|
| `open` | Raised and not yet answered. | `story add question` default without `--resolved`. Error if `resolved` is set, and when `story.md` is `complete`. Counted by `story next`. |
| `answered`, `resolved` | Answered on the page. | `story add question --resolved` defaults to `answered`. Error if no `resolved` chapter is recorded. The CLI treats the two the same. |
| `dropped` | Deliberately left unanswered, but still part of the book. | Still checked: `resolved` must not come before `introduced`. |
| `abandoned` | Cut from the book, kept on record. | Skipped entirely by `story continuity`. |

**Promise and clue status:**

| Value | Meaning | CLI behaviour |
|-------|---------|---------------|
| `planned` | Intended, not yet on the page. | `story add` default without `--planted`. Warning if a `planted` chapter is recorded (promises only). Error when `story.md` is `complete`. Counted by `story next`. |
| `planted` | On the page, awaiting payoff. | `story add` default with `--planted`. Error if no `planted` chapter; gap warning when the payoff is overdue; error when `story.md` is `complete`. Counted by `story next`. |
| `paid-off` | The payoff has landed. | Error if no `payoff` chapter is recorded. |
| `dropped` | The setup stays in the book but will not be paid off. | No gap warning and no completion error, but still checked: `payoff` must not come before `planted`. |
| `abandoned` | The thread was cut, usually during discovery drafting, and kept on record. | Skipped entirely by `story continuity`. |

So `dropped` and `abandoned` differ only in how much checking remains: a dropped entry still has its chapter order checked, while an abandoned one is ignored by `story continuity` altogether. The [discovery-drafting skill](../skills/discovery-drafting/references/dead-ends.md) uses `abandoned` for cut threads.

## Scanning limits and safety

The CLI refuses to read or write project files outside the project root. The exceptions are deliberate: an absolute `--out` path for `story export`, `story build`, `story synopsis`, or `story diagram`, and the linked books that `follows` and `precedes` name. It applies these limits while scanning:

- A file larger than 5 MiB is refused with an error.
- More than 5,000 entity files in one directory, or more than 5,000 markdown files found in one recursive scan, stops the command with an error.
- Recursive scans stop with an error beyond 10 directory levels.
- A symlinked entity directory, or any path that resolves outside the project, is refused with an error. A symlinked `.md` file inside an entity directory is not an entity: the scan skips it without a warning. The CLI never writes through a symlink, and `story init` refuses a symlinked project directory.
- Recursive scans (stray-file checks, `story rename`, `story remove`) skip `dist/` and directories whose names start with `.`.

A file that fails to parse is reported as an error against its path. The rest of the project is still checked.

## JSON schema

[`schemas/story.schema.json`](../schemas/story.schema.json) describes the same contract in JSON Schema (draft 2020-12), for editors and external tooling. It validates one aggregate document rather than individual files:

- `story` holds the `story.md` frontmatter.
- Each entity directory becomes an array of frontmatter objects, each with its filename-derived `id` added: `characters`, `worldbuilding.locations`, `plot.arcs`, `chapters`, `scenes`, `continuity.questions`, `glossary`, `matter`, `research`, and so on.
- `continuity` also holds the `continuity/state.md` fields and the `exemptions` list.
- `styleSheet` and `progressLog` hold the optional root files.

The schema also lists values the CLI does not enforce, such as character `arc-type`. It is looser than the CLI elsewhere: it checks the shape of `isbn`, `publication-date`, and `language`, but not ISBN checksums, real calendar days, or whether a referenced id exists. In this repository, `bun run test:examples` builds that document for every project in [`examples/`](../examples/) and checks it against the schema with the dependency-free validator in [`scripts/check-schema.js`](../scripts/check-schema.js), so change the schema, the CLI, and the examples together. The [Development guide](development.md#schema) covers the checks.

## Migrating older projects

Projects created before schema v2 lack the scenes, continuity, and glossary layers, and declare an older `schema-version`. `story migrate` upgrades them in place:

```shell
story migrate .
story reindex .
story validate .
```

Migration:

1. creates every folder `story init` creates (`characters`, the four `worldbuilding` entity folders, `plot/arcs`, `chapters`, `scenes`, the three `continuity` ledgers, and `glossary/terms`) when it is missing,
2. creates `scenes/_index.md`, `continuity/state.md`, and the question, promise, clue, and glossary registries when they are missing,
3. sets `schema-version: 2` in `story.md` when it is missing or has any other value, leaving the rest of the file as it was, and
4. runs `story reindex`, which also rebuilds (or creates) the character, world, plot, and chapter registries.

Apart from that `schema-version` edit and the reindex, it leaves existing files alone, and it never invents creative content. It reports the number of files and directories it created or changed. Running it again is safe:

```text
$ story migrate .
Migrated project to current schema: 15 changes
$ story migrate .
Project already uses the current schema
```

Migration does not create `plot/timeline.md`. If `story validate` still reports a missing required path, fill the gaps with `story init --force`, which adds missing starter files and never overwrites existing ones (it also adds `style-sheet.md` if you have none). Use the book's exact title, then reindex:

```shell
story init "Harbor of Second Light" --dir . --force
story reindex .
story validate .
```

After migrating, `story validate` warns about each chapter that has no scene records. Add scenes with `story add scene` when you next work on those chapters; the [chapter-writing skill](../skills/chapter-writing/SKILL.md) and [Writing workflows](writing-workflows.md) describe how scene records fit into drafting.

## See also

- [Core concepts](concepts.md): the ideas behind the format
- [CLI reference](cli-reference.md): the commands that read and write these files
- [Continuity and analysis](continuity.md): what `story continuity` does with the continuity fields
- [Series](series.md): the series fields in use across linked books
- [Documentation index](README.md): every page, by audience and task

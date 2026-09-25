# Series

This page is for writers working on more than one book in the same world: sequels, prequels, and trilogies. It covers how books link to each other, how `story init` creates a linked book, what `story series` checks, and how to carry characters and facts from one book to the next.

**On this page**

- [How a series is modelled](#how-a-series-is-modelled)
- [The example series](#the-example-series)
- [Starting a linked book](#starting-a-linked-book)
- [The `story series` command](#the-story-series-command)
- [Checking series links](#checking-series-links)
- [Carrying canon between books](#carrying-canon-between-books)
- [Writing against canon](#writing-against-canon)
- [The series-continuity skill](#the-series-continuity-skill)
- [Maintenance checklist](#maintenance-checklist)

## How a series is modelled

Each book is still an ordinary Story Skills project, with its own `story.md`, characters, worldbuilding, chapters, and continuity files. There is no series-level folder or shared database. Books are linked through four optional fields in `story.md`:

| Field | Type | Meaning |
|-------|------|---------|
| `series` | kebab-case id | The series this book belongs to, such as `the-ember-cycle`. Every book in the series uses the same id. |
| `book-number` | positive integer | Publication order: 1, 2, 3. Must be unique within the series. |
| `follows` | list of paths | Books set **earlier** in the story's chronology. |
| `precedes` | list of paths | Books set **later** in the story's chronology. |

`follows: [X]` reads as "this book follows X in story time"; `precedes: [X]` reads as "this book comes before X in story time".

Chronology and publication order are separate on purpose. `follows` and `precedes` describe when the story happens; `book-number` describes the order readers get the books. A prequel written after the first book has `book-number: 2` and `precedes: [../book-one]`.

Link paths are relative to the book's root folder. `story init` writes them with forward slashes, so `story.md` stays portable across operating systems. Keep the books side by side in one parent folder so the paths are short:

```text
the-ember-cycle/
├── the-fall-of-the-citadel/   # book 2, set first
│   └── story.md               # precedes: [../the-last-ember]
└── the-last-ember/            # book 1, set second
    └── story.md               # follows: [../the-fall-of-the-citadel]
```

Every link needs a backlink. If book two `follows: [../book-one]`, book one must list `precedes: [../book-two]`. `story links` reports a missing backlink as an error (see [Checking series links](#checking-series-links)).

`story validate` checks the field shapes: `series` must be a single kebab-case id, `book-number` must be a positive integer, and `follows` and `precedes` must be lists of non-empty strings. A single string such as `follows: ../book-one` fails validation with `story.md frontmatter field follows must be a list`. The full field reference is in [Project format reference](project-format.md).

## The example series

The repository ships a two-book series, the Ember Cycle, in [`examples/`](../examples/):

| Book | `book-number` | Chronology | Status |
|------|---------------|------------|--------|
| [The Fall of the Citadel](../examples/the-fall-of-the-citadel/story.md) | 2 | First: the coup, twelve years earlier | `planning` |
| [The Last Ember](../examples/the-last-ember/story.md) | 1 | Second: Sera returns to the citadel | `in-progress` |

The Last Ember was published first, and The Fall of the Citadel is a prequel. Their frontmatter:

```yaml
# examples/the-fall-of-the-citadel/story.md
series: the-ember-cycle
book-number: 2
precedes:
  - ../the-last-ember
```

```yaml
# examples/the-last-ember/story.md
series: the-ember-cycle
book-number: 1
follows:
  - ../the-fall-of-the-citadel
```

The prequel also shows the conventions described in [Carrying canon between books](#carrying-canon-between-books): a `## Series Notes` section in its `story.md`, a `## Series Canon` section in its character and location files, `General Maren` as an alias for the character the later book calls `Lord Maren`, and a shared `whisper-gate-route` fact id in both books' `continuity/state.md`.

## Starting a linked book

Run `story init` from the folder that contains the existing book, and pass the link option that matches the new book's place in the chronology:

```shell
# Sequel to The Last Ember, the latest book in story time
story init "Embers of the Vale" --follows the-last-ember --synopsis "Two years after the citadel falls a second time."

# Prequel to The Fall of the Citadel, the earliest book in story time
story init "The Ember Wars" --precedes the-fall-of-the-citadel
```

Each command links to the book at one end of the chronology. The sequel goes after The Last Ember; the prequel goes before The Fall of the Citadel, which makes it the new earliest book in the series.

A companion book is set alongside another with no chronological relationship. Create it with `--series` and the same id, and no `--follows` or `--precedes`. Without a link, `init` has no book to inherit from, so pass `--book-number` if you want the companion numbered, plus any craft settings you want to match. `story series` discovers books only by following links, so it does not see an unlinked companion.

### Series options for `init`

| Option | Effect |
|--------|--------|
| `--series <id>` | Sets `series`. Must be kebab-case. Overrides the id inherited from a linked book. |
| `--book-number <n>` | Sets `book-number`. Must be a positive integer. Overrides the computed number. |
| `--follows <path>` | Links a book set earlier in the chronology. Repeatable. |
| `--precedes <path>` | Links a book set later in the chronology. Repeatable. |

`--follows` and `--precedes` paths resolve against the directory you run `story init` from, not against the new book. `init` rewrites them relative to the new book's root.

### What `init` does with a link

For each `--follows` or `--precedes` path, `init`:

1. Checks that the path contains a `story.md`. If it does not, `init` stops before creating any files.
2. Writes the link into the new book's `story.md`, relative to the new book's root.
3. Adds the backlink to the linked book's `story.md` (`precedes` for a `--follows` link, `follows` for a `--precedes` link) and prints `Linked series backlink in <path>/story.md`. If the linked book already lists the new book, nothing is written and no line is printed. Only frontmatter changes; the linked book's comments and body text are left as they were. A link written as a single string by hand is kept and converted to a list.
4. Inherits `series` from the first linked book that has one, unless you pass `--series`.
5. Inherits `genre`, `sub-genre`, `pov`, and `tense` from the first linked book, unless you pass `--genre`, `--sub-genre`, `--pov`, or `--tense`. `setting-era`, `themes`, and `form` are not inherited; pass `--form` if the new book has one.
6. Sets `book-number` to one more than the highest `book-number` anywhere in the linked series, not just the directly linked books, so publication numbers never collide.

If no book in the series has a `book-number`, the new book is left unnumbered. A book created by a plain `story init` has no `book-number`, so when you link your first sequel to it, pass `--book-number 2` and add `book-number: 1` to the first book by hand. If the first book has no `series` yet, pass `--series <id>` and add the same `series` to the first book as well.

`init --force` on an existing folder keeps the existing `story.md`. It only adds backlinks when the run actually wrote the new `story.md`, so a rerun never adds a backlink the new book does not mirror.

### Example: a sequel to The Last Ember

Running the sequel command from [Starting a linked book](#starting-a-linked-book) in a copy of the example series prints:

```text
Created story project: /path/to/series/embers-of-the-vale
Linked series backlink in /path/to/series/the-last-ember/story.md
```

The new book inherits the series id and craft settings, and numbers itself after The Fall of the Citadel (book 2), even though it links only to The Last Ember (book 1):

```yaml
---
title: Embers of the Vale
schema-version: 2
series: the-ember-cycle
book-number: 3
genre: fantasy
sub-genre: epic
setting-era: unspecified
status: planning
themes:
  - change
pov: third-person-limited
tense: past
follows:
  - ../the-last-ember
---
```

The Last Ember's `story.md` gains the backlink:

```yaml
precedes:
  - ../embers-of-the-vale
```

### `init` errors

| Message | Cause |
|---------|-------|
| `--follows <path> points at the new story itself` | The link resolves to the folder `init` is about to create. |
| `--precedes <path> is not a story project: missing story.md` | The linked folder has no `story.md`. |
| `Series id must be kebab-case: <id>` | The `--series` value, or the inherited one, is not a kebab-case id. |
| `Book number must be a positive integer` | `--book-number` is zero, negative, or not a whole number. |

## The `story series` command

```shell
story series [path]
```

`story series` starts at the book at `path` (default: the current directory), follows every `follows` and `precedes` link to discover the rest of the series, orders the books by chronology, lists the canon they share, and checks it for contradictions. It exits `0` when there are no errors and `1` otherwise. Warnings do not change the exit code. You can also give the path with `--path <path>`.

Running it on The Last Ember:

```shell
story series examples/the-last-ember
```

```text
# Series: the-ember-cycle

Chronological order:
1. The Fall of the Citadel (book 2, planning) - ../the-fall-of-the-citadel
2. The Last Ember (book 1, in-progress) - .

Shared canon:
- Characters: kael-voss, lord-maren, sera-voss
- Locations: ashen-citadel
- Systems: ember-magic
- Facts: whisper-gate-route

Series is consistent: 0 errors, 0 warnings, 0 dismissed
```

Each book line shows its title, its `book-number` (or `unnumbered`), its `status` (or `no status`), and its path relative to the book you ran the command on. `.` is that book. Running it on The Fall of the Citadel lists the same books in the same order; only the paths change, since they are relative to the book you start from. The report goes to standard output, and the summary line plus any `error:` and `warning:` lines go to standard error.

`story series` works on a standalone book too. It reports a one-book `Unnamed series` with `- None` under `Shared canon:` and exits `0`. A path with no `story.md` fails with `<absolute path> is not a story project: missing story.md` and exit code `1`.

### Ordering

`follows` and `precedes` form a directed graph, and the books are listed in an order that respects every edge. When two books have no chronological constraint between them, the lower `book-number` comes first, unnumbered books come after numbered ones, and remaining ties are broken by title. The order is deterministic.

If the links contain a cycle, for example two books that each `precede` the other, the command reports an error, prints `Books (unordered):` instead of `Chronological order:`, and skips the canon checks.

Discovery follows links in both directions from every book it reaches, so a book is found even when its backlink is missing. Missing backlinks are reported by [`story links`](#checking-series-links), not by `story series`.

### Shared canon

The `Shared canon` section lists every id that appears in more than one book, grouped by kind. Entities are matched by id, which is their filename without `.md`:

| Label | Compared records |
|-------|------------------|
| Characters | `characters/*.md` |
| Locations | `worldbuilding/locations/*.md` |
| Systems | `worldbuilding/systems/*.md` |
| Factions | `worldbuilding/factions/*.md` |
| Artifacts | `worldbuilding/artifacts/*.md` |
| Glossary terms | `glossary/terms/*.md` |
| Facts | `fact` ids in `continuity/state.md` `knowledge-state` |

### What it checks

Each book is compared with every book set earlier in the chronology: every book that comes before this one through any chain of `follows` or `precedes` links, as read from either book. A link counts even when the other book is missing its backlink.

| Level | Finding | Fix |
|-------|---------|-----|
| error | A linked path is not a story project (`missing story.md`), or a linked book fails to parse. | Correct the path, or fix the linked book's frontmatter. |
| error | Linked books declare different `series` ids. | Use one id in every book. |
| error | Two books share a `book-number`. | Give each book a unique publication number. |
| error | The chronology has a cycle. | Check `follows` and `precedes` in the named books. |
| error | A character is `deceased` in an earlier book but has another status (or none) in a later one. | Set `status: deceased` in the later book's character file. |
| error | A later book's chapter or scene lists a character who died in an earlier book as `pov` or under `characters`. | Move flashbacks, memories, and ghosts to `mentions`. |
| error | A later book's `knowledge-state` has a character learn a `fact` (an entry with `learned-in`) that the same character already knows in an earlier book. | Drop `learned-in` in the later book, or move the discovery. In a prequel, usually remove the knowledge from the prequel. |
| warning | A shared entity's `name` (or a glossary term's `term`) differs from the most recent earlier book that defines it. | Keep `name` identical and put the variant in `aliases`. |
| warning | An artifact is `destroyed` in an earlier book but has another status in a later one. | Set `status: destroyed`, or account for the artifact's return in the text. |

The name check compares each book with the most recent earlier book that defines the entity, so a rename carried consistently through a trilogy is reported once, not once per book.

`story series` findings are not affected by `continuity/exemptions.md`; the `dismissed` count is always 0.

### Example failure

In a copy of the example series, Lord Maren is marked `deceased` at the end of The Last Ember, and a careless sequel carries him as `alive`, gives him the point of view in chapter 1, renames Sera, and has Kael discover a route he already knew in the prequel. Running `story series .` in the sequel exits `1`:

```text
# Series: the-ember-cycle

Chronological order:
1. The Fall of the Citadel (book 2, planning) - ../the-fall-of-the-citadel
2. The Last Ember (book 1, in-progress) - ../the-last-ember
3. Embers of the Vale (book 3, planning) - .

Shared canon:
- Characters: kael-voss, lord-maren, sera-voss
- Locations: ashen-citadel
- Systems: ember-magic
- Facts: whisper-gate-route

Series check failed: 3 errors, 1 warnings, 0 dismissed
error: characters/lord-maren.md has status alive, but lord-maren is deceased in earlier book The Last Ember; set status: deceased
error: chapters/chapter-01.md lists lord-maren, who died in earlier book The Last Ember; move appearances to mentions
error: continuity/state.md knowledge-state[0] has kael-voss learn whisper-gate-route in chapter-01, but they already know it in earlier book The Fall of the Citadel (../the-fall-of-the-citadel/continuity/state.md knowledge-state[1])
warning: characters/sera-voss.md name "Queen Sera" differs from "Sera Voss" in ../the-last-ember/characters/sera-voss.md
```

The knowledge error reaches back two books: Kael knows `whisper-gate-route` in the prequel, so no later book can have him learn it on the page.

### Traversal limits

`story series` only follows links that stay inside the parent folder of the book you run it on, which is why sibling folders are the recommended layout. A link that leaves that folder, directly or through a symlink, is reported as an error (`points outside the series directory`) and not followed. A book reached through a symlink and through its real path counts as one book.

The traversal also stops at 100 books and at a link depth of 10 from the starting book, reporting an error when either limit is hit.

### What it cannot check

The checker compares ids, statuses, names, and fact ids. It cannot judge knowledge that has no `fact` id, ages, dates, travel time, or tone. Check those by reading both books' `plot/timeline.md` files and their `Series Notes` and `Series Canon` sections.

## Checking series links

`story links` checks the current book's own series links, alongside its other cross-references. For each path in `follows` and `precedes` it reports:

| Error | Meaning |
|-------|---------|
| `story.md follows <path> is not a story project: missing story.md` | The linked folder has no `story.md`. |
| `story.md follows <path>: <parse error>` | The linked book's `story.md` cannot be parsed. |
| `story.md follows <path> points at this book` | The link resolves to the book itself. |
| `story.md follows <path> is missing backlink: add <path> to its precedes` | The linked book does not link back. |
| `story.md follows <path> belongs to series <id>, not <id>` | Both books set `series` and the ids differ. |

The same messages appear with `precedes` for links in that field. With the backlink removed from The Last Ember, `story links` in the sequel reports:

```text
error: story.md follows ../the-last-ember is missing backlink: add ../embers-of-the-vale to its precedes
```

`story report` and `story doctor` include the link check only as a count (`Links: failed (N errors, 0 warnings)` in the report, a `Fix broken references` action in the doctor output), so run `story links` to see the messages.

`story report` also shows the series id and publication number when they are set:

```text
# The Fall of the Citadel

Story ID: the-fall-of-the-citadel
Schema version: 2
Series: the-ember-cycle (book 2)
Status: planning
```

See the [CLI reference](cli-reference.md) for every command.

## Carrying canon between books

`init` links the books but copies nothing else. You carry characters and places across yourself, or with the [series-continuity skill](#the-series-continuity-skill). Carry only the entities the new book uses. For each one, copy the file from the other book, then adjust it:

- **Keep the filename id identical.** `story series` matches entities by id. A renamed file is a new entity to the checker.
- **Keep `name` identical.** Put new titles and epithets in `aliases`. In the example, the prequel's `lord-maren.md` keeps `name: "Lord Maren"` and lists `General Maren` as an alias.
- **Keep the voice and sound fields.** `voice-words`, `voice-avoid`, and `pronunciation` travel with the file, so `story voices` checks the character against the same voice in every book, and an audiobook narrator says the name the same way.
- **Set state for this book's starting point.** For a sequel, start from the earlier book's final `status`, relationships, ownership, and knowledge. For a prequel, start from the earlier situation and record the later book's facts as fixed endpoints in a `## Series Canon` section of the entity file.
- **Remove book-local references.** `died-in` and every other chapter id points at chapters in the source book. For a character who died before this book begins, keep `status: deceased` and remove `died-in`.
- **Carry or prune every link.** Relationships, `locations`, `notable-characters`, location `routes`, faction `members`, and artifact `owner` and `location` must point at entities that exist in this book, with backlinks where the field needs one. Carry the linked entity too, or remove the reference. `story links` reports what you missed, for example `characters/lord-maren.md references missing location ashen-citadel`.
- **Do not copy** chapters, scenes, arcs, questions, promises, clues, or `continuity/state.md`. Rebuild them:
  - Open questions or promises the new book continues become new files in its `continuity/` folders.
  - Events from the other book become rows in the `## Backstory Events` table of `plot/timeline.md` (sequel), or `## Series Canon` notes (prequel). The Last Ember's timeline records the coup from the prequel this way.
  - `continuity/state.md` starts at `current-chapter: 0` with the carried character and object state.

Record the book's place in the series in a `## Series Notes` section of its `story.md` body: where it sits in the chronology, the time gap to the linked books, and the canon it must not contradict. The prequel example's notes:

```markdown
## Series Notes

- Book 2 in publication order, but set first in the chronology of the Ember Cycle.
- Canon fixed by The Last Ember: King Aldric and Queen Elara die in the coup; Sera (16) and Kael (12) escape through the tunnels into the Whispering Vale; Maren seals the ember well and burns out his own affinity.
- Sera, Kael, and Maren must end this book alive and in the states The Last Ember opens with.
```

### Fact ids

Knowledge only carries across books when it has a stable `fact` id in `continuity/state.md`. Use the same id in every book:

```yaml
knowledge-state:
  - character: kael-voss
    knows: The tunnel behind the musicians' gallery reaches the Whisper Gate
    fact: whisper-gate-route
```

- `story series` matches the character id plus the fact id, never the `knows` text, so the wording can differ between books. The two example books describe the Whisper Gate route differently and still match.
- Add `learned-in` only in the book where the character discovers the fact on the page. In every later book, carry the entry without `learned-in`, because the character already knew it when the book began.
- Fact ids are kebab-case, and a character lists a given fact once per book. `story continuity` checks both rules; see [Continuity and analysis](continuity.md).
- Do not explain the rule in an inline comment after `learned-in`. The frontmatter parser keeps `# ...` as part of the value, and `story continuity` then reports a missing chapter.
- Give ids to the reveals, secrets, and discoveries that another book depends on. Everyday knowledge does not need one.

## Writing against canon

- **Sequels.** Before drafting, reread the earlier book's final chapters, `continuity/state.md`, and every open question and promise. Decide which threads the new book picks up.
- **Prequels.** The later book is canon. Every fixed endpoint must still be reachable by the end of the prequel. Do not mark a character `deceased` who is alive in a later book, and do not give a character knowledge that a later book shows them learning for the first time. Before drafting, list the later book's `fact` ids that have `learned-in`, and keep those facts out of the prequel.
- **Revising an earlier book** after later books exist: run `story series .` before and after the revision. When canon changes, update the later books' `Series Notes` and carried entity files.
- **New names.** [`story names`](continuity.md#story-names) checks candidates against the current book only. Before settling a name in a later book, run it against each earlier book too (`story names "Ilse" --path ../the-last-ember`), so a new minor character does not echo a major one from book one.

A translated or adapted edition is not a new book in the series. It is a copy of the same book, so the [`adaptation`](../skills/adaptation/SKILL.md) skill removes `series`, `book-number`, `follows`, and `precedes` from the edition's `story.md`; copied values would point at the source series and break `story links` and `story series`. A translated series links its own translated books to each other in the same way the source series does.

Serial and episodic installments inside a single book are a different layer; see the `genre-craft` skill's [serial and episodic reference](../skills/genre-craft/references/serial-episodic.md).

## The series-continuity skill

The [`series-continuity`](../skills/series-continuity/SKILL.md) skill runs this workflow for an agent. It triggers on requests such as "write a sequel", "start book two", "write a prequel", "companion novel", or "series bible". It:

1. Reads the existing book: `story.md`, the character and world registries, `plot/timeline.md`, `continuity/state.md`, open questions and promises, and the final chapters.
2. Asks you for the title, synopsis, relationship (sequel, prequel, or companion), time gap, and returning characters and places.
3. Creates the book with `story init --follows` or `--precedes`, then adds `Series Notes`.
4. Carries the entities you choose, following the rules above, and assigns `fact` ids.
5. Runs the maintenance checks.

Other skills defer to it: `story-init` sends sequel and prequel requests there, `chapter-writing` gives series-relevant reveals a `fact` id when `story.md` has `follows` or `precedes`, and `revision-continuity` and `story-maintenance` add `story series .` to their checks for linked books. See the [Skills catalogue](skills.md#series-continuity).

## Maintenance checklist

After changing series links or carried entities, run these in each affected book:

```shell
story reindex .
story links .
story validate .
story continuity .
story series .
```

`reindex` rebuilds the registries after you copy entity files in, `links` checks series links and carried references, `validate` checks the series fields, `continuity` checks fact ids within the book, and `series` checks canon across books. To run them in CI, see [Automation and CI](automation.md).

## See also

- [Project format reference](project-format.md#story-file): the `series`, `book-number`, `follows`, and `precedes` fields
- [CLI reference](cli-reference.md#series): `story series` options and output
- [Continuity and analysis](continuity.md#continuity-state): `knowledge-state` and `fact` ids within one book
- [Skills catalogue](skills.md#series-continuity): the `series-continuity` skill
- [Documentation index](README.md): every page, by audience and task

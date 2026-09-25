---
name: series-continuity
description: This skill should be used when the user asks to "write a sequel", "write a prequel", "start book two", "continue the series", "companion novel", "spin-off", "link books in a series", "carry characters into the next book", "series continuity", "series bible", or needs to keep canon consistent across multiple Story Skills projects.
---

# Series Continuity

## Overview

Plan and maintain sequels, prequels, and companion books as linked Story Skills projects. Each book stays a standalone project with its own `story.md`, characters, world, chapters, and continuity files. Books point at each other through `story.md` frontmatter, and `story series` checks the canon they share.

- `series` - kebab-case series id shared by every book, such as `the-ember-cycle`
- `book-number` - publication order (1, 2, 3...)
- `follows` - paths to books set **earlier** in the story's chronology
- `precedes` - paths to books set **later** in the story's chronology

Chronology and publication order are separate. A prequel written after the first book has `book-number: 2` and lists `../book-one` under `precedes`.

This skill owns the book-level layer: linked books and the canon they share. The within-serial installment layer — how serial or episodic installments are structured — is covered by the `genre-craft` skill's serial/episodic structure reference.

Links are relative paths from the book root, and every link needs a matching backlink: if book two lists `../book-one` under `follows`, book one must list `../book-two` under `precedes`. Keep sibling books in the same parent folder so the paths stay short and portable.

## When to Use

- Starting a sequel, prequel, interquel, or companion book to an existing project
- Carrying characters, locations, systems, factions, artifacts, or glossary terms into another book
- Revising a book that other books in the series depend on
- NOT for a single standalone book (use `story-init`) or for within-book continuity (use `revision-continuity`)

## Starting a Linked Book

1. Read the existing book first: `story.md`, `characters/_index.md`, `worldbuilding/_index.md`, `plot/timeline.md`, `continuity/state.md`, open files in `continuity/questions/` and `continuity/promises/`, and the final chapters.
2. Ask the user for:
   - Title and synopsis
   - Relationship: sequel (set after), prequel (set before), or companion (set alongside, with no chronology link)
   - How much time passes between the books
   - Which characters and places return
3. Create the project with the CLI, run from the folder that contains the existing book:

```shell
# Sequel: set after book one
story init "{Title}" --follows {existing-book-dir} --synopsis "{synopsis}"

# Prequel: set before book one
story init "{Title}" --precedes {existing-book-dir} --synopsis "{synopsis}"
```

`init` checks that the linked path is a story project, writes the relative link, adds the backlink to the existing book's `story.md`, and inherits `series`, `genre`, `sub-genre`, `pov`, and `tense`. When any book in the linked series has an integer `book-number`, it sets `book-number` to one more than the highest number used anywhere in the series, so publication numbers never collide. A normal `story init` book has none, so a series with no numbered books leaves the new book unnumbered. Pass `--book-number` (or write the field on both `story.md` files) in that case. Pass `--series`, `--genre`, `--pov`, or `--tense` to override the inherited values.

If the existing book has no `series` yet, pass `--series {series-id}` and add the same `series` plus `book-number` values to both `story.md` files.

If the CLI is not available, add the fields to both `story.md` files by hand.

4. Add a `## Series Notes` section to the new `story.md` body. Record where the book sits in the chronology, the time gap, and the canon facts it must not contradict.

## Carrying Canon Across Books

Only carry entities the new book actually uses. For each one, copy the file from the other book and then adjust it:

- **Keep the filename id identical.** `story series` matches entities across books by id. A renamed file is a new entity to the checker.
- **Keep `name` identical.** Put new titles or epithets in `aliases`, such as `General Maren` in a prequel for `Lord Maren`. A different `name` produces a warning.
- **Set state for this book's starting point, not the source book's ending.**
  - Sequel: start from the earlier book's final `status`, relationships, ownership, and knowledge.
  - Prequel: start from the earlier situation, and write the later book's facts as fixed endpoints in a `## Series Canon` section.
- **Remove book-local references.** `died-in` and every other chapter id points at chapters in the source book. For a character who died before this book begins, keep `status: deceased` and remove `died-in`.
- **Prune or carry every link.** Relationships, `locations`, `notable-characters`, faction `members`, and artifact `owner`/`location` must point at entities that exist in this book, with backlinks. Either carry the linked entity too, or remove the reference.
- **Do not copy** chapters, scenes, arcs, questions, promises, or `continuity/state.md`. Rebuild them for the new book:
  - Unresolved questions or promises the new book continues become new files in its `continuity/` folders.
  - Events from the other book become `Backstory Events` rows in `plot/timeline.md` (sequel) or `Series Canon` notes (prequel).
  - `continuity/state.md` starts at `current-chapter: 0` with the carried character and object state. Carried knowledge goes in `knowledge-state` without `learned-in`, because the character already knew it when the book began.

## Fact Ids

Give series-relevant knowledge a stable `fact` id in `continuity/state.md`, and use the same id in every book:

```yaml
knowledge-state:
  - character: kael-voss
    knows: The gallery tunnel reaches the Whisper Gate
    fact: whisper-gate-route
    learned-in: chapter-04
```

- Fact ids are kebab-case, and each character lists a given fact only once per book. `story continuity` checks both rules.
- Add `learned-in` only in the book where the character discovers the fact on the page. In later books, carry the entry without `learned-in`. Do not put that rule in an inline comment: the parser keeps `# ...` as part of the chapter id, and `story continuity` then reports a missing chapter.
- Reuse the exact id in every book. The checker matches the character id plus the fact id, never the `knows` text.
- Give ids to the reveals, secrets, and discoveries a later or earlier book depends on. Everyday knowledge does not need one.

After carrying entities, run in the new book:

```shell
story reindex .
story links .
story validate .
story series .
```

## What `story series` Checks

`story series [path]` finds every book reachable through `follows` and `precedes`, then orders them by chronology. Books with no chronology constraint between them are ordered by `book-number`, then title. It lists shared canon and reports:

- **Errors**
  - A linked path that is not a story project
  - Books that declare different `series` ids
  - Two books that share a `book-number`
  - A chronology cycle
  - A character who is `deceased` in an earlier book but not `deceased` in a later one
  - A later book whose chapter or scene lists that character as `pov` or under `characters`. Move flashbacks, memories, and ghosts to `mentions`.
  - A later book where a character learns a `fact` (an entry with `learned-in`) that the same character already knows in an earlier book. In a prequel, the usual fix is to remove the knowledge from the prequel, or to change which book the discovery happens in.
- **Warnings**
  - A shared entity whose `name` (or glossary `term`) differs from the most recent earlier book
  - An artifact that is `destroyed` in an earlier book but has a different status in a later one

`story links .` also checks the book's own series links: each path exists, has a matching backlink, and uses the same `series` id.

The checker cannot judge knowledge without fact ids, or ages, dates, travel time, or tone. Check those by reading both books' timelines and `Series Canon` notes.

## Writing Against Canon

- **Sequels:** before drafting, reread the earlier book's final chapters, `continuity/state.md`, and every unresolved question or promise. Decide with the user which threads the new book picks up.
- **Prequels:** the later book is canon. Every fixed endpoint must still be reachable by the end of the prequel. Do not mark a character `deceased` who is alive in a later book. Do not give a character knowledge that the later book shows them learning for the first time. Before drafting, list the later book's `fact` ids that have `learned-in`, and keep those facts out of the prequel's knowledge.
- **Revising an earlier book** after later books exist: run `story series .` before and after the revision. Update the later books' `Series Notes` and carried entity files when canon changes.

## Maintenance

After any change to series links or carried entities, run the checks in each affected book:

```shell
story validate .
story links .
story continuity .
story series .
```

If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder.

## Conventions

- One project folder per book, with books side by side in a shared parent folder
- `series` ids are kebab-case and identical in every book
- Entity ids and `name` values stay stable across books; variants go in `aliases`
- Chronology goes in `follows`/`precedes`, publication order in `book-number`
- Every link needs a matching backlink in the other book

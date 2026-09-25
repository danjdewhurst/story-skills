---
name: publishing
description: This skill should be used when the user asks to "self-publish", "publish my book", "ISBN", "copyright page", "book metadata", "BISAC", "keywords", "KDP", "IngramSpark", "Draft2Digital", "go wide", "Kindle Unlimited", "print interior", "trim size", "paperback", "ebook", "EPUB", "cover wrap", "spine width", "pricing", "launch plan", "ARC team", "advance readers", "newsletter", "reader magnet", "Amazon ads", "BookBub", "rights", "foreign rights", "audio rights", "film rights", "publishing contract", or wants to take a finished manuscript through production, distribution, launch, and rights management. It owns contracts and rights sales; NOT for permission to quote lyrics, epigraphs, or other material in the book (use editorial-review).
---

# Publishing

## Overview

Take a final manuscript into readers' hands. This skill fills the
publishing metadata in `story.md`, writes the copyright page, builds and
checks the ebook and print interior, walks the author through
distribution, pricing, and launch, and keeps an inventory of the rights
the author holds. Planning files live under `publishing/` in the story
project. The author makes every account, upload, purchase, payment, and
signature; this skill prepares, checks, and records.

## Prerequisites

A story project whose manuscript is final or nearly so. Verify `story.md`
exists and read `title`, `status`, `author` or `authors`, `genre`,
`series`, `book-number`, `cover`, and any publishing fields already set. If
`status` is not `complete`, say that metadata and launch planning can start
now but the files must be rebuilt after the last revision.

## When to Use

- Filling retailer metadata: ISBN, publisher, date, description, keywords,
  BISAC subjects, language, cover alt text, AI disclosure
- Writing the copyright page or checking epigraph and lyric permissions
- Building and checking the EPUB or the print interior; choosing trim size
- Choosing retailers and exclusivity, setting prices, planning a launch
- Recording rights, reviewing a contract offer, drafting a rights one-sheet
- NOT for query letters, agent submission, synopsis, or blurb drafting
  (use `submission`; this skill reuses its blurb)
- NOT for audiobook scripts, screenplays, translations, or other formats
  (use `adaptation`)
- NOT for revising the manuscript (use `revision-continuity`)

## Hard Rules

- Never invent an ISBN, publisher or imprint name, publication date, price,
  review, endorsement, sales figure, award, or bestseller claim. Ask, or
  leave a `[TODO: author to supply]` placeholder.
- Never assert current retailer specs, royalty rates, or fees as fact.
  They change. Give the working figure as a starting point and tell the
  author to check the retailer's current spec before relying on it.
- Legal, tax, and contract matters are **not legal or tax advice**. Flag
  issues, explain why they matter, and recommend an agent, a publishing
  lawyer, an accountant, or an author organization's contract-vetting
  service.
- Never create accounts, upload, buy, sign, or send. The author does.
- `ai-disclosure` must say what actually happened. Ask the author how AI
  tools were used; never minimise it.

## Workflow

### 1. Readiness

```shell
story validate .
story links .
story continuity .
story prose .
story wordcount . --write
story build . --format metadata
```

The metadata sheet lists every missing field in its readiness checklist,
including a `Permissions cleared for quoted matter` row that names each
matter page still at `permission: pending`, whatever the story status.
Report it with the validate findings. `validate` warns about
`permission: pending` only once the story `status` is `complete`, and
about a research note with a `risk` but no `reviewed-by` only when a final
or complete chapter uses it, so also search the files directly before
publication:

```shell
grep -l "permission: pending" matter/*.md
grep -l "^risk:" research/*.md
```

Report every pending permission, and every risky note without
`reviewed-by`, whatever the chapter status. If `story passes .` shows unfinished revision passes, say so
before production starts.

### 2. Metadata

Fill the `story.md` fields with `references/metadata-checklist.md`:
`isbn`, `publisher`, `publication-date`, `language`, `description`,
`keywords`, `subjects`, `copyright`, `cover-alt`, `ai-disclosure`, and
`authors` for co-written books. Take the description from
`submission/blurb.md` when it exists (the `submission` skill drafts it).
Rebuild the sheet and repeat until the checklist is clean:

```shell
story validate .
story build . --format metadata
```

### 3. ISBNs and copyright page

1. Explain the ISBN choices in `references/metadata-checklist.md`: one
   ISBN per format and edition, who issues them in the author's country,
   and the trade-offs of a free retailer ISBN. Record the ebook or print
   ISBN the author supplies in `isbn`.
2. Create the copyright page and fill it from
   `references/copyright-page.md`:

   ```shell
   story add matter "Copyright" --order 0 --heading false
   ```

   Use an `order` lower than every other front page so it sits first
   (behind the title page); `story add matter` otherwise takes the next
   free number. `--heading false` writes `heading: false` (on an existing
   page, edit its `heading:` key rather than adding a second one). Without this page, every build
   except Shunn generates a minimal one from `copyright`; write it by hand when the book needs credits, permissions,
   or a Library of Congress line.
3. For each epigraph, lyric, or quoted page in `matter/`, set `permission`
   (`not-needed`, `pending`, `granted`, `public-domain`), `rights-holder`,
   and `credit`. Quoting song lyrics almost always needs permission.

### 4. Ebook

```shell
story build . --format epub
```

The EPUB carries accessibility metadata, language, semantic chapter and
matter markup, a landmarks nav, the cover with `cover-alt`, and the
metadata fields. If the author has EPUBCheck or Ace by DAISY installed,
run them on the file in `dist/` (`java -jar epubcheck.jar <file>.epub`,
`ace <file>.epub`) and fix errors before upload. Ask the author to open it
in at least one reading app and in the retailer's previewer.

### 5. Print interior

Follow `references/print-interior.md`:

1. Choose the trim size with the author (`5x8`, `5.25x8`, `5.5x8.5`, `6x9`,
   `a5`), then build:

   ```shell
   story build . --format print --trim 6x9
   ```

2. Render the HTML to PDF with a paged-media engine the author has
   (`pagedjs-cli`, WeasyPrint, or Prince). The CLI bundles none.
3. Check the rendered PDF against the printer's file requirements; use its
   actual page count for the cover.
4. Tell the author to get the spine width and full cover wrap template from
   the printer's cover calculator, and to order a printed proof before
   release.

### 6. Distribution and pricing

Lay out the options in `references/launch-plan.md`: KDP, IngramSpark,
Draft2Digital or another aggregator, and direct sales, plus the trade-off
between exclusivity (KDP Select and Kindle Unlimited) and going wide. The
author decides; record the choices in `publishing/launch-plan.md`. Discuss
pricing with the considerations in the same reference, not a formula.

### 7. Retailer page copy

Draft into `publishing/retailer-copy.md`: a short description (the first
two lines, which show before "read more"), the long description (checked
against the metadata sheet's character count), series-page copy when
`series` is set, and A+ or enhanced-content ideas (a comparison chart of
series books, a character or map panel, a mood image with a quote). Follow
`../submission/references/blurb.md` for the copy itself. Copy the chosen
long description into `description`.

### 8. Launch

Build `publishing/launch-plan.md` from the T-90 to T+30 timeline in
`references/launch-plan.md`: ARC team, newsletter and reader magnet, street
team, preorder, launch week, and paid ads with a test budget and stop
rules. Update the plan as the author reports what happened; never fill in
results they did not give you.

### 9. Rights and contracts

1. Keep `publishing/rights.md` from the inventory in
   `references/rights-one-sheet.md`: every right (print, ebook, audio,
   translation by language or territory, film and TV, and the rest), who
   holds it, the term, and the reversion terms.
2. When the author has a contract offer, read it against
   `references/contract-red-flags.md` and list each clause that matches a
   red flag with the question to ask. State that this is not legal advice
   and recommend a lawyer or agent before signing.
3. For rights the author wants to license, draft a one-sheet from
   `references/rights-one-sheet.md`.

## Conventions

- Planning files: `publishing/launch-plan.md`,
  `publishing/retailer-copy.md`, `publishing/rights.md`,
  `publishing/one-sheet-{right}.md` (for example
  `publishing/one-sheet-audio.md`).
- Each file has YAML frontmatter with a `type` (`launch-plan`,
  `retailer-copy`, `rights-inventory`, `rights-one-sheet`) and
  `updated: YYYY-MM-DD`.
- `publishing/` is outside the story model: the CLI does not validate it
  and builds never include it. Build output in `dist/` is disposable;
  rebuild it rather than editing it.
- One `story.md` holds one edition's metadata. When the ebook and print
  ISBNs differ, record the one being built in `isbn`, set it before each
  build, and keep both in the copyright page and `publishing/rights.md`.
- Dates are `YYYY-MM-DD`. Word counts come from `story wordcount .`.
- After any manuscript change, rebuild every format and recheck page count
  and spine width before re-uploading.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder. If no CLI is available, fill the metadata by hand from `references/metadata-checklist.md` and tell the user that the EPUB, print, and metadata builds need the CLI.

After editing `story.md` metadata, adding matter pages, or changing the
manuscript:

```shell
story reindex .
story wordcount . --write
story validate .
story build . --format metadata
```

## Reference Files

- **`references/metadata-checklist.md`** - Every publishing field, ISBN sources and trade-offs, keywords, BISAC subjects, descriptions, AI disclosure, and CIP or PCN notes
- **`references/copyright-page.md`** - Copyright page template, optional lines, permissions credits, and legal deposit notes
- **`references/print-interior.md`** - Trim size choice, page-count estimates, rendering to PDF, printer checks, cover wrap, and proofs
- **`references/launch-plan.md`** - Distribution and exclusivity, pricing considerations, and the T-90 to T+30 launch timeline with ARCs, newsletter, and ad testing
- **`references/contract-red-flags.md`** - Clause-by-clause red flags for publishing and rights contracts, and where to get a professional review
- **`references/rights-one-sheet.md`** - Rights inventory template and one-sheets for foreign, audio, and film rights

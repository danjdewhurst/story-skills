# Rights Inventory And One-Sheets

A book is a bundle of separate rights. The author owns all of them until a
contract licenses one away. Keep track of them in `publishing/rights.md`;
use one-sheets to pitch a right to a licensee (an audio publisher, a
foreign publisher, a film producer, or an agent who sells those rights).

Nothing here is legal advice. Terms come from signed contracts; ask the
author for them, and for anything unclear, point them to their agent or a
lawyer.

## Rights Inventory

```markdown
---
type: rights-inventory
story: {story-id}
updated: YYYY-MM-DD
---

# Rights: {Title}

| Right | Territory / language | Holder | Contract date | Term | Reversion | Status |
|-------|----------------------|--------|---------------|------|-----------|--------|
| Print (paperback) | World English | Author | - | - | - | self-published |
| Ebook | World English | Author | - | - | - | self-published |
| Audio | World English | Author | - | - | - | available |
| Translation: German | Germany, Austria, Switzerland | Author | - | - | - | available |
| Film and TV | World | Author | - | - | - | available |

## Contracts

- {Contract name}: signed {date}; copy kept at {location}; notes.
```

Rights to consider, each its own row when relevant:

- **Print:** paperback, hardcover, large print, book club, special editions
- **Ebook**
- **Audio:** unabridged, abridged, dramatized
- **Translation:** by language, often by territory within a language
- **English-language territories:** North America, UK and Commonwealth,
  world
- **Serial:** first serial (excerpts before publication), second serial
- **Dramatic:** film, TV, stage, radio, podcast adaptation
- **Games and interactive**
- **Merchandise and licensing**
- **Anthology and permissions:** reprinting excerpts

Status values: `self-published`, `licensed`, `available`, `optioned`,
`in-negotiation`, `reverted`. Set a reminder for every option expiry and
reversion date the contract gives.

## One-Sheet Template

Save as `publishing/one-sheet-{right}.md`. One page. Every fact comes from
the author; mark unconfirmed items `[TODO: author to supply]`.

```markdown
---
type: rights-one-sheet
story: {story-id}
right: {audio | translation | film}
updated: YYYY-MM-DD
---

# {Title} by {Author}

**Rights available:** {right, territory or language}
**Contact:** {author or agent contact}

**Logline:** {one sentence}

**Pitch:** {100-150 words: premise, protagonist, stakes, tone}

**Book facts:** {genre}, {word count}, published {date} by {publisher},
{series and book number}; {formats available}

**Track record:** {sales, rankings, reviews, awards, as supplied by the
author}

**Comparable titles:** {two or three, verified}

**Why this right:** {the right-specific section below}
```

### Right-Specific Sections

- **Foreign rights:** where the book is already sold or published, why it
  travels (a universal premise, a setting with appeal in the target
  market, genre strength there), and whether an English sample and full
  manuscript are ready. Translation publishers often ask for sales history
  and reader reviews.
- **Audio rights:** length (word count and estimated finished hours; see
  the `adaptation` skill's narration build), cast size and accents,
  pronunciation needs, point of view (a dual-narrator candidate?), and the
  series' audio potential.
- **Film and TV rights:** the logline, the visual set pieces, the lead
  roles and their appeal to actors, whether it suits a film or a series
  (how many seasons the story holds), and budget-relevant facts (period,
  effects, locations). Producers often want a short treatment; the
  `adaptation` skill covers screenplay and scene-list work.

## Rules

- Never state sales, rankings, or awards the author has not given you.
- Keep the one-sheet consistent with the retailer description and the
  metadata sheet.
- Update `publishing/rights.md` when a right is licensed, optioned, or
  reverted, and remove it from any available-rights one-sheet.

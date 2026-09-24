# Picture Book

A picture book tells a story in words and pictures together, usually in 32
pages. The text is short (often under 500 words; `story init --form
picture-book` sets `target-words: 500`) and leaves room for the
illustrations to carry half the story. In traditional publishing, the
publisher chooses the illustrator; an author-only manuscript goes out as
text with sparse art notes. Self-published authors commission art and
need the full spread briefs.

## Pagination

Books are printed in signatures, so 32 pages (sometimes 24 or 40) is
standard. With self-ended books (the endpapers are part of the 32 pages), a
common plan is:

| Pages | Use |
|-------|-----|
| 1 | Half-title or title |
| 2-3 | Title spread, or copyright and dedication |
| 4-5 | Spread 1: story begins |
| 6-7 through 30-31 | Spreads 2-14 |
| 32 | Final single page: last line, image, or the ending's twist |

That gives 14 spreads of story (pages 4-31) plus page 32. Books with
separate endpapers, or with the title and copyright on one page, gain a
page or a spread. Front-matter placement varies; confirm the plan with the printer or
publisher. Keep the text in chapters, one per spread, numbered to match
(`chapter-01` is spread 1), so `story wordcount` counts the text per
spread. Art notes and briefs stay in the plan file.

## Page-Turn Beats

The page turn is the picture book's cliffhanger. Plan what each turn
reveals:

- End the recto (right page) on a question, a setup, or a sentence that
  breaks mid-thought; reveal on the next spread.
- Rule of three: two attempts that fail, the third that works or goes
  spectacularly wrong, each on its own spread.
- Pace varies: a quiet spread before the big reveal; a wordless spread
  for the emotional peak.
- The ending lands on the last spread or page 32, often with a final
  image that twists or echoes the opening.

## Text And Illustration

- Do not describe what the picture shows. If the art shows a red coat,
  the text need not say so.
- Let the pictures contradict or extend the words for humor and irony
  (the text says "Nobody noticed"; the picture shows everyone staring).
- Every spread needs an illustratable moment: a location, an action, an
  emotion. Two spreads in a row with the same scene and pose is a
  problem.
- Read aloud: rhythm, repetition, and refrains matter because adults read
  these books to children. Rhyme only if every line scans perfectly.
- The child character solves the problem; adults do not rescue them.

## Pagination Plan Template

Save as `adaptations/picture-book/pagination.md`:

```markdown
---
type: pagination-plan
story: {story-id}
pages: 32
updated: YYYY-MM-DD
---

# Pagination: {Title}

| Spread | Pages | Chapter | Text (words) | Page-turn beat | Picture |
|--------|-------|---------|--------------|----------------|---------|
| 1 | 4-5 | chapter-01 | 32 | Setup: Pip wants to fly | Pip on the fence at dawn |
| 2 | 6-7 | chapter-02 | 28 | Attempt one fails | Pip in the hedge, feathers everywhere |

## Spread Briefs
```

## Spread Brief Template

One per spread, under `## Spread Briefs`:

```markdown
### Spread 1 (pages 4-5)

- **Text:** chapter-01
- **Moment:** what the picture shows at this instant
- **Characters:** who is present, their emotion and pose
- **Setting:** place, time of day, weather; location id if any
- **Must show:** details the text depends on, or that later spreads pay off
- **Must not show:** what the next page turn reveals
- **Text placement:** where the words sit (clear space left or right,
  top or bottom)
- **Continuity:** clothing, props, and colors that must match other spreads
```

## Art Notes

For a manuscript sent without art, add art notes only where the text is
misleading or incomplete without the picture:

```text
[Art note: Pip is not a bird. Pip is a pig.]
```

Keep them short and rare. A manuscript full of art notes tells the
publisher the author wants to direct the illustrator.

## Checks

- [ ] Total words inside the form's range (`story validate` warns when
      `target-words` is outside it; `story wordcount . --write` for the
      actual count)
- [ ] 14 spreads (or the printer's plan), each with a text and a picture
      moment
- [ ] Every page turn earns the turn
- [ ] No spread repeats the previous spread's picture
- [ ] Read aloud from start to end without stumbling

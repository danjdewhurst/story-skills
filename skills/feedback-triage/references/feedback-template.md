# Reader Feedback Template

Copy this template to `feedback/round-{N}/{reader-kebab}.md` for each reader
in each feedback round. `reader-kebab` identifies the reader (their name or a
label like `alpha-reader-1`); `{N}` is the round number.

```yaml
---
reader: "{Reader name or label}"
round: {N}
chapters-read: "{e.g. 1-12, or all}"
overall-verdict: "{loved it | liked it with reservations | mixed | didn't connect}"
---

# Feedback — {Reader} (Round {N})

## Overall Impression

{2-4 sentences: what the reader felt about the manuscript as a whole.}

## What Worked

- {Specific things the reader liked, with chapter or scene references}

## Problems

### {Problem title} (Ch {N})

- **What the reader said:** {quote or close paraphrase}
- **Where:** {chapter/scene reference}
- **Canon check:** {verified against the bible | contradicts canon — see note |
  outside canon scope}
- **Severity (reader's):** {blocking | major | minor | nit}

## Questions Raised

- {Questions the reader asked that the manuscript should answer — these are
  candidate `continuity/questions/` entries or signs of a clarity gap}

## Suggested Changes

- {Concrete changes the reader proposed — record as proposals, not decisions}
```

## Canon check discipline

Before a reader's note enters synthesis, check it against the story bible:

- **Verified:** consistent with canon; the note is about craft or clarity.
- **Contradicts canon:** the reader's expectation conflicts with established
  canon — usually means a *setup* problem (canon wasn't conveyed), not a
  canon problem. Note which file establishes the canon fact.
- **Outside canon scope:** the reader wants a different book (different
  genre, different theme). This is a `declined-with-reason` candidate.

Never "fix" canon to satisfy a reader note without user approval — that is a
story decision, not a maintenance fix.

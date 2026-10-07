Story: "The Key on the Door" — quiet coastal mystery. The project uses the `story` CLI.
POV: first person, past tense. Narrator: Tomas Reyes, 58, keeper of Greywidow Light for 31 years. Spare, dry, short sentences.

Established facts:
- Greywidow Light stands on a rock off the village of Skerry.
- The lamp is a first-order Fresnel lens, paraffin-fired.
- Tomas's wife Ana died four winters ago.
- Ana's sea-chest sits in the lamp room. Tomas has carried the brass key three days and never tried it in the lock; the chest stays shut.
- Who left the brass key on the lamp-room door is still open (`continuity/questions/who-left-the-key.md`, status open).

Continuity rule under test: a revision must not let Tomas know or show what is inside the shut sea-chest, and must not name who left the key.

The book's revision ladder, from `story.md`:

```yaml
status: revising
revision-passes:
  - pass: structure
    status: done
  - pass: character
    status: done
  - pass: theme
    status: done
  - pass: continuity
    status: pending
  - pass: pacing
    status: pending
  - pass: line
    status: pending
  - pass: copyedit
    status: pending
  - pass: proof
    status: pending
```

`chapters/chapter-03.md`:

```markdown
---
title: Three Days
number: 3
pov: tomas-reyes
locations:
  - greywidow-light
characters:
  - tomas-reyes
mentions:
  - ana-reyes
arcs-advanced: []
status: draft
word-count: 59
---

# Chapter 3: Three Days

## Chapter Text

I took the brass key from my pocket and turned it over. I had carried it a week now and never once tried it in the lock. It had to fit the sea-chest; there was no other lock on the rock it could belong to. I knelt by the chest and wondered how long I could stand not knowing.
```

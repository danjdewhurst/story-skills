---
name: verse-craft
description: This skill should be used when the user asks to "write a poem", "write a limerick", "write a sonnet", "haiku", "villanelle", "ballad", "song lyrics", "a song for my character", "a rhyme", "rhyming couplets", "does this scan", "check the meter", "fix the rhythm of this poem", "rhyme scheme", "iambic pentameter", "a prophecy in verse", "a nursery rhyme", "rhyming picture book", or wants verse written, scanned, or revised, whether inside a story project or as a standalone poem. NOT for accidental rhymes in prose (use line-editing) or permissions for quoting someone else's poem (use editorial-review).
---

# Verse Craft

## Overview

Write, scan, and revise verse: fixed forms such as the limerick, sonnet,
haiku, and villanelle; ballads and song lyrics; rhyming picture-book
text; and verse that lives inside a story (a character's song, a
prophecy, a skipping rhyme). Every claim that a line scans is shown, not
asserted: the agent marks the stresses, counts the syllables, and labels
the rhyme scheme so the author can check the work. The author's poem is
the standard; propose changes, do not rewrite it wholesale.

## Prerequisites

None. A standalone poem needs no project: save it where the user asks,
as a plain `.md` file. Verse that belongs to a story needs the story
project, `story.md` (POV, tone, era), and the file of the character who
speaks or sings it.

## When to Use

- Writing a new poem, limerick, song, or rhyme in a given form
- Checking whether an existing poem scans or keeps its rhyme scheme
- Fixing meter, forced rhymes, or padded lines in a draft poem
- Verse inside a story: a character's song, a riddle, a prophecy, an epigraph
  the author writes themselves
- Rhyming text for a picture book (plan the spreads with `adaptation`,
  write and scan the verse here)
- NOT for unintended rhymes or jingles in prose (use `line-editing`)
- NOT for permissions when quoting another writer's poem or lyrics (use
  `editorial-review`)
- NOT for a poetry collection as a story project: the CLI checks fiction
  entities, so keep a collection as plain files and do not run `story init`
  for it

## Hard Rules

- Never say a line scans without showing its stresses. Mark them as in
  `references/meter-and-scansion.md`.
- Never pad a line to fill the meter ("did go", "so very", "oh", "all
  alone and lone"). Rewrite the line instead.
- Never invert natural word order to land a rhyme ("the sea so blue I
  wade into" for "I wade into the blue sea") unless the author's style
  already does it on purpose.
- Never reproduce copyrighted lyrics or poems, even a stanza. Allude or
  write something original in the same form; send permission questions
  to `editorial-review`.
- Never rewrite the author's poem wholesale without explicit permission.
  Propose line-level fixes with a reason each.
- Verse a character writes sounds like that character, not like a
  competent poet. A clumsy character's poem can be clumsy on purpose; say
  so rather than fixing it.

## Workflow

### 1. Mode and constraints

1. Work out the mode: **write** new verse, **critique** a poem, **fix** a
   poem's meter or rhyme, or **story verse** that sits inside a chapter.
2. Pin the constraints, asking only for what the request leaves open:
   form, meter, rhyme scheme, line and stanza count, refrain, subject,
   tone, and any words that must appear. `references/forms.md` gives each
   form's rules; state the ones you are following.
3. For story verse, read `story.md` (era, setting, tone), the speaker's
   character file (voice notes, `voice-words`, `voice-avoid`, education),
   and the chapter it goes in. Verse must not state canon the project
   does not already hold: no new names, history, or world rules.
4. Ask which accent the verse is scanned in when it matters (British and
   American stress differ on words such as *address*, *garage*,
   *cigarette*), and which dialect the rhymes must work in.

### 2. Draft

1. Draft for sense first: every line must say something a reader would
   say in prose. Then fit the meter.
2. Choose rhyme words that carry meaning; build the line toward the rhyme
   rather than bolting the rhyme on. See `references/rhyme.md` for forced
   rhymes and the rhymes readers have seen too often.
3. Keep the syntax natural. Read each line as a sentence: if nobody would
   say it that way, rewrite it.

### 3. Scan

Scan every line, including the author's lines in critique mode. Show a
scansion table (format in `references/meter-and-scansion.md`) with the
stress pattern, syllable count, and rhyme letter for each line, and mark
each departure from the meter as **deliberate** (a trochee at the line
start, a feminine ending) or a **fault** (a stress that falls on a weak
syllable, a missing or extra beat).

When the user asks for the poem only, scan privately and return just the
verse; offer the table afterwards.

### 4. Check rhyme and form

1. Label the rhyme scheme with letters (AABBA). Mark slant rhymes and eye
   rhymes, and say whether each was meant.
2. Check the form's other rules from `references/forms.md`: refrains
   repeated exactly, the volta in a sonnet, the syllable count in a haiku,
   the punchline in a limerick's last line.
3. Read the poem aloud, or offer the system's text-to-speech (`say` on
   macOS; `espeak-ng` or `spd-say` on Linux; check with `command -v` and
   ask before installing anything). A line that stumbles aloud is a fault
   even if the table says it scans.

### 5. Revise

Present fixes in the edit-note format the `line-editing` skill uses, with
the verse line as the location:

```markdown
**stanza 2, line 3** · meter
> Before: And the boat that did come on the Thursday tide
> After: And the boat that came in on the Thursday tide
Why: "did come" pads the line; "came in" keeps four beats without the filler.
```

Lead with faults that break the form, then weak rhymes, then polish. Apply
only what the author accepts, or everything on explicit instruction.
Rescan every line you change.

### 6. Place story verse

1. Put the verse where it is read: in the chapter body, or in a `matter/`
   file for an epigraph (`story add matter`).
2. Keep line breaks through every build: end each line of a stanza,
   except the last, with a backslash (`\`), and leave a blank line
   between stanzas. For verse set off from the prose, put the stanza in
   a blockquote and end each quoted line the same way.
3. Record the verse's facts in the usual places: a song that recurs is a
   motif (`theme-craft`), a prophecy is a promise (`plot-structure`).
4. Run maintenance:

```shell
story wordcount --write
story links
story validate
```

## Reference Files

- **`references/forms.md`** - Rules, an original example, and common faults
  for the limerick, sonnets, haiku, villanelle, ballad, clerihew, couplets,
  free verse, song lyrics, and rhyming picture-book text
- **`references/meter-and-scansion.md`** - Feet and meters, how to find a
  word's stress, the scansion table format, and which departures are
  allowed
- **`references/rhyme.md`** - Kinds of rhyme, scheme notation, forced-rhyme
  tells, and rhymes readers have seen too often

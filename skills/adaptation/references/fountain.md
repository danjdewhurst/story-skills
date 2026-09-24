# Screenplay In Fountain

Fountain is plain-text screenplay markup. Screenwriting apps (Highland,
Beat, Slugline, Fade In, WriterSolo, Afterwriting, and others) import it
and format it to industry layout. Save the script as
`adaptations/screenplay/{story-id}.fountain`, never as a root `.md` file.

## Scene List From Scene Records

Build `adaptations/screenplay/scene-list.md` before writing any script
page:

```markdown
---
type: scene-list
story: {story-id}
updated: YYYY-MM-DD
---

# Scene List: {Title}

| # | Source scene | Slugline | Characters | Beat | Decision |
|---|--------------|----------|------------|------|----------|
| 1 | chapter-01-scene-01 | EXT. HARBOR WALL - NIGHT | mara, venn | Mara sees the second light | keep |
| 2 | chapter-01-scene-02 | INT. ARCHIVE - CONTINUOUS | mara | Memory of her father | externalize |
```

- **Slugline:** `INT.` or `EXT.` (decide from the scene), the location
  record's `name` in capitals, and `DAY`, `NIGHT`, or `CONTINUOUS` from the
  scene's `time`.
- **Characters:** the scene's `characters`, not `mentions`.
- **Beat:** what changes in the scene, in one line. Scenes with an
  `outcome` field already record it.
- **Decision:** `keep`, `merge` (with which), `cut`, `externalize`
  (interior content that needs a visible action, image, or line), or
  `new` (a scene the film needs that the book does not have).
- Use reading order for the default structure; `story timeline .` gives
  story-time order when the film should be told chronologically.

## Novel To Screen

- **Length:** about one page per minute. A feature runs roughly 90-120
  pages; a TV hour roughly 50-60. A novel usually loses most of its
  scenes; merge characters and locations before cutting plot.
- **Externalize:** film shows behavior. Replace thought with action,
  choice, and subtext. Voiceover is a tool, not a fix.
- **Compress time:** combine scenes that do the same job; start scenes
  late and leave early.
- **Structure:** keep the book's turning points (see the arc files) and
  place them near the film's act breaks.
- **POV:** a film has no narrator by default. A first-person novel's
  voice has to come through the lead's actions and the camera's choices.
- Adaptation rights must be cleared before a script is shopped. See the
  `publishing` skill's rights inventory.

## Fountain Syntax

```fountain
Title: The Last Ember
Credit: Written by
Author: Jane Doe
Source: Based on the novel by Jane Doe
Draft date: 2027-01-15
Contact: [TODO: author to supply]

FADE IN:

EXT. HARBOR WALL - NIGHT

Waves slap stone. MARA (30s, salt-stained coat) climbs the wall, a lantern
in her teeth.

MARA
(muttering)
Every night. Every single night.

She stops. Below her, a second light flickers on the water.

VENN (O.S.)
You shouldn't be up here.

CUT TO:

.FLASHBACK - THE ARCHIVE, TWENTY YEARS AGO

[[Source: chapter-03-scene-02]]

Young Mara watches her father seal a box of glass plates.

> THE END <
```

| Element | Syntax |
|---------|--------|
| Title page | `Key: value` lines at the top, then a blank line |
| Scene heading | A line starting `INT.`, `EXT.`, `EST.`, `INT./EXT.`, or `I/E`, with a blank line before; force any line with a leading `.` |
| Action | Any ordinary paragraph; force with a leading `!` |
| Character | A line in capitals, blank line before, dialogue on the next line; extensions `(V.O.)`, `(O.S.)`, `(CONT'D)`; force with `@` |
| Dialogue | Lines directly after a character or parenthetical |
| Parenthetical | `(wrylies)` on their own line inside dialogue |
| Dual dialogue | `^` after the second character's name |
| Transition | A capitalized line ending in `TO:`, blank lines around it; force with a leading `>` |
| Centered text | `> text <` |
| Emphasis | `*italic*`, `**bold**`, `_underline_` |
| Lyrics | Leading `~` |
| Page break | `===` on its own line |
| Notes | `[[note]]`, not printed |
| Boneyard | `/* cut material */`, not printed |
| Sections | `#`, `##`, `###` for acts and sequences; not printed |
| Synopses | `= one-line summary`; not printed |

Use `#` sections to mirror the scene list's acts, and `[[...]]` notes to
record the source scene id for each scene so revisions trace back to the
book.

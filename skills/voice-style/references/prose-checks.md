# Prose Checks

`story prose .` counts; it never judges. Each check below says what is
counted, when it becomes a warning, and when to keep the text anyway.
Headings, HTML comments, and scene-break rules are ignored. Only the
chapter prose is read: the text after `## Chapter Text`, or after the
outline divider.

| Check | Counted | Warning when |
|-------|---------|--------------|
| Avoided spelling | Each `preferred` avoid form and each dialect-pair avoid form, anywhere in the prose | Any occurrence |
| Filter words | *felt, saw, heard, noticed, realized/realised, wondered, seemed, watched, knew, decided, thought, sensed* in narration | Over 10 per 1,000 narration words, once a chapter has 300 narration words |
| -ly adverbs | Narration words ending in *-ly*, minus common non-adverbs (*only, family, early*) and character-name tokens | Over 12 per 1,000 narration words, once a chapter has 300 narration words |
| Said-bookisms | Tags such as *hissed, snapped, retorted, exclaimed, smirked* in the first three words after a closing quote | 3 or more in a chapter |
| Plain tags | *said, asked* after a closing quote | Never; context only |
| Echoes | A word of 5+ letters repeated within 30 words, ignoring common function words and character names | Never; listed for rereading |
| Sentence rhythm | Words per sentence: average, longest, and spread (standard deviation) | Spread under 5 words across 20 or more sentences |
| Watch words | Each `watch-words` entry | Never; counts are listed |
| Repeated phrases | 4-word sequences inside one sentence, across the whole manuscript, that are not all function words | Never; the top 10 with 3+ uses are listed |
| Similar names | Character first names that match, share their first three letters, or are one or two edits apart | Any pair |

## Responding

- **Filter words** distance the reader from the POV character: *She saw
  the door open* becomes *The door opened*. Keep one when the act of
  perceiving is the point (*She heard nothing — and that was wrong*).
- **-ly adverbs** often prop up a weak verb: *walked slowly* becomes
  *trudged*. Keep adverbs that change meaning rather than intensify it.
- **Said-bookisms** tell the reader how to hear a line the dialogue should
  carry. Use *said* or an action beat. Some books use a wider tag palette
  on purpose (older middle grade, some romance); record that in the style
  sheet and add the tags to `allow-words`.
- **Echoes** are fine when the repetition is deliberate (anaphora, a
  motif). Otherwise vary or cut.
- **Uniform rhythm** is a common marker of machine-drafted or fatigued
  prose. Break a run of similar sentences with a fragment or a long
  cumulative sentence where the moment calls for it.
- **Repeated phrases** show a writer's tics across the book (*let out a
  breath*, *the edge of the*). Add real tics to `watch-words` so every
  later check counts them.
- **Similar names** cost readers attention. Rename the less established
  character, with the user's approval, via `story rename`.

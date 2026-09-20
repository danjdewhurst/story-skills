# Flashbacks and Time Skips

## Flashback entry and exit mechanics

A flashback must feel like entering and leaving a room, not like a footnote.
Use a two-step entry and a two-step exit:

**Entry:**
1. **Sensory trigger in the present** — a smell, a sound, a phrase that the
   POV character actually perceives right now. The trigger belongs in the
   present scene.
2. **Clean break** — a scene break (`---`) or a hard paragraph transition.
   Then start the flashback *in media res* of the past moment, not with
   "She remembered when..." (that is a filter-word entry — see `deep-pov.md`).

**Exit:**
1. **Echo the trigger** — return on the same sensory detail, now changed by
   what the flashback revealed.
2. **Resume present motion** — the present scene continues; the flashback
   must have *cost* something (time lost, a reaction seen, a decision
   changed) or it was free information.

Record flashbacks in the scene record with `flashback-to: {when}` (a freeform
scalar validated by `story validate` and preserved by the CLI) and the
characters appearing in them under `mentions` (not `characters`), per the
story-init convention — this keeps `story continuity` from flagging
posthumous or temporally-impossible appearances (continuity checks use
`mentions`, not `flashback-to`).

## The flashback-as-tension-cheat warning

A flashback placed at a cliffhanger is a cheat: it pauses the present tension
to spend cheaper past tension. Test every flashback placement:

- **Does the present scene lose urgency because the flashback interrupts it?**
  If yes, move the flashback earlier (plant the memory before the crisis) or
  later (let the memory arrive when the character is safe enough to have it).
- **Does the flashback contain the actual stakes of the story?** If the most
  dramatic events live in flashbacks, the story's timeline is wrong — the
  story should start later.

The legitimate use: a flashback that *deepens* the present stakes (the
ambush matters more because we now know who taught her to fight) placed at a
moment of relative calm, not at a cliffhanger.

## Time skips

When the story jumps forward (days, months, years):

- **Bridge with a single decisive detail** — one line that shows what
  changed: "By spring, the orchard was a field of stumps." Not a summary
  paragraph of everything that happened.
- **Update `continuity/state.md`** for every skipped interval: character
  state, object custody, and knowledge that would have changed. Skips are
  where continuity errors breed.
- **Update `plot/timeline.md`** with the skipped period marked explicitly
  (`Day 40 → Day 120: {what the skip covers}`), so later agents don't assume
  nothing happened.
- **Record the skip in the chapter frontmatter** as
  `time-skip: {from} → {to}`.

## Flashback discipline

- One flashback per chapter is plenty; two needs justification.
- Never open a chapter with a flashback (see `openings.md` — the first page
  must establish present-tense instability, not past context).
- A flashback longer than the present scene around it has become the real
  scene: rename it and restructure.
- Backstory delivered because "the reader should know" belongs in the
  character file, not on the page. Backstory delivered because the POV
  character *needs it now* to make their decision belongs in the sequel
  (see `scene-sequel.md`).

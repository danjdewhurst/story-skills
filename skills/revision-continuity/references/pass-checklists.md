# Revision Pass Checklists

One section per revision pass. Each section says what the pass is for, which
checks to run, what to read, what to look for, and which files to update. Pick
the pass in step 1 of the Revision Workflow in `SKILL.md` and take the
snapshot in step 2 before running anything here: some checks write files,
such as `story wordcount . --write`. Then follow the pass's section through
the reading, planning, editing, and maintenance steps.

The named passes that `story passes .` tracks in `story.md`
`revision-passes` map onto these checklists:

| Ladder pass | Checklists |
|-------------|------------|
| `structure` | [Reverse outline](#reverse-outline), [Pacing waveform](#pacing-waveform), [Removability audit](#removability-audit-darling-killing) |
| `character` | [Developmental revision](#developmental-revision), [Voice differentiation](#voice-differentiation) |
| `theme` | [Theme audit](#theme-audit) |
| `continuity` | [Continuity audit](#continuity-audit), [Reveal economy](#reveal-economy), [Fact check](#fact-check) |
| `pacing` | [Pacing waveform](#pacing-waveform) |
| `line` | [Line edit](#line-edit) |
| `copyedit` | [Copyedit](#copyedit) |
| `proof` | [Proof/polish](#proofpolish) |

## Adding a pass

Give a new pass its own `##` section with the same headings, in this order,
and add it to the table above. Leave out a heading that does not apply.

```markdown
## {Pass name}

{One or two sentences: what the pass finds and why it matters.}

- **Run:** {story commands, with what to look for in their output}
- **Read:** {project files}
- **Check:** {what to judge by reading}
- **Update:** {files the pass may change}
- **See also:** {skill or reference that owns the deep version}
```

A custom ladder entry (`story passes . --start fact-check`) needs no section
here unless it brings a procedure of its own.

## Continuity audit

Find contradictions, stale references, timeline problems, missing
backlinks, or word-count drift.

- **Run:** `story continuity .` first for the deterministic findings, then
  `story links .` for missing backlinks and `story validate .`.
  `story wordcount . --write` corrects word-count drift.
- **Check:** what the CLI cannot judge, using the Continuity Audit
  Checklist in `SKILL.md`.
- **Update:** the chapter, and every dependent record listed in step 6 of
  the Revision Workflow.

## Developmental revision

Improve structure, scene purpose, character motivation, pacing, stakes, and
arc progression.

- **Run:** `story knowledge <id> --at <chapter>` for what a character knows
  when they act, and `story diagram relationships` for how relationships
  stand.
- **Read:** the chapters, the arc files they advance, and the character
  files of the main cast.
- **Check:** each scene has a purpose, each character's motivation explains
  what they do, stakes rise, and each arc progresses.
- **Update:** chapters, scenes, arc plot points, and character files whose
  arc or state changed.

## Reverse outline

Extract what each chapter actually does in one line per chapter, without
looking at the outline or arc files, then diff that against what the plot
files say it should do. Reorder, merge, split, or cut where they disagree.

- **Read:** every chapter in `chapters/`, `plot/timeline.md`, active arc
  files.
- **Update:** `plot/timeline.md`, arc plot-point tables, and
  `chapters/_index.md` when chapters move, merge, or split. Make the moves
  with `story move` (see Structural Edits in `SKILL.md`).

## Theme audit

Check whether the ending engages the opening's value-question and whether
the theme is dramatized through consequence rather than commentary. Verify
every motif introduced early is paid off by the end.

- **Run:** `story report .`.
- **Read:** `story.md` premise and themes, the opening and closing chapters,
  theme-tracked arcs in `plot/_index.md`.
- **Update:** `story.md` premise if the draft argues a different idea, arc
  `themes` tags.
- **See also:** the `theme-craft` skill for the deep pass.

## Pacing waveform

Map tension per chapter to find dead zones: chapters that neither raise nor
vary the tension level. Two peaks back-to-back dilute each other; a flat
middle means escalation is missing.

- **Run:** `story pacing .` for the per-chapter dashboard (words, scene and
  sequel counts, scene `outcome`s, chapter `hook`) and its warnings:
  - three or more consecutive `yes` outcomes (no pressure)
  - four or more scene units without a sequel (no breath)
  - chapter length outliers
  - three or more chapters in a row ending on `resolution`
  - drafted chapters with no `hook`

  Run `story timeline .` for POV balance and characters who vanish for long
  stretches.
- **Read:** the chapters, `scenes/` state-changes, arc climax points.
- **Update:** chapter or scene order, or add escalation where the map goes
  flat.

## Reveal economy

Check that every reveal is earned by planted setup and that reveals are
spaced rather than dumped in clusters. Unplanted twists and reveal dumps
both read as cheap.

- **Run:** `story clues .` for the clue-by-chapter matrix and its fair-play
  warnings (late plants, unplanted payoffs, clues nobody can notice,
  undebunked red herrings). `story diagram clues` draws the plant-to-reveal
  flow.
- **Read:** `continuity/promises/`, arc foreshadowing tables,
  `knowledge-state` in `continuity/state.md`.
- **Update:** promise/question `status` and chapter fields, foreshadowing
  rows.

## Removability audit (darling-killing)

Find scenes whose removal would change nothing downstream: no state
changes, no causality, no payoff. Wire such scenes in (give them
consequence), fold them into an adjacent scene, or cut them, then record
the decision so nobody re-litigates it.

- **Read:** `scenes/` state-changes, `continuity/state.md`,
  `continuity/promises/`.
- **Update:** scene `state-changes`, promise/question status,
  `plot/timeline.md`.

## Voice differentiation

Check that each speaker sounds like themselves.

- **Run:** `story voices .` for per-character dialogue fingerprints. It
  warns when two characters' fingerprints are near-identical, when a
  character says a word from their `voice-avoid` list, and when a
  `voice-words` entry never appears.
- **Update:** dialogue in chapters, or the character's
  `voice-words`/`voice-avoid` when the draft has found a better voice.

## Line edit

Improve clarity, voice, rhythm, dialogue, and sensory specificity without
changing plot facts.

- **Run:** `story prose .` to find filter words, adverb clusters,
  said-bookisms, echoes, uniform rhythm, and repeated phrases worth
  rereading.
- **Read:** `style-sheet.md` for the recorded voice.
- **See also:** the `line-editing` skill for a full prose-quality pass.

## Copyedit

Distinct from proof/polish: enforce a style baseline (hyphenation,
capitalization, naming, numbers) and continuity of surface detail (hair
color, room layouts, name spellings). This pass is mechanical consistency,
not prose quality; prose quality belongs to the line edit.

- **Run:** `story prose .` and fix every avoided spelling it reports.
- **Read:** `style-sheet.md` (create it with the `voice-style` skill if
  missing), `glossary/`, character and location files.
- **Update:** chapters, `style-sheet.md` when a new convention is settled,
  `glossary/`, character files where details drifted.
- **See also:** the `line-editing` skill for the full copyedit procedure.

## Fact check

Verify real-world details the chapter relies on.

- **Read:** `research/` notes whose `used-in` lists the chapter.
- **Update:** research notes and their status, and the chapter where it
  contradicts verified findings.
- **See also:** the `research` skill.

## Proof/polish

Fix small wording, grammar, repetition, and formatting issues.

- **Run:** proof a built copy, not the source: `story build . --format
  print` or `--format html`.
- **See also:** the `line-editing` skill.

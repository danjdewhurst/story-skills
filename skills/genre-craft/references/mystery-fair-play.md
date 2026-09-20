# Mystery: Fair Play and the Clue Ledger

The fair-play doctrine is the genre's contract with the reader: the reader
must have every clue the detective has, in time to solve the mystery
themselves. A mystery that withholds essentials is not clever — it is
cheating.

## Fair-play rules

- **The reader gets every clue.** Every fact the detective uses to solve the
  case must appear on the page before the solution, early enough to matter.
- **The culprit is introduced early** — conventionally within the first
  third. A culprit who appears only at the reveal is a stranger, not a
  suspect.
- **No withheld essentials.** The detective may not know something the
  reader doesn't (no secret evidence revealed at the gather-suspects scene).
  The detective may *misinterpret* — that is the game — but the facts must
  be shared.
- **The solution must be the best explanation of the planted clues**, not
  merely a consistent one. If three solutions fit the clues, the planting
  was too thin.

## Clue-planting techniques

- **Hidden in plain sight:** the clue appears as set dressing or a throwaway
  detail. The reader sees it; only the detective's context makes it a clue.
- **Camouflaged:** the clue is embedded in a longer list or a busy scene —
  one wrong alibi among five correct ones, one inconsistent detail in a
  full witness statement.
- **Misinterpreted:** the clue is correctly observed but wrongly explained,
  by the detective or by a witness the reader trusts. The reveal reframes it.
- **Absence as clue:** the dog that didn't bark — something that *should*
  be present and isn't. Plant the expectation early so the absence registers.

## Red-herring discipline

- Every red herring must be **plausible** (a reasonable reader could suspect
  this person), **scene-fitting** (it belongs in the scenes it appears in —
  never inserted solely to mislead), and **resolved, not abandoned**.
- A resolved red herring gets its own mini-payoff: the suspect is cleared
  *for a reason that teaches the reader something true* about the case.
- Track herrings in the clue ledger with `type: red-herring` and a
  `cleared-in` chapter. An uncleared herring is a broken promise.

## The gather-suspects reveal

The classic reveal structure: assemble the suspects, walk through the
evidence, eliminate each in turn, name the culprit. Requirements:

- Every elimination must use **planted** clues (check the ledger).
- The culprit's motive, means, and opportunity must each trace to a planted
  clue — three separate ledger entries minimum.
- The scene works best when the detective is *wrong about one thing* on the
  way to being right — it keeps the reveal from feeling like a lecture.

## The clue ledger

Maintain `continuity/clues/` with one file per clue (kebab-case ids). The
CLI creates them with `story add clue`:

```shell
story add clue "The silver locket" --planted chapter-02 --payoff chapter-05
```

Omit `--payoff` when the payoff is not yet known. The generated frontmatter:

```yaml
---
title: The silver locket
status: planned        # planned | planted | paid-off
planted: chapter-02
payoff: chapter-05
significance-delayed: true   # reader sees it before understanding it
characters: [edwin-marsh, priya-okafor]
arcs: [the-drowned-witness]
---
```

Add a `type: clue | red-herring` field by hand when the entry is a herring,
plus `cleared-in: chapter-NN` recording where it gets resolved with a reason.

- `planted` must precede `payoff` — `story continuity` reuses the
  promise-ordering machinery for the clue ledger: payoff before plant is an
  error, a clue planted ≥3 chapters ago with no payoff is a warning.
- A clue with `significance-delayed: true` is fair play *only if* the clue
  itself was visible; delayed significance is the game, hidden clues are
  the cheat.
- After adding or editing clues, run `story reindex .`, `story links .`,
  `story validate .`, `story continuity .`

## Mystery audit (revision)

- [ ] Every clue the solution uses is planted before the reveal.
- [ ] The culprit appears in the first third.
- [ ] Every red herring is cleared with a reason.
- [ ] No essential fact first appears in the reveal scene.
- [ ] The detective's wrong turns use misinterpretation, not missing facts.

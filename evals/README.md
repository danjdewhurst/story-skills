# Evals

Regression tests for the fiction-writing skills. Each fixture is a drafting
brief seeded with known canon (established facts that must survive) and
known traps (inventions, resolved mysteries, or slop a lazy draft would
introduce). A passing draft keeps the canon, springs none of the traps, and
reads as written by one person. The checker (`run-evals.js`) is
dependency-free Node.

This directory is repo tooling. Agents using the skills do not load it.

## Workflow

Run every fixture through a real model with the skill loaded, then check the
drafts:

```bash
node evals/run-skill.js                        # all fixtures, claude-opus-5, each fixture's declared skill
node evals/run-skill.js --model claude-sonnet-5 canon-keeping voice-preservation
node evals/run-skill.js --skill revision-continuity  # override every fixture with one skill
```

The runner builds a system prompt from the skill's `SKILL.md` plus its
`references/`, sends each fixture's `input.md` with its `brief` through
`claude -p` with no tools, saves the draft to `evals/outputs/<fixture>.md`
(gitignored), and runs the checker on it. Run provenance is saved next to
each draft: `<fixture>.prompt.md` (exact prompt sent),
`<fixture>.system.sha256` (hash of the system prompt), and
`<fixture>.judge-raw.txt` (the judge's raw reply); model, temperature, and
seed are logged per run (`claude -p` exposes no temperature/seed flags, so
sampling uses the CLI defaults). It needs the Claude Code CLI on
PATH with working credentials. Run it before and after any change to a
skill's instructions or references and compare the reports, and read the
drafts, since a pass count says nothing about whether the prose reads well.

After the checker, the runner makes a second model call that lists every
canon claim the draft makes that the context does not state or imply: a new
named character, a new world rule, a resolved mystery, a changed fact. One
listed claim fails the fixture, and the list is saved next to the draft as
`<fixture-name>.claims.json`. This exists because the substring checker
cannot see invention: only a reader (human or model) can tell that "Petra
left the key" resolves the open question. Read a flagged claim before acting
on it. Pass `--no-judge` to skip the call and `--judge-model` to override
it.

To check drafts you produced some other way, save them as
`<fixture-name>.md` and run the checker directly:

```bash
node evals/run-evals.js evals/fixtures/canon-keeping my-drafts/canon-keeping.md
node evals/run-evals.js --all my-drafts
```

The checker exits non-zero on any failure.

## Baseline and pairwise comparison

A pass count shows the draft kept what the fixtures protect. It does not
show the skill did better than the model would have done unaided. To check
that, produce a baseline with the same briefs and no skill loaded, then
compare the two sets pairwise:

```bash
node evals/run-skill.js --no-skill --no-judge --out evals/baseline
node evals/run-skill.js
node evals/compare-outputs.js evals/baseline evals/outputs
```

The comparison shows the judge the brief, the context, and both drafts,
unlabelled and in both orders, and counts a win only when the same draft
wins both ways. Judges prefer low-perplexity text and the first item shown,
and they agree with human writing preferences only about three quarters of
the time, so treat a loss as a flag to read both drafts, not a verdict.
Never label which draft came from the skill: labelled authorship shifts
judge preference.

## Why there is no single quality score

Do not add an LLM-as-judge "overall quality" score to this harness. The
checker is a smoke test, not a critic: it matches canon substrings, bounds
the length, rejects the damage a search-and-replace leaves behind (doubled
spaces, space before punctuation), catches binary-contrast scaffolds, and
on keep-my-voice fixtures measures whether first person, contractions, and
word length moved. A draft can pass it and still read badly, so read the
drafts in `evals/outputs/` as well as the pass counts. For relative
quality, use the pairwise comparison; for absolute invention, use the
canon judge.

## Known-good drafts

`examples/` holds one passing draft per fixture. They double as a self-test
for the checker:

```bash
node evals/run-evals.js --all evals/examples
```

CI runs this self-test, together with `scripts/check-evals.js`, on every
push and pull request.

## What CI does NOT run (and why)

`run-skill.js` and `compare-outputs.js` are model-backed: they shell out to
the `claude` CLI with working credentials, spend real money, and return
nondeterministic prose (temperature and seed are not settable via
`claude -p`, so sampling cannot be pinned). None of that belongs in a
per-commit gate. CI runs only the deterministic half: the checker
self-test above and the fixture schema validation. Model runs happen by
hand before/after skill changes, with results recorded below.

## Last full model run

| Date | Model | Skill(s) | Fixtures | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| _none yet_ | | | | | Fill this in after each hand-run `node evals/run-skill.js` pass. |

## What each fixture tests

| Fixture | Tests |
| --- | --- |
| `canon-keeping` | Restraint: Petra's boat calls, Tomas unloads paraffin and says nothing about the key. Established facts survive; the key stays secret; no anachronisms. |
| `voice-preservation` | The inverse test: a spare first-person passage must come back tighter with its voice intact, not flattened. First-person, contraction, and hedge rates must not move. |
| `no-invention` | Vividness without invention: the lamp room described in two paragraphs using only the given context. No new named objects, no new history, no measurements. |
| `promise-payoff` | Setup paid off, mystery intact: the key opens the sea-chest; the logbook and fuse wire are found; who left the key stays unanswered. |
| `question-stays-open` | Deepening without resolving: the mystery gets sharper and ends on a question. Naming the key-leaver fails. |
| `anti-slop` | Generic AI tells removed ("beacon of hope", "it is important to note", "delve") while every fact survives. |
| `revision-continuity` | Revision restraint: the sea-chest stays shut and the key-leaver unnamed while every fact survives. Evaluates the `revision-continuity` skill. |
| `series-continuity` | Canon carried forward: deaths, the paraffin-fired lens, the shut chest, and the open question survive into book two with no new characters. Evaluates the `series-continuity` skill. |
| `genre-craft-mystery` | Fair-play contract stated and the passage ends on the open question. Evaluates the `genre-craft` skill (mystery). |
| `deep-pov` | Filter words and thought-tags struck from a mild-interiority passage ("I noticed the key" becomes the key in the pocket) with the canon intact. Evaluates the `scene-craft` skill. |
| `motif-restraint` | The motif carries the chapter's idea through what Tomas does; naming the theme or explaining what the motif means fails. Evaluates the `theme-craft` skill. |
| `screenplay-fountain` | A passage adapted into one Fountain scene: slugline, source note, and nothing on the page a camera could not photograph. Voiceover, camera directions, and kept first-person narration fail. Evaluates the `adaptation` skill. |

Twelve fixtures cover eight skills: `chapter-writing` (six), `line-editing`,
`revision-continuity`, `series-continuity`, `genre-craft`, `scene-craft`,
`theme-craft`, and `adaptation`. The other thirteen skills have no
behavioural regression net and rely on human review. A skill is worth a
fixture when a substring checker can tell a good output from a bad one; a
fixture that passes whatever the skill does is worse than an honest gap.

## Check format

`checks.json` fields:

- `brief`: the drafting instruction to give the skill.
- `skill`: the skill under test (e.g. `chapter-writing`). Required by `scripts/check-evals.js`; `run-skill.js --skill` selects which skill's instructions to load.
- `required`: case-insensitive canon phrases that must appear in the draft (facts, names, objects). Matching is stem/inflected, so `logbook` also matches `logbooks`.
- `banned`: case-insensitive phrases that must not appear (resolutions, inventions, slop). Matching is stem/inflected like `required`, so `delve` also catches `delving`; add 2–3 paraphrase variants per trap phrase (e.g. `told Petra about the key` beside `told her about the key`) for what inflection cannot catch.
- `banned_regex`: regular expressions that must not match (for example invented measurements or anachronisms). Matching is case-insensitive.
- `max_words_ratio` / `min_words_ratio`: draft length bounds relative to the input, to catch padding and over-cutting.
- `max_words`: absolute draft word cap, for briefs that promise one (canon-keeping: under 220 words).
- `paragraphs`: exact paragraph count, for briefs that promise one (no-invention: two paragraphs). Fenced code blocks are exempt.
- `ends_with_question`: when `true`, the draft must end on `?` (question-stays-open, genre-craft-mystery).
- `requires_first_person` / `requires_past_tense`: when `true`, the draft must show first-person pronouns / at least 2 past-tense markers. Both are coarse proxies (the past-tense list counts `red` as past tense, hence the ≥2 minimum), tripwires for ignored briefs rather than classifiers.
- `expected_overlaps`: the phrase collisions this fixture means to have, so `scripts/check-evals.js` stays quiet about them. `in_input` holds `["<banned phrase>"]` entries for tells the input is deliberately seeded with (anti-slop's brief asks for their removal); `with_required` holds `["<banned phrase>", "<required phrase>"]` entries for traps that have to contain a canon name (`it was Petra` beside required `Petra`). An unlisted collision warns, so a new one is visible; a listed collision that no longer exists fails, so the list cannot outlive the phrases it covers.
- `voice_drift`: for keep-my-voice briefs, the largest change allowed per marker between input and draft. Markers are `contraction_rate`, `first_person_rate`, and `hedge_rate` (all per 100 words) and `mean_word_length`. Limits are regression tripwires calibrated so the known-good draft passes with headroom (voice-preservation drifts +1.21/+1.62/0.00/−0.31 against limits 3.0/3.0/2.0/0.6), not perceptual thresholds. Drift is directional: rates fail when they fall past the limit (voice stripped) and warn on overshoot; `mean_word_length` fails when it rises past the limit and warns on a fall.

Every fixture also gets three well-formedness checks the checker applies itself: no doubled spaces inside a line, no space before punctuation, and no empty clause between punctuation marks. Four structure checks run on every draft as well: the binary-contrast scaffolds ("not just X but Y", "isn't just", "it's not about X, it's Y", "not because X but because Y"), which no fixture's ideal draft needs.

## Adding a fixture

Keep inputs short and auditable. Seed them with canon from the fixture
story world and at least two facts that must survive, plus the traps a lazy
draft would spring (a resolution, an invention, a tell). Banned phrases
should be ones a lazy draft would plausibly introduce; do not ban words the
ideal draft might legitimately use. Add a known-good draft to `examples/`
and check it passes. Then run `node scripts/check-evals.js` to validate the
fixture schema; record any collision it reports in `expected_overlaps` if
the fixture means it, and fix the phrase if it does not.

Check the fixture bites before trusting it: write the draft the skill is
supposed to prevent (the unrewritten passage, the on-the-nose version, the
lazy adaptation), run `node evals/run-evals.js evals/fixtures/<name>
<that-draft>.md`, and confirm it fails on the checks the fixture exists
for.

# Evals

Regression tests for the fiction-writing skills. Each fixture is a drafting
brief seeded with known canon (established facts that must survive) and
known traps (inventions, resolved mysteries, or slop a lazy draft would
introduce). Fixtures for the skills that write files rather than prose (a
query letter, a synthesis, a style sheet, a character's frontmatter) work
the same way: the canon is what the file must keep, and the traps are what
the skill must not invent or decide for the user. A passing draft keeps the canon, springs none of the traps, and
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
| 2026-09-28 | claude-opus-5-5 | plot-structure, premise-workshop, scene-craft, chapter-writing | plot-beats, premise-logline, scene-sequel, context-boundary | 2/4 PASS: plot-beats, scene-sequel. FAIL: premise-logline (6 invented claims), context-boundary (3 invented claims) | Checker counts are after recalibrating against these drafts (scene-sequel and context-boundary had required `sea-chest` and `brass key` where the drafts said `chest` and `key`; premise-logline's brief now states its 200-word cap, and its `the chest holds` trap needs an object after it). The judge's claims are real: the logline invented a Board deadline and "Ana's secret"; the chapter invented a step count and moved the chest "under the east window". |
| 2026-09-28 | claude-sonnet-5-5 | plot-structure, premise-workshop, scene-craft, chapter-writing | plot-beats, premise-logline, scene-sequel, context-boundary | 2/4 PASS: plot-beats, context-boundary. FAIL: scene-sequel (350 words, cap 320), premise-logline (two tests reported weak, 239 words) | Judge (claude-opus-5-5) found no invented canon in any draft. The logline failed its own stress tests and offered fixes instead of a logline that passes, which is what the fixture exists to catch. |
| 2026-09-28 | claude-opus-5-5, claude-sonnet-5-5 | reader-panel | reader-panel | Sonnet PASS (24/24, 0 invented claims). Opus FAIL on length only (461 words, cap 450) | Both reads found the planted POV slip at `ch02-p4`, quoted it, and raised no other problem. The brief did not state a length then; it now says under 450 words. |
| 2026-09-27 | claude-opus-5 | verse-craft | verse-limerick | PASS (checker 32/32, 0 invented claims) | Two earlier runs passed the checker but the judge caught invented details ("last year", "a drum", a debt); the second also broke AABBA. Fixed by listing usable facts before drafting and checking rhyme and beats even when only the poem is returned. |

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
| `verse-limerick` | One limerick in a character's voice: it names Tomas and the paraffin, stays in one five-line stanza under 60 words, and keeps the key secret. Archaic filler (*o'er*, *nigh*, *did come*) and a scansion table in the output fail. The checker cannot hear meter, so read the draft. Evaluates the `verse-craft` skill. |
| `scene-sequel` | A scene and its sequel from a scene record: goal, conflict, and the disaster (the key snaps), then reaction, the dilemma stated as a choice, and the decision, not carried out. A scene with no turn (the key turns, the lid comes up), a forced lock, or anything from inside the chest fails. Evaluates the `scene-craft` skill. |
| `plot-beats` | Three-act beats mapped onto the eight chapters the book already has, as an arc Plot Points table. A chapter past `Ch 8`, a proposed new chapter, or a midpoint row anywhere but `Ch 4` fails. Evaluates the `plot-structure` skill. |
| `premise-logline` | One logline from the user's spark, plus four stress tests reported pass, weak, or fail. A test reported weak or fail, a new relative, or deciding who left the key or what the chest holds fails. Evaluates the `premise-workshop` skill. |
| `reader-panel` | The line-editor persona's simulated read of a short chapter with one planted POV slip (Tomas's first-person narration reports what Petra thought). The read must be a feedback file marked `source: simulated`, cite the slip by its label and words, and file it at the right label, and raise no other problem: a second problem heading, a `Where` line at another paragraph, or a read labelled as a human's fails. Evaluates the `reader-panel` skill. |
| `drafting-fr` | A scene drafted in French for a book with `language: fr`: dialogue in guillemets, the watch's time spelled out, and the stopped watch left shut. English words or quote marks, `4 h 17` in digits, the second cover, or naming M. F. fails. Evaluates `chapter-writing` in another language. |
| `drafting-ja` | A scene drafted in Japanese for a vertical book counted in characters: under 500 characters, dialogue in 「」 with no 。 before the closing bracket, numbers in kanji. Latin words, Arabic numerals, curly quotes, or anything the station clerk has kept (the envelope, the timetable, a letter) fails. Evaluates `chapter-writing` in another language. |
| `drafting-ar` | A scene drafted in Arabic: dialogue in «», the Arabic comma and question mark, and the manuscript left shut. Latin letters or punctuation, the leaf's hiding place, the dedication, or Nader arriving fails. Evaluates `chapter-writing` in another language. |
| `line-editing-fr` | A French passage with straight quotes, no space before `?`, and filler (*Soudain, elle s'aperçut que*, *perdue dans ses pensées*) must come back in guillemets with French spacing and the filler cut, the rest unchanged. Evaluates `line-editing` with its language conventions. |
| `line-editing-ja` | A Japanese passage with curly quotes, Arabic numerals in vertical text, `。」`, `・・・`, a half-width `?`, and padding must come back in 「」 with kanji numerals, `……`, and `？`. Evaluates `line-editing` with its language conventions. |
| `line-editing-ar` | An Arabic passage with straight quotes, Latin commas and question marks, and the style sheet's watch words (فجأة, a named feeling) must come back in «» with `،` and `؟` and the watch words cut. Evaluates `line-editing` with its language conventions. |
| `branch-rejoin` | The prose of a branching chapter where two branches rejoin, true on both paths, under 150 words and ending on the choice. Where Tobias lies or where his coat is (each differs by path), the ship "you saw" (only one branch saw it), either ending, frontmatter, or Twine link syntax fails. The runner keeps only the text under `## Chapter Text`, so this fixture checks prose; `branch-choices` checks the chapter's `choices`. Evaluates the `interactive-fiction` skill. |
| `branch-choices` | The same rejoin returned as the whole chapter file (`keep: file`): frontmatter with `choices` to both endings, `chapter-05` and `chapter-06`, the heading, and the prose under `## Chapter Text`. A choice to any other chapter (the rejoin itself, a branch, a typo), a missing ending, Twine link syntax (`[[`, `]`, `|`, `->`) in a choice's `text`, a reply with no frontmatter, or the per-path traps of `branch-rejoin` fails. Evaluates the `interactive-fiction` skill. |
| `context-boundary` | A chapter drafted from `story context` output with the whole-book outline open beside it: it stays inside the target length and uses nothing the packed context leaves out (the logbook, the fuse wire, who left the key). Evaluates `chapter-writing`'s use of `story context`. The runner gives the model no tools, so the fixture supplies the command's output: it tests staying inside the budget and the spoiler boundary, not the choice to run the command. |
| `query-letter` | A query letter, the letter alone and 250 to 350 words, from a finished book's facts: the title in capitals, the word count rounded to `71,000` (not `71,482`), and `[TODO` placeholders for the agent, comps, and bio the author has not supplied. The ending (the logbook, going ashore with Petra), invented comps after "readers of", credentials, and any question mark fail. Evaluates the `submission` skill. |
| `triage-synthesis` | A round-3 synthesis from three human readers' notes: the POV slip two readers found is convergent, the pacing split is adjudicated, the Thursday contradiction is accepted, and the romance a reader wants is declined with a reason from the premise. A `ready` verdict, a romance in the revision plan, "the author disagrees", or labelling the round simulated fails. Evaluates the `feedback-triage` skill. |
| `reconcile-diff` | The reconcile loop on a discovered chapter, written as its post-hoc notes: Ewan as a candidate for approval, the Petra-every-Thursday contradiction put to the user, the cracked prism as enrichment, and the second keyhole as dangling. Claiming to have created files, updating the bible to the chapter's version unasked, or naming who left the key fails. Evaluates the `discovery-drafting` skill. |
| `sensitivity-brief` | A reading brief for a sensitivity reader with lived experience of sight loss: the three chapters, the author's specific questions, and `[TODO` for the deadline, fee, and credit the author has not settled. An invented fee or date, unpaid or "volunteer" reading, or a promise that the read certifies the portrayal fails. Evaluates the `editorial-review` skill. |
| `character-progression` | Two later changes to Tomas (a burned hand from chapter 6, retired keeper from chapter 9) recorded as `progressions` in story order, with every opening value kept. A top-level `scar` or `title` field, a progression on a list field such as `aliases`, a change to `status` or `role`, or a progression before chapter 6 fails. Evaluates the `character-management` skill. |
| `copyright-page` | The copyright matter page from what the author supplied: `order: 0`, `heading: false`, her copyright line, the UK moral rights line, and the cover credit, with `[TODO` for the ISBNs and edition month. An invented ISBN, imprint, editor, release month, or permission credit for the pending epigraph fails. Evaluates the `publishing` skill. |
| `research-note` | A research note opened with no sources available: `status: open`, `confidence: low`, a question, and a search plan that names primary sources. Marking it verified, raising confidence, listing a source or URL, or stating a recalled fact (pumping "every two hours", a dated manual) as found fails. Evaluates the `research` skill. |
| `init-project` | The `story init` command and the finished `story.md` frontmatter from the user's answers: every value single-quoted (the title as `'The Keeper'\''s Key'`), `language: en-GB` added after init, and `status: planning`. A double-quoted value, a `--language` flag (there is none), `language: en`, or publishing metadata asked for at init fails. Evaluates the `story-init` skill. |
| `maintenance-triage` | What to do with a `story check` report: run `story reindex` and `story wordcount --write` for the mechanical findings, and leave the open promise, the author's deliberate `[TODO`, and the continuity state to the author or `revision-continuity`. Marking the promise paid off or abandoned, changing `story.md`'s status to hide the error, silencing a warning, or removing the `[TODO` fails. Evaluates the `story-maintenance` skill. |
| `location-routes` | The supply-boat route and a chapter 9 automation recorded in Greywidow Light's frontmatter: a `routes` entry to `skerry-harbour` with `hours: 1.5`, and a `status` progression from chapter 9 while the opening `status: manned` stays. A top-level `power` or changed `status`, a progression on `notable-characters`, or a summed round trip fails. Evaluates the `worldbuilding` skill. |
| `style-sheet` | A style sheet filled from two approved chapters: British dialect, *lamp room*, plain *said*, and the *Okay*/*OK* inconsistency put to the author instead of decided. A `preferred` entry choosing either form, an American dialect, or the agent-drafted chapter 3 listed in `samples` fails. Evaluates the `voice-style` skill. |

## Skill coverage

Each fixture runs under the skill its `checks.json` names in `skill`.

| Skill | Fixtures |
| --- | --- |
| `adaptation` | `screenplay-fountain` |
| `chapter-writing` | `anti-slop`, `canon-keeping`, `context-boundary`, `drafting-ar`, `drafting-fr`, `drafting-ja`, `no-invention`, `promise-payoff`, `question-stays-open` |
| `character-management` | `character-progression` |
| `discovery-drafting` | `reconcile-diff` |
| `editorial-review` | `sensitivity-brief` |
| `feedback-triage` | `triage-synthesis` |
| `genre-craft` | `genre-craft-mystery` |
| `interactive-fiction` | `branch-choices`, `branch-rejoin` |
| `line-editing` | `line-editing-ar`, `line-editing-fr`, `line-editing-ja`, `voice-preservation` |
| `plot-structure` | `plot-beats` |
| `premise-workshop` | `premise-logline` |
| `publishing` | `copyright-page` |
| `reader-panel` | `reader-panel` |
| `research` | `research-note` |
| `revision-continuity` | `revision-continuity` |
| `scene-craft` | `deep-pov`, `scene-sequel` |
| `series-continuity` | `series-continuity` |
| `story-init` | `init-project` |
| `story-maintenance` | `maintenance-triage` |
| `submission` | `query-letter` |
| `theme-craft` | `motif-restraint` |
| `verse-craft` | `verse-limerick` |
| `voice-style` | `style-sheet` |
| `worldbuilding` | `location-routes` |

Thirty-seven fixtures cover all 24 skills. Most skills have one fixture, so
the net is thin: one fixture catches the regression it was written for, not
every way the skill can go wrong. A skill is worth another fixture when a
substring checker can tell a good output from a bad one; a fixture that
passes whatever the skill does is worse than an honest gap. Keep this table
current when you add a fixture.

## Check format

`checks.json` fields:

- `brief`: the drafting instruction to give the skill.
- `skill`: the skill under test (e.g. `chapter-writing`). Required by `scripts/check-evals.js`; `run-skill.js --skill` selects which skill's instructions to load.
- `required`: case-insensitive canon phrases that must appear in the draft (facts, names, objects). Matching is stem/inflected, so `logbook` also matches `logbooks`. How a phrase's ends match depends on the script of its first and last letter (see [Phrase matching by script](#phrase-matching-by-script)).
- `banned`: case-insensitive phrases that must not appear (resolutions, inventions, slop). Matching is stem/inflected like `required`, so `delve` also catches `delves` and `delving`, and `tapestry` catches `tapestries`; add 2–3 paraphrase variants per trap phrase (e.g. `told Petra about the key` beside `told her about the key`) for what inflection cannot catch.
- `banned_regex`: regular expressions that must not match (for example invented measurements or anachronisms). Matching is case-insensitive and in Unicode mode, so `\b` is an ASCII word boundary: in a fixture whose traps sit next to accented letters, bound a word with `(?<![\p{L}\p{M}])` and `(?![\p{L}\p{M}])` instead, so that `the` does not match inside French *thé*.
- `keep`: what `run-skill.js` scores of the model's reply. `"chapter-text"`, the default, drops everything above a `## Chapter Text` heading (frontmatter, title, outline) and keeps the prose. `"file"` keeps the whole reply, frontmatter included, and the system prompt asks for the complete file instead of prose alone; use it for a fixture that checks a chapter's frontmatter, such as `branch-choices` and its `choices`. Its required phrases and `banned_regex` then see the YAML, and `max_words` counts it. `scripts/check-evals.js` rejects any other value. The checker (`run-evals.js`) always reads the draft file whole, so a known-good example for a `file` fixture is the whole file.
- `max_words_ratio` / `min_words_ratio`: draft length bounds relative to the input, to catch padding and over-cutting.
- `max_words`: absolute draft word cap, for briefs that promise one (canon-keeping: under 220 words).
- Length checks (`max_words` and the ratios) count whitespace-separated tokens, and each Chinese or Japanese character as one word. A fixture whose `language` is Chinese or Japanese (`zh`, `ja`, and their tags) counts characters instead, as `story wordcount` measures a book in those languages: grapheme clusters that are not whitespace, punctuation included. Its caps and ratios are in characters, and the report says so (drafting-ja: `length 317 characters <= 500`).
- `language`: the BCP 47 tag of the book the fixture drafts or edits for (`fr`, `ja`, `ar`). A Chinese or Japanese fixture measures length in characters (see above). In a French fixture (`fr` or `fr-*`) the space-before-punctuation check allows the space French sets before `: ; ! ?`, and checks only commas and full stops. Fixtures in other languages leave out the English-only checks (`requires_first_person`, `requires_past_tense`, `voice_drift`, and the binary-contrast scaffolds, which match only English) and put the language's own traps in `banned_regex`: English words (bounded with `\p{L}`, as above) or quote marks, digits where the style sheet spells numbers out, and the language's contrast scaffold (*pas seulement… mais*, だけでなく, ليس فقط).
- `paragraphs`: exact paragraph count, for briefs that promise one (no-invention: two paragraphs). Fenced code blocks are exempt.
- `lines`: exact count of nonblank lines, for verse briefs that promise one (verse-limerick: five lines). Fenced code blocks are exempt.
- `ends_with_question`: when `true`, the draft must end on `?` (question-stays-open, genre-craft-mystery).
- `requires_first_person` / `requires_past_tense`: when `true`, the draft must show first-person pronouns / at least 2 past-tense markers. Both are coarse proxies (the past-tense list counts `red` as past tense, hence the ≥2 minimum), tripwires for ignored briefs rather than classifiers.
- `expected_overlaps`: the phrase collisions this fixture means to have, so `scripts/check-evals.js` stays quiet about them. `in_input` holds `["<banned phrase>"]` entries for tells the input is deliberately seeded with (anti-slop's brief asks for their removal); `with_required` holds `["<banned phrase>", "<required phrase>"]` entries for a banned phrase that sits inside a required one (`brass key` beside required `Petra's brass key`), the one case where keeping the canon trips the trap; a banned phrase that contains a required name (`it was Petra` beside `Petra`) is harmless and needs no entry. An unlisted collision warns, so a new one is visible; a listed collision that no longer exists fails, so the list cannot outlive the phrases it covers.
- `voice_drift`: for keep-my-voice briefs, the largest change allowed per marker between input and draft. Markers are `contraction_rate`, `first_person_rate`, and `hedge_rate` (all per 100 words) and `mean_word_length`. Limits are regression tripwires calibrated so the known-good draft passes with headroom (voice-preservation drifts +1.21/+1.62/0.00/−0.31 against limits 3.0/3.0/2.0/0.6), not perceptual thresholds. Drift is directional: rates fail when they fall past the limit (voice stripped) and warn on overshoot; `mean_word_length` fails when it rises past the limit and warns on a fall.

Every fixture also gets three well-formedness checks the checker applies itself: no doubled spaces inside a line, no space before punctuation, and no empty clause between punctuation marks. Four structure checks run on every draft as well: the binary-contrast scaffolds ("not just X but Y", "isn't just", "it's not about X, it's Y", "not because X but because Y"), which no fixture's ideal draft needs.

### Phrase matching by script

`required` and `banned` phrases ignore case, treat spaces, hyphens, and dashes alike, and bound each end by the script of the phrase's first or last letter:

| Script at that end | Start of the phrase | End of the phrase |
| --- | --- | --- |
| Latin, with or without accents | Not inside a word: `montre` misses *démontre*, `à` misses *déjà* | Not inside a word, except by an English inflection: `logbook` matches *logbooks*, `key` misses *turkey* |
| Any other script written with spaces (Cyrillic, Greek, Arabic, Hebrew, Devanagari, Hangul, ...) | Not inside a word: `кот` misses *скот*, `در` misses *بدر* | Open, for case endings, plurals, and joined particles: `кот` matches *кота*, `ספר` *ספרים*, `책` *책을*, `کتاب` *کتابی* |
| Chinese, Japanese, Thai, Lao, Khmer, Myanmar | Open: `封筒` matches inside *青い封筒が* | Open |
| A digit, in any script | Not after another digit | Not before another digit |

A mixed phrase bounds each end by its own script, so `Kirimi駅` matches *Kirimi駅前* but not *XKirimi駅*. An open end also lets a word that only starts with the phrase match (`кот` in *который*), so pick phrases long enough to be distinctive.

A fixture whose `language` is Arabic (`ar`) or Hebrew (`he`) also lets a phrase follow the prefixes those languages join to a word. In Arabic these are و or ف, then ب, ك, or ل, then the article ال (`مخطوطة` matches *والمخطوطة*, *بالمخطوطة*, and *للمخطوطة*; a phrase that starts with ال matches *للمخطوطة* too), and the future س before a verb's own prefix (`يدخل` matches *سيدخل*, `حب` misses *سحب*). An Arabic final ة also matches ت and ات, and a final ى matches ا (`مخطوطة` matches *مخطوطتها* and *مخطوطات*, `ليلى` matches *ليلاه*). In Hebrew they are ו, ש (after כ or מ), ב, כ, ל, or מ, then the article ה (`ספר` matches *בספר*, `הלך` matches *כשהלך*). A fixture in another language written in these scripts (Persian, Urdu, Yiddish), or with no `language`, gets the plain rule above.

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

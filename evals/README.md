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

The runner builds a system prompt from the skill's `SKILL.md` and the
reference files it names, sends each fixture's `input.md` with its `brief`
through `claude -p` with no tools, saves the draft to
`evals/outputs/<fixture>.md` (gitignored), and runs the checker on it.
Every call runs with `--safe-mode`, so your own `CLAUDE.md` files, skills,
plugins, hooks, and MCP servers stay out of the model's context and the
skill is the whole system prompt; without it, `claude -p` also reads the
contributor's own `CLAUDE.md`, so their personal writing rules could reach
the drafts.

The model has no tools, so it cannot open a reference the way an agent
using the skill would. The runner reads them in its place, following the
skill's paths as the agent would:

- It loads every file `SKILL.md` names as a link or a code span ending in
  `.md`, so another skill's file such as
  `../feedback-triage/references/feedback-template.md` loads too. The
  `#anchor` of a link is dropped.
- It then loads the files those references name, breadth-first, while the
  reference text stays within 48,000 characters (`MAX_REFERENCE_CHARS` in
  `run-skill.js`). The files `SKILL.md` names always load. A file past the
  cap is left out, and so is every file that only left-out files lead to.
- A path resolves from the folder of the file that names it, as a link
  would. If nothing is there, it resolves from that file's skill folder (a
  reference that names a sibling as `references/x.md`), then from `skills/`
  (the `chapter-writing/references/writing-guidelines.md` form).
- It skips paths that do not exist (a project path such as
  `chapters/chapter-{NN}.md`), any `SKILL.md`, and any file whose real path
  is outside `skills/`, so a symlink cannot bring in a file from elsewhere.
  A file that no path names never loads.

Each reference sits under a comment with its path from the skill's folder
(`<!-- ../feedback-triage/references/feedback-template.md -->`). The run
log lists the files each fixture loaded, the files left out over the cap,
and each name with a `references/` folder in it that points to no file,
such as a reference named only in prose (`references/naming-languages.md`
in the `worldbuilding` skill). Every `SKILL.md` lists its own references,
and a test checks that each skill's links reach every file in its
`references/`, so each skill still gets all of them. An agent reads only
the files its task needs, so the eval context is larger than in real use.

Run provenance is saved next to
each draft: `<fixture>.prompt.md` (exact prompt sent),
`<fixture>.system.sha256` (hash of the system prompt), and
`<fixture>.judge-raw.txt` (the judge's raw reply); model, temperature, and
seed are logged per run (`claude -p` exposes no temperature/seed flags, so
sampling uses the CLI defaults). It needs the Claude Code CLI on
PATH with working credentials. Run it before and after any change to a
skill's instructions or references and compare the reports, and read the
drafts, since a pass count says nothing about whether the prose reads well.

Before saving a draft, the runner unwraps a reply that is one fenced block.
It drops a lead-in of one or two lines ending in a colon ("Here's the
draft:") and a one-line sign-off addressed to the user after the fence ("Let
me know if you want changes."), then strips the outer fence: backticks or
tildes, three or more, with any info string. Fences inside the draft stay. A
reply with several top-level blocks, any other text after the closing fence
(it may be the draft's last line), or a longer lead-in is saved as written,
and a heading or frontmatter `---` is never taken for a lead-in. Earlier runs
stripped a fence only at the very start of the reply, so a fenced draft
after a lead-in kept its fence and the checker skipped the fenced prose; such
drafts now score on their content.

After the checker, the runner makes a second model call that lists every
canon claim the draft makes that the context does not state or imply: a new
named character, a new world rule, a resolved mystery, a changed fact. One
listed claim fails the fixture, and the list is saved next to the draft as
`<fixture-name>.claims.json`. This exists because the substring checker
cannot see invention: only a reader (human or model) can tell that "Petra
left the key" resolves the open question. Read a flagged claim before acting
on it. The judge is told not to list workflow the draft describes rather
than story it tells (commands to run, project files to check or update,
skills, templates, or rules to follow), since a plan or a ledger names them
and a fixture may require them. That covers a command's syntax and flags,
not its free text: the judge still reads a quoted clue title or description
inside a command for invented canon. Pass `--no-judge` to skip the call and
`--judge-model` to override it.

The judge is told to reply with one JSON array of strings. Its input holds
the draft, which a model wrote, so the runner reads the reply strictly: a
reply it cannot read for certain fails the fixture rather than passing it.
It passes over prose brackets that are not JSON (`[name needed]`) and
number-only arrays (a footnote such as `[1]`), and accepts the same array
given twice. The judge call fails when the reply has no array of strings,
an array of anything else, two different arrays (`["Mara has a sister"]`,
then "if there were none I would reply `[]`"), a `[` that never closes, or
an array inside brackets that do not parse as JSON.

A draft or judge call that fails, after its retries, fails its fixture.
The summary at the end lists every fixture, with `draft call failed` or
`judge failed` beside one whose call failed, and ends with the count
(`35 of 37 fixtures passed`). The run exits non-zero unless every fixture
passed.

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
node evals/compare-outputs.js --no-judge evals/baseline evals/outputs  # margins only, no model calls
```

The comparison shows the judge the brief, the context, and both drafts,
unlabelled and in both orders, and counts a win only when the same draft
wins both ways. Judges prefer low-perplexity text and the first item shown,
and they agree with human writing preferences only about three quarters of
the time, so treat a loss as a flag to read both drafts, not a verdict.
Never label which draft came from the skill: labelled authorship shifts
judge preference.

A fixture whose checks test what the skill adds can also require a margin
over the baseline. When its `checks.json` sets `baseline_margin`,
`compare-outputs.js` runs the checker on both drafts and fails the fixture
unless the second directory's draft passes at least that many more checks
than the first's, so the two directories go in the order above: baseline
first, skill second. This needs no model call; `--no-judge` runs only the
margin checks, leaves out the selected fixtures that set no margin, and
lists them. A missed margin means a model with no skill does as well on the
fixture's checks, so the checks do not test the skill. The three fixtures
that set one are `revision-continuity` (2), `series-continuity` (2), and
`genre-craft-mystery` (3).

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
| 2026-10-07 | claude-sonnet-5-5 (judge claude-opus-5) | revision-continuity, series-continuity, genre-craft | revision-continuity, series-continuity, genre-craft-mystery | 2/3 PASS: genre-craft-mystery (30/30), series-continuity (40/40), 0 invented claims. FAIL: revision-continuity (31/32: chapter left at `status: draft`). No-skill baseline (`--no-skill --no-judge`): 26/30, 29/32, 37/40, so every `baseline_margin` is met (4, 2, and 3 against 3, 2, and 2) | First run of the skill-specific checks. The revision draft started the pass and listed the maintenance block in order, but left the chapter's `status` at `draft`, which the skill's step 6 says to move to `revised`; it also wrote "the chest", which failed the old required `sea-chest` (now `chest`, as for scene-sequel). The baseline invented `story clue add` and `story pass start` and carried `learned-in: the-key-on-the-door/chapter-01` into book two, which the first `learned-in` trap (a value starting `chapter-`) missed; the trap now fails any value. Counts are the saved drafts rescored against the current checks, which a review then tightened (each clue on its own command line, the chapter's own frontmatter, narration in the first person and past tense); no result changed. All 2026-10-07 runs used `--safe-mode`. |
| 2026-10-07 | claude-sonnet-5-5 (judge claude-opus-5) | interactive-fiction | branch-choices, branch-rejoin | 1/2 PASS: branch-choices (38/38, 0 invented claims). FAIL: branch-rejoin (36/36, 1 invented claim) | Both drafts ended on the choice as a question ("Which do you do?"), which failed the required word `choose`; that check now passes a last line with *choose* in it or a closing question mark, and the counts are the same drafts rescored. The claim is real: the rejoin hung the storm bell "on the gallery", where the context has it below. |
| 2026-10-07 | claude-sonnet-5-5 (judge claude-opus-5) | publishing, story-init, discovery-drafting, research, editorial-review, voice-style, feedback-triage | copyright-page, init-project, reconcile-diff, research-note, sensitivity-brief, style-sheet, triage-synthesis | 7/7 PASS after recalibration, 0 invented claims | Reruns of the fixtures below whose brief or input changed. Five briefs now state the cap their check enforces. reconcile-diff and research-note came back at 434 and 372 tokens, 418 and 350 words by a writer's count, so their caps now sit 5% over the brief's number for bullet and YAML tokens. The first triage-synthesis rerun passed the checker but the judge listed five workflow claims (its `story` commands, the template's own 1-vs-1 rule, and the `revision-continuity` handoff the fixture requires); the judge is now told not to list workflow, and the second rerun passed. |
| 2026-10-07 | claude-sonnet-5-5 (judge claude-opus-5) | character-management, publishing, story-init, worldbuilding, story-maintenance, submission, discovery-drafting, research, editorial-review, voice-style, feedback-triage | character-progression, copyright-page, init-project, location-routes, maintenance-triage, query-letter, reconcile-diff, research-note, sensitivity-brief, style-sheet, triage-synthesis | 1/11 PASS: maintenance-triage. FAIL: character-progression and location-routes (`from: chapter-6` and `from: chapter-9`), query-letter (a question mark, 3 invented claims), and eight on checks or context since recalibrated | First model run of these fixtures. Real failures, checks kept: `story validate` rejects `chapter-6` for `chapter-06`; the skill's query-letter reference rules out rhetorical questions, and the letter made Petra Tomas's only visitor and set it "as winter closes in". Recalibrated: no brief stated its length cap (reconcile-diff 904 words, research-note 752, style-sheet 585, triage-synthesis 658, sensitivity-brief 538); copyright-page's judge flagged the template's "First edition" and ebook and paperback lines, and init-project's the premise the skill drafts and the novella's default `target-words`, all of which the known-good drafts also hold, so the inputs now state them; sensitivity-brief wrote `[AUTHOR TO SET: …]`, now accepted as a placeholder; research-note's `reviewed-by` trap fired on prose naming the field, and triage-synthesis's romance trap on a "no romance subplot" plan item and its well-formedness check on an inline `` `story reindex .` ``. |
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
| `revision-continuity` | A continuity pass on chapter 3, returned as a one-line plan, the commands, and the revised chapter file. The pass (the next on the book's ladder) starts with `story passes . --start continuity` before `story reindex .`, `story wordcount . --write`, and `story check .`, in that order, and before the chapter; the chapter's own frontmatter moves to `status: revised`. The chapter text keeps first-person, past-tense narration (dialogue aside), puts "a week" right as the established three days with no other span of time, keeps the chest shut ("I had not opened the chest" is allowed), and names no key-leaver. Those traps read only the chapter text, so the plan, or a note after a fenced chapter, may name them. Sets `baseline_margin: 2`. Evaluates the `revision-continuity` skill. |
| `series-continuity` | Book two's `## Series Notes` and opening `continuity/state.md` from book one's canon and closing state: a `continuity-state` frontmatter block at `current-chapter: 0`, Tomas under `character-state`, the key and the chest under `object-state`, the same `fact` ids under `knowledge-state`, and no `learned-in` or `since` carried from book one. Deaths, the paraffin-fired lens, the shut chest, and the open question survive with no new characters. A negation counts only right before "opened" ("has never opened the chest" passes, "Nobody knows Tomas opened the chest" fails), and "Book two answers who…" fails. Sets `baseline_margin: 2`. Evaluates the `series-continuity` skill. |
| `genre-craft-mystery` | The clue ledger for a fair-play plan as `story add clue` commands, then the chapter 3 contract in a passage that ends on the open question. Each clue is checked on its own command line: the key planted in `chapter-01` with its payoff in `chapter-12` and `tomas-reyes` under `--character` (or `--characters`); the hour the same, and `--significance-delayed`; Petra's Thursday call a `--red-herring` from `chapter-02` debunked in `chapter-07`, with `petra-lindqvist`; then `story clues .`. A flag on the wrong clue, a wrong chapter, or a clue the plan does not name fails. Sets `baseline_margin: 3`. Evaluates the `genre-craft` skill (mystery). |
| `deep-pov` | Filter words and thought-tags struck from a mild-interiority passage ("I noticed the key" becomes the key in the pocket) with the canon intact. Evaluates the `scene-craft` skill. |
| `motif-restraint` | The motif carries the chapter's idea through what Tomas does; naming the theme or explaining what the motif means fails. Evaluates the `theme-craft` skill. |
| `screenplay-fountain` | A passage adapted into one Fountain scene: slugline, source note, and nothing on the page a camera could not photograph. Voiceover, camera directions, and kept first-person narration fail. Evaluates the `adaptation` skill. |
| `verse-limerick` | One limerick in a character's voice: it names Tomas and the paraffin, stays in one five-line stanza under 60 words, and keeps the key secret. Archaic filler (*o'er*, *nigh*, *did come*) and a scansion table in the output fail. The checker cannot hear meter, so read the draft. Evaluates the `verse-craft` skill. |
| `scene-sequel` | A scene and its sequel from a scene record: goal, conflict, and the disaster (the key snaps), then reaction, the dilemma stated as a choice, and the decision, not carried out. A scene with no turn (the key turns, the lid comes up), a forced lock, or anything from inside the chest fails. Evaluates the `scene-craft` skill. |
| `plot-beats` | Three-act beats mapped onto the eight chapters the book already has, as an arc Plot Points table. A chapter past `Ch 8`, a proposed new chapter, or a midpoint row anywhere but `Ch 4` fails. Evaluates the `plot-structure` skill. |
| `premise-logline` | One logline from the user's spark, plus all eight stress tests in `premise-tests.md` reported pass, weak, or fail. A test reported weak or fail, a new relative, or deciding who left the key or what the chest holds fails. Evaluates the `premise-workshop` skill. |
| `reader-panel` | The line-editor persona's simulated read of a short chapter with one planted POV slip (Tomas's first-person narration reports what Petra thought). The read must be a feedback file marked `source: simulated`, cite the slip by its label and words, and file it at the right label, and raise no other problem: a second problem heading, a `Where` line at another paragraph, or a read labelled as a human's fails. Evaluates the `reader-panel` skill. |
| `drafting-fr` | A scene drafted in French for a book with `language: fr`: dialogue in guillemets, the watch's time spelled out, and the stopped watch left shut. English words or quote marks, `4 h 17` in digits, the second cover, or naming M. F. fails. Evaluates `chapter-writing` in another language. |
| `drafting-ja` | A scene drafted in Japanese for a vertical book counted in characters: under 500 characters, dialogue in 「」 with no 。 before the closing bracket, numbers in kanji. Latin words, Arabic numerals, curly quotes, or anything the station clerk has kept (the envelope, the timetable, a letter) fails. Evaluates `chapter-writing` in another language. |
| `drafting-ar` | A scene drafted in Arabic: dialogue in «», the Arabic comma and question mark, and the manuscript left shut. Latin letters or punctuation, the leaf's hiding place, the dedication, or Nader arriving fails. Evaluates `chapter-writing` in another language. |
| `line-editing-fr` | A French passage with straight quotes, no space before `?`, and filler (*Soudain, elle s'aperçut que*, *perdue dans ses pensées*) must come back in guillemets with French spacing and the filler cut, the rest unchanged. Evaluates `line-editing` with its language conventions. |
| `line-editing-ja` | A Japanese passage with curly quotes, Arabic numerals in vertical text, `。」`, `・・・`, a half-width `?`, and padding must come back in 「」 with kanji numerals, `……`, and `？`. Evaluates `line-editing` with its language conventions. |
| `line-editing-ar` | An Arabic passage with straight quotes, Latin commas and question marks, and the style sheet's watch words (فجأة, a named feeling) must come back in «» with `،` and `؟` and the watch words cut. Evaluates `line-editing` with its language conventions. |
| `branch-rejoin` | The prose of a branching chapter where two branches rejoin, true on both paths, under 150 words and ending on the choice: a last paragraph that says *choose*, or that names the bell or the lamp and ends on a question, quoted or in emphasis or not. Where Tobias lies or where his coat is (each differs by path), the ship "you saw" (only one branch saw it), either ending, frontmatter, or Twine link syntax fails. The runner keeps only the text under `## Chapter Text`, so this fixture checks prose; `branch-choices` checks the chapter's `choices`. Evaluates the `interactive-fiction` skill. |
| `branch-choices` | The same rejoin returned as the whole chapter file (`keep: file`): frontmatter with `choices` to both endings, `chapter-05` and `chapter-06`, the heading, and under 150 words of prose under `## Chapter Text`. A choice to any other chapter (the rejoin itself, a branch, a typo), a missing ending or one outside the `choices` list, a missing frontmatter delimiter, Twine link syntax (`[[`, `]`, `|`, `->`) in a choice's `text`, a reply with no frontmatter, or the per-path traps of `branch-rejoin` fails. Evaluates the `interactive-fiction` skill. |
| `context-boundary` | A chapter drafted from `story context` output with the whole-book outline open beside it: it stays inside the target length and uses nothing the packed context leaves out (the logbook, the fuse wire, who left the key). Evaluates `chapter-writing`'s use of `story context`. The runner gives the model no tools, so the fixture supplies the command's output: it tests staying inside the budget and the spoiler boundary, not the choice to run the command. |
| `query-letter` | A query letter, the letter alone and 250 to 350 words, from a finished book's facts: the title in capitals, the word count rounded to `71,000` (not `71,482`), and `[TODO` placeholders for the agent, comps, and bio the author has not supplied. The ending (the logbook, going ashore with Petra), invented comps after "readers of", credentials, and any question mark fail. Evaluates the `submission` skill. |
| `triage-synthesis` | A round-3 synthesis from three human readers' notes: the POV slip two readers found is convergent, the pacing split is adjudicated, the Thursday contradiction is accepted, and the romance a reader wants is declined with a reason from the premise. A `ready` verdict, a romance in the revision plan, "the author disagrees", or labelling the round simulated fails. Evaluates the `feedback-triage` skill. |
| `reconcile-diff` | The reconcile loop on a discovered chapter, written as its post-hoc notes: Ewan as a candidate for approval, the Petra-every-Thursday contradiction put to the user, the cracked prism as enrichment, and the second keyhole as dangling. Claiming to have created files, updating the bible to the chapter's version unasked, or naming who left the key fails. Evaluates the `discovery-drafting` skill. |
| `sensitivity-brief` | A reading brief for a sensitivity reader with lived experience of sight loss: the three chapters, the author's specific questions, and a bracketed placeholder (`[TODO: …]` or any other) on the deadline and fee lines, which the author has not settled. An invented fee or date, unpaid or "volunteer" reading, or a promise that the read certifies the portrayal fails. Evaluates the `editorial-review` skill. |
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

`checks.json` fields. A top-level key that is not one of these fails both `scripts/check-evals.js` and the checker, so a misspelled field cannot pass silently:

- `name`: the fixture's title in the checker's report. Defaults to the folder name.
- `brief`: the drafting instruction to give the skill.
- `skill`: the skill under test (e.g. `chapter-writing`). Required by `scripts/check-evals.js`; `run-skill.js --skill` selects which skill's instructions to load.
- `required`: case-insensitive canon phrases that must appear in the draft (facts, names, objects). Matching is stem/inflected, so `logbook` also matches `logbooks`. How a phrase's ends match depends on the script of its first and last letter (see [Phrase matching by script](#phrase-matching-by-script)).
- `banned`: case-insensitive phrases that must not appear (resolutions, inventions, slop). Matching is stem/inflected like `required`, so `delve` also catches `delves` and `delving`, and `tapestry` catches `tapestries`; add 2–3 paraphrase variants per trap phrase (e.g. `told Petra about the key` beside `told her about the key`) for what inflection cannot catch.
- `required_regex`: regular expressions that must match, matched like `banned_regex` (case-insensitive, Unicode mode, no multiline flag, so `^` is the start of the draft). Use one where a phrase cannot say where the canon must sit: `branch-choices` requires a frontmatter block whose `choices` list has an entry to each ending, quoted or not.
- `banned_regex`: regular expressions that must not match (for example invented measurements or anachronisms). Matching is case-insensitive and in Unicode mode, so `\b` is an ASCII word boundary: in a fixture whose traps sit next to accented letters, bound a word with `(?<![\p{L}\p{M}])` and `(?![\p{L}\p{M}])` instead, so that `the` does not match inside French *thé*.
- `keep`: what `run-skill.js` scores of the model's reply. `"chapter-text"`, the default, drops everything above a `## Chapter Text` heading (frontmatter, title, outline) and keeps the prose, and the system prompt asks for the draft prose alone. `"file"` keeps the whole reply, frontmatter included, and the system prompt asks for what the brief asks for, in the form it asks for, instead. Use it for every fixture whose brief asks for a file, frontmatter, or commands: `branch-choices` (a chapter's `choices`), `character-progression`, `copyright-page`, `genre-craft-mystery` (`story add clue` commands, then a passage), `init-project` (a command and the `story.md` frontmatter, in two fenced blocks), `location-routes`, `reader-panel`, `research-note`, `revision-continuity` (a plan, commands, and the chapter file), `series-continuity` (Series Notes and `continuity/state.md` frontmatter), `style-sheet`, and `triage-synthesis`. Such a fixture's `required`, `required_regex`, and `banned_regex` checks then see the YAML. In a chapter file its length checks (`max_words` and the ratios) count only the chapter text, since that is what a brief's word limit is about: the prose under `## Chapter Text`, up to the fence that closes the block it sits in (or opens the next), the next `#` or `##` heading, or the end. A file with no such heading is counted whole. `scripts/check-evals.js` rejects any other value, and fails a fixture whose known-good example holds frontmatter, at its start or on the line after a fence opens, but does not set `"file"`. The checker (`run-evals.js`) always reads the draft file whole, so a known-good example for a `file` fixture is the whole file.
- `max_words_ratio` / `min_words_ratio`: draft length bounds relative to the input, to catch padding and over-cutting.
- `max_words`: absolute draft word cap, for briefs that promise one (canon-keeping: under 220 words). The checker counts every whitespace-separated token, so a bullet dash, a `---` line, or a table pipe is a word to it and not to the model; a fixture whose file is mostly lists or YAML may set the cap about 5% over the brief's number (`reconcile-diff`: under 420 words, cap 440; `research-note`: under 360, cap 380).
- Length checks (`max_words` and the ratios) count whitespace-separated tokens, and each Chinese or Japanese character as one word. A fixture whose `language` is Chinese or Japanese (`zh`, `ja`, and their tags) counts characters instead, as `story wordcount` measures a book in those languages: grapheme clusters that are not whitespace, punctuation included. Its caps and ratios are in characters, and the report says so (drafting-ja: `length 317 characters <= 500`).
- `language`: the BCP 47 tag of the book the fixture drafts or edits for (`fr`, `ja`, `ar`). A Chinese or Japanese fixture measures length in characters (see above). In a French fixture (`fr` or `fr-*`) the space-before-punctuation check allows the space French sets before `: ; ! ?`, and checks only commas and full stops. Fixtures in other languages leave out the English-only checks (`requires_first_person`, `requires_past_tense`, `voice_drift`, and the binary-contrast scaffolds, which match only English) and put the language's own traps in `banned_regex`: English words (bounded with `\p{L}`, as above) or quote marks, digits where the style sheet spells numbers out, and the language's contrast scaffold (*pas seulement… mais*, だけでなく, ليس فقط).
- `paragraphs`: exact paragraph count, for briefs that promise one (no-invention: two paragraphs). Fenced code blocks are exempt.
- `lines`: exact count of nonblank lines, for verse briefs that promise one (verse-limerick: five lines). Fenced code blocks are exempt.
- `ends_with_question`: when `true`, the draft must end on `?` (question-stays-open, genre-craft-mystery).
- `requires_first_person` / `requires_past_tense`: when `true`, the draft must show first-person pronouns / at least 2 past-tense markers. The first-person check reads the narration, with quoted dialogue left out. The past-tense check also fails a first-person action verb in the present in the narration (*I take*, *I wait*). Both are coarse proxies (the past-tense list counts `red` as past tense, hence the ≥2 minimum), tripwires for ignored briefs rather than classifiers.
- `expected_overlaps`: the phrase collisions this fixture means to have, so `scripts/check-evals.js` stays quiet about them. `in_input` holds `["<banned phrase>"]` entries for tells the input is deliberately seeded with (anti-slop's brief asks for their removal); `with_required` holds `["<banned phrase>", "<required phrase>"]` entries for a banned phrase that sits inside a required one (`brass key` beside required `Petra's brass key`), the one case where keeping the canon trips the trap; a banned phrase that contains a required name (`it was Petra` beside `Petra`) is harmless and needs no entry. An unlisted collision warns, so a new one is visible; a listed collision that no longer exists fails, so the list cannot outlive the phrases it covers.
- `voice_drift`: for keep-my-voice briefs, the largest change allowed per marker between input and draft. Markers are `contraction_rate`, `first_person_rate`, and `hedge_rate` (all per 100 words) and `mean_word_length`. Limits are regression tripwires calibrated so the known-good draft passes with headroom (voice-preservation drifts +1.21/+1.62/0.00/−0.31 against limits 3.0/3.0/2.0/0.6), not perceptual thresholds. Drift is directional: rates fail when they fall past the limit (voice stripped) and warn on overshoot; `mean_word_length` fails when it rises past the limit and warns on a fall.
- `required_in_order`: lists of two or more regular expressions; in each list every pattern must match after the match of the one before (`revision-continuity`: `story passes --start continuity`, then `story reindex`, `story wordcount --write`, and `story check`). Use it instead of one pattern joined by `[\s\S]*?`, which can take seconds on a long draft that lacks the last command.
- `chapter_text`: checks that read only the chapter text of a reply (see `keep`): `required`, `banned`, `required_regex`, `banned_regex`, `required_in_order`, and `requires_first_person` and `requires_past_tense`. The last two read the narration, with quoted dialogue left out, so `"I can wait," he said` is not first person; the past-tense check also fails a first-person action verb in the present (*I take*, *I turn*, *I kneel*). Results carry a `chapter text:` label, and when the reply has no `## Chapter Text` heading every one of them fails.
- `chapter_frontmatter`: the same text checks (not the narration ones) on the frontmatter of the chapter file in a reply: the last `---` block of YAML lines before `## Chapter Text`. A `status: revised` line elsewhere in the reply does not count.
- `baseline_margin`: a positive integer. `compare-outputs.js` fails the fixture unless the skill's draft passes at least this many more of its checks than a no-skill baseline (see [Baseline and pairwise comparison](#baseline-and-pairwise-comparison)). Set it on a fixture whose checks test what the skill adds, below the number of those checks, so that sampling has room.

Every fixture also gets three well-formedness checks the checker applies itself: no doubled spaces inside a line, no space before punctuation, and no empty clause between punctuation marks. Four structure checks run on every draft as well: the binary-contrast scaffolds ("not just X but Y", "isn't just", "it's not about X, it's Y", "not because X but because Y"), which no fixture's ideal draft needs. These checks, like `ends_with_question` and the first-person and past-tense checks, skip fenced code blocks and read an inline command (a code span starting `story`, `node`, `git`, and the like) as one word, so `story reindex .` is not a space before a full stop. Other inline code is read as prose. The phrase and pattern checks read the whole draft, code included.

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
